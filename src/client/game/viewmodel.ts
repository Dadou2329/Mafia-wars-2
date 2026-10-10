// Vue subjective : avant-bras du parrain et arme tenue en main, dessinés par-dessus la
// scène (tampon de profondeur vidé). Modèles détaillés au 1/64 m (models/viewmodels.ts),
// mains rigidement liées à l'arme ou à ses pièces mobiles ; animation procédurale :
// balancement de marche, respiration, inertie de visée, recul à ressort, visée aux organes de
// visée, course, réception de saut, changement d'arme, cycle de tir (culasse du Vektor, pompe
// du Hammer, recharge des bobines du Longbow), rechargements (chargeur du Vektor, chargeur
// supérieur et levier du Wasp, cartouches du Hammer, cellule d'énergie du Longbow) et coups
// (direct alterné, taille à la lame thermique, coup de matraque électrique par le haut).

import * as THREE from 'three';
import { CharKind, WEAPONS, Weapon } from '../../shared/characters';
import type { Slot } from '../../shared/protocol';
import { clamp } from '../../shared/util';
import { appearanceFor, type BossCustom } from '../characters/styles';
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

export class Viewmodel {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(VM_FOV, 1, 0.01, 10);
  private root = new THREE.Group();
  private material = createObjectMaterial({ noFog: true, key: 'viewmodel' });
  private sun = new THREE.DirectionalLight(0xfff1dc, 1.2);
  private rigs = new Map<Weapon, Rig>();
  private fistL: Rig;
  private armGeos: THREE.BufferGeometry[] = [];
  private casingGeo = {} as Record<VM.CasingKind, THREE.BufferGeometry>;
  private casings: Casing[] = [];
  private look = '';
  private shown: Weapon = Weapon.PISTOL;
  private target: Weapon = Weapon.PISTOL;
  private weaponsRef: WeaponSystem | null = null;
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

  constructor() {
    this.scene.add(this.camera);
    this.camera.add(this.root);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    for (const k of CASING_KINDS) this.casingGeo[k] = meshModel(VM.casingModel(k));
    this.buildWeapons();
    this.fistL = this.makeRig(FIST_L, []);
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
    const look = VM.armLookFor(boss, app.outfit);
    for (const g of this.armGeos) g.dispose();
    this.armGeos = [];
    const cache = new Map<string, VM.ArmModels & { handGeo: THREE.BufferGeometry; foreGeo: THREE.BufferGeometry }>();
    const arm = (side: 'R' | 'L', pose: VM.HandPose) => {
      const key = `${side}:${pose}`;
      let a = cache.get(key);
      if (!a) {
        const am = VM.armModels(side, pose, look);
        a = { ...am, handGeo: meshModel(am.hand), foreGeo: meshModel(am.forearm) };
        this.armGeos.push(a.handGeo, a.foreGeo);
        cache.set(key, a);
      }
      return a;
    };
    for (const rig of [...this.rigs.values(), this.fistL]) {
      for (const o of rig.arms) o.removeFromParent();
      rig.arms = [];
      rig.forearms = [];
      rig.support = [];
      for (const slot of rig.def.hands) {
        const a = arm(slot.side, slot.pose);
        const parent = (slot.part && rig.parts.get(slot.part)?.obj) || rig.root;
        const hand = this.mesh(a.handGeo);
        hand.position.set(...slot.pos);
        hand.rotation.set(...slot.rot);
        // léger grossissement : la main enveloppe la poignée sans scintillement des faces communes
        hand.scale.setScalar(1.015);
        const fore = this.mesh(a.foreGeo);
        fore.position.set(...a.wrist).applyEuler(hand.rotation).add(hand.position);
        // une main portée par une pièce mobile garde sa place même quand la pièce coulisse
        if (parent !== rig.root) {
          const pd = rig.parts.get(slot.part!)!;
          hand.position.sub(pd.base);
          fore.position.sub(pd.base);
        }
        rig.forearms.push({ mesh: fore, slot, parent });
        parent.add(hand, fore);
        rig.arms.push(hand, fore);
        if (slot.support) rig.support.push(hand, fore);
      }
      rig.helper = null;
      const anim = RELOADS[RIGS_INV.get(rig.def) ?? Weapon.FISTS];
      const hd = anim?.helper;
      if (hd) {
        const a = arm('L', hd.pose);
        const group = new THREE.Group();
        const hm = this.mesh(a.handGeo);
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
        const fore = this.mesh(a.foreGeo);
        fore.position.set(...a.wrist).applyEuler(hm.rotation).add(hm.position);
        group.add(fore);
        group.visible = false;
        rig.root.add(group);
        rig.arms.push(group);
        rig.helper = { group, item, fore, anim: anim! };
        rig.forearms.push({ mesh: fore, slot: { pose: hd.pose, side: 'L', pos: [0, 0, 0], rot: [0, 0, 0], roll: 0 }, parent: group });
      }
    }
  }

  // ---------------------------------------------------------------- événements

  kick(n: number): void {
    const w = this.shown;
    const rc = RIGS[w].recoil;
    const k = w === Weapon.PISTOL ? 1 : w === Weapon.SMG ? 0.8 : 1.25;
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
  }

  swing(): void {
    const sw = SWING[this.shown];
    if (!sw) return;
    this.swingT = 0;
    this.swingDur = sw.dur;
    if (this.shown === Weapon.FISTS) this.punchLeft = !this.punchLeft;
  }

  // ---------------------------------------------------------------- animation

  update(dt: number, player: PlayerController, weapons: WeaponSystem, now: number): void {
    dt = clamp(dt, 0, 0.1);
    this.t += dt;
    this.weaponsRef = weapons;
    // --- changement d'arme : on baisse l'ancienne, on lève la nouvelle
    this.target = weapons.current;
    if (this.shown !== this.target) {
      this.down = Math.min(1, this.down + dt / 0.15);
      if (this.down >= 1) {
        this.shown = this.target;
        this.swingT = -1;
        this.reloadPhase = -1;
        this.cycleT = -1;
      }
    } else this.down = Math.max(0, this.down - dt / 0.26);
    const w = this.shown;
    const rig = this.rigs.get(w) ?? this.rigs.get(Weapon.FISTS)!;
    for (const [k, r] of this.rigs) r.root.visible = k === w;
    this.fistL.root.visible = w === Weapon.FISTS;
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
    const rc = Math.cos(player.yaw);
    const side = player.vel.x * -rc + player.vel.z * rs; // vitesse vers la droite
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
      if (this.swingT >= 1) this.swingT = -1;
    }

    // --- visée / course
    const swinging = this.swingT >= 0;
    const aiming = player.aiming && !reloading && this.down < 0.5;
    const aimRate = dt / 0.17;
    this.aimLin = clamp(this.aimLin + (aiming ? aimRate : -aimRate), 0, 1);
    const sprinting = player.sprint && speed > 3 && !aiming && !reloading && !swinging && onGround;
    this.sprintLin = clamp(this.sprintLin + (sprinting ? dt / 0.25 : -dt / 0.2), 0, 1);
    const a = def.ads ? smooth01(this.aimLin) : 0;
    const sp = smooth01(this.sprintLin);

    // ------------------------------------------------ pose de l'arme principale
    this.composePose(rig, a, sp, reloadT, cycleT, false);
    if (w === Weapon.FISTS) this.composePose(this.fistL, 0, sp, -1, -1, true);

    // --- pièces mobiles, bras, douilles
    this.updateParts(rig, w, reloadT, cycleT);
    this.solveArms(rig);
    if (w === Weapon.FISTS) this.solveArms(this.fistL);
    this.updateCasings(dt);
  }

  /** Calcule la pose d'une arme (ou d'un poing) dans le repère de la caméra. */
  private composePose(rig: Rig, a: number, sp: number, reloadT: number, cycleT: number, isLeftFist: boolean): void {
    const def = rig.def;
    const w = this.shown;
    const hip = def.hip;
    const ads = def.ads ?? hip;
    const fists = w === Weapon.FISTS;
    const guard = fists && this.aimLin > 0 ? smooth01(this.aimLin) : 0;
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
    // poings levés en garde haute quand on « vise »
    if (guard) {
      py += 0.05 * guard;
      pz += 0.03 * guard;
      px += (isLeftFist ? 0.04 : -0.035) * guard;
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
    if (fists && sp > 0) {
      // en course, les poings battent la mesure
      const s = Math.sin(ph + (isLeftFist ? Math.PI : 0));
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
    // --- saut et réception
    py += this.air * 0.012 - this.land.x * 0.045;
    rx -= this.land.x * 0.12 - this.air * 0.04;
    // --- changement d'arme
    const dn = smooth01(this.down);
    py -= dn * 0.3;
    px += dn * 0.05;
    rx -= dn * 0.75;
    rz += dn * 0.2;
    // --- rechargement et cycle de tir (images clés)
    const ko = this.keyOut;
    const anim = !isLeftFist && reloadT >= 0 ? RELOADS[w] : undefined;
    const animT = anim ? reloadT : cycleT;
    const cur = anim ?? (cycleT >= 0 && !isLeftFist ? def.cycle?.anim : undefined);
    if (cur && animT >= 0) {
      sampleN(cur.keys, 6, animT, ko);
      // la course de la pompe est atténuée en visée (le tireur garde l'arme à l'épaule)
      const k = anim ? 1 : 1 - a * 0.6;
      px += ko[0] * k;
      py += ko[1] * k;
      pz += ko[2] * k;
      rx += ko[3] * k;
      ry += ko[4] * k;
      rz += ko[5] * k;
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
    const sw = SWING[w];
    const activeSwing = this.swingT >= 0 && sw && (!fists || isLeftFist === this.punchLeft);
    if (activeSwing && sw) {
      sampleN(sw.keys, 6, this.swingT, ko);
      const mir = isLeftFist ? -1 : 1;
      px += ko[0] * mir;
      py += ko[1];
      pz += ko[2];
      rx += ko[3];
      ry += ko[4] * mir;
      rz += ko[5] * mir;
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

  /** Position monde de la bouche du canon (pour la flamme), corrigée du champ de vision. */
  muzzleWorld(camera: THREE.PerspectiveCamera): THREE.Vector3 {
    const w = this.shown;
    const rig = this.rigs.get(w) ?? this.rigs.get(Weapon.FISTS)!;
    const tip = rig.def.meta.muzzle;
    // point dans le repère de la caméra de la vue subjective
    rig.root.updateMatrix();
    const p = new THREE.Vector3(...tip).applyMatrix4(rig.root.matrix);
    // même position à l'écran avec le champ de vision de la caméra principale
    const k = Math.tan(THREE.MathUtils.degToRad(this.mainFov || camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(VM_FOV) / 2);
    p.x *= k;
    p.y *= k;
    return p.applyMatrix4(camera.matrixWorld);
  }
}

/** Arme de chaque définition de pose (pour retrouver son rechargement). */
const RIGS_INV = new Map<RigDef, Weapon>(Object.entries(RIGS).map(([w, d]) => [d, Number(w) as Weapon]));
