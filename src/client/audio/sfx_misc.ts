/**
 * Sons de la ville de 2085 : voix (non verbales), portes pneumatiques,
 * sirène et radio du NYPD, klaxon, voitures volantes, drones, métro,
 * portière, ascenseur, alarme d'immeuble.
 */
import { GLASS } from './instruments';
import type { SfxCtx } from './sfx_combat';
import {
  ahrEnv, biquad, chain, fmTone, gainNode, grains, jit, noise, noiseBurst, osc, panSweep, partials, pick, rnd,
  TAU_END, tone,
} from './synth';

const max = Math.max;

/* ------------------------------------------------------------------ voix (non verbales) */

const VOWEL_FORMANTS: ReadonlyArray<readonly [number, number, number]> = [
  [640, 1190, 2390], // « eu »
  [530, 1840, 2480], // « è »
  [730, 1090, 2440], // « a »
  [570, 840, 2410],  // « o »
];

interface VocalOpts {
  f0: number; f0Peak: number; f0End: number;
  dur: number; peak: number;
  formants: readonly [number, number, number];
  formantsEnd?: readonly [number, number, number];
  breath: number; rough: number;
}

/** Dent de scie glottale à travers trois filtres de formants parallèles + souffle. */
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
  end = max(end, vocal(s, s.t + 0.008, {
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
  // Le corps touche le sol.
  const tf = t + dur * 0.9;
  end = max(end, tone(s, s.out, tf, { freq: 75, freqEnd: 40, sweep: 0.12, peak: 0.8, attack: 0.002, tau: 0.09 }));
  end = max(end, noiseBurst(s, s.out, tf, { kind: 'pink', type: 'lowpass', freq: 320, q: 0.9, peak: 0.75, attack: 0.002, tau: 0.06 }));
  end = max(end, grains(s, s.out, tf, [[0.02, 0.15], [0.05, 0.1], [0.09, 0.07]], { type: 'bandpass', freq: 2000, q: 1.5, tau: 0.006 }));
  return end;
}

/* ------------------------------------------------------------------ portes pneumatiques */

export function doorOpen(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.06);
  // Déverrouillage magnétique.
  let end = noiseBurst(s, s.out, t, { type: 'bandpass', freq: 2400 * p, q: 1.5, peak: 0.35, attack: 0.0004, tau: 0.004 });
  end = max(end, tone(s, s.out, t, { freq: 1568 * p, peak: 0.03, attack: 0.002, hold: 0.025, tau: 0.01 }));
  // Servomoteur, glissement et souffle pneumatique.
  const ts = t + 0.05;
  const dur = 0.5 * jit(0.1);
  const m = osc(ctx, 'sawtooth', 85 * p, ts, ts + dur + 0.25);
  m.frequency.setValueAtTime(70 * p, ts);
  m.frequency.linearRampToValueAtTime(110 * p, ts + dur * 0.3);
  m.frequency.linearRampToValueAtTime(80 * p, ts + dur);
  const mg = gainNode(ctx, 0);
  end = max(end, ahrEnv(mg.gain, ts, 0.18, 0.05, dur * 0.75, 0.04));
  chain(m, biquad(ctx, 'bandpass', 650 * p, 3), mg, s.out);
  end = max(end, noiseBurst(s, s.out, ts, { type: 'highpass', freq: 2000, peak: 0.12, attack: 0.04, tau: 0.12 }));
  end = max(end, noiseBurst(s, s.out, ts, { kind: 'brown', type: 'lowpass', freq: 320, peak: 0.25, attack: 0.08, tau: 0.12 }));
  // Butée de fin de course.
  end = max(end, tone(s, s.out, ts + dur, { freq: 120 * p, freqEnd: 70 * p, sweep: 0.05, peak: 0.25, tau: 0.03 }));
  end = max(end, noiseBurst(s, s.out, ts + dur, { kind: 'pink', type: 'lowpass', freq: 500, peak: 0.25, attack: 0.002, tau: 0.03 }));
  return end;
}

export function doorClose(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.06);
  const dur = 0.42 * jit(0.1);
  const m = osc(ctx, 'sawtooth', 100 * p, t, t + dur + 0.2);
  m.frequency.setValueAtTime(100 * p, t);
  m.frequency.linearRampToValueAtTime(70 * p, t + dur);
  const mg = gainNode(ctx, 0);
  let end = ahrEnv(mg.gain, t, 0.15, 0.04, dur * 0.8, 0.03);
  chain(m, biquad(ctx, 'bandpass', 600 * p, 3), mg, s.out);
  end = max(end, noiseBurst(s, s.out, t, { type: 'highpass', freq: 2200, peak: 0.1, attack: 0.05, tau: 0.08 }));
  end = max(end, noiseBurst(s, s.out, t, { kind: 'brown', type: 'lowpass', freq: 320, peak: 0.22, attack: 0.08, tau: 0.1 }));
  // Fermeture : choc sourd, verrou et joint pneumatique.
  const ts = t + dur;
  end = max(end, tone(s, s.out, ts, { freq: 88 * p, freqEnd: 45 * p, sweep: 0.12, peak: 0.85, attack: 0.002, tau: 0.09 }));
  end = max(end, noiseBurst(s, s.out, ts, { kind: 'pink', type: 'lowpass', freq: 350 * p, q: 1, peak: 0.8, attack: 0.001, tau: 0.065 }));
  end = max(end, tone(s, s.out, ts, { freq: 260 * p, peak: 0.25, tau: 0.05 }));
  end = max(end, noiseBurst(s, s.out, ts + 0.012, { type: 'highpass', freq: 2500, peak: 0.4, attack: 0.0004, tau: 0.004 }));
  end = max(end, noiseBurst(s, s.out, ts + 0.03, { type: 'bandpass', freq: 3000, q: 0.8, peak: 0.1, attack: 0.01, tau: 0.08 }));
  return end;
}

/* ------------------------------------------------------------------ police */

/** Courte salve de sirène NYPD 2085 : deux « whoops » montants puis quatre « yelps » rapides. */
export function policeSiren(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.015);
  const total = 1.55;
  const stop = t + total + 0.1;
  const o1 = osc(ctx, 'sawtooth', 700 * p, t, stop);
  const o2 = osc(ctx, 'square', 700 * p, t, stop, 5);
  const rum = osc(ctx, 'square', 175 * p, t, stop);
  const curve = (o: OscillatorNode, r: number): void => {
    const f = o.frequency;
    let tt = t;
    for (let k = 0; k < 2; k++) {
      f.setValueAtTime(560 * p * r, tt);
      f.exponentialRampToValueAtTime(1480 * p * r, tt + 0.3);
      tt += 0.38;
    }
    f.setValueAtTime(760 * p * r, tt);
    for (let k = 0; k < 4; k++) {
      f.exponentialRampToValueAtTime(1500 * p * r, tt + 0.09);
      f.exponentialRampToValueAtTime(760 * p * r, tt + 0.19);
      tt += 0.19;
    }
  };
  curve(o1, 1);
  curve(o2, 1);
  curve(rum, 0.25);
  const env = gainNode(ctx, 0);
  const seg = (a: number, b: number): void => {
    env.gain.setValueAtTime(0, t + a);
    env.gain.linearRampToValueAtTime(0.3, t + a + 0.02);
    env.gain.setValueAtTime(0.3, t + b - 0.04);
    env.gain.linearRampToValueAtTime(0, t + b);
  };
  seg(0, 0.36);
  seg(0.38, 0.74);
  seg(0.76, total);
  const bp = biquad(ctx, 'bandpass', 1300, 0.8);
  const pres = biquad(ctx, 'peaking', 2500, 1, 4);
  const sh = ctx.createWaveShaper();
  sh.curve = s.res.shaperCurve(1.8);
  o1.connect(bp);
  chain(o2, gainNode(ctx, 0.4), bp);
  chain(bp, pres, sh, env);
  chain(rum, biquad(ctx, 'lowpass', 280, 0.7), gainNode(ctx, 0.35), env);
  env.connect(s.out);
  return stop;
}

const RADIO_VOWELS: ReadonlyArray<readonly [number, number]> = [[700, 1200], [500, 1800], [750, 1100], [550, 850], [350, 2100]];

/** Radio de police : squelch, voix brouillée (bande étroite, saturée), bip de fin « roger ». */
export function policeRadio(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p;
  const radio = gainNode(ctx, 1);
  const sh = ctx.createWaveShaper();
  sh.curve = s.res.shaperCurve(4);
  chain(radio, biquad(ctx, 'highpass', 420, 0.7), biquad(ctx, 'lowpass', 2800, 0.9), sh, gainNode(ctx, 0.5), s.out);
  let end = noiseBurst(s, radio, t, { type: 'bandpass', freq: 1800, q: 0.6, peak: 0.5, attack: 0.002, tau: 0.03 });
  const tv = t + 0.09;
  const dur = rnd(0.7, 1.0);
  const f0 = rnd(105, 135) * p;
  const v = osc(ctx, 'sawtooth', f0, tv, tv + dur + 0.05);
  const f1 = biquad(ctx, 'bandpass', 700, 4);
  const f2 = biquad(ctx, 'bandpass', 1500, 5);
  const env = gainNode(ctx, 0);
  env.gain.setValueAtTime(0, tv);
  let tt = tv;
  while (tt < tv + dur - 0.06) {
    const sd = rnd(0.06, 0.15);
    const [a, b] = pick(RADIO_VOWELS);
    const lvl = rnd(0.5, 1);
    f1.frequency.setValueAtTime(a, tt);
    f2.frequency.setValueAtTime(b, tt);
    v.frequency.setValueAtTime(f0 * rnd(0.9, 1.25), tt);
    env.gain.setValueAtTime(0, tt);
    env.gain.linearRampToValueAtTime(lvl, tt + 0.015);
    env.gain.setValueAtTime(lvl, tt + sd - 0.02);
    env.gain.linearRampToValueAtTime(0, tt + sd);
    tt += sd + rnd(0.01, 0.05);
  }
  v.connect(f1);
  f1.connect(env);
  chain(v, f2, gainNode(ctx, 0.6), env);
  chain(env, gainNode(ctx, 1.4), radio);
  end = max(end, noiseBurst(s, radio, tv, { type: 'bandpass', freq: 2000, q: 0.7, peak: 0.05, attack: 0.02, tau: dur * 0.5 }));
  const te = tv + dur + 0.04;
  end = max(end, noiseBurst(s, radio, te, { type: 'bandpass', freq: 1800, q: 0.6, peak: 0.45, attack: 0.002, tau: 0.025 }));
  end = max(end, tone(s, radio, te + 0.06, { freq: 1050, peak: 0.25, attack: 0.003, hold: 0.09, tau: 0.01 }));
  return end;
}

/* ------------------------------------------------------------------ véhicules */

/**
 * Courbe Doppler (passage d'un véhicule) : la hauteur glisse de `inR` à
 * `outR` autour du milieu du passage.
 */
function dopplerCurve(f: number, inR: number, outR: number, n = 32): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const sg = 0.5 + 0.5 * Math.tanh(6 * (u - 0.5));
    c[i] = f * (inR + (outR - inR) * sg);
  }
  return c;
}

/** Enveloppe de passage : monte jusqu'au milieu puis s'éloigne. */
function passSwell(ctx: BaseAudioContext, t: number, T: number, peak: number): GainNode {
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + T * 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + T);
  return g;
}

/** Klaxon double ton de taxi new-yorkais (« bip-biiip » ou un coup long). */
export function carHorn(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.03);
  const blasts: ReadonlyArray<readonly [number, number]> = Math.random() < 0.55 ? [[0, 0.13], [0.2, 0.5]] : [[0, 0.55]];
  const [ls, ld] = blasts[blasts.length - 1];
  const stop = t + ls + ld + 0.1;
  const oA = osc(ctx, 'sawtooth', 392 * p, t, stop);
  const oB = osc(ctx, 'square', 494 * p, t, stop);
  const bp = biquad(ctx, 'bandpass', 900, 0.9);
  const pk = biquad(ctx, 'peaking', 2200, 1.2, 5);
  const sh = ctx.createWaveShaper();
  sh.curve = s.res.shaperCurve(2);
  const env = gainNode(ctx, 0);
  env.gain.setValueAtTime(0, t);
  for (const [st, d] of blasts) {
    env.gain.setValueAtTime(0, t + st);
    env.gain.linearRampToValueAtTime(0.3, t + st + 0.012);
    env.gain.setValueAtTime(0.3, t + st + d - 0.02);
    env.gain.linearRampToValueAtTime(0, t + st + d);
  }
  oA.connect(bp);
  chain(oB, gainNode(ctx, 0.7), bp);
  chain(bp, pk, sh, env, s.out);
  return stop;
}

/** Voiture volante qui passe : souffle d'air, turbine avec effet Doppler, grave. */
export function hoverPass(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.06);
  const T = 2.2 * jit(0.12);
  const side = Math.random() < 0.5 ? -1 : 1;
  const dest = s.spatial ? s.out : panSweep(ctx, s.out, t, -0.85 * side, 0.85 * side, T);
  const swell = passSwell(ctx, t, T, 1);
  swell.connect(dest);
  const nz = noise(s, 'pink', t, T + 0.05);
  const bp = biquad(ctx, 'bandpass', 2400 * p, 0.8);
  bp.frequency.setValueAtTime(2600 * p, t);
  bp.frequency.exponentialRampToValueAtTime(1500 * p, t + T * 0.5);
  bp.frequency.exponentialRampToValueAtTime(600 * p, t + T);
  chain(nz, bp, gainNode(ctx, 0.9), swell);
  for (const [f, a] of [[900, 0.08], [1350, 0.05], [2700, 0.02]] as const) {
    const o = osc(ctx, 'sine', f * p, t, t + T + 0.05);
    o.frequency.setValueCurveAtTime(dopplerCurve(f * p, 1.12, 0.86), t, T);
    chain(o, gainNode(ctx, a), swell);
  }
  const hum = osc(ctx, 'sawtooth', 70 * p, t, t + T + 0.05);
  hum.frequency.setValueCurveAtTime(dopplerCurve(70 * p, 1.08, 0.9), t, T);
  chain(hum, biquad(ctx, 'lowpass', 260, 0.8), gainNode(ctx, 0.3), swell);
  return t + T + 0.05;
}

/** Pulsation brève d'un moteur de sustentation (ancien « horse_clop »). */
export function hoverThrum(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.08);
  let end = tone(s, s.out, t, { type: 'triangle', freq: 95 * p, freqEnd: 80 * p, sweep: 0.25, peak: 0.25, attack: 0.04, tau: 0.07 });
  end = max(end, noiseBurst(s, s.out, t, { kind: 'pink', type: 'bandpass', freq: 700 * p, q: 0.8, peak: 0.35, attack: 0.05, tau: 0.06 }));
  end = max(end, tone(s, s.out, t, { freq: 1150 * p, peak: 0.02, attack: 0.03, tau: 0.05 }));
  return end;
}

/** Drone qui passe : rotors (battements), modulation des pales, sifflement du moteur. */
export function dronePass(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.06);
  const T = 2.6 * jit(0.12);
  const side = Math.random() < 0.5 ? -1 : 1;
  const dest = s.spatial ? s.out : panSweep(ctx, s.out, t, -0.8 * side, 0.8 * side, T);
  const swell = passSwell(ctx, t, T, 1);
  swell.connect(dest);
  // Modulation des pales (« flutter ») sur les rotors.
  const am = gainNode(ctx, 0.65);
  const lfo = osc(ctx, 'sine', 46, t, t + T + 0.05);
  chain(lfo, gainNode(ctx, 0.35), am.gain);
  const rotorLp = biquad(ctx, 'lowpass', 3200, 0.7);
  chain(rotorLp, am, swell);
  for (const f of [192, 199]) {
    const o = osc(ctx, 'sawtooth', f * p, t, t + T + 0.05);
    o.frequency.setValueCurveAtTime(dopplerCurve(f * p, 1.06, 0.94), t, T);
    chain(o, gainNode(ctx, 0.12), rotorLp);
  }
  const w = osc(ctx, 'sine', 1400 * p, t, t + T + 0.05);
  w.frequency.setValueCurveAtTime(dopplerCurve(1400 * p, 1.06, 0.94), t, T);
  chain(w, gainNode(ctx, 0.04), swell);
  const nz = noise(s, 'white', t, T + 0.05);
  chain(nz, biquad(ctx, 'bandpass', 2500, 0.8), gainNode(ctx, 0.05), swell);
  return t + T + 0.05;
}

/** Portière : servomoteur, fermeture lourde, verrou et bip de verrouillage. */
export function vehicleDoor(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.05);
  let end = tone(s, s.out, t, { type: 'sawtooth', freq: 220 * p, freqEnd: 330 * p, sweep: 0.14, peak: 0.02, attack: 0.02, hold: 0.08, tau: 0.02 });
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 1500 * p, q: 1.5, peak: 0.07, attack: 0.04, tau: 0.04 }));
  const tc = t + 0.15;
  end = max(end, tone(s, s.out, tc, { freq: 90 * p, freqEnd: 48 * p, sweep: 0.1, peak: 0.8, attack: 0.002, tau: 0.07 }));
  end = max(end, noiseBurst(s, s.out, tc, { kind: 'pink', type: 'lowpass', freq: 420 * p, q: 1, peak: 0.9, attack: 0.001, tau: 0.05 }));
  end = max(end, tone(s, s.out, tc, { freq: 310 * p, peak: 0.2, tau: 0.05 }));
  end = max(end, noiseBurst(s, s.out, tc + 0.02, { type: 'bandpass', freq: 2600 * p, q: 1.6, peak: 0.35, attack: 0.0004, tau: 0.004 }));
  end = max(end, tone(s, s.out, tc + 0.08, { freq: 1980 * p, peak: 0.025, attack: 0.002, hold: 0.03, tau: 0.01 }));
  return end;
}

/** Rame de métro qui arrive : grondement, joints de rail, moteurs qui décélèrent, freins, souffle, carillon. */
export function subwayTrain(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.03);
  const tStop = t + 6.0;
  const rum = noise(s, 'brown', t, 7.2);
  const rlp = biquad(ctx, 'lowpass', 120, 0.8);
  rlp.frequency.setValueAtTime(90, t);
  rlp.frequency.linearRampToValueAtTime(220, t + 2.5);
  rlp.frequency.linearRampToValueAtTime(110, tStop);
  const rg = gainNode(ctx, 0);
  rg.gain.setValueAtTime(0.0001, t);
  rg.gain.exponentialRampToValueAtTime(0.9, t + 2.6);
  rg.gain.linearRampToValueAtTime(0.5, t + 4.5);
  rg.gain.linearRampToValueAtTime(0.0001, tStop + 0.6);
  chain(rum, rlp, rg, s.out);
  // Joints de rail : « ta-tac » de plus en plus espacés.
  const clacks: Array<[number, number]> = [];
  let tt = 0.5, gap = 0.42;
  while (tt < 5.8) {
    const a = Math.min(1, tt / 2.5) * (tt > 4.5 ? Math.max(0.2, (5.8 - tt) / 1.3) : 1) * 0.35;
    clacks.push([tt, a], [tt + 0.075 * (gap / 0.42), a * 0.8]);
    tt += gap;
    gap *= 1.07;
  }
  grains(s, s.out, t, clacks, { type: 'bandpass', freq: 1300 * p, q: 1.3, tau: 0.008 });
  grains(s, s.out, t, clacks.map(([o, a]) => [o, a * 1.2] as const), { kind: 'pink', type: 'lowpass', freq: 300, tau: 0.02 });
  // Moteurs électriques qui descendent.
  const m = osc(ctx, 'sawtooth', 820 * p, t + 1, tStop + 0.3);
  m.frequency.setValueAtTime(820 * p, t + 1);
  m.frequency.exponentialRampToValueAtTime(260 * p, tStop);
  const mg = gainNode(ctx, 0);
  mg.gain.setValueAtTime(0, t + 1);
  mg.gain.linearRampToValueAtTime(0.06, t + 2);
  mg.gain.linearRampToValueAtTime(0.05, t + 5);
  mg.gain.linearRampToValueAtTime(0, tStop + 0.2);
  chain(m, biquad(ctx, 'bandpass', 900, 2), mg, s.out);
  // Crissement des freins (frottement saccadé).
  const sq = osc(ctx, 'triangle', 3100 * p, t + 3.6, tStop + 0.25);
  sq.frequency.setValueAtTime(3100 * p, t + 3.6);
  sq.frequency.linearRampToValueAtTime(3350 * p, t + 4.6);
  sq.frequency.linearRampToValueAtTime(2900 * p, tStop);
  const vib = osc(ctx, 'sine', 9.5, t + 3.6, tStop + 0.25);
  chain(vib, gainNode(ctx, 60), sq.frequency);
  const am = gainNode(ctx, 0.6);
  const slip = osc(ctx, 'sine', 13, t + 3.6, tStop + 0.25);
  chain(slip, gainNode(ctx, 0.4), am.gain);
  const sg = gainNode(ctx, 0);
  sg.gain.setValueAtTime(0, t + 3.6);
  sg.gain.linearRampToValueAtTime(0.07, t + 4.2);
  sg.gain.linearRampToValueAtTime(0.045, t + 5.2);
  sg.gain.linearRampToValueAtTime(0.09, t + 5.7);
  sg.gain.linearRampToValueAtTime(0, tStop + 0.15);
  chain(sq, am, sg, s.out);
  // Souffle pneumatique à l'arrêt, puis carillon des portes.
  noiseBurst(s, s.out, tStop + 0.1, { type: 'highpass', freq: 2200, peak: 0.35, attack: 0.03, tau: 0.25 });
  noiseBurst(s, s.out, tStop + 0.1, { type: 'bandpass', freq: 600, q: 0.7, peak: 0.25, attack: 0.05, tau: 0.2 });
  fmTone(s, s.out, tStop + 0.9, { freq: 659.3 * p, ratio: 2, index: 0.8, peak: 0.1, tau: 0.35 });
  return fmTone(s, s.out, tStop + 1.25, { freq: 523.3 * p, ratio: 2, index: 0.8, peak: 0.1, tau: 0.5 });
}

/* ------------------------------------------------------------------ immeubles */

/** « Ding » cristallin d'ascenseur de luxe. */
export function elevatorDing(s: SfxCtx): number {
  const { t } = s;
  const f = 1318.5 * s.p;
  let end = fmTone(s, s.out, t, { freq: f, ratio: 3.5, index: 1.2, peak: 0.22, attack: 0.002, tau: 0.55 });
  end = max(end, partials(s, s.out, t, f, 0.12, GLASS));
  return end;
}

/** Salve d'alarme d'immeuble : deux tons alternés stridents. */
export function alarmBurst(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.01);
  const T = 2.0;
  const stop = t + T + 0.05;
  const o = osc(ctx, 'square', 960 * p, t, stop);
  const o2 = osc(ctx, 'square', 960 * p, t, stop, 12);
  for (let k = 0; k < 8; k++) {
    const f = (k % 2 ? 770 : 960) * p;
    o.frequency.setValueAtTime(f, t + k * 0.25);
    o2.frequency.setValueAtTime(f, t + k * 0.25);
  }
  const lp = biquad(ctx, 'lowpass', 6000, 0.7);
  const env = gainNode(ctx, 0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.18, t + 0.01);
  env.gain.setValueAtTime(0.18, t + T - 0.03);
  env.gain.linearRampToValueAtTime(0, t + T);
  o.connect(lp);
  chain(o2, gainNode(ctx, 0.5), lp);
  chain(lp, biquad(ctx, 'peaking', 2000, 1.2, 4), env, s.out);
  return stop;
}
