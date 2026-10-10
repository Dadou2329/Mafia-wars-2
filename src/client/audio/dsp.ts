/**
 * Petite boîte à outils DSP hors ligne (boucles d'échantillons en JS pur)
 * servant à précalculer une fois des AudioBuffers : bruits, réponses
 * impulsionnelles, variantes de pas et de coups de feu, boucles d'ambiance et
 * de moteurs, batterie. Rien ici ne touche au graphe Web Audio.
 */

export type Rng = () => number;

/** Petit PRNG rapide à graine (mulberry32). Renvoie des flottants dans [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** Flottant aléatoire dans [lo, hi). */
export const rr = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng();
export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const TWO_PI = Math.PI * 2;
/** Multiplicateur par échantillon d'une décroissance exponentielle de constante `tau` (s). */
export const decayK = (fs: number, tau: number): number => Math.exp(-1 / (Math.max(tau, 1e-5) * fs));

type BiquadType = 'lp' | 'hp' | 'bp' | 'peak';

/** Biquad du « cookbook » RBJ, forme directe II transposée. */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private z1 = 0; private z2 = 0;

  static lowpass(fs: number, f: number, q = 0.7071): Biquad { return new Biquad().set('lp', fs, f, q); }
  static highpass(fs: number, f: number, q = 0.7071): Biquad { return new Biquad().set('hp', fs, f, q); }
  /** Passe-bande avec un gain de 0 dB au sommet. */
  static bandpass(fs: number, f: number, q = 1): Biquad { return new Biquad().set('bp', fs, f, q); }
  /** Égaliseur en cloche (gain en dB). */
  static peaking(fs: number, f: number, q: number, gainDb: number): Biquad { return new Biquad().set('peak', fs, f, q, gainDb); }

  set(type: BiquadType, fs: number, f: number, q: number, gainDb = 0): this {
    const w0 = (TWO_PI * clamp(f, 5, fs * 0.49)) / fs;
    const cs = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Math.max(q, 0.05));
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (type === 'peak') {
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A;
    } else {
      if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
      else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
      else { b0 = alpha; b1 = 0; b2 = -alpha; }
      a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** Passe-bas à un pôle dont le coefficient peut changer à chaque échantillon. */
export class OnePole {
  y = 0;
  a: number;
  constructor(fs: number, f: number) { this.a = OnePole.coef(fs, f); }
  static coef(fs: number, f: number): number { return 1 - Math.exp((-TWO_PI * f) / fs); }
  process(x: number): number { this.y += this.a * (x - this.y); return this.y; }
}

/**
 * Résonateur modal (mode de vibration amorti) : un « ping » métallique de
 * fréquence `f` et de constante de décroissance `tau`, excité par l'entrée.
 */
export class Resonator {
  private y1 = 0; private y2 = 0;
  private readonly c1: number; private readonly c2: number; private readonly g: number;
  constructor(fs: number, f: number, tau: number) {
    const r = Math.exp(-1 / (Math.max(tau, 1e-4) * fs));
    const w = (TWO_PI * clamp(f, 5, fs * 0.45)) / fs;
    this.c1 = 2 * r * Math.cos(w);
    this.c2 = -r * r;
    this.g = Math.sin(w); // gain d'impulsion ≈ 1
  }
  process(x: number): number {
    const y = this.c1 * this.y1 + this.c2 * this.y2 + x * this.g;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** Bruit rose (filtre raffiné de Paul Kellet) échantillon par échantillon. */
export class PinkGen {
  private b0 = 0; private b1 = 0; private b2 = 0; private b3 = 0; private b4 = 0; private b5 = 0; private b6 = 0;
  next(w: number): number {
    this.b0 = 0.99886 * this.b0 + w * 0.0555179;
    this.b1 = 0.99332 * this.b1 + w * 0.0750759;
    this.b2 = 0.969 * this.b2 + w * 0.153852;
    this.b3 = 0.8665 * this.b3 + w * 0.3104856;
    this.b4 = 0.55 * this.b4 + w * 0.5329522;
    this.b5 = -0.7616 * this.b5 - w * 0.016898;
    const y = (this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362) * 0.11;
    this.b6 = w * 0.115926;
    return y;
  }
}

/** Remplit de bruit blanc dans [-1, 1). */
export function whiteNoise(len: number, rng: Rng): Float32Array<ArrayBuffer> {
  const d = new Float32Array(len);
  for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
  return d;
}

/** Bruit rose, crête d'environ 1. */
export function pinkNoise(len: number, rng: Rng): Float32Array<ArrayBuffer> {
  const d = new Float32Array(len);
  const p = new PinkGen();
  for (let i = 0; i < len; i++) d[i] = p.next(rng() * 2 - 1);
  return d;
}

/** Bruit brun(ien) : bruit blanc intégré avec fuite. */
export function brownNoise(len: number, rng: Rng): Float32Array<ArrayBuffer> {
  const d = new Float32Array(len);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = rng() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.5;
  }
  return d;
}

/**
 * Rend `src` (longueur L + fondu) bouclable sans raccord : renvoie L
 * échantillons dont les `fade` premiers sont un fondu enchaîné à puissance
 * constante avec la queue qui dépasse (signaux non corrélés).
 */
export function loopify(src: Float32Array, fade: number): Float32Array<ArrayBuffer> {
  const L = src.length - fade;
  const out = new Float32Array(L);
  out.set(src.subarray(0, L));
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    const gIn = Math.sin(t * Math.PI * 0.5);
    const gOut = Math.cos(t * Math.PI * 0.5);
    out[i] = src[i] * gIn + src[L + i] * gOut;
  }
  return out;
}

/**
 * Table d'onde d'une période (taille + 1 échantillon de garde) : somme de
 * partiels [rang, amplitude, phase]. Bien plus rapide à lire qu'une somme de sinus.
 */
export function wavetable(parts: ReadonlyArray<readonly [number, number, number]>, size = 2048): Float32Array<ArrayBuffer> {
  const t = new Float32Array(size + 1);
  for (let i = 0; i <= size; i++) {
    const x = (TWO_PI * i) / size;
    let s = 0;
    for (const [h, a, ph] of parts) s += Math.sin(h * x + ph) * a;
    t[i] = s;
  }
  return t;
}

/** Lecture interpolée d'une table d'onde à la phase `u` (en périodes, quelconque). */
export function readTable(t: Float32Array, u: number): number {
  const size = t.length - 1;
  const x = (u - Math.floor(u)) * size;
  const i = x | 0;
  return t[i] + (t[i + 1] - t[i]) * (x - i);
}

/**
 * Ajoute un sinus à `d` par récurrence (une multiplication par échantillon) :
 * y[n] = 2·cos(w)·y[n-1] − y[n-2].
 */
export function addSine(d: Float32Array, f: number, amp: number, fs: number, phase = 0, from = 0, to = d.length): void {
  const w = (TWO_PI * f) / fs;
  const k = 2 * Math.cos(w);
  let y1 = Math.sin(phase - w) * amp;
  let y2 = Math.sin(phase - 2 * w) * amp;
  for (let i = from; i < to; i++) {
    const y = k * y1 - y2;
    d[i] += y;
    y2 = y1;
    y1 = y;
  }
}

/** Arrondit une fréquence à un multiple de 1/L (périodique sur une boucle de L secondes). */
export const periodicHz = (f: number, L: number): number => Math.max(1, Math.round(f * L)) / L;

/**
 * Modulation lente, douce et exactement périodique sur L secondes : somme de
 * sinus de fréquences k/L (k = 1..maxK) à phases aléatoires, normalisée dans [-1, 1].
 */
export function periodicMod(n: number, L: number, rng: Rng, maxK = 5, minK = 1): Float32Array<ArrayBuffer> {
  const d = new Float32Array(n);
  const terms: Array<[number, number, number]> = [];
  for (let k = minK; k <= maxK; k++) terms.push([(TWO_PI * k) / n, rng() * TWO_PI, (0.4 + rng() * 0.6) / k]);
  let p = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const [w, ph, a] of terms) s += Math.sin(w * i + ph) * a;
    d[i] = s;
    const a = Math.abs(s);
    if (a > p) p = a;
  }
  if (p > 1e-9) for (let i = 0; i < n; i++) d[i] /= p;
  return d;
}

export function peak(d: Float32Array): number {
  let p = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; }
  return p;
}

export function rms(d: Float32Array): number {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, d.length));
}

export function scale(d: Float32Array, g: number): void {
  for (let i = 0; i < d.length; i++) d[i] *= g;
}

export function normalizePeak(d: Float32Array, target: number): void {
  const p = peak(d);
  if (p > 1e-9) scale(d, target / p);
}

export function normalizeRms(d: Float32Array, target: number): void {
  const r = rms(d);
  if (r > 1e-9) scale(d, target / r);
}

/** Normalise au RMS visé sans dépasser la crête `maxPeak`. */
export function normalizeRmsCapped(d: Float32Array, target: number, maxPeak: number): void {
  const r = rms(d);
  const p = peak(d);
  if (r < 1e-9 || p < 1e-9) return;
  scale(d, Math.min(target / r, maxPeak / p));
}

/** Retire la composante continue par un passe-haut doux à un pôle (en place). */
export function dcBlock(d: Float32Array, fs: number, f = 20): void {
  const R = Math.exp((-TWO_PI * f) / fs);
  let x1 = 0, y1 = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    const y = x - x1 + R * y1;
    x1 = x; y1 = y;
    d[i] = y;
  }
}

/** Fondu de sortie linéaire sur les `n` derniers échantillons (en place). */
export function fadeOut(d: Float32Array, n: number): void {
  const len = d.length;
  const m = Math.min(n, len);
  for (let i = 0; i < m; i++) d[len - 1 - i] *= i / m;
}

/** Saturation douce tanh normalisée (gain unité pour les petits signaux, ±1 au maximum). */
export function softClip(x: number, drive: number): number {
  return Math.tanh(drive * x) / Math.tanh(drive);
}

/** Saturation douce dont la normalisation est précalculée (boucles d'échantillons). */
export function makeSoftClip(drive: number): (x: number) => number {
  const inv = 1 / Math.tanh(drive);
  return (x) => Math.tanh(drive * x) * inv;
}

/** Crée un AudioBuffer à partir de canaux (tous de même longueur). */
export function toBuffer(
  ctx: BaseAudioContext,
  channels: Float32Array<ArrayBuffer>[],
  sampleRate: number,
): AudioBuffer {
  const len = Math.max(1, channels[0]?.length ?? 1);
  const buf = ctx.createBuffer(channels.length, len, sampleRate);
  channels.forEach((ch, i) => buf.copyToChannel(ch, i));
  return buf;
}

/** Fréquence d'échantillonnage des boucles précalculées (économique : contenu surtout < 8 kHz). */
export function loopRate(ctx: BaseAudioContext): number {
  // 22,05 kHz est accepté partout (Chrome/Firefox acceptent 3–768 kHz).
  return Math.min(ctx.sampleRate, 22050);
}

/** Fréquence d'échantillonnage des sons brefs précalculés (pas, batterie). */
export function shotRate(ctx: BaseAudioContext): number {
  return Math.min(ctx.sampleRate, 44100);
}

/** Fréquence d'échantillonnage des coups de feu précalculés (énergie utile sous 16 kHz). */
export function gunRate(ctx: BaseAudioContext): number {
  return Math.min(ctx.sampleRate, 32000);
}
