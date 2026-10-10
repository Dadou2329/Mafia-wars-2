// Modèles voxel des membres des personnages (résolution 1/32 m) — New York, 2085. Chaque
// membre a son origine au point d'articulation. Les couleurs sont des emplacements de palette
// (SLOT.*) pour que chaque personnage ait sa propre tenue sans dupliquer la géométrie ; les
// liserés lumineux (SLOT.NEON) prennent la couleur de néon propre à chaque personnage
// (attribut d'instance posé par le CharacterRenderer).
// Repère : +Y en haut, +Z vers l'avant, +X vers la gauche du personnage.

import { SLOT, VoxelModel } from '../models/voxelModel';

export const RES = 1 / 32;
const SOLE = 0x141312;
const SOLE_W = 0xe2e0da;
const MOUTH = 0x7a4038;
const LIPS = 0xa8364a;
const EYE_W = 0xf2ede4;
const FRAME = 0x26282c;
const GLOVE = 0x2b2927;
const RUBBER = 0x1c1d20;

export type TorsoStyle =
  | 'longcoat' // Dadou : long manteau noir doublé de cramoisi
  | 'frock' // Even : redingote bleu marine croisée
  | 'suit' // costume ajusté
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
  | 'trench' // imperméable
  | 'tee' // t-shirt imprimé
  | 'workvest' // gilet haute visibilité
  | 'mandarin' // veste à col mao
  | 'crop' // veste courte sur un haut (femmes)
  | 'dress'; // robe
export type PelvisStyle = 'pants' | 'coat' | 'open' | 'hem' | 'duty' | 'armor' | 'skirt';
export type HeadStyle =
  | 'dadou'
  | 'even'
  | 'gino'
  | 'nina'
  | 'short'
  | 'slick'
  | 'buzz'
  | 'fade'
  | 'stubble'
  | 'beard'
  | 'goatee'
  | 'mustache'
  | 'old'
  | 'shades'
  | 'visor'
  | 'mask'
  | 'cyber'
  | 'woman'
  | 'womanTied'
  | 'womanShades'
  | 'womanVisor';
export type HatStyle =
  | 'bowler'
  | 'top'
  | 'fedora'
  | 'flatcap'
  | 'cap'
  | 'beanie'
  | 'police'
  | 'helmet'
  | 'hood'
  | 'headset'
  | 'mohawk'
  | 'ponytail'
  | 'bun'
  | 'long'
  | 'bob'
  | 'afro'
  | 'pompadour'
  | 'none';
export type TailStyle = 'longcoat' | 'frock' | 'trench' | 'none';
export type ArmStyle = 'coat' | 'cuff' | 'stripe' | 'shirt' | 'tee' | 'bare' | 'glove' | 'pad' | 'puffer' | 'dadou' | 'even';
export type LegStyle = 'pants' | 'cargo';
export type FootStyle = 'dress' | 'sneaker' | 'boot' | 'heel' | 'kneepad';
export type SkirtStyle = 'skirt' | 'pencil';
export type WeaponKind = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'knife' | 'club';

// --------------------------------------------------------------------------- outils

type M = VoxelModel;

/** Boîte aux bornes incluses (couleur -1 = creuser). */
function fill(m: M, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number): void {
  m.box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1) + 1, Math.max(y0, y1) + 1, Math.max(z0, z1) + 1, c);
}

/** Repeint les cases déjà pleines d'une boîte (bornes incluses). */
function paint(m: M, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number): void {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) if (m.get(x, y, z) >= 0) m.set(x, y, z, c);
}

/** Décalque sur la face avant : repeint la première case pleine (depuis +Z) de chaque colonne. */
function front(m: M, x0: number, x1: number, y0: number, y1: number, c: number, depth = 1): void {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      let n = 0;
      for (let z = m.sz - 1; z >= 0 && n < depth; z--)
        if (m.get(x, y, z) >= 0) {
          m.set(x, y, z, c);
          n++;
        }
    }
}

/** Décalque sur la face arrière (depuis −Z). */
function back(m: M, x0: number, x1: number, y0: number, y1: number, c: number, depth = 1): void {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      let n = 0;
      for (let z = 0; z < m.sz && n < depth; z++)
        if (m.get(x, y, z) >= 0) {
          m.set(x, y, z, c);
          n++;
        }
    }
}

/** Décalque sur les deux flancs (première case pleine depuis −X et depuis +X). */
function sides(m: M, y0: number, y1: number, z0: number, z1: number, c: number): void {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
      for (let x = 0; x < m.sx; x++)
        if (m.get(x, y, z) >= 0) {
          m.set(x, y, z, c);
          break;
        }
      for (let x = m.sx - 1; x >= 0; x--)
        if (m.get(x, y, z) >= 0) {
          m.set(x, y, z, c);
          break;
        }
    }
}

// --------------------------------------------------------------------------- torse

// Grille du torse : 18 × 19 × 12, centre entre les colonnes 8 et 9 (x = 9), z = 6. Le corps
// occupe z 2..9 (face avant en z = 9), la taille est en y = 0, le cou monte jusqu'en y = 17.
// Le maillage glouton ne fusionne que les faces d'occlusion uniforme : les volumes restent
// convexes et les détails sont peints à fleur (décalques), sauf ce qui fait la silhouette.
const TX = 9;
const TZ = 6;

/** Remplit symétriquement les colonnes à la distance d0..d1 du centre. */
function tFill(m: M, d0: number, d1: number, y0: number, y1: number, z0: number, z1: number, c: number): void {
  fill(m, TX + d0, TX + d1, y0, y1, z0, z1, c);
  fill(m, TX - 1 - d1, TX - 1 - d0, y0, y1, z0, z1, c);
}
function tFront(m: M, d0: number, d1: number, y0: number, y1: number, c: number, depth = 1): void {
  front(m, TX + d0, TX + d1, y0, y1, c, depth);
  front(m, TX - 1 - d1, TX - 1 - d0, y0, y1, c, depth);
}
function tBack(m: M, d0: number, d1: number, y0: number, y1: number, c: number, depth = 1): void {
  back(m, TX + d0, TX + d1, y0, y1, c, depth);
  back(m, TX - 1 - d1, TX - 1 - d0, y0, y1, c, depth);
}
/** Ceinture : repeint le tour du corps (cases de surface) aux hauteurs y0..y1. */
function band(m: M, y0: number, y1: number, c: number): void {
  for (let y = y0; y <= y1; y++)
    for (let z = 0; z < m.sz; z++)
      for (let x = 0; x < m.sx; x++) {
        if (m.get(x, y, z) < 0) continue;
        if (m.get(x - 1, y, z) < 0 || m.get(x + 1, y, z) < 0 || m.get(x, y, z - 1) < 0 || m.get(x, y, z + 1) < 0) m.set(x, y, z, c);
      }
}

/** Demi-largeur du torse (voxels) à la hauteur y. */
function torsoHW(y: number, fem: boolean, bulk: number): number {
  return (fem ? (y <= 6 ? 5 : 6) : y <= 3 ? 6 : 7) + bulk;
}

/** Volume du torse. fem : taille marquée et poitrine ; bulk : vêtement épais (doudoune, armure). */
function torsoBody(m: M, fem: boolean, bulk: number, c: number): void {
  for (let y = 0; y <= 14; y++) {
    const hw = torsoHW(y, fem, bulk);
    fill(m, TX - hw, TX + hw - 1, y, y, 2 - bulk, 9 + bulk, c);
  }
  // épaules arrondies
  const hw = torsoHW(14, fem, bulk);
  for (const x of [TX - hw, TX + hw - 1]) m.clear(x, 14, 2 - bulk).clear(x, 14, 9 + bulk);
  if (fem) fill(m, TX - 4, TX + 3, 8, 10, 10 + bulk, 10 + bulk, c);
}

/** Col peint sur le cou : tour complet, ou seulement l'arrière et les côtés (open). */
function neckCollar(m: M, y0: number, y1: number, c: number, open = false): void {
  paint(m, TX - 2, TX + 1, y0, y1, TZ - 2, open ? TZ - 1 : TZ + 1, c);
  if (open) {
    paint(m, TX - 2, TX - 2, y0, y1, TZ, TZ + 1, c);
    paint(m, TX + 1, TX + 1, y0, y1, TZ, TZ + 1, c);
  }
}

/** Col montant des parrains : extérieur `out`, intérieur `inner` (relief, silhouette). */
function standCollar(m: M, h: number, out: number, inner: number): void {
  tFill(m, 0, 3, 15, 14 + h, 2, 3, out);
  tFill(m, 2, 3, 15, 14 + h, 4, 7, out);
  tFill(m, 2, 2, 15, 14 + h, 4, 7, inner);
  tFill(m, 0, 1, 15, 14 + h, 3, 3, inner);
}

interface SuitOpts {
  /** Bas de l'ouverture en V. */
  low: number;
  /** Gilet (VEST) ou chemise (SHIRT) dans l'ouverture. */
  inner: number;
  lapel: number;
  /** Passepoil le long des revers. */
  edge?: number;
  tie: boolean;
}

/** Ouverture en V des vestes et manteaux : revers, gilet ou chemise, col de chemise, cravate. */
function suitFront(m: M, o: SuitOpts): void {
  for (let y = o.low; y <= 14; y++) {
    const ow = Math.min(4, 1 + Math.floor((y - o.low) * 0.45));
    tFront(m, 0, ow - 1, y, y, o.inner);
    const lw = y >= 11 ? 2 : 1;
    tFront(m, ow, ow + lw - 1, y, y, o.lapel);
    if (o.edge !== undefined && y <= 13 && y > o.low) tFront(m, ow + lw, ow + lw, y, y, o.edge);
  }
  for (let y = 11; y <= 14; y++) tFront(m, 0, Math.floor((y - 11) * 0.5) + (y >= 13 ? 1 : 0), y, y, SLOT.SHIRT);
  if (o.tie) tFront(m, 0, 0, Math.max(o.low + 2, 7), 14, SLOT.TIE);
}

export function torso(style: TorsoStyle, fem = false): VoxelModel {
  const m = new VoxelModel(18, 19, 12, RES);
  const bulk = style === 'puffer' || style === 'armor' ? 1 : 0;
  const base = style === 'tee' ? SLOT.SHIRT : style === 'dress' ? SLOT.DRESS : SLOT.COAT;
  torsoBody(m, fem, bulk, base);
  // cou
  fill(m, TX - 2, TX + 1, 15, 17, TZ - 2, TZ + 1, SLOT.SKIN);
  const hw = (y: number) => torsoHW(y, fem, bulk);
  switch (style) {
    case 'longcoat': {
      // Dadou : revers cramoisis liserés d'or, gilet cramoisi, boutons d'or
      suitFront(m, { low: 3, inner: SLOT.VEST, lapel: SLOT.COAT2, edge: SLOT.ACCENT, tie: true });
      tFront(m, 0, 0, 3, 3, SLOT.ACCENT);
      tFront(m, 0, 0, 5, 5, SLOT.ACCENT);
      // chaîne de montre en or sur le gilet, épingle de cravate
      front(m, TX + 1, TX + 1, 6, 6, SLOT.ACCENT);
      front(m, TX + 2, TX + 2, 7, 7, SLOT.ACCENT);
      tFront(m, 0, 0, 10, 10, SLOT.ACCENT);
      // fermoir doré à la taille, pans entrouverts sur la doublure
      tFront(m, 1, 1, 1, 1, SLOT.ACCENT);
      tFront(m, 0, 0, 0, 1, SLOT.COAT2);
      standCollar(m, 2, SLOT.COAT, SLOT.COAT2);
      // dos : fente doublée de cramoisi, coutures d'épaules
      tBack(m, 0, 0, 0, 4, SLOT.COAT2);
      tBack(m, 2, 6, 13, 13, SLOT.COAT2);
      break;
    }
    case 'frock': {
      // Even : redingote croisée, gilet gris perle, lavallière argent, épingle cyan
      suitFront(m, { low: 7, inner: SLOT.VEST, lapel: SLOT.COAT2, tie: true });
      tFront(m, 0, 0, 11, 11, SLOT.NEON);
      for (const y of [1, 3, 5]) tFront(m, 3, 3, y, y, SLOT.ACCENT);
      // chaîne de gousset, pochette
      front(m, TX - 2, TX - 2, 4, 4, SLOT.ACCENT);
      front(m, TX - 3, TX - 3, 5, 5, SLOT.ACCENT);
      front(m, TX + 5, TX + 5, 10, 10, SLOT.SHIRT);
      standCollar(m, 2, SLOT.COAT, SLOT.COAT2);
      tBack(m, 0, 0, 0, 3, SLOT.COAT2);
      tBack(m, 3, 3, 1, 9, SLOT.COAT2);
      break;
    }
    case 'suit': {
      suitFront(m, { low: 5, inner: SLOT.SHIRT, lapel: SLOT.COAT2, tie: true });
      tFront(m, 0, 0, 3, 3, SLOT.ACCENT);
      front(m, TX + 4, TX + 5, 10, 10, SLOT.ARMBAND);
      neckCollar(m, 15, 15, SLOT.COAT, true);
      tBack(m, 0, 0, 0, 2, SLOT.COAT2);
      break;
    }
    case 'blazer': {
      // blazer ouvert sur un col roulé, grosse chaîne, broche lumineuse
      suitFront(m, { low: 3, inner: SLOT.SHIRT, lapel: SLOT.COAT2, tie: false });
      neckCollar(m, 15, 16, SLOT.SHIRT);
      for (let y = 7; y <= 11; y++) {
        const d = Math.floor((y - 7) * 0.5) + 1;
        tFront(m, d, d, y, y, SLOT.ACCENT);
      }
      tFront(m, 0, 0, 6, 7, SLOT.ACCENT);
      front(m, TX + 5, TX + 5, 10, 10, SLOT.NEON);
      break;
    }
    case 'bomber': {
      // bord-côte en bas et au col, fermeture éclair entrouverte, écusson lumineux
      band(m, 0, 1, SLOT.COAT2);
      neckCollar(m, 15, 15, SLOT.COAT2);
      front(m, TX, TX, 2, 10, SLOT.ACCENT);
      tFront(m, 0, 0, 11, 14, SLOT.SHIRT);
      tFront(m, 1, 1, 12, 14, SLOT.SHIRT);
      front(m, TX + 3, TX + 4, 10, 10, SLOT.NEON);
      front(m, TX + 3, TX + 4, 9, 9, SLOT.COAT2);
      for (let y = 3; y <= 5; y++) tFront(m, y, y, y, y, SLOT.COAT2);
      break;
    }
    case 'hoodie': {
      band(m, 0, 0, SLOT.COAT2);
      // poche kangourou (couture sombre), cordons, imprimé lumineux en chevron
      tFront(m, 0, 3, 5, 5, SLOT.DRESS);
      tFront(m, 3, 3, 1, 4, SLOT.DRESS);
      tFront(m, 1, 1, 10, 13, SLOT.TIE);
      tFront(m, 0, 0, 7, 7, SLOT.NEON);
      tFront(m, 1, 1, 8, 8, SLOT.NEON);
      neckCollar(m, 15, 15, SLOT.COAT2);
      // capuche rabattue dans le dos
      tFill(m, 0, 3, 11, 16, 1, 1, SLOT.COAT);
      tFill(m, 0, 3, 15, 16, 2, 3, SLOT.COAT);
      tFill(m, 0, 2, 16, 16, 2, 3, SLOT.COAT2);
      break;
    }
    case 'track': {
      // empiècement d'épaules, bandes latérales, col montant, fermeture, chaîne en or
      for (let y = 11; y <= 14; y++) {
        tFront(m, 0, hw(y) - 1, y, y, SLOT.COAT2);
        tBack(m, 0, hw(y) - 1, y, y, SLOT.COAT2);
      }
      sides(m, 0, 13, 5, 6, SLOT.TIE);
      front(m, TX, TX, 0, 14, SLOT.ACCENT);
      neckCollar(m, 15, 16, SLOT.COAT2);
      for (let y = 8; y <= 12; y++) {
        const d = Math.floor((y - 8) * 0.6) + 1;
        tFront(m, d, d, y, y, SLOT.ACCENT);
      }
      tFront(m, 0, 0, 8, 8, SLOT.ACCENT);
      band(m, 0, 0, SLOT.COAT2);
      break;
    }
    case 'leather':
    case 'crow': {
      // perfecto : fermeture en biais, grands revers, ceinture, clous d'épaules
      for (let y = 1; y <= 10; y++) front(m, TX + 2 - Math.floor(y / 4), TX + 2 - Math.floor(y / 4), y, y, SLOT.ACCENT);
      for (let y = 9; y <= 14; y++) {
        const ow = y >= 12 ? 2 : 1;
        tFront(m, 0, ow - 1, y, y, SLOT.SHIRT);
        tFront(m, ow, ow + 1, y, y, SLOT.COAT2);
      }
      band(m, 0, 0, SLOT.COAT2);
      front(m, TX - 4, TX - 3, 0, 0, SLOT.ACCENT);
      tFront(m, 5, 6, 13, 13, SLOT.ACCENT);
      neckCollar(m, 15, 15, SLOT.COAT2, true);
      if (style === 'crow') {
        // corbeau aux ailes déployées dans le dos, œil rouge
        const crow = ['#..........#', '##........##', '.###....###.', '..###..###..', '....####....', '.....##.....', '.....##.....', '....#..#....'];
        crow.forEach((row, j) => {
          for (let i = 0; i < row.length; i++) if (row[i] === '#') back(m, TX - 6 + i, TX - 6 + i, 12 - j, 12 - j, SLOT.COAT2);
        });
        back(m, TX - 1, TX, 8, 8, SLOT.NEON);
      }
      break;
    }
    case 'tech': {
      // harnais : bretelles, sangle de poitrine à boucle, poche, liseré lumineux, col cheminée
      tFront(m, 3, 3, 4, 14, SLOT.DRESS);
      tBack(m, 3, 3, 4, 14, SLOT.DRESS);
      tFront(m, 0, 3, 9, 9, SLOT.DRESS);
      tFront(m, 0, 0, 9, 9, SLOT.ACCENT);
      front(m, TX + 3, TX + 3, 10, 13, SLOT.NEON);
      front(m, TX - 6, TX - 4, 3, 5, SLOT.DRESS);
      front(m, TX - 6, TX - 4, 5, 5, SLOT.COAT2);
      front(m, TX, TX, 0, 8, SLOT.COAT2);
      neckCollar(m, 15, 16, SLOT.COAT2);
      band(m, 0, 0, SLOT.DRESS);
      tBack(m, 0, 2, 4, 9, SLOT.DRESS);
      back(m, TX - 1, TX, 7, 7, SLOT.NEON);
      break;
    }
    case 'armor': {
      // plastron, plaques abdominales et dossière (VEST) sur une combinaison, col blindé,
      // témoins lumineux, écusson
      for (let y = 8; y <= 13; y++) {
        tFront(m, 0, hw(y) - 2, y, y, SLOT.VEST);
        tBack(m, 0, hw(y) - 2, y, y, SLOT.VEST);
      }
      for (const y of [1, 2, 4, 5]) tFront(m, 0, 2, y, y, SLOT.VEST);
      for (let y = 2; y <= 7; y++) tBack(m, 0, hw(y) - 3, y, y, SLOT.VEST);
      tFront(m, 1, 3, 11, 11, SLOT.NEON);
      front(m, TX + 4, TX + 5, 9, 9, SLOT.ACCENT);
      tFront(m, 0, 0, 8, 13, SLOT.DRESS);
      neckCollar(m, 15, 16, SLOT.VEST);
      // batterie dorsale
      fill(m, TX - 2, TX + 1, 5, 10, 0, 0, SLOT.DRESS);
      fill(m, TX - 1, TX, 9, 9, 0, 0, SLOT.NEON);
      break;
    }
    case 'tactical': {
      // gilet tactique sur la chemise d'uniforme : plaque, bande nominative, LED, poches
      for (let y = 2; y <= 12; y++) {
        const open = y >= 11 ? 2 : 0;
        tFront(m, open, hw(y) - 1, y, y, SLOT.VEST);
        tBack(m, 0, hw(y) - 1, y, y, SLOT.VEST);
      }
      sides(m, 2, 12, 2, 9, SLOT.VEST);
      tFront(m, 2, 3, 13, 14, SLOT.VEST);
      tBack(m, 2, 3, 13, 14, SLOT.VEST);
      tFront(m, 0, 0, 12, 14, SLOT.SHIRT);
      fill(m, TX + 2, TX + 3, 10, 11, 10, 10, SLOT.ACCENT);
      front(m, TX - 5, TX - 2, 10, 10, SLOT.SHIRT);
      tFront(m, 0, 5, 8, 8, SLOT.LED);
      front(m, TX - 3, TX - 3, 12, 12, SLOT.NEON);
      front(m, TX + 3, TX + 3, 12, 12, SLOT.NEON);
      for (const d of [0, 3]) {
        tFront(m, d, d + 1, 3, 5, SLOT.DRESS);
        tFront(m, d, d + 1, 5, 5, SLOT.VEST);
      }
      front(m, TX + 4, TX + 4, 12, 13, SLOT.DRESS);
      // dos : panneau réfléchissant et bandeau LED
      tBack(m, 0, 4, 9, 10, SLOT.SHIRT);
      tBack(m, 0, 4, 6, 6, SLOT.LED);
      neckCollar(m, 15, 15, SLOT.COAT, true);
      break;
    }
    case 'puffer': {
      // doudoune : boudins horizontaux, col montant, fermeture éclair
      for (const y of [2, 5, 8, 11]) band(m, y, y, SLOT.COAT2);
      tFill(m, 0, 3, 15, 16, 2, 9, SLOT.COAT);
      fill(m, TX - 2, TX + 1, 15, 16, 4, 9, -1);
      fill(m, TX - 2, TX + 1, 15, 17, 4, 7, SLOT.SKIN);
      front(m, TX, TX, 0, 16, SLOT.ACCENT);
      band(m, 0, 0, SLOT.COAT2);
      break;
    }
    case 'trench': {
      // imperméable croisé : revers, boutons, ceinture nouée
      suitFront(m, { low: 9, inner: SLOT.SHIRT, lapel: SLOT.COAT2, tie: !fem });
      for (const y of [4, 7]) tFront(m, 3, 3, y, y, SLOT.ACCENT);
      band(m, 1, 2, SLOT.COAT2);
      front(m, TX - 1, TX, 1, 2, SLOT.ACCENT);
      front(m, TX - 3, TX - 2, 0, 0, SLOT.COAT2);
      neckCollar(m, 15, 16, SLOT.COAT2, true);
      tBack(m, 0, 5, 11, 11, SLOT.COAT2);
      break;
    }
    case 'tee': {
      // t-shirt : col rond, imprimé graphique (couleur secondaire + néon)
      neckCollar(m, 15, 15, SLOT.SHIRT);
      tFront(m, 0, 2, 7, 11, SLOT.COAT2);
      tFront(m, 0, 1, 8, 10, SLOT.NEON);
      tFront(m, 0, 0, 9, 9, SLOT.COAT2);
      break;
    }
    case 'workvest': {
      // gilet orange à bandes réfléchissantes sur un sweat
      for (let y = 1; y <= 13; y++) {
        tFront(m, y >= 11 ? 3 : 1, hw(y) - 1, y, y, SLOT.VEST);
        tBack(m, 0, hw(y) - 1, y, y, SLOT.VEST);
      }
      sides(m, 1, 13, 2, 9, SLOT.VEST);
      for (const y of [4, 8]) {
        tFront(m, 1, hw(y) - 1, y, y, SLOT.LED);
        tBack(m, 0, hw(y) - 1, y, y, SLOT.LED);
      }
      tFront(m, 3, 3, 9, 13, SLOT.LED);
      tBack(m, 3, 3, 9, 13, SLOT.LED);
      neckCollar(m, 15, 15, SLOT.COAT);
      break;
    }
    case 'mandarin': {
      // veste à col mao, brandebourgs et passepoil jade, sapèque de jade dans le dos
      front(m, TX, TX, 0, 14, SLOT.COAT2);
      for (const y of [3, 6, 9, 12]) tFront(m, 0, 1, y, y, SLOT.COAT2);
      neckCollar(m, 15, 16, SLOT.COAT);
      paint(m, TX - 2, TX + 1, 16, 16, TZ + 1, TZ + 1, SLOT.COAT2);
      band(m, 0, 0, SLOT.COAT2);
      front(m, TX + 3, TX + 3, 11, 11, SLOT.NEON);
      const coin = ['..####..', '.#....#.', '#..##..#', '#.#..#.#', '#.#..#.#', '#..##..#', '.#....#.', '..####..'];
      coin.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) if (row[i] === '#') back(m, TX - 4 + i, TX - 4 + i, 12 - j, 12 - j, SLOT.COAT2);
      });
      back(m, TX - 1, TX, 8, 9, SLOT.NEON);
      break;
    }
    case 'crop': {
      // veste courte ouverte sur un haut moulant (et le nombril)
      for (let y = 0; y <= 6; y++) {
        tFront(m, 0, hw(y) - 1, y, y, SLOT.SHIRT);
        tBack(m, 0, hw(y) - 1, y, y, SLOT.SHIRT);
      }
      sides(m, 0, 6, 0, 11, SLOT.SHIRT);
      tFront(m, 0, 1, 1, 2, SLOT.SKIN);
      for (let y = 7; y <= 14; y++) tFront(m, 0, 1, y, y, SLOT.SHIRT);
      tFront(m, 2, 2, 7, 13, SLOT.COAT2);
      band(m, 7, 7, SLOT.COAT2);
      tFront(m, 0, 1, 7, 7, SLOT.SHIRT);
      neckCollar(m, 15, 15, SLOT.COAT2, true);
      front(m, TX + 3, TX + 3, 11, 11, SLOT.NEON);
      break;
    }
    case 'dress': {
      // robe : décolleté, ceinture fine, liseré lumineux
      tFront(m, 0, 1, 12, 14, SLOT.SKIN);
      tFront(m, 0, 0, 11, 11, SLOT.SKIN);
      band(m, 2, 2, SLOT.COAT2);
      front(m, TX - 1, TX, 2, 2, SLOT.ACCENT);
      tFront(m, 2, 2, 12, 14, SLOT.NEON);
      break;
    }
  }
  m.setOrigin(TX, 0, TZ);
  return m;
}

/** Style du bassin correspondant à chaque torse. */
export function pelvisOf(t: TorsoStyle): PelvisStyle {
  switch (t) {
    case 'longcoat':
    case 'frock':
      return 'open';
    case 'suit':
    case 'blazer':
    case 'trench':
      return 'coat';
    case 'hoodie':
    case 'puffer':
      return 'hem';
    case 'tactical':
      return 'duty';
    case 'armor':
      return 'armor';
    case 'dress':
      return 'skirt';
    default:
      return 'pants';
  }
}

/** Bassin : origine en haut (taille). 16 × 5 × 12, corps x 2..13, z 2..9. */
export function pelvis(style: PelvisStyle): VoxelModel {
  const m = new VoxelModel(16, 5, 12, RES);
  fill(m, 2, 13, 0, 4, 2, 9, SLOT.PANTS);
  switch (style) {
    case 'pants':
      // ceinture et boucle
      paint(m, 2, 13, 4, 4, 2, 9, SLOT.SHOES);
      front(m, 7, 8, 4, 4, SLOT.ACCENT);
      break;
    case 'coat':
      band(m, 1, 4, SLOT.COAT);
      front(m, 7, 8, 1, 2, SLOT.PANTS);
      break;
    case 'open':
      // manteau ouvert : doublure le long des bords, gilet et pantalon au milieu
      band(m, 0, 4, SLOT.COAT);
      front(m, 6, 6, 0, 4, SLOT.COAT2);
      front(m, 9, 9, 0, 4, SLOT.COAT2);
      front(m, 7, 8, 0, 3, SLOT.PANTS);
      front(m, 7, 8, 4, 4, SLOT.VEST);
      break;
    case 'hem':
      band(m, 3, 4, SLOT.COAT);
      band(m, 3, 3, SLOT.COAT2);
      break;
    case 'duty':
      // ceinturon de service : étuis, boucle, holster à droite
      band(m, 2, 4, SLOT.DRESS);
      front(m, 7, 8, 3, 4, SLOT.ACCENT);
      front(m, 3, 4, 2, 2, SLOT.ACCENT);
      front(m, 11, 12, 2, 2, SLOT.ACCENT);
      fill(m, 1, 1, 0, 4, 4, 7, SLOT.DRESS);
      break;
    case 'armor':
      band(m, 3, 4, SLOT.DRESS);
      for (const x of [2, 13]) paint(m, x, x, 0, 2, 3, 8, SLOT.VEST);
      front(m, 6, 9, 0, 2, SLOT.VEST);
      front(m, 7, 8, 4, 4, SLOT.ACCENT);
      break;
    case 'skirt':
      paint(m, 2, 13, 0, 4, 2, 9, SLOT.DRESS);
      band(m, 4, 4, SLOT.COAT2);
      break;
  }
  m.setOrigin(8, 5, 6);
  return m;
}

// --------------------------------------------------------------------------- jambes

/** Cuisse : origine à la hanche (haut). */
export function thigh(style: LegStyle = 'pants'): VoxelModel {
  const m = new VoxelModel(6, 14, 6, RES);
  fill(m, 0, 5, 0, 13, 0, 5, SLOT.PANTS);
  m.clear(0, 0, 0).clear(5, 0, 0).clear(0, 0, 5).clear(5, 0, 5);
  if (style === 'cargo') {
    // poches latérales à rabat (des deux côtés : le modèle sert aux deux jambes)
    for (const x of [0, 5]) {
      paint(m, x, x, 4, 8, 1, 4, SLOT.COAT2);
      paint(m, x, x, 8, 8, 1, 4, SLOT.DRESS);
    }
  }
  m.setOrigin(3, 14, 3);
  return m;
}

/** Jambe + chaussure : origine au genou (haut). Pied vers +Z. */
export function shin(style: FootStyle = 'dress'): VoxelModel {
  const m = new VoxelModel(6, 17, 12, RES);
  // jambe x 0..5, z 1..6
  fill(m, 0, 5, 4, 16, 1, 6, SLOT.PANTS);
  switch (style) {
    case 'dress':
      fill(m, 1, 4, 1, 2, 1, 9, SLOT.SHOES);
      fill(m, 1, 4, 3, 3, 1, 7, SLOT.SHOES);
      fill(m, 1, 4, 0, 0, 1, 9, SOLE);
      paint(m, 1, 4, 1, 1, 1, 1, SOLE);
      break;
    case 'sneaker':
      // basket montante : semelle épaisse claire et liseré lumineux, languette
      fill(m, 0, 5, 0, 1, 1, 10, SOLE_W);
      fill(m, 0, 5, 2, 3, 1, 9, SLOT.SHOES);
      fill(m, 0, 5, 4, 5, 1, 6, SLOT.SHOES);
      for (const x of [0, 5]) paint(m, x, x, 1, 1, 2, 9, SLOT.NEON);
      paint(m, 1, 4, 3, 3, 9, 9, SLOT.COAT2);
      paint(m, 2, 3, 4, 5, 6, 6, SLOT.SHIRT);
      break;
    case 'boot':
    case 'kneepad':
      // rangers : tige haute, semelle crantée, lacets
      fill(m, 0, 5, 1, 7, 1, 6, SLOT.SHOES);
      fill(m, 0, 5, 1, 3, 7, 9, SLOT.SHOES);
      fill(m, 0, 5, 0, 0, 1, 10, SOLE);
      for (const y of [4, 6]) paint(m, 2, 3, y, y, 6, 6, SLOT.ACCENT);
      paint(m, 1, 4, 3, 3, 9, 9, SLOT.ACCENT);
      if (style === 'kneepad') {
        // genouillère
        paint(m, 1, 4, 11, 16, 6, 6, SLOT.DRESS);
        paint(m, 2, 3, 13, 13, 6, 6, SLOT.NEON);
      }
      break;
    case 'heel':
      // bottine à talon
      fill(m, 1, 4, 1, 7, 1, 6, SLOT.SHOES);
      fill(m, 1, 4, 1, 2, 7, 9, SLOT.SHOES);
      fill(m, 1, 4, 0, 0, 6, 9, SOLE);
      fill(m, 1, 4, 0, 0, 1, 2, SOLE);
      paint(m, 1, 4, 7, 7, 1, 6, SLOT.COAT2);
      break;
  }
  m.setOrigin(3, 17, 4);
  return m;
}

// --------------------------------------------------------------------------- bras

/** Bras : origine à l'épaule. band : brassard lumineux de faction. */
export function upperArm(style: ArmStyle, band = false): VoxelModel {
  const m = new VoxelModel(7, 12, 7, RES);
  const c = style === 'shirt' ? SLOT.SHIRT : style === 'bare' ? SLOT.SKIN : SLOT.COAT;
  if (style === 'puffer') {
    // manche matelassée
    fill(m, 0, 6, 0, 9, 0, 6, c);
    fill(m, 1, 5, 10, 10, 1, 5, c);
    for (const y of [3, 6]) paint(m, 0, 6, y, y, 0, 6, SLOT.COAT2);
  } else {
    // bras x 1..5, z 1..5, épaule arrondie en haut
    fill(m, 1, 5, 0, 9, 1, 5, c);
    fill(m, 2, 4, 10, 10, 2, 4, c);
  }
  if (style === 'tee') {
    paint(m, 0, 6, 0, 5, 0, 6, SLOT.SKIN);
    paint(m, 0, 6, 6, 6, 0, 6, SLOT.COAT2);
    paint(m, 0, 6, 7, 10, 0, 6, SLOT.SHIRT);
  }
  if (style === 'stripe') for (const x of [1, 5]) paint(m, x, x, 0, 9, 3, 3, SLOT.TIE);
  if (style === 'pad') {
    // épaulière rigide (armure), témoins lumineux
    fill(m, 0, 6, 6, 10, 0, 6, SLOT.VEST);
    paint(m, 0, 6, 6, 6, 0, 6, SLOT.DRESS);
    paint(m, 0, 0, 8, 8, 2, 4, SLOT.NEON);
    paint(m, 6, 6, 8, 8, 2, 4, SLOT.NEON);
  }
  if (band) {
    const y0 = style === 'pad' ? 3 : 4;
    paint(m, 0, 6, y0, y0 + 2, 0, 6, SLOT.ARMBAND);
    paint(m, 0, 6, y0 + 1, y0 + 1, 0, 6, SLOT.NEON);
  }
  m.setOrigin(3.5, 11, 3.5);
  return m;
}

/** Main (poing légèrement fermé) en bas de l'avant-bras : couleur `c`, bagues éventuelles. */
function hand(m: M, c: number, rings?: number): void {
  fill(m, 1, 3, 0, 2, 1, 3, c);
  fill(m, 1, 3, 0, 1, 4, 4, c);
  if (rings !== undefined) {
    m.set(1, 1, 4, rings).set(3, 1, 4, rings);
    m.set(1, 2, 3, rings);
  }
}

/** Avant-bras + main : origine au coude. Manche 5 × 5 (x 0..4, z 0..4), main 3 × 3 dessous. */
export function forearm(style: ArmStyle): VoxelModel {
  const m = new VoxelModel(5, 13, 6, RES);
  const sleeve = (y0: number, c: number) => fill(m, 0, 4, y0, 12, 0, 4, c);
  switch (style) {
    case 'coat':
    case 'pad':
      sleeve(3, SLOT.COAT);
      paint(m, 0, 4, 3, 3, 0, 4, SLOT.SHIRT);
      hand(m, SLOT.SKIN);
      break;
    case 'cuff':
    case 'stripe':
    case 'puffer':
      sleeve(3, SLOT.COAT);
      paint(m, 0, 4, 3, 4, 0, 4, SLOT.COAT2);
      if (style === 'stripe') for (const x of [0, 4]) paint(m, x, x, 5, 12, 2, 2, SLOT.TIE);
      if (style === 'puffer') paint(m, 0, 4, 8, 8, 0, 4, SLOT.COAT2);
      hand(m, SLOT.SKIN);
      break;
    case 'shirt':
      sleeve(3, SLOT.SKIN);
      paint(m, 0, 4, 9, 12, 0, 4, SLOT.SHIRT);
      hand(m, SLOT.SKIN);
      break;
    case 'tee':
    case 'bare':
      sleeve(3, SLOT.SKIN);
      // bracelet connecté
      paint(m, 0, 4, 4, 4, 0, 4, SLOT.DRESS);
      m.set(2, 4, 4, SLOT.NEON);
      hand(m, SLOT.SKIN);
      break;
    case 'glove':
      sleeve(3, SLOT.COAT);
      paint(m, 0, 4, 3, 4, 0, 4, SLOT.DRESS);
      hand(m, SLOT.DRESS);
      break;
    case 'dadou':
      // manche noire, revers cramoisi liseré de néon, manchette blanche, bagues en or
      sleeve(3, SLOT.COAT);
      paint(m, 0, 4, 4, 6, 0, 4, SLOT.COAT2);
      paint(m, 0, 4, 6, 6, 0, 4, SLOT.NEON);
      paint(m, 0, 4, 3, 3, 0, 4, SLOT.SHIRT);
      m.set(0, 3, 2, SLOT.ACCENT).set(4, 3, 2, SLOT.ACCENT);
      hand(m, SLOT.SKIN, SLOT.ACCENT);
      break;
    case 'even':
      // manche bleu marine, manchette blanche, boutons de manchette d'argent, gant de cuir
      sleeve(3, SLOT.COAT);
      paint(m, 0, 4, 4, 4, 0, 4, SLOT.COAT2);
      paint(m, 0, 4, 3, 3, 0, 4, SLOT.SHIRT);
      for (const y of [3, 6, 8]) m.set(0, y, 2, SLOT.ACCENT).set(4, y, 2, SLOT.ACCENT);
      hand(m, GLOVE);
      m.set(2, 2, 3, SLOT.ACCENT);
      break;
  }
  m.setOrigin(2.5, 13, 2.5);
  return m;
}

// --------------------------------------------------------------------------- tête

// Grille de la tête : 13 × 12 × 13 ; crâne 9 × 9 × 9 en x 2..10, y 0..8, z 2..10 ; visage en
// z = 10 (FZ), nez en z = 11. u = x − 2 (0..8, centre u = 4).
const FZ = 10;
const HX = (u: number) => u + 2;

/** Tête : origine au sommet du cou (centre). Visage vers +Z. */
export function head(style: HeadStyle): VoxelModel {
  const m = new VoxelModel(13, 12, 13, RES);
  const S = SLOT.SKIN;
  const H = SLOT.HAIR;
  const fem = style === 'woman' || style === 'womanTied' || style === 'womanShades' || style === 'womanVisor' || style === 'nina';
  // crâne aux angles arrondis
  fill(m, HX(0), HX(8), 0, 8, 2, 10, S);
  for (const u of [0, 8])
    for (const z of [2, 10]) {
      m.clear(HX(u), 8, z);
      m.clear(HX(u), 0, z);
    }
  // mâchoire plus étroite (plus fine pour les femmes)
  for (const u of [0, 8]) fill(m, HX(u), HX(u), 0, 0, 7, 10, -1);
  if (fem) for (const u of [0, 8]) fill(m, HX(u), HX(u), 1, 1, 9, 10, -1);
  // oreilles
  fill(m, HX(-1), HX(-1), 4, 5, 5, 6, S);
  fill(m, HX(9), HX(9), 4, 5, 5, 6, S);
  // yeux, sourcils, nez, bouche
  m.set(HX(2), 5, FZ, SLOT.EYES).set(HX(6), 5, FZ, SLOT.EYES);
  m.set(HX(3), 5, FZ, EYE_W).set(HX(5), 5, FZ, EYE_W);
  if (fem) {
    m.set(HX(1), 6, FZ, H).set(HX(2), 6, FZ, H).set(HX(6), 6, FZ, H).set(HX(7), 6, FZ, H);
    m.set(HX(1), 5, FZ, H).set(HX(7), 5, FZ, H);
  } else {
    fill(m, HX(1), HX(3), 6, 6, FZ, FZ, H);
    fill(m, HX(5), HX(7), 6, 6, FZ, FZ, H);
  }
  fill(m, HX(4), HX(4), 3, 5, FZ + 1, FZ + 1, S);
  m.clear(HX(4), 5, FZ + 1);
  m.set(HX(4), 4, FZ + 1, S);
  fill(m, HX(3), HX(5), 1, 1, FZ, FZ, fem ? LIPS : MOUTH);
  // ------------------------------------------------ cheveux
  const hair = (kind: 'short' | 'slick' | 'buzz' | 'fade' | 'bald' | 'long' | 'tied') => {
    switch (kind) {
      case 'bald':
        fill(m, HX(0), HX(8), 3, 6, 2, 3, H);
        fill(m, HX(0), HX(0), 4, 6, 4, 6, H);
        fill(m, HX(8), HX(8), 4, 6, 4, 6, H);
        break;
      case 'buzz':
        fill(m, HX(0), HX(8), 8, 8, 2, 9, H);
        fill(m, HX(0), HX(8), 3, 8, 2, 2, H);
        fill(m, HX(0), HX(0), 6, 8, 3, 7, H);
        fill(m, HX(8), HX(8), 6, 8, 3, 7, H);
        fill(m, HX(1), HX(7), 9, 9, 3, 8, H);
        m.clear(HX(0), 8, 2).clear(HX(8), 8, 2);
        break;
      case 'fade':
        fill(m, HX(1), HX(7), 8, 8, 2, 10, H);
        fill(m, HX(1), HX(7), 9, 10, 3, 10, H);
        fill(m, HX(2), HX(6), 10, 10, 9, 10, -1);
        fill(m, HX(1), HX(7), 5, 8, 2, 2, H);
        fill(m, HX(1), HX(1), 10, 10, 3, 9, -1);
        fill(m, HX(7), HX(7), 10, 10, 3, 9, -1);
        break;
      case 'short':
      case 'slick':
        fill(m, HX(0), HX(8), 7, 8, 2, 9, H);
        fill(m, HX(0), HX(8), 2, 8, 2, 3, H);
        fill(m, HX(0), HX(0), 5, 8, 2, 7, H);
        fill(m, HX(8), HX(8), 5, 8, 2, 7, H);
        fill(m, HX(1), HX(7), 9, 9, 3, 8, H);
        if (kind === 'short') fill(m, HX(1), HX(7), 8, 8, 9, 10, H);
        else {
          fill(m, HX(1), HX(7), 9, 9, 3, 9, H);
          fill(m, HX(0), HX(8), 8, 8, 10, 10, -1);
          fill(m, HX(1), HX(7), 8, 8, 10, 10, S);
        }
        m.clear(HX(0), 2, 2).clear(HX(8), 2, 2);
        break;
      case 'long':
      case 'tied':
        // cheveux longs (ou tirés en arrière) : dessus, nuque, mèches encadrant le visage
        fill(m, HX(0), HX(8), 7, 8, 2, 9, H);
        fill(m, HX(1), HX(7), 9, 9, 3, 8, H);
        fill(m, HX(0), HX(8), kind === 'long' ? 1 : 3, 8, 2, 3, H);
        fill(m, HX(0), HX(0), kind === 'long' ? 2 : 5, 8, 2, 8, H);
        fill(m, HX(8), HX(8), kind === 'long' ? 2 : 5, 8, 2, 8, H);
        fill(m, HX(1), HX(4), 8, 8, 10, 10, H);
        fill(m, HX(1), HX(2), 7, 7, 10, 10, H);
        if (kind === 'long') {
          fill(m, HX(-1), HX(-1), 1, 7, 3, 8, H);
          fill(m, HX(9), HX(9), 1, 7, 3, 8, H);
          fill(m, HX(-1), HX(9), 1, 7, 1, 1, H);
          fill(m, HX(-1), HX(9), 0, 0, 1, 3, H);
          fill(m, HX(-1), HX(-1), 4, 5, 5, 6, H);
          fill(m, HX(9), HX(9), 4, 5, 5, 6, H);
        }
        break;
    }
  };
  switch (style) {
    case 'dadou':
      hair('slick');
      // grande moustache en guidon aux pointes relevées, dent en or
      fill(m, HX(1), HX(7), 2, 2, FZ + 1, FZ + 1, SLOT.BEARD);
      fill(m, HX(2), HX(6), 3, 3, FZ + 1, FZ + 1, SLOT.BEARD);
      fill(m, HX(0), HX(0), 3, 3, FZ, FZ + 1, SLOT.BEARD);
      fill(m, HX(8), HX(8), 3, 3, FZ, FZ + 1, SLOT.BEARD);
      fill(m, HX(-1), HX(-1), 3, 5, FZ - 1, FZ, SLOT.BEARD);
      fill(m, HX(9), HX(9), 3, 5, FZ - 1, FZ, SLOT.BEARD);
      m.set(HX(5), 1, FZ, SLOT.ACCENT);
      break;
    case 'even':
      hair('slick');
      // barbe grise taillée court, moustache
      fill(m, HX(0), HX(8), 0, 2, FZ, FZ, SLOT.BEARD);
      fill(m, HX(0), HX(0), 0, 3, 7, 10, SLOT.BEARD);
      fill(m, HX(8), HX(8), 0, 3, 7, 10, SLOT.BEARD);
      fill(m, HX(1), HX(7), 0, 0, 6, 10, SLOT.BEARD);
      fill(m, HX(2), HX(6), 2, 2, FZ + 1, FZ + 1, SLOT.BEARD);
      fill(m, HX(3), HX(5), 0, 0, FZ + 1, FZ + 1, SLOT.BEARD);
      fill(m, HX(3), HX(5), 1, 1, FZ, FZ, MOUTH);
      // monocle cybernétique sur l'œil gauche (côté +X) : cerclage d'argent, lentille cyan,
      // implant sur la tempe
      for (const [u, y] of [
        [5, 4],
        [6, 4],
        [7, 4],
        [5, 6],
        [7, 6],
        [5, 5],
        [7, 5],
        [6, 6],
      ])
        m.set(HX(u), y, FZ + 1, SLOT.ACCENT);
      m.set(HX(6), 5, FZ + 1, SLOT.NEON_CYAN);
      fill(m, HX(8), HX(8), 4, 6, FZ - 1, FZ, SLOT.ACCENT);
      fill(m, HX(9), HX(9), 5, 5, FZ - 3, FZ - 1, SLOT.ACCENT);
      m.set(HX(9), 6, FZ - 2, SLOT.NEON_CYAN);
      break;
    case 'gino':
      hair('slick');
      // fine moustache de séducteur, lunettes teintées
      fill(m, HX(2), HX(6), 2, 2, FZ + 1, FZ + 1, SLOT.BEARD);
      m.clear(HX(4), 2, FZ + 1);
      fill(m, HX(1), HX(7), 5, 5, FZ + 1, FZ + 1, SLOT.GLASS);
      fill(m, HX(1), HX(3), 4, 4, FZ + 1, FZ + 1, SLOT.GLASS);
      fill(m, HX(5), HX(7), 4, 4, FZ + 1, FZ + 1, SLOT.GLASS);
      fill(m, HX(1), HX(7), 6, 6, FZ + 1, FZ + 1, SLOT.ACCENT);
      m.clear(HX(4), 6, FZ + 1);
      fill(m, HX(0), HX(0), 5, 5, 6, 10, SLOT.ACCENT);
      fill(m, HX(8), HX(8), 5, 5, 6, 10, SLOT.ACCENT);
      m.set(HX(-1), 4, 5, SLOT.ACCENT);
      break;
    case 'nina':
      hair('tied');
      // lunettes de réalité augmentée : verre cyan, monture argent
      fill(m, HX(1), HX(7), 5, 5, FZ + 1, FZ + 1, SLOT.NEON);
      m.set(HX(4), 5, FZ + 1, SLOT.ACCENT);
      fill(m, HX(1), HX(7), 6, 6, FZ + 1, FZ + 1, SLOT.ACCENT);
      fill(m, HX(0), HX(0), 5, 6, 6, 10, SLOT.ACCENT);
      fill(m, HX(8), HX(8), 5, 6, 6, 10, SLOT.ACCENT);
      m.set(HX(9), 4, 6, SLOT.NEON);
      break;
    case 'short':
      hair('short');
      break;
    case 'slick':
      hair('slick');
      break;
    case 'buzz':
      hair('buzz');
      break;
    case 'fade':
      hair('fade');
      fill(m, HX(2), HX(6), 0, 0, FZ, FZ, SLOT.BEARD);
      break;
    case 'stubble':
      hair('short');
      fill(m, HX(1), HX(7), 0, 1, FZ, FZ, SLOT.BEARD);
      fill(m, HX(0), HX(0), 0, 2, 7, 9, SLOT.BEARD);
      fill(m, HX(8), HX(8), 0, 2, 7, 9, SLOT.BEARD);
      fill(m, HX(3), HX(5), 1, 1, FZ, FZ, MOUTH);
      break;
    case 'beard':
      hair('slick');
      fill(m, HX(0), HX(8), 0, 3, FZ, FZ, SLOT.BEARD);
      fill(m, HX(0), HX(0), 0, 5, 6, 10, SLOT.BEARD);
      fill(m, HX(8), HX(8), 0, 5, 6, 10, SLOT.BEARD);
      fill(m, HX(1), HX(7), 0, 0, 5, 9, SLOT.BEARD);
      fill(m, HX(2), HX(6), 0, 1, FZ + 1, FZ + 1, SLOT.BEARD);
      fill(m, HX(2), HX(6), 2, 2, FZ + 1, FZ + 1, SLOT.BEARD);
      fill(m, HX(3), HX(5), 1, 1, FZ + 1, FZ + 1, -1);
      fill(m, HX(3), HX(5), 1, 1, FZ, FZ, MOUTH);
      fill(m, HX(4), HX(4), 3, 3, FZ, FZ, S);
      break;
    case 'goatee':
      hair('fade');
      fill(m, HX(3), HX(5), 0, 0, FZ, FZ + 1, SLOT.BEARD);
      fill(m, HX(2), HX(6), 2, 2, FZ, FZ, SLOT.BEARD);
      fill(m, HX(2), HX(2), 1, 1, FZ, FZ, SLOT.BEARD);
      fill(m, HX(6), HX(6), 1, 1, FZ, FZ, SLOT.BEARD);
      break;
    case 'mustache':
      hair('short');
      fill(m, HX(2), HX(6), 2, 2, FZ + 1, FZ + 1, SLOT.BEARD);
      fill(m, HX(2), HX(2), 1, 1, FZ + 1, FZ + 1, SLOT.BEARD);
      fill(m, HX(6), HX(6), 1, 1, FZ + 1, FZ + 1, SLOT.BEARD);
      break;
    case 'old':
      hair('bald');
      fill(m, HX(1), HX(7), 0, 2, FZ, FZ, SLOT.BEARD);
      fill(m, HX(0), HX(0), 0, 3, 7, 9, SLOT.BEARD);
      fill(m, HX(8), HX(8), 0, 3, 7, 9, SLOT.BEARD);
      fill(m, HX(3), HX(5), 1, 1, FZ, FZ, MOUTH);
      fill(m, HX(1), HX(3), 6, 6, FZ, FZ, SLOT.BEARD);
      fill(m, HX(5), HX(7), 6, 6, FZ, FZ, SLOT.BEARD);
      break;
    case 'shades':
      hair('fade');
      fill(m, HX(1), HX(7), 5, 5, FZ + 1, FZ + 1, SLOT.GLASS);
      fill(m, HX(1), HX(3), 4, 4, FZ + 1, FZ + 1, SLOT.GLASS);
      fill(m, HX(5), HX(7), 4, 4, FZ + 1, FZ + 1, SLOT.GLASS);
      fill(m, HX(0), HX(0), 5, 5, 6, 10, FRAME);
      fill(m, HX(8), HX(8), 5, 5, 6, 10, FRAME);
      fill(m, HX(1), HX(7), 1, 1, FZ, FZ, SLOT.BEARD);
      fill(m, HX(3), HX(5), 1, 1, FZ, FZ, MOUTH);
      break;
    case 'visor':
      hair('buzz');
      // visière lumineuse enveloppante
      fill(m, HX(0), HX(8), 5, 5, FZ + 1, FZ + 1, SLOT.NEON);
      fill(m, HX(0), HX(8), 6, 6, FZ + 1, FZ + 1, FRAME);
      fill(m, HX(1), HX(7), 4, 4, FZ + 1, FZ + 1, FRAME);
      fill(m, HX(-1), HX(-1), 5, 6, 6, 10, FRAME);
      fill(m, HX(9), HX(9), 5, 6, 6, 10, FRAME);
      fill(m, HX(-1), HX(-1), 5, 5, 9, 10, SLOT.NEON);
      fill(m, HX(9), HX(9), 5, 5, 9, 10, SLOT.NEON);
      break;
    case 'mask':
      hair('short');
      // masque filtrant sur le bas du visage, cartouches lumineuses
      fill(m, HX(0), HX(8), 0, 3, FZ, FZ, SLOT.DRESS);
      fill(m, HX(2), HX(6), 0, 2, FZ + 1, FZ + 1, SLOT.DRESS);
      fill(m, HX(0), HX(0), 0, 3, 7, 9, SLOT.DRESS);
      fill(m, HX(8), HX(8), 0, 3, 7, 9, SLOT.DRESS);
      fill(m, HX(-1), HX(-1), 1, 2, 8, 9, FRAME);
      fill(m, HX(9), HX(9), 1, 2, 8, 9, FRAME);
      m.set(HX(1), 1, FZ + 1, SLOT.NEON).set(HX(7), 1, FZ + 1, SLOT.NEON);
      fill(m, HX(3), HX(5), 1, 1, FZ + 1, FZ + 1, FRAME);
      break;
    case 'cyber':
      hair('fade');
      // œil droit cybernétique et plaque de métal sur la pommette
      m.set(HX(2), 5, FZ, SLOT.NEON).set(HX(3), 5, FZ, SLOT.NEON);
      fill(m, HX(0), HX(1), 3, 6, FZ, FZ, SLOT.ACCENT);
      fill(m, HX(-1), HX(-1), 4, 6, 7, 9, SLOT.ACCENT);
      m.set(HX(1), 5, FZ + 1, SLOT.ACCENT);
      fill(m, HX(2), HX(3), 4, 4, FZ, FZ, SLOT.ACCENT);
      fill(m, HX(1), HX(7), 0, 0, FZ, FZ, SLOT.BEARD);
      break;
    case 'woman':
      hair('long');
      break;
    case 'womanTied':
      hair('tied');
      break;
    case 'womanShades':
      hair('long');
      fill(m, HX(1), HX(7), 5, 5, FZ + 1, FZ + 1, SLOT.GLASS);
      fill(m, HX(1), HX(3), 4, 4, FZ + 1, FZ + 1, SLOT.GLASS);
      fill(m, HX(5), HX(7), 4, 4, FZ + 1, FZ + 1, SLOT.GLASS);
      fill(m, HX(1), HX(7), 6, 6, FZ + 1, FZ + 1, SLOT.ACCENT);
      m.clear(HX(4), 6, FZ + 1);
      break;
    case 'womanVisor':
      hair('tied');
      fill(m, HX(0), HX(8), 5, 5, FZ + 1, FZ + 1, SLOT.NEON);
      fill(m, HX(1), HX(7), 6, 6, FZ + 1, FZ + 1, FRAME);
      fill(m, HX(-1), HX(-1), 5, 6, 7, 10, FRAME);
      fill(m, HX(9), HX(9), 5, 6, 7, 10, FRAME);
      break;
  }
  m.setOrigin(6.5, 0, 6.5);
  return m;
}

// --------------------------------------------------------------------------- couvre-chefs et coiffures

// Grille des couvre-chefs : 17 × (24 + bas) × 17, centre (8.5, 8.5) ; le crâne y occupe
// x 4..12, z 4..12, y 0..8 (visage en z = 12, mèche du dessus en y = 9). `below` réserve des
// rangées sous le cou (cheveux longs, capuche) : toutes les hauteurs sont décalées de B.
const HC = 8.5;

/** Disque horizontal (ellipse) de rayons rx, rz centré sur le crâne. */
function disc(m: M, y: number, rx: number, rz: number, c: number): void {
  for (let x = 0; x < m.sx; x++)
    for (let z = 0; z < m.sz; z++) {
      const dx = (x + 0.5 - HC) / rx;
      const dd = (z + 0.5 - HC) / rz;
      if (dx * dx + dd * dd <= 1) m.set(x, y, z, c);
    }
}

/** Retire les arêtes verticales d'une boîte (arrondi bon marché). */
function bevel(m: M, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
  for (const x of [x0, x1]) for (const z of [z0, z1]) fill(m, x, x, y0, y1, z, z, -1);
}

/** Couvre-chefs : même origine que la tête (sommet du cou). */
export function hat(style: HatStyle): VoxelModel {
  const below = style === 'long' || style === 'ponytail' || style === 'hood' ? 6 : 0;
  const B = below;
  const m = new VoxelModel(17, 24 + B, 17, RES);
  const y = (v: number) => v + B;
  switch (style) {
    case 'bowler': {
      // melon : calotte bombée, ruban, fin liseré lumineux (2085), bord roulé, épingle d'or
      for (let k = 9; k <= 13; k++) {
        const t = (k - 8.5) / 5;
        const r = 4.95 * Math.sqrt(Math.max(0, 1 - t * t * 0.85));
        disc(m, y(k), r, r * 1.05, SLOT.HAT);
      }
      disc(m, y(9), 5.0, 5.25, SLOT.HATBAND);
      disc(m, y(10), 4.85, 5.1, SLOT.NEON);
      disc(m, y(8), 6.4, 6.9, SLOT.HAT);
      m.forEach((x, yy, z, col) => {
        if (yy === y(8) && Math.abs(x + 0.5 - HC) > 5.4) m.set(x, yy + 1, z, col);
      });
      m.set(13, y(9), 9, SLOT.ACCENT);
      break;
    }
    case 'top': {
      // haut-de-forme : bord relevé, haute calotte, ruban, filet d'argent, témoin cyan
      disc(m, y(8), 6.4, 6.8, SLOT.HAT);
      m.forEach((x, yy, z, col) => {
        if (yy === y(8) && Math.abs(x + 0.5 - HC) > 5.5) m.set(x, yy + 1, z, col);
      });
      for (let k = 9; k <= 17; k++) disc(m, y(k), 4.5, 4.8, SLOT.HAT);
      disc(m, y(18), 4.9, 5.2, SLOT.HAT);
      disc(m, y(9), 4.6, 4.9, SLOT.HATBAND);
      disc(m, y(10), 4.6, 4.9, SLOT.HATBAND);
      disc(m, y(11), 4.6, 4.9, SLOT.ACCENT);
      m.set(13, y(10), 9, SLOT.NEON);
      break;
    }
    case 'fedora': {
      // feutre : calotte pincée (creux central), ruban, bord cassé devant
      fill(m, 4, 12, y(9), y(12), 3, 13, SLOT.HAT);
      bevel(m, 4, 12, y(9), y(12), 3, 13);
      fill(m, 8, 8, y(12), y(12), 5, 11, -1);
      m.clear(5, y(12), 13).clear(11, y(12), 13);
      band(m, y(9), y(10), SLOT.HATBAND);
      fill(m, 2, 14, y(8), y(8), 1, 12, SLOT.HAT);
      fill(m, 3, 13, y(7), y(7), 13, 15, SLOT.HAT);
      bevel(m, 2, 14, y(8), y(8), 1, 12);
      break;
    }
    case 'flatcap': {
      // casquette plate de titi
      fill(m, 3, 13, y(8), y(9), 3, 13, SLOT.HAT);
      fill(m, 4, 12, y(10), y(10), 3, 12, SLOT.HAT);
      fill(m, 4, 12, y(8), y(8), 14, 15, SLOT.HAT);
      m.set(8, y(11), 7, SLOT.HATBAND);
      break;
    }
    case 'cap': {
      // casquette de baseball : calotte, visière plate, logo lumineux, bouton
      fill(m, 3, 13, y(8), y(10), 3, 13, SLOT.HAT);
      bevel(m, 3, 13, y(8), y(10), 3, 13);
      fill(m, 4, 12, y(11), y(11), 4, 12, SLOT.HAT);
      m.set(8, y(12), 8, SLOT.HATBAND);
      fill(m, 4, 12, y(8), y(8), 14, 16, SLOT.HATBAND);
      front(m, 8, 8, y(10), y(10), SLOT.NEON);
      break;
    }
    case 'beanie': {
      // bonnet : calotte haute, revers, pastille lumineuse
      fill(m, 3, 13, y(7), y(11), 3, 13, SLOT.HAT);
      bevel(m, 3, 13, y(7), y(11), 3, 13);
      fill(m, 4, 12, y(12), y(12), 4, 12, SLOT.HAT);
      band(m, y(7), y(8), SLOT.HATBAND);
      front(m, 8, 8, y(8), y(8), SLOT.NEON);
      break;
    }
    case 'police': {
      // casquette du NYPD 2085 : calotte évasée, bandeau lumineux, insigne, visière vernie
      fill(m, 3, 13, y(8), y(12), 3, 14, SLOT.HAT);
      fill(m, 2, 14, y(13), y(13), 2, 15, SLOT.HAT);
      band(m, y(8), y(8), SLOT.HATBAND);
      band(m, y(9), y(9), SLOT.NEON);
      front(m, 7, 9, y(10), y(12), SLOT.ACCENT);
      front(m, 8, 8, y(12), y(12), SLOT.HAT);
      fill(m, 4, 12, y(7), y(7), 15, 16, SLOT.HATBAND);
      break;
    }
    case 'helmet': {
      // casque tactique intégral : coque, visière sombre barrée d'un trait lumineux
      fill(m, 2, 14, y(2), y(11), 2, 14, SLOT.HAT);
      bevel(m, 2, 14, y(2), y(11), 2, 14);
      fill(m, 3, 13, y(12), y(12), 3, 13, SLOT.HAT);
      fill(m, 4, 12, y(3), y(7), 13, 13, -1);
      fill(m, 4, 12, y(3), y(7), 14, 14, SLOT.GLASS);
      fill(m, 4, 12, y(5), y(5), 14, 14, SLOT.NEON);
      front(m, 3, 13, y(2), y(2), SLOT.HATBAND);
      front(m, 3, 13, y(8), y(8), SLOT.HATBAND);
      // rail sur le dessus, protections d'oreilles, voyant
      fill(m, 8, 8, y(12), y(12), 4, 12, SLOT.HATBAND);
      paint(m, 2, 2, y(4), y(7), 6, 10, SLOT.HATBAND);
      paint(m, 14, 14, y(4), y(7), 6, 10, SLOT.HATBAND);
      m.set(14, y(6), 8, SLOT.LED);
      break;
    }
    case 'hood': {
      // capuche relevée (couleur du sweat), bord contrasté autour du visage
      fill(m, 2, 14, y(-1), y(11), 2, 13, SLOT.COAT);
      bevel(m, 2, 14, y(-1), y(11), 2, 13);
      fill(m, 3, 13, y(12), y(12), 3, 12, SLOT.COAT);
      fill(m, 4, 12, y(-1), y(8), 12, 13, -1);
      fill(m, 4, 12, y(0), y(9), 13, 13, -1);
      paint(m, 2, 14, y(-1), y(11), 13, 13, SLOT.COAT2);
      paint(m, 3, 13, y(9), y(9), 12, 12, SLOT.COAT2);
      // la capuche tombe sur le haut du dos
      fill(m, 4, 12, 0, y(-2), 2, 5, SLOT.COAT);
      break;
    }
    case 'headset': {
      // casque audio : arceau, écouteurs à anneau lumineux
      for (let x = 2; x <= 14; x++) {
        const dx = (x + 0.5 - HC) / 6.2;
        const yy = Math.round(5.5 + 4.8 * Math.sqrt(Math.max(0, 1 - dx * dx)));
        m.set(x, y(yy), 8, SLOT.HATBAND);
      }
      for (const x of [2, 14]) {
        fill(m, x, x, y(3), y(6), 6, 10, SLOT.HATBAND);
        fill(m, x, x, y(4), y(5), 7, 9, SLOT.NEON);
      }
      fill(m, 3, 3, y(3), y(6), 6, 10, SLOT.HATBAND);
      fill(m, 13, 13, y(3), y(6), 6, 10, SLOT.HATBAND);
      break;
    }
    case 'mohawk': {
      // crête punk sur un crâne rasé
      for (let z = 3; z <= 13; z++) {
        const h = 3 + Math.round(Math.sin(((z - 3) / 10) * Math.PI) * 1.5 + (z - 3) * 0.12);
        fill(m, 7, 9, y(9), y(9) + h, z, z, SLOT.HAIR);
      }
      break;
    }
    case 'ponytail': {
      // queue de cheval haute, chouchou lumineux
      fill(m, 7, 9, y(7), y(9), 2, 3, SLOT.HAIR);
      fill(m, 7, 9, y(7), y(8), 2, 2, SLOT.NEON);
      fill(m, 7, 9, 1, y(6), 1, 2, SLOT.HAIR);
      break;
    }
    case 'bun': {
      // chignon haut et pique lumineuse
      fill(m, 6, 10, y(9), y(11), 4, 7, SLOT.HAIR);
      fill(m, 7, 9, y(12), y(12), 5, 6, SLOT.HAIR);
      fill(m, 5, 11, y(10), y(10), 6, 6, SLOT.NEON);
      break;
    }
    case 'long': {
      // longue chevelure sur les épaules et dans le dos
      fill(m, 3, 13, 0, y(8), 2, 3, SLOT.HAIR);
      fill(m, 3, 3, y(2), y(8), 4, 10, SLOT.HAIR);
      fill(m, 13, 13, y(2), y(8), 4, 10, SLOT.HAIR);
      fill(m, 3, 13, y(9), y(9), 2, 11, SLOT.HAIR);
      fill(m, 4, 12, 0, y(-1), 4, 4, SLOT.HAIR);
      break;
    }
    case 'bob': {
      // carré plongeant, frange droite
      fill(m, 3, 13, y(2), y(9), 3, 3, SLOT.HAIR);
      fill(m, 3, 3, y(2), y(9), 4, 11, SLOT.HAIR);
      fill(m, 13, 13, y(2), y(9), 4, 11, SLOT.HAIR);
      fill(m, 3, 13, y(10), y(10), 3, 13, SLOT.HAIR);
      fill(m, 4, 12, y(8), y(9), 13, 13, SLOT.HAIR);
      fill(m, 4, 12, y(9), y(9), 12, 12, SLOT.HAIR);
      break;
    }
    case 'afro': {
      fill(m, 1, 15, y(4), y(12), 1, 11, SLOT.HAIR);
      bevel(m, 1, 15, y(4), y(12), 1, 11);
      fill(m, 2, 14, y(13), y(13), 2, 12, SLOT.HAIR);
      fill(m, 2, 14, y(9), y(12), 12, 13, SLOT.HAIR);
      break;
    }
    case 'pompadour': {
      // banane gominée
      fill(m, 5, 11, y(9), y(10), 5, 13, SLOT.HAIR);
      fill(m, 6, 10, y(11), y(11), 8, 14, SLOT.HAIR);
      fill(m, 7, 9, y(12), y(12), 10, 13, SLOT.HAIR);
      break;
    }
    case 'none':
      break;
  }
  m.setOrigin(HC, B, HC);
  return m;
}

/** Pan de manteau attaché à la hanche. side = 1 gauche, -1 droite. */
export function coatTail(style: TailStyle, side: 1 | -1): VoxelModel {
  const m = new VoxelModel(9, 20, 11, RES);
  const length = style === 'longcoat' ? 17 : style === 'frock' ? 13 : style === 'trench' ? 15 : 0;
  const top = 18;
  const bottom = Math.max(0, top - 2 - length);
  for (let y = bottom; y < top; y++) {
    const flare = (top - y) / 20;
    const x0 = side === 1 ? 0.5 - flare * 0.4 : 0.5 - flare * 1.4;
    const x1 = side === 1 ? 7.5 + flare * 1.4 : 7.5 + flare * 0.4;
    m.box(Math.max(0, x0), y, Math.max(0, 0.6 - flare * 0.8), Math.min(9, x1 + 0.5), y + 1, 10.2, SLOT.COAT);
  }
  // doublure visible au bord avant intérieur
  const innerX = side === 1 ? 0 : 7;
  for (let yy = bottom; yy < top - 2; yy++) {
    m.set(innerX, yy, 10, SLOT.COAT2);
    m.set(innerX, yy, 9, SLOT.COAT2);
  }
  if (style === 'longcoat' || style === 'frock') {
    // ourlet lumineux des manteaux des parrains
    for (let x = 0; x < 9; x++) for (let z = 0; z < 11; z++) if (m.get(x, bottom, z) >= 0) m.set(x, bottom, z, SLOT.NEON);
  }
  if (style === 'trench') m.set(side === 1 ? 1 : 7, bottom + 6, 0, SLOT.ACCENT);
  m.setOrigin(4, 15, 5);
  return m;
}

/** Jupe attachée au bassin (origine à la taille). */
export function skirt(style: SkirtStyle): VoxelModel {
  const H = style === 'pencil' ? 15 : 13;
  const m = new VoxelModel(20, H, 16, RES);
  if (style === 'pencil') {
    // jupe droite, fente arrière
    fill(m, 3, 16, 0, H - 1, 3, 12, SLOT.DRESS);
    fill(m, 9, 10, 0, 3, 3, 3, -1);
  } else {
    // jupe évasée
    fill(m, 3, 16, 6, H - 1, 3, 12, SLOT.DRESS);
    fill(m, 2, 17, 0, 5, 2, 13, SLOT.DRESS);
    band(m, 0, 0, SLOT.COAT2);
  }
  band(m, H - 1, H - 1, SLOT.COAT2);
  m.setOrigin(10, H, 8);
  return m;
}

// --------------------------------------------------------------------------- armes

const GUNMETAL = 0x2b2c30;
const GUNSTEEL = 0x55585e;
const POLYMER = 0x1d1f23;
const POLY_HI = 0x34373d;
const WASP = 0xd8a020;
const HAMMER_RED = 0x8e2a22;
const BLADE = 0x9aa0a8;
const BLADE_HOT = 0x8a3a1c;

/** Bouche du canon (voxels, repère de l'arme : canon vers +Z, origine à la poignée). */
export const WEAPON_MUZZLE: Record<WeaponKind, [number, number, number]> = {
  pistol: [0, 2, 10],
  smg: [0, 2, 13],
  shotgun: [0, 3, 32],
  rifle: [0, 2.5, 35],
  knife: [0, 0, 9],
  club: [0, 0, 16],
};

/** Armes : construites le canon vers +Z, origine à la poignée. */
export function weaponModel(kind: WeaponKind): VoxelModel {
  switch (kind) {
    case 'pistol': {
      // pistolet intelligent Vektor : culasse anguleuse, carcasse polymère, témoins cyan
      const m = new VoxelModel(3, 7, 11, RES);
      fill(m, 0, 2, 3, 4, 1, 9, GUNMETAL);
      paint(m, 1, 1, 4, 4, 2, 2, SLOT.NEON_CYAN);
      fill(m, 0, 2, 2, 2, 3, 8, POLYMER);
      fill(m, 1, 1, 3, 3, 10, 10, GUNSTEEL);
      fill(m, 0, 2, 0, 2, 0, 2, POLYMER);
      fill(m, 1, 1, 1, 1, 3, 4, POLYMER);
      paint(m, 0, 0, 3, 3, 5, 6, SLOT.NEON_CYAN);
      m.setOrigin(1.5, 1.5, 1);
      return m;
    }
    case 'smg': {
      // pistolet-mitrailleur Wasp : corps compact rayé jaune et noir, chargeur sur le dessus,
      // poignée avant
      const m = new VoxelModel(3, 8, 15, RES);
      fill(m, 0, 2, 2, 4, 0, 10, POLYMER);
      for (const z of [4, 6, 8]) paint(m, 0, 2, 3, 3, z, z, WASP);
      fill(m, 1, 1, 3, 3, 11, 13, GUNMETAL);
      fill(m, 0, 2, 5, 6, 2, 8, 0x3a3226);
      paint(m, 1, 1, 6, 6, 3, 7, SLOT.NEON_AMBER);
      fill(m, 1, 1, 7, 7, 1, 2, GUNMETAL);
      fill(m, 0, 2, 0, 1, 0, 1, POLYMER);
      fill(m, 1, 1, 0, 1, 8, 9, POLYMER);
      m.setOrigin(1.5, 1.5, 1);
      return m;
    }
    case 'shotgun': {
      // fusil à pompe Hammer : boîte massive, canon sur tube-magasin, pompe crantée, crosse
      const m = new VoxelModel(3, 7, 37, RES);
      fill(m, 0, 2, 1, 5, 4, 11, GUNMETAL);
      paint(m, 0, 2, 5, 5, 5, 10, GUNSTEEL);
      paint(m, 0, 0, 2, 3, 6, 9, HAMMER_RED);
      paint(m, 2, 2, 2, 3, 6, 9, HAMMER_RED);
      fill(m, 1, 1, 4, 4, 12, 36, GUNSTEEL);
      fill(m, 1, 1, 3, 3, 12, 33, GUNMETAL);
      fill(m, 0, 2, 2, 3, 14, 21, POLYMER);
      for (const z of [15, 17, 19]) paint(m, 0, 2, 2, 2, z, z, POLY_HI);
      fill(m, 1, 1, 5, 5, 34, 34, SLOT.NEON_RED);
      fill(m, 0, 2, 1, 4, 0, 3, POLYMER);
      fill(m, 0, 2, 0, 0, 0, 1, POLYMER);
      m.setOrigin(1.5, 1.5, 5);
      return m;
    }
    case 'rifle': {
      // fusil à rail Longbow : deux rails, bobines lumineuses, lunette, cellule d'énergie
      const m = new VoxelModel(3, 8, 45, RES);
      fill(m, 0, 2, 1, 4, 3, 13, GUNMETAL);
      fill(m, 1, 1, 5, 5, 14, 40, GUNSTEEL);
      fill(m, 1, 1, 2, 2, 14, 40, GUNSTEEL);
      for (const z of [18, 25, 32]) {
        fill(m, 0, 2, 2, 5, z, z + 1, SLOT.NEON_CYAN);
        fill(m, 1, 1, 3, 4, z, z + 1, -1);
      }
      paint(m, 0, 0, 2, 3, 8, 11, SLOT.NEON_CYAN);
      paint(m, 2, 2, 2, 3, 8, 11, SLOT.NEON_CYAN);
      fill(m, 1, 1, 6, 6, 5, 12, POLYMER);
      fill(m, 1, 1, 7, 7, 5, 6, POLYMER);
      fill(m, 1, 1, 7, 7, 11, 12, POLYMER);
      fill(m, 0, 2, 1, 4, 0, 2, POLYMER);
      fill(m, 0, 2, 0, 0, 0, 1, POLYMER);
      m.setOrigin(1.5, 1.5, 6);
      return m;
    }
    case 'knife': {
      // lame thermique : manche noir, garde, lame au tranchant chauffé au rouge
      const m = new VoxelModel(2, 4, 12, RES);
      fill(m, 0, 1, 1, 2, 0, 3, RUBBER);
      fill(m, 0, 1, 0, 3, 4, 4, GUNSTEEL);
      fill(m, 0, 1, 2, 2, 5, 10, BLADE);
      fill(m, 0, 1, 1, 1, 5, 9, BLADE_HOT);
      fill(m, 0, 1, 0, 0, 5, 9, SLOT.NEON_AMBER);
      fill(m, 0, 1, 1, 1, 10, 10, SLOT.NEON_AMBER);
      m.setOrigin(1, 1.5, 2);
      return m;
    }
    case 'club': {
      // matraque électrique : poignée caoutchoutée, fût télescopique, pointe bleue
      const m = new VoxelModel(3, 3, 18, RES);
      fill(m, 0, 2, 0, 2, 0, 5, RUBBER);
      paint(m, 0, 2, 0, 2, 5, 5, SLOT.NEON_BLUE);
      fill(m, 1, 1, 0, 2, 6, 15, GUNMETAL);
      fill(m, 0, 2, 1, 1, 6, 15, GUNMETAL);
      fill(m, 0, 2, 0, 2, 11, 11, GUNSTEEL);
      fill(m, 0, 2, 0, 2, 16, 17, SLOT.NEON_BLUE);
      m.setOrigin(1.5, 1.5, 2);
      return m;
    }
  }
}

// --------------------------------------------------------------------------- tourelle

/** Socle de tourelle de sécurité (origine au sol, centre). Couleurs de la tenue (COAT, COAT2…). */
export function turretBase(): VoxelModel {
  const m = new VoxelModel(22, 28, 22, RES);
  // semelle carrée et quatre patins
  fill(m, 3, 18, 0, 1, 3, 18, SLOT.SHOES);
  fill(m, 0, 21, 0, 0, 9, 12, SLOT.SHOES);
  fill(m, 9, 12, 0, 0, 0, 21, SLOT.SHOES);
  // embase aux couleurs du propriétaire, fût étroit, liserés lumineux
  fill(m, 5, 16, 2, 6, 5, 16, SLOT.COAT2);
  band(m, 6, 6, SLOT.ACCENT);
  fill(m, 7, 14, 7, 23, 7, 14, SLOT.COAT);
  for (let y = 10; y <= 20; y++) {
    front(m, 10, 11, y, y, SLOT.NEON);
    back(m, 10, 11, y, y, SLOT.NEON);
  }
  paint(m, 7, 7, 10, 20, 10, 11, SLOT.NEON);
  paint(m, 14, 14, 10, 20, 10, 11, SLOT.NEON);
  // couronne d'orientation
  fill(m, 5, 16, 24, 27, 5, 16, SLOT.PANTS);
  band(m, 25, 25, SLOT.ACCENT);
  m.setOrigin(11, 0, 11);
  return m;
}

/** Hauteur du sommet du socle (m). */
export const TURRET_BASE_Y = 28 * RES;
/** Hauteur (m) de l'axe de site de la tourelle au-dessus du sol. */
export const TURRET_PIVOT_Y = 36.5 * RES;

/** Fourche de la tourelle (tourne en lacet) : origine au sommet du socle (axe vertical). */
export function turretYoke(): VoxelModel {
  const m = new VoxelModel(18, 12, 10, RES);
  fill(m, 2, 15, 0, 1, 1, 8, SLOT.PANTS);
  for (const x0 of [0, 16]) fill(m, x0, x0 + 1, 0, 11, 2, 7, SLOT.COAT);
  paint(m, 0, 17, 7, 10, 2, 7, SLOT.COAT2);
  paint(m, 0, 0, 8, 9, 4, 5, SLOT.ACCENT);
  paint(m, 17, 17, 8, 9, 4, 5, SLOT.ACCENT);
  m.setOrigin(9, 0, 5);
  return m;
}

/** Canon de la tourelle (site + lacet) : origine sur l'axe de site, bouches vers +Z. */
export function turretGun(): VoxelModel {
  const m = new VoxelModel(16, 13, 32, RES);
  // caisson, ailettes de refroidissement à l'arrière, liserés lumineux
  fill(m, 4, 11, 1, 8, 0, 19, SLOT.COAT);
  for (const y of [2, 4, 6]) back(m, 4, 11, y, y, SLOT.ACCENT);
  paint(m, 4, 4, 7, 7, 4, 16, SLOT.NEON);
  paint(m, 11, 11, 7, 7, 4, 16, SLOT.NEON);
  // masque blindé aux couleurs du propriétaire
  fill(m, 2, 13, 0, 9, 18, 19, SLOT.COAT2);
  // canons jumeaux, freins de bouche
  for (const x of [5, 9]) {
    fill(m, x, x + 1, 3, 4, 20, 31, GUNMETAL);
    fill(m, x - 1, x + 2, 2, 5, 28, 29, SLOT.PANTS);
  }
  // capteur sur le dessus : œil lumineux derrière une vitre
  fill(m, 6, 9, 9, 11, 8, 15, SLOT.COAT);
  front(m, 6, 9, 9, 11, SLOT.GLASS);
  front(m, 7, 8, 10, 10, SLOT.NEON);
  // caisse de munitions et bande
  fill(m, 12, 13, 1, 6, 6, 14, SLOT.DRESS);
  paint(m, 12, 13, 6, 6, 6, 14, SLOT.ACCENT);
  m.setOrigin(8, 5, 10);
  return m;
}

/** Bouche du canon droit de la tourelle dans le repère du canon (m) ; le gauche est symétrique. */
export const TURRET_MUZZLE: [number, number, number] = [-2 * RES, -1 * RES, 22 * RES];
