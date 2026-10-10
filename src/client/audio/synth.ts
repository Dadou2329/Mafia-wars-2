/**
 * Web Audio node helpers: envelopes, oscillators, noise bursts.
 * Every helper works on a BaseAudioContext so the same code renders in a
 * realtime AudioContext and in an OfflineAudioContext.
 */
import type { AudioResources, NoiseKind } from './resources';

export interface SynthEnv {
  ctx: BaseAudioContext;
  res: AudioResources;
}

/** -52 dB after 6 time constants: considered silent. */
export const TAU_END = 6;

/**
 * Optional collector of every source node created by the helpers, so the
 * engine can stop a stolen voice's sources early. Set/cleared synchronously
 * around a synth call.
 */
let sourceCollector: AudioScheduledSourceNode[] | null = null;
export function setSourceCollector(arr: AudioScheduledSourceNode[] | null): void {
  sourceCollector = arr;
}
export function trackSource<T extends AudioScheduledSourceNode>(src: T): T {
  if (sourceCollector) sourceCollector.push(src);
  return src;
}

export function gainNode(ctx: BaseAudioContext, v = 1): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

export function biquad(
  ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7071, gainDb = 0,
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = clampFreq(ctx, freq);
  f.Q.value = q;
  if (gainDb !== 0) f.gain.value = gainDb;
  return f;
}

export function clampFreq(ctx: BaseAudioContext, f: number): number {
  return Math.min(Math.max(f, 10), ctx.sampleRate * 0.45);
}

/** Connects nodes in series; the last element may be an AudioParam (modulation). */
export function chain(...nodes: [...AudioNode[], AudioNode | AudioParam]): void {
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i] as AudioNode;
    const b = nodes[i + 1];
    if ('connect' in b) a.connect(b);
    else a.connect(b);
  }
}

export function osc(
  ctx: BaseAudioContext, type: OscillatorType, freq: number, t: number, stop: number, detune = 0,
): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = clampFreq(ctx, freq);
  if (detune) o.detune.value = detune;
  o.start(t);
  o.stop(Math.max(stop, t + 0.01));
  return trackSource(o);
}

/** Noise source started at t for `dur` seconds from a random offset of a shared buffer. */
export function noise(
  e: SynthEnv, kind: NoiseKind, t: number, dur: number, rate = 1,
): AudioBufferSourceNode {
  const src = e.ctx.createBufferSource();
  const buf = e.res.noise(kind);
  src.buffer = buf;
  src.playbackRate.value = rate;
  const span = dur * rate;
  const room = buf.duration - span;
  let offset = 0;
  if (room > 0.05) offset = Math.random() * room;
  else { src.loop = true; offset = Math.random() * buf.duration * 0.9; }
  src.start(t, offset);
  src.stop(t + Math.max(dur, 0.01));
  return trackSource(src);
}

/** Attack (linear) then exponential decay towards 0. Returns the "silent" end time. */
export function adEnv(param: AudioParam, t: number, peak: number, attack: number, tau: number): number {
  const a = Math.max(attack, 0.0005);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(0, t + a, Math.max(tau, 0.0005));
  return t + a + tau * TAU_END;
}

/** Attack, hold at peak, exponential release. Returns end time. */
export function ahrEnv(
  param: AudioParam, t: number, peak: number, attack: number, hold: number, tau: number,
): number {
  const a = Math.max(attack, 0.0005);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setValueAtTime(peak, t + a + Math.max(hold, 0));
  param.setTargetAtTime(0, t + a + Math.max(hold, 0), Math.max(tau, 0.0005));
  return t + a + Math.max(hold, 0) + tau * TAU_END;
}

/** Exponential frequency sweep. */
export function expSweep(param: AudioParam, t: number, from: number, to: number, dur: number): void {
  param.setValueAtTime(Math.max(from, 1e-3), t);
  param.exponentialRampToValueAtTime(Math.max(to, 1e-3), t + Math.max(dur, 0.001));
}

export interface NoiseBurstOpts {
  kind?: NoiseKind;
  type: BiquadFilterType;
  freq: number;
  q?: number;
  /** Optional filter sweep end frequency and duration. */
  freqEnd?: number;
  sweep?: number;
  /** Optional second filter in series. */
  type2?: BiquadFilterType;
  freq2?: number;
  q2?: number;
  peak: number;
  attack?: number;
  tau: number;
  rate?: number;
}

/** Filtered noise burst with an AD envelope. Returns end time. */
export function noiseBurst(e: SynthEnv, dest: AudioNode, t: number, o: NoiseBurstOpts): number {
  const ctx = e.ctx;
  const attack = o.attack ?? 0.001;
  const end = t + attack + o.tau * TAU_END;
  const src = noise(e, o.kind ?? 'white', t, end - t + 0.02, o.rate ?? 1);
  const f = biquad(ctx, o.type, o.freq, o.q ?? 0.7071);
  if (o.freqEnd !== undefined) expSweep(f.frequency, t, clampFreq(ctx, o.freq), clampFreq(ctx, o.freqEnd), o.sweep ?? o.tau * 3);
  const g = gainNode(ctx, 0);
  adEnv(g.gain, t, o.peak, attack, o.tau);
  if (o.type2) {
    const f2 = biquad(ctx, o.type2, o.freq2 ?? o.freq, o.q2 ?? 0.7071);
    chain(src, f, f2, g, dest);
  } else {
    chain(src, f, g, dest);
  }
  return end;
}

export interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  freqEnd?: number;
  sweep?: number;
  peak: number;
  attack?: number;
  tau: number;
  hold?: number;
  detune?: number;
}

/** Oscillator with optional pitch sweep and AD/AHR envelope. Returns end time. */
export function tone(e: SynthEnv, dest: AudioNode, t: number, o: ToneOpts): number {
  const ctx = e.ctx;
  const attack = o.attack ?? 0.002;
  const hold = o.hold ?? 0;
  const end = t + attack + hold + o.tau * TAU_END;
  const ob = osc(ctx, o.type ?? 'sine', o.freq, t, end + 0.02, o.detune ?? 0);
  if (o.freqEnd !== undefined) expSweep(ob.frequency, t, clampFreq(ctx, o.freq), clampFreq(ctx, o.freqEnd), o.sweep ?? o.tau * 2);
  const g = gainNode(ctx, 0);
  if (hold > 0) ahrEnv(g.gain, t, o.peak, attack, hold, o.tau);
  else adEnv(g.gain, t, o.peak, attack, o.tau);
  chain(ob, g, dest);
  return end;
}

/**
 * Bank of decaying sine partials (bells, coins, metal). `partials` entries are
 * [frequency ratio, amplitude, decay tau seconds]. Returns end time.
 */
export function partials(
  e: SynthEnv, dest: AudioNode, t: number, f0: number, peak: number,
  list: ReadonlyArray<readonly [number, number, number]>, attack = 0.001,
): number {
  let end = t;
  const ny = e.ctx.sampleRate * 0.45;
  for (const [ratio, amp, tau] of list) {
    const f = f0 * ratio;
    if (f >= ny) continue;
    end = Math.max(end, tone(e, dest, t, { type: 'sine', freq: f, peak: peak * amp, attack, tau }));
  }
  return end;
}

/**
 * Several short grains from ONE noise source / filter / gain (cheap clatter,
 * debris, crackle). Each grain is an envelope spike on the shared gain.
 */
export function grains(
  e: SynthEnv, dest: AudioNode, t: number,
  hits: ReadonlyArray<readonly [number, number]>, // [offset seconds, amplitude]
  o: { type: BiquadFilterType; freq: number; q?: number; tau: number; kind?: NoiseKind },
): number {
  if (hits.length === 0) return t;
  const ctx = e.ctx;
  const sorted = [...hits].sort((a, b) => a[0] - b[0]);
  const last = sorted[sorted.length - 1][0];
  const end = t + last + o.tau * TAU_END + 0.002;
  const src = noise(e, o.kind ?? 'white', t, end - t + 0.01);
  const f = biquad(ctx, o.type, o.freq, o.q ?? 1);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  for (const [off, amp] of sorted) {
    const ts = t + Math.max(0, off);
    g.gain.setValueAtTime(0, ts);
    g.gain.linearRampToValueAtTime(amp, ts + 0.0005);
    g.gain.setTargetAtTime(0, ts + 0.0005, o.tau);
  }
  chain(src, f, g, dest);
  return end;
}

/**
 * A bell (or any modal object) struck several times: one oscillator per
 * partial, re-excited analytically at every strike so energy accumulates.
 */
export function ringBell(
  e: SynthEnv, dest: AudioNode, strikes: ReadonlyArray<readonly [number, number]>, // [time, amp]
  f0: number, list: ReadonlyArray<readonly [number, number, number]>,
): number {
  if (strikes.length === 0) return 0;
  const ctx = e.ctx;
  const ny = ctx.sampleRate * 0.45;
  const t0 = strikes[0][0];
  let end = t0;
  for (const [ratio, amp, tau] of list) {
    const f = f0 * ratio;
    if (f >= ny) continue;
    const g = gainNode(ctx, 0);
    let level = 0;
    let lastT = t0;
    g.gain.setValueAtTime(0, t0);
    for (const [ts, a] of strikes) {
      level *= Math.exp(-(ts - lastT) / tau);
      g.gain.setValueAtTime(level, ts);
      level = Math.min(level + a * amp, a * amp * 1.6);
      g.gain.linearRampToValueAtTime(level, ts + 0.001);
      g.gain.setTargetAtTime(0, ts + 0.001, tau);
      lastT = ts + 0.001;
    }
    const pe = lastT + tau * TAU_END;
    const o = osc(ctx, 'sine', f, t0, pe + 0.02);
    chain(o, g, dest);
    end = Math.max(end, pe);
  }
  return end;
}

/** Random float in [lo, hi). */
export const rnd =(lo: number, hi: number): number => lo + (hi - lo) * Math.random();
/** Symmetric jitter factor around 1, e.g. jit(0.05) in [0.95, 1.05). */
export const jit = (amount: number): number => 1 + (Math.random() * 2 - 1) * amount;
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
