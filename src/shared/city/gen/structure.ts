// Structure des bâtiments à étages : planchers, murs, cage d'escalier (jusqu'au toit),
// noyau d'ascenseur, toit-terrasse, châteaux d'eau et escaliers de secours new-yorkais.
// Tout est exprimé dans le repère local du bâtiment (voir Frame) ; ly = 0 au niveau de la rue.

import { M } from '../../materials';
import { GROUND_VY, VOXEL } from '../../voxel';
import type { Frame } from './frame';

/** Niveau d'un étage accessible (couches locales). */
export interface Levels {
  /** Première couche d'air au-dessus du plancher. */
  floorTop: number;
  /** Première couche du plafond (dalle de 2 voxels). */
  ceil: number;
}

const even = (v: number): number => (v & 1 ? v + 1 : v);

/** Étages empilés depuis le rez-de-chaussée. */
export function computeFloors(n: number, groundClear = 16, upperClear = 12, startTop = 1): Levels[] {
  const out: Levels[] = [];
  let top = startTop;
  for (let i = 0; i < n; i++) {
    const clear = i === 0 ? groundClear : upperClear;
    const ceil = even(top + clear);
    out.push({ floorTop: top, ceil });
    top = ceil + 2;
  }
  return out;
}

/** Altitude (m) d'une couche locale. */
export const lyToM = (ly: number): number => ly * VOXEL;

export interface BoxSpec {
  wall: number;
  wallSide: number;
  base: number;
  /** Revêtement du sol de chaque étage. */
  floorMat: number[];
  ceilMat: number;
  roofMat: number;
}

/**
 * Coque : soubassement, murs extérieurs jusqu'à wallTop, dalles entre les étages accessibles,
 * dalle de toit au-dessus du dernier. Au-dessus (étages fermés), l'intérieur reste vide.
 */
export function buildBox(f: Frame, sp: BoxSpec, floors: Levels[], wallTop: number): { roofTop: number } {
  const { W, D } = f;
  const f0 = floors[0];
  f.fill(0, 0, 0, W, f0.floorTop, D, sp.base);
  f.fill(2, f0.floorTop - 1, 2, W - 2, f0.floorTop, D - 2, sp.floorMat[0]);
  f.fill(0, f0.floorTop, 0, W, wallTop, 2, sp.wall);
  f.fill(0, f0.floorTop, D - 2, W, wallTop, D, sp.wallSide);
  f.fill(0, f0.floorTop, 0, 2, wallTop, D, sp.wallSide);
  f.fill(W - 2, f0.floorTop, 0, W, wallTop, D, sp.wallSide);
  f.fill(0, f0.floorTop, 0, 2, wallTop, 2, sp.wall);
  f.fill(W - 2, f0.floorTop, 0, W, wallTop, 2, sp.wall);
  for (let i = 1; i < floors.length; i++) {
    const c = floors[i - 1].ceil;
    f.fill(2, c, 2, W - 2, c + 1, D - 2, sp.ceilMat);
    f.fill(2, c + 1, 2, W - 2, c + 2, D - 2, sp.floorMat[i] ?? sp.floorMat[0]);
  }
  const last = floors[floors.length - 1];
  f.fill(2, last.ceil, 2, W - 2, last.ceil + 1, D - 2, sp.ceilMat);
  f.fill(2, last.ceil + 1, 2, W - 2, last.ceil + 2, D - 2, sp.roofMat);
  return { roofTop: last.ceil + 2 };
}

/** Plafond de couleur particulière pour un étage (le plancher au-dessus reste inchangé). */
export function setCeiling(f: Frame, lv: Levels, x0: number, z0: number, x1: number, z1: number, mat: number): void {
  f.fill(x0, lv.ceil, z0, x1, lv.ceil + 1, z1, mat);
}

/** Habillage des murs d'une pièce sur un étage (papier peint, lambris jusqu'à `dado`). */
export function finishWalls(f: Frame, lv: Levels, x0: number, z0: number, x1: number, z1: number, wall: number, wainscot: number | 0, dado = 4): void {
  const keep = new Set([0, M.GLASS, M.GLASS_LIT, M.GLASS_SHOP, M.GLASS_CLEAR, M.GLASS_COOL, M.FRAME_DARK, M.FRAME_WHITE, M.COLLIDE, M.COVER, M.BARRIER]);
  const paint = (lx: number, lz: number) => {
    for (let ly = lv.floorTop; ly < lv.ceil; ly++) {
      const m = f.get(lx, ly, lz);
      if (keep.has(m)) continue;
      if (m >= M.NEON_PINK && m <= M.SCREEN_TICKER) continue;
      f.set(lx, ly, lz, wainscot && ly < lv.floorTop + dado ? wainscot : wall);
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

// ======================================================================= escalier

/** Dimensions de la cage d'escalier (voxels, intérieur). */
export const STAIR_W = 12;
export const STAIR_D = 18;
const PLAT = 4;

export interface StairInfo {
  /** Portes de la cage à chaque niveau desservi (centre local) et altitude du sol. */
  doors: { lx: number; lz: number; ly: number }[];
}

/**
 * Cage d'escalier à deux volées (demi-tours) dans le rectangle intérieur [sx0, sx0+12) × [sz0, sz0+18),
 * entrée côté sz0 (vers la façade). Dessert tous les étages et, si roofTop est donné, le toit
 * (édicule avec porte). Les murs de la cage côté pièce sont construits ici ; les autres
 * coïncident avec les murs extérieurs.
 */
export function stairShaft(
  f: Frame,
  sx0: number,
  sz0: number,
  floors: Levels[],
  roofTop: number | null,
  wallMat: number,
  stepMat: number,
  opts: { leftWall?: boolean; rightWall?: boolean; backWall?: boolean } = {},
): StairInfo {
  const levels = floors.map((l) => l.floorTop);
  if (roofTop !== null) levels.push(roofTop);
  const top = levels[levels.length - 1] + 13; // plafond de l'édicule
  const x0 = sx0;
  const x1 = sx0 + STAIR_W;
  const z0 = sz0;
  const z1 = sz0 + STAIR_D;
  const bottom = levels[0];
  // on vide la cage (dalles comprises), puis on la referme
  f.fill(x0, bottom, z0, x1, top, z1, 0);
  // murs de la cage côté pièces
  f.fill(x0 - 2, bottom, z0 - 2, x1 + (opts.rightWall ? 2 : 0), top + 2, z0, wallMat); // avant
  f.fill(x0 - 2, bottom, z0 - 2, x0, top + 2, z1 + (opts.backWall ? 2 : 0), wallMat); // gauche
  if (opts.rightWall) f.fill(x1, bottom, z0 - 2, x1 + 2, top + 2, z1 + 2, wallMat);
  if (opts.backWall) f.fill(x0 - 2, bottom, z1, x1 + 2, top + 2, z1 + 2, wallMat);
  // édicule de toit : murs extérieurs complets au-dessus du toit
  if (roofTop !== null) {
    const r = roofTop;
    f.fill(x0 - 2, r, z0 - 2, x1 + 2, top + 2, z0, wallMat);
    f.fill(x0 - 2, r, z1, x1 + 2, top + 2, z1 + 2, wallMat);
    f.fill(x0 - 2, r, z0 - 2, x0, top + 2, z1 + 2, wallMat);
    f.fill(x1, r, z0 - 2, x1 + 2, top + 2, z1 + 2, wallMat);
    f.fill(x0 - 2, top, z0 - 2, x1 + 2, top + 2, z1 + 2, M.ROOF_TAR);
  } else {
    f.fill(x0 - 2, top, z0 - 2, x1 + 2, top + 2, z1 + 2, wallMat);
  }
  const doors: StairInfo['doors'] = [];
  const half = STAIR_W / 2;
  for (let i = 0; i < levels.length; i++) {
    const F = levels[i];
    // palier d'arrivée (avant, toute la largeur)
    if (i > 0) f.fill(x0, F - 2, z0, x1, F, z0 + PLAT, stepMat);
    // porte vers l'étage (ou vers le toit)
    const dx = x0 + 3;
    f.fill(dx, F, z0 - 2, dx + 5, F + 9, z0, 0);
    doors.push({ lx: dx + 2.5, lz: z0 - 1, ly: F });
    if (i === levels.length - 1) break;
    const H = levels[i + 1] - F;
    const h1 = Math.ceil(H / 2);
    // volée 1 : moitié gauche, vers le fond
    for (let k = 1; k <= h1; k++) {
      const z = z0 + PLAT + k - 1;
      f.fill(x0, F + k - 3, z, x0 + half, F + k, z + 1, stepMat);
    }
    // palier intermédiaire (fond)
    const lz0 = z0 + PLAT + h1;
    f.fill(x0, F + h1 - 3, lz0, x1, F + h1, Math.min(z1, lz0 + 4), stepMat);
    // volée 2 : moitié droite, vers l'avant, jusqu'au niveau suivant
    for (let j = 0; j < h1; j++) {
      const z = z0 + PLAT + h1 - 1 - j;
      const h = F + h1 + Math.round(((j + 1) * (H - h1)) / h1);
      f.fill(x0 + half, h - 3, z, x1, h, z + 1, stepMat);
    }
    // éclairage du palier
    f.prop('BARE_BULB', x0 + half, F + 10, z0 + 2, 0, 0);
  }
  return { doors };
}

// ======================================================================= ascenseur

export const ELEV_W = 10;
export const ELEV_D = 8;

/**
 * Noyau d'ascenseur plein [ex0, ex0+10) × [ez0, ez0+8), portes côté ez0 (vers −z local) aux
 * niveaux indiqués. Renvoie les arrêts (point devant la porte, coordonnées locales).
 */
export function elevatorCore(f: Frame, ex0: number, ez0: number, stops: number[], top: number, wallMat: number): { lx: number; lz: number; ly: number }[] {
  const bottom = Math.min(...stops) - 1;
  f.fill(ex0, bottom, ez0, ex0 + ELEV_W, top, ez0 + ELEV_D, wallMat);
  const out: { lx: number; lz: number; ly: number }[] = [];
  for (const ly of stops) {
    // encadrement métallique et porte
    f.fill(ex0 + 1, ly, ez0, ex0 + ELEV_W - 1, ly + 11, ez0 + 1, M.STEEL);
    f.fill(ex0 + 2, ly, ez0, ex0 + ELEV_W - 2, ly + 10, ez0 + 1, M.CHROME);
    f.prop('ELEVATOR_DOOR', ex0 + ELEV_W / 2, ly, ez0 - 0.3, Math.PI, 0);
    out.push({ lx: ex0 + ELEV_W / 2, lz: ez0 - 5, ly });
  }
  return out;
}

// ======================================================================= toit

/** Acrotère autour du toit-terrasse (avec garde-corps invisible au-dessus). */
export function parapet(f: Frame, roofTop: number, mat: number, h = 4): void {
  const { W, D } = f;
  f.fill(0, roofTop, 0, W, roofTop + h, 2, mat);
  f.fill(0, roofTop, D - 2, W, roofTop + h, D, mat);
  f.fill(0, roofTop, 0, 2, roofTop + h, D, mat);
  f.fill(W - 2, roofTop, 0, W, roofTop + h, D, mat);
  // couvertine
  f.fill(-1, roofTop + h, -1, W + 1, roofTop + h + 1, 1, M.CONCRETE_WHITE);
  f.fill(-1, roofTop + h, D - 1, W + 1, roofTop + h + 1, D + 1, M.CONCRETE_WHITE);
  f.fill(-1, roofTop + h, -1, 1, roofTop + h + 1, D + 1, M.CONCRETE_WHITE);
  f.fill(W - 1, roofTop + h, -1, W + 1, roofTop + h + 1, D + 1, M.CONCRETE_WHITE);
  // garde-corps invisible : on ne tombe pas du toit par mégarde
  f.fill(0, roofTop + h + 1, 0, W, roofTop + h + 3, 1, M.BARRIER);
  f.fill(0, roofTop + h + 1, D - 1, W, roofTop + h + 3, D, M.BARRIER);
  f.fill(0, roofTop + h + 1, 0, 1, roofTop + h + 3, D, M.BARRIER);
  f.fill(W - 1, roofTop + h + 1, 0, W, roofTop + h + 3, D, M.BARRIER);
}

/** Château d'eau new-yorkais (cuve en bois sur pieds d'acier). Coordonnées locales du centre. */
export function waterTower(f: Frame, cx: number, cz: number, base: number, r = 6): void {
  const legH = 12;
  for (const [dx, dz] of [
    [-r + 1, -r + 1],
    [r - 2, -r + 1],
    [-r + 1, r - 2],
    [r - 2, r - 2],
  ])
    f.fill(cx + dx, base, cz + dz, cx + dx + 1, base + legH, cz + dz + 1, M.IRON);
  // croisillons
  f.fill(cx - r + 1, base + 5, cz - r + 1, cx + r - 1, base + 6, cz - r + 2, M.IRON);
  f.fill(cx - r + 1, base + 5, cz + r - 2, cx + r - 1, base + 6, cz + r - 1, M.IRON);
  // plancher et cuve cylindrique
  f.fill(cx - r, base + legH, cz - r, cx + r, base + legH + 1, cz + r, M.IRON);
  const tankH = 16;
  for (let y = 0; y < tankH; y++) {
    for (let x = -r; x < r; x++)
      for (let z = -r; z < r; z++) {
        const d = Math.hypot(x + 0.5, z + 0.5);
        if (d > r - 0.2) continue;
        const shell = d > r - 1.4;
        const hoop = y % 5 === 2;
        if (shell) f.set(cx + x, base + legH + 1 + y, cz + z, hoop ? M.IRON : M.WATER_TANK);
        else if (y === 0) f.set(cx + x, base + legH + 1 + y, cz + z, M.WATER_TANK);
      }
  }
  // toit conique
  for (let k = 0; k < 6; k++) {
    const rr = r - k;
    for (let x = -rr; x < rr; x++)
      for (let z = -rr; z < rr; z++) if (Math.hypot(x + 0.5, z + 0.5) <= rr) f.set(cx + x, base + legH + 1 + tankH + k, cz + z, M.WATER_TANK);
  }
  f.fill(cx, base + legH + tankH + 7, cz, cx + 1, base + legH + tankH + 9, cz + 1, M.IRON);
}

/**
 * Escalier de secours sur la façade avant (lz < 0) : balcons à chaque étage et volées
 * alternées, du premier étage au toit. lx0 = début de la travée (largeur 16 voxels).
 */
export function fireEscape(f: Frame, lx0: number, storyBases: number[], roofTop: number): void {
  const w = 16;
  const depth = 5;
  const levels = [...storyBases.slice(1), roofTop];
  let prev = storyBases[0] + 1; // la volée du bas part du trottoir (échelle repliée)
  for (let i = 0; i < levels.length; i++) {
    const y = levels[i] - 1;
    // balcon (caillebotis) et garde-corps
    f.fill(lx0, y, -depth, lx0 + w, y + 1, 0, M.GRATE);
    f.fill(lx0, y + 1, -depth, lx0 + w, y + 5, -depth + 1, M.BARRIER);
    f.fill(lx0, y + 4, -depth, lx0 + w, y + 5, -depth + 1, M.IRON);
    for (let x = lx0; x < lx0 + w; x += 3) f.fill(x, y + 1, -depth, x + 1, y + 4, -depth + 1, M.IRON);
    f.fill(lx0, y + 1, -depth, lx0 + 1, y + 5, 0, M.IRON);
    f.fill(lx0 + w - 1, y + 1, -depth, lx0 + w, y + 5, 0, M.IRON);
    // volée depuis le niveau précédent
    const rise = y + 1 - prev;
    const goRight = i % 2 === 0;
    const sx = goRight ? lx0 + 1 : lx0 + w - 2;
    for (let k = 0; k < rise; k++) {
      const x = goRight ? sx + Math.floor((k * (w - 4)) / rise) : sx - Math.floor((k * (w - 4)) / rise);
      f.fill(x, prev + k - 1, -depth + 1, x + 1, prev + k, -depth + 3, M.GRATE);
    }
    prev = y + 1;
  }
  void GROUND_VY;
}

/** Corniche saillante au sommet de la façade avant. */
export function cornice(f: Frame, y: number, mat: number, all = false): void {
  const { W, D } = f;
  f.fill(-1, y, -1, W + 1, y + 1, 0, mat);
  f.fill(-2, y + 1, -2, W + 2, y + 2, 0, mat);
  for (let lx = 0; lx < W; lx += 2) f.set(lx, y - 1, -1, mat);
  if (all) {
    f.fill(-1, y, D, W + 1, y + 1, D + 1, mat);
    f.fill(-1, y, -1, 0, y + 1, D + 1, mat);
    f.fill(W, y, -1, W + 1, y + 1, D + 1, mat);
  }
}
