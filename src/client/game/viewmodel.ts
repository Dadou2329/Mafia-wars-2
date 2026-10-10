// Vue subjective : avant-bras du parrain et arme tenue en main, dessinés par-dessus la
// scène (tampon de profondeur vidé). Modèles détaillés au 1/64 m (models/viewmodels.ts),
// mains rigidement liées à l'arme ; animation procédurale : balancement de marche,
// respiration, inertie de visée, recul à ressort, visée aux organes de visée, course,
// réception de saut, changement d'arme, rechargements (bascule du Webley, du fusil, levier du
// Martini-Henry, douilles éjectées) et coups (direct alterné, taille au couteau, coup de
// matraque par le haut).

import * as THREE from 'three';
import { CharKind, WEAPONS, Weapon } from '../../shared/characters';
import type { Slot } from '../../shared/protocol';
import { clamp } from '../../shared/util';
import { appearanceFor, type BossCustom } from '../characters/styles';
import { meshModel } from '../models/modelMesher';
import * as VM from '../models/viewmodels';
import { envUniforms } from '../render/env';
import { createObjectMaterial } from '../render/voxelObjectMaterial';
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

/**
 * Une main rigidement attachée à l'arme ou à sa pièce mobile ; son avant-bras part du poignet
 * et s'oriente à chaque image vers le coude calculé (cinématique inverse, voir solveArms).
 */
interface HandSlot {
  pose: VM.HandPose;
  side: 'R' | 'L';
  /** Attachée à la pièce mobile (canons du fusil) plutôt qu'au corps de l'arme. */
  onPivot?: boolean;
  /** Position et orientation (Euler XYZ) du repère de la main dans le repère du porteur. */
  pos: V3;
  rot: V3;
  /** Roulis de la manche autour de son axe. */
  roll: number;
  /** Épaule (repère caméra) et direction du coude, si différentes des valeurs par défaut. */
  shoulder?: V3;
  pole?: V3;
}

interface RigDef {
  meta: VM.VmWeaponMeta;
  hip: PoseDef;
  ads?: PoseDef;
  sprint: PoseDef;
  hands: HandSlot[];
  /** Recul : translation arrière (m), relevé du canon (rad), montée (m), roulis (rad). */
  recoil: { back: number; climb: number; up: number; roll: number };
  /** Point autour duquel l'arme pivote au recul et dans les gestes (≈ poignet), repère de l'arme. */
  pivot: V3;
  /**
   * Main gauche qui vient glisser les cartouches pendant le rechargement : images clés
   * [t, x, y, z, rx, ry, rz, visible] dans le repère de l'arme (m, rad).
   */
  helper?: { pose: VM.HandPose; cartridge: 'pistol' | 'rifle' | 'shell'; keys: Key[] };
}

interface Rig {
  def: RigDef;
  /** Repère de l'arme (placé dans le repère de la caméra à chaque image). */
  root: THREE.Group;
  /** Pièce mobile (canon basculant, canons, levier), placée sur son pivot. */
  moving: THREE.Group | null;
  rims: THREE.Mesh | null;
  arms: THREE.Object3D[];
  /** Avant-bras orientés à chaque image par la cinématique inverse épaule-coude-poignet. */
  forearms: { mesh: THREE.Object3D; slot: HandSlot; onMoving: boolean }[];
  /** Main d'appoint du rechargement (main, cartouche), son avant-bras et la position de son poignet. */
  helper: { hand: THREE.Group; fore: THREE.Mesh; wrist: THREE.Vector3 } | null;
}

const S = VM.VM_RES;
/** Épaules (repère de la caméra) et direction vers laquelle les coudes se plient. */
const SHOULDER_R: V3 = [0.21, -0.32, 0.05];
const SHOULDER_L: V3 = [-0.21, -0.32, 0.05];
const POLE_R: V3 = [0.5, -1, 0.1];
const POLE_L: V3 = [-0.5, -1, 0.1];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const RIGS: Record<Weapon, RigDef> = {
  [Weapon.REVOLVER]: {
    meta: VM.REVOLVER,
    hip: { pos: [0.135, -0.12, -0.38], rot: [0.03, 0.34, 0.22] },
    ads: { pos: [0, -VM.REVOLVER.sightY, -0.44], rot: [0, 0, 0] },
    sprint: { pos: [0.12, -0.16, -0.34], rot: [-0.55, 0.6, 0.35] },
    hands: [{ pose: 'pistol', side: 'R', pos: [0, 0, 0], rot: VM.REVOLVER.gripRot, roll: 0.2 }],
    recoil: { back: 0.05, climb: 0.38, up: 0.014, roll: 0.05 },
    pivot: [0, -2 * S, 5 * S],
    // la main gauche glisse les six cartouches dans les chambres présentées vers le haut
    helper: {
      pose: 'fist',
      cartridge: 'pistol',
      keys: [
        [0, -0.12, -0.16, 0.08, -0.6, 0, 1.57, 0],
        [0.37, -0.12, -0.16, 0.08, -0.6, 0, 1.57, 1],
        [0.46, -0.004, 0.135, -0.058, -1.2, 0, 1.57, 1, 'out'],
        [0.74, -0.004, 0.13, -0.06, -1.2, 0, 1.57, 1],
        [0.8, -0.1, -0.12, 0.06, -0.6, 0, 1.57, 1, 'in'],
        [0.81, -0.1, -0.12, 0.06, -0.6, 0, 1.57, 0],
        [1, -0.1, -0.12, 0.06, -0.6, 0, 1.57, 0],
      ],
    },
  },
  [Weapon.SHOTGUN]: {
    meta: VM.SHOTGUN,
    hip: { pos: [0.12, -0.125, -0.3], rot: [0.04, 0.2, 0.08] },
    ads: { pos: [0, -VM.SHOTGUN.sightY, -0.35], rot: [0, 0, 0] },
    sprint: { pos: [0.08, -0.135, -0.3], rot: [0.12, 0.9, 0.75] },
    hands: [
      { pose: 'stock', side: 'R', pos: [0, 0, 0], rot: VM.SHOTGUN.gripRot, roll: 0.1 },
      // la main gauche tient la longuesse, solidaire des canons quand ils basculent
      { pose: 'support', side: 'L', onPivot: true, pos: sub(VM.SHOTGUN.support!, VM.SHOTGUN.pivot!), rot: VM.SHOTGUN.supportRot, roll: -0.3 },
    ],
    recoil: { back: 0.075, climb: 0.2, up: 0.01, roll: 0.03 },
    pivot: [0, 0, 18 * S],
  },
  [Weapon.RIFLE]: {
    meta: VM.RIFLE,
    hip: { pos: [0.12, -0.12, -0.29], rot: [0.04, 0.19, 0.08] },
    ads: { pos: [0, -VM.RIFLE.sightY, -0.31], rot: [0, 0, 0] },
    sprint: { pos: [0.08, -0.135, -0.3], rot: [0.12, 0.9, 0.75] },
    hands: [
      { pose: 'stock', side: 'R', pos: [0, 0, 0], rot: VM.RIFLE.gripRot, roll: 0.1 },
      { pose: 'support', side: 'L', pos: VM.RIFLE.support!, rot: VM.RIFLE.supportRot, roll: -0.3 },
    ],
    recoil: { back: 0.08, climb: 0.16, up: 0.012, roll: 0.025 },
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
    // (pas de bouche de canon : les métadonnées du couteau ne servent que de valeur par défaut)
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

// ------------------------------------------------------------------ images clés

/** Clé : [t, dx, dy, dz, rx, ry, rz, partie mobile, transition vers cette clé]. */
type Key = [number, number, number, number, number, number, number, number, Ease?];
type Ease = 'io' | 'in' | 'out' | 'lin';

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

/** Échantillonne une suite d'images clés : décalage de position, angles, pièce mobile. */
function sampleKeys(keys: Key[], t: number, out: number[]): void {
  let i = 1;
  while (i < keys.length - 1 && keys[i][0] < t) i++;
  const a = keys[i - 1];
  const b = keys[i];
  const u = ease(b[8], clamp((t - a[0]) / Math.max(1e-6, b[0] - a[0]), 0, 1));
  for (let k = 1; k <= 7; k++) {
    const va = a[k] as number;
    out[k - 1] = va + ((b[k] as number) - va) * u;
  }
}

// Rechargements (t normalisé sur la durée de WEAPONS[w].reload).
const RELOAD_KEYS: Partial<Record<Weapon, Key[]>> = {
  // Webley : on incline le revolver, on bascule le canon, canon en l'air (les douilles
  // tombent), on présente les chambres, on recharge, on referme d'un coup sec.
  [Weapon.REVOLVER]: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0.1, -0.06, 0.035, 0.0, 0.25, 0.45, -0.25, 0, 'io'],
    [0.16, -0.06, 0.035, 0.0, 0.2, 0.47, -0.27, -1.25, 'out'],
    [0.3, -0.05, 0.075, 0.02, 1.2, 0.35, -0.2, -1.25, 'io'],
    [0.42, -0.02, -0.01, 0.0, -0.1, 0.3, 1.05, -1.2, 'io'],
    [0.78, -0.02, -0.005, 0.0, -0.08, 0.28, 1.0, -1.2, 'io'],
    [0.85, -0.04, 0.03, 0.0, 0.3, 0.3, -0.1, 0, 'out'],
    [1, 0, 0, 0, 0, 0, 0, 0, 'io'],
  ],
  // Fusil : on incline l'arme, les canons basculent (la main gauche suit), éjection, deux
  // cartouches, fermeture d'un coup de poignet.
  [Weapon.SHOTGUN]: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0.1, -0.05, 0.02, 0.03, 0.02, 0.3, 0.45, 0, 'io'],
    [0.17, -0.055, 0.025, 0.03, -0.02, 0.32, 0.48, -0.5, 'out'],
    [0.26, -0.06, 0.03, 0.04, -0.08, 0.34, 0.52, -0.52, 'io'],
    [0.74, -0.06, 0.03, 0.04, -0.06, 0.34, 0.5, -0.52, 'io'],
    [0.8, -0.03, 0.02, 0.02, 0.15, 0.24, 0.3, 0, 'out'],
    [1, 0, 0, 0, 0, 0, 0, 0, 'io'],
  ],
  // Martini-Henry : on penche la carabine, levier abaissé (le bloc tombe, la douille est
  // éjectée), on glisse la cartouche, levier relevé.
  [Weapon.RIFLE]: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0.12, -0.035, 0.03, 0.01, 0.12, 0.28, -0.85, 0, 'io'],
    [0.2, -0.035, 0.03, 0.01, 0.1, 0.28, -0.9, 0.8, 'out'],
    [0.3, -0.04, 0.025, 0.02, 0.05, 0.3, -0.92, 0.8, 'io'],
    [0.7, -0.04, 0.025, 0.02, 0.06, 0.3, -0.9, 0.8, 'io'],
    [0.78, -0.02, 0.01, 0.01, 0.05, 0.2, -0.45, 0, 'out'],
    [1, 0, 0, 0, 0, 0, 0, 0, 'io'],
  ],
};

/** Coups : durée (s) et images clés (t normalisé). */
const SWING: Partial<Record<Weapon, { dur: number; keys: Key[] }>> = {
  // taille en diagonale : armé en haut à droite, la lame traverse l'écran vers le bas à gauche
  [Weapon.KNIFE]: {
    dur: 0.4,
    keys: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0.16, 0.05, 0.1, 0.05, 0.55, -0.35, -0.65, 0, 'out'],
      [0.42, -0.24, -0.09, -0.12, -0.45, 0.95, 0.95, 0, 'in'],
      [0.56, -0.26, -0.11, -0.1, -0.5, 1.0, 1.0, 0, 'out'],
      [1, 0, 0, 0, 0, 0, 0, 0, 'io'],
    ],
  },
  // coup de matraque par le haut : levée derrière l'épaule, abattue au centre
  [Weapon.CLUB]: {
    dur: 0.52,
    keys: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0.24, 0.04, 0.075, 0.03, 1.05, -0.12, -0.2, 0, 'out'],
      [0.44, -0.09, -0.05, -0.15, -1.15, 0.28, 0.18, 0, 'in'],
      [0.58, -0.09, -0.06, -0.14, -1.2, 0.3, 0.2, 0, 'out'],
      [1, 0, 0, 0, 0, 0, 0, 0, 'io'],
    ],
  },
  // direct : le poing part vers le centre de l'écran en tournant
  [Weapon.FISTS]: {
    dur: 0.34,
    keys: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0.12, 0.012, -0.012, 0.03, 0.05, 0, 0.05, 0, 'out'],
      [0.36, -0.07, 0.06, -0.15, 0.2, 0.22, 0.5, 0, 'out'],
      [0.5, -0.07, 0.06, -0.145, 0.2, 0.22, 0.5, 0, 'lin'],
      [1, 0, 0, 0, 0, 0, 0, 0, 'io'],
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

/** Douille éjectée (vit dans le repère de la caméra). */
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

export class Viewmodel {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(VM_FOV, 1, 0.01, 10);
  private root = new THREE.Group();
  private material = createObjectMaterial({ noFog: true, key: 'viewmodel' });
  private sun = new THREE.DirectionalLight(0xfff1dc, 1.2);
  private rigs = new Map<Weapon, Rig>();
  private fistL: Rig;
  private armGeos: THREE.BufferGeometry[] = [];
  private casingGeo: Record<'pistol' | 'rifle' | 'shell', THREE.BufferGeometry>;
  private casings: Casing[] = [];
  private look = '';
  private shown: Weapon = Weapon.REVOLVER;
  private target: Weapon = Weapon.REVOLVER;
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
  private kickRoll = 0;
  private swingT = -1;
  private swingDur = 0.4;
  private punchLeft = false;
  private reloadPhase = -1;
  private reloadEvents = new Set<string>();
  // --- temporaires
  private P = new THREE.Vector3();
  private Q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private up = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private keyOut = [0, 0, 0, 0, 0, 0, 0];
  private mainFov = 75;

  constructor() {
    this.scene.add(this.camera);
    this.camera.add(this.root);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.buildWeapons();
    this.fistL = this.makeRig(FIST_L, []);
    this.casingGeo = {
      pistol: meshModel(VM.casingModel('pistol')),
      rifle: meshModel(VM.casingModel('rifle')),
      shell: meshModel(VM.casingModel('shell')),
    };
    this.setLook('dadou', {});
  }

  // ---------------------------------------------------------------- construction

  private mesh(geo: THREE.BufferGeometry): THREE.Mesh {
    const m = new THREE.Mesh(geo, this.material);
    m.frustumCulled = false;
    return m;
  }

  private makeRig(def: RigDef, parts: THREE.Object3D[], moving: THREE.Group | null = null, rims: THREE.Mesh | null = null): Rig {
    const root = new THREE.Group();
    root.visible = false;
    for (const p of parts) root.add(p);
    if (moving) root.add(moving);
    this.root.add(root);
    return { def, root, moving, rims, arms: [], forearms: [], helper: null };
  }

  private buildWeapons(): void {
    // revolver : carcasse, crosse (repère main), ensemble basculant
    {
      const r = VM.revolverModels();
      const frame = this.mesh(meshModel(r.frame));
      const grip = this.mesh(meshModel(r.grip));
      grip.rotation.set(...VM.REVOLVER.gripRot);
      const moving = new THREE.Group();
      moving.position.set(...VM.REVOLVER.pivot!);
      moving.add(this.mesh(meshModel(r.barrel)));
      const rims = this.mesh(meshModel(r.rims));
      rims.visible = false;
      moving.add(rims);
      this.rigs.set(Weapon.REVOLVER, this.makeRig(RIGS[Weapon.REVOLVER], [frame, grip], moving, rims));
    }
    {
      const s = VM.shotgunModels();
      const moving = new THREE.Group();
      moving.position.set(...VM.SHOTGUN.pivot!);
      moving.add(this.mesh(meshModel(s.barrels)));
      const shells = this.mesh(meshModel(s.shells));
      shells.visible = false;
      moving.add(shells);
      this.rigs.set(Weapon.SHOTGUN, this.makeRig(RIGS[Weapon.SHOTGUN], [this.mesh(meshModel(s.body))], moving, shells));
    }
    {
      const r = VM.rifleModels();
      const moving = new THREE.Group();
      moving.position.set(...VM.RIFLE.pivot!);
      moving.add(this.mesh(meshModel(r.lever)));
      this.rigs.set(Weapon.RIFLE, this.makeRig(RIGS[Weapon.RIFLE], [this.mesh(meshModel(r.body))], moving));
    }
    this.rigs.set(Weapon.KNIFE, this.makeRig(RIGS[Weapon.KNIFE], [this.mesh(meshModel(VM.knifeModel()))]));
    this.rigs.set(Weapon.CLUB, this.makeRig(RIGS[Weapon.CLUB], [this.mesh(meshModel(VM.clubModel()))]));
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
      for (const slot of rig.def.hands) {
        const a = arm(slot.side, slot.pose);
        const parent = slot.onPivot && rig.moving ? rig.moving : rig.root;
        const hand = this.mesh(a.handGeo);
        hand.position.set(...slot.pos);
        hand.rotation.set(...slot.rot);
        // léger grossissement : la main enveloppe la poignée sans scintillement des faces communes
        hand.scale.setScalar(1.015);
        const fore = this.mesh(a.foreGeo);
        fore.position.set(...a.wrist).applyEuler(hand.rotation).add(hand.position);
        rig.forearms.push({ mesh: fore, slot, onMoving: parent !== rig.root });
        parent.add(hand, fore);
        rig.arms.push(hand, fore);
      }
      rig.helper = null;
      const hd = rig.def.helper;
      if (hd) {
        const a = arm('L', hd.pose);
        const hand = new THREE.Group();
        const hm = this.mesh(a.handGeo);
        hm.scale.setScalar(1.015);
        const cart = this.mesh(this.casingGeo[hd.cartridge]);
        cart.position.set(0.5 * S, 0, -3.5 * S);
        hand.add(hm, cart);
        const fore = this.mesh(a.foreGeo);
        hand.visible = fore.visible = false;
        rig.root.add(hand, fore);
        rig.arms.push(hand, fore);
        rig.helper = { hand, fore, wrist: new THREE.Vector3(...a.wrist) };
        rig.forearms.push({ mesh: fore, slot: { pose: hd.pose, side: 'L', pos: [0, 0, 0], rot: [0, 0, 0], roll: 0 }, onMoving: false });
      }
    }
  }

  // ---------------------------------------------------------------- événements

  kick(n: number): void {
    const w = this.shown;
    const k = w === Weapon.REVOLVER ? 1 : 1.25;
    // impulsions : la crête du ressort vaut ≈ 0,6 × n (recul arrière et relevé du canon)
    this.kickPos.v += 30 * n;
    this.kickRot.v += 16 * n * k;
    this.kickRoll = (Math.random() - 0.5) * 2;
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
      }
    } else this.down = Math.max(0, this.down - dt / 0.26);
    const w = this.shown;
    const rig = this.rigs.get(w)!;
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

    // --- recul
    this.kickPos.step(dt);
    this.kickRot.step(dt);

    // --- rechargement
    const ranged = WEAPONS[w].ranged;
    const reloading = ranged && weapons.reloading(now) && this.down < 0.5;
    let reloadT = -1;
    if (reloading) {
      const dur = WEAPONS[w].reload;
      reloadT = clamp(1 - (weapons.reloadUntil - now) / dur, 0, 1);
      if (this.reloadPhase < 0 || reloadT < this.reloadPhase) this.reloadEvents.clear();
      this.reloadPhase = reloadT;
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
    this.composePose(rig, a, sp, reloadT, false);
    if (w === Weapon.FISTS) this.composePose(this.fistL, 0, sp, -1, true);

    // --- pièces mobiles, bras, douilles
    this.updateParts(rig, w, reloadT);
    this.solveArms(rig);
    if (w === Weapon.FISTS) this.solveArms(this.fistL);
    this.updateCasings(dt);
  }

  /** Calcule la pose d'une arme (ou d'un poing) dans le repère de la caméra. */
  private composePose(rig: Rig, a: number, sp: number, reloadT: number, isLeftFist: boolean): void {
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
    // --- rechargement (images clés)
    const ko = this.keyOut;
    const reloadKeys = RELOAD_KEYS[w];
    if (reloadT >= 0 && reloadKeys) {
      sampleKeys(reloadKeys, reloadT, ko);
      px += ko[0];
      py += ko[1];
      pz += ko[2];
      rx += ko[3];
      ry += ko[4];
      rz += ko[5];
      // petites secousses quand on glisse les cartouches
      const loads = w === Weapon.REVOLVER ? [0.48, 0.53, 0.58, 0.63, 0.68, 0.73] : w === Weapon.SHOTGUN ? [0.45, 0.6] : [0.5];
      for (const lt of loads) {
        const d = (reloadT - lt) / 0.035;
        if (d > -1 && d < 1) {
          const k = Math.cos(d * Math.PI * 0.5);
          py -= 0.007 * k;
          rx -= 0.05 * k;
        }
      }
    }
    // --- coups
    const sw = SWING[w];
    const activeSwing = this.swingT >= 0 && sw && (!fists || isLeftFist === this.punchLeft);
    if (activeSwing && sw) {
      sampleKeys(sw.keys, this.swingT, ko);
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
      this.q2.setFromEuler(this.e.set(climb, roll * 0.5, roll, 'YXZ'));
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

  /**
   * Cinématique inverse à deux segments (épaule fixe dans le repère de la caméra, bras et
   * avant-bras de longueur fixe, coude rejeté vers le bas et l'extérieur) : seul l'avant-bras
   * est dessiné, orienté du poignet vers le coude calculé.
   */
  private solveArms(rig: Rig): void {
    const Lu = 0.3;
    const Lf = VM.FOREARM_LENGTH;
    for (const f of rig.forearms) {
      if (!f.mesh.visible) continue;
      const left = f.slot.side === 'L';
      // repère (dans la caméra) du porteur de l'avant-bras : l'arme ou sa pièce mobile
      const qp = this.q2.copy(rig.root.quaternion);
      const tp = this.P.copy(rig.root.position);
      if (f.onMoving && rig.moving) {
        tp.add(this.v.copy(rig.moving.position).applyQuaternion(qp));
        qp.multiply(rig.moving.quaternion);
      }
      const wrist = this.v.copy(f.mesh.position).applyQuaternion(qp).add(tp);
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
      const qi = qp.invert();
      const dir = this.v2.set(ex - wrist.x, ey - wrist.y, ez - wrist.z).applyQuaternion(qi);
      const up = this.up.set(0, 1, 0).applyQuaternion(qi);
      this.armQuat([dir.x, dir.y, dir.z], f.slot.roll, f.mesh.quaternion, up);
    }
  }

  /** Pièces mobiles (bascule, levier) et éjection des douilles selon l'avancement du rechargement. */
  private updateParts(rig: Rig, w: Weapon, reloadT: number): void {
    let ang = 0;
    if (reloadT >= 0 && RELOAD_KEYS[w]) {
      sampleKeys(RELOAD_KEYS[w]!, reloadT, this.keyOut);
      ang = this.keyOut[6];
    }
    if (rig.moving) rig.moving.rotation.x = ang;
    const hp = rig.helper;
    const hk = rig.def.helper?.keys;
    if (hp && hk) {
      const ko = this.keyOut;
      if (reloadT >= 0) sampleKeys(hk, reloadT, ko);
      const on = reloadT >= 0 && ko[6] > 0.5;
      hp.hand.visible = hp.fore.visible = on;
      if (on) {
        hp.hand.position.set(ko[0], ko[1], ko[2]);
        hp.hand.rotation.set(ko[3], ko[4], ko[5]);
        hp.fore.position.copy(hp.wrist).applyEuler(hp.hand.rotation).add(hp.hand.position);
      }
    }
    const ev = this.reloadEvents;
    const fire = (name: string, at: number, fn: () => void) => {
      if (reloadT >= at && !ev.has(name)) {
        ev.add(name);
        fn();
      }
    };
    if (w === Weapon.REVOLVER) {
      if (rig.rims) rig.rims.visible = reloadT >= 0 && ang < -0.15 && (reloadT < 0.31 || reloadT > 0.47);
      if (reloadT >= 0) {
        fire('eject', 0.31, () => {
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            this.spawnCasing(rig, 'pistol', [Math.cos(a) * 0.8 * S, (3 + Math.sin(a) * 0.8) * S, -1 * S], [(Math.random() - 0.5) * 0.25, -0.6 - Math.random() * 0.4, 0.4 + Math.random() * 0.3], true);
          }
        });
      }
    } else if (w === Weapon.SHOTGUN) {
      if (rig.rims) rig.rims.visible = reloadT >= 0 && ang < -0.1 && (reloadT < 0.19 || reloadT > 0.44);
      if (reloadT >= 0) {
        fire('eject', 0.19, () => {
          for (const x of [-1, 1]) this.spawnCasing(rig, 'shell', [x * S, 3 * S, -3 * S], [0.15 * x + 0.1, 1.1, 1.3], true);
        });
      }
    } else if (w === Weapon.RIFLE) {
      if (reloadT >= 0) fire('eject', 0.22, () => this.spawnCasing(rig, 'rifle', [0, 2.5 * S, -9 * S], [0.35, 1.25, 1.1], false));
    }
  }

  private spawnCasing(rig: Rig, kind: 'pistol' | 'rifle' | 'shell', local: V3, vel: V3, onMoving: boolean): void {
    if (this.casings.length > 16) {
      const old = this.casings.shift()!;
      old.mesh.removeFromParent();
    }
    const mesh = this.mesh(this.casingGeo[kind]);
    const host = onMoving && rig.moving ? rig.moving : rig.root;
    host.updateWorldMatrix(true, false);
    // position et vitesse dans le repère de la caméra
    const p = new THREE.Vector3(...local).applyMatrix4(host.matrixWorld);
    this.camera.updateWorldMatrix(true, false);
    p.applyMatrix4(this.m4.copy(this.camera.matrixWorld).invert());
    const qh = new THREE.Quaternion();
    host.getWorldQuaternion(qh);
    const qc = new THREE.Quaternion();
    this.camera.getWorldQuaternion(qc);
    qh.premultiply(qc.invert());
    const v = new THREE.Vector3(...vel).applyQuaternion(qh);
    mesh.position.copy(p);
    mesh.quaternion.copy(qh);
    mesh.scale.setScalar(1.02);
    this.root.add(mesh);
    this.casings.push({ mesh, vel: v, spin: new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18), life: 0.9 });
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
    const rig = this.rigs.get(w)!;
    const meta = rig.def.meta;
    let tip = meta.muzzle;
    // fusil : canon droit au premier coup, canon gauche au second
    if (w === Weapon.SHOTGUN && meta.muzzle2 && (this.weaponsRef?.mag.get(Weapon.SHOTGUN) ?? 1) === 0) tip = meta.muzzle2;
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
