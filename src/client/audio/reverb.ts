/**
 * Réponses impulsionnelles synthétiques, générées une fois par AudioContext
 * (par tranches, en tâches génératrices, sans jamais bloquer une image) :
 *  - rue :    canyon de gratte-ciel new-yorkais (échos francs sur les façades
 *             de verre et de béton, flottement entre façades parallèles, queue
 *             longue qui s'assombrit)
 *  - pièce :  intérieur moderne (béton, verre, loft) : dense, court, assez clair
 *  - salle :  grande queue luxuriante pour la musique (synthwave)
 *  - tunnel : quai de métro carrelé (long, brillant, flottement serré entre les murs)
 */
import { Biquad, mulberry32, OnePole, toBuffer } from './dsp';

interface EarlyReflection { t: number; g: number; pan: number }

interface IrSpec {
  seconds: number;
  rt60: number;
  preDelay: number;
  /** Durée (s) de la montée de la queue diffuse (attaque douce). */
  fadeIn: number;
  /** Passe-bas variable dans le temps : coupure au début et à la fin de la RI. */
  lpStart: number;
  lpEnd: number;
  early: EarlyReflection[];
  /** Gain de la queue diffuse relativement aux premières réflexions. */
  tailGain: number;
  /** Période (s) de l'écho flottant entre murs parallèles, 0 = aucun. */
  flutter: number;
  flutterGain: number;
  seed: number;
}

/** Tâche génératrice : rend la main entre deux blocs, renvoie l'AudioBuffer fini. */
export type BufferJob = Generator<undefined, AudioBuffer, unknown>;

const BLOCK = 64;
const YIELD_EVERY = 8192;

function* generate(ctx: BaseAudioContext, s: IrSpec): BufferJob {
  const fs = ctx.sampleRate;
  const len = Math.max(64, Math.floor(s.seconds * fs));
  const rng = mulberry32(s.seed);
  const chans: Float32Array<ArrayBuffer>[] = [new Float32Array(len), new Float32Array(len)];
  const pre = Math.floor(s.preDelay * fs);
  const decay = Math.exp(-6.907755 / (s.rt60 * fs)); // facteur d'amplitude par échantillon (-60 dB à rt60)
  const fadeN = Math.max(1, Math.floor(s.fadeIn * fs));
  // La coupure glisse exponentiellement de lpStart à lpEnd sur ~70 % de la RI.
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
    // Échos flottants (train d'impulsions décroissant, légèrement irrégulier).
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
    // Premières réflexions discrètes, légèrement étalées et panoramiquées.
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

/** Avenue bordée de tours : échos lointains sur les façades, longue traîne sombre. */
export function makeStreetIR(ctx: BaseAudioContext): BufferJob {
  return generate(ctx, {
    seconds: 2.4, rt60: 2.0, preDelay: 0.008, fadeIn: 0.06,
    lpStart: 7000, lpEnd: 850, tailGain: 0.5,
    flutter: 0.092, flutterGain: 0.32,
    early: [
      { t: 0.021, g: 0.75, pan: -0.6 }, { t: 0.038, g: 0.66, pan: 0.7 },
      { t: 0.061, g: 0.52, pan: -0.25 }, { t: 0.093, g: 0.5, pan: 0.5 },
      { t: 0.124, g: 0.42, pan: -0.8 }, { t: 0.171, g: 0.38, pan: 0.35 },
      { t: 0.226, g: 0.32, pan: -0.45 }, { t: 0.297, g: 0.26, pan: 0.8 },
      { t: 0.384, g: 0.2, pan: -0.1 }, { t: 0.47, g: 0.14, pan: 0.6 },
    ],
    seed: 2085,
  });
}

/** Intérieur moderne : béton brut et baies vitrées. */
export function makeRoomIR(ctx: BaseAudioContext): BufferJob {
  return generate(ctx, {
    seconds: 1.0, rt60: 0.62, preDelay: 0.002, fadeIn: 0.012,
    lpStart: 8500, lpEnd: 2200, tailGain: 0.9,
    flutter: 0, flutterGain: 0,
    early: [
      { t: 0.004, g: 0.6, pan: 0.4 }, { t: 0.008, g: 0.55, pan: -0.5 },
      { t: 0.012, g: 0.5, pan: 0.1 }, { t: 0.018, g: 0.42, pan: -0.2 },
      { t: 0.026, g: 0.35, pan: 0.6 }, { t: 0.035, g: 0.28, pan: -0.7 },
    ],
    seed: 212,
  });
}

/** Grande salle « plaque » pour la musique. */
export function makeHallIR(ctx: BaseAudioContext): BufferJob {
  return generate(ctx, {
    seconds: 3.0, rt60: 2.6, preDelay: 0.02, fadeIn: 0.08,
    lpStart: 9000, lpEnd: 1800, tailGain: 1.0,
    flutter: 0, flutterGain: 0,
    early: [
      { t: 0.013, g: 0.3, pan: -0.5 }, { t: 0.023, g: 0.28, pan: 0.6 },
      { t: 0.036, g: 0.24, pan: -0.2 }, { t: 0.052, g: 0.2, pan: 0.3 },
    ],
    seed: 1984,
  });
}

/** Quai de métro carrelé : longue réverbération claire et flottement serré. */
export function makeTunnelIR(ctx: BaseAudioContext): BufferJob {
  return generate(ctx, {
    seconds: 3.0, rt60: 2.7, preDelay: 0.006, fadeIn: 0.03,
    lpStart: 9500, lpEnd: 2000, tailGain: 0.75,
    flutter: 0.043, flutterGain: 0.5,
    early: [
      { t: 0.009, g: 0.7, pan: -0.7 }, { t: 0.015, g: 0.62, pan: 0.65 },
      { t: 0.027, g: 0.5, pan: -0.3 }, { t: 0.041, g: 0.46, pan: 0.4 },
      { t: 0.058, g: 0.4, pan: -0.6 }, { t: 0.083, g: 0.34, pan: 0.7 },
      { t: 0.121, g: 0.28, pan: 0 }, { t: 0.176, g: 0.22, pan: -0.5 },
    ],
    seed: 7,
  });
}
