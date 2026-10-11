// Rendu instancié des personnages (New York, 2085) : membres voxel au 1/64 m (proportions
// réalistes), animés par cinématique inverse (anim.ts). Chaque membre (géométrie) est un
// InstancedMesh partagé par tous les personnages, en trois niveaux de détail (1/64 m de près,
// 1/32 m à moyenne distance, 1/16 m au loin) ; la tenue vient d'une ligne de palette propre à
// chaque personnage (32 couleurs : la tenue et ses nuances), et la couleur des liserés
// lumineux (SLOT.NEON) d'un attribut d'instance. Les tourelles de sécurité (CharKind.TURRET)
// ont leur propre modèle (socle fixe, canon orientable).

import * as THREE from 'three';
import { Anim, CharKind, Weapon } from '../../shared/characters';
import { angleDiff, clamp, hash32 } from '../../shared/util';
import { createObjectMaterial, PALETTE_ROWS, paletteData, paletteTexture } from '../render/voxelObjectMaterial';
import { CharAnim, PART, WEAPON_KIND } from './anim';
import { downsampleChar, meshChar } from './charMesher';
import * as P from './parts';
import { appearanceFor, extendedColors, handKey, lodKey, OUTFIT_ORDER, partKeys, styleParts, type Appearance, type BossCustom, type PartKeys } from './styles';

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

/** Niveaux de détail : 0 = 1/64 m, 1 = 1/32 m, 2 = 1/16 m. */
const TIERS = 3;

interface Tier {
  mesh: THREE.InstancedMesh;
  rows: THREE.InstancedBufferAttribute;
  own: THREE.InstancedBufferAttribute;
  n: number;
  cap: number;
}

interface PartMesh {
  key: string;
  tiers: Tier[];
}

interface CState {
  sig: string;
  app: Appearance;
  keys: PartKeys;
  row: number;
  /** Attribut d'instance aOwner : propriétaire (0..2) + 4 × couleur de néon. */
  owner: number;
  anim: CharAnim | null;
  lastSeen: number;
  // tourelle
  smoothYaw: number;
  smoothPitch: number;
  baseYaw: number;
  barrel: number;
  lastShot: number;
}

const TURRET_KEYS = ['turret:base', 'turret:yoke', 'turret:gun'];
/** Membres omis au niveau de détail le plus lointain (invisibles à cette distance). */
const SKIP_FAR = /^(hand|face|weapon:(knife|phone|grenade|pistol))/;

export class CharacterRenderer {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  private parts = new Map<string, PartMesh>();
  private states = new Map<number, CState>();
  private freeRows: number[] = [];
  private frame = 0;
  private m0 = new THREE.Matrix4();
  private m1 = new THREE.Matrix4();
  private e = new THREE.Euler();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  /** Temps de construction des membres déjà dépensé pendant l'image (ms). */
  private buildMs = 0;
  /** Positions des bouches de canon (ou de la main droite) pour les flammes et traçantes. */
  readonly muzzle = new Map<number, THREE.Vector3>();
  /** Tête des personnages (pour les étiquettes, sang…). */
  readonly heads = new Map<number, THREE.Vector3>();
  /** Distance (m) au-delà de laquelle on passe au 1/32 m, puis au 1/16 m. */
  lodDistance = 26;
  farDistance = 60;
  maxDistance = 110;
  /** Budget de construction de nouveaux membres par image (ms). */
  buildBudget = 12;
  /** Occlusion ambiante conservée par le maillage (voir meshChar ; −1 : aucune). */
  static aoKeep = -1;
  stats = { drawn: 0, instances: 0, quads: 0, meshes: [0, 0, 0] };

  constructor() {
    this.material = createObjectMaterial({ palette: true, key: 'chars' });
    this.group.name = 'personnages';
    for (let i = PALETTE_ROWS - 1; i >= 1; i--) this.freeRows.push(i);
  }

  private makeTier(geo: THREE.BufferGeometry, cap: number, shadows: boolean): Tier {
    const mesh = new THREE.InstancedMesh(geo, this.material, cap);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const rows = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    rows.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aRow', rows);
    const own = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    own.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aOwner', own);
    this.group.add(mesh);
    return { mesh, rows, own, n: 0, cap };
  }

  /** Double la capacité d'un niveau (les instances de l'image courante sont recopiées). */
  private grow(t: Tier): void {
    const cap = t.cap * 2;
    const mat = new Float32Array(cap * 16);
    mat.set(t.mesh.instanceMatrix.array as Float32Array);
    const im = new THREE.InstancedBufferAttribute(mat, 16);
    im.setUsage(THREE.DynamicDrawUsage);
    t.mesh.instanceMatrix = im;
    const rows = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    rows.setUsage(THREE.DynamicDrawUsage);
    (rows.array as Float32Array).set(t.rows.array as Float32Array);
    const own = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    own.setUsage(THREE.DynamicDrawUsage);
    (own.array as Float32Array).set(t.own.array as Float32Array);
    t.mesh.geometry.setAttribute('aRow', rows);
    t.mesh.geometry.setAttribute('aOwner', own);
    t.rows = rows;
    t.own = own;
    t.cap = cap;
    (t.mesh as unknown as { instanceCount?: number }).instanceCount = cap;
  }

  private partMesh(key: string): PartMesh {
    let pm = this.parts.get(key);
    if (pm) return pm;
    const t0 = performance.now();
    const model = P.buildPart(key);
    const mid = downsampleChar(model);
    const far = downsampleChar(mid, 3);
    const ao = CharacterRenderer.aoKeep;
    const geos = [meshChar(model, ao), meshChar(mid, ao), meshChar(far, ao)];
    pm = { key, tiers: geos.map((g, i) => this.makeTier(g, 16, i < 2)) };
    this.parts.set(key, pm);
    this.buildMs += performance.now() - t0;
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
      for (const pose of ['fist', 'flat'] as const) for (const sd of ['L', 'R'] as const) this.partMesh(handKey(partKeys(app.style), pose, sd));
    }
    for (const w of Object.values(WEAPON_KIND)) if (w) this.partMesh(`weapon:${w}`);
    for (const w of ['grenade', 'phone']) this.partMesh(`weapon:${w}`);
    this.buildMs = 0;
  }

  /** Nombre de quads d'un membre à chaque niveau de détail (statistiques, galerie). */
  quadsOf(key: string): number[] {
    return this.partMesh(key).tiers.map((t) => t.mesh.geometry.userData.quads as number);
  }

  private writeRow(row: number, app: Appearance): void {
    const o = app.outfit;
    const ext = extendedColors(o);
    for (let i = 0; i < 32; i++) {
      const c = i < 16 ? (o[OUTFIT_ORDER[i]] as number) : ext[i - 16];
      const k = (row * 32 + i) * 4;
      paletteData[k] = (c >> 16) & 255;
      paletteData[k + 1] = (c >> 8) & 255;
      paletteData[k + 2] = c & 255;
      const bit = i < 16 ? 1 << i : 0;
      paletteData[k + 3] = o.metal && o.metal & bit ? 140 : o.sheen && o.sheen & bit ? 205 : i === 25 ? 200 : 255;
    }
    paletteTexture.needsUpdate = true;
  }

  /** État d'un personnage (null : pas encore prêt, le budget de construction est épuisé). */
  private stateFor(v: CharView): CState | null {
    let st = this.states.get(v.id);
    const sig = `${v.kind}/${v.faction}/${v.look}/${v.gang}/${JSON.stringify(v.custom ?? null)}`;
    if (st && st.sig === sig) return st;
    const app = appearanceFor(v.kind, v.faction, v.look, v.gang, v.custom);
    const turret = v.kind === CharKind.TURRET;
    const parts = turret ? TURRET_KEYS : styleParts(app.style);
    // nouveaux membres à construire : on respecte le budget de l'image
    if (this.buildMs > this.buildBudget && parts.some((p) => !this.parts.has(p))) return st ?? null;
    const row = st ? st.row : this.freeRows.pop() ?? 0;
    this.writeRow(row, app);
    for (const p of parts) this.partMesh(p);
    st = {
      sig,
      app,
      keys: partKeys(app.style),
      row,
      owner: (v.faction === 1 || v.faction === 2 ? v.faction : 0) + 4 * (app.neon & 7),
      anim: turret ? null : new CharAnim(v.id),
      lastSeen: this.frame,
      smoothYaw: v.yaw,
      smoothPitch: v.pitch,
      baseYaw: st?.baseYaw ?? v.yaw,
      barrel: 0,
      lastShot: v.shotAt,
    };
    this.states.set(v.id, st);
    return st;
  }

  /** Dessine la liste des personnages pour cette image. */
  update(views: CharView[], camera: THREE.Camera, now: number, dt: number): void {
    this.frame++;
    this.buildMs = 0;
    for (const pm of this.parts.values()) for (const t of pm.tiers) t.n = 0;
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const camPos = (camera as THREE.PerspectiveCamera).position;
    let drawn = 0;
    const lod1 = this.lodDistance * this.lodDistance;
    const lod2 = this.farDistance * this.farDistance;
    const maxD = this.maxDistance * this.maxDistance;
    for (const v of views) {
      if (v.kind === CharKind.VEHICLE) continue;
      const st = this.stateFor(v);
      if (!st) continue;
      st.lastSeen = this.frame;
      const turret = v.kind === CharKind.TURRET;
      const dx = v.x - camPos.x;
      const dz = v.z - camPos.z;
      const d2 = dx * dx + dz * dz;
      let visible = !v.hidden && d2 <= maxD;
      if (visible) {
        this.sphere.center.set(v.x, v.y + 0.9, v.z);
        this.sphere.radius = v.anim === Anim.DEAD ? 2 : 1.4;
        visible = this.frustum.intersectsSphere(this.sphere);
      }
      const tier = d2 > lod2 ? 2 : d2 > lod1 ? 1 : 0;
      if (turret) {
        this.animateTurret(v, st, dt);
        if (visible) {
          this.poseTurret(v, st, tier, now);
          drawn++;
        }
        continue;
      }
      const an = st.anim!;
      // les personnages hors champ ne sont animés qu'à mi-cadence (leurs repères restent à jour)
      if (!visible && (this.frame + v.id) % 2 === 1 && !this.muzzle.has(v.id)) continue;
      an.update(v, st.app.style, now, dt);
      let mv = this.muzzle.get(v.id);
      if (!mv) this.muzzle.set(v.id, (mv = new THREE.Vector3()));
      mv.copy(an.muzzle);
      let hv = this.heads.get(v.id);
      if (!hv) this.heads.set(v.id, (hv = new THREE.Vector3()));
      hv.copy(an.headPos).y += 0.1;
      if (!visible) continue;
      this.emitChar(st, an, tier);
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
    let quads = 0;
    const meshes = [0, 0, 0];
    for (const pm of this.parts.values()) {
      for (let ti = 0; ti < TIERS; ti++) {
        const t = pm.tiers[ti];
        if (t.n) meshes[ti]++;
        t.mesh.count = t.n;
        // les géométries sans instance ne coûtent rien (ni appel de dessin ni ombre)
        t.mesh.visible = t.n > 0;
        if (t.n) {
          t.mesh.instanceMatrix.needsUpdate = true;
          t.rows.needsUpdate = true;
          t.own.needsUpdate = true;
          inst += t.n;
          quads += t.n * (t.mesh.geometry.userData.quads as number);
        }
      }
    }
    this.stats.drawn = drawn;
    this.stats.instances = inst;
    this.stats.quads = quads;
    this.stats.meshes = meshes;
  }

  private emit(key: string, m: THREE.Matrix4, st: CState, tier: number): void {
    if (tier === 2 && SKIP_FAR.test(key)) return;
    if (tier > 0) key = lodKey(key, tier);
    const pm = this.parts.get(key) ?? this.partMesh(key);
    const t = pm.tiers[tier];
    if (t.n >= t.cap) this.grow(t);
    m.toArray(t.mesh.instanceMatrix.array as Float32Array, t.n * 16);
    (t.rows.array as Float32Array)[t.n] = st.row;
    (t.own.array as Float32Array)[t.n] = st.owner;
    t.n++;
  }

  private emitChar(st: CState, an: CharAnim, tier: number): void {
    const K = st.keys;
    const M = an.mats;
    this.emit(K.pelvis, M[PART.PELVIS], st, tier);
    this.emit(K.torso, M[PART.TORSO], st, tier);
    this.emit(K.head, M[PART.HEAD], st, tier);
    if (K.hair) this.emit(K.hair, M[PART.HEAD], st, tier);
    if (K.hat) this.emit(K.hat, M[PART.HEAD], st, tier);
    if (K.face) this.emit(K.face, M[PART.HEAD], st, tier);
    this.emit(K.uarmL, M[PART.UARM_L], st, tier);
    this.emit(K.uarmR, M[PART.UARM_R], st, tier);
    this.emit(K.farmL, M[PART.FARM_L], st, tier);
    this.emit(K.farmR, M[PART.FARM_R], st, tier);
    this.emit(handKey(K, an.hands[0], 'L'), M[PART.HAND_L], st, tier);
    this.emit(handKey(K, an.hands[1], 'R'), M[PART.HAND_R], st, tier);
    this.emit(K.thighL, M[PART.THIGH_L], st, tier);
    this.emit(K.thighR, M[PART.THIGH_R], st, tier);
    this.emit(K.shinL, M[PART.SHIN_L], st, tier);
    this.emit(K.shinR, M[PART.SHIN_R], st, tier);
    this.emit(K.foot, M[PART.FOOT_L], st, tier);
    this.emit(K.foot, M[PART.FOOT_R], st, tier);
    if (K.tailL && K.tailR) {
      this.emit(K.tailL, M[PART.TAIL_L], st, tier);
      this.emit(K.tailR, M[PART.TAIL_R], st, tier);
    }
    if (K.skirtL && K.skirtR) {
      this.emit(K.skirtL, M[PART.SKIRT_L], st, tier);
      this.emit(K.skirtR, M[PART.SKIRT_R], st, tier);
    }
    if (an.held) this.emit(`weapon:${an.held}`, M[PART.WEAPON], st, tier);
  }

  // ------------------------------------------------------------------ tourelles

  /** Tourelle : le canon suit le lacet et le site visés, sursaute aux tirs et aux impacts. */
  private animateTurret(v: CharView, st: CState, dt: number): void {
    const k = 1 - Math.exp(-dt * 10);
    st.smoothYaw += angleDiff(st.smoothYaw, v.yaw) * k;
    const pitchT = v.anim === Anim.DEAD ? -0.55 : clamp(v.pitch, -0.7, 0.9);
    st.smoothPitch += (pitchT - st.smoothPitch) * (v.anim === Anim.DEAD ? 1 - Math.exp(-dt * 4) : k);
    if (v.shotAt !== st.lastShot) {
      st.lastShot = v.shotAt;
      st.barrel ^= 1;
    }
  }

  private euler(m: THREE.Matrix4, px: number, py: number, pz: number, rx: number, ry: number, rz: number): THREE.Matrix4 {
    this.e.set(rx, ry, rz, 'YXZ');
    this.q.setFromEuler(this.e);
    this.v.set(px, py, pz);
    this.s.set(1, 1, 1);
    return m.compose(this.v, this.q, this.s);
  }

  /** Tourelle : socle fixe, fourche en lacet, canon en site ; bouche du canon alternée. */
  private poseTurret(v: CharView, st: CState, tier: number, now: number): void {
    const dead = v.anim === Anim.DEAD;
    const mRoot = this.m0.makeTranslation(v.x, v.y, v.z);
    mRoot.multiply(this.m1.makeRotationY(st.baseYaw));
    this.emit('turret:base', mRoot, st, Math.min(tier, 1));
    const sinceShot = now - v.shotAt;
    const kick = sinceShot >= 0 && sinceShot < 0.2 ? Math.exp(-sinceShot * 30) : 0;
    const sinceHit = now - v.hitAt;
    const jolt = sinceHit >= 0 && sinceHit < 0.4 ? Math.exp(-sinceHit * 12) * Math.sin(sinceHit * 60) * 0.06 : 0;
    const yoke = this.euler(new THREE.Matrix4(), v.x, v.y + P.TURRET_BASE_Y, v.z, 0, st.smoothYaw + jolt, dead ? 0.12 : 0);
    this.emit('turret:yoke', yoke, st, Math.min(tier, 1));
    const gun = this.euler(this.m1, 0, P.TURRET_PIVOT_Y - P.TURRET_BASE_Y, -kick * 0.05, -st.smoothPitch + jolt - kick * 0.06, 0, 0);
    const mGun = new THREE.Matrix4().multiplyMatrices(yoke, gun);
    this.emit('turret:gun', mGun, st, Math.min(tier, 1));
    let hv = this.heads.get(v.id);
    if (!hv) this.heads.set(v.id, (hv = new THREE.Vector3()));
    hv.set(0, 0.25, 0).applyMatrix4(mGun);
    let mv = this.muzzle.get(v.id);
    if (!mv) this.muzzle.set(v.id, (mv = new THREE.Vector3()));
    const m = P.TURRET_MUZZLE;
    mv.set(st.barrel ? -m[0] : m[0], m[1], m[2]).applyMatrix4(mGun);
  }

  /** Membres dessinés à un niveau de détail lors de la dernière image (statistiques). */
  keysInUse(tier: number): string[] {
    const out: string[] = [];
    for (const pm of this.parts.values()) if (pm.tiers[tier].n) out.push(`${pm.key}×${pm.tiers[tier].n}`);
    return out.sort();
  }

  /** Position (monde) de la bouche du canon d'un personnage, si connue. */
  muzzleOf(id: number): THREE.Vector3 | undefined {
    return this.muzzle.get(id);
  }

  dispose(): void {
    for (const pm of this.parts.values()) for (const t of pm.tiers) t.mesh.geometry.dispose();
    this.material.dispose();
  }
}

void hash32;
