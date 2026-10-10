// Bureaux, commandement, armurerie, industrie, commerces et loisirs (New York 2085).
// Résolution 1/16 m, origine au centre de la base, l'avant regarde vers +Z.
// Les objets muraux ont le dos contre le mur (z = 0). Les pièces maîtresses du QG
// (table holographique, console, mur d'écrans, bureau et fauteuil du parrain, râtelier)
// prennent les couleurs du propriétaire (emplacements TINT).

import { PROP_DEFS, type PropKind } from '../../../shared/city/props';
import { SLOT, VoxelModel, mix, shade } from '../voxelModel';
import type { PropModelEntry } from './index';

type M = VoxelModel;

// ====================================================================== palette

const K = {
  // métaux
  black: 0x131417,
  carbon: 0x1d1f23,
  gunDk: 0x23262c,
  gun: 0x2f343b,
  gunLt: 0x48505a,
  steel: 0x6b737d,
  steelLt: 0x959ea8,
  alu: 0xb4bbc3,
  chrome: 0xc8d0d8,
  chromeHi: 0xe6ebf0,
  gold: 0xd4a640,
  goldLt: 0xf0cf74,
  goldDk: 0x9a7224,
  brass: 0xb8923e,
  brassLt: 0xdcbc68,
  brassDk: 0x7a5f24,
  copper: 0xb06a3a,
  copperDk: 0x7a4426,
  rust: 0x7a3e22,
  // bois
  walnut: 0x5a3a24,
  walnutDk: 0x3c2516,
  walnutLt: 0x74502f,
  mahog: 0x4f2318,
  mahogDk: 0x36150d,
  rosewood: 0x3d1a12,
  oak: 0x9a7040,
  oakDk: 0x6a4626,
  pine: 0xb08c5c,
  pineDk: 0x86663e,
  pineLt: 0xc8a674,
  // pierre, verre
  marble: 0xe8e5de,
  marbleVein: 0xb9b4aa,
  marbleBlk: 0x1e1d1f,
  marbleBlkVein: 0x46434a,
  lacquer: 0x18171a,
  // cuirs, tissus
  leather: 0x1e1b1b,
  leatherHi: 0x2c2827,
  leatherRed: 0x6e1c1c,
  leatherBrn: 0x5a3220,
  velvet: 0x7a1820,
  velvetDk: 0x4e0e14,
  velvetLt: 0x9a2630,
  feltGreen: 0x1f6a42,
  feltTeal: 0x16676a,
  feltRed: 0x6a1a22,
  feltBlue: 0x1f3f7a,
  mesh: 0x2a2c31,
  canvas: 0xe8dec6,
  // plastiques, caoutchouc
  white: 0xe6e8ea,
  plastW: 0xd2d6da,
  plastG: 0x8c9198,
  plastDk: 0x3a3e44,
  rubber: 0x1a1a1c,
  tire: 0x222224,
  // industriels
  yellow: 0xe2b21c,
  yellowDk: 0xa8800e,
  orange: 0xd8641e,
  orangeDk: 0x9a4412,
  red: 0xb02026,
  redDk: 0x7a1418,
  olive: 0x4f5838,
  oliveDk: 0x363d26,
  green: 0x2d5a3a,
  blue: 0x2a4f86,
  blueDk: 0x1a3058,
  navy: 0x1a2a48,
  cardboard: 0xb48c5a,
  cardboardDk: 0x8e6a40,
  wrap: 0xc4d0d6,
  concrete: 0x8a8884,
  // papier, billets
  paper: 0xe8e2d0,
  paperDk: 0xc8bea4,
  cash: 0x6f8f5e,
  cashDk: 0x4e6a42,
  // divers
  ink: 0x222222,
  holoDk: 0x0c3a46,
  holoBg: 0x07141a,
  water: 0x0a1e2a,
};

// ====================================================================== outils

/** Modèle aux dimensions de l'encombrement (hauteur supplémentaire possible : hologrammes, vapeur…). */
function mk(kind: PropKind, extraH = 0): M {
  const s = PROP_DEFS[kind].size;
  return VoxelModel.meters(s[0], s[1] + extraH, s[2]);
}

/** Hachage déterministe → [0,1). */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647) + Math.imul(seed | 0, 1013904223)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffff) / 65536;
}

/** Générateur pseudo-aléatoire (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Repeint les cases pleines d'une boîte. */
function paint(m: M, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): M {
  for (let y = Math.max(0, y0); y < Math.min(m.sy, y1); y++)
    for (let z = Math.max(0, z0); z < Math.min(m.sz, z1); z++)
      for (let x = Math.max(0, x0); x < Math.min(m.sx, x1); x++) if (m.get(x, y, z) >= 0) m.set(x, y, z, c);
  return m;
}

/** Boîte aux arêtes verticales abattues (chanfrein de k voxels). */
function cbox(m: M, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number, k = 1): M {
  m.box(x0, y0, z0, x1, y1, z1, c);
  for (let i = 0; i < k; i++)
    for (let j = 0; i + j < k; j++)
      for (const [x, z] of [
        [x0 + i, z0 + j],
        [x1 - 1 - i, z0 + j],
        [x0 + i, z1 - 1 - j],
        [x1 - 1 - i, z1 - 1 - j],
      ])
        m.box(x, y0, z, x + 1, y1, z + 1, -1);
  return m;
}

/** Quatre pieds carrés (t voxels de côté) aux coins d'un rectangle. */
function legs4(m: M, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, c: number, t = 1): M {
  m.box(x0, y0, z0, x0 + t, y1, z0 + t, c);
  m.box(x1 - t, y0, z0, x1, y1, z0 + t, c);
  m.box(x0, y0, z1 - t, x0 + t, y1, z1, c);
  m.box(x1 - t, y0, z1 - t, x1, y1, z1, c);
  return m;
}

/**
 * Pixel art : `rows` de haut en bas, chaque caractère → couleur via `legend` (espace ou '.' = rien).
 * 'xy' : face avant à z (colonnes +x, lignes −y depuis b0) ; 'zy' : plan à x (colonnes +z) ;
 * 'xz' : dessus à y (colonnes +x, lignes +z depuis b0).
 */
function pix(m: M, rows: string[], legend: Record<string, number>, plane: 'xy' | 'zy' | 'xz', a0: number, b0: number, c: number, depth = 1): M {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let k = 0; k < row.length; k++) {
      const col = legend[row[k]];
      if (col === undefined) continue;
      for (let d = 0; d < depth; d++) {
        if (plane === 'xy') m.set(a0 + k, b0 - r, c + d, col);
        else if (plane === 'zy') m.set(c + d, b0 - r, a0 + k, col);
        else m.set(a0 + k, c + d, b0 + r, col);
      }
    }
  }
  return m;
}

/** Police 3×5 des petites inscriptions. */
const FONT: Record<string, string[]> = {
  A: ['.k.', 'k.k', 'kkk', 'k.k', 'k.k'],
  B: ['kk.', 'k.k', 'kk.', 'k.k', 'kk.'],
  C: ['.kk', 'k..', 'k..', 'k..', '.kk'],
  D: ['kk.', 'k.k', 'k.k', 'k.k', 'kk.'],
  E: ['kkk', 'k..', 'kk.', 'k..', 'kkk'],
  F: ['kkk', 'k..', 'kk.', 'k..', 'k..'],
  G: ['.kk', 'k..', 'k.k', 'k.k', '.kk'],
  H: ['k.k', 'k.k', 'kkk', 'k.k', 'k.k'],
  I: ['k', 'k', 'k', 'k', 'k'],
  K: ['k.k', 'kk.', 'k..', 'kk.', 'k.k'],
  L: ['k..', 'k..', 'k..', 'k..', 'kkk'],
  M: ['k...k', 'kk.kk', 'k.k.k', 'k...k', 'k...k'],
  N: ['k..k', 'kk.k', 'k.kk', 'k..k', 'k..k'],
  O: ['.k.', 'k.k', 'k.k', 'k.k', '.k.'],
  P: ['kk.', 'k.k', 'kk.', 'k..', 'k..'],
  R: ['kk.', 'k.k', 'kk.', 'k.k', 'k.k'],
  S: ['.kk', 'k..', '.k.', '..k', 'kk.'],
  T: ['kkk', '.k.', '.k.', '.k.', '.k.'],
  U: ['k.k', 'k.k', 'k.k', 'k.k', 'kkk'],
  V: ['k.k', 'k.k', 'k.k', 'k.k', '.k.'],
  W: ['k...k', 'k...k', 'k.k.k', 'kk.kk', 'k...k'],
  X: ['k.k', 'k.k', '.k.', 'k.k', 'k.k'],
  Y: ['k.k', 'k.k', '.k.', '.k.', '.k.'],
  '0': ['kkk', 'k.k', 'k.k', 'k.k', 'kkk'],
  '1': ['.k', 'kk', '.k', '.k', '.k'],
  '2': ['kk.', '..k', '.k.', 'k..', 'kkk'],
  '3': ['kk.', '..k', '.k.', '..k', 'kk.'],
  '4': ['k.k', 'k.k', 'kkk', '..k', '..k'],
  '5': ['kkk', 'k..', 'kk.', '..k', 'kk.'],
  '6': ['.kk', 'k..', 'kkk', 'k.k', 'kkk'],
  '7': ['kkk', '..k', '.k.', '.k.', '.k.'],
  '8': ['kkk', 'k.k', 'kkk', 'k.k', 'kkk'],
  '9': ['kkk', 'k.k', 'kkk', '..k', 'kk.'],
  '+': ['...', '.k.', 'kkk', '.k.', '...'],
  '-': ['...', '...', 'kkk', '...', '...'],
  '.': ['.', '.', '.', '.', 'k'],
  ' ': ['.', '.', '.', '.', '.'],
};

function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += (FONT[ch] ?? FONT[' '])[0].length + 1;
  return w - 1;
}

/** Texte en pixels : put(u, ligne) → case, u le long du sens de lecture. */
function textAt(m: M, s: string, col: number, put: (u: number, row: number) => [number, number, number]): number {
  let u = 0;
  for (const ch of s) {
    const g = FONT[ch] ?? FONT[' '];
    for (let r = 0; r < 5; r++) for (let k = 0; k < g[r].length; k++) if (g[r][k] === 'k') m.set(...put(u + k, r), col);
    u += g[0].length + 1;
  }
  return u - 1;
}

/** Texte sur la face avant (+Z) : lit de gauche à droite depuis (x0, yTop). */
function textFront(m: M, s: string, x0: number, yTop: number, z: number, col: number): number {
  return textAt(m, s, col, (u, r) => [x0 + u, yTop - r, z]);
}

/** Ligne de voxels sans trous diagonaux. */
function line6(m: M, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): M {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 1) * 2;
  let px = Math.floor(x0);
  let py = Math.floor(y0);
  let pz = Math.floor(z0);
  m.set(px, py, pz, c);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = Math.floor(x0 + (x1 - x0) * t);
    const y = Math.floor(y0 + (y1 - y0) * t);
    const z = Math.floor(z0 + (z1 - z0) * t);
    while (px !== x || py !== y || pz !== z) {
      if (px !== x) px += Math.sign(x - px);
      else if (py !== y) py += Math.sign(y - py);
      else pz += Math.sign(z - pz);
      m.set(px, py, pz, c);
    }
  }
  return m;
}

/** Disque (ou anneau) dans le plan XY, entre z0 et z1. */
function discXY(m: M, cx: number, cy: number, r: number, z0: number, z1: number, c: number | ((dx: number, dy: number, d: number) => number)): M {
  for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r); x++)
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r); y++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const col = typeof c === 'number' ? c : c(dx, dy, d);
      if (col === -2) continue;
      m.box(x, y, z0, x + 1, y + 1, z1, col);
    }
  return m;
}

/** Disque (ou anneau) horizontal, entre y0 et y1. */
function discXZ(m: M, cx: number, cz: number, r: number, y0: number, y1: number, c: number | ((dx: number, dz: number, d: number) => number)): M {
  for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r); x++)
    for (let z = Math.floor(cz - r - 1); z <= Math.ceil(cz + r); z++) {
      const dx = x + 0.5 - cx;
      const dz = z + 0.5 - cz;
      const d = Math.hypot(dx, dz);
      if (d > r) continue;
      const col = typeof c === 'number' ? c : c(dx, dz, d);
      if (col === -2) continue;
      m.box(x, y0, z, x + 1, y1, z + 1, col);
    }
  return m;
}

/** Écusson du propriétaire (bouclier) sur la face avant à z : 7 × 7 ou 5 × 6 voxels, haut à yTop. */
function crest(m: M, x0: number, yTop: number, z: number, small = false, depth = 1): M {
  const rows = small
    ? ['ttttt', 't1d1t', 't1d1t', 't111t', '.t1t.', '..t..']
    : ['ttttttt', 't11d11t', 't1ddd1t', 't11d11t', 't11d11t', '.t111t.', '..ttt..'];
  return pix(m, rows, { t: SLOT.TINT2, '1': SLOT.TINT1, d: SLOT.TINT2 }, 'xy', x0, yTop, z, depth);
}

/** Moniteur sur la face avant : cadre (z) et dalle (z+1) en retrait d'un voxel. */
function monitor(m: M, x0: number, y0: number, x1: number, y1: number, z: number, bezel: number, face: number = SLOT.SCREEN): M {
  m.box(x0, y0, z, x1, y1, z + 2, bezel);
  m.box(x0 + 1, y0 + 1, z + 1, x1 - 1, y1 - 1, z + 2, face);
  return m;
}

/** Bandes de danger diagonales sur une face avant (z), sur les cases déjà pleines si `onlyFull`. */
function hazardXY(m: M, x0: number, y0: number, x1: number, y1: number, z: number, a: number, b: number, w = 2): M {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m.set(x, y, z, Math.floor((x + y) / w) % 2 ? a : b);
  return m;
}

/** Aplatit les couleurs proches (bruit doux par blocs sur une couleur donnée). */
function blockTone(m: M, only: (c: number) => boolean, amount: number, seed: number, bs = 3): M {
  return m.forEach((x, y, z, c) => {
    if (c >= 0xf00000 || !only(c)) return;
    const h = hash3(Math.floor(x / bs), Math.floor(y / bs), Math.floor(z / bs), seed);
    return shade(c, 1 + (h * 2 - 1) * amount);
  });
}

/** Veinage le long d'un axe (les faces fusionnent dans le sens du fil). */
function grain(m: M, axis: 'x' | 'y' | 'z', amount: number, seed: number, only: (c: number) => boolean): M {
  return m.forEach((x, y, z, c) => {
    if (c >= 0xf00000 || !only(c)) return;
    const h = axis === 'x' ? hash3(0, y, z, seed) : axis === 'y' ? hash3(x, 0, z, seed) : hash3(x, y, 0, seed);
    return shade(c, 1 + (h * 2 - 1) * amount);
  });
}

const is = (...cs: number[]) => {
  const s = new Set(cs);
  return (c: number) => s.has(c);
};

/** Interpolation linéaire par morceaux. */
function prof(t: number, pts: [number, number][]): number {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1];
      const [t1, v1] = pts[i];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return pts[pts.length - 1][1];
}

// ====================================================================== carte de New York

/** Types de cases de la carte stylisée. */
const MAP_WATER = 0;
const MAP_ISLAND = 1;
const MAP_PARK = 2;
const MAP_SHORE = 3;

interface NycMap {
  w: number;
  d: number;
  cell: Uint8Array;
  /** Position le long de l'île (0 = Battery, 1 = Inwood) et écart latéral (cases, + = est). */
  t: Float32Array;
  s: Float32Array;
  /** Point de la carte (cases) à partir de coordonnées (t, s). */
  at: (t: number, s: number) => [number, number];
}

/**
 * Carte stylisée de New York sur une grille w × d (x = colonnes, z = lignes) : Manhattan couché
 * dans la longueur (le nord vers +x), Brooklyn/Queens/Bronx vers +z, le New Jersey vers −z.
 */
function nycMap(w: number, d: number): NycMap {
  const cell = new Uint8Array(w * d);
  const T = new Float32Array(w * d);
  const S = new Float32Array(w * d);
  const ax = 0.02 * w;
  const az = 0.68 * d;
  const bx = 0.99 * w;
  const bz = 0.33 * d;
  const L = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / L;
  const uz = (bz - az) / L;
  const nx = -uz;
  const nz = ux;
  const k = d / 16; // échelle des largeurs (Manhattan occupe toute la longueur)
  const hwW = (t: number) => k * prof(t, [[0, 0.5], [0.04, 1.5], [0.12, 2.4], [0.3, 2.8], [0.5, 2.6], [0.75, 2.2], [0.9, 1.5], [1, 0.4]]);
  const hwE = (t: number) => k * prof(t, [[0, 0.5], [0.04, 1.8], [0.14, 3.2], [0.22, 3.9], [0.3, 3.0], [0.5, 2.6], [0.75, 2.0], [0.9, 1.3], [1, 0.4]]);
  for (let j = 0; j < d; j++)
    for (let i = 0; i < w; i++) {
      const px = i + 0.5 - ax;
      const pz = j + 0.5 - az;
      const t = (px * ux + pz * uz) / L;
      const s = px * nx + pz * nz;
      const id = j * w + i;
      T[id] = t;
      S[id] = s;
      const tc = Math.min(1, Math.max(0, t));
      let c = MAP_WATER;
      if (t >= 0 && t <= 1 && s >= -hwW(t) && s <= hwE(t)) {
        c = MAP_ISLAND;
        if (t > 0.47 && t < 0.63 && s > -1.1 * k && s < 1.3 * k) c = MAP_PARK;
      } else {
        // East River puis Harlem River (Brooklyn, Queens, Bronx), Hudson (New Jersey), baie au sud
        const east = hwE(tc) + (t < 0.62 ? 1.5 * k : 1.0 * k) + (t < 0 ? -t * 40 : 0) + (t > 1 ? -(t - 1) * 30 : 0);
        const west = -(hwW(tc) + 2.2 * k + (t < 0.06 ? (0.06 - t) * 40 : 0));
        if (s > east || s < west) c = MAP_SHORE;
        // Governors Island, Roosevelt Island
        if (Math.hypot((t + 0.035) * 9, s - 2.4 * k) < 0.9 * k) c = MAP_SHORE;
        if (t > 0.4 && t < 0.5 && Math.abs(s - (hwE(t) + 0.75 * k)) < 0.4) c = MAP_SHORE;
      }
      cell[id] = c;
    }
  const at = (t: number, s: number): [number, number] => [Math.floor(ax + t * L * ux + s * nx), Math.floor(az + t * L * uz + s * nz)];
  return { w, d, cell, t: T, s: S, at };
}

// ====================================================================== commandement du QG

/**
 * Table holographique (3 × 2 m) : plateau de verre noir où flotte une maquette lumineuse de
 * Manhattan (tours en tranches cyan et rose, Central Park, ponts), bord lumineux, socle massif.
 * Variante 1 : cadre aux couleurs du propriétaire.
 */
function holoTable(v: number): M {
  const m = mk('HOLO_TABLE', 1.0);
  const W = m.sx;
  const D = m.sz;
  const tinted = v % 2 === 1;
  const frame = tinted ? SLOT.TINT1 : K.gunDk;
  const trim = tinted ? SLOT.TINT2 : K.gunLt;
  const dark = tinted ? SLOT.TINT3 : K.black;
  // ---- socle : plinthe, marche lumineuse, colonne à rainures, chapiteau évasé
  cbox(m, 7, 0, 6, W - 7, 2, D - 6, dark, 3);
  cbox(m, 9, 2, 8, W - 9, 3, D - 8, SLOT.NEON_CYAN, 3);
  cbox(m, 11, 2, 10, W - 11, 10, D - 10, K.carbon, 2);
  for (const x of [15, 19, 23, 24, 28, 32]) {
    m.box(x, 4, 9, x + 1, 9, 10, x === 23 || x === 24 ? SLOT.NEON_CYAN : K.gunLt);
    m.box(x, 4, D - 10, x + 1, 9, D - 9, x === 23 || x === 24 ? SLOT.NEON_CYAN : K.gunLt);
  }
  for (const z of [14, 17]) {
    m.box(10, 4, z, 11, 9, z + 1, K.gunLt);
    m.box(W - 11, 4, z, W - 10, 9, z + 1, K.gunLt);
  }
  cbox(m, 8, 9, 7, W - 8, 10, D - 7, frame, 3);
  cbox(m, 5, 10, 4, W - 5, 11, D - 4, dark, 4);
  // ---- plateau : bord chanfreiné, liseré lumineux, écrans de données sur les grands côtés
  const ch = 4;
  const edge = (x: number, z: number): number => {
    const ex = Math.min(x, W - 1 - x);
    const ez = Math.min(z, D - 1 - z);
    return Math.min(ex, ez, ex + ez - ch);
  };
  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      const e = edge(x, z);
      if (e < 0) continue;
      m.box(x, 11, z, x + 1, 14, z + 1, e === 0 ? frame : dark);
      if (e === 0) m.set(x, 11, z, SLOT.NEON_CYAN);
      // dessus du cadre : bord, filet métal, cadre lumineux intérieur
      if (e === 0) m.set(x, 14, z, frame);
      else if (e === 1) m.set(x, 14, z, trim);
      else if (e === 2) m.set(x, 14, z, SLOT.NEON_CYAN);
    }
  for (const [x0, x1] of [
    [9, 19],
    [29, 39],
  ]) {
    m.box(x0, 12, D - 1, x1, 14, D, SLOT.SCREEN);
    m.box(x0, 12, 0, x1, 14, 1, SLOT.SCREEN);
  }
  for (const x of [21, 23, 25, 27]) {
    m.set(x, 12, D - 1, x === 23 ? SLOT.NEON_PINK : SLOT.NEON_AMBER);
    m.set(x, 12, 0, x === 25 ? SLOT.NEON_PINK : SLOT.NEON_GREEN);
  }
  // ---- carte : eau de verre noir (quadrillage), rives en relief, côtes lumineuses
  const mx0 = 3;
  const mz0 = 3;
  const mw = W - 6;
  const md = D - 6;
  const map = nycMap(mw, md);
  const cellAt = (i: number, j: number) => map.cell[Math.min(md - 1, Math.max(0, j)) * mw + Math.min(mw - 1, Math.max(0, i))];
  const yMap = 13;
  for (let j = 0; j < md; j++)
    for (let i = 0; i < mw; i++) {
      const x = mx0 + i;
      const z = mz0 + j;
      if (edge(x, z) < 3) continue;
      const c = cellAt(i, j);
      m.box(x, 11, z, x + 1, yMap + 1, z + 1, dark);
      if (c === MAP_WATER) {
        m.set(x, yMap, z, (i % 7 === 3 || j % 7 === 3) && (i + j) % 2 === 0 ? SLOT.NEON_BLUE : SLOT.GLASS);
        m.clear(x, yMap + 1, z);
        continue;
      }
      const coast = [cellAt(i - 1, j), cellAt(i + 1, j), cellAt(i, j - 1), cellAt(i, j + 1)].some((n) => n === MAP_WATER);
      let col: number;
      if (c === MAP_SHORE) col = coast ? SLOT.NEON_BLUE : 0x0b2630;
      else if (c === MAP_PARK) col = coast ? SLOT.NEON_CYAN : (i + j) % 3 === 0 ? SLOT.NEON_GREEN : 0x0e3a24;
      else col = coast ? SLOT.NEON_CYAN : K.holoDk;
      m.set(x, yMap + 1, z, col);
    }
  // ponts : on part du centre de l'île vers la rive (East River, Hudson)
  const bridge = (t: number, dir: number, c: number) => {
    let onWater = false;
    for (let q = 0; q < 40; q++) {
      const [i, j] = map.at(t, dir * q * 0.5);
      if (i < 0 || j < 0 || i >= mw || j >= md) return;
      const cc = cellAt(i, j);
      if (cc === MAP_SHORE && onWater) return;
      if (cc !== MAP_WATER) continue;
      onWater = true;
      if (edge(mx0 + i, mz0 + j) >= 3) m.set(mx0 + i, yMap + 1, mz0 + j, c);
    }
  };
  bridge(0.075, 1, SLOT.LED);
  bridge(0.12, 1, SLOT.LED);
  bridge(0.2, 1, SLOT.NEON_PINK);
  bridge(0.44, 1, SLOT.LED);
  bridge(0.86, -1, SLOT.NEON_PINK);
  // ---- hologramme : tours de verre cyan (bandes lumineuses, toits blancs), flèches roses
  const r = rng(2085);
  const yBase = yMap + 2;
  const tower = (x: number, z: number, w: number, h: number, pink: boolean, mark: boolean) => {
    const band = pink || mark ? SLOT.NEON_PINK : SLOT.NEON_CYAN;
    const glass = pink || mark ? 0xc0408e : 0x2aa8c4;
    for (let k = 0; k < h; k++) {
      const y = yBase + k;
      if (w === 2 && k % 3 === 2 && k < h - 1) {
        m.set(x, y, z, glass);
        continue;
      }
      m.box(x, y, z, x + w, y + 1, z + w, k === h - 1 ? (h >= 6 ? SLOT.LED : band) : k % 3 === 1 ? band : glass);
    }
    if (mark) {
      m.box(x, yBase + h, z, x + 1, yBase + h + 2, z + 1, SLOT.NEON_PINK);
      m.set(x, yBase + h + 2, z, SLOT.LED);
    }
  };
  const height = (t: number, s: number): number => {
    const q = r();
    if (t < 0.02) return 2;
    if (t < 0.13) return 7 + Math.round(q * 4);
    if (t < 0.29) return 2 + Math.round(q * 2.4);
    if (t < 0.47) return 7 + Math.round(q * 4) + (Math.abs(s) < 2 ? 1 : 0);
    if (t < 0.65) return 4 + Math.round(q * 2);
    if (t < 0.86) return 2 + Math.round(q * 2);
    return 1 + Math.round(q);
  };
  interface Slot {
    x: number;
    z: number;
    w: number;
    t: number;
    s: number;
    h: number;
    pink: boolean;
    mark: boolean;
  }
  const slots: Slot[] = [];
  for (let j = 0; j < md; j += 2)
    for (let i = 0; i < mw; i += 2) {
      const ids = [
        [i, j],
        [i + 1, j],
        [i, j + 1],
        [i + 1, j + 1],
      ].filter(([a, b]) => cellAt(a, b) === MAP_ISLAND);
      if (ids.length === 0) continue;
      const t = map.t[j * mw + i];
      const s = map.s[j * mw + i];
      const h = height(t, s);
      if (ids.length === 4) slots.push({ x: mx0 + i, z: mz0 + j, w: 2, t, s, h, pink: r() < 0.14, mark: false });
      else if (r() < 0.7) slots.push({ x: mx0 + ids[0][0], z: mz0 + ids[0][1], w: 1, t, s, h: Math.max(1, Math.min(4, h - 3)), pink: false, mark: false });
    }
  // repères : la tour de la pointe sud et la grande flèche de Midtown
  for (const [lt, ls, lh] of [
    [0.06, -1.5, 13],
    [0.33, 0.5, 12],
  ]) {
    let best: Slot | null = null;
    let bd = 1e9;
    for (const sl of slots) {
      if (sl.w !== 2) continue;
      const dd = Math.hypot((sl.t - lt) * 40, sl.s - ls);
      if (dd < bd) {
        bd = dd;
        best = sl;
      }
    }
    if (best) {
      best.h = lh;
      best.mark = true;
    }
  }
  for (const sl of slots) tower(sl.x, sl.z, sl.w, sl.h, sl.pink, sl.mark);
  // rives : quelques tours basses bleues (Jersey City, Brooklyn, Long Island City)
  for (let j = 1; j < md; j += 2)
    for (let i = 1; i < mw; i += 2) {
      if (cellAt(i, j) !== MAP_SHORE || edge(mx0 + i, mz0 + j) < 4) continue;
      const t = map.t[j * mw + i];
      const s = map.s[j * mw + i];
      const jersey = s < 0 && t > 0.04 && t < 0.24;
      const bk = s > 0 && ((t > -0.02 && t < 0.3) || (t > 0.38 && t < 0.5));
      if (!(jersey || bk) || r() > 0.45) continue;
      const h = jersey ? 3 + Math.round(r() * 4) : 1 + Math.round(r() * 2);
      for (let k = 0; k < h; k++) m.set(mx0 + i, yBase + k, mz0 + j, k === h - 1 ? SLOT.LED : k % 3 === 1 ? SLOT.NEON_BLUE : 0x2a5ab0);
    }
  // marqueur de cible flottant (pyramide inversée rose) au-dessus de Midtown
  {
    const [i, j] = map.at(0.41, 2.5);
    const x = mx0 + i;
    const z = mz0 + j;
    const y = yBase + 13;
    m.box(x - 1, y + 1, z - 1, x + 2, y + 2, z + 2, SLOT.NEON_PINK);
    m.set(x, y, z, SLOT.NEON_PINK);
    m.box(x - 1, y + 2, z - 1, x + 2, y + 3, z + 2, -1);
  }
  // émetteurs aux quatre coins de la carte
  for (const [x, z] of [
    [4, 5],
    [W - 6, 5],
    [4, D - 7],
    [W - 6, D - 7],
  ]) {
    m.box(x, 14, z, x + 2, 15, z + 2, trim);
    m.box(x, 15, z, x + 2, 16, z + 2, SLOT.LED);
  }
  return m;
}

/** Console de commandement incurvée : grand écran courbe, plan de travail lumineux, piétements. */
function commandDesk(v: number): M {
  const m = mk('COMMAND_DESK');
  const W = m.sx;
  const D = m.sz;
  const cx = (W - 1) / 2;
  const body = K.gunDk;
  const top = K.carbon;
  const arc = (x: number, k: number) => Math.round(k * ((x - cx) / cx) ** 2);
  const zs = (x: number) => 1 + arc(x, 5);
  const zf = (x: number) => Math.min(D - 1, 10 + arc(x, 5));
  for (let x = 0; x < W; x++) {
    const a = zs(x);
    const f = zf(x);
    const end = x < 4 || x >= W - 4;
    // colonne vertébrale (sous l'écran) et piétements d'extrémité
    m.box(x, 0, a - 1, x + 1, 11, a + 4, body);
    if (end) m.box(x, 0, a - 1, x + 1, 11, f + 1, body);
    m.set(x, 0, a + 3, K.black);
    // plan de travail (y 11-12), lèvre avant lumineuse
    m.box(x, 11, a, x + 1, 13, f + 1, top);
    m.set(x, 11, f, SLOT.NEON_CYAN);
    m.set(x, 12, f, K.chrome);
    // écran courbe : dos, cadre, dalle
    m.box(x, 13, a - 1, x + 1, 21, a + 1, K.black);
    m.box(x, 14, a, x + 1, 20, a + 1, SLOT.SCREEN);
    m.set(x, 20, a, SLOT.NEON_CYAN);
    // dos : nervures et voyants
    if (x % 6 === 2) m.box(x, 2, a - 2 < 0 ? 0 : a - 2, x + 1, 19, a - 1, K.gun);
  }
  // séparations des trois dalles
  for (const x of [12, 25]) m.box(x, 14, zs(x), x + 1, 20, zs(x) + 1, K.black);
  // clavier holographique et pavés tactiles
  for (let x = 14; x < 24; x++) {
    const f = zf(x);
    m.set(x, 12, f - 3, SLOT.LED);
    m.set(x, 12, f - 5, x % 2 ? SLOT.LED : top);
  }
  for (const x0 of [5, 27]) {
    for (let x = x0; x < x0 + 6; x++) {
      const f = zf(x);
      m.set(x, 12, f - 3, SLOT.GLASS);
      m.set(x, 12, f - 4, SLOT.GLASS);
    }
    m.set(x0 + 1, 13, zf(x0 + 1) - 3, SLOT.NEON_AMBER);
    m.set(x0 + 3, 13, zf(x0 + 3) - 4, SLOT.NEON_GREEN);
    m.set(x0 + 4, 13, zf(x0 + 4) - 3, SLOT.NEON_RED);
  }
  // flancs aux couleurs du propriétaire
  for (const x of [0, W - 1]) {
    const f = zf(x);
    m.box(x, 3, zs(x) + 1, x + 1, 9, f, SLOT.TINT1);
    m.box(x, 4, zs(x) + 2, x + 1, 8, f - 1, K.gunLt);
    m.box(x, 5, zs(x) + 3, x + 1, 7, f - 2, SLOT.TINT2);
  }
  // face du corps (côté genoux) : grilles d'aération
  for (let x = 5; x < W - 5; x += 2) m.box(x, 3, zs(x) + 4, x + 1, 9, zs(x) + 5, K.black);
  // dos : barre de voyants
  for (let x = 4; x < W - 4; x += 3) m.set(x, 17, Math.max(0, zs(x) - 2), x % 2 ? SLOT.NEON_GREEN : SLOT.NEON_CYAN);
  void v;
  return m;
}

/** Mur d'écrans (dos au mur) : grand écran central, radar, graphiques, bandeau défilant. */
function screenWall(v: number): M {
  const m = mk('SCREEN_WALL');
  const W = m.sx;
  const H = m.sy;
  const bezel = K.black;
  m.box(0, 0, 0, W, H, 1, K.gunDk);
  // bandeau supérieur aux couleurs du propriétaire
  m.box(0, H - 5, 0, W, H, 2, SLOT.TINT1);
  m.box(0, H - 5, 2, W, H - 4, 3, SLOT.NEON_CYAN);
  m.box(1, H - 2, 1, W - 1, H - 1, 2, SLOT.TINT2);
  for (let x = 3; x < W - 3; x += 6) m.set(x, H - 3, 2, SLOT.LED);
  if (v % 2 === 0) {
    // grand écran central et colonnes latérales
    monitor(m, 12, 7, 36, 26, 1, bezel);
    monitor(m, 1, 17, 12, 27, 1, bezel, 0x081a10);
    monitor(m, 1, 7, 12, 17, 1, bezel);
    monitor(m, 36, 17, 47, 27, 1, bezel, 0x0a1426);
    monitor(m, 36, 7, 47, 17, 1, bezel);
    // radar
    discXY(m, 6.5, 22, 4, 2, 3, (dx, dy, d) => (d > 3.2 ? SLOT.NEON_GREEN : d > 1.6 && d < 2.2 ? 0x1e6a3a : Math.abs(dx) < 0.5 || Math.abs(dy) < 0.5 ? 0x1e6a3a : -2));
    line6(m, 6, 22, 2, 9, 24, 2, SLOT.NEON_GREEN);
    m.set(4, 23, 2, SLOT.NEON_RED).set(8, 20, 2, SLOT.NEON_RED);
    // graphique en barres
    const bars = [3, 5, 4, 7, 6, 8];
    bars.forEach((h, k) => m.box(38 + k * 1.5, 18, 2, 39 + k * 1.5, 18 + h, 3, k === bars.length - 1 ? SLOT.NEON_GREEN : SLOT.NEON_AMBER));
    m.box(37, 18, 2, 46, 19, 3, SLOT.LED);
    // viseur sur l'écran central
    m.box(23, 12, 2, 25, 22, 3, -1);
    m.box(23, 12, 2, 25, 22, 3, SLOT.SCREEN);
    discXY(m, 24, 16.5, 4.2, 2, 3, (dx, dy, d) => (d > 3.4 ? SLOT.NEON_RED : -2));
    m.box(24, 10, 2, 25, 14, 3, SLOT.NEON_RED).box(24, 19, 2, 25, 23, 3, SLOT.NEON_RED);
    m.box(18, 16, 2, 22, 17, 3, SLOT.NEON_RED).box(27, 16, 2, 31, 17, 3, SLOT.NEON_RED);
  } else {
    // mosaïque 4 × 2 d'écrans égaux
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) monitor(m, 1 + i * 11.5, 7 + j * 10, 12 + i * 11.5, 17 + j * 10, 1, bezel);
  }
  // bandeau défilant (cours, alertes)
  m.box(1, 0, 1, W - 1, 7, 2, bezel);
  m.box(2, 1, 1, W - 2, 6, 2, 0x0a0c10);
  const tw = textFront(m, 'NY 2085 +4.2', 3, 5, 2, SLOT.NEON_GREEN);
  m.box(5 + tw, 2, 2, 6 + tw, 5, 3, SLOT.NEON_RED);
  return m;
}

/** Bureau monumental du parrain : façade galbée cannelée, médaillon, plateau de marbre, accessoires. */
function deskBoss(v: number): M {
  const m = mk('DESK_BOSS', 0.6);
  const W = m.sx;
  const D = m.sz;
  const cx = (W - 1) / 2;
  const classic = v % 2 === 1;
  const top = classic ? K.walnutDk : K.marbleBlk;
  const body = classic ? K.walnut : K.lacquer;
  const groove = classic ? K.walnutDk : K.black;
  const zf = (x: number) => D - 3 + Math.round(2 * (1 - ((x - cx) / cx) ** 2));
  // plateau (y 12-13) au chant doré
  for (let x = 0; x < W; x++) {
    const f = zf(x);
    m.box(x, 12, 0, x + 1, 14, f + 1, top);
    m.set(x, 12, f, SLOT.TINT2);
    m.set(x, 12, 0, SLOT.TINT2);
  }
  m.box(0, 12, 0, 1, 13, D, SLOT.TINT2);
  m.box(W - 1, 12, 0, W, 13, D, SLOT.TINT2);
  for (const x of [0, W - 1]) for (const z of [0, zf(x)]) m.box(x, 12, z, x + 1, 14, z + 1, -1);
  // veinage du marbre noir
  if (!classic) {
    line6(m, 3, 13, 2, 15, 13, 9, K.marbleBlkVein);
    line6(m, 15, 13, 9, 22, 13, 7, K.marbleBlkVein);
    line6(m, 26, 13, 15, 38, 13, 6, K.marbleBlkVein);
  }
  // façade galbée : panneau, cannelures, plinthe lumineuse
  for (let x = 1; x < W - 1; x++) {
    const f = zf(x);
    m.box(x, 1, f - 3, x + 1, 12, f, body);
    if (x % 3 === 0 && Math.abs(x - cx) > 6) m.box(x, 3, f - 1, x + 1, 11, f, groove);
    m.set(x, 11, f - 1, SLOT.TINT2);
    m.set(x, 2, f - 1, SLOT.TINT2);
    m.box(x, 0, f - 3, x + 1, 1, f - 1, K.black);
    m.set(x, 0, f - 1, SLOT.LED);
  }
  // médaillon aux couleurs du propriétaire
  const fz = zf(Math.round(cx));
  discXY(m, cx + 0.5, 6.5, 4.6, fz - 1, fz, (dx, dy, d) => (d > 3.7 ? SLOT.TINT2 : d > 2.9 ? SLOT.TINT1 : SLOT.TINT3));
  discXY(m, cx + 0.5, 6.5, 2.2, fz, fz + 1, (dx, dy, d) => (d > 1.3 ? SLOT.TINT2 : SLOT.TINT1));
  // caissons à tiroirs (côté parrain, −Z)
  for (const [x0, x1] of [
    [1, 13],
    [W - 13, W - 1],
  ]) {
    m.box(x0, 0, 1, x1, 12, zf(x0) - 2, body);
    m.box(x0, 0, 1, x1, 1, zf(x0) - 2, K.black);
    for (const [y0, y1] of [
      [1, 4],
      [4, 8],
      [8, 11],
    ]) {
      m.box(x0 + 1, y0, 0, x1 - 1, y1, 1, shade(body, 1.18));
      m.box(x0 + 1, y0, 0, x1 - 1, y0 + 1, 1, groove);
      m.box(Math.floor((x0 + x1) / 2) - 1, Math.floor((y0 + y1) / 2), 0, Math.floor((x0 + x1) / 2) + 1, Math.floor((y0 + y1) / 2) + 1, 1, SLOT.TINT2);
    }
    // flancs : panneau mouluré
    const xs = x0 === 1 ? 0 : W - 1;
    m.box(xs, 1, 2, xs + 1, 11, zf(xs) - 2, body);
    m.box(xs, 3, 4, xs + 1, 9, zf(xs) - 4, groove);
    m.box(xs, 4, 5, xs + 1, 8, zf(xs) - 5, SLOT.TINT1);
  }
  // ---- accessoires
  // écran holographique double face sur pied chromé
  m.box(20, 14, 13, 22, 15, 15, K.chrome);
  m.box(20, 15, 14, 22, 16, 15, K.chrome);
  m.box(15, 16, 14, 27, 23, 15, SLOT.SCREEN);
  m.box(15, 22, 14, 27, 23, 15, SLOT.NEON_CYAN);
  // lampe de banquier : pied doré, abat-jour vert, ampoule
  m.box(5, 14, 6, 9, 15, 9, SLOT.TINT2);
  m.box(6, 15, 7, 7, 18, 8, K.goldDk);
  m.box(3, 18, 6, 11, 20, 10, 0x1d6a42);
  m.box(4, 20, 7, 10, 21, 9, 0x1d6a42);
  m.box(4, 17, 7, 10, 18, 9, SLOT.GLOW);
  // cendrier et cigare rougeoyant
  discXZ(m, 33.5, 13.5, 2, 14, 15, K.goldDk);
  m.box(31, 15, 13, 35, 16, 14, 0x5a3a22);
  m.set(35, 15, 13, SLOT.FIRE);
  // liasses de billets
  for (const [x, z, h] of [
    [27, 3, 2],
    [27, 6, 1],
    [31, 4, 2],
  ]) {
    m.box(x, 14, z, x + 3, 14 + h, z + 2, K.cash);
    m.box(x + 1, 14, z, x + 2, 14 + h, z + 2, K.paper);
  }
  // porte-plume et plaque nominative (face aux visiteurs)
  m.box(12, 14, 4, 13, 16, 5, K.chrome);
  m.box(18, 14, zf(18) - 3, 24, 15, zf(18) - 1, K.black);
  m.box(18, 15, zf(18) - 2, 24, 16, zf(18) - 1, SLOT.TINT2);
  if (classic) grain(m, 'x', 0.06, 11, is(K.walnut, K.walnutDk));
  return m;
}

/** Fauteuil du parrain : haut dossier capitonné aux couleurs du propriétaire, piètement chromé. */
function bossChair(v: number): M {
  const m = mk('BOSS_CHAIR');
  const W = m.sx;
  const D = m.sz;
  const lea = v % 2 === 1 ? K.leatherBrn : K.leather;
  const leaHi = v % 2 === 1 ? shade(K.leatherBrn, 1.2) : K.leatherHi;
  const cx = W / 2;
  const cz = 6.5;
  // piètement 5 branches sur roulettes
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const ex = cx - 0.5 + Math.sin(a) * 5.6;
    const ez = cz - 0.5 + Math.cos(a) * 5.6;
    line6(m, cx - 0.5, 1, cz - 0.5, ex, 1, ez, K.chrome);
    m.box(Math.round(ex) - 1, 0, Math.round(ez) - 1, Math.round(ex) + 1, 1, Math.round(ez) + 1, K.rubber);
  }
  m.box(cx - 1, 1, 5, cx + 1, 3, 7, K.chrome);
  m.box(cx - 1, 3, 5, cx + 1, 6, 7, K.steel);
  m.box(cx - 2, 5, 4, cx + 2, 6, 8, K.black);
  // assise : coussin épais, insert teinté
  cbox(m, 1, 6, 2, W - 1, 9, D - 1, lea, 2);
  m.box(3, 8, 4, W - 3, 9, D - 2, SLOT.TINT1);
  m.box(1, 8, D - 1, W - 1, 9, D, -1);
  m.box(2, 8, D - 2, W - 2, 9, D - 1, leaHi);
  // accoudoirs : console dorée et manchette de cuir
  for (const x of [0, W - 1]) {
    m.box(x, 7, 5, x + 1, 11, 6, K.chrome);
    m.box(x, 7, 9, x + 1, 11, 10, K.chrome);
    m.box(x, 7, 5, x + 1, 8, 10, K.chrome);
    m.box(x, 11, 4, x + 1, 13, 11, lea);
    m.set(x, 12, 10, SLOT.TINT2);
    m.set(x, 11, 10, SLOT.TINT2);
  }
  // dossier incliné, oreilles, capitonnage
  for (let y = 8; y < m.sy; y++) {
    const zB = y < 12 ? 4 : y < 17 ? 3 : 2;
    const z0 = Math.max(0, zB - 3);
    const wing = y >= 14;
    m.box(1, y, z0, W - 1, y + 1, zB, lea);
    if (wing) {
      m.box(0, y, z0, 1, y + 1, zB + 1, lea);
      m.box(W - 1, y, z0, W, y + 1, zB + 1, lea);
    }
    if (y >= 10 && y < m.sy - 2) m.box(3, y, zB - 1, W - 3, y + 1, zB, SLOT.TINT1);
  }
  // boutons de capitonnage (losanges)
  for (let y = 11; y < m.sy - 2; y += 2) {
    const zB = y < 12 ? 4 : y < 17 ? 3 : 2;
    for (let x = 4 + ((y >> 1) % 2) * 2; x < W - 3; x += 4) m.set(x, y, zB - 1, SLOT.TINT2);
  }
  // couronne du dossier
  m.box(2, m.sy - 1, 0, W - 2, m.sy, 2, SLOT.TINT2);
  m.box(1, m.sy - 2, 0, W - 1, m.sy - 1, 1, leaHi);
  // dos : écusson
  discXY(m, cx, 15.5, 2.4, 0, 1, (dx, dy, d) => (d > 1.4 ? SLOT.TINT2 : SLOT.TINT1));
  void mix;
  return m;
}

/** Râtelier mural : fond feutré aux couleurs du propriétaire, fusil à rail, fusil d'assaut, mitraillettes, pistolets. */
function weaponRack(v: number): M {
  const m = mk('WEAPON_RACK');
  const W = m.sx;
  const H = m.sy;
  // fond feutré teinté, cadre noir, fronton et rampe LED qui éclaire les armes
  m.box(0, 0, 0, W, H, 2, SLOT.TINT1);
  m.box(0, 0, 0, W, H, 1, K.black);
  m.box(0, 0, 0, 1, H, 3, K.black);
  m.box(W - 1, 0, 0, W, H, 3, K.black);
  m.box(0, H - 3, 0, W, H, 3, K.black);
  m.box(1, H - 2, 3, W - 1, H - 1, 4, SLOT.TINT2);
  m.box(2, H - 4, 2, W - 2, H - 3, 5, K.gunDk);
  m.box(3, H - 4, 4, W - 3, H - 3, 5, SLOT.LED);
  // étagère basse : munitions, cellules d'énergie, grenades
  m.box(1, 0, 2, W - 1, 2, 7, K.gun);
  m.box(1, 1, 6, W - 1, 2, 7, K.gunLt);
  m.box(1, 2, 2, 4, 4, 6, K.olive);
  m.box(1, 3, 2, 4, 4, 6, K.oliveDk);
  m.set(2, 2, 6, K.yellow);
  m.box(W - 4, 2, 2, W - 1, 4, 6, K.olive);
  m.box(W - 4, 3, 2, W - 1, 4, 6, K.oliveDk);
  for (const x of [6, 9, 18]) {
    m.box(x, 2, 5, x + 2, 3, 6, SLOT.NEON_CYAN);
    m.set(x, 2, 5, K.chrome);
  }
  for (const x of [12, 15]) m.box(x, 2, 4, x + 2, 3, 6, 0x34402c);
  // armes : canon à droite, pixel art sur deux épaisseurs, chevilles chromées
  const L: Record<string, number> = { g: K.gun, h: K.gunLt, d: K.black, c: K.chrome, s: K.steelLt, n: SLOT.NEON_CYAN, r: SLOT.NEON_RED, t: SLOT.TINT2 };
  const gun = (rows: string[], x0: number, yTop: number, pegs: number[]) => {
    pix(m, rows, L, 'xy', x0, yTop, 3, 2);
    for (const px of pegs) m.box(x0 + px, yTop - 2, 2, x0 + px + 1, yTop - 1, 3, K.chrome);
  };
  // fusil à rail : lunette, cellule d'énergie, long canon
  gun(
    [
      '......sddddds...........',
      '.......h...h............',
      'hhhhhhhhhhhhhhhhcccccccc',
      'gggggggggnnnggggg.....r.',
      'ggg..ddd..dd............',
      'gg....dd..dd............',
    ],
    1,
    H - 6,
    [3, 14],
  );
  // fusil d'assaut bullpup
  gun(
    [
      '.....ddd...........',
      'hhhhhhhhhhhhhh.....',
      'ggggnnggggggggccccc',
      'ggg..ddd..gg.......',
      'gg....dd...........',
    ],
    4,
    H - 13,
    [3, 11],
  );
  // deux mitraillettes compactes (la seconde plaquée or/argent)
  for (const [x0, top] of [
    [2, 'h'],
    [14, 't'],
  ] as [number, string][]) {
    gun(
      [
        '...dd......',
        top.repeat(9) + '..',
        'gggnngggccc',
        'gg.d.dd....',
        'g..d.dd....',
        '.....dd....',
      ],
      x0,
      H - 19,
      [2, 7],
    );
  }
  // trois pistolets (culasses noires ou plaquées)
  for (let k = 0; k < 3; k++) {
    const top = k === 1 ? 't' : 'h';
    gun([top.repeat(6) + 'c', 'gggngg.', 'dd.....', 'dd.....'], 3 + k * 8, H - 26, [2]);
  }
  void v;
  return m;
}

// ====================================================================== bureau

/** Piètement étoile à 5 branches sur roulettes (centre cx, cz ; rayon r). */
function starBase(m: M, cx: number, cz: number, r: number, leg: number): void {
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + Math.PI / 5;
    const ex = cx - 0.5 + Math.sin(a) * r;
    const ez = cz - 0.5 + Math.cos(a) * r;
    line6(m, cx - 0.5, 1, cz - 0.5, ex, 1, ez, leg);
    m.set(Math.round(ex), 0, Math.round(ez), K.rubber);
  }
}

/** Bureau de travail : plateau, piètement en cadre, voile de fond, caisson à tiroirs, clavier. */
function desk(v: number): M {
  const m = mk('DESK', 0.4);
  const W = m.sx;
  const D = m.sz;
  const k = v % 3;
  const top = [K.white, K.walnut, 0x9aa0a6][k];
  const legC = [K.chrome, K.black, K.gun][k];
  const panel = [0xc4c8cc, K.walnutDk, K.gunDk][k];
  const T = 11;
  // plateau
  cbox(m, 0, T, 0, W, T + 1, D, top, 1);
  if (k !== 1) m.box(1, T - 1, D - 1, W - 1, T, D, k === 0 ? SLOT.LED : SLOT.NEON_CYAN);
  // piètement en cadre (côtés)
  for (const x of [1, W - 2]) {
    m.box(x, 0, 1, x + 1, T, 2, legC);
    m.box(x, 0, D - 2, x + 1, T, D - 1, legC);
    m.box(x, 0, 1, x + 1, 1, D - 1, legC);
    m.box(x, T - 1, 1, x + 1, T, D - 1, legC);
  }
  // voile de fond
  m.box(2, 4, 1, W - 2, T - 1, 2, panel);
  // caisson à tiroirs (côté utilisateur, +Z)
  m.box(W - 9, 1, 3, W - 3, T - 1, D - 2, panel);
  for (const [y0, y1] of [
    [1, 4],
    [4, 7],
    [7, 10],
  ]) {
    m.box(W - 9, y0, D - 2, W - 3, y1, D - 1, shade(panel, 1.12));
    m.box(W - 9, y0, D - 2, W - 3, y0 + 1, D - 1, shade(panel, 0.75));
    m.box(W - 7, y1 - 2, D - 1, W - 5, y1 - 1, D, legC);
  }
  // clavier, tasse, plante, papiers
  m.box(9, T + 1, 8, 17, T + 2, 11, K.carbon);
  m.box(10, T + 1, 10, 16, T + 2, 11, k === 1 ? K.plastG : SLOT.LED);
  m.box(19, T + 1, 9, 21, T + 3, 11, k === 1 ? K.white : K.red);
  m.box(2, T + 1, 2, 4, T + 3, 4, K.plastDk);
  m.box(1, T + 3, 1, 5, T + 4, 5, K.green);
  m.box(2, T + 4, 2, 4, T + 5, 4, 0x3d7a3a);
  m.box(21, T + 1, 3, 25, T + 2, 7, K.paper);
  m.box(21, T + 2, 4, 25, T + 3, 7, K.paperDk);
  return m;
}

/** Fauteuil de bureau ergonomique : dossier résille, accoudoirs en T, piètement étoile. */
function officeChair(v: number): M {
  const m = mk('OFFICE_CHAIR');
  const W = m.sx;
  const D = m.sz;
  const k = v % 3;
  const fabric = [K.mesh, 0x6a6e74, K.navy][k];
  const frame = [K.black, K.plastW, K.black][k];
  const meshC = [0x26282c, 0x4a4e54, 0x22305a][k];
  starBase(m, W / 2, D / 2, 4.4, k === 1 ? K.chrome : K.gun);
  m.box(4, 1, 4, 6, 6, 6, K.chrome);
  m.box(3, 5, 3, 7, 6, 7, K.black);
  // assise
  cbox(m, 1, 6, 1, W - 1, 8, D - 1, fabric, 2);
  m.box(1, 6, D - 2, W - 1, 7, D - 1, frame);
  // dossier résille (cadre + toile), soutien lombaire
  for (let y = 8; y < m.sy; y++) {
    const z0 = y < 12 ? 1 : 0;
    m.box(1, y, z0, W - 1, y + 1, z0 + 1, frame);
    if (y > 8 && y < m.sy - 1) m.box(2, y, z0, W - 2, y + 1, z0 + 1, meshC);
  }
  m.box(2, 11, 1, W - 2, 12, 2, frame);
  m.box(3, 8, 2, W - 3, 10, 3, frame);
  // accoudoirs en T
  for (const x of [0, W - 1]) {
    m.box(x, 6, 4, x + 1, 10, 5, frame);
    m.box(x, 10, 2, x + 1, 11, 7, K.black);
  }
  return m;
}

/** Moniteur holographique : dalle-écran sans cadre visible des deux côtés, pied chromé. */
function computer(v: number): M {
  const m = mk('COMPUTER');
  const W = m.sx;
  m.box(3, 0, 1, W - 3, 1, 4, K.black);
  m.box(3, 0, 3, W - 3, 1, 4, SLOT.LED);
  m.box(4, 1, 2, 6, 2, 3, K.chrome);
  m.box(0, 2, 2, W, m.sy, 3, SLOT.SCREEN);
  for (const [x, y] of [
    [0, 2],
    [W - 1, 2],
    [0, m.sy - 1],
    [W - 1, m.sy - 1],
  ])
    m.set(x, y, 2, v % 2 ? SLOT.NEON_PINK : SLOT.NEON_CYAN);
  return m;
}

/** Table pliante de la planque : vieux portable, carte annotée, cendrier, canette, pistolet. */
function laptopTable(v: number): M {
  const m = mk('LAPTOP_TABLE', 0.4);
  const W = m.sx;
  const D = m.sz;
  const T = 11;
  // plateau stratifié, chant sombre
  m.box(0, T, 0, W, T + 1, D, 0xc2b9a0);
  m.box(0, T, 0, W, T + 1, 1, 0x8a826e);
  m.box(0, T, D - 1, W, T + 1, D, 0x8a826e);
  // pieds pliants en tube d'acier
  for (const x of [1, W - 2]) {
    m.box(x, 0, 1, x + 1, T, 2, K.steel);
    m.box(x, 0, D - 2, x + 1, T, D - 1, K.steel);
    m.box(x, 0, 1, x + 1, 1, D - 1, K.steel);
  }
  line6(m, 1, 5, 2, W - 2, 8, 2, K.steel);
  // vieux portable épais (écran vers +Z), autocollants au dos de l'écran
  m.box(6, T + 1, 3, 14, T + 2, 8, 0x2b2b2f);
  m.box(7, T + 1, 5, 13, T + 2, 8, 0x3c3c42);
  m.box(6, T + 2, 2, 14, T + 8, 3, 0x2b2b2f);
  m.box(7, T + 3, 3, 13, T + 7, 4, SLOT.SCREEN);
  m.box(7, T + 3, 2, 9, T + 5, 3, SLOT.TINT1);
  m.set(11, T + 6, 2, SLOT.NEON_PINK);
  m.set(12, T + 3, 2, K.yellow);
  // carte de la ville annotée, papiers
  m.box(1, T + 1, 5, 6, T + 2, 10, K.paper);
  m.set(2, T + 1, 6, K.red).set(4, T + 1, 8, K.red).set(3, T + 1, 9, K.blue);
  line6(m, 2, T + 1, 6, 4, T + 1, 8, K.ink);
  m.box(15, T + 1, 5, 18, T + 2, 9, K.paperDk);
  // cendrier et mégots, canette, téléphone jetable, pistolet
  m.box(15, T + 1, 1, 18, T + 2, 4, K.steelLt);
  m.set(16, T + 2, 2, K.white).set(17, T + 2, 2, K.paperDk);
  m.box(2, T + 1, 1, 3, T + 4, 2, 0x2fa04a);
  m.set(2, T + 4, 1, K.alu);
  m.box(13, T + 1, 9, 14, T + 2, 10, K.black);
  m.box(9, T + 1, 8, 13, T + 2, 9, K.gun);
  m.set(9, T + 1, 9, K.black);
  void v;
  return m;
}

/** Table des opérations du garage : établi d'acier, carte papier de Manhattan punaisée, lampe à pince. */
function mapTable(v: number): M {
  const m = mk('MAP_TABLE', 0.5);
  const W = m.sx;
  const D = m.sz;
  const T = 12;
  // piètement d'acier, tablette basse
  legs4(m, 1, 1, W - 1, D - 1, 0, T, K.gunDk, 2);
  m.box(1, 2, 2, W - 1, 3, 3, K.gunDk);
  m.box(1, 2, D - 3, W - 1, 3, D - 2, K.gunDk);
  m.box(3, 3, 3, W - 3, 4, D - 3, K.gun);
  m.box(5, 4, 4, 11, 7, 9, K.cardboard);
  m.box(6, 7, 5, 10, 8, 8, K.cardboardDk);
  m.cylX(5.5, 13.5, 1.2, 14, 27, K.paper);
  // plateau de bois épais
  m.box(0, T, 0, W, T + 2, D, K.oak);
  grain(m, 'x', 0.07, 5, is(K.oak));
  for (let z = 3; z < D; z += 4) m.box(0, T + 1, z, W, T + 2, z + 1, K.oakDk);
  // carte : papier, eau, parc, rues en grille, côtes à l'encre, punaises
  const mx0 = 2;
  const mz0 = 2;
  const mw = W - 4;
  const md = D - 4;
  const map = nycMap(mw, md);
  const cellAt = (i: number, j: number) => map.cell[Math.min(md - 1, Math.max(0, j)) * mw + Math.min(mw - 1, Math.max(0, i))];
  const y = T + 2;
  for (let j = 0; j < md; j++)
    for (let i = 0; i < mw; i++) {
      const c = cellAt(i, j);
      let col = (i + j) % 5 === 0 ? 0x7d9cb8 : 0x6f8fae;
      const coast = c !== MAP_WATER && [cellAt(i - 1, j), cellAt(i + 1, j), cellAt(i, j - 1), cellAt(i, j + 1)].some((n) => n === MAP_WATER);
      if (c === MAP_SHORE) col = coast ? 0x8a8676 : 0xc9c3ad;
      else if (c === MAP_PARK) col = 0x6f9a52;
      else if (c === MAP_ISLAND) col = coast ? 0x2c3550 : i % 3 === 0 ? 0xddd0ae : 0xf2ead4;
      m.set(mx0 + i, y, mz0 + j, col);
    }
  // punaises : rouges, bleues et aux couleurs du propriétaire
  const pins: [number, number, number][] = [
    [0.07, 0, K.red],
    [0.33, 0.5, SLOT.TINT1],
    [0.2, 2, K.red],
    [0.55, -2.5, SLOT.TINT1],
    [0.72, 1, K.blue],
    [0.4, -3, K.blue],
  ];
  // fil rouge entre deux cibles (tracé sur le papier)
  {
    const [i0, j0] = map.at(0.07, 0);
    const [i1, j1] = map.at(0.33, 0.5);
    line6(m, mx0 + i0, y, mz0 + j0, mx0 + i1, y, mz0 + j1, K.red);
  }
  for (const [t, s, c] of pins) {
    const [i, j] = map.at(t, s);
    m.set(mx0 + i, y + 1, mz0 + j, c);
  }
  // photos, tasse, liasse, pistolet
  m.box(W - 7, y, 1, W - 4, y + 1, 4, K.white);
  m.box(W - 6, y, 2, W - 5, y + 1, 3, K.gunLt);
  m.box(3, y, D - 5, 6, y + 1, D - 2, K.white);
  m.box(4, y, D - 4, 5, y + 1, D - 3, K.walnut);
  m.box(W - 4, y, D - 5, W - 2, y + 3, D - 3, K.white);
  m.box(W - 4, y + 2, D - 5, W - 2, y + 3, D - 3, 0x2a1a10);
  m.box(W - 10, y, D - 4, W - 7, y + 2, D - 2, K.cash);
  m.box(W - 9, y, D - 4, W - 8, y + 2, D - 2, K.paper);
  m.box(15, y, D - 4, 19, y + 1, D - 3, K.gun);
  m.set(15, y, D - 3, K.black);
  // lampe d'architecte à pince (bras fin, abat-jour en dôme)
  m.box(1, T - 1, 0, 3, T + 3, 2, K.black);
  m.box(1, T + 3, 0, 2, T + 4, 1, K.chrome);
  line6(m, 1, T + 4, 0, 4, T + 11, 2, K.chrome);
  line6(m, 4, T + 11, 2, 9, T + 9, 5, K.chrome);
  m.box(8, T + 8, 4, 12, T + 9, 8, K.black);
  m.box(9, T + 9, 5, 11, T + 10, 7, K.black);
  m.box(8, T + 7, 4, 12, T + 8, 8, K.black);
  m.box(9, T + 7, 5, 11, T + 8, 7, SLOT.GLOW);
  void v;
  return m;
}

/** Baie de serveurs : façade d'unités à voyants clignotants, ventilateurs, câbles au dos. */
function serverRack(v: number): M {
  const m = mk('SERVER_RACK');
  const W = m.sx;
  const H = m.sy;
  const D = m.sz;
  const k = v % 3;
  const leds = [
    [SLOT.NEON_GREEN, SLOT.NEON_GREEN, SLOT.NEON_AMBER],
    [SLOT.NEON_CYAN, SLOT.NEON_BLUE, SLOT.LED],
    [SLOT.NEON_GREEN, SLOT.NEON_CYAN, SLOT.NEON_RED],
  ][k];
  m.box(0, 0, 0, W, H, D, K.carbon);
  m.box(0, 0, 0, W, 1, D, K.black);
  m.box(0, H - 1, 0, W, H, D, K.black);
  // façade : unités en retrait d'un voxel
  m.box(1, 2, D - 1, W - 1, H - 2, D, -1);
  const r = rng(77 + k);
  let y = 2;
  while (y < H - 2) {
    const big = r() < 0.22 && y + 4 <= H - 2;
    const h = big ? 4 : 2;
    const face = r() < 0.5 ? K.gunDk : K.gun;
    m.box(1, y, D - 2, W - 1, y + h, D - 1, face);
    if (big) {
      // baies de disques
      for (let x = 2; x < W - 2; x += 2) m.box(x, y, D - 2, x + 1, y + h - 1, D - 1, K.gunLt);
      m.set(W - 2, y + 1, D - 2, leds[0]);
      m.set(W - 2, y + 2, D - 2, leds[1]);
    } else {
      m.box(1, y + h - 1, D - 2, W - 1, y + h, D - 1, shade(face, 0.7));
      m.set(2, y, D - 2, leds[Math.floor(r() * 3)]);
      if (r() < 0.6) m.set(3, y, D - 2, leds[0]);
      for (let x = 5; x < W - 2; x++) if (r() < 0.3) m.set(x, y, D - 2, r() < 0.7 ? leds[1] : leds[2]);
    }
    y += h;
  }
  // montants et poignées de porte
  m.box(0, 1, D - 1, 1, H - 1, D, K.gunLt);
  m.box(W - 1, 1, D - 1, W, H - 1, D, K.gunLt);
  m.box(W - 1, H / 2 - 3, D - 1, W, H / 2 + 3, D, K.chrome);
  // dessus : ventilateurs
  discXZ(m, W / 2, 4.5, 2.6, H - 1, H, (dx, dz, d) => (d < 1 ? K.gunLt : d > 2 ? K.gun : K.black));
  discXZ(m, W / 2, D - 4.5, 2.6, H - 1, H, (dx, dz, d) => (d < 1 ? K.gunLt : d > 2 ? K.gun : K.black));
  // dos : ventilateurs et faisceaux de câbles colorés
  for (let y0 = 4; y0 < H - 8; y0 += 7) discXY(m, W / 2, y0 + 2.5, 2.4, 0, 1, (dx, dy, d) => (d < 0.9 ? K.gunLt : d > 1.8 ? K.gun : K.black));
  for (const [x, c] of [
    [2, K.blue],
    [3, K.yellow],
    [W - 3, K.red],
  ] as [number, number][]) {
    m.box(x, 3, 0, x + 1, H - 3, 1, -1);
    m.box(x, 3, 0, x + 1, H - 3, 1, c);
  }
  return m;
}

/** Classeur métallique à quatre tiroirs (porte-étiquettes, poignées, serrure lumineuse). */
function filingCabinet(v: number): M {
  const m = mk('FILING_CABINET');
  const W = m.sx;
  const H = m.sy;
  const D = m.sz;
  const body = [0x80868e, 0x59614a, 0xb3a98f][v % 3];
  m.box(0, 1, 0, W, H, D - 1, body);
  m.box(1, 0, 1, W - 1, 1, D - 2, K.black);
  m.box(0, H - 1, 0, W, H, D - 1, shade(body, 0.85));
  const rows: [number, number][] = [
    [1, 6],
    [6, 11],
    [11, 16],
    [16, 20],
  ];
  for (const [y0, y1] of rows) {
    m.box(0, y0, D - 1, W, y1, D, shade(body, 1.08));
    m.box(0, y0, D - 1, W, y0 + 1, D, shade(body, 0.62));
    m.box(2, y1 - 2, D - 1, 6, y1 - 1, D, K.chrome);
    m.box(3, y1 - 3, D - 1, 5, y1 - 2, D, K.paper);
  }
  m.set(W - 2, H - 3, D - 1, SLOT.NEON_GREEN);
  return m;
}

/** Coffre-fort : porte à molette graduée, levier, charnières, clavier lumineux. */
function safe(v: number): M {
  const m = mk('SAFE');
  const W = m.sx;
  const H = m.sy;
  const D = m.sz;
  const classic = v % 2 === 0;
  const body = classic ? 0x1f3a2c : 0x1a1b1e;
  const trim = classic ? K.gold : K.chrome;
  // pieds, caisse chanfreinée
  legs4(m, 1, 1, W - 1, D - 2, 0, 1, K.black, 2);
  cbox(m, 0, 1, 0, W, H, D - 1, body, 1);
  m.box(1, H - 1, 1, W - 1, H, D - 2, shade(body, 1.15));
  // porte en relief, filet doré, charnières
  m.box(2, 3, D - 1, W - 2, H - 2, D, shade(body, 1.12));
  if (classic) {
    m.box(3, 4, D - 1, W - 3, 5, D, trim);
    m.box(3, H - 4, D - 1, W - 3, H - 3, D, trim);
    m.box(3, 4, D - 1, 4, H - 3, D, trim);
    m.box(W - 4, 4, D - 1, W - 3, H - 3, D, trim);
  }
  for (const y of [5, H - 6]) m.box(0, y, D - 3, 2, y + 3, D - 1, K.steelLt);
  // molette graduée et levier
  discXY(m, W / 2, 12, 3, D - 1, D, (dx, dy, d) => (d > 2.3 ? trim : K.steelLt));
  discXY(m, W / 2, 12, 1.3, D, D + 1, K.black);
  m.set(W / 2, 15, D - 1, K.red);
  discXY(m, W / 2, 6.5, 1.3, D - 1, D, K.steel);
  m.box(W / 2 - 1, 6, D - 1, W / 2 + 4, 7, D, K.chrome);
  m.box(W / 2 + 3, 5, D - 1, W / 2 + 5, 8, D, trim);
  // clavier (2085)
  m.box(W - 4, 9, D - 1, W - 2, 12, D, K.black);
  m.set(W - 4, 11, D - 1, SLOT.NEON_GREEN).set(W - 3, 10, D - 1, SLOT.NEON_RED);
  return m;
}

/** Porte de chambre forte ronde : disque chromé à anneaux, pênes, volant à cinq branches, charnière, scanner. */
function vaultDoor(v: number): M {
  const m = mk('VAULT_DOOR');
  const W = m.sx;
  const H = m.sy;
  const cx = W / 2;
  const cy = H / 2;
  // dormant : plaque d'acier et anneau de chambranle
  m.box(0, 0, 0, W, H, 2, K.gunDk);
  for (let x = 2; x < W - 2; x += 5) {
    m.set(x, 1, 2, K.steel);
    m.set(x, H - 2, 2, K.steel);
  }
  discXY(m, cx, cy, 20.8, 2, 3, (dx, dy, d) => (d > 18.6 ? K.steel : -2));
  discXY(m, cx, cy, 19.2, 2, 4, (dx, dy, d) => (d > 18.4 ? SLOT.LED : -2));
  // porte : bord, face chromée, gorges concentriques
  discXY(m, cx, cy, 18.4, 3, 8, (dx, dy, d) => (d > 16.8 ? K.steelLt : K.chrome));
  discXY(m, cx, cy, 15.6, 8, 9, (dx, dy, d) => (d > 14.6 ? K.steel : d > 10.6 && d < 11.6 ? K.steelLt : -2));
  discXY(m, cx, cy, 6.2, 8, 9, (dx, dy, d) => (d > 5.2 ? K.steel : K.alu));
  // têtes de pênes sur le pourtour
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = Math.round(cx - 0.5 + Math.cos(a) * 16.2);
    const y = Math.round(cy - 0.5 + Math.sin(a) * 16.2);
    m.box(x - 1, y - 1, 8, x + 1, y + 1, 9, K.brass);
  }
  // volant à cinq branches et cadran central
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
    const ex = cx - 0.5 + Math.cos(a) * 9;
    const ey = cy - 0.5 + Math.sin(a) * 9;
    line6(m, cx - 0.5, cy - 0.5, 9, ex, ey, 9, K.chromeHi);
    m.box(Math.round(ex) - 1, Math.round(ey) - 1, 8, Math.round(ex) + 1, Math.round(ey) + 1, 10, K.chromeHi);
  }
  discXY(m, cx, cy, 3, 9, 10, (dx, dy, d) => (d > 2.2 ? K.chrome : d < 0.8 ? K.chromeHi : K.black));
  // charnière verticale massive
  m.box(W - 5, 7, 2, W - 2, H - 7, 7, K.steel);
  for (const y of [9, H / 2 - 2, H - 13]) m.box(W - 6, y, 2, W - 1, y + 4, 8, K.steelLt);
  // scanner palmaire
  m.box(1, 17, 2, 6, 25, 4, K.black);
  m.box(2, 18, 3, 5, 24, 4, SLOT.NEON_CYAN);
  m.box(2, 21, 3, 5, 22, 4, K.black);
  m.set(3, 25, 3, v % 2 ? SLOT.NEON_RED : SLOT.NEON_GREEN);
  return m;
}

/** Armoire à armes blindée : double porte, hublot fumé, emblème du propriétaire, voyant rouge. */
function weaponLocker(v: number): M {
  const m = mk('WEAPON_LOCKER');
  const W = m.sx;
  const H = m.sy;
  const D = m.sz;
  m.box(0, 1, 0, W, H, D - 2, K.gun);
  m.box(1, 0, 1, W - 1, 1, D - 3, K.black);
  m.box(0, H - 1, 0, W, H, D - 2, K.gunDk);
  // bandes aux couleurs du propriétaire sur les flancs
  for (const x of [0, W - 1]) {
    m.box(x, 2, 3, x + 1, H - 2, 5, SLOT.TINT1);
    m.box(x, 2, 5, x + 1, H - 2, 6, SLOT.TINT2);
  }
  // portes
  for (const [x0, x1] of [
    [1, 8],
    [8, W - 1],
  ]) {
    m.box(x0, 2, D - 2, x1, H - 2, D - 1, K.gunLt);
    m.box(x0 + 1, 3, D - 2, x1 - 1, H - 3, D - 1, K.gun);
    for (let y = H - 6; y < H - 3; y += 2) m.box(x0 + 2, y, D - 2, x1 - 2, y + 1, D - 1, K.black);
    hazardXY(m, x0 + 1, 3, x1 - 1, 5, D - 2, K.yellow, K.black, 2);
  }
  m.box(8, 2, D - 2, 9, H - 2, D - 1, K.black);
  // hublot fumé, emblème, clavier, poignées
  m.box(3, 14, D - 2, 6, 24, D - 1, SLOT.GLASS);
  crest(m, 9, 24, D - 1, false);
  m.box(11, 12, D - 1, 13, 16, D, K.black);
  m.set(11, 15, D - 1, SLOT.NEON_GREEN).set(12, 13, D - 1, SLOT.NEON_RED);
  m.box(7, 12, D - 1, 8, 18, D, K.chrome);
  m.box(9, 12, D - 1, 10, 18, D, K.chrome);
  // voyant d'alarme rouge
  m.box(2, H - 3, D - 2, W - 2, H - 2, D, K.black);
  m.box(4, H - 3, D - 1, W - 4, H - 2, D, SLOT.NEON_RED);
  void v;
  return m;
}

// ====================================================================== armurerie, garage, entrepôt

/** Caisse de munitions militaire (couvercle à charnières, poignées de corde, pochoir). */
function ammoCrate(v: number): M {
  const m = mk('AMMO_CRATE');
  const W = m.sx;
  const H = m.sy;
  const D = m.sz;
  const tactical = v % 2 === 1;
  const body = tactical ? K.carbon : K.olive;
  const lid = tactical ? K.gunDk : 0x5c6644;
  m.box(1, 0, 1, W - 1, 1, 2, K.oliveDk);
  m.box(1, 0, D - 2, W - 1, 1, D - 1, K.oliveDk);
  m.box(0, 1, 0, W, H - 2, D, body);
  m.box(0, H - 2, 0, W, H, D, lid);
  m.box(1, H - 1, 1, W - 1, H, D - 1, shade(lid, 1.1));
  m.box(0, H - 3, 0, W, H - 2, D, shade(body, 0.75));
  // loquets, poignées
  for (const x of [2, W - 3]) m.box(x, H - 3, D - 1, x + 1, H - 1, D, K.chrome);
  for (const x of [0, W - 1]) m.box(x, 3, 3, x + 1, 4, D - 3, tactical ? K.black : 0xb39d6c);
  if (tactical) {
    m.box(3, 2, D - 1, W - 3, 3, D, SLOT.NEON_CYAN);
    hazardXY(m, 3, 3, 6, 5, D - 1, K.yellow, K.black, 1);
  } else {
    textFront(m, '556', 2, 5, D - 1, K.yellow);
  }
  return m;
}

/** Sac de sport rempli de billets (fermeture entrouverte, liasses qui dépassent). */
function duffelBag(v: number): M {
  const m = mk('DUFFEL_BAG');
  const W = m.sx;
  const nylon = [0x1e1f23, 0x3a422c][v % 2];
  m.cylX(3, 3, 3.1, 1, W - 1, nylon);
  m.box(1, 0, 1, W - 1, 1, 5, nylon);
  discXY(m, 0, 0, 0, 0, 0, nylon);
  for (const x of [1, W - 2]) m.cylX(3, 3, 2.6, x, x + 1, shade(nylon, 0.7));
  // fermeture éclair et ouverture garnie de billets
  m.box(2, 5, 3, W - 2, 6, 4, K.chrome);
  m.box(4, 5, 2, 9, 6, 5, -1);
  m.box(4, 4, 2, 9, 6, 5, K.cash);
  m.box(5, 5, 2, 6, 6, 5, K.paper);
  m.box(7, 4, 3, 8, 6, 4, K.cashDk);
  // sangles et poignées
  for (const x of [3, W - 4]) m.box(x, 1, 0, x + 1, 6, 6, K.black);
  m.box(3, 6, 3, W - 3, 6, 4, K.black);
  // billets tombés
  m.box(W - 3, 0, 0, W - 1, 1, 1, K.cash);
  return m;
}

/** Établi de garage : plateau de hêtre, caisson à tiroirs, étau, drone démonté, rampe LED. */
function workbench(v: number): M {
  const m = mk('WORKBENCH', 0.6);
  const W = m.sx;
  const D = m.sz;
  const T = 13;
  // piètement d'acier et étagère basse
  legs4(m, 0, 0, W, D, 0, T, K.gunDk, 2);
  m.box(2, 3, 2, W - 2, 4, D - 2, K.gun);
  // caisson à tiroirs rouge (côté gauche)
  m.box(2, 4, 2, 12, T, D - 1, K.red);
  for (let y = 4; y < T; y += 3) {
    m.box(2, y, D - 1, 12, y + 1, D, K.redDk);
    m.box(5, y + 1, D - 1, 9, y + 2, D, K.chrome);
  }
  // pots de peinture et caisse à outils en bas
  m.box(15, 4, 4, 18, 7, 7, K.alu);
  m.box(15, 6, 4, 18, 7, 7, K.blue);
  m.box(19, 4, 4, 22, 7, 7, K.alu);
  m.box(19, 6, 4, 22, 7, 7, K.yellow);
  m.box(24, 4, 3, 31, 8, 9, K.orange);
  m.box(24, 7, 3, 31, 8, 9, K.orangeDk);
  // plateau de bois
  m.box(0, T, 0, W, T + 2, D, K.oak);
  grain(m, 'x', 0.06, 9, is(K.oak));
  // dosseret perforé, tablette et rampe LED
  m.box(0, T + 2, 0, W, m.sy, 1, 0x4a4e54);
  for (let y = T + 3; y < m.sy - 3; y += 2) for (let x = 1; x < W - 1; x += 2) m.set(x, y, 0, K.gunDk);
  m.box(0, m.sy - 2, 0, W, m.sy - 1, 4, K.gun);
  m.box(1, m.sy - 3, 2, W - 1, m.sy - 2, 3, SLOT.LED);
  m.box(3, m.sy - 1, 1, 6, m.sy, 3, K.cardboard);
  m.box(9, m.sy - 1, 1, 11, m.sy, 3, K.blue);
  m.box(26, m.sy - 1, 1, 29, m.sy, 3, K.red);
  // étau (à droite)
  const y = T + 2;
  m.box(W - 6, y, 5, W - 1, y + 2, 10, 0x2a4a6a);
  m.box(W - 5, y + 2, 6, W - 2, y + 4, 9, 0x2a4a6a);
  m.box(W - 4, y + 2, 9, W - 3, y + 3, 13, K.chrome);
  // drone démonté : corps, bras, hélices
  m.box(13, y, 5, 19, y + 2, 9, K.white);
  m.box(14, y + 2, 6, 18, y + 3, 8, K.gunLt);
  m.set(16, y + 1, 9, SLOT.NEON_GREEN);
  line6(m, 13, y, 5, 9, y, 2, K.gun);
  line6(m, 18, y, 5, 22, y, 2, K.gun);
  m.box(20, y, 10, 25, y + 1, 11, K.black);
  // tablette de diagnostic, outils épars
  m.box(4, y, 3, 9, y + 1, 7, K.black);
  m.box(5, y + 1, 4, 8, y + 2, 6, SLOT.SCREEN);
  m.box(4, y, 9, 10, y + 1, 10, K.chrome);
  m.box(23, y, 4, 24, y + 1, 9, K.yellow);
  m.box(23, y, 9, 24, y + 1, 12, K.steelLt);
  void v;
  return m;
}

/** Panneau à outils mural (silhouettes peintes) : clés, marteau, tournevis, scie, pince, perceuse. */
function toolWall(v: number): M {
  const m = mk('TOOL_WALL');
  const W = m.sx;
  const H = m.sy;
  const board = 0x8f7a58;
  m.box(0, 0, 0, W, H, 1, board);
  for (let y = 2; y < H - 1; y += 2) for (let x = 2; x < W - 1; x += 2) m.set(x, y, 0, 0x5e4e36);
  m.box(0, 0, 0, W, 1, 2, K.black);
  m.box(0, H - 1, 0, W, H, 2, K.black);
  m.box(0, 0, 0, 1, H, 2, K.black);
  m.box(W - 1, 0, 0, W, H, 2, K.black);
  const L: Record<string, number> = { s: K.steelLt, d: K.gun, r: K.red, y: K.yellow, w: K.walnutLt, b: K.black, o: K.orange, c: K.chrome };
  const tool = (rows: string[], x0: number, yTop: number) => pix(m, rows, L, 'xy', x0, yTop, 1, 1);
  // trois clés plates
  for (const [x, h] of [
    [2, 9],
    [5, 8],
    [8, 7],
  ]) tool(['s.s', 'sss', ...Array(h - 4).fill('.s.'), 'sss', 's.s'], x, H - 3);
  // marteau
  tool(['ddddd', 'ddddd', '..w..', '..w..', '..w..', '..w..', '..w..', '..r..'], 12, H - 3);
  // tournevis
  for (const [x, c] of [
    [18, 'r'],
    [20, 'y'],
    [22, 'r'],
  ] as [number, string][]) tool([c, c, c, 's', 's', 's', 's'], x, H - 3);
  // pince
  tool(['.s.s.', '.s.s.', '..s..', '.r.r.', '.r.r.', 'r...r'], 25, H - 3);
  // scie
  tool(['wwww..........', 'w.wsssssssssss', 'wwwssssssssss.', '...sssssssss..'], 2, 10);
  // perceuse sans fil
  tool(['yyyyyss', 'yybbb..', '.bb....', '.bb....', '.yy....'], 18, 11);
  // rouleau de câble orange
  discXY(m, 28, 6, 3, 1, 2, (dx, dy, d) => (d > 1.6 ? K.orange : -2));
  m.box(28, 9, 1, 29, 10, 2, K.chrome);
  void v;
  return m;
}

/** Pont élévateur bas : deux rampes antidérapantes, vérins chromés, bandes de danger, pupitre. */
function carLift(v: number): M {
  const m = mk('CAR_LIFT', 0.75);
  const D = m.sz;
  const H = 5;
  for (const x0 of [3, 29]) {
    const x1 = x0 + 10;
    for (let z = 0; z < D; z++) {
      const ramp = Math.min(z, D - 1 - z);
      const top = Math.min(H, 1 + Math.floor(ramp / 2));
      m.box(x0, 0, z, x1, top, z + 1, K.gun);
      if (top === H) m.box(x0, H - 1, z, x1, H, z + 1, z % 4 === 0 ? K.gunDk : 0x5a5f66);
      else m.box(x0, top - 1, z, x1, top, z + 1, K.yellow);
    }
    // bandes de danger sur les flancs
    for (let z = 8; z < D - 8; z++) {
      const c = Math.floor(z / 2) % 2 ? K.yellow : K.black;
      m.set(x0, H - 2, z, c).set(x1 - 1, H - 2, z, c);
    }
    // ciseaux (côtés)
    line6(m, x0 + 1, 0, 14, x0 + 1, 3, 34, K.steel);
    line6(m, x0 + 1, 3, 14, x0 + 1, 0, 34, K.steel);
    // cales de roue
    m.box(x0 + 2, H, 10, x1 - 2, H + 1, 12, K.yellow);
  }
  // vérins et socle central
  m.box(16, 0, 10, 26, 1, D - 10, K.gunDk);
  m.cylZ(19, 2, 1.6, 14, D - 14, K.chrome);
  m.cylZ(23, 2, 1.6, 14, D - 14, K.chrome);
  // pupitre de commande
  m.box(39, 0, 2, 42, 14, 5, K.gunDk);
  m.box(39, 11, 5, 42, 13, 6, K.black);
  m.set(40, 12, 5, SLOT.NEON_GREEN).set(41, 12, 5, SLOT.NEON_RED);
  void v;
  return m;
}

/** Pile de pneus aux flancs arrondis (variante : jantes chromées à liseré lumineux). */
function tireStack(v: number): M {
  const m = mk('TIRE_STACK');
  const W = m.sx;
  const k = v % 3;
  const n = k === 2 ? 3 : 4;
  const rub = 0x2e2e32;
  for (let i = 0; i < n; i++) {
    const ox = (i % 2) * 0.6 - 0.3 + (k === 2 ? i * 0.5 : 0);
    const cx = W / 2 + ox;
    const cz = W / 2 - ox * 0.6;
    const y0 = i * 4;
    discXZ(m, cx, cz, 4.9, y0, y0 + 1, (dx, dz, d) => (d < 2.8 ? -2 : rub));
    discXZ(m, cx, cz, 5.45, y0 + 1, y0 + 3, (dx, dz, d) => (d < 2.6 ? -2 : rub));
    discXZ(m, cx, cz, 4.9, y0 + 3, y0 + 4, (dx, dz, d) => (d < 2.8 ? -2 : d > 3.9 && d < 4.4 ? 0x45454a : rub));
    if (k === 1) {
      discXZ(m, cx, cz, 3.2, y0 + 1, y0 + 3, (dx, dz, d) => (d > 2.6 ? K.chrome : d > 1.2 ? K.alu : K.gunLt));
      discXZ(m, cx, cz, 3.2, y0 + 3, y0 + 4, (dx, dz, d) => (d > 2.6 ? SLOT.NEON_CYAN : -2));
    }
  }
  return m;
}

/** Fût métallique de 200 l : cerclages, bondes, peintures variées (danger, rouille, toxique). */
function barrel(v: number): M {
  const m = mk('BARREL');
  const W = m.sx;
  const H = m.sy;
  const k = v % 5;
  const paintC = [0x2a5a9a, 0xa82a22, 0xd8a81c, 0x7a4a2a, 0x3a6a3a][k];
  const c = W / 2;
  m.cylY(c, c, 4.7, 0, H, paintC);
  for (const y of [0, 5, 10, H - 1]) m.cylY(c, c, 5, y, y + 1, shade(paintC, 0.72));
  // couvercle : rebord, bondes
  discXZ(m, c, c, 4.2, H - 1, H, shade(paintC, 0.88));
  m.box(2, H - 1, 4, 3, H, 5, K.steel);
  m.box(6, H - 1, 6, 8, H, 7, K.steel);
  if (k === 2) {
    // losange de danger noir
    pix(m, ['..k..', '.kkk.', 'kk.kk', '.kkk.', '..k..'], { k: K.black }, 'xy', 3, 9, W - 1);
  } else if (k === 3) {
    m.forEach((x, y, z, col) => (col === paintC && hash3(x >> 1, y >> 1, z >> 1, 3) > 0.62 ? K.rust : undefined));
  } else if (k === 4) {
    m.box(4, H - 1, 2, 6, H, 4, SLOT.NEON_GREEN);
    m.box(4, 6, W - 1, 5, H - 1, W, SLOT.NEON_GREEN);
    m.box(4, 3, W - 1, 5, 4, W, SLOT.NEON_GREEN);
  } else {
    m.box(2, 6, W - 1, 8, 9, W, K.white);
    m.box(3, 7, W - 1, 7, 8, W, shade(paintC, 0.6));
  }
  return m;
}

/** Caisse à claire-voie : planches, cadre, écharpe en diagonale (ou caisse polymère à LED). */
function crateAt(m: M, x0: number, y0: number, z0: number, w: number, h: number, d: number, k: number, simple = false): void {
  const x1 = x0 + w;
  const y1 = y0 + h;
  const z1 = z0 + d;
  if (k === 2) {
    cbox(m, x0, y0, z0, x1, y1, z1, K.carbon, 1);
    m.box(x0, y1 - 2, z0, x1, y1 - 1, z1, K.gunLt);
    m.box(x0 + 2, y0 + 3, z1 - 1, x1 - 2, y0 + 4, z1, SLOT.NEON_CYAN);
    hazardXY(m, x0 + 2, y0 + 5, x0 + 6, y0 + 7, z1 - 1, K.yellow, K.black, 1);
    m.box(x0 - 0, y0 + Math.floor(h / 2), z0 + 2, x0 + 1, y0 + Math.floor(h / 2) + 1, z1 - 2, K.black);
    return;
  }
  const wood = k === 1 ? 0x6e5a40 : K.pine;
  const batten = k === 1 ? 0x4e3e2a : K.pineDk;
  m.box(x0, y0, z0, x1, y1, z1, wood);
  // joints entre planches
  for (let y = y0 + 3; y < y1 - 1 && !simple; y += 3) {
    m.box(x0, y, z0, x1, y + 1, z0 + 1, shade(wood, 0.72));
    m.box(x0, y, z1 - 1, x1, y + 1, z1, shade(wood, 0.72));
    m.box(x0, y, z0, x0 + 1, y + 1, z1, shade(wood, 0.72));
    m.box(x1 - 1, y, z0, x1, y + 1, z1, shade(wood, 0.72));
  }
  for (let x = x0 + 3; x < x1 - 1; x += 4) m.box(x, y1 - 1, z0, x + 1, y1, z1, shade(wood, 0.78));
  // cadre et écharpes
  const fr = (a: number, b: number, c: number, e: number, f: number, g: number) => m.box(a, b, c, e, f, g, batten);
  fr(x0, y0, z0, x0 + 1, y1, z0 + 1);
  fr(x1 - 1, y0, z0, x1, y1, z0 + 1);
  fr(x0, y0, z1 - 1, x0 + 1, y1, z1);
  fr(x1 - 1, y0, z1 - 1, x1, y1, z1);
  fr(x0, y0, z0, x1, y0 + 1, z0 + 1);
  fr(x0, y1 - 1, z0, x1, y1, z0 + 1);
  fr(x0, y0, z1 - 1, x1, y0 + 1, z1);
  fr(x0, y1 - 1, z1 - 1, x1, y1, z1);
  fr(x0, y0, z0, x0 + 1, y0 + 1, z1);
  fr(x1 - 1, y0, z0, x1, y0 + 1, z1);
  fr(x0, y1 - 1, z0, x0 + 1, y1, z1);
  fr(x1 - 1, y1 - 1, z0, x1, y1, z1);
  line6(m, x0 + 1, y0 + 1, z1 - 1, x1 - 2, y1 - 2, z1 - 1, batten);
  if (simple) return;
  line6(m, x0, y0 + 1, z0 + 1, x0, y1 - 2, z1 - 2, batten);
  line6(m, x1 - 1, y1 - 2, z0 + 1, x1 - 1, y0 + 1, z1 - 2, batten);
  // étiquette d'expédition
  if (w >= 12) {
    m.box(x0 + 2, y1 - 6, z1 - 1, x0 + 6, y1 - 3, z1, K.paper);
    m.box(x0 + 3, y1 - 5, z1 - 1, x0 + 5, y1 - 4, z1, K.ink);
  }
}

function crate(v: number): M {
  const m = mk('CRATE');
  crateAt(m, 0, 0, 0, m.sx, m.sy, m.sz - 1, v % 3);
  return m;
}

/** Pile de caisses : une grande caisse, une plus petite décalée, un carton. */
function crateStack(v: number): M {
  const m = mk('CRATE_STACK');
  const k = v % 2;
  crateAt(m, 0, 0, 0, 16, 14, 15, 0);
  crateAt(m, 2, 14, 2, 12, 11, 12, k === 1 ? 2 : 1);
  m.box(4, 25, 4, 10, 27, 10, K.cardboard);
  m.box(6, 26, 4, 8, 27, 10, 0xd8c08a);
  return m;
}

/** Palette en bois (planches du dessus le long de z). */
function pallet(m: M, x0: number, y0: number, z0: number, w: number, d: number): void {
  for (const x of [x0, x0 + Math.floor(w / 2) - 1, x0 + w - 2]) m.box(x, y0, z0, x + 2, y0 + 1, z0 + d, 0x8a6a40);
  m.box(x0, y0 + 1, z0, x0 + w, y0 + 2, z0 + d, K.pineLt);
  for (let x = x0 + 2; x < x0 + w; x += 3) m.box(x, y0 + 1, z0, x + 1, y0 + 2, z0 + d, K.pineDk);
}

/** Carton scotché. */
function carton(m: M, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c = K.cardboard): void {
  m.box(x0, y0, z0, x1, y1, z1, c);
  m.box(x0, y1 - 1, Math.floor((z0 + z1) / 2), x1, y1, Math.floor((z0 + z1) / 2) + 1, 0xd8c08a);
  m.box(x0, y0, z1 - 1, x0 + 1, y1, z1, shade(c, 0.8));
}

/** Palette chargée : cartons filmés, fûts bleus sanglés ou sacs de jute. */
function palletStack(v: number): M {
  const m = mk('PALLET_STACK');
  const W = m.sx;
  const D = m.sz;
  const k = v % 3;
  pallet(m, 0, 0, 0, W, D);
  if (k === 0) {
    for (let y = 2; y < 20; y += 6)
      for (const [x0, z0] of [
        [0, 0],
        [10, 0],
        [0, 8],
        [10, 8],
      ])
        carton(m, x0, y, z0, Math.min(W, x0 + 9), y + 6, z0 + 8, (x0 + z0 + y) % 4 === 0 ? K.cardboardDk : K.cardboard);
    // film étirable
    m.box(0, 4, D - 1, W, 16, D, -1);
    m.box(0, 4, D - 1, W, 16, D, K.wrap);
    for (let y = 5; y < 16; y += 3) m.box(0, y, D - 1, W, y + 1, D, 0xb0bec6);
    m.box(0, 14, 0, 1, 18, D, K.wrap);
    m.box(W - 1, 14, 0, W, 18, D, K.wrap);
  } else if (k === 1) {
    for (const [cx, cz] of [
      [4.75, 4],
      [14.25, 4],
      [4.75, 12],
      [14.25, 12],
    ]) {
      m.cylY(cx, cz, 4.2, 2, 21, 0x2a5aa0);
      m.cylY(cx, cz, 4.4, 8, 9, 0x1f4680);
      m.cylY(cx, cz, 4.4, 15, 16, 0x1f4680);
      discXZ(m, cx, cz, 1, 21, 22, K.white);
    }
    m.box(0, 12, 0, W, 13, D, K.black);
    m.box(0, 12, 1, W, 13, D - 1, -1);
  } else {
    // sacs de jute en quinconce
    for (let i = 0; i < 4; i++) {
      const y = 4 + i * 3.4;
      for (let j = 0; j < 2; j++) {
        const cx = i % 2 ? 9.5 : j === 0 ? 5 : 14;
        const cz = i % 2 ? (j === 0 ? 4.5 : 11.5) : 8;
        const rx = i % 2 ? 8.6 : 4.4;
        const rz = i % 2 ? 3.4 : 7.4;
        m.ellipsoid(cx, y, cz, rx, 2.2, rz, (i + j) % 2 ? 0xa8925e : 0x9a8454);
      }
    }
  }
  return m;
}

/** Texte à grande échelle (chaque pixel de la police → bloc s × s) sur un plan latéral à x, lisant vers +z (dir 1) ou −z (dir −1). */
function bigTextZY(m: M, s: string, x: number, z0: number, yTop: number, scale: number, col: number, dir: 1 | -1, only = false): void {
  textAt(m, s, col, (u, r) => {
    for (let a = 0; a < scale; a++)
      for (let b = 0; b < scale; b++) {
        const yy = yTop - r * scale - a;
        const zz = z0 + dir * (u * scale + b);
        if (!only || m.get(x, yy, zz) >= 0) m.set(x, yy, zz, col);
      }
    return [-1, -1, -1];
  });
}

/** Conteneur maritime de 6 m : parois ondulées (bandes de teinte), cadre, portes à crémones, marquage. */
function container(v: number): M {
  const m = mk('CONTAINER');
  const W = m.sx;
  const H = m.sy;
  const D = m.sz;
  const k = v % 5;
  const col = [0x8a3324, 0x2a5a8a, 0x2f6a46, 0xc8641e, 0xb4b8bc][k];
  const ink = k === 4 ? K.navy : K.white;
  const dk = shade(col, 0.7);
  const groove = shade(col, 0.8);
  // caisse pleine, longs pans en retrait d'un voxel derrière le cadre
  m.box(0, 0, 0, W, H, D, dk);
  m.box(0, 2, 2, W, H - 2, D - 2, -1);
  m.box(1, 2, 2, W - 1, H - 2, D - 2, col);
  // ondulations : bandes verticales alternées (fusionnent en longues bandes)
  for (let z = 2; z < D - 2; z++) {
    if (z % 4 < 2) continue;
    m.box(1, 2, z, 2, H - 2, z + 1, groove);
    m.box(W - 2, 2, z, W - 1, H - 2, z + 1, groove);
  }
  // toit nervuré
  m.box(1, H - 1, 2, W - 1, H, D - 2, col);
  for (let z = 4; z < D - 4; z += 6) m.box(2, H - 1, z, W - 2, H, z + 2, groove);
  // pièces de coin
  for (const x of [0, W - 3]) for (const z of [0, D - 3]) for (const y of [0, H - 3]) m.box(x, y, z, x + 3, y + 3, z + 3, K.gunDk);
  // portes à l'avant (+Z) : deux vantaux nervurés, quatre crémones, charnières
  m.box(2, 2, D - 1, W - 2, H - 2, D, col);
  for (let y = 4; y < H - 4; y += 4) m.box(2, y, D - 1, W - 2, y + 2, D, groove);
  m.box(Math.floor(W / 2), 2, D - 1, Math.floor(W / 2) + 1, H - 2, D, dk);
  for (const x of [5, 13, 24, 32]) {
    m.box(x, 3, D - 1, x + 1, H - 3, D, K.steelLt);
    m.box(x - 1, 14, D - 1, x + 2, 15, D, K.steel);
    for (const y of [5, H - 6]) m.box(x - 1, y, D - 1, x + 2, y + 1, D, K.gunDk);
  }
  for (const y of [6, 20, 34]) {
    m.box(2, y, D - 1, 3, y + 3, D, K.gunDk);
    m.box(W - 3, y, D - 1, W - 2, y + 3, D, K.gunDk);
  }
  // fond (−Z) ondulé horizontalement
  m.box(2, 2, 0, W - 2, H - 2, 1, col);
  for (let y = 4; y < H - 3; y += 4) m.box(2, y, 0, W - 2, y + 2, 1, groove);
  // marquage : nom de l'armateur sur les flancs, numéro sur les portes
  bigTextZY(m, 'HUDSON', W - 2, 12, H - 9, 3, ink, 1, true);
  bigTextZY(m, 'HUDSON', 1, D - 13, H - 9, 3, ink, -1, true);
  textFront(m, 'HDSU 2085', 3, H - 5, D - 1, ink);
  return m;
}

/** Chariot élévateur autonome : châssis, contrepoids, mât et fourches, lidar et bandeaux LED. */
function forklift(v: number): M {
  const m = mk('FORKLIFT');
  const W = m.sx;
  const H = m.sy;
  const D = m.sz;
  const paintC = v % 2 ? K.white : K.yellow;
  const trimC = v % 2 ? K.orange : K.black;
  // roues
  for (const [z, r] of [
    [9, 4],
    [27, 4.6],
  ] as [number, number][]) {
    m.cylX(r, z, r, 0, 3, K.tire);
    m.cylX(r, z, r, W - 3, W, K.tire);
    m.cylX(r, z, r * 0.45, 0, 1, K.steelLt);
    m.cylX(r, z, r * 0.45, W - 1, W, K.steelLt);
  }
  // châssis et carrosserie
  m.box(2, 2, 2, W - 2, 6, 33, K.gunDk);
  cbox(m, 1, 6, 2, W - 1, 13, 32, paintC, 2);
  m.box(1, 6, 2, W - 1, 7, 32, trimC);
  // contrepoids arrondi (hachures)
  cbox(m, 1, 2, 0, W - 1, 17, 8, K.gunDk, 3);
  hazardXY(m, 3, 4, W - 3, 8, 0, K.yellow, K.black, 2);
  // capot, bandeau LED latéral, « yeux » avant
  m.box(2, 13, 8, W - 2, 15, 26, paintC);
  m.box(3, 15, 10, W - 3, 16, 24, shade(paintC, 0.85));
  m.box(1, 10, 8, 2, 11, 30, SLOT.NEON_CYAN);
  m.box(W - 2, 10, 8, W - 1, 11, 30, SLOT.NEON_CYAN);
  m.box(3, 9, 32, 7, 11, 33, SLOT.LED);
  m.box(W - 7, 9, 32, W - 3, 11, 33, SLOT.LED);
  // bloc batterie (pas de cabine : le chariot est autonome), jauge de charge
  m.box(4, 15, 11, W - 4, 19, 22, K.gunDk);
  m.box(W - 4, 16, 13, W - 3, 18, 20, K.black);
  m.box(W - 4, 17, 14, W - 3, 18, 18, SLOT.NEON_GREEN);
  // arceau de protection, lidar, rampe de phares, gyrophare
  for (const x of [2, W - 3]) for (const z of [10, 28]) m.box(x, 13, z, x + 1, 28, z + 1, K.black);
  m.box(2, 27, 10, W - 2, 28, 11, K.black);
  m.box(2, 27, 28, W - 2, 29, 29, K.black);
  m.box(2, 27, 10, 3, 28, 29, K.black);
  m.box(W - 3, 27, 10, W - 2, 28, 29, K.black);
  for (const z of [15, 20, 24]) m.box(2, 27, z, W - 2, 28, z + 1, K.gunDk);
  m.box(4, 28, 28, W - 4, 29, 29, SLOT.LED);
  m.cylY(W / 2, 19, 2.4, 28, 30, K.black);
  m.cylY(W / 2, 19, 2.4, 29, 30, SLOT.NEON_CYAN);
  m.cylY(W / 2, 19, 1.4, 30, 31, K.gunLt);
  m.box(3, 28, 11, 5, 29, 13, SLOT.NEON_AMBER);
  // mât de levage et fourches
  for (const x of [3, W - 5]) m.box(x, 1, 33, x + 2, H, 35, K.gun);
  m.box(3, H - 2, 33, W - 3, H, 35, K.gun);
  m.box(4, 4, 35, W - 4, 12, 36, K.gunDk);
  for (let y = 5; y < 12; y += 2) m.box(5, y, 35, W - 5, y + 1, 36, K.gunLt);
  for (const x of [5, W - 7]) {
    m.box(x, 1, 35, x + 2, 9, 37, K.black);
    m.box(x, 1, 36, x + 2, 2, D, K.black);
  }
  m.cylY(W / 2, 34, 0.9, 2, H - 2, K.chrome);
  return m;
}

/** Rayonnage à palettes d'entrepôt : échelles bleues, lisses orange, charges sur trois niveaux. */
function shelfRack(v: number): M {
  const m = mk('SHELF_RACK');
  const W = m.sx;
  const H = m.sy;
  const D = m.sz;
  const r = rng(31 + v);
  const levels = [1, 16, 32];
  // charges (palettes) dans les deux travées
  for (const [x0, x1] of [
    [2, 20],
    [22, 40],
  ])
    for (const y0 of levels) {
      if (r() < 0.15) continue;
      const yb = y0 === 1 ? 0 : y0 + 2;
      pallet(m, x0 + 1, yb, 1, x1 - x0 - 2, D - 2);
      const kind = r();
      const top = yb + 2;
      const hMax = y0 === 32 ? H - top : 12;
      if (kind < 0.5) {
        for (let x = x0 + 1; x < x1 - 2; x += 8)
          for (let y = top; y < top + hMax - 5; y += 6) carton(m, x, y, 2, Math.min(x1 - 1, x + 8), y + 6, D - 2, r() < 0.3 ? K.cardboardDk : K.cardboard);
      } else if (kind < 0.75) {
        // cuve-conteneur blanche en cage d'acier
        const h = Math.min(11, hMax);
        m.box(x0 + 2, top, 2, x1 - 2, top + h, D - 2, 0xd8dcd6);
        for (let x = x0 + 2; x < x1 - 2; x += 4) m.box(x, top, D - 2, x + 1, top + h, D - 1, K.steel);
        for (const y of [top + 3, top + 7]) m.box(x0 + 2, y, D - 2, x1 - 2, y + 1, D - 1, K.steel);
        m.box(x0 + 7, top + h, 7, x0 + 10, top + h + 1, 10, K.blue);
      } else {
        crateAt(m, x0 + 2, top, 2, x1 - x0 - 4, Math.min(11, hMax), D - 4, 0, true);
      }
    }
  // échelles (montants bleus et entretoises) et lisses orange
  for (const x of [0, 20, 40]) {
    m.box(x, 0, 0, x + 2, H, 2, K.blue);
    m.box(x, 0, D - 2, x + 2, H, D, K.blue);
    for (let y = 2; y < H - 4; y += 8) m.box(x, y, 2, x + 1, y + 1, D - 2, K.blueDk);
    m.box(x, 0, 0, x + 2, 1, D, K.gunDk);
  }
  for (const y of levels.slice(1)) {
    m.box(0, y, 0, W, y + 2, 1, K.orange);
    m.box(0, y, D - 1, W, y + 2, D, K.orange);
  }
  m.box(0, H - 1, 0, W, H, 1, K.orange);
  m.box(0, H - 1, D - 1, W, H, D, K.orange);
  // étiquettes d'emplacement
  for (const y of levels.slice(1)) for (const x of [9, 29]) m.box(x, y, D - 1, x + 3, y + 1, D, K.white);
  return m;
}

// ====================================================================== nuit, jeu, sport

/** Cabine de DJ : façade à égaliseur néon, écrans latéraux, platines, table de mixage, portable. */
function djBooth(v: number): M {
  const m = mk('DJ_BOOTH', 0.2);
  const W = m.sx;
  const D = m.sz;
  const T = 15;
  // caisson à façade inclinée
  for (let y = 0; y < T; y++) {
    const zf = D - 1 - Math.floor(y / 6);
    m.box(0, y, 1, W, y + 1, zf + 1, K.carbon);
  }
  m.box(0, 0, 1, W, 1, D, K.black);
  // façade : liserés néon, égaliseur, écrans visualiseurs
  for (let y = 1; y < T; y++) {
    const zf = D - 1 - Math.floor(y / 6);
    m.set(1, y, zf, SLOT.NEON);
    m.set(W - 2, y, zf, SLOT.NEON);
  }
  m.box(1, 1, D - 1, W - 1, 2, D, SLOT.NEON);
  const bars = [3, 5, 8, 6, 9, 11, 8, 10, 7, 9, 6, 4, 7, 5];
  bars.forEach((h, i) => {
    const x = 10 + i * 1.5;
    for (let y = 3; y < 3 + h; y++) m.set(x, y, D - 1 - Math.floor(y / 6), SLOT.NEON);
  });
  for (const x0 of [3, W - 8]) for (let y = 4; y < 12; y++) m.box(x0, y, D - 1 - Math.floor(y / 6), x0 + 5, y + 1, D - Math.floor(y / 6), SLOT.SCREEN);
  // plateau : bord chromé
  m.box(0, T, 1, W, T + 1, D - 2, K.gunDk);
  m.box(0, T, D - 3, W, T + 1, D - 2, K.chrome);
  // platines (disques, bras), table de mixage, portable (logo néon vers le public)
  for (const cx of [8, W - 8]) {
    m.box(cx - 5, T + 1, 2, cx + 5, T + 2, 11, K.gun);
    discXZ(m, cx - 1, 6.5, 3.6, T + 2, T + 3, (dx, dz, d) => (d < 0.8 ? K.chrome : d > 3 ? SLOT.NEON : K.black));
    m.box(cx + 3, T + 2, 3, cx + 4, T + 3, 8, K.chrome);
  }
  m.box(15, T + 1, 2, 23, T + 2, 10, K.black);
  for (let x = 16; x < 23; x += 2) {
    m.box(x, T + 2, 3, x + 1, T + 3, 6, K.white);
    m.set(x, T + 2, 8, SLOT.LED);
  }
  m.box(16, T + 2, 1, 22, T + 7, 2, K.alu);
  m.box(17, T + 4, 1, 21, T + 6, 2, SLOT.NEON);
  // casque
  m.box(W - 4, T + 1, 12, W - 2, T + 2, 13, K.black);
  return m;
}

/** Enceintes empilées : deux caissons de basses (anneaux lumineux), médium et pavillon d'aigu. */
function speakerStack(v: number): M {
  const m = mk('SPEAKER_STACK');
  const W = m.sx;
  const D = m.sz;
  const ring = v % 2 ? SLOT.NEON_PINK : SLOT.NEON_CYAN;
  const cab = (y0: number, y1: number) => {
    m.box(0, y0, 0, W, y1, D - 1, K.carbon);
    m.box(0, y0, D - 1, W, y1, D, K.black);
    for (const [x, y] of [
      [0, y0],
      [W - 1, y0],
      [0, y1 - 1],
      [W - 1, y1 - 1],
    ])
      m.box(x, y, D - 2, x + 1, y + 1, D, K.steel);
  };
  // caissons de basses
  for (const y0 of [0, 11]) {
    cab(y0, y0 + 11);
    discXY(m, W / 2, y0 + 5.5, 5.2, D - 1, D, (dx, dy, d) => (d > 4.6 ? ring : d > 3.8 ? K.gun : d < 1.2 ? K.gunLt : K.black));
  }
  // médium / aigu
  cab(22, 32);
  for (const cx of [4, W - 4]) discXY(m, cx, 26, 2.8, D - 1, D, (dx, dy, d) => (d > 2.2 ? K.gun : d < 0.8 ? K.gunLt : K.black));
  m.box(5, 29, D - 1, W - 5, 31, D, K.gunDk);
  m.box(6, 29, D - 1, W - 6, 30, D, K.black);
  m.box(6, 23, D - 1, W - 6, 24, D, ring);
  // poignées latérales
  for (const x of [0, W - 1]) for (const y of [5, 16, 27]) m.box(x, y, 4, x + 1, y + 1, 8, K.gunLt);
  return m;
}

/** Pont lumineux suspendu : poutre treillis en aluminium, lyres à lentilles néon. */
function stageLights(v: number): M {
  const m = mk('STAGE_LIGHTS');
  const W = m.sx;
  const H = m.sy;
  // treillis : quatre membrures et diagonales
  for (const [y, z] of [
    [H - 4, 1],
    [H - 4, 6],
    [H - 1, 1],
    [H - 1, 6],
  ])
    m.box(0, y, z, W, y + 1, z + 1, K.alu);
  for (let x = 0; x < W - 3; x += 4) {
    line6(m, x, H - 4, 1, x + 3, H - 1, 1, K.steelLt);
    line6(m, x, H - 4, 6, x + 3, H - 1, 6, K.steelLt);
    line6(m, x, H - 4, 1, x + 3, H - 4, 6, K.steelLt);
  }
  // lyres : corps noir, colliers, lentille néon tournée vers le bas et l'avant
  for (let i = 0; i < 5; i++) {
    const x = 3 + i * 10;
    m.box(x + 1, H - 5, 3, x + 2, H - 4, 5, K.chrome);
    m.box(x, H - 6, 2, x + 3, H - 5, 6, K.black);
    m.box(x - 1, 1, 2, x + 4, H - 6, 6, K.black);
    m.box(x, 0, 3, x + 3, 1, 6, SLOT.NEON);
    m.box(x, 1, 6, x + 3, 3, 7, SLOT.NEON);
    m.box(x - 1, 2, 2, x, 4, 3, K.gunLt);
  }
  void v;
  return m;
}

/** Table de black-jack en demi-lune : tapis feutré, boudin de cuir, cases de mise, sabot, jetons. */
function casinoTable(v: number): M {
  const m = mk('CASINO_TABLE');
  const W = m.sx;
  const D = m.sz;
  const felt = [K.feltGreen, K.feltTeal, K.feltRed][v % 3];
  const cx = (W - 1) / 2;
  const T = 12;
  const inTable = (x: number, z: number, shrink = 0) => {
    const dx = (x - cx) / (cx + 0.5 - shrink);
    const dz = (z - 1) / (D - 1.5 - shrink);
    return z >= 1 && dx * dx + dz * dz <= 1;
  };
  // piètement, repose-pieds, socle lumineux
  m.box(cx - 6, 0, 2, cx + 7, 1, 10, K.black);
  m.box(cx - 4, 1, 3, cx + 5, T, 8, K.lacquer);
  m.box(cx - 4, 1, 8, cx + 5, 2, 9, SLOT.NEON_GREEN);
  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      if (!inTable(x, z)) continue;
      const rail = !inTable(x, z, 2.2);
      m.box(x, T - 1, z, x + 1, T, z + 1, K.walnutDk);
      m.set(x, T, z, rail ? K.leather : felt);
      if (rail) m.set(x, T + 1, z, K.leatherHi);
      if (!inTable(x, z, 1) && inTable(x, z, 0)) m.set(x, T - 1, z, SLOT.NEON_GREEN);
    }
  // bord du croupier (bois) et rack de jetons
  m.box(2, T - 1, 0, W - 2, T + 1, 2, K.walnut);
  m.box(cx - 7, T, 2, cx + 8, T + 1, 5, K.black);
  const chipC = [K.red, K.feltGreen, K.black, K.blue, K.white, 0x7a3a8a];
  for (let i = 0; i < 14; i++) m.box(cx - 7 + i, T, 3, cx - 6 + i, T + 1, 4, chipC[i % chipC.length]);
  // cases de mise (arc doré), cartes, piles de jetons
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (0.12 + (i / 6) * 0.76);
    const x = Math.round(cx + Math.cos(a) * (cx - 5));
    const z = Math.round(1 + Math.sin(a) * (D - 7));
    m.set(x, T, z, K.gold).set(x + 1, T, z, K.gold);
    m.set(x, T, z - 2, K.white);
    m.set(x, T + 1, z - 2, K.white);
    m.box(x + 1, T + 1, z + 1, x + 2, T + 1 + (i % 3) + 1, z + 2, chipC[i % 6]);
  }
  // sabot de cartes
  m.box(W - 9, T, 3, W - 6, T + 2, 6, K.black);
  m.box(W - 8, T + 2, 4, W - 7, T + 3, 5, K.white);
  return m;
}

/** Machine à sous rétro-futuriste : fronton néon « 777 », écran à rouleaux, pupitre lumineux, levier. */
function slotMachine(v: number): M {
  const m = mk('SLOT_MACHINE');
  const W = m.sx;
  const H = m.sy;
  const D = m.sz;
  const cab = [K.carbon, K.redDk, 0x2a1a48][v % 3];
  const trim = v % 3 === 1 ? K.gold : K.chrome;
  // socle et caisse
  m.box(1, 0, 1, W - 1, 11, D - 2, cab);
  m.box(1, 0, D - 2, W - 1, 1, D - 1, K.black);
  m.box(1, 3, D - 2, W - 1, 4, D - 1, SLOT.NEON);
  m.box(3, 6, D - 2, W - 3, 9, D - 1, K.black);
  m.box(4, 6, D - 2, W - 4, 7, D - 1, trim);
  // pupitre à boutons
  m.box(1, 11, 2, W - 1, 13, D, cab);
  m.box(1, 12, D - 1, W - 1, 13, D, trim);
  for (const [x, c] of [
    [3, SLOT.NEON_RED],
    [5, SLOT.LED],
    [7, SLOT.LED],
    [9, SLOT.NEON_GREEN],
  ] as [number, number][])
    m.set(x, 13, D - 3, c);
  // écran principal encadré
  m.box(1, 13, 1, W - 1, 23, D - 3, cab);
  m.box(1, 13, D - 3, W - 1, 23, D - 2, trim);
  m.box(2, 14, D - 3, W - 2, 22, D - 2, SLOT.SCREEN);
  for (const x of [5, 8]) m.box(x, 14, D - 3, x + 1, 22, D - 2, K.black);
  for (const x of [1, W - 2]) m.box(x, 13, D - 2, x + 1, 23, D - 1, SLOT.NEON);
  // fronton arrondi
  m.box(1, 23, 2, W - 1, H - 2, D - 3, cab);
  m.box(2, H - 2, 2, W - 2, H - 1, D - 3, cab);
  m.box(1, 23, D - 3, W - 1, H - 2, D - 2, K.black);
  textFront(m, '777', 1, H - 4, D - 2, SLOT.NEON_AMBER);
  m.box(2, H - 1, 3, W - 2, H, D - 4, SLOT.NEON);
  m.box(1, 23, D - 2, W - 1, 24, D - 1, SLOT.NEON);
  // levier latéral
  m.box(W - 1, 9, 5, W, 12, 7, trim);
  m.box(W - 1, 12, 6, W, 20, 7, K.chrome);
  m.box(W - 1, 20, 5, W, 22, 7, K.red);
  return m;
}

/** Table de roulette : cylindre en bois et chrome, tapis de mise rouge et noir, jetons. */
function roulette(v: number): M {
  const m = mk('ROULETTE', 0.1);
  const W = m.sx;
  const D = m.sz;
  const T = 12;
  // caisse et pieds
  m.box(1, 0, 1, W - 1, 2, D - 1, K.black);
  m.box(2, 2, 2, W - 2, T, D - 2, K.walnutDk);
  for (let z = 4; z < D - 4; z += 5) m.box(2, 4, z, W - 2, T - 2, z + 1, K.walnut);
  // plateau : rebord de cuir, tapis
  m.box(0, T, 0, W, T + 1, D, K.leather);
  m.box(1, T, 1, W - 1, T + 1, D - 1, K.feltGreen);
  m.box(0, T + 1, 0, W, T + 2, D, K.leatherHi);
  m.box(1, T + 1, 1, W - 1, T + 2, D - 1, -1);
  // cylindre (côté −Z)
  const cx = W / 2;
  const cz = 8;
  discXZ(m, cx, cz, 7, T, T + 2, (dx, dz, d) => (d > 6 ? K.walnut : d > 5 ? 0xc8a070 : -2));
  discXZ(m, cx, cz, 5, T, T + 1, (dx, dz, d) => {
    if (d < 3.4) return K.gold;
    const k = Math.floor(((Math.atan2(dz, dx) + Math.PI) / (Math.PI * 2)) * 18);
    return k === 0 ? K.feltGreen : k % 2 ? K.red : K.black;
  });
  discXZ(m, cx, cz, 2.2, T + 1, T + 2, K.gold);
  m.box(cx - 2, T + 2, cz, cx + 2, T + 3, cz + 1, K.goldLt);
  m.box(cx, T + 2, cz - 2, cx + 1, T + 3, cz + 2, K.goldLt);
  m.set(cx + 3, T + 1, cz + 2, K.white);
  // tapis de mise : zéro vert, grille rouge et noir, douzaines
  m.box(4, T, 16, W - 4, T + 1, 18, K.feltGreen);
  for (let row = 0; row < 12; row++)
    for (let col = 0; col < 3; col++) {
      const n = row * 3 + col;
      const x = 4 + col * 3;
      const z = 18 + row;
      m.box(x, T, z, x + 3, T + 1, z + 1, n % 2 ? K.red : K.black);
      m.set(x, T, z, K.white);
    }
  m.box(W - 4, T, 18, W - 2, T + 1, 30, K.feltGreen);
  for (const z of [18, 22, 26]) m.set(W - 3, T, z, K.white);
  // jetons
  for (const [x, z, h, c] of [
    [6, 20, 2, K.white],
    [9, 24, 3, K.red],
    [12, 27, 1, K.blue],
    [5, 26, 2, K.feltGreen],
  ] as [number, number, number, number][])
    m.box(x, T + 1, z, x + 1, T + 1 + h, z + 1, c);
  void v;
  return m;
}

/** Table de poker octogonale : tapis, boudin, cartes distribuées, jetons. */
function cardTable(v: number): M {
  const m = mk('CARD_TABLE');
  const W = m.sx;
  const D = m.sz;
  const felt = v % 2 ? K.feltBlue : K.feltGreen;
  const T = 11;
  cbox(m, 6, 0, 6, W - 6, 1, D - 6, K.black, 2);
  cbox(m, 8, 1, 8, W - 8, T - 1, D - 8, K.lacquer, 2);
  cbox(m, 1, T - 1, 1, W - 1, T, D - 1, K.walnut, 6);
  cbox(m, 0, T, 0, W, T + 1, D, K.leather, 7);
  cbox(m, 2, T, 2, W - 2, T + 1, D - 2, felt, 6);
  cbox(m, 0, T + 1, 0, W, T + 2, D, K.leatherHi, 7);
  cbox(m, 2, T + 1, 2, W - 2, T + 2, D - 2, -1, 6);
  // cartes à six places, jetons, paquet au centre
  const seats: [number, number][] = [
    [11, 4],
    [17, 7],
    [17, 15],
    [11, 18],
    [4, 15],
    [4, 7],
  ];
  const chipC = [K.red, K.black, K.blue, K.white];
  seats.forEach(([x, z], i) => {
    m.box(x, T + 1, z, x + 2, T + 2, z + 1, K.white);
    m.box(x + (i % 2 ? -1 : 2), T + 1, z, x + (i % 2 ? 0 : 3), T + 2 + (i % 3), z + 1, chipC[i % 4]);
  });
  m.box(10, T + 1, 10, 12, T + 3, 12, K.white);
  m.box(10, T + 3, 10, 12, T + 4, 12, K.red);
  m.box(13, T + 1, 9, 14, T + 4, 10, K.red);
  m.box(13, T + 1, 12, 14, T + 3, 13, K.black);
  return m;
}

/** Billard : tapis, bandes et mouches, six poches, triangle de billes, canne posée. */
function poolTable(v: number): M {
  const m = mk('POOL_TABLE');
  const W = m.sx;
  const D = m.sz;
  const k = v % 3;
  const felt = [K.feltGreen, K.feltBlue, K.feltRed][k];
  const wood = [K.walnut, K.lacquer, K.carbon][k];
  const T = 11;
  // pieds massifs, caisse
  legs4(m, 2, 2, W - 2, D - 2, 0, 8, shade(wood, 0.85), 3);
  m.box(1, 7, 1, W - 1, T, D - 1, wood);
  if (k === 2) m.box(1, 7, 1, W - 1, 8, D - 1, SLOT.NEON_CYAN);
  else m.box(1, 8, 1, W - 1, 9, D - 1, shade(wood, 0.8));
  // tapis, bandes de bois avec mouches
  m.box(2, T, 2, W - 2, T + 1, D - 2, felt);
  m.box(0, T, 0, W, T + 2, 2, wood);
  m.box(0, T, D - 2, W, T + 2, D, wood);
  m.box(0, T, 0, 2, T + 2, D, wood);
  m.box(W - 2, T, 0, W, T + 2, D, wood);
  m.box(2, T + 1, 2, W - 2, T + 2, 3, shade(felt, 0.8));
  m.box(2, T + 1, D - 3, W - 2, T + 2, D - 2, shade(felt, 0.8));
  m.box(2, T + 1, 2, 3, T + 2, D - 2, shade(felt, 0.8));
  m.box(W - 3, T + 1, 2, W - 2, T + 2, D - 2, shade(felt, 0.8));
  for (let x = 5; x < W - 4; x += 5) {
    m.set(x, T + 2, 0, K.white).set(x, T + 2, D - 1, K.white);
  }
  // poches
  for (const x of [1, Math.floor(W / 2) - 1, W - 3])
    for (const z of [1, D - 3]) {
      m.box(x, T, z, x + 2, T + 2, z + 2, -1);
      m.box(x, T - 1, z, x + 2, T, z + 2, K.black);
    }
  // triangle de 15 billes et bille blanche
  const ballC = [K.yellow, K.blue, K.red, 0x5a2a7a, K.orange, K.feltGreen, 0x7a2a1a, K.black];
  let n = 0;
  for (let row = 0; row < 5; row++)
    for (let j = 0; j <= row; j++) {
      const x = 27 + row;
      const z = Math.round(D / 2 - row / 2 + j) - 0;
      m.set(x, T + 1, z, ballC[n++ % ballC.length]);
    }
  m.set(10, T + 1, Math.floor(D / 2), K.white);
  // canne posée en travers
  line6(m, 6, T + 2, 4, 22, T + 2, 8, K.pineLt);
  line6(m, 3, T + 2, 3, 6, T + 2, 4, K.black);
  return m;
}

/** Sac de frappe suspendu à une potence murale (chaîne, émerillon, bandes). */
function punchingBag(v: number): M {
  const m = mk('PUNCHING_BAG');
  const H = m.sy;
  const leatherC = v % 2 ? K.leather : K.red;
  const cx = 4;
  const cz = 4;
  // potence murale
  m.box(2, H - 8, 0, 6, H, 1, K.black);
  m.box(3, H - 3, 0, 5, H - 1, 6, K.black);
  // chaîne et émerillon
  for (let y = 26; y < H - 3; y++) m.set(cx, y, cz + (y % 2), K.chrome);
  m.box(cx - 1, 25, cz - 1, cx + 2, 26, cz + 2, K.steel);
  // sac
  m.cylY(cx, cz + 0.5, 3.4, 7, 25, leatherC);
  m.cylY(cx, cz + 0.5, 3, 6, 7, K.black);
  for (const y of [8, 23]) m.cylY(cx, cz + 0.5, 3.5, y, y + 1, K.black);
  m.box(cx - 2, 14, cz + 3, cx + 2, 18, cz + 4, K.white);
  m.box(cx - 1, 15, cz + 3, cx + 1, 17, cz + 4, leatherC);
  return m;
}

/** Banc de musculation : banc rembourré, montants, barre chargée de disques, haltères. */
function weightBench(v: number): M {
  const m = mk('WEIGHT_BENCH');
  const W = m.sx;
  const D = m.sz;
  const frame = v % 2 ? K.blueDk : K.redDk;
  // banc
  m.box(6, 0, 3, 8, 6, 7, frame);
  m.box(17, 0, 3, 19, 6, 7, frame);
  m.box(4, 0, 2, 21, 1, 8, frame);
  cbox(m, 4, 6, 2, 21, 8, 8, K.leather, 1);
  // montants et crochets
  for (const x of [2, W - 4]) {
    m.box(x, 0, 2, x + 2, 15, 4, frame);
    m.box(x, 0, 6, x + 2, 15, 8, frame);
    m.box(x, 0, 1, x + 2, 1, 9, frame);
    m.box(x, 13, 3, x + 2, 14, 7, K.chrome);
  }
  // barre et disques
  m.box(0, 14, 4, W, 15, 5, K.chrome);
  for (const x of [0, W - 2]) m.cylX(14.5, 4.5, 3.8, x, x + 2, K.black);
  for (const x of [0, W - 1]) m.cylX(14.5, 4.5, 1.2, x, x + 1, K.chrome);
  // haltères au sol
  for (const z of [8, 9]) {
    m.box(10, 0, z, 15, 1, z + 1, K.chrome);
    m.box(10, 0, z, 11, 2, z + 1, K.black);
    m.box(14, 0, z, 15, 2, z + 1, K.black);
  }
  return m;
}

/** Poteau d'angle du ring : poteau d'acier, coussin d'angle, amorces des trois cordes. */
function ringPost(v: number): M {
  const m = VoxelModel.meters(0.55, 1.6, 0.55);
  const pad = v % 2 ? K.blue : K.red;
  const W = m.sx;
  const c = Math.floor(W / 2);
  m.box(c - 1, 0, c - 1, c + 2, m.sy - 1, c + 2, K.gunDk);
  m.box(c - 1, m.sy - 1, c - 1, c + 2, m.sy, c + 2, K.chrome);
  m.box(c - 2, 8, c - 2, c + 3, m.sy - 1, c + 3, pad);
  for (const y of [12, 17, 22]) {
    m.box(c - 2, y, c - 2, c + 3, y + 1, c + 3, shade(pad, 0.7));
    const rope = y === 17 ? K.white : K.red;
    m.box(0, y + 1, c, W, y + 2, c + 1, rope);
    m.box(c, y + 1, 0, c + 1, y + 2, W, rope);
  }
  return m;
}

// ====================================================================== Chinatown, marché, boutiques

/** Table de mah-jong : tapis vert, rebord de bois, murs de tuiles, mains des joueurs, défausses. */
function mahjongTable(v: number): M {
  const m = mk('MAHJONG_TABLE');
  const W = m.sx;
  const D = m.sz;
  const T = 11;
  const felt = v % 2 ? K.feltBlue : K.feltGreen;
  const wood = K.rosewood;
  // pieds galbés, ceinture
  legs4(m, 1, 1, W - 1, D - 1, 0, T, wood, 2);
  m.box(1, T - 2, 1, W - 1, T, D - 1, wood);
  m.box(2, T - 2, 1, W - 2, T - 1, 2, K.gold);
  // plateau : tapis et rebord
  m.box(0, T, 0, W, T + 1, D, wood);
  m.box(1, T, 1, W - 1, T + 1, D - 1, felt);
  m.box(0, T + 1, 0, W, T + 2, 1, wood);
  m.box(0, T + 1, D - 1, W, T + 2, D, wood);
  m.box(0, T + 1, 0, 1, T + 2, D, wood);
  m.box(W - 1, T + 1, 0, W, T + 2, D, wood);
  // murs de tuiles (dos verts) en carré
  const back = 0x2f8a5a;
  const ivory = 0xf0ead8;
  m.box(4, T + 1, 4, 12, T + 2, 5, ivory);
  m.box(4, T + 2, 4, 12, T + 3, 5, back);
  m.box(4, T + 1, 11, 12, T + 2, 12, ivory);
  m.box(4, T + 2, 11, 12, T + 3, 12, back);
  m.box(4, T + 1, 5, 5, T + 2, 11, ivory);
  m.box(4, T + 2, 5, 5, T + 3, 11, back);
  m.box(11, T + 1, 5, 12, T + 2, 11, ivory);
  m.box(11, T + 2, 5, 12, T + 3, 11, back);
  // mains debout devant chaque joueur
  m.box(4, T + 1, 2, 12, T + 3, 3, ivory);
  m.box(4, T + 1, D - 3, 12, T + 3, D - 2, ivory);
  m.box(2, T + 1, 4, 3, T + 3, 12, ivory);
  m.box(W - 3, T + 1, 4, W - 2, T + 3, 12, ivory);
  for (let i = 4; i < 12; i += 2) {
    m.set(i, T + 2, D - 2, K.red);
    m.set(i + 1, T + 2, 2, K.blue);
  }
  // défausses et dés au centre
  for (const [x, z, c] of [
    [6, 7, K.red],
    [8, 6, K.feltGreen],
    [9, 8, K.blue],
    [7, 9, K.red],
  ] as [number, number, number][]) {
    m.set(x, T + 1, z, ivory);
    m.set(x, T + 1, z + 1, c);
  }
  m.set(8, T + 1, 9, K.white);
  return m;
}

/** Table basse à thé en bois de rose : ceinture ajourée, plateau de bambou, théière de terre et tasses. */
function teaTable(v: number): M {
  const m = mk('TEA_TABLE', 0.2);
  const W = m.sx;
  const D = m.sz;
  const T = 5;
  const wood = K.rosewood;
  legs4(m, 0, 0, W, D, 0, T, wood, 2);
  // ceinture à motif de nuages (découpes en escalier)
  m.box(1, T - 2, 1, W - 1, T, D - 1, wood);
  m.box(2, T - 2, 2, W - 2, T, D - 2, -1);
  for (const x of [4, 8, 10, 14]) {
    m.box(x, T - 2, 0, x + 1, T - 1, 1, -1);
    m.box(x, T - 2, D - 1, x + 1, T - 1, D, -1);
  }
  cbox(m, 0, T, 0, W, T + 1, D, wood, 1);
  m.box(1, T, 1, W - 1, T + 1, 2, shade(wood, 1.25));
  // plateau à thé en bambou
  m.box(4, T + 1, 4, 15, T + 2, 13, 0xc8a85a);
  for (let x = 5; x < 15; x += 2) m.box(x, T + 1, 4, x + 1, T + 2, 13, 0xa88a42);
  // théière yixing : panse, bec, anse, couvercle
  const clay = 0x8a4632;
  m.box(7, T + 2, 7, 11, T + 4, 10, clay);
  m.box(8, T + 4, 8, 10, T + 5, 9, clay);
  m.set(9, T + 5, 8, shade(clay, 0.8));
  m.box(11, T + 3, 8, 13, T + 4, 9, clay);
  m.set(12, T + 4, 8, clay);
  m.box(6, T + 3, 8, 7, T + 5, 9, clay);
  // tasses de porcelaine bleue et blanche, boîte à thé rouge
  for (const [x, z] of [
    [5, 5],
    [13, 5],
    [5, 11],
    [13, 11],
  ]) {
    m.set(x, T + 2, z, K.white);
    m.set(x, T + 2, z, 0xe8eef4);
  }
  m.box(15, T + 1, 15, 17, T + 3, 17, K.red);
  m.box(15, T + 3, 15, 17, T + 4, 17, K.gold);
  void v;
  return m;
}

/** Coussin de sol en soie : bombé, bordure brodée, bouton central, glands dorés. */
function cushion(v: number): M {
  const m = mk('CUSHION', 0.05);
  const W = m.sx;
  const silk = [0xa01c28, 0x1f3f7a, 0x2a6a4a][v % 3];
  m.box(0, 0, 0, W, 2, W, silk);
  m.box(1, 2, 1, W - 1, 3, W - 1, silk);
  for (const [x, z] of [
    [0, 0],
    [W - 1, 0],
    [0, W - 1],
    [W - 1, W - 1],
  ])
    m.set(x, 1, z, K.gold);
  m.box(1, 2, 1, W - 1, 3, 2, K.gold);
  m.box(1, 2, W - 2, W - 1, 3, W - 1, K.gold);
  m.box(1, 2, 1, 2, 3, W - 1, K.gold);
  m.box(W - 2, 2, 1, W - 1, 3, W - 1, K.gold);
  m.box(4, 2, 4, 6, 3, 6, shade(silk, 0.7));
  m.set(4, 3, 4, K.gold);
  return m;
}

/** Charpente commune des étals : quatre poteaux, comptoir, auvent en pente (bord lumineux). */
function stallFrame(m: M, awning: number, awning2: number, edge: number, counter: number): void {
  const W = m.sx;
  const D = m.sz;
  for (const x of [0, W - 2])
    for (const z of [1, D - 2]) {
      const h = z === 1 ? 37 : 33;
      m.box(x, 0, z, x + 2, h, z + 1, K.gunDk);
    }
  // auvent : plus haut à l'arrière, rayé, débord avant
  for (let z = 0; z < D; z++) {
    const y = 37 - Math.floor((z * 4) / D);
    for (let x = 0; x < W; x++) m.set(x, y, z, Math.floor(x / 4) % 2 ? awning2 : awning);
  }
  for (let x = 0; x < W; x++) {
    m.set(x, 33, D - 1, Math.floor(x / 4) % 2 ? awning2 : awning);
    m.set(x, 32, D - 1, x % 4 === 1 ? awning : -1);
  }
  m.box(0, 33, D - 2, W, 34, D - 1, edge);
  // comptoir
  m.box(1, 0, D - 7, W - 1, 14, D - 1, counter);
  m.box(0, 14, D - 8, W, 15, D, shade(counter, 1.25));
  m.box(1, 1, D - 1, W - 1, 2, D, edge);
}

/** Étal de marché de nuit (néon de la variante) : gadgets, fruits, lanternes ou baskets. */
function marketStall(v: number): M {
  const m = mk('MARKET_STALL');
  const W = m.sx;
  const D = m.sz;
  const k = v % 4;
  stallFrame(m, [K.red, 0x1f6a7a, K.navy, 0x6a2a7a][k], K.white, SLOT.NEON, [K.carbon, 0x6a4a2a, K.redDk, K.gunDk][k]);
  // enseigne lumineuse sur l'auvent
  m.box(8, 34, D - 3, W - 8, 38, D - 2, K.black);
  m.box(9, 35, D - 3, W - 9, 37, D - 2, SLOT.SCREEN);
  m.box(8, 34, D - 2, W - 8, 35, D - 1, SLOT.NEON);
  // étagères du fond et tabouret
  m.box(2, 0, 2, W - 2, 26, 4, shade(K.gunDk, 1.2));
  for (const y of [10, 17, 24]) m.box(2, y, 4, W - 2, y + 1, 7, K.gun);
  m.box(17, 0, 9, 21, 8, 12, K.red);
  m.box(16, 8, 8, 22, 9, 13, K.redDk);
  const r = rng(500 + k);
  const T = 15;
  if (k === 0) {
    // gadgets : téléphones à écran, câbles, drones miniatures
    for (let x = 3; x < W - 3; x += 3) {
      m.box(x, T, D - 6, x + 2, T + 1, D - 3, K.black);
      m.box(x, T + 1, D - 5, x + 2, T + 3, D - 4, r() < 0.5 ? SLOT.SCREEN : K.gunDk);
    }
    for (const y of [11, 18]) for (let x = 3; x < W - 3; x += 4) m.box(x, y, 4, x + 3, y + 2 + Math.floor(r() * 3), 6, [K.white, K.black, K.blue][Math.floor(r() * 3)]);
    discXZ(m, 8, D - 9, 2, T, T + 1, K.orange);
  } else if (k === 1) {
    // fruits en pyramides dans des cagettes
    const fruit = [K.orange, 0xc82a3a, 0xd84a8a, 0x8ab83a, K.yellow];
    for (let i = 0; i < 5; i++) {
      const x0 = 2 + i * 7;
      m.box(x0, T, D - 7, x0 + 6, T + 2, D - 2, K.pine);
      const c = fruit[i];
      m.box(x0 + 1, T + 2, D - 6, x0 + 5, T + 3, D - 3, c);
      m.box(x0 + 2, T + 3, D - 5, x0 + 4, T + 4, D - 4, c);
      m.set(x0 + 2, T + 3, D - 5, shade(c, 1.2));
    }
    for (const y of [11, 18]) for (let x = 3; x < W - 3; x += 5) m.box(x, y, 4, x + 4, y + 3, 7, K.pine);
  } else if (k === 2) {
    // lanternes de papier suspendues, chats porte-bonheur
    for (let x = 4; x < W - 4; x += 6) {
      m.box(x + 1, 29, D - 4, x + 2, 32, D - 3, K.black);
      m.box(x, 25, D - 5, x + 3, 29, D - 2, K.red);
      m.box(x, 25, D - 5, x + 3, 26, D - 2, K.gold);
      m.box(x + 1, 26, D - 2, x + 2, 28, D - 1, SLOT.GLOW);
    }
    for (let x = 3; x < W - 3; x += 5) {
      m.box(x, T, D - 6, x + 3, T + 3, D - 4, K.white);
      m.set(x + 1, T + 3, D - 5, K.white);
      m.set(x + 1, T + 1, D - 4, K.gold);
      m.set(x + 2, T + 2, D - 4, K.red);
    }
  } else {
    // baskets en vitrine et t-shirts suspendus
    for (let x = 3; x < W - 4; x += 5) {
      const c = [K.white, K.red, SLOT.NEON, K.black][Math.floor(r() * 4)];
      m.box(x, T, D - 6, x + 4, T + 1, D - 3, K.white);
      m.box(x, T + 1, D - 6, x + 2, T + 3, D - 3, c);
    }
    m.box(2, 30, 5, W - 2, 31, 6, K.chrome);
    for (let x = 3; x < W - 3; x += 4) {
      const c = [K.black, 0x2a6aa8, K.red, K.white, K.yellow][Math.floor(r() * 5)];
      m.box(x, 21, 5, x + 3, 30, 6, c);
      m.box(x - 1, 27, 5, x + 4, 30, 6, c);
    }
  }
  return m;
}

/** Échoppe de cuisine de rue : plaque rougeoyante, woks, paniers vapeur, canards laqués, vapeur. */
function foodStall(v: number): M {
  const m = mk('FOOD_STALL', 0.2);
  const W = m.sx;
  const D = m.sz;
  const k = v % 3;
  stallFrame(m, K.red, K.yellow, SLOT.NEON_AMBER, 0xb8bcc0);
  const T = 15;
  // menu lumineux au fond
  m.box(6, 24, 2, W - 6, 32, 3, K.black);
  m.box(7, 25, 2, W - 7, 31, 3, SLOT.SCREEN);
  m.box(1, 0, 2, W - 1, 14, 6, K.steel);
  m.box(1, 14, 2, W - 1, 15, 6, K.steelLt);
  // plaque de cuisson rougeoyante
  m.box(3, T, D - 7, 16, T + 1, D - 2, K.black);
  m.box(4, T, D - 6, 15, T + 1, D - 3, SLOT.GLOW);
  if (k === 0) {
    // woks fumants
    for (const cx of [22, 30]) {
      discXZ(m, cx, D - 4.5, 3, T, T + 2, (dx, dz, d) => (d > 2.2 ? K.ink : d > 1 ? 0xd8a050 : 0xe8c070));
      m.box(cx + 3, T + 1, D - 5, cx + 6, T + 2, D - 4, K.walnut);
    }
  } else if (k === 1) {
    // paniers vapeur en bambou empilés
    for (const cx of [22, 29]) for (let i = 0; i < 3; i++) discXZ(m, cx, D - 4.5, 3, T + i * 2, T + i * 2 + 2, (dx, dz, d) => (d > 2.4 ? 0xa88a42 : 0xc8a85a));
  } else {
    // brochettes sur le gril
    m.box(19, T, D - 7, W - 2, T + 1, D - 2, K.black);
    m.box(20, T, D - 6, W - 3, T + 1, D - 3, SLOT.FIRE);
    for (let x = 20; x < W - 3; x += 2) {
      m.box(x, T + 1, D - 7, x + 1, T + 2, D - 1, 0xd8b07a);
      m.box(x, T + 1, D - 6, x + 1, T + 2, D - 3, 0x8a3a1e);
    }
  }
  // nouilles / viande sur la plaque
  for (let x = 5; x < 14; x += 3) m.box(x, T + 1, D - 5, x + 2, T + 2, D - 4, 0xe0c080);
  // canards laqués suspendus
  for (const x of [6, 12, 18]) {
    m.box(x + 1, 28, D - 9, x + 2, 32, D - 8, K.steel);
    m.box(x, 22, D - 10, x + 3, 28, D - 7, 0xb8541e);
    m.box(x + 1, 20, D - 9, x + 2, 22, D - 8, 0x8a3a12);
  }
  // panaches de vapeur
  const r = rng(77 + k);
  for (const cx of [10, 26]) {
    for (let y = T + 2; y < 32; y++) {
      const spread = 1 + (y - T) * 0.12;
      for (let i = 0; i < 3; i++) {
        if (r() < 0.45) continue;
        const x = Math.round(cx + (r() - 0.5) * spread * 2 + Math.sin(y * 0.6) * 1.5);
        const z = Math.round(D - 5 + (r() - 0.5) * spread);
        m.set(x, y, z, y > 26 ? 0xd8dce0 : 0xeef0f2);
      }
    }
  }
  return m;
}

/** Vitrine à gadgets : meuble laqué, cage vitrée (montants chromés), éclairage LED, implants et montres. */
function displayCase(v: number): M {
  const m = mk('DISPLAY_CASE');
  const W = m.sx;
  const H = m.sy;
  const D = m.sz;
  const body = v % 2 ? K.lacquer : K.white;
  m.box(0, 0, 0, W, 9, D, body);
  m.box(1, 0, D - 1, W - 1, 1, D, K.black);
  m.box(1, 8, D - 1, W - 1, 9, D, SLOT.NEON_CYAN);
  // cage vitrée : seuls les montants et le chapeau sont visibles
  for (const x of [0, W - 1]) for (const z of [0, D - 1]) m.box(x, 9, z, x + 1, H, z + 1, K.chrome);
  m.box(0, H - 1, 0, W, H, D, K.chrome);
  m.box(1, H - 1, 1, W - 1, H, D - 1, SLOT.GLASS);
  m.box(1, H - 2, 1, W - 1, H - 1, 2, SLOT.LED);
  m.box(1, 13, 1, W - 1, 14, D - 1, 0x9ab0b8);
  // gadgets : téléphones, montres, bras cybernétique, lunettes AR, implants oculaires
  for (const x of [2, 5, 8]) {
    m.box(x, 9, 4, x + 2, 12, 5, K.black);
    m.box(x, 10, 5, x + 2, 12, 6, SLOT.SCREEN);
  }
  m.box(11, 9, 3, 19, 10, 6, K.chrome);
  m.box(17, 9, 2, 19, 11, 7, K.alu);
  m.set(18, 10, 4, SLOT.NEON_CYAN);
  m.box(2, 14, 3, 7, 15, 4, K.black);
  m.set(3, 14, 4, SLOT.NEON_CYAN).set(5, 14, 4, SLOT.NEON_CYAN);
  for (const x of [9, 12]) {
    m.box(x, 14, 4, x + 2, 15, 6, K.carbon);
    m.set(x, 15, 5, SLOT.SCREEN);
  }
  for (const x of [15, 17]) {
    m.box(x, 14, 4, x + 1, 15, 5, K.chromeHi);
    m.set(x, 14, 5, SLOT.NEON_RED);
  }
  return m;
}

/** Portant de vêtements chromé à roulettes : vestes, chemises et robes sur cintres. */
function clothesRack(v: number): M {
  const m = mk('CLOTHES_RACK');
  const W = m.sx;
  const H = m.sy;
  const D = m.sz;
  const pal = [
    [K.black, 0x2a2a30, SLOT.NEON_PINK, K.red, 0xe0e0e0, 0x3a6aa8],
    [0x4a4e56, K.navy, 0x6a5a48, K.black, 0xd8d0c0, 0x2a3a2a],
    [K.yellow, 0x3aa8a0, K.orange, 0xc84a8a, K.white, 0x5a3aa8],
  ][v % 3];
  // pieds à roulettes, montants, barre
  for (const x of [0, W - 1]) {
    m.box(x, 1, Math.floor(D / 2), x + 1, H, Math.floor(D / 2) + 1, K.chrome);
    m.box(x, 1, 0, x + 1, 2, D, K.chrome);
    m.set(x, 0, 0, K.black).set(x, 0, D - 1, K.black);
  }
  m.box(0, H - 2, Math.floor(D / 2), W, H - 1, Math.floor(D / 2) + 1, K.chrome);
  // vêtements sur cintres (tranches perpendiculaires à la barre)
  const r = rng(13 + v);
  for (let x = 2; x < W - 2; x += 2) {
    const c = pal[Math.floor(r() * pal.length)];
    const len = 9 + Math.floor(r() * 6);
    const top = H - 4;
    m.set(x, H - 3, Math.floor(D / 2), K.alu);
    m.box(x, top - len, 1, x + 1, top, D - 1, c);
    m.box(x, top, 2, x + 1, top + 1, D - 2, c);
    if (r() < 0.4) m.box(x, top - 3, D - 1, x + 1, top - 1, D, shade(typeof c === 'number' && c < 0xf00000 ? c : K.gun, 0.8));
  }
  return m;
}

/** Gondole de magasin double face : étagères garnies de produits colorés, étiquettes de prix. */
function storeShelf(v: number): M {
  const m = mk('STORE_SHELF');
  const W = m.sx;
  const H = m.sy;
  const D = m.sz;
  const k = v % 3;
  const goods = [
    [K.red, K.yellow, 0x2a8a4a, 0x2a5aa8, K.orange, K.white, 0x8a2a6a],
    [K.white, 0x2aa8a0, K.red, 0xe8e8f0, 0x3a6aa8, 0xd8e0e0],
    [K.black, 0x2a5aa8, K.white, 0x8a9098, K.orange, 0x3ab0c8],
  ][k];
  const frame = k === 2 ? 0x6a7078 : 0xd8dcde;
  // dos central, joues, socle
  m.box(1, 0, 3, W - 1, H - 2, 5, frame);
  m.box(0, 0, 0, 1, H, D, frame);
  m.box(W - 1, 0, 0, W, H, D, frame);
  m.box(1, 0, 0, W - 1, 2, D, shade(frame, 0.8));
  m.box(1, H - 3, 0, W - 1, H - 2, D, frame);
  m.box(2, H - 2, 3, W - 2, H, 5, k === 2 ? SLOT.NEON_BLUE : K.red);
  const r = rng(91 + k);
  for (const y0 of [2, 9, 16]) {
    // tablettes (avant et arrière) avec étiquettes
    m.box(1, y0, 0, W - 1, y0 + 1, D, shade(frame, 0.9));
    for (let x = 3; x < W - 2; x += 6) {
      m.set(x, y0, 0, K.white);
      m.set(x, y0, D - 1, K.white);
    }
    // produits des deux côtés
    for (const side of [0, 1]) {
      let x = 1;
      while (x < W - 1) {
        const w = 1 + Math.floor(r() * 3);
        const h = 2 + Math.floor(r() * 4);
        const c = goods[Math.floor(r() * goods.length)];
        const x1 = Math.min(W - 1, x + w);
        if (side === 0) m.box(x, y0 + 1, 0, x1, y0 + 1 + h, 3, c);
        else m.box(x, y0 + 1, 5, x1, y0 + 1 + h, D, c);
        if (k === 2 && r() < 0.3) m.set(x, y0 + h, side === 0 ? 0 : D - 1, SLOT.LED);
        x = x1 + (r() < 0.2 ? 1 : 0);
      }
    }
  }
  return m;
}

/** Caisse enregistreuse : tapis roulant, scanner, terminal (écran côté caissier), afficheur client. */
function checkout(v: number): M {
  const m = mk('CHECKOUT', 0.3);
  const W = m.sx;
  const D = m.sz;
  const T = 14;
  const body = v % 2 ? K.gunDk : K.white;
  const stripe = v % 2 ? SLOT.NEON_CYAN : 0x1f8a8a;
  m.box(0, 0, 0, W, T, D, body);
  m.box(0, 0, D - 1, W, 1, D, K.black);
  m.box(0, 9, D - 1, W, 11, D, stripe);
  m.box(0, 1, D - 1, W, 2, D, SLOT.LED);
  // plan : tapis roulant noir, scanner, zone d'emballage
  m.box(0, T, 0, W, T + 1, D, K.gunLt);
  m.box(1, T, 2, 14, T + 1, D - 2, K.rubber);
  m.box(1, T + 1, 2, 14, T + 2, 3, K.chrome);
  m.box(1, T + 1, D - 3, 14, T + 2, D - 2, K.chrome);
  m.box(15, T, 3, 19, T + 1, D - 3, SLOT.GLASS);
  m.box(16, T, 5, 18, T + 1, 6, SLOT.NEON_RED);
  // produits sur le tapis
  m.box(3, T + 1, 4, 5, T + 3, 6, K.red);
  m.box(7, T + 1, 5, 10, T + 2, 8, K.yellow);
  m.box(11, T + 1, 4, 12, T + 4, 5, 0x2a8a4a);
  // sac
  m.box(21, T + 1, 4, 26, T + 5, 8, K.paper);
  m.box(22, T + 5, 5, 25, T + 6, 7, K.paperDk);
  // terminal : écran caissier (−Z) et afficheur client (+Z)
  m.box(20, T + 1, 1, 22, T + 4, 2, K.black);
  m.box(17, T + 4, 0, 25, T + 9, 2, K.black);
  m.box(18, T + 5, 0, 24, T + 8, 1, SLOT.SCREEN);
  m.box(18, T + 5, 1, 24, T + 8, 2, SLOT.SCREEN);
  m.box(26, T + 1, D - 3, 28, T + 2, D - 1, K.black);
  m.set(27, T + 2, D - 2, SLOT.NEON_GREEN);
  return m;
}

/** Mur de tiroirs d'herboriste de Chinatown : bas d'armoire, grille de tiroirs à étiquettes, bocaux, fronton laqué. */
function herbShelf(v: number): M {
  const m = mk('HERB_SHELF');
  const W = m.sx;
  const H = m.sy;
  const D = m.sz;
  const wood = K.walnut;
  const front = 0x7a5232;
  m.box(0, 0, 0, W, H - 4, D - 1, wood);
  // bas d'armoire : deux portes
  m.box(0, 0, D - 1, W, 1, D, K.walnutDk);
  for (const [x0, x1] of [
    [1, 16],
    [16, W - 1],
  ]) {
    m.box(x0, 1, D - 1, x1, 11, D, front);
    m.box(x0 + 1, 2, D - 1, x1 - 1, 10, D, wood);
  }
  m.box(14, 5, D - 1, 15, 8, D, K.brass);
  m.box(17, 5, D - 1, 18, 8, D, K.brass);
  m.box(0, 11, D - 2, W, 12, D, K.walnutDk);
  // grille de tiroirs : façade, poignée de laiton, étiquette rouge
  for (let row = 0; row < 6; row++)
    for (let col = 0; col < 8; col++) {
      const x0 = 1 + col * 4;
      const y0 = 12 + row * 3;
      m.box(x0, y0, D - 1, x0 + 3, y0 + 2, D, front);
      m.set(x0 + 1, y0, D - 1, K.brass);
      m.set(x0 + 1, y0 + 1, D - 1, (row + col) % 3 === 0 ? K.paper : K.red);
    }
  // étagère haute : bocaux de verre et racines de ginseng
  m.box(0, 30, 0, W, 31, D, K.walnutDk);
  const herbs = [0xc8a070, 0x8a5a2a, 0x6a7a3a, 0xa83a2a, 0xd8c890, 0x5a3a22];
  for (let x = 2, i = 0; x < W - 2; x += 5, i++) {
    m.box(x, 31, 2, x + 3, 34, 5, herbs[i % herbs.length]);
    m.box(x, 34, 2, x + 3, 35, 5, 0xc8dce0);
    m.box(x, 35, 2, x + 3, 36, 5, i % 2 ? K.red : K.gold);
  }
  // fronton laqué rouge et or
  m.box(0, H - 4, 0, W, H - 3, 2, K.redDk);
  m.box(4, H - 1, 0, W - 4, H, 2, K.red);
  m.box(0, 29, D - 2, W, 30, D, K.gold);
  void v;
  return m;
}

// ====================================================================== registre

export const VENUE_MODELS: Partial<Record<PropKind, PropModelEntry>> = {
  HOLO_TABLE: { variants: 2, make: holoTable },
  COMMAND_DESK: { variants: 1, make: commandDesk },
  SCREEN_WALL: { variants: 2, make: screenWall },
  DESK_BOSS: { variants: 2, make: deskBoss },
  BOSS_CHAIR: { variants: 2, make: bossChair },
  WEAPON_RACK: { variants: 1, make: weaponRack },
  DESK: { variants: 3, make: desk },
  OFFICE_CHAIR: { variants: 3, make: officeChair },
  COMPUTER: { variants: 2, make: computer },
  LAPTOP_TABLE: { variants: 1, make: laptopTable },
  MAP_TABLE: { variants: 1, make: mapTable },
  SERVER_RACK: { variants: 3, make: serverRack },
  FILING_CABINET: { variants: 3, make: filingCabinet },
  SAFE: { variants: 2, make: safe },
  VAULT_DOOR: { variants: 2, make: vaultDoor },
  WEAPON_LOCKER: { variants: 1, make: weaponLocker },
  AMMO_CRATE: { variants: 2, make: ammoCrate },
  DUFFEL_BAG: { variants: 2, make: duffelBag },
  WORKBENCH: { variants: 1, make: workbench },
  TOOL_WALL: { variants: 1, make: toolWall },
  CAR_LIFT: { variants: 1, make: carLift },
  TIRE_STACK: { variants: 3, make: tireStack },
  BARREL: { variants: 5, make: barrel },
  CRATE: { variants: 3, make: crate },
  CRATE_STACK: { variants: 2, make: crateStack },
  PALLET_STACK: { variants: 3, make: palletStack },
  CONTAINER: { variants: 5, make: container },
  FORKLIFT: { variants: 2, make: forklift },
  SHELF_RACK: { variants: 2, make: shelfRack },
  DJ_BOOTH: { variants: 1, make: djBooth },
  SPEAKER_STACK: { variants: 2, make: speakerStack },
  STAGE_LIGHTS: { variants: 1, make: stageLights },
  CASINO_TABLE: { variants: 3, make: casinoTable },
  SLOT_MACHINE: { variants: 3, make: slotMachine },
  ROULETTE: { variants: 1, make: roulette },
  CARD_TABLE: { variants: 2, make: cardTable },
  POOL_TABLE: { variants: 3, make: poolTable },
  PUNCHING_BAG: { variants: 2, make: punchingBag },
  WEIGHT_BENCH: { variants: 2, make: weightBench },
  RING_POST: { variants: 2, make: ringPost },
  MAHJONG_TABLE: { variants: 2, make: mahjongTable },
  TEA_TABLE: { variants: 1, make: teaTable },
  CUSHION: { variants: 3, make: cushion },
  MARKET_STALL: { variants: 4, make: marketStall },
  FOOD_STALL: { variants: 3, make: foodStall },
  DISPLAY_CASE: { variants: 2, make: displayCase },
  CLOTHES_RACK: { variants: 3, make: clothesRack },
  STORE_SHELF: { variants: 3, make: storeShelf },
  CHECKOUT: { variants: 2, make: checkout },
  HERB_SHELF: { variants: 1, make: herbShelf },
};
