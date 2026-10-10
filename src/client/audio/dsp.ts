/**
 * Tiny offline DSP toolkit (plain JS sample loops) used to pre-compute
 * AudioBuffers once: noise beds, impulse responses, footstep variants and
 * ambience loops. Nothing here touches the Web Audio graph.
 */

export type Rng = () => number;

/** Small fast seeded PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** Random float in [lo, hi). */
export const rr = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng();
export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** RBJ-cookbook biquad, transposed direct form II. */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private z1 = 0; private z2 = 0;

  static lowpass(fs: number, f: number, q = 0.7071): Biquad { return new Biquad().set('lp', fs, f, q); }
  static highpass(fs: number, f: number, q = 0.7071): Biquad { return new Biquad().set('hp', fs, f, q); }
  /** Band-pass with 0 dB peak gain. */
  static bandpass(fs: number, f: number, q = 1): Biquad { return new Biquad().set('bp', fs, f, q); }

  set(type: 'lp' | 'hp' | 'bp', fs: number, f: number, q: number): this {
    const w0 = (2 * Math.PI * clamp(f, 5, fs * 0.49)) / fs;
    const cs = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Math.max(q, 0.05));
    let b0: number, b1: number, b2: number;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
    else { b0 = alpha; b1 = 0; b2 = -alpha; }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * cs) / a0; this.a2 = (1 - alpha) / a0;
    return this;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** One-pole low-pass whose coefficient may be changed per sample. */
export class OnePole {
  y = 0;
  a: number;
  constructor(fs: number, f: number) { this.a = OnePole.coef(fs, f); }
  static coef(fs: number, f: number): number { return 1 - Math.exp((-2 * Math.PI * f) / fs); }
  process(x: number): number { this.y += this.a * (x - this.y); return this.y; }
}

/** Fill with white noise in [-1, 1). */
export function whiteNoise(len: number, rng: Rng): Float32Array<ArrayBuffer> {
  const d = new Float32Array(len);
  for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
  return d;
}

/** Pink noise (Paul Kellet's refined filter), roughly unit peak. */
export function pinkNoise(len: number, rng: Rng): Float32Array<ArrayBuffer> {
  const d = new Float32Array(len);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return d;
}

/** Brown(ian) noise, leaky integrated white noise. */
export function brownNoise(len: number, rng: Rng): Float32Array<ArrayBuffer> {
  const d = new Float32Array(len);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = rng() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.5;
  }
  return d;
}

/**
 * Makes `src` (length L + fade) loop seamlessly: returns length L where the
 * first `fade` samples are an equal-power crossfade with the overhanging tail.
 */
export function loopify(src: Float32Array, fade: number): Float32Array<ArrayBuffer> {
  const L = src.length - fade;
  const out = new Float32Array(L);
  out.set(src.subarray(0, L));
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    const gIn = Math.sin(t * Math.PI * 0.5);
    const gOut = Math.cos(t * Math.PI * 0.5);
    out[i] = src[i] * gIn + src[L + i] * gOut;
  }
  return out;
}

export function peak(d: Float32Array): number {
  let p = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; }
  return p;
}

export function rms(d: Float32Array): number {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, d.length));
}

export function scale(d: Float32Array, g: number): void {
  for (let i = 0; i < d.length; i++) d[i] *= g;
}

export function normalizePeak(d: Float32Array, target: number): void {
  const p = peak(d);
  if (p > 1e-9) scale(d, target / p);
}

export function normalizeRms(d: Float32Array, target: number): void {
  const r = rms(d);
  if (r > 1e-9) scale(d, target / r);
}

/** Remove DC offset with a gentle one-pole high-pass (in place). */
export function dcBlock(d: Float32Array, fs: number, f = 20): void {
  const R = Math.exp((-2 * Math.PI * f) / fs);
  let x1 = 0, y1 = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    const y = x - x1 + R * y1;
    x1 = x; y1 = y;
    d[i] = y;
  }
}

/** Creates an AudioBuffer from channel arrays (all same length). */
export function toBuffer(
  ctx: BaseAudioContext,
  channels: Float32Array<ArrayBuffer>[],
  sampleRate: number,
): AudioBuffer {
  const len = Math.max(1, channels[0]?.length ?? 1);
  const buf = ctx.createBuffer(channels.length, len, sampleRate);
  channels.forEach((ch, i) => buf.copyToChannel(ch, i));
  return buf;
}

/** Sample rate used for pre-rendered ambience loops (cheap, content is mostly < 8 kHz). */
export function loopRate(ctx: BaseAudioContext): number {
  // 22.05 kHz is supported everywhere (Chrome/Firefox accept 3–768 kHz buffers).
  return Math.min(ctx.sampleRate, 22050);
}
