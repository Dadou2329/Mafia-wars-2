/**
 * Matière partagée par AudioContext : bruits, réponses impulsionnelles,
 * courbes de saturation, banques de variantes (pas, coups de feu), batterie,
 * tampons des sons continus et boucles d'ambiance. Créée une fois et
 * réutilisée par toutes les voix (aucune allocation de tampon par tir).
 *
 * Les bruits sont construits de façon synchrone (nécessaires tout de suite) ;
 * tout le reste est produit par des tâches génératrices que `work(budgetMs)`
 * fait avancer par petites tranches : déverrouiller l'audio ne bloque jamais
 * une image.
 */
import { brownNoise, mulberry32, pinkNoise, toBuffer, whiteNoise } from './dsp';
import { type DrumKit, makeDrumKit } from './drumkit';
import {
  makeCrowdLoop, makeDripLoop, makeFootsteps, makeHvacLoop, makeRainLoop, makeSubwayLoop, makeTrafficLoop,
  makeWaterLoop, type Surface,
} from './prerender';
import { type GunBankName, makeGunBank } from './prerender_guns';
import { makeLoopBuffer } from './prerender_loops';
import { makeHallIR, makeRoomIR, makeStreetIR, makeTunnelIR } from './reverb';
import { LOOP_NAMES, type LoopName } from './types';

export type NoiseKind = 'white' | 'pink' | 'brown';
/** Boucles des lits d'ambiance. */
export type LoopKind = 'crowd' | 'rain' | 'drip' | 'water' | 'hvac' | 'traffic' | 'subway';
/** Banques de variantes précalculées, rejouées par une seule source tampon. */
export type BankName = 'step_stone' | 'step_concrete' | 'step_metal' | 'step_wood' | 'step_carpet' | GunBankName;
export type ResourceKind = LoopKind | 'bank' | 'drums' | 'loopBuffer' | 'streetIR' | 'roomIR' | 'hallIR' | 'tunnelIR';

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

const STEPS: ReadonlyArray<readonly [Surface, number, number]> = [
  ['stone', 8, 11], ['concrete', 8, 44], ['metal', 8, 55], ['wood', 8, 22], ['carpet', 6, 33],
];

export class AudioResources {
  readonly ctx: BaseAudioContext;
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  streetIR: AudioBuffer | null = null;
  roomIR: AudioBuffer | null = null;
  hallIR: AudioBuffer | null = null;
  tunnelIR: AudioBuffer | null = null;
  drums: DrumKit | null = null;
  /** Variantes par banque (tableau vide tant que la banque est en cours de génération). */
  readonly banks: Record<BankName, AudioBuffer[]> = {
    step_stone: [], step_concrete: [], step_metal: [], step_wood: [], step_carpet: [],
    pistol: [], smg: [], rail: [], shotgun: [], turret: [],
    pistol_far: [], smg_far: [], rail_far: [], shotgun_far: [], turret_far: [],
  };
  /** Appelé chaque fois qu'une ressource différée devient disponible. */
  onReady: ((kind: ResourceKind) => void) | null = null;
  private readonly loops: Partial<Record<LoopKind, AudioBuffer>> = {};
  private readonly loopBufs: Partial<Record<LoopName, AudioBuffer>> = {};
  private readonly curves = new Map<number, Float32Array<ArrayBuffer>>();
  private jobs: Job[];

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const fs = ctx.sampleRate;
    const rng = mulberry32(0x2085);
    this.white = toBuffer(ctx, [whiteNoise(Math.floor(fs * 2), rng)], fs);
    this.pink = toBuffer(ctx, [pinkNoise(Math.floor(fs * 2.5), rng)], fs);
    this.brown = toBuffer(ctx, [brownNoise(Math.floor(fs * 2.5), rng)], fs);
    const ready = (k: ResourceKind): void => { this.onReady?.(k); };
    const bank = (name: BankName, gen: Generator<undefined, AudioBuffer[], unknown>): Job =>
      job('bank', gen, (b) => { this.banks[name] = b; ready('bank'); });
    const gun = (name: GunBankName, seed: number): Job => bank(name, makeGunBank(ctx, name, seed));
    const amb = (k: LoopKind, gen: Generator<undefined, AudioBuffer, unknown>): Job =>
      job(k, gen, (b) => { this.loops[k] = b; ready(k); });
    // Ordre de priorité : la musique du menu démarre dès le déverrouillage (batterie, salle),
    // puis ce que le jeu demande le plus vite (pas, armes, véhicules), enfin les ambiances.
    this.jobs = [
      job('drums', makeDrumKit(ctx), (k) => { this.drums = k; ready('drums'); }),
      job('hallIR', makeHallIR(ctx), (b) => { this.hallIR = b; ready('hallIR'); }),
      ...STEPS.map(([s, n, seed]) => bank(`step_${s}`, makeFootsteps(ctx, s, n, seed))),
      gun('pistol', 101), gun('smg', 102), gun('rail', 103), gun('shotgun', 104), gun('turret', 105),
      job('streetIR', makeStreetIR(ctx), (b) => { this.streetIR = b; ready('streetIR'); }),
      job('roomIR', makeRoomIR(ctx), (b) => { this.roomIR = b; ready('roomIR'); }),
      ...LOOP_NAMES.map((n) => job('loopBuffer', makeLoopBuffer(ctx, n), (b) => { this.loopBufs[n] = b; ready('loopBuffer'); })),
      gun('pistol_far', 201), gun('smg_far', 202), gun('rail_far', 203), gun('shotgun_far', 204), gun('turret_far', 205),
      amb('traffic', makeTrafficLoop(ctx)),
      amb('crowd', makeCrowdLoop(ctx)),
      amb('rain', makeRainLoop(ctx)),
      amb('drip', makeDripLoop(ctx)),
      amb('hvac', makeHvacLoop(ctx)),
      job('tunnelIR', makeTunnelIR(ctx), (b) => { this.tunnelIR = b; ready('tunnelIR'); }),
      amb('subway', makeSubwayLoop(ctx)),
      amb('water', makeWaterLoop(ctx)),
    ];
  }

  noise(kind: NoiseKind): AudioBuffer {
    return kind === 'white' ? this.white : kind === 'pink' ? this.pink : this.brown;
  }

  /** Boucle d'ambiance, ou null tant qu'elle est en cours de génération. */
  loop(kind: LoopKind): AudioBuffer | null {
    return this.loops[kind] ?? null;
  }

  /** Tampon d'un son continu (`audio.loop()`), ou null tant qu'il est en cours de génération. */
  loopBuffer(name: LoopName): AudioBuffer | null {
    return this.loopBufs[name] ?? null;
  }

  get hasPendingJobs(): boolean {
    return this.jobs.length > 0;
  }

  /** Fait avancer la génération différée pendant environ `budgetMs`. Renvoie vrai s'il reste du travail. */
  work(budgetMs: number): boolean {
    const t0 = nowMs();
    while (this.jobs.length) {
      if (this.jobs[0].step()) this.jobs.shift();
      if (nowMs() - t0 >= budgetMs) break;
    }
    return this.jobs.length > 0;
  }

  /** Termine toutes les tâches en attente (rendu hors ligne). */
  finishAll(): void {
    while (this.jobs.length) {
      if (this.jobs[0].step()) this.jobs.shift();
    }
  }

  /** Courbe de saturation douce (tanh), en cache par niveau de drive. */
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
