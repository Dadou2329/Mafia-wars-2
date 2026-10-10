// Outils partagés par les modèles d'accessoires supplémentaires (street, furniture, decor…).
// Résolution 1/16 m, origine au centre de la base, l'avant regarde vers +Z.

import { SLOT, VoxelModel, shade, mix } from '../voxelModel';
import { C } from './palette';

export { SLOT, VoxelModel, shade, mix, C };

/** Couleurs supplémentaires (sRGB). */
export const P = {
  // métaux
  ironBlack: 0x18191c,
  ironMid: 0x2a2d31,
  ironLight: 0x4c5158,
  steel: 0x6b727b,
  steelLight: 0xa3abb4,
  goldLight: 0xf3d27a,
  goldDark: 0x9a7224,
  brassLight: 0xdcbc68,
  copperDark: 0x7a4426,
  silverDark: 0x8b939d,
  bronzeDark: 0x3a2c18,
  bronzeMid: 0x5a4628,
  bronzeLight: 0x7e6a42,
  verdigris: 0x5f8f78,
  verdigrisDark: 0x3f6656,
  rust: 0x6e3a1e,
  // peintures
  brunswick: 0x1d3828,
  brunswickLight: 0x2c5039,
  maroon: 0x5a1418,
  navyPaint: 0x1a2a48,
  cream: 0xe9dfc6,
  creamDark: 0xcfc2a2,
  // bois
  rosewood: 0x3d1a12,
  ebony: 0x151110,
  teak: 0x7a4e2a,
  oakLight: 0xa57a48,
  // pierre
  granite: 0x8d8984,
  graniteDark: 0x6a6662,
  graniteLight: 0xa8a49e,
  portland: 0xcdc6b4,
  portlandDark: 0xa39c8a,
  slate: 0x474d55,
  marbleVein: 0xb8b4ac,
  // tissus
  velvetRedLight: 0x9a2630,
  velvetRedDark: 0x4e0e14,
  canvas: 0xe8dec6,
  ticking: 0xc9c2b0,
  wool: 0x7d7a74,
  woolDark: 0x5c5a55,
  lace: 0xf4efe4,
  // nature
  leaf: 0x3d6b2c,
  leafDark: 0x24451b,
  leafLight: 0x6a9a42,
  earth: 0x3d2a1c,
  straw: 0xd2bb6c,
  hemp: 0xb39d6c,
  hempDark: 0x8a7550,
  ice: 0xd6e6ee,
  // papier
  newsprint: 0xd9d2c0,
  parchment: 0xd8c49a,
  // aliments
  carrot: 0xd2691e,
  turnip: 0xe2d6d0,
  turnipTop: 0x8a3a6a,
  pear: 0xc8b84a,
  grape: 0x4a2a5a,
  salmon: 0xe0806a,
  lobster: 0xb8301e,
  crust: 0x8e5426,
  crustLight: 0xd29a56,
  ham: 0xb0524a,
  porcelain: 0xf2f0ea,
  blueWare: 0x2a4a8a,
  // divers
  candle: 0xf0e8d0,
  feather: 0xf4f0e8,
  black: 0x111111,
};

/** Hachage déterministe → [0,1). */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647) + Math.imul(seed | 0, 1013904223)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffff) / 65536;
}

/** Générateur pseudo-aléatoire simple (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pred = (c: number, x: number, y: number, z: number) => boolean;

/**
 * Veinage : variation de teinte constante le long d'un axe (les faces fusionnent quand même
 * dans la direction du fil). `amount` ≈ 0.04–0.1.
 */
export function grain(m: VoxelModel, axis: 'x' | 'y' | 'z', amount: number, seed: number, only?: Pred): VoxelModel {
  return m.forEach((x, y, z, c) => {
    if (c >= 0xf00000) return;
    if (only && !only(c, x, y, z)) return;
    const h = axis === 'x' ? hash3(0, y, z, seed) : axis === 'y' ? hash3(x, 0, z, seed) : hash3(x, y, 0, seed);
    return shade(c, 1 + (h * 2 - 1) * amount);
  });
}

/** Bruit de couleur par blocs (bs voxels) : aspect « peint à la main » sans exploser les faces. */
export function blockJitter(m: VoxelModel, amount: number, seed: number, bs = 2, only?: Pred): VoxelModel {
  return m.forEach((x, y, z, c) => {
    if (c >= 0xf00000) return;
    if (only && !only(c, x, y, z)) return;
    const h = hash3(Math.floor(x / bs), Math.floor(y / bs), Math.floor(z / bs), seed);
    return shade(c, 1 + (h * 2 - 1) * amount);
  });
}

/** Bruit par voxel limité à certaines couleurs. */
export function speckle(m: VoxelModel, amount: number, seed: number, only?: Pred): VoxelModel {
  return m.forEach((x, y, z, c) => {
    if (c >= 0xf00000) return;
    if (only && !only(c, x, y, z)) return;
    const h = hash3(x, y, z, seed);
    return shade(c, 1 + (h * 2 - 1) * amount);
  });
}

/** Ensemble de couleurs → prédicat. */
export function colors(...cs: number[]): (c: number) => boolean {
  const s = new Set(cs);
  return (c) => s.has(c);
}

/** Boîte aux arêtes verticales abattues. */
export function rbox(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): VoxelModel {
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

/** Remplace les voxels pleins d'une boîte par une couleur (ne crée rien). */
export function paint(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): VoxelModel {
  for (let y = Math.max(0, y0); y < Math.min(m.sy, y1); y++)
    for (let z = Math.max(0, z0); z < Math.min(m.sz, z1); z++)
      for (let x = Math.max(0, x0); x < Math.min(m.sx, x1); x++) if (m.get(x, y, z) >= 0) m.set(x, y, z, c);
  return m;
}

/** Remplit seulement les cases vides d'une boîte. */
export function fillEmpty(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): VoxelModel {
  for (let y = Math.max(0, y0); y < Math.min(m.sy, y1); y++)
    for (let z = Math.max(0, z0); z < Math.min(m.sz, z1); z++)
      for (let x = Math.max(0, x0); x < Math.min(m.sx, x1); x++) if (m.get(x, y, z) < 0) m.set(x, y, z, c);
  return m;
}

/**
 * Pixel art : `rows` de haut en bas, chaque caractère → couleur via `legend` (espace ou '.' = rien).
 * plan 'xy' : face avant à z, colonnes vers +x, lignes vers -y depuis yTop.
 * plan 'zy' : face latérale à x, colonnes vers +z.
 * plan 'xz' : dessus à y, colonnes vers +x, lignes vers +z (ligne 0 = arrière).
 */
export function pix(
  m: VoxelModel,
  rows: string[],
  legend: Record<string, number>,
  plane: 'xy' | 'zy' | 'xz',
  a0: number,
  b0: number,
  c: number,
  depth = 1,
): VoxelModel {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let k = 0; k < row.length; k++) {
      const ch = row[k];
      if (ch === ' ' || ch === '.') continue;
      const col = legend[ch];
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

/** Courbe de Bézier quadratique de voxels (épaisseur optionnelle). */
export function curve(
  m: VoxelModel,
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  c: number,
  thick = 0,
  steps = 0,
): VoxelModel {
  const n = steps || Math.ceil(Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2])) * 2 + 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const d = t * t;
    const x = a * p0[0] + b * p1[0] + d * p2[0];
    const y = a * p0[1] + b * p1[1] + d * p2[1];
    const z = a * p0[2] + b * p1[2] + d * p2[2];
    if (thick <= 0) m.set(x, y, z, c);
    else m.box(x - thick, y - thick, z - thick, x + thick + 1, y + thick + 1, z + thick + 1, c);
  }
  return m;
}

/** Ligne épaisse d'un voxel sans trous diagonaux (chaque pas reste connexe par face). */
export function line6(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): VoxelModel {
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
    // avance axe par axe pour garder la connexité
    while (px !== x || py !== y || pz !== z) {
      if (px !== x) px += Math.sign(x - px);
      else if (py !== y) py += Math.sign(y - py);
      else pz += Math.sign(z - pz);
      m.set(px, py, pz, c);
    }
  }
  return m;
}

/**
 * Roue à rayons. axis = axe du moyeu ('x' : roue dans le plan YZ, 'z' : plan XY).
 * (cu, cv) centre dans le plan ((y, z) pour 'x', (x, y) pour 'z'), [w0, w1) épaisseur de la jante.
 */
export function wheel(
  m: VoxelModel,
  axis: 'x' | 'z',
  cu: number,
  cv: number,
  w0: number,
  w1: number,
  R: number,
  o: { spokes?: number; wood: number; tyre?: number; hub?: number; hubR?: number; hubW?: [number, number]; rimW?: number; phase?: number; spokeW?: number },
): VoxelModel {
  const spokes = o.spokes ?? 10;
  const rimW = o.rimW ?? 1.6;
  const hubR = o.hubR ?? 1.6;
  const phase = o.phase ?? 0;
  const set = (u: number, v: number, w: number, c: number) => {
    if (axis === 'x') m.set(w, u, v, c);
    else m.set(u, v, w, c);
  };
  for (let u = Math.floor(cu - R - 1); u <= Math.ceil(cu + R); u++)
    for (let v = Math.floor(cv - R - 1); v <= Math.ceil(cv + R); v++) {
      const du = u + 0.5 - cu;
      const dv = v + 0.5 - cv;
      const r = Math.hypot(du, dv);
      if (r > R) continue;
      let c = -1;
      if (o.tyre !== undefined && r > R - 0.9) c = o.tyre;
      else if (r > R - rimW - (o.tyre !== undefined ? 0.9 : 0)) c = o.wood;
      else if (r <= hubR) c = o.hub ?? o.wood;
      else {
        const a = Math.atan2(dv, du) - phase;
        const step = (Math.PI * 2) / spokes;
        const k = Math.round(a / step);
        const da = a - k * step;
        if (Math.abs(Math.sin(da)) * r < (o.spokeW ?? 0.55) && Math.cos(da) > 0) c = shade(o.wood, 1.08);
      }
      if (c < 0) continue;
      for (let w = w0; w < w1; w++) set(u, v, w, c);
    }
  if (o.hubW) {
    for (let u = Math.floor(cu - hubR - 1); u <= Math.ceil(cu + hubR); u++)
      for (let v = Math.floor(cv - hubR - 1); v <= Math.ceil(cv + hubR); v++) {
        const r = Math.hypot(u + 0.5 - cu, v + 0.5 - cv);
        if (r > hubR) continue;
        for (let w = o.hubW[0]; w < o.hubW[1]; w++) set(u, v, w, r > hubR - 0.8 ? o.hub ?? o.wood : shade(o.hub ?? o.wood, 0.8));
      }
  }
  return m;
}

/** Pied tourné d'un voxel avec renflements (perles) aux hauteurs données. */
export function turnedLeg(m: VoxelModel, x: number, z: number, y0: number, y1: number, c: number, beads: number[] = [], beadC?: number): VoxelModel {
  m.box(x, y0, z, x + 1, y1, z + 1, c);
  for (const y of beads) {
    const bc = beadC ?? shade(c, 1.1);
    m.set(x - 1, y, z, bc).set(x + 1, y, z, bc).set(x, y, z - 1, bc).set(x, y, z + 1, bc).set(x, y, z, bc);
  }
  return m;
}

/** Panneau mouluré sur la face avant (z = face extérieure) : cadre en relief d'un voxel. */
export function framePanel(m: VoxelModel, x0: number, y0: number, x1: number, y1: number, z: number, c: number): VoxelModel {
  m.box(x0, y0, z, x1, y0 + 1, z + 1, c);
  m.box(x0, y1 - 1, z, x1, y1, z + 1, c);
  m.box(x0, y0, z, x0 + 1, y1, z + 1, c);
  m.box(x1 - 1, y0, z, x1, y1, z + 1, c);
  return m;
}

/** Disque plein (cylindre fin) dans le plan XY à z (face avant). */
export function discXY(m: VoxelModel, cx: number, cy: number, r: number, z0: number, z1: number, c: number | ((dx: number, dy: number, d: number) => number)): VoxelModel {
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

/** Livres serrés sur une étagère (dos vers +z), souvent en collections de même reliure. */
export function books(
  m: VoxelModel,
  x0: number,
  x1: number,
  y0: number,
  maxH: number,
  zb: number,
  zf: number,
  seed: number,
  palette: number[],
  gaps = 0.08,
): void {
  const r = rng(seed);
  let x = x0;
  while (x < x1) {
    if (r() < gaps) {
      x++;
      continue;
    }
    // une collection : 1 à 4 volumes identiques
    const n = Math.min(x1 - x, 1 + Math.floor(r() * 4));
    const c = palette[Math.floor(r() * palette.length)];
    const h = Math.max(2, maxH - Math.floor(r() * 3));
    const depth = r() < 0.1 ? 1 : 0;
    const band = r() < 0.5;
    m.box(x, y0, zb, x + n, y0 + h, zf - depth, c);
    if (band) m.box(x, y0 + h - 2, zf - depth - 1, x + n, y0 + h - 1, zf - depth, C.gold);
    // séparation discrète entre volumes
    for (let k = 1; k < n; k += 2) m.box(x + k, y0, zf - depth - 1, x + k + 1, y0 + h, zf - depth, shade(c, 0.85));
    if (band) for (let k = 1; k < n; k += 2) m.set(x + k, y0 + h - 2, zf - depth - 1, P.goldDark);
    x += n;
  }
}

/** Veinage limité à une boîte. */
export function grainBox(
  m: VoxelModel,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  axis: 'x' | 'y' | 'z',
  amount: number,
  seed: number,
): VoxelModel {
  return grain(m, axis, amount, seed, (c, x, y, z) => x >= x0 && x < x1 && y >= y0 && y < y1 && z >= z0 && z < z1);
}

/** Bouton / poignée d'un voxel sur une face avant. */
export function knob(m: VoxelModel, x: number, y: number, z: number, c = C.brass): VoxelModel {
  return m.set(x, y, z, c);
}

/** Tiroir : façade légèrement plus claire, joint sombre autour, poignée centrale. */
export function drawer(m: VoxelModel, x0: number, y0: number, x1: number, y1: number, z: number, wood: number, handle = C.brass): VoxelModel {
  m.box(x0, y0, z, x1, y1, z + 1, shade(wood, 1.08));
  m.box(x0, y0, z, x1, y0 + 1, z + 1, shade(wood, 0.7));
  m.box(x0, y0, z, x0 + 1, y1, z + 1, shade(wood, 0.8));
  const hx = Math.floor((x0 + x1) / 2);
  const hy = Math.floor((y0 + y1) / 2);
  m.set(hx, hy, z + 1, handle);
  if (x1 - x0 >= 6) m.set(hx - 1, hy, z + 1, handle);
  return m;
}

/** Police 3×5 pour les petites inscriptions. */
const FONT: Record<string, string[]> = {
  B: ['kk.', 'k.k', 'kk.', 'k.k', 'kk.'],
  U: ['k.k', 'k.k', 'k.k', 'k.k', '.k.'],
  G: ['.kk', 'k..', 'k.k', 'k.k', '.kk'],
  V: ['k.k', 'k.k', 'k.k', 'k.k', '.k.'],
  Y: ['k.k', 'k.k', '.k.', '.k.', '.k.'],
  F: ['kkk', 'k..', 'kk.', 'k..', 'k..'],
  X: ['k.k', 'k.k', '.k.', 'k.k', 'k.k'],
  R2: ['kk.', 'k.k', 'kk.', 'k.k', 'k.k'],
  N: ['k..k', 'kk.k', 'k.kk', 'k..k', 'k..k'],
  E: ['kkk', 'k..', 'kk.', 'k..', 'kkk'],
  W: ['k...k', 'k...k', 'k.k.k', 'kk.kk', 'k...k'],
  S: ['.kk', 'k..', '.k.', '..k', 'kk.'],
  P: ['kk.', 'k.k', 'kk.', 'k..', 'k..'],
  A: ['.k.', 'k.k', 'kkk', 'k.k', 'k.k'],
  R: ['kk.', 'k.k', 'kk.', 'k.k', 'k.k'],
  T: ['kkk', '.k.', '.k.', '.k.', '.k.'],
  O: ['.k.', 'k.k', 'k.k', 'k.k', '.k.'],
  L: ['k..', 'k..', 'k..', 'k..', 'kkk'],
  I: ['k', 'k', 'k', 'k', 'k'],
  C: ['.kk', 'k..', 'k..', 'k..', '.kk'],
  K: ['k.k', 'kk.', 'k..', 'kk.', 'k.k'],
  D: ['kk.', 'k.k', 'k.k', 'k.k', 'kk.'],
  M: ['k...k', 'kk.kk', 'k.k.k', 'k...k', 'k...k'],
  H: ['k.k', 'k.k', 'kkk', 'k.k', 'k.k'],
  ' ': ['.', '.', '.', '.', '.'],
};

/** Texte en pixels sur la face avant (xy) ; renvoie la largeur. */
export function text(m: VoxelModel, s: string, x0: number, yTop: number, z: number, c: number, measureOnly = false): number {
  let x = x0;
  for (const ch of s) {
    const g = FONT[ch] ?? FONT[' '];
    if (!measureOnly) pix(m, g, { k: c }, 'xy', x, yTop, z);
    x += g[0].length + 1;
  }
  return x - x0 - 1;
}


/** Rotation de 180° autour de Y (x et z inversés), origine conservée au centre. */
export function rotate180(m: VoxelModel): VoxelModel {
  const r = new VoxelModel(m.sx, m.sy, m.sz, m.res);
  for (let y = 0; y < m.sy; y++)
    for (let z = 0; z < m.sz; z++)
      for (let x = 0; x < m.sx; x++) {
        const v = m.data[m.idx(x, y, z)];
        if (v) r.data[r.idx(m.sx - 1 - x, y, m.sz - 1 - z)] = v;
      }
  r.setOrigin(m.sx - m.ox, m.oy, m.sz - m.oz);
  return r;
}
