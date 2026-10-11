// Éclairage par tuiles : la ville est découpée en tuiles de 16 m (32 cellules de 0,5 m), calculées
// à la demande (fenêtre fine autour de la caméra) ou en tâche de fond, et gardées en cache
// compressées. Chaque tuile a aussi une version grossière (cellules de 1 m) qui sert au reste de la
// ville. Utilisable dans un worker (cas normal) ou sur le fil principal (repli).

import type { LightSource } from '../../shared/city/gen/context';
import type { VoxelWorld } from '../../shared/voxel';
import { computeLightBox, LIGHT_TOP_VY } from './lightVolume';

/** Côté d'une tuile, en cellules fines (16 m). */
export const LIGHT_TILE = 32;
/** Cellules fines par cellule grossière (1 m). */
export const COARSE_RATIO = 2;

export interface LightDims {
  /** Cellules fines du monde. */
  nx: number;
  ny: number;
  nz: number;
  /** Tuiles. */
  tx: number;
  tz: number;
  /** Cellules grossières du monde. */
  cnx: number;
  cny: number;
  cnz: number;
}

export function lightDims(world: VoxelWorld): LightDims {
  const nx = world.sx >> 1;
  const nz = world.sz >> 1;
  const ny = Math.min(world.sy, LIGHT_TOP_VY) >> 1;
  return {
    nx,
    ny,
    nz,
    tx: Math.ceil(nx / LIGHT_TILE),
    tz: Math.ceil(nz / LIGHT_TILE),
    cnx: Math.ceil(nx / COARSE_RATIO),
    cny: Math.ceil(ny / COARSE_RATIO),
    cnz: Math.ceil(nz / COARSE_RATIO),
  };
}

/** Largeur (x) et profondeur (z) en cellules fines de la tuile t (les dernières peuvent être plus petites). */
export function tileSize(d: LightDims, t: number): [number, number] {
  const tx = t % d.tx;
  const tz = (t - tx) / d.tx;
  return [Math.min(LIGHT_TILE, d.nx - tx * LIGHT_TILE), Math.min(LIGHT_TILE, d.nz - tz * LIGHT_TILE)];
}

/** Version grossière (maximum de chaque bloc 2×2×2) des données fines d'une tuile. */
export function coarsen(d: LightDims, fine: Uint8Array, w: number, dz: number): Uint8Array {
  const R = COARSE_RATIO;
  const cw = Math.ceil(w / R);
  const cd = Math.ceil(dz / R);
  const ch = d.cny;
  const out = new Uint8Array(cw * ch * cd * 2);
  for (let k = 0; k < dz; k++) {
    const ck = (k / R) | 0;
    for (let j = 0; j < d.ny; j++) {
      const cj = (j / R) | 0;
      const src = (k * d.ny + j) * w * 2;
      const dst = (ck * ch + cj) * cw * 2;
      for (let i = 0; i < w; i++) {
        const o = dst + ((i / R) | 0) * 2;
        const r = fine[src + i * 2];
        const g = fine[src + i * 2 + 1];
        if (r > out[o]) out[o] = r;
        if (g > out[o + 1]) out[o + 1] = g;
      }
    }
  }
  return out;
}

// Cache : chaque canal (ciel, lampes) codé en plages (longueur, valeur), le ciel d'abord ; un
// en-tête de 4 octets donne la taille de la partie « ciel ».
function rleChannel(d: Uint8Array, c: number, out: Uint8Array, o: number): number {
  for (let i = c; i < d.length; ) {
    const v = d[i];
    let n = 1;
    while (n < 255 && i + n * 2 < d.length && d[i + n * 2] === v) n++;
    out[o++] = n;
    out[o++] = v;
    i += n * 2;
  }
  return o;
}

function rleEncode(d: Uint8Array): Uint8Array {
  const out = new Uint8Array(d.length * 2 + 4);
  const o = rleChannel(d, 0, out, 4);
  out[0] = o & 255;
  out[1] = (o >> 8) & 255;
  out[2] = (o >> 16) & 255;
  out[3] = o >>> 24;
  return out.slice(0, rleChannel(d, 1, out, o));
}

function rleDecode(src: Uint8Array, out: Uint8Array): void {
  const split = src[0] | (src[1] << 8) | (src[2] << 16) | (src[3] << 24);
  for (const [c, a, b] of [
    [0, 4, split],
    [1, split, src.length],
  ]) {
    let o = c;
    for (let i = a; i < b; i += 2) {
      const n = src[i];
      const v = src[i + 1];
      for (let k = 0; k < n; k++) {
        out[o] = v;
        o += 2;
      }
    }
  }
}

/** Budget du cache de tuiles (octets compressés) ; au-delà, les moins récentes sont oubliées. */
const CACHE_BUDGET = 48 * 1024 * 1024;

export class LightService {
  readonly dims: LightDims;
  private cache = new Map<number, Uint8Array>();
  private cachedBytes = 0;

  constructor(
    private world: VoxelWorld,
    private lights: LightSource[],
  ) {
    this.dims = lightDims(world);
  }

  get tileCount(): number {
    return this.dims.tx * this.dims.tz;
  }

  has(t: number): boolean {
    return this.cache.has(t);
  }

  /** Mémoire du cache (octets compressés). */
  get bytes(): number {
    return this.cachedBytes;
  }

  /**
   * Calcule d'un coup les tuiles du rectangle [tx0, tx1) × [tz0, tz1) (marge partagée) et les met
   * en cache (« if-room » : seulement s'il reste de la place, sans rien oublier pour elles).
   * Renvoie les tuiles calculées avec leurs données fines.
   */
  computeRect(tx0: number, tz0: number, tx1: number, tz1: number, keep: 'always' | 'if-room' = 'always'): { t: number; fine: Uint8Array }[] {
    const d = this.dims;
    const T = LIGHT_TILE;
    tx0 = Math.max(0, tx0);
    tz0 = Math.max(0, tz0);
    tx1 = Math.min(d.tx, tx1);
    tz1 = Math.min(d.tz, tz1);
    const i0 = tx0 * T;
    const k0 = tz0 * T;
    const ni = Math.min(d.nx, tx1 * T) - i0;
    const nk = Math.min(d.nz, tz1 * T) - k0;
    if (ni <= 0 || nk <= 0) return [];
    const box = computeLightBox(this.world, this.lights, i0, k0, ni, nk);
    const out: { t: number; fine: Uint8Array }[] = [];
    for (let tz = tz0; tz < tz1; tz++)
      for (let tx = tx0; tx < tx1; tx++) {
        const t = tz * d.tx + tx;
        const [w, dz] = tileSize(d, t);
        const fine = new Uint8Array(w * d.ny * dz * 2);
        const bi = tx * T - i0;
        const bk = tz * T - k0;
        for (let k = 0; k < dz; k++)
          for (let j = 0; j < d.ny; j++) {
            const src = ((bk + k) * d.ny + j) * ni + bi;
            fine.set(box.subarray(src * 2, (src + w) * 2), (k * d.ny + j) * w * 2);
          }
        if (keep === 'always' || this.cachedBytes < CACHE_BUDGET) this.store(t, fine);
        out.push({ t, fine });
      }
    return out;
  }

  private store(t: number, fine: Uint8Array): void {
    const old = this.cache.get(t);
    if (old) {
      this.cache.delete(t);
      this.cachedBytes -= old.byteLength;
    }
    const enc = rleEncode(fine);
    this.cache.set(t, enc);
    this.cachedBytes += enc.byteLength;
    // les tuiles les moins récemment utilisées partent les premières
    for (const [k, v] of this.cache) {
      if (this.cachedBytes <= CACHE_BUDGET) break;
      this.cache.delete(k);
      this.cachedBytes -= v.byteLength;
    }
  }

  /** Données fines d'une tuile en cache (voir has()). */
  tile(t: number): Uint8Array {
    const enc = this.cache.get(t);
    if (!enc) throw new Error(`tuile ${t} absente`);
    // utilisée : elle passe en fin de file
    this.cache.delete(t);
    this.cache.set(t, enc);
    const [w, dz] = tileSize(this.dims, t);
    const fine = new Uint8Array(w * this.dims.ny * dz * 2);
    rleDecode(enc, fine);
    return fine;
  }
}
