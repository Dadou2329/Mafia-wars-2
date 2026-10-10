/**
 * Synthetic impulse responses, generated once per AudioContext (incrementally,
 * as generator jobs, so they never block a frame):
 *  - street: brick facades of a narrow London street (discrete slap echoes,
 *    flutter between parallel walls, darkening ~1.7 s tail)
 *  - room:   panelled Victorian interior (dense, short, warm)
 *  - hall:   warm concert-hall style tail for music
 */
import { Biquad, mulberry32, OnePole, toBuffer } from './dsp';

interface EarlyReflection { t: number; g: number; pan: number }

interface IrSpec {
  seconds: number;
  rt60: number;
  preDelay: number;
  /** Seconds for the diffuse tail to fade in (soft onset). */
  fadeIn: number;
  /** Time-varying low-pass: cutoff at start and end of the IR. */
  lpStart: number;
  lpEnd: number;
  early: EarlyReflection[];
  /** Gain of the diffuse tail relative to the early reflections. */
  tailGain: number;
  /** Flutter echo period (s) between parallel walls, 0 = none. */
  flutter: number;
  flutterGain: number;
  seed: number;
}

/** Generator job: yields between blocks, returns the finished AudioBuffer. */
export type BufferJob = Generator<undefined, AudioBuffer, unknown>;

const BLOCK = 64;
const YIELD_EVERY = 8192;

function* generate(ctx: BaseAudioContext, s: IrSpec): BufferJob {
  const fs = ctx.sampleRate;
  const len = Math.max(64, Math.floor(s.seconds * fs));
  const rng = mulberry32(s.seed);
  const chans: Float32Array<ArrayBuffer>[] = [new Float32Array(len), new Float32Array(len)];
  const pre = Math.floor(s.preDelay * fs);
  const decay = Math.exp(-6.907755 / (s.rt60 * fs)); // per-sample amplitude factor (-60 dB at rt60)
  const fadeN = Math.max(1, Math.floor(s.fadeIn * fs));
  // Cutoff glides exponentially from lpStart to lpEnd over ~70% of the IR.
  const glideN = Math.max(1, Math.floor(len * 0.7));
  const cutRatio = Math.pow(s.lpEnd / s.lpStart, BLOCK / glideN);

  for (let c = 0; c < 2; c++) {
    const d = chans[c];
    const lp1 = new OnePole(fs, s.lpStart);
    const lp2 = new OnePole(fs, s.lpStart);
    const hp = Biquad.highpass(fs, 70, 0.6);
    let env = 1;
    let cutoff = s.lpStart;
    const g = s.tailGain * 2.2;
    for (let i = pre; i < len; i++) {
      const k = i - pre;
      if ((k & (BLOCK - 1)) === 0) {
        if (k < glideN) cutoff *= cutRatio;
        lp1.a = OnePole.coef(fs, cutoff);
        lp2.a = lp1.a;
        if ((k & (YIELD_EVERY - 1)) === 0 && k > 0) yield;
      }
      const fade = k < fadeN ? k / fadeN : 1;
      d[i] = hp.process(lp2.process(lp1.process((rng() * 2 - 1) * env * fade))) * g;
      env *= decay;
    }
    // Flutter echoes (decaying impulse train with jitter).
    if (s.flutter > 0) {
      const k = 6.907755 / s.rt60;
      let t = s.flutter * (0.8 + 0.4 * rng());
      while (t < s.seconds * 0.8) {
        const i = pre + Math.floor(t * fs);
        if (i >= len) break;
        const amp = s.flutterGain * Math.exp(-k * 1.25 * t) * (0.6 + 0.4 * rng()) * (rng() < 0.5 ? -1 : 1);
        const w = 3 + Math.floor(rng() * 6);
        for (let j = 0; j < w && i + j < len; j++) d[i + j] += amp * (1 - j / w) * (rng() * 0.6 + 0.4);
        t += s.flutter * (0.9 + 0.2 * rng());
      }
    }
    // Discrete early reflections, slightly smeared and panned.
    for (const r of s.early) {
      const panGain = c === 0 ? Math.cos((r.pan + 1) * Math.PI * 0.25) : Math.sin((r.pan + 1) * Math.PI * 0.25);
      const i0 = pre + Math.floor((r.t + (c === 0 ? 0 : 0.0007 * rng())) * fs);
      const w = 4 + Math.floor(rng() * 10);
      const smear = new OnePole(fs, 5000);
      for (let j = 0; j < w * 3 && i0 + j < len; j++) {
        const x = j < w ? (rng() * 2 - 1) * (1 - j / w) : 0;
        d[i0 + j] += smear.process(x) * r.g * panGain * 1.6;
      }
    }
    yield;
  }
  return toBuffer(ctx, chans, fs);
}

export function makeStreetIR(ctx: BaseAudioContext): BufferJob {
  return generate(ctx, {
    seconds: 2.0, rt60: 1.7, preDelay: 0.006, fadeIn: 0.05,
    lpStart: 6500, lpEnd: 900, tailGain: 0.55,
    flutter: 0.068, flutterGain: 0.35,
    early: [
      { t: 0.017, g: 0.8, pan: -0.6 }, { t: 0.029, g: 0.7, pan: 0.7 },
      { t: 0.046, g: 0.55, pan: -0.2 }, { t: 0.071, g: 0.5, pan: 0.5 },
      { t: 0.094, g: 0.42, pan: -0.8 }, { t: 0.128, g: 0.36, pan: 0.3 },
      { t: 0.171, g: 0.3, pan: -0.4 }, { t: 0.232, g: 0.24, pan: 0.8 },
      { t: 0.305, g: 0.18, pan: -0.1 },
    ],
    seed: 1888,
  });
}

export function makeRoomIR(ctx: BaseAudioContext): BufferJob {
  return generate(ctx, {
    seconds: 0.9, rt60: 0.55, preDelay: 0.002, fadeIn: 0.012,
    lpStart: 7000, lpEnd: 1800, tailGain: 0.9,
    flutter: 0, flutterGain: 0,
    early: [
      { t: 0.004, g: 0.6, pan: 0.4 }, { t: 0.007, g: 0.55, pan: -0.5 },
      { t: 0.011, g: 0.5, pan: 0.1 }, { t: 0.016, g: 0.42, pan: -0.2 },
      { t: 0.023, g: 0.35, pan: 0.6 }, { t: 0.031, g: 0.28, pan: -0.7 },
    ],
    seed: 221,
  });
}

export function makeHallIR(ctx: BaseAudioContext): BufferJob {
  return generate(ctx, {
    seconds: 2.8, rt60: 2.3, preDelay: 0.018, fadeIn: 0.08,
    lpStart: 8000, lpEnd: 1600, tailGain: 1.0,
    flutter: 0, flutterGain: 0,
    early: [
      { t: 0.012, g: 0.3, pan: -0.5 }, { t: 0.021, g: 0.28, pan: 0.6 },
      { t: 0.034, g: 0.24, pan: -0.2 }, { t: 0.049, g: 0.2, pan: 0.3 },
    ],
    seed: 1859,
  });
}
