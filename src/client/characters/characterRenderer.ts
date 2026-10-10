// Rendu instancié des personnages et animation procédurale par membres rigides.
// Chaque membre (géométrie) est un InstancedMesh partagé par tous les personnages ;
// la tenue vient d'une ligne de palette propre à chaque personnage, et la couleur des
// liserés lumineux (SLOT.NEON) d'un attribut d'instance. Les tourelles de sécurité
// (CharKind.TURRET) sont dessinées avec leur propre modèle (socle fixe, canon orientable).

import * as THREE from 'three';
import { Anim, CharKind, Weapon } from '../../shared/characters';
import { angleDiff, clamp, hash32 } from '../../shared/util';
import { meshModel, downsample } from '../models/modelMesher';
import type { VoxelModel } from '../models/voxelModel';
import { createObjectMaterial, PALETTE_ROWS, paletteData, paletteTexture } from '../render/voxelObjectMaterial';
import * as P from './parts';
import { appearanceFor, OUTFIT_ORDER, partKeys, styleParts, type Appearance, type BossCustom, type PartKeys } from './styles';

export interface CharView {
  id: number;
  kind: CharKind;
  faction: number;
  look: number;
  gang: number;
  custom?: BossCustom;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vz: number;
  anim: Anim;
  aiming: boolean;
  weapon: Weapon;
  shotAt: number;
  hitAt: number;
  meleeAt: number;
  interactAt: number;
  deathAt: number;
  /** Ne pas dessiner (joueur local en vue subjective). */
  hidden?: boolean;
  /** Surbrillance (cible visée, membre de l'escouade). */
  highlight?: number;
}

const R = P.RES;
const BODY_SCALE = 0.92;
const HALF_PI = Math.PI / 2;

/** Angles courants d'un personnage (lissés). */
class Pose {
  bob = 0;
  pelvisYaw = 0;
  torsoPitch = 0;
  torsoYaw = 0;
  torsoRoll = 0;
  headPitch = 0;
  headYaw = 0;
  shL = { p: 0, r: 0.08, y: 0 };
  shR = { p: 0, r: -0.08, y: 0 };
  elL = 0.15;
  elR = 0.15;
  hipL = { p: 0, r: 0 };
  hipR = { p: 0, r: 0 };
  knL = 0;
  knR = 0;
  skirtSway = 0;
  /** Arme longue portée à la hanche, canon vers le bas (0..1). */
  carry = 0;
}

interface AnimState {
  sig: string;
  app: Appearance;
  keys: PartKeys;
  row: number;
  /** Attribut d'instance aOwner : propriétaire (0..2) + 4 × couleur de néon. */
  owner: number;
  parts: string[];
  phase: number;
  pose: Pose;
  target: Pose;
  lastSeen: number;
  smoothYaw: number;
  smoothPitch: number;
  /** Tourelle : orientation fixe du socle, canon qui a tiré en dernier. */
  baseYaw: number;
  barrel: number;
  lastShot: number;
  fallDir: number;
  seed: number;
  idleT: number;
}

interface PartMesh {
  key: string;
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
  rowsNear: THREE.InstancedBufferAttribute;
  rowsFar: THREE.InstancedBufferAttribute;
  ownNear: THREE.InstancedBufferAttribute;
  ownFar: THREE.InstancedBufferAttribute;
  nNear: number;
  nFar: number;
}

const CAPACITY = 700;

function buildPart(key: string): VoxelModel {
  const [name, arg, opt] = key.split(':');
  switch (name) {
    case 'torso':
      return P.torso(arg as P.TorsoStyle, opt === 'f');
    case 'pelvis':
      return P.pelvis(arg as P.PelvisStyle);
    case 'head':
      return P.head(arg as P.HeadStyle);
    case 'hat':
      return P.hat(arg as P.HatStyle);
    case 'upperArm':
      return P.upperArm(arg as P.ArmStyle, opt === 'band');
    case 'forearm':
      return P.forearm(arg as P.ArmStyle);
    case 'thigh':
      return P.thigh(arg as P.LegStyle);
    case 'shin':
      return P.shin(arg as P.FootStyle);
    case 'tailL':
      return P.coatTail(arg as P.TailStyle, 1);
    case 'tailR':
      return P.coatTail(arg as P.TailStyle, -1);
    case 'skirt':
      return P.skirt(arg as P.SkirtStyle);
    case 'weapon':
      return P.weaponModel(arg as P.WeaponKind);
    case 'turret':
      return arg === 'base' ? P.turretBase() : arg === 'yoke' ? P.turretYoke() : P.turretGun();
    default:
      throw new Error('membre inconnu ' + key);
  }
}

const WEAPON_KIND: Record<Weapon, P.WeaponKind | null> = {
  [Weapon.FISTS]: null,
  [Weapon.PISTOL]: 'pistol',
  [Weapon.SHOTGUN]: 'shotgun',
  [Weapon.RIFLE]: 'rifle',
  [Weapon.KNIFE]: 'knife',
  [Weapon.CLUB]: 'club',
  [Weapon.SMG]: 'smg',
};

const WEAPON_KEY = Object.fromEntries(Object.entries(WEAPON_KIND).map(([w, k]) => [w, k ? `weapon:${k}` : null])) as Record<Weapon, string | null>;

const TURRET_KEYS = ['turret:base', 'turret:yoke', 'turret:gun'];

/** Armes tenues à deux mains en visée. */
const twoHandedW = (w: Weapon) => w === Weapon.RIFLE || w === Weapon.SHOTGUN || w === Weapon.SMG;
/** Armes longues portées canon vers le bas, à deux mains, hors visée. */
const longGun = (w: Weapon) => w === Weapon.RIFLE || w === Weapon.SHOTGUN;

export class CharacterRenderer {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  private parts = new Map<string, PartMesh>();
  private states = new Map<number, AnimState>();
  private freeRows: number[] = [];
  private frame = 0;
  // temporaires
  private m0 = new THREE.Matrix4();
  private mRoot = new THREE.Matrix4();
  private mPelvis = new THREE.Matrix4();
  private mTorso = new THREE.Matrix4();
  private mHead = new THREE.Matrix4();
  private mShL = new THREE.Matrix4();
  private mShR = new THREE.Matrix4();
  private mFoL = new THREE.Matrix4();
  private mFoR = new THREE.Matrix4();
  private mThL = new THREE.Matrix4();
  private mThR = new THREE.Matrix4();
  private mShinL = new THREE.Matrix4();
  private mShinR = new THREE.Matrix4();
  private mTmp = new THREE.Matrix4();
  private e = new THREE.Euler();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private vB = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private s = new THREE.Vector3();
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  /** Positions des bouches de canon (ou de la main droite) pour les flammes et traçantes. */
  readonly muzzle = new Map<number, THREE.Vector3>();
  /** Tête des personnages (pour les étiquettes, sang…). */
  readonly heads = new Map<number, THREE.Vector3>();
  lodDistance = 16;
  maxDistance = 110;
  stats = { drawn: 0, instances: 0 };

  constructor() {
    this.material = createObjectMaterial({ palette: true, key: 'chars' });
    this.group.name = 'personnages';
    for (let i = PALETTE_ROWS - 1; i >= 1; i--) this.freeRows.push(i);
  }

  private partMesh(key: string): PartMesh {
    let pm = this.parts.get(key);
    if (pm) return pm;
    const model = buildPart(key);
    const geoNear = meshModel(model);
    const geoFar = meshModel(downsample(model));
    const mk = (geo: THREE.BufferGeometry) => {
      const mesh = new THREE.InstancedMesh(geo, this.material, CAPACITY);
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const rows = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
      rows.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aRow', rows);
      // propriétaire + couleur de néon de chaque instance (lue par le shader comme aOwner)
      const own = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
      own.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aOwner', own);
      this.group.add(mesh);
      return { mesh, rows, own };
    };
    const a = mk(geoNear);
    const b = mk(geoFar);
    pm = { key, near: a.mesh, far: b.mesh, rowsNear: a.rows, rowsFar: b.rows, ownNear: a.own, ownFar: b.own, nNear: 0, nFar: 0 };
    this.parts.set(key, pm);
    return pm;
  }

  /** Précharge les géométries d'un style (évite un à-coup au premier affichage). */
  warm(kinds: { kind: CharKind; faction: number; look: number; gang?: number }[]): void {
    for (const k of kinds) {
      if (k.kind === CharKind.TURRET) {
        for (const p of TURRET_KEYS) this.partMesh(p);
        continue;
      }
      const app = appearanceFor(k.kind, k.faction, k.look, k.gang ?? 0);
      for (const p of styleParts(app.style)) this.partMesh(p);
    }
    for (const w of Object.values(WEAPON_KEY)) if (w) this.partMesh(w);
  }

  private writeRow(row: number, app: Appearance): void {
    const o = app.outfit;
    for (let i = 0; i < OUTFIT_ORDER.length; i++) {
      const c = o[OUTFIT_ORDER[i]] as number;
      const k = (row * 32 + i) * 4;
      paletteData[k] = (c >> 16) & 255;
      paletteData[k + 1] = (c >> 8) & 255;
      paletteData[k + 2] = c & 255;
      paletteData[k + 3] = o.metal && o.metal & (1 << i) ? 140 : 255;
    }
    paletteTexture.needsUpdate = true;
  }

  private stateFor(v: CharView): AnimState {
    let st = this.states.get(v.id);
    const sig = `${v.kind}/${v.faction}/${v.look}/${v.gang}/${JSON.stringify(v.custom ?? null)}`;
    if (st && st.sig === sig) return st;
    const app = appearanceFor(v.kind, v.faction, v.look, v.gang, v.custom);
    const row = st ? st.row : this.freeRows.pop() ?? 0;
    this.writeRow(row, app);
    const turret = v.kind === CharKind.TURRET;
    const parts = turret ? TURRET_KEYS : styleParts(app.style);
    const seed = hash32(v.id * 7 + 1);
    const owner = (v.faction === 1 || v.faction === 2 ? v.faction : 0) + 4 * (app.neon & 7);
    st = {
      sig,
      app,
      keys: partKeys(app.style),
      row,
      owner,
      parts,
      phase: (seed % 100) / 16,
      pose: new Pose(),
      target: new Pose(),
      lastSeen: this.frame,
      smoothYaw: v.yaw,
      smoothPitch: v.pitch,
      baseYaw: st?.baseYaw ?? v.yaw,
      barrel: 0,
      lastShot: v.shotAt,
      fallDir: seed % 10 < 7 ? -1 : 1,
      seed,
      idleT: (seed % 1000) / 100,
    };
    for (const p of parts) this.partMesh(p);
    this.states.set(v.id, st);
    return st;
  }

  /** Dessine la liste des personnages pour cette image. */
  update(views: CharView[], camera: THREE.Camera, now: number, dt: number): void {
    this.frame++;
    for (const pm of this.parts.values()) {
      pm.nNear = 0;
      pm.nFar = 0;
    }
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const camPos = (camera as THREE.PerspectiveCamera).position;
    let drawn = 0;
    for (const v of views) {
      if (v.kind === CharKind.VEHICLE) continue;
      const st = this.stateFor(v);
      st.lastSeen = this.frame;
      const turret = v.kind === CharKind.TURRET;
      if (turret) this.animateTurret(v, st, dt);
      else this.animate(v, st, now, dt);
      if (v.hidden) continue;
      const dx = v.x - camPos.x;
      const dz = v.z - camPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > this.maxDistance * this.maxDistance) continue;
      this.sphere.center.set(v.x, v.y + 0.9, v.z);
      this.sphere.radius = v.anim === Anim.DEAD ? 2 : 1.3;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const far = d2 > this.lodDistance * this.lodDistance;
      if (turret) this.poseTurret(v, st, far, now);
      else this.pose(v, st, far, now);
      drawn++;
    }
    // libère les états des personnages disparus
    if (this.frame % 60 === 0) {
      for (const [id, st] of this.states) {
        if (this.frame - st.lastSeen > 120) {
          this.states.delete(id);
          if (st.row > 0) this.freeRows.push(st.row);
          this.muzzle.delete(id);
          this.heads.delete(id);
        }
      }
    }
    let inst = 0;
    for (const pm of this.parts.values()) {
      pm.near.count = pm.nNear;
      pm.far.count = pm.nFar;
      // les géométries sans instance ne coûtent rien (ni appel de dessin ni ombre)
      pm.near.visible = pm.nNear > 0;
      pm.far.visible = pm.nFar > 0;
      if (pm.nNear) {
        pm.near.instanceMatrix.needsUpdate = true;
        pm.rowsNear.needsUpdate = true;
        pm.ownNear.needsUpdate = true;
      }
      if (pm.nFar) {
        pm.far.instanceMatrix.needsUpdate = true;
        pm.rowsFar.needsUpdate = true;
        pm.ownFar.needsUpdate = true;
      }
      inst += pm.nNear + pm.nFar;
    }
    this.stats.drawn = drawn;
    this.stats.instances = inst;
  }

  // ------------------------------------------------------------------ animation

  private animate(v: CharView, st: AnimState, now: number, dt: number): void {
    const t = st.target;
    const speed = Math.hypot(v.vx, v.vz);
    // phase de marche : avance avec la distance parcourue (recule si on marche à reculons)
    const fwd = Math.sin(v.yaw) * v.vx + Math.cos(v.yaw) * v.vz;
    const run = clamp((speed - 2.6) / 2.2, 0, 1);
    const stride = 1.4 + run * 1.3;
    if (speed > 0.15) st.phase += ((fwd >= -0.2 ? 1 : -1) * speed / stride) * Math.PI * 2 * dt;
    const ph = st.phase;
    const moving = clamp(speed / 1.2, 0, 1);
    const A = (0.42 + run * 0.42) * moving;
    const K = (0.75 + run * 0.85) * moving;
    const B = (0.38 + run * 0.35) * moving;
    const sinp = Math.sin(ph);
    const cosp = Math.cos(ph);
    // jambes
    t.hipL.p = -A * sinp;
    t.hipR.p = A * sinp;
    t.hipL.r = 0.02;
    t.hipR.r = -0.02;
    t.knL = K * Math.pow(Math.max(0, cosp), 1.4) + 0.05 * moving;
    t.knR = K * Math.pow(Math.max(0, -cosp), 1.4) + 0.05 * moving;
    t.bob = (-0.018 - run * 0.03) * Math.abs(Math.cos(ph)) * moving + 0.018 * moving;
    t.torsoPitch = run * 0.16 + 0.02 * moving;
    t.torsoYaw = 0.07 * sinp * moving;
    t.torsoRoll = 0;
    t.pelvisYaw = -0.05 * sinp * moving;
    // bras ballants qui accompagnent la marche
    t.shL.p = B * sinp;
    t.shR.p = -B * sinp;
    t.shL.r = 0.09 + run * 0.1;
    t.shR.r = -0.09 - run * 0.1;
    t.shL.y = 0;
    t.shR.y = 0;
    t.elL = 0.18 + run * 1.1 + 0.12 * Math.max(0, -sinp) * moving;
    t.elR = 0.18 + run * 1.1 + 0.12 * Math.max(0, sinp) * moving;
    t.headPitch = 0;
    t.headYaw = 0;
    t.skirtSway = 0.05 * sinp * moving;
    t.carry = 0;
    // repos : respiration et coups d'œil
    if (speed < 0.2) {
      st.idleT += dt;
      const br = Math.sin(st.idleT * 1.7) * 0.015;
      t.torsoPitch += br;
      t.headYaw = Math.sin(st.idleT * 0.37 + st.seed) * 0.35 * (Math.sin(st.idleT * 0.11) > 0.3 ? 1 : 0.2);
      t.shL.r += br;
      t.shR.r -= br;
      if (v.kind === CharKind.BOSS_DADOU || v.kind === CharKind.LIEUTENANT) {
        // pose assurée : main sur la hanche
        t.shR.p = 0.25;
        t.elR = 0.9;
        t.shR.r = -0.25;
      } else if (v.kind === CharKind.BOSS_EVEN || v.kind === CharKind.BARMAN) {
        // mains croisées dans le dos
        t.shL.p = t.shR.p = 0.32;
        t.elL = t.elR = 0.75;
        t.shL.r = 0.16;
        t.shR.r = -0.16;
      }
    }
    // arme longue hors visée : posée sur l'épaule droite, canon vers le haut et l'arrière
    const melee = now - v.meleeAt < 0.45;
    if (longGun(v.weapon) && !v.aiming && !melee && v.anim !== Anim.DEAD && v.anim !== Anim.SIT && v.anim !== Anim.DRIVE && v.anim !== Anim.COWER) {
      t.carry = 1;
      t.shR.p = -0.38 - 0.1 * run;
      t.shR.r = -0.1;
      t.shR.y = 0;
      t.elR = 1.72;
    }
    // visée
    const aimP = v.pitch;
    const twoHanded = twoHandedW(v.weapon);
    const ranged = v.weapon === Weapon.PISTOL || twoHanded;
    if (v.aiming && ranged) {
      if (twoHanded) {
        const smg = v.weapon === Weapon.SMG;
        t.shR.p = -HALF_PI * (smg ? 0.86 : 0.78) - aimP;
        t.shR.r = smg ? 0.3 : 0.45;
        t.shR.y = 0.2;
        t.elR = smg ? 0.55 : 0.95;
        t.shL.p = -HALF_PI - aimP;
        t.shL.r = smg ? -0.42 : -0.32;
        t.elL = smg ? 0.5 : 0.25;
        t.torsoYaw = -0.2;
      } else {
        t.shR.p = -HALF_PI - aimP;
        t.shR.r = 0.12;
        t.shR.y = 0;
        t.elR = 0.04;
        t.shL.p = 0.05;
        t.elL = 0.3;
        t.torsoYaw = 0.12;
      }
      t.headPitch = -aimP * 0.6;
    } else if (v.aiming) {
      // garde de boxe / arme blanche levée
      t.shR.p = -1.0;
      t.elR = 1.5;
      t.shR.r = 0.2;
      t.shL.p = -0.9;
      t.elL = 1.6;
      t.shL.r = -0.2;
    }
    // tir : recul (très court pour le pistolet-mitrailleur, qui tire en rafale)
    const sinceShot = now - v.shotAt;
    if (sinceShot >= 0 && sinceShot < 0.25) {
      const smg = v.weapon === Weapon.SMG;
      const k = Math.exp(-sinceShot * (smg ? 40 : 18)) * (smg ? 0.35 : 1);
      t.shR.p -= 0.42 * k;
      t.torsoPitch -= 0.06 * k;
      if (twoHanded) t.shL.p -= 0.3 * k;
    }
    // corps à corps
    const sinceMelee = now - v.meleeAt;
    if (sinceMelee >= 0 && sinceMelee < 0.45) {
      const u = sinceMelee / 0.45;
      if (v.weapon === Weapon.FISTS) {
        const k = u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65;
        t.shR.p = -1.0 - 0.55 * k;
        t.elR = 1.5 - 1.45 * k;
        t.torsoYaw = 0.35 * k;
      } else {
        if (u < 0.3) {
          const k = u / 0.3;
          t.shR.p = -1.2 - 1.5 * k;
          t.elR = 0.4 + 1.0 * k;
          t.shR.r = 0.2;
        } else if (u < 0.6) {
          const k = (u - 0.3) / 0.3;
          t.shR.p = -2.7 + 2.2 * k;
          t.elR = 1.4 - 1.2 * k;
          t.torsoPitch += 0.2 * k;
          t.torsoYaw = 0.3 * k;
        } else {
          t.shR.p = -0.5;
          t.elR = 0.3;
        }
      }
    }
    // interaction
    const sinceInt = now - v.interactAt;
    if (sinceInt >= 0 && sinceInt < 0.6) {
      const k = Math.sin((sinceInt / 0.6) * Math.PI);
      t.shR.p = -1.25 * k;
      t.elR = 0.5;
    }
    // recroquevillé
    if (v.anim === Anim.COWER) {
      t.hipL.p = t.hipR.p = -1.15;
      t.knL = t.knR = 2.1;
      t.bob = -0.38;
      t.torsoPitch = 0.55;
      t.shL.p = t.shR.p = -2.5;
      t.elL = t.elR = 2.2;
      t.shL.r = -0.3;
      t.shR.r = 0.3;
      t.headPitch = 0.4;
    }
    // assis (ou au volant : mains sur le manche)
    if (v.anim === Anim.SIT || v.anim === Anim.DRIVE) {
      t.hipL.p = t.hipR.p = -1.5;
      t.knL = t.knR = 1.5;
      t.bob = -0.42;
      t.shL.p = t.shR.p = -0.6;
      t.elL = t.elR = 0.8;
      if (v.anim === Anim.DRIVE) {
        t.shL.p = t.shR.p = -1.05;
        t.elL = t.elR = 0.55;
        t.shL.r = -0.18;
        t.shR.r = 0.18;
      }
    }
    // touché : sursaut
    const sinceHit = now - v.hitAt;
    if (sinceHit >= 0 && sinceHit < 0.4) {
      const k = Math.exp(-sinceHit * 10);
      t.torsoPitch -= 0.32 * k;
      t.headPitch -= 0.3 * k;
      t.torsoRoll += 0.15 * k * (st.seed & 1 ? 1 : -1);
      t.shL.r += 0.3 * k;
      t.shR.r -= 0.3 * k;
    }
    // mort : bras en croix
    if (v.anim === Anim.DEAD) {
      t.shL.p = st.fallDir < 0 ? -1.2 : 0.3;
      t.shR.p = st.fallDir < 0 ? -1.0 : 0.5;
      t.shL.r = 1.1;
      t.shR.r = -0.9;
      t.shL.y = t.shR.y = 0;
      t.elL = 0.3;
      t.elR = 0.6;
      t.knL = 0.4;
      t.knR = 0.1;
      t.hipL.p = -0.25;
      t.hipR.p = 0.1;
      t.headYaw = 0.6;
      t.bob = 0;
      t.carry = 0;
    }
    // lissage (ressort critique simplifié)
    const p = st.pose;
    const a = 1 - Math.exp(-dt * (v.anim === Anim.DEAD ? 6 : 16));
    const fast = 1 - Math.exp(-dt * 28);
    const lerp = (x: number, y: number, f = a) => x + (y - x) * f;
    p.bob = lerp(p.bob, t.bob);
    p.pelvisYaw = lerp(p.pelvisYaw, t.pelvisYaw);
    p.torsoPitch = lerp(p.torsoPitch, t.torsoPitch);
    p.torsoYaw = lerp(p.torsoYaw, t.torsoYaw);
    p.torsoRoll = lerp(p.torsoRoll, t.torsoRoll);
    p.headPitch = lerp(p.headPitch, t.headPitch);
    p.headYaw = lerp(p.headYaw, t.headYaw);
    const armF = v.aiming || sinceShot < 0.25 || sinceMelee < 0.45 ? fast : a;
    p.shL.p = lerp(p.shL.p, t.shL.p, armF);
    p.shL.r = lerp(p.shL.r, t.shL.r, armF);
    p.shL.y = lerp(p.shL.y, t.shL.y, armF);
    p.shR.p = lerp(p.shR.p, t.shR.p, armF);
    p.shR.r = lerp(p.shR.r, t.shR.r, armF);
    p.shR.y = lerp(p.shR.y, t.shR.y, armF);
    p.elL = lerp(p.elL, t.elL, armF);
    p.elR = lerp(p.elR, t.elR, armF);
    p.carry = lerp(p.carry, t.carry, armF);
    // les jambes suivent la phase directement (pas de retard)
    const legF = 1 - Math.exp(-dt * 30);
    p.hipL.p = lerp(p.hipL.p, t.hipL.p, legF);
    p.hipR.p = lerp(p.hipR.p, t.hipR.p, legF);
    p.hipL.r = lerp(p.hipL.r, t.hipL.r, legF);
    p.hipR.r = lerp(p.hipR.r, t.hipR.r, legF);
    p.knL = lerp(p.knL, t.knL, legF);
    p.knR = lerp(p.knR, t.knR, legF);
    p.skirtSway = lerp(p.skirtSway, t.skirtSway);
    // orientation lissée
    st.smoothYaw += angleDiff(st.smoothYaw, v.yaw) * (1 - Math.exp(-dt * 18));
  }

  /** Tourelle : le canon suit le lacet et le site visés, sursaute aux tirs et aux impacts. */
  private animateTurret(v: CharView, st: AnimState, dt: number): void {
    const k = 1 - Math.exp(-dt * 10);
    st.smoothYaw += angleDiff(st.smoothYaw, v.yaw) * k;
    const pitchT = v.anim === Anim.DEAD ? -0.55 : clamp(v.pitch, -0.7, 0.9);
    st.smoothPitch += (pitchT - st.smoothPitch) * (v.anim === Anim.DEAD ? 1 - Math.exp(-dt * 4) : k);
    if (v.shotAt !== st.lastShot) {
      st.lastShot = v.shotAt;
      st.barrel ^= 1;
    }
  }

  // ------------------------------------------------------------------ squelette → matrices

  private euler(m: THREE.Matrix4, px: number, py: number, pz: number, rx: number, ry: number, rz: number): THREE.Matrix4 {
    this.e.set(rx, ry, rz, 'YXZ');
    this.q.setFromEuler(this.e);
    this.v.set(px, py, pz);
    this.s.set(1, 1, 1);
    return m.compose(this.v, this.q, this.s);
  }

  private emit(key: string, m: THREE.Matrix4, st: AnimState, far: boolean): void {
    const pm = this.parts.get(key) ?? this.partMesh(key);
    if (far) {
      if (pm.nFar >= CAPACITY) return;
      m.toArray(pm.far.instanceMatrix.array as Float32Array, pm.nFar * 16);
      (pm.rowsFar.array as Float32Array)[pm.nFar] = st.row;
      (pm.ownFar.array as Float32Array)[pm.nFar] = st.owner;
      pm.nFar++;
    } else {
      if (pm.nNear >= CAPACITY) return;
      m.toArray(pm.near.instanceMatrix.array as Float32Array, pm.nNear * 16);
      (pm.rowsNear.array as Float32Array)[pm.nNear] = st.row;
      (pm.ownNear.array as Float32Array)[pm.nNear] = st.owner;
      pm.nNear++;
    }
  }

  private pose(v: CharView, st: AnimState, far: boolean, now: number): void {
    const p = st.pose;
    const s = st.app.style;
    const K = st.keys;
    const sc = BODY_SCALE * s.scale;
    // racine (avec la chute en cas de mort)
    this.mRoot.makeTranslation(v.x, v.y, v.z);
    this.m0.makeRotationY(st.smoothYaw);
    this.mRoot.multiply(this.m0);
    if (v.anim === Anim.DEAD) {
      const since = Math.max(0, now - v.deathAt);
      const fall = Math.min(1, (since / 0.6) ** 2);
      this.m0.makeRotationX(st.fallDir * HALF_PI * fall * 0.97);
      this.mRoot.multiply(this.m0);
      this.m0.makeTranslation(0, 0.08 * fall, 0);
      this.mRoot.premultiply(this.m0);
    }
    this.m0.makeScale(sc, sc, sc);
    this.mRoot.multiply(this.m0);
    const waist = 34.6 * R;
    const L = (x: number) => x * R;
    // bassin
    this.euler(this.mTmp, 0, waist + p.bob / sc, 0, 0, p.pelvisYaw, 0);
    this.mPelvis.multiplyMatrices(this.mRoot, this.mTmp);
    this.emit(K.pelvis, this.mPelvis, st, far);
    // torse
    this.euler(this.mTmp, 0, 0, 0, p.torsoPitch, p.torsoYaw - p.pelvisYaw, p.torsoRoll);
    this.mTorso.multiplyMatrices(this.mPelvis, this.mTmp);
    this.emit(K.torso, this.mTorso, st, far);
    // tête + couvre-chef
    this.euler(this.mTmp, 0, L(17), 0, p.headPitch, p.headYaw, 0);
    this.mHead.multiplyMatrices(this.mTorso, this.mTmp);
    this.emit(K.head, this.mHead, st, far);
    if (K.hat) this.emit(K.hat, this.mHead, st, far);
    let hv = this.heads.get(v.id);
    if (!hv) this.heads.set(v.id, (hv = new THREE.Vector3()));
    hv.set(0, L(12), 0).applyMatrix4(this.mHead);
    // bras
    this.euler(this.mTmp, L(7.6), L(13.6), 0, p.shL.p, p.shL.y, p.shL.r);
    this.mShL.multiplyMatrices(this.mTorso, this.mTmp);
    this.emit(K.upperArm, this.mShL, st, far);
    this.euler(this.mTmp, 0, L(-10.4), 0, -p.elL, 0, 0);
    this.mFoL.multiplyMatrices(this.mShL, this.mTmp);
    this.emit(K.forearm, this.mFoL, st, far);
    this.euler(this.mTmp, L(-7.6), L(13.6), 0, p.shR.p, -p.shR.y, p.shR.r);
    this.mShR.multiplyMatrices(this.mTorso, this.mTmp);
    this.emit(K.upperArm, this.mShR, st, far);
    this.euler(this.mTmp, 0, L(-10.4), 0, -p.elR, 0, 0);
    this.mFoR.multiplyMatrices(this.mShR, this.mTmp);
    this.emit(K.forearm, this.mFoR, st, far);
    // jambes
    this.euler(this.mTmp, L(3), L(-4), 0, p.hipL.p, 0, p.hipL.r);
    this.mThL.multiplyMatrices(this.mPelvis, this.mTmp);
    this.emit(K.thigh, this.mThL, st, far);
    this.euler(this.mTmp, 0, L(-13.5), 0, p.knL, 0, 0);
    this.mShinL.multiplyMatrices(this.mThL, this.mTmp);
    this.emit(K.shin, this.mShinL, st, far);
    this.euler(this.mTmp, L(-3), L(-4), 0, p.hipR.p, 0, p.hipR.r);
    this.mThR.multiplyMatrices(this.mPelvis, this.mTmp);
    this.emit(K.thigh, this.mThR, st, far);
    this.euler(this.mTmp, 0, L(-13.5), 0, p.knR, 0, 0);
    this.mShinR.multiplyMatrices(this.mThR, this.mTmp);
    this.emit(K.shin, this.mShinR, st, far);
    // pans de manteau : suivent à moitié les cuisses
    if (K.tailL && K.tailR) {
      this.euler(this.mTmp, L(3), L(-4), 0, p.hipL.p * 0.55 + 0.04, 0, 0.06);
      this.m0.multiplyMatrices(this.mPelvis, this.mTmp);
      this.emit(K.tailL, this.m0, st, far);
      this.euler(this.mTmp, L(-3), L(-4), 0, p.hipR.p * 0.55 + 0.04, 0, -0.06);
      this.m0.multiplyMatrices(this.mPelvis, this.mTmp);
      this.emit(K.tailR, this.m0, st, far);
    }
    if (K.skirt) {
      this.euler(this.mTmp, 0, 0, 0, p.skirtSway, 0, p.skirtSway * 0.5);
      this.m0.multiplyMatrices(this.mPelvis, this.mTmp);
      this.emit(K.skirt, this.m0, st, far);
    }
    // arme : dans la main droite ; en visée, alignée sur la direction de tir
    const wkind = WEAPON_KIND[v.weapon];
    let mv = this.muzzle.get(v.id);
    if (!mv) this.muzzle.set(v.id, (mv = new THREE.Vector3()));
    this.v.set(0, L(-11.5), L(0.5)).applyMatrix4(this.mFoR);
    const hx = this.v.x;
    const hy = this.v.y;
    const hz = this.v.z;
    if (wkind && v.anim !== Anim.DEAD) {
      if (v.aiming && v.weapon !== Weapon.KNIFE && v.weapon !== Weapon.CLUB) {
        this.e.set(-v.pitch, st.smoothYaw, 0, 'YXZ');
        this.q.setFromEuler(this.e);
        this.v.set(hx, hy, hz);
        this.s.set(sc, sc, sc);
        this.m0.compose(this.v, this.q, this.s);
      } else if (p.carry > 0.5) {
        // arme longue sur l'épaule : de la main vers le haut et l'arrière, au-dessus de l'épaule
        const yaw = st.smoothYaw + p.torsoYaw;
        const c = Math.cos(yaw);
        const sn = Math.sin(yaw);
        const dx = -0.14;
        const dy = 0.58;
        const dz = -0.8;
        this.v.set(hx + dx * c + dz * sn, hy + dy, hz - dx * sn + dz * c);
        this.vB.set(hx, hy, hz);
        this.m0.identity().lookAt(this.v, this.vB, this.up);
        this.m0.scale(this.s.set(sc, sc, sc));
        this.m0.setPosition(hx, hy, hz);
      } else {
        this.m0.copy(this.mFoR);
        this.euler(this.mTmp, 0, L(-11.5), L(0.5), HALF_PI, 0, 0);
        this.m0.multiply(this.mTmp);
      }
      this.emit(`weapon:${wkind}`, this.m0, st, far);
      // bout du canon
      const mz = P.WEAPON_MUZZLE[wkind];
      this.v.set(L(mz[0]), L(mz[1]), L(mz[2])).applyMatrix4(this.m0);
      mv.copy(this.v);
    } else {
      mv.set(hx, hy, hz);
    }
  }

  /** Tourelle : socle fixe, fourche en lacet, canon en site ; bouche du canon alternée. */
  private poseTurret(v: CharView, st: AnimState, far: boolean, now: number): void {
    const dead = v.anim === Anim.DEAD;
    // socle
    this.mRoot.makeTranslation(v.x, v.y, v.z);
    this.m0.makeRotationY(st.baseYaw);
    this.mRoot.multiply(this.m0);
    this.emit('turret:base', this.mRoot, st, far);
    // sursauts : tir (recul du canon) et impact (secousse)
    const sinceShot = now - v.shotAt;
    const kick = sinceShot >= 0 && sinceShot < 0.2 ? Math.exp(-sinceShot * 30) : 0;
    const sinceHit = now - v.hitAt;
    const jolt = sinceHit >= 0 && sinceHit < 0.4 ? Math.exp(-sinceHit * 12) * Math.sin(sinceHit * 60) * 0.06 : 0;
    // fourche
    const yokeY = P.TURRET_BASE_Y;
    this.euler(this.mTmp, v.x, v.y + yokeY, v.z, 0, st.smoothYaw + jolt, dead ? 0.12 : 0);
    this.mShL.copy(this.mTmp);
    this.emit('turret:yoke', this.mShL, st, far);
    // canon
    this.euler(this.mTmp, 0, P.TURRET_PIVOT_Y - yokeY, -kick * 0.05, -st.smoothPitch + jolt - kick * 0.06, 0, 0);
    this.mHead.multiplyMatrices(this.mShL, this.mTmp);
    this.emit('turret:gun', this.mHead, st, far);
    let hv = this.heads.get(v.id);
    if (!hv) this.heads.set(v.id, (hv = new THREE.Vector3()));
    hv.set(0, 0.25, 0).applyMatrix4(this.mHead);
    let mv = this.muzzle.get(v.id);
    if (!mv) this.muzzle.set(v.id, (mv = new THREE.Vector3()));
    const m = P.TURRET_MUZZLE;
    mv.set(st.barrel ? -m[0] : m[0], m[1], m[2]).applyMatrix4(this.mHead);
  }

  /** Position (monde) de la bouche du canon d'un personnage, si connue. */
  muzzleOf(id: number): THREE.Vector3 | undefined {
    return this.muzzle.get(id);
  }

  dispose(): void {
    for (const pm of this.parts.values()) {
      pm.near.geometry.dispose();
      pm.far.geometry.dispose();
    }
    this.material.dispose();
  }
}
