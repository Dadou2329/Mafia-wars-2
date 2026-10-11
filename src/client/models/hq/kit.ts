// Outils des modèles des équipements du QG et des cliniques (résolution 1/16 m, l'avant regarde
// vers +Z). Les modèles muraux ont le dos contre le mur : leur origine est le milieu du dos (z = 0).

import { SLOT, VoxelModel, shade } from '../voxelModel';

export { SLOT, VoxelModel, shade };
export type M = VoxelModel;

/** Voxels par mètre. */
export const V = 16;

/** Palette (sRGB) dans l'esprit des accessoires de la ville. */
export const K = {
  black: 0x111215,
  carbon: 0x1b1d21,
  gunDk: 0x23262c,
  gun: 0x2f343b,
  gunLt: 0x48505a,
  steel: 0x6b737d,
  steelLt: 0x959ea8,
  alu: 0xb4bbc3,
  chrome: 0xc8d0d8,
  chromeHi: 0xe6ebf0,
  white: 0xe6e8ea,
  plastW: 0xd2d6da,
  plastG: 0x8c9198,
  rubber: 0x1a1a1c,
  gold: 0xd4a640,
  goldLt: 0xf0cf74,
  goldDk: 0x9a7224,
  bronze: 0x8a6a34,
  marbleBlk: 0x1e1d1f,
  walnut: 0x4a2f1d,
  walnutDk: 0x34200f,
  yellow: 0xe2b21c,
  yellowDk: 0xa8800e,
  red: 0xb02026,
  teal: 0x1f8f8a,
  tealDk: 0x14615e,
  concrete: 0x55575a,
  concreteDk: 0x3c3e41,
  glassDk: 0x0c1418,
};

/** Modèle aux dimensions données (m), origine au milieu du dos (z = 0) ou au centre de la base. */
export function mk(w: number, h: number, d: number, origin: 'back' | 'center' = 'back'): M {
  const m = VoxelModel.meters(w, h, d);
  if (origin === 'back') m.setOrigin(m.sx / 2, 0, 0);
  return m;
}

/** Boîte aux arêtes verticales abattues (chanfrein de k voxels). */
export function cbox(m: M, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number, k = 1): M {
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

/** Repeint les cases pleines d'une boîte. */
export function paint(m: M, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): M {
  for (let y = Math.max(0, y0); y < Math.min(m.sy, y1); y++)
    for (let z = Math.max(0, z0); z < Math.min(m.sz, z1); z++)
      for (let x = Math.max(0, x0); x < Math.min(m.sx, x1); x++) if (m.get(x, y, z) >= 0) m.set(x, y, z, c);
  return m;
}

/** Ligne de voxels sans trous diagonaux. */
export function line6(m: M, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number, thick = 0): M {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 1) * 2;
  let px = Math.floor(x0);
  let py = Math.floor(y0);
  let pz = Math.floor(z0);
  const put = (x: number, y: number, z: number) => (thick ? m.box(x - thick, y - thick, z - thick, x + thick + 1, y + thick + 1, z + thick + 1, c) : m.set(x, y, z, c));
  put(px, py, pz);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = Math.floor(x0 + (x1 - x0) * t);
    const y = Math.floor(y0 + (y1 - y0) * t);
    const z = Math.floor(z0 + (z1 - z0) * t);
    while (px !== x || py !== y || pz !== z) {
      if (px !== x) px += Math.sign(x - px);
      else if (py !== y) py += Math.sign(y - py);
      else pz += Math.sign(z - pz);
      put(px, py, pz);
    }
  }
  return m;
}

/** Disque (ou anneau) horizontal, entre y0 et y1 ; c(dx, dz, d) = −2 : rien. */
export function discXZ(m: M, cx: number, cz: number, r: number, y0: number, y1: number, c: number | ((dx: number, dz: number, d: number) => number)): M {
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

/** Disque (ou anneau) vertical face à +Z, entre z0 et z1. */
export function discXY(m: M, cx: number, cy: number, r: number, z0: number, z1: number, c: number | ((dx: number, dy: number, d: number) => number)): M {
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

/** Bandes de danger diagonales sur une face (z fixe). */
export function hazardXY(m: M, x0: number, y0: number, x1: number, y1: number, z: number, a = K.yellow, b = K.black, w = 2): M {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m.set(x, y, z, Math.floor((x + y) / w) % 2 ? a : b);
  return m;
}

/** Moniteur sur la face avant : cadre en z, dalle (écran animé par le matériau) en z + 1. */
export function monitor(m: M, x0: number, y0: number, x1: number, y1: number, z: number, bezel = K.black, face: number = SLOT.SCREEN): M {
  m.box(x0, y0, z, x1, y1, z + 2, bezel);
  m.box(x0 + 1, y0 + 1, z + 1, x1 - 1, y1 - 1, z + 2, face);
  return m;
}

/** Police 3 × 5 des inscriptions. */
const FONT: Record<string, string[]> = {
  A: ['.k.', 'k.k', 'kkk', 'k.k', 'k.k'],
  B: ['kk.', 'k.k', 'kk.', 'k.k', 'kk.'],
  C: ['.kk', 'k..', 'k..', 'k..', '.kk'],
  D: ['kk.', 'k.k', 'k.k', 'k.k', 'kk.'],
  E: ['kkk', 'k..', 'kk.', 'k..', 'kkk'],
  É: ['.k.', 'kkk', 'kk.', 'k..', 'kkk'],
  F: ['kkk', 'k..', 'kk.', 'k..', 'k..'],
  G: ['.kk', 'k..', 'k.k', 'k.k', '.kk'],
  H: ['k.k', 'k.k', 'kkk', 'k.k', 'k.k'],
  I: ['k', 'k', 'k', 'k', 'k'],
  L: ['k..', 'k..', 'k..', 'k..', 'kkk'],
  M: ['k...k', 'kk.kk', 'k.k.k', 'k...k', 'k...k'],
  N: ['k..k', 'kk.k', 'k.kk', 'k..k', 'k..k'],
  O: ['.k.', 'k.k', 'k.k', 'k.k', '.k.'],
  P: ['kk.', 'k.k', 'kk.', 'k..', 'k..'],
  Q: ['.k.', 'k.k', 'k.k', 'kk.', '.kk'],
  R: ['kk.', 'k.k', 'kk.', 'k.k', 'k.k'],
  S: ['.kk', 'k..', '.k.', '..k', 'kk.'],
  T: ['kkk', '.k.', '.k.', '.k.', '.k.'],
  U: ['k.k', 'k.k', 'k.k', 'k.k', 'kkk'],
  V: ['k.k', 'k.k', 'k.k', 'k.k', '.k.'],
  X: ['k.k', 'k.k', '.k.', 'k.k', 'k.k'],
  Y: ['k.k', 'k.k', '.k.', '.k.', '.k.'],
  '0': ['kkk', 'k.k', 'k.k', 'k.k', 'kkk'],
  '1': ['.k', 'kk', '.k', '.k', '.k'],
  '2': ['kk.', '..k', '.k.', 'k..', 'kkk'],
  '3': ['kk.', '..k', '.k.', '..k', 'kk.'],
  '4': ['k.k', 'k.k', 'kkk', '..k', '..k'],
  '5': ['kkk', 'k..', 'kk.', '..k', 'kk.'],
  '8': ['kkk', 'k.k', 'kkk', 'k.k', 'kkk'],
  '+': ['...', '.k.', 'kkk', '.k.', '...'],
  '-': ['...', '...', 'kkk', '...', '...'],
  ' ': ['.', '.', '.', '.', '.'],
};

export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += (FONT[ch] ?? FONT[' '])[0].length + 1;
  return w - 1;
}

/** Texte sur la face avant (z fixe), lu de gauche à droite depuis (x0, yTop). */
export function text(m: M, s: string, x0: number, yTop: number, z: number, col: number): number {
  let u = 0;
  for (const ch of s) {
    const g = FONT[ch] ?? FONT[' '];
    for (let r = 0; r < 5; r++) for (let k = 0; k < g[r].length; k++) if (g[r][k] === 'k') m.set(x0 + u + k, yTop - r, z, col);
    u += g[0].length + 1;
  }
  return u - 1;
}

/** Hachage déterministe → [0, 1). */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647) + Math.imul(seed | 0, 1013904223)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffff) / 65536;
}

/** Variation de teinte par voxel (aspect « peint à la main »), hors emplacements spéciaux. */
export function grit(m: M, amount = 0.06, seed = 3): M {
  return m.forEach((x, y, z, c) => {
    if (c >= 0xf00000) return;
    return shade(c, 1 + (hash3(x, y, z, seed) * 2 - 1) * amount);
  });
}

/** Positions (m, repère du modèle) des voxels d'une couleur donnée : diodes à faire clignoter. */
export function voxelsOf(m: M, color: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  m.forEach((x, y, z, c) => {
    if (c === color) out.push([(x + 0.5 - m.ox) * m.res, (y + 0.5 - m.oy) * m.res, (z + 0.5 - m.oz) * m.res]);
  });
  return out;
}
