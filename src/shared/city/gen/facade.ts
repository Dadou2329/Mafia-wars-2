// Façades de New York 2085 : fenêtres percées, devantures, murs-rideaux, piliers art déco,
// néons et enseignes. Repère local du bâtiment (voir Frame) : la façade avant est en lz = 0..2.

import { M } from '../../materials';
import type { Rng } from '../../util';
import type { Frame } from './frame';
import type { Levels } from './structure';

export type Wall = 'front' | 'back' | 'left' | 'right';

export interface Facade {
  wall: number;
  wallSide: number;
  trim: number;
  base: number;
  frame: number;
  /** Probabilité qu'une fenêtre soit éclairée la nuit. */
  lit: number;
  /** Vitrage éclairé froid (bureaux) plutôt que chaud (logements). */
  cool?: boolean;
  winW: number;
  winH: number;
  winSpacing: number;
  /** Linteaux et appuis saillants. */
  sills: boolean;
}

export const FACADE_DEFAULT: Facade = {
  wall: M.BRICK_RED,
  wallSide: M.BRICK_RED,
  trim: M.LIMESTONE,
  base: M.GRANITE,
  frame: M.FRAME_DARK,
  lit: 0.45,
  winW: 4,
  winH: 7,
  winSpacing: 9,
  sills: true,
};

/** Positions (début) des colonnes de fenêtres réparties sur une longueur. */
export function windowColumns(len: number, winW: number, spacing: number, margin = 4): number[] {
  const usable = len - margin * 2;
  if (usable < winW) return [];
  const n = Math.max(1, Math.floor((usable - winW) / spacing) + 1);
  const total = (n - 1) * spacing + winW;
  const start = Math.floor((len - total) / 2);
  const cols: number[] = [];
  for (let i = 0; i < n; i++) cols.push(start + i * spacing);
  return cols;
}

/**
 * Pose une valeur sur une face du bâtiment : `along` = position le long de la face (gauche → droite
 * vu de l'extérieur), `out` = profondeur (0 = couche extérieure du mur, −1 = devant le mur).
 */
export function wallSet(f: Frame, wall: Wall, along: number, ly: number, out: number, m: number): void {
  const { W, D } = f;
  switch (wall) {
    case 'front':
      f.set(along, ly, out, m);
      break;
    case 'back':
      f.set(W - 1 - along, ly, D - 1 - out, m);
      break;
    case 'left':
      f.set(out, ly, D - 1 - along, m);
      break;
    case 'right':
      f.set(W - 1 - out, ly, along, m);
      break;
  }
}

export function wallGet(f: Frame, wall: Wall, along: number, ly: number, out: number): number {
  const { W, D } = f;
  switch (wall) {
    case 'front':
      return f.get(along, ly, out);
    case 'back':
      return f.get(W - 1 - along, ly, D - 1 - out);
    case 'left':
      return f.get(out, ly, D - 1 - along);
    case 'right':
      return f.get(W - 1 - out, ly, along);
  }
}

export function wallLen(f: Frame, wall: Wall): number {
  return wall === 'front' || wall === 'back' ? f.W : f.D;
}

/** Fenêtre percée dans une face (mur de 2 voxels) : vitre en retrait, cadre, appui, linteau. */
export function punchWindow(f: Frame, wall: Wall, st: Facade, rng: Rng, along: number, ly: number, w: number, h: number, lit?: boolean): void {
  const on = lit ?? rng.chance(st.lit);
  const glass = on ? (st.cool ? M.GLASS_COOL : M.GLASS_LIT) : M.GLASS;
  for (let i = 0; i < w; i++)
    for (let j = 0; j < h; j++) {
      wallSet(f, wall, along + i, ly + j, 0, 0);
      wallSet(f, wall, along + i, ly + j, 1, glass);
    }
  // meneau central pour les larges baies
  if (w >= 6) for (let j = 0; j < h; j++) wallSet(f, wall, along + Math.floor(w / 2), ly + j, 1, st.frame);
  if (h >= 7) for (let i = 0; i < w; i++) wallSet(f, wall, along + i, ly + Math.floor(h * 0.62), 1, st.frame);
  if (st.sills) {
    for (let i = -1; i <= w; i++) {
      wallSet(f, wall, along + i, ly - 1, -1, st.trim);
      wallSet(f, wall, along + i, ly + h, -1, st.trim);
      wallSet(f, wall, along + i, ly + h, 0, st.trim);
    }
  }
}

/** Rangée de fenêtres d'un étage sur une face. */
export function windowRow(f: Frame, wall: Wall, st: Facade, rng: Rng, ly: number, h: number, skip?: (along: number) => boolean, margin = 4): void {
  const len = wallLen(f, wall);
  for (const c of windowColumns(len, st.winW, st.winSpacing, margin)) {
    if (skip && skip(c)) continue;
    punchWindow(f, wall, st, rng, c, ly, st.winW, h);
  }
}

/** Remplace la couche extérieure d'une face par un matériau (bandeau, mur-rideau…) entre ly0 et ly1. */
export function cladFace(f: Frame, wall: Wall, ly0: number, ly1: number, mat: number, a0 = 0, a1 = -1): void {
  const len = wallLen(f, wall);
  const e = a1 < 0 ? len : a1;
  for (let a = a0; a < e; a++)
    for (let y = ly0; y < ly1; y++) {
      const cur = wallGet(f, wall, a, y, 0);
      if (cur !== 0) wallSet(f, wall, a, y, 0, mat);
    }
}

/** Bandeau horizontal en saillie sur toutes les faces exposées. */
export function band(f: Frame, walls: Wall[], ly: number, mat: number, h = 1): void {
  for (const w of walls) {
    const len = wallLen(f, w);
    for (let a = -1; a <= len; a++) for (let y = ly; y < ly + h; y++) wallSet(f, w, a, y, -1, mat);
  }
}

/** Piliers verticaux saillants (art déco) entre les colonnes de fenêtres. */
export function piers(f: Frame, wall: Wall, st: Facade, ly0: number, ly1: number, mat: number): void {
  const len = wallLen(f, wall);
  const cols = windowColumns(len, st.winW, st.winSpacing, 4);
  const xs = new Set<number>([0, len - 2]);
  for (let i = 0; i + 1 < cols.length; i++) xs.add(Math.round((cols[i] + st.winW + cols[i + 1]) / 2) - 1);
  for (const x of xs)
    for (let y = ly0; y < ly1; y++) {
      wallSet(f, wall, x, y, -1, mat);
      wallSet(f, wall, x + 1, y, -1, mat);
    }
}

/** Devanture vitrée au rez-de-chaussée d'une face : vitrines, porte, bandeau d'enseigne, auvent. */
export function storefront(
  f: Frame,
  lv: Levels,
  doorLx: number,
  doorW: number,
  opts: { frame: number; band: number; glass?: number; awning?: number; neon?: number; height?: number },
): { signY: number } {
  const { W } = f;
  const y0 = lv.floorTop;
  const top = Math.min(lv.ceil - 2, y0 + (opts.height ?? 12));
  const glass = opts.glass ?? M.GLASS_SHOP;
  // vitrines : on remplace le mur par du verre encadré de métal
  for (let lx = 3; lx < W - 3; lx++) {
    if (lx >= doorLx - 1 && lx < doorLx + doorW + 1) continue;
    f.fill(lx, y0 + 2, 0, lx + 1, top - 1, 1, 0);
    f.fill(lx, y0 + 2, 1, lx + 1, top - 1, 2, glass);
  }
  for (let lx = 3; lx < W - 3; lx += 7) {
    if (lx >= doorLx - 1 && lx < doorLx + doorW + 1) continue;
    f.fill(lx, y0 + 2, 0, lx + 1, top - 1, 2, opts.frame);
  }
  // soubassement et cadres
  f.fill(2, y0, 0, W - 2, y0 + 2, 1, opts.frame);
  f.fill(2, top - 1, 0, W - 2, top, 1, opts.frame);
  f.fill(1, y0, -1, 3, top + 4, 0, opts.frame);
  f.fill(W - 3, y0, -1, W - 1, top + 4, 0, opts.frame);
  // bandeau d'enseigne (le texte est dessiné par le client)
  f.fill(2, top, -1, W - 2, top + 4, 0, opts.band);
  f.fill(2, top + 4, -2, W - 2, top + 5, 0, opts.frame);
  if (opts.neon) {
    f.fill(2, top - 1, -1, W - 2, top, 0, opts.neon);
    f.fill(2, top + 5, -2, W - 2, top + 6, -1, opts.neon);
  }
  if (opts.awning) {
    for (let i = 0; i < 4; i++) f.fill(3, top - 1 - i, -1 - i, W - 3, top - i, -i, opts.awning);
  }
  return { signY: top + 2 };
}

/** Porte d'entrée : ouverture, seuil, encadrement. Renvoie le centre local lx. */
export function entrance(f: Frame, lv: Levels, lx: number, w: number, h: number, frame: number, threshold: number, canopy?: number): number {
  const y0 = lv.floorTop;
  f.fill(lx, y0, 0, lx + w, y0 + h, 2, 0);
  f.fill(lx, y0 - 1, 0, lx + w, y0, 2, threshold);
  f.fill(lx - 1, y0, -1, lx, y0 + h + 1, 0, frame);
  f.fill(lx + w, y0, -1, lx + w + 1, y0 + h + 1, 0, frame);
  f.fill(lx - 1, y0 + h, -1, lx + w + 1, y0 + h + 1, 0, frame);
  if (canopy) {
    f.fill(lx - 3, y0 + h + 2, -6, lx + w + 3, y0 + h + 3, 0, canopy);
    f.fill(lx - 3, y0 + h + 1, -6, lx + w + 3, y0 + h + 2, -5, M.LED_WHITE);
  }
  return lx + w / 2;
}

/** Bloc creux (murs de 2 voxels) sur un rectangle local, entre ly0 et ly1 ; toit plein en option. */
export function hollowBlock(f: Frame, x0: number, z0: number, x1: number, z1: number, ly0: number, ly1: number, wall: number, roof?: number): void {
  f.fill(x0, ly0, z0, x1, ly1, z0 + 2, wall);
  f.fill(x0, ly0, z1 - 2, x1, ly1, z1, wall);
  f.fill(x0, ly0, z0, x0 + 2, ly1, z1, wall);
  f.fill(x1 - 2, ly0, z0, x1, ly1, z1, wall);
  if (roof !== undefined) f.fill(x0, ly1 - 2, z0, x1, ly1, z1, roof);
}

/**
 * Habille de mur-rideau (vitrage de bureaux éclairés la nuit) toutes les faces d'un bloc entre
 * ly0 et ly1, avec un bandeau de dalle tous les 14 voxels.
 */
export function curtainBlock(f: Frame, x0: number, z0: number, x1: number, z1: number, ly0: number, ly1: number, curtain: number, slab: number): void {
  for (let y = ly0; y < ly1; y++) {
    const m = (y - ly0) % 14 === 13 ? slab : curtain;
    f.fill(x0, y, z0, x1, y + 1, z0 + 1, m);
    f.fill(x0, y, z1 - 1, x1, y + 1, z1, m);
    f.fill(x0, y, z0, x0 + 1, y + 1, z1, m);
    f.fill(x1 - 1, y, z0, x1, y + 1, z1, m);
  }
}

/** Liseré lumineux (LED / néon) sur le pourtour d'un bloc à une hauteur donnée. */
export function ledRing(f: Frame, x0: number, z0: number, x1: number, z1: number, ly: number, mat: number): void {
  f.fill(x0 - 1, ly, z0 - 1, x1 + 1, ly + 1, z0, mat);
  f.fill(x0 - 1, ly, z1, x1 + 1, ly + 1, z1 + 1, mat);
  f.fill(x0 - 1, ly, z0 - 1, x0, ly + 1, z1 + 1, mat);
  f.fill(x1, ly, z0 - 1, x1 + 1, ly + 1, z1 + 1, mat);
}

/** Choix déterministe dans une liste. */
export function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[rng.int(0, list.length - 1)];
}
