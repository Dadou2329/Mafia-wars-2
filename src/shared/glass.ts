// Verre destructible : vitrines, baies vitrées et vitres des pièces se brisent sous les balles et
// dans les explosions. Le serveur décide et mémorise le verre brisé de la partie (sans toucher au
// monde partagé entre les salons) ; chaque client retire les mêmes voxels de sa copie du monde et
// les remet en place à la revanche. Les vitres éclairées des étages décoratifs restent intactes
// (derrière, il n'y a rien à voir).

import { M, MAT_BLOCKS_BULLETS } from './materials';
import { GROUND_VY, INV_VOXEL, VOXEL, type VoxelWorld } from './voxel';

/** Matériaux de verre qui se brisent (1) ou non (0) : vitres, vitrines, baies vitrées. */
export const MAT_BREAKABLE = new Uint8Array(256);
for (const m of [M.GLASS, M.GLASS_SHOP, M.GLASS_CLEAR]) MAT_BREAKABLE[m] = 1;

/** Indice d'un voxel (clé des ensembles de verre brisé). */
export function voxelKey(world: VoxelWorld, x: number, y: number, z: number): number {
  return x + world.sx * (z + world.sz * y);
}

/** Parcourt les voxels de verre cassable dans une sphère (rayon r en mètres) autour d'un point du monde. */
export function glassInSphere(world: VoxelWorld, wx: number, wy: number, wz: number, r: number, fn: (x: number, y: number, z: number, m: number) => void): void {
  const cx = wx * INV_VOXEL;
  const cy = wy * INV_VOXEL + GROUND_VY;
  const cz = wz * INV_VOXEL;
  const rv = r * INV_VOXEL;
  const x0 = Math.max(0, Math.floor(cx - rv));
  const y0 = Math.max(0, Math.floor(cy - rv));
  const z0 = Math.max(0, Math.floor(cz - rv));
  const x1 = Math.min(world.sx - 1, Math.ceil(cx + rv));
  const y1 = Math.min(world.sy - 1, Math.ceil(cy + rv));
  const z1 = Math.min(world.sz - 1, Math.ceil(cz + rv));
  const r2 = rv * rv;
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const dz = z + 0.5 - cz;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        const m = world.get(x, y, z);
        if (MAT_BREAKABLE[m]) fn(x, y, z, m);
      }
}

/**
 * Premier voxel de verre cassable (et pas encore cassé) sur le trajet d'une balle, avant le premier
 * obstacle qui l'arrête. Renvoie le point d'impact (mètres) ou null.
 */
export function firstGlass(
  world: VoxelWorld,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  broken: (key: number) => boolean,
): { x: number; y: number; z: number } | null {
  const px = ox * INV_VOXEL;
  const py = oy * INV_VOXEL + GROUND_VY;
  const pz = oz * INV_VOXEL;
  let x = Math.floor(px);
  let y = Math.floor(py);
  let z = Math.floor(pz);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - px : px - x) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - py : py - y) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - pz : pz - z) * tDeltaZ : Infinity;
  const maxT = maxDist * INV_VOXEL;
  let t = 0;
  for (let i = 0; i < 4096; i++) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
    }
    if (t > maxT || y < 0 || x < 0 || z < 0 || x >= world.sx || z >= world.sz || y >= world.sy) return null;
    const m = world.get(x, y, z);
    if (m === 0) continue;
    if (MAT_BREAKABLE[m] && !broken(voxelKey(world, x, y, z))) {
      const d = (t + 0.5) * VOXEL;
      return { x: ox + dx * d, y: oy + dy * d, z: oz + dz * d };
    }
    if (MAT_BLOCKS_BULLETS[m]) return null;
  }
  return null;
}
