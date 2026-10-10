/**
 * Material rendered once into AudioBuffers with plain JS DSP: footstep
 * variants (very cheap to replay) and the looping ambience beds (crowd
 * babble, rain, fireplace, river lapping). Every maker is a generator job
 * that yields regularly so the work can be spread over several frames.
 */
import {
  Biquad, dcBlock, loopify, loopRate, mulberry32, normalizePeak, normalizeRms,
  OnePole, rr, type Rng, toBuffer,
} from './dsp';
import type { BufferJob } from './reverb';

export type Surface = 'stone' | 'wood' | 'carpet';

const TWO_PI = Math.PI * 2;
/** Per-sample multiplier for an exponential decay with time constant `tau`. */
const decayK = (fs: number, tau: number): number => Math.exp(-1 / (tau * fs));

/* ------------------------------------------------------------------ footsteps */

function footstep(surface: Surface, fs: number, rng: Rng): Float32Array<ArrayBuffer> {
  const dur = surface === 'wood' ? 0.24 : 0.2;
  const len = Math.floor(dur * fs);
  const out = new Float32Array(len);
  const toeI = Math.floor(rr(rng, 0.03, 0.06) * fs);
  const toeG = rr(rng, 0.25, 0.55);

  if (surface === 'stone') {
    // Leather heel on cobbles: bright click, short body, toe tap, a little grit.
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
  } else if (surface === 'wood') {
    // Hollow floorboards: resonant knock + heel click.
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
    // Carpet: soft muffled thud with a faint brush.
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
  const fade = Math.floor(0.012 * fs);
  for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
  normalizePeak(out, surface === 'carpet' ? 0.4 : 0.85);
  return out;
}

export function* makeFootsteps(ctx: BaseAudioContext, surface: Surface, count: number, seed: number): Generator<undefined, AudioBuffer[], unknown> {
  const fs = Math.min(ctx.sampleRate, 44100);
  const rng = mulberry32(seed);
  const res: AudioBuffer[] = [];
  for (let i = 0; i < count; i++) {
    res.push(toBuffer(ctx, [footstep(surface, fs, rng)], fs));
    yield;
  }
  return res;
}

/* ------------------------------------------------------------------ crowd babble */

const VOWELS: ReadonlyArray<readonly [number, number]> = [
  [730, 1090], [270, 2290], [300, 870], [530, 1840], [660, 1720],
  [520, 1190], [490, 1350], [440, 1020], [570, 840], [400, 1600],
];

/** sin(pi*u)^0.7 syllable envelope table. */
const SYL_ENV = (() => {
  const t = new Float32Array(257);
  for (let i = 0; i <= 256; i++) t[i] = Math.pow(Math.sin((Math.PI * i) / 256), 0.7);
  return t;
})();

/** Non-verbal murmur: many synthetic "voices" producing random syllables. */
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
    const gL = Math.cos((pan + 1) * Math.PI * 0.25);
    const gR = Math.sin((pan + 1) * Math.PI * 0.25);
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
        // Linear pitch glide across the syllable, following the phrase declination.
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

/* ------------------------------------------------------------------ rain */

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
    const hp = Biquad.highpass(fs, 700, 0.7);
    const lp = Biquad.lowpass(fs, Math.min(7000, fs * 0.45), 0.7);
    const bed = new OnePole(fs, 3000);
    for (let i = 0; i < total; i++) {
      d[i] = lp.process(hp.process(bed.process(rng() * 2 - 1))) * 0.5;
      if ((i & 8191) === 8191) yield;
    }
    // Droplets: mostly filtered clicks, a few tonal "plinks".
    const rate = 260;
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

/* ------------------------------------------------------------------ fireplace */

export function* makeFireLoop(ctx: BaseAudioContext): BufferJob {
  const fs = loopRate(ctx);
  const seconds = 7;
  const fadeS = 0.4;
  const total = Math.floor((seconds + fadeS) * fs);
  const rng = mulberry32(99);
  const chans: Float32Array<ArrayBuffer>[] = [];
  const bp = new Biquad();
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(total);
    const roarLp = Biquad.lowpass(fs, 180, 0.7);
    const hissBp = Biquad.bandpass(fs, 2600, 0.6);
    const modLp = new OnePole(fs, 1.2);
    let brown = 0;
    for (let i = 0; i < total; i++) {
      const w = rng() * 2 - 1;
      brown = (brown + 0.02 * w) / 1.02;
      let m = 0.6 + modLp.process(rng() * 2 - 1) * 8;
      m = m < 0.2 ? 0.2 : m > 1.4 ? 1.4 : m;
      d[i] = roarLp.process(brown * 3.5) * 0.9 * m + hissBp.process(w) * 0.03;
      if ((i & 8191) === 8191) yield;
    }
    // Crackle clusters and the odd louder snap.
    let t = 0;
    let clusters = 0;
    while (t < seconds + fadeS) {
      if (++clusters % 12 === 0) yield;
      t += -Math.log(1 - rng()) / 5;
      const pops = 1 + Math.floor(rng() * 6);
      let tp = t;
      const big = rng() < 0.08;
      for (let p = 0; p < pops; p++) {
        const i0 = Math.floor(tp * fs);
        bp.set('bp', fs, big ? rr(rng, 600, 1500) : rr(rng, 1200, Math.min(5200, fs * 0.4)), big ? 1.5 : 1.0);
        const len = Math.max(1, Math.floor((big ? 0.012 : rr(rng, 0.0008, 0.003)) * fs));
        const a = (big ? 1.0 : rr(rng, 0.15, 0.8)) * 2.5;
        for (let i = 0; i < len * 4 && i0 + i < total; i++) {
          const e = i < len ? 1 - i / len : 0;
          d[i0 + i] += bp.process((rng() * 2 - 1) * e) * a;
        }
        tp += rr(rng, 0.004, 0.05);
      }
    }
    const out = loopify(d, Math.floor(fadeS * fs));
    dcBlock(out, fs);
    normalizePeak(out, 0.9);
    chans.push(out);
    yield;
  }
  return toBuffer(ctx, chans, fs);
}

/* ------------------------------------------------------------------ river lapping */

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
