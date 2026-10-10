// Grille de navigation 2,5D (cellules de 0,5 m) construite à partir du monde voxel,
// et recherche de chemin A* (8 directions) avec lissage par ligne de vue.

import { MAT_SOLID } from './materials';
import { GROUND_VY, VOXEL, type VoxelWorld } from './voxel';

export const NAV_CELL = 0.5;
const HEADROOM = 7; // voxels libres au-dessus du sol (1,75 m)
const STEP = 2; // marche franchissable (voxels)

export class NavGrid {
  readonly w: number;
  readonly d: number;
  /** Couche voxel du premier air au-dessus du sol (−1 = infranchissable). */
  readonly floor: Int16Array;
  /** Distance (en cellules, max 3) au plus proche obstacle. */
  readonly clear: Uint8Array;
  // tampons A*
  private g: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heap: Int32Array;
  private heapF: Float32Array;
  private heapN = 0;

  constructor(w: number, d: number) {
    this.w = w;
    this.d = d;
    const n = w * d;
    this.floor = new Int16Array(n).fill(-1);
    this.clear = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n);
    this.heapF = new Float32Array(n);
  }

  /** Reconstruit une grille à partir de tableaux calculés ailleurs (worker). */
  static fromArrays(w: number, d: number, floor: Int16Array, clear: Uint8Array): NavGrid {
    const nav = new NavGrid(w, d);
    nav.floor.set(floor);
    nav.clear.set(clear);
    return nav;
  }

  static build(world: VoxelWorld, riverZ: number): NavGrid {
    const w = world.sx >> 1;
    const d = world.sz >> 1;
    const nav = new NavGrid(w, d);
    const top = GROUND_VY + 10;
    const minFloor = GROUND_VY; // sous le niveau de la rue = eau
    // 1) sol de chaque colonne de voxels
    const sx = world.sx;
    const col = new Int16Array(world.sx * world.sz).fill(-1);
    for (let z = 0; z < world.sz; z++) {
      for (let x = 0; x < sx; x++) {
        // premier sol (en partant du bas) surmonté d'assez d'espace libre
        let prevSolid = MAT_SOLID[world.get(x, minFloor - 1, z)] === 1;
        for (let vy = minFloor; vy <= top; vy++) {
          const solid = MAT_SOLID[world.get(x, vy, z)] === 1;
          if (!solid && prevSolid) {
            let ok = true;
            for (let h = 1; h < HEADROOM; h++)
              if (MAT_SOLID[world.get(x, vy + h, z)] === 1) {
                ok = false;
                break;
              }
            if (ok) {
              col[z * sx + x] = vy;
              break;
            }
          }
          prevSolid = solid;
        }
      }
    }
    // 2) cellules 2×2 : praticables si les 4 colonnes ont un sol à hauteurs voisines
    for (let k = 0; k < d; k++) {
      for (let i = 0; i < w; i++) {
        let mn = 1e9;
        let mx = -1;
        let ok = true;
        for (let dz = 0; dz < 2 && ok; dz++)
          for (let dx = 0; dx < 2 && ok; dx++) {
            const f = col[(k * 2 + dz) * sx + i * 2 + dx];
            if (f < 0) ok = false;
            else {
              if (f < mn) mn = f;
              if (f > mx) mx = f;
            }
          }
        let best = ok && mx - mn <= STEP ? mx : -1;
        // l'eau du fleuve n'est jamais praticable (le lit est sous la rue)
        if (best >= 0 && best < GROUND_VY && (k + 0.5) * NAV_CELL >= riverZ) best = -1;
        nav.floor[k * w + i] = best;
      }
    }
    nav.computeClearance();
    return nav;
  }

  private computeClearance(): void {
    const { w, d } = this;
    const c = this.clear;
    for (let n = 0; n < w * d; n++) c[n] = this.floor[n] < 0 ? 0 : 3;
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 1; k < d - 1; k++)
        for (let i = 1; i < w - 1; i++) {
          const n = k * w + i;
          if (c[n] === 0) continue;
          const m = Math.min(c[n - 1], c[n + 1], c[n - w], c[n + w]) + 1;
          if (m < c[n]) c[n] = m;
        }
    }
    for (let i = 0; i < w; i++) {
      c[i] = Math.min(c[i], 1);
      c[(d - 1) * w + i] = Math.min(c[(d - 1) * w + i], 1);
    }
  }

  idx(x: number, z: number): number {
    const i = Math.floor(x / NAV_CELL);
    const k = Math.floor(z / NAV_CELL);
    if (i < 0 || k < 0 || i >= this.w || k >= this.d) return -1;
    return k * this.w + i;
  }

  walkable(x: number, z: number): boolean {
    const n = this.idx(x, z);
    return n >= 0 && this.floor[n] >= 0;
  }

  /** Altitude du sol (m) à une position, ou NaN. */
  heightAt(x: number, z: number): number {
    const n = this.idx(x, z);
    if (n < 0 || this.floor[n] < 0) return NaN;
    return (this.floor[n] - GROUND_VY) * VOXEL;
  }

  /** Cellule praticable la plus proche (recherche en spirale bornée). */
  nearestWalkable(x: number, z: number, maxR = 12): number {
    const ci = Math.floor(x / NAV_CELL);
    const ck = Math.floor(z / NAV_CELL);
    let best = -1;
    let bd = Infinity;
    for (let r = 0; r <= maxR; r++) {
      for (let dk = -r; dk <= r; dk++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dk)) !== r) continue;
          const i = ci + di;
          const k = ck + dk;
          if (i < 0 || k < 0 || i >= this.w || k >= this.d) continue;
          const n = k * this.w + i;
          if (this.floor[n] < 0) continue;
          const dd = di * di + dk * dk - this.clear[n] * 0.3;
          if (dd < bd) {
            bd = dd;
            best = n;
          }
        }
      if (best >= 0 && r >= 1) return best;
    }
    return best;
  }

  cellCenter(n: number): [number, number] {
    const i = n % this.w;
    const k = (n - i) / this.w;
    return [(i + 0.5) * NAV_CELL, (k + 0.5) * NAV_CELL];
  }

  /** Peut-on passer de la cellule a à la cellule b (adjacentes) ? */
  private canStep(a: number, b: number): boolean {
    const fb = this.floor[b];
    if (fb < 0) return false;
    return Math.abs(fb - this.floor[a]) <= STEP;
  }

  /** Ligne droite praticable entre deux points (échantillonnage). */
  lineWalkable(ax: number, az: number, bx: number, bz: number, minClear = 1): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / (NAV_CELL * 0.5));
    let prev = this.idx(ax, az);
    if (prev < 0 || this.floor[prev] < 0) return false;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const n = this.idx(ax + dx * t, az + dz * t);
      if (n < 0 || this.floor[n] < 0 || this.clear[n] < minClear) return false;
      if (n !== prev) {
        if (Math.abs(this.floor[n] - this.floor[prev]) > STEP) return false;
        prev = n;
      }
    }
    return true;
  }

  private push(n: number, f: number): void {
    let i = this.heapN++;
    const h = this.heap;
    const hf = this.heapF;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      h[i] = h[p];
      hf[i] = hf[p];
      i = p;
    }
    h[i] = n;
    hf[i] = f;
  }

  private pop(): number {
    const h = this.heap;
    const hf = this.heapF;
    const top = h[0];
    const last = h[--this.heapN];
    const lf = hf[this.heapN];
    let i = 0;
    const N = this.heapN;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= N) break;
      if (c + 1 < N && hf[c + 1] < hf[c]) c++;
      if (hf[c] >= lf) break;
      h[i] = h[c];
      hf[i] = hf[c];
      i = c;
    }
    h[i] = last;
    hf[i] = lf;
    return top;
  }

  /**
   * Chemin de (sx,sz) à (tx,tz). Renvoie une liste de points [x0,z0,x1,z1,…] lissée,
   * ou null. `maxNodes` borne le coût de la recherche.
   */
  findPath(sx: number, sz: number, tx: number, tz: number, maxNodes = 40000): number[] | null {
    let start = this.idx(sx, sz);
    if (start < 0 || this.floor[start] < 0) start = this.nearestWalkable(sx, sz, 6);
    let goal = this.idx(tx, tz);
    if (goal < 0 || this.floor[goal] < 0) goal = this.nearestWalkable(tx, tz, 10);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [tx, tz];
    const w = this.w;
    const gen = ++this.gen;
    const gi = goal % w;
    const gk = (goal - gi) / w;
    const H = (n: number) => {
      const i = n % w;
      const k = (n - i) / w;
      const dx = Math.abs(i - gi);
      const dk = Math.abs(k - gk);
      return (Math.max(dx, dk) + 0.414 * Math.min(dx, dk)) * 1.08;
    };
    this.heapN = 0;
    this.g[start] = 0;
    this.stamp[start] = gen;
    this.parent[start] = -1;
    this.push(start, H(start));
    let expanded = 0;
    let found = false;
    let bestNode = start;
    let bestH = H(start);
    const DIRS = [1, -1, w, -w, w + 1, w - 1, -w + 1, -w - 1];
    const COST = [1, 1, 1, 1, 1.414, 1.414, 1.414, 1.414];
    while (this.heapN > 0) {
      const n = this.pop();
      if (this.closed[n] === gen) continue;
      this.closed[n] = gen;
      if (n === goal) {
        found = true;
        break;
      }
      const hn = H(n);
      if (hn < bestH) {
        bestH = hn;
        bestNode = n;
      }
      if (++expanded > maxNodes) break;
      const ni = n % w;
      for (let dir = 0; dir < 8; dir++) {
        const m = n + DIRS[dir];
        const mi = ni + (dir === 0 || dir === 4 || dir === 6 ? 1 : dir === 1 || dir === 5 || dir === 7 ? -1 : 0);
        if (mi < 0 || mi >= w || m < 0 || m >= this.floor.length) continue;
        if (!this.canStep(n, m)) continue;
        if (dir >= 4) {
          // pas de coupe d'angle
          const a = n + (dir === 4 || dir === 6 ? 1 : -1);
          const b = n + (dir === 4 || dir === 5 ? w : -w);
          if (this.floor[a] < 0 || this.floor[b] < 0) continue;
        }
        const cl = this.clear[m];
        const penalty = cl <= 1 ? 1.6 : cl === 2 ? 0.25 : 0;
        const ng = this.g[n] + COST[dir] * (1 + penalty);
        if (this.stamp[m] === gen && ng >= this.g[m]) continue;
        this.stamp[m] = gen;
        this.g[m] = ng;
        this.parent[m] = n;
        this.push(m, ng + H(m));
      }
    }
    const end = found ? goal : bestNode;
    if (end === start) return null;
    // reconstruction
    const cells: number[] = [];
    for (let n = end; n !== -1; n = this.parent[n]) cells.push(n);
    cells.reverse();
    // lissage : on saute les points intermédiaires visibles en ligne droite
    const pts: number[] = [];
    let anchor = 0;
    let [ax, az] = this.cellCenter(cells[0]);
    pts.push(ax, az);
    while (anchor < cells.length - 1) {
      let next = anchor + 1;
      for (let j = Math.min(cells.length - 1, anchor + 40); j > anchor + 1; j--) {
        const [bx, bz] = this.cellCenter(cells[j]);
        if (this.lineWalkable(ax, az, bx, bz, 1)) {
          next = j;
          break;
        }
      }
      const [nx, nz] = this.cellCenter(cells[next]);
      pts.push(nx, nz);
      ax = nx;
      az = nz;
      anchor = next;
    }
    if (found) {
      pts[pts.length - 2] = tx;
      pts[pts.length - 1] = tz;
      if (!this.walkable(tx, tz)) {
        const [cx, cz] = this.cellCenter(goal);
        pts[pts.length - 2] = cx;
        pts[pts.length - 1] = cz;
      }
    }
    return pts;
  }
}
