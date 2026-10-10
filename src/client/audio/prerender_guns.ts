/**
 * Banques de coups de feu précalculées (DSP JS) : quelques variantes par arme,
 * rejouées ensuite avec une seule source tampon par tir. C'est ce qui permet
 * au pistolet-mitrailleur de tirer 12 coups par seconde, depuis plusieurs
 * tireurs à la fois, sans graphe de nœuds coûteux.
 *
 * Armes de 2085 : détonation cinétique classique (claquement, corps, grave,
 * queue) + couche « électrique » discrète (zap, grésillement, culasse
 * électromagnétique). Le fusil électromagnétique ajoute le sifflement
 * métallique du projectile et la recharge des condensateurs.
 * Les variantes lointaines : détonation étouffée + échos roulant entre les tours.
 */
import {
  Biquad, clamp, dcBlock, decayK, fadeOut, gunRate, loopRate, makeSoftClip, mulberry32, normalizePeak, PinkGen,
  readTable, Resonator, rr, type Rng, toBuffer, TWO_PI, wavetable,
} from './dsp';

export type GunBank = 'pistol' | 'smg' | 'rail' | 'shotgun' | 'turret';
export type GunFarBank = 'pistol_far' | 'smg_far' | 'rail_far' | 'shotgun_far' | 'turret_far';
export type GunBankName = GunBank | GunFarBank;

/** Glissando sinusoïdal bref (zap électrique, sifflement du projectile). */
interface Zap { at: number; f0: number; f1: number; sweep: number; tau: number; gain: number; partial?: number }
/** Clic mécanique : bruit passe-bande bref. */
interface Click { at: number; f: number; q: number; tau: number; gain: number }
/** Tintement métallique : résonateurs modaux excités par un bref bruit. [rapport, amplitude, tau] */
interface Ring { at: number; f: number; modes: ReadonlyArray<readonly [number, number, number]>; gain: number }
/** Sifflement tonal (servomoteur, recharge des condensateurs). */
interface Whine { at: number; f0: number; f1: number; dur: number; gain: number; vib?: number }

interface ShotSpec {
  dur: number;
  crackHp: number; crackTau: number; crackGain: number;
  bodyLp0: number; bodyLp1: number; bodySweep: number; bodyQ: number; bodyTau: number; bodyGain: number;
  boomF: number; boomTau: number; boomGain: number;
  thumpF0: number; thumpF1: number; thumpSweep: number; thumpTau: number; thumpGain: number;
  tailLp: number; tailTau: number; tailGain: number;
  drive: number;
  /** Second corps décalé (chevrotine). */
  flam?: number;
  /** Claquement supersonique (passe-haut très bref). */
  snap?: number;
  /** Grésillement électrique après le tir. */
  sizzle?: { dur: number; gain: number; density: number };
  /** Décharge de bobine (bourdonnement grave bref). */
  hum?: { f: number; tau: number; gain: number };
  zaps?: Zap[];
  clicks?: Click[];
  rings?: Ring[];
  whines?: Whine[];
  peak: number;
}

const SHOTS: Record<GunBank, ShotSpec> = {
  pistol: {
    dur: 0.9,
    crackHp: 2200, crackTau: 0.0055, crackGain: 2.6,
    bodyLp0: 4700, bodyLp1: 850, bodySweep: 0.09, bodyQ: 1.6, bodyTau: 0.034, bodyGain: 3.0,
    boomF: 270, boomTau: 0.05, boomGain: 2.2,
    thumpF0: 160, thumpF1: 50, thumpSweep: 0.1, thumpTau: 0.045, thumpGain: 0.6,
    tailLp: 1150, tailTau: 0.26, tailGain: 0.9,
    drive: 2.6,
    sizzle: { dur: 0.09, gain: 0.1, density: 0.25 },
    zaps: [{ at: 0, f0: 2900, f1: 520, sweep: 0.05, tau: 0.018, gain: 0.09 }],
    clicks: [{ at: 0.045, f: 2600, q: 1.6, tau: 0.004, gain: 0.32 }, { at: 0.063, f: 1900, q: 1.4, tau: 0.005, gain: 0.24 }],
    rings: [{ at: 0.045, f: 3100, modes: [[1, 1, 0.025], [1.47, 0.6, 0.018], [2.21, 0.3, 0.012]], gain: 0.06 }],
    peak: 0.92,
  },
  smg: {
    dur: 0.55,
    crackHp: 2600, crackTau: 0.0042, crackGain: 2.4,
    bodyLp0: 4200, bodyLp1: 1100, bodySweep: 0.05, bodyQ: 1.5, bodyTau: 0.022, bodyGain: 2.6,
    boomF: 320, boomTau: 0.034, boomGain: 1.7,
    thumpF0: 180, thumpF1: 70, thumpSweep: 0.05, thumpTau: 0.028, thumpGain: 0.45,
    tailLp: 1400, tailTau: 0.15, tailGain: 0.6,
    drive: 2.4,
    sizzle: { dur: 0.04, gain: 0.08, density: 0.3 },
    zaps: [{ at: 0, f0: 1500, f1: 300, sweep: 0.03, tau: 0.012, gain: 0.13, partial: 0.45 }],
    clicks: [{ at: 0.024, f: 3000, q: 1.5, tau: 0.003, gain: 0.28 }],
    peak: 0.9,
  },
  rail: {
    dur: 1.4,
    crackHp: 3000, crackTau: 0.003, crackGain: 3.2,
    bodyLp0: 6000, bodyLp1: 1200, bodySweep: 0.06, bodyQ: 1.4, bodyTau: 0.024, bodyGain: 2.4,
    boomF: 200, boomTau: 0.07, boomGain: 2.0,
    thumpF0: 120, thumpF1: 38, thumpSweep: 0.15, thumpTau: 0.08, thumpGain: 0.85,
    tailLp: 1700, tailTau: 0.5, tailGain: 0.85,
    drive: 2.8,
    snap: 1.3,
    sizzle: { dur: 0.25, gain: 0.09, density: 0.15 },
    hum: { f: 100, tau: 0.06, gain: 0.22 },
    zaps: [
      { at: 0.002, f0: 5200, f1: 1100, sweep: 0.35, tau: 0.13, gain: 0.16, partial: 0.35 },
      { at: 0.004, f0: 3900, f1: 820, sweep: 0.4, tau: 0.1, gain: 0.08 },
    ],
    rings: [{ at: 0.002, f: 4300, modes: [[1, 1, 0.09], [2.76, 0.5, 0.05], [5.4, 0.25, 0.03]], gain: 0.1 }],
    whines: [{ at: 0.28, f0: 700, f1: 3400, dur: 0.75, gain: 0.045, vib: 0.012 }],
    peak: 0.92,
  },
  shotgun: {
    dur: 1.3,
    crackHp: 1500, crackTau: 0.008, crackGain: 2.2,
    bodyLp0: 3300, bodyLp1: 480, bodySweep: 0.1, bodyQ: 1.6, bodyTau: 0.065, bodyGain: 3.4,
    flam: 0.6,
    boomF: 190, boomTau: 0.09, boomGain: 3.4,
    thumpF0: 120, thumpF1: 38, thumpSweep: 0.18, thumpTau: 0.08, thumpGain: 0.9,
    tailLp: 800, tailTau: 0.4, tailGain: 1.1,
    drive: 3.2,
    clicks: [{ at: 0.34, f: 1800, q: 1.4, tau: 0.006, gain: 0.3 }, { at: 0.43, f: 2500, q: 1.6, tau: 0.005, gain: 0.34 }],
    whines: [{ at: 0.33, f0: 900, f1: 1500, dur: 0.1, gain: 0.025 }],
    peak: 0.92,
  },
  turret: {
    dur: 0.75,
    crackHp: 1800, crackTau: 0.005, crackGain: 2.4,
    bodyLp0: 3600, bodyLp1: 650, bodySweep: 0.06, bodyQ: 1.5, bodyTau: 0.035, bodyGain: 3.0,
    boomF: 160, boomTau: 0.06, boomGain: 2.8,
    thumpF0: 115, thumpF1: 45, thumpSweep: 0.08, thumpTau: 0.05, thumpGain: 0.9,
    tailLp: 950, tailTau: 0.2, tailGain: 0.8,
    drive: 2.8,
    sizzle: { dur: 0.05, gain: 0.11, density: 0.3 },
    zaps: [{ at: 0, f0: 2200, f1: 400, sweep: 0.04, tau: 0.016, gain: 0.11 }],
    clicks: [{ at: 0.035, f: 2200, q: 1.3, tau: 0.004, gain: 0.24 }],
    whines: [{ at: 0.03, f0: 1700, f1: 1900, dur: 0.06, gain: 0.022 }],
    peak: 0.92,
  },
};

interface FarSpec {
  dur: number;
  /** Multiplicateur des fréquences (calibre). */
  low: number;
  reportTau: number; boomTau: number; rumbleTau: number;
  /** Claquement lointain encore audible (projectile supersonique). */
  crack?: number;
  /** Sifflement magnétique lointain. */
  zing?: number;
  echoes: number;
  /** Multiplicateur des délais d'écho. */
  echoGap: number;
  peak: number;
}

const FARS: Record<GunFarBank, FarSpec> = {
  pistol_far: { dur: 1.9, low: 1, reportTau: 0.05, boomTau: 0.065, rumbleTau: 0.4, echoes: 4, echoGap: 1, peak: 0.8 },
  smg_far: { dur: 1.2, low: 1.12, reportTau: 0.035, boomTau: 0.045, rumbleTau: 0.25, echoes: 3, echoGap: 0.8, peak: 0.8 },
  rail_far: { dur: 2.2, low: 1.25, reportTau: 0.05, boomTau: 0.07, rumbleTau: 0.55, crack: 0.9, zing: 0.07, echoes: 4, echoGap: 1.1, peak: 0.8 },
  shotgun_far: { dur: 2.0, low: 0.75, reportTau: 0.07, boomTau: 0.09, rumbleTau: 0.4, echoes: 4, echoGap: 1, peak: 0.8 },
  turret_far: { dur: 1.5, low: 0.85, reportTau: 0.05, boomTau: 0.06, rumbleTau: 0.35, echoes: 3, echoGap: 0.9, peak: 0.8 },
};

/** Nombre de variantes par banque (la vitesse de lecture varie aussi à chaque tir). */
export const GUN_VARIANTS: Record<GunBankName, number> = {
  pistol: 5, smg: 6, rail: 3, shotgun: 3, turret: 4,
  pistol_far: 3, smg_far: 3, rail_far: 3, shotgun_far: 3, turret_far: 3,
};

const SILENT = 1e-5;
const YIELD_MASK = 2047;
/** Bourdonnement de bobine : impair, un peu carré. */
const HUM_TABLE = wavetable([[1, 1, 0], [3, 0.33, 0], [5, 0.15, 0]], 1024);

function* renderShot(fs: number, rng: Rng, S: ShotSpec): Generator<undefined, Float32Array<ArrayBuffer>, unknown> {
  const jit = (a: number): number => 1 + (rng() * 2 - 1) * a;
  const p = jit(0.04);
  const dj = jit(0.12);
  const len = Math.floor(S.dur * fs);
  const out = new Float32Array(len);
  const pink = new PinkGen();

  const crackHp = Biquad.highpass(fs, S.crackHp * p, 0.7);
  const bodyLp = Biquad.lowpass(fs, S.bodyLp0 * p, S.bodyQ);
  const boomBp = Biquad.bandpass(fs, S.boomF * p, 0.8);
  const tailLp = Biquad.lowpass(fs, S.tailLp * p, 0.6);
  const snapHp = Biquad.highpass(fs, 5500, 0.8);
  const sizHp = Biquad.highpass(fs, 5000, 0.7);

  const kCrack = decayK(fs, S.crackTau * dj), kBody = decayK(fs, S.bodyTau * dj), kBoom = decayK(fs, S.boomTau * dj);
  const kThump = decayK(fs, S.thumpTau * dj), kTail = decayK(fs, S.tailTau * dj), kSnap = decayK(fs, 0.0015);
  const crackA = Math.max(1, Math.floor(0.0004 * fs));
  const bodyA = Math.max(1, Math.floor(0.0008 * fs));
  const boomA = Math.max(1, Math.floor(0.001 * fs));
  const tailStart = Math.floor(0.004 * fs);
  const tailA = Math.max(1, Math.floor(0.012 * fs));
  let eCrack = S.crackGain * jit(0.1), eBody = S.bodyGain, eBoom = S.boomGain, eThump = S.thumpGain;
  let eTail = S.tailGain, eSnap = S.snap ?? 0;
  const flamI = S.flam ? Math.floor(rr(rng, 0.004, 0.009) * fs) : len;
  let eFlam = S.flam ? S.bodyGain * S.flam : 0;

  const sweepN = Math.max(1, Math.floor(S.bodySweep * fs));
  const bodyRatio = Math.pow(S.bodyLp1 / S.bodyLp0, 32 / sweepN);
  let bodyCut = S.bodyLp0 * p;
  const thumpN = Math.max(1, Math.floor(S.thumpSweep * fs));
  const thumpStep = Math.pow(S.thumpF1 / S.thumpF0, 1 / thumpN);
  let thumpF = S.thumpF0 * p;
  let thumpPh = 0;
  const clip = makeSoftClip(S.drive);

  const sizN = S.sizzle ? Math.floor(S.sizzle.dur * fs) : 0;
  const humN = S.hum ? Math.floor(S.hum.tau * 8 * fs) : 0;
  const kHum = S.hum ? decayK(fs, S.hum.tau) : 1;
  let eHum = S.hum ? S.hum.gain : 0;
  let humPh = 0;

  for (let i = 0; i < len; i++) {
    if ((i & 31) === 0 && i < sweepN) {
      bodyCut *= bodyRatio;
      bodyLp.set('lp', fs, bodyCut, S.bodyQ);
    }
    const w = rng() * 2 - 1;
    const pk = pink.next(w);
    let pre = 0;
    if (eCrack > SILENT) {
      pre += crackHp.process(w) * eCrack * (i < crackA ? i / crackA : 1);
      eCrack *= kCrack;
    }
    if (eBody > SILENT || eFlam > SILENT) {
      let e = eBody * (i < bodyA ? i / bodyA : 1);
      if (i >= flamI) { e += eFlam; eFlam *= kBody; }
      pre += bodyLp.process(w) * e;
      eBody *= kBody;
    }
    if (eBoom > SILENT) {
      pre += boomBp.process(pk) * eBoom * (i < boomA ? i / boomA : 1);
      eBoom *= kBoom;
    }
    if (eThump > SILENT) {
      if (i < thumpN) thumpF *= thumpStep;
      thumpPh += thumpF / fs;
      if (thumpPh >= 1) thumpPh -= 1;
      pre += Math.sin(TWO_PI * thumpPh) * eThump;
      eThump *= kThump;
    }
    let x = pre !== 0 ? clip(clamp(pre, -1, 1)) * 0.6 : 0;
    // Queue (hors saturation, reste douce).
    if (i >= tailStart && eTail > SILENT) {
      const k = i - tailStart;
      x += tailLp.process(pk) * eTail * (k < tailA ? k / tailA : 1);
      if (k >= tailA) eTail *= kTail;
    }
    if (eSnap > SILENT) { x += snapHp.process(w) * eSnap; eSnap *= kSnap; }
    if (i < sizN && S.sizzle) {
      const u = 1 - i / sizN;
      x += sizHp.process(rng() < S.sizzle.density ? w : 0) * S.sizzle.gain * u * u;
    }
    if (i < humN && S.hum) {
      humPh += (S.hum.f * p) / fs;
      x += readTable(HUM_TABLE, humPh) * eHum;
      eHum *= kHum;
    }
    out[i] = x;
    if ((i & YIELD_MASK) === YIELD_MASK) yield;
  }

  // Couches ponctuelles ajoutées sur leur seule fenêtre active.
  for (const z of S.zaps ?? []) {
    const i0 = Math.floor(z.at * fs);
    const n = Math.min(len - i0, Math.floor((z.tau * 7 + 0.002) * fs));
    const sw = Math.max(1, Math.floor(z.sweep * fs));
    const step = Math.pow(z.f1 / z.f0, 1 / sw);
    const k = decayK(fs, z.tau * dj);
    const aN = Math.max(1, Math.floor(0.001 * fs));
    let e = z.gain * jit(0.15);
    let ph = 0, ph2 = 0;
    let f = z.f0 * p;
    for (let i = 0; i < n; i++) {
      if (i < sw) f *= step;
      ph += f / fs; if (ph >= 1) ph -= 1;
      let y = Math.sin(TWO_PI * ph);
      if (z.partial) { ph2 += (f * 2.76) / fs; if (ph2 >= 1) ph2 -= 1; y += Math.sin(TWO_PI * ph2) * z.partial; }
      out[i0 + i] += y * e * (i < aN ? i / aN : 1);
      e *= k;
    }
    yield;
  }
  const bp = new Biquad();
  for (const c of S.clicks ?? []) {
    const i0 = Math.floor((c.at + rr(rng, -0.004, 0.004)) * fs);
    const n = Math.min(len - i0, Math.floor(c.tau * 9 * fs));
    bp.set('bp', fs, c.f * p * jit(0.08), c.q);
    const k = decayK(fs, c.tau);
    const aN = Math.max(1, Math.floor(0.0003 * fs));
    let e = c.gain * 2.2 * jit(0.15);
    for (let i = 0; i < n; i++) {
      out[i0 + i] += bp.process(rng() * 2 - 1) * e * (i < aN ? i / aN : 1);
      e *= k;
    }
  }
  for (const rg of S.rings ?? []) {
    const i0 = Math.floor(rg.at * fs);
    const f = rg.f * p * jit(0.06);
    const bank = rg.modes.map(([ratio, a, tau]) => ({ r: new Resonator(fs, f * ratio, tau * dj), a }));
    const maxTau = Math.max(...rg.modes.map((m) => m[2]));
    const n = Math.min(len - i0, Math.floor(maxTau * dj * 7 * fs));
    const excN = Math.max(2, Math.floor(0.0008 * fs));
    for (let i = 0; i < n; i++) {
      const exc = i < excN ? (rng() * 2 - 1) * (1 - i / excN) : 0;
      let y = 0;
      for (const m of bank) y += m.r.process(exc) * m.a;
      out[i0 + i] += y * rg.gain * 3;
    }
    yield;
  }
  for (const wh of S.whines ?? []) {
    const i0 = Math.floor(wh.at * fs);
    const n = Math.min(len - i0, Math.floor(wh.dur * fs));
    const step = Math.pow(wh.f1 / wh.f0, 1 / Math.max(1, n));
    let f = wh.f0 * p;
    let ph = 0;
    let vib = 1;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      if (wh.vib && (i & 31) === 0) vib = 1 + wh.vib * Math.sin((TWO_PI * 7 * i) / fs);
      f *= step;
      ph += (f * vib) / fs;
      if (ph >= 1) ph -= 1;
      // Montée rapide, extinction progressive.
      const r = 1 - (u - 0.15) / 0.85;
      const env = u < 0.15 ? u / 0.15 : r * Math.sqrt(r);
      out[i0 + i] += Math.sin(TWO_PI * ph) * wh.gain * env;
      if ((i & YIELD_MASK) === YIELD_MASK) yield;
    }
  }
  dcBlock(out, fs, 20);
  fadeOut(out, Math.floor(0.012 * fs));
  normalizePeak(out, S.peak);
  return out;
}

/** Délais [min, max] et gains des échos successifs entre les façades. */
const ECHOES: ReadonlyArray<readonly [number, number, number]> = [
  [0.11, 0.2, 1.1], [0.3, 0.48, 0.7], [0.6, 0.85, 0.42], [0.95, 1.3, 0.22],
];

function* renderFar(fs: number, rng: Rng, F: FarSpec): Generator<undefined, Float32Array<ArrayBuffer>, unknown> {
  const p = 1 + (rng() * 2 - 1) * 0.06;
  const low = F.low * p;
  const len = Math.floor(F.dur * fs);
  const out = new Float32Array(len);
  const pink = new PinkGen();
  const repLp = Biquad.lowpass(fs, 900 * low, 0.7);
  const repPk = Biquad.peaking(fs, 420 * low, 1, 6);
  const boomBp = Biquad.bandpass(fs, 240 * low, 0.8);
  const echoBp = Biquad.bandpass(fs, 420 * low, 0.7);
  const crackBp = Biquad.bandpass(fs, 1700 * p, 1.2);
  const rumLp = Biquad.lowpass(fs, 500 * F.low, 0.6);
  const kRep = decayK(fs, F.reportTau), kBoom = decayK(fs, F.boomTau), kThump = decayK(fs, 0.08);
  const kRum = decayK(fs, F.rumbleTau), kCrack = decayK(fs, 0.004);
  const repA = Math.floor(0.003 * fs), boomA = Math.floor(0.004 * fs), rumA = Math.floor(0.03 * fs), rumStart = Math.floor(0.01 * fs);
  let eRep = 2.6, eBoom = 2.2, eThump = 0.3, eRum = 0.8, eCrack = F.crack ?? 0;
  let thPh = 0;
  const thN = Math.floor(0.2 * fs);
  let thF = 90 * low;
  const thStep = Math.pow(42 / (90 * low), 1 / thN);
  const clip = makeSoftClip(1.8);
  // Échos : une seule source filtrée, plusieurs enveloppes.
  const echoes = ECHOES.slice(0, F.echoes).map(([a, b, g]) => ({
    i0: Math.floor(rr(rng, a, b) * F.echoGap * fs), g, k: decayK(fs, rr(rng, 0.06, 0.12)), aN: Math.floor(0.012 * fs), e: 0,
  }));
  let brown = 0;
  for (let i = 0; i < len; i++) {
    const w = rng() * 2 - 1;
    const pk = pink.next(w);
    brown = (brown + 0.02 * w) / 1.02;
    let pre = 0;
    if (eRep > SILENT) { pre += repPk.process(repLp.process(w)) * eRep * (i < repA ? i / repA : 1); eRep *= kRep; }
    if (eBoom > SILENT) { pre += boomBp.process(pk) * eBoom * (i < boomA ? i / boomA : 1); eBoom *= kBoom; }
    if (eThump > SILENT) {
      if (i < thN) thF *= thStep;
      thPh += thF / fs; if (thPh >= 1) thPh -= 1;
      pre += Math.sin(TWO_PI * thPh) * eThump * (i < boomA ? i / boomA : 1);
      eThump *= kThump;
    }
    let x = pre !== 0 ? clip(clamp(pre, -1, 1)) * 0.7 : 0;
    if (eCrack > SILENT) { x += crackBp.process(w) * eCrack; eCrack *= kCrack; }
    let env = 0;
    for (const e of echoes) {
      if (i < e.i0) continue;
      const k = i - e.i0;
      if (k < e.aN) e.e = e.g * (k / e.aN);
      else e.e *= e.k;
      env += e.e;
    }
    const ep = echoBp.process(pk);
    if (env > SILENT) x += ep * env;
    if (i >= rumStart && eRum > SILENT) {
      const k = i - rumStart;
      x += rumLp.process(brown * 3.5) * eRum * (k < rumA ? k / rumA : 1);
      if (k >= rumA) eRum *= kRum;
    }
    out[i] = x;
    if ((i & YIELD_MASK) === YIELD_MASK) yield;
  }
  if (F.zing) {
    const n = Math.floor(0.45 * fs);
    const k = decayK(fs, 0.1);
    const step = Math.pow(0.6, 1 / n);
    let e = F.zing, ph = 0, f = 1500 * p;
    for (let i = 0; i < n && i < len; i++) {
      f *= step;
      ph += f / fs;
      if (ph >= 1) ph -= 1;
      out[i] += Math.sin(TWO_PI * ph) * e;
      e *= k;
    }
  }
  dcBlock(out, fs, 20);
  fadeOut(out, Math.floor(0.02 * fs));
  normalizePeak(out, F.peak);
  return out;
}

const isFar = (b: GunBankName): b is GunFarBank => b.endsWith('_far');

/** Tâche génératrice : `count` variantes de la banque `bank`. */
export function* makeGunBank(ctx: BaseAudioContext, bank: GunBankName, seed: number): Generator<undefined, AudioBuffer[], unknown> {
  // Les variantes lointaines sont sourdes : 22 kHz suffisent.
  const fs = isFar(bank) ? loopRate(ctx) : gunRate(ctx);
  const rng = mulberry32(seed);
  const res: AudioBuffer[] = [];
  const count = GUN_VARIANTS[bank];
  for (let i = 0; i < count; i++) {
    const d = isFar(bank) ? yield* renderFar(fs, rng, FARS[bank]) : yield* renderShot(fs, rng, SHOTS[bank]);
    res.push(toBuffer(ctx, [d], fs));
    yield;
  }
  return res;
}
