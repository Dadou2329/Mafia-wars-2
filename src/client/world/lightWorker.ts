// Worker d'éclairage : calcule d'abord les tuiles demandées (fenêtre fine autour de la caméra), puis,
// en tâche de fond, toutes les autres en partant de la caméra (le reste de la ville reçoit ainsi sa
// version grossière). Les tuiles calculées restent en cache, compressées.
import { VoxelWorld, type ChunkExport } from '../../shared/voxel';
import type { LightSource } from '../../shared/city/gen/context';
import { coarsen, LightService, tileSize } from '../render/lightService';

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

/** Tuiles par côté d'un bloc de tâche de fond. */
const BLOCK = 4;
/** Tuiles fines au plus par message. */
const MAX_PER_MSG = 12;

let svc: LightService | null = null;
let wanted: number[] = [];
let cam: [number, number] = [0, 0];
let coarseSent = new Uint8Array(0);
let blocksDone = new Uint8Array(0);
let timer: ReturnType<typeof setTimeout> | 0 = 0;
let t0 = 0;
let announced = false;

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') {
    const [sx, sy, sz] = m.dims as number[];
    const world = new VoxelWorld(sx, sy, sz);
    world.importChunks(m.chunks as ChunkExport);
    svc = new LightService(world, m.lights as LightSource[]);
    coarseSent = new Uint8Array(svc.tileCount);
    const d = svc.dims;
    blocksDone = new Uint8Array(Math.ceil(d.tx / BLOCK) * Math.ceil(d.tz / BLOCK));
    t0 = performance.now();
    schedule();
  } else if (m.type === 'want') {
    wanted = m.tiles as number[];
    cam = m.cam as [number, number];
    schedule();
  }
};

function schedule(): void {
  if (!timer) timer = setTimeout(pump, 0);
}

function coarseItem(s: LightService, t: number, fine: Uint8Array): { t: number; coarse: Uint8Array } {
  const [w, dz] = tileSize(s.dims, t);
  coarseSent[t] = 1;
  return { t, coarse: coarsen(s.dims, fine, w, dz) };
}

function pump(): void {
  timer = 0;
  const s = svc;
  if (!s) return;
  const d = s.dims;
  // 1) tuiles demandées : celles du cache partent tout de suite ; la première manquante est
  //    calculée avec ses voisines (bloc 2×2)
  if (wanted.length > 0) {
    const items: { t: number; fine: Uint8Array; coarse?: Uint8Array }[] = [];
    const rest: number[] = [];
    let computed = false;
    for (const t of wanted) {
      if (items.length >= MAX_PER_MSG) {
        rest.push(t);
        continue;
      }
      if (!s.has(t)) {
        if (computed) {
          rest.push(t);
          continue;
        }
        computed = true;
        const tx = t % d.tx;
        const tz = (t - tx) / d.tx;
        for (const r of s.computeRect(tx & ~1, tz & ~1, (tx & ~1) + 2, (tz & ~1) + 2)) {
          if (r.t === t) continue;
          if (!coarseSent[r.t]) post({ type: 'coarse', items: [coarseItem(s, r.t, r.fine)] });
        }
      }
      const fine = s.tile(t);
      const it: { t: number; fine: Uint8Array; coarse?: Uint8Array } = { t, fine };
      if (!coarseSent[t]) it.coarse = coarseItem(s, t, fine).coarse;
      items.push(it);
    }
    wanted = rest;
    const transfer: Transferable[] = [];
    for (const it of items) {
      transfer.push(it.fine.buffer);
      if (it.coarse) transfer.push(it.coarse.buffer);
    }
    if (items.length > 0) post({ type: 'tiles', items }, transfer);
    schedule();
    return;
  }
  // 2) tâche de fond : le bloc non calculé le plus proche de la caméra
  const bx = Math.ceil(d.tx / BLOCK);
  const blockM = BLOCK * 16; // m
  let best = -1;
  let bestD = Infinity;
  for (let b = 0; b < blocksDone.length; b++) {
    if (blocksDone[b]) continue;
    const i = b % bx;
    const k = (b - i) / bx;
    const dd = Math.hypot((i + 0.5) * blockM - cam[0], (k + 0.5) * blockM - cam[1]);
    if (dd < bestD) {
      bestD = dd;
      best = b;
    }
  }
  if (best < 0) {
    if (!announced) {
      announced = true;
      post({ type: 'idle', ms: performance.now() - t0, bytes: s.bytes });
    }
    return;
  }
  blocksDone[best] = 1;
  const i = best % bx;
  const k = (best - i) / bx;
  // seules les tuiles pas encore calculées (rectangle englobant)
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -1;
  let z1 = -1;
  for (let tz = k * BLOCK; tz < Math.min(d.tz, (k + 1) * BLOCK); tz++)
    for (let tx = i * BLOCK; tx < Math.min(d.tx, (i + 1) * BLOCK); tx++)
      if (!s.has(tz * d.tx + tx)) {
        x0 = Math.min(x0, tx);
        z0 = Math.min(z0, tz);
        x1 = Math.max(x1, tx + 1);
        z1 = Math.max(z1, tz + 1);
      }
  if (x1 >= 0) {
    const items: { t: number; coarse: Uint8Array }[] = [];
    for (const r of s.computeRect(x0, z0, x1, z1)) if (!coarseSent[r.t]) items.push(coarseItem(s, r.t, r.fine));
    if (items.length > 0)
      post(
        { type: 'coarse', items },
        items.map((it) => it.coarse.buffer),
      );
  }
  schedule();
}
