// Grenades : trajectoire balistique partagée par le serveur (qui décide de l'explosion) et le
// client (qui affiche la grenade en vol) ; rebonds amortis sur les murs, le sol et les toits.

import { GROUND_VY, INV_VOXEL, type VoxelWorld } from './voxel';
import { MAT_SOLID } from './materials';

export const GRENADE_FUSE = 1.7; // s
export const GRENADE_SPEED = 15; // m/s au lancer
export const GRENADE_RADIUS = 5.5; // m
export const GRENADE_DAMAGE = 130;
export const GRENADE_PRICE = 90;
export const GRENADE_MAX = 4;
export const GRENADE_START = 2;
const GRAVITY = 18;
const R = 0.08; // rayon de la grenade (m)

export interface GrenadeBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

function solid(world: VoxelWorld, x: number, y: number, z: number): boolean {
  const vy = Math.floor(y * INV_VOXEL) + GROUND_VY;
  if (vy < 0) return true;
  const vx = Math.floor(x * INV_VOXEL);
  const vz = Math.floor(z * INV_VOXEL);
  if (vx < 0 || vz < 0 || vx >= world.sx || vz >= world.sz || vy >= world.sy) return false;
  return MAT_SOLID[world.get(vx, vy, vz)] === 1;
}

/** Vitesse initiale d'une grenade lancée dans la direction (dx, dy, dz) (normalisée ici). */
export function throwVelocity(dx: number, dy: number, dz: number): { vx: number; vy: number; vz: number } {
  const l = Math.hypot(dx, dy, dz) || 1;
  return { vx: (dx / l) * GRENADE_SPEED, vy: (dy / l) * GRENADE_SPEED + 3.2, vz: (dz / l) * GRENADE_SPEED };
}

/** Avance la grenade de dt secondes (sous-pas de 1/60 s), avec rebonds amortis. */
export function stepGrenade(world: VoxelWorld, g: GrenadeBody, dt: number): void {
  const n = Math.max(1, Math.ceil(dt * 60));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    g.vy -= GRAVITY * h;
    // axe par axe : un choc inverse et amortit la composante concernée
    const nx = g.x + g.vx * h;
    if (solid(world, nx + Math.sign(g.vx) * R, g.y, g.z)) {
      g.vx *= -0.4;
      g.vz *= 0.8;
    } else g.x = nx;
    const nz = g.z + g.vz * h;
    if (solid(world, g.x, g.y, nz + Math.sign(g.vz) * R)) {
      g.vz *= -0.4;
      g.vx *= 0.8;
    } else g.z = nz;
    const ny = g.y + g.vy * h;
    if (solid(world, g.x, ny - (g.vy < 0 ? R : -R), g.z)) {
      if (g.vy < 0) {
        // au sol : rebond et frottement
        g.vy = Math.abs(g.vy) < 2 ? 0 : -g.vy * 0.35;
        g.vx *= 0.7;
        g.vz *= 0.7;
      } else g.vy *= -0.3;
    } else g.y = ny;
  }
}
