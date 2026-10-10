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

type IrKind = 'streetIR' | 'roomIR' | 'hallIR' | 'tunnelIR';

/**
 * Matière déjà générée, partagée entre contextes de même fréquence
 * d'échantillonnage (la spécification autorise un AudioBuffer dans plusieurs
 * contextes) : un rendu hors ligne ou un nouveau déverrouillage après
 * dispose() ne refont pas le travail.
 */
interface Shared {
  noise?: [AudioBuffer, AudioBuffer, AudioBuffer];
  ir: Partial<Record<IrKind, AudioBuffer>>;
  banks: Partial<Record<BankName, AudioBuffer[]>>;
  drums?: DrumKit;
  loops: Partial<Record<LoopKind, AudioBuffer>>;
  loopBufs: Partial<Record<LoopName, AudioBuffer>>;
}
const SHARED = new Map<number, Shared>();

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
  private jobs: Job[] = [];

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const fs = ctx.sampleRate;
    let sh = SHARED.get(fs);
    if (!sh) { sh = { ir: {}, banks: {}, loops: {}, loopBufs: {} }; SHARED.set(fs, sh); }
    const shared = sh;
    if (!shared.noise) {
      const rng = mulberry32(0x2085);
      shared.noise = [
        toBuffer(ctx, [whiteNoise(Math.floor(fs * 2), rng)], fs),
        toBuffer(ctx, [pinkNoise(Math.floor(fs * 2.5), rng)], fs),
        toBuffer(ctx, [brownNoise(Math.floor(fs * 2.5), rng)], fs),
      ];
    }
    [this.white, this.pink, this.brown] = shared.noise;
    const ready = (k: ResourceKind): void => { this.onReady?.(k); };
    const add = (j: Job | null): void => { if (j) this.jobs.push(j); };
    const ir = (kind: IrKind, make: (c: BaseAudioContext) => Generator<undefined, AudioBuffer, unknown>): Job | null => {
      const set = (b: AudioBuffer): void => {
        if (kind === 'streetIR') this.streetIR = b;
        else if (kind === 'roomIR') this.roomIR = b;
        else if (kind === 'hallIR') this.hallIR = b;
        else this.tunnelIR = b;
      };
      const c = shared.ir[kind];
      if (c) { set(c); return null; }
      return job(kind, make(ctx), (b) => { shared.ir[kind] = b; set(b); ready(kind); });
    };
    const bank = (name: BankName, make: () => Generator<undefined, AudioBuffer[], unknown>): Job | null => {
      const c = shared.banks[name];
      if (c) { this.banks[name] = c; return null; }
      return job('bank', make(), (b) => { shared.banks[name] = b; this.banks[name] = b; ready('bank'); });
    };
    const gun = (name: GunBankName, seed: number): Job | null => bank(name, () => makeGunBank(ctx, name, seed));
    const amb = (k: LoopKind, make: (c: BaseAudioContext) => Generator<undefined, AudioBuffer, unknown>): Job | null => {
      const c = shared.loops[k];
      if (c) { this.loops[k] = c; return null; }
      return job(k, make(ctx), (b) => { shared.loops[k] = b; this.loops[k] = b; ready(k); });
    };
    const loopBuf = (n: LoopName): Job | null => {
      const c = shared.loopBufs[n];
      if (c) { this.loopBufs[n] = c; return null; }
      return job('loopBuffer', makeLoopBuffer(ctx, n), (b) => { shared.loopBufs[n] = b; this.loopBufs[n] = b; ready('loopBuffer'); });
    };
    // Ordre de priorité : la musique du menu démarre dès le déverrouillage (batterie, salle),
    // puis ce que le jeu demande le plus vite (pas, armes, véhicules), enfin les ambiances.
    if (shared.drums) this.drums = shared.drums;
    else add(job('drums', makeDrumKit(ctx), (k) => { shared.drums = k; this.drums = k; ready('drums'); }));
    add(ir('hallIR', makeHallIR));
    for (const [surf, n, seed] of STEPS) add(bank(`step_${surf}`, () => makeFootsteps(ctx, surf, n, seed)));
    add(gun('pistol', 101)); add(gun('smg', 102)); add(gun('rail', 103)); add(gun('shotgun', 104)); add(gun('turret', 105));
    add(ir('streetIR', makeStreetIR));
    add(ir('roomIR', makeRoomIR));
    for (const n of LOOP_NAMES) add(loopBuf(n));
    add(gun('pistol_far', 201)); add(gun('smg_far', 202)); add(gun('rail_far', 203)); add(gun('shotgun_far', 204)); add(gun('turret_far', 205));
    add(amb('traffic', makeTrafficLoop));
    add(amb('crowd', makeCrowdLoop));
    add(amb('rain', makeRainLoop));
    add(amb('drip', makeDripLoop));
    add(amb('hvac', makeHvacLoop));
    add(ir('tunnelIR', makeTunnelIR));
    add(amb('subway', makeSubwayLoop));
    add(amb('water', makeWaterLoop));
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
