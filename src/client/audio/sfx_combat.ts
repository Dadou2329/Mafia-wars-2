/**
 * Combat sounds: gunshots (near & far), melee, bullet impacts, weapon foley.
 * Each function schedules nodes into `s.out` starting at `s.t` and returns the
 * time at which the sound is silent.
 */
import { COIN } from './instruments';
import {
  adEnv, biquad, chain, expSweep, gainNode, grains, jit, noise, noiseBurst, osc, partials, rnd,
  type SynthEnv, TAU_END, tone, trackSource,
} from './synth';

export interface SfxCtx extends SynthEnv {
  /** Voice input node. */
  out: AudioNode;
  /** Start time (AudioContext seconds). */
  t: number;
  /** Pitch multiplier requested by the caller. */
  p: number;
}

/* ------------------------------------------------------------------ gunshots */

interface GunParams {
  crackHp: number; crackTau: number; crackGain: number;
  bodyLp: number; bodyPeak: number; bodyTau: number; bodyGain: number;
  boomF: number; boomTau: number; boomGain: number;
  thumpF0: number; thumpF1: number; thumpSweep: number; thumpTau: number; thumpGain: number;
  tailLp: number; tailTau: number; tailGain: number;
  drive: number;
  snap?: number;  // supersonic crack layer gain
  flam?: number;  // second body burst (shotgun)
}

const GUNS: Record<'revolver' | 'shotgun' | 'rifle', GunParams> = {
  revolver: {
    crackHp: 2000, crackTau: 0.006, crackGain: 2.6,
    bodyLp: 2600, bodyPeak: 800, bodyTau: 0.035, bodyGain: 3.0,
    boomF: 280, boomTau: 0.05, boomGain: 2.2,
    thumpF0: 150, thumpF1: 50, thumpSweep: 0.1, thumpTau: 0.045, thumpGain: 0.6,
    tailLp: 1100, tailTau: 0.25, tailGain: 0.9,
    drive: 2.6,
  },
  shotgun: {
    crackHp: 1500, crackTau: 0.008, crackGain: 2.2,
    bodyLp: 1800, bodyPeak: 480, bodyTau: 0.065, bodyGain: 3.4,
    boomF: 190, boomTau: 0.09, boomGain: 3.4,
    thumpF0: 120, thumpF1: 38, thumpSweep: 0.18, thumpTau: 0.08, thumpGain: 0.9,
    tailLp: 800, tailTau: 0.4, tailGain: 1.1,
    drive: 3.2, flam: 0.6,
  },
  rifle: {
    crackHp: 2800, crackTau: 0.005, crackGain: 3.0,
    bodyLp: 3200, bodyPeak: 1000, bodyTau: 0.03, bodyGain: 2.6,
    boomF: 320, boomTau: 0.045, boomGain: 1.8,
    thumpF0: 180, thumpF1: 55, thumpSweep: 0.08, thumpTau: 0.04, thumpGain: 0.45,
    tailLp: 1500, tailTau: 0.45, tailGain: 1.0,
    drive: 2.8, snap: 1.4,
  },
};

export function gunshot(s: SfxCtx, kind: 'revolver' | 'shotgun' | 'rifle'): number {
  const P = GUNS[kind];
  const { ctx, t } = s;
  const p = s.p * jit(0.05);
  const dj = jit(0.12);
  const shaper = ctx.createWaveShaper();
  shaper.curve = s.res.shaperCurve(P.drive * jit(0.1));
  const post = gainNode(ctx, 0.6);
  chain(shaper, post, s.out);

  // Shared white-noise source for crack + body.
  const bodyEnd = t + P.bodyTau * dj * TAU_END + 0.03;
  const src = noise(s, 'white', t, bodyEnd - t + 0.02);

  const hp = biquad(ctx, 'highpass', P.crackHp * p, 0.7);
  const crackG = gainNode(ctx, 0);
  adEnv(crackG.gain, t, P.crackGain * jit(0.1), 0.0004, P.crackTau * dj);
  chain(src, hp, crackG, shaper);

  // Body: resonant low-pass sweeping down to the body resonance.
  const lp = biquad(ctx, 'lowpass', P.bodyLp * p, 1.6);
  expSweep(lp.frequency, t, P.bodyLp * p * 1.8, P.bodyPeak * p, 0.1);
  const bodyG = gainNode(ctx, 0);
  adEnv(bodyG.gain, t, P.bodyGain, 0.0008, P.bodyTau * dj);
  chain(src, lp, bodyG, shaper);

  if (P.flam) {
    const fG = gainNode(ctx, 0);
    adEnv(fG.gain, t + rnd(0.004, 0.009), P.bodyGain * P.flam, 0.001, P.bodyTau * 0.8);
    chain(lp, fG, shaper);
  }

  // One pink source feeds the low-mid "boom" and the environmental tail.
  const tailTau = P.tailTau * dj;
  let end = t + 0.016 + tailTau * TAU_END;
  const pink = noise(s, 'pink', t, end - t + 0.02);
  const boomBp = biquad(ctx, 'bandpass', P.boomF * p, 0.8);
  const boomG = gainNode(ctx, 0);
  adEnv(boomG.gain, t, P.boomGain, 0.001, P.boomTau * dj);
  chain(pink, boomBp, boomG, shaper);
  // Tail stays outside the shaper so it remains smooth.
  const tailLp = biquad(ctx, 'lowpass', P.tailLp * p, 0.6);
  const tailG = gainNode(ctx, 0);
  adEnv(tailG.gain, t + 0.004, P.tailGain, 0.012, tailTau);
  chain(pink, tailLp, tailG, s.out);

  // Sub thump with pitch drop.
  end = Math.max(end, tone(s, shaper, t, {
    type: 'sine', freq: P.thumpF0 * p, freqEnd: P.thumpF1 * p, sweep: P.thumpSweep,
    peak: P.thumpGain, attack: 0.001, tau: P.thumpTau * dj,
  }));

  if (P.snap) {
    end = Math.max(end, noiseBurst(s, s.out, t, {
      type: 'highpass', freq: 5000, q: 0.8, peak: P.snap, attack: 0.0002, tau: 0.0015,
    }));
  }

  return Math.max(end, bodyEnd);
}

/** Distant gunshot: muffled report followed by rolling street echoes. */
export function gunshotFar(s: SfxCtx, kind: 'revolver' | 'shotgun' | 'rifle'): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.06);
  const low = kind === 'shotgun' ? 0.75 : kind === 'rifle' ? 1.25 : 1;
  const shaper = ctx.createWaveShaper();
  shaper.curve = s.res.shaperCurve(1.8);
  const post = gainNode(ctx, 0.7);
  chain(shaper, post, s.out);

  let end = noiseBurst(s, shaper, t, {
    kind: 'white', type: 'lowpass', freq: 900 * low * p, q: 0.7, type2: 'peaking', freq2: 420 * low * p, q2: 1,
    peak: 2.6, attack: 0.003, tau: kind === 'shotgun' ? 0.07 : 0.05,
  });
  end = Math.max(end, noiseBurst(s, shaper, t, {
    kind: 'pink', type: 'bandpass', freq: 240 * low * p, q: 0.8, peak: 2.2, attack: 0.004, tau: kind === 'shotgun' ? 0.09 : 0.065,
  }));
  end = Math.max(end, tone(s, shaper, t, {
    type: 'sine', freq: 90 * low * p, freqEnd: 42 * p, sweep: 0.2, peak: 0.3, attack: 0.004, tau: 0.08,
  }));
  if (kind === 'rifle') {
    end = Math.max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 1700 * p, q: 1.2, peak: 0.9, attack: 0.0005, tau: 0.004 }));
  }
  // Rolling echoes off facades.
  const echoes: Array<[number, number]> = [[rnd(0.11, 0.2), 1.1], [rnd(0.3, 0.48), 0.7], [rnd(0.6, 0.85), 0.42], [rnd(0.95, 1.3), 0.22]];
  for (const [dt, g] of echoes) {
    end = Math.max(end, noiseBurst(s, s.out, t + dt, {
      kind: 'pink', type: 'bandpass', freq: 420 * low * p, q: 0.7, peak: g, attack: 0.012, tau: rnd(0.06, 0.12),
    }));
  }
  end = Math.max(end, noiseBurst(s, s.out, t + 0.01, {
    kind: 'brown', type: 'lowpass', freq: 500 * low, q: 0.6, peak: 0.8, attack: 0.03, tau: kind === 'rifle' ? 0.55 : 0.4,
  }));
  return end;
}

/* ------------------------------------------------------------------ melee */

export function punch(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.08);
  const shaper = ctx.createWaveShaper();
  shaper.curve = s.res.shaperCurve(2);
  chain(shaper, gainNode(ctx, 0.8), s.out);
  let end = tone(s, shaper, t, { freq: 150 * p, freqEnd: 60 * p, sweep: 0.06, peak: 0.55, attack: 0.001, tau: 0.035 });
  end = Math.max(end, noiseBurst(s, shaper, t, { kind: 'pink', type: 'lowpass', freq: 1000 * p, q: 1, peak: 2.6, attack: 0.001, tau: 0.03 }));
  end = Math.max(end, noiseBurst(s, shaper, t, { kind: 'pink', type: 'bandpass', freq: 260 * p, q: 1, peak: 1.6, attack: 0.001, tau: 0.04 }));
  end = Math.max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 2500 * p, q: 1.2, peak: 1.8, attack: 0.0004, tau: 0.006 }));
  end = Math.max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 1200, q: 0.7, peak: 0.12, attack: 0.008, tau: 0.02 }));
  return end;
}

export function knife(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.07);
  // Quick blade whoosh then the stab.
  let end = noiseBurst(s, s.out, t, { type: 'bandpass', freq: 2000 * p, freqEnd: 5500 * p, sweep: 0.07, q: 2, peak: 0.22, attack: 0.035, tau: 0.018 });
  const ts = t + 0.055;
  end = Math.max(end, noiseBurst(s, s.out, ts, { kind: 'pink', type: 'lowpass', freq: 700 * p, q: 1.5, peak: 0.75, attack: 0.002, tau: 0.045 }));
  end = Math.max(end, noiseBurst(s, s.out, ts, { type: 'bandpass', freq: 1400 * p, freqEnd: 650 * p, sweep: 0.06, q: 3, peak: 0.4, attack: 0.002, tau: 0.03 }));
  end = Math.max(end, noiseBurst(s, s.out, ts, { type: 'highpass', freq: 4500, q: 0.7, peak: 0.25, attack: 0.001, tau: 0.014 }));
  end = Math.max(end, tone(s, s.out, ts, { freq: 120 * p, freqEnd: 60 * p, sweep: 0.05, peak: 0.45, tau: 0.04 }));
  end = Math.max(end, partials(s, s.out, t + 0.01, 2900 * p, 0.06, [[1, 1, 0.12], [1.48, 0.6, 0.08], [2.3, 0.3, 0.05]]));
  return end;
}

export function club(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.08);
  const shaper = ctx.createWaveShaper();
  shaper.curve = s.res.shaperCurve(2.5);
  chain(shaper, gainNode(ctx, 0.8), s.out);
  let end = tone(s, shaper, t, { freq: 115 * p, freqEnd: 50 * p, sweep: 0.08, peak: 0.45, attack: 0.001, tau: 0.045 });
  end = Math.max(end, noiseBurst(s, shaper, t, { kind: 'pink', type: 'lowpass', freq: 650 * p, q: 1, peak: 2.4, attack: 0.001, tau: 0.045 }));
  end = Math.max(end, tone(s, s.out, t, { freq: 640 * p, peak: 0.55, attack: 0.001, tau: 0.045 }));
  end = Math.max(end, tone(s, s.out, t, { freq: 1130 * p, peak: 0.28, attack: 0.001, tau: 0.03 }));
  end = Math.max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 700 * p, q: 6, peak: 1.8, attack: 0.001, tau: 0.04 }));
  end = Math.max(end, noiseBurst(s, s.out, t, { type: 'highpass', freq: 2500, peak: 0.8, attack: 0.0004, tau: 0.004 }));
  return end;
}

export function swing(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.12);
  const dur = 0.3 * jit(0.15);
  const src = noise(s, 'white', t, dur + 0.05);
  const bp = biquad(ctx, 'bandpass', 500 * p, 1.6);
  bp.frequency.setValueAtTime(450 * p, t);
  bp.frequency.linearRampToValueAtTime(1900 * p, t + dur * 0.42);
  bp.frequency.exponentialRampToValueAtTime(600 * p, t + dur);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.55, t + dur * 0.4);
  g.gain.setTargetAtTime(0, t + dur * 0.45, dur * 0.16);
  chain(src, bp, g, s.out);
  const lp = biquad(ctx, 'lowpass', 650 * p, 0.7);
  const g2 = gainNode(ctx, 0.35);
  chain(src, lp, g2, g);
  return t + dur + 0.08;
}

/* ------------------------------------------------------------------ impacts */

export function hitFlesh(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.1);
  let end = tone(s, s.out, t, { freq: 105 * p, freqEnd: 55 * p, sweep: 0.05, peak: 0.4, attack: 0.001, tau: 0.035 });
  end = Math.max(end, noiseBurst(s, s.out, t, { kind: 'pink', type: 'lowpass', freq: 800 * p, q: 1.2, peak: 2.2, attack: 0.001, tau: 0.04 }));
  end = Math.max(end, noiseBurst(s, s.out, t + 0.004, { type: 'bandpass', freq: 1100 * p, freqEnd: 600 * p, sweep: 0.05, q: 4, peak: 0.9, attack: 0.002, tau: 0.028 }));
  return end;
}

export function hitWall(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.1);
  let end = noiseBurst(s, s.out, t, { type: 'highpass', freq: 1800 * p, peak: 0.8, attack: 0.0004, tau: 0.006 });
  end = Math.max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 3400 * p, q: 1, peak: 0.4, attack: 0.0005, tau: 0.012 }));
  end = Math.max(end, tone(s, s.out, t, { freq: 150 * p, freqEnd: 70 * p, sweep: 0.03, peak: 0.3, tau: 0.02 }));
  const debris: Array<[number, number]> = [];
  const n = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) debris.push([0.02 + Math.pow(Math.random(), 1.5) * 0.25, rnd(0.08, 0.25)]);
  end = Math.max(end, grains(s, s.out, t, debris, { type: 'bandpass', freq: 3800 * p, q: 1.5, tau: 0.004 }));
  end = Math.max(end, noiseBurst(s, s.out, t + 0.01, { kind: 'pink', type: 'bandpass', freq: 800, q: 0.5, peak: 0.12, attack: 0.01, tau: 0.07 }));
  return end;
}

export function hitWood(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.1);
  let end = tone(s, s.out, t, { freq: 430 * p, peak: 0.45, attack: 0.001, tau: 0.05 });
  end = Math.max(end, tone(s, s.out, t, { freq: 990 * p, peak: 0.25, attack: 0.001, tau: 0.03 }));
  end = Math.max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 1500 * p, q: 2, peak: 0.6, attack: 0.0005, tau: 0.008 }));
  end = Math.max(end, noiseBurst(s, s.out, t, { kind: 'pink', type: 'lowpass', freq: 420 * p, peak: 0.4, attack: 0.001, tau: 0.03 }));
  end = Math.max(end, grains(s, s.out, t, [[0.012, 0.2], [0.027, 0.14], [0.05, 0.09]], { type: 'bandpass', freq: 3000 * p, q: 2, tau: 0.003 }));
  return end;
}

export function hitMetal(s: SfxCtx): number {
  const { t } = s;
  const f0 = rnd(380, 620) * s.p;
  let end = partials(s, s.out, t, f0, 0.32, [[1, 1, 0.32], [2.76, 0.55, 0.22], [5.4, 0.3, 0.13], [8.93, 0.16, 0.07], [1.52, 0.25, 0.2]]);
  end = Math.max(end, noiseBurst(s, s.out, t, { type: 'highpass', freq: 3000, peak: 0.6, attack: 0.0003, tau: 0.003 }));
  return end;
}

export function ricochet(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.12);
  const dur = rnd(0.32, 0.5);
  const f0 = 3600 * p;
  const f1 = rnd(900, 1400) * p;
  let end = noiseBurst(s, s.out, t, { type: 'highpass', freq: 2500, peak: 0.5, attack: 0.0003, tau: 0.004 });
  // Whine with slight wobble.
  const o = osc(ctx, 'triangle', f0, t, t + dur + 0.1);
  expSweep(o.frequency, t + 0.01, f0, f1, dur);
  const lfo = osc(ctx, 'sine', rnd(25, 40), t, t + dur + 0.1);
  const lg = gainNode(ctx, f0 * 0.02);
  chain(lfo, lg, o.frequency);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.28, t + 0.012);
  g.gain.setValueAtTime(0.28, t + dur * 0.35);
  g.gain.setTargetAtTime(0, t + dur * 0.35, dur * 0.22);
  chain(o, g, s.out);
  end = Math.max(end, t + dur * 0.35 + dur * 0.22 * TAU_END);
  end = Math.max(end, noiseBurst(s, s.out, t + 0.005, { type: 'bandpass', freq: f0, freqEnd: f1, sweep: dur, q: 7, peak: 0.3, attack: 0.01, tau: dur * 0.3 }));
  return end;
}

export function glass(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.08);
  let end = noiseBurst(s, s.out, t, { type: 'highpass', freq: 2500 * p, peak: 0.7, attack: 0.0005, tau: 0.012 });
  end = Math.max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 5200 * p, q: 1.2, peak: 0.35, attack: 0.001, tau: 0.05 }));
  // Tinkling shards: first burst then falling pieces.
  const shards = 9;
  for (let i = 0; i < shards; i++) {
    const dt = i < 4 ? rnd(0, 0.06) : rnd(0.12, 0.55);
    end = Math.max(end, tone(s, s.out, t + dt, {
      freq: rnd(2600, 7200) * p, peak: rnd(0.04, 0.12) * (i < 4 ? 1.4 : 1), attack: 0.0005, tau: rnd(0.03, 0.11),
    }));
  }
  const fall: Array<[number, number]> = [];
  for (let i = 0; i < 12; i++) fall.push([rnd(0.08, 0.6), rnd(0.05, 0.22)]);
  end = Math.max(end, grains(s, s.out, t, fall, { type: 'bandpass', freq: 6000 * p, q: 1.5, tau: 0.005 }));
  return end;
}

/* ------------------------------------------------------------------ weapon foley */

function click(s: SfxCtx, t: number, freq: number, peak: number, tau = 0.004): number {
  return noiseBurst(s, s.out, t, { type: 'bandpass', freq, q: 1.5, peak, attack: 0.0003, tau });
}

export function reload(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.04);
  // Break-open latch.
  let end = click(s, t, 2400 * p, 0.55);
  end = Math.max(end, tone(s, s.out, t, { freq: 320 * p, peak: 0.2, tau: 0.02 }));
  // Ejector shhk + falling brass.
  end = Math.max(end, noiseBurst(s, s.out, t + 0.12, { type: 'bandpass', freq: 2600 * p, q: 1.5, peak: 0.25, attack: 0.012, tau: 0.03 }));
  for (let i = 0; i < 3; i++) {
    end = Math.max(end, partials(s, s.out, t + rnd(0.22, 0.42), rnd(3600, 5200), 0.07, COIN));
  }
  // Three cartridges thumbed in.
  const ins: Array<[number, number]> = [[0.5, 0.35], [0.66, 0.32], [0.82, 0.36]];
  end = Math.max(end, grains(s, s.out, t, ins.map(([o, a]) => [o + rnd(-0.02, 0.02), a] as const), { type: 'bandpass', freq: 3200 * p, q: 2, tau: 0.005 }));
  // Close with a solid clack and the cylinder ratchet.
  const tc = t + 1.0;
  end = Math.max(end, click(s, tc, 1800 * p, 0.65, 0.008));
  end = Math.max(end, tone(s, s.out, tc, { freq: 230 * p, freqEnd: 160 * p, sweep: 0.03, peak: 0.3, tau: 0.03 }));
  const ratchet: Array<[number, number]> = [];
  for (let i = 0; i < 4; i++) ratchet.push([0.06 + i * 0.028, 0.12]);
  end = Math.max(end, grains(s, s.out, tc, ratchet, { type: 'highpass', freq: 4000, tau: 0.003 }));
  return end;
}

export function emptyClick(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.04);
  let end = noiseBurst(s, s.out, t, { type: 'highpass', freq: 2500 * p, peak: 0.6, attack: 0.0003, tau: 0.003 });
  end = Math.max(end, tone(s, s.out, t, { freq: 3200 * p, peak: 0.12, attack: 0.0005, tau: 0.02 }));
  end = Math.max(end, tone(s, s.out, t, { freq: 4700 * p, peak: 0.06, attack: 0.0005, tau: 0.012 }));
  end = Math.max(end, tone(s, s.out, t, { freq: 900 * p, peak: 0.15, attack: 0.0005, tau: 0.008 }));
  return end;
}

export function weaponSwitch(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.05);
  let end = noiseBurst(s, s.out, t, { type: 'bandpass', freq: 1200 * p, freqEnd: 2600 * p, sweep: 0.12, q: 0.8, peak: 0.18, attack: 0.04, tau: 0.04 });
  end = Math.max(end, noiseBurst(s, s.out, t + 0.05, { type: 'bandpass', freq: 4000 * p, q: 3, peak: 0.12, attack: 0.02, tau: 0.03 }));
  end = Math.max(end, click(s, t + 0.16, 2600 * p, 0.45));
  end = Math.max(end, tone(s, s.out, t + 0.16, { freq: 1800 * p, peak: 0.1, attack: 0.0005, tau: 0.015 }));
  return end;
}

/* ------------------------------------------------------------------ footsteps */

/** Footsteps replay pre-rendered variants: one buffer source per step. */
export function footstep(s: SfxCtx, variants: AudioBuffer[], lastIndex: { v: number }): number {
  let i = Math.floor(Math.random() * variants.length);
  if (i === lastIndex.v) i = (i + 1) % variants.length;
  lastIndex.v = i;
  const src = s.ctx.createBufferSource();
  src.buffer = variants[i];
  const rate = s.p * jit(0.06);
  src.playbackRate.value = rate;
  src.connect(s.out);
  src.start(s.t);
  trackSource(src);
  return s.t + variants[i].duration / rate + 0.01;
}

