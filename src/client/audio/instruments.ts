/**
 * Instrument voices built from Web Audio nodes. Each function schedules one
 * note at absolute time `t` into `dest` and returns the time it is silent.
 */
import {
  adEnv, biquad, chain, clampFreq, expSweep, gainNode, noiseBurst, osc, partials,
  type SynthEnv, TAU_END, tone,
} from './synth';

type PartialList = ReadonlyArray<readonly [number, number, number]>;

export interface BrassOpts {
  /** 0..1 brightness (filter opening). */
  bright?: number;
  attack?: number;
  release?: number;
  /** Vibrato depth in cents (applied after ~0.25 s). */
  vibrato?: number;
  detune?: number;
}

/** Brass-like note: detuned saws through an enveloped low-pass with delayed vibrato. */
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

/** Music-box / celesta: sine + soft triangle octave + short metallic tine partial. */
export function celesta(e: SynthEnv, dest: AudioNode, t: number, freq: number, vel: number, decay?: number): number {
  const tau = decay ?? Math.min(1.1, Math.max(0.28, 0.85 * Math.sqrt(523 / freq)));
  let end = tone(e, dest, t, { type: 'sine', freq, peak: vel, attack: 0.002, tau });
  end = Math.max(end, tone(e, dest, t, { type: 'triangle', freq: freq * 2, peak: vel * 0.12, attack: 0.002, tau: tau * 0.45 }));
  end = Math.max(end, tone(e, dest, t, { type: 'sine', freq: freq * 4.02, peak: vel * 0.07, attack: 0.001, tau: tau * 0.1 }));
  return end;
}

/** Pizzicato string pluck. */
export function pizz(e: SynthEnv, dest: AudioNode, t: number, freq: number, vel: number, tau = 0.16): number {
  const ctx = e.ctx;
  const end = t + 0.004 + tau * TAU_END;
  const o1 = osc(ctx, 'triangle', freq, t, end);
  const o2 = osc(ctx, 'sawtooth', freq, t, end, 4);
  const mix = gainNode(ctx, 0.45);
  o2.connect(mix);
  const lp = biquad(ctx, 'lowpass', freq * 8, 1.6);
  expSweep(lp.frequency, t, clampFreq(ctx, Math.min(freq * 10, 5000)), clampFreq(ctx, freq * 1.3), 0.14);
  const g = gainNode(ctx, 0);
  adEnv(g.gain, t, vel, 0.003, tau);
  o1.connect(lp); mix.connect(lp);
  chain(lp, g, dest);
  return end;
}

export interface PadOpts { cutoff?: number; attack?: number; release?: number; detune?: number; vibrato?: number }

/** Soft string pad: two detuned saws per note through a low-pass, slow attack. */
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

/** Timpani-like membrane hit with mallet noise. */
export function timpani(e: SynthEnv, dest: AudioNode, t: number, freq: number, vel: number): number {
  let end = tone(e, dest, t, { type: 'sine', freq: freq * 1.05, freqEnd: freq, sweep: 0.08, peak: vel, attack: 0.003, tau: 0.55 });
  end = Math.max(end, tone(e, dest, t, { type: 'sine', freq: freq * 1.5, peak: vel * 0.35, attack: 0.003, tau: 0.3 }));
  end = Math.max(end, tone(e, dest, t, { type: 'sine', freq: freq * 1.99, peak: vel * 0.2, attack: 0.003, tau: 0.18 }));
  end = Math.max(end, tone(e, dest, t, { type: 'sine', freq: freq * 2.44, peak: vel * 0.1, attack: 0.002, tau: 0.1 }));
  end = Math.max(end, noiseBurst(e, dest, t, { kind: 'pink', type: 'lowpass', freq: 700, q: 0.8, peak: vel * 0.5, attack: 0.001, tau: 0.02 }));
  return end;
}

/** Short staccato low-string note. */
export function stringStacc(e: SynthEnv, dest: AudioNode, t: number, freq: number, vel: number, len: number): number {
  const ctx = e.ctx;
  const end = t + len + 0.25;
  const o1 = osc(ctx, 'sawtooth', freq, t, end, -6);
  const o2 = osc(ctx, 'sawtooth', freq, t, end, 6);
  const lp = biquad(ctx, 'lowpass', 2200, 1.1);
  expSweep(lp.frequency, t, clampFreq(ctx, Math.min(freq * 14, 3200)), clampFreq(ctx, freq * 3), len + 0.05);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.008);
  g.gain.setTargetAtTime(vel * 0.5, t + 0.008, len * 0.4);
  g.gain.setTargetAtTime(0, t + len, 0.03);
  o1.connect(lp); o2.connect(lp);
  chain(lp, g, dest);
  return end;
}

/** Suspended cymbal / crash wash. */
export function cymbal(e: SynthEnv, dest: AudioNode, t: number, vel: number, tau = 0.8, attack = 0.002): number {
  return noiseBurst(e, dest, t, {
    kind: 'white', type: 'highpass', freq: 4500, q: 0.6, type2: 'peaking', freq2: 8500, q2: 0.8,
    peak: vel, attack, tau,
  });
}

/* ------------------------------------------------------------------ bells */

/** Church / tower bell partials relative to the strike (prime) note. */
export const TOWER_BELL: PartialList = [
  [0.5, 0.5, 5.0], [0.502, 0.25, 4.6],   // hum (with beating partner)
  [1.0, 0.7, 3.2], [1.0035, 0.3, 3.0],   // prime / strike note
  [1.19, 0.42, 2.4],                      // minor-third tierce
  [1.5, 0.25, 1.9],                       // quint
  [2.0, 0.55, 1.5],                       // nominal
  [2.52, 0.2, 1.0], [2.66, 0.18, 0.9],
  [3.01, 0.15, 0.7], [4.07, 0.08, 0.4], [5.43, 0.05, 0.22],
];

export const HAND_BELL: PartialList = [
  [1.0, 1.0, 0.7], [2.0, 0.35, 0.45], [2.42, 0.4, 0.35], [3.03, 0.2, 0.25], [4.2, 0.15, 0.15], [5.4, 0.08, 0.1],
];

export const DESK_BELL: PartialList = [
  [1.0, 1.0, 0.9], [2.32, 0.45, 0.55], [4.25, 0.25, 0.3], [6.63, 0.12, 0.16],
];

export const COIN: PartialList = [
  [1.0, 1.0, 0.09], [2.71, 0.6, 0.06], [4.13, 0.35, 0.04], [5.9, 0.2, 0.025],
];

/** Bell strike: partial bank plus a short clapper transient. */
export function bell(
  e: SynthEnv, dest: AudioNode, t: number, freq: number, vel: number, list: PartialList = TOWER_BELL, decayScale = 1,
): number {
  const scaled = decayScale === 1 ? list : list.map(([r, a, tau]) => [r, a, tau * decayScale] as const);
  let end = partials(e, dest, t, freq, vel, scaled, 0.0015);
  end = Math.max(end, noiseBurst(e, dest, t, {
    kind: 'white', type: 'bandpass', freq: Math.min(freq * 3, 6000), q: 1.2, peak: vel * 0.35, attack: 0.0005, tau: 0.008,
  }));
  return end;
}
