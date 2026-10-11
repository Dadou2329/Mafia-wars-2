// Animation procédurale des personnages (New York, 2085) : squelette à membres rigides,
// jambes en cinématique inverse (pieds posés au sol pendant l'appui, attaque du talon,
// déroulé du pied et poussée sur l'avant-pied, bassin qui monte, descend, se balance et
// tourne, buste en contre-rotation, tête stabilisée), bras en cinématique inverse pour la
// visée (pistolet à une ou deux mains, pistolet-mitrailleur, fusils épaulés), le port d'arme
// et les attitudes de repos, coups (poings, lame, matraque), lancer, interaction, assis, au
// volant, recroquevillé, sursaut à l'impact et chute à la mort. Les transitions sont lissées.
// Repère du corps : origine au sol sous le personnage, +Z devant, +X à gauche, en mètres
// (avant l'échelle du personnage).

import * as THREE from 'three';
import { Anim, CharKind, Weapon } from '../../shared/characters';
import { angleDiff, clamp } from '../../shared/util';
import type { CharView } from './characterRenderer';
import { GRIP, WEAPON_META, type HandPose, type WeaponKind } from './parts';
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
};

const longGun = (w: Weapon) => w === Weapon.RIFLE || w === Weapon.SHOTGUN;
const twoHanded = (w: Weapon) => longGun(w) || w === Weapon.SMG;
const melee = (w: Weapon) => w === Weapon.FISTS || w === Weapon.KNIFE || w === Weapon.CLUB;

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
  // pose lissée du haut du corps (angles)
  private pelvisOff = new THREE.Vector3();
  private pelvisRot = new THREE.Vector3();
  private torsoRot = new THREE.Vector3();
  private headRot = new THREE.Vector3();
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

  /** Met à jour la pose du personnage puis calcule les matrices monde de ses membres. */
  update(v: CharView, s: CharStyle, now: number, dt: number): void {
    const D = (this.D = DIMS[s.build]);
    const k = RES;
    const sc = s.scale;
    if (!this.yawInit) {
      this.yaw = v.yaw;
      this.yawInit = true;
    }
    const dead = v.anim === Anim.DEAD;
    const sitting = v.anim === Anim.SIT || v.anim === Anim.DRIVE;
    const driving = v.anim === Anim.DRIVE;
    const cowering = v.anim === Anim.COWER;
    if (!dead) this.yaw += angleDiff(this.yaw, v.yaw) * (1 - Math.exp(-dt * 14));
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    // vitesse dans le repère du corps (unités du modèle)
    const vxl = (v.vx * cy - v.vz * sy) / sc;
    const vzl = (v.vx * sy + v.vz * cy) / sc;
    let speed = Math.hypot(vxl, vzl);
    if (dead || sitting) speed = 0;
    // ---------------------------------------------------------------- poids des états
    const r = dt;
    this.sitW = approach(this.sitW, sitting ? 1 : 0, r * 6);
    this.driveW = approach(this.driveW, driving ? 1 : 0, r * 6);
    this.cowerW = approach(this.cowerW, cowering ? 1 : 0, r * 7);
    const free = (1 - this.sitW) * (1 - this.cowerW);
    this.moveW = approach(this.moveW, sstep(0.08, 0.8, speed) * free, r * 9);
    this.runW = approach(this.runW, sstep(2.0, 3.3, speed), r * 6);
    const w = v.weapon;
    const ranged = !melee(w);
    const aiming = v.aiming && !dead && !sitting;
    this.aimW = approach(this.aimW, aiming ? 1 : 0, r * 12);
    // posture de tir décalée (fusils épaulés)
    this.stanceW = approach(this.stanceW, aiming && longGun(w) ? 1 : aiming && w === Weapon.PISTOL && !s.oneHand ? 0.4 : 0, r * 6);
    if (speed < 0.2) this.idleT += dt;

    // ---------------------------------------------------------------- démarche
    const run = this.runW;
    const walkS = clamp(0.5 + 0.42 * speed, 0.75, 1.5);
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
    const latW = lerp(0.085, 0.06, run) + side * 0.08;
    const lift = lerp(0.06 + 0.015 * speed, 0.15 + 0.045 * speed, run);
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
      g.yaw = sideX * 0.08;
    }
    const swayX = Math.cos(TAU * (ph - 0.25)) * lerp(0.022, 0.008, run) * this.moveW;
    const pelvisYaw = -Math.cos(TAU * ph) * lerp(0.07, 0.1, run) * this.moveW * (dirZ >= 0 ? 1 : -1);
    const pelvisRoll = Math.cos(TAU * (ph - 0.25)) * lerp(0.05, 0.03, run) * this.moveW;
    const flight = run * 0.025 * Math.max(0, Math.cos(TAU * 2 * (ph - 0.25 - beta / 2)));

    // ---------------------------------------------------------------- pieds : repos, assis, accroupi
    const idleShift = Math.sin(this.idleT * 0.42 + (this.seed % 7)) * 0.014 + Math.sin(this.idleT * 0.13) * 0.006;
    const stg = this.stanceW;
    for (let i = 0; i < 2; i++) {
      const sideX = i === 0 ? 1 : -1;
      const f = this.feet[i];
      // repos (posture décalée en visée au fusil : pied gauche devant)
      _v3.set(sideX * lerp(0.1, i === 0 ? 0.07 : 0.13, stg), 0, lerp(0, i === 0 ? 0.15 : -0.12, stg));
      let pitch = 0;
      let yaw = sideX * 0.12 - stg * 0.35;
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
    const fastP = 1 - Math.exp(-dt * 20);
    this.pelvisOff.lerp(tOff, fastP);
    this.pelvisRot.x = lerp(this.pelvisRot.x, tPitch, fastP);
    this.pelvisRot.y = pelvisYaw;
    this.pelvisRot.z = lerp(this.pelvisRot.z, tRoll, fastP);
    // portée des jambes : le bassin descend si un pied posé ne peut être atteint
    const hip = D.hip;
    const legL = this.m(D.thigh + D.shin) * 0.997;
    let py = restY + this.pelvisOff.y;
    for (let i = 0; i < 2; i++) {
      const planted = this.moveW < 0.5 || this.stance[i] || this.sitW > 0.5;
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
    if (speed < 0.2 && !aiming) {
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
    // visée : le buste s'oriente (de profil pour les fusils), la tête suit l'inclinaison
    if (this.aimW > 0 && ranged) {
      const blade = longGun(w) ? -0.5 : w === Weapon.SMG ? -0.22 : s.oneHand ? -0.35 : 0;
      tTorso.y = lerp(tTorso.y, blade, this.aimW);
      tTorso.x = lerp(tTorso.x, -v.pitch * 0.25 + 0.04, this.aimW);
      tHead.y = lerp(tHead.y, -blade - counter * 0.3 + (longGun(w) ? 0.06 : 0), this.aimW);
      tHead.x = lerp(tHead.x, -v.pitch * 0.55 + (longGun(w) ? 0.12 : 0.04), this.aimW);
      tHead.z = lerp(tHead.z, longGun(w) ? -0.12 : 0, this.aimW);
    } else if (this.aimW > 0) {
      // garde (poings, lame)
      tTorso.y = lerp(tTorso.y, -0.25, this.aimW);
      tTorso.x = lerp(tTorso.x, 0.1, this.aimW);
      tHead.y = lerp(tHead.y, 0.22, this.aimW);
    }
    if (s.idle === 'phone' && speed < 0.2 && !aiming && w === Weapon.FISTS && this.sitW < 0.5) tHead.x = lerp(tHead.x, 0.42, 1 - this.moveW);
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
    const striking = !ranged && sinceMelee >= 0 && sinceMelee < 0.5;
    if (v.meleeAt !== this.lastMelee) {
      this.lastMelee = v.meleeAt;
      this.punchSide ^= 1;
    }
    if (throwing) {
      const u = sinceMelee / 0.7;
      tTorso.y += keys([[0, 0], [0.3, -0.55], [0.55, 0.45], [1, 0]], u);
      tTorso.x += keys([[0, 0], [0.3, -0.12], [0.55, 0.22], [1, 0]], u);
      tHead.y -= keys([[0, 0], [0.3, -0.45], [0.55, 0.3], [1, 0]], u);
    } else if (striking) {
      const u = sinceMelee / 0.5;
      if (w === Weapon.FISTS) {
        const sgn = this.punchSide ? 1 : -1;
        tTorso.y += sgn * keys([[0, 0], [0.25, 0.45], [0.6, 0.3], [1, 0]], u);
      } else {
        tTorso.y += keys([[0, 0], [0.25, -0.45], [0.55, 0.45], [1, 0]], u);
        tTorso.x += keys([[0, 0], [0.25, -0.1], [0.55, 0.25], [1, 0]], u);
      }
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
    const fastT = 1 - Math.exp(-dt * (aiming || striking || throwing ? 22 : 12));
    this.torsoRot.lerp(tTorso, fastT);
    this.headRot.lerp(tHead, fastT);

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
      const A = f.pos;
      // genou vers l'avant (et un peu vers l'extérieur), dans la direction du pied
      const pole = _v2.set(Math.sin(f.yaw) + sideX * 0.08, 0.05, Math.cos(f.yaw));
      if (this.sitW > 0.5 || this.cowerW > 0.5) pole.y += 0.6;
      this.legIK(H, A, pole, this.m(D.thigh), this.m(D.shin), i);
      // pied
      qEuler(-f.pitch, f.yaw, 0, 'YXZ', _q1);
      _m1.compose(A, _q1, _one);
      this.mats[PART.FOOT_L + i].multiplyMatrices(root, _m1);
    }

    // ---------------------------------------------------------------- pans et jupes
    for (let i = 0; i < 2; i++) {
      const sideX = i === 0 ? 1 : -1;
      // le pan suit (en partie) l'inclinaison de la cuisse
      const thighPitch = this.thighPitch[i];
      const target = clamp(thighPitch * 0.55, -0.7, 0.45) + this.moveW * run * 0.25 + this.sitW * 0.2;
      this.tails[i] = lerp(this.tails[i], target, 1 - Math.exp(-dt * 14));
      _m1.compose(_v1.set(sideX * this.m(hip[0]), this.m(hip[1]), this.m(hip[2])), qEuler(this.tails[i], 0, sideX * (0.04 + this.sitW * 0.25), 'XYZ', _q1), _one);
      this.mats[PART.TAIL_L + i].multiplyMatrices(root, this.pelvisM).multiply(_m1);
      _m1.compose(_v1.set(sideX * this.m(hip[0]), this.m(hip[1]), this.m(hip[2])), qEuler(this.tails[i] * 0.55, 0, sideX * this.sitW * 0.2, 'XYZ', _q1), _one);
      this.mats[PART.SKIRT_L + i].multiplyMatrices(root, this.pelvisM).multiply(_m1);
    }

    // ---------------------------------------------------------------- bras
    this.armTargets(v, s, now, dt, dead, aiming, sinceShot, sinceMelee, throwing, striking);
    const armRate = aiming || striking || throwing || (sinceShot >= 0 && sinceShot < 0.3) ? 24 : dead ? 7 : 11;
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
  private ik(i: number, W: THREE.Vector3, pole: THREE.Vector3, hq: THREE.Quaternion | null): void {
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

  private armTargets(v: CharView, s: CharStyle, now: number, dt: number, dead: boolean, aiming: boolean, sinceShot: number, sinceMelee: number, throwing: boolean, striking: boolean): void {
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
          this.ik(i, _v1.set(sx * 0.17, shY - 0.2, 0.38), _v2.set(sx * 0.8, -1, -0.3), qEuler(-1.2, 0, sx * -0.4, 'XYZ', _q3));
          this.hands[i] = 'fist';
        }
        this.held = null;
      } else {
        // mains posées sur les cuisses
        for (let i = 0; i < 2; i++) {
          const sx = i === 0 ? 1 : -1;
          this.ik(i, _v1.set(sx * 0.12, -0.06, 0.24), _v2.set(sx * 0.6, -0.2, -1), qEuler(-1.3, 0, sx * -0.3, 'XYZ', _q3));
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
        this.ik(i, _v1.set(sx * 0.07, this.m(D.neck[1]) + 0.08, -0.06), _v2.set(sx * 0.5, 0.2, 1), qEuler(-2.6, 0, sx * 0.6, 'XYZ', _q3));
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
    // interaction : la main droite se tend (bouton, porte, poignée de main)
    const sinceInt = now - v.interactAt;
    if (sinceInt >= 0 && sinceInt < 0.6) {
      const k = Math.sin((sinceInt / 0.6) * PI);
      this.fk(1, -1.3 * k, 0.1, 0, 0.5, 0, 0, 0);
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
    const still = 1 - moving;
    if (still < 0.5) return;
    const idle = s.idle;
    const tt = this.idleT;
    if (idle === 'hip') {
      // main gauche sur la hanche, coude en dehors
      this.ik(0, _v1.set(0.2, 0.04, 0.02), _v2.set(1, 0.15, -0.4), qEuler(-0.2, 0, -1.6, 'XYZ', _q3));
      this.hands[0] = 'fist';
      if (!kind) {
        this.fk(1, -0.06 + Math.sin(tt * 0.7) * 0.03, 0.12, 0, 0.28, 0, 0, 0);
      }
      return;
    }
    if (idle === 'behind') {
      // mains croisées dans le dos
      this.ik(0, _v1.set(0.035, -0.02, -0.17), _v2.set(1, -0.2, -0.9), qEuler(0.4, 0, 0.9, 'XYZ', _q3));
      this.ik(1, _v1.set(-0.035, 0.0, -0.18), _v2.set(-1, -0.2, -0.9), qEuler(0.4, 0, -0.9, 'XYZ', _q3));
      return;
    }
    if (kind) return;
    if (idle === 'crossed') {
      // bras croisés sur la poitrine
      this.ik(0, _v1.set(-0.11, 0.25, 0.15), _v2.set(1, -0.8, 0.2), qEuler(-1.5, 0, 1.3, 'XYZ', _q3));
      this.ik(1, _v1.set(0.12, 0.22, 0.17), _v2.set(-1, -0.8, 0.2), qEuler(-1.5, 0, -1.3, 'XYZ', _q3));
      return;
    }
    if (idle === 'pockets') {
      this.ik(0, _v1.set(0.135, -0.06, 0.06), _v2.set(1, -0.2, -0.6), qEuler(0.1, 0, 0.1, 'XYZ', _q3));
      this.ik(1, _v1.set(-0.135, -0.06, 0.06), _v2.set(-1, -0.2, -0.6), qEuler(0.1, 0, -0.1, 'XYZ', _q3));
      this.hands[0] = this.hands[1] = 'flat';
      return;
    }
    if (idle === 'belt') {
      // pouces dans le ceinturon
      this.ik(0, _v1.set(0.1, -0.02, 0.13), _v2.set(1, -0.3, -0.2), qEuler(0.2, 0, 0.6, 'XYZ', _q3));
      this.ik(1, _v1.set(-0.1, -0.02, 0.13), _v2.set(-1, -0.3, -0.2), qEuler(0.2, 0, -0.6, 'XYZ', _q3));
      return;
    }
    if (idle === 'phone') {
      // consulte son téléphone
      this.held = 'phone';
      this.hands[1] = 'grip';
      this.ik(1, _v1.set(-0.05, shY - 0.18, 0.27), _v2.set(-1, -1, -0.2), qEuler(-1.9, 0.5, -0.2, 'XYZ', _q3));
      this.fk(0, -0.02, 0.1, 0, 0.3, 0, 0, 0);
      return;
    }
    // bras ballants, respiration
    const br = Math.sin(tt * 1.6) * 0.02;
    this.fk(0, -0.03 + br, 0.11 + br, 0.08, 0.2, 0, 0, 0);
    this.fk(1, -0.03 + br, 0.11 + br, 0.08, 0.2, 0, 0, 0);
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
