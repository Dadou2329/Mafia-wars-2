/**
 * Batterie électronique précalculée pour la musique synthwave et les
 * jingles : grosse caisse, caisse claire à réverbération coupée (« gated
 * reverb » des années 80), clap, charleston fermé / ouvert façon 808, tom et
 * rimshot. À la lecture : une seule source tampon (+ un gain) par coup.
 */
import {
  Biquad, dcBlock, fadeOut, mulberry32, normalizePeak, type Rng, shotRate, softClip, toBuffer, TWO_PI,
} from './dsp';

export type DrumKind = 'kick' | 'snare' | 'clap' | 'hat' | 'openhat' | 'tom' | 'rim';
export type DrumKit = Record<DrumKind, AudioBuffer>;

function kick(fs: number, rng: Rng): Float32Array<ArrayBuffer> {
  const n = Math.floor(0.55 * fs);
  const d = new Float32Array(n);
  const click = Biquad.highpass(fs, 2500, 0.7);
  const aN = Math.max(1, Math.floor(0.0006 * fs));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    ph += (45 + 115 * Math.exp(-t / 0.028)) / fs;
    let x = Math.sin(TWO_PI * ph) * Math.exp(-t / 0.17) * (i < aN ? i / aN : 1);
    x += click.process(rng() * 2 - 1) * Math.exp(-t / 0.0025) * 0.35;
    d[i] = softClip(x * 1.3, 1.6);
  }
  return d;
}

/** Corps de caisse claire / clap suivi d'une réverbération dense coupée net (« gate »). */
function gatedTail(fs: number, rng: Rng, d: Float32Array, start: number, level: number, gate: number): void {
  const lp = Biquad.lowpass(fs, 7000, 0.7);
  const hp = Biquad.highpass(fs, 300, 0.7);
  const i0 = Math.floor(start * fs);
  const rise = Math.floor(0.008 * fs);
  const gateN = Math.floor(gate * fs);
  const fall = Math.floor(0.025 * fs);
  for (let k = 0; k < gateN + fall && i0 + k < d.length; k++) {
    let env = k < rise ? k / rise : Math.exp(-(k - rise) / (0.6 * fs));
    if (k >= gateN) env *= 1 - (k - gateN) / fall;
    d[i0 + k] += hp.process(lp.process(rng() * 2 - 1)) * env * level;
  }
}

function snare(fs: number, rng: Rng): Float32Array<ArrayBuffer> {
  const n = Math.floor(0.5 * fs);
  const d = new Float32Array(n);
  const bp = Biquad.bandpass(fs, 1900, 0.7);
  const hp = Biquad.highpass(fs, 5000, 0.7);
  let ph1 = 0, ph2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    ph1 += (185 * (1 + 0.06 * Math.exp(-t / 0.01))) / fs;
    ph2 += 330 / fs;
    const w = rng() * 2 - 1;
    let x = Math.sin(TWO_PI * ph1) * Math.exp(-t / 0.045) * 0.55 + Math.sin(TWO_PI * ph2) * Math.exp(-t / 0.03) * 0.3;
    x += (bp.process(w) + hp.process(w) * 0.4) * Math.exp(-t / 0.07) * 1.1;
    d[i] = x;
  }
  gatedTail(fs, rng, d, 0.004, 0.32, 0.24);
  for (let i = 0; i < n; i++) d[i] = softClip(d[i], 1.4);
  return d;
}

function clap(fs: number, rng: Rng): Float32Array<ArrayBuffer> {
  const n = Math.floor(0.42 * fs);
  const d = new Float32Array(n);
  const bp = Biquad.bandpass(fs, 1100, 1.2);
  const tailBp = Biquad.bandpass(fs, 1200, 0.9);
  const bursts: ReadonlyArray<readonly [number, number]> = [[0, 0.6], [0.009, 0.7], [0.019, 0.8], [0.031, 1]];
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const w = rng() * 2 - 1;
    let env = 0;
    for (const [tb, a] of bursts) if (t >= tb) env += a * Math.exp(-(t - tb) / 0.005);
    let x = bp.process(w) * env * 1.6;
    if (t >= 0.031) x += tailBp.process(w) * Math.exp(-(t - 0.031) / 0.09) * 0.6;
    d[i] = x;
  }
  gatedTail(fs, rng, d, 0.031, 0.22, 0.18);
  return d;
}

/** Métal façon 808 : six carrés inharmoniques, passe-bande aigu. */
function hat(fs: number, rng: Rng, tau: number, dur: number): Float32Array<ArrayBuffer> {
  const n = Math.floor(dur * fs);
  const d = new Float32Array(n);
  const freqs = [205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => f * 1.7);
  const bp = Biquad.bandpass(fs, Math.min(10000, fs * 0.42), 1);
  const hp = Biquad.highpass(fs, 7000, 0.7);
  const air = Biquad.highpass(fs, 8000, 0.7);
  const aN = Math.max(1, Math.floor(0.0003 * fs));
  const ph = freqs.map(() => rng());
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < freqs.length; k++) {
      ph[k] += freqs[k] / fs;
      if (ph[k] >= 1) ph[k] -= 1;
      s += ph[k] < 0.5 ? 1 : -1;
    }
    const env = Math.exp(-i / (tau * fs)) * (i < aN ? i / aN : 1);
    d[i] = (hp.process(bp.process(s * 0.25)) + air.process(rng() * 2 - 1) * 0.3) * env;
  }
  return d;
}

function tom(fs: number, rng: Rng): Float32Array<ArrayBuffer> {
  const n = Math.floor(0.7 * fs);
  const d = new Float32Array(n);
  const lp = Biquad.lowpass(fs, 1500, 0.7);
  const aN = Math.max(1, Math.floor(0.001 * fs));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    ph += (105 * (1 + 0.45 * Math.exp(-t / 0.05))) / fs;
    d[i] = Math.sin(TWO_PI * ph) * Math.exp(-t / 0.22) * (i < aN ? i / aN : 1) + lp.process(rng() * 2 - 1) * Math.exp(-t / 0.02) * 0.25;
  }
  return d;
}

function rim(fs: number, rng: Rng): Float32Array<ArrayBuffer> {
  const n = Math.floor(0.12 * fs);
  const d = new Float32Array(n);
  const bp = Biquad.bandpass(fs, 3000, 1.2);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    d[i] = Math.sin(TWO_PI * 1750 * t) * Math.exp(-t / 0.012) * 0.5 + bp.process(rng() * 2 - 1) * Math.exp(-t / 0.006) * 1.2 +
      Math.sin(TWO_PI * 520 * t) * Math.exp(-t / 0.02) * 0.4;
  }
  return d;
}

const PEAKS: Record<DrumKind, number> = { kick: 0.95, snare: 0.9, clap: 0.85, hat: 0.7, openhat: 0.7, tom: 0.9, rim: 0.7 };

/** Tâche génératrice : la batterie complète. */
export function* makeDrumKit(ctx: BaseAudioContext): Generator<undefined, DrumKit, unknown> {
  const fs = Math.min(shotRate(ctx), 44100);
  const rng = mulberry32(808);
  const makers: Record<DrumKind, () => Float32Array<ArrayBuffer>> = {
    kick: () => kick(fs, rng),
    snare: () => snare(fs, rng),
    clap: () => clap(fs, rng),
    hat: () => hat(fs, rng, 0.02, 0.15),
    openhat: () => hat(fs, rng, 0.17, 0.6),
    tom: () => tom(fs, rng),
    rim: () => rim(fs, rng),
  };
  const kit = {} as DrumKit;
  for (const k of Object.keys(makers) as DrumKind[]) {
    const d = makers[k]();
    dcBlock(d, fs, 20);
    fadeOut(d, Math.floor(0.008 * fs));
    normalizePeak(d, PEAKS[k]);
    kit[k] = toBuffer(ctx, [d], fs);
    yield;
  }
  return kit;
}
