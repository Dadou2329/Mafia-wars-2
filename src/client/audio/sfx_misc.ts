/**
 * Non-combat sounds: grunts, Victorian UI (paper & brass), cash register,
 * brass stings, hand bell, doors, police whistle, horses and carriages.
 */
import type { SfxCtx } from './sfx_combat';
import { bell, brass, COIN, cymbal, DESK_BELL, HAND_BELL, pad, timpani } from './instruments';
import { midiHz } from './dsp';
import {
  ahrEnv, biquad, chain, gainNode, grains, jit, noise, noiseBurst, osc, partials, pick, ringBell, rnd,
  TAU_END, tone,
} from './synth';

/* ------------------------------------------------------------------ voice (non-verbal) */

const VOWEL_FORMANTS: ReadonlyArray<readonly [number, number, number]> = [
  [640, 1190, 2390], // "uh"
  [530, 1840, 2480], // "eh"
  [730, 1090, 2440], // "ah"
  [570, 840, 2410],  // "oh"
];

interface VocalOpts {
  f0: number; f0Peak: number; f0End: number;
  dur: number; peak: number;
  formants: readonly [number, number, number];
  formantsEnd?: readonly [number, number, number];
  breath: number; rough: number;
}

/** Glottal sawtooth through three parallel formant filters + breath noise. */
function vocal(s: SfxCtx, t: number, o: VocalOpts): number {
  const ctx = s.ctx;
  const end = t + o.dur + 0.3;
  const src = osc(ctx, 'sawtooth', o.f0, t, end);
  src.frequency.setValueAtTime(o.f0, t);
  src.frequency.linearRampToValueAtTime(o.f0Peak, t + o.dur * 0.2);
  src.frequency.exponentialRampToValueAtTime(o.f0End, t + o.dur);
  if (o.rough > 0) {
    const lfo = osc(ctx, 'sine', rnd(24, 34), t, end);
    const lg = gainNode(ctx, o.f0 * o.rough);
    chain(lfo, lg, src.frequency);
  }
  const env = gainNode(ctx, 0);
  ahrEnv(env.gain, t, o.peak, 0.02, o.dur * 0.55, o.dur * 0.12);
  const fGains = [1.0, 0.55, 0.22];
  const qs = [5, 7, 9];
  for (let i = 0; i < 3; i++) {
    const bp = biquad(ctx, 'bandpass', o.formants[i], qs[i]);
    if (o.formantsEnd) {
      bp.frequency.setValueAtTime(o.formants[i], t);
      bp.frequency.linearRampToValueAtTime(o.formantsEnd[i], t + o.dur);
    }
    const g = gainNode(ctx, fGains[i] * 2.2);
    chain(src, bp, g, env);
  }
  const nz = noise(s, 'white', t, o.dur + 0.3);
  const nbp = biquad(ctx, 'bandpass', 1500, 0.7);
  const ng = gainNode(ctx, o.breath);
  chain(nz, nbp, ng, env);
  env.connect(s.out);
  return t + 0.02 + o.dur * 0.55 + o.dur * 0.12 * TAU_END;
}

export function pain(s: SfxCtx): number {
  const f0 = rnd(100, 150) * s.p;
  const dur = rnd(0.16, 0.28);
  let end = noiseBurst(s, s.out, s.t, { type: 'bandpass', freq: 2400, q: 1.2, peak: 0.15, attack: 0.001, tau: 0.006 });
  end = Math.max(end, vocal(s, s.t + 0.008, {
    f0: f0 * 1.1, f0Peak: f0 * 1.3, f0End: f0 * 0.8, dur, peak: 0.55,
    formants: pick(VOWEL_FORMANTS), breath: 0.18, rough: 0.05,
  }));
  return end;
}

export function death(s: SfxCtx): number {
  const { t } = s;
  const f0 = rnd(130, 165) * s.p;
  const dur = rnd(0.65, 0.9);
  let end = vocal(s, t, {
    f0, f0Peak: f0 * 1.12, f0End: f0 * 0.5, dur, peak: 0.5,
    formants: [730, 1090, 2440], formantsEnd: [560, 880, 2350], breath: 0.25, rough: 0.07,
  });
  // Body hits the ground.
  const tf = t + dur * 0.9;
  end = Math.max(end, tone(s, s.out, tf, { freq: 75, freqEnd: 40, sweep: 0.12, peak: 0.8, attack: 0.002, tau: 0.09 }));
  end = Math.max(end, noiseBurst(s, s.out, tf, { kind: 'pink', type: 'lowpass', freq: 320, q: 0.9, peak: 0.75, attack: 0.002, tau: 0.06 }));
  end = Math.max(end, grains(s, s.out, tf, [[0.02, 0.15], [0.05, 0.1], [0.09, 0.07]], { type: 'bandpass', freq: 2000, q: 1.5, tau: 0.006 }));
  return end;
}

/* ------------------------------------------------------------------ UI */

export function uiClick(s: SfxCtx): number {
  const p = s.p * jit(0.03);
  let end = tone(s, s.out, s.t, { freq: 1650 * p, peak: 0.22, attack: 0.001, tau: 0.018 });
  end = Math.max(end, tone(s, s.out, s.t, { freq: 3310 * p, peak: 0.05, attack: 0.001, tau: 0.008 }));
  end = Math.max(end, noiseBurst(s, s.out, s.t, { type: 'bandpass', freq: 4000, q: 1.5, peak: 0.14, attack: 0.0004, tau: 0.003 }));
  return end;
}

export function uiHover(s: SfxCtx): number {
  const p = s.p * jit(0.02);
  let end = tone(s, s.out, s.t, { freq: 2400 * p, peak: 0.06, attack: 0.002, tau: 0.012 });
  end = Math.max(end, noiseBurst(s, s.out, s.t, { type: 'bandpass', freq: 3000, q: 2, peak: 0.035, attack: 0.002, tau: 0.006 }));
  return end;
}

export function uiOpen(s: SfxCtx): number {
  const p = s.p;
  let end = noiseBurst(s, s.out, s.t, { type: 'bandpass', freq: 900 * p, freqEnd: 2800 * p, sweep: 0.16, q: 1.2, peak: 0.12, attack: 0.08, tau: 0.045 });
  end = Math.max(end, bell(s, s.out, s.t + 0.06, midiHz(88) * p, 0.05, DESK_BELL, 0.5));
  end = Math.max(end, bell(s, s.out, s.t + 0.13, midiHz(93) * p, 0.04, DESK_BELL, 0.5));
  return end;
}

export function uiClose(s: SfxCtx): number {
  const p = s.p;
  let end = noiseBurst(s, s.out, s.t, { type: 'bandpass', freq: 2600 * p, freqEnd: 800 * p, sweep: 0.14, q: 1.2, peak: 0.1, attack: 0.04, tau: 0.045 });
  end = Math.max(end, tone(s, s.out, s.t + 0.1, { freq: 340 * p, peak: 0.18, attack: 0.001, tau: 0.03 }));
  end = Math.max(end, noiseBurst(s, s.out, s.t + 0.1, { type: 'bandpass', freq: 1200, q: 1, peak: 0.1, attack: 0.0005, tau: 0.005 }));
  return end;
}

export function uiError(s: SfxCtx): number {
  const ctx = s.ctx;
  const p = s.p;
  const lp = biquad(ctx, 'lowpass', 900, 1);
  lp.connect(s.out);
  let end = tone(s, lp, s.t, { type: 'square', freq: 196 * p, peak: 0.13, attack: 0.004, hold: 0.06, tau: 0.03 });
  end = Math.max(end, tone(s, lp, s.t + 0.13, { type: 'square', freq: 185 * p, peak: 0.13, attack: 0.004, hold: 0.09, tau: 0.04 }));
  end = Math.max(end, tone(s, s.out, s.t, { freq: 260 * p, peak: 0.1, attack: 0.001, tau: 0.035 }));
  return end;
}

export function paper(s: SfxCtx): number {
  const hits: Array<[number, number]> = [];
  const n = 10 + Math.floor(Math.random() * 7);
  for (let i = 0; i < n; i++) hits.push([Math.random() * 0.33, rnd(0.1, 0.4)]);
  let end = grains(s, s.out, s.t, hits, { type: 'bandpass', freq: 3200 * s.p, q: 0.9, tau: rnd(0.005, 0.01) });
  end = Math.max(end, noiseBurst(s, s.out, s.t, { type: 'highpass', freq: 1500, peak: 0.06, attack: 0.06, tau: 0.06 }));
  return end;
}

/* ------------------------------------------------------------------ money */

function coins(s: SfxCtx, t: number, times: readonly number[], peak: number): number {
  let end = t;
  times.forEach((dt, i) => {
    const g = peak * (1 - (i / Math.max(1, times.length)) * 0.5) * rnd(0.7, 1);
    end = Math.max(end, partials(s, s.out, t + dt, rnd(3400, 6000) * s.p, g, COIN));
  });
  return end;
}

export function cash(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.02);
  // Key press & mechanism.
  let end = noiseBurst(s, s.out, t, { type: 'bandpass', freq: 1200 * p, q: 2, peak: 0.5, attack: 0.0005, tau: 0.008 });
  end = Math.max(end, tone(s, s.out, t, { freq: 180 * p, freqEnd: 120 * p, sweep: 0.03, peak: 0.35, tau: 0.025 }));
  // Drawer slides out.
  end = Math.max(end, noiseBurst(s, s.out, t + 0.06, { kind: 'pink', type: 'bandpass', freq: 900, q: 0.8, peak: 0.22, attack: 0.03, tau: 0.06 }));
  end = Math.max(end, grains(s, s.out, t + 0.06, [[0.01, 0.15], [0.04, 0.12], [0.07, 0.1], [0.1, 0.12]], { type: 'bandpass', freq: 2200, q: 2, tau: 0.004 }));
  // "Ching!" (double strike) + coins.
  const f = 2350 * p;
  end = Math.max(end, ringBell(s, s.out, [[t + 0.1, 0.32], [t + 0.125, 0.2]], f, DESK_BELL));
  end = Math.max(end, coins(s, t + 0.18, [0, 0.06, 0.11, 0.19, 0.28], 0.12));
  return end;
}

export function purchase(s: SfxCtx): number {
  const { t } = s;
  let end = coins(s, t, [0, 0.07, 0.13, 0.18, 0.22, 0.25, 0.27], 0.16);
  end = Math.max(end, bell(s, s.out, t + 0.3, 2637 * s.p, 0.12, DESK_BELL, 0.7));
  return end;
}

export function recruit(s: SfxCtx): number {
  const { t } = s;
  let end = noiseBurst(s, s.out, t, { kind: 'pink', type: 'lowpass', freq: 300, peak: 0.4, attack: 0.002, tau: 0.03 });
  end = Math.max(end, tone(s, s.out, t, { freq: 90, peak: 0.3, tau: 0.03 }));
  end = Math.max(end, coins(s, t + 0.05, [0, 0.06, 0.13], 0.12));
  end = Math.max(end, bell(s, s.out, t + 0.18, midiHz(84) * s.p, 0.16, DESK_BELL, 0.8));
  end = Math.max(end, bell(s, s.out, t + 0.34, midiHz(88) * s.p, 0.16, DESK_BELL, 0.9));
  return end;
}

/* ------------------------------------------------------------------ signals & stings */

export function capture(s: SfxCtx): number {
  const { t } = s;
  const p = s.p;
  const m = (n: number): number => midiHz(n) * p;
  let end = brass(s, s.out, t, m(55), 0.11, 0.2, { bright: 0.75 });          // G3
  end = Math.max(end, brass(s, s.out, t + 0.12, m(60), 0.11, 0.2, { bright: 0.75 })); // C4
  end = Math.max(end, brass(s, s.out, t + 0.24, m(64), 0.11, 0.2, { bright: 0.75 })); // E4
  const tc = t + 0.36;
  for (const n of [60, 64, 67, 72]) end = Math.max(end, brass(s, s.out, tc, m(n), 0.95, 0.17, { bright: 0.85, vibrato: 10 }));
  end = Math.max(end, timpani(s, s.out, tc, m(36), 0.5));
  end = Math.max(end, cymbal(s, s.out, tc, 0.08, 0.5));
  return end;
}

export function territoryLost(s: SfxCtx): number {
  const { t } = s;
  const m = (n: number): number => midiHz(n) * s.p;
  let end = brass(s, s.out, t, m(67), 0.2, 0.2, { bright: 0.4 });          // G4
  end = Math.max(end, brass(s, s.out, t + 0.22, m(63), 0.2, 0.2, { bright: 0.35 })); // Eb4
  const tc = t + 0.45;
  for (const n of [48, 60, 63, 67]) end = Math.max(end, brass(s, s.out, tc, m(n), 1.0, 0.15, { bright: 0.3, vibrato: 6, release: 0.3 }));
  end = Math.max(end, timpani(s, s.out, t, m(36), 0.25));
  end = Math.max(end, timpani(s, s.out, t + 0.12, m(36), 0.3));
  end = Math.max(end, timpani(s, s.out, tc, m(36), 0.55));
  return end;
}

export function alert(s: SfxCtx): number {
  const { t } = s;
  const strikes: Array<[number, number]> = [];
  let tt = t;
  for (let i = 0; i < 8; i++) {
    strikes.push([tt, (i % 2 === 0 ? 0.3 : 0.22) * rnd(0.9, 1.1)]);
    tt += rnd(0.13, 0.16);
  }
  const f = 1180 * s.p;
  let end = ringBell(s, s.out, strikes, f, HAND_BELL);
  end = Math.max(end, grains(s, s.out, t, strikes.map(([st, a]) => [st - t, a * 0.6] as const), { type: 'bandpass', freq: 3500, q: 1.2, tau: 0.003 }));
  return end;
}

export function notify(s: SfxCtx): number {
  let end = bell(s, s.out, s.t, midiHz(91) * s.p, 0.1, DESK_BELL, 0.8);
  end = Math.max(end, bell(s, s.out, s.t + 0.11, midiHz(96) * s.p, 0.085, DESK_BELL, 0.9));
  return end;
}

export function victorySting(s: SfxCtx): number {
  const { t } = s;
  const m = (n: number): number => midiHz(n) * s.p;
  const tr = 0.11;
  let end = t;
  for (let i = 0; i < 3; i++) end = Math.max(end, brass(s, s.out, t + i * tr, m(57), tr * 0.8, 0.2, { bright: 0.8 }));
  end = Math.max(end, brass(s, s.out, t + 3 * tr, m(62), 0.42, 0.22, { bright: 0.85 }));
  end = Math.max(end, brass(s, s.out, t + 3 * tr + 0.45, m(66), 0.18, 0.2, { bright: 0.85 }));
  end = Math.max(end, brass(s, s.out, t + 3 * tr + 0.65, m(69), 0.18, 0.2, { bright: 0.85 }));
  const tc = t + 3 * tr + 0.85;
  for (const n of [50, 62, 66, 69, 74]) end = Math.max(end, brass(s, s.out, tc, m(n), 1.25, 0.15, { bright: 0.9, vibrato: 10, release: 0.25 }));
  end = Math.max(end, timpani(s, s.out, t + 3 * tr, m(38), 0.45));
  end = Math.max(end, timpani(s, s.out, tc, m(38), 0.6));
  end = Math.max(end, cymbal(s, s.out, tc, 0.12, 0.9));
  return end;
}

export function defeatSting(s: SfxCtx): number {
  const { t } = s;
  const m = (n: number): number => midiHz(n) * s.p;
  let end = brass(s, s.out, t, m(57), 0.38, 0.2, { bright: 0.3, attack: 0.06, vibrato: 5 });
  end = Math.max(end, brass(s, s.out, t + 0.42, m(53), 0.38, 0.2, { bright: 0.28, attack: 0.06, vibrato: 5 }));
  end = Math.max(end, brass(s, s.out, t + 0.84, m(50), 1.3, 0.22, { bright: 0.25, attack: 0.08, vibrato: 6, release: 0.35 }));
  end = Math.max(end, pad(s, s.out, t + 0.8, [m(38), m(50), m(53), m(57)], 1.2, 0.35, { cutoff: 700, attack: 0.25, release: 0.9 }));
  end = Math.max(end, timpani(s, s.out, t + 0.84, m(26), 0.4));
  return end;
}

/* ------------------------------------------------------------------ doors */

export function doorOpen(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.08);
  let end = noiseBurst(s, s.out, t, { type: 'highpass', freq: 2000, peak: 0.4, attack: 0.0004, tau: 0.004 });
  end = Math.max(end, tone(s, s.out, t, { freq: 1400 * p, peak: 0.1, tau: 0.01 }));
  // Hinge creak: irregular stick-slip buzz through wooden resonances.
  const tc = t + 0.06;
  const dur = rnd(0.5, 0.75);
  const saw = osc(ctx, 'sawtooth', 50 * p, tc, tc + dur + 0.4);
  saw.frequency.setValueAtTime(rnd(38, 55) * p, tc);
  let tt = tc;
  while (tt < tc + dur) {
    tt += rnd(0.06, 0.16);
    saw.frequency.linearRampToValueAtTime(rnd(40, 115) * p, Math.min(tt, tc + dur));
  }
  const env = gainNode(ctx, 0);
  ahrEnv(env.gain, tc, 0.28, 0.07, dur * 0.8, 0.06);
  for (const [f, q, g] of [[650, 4, 1.0], [1400, 6, 0.6], [2600, 8, 0.3]] as const) {
    const bp = biquad(ctx, 'bandpass', f * p, q);
    chain(saw, bp, gainNode(ctx, g), env);
  }
  env.connect(s.out);
  end = Math.max(end, tc + 0.07 + dur * 0.8 + 0.06 * TAU_END);
  end = Math.max(end, noiseBurst(s, s.out, tc, { kind: 'pink', type: 'lowpass', freq: 400, peak: 0.1, attack: 0.2, tau: 0.12 }));
  return end;
}

export function doorClose(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.06);
  let end = noiseBurst(s, s.out, t, { kind: 'pink', type: 'lowpass', freq: 500, peak: 0.12, attack: 0.12, tau: 0.04 });
  const ts = t + 0.14;
  end = Math.max(end, tone(s, s.out, ts, { freq: 88 * p, freqEnd: 45 * p, sweep: 0.12, peak: 0.85, attack: 0.002, tau: 0.09 }));
  end = Math.max(end, noiseBurst(s, s.out, ts, { kind: 'pink', type: 'lowpass', freq: 350 * p, q: 1, peak: 0.8, attack: 0.001, tau: 0.065 }));
  end = Math.max(end, tone(s, s.out, ts, { freq: 260 * p, peak: 0.3, tau: 0.06 }));
  end = Math.max(end, noiseBurst(s, s.out, ts + 0.012, { type: 'highpass', freq: 2500, peak: 0.45, attack: 0.0004, tau: 0.004 }));
  end = Math.max(end, grains(s, s.out, ts, [[0.03, 0.12], [0.06, 0.09], [0.1, 0.06]], { type: 'bandpass', freq: 2000, q: 2, tau: 0.005 }));
  return end;
}

/* ------------------------------------------------------------------ street & world */

export function policeWhistle(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.015);
  const blasts: Array<[number, number]> = [[0, 0.5], [0.62, 0.95]];
  const total = 0.62 + 0.95 + 0.2;
  const f1 = 2650 * p;
  const f2 = 3010 * p;
  const o1 = osc(ctx, 'sine', f1, t, t + total);
  const o2 = osc(ctx, 'triangle', f2, t, t + total);
  // Pea trill: AM + FM at ~28 Hz.
  const lfo = osc(ctx, 'square', rnd(25, 31), t, t + total);
  const lfoLp = biquad(ctx, 'lowpass', 110, 0.7);
  chain(lfo, lfoLp);
  const fm1 = gainNode(ctx, f1 * 0.028);
  const fm2 = gainNode(ctx, f2 * 0.028);
  lfoLp.connect(fm1); lfoLp.connect(fm2);
  fm1.connect(o1.frequency); fm2.connect(o2.frequency);
  const am = gainNode(ctx, 0.6);
  const amDepth = gainNode(ctx, 0.38);
  lfoLp.connect(amDepth); amDepth.connect(am.gain);
  const mix = gainNode(ctx, 1);
  o1.connect(mix);
  const o2g = gainNode(ctx, 0.7);
  chain(o2, o2g, mix);
  const nz = noise(s, 'white', t, total);
  const nbp = biquad(ctx, 'bandpass', 2800 * p, 2);
  chain(nz, nbp, gainNode(ctx, 0.35), mix);
  const env = gainNode(ctx, 0);
  env.gain.setValueAtTime(0, t);
  for (const [st, d] of blasts) {
    env.gain.setValueAtTime(0, t + st);
    env.gain.linearRampToValueAtTime(0.26, t + st + 0.025);
    env.gain.setValueAtTime(0.26, t + st + d - 0.04);
    env.gain.linearRampToValueAtTime(0, t + st + d);
    o1.frequency.setValueAtTime(f1 * 0.94, t + st);
    o1.frequency.linearRampToValueAtTime(f1, t + st + 0.05);
  }
  chain(mix, am, env, s.out);
  return t + total;
}

function hoof(s: SfxCtx, t: number, amp: number): number {
  const p = s.p;
  const f = rnd(850, 1100) * p;
  let end = tone(s, s.out, t, { freq: f, peak: 0.32 * amp, attack: 0.0008, tau: 0.022 });
  end = Math.max(end, tone(s, s.out, t, { freq: f * 1.72, peak: 0.12 * amp, attack: 0.0008, tau: 0.014 }));
  end = Math.max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 1900 * p, q: 1.5, peak: 0.45 * amp, attack: 0.0004, tau: 0.006 }));
  end = Math.max(end, noiseBurst(s, s.out, t, { kind: 'pink', type: 'lowpass', freq: 420, peak: 0.4 * amp, attack: 0.001, tau: 0.02 }));
  return end;
}

export function horseClop(s: SfxCtx): number {
  const gap = rnd(0.09, 0.14);
  return Math.max(hoof(s, s.t, 1), hoof(s, s.t + gap, rnd(0.65, 0.85)));
}

export function carriageWheels(s: SfxCtx): number {
  const { ctx, t } = s;
  const dur = 2.2 * jit(0.1);
  let end = t;
  // Rumble with swell (approach & recede).
  const rsrc = noise(s, 'brown', t, dur + 0.3);
  const rlp = biquad(ctx, 'lowpass', 230, 0.8);
  const rg = gainNode(ctx, 0);
  rg.gain.setValueAtTime(0, t);
  rg.gain.linearRampToValueAtTime(0.55, t + dur * 0.45);
  rg.gain.linearRampToValueAtTime(0, t + dur);
  chain(rsrc, rlp, rg, s.out);
  end = Math.max(end, t + dur);
  // Iron tyres clattering on cobbles.
  const bumps: Array<[number, number]> = [];
  let tt = 0.02;
  while (tt < dur - 0.05) {
    const sw = Math.sin(Math.PI * (tt / dur));
    bumps.push([tt, rnd(0.06, 0.3) * sw]);
    tt += rnd(0.035, 0.075);
  }
  end = Math.max(end, grains(s, s.out, t, bumps, { type: 'bandpass', freq: 950 * s.p, q: 1.2, tau: 0.01 }));
  // Creaking wooden body.
  const saw = osc(ctx, 'sawtooth', 65, t, t + dur);
  saw.frequency.setValueAtTime(60, t);
  saw.frequency.linearRampToValueAtTime(85, t + dur * 0.5);
  saw.frequency.linearRampToValueAtTime(58, t + dur);
  const cbp = biquad(ctx, 'bandpass', 1100, 6);
  const cg = gainNode(ctx, 0);
  cg.gain.setValueAtTime(0, t);
  cg.gain.linearRampToValueAtTime(0.05, t + dur * 0.5);
  cg.gain.linearRampToValueAtTime(0, t + dur);
  chain(saw, cbp, cg, s.out);
  return end;
}

export function neigh(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.06);
  const dur = 1.25 * jit(0.08);
  const o = osc(ctx, 'sawtooth', 520 * p, t, t + dur + 0.3);
  o.frequency.setValueAtTime(520 * p, t);
  o.frequency.linearRampToValueAtTime(980 * p, t + 0.12);
  o.frequency.linearRampToValueAtTime(880 * p, t + 0.35);
  o.frequency.exponentialRampToValueAtTime(420 * p, t + dur);
  const lfo = osc(ctx, 'sine', 13, t, t + dur + 0.3);
  lfo.frequency.setValueAtTime(14, t);
  lfo.frequency.linearRampToValueAtTime(9, t + dur);
  const depth = gainNode(ctx, 0);
  depth.gain.setValueAtTime(10 * p, t);
  depth.gain.linearRampToValueAtTime(90 * p, t + dur * 0.8);
  chain(lfo, depth, o.frequency);
  const env = gainNode(ctx, 0);
  ahrEnv(env.gain, t, 0.3, 0.05, dur * 0.75, dur * 0.06);
  for (const [f, q, g] of [[1000, 3, 1.0], [2300, 4, 0.6], [3300, 5, 0.3]] as const) {
    chain(o, biquad(ctx, 'bandpass', f, q), gainNode(ctx, g * 2), env);
  }
  const nz = noise(s, 'white', t, dur + 0.3);
  chain(nz, biquad(ctx, 'bandpass', 2000, 0.8), gainNode(ctx, 0.25), env);
  env.connect(s.out);
  let end = t + 0.05 + dur * 0.75 + dur * 0.06 * TAU_END;
  // Snort / nostril flutter.
  const ts = t + dur + 0.05;
  const flutter: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) flutter.push([i * 0.022, 0.3 * (1 - i / 9)]);
  end = Math.max(end, grains(s, s.out, ts, flutter, { kind: 'pink', type: 'bandpass', freq: 600, q: 0.8, tau: 0.012 }));
  return end;
}
