/**
 * Implants cybernétiques : grappin et treuil, armes d'avant-bras (pistolet, lame, poing
 * hydraulique, fouet), bouclier d'énergie, répulseur, décharges Tesla et IEM, micro-roquettes,
 * déplacements augmentés (esquive, double saut, bond, glissade, course murale, réceptions),
 * visions, camouflage, réflexes, surcharge, cœur de secours, nanobots, drone, piratage, marques,
 * alertes, et les sons de la clinique.
 *
 * Palette sonore : servos (dents de scie glissantes, denture des engrenages), vérins et
 * sifflements hydrauliques (bruit filtré), crépitements électriques (grains très brefs, arcs
 * saturés), coups sous-graves (sinus qui plongent), verre et métal (partiels inharmoniques,
 * FM). Chaque fonction programme ses nœuds dans `s.out` à partir de `s.t` et renvoie l'instant
 * où le son est silencieux.
 */
import { midiHz } from './dsp';
import type { SfxCtx } from './sfx_combat';
import { biquad, chain, expSweep, fmTone, gainNode, grains, jit, noise, noiseBurst, osc, partials, pick, rnd, tone, trackSource } from './synth';

const max = Math.max;

/* ------------------------------------------------------------------ briques */

/** Servo : onde qui glisse de f0 à f1 dans un passe-bande qui suit, denture des engrenages (AM). */
function servo(s: SfxCtx, t: number, f0: number, f1: number, dur: number, peak: number, o: { type?: OscillatorType; q?: number; gear?: number; dest?: AudioNode } = {}): number {
  const { ctx } = s;
  const stop = t + dur + 0.05;
  const src = osc(ctx, o.type ?? 'sawtooth', f0, t, stop);
  expSweep(src.frequency, t, f0, f1, dur);
  const bp = biquad(ctx, 'bandpass', f0 * 2.5, o.q ?? 1.3);
  expSweep(bp.frequency, t, f0 * 2.5, f1 * 2.5, dur);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.min(0.02, dur * 0.25));
  g.gain.setValueAtTime(peak, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0, t + dur);
  if (o.gear) {
    const am = gainNode(ctx, 0.6);
    const lfo = osc(ctx, 'square', o.gear, t, stop);
    chain(lfo, gainNode(ctx, 0.4), am.gain);
    chain(src, bp, am, g, o.dest ?? s.out);
  } else chain(src, bp, g, o.dest ?? s.out);
  return t + dur + 0.02;
}

/** Coup sourd : sinus qui plonge (dans `dest`, par exemple un saturateur). */
function thump(s: SfxCtx, t: number, f0: number, f1: number, peak: number, tau: number, dest: AudioNode = s.out): number {
  return tone(s, dest, t, { freq: f0, freqEnd: f1, sweep: tau * 2.5, peak, attack: 0.002, tau });
}

/** Déclic mécanique bref. */
function click(s: SfxCtx, t: number, freq: number, peak: number, tau = 0.004): number {
  return noiseBurst(s, s.out, t, { type: 'bandpass', freq, q: 1.6, peak, attack: 0.0003, tau });
}

/** Crépitement électrique : n grains très brefs répartis sur `dur`. */
function crackle(s: SfxCtx, t: number, dur: number, n: number, peak: number, freq = 3500): number {
  const hits: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) hits.push([rnd(0, dur), rnd(0.25, 1) * peak]);
  return grains(s, s.out, t, hits, { type: 'highpass', freq, tau: 0.0018 });
}

/** Souffle : bruit en bande dont le filtre glisse de f0 à f1. */
function whoosh(s: SfxCtx, t: number, f0: number, f1: number, dur: number, peak: number, q = 1.4): number {
  return noiseBurst(s, s.out, t, { type: 'bandpass', freq: f0, freqEnd: f1, sweep: dur, q, peak, attack: dur * 0.4, tau: dur * 0.22 });
}

/** Saturateur doux relié à la sortie. */
function shaper(s: SfxCtx, drive: number, level = 0.75): WaveShaperNode {
  const sh = s.ctx.createWaveShaper();
  sh.curve = s.res.shaperCurve(drive);
  chain(sh, gainNode(s.ctx, level), s.out);
  return sh;
}

/** Arc électrique qui bourdonne : carré et dent de scie hachés par du bruit grave, saturés. */
function buzz(s: SfxCtx, t: number, dur: number, f: number, peak: number): number {
  const { ctx } = s;
  const stop = t + dur + 0.05;
  const o1 = osc(ctx, 'square', f, t, stop);
  const o2 = osc(ctx, 'sawtooth', f * 1.51, t, stop);
  const hp = biquad(ctx, 'highpass', 320, 0.7);
  const sat = ctx.createWaveShaper();
  sat.curve = s.res.shaperCurve(3);
  const vca = gainNode(ctx, 0);
  vca.gain.setValueAtTime(0, t);
  vca.gain.linearRampToValueAtTime(peak, t + 0.004);
  vca.gain.setValueAtTime(peak, t + dur * 0.55);
  vca.gain.linearRampToValueAtTime(0, t + dur);
  // le bruit grave « hache » l'arc
  const nz = noise(s, 'white', t, dur + 0.05);
  const nlp = biquad(ctx, 'lowpass', 70, 0.7);
  const depth = gainNode(ctx, 0);
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(peak * 20, t + 0.01);
  depth.gain.setValueAtTime(peak * 20, t + dur * 0.55);
  depth.gain.linearRampToValueAtTime(0, t + dur);
  chain(nz, nlp, depth, vca.gain);
  o1.connect(hp);
  o2.connect(hp);
  chain(hp, sat, vca, gainNode(ctx, 0.55), s.out);
  return t + dur + 0.02;
}

/** Couche d'une banque de coups de feu précalculée (pistolet d'avant-bras) ; rien si pas encore prête. */
function bankLayer(s: SfxCtx, name: 'pistol' | 'pistol_far', rate: number, gain: number, dest: AudioNode = s.out): number {
  const v = s.res.banks[name];
  if (!v || !v.length) return s.t;
  const b = pick(v);
  const src = s.ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate;
  chain(src, gainNode(s.ctx, gain), dest);
  src.start(s.t);
  trackSource(src);
  return s.t + b.duration / rate + 0.01;
}

/** Notes FM « verre » successives. */
function glassNotes(s: SfxCtx, t: number, notes: readonly number[], step: number, peak: number, tau = 0.12, ratio = 3.5): number {
  let end = t;
  notes.forEach((m, i) => {
    end = max(end, fmTone(s, s.out, t + i * step, { freq: midiHz(m) * s.p, ratio, index: 1.2, peak, tau }));
  });
  return end;
}

/* ------------------------------------------------------------------ grappin et treuil */

/** Tir du grappin : détente pneumatique, coup sourd, câble qui file (cliquetis du cabestan). */
export function grappleFire(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.05);
  let end = click(s, t, 2600 * p, 0.9, 0.003);
  end = max(end, noiseBurst(s, s.out, t, { type: 'highpass', freq: 1800 * p, peak: 0.9, attack: 0.001, tau: 0.045 }));
  end = max(end, thump(s, t, 120 * p, 52 * p, 0.6, 0.045));
  end = max(end, noiseBurst(s, s.out, t + 0.01, { type: 'bandpass', freq: 2800 * p, freqEnd: 6200 * p, sweep: 0.28, q: 2.2, peak: 0.35, attack: 0.02, tau: 0.09 }));
  const ratchet: Array<[number, number]> = [];
  for (let i = 0; i < 16; i++) ratchet.push([0.015 + i * 0.016 * (1 + i * 0.05), 0.5 * (1 - i / 18)]);
  end = max(end, grains(s, s.out, t, ratchet, { type: 'bandpass', freq: 3800 * p, q: 2.5, tau: 0.0025 }));
  end = max(end, partials(s, s.out, t + 0.005, 1900 * p, 0.05, [[1, 1, 0.08], [2.76, 0.5, 0.05]]));
  return end;
}

/** Le crochet se plante : choc métallique, débris, et la vibration du câble qui se tend. */
export function grappleHit(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.06);
  let end = noiseBurst(s, s.out, t, { type: 'highpass', freq: 2200, peak: 1.0, attack: 0.0004, tau: 0.006 });
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 1500 * p, q: 1.2, peak: 1.1, attack: 0.001, tau: 0.03 }));
  end = max(end, thump(s, t, 160 * p, 70 * p, 0.55, 0.04));
  end = max(end, partials(s, s.out, t, rnd(820, 980) * p, 0.16, [[1, 1, 0.12], [2.41, 0.6, 0.08], [3.97, 0.35, 0.05], [5.83, 0.2, 0.03]]));
  const debris: Array<[number, number]> = [];
  for (let i = 0; i < 7; i++) debris.push([0.02 + Math.pow(Math.random(), 1.6) * 0.28, rnd(0.1, 0.3)]);
  end = max(end, grains(s, s.out, t, debris, { type: 'bandpass', freq: 3600 * p, q: 1.4, tau: 0.004 }));
  // « twang » du câble tendu : corde grave qui vibre et retombe
  const f = 175 * p;
  const o = osc(ctx, 'sawtooth', f, t + 0.02, t + 0.9);
  o.frequency.setValueAtTime(f * 1.06, t + 0.02);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
  const lfo = osc(ctx, 'sine', 7, t + 0.02, t + 0.9);
  chain(lfo, gainNode(ctx, f * 0.012), o.frequency);
  const lp = biquad(ctx, 'lowpass', 1400 * p, 2);
  lp.frequency.setValueAtTime(2600 * p, t + 0.02);
  lp.frequency.exponentialRampToValueAtTime(500 * p, t + 0.6);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t + 0.02);
  g.gain.linearRampToValueAtTime(0.16, t + 0.025);
  g.gain.setTargetAtTime(0, t + 0.025, 0.13);
  chain(o, lp, g, s.out);
  end = max(end, t + 0.9);
  return end;
}

/** Libération : verrou magnétique qui claque, câble rembobiné en sifflant. */
export function grappleRelease(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.05);
  let end = click(s, t, 3200 * p, 0.8, 0.003);
  end = max(end, tone(s, s.out, t, { freq: 140 * p, freqEnd: 90 * p, sweep: 0.05, peak: 0.25, tau: 0.02 }));
  end = max(end, servo(s, t + 0.01, 380 * p, 1500 * p, 0.17, 0.11, { type: 'square', gear: 90 }));
  end = max(end, whoosh(s, t + 0.02, 5000 * p, 1200 * p, 0.2, 0.3, 1.8));
  end = max(end, click(s, t + 0.2, 2200 * p, 0.6, 0.005));
  return end;
}

/** Treuil spinal : moteur qui force, cliquets, câble qui claque, choc final. */
export function winchYank(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.05);
  const sh = shaper(s, 2, 0.6);
  let end = servo(s, t, 110 * p, 330 * p, 0.32, 0.28, { gear: 38, dest: sh });
  end = max(end, servo(s, t, 220 * p, 660 * p, 0.32, 0.1, { type: 'square', gear: 38 }));
  const ratchet: Array<[number, number]> = [];
  for (let i = 0; i < 12; i++) ratchet.push([i * 0.026, 0.5 + 0.4 * (i / 12)]);
  end = max(end, grains(s, s.out, t, ratchet, { type: 'bandpass', freq: 2600 * p, q: 3, tau: 0.003 }));
  end = max(end, noiseBurst(s, s.out, t + 0.02, { type: 'bandpass', freq: 3000 * p, freqEnd: 900 * p, sweep: 0.3, q: 1.5, peak: 0.35, attack: 0.03, tau: 0.08 }));
  end = max(end, thump(s, t + 0.33, 130 * p, 55 * p, 0.6, 0.06, sh));
  end = max(end, click(s, t + 0.33, 1800 * p, 0.8, 0.006));
  end = max(end, partials(s, s.out, t + 0.33, 640 * p, 0.08, [[1, 1, 0.1], [2.3, 0.5, 0.06]]));
  return end;
}

/* ------------------------------------------------------------------ armes de bras */

/** Sortie de l'arme : plaques qui s'ouvrent (servo montant), sifflement hydraulique, verrouillage. */
export function armDeploy(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.04);
  let end = servo(s, t, 260 * p, 820 * p, 0.2, 0.14, { type: 'square', gear: 55 });
  end = max(end, noiseBurst(s, s.out, t + 0.01, { type: 'bandpass', freq: 4200 * p, q: 0.8, peak: 0.35, attack: 0.01, tau: 0.06 }));
  end = max(end, click(s, t + 0.05, 2400 * p, 0.6));
  end = max(end, click(s, t + 0.13, 2900 * p, 0.5));
  end = max(end, click(s, t + 0.22, 1700 * p, 1.0, 0.006));
  end = max(end, thump(s, t + 0.22, 190 * p, 90 * p, 0.35, 0.03));
  end = max(end, partials(s, s.out, t + 0.22, 2300 * p, 0.05, [[1, 1, 0.06], [1.48, 0.6, 0.04]]));
  return end;
}

/** Rentrée de l'arme : servo descendant, déclic, souffle. */
export function armRetract(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.04);
  let end = servo(s, t, 840 * p, 250 * p, 0.18, 0.12, { type: 'square', gear: 55 });
  end = max(end, click(s, t + 0.06, 2600 * p, 0.5));
  end = max(end, noiseBurst(s, s.out, t + 0.12, { type: 'bandpass', freq: 3600 * p, q: 0.9, peak: 0.25, attack: 0.008, tau: 0.05 }));
  end = max(end, click(s, t + 0.19, 1500 * p, 0.9, 0.006));
  end = max(end, thump(s, t + 0.19, 170 * p, 85 * p, 0.3, 0.03));
  return end;
}

/** Pistolet d'avant-bras : détonation compacte, claquement électrique, culasse mécanique. */
export function armPistol(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.04);
  let end = bankLayer(s, 'pistol', 1.16 * p, 0.85);
  if (end <= t) {
    // banques encore en génération : détonation synthétique de secours
    const sh = shaper(s, 3, 0.7);
    end = noiseBurst(s, sh, t, { type: 'lowpass', freq: 5000, freqEnd: 900, sweep: 0.08, peak: 1.8, attack: 0.0005, tau: 0.03 });
    end = max(end, thump(s, t, 160, 60, 0.7, 0.04, sh));
  }
  end = max(end, tone(s, s.out, t, { type: 'square', freq: 2400 * p, freqEnd: 700 * p, sweep: 0.03, peak: 0.07, attack: 0.0005, tau: 0.012 }));
  end = max(end, noiseBurst(s, s.out, t, { type: 'highpass', freq: 4500, peak: 0.5, attack: 0.0003, tau: 0.004 }));
  end = max(end, click(s, t + 0.045, 2100 * p, 0.45, 0.005));
  end = max(end, servo(s, t + 0.06, 900 * p, 1400 * p, 0.05, 0.05, { type: 'square' }));
  return end;
}

/** Pistolet d'avant-bras au loin. */
export function armPistolFar(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.04);
  let end = bankLayer(s, 'pistol_far', 1.12 * p, 1);
  if (end <= t) end = noiseBurst(s, s.out, t, { type: 'lowpass', freq: 1200, peak: 1.2, attack: 0.002, tau: 0.05 });
  end = max(end, tone(s, s.out, t, { type: 'square', freq: 1500 * p, freqEnd: 600 * p, sweep: 0.04, peak: 0.03, tau: 0.015 }));
  return end;
}

/** Lame Mantis : la lame chante en sortant, fend l'air, grésille (lame thermique). */
export function bladeSlash(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.06);
  const dur = 0.2 * jit(0.1);
  let end = partials(s, s.out, t, 2750 * p, 0.09, [[1, 1, 0.22], [1.51, 0.6, 0.16], [2.37, 0.45, 0.1], [3.12, 0.25, 0.07]], 0.004);
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 700 * p, freqEnd: 4800 * p, sweep: dur * 0.5, q: 1.6, peak: 0.55, attack: dur * 0.4, tau: dur * 0.2 }));
  end = max(end, noiseBurst(s, s.out, t + dur * 0.35, { type: 'bandpass', freq: 4500 * p, freqEnd: 1300 * p, sweep: dur * 0.6, q: 1.2, peak: 0.25, attack: 0.01, tau: dur * 0.2 }));
  end = max(end, crackle(s, t, dur + 0.05, 14, 0.22, 4200));
  end = max(end, tone(s, s.out, t, { type: 'sawtooth', freq: 180 * p, freqEnd: 260 * p, sweep: dur, peak: 0.03, attack: 0.02, tau: dur * 0.3 }));
  return end;
}

/** La lame entre : coup mat, entaille qui descend, brûlure qui siffle. */
export function bladeHit(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.08);
  let end = tone(s, s.out, t, { freq: 120 * p, freqEnd: 60 * p, sweep: 0.05, peak: 0.45, tau: 0.035 });
  end = max(end, noiseBurst(s, s.out, t, { kind: 'pink', type: 'lowpass', freq: 900 * p, q: 1.1, peak: 1.8, attack: 0.001, tau: 0.035 }));
  end = max(end, noiseBurst(s, s.out, t + 0.004, { type: 'bandpass', freq: 2600 * p, freqEnd: 800 * p, sweep: 0.07, q: 3, peak: 0.8, attack: 0.002, tau: 0.03 }));
  end = max(end, noiseBurst(s, s.out, t + 0.02, { type: 'highpass', freq: 3500, peak: 0.18, attack: 0.005, tau: 0.07 }));
  end = max(end, partials(s, s.out, t, 3400 * p, 0.04, [[1, 1, 0.05], [1.73, 0.5, 0.03]]));
  return end;
}

/** Poing hydraulique : impact énorme (sous-grave saturé), tôle qui sonne, vérin qui décharge. */
export function fistHeavy(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.06);
  const sh = shaper(s, 3, 0.75);
  let end = thump(s, t, 115 * p, 38 * p, 1.0, 0.13, sh);
  end = max(end, noiseBurst(s, sh, t, { kind: 'pink', type: 'lowpass', freq: 1300 * p, freqEnd: 300 * p, sweep: 0.2, q: 1, peak: 2.6, attack: 0.001, tau: 0.05 }));
  end = max(end, noiseBurst(s, s.out, t, { type: 'highpass', freq: 2000, peak: 1.0, attack: 0.0004, tau: 0.007 }));
  end = max(end, partials(s, s.out, t, rnd(260, 320) * p, 0.18, [[1, 1, 0.2], [1.83, 0.7, 0.14], [2.71, 0.5, 0.1], [4.16, 0.3, 0.06]]));
  // vérin qui décharge juste après le coup
  end = max(end, noiseBurst(s, s.out, t + 0.05, { type: 'highpass', freq: 2800 * p, peak: 0.45, attack: 0.01, tau: 0.11 }));
  end = max(end, click(s, t + 0.05, 1600 * p, 0.6, 0.006));
  const debris: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) debris.push([rnd(0.03, 0.45), rnd(0.1, 0.35)]);
  end = max(end, grains(s, s.out, t, debris, { type: 'bandpass', freq: 2400 * p, q: 1.2, tau: 0.005 }));
  return end;
}

/** Charge du poing : la pression monte (servo qui grimpe, sifflement croissant, cliquets), « prêt ». */
export function fistCharge(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.03);
  const T = 0.9;
  let end = servo(s, t, 140 * p, 640 * p, T, 0.2, { gear: 24 });
  const nz = noise(s, 'white', t, T + 0.1);
  const hp = biquad(ctx, 'bandpass', 2000 * p, 1.4);
  expSweep(hp.frequency, t, 1800 * p, 6500 * p, T);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.25, t + T);
  g.gain.linearRampToValueAtTime(0, t + T + 0.08);
  chain(nz, hp, g, s.out);
  end = max(end, t + T + 0.1);
  const clicks: Array<[number, number]> = [];
  let x = 0;
  for (let i = 0; i < 14; i++) {
    x += 0.09 * Math.pow(0.86, i);
    clicks.push([x, 0.35 + 0.3 * (i / 14)]);
  }
  end = max(end, grains(s, s.out, t, clicks, { type: 'bandpass', freq: 3000 * p, q: 2.5, tau: 0.003 }));
  end = max(end, tone(s, s.out, t + T, { freq: 1760 * p, peak: 0.05, attack: 0.003, hold: 0.04, tau: 0.03 }));
  return end;
}

/** Fouet monofilament : sifflement très aigu, claquement sec en bout de course, grésillement. */
export function whipCrack(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.06);
  const tc = t + 0.11 * jit(0.1);
  let end = noiseBurst(s, s.out, t, { type: 'bandpass', freq: 2500 * p, freqEnd: 7500 * p, sweep: tc - t, q: 3, peak: 0.35, attack: (tc - t) * 0.8, tau: 0.01 });
  end = max(end, tone(s, s.out, t, { freq: 3000 * p, freqEnd: 6500 * p, sweep: tc - t, peak: 0.025, attack: (tc - t) * 0.8, tau: 0.01 }));
  end = max(end, noiseBurst(s, s.out, tc, { type: 'highpass', freq: 1500, peak: 1.6, attack: 0.0002, tau: 0.0025 }));
  end = max(end, noiseBurst(s, s.out, tc, { type: 'bandpass', freq: 2600 * p, q: 1.5, peak: 0.9, attack: 0.0003, tau: 0.008 }));
  end = max(end, tone(s, s.out, tc, { freq: 6200 * p, peak: 0.06, attack: 0.0005, tau: 0.03 }));
  end = max(end, crackle(s, tc, 0.18, 12, 0.3, 4500));
  end = max(end, noiseBurst(s, s.out, tc + 0.01, { type: 'bandpass', freq: 900, q: 0.7, peak: 0.12, attack: 0.01, tau: 0.05 }));
  return end;
}

/* ------------------------------------------------------------------ bouclier */

/** Bouclier levé : montée « vwoom » qui s'ouvre, miroitement de verre, verrou d'énergie. */
export function shieldUp(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.03);
  const T = 0.26;
  const o1 = osc(ctx, 'sawtooth', 80 * p, t, t + 0.8);
  const o2 = osc(ctx, 'sine', 80 * p, t, t + 0.8);
  expSweep(o1.frequency, t, 75 * p, 210 * p, T);
  expSweep(o2.frequency, t, 75 * p, 210 * p, T);
  const lp = biquad(ctx, 'lowpass', 300, 3);
  lp.frequency.setValueAtTime(250, t);
  lp.frequency.exponentialRampToValueAtTime(2600 * p, t + T);
  lp.frequency.exponentialRampToValueAtTime(700 * p, t + 0.7);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.22, t + T * 0.8);
  g.gain.setTargetAtTime(0, t + T, 0.09);
  o1.connect(lp);
  chain(o2, gainNode(ctx, 1.5), lp);
  chain(lp, g, s.out);
  let end = t + 0.8;
  end = max(end, fmTone(s, s.out, t + 0.12, { freq: midiHz(81) * p, ratio: 3.51, index: 2, peak: 0.07, tau: 0.18 }));
  end = max(end, fmTone(s, s.out, t + 0.17, { freq: midiHz(88) * p, ratio: 3.51, index: 2, peak: 0.05, tau: 0.22 }));
  end = max(end, crackle(s, t, 0.3, 12, 0.14, 4000));
  end = max(end, thump(s, t + T, 130 * p, 60 * p, 0.4, 0.05));
  end = max(end, noiseBurst(s, s.out, t + T, { type: 'bandpass', freq: 1800 * p, q: 1.2, peak: 0.25, attack: 0.002, tau: 0.03 }));
  return end;
}

/** Balle absorbée : « dzing » de verre, éclat électrique, ondulation grave. */
export function shieldHit(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.1);
  let end = fmTone(s, s.out, t, { freq: rnd(1400, 1900) * p, ratio: 2.41, index: 3, peak: 0.14, tau: 0.09 });
  end = max(end, fmTone(s, s.out, t, { freq: rnd(2600, 3300) * p, ratio: 1.41, index: 2, peak: 0.06, tau: 0.06 }));
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 3200 * p, q: 1.3, peak: 0.6, attack: 0.0004, tau: 0.012 }));
  end = max(end, tone(s, s.out, t, { freq: 160 * p, freqEnd: 85 * p, sweep: 0.12, peak: 0.3, attack: 0.002, tau: 0.06 }));
  end = max(end, crackle(s, t, 0.12, 8, 0.25, 5000));
  return end;
}

/** Bouclier brisé : craquement, pluie d'éclats de verre, chute électrique saturée, coup sourd. */
export function shieldBreak(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.04);
  let end = noiseBurst(s, s.out, t, { type: 'highpass', freq: 2000, peak: 1.2, attack: 0.0004, tau: 0.03 });
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 5000 * p, q: 1, peak: 0.5, attack: 0.001, tau: 0.09 }));
  const sh = shaper(s, 3, 0.6);
  end = max(end, thump(s, t, 110 * p, 35 * p, 0.8, 0.12, sh));
  for (let i = 0; i < 14; i++) {
    const first = i < 5;
    const dt = first ? rnd(0, 0.05) : rnd(0.08, 0.7);
    end = max(end, fmTone(s, s.out, t + dt, { freq: rnd(1500, 5200) * p, ratio: rnd(1.4, 3.6), index: 1.5, peak: rnd(0.025, 0.07) * (first ? 1.5 : 1), tau: rnd(0.04, 0.16) }));
  }
  // énergie qui s'effondre
  const o = osc(ctx, 'sawtooth', 700 * p, t, t + 1.1);
  expSweep(o.frequency, t, 700 * p, 55 * p, 0.6);
  const lp = biquad(ctx, 'lowpass', 2500, 1.5);
  expSweep(lp.frequency, t, 3500, 300, 0.6);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.18, t + 0.02);
  g.gain.setTargetAtTime(0, t + 0.15, 0.14);
  chain(o, lp, g, sh);
  end = max(end, t + 1.1);
  end = max(end, crackle(s, t, 0.6, 30, 0.3, 3800));
  return end;
}

/** Bouclier baissé : descente « vwoum », miroitement qui retombe, déclic. */
export function shieldDown(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.03);
  const o = osc(ctx, 'sawtooth', 220 * p, t, t + 0.6);
  expSweep(o.frequency, t, 230 * p, 62 * p, 0.32);
  const lp = biquad(ctx, 'lowpass', 2200, 2.5);
  expSweep(lp.frequency, t, 2400 * p, 220, 0.35);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.18, t + 0.02);
  g.gain.setTargetAtTime(0, t + 0.12, 0.08);
  chain(o, lp, g, s.out);
  let end = t + 0.6;
  end = max(end, fmTone(s, s.out, t, { freq: midiHz(88) * p, freqEnd: midiHz(76) * p, sweep: 0.25, ratio: 3.51, index: 1.5, peak: 0.05, tau: 0.12 }));
  end = max(end, click(s, t + 0.3, 2000 * p, 0.35));
  return end;
}

/* ------------------------------------------------------------------ répulseur, décharges, roquettes */

/** Répulseur : montée éclair, souffle cinétique énorme, coup grave, débris balayés. */
export function repulsor(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.05);
  let end = tone(s, s.out, t, { type: 'sawtooth', freq: 420 * p, freqEnd: 2200 * p, sweep: 0.06, peak: 0.06, attack: 0.04, tau: 0.01 });
  const t1 = t + 0.055;
  const sh = shaper(s, 3, 0.8);
  end = max(end, thump(s, t1, 85 * p, 32 * p, 1.0, 0.17, sh));
  end = max(end, noiseBurst(s, sh, t1, { kind: 'pink', type: 'lowpass', freq: 4500 * p, freqEnd: 350 * p, sweep: 0.35, q: 0.9, peak: 2.6, attack: 0.002, tau: 0.11 }));
  end = max(end, noiseBurst(s, s.out, t1, { type: 'highpass', freq: 1500, peak: 0.9, attack: 0.0005, tau: 0.01 }));
  end = max(end, noiseBurst(s, s.out, t1 + 0.05, { type: 'bandpass', freq: 1800 * p, freqEnd: 500 * p, sweep: 0.4, q: 1, peak: 0.4, attack: 0.03, tau: 0.14 }));
  const debris: Array<[number, number]> = [];
  for (let i = 0; i < 14; i++) debris.push([rnd(0.08, 0.6), rnd(0.08, 0.3)]);
  end = max(end, grains(s, s.out, t1, debris, { type: 'bandpass', freq: 3000 * p, q: 1.2, tau: 0.004 }));
  return end;
}

/** Décharge Tesla : craquement sec, arcs qui bourdonnent, crépitements, zap descendant. */
export function shockZap(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.05);
  let end = noiseBurst(s, s.out, t, { type: 'highpass', freq: 1800, peak: 1.4, attack: 0.0003, tau: 0.004 });
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 3500 * p, q: 1.5, peak: 0.6, attack: 0.0005, tau: 0.02 }));
  end = max(end, buzz(s, t, 0.42 * jit(0.1), 58 * p, 0.22));
  end = max(end, crackle(s, t, 0.5, 46, 0.55, 3200));
  end = max(end, tone(s, s.out, t, { freq: 3400 * p, freqEnd: 260 * p, sweep: 0.12, peak: 0.08, attack: 0.001, tau: 0.04 }));
  end = max(end, thump(s, t, 140 * p, 60 * p, 0.35, 0.05));
  return end;
}

/** IEM : vague grave « vouuum », interférences numériques, balayage FM qui s'effondre. */
export function empBurst(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.04);
  const sh = shaper(s, 2.5, 0.7);
  let end = thump(s, t, 70 * p, 26 * p, 0.9, 0.3, sh);
  end = max(end, noiseBurst(s, s.out, t, { kind: 'brown', type: 'lowpass', freq: 400 * p, peak: 1.2, attack: 0.05, tau: 0.3 }));
  end = max(end, fmTone(s, s.out, t, { freq: 1300 * p, freqEnd: 90 * p, sweep: 0.7, ratio: 1.5, index: 4, indexTau: 0.5, peak: 0.1, tau: 0.25 }));
  // pépins numériques
  for (let i = 0; i < 7; i++) {
    const dt = rnd(0.02, 0.5);
    end = max(end, tone(s, s.out, t + dt, { type: 'square', freq: pick([220, 440, 660, 880, 1320, 1760]) * p, peak: 0.03, attack: 0.001, hold: rnd(0.015, 0.04), tau: 0.004 }));
  }
  const hp = biquad(ctx, 'highpass', 5000, 0.7);
  const nz = noise(s, 'white', t, 0.6);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0.12, t);
  g.gain.setTargetAtTime(0, t + 0.05, 0.12);
  chain(nz, hp, g, s.out);
  end = max(end, t + 0.8);
  end = max(end, crackle(s, t, 0.6, 24, 0.3, 4000));
  return end;
}

/** Départ d'une micro-roquette : allumage, souffle qui rugit et s'éloigne, sifflement. */
export function rocketLaunch(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.06);
  let end = click(s, t, 2000 * p, 0.8, 0.004);
  end = max(end, thump(s, t, 140 * p, 70 * p, 0.45, 0.04));
  end = max(end, noiseBurst(s, s.out, t + 0.005, { type: 'bandpass', freq: 1400 * p, freqEnd: 700 * p, sweep: 0.5, q: 0.9, peak: 0.9, attack: 0.015, tau: 0.13 }));
  end = max(end, noiseBurst(s, s.out, t + 0.005, { type: 'highpass', freq: 3500 * p, peak: 0.35, attack: 0.01, tau: 0.12 }));
  end = max(end, noiseBurst(s, s.out, t + 0.01, { kind: 'pink', type: 'lowpass', freq: 600 * p, peak: 0.9, attack: 0.01, tau: 0.09 }));
  end = max(end, tone(s, s.out, t + 0.02, { freq: 2300 * p, freqEnd: 1500 * p, sweep: 0.5, peak: 0.025, attack: 0.02, tau: 0.12 }));
  return end;
}

/** Impact de micro-roquette : explosion compacte, craquement, débris et grésillement. */
export function rocketHit(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.06);
  const sh = shaper(s, 3, 0.7);
  let end = noiseBurst(s, sh, t, { type: 'lowpass', freq: 8000 * p, freqEnd: 300 * p, sweep: 0.45, q: 0.9, peak: 2.4, attack: 0.001, tau: 0.13 });
  end = max(end, noiseBurst(s, s.out, t, { type: 'highpass', freq: 1500, peak: 1.2, attack: 0.0003, tau: 0.006 }));
  end = max(end, thump(s, t, 100 * p, 34 * p, 0.95, 0.2, sh));
  end = max(end, noiseBurst(s, s.out, t + 0.02, { kind: 'brown', type: 'lowpass', freq: 380 * p, peak: 1.4, attack: 0.04, tau: 0.4 }));
  const debris: Array<[number, number]> = [];
  for (let i = 0; i < 14; i++) {
    const dt = rnd(0.1, 1.2);
    debris.push([dt, rnd(0.08, 0.28) * (1.2 - dt / 1.6)]);
  }
  end = max(end, grains(s, s.out, t, debris, { type: 'bandpass', freq: 2800 * p, q: 1.2, tau: 0.006 }));
  end = max(end, crackle(s, t + 0.05, 0.9, 26, 0.18, 3500));
  return end;
}

/* ------------------------------------------------------------------ déplacements augmentés */

/** Esquive : allumage, jet bref qui « fouette » l'air, sifflement Doppler. */
export function dashWhoosh(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.06);
  let end = click(s, t, 2400 * p, 0.6, 0.003);
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 600 * p, freqEnd: 3200 * p, sweep: 0.12, q: 1.2, peak: 0.85, attack: 0.03, tau: 0.07 }));
  end = max(end, noiseBurst(s, s.out, t + 0.09, { type: 'bandpass', freq: 3000 * p, freqEnd: 800 * p, sweep: 0.2, q: 1, peak: 0.4, attack: 0.01, tau: 0.07 }));
  end = max(end, noiseBurst(s, s.out, t, { kind: 'pink', type: 'lowpass', freq: 900 * p, peak: 1.2, attack: 0.005, tau: 0.07 }));
  end = max(end, tone(s, s.out, t, { freq: 1900 * p, freqEnd: 800 * p, sweep: 0.2, peak: 0.04, attack: 0.01, tau: 0.06 }));
  end = max(end, thump(s, t, 110 * p, 60 * p, 0.35, 0.05));
  return end;
}

/** Propulseurs des talons : « pfft » sec, coup sourd, petite détente. */
export function jumpThrust(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.06);
  let end = click(s, t, 3000 * p, 0.5, 0.002);
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 1500 * p, freqEnd: 900 * p, sweep: 0.12, q: 1.1, peak: 0.8, attack: 0.004, tau: 0.05 }));
  end = max(end, noiseBurst(s, s.out, t, { kind: 'pink', type: 'lowpass', freq: 700 * p, peak: 1.1, attack: 0.003, tau: 0.05 }));
  end = max(end, thump(s, t, 105 * p, 52 * p, 0.5, 0.05));
  end = max(end, noiseBurst(s, s.out, t + 0.03, { type: 'highpass', freq: 4000, peak: 0.2, attack: 0.01, tau: 0.05 }));
  return end;
}

/** Bond chargé (compression) : vérins qui grincent, sifflement qui monte, cliquets. */
export function leapCharge(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.04);
  const T = 0.6;
  let end = servo(s, t, 70 * p, 170 * p, T, 0.22, { gear: 18 });
  const nz = noise(s, 'white', t, T + 0.1);
  const bp = biquad(ctx, 'bandpass', 2000 * p, 1.2);
  expSweep(bp.frequency, t, 1500 * p, 4500 * p, T);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.18, t + T);
  g.gain.linearRampToValueAtTime(0, t + T + 0.06);
  chain(nz, bp, g, s.out);
  end = max(end, t + T + 0.1);
  const clicks: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) clicks.push([0.05 + i * 0.07, 0.4]);
  end = max(end, grains(s, s.out, t, clicks, { type: 'bandpass', freq: 2200 * p, q: 3, tau: 0.003 }));
  return end;
}

/** Détente du bond : coup énorme, vérins qui relâchent, souffle qui monte, tôle. */
export function leapLaunch(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.05);
  const sh = shaper(s, 2.5, 0.75);
  let end = thump(s, t, 82 * p, 32 * p, 1.0, 0.16, sh);
  end = max(end, noiseBurst(s, sh, t, { kind: 'pink', type: 'lowpass', freq: 900 * p, peak: 2, attack: 0.001, tau: 0.05 }));
  end = max(end, noiseBurst(s, s.out, t + 0.01, { type: 'highpass', freq: 2500 * p, peak: 0.6, attack: 0.008, tau: 0.17 }));
  end = max(end, whoosh(s, t + 0.04, 450 * p, 2600 * p, 0.32, 0.45, 1.2));
  end = max(end, partials(s, s.out, t, 360 * p, 0.12, [[1, 1, 0.12], [2.2, 0.6, 0.08], [3.4, 0.3, 0.05]]));
  end = max(end, click(s, t, 1800 * p, 0.8, 0.005));
  return end;
}

/** Début de glissade : genouillères au sol, raclement qui part, étincelles. */
export function slideStart(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.06);
  let end = noiseBurst(s, s.out, t, { kind: 'pink', type: 'lowpass', freq: 700 * p, peak: 1.4, attack: 0.002, tau: 0.035 });
  end = max(end, thump(s, t, 120 * p, 60 * p, 0.35, 0.04));
  end = max(end, noiseBurst(s, s.out, t + 0.01, { type: 'bandpass', freq: 2600 * p, freqEnd: 1700 * p, sweep: 0.3, q: 1.6, peak: 0.55, attack: 0.01, tau: 0.09 }));
  end = max(end, crackle(s, t + 0.01, 0.3, 22, 0.35, 3500));
  return end;
}

/** Pas magnétique sur un mur : « tonk » sourd, déclic, petit servo. */
export function wallrunStep(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.08);
  let end = tone(s, s.out, t, { freq: 190 * p, freqEnd: 120 * p, sweep: 0.03, peak: 0.45, tau: 0.02 });
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 1200 * p, q: 1.2, peak: 0.7, attack: 0.0008, tau: 0.014 }));
  end = max(end, click(s, t, 3200 * p, 0.35, 0.002));
  end = max(end, tone(s, s.out, t + 0.015, { type: 'square', freq: 900 * p, freqEnd: 1300 * p, sweep: 0.04, peak: 0.015, attack: 0.004, tau: 0.012 }));
  return end;
}

/** Paumes magnétiques qui agrippent un rebord : choc métallique, bourdon d'aimant, frottement. */
export function mantleGrab(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.06);
  let end = partials(s, s.out, t, 720 * p, 0.12, [[1, 1, 0.05], [2.53, 0.5, 0.035], [4.1, 0.25, 0.02]]);
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 1600 * p, q: 1.3, peak: 0.7, attack: 0.0006, tau: 0.012 }));
  const o = osc(ctx, 'sawtooth', 115 * p, t, t + 0.2);
  const lp = biquad(ctx, 'lowpass', 600, 1.5);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.1, t + 0.01);
  g.gain.setTargetAtTime(0, t + 0.06, 0.03);
  chain(o, lp, g, s.out);
  end = max(end, t + 0.22);
  end = max(end, noiseBurst(s, s.out, t + 0.05, { type: 'bandpass', freq: 900 * p, freqEnd: 1800 * p, sweep: 0.15, q: 0.9, peak: 0.25, attack: 0.04, tau: 0.04 }));
  return end;
}

/** Réception lourde : coup sourd, amortisseurs qui sifflent, tôle, gravats. */
export function landHeavy(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.06);
  const sh = shaper(s, 2.5, 0.75);
  let end = thump(s, t, 88 * p, 34 * p, 0.95, 0.11, sh);
  end = max(end, noiseBurst(s, sh, t, { kind: 'pink', type: 'lowpass', freq: 650 * p, peak: 2.4, attack: 0.001, tau: 0.055 }));
  end = max(end, noiseBurst(s, s.out, t + 0.02, { type: 'highpass', freq: 3000 * p, peak: 0.4, attack: 0.008, tau: 0.13 }));
  end = max(end, partials(s, s.out, t, 230 * p, 0.12, [[1, 1, 0.08], [2.1, 0.5, 0.05], [3.3, 0.3, 0.03]]));
  const debris: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) debris.push([rnd(0.02, 0.4), rnd(0.08, 0.25)]);
  end = max(end, grains(s, s.out, t, debris, { type: 'bandpass', freq: 3000 * p, q: 1.3, tau: 0.004 }));
  return end;
}

/** Atterrissage sismique : boum sous-grave, grondement qui roule, craquement, pluie de gravats. */
export function groundQuake(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.04);
  const sh = shaper(s, 3, 0.8);
  let end = thump(s, t, 62 * p, 24 * p, 1.0, 0.42, sh);
  end = max(end, noiseBurst(s, sh, t, { kind: 'pink', type: 'lowpass', freq: 1500 * p, freqEnd: 200 * p, sweep: 0.4, peak: 2.4, attack: 0.002, tau: 0.08 }));
  end = max(end, noiseBurst(s, s.out, t, { type: 'highpass', freq: 1200, peak: 1.0, attack: 0.0004, tau: 0.012 }));
  end = max(end, noiseBurst(s, s.out, t + 0.03, { kind: 'brown', type: 'lowpass', freq: 260 * p, peak: 1.8, attack: 0.08, tau: 0.55 }));
  const debris: Array<[number, number]> = [];
  for (let i = 0; i < 26; i++) {
    const dt = rnd(0.08, 1.6);
    debris.push([dt, rnd(0.08, 0.3) * (1.2 - dt / 2)]);
  }
  end = max(end, grains(s, s.out, t, debris, { type: 'bandpass', freq: 2500 * p, q: 1.1, tau: 0.006 }));
  const chunks: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) chunks.push([rnd(0.15, 1.2), rnd(0.2, 0.45)]);
  end = max(end, grains(s, s.out, t, chunks, { kind: 'pink', type: 'lowpass', freq: 500, tau: 0.03 }));
  return end;
}

/* ------------------------------------------------------------------ yeux, peau, système neuronal, torse */

/** Impulsion du scanner : « piiing » de sonar, gazouillis numérique, écho, coup grave. */
export function scanPing(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.02);
  const f = 1245 * p;
  let end = tone(s, s.out, t, { freq: f * 2, freqEnd: f, sweep: 0.03, peak: 0.16, attack: 0.002, tau: 0.32 });
  end = max(end, tone(s, s.out, t, { type: 'triangle', freq: f * 1.5, peak: 0.04, attack: 0.002, tau: 0.2 }));
  end = max(end, tone(s, s.out, t + 0.28, { freq: f * 0.99, peak: 0.05, attack: 0.01, tau: 0.3 }));
  end = max(end, tone(s, s.out, t + 0.55, { freq: f * 0.98, peak: 0.018, attack: 0.01, tau: 0.3 }));
  end = max(end, noiseBurst(s, s.out, t, { type: 'bandpass', freq: 4000 * p, freqEnd: 9000 * p, sweep: 0.12, q: 2.5, peak: 0.25, attack: 0.02, tau: 0.03 }));
  end = max(end, thump(s, t, 120 * p, 70 * p, 0.35, 0.07));
  return end;
}

/** Vision activée : gazouillis FM montant, bourdon de l'optique, déclic et deux bips. */
export function visionOn(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p;
  let end = click(s, t, 3000 * p, 0.45, 0.002);
  end = max(end, fmTone(s, s.out, t, { freq: 600 * p, freqEnd: 2400 * p, sweep: 0.12, ratio: 1.5, index: 2.5, peak: 0.07, tau: 0.04, hold: 0.06 }));
  const o = osc(ctx, 'sawtooth', 110 * p, t, t + 0.6);
  const lp = biquad(ctx, 'lowpass', 900, 1.2);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.06, t + 0.12);
  g.gain.setTargetAtTime(0, t + 0.15, 0.06);
  chain(o, lp, g, s.out);
  end = max(end, t + 0.6);
  end = max(end, tone(s, s.out, t + 0.16, { type: 'square', freq: 2093 * p, peak: 0.025, attack: 0.002, hold: 0.025, tau: 0.008 }));
  end = max(end, tone(s, s.out, t + 0.21, { type: 'square', freq: 3136 * p, peak: 0.025, attack: 0.002, hold: 0.03, tau: 0.01 }));
  return end;
}

/** Vision coupée : gazouillis descendant, déclic. */
export function visionOff(s: SfxCtx): number {
  const { t } = s;
  const p = s.p;
  let end = fmTone(s, s.out, t, { freq: 2400 * p, freqEnd: 480 * p, sweep: 0.14, ratio: 1.5, index: 2.5, peak: 0.065, tau: 0.04, hold: 0.06 });
  end = max(end, click(s, t + 0.14, 2200 * p, 0.4, 0.003));
  end = max(end, tone(s, s.out, t + 0.14, { freq: 160 * p, freqEnd: 90 * p, sweep: 0.05, peak: 0.12, tau: 0.03 }));
  return end;
}

/** Camouflage enclenché : miroitement qui se dissout (bruit en bande qui descend, notes de verre). */
export function camoOn(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.02);
  let end = noiseBurst(s, s.out, t, { type: 'bandpass', freq: 8000 * p, freqEnd: 1400 * p, sweep: 0.5, q: 5, peak: 0.55, attack: 0.05, tau: 0.12 });
  end = max(end, glassNotes(s, t + 0.03, [93, 88, 84, 81], 0.07, 0.035, 0.14, 2.76));
  const o = osc(ctx, 'sine', 330 * p, t, t + 0.75);
  expSweep(o.frequency, t, 330 * p, 165 * p, 0.6);
  const lfo = osc(ctx, 'sine', 11, t, t + 0.75);
  chain(lfo, gainNode(ctx, 14), o.frequency);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.07, t + 0.08);
  g.gain.setTargetAtTime(0, t + 0.25, 0.12);
  chain(o, g, s.out);
  end = max(end, t + 0.75);
  end = max(end, crackle(s, t, 0.35, 10, 0.12, 6000));
  return end;
}

/** Camouflage coupé : miroitement qui remonte, notes qui grimpent, petit « pop ». */
export function camoOff(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.02);
  let end = noiseBurst(s, s.out, t, { type: 'bandpass', freq: 1300 * p, freqEnd: 7000 * p, sweep: 0.4, q: 5, peak: 0.5, attack: 0.2, tau: 0.05 });
  end = max(end, glassNotes(s, t + 0.05, [81, 84, 88, 93], 0.06, 0.03, 0.1, 2.76));
  end = max(end, thump(s, t + 0.38, 240 * p, 110 * p, 0.3, 0.025));
  end = max(end, click(s, t + 0.38, 2500 * p, 0.45, 0.003));
  return end;
}

/** Accélérateur de réflexes : le temps s'étire (grave qui plonge, aspiration inversée, acouphène). */
export function reflexOn(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.02);
  // aspiration qui gonfle jusqu'au « drop »
  const nz = noise(s, 'white', t, 0.24);
  const hp = biquad(ctx, 'highpass', 3000, 0.7);
  const g0 = gainNode(ctx, 0);
  g0.gain.setValueAtTime(0, t);
  g0.gain.linearRampToValueAtTime(0.22, t + 0.15);
  g0.gain.linearRampToValueAtTime(0, t + 0.17);
  chain(nz, hp, g0, s.out);
  const td = t + 0.15;
  const o1 = osc(ctx, 'sawtooth', 220 * p, td, td + 1.25);
  const o2 = osc(ctx, 'sine', 110 * p, td, td + 1.25);
  expSweep(o1.frequency, td, 220 * p, 52 * p, 0.55);
  expSweep(o2.frequency, td, 110 * p, 30 * p, 0.55);
  const lp = biquad(ctx, 'lowpass', 1800, 2);
  expSweep(lp.frequency, td, 2400, 260, 0.6);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, td);
  g.gain.linearRampToValueAtTime(0.25, td + 0.01);
  g.gain.setTargetAtTime(0, td + 0.25, 0.15);
  o1.connect(lp);
  chain(o2, gainNode(ctx, 2), lp);
  chain(lp, g, s.out);
  let end = td + 1.25;
  end = max(end, thump(s, td, 90 * p, 40 * p, 0.6, 0.08));
  end = max(end, tone(s, s.out, td + 0.05, { freq: 3150 * p, peak: 0.012, attack: 0.08, tau: 0.25 }));
  return end;
}

/** Fin des réflexes : le temps se raccroche (montée « vwip », souffle, déclic). */
export function reflexOff(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.03);
  let end = tone(s, s.out, t, { type: 'sawtooth', freq: 70 * p, freqEnd: 420 * p, sweep: 0.22, peak: 0.07, attack: 0.15, tau: 0.03 });
  end = max(end, tone(s, s.out, t, { freq: 60 * p, freqEnd: 240 * p, sweep: 0.22, peak: 0.18, attack: 0.15, tau: 0.03 }));
  end = max(end, whoosh(s, t + 0.05, 600 * p, 3500 * p, 0.2, 0.3, 1.2));
  end = max(end, click(s, t + 0.24, 2400 * p, 0.4, 0.003));
  return end;
}

/** Surcharge défensive : montée électrique saturée, transformateur, plaques qui se verrouillent. */
export function overchargeOn(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.03);
  const sh = s.ctx.createWaveShaper();
  sh.curve = s.res.shaperCurve(4);
  const lp = biquad(ctx, 'lowpass', 2400, 1);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.16, t + 0.3);
  g.gain.setTargetAtTime(0, t + 0.42, 0.1);
  chain(sh, lp, g, s.out);
  for (const r of [1, 1.5, 2.01]) {
    const o = osc(ctx, 'sawtooth', 90 * p * r, t, t + 0.9);
    expSweep(o.frequency, t, 90 * p * r, 180 * p * r, 0.32);
    chain(o, gainNode(ctx, 0.5), sh);
  }
  let end = t + 0.9;
  end = max(end, crackle(s, t, 0.45, 36, 0.4, 3000));
  end = max(end, buzz(s, t + 0.05, 0.3, 50 * p, 0.12));
  end = max(end, click(s, t + 0.33, 1500 * p, 0.9, 0.006));
  end = max(end, thump(s, t + 0.33, 150 * p, 60 * p, 0.55, 0.05));
  end = max(end, partials(s, s.out, t + 0.33, 410 * p, 0.08, [[1, 1, 0.12], [2.3, 0.6, 0.08]]));
  return end;
}

/** Cœur de secours : défibrillateur qui charge, choc, battements, nappe lumineuse. */
export function secondWind(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.02);
  let end = tone(s, s.out, t, { freq: 600 * p, freqEnd: 2600 * p, sweep: 0.34, peak: 0.05, attack: 0.3, tau: 0.01 });
  const tc = t + 0.36;
  const sh = shaper(s, 3, 0.75);
  end = max(end, thump(s, tc, 75 * p, 36 * p, 1.0, 0.12, sh));
  end = max(end, noiseBurst(s, s.out, tc, { type: 'highpass', freq: 1800, peak: 1.0, attack: 0.0004, tau: 0.01 }));
  end = max(end, crackle(s, tc, 0.12, 18, 0.5, 3500));
  // battements « lub-dub »
  for (const [dt, a] of [[0.55, 0.7], [0.72, 0.5], [1.1, 0.55], [1.27, 0.4]] as const) end = max(end, thump(s, tc + dt, 62 * p, 38 * p, a, 0.07));
  // nappe : accord majeur lumineux
  for (const [m, d] of [[69, 0], [73, 0.05], [76, 0.1], [81, 0.15]] as const) end = max(end, fmTone(s, s.out, tc + 0.05 + d, { freq: midiHz(m) * p, ratio: 2, index: 0.8, peak: 0.035, attack: 0.08, tau: 0.35 }));
  return end;
}

/** Nanobots : scintillement discret (notes de verre aiguës, souffle). */
export function nanoHeal(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.03);
  const notes = [96, 98, 100, 103, 105];
  let end = noiseBurst(s, s.out, t, { type: 'highpass', freq: 6500, peak: 0.08, attack: 0.08, tau: 0.08 });
  for (let i = 0; i < 4; i++) end = max(end, fmTone(s, s.out, t + i * rnd(0.045, 0.07), { freq: midiHz(pick(notes)) * p, ratio: 3.5, index: 1, peak: 0.03, tau: 0.07 }));
  return end;
}

/** Drone de combat lancé : déclic de la nacelle, rotors qui montent en régime, bip-bip. */
export function droneDeploy(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p * jit(0.03);
  let end = click(s, t, 2200 * p, 0.7, 0.004);
  end = max(end, thump(s, t, 160 * p, 90 * p, 0.3, 0.03));
  const T = 0.65;
  const am = gainNode(ctx, 0.55);
  const lfo = osc(ctx, 'sine', 30, t, t + T + 0.65);
  lfo.frequency.setValueAtTime(30, t);
  lfo.frequency.linearRampToValueAtTime(95, t + T);
  chain(lfo, gainNode(ctx, 0.45), am.gain);
  const lp = biquad(ctx, 'lowpass', 3200, 0.7);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.15, t + T * 0.7);
  g.gain.setTargetAtTime(0, t + T, 0.1);
  chain(lp, am, g, s.out);
  for (const f of [86, 89.5]) {
    const o = osc(ctx, 'sawtooth', f * p, t, t + T + 0.65);
    o.frequency.setValueAtTime(f * p, t);
    o.frequency.exponentialRampToValueAtTime(f * 2.2 * p, t + T);
    o.connect(lp);
  }
  end = max(end, t + T + 0.65);
  end = max(end, tone(s, s.out, t + T, { type: 'square', freq: 1568 * p, peak: 0.025, attack: 0.002, hold: 0.04, tau: 0.01 }));
  end = max(end, tone(s, s.out, t + T + 0.08, { type: 'square', freq: 2093 * p, peak: 0.025, attack: 0.002, hold: 0.05, tau: 0.012 }));
  return end;
}

/** Bras tactique : connexion, rafale de bips de données, gazouillis de modem. */
export function toolHack(s: SfxCtx): number {
  const { t } = s;
  const p = s.p;
  let end = click(s, t, 2800 * p, 0.6, 0.003);
  end = max(end, tone(s, s.out, t, { freq: 200 * p, freqEnd: 120 * p, sweep: 0.04, peak: 0.15, tau: 0.02 }));
  const scale = [1047, 1319, 1568, 1760, 2093, 2637];
  let tt = t + 0.04;
  for (let i = 0; i < 12; i++) {
    end = max(end, tone(s, s.out, tt, { type: 'square', freq: pick(scale) * p, peak: 0.022, attack: 0.001, hold: 0.022, tau: 0.004 }));
    tt += rnd(0.03, 0.045);
  }
  end = max(end, fmTone(s, s.out, t + 0.05, { freq: 900 * p, freqEnd: 1700 * p, sweep: 0.4, ratio: 0.5, index: 6, indexTau: 0.4, peak: 0.025, attack: 0.02, hold: 0.25, tau: 0.04 }));
  return end;
}

/** Cible marquée : « ping » de verrouillage à deux tons. */
export function markPing(s: SfxCtx): number {
  const { t } = s;
  const p = s.p;
  let end = fmTone(s, s.out, t, { freq: midiHz(93) * p, ratio: 2, index: 1.2, peak: 0.08, tau: 0.05 });
  end = max(end, fmTone(s, s.out, t + 0.06, { freq: midiHz(100) * p, ratio: 2, index: 1.2, peak: 0.07, tau: 0.09 }));
  end = max(end, click(s, t, 5000, 0.25, 0.002));
  return end;
}

/** Alerte de visée : deux bips descendants pressants, pulsation grave. */
export function threatWarn(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p;
  const lp = biquad(ctx, 'lowpass', 3500, 1);
  lp.connect(s.out);
  let end = tone(s, lp, t, { type: 'square', freq: 1400 * p, peak: 0.045, attack: 0.002, hold: 0.045, tau: 0.01 });
  end = max(end, tone(s, lp, t + 0.09, { type: 'square', freq: 1050 * p, peak: 0.045, attack: 0.002, hold: 0.06, tau: 0.012 }));
  end = max(end, tone(s, s.out, t, { freq: 90 * p, peak: 0.2, attack: 0.005, hold: 0.05, tau: 0.04 }));
  return end;
}

/* ------------------------------------------------------------------ clinique, écran des implants */

/** Installation d'un implant : servos chirurgicaux, fraise, pinces, carillon de confirmation. */
export function implantInstall(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p;
  let end = servo(s, t, 300, 900, 0.22, 0.1, { type: 'square', gear: 60 });
  const o = osc(ctx, 'sawtooth', 240 * p, t + 0.2, t + 0.65);
  const am = gainNode(ctx, 0.5);
  const lfo = osc(ctx, 'square', 32, t + 0.2, t + 0.65);
  chain(lfo, gainNode(ctx, 0.5), am.gain);
  const bp = biquad(ctx, 'bandpass', 1500, 2);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t + 0.2);
  g.gain.linearRampToValueAtTime(0.09, t + 0.25);
  g.gain.setValueAtTime(0.09, t + 0.55);
  g.gain.linearRampToValueAtTime(0, t + 0.62);
  chain(o, bp, am, g, s.out);
  end = max(end, t + 0.65);
  end = max(end, click(s, t + 0.62, 1800, 0.8, 0.005));
  end = max(end, click(s, t + 0.7, 2400, 0.6, 0.004));
  end = max(end, noiseBurst(s, s.out, t + 0.66, { type: 'highpass', freq: 3500, peak: 0.25, attack: 0.01, tau: 0.08 }));
  end = max(end, glassNotes(s, t + 0.78, [72, 76, 79, 84], 0.07, 0.07, 0.3, 2));
  return end;
}

/** Amélioration : arpège qui monte, montée d'énergie filtrée, étincelles. */
export function implantUpgrade(s: SfxCtx): number {
  const { ctx, t } = s;
  const p = s.p;
  const o = osc(ctx, 'sawtooth', 200 * p, t, t + 0.95);
  expSweep(o.frequency, t, 200 * p, 800 * p, 0.55);
  const lp = biquad(ctx, 'lowpass', 600, 4);
  expSweep(lp.frequency, t, 500, 5000, 0.55);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.07, t + 0.45);
  g.gain.setTargetAtTime(0, t + 0.55, 0.05);
  chain(o, lp, g, s.out);
  let end = t + 0.95;
  end = max(end, glassNotes(s, t + 0.08, [74, 78, 81, 86, 90], 0.08, 0.065, 0.25, 2));
  end = max(end, crackle(s, t + 0.5, 0.25, 14, 0.2, 6000));
  end = max(end, thump(s, t + 0.5, 140, 70, 0.3, 0.05));
  return end;
}

/** Retrait : servo qui redescend, verrou, sifflement, deux notes graves. */
export function implantRemove(s: SfxCtx): number {
  const { t } = s;
  let end = servo(s, t, 900, 280, 0.25, 0.1, { type: 'square', gear: 60 });
  end = max(end, click(s, t + 0.26, 1500, 0.9, 0.006));
  end = max(end, thump(s, t + 0.26, 150, 70, 0.35, 0.04));
  end = max(end, noiseBurst(s, s.out, t + 0.28, { type: 'highpass', freq: 3200, peak: 0.25, attack: 0.008, tau: 0.08 }));
  end = max(end, glassNotes(s, t + 0.36, [76, 69], 0.12, 0.06, 0.2, 2));
  return end;
}

/** Survol d'un implant dans l'écran : tic de verre très court. */
export function cyberUiHover(s: SfxCtx): number {
  const p = s.p * jit(0.02);
  let end = fmTone(s, s.out, s.t, { freq: 4200 * p, ratio: 1.5, index: 0.6, peak: 0.035, attack: 0.001, tau: 0.012 });
  end = max(end, click(s, s.t, 7000, 0.08, 0.0015));
  return end;
}

/** Sélection : double « blip » numérique montant. */
export function cyberUiSelect(s: SfxCtx): number {
  const p = s.p * jit(0.01);
  let end = click(s, s.t, 4000, 0.3, 0.002);
  end = max(end, fmTone(s, s.out, s.t, { freq: 1760 * p, ratio: 2, index: 1, peak: 0.05, tau: 0.03, hold: 0.02 }));
  end = max(end, fmTone(s, s.out, s.t + 0.055, { freq: 2637 * p, ratio: 2, index: 1, peak: 0.05, tau: 0.05, hold: 0.02 }));
  return end;
}
