// Coque extérieure des bâtiments : murs, fenêtres, portes, devantures, corniches, toits.
// Tout est exprimé dans le repère local du bâtiment (voir Frame).

import { M } from '../../materials';
import { Rng } from '../../util';
import { Frame } from './frame';

export type RoofType = 'gable' | 'gableSide' | 'hip' | 'mansard' | 'flat' | 'sawtooth';
export type GroundFront = 'shop' | 'pub' | 'plain' | 'grand' | 'industrial' | 'church';

export interface Style {
  wall: number;
  wallSide: number;
  trim: number;
  base: number;
  roof: number;
  roofType: RoofType;
  roofMaxH: number; // hauteur max du toit (voxels)
  ground: GroundFront;
  paint: number; // devanture
  paint2: number; // filets / pilastres
  awning: number | 0;
  winW: number;
  winH: number;
  winSpacing: number;
  frame: number;
  litChance: number;
  cornice: boolean;
  stringCourse: boolean;
  quoins: boolean;
  chimneys: number;
  doorW: number;
  doorH: number;
  raised: number; // 0 ou 2 voxels
  arched: boolean; // fenêtres cintrées
  sideWindows: boolean;
  shutters?: number | 0;
  balcony?: boolean;
  /** Décalage de la porte par rapport au centre (fraction de la largeur, -0.5..0.5). */
  doorShift: number;
}

export const DEFAULT_STYLE: Style = {
  wall: M.BRICK_BROWN,
  wallSide: M.BRICK_BROWN,
  trim: M.STONE,
  base: M.STONE_DARK,
  roof: M.SLATE,
  roofType: 'gable',
  roofMaxH: 14,
  ground: 'plain',
  paint: M.PAINT_GREEN,
  paint2: M.GOLD,
  awning: 0,
  winW: 4,
  winH: 7,
  winSpacing: 11,
  frame: M.FRAME_WHITE,
  litChance: 0.45,
  cornice: true,
  stringCourse: true,
  quoins: false,
  chimneys: 2,
  doorW: 6,
  doorH: 10,
  raised: 0,
  arched: false,
  sideWindows: true,
  shutters: 0,
  doorShift: 0,
};

/** Dimensions verticales communes (voxels, repère local ly). */
export interface Levels {
  floorTop: number; // première couche d'air du rez-de-chaussée
  ceil: number; // première couche du plafond (2 voxels d'épaisseur)
  storyBase: number[]; // base de chaque étage (index 0 = rez-de-chaussée)
  wallTop: number; // première couche au-dessus des murs
}

export function computeLevels(stories: number, raised: number, groundClear = 15, storyH = 14): Levels {
  const floorTop = raised + 1;
  // le plafond doit commencer sur une couche paire (alignement de la grille d'éclairage)
  let ceil = floorTop + groundClear;
  if ((ceil & 1) === 1) ceil++;
  const storyBase = [floorTop];
  let y = ceil + 2;
  for (let s = 1; s < stories; s++) {
    storyBase.push(y);
    y += storyH;
  }
  return { floorTop, ceil, storyBase, wallTop: stories > 1 ? y : ceil + 2 };
}

export interface FacadeExposure {
  front: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

/** Construit les murs pleins, planchers, plafonds et le remplissage des étages. */
export function buildMassing(f: Frame, st: Style, lv: Levels, floorMat: number, ceilMat = M.CEILING): void {
  const { W, D } = f;
  // fondations / plancher
  f.fill(0, 0, 0, W, lv.floorTop, D, st.base);
  f.fill(2, lv.floorTop - 1, 2, W - 2, lv.floorTop, D - 2, floorMat);
  // murs extérieurs (2 voxels) jusqu'au sommet
  f.fill(0, lv.floorTop, 0, W, lv.wallTop, 2, st.wall); // façade
  f.fill(0, lv.floorTop, D - 2, W, lv.wallTop, D, st.wallSide); // arrière
  f.fill(0, lv.floorTop, 0, 2, lv.wallTop, D, st.wallSide); // gauche
  f.fill(W - 2, lv.floorTop, 0, W, lv.wallTop, D, st.wallSide); // droite
  // la façade principale garde son matériau sur les angles
  f.fill(0, lv.floorTop, 0, 2, lv.wallTop, 2, st.wall);
  f.fill(W - 2, lv.floorTop, 0, W, lv.wallTop, 2, st.wall);
  // plafond du rez-de-chaussée
  f.fill(2, lv.ceil, 2, W - 2, lv.ceil + 1, D - 2, ceilMat);
  f.fill(2, lv.ceil + 1, 2, W - 2, lv.ceil + 2, D - 2, M.PLASTER);
  // étages supérieurs : volume plein (inaccessible, invisible)
  if (lv.wallTop > lv.ceil + 2) f.fill(2, lv.ceil + 2, 2, W - 2, lv.wallTop, D - 2, M.PLASTER_DIRTY);
}

/** Habillage intérieur des murs extérieurs : papier peint, lambris, cimaise. */
export function finishInteriorWalls(
  f: Frame,
  lv: Levels,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  wallpaper: number,
  wainscot: number | 0,
  dado = 4,
): void {
  // On repeint la couche de mur intérieure qui borde la pièce [x0,x1)×[z0,z1).
  const y0 = lv.floorTop;
  const y1 = lv.ceil;
  const paint = (lx: number, lz: number) => {
    for (let ly = y0; ly < y1; ly++) {
      const m = f.get(lx, ly, lz);
      if (m === 0 || m === M.GLASS || m === M.GLASS_LIT || m === M.GLASS_SHOP || m === M.GLASS_STAINED) continue;
      if (m === M.FRAME_WHITE || m === M.FRAME_DARK) continue;
      const mat = wainscot && ly < y0 + dado ? wainscot : wallpaper;
      f.set(lx, ly, lz, mat);
    }
  };
  for (let lx = x0; lx < x1; lx++) {
    paint(lx, z0 - 1);
    paint(lx, z1);
  }
  for (let lz = z0; lz < z1; lz++) {
    paint(x0 - 1, lz);
    paint(x1, lz);
  }
}

/** Positions (lx de début) des colonnes de fenêtres réparties sur une longueur. */
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
 * Perce une fenêtre dans la façade avant (lz = 0..1). (lx, ly) = coin bas-gauche de l'ouverture.
 * La fenêtre est en retrait d'un voxel, entourée d'un cadre, avec appui et linteau.
 */
export function window(f: Frame, st: Style, rng: Rng, lx: number, ly: number, w: number, h: number, lit?: boolean): void {
  const glass = lit ?? rng.chance(st.litChance) ? M.GLASS_LIT : M.GLASS;
  // ouverture
  f.fill(lx, ly, 0, lx + w, ly + h, 1, 0);
  f.fill(lx, ly, 1, lx + w, ly + h, 2, glass);
  // cintrage : on arrondit les coins supérieurs
  if (st.arched && w >= 4) {
    f.set(lx, ly + h - 1, 0, st.trim);
    f.set(lx + w - 1, ly + h - 1, 0, st.trim);
    f.fill(lx + 1, ly + h, 0, lx + w - 1, ly + h + 1, 1, 0);
    f.fill(lx + 1, ly + h, 1, lx + w - 1, ly + h + 1, 2, glass);
    // claveau
    f.set(lx + Math.floor(w / 2), ly + h + 1, -1, st.trim);
    f.fill(lx, ly + h + 1, 0, lx + w, ly + h + 2, 1, st.trim);
  } else {
    // linteau saillant
    f.fill(lx - 1, ly + h, -1, lx + w + 1, ly + h + 1, 0, st.trim);
    f.fill(lx - 1, ly + h, 0, lx + w + 1, ly + h + 1, 1, st.trim);
  }
  // montants du cadre (sur la face du mur)
  f.fill(lx - 1, ly, 0, lx, ly + h, 1, st.frame);
  f.fill(lx + w, ly, 0, lx + w + 1, ly + h, 1, st.frame);
  // traverse (fenêtre à guillotine)
  if (h >= 6) f.fill(lx, ly + Math.floor(h / 2), 1, lx + w, ly + Math.floor(h / 2) + 1, 2, st.frame);
  // appui saillant
  f.fill(lx - 1, ly - 1, -1, lx + w + 1, ly, 1, st.trim);
  // volets
  if (st.shutters) {
    f.fill(lx - 3, ly, -1, lx - 1, ly + h, 0, st.shutters);
    f.fill(lx + w + 1, ly, -1, lx + w + 3, ly + h, 0, st.shutters);
  }
}

/** Fenêtre sur un mur latéral/arrière : on tourne virtuellement le repère. */
export function windowOnWall(
  f: Frame,
  st: Style,
  rng: Rng,
  wall: 'back' | 'left' | 'right',
  along: number,
  ly: number,
  w: number,
  h: number,
): void {
  const glass = rng.chance(st.litChance) ? M.GLASS_LIT : M.GLASS;
  const { W, D } = f;
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      if (wall === 'back') {
        f.set(along + i, ly + j, D - 1, 0);
        f.set(along + i, ly + j, D - 2, glass);
      } else if (wall === 'left') {
        f.set(0, ly + j, along + i, 0);
        f.set(1, ly + j, along + i, glass);
      } else {
        f.set(W - 1, ly + j, along + i, 0);
        f.set(W - 2, ly + j, along + i, glass);
      }
    }
  }
  // appui + linteau
  for (let i = -1; i <= w; i++) {
    if (wall === 'back') {
      f.set(along + i, ly - 1, D, st.trim);
      f.set(along + i, ly + h, D - 1, st.trim);
    } else if (wall === 'left') {
      f.set(-1, ly - 1, along + i, st.trim);
      f.set(0, ly + h, along + i, st.trim);
    } else {
      f.set(W, ly - 1, along + i, st.trim);
      f.set(W - 1, ly + h, along + i, st.trim);
    }
  }
}

/** Perce une porte dans la façade avant ; renvoie le centre local lx. */
export function door(f: Frame, st: Style, lx: number, lv: Levels, fanlight = true, surround = true): number {
  const w = st.doorW;
  const h = st.doorH;
  const y0 = lv.floorTop;
  f.fill(lx, y0, 0, lx + w, y0 + h, 2, 0);
  if (fanlight && h + 3 < lv.ceil - y0) {
    f.fill(lx + 1, y0 + h, 0, lx + w - 1, y0 + h + 2, 1, 0);
    f.fill(lx + 1, y0 + h, 1, lx + w - 1, y0 + h + 2, 2, M.GLASS_LIT);
  }
  if (surround) {
    // pilastres et fronton
    f.fill(lx - 1, y0, -1, lx, y0 + h + 2, 0, st.trim);
    f.fill(lx + w, y0, -1, lx + w + 1, y0 + h + 2, 0, st.trim);
    f.fill(lx - 2, y0 + h + 2, -1, lx + w + 2, y0 + h + 3, 0, st.trim);
    f.fill(lx - 1, y0 + h + 3, -1, lx + w + 1, y0 + h + 4, 0, st.trim);
  }
  // seuil
  f.fill(lx, y0 - 1, 0, lx + w, y0, 2, st.base === M.STONE_DARK ? M.STONE_GREY : st.base);
  return lx + w / 2;
}

/** Marches devant une porte surélevée (raised voxels) sur le trottoir. */
export function steps(f: Frame, st: Style, lx: number, w: number, raised: number): void {
  for (let i = 0; i < raised; i++) {
    // marche i à la profondeur -1-i, hauteur raised-i
    f.fill(lx - 1, 0, -1 - i, lx + w + 1, raised - i + 1, -i, st.base === M.STONE_DARK ? M.STONE_GREY : st.trim);
  }
}

/** Devanture de boutique / pub au rez-de-chaussée (sur toute la largeur). */
export function shopfront(
  f: Frame,
  st: Style,
  rng: Rng,
  lv: Levels,
  doorLx: number,
  pub: boolean,
): { fasciaY: number } {
  const { W } = f;
  const y0 = lv.floorTop;
  const fasciaY = y0 + 11;
  const glass = pub ? M.GLASS_LIT : M.GLASS_SHOP;
  // on remplace le mur du rez-de-chaussée par une devanture en bois peint
  f.fill(2, y0, 0, W - 2, lv.ceil, 1, st.paint);
  // soubassement (interrompu devant la porte)
  f.fill(2, y0, -1, doorLx - 1, y0 + 2, 0, st.paint);
  f.fill(doorLx + st.doorW + 1, y0, -1, W - 2, y0 + 2, 0, st.paint);
  // vitrines
  for (let lx = 3; lx < W - 3; lx++) {
    if (lx >= doorLx - 1 && lx < doorLx + st.doorW + 1) continue;
    f.fill(lx, y0 + 2, 0, lx + 1, fasciaY - 1, 1, 0);
    f.fill(lx, y0 + 2, 1, lx + 1, fasciaY - 1, 2, glass);
  }
  // meneaux tous les 6 voxels
  for (let lx = 3; lx < W - 3; lx += 6) {
    if (lx >= doorLx - 1 && lx < doorLx + st.doorW + 1) continue;
    f.fill(lx, y0 + 2, 0, lx + 1, fasciaY - 1, 2, st.paint);
  }
  // imposte horizontale
  f.fill(3, fasciaY - 3, 1, W - 3, fasciaY - 2, 2, st.paint);
  // pilastres d'angle
  f.fill(1, y0, -1, 3, lv.ceil + 1, 0, st.paint);
  f.fill(W - 3, y0, -1, W - 1, lv.ceil + 1, 0, st.paint);
  f.fill(1, lv.ceil + 1, -2, 3, lv.ceil + 2, 0, st.paint2);
  f.fill(W - 3, lv.ceil + 1, -2, W - 1, lv.ceil + 2, 0, st.paint2);
  // bandeau d'enseigne
  f.fill(2, fasciaY, -1, W - 2, fasciaY + 3, 0, pub ? M.PAINT_BLACK : st.paint);
  f.fill(2, fasciaY + 3, -2, W - 2, fasciaY + 4, 0, st.paint);
  f.fill(1, fasciaY + 4, -2, W - 1, fasciaY + 5, 0, st.trim);
  // filet doré
  f.fill(2, fasciaY - 1, -1, W - 2, fasciaY, 0, st.paint2);
  // auvent rayé
  if (st.awning) {
    for (let i = 0; i < 4; i++) {
      f.fill(3, fasciaY - 1 - i, -1 - i, W - 3, fasciaY - i, -i, st.awning);
    }
  }
  void rng;
  return { fasciaY };
}

/** Corniche saillante au sommet des murs. */
export function cornice(f: Frame, st: Style, y: number, all: boolean): void {
  const { W, D } = f;
  // façade
  f.fill(-1, y, -1, W + 1, y + 1, 0, st.trim);
  f.fill(-2, y + 1, -2, W + 2, y + 2, 0, st.trim);
  // denticules
  for (let lx = 0; lx < W; lx += 2) f.set(lx, y - 1, -1, st.trim);
  if (all) {
    f.fill(-1, y, D, W + 1, y + 1, D + 1, st.trim);
    f.fill(-2, y + 1, D, W + 2, y + 2, D + 2, st.trim);
    f.fill(-1, y, -1, 0, y + 1, D + 1, st.trim);
    f.fill(-2, y + 1, -2, -1, y + 2, D + 2, st.trim);
    f.fill(W, y, -1, W + 1, y + 1, D + 1, st.trim);
    f.fill(W + 1, y + 1, -2, W + 2, y + 2, D + 2, st.trim);
  }
}

/** Bandeaux horizontaux entre les étages (façade). */
export function stringCourses(f: Frame, st: Style, lv: Levels): void {
  const { W } = f;
  for (let s = 1; s < lv.storyBase.length; s++) {
    const y = lv.storyBase[s] - 1;
    f.fill(0, y, -1, W, y + 1, 0, st.trim);
  }
}

/** Chaînages d'angle. */
export function quoins(f: Frame, st: Style, lv: Levels): void {
  const { W } = f;
  for (let ly = lv.floorTop; ly < lv.wallTop; ly += 2) {
    const wide = ((ly - lv.floorTop) >> 1) % 2 === 0 ? 3 : 2;
    f.fill(0, ly, 0, wide, ly + 2, 1, st.trim);
    f.fill(W - wide, ly, 0, W, ly + 2, 1, st.trim);
  }
}

/** Hauteur de toit locale (en voxels) pour la colonne (lx, lz). */
function roofHeight(type: RoofType, W: number, D: number, lx: number, lz: number, maxH: number): number {
  switch (type) {
    case 'gable': // faîtage parallèle à la façade
      return Math.min(maxH, Math.min(lz + 1, D - lz));
    case 'gableSide': // pignon sur rue
      return Math.min(maxH, Math.min(lx + 1, W - lx));
    case 'hip':
      return Math.min(maxH, Math.min(lz + 1, D - lz, lx + 1, W - lx));
    case 'mansard': {
      const e = Math.min(lz, D - 1 - lz, lx, W - 1 - lx);
      // brisis raide (2 voxels de haut par voxel) puis terrasson plat
      return Math.min(maxH, (e + 1) * 2);
    }
    case 'flat':
      return 1;
    case 'sawtooth': {
      const period = 16;
      const p = lz % period;
      return Math.min(maxH, p < 4 ? (4 - p) * 2 + 2 : Math.max(1, Math.floor(((p - 4) * 10) / (period - 4)) + 2));
    }
  }
}

export function roof(f: Frame, st: Style, lv: Levels, rng: Rng): number {
  const { W, D } = f;
  const y0 = lv.wallTop;
  const maxH = st.roofMaxH;
  let top = y0;
  if (st.roofType === 'flat') {
    // toit-terrasse en plomb avec parapet
    f.fill(0, y0, 0, W, y0 + 1, D, M.LEAD);
    const py = y0 + 1;
    for (let lx = 0; lx < W; lx++) {
      for (const lz of [0, D - 1]) {
        f.set(lx, py, lz, st.trim);
        f.set(lx, py + 1, lz, lx % 3 === 1 ? 0 : st.trim);
        f.set(lx, py + 2, lz, st.trim);
      }
    }
    for (let lz = 0; lz < D; lz++) {
      for (const lx of [0, W - 1]) {
        f.set(lx, py, lz, st.trim);
        f.set(lx, py + 1, lz, lz % 3 === 1 ? 0 : st.trim);
        f.set(lx, py + 2, lz, st.trim);
      }
    }
    top = py + 3;
  } else {
    for (let lx = -1; lx <= W; lx++) {
      for (let lz = -1; lz <= D; lz++) {
        const inX = lx >= 0 && lx < W;
        const inZ = lz >= 0 && lz < D;
        if (!inX && !inZ) continue;
        const cx = Math.max(0, Math.min(W - 1, lx));
        const cz = Math.max(0, Math.min(D - 1, lz));
        let h = roofHeight(st.roofType, W, D, cx, cz, maxH);
        const overhang = !inX || !inZ;
        if (overhang) {
          // débord de toit : une seule rangée, juste sous la pente
          const yy = y0 + h - 1;
          f.set(lx, yy, lz, st.roof);
          continue;
        }
        const gableEnd =
          (st.roofType === 'gable' && (lx <= 1 || lx >= W - 2)) ||
          (st.roofType === 'gableSide' && (lz <= 1 || lz >= D - 2));
        for (let k = 0; k < h; k++) {
          const ly = y0 + k;
          const surface = k >= h - 2;
          let m: number;
          if (gableEnd && k < h - 1) m = st.wallSide;
          else if (surface) m = st.roof;
          else m = M.PLASTER_DIRTY;
          f.set(lx, ly, lz, m);
        }
        if (y0 + h > top) top = y0 + h;
        // faîtage
        if (h === maxH || (st.roofType === 'gable' && Math.abs(lz - (D - 1) / 2) < 1) || (st.roofType === 'gableSide' && Math.abs(lx - (W - 1) / 2) < 1)) {
          if (st.roofType !== 'mansard' && st.roofType !== 'sawtooth') f.set(lx, y0 + h - 1, lz, M.LEAD);
        }
        // verrières des toits en sheds
        if (st.roofType === 'sawtooth') {
          const p = lz % 16;
          if (p > 0 && p < 4 && lx > 2 && lx < W - 3) {
            for (let k = 2; k < h - 1; k++) f.set(lx, y0 + k, lz, M.GLASS);
          }
        }
      }
    }
    // gouttière
    f.fill(-1, y0 - 1, -1, W + 1, y0, 0, M.IRON);
  }
  // lucarnes du toit mansardé
  if (st.roofType === 'mansard') {
    const cols = windowColumns(W, 4, st.winSpacing, 6);
    for (const c of cols) {
      const ly = y0 + 1;
      // la lucarne sort de la pente avant
      f.fill(c - 1, ly, 0, c + 5, ly + 8, 3, st.trim);
      f.fill(c, ly + 1, 0, c + 4, ly + 7, 1, 0);
      f.fill(c, ly + 1, 1, c + 4, ly + 7, 2, rng.chance(st.litChance) ? M.GLASS_LIT : M.GLASS);
      f.fill(c - 1, ly + 8, -1, c + 5, ly + 9, 3, st.roof);
      f.fill(c, ly + 9, 0, c + 4, ly + 10, 3, st.roof);
    }
  }
  return top;
}

/** Souche de cheminée avec mitrons. Renvoie la position monde (m) du sommet. */
export function chimney(
  f: Frame,
  st: Style,
  lx: number,
  lz: number,
  baseY: number,
  height: number,
  pots: number,
): { x: number; y: number; z: number } {
  const w = Math.max(3, pots * 2 + 1);
  f.fill(lx, baseY, lz, lx + w, baseY + height, lz + 3, st.wallSide === M.STUCCO_WHITE ? M.BRICK_YELLOW : st.wallSide);
  f.fill(lx - 1, baseY + height, lz - 1, lx + w + 1, baseY + height + 1, lz + 4, st.trim);
  for (let i = 0; i < pots; i++) {
    f.fill(lx + 1 + i * 2, baseY + height + 1, lz + 1, lx + 2 + i * 2, baseY + height + 3, lz + 2, M.CHIMNEY_POT);
  }
  f.fill(lx, baseY + height - 1, lz, lx + w, baseY + height, lz + 3, M.SOOT);
  const p = f.pt(lx + w / 2, lz + 1.5);
  return { x: p.x, y: (baseY + height + 3) * 0.25, z: p.z };
}

/** Panneau de collision pour empêcher de passer sous un débord. */
export function plinth(f: Frame, st: Style, lv: Levels): void {
  const { W, D } = f;
  // socle légèrement saillant sur la façade
  f.fill(0, 1, -1, W, lv.floorTop + 1, 0, st.base);
  void D;
}
