// Source des tuiles d'éclairage côté fil principal : un worker d'éclairage (cas normal) ou, en
// repli, le service d'éclairage exécuté sur place. Le volume grossier (cellules de 1 m) de toute
// la ville est tenu à jour ici, au fil des tuiles calculées.

import type { LightSource } from '../../shared/city/gen/context';
import { chunkTransferables, type ChunkExport, type VoxelWorld } from '../../shared/voxel';
import { coarsen, LIGHT_TILE, LightService, lightDims, tileSize, type LightDims } from '../render/lightService';

export interface LightFeed {
  readonly dims: LightDims;
  /** Volume grossier de toute la ville (RG, cellules de 1 m). */
  readonly coarse: Uint8Array;
  /** Tuiles fines demandées (ordre de priorité) et position de la caméra (m). */
  want(tiles: number[], camX: number, camZ: number): void;
  /** Avant la partie : les calculs de fond partent de ces points (QG de départ). */
  focus(points: [number, number][]): void;
  /** Reçoit les tuiles fines (données à téléverser aussitôt). */
  onTile: ((t: number, fine: Uint8Array) => void) | null;
  /** Tuiles dont la version grossière a changé depuis le dernier appel. */
  takeCoarse(): number[];
  /** Repli sans worker : avance les calculs (appelé à chaque image). */
  pump(): void;
}

abstract class BaseFeed implements LightFeed {
  readonly dims: LightDims;
  readonly coarse: Uint8Array;
  onTile: ((t: number, fine: Uint8Array) => void) | null = null;
  private dirty: number[] = [];

  constructor(dims: LightDims) {
    this.dims = dims;
    this.coarse = new Uint8Array(dims.cnx * dims.cny * dims.cnz * 2);
    // en attendant les calculs : ciel ouvert, pas de lampe
    for (let i = 0; i < this.coarse.length; i += 2) this.coarse[i] = 255;
  }

  abstract want(tiles: number[], camX: number, camZ: number): void;

  focus(points: [number, number][]): void {
    void points;
  }
  abstract pump(): void;

  takeCoarse(): number[] {
    const d = this.dirty;
    this.dirty = [];
    return d;
  }

  /** Recopie la version grossière d'une tuile dans le volume de la ville. */
  protected putCoarse(t: number, c: Uint8Array): void {
    const d = this.dims;
    const tx = t % d.tx;
    const tz = (t - tx) / d.tx;
    const [w, dz] = tileSize(d, t);
    const cw = Math.ceil(w / 2);
    const cd = Math.ceil(dz / 2);
    const ci0 = (tx * LIGHT_TILE) / 2;
    const ck0 = (tz * LIGHT_TILE) / 2;
    for (let k = 0; k < cd; k++)
      for (let j = 0; j < d.cny; j++) {
        const src = (k * d.cny + j) * cw * 2;
        this.coarse.set(c.subarray(src, src + cw * 2), (((ck0 + k) * d.cny + j) * d.cnx + ci0) * 2);
      }
    this.dirty.push(t);
  }
}

/** Calculs dans un worker dédié (qui garde sa propre copie du monde). */
export class WorkerLightFeed extends BaseFeed {
  private worker: Worker;

  constructor(dims: LightDims, sizes: [number, number, number], chunks: ChunkExport, lights: LightSource[]) {
    super(dims);
    this.worker = new Worker(new URL('./lightWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'coarse') {
        for (const it of m.items as { t: number; coarse: Uint8Array }[]) this.putCoarse(it.t, it.coarse);
      } else if (m.type === 'tiles') {
        for (const it of m.items as { t: number; fine: Uint8Array; coarse?: Uint8Array }[]) {
          if (it.coarse) this.putCoarse(it.t, it.coarse);
          this.onTile?.(it.t, it.fine);
        }
      } else if (m.type === 'idle') {
        console.info(`[éclairage] ville entière calculée en ${(m.ms / 1000).toFixed(1)} s (cache ${(m.bytes / 1e6).toFixed(1)} Mo)`);
      }
    };
    this.worker.postMessage({ type: 'init', dims: sizes, chunks, lights }, chunkTransferables(chunks));
  }

  want(tiles: number[], camX: number, camZ: number): void {
    this.worker.postMessage({ type: 'want', tiles, cam: [camX, camZ] });
  }

  override focus(points: [number, number][]): void {
    this.worker.postMessage({ type: 'focus', points });
  }

  pump(): void {
    /* le worker avance seul */
  }
}

/** Repli : le service tourne sur le fil principal, une poignée de tuiles par image. */
export class LocalLightFeed extends BaseFeed {
  private svc: LightService;
  private wanted: number[] = [];

  constructor(world: VoxelWorld, lights: LightSource[]) {
    super(lightDims(world));
    this.svc = new LightService(world, lights);
  }

  want(tiles: number[]): void {
    this.wanted = tiles.slice();
  }

  pump(): void {
    const t = this.wanted.shift();
    if (t === undefined) return;
    const d = this.dims;
    if (!this.svc.has(t)) {
      const tx = t % d.tx;
      const tz = (t - tx) / d.tx;
      for (const r of this.svc.computeRect(tx & ~1, tz & ~1, (tx & ~1) + 2, (tz & ~1) + 2)) {
        const [w, dz] = tileSize(d, r.t);
        this.putCoarse(r.t, coarsen(d, r.fine, w, dz));
      }
    }
    this.onTile?.(t, this.svc.tile(t));
  }
}
