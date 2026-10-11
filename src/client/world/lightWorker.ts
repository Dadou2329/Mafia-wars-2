// Worker d'éclairage, en deux rôles (deux instances, chacune avec sa copie du monde) :
// - « demande » : calcule au plus vite les tuiles fines demandées (fenêtre autour de la caméra) et
//   les garde en cache compressé ; avant la partie, il prépare les fenêtres des QG de départ ;
// - « fond » : parcourt toute la ville en partant de la caméra et n'envoie que la version
//   grossière des tuiles (le reste de la ville). Une demande n'attend donc jamais la tâche de fond.
import { VoxelWorld, type ChunkExport } from '../../shared/voxel';
import type { LightSource } from '../../shared/city/gen/context';
import { coarsen, LIGHT_TILE, LightService, tileSize } from '../render/lightService';

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

/** Tuiles par côté d'un bloc de tâche de fond. */
const BLOCK = 4;
/** Tuiles fines au plus par message. */
const MAX_PER_MSG = 12;
/** Fenêtre fine préparée autour d'un QG (tuiles par côté, comme la fenêtre du rendu). */
const WIN = 8;

let role: 'demand' | 'background' = 'demand';
let svc: LightService | null = null;
let wanted: number[] = [];
/** Tuiles à préparer (rôle « demande ») avant qu'on les demande. */
let prefetch: number[] = [];
/** Points d'intérêt (caméra, ou QG de départ avant la partie) : la tâche de fond part de là. */
let focus: [number, number][] = [[0, 0]];
let coarseSent = new Uint8Array(0);
let blocksDone = new Uint8Array(0);
let timer: ReturnType<typeof setTimeout> | 0 = 0;
let t0 = 0;
let announced = false;

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') {
    role = m.role ?? 'demand';
    const [sx, sy, sz] = m.dims as number[];
    const world = new VoxelWorld(sx, sy, sz);
    world.importChunks(m.chunks as ChunkExport);
    svc = new LightService(world, m.lights as LightSource[]);
    coarseSent = new Uint8Array(svc.tileCount);
    const d = svc.dims;
    blocksDone = new Uint8Array(Math.ceil(d.tx / BLOCK) * Math.ceil(d.tz / BLOCK));
    t0 = performance.now();
    if (role === 'demand') prefetch = windowsAround(focus);
    schedule();
  } else if (m.type === 'want') {
    wanted = m.tiles as number[];
    focus = [m.cam as [number, number]];
    schedule();
  } else if (m.type === 'focus') {
    focus = m.points as [number, number][];
    if (role === 'demand') prefetch = windowsAround(focus);
    schedule();
  }
};

function schedule(): void {
  if (!timer) timer = setTimeout(pump, 0);
}

/** Tuiles des fenêtres fines centrées sur ces points, les plus proches d'abord. */
function windowsAround(points: [number, number][]): number[] {
  const s = svc;
  if (!s) return [];
  const d = s.dims;
  const tm = LIGHT_TILE * 0.5;
  const out: { t: number; dd: number }[] = [];
  const seen = new Set<number>();
  for (const [x, z] of points) {
    const cx = Math.min(d.tx - 1, Math.max(0, Math.floor(x / tm)));
    const cz = Math.min(d.tz - 1, Math.max(0, Math.floor(z / tm)));
    const ox = Math.max(0, Math.min(d.tx - WIN, cx - WIN / 2));
    const oz = Math.max(0, Math.min(d.tz - WIN, cz - WIN / 2));
    for (let tz = oz; tz < Math.min(d.tz, oz + WIN); tz++)
      for (let tx = ox; tx < Math.min(d.tx, ox + WIN); tx++) {
        const t = tz * d.tx + tx;
        if (seen.has(t)) continue;
        seen.add(t);
        out.push({ t, dd: Math.hypot((tx + 0.5) * tm - x, (tz + 0.5) * tm - z) });
      }
  }
  out.sort((a, b) => a.dd - b.dd);
  return out.map((o) => o.t);
}

function coarseItem(s: LightService, t: number, fine: Uint8Array): { t: number; coarse: Uint8Array } {
  const [w, dz] = tileSize(s.dims, t);
  coarseSent[t] = 1;
  return { t, coarse: coarsen(s.dims, fine, w, dz) };
}

/** Calcule le bloc 2×2 contenant la tuile t (mis en cache) ; envoie le grossier des voisines. */
function computeAround(s: LightService, t: number): void {
  const d = s.dims;
  const tx = t % d.tx;
  const tz = (t - tx) / d.tx;
  for (const r of s.computeRect(tx & ~1, tz & ~1, (tx & ~1) + 2, (tz & ~1) + 2)) {
    if (r.t === t || coarseSent[r.t]) continue;
    post({ type: 'coarse', items: [coarseItem(s, r.t, r.fine)] });
  }
}

function pump(): void {
  timer = 0;
  const s = svc;
  if (!s) return;
  if (role === 'demand') pumpDemand(s);
  else pumpBackground(s);
}

function pumpDemand(s: LightService): void {
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
        computeAround(s, t);
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
  // 2) préparation des fenêtres des QG de départ (mises en cache, prêtes au début de la partie)
  while (prefetch.length > 0 && s.has(prefetch[0])) prefetch.shift();
  const t = prefetch.shift();
  if (t !== undefined) {
    computeAround(s, t);
    schedule();
  }
}

function pumpBackground(s: LightService): void {
  // le bloc non calculé le plus proche des points d'intérêt (version grossière seulement)
  const d = s.dims;
  const bx = Math.ceil(d.tx / BLOCK);
  const blockM = BLOCK * LIGHT_TILE * 0.5; // m
  let best = -1;
  let bestD = Infinity;
  for (let b = 0; b < blocksDone.length; b++) {
    if (blocksDone[b]) continue;
    const i = b % bx;
    const k = (b - i) / bx;
    let dd = Infinity;
    for (const [fx, fz] of focus) dd = Math.min(dd, Math.hypot((i + 0.5) * blockM - fx, (k + 0.5) * blockM - fz));
    if (dd < bestD) {
      bestD = dd;
      best = b;
    }
  }
  if (best < 0) {
    if (!announced) {
      announced = true;
      post({ type: 'idle', ms: performance.now() - t0 });
    }
    return;
  }
  blocksDone[best] = 1;
  const i = best % bx;
  const k = (best - i) / bx;
  const items: { t: number; coarse: Uint8Array }[] = [];
  for (const r of s.computeRect(i * BLOCK, k * BLOCK, (i + 1) * BLOCK, (k + 1) * BLOCK, 'never')) if (!coarseSent[r.t]) items.push(coarseItem(s, r.t, r.fine));
  if (items.length > 0)
    post(
      { type: 'coarse', items },
      items.map((it) => it.coarse.buffer),
    );
  schedule();
}
