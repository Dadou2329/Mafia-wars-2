// Implants cybernétiques visibles (vue à la troisième personne) : lecture de l'apparence
// publique (« emplacement=identifiant:niveau », shared/implants.ts), choix des pièces voxel à
// dessiner (clés de membres partagées par tous les personnages qui portent les mêmes implants)
// et canaux d'intensité lumineuse propres à chaque personnage.
//
// Principe : un implant de bras remplace l'avant-bras et la main de son côté par des pièces
// mécaniques (la manche du bras reste, coupée au coude) ; les implants des jambes, du torse, de
// la colonne, des yeux et du système neuronal sont des pièces ajoutées qui suivent leur os
// (cuisse, jambe, pied, torse, tête), composées par région : une seule clé par région et par
// combinaison d'implants (pas d'interpénétration, un seul appel de dessin). Les pièces mobiles
// (plaques du pistolet d'avant-bras, canon, lame, vérins, nacelle de roquettes, crochet du
// grappin, sondes, filament du fouet) sont des membres séparés placés à chaque image.
// La peau (derme, camouflage, isolant, gel) et les yeux lumineux sont rendus par le shader.

import { IMPLANT_BY_ID, parseCyberLook, qualityIndex, type SlotId } from '../../shared/implants';

/** Canaux d'intensité lumineuse (colonnes de la texture d'état, voir charMaterial.ts). */
export const GLOW_CH = {
  /** Liserés de l'implant du bras gauche / droit (toujours allumés, selon la gamme). */
  ARM_L: 0,
  ARM_R: 1,
  /** Organe actif du bras (émetteur du bouclier, bobines, paume, vérins, nacelle…). */
  ARM_L_ACT: 2,
  ARM_R_ACT: 3,
  /** Jambes : liserés ; fibres du sprint et propulseurs (esquive, double saut, bond). */
  LEGS: 4,
  LEGS_ACT: 5,
  /** Torse : liserés ; coutures de la surcharge, cœur de secours. */
  TORSO: 6,
  TORSO_ACT: 7,
  SPINE: 8,
  EYES: 9,
  NEURAL: 10,
  /** Couronne des réflexes (embrasée en surrégime). */
  NEURAL_ACT: 11,
  /** Filets de gamme (discrets). */
  TRIM: 12,
  /** Canon chaud, tranchant chauffé. */
  HEAT_L: 13,
  HEAT_R: 14,
  /** Filament du fouet. */
  WHIP: 15,
} as const;

/** Style de main mécanique selon l'implant de bras. */
export type CyHandStyle = 'std' | 'palm' | 'mag' | 'tesla' | 'whip' | 'fist' | 'tool';

export const ARM_IMPLANTS = ['grappin', 'pistoletBras', 'lame', 'poing', 'bouclier', 'repulseur', 'choc', 'outils', 'grip', 'roquettes', 'fouet'] as const;
export type ArmImplant = (typeof ARM_IMPLANTS)[number];

export const HAND_STYLE: Record<ArmImplant, CyHandStyle> = {
  grappin: 'std',
  pistoletBras: 'std',
  lame: 'std',
  poing: 'fist',
  bouclier: 'std',
  repulseur: 'palm',
  choc: 'tesla',
  outils: 'tool',
  grip: 'mag',
  roquettes: 'std',
  fouet: 'whip',
};

/** Pièces mobiles de chaque implant de bras (membres « cymov:<implant>:<pièce> »). */
export const MOVING: Partial<Record<ArmImplant, string[]>> = {
  pistoletBras: ['plateA', 'plateB', 'barrel'],
  lame: ['blade'],
  poing: ['rods'],
  grappin: ['hook'],
  roquettes: ['pod', 'cover'],
  outils: ['probe'],
  bouclier: ['fins'],
};

export interface CyItem {
  slot: SlotId;
  id: string;
  level: number;
  /** Gamme (0 Standard … 4 Légendaire). */
  q: number;
  /** Couleur d'accent de l'implant. */
  color: number;
}

/** Implants visibles d'un personnage, rangés par région du corps. */
export interface CyberSpec {
  /** Signature (apparence normalisée). */
  sig: string;
  /** Bras gauche (brasG), bras droit (brasD). */
  arms: [CyItem | null, CyItem | null];
  legs: CyItem[];
  torso: CyItem[];
  spine: CyItem | null;
  eyes: CyItem[];
  skin: CyItem | null;
  neural: CyItem[];
  all: CyItem[];
}

const specCache = new Map<string, CyberSpec | null>();

/** Lecture (mise en cache) d'une apparence cybernétique ; null si aucun implant visible. */
export function cyberSpec(look: string[] | undefined): CyberSpec | null {
  if (!look || look.length === 0) return null;
  const key = look.join(',');
  const hit = specCache.get(key);
  if (hit !== undefined) return hit;
  const items = parseCyberLook(look);
  let spec: CyberSpec | null = null;
  if (items.length) {
    spec = { sig: '', arms: [null, null], legs: [], torso: [], spine: null, eyes: [], skin: null, neural: [], all: [] };
    for (const it of items) {
      const def = IMPLANT_BY_ID[it.id];
      if (!def) continue;
      const ci: CyItem = { slot: it.slot, id: it.id, level: it.level, q: qualityIndex(def, it.level), color: def.color };
      spec.all.push(ci);
      switch (def.cat) {
        case 'bras':
          if (it.slot === 'brasG') spec.arms[0] = ci;
          else if (it.slot === 'brasD') spec.arms[1] = ci;
          break;
        case 'jambes':
          if (spec.legs.length < 3 && !spec.legs.some((l) => l.id === ci.id)) spec.legs.push(ci);
          break;
        case 'torse':
          if (spec.torso.length < 2 && !spec.torso.some((l) => l.id === ci.id)) spec.torso.push(ci);
          break;
        case 'colonne':
          spec.spine = ci;
          break;
        case 'yeux':
          if (spec.eyes.length < 2 && !spec.eyes.some((l) => l.id === ci.id)) spec.eyes.push(ci);
          break;
        case 'peau':
          spec.skin = ci;
          break;
        case 'neural':
          if (spec.neural.length < 2 && !spec.neural.some((l) => l.id === ci.id)) spec.neural.push(ci);
          break;
      }
    }
    spec.sig = spec.all.map((i) => `${i.slot}=${i.id}:${i.level}`).join(',');
    if (!spec.all.length) spec = null;
  }
  if (specCache.size > 512) specCache.clear();
  specCache.set(key, spec);
  return spec;
}

/** Implant de bras d'un côté (0 gauche, 1 droite), ou null. */
export function armImplant(spec: CyberSpec | null | undefined, i: number): ArmImplant | null {
  const it = spec?.arms[i];
  return it && (ARM_IMPLANTS as readonly string[]).includes(it.id) ? (it.id as ArmImplant) : null;
}

/** Liste triée « id+gamme » d'implants (fragment de clé de membre). */
function itemList(items: CyItem[]): string {
  return items
    .map((i) => `${i.id}${i.q}`)
    .sort()
    .join('+');
}

/** Clés des pièces cybernétiques d'une silhouette. */
export interface CyberKeys {
  /** Avant-bras mécaniques (null : avant-bras d'origine). */
  farm: [string | null, string | null];
  /** Préfixe des mains mécaniques (« % » = pose), ou null. */
  hand: [string | null, string | null];
  /** Pièces mobiles de chaque bras : [nom de pièce, clé]. */
  mov: [[string, string][], [string, string][]];
  thigh: [string | null, string | null];
  shin: [string | null, string | null];
  /** Pièce du pied (symétrique, la même pour les deux pieds). */
  foot: string | null;
  torso: string | null;
  head: string | null;
  /** Segment du filament du fouet (si un bras porte le fouet). */
  whip: string | null;
}

/** Ces implants de jambes ont une pièce sur la cuisse / la jambe / le pied. */
const LEG_ON: Record<string, ('thigh' | 'shin' | 'foot')[]> = {
  saut: ['shin'],
  doubleSaut: ['foot', 'shin'],
  bond: ['thigh', 'shin'],
  sprint: ['thigh', 'shin', 'foot'],
  esquive: ['shin'],
  glissade: ['shin', 'foot'],
  amortisseurs: ['thigh', 'shin', 'foot'],
  courseMurale: ['shin'],
  sautMural: ['shin'],
  silence: ['foot'],
};

/**
 * Clés des pièces d'un personnage. `torsoStyle` : style du torse (les pièces du torse et de la
 * colonne épousent la surface du vêtement) ; `bareArms` : manches courtes ou bras nus (pas de
 * revers de manche au coude) ; `faceFlags` : 'm' si l'œil gauche porte déjà un monocle ;
 * `thighsCovered` : pans de manteau ou jupe sur les cuisses (pas de pièces de cuisse, elles
 * traverseraient le vêtement : chaque implant de jambes a aussi sa pièce sous le genou).
 */
export function cyberKeys(spec: CyberSpec, build: 'm' | 'f', torsoStyle: string, bareArms: boolean, faceFlags: string, thighsCovered = false): CyberKeys {
  const k: CyberKeys = { farm: [null, null], hand: [null, null], mov: [[], []], thigh: [null, null], shin: [null, null], foot: null, torso: null, head: null, whip: null };
  for (let i = 0; i < 2; i++) {
    const it = spec.arms[i];
    const id = armImplant(spec, i);
    if (!it || !id) continue;
    const sd = i === 0 ? 'L' : 'R';
    k.farm[i] = `cyfarm:${id}:${it.q}:${bareArms ? 'b' : 's'}:${build}:${sd}`;
    k.hand[i] = `cyhand:${HAND_STYLE[id]}:%:${build}:${sd}`;
    k.mov[i] = (MOVING[id] ?? []).map((p) => [p, `cymov:${id}:${p}:${build}:${sd}`] as [string, string]);
    if (id === 'fouet') k.whip = 'cymov:fouet:seg';
  }
  if (spec.legs.length) {
    const on = (bone: 'thigh' | 'shin' | 'foot') => spec.legs.filter((l) => LEG_ON[l.id]?.includes(bone));
    const th = on('thigh');
    const sh = on('shin');
    const ft = on('foot');
    if (th.length && !thighsCovered) k.thigh = [`cyleg:thigh:${build}:${itemList(th)}:L`, `cyleg:thigh:${build}:${itemList(th)}:R`];
    if (sh.length) k.shin = [`cyleg:shin:${build}:${itemList(sh)}:L`, `cyleg:shin:${build}:${itemList(sh)}:R`];
    if (ft.length) k.foot = `cyleg:foot:${build}:${itemList(ft)}:S`;
  }
  const tor = [...spec.torso, ...(spec.spine ? [spec.spine] : [])];
  if (tor.length) k.torso = `cytorso:${torsoStyle}:${build}:${itemList(tor)}`;
  const head = [...spec.eyes, ...spec.neural];
  if (head.length) k.head = `cyhead:${build}:${itemList(head)}:${faceFlags || '-'}`;
  return k;
}

/** Toutes les clés à construire pour une silhouette (préchargement, budget). */
export function cyberKeyList(k: CyberKeys, poses: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < 2; i++) {
    if (k.farm[i]) out.push(k.farm[i]!);
    if (k.hand[i]) for (const p of poses) out.push(k.hand[i]!.replace('%', p));
    for (const [, key] of k.mov[i]) out.push(key);
  }
  for (const a of [k.thigh, k.shin]) for (const x of a) if (x) out.push(x);
  for (const x of [k.foot, k.torso, k.head, k.whip]) if (x) out.push(x);
  return out;
}

/** Peau : mode du shader (0 aucun, 1 derme, 2 camouflage, 3 isolant, 4 gel). */
export const SKIN_MODE: Record<string, number> = { derme: 1, camouflage: 2, isolant: 3, gel: 4 };

/** Yeux lumineux (iris) : couleur selon l'implant (les autres implants des yeux portent une lentille). */
export const EYE_GLOW: Record<string, number> = {
  thermique: 0xff6a3d,
  nocturne: 0x7dff6a,
  marqueur: 0xff3a50,
  scanner: 0x8cff9a,
};

/** Région du corps d'un emplacement (surbrillance de l'écran d'équipement). */
export type BodyRegion = 'armL' | 'armR' | 'legs' | 'torso' | 'spine' | 'head' | 'skin' | 'all';

export function regionOfSlot(slot: SlotId | string): BodyRegion {
  switch (slot) {
    case 'brasG':
      return 'armL';
    case 'brasD':
      return 'armR';
    case 'jambes1':
    case 'jambes2':
    case 'jambes3':
      return 'legs';
    case 'torse1':
    case 'torse2':
      return 'torso';
    case 'colonne':
      return 'spine';
    case 'yeux1':
    case 'yeux2':
    case 'neural1':
    case 'neural2':
      return 'head';
    case 'peau':
      return 'skin';
    default:
      return 'all';
  }
}
