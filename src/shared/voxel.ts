// Monde voxel creux découpé en tronçons (chunks) de 32³.
// Taille d'un voxel : 0,25 m. Le niveau de la chaussée est à y = 0 m, ce qui correspond
// à la couche de voxels GROUND_VY (première couche d'air au-dessus des pavés).

import { MAT_BLOCKS_BULLETS, MAT_SOLID } from './materials';

export const VOXEL = 0.25;
export const INV_VOXEL = 4;
export const GROUND_VY = 8;
export const CHUNK_BITS = 5;
export const CHUNK = 1 << CHUNK_BITS; // 32
export const CHUNK_MASK = CHUNK - 1;
export const CHUNK_VOL = CHUNK * CHUNK * CHUNK;

/** Conversion monde (m) → indice voxel. */
export const toVX = (x: number): number => Math.floor(x * INV_VOXEL);
export const toVY = (y: number): number => Math.floor(y * INV_VOXEL) + GROUND_VY;
export const toVZ = toVX;
/** Conversion indice voxel → coordonnée monde du coin inférieur. */
export const fromVX = (vx: number): number => vx * VOXEL;
export const fromVY = (vy: number): number => (vy - GROUND_VY) * VOXEL;

export class VoxelWorld {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly chunks: (Uint8Array | null)[];

  constructor(sx: number, sy: number, sz: number) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.cx = Math.ceil(sx / CHUNK);
    this.cy = Math.ceil(sy / CHUNK);
    this.cz = Math.ceil(sz / CHUNK);
    this.chunks = new Array(this.cx * this.cy * this.cz).fill(null);
  }

  chunkIndex(cx: number, cy: number, cz: number): number {
    return (cy * this.cz + cz) * this.cx + cx;
  }

  getChunk(cx: number, cy: number, cz: number): Uint8Array | null {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= this.cx || cy >= this.cy || cz >= this.cz) return null;
    return this.chunks[this.chunkIndex(cx, cy, cz)];
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return 0;
    const c = this.chunks[((y >> CHUNK_BITS) * this.cz + (z >> CHUNK_BITS)) * this.cx + (x >> CHUNK_BITS)];
    if (c === null) return 0;
    return c[((y & CHUNK_MASK) << (CHUNK_BITS * 2)) | ((z & CHUNK_MASK) << CHUNK_BITS) | (x & CHUNK_MASK)];
  }

  set(x: number, y: number, z: number, m: number): void {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return;
    const ci = ((y >> CHUNK_BITS) * this.cz + (z >> CHUNK_BITS)) * this.cx + (x >> CHUNK_BITS);
    let c = this.chunks[ci];
    if (c === null) {
      if (m === 0) return;
      c = this.chunks[ci] = new Uint8Array(CHUNK_VOL);
    }
    c[((y & CHUNK_MASK) << (CHUNK_BITS * 2)) | ((z & CHUNK_MASK) << CHUNK_BITS) | (x & CHUNK_MASK)] = m;
  }

  /** Remplit la boîte [x0,x1)×[y0,y1)×[z0,z1) (bornes ordonnées automatiquement). */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number): void {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    z0 = Math.max(0, z0);
    x1 = Math.min(this.sx, x1);
    y1 = Math.min(this.sy, y1);
    z1 = Math.min(this.sz, z1);
    for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) this.set(x, y, z, m);
  }

  /** Remplit uniquement les cellules vides. */
  fillEmpty(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number): void {
    for (let y = y0; y < y1; y++)
      for (let z = z0; z < z1; z++)
        for (let x = x0; x < x1; x++) if (this.get(x, y, z) === 0) this.set(x, y, z, m);
  }

  /** Remplace un matériau par un autre dans une boîte. */
  replace(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, from: number, to: number): void {
    for (let y = y0; y < y1; y++)
      for (let z = z0; z < z1; z++)
        for (let x = x0; x < x1; x++) if (this.get(x, y, z) === from) this.set(x, y, z, to);
  }

  isSolid(x: number, y: number, z: number): boolean {
    if (y < 0) return true;
    if (x < 0 || z < 0 || x >= this.sx || z >= this.sz) return true; // bords du monde : mur invisible
    return MAT_SOLID[this.get(x, y, z)] === 1;
  }

  /** Solidité à une position monde (m). */
  solidAt(wx: number, wy: number, wz: number): boolean {
    return this.isSolid(Math.floor(wx * INV_VOXEL), Math.floor(wy * INV_VOXEL) + GROUND_VY, Math.floor(wz * INV_VOXEL));
  }

  /**
   * Lancer de rayon voxel (DDA) en coordonnées monde. Renvoie la distance du premier
   * voxel bloquant les balles, ou -1 si rien jusqu'à maxDist. Remplit `out` (point, normale).
   */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    out?: RayHit,
    mode: 'bullet' | 'solid' = 'bullet',
  ): number {
    const table = mode === 'bullet' ? MAT_BLOCKS_BULLETS : MAT_SOLID;
    // en unités voxel
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
    let face = -1;
    // le voxel de départ est ignoré s'il est solide (on part de l'intérieur d'un mur)
    for (let i = 0; i < 4096; i++) {
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          x += stepX;
          t = tMaxX;
          tMaxX += tDeltaX;
          face = 0;
        } else {
          z += stepZ;
          t = tMaxZ;
          tMaxZ += tDeltaZ;
          face = 2;
        }
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        face = 1;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        face = 2;
      }
      if (t > maxT) return -1;
      if (y < 0) {
        if (out) fillHit(out, t, ox, oy, oz, dx, dy, dz, face, stepX, stepY, stepZ, x, y, z, 0);
        return t * VOXEL;
      }
      if (x < 0 || z < 0 || x >= this.sx || z >= this.sz || y >= this.sy) return -1;
      const m = this.get(x, y, z);
      if (m !== 0 && table[m] === 1) {
        if (out) fillHit(out, t, ox, oy, oz, dx, dy, dz, face, stepX, stepY, stepZ, x, y, z, m);
        return t * VOXEL;
      }
    }
    return -1;
  }

  /** Ligne de vue entre deux points (balles). */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-4) return true;
    return this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05) < 0;
  }
}

export interface RayHit {
  dist: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  vx: number;
  vy: number;
  vz: number;
  mat: number;
}

export function makeRayHit(): RayHit {
  return { dist: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, vx: 0, vy: 0, vz: 0, mat: 0 };
}

function fillHit(
  out: RayHit,
  t: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  face: number,
  sx: number,
  sy: number,
  sz: number,
  vx: number,
  vy: number,
  vz: number,
  m: number,
): void {
  const d = t * VOXEL;
  out.dist = d;
  out.x = ox + dx * d;
  out.y = oy + dy * d;
  out.z = oz + dz * d;
  out.nx = face === 0 ? -sx : 0;
  out.ny = face === 1 ? -sy : 0;
  out.nz = face === 2 ? -sz : 0;
  out.vx = vx;
  out.vy = vy;
  out.vz = vz;
  out.mat = m;
}
