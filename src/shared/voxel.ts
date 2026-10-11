// Monde voxel découpé en tronçons (chunks) de 32³.
// Taille d'un voxel : 0,25 m. Le niveau de la chaussée est à y = 0 m, ce qui correspond
// à la couche de voxels GROUND_VY (première couche d'air au-dessus de la chaussée).
// Sous la rue : 8,5 m de sous-sol (métro, tunnels, lit de la rivière).
//
// Un tronçon non alloué est « uniforme » : tous ses voxels valent fillMat[ci] (0 = air).
// Le sous-sol plein et les grands volumes vides ne coûtent donc rien en mémoire.
// Les autres tronçons sont soit « bruts » (32 Ko, un octet par voxel), soit « compressés »
// (tranches uniformes, rangées en plages, rangées et tranches identiques partagées) : la ville
// entière tient ainsi en quelques dizaines de Mo. Un tronçon compressé se lit directement ; on
// le décompresse seulement quand on y écrit. Pendant la génération, les tronçons bruts sont
// compressés automatiquement au-delà d'un certain nombre (mémoire bornée).

import { MAT_BLOCKS_BULLETS, MAT_SOLID } from './materials';

export const VOXEL = 0.25;
export const INV_VOXEL = 4;
export const GROUND_VY = 34;
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

/** Contenu d'un monde à transférer entre threads (voir VoxelWorld.exportChunks). */
export interface ChunkExport {
  raw: (Uint8Array | null)[];
  packedData: Uint8Array;
  packedIndex: Int32Array;
  fillMat: Uint8Array;
}

/** Tampons d'un export (pour un transfert sans copie). */
export function chunkTransferables(d: ChunkExport): ArrayBuffer[] {
  const out: ArrayBuffer[] = [d.packedData.buffer as ArrayBuffer, d.packedIndex.buffer as ArrayBuffer, d.fillMat.buffer as ArrayBuffer];
  for (const c of d.raw) if (c) out.push(c.buffer as ArrayBuffer);
  return out;
}

export class VoxelWorld {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  /** Tronçons bruts (un octet par voxel). */
  readonly chunks: (Uint8Array | null)[];
  /** Tronçons compressés (voir packChunk). */
  readonly packed: (Uint8Array | null)[];
  /** Matériau des tronçons non alloués (uniformes). */
  readonly fillMat: Uint8Array;
  /** Au-delà de ce nombre de tronçons bruts, les autres sont compressés (génération). */
  autoPack = 1536;
  private rawCount = 0;
  private scratch = new Uint8Array(CHUNK_VOL);

  constructor(sx: number, sy: number, sz: number) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.cx = Math.ceil(sx / CHUNK);
    this.cy = Math.ceil(sy / CHUNK);
    this.cz = Math.ceil(sz / CHUNK);
    this.chunks = new Array(this.cx * this.cy * this.cz).fill(null);
    this.packed = new Array(this.cx * this.cy * this.cz).fill(null);
    this.fillMat = new Uint8Array(this.cx * this.cy * this.cz);
  }

  chunkIndex(cx: number, cy: number, cz: number): number {
    return (cy * this.cz + cz) * this.cx + cx;
  }

  /**
   * Voxels d'un tronçon (32 Ko, x puis z puis y), ou null s'il est uniforme. Un tronçon compressé
   * est décompressé dans un tampon interne : le résultat n'est valable que jusqu'au prochain appel.
   */
  getChunk(cx: number, cy: number, cz: number): Uint8Array | null {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= this.cx || cy >= this.cy || cz >= this.cz) return null;
    return this.chunkRaw(this.chunkIndex(cx, cy, cz), this.scratch);
  }

  /** Voxels du tronçon ci : le tronçon brut, ou sa version décompressée dans `out`, ou null (uniforme). */
  chunkRaw(ci: number, out: Uint8Array): Uint8Array | null {
    const c = this.chunks[ci];
    if (c !== null) return c;
    const p = this.packed[ci];
    if (p === null) return null;
    unpackChunk(p, out);
    return out;
  }

  /** Le tronçon ci est-il uniforme (non alloué) ? */
  isUniformChunk(ci: number): boolean {
    return this.chunks[ci] === null && this.packed[ci] === null;
  }

  /** Matériau d'un tronçon uniforme (−1 si le tronçon est alloué ou hors du monde). */
  uniformOf(cx: number, cy: number, cz: number): number {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= this.cx || cy >= this.cy || cz >= this.cz) return -1;
    const ci = this.chunkIndex(cx, cy, cz);
    return this.isUniformChunk(ci) ? this.fillMat[ci] : -1;
  }

  /** Nombre de tronçons alloués, bruts ou compressés (statistiques). */
  allocatedChunks(): number {
    let n = 0;
    for (let i = 0; i < this.chunks.length; i++) if (this.chunks[i] || this.packed[i]) n++;
    return n;
  }

  /** Mémoire occupée par les voxels (octets). */
  memoryBytes(): number {
    let b = this.fillMat.byteLength;
    for (let i = 0; i < this.chunks.length; i++) {
      if (this.chunks[i]) b += CHUNK_VOL;
      const p = this.packed[i];
      if (p) b += p.byteLength;
    }
    return b;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return 0;
    const ci = ((y >> CHUNK_BITS) * this.cz + (z >> CHUNK_BITS)) * this.cx + (x >> CHUNK_BITS);
    const c = this.chunks[ci];
    if (c !== null) return c[((y & CHUNK_MASK) << (CHUNK_BITS * 2)) | ((z & CHUNK_MASK) << CHUNK_BITS) | (x & CHUNK_MASK)];
    const p = this.packed[ci];
    if (p === null) return this.fillMat[ci];
    return packedGet(p, x & CHUNK_MASK, y & CHUNK_MASK, z & CHUNK_MASK);
  }

  set(x: number, y: number, z: number, m: number): void {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return;
    const ci = ((y >> CHUNK_BITS) * this.cz + (z >> CHUNK_BITS)) * this.cx + (x >> CHUNK_BITS);
    let c = this.chunks[ci];
    if (c === null) {
      const p = this.packed[ci];
      if (p !== null) {
        if (packedGet(p, x & CHUNK_MASK, y & CHUNK_MASK, z & CHUNK_MASK) === m) return;
        // on écrit dans un tronçon compressé : il redevient brut
        c = new Uint8Array(CHUNK_VOL);
        unpackChunk(p, c);
        this.packed[ci] = null;
      } else {
        const u = this.fillMat[ci];
        if (m === u) return;
        c = new Uint8Array(CHUNK_VOL);
        if (u !== 0) c.fill(u);
      }
      this.chunks[ci] = c;
      if (++this.rawCount > this.autoPack) this.compact(ci);
    }
    c[((y & CHUNK_MASK) << (CHUNK_BITS * 2)) | ((z & CHUNK_MASK) << CHUNK_BITS) | (x & CHUNK_MASK)] = m;
  }

  /**
   * Copie la boîte [x0, x0+nx) × [y0, y0+ny) × [z0, z0+nz) dans `out` : le voxel (x, y, z) va à
   * l'indice off + (y−y0)·strideY + (z−z0)·strideZ + (x−x0). Hors du monde : 0. Bien plus rapide
   * que get() voxel par voxel (lecture directe des tronçons, plages des tronçons compressés).
   */
  copyBox(x0: number, y0: number, z0: number, nx: number, ny: number, nz: number, out: Uint8Array, off: number, strideY: number, strideZ: number): void {
    for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) out.fill(0, off + y * strideY + z * strideZ, off + y * strideY + z * strideZ + nx);
    const bx0 = Math.max(0, x0);
    const by0 = Math.max(0, y0);
    const bz0 = Math.max(0, z0);
    const bx1 = Math.min(this.sx, x0 + nx);
    const by1 = Math.min(this.sy, y0 + ny);
    const bz1 = Math.min(this.sz, z0 + nz);
    if (bx1 <= bx0 || by1 <= by0 || bz1 <= bz0) return;
    for (let ccy = by0 >> CHUNK_BITS; ccy <= (by1 - 1) >> CHUNK_BITS; ccy++) {
      const ly0 = Math.max(by0, ccy << CHUNK_BITS) - (ccy << CHUNK_BITS);
      const ly1 = Math.min(by1, (ccy + 1) << CHUNK_BITS) - (ccy << CHUNK_BITS);
      for (let ccz = bz0 >> CHUNK_BITS; ccz <= (bz1 - 1) >> CHUNK_BITS; ccz++) {
        const lz0 = Math.max(bz0, ccz << CHUNK_BITS) - (ccz << CHUNK_BITS);
        const lz1 = Math.min(bz1, (ccz + 1) << CHUNK_BITS) - (ccz << CHUNK_BITS);
        for (let ccx = bx0 >> CHUNK_BITS; ccx <= (bx1 - 1) >> CHUNK_BITS; ccx++) {
          const lx0 = Math.max(bx0, ccx << CHUNK_BITS) - (ccx << CHUNK_BITS);
          const lx1 = Math.min(bx1, (ccx + 1) << CHUNK_BITS) - (ccx << CHUNK_BITS);
          const ci = (ccy * this.cz + ccz) * this.cx + ccx;
          // position dans `out` du voxel local (lx0, ly, lz)
          const dx = off + (ccx << CHUNK_BITS) + lx0 - x0;
          const dyz = (ly: number, lz: number) => ((ccy << CHUNK_BITS) + ly - y0) * strideY + ((ccz << CHUNK_BITS) + lz - z0) * strideZ;
          const c = this.chunks[ci];
          if (c !== null) {
            for (let ly = ly0; ly < ly1; ly++)
              for (let lz = lz0; lz < lz1; lz++) {
                const src = (ly << 10) | (lz << 5);
                let d = dx + dyz(ly, lz);
                for (let lx = lx0; lx < lx1; lx++) out[d++] = c[src | lx];
              }
            continue;
          }
          const p = this.packed[ci];
          if (p === null) {
            const u = this.fillMat[ci];
            if (u === 0) continue;
            for (let ly = ly0; ly < ly1; ly++)
              for (let lz = lz0; lz < lz1; lz++) {
                const d = dx + dyz(ly, lz);
                out.fill(u, d, d + lx1 - lx0);
              }
            continue;
          }
          for (let ly = ly0; ly < ly1; ly++) {
            const pm = p[ly];
            if (pm !== 255) {
              if (pm === 0) continue;
              for (let lz = lz0; lz < lz1; lz++) {
                const d = dx + dyz(ly, lz);
                out.fill(pm, d, d + lx1 - lx0);
              }
              continue;
            }
            const po = p[32 + 2 * ly] | (p[33 + 2 * ly] << 8);
            for (let lz = lz0; lz < lz1; lz++) {
              let i = p[po + 2 * lz] | (p[po + 2 * lz + 1] << 8);
              let d = dx + dyz(ly, lz);
              // plages : [x, x + len) → matériau
              let x = 0;
              while (x < lx1) {
                const len = p[i];
                const m = p[i + 1];
                i += 2;
                const a = x > lx0 ? x : lx0;
                const b = x + len < lx1 ? x + len : lx1;
                if (b > a) {
                  if (m !== 0) out.fill(m, d, d + b - a);
                  d += b - a;
                }
                x += len;
              }
            }
          }
        }
      }
    }
  }

  /** Rend un tronçon entièrement uniforme (libère sa mémoire). */
  setUniform(cx: number, cy: number, cz: number, m: number): void {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= this.cx || cy >= this.cy || cz >= this.cz) return;
    const ci = this.chunkIndex(cx, cy, cz);
    if (this.chunks[ci] !== null) this.rawCount--;
    this.chunks[ci] = null;
    this.packed[ci] = null;
    this.fillMat[ci] = m;
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
    if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
    // tronçons entièrement couverts : on les rend uniformes d'un coup
    const big = (x1 - x0) >= CHUNK && (y1 - y0) >= CHUNK && (z1 - z0) >= CHUNK;
    if (big) {
      const ccx0 = Math.ceil(x0 / CHUNK);
      const ccy0 = Math.ceil(y0 / CHUNK);
      const ccz0 = Math.ceil(z0 / CHUNK);
      const ccx1 = Math.floor(x1 / CHUNK);
      const ccy1 = Math.floor(y1 / CHUNK);
      const ccz1 = Math.floor(z1 / CHUNK);
      for (let cy = ccy0; cy < ccy1; cy++)
        for (let cz = ccz0; cz < ccz1; cz++) for (let cx = ccx0; cx < ccx1; cx++) this.setUniform(cx, cy, cz, m);
      for (let y = y0; y < y1; y++) {
        const fullY = y >= ccy0 * CHUNK && y < ccy1 * CHUNK;
        for (let z = z0; z < z1; z++) {
          const fullZ = fullY && z >= ccz0 * CHUNK && z < ccz1 * CHUNK;
          for (let x = x0; x < x1; x++) {
            if (fullZ && x >= ccx0 * CHUNK && x < ccx1 * CHUNK) {
              x = ccx1 * CHUNK - 1;
              continue;
            }
            this.set(x, y, z, m);
          }
        }
      }
      return;
    }
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

  /**
   * Repasse en uniforme les tronçons bruts qui ne contiennent qu'un seul matériau et compresse
   * les autres (sauf `keep`, en cours d'écriture). Renvoie le nombre de tronçons traités.
   */
  compact(keep = -1): number {
    let done = 0;
    for (let ci = 0; ci < this.chunks.length; ci++) {
      const c = this.chunks[ci];
      if (!c || ci === keep) continue;
      const m = c[0];
      let same = true;
      for (let i = 1; i < CHUNK_VOL; i++)
        if (c[i] !== m) {
          same = false;
          break;
        }
      if (same) {
        this.chunks[ci] = null;
        this.fillMat[ci] = m;
        this.rawCount--;
        done++;
        continue;
      }
      const p = packChunk(c);
      if (p) {
        this.packed[ci] = p;
        this.chunks[ci] = null;
        this.rawCount--;
        done++;
      }
    }
    return done;
  }

  /** Copie des tronçons (bruts, compressés concaténés, uniformes), transférable entre threads. */
  exportChunks(): ChunkExport {
    let total = 0;
    for (const p of this.packed) if (p) total += p.byteLength;
    const packedData = new Uint8Array(total);
    const packedIndex = new Int32Array(this.packed.length * 2).fill(-1);
    let o = 0;
    this.packed.forEach((p, i) => {
      if (!p) return;
      packedData.set(p, o);
      packedIndex[i * 2] = o;
      packedIndex[i * 2 + 1] = p.byteLength;
      o += p.byteLength;
    });
    return { raw: this.chunks.map((c) => (c ? c.slice() : null)), packedData, packedIndex, fillMat: this.fillMat.slice() };
  }

  /** Reprend des tronçons exportés par exportChunks (les tableaux compressés restent des vues). */
  importChunks(d: ChunkExport): void {
    this.rawCount = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      this.chunks[i] = d.raw[i] ?? null;
      if (this.chunks[i]) this.rawCount++;
      const o = d.packedIndex[i * 2];
      this.packed[i] = o >= 0 ? d.packedData.subarray(o, o + d.packedIndex[i * 2 + 1]) : null;
    }
    this.fillMat.set(d.fillMat);
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
    for (let i = 0; i < 8192; i++) {
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

// ============================================================================ compression
// Format d'un tronçon compressé (octets) :
//   [0..31]    matériau de chaque tranche y (255 : tranche non uniforme) ;
//   [32..95]   pour chaque tranche non uniforme, position (u16) de sa table de rangées ;
//   table      32 positions (u16) des rangées z de la tranche ;
//   rangée     plages (longueur, matériau) dont les longueurs totalisent 32.
// Une tranche identique à la précédente réutilise sa table ; une rangée identique à la
// précédente réutilise ses plages. Au-delà de PACK_MAX octets, le tronçon reste brut.

const PACK_MAX = 24576;
const packTmp = new Uint8Array(PACK_MAX);

function packedGet(p: Uint8Array, x: number, y: number, z: number): number {
  const pm = p[y];
  if (pm !== 255) return pm;
  const po = p[32 + 2 * y] | (p[33 + 2 * y] << 8);
  let i = p[po + 2 * z] | (p[po + 2 * z + 1] << 8);
  let acc = p[i];
  while (x >= acc) {
    i += 2;
    acc += p[i];
  }
  return p[i + 1];
}

function sameSpan(c: Uint8Array, a: number, b: number, n: number): boolean {
  for (let i = 0; i < n; i++) if (c[a + i] !== c[b + i]) return false;
  return true;
}

/** Compresse un tronçon brut, ou renvoie null si le gain est insuffisant. */
export function packChunk(c: Uint8Array): Uint8Array | null {
  const out = packTmp;
  let n = 96;
  for (let y = 0; y < CHUNK; y++) {
    const base = y << 10;
    const v = c[base];
    let uni = true;
    for (let i = 1; i < 1024; i++)
      if (c[base + i] !== v) {
        uni = false;
        break;
      }
    if (uni) {
      out[y] = v;
      out[32 + 2 * y] = 0;
      out[33 + 2 * y] = 0;
      continue;
    }
    out[y] = 255;
    if (y > 0 && out[y - 1] === 255 && sameSpan(c, base - 1024, base, 1024)) {
      out[32 + 2 * y] = out[30 + 2 * y];
      out[33 + 2 * y] = out[31 + 2 * y];
      continue;
    }
    const table = n;
    n += 64;
    if (n > PACK_MAX) return null;
    out[32 + 2 * y] = table & 255;
    out[33 + 2 * y] = table >> 8;
    let prev = -1;
    for (let z = 0; z < CHUNK; z++) {
      const r = base + (z << 5);
      let off: number;
      if (z > 0 && sameSpan(c, r - 32, r, 32)) off = prev;
      else {
        off = n;
        let x = 0;
        while (x < CHUNK) {
          const m = c[r + x];
          let len = 1;
          while (x + len < CHUNK && c[r + x + len] === m) len++;
          if (n + 2 > PACK_MAX) return null;
          out[n++] = len;
          out[n++] = m;
          x += len;
        }
      }
      out[table + 2 * z] = off & 255;
      out[table + 2 * z + 1] = off >> 8;
      prev = off;
    }
  }
  return out.slice(0, n);
}

/** Décompresse un tronçon dans `out` (32 Ko). */
export function unpackChunk(p: Uint8Array, out: Uint8Array): void {
  for (let y = 0; y < CHUNK; y++) {
    const base = y << 10;
    const pm = p[y];
    if (pm !== 255) {
      out.fill(pm, base, base + 1024);
      continue;
    }
    const po = p[32 + 2 * y] | (p[33 + 2 * y] << 8);
    for (let z = 0; z < CHUNK; z++) {
      let i = p[po + 2 * z] | (p[po + 2 * z + 1] << 8);
      const r = base + (z << 5);
      let x = 0;
      while (x < CHUNK) {
        const len = p[i];
        out.fill(p[i + 1], r + x, r + x + len);
        x += len;
        i += 2;
      }
    }
  }
}
