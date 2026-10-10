// Mobilier urbain, toits, façades, véhicules garés et monuments (New York 2085).
// Résolution 1/16 m (1/32 m pour les petits objets ronds ou très détaillés), origine au centre
// de la base, l'avant regarde vers +Z ; les objets muraux ont le dos contre le mur (−Z).
// Les bras de lampadaires, potences et ombrelles débordent de l'encombrement (voir props.ts).
// Le maillage glouton ne fusionne que les faces à occlusion uniforme : on préfère les volumes
// à faces planes et les détails peints (affleurants) aux reliefs fins, coûteux en faces.

import type { PropKind } from '../../../shared/city/props';
import type { PropModelEntry } from './index';
import { SLOT, VoxelModel, shade } from '../voxelModel';

const R16 = 1 / 16;
const R32 = 1 / 32;

// ------------------------------------------------------------------ couleurs (sRGB)

const K = {
  // métaux
  black: 0x131416,
  graphite: 0x262a2f,
  graphiteHi: 0x343940,
  gunmetal: 0x464d56,
  steel: 0x69717b,
  steelHi: 0x8e97a1,
  alu: 0xb2bac2,
  chrome: 0xd3d9df,
  galv: 0x8b9398,
  galvDk: 0x6a7277,
  rubber: 0x1c1d20,
  // fonte des parcs (vert presque noir)
  parkIron: 0x1c2a22,
  parkIronHi: 0x2b3e32,
  // peintures de rue
  basketGreen: 0x2f6440,
  basketGreenDk: 0x1e4029,
  signGreen: 0x0e6a3c,
  hydrantRed: 0xb3261e,
  hydrantRedDk: 0x7a1712,
  hydrantYellow: 0xe8b41e,
  hydrantSilver: 0xaab1b7,
  mailBlue: 0x1d4f9e,
  mailBlueDk: 0x143a78,
  mailBlueHi: 0x2b63b8,
  safetyOrange: 0xe8601a,
  white: 0xe9ebea,
  offWhite: 0xd8d4ca,
  // matériaux
  concrete: 0xa29d94,
  concreteDk: 0x827d76,
  concreteHi: 0xbab5ab,
  ironCover: 0x34322f,
  ironCoverHi: 0x4a4743,
  soot: 0x1a1918,
  newsprint: 0xd9d2c0,
  ink: 0x23201c,
};

// ------------------------------------------------------------------ outils

/** Boîte aux arêtes verticales abattues. */
function rbox(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): VoxelModel {
  m.box(x0, y0, z0, x1, y1, z1, c);
  for (const [x, z] of [
    [x0, z0],
    [x1 - 1, z0],
    [x0, z1 - 1],
    [x1 - 1, z1 - 1],
  ])
    m.box(x, y0, z, x + 1, y1, z + 1, -1);
  return m;
}

/** Fût carré de côté n à arêtes plus sombres (effet d'arrondi qui garde des faces fusionnables). */
function squarePole(m: VoxelModel, x0: number, z0: number, n: number, y0: number, y1: number, c: number): VoxelModel {
  m.box(x0, y0, z0, x0 + n, y1, z0 + n, c);
  const e = shade(c, 0.72);
  for (const [x, z] of [
    [x0, z0],
    [x0 + n - 1, z0],
    [x0, z0 + n - 1],
    [x0 + n - 1, z0 + n - 1],
  ])
    m.box(x, y0, z, x + 1, y1, z + 1, e);
  return m;
}

/** Repeint les cases pleines d'une boîte (ne crée rien). */
function paint(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): VoxelModel {
  for (let y = Math.max(0, y0); y < Math.min(m.sy, y1); y++)
    for (let z = Math.max(0, z0); z < Math.min(m.sz, z1); z++)
      for (let x = Math.max(0, x0); x < Math.min(m.sx, x1); x++) if (m.get(x, y, z) >= 0) m.set(x, y, z, c);
  return m;
}

type ColorFn = (y: number, a: number, d: number, x: number, z: number) => number;

/**
 * Solide de révolution d'axe Y : rayon r(y) (voxels) pour chaque couche [y0, y1).
 * La couleur peut dépendre de la couche, de l'angle a (0 = +Z, π/2 = +X) et de la distance d à
 * l'axe ; -1 creuse, -2 laisse la case telle quelle.
 */
function lathe(m: VoxelModel, cx: number, cz: number, y0: number, y1: number, r: number | ((y: number) => number), col: number | ColorFn): VoxelModel {
  for (let y = y0; y < y1; y++) {
    const rr = typeof r === 'number' ? r : r(y);
    if (rr <= 0) continue;
    for (let x = Math.floor(cx - rr - 1); x <= Math.ceil(cx + rr); x++)
      for (let z = Math.floor(cz - rr - 1); z <= Math.ceil(cz + rr); z++) {
        const dx = x + 0.5 - cx;
        const dz = z + 0.5 - cz;
        const d = Math.hypot(dx, dz);
        if (d > rr) continue;
        const c = typeof col === 'number' ? col : col(y, Math.atan2(dx, dz), d, x, z);
        if (c === -2) continue;
        m.set(x, y, z, c);
      }
  }
  return m;
}

/** Pinceau parallélépipédique aligné sur la grille, centré sur un point continu. */
function brush(m: VoxelModel, x: number, y: number, z: number, s: readonly [number, number, number], c: number): void {
  const x0 = Math.round(x - s[0] / 2);
  const y0 = Math.round(y - s[1] / 2);
  const z0 = Math.round(z - s[2] / 2);
  m.box(x0, y0, z0, x0 + s[0], y0 + s[1], z0 + s[2], c);
}

type V3 = readonly [number, number, number];

/** Trait épais le long d'une courbe de Bézier quadratique. */
function bez(m: VoxelModel, p0: V3, p1: V3, p2: V3, s: V3, c: number): VoxelModel {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
  const n = Math.ceil(len * 3) + 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const d = t * t;
    brush(m, a * p0[0] + b * p1[0] + d * p2[0], a * p0[1] + b * p1[1] + d * p2[1], a * p0[2] + b * p1[2] + d * p2[2], s, c);
  }
  return m;
}

/** Trait épais rectiligne. */
function seg(m: VoxelModel, p0: V3, p1: V3, s: V3, c: number): VoxelModel {
  return bez(m, p0, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], p1, s, c);
}

/** Ellipsoïde dont la couleur dépend de la position relative (nx, ny, nz ∈ [-1, 1]). */
function blob(m: VoxelModel, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, col: number | ((nx: number, ny: number, nz: number, x: number, y: number, z: number) => number)): VoxelModel {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        const nz = (z + 0.5 - cz) / rz;
        if (nx * nx + ny * ny + nz * nz > 1) continue;
        const c = typeof col === 'number' ? col : col(nx, ny, nz, x, y, z);
        if (c === -2) continue;
        m.set(x, y, z, c);
      }
  return m;
}

/** Copie la moitié z ≥ c sur la moitié z < c (symétrie avant/arrière, c entier). */
function mirrorZ(m: VoxelModel, c: number): VoxelModel {
  for (let y = 0; y < m.sy; y++)
    for (let z = c; z < m.sz; z++) {
      const zm = 2 * c - 1 - z;
      if (zm < 0) continue;
      for (let x = 0; x < m.sx; x++) m.data[m.idx(x, y, zm)] = m.data[m.idx(x, y, z)];
    }
  return m;
}

/** Hachage déterministe → [0,1). */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647) + Math.imul(seed | 0, 1013904223)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffff) / 65536;
}

// ------------------------------------------------------------------ texte en pixels

type Font = Record<string, string[]>;

/** Petite police 3×5 (plaques, panneaux de rue ; M, N et W sont plus larges). */
const F3: Font = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '##.', '#..', '##.', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['###', '#.#', '#.#', '###', '..#'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '-': ['...', '...', '###', '...', '...'],
  '.': ['.', '.', '.', '.', '#'],
  '!': ['#', '#', '#', '.', '#'],
  ' ': ['.', '.', '.', '.', '.'],
};

/** Police 5×7 (enseignes au néon). */
const F5: Font = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  ' ': ['..', '..', '..', '..', '..', '..', '..'],
};

/** Cases pleines d'un texte (u vers la droite, v vers le bas) et largeur totale. */
function layout(s: string, font: Font, gap = 1): { w: number; h: number; cells: [number, number][] } {
  const cells: [number, number][] = [];
  let x = 0;
  const h = font.A.length;
  for (const ch of s) {
    const g = font[ch] ?? font[' '];
    for (let r = 0; r < g.length; r++) for (let k = 0; k < g[r].length; k++) if (g[r][k] === '#') cells.push([x + k, r]);
    x += g[0].length + gap;
  }
  return { w: x - gap, h, cells };
}

type Face = '+z' | '-z' | '+x' | '-x';

/** Pose une case de texte/pixel art : u le long de la face (sens de lecture), y vertical, w0 = plan de la face. */
function putFace(m: VoxelModel, face: Face, cu: number, u: number, y: number, w0: number, c: number): void {
  const mirror = Math.round(2 * cu) - 1 - u;
  if (face === '+z') m.set(u, y, w0, c);
  else if (face === '-z') m.set(mirror, y, w0, c);
  else if (face === '+x') m.set(w0, y, mirror, c);
  else m.set(w0, y, u, c);
}

/**
 * Écrit un texte centré sur une face. `face` : '+z' (lu depuis +Z), '-z', '+x', '-x'.
 * cu : centre horizontal de la ligne (voxels, le long de la face) ; yTop : rangée du haut ;
 * w0 : coordonnée du plan de la face.
 */
function write(m: VoxelModel, s: string, font: Font, face: Face, cu: number, yTop: number, w0: number, c: number, gap = 1): void {
  const L = layout(s, font, gap);
  const u0 = Math.round(cu - L.w / 2);
  for (const [u, v] of L.cells) putFace(m, face, cu, u0 + u, yTop - v, w0, c);
}

/** Pixel art sur une face (mêmes conventions que write ; caractères traduits par la légende). */
function art(m: VoxelModel, rows: string[], legend: Record<string, number>, face: Face, cu: number, yTop: number, w0: number): void {
  const w = Math.max(...rows.map((r) => r.length));
  const u0 = Math.round(cu - w / 2);
  for (let v = 0; v < rows.length; v++)
    for (let u = 0; u < rows[v].length; u++) {
      const c = legend[rows[v][u]];
      if (c !== undefined) putFace(m, face, cu, u0 + u, yTop - v, w0, c);
    }
}

// ================================================================== RUE

/** Tête LED « cobra » : carter allongé selon Z depuis z0 (sens dir), largeur 6, verre LED dessous. */
function cobraHead(m: VoxelModel, cx: number, y: number, z0: number, dir: 1 | -1): void {
  const zz = (a: number, b: number): [number, number] => (dir > 0 ? [z0 + a, z0 + b] : [z0 - b + 1, z0 - a + 1]);
  let [a, b] = zz(1, 12);
  rbox(m, cx - 3, y + 1, a, cx + 3, y + 4, b, K.gunmetal);
  [a, b] = zz(12, 14);
  m.box(cx - 2, y + 1, a, cx + 2, y + 3, b, K.gunmetal);
  [a, b] = zz(0, 1);
  m.box(cx - 2, y + 1, a, cx + 2, y + 4, b, K.gunmetal);
  [a, b] = zz(2, 11);
  m.box(cx - 2, y + 4, a, cx + 2, y + 5, b, K.steel);
  [a, b] = zz(2, 12);
  m.box(cx - 2, y, a, cx + 2, y + 1, b, SLOT.LED);
  // liseré cyan discret sous le carter
  [a, b] = zz(3, 10);
  m.box(cx - 3, y + 1, a, cx - 2, y + 2, b, SLOT.NEON_CYAN);
  m.box(cx + 2, y + 1, a, cx + 3, y + 2, b, SLOT.NEON_CYAN);
  // cellule photoélectrique
  [a, b] = zz(5, 7);
  m.box(cx - 1, y + 5, a, cx + 1, y + 6, b, K.black);
}

/** Lampadaire LED new-yorkais à crosse (davit) : la tête est à 2,1 m du mât, vers +Z. */
function streetLight(): VoxelModel {
  const m = new VoxelModel(6, 118, 45, R16).setOrigin(3, 0, 3);
  // socle avec trappe de visite côté trottoir
  m.box(0, 0, 0, 6, 1, 6, K.graphiteHi);
  rbox(m, 0, 1, 0, 6, 8, 6, K.graphite);
  paint(m, 1, 2, 0, 5, 6, 1, K.graphiteHi);
  m.set(2, 6, 0, SLOT.NEON_CYAN).set(3, 6, 0, SLOT.NEON_CYAN);
  m.box(0, 8, 0, 6, 10, 6, K.gunmetal);
  // fût inférieur carré (arêtes sombres), bague à anneau cyan, réduction
  squarePole(m, 1, 1, 4, 10, 74, K.graphite);
  m.box(0, 38, 0, 6, 41, 6, K.gunmetal);
  m.box(0, 39, 0, 6, 40, 6, SLOT.NEON_CYAN);
  m.box(1, 72, 1, 5, 75, 5, K.gunmetal);
  // fût supérieur et crosse
  m.box(2, 75, 2, 4, 102, 4, K.graphite);
  bez(m, [3, 100, 3], [3, 115, 3], [3, 115, 18], [2, 2, 2], K.graphite);
  m.box(2, 114, 18, 4, 116, 31, K.graphite);
  cobraHead(m, 3, 110, 30, 1);
  return m;
}

/** Lampadaire double des places (Times Square) : deux crosses opposées et deux bannières écran. */
function streetLightDouble(): VoxelModel {
  const cz = 29;
  const m = new VoxelModel(8, 118, 58, R16).setOrigin(4, 0, cz);
  // demi-modèle côté +Z (crosse, tête, bannière numérique double face) puis symétrie
  bez(m, [4, 100, cz + 1], [4, 115, cz + 1], [4, 115, cz + 12], [2, 2, 2], K.graphite);
  m.box(3, 114, cz + 12, 5, 116, cz + 17, K.graphite);
  cobraHead(m, 4, 110, cz + 16, 1);
  m.box(3, 84, cz + 2, 5, 85, cz + 12, K.gunmetal);
  m.box(3, 61, cz + 2, 5, 62, cz + 12, K.gunmetal);
  m.box(3, 62, cz + 3, 5, 84, cz + 12, K.graphite);
  m.box(3, 63, cz + 4, 5, 83, cz + 11, SLOT.SCREEN);
  mirrorZ(m, cz);
  // mât
  m.box(0, 0, cz - 4, 8, 1, cz + 4, K.graphiteHi);
  rbox(m, 0, 1, cz - 4, 8, 9, cz + 4, K.graphite);
  paint(m, 2, 2, cz - 4, 6, 7, cz - 3, K.graphiteHi);
  m.box(1, 9, cz - 3, 7, 11, cz + 3, K.gunmetal);
  squarePole(m, 2, cz - 2, 4, 11, 104, K.graphite);
  m.box(1, 40, cz - 3, 7, 43, cz + 3, K.gunmetal);
  m.box(1, 41, cz - 3, 7, 42, cz + 3, SLOT.NEON_CYAN);
  m.box(1, 78, cz - 3, 7, 81, cz + 3, K.gunmetal);
  m.box(1, 103, cz - 3, 7, 106, cz + 3, K.gunmetal);
  return m;
}

/** Lampadaire de Central Park (fût fin, socle mouluré, globe en gland) modernisé d'un anneau LED. */
function parkLamp(): VoxelModel {
  const m = new VoxelModel(6, 58, 6, R16);
  const iron = K.parkIron;
  const hi = K.parkIronHi;
  m.box(0, 0, 0, 6, 1, 6, iron);
  rbox(m, 0, 1, 0, 6, 5, 6, iron);
  paint(m, 0, 4, 0, 6, 5, 6, hi);
  m.box(1, 5, 1, 5, 9, 5, iron);
  m.box(1, 8, 1, 5, 9, 5, hi);
  m.box(2, 9, 2, 4, 44, 4, iron);
  m.box(1, 24, 1, 5, 25, 5, hi);
  m.box(1, 43, 1, 5, 45, 5, hi);
  m.cylY(3, 3, 2.6, 45, 46, SLOT.NEON_CYAN);
  m.box(2, 45, 2, 4, 46, 4, hi);
  // globe
  m.box(1, 46, 1, 5, 47, 5, SLOT.GLOW);
  rbox(m, 0, 47, 0, 6, 53, 6, SLOT.GLOW);
  m.box(1, 53, 1, 5, 54, 5, SLOT.GLOW);
  // chapeau et fleuron
  rbox(m, 0, 54, 0, 6, 55, 6, iron);
  m.box(1, 55, 1, 5, 56, 5, iron);
  m.box(2, 56, 2, 4, 58, 4, hi);
  return m;
}

/** Feu tricolore new-yorkais : mât, potence vers +Z, têtes LED double face, feux piétons. */
function trafficLight(): VoxelModel {
  const m = new VoxelModel(8, 93, 54, R16).setOrigin(4, 0, 4);
  const OFF_R = 0x3a0d0c;
  const OFF_A = 0x3d2b09;
  const OFF_G = 0x0d2a16;
  m.box(1, 0, 1, 7, 1, 7, K.graphiteHi);
  rbox(m, 1, 1, 1, 7, 6, 7, K.graphite);
  m.box(1, 6, 1, 7, 8, 7, K.gunmetal);
  squarePole(m, 2, 2, 4, 8, 92, K.graphite);
  m.box(3, 92, 3, 5, 93, 5, K.gunmetal);
  m.box(1, 80, 1, 7, 86, 7, K.gunmetal);
  // potence et tirant
  m.box(3, 82, 6, 5, 84, 52, K.graphite);
  m.box(3, 81, 51, 5, 85, 52, K.gunmetal);
  bez(m, [4, 90, 5], [4, 88, 18], [4, 84, 31], [1, 1, 1], K.gunmetal);
  // plaque de rue verte sur la potence
  m.box(3, 84, 9, 5, 91, 28, K.signGreen);
  const plate = ['#....#.......#....', '###.##.##.#.###.##', '#.#.#.#.#.#.#.#.#.', '###.##.#.#.#.###.#'];
  art(m, plate, { '#': K.white }, '-x', 18.5, 89, 3);
  art(m, plate, { '#': K.white }, '+x', 18.5, 89, 4);
  // têtes suspendues (double face ±X) : vert allumé ; optiques affleurantes, visières en saillie
  const armHead = (zc: number) => {
    m.box(3, 80, zc - 1, 5, 82, zc + 1, K.graphite);
    m.box(1, 63, zc - 3, 7, 80, zc + 3, K.black);
    const lenses: [number, number][] = [
      [75, OFF_R],
      [70, OFF_A],
      [65, SLOT.NEON_GREEN],
    ];
    for (const [y, c] of lenses) {
      m.box(1, y, zc - 2, 2, y + 4, zc + 2, c);
      m.box(6, y, zc - 2, 7, y + 4, zc + 2, c);
      m.box(0, y + 4, zc - 2, 1, y + 5, zc + 2, K.black);
      m.box(7, y + 4, zc - 2, 8, y + 5, zc + 2, K.black);
    }
  };
  armHead(34);
  armHead(47);
  // tête sur le mât (vers +Z) : rouge allumé
  m.box(3, 63, 6, 5, 65, 7, K.graphite);
  m.box(2, 46, 6, 6, 63, 10, K.black);
  const poleLenses: [number, number][] = [
    [58, SLOT.NEON_RED],
    [53, OFF_A],
    [48, OFF_G],
  ];
  for (const [y, c] of poleLenses) {
    m.box(2, y, 9, 6, y + 4, 10, c);
    m.box(2, y + 4, 10, 6, y + 5, 11, K.black);
  }
  // feux piétons : silhouette blanche vers +X, main orange vers +Z
  m.box(6, 34, 2, 8, 44, 7, K.black);
  art(m, ['..#..', '.###.', '#.#.#', '..#..', '.#.#.', '.#..#', '#...#'], { '#': SLOT.LED }, '+x', 4.5, 42, 7);
  m.box(2, 34, 6, 7, 44, 9, K.black);
  art(m, ['.#.#.', '.#.#.', '#####', '#####', '#####', '.###.', '.###.'], { '#': SLOT.NEON_AMBER }, '+z', 4.5, 42, 8);
  return m;
}

/** Bouche d'incendie new-yorkaise (1/32) : rouge, argent/jaune ; petit voyant de capteur. */
function hydrant(v: number): VoxelModel {
  const m = new VoxelModel(14, 27, 14, R32);
  const c = 7;
  const P = [
    { body: K.hydrantRed, dark: K.hydrantRedDk, top: K.hydrantRed, cap: K.hydrantSilver },
    { body: K.hydrantSilver, dark: shade(K.hydrantSilver, 0.7), top: K.hydrantYellow, cap: K.hydrantYellow },
    { body: K.hydrantRed, dark: K.hydrantRedDk, top: K.offWhite, cap: K.offWhite },
  ][v];
  const capDk = shade(P.cap, 0.72);
  const bolts: ColorFn = (_y, a) => (Math.floor(((a + Math.PI) / (2 * Math.PI)) * 16) % 2 ? shade(P.body, 1.18) : P.body);
  lathe(m, c, c, 0, 2, 6.4, P.dark);
  lathe(m, c, c, 2, 4, 4.6, P.body);
  lathe(m, c, c, 4, 6, 5.6, bolts);
  lathe(m, c, c, 6, 17, 4.6, P.body);
  lathe(m, c, c, 17, 19, 5.5, P.top);
  lathe(m, c, c, 19, 23, (y) => 5.0 * Math.sqrt(Math.max(0, 1 - ((y + 0.5 - 19) / 4.4) ** 2)), P.top);
  lathe(m, c, c, 23, 26, 1.8, P.cap);
  lathe(m, c, c, 26, 27, 1.2, capDk);
  // sorties latérales avec bouchons et chaînettes
  m.cylX(12.5, 7, 2.1, 1, 3, P.body);
  m.cylX(12.5, 7, 2.1, 11, 13, P.body);
  m.cylX(12.5, 7, 2.6, 0, 1, P.cap);
  m.cylX(12.5, 7, 2.6, 13, 14, P.cap);
  m.box(0, 12, 6, 1, 13, 8, capDk);
  m.box(13, 12, 6, 14, 13, 8, capDk);
  m.box(1, 8, 7, 2, 10, 8, K.black);
  m.box(12, 8, 7, 13, 10, 8, K.black);
  // grosse sortie avant (raccord pompier)
  m.cylZ(7, 11, 2.8, 11, 13, P.body);
  m.cylZ(7, 11, 3.2, 13, 14, P.cap);
  m.box(6, 10, 13, 8, 12, 14, capDk);
  // voyant du capteur connecté
  m.set(6, 20, 11, SLOT.NEON_GREEN).set(7, 20, 11, SLOT.NEON_GREEN);
  return m;
}

/** Corbeille new-yorkaise en grillage vert, sac noir et déchets. */
function litterBasket(v: number): VoxelModel {
  const m = new VoxelModel(10, 16, 10, R16);
  const c = 5;
  const g = K.basketGreen;
  const gd = K.basketGreenDk;
  const bag = 0x1b1c1e;
  const r = (y: number) => 4.3 + (y / 15) * 0.7;
  lathe(m, c, c, 0, 14, r, (y, a, d) => {
    const rr = r(y);
    const band = y < 1 || y === 7 || y >= 12;
    if (d > rr - 1) {
      if (band) return g;
      const k = Math.round(((a + Math.PI) / (2 * Math.PI)) * 16);
      return k % 2 ? g : -1;
    }
    if (y < 1) return g;
    return d > rr - 2 ? (band ? gd : bag) : -2;
  });
  // rebord roulé, sac rabattu, déchets
  lathe(m, c, c, 14, 16, 5.0, (y, _a, d) => (d > 3.9 ? (y === 15 ? g : gd) : -2));
  lathe(m, c, c, 12, 15, 3.9, (y, _a, d) => (y === 14 && d < 2.9 ? -2 : bag));
  const trash: [number, number, number, number][] =
    v === 0
      ? [
          [3, 14, 4, K.white],
          [4, 14, 4, K.white],
          [5, 14, 6, 0xc9b48a],
          [6, 14, 5, 0xd04a32],
        ]
      : [
          [4, 14, 5, 0xd8d0b8],
          [5, 14, 5, 0xd8d0b8],
          [5, 14, 3, 0x3d6fb0],
          [3, 14, 6, 0x9a6a3a],
        ];
  for (const [x, y, z, col] of trash) m.set(x, y, z, col);
  return m;
}

/** Poubelle compacteuse solaire (1/32) : grande trémie avant, voyants, panneau solaire incliné. */
function solarBin(): VoxelModel {
  const m = new VoxelModel(19, 32, 19, R32);
  const body = 0x22463a;
  const bodyHi = 0x2f5c4c;
  rbox(m, 1, 0, 1, 18, 2, 17, K.graphite);
  rbox(m, 1, 2, 1, 18, 26, 17, body);
  // trémie : volet clair, ouverture sombre, poignée chromée
  m.box(3, 10, 17, 16, 24, 18, bodyHi);
  m.box(4, 17, 17, 15, 21, 18, K.black);
  m.box(3, 22, 18, 16, 23, 19, K.chrome);
  m.box(3, 21, 18, 4, 23, 19, K.chrome);
  m.box(15, 21, 18, 16, 23, 19, K.chrome);
  // porte de service (joints) et voyants de remplissage
  m.box(3, 3, 17, 16, 4, 18, shade(body, 0.7));
  m.box(9, 4, 17, 10, 9, 18, shade(body, 0.7));
  m.set(5, 7, 17, SLOT.NEON_GREEN).set(6, 7, 17, SLOT.NEON_GREEN).set(13, 7, 17, K.graphiteHi);
  // bandes argentées latérales
  m.box(1, 6, 8, 2, 22, 10, K.alu);
  m.box(17, 6, 8, 18, 22, 10, K.alu);
  // panneau solaire incliné vers l'avant
  for (let z = 1; z < 17; z++) {
    const top = 26 + Math.round(((17 - z) * 4) / 16);
    m.box(1, 26, z, 18, top, z + 1, body);
    const cell = z % 4 === 0 ? 0x8a96a8 : 0x1a2846;
    m.box(2, top, z, 17, top + 1, z + 1, cell);
    for (let x = 2; x < 17; x += 5) m.set(x, top, z, 0x8a96a8);
    m.set(1, top, z, K.alu).set(17, top, z, K.alu);
  }
  return m;
}

/** Boîte aux lettres bleue réinventée en consigne à colis pour drones. */
function droneLocker(): VoxelModel {
  const m = new VoxelModel(10, 20, 10, R16);
  const B = K.mailBlue;
  for (const [x, z] of [
    [1, 1],
    [7, 1],
    [1, 7],
    [7, 7],
  ])
    m.box(x, 0, z, x + 2, 3, z + 2, K.graphite);
  rbox(m, 0, 3, 0, 10, 15, 10, B);
  m.cylX(15, 5, 5, 0, 10, B);
  m.box(0, 3, 0, 10, 4, 10, K.mailBlueDk);
  // façade : casiers (portes en retrait, voyants) et écran
  const door = (x0: number, y0: number, led: number) => {
    m.box(x0, y0, 9, x0 + 4, y0 + 4, 10, -1);
    m.box(x0, y0, 8, x0 + 4, y0 + 4, 9, K.mailBlueHi);
    m.set(x0 + 3, y0 + 3, 8, led);
    m.set(x0, y0 + 1, 8, K.alu).set(x0, y0 + 2, 8, K.alu);
  };
  door(1, 5, SLOT.NEON_GREEN);
  door(5, 5, SLOT.NEON_RED);
  door(1, 10, SLOT.NEON_GREEN);
  m.box(5, 10, 9, 9, 14, 10, K.black);
  m.box(6, 11, 9, 9, 14, 10, SLOT.SCREEN);
  // fente de dépôt et poignée chromée (la « goulotte » d'origine)
  m.box(2, 15, 9, 8, 16, 10, K.black);
  m.box(2, 16, 9, 8, 17, 10, K.chrome);
  // trappe de drone sur le dessus, balisée en cyan
  m.box(3, 19, 3, 7, 20, 7, K.mailBlueHi);
  m.set(2, 19, 3, SLOT.NEON_CYAN).set(7, 19, 3, SLOT.NEON_CYAN).set(2, 19, 6, SLOT.NEON_CYAN).set(7, 19, 6, SLOT.NEON_CYAN);
  // bande blanche latérale
  m.box(0, 12, 1, 1, 13, 9, K.white);
  m.box(9, 12, 1, 10, 13, 9, K.white);
  return m;
}

/** Plaque d'égout : cadre, anneau et quadrillage en relief, trous de vapeur. */
function manhole(m: VoxelModel, c: number, holes: boolean): void {
  lathe(m, c, c, 0, 1, 6.4, (_y, _a, d) => (d > 5.7 ? K.ironCoverHi : K.ironCover));
  lathe(m, c, c, 1, 2, 5.1, (_y, _a, d, x, z) => {
    if (d > 4.2) return K.ironCoverHi;
    if (holes && d < 3.4 && (x + z) % 3 === 0) return K.ironCoverHi;
    return -2;
  });
  if (holes)
    for (const [x, z] of [
      [5, 5],
      [8, 5],
      [5, 8],
      [8, 8],
      [6, 3],
      [3, 7],
    ])
      m.set(x, 0, z, K.soot).clear(x, 1, z);
}

/** Bouche de vapeur : cheminée rayée orange et blanc posée sur la plaque (variante 1 : plaque seule). */
function steamVent(v: number): VoxelModel {
  if (v === 1) {
    const m = new VoxelModel(13, 2, 13, R16);
    manhole(m, 6.5, true);
    return m;
  }
  const m = new VoxelModel(13, 29, 13, R16);
  const c = 6.5;
  manhole(m, c, false);
  lathe(m, c, c, 1, 6, (y) => 5.6 - (y - 1) * 0.5, (y) => (y === 2 ? K.white : K.safetyOrange));
  lathe(m, c, c, 6, 27, 3.1, (y) => (y % 5 === 3 || y % 5 === 4 ? K.white : K.safetyOrange));
  lathe(m, c, c, 27, 29, 3.5, K.safetyOrange);
  lathe(m, c, c, 26, 29, 2.2, -1);
  lathe(m, c, c, 25, 26, 2.2, K.soot);
  return m;
}

/** Totem d'information (façon LinkNYC 2085) : écrans double face, bandeau, logo holographique. */
function holoKiosk(): VoxelModel {
  const m = new VoxelModel(19, 40, 13, R16);
  // socle souligné d'un liseré cyan
  rbox(m, 1, 0, 2, 18, 2, 11, K.graphite);
  paint(m, 1, 1, 2, 18, 2, 11, SLOT.NEON_CYAN);
  m.box(2, 1, 3, 17, 2, 10, K.graphite);
  // monolithe et tranches chromées
  m.box(3, 2, 4, 16, 33, 9, K.graphite);
  m.box(3, 2, 4, 4, 28, 9, K.chrome);
  m.box(15, 2, 4, 16, 28, 9, K.chrome);
  // écrans avant / arrière et bandeau « NYC »
  for (const z of [8, 4]) {
    m.box(4, 7, z, 15, 26, z + 1, SLOT.SCREEN);
    m.box(4, 6, z, 15, 7, z + 1, SLOT.NEON_CYAN);
    write(m, 'NYC', F3, z === 8 ? '+z' : '-z', 9.5, 31, z, SLOT.LED);
  }
  // côté droit : bouton d'appel d'urgence et prises ; côté gauche : haut-parleur
  m.box(16, 12, 5, 17, 20, 8, K.gunmetal);
  m.set(16, 18, 6, SLOT.NEON_RED).set(16, 18, 7, SLOT.NEON_RED);
  m.set(16, 14, 6, K.black).set(16, 14, 7, K.black).set(16, 15, 6, K.black).set(16, 15, 7, K.black);
  m.box(2, 19, 5, 3, 25, 8, K.gunmetal);
  for (let y = 20; y < 25; y += 2) m.box(2, y, 5, 3, y + 1, 8, K.black);
  // chapeau, émetteur et épingle holographique flottante
  m.box(3, 33, 4, 16, 34, 9, K.gunmetal);
  m.box(8, 34, 6, 11, 35, 7, SLOT.NEON_CYAN);
  art(m, ['.###.', '##.##', '.###.', '..#..'], { '#': SLOT.NEON_CYAN }, '+z', 9.5, 39, 6);
  return m;
}

/** Distributeur automatique : vitrine de produits éclairée, écran tactile, liserés néon (variante). */
function vendingMachine(v: number): VoxelModel {
  const m = new VoxelModel(16, 32, 13, R16);
  const body = v === 0 ? K.graphite : 0xd3d6d9;
  const bodyDk = shade(body, 0.72);
  for (const [x, z] of [
    [1, 1],
    [13, 1],
    [1, 9],
    [13, 9],
  ])
    m.box(x, 0, z, x + 2, 1, z + 2, K.black);
  m.box(0, 1, 0, 16, 32, 12, body);
  m.box(0, 31, 0, 16, 32, 12, bodyDk);
  // vitrine en retrait : fond sombre, étagères LED, produits
  m.box(1, 9, 10, 11, 29, 12, -1);
  m.box(1, 9, 9, 11, 29, 10, 0x0d0e11);
  const prods = [
    [0xc8302a, 0xe8e6e0, 0xc8302a, 0x2a5ab8, 0x2a5ab8],
    [0x3a9a4a, 0xe07a20, 0x3a9a4a, 0xe8c830, 0x7a3ab0],
    [0x101010, 0xe8e6e0, 0xc8302a, 0x48b8d8, 0x48b8d8],
    [0xe07a20, 0xe07a20, 0x7a3ab0, 0x3a9a4a, 0xe8e6e0],
    [0x2a5ab8, 0xc8302a, 0xe8c830, 0xe8c830, 0x101010],
  ];
  for (let r = 0; r < 5; r++) {
    const y0 = 9 + r * 4;
    m.box(1, y0, 10, 11, y0 + 1, 11, SLOT.LED);
    for (let k = 0; k < 5; k++) {
      const tall = (r + k) % 3 === 0;
      m.box(1 + k * 2, y0 + 1, 10, 2 + k * 2, y0 + (tall ? 4 : 3), 11, prods[r][k]);
    }
  }
  // cadre néon de la vitrine et arêtes avant
  m.box(0, 8, 11, 12, 9, 12, SLOT.NEON);
  m.box(0, 29, 11, 12, 30, 12, SLOT.NEON);
  m.box(0, 1, 11, 1, 31, 12, SLOT.NEON);
  m.box(11, 9, 11, 12, 29, 12, SLOT.NEON);
  m.box(15, 1, 11, 16, 31, 12, SLOT.NEON);
  // colonne de commande : écran, terminal de paiement, fente
  m.box(12, 19, 11, 15, 27, 12, SLOT.SCREEN);
  m.box(12, 14, 11, 15, 18, 12, K.black);
  m.set(13, 16, 12, SLOT.NEON_GREEN);
  m.box(13, 12, 11, 14, 13, 12, K.black);
  // bac de distribution
  m.box(2, 3, 10, 10, 7, 12, -1);
  m.box(2, 3, 9, 10, 7, 10, 0x0d0e11);
  m.box(2, 6, 11, 10, 7, 12, bodyDk);
  // fronton : bandeau néon et pictogramme
  m.box(1, 30, 11, 15, 31, 12, SLOT.NEON);
  m.box(12, 28, 11, 15, 29, 12, SLOT.LED);
  return m;
}

/** Roue pleine dans le plan XY (pneu, jante, moyeu). */
function wheelXY(m: VoxelModel, cx: number, cy: number, z0: number, z1: number, r: number, tyre: number, rim: number, hub: number): void {
  for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r); x++)
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r); y++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const c = d > r - 1.2 ? tyre : d > r * 0.45 ? rim : hub;
      m.box(x, y, z0, x + 1, y + 1, z1, c);
    }
}

/** Chariot de street-food (halal / hot-dogs) : inox, plancha rougeoyante, bain-marie, menu écran, parasol rayé. */
function foodCart(v: number): VoxelModel {
  const m = new VoxelModel(32, 38, 30, R16).setOrigin(16, 0, 15);
  const ss = K.alu;
  const ssDk = 0x8a929a;
  const ssHi = K.chrome;
  const umb = [
    [0x1f4fa8, 0xf2c12e],
    [0xc0262a, 0xeeeeea],
    [0x2a7a3a, 0xeeeeea],
  ][v];
  // roues, timon, béquille
  wheelXY(m, 9, 3.5, 6, 7, 3.6, K.rubber, K.steel, K.alu);
  wheelXY(m, 9, 3.5, 23, 24, 3.6, K.rubber, K.steel, K.alu);
  m.box(8, 3, 7, 10, 4, 23, K.graphite);
  m.box(0, 5, 14, 3, 6, 16, K.graphite);
  m.box(0, 4, 14, 1, 6, 16, K.graphite);
  m.box(25, 0, 13, 27, 4, 17, K.graphite);
  // caisse inox, plinthe, écran menu côté client
  m.box(3, 4, 8, 29, 16, 22, ss);
  m.box(3, 4, 8, 29, 6, 22, ssDk);
  for (let x = 6; x < 29; x += 6) m.box(x, 6, 21, x + 1, 16, 22, ssDk);
  m.box(4, 8, 22, 28, 14, 23, K.graphite);
  m.box(5, 9, 22, 27, 13, 23, SLOT.SCREEN);
  m.box(3, 15, 22, 29, 16, 23, SLOT.GLOW);
  // comptoir
  m.box(2, 16, 7, 30, 17, 24, ssHi);
  // plancha : plaque sombre, braises au bord, viande, oignons, poivrons, pains pita
  m.box(4, 17, 11, 16, 18, 21, 0x2a2826);
  m.box(4, 17, 21, 16, 18, 22, SLOT.GLOW);
  const food: [number, number, number][] = [
    [5, 12, 0x7a4424],
    [6, 13, 0x8a5230],
    [7, 12, 0x7a4424],
    [8, 14, 0x8a5230],
    [6, 15, 0x7a4424],
    [9, 13, 0xd8c890],
    [10, 15, 0xd8c890],
    [11, 13, 0xb83a2a],
    [12, 16, 0x3a8a3a],
    [10, 17, 0x8a5230],
    [7, 17, 0xd8c890],
    [13, 12, 0xc89a5a],
    [14, 12, 0xc89a5a],
    [13, 13, 0xc89a5a],
    [14, 13, 0xc89a5a],
  ];
  for (const [x, z, c] of food) m.set(x, 18, z, c);
  // bain-marie à couvercles, saucisses
  m.box(18, 17, 11, 28, 18, 21, ss);
  m.box(18, 18, 11, 23, 19, 16, ssDk);
  m.box(23, 18, 16, 28, 19, 21, ssDk);
  for (let x = 19; x < 23; x += 2) m.box(x, 18, 17, x + 1, 19, 20, 0xb0603a);
  m.box(24, 18, 12, 27, 19, 15, 0xd8a050);
  // condiments et distributeur de serviettes
  m.box(17, 17, 21, 18, 20, 22, 0xc8201a);
  m.box(17, 17, 19, 18, 20, 20, 0xe8c020);
  m.box(29, 17, 20, 30, 19, 22, K.white);
  // menu lumineux au fond du comptoir
  m.box(5, 17, 8, 27, 24, 9, K.graphite);
  m.box(6, 18, 8, 26, 23, 9, SLOT.SCREEN);
  // parasol rayé : mât, toile conique en 8 pans, guirlande d'ampoules au bord
  m.box(15, 17, 14, 17, 37, 16, K.alu);
  for (let x = 0; x < 32; x++)
    for (let z = 0; z < 30; z++) {
      const d = Math.hypot(x + 0.5 - 16, z + 0.5 - 15);
      if (d > 15) continue;
      const y = 36 - Math.round((d / 15) * 4.4);
      const a = Math.atan2(x + 0.5 - 16, z + 0.5 - 15);
      const k = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 8 + 0.5) % 2;
      m.set(x, y, z, k ? umb[0] : umb[1]);
    }
  m.box(15, 37, 14, 17, 38, 16, K.alu);
  for (const [x, z] of [
    [6, 26],
    [11, 28],
    [16, 29],
    [21, 28],
    [26, 26],
  ])
    m.set(x, 30, z, SLOT.GLOW);
  return m;
}

/** Banc de parc new-yorkais (fonte et lattes de bois) ou banc moderne béton/bois à liseré lumineux. */
function bench(v: number): VoxelModel {
  const m = new VoxelModel(29, 14, 10, R16);
  const wood = 0x8a5a32;
  const woodHi = 0x9e6c3e;
  if (v === 1) {
    rbox(m, 2, 0, 2, 7, 6, 9, K.concrete);
    rbox(m, 22, 0, 2, 27, 6, 9, K.concrete);
    m.box(0, 6, 1, 29, 8, 10, wood);
    for (let x = 1; x < 29; x += 4) m.box(x, 7, 1, x + 1, 8, 10, shade(wood, 0.82));
    m.box(0, 6, 1, 29, 7, 10, woodHi);
    m.box(7, 5, 8, 22, 6, 9, SLOT.NEON_CYAN);
    return m;
  }
  const iron = K.parkIron;
  for (const [x0, x1] of [
    [0, 2],
    [14, 15],
    [27, 29],
  ]) {
    m.box(x0, 0, 7, x1, 7, 9, iron);
    m.box(x0, 0, 1, x1, 7, 3, iron);
    m.box(x0, 6, 1, x1, 7, 9, iron);
    m.box(x0, 7, 1, x1, 9, 2, iron);
    m.box(x0, 9, 0, x1, 14, 1, iron);
    // accoudoir (sur les côtés et au milieu, anti-couchage)
    m.box(x0, 10, 2, x1, 11, 9, iron);
    m.box(x0, 7, 8, x1, 10, 9, iron);
  }
  for (const z of [3, 5, 7]) m.box(0, 7, z, 29, 8, z + 1, z === 7 ? woodHi : wood);
  m.box(0, 9, 1, 29, 10, 2, wood);
  m.box(0, 11, 0, 29, 12, 1, wood);
  m.box(0, 13, 0, 29, 14, 1, woodHi);
  return m;
}

/** Borne anti-bélier en inox (1/32) à anneau LED. */
function bollard(): VoxelModel {
  const m = new VoxelModel(10, 29, 10, R32);
  const c = 5;
  const inox = 0xa8b0b8;
  lathe(m, c, c, 0, 2, 4.9, K.graphite);
  lathe(m, c, c, 2, 24, 4.3, inox);
  lathe(m, c, c, 5, 6, 4.5, K.steel);
  lathe(m, c, c, 20, 22, 4.5, SLOT.NEON_CYAN);
  lathe(m, c, c, 24, 29, (y) => 4.3 * Math.sqrt(Math.max(0, 1 - ((y + 0.5 - 23.5) / 5.6) ** 2)), inox);
  return m;
}

/** Vélo électrique en libre-service (1/32), le long de X, roue arrière en xr. */
function eBike(m: VoxelModel, xr: number, z0: number, frame: number): void {
  const xf = xr + 30;
  const zc = z0 + 1;
  const ring = (cx: number) => {
    for (let x = cx - 10; x <= cx + 10; x++)
      for (let y = 0; y < 21; y++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - 10);
        if (d > 9.6) continue;
        let c = -1;
        if (d > 8.2) c = K.rubber;
        else if (d > 7.2) c = K.alu;
        else if (d < 1.6) c = K.gunmetal;
        else {
          const a = Math.atan2(y + 0.5 - 10, x + 0.5 - cx);
          const k = Math.round(a / ((Math.PI * 2) / 3));
          if (Math.abs(Math.sin(a - (k * Math.PI * 2) / 3)) * d < 0.8) c = K.alu;
        }
        if (c >= 0) m.box(x, y, z0, x + 1, y + 1, z0 + 2, c);
      }
  };
  ring(xr);
  ring(xf);
  const s2: V3 = [1, 1, 2];
  const bb: V3 = [xr + 11, 8, zc];
  seg(m, bb, [xr + 8, 21, zc], s2, frame);
  seg(m, bb, [xf - 4, 18, zc], [2, 2, 2], frame);
  seg(m, [xr + 8, 19, zc], [xf - 4, 20, zc], s2, frame);
  seg(m, bb, [xr, 10, zc], s2, frame);
  seg(m, [xr + 8, 19, zc], [xr, 10, zc], s2, frame);
  seg(m, [xf - 4, 22, zc], [xf, 10, zc], s2, frame);
  // batterie, selle, guidon, panier avant, éclairages
  seg(m, [xr + 13, 10, zc], [xf - 7, 16, zc], [3, 3, 2], K.graphite);
  m.box(xr + 5, 22, z0, xr + 11, 23, z0 + 2, K.black);
  m.box(xr + 8, 20, z0, xr + 9, 22, z0 + 2, K.gunmetal);
  m.box(xf - 5, 22, z0, xf - 3, 25, z0 + 2, K.gunmetal);
  m.box(xf - 5, 25, z0 - 4, xf - 3, 26, z0 + 6, K.gunmetal);
  m.box(xf - 5, 25, z0 - 4, xf - 3, 26, z0 - 2, K.black);
  m.box(xf - 5, 25, z0 + 4, xf - 3, 26, z0 + 6, K.black);
  m.box(xf - 2, 18, z0 - 2, xf + 4, 19, z0 + 4, K.alu);
  m.box(xf - 2, 19, z0 - 2, xf + 4, 22, z0 - 1, K.alu);
  m.box(xf - 2, 19, z0 + 3, xf + 4, 22, z0 + 4, K.alu);
  m.box(xf + 3, 19, z0 - 2, xf + 4, 22, z0 + 4, K.alu);
  m.box(xf + 4, 16, z0, xf + 5, 18, z0 + 2, SLOT.LED);
  m.box(xr - 9, 13, z0, xr - 8, 15, z0 + 2, SLOT.NEON_RED);
  // garde-boue
  seg(m, [xr - 8, 13, zc], [xr, 20, zc], s2, frame);
  seg(m, [xf + 7, 14, zc], [xf, 20, zc], s2, frame);
}

/** Trottinette électrique (1/32) le long de X à partir de x0. */
function eScooter(m: VoxelModel, x0: number, z0: number, col: number): void {
  m.box(x0 + 3, 2, z0 - 1, x0 + 19, 4, z0 + 3, col);
  m.box(x0 + 4, 4, z0 - 1, x0 + 18, 5, z0 + 3, K.black);
  wheelXY(m, x0 + 2.5, 3, z0, z0 + 2, 3, K.rubber, K.gunmetal, K.alu);
  wheelXY(m, x0 + 20.5, 3, z0, z0 + 2, 3, K.rubber, K.gunmetal, K.alu);
  seg(m, [x0 + 20.5, 4, z0 + 1], [x0 + 18.5, 26, z0 + 1], [2, 1, 2], col);
  m.box(x0 + 18, 26, z0 - 4, x0 + 20, 27, z0 + 6, K.gunmetal);
  m.box(x0 + 18, 26, z0 - 4, x0 + 20, 27, z0 - 2, K.black);
  m.box(x0 + 18, 26, z0 + 4, x0 + 20, 27, z0 + 6, K.black);
  m.box(x0 + 20, 21, z0, x0 + 21, 23, z0 + 2, SLOT.LED);
  m.box(x0 + 1, 4, z0, x0 + 3, 5, z0 + 2, SLOT.NEON_RED);
}

/** Station de vélos et trottinettes électriques en libre-service (1/32). */
function bikeRack(v: number): VoxelModel {
  const m = new VoxelModel(64, 29, 16, R32);
  const share = 0x1e8a9a;
  m.box(1, 0, 1, 63, 2, 6, K.graphite);
  m.box(1, 1, 1, 63, 2, 2, SLOT.NEON_CYAN);
  const posts = [8, 32, 56];
  const busy = v === 0 ? [true, true, false] : v === 1 ? [true, true, false] : [false, true, false];
  posts.forEach((x, i) => {
    m.box(x - 2, 2, 1, x + 2, 19, 6, K.gunmetal);
    m.box(x - 2, 17, 6, x + 2, 19, 7, K.graphite);
    m.box(x - 1, 15, 6, x + 1, 16, 7, busy[i] ? SLOT.NEON_GREEN : SLOT.NEON_AMBER);
    m.box(x - 2, 19, 1, x + 2, 20, 6, share);
    if (busy[i]) m.box(x - 1, 9, 6, x + 1, 11, 9, K.graphite);
  });
  if (v === 0) eBike(m, 12, 9, K.white);
  else if (v === 1) {
    eScooter(m, 4, 9, share);
    eScooter(m, 30, 9, K.white);
  } else eScooter(m, 26, 9, share);
  return m;
}

/** Ancienne cabine téléphonique devenue cabine d'holo-appel : vitrée, bandeau « HOLO », hologramme. */
function holoBooth(): VoxelModel {
  const m = new VoxelModel(16, 37, 16, R16);
  const frame = K.alu;
  m.box(0, 0, 0, 16, 1, 16, K.graphite);
  for (const [x, z] of [
    [0, 0],
    [14, 0],
    [0, 14],
    [14, 14],
  ])
    m.box(x, 1, z, x + 2, 31, z + 2, frame);
  // dos et côtés : soubassement métallique, vitres, lisse haute
  m.box(2, 1, 0, 14, 6, 1, K.steel);
  m.box(2, 6, 0, 14, 29, 1, SLOT.GLASS);
  m.box(2, 29, 0, 14, 31, 1, frame);
  for (const x of [0, 15]) {
    m.box(x, 1, 2, x + 1, 6, 14, K.steel);
    m.box(x, 6, 2, x + 1, 29, 14, SLOT.GLASS);
    m.box(x, 29, 2, x + 1, 31, 14, frame);
    m.box(x, 17, 2, x + 1, 18, 14, frame);
  }
  m.box(2, 17, 0, 14, 18, 1, frame);
  // porte pliante ouverte (vantaux repliés contre les montants)
  m.box(2, 1, 14, 3, 30, 16, frame);
  m.box(13, 1, 14, 14, 30, 16, frame);
  m.box(2, 29, 15, 14, 31, 16, frame);
  // console d'appel : tablette et écran au fond
  m.box(4, 15, 1, 12, 16, 4, K.gunmetal);
  m.box(5, 19, 1, 11, 26, 2, SLOT.SCREEN);
  // anneau projecteur au sol et hologramme à lignes de balayage
  lathe(m, 8, 8, 1, 2, 4.6, (_y, _a, d) => (d > 3.4 ? SLOT.NEON_CYAN : K.gunmetal));
  const fig = [
    '..###..',
    '..###..',
    '..###..',
    '...#...',
    '.#####.',
    '#######',
    '#.###.#',
    '#.###.#',
    '#.###.#',
    '#.###.#',
    '..###..',
    '..###..',
    '..#.#..',
    '..#.#..',
    '..#.#..',
    '..#.#..',
    '..#.#..',
    '..#.#..',
    '..#.#..',
    '.##.##.',
  ];
  const holo = new VoxelModel(16, 37, 16, R16);
  art(holo, fig, { '#': SLOT.NEON_CYAN }, '+z', 8, 25, 7);
  art(holo, fig, { '#': SLOT.NEON_CYAN }, '+z', 8, 25, 8);
  for (let y = 0; y < 37; y += 2) holo.box(0, y, 0, 16, y + 1, 16, -1);
  m.paste(holo, 0, 0, 0);
  m.box(6, 29, 6, 10, 30, 10, SLOT.LED);
  // bandeau « HOLO » lumineux sur les quatre faces et toit
  m.box(0, 31, 0, 16, 36, 16, K.graphite);
  write(m, 'HOLO', F3, '+z', 8, 35, 15, SLOT.NEON_CYAN);
  write(m, 'HOLO', F3, '-z', 8, 35, 0, SLOT.NEON_CYAN);
  write(m, 'HOLO', F3, '+x', 8, 35, 15, SLOT.NEON_CYAN);
  write(m, 'HOLO', F3, '-x', 8, 35, 0, SLOT.NEON_CYAN);
  m.box(1, 36, 1, 15, 37, 15, K.gunmetal);
  return m;
}

/** Couleur de feuillage par petits blocs (2 voxels) pour garder des faces fusionnables. */
function leafCol(base: number, seed: number): (nx: number, ny: number, nz: number, x: number, y: number, z: number) => number {
  return (_nx, ny, _nz, x, y, z) => {
    const h = hash3(x >> 1, y >> 1, z >> 1, seed);
    const f = ny > 0.35 ? 1.18 : ny < -0.3 ? 0.78 : 1;
    return shade(base, f * (h < 0.33 ? 0.86 : h < 0.66 ? 1 : 1.12));
  };
}

/** Jardinière (béton, acier Corten ou granit) avec buis, graminées ou arbuste fleuri. */
function planter(v: number): VoxelModel {
  const m = new VoxelModel(19, 13, 19, R16);
  const box = [K.concrete, 0x7a4426, 0x45484d][v];
  rbox(m, 0, 0, 0, 19, 8, 19, box);
  m.box(1, 7, 1, 18, 8, 18, shade(box, 1.12));
  m.box(2, 2, 2, 17, 8, 17, -1);
  m.box(2, 2, 2, 17, 7, 17, 0x3a2a1c);
  paint(m, 1, 0, 18, 18, 1, 19, SLOT.NEON_CYAN);
  if (v === 0) {
    blob(m, 9.5, 9, 9.5, 7.5, 4.6, 7.5, leafCol(0x3a6a2c, 3));
    blob(m, 6, 10.5, 7, 3.5, 2.8, 3.5, leafCol(0x467a34, 4));
  } else if (v === 1) {
    for (let x = 3; x < 16; x++)
      for (let z = 3; z < 16; z++) {
        const h = hash3(x, 0, z, 9);
        if (h < 0.45) continue;
        const top = 8 + Math.floor(hash3(x, 1, z, 9) * 5);
        m.box(x, 7, z, x + 1, top, z + 1, h > 0.8 ? 0xb8b060 : 0x7a9a40);
        m.set(x, top - 1, z, h > 0.7 ? 0xd8c880 : 0x9ab050);
      }
  } else {
    blob(m, 9.5, 9.5, 9.5, 7, 5, 7, (nx, ny, nz, x, y, z) => (hash3(x, y, z, 5) > 0.82 && ny > -0.2 ? (hash3(x, y, z, 6) > 0.5 ? 0xe86aa0 : 0xf4e8f0) : leafCol(0x2f5a26, 7)(nx, ny, nz, x, y, z)));
  }
  return m;
}

/** Lampadaire de métro (1/32) : fût vert sombre cannelé et globe vert lumineux (« ouvert 24 h/24 »). */
function subwayGlobe(): VoxelModel {
  const m = new VoxelModel(11, 90, 11, R32);
  const c = 5.5;
  const g = 0x1d3a29;
  const gHi = 0x2d5640;
  lathe(m, c, c, 0, 3, 5.4, g);
  lathe(m, c, c, 3, 5, 4.7, gHi);
  lathe(m, c, c, 5, 13, (y) => 4.3 - (y - 5) * 0.1, g);
  lathe(m, c, c, 13, 15, 3.7, gHi);
  m.box(3, 15, 3, 8, 70, 8, g);
  for (const [x, z] of [
    [5, 3],
    [5, 7],
    [3, 5],
    [7, 5],
  ])
    m.box(x, 17, z, x + 1, 68, z + 1, gHi);
  lathe(m, c, c, 40, 42, 3.4, gHi);
  lathe(m, c, c, 68, 71, 3.4, gHi);
  lathe(m, c, c, 71, 77, (y) => 2.2 + (y - 71) * 0.55, g);
  m.sphere(c, 83, c, 5.6, SLOT.NEON_GREEN);
  lathe(m, c, c, 87, 89, 2.4, g);
  lathe(m, c, c, 89, 90, 1.2, gHi);
  return m;
}

/** Garde-corps du front de mer : poteau, câbles, main courante soulignée de LED. */
function railing(): VoxelModel {
  const m = new VoxelModel(32, 18, 2, R16);
  m.box(0, 0, 0, 2, 18, 2, K.graphite);
  m.box(0, 16, 0, 32, 18, 2, K.gunmetal);
  m.box(2, 15, 0, 32, 16, 2, SLOT.LED);
  for (const y of [4, 8, 12]) m.box(2, y, 0, 32, y + 1, 1, K.steelHi);
  return m;
}

/** Tag de graffiti : lettres 3×5 agrandies avec contour, peintes sur la surface la plus en avant (±Z). */
function tag(m: VoxelModel, s: string, cx: number, yTop: number, face: '+z' | '-z', fill: number, outline: number, scale = 2): void {
  const L = layout(s, F3, 1);
  const w = L.w * scale;
  const cells = new Set<string>();
  for (const [u, v] of L.cells) for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) cells.add(`${u * scale + a},${v * scale + b}`);
  const put = (u: number, v: number, c: number) => {
    const x = face === '+z' ? Math.round(cx - w / 2) + u : Math.round(cx + w / 2) - 1 - u;
    const y = yTop - v;
    if (face === '+z') {
      for (let z = m.sz - 1; z >= 0; z--)
        if (m.get(x, y, z) >= 0) {
          m.set(x, y, z, c);
          return;
        }
    } else
      for (let z = 0; z < m.sz; z++)
        if (m.get(x, y, z) >= 0) {
          m.set(x, y, z, c);
          return;
        }
  };
  for (const k of cells) {
    const [u, v] = k.split(',').map(Number);
    for (const [du, dv] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      if (!cells.has(`${u + du},${v + dv}`)) put(u + du, v + dv, outline);
  }
  for (const k of cells) {
    const [u, v] = k.split(',').map(Number);
    put(u, v, fill);
  }
}

/** Glissière en béton type « Jersey » : profil évasé, saignées, bandeau LED de danger. */
function jerseyBarrier(v: number): VoxelModel {
  const m = new VoxelModel(32, 14, 10, R16);
  const conc = v === 1 ? 0xe2e0da : K.concrete;
  const half = (y: number) => (y < 2 ? 5 : y < 4 ? 4 : y < 8 ? 3 : 2);
  for (let y = 0; y < 14; y++) {
    const h = half(y);
    m.box(0, y, 5 - h, 32, y + 1, 5 + h, conc);
  }
  // extrémités chanfreinées, saignées d'écoulement, trous de levage
  m.box(0, 12, 0, 1, 14, 10, -1);
  m.box(31, 12, 0, 32, 14, 10, -1);
  m.box(6, 0, 0, 10, 2, 10, -1);
  m.box(22, 0, 0, 26, 2, 10, -1);
  m.box(15, 9, 0, 17, 11, 10, -1);
  // traînées de crasse
  for (const x of [3, 12, 19, 28]) paint(m, x, 0, 0, x + 1, 9, 10, shade(conc, 0.88));
  if (v === 1) {
    // bandes obliques orange (chantier)
    for (let x = 0; x < 32; x++)
      for (let y = 4; y < 12; y++) if (((x + y) >> 2) % 2 === 0) for (const z of [2, 3, 6, 7]) if (m.get(x, y, z) >= 0 && (m.get(x, y, z - 1) < 0 || m.get(x, y, z + 1) < 0)) m.set(x, y, z, K.safetyOrange);
  }
  if (v === 2) {
    tag(m, 'KAOS', 16, 10, '+z', 0xe23a8a, 0xf0f0f0, 1);
    tag(m, 'REX', 14, 10, '-z', 0x38c8e0, 0x151515, 1);
  }
  // bandeau LED de danger (tirets ambre) sur les deux faces
  for (let x = 2; x < 30; x++)
    if (x % 4 !== 3) {
      m.set(x, 12, 3, SLOT.NEON_AMBER);
      m.set(x, 12, 6, SLOT.NEON_AMBER);
    }
  return m;
}

/** Cône de signalisation (1/32) : base carrée, bande réfléchissante, anneau LED. */
function trafficCone(): VoxelModel {
  const m = new VoxelModel(13, 22, 13, R32);
  const c = 6.5;
  rbox(m, 0, 0, 0, 13, 2, 13, K.rubber);
  lathe(m, c, c, 2, 21, (y) => 5.3 - (y - 2) * 0.215, (y) => (y >= 9 && y < 11 ? K.white : y >= 14 && y < 16 ? SLOT.LED : K.safetyOrange));
  lathe(m, c, c, 21, 22, 1.2, K.safetyOrange);
  return m;
}

/** Benne à ordures commerciale : façade inclinée, nervures, fourreaux de levage, couvercles, capteur. */
function dumpster(v: number): VoxelModel {
  const m = new VoxelModel(32, 22, 19, R16);
  const col = [0x2f4f3a, 0x2b4a78, 0x5a3426][v];
  const dk = shade(col, 0.75);
  for (const [x, z] of [
    [2, 2],
    [28, 2],
    [2, 15],
    [28, 15],
  ])
    m.box(x, 0, z, x + 2, 2, z + 2, K.black);
  const zf = (y: number) => 15 + Math.round(((y - 2) * 3) / 16);
  for (let y = 2; y < 18; y++) m.box(1, y, 1, 31, y + 1, zf(y) + 1, col);
  m.box(0, 17, 0, 32, 18, zf(17) + 2, shade(col, 1.15));
  // nervures verticales sur la façade et les flancs
  for (let y = 3; y < 17; y++)
    for (const x of [5, 15, 16, 26]) m.set(x, y, zf(y) + 1, dk);
  for (const x of [0, 31]) {
    m.box(x, 3, 5, x + 1, 17, 6, dk);
    m.box(x, 3, 12, x + 1, 17, 13, dk);
    m.box(x, 8, 3, x + 1, 11, 16, K.graphite);
  }
  // couvercles en plastique noir (l'un entrouvert, sac qui dépasse)
  m.box(1, 18, 1, 16, 19, 18, 0x1e1f22);
  m.box(2, 19, 2, 15, 20, 17, 0x1e1f22);
  m.box(16, 18, 1, 31, 19, 18, 0x232427);
  if (v !== 1) {
    m.box(17, 19, 1, 31, 21, 3, 0x232427);
    blob(m, 23, 19.5, 9, 4.5, 2.4, 4, 0x34393a);
  } else m.box(17, 19, 2, 30, 20, 17, 0x232427);
  // étiquette, capteur de remplissage, tags
  for (let y = 12; y < 15; y++) m.box(19, y, zf(y), 25, y + 1, zf(y) + 1, K.offWhite);
  m.box(20, 13, zf(13), 24, 14, zf(13) + 1, 0x3a3a3a);
  m.set(29, 16, zf(16) + 1, SLOT.NEON_GREEN);
  if (v === 0) tag(m, 'ZEK', 12, 12, '+z', 0xe85aa8, 0xf2f2f2, 2);
  if (v === 1) tag(m, 'NOVA', 10, 10, '+z', 0xf0d040, 0x151515, 1);
  return m;
}

/** Colonne publicitaire numérique : fût-écran circulaire, anneaux néon (variante), dôme. */
function adColumn(): VoxelModel {
  const m = new VoxelModel(16, 48, 16, R16);
  const c = 8;
  lathe(m, c, c, 0, 3, 8, K.graphite);
  lathe(m, c, c, 3, 4, 7.6, SLOT.NEON);
  lathe(m, c, c, 4, 38, 7.1, SLOT.SCREEN);
  lathe(m, c, c, 38, 39, 7.6, SLOT.NEON);
  lathe(m, c, c, 39, 42, (y) => (y === 40 ? 8 : 7.6), K.graphite);
  lathe(m, c, c, 42, 46, (y) => 6.6 - (y - 42) * 1.4, 0x2e3238);
  lathe(m, c, c, 46, 47, 1.2, 0x2e3238);
  lathe(m, c, c, 47, 48, 1.2, SLOT.NEON);
  return m;
}

/** Abribus : cadre inox, toit vitré à bandeau LED, panneau publicitaire écran, banc, plan du réseau. */
function busShelter(): VoxelModel {
  const m = new VoxelModel(58, 42, 24, R16);
  const fr = K.alu;
  for (const [x, z] of [
    [1, 1],
    [55, 1],
    [28, 1],
    [1, 21],
  ])
    m.box(x, 0, z, x + 2, 39, z + 2, fr);
  // toit
  m.box(0, 39, 0, 58, 41, 24, fr);
  m.box(2, 40, 2, 56, 41, 22, SLOT.GLASS);
  m.box(0, 41, 1, 58, 42, 3, K.gunmetal);
  m.box(2, 38, 21, 54, 39, 22, SLOT.LED);
  // paroi arrière vitrée
  for (const [x0, x1] of [
    [3, 28],
    [30, 55],
  ]) {
    m.box(x0, 2, 1, x1, 3, 2, fr);
    m.box(x0, 3, 1, x1, 37, 2, SLOT.GLASS);
    m.box(x0, 37, 1, x1, 39, 2, fr);
  }
  // côté gauche : vitre partielle
  m.box(1, 3, 3, 2, 37, 13, SLOT.GLASS);
  m.box(1, 37, 3, 2, 39, 13, fr);
  // côté droit : panneau publicitaire double face
  m.box(54, 0, 3, 58, 39, 21, K.graphite);
  m.box(54, 4, 5, 55, 36, 19, SLOT.SCREEN);
  m.box(57, 4, 5, 58, 36, 19, SLOT.SCREEN);
  m.box(54, 0, 3, 58, 1, 21, K.gunmetal);
  // banc et appui-fesses
  m.box(6, 7, 3, 38, 8, 8, fr);
  for (const x of [9, 34]) m.box(x, 0, 4, x + 2, 7, 7, K.gunmetal);
  m.box(40, 12, 2, 52, 13, 4, fr);
  // plan du réseau sur la vitre arrière (face intérieure)
  m.box(42, 16, 2, 52, 31, 3, K.offWhite);
  for (const [y, cc] of [
    [28, 0xd03030],
    [24, 0x2a8a3a],
    [20, 0x2a5ab8],
  ] as const) {
    m.box(43, y, 3, 51, y + 1, 4, cc);
    m.set(44 + (y % 5), y + 1, 3, cc);
  }
  // afficheur des prochains passages sous le toit
  m.box(20, 32, 19, 39, 39, 22, K.black);
  write(m, 'M15', F3, '+z', 29.5, 37, 21, SLOT.NEON_AMBER);
  return m;
}

/** Kiosque à journaux : cabine verte, auvent à enseigne « NEWS », magazines, comptoir. */
function newsStand(): VoxelModel {
  const m = new VoxelModel(35, 38, 26, R16);
  const body = 0x24402e;
  const ss = K.alu;
  m.box(1, 0, 1, 34, 31, 21, body);
  m.box(1, 0, 1, 34, 1, 21, K.graphite);
  // ouverture de service, intérieur sombre, étagères garnies
  m.box(6, 14, 18, 29, 29, 21, -1);
  m.box(6, 14, 17, 29, 29, 18, 0x15171a);
  for (const y of [18, 23]) {
    m.box(6, y, 18, 29, y + 1, 20, ss);
    for (let x = 7; x < 28; x += 2) m.set(x, y + 1, 18, [0xc83a2a, 0xe8c040, 0x3a7ac0, 0xe8e8e0][(x + y) % 4]);
  }
  m.box(25, 14, 18, 28, 22, 20, SLOT.LED);
  // comptoir et piles de journaux
  m.box(4, 13, 18, 31, 14, 24, ss);
  for (const [x0, h] of [
    [7, 2],
    [12, 3],
    [17, 2],
    [22, 3],
  ]) {
    m.box(x0, 14, 20, x0 + 4, 14 + h, 23, K.newsprint);
    for (let y = 14; y < 14 + h; y += 2) m.box(x0, y, 22, x0 + 4, y + 1, 23, shade(K.newsprint, 0.86));
    m.box(x0 + 1, 13 + h, 21, x0 + 3, 14 + h, 22, K.ink);
  }
  // présentoirs de magazines (façade basse et côtés)
  const mags = [0xd8343a, 0x2a6ac8, 0xf0c838, 0xe86aa8, 0x38a858, 0xf0f0e8, 0x8a4ac0, 0xe88a2a];
  for (let r = 0; r < 3; r++)
    for (let k = 0; k < 7; k++) {
      const x0 = 3 + k * 4;
      const y0 = 2 + r * 4;
      m.box(x0, y0, 21, x0 + 3, y0 + 3, 22, mags[(k * 3 + r * 5) % 8]);
      m.set(x0 + 1, y0 + 2, 21, K.white);
    }
  for (const x of [0, 34])
    for (let r = 0; r < 5; r++)
      for (let k = 0; k < 4; k++) {
        const z0 = 3 + k * 4;
        const y0 = 4 + r * 5;
        m.box(x, y0, z0, x + 1, y0 + 4, z0 + 3, mags[(k * 5 + r * 3 + x) % 8]);
      }
  // auvent, enseigne lumineuse, bandeau défilant, ampoules
  m.box(0, 31, 0, 35, 37, 26, body);
  m.box(0, 37, 0, 35, 38, 26, K.gunmetal);
  m.box(0, 31, 25, 35, 32, 26, SLOT.SCREEN);
  m.box(1, 32, 25, 34, 37, 26, K.black);
  write(m, 'NEWS', F3, '+z', 17.5, 36, 25, SLOT.LED);
  for (const x of [8, 17, 26]) m.set(x, 30, 24, SLOT.GLOW);
  return m;
}

/** Panneaux de nom de rue new-yorkais (1/32) : deux plaques vertes croisées, sens unique, LED sommitale. */
function streetSign(v: number): VoxelModel {
  const m = new VoxelModel(38, 102, 38, R32);
  const c = 19;
  const names = [
    ['W 42 ST', '7 AV'],
    ['E 23 ST', 'PARK AV'],
    ['WALL ST', 'BROAD ST'],
  ][v];
  m.box(c - 3, 0, c - 3, c + 3, 3, c + 3, K.gunmetal);
  squarePole(m, c - 2, c - 2, 4, 3, 98, K.galvDk);
  m.box(c - 2, 98, c - 2, c + 2, 100, c + 2, K.gunmetal);
  m.box(c - 1, 100, c - 1, c + 1, 102, c + 1, SLOT.NEON_CYAN);
  // plaque 1 (le long de X, lisible depuis ±Z)
  const L1 = layout(names[0], F3).w + 4;
  m.box(c - Math.ceil(L1 / 2), 91, c - 1, c + Math.floor(L1 / 2), 98, c + 1, K.signGreen);
  write(m, names[0], F3, '+z', c, 96, c, K.white);
  write(m, names[0], F3, '-z', c, 96, c - 1, K.white);
  // plaque 2 (le long de Z, lisible depuis ±X)
  const L2 = layout(names[1], F3).w + 4;
  m.box(c - 1, 82, c - Math.ceil(L2 / 2), c + 1, 89, c + Math.floor(L2 / 2), K.signGreen);
  write(m, names[1], F3, '+x', c, 87, c, K.white);
  write(m, names[1], F3, '-x', c, 87, c - 1, K.white);
  // sens unique (noir, flèche blanche)
  m.box(c, 66, c - 1, c + 18, 74, c + 1, K.black);
  for (const z of [c - 1, c]) art(m, ['........#...', '........###.', '############', '........###.', '........#...'], { '#': K.white }, '+z', c + 9, 72, z);
  return m;
}

/** Horodateur (1/32) : borne de paiement, pictogramme P, écran, clavier, panneau solaire. */
function parkingMeter(): VoxelModel {
  const m = new VoxelModel(8, 45, 8, R32);
  const head = 0x283a52;
  m.box(0, 0, 0, 8, 1, 8, K.gunmetal);
  m.box(2, 1, 2, 6, 22, 6, K.graphite);
  m.box(1, 20, 1, 7, 22, 7, K.gunmetal);
  rbox(m, 0, 22, 1, 8, 42, 7, head);
  // pictogramme P, écran, clavier, fente, voyant
  m.box(1, 36, 6, 7, 41, 7, 0x1d5fb8);
  art(m, ['##.', '#.#', '##.', '#..', '#..'], { '#': K.white }, '+z', 4, 40, 6);
  m.box(1, 31, 6, 7, 35, 7, K.black);
  m.box(2, 32, 6, 6, 35, 7, SLOT.SCREEN);
  for (let y = 25; y < 30; y += 2) for (const x of [1, 3, 5]) m.set(x, y, 6, K.alu);
  m.box(2, 23, 6, 6, 24, 7, K.black);
  m.set(6, 30, 6, SLOT.NEON_GREEN);
  // panneau solaire incliné
  m.box(0, 42, 1, 8, 43, 7, K.gunmetal);
  m.box(0, 43, 1, 8, 44, 5, 0x1a2846);
  m.box(0, 44, 1, 8, 45, 3, 0x1a2846);
  return m;
}

/** Borne de recharge pour véhicules (hover) : écran, liserés cyan, câble et connecteur, anneau d'état. */
function chargingPost(): VoxelModel {
  const m = new VoxelModel(8, 26, 6, R16);
  const shell = 0xd8dce0;
  m.box(0, 0, 0, 8, 1, 6, K.graphite);
  rbox(m, 1, 1, 0, 7, 24, 5, shell);
  m.box(1, 1, 0, 7, 24, 1, K.graphite);
  // face avant : écran, liserés cyan, prise
  m.box(2, 15, 5, 6, 21, 6, K.black);
  m.box(2, 16, 5, 6, 20, 6, SLOT.SCREEN);
  m.box(1, 3, 4, 2, 23, 5, SLOT.NEON_CYAN);
  m.box(6, 3, 4, 7, 23, 5, SLOT.NEON_CYAN);
  m.box(3, 9, 5, 5, 11, 6, K.graphite);
  // anneau d'état et chapeau
  m.box(1, 23, 0, 7, 24, 5, SLOT.NEON_GREEN);
  m.box(1, 24, 0, 7, 26, 5, K.graphite);
  // connecteur rangé sur le flanc et câble en boucle
  m.box(7, 11, 1, 8, 15, 4, K.graphite);
  m.box(7, 12, 2, 8, 14, 3, K.black);
  seg(m, [7.5, 11, 2.5], [7.5, 4, 2.5], [1, 1, 1], K.black);
  seg(m, [7.5, 4, 2.5], [6.5, 2, 2.5], [1, 1, 1], K.black);
  return m;
}

/** Échafaudage de trottoir new-yorkais (sidewalk shed) vert sombre : poteaux, contreventements, plancher, garde-corps, lampes. */
function scaffold(): VoxelModel {
  const m = new VoxelModel(48, 51, 24, R16);
  const g = 0x2c4a33;
  const ply = 0x3a5a40;
  for (const [x, z] of [
    [1, 2],
    [45, 2],
    [1, 20],
    [45, 20],
  ]) {
    m.box(x - 1, 0, z - 1, x + 3, 1, z + 3, 0x8a6a42);
    m.box(x, 1, z, x + 2, 45, z + 2, g);
  }
  // poutres, solives, plancher
  m.box(0, 44, 2, 48, 46, 4, g);
  m.box(0, 44, 20, 48, 46, 22, g);
  for (let x = 2; x < 48; x += 8) m.box(x, 46, 1, x + 1, 47, 23, g);
  m.box(0, 47, 0, 48, 48, 24, ply);
  // garde-corps de contreplaqué côté rue, affichettes de permis
  m.box(0, 48, 22, 48, 51, 24, ply);
  m.box(0, 50, 22, 48, 51, 24, shade(ply, 1.2));
  for (const x of [8, 30]) {
    m.box(x, 48, 24 - 1, x + 6, 50, 24, K.white);
    m.box(x + 1, 49, 23, x + 5, 50, 24, 0x2a2a2a);
  }
  // contreventements en genou
  for (const [x, dir] of [
    [2, 1],
    [46, -1],
  ] as const)
    for (const z of [3, 21]) seg(m, [x, 37, z], [x + dir * 7, 44, z], [1, 1, 1], g);
  // lampes sous le plancher
  for (const x of [12, 36]) {
    m.box(x - 1, 46, 11, x + 2, 47, 13, K.gunmetal);
    m.box(x - 1, 45, 11, x + 2, 46, 13, SLOT.LED);
  }
  return m;
}

// ================================================================== VÉHICULES

/** Vitrage teinté des véhicules (couleur fixe : les marches des pare-brise restent sombres). */
const TINT_GLASS = 0x1a222d;

interface CarStyle {
  body: number;
  accent: number;
  /** Lueur sous caisse (emplacement émissif) ou -1. */
  glow: number;
  roof?: number;
  wreck?: boolean;
  /** Taxi : 1 = enseigne allumée, 2 = hors service. */
  taxi?: 1 | 2;
}

/** Berline à sustentation (2085) : caisse basse galbée, habitacle vitré, LED avant / bandeau rouge arrière, nacelles. */
function hoverCar(st: CarStyle): VoxelModel {
  const L = 70;
  const m = new VoxelModel(32, 24, L, R16).setOrigin(16, 0, 35);
  const cx = 16;
  const round = [5, 2, 1, 0.4, 0.1];
  const hwLow = (z: number) => {
    const e = Math.min(z, L - 1 - z);
    return 16 - (e < round.length ? round[e] : 0);
  };
  const yTop = (z: number) => (z >= 50 ? 11 - Math.round(((z - 50) * 3) / 19) : z <= 1 ? 10 : 11);
  const yBot = (z: number) => (Math.min(z, L - 1 - z) < 2 ? 3 : 2);
  const xs = (hw: number): [number, number] => [Math.round(cx - hw), Math.round(cx + hw)];
  // caisse basse : bas de caisse rentré, arête de ceinture adoucie
  for (let z = 0; z < L; z++) {
    const [x0, x1] = xs(hwLow(z));
    m.box(x0 + 1, yBot(z), z, x1 - 1, yBot(z) + 1, z + 1, st.body);
    m.box(x0, yBot(z) + 1, z, x1, yTop(z) - 1, z + 1, st.body);
    m.box(x0 + 1, yTop(z) - 1, z, x1 - 1, yTop(z), z + 1, st.body);
  }
  // habitacle vitré
  const cabTop = (z: number) => (z < 18 ? 11 + Math.round(((z - 8) * 7) / 10) : z <= 38 ? 18 : 18 - Math.round(((z - 38) * 7) / 12));
  const hwCab = (y: number) => 13 - (y - 11) * 0.36;
  for (let z = 8; z <= 50; z++)
    for (let y = 11; y <= cabTop(z); y++) {
      const [x0, x1] = xs(hwCab(y));
      m.box(x0, y, z, x1, y + 1, z + 1, TINT_GLASS);
    }
  // toit, montants A / B / C
  const roofC = st.roof ?? st.body;
  for (let z = 17; z <= 39; z++) paint(m, 0, 18, z, 32, 19, z + 1, roofC);
  for (let z = 8; z <= 50; z++) {
    const top = cabTop(z);
    for (let y = 11; y <= top; y++) {
      const [x0, x1] = xs(hwCab(y));
      const pillar = (z >= 28 && z <= 29) || (z > 38 && y >= top - 1 && z < 48) || (z < 18 && y >= top - 1 && z > 9);
      if (pillar) {
        m.set(x0, y, z, roofC);
        m.set(x1 - 1, y, z, roofC);
      }
    }
  }
  // flancs : ligne d'accent, joints de portes, poignées, caméras-rétroviseurs
  for (let z = 4; z < 66; z++) {
    const [x0, x1] = xs(hwLow(z));
    for (const y of st.taxi ? [8, 9] : [8]) {
      const c = st.taxi ? ((z + y) % 2 ? K.black : K.white) : st.accent;
      m.set(x0, y, z, c);
      m.set(x1 - 1, y, z, c);
    }
  }
  for (const z of [30, 47]) {
    paint(m, 0, 3, z, 1, 11, z + 1, shade(st.body, 0.7));
    paint(m, 31, 3, z, 32, 11, z + 1, shade(st.body, 0.7));
  }
  for (const z of [34, 50]) {
    m.box(0, 9, z, 1, 10, z + 2, K.chrome);
    m.box(31, 9, z, 32, 10, z + 2, K.chrome);
  }
  m.box(2, 12, 45, 3, 13, 48, st.body);
  m.box(29, 12, 45, 30, 13, 48, st.body);
  // nacelles de sustentation (roues escamotées visibles dans le logement)
  for (const zc of [12, 57]) {
    for (const [x, xi] of [
      [0, 1],
      [31, 30],
    ]) {
      m.box(x, 3, zc - 5, x + 1, 8, zc + 5, -1);
      m.box(xi, 3, zc - 5, xi + 1, 8, zc + 5, K.black);
      for (let z = zc - 3; z < zc + 3; z++) for (let y = 3; y < 8; y++) if (Math.hypot(z + 0.5 - zc, y + 0.5 - 5.5) < 2.6) m.set(xi, y, z, K.gunmetal);
    }
    m.box(4, 0, zc - 4, 10, 2, zc + 4, K.gunmetal);
    m.box(22, 0, zc - 4, 28, 2, zc + 4, K.gunmetal);
    if (!st.wreck) {
      m.box(4, 0, zc - 4, 5, 1, zc + 4, SLOT.NEON_CYAN);
      m.box(27, 0, zc - 4, 28, 1, zc + 4, SLOT.NEON_CYAN);
    }
  }
  // lueur sous caisse
  if (st.glow >= 0)
    for (let z = 18; z < 48; z++) {
      const [x0, x1] = xs(hwLow(z));
      m.set(x0 + 1, 2, z, st.glow);
      m.set(x1 - 2, 2, z, st.glow);
    }
  // feux : bandeau LED avant qui contourne les angles, prise d'air ; bandeau rouge arrière, diffuseur
  const front = st.wreck ? 0x8a8a80 : SLOT.LED;
  const rear = st.wreck ? 0x5a1a14 : SLOT.NEON_RED;
  paint(m, 0, 7, 65, 32, 8, L, front);
  paint(m, 0, 3, 68, 32, 6, L, K.black);
  paint(m, 0, 8, 0, 32, 9, 3, rear);
  paint(m, 4, 3, 0, 28, 5, 1, K.black);
  if (st.taxi) {
    // enseigne de toit (le damier est posé avec la ligne d'accent)
    const lit = st.taxi === 1;
    m.box(8, 19, 27, 24, 24, 31, lit ? SLOT.NEON_AMBER : K.offWhite);
    write(m, 'TAXI', F3, '+z', 16, 23, 30, lit ? K.black : K.steel);
    write(m, 'TAXI', F3, '-z', 16, 23, 27, lit ? K.black : K.steel);
  }
  if (st.wreck) {
    // épave : rouille, apprêt, vitres brisées, capot enfoncé
    m.forEach((x, y, z, c) => {
      if (c === st.body) {
        const h = hash3(x >> 1, y >> 1, z >> 2, 11);
        return h < 0.25 ? 0x4a3020 : h < 0.4 ? 0x77706a : h > 0.85 ? 0x8a5a36 : undefined;
      }
      if (c === TINT_GLASS && hash3(x, y, z, 12) > 0.72) return 0x0c0c0c;
      return undefined;
    });
    m.box(10, 10, 56, 20, 11, 64, -1);
    m.box(0, 3, 32, 1, 10, 46, K.black);
  }
  return m;
}

/** Fourgon de livraison à sustentation : caisse haute, cabine avancée, porte coulissante, bandeau de livreur. */
function hoverVan(v: number): VoxelModel {
  const L = 86;
  const m = new VoxelModel(35, 38, L, R16).setOrigin(17.5, 0, 43);
  const P = [
    { body: 0xe4e6e8, stripe: 0x1f5fb8 },
    { body: 0x2c3036, stripe: 0xe8641c },
    { body: 0x5a4030, stripe: 0xe8c030 },
  ][v];
  const dk = shade(P.body, 0.7);
  // profil : caisse et pavillon jusqu'à z 66, pare-brise incliné, capot court
  const top = (z: number) => (z < 66 ? 36 : z < 80 ? 36 - Math.round(((z - 66) * 18) / 14) : 18 - Math.round((z - 80) * 0.6));
  for (let z = 0; z < L; z++) {
    const e = Math.min(z, L - 1 - z);
    const inset = e === 0 ? 2 : e === 1 ? 1 : 0;
    m.box(1 + inset, 3, z, 34 - inset, top(z), z + 1, P.body);
    m.box(2 + inset, 2, z, 33 - inset, 3, z + 1, dk);
  }
  // arêtes de pavillon arrondies
  m.box(1, 35, 0, 2, 36, 66, -1);
  m.box(33, 35, 0, 34, 36, 66, -1);
  // pare-brise et vitres de cabine
  for (let z = 66; z < 80; z++) for (let y = 20; y < top(z); y++) for (let x = 3; x < 32; x++) if (m.get(x, y, z) >= 0 && (y === top(z) - 1 || m.get(x, y + 1, z) < 0 || m.get(x, y, z + 1) < 0)) m.set(x, y, z, TINT_GLASS);
  for (const x of [1, 33]) m.box(x, 20, 64, x + 1, 32, 76, TINT_GLASS);
  for (const x of [1, 33]) m.box(x, 20, 70, x + 1, 32, 71, P.body);
  // bandeau de livreur et pictogramme (colis en mouvement)
  for (const x of [1, 33]) m.box(x, 20, 4, x + 1, 24, 62, P.stripe);
  const icon = ['....####', '.--.#..#', '--..####', '.--.####'];
  art(m, icon, { '#': K.white, '-': K.white }, '+x', 30, 31, 33);
  art(m, icon, { '#': K.white, '-': K.white }, '-x', 30, 31, 1);
  // porte latérale coulissante, poignées
  for (const x of [1, 33]) {
    m.box(x, 4, 40, x + 1, 34, 41, dk);
    m.box(x, 4, 58, x + 1, 34, 59, dk);
    m.box(x, 18, 55, x + 1, 19, 57, K.chrome);
  }
  // portes arrière, feux rouges verticaux, plaque
  m.box(17, 4, 0, 18, 35, 1, dk);
  m.box(14, 18, 0, 16, 19, 1, K.chrome);
  m.box(19, 18, 0, 21, 19, 1, K.chrome);
  for (const x of [3, 31]) m.box(x, 10, 0, x + 1, 22, 1, SLOT.NEON_RED);
  m.box(13, 5, 0, 22, 8, 1, K.offWhite);
  // face avant : calandre, bandeau LED, feux de gabarit
  m.box(6, 5, 85, 29, 10, 86, K.black);
  m.box(4, 11, 85, 31, 12, 86, SLOT.LED);
  for (const x of [3, 31]) m.set(x, 35, 66, SLOT.NEON_AMBER).set(x + 1, 35, 66, SLOT.NEON_AMBER);
  // nacelles de sustentation
  for (const zc of [14, 70]) {
    for (const x of [1, 33]) {
      m.box(x, 3, zc - 6, x + 1, 10, zc + 6, K.black);
      for (let z = zc - 4; z < zc + 4; z++) for (let y = 3; y < 10; y++) if (Math.hypot(z + 0.5 - zc, y + 0.5 - 6.5) < 3.1) m.set(x, y, z, K.gunmetal);
    }
    m.box(4, 0, zc - 5, 11, 2, zc + 5, K.gunmetal);
    m.box(24, 0, zc - 5, 31, 2, zc + 5, K.gunmetal);
    m.box(4, 0, zc - 5, 5, 1, zc + 5, SLOT.NEON_CYAN);
    m.box(30, 0, zc - 5, 31, 1, zc + 5, SLOT.NEON_CYAN);
  }
  return m;
}

const CAR_STYLES: CarStyle[] = [
  { body: 0x16181c, accent: K.chrome, glow: SLOT.NEON_CYAN },
  { body: 0x8e1520, accent: 0xd4a640, glow: SLOT.NEON_RED, roof: 0x141012 },
  { body: 0x1a2d5a, accent: 0xc9d1dc, glow: SLOT.NEON_BLUE, roof: 0x0f1a30 },
  { body: 0xdfe2e4, accent: 0x2a2d31, glow: -1 },
  { body: 0x8d959e, accent: 0x2a2d31, glow: -1 },
  { body: 0x1d5f63, accent: K.chrome, glow: SLOT.NEON_CYAN },
  { body: 0xd0601a, accent: 0x16181c, glow: SLOT.NEON_AMBER, roof: 0x16181c },
  { body: 0x6a4a32, accent: 0x4a3020, glow: -1, wreck: true },
];

// ================================================================== TOITS ET FAÇADES

/** Groupe de climatisation de toit : caisson à persiennes, grille de ventilateur, tuyaux de cuivre. */
function acUnit(v: number): VoxelModel {
  const m = new VoxelModel(16, 11, 13, R16);
  const body = [0xc8c4b8, 0xd6d9dc, 0x9a9488][v];
  const dk = shade(body, 0.72);
  m.box(1, 0, 1, 15, 1, 3, K.gunmetal);
  m.box(1, 0, 10, 15, 1, 12, K.gunmetal);
  m.box(0, 1, 0, 16, 10, 13, body);
  // persiennes sur les quatre faces
  for (const y of [2, 4, 6, 8]) {
    m.box(0, y, 0, 16, y + 1, 1, dk);
    m.box(0, y, 12, 11, y + 1, 13, dk);
    m.box(0, y, 0, 1, y + 1, 13, dk);
    m.box(15, y, 0, 16, y + 1, 13, dk);
  }
  // boîtier électrique et tuyaux
  m.box(11, 2, 12, 15, 9, 13, shade(body, 0.9));
  m.set(13, 7, 12, K.offWhite).set(12, 7, 12, K.offWhite);
  m.box(1, 2, 12, 3, 3, 13, 0xb06a3a);
  m.box(1, 4, 12, 3, 5, 13, 0xb06a3a);
  // ventilateur sous grille
  lathe(m, 8, 6.5, 10, 11, 5.6, (_y, a, d) => {
    if (d > 4.9) return K.graphite;
    if (d < 1.2) return K.gunmetal;
    const blade = Math.abs(Math.sin(2 * a + d * 0.35)) < 0.38;
    return d > 3.4 && d < 3.9 ? K.steel : blade ? K.steelHi : 0x1c1e20;
  });
  if (v === 2) for (let x = 0; x < 16; x++) if (hash3(x, 0, 0, 3) > 0.6) m.set(x, 1, 12, 0x6e3a1e);
  return m;
}

/** Climatiseur de fenêtre : boîtier beige, grille à lamelles, commandes, équerres de soutien. */
function acWindow(): VoxelModel {
  const m = new VoxelModel(11, 7, 8, R16);
  const body = 0xd6d0c0;
  const dk = shade(body, 0.68);
  m.box(0, 1, 0, 11, 7, 8, body);
  for (const y of [2, 4]) m.box(1, y, 7, 8, y + 1, 8, dk);
  m.box(1, 6, 7, 8, 7, 8, shade(body, 0.85));
  m.box(8, 2, 7, 10, 6, 8, shade(body, 0.9));
  m.set(9, 5, 7, SLOT.NEON_CYAN);
  m.set(9, 3, 7, K.gunmetal);
  for (const x of [0, 10]) for (const z of [2, 4]) m.box(x, 2, z, x + 1, 6, z + 1, dk);
  // équerres sous l'appareil
  for (const x of [1, 9]) {
    m.box(x, 0, 0, x + 1, 1, 6, K.graphite);
    m.set(x, 0, 0, K.graphite);
  }
  return m;
}

/** Aérateur à turbine de toit (galvanisé) : costière, gaine carrée, turbine à ailettes, dôme. */
function roofVent(): VoxelModel {
  const m = new VoxelModel(10, 19, 10, R16);
  const c = 5;
  m.box(0, 0, 0, 10, 1, 10, K.galvDk);
  m.box(1, 1, 1, 9, 2, 9, K.galv);
  squarePole(m, 3, 3, 4, 2, 10, K.galv);
  lathe(m, c, c, 9, 10, 2.6, K.galvDk);
  lathe(m, c, c, 10, 16, 4.3, (_y, a) => (Math.floor(((a + Math.PI) / (2 * Math.PI)) * 16) % 2 ? K.galv : 0x5e666b));
  lathe(m, c, c, 16, 18, (y) => (y === 16 ? 3.6 : 2.4), K.galvDk);
  lathe(m, c, c, 18, 19, 1.2, K.galv);
  return m;
}

/** Antenne parabolique sur support lesté (plat de toit). */
function satDish(): VoxelModel {
  const m = new VoxelModel(19, 22, 16, R16);
  // châssis lesté
  m.box(1, 0, 1, 18, 1, 3, K.gunmetal);
  m.box(1, 0, 13, 18, 1, 15, K.gunmetal);
  m.box(8, 0, 1, 11, 1, 15, K.gunmetal);
  m.box(1, 0, 1, 5, 2, 5, K.concrete);
  m.box(14, 0, 1, 18, 2, 5, K.concrete);
  m.box(8, 1, 5, 11, 12, 8, K.steel);
  // réflecteur parabolique orienté vers +Z, incliné de 35°
  const cx = 9.5;
  const cy = 14;
  const cz = 8.5;
  const ny = Math.sin((35 * Math.PI) / 180);
  const nz = Math.cos((35 * Math.PI) / 180);
  const R = 7.6;
  const f = 6.5;
  for (let y = 0; y < 22; y++)
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 19; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const dz = z + 0.5 - cz;
        const h = dy * ny + dz * nz;
        const rx = dx;
        const ry = dy - h * ny;
        const rz = dz - h * nz;
        const rho = Math.hypot(rx, ry, rz);
        if (rho > R) continue;
        const hs = (rho * rho) / (4 * f) - 1.2;
        if (Math.abs(h - hs) > 0.62) continue;
        m.set(x, y, z, rho > R - 1 ? 0xb8b8b2 : 0xe2e2dc);
      }
  // bras et tête LNB au foyer
  const fy = cy + ny * (f - 1.2);
  const fz = cz + nz * (f - 1.2);
  m.box(8, 11, 6, 11, 13, 8, K.steel);
  seg(m, [cx, cy - nz * 7 + ny * 0.7, cz + ny * 7 + nz * 0.7], [cx, fy, fz], [1, 1, 1], K.gunmetal);
  m.box(9, Math.round(fy) - 1, Math.round(fz) - 1, 11, Math.round(fy) + 1, Math.round(fz) + 1, K.graphite);
  m.set(10, Math.round(fy), Math.round(fz), SLOT.NEON_GREEN);
  return m;
}

/** Antenne-relais de toit : mât, panneaux, fouet sommital à feu rouge (balisage). */
function antenna(): VoxelModel {
  const m = new VoxelModel(5, 64, 5, R16);
  m.box(0, 0, 0, 5, 1, 5, K.gunmetal);
  m.box(1, 1, 1, 4, 48, 4, K.galv);
  for (let y = 3; y < 46; y += 6) {
    m.box(1, y, 1, 4, y + 1, 4, K.galvDk);
  }
  // panneaux d'émission (3 faces) et boîtiers
  m.box(0, 34, 1, 1, 46, 4, K.offWhite);
  m.box(4, 34, 1, 5, 46, 4, K.offWhite);
  m.box(1, 34, 4, 4, 46, 5, K.offWhite);
  m.box(1, 20, 0, 4, 25, 1, K.gunmetal);
  // feux de balisage et fouet
  m.box(0, 28, 2, 1, 29, 3, SLOT.NEON_RED);
  m.box(4, 28, 2, 5, 29, 3, SLOT.NEON_RED);
  m.box(2, 48, 2, 3, 62, 3, K.steel);
  m.box(2, 62, 2, 3, 64, 3, SLOT.NEON_RED);
  return m;
}

/** Pictogrammes 5×5 des enseignes. */
const ICONS: Record<string, string[]> = {
  heart: ['.#.#.', '#####', '#####', '.###.', '..#..'],
  star: ['..#..', '.###.', '#####', '.###.', '.#.#.'],
  note: ['..##.', '..#.#', '..#..', '###..', '###..'],
  glass: ['#####', '.###.', '..#..', '..#..', '.###.'],
  arrow: ['.###.', '.###.', '#####', '.###.', '..#..'],
  diamond: ['..#..', '.#.#.', '#...#', '.#.#.', '..#..'],
};

/** Enseigne verticale « en drapeau » (néon de la variante) : caisson sombre, lettres empilées, deux faces. */
function neonBlade(v: number): VoxelModel {
  const m = new VoxelModel(5, 48, 22, R16).setOrigin(2.5, 0, 11);
  const designs: [string, string | null][] = [
    ['CLUB', 'heart'],
    ['HOTEL', null],
    ['LUCKY', null],
    ['JAZZ', 'note'],
    ['DELI', 'star'],
    ['PIZZA', null],
    ['LIVE', 'star'],
    ['BAR', 'glass'],
  ];
  const [word, icon] = designs[v];
  const N = SLOT.NEON;
  // potences murales
  for (const y of [7, 40]) {
    m.box(2, y, 0, 3, y + 1, 9, K.gunmetal);
    m.box(1, y - 1, 0, 4, y + 2, 1, K.graphite);
  }
  seg(m, [2.5, 10, 0.5], [2.5, 7.5, 8.5], [1, 1, 1], K.gunmetal);
  // caisson
  m.box(1, 2, 9, 4, 47, 22, 0x16171b);
  m.box(1, 2, 9, 4, 3, 22, K.gunmetal);
  m.box(1, 46, 9, 4, 47, 22, K.gunmetal);
  m.box(1, 2, 21, 4, 47, 22, N);
  // cadre néon et lettres (affleurants, sur les deux faces)
  const z0 = 10;
  const z1 = 21;
  const zc = 15.5;
  for (const x of [1, 3]) {
    m.box(x, 3, z0, x + 1, 4, z1, N);
    m.box(x, 45, z0, x + 1, 46, z1, N);
    m.box(x, 3, z0, x + 1, 46, z0 + 1, N);
    m.box(x, 3, z1 - 1, x + 1, 46, z1, N);
  }
  const n = word.length;
  const gap = n >= 5 ? 1 : 2;
  const iconH = icon ? 7 : 0;
  const total = n * 7 + (n - 1) * gap + iconH;
  let y = Math.floor(24.5 + (total - 1) / 2);
  const face = (rows: string[], yTop: number) => {
    art(m, rows, { '#': N }, '-x', zc, yTop, 1);
    art(m, rows, { '#': N }, '+x', zc, yTop, 3);
  };
  if (icon) {
    face(ICONS[icon], y);
    y -= 7;
  }
  for (const ch of word) {
    face(F5[ch].map((r) => r), y);
    y -= 7 + gap;
  }
  return m;
}

/** Enseigne murale plate (néon de la variante) : panneau sombre, cadre, texte ou emblème. */
function neonWallSign(v: number): VoxelModel {
  const m = new VoxelModel(32, 13, 2, R16).setOrigin(16, 0, 1);
  const N = SLOT.NEON;
  m.box(0, 0, 0, 32, 13, 1, 0x141518);
  m.box(0, 0, 0, 32, 1, 1, K.gunmetal);
  m.box(0, 12, 0, 32, 13, 1, K.gunmetal);
  // cadre néon
  m.box(1, 1, 1, 31, 2, 2, N);
  m.box(1, 11, 1, 31, 12, 2, N);
  m.box(1, 1, 1, 2, 12, 2, N);
  m.box(30, 1, 1, 31, 12, 2, N);
  const put = (rows: string[], cx: number, yTop: number) => art(m, rows, { '#': N }, '+z', cx, yTop, 1);
  const word = (s: string, cx: number) => write(m, s, F5, '+z', cx, 9, 1, N);
  switch (v) {
    case 0:
      word('OPEN', 16);
      break;
    case 1:
      put(['..........#.........', '.........###........', '.........###....#...', '....#....###...###..', '...###...###...###..', '...###.#.###.#.###.#', '#.####.#####.#####.#', '####################'], 16, 9);
      break;
    case 2:
      put(['#...#...#', '##.###.##', '#########', '#.#.#.#.#', '#########'], 16, 8);
      put(ICONS.star, 6, 8);
      put(ICONS.star, 26, 8);
      break;
    case 3:
      put(['....#....', '...###...', '#########', '.#######.', '..#####..', '.##...##.', '##.....##'], 16, 9);
      m.box(4, 6, 1, 10, 7, 2, N);
      m.box(22, 6, 1, 28, 7, 2, N);
      break;
    case 4:
      word('24H', 19);
      put(ICONS.star, 7, 8);
      break;
    case 5:
      word('BAR', 12.5);
      put(ICONS.glass, 25, 8);
      break;
    case 6:
      word('CAFE', 16);
      break;
    default:
      word('LIVE', 16);
      break;
  }
  return m;
}

/** Lanterne chinoise en papier rouge : côtes sombres, coiffes dorées, gland. */
function lanternRed(): VoxelModel {
  const m = new VoxelModel(8, 13, 8, R16);
  const c = 4;
  const gold = 0xc8a040;
  m.box(3, 11, 3, 5, 13, 5, 0x5a1010);
  lathe(m, c, c, 10, 11, 2.6, gold);
  lathe(m, c, c, 3, 10, (y) => 3.7 * Math.sqrt(Math.max(0, 1 - ((y + 0.5 - 6.5) / 4.3) ** 2)) + 0.3, (_y, a) => (Math.abs(Math.sin(4 * a + Math.PI / 2)) < 0.2 ? 0x9a1a14 : SLOT.NEON_RED));
  lathe(m, c, c, 2, 3, 2.6, gold);
  m.box(3, 0, 3, 5, 2, 5, 0xa01818);
  m.set(3, 0, 3, gold).set(4, 0, 4, gold);
  return m;
}

/** Guirlande de lanternes (rouges et ambrées) sur un cordon en chaînette. */
function lanternString(): VoxelModel {
  const m = new VoxelModel(64, 10, 3, R16).setOrigin(32, 0, 1.5);
  const cordY = (x: number) => 9 - 3 * (1 - ((x + 0.5 - 32) / 32) ** 2);
  for (let x = 0; x < 64; x++) m.set(x, Math.round(cordY(x)), 1, 0x2a1a14);
  [5, 16, 27, 37, 48, 58].forEach((x, i) => {
    const top = Math.round(cordY(x)) - 1;
    const body = i % 2 ? SLOT.NEON_AMBER : SLOT.NEON_RED;
    m.set(x, top, 1, 0xc8a040);
    m.box(x - 1, top - 3, 0, x + 2, top, 3, body);
    for (const [dx, dz] of [
      [-1, 0],
      [1, 0],
      [-1, 2],
      [1, 2],
    ]) {
      m.set(x + dx, top - 1, dz, -1);
      m.set(x + dx, top - 3, dz, -1);
    }
    m.set(x, top - 4, 1, 0xc8a040);
  });
  return m;
}

/** Caméra de surveillance murale (1/32) : platine, bras, caisson à visière aux couleurs du propriétaire, LED rouge. */
function securityCamera(): VoxelModel {
  const m = new VoxelModel(10, 10, 16, R32).setOrigin(5, 0, 8);
  m.box(2, 2, 0, 8, 9, 1, K.gunmetal);
  m.box(4, 5, 1, 6, 7, 6, K.graphite);
  m.box(3, 3, 5, 7, 8, 14, 0xd8dadc);
  m.box(2, 8, 4, 8, 9, 16, SLOT.TINT1);
  m.box(2, 7, 4, 3, 8, 15, SLOT.TINT1);
  m.box(7, 7, 4, 8, 8, 15, SLOT.TINT1);
  m.box(3, 3, 5, 7, 4, 14, SLOT.TINT2);
  m.box(3, 4, 14, 7, 7, 15, K.black);
  m.box(4, 4, 14, 6, 6, 15, SLOT.GLASS);
  m.set(6, 6, 14, SLOT.NEON_RED);
  return m;
}

/** Bannière verticale aux couleurs du propriétaire : hampe, plis, bordure, blason, pointe à gland. */
function flagBanner(): VoxelModel {
  const m = new VoxelModel(16, 42, 2, R16).setOrigin(8, 0, 1);
  const T1 = SLOT.TINT1;
  const T2 = SLOT.TINT2;
  const T3 = SLOT.TINT3;
  m.box(0, 40, 0, 16, 42, 2, T2);
  m.box(0, 39, 0, 1, 42, 2, T2);
  m.box(15, 39, 0, 16, 42, 2, T2);
  // étoffe à plis (colonnes alternées en avant / en arrière), pointe en V
  for (let x = 1; x < 15; x++) {
    const z = x % 4 < 2 ? 1 : 0;
    const yb = 5 + Math.round(Math.abs(x + 0.5 - 8) * 0.9);
    for (let y = yb; y < 40; y++) {
      const edge = x === 1 || x === 14 || y < yb + 2 || y >= 38;
      const band = y >= 33 && y < 35;
      m.set(x, y, z, edge ? T2 : band ? T3 : T1);
    }
  }
  // blason
  const crest = ['###########', '#333333333#', '#323232323#', '#322222223#', '#333333333#', '#332222233#', '#333333333#', '.#3333333#.', '..#33333#..', '...#333#...', '....###....'];
  for (let v = 0; v < crest.length; v++)
    for (let u = 0; u < crest[v].length; u++) {
      const ch = crest[v][u];
      if (ch === '.') continue;
      const x = 3 + u;
      const y = 30 - v;
      const z = x % 4 < 2 ? 1 : 0;
      m.set(x, y, z, ch === '#' || ch === '2' ? T2 : T3);
    }
  // gland
  m.box(7, 1, 0, 9, 5, 1, T2);
  m.box(7, 0, 0, 9, 1, 1, T3);
  return m;
}

/** Terminal de sécurité piratable (entrée des bâtiments protégés) : pied aux couleurs du propriétaire, écran incliné, clavier, lecteur, voyant. */
function securityPanel(): VoxelModel {
  const m = new VoxelModel(10, 22, 7, R16);
  m.box(0, 0, 0, 10, 1, 7, K.graphite);
  for (let x = 0; x < 10; x++) m.set(x, 0, 6, (x >> 1) % 2 ? K.black : K.hydrantYellow);
  // pied : bande verticale aux couleurs du propriétaire
  m.box(2, 1, 1, 8, 12, 6, K.graphite);
  m.box(4, 2, 5, 6, 11, 6, SLOT.TINT1);
  m.box(2, 11, 1, 8, 12, 6, SLOT.TINT2);
  // tête : caisson à face inclinée, écran, clavier, lecteur de carte
  for (let y = 12; y < 21; y++) {
    const zf = y < 15 ? 7 : 7 - Math.round((y - 14) * 0.45);
    m.box(0, y, 0, 10, y + 1, zf, K.gunmetal);
  }
  m.box(0, 12, 0, 10, 13, 7, K.graphite);
  m.box(0, 21, 0, 10, 22, 3, K.graphite);
  for (let y = 15; y < 20; y++) {
    const zf = 7 - Math.round((y - 14) * 0.45);
    m.box(1, y, zf - 1, 9, y + 1, zf, SLOT.SCREEN);
  }
  for (const x of [2, 4, 6]) {
    m.set(x, 13, 6, K.alu);
    m.set(x, 14, 6, K.alu);
  }
  m.box(7, 13, 6, 9, 15, 7, K.black);
  m.box(7, 14, 6, 9, 15, 7, SLOT.NEON_CYAN);
  // voyant de verrouillage et liserés
  m.box(4, 21, 1, 6, 22, 2, SLOT.NEON_RED);
  m.box(0, 12, 0, 1, 21, 1, SLOT.NEON_CYAN);
  m.box(9, 12, 0, 10, 21, 1, SLOT.NEON_CYAN);
  return m;
}

/** Battant de porte générique sombre (les portes sont animées par un autre système). */
function doorLeaf(): VoxelModel {
  const m = new VoxelModel(24, 40, 2, R16).setOrigin(12, 0, 1);
  m.box(0, 0, 0, 24, 40, 2, K.graphite);
  m.box(2, 2, 1, 22, 38, 2, 0x2a2d32);
  m.box(15, 8, 1, 19, 34, 2, SLOT.GLASS);
  m.box(2, 0, 1, 22, 4, 2, K.steel);
  m.box(4, 14, 1, 5, 26, 2, K.chrome);
  return m;
}

/** Portes d'ascenseur en inox brossé, encadrement sombre souligné de LED, indicateur d'étage. */
function elevatorDoor(): VoxelModel {
  const m = new VoxelModel(26, 38, 2, R16).setOrigin(13, 0, 1);
  m.box(0, 0, 0, 26, 38, 2, K.graphite);
  // vantaux en retrait, brossés (bandes verticales)
  for (let x = 3; x < 23; x++) m.box(x, 0, 1, x + 1, 33, 2, x % 2 ? 0xa9b1b9 : 0x9ca4ac);
  m.box(12, 0, 1, 14, 33, 2, 0x5a6068);
  m.box(3, 0, 0, 23, 33, 1, 0x8a929a);
  // liseré LED de l'encadrement
  m.box(2, 0, 1, 3, 34, 2, SLOT.LED);
  m.box(23, 0, 1, 24, 34, 2, SLOT.LED);
  m.box(2, 33, 1, 24, 34, 2, SLOT.LED);
  // indicateur d'étage (flèche et chiffres ambre)
  m.box(9, 34, 1, 17, 38, 2, K.black);
  art(m, ['.#.', '###'], { '#': SLOT.NEON_AMBER }, '+z', 11.5, 36, 1);
  art(m, ['###', '.##', '###'], { '#': SLOT.NEON_AMBER }, '+z', 15, 37, 1);
  // boutons d'appel
  m.box(24, 14, 1, 26, 20, 2, K.alu);
  m.set(24, 18, 1, SLOT.LED).set(24, 16, 1, SLOT.LED);
  return m;
}

/** Rideau métallique ondulé : glissières, caisson, lame finale ; tags (variantes 0 et 2) ou finition anthracite (1). */
function rollupDoor(v: number): VoxelModel {
  const m = new VoxelModel(58, 54, 2, R16).setOrigin(29, 0, 1);
  const base = [0x8a9196, 0x2e3236, 0x4a6a52][v];
  const rib = shade(base, 1.15);
  m.box(0, 0, 0, 2, 54, 2, K.graphite);
  m.box(56, 0, 0, 58, 54, 2, K.graphite);
  m.box(0, 50, 0, 58, 54, 2, K.gunmetal);
  // lames ondulées : bandes de couleur (un relief réel multiplierait les faces)
  const groove = shade(base, 0.78);
  for (let y = 0; y < 50; y++) m.box(2, y, 0, 56, y + 1, 1, y % 3 === 0 ? rib : y % 3 === 1 ? base : groove);
  m.box(2, 0, 0, 56, 2, 1, shade(base, 0.7));
  m.box(26, 2, 0, 32, 3, 1, K.chrome);
  if (v === 1) {
    m.box(2, 2, 0, 56, 3, 1, SLOT.LED);
    m.box(26, 3, 0, 32, 4, 1, K.chrome);
  } else {
    tag(m, v === 0 ? 'KRZ' : 'ZEN', 29, 38, '+z', v === 0 ? 0xe8509a : 0xf0c030, 0xf2f2f2, 3);
    tag(m, 'NYC', 14, 16, '+z', 0x38c8e0, 0x151515, 1);
    if (v === 2) tag(m, 'REX', 44, 18, '+z', 0xe84a2a, 0x151515, 2);
    for (const x of [22, 30, 37]) m.box(x, 18, 0, x + 1, 22, 1, v === 0 ? 0xe8509a : 0xf0c030);
  }
  return m;
}

// ================================================================== MONUMENTS

const BZ = {
  verd: 0x5f9a82,
  verdDk: 0x3f6f5c,
  verdHi: 0x86bba3,
  bronze: 0x6e5128,
  bronzeDk: 0x47331a,
  bronzeHi: 0x92703c,
  polish: 0xc8a25a,
  granite: 0x8f8a84,
  graniteDk: 0x6b6762,
  graniteHi: 0xa9a49d,
  lime: 0xcfc6ae,
  limeDk: 0xa8a08a,
};

/** Ombrage d'un ellipsoïde de bronze : clair au-dessus, sombre dessous. */
function shadeBy(base: number, hi: number, dk: number): (nx: number, ny: number, nz: number) => number {
  return (_nx, ny) => (ny > 0.55 ? hi : ny < -0.45 ? dk : base);
}

/** Socle de granit à degrés, plaque de bronze et petits projecteurs LED. */
function pedestal(m: VoxelModel, c: number, top: number): void {
  const step = (x0: number, y0: number, y1: number, col: number) => m.box(c - x0, y0, c - x0, c + x0, y1, c + x0, col);
  step(13, 0, 2, BZ.graniteDk);
  step(12, 2, 4, BZ.granite);
  step(11, 4, 6, BZ.graniteHi);
  step(9, 6, top - 4, BZ.granite);
  step(11, top - 4, top - 2, BZ.graniteHi);
  step(10, top - 2, top, BZ.granite);
  // plaque et inscription
  m.box(c - 5, 10, c + 9, c + 5, 17, c + 10, BZ.bronze);
  for (const y of [15, 13, 11]) m.box(c - 4, y, c + 9, c + 4, y + 1, c + 10, BZ.bronzeHi);
  for (const [x, z] of [
    [c - 12, c - 12],
    [c + 11, c - 12],
    [c - 12, c + 11],
    [c + 11, c + 11],
  ])
    m.set(x, 4, z, SLOT.LED);
}

/** Bronze patiné : coulures de vert-de-gris sur les parties hautes et quelques taches. */
function patina(base: number, hi: number, dk: number, seed: number): (nx: number, ny: number, nz: number, x: number, y: number, z: number) => number {
  return (_nx, ny, _nz, x, y, z) => {
    const h = hash3(x, y >> 2, z, seed);
    if (ny > 0.35 && h > 0.45) return BZ.verd;
    if (h > 0.9) return BZ.verdDk;
    return ny > 0.55 ? hi : ny < -0.45 ? dk : base;
  };
}

/**
 * Statue allégorique originale (4,6 m) : « la Veilleuse », silhouette drapée en marche, l'orbe lumineux
 * levé à bout de bras (main gauche) et une haute hampe dans la main droite ; bronze patiné de vert-de-gris.
 */
function statue(): VoxelModel {
  const m = new VoxelModel(26, 74, 26, R16);
  const c = 13;
  pedestal(m, c, 24);
  m.box(c - 6, 24, c - 6, c + 6, 25, c + 6, BZ.verdDk);
  const B = BZ.bronze;
  const P = patina(BZ.bronze, BZ.bronzeHi, BZ.bronzeDk, 31);
  // cape gonflée vers l'arrière
  for (let y = 27; y < 57; y++) {
    const w = 4.4 + (57 - y) * 0.09;
    const back = 9 - Math.round((57 - y) * 0.12);
    for (let x = Math.round(c - w); x < Math.round(c + w); x++) {
      const streak = hash3(x, 0, 3, 7) > 0.7;
      m.box(x, y, back, x + 1, y + 1, 11, streak ? BZ.verd : (x + (y >> 2)) % 4 === 0 ? BZ.bronzeDk : B);
    }
  }
  // robe : jambe gauche en avant (pas de marche), plis et coulures
  lathe(m, c, c + 0.5, 25, 45, (y) => 3.9 + ((45 - y) / 20) * 1.5, (_y, a, _d, x, z) => {
    const fold = Math.sin(a * 9);
    if (hash3(x, 1, z, 5) > 0.78 && fold < 0) return BZ.verd;
    return fold < -0.5 ? BZ.bronzeDk : fold > 0.7 ? BZ.bronzeHi : B;
  });
  blob(m, c + 2, 31, c + 4.5, 2.2, 6, 2.6, P);
  m.box(c + 1, 25, c + 5, c + 4, 26, c + 9, BZ.bronzeHi);
  m.box(c - 3, 25, c + 3, c, 26, c + 6, BZ.bronzeDk);
  // buste, ceinture tressée, épaules
  blob(m, c, 51, c, 4, 6.6, 3.1, P);
  m.box(c - 4, 45, c - 3, c + 4, 46, c + 4, BZ.polish);
  blob(m, c, 55.5, c, 5.3, 1.9, 3, P);
  // tête nue, cheveux courts tirés en arrière
  m.box(c - 1, 56, c - 1, c + 1, 59, c + 1, B);
  blob(m, c, 61.5, c + 0.4, 2.3, 2.8, 2.4, shadeBy(BZ.bronze, BZ.bronzeHi, BZ.bronzeDk));
  blob(m, c, 62.5, c - 0.8, 2.4, 2.3, 2.3, (_nx, ny) => (ny > 0.5 ? BZ.verd : BZ.bronzeDk));
  m.set(c - 1, 61, c + 2, BZ.bronzeDk).set(c, 61, c + 2, BZ.bronzeDk);
  // bras gauche levé en oblique, orbe lumineux cerclé d'un anneau
  seg(m, [c + 4.5, 55, c], [c + 7, 60.5, c + 0.5], [2, 2, 2], B);
  seg(m, [c + 7, 60.5, c + 0.5], [c + 8, 66, c + 1], [2, 2, 2], B);
  m.box(c + 6, 66, c - 1, c + 10, 67, c + 3, BZ.bronzeHi);
  m.sphere(c + 8, 69.5, c + 1, 2.6, SLOT.GLOW);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    m.set(Math.floor(c + 8 + Math.cos(a) * 3.6), Math.floor(69.5 + Math.sin(a) * 1.0), Math.floor(c + 1 + Math.sin(a) * 3.6), BZ.polish);
  }
  // bras droit tenant la hampe
  seg(m, [c - 4.5, 55, c], [c - 6, 50, c + 1.5], [2, 2, 2], B);
  seg(m, [c - 6, 50, c + 1.5], [c - 7, 46, c + 3], [2, 2, 2], B);
  m.box(c - 8, 25, c + 2, c - 7, 66, c + 3, BZ.bronzeDk);
  m.box(c - 9, 45, c + 1, c - 6, 47, c + 4, B);
  m.box(c - 9, 66, c + 1, c - 6, 69, c + 4, BZ.polish);
  m.box(c - 8, 69, c + 2, c - 7, 71, c + 3, BZ.polish);
  return m;
}

/** Taureau de bronze original, chargeant tête baissée, sur un socle de granit bas. */
function bullStatue(): VoxelModel {
  const m = new VoxelModel(26, 30, 54, R16).setOrigin(13, 0, 27);
  const c = 13;
  rbox(m, 0, 0, 0, 26, 2, 54, BZ.graniteDk);
  m.box(1, 2, 1, 25, 3, 53, BZ.granite);
  const B = shadeBy(BZ.bronze, BZ.bronzeHi, BZ.bronzeDk);
  // jambes (cuisse épaisse, canon fin, sabot sombre)
  const leg = (top: V3, knee: V3, hoof: V3) => {
    seg(m, top, knee, [4, 3, 4], BZ.bronze);
    seg(m, knee, hoof, [2, 2, 3], BZ.bronze);
    m.box(Math.round(hoof[0]) - 1, 3, Math.round(hoof[2]) - 1, Math.round(hoof[0]) + 2, 5, Math.round(hoof[2]) + 2, BZ.bronzeDk);
  };
  leg([c - 4, 14, 38], [c - 4.5, 9, 42], [c - 4.5, 5, 45]);
  leg([c + 4, 14, 36], [c + 4.5, 9, 36], [c + 4.5, 5, 34]);
  leg([c - 4, 14, 15], [c - 4.5, 9, 10], [c - 4.5, 5, 6]);
  leg([c + 4, 14, 17], [c + 4.5, 9, 13], [c + 4.5, 5, 11]);
  // masses du corps : arrière-train, ventre, poitrail, bosse
  blob(m, c, 17.5, 16, 7.2, 6.5, 8.5, B);
  blob(m, c, 16.5, 25, 7.2, 5.8, 9.5, B);
  blob(m, c, 18.5, 33, 8.6, 8, 9, B);
  blob(m, c, 21.5, 33, 6.2, 4.6, 7, B);
  // encolure et tête baissée, mufle poli
  blob(m, c, 16, 41.5, 5.6, 6, 5, B);
  blob(m, c, 11, 46.5, 4, 5, 4.2, B);
  blob(m, c, 7.5, 49.5, 3.2, 3, 3, BZ.polish);
  m.set(c - 2, 7, 52, BZ.bronzeDk).set(c + 1, 7, 52, BZ.bronzeDk);
  m.set(c - 3, 12, 49, 0x1a120a).set(c + 2, 12, 49, 0x1a120a);
  // cornes recourbées vers l'avant (polies)
  for (const s of [-1, 1]) {
    bez(m, [c + s * 3, 14, 45], [c + s * 7.5, 14.5, 45.5], [c + s * 8, 17.5, 49], [2, 2, 2], BZ.bronzeHi);
    bez(m, [c + s * 8, 17.5, 49], [c + s * 8, 19, 50.5], [c + s * 7, 19.5, 52], [1, 1, 1], BZ.polish);
    blob(m, c + s * 3.4, 15, 44, 1.4, 1.3, 1.4, BZ.bronze);
  }
  // queue fouettée
  bez(m, [c, 19, 8], [c, 27, 2], [c - 1, 27, 9], [2, 2, 2], BZ.bronze);
  blob(m, c - 1, 26.5, 10, 1.5, 1.5, 1.5, BZ.bronzeDk);
  return m;
}

/** Fontaine à l'ange (création originale) : socle, vasque débordante (eau en LED bleutée), ange aux ailes déployées. */
function fountainAngel(): VoxelModel {
  const m = new VoxelModel(22, 64, 22, R16);
  const c = 11;
  // éclaboussures et socle octogonal
  lathe(m, c, c, 0, 1, 11, (_y, _a, d) => (d > 8.6 ? SLOT.NEON_CYAN : BZ.limeDk));
  lathe(m, c, c, 1, 3, 8.4, BZ.lime);
  lathe(m, c, c, 3, 5, 6.6, BZ.limeDk);
  lathe(m, c, c, 5, 13, (y) => 5.2 - (y - 5) * 0.15, BZ.lime);
  lathe(m, c, c, 13, 15, 5.4, BZ.limeDk);
  // vasque : dessous en cône, lèvre, plan d'eau, rideau d'eau
  lathe(m, c, c, 15, 19, (y) => 5 + (y - 15) * 1.6, BZ.lime);
  lathe(m, c, c, 19, 20, 11, (_y, _a, d) => (d > 10 ? BZ.limeDk : -2));
  lathe(m, c, c, 19, 20, 10, (_y, _a, d) => (Math.abs(d - 7) < 0.5 || Math.abs(d - 4) < 0.5 ? SLOT.NEON_CYAN : SLOT.LED));
  for (let k = 0; k < 28; k++) {
    const a = ((k + 0.5) / 28) * Math.PI * 2;
    for (let y = 1; y < 19; y++) {
      if (hash3(k, y >> 1, 0, 17) < 0.5) continue;
      const r = 10.2 + (19 - y) * 0.04;
      m.set(Math.floor(c + Math.sin(a) * r), y, Math.floor(c + Math.cos(a) * r), (y + k) % 4 === 0 ? SLOT.LED : SLOT.NEON_CYAN);
    }
  }
  // fût supérieur
  lathe(m, c, c, 20, 25, 2.8, BZ.lime);
  lathe(m, c, c, 25, 26, 3.6, BZ.limeDk);
  // ange : robe, buste, tête, ailes, bras bénissant, lys
  const V = BZ.verd;
  const shadeV = shadeBy(BZ.verd, BZ.verdHi, BZ.verdDk);
  lathe(m, c, c, 26, 42, (y) => 2.4 + ((42 - y) / 16) * 1.4, (_y, a) => (Math.sin(a * 7) < -0.55 ? BZ.verdDk : V));
  blob(m, c, 46.5, c, 2.9, 5, 2.3, shadeV);
  blob(m, c, 50.5, c, 3.8, 1.5, 2.2, shadeV);
  m.box(c - 1, 51, c - 1, c + 1, 53, c + 1, V);
  blob(m, c, 55, c + 0.3, 1.9, 2.3, 2, shadeV);
  blob(m, c, 55.8, c - 1.3, 1.6, 1.6, 1.3, BZ.verdDk);
  for (const s of [-1, 1]) {
    // aile : bord d'attaque en arc, rémiges plus longues vers la pointe, balayée vers l'arrière
    for (let k = 0; k < 11; k++) {
      const t = k / 10;
      const x = c + (s > 0 ? k : -1 - k);
      const top = 49 + 12 * (1 - (1 - t) * (1 - t));
      const bot = k < 7 ? 46 - k * 0.5 : 42.5 + (k - 7) * 3.2;
      const z = c - 3 - Math.round(k * 0.3);
      for (let y = Math.round(bot); y <= Math.round(top); y++) {
        const edge = y >= Math.round(top) - 1;
        const primary = k >= 5 && (k & 1) === 1;
        m.set(x, y, z, edge ? BZ.verdHi : primary ? BZ.verdDk : (y & 3) === 0 && k < 5 ? BZ.verdDk : V);
        if (k < 5) m.set(x, y, z - 1, BZ.verdDk);
      }
    }
  }
  // bras droit tendu (bénédiction), bras gauche tenant un lys
  seg(m, [c - 3, 50, c], [c - 4, 50.5, c + 4], [2, 2, 2], V);
  seg(m, [c - 4, 50.5, c + 4], [c - 3.5, 52, c + 7], [2, 2, 2], V);
  seg(m, [c + 3, 50, c], [c + 4, 46, c + 1.5], [2, 2, 2], V);
  seg(m, [c + 4, 46, c + 1.5], [c + 3, 44, c + 3], [2, 2, 2], V);
  seg(m, [c + 3, 40, c + 3.5], [c + 3, 53, c + 3.5], [1, 1, 1], BZ.verdDk);
  m.box(c + 2, 52, c + 3, c + 5, 54, c + 5, BZ.verdHi);
  return m;
}

/** Boule du Nouvel An (Times Square) : sphère à facettes lumineuses animées, joints argentés, éclats LED. */
function ballTower(): VoxelModel {
  const m = new VoxelModel(32, 32, 32, R16);
  const c = 16;
  const R = 15;
  const lats = [-0.82, -0.5, -0.18, 0.18, 0.5, 0.82].map((s) => s * R);
  for (let y = 0; y < 32; y++)
    for (let z = 0; z < 32; z++)
      for (let x = 0; x < 32; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        const dz = z + 0.5 - c;
        const d = Math.hypot(dx, dy, dz);
        if (d > R) continue;
        if (d < R - 1.6) {
          m.set(x, y, z, K.graphite);
          continue;
        }
        let seam = lats.some((l) => Math.abs(dy - l) < 0.5);
        for (let k = 0; k < 6 && !seam; k++) {
          const a = (k * Math.PI) / 6 + (Math.floor((dy + R) / (R / 3)) % 2) * (Math.PI / 12);
          if (Math.abs(dx * Math.sin(a) - dz * Math.cos(a)) < 0.55) seam = true;
        }
        const spark = seam && hash3(x, y, z, 21) > 0.86;
        m.set(x, y, z, spark ? SLOT.LED : seam ? K.alu : SLOT.SCREEN);
      }
  // collier inférieur et couronne sommitale
  lathe(m, c, c, 0, 2, 3.2, K.alu);
  lathe(m, c, c, 30, 32, 2.6, (y) => (y === 31 ? SLOT.NEON_AMBER : K.alu));
  return m;
}

// ================================================================== registre

export const STREET_MODELS: Partial<Record<PropKind, PropModelEntry>> = {
  // rue
  STREET_LIGHT: { variants: 1, make: () => streetLight() },
  STREET_LIGHT_DOUBLE: { variants: 1, make: () => streetLightDouble() },
  PARK_LAMP: { variants: 1, make: () => parkLamp() },
  TRAFFIC_LIGHT: { variants: 1, make: () => trafficLight() },
  HYDRANT: { variants: 3, make: (v) => hydrant(v % 3) },
  TRASH_CAN: { variants: 3, make: (v) => (v % 3 === 1 ? solarBin() : litterBasket(v % 3 === 2 ? 1 : 0)) },
  MAILBOX: { variants: 1, make: () => droneLocker() },
  STEAM_VENT: { variants: 2, make: (v) => steamVent(v % 2) },
  HOLO_KIOSK: { variants: 1, make: () => holoKiosk() },
  VENDING_MACHINE: { variants: 2, make: (v) => vendingMachine(v % 2) },
  FOOD_CART: { variants: 3, make: (v) => foodCart(v % 3) },
  BENCH: { variants: 2, make: (v) => bench(v % 2) },
  BOLLARD: { variants: 1, make: () => bollard() },
  BIKE_RACK: { variants: 3, make: (v) => bikeRack(v % 3) },
  HOLO_BOOTH: { variants: 1, make: () => holoBooth() },
  PLANTER: { variants: 3, make: (v) => planter(v % 3) },
  SUBWAY_GLOBE: { variants: 1, make: () => subwayGlobe() },
  RAILING: { variants: 1, make: () => railing() },
  JERSEY_BARRIER: { variants: 3, make: (v) => jerseyBarrier(v % 3) },
  TRAFFIC_CONE: { variants: 1, make: () => trafficCone() },
  DUMPSTER: { variants: 3, make: (v) => dumpster(v % 3) },
  AD_COLUMN: { variants: 1, make: () => adColumn() },
  BUS_SHELTER: { variants: 1, make: () => busShelter() },
  NEWS_STAND: { variants: 1, make: () => newsStand() },
  SIGN_STREET: { variants: 3, make: (v) => streetSign(v % 3) },
  PARKING_METER: { variants: 1, make: () => parkingMeter() },
  CHARGING_POST: { variants: 1, make: () => chargingPost() },
  SCAFFOLD: { variants: 1, make: () => scaffold() },
  CAR_PARKED: { variants: 8, make: (v) => hoverCar(CAR_STYLES[v % 8]) },
  TAXI_PARKED: { variants: 2, make: (v) => hoverCar({ body: 0xf2b400, accent: K.black, glow: -1, taxi: v % 2 === 0 ? 1 : 2 }) },
  VAN_PARKED: { variants: 3, make: (v) => hoverVan(v % 3) },
  // toits et façades
  AC_UNIT: { variants: 3, make: (v) => acUnit(v % 3) },
  AC_WINDOW: { variants: 1, make: () => acWindow() },
  ROOF_VENT: { variants: 1, make: () => roofVent() },
  SAT_DISH: { variants: 1, make: () => satDish() },
  ANTENNA: { variants: 1, make: () => antenna() },
  NEON_SIGN: { variants: 8, make: (v) => neonBlade(v % 8) },
  NEON_WALL_SIGN: { variants: 8, make: (v) => neonWallSign(v % 8) },
  LANTERN_RED: { variants: 1, make: () => lanternRed() },
  LANTERN_STRING: { variants: 1, make: () => lanternString() },
  SECURITY_CAMERA: { variants: 1, make: () => securityCamera() },
  SECURITY_PANEL: { variants: 1, make: () => securityPanel() },
  FLAG_BANNER: { variants: 1, make: () => flagBanner() },
  DOOR_LEAF: { variants: 1, make: () => doorLeaf() },
  ELEVATOR_DOOR: { variants: 1, make: () => elevatorDoor() },
  ROLLUP_DOOR: { variants: 3, make: (v) => rollupDoor(v % 3) },
  // monuments
  STATUE: { variants: 1, make: () => statue() },
  BULL_STATUE: { variants: 1, make: () => bullStatue() },
  FOUNTAIN_ANGEL: { variants: 1, make: () => fountainAngel() },
  BALL_TOWER: { variants: 1, make: () => ballTower() },
};
