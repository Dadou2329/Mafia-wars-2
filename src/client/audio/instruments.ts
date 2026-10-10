/**
 * Voix d'instruments synthwave / néo-noir construites en nœuds Web Audio.
 * Chaque fonction programme une note à l'instant absolu `t` dans `dest` et
 * renvoie l'instant où elle est silencieuse.
 */
import type { DrumKind } from './drumkit';
import {
  adEnv, biquad, chain, clampFreq, expSweep, fmTone, gainNode, noise, noiseBurst, osc,
  type SynthEnv, TAU_END, tone, trackSource,
} from './synth';

type PartialList = ReadonlyArray<readonly [number, number, number]>;

/** Pièces et jetons qui tintent. */
export const COIN: PartialList = [
  [1.0, 1.0, 0.09], [2.71, 0.6, 0.06], [4.13, 0.35, 0.04], [5.9, 0.2, 0.025],
];

/** Carillon de verre (holo-interface, ascenseur de luxe). */
export const GLASS: PartialList = [
  [1, 1, 0.8], [2.0, 0.3, 0.5], [2.76, 0.35, 0.35], [5.4, 0.15, 0.18], [8.93, 0.06, 0.09],
];

export interface BrassOpts {
  /** 0..1 brillance (ouverture du filtre). */
  bright?: number;
  attack?: number;
  release?: number;
  /** Profondeur du vibrato en cents (appliqué après ~0,25 s). */
  vibrato?: number;
  detune?: number;
}

/** Cuivres synthétiques : dents de scie désaccordées à travers un passe-bas à enveloppe, vibrato retardé. */
export function brass(e: SynthEnv, dest: AudioNode, t: number, freq: number, dur: number, vel: number, o: BrassOpts = {}): number {
  const ctx = e.ctx;
  const bright = o.bright ?? 0.7;
  const attack = o.attack ?? 0.035;
  const rel = o.release ?? 0.16;
  const det = o.detune ?? 6;
  const tOff = t + Math.max(dur, attack * 1.5 + 0.02);
  const end = tOff + rel * TAU_END * 0.5;
  const o1 = osc(ctx, 'sawtooth', freq, t, end, -det);
  const o2 = osc(ctx, 'sawtooth', freq, t, end, det);
  const o3 = osc(ctx, 'square', freq * 0.5, t, end, 0);
  const sub = gainNode(ctx, 0.18);
  o3.connect(sub);
  const lp = biquad(ctx, 'lowpass', freq * 1.2, 1.4);
  const peakCut = clampFreq(ctx, Math.min(freq * (4 + 8 * bright), 1200 + 5200 * bright));
  const susCut = clampFreq(ctx, Math.min(freq * (2.5 + 4 * bright), 900 + 2600 * bright));
  lp.frequency.setValueAtTime(clampFreq(ctx, freq * 1.1), t);
  lp.frequency.linearRampToValueAtTime(peakCut, t + attack * 1.4);
  lp.frequency.setTargetAtTime(susCut, t + attack * 1.4, 0.12);
  lp.frequency.setTargetAtTime(clampFreq(ctx, freq * 1.1), tOff, rel * 0.6);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + attack);
  g.gain.setTargetAtTime(vel * 0.78, t + attack, 0.15);
  g.gain.setTargetAtTime(0, tOff, rel * 0.5);
  if ((o.vibrato ?? 9) > 0 && dur > 0.35) {
    const lfo = osc(ctx, 'sine', 5.3 + Math.random() * 0.6, t, end);
    const depth = gainNode(ctx, 0);
    depth.gain.setValueAtTime(0, t);
    depth.gain.setValueAtTime(0, t + 0.22);
    depth.gain.linearRampToValueAtTime(o.vibrato ?? 9, t + 0.6);
    lfo.connect(depth);
    depth.connect(o1.detune);
    depth.connect(o2.detune);
  }
  o1.connect(lp); o2.connect(lp); sub.connect(lp);
  chain(lp, g, dest);
  return end;
}

export interface PadOpts { cutoff?: number; attack?: number; release?: number; detune?: number; vibrato?: number }

/** Nappe chaude : deux dents de scie désaccordées par note à travers un passe-bas, attaque lente. */
export function pad(e: SynthEnv, dest: AudioNode, t: number, freqs: readonly number[], dur: number, vel: number, o: PadOpts = {}): number {
  const ctx = e.ctx;
  const attack = o.attack ?? 0.8;
  const rel = o.release ?? 1.2;
  const det = o.detune ?? 7;
  const tOff = t + Math.max(dur, attack);
  const end = tOff + rel * 1.6;
  const lp = biquad(ctx, 'lowpass', o.cutoff ?? 1100, 0.5);
  const g = gainNode(ctx, 0);
  const v = vel / Math.sqrt(freqs.length * 2);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + attack);
  g.gain.setValueAtTime(v, tOff);
  g.gain.setTargetAtTime(0, tOff, rel / 4);
  const lfo = osc(ctx, 'sine', 4.6 + Math.random() * 0.8, t, end);
  const depth = gainNode(ctx, o.vibrato ?? 5);
  lfo.connect(depth);
  for (const f of freqs) {
    for (const d of [-det, det]) {
      const ob = osc(ctx, 'sawtooth', f, t, end, d + (Math.random() - 0.5) * 3);
      depth.connect(ob.detune);
      ob.connect(lp);
    }
  }
  chain(lp, g, dest);
  return end;
}

/** Cymbale crash / nappe de bruit aigu. */
export function cymbal(e: SynthEnv, dest: AudioNode, t: number, vel: number, tau = 0.8, attack = 0.002): number {
  return noiseBurst(e, dest, t, {
    kind: 'white', type: 'highpass', freq: 4500, q: 0.6, type2: 'peaking', freq2: 8500, q2: 0.8,
    peak: vel, attack, tau,
  });
}

/** Montée de bruit filtré (transition, avant un temps fort). */
export function riser(e: SynthEnv, dest: AudioNode, t: number, dur: number, vel: number): number {
  return noiseBurst(e, dest, t, {
    kind: 'white', type: 'bandpass', freq: 400, freqEnd: 7000, sweep: dur, q: 1.6,
    peak: vel, attack: dur * 0.9, tau: 0.05,
  });
}

export interface SaxOpts {
  /** Profondeur du vibrato retardé (cents). */
  vibrato?: number;
  /** Attaque par en dessous (cents). */
  scoop?: number;
  /** Niveau du souffle. */
  breath?: number;
  /** 0..1 brillance. */
  bright?: number;
  release?: number;
}

/**
 * Saxophone de film noir synthétique : dent de scie + carré creux à travers
 * un filtre à enveloppe et une bosse de formant, souffle, attaque « par en
 * dessous » et vibrato retardé.
 */
export function saxLead(e: SynthEnv, dest: AudioNode, t: number, freq: number, dur: number, vel: number, o: SaxOpts = {}): number {
  const ctx = e.ctx;
  const bright = o.bright ?? 0.6;
  const attack = 0.035;
  const rel = o.release ?? 0.14;
  const tOff = t + Math.max(dur, attack + 0.03);
  const end = tOff + rel * TAU_END;
  const o1 = osc(ctx, 'sawtooth', freq, t, end);
  const o2 = osc(ctx, 'square', freq, t, end, 6);
  const g2 = gainNode(ctx, 0.3);
  o2.connect(g2);
  const scoop = o.scoop ?? 60;
  o1.detune.setValueAtTime(-scoop, t);
  o1.detune.linearRampToValueAtTime(0, t + 0.07);
  o2.detune.setValueAtTime(6 - scoop, t);
  o2.detune.linearRampToValueAtTime(6, t + 0.07);
  const lp = biquad(ctx, 'lowpass', freq * 2, 1.1);
  const peakCut = clampFreq(ctx, Math.min(freq * (5 + 4 * bright), 1800 + 2600 * bright));
  const susCut = clampFreq(ctx, Math.min(freq * (3 + 2 * bright), 1300 + 1500 * bright));
  lp.frequency.setValueAtTime(clampFreq(ctx, freq * 1.5), t);
  lp.frequency.linearRampToValueAtTime(peakCut, t + 0.05);
  lp.frequency.setTargetAtTime(susCut, t + 0.05, 0.15);
  lp.frequency.setTargetAtTime(clampFreq(ctx, freq * 1.2), tOff, rel * 0.5);
  const formant = biquad(ctx, 'peaking', 1250, 1.3, 7);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + attack);
  g.gain.setTargetAtTime(vel * 0.84, t + attack, 0.12);
  g.gain.setTargetAtTime(0, tOff, rel);
  const vib = o.vibrato ?? 14;
  if (vib > 0 && dur > 0.3) {
    const lfo = osc(ctx, 'sine', 5.1 + Math.random() * 0.5, t, end);
    const depth = gainNode(ctx, 0);
    depth.gain.setValueAtTime(0, t + 0.18);
    depth.gain.linearRampToValueAtTime(vib, t + 0.18 + Math.min(0.5, dur * 0.6));
    lfo.connect(depth);
    depth.connect(o1.detune);
    depth.connect(o2.detune);
  }
  const breath = o.breath ?? 0.12;
  if (breath > 0) {
    const nz = noise(e, 'white', t, end - t);
    const bp = biquad(ctx, 'bandpass', Math.min(freq * 3, 2600), 0.9);
    chain(nz, bp, gainNode(ctx, breath), g);
  }
  o1.connect(lp); g2.connect(lp);
  chain(lp, formant, g, dest);
  return end;
}

export interface PluckOpts {
  /** Constante de décroissance (s). */
  decay?: number;
  /** Plafond de l'enveloppe de filtre (Hz). */
  cutoff?: number;
  /** Multiple de la fréquence atteint par l'enveloppe de filtre. */
  env?: number;
  q?: number;
  type?: OscillatorType;
  /** Second oscillateur désaccordé (cents), 0 = aucun. */
  detune?: number;
}

/** Note pincée d'arpégiateur : oscillateur à travers un passe-bas résonant qui se referme vite. */
export function pluck(e: SynthEnv, dest: AudioNode, t: number, freq: number, vel: number, o: PluckOpts = {}): number {
  const ctx = e.ctx;
  const decay = o.decay ?? 0.18;
  const end = t + 0.003 + decay * TAU_END;
  const type = o.type ?? 'sawtooth';
  const o1 = osc(ctx, type, freq, t, end);
  const lp = biquad(ctx, 'lowpass', freq * 2, o.q ?? 4);
  const top = clampFreq(ctx, Math.min(freq * (o.env ?? 10), o.cutoff ?? 4500));
  expSweep(lp.frequency, t, top, clampFreq(ctx, Math.max(freq * 1.2, 200)), decay * 0.9);
  if (o.detune) osc(ctx, type, freq, t, end, o.detune).connect(lp);
  const g = gainNode(ctx, 0);
  adEnv(g.gain, t, vel, 0.003, decay);
  chain(o1, lp, g, dest);
  return end;
}

export interface BassOpts { cutoff?: number; env?: number; q?: number; sub?: number; release?: number }

/** Basse synthétique : dent de scie + carré une octave dessous, passe-bas à enveloppe. */
export function synthBass(e: SynthEnv, dest: AudioNode, t: number, freq: number, dur: number, vel: number, o: BassOpts = {}): number {
  const ctx = e.ctx;
  const rel = o.release ?? 0.04;
  const tOff = t + Math.max(dur, 0.02);
  const end = tOff + rel * TAU_END;
  const o1 = osc(ctx, 'sawtooth', freq, t, end);
  const o2 = osc(ctx, 'square', freq * 0.5, t, end);
  const sub = gainNode(ctx, o.sub ?? 0.5);
  o2.connect(sub);
  const cutoff = o.cutoff ?? 600;
  const lp = biquad(ctx, 'lowpass', cutoff, o.q ?? 2.5);
  lp.frequency.setValueAtTime(clampFreq(ctx, cutoff * (o.env ?? 3)), t);
  lp.frequency.setTargetAtTime(clampFreq(ctx, cutoff), t + 0.005, 0.05);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.005);
  g.gain.setTargetAtTime(vel * 0.7, t + 0.005, 0.08);
  g.gain.setTargetAtTime(0, tOff, rel);
  o1.connect(lp); sub.connect(lp);
  chain(lp, g, dest);
  return end;
}

export interface BellOpts { ratio?: number; index?: number; decay?: number; attack?: number }

/** Cloche / piano électrique FM (verre, néon) avec un petit éclat d'octave. */
export function fmBell(e: SynthEnv, dest: AudioNode, t: number, freq: number, vel: number, o: BellOpts = {}): number {
  const decay = o.decay ?? 0.6;
  let end = fmTone(e, dest, t, {
    freq, ratio: o.ratio ?? 3.5, index: o.index ?? 1.6, peak: vel, attack: o.attack ?? 0.002, tau: decay, indexTau: decay * 0.3,
  });
  end = Math.max(end, tone(e, dest, t, { freq: freq * 2, peak: vel * 0.12, attack: 0.001, tau: decay * 0.25 }));
  return end;
}

export interface StabOpts { cutoff?: number; detune?: number; attack?: number; release?: number }

/** Accord plaqué de dents de scie (cuivres synthwave), un seul filtre et un seul gain. */
export function synthStab(e: SynthEnv, dest: AudioNode, t: number, freqs: readonly number[], dur: number, vel: number, o: StabOpts = {}): number {
  const ctx = e.ctx;
  const attack = o.attack ?? 0.005;
  const rel = o.release ?? 0.12;
  const tOff = t + Math.max(dur, attack + 0.02);
  const end = tOff + rel * TAU_END;
  const cutoff = o.cutoff ?? 3000;
  const lp = biquad(ctx, 'lowpass', cutoff, 1.2);
  lp.frequency.setValueAtTime(clampFreq(ctx, cutoff * 1.6), t);
  lp.frequency.setTargetAtTime(clampFreq(ctx, cutoff * 0.6), t + attack, 0.15);
  const g = gainNode(ctx, 0);
  const v = vel / Math.sqrt(freqs.length * 2);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + attack);
  g.gain.setTargetAtTime(v * 0.7, t + attack, 0.2);
  g.gain.setTargetAtTime(0, tOff, rel);
  const det = o.detune ?? 12;
  for (const f of freqs) {
    for (const d of [-det, det]) osc(ctx, 'sawtooth', f, t, end, d).connect(lp);
  }
  chain(lp, g, dest);
  return end;
}

/** Coup de batterie précalculée (rien tant que la batterie est en cours de génération). */
export function drum(e: SynthEnv, dest: AudioNode, t: number, kind: DrumKind, vel: number, rate = 1): number {
  const kit = e.res.drums;
  if (!kit || vel <= 0) return t;
  const buf = kit[kind];
  const src = e.ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = gainNode(e.ctx, vel);
  chain(src, g, dest);
  src.start(t);
  trackSource(src);
  return t + buf.duration / rate;
}
