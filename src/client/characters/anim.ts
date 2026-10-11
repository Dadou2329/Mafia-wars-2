// Animation procédurale des personnages (New York, 2085) : squelette à membres rigides,
// jambes en cinématique inverse (pieds posés au sol pendant l'appui, attaque du talon,
// déroulé du pied et poussée sur l'avant-pied, bassin qui monte, descend, se balance et
// tourne, buste en contre-rotation, tête stabilisée), bras en cinématique inverse pour la
// visée (pistolet à une ou deux mains, pistolet-mitrailleur, fusils épaulés), le port d'arme
// et les attitudes de repos, coups (poings, lame, matraque), lancer, interaction, assis, au
// volant, recroquevillé, sursaut à l'impact et chute à la mort. Les transitions sont lissées.
//
// Déplacements augmentés : accroupi (immobile ou en marche), glissade (pieds en avant, une main
// qui traîne au sol), esquive (élan penché, jambe arrière tendue), course murale (corps incliné
// à l'opposé du mur, main proche sur la paroi), grappin (bras tendu vers le crochet, jambes qui
// traînent), en l'air (genoux repliés puis jambes tendues vers le sol), double saut (salto
// avant groupé), réception (genoux fléchis, amortie), escalade (mains sur le rebord, on se
// hisse), bond chargé (accroupi bras en arrière, puis projeté), réception sismique (genou et
// poing au sol).
//
// Implants de bras : armes de bras (pistolet d'avant-bras pointé bras tendu sans arme en main,
// lame Mantis en garde et enchaînements de taille, poing hydraulique armé en arrière pendant la
// charge puis direct dévastateur, balayage du fouet monofilament dont le filament traîne derrière
// la main), gestes des capacités (bouclier levé devant soi, poussée de la paume du répulseur,
// décharge Tesla, salve de micro-roquettes avec recul, piratage au bras tactique, grappin tiré)
// et état des pièces mobiles (plaques, canon, lame, vérins, nacelle, crochet, sondes).
// Repère du corps : origine au sol sous le personnage, +Z devant, +X à gauche, en mètres
// (avant l'échelle du personnage).

import * as THREE from 'three';
import { Anim, IMPLANT_ARM_WEAPON, isArmWeapon, Weapon } from '../../shared/characters';
import { CFX } from '../../shared/implants';
import { angleDiff, clamp } from '../../shared/util';
import type { CharView } from './characterRenderer';
import { armImplant, type ArmImplant, type CyberSpec } from './cyber';
import { GRIP, WEAPON_META, type HandPose, type WeaponKind } from './parts';
import { grappleTip, VIPER_SLIDE, viperMuzzle, WHIP_SEG_LEN } from './partsCyber';
import { DIMS, RES, type Dims } from './rig';
import type { CharStyle } from './styles';

/** Membres animés (les cheveux, chapeaux et accessoires suivent la tête). */
export const PART = {
  PELVIS: 0,
  TORSO: 1,
  HEAD: 2,
  UARM_L: 3,
  UARM_R: 4,
  FARM_L: 5,
  FARM_R: 6,
  HAND_L: 7,
  HAND_R: 8,
  THIGH_L: 9,
  THIGH_R: 10,
  SHIN_L: 11,
  SHIN_R: 12,
  FOOT_L: 13,
  FOOT_R: 14,
  TAIL_L: 15,
  TAIL_R: 16,
  SKIRT_L: 17,
  SKIRT_R: 18,
  WEAPON: 19,
} as const;
export const NPARTS = 20;

const PI = Math.PI;
/** Échelle des têtes (et coiffures, chapeaux, lunettes). */
const HEAD_K = 1.05;
const HALF_PI = PI / 2;
const TAU = PI * 2;

export const WEAPON_KIND: Record<Weapon, WeaponKind | null> = {
  [Weapon.FISTS]: null,
  [Weapon.PISTOL]: 'pistol',
  [Weapon.SHOTGUN]: 'shotgun',
  [Weapon.RIFLE]: 'rifle',
  [Weapon.KNIFE]: 'knife',
  [Weapon.CLUB]: 'club',
  [Weapon.SMG]: 'smg',
  // armes de bras : rien en main (l'arme fait partie de l'avant-bras mécanique)
  [Weapon.ARM_PISTOL]: null,
  [Weapon.ARM_BLADE]: null,
  [Weapon.ARM_FIST]: null,
  [Weapon.ARM_WHIP]: null,
};

const longGun = (w: Weapon) => w === Weapon.RIFLE || w === Weapon.SHOTGUN;
const twoHanded = (w: Weapon) => longGun(w) || w === Weapon.SMG;
const melee = (w: Weapon) => w === Weapon.FISTS || w === Weapon.KNIFE || w === Weapon.CLUB || w === Weapon.ARM_BLADE || w === Weapon.ARM_FIST || w === Weapon.ARM_WHIP;

const smooth = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};
const sstep = (a: number, b: number, x: number) => smooth((x - a) / (b - a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const approach = (x: number, target: number, rate: number) => x + (target - x) * (1 - Math.exp(-rate));
const frac = (x: number) => x - Math.floor(x);

/** Images clés scalaires [t, valeur] (interpolation adoucie). */
function keys(k: number[][], t: number): number {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i][0]) {
      const u = smooth((t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]));
      return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * u;
    }
  }
  return k[k.length - 1][1];
}

// ------------------------------------------------------------------ objets temporaires

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _m3 = new THREE.Matrix4();
const _e = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function qEuler(x: number, y: number, z: number, order: THREE.EulerOrder, out: THREE.Quaternion): THREE.Quaternion {
  _e.set(x, y, z, order);
  return out.setFromEuler(_e);
}

/** Quaternion d'une base orthonormée (colonnes x, y, z). */
function qBasis(x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _m3.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m3);
}

const _qh = new THREE.Quaternion();
const _qk = new THREE.Quaternion();
const _hx = new THREE.Vector3();
const _hy = new THREE.Vector3();
const _hz = new THREE.Vector3();

/**
 * Orientation d'une main dans le repère du torse, donnée par la direction des doigts
 * (poignet → jointures) et la normale de la paume (au repos, bras ballants, la paume gauche
 * regarde −x et la droite +x ; le pouce part vers l'avant).
 */
function handQ(i: number, fx: number, fy: number, fz: number, px: number, py: number, pz: number, out = _qh): THREE.Quaternion {
  const y = _hy.set(-fx, -fy, -fz).normalize();
  const s = i === 0 ? -1 : 1;
  const x = _hx.set(px * s, py * s, pz * s);
  x.addScaledVector(y, -x.dot(y)).normalize();
  return qBasis(x, y, _hz.crossVectors(x, y), out);
}

/**
 * Main droite tenant le téléphone (repère du torse) : appareil incliné vers l'avant, écran
 * tourné vers le visage ; tient compte de la prise du téléphone dans la main (Rx(π/2)·Ry(0,4)).
 */
const PHONE_P = (() => {
  const yp = new THREE.Vector3(0.05, 0.55, 0.83).normalize();
  const xp = new THREE.Vector3(0, -0.83, 0.55);
  xp.addScaledVector(yp, -xp.dot(yp)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xp, yp, new THREE.Vector3().crossVectors(xp, yp)));
})();
const PHONE_HQ = PHONE_P.clone().multiply(
  new THREE.Quaternion().setFromAxisAngle(X_AXIS, HALF_PI).multiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, 0.4)).invert(),
);

/** Pose d'un bras : épaule (rotation dans le repère du torse), coude, torsion, poignet. */
class ArmPose {
  sh = new THREE.Quaternion();
  el = 0.2;
  tw = 0;
  wr = new THREE.Quaternion();
  copy(o: ArmPose): this {
    this.sh.copy(o.sh);
    this.el = o.el;
    this.tw = o.tw;
    this.wr.copy(o.wr);
    return this;
  }
  /** Rapproche cette pose de la cible (facteur 0..1). */
  toward(o: ArmPose, f: number): void {
    this.sh.slerp(o.sh, f);
    this.el += (o.el - this.el) * f;
    this.tw += (o.tw - this.tw) * f;
    this.wr.slerp(o.wr, f);
  }
}

interface FootT {
  pos: THREE.Vector3;
  pitch: number;
  yaw: number;
}

const newFoot = (): FootT => ({ pos: new THREE.Vector3(), pitch: 0, yaw: 0 });

/** États des pièces mobiles d'un bras mécanique (lissés). */
export interface CyArmState {
  /** Arme de bras sortie (0..1). */
  deploy: number;
  /** Plaques du Viper ouvertes, canon sorti (0..1). */
  open: number;
  slide: number;
  /** Lame Mantis sortie (0..1). */
  blade: number;
  /** Tiges des vérins du poing : 0 repos, 1 armées (rentrées), −1 frappe. */
  rods: number;
  /** Nacelle de roquettes déployée, capot ouvert (0..1). */
  pod: number;
  cover: number;
  /** Crochet du grappin sur son lanceur (0 : tiré, au bout du câble). */
  hook: number;
  /** Sondes du bras tactique sorties (0..1). */
  probe: number;
  /** Angle des ailettes de l'émetteur du bouclier (rad). */
  fins: number;
  /** Organe actif : intensité lumineuse relative (0..1, plus pendant un éclat). */
  act: number;
  /** Canon chaud, tranchant chauffé (0..1+). */
  heat: number;
}

const newCyArm = (): CyArmState => ({ deploy: 0, open: 0, slide: 0, blade: 0, rods: 0, pod: 0, cover: 0, hook: 1, probe: 0, fins: 0, act: 0, heat: 0 });

/** Nombre de segments du filament du fouet. */
export const WHIP_SEGS = 16;

/** Capacités dont le geste occupe un bras (durée du geste, s). */
const GESTURE: Record<string, number> = {
  repulseur: 0.62,
  choc: 0.8,
  roquettes: 1.45,
  outils: 1.1,
  lame: 0.55,
  poing: 0.55,
  fouet: 0.7,
  grappin: 0.35,
};

export class CharAnim {
  /** Matrices monde des membres (voir PART). */
  readonly mats: THREE.Matrix4[] = Array.from({ length: NPARTS }, () => new THREE.Matrix4());
  /** Pose des mains (gauche, droite) pour choisir leur modèle. */
  readonly hands: [HandPose, HandPose] = ['relax', 'relax'];
  /** Objet tenu dans la main droite (null : rien). */
  held: WeaponKind | null = null;
  readonly muzzle = new THREE.Vector3();
  readonly headPos = new THREE.Vector3();
  /** Le personnage est couché (pour la sphère d'élimination). */
  lying = false;
  /** Pièces mobiles des bras mécaniques (gauche, droite). */
  readonly cyArm: [CyArmState, CyArmState] = [newCyArm(), newCyArm()];
  /** Bout du lanceur du grappin de chaque bras (monde). */
  readonly grappleTips = [new THREE.Vector3(), new THREE.Vector3()];
  /** Segments du filament du fouet (monde) ; whipN : nombre de segments visibles. */
  readonly whipMats: THREE.Matrix4[] = Array.from({ length: WHIP_SEGS }, () => new THREE.Matrix4());
  whipN = 0;
  /** Éclat des propulseurs des jambes (esquive, double saut, bond), 0..1. */
  thrust = 0;
  /** Position monde des poignets (gauche, droite). */
  readonly wrists = [new THREE.Vector3(), new THREE.Vector3()];

  private yaw = 0;
  private yawInit = false;
  private phase = 0;
  private moveW = 0;
  private runW = 0;
  private sitW = 0;
  private driveW = 0;
  private cowerW = 0;
  private aimW = 0;
  private stanceW = 0;
  private idleT = 0;
  private seed = 0;
  private fallDir = -1;
  private lastMelee = -10;
  private punchSide = 0;
  /** Coups portés à l'arme de bras (enchaînements de la lame). */
  private combo = 0;
  // déplacements augmentés
  private crouchW = 0;
  private slideW = 0;
  private dashW = 0;
  private wallW = 0;
  private grapW = 0;
  private airW = 0;
  private climbW = 0;
  private leapW = 0;
  private launchW = 0;
  private slamW = 0;
  private landT = 10;
  private landK = 1;
  private flipT = 10;
  private wasAir = false;
  private animPrev: Anim = Anim.IDLE;
  private animAt = -10;
  private chargeW = 0;
  private stunW = 0;
  private shockW = 0;
  private dashX = 0;
  private dashZ = 1;
  private lastAbAt = -10;
  private cy: CyberSpec | null = null;
  /** Historique des directions du bras du fouet (pour le filament qui traîne). */
  private whipHist: { t: number; d: THREE.Vector3 }[] = Array.from({ length: 24 }, () => ({ t: -10, d: new THREE.Vector3(0, 0, 1) }));
  private whipHead = 0;
  // pose lissée du haut du corps (angles)
  private pelvisOff = new THREE.Vector3();
  private pelvisRot = new THREE.Vector3();
  private torsoRot = new THREE.Vector3();
  private headRot = new THREE.Vector3();
  private rootTilt = new THREE.Vector3();
  private arms = [new ArmPose(), new ArmPose()];
  private armT = [new ArmPose(), new ArmPose()];
  private tails = [0, 0];
  // cibles des pieds lissées pour les transitions d'état
  private feet = [newFoot(), newFoot()];
  private gaitFeet = [newFoot(), newFoot()];
  private stance = [true, true];
  // repères calculés
  private body = new THREE.Matrix4();
  private pelvisM = new THREE.Matrix4();
  private torsoM = new THREE.Matrix4();
  private torsoInv = new THREE.Matrix4();
  private weaponT = new THREE.Matrix4();
  private D: Dims = DIMS.m;
  private sc = 1;
  /** Vitesse verticale estimée (m/s) et hauteur précédente. */
  private vy = 0;
  private prevY = NaN;

  constructor(id: number) {
    let h = (id * 2654435761) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    this.seed = h;
    this.phase = (h % 1000) / 1000;
    this.idleT = (h % 977) / 37;
    this.fallDir = h % 10 < 6 ? -1 : 1;
    for (const a of this.arms) qEuler(0, 0, 0, 'ZXY', a.sh);
  }

  private m(v: number): number {
    return v * RES;
  }

  /** Implants visibles (pour les gestes et les pièces mobiles des bras). */
  setCyber(spec: CyberSpec | null): void {
    this.cy = spec;
  }

  /** Bras qui porte l'arme de bras en main (0 gauche, 1 droite), −1 sinon. */
  armWeaponSide(v: CharView): number {
    if (!isArmWeapon(v.weapon)) return -1;
    const fx = v.fx ?? 0;
    if (fx & CFX.ARM_R) return 1;
    if (fx & CFX.ARM_L) return 0;
    for (const i of [1, 0]) {
      const id = armImplant(this.cy, i);
      if (id && IMPLANT_ARM_WEAPON[id] === v.weapon) return i;
    }
    return 1;
  }

  /** Bras qui porte un implant donné (préférence au côté indiqué), −1 sinon. */
  private sideOf(id: string, pref?: 'L' | 'R'): number {
    if (pref) {
      const i = pref === 'L' ? 0 : 1;
      if (armImplant(this.cy, i) === id) return i;
    }
    for (const i of [0, 1]) if (armImplant(this.cy, i) === id) return i;
    return pref ? (pref === 'L' ? 0 : 1) : -1;
  }

  /** Met à jour la pose du personnage puis calcule les matrices monde de ses membres. */
  update(v: CharView, s: CharStyle, now: number, dt: number): void {
    const D = (this.D = DIMS[s.build]);
    const k = RES;
    const sc = (this.sc = s.scale);
    if (!this.yawInit) {
      this.yaw = v.yaw;
      this.yawInit = true;
    }
    const dead = v.anim === Anim.DEAD;
    const sitting = v.anim === Anim.SIT || v.anim === Anim.DRIVE;
    const driving = v.anim === Anim.DRIVE;
    const cowering = v.anim === Anim.COWER;
    const fx = dead ? 0 : (v.fx ?? 0);
    const A = v.anim;
    if (!dead) this.yaw += angleDiff(this.yaw, v.yaw) * (1 - Math.exp(-dt * 14));
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    // vitesse dans le repère du corps (unités du modèle)
    const vxl = (v.vx * cy - v.vz * sy) / sc;
    const vzl = (v.vx * sy + v.vz * cy) / sc;
    let speed = Math.hypot(vxl, vzl);
    if (dead || sitting) speed = 0;
    // vitesse verticale estimée (les instantanés ne la donnent pas)
    if (dt > 1e-4 && Number.isFinite(this.prevY)) this.vy = lerp(this.vy, clamp((v.y - this.prevY) / dt, -30, 30), 1 - Math.exp(-dt * 10));
    this.prevY = v.y;
    // ---------------------------------------------------------------- états augmentés
    if (A !== this.animPrev) {
      if (A === Anim.AIR_JUMP) this.flipT = 0;
      this.animPrev = A;
      this.animAt = now;
    }
    const tA = now - this.animAt;
    const airborne = A === Anim.AIR || A === Anim.AIR_JUMP || A === Anim.GRAPPLE || (A === Anim.LEAP && speed > 2.6);
    if (this.wasAir && !airborne && !dead) {
      this.landT = 0;
      this.landK = A === Anim.LAND ? 1 : 0.6;
    }
    if (A === Anim.LAND && tA < dt * 1.5 && this.landT > 0.3) {
      this.landT = 0;
      this.landK = 1;
    }
    this.wasAir = airborne;
    this.landT += dt;
    this.flipT += dt;
    const ab = v.ab;
    const sinceAb = ab ? now - ab.at : 99;
    if (ab && ab.at !== this.lastAbAt) {
      this.lastAbAt = ab.at;
      if (ab.kind === 'onde') this.slamW = 1;
    }
    // ---------------------------------------------------------------- poids des états
    const r = dt;
    this.sitW = approach(this.sitW, sitting ? 1 : 0, r * 6);
    this.driveW = approach(this.driveW, driving ? 1 : 0, r * 6);
    this.cowerW = approach(this.cowerW, cowering ? 1 : 0, r * 7);
    const leaping = A === Anim.LEAP;
    this.crouchW = approach(this.crouchW, A === Anim.CROUCH || A === Anim.CROUCH_WALK || (leaping && speed <= 2.6) ? 1 : 0, r * 10);
    this.slideW = approach(this.slideW, A === Anim.SLIDE ? 1 : 0, r * 12);
    this.dashW = approach(this.dashW, A === Anim.DASH ? 1 : 0, r * 16);
    this.wallW = approach(this.wallW, A === Anim.WALLRUN_L ? 1 : A === Anim.WALLRUN_R ? -1 : 0, r * 10);
    this.grapW = approach(this.grapW, A === Anim.GRAPPLE ? 1 : 0, r * 8);
    this.airW = approach(this.airW, A === Anim.AIR || A === Anim.AIR_JUMP ? 1 : 0, r * 9);
    this.climbW = approach(this.climbW, A === Anim.CLIMB ? 1 : 0, r * 12);
    this.leapW = approach(this.leapW, leaping && speed <= 2.6 ? 1 : 0, r * 10);
    this.launchW = approach(this.launchW, leaping && speed > 2.6 ? 1 : 0, r * 10);
    this.slamW = Math.max(0, this.slamW - dt / 0.9);
    this.chargeW = approach(this.chargeW, fx & CFX.CHARGE ? 1 : 0, r * 7);
    this.stunW = approach(this.stunW, fx & CFX.STUN ? 1 : 0, r * 5);
    this.shockW = approach(this.shockW, fx & CFX.SHOCK ? 1 : 0, r * 12);
    if (speed > 0.5 && A === Anim.DASH) {
      this.dashX = vxl / speed;
      this.dashZ = vzl / speed;
    }
    // part des poses « spéciales » (les pieds ne sont plus posés)
    const flying = Math.max(this.grapW, this.airW, this.climbW, this.launchW);
    const special = Math.max(flying, this.slideW, this.dashW);
    const free = (1 - this.sitW) * (1 - this.cowerW) * (1 - special * 0.85);
    this.moveW = approach(this.moveW, sstep(0.08, 0.8, speed) * free, r * 9);
    this.runW = approach(this.runW, sstep(2.0, 3.3, speed), r * 6);
    const w = v.weapon;
    const ranged = !melee(w);
    const aiming = v.aiming && !dead && !sitting && this.climbW < 0.5;
    this.aimW = approach(this.aimW, aiming ? 1 : 0, r * 12);
    // posture de tir décalée (fusils épaulés)
    this.stanceW = approach(this.stanceW, aiming && longGun(w) ? 1 : aiming && w === Weapon.PISTOL && !s.oneHand ? 0.4 : 0, r * 6);
    if (speed < 0.2) this.idleT += dt;

    // ---------------------------------------------------------------- démarche
    const run = this.runW;
    const crouch = this.crouchW;
    const walkS = clamp(0.5 + 0.42 * speed, 0.75, 1.5) * (1 - 0.25 * crouch);
    const runS = clamp(0.9 + 0.4 * speed, 1.9, 3.4);
    const stride = lerp(walkS, runS, run);
    // part du cycle en appui et longueur de l'appui (limitée par la longueur de jambe)
    const side = speed > 0.05 ? Math.abs(vxl) / speed : 0;
    const dMax = lerp(0.55, 0.62, run) * (1 - 0.5 * side);
    const dStance = Math.min(lerp(0.6, 0.38, run) * stride, dMax);
    const beta = clamp(dStance / stride, 0.22, 0.66);
    if (speed > 0.02 && !dead) this.phase += (speed / stride) * dt;
    const ph = this.phase;
    const dirX = speed > 0.05 ? vxl / speed : 0;
    const dirZ = speed > 0.05 ? vzl / speed : 1;
    const ankleH = this.m(D.ankle);
    const heelL = this.m(D.heel);
    const ballL = this.m(D.toe) * 0.72;
    const half = (heelL + ballL) / 2;
    const hsA = lerp(0.24, 0.1, run);
    const toA = lerp(0.55, 0.5, run);
    /** Cheville quand le pied (milieu de l'empreinte à c le long de la marche) est incliné de th. */
    const ankleAt = (c: number, th: number, out: THREE.Vector3): THREE.Vector3 => {
      let f: number;
      let u: number;
      if (th >= 0) {
        // talon fixe au sol
        const g = c - half;
        f = g + heelL * Math.cos(th) - ankleH * Math.sin(th);
        u = heelL * Math.sin(th) + ankleH * Math.cos(th);
      } else {
        // avant-pied fixe au sol
        const g = c + half;
        f = g - ballL * Math.cos(th) - ankleH * Math.sin(th);
        u = -ballL * Math.sin(th) + ankleH * Math.cos(th);
      }
      return out.set(dirX * f, u, dirZ * f);
    };
    const latW = lerp(0.085, 0.06, run) + side * 0.08 + crouch * 0.04;
    const lift = lerp(0.06 + 0.015 * speed, 0.15 + 0.045 * speed, run) * (1 - 0.35 * crouch);
    let pelvisDrop = 0;
    for (let i = 0; i < 2; i++) {
      const sideX = i === 0 ? 1 : -1;
      const psi = frac(ph + (i === 0 ? 0 : 0.5));
      const g = this.gaitFeet[i];
      if (psi < beta) {
        const sp = psi / beta;
        const c = dStance * (0.5 - sp) + 0.03;
        const th = sp < 0.14 ? hsA * (1 - sp / 0.14) ** 1.5 : sp > lerp(0.55, 0.42, run) ? -toA * smooth((sp - lerp(0.55, 0.42, run)) / (1 - lerp(0.55, 0.42, run))) : 0;
        ankleAt(c, th, g.pos);
        g.pitch = th;
        this.stance[i] = true;
        // course : le bassin s'enfonce au milieu de l'appui
        pelvisDrop = Math.max(pelvisDrop, Math.sin(sp * PI) * run * 0.035);
      } else {
        const u = (psi - beta) / (1 - beta);
        const a0 = ankleAt(dStance * -0.5 + 0.03, -toA, _v1);
        const a1 = ankleAt(dStance * 0.5 + 0.03, hsA, _v2);
        // marche : arc simple ; course : le talon monte d'abord vers la fesse, puis le genou
        // part devant (cheville haute sous le genou) et la jambe se déplie pour l'appui
        const e = smooth(u);
        const fw = lerp(a0.x * dirX + a0.z * dirZ, a1.x * dirX + a1.z * dirZ, e);
        const yw = lerp(a0.y, a1.y, u) + lift * Math.sin(PI * Math.pow(u, 0.85));
        let f = fw;
        let yy = yw;
        if (run > 0) {
          const h = dStance * 0.5;
          const fr = keys(
            [
              [0, -h],
              [0.3, -h * 0.95],
              [0.62, 0.02],
              [0.85, h * 1.05],
              [1, h],
            ],
            u,
          );
          const yr = keys(
            [
              [0, a0.y],
              [0.3, 0.2 + 0.05 * speed],
              [0.62, 0.17 + 0.035 * speed],
              [0.85, 0.12 + 0.01 * speed],
              [1, a1.y],
            ],
            u,
          );
          f = lerp(fw, fr, run);
          yy = lerp(yw, yr, run);
        }
        g.pos.set(dirX * f, yy, dirZ * f);
        g.pitch = u < 0.35 ? lerp(-toA, -0.15, u / 0.35) : lerp(-0.15, hsA, smooth((u - 0.35) / 0.65));
        this.stance[i] = false;
      }
      g.pos.x += sideX * latW;
      // course murale : les pieds courent sur la paroi
      g.pos.x += this.wallW * 0.16;
      g.yaw = sideX * 0.08;
    }
    const swayX = Math.cos(TAU * (ph - 0.25)) * lerp(0.022, 0.008, run) * this.moveW;
    const pelvisYaw = -Math.cos(TAU * ph) * lerp(0.07, 0.1, run) * this.moveW * (dirZ >= 0 ? 1 : -1);
    const pelvisRoll = Math.cos(TAU * (ph - 0.25)) * lerp(0.05, 0.03, run) * this.moveW;
    const flight = run * 0.025 * Math.max(0, Math.cos(TAU * 2 * (ph - 0.25 - beta / 2)));

    // ---------------------------------------------------------------- pieds : repos, assis, accroupi
    const idleShift = Math.sin(this.idleT * 0.42 + (this.seed % 7)) * 0.014 + Math.sin(this.idleT * 0.13) * 0.006;
    const stg = this.stanceW;
    // réception : genoux fléchis (impulsion amortie)
    const land = this.landT < 0.55 ? (this.landT < 0.07 ? this.landT / 0.07 : Math.exp(-(this.landT - 0.07) * 6.5)) * this.landK : 0;
    const flip = this.flipT < 0.6 ? this.flipT / 0.6 : -1;
    for (let i = 0; i < 2; i++) {
      const sideX = i === 0 ? 1 : -1;
      const f = this.feet[i];
      // repos (posture décalée en visée au fusil : pied gauche devant)
      _v3.set(sideX * lerp(0.1, i === 0 ? 0.07 : 0.13, stg), 0, lerp(0, i === 0 ? 0.15 : -0.12, stg));
      let pitch = 0;
      let yaw = sideX * 0.12 - stg * 0.35;
      // accroupi : pieds écartés, un peu décalés
      if (crouch > 0) {
        _v3.x = lerp(_v3.x, sideX * 0.15, crouch);
        _v3.z = lerp(_v3.z, i === 0 ? 0.09 : -0.05, crouch);
      }
      // marche
      const mw = this.moveW;
      _v3.lerp(this.gaitFeet[i].pos, mw);
      if (mw > 0) {
        pitch = lerp(pitch, this.gaitFeet[i].pitch, mw);
        yaw = lerp(yaw, this.gaitFeet[i].yaw, mw);
      }
      if (mw < 0.5) _v3.y = Math.max(_v3.y, ankleH);
      else _v3.y = lerp(ankleH, _v3.y, mw);
      // assis / au volant
      if (this.sitW > 0) {
        _v4.set(sideX * (0.11 + this.driveW * 0.03), ankleH, 0.38 + this.driveW * 0.12);
        _v3.lerp(_v4, this.sitW);
        pitch = lerp(pitch, 0.05, this.sitW);
        yaw = lerp(yaw, sideX * 0.15, this.sitW);
      }
      if (this.cowerW > 0) {
        _v4.set(sideX * 0.13, ankleH, 0.05);
        _v3.lerp(_v4, this.cowerW);
        pitch = lerp(pitch, -0.25, this.cowerW);
      }
      // glissade : jambe gauche tendue devant (talon au sol), droite repliée dessous
      if (this.slideW > 0) {
        if (i === 0) _v4.set(0.09, ankleH + 0.02, 0.86);
        else _v4.set(-0.17, ankleH - 0.01, 0.2);
        _v3.lerp(_v4, this.slideW);
        pitch = lerp(pitch, i === 0 ? 0.65 : -0.15, this.slideW);
        yaw = lerp(yaw, i === 0 ? 0.1 : -0.75, this.slideW);
      }
      // esquive : fente dans le sens de la poussée, jambe arrière tendue
      if (this.dashW > 0) {
        const lead = i === (this.dashX > 0.3 ? 0 : this.dashX < -0.3 ? 1 : 0);
        const d = lead ? 0.34 : -0.5;
        _v4.set(this.dashX * d + sideX * 0.12, ankleH + (lead ? 0.02 : 0.16), this.dashZ * d);
        _v3.lerp(_v4, this.dashW);
        pitch = lerp(pitch, lead ? 0.15 : -0.6, this.dashW);
      }
      // grappin : jambes qui traînent derrière, pointes tendues
      if (this.grapW > 0) {
        _v4.set(sideX * 0.11, ankleH + (i === 0 ? 0.16 : 0.06), i === 0 ? -0.12 : -0.26);
        _v3.lerp(_v4, this.grapW);
        pitch = lerp(pitch, -0.7, this.grapW);
      }
      // en l'air : genoux repliés à l'impulsion, puis jambes tendues vers le sol ; salto groupé
      if (this.airW > 0) {
        // à la montée les genoux remontent, à la descente les jambes se tendent vers le sol
        const tuck = flip >= 0 ? 1 : clamp(0.3 + this.vy * 0.22, 0, 1) * (tA < 0.7 ? 1 : 0.7);
        const up = 0.06 + 0.3 * tuck + (flip >= 0 ? 0.14 * Math.sin(flip * PI) : 0);
        _v4.set(sideX * 0.12, ankleH + up, 0.06 + 0.12 * tuck + (i === 0 ? 0.04 : -0.06) * (1 - tuck));
        _v3.lerp(_v4, this.airW);
        pitch = lerp(pitch, -0.35 * (1 - tuck) + 0.1, this.airW);
      }
      // escalade : un genou monte sur le rebord, l'autre jambe pend
      if (this.climbW > 0) {
        const u = clamp(tA / 0.75, 0, 1);
        if (i === 0) _v4.set(0.12, ankleH + 0.42 - 0.2 * u, 0.3);
        else _v4.set(-0.11, ankleH + 0.02 + 0.12 * u, -0.06);
        _v3.lerp(_v4, this.climbW);
        pitch = lerp(pitch, i === 0 ? 0.1 : -0.5, this.climbW);
      }
      // bond : projeté, corps tendu, jambes en arrière
      if (this.launchW > 0) {
        _v4.set(sideX * 0.1, ankleH + (i === 0 ? 0.28 : 0.12), i === 0 ? -0.18 : -0.42);
        _v3.lerp(_v4, this.launchW);
        pitch = lerp(pitch, -0.8, this.launchW);
      }
      // réception sismique : genou droit au sol, pied gauche devant
      if (this.slamW > 0) {
        const kk = smooth(Math.min(1, this.slamW * 3));
        if (i === 0) _v4.set(0.15, ankleH, 0.32);
        else _v4.set(-0.13, ankleH + 0.02, -0.38);
        _v3.lerp(_v4, kk);
        pitch = lerp(pitch, i === 0 ? 0 : -0.9, kk);
      }
      f.pos.copy(_v3);
      f.pitch = pitch;
      f.yaw = yaw;
    }

    // ---------------------------------------------------------------- bassin
    const restY = this.m(D.pelvisY);
    // cible lissée : repos, assis, accroupi
    const tOff = _v1.set(idleShift * (1 - this.moveW) + swayX, 0, 0);
    tOff.y = -0.004 - this.moveW * lerp(0.003, 0.03, run) - pelvisDrop + flight - stg * 0.04;
    let tPitch = 0.02 + this.moveW * lerp(0.03, 0.09, run);
    let tRoll = (idleShift / 0.014) * 0.025 * (1 - this.moveW) + pelvisRoll;
    if (this.sitW > 0) {
      tOff.lerp(_v2.set(0, 0.565 - restY + this.driveW * 0.02, -0.07), this.sitW);
      tPitch = lerp(tPitch, -0.22, this.sitW);
      tRoll *= 1 - this.sitW;
    }
    if (this.cowerW > 0) {
      tOff.lerp(_v2.set(0, 0.47 - restY, -0.1), this.cowerW);
      tPitch = lerp(tPitch, 0.55, this.cowerW);
    }
    if (crouch > 0) {
      // accroupi (et bond chargé : plus bas encore)
      const deep = this.leapW;
      tOff.y = lerp(tOff.y, -0.34 - 0.12 * deep - (this.moveW > 0.3 ? 0.02 : 0), crouch);
      tOff.z = lerp(tOff.z, -0.06, crouch);
      tPitch = lerp(tPitch, 0.32 + 0.25 * deep, crouch);
    }
    if (this.slideW > 0) {
      tOff.lerp(_v2.set(0, 0.36 - restY, -0.12), this.slideW);
      tPitch = lerp(tPitch, -0.55, this.slideW);
      tRoll = lerp(tRoll, -0.12, this.slideW);
    }
    if (this.dashW > 0) {
      tOff.y = lerp(tOff.y, -0.12, this.dashW);
      tPitch = lerp(tPitch, 0.22 * this.dashZ, this.dashW);
      tRoll = lerp(tRoll, -0.25 * this.dashX, this.dashW);
    }
    if (this.grapW > 0) tPitch = lerp(tPitch, -0.15, this.grapW);
    if (this.airW > 0) tPitch = lerp(tPitch, 0.18, this.airW);
    if (this.climbW > 0) {
      tOff.y = lerp(tOff.y, -0.05, this.climbW);
      tPitch = lerp(tPitch, 0.35, this.climbW);
    }
    if (land > 0) {
      tOff.y -= 0.27 * land;
      tPitch += 0.3 * land;
    }
    if (this.slamW > 0) {
      const kk = smooth(Math.min(1, this.slamW * 3));
      tOff.y = lerp(tOff.y, -0.42, kk);
      tPitch = lerp(tPitch, 0.5, kk);
    }
    // étourdi : vacillement
    if (this.stunW > 0) {
      tOff.x += Math.sin(now * 2.3 + this.seed) * 0.03 * this.stunW;
      tRoll += Math.sin(now * 1.7 + this.seed) * 0.08 * this.stunW;
    }
    const fastP = 1 - Math.exp(-dt * (land > 0.05 ? 34 : 20));
    this.pelvisOff.lerp(tOff, fastP);
    this.pelvisRot.x = lerp(this.pelvisRot.x, tPitch, fastP);
    this.pelvisRot.y = pelvisYaw;
    this.pelvisRot.z = lerp(this.pelvisRot.z, tRoll, fastP);
    // portée des jambes : le bassin descend si un pied posé ne peut être atteint
    const hip = D.hip;
    const legL = this.m(D.thigh + D.shin) * 0.997;
    let py = restY + this.pelvisOff.y;
    for (let i = 0; i < 2; i++) {
      const planted = (this.moveW < 0.5 || this.stance[i] || this.sitW > 0.5) && flying < 0.5;
      if (!planted) continue;
      const f = this.feet[i];
      const hx = this.pelvisOff.x + (i === 0 ? 1 : -1) * this.m(hip[0]);
      const hz = this.pelvisOff.z + this.m(hip[2]);
      const dx = f.pos.x - hx;
      const dz = f.pos.z - hz;
      const reach = Math.sqrt(Math.max(0, legL * legL - dx * dx - dz * dz));
      py = Math.min(py, f.pos.y + reach - this.m(hip[1]));
    }
    // ---------------------------------------------------------------- torse et tête (cibles)
    const tt = this.idleT;
    const breath = Math.sin(tt * 1.6 + (this.seed & 15));
    let tTorso = _v2.set(-0.02 + breath * 0.012 * (1 - this.moveW) + this.moveW * lerp(0.02, 0.12 + speed * 0.01, run) * (dirZ >= 0 ? 1 : -0.5), 0, 0);
    // contre-rotation des épaules
    const counter = Math.cos(TAU * ph) * lerp(0.13, 0.2, run) * this.moveW * (1 - this.aimW * 0.8);
    tTorso.y = counter - pelvisYaw * 0;
    tTorso.z = -pelvisRoll * 0.6;
    const tHead = _v4.set(0, 0, 0);
    // regards de côté au repos
    if (speed < 0.2 && !aiming && special < 0.2) {
      tHead.y = Math.sin(tt * 0.31 + (this.seed % 13)) * 0.45 * (Math.sin(tt * 0.09 + this.seed) > 0.25 ? 1 : 0.25);
      tHead.x = Math.sin(tt * 0.23 + 1.3) * 0.06;
    }
    tHead.y -= counter + pelvisYaw;
    tHead.x -= tTorso.x * 0.6;
    if (this.sitW > 0) {
      tTorso.x = lerp(tTorso.x, 0.16 + this.driveW * 0.08, this.sitW);
      tHead.x = lerp(tHead.x, -0.08, this.sitW);
    }
    if (this.cowerW > 0) {
      tTorso.x = lerp(tTorso.x, 0.55, this.cowerW);
      tHead.x = lerp(tHead.x, 0.45, this.cowerW);
    }
    if (crouch > 0) {
      tTorso.x = lerp(tTorso.x, 0.18 + 0.2 * this.leapW, crouch);
      tHead.x = lerp(tHead.x, -0.35 - 0.2 * this.leapW, crouch);
    }
    if (this.slideW > 0) {
      tTorso.x = lerp(tTorso.x, 0.2, this.slideW);
      tTorso.z = lerp(tTorso.z, -0.1, this.slideW);
      tHead.x = lerp(tHead.x, 0.3, this.slideW);
    }
    if (this.dashW > 0) {
      tTorso.x = lerp(tTorso.x, 0.3 * this.dashZ, this.dashW);
      tTorso.z = lerp(tTorso.z, -0.3 * this.dashX, this.dashW);
      tHead.x = lerp(tHead.x, -0.2, this.dashW);
    }
    if (this.wallW !== 0) {
      // le buste se redresse vers l'intérieur, la tête regarde devant
      tTorso.z = lerp(tTorso.z, 0.18 * this.wallW, Math.abs(this.wallW));
      tHead.z = lerp(tHead.z, -0.25 * this.wallW, Math.abs(this.wallW));
    }
    if (this.grapW > 0) {
      tTorso.x = lerp(tTorso.x, -0.12, this.grapW);
      tHead.x = lerp(tHead.x, -0.3, this.grapW);
    }
    if (this.airW > 0) {
      const tuck = flip >= 0 ? 1 : 0;
      tTorso.x = lerp(tTorso.x, 0.08 + 0.45 * tuck, this.airW);
      tHead.x = lerp(tHead.x, 0.25 * tuck - 0.05, this.airW);
    }
    if (this.climbW > 0) {
      tTorso.x = lerp(tTorso.x, 0.25, this.climbW);
      tHead.x = lerp(tHead.x, -0.4, this.climbW);
    }
    if (this.launchW > 0) {
      tTorso.x = lerp(tTorso.x, -0.1, this.launchW);
      tHead.x = lerp(tHead.x, -0.5, this.launchW);
    }
    if (land > 0) {
      tTorso.x += 0.25 * land;
      tHead.x -= 0.2 * land;
    }
    if (this.slamW > 0) {
      const kk = smooth(Math.min(1, this.slamW * 3));
      tTorso.x = lerp(tTorso.x, 0.55, kk);
      tHead.x = lerp(tHead.x, -0.5, kk);
    }
    // visée : le buste s'oriente (de profil pour les fusils), la tête suit l'inclinaison
    const awSide = this.armWeaponSide(v);
    if (this.aimW > 0 && ranged) {
      // pistolet d'avant-bras : de trois quarts, l'épaule du bras armé en avant
      const blade = w === Weapon.ARM_PISTOL ? (awSide === 1 ? 0.4 : -0.4) : longGun(w) ? -0.5 : w === Weapon.SMG ? -0.22 : s.oneHand ? -0.35 : 0;
      tTorso.y = lerp(tTorso.y, blade, this.aimW);
      tTorso.x = lerp(tTorso.x, -v.pitch * 0.25 + 0.04, this.aimW);
      tHead.y = lerp(tHead.y, -blade - counter * 0.3 + (longGun(w) ? 0.06 : 0), this.aimW);
      tHead.x = lerp(tHead.x, -v.pitch * 0.55 + (longGun(w) ? 0.12 : 0.04), this.aimW);
      tHead.z = lerp(tHead.z, longGun(w) ? -0.12 : 0, this.aimW);
    } else if (this.aimW > 0) {
      // garde (poings, lame, armes de bras : l'épaule du bras armé devant)
      const g = awSide === 1 ? 0.25 : -0.25;
      tTorso.y = lerp(tTorso.y, g, this.aimW);
      tTorso.x = lerp(tTorso.x, 0.1, this.aimW);
      tHead.y = lerp(tHead.y, -g * 0.9, this.aimW);
    }
    // poing hydraulique : coup chargé, l'épaule armée part en arrière
    if (this.chargeW > 0 && awSide >= 0) {
      const sgn = awSide === 1 ? 1 : -1;
      tTorso.y = lerp(tTorso.y, -0.55 * sgn, this.chargeW);
      tTorso.x = lerp(tTorso.x, 0.15, this.chargeW);
      tHead.y = lerp(tHead.y, 0.5 * sgn, this.chargeW);
    }
    if (s.idle === 'phone' && speed < 0.2 && !aiming && w === Weapon.FISTS && this.sitW < 0.5 && special < 0.2) tHead.x = lerp(tHead.x, 0.42, 1 - this.moveW);
    // tir : recul du buste
    const sinceShot = now - v.shotAt;
    if (sinceShot >= 0 && sinceShot < 0.3 && ranged) {
      const kk = Math.exp(-sinceShot * (w === Weapon.SMG ? 30 : 16)) * (w === Weapon.SMG ? 0.4 : longGun(w) ? 1.3 : 0.8);
      tTorso.x -= 0.05 * kk;
      tHead.x -= 0.03 * kk;
    }
    // coups et lancer : rotation du buste
    const sinceMelee = now - v.meleeAt;
    const throwing = ranged && sinceMelee >= 0 && sinceMelee < 0.7;
    const striking = !ranged && sinceMelee >= 0 && sinceMelee < (w === Weapon.ARM_WHIP ? 0.6 : 0.5);
    if (v.meleeAt !== this.lastMelee) {
      this.lastMelee = v.meleeAt;
      this.punchSide ^= 1;
      this.combo++;
    }
    if (throwing) {
      const u = sinceMelee / 0.7;
      tTorso.y += keys([[0, 0], [0.3, -0.55], [0.55, 0.45], [1, 0]], u);
      tTorso.x += keys([[0, 0], [0.3, -0.12], [0.55, 0.22], [1, 0]], u);
      tHead.y -= keys([[0, 0], [0.3, -0.45], [0.55, 0.3], [1, 0]], u);
    } else if (striking) {
      const u = sinceMelee / 0.5;
      const sgnA = awSide === 1 ? 1 : -1;
      if (w === Weapon.FISTS) {
        const sgn = this.punchSide ? 1 : -1;
        tTorso.y += sgn * keys([[0, 0], [0.25, 0.45], [0.6, 0.3], [1, 0]], u);
      } else if (w === Weapon.ARM_FIST) {
        // direct hydraulique : toute la rotation du buste derrière le poing
        tTorso.y += sgnA * keys([[0, -0.2], [0.18, 0.75], [0.55, 0.55], [1, 0]], u);
        tTorso.x += keys([[0, 0], [0.18, 0.18], [1, 0]], u);
      } else if (w === Weapon.ARM_WHIP) {
        const uu = sinceMelee / 0.6;
        tTorso.y += sgnA * keys([[0, 0], [0.2, -0.45], [0.55, 0.65], [1, 0]], uu);
      } else if (w === Weapon.ARM_BLADE) {
        const c = this.combo % 3;
        const amp = c === 1 ? -0.55 : 0.5;
        tTorso.y += sgnA * keys([[0, 0], [0.25, -amp], [0.55, amp], [1, 0]], u);
        tTorso.x += keys([[0, 0], [0.25, c === 2 ? -0.1 : -0.05], [0.55, c === 2 ? -0.05 : 0.22], [1, 0]], u);
      } else {
        tTorso.y += keys([[0, 0], [0.25, -0.45], [0.55, 0.45], [1, 0]], u);
        tTorso.x += keys([[0, 0], [0.25, -0.1], [0.55, 0.25], [1, 0]], u);
      }
    }
    // capacités : petites rotations du buste
    if (ab && sinceAb >= 0 && sinceAb < 0.8) {
      const u = sinceAb;
      const i = ab.side === 'L' ? 0 : ab.side === 'R' ? 1 : this.sideOf(ab.kind);
      const sgn = i === 1 ? 1 : -1;
      if (ab.kind === 'repulseur' || ab.kind === 'choc') {
        tTorso.y += sgn * keys([[0, 0], [0.1, 0.35], [0.5, 0.3], [0.8, 0]], u);
        tTorso.x += keys([[0, 0], [0.1, -0.08], [0.3, 0.04], [0.8, 0]], u);
      } else if (ab.kind === 'lame' || ab.kind === 'poing') {
        tTorso.x += keys([[0, 0], [0.12, 0.3], [0.5, 0.2], [0.8, 0]], u);
        tTorso.y += sgn * keys([[0, 0], [0.12, 0.5], [0.8, 0]], u);
      }
    }
    // électrocuté : convulsions
    if (this.shockW > 0) {
      const j = this.shockW;
      tTorso.x += (Math.sin(now * 53 + this.seed) * 0.05 - 0.08) * j;
      tTorso.z += Math.sin(now * 47) * 0.05 * j;
      tHead.x += Math.sin(now * 61) * 0.08 * j;
    }
    // impact : sursaut
    const sinceHit = now - v.hitAt;
    if (sinceHit >= 0 && sinceHit < 0.5 && !dead) {
      const kk = Math.exp(-sinceHit * 8) * Math.sin(Math.min(1, sinceHit * 14) * HALF_PI);
      const sg = this.seed & 1 ? 1 : -1;
      tTorso.x -= 0.3 * kk;
      tTorso.z += 0.18 * kk * sg;
      tTorso.y += 0.15 * kk * sg;
      tHead.x -= 0.35 * kk;
      tHead.z -= 0.2 * kk * sg;
    }
    const fastT = 1 - Math.exp(-dt * (aiming || striking || throwing || special > 0.2 ? 22 : 12));
    this.torsoRot.lerp(tTorso, fastT);
    this.headRot.lerp(tHead, fastT);

    // ---------------------------------------------------------------- inclinaison du corps entier
    // course murale (à l'opposé du mur), grappin (vers le crochet), bond, salto du double saut
    const tilt = _v5.set(0, 0, 0);
    tilt.z = 0.38 * this.wallW;
    if (this.grapW > 0) {
      const el = this.anchorElevation(v);
      tilt.x += (HALF_PI - el) * 0.55 * this.grapW;
    }
    tilt.x += 0.55 * this.launchW;
    this.rootTilt.lerp(tilt, 1 - Math.exp(-dt * 10));
    const flipAng = flip >= 0 && this.airW > 0.3 ? TAU * smooth(flip) : 0;

    // ---------------------------------------------------------------- mort : chute
    let fall = 0;
    let crumple = 0;
    if (dead) {
      const tD = Math.max(0, now - v.deathAt);
      // les genoux cèdent, puis le corps bascule (accélération), rebond, immobile
      crumple = keys([[0, 0], [0.12, 0.08], [0.4, 0.3], [0.62, 0.12], [0.9, 0]], tD);
      const u = clamp((tD - 0.18) / 0.5, 0, 1);
      fall = Math.min(1, u * u * (1.2 - 0.2 * u));
      if (tD > 0.68) fall = 1 - Math.sin(Math.min(1, (tD - 0.68) / 0.25) * PI) * 0.05;
      py = restY - crumple * 0.55 - 0.02;
      this.torsoRot.set(keys([[0, 0], [0.15, -0.3], [0.5, this.fallDir < 0 ? -0.15 : 0.35], [1, this.fallDir < 0 ? -0.05 : 0.1]], tD), keys([[0, 0], [0.3, 0.25], [1, 0.15]], tD) * (this.seed & 2 ? 1 : -1), 0.12 * (this.seed & 4 ? 1 : -1) * Math.min(1, tD));
      this.headRot.set(keys([[0, 0], [0.15, -0.4], [0.8, this.fallDir < 0 ? -0.2 : 0.2]], tD), keys([[0, 0], [0.9, 0.7]], tD) * (this.seed & 8 ? 1 : -1), 0);
      this.pelvisRot.set(0, 0, 0);
      this.pelvisOff.x = 0;
      this.rootTilt.set(0, 0, 0);
      for (let i = 0; i < 2; i++) {
        const f = this.feet[i];
        f.pos.set((i === 0 ? 1 : -1) * (0.1 + 0.05 * fall + (i === (this.seed & 1) ? 0.04 : 0)), ankleH, i === (this.seed & 1) ? 0.08 * fall : 0);
        f.pitch = -0.3 * fall;
        f.yaw = (i === 0 ? 1 : -1) * (0.15 + 0.35 * fall);
      }
    }
    this.lying = dead && fall > 0.5;

    // ---------------------------------------------------------------- repères du corps
    const root = this.body;
    root.makeTranslation(v.x, v.y, v.z);
    root.multiply(_m1.makeRotationY(this.yaw));
    if (this.rootTilt.lengthSq() > 1e-6 || flipAng !== 0) {
      // roulis autour des pieds (course murale), tangage autour du bassin (grappin, bond, salto)
      if (Math.abs(this.rootTilt.z) > 1e-4) root.multiply(_m1.makeRotationZ(this.rootTilt.z));
      const piv = restY * sc;
      root.multiply(_m1.makeTranslation(0, piv, 0));
      root.multiply(_m1.makeRotationX(this.rootTilt.x + flipAng));
      root.multiply(_m1.makeTranslation(0, -piv, 0));
    }
    if (fall > 0) {
      // bascule autour des chevilles (en arrière ou en avant), corps posé à plat au sol
      const ang = this.fallDir * HALF_PI * 0.97 * fall;
      root.multiply(_m1.makeTranslation(0, ankleH * sc, 0));
      root.multiply(_m1.makeRotationX(ang));
      root.multiply(_m1.makeTranslation(0, -ankleH * sc + (this.fallDir < 0 ? 0.12 : 0.14) * fall * sc * 0.9, 0));
    }
    root.multiply(_m1.makeScale(sc, sc, sc));
    // bassin
    qEuler(this.pelvisRot.x, this.pelvisRot.y, this.pelvisRot.z, 'YXZ', _q1);
    this.pelvisM.compose(_v1.set(this.pelvisOff.x, py, this.pelvisOff.z), _q1, _one);
    // torse (respiration : la cage thoracique se dilate un peu)
    qEuler(this.torsoRot.x, this.torsoRot.y, this.torsoRot.z, 'YXZ', _q2);
    _m1.compose(_v2.set(0, 0, 0), _q2, _one);
    this.torsoM.multiplyMatrices(this.pelvisM, _m1);
    this.torsoInv.copy(this.torsoM).invert();
    const chest = 1 + breath * 0.008 * (1 - this.moveW);
    this.mats[PART.PELVIS].multiplyMatrices(root, this.pelvisM);
    _m1.makeScale(1, 1, chest);
    this.mats[PART.TORSO].multiplyMatrices(root, this.torsoM).multiply(_m1);
    // tête
    qEuler(this.headRot.x, this.headRot.y, this.headRot.z, 'YXZ', _q1);
    _m1.compose(_v1.set(this.m(D.neck[0]), this.m(D.neck[1]), this.m(D.neck[2])), _q1, _one);
    _m2.multiplyMatrices(this.torsoM, _m1);
    // tête un peu plus grande que nature : visages lisibles à distance de jeu
    _m2.multiply(_m1.makeScale(HEAD_K, HEAD_K, HEAD_K));
    this.mats[PART.HEAD].multiplyMatrices(root, _m2);
    this.headPos.set(0, this.m(5), 0).applyMatrix4(this.mats[PART.HEAD]);

    // ---------------------------------------------------------------- jambes (cinématique inverse)
    for (let i = 0; i < 2; i++) {
      const sideX = i === 0 ? 1 : -1;
      const f = this.feet[i];
      const H = _v1.set(sideX * this.m(hip[0]), this.m(hip[1]), this.m(hip[2])).applyMatrix4(this.pelvisM);
      const Af = f.pos;
      // genou vers l'avant (et un peu vers l'extérieur), dans la direction du pied
      const pole = _v2.set(Math.sin(f.yaw) + sideX * 0.08, 0.05, Math.cos(f.yaw));
      if (this.sitW > 0.5 || this.cowerW > 0.5) pole.y += 0.6;
      if (crouch > 0.3 || this.airW > 0.3 || this.climbW > 0.3) pole.y += 0.4;
      // glissade : le genou de la jambe repliée part sur le côté
      if (this.slideW > 0.3 && i === 1) pole.set(-0.9, 0.6, 0.3);
      if (this.slamW > 0.3 && i === 1) pole.set(-0.1, -0.2, 1);
      this.legIK(H, Af, pole, this.m(D.thigh), this.m(D.shin), i);
      // pied
      qEuler(-f.pitch, f.yaw, 0, 'YXZ', _q1);
      _m1.compose(Af, _q1, _one);
      this.mats[PART.FOOT_L + i].multiplyMatrices(root, _m1);
    }

    // ---------------------------------------------------------------- pans et jupes
    for (let i = 0; i < 2; i++) {
      const sideX = i === 0 ? 1 : -1;
      // le pan suit (en partie) l'inclinaison de la cuisse
      const thighPitch = this.thighPitch[i];
      const target = clamp(thighPitch * 0.55, -0.7, 0.45) + this.moveW * run * 0.25 + this.sitW * 0.2 + flying * 0.35 + this.dashW * 0.3;
      this.tails[i] = lerp(this.tails[i], target, 1 - Math.exp(-dt * 14));
      _m1.compose(_v1.set(sideX * this.m(hip[0]), this.m(hip[1]), this.m(hip[2])), qEuler(this.tails[i], 0, sideX * (0.04 + this.sitW * 0.25), 'XYZ', _q1), _one);
      this.mats[PART.TAIL_L + i].multiplyMatrices(root, this.pelvisM).multiply(_m1);
      _m1.compose(_v1.set(sideX * this.m(hip[0]), this.m(hip[1]), this.m(hip[2])), qEuler(this.tails[i] * 0.55, 0, sideX * this.sitW * 0.2, 'XYZ', _q1), _one);
      this.mats[PART.SKIRT_L + i].multiplyMatrices(root, this.pelvisM).multiply(_m1);
    }

    // ---------------------------------------------------------------- bras
    this.armTargets(v, s, now, dt, dead, aiming, sinceShot, sinceMelee, throwing, striking);
    const gesture = this.cy && ab && sinceAb >= 0 && sinceAb < (GESTURE[ab.kind] ?? 0);
    const armRate = aiming || striking || throwing || gesture || this.chargeW > 0.1 || (sinceShot >= 0 && sinceShot < 0.3) ? 24 : dead ? 7 : special > 0.2 ? 16 : 11;
    const fa = 1 - Math.exp(-dt * armRate);
    for (let i = 0; i < 2; i++) this.arms[i].toward(this.armT[i], fa);
    for (let i = 0; i < 2; i++) {
      const sideX = i === 0 ? 1 : -1;
      const a = this.arms[i];
      _m1.compose(_v1.set(sideX * this.m(D.shoulder[0]), this.m(D.shoulder[1]), this.m(D.shoulder[2])), a.sh, _one);
      _m2.multiplyMatrices(this.torsoM, _m1);
      this.mats[PART.UARM_L + i].multiplyMatrices(root, _m2);
      // coude
      _q1.setFromAxisAngle(X_AXIS, -a.el);
      _q2.setFromAxisAngle(Y_AXIS, a.tw * sideX);
      _q1.multiply(_q2);
      _m1.compose(_v1.set(0, -this.m(D.upper), 0), _q1, _one);
      _m2.multiply(_m1);
      this.mats[PART.FARM_L + i].multiplyMatrices(root, _m2);
      // poignet
      _m1.compose(_v1.set(0, -this.m(D.fore), 0), a.wr, _one);
      _m2.multiply(_m1);
      this.mats[PART.HAND_L + i].multiplyMatrices(root, _m2);
      this.wrists[i].setFromMatrixPosition(this.mats[PART.HAND_L + i]);
    }
    // ---------------------------------------------------------------- arme (main droite)
    const held = this.held;
    if (held) {
      const g = GRIP[s.build];
      const wm = this.mats[PART.WEAPON];
      if (held === 'phone') {
        _q1.setFromAxisAngle(X_AXIS, HALF_PI).multiply(_q2.setFromAxisAngle(Y_AXIS, 0.4));
        _m1.compose(_v1.set(this.m(-g[0] - 0.6), this.m(g[1] + 1), this.m(0)), _q1, _one);
      } else {
        _q1.setFromAxisAngle(X_AXIS, HALF_PI);
        _m1.compose(_v1.set(this.m(-g[0]), this.m(g[1]), 0), _q1, _one);
      }
      wm.multiplyMatrices(this.mats[PART.HAND_R], _m1);
      const mz = WEAPON_META[held].muzzle;
      this.muzzle.set(this.m(mz[0]), this.m(mz[1]), this.m(mz[2])).applyMatrix4(wm);
    } else {
      this.muzzle.set(0, this.m(g0y), this.m(1)).applyMatrix4(this.mats[PART.HAND_R]);
    }
    // ---------------------------------------------------------------- implants des bras
    this.updateCyber(v, now, dt, striking, sinceMelee, sinceShot, awSide);
    void k;
  }

  /** Site (rad) du point d'ancrage du grappin vu du personnage (ou du regard). */
  private anchorElevation(v: CharView): number {
    const ab = v.ab;
    if (ab && (ab.kind === 'grappin' || ab.kind === 'treuil') && ab.x !== undefined && ab.y !== undefined && ab.z !== undefined) {
      const dx = ab.x - v.x;
      const dy = ab.y - (v.y + 1.4);
      const dz = ab.z! - v.z;
      return Math.atan2(dy, Math.hypot(dx, dz));
    }
    return clamp(v.pitch, -0.3, 1.4);
  }

  /** Inclinaison avant des cuisses (pour les pans de manteau). */
  private thighPitch = [0, 0];

  /** Cinématique inverse d'une jambe : cuisse, jambe (repère du corps) → matrices monde. */
  private legIK(H: THREE.Vector3, A: THREE.Vector3, pole: THREE.Vector3, Lt: number, Ls: number, i: number): void {
    const d = _v3.subVectors(A, H);
    let dist = d.length();
    const maxD = (Lt + Ls) * 0.9995;
    if (dist > maxD) dist = maxD;
    if (dist < 0.05) dist = 0.05;
    const u = d.normalize();
    const cosA = clamp((Lt * Lt + dist * dist - Ls * Ls) / (2 * Lt * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const wv = _v4.copy(pole).addScaledVector(u, -pole.dot(u));
    if (wv.lengthSq() < 1e-8) wv.set(0, 0, 1);
    wv.normalize();
    const K = new THREE.Vector3().copy(H).addScaledVector(u, Lt * cosA).addScaledVector(wv, Lt * sinA);
    const Af = new THREE.Vector3().copy(H).addScaledVector(u, dist);
    // cuisse : +Y vers la hanche, +Z vers l'avant du genou
    const y = new THREE.Vector3().subVectors(H, K).normalize();
    const z = new THREE.Vector3().copy(pole).addScaledVector(y, -pole.dot(y));
    if (z.lengthSq() < 1e-8) z.set(0, 0, 1);
    z.normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    qBasis(x, y, z, _q1);
    _m1.compose(H, _q1, _one);
    this.mats[PART.THIGH_L + i].multiplyMatrices(this.body, _m1);
    this.thighPitch[i] = Math.atan2(-y.z, y.y) * -1;
    // jambe
    y.subVectors(K, Af).normalize();
    z.copy(pole).addScaledVector(y, -pole.dot(y));
    if (z.lengthSq() < 1e-8) z.set(0, 0, 1);
    z.normalize();
    x.crossVectors(y, z);
    qBasis(x, y, z, _q1);
    _m1.compose(K, _q1, _one);
    this.mats[PART.SHIN_L + i].multiplyMatrices(this.body, _m1);
  }

  // ------------------------------------------------------------------ bras : cibles

  /** Pose cible d'un bras en angles (épaule ZXY : roulis, tangage, torsion). */
  private fk(i: number, pitch: number, roll: number, yaw: number, el: number, wp = 0, wy = 0, wz = 0): void {
    const sideX = i === 0 ? 1 : -1;
    const a = this.armT[i];
    qEuler(pitch, yaw * sideX, roll * sideX, 'ZXY', a.sh);
    a.el = el;
    a.tw = 0;
    qEuler(wp, wy * sideX, wz * sideX, 'XYZ', a.wr);
  }

  /**
   * Cinématique inverse d'un bras dans le repère du torse : poignet en W, coude tiré vers
   * `pole`, main orientée selon hq (repère du torse) si donnée.
   */
  private ik(i: number, W: THREE.Vector3, pole: THREE.Vector3, hqIn: THREE.Quaternion | null): void {
    // copie : l'appelant passe souvent un quaternion de travail (_q1.._q3) réutilisé plus bas
    const hq = hqIn ? _qk.copy(hqIn) : null;
    const D = this.D;
    const sideX = i === 0 ? 1 : -1;
    const a = this.armT[i];
    const S = new THREE.Vector3(sideX * this.m(D.shoulder[0]), this.m(D.shoulder[1]), this.m(D.shoulder[2]));
    const Lu = this.m(D.upper);
    const Lf = this.m(D.fore);
    const d = new THREE.Vector3().subVectors(W, S);
    let dist = d.length();
    dist = clamp(dist, Math.abs(Lu - Lf) + 0.02, (Lu + Lf) * 0.999);
    const u = d.normalize();
    const cosA = clamp((Lu * Lu + dist * dist - Lf * Lf) / (2 * Lu * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const wv = new THREE.Vector3().copy(pole).addScaledVector(u, -pole.dot(u));
    if (wv.lengthSq() < 1e-8) wv.set(0, -1, 0);
    wv.normalize();
    const E = new THREE.Vector3().copy(S).addScaledVector(u, Lu * cosA).addScaledVector(wv, Lu * sinA);
    const Wr = new THREE.Vector3().copy(S).addScaledVector(u, dist);
    const y = new THREE.Vector3().subVectors(S, E).normalize();
    const fdir = new THREE.Vector3().subVectors(Wr, E).normalize();
    const z = new THREE.Vector3().copy(fdir).addScaledVector(y, -fdir.dot(y));
    if (z.lengthSq() < 1e-6) z.copy(wv).negate().addScaledVector(y, wv.dot(y));
    z.normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    qBasis(x, y, z, a.sh);
    // flexion du coude : l'avant-bras pointe vers (0, −cos θ, sin θ) dans le repère du bras
    a.el = Math.atan2(fdir.dot(z), -fdir.dot(y));
    a.tw = 0;
    if (hq) {
      // poignet : rotation restante, dont la torsion passe en partie dans l'avant-bras
      const qf = _q1.copy(a.sh).multiply(_q2.setFromAxisAngle(X_AXIS, -a.el));
      const wr = _q3.copy(qf).invert().multiply(hq);
      const tw = 2 * Math.atan2(wr.y, wr.w);
      const twk = clamp(tw, -1.6, 1.6) * 0.6;
      a.tw = twk * sideX;
      _q2.setFromAxisAngle(Y_AXIS, -twk);
      a.wr.copy(_q2).multiply(wr);
    } else a.wr.identity();
  }

  /** Main d'appui : matrice main = arme ∘ T(point) ∘ rotation ∘ T(−prise). */
  private handFromWeapon(wm: THREE.Matrix4, pt: [number, number, number], rot: THREE.Quaternion, i: number, out: THREE.Matrix4): THREE.Matrix4 {
    const g = GRIP[this.D === DIMS.f ? 'f' : 'm'];
    const gx = i === 0 ? g[0] : -g[0];
    _m1.compose(_v1.set(this.m(pt[0]), this.m(pt[1]), this.m(pt[2])), rot, _one);
    _m2.makeTranslation(-this.m(gx), -this.m(g[1]), 0);
    return out.multiplyMatrices(wm, _m1).multiply(_m2);
  }

  /** Place un bras (IK) sur une main donnée en repère du corps. */
  private ikToHand(i: number, handBody: THREE.Matrix4, pole: THREE.Vector3): void {
    _m1.multiplyMatrices(this.torsoInv, handBody);
    const W = new THREE.Vector3().setFromMatrixPosition(_m1);
    const hq = new THREE.Quaternion().setFromRotationMatrix(_m1);
    this.ik(i, W, pole, hq);
  }

  /** Direction de visée (repère du torse) d'après le lacet et le site de la vue. */
  private aimDir(v: CharView, out: THREE.Vector3, pitchAdd = 0): THREE.Vector3 {
    const p = clamp(v.pitch + pitchAdd, -1.2, 1.3);
    const dy = angleDiff(this.yaw, v.yaw);
    out.set(Math.sin(dy) * Math.cos(p), Math.sin(p), Math.cos(dy) * Math.cos(p));
    _q3.setFromRotationMatrix(this.torsoInv);
    return out.applyQuaternion(_q3).normalize();
  }

  /** Direction (repère du torse) de l'épaule d'un bras vers un point du monde. */
  private dirToPoint(v: CharView, i: number, wx: number, wy: number, wz: number, out: THREE.Vector3): THREE.Vector3 {
    const sc = this.sc;
    const dx = wx - v.x;
    const dy = wy - v.y;
    const dz = wz - v.z;
    const c = Math.cos(-this.yaw);
    const s = Math.sin(-this.yaw);
    out.set((dx * c + dz * s) / sc, dy / sc, (-dx * s + dz * c) / sc).applyMatrix4(this.torsoInv);
    const D = this.D;
    out.x -= (i === 0 ? 1 : -1) * this.m(D.shoulder[0]);
    out.y -= this.m(D.shoulder[1]);
    out.z -= this.m(D.shoulder[2]);
    return out.normalize();
  }

  /**
   * Bras tendu dans une direction (repère du torse) : poing serré pouce en haut (pistolet
   * d'avant-bras, lanceur), ou main ouverte paume vers l'avant / vers le bas.
   */
  private armToward(i: number, dir: THREE.Vector3, reach = 0.96, palm: 'medial' | 'forward' | 'down' = 'medial'): void {
    const D = this.D;
    const sx = i === 0 ? 1 : -1;
    const S = _v6.set(sx * this.m(D.shoulder[0]), this.m(D.shoulder[1]), this.m(D.shoulder[2]));
    const L = this.m(D.upper + D.fore) * reach;
    const W = new THREE.Vector3().copy(S).addScaledVector(dir, L);
    const up = Math.abs(dir.y) > 0.92 ? _v3.set(0, 0, 1) : _v3.set(0, 1, 0);
    const pole = new THREE.Vector3(sx * 0.7, -1, -0.4);
    if (palm === 'forward') {
      // main dressée, doigts vers le haut, paume face à la direction
      const fingers = new THREE.Vector3().copy(up).addScaledVector(dir, -up.dot(dir)).normalize();
      this.ik(i, W, pole, handQ(i, fingers.x, fingers.y, fingers.z, dir.x, dir.y, dir.z));
      return;
    }
    if (palm === 'down') {
      const pn = new THREE.Vector3(0, -1, 0).addScaledVector(dir, dir.y).normalize();
      this.ik(i, W, pole, handQ(i, dir.x, dir.y, dir.z, pn.x, pn.y, pn.z));
      return;
    }
    const pn = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(sx);
    this.ik(i, W, pole, handQ(i, dir.x, dir.y, dir.z, pn.x, pn.y, pn.z));
  }

  private armTargets(v: CharView, s: CharStyle, now: number, dt: number, dead: boolean, aiming: boolean, sinceShot: number, sinceMelee: number, throwing: boolean, striking: boolean): void {
    this.baseArmTargets(v, s, now, dt, dead, aiming, sinceShot, sinceMelee, throwing, striking);
    if (dead || this.sitW > 0.5 || this.cowerW > 0.5) return;
    this.moveArmTargets(v, s, now, aiming, striking);
    this.cyberArmTargets(v, now, aiming, sinceShot, sinceMelee, striking);
  }

  /** Bras pendant les déplacements augmentés (sauf le bras qui vise ou frappe). */
  private moveArmTargets(v: CharView, s: CharStyle, now: number, aiming: boolean, striking: boolean): void {
    const D = this.D;
    const shY = this.m(D.shoulder[1]);
    const w = v.weapon;
    const busyR = (aiming && !melee(w)) || striking || (twoHanded(w) && !!this.held);
    const busyL = (aiming && !melee(w) && (twoHanded(w) || (w === Weapon.PISTOL && !s.oneHand))) || (striking && w === Weapon.FISTS) || (twoHanded(w) && !!this.held);
    const tA = now - this.animAt;
    const freeArm = (i: number) => (i === 1 ? !busyR : !busyL);
    // glissade : la main gauche traîne au sol derrière, la droite en avant pour l'équilibre
    if (this.slideW > 0.4) {
      if (freeArm(0)) {
        this.ik(0, _v1.set(0.3, shY - 0.62, -0.12), _v2.set(1, 0, -0.5), handQ(0, 0.1, -0.3, -0.95, 0, -1, 0));
        this.hands[0] = 'flat';
      }
      if (freeArm(1) && !this.held) this.fk(1, -0.75, 0.25, 0.1, 0.9);
    }
    // esquive : bras balayés en arrière
    if (this.dashW > 0.4) {
      for (const i of [0, 1]) if (freeArm(i)) this.fk(i, 0.85, 0.35, 0, 0.35);
    }
    // course murale : main proche du mur posée sur la paroi
    if (Math.abs(this.wallW) > 0.4) {
      const i = this.wallW > 0 ? 0 : 1;
      if (freeArm(i) && !(i === 1 && this.held)) {
        const sx = i === 0 ? 1 : -1;
        this.ik(i, _v1.set(sx * 0.62, shY + 0.05, 0.12), _v2.set(sx * 0.2, -1, -0.6), handQ(i, sx * 0.2, 0.95, 0.1, sx, 0, 0));
        this.hands[i] = 'flat';
      }
    }
    // en l'air : bras écartés pour l'équilibre (salto : bras serrés sur les genoux)
    if (this.airW > 0.4) {
      const flipping = this.flipT < 0.6;
      for (const i of [0, 1]) {
        if (!freeArm(i)) continue;
        if (flipping) this.fk(i, -0.9, 0.15, 0, 1.6);
        else this.fk(i, -0.35 - 0.1 * Math.sin(now * 3 + i), 0.7, 0.1, 0.55);
      }
    }
    // escalade : les deux mains sur le rebord, on se hisse (l'arme est rangée)
    if (this.climbW > 0.4) {
      const u = clamp(tA / 0.75, 0, 1);
      const hy = lerp(shY + 0.42, shY - 0.3, smooth(u));
      for (const i of [0, 1]) {
        const sx = i === 0 ? 1 : -1;
        this.ik(i, _v1.set(sx * 0.2, hy, 0.34), _v2.set(sx, -0.6, -0.4), handQ(i, 0, 0.3, 1, 0, -1, 0.2));
        this.hands[i] = 'flat';
      }
      this.held = null;
    }
    // bond chargé : bras lancés en arrière ; projeté : bras le long du corps
    if (this.leapW > 0.4) for (const i of [0, 1]) if (freeArm(i)) this.fk(i, 0.7, 0.2, 0, 0.45);
    if (this.launchW > 0.4) for (const i of [0, 1]) if (freeArm(i)) this.fk(i, 1.0, 0.18, 0, 0.15);
    // réception : bras qui s'écartent un instant
    if (this.landT < 0.4 && this.landK > 0) {
      const k = Math.sin((this.landT / 0.4) * PI) * this.landK;
      for (const i of [0, 1]) if (freeArm(i) && this.slamW <= 0) this.fk(i, -0.35 * k, 0.15 + 0.5 * k, 0, 0.4 + 0.3 * k);
    }
    // réception sismique : le poing droit frappe le sol
    if (this.slamW > 0) {
      const kk = smooth(Math.min(1, this.slamW * 3));
      if (kk > 0.3) {
        const i = this.sideOf('poing', 'R');
        const sx = i === 0 ? 1 : -1;
        this.ik(i, _v1.set(sx * 0.12, shY - 0.9, 0.35), _v2.set(sx, 0, -0.5), handQ(i, 0, -1, 0.1, -sx, 0, 0));
        this.hands[i] = 'fist';
        this.fk(1 - i, -0.2, 0.9, 0, 0.6);
        if (i === 1) this.held = null;
      }
    }
    // étourdi : bras ballants
    if (this.stunW > 0.5) for (const i of [0, 1]) if (freeArm(i)) this.fk(i, 0.05 + 0.08 * Math.sin(now * 2 + i * 2), 0.12, 0, 0.15);
  }

  /** Armes de bras et capacités des implants de bras. */
  private cyberArmTargets(v: CharView, now: number, aiming: boolean, sinceShot: number, sinceMelee: number, striking: boolean): void {
    const spec = this.cy;
    if (!spec) return;
    const fx = v.fx ?? 0;
    const w = v.weapon;
    const D = this.D;
    const shY = this.m(D.shoulder[1]);
    const awSide = this.armWeaponSide(v);
    // ------------------------------------------------- armes de bras
    if (awSide >= 0) {
      const i = awSide;
      const o = 1 - i;
      const sx = i === 0 ? 1 : -1;
      if (w === Weapon.ARM_PISTOL) {
        if (aiming || (sinceShot >= 0 && sinceShot < 0.5)) {
          // bras tendu vers la cible, poing serré, recul du poignet au tir
          let kick = 0;
          if (sinceShot >= 0 && sinceShot < 0.3) kick = Math.exp(-sinceShot * 16);
          this.armToward(i, this.aimDir(v, _v4, kick * 0.12), 0.95);
          this.hands[i] = 'fist';
          // l'autre bras : main sur l'avant-bras armé (stabilise) si libre
          if (!this.held) this.fk(o, -0.3, 0.18, 0, 0.75);
        } else {
          // canon sorti, avant-bras relevé, prêt
          this.fk(i, -0.32, 0.14, 0.1, 1.15, -0.25);
          this.hands[i] = 'fist';
        }
        if (i === 1) this.held = null;
      } else if (w === Weapon.ARM_BLADE) {
        if (striking) {
          // trois tailles enchaînées : diagonale, revers horizontal, remontante
          const u = sinceMelee / 0.5;
          const c = this.combo % 3;
          if (c === 0) {
            const p = keys([[0, -1.3], [0.22, -2.5], [0.48, -0.55], [1, -0.9]], u);
            const e = keys([[0, 1.5], [0.22, 1.6], [0.48, 0.35], [1, 1.3]], u);
            const rl = keys([[0, 0.3], [0.22, 0.75], [0.48, -0.35], [1, 0.2]], u);
            this.fk(i, p, rl, keys([[0, 0], [0.22, -0.6], [0.48, 0.55], [1, 0]], u), e, -0.3);
          } else if (c === 1) {
            const yw = keys([[0, 0.8], [0.25, 1.1], [0.55, -0.9], [1, 0.2]], u);
            this.fk(i, keys([[0, -1.3], [0.55, -1.45], [1, -1.0]], u), keys([[0, -0.2], [0.25, -0.3], [0.55, 0.6], [1, 0.2]], u), yw, keys([[0, 1.7], [0.25, 1.4], [0.55, 0.3], [1, 1.4]], u), -0.2);
          } else {
            const p = keys([[0, -0.6], [0.2, -0.3], [0.5, -2.6], [1, -1.0]], u);
            this.fk(i, p, keys([[0, 0.25], [0.5, 0.1], [1, 0.2]], u), keys([[0, 0.3], [0.5, -0.3], [1, 0]], u), keys([[0, 1.8], [0.2, 1.9], [0.5, 0.4], [1, 1.3]], u), -0.3);
          }
        } else {
          // garde : avant-bras à l'horizontale, lame pointée devant soi, l'autre main en garde
          this.fk(i, -0.6 - 0.2 * this.aimW, 0.3, 0.3, 1.05 + 0.15 * this.aimW, -0.25);
          if (!this.held) this.fk(o, -0.8, 0.25, 0, 1.9);
          this.hands[o] = 'fist';
        }
        this.hands[i] = 'fist';
        if (i === 1) this.held = null;
      } else if (w === Weapon.ARM_FIST) {
        if (striking) {
          const u = sinceMelee / 0.5;
          const ext = keys([[0, 0], [0.1, 0.25], [0.22, 1], [0.5, 0.92], [1, 0]], u);
          this.fk(i, lerp(-1.0, -1.55, ext), lerp(0.25, -0.06, ext), 0, lerp(2.0, 0.05, ext));
          this.fk(o, -1.0, 0.3, 0, 1.95);
        } else if (this.chargeW > 0.05) {
          // coup chargé : poing ramené en arrière, coude haut, vérins armés
          const c = this.chargeW;
          this.fk(i, lerp(-1.05, 0.45, c), lerp(0.25, 0.55, c), lerp(0, 0.35, c), lerp(1.95, 2.25, c), 0.2 * c);
          this.fk(o, -1.15, 0.35, -0.2, 1.7);
        } else {
          // garde lourde
          this.fk(i, -1.05 - 0.2 * this.aimW, 0.25, 0, 1.95);
          this.fk(o, -0.9, 0.25, 0, 2.0);
        }
        this.hands[i] = this.hands[o] = 'fist';
        this.held = null;
      } else if (w === Weapon.ARM_WHIP) {
        if (striking) {
          // balayage : armé dehors et en arrière, le bras traverse devant soi
          const u = sinceMelee / 0.6;
          const yw = keys([[0, 1.0], [0.22, 1.3], [0.55, -1.0], [1, -0.3]], u);
          const p = keys([[0, -1.1], [0.22, -1.25], [0.55, -1.35], [1, -0.8]], u);
          this.fk(i, p, keys([[0, 0.5], [0.22, 0.65], [0.55, 0.15], [1, 0.25]], u), yw, keys([[0, 0.9], [0.22, 0.5], [0.55, 0.1], [1, 0.5]], u), 0, 0, -0.3);
          this.hands[i] = 'flat';
        } else {
          this.fk(i, -0.55 - 0.25 * this.aimW, 0.3, 0.15, 0.9, -0.2);
          this.hands[i] = 'relax';
        }
        if (i === 1) this.held = null;
      }
    }
    // ------------------------------------------------- capacités
    const ab = v.ab;
    const sinceAb = ab ? now - ab.at : 99;
    // bouclier levé : avant-bras en travers devant le visage, émetteur vers l'avant
    if (fx & CFX.SHIELD) {
      const i = this.sideOf('bouclier');
      if (i >= 0) {
        const sx = i === 0 ? 1 : -1;
        this.ik(i, _v1.set(-sx * 0.04, shY + 0.06, 0.36), _v2.set(sx * 1.2, -0.3, 0.2), handQ(i, -sx, 0.15, 0.1, 0, 0, -1));
        this.hands[i] = 'fist';
        if (i === 1) this.held = null;
      }
    }
    // grappin : bras tendu vers le crochet
    if (fx & CFX.GRAPPLE || v.anim === Anim.GRAPPLE || (ab && ab.kind === 'grappin' && sinceAb < 0.35)) {
      const i = this.sideOf('grappin', ab?.side) >= 0 ? this.sideOf('grappin', ab?.side) : 0;
      if (armImplant(spec, i) === 'grappin' || this.sideOf('grappin') < 0) {
        const dir = ab && (ab.kind === 'grappin' || ab.kind === 'treuil') && ab.x !== undefined ? this.dirToPoint(v, i, ab.x!, ab.y!, ab.z!, _v4) : this.aimDir(v, _v4, 0.15);
        this.armToward(i, dir, 0.97);
        this.hands[i] = 'fist';
        if (i === 1) this.held = null;
      }
    }
    if (!ab || sinceAb < 0) return;
    const dur = GESTURE[ab.kind];
    if (!dur || sinceAb > dur) return;
    const pref = ab.side;
    switch (ab.kind) {
      case 'repulseur': {
        // poussée de la paume
        const i = this.sideOf('repulseur', pref);
        const u = sinceAb / dur;
        const ext = keys([[0, 0.15], [0.14, 1], [0.45, 0.95], [1, 0]], u);
        const dir = this.aimDir(v, _v4, -0.05);
        this.armToward(i, dir, lerp(0.55, 0.98, ext), 'forward');
        this.hands[i] = 'flat';
        if (i === 1) this.held = null;
        break;
      }
      case 'choc': {
        // décharge : bras tendu, doigts écartés, tremblement
        const i = this.sideOf('choc', pref);
        const u = sinceAb / dur;
        const k = keys([[0, 0.3], [0.15, 1], [0.8, 1], [1, 0]], u);
        const dir = this.aimDir(v, _v4, -0.1 + Math.sin(now * 61) * 0.03 * k);
        dir.x += Math.sin(now * 47 + 1) * 0.03 * k;
        this.armToward(i, dir.normalize(), lerp(0.6, 0.97, k), 'down');
        this.hands[i] = 'flat';
        if (i === 1) this.held = null;
        break;
      }
      case 'roquettes': {
        // bras levé vers la cible, la nacelle se déploie, recul à chaque roquette
        const i = this.sideOf('roquettes', pref);
        let kick = 0;
        for (const t0 of [0.35, 0.5, 0.65, 0.8]) {
          const d = sinceAb - t0;
          if (d >= 0 && d < 0.25) kick = Math.max(kick, Math.exp(-d * 18));
        }
        this.armToward(i, this.aimDir(v, _v4, 0.12 + kick * 0.18), 0.94);
        this.hands[i] = 'fist';
        if (i === 1) this.held = null;
        break;
      }
      case 'outils': {
        // piratage : bras levé, main à plat vers le terminal, sondes sorties
        const i = this.sideOf('outils', pref);
        const dir = this.aimDir(v, _v4, -0.25);
        this.armToward(i, dir, 0.78 + Math.sin(now * 9) * 0.02, 'down');
        this.hands[i] = 'flat';
        if (i === 1) this.held = null;
        break;
      }
      case 'lame': {
        // fente : coup d'estoc de la lame, bras tendu
        const i = this.sideOf('lame', pref);
        const u = sinceAb / dur;
        const ext = keys([[0, 0.3], [0.2, 1], [0.6, 1], [1, 0.4]], u);
        this.armToward(i, this.aimDir(v, _v4, -0.1), lerp(0.6, 0.98, ext));
        this.hands[i] = 'fist';
        if (i === 1) this.held = null;
        break;
      }
      case 'poing': {
        // coup chargé libéré
        const i = this.sideOf('poing', pref);
        const u = sinceAb / dur;
        const ext = keys([[0, 0], [0.12, 1], [0.5, 0.95], [1, 0.2]], u);
        this.fk(i, lerp(0.3, -1.55, ext), lerp(0.5, -0.05, ext), 0, lerp(2.2, 0.05, ext));
        this.hands[i] = 'fist';
        if (i === 1) this.held = null;
        break;
      }
      case 'fouet': {
        // traction : coup de fouet vers l'avant puis on tire vers soi
        const i = this.sideOf('fouet', pref);
        const u = sinceAb / dur;
        const p = keys([[0, -0.8], [0.15, -2.2], [0.35, -1.2], [0.7, -0.6], [1, -0.5]], u);
        this.fk(i, p, 0.3, 0.1, keys([[0, 0.8], [0.15, 0.3], [0.35, 0.2], [0.7, 1.6], [1, 1.0]], u));
        this.hands[i] = u < 0.5 ? 'flat' : 'fist';
        if (i === 1) this.held = null;
        break;
      }
    }
  }

  /** Pièces mobiles des bras, filament du fouet, bouts des lanceurs, bouche du pistolet de bras. */
  private updateCyber(v: CharView, now: number, dt: number, striking: boolean, sinceMelee: number, sinceShot: number, awSide: number): void {
    const spec = this.cy;
    this.whipN = 0;
    this.thrust = Math.max(0, this.thrust - dt * 2.5);
    if (!spec) return;
    const fx = v.fx ?? 0;
    const ab = v.ab;
    const sinceAb = ab ? now - ab.at : 99;
    if (ab && sinceAb >= 0 && sinceAb < 0.08 && (ab.kind === 'esquive' || ab.kind === 'doubleSaut' || ab.kind === 'bond' || ab.kind === 'onde')) this.thrust = 1;
    if (v.anim === Anim.DASH || (v.anim === Anim.AIR_JUMP && this.flipT < 0.3)) this.thrust = Math.max(this.thrust, 0.8);
    const b = this.D === DIMS.f ? 'f' : 'm';
    for (let i = 0; i < 2; i++) {
      const id = armImplant(spec, i) as ArmImplant | null;
      const st = this.cyArm[i];
      if (!id) continue;
      const bit = i === 0 ? CFX.ARM_L : CFX.ARM_R;
      const out = (fx & bit) !== 0 || (awSide === i && IMPLANT_ARM_WEAPON[id] === v.weapon);
      st.deploy = approach(st.deploy, out ? 1 : 0, dt * (out ? 7 : 9));
      const abHere = ab && sinceAb >= 0 && ab.kind === id && (!ab.side || ab.side === (i === 0 ? 'L' : 'R'));
      let act = 0.15;
      switch (id) {
        case 'pistoletBras': {
          st.open = clamp(st.deploy * 2.2, 0, 1);
          st.slide = clamp(st.deploy * 2.2 - 1.1, 0, 1);
          const shot = awSide === i && sinceShot >= 0 && sinceShot < 0.6;
          st.heat = Math.max(st.heat * Math.exp(-dt * 2.5), shot ? Math.exp(-sinceShot * 6) : 0);
          act = st.deploy;
          break;
        }
        case 'lame':
          st.blade = smooth(st.deploy);
          st.heat = st.deploy * (striking && awSide === i ? 1.6 : 1);
          act = st.deploy;
          break;
        case 'poing': {
          const charge = (fx & CFX.CHARGE) !== 0 && awSide === i;
          const slam = (striking && awSide === i && sinceMelee < 0.25) || (abHere && sinceAb < 0.25);
          st.rods = approach(st.rods, slam ? -1 : charge ? 1 : 0, dt * (slam ? 30 : charge ? 5 : 10));
          act = 0.2 + 0.8 * st.deploy + (charge ? 1.2 * this.chargeW : 0) + (slam ? 1.5 : 0);
          break;
        }
        case 'grappin': {
          const fired = (fx & CFX.GRAPPLE) !== 0 || v.anim === Anim.GRAPPLE || (ab?.kind === 'grappin' && sinceAb >= 0 && sinceAb < 0.4 && (!ab.side || ab.side === (i === 0 ? 'L' : 'R')));
          st.hook = fired ? 0 : approach(st.hook, 1, dt * 6);
          if (st.hook > 0.98) st.hook = 1;
          act = fired ? 1 : 0.25;
          break;
        }
        case 'roquettes': {
          const on = !!abHere && sinceAb < 1.6;
          st.pod = approach(st.pod, on ? 1 : 0, dt * (on ? 9 : 4));
          st.cover = approach(st.cover, on && sinceAb > 0.15 && sinceAb < 1.35 ? 1 : 0, dt * 12);
          act = 0.2 + st.cover;
          break;
        }
        case 'outils': {
          const hack = (!!abHere && sinceAb < 1.1) || (now - v.interactAt >= 0 && now - v.interactAt < 0.6);
          st.probe = approach(st.probe, hack ? 1 : 0, dt * 9);
          act = 0.3 + 0.9 * st.probe;
          break;
        }
        case 'bouclier': {
          const on = (fx & CFX.SHIELD) !== 0;
          st.fins += dt * (on ? 7 : 0.6);
          act = on ? 1 : 0.1;
          break;
        }
        case 'choc':
          act = abHere && sinceAb < 0.8 ? 1.4 + Math.random() * 0.6 : 0.25 + 0.1 * Math.sin(now * 5 + i);
          break;
        case 'repulseur':
          act = abHere && sinceAb < 0.6 ? (sinceAb < 0.12 ? 0.6 + sinceAb * 8 : Math.max(0.2, 1.6 - sinceAb * 2.4)) : 0.2;
          break;
        case 'grip':
          act = v.anim === Anim.CLIMB || v.anim === Anim.WALLRUN_L || v.anim === Anim.WALLRUN_R ? 1 : 0.15;
          break;
        case 'fouet':
          act = 0.3 + 0.7 * st.deploy;
          break;
      }
      st.act = approach(st.act, act, dt * 14);
      // bout du lanceur du grappin (monde)
      if (id === 'grappin') {
        const t = grappleTip(b);
        this.grappleTips[i].set(this.m(i === 0 ? t[0] : -t[0]), this.m(t[1]), this.m(t[2])).applyMatrix4(this.mats[PART.FARM_L + i]);
      }
      // bouche du pistolet d'avant-bras
      if (id === 'pistoletBras' && awSide === i && v.weapon === Weapon.ARM_PISTOL) {
        const m = viperMuzzle(b);
        this.muzzle.set(0, this.m(m[1] - VIPER_SLIDE * st.slide - 0.5), this.m(m[2])).applyMatrix4(this.mats[PART.FARM_L + i]);
      }
      // fouet : filament pendant un coup
      if (id === 'fouet') {
        const whipping = (awSide === i && striking && v.weapon === Weapon.ARM_WHIP) || (!!abHere && sinceAb < 0.7);
        const t = whipping ? (abHere && sinceAb < 0.7 ? sinceAb / 0.7 : sinceMelee / 0.6) : -1;
        this.updateWhip(i, now, t);
      }
    }
  }

  /** Filament du fouet : segments qui suivent, avec retard, la direction du bras. */
  private updateWhip(i: number, now: number, t: number): void {
    const hm = this.mats[PART.HAND_L + i];
    const sm = this.mats[PART.UARM_L + i];
    const tip = _v1.set(0, this.m(-11), this.m(1)).applyMatrix4(hm);
    const sh = _v2.setFromMatrixPosition(sm);
    const dir = _v3.subVectors(tip, sh).normalize();
    // historique des directions
    this.whipHead = (this.whipHead + 1) % this.whipHist.length;
    const h = this.whipHist[this.whipHead];
    h.t = now;
    h.d.copy(dir);
    if (t < 0 || t > 1) return;
    const unfurl = smooth(t / 0.18) * (1 - smooth((t - 0.8) / 0.2));
    if (unfurl <= 0.01) return;
    const n = WHIP_SEGS;
    const total = 3.8 * unfurl;
    const segL = total / n;
    const p = _v4.copy(tip);
    const d = _v5;
    for (let k = 0; k < n; k++) {
      // direction du bras il y a k × 14 ms
      const want = now - k * 0.014;
      let best = this.whipHist[this.whipHead];
      for (let j = 0; j < this.whipHist.length; j++) {
        const e = this.whipHist[(this.whipHead - j + this.whipHist.length) % this.whipHist.length];
        best = e;
        if (e.t <= want) break;
      }
      d.copy(best.d);
      // ondulation et légère retombée
      d.y += Math.sin(k * 0.7 - now * 18) * 0.05 - k * 0.012;
      d.normalize();
      _q1.setFromUnitVectors(Y_AXIS, d);
      this.whipMats[k].compose(p, _q1, _v6.set(1, segL / WHIP_SEG_LEN, 1));
      p.addScaledVector(d, segL);
    }
    this.whipN = n;
  }

  private baseArmTargets(v: CharView, s: CharStyle, now: number, dt: number, dead: boolean, aiming: boolean, sinceShot: number, sinceMelee: number, throwing: boolean, striking: boolean): void {
    const w = v.weapon;
    const kind = WEAPON_KIND[w];
    const moving = this.moveW;
    const run = this.runW;
    const ph = this.phase;
    this.hands[0] = 'relax';
    this.hands[1] = 'relax';
    this.held = kind;
    // balancement des bras (marche, course), opposé aux jambes
    const swing = Math.cos(TAU * (ph - 0.04)) * lerp(0.5, 0.66, run) * moving;
    const elB = lerp(0.32, 1.45, run) * moving + 0.16 * (1 - moving);
    const relaxRoll = 0.1 + run * 0.08;
    // bras gauche : par défaut, balancement libre
    this.fk(0, swing, relaxRoll, 0.05, elB + Math.max(0, -swing) * 0.5, 0, 0, 0);
    this.fk(1, -swing, relaxRoll, 0.05, elB + Math.max(0, swing) * 0.5, 0, 0, 0);
    if (dead) {
      const tD = now - v.deathAt;
      const k = Math.min(1, tD / 0.5);
      const up = this.fallDir < 0;
      this.fk(0, up ? -1.2 * k : 0.4 * k, 1.1 * k + 0.1, 0.3, 0.3 + 0.4 * (1 - k), 0.2, 0, 0);
      this.fk(1, up ? -0.4 * k : -1.0 * k, 0.6 * k + 0.1, -0.2, 0.9 - 0.4 * k, 0.1, 0, 0);
      this.held = kind && tD < 0.35 ? kind : null;
      return;
    }
    const D = this.D;
    const shY = this.m(D.shoulder[1]);
    // ---------------------------------------------------------------- assis, au volant, accroupi
    if (this.sitW > 0.5) {
      if (this.driveW > 0.5) {
        // mains sur le volant (ou le guidon)
        for (let i = 0; i < 2; i++) {
          const sx = i === 0 ? 1 : -1;
          // poings fermés sur la jante, jointures vers l'avant, pouces vers le haut et l'intérieur
          this.ik(i, _v1.set(sx * 0.17, shY - 0.2, 0.38), _v2.set(sx * 0.8, -1, -0.3), handQ(i, 0, 0.2, 1, -sx * 0.75, -0.65, 0));
          this.hands[i] = 'fist';
        }
        this.held = null;
      } else {
        // mains posées sur les cuisses
        for (let i = 0; i < 2; i++) {
          const sx = i === 0 ? 1 : -1;
          // paume à plat sur la cuisse, doigts vers le genou
          this.ik(i, _v1.set(sx * 0.12, -0.06, 0.24), _v2.set(sx * 0.6, -0.2, -1), handQ(i, sx * 0.05, -0.35, 0.94, -sx * 0.15, -0.98, 0.1));
        }
        if (kind && !twoHanded(w)) this.hands[1] = 'grip';
        else this.held = null;
      }
      return;
    }
    if (this.cowerW > 0.5) {
      // mains sur la nuque, coudes en avant
      for (let i = 0; i < 2; i++) {
        const sx = i === 0 ? 1 : -1;
        // doigts croisés derrière la nuque, paumes contre la tête
        this.ik(i, _v1.set(sx * 0.07, this.m(D.neck[1]) + 0.08, -0.06), _v2.set(sx * 0.5, 0.2, 1), handQ(i, -sx * 0.9, 0.35, -0.1, 0, 0, 1));
      }
      this.held = null;
      return;
    }
    // ---------------------------------------------------------------- lancer (grenade)
    if (throwing) {
      const u = sinceMelee / 0.7;
      this.held = u < 0.5 ? 'grenade' : kind;
      this.hands[1] = u < 0.5 ? 'grip' : 'relax';
      const p = keys([[0, -0.5], [0.3, -2.7], [0.5, -2.4], [0.62, -1.2], [1, -0.2]], u);
      const e = keys([[0, 0.5], [0.3, 1.9], [0.5, 1.0], [0.62, 0.3], [1, 0.3]], u);
      const rl = keys([[0, 0.3], [0.3, 0.55], [0.62, 0.15], [1, 0.1]], u);
      this.fk(1, p, rl, 0.3, e, -0.2, 0, 0);
      this.fk(0, keys([[0, -0.4], [0.3, -1.4], [0.62, -0.3], [1, 0]], u), 0.25, 0, 0.5, 0, 0, 0);
      return;
    }
    // ---------------------------------------------------------------- coups
    if (striking) {
      const u = sinceMelee / 0.5;
      if (w === Weapon.FISTS) {
        // direct alterné : le poing part vers le visage de l'adversaire
        const i = this.punchSide ? 1 : 0;
        const o = 1 - i;
        const ext = keys([[0, 0], [0.12, 0.2], [0.3, 1], [0.55, 0.9], [1, 0]], u);
        this.fk(i, lerp(-1.05, -1.5, ext), lerp(0.2, -0.05, ext), 0, lerp(1.9, 0.12, ext), 0, 0, 0);
        this.fk(o, -1.05, 0.25, 0, 1.95, 0, 0, 0);
        this.hands[0] = this.hands[1] = 'fist';
        return;
      }
      if (w === Weapon.CLUB) {
        const p = keys([[0, -1.1], [0.28, -2.9], [0.5, -0.9], [0.6, -0.5], [1, -0.4]], u);
        const e = keys([[0, 0.8], [0.28, 1.4], [0.5, 0.2], [1, 0.4]], u);
        this.fk(1, p, 0.25, 0.2, e, 0.3, 0, 0);
      } else {
        // lame : taille en diagonale
        const p = keys([[0, -1.0], [0.25, -2.2], [0.5, -0.6], [1, -0.5]], u);
        const e = keys([[0, 1.0], [0.25, 1.5], [0.5, 0.25], [1, 0.6]], u);
        const rl = keys([[0, 0.3], [0.25, 0.7], [0.5, -0.5], [1, 0.1]], u);
        this.fk(1, p, rl, keys([[0, 0], [0.25, -0.6], [0.5, 0.5], [1, 0]], u), e, 0.2, 0, 0);
      }
      this.fk(0, -0.7, 0.3, 0, 1.4, 0, 0, 0);
      this.hands[0] = 'fist';
      this.hands[1] = 'grip';
      return;
    }
    // ---------------------------------------------------------------- visée
    const torsoInvRot = new THREE.Quaternion().setFromRotationMatrix(this.torsoM).invert();
    if (aiming && kind && !melee(w)) {
      this.hands[1] = 'grip';
      this.weaponPose(v, s, sinceShot, now);
      const wm = this.weaponT;
      // main droite sur la poignée
      const hr = this.handFromWeapon(wm, [0, 0, 0], _q3.setFromAxisAngle(X_AXIS, -HALF_PI), 1, new THREE.Matrix4());
      this.ikToHand(1, hr, _v4.set(-0.6, -1, longGun(w) ? -0.2 : -0.3));
      const meta = WEAPON_META[kind];
      if (meta.support || (w === Weapon.PISTOL && !s.oneHand)) {
        let hl: THREE.Matrix4;
        if (w === Weapon.PISTOL) hl = this.handFromWeapon(wm, [2.6, -1.4, 0.2], _q3.setFromAxisAngle(X_AXIS, -HALF_PI).multiply(_q2.setFromAxisAngle(Y_AXIS, 0.35)), 0, new THREE.Matrix4());
        else if (w === Weapon.SMG) hl = this.handFromWeapon(wm, meta.support!, _q3.setFromAxisAngle(X_AXIS, -HALF_PI), 0, new THREE.Matrix4());
        else hl = this.handFromWeapon(wm, meta.support!, _q3.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -HALF_PI).multiply(_q2.setFromAxisAngle(Y_AXIS, 0)), 0, new THREE.Matrix4());
        this.ikToHand(0, hl, _v4.set(0.5, -1, longGun(w) ? 0.1 : -0.2));
        this.hands[0] = 'grip';
      } else {
        // pistolet à une main : l'autre main sur la hanche ou le long du corps
        this.fk(0, 0.1 + this.moveW * 0.1, 0.2, 0, 0.5, 0, 0, 0);
      }
      void torsoInvRot;
      return;
    }
    if (aiming && melee(w)) {
      // garde : poings ou lame levés
      this.fk(1, -1.0, 0.15, 0.2, 1.9, -0.2, 0, 0);
      this.fk(0, -0.95, 0.25, 0, 2.0, 0, 0, 0);
      this.hands[0] = 'fist';
      this.hands[1] = kind ? 'grip' : 'fist';
      return;
    }
    // ---------------------------------------------------------------- port d'arme
    if (kind && twoHanded(w)) {
      // arme longue tenue à deux mains, canon vers le bas (en course : en travers de la poitrine)
      const wm = this.weaponT;
      const runA = run * this.moveW;
      _q1.copy(qEuler(lerp(0.75, -0.55, runA), lerp(0.55, 0.85, runA), lerp(0.25, -0.5, runA), 'YXZ', _q2));
      const pos = _v1.set(lerp(-0.07, -0.02, runA), lerp(this.m(D.shoulder[1]) - 0.24, this.m(D.shoulder[1]) - 0.12, runA), lerp(0.22, 0.24, runA));
      const bob = Math.sin(TAU * 2 * ph) * 0.01 * this.moveW;
      pos.y += bob;
      _m1.compose(pos, _q1, _one);
      wm.multiplyMatrices(this.torsoM, _m1);
      const hr = this.handFromWeapon(wm, [0, 0, 0], _q3.setFromAxisAngle(X_AXIS, -HALF_PI), 1, new THREE.Matrix4());
      this.ikToHand(1, hr, _v4.set(-0.8, -1, -0.2));
      const meta = WEAPON_META[kind];
      const hl =
        w === Weapon.SMG
          ? this.handFromWeapon(wm, meta.support!, _q3.setFromAxisAngle(X_AXIS, -HALF_PI), 0, new THREE.Matrix4())
          : this.handFromWeapon(wm, meta.support!, _q3.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -HALF_PI), 0, new THREE.Matrix4());
      this.ikToHand(0, hl, _v4.set(0.6, -1, 0.1));
      this.hands[0] = this.hands[1] = 'grip';
      return;
    }
    // interaction : la main droite se tend (bouton, porte, poignée de main) ; le bras tactique
    // (implant) se charge des terminaux s'il est installé
    const sinceInt = now - v.interactAt;
    if (sinceInt >= 0 && sinceInt < 0.6) {
      const k = Math.sin((sinceInt / 0.6) * PI);
      const ti = armImplant(this.cy, 0) === 'outils' ? 0 : 1;
      this.fk(ti, -1.3 * k, 0.1, 0, 0.5, 0, 0, 0);
      if (ti === 0) this.hands[0] = 'flat';
      this.held = kind;
      if (kind) this.hands[1] = 'grip';
      return;
    }
    if (kind) {
      // arme de poing ou arme blanche tenue le long du corps
      this.hands[1] = 'grip';
      this.fk(1, -0.12 - swing * 0.6, 0.12, 0.1, 0.4 + Math.max(0, swing) * 0.3 + run * 0.6 * moving, 0.15, 0, 0);
    }
    // ---------------------------------------------------------------- attitudes de repos
    const still = (1 - moving) * (1 - Math.max(this.crouchW, this.slideW, this.dashW, this.airW, this.climbW, this.grapW, this.launchW, Math.abs(this.wallW)));
    if (still < 0.5) return;
    // bras mécaniques : on ne les cache pas dans le dos ni dans les poches (on les montre)
    const cyArms = !!this.cy && (!!this.cy.arms[0] || !!this.cy.arms[1]);
    const idle = cyArms && (s.idle === 'behind' || s.idle === 'pockets') ? (this.cy!.arms[0] ? 'relaxed' : 'hip') : s.idle;
    const tt = this.idleT;
    if (idle === 'hip') {
      // main gauche sur la hanche, coude en dehors
      this.ik(0, _v1.set(0.2, 0.04, 0.02), _v2.set(1, 0.15, -0.4), handQ(0, -0.1, -0.69, -0.72, -0.36, -0.65, 0.67));
      this.hands[0] = 'fist';
      if (!kind) {
        this.fk(1, -0.06 + Math.sin(tt * 0.7) * 0.03, 0.12, 0, 0.28, 0, 0, 0);
      }
      return;
    }
    if (idle === 'behind') {
      // mains dans le dos : la droite à plat, paume vers l'arrière ; la gauche lui serre le poignet
      this.ik(1, _v1.set(-0.06, -0.02, -0.165), _v2.set(-1, -0.2, -0.9), handQ(1, 0.84, -0.54, 0, 0, 0, -1));
      this.ik(0, _v1.set(0.037, 0.066, -0.195), _v2.set(1, -0.2, -0.9), handQ(0, -0.84, -0.54, 0, 0, 0, 1));
      this.hands[0] = 'grip';
      this.hands[1] = 'flat';
      return;
    }
    if (kind) return;
    if (idle === 'crossed') {
      // bras croisés sur la poitrine
      this.ik(0, _v1.set(-0.11, 0.25, 0.15), _v2.set(1, -0.8, 0.2), handQ(0, -0.47, 0.26, -0.85, -0.2, -0.96, -0.18));
      this.ik(1, _v1.set(0.12, 0.22, 0.17), _v2.set(-1, -0.8, 0.2), handQ(1, 0.47, 0.13, -0.87, 0.2, -0.98, -0.04));
      return;
    }
    if (idle === 'pockets') {
      // mains glissées dans les poches de devant, dos de la main vers l'avant
      this.ik(0, _v1.set(0.135, -0.06, 0.06), _v2.set(1, -0.2, -0.6), handQ(0, -0.1, -0.85, -0.5, -0.35, 0, -0.9));
      this.ik(1, _v1.set(-0.135, -0.06, 0.06), _v2.set(-1, -0.2, -0.6), handQ(1, 0.1, -0.85, -0.5, 0.35, 0, -0.9));
      this.hands[0] = this.hands[1] = 'flat';
      return;
    }
    if (idle === 'belt') {
      // pouces dans le ceinturon
      // pouces dans le ceinturon : doigts pendants, paumes contre le pantalon
      this.ik(0, _v1.set(0.1, -0.02, 0.13), _v2.set(1, -0.3, -0.2), handQ(0, -0.25, -0.95, 0.1, -0.2, 0, -1));
      this.ik(1, _v1.set(-0.1, -0.02, 0.13), _v2.set(-1, -0.3, -0.2), handQ(1, 0.25, -0.95, 0.1, 0.2, 0, -1));
      return;
    }
    if (idle === 'phone') {
      // consulte son téléphone
      this.held = 'phone';
      this.hands[1] = 'grip';
      this.ik(1, _v1.set(-0.05, shY - 0.18, 0.27), _v2.set(-1, -1, -0.2), PHONE_HQ);
      this.fk(0, -0.02, 0.1, 0, 0.3, 0, 0, 0);
      return;
    }
    // bras ballants, respiration
    const br = Math.sin(tt * 1.6) * 0.02;
    this.fk(0, -0.03 + br, 0.11 + br, 0.08, 0.2, 0, 0, 0);
    this.fk(1, -0.03 + br, 0.11 + br, 0.08, 0.2, 0, 0, 0);
    void dt;
  }

  /** Arme en position de tir (repère du corps), recul compris. */
  private weaponPose(v: CharView, s: CharStyle, sinceShot: number, now: number): void {
    const w = v.weapon;
    const D = this.D;
    const shY = this.m(D.shoulder[1]);
    const pitch = clamp(v.pitch, -1.1, 1.1);
    // origine du repère de visée : base du cou, dans le repère du corps (lacet du corps)
    const o = _v1.set(0, shY, 0).applyMatrix4(this.torsoM);
    const off = _v2;
    if (w === Weapon.PISTOL) off.set(s.oneHand ? -0.16 : -0.02, s.oneHand ? 0.04 : 0.02, s.oneHand ? 0.56 : 0.5);
    else if (w === Weapon.SMG) off.set(-0.09, -0.1, 0.36);
    else off.set(-0.11, 0.03, this.m(-WEAPON_META[w === Weapon.RIFLE ? 'rifle' : 'shotgun'].butt![2]) + 0.03);
    // recul : l'arme part en arrière et se relève
    let kick = 0;
    if (sinceShot >= 0 && sinceShot < 0.3) kick = Math.exp(-sinceShot * (w === Weapon.SMG ? 32 : 16)) * (w === Weapon.SMG ? 0.45 : 1);
    off.z -= kick * (longGun(w) ? 0.05 : 0.04);
    qEuler(-pitch - kick * (longGun(w) ? 0.1 : 0.22), 0, 0, 'YXZ', _q1);
    off.applyQuaternion(_q1);
    // tir à une main : arme légèrement inclinée
    if (w === Weapon.PISTOL && s.oneHand) _q1.multiply(_q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.25));
    if (longGun(w)) off.y -= this.m(WEAPON_META[w === Weapon.RIFLE ? 'rifle' : 'shotgun'].butt![1]);
    this.weaponT.compose(_v3.copy(o).add(off), _q1, _one);
    void now;
  }
}

const g0y = -9;
