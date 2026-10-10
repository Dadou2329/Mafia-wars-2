// Volume d'éclairage précalculé (cellules de 0,5 m) : canal R = lumière du ciel,
// canal G = lampes (becs de gaz, lustres, cheminées…). Propagation par remplissage :
// la lumière contourne les obstacles mais ne traverse pas les murs.

import { MAT_BLOCKS_LIGHT } from '../../shared/materials';
import { CHUNK, type VoxelWorld } from '../../shared/voxel';
import type { LightSource } from '../../shared/city/gen/context';

export interface LightVolume {
  data: Uint8Array; // RG entrelacé
  nx: number;
  ny: number;
  nz: number;
  origin: [number, number, number]; // m
  cell: number; // m
}

const SKY_DECAY = 22;

export function computeLightVolume(world: VoxelWorld, lights: LightSource[], maxVY = 128): LightVolume {
  const nx = world.sx >> 1;
  const nz = world.sz >> 1;
  const ny = Math.min(world.sy, maxVY) >> 1;
  const N = nx * ny * nz;
  const at = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  // 1) opacité : nombre de voxels opaques par cellule 2×2×2
  const count = new Uint8Array(N);
  for (let cy = 0; cy < world.cy; cy++) {
    if (cy * CHUNK >= ny * 2) break;
    for (let cz = 0; cz < world.cz; cz++) {
      for (let cx = 0; cx < world.cx; cx++) {
        const ch = world.getChunk(cx, cy, cz);
        if (!ch) continue;
        for (let y = 0; y < CHUNK; y++) {
          const vy = cy * CHUNK + y;
          if (vy >= ny * 2) break;
          const j = vy >> 1;
          for (let z = 0; z < CHUNK; z++) {
            const k = (cz * CHUNK + z) >> 1;
            const row = (y << 10) | (z << 5);
            for (let x = 0; x < CHUNK; x++) {
              const m = ch[row | x];
              if (m !== 0 && MAT_BLOCKS_LIGHT[m] === 1) count[at((cx * CHUNK + x) >> 1, j, k)]++;
            }
          }
        }
      }
    }
  }
  const opaque = new Uint8Array(N);
  for (let n = 0; n < N; n++) opaque[n] = count[n] >= 5 ? 1 : 0;
  // 2) ciel : colonnes exposées
  const sky = new Uint8Array(N);
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      for (let j = ny - 1; j >= 0; j--) {
        const n = at(i, j, k);
        if (opaque[n]) break;
        sky[n] = 255;
      }
    }
  // 3) diffusion latérale/vers le bas de la lumière du ciel (BFS par niveaux)
  let frontier: number[] = [];
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const n = at(i, j, k);
        if (sky[n] !== 255) continue;
        const nb = [n + 1, n - 1, n + nx * ny, n - nx * ny, n - nx];
        for (const m of nb) {
          if (!opaque[m] && sky[m] < 255 - SKY_DECAY) {
            frontier.push(n);
            break;
          }
        }
      }
  let level = 255;
  while (frontier.length > 0 && level > SKY_DECAY) {
    level -= SKY_DECAY;
    const next: number[] = [];
    for (const n of frontier) {
      const i = n % nx;
      const jk = (n - i) / nx;
      const j = jk % ny;
      const k = (jk - j) / ny;
      if (i < 1 || i >= nx - 1 || j < 1 || j >= ny - 1 || k < 1 || k >= nz - 1) continue;
      const nb = [n + 1, n - 1, n + nx, n - nx, n + nx * ny, n - nx * ny];
      for (const m of nb) {
        if (opaque[m] || sky[m] >= level) continue;
        sky[m] = level;
        next.push(m);
      }
    }
    frontier = next;
  }
  // 4) lampes : remplissage borné, atténuation euclidienne
  const lamp = new Uint8Array(N);
  const cell = 0.5;
  for (const L of lights) {
    const R = L.radius / cell;
    const ci = Math.floor(L.x / cell);
    const cj = Math.floor((L.y + 2) / cell);
    const ck = Math.floor(L.z / cell);
    if (ci < 0 || cj < 0 || ck < 0 || ci >= nx || cj >= ny || ck >= nz) continue;
    const r = Math.ceil(R);
    const size = 2 * r + 1;
    const visited = new Uint8Array(size * size * size);
    const lx = (L.x / cell) - 0.5;
    const ly = ((L.y + 2) / cell) - 0.5;
    const lz = (L.z / cell) - 0.5;
    let cur: number[] = [ci, cj, ck];
    // si la source est dans une cellule opaque, on démarre quand même
    visited[(r * size + r) * size + r] = 1;
    const maxSteps = Math.ceil(R * 1.6);
    for (let step = 0; step <= maxSteps && cur.length > 0; step++) {
      const next: number[] = [];
      for (let q = 0; q < cur.length; q += 3) {
        const i = cur[q];
        const j = cur[q + 1];
        const k = cur[q + 2];
        const n = at(i, j, k);
        const d = Math.hypot(i - lx, j - ly, k - lz) / R;
        if (d < 1) {
          const t = 1 - d * d;
          const v = Math.min(255, Math.round(255 * L.intensity * t * (0.35 + 0.65 * t)));
          if (v > lamp[n]) lamp[n] = v;
        }
        if (step > 0 && opaque[n]) continue;
        for (let dir = 0; dir < 6; dir++) {
          const ni = i + (dir === 0 ? 1 : dir === 1 ? -1 : 0);
          const nj = j + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
          const nk = k + (dir === 4 ? 1 : dir === 5 ? -1 : 0);
          if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue;
          const li = ni - ci + r;
          const lj = nj - cj + r;
          const lk = nk - ck + r;
          if (li < 0 || lj < 0 || lk < 0 || li >= size || lj >= size || lk >= size) continue;
          const vi = (lk * size + lj) * size + li;
          if (visited[vi]) continue;
          visited[vi] = 1;
          if (opaque[at(ni, nj, nk)]) {
            // on éclaire la face du mur mais on ne traverse pas
            const dd = Math.hypot(ni - lx, nj - ly, nk - lz) / R;
            if (dd < 1) {
              const t = 1 - dd * dd;
              const v = Math.min(255, Math.round(255 * L.intensity * t * (0.35 + 0.65 * t)));
              const m = at(ni, nj, nk);
              if (v > lamp[m]) lamp[m] = v;
            }
            continue;
          }
          next.push(ni, nj, nk);
        }
      }
      cur = next;
    }
  }
  // 5) les cellules opaques prennent la valeur max de leurs voisines (évite le noir aux arêtes)
  const data = new Uint8Array(N * 2);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const n = at(i, j, k);
        let s = sky[n];
        let l = lamp[n];
        if (opaque[n]) {
          s = 0;
          if (i > 0) s = Math.max(s, sky[n - 1]);
          if (i < nx - 1) s = Math.max(s, sky[n + 1]);
          if (j < ny - 1) s = Math.max(s, sky[n + nx]);
          if (k > 0) s = Math.max(s, sky[n - nx * ny]);
          if (k < nz - 1) s = Math.max(s, sky[n + nx * ny]);
        }
        data[n * 2] = s;
        data[n * 2 + 1] = l;
      }
  return { data, nx, ny, nz, origin: [0, -2, 0], cell };
}

/** Échantillonnage CPU (plus proche voisin) pour les objets dynamiques. */
export function sampleLight(v: LightVolume, x: number, y: number, z: number): [number, number] {
  const i = Math.floor((x - v.origin[0]) / v.cell);
  const j = Math.floor((y - v.origin[1]) / v.cell);
  const k = Math.floor((z - v.origin[2]) / v.cell);
  if (i < 0 || k < 0 || i >= v.nx || k >= v.nz) return [1, 0];
  if (j >= v.ny) return [1, 0];
  if (j < 0) return [0, 0];
  const n = ((k * v.ny + j) * v.nx + i) * 2;
  return [v.data[n] / 255, v.data[n + 1] / 255];
}
