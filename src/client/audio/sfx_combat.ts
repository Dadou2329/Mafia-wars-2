/**
 * Sons de combat : lecture des banques précalculées (coups de feu, pas),
 * mêlée (poing, couteau, lame thermique, matraque électrique), impacts,
 * explosions, manipulation des armes connectées de 2085.
 * Chaque fonction programme ses nœuds dans `s.out` à partir de `s.t` et
 * renvoie l'instant où le son est silencieux.
 */
import { COIN } from './instruments';
import {
  biquad, chain, expSweep, gainNode, grains, jit, noise, noiseBurst, osc, partials, rnd,
  type SynthEnv, TAU_END, tone, trackSource,
} from './synth';

export interface SfxCtx extends SynthEnv {
  /** Nœud d'entrée de la voix. */
  out: AudioNode;
  /** Instant de départ (secondes de l'AudioContext). */
  t: number;
  /** Multiplicateur de hauteur demandé par l'appelant. */
  p: number;
  /** Vrai si la voix est positionnée en 3D (pas de panoramique stéréo interne). */
  spatial: boolean;
}

const max = Math.max;

/* ------------------------------------------------------------------ banques précalculées */

/**
 * Rejoue une variante précalculée (coups de feu, pas) : une seule source
 * tampon, en évitant de répéter deux fois de suite la même variante.
 */
export function playBank(s: SfxCtx, variants: AudioBuffer[], last: { v: number }, pitchJit = 0.06): number {
  let i = Math.floor(Math.random() * variants.length);
  if (i === last.v && variants.length > 1) i = (i + 1) % variants.length;
  last.v = i;
  const src = s.ctx.createBufferSource();
  src.buffer = variants[i];
  const rate = s.p * jit(pitchJit);
  src.playbackRate.value = rate;
  src.connect(s.out);
  src.start(s.t);
  trackSource(src);
  return s.t + variants[i].duration / rate + 0.01;
}

/* ------------------------------------------------------------------ mêlée */

export function punch(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.08);
  const shaper = ctx.createWaveShaper();
  shaper.curve = s.res.shaperCurve(2);
  chain(shaper, gainNode(ctx, 0.8), s.out);
  let end = tone(s, shaper, t, { freq: 150 * p, freqEnd: 60 * p, sweep: 0.06, peak: 0.55, attack: 0.001, tau: 0.035 });
  end = max(end, noiseBurst(s, shaper, t, { kind: 'pink', type: 'lowpass', freq: 1000 * p, q: 1, peak: 2.6, attack: 0.001, tau: 0.03 }));
  end = max(end, noiseBurst(s, shaper, t, { kind: 'pink', type: 'bandpass', freq: 260 * p, q: 1, peak: 1.6, attack: 0.001, tau: 0.04 }));
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 2500 * p, q: 1.2, peak: 1.8, attack: 0.0004, tau: 0.006 }));
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 1200, q: 0.7, peak: 0.12, attack: 0.008, tau: 0.02 }));
  return end;
}

export function knife(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.07);
  // Fouettement rapide de la lame puis le coup.
  let end = noiseBurst(s, s.out, t, { type: 'bandpass', freq: 2000 * p, freqEnd: 5500 * p, sweep: 0.07, q: 2, peak: 0.22, attack: 0.035, tau: 0.018 });
  const ts = t + 0.055;
  end = max(end, noiseBurst(s, s.out, ts, { kind: 'pink', type: 'lowpass', freq: 700 * p, q: 1.5, peak: 0.75, attack: 0.002, tau: 0.045 }));
  end = max(end, noiseBurst(s, s.out, ts, { type: 'bandpass', freq: 1400 * p, freqEnd: 650 * p, sweep: 0.06, q: 3, peak: 0.4, attack: 0.002, tau: 0.03 }));
  end = max(end, noiseBurst(s, s.out, ts, { type: 'highpass', freq: 4500, q: 0.7, peak: 0.25, attack: 0.001, tau: 0.014 }));
  end = max(end, tone(s, s.out, ts, { freq: 120 * p, freqEnd: 60 * p, sweep: 0.05, peak: 0.45, tau: 0.04 }));
  end = max(end, partials(s, s.out, t + 0.01, 2900 * p, 0.06, [[1, 1, 0.12], [1.48, 0.6, 0.08], [2.3, 0.3, 0.05]]));
  return end;
}

/** Lame thermique : bourdonnement de plasma qui monte avec le geste, souffle, grésillement, brûlure. */
export function thermalKnife(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.06);
  const dur = 0.32 * jit(0.1);
  const stop = t + dur + 0.6;
  const bend = (o: OscillatorNode, r: number): void => {
    o.frequency.setValueAtTime(105 * p * r, t);
    o.frequency.linearRampToValueAtTime(165 * p * r, t + dur * 0.45);
    o.frequency.exponentialRampToValueAtTime(118 * p * r, t + dur + 0.2);
  };
  const h1 = osc(ctx, 'sawtooth', 105 * p, t, stop);
  const h2 = osc(ctx, 'sawtooth', 105 * p, t, stop, 9);
  bend(h1, 1);
  bend(h2, 1.5);
  const bp = biquad(ctx, 'bandpass', 420 * p, 1.8);
  bp.frequency.setValueAtTime(380 * p, t);
  bp.frequency.linearRampToValueAtTime(950 * p, t + dur * 0.45);
  bp.frequency.exponentialRampToValueAtTime(450 * p, t + dur + 0.2);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.4, t + 0.04);
  g.gain.setValueAtTime(0.4, t + dur * 0.6);
  g.gain.setTargetAtTime(0, t + dur * 0.6, 0.07);
  h1.connect(bp);
  chain(h2, gainNode(ctx, 0.5), bp);
  chain(bp, g, s.out);
  let end = t + dur * 0.6 + 0.07 * TAU_END;
  // Souffle du geste.
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 600 * p, freqEnd: 2800 * p, sweep: dur * 0.45, q: 1.4, peak: 0.3, attack: dur * 0.4, tau: dur * 0.18 }));
  // Grésillement du plasma.
  const crack: Array<[number, number]> = [];
  for (let i = 0; i < 22; i++) crack.push([rnd(0, dur + 0.1), rnd(0.03, 0.16)]);
  end = max(end, grains(s, s.out, t, crack, { type: 'highpass', freq: 3800, tau: 0.0025 }));
  // Brûlure au contact.
  const ts = t + dur * 0.5;
  end = max(end, noiseBurst(s, s.out, ts, { type: 'highpass', freq: 2600, peak: 0.14, attack: 0.005, tau: 0.06 }));
  end = max(end, tone(s, s.out, ts, { freq: 3200 * p, freqEnd: 1400 * p, sweep: 0.15, peak: 0.045, attack: 0.002, tau: 0.05 }));
  end = max(end, noiseBurst(s, s.out, ts, { kind: 'pink', type: 'lowpass', freq: 600 * p, peak: 0.5, attack: 0.002, tau: 0.035 }));
  return end;
}

export function club(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.08);
  const shaper = ctx.createWaveShaper();
  shaper.curve = s.res.shaperCurve(2.5);
  chain(shaper, gainNode(ctx, 0.8), s.out);
  let end = tone(s, shaper, t, { freq: 115 * p, freqEnd: 50 * p, sweep: 0.08, peak: 0.45, attack: 0.001, tau: 0.045 });
  end = max(end, noiseBurst(s, shaper, t, { kind: 'pink', type: 'lowpass', freq: 650 * p, q: 1, peak: 2.4, attack: 0.001, tau: 0.045 }));
  end = max(end, tone(s, s.out, t, { freq: 640 * p, peak: 0.55, attack: 0.001, tau: 0.045 }));
  end = max(end, tone(s, s.out, t, { freq: 1130 * p, peak: 0.28, attack: 0.001, tau: 0.03 }));
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 700 * p, q: 6, peak: 1.8, attack: 0.001, tau: 0.04 }));
  end = max(end, noiseBurst(s, s.out, t, { type: 'highpass', freq: 2500, peak: 0.8, attack: 0.0004, tau: 0.004 }));
  return end;
}

/** Matraque électrique : arc électrique haché, crépitements, étincelle et impact. */
export function stunBaton(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.06);
  const dur = 0.32 * jit(0.12);
  const stop = t + dur + 0.1;
  const o1 = osc(ctx, 'square', 72 * p, t, stop);
  const o2 = osc(ctx, 'sawtooth', 113 * p, t, stop);
  const hp = biquad(ctx, 'highpass', 350, 0.7);
  const shaper = ctx.createWaveShaper();
  shaper.curve = s.res.shaperCurve(3);
  const vca = gainNode(ctx, 0);
  vca.gain.setValueAtTime(0, t);
  vca.gain.linearRampToValueAtTime(0.22, t + 0.005);
  vca.gain.setValueAtTime(0.22, t + dur * 0.8);
  vca.gain.linearRampToValueAtTime(0, t + dur);
  // L'arc « hache » : du bruit basse fréquence module l'amplitude.
  const nz = noise(s, 'white', t, dur + 0.1);
  const nlp = biquad(ctx, 'lowpass', 90, 0.7);
  const depth = gainNode(ctx, 0);
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(5, t + 0.01);
  depth.gain.setValueAtTime(5, t + dur * 0.8);
  depth.gain.linearRampToValueAtTime(0, t + dur);
  chain(nz, nlp, depth, vca.gain);
  o1.connect(hp); o2.connect(hp);
  chain(hp, shaper, vca, gainNode(ctx, 0.6), s.out);
  let end = t + dur + 0.02;
  const crack: Array<[number, number]> = [];
  for (let i = 0; i < 26; i++) crack.push([rnd(0, dur), rnd(0.1, 0.5)]);
  end = max(end, grains(s, s.out, t, crack, { type: 'highpass', freq: 3000, tau: 0.002 }));
  // Étincelle d'attaque et impact sourd.
  end = max(end, noiseBurst(s, s.out, t, { type: 'highpass', freq: 2000, peak: 0.6, attack: 0.0003, tau: 0.004 }));
  end = max(end, tone(s, s.out, t, { freq: 140 * p, freqEnd: 60 * p, sweep: 0.06, peak: 0.4, attack: 0.001, tau: 0.03 }));
  end = max(end, noiseBurst(s, s.out, t, { kind: 'pink', type: 'lowpass', freq: 900 * p, peak: 1.2, attack: 0.001, tau: 0.03 }));
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
  end = max(end, noiseBurst(s, s.out, t, { kind: 'pink', type: 'lowpass', freq: 800 * p, q: 1.2, peak: 2.2, attack: 0.001, tau: 0.04 }));
  end = max(end, noiseBurst(s, s.out, t + 0.004, { type: 'bandpass', freq: 1100 * p, freqEnd: 600 * p, sweep: 0.05, q: 4, peak: 0.9, attack: 0.002, tau: 0.028 }));
  return end;
}

/** Balle dans le béton : claquement, éclats, poussière. */
export function hitWall(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.1);
  let end = noiseBurst(s, s.out, t, { type: 'highpass', freq: 1800 * p, peak: 0.8, attack: 0.0004, tau: 0.006 });
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 3400 * p, q: 1, peak: 0.4, attack: 0.0005, tau: 0.012 }));
  end = max(end, tone(s, s.out, t, { freq: 150 * p, freqEnd: 70 * p, sweep: 0.03, peak: 0.3, tau: 0.02 }));
  const debris: Array<[number, number]> = [];
  const n = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) debris.push([0.02 + Math.pow(Math.random(), 1.5) * 0.25, rnd(0.08, 0.25)]);
  end = max(end, grains(s, s.out, t, debris, { type: 'bandpass', freq: 3800 * p, q: 1.5, tau: 0.004 }));
  end = max(end, noiseBurst(s, s.out, t + 0.01, { kind: 'pink', type: 'bandpass', freq: 800, q: 0.5, peak: 0.12, attack: 0.01, tau: 0.07 }));
  return end;
}

export function hitWood(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.1);
  let end = tone(s, s.out, t, { freq: 430 * p, peak: 0.45, attack: 0.001, tau: 0.05 });
  end = max(end, tone(s, s.out, t, { freq: 990 * p, peak: 0.25, attack: 0.001, tau: 0.03 }));
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 1500 * p, q: 2, peak: 0.6, attack: 0.0005, tau: 0.008 }));
  end = max(end, noiseBurst(s, s.out, t, { kind: 'pink', type: 'lowpass', freq: 420 * p, peak: 0.4, attack: 0.001, tau: 0.03 }));
  end = max(end, grains(s, s.out, t, [[0.012, 0.2], [0.027, 0.14], [0.05, 0.09]], { type: 'bandpass', freq: 3000 * p, q: 2, tau: 0.003 }));
  return end;
}

export function hitMetal(s: SfxCtx): number {
  const { t } = s;
  const f0 = rnd(380, 620) * s.p;
  let end = partials(s, s.out, t, f0, 0.32, [[1, 1, 0.32], [2.76, 0.55, 0.22], [5.4, 0.3, 0.13], [8.93, 0.16, 0.07], [1.52, 0.25, 0.2]]);
  end = max(end, noiseBurst(s, s.out, t, { type: 'highpass', freq: 3000, peak: 0.6, attack: 0.0003, tau: 0.003 }));
  return end;
}

export function ricochet(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.12);
  const dur = rnd(0.32, 0.5);
  const f0 = 3600 * p;
  const f1 = rnd(900, 1400) * p;
  let end = noiseBurst(s, s.out, t, { type: 'highpass', freq: 2500, peak: 0.5, attack: 0.0003, tau: 0.004 });
  // Sifflement avec léger vibrato.
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
  end = max(end, t + dur * 0.35 + dur * 0.22 * TAU_END);
  end = max(end, noiseBurst(s, s.out, t + 0.005, { type: 'bandpass', freq: f0, freqEnd: f1, sweep: dur, q: 7, peak: 0.3, attack: 0.01, tau: dur * 0.3 }));
  return end;
}

/** Petit verre brisé (bouteille, écran). */
export function glass(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.08);
  let end = noiseBurst(s, s.out, t, { type: 'highpass', freq: 2500 * p, peak: 0.7, attack: 0.0005, tau: 0.012 });
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 5200 * p, q: 1.2, peak: 0.35, attack: 0.001, tau: 0.05 }));
  // Éclats qui tintent : première salve puis morceaux qui retombent.
  for (let i = 0; i < 9; i++) {
    const dt = i < 4 ? rnd(0, 0.06) : rnd(0.12, 0.55);
    end = max(end, tone(s, s.out, t + dt, {
      freq: rnd(2600, 7200) * p, peak: rnd(0.04, 0.12) * (i < 4 ? 1.4 : 1), attack: 0.0005, tau: rnd(0.03, 0.11),
    }));
  }
  const fall: Array<[number, number]> = [];
  for (let i = 0; i < 12; i++) fall.push([rnd(0.08, 0.6), rnd(0.05, 0.22)]);
  end = max(end, grains(s, s.out, t, fall, { type: 'bandpass', freq: 6000 * p, q: 1.5, tau: 0.005 }));
  return end;
}

/** Grande vitre qui vole en éclats (vitrine, baie vitrée). */
export function glassBreak(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.06);
  let end = noiseBurst(s, s.out, t, { type: 'highpass', freq: 2200 * p, peak: 1.0, attack: 0.0005, tau: 0.025 });
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 4800 * p, q: 1, peak: 0.5, attack: 0.001, tau: 0.09 }));
  end = max(end, tone(s, s.out, t, { freq: 140 * p, freqEnd: 70 * p, sweep: 0.08, peak: 0.35, tau: 0.05 }));
  for (let i = 0; i < 14; i++) {
    const first = i < 6;
    const dt = first ? rnd(0, 0.08) : rnd(0.12, 1.1);
    end = max(end, tone(s, s.out, t + dt, {
      freq: rnd(2400, 8000) * p, peak: rnd(0.04, 0.12) * (first ? 1.5 : 1), attack: 0.0005, tau: rnd(0.03, 0.14),
    }));
  }
  const fall: Array<[number, number]> = [];
  for (let i = 0; i < 30; i++) { const dt = rnd(0.05, 1.3); fall.push([dt, rnd(0.05, 0.3) * (1 - dt / 1.5)]); }
  end = max(end, grains(s, s.out, t, fall, { type: 'bandpass', freq: 5500 * p, q: 1.2, tau: 0.005 }));
  const chunks: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) chunks.push([rnd(0.08, 1.0), rnd(0.1, 0.3)]);
  end = max(end, grains(s, s.out, t, chunks, { type: 'bandpass', freq: 2500 * p, q: 1.5, tau: 0.008 }));
  return end;
}

/** Explosion : souffle saturé, grave qui plonge, grondement, débris et crépitements. */
export function explosion(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.06);
  const shaper = ctx.createWaveShaper();
  shaper.curve = s.res.shaperCurve(3);
  chain(shaper, gainNode(ctx, 0.7), s.out);
  let end = noiseBurst(s, shaper, t, { type: 'lowpass', freq: 7000 * p, freqEnd: 260 * p, sweep: 0.6, q: 0.9, peak: 2.6, attack: 0.002, tau: 0.22 });
  end = max(end, noiseBurst(s, s.out, t, { type: 'highpass', freq: 1200, peak: 1.2, attack: 0.0004, tau: 0.008 }));
  end = max(end, tone(s, shaper, t, { freq: 85 * p, freqEnd: 26 * p, sweep: 0.7, peak: 1.0, attack: 0.003, tau: 0.35 }));
  end = max(end, noiseBurst(s, s.out, t + 0.02, { kind: 'brown', type: 'lowpass', freq: 320 * p, q: 0.7, peak: 1.8, attack: 0.06, tau: 0.85 }));
  end = max(end, noiseBurst(s, shaper, t, { kind: 'pink', type: 'bandpass', freq: 600 * p, q: 0.7, peak: 2.0, attack: 0.004, tau: 0.12 }));
  const debris: Array<[number, number]> = [];
  for (let i = 0; i < 18; i++) { const dt = rnd(0.15, 2.0); debris.push([dt, rnd(0.08, 0.3) * (1.2 - dt / 2.4)]); }
  end = max(end, grains(s, s.out, t, debris, { type: 'bandpass', freq: 2600 * p, q: 1.2, tau: 0.006 }));
  const chunks: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) chunks.push([rnd(0.2, 1.6), rnd(0.2, 0.5)]);
  end = max(end, grains(s, s.out, t, chunks, { kind: 'pink', type: 'lowpass', freq: 500, tau: 0.03 }));
  const crackle: Array<[number, number]> = [];
  for (let i = 0; i < 30; i++) crackle.push([rnd(0.05, 1.5), rnd(0.04, 0.2)]);
  end = max(end, grains(s, s.out, t, crackle, { type: 'highpass', freq: 3500, tau: 0.0018 }));
  return end;
}

/** Collision de véhicules : impact sourd, tôle froissée, raclement, verre et débris. */
export function vehicleCrash(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.06);
  const shaper = ctx.createWaveShaper();
  shaper.curve = s.res.shaperCurve(2.5);
  chain(shaper, gainNode(ctx, 0.75), s.out);
  let end = tone(s, shaper, t, { freq: 75 * p, freqEnd: 32 * p, sweep: 0.2, peak: 0.9, attack: 0.002, tau: 0.14 });
  end = max(end, noiseBurst(s, shaper, t, { kind: 'pink', type: 'lowpass', freq: 900 * p, freqEnd: 300 * p, sweep: 0.3, peak: 2.2, attack: 0.002, tau: 0.09 }));
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 1400 * p, freqEnd: 700 * p, sweep: 0.3, q: 2, peak: 0.8, attack: 0.003, tau: 0.16 }));
  end = max(end, partials(s, s.out, t, rnd(180, 260) * p, 0.22, [[1, 1, 0.5], [1.73, 0.7, 0.4], [2.41, 0.5, 0.3], [3.37, 0.35, 0.22], [4.9, 0.25, 0.15], [6.3, 0.15, 0.1]]));
  end = max(end, partials(s, s.out, t + 0.05, rnd(400, 600) * p, 0.1, [[1, 1, 0.3], [2.13, 0.6, 0.2], [3.6, 0.3, 0.12]]));
  const scrape: Array<[number, number]> = [];
  for (let i = 0; i < 40; i++) scrape.push([rnd(0.05, 0.7), rnd(0.1, 0.35)]);
  end = max(end, grains(s, s.out, t, scrape, { type: 'bandpass', freq: 2200 * p, q: 3, tau: 0.004 }));
  for (let i = 0; i < 8; i++) {
    end = max(end, tone(s, s.out, t + rnd(0.02, 0.5), { freq: rnd(3000, 7000), peak: rnd(0.03, 0.08), attack: 0.0005, tau: rnd(0.03, 0.1) }));
  }
  const shards: Array<[number, number]> = [];
  for (let i = 0; i < 20; i++) shards.push([rnd(0.02, 0.9), rnd(0.05, 0.2)]);
  end = max(end, grains(s, s.out, t, shards, { type: 'highpass', freq: 5000, tau: 0.004 }));
  const bits: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) bits.push([rnd(0.1, 1.2), rnd(0.1, 0.35)]);
  end = max(end, grains(s, s.out, t, bits, { kind: 'pink', type: 'lowpass', freq: 600, tau: 0.02 }));
  return end;
}

/* ------------------------------------------------------------------ manipulation des armes */

function click(s: SfxCtx, t: number, freq: number, peak: number, tau = 0.004): number {
  return noiseBurst(s, s.out, t, { type: 'bandpass', freq, q: 1.5, peak, attack: 0.0003, tau });
}

/** Changement de chargeur d'une arme connectée : éjection, insertion, culasse, bip « prêt ». */
export function reload(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.04);
  let end = click(s, t, 2800 * p, 0.5);
  end = max(end, tone(s, s.out, t, { freq: 1200 * p, peak: 0.05, tau: 0.01 }));
  end = max(end, noiseBurst(s, s.out, t + 0.05, { type: 'bandpass', freq: 1500 * p, freqEnd: 2600 * p, sweep: 0.12, q: 1.5, peak: 0.22, attack: 0.03, tau: 0.04 }));
  end = max(end, partials(s, s.out, t + 0.16, rnd(1800, 2400) * p, 0.05, [[1, 1, 0.04], [2.6, 0.5, 0.025]]));
  const ti = t + 0.48;
  end = max(end, noiseBurst(s, s.out, ti - 0.06, { type: 'bandpass', freq: 1800 * p, q: 1.2, peak: 0.18, attack: 0.04, tau: 0.02 }));
  end = max(end, click(s, ti, 1600 * p, 0.65, 0.007));
  end = max(end, tone(s, s.out, ti, { freq: 230 * p, freqEnd: 150 * p, sweep: 0.03, peak: 0.3, tau: 0.025 }));
  const tc = t + 0.74;
  end = max(end, click(s, tc, 3000 * p, 0.55, 0.005));
  end = max(end, click(s, tc + 0.075, 2200 * p, 0.7, 0.007));
  end = max(end, partials(s, s.out, tc + 0.075, 3400 * p, 0.06, [[1, 1, 0.03], [1.48, 0.6, 0.02]]));
  const tb = tc + 0.16;
  end = max(end, tone(s, s.out, tb - 0.1, { freq: 320 * p, freqEnd: 950 * p, sweep: 0.14, peak: 0.035, attack: 0.02, tau: 0.04 }));
  end = max(end, tone(s, s.out, tb, { freq: 1760 * p, peak: 0.05, attack: 0.002, hold: 0.03, tau: 0.012 }));
  end = max(end, tone(s, s.out, tb + 0.06, { freq: 2637 * p, peak: 0.05, attack: 0.002, hold: 0.04, tau: 0.015 }));
  return end;
}

/** Détente à vide + double bip « chargeur vide ». */
export function emptyClick(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.04);
  let end = noiseBurst(s, s.out, t, { type: 'highpass', freq: 2500 * p, peak: 0.6, attack: 0.0003, tau: 0.003 });
  end = max(end, tone(s, s.out, t, { freq: 3200 * p, peak: 0.1, attack: 0.0005, tau: 0.018 }));
  end = max(end, tone(s, s.out, t, { freq: 900 * p, peak: 0.14, attack: 0.0005, tau: 0.008 }));
  end = max(end, tone(s, s.out, t + 0.05, { type: 'square', freq: 520 * p, peak: 0.022, attack: 0.002, hold: 0.035, tau: 0.01 }));
  end = max(end, tone(s, s.out, t + 0.11, { type: 'square', freq: 390 * p, peak: 0.022, attack: 0.002, hold: 0.05, tau: 0.012 }));
  return end;
}

/** Changement d'arme : frottement de l'étui, déclic, synchronisation du HUD. */
export function weaponSwitch(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.05);
  let end = noiseBurst(s, s.out, t, { type: 'bandpass', freq: 1200 * p, freqEnd: 2600 * p, sweep: 0.12, q: 0.8, peak: 0.18, attack: 0.04, tau: 0.04 });
  end = max(end, click(s, t + 0.14, 2600 * p, 0.45));
  end = max(end, tone(s, s.out, t + 0.14, { freq: 1800 * p, peak: 0.08, attack: 0.0005, tau: 0.015 }));
  end = max(end, tone(s, s.out, t + 0.17, { freq: 2400 * p, peak: 0.04, attack: 0.002, hold: 0.02, tau: 0.01 }));
  end = max(end, tone(s, s.out, t + 0.215, { freq: 3200 * p, peak: 0.04, attack: 0.002, hold: 0.025, tau: 0.012 }));
  return end;
}

/** Pièces qui tintent (utilisé par les sons d'argent). */
export function coins(s: SfxCtx, t: number, times: readonly number[], peak: number): number {
  let end = t;
  times.forEach((dt, i) => {
    const g = peak * (1 - (i / Math.max(1, times.length)) * 0.5) * rnd(0.7, 1);
    end = max(end, partials(s, s.out, t + dt, rnd(3400, 6000) * s.p, g, COIN));
  });
  return end;
}
