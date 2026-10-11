// Grille de navigation multi-niveaux (cellules de 0,5 m) construite à partir du monde voxel.
// Chaque cellule peut porter plusieurs sols superposés (métro, rue, étages, toits). Un nœud
// est un couple (cellule, niveau). Les escaliers relient naturellement les niveaux (marches
// franchissables) ; les ascenseurs sont des « portails » explicites entre deux nœuds.
// Recherche de chemin A* (8 directions) avec lissage par ligne de marche.

import { MAT_SOLID } from './materials';
import { CHUNK, CHUNK_BITS, CHUNK_VOL, GROUND_VY, VOXEL, type VoxelWorld } from './voxel';

export const NAV_CELL = 0.5;
/** Nombre maximal de sols superposés par cellule. */
export const NAV_LAYERS = 6;
const L = NAV_LAYERS;
const HEADROOM = 7; // voxels libres au-dessus du sol (1,75 m)
const STEP = 2; // marche franchissable (voxels)

export type PortalKind = 'elevator' | 'stairs' | 'train';

/** Lien explicite entre deux points de la grille (ascenseur…). */
export interface PortalDef {
  kind: PortalKind;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  /** Coût en cellules équivalentes (attente + trajet). */
  cost?: number;
  /** Bâtiment desservi (ascenseurs) ou -1. */
  building?: number;
}

export interface Portal extends PortalDef {
  id: number;
  a: number; // nœud de départ
  b: number; // nœud d'arrivée
  cost: number;
}

export interface NavBuildOptions {
  /** Sols interdits (eau de la rivière…) : coordonnées monde en mètres. */
  exclude?: (x: number, z: number, y: number) => boolean;
  /** Ascenseurs et autres liens. */
  portals?: PortalDef[];
  /** Points de départ de la recherche de connexité : les zones non reliées sont retirées. */
  seeds?: { x: number; z: number; y: number }[];
}

/** Chemin : suite de points [x, z, y, portail] (portail = −1, ou id du portail à prendre). */
export type NavPath = number[];
export const PATH_STRIDE = 4;

export interface SerializedNav {
  w: number;
  d: number;
  floor: Int16Array;
  clear: Uint8Array;
  count: Uint8Array;
  portals: Portal[];
}

export class NavGrid {
  readonly w: number;
  readonly d: number;
  /** Nombre de sols de chaque cellule. */
  readonly count: Uint8Array;
  /** Couche voxel du premier air au-dessus du sol, par nœud (cellule × NAV_LAYERS + niveau), −1 = absent. Triés par hauteur. */
  readonly floor: Int16Array;
  /** Distance (en cellules, max 3) au plus proche obstacle, par nœud. */
  readonly clear: Uint8Array;
  portals: Portal[] = [];
  private portalsAt = new Map<number, number[]>();
  // tampons A* (alloués à la première recherche)
  private g: Float32Array | null = null;
  private parent: Int32Array | null = null;
  private parentPortal: Int32Array | null = null;
  private stamp: Uint32Array | null = null;
  private closed: Uint32Array | null = null;
  private gen = 1;
  private heap = new Int32Array(4096);
  private heapF = new Float32Array(4096);
  private heapN = 0;

  constructor(w: number, d: number) {
    this.w = w;
    this.d = d;
    const n = w * d;
    this.count = new Uint8Array(n);
    this.floor = new Int16Array(n * L).fill(-1);
    this.clear = new Uint8Array(n * L);
  }

  // ======================================================================= sérialisation

  serialize(): SerializedNav {
    return { w: this.w, d: this.d, floor: this.floor, clear: this.clear, count: this.count, portals: this.portals };
  }

  transferables(): ArrayBuffer[] {
    return [this.floor.buffer as ArrayBuffer, this.clear.buffer as ArrayBuffer, this.count.buffer as ArrayBuffer];
  }

  static deserialize(s: SerializedNav): NavGrid {
    const nav = new NavGrid(s.w, s.d);
    nav.floor.set(s.floor);
    nav.clear.set(s.clear);
    nav.count.set(s.count);
    nav.setPortals(s.portals);
    return nav;
  }

  private setPortals(list: Portal[]): void {
    this.portals = list;
    this.portalsAt.clear();
    for (const p of list) {
      for (const n of [p.a, p.b]) {
        let arr = this.portalsAt.get(n);
        if (!arr) this.portalsAt.set(n, (arr = []));
        arr.push(p.id);
      }
    }
  }

  // ======================================================================= construction

  static build(world: VoxelWorld, opts: NavBuildOptions = {}): NavGrid {
    const w = world.sx >> 1;
    const d = world.sz >> 1;
    const nav = new NavGrid(w, d);
    const sx = world.sx;
    const sy = world.sy;
    const MAXC = L + 2; // sols mémorisés par colonne de voxels
    const exclude = opts.exclude;
    // On avance par bandes d'une rangée de tronçons (32 voxels en z) : d'abord les sols de chaque
    // colonne de voxels de la bande, puis les cellules 2×2 de la bande (une cellule ne chevauche
    // jamais deux bandes). Chaque tronçon n'est lu (décompressé) qu'une fois.
    const colFloors = new Int16Array(sx * CHUNK * MAXC);
    const solid = new Uint8Array(sy + 1);
    const bufs = Array.from({ length: world.cy }, () => new Uint8Array(CHUNK_VOL));
    const col: (Uint8Array | null)[] = new Array(world.cy).fill(null);
    const uni = new Uint8Array(world.cy);
    for (let cz = 0; cz < world.cz; cz++) {
      colFloors.fill(-1);
      // 1) sols de chaque colonne de voxels de la bande
      for (let cx = 0; cx < world.cx; cx++) {
        for (let cy = 0; cy < world.cy; cy++) {
          const ci = world.chunkIndex(cx, cy, cz);
          col[cy] = world.chunkRaw(ci, bufs[cy]);
          uni[cy] = MAT_SOLID[world.fillMat[ci]];
        }
        for (let lz = 0; lz < CHUNK; lz++) {
          const z = cz * CHUNK + lz;
          if (z >= world.sz) break;
          for (let lx = 0; lx < CHUNK; lx++) {
            const x = cx * CHUNK + lx;
            if (x >= sx) break;
            // colonne de solidité
            const base = (lz << CHUNK_BITS) | lx;
            for (let cy = 0; cy < world.cy; cy++) {
              const ch = col[cy];
              const y0 = cy * CHUNK;
              const n = Math.min(CHUNK, sy - y0);
              if (ch === null) solid.fill(uni[cy], y0, y0 + n);
              else for (let y = 0; y < n; y++) solid[y0 + y] = MAT_SOLID[ch[(y << 10) | base]];
            }
            solid[sy] = 0;
            let nf = 0;
            const o = (lz * sx + x) * MAXC;
            for (let vy = 1; vy < sy - 1 && nf < MAXC; vy++) {
              if (solid[vy] || !solid[vy - 1]) continue;
              let ok = true;
              for (let h = 1; h < HEADROOM; h++)
                if (vy + h < sy && solid[vy + h]) {
                  ok = false;
                  break;
                }
              if (!ok) continue;
              colFloors[o + nf++] = vy;
            }
          }
        }
      }
      // 2) cellules 2×2 : un sol de cellule existe si les 4 colonnes ont un sol voisin
      const k1 = Math.min(d, ((cz + 1) * CHUNK) >> 1);
      for (let k = (cz * CHUNK) >> 1; k < k1; k++) {
        const lz = k * 2 - cz * CHUNK;
        for (let i = 0; i < w; i++) {
          const c0 = (lz * sx + i * 2) * MAXC;
          const c1 = (lz * sx + i * 2 + 1) * MAXC;
          const c2 = ((lz + 1) * sx + i * 2) * MAXC;
          const c3 = ((lz + 1) * sx + i * 2 + 1) * MAXC;
          const n = k * w + i;
          let cnt = 0;
          for (let a = 0; a < MAXC && cnt < L; a++) {
            const fa = colFloors[c0 + a];
            if (fa < 0) break;
            const fb = matchFloor(colFloors, c1, MAXC, fa);
            if (fb < 0) continue;
            const fc = matchFloor(colFloors, c2, MAXC, fa);
            if (fc < 0) continue;
            const fd = matchFloor(colFloors, c3, MAXC, fa);
            if (fd < 0) continue;
            const mn = Math.min(fa, fb, fc, fd);
            const mx = Math.max(fa, fb, fc, fd);
            if (mx - mn > STEP) continue;
            if (exclude && exclude((i + 0.5) * NAV_CELL, (k + 0.5) * NAV_CELL, (mx - GROUND_VY) * VOXEL)) continue;
            // pas de doublon (sols très proches)
            if (cnt > 0 && Math.abs(nav.floor[n * L + cnt - 1] - mx) <= STEP) continue;
            nav.floor[n * L + cnt] = mx;
            cnt++;
          }
          nav.count[n] = cnt;
        }
      }
    }
    // 3) portails
    const portals: Portal[] = [];
    for (const p of opts.portals ?? []) {
      const a = nav.nodeAt(p.ax, p.az, p.ay, 1.5);
      const b = nav.nodeAt(p.bx, p.bz, p.by, 1.5);
      if (a < 0 || b < 0 || a === b) continue;
      const cost = p.cost ?? 16 + Math.abs(p.by - p.ay) * 1.5;
      portals.push({ ...p, id: portals.length, a, b, cost });
    }
    nav.setPortals(portals);
    // 4) connexité : on retire ce qui n'est relié à aucun point de départ
    if (opts.seeds && opts.seeds.length > 0) nav.pruneUnreachable(opts.seeds);
    nav.computeClearance();
    return nav;
  }

  /** Retire les nœuds non reliés aux points de départ (volumes fermés, toits inaccessibles…). */
  private pruneUnreachable(seeds: { x: number; z: number; y: number }[]): void {
    const N = this.w * this.d * L;
    const seen = new Uint8Array(N);
    const stack: number[] = [];
    for (const s of seeds) {
      const n = this.nodeAt(s.x, s.z, s.y, 2);
      if (n >= 0 && !seen[n]) {
        seen[n] = 1;
        stack.push(n);
      }
    }
    const w = this.w;
    while (stack.length > 0) {
      const node = stack.pop()!;
      const cell = (node / L) | 0;
      const f = this.floor[node];
      const ci = cell % w;
      for (let dir = 0; dir < 4; dir++) {
        let m: number;
        if (dir === 0) {
          if (ci + 1 >= w) continue;
          m = cell + 1;
        } else if (dir === 1) {
          if (ci === 0) continue;
          m = cell - 1;
        } else if (dir === 2) {
          m = cell + w;
          if (m >= this.count.length) continue;
        } else {
          m = cell - w;
          if (m < 0) continue;
        }
        const nb = this.layerNear(m, f);
        if (nb < 0) continue;
        const nn = m * L + nb;
        if (seen[nn]) continue;
        seen[nn] = 1;
        stack.push(nn);
      }
      const ps = this.portalsAt.get(node);
      if (ps)
        for (const pid of ps) {
          const p = this.portals[pid];
          const other = p.a === node ? p.b : p.a;
          if (!seen[other]) {
            seen[other] = 1;
            stack.push(other);
          }
        }
    }
    // compactage des niveaux restants
    for (let cell = 0; cell < this.count.length; cell++) {
      const cnt = this.count[cell];
      if (cnt === 0) continue;
      let out = 0;
      const keep: number[] = [];
      for (let l = 0; l < cnt; l++) if (seen[cell * L + l]) keep.push(this.floor[cell * L + l]);
      for (let l = 0; l < L; l++) this.floor[cell * L + l] = -1;
      for (const f of keep) this.floor[cell * L + out++] = f;
      this.count[cell] = out;
    }
    // les portails doivent pointer vers les nœuds compactés
    const fixed: Portal[] = [];
    for (const p of this.portals) {
      const a = this.nodeAt(p.ax, p.az, p.ay, 1.5);
      const b = this.nodeAt(p.bx, p.bz, p.by, 1.5);
      if (a < 0 || b < 0) continue;
      fixed.push({ ...p, id: fixed.length, a, b });
    }
    this.setPortals(fixed);
  }

  private computeClearance(): void {
    const { w, d } = this;
    const c = this.clear;
    for (let cell = 0; cell < w * d; cell++) {
      for (let l = 0; l < L; l++) c[cell * L + l] = l < this.count[cell] ? 3 : 0;
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 0; k < d; k++)
        for (let i = 0; i < w; i++) {
          const cell = k * w + i;
          const cnt = this.count[cell];
          for (let l = 0; l < cnt; l++) {
            const node = cell * L + l;
            if (c[node] === 0) continue;
            if (i === 0 || k === 0 || i === w - 1 || k === d - 1) {
              c[node] = Math.min(c[node], 1);
              continue;
            }
            const f = this.floor[node];
            let m = 3;
            for (const nb of [cell - 1, cell + 1, cell - w, cell + w]) {
              const nl = this.layerNear(nb, f);
              const v = nl < 0 ? 0 : c[nb * L + nl];
              if (v < m) m = v;
            }
            if (m + 1 < c[node]) c[node] = m + 1;
          }
        }
    }
  }

  // ======================================================================= requêtes

  idx(x: number, z: number): number {
    const i = Math.floor(x / NAV_CELL);
    const k = Math.floor(z / NAV_CELL);
    if (i < 0 || k < 0 || i >= this.w || k >= this.d) return -1;
    return k * this.w + i;
  }

  /** Niveau de la cellule dont le sol (couche voxel) est franchissable depuis `f` (marche), ou −1. */
  layerNear(cell: number, f: number): number {
    const cnt = this.count[cell];
    let best = -1;
    let bd = STEP + 1;
    for (let l = 0; l < cnt; l++) {
      const dd = Math.abs(this.floor[cell * L + l] - f);
      if (dd < bd) {
        bd = dd;
        best = l;
      }
    }
    return best;
  }

  /** Niveau de la cellule le plus proche de l'altitude y (m), à `tol` mètres près ; −1 sinon. */
  layerAt(cell: number, y: number, tol = 1.2): number {
    if (cell < 0) return -1;
    const cnt = this.count[cell];
    let best = -1;
    let bd = Infinity;
    for (let l = 0; l < cnt; l++) {
      const fy = (this.floor[cell * L + l] - GROUND_VY) * VOXEL;
      // on préfère le sol sous les pieds (un personnage est rarement sous son sol)
      const dd = fy <= y + 0.3 ? y - fy : (fy - y) * 1.6;
      if (dd < bd) {
        bd = dd;
        best = l;
      }
    }
    return bd <= tol ? best : -1;
  }

  /** Nœud à la position (x, y, z), ou −1. */
  nodeAt(x: number, z: number, y = 0, tol = 1.2): number {
    const cell = this.idx(x, z);
    if (cell < 0) return -1;
    const l = this.layerAt(cell, y, tol);
    return l < 0 ? -1 : cell * L + l;
  }

  walkable(x: number, z: number, y = 0, tol = 1.2): boolean {
    return this.nodeAt(x, z, y, tol) >= 0;
  }

  /** Altitude du sol (m) le plus proche de y à cette position, ou NaN. */
  heightAt(x: number, z: number, y = 0, tol = 3): number {
    const n = this.nodeAt(x, z, y, tol);
    if (n < 0) return NaN;
    return (this.floor[n] - GROUND_VY) * VOXEL;
  }

  /** Tous les sols (m) d'une position, du plus bas au plus haut. */
  floorsAt(x: number, z: number): number[] {
    const cell = this.idx(x, z);
    if (cell < 0) return [];
    const out: number[] = [];
    for (let l = 0; l < this.count[cell]; l++) out.push((this.floor[cell * L + l] - GROUND_VY) * VOXEL);
    return out;
  }

  nodeY(node: number): number {
    return (this.floor[node] - GROUND_VY) * VOXEL;
  }

  cellOf(node: number): number {
    return (node / L) | 0;
  }

  nodeCenter(node: number): [number, number] {
    return this.cellCenter(this.cellOf(node));
  }

  /** Nœud praticable le plus proche (recherche en spirale bornée), ou −1. */
  nearestWalkable(x: number, z: number, y = 0, maxR = 12): number {
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
          const cell = k * this.w + i;
          const l = this.layerAt(cell, y, 2.5);
          if (l < 0) continue;
          const node = cell * L + l;
          const dy = this.nodeY(node) - y;
          const dd = di * di + dk * dk + dy * dy * 4 - this.clear[node] * 0.3;
          if (dd < bd) {
            bd = dd;
            best = node;
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

  /** Ligne droite praticable entre deux points, en suivant le sol depuis l'altitude ay. */
  /**
   * Ligne droite praticable de (ax, ay, az) à (bx, bz) en restant sur des niveaux continus.
   * Si `by` est donné, la ligne doit aussi arriver à cette altitude (et pas, par exemple, sur le
   * quai du métro sous la rue, ou à l'étage du dessous d'une trémie d'escalier).
   */
  lineWalkable(ax: number, az: number, bx: number, bz: number, minClear = 1, ay = 0, by?: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / (NAV_CELL * 0.5));
    let prev = this.nodeAt(ax, az, ay);
    if (prev < 0) return false;
    let prevCell = this.cellOf(prev);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const cell = this.idx(ax + dx * t, az + dz * t);
      if (cell < 0) return false;
      if (cell === prevCell) continue;
      const l = this.layerNear(cell, this.floor[prev]);
      if (l < 0) return false;
      const node = cell * L + l;
      if (this.clear[node] < minClear) return false;
      prev = node;
      prevCell = cell;
    }
    if (by !== undefined && Math.abs(this.nodeY(prev) - by) > 1.0) return false;
    return true;
  }

  /** Nœud atteint en faisant un pas depuis `from` vers (x, z) ; −1 si infranchissable. */
  stepNode(from: number, x: number, z: number): number {
    const cell = this.idx(x, z);
    if (cell < 0) return -1;
    if (from < 0) return -1;
    if (cell === this.cellOf(from)) return from;
    const l = this.layerNear(cell, this.floor[from]);
    return l < 0 ? -1 : cell * L + l;
  }

  /** Altitude atteinte en marchant en ligne droite de (ax, ay, az) vers (bx, bz), ou NaN si bloqué. */
  walkTo(ax: number, az: number, ay: number, bx: number, bz: number): number {
    let prev = this.nodeAt(ax, az, ay);
    if (prev < 0) return NaN;
    const cell = this.idx(bx, bz);
    if (cell < 0) return NaN;
    if (cell === this.cellOf(prev)) return this.nodeY(prev);
    const l = this.layerNear(cell, this.floor[prev]);
    if (l < 0) return NaN;
    prev = cell * L + l;
    return this.nodeY(prev);
  }

  // ======================================================================= A*

  private ensureBuffers(): void {
    if (this.g) return;
    const N = this.w * this.d * L;
    this.g = new Float32Array(N);
    this.parent = new Int32Array(N);
    this.parentPortal = new Int32Array(N);
    this.stamp = new Uint32Array(N);
    this.closed = new Uint32Array(N);
  }

  private push(n: number, f: number): void {
    if (this.heapN >= this.heap.length) {
      const h = new Int32Array(this.heap.length * 2);
      h.set(this.heap);
      this.heap = h;
      const hf = new Float32Array(this.heapF.length * 2);
      hf.set(this.heapF);
      this.heapF = hf;
    }
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
   * Chemin de (sx, sy, sz) à (tx, ty, tz). Renvoie une liste de points [x, z, y, portail, …]
   * lissée, ou null. `maxNodes` borne le coût de la recherche. `dense` : sans lissage (un point
   * par case de la grille), pour se dégager d'un passage où l'on reste coincé.
   */
  findPath(sx: number, sz: number, sy: number, tx: number, tz: number, ty: number, maxNodes = 40000, dense = false): NavPath | null {
    this.ensureBuffers();
    const g = this.g!;
    const parent = this.parent!;
    const parentPortal = this.parentPortal!;
    const stamp = this.stamp!;
    const closed = this.closed!;
    let start = this.nodeAt(sx, sz, sy);
    if (start < 0) start = this.nearestWalkable(sx, sz, sy, 6);
    let goal = this.nodeAt(tx, tz, ty);
    if (goal < 0) goal = this.nearestWalkable(tx, tz, ty, 10);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [tx, tz, this.nodeY(goal), -1];
    const w = this.w;
    const gen = ++this.gen;
    const goalCell = this.cellOf(goal);
    const gi = goalCell % w;
    const gk = (goalCell - gi) / w;
    const gy = this.nodeY(goal);
    const H = (node: number) => {
      const cell = (node / L) | 0;
      const i = cell % w;
      const k = (cell - i) / w;
      const dx = Math.abs(i - gi);
      const dk = Math.abs(k - gk);
      return (Math.max(dx, dk) + 0.414 * Math.min(dx, dk)) * 1.08 + Math.abs(this.nodeY(node) - gy) * 0.5;
    };
    this.heapN = 0;
    g[start] = 0;
    stamp[start] = gen;
    parent[start] = -1;
    parentPortal[start] = -1;
    this.push(start, H(start));
    let expanded = 0;
    let found = false;
    let bestNode = start;
    let bestH = H(start);
    const DI = [1, -1, 0, 0, 1, -1, 1, -1];
    const DK = [0, 0, 1, -1, 1, 1, -1, -1];
    const COST = [1, 1, 1, 1, 1.414, 1.414, 1.414, 1.414];
    while (this.heapN > 0) {
      const n = this.pop();
      if (closed[n] === gen) continue;
      closed[n] = gen;
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
      const cell = (n / L) | 0;
      const ni = cell % w;
      const nk = (cell - ni) / w;
      const f = this.floor[n];
      for (let dir = 0; dir < 8; dir++) {
        const mi = ni + DI[dir];
        const mk = nk + DK[dir];
        if (mi < 0 || mi >= w || mk < 0 || mk >= this.d) continue;
        const mc = mk * w + mi;
        const ml = this.layerNear(mc, f);
        if (ml < 0) continue;
        const m = mc * L + ml;
        if (dir >= 4) {
          // pas de coupe d'angle
          if (this.layerNear(nk * w + mi, f) < 0 || this.layerNear(mk * w + ni, f) < 0) continue;
        }
        const cl = this.clear[m];
        const penalty = cl <= 1 ? 1.6 : cl === 2 ? 0.25 : 0;
        const ng = g[n] + COST[dir] * (1 + penalty);
        if (stamp[m] === gen && ng >= g[m]) continue;
        stamp[m] = gen;
        g[m] = ng;
        parent[m] = n;
        parentPortal[m] = -1;
        this.push(m, ng + H(m));
      }
      const ps = this.portalsAt.get(n);
      if (ps)
        for (const pid of ps) {
          const p = this.portals[pid];
          const m = p.a === n ? p.b : p.a;
          const ng = g[n] + p.cost;
          if (stamp[m] === gen && ng >= g[m]) continue;
          stamp[m] = gen;
          g[m] = ng;
          parent[m] = n;
          parentPortal[m] = pid;
          this.push(m, ng + H(m));
        }
    }
    const end = found ? goal : bestNode;
    if (end === start) return null;
    // reconstruction : nœuds et portails empruntés
    const nodes: number[] = [];
    const via: number[] = []; // portail utilisé pour ARRIVER sur ce nœud
    for (let n = end; n !== -1; n = parent[n]) {
      nodes.push(n);
      via.push(parentPortal[n]);
    }
    nodes.reverse();
    via.reverse();
    // lissage par tronçons séparés par les portails
    const pts: NavPath = [];
    const emit = (node: number, portal: number) => {
      const [x, z] = this.nodeCenter(node);
      pts.push(x, z, this.nodeY(node), portal);
    };
    let segStart = 0;
    for (let s = 1; s <= nodes.length; s++) {
      const cut = s === nodes.length || via[s] >= 0;
      if (!cut) continue;
      // tronçon [segStart, s-1] sans portail
      let anchor = segStart;
      emit(nodes[anchor], -1);
      while (anchor < s - 1) {
        const [ax, az] = this.nodeCenter(nodes[anchor]);
        const ay = this.nodeY(nodes[anchor]);
        let next = anchor + 1;
        // pas de raccourci à travers un changement de hauteur (escaliers, marches, trémies) : la
        // ligne droite y couperait le coin de la volée et buterait sur son bord
        let lim = Math.min(s - 1, anchor + 40);
        if (dense) lim = anchor + 1;
        else
          for (let j = anchor + 1; j <= lim; j++)
            if (Math.abs(this.nodeY(nodes[j]) - ay) > 0.3) {
              lim = Math.max(anchor + 1, j - 1);
              break;
            }
        for (let j = lim; j > anchor + 1; j--) {
          const [bx, bz] = this.nodeCenter(nodes[j]);
          if (this.lineWalkable(ax, az, bx, bz, 1, ay, this.nodeY(nodes[j]))) {
            next = j;
            break;
          }
        }
        emit(nodes[next], -1);
        anchor = next;
      }
      if (s < nodes.length) {
        // le dernier point du tronçon prend le portail menant au nœud suivant
        pts[pts.length - 1] = via[s];
      }
      segStart = s;
    }
    if (found) {
      // dernier point : la cible exacte si elle est praticable
      const last = pts.length - PATH_STRIDE;
      if (this.nodeAt(tx, tz, ty) === goal) {
        pts[last] = tx;
        pts[last + 1] = tz;
      }
    }
    return pts;
  }
}

/** Indice (dans la liste de sols d'une colonne) d'un sol à ±STEP de f, ou −1. */
function matchFloor(col: Int16Array, o: number, max: number, f: number): number {
  for (let a = 0; a < max; a++) {
    const v = col[o + a];
    if (v < 0) return -1;
    if (Math.abs(v - f) <= STEP) return v;
    if (v > f + STEP) return -1;
  }
  return -1;
}


