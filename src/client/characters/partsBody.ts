// Corps des personnages au 1/64 m : torse, bassin, bras, mains, jambes, pieds, pans de
// manteau et jupes. Les volumes du corps sont des superellipses dont les demi-axes suivent des
// profils anatomiques (taille marquée, poitrine, épaules, mollets…) ; les vêtements sont des
// couches « gonflées » au-dessus de la peau (chemise, gilet, veste, manteau), limitées à leur
// région (ouverture en V, revers, manches courtes…), et les détails sont peints ensuite
// (boutons, coutures, plis, liserés lumineux). Les couleurs sont des emplacements de palette :
// la tenue de chaque personnage vient de sa ligne de palette.
// Repère : +Y en haut, +Z vers l'avant, +X vers la gauche du personnage. Les membres latéraux
// sont construits côté gauche (+X = extérieur) puis copiés en miroir pour la droite.

import { SLOT } from '../models/voxelModel';
import type { VoxelModel } from '../models/voxelModel';
import { XS } from './charMesher';
import { DIMS, type Build } from './rig';
import { clamp01, hash3, inEllipsoid, Sculpt, segDist, smooth, steps, supEll, type Col } from './sculpt';

// couleurs fixes
const SOLE = 0x18171a;
const SOLE_W = 0xe6e3dc;
const SOLE_GUM = 0x6a4a2c;
const LACE_W = 0xdedad2;
const STEEL = 0x5a5f68;
const GUN = 0x2a2c31;

export type TorsoStyle =
  | 'longcoat' // Dadou : long manteau noir ouvert, revers cramoisis, gilet, chaîne d'or
  | 'frock' // Even : redingote croisée bleu marine, boutons d'argent
  | 'suit' // costume ajusté, chemise, cravate
  | 'blazer' // blazer ouvert sur un col roulé
  | 'bomber' // blouson d'aviateur
  | 'hoodie' // sweat à capuche
  | 'track' // veste de survêtement
  | 'leather' // perfecto
  | 'crow' // perfecto des Corbeaux (corbeau dans le dos)
  | 'tech' // tenue technique à harnais
  | 'armor' // armure de sécurité privée
  | 'tactical' // uniforme tactique du NYPD
  | 'puffer' // doudoune
  | 'trench' // imperméable croisé ceinturé
  | 'tee' // t-shirt imprimé
  | 'workvest' // gilet haute visibilité
  | 'mandarin' // veste à col mao
  | 'crop' // veste courte sur un haut (femmes)
  | 'dress' // robe
  | 'turtle'; // pull à col roulé

export type PelvisStyle = 'belt' | 'jacket' | 'open' | 'frock' | 'trench' | 'hem' | 'duty' | 'armor' | 'skirt' | 'tech' | 'crop';
export type SleeveStyle = 'coat' | 'dadou' | 'even' | 'rib' | 'stripe' | 'puffer' | 'tee' | 'bare' | 'rolled' | 'pad' | 'tac' | 'tech' | 'leather' | 'trench';
export type LegStyle = 'pants' | 'cargo' | 'jeans' | 'track' | 'armor' | 'bare' | 'tights';
export type FootStyle = 'dress' | 'sneaker' | 'boot' | 'heel' | 'kneepad';
export type TailStyle = 'longcoat' | 'frock' | 'trench';
export type SkirtStyle = 'skirt' | 'pencil' | 'midi';
export type HandPose = 'relax' | 'fist' | 'grip' | 'flat';
export type HandWear = 'bare' | 'glove' | 'rings' | 'tac' | 'signet';

// ===================================================================== profils du corps

type Prof = (y: number, out?: number[]) => number[];

/**
 * Les volumes sont des sections constantes par paliers (sculpture voxel) : de grandes faces
 * planes, des marches nettes d'un voxel, et beaucoup moins de quads qu'une surface lisse.
 * Demi-axes en k + 0,5 (grilles centrées sur une colonne de voxels : largeurs impaires),
 * épaisseurs des vêtements entières.
 */
const LIMB_N = 3.2;
const TORSO_N = 3.4;

/** Torse : [y, demi-largeur, demi-profondeur, centre en z]. */
const TORSO: Record<Build, Prof> = {
  m: steps([
    [-6, 9.5, 6.5, 0],
    [-1, 9.5, 6, 0.5],
    [5, 9.5, 7, 0.5],
    [11, 10.5, 7.5, 1],
    [22, 10.5, 7, 0.5],
    [26, 10.5, 6.5, 0],
    [34],
  ]),
  f: steps([
    [-6, 9.5, 6.5, 0],
    [-1, 8.5, 5, 0.5],
    [7, 8.5, 6, 0.5],
    [12, 9.5, 6, 0.5],
    [21, 9.5, 5.5, 0],
    [33],
  ]),
};

/** Haut des épaules (pente du trapèze) à la distance |x| de l'axe. */
function shoulderTop(b: Build, ax: number, dz: number): number {
  const top = b === 'm' ? 32.4 - Math.max(0, ax - 4.6) * 0.62 : 31.4 - Math.max(0, ax - 4.2) * 0.62;
  // l'avant de l'épaule (clavicule) descend un peu
  return top - Math.max(0, dz - 1.5) * 0.4;
}

const NECK: Record<Build, { rx: number; rz: number; cz: number }> = {
  m: { rx: 3.5, rz: 3.8, cz: -0.6 },
  f: { rx: 3.1, rz: 3.4, cz: -0.5 },
};

/** Poitrine (femmes) : deux ellipsoïdes. */
function inBust(x: number, y: number, z: number, t: number): boolean {
  const P = TORSO.f(16.5);
  const cz = P[2] + P[1] - 1.3;
  return inEllipsoid(Math.abs(x), y, z, 3.4, 16.3, cz, 3.5 + t, 3.4 + t, 3.1 + t);
}

const tq: number[] = [0, 0, 0];
/** Le point est-il dans le torse gonflé de t voxels ? */
function inTorso(b: Build, x: number, y: number, z: number, t: number): boolean {
  t = Math.round(t);
  const P = TORSO[b](y, tq);
  if (y > shoulderTop(b, Math.abs(x), z - P[2]) + t * 0.9) return false;
  if (supEll(x, z - P[2], P[0] + t, P[1] + t, TORSO_N) <= 1) return true;
  return b === 'f' && y > 11 && y < 21 && inBust(x, y, z, t);
}

/** Bassin : [y, demi-largeur, demi-profondeur, centre en z]. */
const PELVIS: Record<Build, Prof> = {
  m: steps([
    [-15, 7.5, 5.5, 0],
    [-12, 9.5, 7, -0.5],
    [-4, 9.5, 6.5, 0],
    [5],
  ]),
  f: steps([
    [-15, 8.5, 5.5, 0],
    [-12, 10.5, 7, -0.5],
    [-6, 10.5, 6.5, 0],
    [-2, 9.5, 6.5, 0],
    [5],
  ]),
};

function inPelvis(b: Build, x: number, y: number, z: number, t: number): boolean {
  t = Math.round(t);
  const P = PELVIS[b](y, tq);
  // entrejambe : le fond remonte vers les hanches (les cuisses comblent le reste)
  if (y < -13.5 + Math.max(0, Math.abs(x) - 2) * 0.28 - t * 0.6) return false;
  return supEll(x, z - P[2], P[0] + t, P[1] + t, 3.0) <= 1;
}

// ===================================================================== couches de vêtements

interface Layer {
  t: number;
  y0?: number;
  y1?: number;
  on?: (x: number, y: number, z: number) => boolean;
  col: Col | ((x: number, y: number, z: number) => Col);
}

function evalLayers(layers: Layer[], inside: (x: number, y: number, z: number, t: number) => boolean, x: number, y: number, z: number): Col {
  for (const L of layers) {
    if (L.y0 !== undefined && y < L.y0) continue;
    if (L.y1 !== undefined && y > L.y1) continue;
    if (!inside(x, y, z, L.t)) continue;
    if (L.on && !L.on(x, y, z)) continue;
    return typeof L.col === 'number' ? L.col : L.col(x, y, z);
  }
  return -1;
}

const byT = (a: Layer, b: Layer) => b.t - a.t;

/** Épaisseurs standard des vêtements (voxels). */
const T = { shirt: 0, knit: 1, vest: 1, jacket: 1, coat: 2, lapel: 1, puffer: 3, plate: 2 };

/** Demi-largeur de l'ouverture en V à la hauteur y (0 sous le bouton). */
function vOpen(y: number, yLow: number, yTop: number, wTop: number): number {
  if (y <= yLow) return 0;
  return wTop * Math.pow(clamp01((y - yLow) / (yTop - yLow)), 0.9);
}

// ===================================================================== torse

/** Torse : origine à l'articulation lombaire ; cou jusqu'à la tête. */
export function torso(style: TorsoStyle, b: Build): VoxelModel {
  const s = new Sculpt(-17.5, 17.5, -6, 42, -13.5, 13.5);
  const f = b === 'f';
  const N = NECK[b];
  const layers: Layer[] = [];
  const extras: ((x: number, y: number, z: number) => Col)[] = [];
  const neckTop = 41.5;
  /** Col sur le cou : demi-épaisseur supplémentaire t entre y0 et y1 (devant ouvert si open). */
  const collar = (t0: number, y0: number, y1: number, col: Col | ((x: number, y: number, z: number) => Col), open = 0) =>
    extras.push((x, y, z) => {
      const t = Math.max(1, Math.round(t0));
      if (y < y0 || y > y1) return -1;
      if (supEll(x, z - N.cz, N.rx + t, N.rz + t, 2.2) > 1) return -1;
      if (open > 0 && z > N.cz + 1 && Math.abs(x) < open) return -1;
      return typeof col === 'number' ? col : col(x, y, z);
    });
  const P = (y: number) => TORSO[b](y);
  const front = (y: number, z: number) => z > P(y)[2] + 1.5;
  const backSide = (y: number, z: number) => z < P(y)[2] - 1.5;
  const skin: Layer = { t: 0, col: SLOT.SKIN };
  // la chemise couvre le torse et le bas du cou
  const shirtL = (col: Col = SLOT.SHIRT): Layer => ({ t: T.shirt, col });

  /** Veste ou manteau ouvert en V : revers, chemise/gilet dans l'ouverture. */
  const jacket = (o: {
    t: number;
    low: number;
    top?: number;
    wTop?: number;
    lapel?: number;
    lapelCol?: Col;
    notch?: number;
    edge?: Col;
    cut?: number;
    col?: Col;
    inner?: Layer[];
  }) => {
    const top = o.top ?? 29.5;
    const wTop = o.wTop ?? (f ? 3.6 : 4.2);
    const open = (y: number) => vOpen(y, o.low, top, wTop) + (o.cut ? Math.max(0, o.low - y) * o.cut : 0);
    const col = o.col ?? SLOT.COAT;
    layers.push({ t: o.t, on: (x, y, z) => !(front(y, z) && Math.abs(x) < open(y)), col });
    if (o.lapel) {
      const notch = o.notch ?? 26;
      const lw = (y: number) => (y < o.low ? 0 : 1 + (o.lapel! - 1) * clamp01((y - o.low) / (notch - 1 - o.low)));
      layers.push({
        t: o.t + T.lapel,
        y0: o.low,
        y1: notch + 0.5,
        on: (x, y, z) => front(y, z) && Math.abs(x) >= open(y) && Math.abs(x) < open(y) + lw(y) && !(y > notch - 1.5 && Math.abs(x) > open(y) + lw(y) - 1.5),
        col: (x, y) => (o.edge !== undefined && Math.abs(x) >= open(y) + lw(y) - 1 && y > o.low + 1 ? o.edge : (o.lapelCol ?? SLOT.COAT2)),
      });
    }
    for (const L of o.inner ?? []) layers.push(L);
  };

  switch (style) {
    case 'longcoat': {
      // Dadou : long manteau noir ouvert sur un gilet cramoisi, revers en pointe cramoisis
      // liserés d'un fil de néon rouge, col relevé, chemise blanche, cravate cramoisie
      const vestOpen = (y: number) => vOpen(y, 18, 29.5, 3.3);
      jacket({
        t: T.coat,
        low: 7,
        wTop: 4.6,
        lapel: 4.4,
        notch: 27,
        edge: SLOT.NEON,
        cut: 0.5,
        inner: [
          { t: T.vest, on: (x, y, z) => !(front(y, z) && Math.abs(x) < vestOpen(y)), col: SLOT.VEST },
          shirtL(),
        ],
      });
      // col relevé à l'arrière (doublure cramoisie dedans)
      extras.push((x, y, z) => {
        if (y < 27 || y > 33.5) return -1;
        const P0 = TORSO[b](27);
        if (z > N.cz + 1.2) return -1;
        const r = supEll(x, z - N.cz, N.rx + 3.4, N.rz + 2.6, 2.2);
        if (r > 1 || r < 0.38) return -1;
        void P0;
        return r < 0.62 ? SLOT.COAT2 : SLOT.COAT;
      });
      collar(T.shirt + 0.5, 29, 32, SLOT.SHIRT, 1.2);
      break;
    }
    case 'frock': {
      // Even : redingote croisée fermée jusqu'à la poitrine, revers bleus, gilet gris perle,
      // lavallière argent avec épingle cyan
      jacket({ t: T.coat, low: 17.5, wTop: 4.2, lapel: 4.6, notch: 27, inner: [{ t: T.vest, on: (x, y, z) => !(front(y, z) && Math.abs(x) < vOpen(y, 22, 29.5, 2.6)), col: SLOT.VEST }, shirtL()] });
      extras.push((x, y, z) => {
        if (y < 27 || y > 32.5 || z > N.cz + 1.5) return -1;
        const r = supEll(x, z - N.cz, N.rx + 3, N.rz + 2.2, 2.2);
        return r <= 1 && r >= 0.4 ? SLOT.COAT : -1;
      });
      collar(T.shirt + 0.6, 29, 32.5, SLOT.SHIRT, 0.9);
      break;
    }
    case 'suit':
    case 'blazer': {
      const blazer = style === 'blazer';
      jacket({
        t: T.jacket,
        low: blazer ? 6 : f ? 11 : 12,
        lapel: f ? 3 : 3.6,
        notch: 26,
        cut: blazer ? 0.2 : 0.45,
        lapelCol: SLOT.COAT2,
        inner: [blazer ? { t: T.knit, col: SLOT.SHIRT } : shirtL()],
      });
      if (blazer) collar(T.knit + 0.7, 27, 34, SLOT.SHIRT);
      else collar(T.shirt + 0.6, 29, 32, SLOT.SHIRT, 1.1);
      break;
    }
    case 'turtle': {
      layers.push({ t: T.knit, col: SLOT.COAT });
      collar(T.knit + 0.6, 27, 35, SLOT.COAT);
      break;
    }
    case 'bomber': {
      // blouson : bord-côte en bas, col en bord-côte, fermeture entrouverte sur un t-shirt
      layers.push({ t: T.jacket + 0.4, on: (x, y, z) => !(front(y, z) && Math.abs(x) < vOpen(y, 22, 30, 2.6)), col: (x, y) => (y < -3 ? SLOT.COAT2 : SLOT.COAT) });
      layers.push(shirtL());
      collar(T.jacket + 0.4, 27.5, 31, SLOT.COAT2, 2);
      break;
    }
    case 'hoodie': {
      layers.push({ t: T.knit + 0.4, col: (x, y) => (y < -4 ? SLOT.COAT2 : SLOT.COAT) });
      // capuche rabattue dans le dos (sauf si relevée : voir le couvre-chef)
      extras.push((x, y, z) => {
        if (y < 22 || y > 33) return -1;
        const P0 = TORSO[b](27);
        const cz = P0[2] - P0[1] - 1.2;
        if (inEllipsoid(x, y, z, 0, 28, cz, 6.5, 5.5, 3.2)) return y > 31 ? SLOT.COAT2 : SLOT.COAT;
        return -1;
      });
      collar(T.knit + 0.5, 27, 30.5, SLOT.COAT, 2.2);
      break;
    }
    case 'track': {
      layers.push({ t: T.knit + 0.3, col: SLOT.COAT });
      collar(T.knit + 0.8, 27, 32.5, SLOT.COAT2, 0.6);
      break;
    }
    case 'leather':
    case 'crow': {
      // perfecto : grands revers, fermeture en biais, ceinture
      jacket({ t: T.jacket + 0.2, low: 17, wTop: 3.6, lapel: 3.4, notch: 26, lapelCol: SLOT.COAT, inner: [shirtL()] });
      collar(T.jacket, 28, 31, SLOT.COAT, 2.5);
      break;
    }
    case 'tech': {
      // veste technique à col cheminée, harnais par-dessus
      layers.push({ t: T.jacket, col: SLOT.COAT });
      collar(T.jacket + 0.4, 26, 35.5, SLOT.COAT, 0);
      // bretelles du harnais (en relief)
      extras.push((x, y, z) => {
        if (y < -4 || y > 29) return -1;
        const ax = Math.abs(x);
        const strap = Math.abs(ax - (5 - (y - 10) * 0.05)) < 0.9;
        const chest = y > 13 && y < 15.5;
        if (!strap && !(chest && front(y, z))) return -1;
        return inTorso(b, x, y, z, T.jacket + 0.8) ? SLOT.DRESS : -1;
      });
      break;
    }
    case 'armor': {
      // plastron et dossière (rigides), plaques abdominales, combinaison dessous
      layers.push({ t: T.plate + 0.4, y0: 9, y1: 29, on: (x, y, z) => Math.abs(x) < P(y)[0] - 1 || y > 24, col: SLOT.VEST });
      layers.push({ t: T.plate - 0.4, y0: -2, y1: 9, on: (x, y, z) => front(y, z) && Math.abs(x) < 5.5, col: (x, y) => ((y + 6) % 4 < 1 ? XS.VEST_D : SLOT.VEST) });
      layers.push({ t: T.jacket, col: SLOT.COAT });
      collar(T.plate, 26, 33, SLOT.VEST, 1.2);
      // batterie dorsale
      extras.push((x, y, z) => {
        const P0 = TORSO[b](16);
        const zb = P0[2] - P0[1] - T.plate;
        if (Math.abs(x) < 3.5 && y > 9 && y < 22 && z < zb + 0.4 && z > zb - 2.6) return y > 15 && y < 17 && Math.abs(x) < 2 ? SLOT.NEON : SLOT.DRESS;
        return -1;
      });
      break;
    }
    case 'tactical': {
      // gilet tactique sur la chemise d'uniforme
      layers.push({ t: T.plate, y0: -3, y1: 27.5, on: (x, y, z) => !(front(y, z) && Math.abs(x) < vOpen(y, 22, 28, 3) && y > 22), col: SLOT.VEST });
      layers.push({ t: T.jacket - 0.3, col: SLOT.COAT });
      collar(T.shirt + 0.6, 28, 31.5, SLOT.COAT, 1.2);
      // poches porte-chargeurs sur le ventre, radio sur l'épaule gauche
      extras.push((x, y, z) => {
        const P0 = TORSO[b](y);
        const zf = P0[2] + P0[1] + T.plate;
        if (y > 1 && y < 7 && z > zf - 0.6 && z < zf + 1.6 && Math.abs(x) < 7 && Math.abs(Math.abs(x) - 3.6) < 3) return y > 5.5 ? SLOT.VEST : SLOT.DRESS;
        if (y > 22 && y < 26 && x > 4.5 && x < 7 && z > zf - 0.5 && z < zf + 1.5) return SLOT.DRESS;
        return -1;
      });
      break;
    }
    case 'puffer': {
      // doudoune : boudins horizontaux (relief), col montant
      layers.push({
        t: T.puffer,
        on: (x, y) => {
          const ph = (((y + 3) % 5) + 5) % 5;
          return ph > 0.6;
        },
        col: SLOT.COAT,
      });
      layers.push({ t: T.puffer - 0.9, col: XS.COAT_D });
      collar(T.puffer - 0.4, 26, 34, SLOT.COAT, 0.4);
      break;
    }
    case 'trench': {
      // imperméable croisé : grands revers, empiècement, ceinture nouée
      jacket({ t: T.coat, low: 19, wTop: 4.4, lapel: 4.4, notch: 27, lapelCol: SLOT.COAT, inner: [shirtL()] });
      layers.push({ t: T.coat + 0.6, y0: -1.5, y1: 1.5, col: SLOT.COAT2 });
      extras.push((x, y, z) => {
        if (y < 26.5 || y > 33 || z > N.cz + 2) return -1;
        const r = supEll(x, z - N.cz, N.rx + 3.2, N.rz + 2.4, 2.2);
        return r <= 1 && r >= 0.42 ? SLOT.COAT : -1;
      });
      if (!f) collar(T.shirt + 0.5, 29, 31.5, SLOT.SHIRT, 1.1);
      break;
    }
    case 'tee': {
      layers.push({ t: T.shirt + 0.3, col: SLOT.COAT });
      collar(T.shirt + 0.3, 27.5, 28.8, SLOT.COAT2);
      break;
    }
    case 'workvest': {
      layers.push({ t: T.jacket + 0.3, y0: -3, y1: 28, on: (x, y, z) => !(front(y, z) && Math.abs(x) < 2.2), col: SLOT.VEST });
      layers.push({ t: T.knit, col: SLOT.COAT });
      collar(T.knit + 0.5, 27, 31, SLOT.COAT, 0);
      break;
    }
    case 'mandarin': {
      layers.push({ t: T.jacket, col: SLOT.COAT });
      collar(T.jacket - 0.2, 27, 32.5, SLOT.COAT, 0.6);
      break;
    }
    case 'crop': {
      // veste courte ouverte sur un haut court (nombril visible)
      layers.push({ t: T.jacket, y0: 9, on: (x, y, z) => !(front(y, z) && Math.abs(x) < vOpen(y, 9, 29, 4.5) + 2), col: SLOT.COAT2 });
      layers.push({ t: T.shirt, y0: 3.5, col: SLOT.SHIRT });
      layers.push(skin);
      collar(T.shirt, 27, 28.5, SLOT.SHIRT, 2);
      break;
    }
    case 'dress': {
      // robe : décolleté en V, fines bretelles
      layers.push({ t: T.shirt + 0.2, on: (x, y, z) => !(front(y, z) && Math.abs(x) < vOpen(y, 19, 27, 4.2) + (y > 22 ? 1.2 : 0)) && !(y > 25 && Math.abs(x) > 6.5 && Math.abs(x) < 9.6), col: SLOT.DRESS });
      break;
    }
  }
  if (!layers.includes(skin)) layers.push(skin);
  layers.sort(byT);
  const inside = (x: number, y: number, z: number, t: number) => inTorso(b, x, y, z, t);
  s.add((x, y, z) => {
    for (const e of extras) {
      const c = e(x, y, z);
      if (c >= 0) return c;
    }
    if (y <= 31.5 || Math.abs(x) > N.rx + 1.5) {
      const c = evalLayers(layers, inside, x, y, z);
      if (c >= 0) return c;
    }
    // cou
    if (y < neckTop && y > 20 && supEll(x, z - N.cz, N.rx, N.rz, 2.2) <= 1) return y < 41 - (z - N.cz) * 0.6 ? SLOT.SKIN : -1;
    return -1;
  });

  // ------------------------------------------------------------- détails peints
  const fz = (x: number, y: number) => s.frontZ(x, y);
  const dec = (x: number, y: number, c: Col) => s.front(x, y, c);
  /** Ligne de boutons verticale. */
  const buttons = (xs: number[], ys: number[], c: Col = SLOT.ACCENT) => {
    for (const x of xs) for (const y of ys) dec(x, y, c);
  };
  // ombre sous la mâchoire / à la base du cou, clavicules
  s.paintSurf((x, y, z, c) => (c === SLOT.SKIN && y > 33 && z > N.cz + 1 ? XS.SKIN_D : c));
  switch (style) {
    case 'longcoat': {
      // boutons d'or du gilet, chaîne de montre en arc, épingle de cravate, pochette
      buttons([0], [10, 13, 16]);
      for (let i = 0; i <= 8; i++) {
        const x = -4 + i;
        const y = 12 - Math.sin((i / 8) * Math.PI) * 2.2;
        dec(x, y, SLOT.ACCENT);
      }
      tie(s, 18, 29.5, 1.4);
      dec(0, 22, SLOT.ACCENT);
      // revers : ombre portée sous le bord, fil lumineux sur l'ourlet
      s.paintSurf((x, y, z, c, nx, ny) => (c === SLOT.COAT && ny > 0 && y > 26 && y < 31 ? XS.COAT_L : c));
      // dos : couture centrale et fente doublée, plis
      for (let y = -5; y <= 2; y++) s.back(0, y, SLOT.COAT2);
      for (let y = 4; y <= 24; y++) s.back(0, y, XS.COAT_D);
      // poche de poitrine (pochette cramoisie)
      dec(5, 21, SLOT.COAT2);
      dec(6, 21, SLOT.COAT2);
      dec(5, 20, XS.COAT_D);
      dec(6, 20, XS.COAT_D);
      dec(7, 20, XS.COAT_D);
      break;
    }
    case 'frock': {
      // deux rangées de trois boutons d'argent, lavallière, épingle cyan, chaîne de gousset
      buttons([-4.5, 4.5], [8, 12, 16]);
      tie(s, 22, 29.5, 1.6, true);
      dec(0, 25, SLOT.NEON);
      for (let i = 0; i <= 5; i++) dec(-6 + i * 0.6, 19 - Math.sin((i / 5) * Math.PI) * 1.5, SLOT.ACCENT);
      for (let y = -5; y <= 22; y++) s.back(0, y, XS.COAT_D);
      // passepoil des revers
      s.paintSurf((x, y, z, c, nx, ny) => (c === SLOT.COAT2 && ny > 0 ? XS.COAT2_D : c));
      break;
    }
    case 'suit':
    case 'blazer': {
      if (style === 'suit') {
        if (!f) tie(s, b === 'm' ? 12 : 11, 29.5, 1.2);
        buttons([0], [b === 'm' ? 10.5 : 9.5, b === 'm' ? 6 : 5]);
        // pochette, poches à rabat, brassard (bande lumineuse) porté sur la poitrine
        dec(6, 20, SLOT.ACCENT);
        dec(7, 20, SLOT.ACCENT);
      } else {
        // chaîne d'or sur le col roulé, broche lumineuse
        for (let i = 0; i <= 8; i++) dec(-4 + i, 23 - Math.sin((i / 8) * Math.PI) * 4, SLOT.ACCENT);
        dec(6, 21, SLOT.NEON);
      }
      for (const sx of [-1, 1]) for (let x = 4; x <= 8; x++) dec(sx * x, 2, XS.COAT_D);
      for (let y = -5; y <= 22; y++) s.back(0, y, XS.COAT_D);
      break;
    }
    case 'turtle': {
      for (let y = 26; y <= 34; y += 2) s.paintSurf((x, yy, z, c) => (Math.abs(yy - y) < 0.5 && c === SLOT.COAT && yy > 26 ? XS.COAT_D : c));
      for (let i = 0; i <= 8; i++) dec(-4 + i, 20 - Math.sin((i / 8) * Math.PI) * 3, SLOT.ACCENT);
      break;
    }
    case 'bomber': {
      // fermeture éclair, écusson lumineux, poche de manche (sur le bras), coutures
      for (let y = -5; y <= 21; y++) dec(0, y, SLOT.ACCENT);
      for (let x = 4; x <= 6; x++) for (let y = 19; y <= 21; y++) dec(x, y, y === 20 && x === 5 ? SLOT.NEON : SLOT.COAT2);
      for (const sx of [-1, 1]) for (let y = 0; y <= 8; y++) dec(sx * (5 + y * 0.18), y, XS.COAT_D);
      for (let x = -9; x <= 9; x++) s.back(x, 20, XS.COAT_D);
      break;
    }
    case 'hoodie': {
      // poche kangourou, cordons, imprimé lumineux
      for (let x = -5; x <= 5; x++) dec(x, 6, XS.COAT_D);
      for (const sx of [-1, 1]) for (let y = -3; y <= 6; y++) dec(sx * (5 + (6 - y) * 0.15), y, XS.COAT_D);
      for (const sx of [-1.4, 1.4]) for (let y = 21; y <= 26; y++) dec(sx, y, SLOT.TIE);
      for (const [x, y] of [
        [0, 13],
        [-1, 14],
        [1, 14],
        [-2, 15],
        [2, 15],
        [0, 16],
      ])
        dec(x, y, SLOT.NEON);
      break;
    }
    case 'track': {
      // empiècement d'épaules, bandes latérales, fermeture, chaîne en or
      s.paintSurf((x, y, z, c) => (c === SLOT.COAT && y > 22 ? SLOT.COAT2 : c));
      s.paintSurf((x, y, z, c, nx) => (c === SLOT.COAT && nx !== 0 && Math.abs(z - P(y)[2]) < 1.4 ? SLOT.TIE : c));
      for (let y = -5; y <= 29; y++) dec(0, y, SLOT.ACCENT);
      for (let i = 0; i <= 8; i++) dec(-4 + i, 22 - Math.sin((i / 8) * Math.PI) * 4.5, SLOT.ACCENT);
      break;
    }
    case 'leather':
    case 'crow': {
      // fermeture en biais, ceinture, clous d'épaules, poche zippée
      for (let y = -4; y <= 17; y++) dec(3 - y * 0.18, y, SLOT.ACCENT);
      s.paintSurf((x, y, z, c) => (c === SLOT.COAT && y < -3.5 ? SLOT.COAT2 : c));
      dec(-4, -4.5, SLOT.ACCENT);
      for (let x = -8; x <= -5; x++) dec(x, 12, SLOT.ACCENT);
      for (const sx of [-1, 1]) for (const x of [7, 8.5]) dec(sx * x, 27, SLOT.ACCENT);
      if (style === 'crow') {
        // corbeau aux ailes déployées dans le dos, œil rouge
        const crow = ['#...........#', '##.........##', '.###.....###.', '..####.####..', '....#####....', '.....###.....', '.....###.....', '....#.#.#....'];
        crow.forEach((row, j) => {
          for (let i = 0; i < row.length; i++) if (row[i] === '#') s.back(-6 + i, 24 - j * 1.6, SLOT.COAT2);
        });
        s.back(-1, 18, SLOT.NEON);
        s.back(0, 18, SLOT.NEON);
      }
      break;
    }
    case 'tech': {
      // liserés lumineux, poches, boucle de poitrine, fermeture décentrée
      for (let y = 15; y <= 27; y++) dec(4.2, y, SLOT.NEON);
      dec(0, 14, SLOT.ACCENT);
      dec(1, 14, SLOT.ACCENT);
      for (let x = -8; x <= -4; x++) for (let y = 3; y <= 7; y++) dec(x, y, y === 7 ? SLOT.COAT2 : XS.DRESS_D);
      for (let y = -5; y <= 13; y++) dec(1.5, y, SLOT.COAT2);
      for (let y = 4; y <= 10; y++) s.back(0, y, SLOT.NEON);
      break;
    }
    case 'armor': {
      // témoins lumineux, écusson, arêtes du plastron
      for (let x = -4; x <= 4; x++) dec(x, 26, SLOT.NEON);
      dec(6, 22, SLOT.ACCENT);
      dec(7, 22, SLOT.ACCENT);
      s.paintSurf((x, y, z, c, nx, ny) => (c === SLOT.VEST && ny > 0 ? XS.VEST_D : c));
      break;
    }
    case 'tactical': {
      // plaque (insigne d'or), bande nominative, bandeau LED, poches, dos réfléchissant
      for (const [x, y] of [
        [-6, 22],
        [-5, 22],
        [-6, 21],
        [-5, 21],
      ])
        dec(x, y, SLOT.ACCENT);
      for (let x = 3; x <= 7; x++) dec(x, 19, SLOT.SHIRT);
      for (let x = -8; x <= 8; x++) dec(x, 16, SLOT.LED);
      for (let x = -8; x <= 8; x++) {
        s.back(x, 20, SLOT.SHIRT);
        s.back(x, 19, SLOT.SHIRT);
        s.back(x, 14, SLOT.LED);
      }
      dec(-3, 25, SLOT.NEON);
      dec(3, 25, SLOT.NEON);
      s.paintSurf((x, y, z, c, nx, ny) => (c === SLOT.VEST && ny > 0 ? XS.VEST_D : c));
      break;
    }
    case 'puffer': {
      for (let y = -5; y <= 30; y++) dec(0, y, SLOT.ACCENT);
      break;
    }
    case 'trench': {
      // deux rangées de boutons, empiècement, ceinture et boucle
      buttons([-4, 4], [4, 9, 14, 18]);
      dec(-1, 0, SLOT.ACCENT);
      dec(0, 0, SLOT.ACCENT);
      dec(1, 0, SLOT.ACCENT);
      s.paintSurf((x, y, z, c, nx, ny) => (c === SLOT.COAT && ny > 0 && y > 20 ? XS.COAT_L : c));
      for (let y = 2; y <= 24; y++) s.back(0, y, XS.COAT_D);
      break;
    }
    case 'tee': {
      // imprimé graphique (losange lumineux)
      for (let i = -3; i <= 3; i++)
        for (let j = -3; j <= 3; j++) {
          const d = Math.abs(i) + Math.abs(j);
          if (d === 3) dec(i, 16 + j, SLOT.COAT2);
          else if (d === 1) dec(i, 16 + j, SLOT.NEON);
        }
      break;
    }
    case 'workvest': {
      // bandes réfléchissantes horizontales et verticales
      s.paintSurf((x, y, z, c) => (c === SLOT.VEST && ((y > 4 && y < 6) || (y > 13 && y < 15)) ? SLOT.LED : c));
      s.paintSurf((x, y, z, c) => (c === SLOT.VEST && y > 15 && Math.abs(Math.abs(x) - 5) < 0.8 ? SLOT.LED : c));
      break;
    }
    case 'mandarin': {
      // brandebourgs et passepoil jade, sapèque lumineuse dans le dos
      for (let y = -5; y <= 31; y++) dec(0, y, SLOT.COAT2);
      for (const y of [4, 9, 14, 19, 24]) for (let x = -2; x <= 2; x++) dec(x, y, SLOT.COAT2);
      const coin = ['..###..', '.#...#.', '#..#..#', '#.###.#', '#..#..#', '.#...#.', '..###..'];
      coin.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) if (row[i] === '#') s.back(-3 + i, 22 - j, SLOT.COAT2);
      });
      s.back(0, 19, SLOT.NEON);
      break;
    }
    case 'crop': {
      dec(0, 4.5, XS.SKIN_D);
      dec(5, 21, SLOT.NEON);
      break;
    }
    case 'dress': {
      dec(0, 24, SLOT.ACCENT);
      s.paintSurf((x, y, z, c) => (c === SLOT.DRESS && y < 1 && y > -1 ? SLOT.COAT2 : c));
      break;
    }
  }
  // ombre des plis sous la poitrine et à la taille (vêtements unis)
  s.paintSurf((x, y, z, c, nx, ny) => {
    if (ny < 0 && c === SLOT.COAT) return XS.COAT_D;
    if (ny < 0 && c === SLOT.SHIRT) return XS.SHIRT_D;
    return c;
  });
  void fz;
  void hash3;
  void backSide;
  return s.m;
}

/** Cravate (lavallière si ascot) : nœud et pans, en léger relief. */
function tie(s: Sculpt, yLow: number, yTop: number, w: number, ascot = false): void {
  for (let y = Math.ceil(yLow); y <= yTop; y++) {
    const knot = y > yTop - 2;
    const hw = ascot ? (knot ? 1 : 1.5 + (yTop - 2 - y) * 0.15) : knot ? 0.9 : w * (0.6 + 0.4 * clamp01((yTop - 2 - y) / (yTop - yLow)));
    for (let x = -Math.floor(hw); x <= Math.floor(hw); x++) {
      const z = s.frontZ(x, y);
      if (!Number.isFinite(z)) continue;
      s.set(x, y, z + 1, knot || Math.abs(x) < hw - 0.5 ? SLOT.TIE : SLOT.TIE);
    }
  }
  // pointe
  const z = s.frontZ(0, yLow - 1);
  if (Number.isFinite(z) && !ascot) s.set(0, yLow - 1, z + 1, SLOT.TIE);
}

// ===================================================================== bassin

/** Style du bassin assorti à chaque torse. */
export function pelvisOf(t: TorsoStyle): PelvisStyle {
  switch (t) {
    case 'longcoat':
      return 'open';
    case 'frock':
      return 'frock';
    case 'suit':
    case 'blazer':
    case 'mandarin':
      return 'jacket';
    case 'trench':
      return 'trench';
    case 'hoodie':
    case 'puffer':
    case 'bomber':
    case 'track':
    case 'workvest':
      return 'hem';
    case 'tactical':
      return 'duty';
    case 'armor':
      return 'armor';
    case 'tech':
      return 'tech';
    case 'dress':
      return 'skirt';
    case 'crop':
      return 'crop';
    default:
      return 'belt';
  }
}

/** Bassin : origine à l'articulation lombaire (même point que le torse). */
export function pelvis(style: PelvisStyle, b: Build): VoxelModel {
  const s = new Sculpt(-16.5, 16.5, -17, 5, -12.5, 12.5);
  const layers: Layer[] = [];
  const P = (y: number) => PELVIS[b](y);
  const front = (y: number, z: number) => z > P(y)[2] + 1.5;
  const pants: Layer = { t: 0.6, col: SLOT.PANTS };
  const belt = (y0: number, y1: number): Layer => ({ t: 1.1, y0, y1, col: SLOT.SHOES });
  switch (style) {
    case 'belt':
      layers.push(belt(-2.5, 0), pants);
      break;
    case 'crop':
      layers.push(belt(-2.5, 0), { t: 0.6, y0: 0, col: SLOT.SKIN }, pants);
      break;
    case 'jacket':
      // pans de la veste sur les hanches, ouverts devant en bas
      layers.push({ t: T.jacket + 0.4, y0: -11.5, on: (x, y, z) => !(front(y, z) && Math.abs(x) < Math.max(0, -y - 1) * 0.45), col: SLOT.COAT }, pants);
      break;
    case 'open':
      // manteau ouvert : bords doublés, pointe du gilet et pantalon au milieu
      layers.push(
        { t: T.coat + 0.6, on: (x, y, z) => !(front(y, z) && Math.abs(x) < 3.6 + Math.max(0, -y) * 0.45), col: SLOT.COAT },
        { t: T.vest, y0: -2.5, on: (x, y, z) => front(y, z) && Math.abs(x) < 3.6 - (y > -1 ? 0 : -y * 1.2), col: SLOT.VEST },
        belt(-3.5, -2),
        pants,
      );
      break;
    case 'frock':
      layers.push({ t: T.coat + 0.6, on: (x, y, z) => !(front(y, z) && Math.abs(x) < Math.max(0, -y - 1.5) * 0.7), col: SLOT.COAT }, pants);
      break;
    case 'trench':
      layers.push({ t: T.coat + 0.6, on: (x, y, z) => !(front(y, z) && Math.abs(x) < Math.max(0, -y - 2) * 0.3), col: SLOT.COAT }, pants);
      break;
    case 'hem':
      layers.push({ t: T.jacket + 0.4, y0: -4, col: (x, y) => (y < -2.5 ? SLOT.COAT2 : SLOT.COAT) }, pants);
      break;
    case 'duty':
      layers.push({ t: 2.2, y0: -4.5, y1: -0.5, col: (x, y) => (y > -1.5 || y < -3.5 ? XS.DRESS_D : SLOT.DRESS) }, pants);
      break;
    case 'armor':
      layers.push({ t: 2.0, y0: -4, y1: 0, col: SLOT.DRESS }, { t: 2.0, y0: -11, y1: -4, on: (x, y, z) => Math.abs(x) > 6, col: SLOT.VEST }, pants);
      break;
    case 'tech':
      layers.push({ t: 1.6, y0: -3.5, y1: -0.5, col: SLOT.DRESS }, pants);
      break;
    case 'skirt':
      layers.push({ t: 0.9, col: SLOT.DRESS });
      break;
  }
  layers.push({ t: 0, col: SLOT.SKIN });
  layers.sort(byT);
  s.add((x, y, z) => evalLayers(layers, (x2, y2, z2, t) => inPelvis(b, x2, y2, z2, t), x, y, z));
  // détails : boucle de ceinture, braguette, poches, étuis
  const dec = (x: number, y: number, c: Col) => s.front(x, y, c);
  switch (style) {
    case 'belt':
    case 'crop':
      dec(0, -1, SLOT.ACCENT);
      dec(-1, -1, SLOT.ACCENT);
      dec(1, -1, SLOT.ACCENT);
      for (let y = -11; y <= -4; y++) dec(0.6, y, XS.PANTS_D);
      break;
    case 'open':
      dec(0, -3, SLOT.ACCENT);
      for (let y = -11; y <= -5; y++) dec(0.6, y, XS.PANTS_D);
      // fil lumineux le long des bords du manteau
      s.paintSurf((x, y, z, c) => {
        if (c !== SLOT.COAT || !front(y, z)) return c;
        const edge = 3.6 + Math.max(0, -y) * 0.45;
        return Math.abs(x) < edge + 1 ? SLOT.COAT2 : c;
      });
      break;
    case 'duty': {
      // étuis, boucle, holster à droite (−X)
      dec(0, -2.5, SLOT.ACCENT);
      for (const x of [-6, -4, 4, 6]) for (let y = -6; y <= -3; y++) dec(x, y, SLOT.DRESS);
      s.add((x, y, z) => (x < -9 && x > -12.5 && y > -10 && y < -1 && z > -2 && z < 3 ? (y > -3 ? SLOT.DRESS : GUN) : -1));
      break;
    }
    case 'tech':
      dec(0, -2, SLOT.NEON);
      s.add((x, y, z) => (x > 8.5 && x < 11.5 && y > -9 && y < -2 && z > -2 && z < 2.5 ? (y > -3 ? SLOT.DRESS : XS.DRESS_D) : -1));
      break;
    case 'armor':
      dec(0, -2, SLOT.ACCENT);
      break;
    case 'jacket':
      for (const sx of [-1, 1]) for (let x = 3; x <= 7; x++) dec(sx * x, -5, XS.COAT_D);
      break;
  }
  return s.m;
}

// ===================================================================== bras

const UPPER: Record<Build, Prof> = {
  // [y, demi-largeur, demi-profondeur, centre z, décalage latéral]
  m: steps([
    [-21.5, 1.5, 1.5, 0, 0],
    [-20.5, 2.5, 2.5, 0, 0],
    [-13, 2.5, 3.5, 0, 0],
    [-6, 3, 3.5, 0, 0.5],
    [2, 2, 3.5, 0, 0.5],
    [4],
  ]),
  f: steps([
    [-20.5, 1.5, 1.5, 0, 0],
    [-19.5, 2.5, 2.5, 0, 0],
    [-6, 3, 2.5, 0, 0.5],
    [1.5, 2, 2.5, 0, 0.5],
    [3.5],
  ]),
};

const FORE: Record<Build, Prof> = {
  m: steps([
    [-18, 1.5, 1.5, 0, 0],
    [-14, 2.5, 2.5, 0, 0],
    [1.5, 1.5, 2.5, 0, 0],
    [3],
  ]),
  f: steps([
    [-17.5, 1.5, 1.5, 0, 0],
    [-11, 2.5, 2.5, 0, 0],
    [1.5, 1.5, 1.5, 0, 0],
    [3],
  ]),
};

function inLimb(prof: Prof, x: number, y: number, z: number, t: number, n = LIMB_N): boolean {
  t = Math.round(t);
  const P = prof(y, tq);
  if (P[0] <= 0) return false;
  return supEll(x - P[3], z - P[2], P[0] + t, P[1] + t, n) <= 1;
}

/** Épaisseur des manches. */
const SLEEVE_T: Record<SleeveStyle, number> = {
  coat: 1,
  dadou: 1,
  even: 1,
  rib: 1,
  stripe: 1,
  puffer: 2,
  tee: 1,
  bare: 0,
  rolled: 1,
  pad: 1,
  tac: 1,
  tech: 1,
  leather: 1,
  trench: 1,
};

/** Bras (de l'épaule au coude) côté gauche ; band : brassard lumineux de faction. */
export function upperArm(style: SleeveStyle, b: Build, band: boolean): VoxelModel {
  const s = new Sculpt(-6.5, 8.5, -22, 7, -6.5, 6.5);
  const prof = UPPER[b];
  const t = SLEEVE_T[style];
  const top = b === 'm' ? 4.2 : 3.8;
  const sleeveCol: Col = style === 'tee' ? SLOT.COAT : style === 'rolled' ? SLOT.SHIRT : SLOT.COAT;
  s.add((x, y, z) => {
    // rembourrage d'épaule (vestes) et épaulière (armure)
    if (style === 'pad' && y > -8 && inEllipsoid(x, y, z, 1.2, -1, 0, 5.6, 5.4, 5.4)) return y > -6.8 ? SLOT.VEST : XS.VEST_D;
    if (style === 'puffer' && (((y + 40) % 5) + 5) % 5 < 0.7 && inLimb(prof, x, y, z, t - 0.8)) return XS.COAT_D;
    if (!inLimb(prof, x, y, z, t)) return -1;
    if (y > top + t) return -1;
    if (style === 'bare') return SLOT.SKIN;
    if (style === 'tee' && y < -7) return inLimb(prof, x, y, z, 0) ? SLOT.SKIN : -1;
    if (style === 'tee' && y < -6 && !inLimb(prof, x, y, z, 0.1)) return SLOT.COAT2;
    return sleeveCol;
  });
  if (style === 'tee')
    s.carve((x, y, z) => y < -7 && !inLimb(prof, x, y, z, 0));
  // coutures, rayures, brassard
  s.paintSurf((x, y, z, c, nx) => {
    if (style === 'stripe' && c === SLOT.COAT && Math.abs(z) < 1 && x > 1.5) return SLOT.TIE;
    if (style === 'tech' && c === SLOT.COAT && Math.abs(z) < 0.6 && x > 1.5 && y < 0) return SLOT.NEON;
    if (style === 'tac' && c === SLOT.COAT && y > -7 && y < -2 && x > 2 && Math.abs(z) < 2) return y > -3 ? SLOT.ACCENT : SLOT.VEST;
    if (style === 'leather' && c === SLOT.COAT && y > 1 && x > 1.5) return XS.COAT_L;
    return c;
  });
  if (band) {
    // brassard de faction : bande sombre en relief, deux rangées lumineuses
    const y0 = style === 'pad' ? -12 : -9;
    const col = (y: number) => (y < y0 - 1 && y > y0 - 4 ? SLOT.NEON : SLOT.ARMBAND);
    s.paint((x, y, z, c) => (y < y0 - 5 || y > y0 || c === SLOT.SKIN ? c : col(y)));
    s.add((x, y, z) => (y > y0 - 5 && y < y0 && inLimb(prof, x, y, z, t + 1) ? col(y) : -1));
  }
  // creux du coude ombré
  s.paintSurf((x, y, z, c, nx, ny, nz) => (c === SLOT.COAT && y < -16 && nz > 0 ? XS.COAT_D : c));
  return s.m;
}

/** Avant-bras (du coude au poignet) côté gauche. */
export function forearm(style: SleeveStyle, b: Build): VoxelModel {
  const s = new Sculpt(-5.5, 5.5, -19, 4, -5.5, 5.5);
  const prof = FORE[b];
  const t = SLEEVE_T[style];
  const wrist = -DIMS[b].fore;
  // la manche s'arrête au-dessus du poignet (manchette de chemise visible)
  const cuffY = wrist + 1.6;
  const bareFore = style === 'tee' || style === 'bare' || style === 'rolled';
  s.add((x, y, z) => {
    const cap = 0;
    if (bareFore) {
      if (style === 'rolled' && y > -3 && inLimb(prof, x, y, z, 1.1 - cap)) return y > -1 ? SLOT.SHIRT : XS.SHIRT_D;
      if (!inLimb(prof, x, y, z, -cap)) return -1;
      if (y < wrist + 2.2 && y > wrist + 1) return SLOT.DRESS;
      return SLOT.SKIN;
    }
    // manchette de chemise et poignet
    if (y < cuffY) return inLimb(prof, x, y, z, style === 'tac' || style === 'tech' || style === 'pad' ? 0.6 : 0.4) ? (style === 'tac' || style === 'tech' || style === 'pad' ? SLOT.DRESS : style === 'rib' || style === 'stripe' || style === 'puffer' || style === 'leather' ? SLOT.SKIN : SLOT.SHIRT) : -1;
    // revers de manche des parrains, bord-côte des blousons
    const turn = style === 'dadou' || style === 'even' ? 3 : style === 'rib' || style === 'stripe' ? 2 : style === 'trench' ? 2 : 0;
    if (inLimb(prof, x, y, z, t - cap)) {
      if (turn && y < cuffY + turn) return style === 'dadou' ? (y > cuffY + turn - 1 ? SLOT.NEON : SLOT.COAT2) : SLOT.COAT2;
      if (style === 'puffer' && (((y + 40) % 5) + 5) % 5 < 0.7 && !inLimb(prof, x, y, z, t - 0.8)) return XS.COAT_D;
      return SLOT.COAT;
    }
    return -1;
  });
  s.paintSurf((x, y, z, c, nx, ny, nz) => {
    if (style === 'stripe' && c === SLOT.COAT && Math.abs(z) < 1 && x > 1) return SLOT.TIE;
    if (style === 'tech' && c === SLOT.COAT && Math.abs(z) < 0.6 && x > 1) return SLOT.NEON;
    // plis au creux du coude
    if (c === SLOT.COAT && y > -4 && nz > 0 && (y > -1.5 || y < -3)) return XS.COAT_D;
    return c;
  });
  // boutons de manchette (or ou argent), montre connectée
  if (style === 'dadou' || style === 'coat' || style === 'even' || style === 'trench') s.side(1, cuffY - 0.5, 0, SLOT.ACCENT);
  if (style === 'even') for (const y of [cuffY + 4, cuffY + 5.5]) s.side(1, y, 0.5, SLOT.ACCENT);
  if (bareFore) s.side(1, wrist + 1.5, 0, SLOT.NEON);
  return s.m;
}

// ===================================================================== mains

/**
 * Main gauche (origine au poignet, doigts vers −Y au repos) : paume vers −X (vers le
 * corps), dos de la main vers +X, pouce vers l'avant (+Z).
 * - relax : doigts légèrement repliés ;
 * - fist : poing fermé ;
 * - grip : refermée sur une poignée d'axe Z centrée en GRIP_POINT (armes) ;
 * - flat : main ouverte (gestes, volant).
 */
export function hand(pose: HandPose, b: Build, wear: HandWear): VoxelModel {
  const s = new Sculpt(-5.5, 3.5, -14, 2, -5.5, 6.5);
  const k = b === 'f' ? 0.9 : 1;
  const glove = wear === 'glove' || wear === 'tac';
  const C: Col = glove ? SLOT.DRESS : SLOT.SKIN;
  const D: Col = glove ? XS.DRESS_D : XS.SKIN_D;
  const L: Col = glove ? SLOT.DRESS : XS.SKIN_L;
  const palmBot = -6.4 * k;
  const g = GRIP[b];
  s.add((x, y, z) => {
    // poignet
    if (y > -1.6 && y <= 1.5 && supEll(x, z - 0.1, 1.8 * k, 2.0 * k, 2.2) <= 1) return C;
    // paume
    if (y <= -1.2 && y > palmBot && x > -1.4 * k && x < 1.25 * k && z > -2.6 * k && z < 2.4 * k) {
      // dos bombé : les coins arrière s'arrondissent
      if (x > 0.4 && Math.abs(z) > 2 * k && y > -2) return -1;
      return C;
    }
    // pouce
    const th =
      pose === 'fist'
        ? segDist(x, y, z, -0.6, -2.4 * k, 2.4 * k, -2.3, palmBot - 0.6, 1.0)
        : pose === 'grip'
          ? segDist(x, y, z, -0.6, -2.3 * k, 2.6 * k, g[0] - 1.2, g[1] + 0.8, 2.6 * k)
          : pose === 'flat'
            ? segDist(x, y, z, -0.4, -2.2 * k, 2.6 * k, -0.8, -6.2 * k, 3.6 * k)
            : segDist(x, y, z, -0.6, -2.2 * k, 2.6 * k, -1.7, -6.6 * k, 3.4 * k);
    if (th < 0.95 * k) return C;
    // doigts
    if (z < -2.5 * k || z > 2.2 * k) return -1;
    if (pose === 'flat') return y <= palmBot && y > palmBot - 5.6 * k && x > -1.1 && x < 0.9 ? C : -1;
    if (pose === 'relax') {
      if (y > palmBot || y < palmBot - 5.2 * k) return -1;
      const u = (palmBot - y) / (5.2 * k);
      const cx = -0.1 - u * u * 1.9;
      return Math.abs(x - cx) < 1.15 ? C : -1;
    }
    if (pose === 'fist') {
      // doigts repliés sous la paume (bloc des phalanges)
      return y <= palmBot + 0.4 && y > palmBot - 2.9 * k && x > -3.0 * k && x < 1.2 * k ? C : -1;
    }
    // grip : anneau autour de la poignée
    const dx = x - g[0];
    const dy = y - g[1];
    const r = Math.hypot(dx, dy);
    if (y > palmBot + 0.5) return -1;
    return r > g[2] && r < g[2] + 1.9 && (dx > -0.6 || dy < 0.8) ? C : -1;
  });
  // détails : jointures, plis, ongles, bagues
  s.paintSurf((x, y, z, c, nx, ny, nz) => {
    if (c !== C) return c;
    if (!glove && pose !== 'flat' && Math.abs(y - (palmBot - 0.2)) < 0.6 && nx > 0) return L;
    if (nx < 0 && y < -2 && y > palmBot + 0.5) return D;
    if (ny < 0) return D;
    return c;
  });
  if (wear === 'rings' || wear === 'signet') {
    // bagues d'or à l'annulaire et à l'auriculaire, chevalière
    s.paintSurf((x, y, z, c, nx) => {
      if (c !== C || nx <= 0) return c;
      const yy = pose === 'grip' ? g[1] + 1.5 : palmBot - 1.2;
      if (Math.abs(y - yy) < 0.6 && (z < -0.8 || (wear === 'signet' && z > -0.2 && z < 0.8))) return SLOT.ACCENT;
      return c;
    });
  }
  if (wear === 'tac') s.paintSurf((x, y, z, c, nx) => (c === C && nx > 0 && y < -2 && y > palmBot ? XS.DRESS_D : c));
  return s.m;
}

/** Centre de la poignée tenue par la main gauche (x, y en voxels, rayon) : axe selon Z. */
export const GRIP: Record<Build, [number, number, number]> = {
  m: [-1.9, -8.2, 1.3],
  f: [-1.7, -7.6, 1.2],
};

// ===================================================================== jambes

const THIGH: Record<Build, Prof> = {
  m: steps([
    [-31, 2.5, 2, 0.5, 0],
    [-30, 3.5, 3, 0.5, 0],
    [-27, 3.5, 4, 0.5, 0],
    [-21, 4.5, 5, 0.5, 0],
    [-12, 4.5, 5.5, 0, 0],
    [-5, 5.5, 5.5, 0, 0],
    [4, 4.5, 4.5, 0, 0],
    [6],
  ]),
  f: steps([
    [-31, 2.5, 2, 0.5, 0],
    [-30, 3.5, 3, 0.5, 0],
    [-23, 4.5, 4, 0.5, 0],
    [-13, 4.5, 5.5, 0, 0],
    [-7, 5, 5.5, 0, 0.5],
    [4, 4.5, 4.5, 0, 0],
    [6],
  ]),
};

const SHIN: Record<Build, Prof> = {
  m: steps([
    [-28.5, 1.5, 1.5, 0, 0],
    [-27.5, 2.5, 2.5, 0, 0],
    [-20, 2.5, 3, -0.5, 0],
    [-14, 3.5, 4, -0.5, 0],
    [-5, 3.5, 3.5, 0, 0],
    [1, 2.5, 3, 0.5, 0],
    [3],
  ]),
  f: steps([
    [-28.5, 1.5, 1.5, 0, 0],
    [-27.5, 2.5, 2.5, 0, 0],
    [-16, 2.5, 3, -0.5, 0],
    [-5, 3.5, 3.5, 0, 0],
    [1, 2.5, 3, 0.5, 0],
    [3],
  ]),
};

const LEG_T: Record<LegStyle, number> = { pants: 1, cargo: 1, jeans: 1, track: 1, armor: 1, bare: 0, tights: 0 };

/** Cuisse gauche : origine à la hanche. */
export function thigh(style: LegStyle, b: Build): VoxelModel {
  const s = new Sculpt(-6.5, 7.5, -32, 7, -7.5, 7.5);
  const t = LEG_T[style];
  const c: Col = style === 'bare' ? SLOT.SKIN : SLOT.PANTS;
  s.add((x, y, z) => {
    return inLimb(THIGH[b], x, y, z, t) ? c : -1;
  });
  s.paintSurf((x, y, z, col, nx, ny, nz) => {
    if (col !== SLOT.PANTS) return col;
    // pli du pantalon, couture extérieure, plis à l'aine et derrière le genou
    if ((style === 'pants' || style === 'track') && nz > 0 && Math.abs(x - 0.2) < 0.6) return XS.PANTS_D;
    if (style === 'track' && nx > 0 && Math.abs(z) < 1.2) return SLOT.TIE;
    if (style === 'jeans' && nx > 0 && Math.abs(z) < 0.6) return XS.PANTS_D;
    if (nz < 0 && y < -24) return XS.PANTS_D;
    return col;
  });
  if (style === 'cargo') {
    // poche à soufflet sur le côté extérieur
    s.add((x, y, z) => (y < -9 && y > -17 && Math.abs(z) < 2.6 && x > 3 && inLimb(THIGH[b], x, y, z, t + 0.9) ? (y > -10 ? XS.PANTS_D : SLOT.PANTS) : -1));
  }
  if (style === 'armor') s.add((x, y, z) => (y < -4 && y > -16 && z > 0 && inLimb(THIGH[b], x, y, z, t + 1.2) ? SLOT.VEST : -1));
  if (style === 'jeans') {
    for (let y = -8; y >= -12; y--) s.front(2.5, y, XS.PANTS_D);
  }
  return s.m;
}

/** Jambe gauche (du genou à la cheville) : origine au genou. */
export function shin(style: LegStyle, foot: FootStyle, b: Build): VoxelModel {
  const s = new Sculpt(-6.5, 6.5, -30, 5, -7.5, 7.5);
  const t = LEG_T[style];
  const boot = foot === 'boot' || foot === 'kneepad';
  const bootTop = -17;
  const wide = style === 'pants' || style === 'track' || style === 'cargo';
  const ankle = -DIMS[b].shin;
  s.add((x, y, z) => {
    const cap = 0;
    const P = SHIN[b](y, tq);
    if (boot && y < bootTop) {
      // tige de rangers : lacée devant, plus large que la cheville
      if (y < ankle - 1.6) return -1;
      const r = supEll(x, z - P[2] * 0.5 + 0.2, 3.3, 3.7, 2.4);
      return r <= 1 ? (y > bootTop - 1.2 ? XS.SHOES_L : SLOT.SHOES) : -1;
    }
    if (P[0] <= 0) return -1;
    let inside = supEll(x - P[3], z - P[2], P[0] + t, P[1] + t, LIMB_N) <= 1;
    // jambe de pantalon droite (tombe sur la chaussure), bouffante au-dessus des rangers
    if (!inside && wide && y < -4) inside = supEll(x, z, boot && y < bootTop + 3 ? 4.5 : 3.5, boot && y < bootTop + 3 ? 4.5 : 3.5, LIMB_N) <= 1;
    if (!inside) return -1;
    if (y < ankle - 1.6) return -1;
    if (style === 'bare' || style === 'tights') return style === 'tights' ? SLOT.PANTS : SLOT.SKIN;
    // ourlet du pantalon sur la chaussure
    if (!boot && foot !== 'heel' && y < ankle + 1.2) return XS.PANTS_D;
    return SLOT.PANTS;
  });
  s.paintSurf((x, y, z, c, nx, ny, nz) => {
    if (c !== SLOT.PANTS) return c;
    if ((style === 'pants' || style === 'track') && nz > 0 && Math.abs(x) < 0.6) return XS.PANTS_D;
    if (style === 'track' && nx > 0 && Math.abs(z) < 1.2) return SLOT.TIE;
    if (nz < 0 && y > -4) return XS.PANTS_D;
    return c;
  });
  if (boot) {
    // lacets
    for (let y = ankle; y <= bootTop - 1; y += 2) s.front(0, y, SLOT.ACCENT);
  }
  if (foot === 'kneepad' || style === 'armor') {
    // genouillère
    s.add((x, y, z) => (y > -6 && y < 3 && z > 0.5 && inEllipsoid(x, y, z, 0, -1.5, 1.5, 3.9, 4.2, 3.6) ? (y > -1 && y < 0 && Math.abs(x) < 1.5 ? SLOT.NEON : SLOT.VEST) : -1));
  }
  return s.m;
}

/** Pied (chaussure) : origine à la cheville, semelle en y = −cheville. Symétrique. */
export function foot(style: FootStyle, b: Build): VoxelModel {
  const D = DIMS[b];
  const s = new Sculpt(-4.5, 4.5, -D.ankle - 0.5, 4, -D.heel - 1, D.toe + 1);
  const sole = -D.ankle;
  const k = b === 'f' ? 0.9 : 1;
  const heel = style === 'heel';
  s.add((x, y, z) => {
    if (z < -D.heel || z > D.toe) return -1;
    // largeur selon la position le long du pied
    const u = (z + D.heel) / (D.heel + D.toe);
    let w = (2.5 + 0.7 * Math.sin(Math.min(1, u * 1.35) * Math.PI * 0.75)) * k;
    if (u > 0.82) w *= 1 - ((u - 0.82) / 0.18) * (style === 'dress' || heel ? 0.65 : 0.4);
    if (style === 'sneaker' || style === 'boot' || style === 'kneepad') w += 0.35;
    if (Math.abs(x) > w) return -1;
    // hauteur de la tige : haute au talon, descend vers la pointe
    const instep = z < -1 ? 1.2 : z < 5 * k ? 1.2 - (z + 1) * 0.55 : -2.2 - (z - 5 * k) * 0.13;
    let topY = instep;
    if (heel) topY = z < 1 ? -1 : z < 6 ? -1.8 - (z - 1) * 0.25 : -3.0 - (z - 6) * 0.1;
    // semelle relevée à la pointe, talon des escarpins
    const bottom = sole + (u > 0.9 ? (u - 0.9) * 10 : 0);
    if (y < bottom || y > topY) return -1;
    if (heel) {
      if (y < sole + 1 && z > -D.heel + 2.5 && z < 6) return -1;
      if (y < sole + 0.9) return SOLE;
      return y > topY - 0.8 && z < 2 && z > -1 ? SLOT.SKIN : SLOT.SHOES;
    }
    const soleH = style === 'sneaker' ? 2 : style === 'boot' || style === 'kneepad' ? 1.6 : 1;
    if (y < sole + soleH) return style === 'sneaker' ? (y > sole + 1 && y < sole + 1.6 && Math.abs(x) > w - 0.6 ? SLOT.NEON : SOLE_W) : style === 'dress' ? SOLE : SOLE;
    return SLOT.SHOES;
  });
  // reflets du cuir, lacets, talon
  s.paintSurf((x, y, z, c, nx, ny) => {
    if (c !== SLOT.SHOES) return c;
    if (style === 'dress' && ny > 0 && z > 5) return XS.SHOES_L;
    if ((style === 'sneaker' || style === 'boot' || style === 'kneepad') && ny > 0 && Math.abs(x) < 1 && z > -1 && z < 5) return style === 'sneaker' ? LACE_W : SLOT.ACCENT;
    if (style === 'sneaker' && nx !== 0 && z > 0 && z < 6 && y > sole + 2 && y < sole + 3.2) return SLOT.COAT2;
    if (style === 'dress' && ny > 0 && Math.abs(x) < 0.8 && z > 0 && z < 4) return XS.SHOES_L;
    return c;
  });
  if (style === 'boot' || style === 'kneepad') s.paint((x, y, z, c) => (c === SOLE && hash3(x, y, z) > 0.6 ? SOLE_GUM : c));
  void STEEL;
  return s.m;
}

// ===================================================================== pans de manteau, jupes

/**
 * Pan de manteau gauche (droite : miroir) attaché à la hanche : coquille évasée autour de
 * l'axe du corps, de la taille au bas du manteau, doublure visible au bord avant.
 */
export function coatTail(style: TailStyle, b: Build): VoxelModel {
  const hipX = DIMS[b].hip[0];
  const hipY = DIMS[b].hip[1];
  const len = style === 'longcoat' ? 42 : style === 'frock' ? 30 : 36;
  const s = new Sculpt(-hipX - 1.5, 9.5, -len - 2, 3, -11.5, 11.5);
  // repère du pan : origine à la hanche ; axe du corps en x = −hipX
  const cx = -hipX;
  const P0 = PELVIS[b](-10);
  const bands = 3;
  const lining: Col = style === 'longcoat' ? SLOT.COAT2 : XS.COAT2_D;
  s.add((x, y, z) => {
    const yy = y + hipY; // hauteur dans le repère du bassin
    if (yy > -9 || y < -len) return -1;
    // évasement par paliers (de grandes faces planes)
    const band = Math.min(bands - 1, Math.floor(((-9 - yy) / (len - 3)) * bands));
    const a = P0[0] + T.coat + band;
    const bb = P0[1] + T.coat + band;
    const dx = x - cx;
    const dz = z - P0[2];
    if (supEll(dx, dz, a, bb, 3) > 1) return -1;
    const inner = supEll(dx, dz, a - 2, bb - 2, 3) <= 1;
    if (inner || dx < -0.5) return -1;
    // ouverture devant (plus large vers le bas)
    const open = style === 'frock' ? 3 + band * 2 : style === 'longcoat' ? 3 : 1;
    if (dz > 0 && dx < open) return -1;
    // ourlet (fil de néon de Dadou), revers de la doublure au bord avant, intérieur sombre
    if (y < -len + 1) return style === 'longcoat' ? SLOT.NEON : XS.COAT_D;
    if (dz > 0 && dx < open + 1) return lining;
    return supEll(dx, dz, a - 1, bb - 1, 3) <= 1 ? XS.COAT_D : SLOT.COAT;
  });
  // fente arrière doublée
  s.paintSurf((x, y, z, c, nx, ny, nz) => (c === SLOT.COAT && nz < 0 && Math.abs(x - cx) < 0.6 && y < -len * 0.5 ? lining : c));
  if (style === 'trench') s.front(cx + 5, -12 + 0.5, SLOT.ACCENT);
  return s.m;
}

/** Moitié gauche de jupe (droite : miroir) attachée à la hanche. */
export function skirt(style: SkirtStyle, b: Build): VoxelModel {
  const hipX = DIMS[b].hip[0];
  const hipY = DIMS[b].hip[1];
  const len = style === 'skirt' ? 16 : style === 'pencil' ? 25 : 30;
  const s = new Sculpt(-hipX - 1.5, 11.5, -len - 1, 8, -12.5, 12.5);
  const cx = -hipX;
  s.add((x, y, z) => {
    const yy = y + hipY;
    if (yy > 0 || y < -len) return -1;
    const P = PELVIS[b](Math.max(-11, yy), tq);
    // évasement par paliers (jupe évasée, midi) ; jupe droite fendue derrière
    const band = style === 'pencil' ? 0 : Math.min(2, Math.floor(clamp01((-yy - 4) / (len - hipY - 4)) * 3));
    const a = P[0] + 1 + band;
    const bb = P[1] + 1 + band;
    const dx = x - cx;
    const dz = z - P[2];
    if (supEll(dx, dz, a, bb, 3) > 1) return -1;
    if (style !== 'pencil' && yy < -10 && supEll(dx, dz, a - 2, bb - 2, 3) < 1) return -1;
    if (dx < -0.5) return -1;
    if (style === 'pencil' && dz < 0 && dx < 1 && y < -len + 6) return -1;
    return y < -len + 1 ? XS.DRESS_D : SLOT.DRESS;
  });
  // ourlet ombré
  s.paintSurf((x, y, z, c, nx, ny) => (c === SLOT.DRESS && ny < 0 ? XS.DRESS_D : c));
  void smooth;
  return s.m;
}
