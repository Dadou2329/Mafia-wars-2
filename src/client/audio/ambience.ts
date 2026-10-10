/**
 * Generated looping ambience for Victorian London: wind, distant traffic,
 * crowd murmur, river, rain, interior room tone and fireplace, plus random
 * distant events (carriages, dogs, gulls, ship bell, fog horn, constables'
 * whistles, smithy hammering, clock ticks, floor creaks).
 */
import { HAND_BELL } from './instruments';
import type { LoopKind, NoiseKind } from './resources';
import type { SfxCtx } from './sfx_combat';
import { policeWhistle } from './sfx_misc';
import {
  ahrEnv, biquad, chain, expSweep, gainNode, grains, noise, noiseBurst, osc, partials, ringBell, rnd,
  type SynthEnv,
} from './synth';
import type { AmbienceParams } from './types';

type EventKind = 'carriage' | 'horse' | 'dog' | 'gulls' | 'shipBell' | 'fogHorn' | 'whistle' | 'anvil' | 'creak';

const INTERVALS: Record<EventKind, readonly [number, number]> = {
  carriage: [16, 40], horse: [20, 45], dog: [22, 55], gulls: [7, 18], shipBell: [35, 70],
  fogHorn: [45, 95], whistle: [80, 180], anvil: [30, 70], creak: [18, 40],
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * A layer that is disconnected from the graph while silent, so the browser
 * stops pulling (rendering) its sources and filters.
 */
interface GatedLayer { g: GainNode; dest: AudioNode; on: boolean; offAt: number }

export class Ambience {
  private readonly ctx: BaseAudioContext;
  private readonly outdoor: GainNode;
  private readonly muffle: BiquadFilterNode;
  private readonly indoorBus: GainNode;
  private readonly windG: GainNode;
  private readonly whistleG: GainNode;
  private readonly bustleG: GainNode;
  private readonly crowdG: GainNode;
  private readonly waterG: GainNode;
  private readonly rainG: GainNode;
  private readonly rainRoofG: GainNode;
  private readonly roomG: GainNode;
  private readonly fireG: GainNode;
  private readonly crowdLp: BiquadFilterNode;
  private readonly rainRoofLp: BiquadFilterNode;
  private p: Required<AmbienceParams> = { night: 0, indoor: false, nearWater: 0, combat: 0, crowd: 0, rain: 0 };
  private applied = false;
  private readonly next: Record<EventKind, number>;
  private nextTick = 0;
  private tock = false;
  private garbage: Array<{ at: number; nodes: AudioNode[] }> = [];
  private readonly gated: GatedLayer[] = [];

  constructor(private readonly e: SynthEnv, out: AudioNode, private readonly send: AudioNode, now: number) {
    const ctx = (this.ctx = e.ctx);
    this.outdoor = gainNode(ctx, 1);
    this.muffle = biquad(ctx, 'lowpass', 16000, 0.5);
    chain(this.outdoor, this.muffle, out);
    this.indoorBus = gainNode(ctx, 1);
    this.indoorBus.connect(out);

    const mk = (dest: AudioNode): GainNode => { const g = gainNode(ctx, 0); g.connect(dest); return g; };
    const gated = (dest: AudioNode): GainNode => {
      const g = gainNode(ctx, 0);
      this.gated.push({ g, dest, on: false, offAt: Infinity });
      return g;
    };
    this.windG = mk(this.outdoor);
    this.whistleG = mk(this.outdoor);
    this.bustleG = mk(this.outdoor);
    this.crowdG = gated(this.outdoor);
    this.waterG = gated(this.outdoor);
    this.rainG = gated(this.outdoor);
    this.rainRoofG = gated(this.indoorBus);
    this.roomG = gated(this.indoorBus);
    this.fireG = gated(this.indoorBus);
    this.crowdLp = biquad(ctx, 'lowpass', 2400, 0.6);
    this.crowdLp.connect(this.crowdG);
    this.rainRoofLp = biquad(ctx, 'lowpass', 800, 0.7);
    this.rainRoofLp.connect(this.rainRoofG);

    const t = now;
    // Wind: brown noise through an LFO-swept low-pass, with slow gusts.
    const wlp = biquad(ctx, 'lowpass', 380, 0.6);
    this.lfo(0.071, 160, wlp.frequency, t);
    this.lfo(0.113, 90, wlp.frequency, t);
    const gust = gainNode(ctx, 0.7);
    this.lfo(0.047, 0.3, gust.gain, t);
    chain(this.loopNoise('brown', 1, t), wlp, gust, this.windG);
    // Whistling wind between chimneys.
    const wbp = biquad(ctx, 'bandpass', 850, 9);
    this.lfo(0.09, 260, wbp.frequency, t);
    const wamp = gainNode(ctx, 0.5);
    this.lfo(0.061, 0.5, wamp.gain, t);
    chain(this.loopNoise('pink', 0.9, t), wbp, wamp, this.whistleG);
    // Distant city bustle (traffic rumble).
    chain(this.loopNoise('brown', 0.7, t), biquad(ctx, 'lowpass', 150, 0.7), this.bustleG);
    // Interior room tone + faint gas-lamp hiss.
    chain(this.loopNoise('brown', 0.5, t), biquad(ctx, 'lowpass', 170, 0.7), this.roomG);
    chain(this.loopNoise('white', 1, t), biquad(ctx, 'highpass', 5000, 0.7), gainNode(ctx, 0.012), this.roomG);

    this.next = {
      carriage: t + rnd(4, 12), horse: t + rnd(8, 20), dog: t + rnd(6, 20), gulls: t + rnd(2, 8),
      shipBell: t + rnd(10, 30), fogHorn: t + rnd(15, 40), whistle: t + rnd(40, 90), anvil: t + rnd(10, 30),
      creak: t + rnd(8, 20),
    };
    for (const k of ['crowd', 'water', 'rain', 'fire'] as const) {
      if (e.res.loop(k)) this.onLoopReady(k);
    }
  }

  get indoor(): boolean { return this.p.indoor; }

  /** Called when a pre-rendered loop buffer becomes available. */
  onLoopReady(kind: LoopKind): void {
    const buf = this.e.res.loop(kind);
    if (!buf) return;
    const t = this.ctx.currentTime;
    const start = (rate: number, dest: AudioNode): void => {
      const s = this.ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.playbackRate.value = rate;
      s.connect(dest);
      s.start(t, Math.random() * buf.duration);
    };
    if (kind === 'crowd') { start(1, this.crowdLp); start(0.96, this.crowdLp); }
    else if (kind === 'water') { start(1, this.waterG); start(0.93, this.waterG); }
    else if (kind === 'rain') { start(1, this.rainG); start(0.97, this.rainRoofLp); }
    else { start(1, this.fireG); }
  }

  setParams(params: AmbienceParams, now: number): void {
    const p: Required<AmbienceParams> = {
      night: clamp01(params.night), indoor: !!params.indoor, nearWater: clamp01(params.nearWater),
      combat: clamp01(params.combat), crowd: clamp01(params.crowd), rain: clamp01(params.rain ?? 0),
    };
    const prev = this.p;
    const changed = !this.applied || prev.indoor !== p.indoor ||
      Math.abs(prev.night - p.night) > 0.005 || Math.abs(prev.nearWater - p.nearWater) > 0.005 ||
      Math.abs(prev.crowd - p.crowd) > 0.005 || Math.abs(prev.rain - p.rain) > 0.005;
    this.p = p;
    if (!changed) return;
    const first = !this.applied;
    this.applied = true;
    const n = p.night, d = 1 - n, w = p.nearWater, c = p.crowd, r = p.rain, i = p.indoor ? 1 : 0;
    const tc = first ? 0.05 : 0.8;
    const set = (g: AudioParam, v: number, k = tc): void => {
      g.setTargetAtTime(v, now, k);
      const layer = this.gated.find((l) => l.g.gain === g);
      if (!layer) return;
      if (v > 1e-4) {
        if (!layer.on) { layer.g.connect(layer.dest); layer.on = true; }
        layer.offAt = Infinity;
      } else if (layer.on && layer.offAt === Infinity) {
        layer.offAt = now + k * 8 + 0.5;
      }
    };
    set(this.windG.gain, 0.11 + 0.12 * n + 0.08 * w + 0.06 * r);
    set(this.whistleG.gain, (0.02 + 0.05 * n) * (0.6 + 0.4 * w));
    set(this.bustleG.gain, 0.03 + 0.12 * d);
    set(this.crowdG.gain, c * (0.24 + 0.2 * d));
    set(this.crowdLp.frequency, 1400 + 1400 * c);
    set(this.waterG.gain, w * 0.35);
    set(this.rainG.gain, r * 0.45);
    const ti = first ? 0.05 : 0.25;
    set(this.rainRoofG.gain, r * 0.4 * i, ti);
    set(this.roomG.gain, i * 0.3, ti);
    set(this.fireG.gain, i * 0.35, ti);
    set(this.outdoor.gain, i ? 0.4 : 1, ti);
    set(this.muffle.frequency, i ? 650 : 16000, ti);
  }

  /** Spawn random distant events that start before `until`. */
  schedule(now: number, until: number): void {
    this.collect(now);
    for (const l of this.gated) {
      if (l.on && now >= l.offAt) { l.g.disconnect(); l.on = false; l.offAt = Infinity; }
    }
    if (!this.applied) return;
    const p = this.p;
    const d = 1 - p.night, n = p.night, w = p.nearWater, i = p.indoor ? 1 : 0;
    const prob: Record<EventKind, number> = {
      carriage: 0.35 + 0.55 * d,
      horse: 0.3 + 0.3 * d,
      dog: 0.15 + 0.7 * n,
      gulls: w > 0.15 ? w * d * 0.9 : 0,
      shipBell: w > 0.2 ? w * 0.8 : 0,
      fogHorn: w > 0.2 ? w * (0.35 + 0.65 * n) : 0,
      whistle: 0.1 + 0.3 * n,
      anvil: 0.5 * d,
      creak: i * 0.7,
    };
    for (const k of Object.keys(this.next) as EventKind[]) {
      let tt = this.next[k];
      if (tt < now - 2) tt = now + rnd(1, 5); // resync after a stall
      while (tt < until) {
        if (Math.random() < prob[k]) this.fire(k, Math.max(tt, now));
        const [a, b] = INTERVALS[k];
        tt += rnd(a, b);
      }
      this.next[k] = tt;
    }
    // Mantel clock when indoors.
    if (i) {
      if (this.nextTick < now - 0.5) this.nextTick = now + 0.1;
      while (this.nextTick < until) {
        noiseBurst(this.e, this.indoorBus, this.nextTick, {
          type: 'bandpass', freq: this.tock ? 2700 : 3500, q: 3, peak: 0.05, attack: 0.0004, tau: 0.004,
        });
        this.tock = !this.tock;
        this.nextTick += 1;
      }
    }
  }

  /* ---------------------------------------------------------------- helpers */

  private lfo(freq: number, depth: number, target: AudioParam, t: number): void {
    const o = osc(this.ctx, 'sine', freq * rnd(0.9, 1.1), t, t + 1e7);
    const g = gainNode(this.ctx, depth);
    chain(o, g);
    g.connect(target);
  }

  private loopNoise(kind: NoiseKind, rate: number, t: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    const buf = this.e.res.noise(kind);
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(t, Math.random() * buf.duration);
    return s;
  }

  /** Stereo-placed, distance-filtered event bus, disconnected after `life` seconds. */
  private place(t: number, life: number, pan: number, cutoff: number, gain: number, sendAmt: number): { input: GainNode; panner: StereoPannerNode; level: GainNode } {
    const ctx = this.ctx;
    const input = gainNode(ctx, 1);
    const lp = biquad(ctx, 'lowpass', cutoff, 0.6);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    const level = gainNode(ctx, gain);
    chain(input, lp, panner, level, this.outdoor);
    const nodes: AudioNode[] = [input, lp, panner, level];
    if (sendAmt > 0) {
      const s = gainNode(ctx, sendAmt);
      chain(lp, s, this.send);
      nodes.push(s);
    }
    this.garbage.push({ at: t + life + 3, nodes });
    return { input, panner, level };
  }

  private collect(now: number): void {
    if (!this.garbage.length) return;
    this.garbage = this.garbage.filter((g) => {
      if (g.at > now) return true;
      for (const n of g.nodes) n.disconnect();
      return false;
    });
  }

  private fire(k: EventKind, t: number): void {
    switch (k) {
      case 'carriage': this.carriage(t, true); break;
      case 'horse': this.carriage(t, false); break;
      case 'dog': this.dog(t); break;
      case 'gulls': this.gulls(t); break;
      case 'shipBell': this.shipBell(t); break;
      case 'fogHorn': this.fogHorn(t); break;
      case 'whistle': this.whistle(t); break;
      case 'anvil': this.anvil(t); break;
      case 'creak': this.creak(t); break;
    }
  }

  private carriage(t: number, wheels: boolean): void {
    const e = this.e;
    const T = rnd(5, 7.5);
    const dir = Math.random() < 0.5 ? -1 : 1;
    const { input, panner, level } = this.place(t, T, -0.85 * dir, rnd(1600, 3600), rnd(0.25, 0.5), 0.35);
    panner.pan.setValueAtTime(-0.85 * dir, t);
    panner.pan.linearRampToValueAtTime(0.85 * dir, t + T);
    const peakG = level.gain.value;
    level.gain.setValueAtTime(0.0001, t);
    level.gain.linearRampToValueAtTime(peakG, t + T * 0.5);
    level.gain.linearRampToValueAtTime(0.0001, t + T);
    if (wheels) {
      const r = noise(e, 'brown', t, T);
      chain(r, biquad(this.ctx, 'lowpass', 200, 0.8), gainNode(this.ctx, 0.6), input);
      const bumps: Array<[number, number]> = [];
      for (let tt = 0.02; tt < T - 0.05; tt += rnd(0.035, 0.075)) bumps.push([tt, rnd(0.05, 0.25)]);
      grains(e, input, t, bumps, { type: 'bandpass', freq: 900, q: 1.2, tau: 0.01 });
    }
    // Trot: clip-clop pairs.
    const hooves: Array<[number, number]> = [];
    const step = wheels ? rnd(0.3, 0.36) : rnd(0.24, 0.3);
    for (let tt = 0.05; tt < T - 0.2; tt += step * rnd(0.95, 1.05)) {
      hooves.push([tt, rnd(0.4, 0.55)]);
      hooves.push([tt + rnd(0.09, 0.13), rnd(0.25, 0.4)]);
    }
    grains(e, input, t, hooves, { type: 'bandpass', freq: 1900, q: 1.5, tau: 0.006 });
    grains(e, input, t, hooves.map(([o, a]) => [o, a * 0.8] as const), { kind: 'pink', type: 'lowpass', freq: 450, tau: 0.018 });
  }

  private dog(t: number): void {
    const ctx = this.ctx;
    const { input } = this.place(t, 3, rnd(-0.9, 0.9), rnd(1300, 2200), rnd(0.1, 0.22), 0.55);
    const bp = biquad(ctx, 'bandpass', rnd(850, 1100), 1.4);
    bp.connect(input);
    const n = 2 + Math.floor(Math.random() * 3);
    const f0 = rnd(380, 560);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const o = osc(ctx, 'sawtooth', f0, tt, tt + 0.25);
      expSweep(o.frequency, tt, f0 * 1.15, f0 * 0.6, 0.11);
      const g = gainNode(ctx, 0);
      ahrEnv(g.gain, tt, 0.9, 0.008, 0.035, 0.03);
      chain(o, g, bp);
      noiseBurst(this.e, bp, tt, { type: 'highpass', freq: 600, peak: 0.25, attack: 0.005, tau: 0.03 });
      tt += rnd(0.28, 0.45);
    }
  }

  private gulls(t: number): void {
    const ctx = this.ctx;
    const { input } = this.place(t, 3, rnd(-0.9, 0.9), 6000, rnd(0.06, 0.12), 0.4);
    const bp = biquad(ctx, 'bandpass', 2200, 1);
    bp.connect(input);
    const n = 2 + Math.floor(Math.random() * 3);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const f = rnd(1350, 1700);
      const dur = rnd(0.3, 0.45);
      const o = osc(ctx, 'triangle', f, tt, tt + dur + 0.5);
      o.frequency.setValueAtTime(f, tt);
      o.frequency.linearRampToValueAtTime(f * 1.5, tt + 0.06);
      o.frequency.exponentialRampToValueAtTime(f * 0.8, tt + dur);
      const vib = osc(ctx, 'sine', rnd(16, 22), tt, tt + dur + 0.5);
      chain(vib, gainNode(ctx, 45), o.frequency);
      const g = gainNode(ctx, 0);
      ahrEnv(g.gain, tt, 0.8, 0.02, dur * 0.5, dur * 0.15);
      chain(o, g, bp);
      tt += dur + rnd(0.12, 0.35);
    }
  }

  private shipBell(t: number): void {
    const { input } = this.place(t, 8, rnd(-0.8, 0.8), 3000, 0.2, 0.6);
    const strikes: Array<[number, number]> = [[t, 0.3], [t + 0.33, 0.24], [t + 1.3, 0.3], [t + 1.63, 0.24]];
    ringBell(this.e, input, strikes, rnd(720, 820), HAND_BELL.map(([r, a, tau]) => [r, a, tau * 2.2] as const));
  }

  private fogHorn(t: number): void {
    const ctx = this.ctx;
    const { input } = this.place(t, 9, rnd(-0.7, 0.7), 650, 0.24, 0.7);
    const lp = biquad(ctx, 'lowpass', 420, 1);
    lp.connect(input);
    const blasts = Math.random() < 0.5 ? 1 : 2;
    const f = rnd(68, 78);
    for (let b = 0; b < blasts; b++) {
      const tb = t + b * 4;
      const env = gainNode(ctx, 0);
      const hold = rnd(1.8, 2.4);
      const end = ahrEnv(env.gain, tb, 0.5, 0.35, hold, 0.35);
      for (const [mul, det, v] of [[1, -6, 0.5], [1, 7, 0.5], [0.5, 0, 0.6]] as const) {
        const o = osc(ctx, 'sawtooth', f * mul, tb, end, det);
        chain(o, gainNode(ctx, v), env);
      }
      env.connect(lp);
    }
  }

  private whistle(t: number): void {
    const { input } = this.place(t, 3, rnd(-0.9, 0.9), 2600, rnd(0.08, 0.15), 0.6);
    const s: SfxCtx = { ctx: this.ctx, res: this.e.res, out: input, t, p: rnd(0.97, 1.03) };
    policeWhistle(s);
  }

  private anvil(t: number): void {
    const { input } = this.place(t, 5, rnd(-0.9, 0.9), 2500, rnd(0.05, 0.1), 0.5);
    const n = 3 + Math.floor(Math.random() * 4);
    const f0 = rnd(600, 760);
    let tt = t;
    for (let i = 0; i < n; i++) {
      partials(this.e, input, tt, f0 * rnd(0.99, 1.01), 0.5, [[1, 1, 0.25], [2.76, 0.5, 0.15], [5.4, 0.25, 0.08]]);
      tt += rnd(0.45, 0.6);
    }
  }

  private creak(t: number): void {
    const ctx = this.ctx;
    const dur = rnd(0.25, 0.5);
    const f0 = rnd(55, 80);
    const o = osc(ctx, 'sawtooth', f0, t, t + dur + 0.5);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(rnd(60, 110), t + dur);
    const g = gainNode(ctx, 0);
    ahrEnv(g.gain, t, 0.05, 0.05, dur * 0.6, 0.06);
    chain(o, biquad(ctx, 'bandpass', rnd(800, 1100), 7), g, this.indoorBus);
  }
}
