/**
 * Matière rendue une fois en AudioBuffers par DSP JS : variantes de pas (très
 * économiques à rejouer) et lits d'ambiance en boucle (rumeur de foule, pluie,
 * gouttes dans les flaques, fleuve, circulation lointaine, métro, ventilation
 * intérieure). Chaque fabrique est une tâche génératrice qui rend la main
 * régulièrement pour étaler le travail sur plusieurs images.
 */
import {
  Biquad, clamp, dcBlock, decayK, fadeOut, loopify, loopRate, mulberry32, normalizePeak, normalizeRms,
  OnePole, PinkGen, Resonator, rms, rr, type Rng, scale, shotRate, toBuffer, TWO_PI,
} from './dsp';
import type { BufferJob } from './reverb';

export type Surface = 'stone' | 'concrete' | 'metal' | 'wood' | 'carpet';

const panL = (pan: number): number => Math.cos((pan + 1) * Math.PI * 0.25);
const panR = (pan: number): number => Math.sin((pan + 1) * Math.PI * 0.25);

/** Normalise une paire stéréo au même gain (préserve l'image). */
function normalizePair(a: Float32Array, b: Float32Array, target: number): void {
  const r = Math.sqrt((rms(a) ** 2 + rms(b) ** 2) / 2);
  if (r < 1e-9) return;
  scale(a, target / r);
  scale(b, target / r);
}

/* ------------------------------------------------------------------ pas */

const STEP_DUR: Record<Surface, number> = { stone: 0.2, concrete: 0.22, metal: 0.38, wood: 0.24, carpet: 0.2 };

function footstep(surface: Surface, fs: number, rng: Rng): Float32Array<ArrayBuffer> {
  const len = Math.floor(STEP_DUR[surface] * fs);
  const out = new Float32Array(len);
  const toeI = Math.floor(rr(rng, 0.03, 0.06) * fs);
  const toeG = rr(rng, 0.25, 0.55);

  if (surface === 'stone') {
    // Talon sur dalle de pierre (halls, marbre) : clic franc, corps bref, pointe, un peu de grain.
    const clickBp = Biquad.bandpass(fs, rr(rng, 1500, 2500), 0.9);
    const bodyLp = Biquad.lowpass(fs, rr(rng, 380, 560), 0.9);
    const toeBp = Biquad.bandpass(fs, rr(rng, 2200, 3400), 1.2);
    const toeLp = Biquad.lowpass(fs, rr(rng, 500, 700), 0.8);
    const grit = Biquad.highpass(fs, 3200, 0.7);
    const w = (TWO_PI * rr(rng, 75, 105)) / fs;
    const kClick = decayK(fs, 0.0035), kBody = decayK(fs, 0.02), kThump = decayK(fs, 0.018);
    const kToeA = decayK(fs, 0.0025), kToeB = decayK(fs, 0.012), kGrit = decayK(fs, 0.05);
    const attN = Math.floor(0.0015 * fs);
    let eClick = 1, eBody = 1, eThump = 1, eToeA = 1, eToeB = 1, eGrit = 0.03;
    for (let i = 0; i < len; i++) {
      const n = rng() * 2 - 1;
      const att = i < attN ? i / attN : 1;
      let x = clickBp.process(n * eClick) * 1.6;
      x += bodyLp.process(n * att * eBody) * 2.3;
      x += Math.sin(w * i) * eThump * 0.3;
      if (i >= toeI) {
        x += toeBp.process(n * eToeA) * 1.6 * toeG;
        x += toeLp.process(n * eToeB) * 0.9 * toeG;
        eToeA *= kToeA; eToeB *= kToeB;
      }
      x += grit.process(rng() < eGrit ? n : 0) * 0.12;
      out[i] = x;
      eClick *= kClick; eBody *= kBody; eThump *= kThump; eGrit *= kGrit;
    }
  } else if (surface === 'concrete') {
    // Semelle de caoutchouc sur trottoir de béton : impact sourd et frottement granuleux.
    const bodyLp = Biquad.lowpass(fs, rr(rng, 320, 480), 0.9);
    const scuffBp = Biquad.bandpass(fs, rr(rng, 950, 1700), 0.8);
    const gritHp = Biquad.highpass(fs, rr(rng, 3000, 4200), 0.7);
    const toeLp = Biquad.lowpass(fs, rr(rng, 500, 800), 0.8);
    const toeBp = Biquad.bandpass(fs, rr(rng, 1600, 2400), 1.1);
    const w = (TWO_PI * rr(rng, 70, 95)) / fs;
    const kBody = decayK(fs, 0.022), kThump = decayK(fs, 0.02), kScuff = decayK(fs, rr(rng, 0.018, 0.034));
    const kGrit = decayK(fs, 0.045), kToe = decayK(fs, 0.012), kToeC = decayK(fs, 0.0035);
    const attN = Math.floor(0.002 * fs);
    const scuffI = Math.floor(0.004 * fs);
    let eBody = 1, eThump = 1, eScuff = 1, eGrit = 0.09, eToe = 1, eToeC = 1;
    for (let i = 0; i < len; i++) {
      const n = rng() * 2 - 1;
      const att = i < attN ? i / attN : 1;
      let x = bodyLp.process(n * att * eBody) * 2.4 + Math.sin(w * i) * eThump * att * 0.35;
      if (i >= scuffI) { x += scuffBp.process(n * eScuff * (0.55 + 0.45 * rng())) * 0.85; eScuff *= kScuff; }
      x += gritHp.process(rng() < eGrit ? n : 0) * 0.22;
      if (i >= toeI) {
        x += toeLp.process(n * eToe) * toeG + toeBp.process(n * eToeC) * 0.7 * toeG;
        eToe *= kToe; eToeC *= kToeC;
      }
      out[i] = x;
      eBody *= kBody; eThump *= kThump; eGrit *= kGrit;
    }
  } else if (surface === 'metal') {
    // Bottes sur caillebotis / escalier de secours : claquement, modes métalliques, cliquetis.
    const f0 = rr(rng, 170, 300);
    const modes: ReadonlyArray<readonly [number, number, number]> = [
      [1, 1, 0.16], [1.58, 0.7, 0.12], [2.31, 0.55, 0.09], [3.17, 0.4, 0.07], [4.43, 0.3, 0.05], [5.9, 0.2, 0.035],
    ];
    const bank = modes.map(([r, a, tau]) => ({ r: new Resonator(fs, f0 * r * rr(rng, 0.97, 1.03), tau * rr(rng, 0.8, 1.2)), a }));
    const excLp = Biquad.lowpass(fs, 3500, 0.7);
    const thudLp = Biquad.lowpass(fs, 260, 0.8);
    const clickBp = Biquad.bandpass(fs, rr(rng, 2500, 3800), 1.2);
    const rattleBp = Biquad.bandpass(fs, rr(rng, 1800, 3200), 2);
    const kExc = decayK(fs, 0.0015), kThud = decayK(fs, 0.018), kClick = decayK(fs, 0.003);
    // Cliquetis : quelques petites excitations après l'impact (la grille vibre).
    const rattles: number[] = [];
    const nr = 3 + Math.floor(rng() * 4);
    for (let k = 0; k < nr; k++) rattles.push(Math.floor(rr(rng, 0.012, 0.12) * fs));
    const rattleN = Math.floor(0.0012 * fs);
    let eExc = 1, eThud = 1, eClick = 1;
    for (let i = 0; i < len; i++) {
      const n = rng() * 2 - 1;
      let exc = n * eExc;
      if (i >= toeI && i < toeI + rattleN * 2) exc += n * toeG * 0.6;
      let rat = 0;
      for (const r0 of rattles) if (i >= r0 && i < r0 + rattleN) rat += n * 0.35;
      exc = excLp.process(exc + rat * 0.5);
      let ring = 0;
      for (const m of bank) ring += m.r.process(exc) * m.a;
      out[i] = ring * 0.35 + thudLp.process(n * eThud) * 1.8 + clickBp.process(n * eClick) * 1.2 + rattleBp.process(rat) * 0.9;
      eExc *= kExc; eThud *= kThud; eClick *= kClick;
    }
  } else if (surface === 'wood') {
    // Plancher creux : coup résonant + clic du talon.
    const r1 = Biquad.bandpass(fs, rr(rng, 150, 210), 5);
    const r2 = Biquad.bandpass(fs, rr(rng, 380, 520), 6);
    const r3 = Biquad.bandpass(fs, rr(rng, 900, 1300), 7);
    const click = Biquad.highpass(fs, 2200, 0.8);
    const body = Biquad.lowpass(fs, 320, 0.8);
    const toeR = Biquad.bandpass(fs, rr(rng, 420, 600), 5);
    const kExc = decayK(fs, 0.004), kClick = decayK(fs, 0.0018), kBody = decayK(fs, 0.025), kToe = decayK(fs, 0.003);
    let eExc = 1, eClick = 1, eBody = 1, eToe = 1;
    for (let i = 0; i < len; i++) {
      const n = rng() * 2 - 1;
      const exc = n * eExc;
      let x = r1.process(exc) * 7 + r2.process(exc) * 5 + r3.process(exc) * 3;
      x += click.process(n * eClick) * 0.8;
      x += body.process(n * eBody) * 1.2;
      if (i >= toeI) { x += toeR.process(n * eToe) * 4 * toeG; eToe *= kToe; }
      out[i] = x;
      eExc *= kExc; eClick *= kClick; eBody *= kBody;
    }
  } else {
    // Moquette : bruit sourd étouffé, léger frottement.
    const body = Biquad.lowpass(fs, rr(rng, 280, 420), 0.7);
    const brush = Biquad.bandpass(fs, rr(rng, 1400, 2400), 0.8);
    const w = (TWO_PI * rr(rng, 55, 80)) / fs;
    const kBody = decayK(fs, 0.03), kBrush = decayK(fs, 0.025);
    const attN = Math.floor(0.005 * fs);
    let eBody = 1, eBrush = 1;
    for (let i = 0; i < len; i++) {
      const n = rng() * 2 - 1;
      const att = i < attN ? i / attN : 1;
      let x = body.process(n * att * eBody) * 2.2;
      x += brush.process(n * att * eBrush) * 0.22;
      x += Math.sin(w * i) * att * eBody * 0.35;
      out[i] = x;
      eBody *= kBody; eBrush *= kBrush;
    }
  }
  dcBlock(out, fs, 30);
  fadeOut(out, Math.floor(0.012 * fs));
  normalizePeak(out, surface === 'carpet' ? 0.4 : surface === 'metal' ? 0.75 : surface === 'concrete' ? 0.8 : 0.85);
  return out;
}

export function* makeFootsteps(ctx: BaseAudioContext, surface: Surface, count: number, seed: number): Generator<undefined, AudioBuffer[], unknown> {
  const fs = Math.min(shotRate(ctx), 44100);
  const rng = mulberry32(seed);
  const res: AudioBuffer[] = [];
  for (let i = 0; i < count; i++) {
    res.push(toBuffer(ctx, [footstep(surface, fs, rng)], fs));
    yield;
  }
  return res;
}

/* ------------------------------------------------------------------ rumeur de foule */

const VOWELS: ReadonlyArray<readonly [number, number]> = [
  [730, 1090], [270, 2290], [300, 870], [530, 1840], [660, 1720],
  [520, 1190], [490, 1350], [440, 1020], [570, 840], [400, 1600],
];

/** Table d'enveloppe de syllabe sin(pi*u)^0.7. */
const SYL_ENV = (() => {
  const t = new Float32Array(257);
  for (let i = 0; i <= 256; i++) t[i] = Math.pow(Math.sin((Math.PI * i) / 256), 0.7);
  return t;
})();

/** Murmure non verbal : de nombreuses « voix » synthétiques qui prononcent des syllabes au hasard. */
export function* makeCrowdLoop(ctx: BaseAudioContext): BufferJob {
  const fs = loopRate(ctx);
  const seconds = 7;
  const fadeS = 0.5;
  const total = Math.floor((seconds + fadeS) * fs);
  const rng = mulberry32(42);
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  const voices = 11;
  for (let v = 0; v < voices; v++) {
    const pan = rr(rng, -1, 1);
    const gL = panL(pan);
    const gR = panR(pan);
    const f0 = rng() < 0.55 ? rr(rng, 92, 140) : rr(rng, 175, 245);
    const vg = rr(rng, 0.35, 1);
    const voiceLp = Biquad.lowpass(fs, rr(rng, 1300, 2600), 0.7);
    const f1 = new Biquad();
    const f2 = new Biquad();
    const fricBp = new Biquad();
    let t = rr(rng, 0, 1.2);
    while (t < seconds + fadeS) {
      const nSyl = 2 + Math.floor(rng() * 8);
      const p0 = f0 * rr(rng, 1.05, 1.25);
      const p1 = f0 * rr(rng, 0.82, 0.95);
      let ph = rng();
      let ts = t;
      for (let s = 0; s < nSyl; s++) {
        const sylDur = rr(rng, 0.08, 0.24);
        const [fa, fb] = VOWELS[Math.floor(rng() * VOWELS.length)];
        f1.set('bp', fs, fa * rr(rng, 0.9, 1.1), 4.5);
        f2.set('bp', fs, fb * rr(rng, 0.9, 1.1), 6);
        const fric = rng() < 0.35;
        if (fric) fricBp.set('bp', fs, rr(rng, 2500, 4200), 1.5);
        const i0 = Math.floor(ts * fs);
        const n = Math.floor(sylDur * fs);
        const amp = vg * rr(rng, 0.5, 1);
        // Glissement de hauteur linéaire sur la syllabe, suivant la déclinaison de la phrase.
        const fs0 = p0 + (p1 - p0) * (s / nSyl);
        const fs1 = p0 + (p1 - p0) * ((s + 1) / nSyl);
        const fricN = Math.floor(n * 0.3);
        for (let i = 0; i < n && i0 + i < total; i++) {
          const u = i / n;
          const env = SYL_ENV[(u * 256) | 0] * amp;
          ph += (fs0 + (fs1 - fs0) * u) / fs;
          if (ph >= 1) ph -= 1;
          const src = (ph * 2 - 1) * 0.6 + (rng() * 2 - 1) * 0.08;
          let x = f1.process(src) * 1.4 + f2.process(src) * 0.9;
          if (fric && i < fricN) x += fricBp.process(rng() * 2 - 1) * 0.5 * (1 - i / fricN);
          x = voiceLp.process(x * env);
          L[i0 + i] += x * gL;
          R[i0 + i] += x * gR;
        }
        ts += sylDur + rr(rng, 0.012, 0.07);
        yield;
      }
      t = ts + rr(rng, 0.25, 1.6);
    }
  }
  const fadeN = Math.floor(fadeS * fs);
  const outL = loopify(L, fadeN);
  dcBlock(outL, fs);
  normalizeRms(outL, 0.22);
  yield;
  const outR = loopify(R, fadeN);
  dcBlock(outR, fs);
  normalizeRms(outR, 0.22);
  yield;
  return toBuffer(ctx, [outL, outR], fs);
}

/* ------------------------------------------------------------------ pluie sur la chaussée */

export function* makeRainLoop(ctx: BaseAudioContext): BufferJob {
  const fs = loopRate(ctx);
  const seconds = 5;
  const fadeS = 0.4;
  const total = Math.floor((seconds + fadeS) * fs);
  const rng = mulberry32(7);
  const chans: Float32Array<ArrayBuffer>[] = [];
  const bp = new Biquad();
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(total);
    const hp = Biquad.highpass(fs, 650, 0.7);
    const lp = Biquad.lowpass(fs, Math.min(7000, fs * 0.45), 0.7);
    const bed = new OnePole(fs, 3000);
    // Éclaboussures sur le bitume : bande médium granuleuse.
    const splat = Biquad.bandpass(fs, 1700, 0.7);
    for (let i = 0; i < total; i++) {
      const w = rng() * 2 - 1;
      d[i] = lp.process(hp.process(bed.process(w))) * 0.5 + splat.process(rng() < 0.18 ? w : 0) * 0.35;
      if ((i & 8191) === 8191) yield;
    }
    // Gouttes : surtout des clics filtrés, quelques « plics » tonals.
    const rate = 280;
    let t = 0;
    const kClick = decayK(fs, 0.0012), kPlink = decayK(fs, 0.003);
    let drops = 0;
    while (t < seconds + fadeS) {
      if (++drops % 150 === 0) yield;
      t += -Math.log(1 - rng()) / rate;
      const i0 = Math.floor(t * fs);
      const a = 0.08 + 0.9 * rng() * rng() * rng();
      if (rng() < 0.12) {
        const w = (TWO_PI * rr(rng, 1500, 4000)) / fs;
        const n = Math.floor(0.012 * fs);
        let e = a * 0.5;
        for (let i = 0; i < n && i0 + i < total; i++) { d[i0 + i] += Math.sin(w * i) * e; e *= kPlink; }
      } else {
        bp.set('bp', fs, rr(rng, 2000, Math.min(7000, fs * 0.4)), 1.2);
        const n = Math.floor(0.006 * fs);
        let e = a * 2;
        for (let i = 0; i < n && i0 + i < total; i++) { d[i0 + i] += bp.process((rng() * 2 - 1) * e); e *= kClick; }
      }
    }
    const out = loopify(d, Math.floor(fadeS * fs));
    normalizeRms(out, 0.2);
    chans.push(out);
    yield;
  }
  return toBuffer(ctx, chans, fs);
}

/* ------------------------------------------------------------------ gouttes dans les flaques */

/** Grosses gouttes qui tombent dans les flaques et ruissellement de gouttière (même pluie fine). */
export function* makeDripLoop(ctx: BaseAudioContext): BufferJob {
  const fs = loopRate(ctx);
  const seconds = 6;
  const fadeS = 0.4;
  const N = Math.floor(seconds * fs);
  const fadeN = Math.floor(fadeS * fs);
  const total = N + fadeN;
  const rng = mulberry32(1311);
  // Ruissellement : bruit passe-bande à modulation d'amplitude rapide et irrégulière.
  const beds: Float32Array<ArrayBuffer>[] = [];
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(total);
    const bp = Biquad.bandpass(fs, rr(rng, 1300, 2300), 1.4);
    const am = new OnePole(fs, 16);
    const lvl = c === 0 ? 0.55 : 0.3;
    for (let i = 0; i < total; i++) {
      const w = rng() * 2 - 1;
      const m = am.process(rng() < 0.02 ? 1 : 0) * 30;
      d[i] = bp.process(w) * (0.15 + Math.min(1, m)) * lvl;
      if ((i & 8191) === 8191) yield;
    }
    beds.push(loopify(d, fadeN));
  }
  const [L, R] = beds;
  // Gouttes (bulle de Minnaert : sinus dont la hauteur monte) écrites circulairement.
  const rate = 7;
  let t = 0;
  const hp = new Biquad();
  let drops = 0;
  while (t < seconds) {
    t += -Math.log(1 - rng()) / rate;
    if (t >= seconds) break;
    if (++drops % 20 === 0) yield;
    const i0 = Math.floor(t * fs);
    const pan = rr(rng, -0.9, 0.9);
    const gl = panL(pan), gr = panR(pan);
    const a = 0.12 + 0.88 * rng() * rng();
    const f0 = rr(rng, 550, 2100);
    const tau = rr(rng, 0.01, 0.03);
    const k = decayK(fs, tau);
    const n = Math.floor(Math.min(0.09, tau * 6) * fs);
    const clickN = Math.floor(0.0015 * fs);
    hp.set('hp', fs, 2500, 0.7);
    let ph = 0;
    let e = a;
    for (let i = 0; i < n; i++) {
      const u = i / fs;
      ph += (f0 * (1 + Math.min(0.9, u * 18))) / fs;
      let x = Math.sin(TWO_PI * ph) * e * 0.6;
      if (i < clickN) x += hp.process((rng() * 2 - 1) * a * (1 - i / clickN)) * 0.5;
      e *= k;
      const j = (i0 + i) % N;
      L[j] += x * gl;
      R[j] += x * gr;
    }
  }
  dcBlock(L, fs);
  dcBlock(R, fs);
  normalizePair(L, R, 0.16);
  return toBuffer(ctx, [L, R], fs);
}

/* ------------------------------------------------------------------ clapotis du fleuve */

export function* makeWaterLoop(ctx: BaseAudioContext): BufferJob {
  const fs = loopRate(ctx);
  const seconds = 9;
  const fadeS = 0.6;
  const total = Math.floor((seconds + fadeS) * fs);
  const rng = mulberry32(1215);
  const chans: Float32Array<ArrayBuffer>[] = [];
  const bp = new Biquad();
  const splash = new Biquad();
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(total);
    const flowLp = Biquad.lowpass(fs, 380, 0.7);
    let brown = 0;
    for (let i = 0; i < total; i++) {
      brown = (brown + 0.02 * (rng() * 2 - 1)) / 1.02;
      d[i] = flowLp.process(brown * 3.5) * 0.35;
      if ((i & 8191) === 8191) yield;
    }
    let t = rr(rng, 0, 0.5);
    while (t < seconds + fadeS) {
      const dur = rr(rng, 0.35, 1.0);
      const fA = rr(rng, 250, 500);
      const fB = rr(rng, 600, 1200);
      const up = rng() < 0.6;
      const amp = rr(rng, 0.3, 0.9);
      const i0 = Math.floor(t * fs);
      const n = Math.floor(dur * fs);
      splash.set('bp', fs, rr(rng, 1200, 2400), 1.0);
      const peakU = rr(rng, 0.25, 0.45);
      for (let i = 0; i < n && i0 + i < total; i++) {
        const u = i / n;
        if ((i & 31) === 0) bp.set('bp', fs, up ? fA + (fB - fA) * u : fB + (fA - fB) * u, 1.3);
        let env: number;
        if (u < peakU) env = Math.sin((u / peakU) * Math.PI * 0.5);
        else { const r = 1 - (u - peakU) / (1 - peakU); env = r * Math.sqrt(r); }
        const w = rng() * 2 - 1;
        let x = bp.process(w) * env * amp * 2.2;
        const us = u - peakU;
        if (us > 0 && us < 0.08) x += splash.process(w) * (1 - us / 0.08) * amp * 0.9;
        d[i0 + i] += x;
      }
      t += rr(rng, 0.45, 1.5);
      yield;
    }
    const out = loopify(d, Math.floor(fadeS * fs));
    dcBlock(out, fs);
    normalizeRms(out, 0.18);
    chans.push(out);
    yield;
  }
  return toBuffer(ctx, chans, fs);
}

/* ------------------------------------------------------------------ circulation lointaine */

/**
 * Lit de circulation de la ville : grondement continu, chuintements de pneus
 * sur chaussée et sifflements de voitures volantes qui passent au loin.
 */
export function* makeTrafficLoop(ctx: BaseAudioContext): BufferJob {
  const fs = loopRate(ctx);
  const seconds = 9;
  const fadeS = 0.6;
  const N = Math.floor(seconds * fs);
  const fadeN = Math.floor(fadeS * fs);
  const total = N + fadeN;
  const rng = mulberry32(2085);
  const beds: Float32Array<ArrayBuffer>[] = [];
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(total);
    const lp = Biquad.lowpass(fs, 110, 0.7);
    const wash = Biquad.bandpass(fs, 500, 0.5);
    let brown = 0;
    for (let i = 0; i < total; i++) {
      const w = rng() * 2 - 1;
      brown = (brown + 0.02 * w) / 1.02;
      d[i] = lp.process(brown * 3.5) * 0.55 + wash.process(w) * 0.05;
      if ((i & 8191) === 8191) yield;
    }
    beds.push(loopify(d, fadeN));
  }
  const [L, R] = beds;
  // Passages, écrits circulairement (la boucle reste parfaitement raccordée).
  const bp = new Biquad();
  const lp = new Biquad();
  const out = new Biquad();
  let t = rr(rng, 0, 0.5);
  while (t < seconds) {
    const dur = rr(rng, 1.8, 4.5);
    const i0 = Math.floor(t * fs);
    const n = Math.floor(dur * fs);
    const amp = rr(rng, 0.15, 0.6) * (rng() < 0.15 ? 1.8 : 1);
    const p0 = rr(rng, -1, 1);
    const p1 = clamp(-p0 + rr(rng, -0.3, 0.3), -1, 1);
    bp.set('bp', fs, rr(rng, 600, 1500), 0.6);
    lp.set('lp', fs, rr(rng, 150, 260), 0.7);
    out.set('lp', fs, rr(rng, 2200, 3800), 0.6);
    const hover = rng() < 0.4;
    const fw = rr(rng, 450, 1200);
    let ph = rng();
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const s = Math.sin(Math.PI * u);
      const env = s * s * amp;
      const w = rng() * 2 - 1;
      let x = bp.process(w) * 1.6 + lp.process(w) * 1.2;
      if (hover) {
        ph += (fw * (1.05 - 0.1 * u)) / fs; // effet Doppler
        if (ph >= 1) ph -= 1;
        x += Math.sin(TWO_PI * ph) * 0.07;
      }
      x = out.process(x * env);
      const pan = p0 + (p1 - p0) * u;
      const j = (i0 + i) % N;
      L[j] += x * panL(pan);
      R[j] += x * panR(pan);
      if ((i & 8191) === 8191) yield;
    }
    t += -Math.log(1 - rng()) / 1.3;
  }
  dcBlock(L, fs);
  dcBlock(R, fs);
  normalizePair(L, R, 0.2);
  return toBuffer(ctx, [L, R], fs);
}

/* ------------------------------------------------------------------ métro */

/**
 * Lit du métro : grondement profond, souffle du tunnel, bourdonnement
 * électrique du troisième rail (60 Hz) et quelques gouttes qui tombent.
 */
export function* makeSubwayLoop(ctx: BaseAudioContext): BufferJob {
  const fs = loopRate(ctx);
  const seconds = 8;
  const fadeS = 0.6;
  const N = Math.floor(seconds * fs);
  const fadeN = Math.floor(fadeS * fs);
  const total = N + fadeN;
  const rng = mulberry32(77);
  const beds: Float32Array<ArrayBuffer>[] = [];
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(total);
    const lp1 = Biquad.lowpass(fs, 80, 0.7);
    const lp2 = Biquad.lowpass(fs, 120, 0.7);
    const air = Biquad.bandpass(fs, 260, 0.5);
    const hiss = Biquad.highpass(fs, 3000, 0.7);
    const pink = new PinkGen();
    let brown = 0;
    const ph = rng() * TWO_PI;
    for (let i = 0; i < total; i++) {
      const w = rng() * 2 - 1;
      brown = (brown + 0.02 * w) / 1.02;
      const swell = 0.7 + 0.3 * Math.sin((TWO_PI * i) / N + ph);
      d[i] = lp2.process(lp1.process(brown * 3.5)) * 0.9 * swell + air.process(pink.next(w)) * 0.3 + hiss.process(w) * 0.012;
      if ((i & 8191) === 8191) yield;
    }
    beds.push(loopify(d, fadeN));
  }
  const [L, R] = beds;
  // Bourdonnement secteur (exactement périodique sur la boucle : 60 Hz × 8 s).
  const hum: ReadonlyArray<readonly [number, number]> = [[60, 0.02], [120, 0.035], [180, 0.014], [240, 0.007], [300, 0.004]];
  for (let i = 0; i < N; i++) {
    let h = 0;
    for (const [f, a] of hum) h += Math.sin((TWO_PI * f * i) / fs) * a;
    L[i] += h;
    R[i] += h * 0.9;
    if ((i & 16383) === 16383) yield;
  }
  // Gouttes dans le tunnel.
  const drips = 3;
  for (let k = 0; k < drips; k++) {
    const i0 = Math.floor(rr(rng, 0, seconds) * fs);
    const f0 = rr(rng, 900, 1700);
    const pan = rr(rng, -0.8, 0.8);
    const kd = decayK(fs, 0.03);
    let e = rr(rng, 0.05, 0.12);
    let ph = 0;
    const n = Math.floor(0.15 * fs);
    for (let i = 0; i < n; i++) {
      ph += (f0 * (1 + Math.min(0.6, (i / fs) * 12))) / fs;
      const x = Math.sin(TWO_PI * ph) * e;
      e *= kd;
      const j = (i0 + i) % N;
      L[j] += x * panL(pan);
      R[j] += x * panR(pan);
    }
  }
  dcBlock(L, fs, 15);
  dcBlock(R, fs, 15);
  normalizePair(L, R, 0.2);
  return toBuffer(ctx, [L, R], fs);
}

/* ------------------------------------------------------------------ souffle intérieur (ventilation) */

/** Ton de pièce moderne : souffle de ventilation, bourdonnement électrique, ventilateur lointain. */
export function* makeHvacLoop(ctx: BaseAudioContext): BufferJob {
  const fs = loopRate(ctx);
  const seconds = 7;
  const fadeS = 0.5;
  const N = Math.floor(seconds * fs);
  const fadeN = Math.floor(fadeS * fs);
  const total = N + fadeN;
  const rng = mulberry32(4242);
  const beds: Float32Array<ArrayBuffer>[] = [];
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(total);
    const lp = Biquad.lowpass(fs, 420, 0.7);
    const vent = Biquad.bandpass(fs, 1100, 0.8);
    const pink = new PinkGen();
    const ph = rng() * TWO_PI;
    for (let i = 0; i < total; i++) {
      const p = pink.next(rng() * 2 - 1);
      const fl = 0.85 + 0.15 * Math.sin((TWO_PI * 2 * i) / N + ph);
      d[i] = (lp.process(p) * 1.2 + vent.process(p) * 0.22) * fl;
      if ((i & 8191) === 8191) yield;
    }
    beds.push(loopify(d, fadeN));
  }
  const [L, R] = beds;
  // Bourdonnement secteur et ventilateur (périodiques sur 7 s).
  const tones: ReadonlyArray<readonly [number, number]> = [[60, 0.01], [120, 0.026], [180, 0.01], [240, 0.005], [455, 0.007]];
  for (let i = 0; i < N; i++) {
    let h = 0;
    for (const [f, a] of tones) h += Math.sin((TWO_PI * f * i) / fs) * a;
    // léger battement du ventilateur
    h += Math.sin((TWO_PI * 457 * i) / fs) * 0.004;
    L[i] += h;
    R[i] += h;
    if ((i & 16383) === 16383) yield;
  }
  dcBlock(L, fs, 15);
  dcBlock(R, fs, 15);
  normalizePair(L, R, 0.18);
  return toBuffer(ctx, [L, R], fs);
}
