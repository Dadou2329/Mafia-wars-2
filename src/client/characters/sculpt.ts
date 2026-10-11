// Outils de sculpture des personnages : grille voxel adressée en coordonnées continues
// (unité = 1 voxel = 1/64 m) relatives à l'origine du membre (son articulation), formes
// analytiques (superellipses, ellipsoïdes, capsules) et profils interpolés.

import { VoxelModel } from '../models/voxelModel';
import { RES } from './rig';

/** Couleur ou emplacement de palette ; −1 = vide. */
export type Col = number;

export class Sculpt {
  readonly m: VoxelModel;
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;

  /** Bornes continues (en voxels) ; chaque case de la grille couvre [i, i+1). */
  constructor(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
    this.x0 = x0;
    this.y0 = y0;
    this.z0 = z0;
    this.m = new VoxelModel(Math.max(1, Math.round(x1 - x0)), Math.max(1, Math.round(y1 - y0)), Math.max(1, Math.round(z1 - z0)), RES);
    this.m.setOrigin(-x0, -y0, -z0);
  }

  /** Indices de grille de la case contenant le point continu. */
  private ix(x: number): number {
    return Math.floor(x - this.x0);
  }
  private iy(y: number): number {
    return Math.floor(y - this.y0);
  }
  private iz(z: number): number {
    return Math.floor(z - this.z0);
  }

  get(x: number, y: number, z: number): Col {
    return this.m.get(this.ix(x), this.iy(y), this.iz(z));
  }

  set(x: number, y: number, z: number, c: Col): this {
    const i = this.ix(x);
    const j = this.iy(y);
    const k = this.iz(z);
    if (c < 0) this.m.clear(i, j, k);
    else this.m.set(i, j, k, c);
    return this;
  }

  /** Repeint une case seulement si elle est pleine. */
  tint(x: number, y: number, z: number, c: Col): this {
    if (this.get(x, y, z) >= 0) this.set(x, y, z, c);
    return this;
  }

  /** Union : pose la couleur rendue par fn au centre de chaque case (≥ 0), sinon ne touche à rien. */
  add(fn: (x: number, y: number, z: number) => Col): this {
    const m = this.m;
    for (let j = 0; j < m.sy; j++) {
      const y = this.y0 + j + 0.5;
      for (let k = 0; k < m.sz; k++) {
        const z = this.z0 + k + 0.5;
        for (let i = 0; i < m.sx; i++) {
          const c = fn(this.x0 + i + 0.5, y, z);
          if (c >= 0) m.set(i, j, k, c);
        }
      }
    }
    return this;
  }

  /** Creuse les cases où fn est vrai. */
  carve(fn: (x: number, y: number, z: number) => boolean): this {
    const m = this.m;
    for (let j = 0; j < m.sy; j++)
      for (let k = 0; k < m.sz; k++)
        for (let i = 0; i < m.sx; i++) if (fn(this.x0 + i + 0.5, this.y0 + j + 0.5, this.z0 + k + 0.5)) m.clear(i, j, k);
    return this;
  }

  /** Repeint les cases pleines (fn rend la nouvelle couleur, ou l'ancienne). */
  paint(fn: (x: number, y: number, z: number, c: Col) => Col): this {
    const m = this.m;
    for (let j = 0; j < m.sy; j++)
      for (let k = 0; k < m.sz; k++)
        for (let i = 0; i < m.sx; i++) {
          const c = m.get(i, j, k);
          if (c < 0) continue;
          const n = fn(this.x0 + i + 0.5, this.y0 + j + 0.5, this.z0 + k + 0.5, c);
          if (n !== c) {
            if (n < 0) m.clear(i, j, k);
            else m.set(i, j, k, n);
          }
        }
    return this;
  }

  /**
   * Repeint les cases de surface ; (nx, ny, nz) = somme des directions exposées (normale
   * grossière) pour peindre selon l'orientation.
   */
  paintSurf(fn: (x: number, y: number, z: number, c: Col, nx: number, ny: number, nz: number) => Col): this {
    const m = this.m;
    const out: [number, number, number, number][] = [];
    for (let j = 0; j < m.sy; j++)
      for (let k = 0; k < m.sz; k++)
        for (let i = 0; i < m.sx; i++) {
          const c = m.get(i, j, k);
          if (c < 0) continue;
          const nx = (m.get(i + 1, j, k) < 0 ? 1 : 0) - (m.get(i - 1, j, k) < 0 ? 1 : 0);
          const ny = (m.get(i, j + 1, k) < 0 ? 1 : 0) - (m.get(i, j - 1, k) < 0 ? 1 : 0);
          const nz = (m.get(i, j, k + 1) < 0 ? 1 : 0) - (m.get(i, j, k - 1) < 0 ? 1 : 0);
          const exposed = m.get(i + 1, j, k) < 0 || m.get(i - 1, j, k) < 0 || m.get(i, j + 1, k) < 0 || m.get(i, j - 1, k) < 0 || m.get(i, j, k + 1) < 0 || m.get(i, j, k - 1) < 0;
          if (!exposed) continue;
          const n = fn(this.x0 + i + 0.5, this.y0 + j + 0.5, this.z0 + k + 0.5, c, nx, ny, nz);
          if (n !== c) out.push([i, j, k, n]);
        }
    for (const [i, j, k, n] of out) {
      if (n < 0) m.clear(i, j, k);
      else m.set(i, j, k, n);
    }
    return this;
  }

  /** Première case pleine en partant de l'avant (+Z) dans la colonne (x, y). */
  frontZ(x: number, y: number): number {
    const i = this.ix(x);
    const j = this.iy(y);
    for (let k = this.m.sz - 1; k >= 0; k--) if (this.m.get(i, j, k) >= 0) return this.z0 + k + 0.5;
    return -Infinity;
  }

  /** Première case pleine en partant de l'arrière (−Z). */
  backZ(x: number, y: number): number {
    const i = this.ix(x);
    const j = this.iy(y);
    for (let k = 0; k < this.m.sz; k++) if (this.m.get(i, j, k) >= 0) return this.z0 + k + 0.5;
    return Infinity;
  }

  /** Décalque sur la face avant : repeint la première case pleine (depuis +Z) de la colonne. */
  front(x: number, y: number, c: Col, depth = 1): this {
    const i = this.ix(x);
    const j = this.iy(y);
    let n = 0;
    for (let k = this.m.sz - 1; k >= 0 && n < depth; k--)
      if (this.m.get(i, j, k) >= 0) {
        this.m.set(i, j, k, c);
        n++;
      }
    return this;
  }

  /** Décalque sur la face arrière. */
  back(x: number, y: number, c: Col, depth = 1): this {
    const i = this.ix(x);
    const j = this.iy(y);
    let n = 0;
    for (let k = 0; k < this.m.sz && n < depth; k++)
      if (this.m.get(i, j, k) >= 0) {
        this.m.set(i, j, k, c);
        n++;
      }
    return this;
  }

  /** Décalque sur un flanc (côté +X si side > 0) : première case pleine de la rangée (y, z). */
  side(side: number, y: number, z: number, c: Col): this {
    const j = this.iy(y);
    const k = this.iz(z);
    if (side > 0) {
      for (let i = this.m.sx - 1; i >= 0; i--)
        if (this.m.get(i, j, k) >= 0) {
          this.m.set(i, j, k, c);
          break;
        }
    } else
      for (let i = 0; i < this.m.sx; i++)
        if (this.m.get(i, j, k) >= 0) {
          this.m.set(i, j, k, c);
          break;
        }
    return this;
  }

  /** Copie miroir gauche/droite (x → −x) dans une nouvelle grille. */
  mirrored(): Sculpt {
    const r = new Sculpt(-(this.x0 + this.m.sx), -this.x0, this.y0, this.y0 + this.m.sy, this.z0, this.z0 + this.m.sz);
    const m = this.m;
    for (let j = 0; j < m.sy; j++)
      for (let k = 0; k < m.sz; k++)
        for (let i = 0; i < m.sx; i++) {
          const c = m.get(i, j, k);
          if (c >= 0) r.m.set(m.sx - 1 - i, j, k, c);
        }
    return r;
  }
}

// ------------------------------------------------------------------ formes

/** Valeur de la superellipse |x/a|^n + |z/b|^n (≤ 1 à l'intérieur). */
export function supEll(x: number, z: number, a: number, b: number, n = 2): number {
  return Math.pow(Math.abs(x / Math.max(1e-3, a)), n) + Math.pow(Math.abs(z / Math.max(1e-3, b)), n);
}

export function inEllipsoid(x: number, y: number, z: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): boolean {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  const dz = (z - cz) / rz;
  return dx * dx + dy * dy + dz * dz <= 1;
}

/** Distance au segment [a, b]. */
export function segDist(x: number, y: number, z: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const l2 = ux * ux + uy * uy + uz * uz;
  let t = l2 > 0 ? ((x - ax) * ux + (y - ay) * uy + (z - az) * uz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = x - (ax + ux * t);
  const dy = y - (ay + uy * t);
  const dz = z - (az + uz * t);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Boîte aux arêtes arrondies (rayon r), demi-tailles hx, hy, hz. */
export function inRoundBox(x: number, y: number, z: number, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, r: number): boolean {
  const qx = Math.max(Math.abs(x - cx) - (hx - r), 0);
  const qy = Math.max(Math.abs(y - cy) - (hy - r), 0);
  const qz = Math.max(Math.abs(z - cz) - (hz - r), 0);
  return qx * qx + qy * qy + qz * qz <= r * r;
}

export const smooth = (t: number): number => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * Profil interpolé : table de lignes [y, v1, v2…] triées par y croissant ; renvoie les
 * valeurs à la hauteur y (interpolation adoucie entre deux lignes, constantes aux bouts).
 */
export function profile(rows: number[][]): (y: number, out?: number[]) => number[] {
  const n = rows[0].length - 1;
  return (y: number, out: number[] = new Array(n)) => {
    if (y <= rows[0][0]) {
      for (let k = 0; k < n; k++) out[k] = rows[0][k + 1];
      return out;
    }
    const last = rows[rows.length - 1];
    if (y >= last[0]) {
      for (let k = 0; k < n; k++) out[k] = last[k + 1];
      return out;
    }
    let i = 1;
    while (rows[i][0] < y) i++;
    const a = rows[i - 1];
    const b = rows[i];
    const t = (y - a[0]) / (b[0] - a[0]);
    // mélange d'interpolation linéaire et adoucie : courbes sans cassure mais sans « vagues »
    const s = 0.5 * t + 0.5 * t * t * (3 - 2 * t);
    for (let k = 0; k < n; k++) out[k] = a[k + 1] + (b[k + 1] - a[k + 1]) * s;
    return out;
  };
}

/**
 * Profil en paliers : table de lignes [y, v1, v2…] triées par y croissant ; chaque ligne vaut
 * de son y jusqu'au y de la suivante (la dernière ligne ferme le volume). Hors de la table, les
 * valeurs sont nulles. Les sections constantes sur plusieurs rangées donnent de grandes faces
 * planes (peu de quads) et des marches nettes d'un voxel, à la manière des sculpteurs voxel.
 */
export function steps(rows: number[][]): (y: number, out?: number[]) => number[] {
  const n = rows[0].length - 1;
  return (y: number, out: number[] = new Array(n)) => {
    let row: number[] | null = null;
    for (let i = rows.length - 2; i >= 0; i--)
      if (y >= rows[i][0]) {
        row = y < rows[rows.length - 1][0] ? rows[i] : null;
        break;
      }
    for (let k = 0; k < n; k++) out[k] = row ? row[k + 1] : 0;
    return out;
  };
}

/** Petit hachage déterministe d'une case (variations de couleur, motifs). */
export function hash3(x: number, y: number, z: number, seed = 0): number {
  let h = (Math.floor(x * 2) * 374761393 + Math.floor(y * 2) * 668265263 + Math.floor(z * 2) * 1274126177 + seed * 1013904223) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h & 0xffff) / 0xffff;
}
