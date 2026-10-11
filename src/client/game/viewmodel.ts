// Vue subjective : avant-bras du parrain et arme tenue en main, dessinés par-dessus la
// scène (tampon de profondeur vidé). Modèles détaillés au 1/64 m (models/viewmodels.ts),
// mains rigidement liées à l'arme ou à ses pièces mobiles ; animation procédurale :
// balancement de marche, respiration, inertie de visée, recul à ressort, visée aux organes de
// visée, course, réception de saut, changement d'arme, cycle de tir (culasse du Vektor, pompe
// du Hammer, recharge des bobines du Longbow), rechargements (chargeur du Vektor, chargeur
// supérieur et levier du Wasp, cartouches du Hammer, cellule d'énergie du Longbow) et coups
// (direct alterné, taille à la lame thermique, coup de matraque électrique par le haut).
//
// Bras cybernétiques (implants de bras, models/cyberArms.ts, 1/128 m) : un bras équipé d'un
// implant remplace main et avant-bras de chair par une main mécanique et l'avant-bras de
// l'implant (la manche du parrain s'arrête au coude), dans toutes les poses ; un bras mécanique
// libre (l'arme se tient d'une main) reste visible au bas de l'écran. Armes de bras (Viper,
// Mantis, poing hydraulique, fouet) : l'avant-bras est l'arme (plaques qui s'ouvrent, canon qui
// sort, lame qui jaillit, vérins armés, filament) ; capacités jouées par un bras libre
// (grappin tiré puis bras tendu vers le crochet, bouclier levé, poussée du répulseur, décharge
// Tesla et étincelles, salve de roquettes, piratage) ; réactions aux déplacements augmentés
// (glissade, esquive, course murale, escalade, saut, réception, grappin).
//
// API des implants (appelée par GameClient) :
//   setCyber(look)            apparence publique « emplacement=identifiant:niveau » du parrain local
//   setArmOut(side|null)      bras dont l'arme de bras est sortie ('L', 'R') ; null : rangée
//   armAction(side, action)   geste ponctuel : 'fire', 'slash', 'punch', 'charge-start',
//                             'charge-release', 'whip', 'grapple-fire', 'grapple-release',
//                             'shield-on', 'shield-off', 'repulse', 'shock', 'rockets', 'hack',
//                             'deploy', 'retract'
//   setGrappleTarget(p|null)  point d'ancrage du grappin (monde), pour pointer le bras dessus
//   setMoveState(state, t?)   'normal' | 'sprint' | 'slide' | 'dash' | 'wallrunL' | 'wallrunR' |
//                             'climb' | 'air' | 'land' | 'grapple' (t : avancement 0..1 de l'escalade)
//   launcherTip(side, cam?)   bout du lanceur du grappin (monde) : départ du câble
//   armWeapon(side, cam?)     bouche du pistolet d'avant-bras (monde) : flamme et traçante
import * as THREE from 'three';
import { CharKind, IMPLANT_ARM_WEAPON, isArmWeapon, WEAPONS, Weapon } from '../../shared/characters';
import type { Slot } from '../../shared/protocol';
import { clamp } from '../../shared/util';
import { CyberShaderData, patchCharMaterial, type VisionMode } from '../characters/charMaterial';
import { meshChar } from '../characters/charMesher';
import { armImplant, cyberSpec, GLOW_CH, type ArmImplant } from '../characters/cyber';
import { appearanceFor, type BossCustom } from '../characters/styles';
import { cyberForearmFP, fpMech, sparkFP, whipSegmentFP, WHIP_SEG_FP, type CyFpArm } from '../models/cyberArms';
import { meshModel } from '../models/modelMesher';
import * as VM from '../models/viewmodels';
import { envUniforms } from '../render/env';
import { createObjectMaterial } from '../render/voxelObjectMaterial';
import { SLOT } from '../models/voxelModel';
import type { PlayerController } from './player';
import type { WeaponSystem } from './weapons';

/** Champ de vision vertical (fixe) de la caméra de la vue subjective. */
const VM_FOV = 58;

type V3 = [number, number, number];

/** Pose d'une arme dans le repère de la caméra : position du point de prise, angles (Euler YXZ). */
interface PoseDef {
  pos: V3;
  rot: V3;
}

/** Pièces mobiles des armes. */
type PartName = 'slide' | 'mag' | 'pump' | 'cell' | 'handle';

/**
 * Une main rigidement attachée à l'arme ou à l'une de ses pièces mobiles ; son avant-bras part
 * du poignet et s'oriente à chaque image vers le coude calculé (cinématique inverse).
 */
interface HandSlot {
  pose: VM.HandPose;
  side: 'R' | 'L';
  /** Pièce mobile qui porte la main (la pompe du fusil), sinon le corps de l'arme. */
  part?: PartName;
  /** Position et orientation (Euler XYZ) du repère de la main dans le repère du porteur. */
  pos: V3;
  rot: V3;
  /** Roulis de la manche autour de son axe. */
  roll: number;
  /** Main d'appui : lâche l'arme pendant que la main d'appoint recharge. */
  support?: boolean;
  /** Épaule (repère caméra) et direction du coude, si différentes des valeurs par défaut. */
  shoulder?: V3;
  pole?: V3;
}

/** Image clé de pose : [t, dx, dy, dz, rx, ry, rz, transition]. */
type Key = [number, number, number, number, number, number, number, Ease?];
/** Image clé d'une piste scalaire (décalage d'une pièce, m) : [t, valeur, transition]. */
type TKey = [number, number, Ease?];
/** Image clé de la main d'appoint : [t, x, y, z, rx, ry, rz, visibilité (0 rien, 1 main, 2 main + objet), transition]. */
type HKey = [number, number, number, number, number, number, number, number, Ease?];
type Ease = 'io' | 'in' | 'out' | 'lin';

interface PartDef {
  name: PartName;
  /** Position et orientation de la pièce au repos dans le repère de l'arme. */
  pos: V3;
  rot: V3;
  /** Direction de la course (repère de l'arme, normée). */
  dir: V3;
  /** Échelle d'affichage (chargeur logé dans la poignée : légèrement réduit, sans faces confondues). */
  scale?: number;
}

/** Objet éjecté : douille, chargeur, cellule. Position dans le repère de la pièce (ou de l'arme). */
interface EjectDef {
  at: number;
  kind: VM.CasingKind;
  part?: PartName;
  from: V3;
  vel: V3;
}

interface AnimDef {
  /** Décalages de pose de l'arme. */
  keys: Key[];
  /** Pistes des pièces mobiles (décalage le long de `dir`, m). */
  parts?: Partial<Record<PartName, TKey[]>>;
  /** Intervalles pendant lesquels une pièce est cachée (chargeur retiré). */
  hidden?: Partial<Record<PartName, [number, number][]>>;
  /** Main d'appoint (gauche) qui apporte un chargeur, une cartouche ou une cellule. */
  helper?: { pose: VM.HandPose; item: VM.CasingKind | null; handPos: V3; handRot: V3; keys: HKey[] };
  /** La main d'appui lâche l'arme pendant cet intervalle. */
  freeSupport?: [number, number];
  ejects?: EjectDef[];
  /** Petites secousses (insertion d'un chargeur, d'une cartouche). */
  jolts?: number[];
}

interface RigDef {
  meta: VM.VmWeaponMeta;
  /** Arme de bras : côté de l'avant-bras qui porte l'arme (le repère de l'arme est le poignet). */
  armSide?: 'L' | 'R';
  hip: PoseDef;
  ads?: PoseDef;
  sprint: PoseDef;
  hands: HandSlot[];
  parts?: PartDef[];
  /** Recul : translation arrière (m), relevé du canon (rad), montée (m), roulis (rad), dispersion latérale (rad). */
  recoil: { back: number; climb: number; up: number; roll: number; jitter?: number };
  /** Point autour duquel l'arme pivote au recul et dans les gestes (≈ poignet), repère de l'arme. */
  pivot: V3;
  /** Cycle après chaque tir (culasse, pompe) : délai et durée (s), animation (t normalisé). */
  cycle?: { delay: number; dur: number; anim: AnimDef };
}

interface PartObj {
  obj: THREE.Object3D;
  base: THREE.Vector3;
  dir: THREE.Vector3;
}

interface Rig {
  def: RigDef;
  /** Repère de l'arme (placé dans le repère de la caméra à chaque image). */
  root: THREE.Group;
  parts: Map<PartName, PartObj>;
  /** Bobines du fusil à rail (éteintes / allumées). */
  rings: { dark: THREE.Mesh[]; lit: THREE.Mesh[] } | null;
  arms: THREE.Object3D[];
  /** Avant-bras orientés à chaque image par la cinématique inverse épaule-coude-poignet. */
  forearms: { mesh: THREE.Object3D; slot: HandSlot; parent: THREE.Object3D }[];
  /** Main(s) d'appui (cachées pendant que la main d'appoint recharge). */
  support: THREE.Object3D[];
  /** Main d'appoint : groupe (main + objet tenu), objet, avant-bras. */
  helper: { group: THREE.Group; item: THREE.Mesh | null; fore: THREE.Mesh; anim: AnimDef } | null;
  /** Arme de bras : haut du bras (du coude vers l'épaule). */
  upper?: THREE.Mesh;
}

const S = VM.VM_RES;
/** Épaules (repère de la caméra) et direction vers laquelle les coudes se plient. */
const SHOULDER_R: V3 = [0.21, -0.32, 0.05];
const SHOULDER_L: V3 = [-0.21, -0.32, 0.05];
const POLE_R: V3 = [0.5, -1, 0.1];
const POLE_L: V3 = [-0.5, -1, 0.1];
const SPRINT_LONG: PoseDef = { pos: [0.08, -0.135, -0.3], rot: [0.12, 0.9, 0.75] };

// ------------------------------------------------------------------ images clés

function ease(e: Ease | undefined, t: number): number {
  switch (e) {
    case 'lin':
      return t;
    case 'in':
      return t * t * t;
    case 'out':
      return 1 - (1 - t) ** 3;
    default:
      return t * t * (3 - 2 * t);
  }
}

/** Échantillonne une suite d'images clés de n canaux (colonnes 1..n, transition en colonne `ei`). */
function sampleN(keys: readonly (readonly (number | string | undefined)[])[], n: number, t: number, out: number[], ei = n + 1): void {
  let i = 1;
  while (i < keys.length - 1 && (keys[i][0] as number) < t) i++;
  const a = keys[i - 1];
  const b = keys[i];
  const u = ease(b[ei] as Ease | undefined, clamp((t - (a[0] as number)) / Math.max(1e-6, (b[0] as number) - (a[0] as number)), 0, 1));
  for (let k = 1; k <= n; k++) {
    const va = a[k] as number;
    out[k - 1] = va + ((b[k] as number) - va) * u;
  }
}

/** Valeur d'une piste scalaire. */
function sampleTrack(keys: TKey[], t: number): number {
  const o = [0];
  sampleN(keys, 1, t, o);
  return o[0];
}

/** Visibilité de la main d'appoint : valeur de la dernière image clé atteinte (pas d'interpolation). */
function stepVis(keys: HKey[], t: number): number {
  let v = 0;
  for (const k of keys) if (k[0] <= t) v = k[7];
  return v;
}

const inIntervals = (iv: [number, number][] | undefined, t: number) => !!iv && iv.some(([a, b]) => t >= a && t < b);

// ------------------------------------------------------------------ armes

const PI = Math.PI;
const gR = VM.PISTOL.gripRot[0];
/** Axe de la poignée du Vektor dans le repère de l'arme (le chargeur glisse le long). */
const PISTOL_AXIS: V3 = [0, Math.cos(gR), Math.sin(gR)];
const SMG_MAG_DIR: V3 = [0, 0.8, 0.6];
const SMG_MAG_C: V3 = [0, 5 * S, -6 * S];
const RIFLE_CELL_C: V3 = [0, -4 * S, -10 * S];

/** Main d'appoint du Hammer : quatre cartouches glissées une à une dans la fenêtre de chargement. */
function shotgunHelperKeys(): HKey[] {
  const keys: HKey[] = [[0, -0.07, -0.13, 0.03, 0, 0, 0, 0]];
  const below: [number, number, number] = [-0.07, -0.13, 0.03];
  for (let i = 0; i < 4; i++) {
    const c = 0.13 + i * 0.17;
    keys.push([c, ...below, 0.2, 0, 0, 2]);
    keys.push([c + 0.07, 0, -3.5 * S, -2 * S, 0, 0, 0, 2, 'out']);
    keys.push([c + 0.11, 0, 0, -8 * S, 0, 0, 0, 2, 'in']);
    keys.push([c + 0.115, 0, 0, -8 * S, 0, 0, 0, 1]);
    keys.push([c + 0.165, ...below, 0.2, 0, 0, 1, 'io']);
  }
  keys.push([0.82, ...below, 0.2, 0, 0, 0]);
  keys.push([1, ...below, 0.2, 0, 0, 0]);
  return keys;
}

const RIGS: Record<Weapon, RigDef> = {
  [Weapon.PISTOL]: {
    meta: VM.PISTOL,
    hip: { pos: [0.13, -0.115, -0.37], rot: [0.03, 0.3, 0.2] },
    ads: { pos: [0, -VM.PISTOL.sightY, -0.42], rot: [0, 0, 0] },
    sprint: { pos: [0.12, -0.16, -0.34], rot: [-0.55, 0.6, 0.35] },
    hands: [{ pose: 'pistol', side: 'R', pos: [0, 0, 0], rot: VM.PISTOL.gripRot, roll: 0.2 }],
    parts: [
      { name: 'slide', pos: [0, 0, 0], rot: [0, 0, 0], dir: [0, 0, 1] },
      { name: 'mag', pos: [0, 0, 0], rot: VM.PISTOL.gripRot, dir: [0, -1, 0], scale: 0.97 },
    ],
    recoil: { back: 0.05, climb: 0.36, up: 0.014, roll: 0.05 },
    pivot: [0, -2 * S, 5 * S],
    cycle: {
      delay: 0,
      dur: 0.11,
      anim: {
        keys: [
          [0, 0, 0, 0, 0, 0, 0],
          [1, 0, 0, 0, 0, 0, 0],
        ],
        parts: {
          slide: [
            [0, 0],
            [0.3, VM.PISTOL_SLIDE_TRAVEL, 'out'],
            [1, 0, 'io'],
          ],
        },
        ejects: [{ at: 0.25, kind: 'pistol', part: 'slide', from: [1.5 * S, 5 * S, -4.5 * S], vel: [1.5, 1.1, 0.35] }],
      },
    },
  },
  [Weapon.SMG]: {
    meta: VM.SMG,
    hip: { pos: [0.13, -0.145, -0.34], rot: [0.03, 0.2, 0.1] },
    ads: { pos: [0, -VM.SMG.sightY, -0.3], rot: [0, 0, 0] },
    sprint: { pos: [0.1, -0.15, -0.3], rot: [-0.3, 0.75, 0.55] },
    hands: [
      { pose: 'pistol', side: 'R', pos: [0, 0, 0], rot: VM.SMG.gripRot, roll: 0.15 },
      { pose: 'pistol', side: 'L', pos: VM.SMG.support!, rot: VM.SMG.supportRot, roll: -0.25, support: true },
    ],
    parts: [
      { name: 'mag', pos: [0, 0, 0], rot: [0, 0, 0], dir: SMG_MAG_DIR },
      { name: 'handle', pos: [0, 0, 0], rot: [0, 0, 0], dir: [0, 0, 1] },
    ],
    recoil: { back: 0.018, climb: 0.075, up: 0.003, roll: 0.03, jitter: 0.012 },
    pivot: [0, 0, 6 * S],
    cycle: {
      delay: 0,
      dur: 0.07,
      anim: {
        keys: [
          [0, 0, 0, 0, 0, 0, 0],
          [1, 0, 0, 0, 0, 0, 0],
        ],
        ejects: [{ at: 0.2, kind: 'pistol', from: [1.5 * S, 2 * S, -4 * S], vel: [1.4, -0.2, 0.5] }],
      },
    },
  },
  [Weapon.SHOTGUN]: {
    meta: VM.SHOTGUN,
    hip: { pos: [0.115, -0.125, -0.3], rot: [0.04, 0.19, 0.08] },
    ads: { pos: [0, -VM.SHOTGUN.sightY, -0.38], rot: [0, 0, 0] },
    sprint: SPRINT_LONG,
    hands: [
      { pose: 'pistol', side: 'R', pos: [0, 0, 0], rot: VM.SHOTGUN.gripRot, roll: 0.1 },
      // la main gauche tient la pompe et la suit quand elle coulisse
      { pose: 'support', side: 'L', part: 'pump', pos: VM.SHOTGUN.support!, rot: VM.SHOTGUN.supportRot, roll: -0.3, support: true },
    ],
    parts: [{ name: 'pump', pos: [0, 0, 0], rot: [0, 0, 0], dir: [0, 0, 1] }],
    recoil: { back: 0.075, climb: 0.2, up: 0.01, roll: 0.03 },
    pivot: [0, 0, 18 * S],
    cycle: {
      // pompe : on ramène la pompe d'un coup sec (la douille est éjectée), puis on la repousse
      delay: 0.16,
      dur: 0.36,
      anim: {
        keys: [
          [0, 0, 0, 0, 0, 0, 0],
          [0.45, 0.004, -0.008, 0.012, 0.05, 0.02, 0.06, 'out'],
          [1, 0, 0, 0, 0, 0, 0, 'io'],
        ],
        parts: {
          pump: [
            [0, 0],
            [0.42, VM.SHOTGUN_PUMP_TRAVEL, 'out'],
            [0.55, VM.SHOTGUN_PUMP_TRAVEL],
            [0.9, 0, 'in'],
            [1, 0],
          ],
        },
        ejects: [{ at: 0.42, kind: 'shell', from: [1.5 * S, 4 * S, -5.5 * S], vel: [1.3, 1.0, 0.45] }],
      },
    },
  },
  [Weapon.RIFLE]: {
    meta: VM.RIFLE,
    hip: { pos: [0.12, -0.14, -0.29], rot: [0.04, 0.18, 0.08] },
    ads: { pos: [0, -VM.RIFLE.sightY, -0.24], rot: [0, 0, 0] },
    sprint: SPRINT_LONG,
    hands: [
      { pose: 'pistol', side: 'R', pos: [0, 0, 0], rot: VM.RIFLE.gripRot, roll: 0.1 },
      { pose: 'support', side: 'L', pos: VM.RIFLE.support!, rot: VM.RIFLE.supportRot, roll: -0.3, support: true },
    ],
    parts: [{ name: 'cell', pos: [0, 0, 0], rot: [0, 0, 0], dir: [0, -1, 0] }],
    recoil: { back: 0.085, climb: 0.15, up: 0.012, roll: 0.02 },
    pivot: [0, 0, 18 * S],
  },
  [Weapon.KNIFE]: {
    meta: VM.KNIFE,
    hip: { pos: [0.125, -0.105, -0.33], rot: [0.32, 0.36, -0.35] },
    sprint: { pos: [0.12, -0.2, -0.3], rot: [-0.3, 0.55, -0.2] },
    hands: [{ pose: 'blade', side: 'R', pos: [0, 0, 0], rot: [0, 0, 0], roll: 0.15 }],
    recoil: { back: 0, climb: 0, up: 0, roll: 0 },
    pivot: [1 * S, 0, 3 * S],
  },
  [Weapon.CLUB]: {
    meta: VM.CLUB,
    hip: { pos: [0.135, -0.115, -0.32], rot: [0.8, 0.28, -0.25] },
    sprint: { pos: [0.13, -0.2, -0.3], rot: [0.25, 0.5, -0.3] },
    hands: [{ pose: 'blade', side: 'R', pos: [0, 0, 0], rot: [0, 0, 0], roll: 0.15 }],
    recoil: { back: 0, climb: 0, up: 0, roll: 0 },
    pivot: [1 * S, 0, 3 * S],
  },
  [Weapon.FISTS]: {
    // (pas de bouche de canon : les métadonnées de la lame ne servent que de valeur par défaut)
    meta: VM.KNIFE,
    hip: { pos: [0.11, -0.115, -0.33], rot: [0.0, -0.22, -0.5] },
    sprint: { pos: [0.115, -0.14, -0.31], rot: [-0.2, -0.15, -0.8] },
    hands: [{ pose: 'fist', side: 'R', pos: [0, 0, 0], rot: [0, 0, 0], roll: 0 }],
    recoil: { back: 0, climb: 0, up: 0, roll: 0 },
    pivot: [0, 0, 3 * S],
  },
  // armes de bras (implants) : le repère de l'arme est le poignet du bras mécanique (l'avant-bras
  // s'étend selon +Z vers le coude, il est l'arme) ; poses du bras droit, le gauche en est le
  // miroir (armRigDef). Les bouches de canon et pointes sont lues sur les modèles (cyberArms.ts).
  [Weapon.ARM_PISTOL]: {
    meta: armMeta([0, 0.063, -0.11]),
    armSide: 'R',
    hip: { pos: [0.18, -0.12, -0.43], rot: [0.42, 0.4, 0.05] },
    ads: { pos: [0, -0.1, -0.48], rot: [0.35, 0.12, 0.04] },
    sprint: { pos: [0.16, -0.2, -0.34], rot: [-0.2, 0.5, 0.4] },
    hands: [],
    recoil: { back: 0.03, climb: 0.2, up: 0.008, roll: 0.03 },
    pivot: [0, 0, 0.12],
  },
  [Weapon.ARM_BLADE]: {
    meta: armMeta([0.05, 0, -0.28]),
    armSide: 'R',
    hip: { pos: [0.17, -0.12, -0.4], rot: [0.44, 0.39, 0.25] },
    sprint: { pos: [0.15, -0.2, -0.33], rot: [0.7, 0.4, 0.25] },
    hands: [],
    recoil: { back: 0, climb: 0, up: 0, roll: 0 },
    pivot: [0, 0, 0.1],
  },
  [Weapon.ARM_FIST]: {
    meta: armMeta([0, 0, -0.08]),
    armSide: 'R',
    hip: { pos: [0.15, -0.12, -0.38], rot: [0.45, 0.35, -0.3] },
    sprint: { pos: [0.14, -0.2, -0.32], rot: [0.0, 0.3, -0.6] },
    hands: [],
    recoil: { back: 0, climb: 0, up: 0, roll: 0 },
    pivot: [0, 0, 0.1],
  },
  [Weapon.ARM_WHIP]: {
    meta: armMeta([0, 0, -0.1]),
    armSide: 'R',
    hip: { pos: [0.17, -0.13, -0.4], rot: [0.4, 0.38, 0.2] },
    sprint: { pos: [0.15, -0.21, -0.32], rot: [-0.1, 0.42, 0.4] },
    hands: [],
    recoil: { back: 0, climb: 0, up: 0, roll: 0 },
    pivot: [0, 0, 0.1],
  },
};

/** Métadonnées d'une arme de bras (la bouche est mise à jour d'après le modèle). */
function armMeta(muzzle: V3): VM.VmWeaponMeta {
  return { muzzle, support: null, supportRot: [0, 0, 0], gripRot: [0, 0, 0], sightY: 0.063, rearSightZ: 0, frontSightZ: -0.1, length: 0.33 };
}

/** Pose d'une arme de bras pour un côté (miroir du bras droit pour le gauche). */
function mirrorPose(p: PoseDef): PoseDef {
  return { pos: [-p.pos[0], p.pos[1], p.pos[2]], rot: [p.rot[0], -p.rot[1], -p.rot[2]] };
}

/** Coude des armes de bras dans le repère du poignet (pivot des coups), m. */
const ARM_ELBOW = 0.3;

/** Pose de visée d'une arme de bras : le point de mire (repère du poignet) sur l'axe de la vue. */
function alignAds(p: PoseDef, sight: V3): PoseDef {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rot[0], p.rot[1], p.rot[2], 'YXZ'));
  const s = new THREE.Vector3(sight[0], sight[1], sight[2]).applyQuaternion(q);
  return { pos: [-s.x, -s.y, p.pos[2]], rot: p.rot };
}

/**
 * Définition de pose d'une arme de bras pour un côté : bouche du canon (ou pointe) et point de
 * mire lus sur le modèle de ce côté (déjà en miroir pour le bras gauche).
 */
function armRigDef(w: Weapon, side: 'L' | 'R', muzzle: V3 | null, sight: V3 | null): RigDef {
  const d = RIGS[w];
  const meta = { ...d.meta, muzzle: muzzle ?? (side === 'R' ? d.meta.muzzle : ([-d.meta.muzzle[0], d.meta.muzzle[1], d.meta.muzzle[2]] as V3)) };
  const L = side === 'L';
  const adsBase = d.ads ? (L ? mirrorPose(d.ads) : d.ads) : undefined;
  return {
    ...d,
    meta,
    armSide: side,
    hip: L ? mirrorPose(d.hip) : d.hip,
    ads: adsBase && sight ? alignAds(adsBase, sight) : adsBase,
    sprint: L ? mirrorPose(d.sprint) : d.sprint,
    pivot: L ? [-d.pivot[0], d.pivot[1], d.pivot[2]] : d.pivot,
  };
}

/**
 * Armes de bras : coups (repère du bras droit ; le gauche est mis en miroir). Les rotations des
 * images clés tournent l'avant-bras autour du coude (le poing décrit un arc, le coude reste hors
 * champ) ; les translations déplacent le coude.
 */
const ARM_SWING: Partial<Record<Weapon, { dur: number; keys: Key[] }>> = {
  // poing hydraulique : armé un instant, puis le poing part droit vers le centre en vrillant
  [Weapon.ARM_FIST]: {
    dur: 0.42,
    keys: [
      [0, 0, 0, 0, 0, 0, 0],
      [0.14, 0.015, 0.0, 0.05, 0.15, -0.05, 0.1, 'out'],
      [0.34, -0.14, 0.065, -0.175, -0.09, -0.19, 0.3, 'out'],
      [0.5, -0.14, 0.065, -0.17, -0.09, -0.19, 0.3, 'lin'],
      [1, 0, 0, 0, 0, 0, 0, 'io'],
    ],
  },
  // fouet : armé dehors et en haut, balayage de droite à gauche, le filament traîne
  [Weapon.ARM_WHIP]: {
    dur: 0.55,
    keys: [
      [0, 0, 0, 0, 0, 0, 0],
      [0.2, 0.02, 0.025, 0.03, 0.2, -0.3, 0.25, 'out'],
      [0.52, -0.08, -0.02, -0.06, -0.15, 0.75, -0.3, 'in'],
      [0.66, -0.09, -0.03, -0.05, -0.2, 0.8, -0.35, 'out'],
      [1, 0, 0, 0, 0, 0, 0, 'io'],
    ],
  },
};

/** Lame Mantis : trois tailles enchaînées (diagonale, revers horizontal, remontante), autour du coude. */
const BLADE_COMBO: Key[][] = [
  [
    [0, 0, 0, 0, 0, 0, 0],
    [0.16, 0.0, 0.02, 0.03, 0.2, -0.25, -0.3, 'out'],
    [0.42, -0.05, -0.02, -0.05, -0.3, 0.55, 0.5, 'in'],
    [0.56, -0.05, -0.025, -0.04, -0.33, 0.58, 0.52, 'out'],
    [1, 0, 0, 0, 0, 0, 0, 'io'],
  ],
  [
    [0, 0, 0, 0, 0, 0, 0],
    [0.16, -0.04, 0.02, 0.02, 0.05, 0.5, 0.7, 'out'],
    [0.44, 0.04, 0.0, -0.05, 0.0, -0.45, 0.6, 'in'],
    [0.58, 0.045, -0.005, -0.04, 0.0, -0.48, 0.6, 'out'],
    [1, 0, 0, 0, 0, 0, 0, 'io'],
  ],
  [
    [0, 0, 0, 0, 0, 0, 0],
    [0.16, 0.01, -0.05, 0.03, -0.38, 0.05, 0.1, 'out'],
    [0.44, -0.04, 0.05, -0.06, 0.45, 0.25, 0.2, 'in'],
    [0.58, -0.045, 0.055, -0.055, 0.48, 0.27, 0.2, 'out'],
    [1, 0, 0, 0, 0, 0, 0, 'io'],
  ],
];

/** Pistolet d'avant-bras : on relève l'avant-bras, le canon rentre, la cellule est remplacée. */
const ARM_PISTOL_RELOAD: AnimDef = {
  keys: [
    [0, 0, 0, 0, 0, 0, 0],
    [0.16, -0.02, 0.03, 0.03, -0.15, 0.2, 0.45, 'io'],
    [0.75, -0.02, 0.035, 0.03, -0.17, 0.22, 0.48, 'io'],
    [0.86, -0.01, 0.01, 0.0, -0.05, 0.08, 0.1, 'out'],
    [1, 0, 0, 0, 0, 0, 0, 'io'],
  ],
  jolts: [0.5, 0.82],
};

/** Poing gauche (garde de boxe : bras avant). */
const FIST_L: RigDef = {
  meta: VM.KNIFE,
  hip: { pos: [-0.1, -0.1, -0.38], rot: [0.0, 0.2, 0.5] },
  sprint: { pos: [-0.11, -0.135, -0.33], rot: [-0.2, 0.15, 0.8] },
  hands: [{ pose: 'fist', side: 'L', pos: [0, 0, 0], rot: [0, 0, 0], roll: 0 }],
  recoil: { back: 0, climb: 0, up: 0, roll: 0 },
  pivot: [0, 0, 3 * S],
};

// Rechargements (t normalisé sur la durée de WEAPONS[w].reload).
const RELOADS: Partial<Record<Weapon, AnimDef>> = {
  [Weapon.ARM_PISTOL]: ARM_PISTOL_RELOAD,
  // Vektor : on incline le pistolet, le chargeur vide tombe (culasse bloquée en arrière), la
  // main gauche glisse un chargeur plein, une claque, puis la culasse revient d'un coup sec.
  [Weapon.PISTOL]: {
    keys: [
      [0, 0, 0, 0, 0, 0, 0],
      [0.12, -0.07, 0.05, 0.02, 0.14, 0.42, -0.55, 'io'],
      [0.2, -0.07, 0.056, 0.02, 0.2, 0.42, -0.55, 'out'],
      [0.55, -0.07, 0.05, 0.02, 0.16, 0.4, -0.55, 'io'],
      [0.6, -0.07, 0.042, 0.02, 0.12, 0.4, -0.55, 'out'],
      [0.78, -0.05, 0.045, 0.02, 0.18, 0.3, -0.3, 'io'],
      [0.84, -0.02, 0.055, 0.0, 0.36, 0.14, -0.08, 'out'],
      [1, 0, 0, 0, 0, 0, 0, 'io'],
    ],
    parts: {
      slide: [
        [0, 0],
        [0.07, VM.PISTOL_SLIDE_TRAVEL, 'out'],
        [0.8, VM.PISTOL_SLIDE_TRAVEL],
        [0.83, 0, 'in'],
        [1, 0],
      ],
      mag: [
        [0, 0],
        [0.15, 0],
        [0.23, 0.09, 'in'],
        [0.24, 0],
        [1, 0],
      ],
    },
    hidden: { mag: [[0.23, 0.57]] },
    helper: {
      pose: 'fist',
      item: 'mag',
      handPos: [0.5 * S, -5 * S, 1 * S],
      handRot: [0, 0, PI],
      keys: [
        [0, -0.11, -0.2, 0.09, gR, 0, 0, 0],
        [0.25, -0.11, -0.2, 0.09, gR + 0.4, 0, 0.3, 2],
        [0.46, 0, -0.06 * PISTOL_AXIS[1], -0.06 * PISTOL_AXIS[2], gR, 0, 0, 2, 'out'],
        [0.56, 0, 0, 0, gR, 0, 0, 2, 'in'],
        [0.57, 0, 0, 0, gR, 0, 0, 1],
        [0.61, 0, 0.005, -0.001, gR, 0, 0, 1, 'out'],
        [0.74, -0.1, -0.18, 0.08, gR + 0.3, 0, 0.3, 1, 'in'],
        [0.75, -0.1, -0.18, 0.08, gR, 0, 0, 0],
        [1, -0.1, -0.18, 0.08, gR, 0, 0, 0],
      ],
    },
    ejects: [{ at: 0.22, kind: 'mag', part: 'mag', from: [0, 0, 0], vel: [0.1, -1.3, 0.25] }],
    jolts: [0.57, 0.61],
  },
  // Wasp : on penche l'arme, la main gauche arrache le chargeur supérieur et le jette, en
  // apporte un plein, le claque en place, puis tire le levier d'armement.
  [Weapon.SMG]: {
    keys: [
      [0, 0, 0, 0, 0, 0, 0],
      [0.12, -0.05, 0.015, 0.03, 0.1, 0.28, 0.3, 'io'],
      [0.3, -0.05, 0.02, 0.03, 0.14, 0.28, 0.32, 'out'],
      [0.6, -0.05, 0.015, 0.03, 0.1, 0.28, 0.3, 'io'],
      [0.64, -0.05, 0.008, 0.03, 0.06, 0.28, 0.3, 'out'],
      [0.74, -0.04, 0.02, 0.02, 0.08, 0.32, 0.2, 'io'],
      [0.8, -0.045, 0.018, 0.025, 0.04, 0.34, 0.18, 'out'],
      [0.86, -0.03, 0.03, 0.015, 0.12, 0.26, 0.12, 'out'],
      [1, 0, 0, 0, 0, 0, 0, 'io'],
    ],
    parts: {
      mag: [
        [0, 0],
        [0.2, 0],
        [0.3, 0.06, 'out'],
        [0.31, 0],
        [1, 0],
      ],
      handle: [
        [0, 0],
        [0.74, 0],
        [0.8, 4 * S, 'out'],
        [0.83, 0, 'in'],
        [1, 0],
      ],
    },
    hidden: { mag: [[0.3, 0.62]] },
    helper: {
      pose: 'fist',
      item: 'smgMag',
      handPos: [-2.5 * S, 0, 1 * S],
      handRot: [0, 0, PI / 2],
      keys: [
        [0, -0.13, -0.14, 0.1, 0, 0, 0, 0],
        [0.15, -0.13, -0.14, 0.1, 0, 0, 0, 0],
        [0.16, -0.05, 0.02, -0.02, 0, 0, 0, 1],
        [0.2, ...SMG_MAG_C, 0, 0, 0, 1, 'out'],
        [0.3, SMG_MAG_C[0], SMG_MAG_C[1] + 0.06 * 0.8, SMG_MAG_C[2] + 0.06 * 0.6, 0, 0, 0, 1, 'out'],
        [0.42, -0.14, -0.15, 0.1, 0.4, 0, 0.3, 1, 'in'],
        [0.43, -0.14, -0.15, 0.1, 0.4, 0, 0.3, 2],
        [0.55, SMG_MAG_C[0], SMG_MAG_C[1] + 0.03, SMG_MAG_C[2] + 0.02, 0, 0, 0, 2, 'out'],
        [0.61, ...SMG_MAG_C, 0, 0, 0, 2, 'in'],
        [0.62, ...SMG_MAG_C, 0, 0, 0, 1],
        [0.65, SMG_MAG_C[0], SMG_MAG_C[1] - 0.004, SMG_MAG_C[2], 0, 0, 0, 1, 'out'],
        [0.74, -2.2 * S, 3 * S, 1 * S, 0, 0, 0, 1, 'io'],
        [0.8, -2.2 * S, 3 * S, 5 * S, 0, 0, 0, 1, 'out'],
        [0.84, -0.06, -0.02, 0.04, 0.2, 0, 0, 1, 'io'],
        [0.9, -0.13, -0.14, 0.1, 0.3, 0, 0, 1, 'in'],
        [0.91, -0.13, -0.14, 0.1, 0, 0, 0, 0],
        [1, -0.13, -0.14, 0.1, 0, 0, 0, 0],
      ],
    },
    freeSupport: [0.15, 0.91],
    ejects: [{ at: 0.31, kind: 'smgMag', part: 'mag', from: [SMG_MAG_C[0], SMG_MAG_C[1] + 0.05, SMG_MAG_C[2] + 0.035], vel: [-0.9, 0.6, 0.5] }],
    jolts: [0.62, 0.65, 0.83],
  },
  // Hammer : on couche le fusil pour présenter la fenêtre de chargement, quatre cartouches,
  // la main gauche revient sur la pompe et arme d'un coup sec.
  [Weapon.SHOTGUN]: {
    keys: [
      [0, 0, 0, 0, 0, 0, 0],
      [0.1, -0.06, 0.04, 0.04, 0.12, 0.34, -0.72, 'io'],
      [0.8, -0.06, 0.04, 0.04, 0.1, 0.32, -0.7, 'io'],
      [0.86, -0.02, 0.01, 0.02, 0.04, 0.12, -0.15, 'io'],
      [0.92, -0.015, 0.0, 0.03, 0.08, 0.1, -0.1, 'out'],
      [1, 0, 0, 0, 0, 0, 0, 'io'],
    ],
    parts: {
      pump: [
        [0, 0],
        [0.87, 0],
        [0.91, VM.SHOTGUN_PUMP_TRAVEL, 'out'],
        [0.96, 0, 'in'],
        [1, 0],
      ],
    },
    helper: { pose: 'fist', item: 'shell', handPos: [0, -2.5 * S, 2 * S], handRot: [PI / 2, 0, 0], keys: shotgunHelperKeys() },
    freeSupport: [0.11, 0.84],
    jolts: [0.24, 0.41, 0.58, 0.75, 0.96],
  },
  // Longbow : on penche l'arme, la cellule vide tombe, la main gauche en glisse une neuve,
  // une claque, puis les bobines se chargent une à une.
  [Weapon.RIFLE]: {
    keys: [
      [0, 0, 0, 0, 0, 0, 0],
      [0.12, -0.04, 0.035, 0.03, 0.12, 0.28, -0.62, 'io'],
      [0.22, -0.04, 0.04, 0.03, 0.15, 0.28, -0.64, 'out'],
      [0.56, -0.04, 0.035, 0.03, 0.12, 0.28, -0.62, 'io'],
      [0.6, -0.04, 0.028, 0.03, 0.09, 0.28, -0.62, 'out'],
      [0.72, -0.02, 0.015, 0.015, 0.06, 0.14, -0.25, 'io'],
      [0.9, -0.01, 0.01, 0.01, 0.04, 0.06, -0.08, 'io'],
      [1, 0, 0, 0, 0, 0, 0, 'io'],
    ],
    parts: {
      cell: [
        [0, 0],
        [0.15, 0],
        [0.23, 0.07, 'in'],
        [0.24, 0],
        [1, 0],
      ],
    },
    hidden: { cell: [[0.23, 0.57]] },
    helper: {
      pose: 'fist',
      item: 'cell',
      handPos: [0.5 * S, -5 * S, 1 * S],
      handRot: [0, 0, PI],
      keys: [
        [0, -0.12, -0.2, 0.05, 0, 0, 0, 0],
        [0.13, -0.12, -0.2, 0.05, 0, 0, 0, 0],
        [0.14, -0.06, -0.07, -0.12, 0, 0, 0, 1],
        [0.26, -0.12, -0.2, 0.06, 0.4, 0, 0.3, 1, 'io'],
        [0.27, -0.12, -0.2, 0.06, 0.4, 0, 0.3, 2],
        [0.47, RIFLE_CELL_C[0], RIFLE_CELL_C[1] - 0.06, RIFLE_CELL_C[2], 0, 0, 0, 2, 'out'],
        [0.56, ...RIFLE_CELL_C, 0, 0, 0, 2, 'in'],
        [0.57, ...RIFLE_CELL_C, 0, 0, 0, 1],
        [0.61, RIFLE_CELL_C[0], RIFLE_CELL_C[1] + 0.005, RIFLE_CELL_C[2], 0, 0, 0, 1, 'out'],
        [0.7, -0.02, -0.05, -0.3, 0, 0, 0, 1, 'io'],
        [0.71, -0.02, -0.05, -0.3, 0, 0, 0, 0],
        [1, -0.02, -0.05, -0.3, 0, 0, 0, 0],
      ],
    },
    freeSupport: [0.13, 0.71],
    ejects: [{ at: 0.22, kind: 'cellSpent', part: 'cell', from: RIFLE_CELL_C, vel: [0.15, -1.3, 0.3] }],
    jolts: [0.57, 0.61],
  },
};

/** Coups : durée (s) et images clés (t normalisé). */
const SWING: Partial<Record<Weapon, { dur: number; keys: Key[] }>> = {
  // taille en diagonale : armé en haut à droite, la lame traverse l'écran vers le bas à gauche
  [Weapon.KNIFE]: {
    dur: 0.4,
    keys: [
      [0, 0, 0, 0, 0, 0, 0],
      [0.16, 0.05, 0.1, 0.05, 0.55, -0.35, -0.65, 'out'],
      [0.42, -0.24, -0.09, -0.12, -0.45, 0.95, 0.95, 'in'],
      [0.56, -0.26, -0.11, -0.1, -0.5, 1.0, 1.0, 'out'],
      [1, 0, 0, 0, 0, 0, 0, 'io'],
    ],
  },
  // coup de matraque par le haut : levée derrière l'épaule, abattue au centre
  [Weapon.CLUB]: {
    dur: 0.52,
    keys: [
      [0, 0, 0, 0, 0, 0, 0],
      [0.24, 0.04, 0.075, 0.03, 1.05, -0.12, -0.2, 'out'],
      [0.44, -0.09, -0.05, -0.15, -1.15, 0.28, 0.18, 'in'],
      [0.58, -0.09, -0.06, -0.14, -1.2, 0.3, 0.2, 'out'],
      [1, 0, 0, 0, 0, 0, 0, 'io'],
    ],
  },
  // direct : le poing part vers le centre de l'écran en tournant
  [Weapon.FISTS]: {
    dur: 0.34,
    keys: [
      [0, 0, 0, 0, 0, 0, 0],
      [0.12, 0.012, -0.012, 0.03, 0.05, 0, 0.05, 'out'],
      [0.36, -0.07, 0.06, -0.15, 0.2, 0.22, 0.5, 'out'],
      [0.5, -0.07, 0.06, -0.145, 0.2, 0.22, 0.5, 'lin'],
      [1, 0, 0, 0, 0, 0, 0, 'io'],
    ],
  },
};

// ------------------------------------------------------------------ ressorts

class Spring {
  x = 0;
  v = 0;
  constructor(
    private k: number,
    private c: number,
  ) {}
  step(dt: number, target = 0): void {
    // sous-pas : l'intégration reste stable même à bas régime d'images
    const n = Math.max(1, Math.ceil(dt / 0.012));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -this.k * (this.x - target) - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
  }
}

/** Douille, chargeur ou cellule éjectés (vivent dans le repère de la caméra). */
interface Casing {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

const smooth01 = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

const CASING_KINDS: VM.CasingKind[] = ['pistol', 'shell', 'mag', 'smgMag', 'cell', 'cellSpent'];

// ------------------------------------------------------------------ implants de bras

type Side = 'L' | 'R';

/** États de déplacement augmentés vus de la vue subjective. */
export type MoveState = 'normal' | 'sprint' | 'slide' | 'dash' | 'wallrunL' | 'wallrunR' | 'climb' | 'air' | 'land' | 'grapple';
const MOVE_STATES: readonly string[] = ['normal', 'sprint', 'slide', 'dash', 'wallrunL', 'wallrunR', 'climb', 'air', 'land', 'grapple'];

/** Gestes ponctuels des bras mécaniques. */
export type ArmAction =
  | 'fire'
  | 'slash'
  | 'punch'
  | 'charge-start'
  | 'charge-release'
  | 'whip'
  | 'grapple-fire'
  | 'grapple-release'
  | 'shield-on'
  | 'shield-off'
  | 'repulse'
  | 'shock'
  | 'rockets'
  | 'hack'
  | 'deploy'
  | 'retract';

/** Durée des gestes joués par un bras libre (s). */
const ACTION_DUR: Record<string, number> = { repulse: 0.62, shock: 0.85, rockets: 1.45, hack: 1.3 };
/** Départ de chaque micro-roquette (s depuis le début du geste). */
const ROCKET_AT = [0.42, 0.56, 0.7, 0.84];

/** Champs facultatifs du joueur lus par la vue (déplacements augmentés, grappin, caméra). */
interface PlayerCyber {
  moveState?: () => string;
  grapple?: { anchor: THREE.Vector3 } | null;
  hook?: { anchor: THREE.Vector3 } | null;
  camera?: THREE.Camera;
}

/** Avant-bras mécanique placé dans la scène : groupe, pièces mobiles (pivot), étincelles. */
interface CyFore {
  side: 0 | 1;
  group: THREE.Group;
  parts: Map<string, { obj: THREE.Object3D; base: THREE.Vector3 }>;
  sparks: THREE.Mesh[];
}

/** Géométries d'un bras mécanique (partagées par toutes ses poses). */
type CyGeo = { fore: THREE.BufferGeometry; parts: Map<string, { geo: THREE.BufferGeometry; pivot: V3 }>; sparks: THREE.BufferGeometry[] } | null;

/** Implant d'un bras et son état animé. */
interface CySide {
  id: ArmImplant | null;
  q: number;
  arm: CyFpArm | null;
  // pièces (lissées)
  deploy: number;
  open: number;
  slide: number;
  blade: number;
  rods: number;
  pod: number;
  cover: number;
  hook: number;
  probe: number;
  fins: number;
  act: number;
  heat: number;
  // gestes
  action: string | null;
  actionT: number;
  charge: boolean;
  chargeW: number;
  chargeT: number;
  shield: boolean;
  shieldW: number;
  grapple: boolean;
  /** Temps écoulé depuis le tir du grappin (s). */
  grappleT: number;
  /** Lissage auxiliaire (canon rentré pendant le rechargement du Viper). */
  aux: number;
}

const newCySide = (): CySide => ({
  id: null,
  q: 0,
  arm: null,
  deploy: 0,
  open: 0,
  slide: 0,
  blade: 0,
  rods: 0,
  pod: 0,
  cover: 0,
  hook: 1,
  probe: 0,
  fins: 0,
  act: 0,
  heat: 0,
  action: null,
  actionT: 0,
  charge: false,
  chargeW: 0,
  chargeT: 0,
  shield: false,
  shieldW: 0,
  grapple: false,
  grappleT: 0,
  aux: 0,
});

/** Bras libre (capacités, déplacements, bras mécanique au repos) : repère du poignet dans la caméra. */
interface FreeArm {
  side: 0 | 1;
  root: THREE.Group;
  hands: Map<VM.HandPose, THREE.Object3D>;
  fore: THREE.Object3D | null;
  cy: CyFore | null;
  /** Haut du bras (du coude vers l'épaule). */
  upper: THREE.Mesh | null;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  /** Présence (0 caché sous l'écran, 1 en place). */
  w: number;
  /** Tâche affichée et tâche demandée ('' : aucune). */
  task: string;
  want: string;
  pose: VM.HandPose;
  /** Fondu d'une tâche à l'autre : pose de départ, avancement. */
  from: THREE.Vector3;
  fromQ: THREE.Quaternion;
  blend: number;
}

/** Poses de la main des bras libres. */
const FREE_POSES: VM.HandPose[] = ['open', 'grab', 'relax', 'wfist'];

const _fm = new THREE.Matrix4();
const _fx = new THREE.Vector3();
const _fy = new THREE.Vector3();
const _fz = new THREE.Vector3();

/** Miroir gauche/droite d'une orientation (réflexion par le plan YZ). */
function mirrorQ(q: THREE.Quaternion): THREE.Quaternion {
  return q.set(q.x, -q.y, -q.z, q.w);
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);
/** Diagonale dessus-extérieur des avant-bras (émetteur du bouclier), droite et gauche. */
const DIAG_R = new THREE.Vector3(Math.SQRT1_2, Math.SQRT1_2, 0);
const DIAG_L = new THREE.Vector3(-Math.SQRT1_2, Math.SQRT1_2, 0);
/** Axe de levée de la nacelle de roquettes (perpendiculaire à la diagonale et à l'avant-bras). */
const POD_AX_R = new THREE.Vector3(Math.SQRT1_2, -Math.SQRT1_2, 0);
const POD_AX_L = new THREE.Vector3(Math.SQRT1_2, Math.SQRT1_2, 0);

/**
 * Repère d'avant-bras dont la diagonale dessus-extérieur ((X + Y)/√2, émetteur, nacelle) regarde
 * vers `d` : renvoie l'axe Y (dos) pour un avant-bras d'axe `z` (vers le coude, normé).
 */
function diagUp(z: THREE.Vector3, d: THREE.Vector3, outY: THREE.Vector3): THREE.Vector3 {
  const dp = _fx.copy(d).addScaledVector(z, -d.dot(z)).normalize();
  const e = _fy.crossVectors(z, dp);
  return outY.copy(dp).add(e).normalize();
}

/** Orientation du repère du poignet : axe −Z (doigts) vers `fwd`, dos de la main vers `up`. */
function wristBasis(fwd: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _fz.copy(fwd).normalize().negate();
  _fy.copy(up).addScaledVector(_fz, -up.dot(_fz)).normalize();
  _fx.crossVectors(_fy, _fz);
  _fm.makeBasis(_fx, _fy, _fz);
  return out.setFromRotationMatrix(_fm);
}

export class Viewmodel {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(VM_FOV, 1, 0.01, 10);
  private root = new THREE.Group();
  /** Intensités lumineuses des bras mécaniques (texture d'état d'une ligne). */
  private cyData = new CyberShaderData(1);
  private material = patchCharMaterial(createObjectMaterial({ noFog: true, key: 'viewmodel' }), this.cyData);
  private sun = new THREE.DirectionalLight(0xfff1dc, 1.2);
  private rigs = new Map<Weapon, Rig>();
  private fistL: Rig;
  private armGeos: THREE.BufferGeometry[] = [];
  private casingGeo = {} as Record<VM.CasingKind, THREE.BufferGeometry>;
  private casings: Casing[] = [];
  private look = '';
  private armLook: VM.ArmLook | null = null;
  private shown: Weapon = Weapon.PISTOL;
  private target: Weapon = Weapon.PISTOL;
  private weaponsRef: WeaponSystem | null = null;
  // --- implants de bras
  private cySig = '';
  private cy: [CySide, CySide] = [newCySide(), newCySide()];
  private cyFores: CyFore[] = [];
  private armRigs = new Map<string, Rig>();
  private armOut: Side | null = null;
  private shownArm: Side | null = null;
  private free: [FreeArm, FreeArm];
  private moveState: MoveState = 'normal';
  private moveT = 0;
  private climbU = 0;
  private slideW = 0;
  private dashW = 0;
  private wallW = 0;
  private lowerW = 0;
  private grappleTarget: THREE.Vector3 | null = null;
  private whipSegs: THREE.Mesh[] = [];
  private uppers: THREE.Mesh[] = [];
  private whipHist: { t: number; p: THREE.Vector3 }[] = Array.from({ length: 24 }, () => ({ t: -10, p: new THREE.Vector3() }));
  private whipHead = 0;
  private whipT = -1;
  private comboN = 0;
  private swingKeys: Key[] | null = null;
  private swingScale = 1;
  private lastSwingAt = -10;
  /** Charge du coup de poing hydraulique qui va partir (0..1). */
  private chargedSwing = 0;
  private moveSetAt = -10;
  private wallSide = 1;
  private landW = 0;
  private airW = 0;
  /** Un bras libre occupe la main gauche / droite de l'arme (elle lâche l'arme ou l'arme s'abaisse). */
  private busy: [boolean, boolean] = [false, false];
  private curRig: Rig | null = null;
  private lastCam: THREE.PerspectiveCamera | null = null;
  // --- animation
  private t = 0;
  private down = 0;
  private phase = 0;
  private bobAmp = 0;
  private aimLin = 0;
  private sprintLin = 0;
  private air = 0;
  private strafe = 0;
  private wasGround = true;
  private lastVy = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private lookInit = false;
  private land = new Spring(170, 15);
  private swayYaw = new Spring(120, 15);
  private swayPitch = new Spring(120, 15);
  private kickPos = new Spring(520, 30);
  private kickRot = new Spring(210, 15);
  private kickYaw = new Spring(260, 18);
  private kickRoll = 0;
  private swingT = -1;
  private swingDur = 0.4;
  private punchLeft = false;
  private reloadPhase = -1;
  private reloadEvents = new Set<string>();
  /** Instant (horloge de la vue) du dernier tir et avancement du cycle (culasse, pompe). */
  private shotT = -10;
  private cycleT = -1;
  private cycleEvents = new Set<string>();
  // --- temporaires
  private P = new THREE.Vector3();
  private Q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private up = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private mA = new THREE.Matrix4();
  private keyOut = [0, 0, 0, 0, 0, 0, 0, 0];
  private mainFov = 75;
  private fZ = new THREE.Vector3();
  private fY = new THREE.Vector3();
  private fD = new THREE.Vector3();
  private fF = new THREE.Vector3();
  private qA = new THREE.Quaternion();
  private mC = new THREE.Matrix4();

  constructor() {
    this.scene.add(this.camera);
    this.camera.add(this.root);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    for (const k of CASING_KINDS) this.casingGeo[k] = meshModel(VM.casingModel(k));
    this.buildWeapons();
    this.fistL = this.makeRig(FIST_L, []);
    const mkFree = (side: 0 | 1): FreeArm => {
      const root = new THREE.Group();
      root.visible = false;
      this.root.add(root);
      return {
        side,
        root,
        hands: new Map(),
        fore: null,
        cy: null,
        upper: null,
        pos: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        w: 0,
        task: '',
        want: '',
        pose: 'relax',
        from: new THREE.Vector3(),
        fromQ: new THREE.Quaternion(),
        blend: 1,
      };
    };
    this.free = [mkFree(0), mkFree(1)];
    this.setLook('dadou', {});
  }

  // ---------------------------------------------------------------- construction

  private mesh(geo: THREE.BufferGeometry): THREE.Mesh {
    const m = new THREE.Mesh(geo, this.material);
    m.frustumCulled = false;
    return m;
  }

  private makeRig(def: RigDef, statics: THREE.Object3D[], parts: Partial<Record<PartName, THREE.Object3D>> = {}): Rig {
    const root = new THREE.Group();
    root.visible = false;
    for (const p of statics) root.add(p);
    const map = new Map<PartName, PartObj>();
    for (const pd of def.parts ?? []) {
      const obj = parts[pd.name];
      if (!obj) continue;
      obj.position.set(...pd.pos);
      obj.rotation.set(...pd.rot);
      if (pd.scale) obj.scale.setScalar(pd.scale);
      root.add(obj);
      map.set(pd.name, { obj, base: new THREE.Vector3(...pd.pos), dir: new THREE.Vector3(...pd.dir).normalize() });
    }
    this.root.add(root);
    return { def, root, parts: map, rings: null, arms: [], forearms: [], support: [], helper: null };
  }

  private buildWeapons(): void {
    const M = (m: Parameters<typeof meshModel>[0]) => this.mesh(meshModel(m));
    const inGrip = (m: Parameters<typeof meshModel>[0], rot: V3) => {
      const o = M(m);
      o.rotation.set(...rot);
      return o;
    };
    {
      const p = VM.pistolModels();
      this.rigs.set(Weapon.PISTOL, this.makeRig(RIGS[Weapon.PISTOL], [M(p.frame), inGrip(p.grip, VM.PISTOL.gripRot)], { slide: M(p.slide), mag: M(p.mag) }));
    }
    {
      const p = VM.smgModels();
      const fg = M(p.foregrip);
      fg.position.set(...VM.SMG.support!);
      fg.rotation.set(...VM.SMG.supportRot);
      const ret = M(VM.reticleModel(SLOT.NEON_AMBER));
      ret.position.set(...VM.SMG_RETICLE);
      this.rigs.set(Weapon.SMG, this.makeRig(RIGS[Weapon.SMG], [M(p.body), inGrip(p.grip, VM.SMG.gripRot), fg, ret], { mag: M(p.mag), handle: M(p.handle) }));
    }
    {
      const p = VM.shotgunModels();
      this.rigs.set(Weapon.SHOTGUN, this.makeRig(RIGS[Weapon.SHOTGUN], [M(p.body), inGrip(p.grip, VM.SHOTGUN.gripRot)], { pump: M(p.pump) }));
    }
    {
      const p = VM.rifleModels();
      const ret = M(VM.reticleModel(SLOT.NEON_CYAN));
      ret.position.set(...VM.RIFLE_RETICLE);
      const rig = this.makeRig(RIGS[Weapon.RIFLE], [M(p.body), inGrip(p.grip, VM.RIFLE.gripRot), ret], { cell: M(p.cell) });
      const dark = p.rings.map((m) => M(m));
      const lit = p.ringsLit.map((m) => M(m));
      for (const o of [...dark, ...lit]) rig.root.add(o);
      rig.rings = { dark, lit };
      this.rigs.set(Weapon.RIFLE, rig);
    }
    this.rigs.set(Weapon.KNIFE, this.makeRig(RIGS[Weapon.KNIFE], [M(VM.knifeModel())]));
    this.rigs.set(Weapon.CLUB, this.makeRig(RIGS[Weapon.CLUB], [M(VM.clubModel())]));
    this.rigs.set(Weapon.FISTS, this.makeRig(RIGS[Weapon.FISTS], []));
  }

  /** Orientation qui aligne +Z (axe de la manche) sur `dir`, +Y vers le haut, puis roulis. */
  private armQuat(dir: V3, roll: number, out: THREE.Quaternion, up?: THREE.Vector3): THREE.Quaternion {
    const z = this.v.set(dir[0], dir[1], dir[2]).normalize();
    const x = up ? this.v2.copy(up).cross(z) : this.v2.set(0, 1, 0).cross(z);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    x.normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    this.m4.makeBasis(x, y, z);
    out.setFromRotationMatrix(this.m4);
    if (roll) out.multiply(this.q2.setFromAxisAngle(this.v.set(0, 0, 1), roll));
    return out;
  }

  /** Tenue des manches et des mains (couleur du manteau du parrain, personnalisation comprise). */
  setLook(slot: Slot, custom?: BossCustom): void {
    const sig = `${slot}:${JSON.stringify(custom ?? {})}`;
    if (sig === this.look) return;
    this.look = sig;
    const boss = slot === 'even' ? 'even' : 'dadou';
    const app = appearanceFor(boss === 'dadou' ? CharKind.BOSS_DADOU : CharKind.BOSS_EVEN, boss === 'dadou' ? 1 : 2, 1, 0, custom);
    this.armLook = VM.armLookFor(boss, app.outfit);
    this.rebuildArms();
  }

  /**
   * Implants visibles du parrain local (apparence publique « emplacement=identifiant:niveau »,
   * voir shared/implants.ts) : les bras équipés deviennent mécaniques dans toutes les poses.
   */
  setCyber(look: string[] | undefined | null): void {
    const spec = cyberSpec(look ?? undefined);
    const sig = spec ? spec.arms.map((a) => (a ? `${a.id}:${a.q}` : '-')).join('|') : '';
    if (sig === this.cySig) return;
    this.cySig = sig;
    for (let i = 0; i < 2; i++) {
      const id = armImplant(spec, i);
      const st = this.cy[i];
      st.id = id;
      st.q = spec?.arms[i]?.q ?? 0;
      st.arm = null;
      if (!id) {
        st.action = null;
        st.charge = st.shield = st.grapple = false;
      }
    }
    this.rebuildArms();
  }

  /** Reconstruit mains et avant-bras (tenue, implants) de toutes les poses. */
  private rebuildArms(): void {
    const look = this.armLook;
    if (!look) return;
    for (const g of this.armGeos) g.dispose();
    this.armGeos = [];
    this.cyFores = [];
    const own = (g: THREE.BufferGeometry) => {
      this.armGeos.push(g);
      return g;
    };
    // modèles des bras mécaniques (géométries partagées par toutes les poses)
    const cyGeo: [CyGeo, CyGeo] = [null, null];
    for (let i = 0; i < 2; i++) {
      const st = this.cy[i];
      if (!st.id) continue;
      const side: Side = i === 0 ? 'L' : 'R';
      st.arm = cyberForearmFP(st.id, st.q, side, look);
      const parts = new Map<string, { geo: THREE.BufferGeometry; pivot: V3 }>();
      for (const p of st.arm.parts) parts.set(p.name, { geo: own(meshChar(p.model, 3)), pivot: p.pivot });
      const ch = i === 0 ? GLOW_CH.ARM_L_ACT : GLOW_CH.ARM_R_ACT;
      const sparks = st.id === 'choc' ? [1, 2, 3, 4].map((s) => own(meshChar(sparkFP(s * 7 + i, ch), 3))) : [];
      cyGeo[i] = { fore: own(meshChar(st.arm.forearm, 3)), parts, sparks };
    }
    /** Avant-bras mécanique placé : groupe neuf (géométries partagées). */
    const makeCyFore = (i: 0 | 1): CyFore => {
      const g = cyGeo[i]!;
      const group = new THREE.Group();
      group.add(this.mesh(g.fore));
      const parts = new Map<string, { obj: THREE.Object3D; base: THREE.Vector3 }>();
      for (const [name, p] of g.parts) {
        const pivot = new THREE.Object3D();
        pivot.position.set(...p.pivot);
        const m = this.mesh(p.geo);
        m.position.set(-p.pivot[0], -p.pivot[1], -p.pivot[2]);
        pivot.add(m);
        group.add(pivot);
        parts.set(name, { obj: pivot, base: pivot.position.clone() });
      }
      const sparks = g.sparks.map((geo) => {
        const m = this.mesh(geo);
        m.visible = false;
        group.add(m);
        return m;
      });
      const cf: CyFore = { side: i, group, parts, sparks };
      this.cyFores.push(cf);
      return cf;
    };
    // mains (de chair ou mécaniques) par côté et par pose
    const handCache = new Map<string, { geo: THREE.BufferGeometry; wrist: V3 }>();
    const sleeveGeo: (THREE.BufferGeometry | null)[] = [null, null];
    const hand = (side: Side, pose: VM.HandPose) => {
      const key = `${side}:${pose}`;
      let h = handCache.get(key);
      if (!h) {
        const i = side === 'L' ? 0 : 1;
        const st = this.cy[i];
        if (st.id) {
          const mh = VM.mechHandModel(side, pose, look, fpMech(st.id, side));
          h = { geo: own(meshChar(mh.hand, 3)), wrist: mh.wrist };
        } else {
          const am = VM.armModels(side, pose, look);
          h = { geo: own(meshModel(am.hand)), wrist: am.wrist };
          if (!sleeveGeo[i]) sleeveGeo[i] = own(meshModel(am.forearm));
        }
        handCache.set(key, h);
      }
      return h;
    };
    /** Avant-bras d'un côté (mécanique ou manche). */
    const fore = (side: Side): THREE.Object3D => {
      const i = side === 'L' ? 0 : 1;
      if (this.cy[i].id) return makeCyFore(i as 0 | 1).group;
      if (!sleeveGeo[i]) sleeveGeo[i] = own(meshModel(VM.sleeveForearmModel(side, look)));
      return this.mesh(sleeveGeo[i]!);
    };
    for (const rig of [...this.rigs.values(), this.fistL]) {
      for (const o of rig.arms) o.removeFromParent();
      rig.arms = [];
      rig.forearms = [];
      rig.support = [];
      for (const slot of rig.def.hands) {
        const a = hand(slot.side, slot.pose);
        const parent = (slot.part && rig.parts.get(slot.part)?.obj) || rig.root;
        const hm = this.mesh(a.geo);
        hm.position.set(...slot.pos);
        hm.rotation.set(...slot.rot);
        // léger grossissement : la main enveloppe la poignée sans scintillement des faces communes
        hm.scale.setScalar(1.015);
        const fo = fore(slot.side);
        fo.position.set(...a.wrist).applyEuler(hm.rotation).add(hm.position);
        // une main portée par une pièce mobile garde sa place même quand la pièce coulisse
        if (parent !== rig.root) {
          const pd = rig.parts.get(slot.part!)!;
          hm.position.sub(pd.base);
          fo.position.sub(pd.base);
        }
        rig.forearms.push({ mesh: fo, slot, parent });
        parent.add(hm, fo);
        rig.arms.push(hm, fo);
        if (slot.support) rig.support.push(hm, fo);
      }
      rig.helper = null;
      const anim = RELOADS[RIGS_INV.get(rig.def) ?? Weapon.FISTS];
      const hd = anim?.helper;
      if (hd) {
        const a = hand('L', hd.pose);
        const group = new THREE.Group();
        const hm = this.mesh(a.geo);
        hm.position.set(...hd.handPos);
        hm.rotation.set(...hd.handRot);
        hm.scale.setScalar(1.015);
        group.add(hm);
        let item: THREE.Mesh | null = null;
        if (hd.item) {
          item = this.mesh(this.casingGeo[hd.item]);
          item.scale.setScalar(0.99);
          group.add(item);
        }
        const fo = fore('L');
        fo.position.set(...a.wrist).applyEuler(hm.rotation).add(hm.position);
        group.add(fo);
        group.visible = false;
        rig.root.add(group);
        rig.arms.push(group);
        rig.helper = { group, item, fore: fo as THREE.Mesh, anim: anim! };
        rig.forearms.push({ mesh: fo, slot: { pose: hd.pose, side: 'L', pos: [0, 0, 0], rot: [0, 0, 0], roll: 0 }, parent: group });
      }
    }
    // haut du bras (armes de bras, bras libres)
    for (const u of this.uppers) u.removeFromParent();
    this.uppers = [];
    const upperGeo = own(meshModel(VM.upperSleeveModel(look)));
    const upper = () => {
      const m = this.mesh(upperGeo);
      m.visible = false;
      this.root.add(m);
      this.uppers.push(m);
      return m;
    };
    // armes de bras : le repère de l'arme est le poignet, l'avant-bras mécanique en fait partie
    for (const r of this.armRigs.values()) r.root.removeFromParent();
    this.armRigs.clear();
    for (let i = 0; i < 2; i++) {
      const st = this.cy[i];
      const w = st.id ? IMPLANT_ARM_WEAPON[st.id] : undefined;
      if (!st.id || w === undefined || !st.arm) continue;
      const side: Side = i === 0 ? 'L' : 'R';
      const pose: VM.HandPose = w === Weapon.ARM_WHIP ? 'relax' : 'wfist';
      const def = armRigDef(w, side, st.arm.points.muzzle ?? st.arm.points.tip ?? null, st.arm.points.sight ?? null);
      const h = hand(side, pose);
      const statics: THREE.Object3D[] = [this.mesh(h.geo), makeCyFore(i as 0 | 1).group];
      if (w === Weapon.ARM_PISTOL && st.arm.points.sight) {
        const ret = this.mesh(own(meshModel(VM.reticleModel(SLOT.NEON_RED))));
        ret.position.set(...st.arm.points.sight);
        ret.name = 'reticle';
        statics.push(ret);
      }
      const rig = this.makeRig(def, statics);
      rig.upper = upper();
      this.armRigs.set(`${w}:${side}`, rig);
    }
    // bras libres : mains dans les poses libres, avant-bras rigide
    for (const fa of this.free) {
      fa.root.clear();
      fa.hands.clear();
      const side: Side = fa.side === 0 ? 'L' : 'R';
      for (const pose of FREE_POSES) {
        const h = hand(side, pose);
        const m = this.mesh(h.geo);
        m.visible = false;
        fa.root.add(m);
        fa.hands.set(pose, m);
      }
      fa.cy = this.cy[fa.side].id ? makeCyFore(fa.side) : null;
      fa.fore = fa.cy ? fa.cy.group : fore(side);
      fa.root.add(fa.fore);
      fa.upper = upper();
    }
    // filament du fouet
    for (const m of this.whipSegs) m.removeFromParent();
    this.whipSegs = [];
    if (this.cy.some((c) => c.id === 'fouet')) {
      const geo = own(meshChar(whipSegmentFP(), 3));
      for (let k = 0; k < 18; k++) {
        const m = this.mesh(geo);
        m.visible = false;
        this.root.add(m);
        this.whipSegs.push(m);
      }
    }
  }

  /** Côté de l'arme de bras affichée : bras sorti (setArmOut), sinon bras qui porte l'implant. */
  private armSideFor(w: Weapon): Side | null {
    const has = (i: number) => {
      const id = this.cy[i].id;
      return !!id && IMPLANT_ARM_WEAPON[id] === w;
    };
    if (this.armOut && has(this.armOut === 'L' ? 0 : 1)) return this.armOut;
    if (has(1)) return 'R';
    if (has(0)) return 'L';
    return null;
  }

  // ---------------------------------------------------------------- implants : commandes

  /** Bras dont l'arme de bras est sortie ('L' ou 'R') ; null : l'arme de bras est rangée. */
  setArmOut(side: Side | null): void {
    this.armOut = side;
  }

  /**
   * Geste ponctuel d'un bras mécanique : tir, coups, charge du poing, grappin (tir, lâcher),
   * bouclier (levé, baissé), répulseur, arc électrique, roquettes, piratage, sortie ou rentrée de
   * l'arme de bras. Les tirs et coups de l'arme tenue passent aussi par kick() et swing().
   */
  armAction(side: Side, action: ArmAction | string): void {
    const st = this.cy[side === 'L' ? 0 : 1];
    switch (action) {
      case 'fire':
        if (this.t - this.shotT > 0.05) this.kick(1);
        break;
      case 'slash':
      case 'punch':
      case 'whip':
        if (this.swingT < 0 || this.swingT > 0.3) this.swing();
        break;
      case 'charge-start':
        st.charge = true;
        break;
      case 'charge-release':
        st.charge = false;
        this.chargedSwing = Math.max(this.chargedSwing, st.chargeW);
        break;
      case 'grapple-fire':
        st.grapple = true;
        st.grappleT = 0;
        st.hook = 0;
        break;
      case 'grapple-release':
        st.grapple = false;
        break;
      case 'shield-on':
        st.shield = true;
        break;
      case 'shield-off':
        st.shield = false;
        break;
      case 'repulse':
      case 'shock':
      case 'rockets':
      case 'hack':
        st.action = action;
        st.actionT = 0;
        break;
      case 'deploy':
        this.armOut = side;
        break;
      case 'retract':
        if (this.armOut === side) this.armOut = null;
        break;
      default:
        break;
    }
  }

  /** Point d'ancrage du grappin (monde) ; null : aucun. (L'état du joueur est lu aussi.) */
  setGrappleTarget(p: THREE.Vector3 | null): void {
    if (p) (this.grappleTarget ??= new THREE.Vector3()).copy(p);
    else this.grappleTarget = null;
  }

  /** Posture de déplacement (bras) ; `t` : avancement de l'escalade (0..1), sinon estimé. */
  setMoveState(state: MoveState | string, t?: number): void {
    this.applyMove(state, t);
    this.moveSetAt = this.t;
  }

  private applyMove(state: string, t?: number): void {
    const s = MOVE_STATES.includes(state) ? (state as MoveState) : 'normal';
    if (s !== this.moveState) {
      this.moveState = s;
      this.moveT = 0;
    }
    this.climbU = t !== undefined && s === 'climb' ? clamp(t, 0, 1) : -1;
  }

  /** Mode de vision du parrain : ses bras paraissent en signature de chaleur en vision thermique. */
  setVision(mode: VisionMode): void {
    this.cyData.setVision(mode);
  }

  // ---------------------------------------------------------------- événements

  kick(n: number): void {
    const w = this.shown;
    const rc = RIGS[w].recoil;
    const k = w === Weapon.PISTOL ? 1 : w === Weapon.SMG ? 0.8 : w === Weapon.ARM_PISTOL ? 0.85 : 1.25;
    // impulsions : la crête du ressort vaut ≈ 0,6 × n (recul arrière et relevé du canon)
    this.kickPos.v += 30 * n;
    this.kickRot.v += 16 * n * k;
    this.kickRoll = (Math.random() - 0.5) * 2;
    if (rc.jitter) this.kickYaw.v += (Math.random() - 0.5) * 2 * rc.jitter * 60;
    this.shotT = this.t;
    if (RIGS[w].cycle) {
      this.cycleT = 0;
      this.cycleEvents.clear();
    }
    // pistolet d'avant-bras : le canon chauffe à chaque tir
    if (w === Weapon.ARM_PISTOL && this.shownArm) {
      const st = this.cy[this.shownArm === 'L' ? 0 : 1];
      st.heat = Math.min(1, st.heat + 0.2);
    }
  }

  swing(): void {
    const w = this.shown;
    if (this.curRig?.def.armSide) {
      if (w === Weapon.ARM_BLADE) {
        // enchaînement : diagonale, revers, remontante (repart de la première après une pause)
        this.comboN = this.t - this.lastSwingAt < 0.95 ? (this.comboN + 1) % BLADE_COMBO.length : 0;
        this.swingKeys = BLADE_COMBO[this.comboN];
        this.swingDur = 0.42;
      } else {
        const sw = ARM_SWING[w];
        if (!sw) return;
        this.swingKeys = sw.keys;
        this.swingDur = sw.dur;
      }
      this.swingScale = 1;
      if (w === Weapon.ARM_FIST && this.chargedSwing > 0.05) {
        // coup chargé : plus ample, un peu plus long
        this.swingScale = 1 + 0.35 * this.chargedSwing;
        this.swingDur *= 1 + 0.25 * this.chargedSwing;
      }
      this.chargedSwing = 0;
      if (w === Weapon.ARM_WHIP) this.whipT = 0;
      this.swingT = 0;
      this.lastSwingAt = this.t;
      return;
    }
    const sw = SWING[w];
    if (!sw) return;
    this.swingKeys = null;
    this.swingScale = 1;
    this.swingT = 0;
    this.swingDur = sw.dur;
    this.lastSwingAt = this.t;
    if (w === Weapon.FISTS) this.punchLeft = !this.punchLeft;
  }

  // ---------------------------------------------------------------- animation

  update(dt: number, player: PlayerController, weapons: WeaponSystem, now: number): void {
    dt = clamp(dt, 0, 0.1);
    this.t += dt;
    this.weaponsRef = weapons;
    const pl = player as unknown as PlayerCyber;
    // posture de déplacement : lue sur le joueur tant que GameClient ne la transmet pas
    if (this.t - this.moveSetAt > 0.3 && typeof pl.moveState === 'function') this.applyMove(pl.moveState());
    this.moveT += dt;
    // --- changement d'arme : on baisse l'ancienne, on lève la nouvelle
    this.target = weapons.current;
    if (this.shown !== this.target) {
      this.down = Math.min(1, this.down + dt / 0.15);
      if (this.down >= 1) {
        this.shown = this.target;
        this.swingT = -1;
        this.swingKeys = null;
        this.reloadPhase = -1;
        this.cycleT = -1;
        this.whipT = -1;
      }
    } else this.down = Math.max(0, this.down - dt / 0.26);
    const w = this.shown;
    const armSide = isArmWeapon(w) ? this.armSideFor(w) : null;
    this.shownArm = armSide;
    const fistsRig = this.rigs.get(Weapon.FISTS)!;
    const rig = (armSide && this.armRigs.get(`${w}:${armSide}`)) || this.rigs.get(w) || fistsRig;
    this.curRig = rig;
    const def = rig.def;

    // --- déplacement : balancement, réception, saut, pas de côté
    const speed = Math.hypot(player.vel.x, player.vel.z);
    const onGround = player.onGround;
    if (onGround) this.phase += dt * speed * ((Math.PI * 2) / 2.5);
    const bobTarget = onGround ? clamp(speed / 4.2, 0, 1.5) : 0;
    this.bobAmp += (bobTarget - this.bobAmp) * Math.min(1, dt * 8);
    if (onGround && !this.wasGround) this.land.v += clamp(-this.lastVy / 9, 0.25, 1.6) * 20;
    this.wasGround = onGround;
    this.lastVy = player.vel.y;
    this.land.step(dt);
    this.air += ((onGround ? 0 : 1) - this.air) * Math.min(1, dt * 6);
    const rs = Math.sin(player.yaw);
    const rcs = Math.cos(player.yaw);
    const side = player.vel.x * -rcs + player.vel.z * rs; // vitesse vers la droite
    this.strafe += (clamp(side / 4.2, -1, 1) - this.strafe) * Math.min(1, dt * 7);

    // --- inertie de visée : l'arme traîne derrière les mouvements de souris
    if (!this.lookInit) {
      this.lastYaw = player.yaw;
      this.lastPitch = player.pitch;
      this.lookInit = true;
    }
    let dy = player.yaw - this.lastYaw;
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    const dp = player.pitch - this.lastPitch;
    this.lastYaw = player.yaw;
    this.lastPitch = player.pitch;
    const inv = dt > 1e-4 ? 1 / dt : 0;
    this.swayYaw.step(dt, clamp(dy * inv * 0.016, -0.075, 0.075));
    this.swayPitch.step(dt, clamp(dp * inv * 0.016, -0.06, 0.06));

    // --- recul et cycle de tir
    this.kickPos.step(dt);
    this.kickRot.step(dt);
    this.kickYaw.step(dt);
    const cyc = def.cycle;
    let cycleT = -1;
    if (cyc && this.cycleT >= 0) {
      const el = this.t - this.shotT - cyc.delay;
      if (el >= 0) cycleT = el / cyc.dur;
      if (cycleT >= 1) {
        cycleT = -1;
        this.cycleT = -1;
      }
    }

    // --- rechargement
    const ranged = WEAPONS[w].ranged;
    const reloading = ranged && weapons.reloading(now) && this.down < 0.5;
    let reloadT = -1;
    if (reloading) {
      const dur = WEAPONS[w].reload;
      reloadT = clamp(1 - (weapons.reloadUntil - now) / dur, 0, 1);
      if (this.reloadPhase < 0 || reloadT < this.reloadPhase) this.reloadEvents.clear();
      this.reloadPhase = reloadT;
      cycleT = -1;
    } else this.reloadPhase = -1;

    // --- coups
    if (this.swingT >= 0) {
      this.swingT += dt / this.swingDur;
      if (this.swingT >= 1) {
        this.swingT = -1;
        this.swingKeys = null;
        this.swingScale = 1;
      }
    }

    // --- visée / course
    const swinging = this.swingT >= 0;
    const aiming = player.aiming && !reloading && this.down < 0.5 && this.lowerW < 0.5;
    const aimRate = dt / 0.17;
    this.aimLin = clamp(this.aimLin + (aiming ? aimRate : -aimRate), 0, 1);
    const sprinting = player.sprint && speed > 3 && !aiming && !reloading && !swinging && onGround && this.moveState !== 'slide';
    this.sprintLin = clamp(this.sprintLin + (sprinting ? dt / 0.25 : -dt / 0.2), 0, 1);
    const a = def.ads ? smooth01(this.aimLin) : 0;
    const sp = smooth01(this.sprintLin);

    // --- implants : gestes, tâches des bras libres, abaissement de l'arme
    this.updateSides(dt, pl, rig, w, armSide, reloadT);

    // ------------------------------------------------ pose de l'arme principale
    const fists = rig === fistsRig;
    this.composePose(rig, a, sp, reloadT, cycleT, false);
    if (fists) this.composePose(this.fistL, 0, sp, -1, -1, true);
    for (const r of this.rigs.values()) r.root.visible = r === rig;
    for (const r of this.armRigs.values()) r.root.visible = r === rig;
    this.fistL.root.visible = fists && !this.busy[0];

    // --- pièces mobiles, bras, douilles
    this.updateParts(rig, w, reloadT, cycleT);
    // la main d'appui (gauche) lâche l'arme quand le bras gauche travaille
    if (this.busy[0]) for (const o of rig.support) o.visible = false;
    this.solveArms(rig);
    if (this.fistL.root.visible) this.solveArms(this.fistL);
    this.placeFree(dt, pl.camera ?? this.lastCam, pl.grapple?.anchor ?? pl.hook?.anchor ?? this.grappleTarget, sp);
    for (const r of this.armRigs.values()) this.placeUpper(r.upper, r.root, r.def.armSide === 'L' ? 0 : 1, r.root.visible);
    for (const fa of this.free) this.placeUpper(fa.upper, fa.root, fa.side, fa.root.visible);
    this.updateWhip(dt, rig);
    this.animateCyber(dt, w, armSide, reloadT);
    this.updateCasings(dt);
  }

  /** Gestes en cours, tâche de chaque bras libre, main lâchée, arme abaissée. */
  private updateSides(dt: number, pl: PlayerCyber, rig: Rig, w: Weapon, armSide: Side | null, reloadT: number): void {
    const ms = this.moveState;
    const ap = (cur: number, on: boolean, up: number, dn: number) => clamp(cur + (on ? dt / up : -dt / dn), 0, 1);
    this.slideW = ap(this.slideW, ms === 'slide', 0.12, 0.22);
    this.dashW = ap(this.dashW, ms === 'dash', 0.06, 0.28);
    this.wallW = ap(this.wallW, ms === 'wallrunL' || ms === 'wallrunR', 0.15, 0.22);
    if (ms === 'wallrunL') this.wallSide = -1;
    else if (ms === 'wallrunR') this.wallSide = 1;
    this.landW = ap(this.landW, ms === 'land', 0.05, 0.3);
    this.airW = ap(this.airW, ms === 'air', 0.22, 0.12);
    // grappin : l'état du joueur fait foi quand il est connu
    const hooked = 'grapple' in pl || 'hook' in pl ? !!(pl.grapple || pl.hook) : null;
    // mains tenues par l'arme affichée
    const fists = rig === this.rigs.get(Weapon.FISTS);
    const mainSide: 0 | 1 = armSide === 'L' ? 0 : 1;
    const helperL = !armSide && reloadT >= 0 && !!RELOADS[w]?.helper;
    const usesL = armSide ? armSide === 'L' : fists || helperL || rig.def.hands.some((h) => h.side === 'L');
    const usesR = armSide ? armSide === 'R' : true;
    for (let i = 0; i < 2; i++) {
      const st = this.cy[i];
      if (st.action) {
        st.actionT += dt;
        if (st.actionT >= (ACTION_DUR[st.action] ?? 1)) st.action = null;
      }
      if (st.id === 'grappin' && hooked !== null) {
        if (hooked && !st.grapple) {
          st.grapple = true;
          st.grappleT = 0;
          st.hook = 0;
        } else if (!hooked && st.grapple && st.grappleT > 0.45) st.grapple = false;
      }
      if (st.grapple) st.grappleT += dt;
      st.chargeW = ap(st.chargeW, st.charge, 0.9, 0.12);
      st.shieldW = ap(st.shieldW, st.shield, 0.16, 0.22);
      // tâche du bras libre, par ordre de priorité
      const used = i === 0 ? usesL : usesR;
      const main = i === mainSide;
      let task = '';
      if (ms === 'climb') task = 'climb';
      else if (st.id && st.action) task = st.action;
      else if (st.id === 'grappin' && st.grapple) task = 'grapple';
      else if (st.id === 'bouclier' && st.shield) task = 'shield';
      else if (((ms === 'wallrunL' && i === 0) || (ms === 'wallrunR' && i === 1)) && !main) task = 'wall';
      else if (ms === 'slide' && !main) task = 'slide';
      else if (st.id && !used) task = this.airW > 0.5 ? 'air' : 'rest';
      this.busy[i] = used && task !== '' && task !== 'rest' && task !== 'air';
      this.free[i].want = task;
    }
    this.lowerW = ap(this.lowerW, this.busy[mainSide] || ms === 'climb', 0.12, 0.22);
  }

  /** Calcule la pose d'une arme (ou d'un poing) dans le repère de la caméra. */
  private composePose(rig: Rig, a: number, sp: number, reloadT: number, cycleT: number, isLeftFist: boolean): void {
    const def = rig.def;
    const w = this.shown;
    const hip = def.hip;
    const ads = def.ads ?? hip;
    const armW = def.armSide !== undefined;
    const fists = isLeftFist || rig === this.rigs.get(Weapon.FISTS);
    /** Miroir des gestes (poing gauche, arme du bras gauche). */
    const mir = isLeftFist || def.armSide === 'L' ? -1 : 1;
    const guarding = fists || (armW && (w === Weapon.ARM_BLADE || w === Weapon.ARM_FIST));
    const guard = guarding && this.aimLin > 0 ? smooth01(this.aimLin) : 0;
    // pose de base : hanche ↔ visée, puis course
    let px = hip.pos[0] + (ads.pos[0] - hip.pos[0]) * a;
    let py = hip.pos[1] + (ads.pos[1] - hip.pos[1]) * a;
    let pz = hip.pos[2] + (ads.pos[2] - hip.pos[2]) * a;
    let rx = hip.rot[0] + (ads.rot[0] - hip.rot[0]) * a;
    let ry = hip.rot[1] + (ads.rot[1] - hip.rot[1]) * a;
    let rz = hip.rot[2] + (ads.rot[2] - hip.rot[2]) * a;
    px += (def.sprint.pos[0] - px) * sp;
    py += (def.sprint.pos[1] - py) * sp;
    pz += (def.sprint.pos[2] - pz) * sp;
    rx += (def.sprint.rot[0] - rx) * sp;
    ry += (def.sprint.rot[1] - ry) * sp;
    rz += (def.sprint.rot[2] - rz) * sp;
    // poings (et armes de bras de mêlée) levés en garde haute quand on « vise »
    if (guard) {
      py += 0.05 * guard;
      pz += 0.03 * guard;
      px += (isLeftFist ? 0.04 : -0.035 * mir) * guard;
      rx += 0.25 * guard;
    }
    // --- balancement de marche (en 8), atténué en visée, ample en course
    const still = 1 - a * 0.85;
    const bk = this.bobAmp * still * (1 + sp * 0.6);
    const ph = this.phase;
    px += Math.sin(ph) * 0.011 * bk;
    py += (Math.cos(ph * 2) - 1) * 0.5 * 0.013 * bk;
    rz += Math.sin(ph) * 0.018 * bk;
    ry += Math.sin(ph) * 0.012 * bk;
    rx += (Math.cos(ph * 2) - 1) * 0.5 * 0.02 * bk * sp;
    if ((fists || armW) && sp > 0) {
      // en course, les poings (et le bras armé) battent la mesure
      const s = Math.sin(ph + (mir < 0 ? Math.PI : 0));
      py += s * 0.03 * sp;
      pz += s * 0.03 * sp;
      rx += s * 0.25 * sp;
    }
    // --- respiration (au repos)
    const br = (1 - a * 0.75) * (1 - Math.min(1, this.bobAmp));
    const tt = this.t;
    py += Math.sin(tt * 1.7) * 0.0022 * br;
    px += Math.sin(tt * 0.85 + 1.3) * 0.0012 * br;
    rx += Math.sin(tt * 1.7 + 0.8) * 0.007 * br;
    rz += Math.sin(tt * 0.85) * 0.006 * br;
    if (fists) {
      // garde de boxeur : léger va-et-vient alterné
      const f = Math.sin(tt * 2.6 + (isLeftFist ? 0 : Math.PI));
      py += f * 0.006 * (1 - sp);
      pz += f * 0.008 * (1 - sp);
    }
    // --- inertie de visée : quand la vue tourne, l'arme reste un instant en arrière (elle
    // glisse vers l'extérieur du virage, le canon pointe en retard) et s'incline dans le virage
    const swk = 1 - a * 0.6;
    const sy = this.swayYaw.x * swk;
    const spi = this.swayPitch.x * swk;
    px += sy * 0.24;
    py -= spi * 0.2;
    ry -= sy * 0.9;
    rz += sy * 0.5;
    rx -= spi * 0.8;
    // --- pas de côté : l'arme s'incline dans le sens du déplacement
    rz -= this.strafe * 0.05 * (1 - a * 0.6);
    px -= this.strafe * 0.006;
    // --- saut et réception (lourde : creux plus marqué)
    py += this.air * 0.012 - this.land.x * 0.045;
    rx -= this.land.x * 0.12 - this.air * 0.04;
    const lw = smooth01(this.landW);
    py -= 0.025 * lw;
    rx -= 0.07 * lw;
    // --- déplacements augmentés
    const aw = smooth01(this.airW);
    py += 0.012 * aw;
    rx += 0.06 * aw;
    const sl = smooth01(this.slideW);
    if (sl > 0) {
      // glissade : l'arme remonte un peu et se couche vers le centre
      py += 0.018 * sl;
      pz += 0.02 * sl;
      rx += 0.07 * sl;
      rz += 0.22 * sl * mir;
    }
    const dw = smooth01(this.dashW);
    if (dw > 0) {
      // esquive : l'arme est balayée vers l'arrière, à l'opposé de la poussée
      pz += 0.05 * dw;
      py -= 0.025 * dw;
      rx -= 0.12 * dw;
      px -= this.strafe * 0.05 * dw;
      rz += this.strafe * 0.25 * dw;
    }
    const ww = smooth01(this.wallW);
    if (ww > 0) {
      // course murale : l'arme s'écarte du mur
      rz -= this.wallSide * 0.16 * ww;
      px -= this.wallSide * 0.025 * ww;
      py += 0.01 * ww;
    }
    // --- poing hydraulique : armé en arrière pendant la charge, tremblant à pleine charge
    if (armW && w === Weapon.ARM_FIST) {
      const ch = smooth01(this.cy[def.armSide === 'L' ? 0 : 1].chargeW);
      if (ch > 0) {
        pz += 0.075 * ch;
        py -= 0.02 * ch;
        px += 0.02 * ch * mir;
        rx -= 0.18 * ch;
        rz += 0.25 * ch * mir;
        const tr = ch * ch;
        px += Math.sin(tt * 73) * 0.0018 * tr;
        py += Math.sin(tt * 61 + 1) * 0.0015 * tr;
      }
    }
    // --- arme abaissée : changement d'arme, ou un bras libre prend la main qui la tient
    const dn = smooth01(Math.max(this.down, this.lowerW));
    py -= dn * 0.3;
    px += dn * 0.05 * (armW ? mir : 1);
    rx -= dn * 0.75;
    rz += dn * 0.2 * (armW ? mir : 1);
    // --- rechargement et cycle de tir (images clés)
    const ko = this.keyOut;
    const anim = !isLeftFist && reloadT >= 0 ? RELOADS[w] : undefined;
    const animT = anim ? reloadT : cycleT;
    const cur = anim ?? (cycleT >= 0 && !isLeftFist ? def.cycle?.anim : undefined);
    if (cur && animT >= 0) {
      sampleN(cur.keys, 6, animT, ko);
      // la course de la pompe est atténuée en visée (le tireur garde l'arme à l'épaule)
      const k = anim ? 1 : 1 - a * 0.6;
      px += ko[0] * k * mir;
      py += ko[1] * k;
      pz += ko[2] * k;
      rx += ko[3] * k;
      ry += ko[4] * k * mir;
      rz += ko[5] * k * mir;
      // petites secousses quand on insère chargeur, cartouche ou cellule
      for (const lt of cur.jolts ?? []) {
        const d = (animT - lt) / 0.03;
        if (d > -1 && d < 1) {
          const kk = Math.cos(d * Math.PI * 0.5);
          py -= 0.006 * kk;
          rx -= 0.045 * kk;
        }
      }
    }
    // --- coups
    const keys = this.swingKeys ?? SWING[w]?.keys;
    const activeSwing = this.swingT >= 0 && !!keys && (!fists || armW || isLeftFist === this.punchLeft);
    if (activeSwing && keys && armW) {
      // arme de bras : l'avant-bras tourne autour du coude, puis le coude se déplace
      sampleN(keys, 6, this.swingT, ko);
      const s = this.swingScale;
      const el = this.fD.set(0, 0, ARM_ELBOW).applyQuaternion(this.qA.setFromEuler(this.e.set(rx, ry, rz, 'YXZ')));
      const ex = px + el.x;
      const ey = py + el.y;
      const ez = pz + el.z;
      rx += ko[3] * s;
      ry += ko[4] * mir * s;
      rz += ko[5] * mir * s;
      el.set(0, 0, ARM_ELBOW).applyQuaternion(this.qA.setFromEuler(this.e.set(rx, ry, rz, 'YXZ')));
      px = ex - el.x + ko[0] * mir * s;
      py = ey - el.y + ko[1] * s;
      pz = ez - el.z + ko[2] * s;
    } else if (activeSwing && keys) {
      sampleN(keys, 6, this.swingT, ko);
      const s = this.swingScale;
      px += ko[0] * mir * s;
      py += ko[1] * s;
      pz += ko[2] * s;
      rx += ko[3] * s;
      ry += ko[4] * mir * s;
      rz += ko[5] * mir * s;
    } else if (this.swingT >= 0 && fists) {
      // l'autre poing se replie en garde pendant le direct
      const k = Math.sin(clamp(this.swingT, 0, 1) * Math.PI);
      pz += 0.03 * k;
      py -= 0.012 * k;
    }
    // --- orientation, puis recul autour du poignet
    this.e.set(rx, ry, rz, 'YXZ');
    this.Q.setFromEuler(this.e);
    this.P.set(px, py, pz);
    const rc = def.recoil;
    if (rc.climb > 0) {
      const ak = 1 - a * 0.45;
      const climb = this.kickRot.x * rc.climb * ak;
      const roll = this.kickRot.x * rc.roll * this.kickRoll;
      this.q2.setFromEuler(this.e.set(climb, roll * 0.5 + this.kickYaw.x, roll, 'YXZ'));
      // p' = p + q·pivot − q·q2·pivot
      const pv = this.v.set(def.pivot[0], def.pivot[1], def.pivot[2]);
      const before = this.v2.copy(pv).applyQuaternion(this.Q);
      this.Q.multiply(this.q2);
      const after = pv.applyQuaternion(this.Q);
      this.P.add(before).sub(after);
      // translation le long de l'axe de l'arme
      const back = this.kickPos.x * rc.back * (1 - a * 0.3);
      this.P.add(this.v.set(0, this.kickPos.x * rc.up, back).applyQuaternion(this.Q));
    }
    rig.root.position.copy(this.P);
    rig.root.quaternion.copy(this.Q);
  }

  /** Matrice d'un objet de l'arme dans le repère de la caméra (la racine de la vue est l'identité). */
  private toCamera(obj: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
    out.identity();
    for (let o: THREE.Object3D | null = obj; o && o !== this.root; o = o.parent) {
      o.updateMatrix();
      out.premultiply(o.matrix);
    }
    return out;
  }

  /** L'objet est-il affiché (lui et tous ses parents jusqu'à la racine de la vue) ? */
  private drawn(obj: THREE.Object3D): boolean {
    for (let o: THREE.Object3D | null = obj; o && o !== this.root; o = o.parent) if (!o.visible) return false;
    return true;
  }

  /**
   * Cinématique inverse à deux segments (épaule fixe dans le repère de la caméra, bras et
   * avant-bras de longueur fixe, coude rejeté vers le bas et l'extérieur) : seul l'avant-bras
   * est dessiné, orienté du poignet vers le coude calculé.
   */
  private solveArms(rig: Rig): void {
    const Lu = 0.3;
    const Lf = VM.FOREARM_LENGTH;
    for (const f of rig.forearms) {
      if (!f.mesh.visible || !f.parent.visible) continue;
      const left = f.slot.side === 'L';
      // repère (dans la caméra) du porteur de l'avant-bras : l'arme, une pièce mobile, la main d'appoint
      const mp = this.toCamera(f.parent, this.mA);
      const wrist = this.v.copy(f.mesh.position).applyMatrix4(mp);
      const sh = f.slot.shoulder ?? (left ? SHOULDER_L : SHOULDER_R);
      const po = f.slot.pole ?? (left ? POLE_L : POLE_R);
      const D = this.v2.set(wrist.x - sh[0], wrist.y - sh[1], wrist.z - sh[2]);
      const d = clamp(D.length(), 0.05, Lu + Lf - 1e-3);
      D.normalize();
      const cosA = clamp((Lu * Lu + d * d - Lf * Lf) / (2 * Lu * d), -1, 1);
      const sinA = Math.sqrt(1 - cosA * cosA);
      // direction du coude : le pôle, rendu perpendiculaire à l'axe épaule → poignet
      const pv = this.up.set(po[0], po[1], po[2]);
      pv.addScaledVector(D, -pv.dot(D)).normalize();
      const ex = sh[0] + Lu * (cosA * D.x + sinA * pv.x);
      const ey = sh[1] + Lu * (cosA * D.y + sinA * pv.y);
      const ez = sh[2] + Lu * (cosA * D.z + sinA * pv.z);
      // direction poignet → coude, puis « haut » de la caméra, exprimés dans le repère du porteur
      const qi = this.q2.setFromRotationMatrix(this.m4.extractRotation(mp)).invert();
      const dir = this.v2.set(ex - wrist.x, ey - wrist.y, ez - wrist.z).applyQuaternion(qi);
      const up = this.up.set(0, 1, 0).applyQuaternion(qi);
      this.armQuat([dir.x, dir.y, dir.z], f.slot.roll, f.mesh.quaternion, up);
    }
  }

  // ---------------------------------------------------------------- bras libres

  /** Place les bras libres : pose de la tâche, fondu d'une tâche à l'autre, entrée par le bas. */
  private placeFree(dt: number, cam: THREE.Camera | null, anchor: THREE.Vector3 | null, sp: number): void {
    for (const fa of this.free) {
      const want = fa.want;
      if (want && want !== fa.task) {
        if (fa.w <= 0.02 || !fa.task) fa.blend = 1;
        else {
          // fondu depuis la pose affichée
          fa.from.copy(fa.pos);
          fa.fromQ.copy(fa.quat);
          fa.blend = 0;
        }
        fa.task = want;
      }
      const fast = want === 'grapple' || want === 'repulse';
      fa.w = clamp(fa.w + (want ? dt / (fast ? 0.07 : 0.14) : -dt / 0.18), 0, 1);
      if (fa.w <= 0 && !want) fa.task = '';
      if (!fa.task || !fa.fore) {
        fa.root.visible = false;
        continue;
      }
      const pose = this.freePose(fa, cam, anchor, sp, this.P, this.Q);
      if (fa.blend < 1) {
        fa.blend = Math.min(1, fa.blend + dt / 0.16);
        const u = smooth01(fa.blend);
        this.P.lerpVectors(fa.from, this.P, u);
        this.Q.slerpQuaternions(fa.fromQ, this.Q, u);
      }
      fa.pos.copy(this.P);
      fa.quat.copy(this.Q);
      if (fa.blend >= 0.5 || fa.pose === pose) fa.pose = pose;
      // présence : le bras monte du bas de l'écran en se redressant
      const e = 1 - smooth01(fa.w);
      fa.root.position.copy(fa.pos);
      fa.root.position.y -= 0.32 * e;
      fa.root.position.z += 0.04 * e;
      fa.root.quaternion.copy(fa.quat).premultiply(this.qA.setFromAxisAngle(this.v.set(1, 0, 0), -0.9 * e));
      fa.root.visible = fa.w > 0.001;
      for (const [p, m] of fa.hands) m.visible = p === fa.pose;
    }
  }

  /** Haut du bras : du coude (bout de l'avant-bras rigide) jusqu'à l'épaule. */
  private placeUpper(up: THREE.Mesh | null | undefined, root: THREE.Object3D, side: 0 | 1, on: boolean): void {
    if (!up) return;
    up.visible = on;
    if (!on) return;
    const e = this.fD.set(0, 0, VM.FOREARM_LENGTH).applyQuaternion(root.quaternion).add(root.position);
    const sh = side === 0 ? SHOULDER_L : SHOULDER_R;
    const d = this.fF.set(sh[0] - e.x, sh[1] - e.y, sh[2] - e.z);
    const len = d.length();
    up.position.copy(e);
    this.armQuat([d.x, d.y, d.z], 0, up.quaternion);
    up.scale.set(1, 1, Math.max(0.2, len / VM.UPPER_ARM_LENGTH));
  }

  /** Direction (repère de la vue subjective, normée) d'un point du monde, à défaut l'axe de visée. */
  private dirToView(p: THREE.Vector3 | null, cam: THREE.Camera | null, out: THREE.Vector3): THREE.Vector3 {
    if (!p || !cam) return out.set(0, 0.2, -1).normalize();
    cam.updateMatrixWorld();
    out.copy(p).applyMatrix4(this.mC.copy(cam.matrixWorld).invert());
    if (out.z > -1e-3 || out.lengthSq() < 1e-6) return out.set(0, 0.2, -1).normalize();
    // même direction à l'écran malgré le champ de vision propre à la vue subjective
    const fov = (cam as THREE.PerspectiveCamera).fov ?? this.mainFov;
    const k = Math.tan(THREE.MathUtils.degToRad(VM_FOV) / 2) / Math.tan(THREE.MathUtils.degToRad(fov || this.mainFov) / 2);
    out.x *= k;
    out.y *= k;
    return out.normalize();
  }

  /**
   * Pose d'un bras libre (repère de la caméra) : position du poignet et orientation de l'avant-bras
   * (avant-bras rigide dans le prolongement de la main, axe +Z vers le coude, dos de la main +Y).
   * Les poses sont données pour le bras droit ; le gauche en est le miroir.
   */
  private freePose(fa: FreeArm, cam: THREE.Camera | null, anchor: THREE.Vector3 | null, sp: number, P: THREE.Vector3, Q: THREE.Quaternion): VM.HandPose {
    const i = fa.side;
    const st = this.cy[i];
    const Z = this.fZ;
    const Y = this.fY;
    const t = this.t;
    const ph = this.phase;
    const bob = this.bobAmp;
    let pose: VM.HandPose = 'relax';
    switch (fa.task) {
      case 'climb': {
        // deux mains sur le rebord : elles s'y posent, puis poussent vers le bas en se hissant
        const u = this.climbU >= 0 ? this.climbU : clamp(this.moveT / 0.6, 0, 1);
        const e = smooth01(u);
        P.set(0.16, 0.01 - 0.25 * e, -0.43 + 0.07 * e);
        Z.set(0.12, -0.8 + 0.3 * e, 0.6);
        Y.set(0, 1, 0.35);
        pose = 'grab';
        break;
      }
      case 'wall': {
        // main à plat contre le mur, doigts vers l'avant et le haut ; elle glisse au rythme de la course
        const g = Math.sin(t * 9);
        P.set(0.27, -0.07 + g * 0.008, -0.42 + g * 0.01);
        Z.set(-0.25, -0.6, 0.76);
        Y.set(-1, 0.25, 0);
        pose = 'open';
        break;
      }
      case 'slide': {
        // bras en arrière, la main frôle le sol au bas de l'écran
        P.set(0.25, -0.205 + Math.sin(t * 37) * 0.0025, -0.36);
        Z.set(0.15, 0.2, 0.97);
        Y.set(0.1, 1, -0.15);
        pose = 'open';
        break;
      }
      case 'grapple': {
        // bras tendu vers l'ancre (à défaut, l'axe de visée), recul du tir
        const d = this.dirToView(anchor, cam, this.fD);
        if (i === 0) d.x = -d.x;
        d.x = clamp(d.x, -0.3, 0.35);
        d.y = clamp(d.y, -0.3, 0.55);
        d.z = Math.min(d.z, -0.55);
        d.normalize();
        const g = st.grappleT;
        const kick = g < 0.04 ? g / 0.04 : Math.exp(-(g - 0.04) * 10);
        // épaule ramenée vers l'axe : le bras tendu reste dans le champ
        P.set(0.12, -0.25, 0).addScaledVector(d, 0.5 - 0.06 * kick);
        Z.copy(d).negate();
        Y.set(0, 1, 0);
        pose = 'wfist';
        break;
      }
      case 'shield': {
        // avant-bras dressé devant soi, poing en haut, émetteur face à l'avant
        P.set(0.1, -0.035 + Math.sin(t * 2.2) * 0.003, -0.39);
        Z.set(0.22, -0.9, 0.38).normalize();
        diagUp(Z, this.fD.set(0, 0.1, -1), Y);
        pose = 'wfist';
        break;
      }
      case 'repulse': {
        // armé près de l'épaule, poussée paume en avant, tenue, retour
        const u = st.actionT;
        const k = u < 0.2 ? -0.4 * smooth01(u / 0.2) : u < 0.3 ? -0.4 + 1.4 * smooth01((u - 0.2) / 0.1) : u < 0.45 ? 1 : 1 - smooth01((u - 0.45) / 0.17);
        P.set(0.12 - 0.04 * k, -0.12 + 0.05 * k, -0.37 - 0.12 * k);
        Z.set(0.18, -0.88, 0.45);
        Y.set(0, 0.45, 1);
        pose = 'open';
        break;
      }
      case 'shock': {
        // bras tendu, doigts écartés, décharge (le bras tremble)
        const u = st.actionT;
        const k = smooth01(u / 0.18) * (1 - smooth01((u - 0.7) / 0.15));
        P.set(0.13 - 0.03 * k, -0.2 + 0.1 * k, -0.36 - 0.08 * k);
        if (u > 0.18 && u < 0.72) {
          P.x += Math.sin(t * 83) * 0.0022;
          P.y += Math.sin(t * 71 + 2) * 0.0022;
        }
        Z.set(0.22, -0.4, 0.89);
        Y.set(0, 1, 0.25);
        pose = 'open';
        break;
      }
      case 'rockets': {
        // avant-bras pointé vers l'avant, nacelle vers le haut ; recul de chaque roquette
        const u = st.actionT;
        const k = smooth01(u / 0.2) * (1 - smooth01((u - 1.25) / 0.2));
        P.set(0.15, -0.2 + 0.085 * k, -0.42);
        Z.set(0.18, -0.28, 0.94).normalize();
        diagUp(Z, this.fD.set(0, 1, 0), Y);
        for (const at of ROCKET_AT) {
          const d = u - at;
          if (d > 0 && d < 0.15) P.addScaledVector(Z, 0.03 * (1 - d / 0.15));
        }
        pose = 'wfist';
        break;
      }
      case 'hack': {
        // avant-bras levé, écran tourné vers soi, sondes vers la cible
        const u = st.actionT;
        const k = smooth01(u / 0.2) * (1 - smooth01((u - 1.1) / 0.2));
        P.set(0.1, -0.23 + 0.11 * k, -0.4);
        if (u > 0.35 && u < 1.0) P.y += Math.sin(t * 31) * 0.0015;
        Z.set(0.4, -0.45, 0.8);
        Y.set(-0.1, 0.55, 0.85);
        pose = 'open';
        break;
      }
      default: {
        // bras mécanique au repos (l'arme se tient de l'autre main) ; en l'air : bras levé
        const air = fa.task === 'air' ? 1 : 0;
        P.set(0.2, -0.2 + 0.08 * air, -0.42);
        Z.set(0.18, -0.32 - 0.25 * air, 0.93);
        Y.set(0.3, 1, 0.15);
        const s = Math.sin(ph + (i === 0 ? Math.PI : 0));
        P.x += Math.sin(ph) * 0.008 * bob;
        P.y += (Math.cos(ph * 2) - 1) * 0.006 * bob + Math.sin(t * 1.7 + i) * 0.002;
        // course : le bras pompe
        P.z += s * 0.06 * sp;
        P.y += s * 0.035 * sp;
        Z.y += s * 0.25 * sp;
        // inertie de visée
        P.x += this.swayYaw.x * 0.2;
        P.y -= this.swayPitch.x * 0.18 + this.land.x * 0.04;
        pose = air ? 'open' : st.id === 'poing' ? 'wfist' : 'relax';
        break;
      }
    }
    wristBasis(this.fF.copy(Z).normalize().negate(), Y, Q);
    if (i === 0) {
      P.x = -P.x;
      mirrorQ(Q);
    }
    return pose;
  }

  // ---------------------------------------------------------------- bras mécaniques

  /** États des pièces mobiles et intensités lumineuses des deux bras ; étincelles Tesla. */
  private animateCyber(dt: number, w: Weapon, armSide: Side | null, reloadT: number): void {
    const cd = this.cyData;
    for (let i = 0; i < 2; i++) {
      const st = this.cy[i];
      const side: Side = i === 0 ? 'L' : 'R';
      const accCh = i === 0 ? GLOW_CH.ARM_L : GLOW_CH.ARM_R;
      const actCh = i === 0 ? GLOW_CH.ARM_L_ACT : GLOW_CH.ARM_R_ACT;
      const heatCh = i === 0 ? GLOW_CH.HEAT_L : GLOW_CH.HEAT_R;
      if (!st.id || !st.arm) {
        cd.setGlow(0, accCh, 0);
        cd.setGlow(0, actCh, 0);
        cd.setGlow(0, heatCh, 0);
        continue;
      }
      // arme de bras sortie de ce côté (elle se range dès qu'on en change)
      const out = armSide === side && isArmWeapon(w) && this.target === w;
      st.deploy = clamp(st.deploy + (out ? dt / 0.32 : -dt / 0.24), 0, 1);
      const d = st.deploy;
      const u = this.swingT;
      const mine = out && u >= 0;
      let act = 0.7;
      let pulse = 0;
      let hz = 0;
      let flick = 0;
      let heat = 0;
      st.heat = Math.max(0, st.heat - dt * 0.45);
      switch (st.id) {
        case 'pistoletBras': {
          // les plaques s'ouvrent, puis le canon sort ; il rentre pendant le rechargement
          const rl = out && reloadT > 0.12 && reloadT < 0.8;
          st.aux = clamp(st.aux + (rl ? dt / 0.12 : -dt / 0.12), 0, 1);
          st.open = smooth01(d * 2);
          st.slide = smooth01(d * 2 - 1) * (1 - smooth01(st.aux));
          const fl = out ? Math.max(0, 1 - (this.t - this.shotT) / 0.08) : 0;
          act = 0.5 + 1.6 * d + 5 * fl + (out && reloadT > 0.45 && reloadT < 0.6 ? 3 : 0);
          heat = st.heat * 3;
          break;
        }
        case 'lame': {
          // la lame jaillit ; le tranchant rougeoie et s'embrase pendant les tailles
          st.blade = 1 - (1 - d) ** 3;
          act = 0.6 + 1.8 * st.blade;
          heat = 0.8 * st.blade + (mine ? 2.6 * Math.sin(Math.PI * clamp(u, 0, 1)) : 0);
          break;
        }
        case 'poing': {
          // vérins armés en garde, détendus à l'impact, réarmés ensuite
          let r = d;
          if (mine) r = u < 0.3 ? d : u < 0.36 ? d * (1 - (u - 0.3) / 0.06) : u < 0.6 ? 0 : d * smooth01((u - 0.6) / 0.3);
          st.rods = r;
          const imp = mine && u > 0.3 && u < 0.5 ? 1 - (u - 0.3) / 0.2 : 0;
          act = 0.6 + 1.6 * d + 4 * st.chargeW + 5 * imp;
          if (st.chargeW > 0) {
            pulse = 0.35 * st.chargeW;
            hz = 4 + 6 * st.chargeW;
          }
          heat = 2.5 * st.chargeW + 1.5 * imp;
          break;
        }
        case 'fouet':
          act = 0.8 + 1.2 * d + (out && this.whipT >= 0 ? 2.5 : 0);
          break;
        case 'grappin': {
          // crochet parti tant que le grappin est tiré ou accroché ; il revient se loger ensuite
          if (st.grapple) st.hook = 0;
          else st.hook = Math.min(1, st.hook + dt / 0.35);
          const fl = st.grapple ? Math.max(0, 1 - st.grappleT / 0.25) : 0;
          act = 0.8 + (st.grapple ? 1.2 : 0) + 4 * fl;
          break;
        }
        case 'bouclier':
          // les ailettes tournent vite quand le bouclier est levé
          st.fins += dt * (0.5 + 14 * st.shieldW);
          act = 0.8 + 3.2 * st.shieldW;
          pulse = 0.15 * st.shieldW;
          hz = 2.5;
          break;
        case 'repulseur': {
          const a = st.action === 'repulse' ? st.actionT : -1;
          const charge = a >= 0 && a < 0.22 ? a / 0.22 : 0;
          const fl = a >= 0.22 ? Math.max(0, 1 - (a - 0.22) / 0.25) : 0;
          act = 0.8 + 2.5 * charge + 7 * fl;
          break;
        }
        case 'choc': {
          const a = st.action === 'shock' ? st.actionT : -1;
          const on = a > 0.18 && a < 0.72;
          act = 0.7 + (a >= 0 ? 1.5 : 0) + (on ? 4 : 0);
          flick = on ? 0.8 : 0;
          break;
        }
        case 'roquettes': {
          // la nacelle se lève, le capot s'ouvre, quatre départs, puis tout se replie
          const a = st.action === 'rockets' ? st.actionT : -1;
          st.pod = a < 0 ? 0 : smooth01((a - 0.12) / 0.22) * (1 - smooth01((a - 1.12) / 0.22));
          st.cover = a < 0 ? 0 : smooth01((a - 0.25) / 0.12) * (1 - smooth01((a - 1.02) / 0.12));
          let fl = 0;
          for (const at of ROCKET_AT) {
            const dd = a - at;
            if (dd > 0 && dd < 0.12) fl = Math.max(fl, 1 - dd / 0.12);
          }
          act = 0.6 + 2.2 * st.pod + 5 * fl;
          break;
        }
        case 'outils': {
          // les sondes sortent sous le poignet, l'écran s'affole
          const a = st.action === 'hack' ? st.actionT : -1;
          st.probe = a < 0 ? 0 : smooth01((a - 0.2) / 0.15) * (1 - smooth01((a - 0.98) / 0.15));
          act = 1.2 + (a >= 0 ? 1.4 : 0);
          flick = a >= 0.35 && a < 1.0 ? 0.35 : 0;
          break;
        }
        default:
          act = 0.9;
          break;
      }
      st.act = act;
      cd.setGlow(0, accCh, 1.1 + 0.6 * d + 0.4 * st.shieldW);
      cd.setGlow(0, actCh, act, pulse, hz, flick);
      cd.setGlow(0, heatCh, heat);
      for (const cf of this.cyFores) if (cf.side === i) this.poseParts(cf, st);
    }
    cd.setGlow(0, GLOW_CH.TRIM, 1.2);
    cd.setGlow(0, GLOW_CH.WHIP, this.whipSegs.some((m) => m.visible) ? 5 : 0);
    // étincelles de l'arc électrique au bout des doigts (bras libre)
    for (const fa of this.free) {
      const sparks = fa.cy?.sparks;
      if (!sparks?.length) continue;
      const st = this.cy[fa.side];
      const on = fa.task === 'shock' && st.action === 'shock' && st.actionT > 0.18 && st.actionT < 0.72;
      sparks.forEach((m, k) => {
        m.visible = on && Math.random() < 0.6;
        if (!m.visible) return;
        m.position.set((k - 1.5) * 0.017 * (fa.side === 0 ? -1 : 1), -0.008, -0.165);
        m.rotation.set((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, Math.random() * 6.28);
        m.scale.setScalar(1.6 + Math.random() * 0.8);
      });
    }
    cd.flush();
  }

  /** Pièces mobiles d'un avant-bras mécanique selon l'état de son côté. */
  private poseParts(cf: CyFore, st: CySide): void {
    const tr = st.arm!.travel;
    const L = cf.side === 0;
    for (const [name, p] of cf.parts) {
      const o = p.obj;
      o.position.copy(p.base);
      switch (name) {
        case 'plateA':
        case 'plateB':
          // capot en deux plaques qui s'ouvrent en coquille autour de leur charnière
          o.rotation.set(0, 0, -Math.sign(p.base.x) * st.open * Math.PI);
          break;
        case 'barrel': {
          const shot = this.shownArm === (L ? 'L' : 'R') ? Math.max(0, 1 - (this.t - this.shotT) / 0.09) : 0;
          o.position.z += -(tr.barrel ?? 0) * st.slide + 0.014 * shot * st.slide;
          break;
        }
        case 'blade':
          o.position.z -= (tr.blade ?? 0) * st.blade;
          break;
        case 'rods':
          o.position.z += (tr.rods ?? 0) * st.rods;
          break;
        case 'probe':
          o.position.z -= (tr.probe ?? 0) * st.probe;
          break;
        case 'hook':
          o.visible = st.hook > 0.55;
          o.position.z -= (1 - st.hook) * 0.06;
          break;
        case 'fins':
          o.quaternion.setFromAxisAngle(L ? DIAG_L : DIAG_R, st.fins);
          break;
        case 'pod':
          o.quaternion.setFromAxisAngle(L ? POD_AX_L : POD_AX_R, st.pod * 0.5);
          break;
        case 'cover': {
          // le capot est porté par la nacelle (il s'ouvre vers l'avant, comme un pont-levis)
          const pod = cf.parts.get('pod');
          const ax = L ? POD_AX_L : POD_AX_R;
          const qp = this.qA.setFromAxisAngle(ax, st.pod * 0.5);
          if (pod) o.position.sub(pod.base).applyQuaternion(qp).add(pod.base);
          o.quaternion.copy(qp).multiply(this.q2.setFromAxisAngle(ax, -1.7 * st.cover));
          break;
        }
        default:
          break;
      }
    }
  }

  /** Filament du fouet : il se déroule de la main et traîne derrière le balayage. */
  private updateWhip(dt: number, rig: Rig): void {
    if (this.whipT >= 0) {
      this.whipT += dt;
      if (this.whipT > 0.62) this.whipT = -1;
    }
    const segs = this.whipSegs;
    if (!segs.length) return;
    // direction de la main (repère de la caméra), mémorisée à chaque image
    this.whipHead = (this.whipHead + 1) % this.whipHist.length;
    const h = this.whipHist[this.whipHead];
    h.t = this.t;
    h.p.set(0, 0, -1).applyQuaternion(rig.root.quaternion);
    const active = this.whipT >= 0 && rig.def.armSide !== undefined && this.shown === Weapon.ARM_WHIP;
    if (!active) {
      for (const m of segs) m.visible = false;
      return;
    }
    const u = this.whipT;
    const ext = u < 0.05 ? 0 : u < 0.22 ? (u - 0.05) / 0.17 : u < 0.42 ? 1 : Math.max(0, 1 - (u - 0.42) / 0.18);
    const n = Math.round(ext * segs.length);
    rig.root.updateMatrix();
    const p = this.fD.set(0, -0.01, -0.07).applyMatrix4(rig.root.matrix);
    for (let k = 0; k < segs.length; k++) {
      const m = segs[k];
      m.visible = k < n;
      if (!m.visible) continue;
      const d = this.histDir(this.t - k * 0.016, this.fZ);
      // le filament retombe un peu en bout de course
      d.y -= k * 0.012 * (u > 0.42 ? 2 : 1);
      d.normalize();
      m.position.copy(p);
      m.quaternion.setFromUnitVectors(Z_AXIS, d);
      p.addScaledVector(d, WHIP_SEG_FP);
    }
  }

  /** Direction de la main mémorisée la plus proche de l'instant `t`. */
  private histDir(t: number, out: THREE.Vector3): THREE.Vector3 {
    let best = this.whipHist[this.whipHead];
    let bd = Infinity;
    for (const h of this.whipHist) {
      const d = Math.abs(h.t - t);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return out.copy(best.p);
  }

  /** Pièces mobiles, main d'appoint, bobines et éjections selon le rechargement ou le cycle de tir. */
  private updateParts(rig: Rig, w: Weapon, reloadT: number, cycleT: number): void {
    const reload = reloadT >= 0 ? RELOADS[w] : undefined;
    const cycle = !reload && cycleT >= 0 ? rig.def.cycle?.anim : undefined;
    const anim = reload ?? cycle;
    const at = reload ? reloadT : cycleT;
    // --- pièces mobiles : décalage le long de leur course, chargeur retiré caché
    for (const [name, p] of rig.parts) {
      const track = anim?.parts?.[name];
      const off = track ? sampleTrack(track, at) : 0;
      p.obj.position.copy(p.base).addScaledVector(p.dir, off);
      p.obj.visible = !(reload && inIntervals(reload.hidden?.[name], at));
    }
    // --- main d'appui libérée pendant que la main d'appoint travaille
    const free = !!reload?.freeSupport && at >= reload.freeSupport[0] && at < reload.freeSupport[1];
    for (const o of rig.support) o.visible = !free;
    // --- main d'appoint
    const hp = rig.helper;
    if (hp) {
      const on = !!reload && reload === hp.anim;
      const vis = on ? stepVis(hp.anim.helper!.keys, at) : 0;
      hp.group.visible = vis > 0;
      if (vis > 0) {
        const ko = this.keyOut;
        sampleN(hp.anim.helper!.keys, 6, at, ko, 8);
        hp.group.position.set(ko[0], ko[1], ko[2]);
        hp.group.rotation.set(ko[3], ko[4], ko[5]);
        if (hp.item) hp.item.visible = vis > 1;
      }
    }
    // --- bobines du fusil à rail : éteintes après un tir, rallumées une à une pendant le
    // temps de recharge ; éteintes pendant l'échange de cellule, puis chargées
    if (rig.rings) {
      const n = rig.rings.lit.length;
      let charge: number;
      if (reload) charge = at < 0.6 ? 0 : clamp((at - 0.62) / 0.26, 0, 1);
      else charge = clamp((this.t - this.shotT) / (WEAPONS[Weapon.RIFLE].cooldown * 0.95), 0, 1);
      const empty = !reload && (this.weaponsRef?.mag.get(Weapon.RIFLE) ?? 1) === 0;
      for (let i = 0; i < n; i++) {
        // la bobine arrière s'allume la première
        const lit = !empty && charge >= (i + 1) / n - 1e-3;
        rig.rings.lit[i].visible = lit;
        rig.rings.dark[i].visible = !lit;
      }
    }
    // --- point rouge du Viper : visible canon sorti
    if (rig.def.armSide) {
      const ret = rig.root.getObjectByName('reticle');
      if (ret) ret.visible = this.cy[rig.def.armSide === 'L' ? 0 : 1].slide > 0.95 && this.aimLin > 0.4;
    }
    // --- éjections (douilles, chargeur vide, cellule usée)
    const events = reload ? this.reloadEvents : this.cycleEvents;
    for (const [i, ev] of (anim?.ejects ?? []).entries()) {
      const name = `${i}`;
      if (at >= ev.at && !events.has(name)) {
        events.add(name);
        this.spawnCasing(rig, ev);
      }
    }
  }

  private spawnCasing(rig: Rig, ev: EjectDef): void {
    if (this.casings.length > 24) {
      const old = this.casings.shift()!;
      old.mesh.removeFromParent();
    }
    const mesh = this.mesh(this.casingGeo[ev.kind]);
    const host = (ev.part && rig.parts.get(ev.part)?.obj) || rig.root;
    // position, orientation et vitesse dans le repère de la caméra
    const mh = this.toCamera(host, this.mA);
    const p = new THREE.Vector3(...ev.from).applyMatrix4(mh);
    const qh = new THREE.Quaternion().setFromRotationMatrix(this.m4.extractRotation(mh));
    const v = new THREE.Vector3(...ev.vel).applyQuaternion(this.q2.setFromRotationMatrix(this.m4.extractRotation(this.toCamera(rig.root, this.m4))));
    mesh.position.copy(p);
    mesh.quaternion.copy(qh);
    mesh.scale.setScalar(1.02);
    this.root.add(mesh);
    const heavy = ev.kind === 'mag' || ev.kind === 'smgMag' || ev.kind === 'cellSpent' || ev.kind === 'cell';
    const spin = heavy ? 5 : 18;
    this.casings.push({ mesh, vel: v, spin: new THREE.Vector3((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin), life: heavy ? 1.2 : 0.9 });
  }

  private updateCasings(dt: number): void {
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.life -= dt;
      c.vel.y -= 6.5 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      if (c.life <= 0) {
        c.mesh.removeFromParent();
        this.casings.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------- rendu

  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    this.lastCam = camera;
    this.camera.position.copy(camera.position);
    this.camera.quaternion.copy(camera.quaternion);
    if (this.camera.aspect !== camera.aspect) {
      this.camera.aspect = camera.aspect;
      this.camera.updateProjectionMatrix();
    }
    this.mainFov = camera.fov;
    this.camera.updateMatrixWorld(true);
    // lumière : soleil/lune adoucis, venant d'en haut et de derrière l'épaule gauche (la
    // lumière ambiante, elle, vient du volume de lumière à l'endroit où l'on se tient)
    const night = envUniforms.uNight.value;
    this.sun.intensity = 0.25 + 1.1 * (1 - night);
    this.sun.color.setRGB(1, 0.94 - 0.1 * night, 0.86 + 0.1 * night);
    const dir = this.v.set(-0.35, 0, 0.45).applyQuaternion(camera.quaternion);
    dir.y = 0;
    dir.normalize().multiplyScalar(0.55);
    dir.y = 1;
    this.sun.position.copy(camera.position).add(dir);
    this.sun.target.position.copy(camera.position);
    this.sun.target.updateMatrixWorld();
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }

  /** Point du repère de la vue subjective → monde, à la même place à l'écran (champs de vision différents). */
  private viewToWorld(p: THREE.Vector3, camera: THREE.PerspectiveCamera): THREE.Vector3 {
    const k = Math.tan(THREE.MathUtils.degToRad(camera.fov || this.mainFov) / 2) / Math.tan(THREE.MathUtils.degToRad(VM_FOV) / 2);
    p.x *= k;
    p.y *= k;
    return p.applyMatrix4(camera.matrixWorld);
  }

  /** Position monde de la bouche du canon (pour la flamme), corrigée du champ de vision. */
  muzzleWorld(camera: THREE.PerspectiveCamera): THREE.Vector3 {
    const rig = this.curRig ?? this.rigs.get(this.shown) ?? this.rigs.get(Weapon.FISTS)!;
    const tip = rig.def.meta.muzzle;
    // point dans le repère de la caméra de la vue subjective
    rig.root.updateMatrix();
    const p = new THREE.Vector3(...tip).applyMatrix4(rig.root.matrix);
    return this.viewToWorld(p, camera);
  }

  /** Bout du lanceur du grappin (monde) : départ du câble. */
  launcherTip(side: Side, camera?: THREE.PerspectiveCamera): THREE.Vector3 {
    return this.armPoint(side, 'tip', camera);
  }

  /** Bouche du pistolet d'avant-bras (monde) : flamme et traçante. */
  armWeapon(side: Side, camera?: THREE.PerspectiveCamera): THREE.Vector3 {
    return this.armPoint(side, 'muzzle', camera);
  }

  /** Point remarquable d'un bras mécanique affiché (monde) ; à défaut, le bas de l'écran de ce côté. */
  private armPoint(side: Side, key: string, camera?: THREE.PerspectiveCamera): THREE.Vector3 {
    const cam = camera ?? this.lastCam;
    const i = side === 'L' ? 0 : 1;
    const st = this.cy[i];
    const pt = st.arm?.points[key];
    const p = new THREE.Vector3();
    let host: THREE.Object3D | null = null;
    if (pt) {
      for (const cf of this.cyFores)
        if (cf.side === i && this.drawn(cf.group)) {
          host = cf.group;
          break;
        }
    }
    if (host && pt) {
      p.set(pt[0], pt[1], pt[2]);
      // le câble sort de la bouche du lanceur quand le crochet est parti
      if (key === 'tip' && st.id === 'grappin') p.z = pt[2] * st.hook + VM.HAND_RES * (1 - st.hook);
      p.applyMatrix4(this.toCamera(host, this.mA));
    } else p.set(side === 'L' ? -0.2 : 0.2, -0.26, -0.34);
    if (!cam) return p;
    cam.updateMatrixWorld();
    return this.viewToWorld(p, cam);
  }
}

/** Arme de chaque définition de pose (pour retrouver son rechargement). */
const RIGS_INV = new Map<RigDef, Weapon>(Object.entries(RIGS).map(([w, d]) => [d, Number(w) as Weapon]));
