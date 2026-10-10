// Séjour, chambre, cuisine, salle de bains et décoration des logements (New York 2085).
// Résolution 1/16 m (1/32 m pour les petits objets très détaillés : ampoule, tableaux, néons
// d'art, portraits, buste, tapis, cartons de pizza), origine au centre de la base, l'avant
// regarde vers +Z (les objets muraux ont le dos contre le mur, en −Z).
// Le contraste entre le mobilier MISÉRABLE (taches, déchirures, bosses, couleurs passées) et le
// mobilier de LUXE (marbre, or, chrome, velours, LED) porte la sensation de progression.

import type { PropKind } from '../../../shared/city/props';
import type { PropModelEntry } from './index';
import { SLOT, VoxelModel, shade, mix } from '../voxelModel';

// =========================================================================== outils

const R32 = 1 / 32;

/** Hachage déterministe → [0,1). */
function h3(x: number, y: number, z: number, seed: number): number {
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

/** Repeint les cases pleines d'une boîte (ne crée rien). */
function paint(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): void {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(m.sy, Math.ceil(y1)); y++)
    for (let z = Math.max(0, Math.floor(z0)); z < Math.min(m.sz, Math.ceil(z1)); z++)
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(m.sx, Math.ceil(x1)); x++) if (m.get(x, y, z) >= 0) m.set(x, y, z, c);
}

/** Repeint selon une fonction (case pleine → nouvelle couleur, ou undefined pour garder). */
function repaint(m: VoxelModel, fn: (x: number, y: number, z: number, c: number) => number | undefined): void {
  m.forEach((x, y, z, c) => {
    const r = fn(x, y, z, c);
    return r === undefined ? undefined : r;
  });
}

/** Case pleine exposée à l'air sur au moins une face ? */
function exposed(m: VoxelModel, x: number, y: number, z: number): boolean {
  return m.get(x + 1, y, z) < 0 || m.get(x - 1, y, z) < 0 || m.get(x, y + 1, z) < 0 || m.get(x, y - 1, z) < 0 || m.get(x, y, z + 1) < 0 || m.get(x, y, z - 1) < 0;
}

/** Tache irrégulière : assombrit/teinte les cases pleines proches de (cx,cy,cz) dont la couleur est dans `on`. */
function stain(m: VoxelModel, cx: number, cy: number, cz: number, r: number, f: (c: number) => number, seed: number, on?: Set<number>): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const c = m.get(x, y, z);
        if (c < 0 || c >= 0xf00000) continue;
        if (on && !on.has(c)) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz) / r;
        if (d > 1 || d > 0.55 + 0.45 * h3(x, y, z, seed)) continue;
        m.set(x, y, z, f(c));
      }
}

/** Ligne de voxels connexe par faces (sans trous diagonaux). */
function line6(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): void {
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
}

/** Disque (cylindre fin) dans le plan XY, de z0 à z1. */
function discXY(m: VoxelModel, cx: number, cy: number, r: number, z0: number, z1: number, c: number | ((dx: number, dy: number, d: number) => number)): void {
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
}

/** Ellipse pleine dans le plan XZ à la hauteur [y0,y1). */
function ellXZ(m: VoxelModel, cx: number, cz: number, rx: number, rz: number, y0: number, y1: number, c: number): void {
  for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx); x++)
    for (let z = Math.floor(cz - rz - 1); z <= Math.ceil(cz + rz); z++) {
      const dx = (x + 0.5 - cx) / rx;
      const dz = (z + 0.5 - cz) / rz;
      if (dx * dx + dz * dz <= 1) m.box(x, y0, z, x + 1, y1, z + 1, c);
    }
}

/** Boîte aux arêtes verticales abattues. */
function rbox(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): void {
  m.box(x0, y0, z0, x1, y1, z1, c);
  for (const [x, z] of [
    [x0, z0],
    [x1 - 1, z0],
    [x0, z1 - 1],
    [x1 - 1, z1 - 1],
  ])
    m.box(x, y0, z, x + 1, y1, z + 1, -1);
}

/** Coussin : boîte dont les arêtes supérieures avant/latérales sont arrondies. */
function cushion(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number, roundBack = false): void {
  m.box(x0, y0, z0, x1, y1, z1, c);
  const yt = y1 - 1;
  if (y1 - y0 >= 2) {
    m.box(x0, yt, z0, x0 + 1, y1, z1, -1);
    m.box(x1 - 1, yt, z0, x1, y1, z1, -1);
    m.box(x0, yt, z1 - 1, x1, y1, z1, -1);
    if (roundBack) m.box(x0, yt, z0, x1, y1, z0 + 1, -1);
  }
}

/** Veines de marbre continues sur la couche y (zone x0..x1, z0..z1) : n veines sinueuses en diagonale. */
function marbleVeins(m: VoxelModel, y: number, x0: number, z0: number, x1: number, z1: number, n: number, seed: number, c: number, c2: number): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    let x = x0 + r() * (x1 - x0);
    let z = z0;
    const slope = (r() < 0.5 ? 1 : -1) * (0.8 + r() * 1.6);
    let px = Math.floor(x);
    let pz = z;
    for (let k = 0; k < 60; k++) {
      const nx = x + slope + (r() - 0.5) * 1.2;
      const nz = z + 1;
      const xi = Math.floor(nx);
      // tracé continu (connexe) entre deux points successifs
      const step = Math.sign(xi - px);
      for (let xx = px; xx !== xi; xx += step) if (m.get(xx, y, pz) >= 0) m.set(xx, y, pz, c);
      if (nz >= z1 || xi < x0 - 2 || xi > x1 + 2) break;
      if (m.get(xi, y, nz) >= 0) m.set(xi, y, nz, k % 9 === 4 ? c2 : c);
      x = nx;
      z = nz;
      px = xi;
      pz = nz;
    }
  }
}

/** Pixel art : lignes de haut en bas ; plan XY à la couche z (colonnes vers +x). */
function pixXY(m: VoxelModel, rows: string[], legend: Record<string, number>, x0: number, yTop: number, z: number, depth = 1): void {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let k = 0; k < row.length; k++) {
      const col = legend[row[k]];
      if (col === undefined) continue;
      for (let d = 0; d < depth; d++) m.set(x0 + k, yTop - r, z + d, col);
    }
  }
}

/** Pixel art dans le plan XZ (vu de dessus) à la hauteur y : ligne 0 = arrière (z0). */
function pixXZ(m: VoxelModel, rows: string[], legend: Record<string, number>, x0: number, z0: number, y: number): void {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let k = 0; k < row.length; k++) {
      const col = legend[row[k]];
      if (col === undefined) continue;
      m.set(x0 + k, y, z0 + r, col);
    }
  }
}

// =========================================================================== couleurs

const K = {
  // métaux
  gold: 0xd4a640,
  goldLight: 0xf3d27a,
  goldDark: 0x9a7224,
  brass: 0xb08d3c,
  brassDark: 0x7a5f24,
  chrome: 0xc4cad2,
  chromeLight: 0xeef2f6,
  chromeDark: 0x7d858f,
  silver: 0xc9d1dc,
  steel: 0x8a9098,
  steelDark: 0x5a6068,
  blackMetal: 0x1c1d20,
  iron: 0x2a2c30,
  rust: 0x7a4426,
  rustDark: 0x5a3018,
  // bois
  walnut: 0x5a3a24,
  walnutDark: 0x3c2516,
  walnutLight: 0x7a5236,
  oak: 0x9a7448,
  oakDark: 0x6e5030,
  ebony: 0x17120f,
  pine: 0xb08a5a,
  laminate: 0xcfc4a8,
  // pierre
  marble: 0xebe8e2,
  marbleVein: 0xb9b5ad,
  marbleBlack: 0x1d1c1e,
  marbleBlackVein: 0x5a5658,
  // tissus
  crimson: 0x8e1b22,
  crimsonDark: 0x5e1016,
  navy: 0x1d3461,
  navyDark: 0x111f3d,
  ivory: 0xe4dccb,
  ivoryDark: 0xc4b9a3,
  // divers
  black: 0x121214,
  white: 0xf0eee8,
  porcelain: 0xf2f1ec,
  porcelainDark: 0xd8d6d0,
  rubber: 0x1a1a1a,
  paper: 0xe8e2d2,
  cardboard: 0xb08a58,
  cardboardDark: 0x8e6c40,
  foam: 0xd8c47a,
  tape: 0xa6a6a2,
  plant: 0x3d6b2c,
  plantDark: 0x24451b,
  plantLight: 0x6a9a42,
  soil: 0x3a2a1c,
  skin: 0xe0b896,
};

// =========================================================================== séjour : canapés

interface SofaPal {
  fab: number;
  dark: number;
  pillow: number;
  pillow2: number;
  legs: number;
}

const SOFA_PAL: SofaPal[] = [
  { fab: 0x75716a, dark: 0x5a5751, pillow: 0xc8963a, pillow2: 0xe2dccf, legs: K.walnutDark }, // gris chiné
  { fab: 0x8e1b22, dark: 0x60121a, pillow: 0x18141a, pillow2: K.gold, legs: K.gold }, // Dadou
  { fab: 0x22385f, dark: 0x16253f, pillow: 0xd6dbe2, pillow2: 0x8a9098, legs: K.chrome }, // Even
  { fab: 0x245a47, dark: 0x183e31, pillow: 0xd8c49a, pillow2: 0xb08d3c, legs: K.brass }, // émeraude (club)
  { fab: 0xd5cab6, dark: 0xb3a892, pillow: 0x4f6478, pillow2: 0x9a5a3a, legs: K.walnut }, // lin crème (suite, hall)
];

/** Canapé moderne trois places. */
function makeSofa(v: number): VoxelModel {
  const p = SOFA_PAL[v];
  const m = VoxelModel.meters(2.2, 0.85, 0.95); // 35 × 14 × 15
  const W = m.sx;
  const D = m.sz;
  const F = p.fab;
  const Fl = shade(F, 1.1);
  // pieds fuselés
  for (const x of [2, W - 3]) for (const z of [2, D - 3]) m.box(x, 0, z, x + 1, 2, z + 1, p.legs);
  // socle
  m.box(1, 2, 1, W - 1, 5, D, p.dark);
  // dossier
  m.box(0, 2, 0, W, 13, 4, F);
  m.box(0, 12, 3, W, 13, 4, -1);
  // accoudoirs (dessus arrondi vers l'extérieur et vers l'avant)
  for (const [x0, x1, xo] of [
    [0, 4, 0],
    [W - 4, W, W - 1],
  ]) {
    m.box(x0, 2, 1, x1, 10, D, F);
    m.box(xo, 9, 1, xo + 1, 10, D, -1);
    m.box(x0, 9, D - 1, x1, 10, D, -1);
    // passepoil sombre à la base de l'accoudoir
    m.box(x0, 2, D - 1, x1, 3, D, p.dark);
  }
  // coussins d'assise
  for (let i = 0; i < 3; i++) {
    const x0 = 4 + i * 9;
    cushion(m, x0, 5, 4, x0 + 9, 7, D, Fl);
    if (i > 0) {
      m.box(x0, 6, 4, x0 + 1, 7, D, shade(F, 0.78));
      m.box(x0, 5, D - 1, x0 + 1, 6, D, shade(F, 0.78));
    }
  }
  // coussins de dossier (légèrement inclinés)
  for (let i = 0; i < 3; i++) {
    const x0 = 4 + i * 9;
    m.box(x0, 7, 4, x0 + 9, 11, 6, F);
    m.box(x0, 11, 4, x0 + 9, 12, 5, F);
    if (i > 0) m.box(x0, 7, 5, x0 + 1, 11, 6, shade(F, 0.78));
  }
  // coussins décoratifs
  // coussins décoratifs posés contre le dossier
  const pil = (x0: number, c: number) => {
    m.box(x0, 7, 6, x0 + 5, 11, 8, c);
    m.box(x0, 10, 7, x0 + 5, 11, 8, -1);
    m.set(x0, 10, 6, -1).set(x0 + 4, 10, 6, -1);
  };
  pil(5, p.pillow);
  pil(W - 10, p.pillow);
  pil(W - 14, p.pillow2);
  return m;
}

interface LuxPal {
  fab: number;
  dark: number;
  trim: number;
  trimLight: number;
  led: number;
  pillow: number;
}

const LUX_PAL: LuxPal[] = [
  { fab: 0xe2d8c6, dark: 0xb5a88f, trim: K.chrome, trimLight: K.chromeLight, led: SLOT.LED, pillow: 0x2a2a30 }, // ivoire et chrome
  { fab: 0x80161e, dark: 0x4a0a10, trim: K.gold, trimLight: K.goldLight, led: SLOT.NEON_RED, pillow: 0x151214 }, // Dadou
  { fab: 0x203a6a, dark: 0x0f1c38, trim: K.silver, trimLight: 0xf2f5f8, led: SLOT.NEON_BLUE, pillow: 0xc7ced8 }, // Even
  { fab: 0x5d2a80, dark: 0x371450, trim: K.gold, trimLight: K.goldLight, led: SLOT.NEON_PINK, pillow: 0x111014 }, // club VIP
  { fab: 0x7a3c1c, dark: 0x48220c, trim: K.brass, trimLight: K.goldLight, led: SLOT.GLOW, pillow: 0xe0d2b4 }, // cuir cognac
];

/**
 * Capitonnage en losanges sur une face plane : boutons en creux aux nœuds, plis en diagonale.
 * axis 'z' : face du plan XY à la couche z = layer (u = x, v = y) ; axis 'x' : plan ZY (u = z, v = y).
 */
function tuft(m: VoxelModel, axis: 'x' | 'z', layer: number, inward: number, u0: number, u1: number, v0: number, v1: number, base: number, dark: number): void {
  const pleat = mix(base, dark, 0.35);
  for (let v = v0; v < v1; v++)
    for (let u = u0; u < u1; u++) {
      const x = axis === 'z' ? u : layer;
      const z = axis === 'z' ? layer : u;
      if (m.get(x, v, z) < 0) continue;
      const a = (((u - u0 + 2) + (v - v0)) % 4 + 4) % 4;
      const b = (((u - u0 + 2) - (v - v0)) % 4 + 4) % 4;
      if (a === 0 && b === 0) {
        // bouton : en creux d'une case
        m.clear(x, v, z);
        if (axis === 'z') m.set(x, v, z - inward, dark);
        else m.set(x - inward, v, z, dark);
      } else if (a === 0 || b === 0) m.set(x, v, z, pleat);
      else m.set(x, v, z, base);
    }
}

/** Coussin décoratif arrondi (face avant 5 × 4) posé contre un dossier, à partir de (x0, y0, z0). */
function pillow(m: VoxelModel, x0: number, y0: number, z0: number, c: number, w = 5, h = 4): void {
  m.box(x0 + 1, y0, z0, x0 + w - 1, y0 + 1, z0 + 2, c);
  m.box(x0, y0 + 1, z0, x0 + w, y0 + h - 1, z0 + 2, c);
  m.box(x0 + 1, y0 + h - 1, z0, x0 + w - 1, y0 + h, z0 + 1, c);
}

/** Canapé de luxe : Chesterfield en velours capitonné (accoudoirs roulés à hauteur du dossier), filet doré, socle lumineux. */
function makeSofaLuxe(v: number): VoxelModel {
  const p = LUX_PAL[v];
  const m = VoxelModel.meters(2.6, 0.85, 1.0); // 42 × 14 × 16
  const W = m.sx;
  const D = m.sz;
  const F = p.fab;
  const Fl = shade(F, 1.14);
  // socle noir en retrait + bandeau lumineux (le canapé semble flotter)
  m.box(3, 0, 3, W - 3, 1, D - 3, 0x0e0e10);
  m.box(3, 0, D - 4, W - 3, 1, D - 3, p.led);
  // plinthe métallique polie
  m.box(0, 1, 0, W, 2, D, p.trim);
  m.box(0, 1, D - 1, W, 2, D, p.trimLight);
  // dossier et accoudoirs à la même hauteur, boudins roulés
  m.box(0, 2, 0, W, 10, 4, F);
  m.box(0, 2, 0, 5, 10, D, F);
  m.box(W - 5, 2, 0, W, 10, D, F);
  m.box(0, 10, 0, W, 12, 5, Fl);
  m.box(0, 10, 0, 6, 12, D, Fl);
  m.box(W - 6, 10, 0, W, 12, D, Fl);
  m.box(0, 11, 0, W, 12, 1, -1);
  m.box(6, 11, 4, W - 6, 12, 5, -1);
  m.box(0, 11, 0, 1, 12, D, -1);
  m.box(W - 1, 11, 0, W, 12, D, -1);
  m.box(5, 11, 5, 6, 12, D, -1);
  m.box(W - 6, 11, 5, W - 5, 12, D, -1);
  m.box(0, 11, D - 1, 6, 12, D, -1);
  m.box(W - 6, 11, D - 1, W, 12, D, -1);
  // assise : socle + trois coussins
  m.box(5, 2, 4, W - 5, 5, D, shade(F, 0.9));
  m.box(5, 2, D - 1, W - 5, 3, D, p.trim);
  for (const [x0, x1] of [
    [5, 16],
    [16, 26],
    [26, W - 5],
  ]) {
    cushion(m, x0, 5, 5, x1, 7, D, Fl);
    m.box(x0, 5, 4, x1, 6, 5, shade(F, 0.9));
  }
  m.box(16, 6, 5, 17, 7, D - 1, shade(F, 0.8));
  m.box(26, 6, 5, 27, 7, D - 1, shade(F, 0.8));
  // capitonnage : dossier intérieur et extérieur, accoudoirs dedans et dehors
  tuft(m, 'z', 3, 1, 5, W - 5, 7, 10, F, p.dark);
  tuft(m, 'z', 0, -1, 0, W, 3, 10, F, p.dark);
  tuft(m, 'x', 4, 1, 5, D - 1, 7, 10, F, p.dark);
  tuft(m, 'x', W - 5, -1, 5, D - 1, 7, 10, F, p.dark);
  tuft(m, 'x', 0, -1, 0, D - 1, 3, 10, F, p.dark);
  tuft(m, 'x', W - 1, 1, 0, D - 1, 3, 10, F, p.dark);
  // façades des accoudoirs : rosace plissée et bouton métallique
  for (const x0 of [0, W - 6]) {
    m.box(x0 + (x0 === 0 ? 0 : 1), 2, D - 1, x0 + (x0 === 0 ? 5 : 6), 11, D, p.dark);
    m.box(x0 + (x0 === 0 ? 1 : 2), 3, D - 1, x0 + (x0 === 0 ? 4 : 5), 10, D, F);
    m.box(x0 + (x0 === 0 ? 0 : 1), 10, D - 1, x0 + (x0 === 0 ? 6 : 6), 11, D, Fl);
    m.set(x0 + (x0 === 0 ? 2 : 3), 8, D - 1, p.trim);
    m.box(x0 + (x0 === 0 ? 0 : 1), 2, D - 1, x0 + (x0 === 0 ? 5 : 6), 3, D, p.trim);
  }
  // coussins : deux carrés et un traversin
  pillow(m, 6, 7, 5, p.pillow);
  pillow(m, W - 11, 7, 5, p.pillow);
  m.box(W - 18, 7, 6, W - 12, 9, 8, p.trim);
  m.box(W - 18, 7, 6, W - 17, 9, 8, p.trimLight);
  m.box(W - 13, 7, 6, W - 12, 9, 8, p.trimLight);
  return m;
}

interface OldPal {
  fab: number;
  dot: number;
  blanket: number;
  blanket2: number;
}

const OLD_PAL: OldPal[] = [
  { fab: 0x6b5236, dot: 0xa8843a, blanket: 0x56603a, blanket2: 0x3c4428 }, // velours côtelé marron, fleurs moutarde
  { fab: 0x6a3534, dot: 0xa0706a, blanket: 0x9c7a3e, blanket2: 0x6e5428 }, // bordeaux délavé
  { fab: 0x4c5a68, dot: 0x9a9a88, blanket: 0x9a5c38, blanket2: 0x6a3c22 }, // bleu-gris délavé
];

/** Vieux canapé défoncé : coussin affaissé, déchirures (mousse), scotch, brûlures, taches, couverture. */
function makeSofaOld(v: number): VoxelModel {
  const p = OLD_PAL[v];
  const m = VoxelModel.meters(1.9, 0.9, 0.9); // 30 × 14 × 14
  const W = m.sx;
  const D = m.sz;
  const F = p.fab;
  const Fd = shade(F, 0.78);
  const Fc = shade(F, 1.06);
  // pieds de bois tournés (l'avant droit manque : calé sur deux livres)
  for (const [x, z] of [
    [1, 1],
    [W - 2, 1],
    [1, D - 3],
  ])
    m.box(x, 0, z, x + 1, 2, z + 1, K.walnut);
  m.box(W - 4, 0, D - 4, W - 1, 1, D - 1, 0x2a4a7a);
  m.box(W - 4, 1, D - 4, W - 1, 2, D - 1, 0x8a2a24);
  m.box(W - 4, 0, D - 2, W - 1, 2, D - 1, 0xe0dac8);
  // caisse
  m.box(0, 2, 1, W, 5, D - 1, Fd);
  // dossier (le côté droit s'est affaissé)
  m.box(0, 2, 0, W, 13, 4, F);
  m.box(W / 2, 12, 0, W, 13, 4, -1);
  m.box(0, 12, 3, W / 2, 13, 4, -1);
  // accoudoirs carrés
  for (const [x0, x1] of [
    [0, 4],
    [W - 4, W],
  ]) {
    m.box(x0, 2, 1, x1, 9, D - 1, F);
    m.box(x0, 8, D - 2, x1, 9, D - 1, -1);
  }
  // coussins : le gauche correct, le droit défoncé et de travers
  cushion(m, 4, 5, 4, 15, 7, D - 1, Fc);
  m.box(15, 4, 4, 26, 6, D - 1, Fc);
  m.box(15, 6, 4, 25, 7, 7, Fc);
  m.box(15, 4, 4, 16, 6, D - 1, 0x1a1412);
  // coussins de dossier, le droit penché vers l'avant
  m.box(4, 7, 4, 15, 12, 6, F);
  m.box(15, 6, 4, 26, 10, 7, shade(F, 0.95));
  m.box(15, 10, 4, 26, 11, 6, shade(F, 0.95));
  // motif fleuri passé (petits points clairs sur les faces visibles)
  const fabs = new Set([F, Fc, shade(F, 0.95)]);
  repaint(m, (x, y, z, c) => {
    if (!fabs.has(c) || !exposed(m, x, y, z)) return undefined;
    return h3(x >> 1, y >> 1, z >> 1, 17 + v) < 0.08 && (x + y + z) % 2 === 0 ? p.dot : undefined;
  });
  // zones usées / délavées (dessus des accoudoirs, place assise favorite, appui-tête)
  const faded = (c: number) => mix(c, 0xb8ae98, 0.3);
  stain(m, W - 2, 8.5, 6, 3.2, faded, 3);
  stain(m, 9, 7, 9, 3.5, faded, 4);
  stain(m, 9, 11, 5, 3, faded, 5);
  // taches sombres (café, bière)
  stain(m, 12, 6.5, 10, 1.8, (c) => shade(c, 0.6), 7);
  stain(m, 20, 6, 7, 1.6, (c) => mix(c, 0x3a2a14, 0.5), 8);
  stain(m, 6, 4, D - 1.5, 1.5, (c) => shade(c, 0.65), 9);
  stain(m, 22, 8, 6.5, 1.4, (c) => shade(c, 0.62), 10);
  // accoudoir droit éventré : mousse jaune au fond de la déchirure, bords effilochés
  m.box(W - 3, 8, 5, W - 1, 9, 9, -1);
  m.box(W - 3, 7, 5, W - 1, 8, 9, K.foam);
  m.set(W - 2, 7, 6, shade(K.foam, 0.85));
  m.box(W - 3, 8, 4, W - 1, 9, 5, mix(F, 0xd8d0b8, 0.35));
  m.set(W - 4, 8, 6, mix(F, 0xd8d0b8, 0.35));
  // fente sur le coussin gauche (mousse au ras du tissu)
  m.box(6, 5, D - 2, 10, 6, D - 1, K.foam);
  m.set(8, 5, D - 2, shade(K.foam, 0.85));
  // scotch gris sur l'accoudoir droit
  m.box(W - 4, 4, D - 2, W, 7, D - 1, K.tape);
  m.box(W - 4, 4, D - 2, W, 5, D - 1, shade(K.tape, 0.82));
  // brûlures de cigarette
  for (const [x, y, z] of [
    [W - 4, 9, 10],
    [21, 6, 11],
    [12, 7, 6],
  ])
    m.set(x, y - 1, z, 0x15100c);
  // couverture jetée sur l'accoudoir gauche : dessus, retombée devant, débord sur l'assise
  const B = p.blanket;
  const B2 = p.blanket2;
  m.box(0, 9, 4, 5, 10, D - 1, B);
  m.box(0, 3, D - 1, 5, 10, D, B);
  for (let x = 0; x < 5; x++) m.box(x, 3, D - 1, x + 1, 3 + (x % 2 ? 2 : 0) + (x === 2 ? 1 : 0), D, -1);
  m.box(4, 7, 8, 7, 8, D - 1, B);
  m.box(4, 8, 9, 6, 9, D - 1, B);
  m.box(0, 4, 4, 1, 9, D - 1, B);
  for (let z = 5; z < D; z += 3) {
    m.box(0, 9, z, 5, 10, z + 1, B2);
    m.box(0, 4, z, 1, 9, z + 1, B2);
  }
  m.box(1, 3, D - 1, 4, 10, D, -1);
  m.box(0, 5, D - 1, 5, 10, D, B);
  m.box(2, 5, D - 1, 3, 10, D, B2);
  m.box(0, 4, D - 1, 1, 5, D, B);
  m.box(4, 4, D - 1, 5, 5, D, B);
  // canette écrasée coincée entre les coussins
  m.box(15, 7, 9, 16, 8, 11, 0xb8202a);
  m.set(15, 7, 11, K.chrome);
  return m;
}

interface ChairPal {
  fab: number;
  trim: number;
}

const ARM_PAL: ChairPal[] = [
  { fab: 0x7a3c1c, trim: K.brass }, // cuir cognac
  { fab: 0x80161e, trim: K.gold }, // Dadou
  { fab: 0x213a66, trim: K.silver }, // Even
];

/** Fauteuil à oreilles capitonné sur pieds métalliques fuselés. */
function makeArmchair(v: number): VoxelModel {
  const p = ARM_PAL[v];
  const m = VoxelModel.meters(0.9, 0.95, 0.9); // 14 × 15 × 14
  const W = m.sx;
  const D = m.sz;
  const F = p.fab;
  const Fl = shade(F, 1.12);
  const Fd = shade(F, 0.62);
  // pieds fuselés et ceinture métallique
  for (const x of [1, W - 2]) for (const z of [1, D - 2]) m.box(x, 0, z, x + 1, 3, z + 1, p.trim);
  m.box(1, 3, 1, W - 1, 4, D, p.trim);
  m.box(1, 4, 1, W - 1, 6, D, shade(F, 0.9));
  // dossier aux angles arrondis
  m.box(0, 4, 0, W, 15, 4, F);
  m.box(0, 14, 0, 1, 15, 4, -1);
  m.box(W - 1, 14, 0, W, 15, 4, -1);
  m.box(1, 14, 3, W - 1, 15, 4, -1);
  // accoudoirs roulés
  for (const [x0, x1, xo] of [
    [0, 3, 0],
    [W - 3, W, W - 1],
  ]) {
    m.box(x0, 4, 4, x1, 10, D, F);
    m.box(x0, 10, 4, x1, 11, D, Fl);
    m.box(xo, 10, 4, xo + 1, 11, D, -1);
    m.box(x0, 4, D - 1, x1, 10, D, Fd);
    m.box(x0, 4, D - 1, x1, 5, D, p.trim);
    m.set(x0 + 1, 8, D - 1, p.trim);
  }
  // oreilles : du haut du dossier jusqu'aux accoudoirs
  for (const [x0, x1] of [
    [0, 2],
    [W - 2, W],
  ]) {
    m.box(x0, 10, 4, x1, 14, 5, F);
    m.box(x0, 10, 5, x1, 13, 6, F);
    m.box(x0, 10, 6, x1, 12, 7, F);
  }
  // coussin d'assise
  cushion(m, 3, 6, 4, W - 3, 8, D, Fl);
  m.box(3, 6, D - 1, W - 3, 7, D, shade(F, 0.95));
  // capitonnage du dossier
  tuft(m, 'z', 3, 1, 2, W - 2, 8, 14, F, Fd);
  tuft(m, 'z', 0, -1, 0, W, 5, 14, F, Fd);
  return m;
}

/** Table basse : 0 noyer, laiton et verre fumé ; 1 marbre blanc et or ; 2 caisse de récupération. */
function makeCoffeeTable(v: number): VoxelModel {
  const m = new VoxelModel(19, 9, 11, 1 / 16); // 1,19 × 0,44 (+ objets) × 0,69
  const W = m.sx;
  const D = m.sz;
  if (v === 0) {
    // cadre laiton en luge, plateau de verre fumé, tablette de noyer
    m.box(1, 0, 1, 2, 7, D - 1, K.brass);
    m.box(W - 2, 0, 1, W - 1, 7, D - 1, K.brass);
    m.box(1, 0, 1, 2, 6, 2, K.brass);
    m.box(1, 2, 1, W - 1, 3, D - 1, K.walnut);
    m.box(1, 2, D - 2, W - 1, 3, D - 1, K.walnutLight);
    m.box(0, 6, 0, W, 7, D, SLOT.GLASS);
    m.box(0, 6, 0, W, 7, 1, K.brass);
    m.box(0, 6, D - 1, W, 7, D, K.brass);
    m.box(0, 6, 0, 1, 7, D, K.brass);
    m.box(W - 1, 6, 0, W, 7, D, K.brass);
    // livres d'art sur la tablette, magazine, verre de whisky, cendrier et cigare
    m.box(3, 3, 3, 8, 4, 8, 0x1d2a44);
    m.box(4, 4, 3, 8, 5, 7, 0xd8d0c0);
    m.box(12, 7, 2, 16, 8, 6, 0xe8e2d4);
    m.box(12, 7, 2, 16, 8, 3, 0xb02030);
    m.set(5, 7, 6, 0xc88a30);
    m.set(5, 8, 6, 0xd9e6ea);
    m.box(9, 7, 5, 11, 8, 7, 0x2a2a2e);
    m.set(10, 8, 6, 0x6a4024);
    m.set(11, 8, 6, 0x6a4024);
    m.set(12, 8, 6, 0xd8603a);
    return m;
  }
  if (v === 1) {
    // plateau de marbre blanc aux angles arrondis, cadre géométrique doré
    for (const x of [1, W - 2]) for (const z of [1, D - 2]) m.box(x, 0, z, x + 1, 6, z + 1, K.gold);
    m.box(1, 0, 1, W - 1, 1, 2, K.gold);
    m.box(1, 0, D - 2, W - 1, 1, D - 1, K.gold);
    m.box(1, 0, 1, 2, 1, D - 1, K.gold);
    m.box(W - 2, 0, 1, W - 1, 1, D - 1, K.gold);
    m.box(1, 5, 1, W - 1, 6, D - 1, K.gold);
    m.box(2, 5, 2, W - 2, 6, D - 2, -1);
    m.box(0, 6, 0, W, 7, D, K.marble);
    for (const [x, z] of [
      [0, 0],
      [W - 1, 0],
      [0, D - 1],
      [W - 1, D - 1],
    ])
      m.set(x, 6, z, -1);
    marbleVeins(m, 6, 0, 0, W, D, 2, 141, 0xcac6be, 0xc8a860);
    // coupe dorée et bougie
    m.box(8, 7, 4, 11, 8, 7, K.gold);
    m.set(9, 8, 5, 0xc0302a).set(10, 8, 5, 0xe0a030);
    m.set(4, 7, 5, 0xefe8d8).set(4, 8, 5, SLOT.GLOW);
    m.box(14, 7, 6, 17, 8, 9, 0x1a1a1c);
    return m;
  }
  // caisse en bois de récupération : planches, taches, canettes, cendrier débordant
  const P = 0x9a7a4e;
  m.box(1, 0, 1, W - 1, 6, D - 1, shade(P, 0.85));
  m.box(2, 1, 1, W - 2, 5, D - 1, -1);
  m.box(2, 1, 2, W - 2, 5, D - 2, 0x2a2018);
  for (let x = 1; x < W - 1; x += 4) m.box(x, 0, 1, x + 3, 6, 2, (x / 4) % 2 ? P : shade(P, 0.92));
  m.box(0, 5, 0, W, 6, D, P);
  for (let z = 0; z < D; z += 3) m.box(0, 5, z, W, 6, z + 1, shade(P, 0.8));
  stain(m, 6, 5.5, 4, 2.2, (c) => shade(c, 0.6), 21);
  stain(m, 14, 5.5, 7, 1.6, (c) => shade(c, 0.65), 22);
  m.box(3, 6, 6, 4, 8, 7, 0xb8202a);
  m.set(3, 8, 6, K.chrome);
  m.box(15, 6, 2, 16, 7, 4, 0x2a5a9a);
  m.box(8, 6, 3, 11, 7, 6, 0x8a8a88);
  m.set(9, 7, 4, 0xe0dcd0).set(10, 7, 4, 0x6a6a68).set(9, 7, 5, 0xd8d2c0);
  return m;
}

// =========================================================================== télévisions

/** Écran mural ultra-plat de 2085 : dalle animée bord à bord, liseré sombre, barre inférieure. */
function makeTvWall(): VoxelModel {
  const m = new VoxelModel(58, 32, 3, R32); // 1,81 × 1,0 × 0,09
  const W = m.sx;
  // dos et support mural
  m.box(3, 3, 0, W - 3, 29, 1, 0x1a1b1e);
  m.box(20, 8, 0, 38, 22, 1, 0x2a2c30);
  // dalle (6 cm) : liseré de 3 cm et image animée
  m.box(0, 1, 1, W, 32, 3, 0x0d0e10);
  m.box(1, 2, 2, W - 1, 31, 3, SLOT.SCREEN);
  // barre inférieure, voyant et logo
  m.box(2, 0, 1, W - 2, 1, 3, 0x2c2e33);
  m.box(27, 0, 2, 31, 1, 3, 0x6a7078);
  m.set(W - 4, 0, 2, SLOT.LED);
  return m;
}

/** Vieux téléviseur cathodique : caisson façon bois, écran bombé fêlé, boutons, antenne en oreilles de lapin tordue. */
function makeTvOld(): VoxelModel {
  const m = new VoxelModel(26, 27, 16, R32); // 0,81 × 0,5 (+ antenne) × 0,5
  const W = m.sx;
  const wood = 0x5a3a22;
  const woodL = 0x6e4a2c;
  // tube arrière (plastique) et caisson plaqué bois aux angles arrondis
  m.box(4, 2, 0, W - 4, 14, 3, 0x2a2826);
  m.box(6, 4, 0, W - 6, 12, 1, 0x1e1d1c);
  for (let i = 0; i < 4; i++) m.box(6 + i * 4, 6, 0, 8 + i * 4, 11, 1, 0x111111);
  m.box(0, 0, 3, W, 16, 15, wood);
  for (let y = 1; y < 16; y += 3) m.box(0, y, 3, W, y + 1, 15, woodL);
  for (const [x, y] of [
    [0, 0],
    [W - 1, 0],
    [0, 15],
    [W - 1, 15],
  ])
    m.box(x, y, 3, x + 1, y + 1, 15, -1);
  // façade sombre
  m.box(1, 1, 14, W - 1, 15, 15, 0x262524);
  // écran bombé aux coins arrondis
  m.box(2, 2, 14, 18, 14, 15, SLOT.SCREEN);
  m.box(3, 3, 15, 17, 13, 16, SLOT.SCREEN);
  for (const [x, y] of [
    [2, 2],
    [17, 2],
    [2, 13],
    [17, 13],
  ])
    m.set(x, y, 14, 0x262524);
  // fêlure ramifiée
  const crack = 0x2e2e30;
  for (const [x, y] of [
    [14, 12],
    [13, 11],
    [13, 10],
    [12, 9],
    [11, 9],
    [10, 8],
    [10, 7],
    [9, 6],
    [12, 8],
    [12, 7],
    [14, 9],
    [15, 9],
    [16, 8],
    [11, 10],
    [10, 11],
  ])
    m.set(x, y, 15, crack);
  // colonne de commande : grille du haut-parleur, deux molettes, voyant
  for (const y of [3, 5, 7]) m.box(19, y, 14, 25, y + 1, 15, 0x111111);
  m.box(20, 10, 15, 22, 12, 16, 0xb0b0a8);
  m.box(23, 10, 15, 25, 12, 16, 0x8a8a84);
  m.set(21, 11, 15, 0x5a5a56);
  m.set(24, 13, 14, SLOT.NEON_RED);
  // ruban adhésif sur l'angle supérieur gauche
  m.box(0, 13, 6, 6, 16, 9, K.tape);
  m.box(0, 13, 6, 1, 16, 9, K.tape);
  m.box(2, 15, 6, 4, 16, 9, shade(K.tape, 0.85));
  // poussière sur le dessus
  for (const [x, z] of [
    [8, 5],
    [15, 9],
    [20, 6],
    [11, 12],
  ])
    m.set(x, 15, z, 0x8a7a64);
  // antenne : socle, brins fins (l'un tordu), embouts
  m.box(10, 16, 6, 16, 18, 10, 0x1c1c1c);
  m.box(11, 18, 7, 15, 19, 9, 0x2a2a2a);
  line6(m, 12, 19, 8, 6, 23, 8, 0xa0a0a0);
  line6(m, 6, 23, 8, 2, 26, 8, 0xa0a0a0);
  line6(m, 14, 19, 8, 21, 26, 8, 0xa0a0a0);
  m.box(1, 26, 8, 3, 27, 9, 0xc0c0c0);
  m.box(21, 26, 8, 23, 27, 9, 0xc0c0c0);
  // télécommande posée sur le dessus
  m.box(17, 16, 9, 24, 17, 12, 0x1a1a1a);
  m.set(18, 16, 11, 0xa02020).set(20, 16, 11, 0x5a5a5a);
  return m;
}

/** Meuble télé : 0 noyer à niche lumineuse ; 1 aggloméré bon marché écorné. */
function makeTvStand(v: number): VoxelModel {
  const m = new VoxelModel(29, 10, 7, 1 / 16); // 1,81 × 0,5 (+ objets) × 0,44
  const W = m.sx;
  if (v === 0) {
    for (const x of [1, W - 2]) for (const z of [1, 5]) m.box(x, 0, z, x + 1, 1, z + 1, K.blackMetal);
    m.box(0, 1, 0, W, 8, 7, K.walnut);
    for (let x = 1; x < W; x += 2) m.box(x, 1, 6, x + 1, 7, 7, shade(K.walnut, 0.94));
    m.box(0, 7, 0, W, 8, 7, K.walnutLight);
    // niche centrale éclairée : console, barre de son
    m.box(10, 2, 1, 19, 7, 7, -1);
    m.box(10, 2, 0, 19, 7, 1, 0x141416);
    m.box(10, 6, 1, 19, 7, 2, SLOT.NEON_CYAN);
    m.box(11, 2, 2, 16, 3, 6, 0xe8e8ea);
    m.box(11, 2, 5, 16, 3, 6, 0x111111);
    m.set(15, 2, 6, SLOT.LED);
    m.box(17, 2, 3, 18, 5, 5, 0x1c1c20);
    // façades sans poignée (gorge sous le plateau), barre de son sur le dessus
    m.box(0, 6, 6, 10, 7, 7, K.walnutDark);
    m.box(19, 6, 6, W, 7, 7, K.walnutDark);
    m.box(6, 8, 2, 23, 9, 4, 0x1e1f22);
    m.box(7, 8, 3, 22, 9, 4, 0x2c2e32);
    m.set(3, 8, 3, 0x2a4a3a).set(3, 9, 3, K.plantLight).set(4, 9, 3, K.plant);
    return m;
  }
  const P = 0xcfcac0;
  m.box(0, 0, 0, W, 7, 7, P);
  m.box(1, 1, 1, W - 1, 3, 7, -1);
  m.box(1, 4, 1, W - 1, 6, 7, -1);
  m.box(14, 1, 1, 15, 6, 7, P);
  m.box(1, 1, 0, W - 1, 6, 1, 0x3a3836);
  // coin écorné (aggloméré visible), taches
  m.box(W - 2, 6, 5, W, 7, 7, -1);
  m.box(W - 2, 5, 5, W, 6, 7, 0xa88a5a);
  m.set(W - 3, 6, 6, 0xa88a5a);
  stain(m, 6, 6.5, 3, 1.6, (c) => shade(c, 0.8), 41);
  // cassettes vidéo, DVD, console et manette, câbles emmêlés
  for (let x = 2; x < 12; x += 1) m.box(x, 1, 2, x + 1, 3, 6, [0x1a1a1a, 0x2a2a6a, 0x1a1a1a, 0x7a1a1a, 0x1a1a1a][x % 5]);
  m.box(16, 1, 2, 22, 2, 6, 0x2a2a30);
  m.set(19, 1, 6, SLOT.NEON_BLUE);
  m.box(16, 4, 3, 26, 5, 6, 0x7a6a50);
  m.box(17, 4, 2, 21, 5, 4, 0x24242a);
  line6(m, 22, 1, 5, 26, 2, 3, 0x0e0e0e);
  line6(m, 26, 2, 3, 24, 1, 6, 0x0e0e0e);
  m.box(4, 7, 2, 7, 8, 4, 0x24242a);
  m.set(8, 7, 3, 0x9a2020);
  return m;
}

// =========================================================================== chambre

interface BedPal {
  frame: number;
  head: number;
  duvet: number;
  sheet: number;
  pillow: number;
  throwC: number;
  throw2: number;
}

const BED_PAL: BedPal[] = [
  { frame: K.oak, head: 0x6c6a66, duvet: 0x8c949c, sheet: 0xeceae4, pillow: 0xf2f0ea, throwC: 0xc89a3a, throw2: 0xa87a2a }, // gris et moutarde
  { frame: 0x1a1517, head: 0x7a141c, duvet: 0x86161e, sheet: 0xece6da, pillow: 0x1c1618, throwC: 0x161214, throw2: K.gold }, // Dadou
  { frame: K.walnut, head: 0x1d3461, duvet: 0x23396a, sheet: 0xf0f2f5, pillow: 0xf2f4f8, throwC: 0xb9c0ca, throw2: 0x8a929c }, // Even
];

/** Lit double : tête de lit capitonnée, couette, oreillers, plaid au pied. */
function makeBed(v: number): VoxelModel {
  const p = BED_PAL[v];
  const m = VoxelModel.meters(1.8, 0.9, 2.2); // 29 × 14 × 35
  const W = m.sx;
  const D = m.sz;
  for (const x of [0, W - 1]) for (const z of [2, D - 1]) m.box(x, 0, z, x + 1, 1, z + 1, shade(p.frame, 0.8));
  m.box(0, 1, 2, W, 4, D, p.frame);
  m.box(0, 3, 2, W, 4, D, shade(p.frame, 1.1));
  // tête de lit à côtes verticales
  m.box(0, 1, 0, W, 14, 2, p.head);
  for (let x = 2; x < W - 1; x += 3) m.box(x, 4, 1, x + 1, 13, 2, shade(p.head, 0.86));
  m.box(0, 13, 0, W, 14, 2, shade(p.head, 1.12));
  // matelas, oreillers
  m.box(1, 4, 2, W - 1, 7, D - 1, p.sheet);
  cushion(m, 2, 7, 3, 14, 9, 8, p.pillow, true);
  cushion(m, 15, 7, 3, 27, 9, 8, p.pillow, true);
  // couette retombant sur les côtés et au pied, revers du drap
  m.box(0, 7, 11, W, 8, D, p.duvet);
  m.box(0, 4, 11, 1, 8, D, shade(p.duvet, 0.88));
  m.box(W - 1, 4, 11, W, 8, D, shade(p.duvet, 0.88));
  m.box(0, 4, D - 1, W, 8, D, shade(p.duvet, 0.92));
  m.box(1, 7, 10, W - 1, 8, 13, p.sheet);
  m.box(1, 8, 11, W - 1, 9, 13, p.sheet);
  // légers plis (teinte seulement)
  paint(m, 6, 7, 16, 11, 8, 22, shade(p.duvet, 1.06));
  paint(m, 17, 7, 19, 24, 8, 23, shade(p.duvet, 1.06));
  // plaid au pied du lit
  m.box(0, 8, 26, W, 9, 31, p.throwC);
  m.box(0, 4, 26, 1, 9, 31, p.throwC);
  m.box(W - 1, 4, 26, W, 9, 31, p.throwC);
  m.box(0, 8, 27, W, 9, 28, p.throw2);
  m.box(0, 4, 27, 1, 9, 28, p.throw2);
  m.box(W - 1, 4, 27, W, 9, 28, p.throw2);
  return m;
}

interface KingPal {
  head: number;
  trim: number;
  duvet: number;
  edge: number;
  sheet: number;
  pillows: number[];
  fur: number;
  led: number;
}

const KING_PAL: KingPal[] = [
  { head: 0xd6cbb8, trim: K.gold, duvet: 0xf2f0ea, edge: 0xc8a860, sheet: 0xe8e2d4, pillows: [0xf4f2ec, 0xd8cdb8, 0xb08d3c], fur: 0xbab4a8, led: SLOT.LED }, // ivoire et or
  { head: 0x6e1018, trim: K.gold, duvet: 0x8a1820, edge: K.gold, sheet: 0x1c1618, pillows: [0x1c1618, 0x8e1b22, K.gold], fur: 0x231c1c, led: SLOT.NEON_RED }, // Dadou
  { head: 0x1a2f58, trim: K.silver, duvet: 0xe8ecf2, edge: 0x9aa6b6, sheet: 0x203a6a, pillows: [0xf2f4f8, 0x1d3461, K.silver], fur: 0x9aa0a8, led: SLOT.NEON_BLUE }, // Even
];

/** Lit king-size de luxe : tête de lit capitonnée monumentale à cadre métallique, base flottante lumineuse, soie et fourrure. */
function makeBedKing(v: number): VoxelModel {
  const p = KING_PAL[v];
  const m = VoxelModel.meters(2.2, 1.2, 2.4); // 35 × 19 × 38
  const W = m.sx;
  const D = m.sz;
  // base flottante et liseré lumineux
  m.box(2, 0, 4, W - 2, 1, D - 2, 0x0e0e10);
  m.box(2, 0, D - 3, W - 2, 1, D - 2, p.led);
  m.box(2, 0, 4, 3, 1, D - 2, p.led);
  m.box(W - 3, 0, 4, W - 2, 1, D - 2, p.led);
  m.box(0, 1, 3, W, 5, D, p.head);
  m.box(0, 1, 3, W, 2, D, p.trim);
  // tête de lit : panneau capitonné à côtes, cadre métallique, ailes
  m.box(0, 1, 0, W, 19, 3, shade(p.head, 0.9));
  m.box(1, 2, 2, W - 1, 18, 4, p.head);
  for (let x = 3; x < W - 2; x += 3) m.box(x, 5, 3, x + 1, 17, 4, shade(p.head, 0.72));
  for (let x = 2; x < W - 2; x += 3) m.box(x, 17, 3, x + 2, 18, 4, shade(p.head, 1.12));
  m.box(0, 18, 0, W, 19, 3, p.trim);
  m.box(0, 1, 2, 1, 19, 3, p.trim);
  m.box(W - 1, 1, 2, W, 19, 3, p.trim);
  m.box(0, 18, 2, W, 19, 4, p.trim);
  // matelas, drap
  m.box(1, 5, 4, W - 1, 8, D - 1, p.sheet);
  // oreillers : trois grands coussins dressés, deux oreillers, coussins décoratifs
  for (let i = 0; i < 3; i++) {
    const x0 = 2 + i * 10 + (i > 0 ? 1 : 0);
    m.box(x0, 8, 4, x0 + 10, 13, 6, p.pillows[0]);
    m.box(x0, 12, 5, x0 + 10, 13, 6, -1);
    m.set(x0, 12, 4, -1).set(x0 + 9, 12, 4, -1);
  }
  cushion(m, 3, 8, 6, 16, 10, 11, p.pillows[0]);
  cushion(m, 19, 8, 6, 32, 10, 11, p.pillows[0]);
  pillow(m, 9, 9, 7, p.pillows[1], 5, 4);
  pillow(m, 21, 9, 7, p.pillows[1], 5, 4);
  m.box(14, 9, 8, 21, 11, 10, p.pillows[2]);
  // couette de soie, revers, galon
  m.box(0, 8, 13, W, 9, D, p.duvet);
  m.box(0, 4, 13, 1, 9, D, shade(p.duvet, 0.9));
  m.box(W - 1, 4, 13, W, 9, D, shade(p.duvet, 0.9));
  m.box(0, 4, D - 1, W, 9, D, shade(p.duvet, 0.94));
  m.box(0, 4, D - 1, W, 5, D, p.edge);
  m.box(0, 4, 13, 1, 5, D, p.edge);
  m.box(W - 1, 4, 13, W, 5, D, p.edge);
  m.box(1, 8, 12, W - 1, 10, 15, p.sheet);
  m.box(1, 9, 14, W - 1, 10, 15, p.edge);
  paint(m, 8, 8, 19, 15, 9, 25, shade(p.duvet, 1.06));
  paint(m, 22, 8, 21, 28, 9, 26, shade(p.duvet, 0.94));
  // jeté de fourrure au pied du lit (bord irrégulier)
  for (let x = 0; x < W; x++) {
    const z0 = 29 + Math.floor(h3(x, 0, 0, 51) * 2);
    m.box(x, 9, z0, x + 1, 10, D - 1, p.fur);
    if (h3(x, 1, 0, 52) < 0.4) m.set(x, 10, z0 + 2, shade(p.fur, 1.12));
  }
  m.box(0, 5, 30, 1, 10, D - 2, p.fur);
  m.box(W - 1, 5, 30, W, 10, D - 2, p.fur);
  return m;
}

/** Vieux matelas posé au sol : taché, affaissé, coin éventré (ressorts), couverture froissée, oreiller jauni. */
function makeMattress(): VoxelModel {
  const m = VoxelModel.meters(1.0, 0.3, 2.0); // 16 × 5 × 32
  const W = m.sx;
  const D = m.sz;
  const T = 0xd3cbb4;
  m.box(0, 0, 0, W, 3, D, T);
  // coutil rayé (rayures dans la longueur)
  for (let x = 1; x < W; x += 3) m.box(x, 0, 0, x + 1, 3, D, 0xa9aaa2);
  // bordure piquée
  m.box(0, 2, 0, W, 3, 1, 0xbcb39a);
  m.box(0, 2, D - 1, W, 3, D, 0xbcb39a);
  // creux au milieu
  m.box(4, 2, 11, 12, 3, 21, -1);
  // taches jaunâtres et brunes
  const st = (c: number) => mix(c, 0x9a7a3a, 0.45);
  stain(m, 5, 2.5, 6, 2.6, st, 61);
  stain(m, 11, 2.5, 25, 3, st, 62);
  stain(m, 8, 1.5, 15, 2.4, (c) => mix(c, 0x6a5030, 0.5), 63);
  stain(m, 15, 1.5, 9, 2, st, 64);
  // coin éventré : ressorts et mousse
  m.box(12, 1, D - 4, W, 3, D, -1);
  m.box(12, 0, D - 4, W, 1, D, 0x9a9488);
  m.set(13, 1, D - 3, 0x8a8a8a).set(15, 1, D - 2, 0x8a8a8a).set(14, 2, D - 2, 0x7a7a7a).set(13, 1, D - 1, K.foam);
  // oreiller sans taie, jauni
  m.box(2, 3, 1, 13, 4, 6, 0xd8cfae);
  m.box(3, 4, 2, 11, 5, 5, 0xd8cfae);
  stain(m, 6, 4, 3, 1.6, (c) => mix(c, 0x9a8040, 0.4), 65);
  // couverture froissée (bosses, bord replié)
  const B = 0x5d6242;
  for (let z = 14; z < D - 3; z++)
    for (let x = 0; x < W; x++) {
      if (x + (z % 5) < 2) continue;
      const bump = h3(x >> 1, 0, z >> 1, 66) < 0.3 ? 1 : 0;
      m.box(x, 3, z, x + 1, 4 + bump, z + 1, (z + x) % 9 === 0 ? 0x4a4e34 : B);
    }
  m.box(0, 1, 15, 1, 4, 27, B);
  m.box(3, 4, 14, W, 5, 15, shade(B, 1.12));
  // bouteille vide et chaussette
  m.box(W - 2, 3, 6, W - 1, 4, 10, 0x2a5a2a);
  m.set(W - 2, 3, 10, 0x8ab08a);
  m.box(1, 3, 9, 3, 4, 10, 0xe8e4dc);
  return m;
}

/** Table de chevet : 0 laque noire et or avec lampe ; 1 noyer avec réveil et livre. */
function makeNightstand(v: number): VoxelModel {
  const m = new VoxelModel(8, 13, 7, 1 / 16); // 0,5 × 0,56 (+ lampe) × 0,44
  const W = m.sx;
  const body = v === 0 ? 0x17171a : K.walnut;
  const face = v === 0 ? 0x232327 : K.walnutLight;
  const trim = v === 0 ? K.gold : K.brass;
  for (const x of [0, W - 1]) for (const z of [0, 6]) m.box(x, 0, z, x + 1, 1, z + 1, trim);
  m.box(0, 1, 0, W, 8, 7, body);
  m.box(1, 2, 6, W - 1, 4, 7, face);
  m.box(1, 5, 6, W - 1, 7, 7, face);
  m.box(3, 3, 6, 5, 4, 7, trim);
  m.box(3, 6, 6, 5, 7, 7, trim);
  m.box(0, 8, 0, W, 9, 7, v === 0 ? K.marble : K.walnutLight);
  if (v === 0) {
    m.box(0, 8, 6, W, 9, 7, K.gold);
    // lampe de chevet : pied doré, abat-jour lumineux
    m.box(2, 9, 2, 4, 10, 4, K.gold);
    m.box(2, 10, 2, 3, 11, 3, K.gold);
    m.box(1, 11, 1, 4, 13, 4, 0xece2c8);
    m.box(2, 11, 2, 3, 12, 3, SLOT.GLOW);
    m.box(1, 11, 1, 4, 12, 4, 0xece2c8);
    m.set(2, 11, 3, SLOT.GLOW).set(3, 11, 3, SLOT.GLOW);
    m.box(5, 9, 3, 7, 10, 5, 0x1c2a4a);
  } else {
    m.box(1, 9, 3, 4, 10, 5, 0x1a1a1c);
    m.box(1, 9, 4, 4, 10, 5, SLOT.NEON_RED);
    m.box(4, 9, 1, 7, 10, 5, 0x6a1a1a);
    m.box(4, 9, 1, 7, 10, 2, 0xe8e2d4);
  }
  return m;
}

/** Armoire en noyer : trois portes (miroir central), poignées de laiton, corniche. */
function makeWardrobe(): VoxelModel {
  const m = VoxelModel.meters(1.6, 2.3, 0.6); // 26 × 37 × 10
  const W = m.sx;
  m.box(1, 0, 1, W - 1, 1, 8, 0x1a1210);
  m.box(0, 1, 0, W, 35, 9, K.walnut);
  // veinage vertical
  for (let x = 0; x < W; x += 2) m.box(x, 1, 8, x + 1, 35, 9, shade(K.walnut, 0.93));
  // corniche
  m.box(0, 35, 0, W, 37, 10, K.walnutDark);
  m.box(0, 35, 9, W, 36, 10, K.walnutLight);
  m.box(0, 1, 9, W, 2, 10, K.walnutDark);
  // trois portes : joints, panneaux moulurés, miroir central
  for (const x of [8, 17]) m.box(x, 2, 8, x + 1, 35, 9, 0x1e130c);
  m.box(0, 34, 8, W, 35, 9, 0x1e130c);
  for (const [x0, x1] of [
    [1, 8],
    [18, 25],
  ]) {
    m.box(x0, 4, 8, x1, 5, 9, K.walnutLight);
    m.box(x0, 32, 8, x1, 33, 9, K.walnutLight);
    m.box(x0, 4, 8, x0 + 1, 33, 9, K.walnutLight);
    m.box(x1 - 1, 4, 8, x1, 33, 9, K.walnutLight);
    m.box(x0, 18, 8, x1, 19, 9, K.walnutLight);
  }
  m.box(10, 4, 8, 16, 33, 9, 0xaebcc4);
  m.box(9, 3, 8, 17, 4, 9, K.brass);
  m.box(9, 33, 8, 17, 34, 9, K.brass);
  for (let i = 0; i < 6; i++) m.set(11 + i, 26 - i * 2, 8, 0xdde8ee).set(11 + i, 27 - i * 2, 8, 0xdde8ee);
  m.box(10, 6, 8, 11, 12, 9, 0xc8d4da);
  // poignées verticales
  m.box(7, 14, 9, 8, 24, 10, K.brass);
  m.box(18, 14, 9, 19, 24, 10, K.brass);
  return m;
}

// =========================================================================== tables et chaises

/** Table de salle à manger : 0 chêne familial ; 1 marbre et piètement doré, candélabre ; 2 nappe blanche de restaurant dressée. */
function makeDiningTable(v: number): VoxelModel {
  const m = new VoxelModel(38, 15, 16, 1 / 16); // 2,38 × 0,75 (+ objets) × 1,0
  const W = m.sx;
  const D = m.sz;
  if (v === 0) {
    const O = K.oak;
    for (const x of [1, W - 3]) for (const z of [1, D - 3]) m.box(x, 0, z, x + 2, 11, z + 2, K.oakDark);
    m.box(1, 9, 1, W - 1, 11, D - 1, shade(O, 0.85));
    m.box(2, 9, 2, W - 2, 11, D - 2, -1);
    m.box(0, 11, 0, W, 12, D, O);
    for (let z = 3; z < D; z += 4) m.box(0, 11, z, W, 12, z + 1, shade(O, 0.88));
    // coupe de fruits, carafe, sets de table
    ellXZ(m, W / 2, D / 2, 2.5, 2.5, 12, 13, 0xe8e4da);
    m.set(18, 13, 7, 0xd97a1a).set(19, 13, 8, 0xa8261e).set(20, 13, 7, 0xd97a1a).set(19, 13, 7, 0xc8b84a);
    m.box(26, 12, 7, 28, 15, 9, 0xd0e4ea);
    m.box(26, 12, 7, 28, 13, 9, 0xd88a20);
    for (const x of [6, 30]) m.box(x - 2, 12, 2, x + 3, 13, 5, 0x5a6a4a);
    return m;
  }
  if (v === 1) {
    // deux piétements trapézoïdaux dorés sur socles de marbre noir
    for (const xc of [8, W - 8]) {
      m.box(xc - 3, 0, 4, xc + 3, 1, D - 4, K.marbleBlack);
      for (let y = 1; y < 11; y++) {
        // colonne en sablier : large au pied et sous le plateau, fine au milieu
        const hw = [3, 2, 1.5, 1, 1, 1, 1, 1.5, 2, 3][y - 1];
        const hd = [5, 4, 3, 2, 1, 1, 2, 3, 4, 5][y - 1];
        m.box(Math.round(xc - hw), y, Math.round(D / 2 - hd), Math.round(xc + hw), y + 1, Math.round(D / 2 + hd), y === 5 || y === 6 ? K.goldLight : K.gold);
      }
    }
    // plateau de marbre blanc veiné, chant doré
    m.box(0, 11, 0, W, 12, D, K.marble);
    m.box(0, 10, 0, W, 11, D, K.gold);
    m.box(1, 10, 1, W - 1, 11, D - 1, -1);
    marbleVeins(m, 11, 0, 0, W, D, 3, 71, 0xcfcbc3, 0xc8a860);
    // candélabre doré à trois bougies et coupe de roses rouges
    m.box(18, 12, 7, 21, 13, 10, K.gold);
    m.box(19, 13, 8, 20, 15, 9, K.gold);
    m.box(16, 14, 8, 23, 15, 9, K.gold);
    for (const x of [16, 19, 22]) m.set(x, 15, 8, SLOT.GLOW);
    ellXZ(m, 9, 8, 2, 2, 12, 13, K.gold);
    for (const [x, z] of [
      [8, 7],
      [10, 8],
      [9, 9],
      [8, 9],
    ])
      m.set(x, 13, z, 0xa01a24);
    m.set(9, 13, 8, 0x2a5a2a);
    return m;
  }
  // nappe blanche tombante, couverts dressés, bougie et rose
  const N = 0xf2f0ea;
  for (const x of [2, W - 4]) for (const z of [2, D - 4]) m.box(x, 0, z, x + 2, 11, z + 2, K.walnutDark);
  m.box(0, 11, 0, W, 12, D, N);
  for (let x = 0; x < W; x++) {
    const d = 7 + ((x >> 1) % 2);
    m.box(x, d, 0, x + 1, 11, 1, (x >> 1) % 2 ? N : shade(N, 0.92));
    m.box(x, d, D - 1, x + 1, 11, D, (x >> 1) % 2 ? N : shade(N, 0.92));
  }
  for (let z = 0; z < D; z++) {
    const d = 7 + ((z >> 1) % 2);
    m.box(0, d, z, 1, 11, z + 1, (z >> 1) % 2 ? N : shade(N, 0.92));
    m.box(W - 1, d, z, W, 11, z + 1, (z >> 1) % 2 ? N : shade(N, 0.92));
  }
  const place = (x: number, z: number, dz: number) => {
    m.box(x - 1, 12, z - 1, x + 1, 13, z + 1, 0xfcfcfa);
    m.set(x - 1, 12, z - 1, 0xc8a050);
    m.set(x - 2, 12, z, K.silver).set(x + 1, 12, z, K.silver);
    const gz = z + dz;
    m.set(x + 1, 12, gz, 0xd8e8ee).set(x + 1, 13, gz, 0x6a1020);
  };
  for (const x of [10, 19, 28]) {
    place(x, 2, 1);
    place(x, D - 2, -1);
  }
  place(2, D / 2, 1);
  place(W - 2, D / 2, -1);
  m.box(18, 12, 7, 20, 13, 9, K.silver);
  m.set(18, 13, 7, 0xf2ecd8).set(18, 14, 7, SLOT.GLOW);
  m.set(20, 12, 8, 0x2a5a2a).set(20, 13, 8, 0x2a5a2a).set(20, 14, 8, 0xb01a28);
  return m;
}

/** Petite table ronde/carrée : 0 bistrot de bar ; 1 club de jazz (nappe longue, lampe) ; 2 diner (formica, chrome). */
function makeTableSmall(v: number): VoxelModel {
  const m = new VoxelModel(14, 16, 14, 1 / 16); // 0,875 × 0,75 (+ objets) × 0,875
  const c = 7;
  if (v === 0) {
    // pied central en fonte, croisillon, plateau rond de bois sombre cerclé de laiton
    m.box(2, 0, 6, 12, 1, 8, K.iron);
    m.box(6, 0, 2, 8, 1, 12, K.iron);
    m.box(6, 1, 6, 8, 11, 8, K.iron);
    m.box(5, 9, 5, 9, 11, 9, K.iron);
    m.cylY(c, c, 7, 11, 12, K.brass);
    m.cylY(c, c, 6.2, 11, 12, 0x3a2418);
    // chope de bière et sous-bock, cendrier
    m.box(4, 12, 4, 6, 13, 6, 0xc8b89a);
    m.box(4, 12, 4, 5, 15, 5, 0xc8861a);
    m.set(4, 15, 4, 0xf4f0e0);
    m.box(8, 12, 8, 10, 13, 10, 0x7a7a78);
    m.set(9, 12, 9, 0x3a3a38);
    return m;
  }
  if (v === 1) {
    // nappe longue jusqu'au sol, plis, lampe de table à abat-jour
    for (let y = 0; y < 12; y++) {
      const r = y < 2 ? 7 : 6.6;
      m.cylY(c, c, r, y, y + 1, 0xf0ece4);
    }
    m.forEach((x, y, z, col) => {
      if (y > 10 || col !== 0xf0ece4) return;
      const a = Math.atan2(z + 0.5 - c, x + 0.5 - c);
      return Math.floor((a + Math.PI) / (Math.PI / 6)) % 2 ? shade(col, 0.95) : undefined;
    });
    m.cylY(c, c, 7, 11, 12, 0xf6f3ec);
    m.cylY(c, c, 6.4, 1, 11, -1);
    m.box(6, 12, 6, 8, 13, 8, K.brass);
    m.box(6, 13, 6, 7, 14, 7, K.brass);
    m.box(5, 14, 5, 9, 16, 9, 0x9a2a1e);
    m.box(6, 14, 6, 8, 15, 8, SLOT.GLOW);
    m.box(5, 15, 5, 9, 16, 9, 0x9a2a1e);
    m.set(6, 14, 8, SLOT.GLOW).set(7, 14, 8, SLOT.GLOW);
    m.box(10, 12, 9, 11, 14, 10, 0xe0eaee);
    m.set(10, 14, 9, 0xc8a040);
    return m;
  }
  // diner : plateau de formica menthe cerclé de chrome, pied chromé, distributeur, ketchup, moutarde
  m.cylY(c, c, 4, 0, 1, K.chrome);
  m.box(6, 1, 6, 8, 11, 8, K.chrome);
  m.box(1, 11, 1, 13, 12, 13, 0x8fcfbf);
  m.box(1, 11, 1, 13, 12, 2, K.chrome);
  m.box(1, 11, 12, 13, 12, 13, K.chrome);
  m.box(1, 11, 1, 2, 12, 13, K.chrome);
  m.box(12, 11, 1, 13, 12, 13, K.chrome);
  m.box(6, 12, 6, 8, 14, 7, K.chromeLight);
  m.box(6, 12, 7, 8, 13, 8, 0xf4f4f0);
  m.box(4, 12, 6, 5, 15, 7, 0xc01818);
  m.set(4, 15, 6, 0xe8e8e8);
  m.box(9, 12, 6, 10, 15, 7, 0xe0b818);
  m.set(9, 15, 6, 0xe8e8e8);
  m.set(5, 12, 9, 0xf4f4f4).set(8, 12, 9, 0x2a2a2a);
  return m;
}

/** Table pliante bon marché : plateau de plastique taché, pieds en tube, canettes et cendrier. */
function makeFoldingTable(): VoxelModel {
  const m = new VoxelModel(19, 14, 11, 1 / 16); // 1,19 × 0,75 (+ objets) × 0,69
  const W = m.sx;
  const D = m.sz;
  const T = 0xd6d0bc;
  const S = 0x8a8e94;
  for (const x of [2, W - 3]) {
    m.box(x, 0, 1, x + 1, 11, 2, S);
    m.box(x, 0, D - 2, x + 1, 11, D - 1, S);
    m.box(x, 1, 1, x + 1, 2, D - 1, S);
    line6(m, x, 2, 2, x, 9, D - 3, shade(S, 0.85));
  }
  m.box(1, 10, 1, W - 1, 11, D - 1, shade(S, 0.8));
  m.box(0, 11, 0, W, 12, D, T);
  m.box(0, 10, 0, W, 11, 1, shade(T, 0.85));
  m.box(0, 10, D - 1, W, 11, D, shade(T, 0.85));
  // éraflures, rond de café, brûlure
  stain(m, 5, 11.5, 4, 2, (c) => shade(c, 0.86), 81);
  stain(m, 14, 11.5, 7, 1.5, (c) => mix(c, 0x6a4a2a, 0.35), 82);
  m.set(10, 11, 2, 0x2a2018);
  // canettes (une écrasée), cendrier débordant, jeu de cartes
  m.box(3, 12, 6, 4, 14, 7, 0xb8202a);
  m.set(3, 14, 6, K.chrome);
  m.box(5, 12, 7, 7, 13, 8, 0x2a5a9a);
  m.box(12, 12, 2, 15, 13, 5, 0x8a8a88);
  m.set(13, 13, 3, 0xd8d2c0).set(14, 13, 3, 0x5a5a58).set(13, 12, 3, 0x3a3a38);
  m.box(8, 12, 6, 10, 13, 9, 0xf0f0f0);
  m.set(9, 12, 7, 0xb01a1a);
  return m;
}

/** Chaises : 0 contemporaine ; 1 bistrot courbé (jazz) ; 2 diner chrome et skaï ; 3 salon de thé ; 4 laque rouge (mah-jong) ; 5 restaurant capitonnée. */
function makeChair(v: number): VoxelModel {
  const m = VoxelModel.meters(0.5, 0.9, 0.5); // 8 × 14 × 8
  if (v === 0) {
    const L = K.blackMetal;
    for (const x of [0, 7]) for (const z of [0, 7]) m.box(x, 0, z, x + 1, 6, z + 1, L);
    m.box(0, 6, 0, 8, 7, 8, K.walnut);
    m.box(0, 7, 1, 8, 8, 8, 0x5c5a58);
    m.box(0, 7, 7, 8, 8, 8, -1);
    m.box(0, 7, 0, 1, 14, 1, L);
    m.box(7, 7, 0, 8, 14, 1, L);
    m.box(0, 10, 0, 8, 14, 1, K.walnut);
    m.box(1, 11, 0, 7, 13, 1, K.walnutLight);
    return m;
  }
  if (v === 1) {
    const B = 0x3a2416;
    for (const [x, z] of [
      [1, 1],
      [6, 1],
      [1, 6],
      [6, 6],
    ])
      m.box(x, 0, z, x + 1, 6, z + 1, B);
    m.cylY(4, 4, 3.4, 3, 4, B);
    m.cylY(4, 4, 2.4, 3, 4, -1);
    m.cylY(4, 4, 4, 6, 7, B);
    m.cylY(4, 4, 3, 6, 7, 0xc8a46a);
    for (const [x, z] of [
      [3, 3],
      [4, 4],
      [3, 5],
      [5, 3],
    ])
      m.set(x, 6, z, 0xa8844a);
    // dossier en boucle de bois courbé
    m.box(1, 7, 0, 2, 13, 1, B);
    m.box(6, 7, 0, 7, 13, 1, B);
    m.box(2, 13, 0, 6, 14, 1, B);
    m.box(3, 8, 0, 4, 12, 1, B);
    m.box(4, 8, 0, 5, 12, 1, B);
    m.box(3, 12, 0, 5, 13, 1, -1);
    m.box(2, 11, 0, 3, 12, 1, B);
    m.box(5, 11, 0, 6, 12, 1, B);
    return m;
  }
  if (v === 2) {
    const Cr = K.chrome;
    const R = 0xb8202a;
    for (const x of [0, 7]) {
      m.box(x, 0, 0, x + 1, 6, 1, Cr);
      m.box(x, 0, 7, x + 1, 6, 8, Cr);
      m.box(x, 0, 0, x + 1, 1, 8, Cr);
      m.box(x, 6, 0, x + 1, 14, 1, Cr);
    }
    m.box(0, 6, 0, 8, 7, 8, Cr);
    cushion(m, 0, 7, 1, 8, 9, 8, R);
    m.box(0, 7, 7, 8, 8, 8, 0xf0ece4);
    m.box(0, 9, 1, 8, 14, 2, R);
    m.box(0, 13, 1, 8, 14, 2, shade(R, 1.12));
    m.box(1, 10, 2, 7, 13, 3, R);
    m.box(0, 13, 0, 8, 14, 1, Cr);
    return m;
  }
  if (v === 3) {
    // chaise « à joug » en bois de rose : dossier à palette, traverse supérieure relevée
    const Rw = 0x4a2216;
    const Rl = 0x6a3420;
    for (const x of [0, 7]) for (const z of [0, 7]) m.box(x, 0, z, x + 1, 6, z + 1, Rw);
    m.box(0, 1, 0, 8, 2, 1, Rw);
    m.box(0, 1, 7, 8, 2, 8, Rw);
    m.box(0, 6, 0, 8, 7, 8, Rw);
    m.box(1, 6, 1, 7, 7, 7, Rl);
    m.box(0, 7, 0, 1, 13, 1, Rw);
    m.box(7, 7, 0, 8, 13, 1, Rw);
    m.box(3, 7, 0, 5, 13, 1, Rl);
    m.box(3, 10, 0, 5, 11, 1, 0xc8a050);
    m.box(0, 13, 0, 8, 14, 1, Rw);
    m.set(0, 13, 0, -1).set(7, 13, 0, -1);
    m.box(0, 12, 0, 1, 13, 1, Rw);
    return m;
  }
  if (v === 4) {
    // laque rouge et or, galette noire, médaillon doré
    const Rd = 0x9a1a18;
    for (const x of [0, 7]) for (const z of [0, 7]) m.box(x, 0, z, x + 1, 6, z + 1, Rd);
    m.box(0, 0, 0, 1, 1, 8, K.gold);
    m.box(7, 0, 0, 8, 1, 8, K.gold);
    m.box(0, 6, 0, 8, 7, 8, Rd);
    m.box(0, 6, 7, 8, 7, 8, K.gold);
    m.box(1, 7, 1, 7, 8, 7, 0x1a1414);
    m.box(0, 7, 0, 8, 12, 1, Rd);
    m.box(1, 12, 0, 7, 13, 1, Rd);
    m.box(0, 11, 0, 8, 12, 1, K.gold);
    m.box(3, 8, 0, 5, 10, 1, K.gold);
    m.box(3, 8, 0, 4, 9, 1, K.goldLight);
    return m;
  }
  // restaurant : siège et dossier rembourrés crème, cadre de noyer, clous dorés
  const Wn = K.walnut;
  const Cm = 0xe0d4bc;
  for (const x of [0, 7]) {
    m.box(x, 0, 0, x + 1, 6, 1, Wn);
    m.box(x, 0, 7, x + 1, 6, 8, Wn);
  }
  m.box(0, 5, 0, 8, 7, 8, Wn);
  cushion(m, 0, 7, 0, 8, 8, 8, Cm);
  m.box(0, 7, 7, 8, 8, 8, shade(Cm, 0.9));
  m.box(0, 7, 0, 8, 14, 2, Wn);
  m.box(1, 8, 1, 7, 13, 3, Cm);
  m.box(1, 13, 1, 7, 14, 2, shade(Cm, 1.05));
  for (const x of [1, 3, 5]) m.set(x, 8, 2, K.brass);
  return m;
}

/** Chaise de jardin monobloc en plastique, éraflée : 0 blanche jaunie ; 1 vert sapin. */
function makeChairPlastic(v: number): VoxelModel {
  const m = VoxelModel.meters(0.5, 0.82, 0.5); // 8 × 13 × 8
  const P = v === 0 ? 0xe2dfd4 : 0x2c5a3c;
  const Pd = shade(P, 0.86);
  // pieds évasés (plats)
  for (const [x, z, dx, dz] of [
    [0, 0, 1, 1],
    [7, 0, -1, 1],
    [0, 7, 1, -1],
    [7, 7, -1, -1],
  ]) {
    m.box(x, 0, z, x + 1, 3, z + 1, Pd);
    m.box(x + (dx > 0 ? 0 : 0), 3, z, x + 1, 6, z + 1, P);
    m.box(Math.min(x, x + dx), 4, Math.min(z, z + dz), Math.max(x, x + dx) + 1, 6, Math.min(z, z + dz) + 1, P);
  }
  // assise creusée
  m.box(0, 6, 0, 8, 7, 8, P);
  m.box(1, 6, 1, 7, 7, 7, Pd);
  m.box(0, 7, 7, 8, 8, 8, -1);
  // accoudoirs
  for (const x of [0, 7]) {
    m.box(x, 7, 2, x + 1, 9, 3, P);
    m.box(x, 7, 6, x + 1, 9, 7, P);
    m.box(x, 9, 1, x + 1, 10, 7, P);
  }
  // dossier à fentes horizontales
  m.box(0, 7, 0, 8, 13, 1, P);
  m.box(1, 12, 0, 7, 13, 1, shade(P, 1.05));
  for (const y of [8, 10]) m.box(2, y, 0, 6, y + 1, 1, -1);
  m.set(0, 12, 0, -1).set(7, 12, 0, -1);
  // salissures
  if (v === 0) {
    stain(m, 3, 6.5, 4, 2, (c) => mix(c, 0x8a8270, 0.3), 91);
    stain(m, 0.5, 1, 0.5, 1.5, (c) => mix(c, 0x6a6458, 0.4), 92);
    stain(m, 6, 11, 0.5, 1.4, (c) => mix(c, 0x9a9070, 0.3), 93);
  } else stain(m, 4, 6.5, 3, 2, (c) => mix(c, 0xb0b8a0, 0.3), 94);
  return m;
}

// =========================================================================== cuisine

interface KitchenPal {
  body: number;
  top: number;
  handle: number;
}

const KITCHEN_PAL: KitchenPal[] = [
  { body: 0xe6e6e2, top: 0x86898c, handle: K.chrome }, // laque blanche, quartz gris
  { body: K.walnut, top: 0x1e1e20, handle: K.brass }, // noyer, granit noir
  { body: 0x93c2ae, top: 0xeceae4, handle: K.chrome }, // vert menthe rétro
];

/** Plan de travail : tiroirs, évier, four encastré, plaque vitrocéramique, ustensiles. */
function makeKitchenCounter(v: number): VoxelModel {
  const p = KITCHEN_PAL[v];
  const m = new VoxelModel(38, 19, 10, 1 / 16); // 2,38 × 0,94 (+ robinet) × 0,63
  const W = m.sx;
  const B = p.body;
  const gap = shade(B, 0.62);
  m.box(0, 0, 0, W, 1, 8, 0x1a1a1c);
  m.box(0, 1, 0, W, 14, 9, B);
  // joints verticaux entre caissons et façades
  for (const x of [9, 19, 28]) m.box(x, 1, 8, x + 1, 14, 9, gap);
  // tiroirs (0..9)
  for (const y of [5, 9]) m.box(0, y, 8, 9, y + 1, 9, gap);
  for (const y of [3, 7, 11]) m.box(3, y, 8, 6, y + 1, 9, p.handle);
  // portes sous évier (9..19)
  m.box(14, 1, 8, 15, 14, 9, gap);
  m.box(12, 11, 8, 13, 13, 9, p.handle);
  m.box(16, 11, 8, 17, 13, 9, p.handle);
  // four encastré (19..28) : porte vitrée, poignée, afficheur
  m.box(20, 2, 8, 28, 11, 9, 0x2a2a2e);
  m.box(21, 3, 8, 27, 8, 9, SLOT.GLASS);
  m.box(21, 9, 8, 27, 10, 9, K.chromeLight);
  m.box(20, 11, 8, 28, 13, 9, 0x18181a);
  m.box(22, 12, 8, 24, 13, 9, SLOT.NEON_CYAN);
  m.set(26, 12, 8, K.chrome);
  // porte + tiroir (28..38)
  m.box(29, 10, 8, W, 11, 9, gap);
  m.box(31, 12, 8, 36, 13, 9, p.handle);
  m.box(30, 7, 8, 31, 9, 9, p.handle);
  // plan de travail
  m.box(0, 14, 0, W, 15, 10, p.top);
  if (v === 0) marbleVeins(m, 14, 0, 0, W, 10, 3, 101, 0x9a9da0, 0x7a7d80);
  // évier creusé, robinet col de cygne
  m.box(10, 14, 2, 18, 15, 8, K.steel);
  m.box(11, 14, 3, 17, 15, 7, K.steelDark);
  m.set(14, 14, 5, 0x2a2a2a);
  m.box(14, 15, 1, 15, 18, 2, K.chrome);
  m.box(14, 17, 2, 15, 18, 4, K.chrome);
  m.set(14, 16, 4, K.chrome);
  m.set(16, 15, 1, K.chrome);
  // plaque vitrocéramique : quatre foyers, voyant
  m.box(20, 14, 2, 28, 15, 8, SLOT.GLASS);
  for (const [x, z] of [
    [21, 3],
    [25, 3],
    [21, 6],
    [25, 6],
  ])
    m.box(x, 14, z, x + 2, 15, z + 1, 0x3a3a3e);
  m.set(27, 14, 7, SLOT.NEON_RED);
  // planche à découper, tomates, couteau ; bouilloire ; pot à ustensiles
  m.box(2, 15, 2, 7, 16, 6, K.oak);
  m.set(3, 16, 3, 0xc0281e).set(4, 16, 4, 0xc0281e).set(5, 16, 3, 0x5a8a3a);
  m.box(3, 15, 6, 7, 16, 7, K.chrome);
  m.box(31, 15, 2, 34, 18, 5, v === 1 ? 0x1a1a1c : K.chrome);
  m.box(31, 18, 3, 33, 19, 4, 0x1a1a1c);
  m.set(34, 16, 3, 0x1a1a1c);
  m.box(35, 15, 2, 37, 17, 4, 0xe8e2d4);
  m.set(35, 17, 2, K.walnut).set(36, 18, 3, K.steel).set(36, 17, 2, K.walnutDark);
  return m;
}

/** Îlot de cuisine de luxe : marbre en cascade, caissons noirs, poignées dorées, LED sous le débord, coupe de fruits. */
function makeKitchenIsland(): VoxelModel {
  const m = new VoxelModel(35, 19, 16, 1 / 16); // 2,19 × 0,94 (+ objets) × 1,0
  const W = m.sx;
  const D = m.sz;
  const Bk = 0x1c1c1f;
  // caissons (côté travail en −Z), plinthe
  m.box(2, 0, 1, W - 2, 1, 10, 0x0c0c0e);
  m.box(1, 1, 0, W - 1, 14, 11, Bk);
  for (const x of [9, 17, 25]) m.box(x, 1, 0, x + 1, 14, 1, 0x0a0a0c);
  for (const x of [8, 16, 24, 32]) m.box(x - 3, 11, 0, x - 1, 12, 1, K.gold);
  m.box(2, 6, 0, 8, 7, 1, 0x0a0a0c);
  // façade sous débord : cannelures et bandeau LED
  for (let x = 2; x < W - 2; x += 2) m.box(x, 1, 10, x + 1, 13, 11, 0x26262a);
  m.box(1, 13, 10, W - 1, 14, 11, SLOT.LED);
  // plateau et joues en cascade de marbre blanc
  m.box(0, 14, 0, W, 15, D, K.marble);
  m.box(0, 0, 0, 1, 15, D, K.marble);
  m.box(W - 1, 0, 0, W, 15, D, K.marble);
  marbleVeins(m, 14, 0, 0, W, D, 4, 111, 0xcfcbc3, 0xc8a860);
  for (const x of [0, W - 1])
    for (let k = 0; k < 3; k++) {
      let z = 2 + k * 5;
      for (let y = 14; y >= 0; y--) {
        if (m.get(x, y, z) >= 0) m.set(x, y, z, k === 1 ? 0xc8a860 : K.marbleVein);
        z += h3(x, y, k, 112) < 0.4 ? 1 : 0;
        if (z >= D) break;
      }
    }
  // coupe dorée (oranges, pommes vertes), vase de fleurs blanches, champagne et coupes
  ellXZ(m, 10, 6, 3, 3, 15, 16, K.gold);
  for (const [x, z, c] of [
    [9, 5, 0xe07a1a],
    [11, 6, 0x8ab83a],
    [10, 7, 0xe07a1a],
    [9, 7, 0x8ab83a],
    [11, 5, 0xe07a1a],
  ] as const)
    m.set(x, 16, z, c);
  m.set(10, 17, 6, 0xe07a1a);
  m.box(20, 15, 5, 21, 18, 6, 0xd8e6ea);
  for (const [x, y, z, c] of [
    [20, 18, 5, 0x5a8a3a],
    [19, 19, 5, 0xf4f2ee],
    [21, 19, 5, 0xf4f2ee],
    [20, 19, 4, 0xf0d8e0],
    [20, 19, 6, 0xf4f2ee],
    [20, 18, 4, 0x4a7a32],
  ] as const)
    m.set(x, y, z, c);
  m.box(27, 15, 9, 28, 18, 10, 0x1e3a24);
  m.set(27, 18, 9, K.gold);
  for (const x of [29, 31]) m.set(x, 15, 10, 0xe0eef2).set(x, 16, 10, 0xe8d088);
  return m;
}

/** Kitchenette miteuse : porte manquante, évier plein de vaisselle, réchaud et casserole cabossée, taches et cafard. */
function makeKitchenette(): VoxelModel {
  const m = VoxelModel.meters(1.8, 1.0, 0.6); // 29 × 16 × 10
  const W = m.sx;
  const L = 0xc6b998;
  const Ld = shade(L, 0.72);
  m.box(0, 0, 0, W, 1, 9, 0x2a2622);
  m.box(0, 1, 0, 17, 13, 9, L);
  // porte gauche décollée, porte du milieu arrachée
  m.box(8, 1, 8, 9, 13, 9, Ld);
  m.box(1, 2, 8, 8, 12, 9, shade(L, 1.04));
  m.set(7, 11, 8, 0xa89a78);
  m.box(6, 7, 8, 7, 8, 9, -1);
  m.box(9, 2, 1, 16, 12, 9, -1);
  m.box(9, 2, 0, 16, 12, 1, 0x3a3226);
  m.box(10, 2, 2, 14, 6, 6, 0x151515);
  m.set(12, 6, 3, 0x2a2a2a);
  m.box(14, 2, 5, 15, 6, 6, 0x2a6ab0);
  m.set(14, 6, 5, 0xe8e8e8);
  m.set(16, 12, 8, 0x8a8a86);
  // vieux four émaillé sous le réchaud
  m.box(17, 1, 0, W, 13, 9, 0xd6d2c4);
  m.box(18, 2, 8, W - 1, 9, 9, 0x2a2826);
  m.box(19, 3, 8, W - 2, 8, 9, 0x1a1816);
  m.box(18, 9, 8, W - 1, 10, 9, 0x9a9a96);
  for (const x of [19, 22, 25]) m.set(x, 11, 8, 0x2a2a2a);
  stain(m, 22, 2, 8.5, 2, (c) => mix(c, 0x5a3a1a, 0.4), 121);
  // plan de travail taché et brûlé
  m.box(0, 13, 0, W, 14, 10, 0xb5a988);
  m.box(0, 13, 9, W, 14, 10, 0x9a8e70);
  stain(m, 6, 13.5, 6, 2, (c) => shade(c, 0.75), 122);
  m.set(15, 13, 3, 0x2a2018).set(16, 13, 4, 0x3a2a1a);
  // évier inox et vaisselle sale empilée
  m.box(1, 13, 2, 8, 14, 8, K.steelDark);
  m.box(2, 13, 3, 7, 14, 7, 0x4a4e52);
  m.box(4, 14, 1, 5, 16, 2, 0x9a9a96);
  m.box(4, 15, 2, 5, 16, 3, 0x9a9a96);
  m.box(2, 13, 3, 6, 14, 6, 0xe8e0c8);
  m.box(3, 14, 4, 6, 15, 6, 0xa8c4d0);
  m.set(6, 14, 4, 0xc87a4a);
  // réchaud deux feux : casserole cabossée, poêle grasse
  m.box(18, 14, 2, 28, 15, 8, 0x1a1a1a);
  m.box(19, 15, 2, 23, 17, 6, 0x8e9296);
  m.box(19, 16, 2, 20, 17, 3, 0x6e7276);
  m.box(20, 17, 3, 22, 17, 5, 0x5a3a1a);
  m.box(23, 16, 3, 25, 17, 4, 0x2a2a2a);
  m.box(24, 15, 4, 28, 16, 8, 0x2a2a2c);
  m.box(25, 15, 5, 27, 16, 7, 0x6a5a2a);
  m.box(24, 15, 8, 25, 16, 10, 0x1a1a1a);
  // boîte de céréales, canette, cafard
  m.box(10, 14, 1, 13, 16, 3, 0xd8a020);
  m.box(10, 14, 3, 13, 16, 4, 0xc04020);
  m.box(14, 14, 6, 15, 16, 7, 0x2a6a9a);
  m.set(12, 13, 8, 0x3a2010);
  return m;
}

/** Réfrigérateur : 0 vieux frigo crème cabossé couvert d'aimants ; 1 frigo américain connecté en inox. */
function makeFridge(v: number): VoxelModel {
  const m = VoxelModel.meters(0.8, 1.9, 0.7); // 13 × 30 × 11
  const W = m.sx;
  if (v === 0) {
    const Cr = 0xdcd5bf;
    for (const x of [0, W - 1]) m.box(x, 0, 1, x + 1, 1, 9, 0x1a1a1a);
    m.box(0, 1, 0, W, 30, 9, Cr);
    m.box(0, 1, 9, W, 29, 10, shade(Cr, 1.03));
    m.box(0, 29, 0, W, 30, 1, -1);
    m.box(0, 29, 8, W, 30, 9, -1);
    m.box(0, 1, 9, W, 2, 10, 0x2a2826);
    for (let x = 1; x < W - 1; x += 2) m.set(x, 1, 9, 0x111111);
    // séparation congélateur, poignées
    m.box(0, 21, 9, W, 22, 10, 0x8a8470);
    m.box(10, 23, 10, 11, 27, 11, 0xa8a8a2);
    m.box(10, 13, 10, 11, 19, 11, 0xa8a8a2);
    // aimants, photo, menu à emporter, dessin
    for (const [x, y, c] of [
      [2, 25, 0xc02020],
      [4, 26, 0xe0c020],
      [7, 24, 0x2a6ab0],
      [3, 17, 0x3a9a3a],
      [8, 15, 0xd06a1a],
      [5, 11, 0xc02080],
    ] as const)
      m.set(x, y, 10, c);
    m.box(2, 13, 10, 5, 16, 11, 0xf0ece0);
    m.box(3, 14, 10, 4, 15, 11, 0x4a6a8a);
    m.box(6, 16, 10, 9, 20, 11, 0xf4f0e4);
    m.box(6, 19, 10, 9, 20, 11, 0xc02020);
    m.box(7, 17, 10, 8, 18, 11, 0x5a5a5a);
    m.box(1, 6, 10, 4, 9, 11, 0xf0f0f0);
    m.set(2, 7, 10, 0x2a8a2a).set(3, 8, 10, 0xe0b020);
    // bosses, rouille en bas, traces de doigts
    stain(m, 8, 8, 9.5, 2.2, (c) => shade(c, 0.86), 131);
    stain(m, 3, 2.5, 9.5, 2, (c) => mix(c, 0x8a4a1a, 0.45), 132);
    stain(m, 10, 2, 9.5, 1.6, (c) => mix(c, 0x8a4a1a, 0.4), 133);
    stain(m, 10.5, 20, 9.5, 2, (c) => shade(c, 0.85), 134);
    // carton de pizza et radio sur le dessus
    m.box(1, 29, 2, 8, 30, 8, 0xc8a46a);
    m.box(9, 29, 3, 12, 30, 6, 0x3a3a3a);
    return m;
  }
  // frigo américain en inox : portes françaises, tiroir congélateur, écran, distributeur
  const S = 0xb5bbc1;
  m.box(0, 0, 0, W, 1, 9, 0x1a1a1c);
  m.box(0, 1, 0, W, 30, 9, shade(S, 0.92));
  m.box(0, 1, 9, W, 30, 10, S);
  for (let x = 1; x < W; x += 2) m.box(x, 1, 9, x + 1, 30, 10, shade(S, 1.05));
  m.box(6, 11, 9, 7, 30, 10, 0x4a4e54);
  m.box(0, 10, 9, W, 11, 10, 0x4a4e54);
  // poignées verticales et barre du tiroir
  m.box(4, 14, 10, 5, 27, 11, K.chromeLight);
  m.box(8, 14, 10, 9, 27, 11, K.chromeLight);
  m.box(2, 8, 10, 11, 9, 11, K.chromeLight);
  // écran tactile et distributeur d'eau
  m.box(8, 20, 9, 12, 25, 10, 0x0e0e10);
  m.box(9, 21, 9, 11, 24, 10, SLOT.SCREEN);
  m.box(1, 17, 9, 5, 22, 10, 0x1e2024);
  m.box(2, 18, 9, 4, 21, 10, 0x0c0c0e);
  m.box(2, 21, 9, 4, 22, 10, SLOT.NEON_BLUE);
  m.box(0, 29, 9, W, 30, 10, SLOT.LED);
  return m;
}

// =========================================================================== bar

interface BarPal {
  front: number;
  front2: number;
  top: number;
  vein: number;
  trim: number;
}

const BAR_PAL: BarPal[] = [
  { front: 0xe8e6e0, front2: 0xd2d0ca, top: K.marble, vein: 0xc4c0b8, trim: K.chrome }, // laque blanche, marbre, chrome
  { front: K.walnut, front2: K.walnutDark, top: 0x1e1d1f, vein: 0x4a4648, trim: K.brass }, // noyer, marbre noir, laiton
  { front: 0x141416, front2: 0x232326, top: 0x18171a, vein: K.gold, trim: K.gold }, // laque noire et or
];

/** Comptoir de bar : façade cannelée, néon sous le plateau et au socle, repose-pieds, bouteilles et seau à champagne. */
function makeBarCounter(v: number): VoxelModel {
  const p = BAR_PAL[v];
  const m = new VoxelModel(32, 22, 11, 1 / 16); // 2,0 × 1,06 (+ bouteilles) × 0,69
  const W = m.sx;
  // socle en retrait et néon rasant
  m.box(1, 0, 1, W - 1, 2, 8, 0x0e0e10);
  m.box(1, 0, 8, W - 1, 1, 9, SLOT.NEON);
  // caisson à cannelures verticales
  m.box(0, 2, 0, W, 16, 10, p.front);
  for (let x = 1; x < W; x += 2) m.box(x, 3, 9, x + 1, 15, 10, p.front2);
  m.box(0, 2, 9, W, 3, 10, p.trim);
  // néon sous la lèvre du plateau
  m.box(0, 15, 9, W, 16, 10, SLOT.NEON);
  // plateau épais avec débord, chant métallique
  m.box(0, 16, 0, W, 17, 11, p.top);
  m.box(0, 16, 10, W, 17, 11, p.trim);
  marbleVeins(m, 16, 0, 0, W, 10, 3, 151 + v, p.vein, v === 2 ? K.goldLight : p.vein);
  // repose-pieds tubulaire et ses consoles
  m.box(1, 4, 10, W - 1, 5, 11, p.trim);
  for (const x of [3, 16, 28]) m.box(x, 4, 9, x + 1, 6, 10, p.trim);
  // seau à champagne, bouteilles, shaker, verres à cocktail, coupelle de citrons verts
  m.box(4, 17, 3, 7, 19, 6, 0x9aa4ac);
  m.box(4, 18, 3, 7, 19, 6, 0xe4f0f4);
  m.box(5, 18, 4, 6, 21, 5, 0x1c3a22);
  m.set(5, 21, 4, K.gold);
  m.box(11, 17, 3, 12, 20, 4, 0xa86018);
  m.set(11, 20, 3, 0xc88a3a).set(11, 21, 3, 0x1a1a1a);
  m.box(13, 17, 4, 14, 20, 5, 0xd8e8e4);
  m.set(13, 20, 4, 0xe8f0ee).set(13, 21, 4, 0xb01a1a);
  m.box(18, 17, 5, 19, 19, 6, K.chromeLight);
  m.set(18, 19, 5, K.chrome);
  m.set(22, 17, 6, 0xdde8ec).set(22, 18, 6, 0xe86a8a);
  m.set(24, 17, 7, 0xdde8ec).set(24, 18, 7, 0x7ad8e8);
  m.box(27, 17, 2, 30, 18, 5, K.chrome);
  m.set(28, 18, 3, 0x6ab83a).set(29, 18, 3, 0x7ac84a).set(28, 18, 4, 0x6ab83a);
  return m;
}

/** Tabouret de bar (1/32 m) : 0 cuir noir et laiton ; 1 diner chromé et skaï rouge. */
function makeBarStool(v: number): VoxelModel {
  const m = new VoxelModel(15, 26, 15, R32); // 0,47 × 0,81 × 0,47
  const c = 7.5;
  const metal = v === 0 ? K.brass : K.chrome;
  const seat = v === 0 ? 0x1c191a : 0xb01e28;
  // pied : disque lesté, colonne, repose-pieds annulaire
  m.cylY(c, c, 6.2, 0, 1, v === 0 ? 0x141416 : K.chromeDark);
  m.cylY(c, c, 5.4, 1, 2, metal);
  m.box(7, 2, 7, 8, 21, 8, metal);
  m.box(6, 2, 6, 9, 4, 9, metal);
  m.cylY(c, c, 6.4, 8, 9, metal);
  m.cylY(c, c, 5.2, 8, 9, -1);
  for (const [x0, z0, x1, z1] of [
    [2, 7, 13, 8],
    [7, 2, 8, 13],
  ])
    m.box(x0, 8, z0, x1, 9, z1, metal);
  // assise rembourrée et bague métallique
  m.cylY(c, c, 4, 20, 21, metal);
  m.cylY(c, c, 7, 21, 23, seat);
  m.cylY(c, c, 6.6, 23, 25, shade(seat, 1.1));
  m.cylY(c, c, 5.6, 25, 26, shade(seat, 1.18));
  if (v === 1) m.cylY(c, c, 7, 21, 22, K.chrome);
  else m.cylY(c, c, 7, 22, 23, K.gold);
  return m;
}

/** Étagère à bouteilles rétroéclairée : miroir fumé, bandeaux lumineux derrière les bouteilles, tablettes de verre. */
function makeBottleShelf(): VoxelModel {
  const m = VoxelModel.meters(2.0, 2.2, 0.4); // 32 × 35 × 6
  const W = m.sx;
  const Wd = 0x24160e;
  // meuble bas fermé
  m.box(0, 0, 0, W, 9, 6, Wd);
  m.box(1, 1, 5, W - 1, 8, 6, shade(Wd, 1.25));
  for (const x of [8, 16, 24]) m.box(x, 1, 5, x + 1, 8, 6, Wd);
  for (const x of [6, 10, 22, 26]) m.box(x, 5, 5, x + 1, 7, 6, K.brass);
  // montants, corniche, fond miroir
  m.box(0, 9, 0, 2, 33, 6, Wd);
  m.box(W - 2, 9, 0, W, 33, 6, Wd);
  m.box(0, 33, 0, W, 35, 6, Wd);
  m.box(0, 34, 5, W, 35, 6, K.brass);
  m.box(2, 9, 0, W - 2, 33, 1, SLOT.GLASS);
  // tablettes de verre (chant laiton) et bandeaux lumineux derrière chaque rangée
  const shelfY = [9, 17, 25];
  for (const y of shelfY) {
    m.box(2, y, 1, W - 2, y + 1, 6, y === 9 ? Wd : 0xbcd4da);
    m.box(2, y, 5, W - 2, y + 1, 6, K.brass);
    m.box(2, y + 1, 1, W - 2, y + 2, 2, SLOT.GLOW);
  }
  m.box(2, 32, 2, W - 2, 33, 5, SLOT.GLOW);
  // bouteilles variées (corps, col, bouchon)
  const glass = [0xa8601a, 0x6a2a10, 0x1e4a26, 0xc8dcd6, 0x2a5aa8, 0x9a1a2a, 0xd8a838, 0x3a2a1a, 0x5a7a2a, 0xe0e8e4];
  const caps = [K.gold, 0x1a1a1a, 0xb01a1a, K.silver];
  const r = rng(161);
  for (const y0 of [10, 18, 26]) {
    let x = 3;
    while (x < W - 3) {
      if (r() < 0.12) {
        x++;
        continue;
      }
      const g = glass[Math.floor(r() * glass.length)];
      const wide = r() < 0.25 && x < W - 4;
      const h = 3 + Math.floor(r() * 2);
      const z = 2 + Math.floor(r() * 2);
      m.box(x, y0, z, x + (wide ? 2 : 1), y0 + h, z + 1, g);
      m.set(x, y0 + h, z, shade(g, 1.15));
      m.set(x, y0 + h + 1, z, caps[Math.floor(r() * caps.length)]);
      if (r() < 0.5) m.set(x, y0 + 1, z + 1, 0xece4cc);
      x += wide ? 3 : 2;
    }
  }
  return m;
}

// =========================================================================== plantes et luminaires

/** Grande plante d'intérieur : 0 palmier kentia (pot noir cerclé d'or) ; 1 figuier lyre (pot béton) ; 2 sansevière (pot blanc). */
function makePlantBig(v: number): VoxelModel {
  const m = new VoxelModel(13, 27, 13, 1 / 16); // 0,81 × 1,69 × 0,81 (feuillage débordant)
  const c = 6.5;
  const greens = [K.plant, K.plantDark, K.plantLight, 0x4f7f34];
  if (v === 0) {
    // oiseau de paradis : grandes feuilles en pagaie sur de longs pétioles, pot noir laqué cerclé d'or
    m.cylY(c, c, 4.2, 0, 7, 0x18181b);
    m.cylY(c, c, 3.6, 0, 1, 0x0e0e10);
    m.cylY(c, c, 4.5, 6, 7, K.gold);
    m.cylY(c, c, 3.7, 6, 7, K.soil);
    const leaves: [number, number, number][] = [
      [0.3, 19, 0.55],
      [1.5, 23, 0.25],
      [2.5, 17, 0.6],
      [3.6, 21, 0.35],
      [4.6, 18, 0.55],
      [5.5, 24, 0.15],
      [0.9, 14, 0.8],
    ];
    leaves.forEach(([a, top, lean], i) => {
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const px = -dz;
      const pz = dx;
      const base = top - 8;
      // pétiole
      for (let y = 7; y < base; y++) {
        const t = (y - 7) / (base - 7);
        m.set(c - 0.5 + dx * lean * 3 * t, y, c - 0.5 + dz * lean * 3 * t, 0x5a7a34);
      }
      // limbe : face tournée vers l'extérieur, nervure claire, bords déchirés
      for (let y = base; y < top; y++) {
        const t = (y - base) / (top - base);
        const w = 2.6 * Math.sin(Math.PI * Math.min(1, t * 1.05));
        const ox = c - 0.5 + dx * (lean * 3 + lean * 4 * t);
        const oz = c - 0.5 + dz * (lean * 3 + lean * 4 * t);
        for (let k = -Math.round(w); k <= Math.round(w); k++) {
          if (Math.abs(k) === Math.round(w) && h3(i, y, k, 181) < 0.3) continue;
          const col = k === 0 ? 0x6a9a42 : (i + y) % 5 === 0 ? 0x2e5a22 : i % 2 ? K.plant : 0x356a2a;
          m.set(ox + px * k, y, oz + pz * k, col);
        }
      }
    });
    // fleur orange et bleue en bec d'oiseau
    const fx = 9;
    const fz = 5;
    m.box(fx, 7, fz, fx + 1, 15, fz + 1, 0x5a7a34);
    m.box(fx - 1, 15, fz, fx + 2, 16, fz + 1, 0x4a6a3a);
    m.set(fx + 2, 15, fz, 0x4a6a3a);
    m.set(fx - 1, 16, fz, 0xf08a1a).set(fx, 17, fz, 0xf08a1a).set(fx, 16, fz, 0xf0a020).set(fx + 1, 16, fz, 0x2a5ad0);
    return m;
  }
  if (v === 1) {
    m.cylY(c, c, 4.2, 0, 6, 0x8a8884);
    m.cylY(c, c, 4.4, 5, 6, 0x9a9894);
    m.cylY(c, c, 3.6, 5, 6, K.soil);
    m.box(6, 6, 6, 7, 16, 7, 0x6a4a2a);
    m.box(7, 12, 6, 8, 14, 7, 0x6a4a2a);
    // touffes de grandes feuilles
    const blobs: [number, number, number, number][] = [
      [5, 15, 6, 2.6],
      [8, 17, 7, 2.8],
      [6, 20, 5, 2.8],
      [7, 23, 7, 2.4],
      [4, 19, 8, 2.2],
      [9, 21, 4, 2.2],
    ];
    blobs.forEach(([x, y, z, r], i) => {
      m.ellipsoid(x, y, z, r, r * 0.9, r, i % 2 ? K.plantDark : K.plant);
      m.ellipsoid(x + 0.5, y + 0.6, z + 0.5, r * 0.6, r * 0.5, r * 0.6, i % 2 ? K.plant : K.plantLight);
    });
    m.forEach((x, y, z, col) => (greens.includes(col) && h3(x, y, z, 171) < 0.18 ? K.plantLight : undefined));
    return m;
  }
  // sansevière : lames dressées bordées de jaune
  m.cylY(c, c, 4, 0, 6, 0xf0eee8);
  m.cylY(c, c, 4.2, 5, 6, 0xe0ded8);
  m.cylY(c, c, 3.4, 5, 6, K.soil);
  const blades: [number, number, number][] = [
    [6, 6, 18],
    [5, 7, 15],
    [7, 5, 16],
    [8, 7, 13],
    [4, 5, 12],
    [7, 8, 14],
    [5, 4, 11],
    [9, 5, 12],
    [3, 7, 10],
  ];
  for (const [x, z, h] of blades) {
    m.box(x, 6, z, x + 1, h, z + 1, 0x2e5a2a);
    m.set(x, h - 1, z, 0x5a8a3a);
    m.set(x, h - 3, z, 0xc8c050);
    m.set(x, Math.floor((h + 6) / 2), z, 0x4a7a3a);
  }
  return m;
}

/** Lampadaire (1/32 m) : socle de marbre noir, tige de laiton, abat-jour de toile éclairé de l'intérieur. */
function makeLampFloor(): VoxelModel {
  const m = new VoxelModel(13, 54, 13, R32); // 0,41 × 1,69 × 0,41
  const c = 6.5;
  m.cylY(c, c, 5.6, 0, 2, K.marbleBlack);
  m.cylY(c, c, 4.4, 2, 3, K.brass);
  m.box(6, 3, 6, 7, 44, 7, K.brass);
  m.box(5, 24, 5, 8, 25, 8, K.brass);
  m.box(5, 40, 5, 8, 44, 8, K.brassDark);
  // abat-jour tambour légèrement conique : toile dehors, lumière dedans
  for (const [y0, y1, r] of [
    [41, 46, 6.5],
    [46, 50, 6.1],
    [50, 54, 5.6],
  ]) {
    m.cylY(c, c, r, y0, y1, 0xeadcbc);
    m.cylY(c, c, r - 1, y0, y1, SLOT.GLOW);
    m.cylY(c, c, r - 2, y0, y1, -1);
  }
  m.cylY(c, c, 6.5, 41, 42, 0xc8b48a);
  m.cylY(c, c, 5.5, 41, 42, -1);
  m.cylY(c, c, 5.1, 53, 54, 0xd6c8a8);
  m.cylY(c, c, 4.1, 53, 54, -1);
  // ampoule
  m.box(5, 44, 5, 8, 49, 8, SLOT.GLOW);
  return m;
}

/** Dalle LED plate au plafond : cadre d'aluminium, diffuseur lumineux (face inférieure). */
function makeCeilingLight(): VoxelModel {
  const m = VoxelModel.meters(1.2, 0.1, 1.2); // 19 × 2 × 19
  const W = m.sx;
  m.box(0, 1, 0, W, 2, W, 0xc8ccd2);
  m.box(0, 0, 0, W, 1, W, 0xb0b6be);
  m.box(1, 0, 1, W - 1, 1, W - 1, SLOT.LED);
  return m;
}

/** Suspension industrielle (1/32 m) : cache-piton, cordon, dôme noir doublé de laiton, ampoule lumineuse. */
function makePendantLight(): VoxelModel {
  const m = new VoxelModel(17, 26, 17, R32); // 0,53 × 0,81 × 0,53
  const c = 8.5;
  m.cylY(c, c, 3, 24, 26, 0x1c1c1e);
  m.cylY(c, c, 2, 25, 26, K.brass);
  m.box(8, 12, 8, 9, 24, 9, 0x111111);
  m.box(7, 11, 7, 10, 13, 10, K.brass);
  // dôme en gradins : coque noire, intérieur laiton
  const steps: [number, number, number][] = [
    [2, 5, 7.6],
    [5, 7, 6.6],
    [7, 9, 5.2],
    [9, 11, 3.4],
  ];
  for (const [y0, y1, r] of steps) {
    m.cylY(c, c, r, y0, y1, 0x1c1c1f);
    m.cylY(c, c, r - 1.1, y0, y1, K.brass);
  }
  m.cylY(c, c, 6.4, 2, 5, -1);
  m.cylY(c, c, 5.4, 5, 7, -1);
  m.cylY(c, c, 4.0, 7, 9, -1);
  m.cylY(c, c, 7.6, 2, 3, K.brass);
  m.cylY(c, c, 6.4, 2, 3, -1);
  // ampoule globe
  m.sphere(c, 5, c, 2.6, SLOT.GLOW);
  m.box(7, 8, 7, 10, 10, 10, K.brassDark);
  return m;
}

/** Ampoule nue au bout de son fil (1/32 m) : cache-piton, fil torsadé, douille, globe lumineux. */
function makeBareBulb(): VoxelModel {
  const m = new VoxelModel(7, 16, 7, R32); // 0,22 × 0,5 × 0,22
  m.box(1, 15, 1, 6, 16, 6, 0x3a3836);
  m.box(3, 7, 3, 4, 15, 4, 0x151413);
  m.set(3, 12, 3, 0x2a2826).set(3, 9, 3, 0x2a2826);
  // douille de bakélite
  m.box(2, 5, 2, 5, 7, 5, 0x1e1a18);
  m.box(2, 5, 2, 5, 6, 5, K.brassDark);
  // globe
  m.box(2, 4, 2, 5, 5, 5, SLOT.GLOW);
  m.box(1, 2, 2, 6, 4, 5, SLOT.GLOW);
  m.box(2, 2, 1, 5, 4, 6, SLOT.GLOW);
  m.box(2, 1, 2, 5, 2, 5, SLOT.GLOW);
  m.set(3, 0, 3, SLOT.GLOW);
  return m;
}

/** Tube néon au plafond : profilé métallique, tube de la couleur de la variante, embouts. */
function makeNeonTube(): VoxelModel {
  const m = VoxelModel.meters(1.8, 0.1, 0.2); // 29 × 2 × 3
  const W = m.sx;
  m.box(0, 1, 0, W, 2, 3, 0x5a6068);
  m.box(1, 0, 1, W - 1, 1, 2, SLOT.NEON);
  for (const x of [0, W - 1]) m.box(x, 0, 0, x + 1, 1, 3, 0x3a3e44);
  for (const x of [7, 21]) m.box(x, 0, 0, x + 1, 1, 1, 0x8a9098);
  return m;
}

/** Lustre « pluie de cristal » à LED (1/32 m) : couronne dorée à bougies, plateau doré cerclé de LED, rideau de pampilles en cône inversé, goutte finale. */
function makeChandelier(): VoxelModel {
  const m = new VoxelModel(51, 38, 51, R32); // 1,59 × 1,19 × 1,59
  const c = 25.5;
  const G = K.gold;
  const Gl = K.goldLight;
  const crystal = 0xe2f0fc;
  const bead = 0xb8d8f0;
  // pavillon, tige, couronne à bougies
  m.cylY(c, c, 4.5, 36, 38, G);
  m.box(25, 33, 25, 26, 36, 26, G);
  m.cylY(c, c, 11, 32, 33, Gl);
  m.cylY(c, c, 10, 32, 33, G);
  m.cylY(c, c, 9, 32, 33, -1);
  m.cylY(c, c, 3, 32, 34, G);
  for (let k = 0; k < 8; k++) {
    const t = (k / 8) * Math.PI * 2;
    const x = c + Math.cos(t) * 9.5;
    const z = c + Math.sin(t) * 9.5;
    m.set(x, 33, z, 0xf4f0e6).set(x, 34, z, 0xf4f0e6).set(x, 35, z, SLOT.GLOW);
    for (let d = 3; d < 9.5; d += 0.7) m.set(c + Math.cos(t) * d, 32, c + Math.sin(t) * d, G);
  }
  // plateau principal doré, liseré LED en dessous
  m.cylY(c, c, 24.5, 30, 32, G);
  m.cylY(c, c, 24.5, 31, 32, Gl);
  m.cylY(c, c, 23, 31, 32, G);
  m.cylY(c, c, 24.5, 30, 31, SLOT.LED);
  m.cylY(c, c, 23.2, 30, 31, G);
  // rideau de pampilles : trois couronnes, plus longues vers le centre
  const rings: [number, number, number][] = [
    [22.5, 10, 4],
    [16.5, 17, 4],
    [10.5, 23, 4],
    [5, 27, 4],
  ];
  for (const [r, len, step] of rings) {
    const n = Math.round((Math.PI * 2 * r) / step);
    for (let k = 0; k < n; k++) {
      const t = (k / n) * Math.PI * 2 + r;
      const x = c + Math.cos(t) * r;
      const z = c + Math.sin(t) * r;
      const L = len - (k % 3) * 2;
      // pampille : fil de cristal, perle taillée, goutte lumineuse
      for (let d = 1; d <= L; d++) m.set(x, 30 - d, z, d === L ? SLOT.GLOW : d >= L - 2 ? bead : crystal);
    }
  }
  // goutte centrale
  m.box(25, 4, 25, 26, 30, 26, crystal);
  m.box(24, 2, 24, 27, 5, 27, crystal);
  m.box(25, 1, 25, 26, 6, 26, bead);
  m.box(25, 0, 25, 26, 1, 26, SLOT.GLOW);
  return m;
}

// =========================================================================== tableaux, néons, portraits

/** Peint une toile (u vers la droite, v vers le haut) sur la couche z, à partir de (x0, y0). */
function canvas(m: VoxelModel, x0: number, y0: number, z: number, w: number, h: number, fn: (u: number, v: number) => number | undefined): void {
  for (let v = 0; v < h; v++)
    for (let u = 0; u < w; u++) {
      const c = fn(u, v);
      if (c !== undefined) m.set(x0 + u, y0 + v, z, c);
    }
}

/** Cadre en relief (largeur b) autour d'une toile : profil à deux niveaux, coins rehaussés. */
function frame(m: VoxelModel, W: number, H: number, b: number, depth: number, c: number, cl: number): void {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = Math.min(x, y, W - 1 - x, H - 1 - y);
      if (d >= b) continue;
      const corner = (x < b + 1 || x >= W - b - 1) && (y < b + 1 || y >= H - b - 1);
      const top = d === Math.floor(b / 2) || corner ? depth : depth - 1;
      m.box(x, y, 0, x + 1, y + 1, top, d === 0 ? shade(c, 0.8) : corner || d === Math.floor(b / 2) ? cl : c);
    }
}

/** Tableaux encadrés (1/32 m) : 8 œuvres originales (champs colorés, skyline de nuit, géométrique, couchant synthwave
 *  et statue, lèvres pop art, éclaboussures, cercle zen doré, pont de Brooklyn au crépuscule). */
function makeWallArt(v: number): VoxelModel {
  const m = new VoxelModel(38, 26, 2, R32); // 1,19 × 0,81 × 0,06
  const W = m.sx;
  const H = m.sy;
  const frames = [0x141414, 0x101012, 0xeeece6, K.gold, 0xeeece6, 0x141414, K.gold, K.walnut];
  const fc = frames[v];
  frame(m, W, H, 2, 2, fc, fc === K.gold ? K.goldLight : shade(fc, fc === 0xeeece6 ? 0.92 : 1.6));
  const cw = W - 4;
  const ch = H - 4;
  let f: (u: number, v: number) => number | undefined;
  switch (v) {
    case 0: // champs colorés superposés
      f = (u, w) => {
        const inX = u >= 3 && u < cw - 3;
        if (inX && w >= 12 && w < ch - 3) return u === 3 || u === cw - 4 || w === 12 || w === ch - 4 ? 0xb4482a : 0xd8662a;
        if (inX && w >= 3 && w < 10) return u === 3 || u === cw - 4 || w === 3 || w === 9 ? 0x561018 : 0x3e0a12;
        return 0x6e1616;
      };
      break;
    case 1: {
      // skyline de Manhattan la nuit, lune, reflets sur le fleuve
      const hts: number[] = [];
      for (let u = 0; u < cw; u++) hts.push(0);
      const blds: [number, number, number][] = [
        [0, 3, 8],
        [3, 7, 11],
        [7, 9, 7],
        [9, 14, 14],
        [14, 16, 9],
        [16, 19, 6],
        [19, 23, 12],
        [23, 26, 8],
        [26, 29, 10],
        [29, 31, 5],
        [31, 34, 9],
      ];
      for (const [a, b, h] of blds) for (let u = a; u < b; u++) hts[u] = h + 4;
      // flèches façon Empire State et Chrysler
      hts[10] = hts[12] = 20;
      hts[11] = 23;
      hts[20] = hts[22] = 17;
      hts[21] = 20;
      const starts = new Set(blds.map((b) => b[0]));
      f = (u, w) => {
        if (w < 4) {
          const lit = hts[u] > 10 && u % 2 === 0 && h3(u, w, 0, 191) < 0.5;
          return lit ? 0x8a7a4a : w === 3 ? 0x1a2448 : 0x0e1630;
        }
        if (w < hts[u]) {
          if (w >= hts[u] - 1 && (u === 11 || u === 21)) return 0xc8c8d8;
          if (starts.has(u)) return 0x1a1e30;
          const win = u % 2 === 1 && w % 2 === 0 && w < hts[u] - 1 && h3(u, w, 1, 192) < 0.42;
          return win ? 0xf0c860 : 0x0c0e18;
        }
        if ((u - 28) ** 2 + (w - 18) ** 2 <= 4.5) return 0xf0e6c0;
        if (w === 20 && u % 9 === 3) return 0xd8d8e8;
        return w > 17 ? 0x101a40 : w > 13 ? 0x24245a : w > 9 ? 0x4a2c66 : 0x8e3a68;
      };
      break;
    }
    case 2: // composition géométrique
      f = (u, w) => {
        if (u === 6 || u === 15 || u === 27 || w === 7 || w === 15 || (u === 21 && w < 7)) return 0x141414;
        if (u < 6 && w > 15) return 0xc8282a;
        if (u > 15 && u < 21 && w < 7) return 0x1e3c8c;
        if (u > 27 && w > 7 && w < 15) return 0xe8c02a;
        if (u > 6 && u < 15 && w > 15) return 0xe8e4d8;
        return 0xf2eee2;
      };
      break;
    case 3: // couchant synthwave et statue de la Liberté
      f = (u, w) => {
        const lib =
          (u >= 5 && u <= 8 && w >= 4 && w <= 14) ||
          (u >= 6 && u <= 7 && w >= 15 && w <= 16) ||
          (w === 17 && (u === 5 || u === 7 || u === 9)) ||
          (u >= 9 && u <= 10 && w >= 13 && w <= 19) ||
          (u >= 3 && u <= 10 && w <= 4);
        if (lib) return 0x0a0a14;
        if (u >= 9 && u <= 11 && w >= 20 && w <= 21) return w === 21 ? 0xf8d040 : 0xf08a30;
        if (w < 6) return w % 2 === 1 || (u - 17) % (8 - w) === 0 ? 0xc0308a : 0x1a0a2a;
        const d = Math.hypot(u - 19, w - 10);
        if (d <= 7 && !(w < 10 && w % 2 === 0)) return w > 10 ? 0xf8d040 : 0xf08a30;
        return w > 18 ? 0x1a0a3a : w > 14 ? 0x4a1a6a : w > 10 ? 0xa02a7a : 0xe0603a;
      };
      break;
    case 4: {
      // lèvres pop art sur fond jaune pointillé
      const lips = [
        '.........KKKK...KKKK.........',
        '.......KKRRRRK.KRRRRKK.......',
        '.....KKRRRRRRRKRRRRRRRKK.....',
        '...KKRRRRRRRRRRRRRRRRRRRKK...',
        '.KKRRRRRRRRRRRRRRRRRRRRRRRKK.',
        'KKKKKKKKKKKKKKKKKKKKKKKKKKKKK',
        '.KKRRRRRRRRRRRRRRRRRRRRRRRKK.',
        '..KKRRRRRWWWRRRRRRRRRRRRRKK..',
        '...KKRRRRRWWRRRRRRRRRRRRKK...',
        '.....KKRRRRRRRRRRRRRRRKK.....',
        '.......KKKRRRRRRRRRKKK.......',
        '..........KKKKKKKKK..........',
      ];
      f = (u, w) => {
        const r = 16 - w;
        const k = u - 2;
        if (r >= 0 && r < lips.length && k >= 0 && k < lips[r].length) {
          const ch = lips[r][k];
          if (ch === 'K') return 0x1a1a1a;
          if (ch === 'R') return 0xd01830;
          if (ch === 'W') return 0xf8e0e8;
        }
        return u % 3 === 0 && w % 3 === 0 ? 0xf09ab8 : 0xf2d23a;
      };
      break;
    }
    case 5: {
      // éclaboussures et coulures
      const blobs: [number, number, number, number][] = [
        [8, 14, 3.2, 0x141414],
        [24, 8, 3.6, K.gold],
        [18, 16, 2.4, 0xc0202a],
        [28, 18, 2, 0x141414],
        [13, 6, 1.8, 0xc0202a],
        [4, 4, 1.4, K.gold],
      ];
      f = (u, w) => {
        for (const [x, y, r, c] of blobs) {
          if (Math.hypot(u - x, w - y) <= r) return c;
          if (Math.abs(u - x) < 0.6 && w < y && w > y - r - 2 - (x % 4)) return c;
          if (Math.hypot(u - x - r - 1, w - y - 1) < 0.8) return c;
        }
        return 0xf4f2ec;
      };
      break;
    }
    case 6: // cercle zen doré et sceau rouge
      f = (u, w) => {
        const d = Math.hypot(u - 16, w - 11);
        const a = Math.atan2(w - 11, u - 16);
        const thick = 1.2 + 0.9 * (0.5 + 0.5 * Math.sin(a + 1.2));
        if (d >= 7.5 - thick && d <= 7.5 + 0.4 && !(a > 0.5 && a < 1.05)) return a < -1.6 ? K.goldLight : K.gold;
        if (u >= 27 && u <= 29 && w >= 2 && w <= 4) return u === 28 && w === 3 ? 0xe8c8b8 : 0xb01a1a;
        return 0x121214;
      };
      break;
    default: {
      // pont de Brooklyn au crépuscule
      const towerU0 = 11;
      f = (u, w) => {
        const inTower = u >= towerU0 && u <= towerU0 + 6 && w >= 4 && w <= 19;
        const arch = (u === towerU0 + 1 || u === towerU0 + 2 || u === towerU0 + 4 || u === towerU0 + 5) && w >= 9 && w <= 15;
        const archTop = (u === towerU0 + 2 || u === towerU0 + 4) && w === 16;
        if (inTower && !arch && !archTop) return w === 19 ? 0x4a3a3a : (u + w) % 4 === 0 ? 0x3a2c2e : 0x33272a;
        // câbles porteurs et suspentes
        const top = 19;
        const t = u < towerU0 ? u / towerU0 : (cw - 1 - u) / (cw - 1 - towerU0 - 6);
        const cl = 7 + (top - 7) * t * t;
        if (!inTower && Math.abs(w - cl) < 0.6) return 0x1a1418;
        if (!inTower && u % 2 === 0 && w < cl && w > 6) return 0x4a3a40;
        if (w === 6 || w === 5) return 0x1a1418;
        if (w < 5) return (u + w) % 5 === 0 ? 0xf0b060 : 0x2a3a5a;
        return w > 16 ? 0x3a4a7a : w > 11 ? 0xd87a5a : 0xf0b060;
      };
    }
  }
  canvas(m, 2, 2, 0, cw, ch, f);
  return m;
}

/** Néons d'art (1/32 m) sur panneau d'acrylique noir : tubes de la couleur de la variante.
 *  0 lèvres, 1 verre à martini, 2 melon et moustache (Dadou), 3 haut-de-forme et monocle (Even),
 *  4 dollar, 5 couronne, 6 dés, 7 skyline (Empire State et Chrysler). */
function makeNeonArt(v: number): VoxelModel {
  const m = new VoxelModel(45, 32, 3, R32); // 1,41 × 1,0 × 0,09
  const W = m.sx;
  const H = m.sy;
  // panneau aux coins arrondis, entretoises chromées
  m.box(1, 1, 0, W - 1, H - 1, 1, 0x0c0c10);
  for (const [x, y] of [
    [1, 1],
    [W - 2, 1],
    [1, H - 2],
    [W - 2, H - 2],
  ])
    m.set(x, y, 0, -1);
  for (const [x, y] of [
    [3, 3],
    [W - 4, 3],
    [3, H - 4],
    [W - 4, H - 4],
  ])
    m.set(x, y, 1, K.chrome);
  const N = SLOT.NEON;
  const ln = (x0: number, y0: number, x1: number, y1: number) => {
    line6(m, x0, y0, 1, x1, y1, 1, N);
    line6(m, x0, y0, 2, x1, y1, 2, N);
  };
  const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number) => {
    const n = Math.ceil(Math.abs(a1 - a0) * Math.max(rx, ry) * 1.5) + 2;
    let px = cx + Math.cos(a0) * rx;
    let py = cy + Math.sin(a0) * ry;
    for (let i = 1; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const x = cx + Math.cos(a) * rx;
      const y = cy + Math.sin(a) * ry;
      ln(px, py, x, y);
      px = x;
      py = y;
    }
  };
  const poly = (pts: [number, number][], closed = false) => {
    for (let i = 0; i + 1 < pts.length; i++) ln(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (closed) ln(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]);
  };
  const P = Math.PI;
  switch (v) {
    case 0: // lèvres
      arc(16, 13, 9, 8, P * 0.18, P * 0.9);
      arc(28, 13, 9, 8, P * 0.1, P * 0.82);
      arc(22, 21, 17, 13, P * 1.12, P * 1.88);
      poly([
        [7, 16],
        [14, 15],
        [22, 16],
        [30, 15],
        [37, 16],
      ]);
      break;
    case 1: // verre à martini et olive
      poly(
        [
          [10, 26],
          [34, 26],
          [22, 13],
        ],
        true,
      );
      poly([
        [22, 13],
        [22, 6],
      ]);
      poly([
        [16, 5],
        [28, 5],
      ]);
      arc(26, 22, 2.5, 2.5, 0, P * 2);
      poly([
        [26, 22],
        [31, 29],
      ]);
      break;
    case 2: // chapeau melon et grosse moustache en guidon
      arc(22, 17, 9, 9, 0, P);
      poly([
        [9, 17],
        [35, 17],
      ]);
      arc(9, 19, 2, 2, P * 1.5, P * 2.5);
      arc(35, 19, 2, 2, P * 0.5, P * 1.5);
      poly([
        [13, 20],
        [31, 20],
      ]);
      arc(16, 9, 6, 3.5, P * 1.05, P * 2.0);
      arc(28, 9, 6, 3.5, P * 1.0, P * 1.95);
      arc(9, 11, 2.5, 2.5, P * 1.2, P * 2.4);
      arc(35, 11, 2.5, 2.5, P * 0.6, P * 1.8);
      break;
    case 3: // haut-de-forme et monocle à chaînette
      poly(
        [
          [15, 15],
          [15, 28],
          [29, 28],
          [29, 15],
        ],
        false,
      );
      poly([
        [9, 15],
        [35, 15],
      ]);
      poly([
        [15, 18],
        [29, 18],
      ]);
      arc(27, 8, 4, 4, 0, P * 2);
      poly([
        [23, 7],
        [19, 4],
        [13, 4],
      ]);
      break;
    case 4: // dollar
      arc(22, 20, 6, 4, P * 0.1, P * 1.5);
      arc(22, 12, 6, 4, P * 0.5, P * -0.9);
      poly([
        [22, 3],
        [22, 29],
      ]);
      break;
    case 5: // couronne
      poly([
        [11, 9],
        [9, 22],
        [16, 15],
        [22, 25],
        [28, 15],
        [35, 22],
        [33, 9],
      ]);
      poly([
        [11, 9],
        [33, 9],
      ]);
      poly([
        [12, 6],
        [32, 6],
      ]);
      arc(9, 23, 1.5, 1.5, 0, P * 2);
      arc(22, 26.5, 1.5, 1.5, 0, P * 2);
      arc(35, 23, 1.5, 1.5, 0, P * 2);
      break;
    case 6: // deux dés
      poly(
        [
          [7, 7],
          [19, 7],
          [19, 19],
          [7, 19],
        ],
        true,
      );
      poly(
        [
          [24, 11],
          [36, 11],
          [36, 23],
          [24, 23],
        ],
        true,
      );
      for (const [x, y] of [
        [10, 10],
        [13, 13],
        [16, 16],
        [27, 14],
        [33, 14],
        [27, 20],
        [33, 20],
      ])
        m.box(x, y, 1, x + 1, y + 1, 3, N);
      break;
    default: // skyline : Empire State, Chrysler, tours
      poly([
        [4, 4],
        [4, 12],
        [9, 12],
        [9, 17],
        [12, 17],
        [12, 21],
        [14, 21],
        [14, 27],
        [15, 27],
        [15, 21],
        [17, 21],
        [17, 17],
        [20, 17],
        [20, 10],
        [25, 10],
        [25, 18],
        [27, 21],
        [28, 24],
        [29, 21],
        [31, 18],
        [31, 8],
        [36, 8],
        [36, 14],
        [40, 14],
        [40, 4],
      ]);
      poly([
        [4, 4],
        [40, 4],
      ]);
      arc(28, 19, 2, 2, P * 0.1, P * 0.9);
  }
  return m;
}

interface PortraitPal {
  legend: Record<string, number>;
  rows: string[];
  frame: number;
  frameL: number;
}

/** Portraits encadrés (1/32 m) : 0 parrain générique aux couleurs du propriétaire, 1 Dadou, 2 Even. */
function makePortrait(v: number): VoxelModel {
  const m = new VoxelModel(29, 38, 3, R32); // 0,91 × 1,19 × 0,09
  const W = m.sx;
  const H = m.sy;
  const P = PORTRAITS[v];
  frame(m, W, H, 3, 3, P.frame, P.frameL);
  // ornements : fronton, cartouche
  m.box(12, H - 2, 2, 17, H, 3, P.frameL);
  m.box(13, H - 1, 2, 16, H, 3, P.frame);
  m.box(10, 0, 2, 19, 2, 3, P.frameL);
  m.box(11, 1, 2, 18, 2, 3, shade(P.frame, 0.7));
  m.box(12, 1, 2, 13, 2, 3, P.frameL).box(15, 1, 2, 16, 2, 3, P.frameL);
  // toile
  pixXY(m, P.rows, P.legend, 3, H - 4, 0, 1);
  return m;
}

const PORTRAITS: PortraitPal[] = [
  {
    // parrain générique : feutre, rayures tennis, cravate et pochette aux couleurs du propriétaire
    frame: SLOT.TINT2,
    frameL: SLOT.TINT2,
    legend: {
      ',': SLOT.TINT3,
      '.': SLOT.TINT3,
      K: 0x2a2a2e,
      k: 0x3e3e44,
      R: SLOT.TINT1,
      B: 0x141210,
      S: 0xd8ae88,
      s: 0xb88a68,
      j: 0xa8907a,
      E: 0x1a1410,
      m: 0x7a3a32,
      W: 0xece8e0,
      T: SLOT.TINT1,
      C: 0x2a2a30,
      c: 0x44444c,
      L: 0x222228,
      O: 0x6a3a1e,
      o: 0xe86a2a,
    },
    rows: [
      '.......................',
      '.......................',
      '.........KK.KK.........',
      '........KKKKKKK........',
      '.......KKKKKKKKK.......',
      '.......KkKKKKKkK.......',
      '.......RRRRRRRRR.......',
      '....KKKKKKKKKKKKKKK....',
      '.....kKKKKKKKKKKKk.....',
      '.......BSSSSSSSB.......',
      '.......SBBSSSBBS.......',
      '......SSESSSSSESS......',
      '......SSSSSsSSSSS......',
      '.......SSSSsSSSS.......',
      '.......jSSsssSSj.......',
      '.......jjSmmmSjjOO.....',
      '........jjSSSjjoOOO....',
      '.........jjjjj.........',
      '.........ssSss.........',
      '........WWWTWWW........',
      '.....CCLWWWTWWWLCC.....',
      '...CCcCCLWWTWWLCCcCC...',
      '..CCCcCCCLWTWLCCCcCCC..',
      '.CCCCcCCCCLTLCRRCcCCCC.',
      '.CCCCcCCCCLTLCCRCcCCCC.',
      '.CCCCcCCCCCLCCCCCcCCCC.',
      '.CCCCcCCCCCCCCCCCcCCCC.',
      '.CCCCcCCCCCcCCCCCcCCCC.',
      '.CCCCcCCCCCCCCCCCcCCCC.',
      '.CCCCcCCCCCcCCCCCcCCCC.',
      '.CCCCcCCCCCCCCCCCcCCCC.',
      '.CCCCcCCCCCcCCCCCcCCCC.',
    ],
  },
  {
    // Dadou : melon noir à ruban cramoisi, grande moustache noire en guidon, cramoisi, noir et or
    frame: K.gold,
    frameL: K.goldLight,
    legend: {
      ',': 0x3a070c,
      '.': 0x5a0c12,
      K: 0x141316,
      k: 0x34323a,
      R: 0x9e1b22,
      B: 0x221812,
      S: 0xe0b896,
      s: 0xc0946e,
      E: 0x24160e,
      M: 0x18110e,
      m: 0x8a4038,
      W: 0xece6da,
      T: 0xa31e26,
      G: K.gold,
      C: 0x161418,
      c: 0x2c282c,
      L: 0x8e1b22,
      V: 0x5a1218,
      F: 0xd02030,
    },
    rows: [
      ',,,,,,,,,,,,,,,,,,,,,,,',
      ',.....................,',
      ',........KKKKK........,',
      ',.......KKkKKKK.......,',
      ',......KKkKKKKKK......,',
      ',......KkKKKKKKK......,',
      ',......KKKKKKKKK......,',
      ',......RRRRRRRRR......,',
      ',...KKKKKKKKKKKKKKK...,',
      ',..K..BBBBBBBBBBB..K..,',
      ',.....BBSSSSSSSBB.....,',
      ',.....BSBBBSBBBSB.....,',
      ',.....BSWESSSEWSB.....,',
      ',....sBSSSSsSSSSBs....,',
      ',..M..SSSSsssSSSS..M..,',
      ',..MM.SMMMMMMMMMS.MM..,',
      ',...MMMMMMMMMMMMMMM...,',
      ',......SMMMMMMMS......,',
      ',......SSmSSSmSS......,',
      ',.......SSmmmSS.......,',
      ',........SSSSS........,',
      ',.........sss.........,',
      ',...CCCWWWWTWWWWCCC...,',
      ',.CCCCLLWWWTWWWLLFFCC.,',
      ',CCCcCLLWWWTWWWLLFcCCC,',
      ',CCCcCCLLVVTVVLLCCcCCC,',
      ',CCCcCCLLVVGVVLLCCcCCC,',
      ',CCCcCCCLLVTVLLCCCcCCC,',
      ',CCCcCCCLGVVVGLCCCcCCC,',
      ',CCCcCCCCLGVGLCCCCcCCC,',
      ',CCCcCCCCCLGLCCCCCcCCC,',
      ',CCCcCCCCCCGCCCCCCcCCC,',
    ],
  },
  {
    // Even : haut-de-forme, monocle cerclé d'argent, barbe grise soignée, bleu marine et argent
    frame: K.silver,
    frameL: 0xf2f5f8,
    legend: {
      ',': 0x08101e,
      '.': 0x0e1a34,
      K: 0x111216,
      k: 0x2c2e36,
      N: 0x1d3461,
      n: 0x2c4a80,
      H: 0x8a867e,
      S: 0xecc6a4,
      s: 0xcaa080,
      E: 0x34506e,
      Y: 0xb8b4ac,
      y: 0x8e8a84,
      A: K.silver,
      W: 0xf2eee6,
      T: 0xdde3ea,
      V: 0x8a8f98,
      C: 0x1d3461,
      c: 0x2c4a80,
    },
    rows: [
      ',,,,,,,,KKKKKKK,,,,,,,,',
      ',.......KKkKKKK.......,',
      ',.......KKkKKKK.......,',
      ',.......KKkKKKK.......,',
      ',.......KKkKKKK.......,',
      ',.......KKkKKKK.......,',
      ',.......NNNNNNN.......,',
      ',.......NNNNNNN.......,',
      ',....KKKKKKKKKKKKK....,',
      ',......HHHHHHHHH......,',
      ',......HSSSSYYYH......,',
      ',......HYYSSAAAH......,',
      ',.....sSWESSAEASs.....,',
      ',.....sSSSSsAAASs.....,',
      ',......YSSsssSSYA.....,',
      ',......YYYYYYYYY.A....,',
      ',......YYYsssYYY..A...,',
      ',......YYYYYYYYY...A..,',
      ',.......YYyYyYY....A..,',
      ',........YYYYY.....A..,',
      ',.........YyY......A..,',
      ',.........sss......A..,',
      ',...CCCWWWWTWWWWCCA...,',
      ',.CCCCnnWWWTWWWnnACCC.,',
      ',CCCcCnnWWWTWWWnnCcCCC,',
      ',CCCcCCnnVVTVVnnCCcCCC,',
      ',CCCcCCnnVVAVVnnCCcCCC,',
      ',CCCcCCCnnVTVnnCCCcCCC,',
      ',CCCcCCCnAVVVAnCCCcCCC,',
      ',CCCcCCCCnAVAnCCCCcCCC,',
      ',CCCcCCCCCnAnCCCCCcCCC,',
      ',CCCcCCCCCCACCCCCCcCCC,',
    ],
  },
];

// =========================================================================== pièces de luxe

/** Poisson exotique (1/32 m) tourné vers +x (dir = 1) ou −x (dir = −1). */
function fish(m: VoxelModel, x: number, y: number, z: number, dir: number, kind: number): void {
  const body = [0xf07a1a, 0x2a5ad0, 0xf0d020, 0xd8dce0, 0xe0303a][kind];
  const fin = [0x141414, 0xf0d020, 0xf0e070, 0x1a1a1a, 0xf4f4f4][kind];
  const L = kind === 2 || kind === 3 ? 4 : 5;
  const hgt = kind === 2 || kind === 3 ? 3 : 2;
  for (let i = 0; i < L; i++) {
    const xx = x + dir * i;
    const hh = i === 0 || i === L - 1 ? Math.max(1, hgt - 1) : hgt;
    m.box(xx, y, z, xx + 1, y + hh, z + 1, body);
  }
  // queue, œil, rayures
  m.box(x - dir, y - (hgt > 2 ? 1 : 0), z, x - dir + 1, y + hgt + (hgt > 2 ? 0 : 0), z + 1, fin);
  m.set(x + dir * (L - 2), y + hgt - 1, z, 0x0a0a0a);
  if (kind === 0) {
    m.box(x + dir * 1, y, z, x + dir * 1 + 1, y + 2, z + 1, 0xf8f8f4);
    m.box(x + dir * 3, y, z, x + dir * 3 + 1, y + 2, z + 1, 0xf8f8f4);
  }
  if (kind === 3) m.box(x + dir, y - 1, z, x + dir + 1, y + 4, z + 1, 0x1a1a1a);
}

/** Aquarium récifal (1/32 m) : meuble laqué, cuve aux arêtes chromées, fond lumineux bleu, sable, roches, coraux, plantes, poissons, bulles. */
function makeAquarium(): VoxelModel {
  const m = new VoxelModel(64, 45, 19, R32); // 2,0 × 1,41 × 0,59
  const W = m.sx;
  const D = m.sz;
  // meuble
  m.box(1, 0, 1, W - 1, 2, D - 2, 0x0a0a0c);
  m.box(0, 2, 0, W, 16, D - 1, 0x141416);
  for (const x of [21, 42]) m.box(x, 3, D - 2, x + 1, 15, D - 1, 0x050506);
  for (const x of [19, 23, 40, 44]) m.box(x, 8, D - 1, x + 1, 11, D, K.chrome);
  m.box(0, 15, 0, W, 16, D, K.chrome);
  // cuve : arêtes, fond lumineux en dégradé, rayons
  const y0 = 16;
  const y1 = 41;
  for (const [x, z] of [
    [0, 0],
    [W - 1, 0],
    [0, D - 1],
    [W - 1, D - 1],
  ])
    m.box(x, y0, z, x + 1, y1, z + 1, 0x1c1c20);
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < W; x++) {
      const ray = (x + y * 0.6) % 13 < 1.6 && y > y0 + 9;
      const t = (y - y0) / (y1 - y0);
      m.set(x, y, 0, ray ? SLOT.NEON_CYAN : t > 0.86 ? SLOT.NEON_BLUE : t > 0.55 ? 0x1658a8 : t > 0.25 ? 0x0e4488 : 0x0a2e62);
    }
  m.box(0, y0, 1, 1, y1, D - 1, 0x0a2a4a);
  m.box(W - 1, y0, 1, W, y1, D - 1, 0x0a2a4a);
  m.box(1, y0 + 3, 1, 2, y1 - 1, D - 1, -1);
  // sable en pente, roches, coraux
  for (let z = 1; z < D - 1; z++) {
    const h = 2 + Math.floor((D - z) / 6);
    m.box(1, y0, z, W - 1, y0 + h, z + 1, 0xd8c8a0);
  }
  m.forEach((x, y, z, c) => (c === 0xd8c8a0 && h3(x, y, z, 201) < 0.15 ? 0xb8a880 : undefined));
  m.ellipsoid(8, y0 + 4, 4, 7, 5, 3.5, 0x5a5a66);
  m.ellipsoid(6, y0 + 7, 4, 4, 3, 3, 0x6e6e7a);
  m.ellipsoid(52, y0 + 5, 4, 9, 6, 3.5, 0x4e4e5a);
  m.ellipsoid(56, y0 + 9, 5, 4, 4, 3, 0x66667a);
  m.ellipsoid(30, y0 + 3, 6, 5, 2.5, 3, 0x5e5e6a);
  const coral = (x: number, z: number, h: number, c: number) => {
    m.box(x, y0 + 3, z, x + 1, y0 + 3 + h, z + 1, c);
    for (let k = 2; k < h; k += 2) {
      const sd = k % 4 === 0 ? 1 : -1;
      m.set(x + sd, y0 + 3 + k, z, c).set(x + sd * 2, y0 + 4 + k, z, c);
    }
  };
  coral(14, 6, 7, 0xe86a8a);
  coral(18, 9, 5, 0xf0a040);
  coral(44, 7, 8, 0xd84a9a);
  coral(38, 11, 4, 0xf07a5a);
  m.ellipsoid(24, y0 + 4, 10, 2.5, 2, 2, 0xf0d0a0);
  // plantes ondulantes
  for (const [x, z, h] of [
    [3, 10, 17],
    [5, 13, 13],
    [26, 4, 19],
    [28, 7, 15],
    [34, 3, 18],
    [59, 11, 16],
    [61, 8, 20],
  ]) {
    for (let k = 0; k < h; k++) {
      const off = Math.round(Math.sin(k * 0.5 + x) * 1.2);
      m.set(x + off, y0 + 3 + k, z, k % 5 === 4 ? 0x7ad05a : 0x3a9a3a);
      if (k % 4 === 2) m.set(x + off + 1, y0 + 3 + k, z, 0x5aba4a);
    }
  }
  // poissons
  fish(m, 12, 29, 9, 1, 0);
  fish(m, 40, 33, 12, -1, 1);
  fish(m, 22, 35, 6, 1, 2);
  fish(m, 50, 26, 8, -1, 3);
  fish(m, 33, 24, 14, 1, 4);
  fish(m, 46, 37, 5, 1, 0);
  fish(m, 16, 22, 13, -1, 2);
  // bulles
  for (let y = y0 + 6; y < y1 - 1; y += 2) m.set(57 + (y % 4 === 0 ? 1 : 0), y, 13, 0xe8f6ff);
  // rampe d'éclairage
  m.box(0, y1, 0, W, 44, D, 0x141416);
  m.box(0, y1, D - 1, W, y1 + 1, D, K.chrome);
  m.box(2, y1, 2, W - 2, y1 + 1, D - 2, SLOT.LED);
  m.box(0, 44, 1, W, 45, D - 1, 0x1c1c20);
  return m;
}

/** Piano à queue laqué noir (couvercle ouvert sur sa béquille) : cadre doré, cordes, clavier, lyre et pédales. */
function makeGrandPiano(): VoxelModel {
  const m = new VoxelModel(24, 25, 34, 1 / 16); // 1,5 × 1,05 (+ couvercle levé) × 2,13
  const W = m.sx;
  const D = m.sz;
  const BK = 0x121216;
  const HI = 0x44444e;
  const KB = 26; // début du clavier (z)
  // contour vu de dessus : côté gauche droit, éclisse droite incurvée, queue arrondie
  const right = (z: number): number => {
    if (z >= KB) return W;
    if (z < 6) return Math.round(6 + Math.sqrt(Math.max(0, 36 - (6 - z) ** 2)));
    const d = Math.min(1, Math.max(0, ((KB - z) / (KB - 6) - 0.1) / 0.9));
    return Math.round(W - 12 * d * d * (3 - 2 * d));
  };
  const left = (z: number): number => (z < 6 ? Math.round(6 - Math.sqrt(Math.max(0, 36 - (6 - z) ** 2))) : 0);
  const inside = (x: number, z: number) => x >= left(z) && x < right(z) && z < D;
  // caisse : ceinture laquée, table d'harmonie, cadre doré, cordes
  for (let z = 0; z < KB; z++)
    for (let x = 0; x < W; x++) {
      if (!inside(x, z)) continue;
      const edge = !inside(x - 1, z) || !inside(x + 1, z) || !inside(x, z - 1);
      if (edge) m.box(x, 8, z, x + 1, 15, z + 1, BK);
      else {
        m.box(x, 8, z, x + 1, 11, z + 1, BK);
        m.set(x, 11, z, (x + z) % 9 === 0 ? 0xb8925a : 0xc8a268);
        m.set(x, 12, z, K.gold);
        if (x % 2 === 1 && z > 2) m.set(x, 13, z, 0xd8d8d0);
      }
      if (edge) m.set(x, 14, z, HI);
    }
  // couvercle levé (charnière côté gauche), béquille
  const tan = 0.36;
  for (let z = 0; z < KB - 1; z++)
    for (let x = 0; x < W; x++) {
      if (!inside(x, z)) continue;
      const y = 15 + Math.floor(x * tan);
      const edge = x === right(z) - 1 || !inside(x, z - 1);
      const sheen = Math.abs(x - z * 0.5 - 4) < 1.2;
      m.set(x, y, z, edge ? HI : sheen ? 0x2a2a32 : BK);
      if (x > 0 && Math.floor((x - 1) * tan) !== Math.floor(x * tan)) m.set(x, y - 1, z, BK);
    }
  const sx = right(14) - 3;
  for (let y = 15; y < 15 + Math.floor(sx * tan); y++) m.set(sx, y, 14, 0x2a2a2e);
  // partie avant : joues, clavier, cylindre, pupitre et partition
  m.box(0, 8, KB, W, 11, D, BK);
  m.box(0, 8, KB, 2, 13, D, BK);
  m.box(W - 2, 8, KB, W, 13, D, BK);
  m.box(2, 11, 29, W - 2, 12, D - 1, 0xf2f0ea);
  for (let x = 2; x < W - 2; x++) {
    const k = (x - 2) % 7;
    if (k === 0 || k === 1 || k === 3 || k === 4 || k === 5) m.box(x, 12, 29, x + 1, 13, 31, 0x111111);
  }
  m.box(2, 11, D - 1, W - 2, 12, D, BK);
  m.box(2, 11, KB, W - 2, 15, 29, BK);
  m.box(2, 14, KB, W - 2, 15, 29, HI);
  m.box(4, 15, KB + 1, W - 4, 18, KB + 2, BK);
  m.box(8, 15, KB + 1, 16, 18, KB + 2, 0xf4f0e4);
  m.box(9, 16, KB + 1, 15, 17, KB + 2, 0x6a6a6a);
  // pieds tournés à roulettes dorées, lyre et pédales
  for (const [x, z] of [
    [1, D - 4],
    [W - 3, D - 4],
    [3, 3],
  ]) {
    m.box(x, 1, z, x + 2, 8, z + 2, BK);
    m.box(x, 6, z, x + 2, 7, z + 2, HI);
    m.box(x, 0, z, x + 2, 1, z + 2, K.gold);
  }
  m.box(10, 1, KB + 2, 14, 8, KB + 3, BK);
  m.box(11, 2, KB + 2, 13, 7, KB + 3, -1);
  m.box(11, 3, KB + 2, 12, 6, KB + 3, K.gold);
  m.box(9, 0, KB + 1, 15, 1, KB + 4, BK);
  for (const x of [10, 12, 14]) m.box(x, 1, KB + 4, x + 1, 2, KB + 6, K.gold);
  return m;
}

/** Piano droit : 0 laque noire, métronome ; 1 vieux noyer rayé, touche manquante, verre de bière. */
function makePiano(v: number): VoxelModel {
  const m = new VoxelModel(25, 23, 10, 1 / 16); // 1,56 × 1,3 (+ objets) × 0,63
  const W = m.sx;
  const C = v === 0 ? 0x0c0c0e : 0x5a3820;
  const Cl = v === 0 ? 0x34343a : 0x7a5232;
  // caisse, joues, socle
  m.box(0, 0, 0, W, 21, 6, C);
  m.box(0, 0, 6, 2, 13, 10, C);
  m.box(W - 2, 0, 6, W, 13, 10, C);
  m.box(0, 0, 6, W, 2, 7, C);
  m.box(0, 20, 0, W, 21, 7, Cl);
  // panneau supérieur mouluré, pupitre et partition
  m.box(3, 14, 6, W - 3, 15, 7, Cl);
  m.box(3, 19, 6, W - 3, 20, 7, Cl);
  m.box(8, 14, 7, 17, 17, 8, C);
  m.box(9, 15, 8, 16, 17, 9, 0xf2ecd8);
  m.box(10, 16, 8, 15, 17, 9, 0x5a5a5a);
  // clavier
  m.box(2, 10, 6, W - 2, 11, 10, C);
  m.box(2, 11, 6, W - 2, 12, 9, 0xf0ece0);
  for (let x = 2; x < W - 2; x++) {
    const k = (x - 2) % 7;
    if (k === 0 || k === 1 || k === 3 || k === 4 || k === 5) m.box(x, 12, 6, x + 1, 13, 8, 0x121212);
  }
  m.box(2, 12, 6, W - 2, 14, 7, C);
  m.box(11, 13, 6, 14, 14, 7, K.gold);
  // pédales
  for (const x of [10, 12, 14]) m.box(x, 1, 6, x + 1, 2, 8, K.gold);
  if (v === 0) {
    // métronome et vase
    m.box(4, 21, 2, 7, 22, 5, 0x2a1a10);
    m.box(5, 22, 3, 6, 23, 4, 0x2a1a10);
    m.set(5, 22, 4, K.gold);
    m.box(17, 21, 2, 19, 23, 4, 0xe8e4dc);
    m.set(17, 22, 2, 0xc02040);
  } else {
    // rayures, touche manquante, brûlure, verre de bière
    m.set(9, 11, 8, 0x3a2a1a).set(9, 11, 7, 0x3a2a1a);
    for (const [x, y] of [
      [4, 6],
      [5, 7],
      [6, 8],
      [19, 4],
      [20, 5],
    ])
      m.set(x, y, 5, 0x8a6a4a);
    m.box(15, 21, 2, 16, 23, 3, 0xc88a2a);
    m.set(15, 23, 2, 0xf0ece0);
    stain(m, 6, 20.5, 3, 1.6, (c) => shade(c, 0.7), 211);
  }
  return m;
}

/** Cheminée bioéthanol (1/32 m) : bloc de marbre veiné, foyer linéaire, flammes à base bleue sur galets blancs, filet doré, objets sur le manteau. */
function makeFireplace(v: number): VoxelModel {
  const m = new VoxelModel(58, 36, 15, R32); // 1,81 × 1,0 (+ objets) × 0,47
  const W = m.sx;
  const body = v === 0 ? 0xeeebe4 : 0x1c1b1d;
  const vein = v === 0 ? 0xc6c2ba : 0x56524e;
  const trim = v === 0 ? K.gold : K.chrome;
  m.box(0, 0, 0, W, 30, 14, body);
  // veines diagonales sur la façade et le dessus
  const r = rng(221 + v);
  for (let i = 0; i < 5; i++) {
    let x = r() * W;
    const slope = 0.6 + r() * 0.8;
    for (let y = 29; y >= 0; y--) {
      x += slope * (r() < 0.5 ? 1 : 0.4);
      const xi = Math.floor(x) % W;
      m.set(xi, y, 13, i === 2 ? (v === 0 ? 0xd8b868 : K.goldDark) : vein);
    }
  }
  // manteau en saillie
  m.box(0, 30, 0, W, 32, 15, body);
  m.box(0, 30, 14, W, 31, 15, trim);
  // foyer : ouverture, intérieur noir, filet métallique
  const fx0 = 6;
  const fx1 = W - 6;
  const fy0 = 8;
  const fy1 = 20;
  m.box(fx0, fy0, 3, fx1, fy1, 14, -1);
  m.box(fx0, fy0, 2, fx1, fy1, 3, 0x0e0e0e);
  m.box(fx0 - 1, fy0 - 1, 13, fx1 + 1, fy0, 14, trim);
  m.box(fx0 - 1, fy1, 13, fx1 + 1, fy1 + 1, 14, trim);
  m.box(fx0 - 1, fy0, 13, fx0, fy1, 14, trim);
  m.box(fx1, fy0, 13, fx1 + 1, fy1, 14, trim);
  // bac du brûleur garni de galets blancs et de cristaux
  m.box(fx0, fy0, 3, fx1, fy0 + 1, 14, 0x2a2a2e);
  for (let x = fx0 + 1; x < fx1 - 1; x++)
    for (let z = 5; z < 12; z++) if (h3(x, 0, z, 222) < 0.55) m.set(x, fy0 + 1, z, h3(x, 1, z, 223) < 0.25 ? 0xd0e8f0 : h3(x, 2, z, 224) < 0.5 ? 0xe8e8e4 : 0xc8c8c4);
  // flammes : base bleue, langues orangées de hauteurs variables
  m.box(fx0 + 3, fy0 + 1, 8, fx1 - 3, fy0 + 2, 10, SLOT.NEON_BLUE);
  let x = fx0 + 3;
  let k = 0;
  while (x < fx1 - 4) {
    // langue de flamme : 2 à 3 cases de large, pointe effilée, hauteur variable
    const w = 2 + (k % 2);
    const h = 4 + Math.floor(h3(k, 3, 0, 225) * 6);
    const z0 = 8 + (k % 3 === 0 ? 1 : 0);
    for (let i = 0; i < w; i++) {
      const hh = i === 0 || i === w - 1 ? h - 2 : h;
      m.box(x + i, fy0 + 2, z0, x + i + 1, fy0 + 2 + hh, z0 + 1, SLOT.FIRE);
    }
    m.set(x + Math.floor(w / 2), fy0 + 2 + h, z0, SLOT.FIRE);
    x += w + 1 + (h3(k, 5, 0, 226) < 0.4 ? 1 : 0);
    k++;
  }
  // objets sur le manteau : sculpture dorée, bougies, livre d'art
  m.box(8, 32, 5, 12, 33, 9, 0x1a1a1a);
  m.box(9, 33, 6, 11, 36, 8, K.gold);
  m.box(10, 34, 6, 12, 35, 8, K.goldLight);
  for (const x of [44, 47]) {
    m.box(x, 32, 6, x + 2, 34 + (x === 44 ? 1 : 0), 8, 0xf2ecdc);
    m.set(x, 34 + (x === 44 ? 1 : 0), 6, SLOT.GLOW);
  }
  m.box(26, 32, 4, 34, 33, 10, 0x2a3a5a);
  m.box(27, 33, 5, 33, 34, 9, 0x8a1a1a);
  return m;
}

/** Vitrine à trophées (1/32 m) : coupes et statuettes dorées, disque d'or, ceinture de champion, revolver doré ; fond et filets aux couleurs du propriétaire, LED. */
function makeTrophyCase(): VoxelModel {
  const m = new VoxelModel(45, 64, 16, R32); // 1,41 × 2,0 × 0,5
  const W = m.sx;
  const D = m.sz;
  const BK = 0x111113;
  const G = K.gold;
  const Gl = K.goldLight;
  const Gd = K.goldDark;
  // meuble bas, montants, corniche, fond de velours
  m.box(0, 0, 0, W, 18, D, BK);
  m.box(1, 1, D - 1, W - 1, 17, D, 0x1a1a1e);
  m.box(22, 1, D - 1, 23, 17, D, BK);
  for (const x of [19, 25]) m.box(x, 8, D - 1, x + 1, 12, D, SLOT.TINT2);
  m.box(0, 17, 0, W, 18, D, SLOT.TINT2);
  for (const [x, z] of [
    [0, 0],
    [W - 2, 0],
    [0, D - 2],
    [W - 2, D - 2],
  ])
    m.box(x, 18, z, x + 2, 60, z + 2, BK);
  m.box(0, 60, 0, W, 64, D, BK);
  m.box(0, 60, D - 1, W, 61, D, SLOT.TINT2);
  m.box(0, 63, D - 1, W, 64, D, SLOT.TINT2);
  m.box(2, 18, 0, W - 2, 60, 1, SLOT.TINT3);
  m.box(2, 18, 0, 3, 60, D - 2, 0x1c1c22);
  m.box(W - 3, 18, 0, W - 2, 60, D - 2, 0x1c1c22);
  // tablettes de verre, bandeaux LED
  for (const y of [32, 46]) {
    m.box(2, y, 1, W - 2, y + 1, D - 1, 0xc4d8e0);
    m.box(2, y, D - 2, W - 2, y + 1, D - 1, SLOT.TINT2);
    m.box(3, y - 1, D - 3, W - 3, y, D - 2, SLOT.LED);
  }
  m.box(3, 59, D - 3, W - 3, 60, D - 2, SLOT.LED);
  // grande coupe à anses (tablette basse)
  const cup = (cx: number, y: number, s: number) => {
    m.box(cx - 2 * s, y, 6, cx + 2 * s + 1, y + s, 11, 0x1a1a1a);
    m.box(cx - s, y + s, 7, cx + s + 1, y + s + 1, 10, Gd);
    m.box(cx, y + s + 1, 8, cx + 1, y + 3 * s, 9, G);
    for (let k = 0; k < 3 * s + 1; k++) {
      const rr = s + 1 + Math.round(Math.sin((k / (3 * s)) * Math.PI * 0.6) * s);
      m.box(cx - rr, y + 3 * s + k, 8 - Math.floor(rr / 2), cx + rr + 1, y + 3 * s + k + 1, 9 + Math.floor(rr / 2), k === 3 * s ? Gl : G);
    }
    const hy = y + 4 * s;
    for (const sd of [-1, 1]) {
      m.box(cx + sd * (2 * s + 2), hy, 8, cx + sd * (2 * s + 2) + 1, hy + 2 * s, 9, G);
      m.set(cx + sd * (2 * s + 1), hy, 8, G).set(cx + sd * (2 * s + 1), hy + 2 * s - 1, 8, G);
    }
  };
  cup(22, 19, 2);
  cup(9, 19, 1);
  cup(35, 19, 1);
  // statuette dorée, disque d'or encadré, médaille sur ruban (tablette du milieu)
  m.box(7, 33, 6, 13, 35, 11, 0x1a1a1a);
  m.box(8, 35, 7, 12, 36, 10, Gd);
  // personnage doré bras levés tenant une étoile
  m.box(9, 36, 8, 10, 40, 9, G);
  m.box(10, 36, 8, 11, 40, 9, G);
  m.box(8, 40, 8, 12, 43, 9, G);
  m.box(9, 43, 8, 11, 45, 9, Gl);
  m.set(7, 43, 8, G).set(12, 43, 8, G).set(7, 44, 8, G).set(12, 44, 8, G);
  m.box(9, 45, 8, 11, 46, 9, Gl);
  m.box(17, 33, 3, 29, 45, 4, 0x0e0e10);
  discXY(m, 23, 39, 5, 4, 5, (dx, dy, d) => (d < 1.2 ? 0x1a1a1a : d < 1.8 ? Gl : (Math.round(d) % 2 ? G : Gd)));
  m.box(34, 38, 6, 36, 45, 7, SLOT.TINT1);
  discXY(m, 35, 36, 2.2, 6, 7, G);
  m.set(35, 36, 7, Gl);
  // ceinture de champion et revolver doré (tablette haute)
  m.box(5, 47, 7, 22, 49, 10, 0x1a1a1a);
  m.box(4, 49, 8, 23, 52, 9, SLOT.TINT1);
  m.box(9, 48, 8, 18, 54, 10, G);
  m.box(11, 50, 9, 16, 52, 10, Gl);
  for (const x of [6, 20]) m.box(x, 50, 8, x + 2, 52, 9, G);
  m.box(28, 47, 6, 40, 48, 11, 0x1a1a1a);
  m.box(29, 50, 8, 39, 52, 9, G);
  m.box(29, 52, 8, 35, 53, 9, G);
  m.box(36, 48, 8, 38, 52, 9, Gd);
  m.box(33, 48, 8, 35, 50, 9, G);
  m.set(39, 52, 8, Gl).set(30, 53, 8, Gl);
  return m;
}

/** Buste de marbre (1/32 m) sur colonne de marbre noir cannelée cerclée d'or : tête romaine, cheveux bouclés, couronne de laurier dorée. */
function makeStatueBust(): VoxelModel {
  const m = new VoxelModel(19, 52, 19, R32); // 0,59 × 1,63 × 0,59
  const c = 9.5;
  const MB = 0x1c1b1e;
  const MW = 0xebe8e1;
  const MS = 0xd2cec6;
  // colonne : socle, fût cannelé, chapiteau, filets dorés
  m.box(1, 0, 1, 18, 3, 18, MB);
  m.box(2, 3, 2, 17, 4, 17, K.gold);
  m.box(4, 4, 4, 15, 30, 15, MB);
  for (let k = 5; k < 15; k += 2) {
    m.box(k, 5, 4, k + 1, 29, 5, 0x2c2a2e);
    m.box(k, 5, 14, k + 1, 29, 15, 0x2c2a2e);
    m.box(4, 5, k, 5, 29, k + 1, 0x2c2a2e);
    m.box(14, 5, k, 15, 29, k + 1, 0x2c2a2e);
  }
  m.box(3, 29, 3, 16, 30, 16, K.gold);
  m.box(2, 30, 2, 17, 33, 17, MB);
  // piédouche et buste drapé
  m.cylY(c, c, 3.6, 33, 35, MW);
  m.cylY(c, c, 2.6, 35, 36, MS);
  for (let y = 36; y < 43; y++) {
    const t = (y - 36) / 7;
    const rx = 4.5 + Math.sin(t * Math.PI * 0.75) * 3.5;
    const rz = 2.6 + Math.sin(t * Math.PI * 0.7) * 1.6;
    ellXZ(m, c, c, rx, rz, y, y + 1, MW);
  }
  // pli de toge en diagonale
  for (let y = 36; y < 43; y++) {
    const x = Math.floor(5 + (y - 36) * 1.2);
    m.set(x, y, 13, MS).set(x + 1, y, 13, MS);
    m.set(x, y, 12, MS);
  }
  // cou et tête
  m.cylY(c, c, 2.4, 41, 45, MW);
  m.ellipsoid(c, 46.8, c + 0.4, 4, 4.6, 4.2, MW);
  // visage : arcade sourcilière, orbites, nez droit, bouche, menton, oreilles
  const fz = 13;
  m.box(6, 48, fz, 13, 49, fz + 1, MW);
  m.box(7, 47, fz, 9, 48, fz + 1, MS);
  m.box(10, 47, fz, 12, 48, fz + 1, MS);
  m.set(7, 47, fz - 1, 0xb8b4ac).set(11, 47, fz - 1, 0xb8b4ac);
  m.box(9, 44, fz, 10, 48, fz + 2, MW);
  m.set(9, 44, fz + 1, MS);
  m.box(8, 43, fz, 11, 44, fz + 1, MS);
  m.box(8, 42, fz - 1, 11, 43, fz + 1, MW);
  m.box(5, 46, 9, 6, 48, 11, MW);
  m.box(13, 46, 9, 14, 48, 11, MW);
  // chevelure bouclée (dessus et nuque)
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * Math.PI * 2;
    m.sphere(c + Math.cos(a) * 3.4, 49.6 + (k % 2) * 0.8, c + 0.2 + Math.sin(a) * 3.4, 1.3, k % 3 ? MW : MS);
  }
  m.ellipsoid(c, 47, c - 2, 3.6, 3.6, 2, MS);
  m.sphere(c, 51, c, 2, MW);
  // couronne de laurier dorée
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    if (a > 1.15 && a < 2.0) continue;
    m.set(c + Math.cos(a) * 4.3, 49, c + 0.4 + Math.sin(a) * 4.5, k % 2 ? K.gold : K.goldLight);
    if (k % 2 === 0) m.set(c + Math.cos(a) * 4.5, 50, c + 0.4 + Math.sin(a) * 4.7, K.gold);
  }
  return m;
}

// =========================================================================== registre

export const HOME_MODELS: Partial<Record<PropKind, PropModelEntry>> = {
  SOFA: { variants: 5, make: makeSofa },
  SOFA_LUXE: { variants: 5, make: makeSofaLuxe },
  SOFA_OLD: { variants: 3, make: makeSofaOld },
  ARMCHAIR: { variants: 3, make: makeArmchair },
  COFFEE_TABLE: { variants: 3, make: makeCoffeeTable },
  TV_WALL: { variants: 1, make: makeTvWall },
  TV_OLD: { variants: 1, make: makeTvOld },
  TV_STAND: { variants: 2, make: makeTvStand },
  BED: { variants: 3, make: makeBed },
  BED_KING: { variants: 3, make: makeBedKing },
  MATTRESS: { variants: 1, make: makeMattress },
  NIGHTSTAND: { variants: 2, make: makeNightstand },
  WARDROBE: { variants: 1, make: makeWardrobe },
  DINING_TABLE: { variants: 3, make: makeDiningTable },
  TABLE_SMALL: { variants: 3, make: makeTableSmall },
  FOLDING_TABLE: { variants: 1, make: makeFoldingTable },
  CHAIR: { variants: 6, make: makeChair },
  CHAIR_PLASTIC: { variants: 2, make: makeChairPlastic },
  KITCHEN_COUNTER: { variants: 3, make: makeKitchenCounter },
  KITCHEN_ISLAND: { variants: 1, make: makeKitchenIsland },
  KITCHENETTE: { variants: 1, make: makeKitchenette },
  FRIDGE: { variants: 2, make: makeFridge },
  BAR_COUNTER: { variants: 3, make: makeBarCounter },
  BAR_STOOL: { variants: 2, make: makeBarStool },
  BOTTLE_SHELF: { variants: 1, make: makeBottleShelf },
  PLANT_BIG: { variants: 3, make: makePlantBig },
  LAMP_FLOOR: { variants: 1, make: makeLampFloor },
  CEILING_LIGHT: { variants: 1, make: makeCeilingLight },
  PENDANT_LIGHT: { variants: 1, make: makePendantLight },
  BARE_BULB: { variants: 1, make: makeBareBulb },
  NEON_TUBE_CEILING: { variants: 1, make: makeNeonTube },
  CHANDELIER: { variants: 1, make: makeChandelier },
  WALL_ART: { variants: 8, make: makeWallArt },
  NEON_ART: { variants: 8, make: makeNeonArt },
  PORTRAIT_BOSS: { variants: 3, make: makePortrait },
  AQUARIUM: { variants: 1, make: makeAquarium },
  GRAND_PIANO: { variants: 1, make: makeGrandPiano },
  PIANO: { variants: 2, make: makePiano },
  FIREPLACE: { variants: 2, make: makeFireplace },
  TROPHY_CASE: { variants: 1, make: makeTrophyCase },
  STATUE_BUST: { variants: 1, make: makeStatueBust },
};

void R32;
void line6;
void discXY;
void rbox;
void pixXY;
void pixXZ;
void rng;
