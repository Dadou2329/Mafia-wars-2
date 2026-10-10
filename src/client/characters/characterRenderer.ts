// Rendu instancié des personnages et animation procédurale par membres rigides.
// Chaque membre (géométrie) est un InstancedMesh partagé par tous les personnages ;
// la tenue vient d'une ligne de palette propre à chaque personnage.

import * as THREE from 'three';
import { Anim, CharKind, Weapon } from '../../shared/characters';
import { angleDiff, clamp, hash32 } from '../../shared/util';
import { meshModel, downsample } from '../models/modelMesher';
import type { VoxelModel } from '../models/voxelModel';
import { createObjectMaterial, PALETTE_ROWS, paletteData, paletteTexture } from '../render/voxelObjectMaterial';
import * as P from './parts';
import { appearanceFor, OUTFIT_ORDER, styleParts, type Appearance, type BossCustom, type CharStyle } from './styles';

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

interface Joint {
  x: number;
  y: number;
  z: number;
}

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
}

interface AnimState {
  app: Appearance;
  row: number;
  parts: string[];
  phase: number;
  pose: Pose;
  target: Pose;
  lastSeen: number;
  smoothYaw: number;
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
  nNear: number;
  nFar: number;
}

const CAPACITY = 700;

function buildPart(key: string): VoxelModel {
  const [name, arg] = key.split(':');
  switch (name) {
    case 'torso':
      return P.torso(arg as P.TorsoStyle);
    case 'pelvis':
      return P.pelvis(arg as P.TorsoStyle);
    case 'head':
      return P.head(arg as P.HeadStyle);
    case 'hat':
      return P.hat(arg as P.HatStyle);
    case 'upperArm':
      return arg === 'band' ? P.upperArmBand() : P.upperArm(arg as P.ArmStyle);
    case 'forearm':
      return P.forearm(arg as P.ArmStyle);
    case 'thigh':
      return P.thigh();
    case 'shin':
      return P.shin();
    case 'tailL':
      return P.coatTail(arg as P.TailStyle, 1);
    case 'tailR':
      return P.coatTail(arg as P.TailStyle, -1);
    case 'skirt':
      return P.skirt();
    case 'weapon':
      return P.weaponModel(arg as 'revolver');
    default:
      throw new Error('membre inconnu ' + key);
  }
}

const WEAPON_KEY: Record<Weapon, string | null> = {
  [Weapon.FISTS]: null,
  [Weapon.REVOLVER]: 'weapon:revolver',
  [Weapon.SHOTGUN]: 'weapon:shotgun',
  [Weapon.RIFLE]: 'weapon:rifle',
  [Weapon.KNIFE]: 'weapon:knife',
  [Weapon.CLUB]: 'weapon:club',
};

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
  private s = new THREE.Vector3();
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  /** Positions des mains droites (pour les flammes de bouche). */
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
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const rows = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
      rows.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aRow', rows);
      this.group.add(mesh);
      return { mesh, rows };
    };
    const a = mk(geoNear);
    const b = mk(geoFar);
    pm = { key, near: a.mesh, far: b.mesh, rowsNear: a.rows, rowsFar: b.rows, nNear: 0, nFar: 0 };
    this.parts.set(key, pm);
    return pm;
  }

  /** Précharge les géométries d'un style (évite un à-coup au premier affichage). */
  warm(kinds: { kind: CharKind; faction: number; look: number; gang?: number }[]): void {
    for (const k of kinds) {
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
    if (st && (st as AnimState & { sig?: string }).sig === sig) return st;
    const app = appearanceFor(v.kind, v.faction, v.look, v.gang, v.custom);
    const row = st ? st.row : this.freeRows.pop() ?? 0;
    this.writeRow(row, app);
    const parts = styleParts(app.style);
    const seed = hash32(v.id * 7 + 1);
    st = {
      app,
      row,
      parts,
      phase: (seed % 100) / 16,
      pose: new Pose(),
      target: new Pose(),
      lastSeen: this.frame,
      smoothYaw: v.yaw,
      fallDir: seed % 10 < 7 ? -1 : 1,
      seed,
      idleT: (seed % 1000) / 100,
    };
    (st as AnimState & { sig?: string }).sig = sig;
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
      const st = this.stateFor(v);
      st.lastSeen = this.frame;
      this.animate(v, st, now, dt);
      if (v.hidden) continue;
      const dx = v.x - camPos.x;
      const dz = v.z - camPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > this.maxDistance * this.maxDistance) continue;
      this.sphere.center.set(v.x, v.y + 0.9, v.z);
      this.sphere.radius = v.anim === Anim.DEAD ? 2 : 1.3;
      if (!this.frustum.intersectsSphere(this.sphere)) {
        // on calcule quand même la position de la main pour les effets
        continue;
      }
      const far = d2 > this.lodDistance * this.lodDistance;
      this.pose(v, st, far, now);
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
      if (pm.nNear) {
        pm.near.instanceMatrix.needsUpdate = true;
        pm.rowsNear.needsUpdate = true;
      }
      if (pm.nFar) {
        pm.far.instanceMatrix.needsUpdate = true;
        pm.rowsFar.needsUpdate = true;
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
    const style = st.app.style;
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
    t.elL = 0.18 + run * 1.1 + (0.12 * Math.max(0, -sinp)) * moving;
    t.elR = 0.18 + run * 1.1 + (0.12 * Math.max(0, sinp)) * moving;
    t.headPitch = 0;
    t.headYaw = 0;
    t.skirtSway = 0.05 * sinp * moving;
    // repos : respiration et coups d'œil
    if (speed < 0.2) {
      st.idleT += dt;
      const br = Math.sin(st.idleT * 1.7) * 0.015;
      t.torsoPitch += br;
      t.headYaw = Math.sin(st.idleT * 0.37 + st.seed) * 0.35 * (Math.sin(st.idleT * 0.11) > 0.3 ? 1 : 0.2);
      t.shL.r += br;
      t.shR.r -= br;
      if (v.kind === CharKind.BOSS_DADOU || v.kind === CharKind.LIEUTENANT) {
        // pose assurée : mains derrière le dos / sur la hanche
        t.shR.p = 0.25;
        t.elR = 0.9;
        t.shR.r = -0.25;
      }
    }
    // visée
    const aimP = v.pitch;
    const twoHanded = v.weapon === Weapon.RIFLE || v.weapon === Weapon.SHOTGUN;
    if (v.aiming && (v.weapon === Weapon.REVOLVER || twoHanded)) {
      if (twoHanded) {
        t.shR.p = -HALF_PI * 0.78 - aimP;
        t.shR.r = 0.45;
        t.shR.y = 0.2;
        t.elR = 0.95;
        t.shL.p = -HALF_PI - aimP;
        t.shL.r = -0.32;
        t.elL = 0.25;
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
    // tir : recul
    const sinceShot = now - v.shotAt;
    if (sinceShot >= 0 && sinceShot < 0.25) {
      const k = Math.exp(-sinceShot * 18);
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
    // assis
    if (v.anim === Anim.SIT) {
      t.hipL.p = t.hipR.p = -1.5;
      t.knL = t.knR = 1.5;
      t.bob = -0.42;
      t.shL.p = t.shR.p = -0.6;
      t.elL = t.elR = 0.8;
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
      t.elL = 0.3;
      t.elR = 0.6;
      t.knL = 0.4;
      t.knR = 0.1;
      t.hipL.p = -0.25;
      t.hipR.p = 0.1;
      t.headYaw = 0.6;
      t.bob = 0;
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
    void style;
  }

  // ------------------------------------------------------------------ squelette → matrices

  private euler(m: THREE.Matrix4, px: number, py: number, pz: number, rx: number, ry: number, rz: number): THREE.Matrix4 {
    this.e.set(rx, ry, rz, 'YXZ');
    this.q.setFromEuler(this.e);
    this.v.set(px, py, pz);
    this.s.set(1, 1, 1);
    return m.compose(this.v, this.q, this.s);
  }

  private emit(key: string, m: THREE.Matrix4, row: number, far: boolean): void {
    const pm = this.parts.get(key) ?? this.partMesh(key);
    if (far) {
      if (pm.nFar >= CAPACITY) return;
      m.toArray(pm.far.instanceMatrix.array as Float32Array, pm.nFar * 16);
      (pm.rowsFar.array as Float32Array)[pm.nFar] = row;
      pm.nFar++;
    } else {
      if (pm.nNear >= CAPACITY) return;
      m.toArray(pm.near.instanceMatrix.array as Float32Array, pm.nNear * 16);
      (pm.rowsNear.array as Float32Array)[pm.nNear] = row;
      pm.nNear++;
    }
  }

  private pose(v: CharView, st: AnimState, far: boolean, now: number): void {
    const p = st.pose;
    const s = st.app.style;
    const sc = BODY_SCALE * s.scale;
    const row = st.row;
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
    this.emit(`pelvis:${s.torso}`, this.mPelvis, row, far);
    // torse
    this.euler(this.mTmp, 0, 0, 0, p.torsoPitch, p.torsoYaw - p.pelvisYaw, p.torsoRoll);
    this.mTorso.multiplyMatrices(this.mPelvis, this.mTmp);
    this.emit(`torso:${s.torso}`, this.mTorso, row, far);
    // tête + chapeau
    this.euler(this.mTmp, 0, L(17), 0, p.headPitch, p.headYaw, 0);
    this.mHead.multiplyMatrices(this.mTorso, this.mTmp);
    this.emit(`head:${s.head}`, this.mHead, row, far);
    if (s.hat !== 'none') this.emit(`hat:${s.hat}`, this.mHead, row, far);
    let hv = this.heads.get(v.id);
    if (!hv) this.heads.set(v.id, (hv = new THREE.Vector3()));
    hv.set(0, L(12), 0).applyMatrix4(this.mHead);
    // bras
    const ua = s.armband ? 'upperArm:band' : `upperArm:${s.arm}`;
    this.euler(this.mTmp, L(7.6), L(13.6), 0, p.shL.p, p.shL.y, p.shL.r);
    this.mShL.multiplyMatrices(this.mTorso, this.mTmp);
    this.emit(ua, this.mShL, row, far);
    this.euler(this.mTmp, 0, L(-10.4), 0, -p.elL, 0, 0);
    this.mFoL.multiplyMatrices(this.mShL, this.mTmp);
    this.emit(`forearm:${s.arm}`, this.mFoL, row, far);
    this.euler(this.mTmp, L(-7.6), L(13.6), 0, p.shR.p, -p.shR.y, p.shR.r);
    this.mShR.multiplyMatrices(this.mTorso, this.mTmp);
    this.emit(ua, this.mShR, row, far);
    this.euler(this.mTmp, 0, L(-10.4), 0, -p.elR, 0, 0);
    this.mFoR.multiplyMatrices(this.mShR, this.mTmp);
    this.emit(`forearm:${s.arm}`, this.mFoR, row, far);
    // jambes
    this.euler(this.mTmp, L(3), L(-4), 0, p.hipL.p, 0, p.hipL.r);
    this.mThL.multiplyMatrices(this.mPelvis, this.mTmp);
    this.emit('thigh', this.mThL, row, far);
    this.euler(this.mTmp, 0, L(-13.5), 0, p.knL, 0, 0);
    this.mShinL.multiplyMatrices(this.mThL, this.mTmp);
    this.emit('shin', this.mShinL, row, far);
    this.euler(this.mTmp, L(-3), L(-4), 0, p.hipR.p, 0, p.hipR.r);
    this.mThR.multiplyMatrices(this.mPelvis, this.mTmp);
    this.emit('thigh', this.mThR, row, far);
    this.euler(this.mTmp, 0, L(-13.5), 0, p.knR, 0, 0);
    this.mShinR.multiplyMatrices(this.mThR, this.mTmp);
    this.emit('shin', this.mShinR, row, far);
    // pans de manteau : suivent à moitié les cuisses
    if (s.tail !== 'none') {
      this.euler(this.mTmp, L(3), L(-4), 0, p.hipL.p * 0.55 + 0.04, 0, 0.06);
      this.m0.multiplyMatrices(this.mPelvis, this.mTmp);
      this.emit(`tailL:${s.tail}`, this.m0, row, far);
      this.euler(this.mTmp, L(-3), L(-4), 0, p.hipR.p * 0.55 + 0.04, 0, -0.06);
      this.m0.multiplyMatrices(this.mPelvis, this.mTmp);
      this.emit(`tailR:${s.tail}`, this.m0, row, far);
    }
    if (s.skirt) {
      this.euler(this.mTmp, 0, 0, 0, p.skirtSway, 0, p.skirtSway * 0.5);
      this.m0.multiplyMatrices(this.mPelvis, this.mTmp);
      this.emit('skirt', this.m0, row, far);
    }
    // arme : dans la main droite ; en visée, alignée sur la direction de tir
    const wk = WEAPON_KEY[v.weapon];
    let mv = this.muzzle.get(v.id);
    if (!mv) this.muzzle.set(v.id, (mv = new THREE.Vector3()));
    this.v.set(0, L(-11.5), L(0.5)).applyMatrix4(this.mFoR);
    const hx = this.v.x;
    const hy = this.v.y;
    const hz = this.v.z;
    if (wk && v.anim !== Anim.DEAD) {
      if (v.aiming && v.weapon !== Weapon.KNIFE && v.weapon !== Weapon.CLUB) {
        this.e.set(-v.pitch, st.smoothYaw, 0, 'YXZ');
        this.q.setFromEuler(this.e);
        this.v.set(hx, hy, hz);
        this.s.set(sc, sc, sc);
        this.m0.compose(this.v, this.q, this.s);
      } else {
        this.m0.copy(this.mFoR);
        this.euler(this.mTmp, 0, L(-11.5), L(0.5), HALF_PI, 0, 0);
        this.m0.multiply(this.mTmp);
      }
      this.emit(wk, this.m0, row, far);
      // bout du canon
      const len = v.weapon === Weapon.RIFLE ? 40 : v.weapon === Weapon.SHOTGUN ? 34 : 10;
      this.v.set(0, L(4), L(len)).applyMatrix4(this.m0);
      mv.copy(this.v);
    } else {
      mv.set(hx, hy, hz);
    }
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
