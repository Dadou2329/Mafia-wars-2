/**
 * Tampons des sons continus joués par `audio.loop()` : moteurs (voiture,
 * moto, poids lourd), ADAV, drone, alarme d'immeuble, sirène de police, et les
 * implants (treuil du grappin, raclement de glissade, bouclier, camouflage).
 *
 * Chaque tampon est mono et EXACTEMENT périodique : les composantes tonales
 * ont des fréquences multiples de 1/L, et tout ce qui passe par un filtre
 * récursif est calculé sur deux périodes dont on garde la seconde (régime
 * établi). La boucle se raccorde donc sans fondu ni clic. Le contenu est
 * limité en fréquence pour supporter une lecture accélérée ×2,5 (régime).
 */
import {
  addSine, Biquad, normalizeRmsCapped, PinkGen, periodicHz, periodicMod, readTable, Resonator, rr, type Rng, mulberry32,
  toBuffer, TWO_PI, wavetable, whiteNoise,
} from './dsp';
import type { BufferJob } from './reverb';
import type { LoopName } from './types';

const YIELD_MASK = 4095;

export function engineRate(ctx: BaseAudioContext): number {
  return Math.min(ctx.sampleRate, 24000);
}

/**
 * Somme d'harmoniques exactement périodique (phases aléatoires) : amps[h-1]
 * pour l'harmonique h, lue dans une table d'onde. La modulation de phase `pm`
 * (radians de la fondamentale) fait légèrement « flotter » toute la forme d'onde.
 */
function harmonics(N: number, fs: number, f0: number, amps: readonly number[], rng: Rng, pm?: Float32Array, pmDepth = 0): Float32Array<ArrayBuffer> {
  const d = new Float32Array(N);
  const ny = fs * 0.45;
  const parts: Array<[number, number, number]> = [];
  amps.forEach((a, k) => {
    if (a > 0 && f0 * (k + 1) < ny) parts.push([k + 1, a, rng() * TWO_PI]);
  });
  const tab = wavetable(parts);
  const inc = f0 / fs;
  const pd = pmDepth / TWO_PI;
  if (pm) for (let i = 0; i < N; i++) d[i] = readTable(tab, i * inc + pm[i] * pd);
  else for (let i = 0; i < N; i++) d[i] = readTable(tab, i * inc);
  return d;
}

/** Ton pur exactement périodique. */
function sine(N: number, fs: number, f: number, amp: number, rng: Rng): Float32Array<ArrayBuffer> {
  const d = new Float32Array(N);
  addSine(d, f, amp, fs, rng() * TWO_PI);
  return d;
}

/** Modulation d'amplitude périodique 1 + depth·sin (tableau d'une période de boucle). */
function amArray(N: number, fs: number, f: number, depth: number, ph = 0): Float32Array<ArrayBuffer> {
  const d = new Float32Array(N).fill(1);
  addSine(d, f, depth, fs, ph);
  return d;
}

/* ------------------------------------------------------------------ voiture (électrique / sustentation) */

function* engineCar(fs: number, rng: Rng): Generator<undefined, Float32Array<ArrayBuffer>, unknown> {
  const L = 3;
  const N = L * fs;
  const f0 = periodicHz(55, L);
  const mod = periodicMod(N, L, rng, 4);
  yield;
  const hum = harmonics(N, fs, f0, [1, 0.5, 0.33, 0.2, 0.12, 0.07], rng, mod, 0.25);
  yield;
  // Sifflement d'onduleur du moteur électrique, calé sur le régime.
  const whine = harmonics(N, fs, f0, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.045], rng);
  yield;
  const noise = whiteNoise(N, rng);
  yield;
  const am = amArray(N, fs, periodicHz(f0 / 4, L), 0.15);
  const rumble = Biquad.lowpass(fs, 120, 0.7);
  const fan = Biquad.bandpass(fs, 1100, 1.2);
  const tyre = Biquad.bandpass(fs, 420, 0.7);
  const out = Biquad.lowpass(fs, 4500, 0.7);
  const d = new Float32Array(N);
  for (let i = 0; i < 2 * N; i++) {
    const k = i % N;
    const w = noise[k];
    const m = mod[k];
    let x = hum[k] * am[k] * 0.5 + whine[k];
    x += rumble.process(w) * 1.6 + fan.process(w) * 0.18 * (0.8 + 0.2 * m) + tyre.process(w) * 0.07;
    x = out.process(x);
    if (i >= N) d[k] = x;
    if ((i & YIELD_MASK) === YIELD_MASK) yield;
  }
  return d;
}

/* ------------------------------------------------------------------ moto (électrique, rageuse) */

function* engineMoto(fs: number, rng: Rng): Generator<undefined, Float32Array<ArrayBuffer>, unknown> {
  const L = 2;
  const N = L * fs;
  const f0 = periodicHz(82.5, L);
  const amps: number[] = [];
  for (let h = 1; h <= 14; h++) amps.push((1 / Math.pow(h, 0.9)) * (h % 2 ? 1.3 : 0.8));
  const mod = periodicMod(N, L, rng, 5);
  yield;
  const buzz = harmonics(N, fs, f0, amps, rng, mod, 0.2);
  yield;
  const whine = sine(N, fs, f0 * 12, 0.06, rng);
  const noise = whiteNoise(N, rng);
  yield;
  const am = amArray(N, fs, periodicHz(f0 / 2, L), 0.3);
  // Impulsions d'allumage (demi-sinusoïde redressée à la fondamentale) qui hachent le souffle.
  const pulse = new Float32Array(N);
  addSine(pulse, f0, 1, fs);
  const formant = Biquad.bandpass(fs, 650, 1.1);
  const toneLp = Biquad.lowpass(fs, 3000, 0.7);
  const rasp = Biquad.bandpass(fs, 2200, 0.9);
  const rumble = Biquad.lowpass(fs, 150, 0.7);
  const out = Biquad.lowpass(fs, 5000, 0.7);
  const d = new Float32Array(N);
  for (let i = 0; i < 2 * N; i++) {
    const k = i % N;
    const w = noise[k];
    const b = buzz[k] * am[k];
    let x = formant.process(b) * 1.6 + toneLp.process(b) * 0.35;
    const pz = pulse[k] > 0 ? pulse[k] : 0;
    x += rasp.process(w * (0.4 + 0.6 * pz)) * 0.25 + whine[k] + rumble.process(w) * 1.2;
    x = out.process(x);
    if (i >= N) d[k] = x;
    if ((i & YIELD_MASK) === YIELD_MASK) yield;
  }
  return d;
}

/* ------------------------------------------------------------------ poids lourd (fourgon blindé, convoi) */

function* engineHeavy(fs: number, rng: Rng): Generator<undefined, Float32Array<ArrayBuffer>, unknown> {
  const L = 3;
  const N = L * fs;
  const f0 = periodicHz(100 / 3, L);
  const amps: number[] = [];
  for (let h = 1; h <= 18; h++) amps.push((h >= 2 && h <= 6 ? 1.4 : 1) / Math.pow(h, 0.7));
  const mod = periodicMod(N, L, rng, 4);
  yield;
  const chug = harmonics(N, fs, f0, amps, rng, mod, 0.3);
  yield;
  const whine = harmonics(N, fs, f0, [0, 0, 0, 0, 0, 0, 0.05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.02], rng);
  yield;
  const noise = whiteNoise(N, rng);
  yield;
  // Cliquetis de carrosserie : excitations brèves à des instants fixes (donc périodiques).
  const exc = new Float32Array(N);
  const nr = Math.floor(8 * L);
  for (let r = 0; r < nr; r++) {
    const i0 = Math.floor(rng() * N);
    const a = rr(rng, 0.2, 1);
    for (let j = 0; j < 24; j++) exc[(i0 + j) % N] += (rng() * 2 - 1) * a * (1 - j / 24);
  }
  const am1 = amArray(N, fs, periodicHz(f0 / 2, L), 0.35);
  const am2 = amArray(N, fs, periodicHz(f0 / 4, L), 0.15, 1);
  yield;
  const res1 = new Resonator(fs, 1700, 0.015);
  const res2 = new Resonator(fs, 2900, 0.012);
  const rumble = Biquad.lowpass(fs, 80, 0.7);
  const body = Biquad.lowpass(fs, 1400, 0.7);
  const out = Biquad.lowpass(fs, 2800, 0.7);
  const d = new Float32Array(N);
  for (let i = 0; i < 2 * N; i++) {
    const k = i % N;
    const w = noise[k];
    let x = body.process(chug[k] * am1[k] * am2[k]) * 0.5 + whine[k];
    x += rumble.process(w) * 2.6 + (res1.process(exc[k]) + res2.process(exc[k]) * 0.7) * 0.022;
    x = out.process(x);
    if (i >= N) d[k] = x;
    if ((i & YIELD_MASK) === YIELD_MASK) yield;
  }
  return d;
}

/* ------------------------------------------------------------------ ADAV (avion à décollage vertical) */

function* vtolLoop(fs: number, rng: Rng): Generator<undefined, Float32Array<ArrayBuffer>, unknown> {
  const L = 3;
  const N = L * fs;
  const mod = periodicMod(N, L, rng, 3);
  yield;
  // Turbine : quatre tons aigus (avec battement) qui flottent ensemble.
  const turb = new Float32Array(N);
  const tones: ReadonlyArray<readonly [number, number]> = [[2200, 0.12], [2213.33, 0.1], [3300, 0.06], [4400, 0.03]];
  for (const [f, a] of tones) {
    const tab = wavetable([[1, a, rng() * TWO_PI]], 512);
    const inc = periodicHz(f, L) / fs;
    for (let i = 0; i < N; i++) turb[i] += readTable(tab, i * inc + mod[i] * 0.13);
    yield;
  }
  const noise = whiteNoise(N, rng);
  const pinkA = new PinkGen();
  const amRotor = amArray(N, fs, periodicHz(18, L), 0.7);
  const roar = Biquad.lowpass(fs, 2500, 0.6);
  const mid = Biquad.bandpass(fs, 600, 0.8);
  const thrum = Biquad.bandpass(fs, 180, 1);
  const rumble = Biquad.lowpass(fs, 70, 0.7);
  const out = Biquad.lowpass(fs, 7000, 0.7);
  const d = new Float32Array(N);
  // Bruit rose rendu périodique : filtre appliqué sur deux périodes, on garde la seconde.
  const pk = new Float32Array(N);
  for (let i = 0; i < 2 * N; i++) {
    const v = pinkA.next(noise[i % N]);
    if (i >= N) pk[i - N] = v;
    if ((i & 32767) === 32767) yield;
  }
  for (let i = 0; i < 2 * N; i++) {
    const k = i % N;
    const p = pk[k];
    let x = (roar.process(p) + mid.process(p) * 0.5) * (0.85 + 0.15 * mod[k]);
    x += thrum.process(p) * amRotor[k] * 0.9 + turb[k] + rumble.process(noise[k]) * 2;
    x = out.process(x);
    if (i >= N) d[k] = x;
    if ((i & YIELD_MASK) === YIELD_MASK) yield;
  }
  return d;
}

/* ------------------------------------------------------------------ drone (quadrirotor) */

function* droneLoop(fs: number, rng: Rng): Generator<undefined, Float32Array<ArrayBuffer>, unknown> {
  const L = 2;
  const N = L * fs;
  const rotor = new Float32Array(N);
  const amps = [1, 1.4, 0.33, 0.25, 0.2, 0.17];
  for (const f of [190, 193.5, 197.5, 201]) {
    const mod = periodicMod(N, L, rng, 6);
    const h = harmonics(N, fs, periodicHz(f, L), amps, rng, mod, 0.8);
    for (let i = 0; i < N; i++) rotor[i] += h[i] * 0.25;
    yield;
  }
  const whine = sine(N, fs, periodicHz(1400, L), 0.03, rng);
  const whine2 = sine(N, fs, periodicHz(2800, L), 0.012, rng);
  const noise = whiteNoise(N, rng);
  const lp = Biquad.lowpass(fs, 3500, 0.7);
  const air = Biquad.bandpass(fs, 2600, 0.8);
  const d = new Float32Array(N);
  for (let i = 0; i < 2 * N; i++) {
    const k = i % N;
    const x = lp.process(rotor[k]) + whine[k] + whine2[k] + air.process(noise[k]) * 0.05;
    if (i >= N) d[k] = x;
    if ((i & YIELD_MASK) === YIELD_MASK) yield;
  }
  return d;
}

/* ------------------------------------------------------------------ alarme d'immeuble */

function* alarmLoop(fs: number, _rng: Rng): Generator<undefined, Float32Array<ArrayBuffer>, unknown> {
  // Deux tons alternés (aigu / grave), 0,25 s chacun, 4 cycles par boucle de 2 s.
  const L = 2;
  const N = L * fs;
  const seg = Math.floor(0.25 * fs);
  const glide = Math.floor(0.002 * fs);
  const hi = 960, lo = 770;
  const phase = new Float64Array(N);
  let ph = 0;
  for (let i = 0; i < N; i++) {
    const s = Math.floor(i / seg);
    const into = i - s * seg;
    const cur = s % 2 ? lo : hi;
    const prev = s % 2 ? hi : lo;
    const f = into < glide && i > 0 ? prev + ((cur - prev) * into) / glide : cur;
    phase[i] = ph;
    ph += f / fs;
  }
  // Raccord exact : on étire très légèrement les phases pour un nombre entier de cycles.
  const sc = Math.round(ph) / ph;
  const d = new Float32Array(N);
  const tone = new Float32Array(N);
  // Carré à bande limitée (piézo strident).
  const sq = wavetable([[1, 1, 0], [3, 1 / 3, 0], [5, 1 / 5, 0], [7, 1 / 7, 0], [9, 1 / 9, 0]]);
  for (let i = 0; i < N; i++) tone[i] = readTable(sq, phase[i] * sc);
  yield;
  const lp = Biquad.lowpass(fs, 6000, 0.7);
  const body = Biquad.peaking(fs, 2000, 1.2, 4);
  for (let i = 0; i < 2 * N; i++) {
    const k = i % N;
    const x = Math.tanh(body.process(lp.process(tone[k])) * 1.3);
    if (i >= N) d[k] = x;
    if ((i & YIELD_MASK) === YIELD_MASK) yield;
  }
  return d;
}

/* ------------------------------------------------------------------ sirène (NYPD 2085) */

function* sirenLoop(fs: number, _rng: Rng): Generator<undefined, Float32Array<ArrayBuffer>, unknown> {
  // 0–3 s : « wail » (montée, puis descente lente) ; 3–6 s : « yelp » (9 aller-retour rapides).
  const L = 6;
  const N = L * fs;
  const freq = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / fs;
    let f: number;
    if (t < 1.2) { const u = t / 1.2; f = 620 + (1450 - 620) * (1 - (1 - u) * (1 - u)); }
    else if (t < 3) { const u = (t - 1.2) / 1.8; f = 1450 - (1450 - 620) * Math.pow(u, 1.4); }
    else {
      const c = ((t - 3) * 3) % 1;
      f = c < 0.48 ? 700 * Math.pow(1500 / 700, c / 0.48) : 1500 * Math.pow(700 / 1500, (c - 0.48) / 0.52);
    }
    freq[i] = f;
    if ((i & 32767) === 32767) yield;
  }
  // Raccord exact : nombre entier de cycles sur la boucle.
  let total = 0;
  for (let i = 0; i < N; i++) total += freq[i] / fs;
  const sc = Math.round(total) / total;
  const main = new Float32Array(N);
  const rumbler = new Float32Array(N);
  // Dent de scie douce (6 harmoniques) + « rumbler » grave (carré à f/4).
  const saw = wavetable([[1, 1, 0], [2, 1 / 2, 0], [3, 1 / 3, 0], [4, 1 / 4, 0], [5, 1 / 5, 0], [6, 1 / 6, 0]]);
  const sq = wavetable([[1, 1, 0], [3, 1 / 3, 0], [5, 1 / 5, 0]]);
  let ph = 0;
  for (let i = 0; i < N; i++) {
    main[i] = readTable(saw, ph);
    rumbler[i] = readTable(sq, ph / 4);
    ph += (freq[i] * sc) / fs;
    if ((i & 32767) === 32767) yield;
  }
  yield;
  const horn = Biquad.bandpass(fs, 1100, 0.7);
  const presence = Biquad.peaking(fs, 2400, 1, 5);
  const rumLp = Biquad.lowpass(fs, 300, 0.7);
  const out = Biquad.lowpass(fs, 7000, 0.7);
  const d = new Float32Array(N);
  for (let i = 0; i < 2 * N; i++) {
    const k = i % N;
    let x = Math.tanh(presence.process(horn.process(main[k]) * 1.4 + main[k] * 0.15) * 1.5);
    x += rumLp.process(rumbler[k]) * 0.45;
    x = out.process(x);
    if (i >= N) d[k] = x;
    if ((i & YIELD_MASK) === YIELD_MASK) yield;
  }
  return d;
}

/* ------------------------------------------------------------------ implants */

/** Impulsions périodiques (cliquets) : n par boucle, décroissance exponentielle de constante tau. */
function pulseTrain(N: number, fs: number, n: number, tau: number): Float32Array<ArrayBuffer> {
  const d = new Float32Array(N);
  const step = N / n;
  const k = Math.exp(-1 / (tau * fs));
  for (let p = 0; p < n; p++) {
    const i0 = Math.floor(p * step);
    let a = 1;
    for (let j = 0; j < step && a > 1e-3; j++) {
      d[(i0 + j) % N] += a;
      a *= k;
    }
  }
  return d;
}

/** Treuil du grappin : moteur qui siffle, denture, cliquets du cabestan, câble qui file. */
function* grappleReelLoop(fs: number, rng: Rng): Generator<undefined, Float32Array<ArrayBuffer>, unknown> {
  const L = 2;
  const N = L * fs;
  const f0 = periodicHz(150, L);
  const mod = periodicMod(N, L, rng, 4);
  yield;
  const whine = harmonics(N, fs, f0, [1, 0.55, 0.35, 0.5, 0.2, 0.15, 0.1, 0.25, 0.08, 0.05, 0.04, 0.06], rng, mod, 0.3);
  yield;
  const gear = amArray(N, fs, periodicHz(f0 / 3, L), 0.25);
  const ratchet = pulseTrain(N, fs, 36, 0.012);
  const ticks = pulseTrain(N, fs, 36, 0.0008);
  const noise = whiteNoise(N, rng);
  yield;
  const hissBp = Biquad.bandpass(fs, 3200, 1.2);
  const tick = new Resonator(fs, 2600, 0.008);
  const rumble = Biquad.lowpass(fs, 90, 0.7);
  const out = Biquad.lowpass(fs, 7000, 0.7);
  const d = new Float32Array(N);
  for (let i = 0; i < 2 * N; i++) {
    const k = i % N;
    const w = noise[k];
    let x = whine[k] * gear[k] * 0.45 + hissBp.process(w) * (0.12 + 0.35 * ratchet[k]) + tick.process(ticks[k] * w) * 0.5 + rumble.process(w) * 1.1;
    x = out.process(x);
    if (i >= N) d[k] = x;
    if ((i & YIELD_MASK) === YIELD_MASK) yield;
  }
  return d;
}

/** Glissade : raclement granuleux (bruit en bandes modulé), étincelles qui crépitent, frottement grave. */
function* slideScrapeLoop(fs: number, rng: Rng): Generator<undefined, Float32Array<ArrayBuffer>, unknown> {
  const L = 2;
  const N = L * fs;
  const grit = periodicMod(N, L, rng, 48, 8);
  const slow = periodicMod(N, L, rng, 5);
  const noise = whiteNoise(N, rng);
  yield;
  // étincelles : excitations brèves à des instants fixes (donc périodiques)
  const exc = new Float32Array(N);
  for (let r = 0; r < 70; r++) {
    const i0 = Math.floor(rng() * N);
    const a = rr(rng, 0.2, 1);
    for (let j = 0; j < 10; j++) exc[(i0 + j) % N] += (rng() * 2 - 1) * a;
  }
  yield;
  const b1 = Biquad.bandpass(fs, 1600, 0.8);
  const b2 = Biquad.bandpass(fs, 3800, 1.5);
  const spark = new Resonator(fs, 4600, 0.002);
  const sparkHp = Biquad.highpass(fs, 2500, 0.7);
  const rumble = Biquad.lowpass(fs, 140, 0.7);
  const out = Biquad.lowpass(fs, 9000, 0.7);
  const d = new Float32Array(N);
  for (let i = 0; i < 2 * N; i++) {
    const k = i % N;
    const w = noise[k];
    const rough = 0.55 + 0.45 * Math.abs(grit[k]);
    let x = (b1.process(w) * 0.9 + b2.process(w) * 0.6) * rough * (0.85 + 0.15 * slow[k]);
    x += sparkHp.process(spark.process(exc[k])) * 0.12 + rumble.process(w) * 1.4;
    x = out.process(x);
    if (i >= N) d[k] = x;
    if ((i & YIELD_MASK) === YIELD_MASK) yield;
  }
  return d;
}

/** Bouclier d'énergie : bourdon électrique à battements lents, miroitement aigu, crépitements rares. */
function* shieldHumLoop(fs: number, rng: Rng): Generator<undefined, Float32Array<ArrayBuffer>, unknown> {
  const L = 2;
  const N = L * fs;
  const amps = [1, 0.6, 0.45, 0.3, 0.22, 0.15, 0.1, 0.08];
  const a = harmonics(N, fs, periodicHz(110, L), amps, rng);
  yield;
  const b = harmonics(N, fs, periodicHz(110.5, L), amps, rng);
  yield;
  const sh1 = sine(N, fs, periodicHz(1320, L), 0.035, rng);
  const sh2 = sine(N, fs, periodicHz(1980, L), 0.02, rng);
  const am1 = amArray(N, fs, periodicHz(3, L), 0.8);
  const am2 = amArray(N, fs, periodicHz(4.5, L), 0.8, 1.3);
  const exc = new Float32Array(N);
  for (let r = 0; r < 14; r++) {
    const i0 = Math.floor(rng() * N);
    for (let j = 0; j < 6; j++) exc[(i0 + j) % N] += (rng() * 2 - 1) * rr(rng, 0.3, 1);
  }
  yield;
  const crack = new Resonator(fs, 5200, 0.0015);
  const body = Biquad.lowpass(fs, 1800, 0.9);
  const out = Biquad.lowpass(fs, 6000, 0.7);
  const d = new Float32Array(N);
  for (let i = 0; i < 2 * N; i++) {
    const k = i % N;
    let x = body.process((a[k] + b[k]) * 0.35) + sh1[k] * am1[k] + sh2[k] * am2[k] + crack.process(exc[k]) * 0.08;
    x = out.process(x);
    if (i >= N) d[k] = x;
    if ((i & YIELD_MASK) === YIELD_MASK) yield;
  }
  return d;
}

/** Camouflage optique : souffle aérien qui respire, notes de verre en trémolo, pulsation grave. */
function* camoHumLoop(fs: number, rng: Rng): Generator<undefined, Float32Array<ArrayBuffer>, unknown> {
  const L = 3;
  const N = L * fs;
  const noise = whiteNoise(N, rng);
  const pinkG = new PinkGen();
  const pk = new Float32Array(N);
  for (let i = 0; i < 2 * N; i++) {
    const v = pinkG.next(noise[i % N]);
    if (i >= N) pk[i - N] = v;
    if ((i & 32767) === 32767) yield;
  }
  const breath = amArray(N, fs, periodicHz(0.667, L), 0.45);
  const glass = new Float32Array(N);
  for (const [f, ph] of [[880, 0], [1318.5, 1.7], [1760, 3.1]] as const) {
    const tone = sine(N, fs, periodicHz(f, L), 0.03, rng);
    const trem = amArray(N, fs, periodicHz(5, L), 0.6, ph);
    for (let i = 0; i < N; i++) glass[i] += tone[i] * trem[i];
    yield;
  }
  const throb = sine(N, fs, periodicHz(55, L), 0.12, rng);
  const throbAm = amArray(N, fs, periodicHz(1.333, L), 0.7);
  const air = Biquad.bandpass(fs, 2200, 0.8);
  const d = new Float32Array(N);
  for (let i = 0; i < 2 * N; i++) {
    const k = i % N;
    const x = air.process(pk[k]) * 0.8 * breath[k] + glass[k] + throb[k] * throbAm[k];
    if (i >= N) d[k] = x;
    if ((i & YIELD_MASK) === YIELD_MASK) yield;
  }
  return d;
}

const MAKERS: Record<LoopName, (fs: number, rng: Rng) => Generator<undefined, Float32Array<ArrayBuffer>, unknown>> = {
  engine_car: engineCar,
  engine_moto: engineMoto,
  engine_heavy: engineHeavy,
  vtol: vtolLoop,
  drone: droneLoop,
  alarm: alarmLoop,
  siren: sirenLoop,
  grapple_reel: grappleReelLoop,
  slide_scrape: slideScrapeLoop,
  shield_hum: shieldHumLoop,
  camo_hum: camoHumLoop,
};

const SEEDS: Record<LoopName, number> = {
  engine_car: 11, engine_moto: 22, engine_heavy: 33, vtol: 44, drone: 55, alarm: 66, siren: 77,
  grapple_reel: 88, slide_scrape: 99, shield_hum: 111, camo_hum: 122,
};

/** Tâche génératrice : tampon bouclable du son continu `name`. */
export function* makeLoopBuffer(ctx: BaseAudioContext, name: LoopName): BufferJob {
  const fs = engineRate(ctx);
  const d = yield* MAKERS[name](fs, mulberry32(SEEDS[name]));
  normalizeRmsCapped(d, 0.22, 0.95);
  return toBuffer(ctx, [d], fs);
}
