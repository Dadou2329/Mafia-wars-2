/**
 * Per-AudioContext shared material: noise beds, impulse responses, shaper
 * curves, footstep variants and ambience loops. Created once and reused by
 * every voice (no per-shot buffer allocation).
 *
 * Noise beds are built synchronously (needed immediately); everything else is
 * produced by generator jobs that `work(budgetMs)` advances in small time
 * slices, so unlocking audio never stalls a frame.
 */
import { brownNoise, mulberry32, pinkNoise, toBuffer, whiteNoise } from './dsp';
import {
  makeCrowdLoop, makeFireLoop, makeFootsteps, makeRainLoop, makeWaterLoop, type Surface,
} from './prerender';
import { makeHallIR, makeRoomIR, makeStreetIR } from './reverb';

export type NoiseKind = 'white' | 'pink' | 'brown';
export type LoopKind = 'crowd' | 'rain' | 'fire' | 'water';
export type ResourceKind = LoopKind | 'footsteps' | 'streetIR' | 'roomIR' | 'hallIR';

interface Job { kind: ResourceKind; step(): boolean }

function job<T>(kind: ResourceKind, gen: Generator<undefined, T, unknown>, done: (v: T) => void): Job {
  return {
    kind,
    step(): boolean {
      const r = gen.next();
      if (r.done) { done(r.value); return true; }
      return false;
    },
  };
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class AudioResources {
  readonly ctx: BaseAudioContext;
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  streetIR: AudioBuffer | null = null;
  roomIR: AudioBuffer | null = null;
  hallIR: AudioBuffer | null = null;
  readonly footsteps: Record<Surface, AudioBuffer[]> = { stone: [], wood: [], carpet: [] };
  /** Called whenever a deferred resource becomes available. */
  onReady: ((kind: ResourceKind) => void) | null = null;
  private readonly loops: Partial<Record<LoopKind, AudioBuffer>> = {};
  private readonly curves = new Map<number, Float32Array<ArrayBuffer>>();
  private jobs: Job[];

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const fs = ctx.sampleRate;
    const rng = mulberry32(0xdad0);
    this.white = toBuffer(ctx, [whiteNoise(Math.floor(fs * 2), rng)], fs);
    this.pink = toBuffer(ctx, [pinkNoise(Math.floor(fs * 2.5), rng)], fs);
    this.brown = toBuffer(ctx, [brownNoise(Math.floor(fs * 2.5), rng)], fs);
    const ready = (k: ResourceKind): void => { this.onReady?.(k); };
    this.jobs = [
      job('footsteps', makeFootsteps(ctx, 'stone', 8, 11), (b) => { this.footsteps.stone = b; ready('footsteps'); }),
      job('footsteps', makeFootsteps(ctx, 'wood', 8, 22), (b) => { this.footsteps.wood = b; ready('footsteps'); }),
      job('footsteps', makeFootsteps(ctx, 'carpet', 6, 33), (b) => { this.footsteps.carpet = b; ready('footsteps'); }),
      job('streetIR', makeStreetIR(ctx), (b) => { this.streetIR = b; ready('streetIR'); }),
      job('roomIR', makeRoomIR(ctx), (b) => { this.roomIR = b; ready('roomIR'); }),
      job('hallIR', makeHallIR(ctx), (b) => { this.hallIR = b; ready('hallIR'); }),
      job('crowd', makeCrowdLoop(ctx), (b) => { this.loops.crowd = b; ready('crowd'); }),
      job('water', makeWaterLoop(ctx), (b) => { this.loops.water = b; ready('water'); }),
      job('rain', makeRainLoop(ctx), (b) => { this.loops.rain = b; ready('rain'); }),
      job('fire', makeFireLoop(ctx), (b) => { this.loops.fire = b; ready('fire'); }),
    ];
  }

  noise(kind: NoiseKind): AudioBuffer {
    return kind === 'white' ? this.white : kind === 'pink' ? this.pink : this.brown;
  }

  /** Ambience loop buffer, or null while it is still being generated. */
  loop(kind: LoopKind): AudioBuffer | null {
    return this.loops[kind] ?? null;
  }

  get hasPendingJobs(): boolean {
    return this.jobs.length > 0;
  }

  /** Advances deferred generation for about `budgetMs`. Returns true if work remains. */
  work(budgetMs: number): boolean {
    const t0 = nowMs();
    while (this.jobs.length) {
      if (this.jobs[0].step()) this.jobs.shift();
      if (nowMs() - t0 >= budgetMs) break;
    }
    return this.jobs.length > 0;
  }

  /** Runs every pending job to completion (offline rendering). */
  finishAll(): void {
    while (this.jobs.length) {
      if (this.jobs[0].step()) this.jobs.shift();
    }
  }

  /** Soft-clip (tanh) curve, cached per drive amount. */
  shaperCurve(drive: number): Float32Array<ArrayBuffer> {
    const key = Math.round(drive * 10);
    let c = this.curves.get(key);
    if (!c) {
      const n = 2048;
      c = new Float32Array(n);
      const k = Math.max(0.1, key / 10);
      const norm = Math.tanh(k);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = Math.tanh(k * x) / norm;
      }
      this.curves.set(key, c);
    }
    return c;
  }
}
