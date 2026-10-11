// Rendu instancié des personnages (New York, 2085) : membres voxel au 1/64 m (proportions
// réalistes), animés par cinématique inverse (anim.ts). Chaque membre (géométrie) est un
// InstancedMesh partagé par tous les personnages, en trois niveaux de détail (1/64 m de près,
// 1/32 m à moyenne distance, 1/16 m au loin) ; la tenue vient d'une ligne de palette propre à
// chaque personnage (32 couleurs : la tenue et ses nuances), et la couleur des liserés
// lumineux (SLOT.NEON) d'un attribut d'instance. Les tourelles de sécurité (CharKind.TURRET)
// ont leur propre modèle (socle fixe, canon orientable).
//
// Implants cybernétiques (cyber.ts, partsCyber.ts) : avant-bras et mains mécaniques, pièces des
// jambes, du torse, de la colonne et de la tête, pièces mobiles (plaques, canon, lame, vérins,
// nacelle, crochet, sondes, filament du fouet) ; les clés de membres sont partagées par tous les
// personnages qui portent les mêmes implants et construites dans le budget de l'image. Les
// lueurs (canaux GLOW_CH), les iris et la peau traitée sont pilotés par une texture d'état par
// personnage (charMaterial.ts). Passes dédiées : camouflage optique (réfraction de l'image) et
// silhouettes thermiques à travers les murs (setXray) ; modes de vision (setVision).

import * as THREE from 'three';
import { Anim, CharKind, Weapon } from '../../shared/characters';
import { CFX, type SlotId } from '../../shared/implants';
import { angleDiff, clamp, hash32 } from '../../shared/util';
import { PALETTE_ROWS, paletteData, paletteTexture } from '../render/voxelObjectMaterial';
import { CharAnim, PART, WEAPON_KIND, WHIP_SEGS, type CyArmState } from './anim';
import { createCamoMaterial, createCharMaterial, createXrayMaterial, CyberShaderData, type VisionMode } from './charMaterial';
import { downsampleChar, meshChar } from './charMesher';
import { armImplant, cyberKeyList, cyberKeys, cyberSpec, EYE_GLOW, GLOW_CH, regionOfSlot, SKIN_MODE, type BodyRegion, type CyberKeys, type CyberSpec } from './cyber';
import * as P from './parts';
import { MANTIS_SLIDE, podHinges, VIPER_HINGE, VIPER_SLIDE } from './partsCyber';
import { RES } from './rig';
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
  /** Surbrillance (cible visée, membre de l'escouade) : 0..1, liseré pulsé sur tout le corps. */
  highlight?: number;
  /** Implants visibles : « emplacement=identifiant:niveau » (voir shared/implants.ts, parseCyberLook). */
  cyber?: string[];
  /** États cybernétiques visibles (bits CFX : grappin, bouclier, camouflage, arme de bras sortie…). */
  fx?: number;
  /**
   * Dernière capacité ponctuelle (animation) : kind = identifiant d'implant ou d'effet de
   * l'événement « ab » ('repulseur', 'choc', 'roquettes', 'grappin'…), at = instant (s, horloge
   * client), side = bras utilisé ('L' ou 'R') ; dir = direction visée (grappin : point d'ancrage).
   */
  ab?: { kind: string; at: number; side?: 'L' | 'R'; x?: number; y?: number; z?: number };
}

/** Niveaux de détail : 0 = 1/64 m, 1 = 1/32 m, 2 = 1/16 m. */
const TIERS = 3;

interface Tier {
  mesh: THREE.InstancedMesh;
  rows: THREE.InstancedBufferAttribute;
  own: THREE.InstancedBufferAttribute;
  /** aFx : surbrillance, camouflage (0..1). */
  fx: THREE.InstancedBufferAttribute;
  n: number;
  cap: number;
}

interface PartMesh {
  key: string;
  tiers: Tier[];
  /** Passe du camouflage optique et silhouettes thermiques (créées à la demande). */
  camo?: Tier[];
  xray?: Tier[];
  /** Dernière image où le membre a servi (éviction des pièces d'implants inutilisées). */
  used: number;
}

interface CyState {
  spec: CyberSpec;
  keys: CyberKeys;
  sig: string;
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
  // implants
  cy: CyState | null;
  cyPending: CyState | null;
  /** Signature de la dernière apparence cybernétique demandée. */
  cyWant: string;
  /** Camouflage optique (0 visible … 1 invisible). */
  camo: number;
  glowSet: boolean;
}

const TURRET_KEYS = ['turret:base', 'turret:yoke', 'turret:gun'];
/** Membres omis au niveau de détail le plus lointain (invisibles à cette distance). */
const SKIP_FAR = /^(hand|face|weapon:(knife|phone|grenade|pistol)|cyhand|cyhead|cyleg:foot|cymov:(pistoletBras|poing|grappin|outils|bouclier))/;
/** Segment du filament du fouet (toujours au niveau de détail le plus fin : trop fin pour être réduit). */
const WHIP_KEY = 'cymov:fouet:seg';
/** Poses des mains mécaniques préconstruites. */
const HAND_POSES = ['relax', 'fist', 'grip', 'flat'];

/** Lignes de palette libres, communes à tous les rendus (jeu, portraits, aperçu de l'équipement). */
const ROW_POOL: number[] = [];
for (let i = PALETTE_ROWS - 1; i >= 1; i--) ROW_POOL.push(i);

const _m = new THREE.Matrix4();
const _mL = new THREE.Matrix4();
const _mS = new THREE.Matrix4().makeScale(-1, 1, 1);
const _t1 = new THREE.Matrix4();
const _t2 = new THREE.Matrix4();
const _pv = new THREE.Vector3();

export class CharacterRenderer {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  /** Données de shader des implants (texture d'état, vision, copie de l'image). */
  readonly cyber = new CyberShaderData();
  private camoMaterial: THREE.MeshLambertMaterial;
  private xrayMaterial: THREE.ShaderMaterial;
  private parts = new Map<string, PartMesh>();
  private states = new Map<number, CState>();
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
  /** Contexte d'émission : passe (0 normale, 1 camouflage), surbrillance, camouflage, silhouette thermique. */
  private ePass = 0;
  private eHl = 0;
  private eCamo = 0;
  private eXray = false;
  private hlRegion = new Map<number, BodyRegion>();
  private xray: Set<number> | null = null;
  /** Positions des bouches de canon (ou de la main droite) pour les flammes et traçantes. */
  readonly muzzle = new Map<number, THREE.Vector3>();
  /** Tête des personnages (pour les étiquettes, sang…). */
  readonly heads = new Map<number, THREE.Vector3>();
  /** Mains (gauche, droite) des personnages. */
  private handsW = new Map<number, [THREE.Vector3, THREE.Vector3]>();
  /** Distance (m) au-delà de laquelle on passe au 1/32 m, puis au 1/16 m. */
  lodDistance = 26;
  farDistance = 60;
  maxDistance = 110;
  /** Budget de construction de nouveaux membres par image (ms). */
  buildBudget = 12;
  /** Occlusion ambiante conservée par le maillage (voir meshChar ; −1 : aucune). */
  static aoKeep = -1;
  stats = { drawn: 0, instances: 0, quads: 0, meshes: [0, 0, 0], camo: 0, xray: 0 };

  constructor() {
    this.material = createCharMaterial(this.cyber, 'chars');
    this.camoMaterial = createCamoMaterial(this.cyber, 'chars');
    this.xrayMaterial = createXrayMaterial();
    this.group.name = 'personnages';
  }

  // ------------------------------------------------------------------ API publique (implants)

  /**
   * Mode de vision des personnages : 'thermal' (signatures de chaleur sans éclairage, les
   * camouflés restent à peine visibles), 'night' (personnages plus lisibles), 'normal'.
   */
  setVision(mode: VisionMode): void {
    this.cyber.setVision(mode);
  }

  /** Personnages vus en silhouette thermique à travers les murs (null : aucun). */
  setXray(ids: Set<number> | null): void {
    this.xray = ids && ids.size ? ids : null;
  }

  /** Surbrillance d'une région du corps d'un personnage (écran d'équipement), ou null. */
  highlightRegion(id: number, region: BodyRegion | SlotId | null): void {
    if (!region) this.hlRegion.delete(id);
    else this.hlRegion.set(id, (['armL', 'armR', 'legs', 'torso', 'spine', 'head', 'skin', 'all'] as string[]).includes(region) ? (region as BodyRegion) : regionOfSlot(region));
  }

  /** Couleur de la surbrillance (sRGB). */
  setHighlightColor(rgb: number): void {
    this.cyber.uniforms.uHlColor.value.setHex(rgb);
  }

  /** Position monde d'une main ('L' gauche, 'R' droite) d'un personnage, si connue. */
  handOf(id: number, side: 'L' | 'R'): THREE.Vector3 | null {
    const h = this.handsW.get(id);
    return h ? h[side === 'L' ? 0 : 1] : null;
  }

  /**
   * Bout du lanceur du grappin d'un personnage (départ du câble). Côté : celui indiqué, sinon
   * le bras qui porte le grappin ; à défaut, la main.
   */
  launcherTip(id: number, side?: 'L' | 'R'): THREE.Vector3 | null {
    const st = this.states.get(id);
    const an = st?.anim;
    if (!st || !an) return null;
    const spec = st.cy?.spec ?? null;
    let i = side === 'L' ? 0 : side === 'R' ? 1 : armImplant(spec, 0) === 'grappin' ? 0 : armImplant(spec, 1) === 'grappin' ? 1 : -1;
    if (i < 0) i = 0;
    if (armImplant(spec, i) === 'grappin') return an.grappleTips[i];
    return this.handOf(id, i === 0 ? 'L' : 'R');
  }

  /** États des pièces mobiles des bras mécaniques d'un personnage (gauche, droite). */
  cyberArms(id: number): [CyArmState, CyArmState] | null {
    return this.states.get(id)?.anim?.cyArm ?? null;
  }

  // ------------------------------------------------------------------ construction

  private makeTier(geo: THREE.BufferGeometry, cap: number, shadows: boolean, material: THREE.Material = this.material): Tier {
    const mesh = new THREE.InstancedMesh(geo, material, cap);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = shadows;
    mesh.receiveShadow = material === this.material;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const rows = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    rows.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aRow', rows);
    const own = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    own.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aOwner', own);
    const fx = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    fx.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFx', fx);
    this.group.add(mesh);
    return { mesh, rows, own, fx, n: 0, cap };
  }

  /** Géométrie qui partage les sommets d'une autre (passes du camouflage et des silhouettes). */
  private shareGeo(src: THREE.BufferGeometry): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color', 'aExt']) g.setAttribute(name, src.getAttribute(name));
    g.setIndex(src.getIndex());
    g.setDrawRange(src.drawRange.start, src.drawRange.count);
    g.boundingSphere = src.boundingSphere;
    g.userData.quads = src.userData.quads;
    return g;
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
    const fx = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    fx.setUsage(THREE.DynamicDrawUsage);
    (fx.array as Float32Array).set(t.fx.array as Float32Array);
    t.mesh.geometry.setAttribute('aRow', rows);
    t.mesh.geometry.setAttribute('aOwner', own);
    t.mesh.geometry.setAttribute('aFx', fx);
    t.rows = rows;
    t.own = own;
    t.fx = fx;
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
    pm = { key, tiers: geos.map((g, i) => this.makeTier(g, key.startsWith('cy') ? 4 : 16, i < 2)), used: this.frame };
    this.parts.set(key, pm);
    this.buildMs += performance.now() - t0;
    return pm;
  }

  /** Précharge les géométries d'un style (évite un à-coup au premier affichage). */
  warm(kinds: { kind: CharKind; faction: number; look: number; gang?: number; cyber?: string[] }[]): void {
    for (const k of kinds) {
      if (k.kind === CharKind.TURRET) {
        for (const p of TURRET_KEYS) this.partMesh(p);
        continue;
      }
      const app = appearanceFor(k.kind, k.faction, k.look, k.gang ?? 0);
      for (const p of styleParts(app.style)) this.partMesh(p);
      for (const pose of ['fist', 'flat'] as const) for (const sd of ['L', 'R'] as const) this.partMesh(handKey(partKeys(app.style), pose, sd));
      const spec = cyberSpec(k.cyber);
      if (spec) for (const p of cyberKeyList(this.cyKeysFor(spec, app, partKeys(app.style)), HAND_POSES)) this.partMesh(p);
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

  /** Clés des implants d'une silhouette. */
  private cyKeysFor(spec: CyberSpec, app: Appearance, K: PartKeys): CyberKeys {
    const s = app.style;
    const bare = s.sleeve === 'bare' || s.sleeve === 'tee' || s.sleeve === 'rolled';
    return cyberKeys(spec, s.build, K.torso.split(':')[1], bare, s.face === 'monocle' ? 'm' : '', s.tail !== 'none' || s.skirt !== 'none');
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
    const row = st ? st.row : ROW_POOL.pop() ?? 0;
    this.writeRow(row, app);
    for (const p of parts) this.partMesh(p);
    st = {
      sig,
      app,
      keys: partKeys(app.style),
      row,
      owner: (v.faction === 1 || v.faction === 2 ? v.faction : 0) + 4 * (app.neon & 7),
      anim: turret ? null : st?.anim ?? new CharAnim(v.id),
      lastSeen: this.frame,
      smoothYaw: v.yaw,
      smoothPitch: v.pitch,
      baseYaw: st?.baseYaw ?? v.yaw,
      barrel: 0,
      lastShot: v.shotAt,
      cy: null,
      cyPending: null,
      cyWant: '',
      camo: st?.camo ?? 0,
      glowSet: st?.glowSet ?? false,
    };
    this.states.set(v.id, st);
    return st;
  }

  /**
   * Implants d'un personnage : la nouvelle apparence n'est adoptée qu'une fois toutes ses pièces
   * construites (dans le budget de l'image) ; en attendant, l'ancienne reste affichée.
   */
  private updateCyber(st: CState, v: CharView): void {
    const want = v.cyber && v.cyber.length ? v.cyber.join(',') : '';
    if (want !== st.cyWant) {
      st.cyWant = want;
      const spec = cyberSpec(v.cyber);
      if (!spec) {
        st.cy = null;
        st.cyPending = null;
      } else {
        const keys = this.cyKeysFor(spec, st.app, st.keys);
        st.cyPending = { spec, keys, sig: spec.sig };
      }
    }
    const p = st.cyPending;
    if (!p) return;
    for (const key of cyberKeyList(p.keys, HAND_POSES)) {
      if (this.parts.has(key)) continue;
      if (this.buildMs > this.buildBudget) return;
      this.partMesh(key);
    }
    st.cy = p;
    st.cyPending = null;
  }

  /** Dessine la liste des personnages pour cette image. */
  update(views: CharView[], camera: THREE.Camera, now: number, dt: number): void {
    this.frame++;
    this.buildMs = 0;
    this.cyber.frameId = this.frame;
    for (const pm of this.parts.values()) {
      for (const t of pm.tiers) t.n = 0;
      if (pm.camo) for (const t of pm.camo) t.n = 0;
      if (pm.xray) for (const t of pm.xray) t.n = 0;
    }
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const camPos = (camera as THREE.PerspectiveCamera).position;
    let drawn = 0;
    const lod1 = this.lodDistance * this.lodDistance;
    const lod2 = this.farDistance * this.farDistance;
    const maxD = this.maxDistance * this.maxDistance;
    this.xrayMaterial.uniforms.uTime.value = now;
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
      const xr = !!this.xray && this.xray.has(v.id) && !v.hidden && d2 <= maxD;
      const tier = d2 > lod2 ? 2 : d2 > lod1 ? 1 : 0;
      if (turret) {
        this.animateTurret(v, st, dt);
        if (visible || xr) {
          this.eHl = clamp(v.highlight ?? 0, 0, 1);
          this.ePass = 0;
          this.eCamo = 0;
          this.eXray = xr;
          this.poseTurret(v, st, tier, now, visible);
          drawn++;
        }
        continue;
      }
      const an = st.anim!;
      this.updateCyber(st, v);
      // camouflage optique : bascule progressive (cellules qui s'éteignent une à une)
      const camoOn = ((v.fx ?? 0) & CFX.CAMO) !== 0 && v.anim !== Anim.DEAD;
      st.camo = clamp(st.camo + (camoOn ? dt / 0.7 : -dt / 0.45), 0, 1);
      // les personnages hors champ ne sont animés qu'à mi-cadence (leurs repères restent à jour)
      if (!visible && !xr && (this.frame + v.id) % 2 === 1 && !this.muzzle.has(v.id)) continue;
      an.setCyber(st.cy?.spec ?? null);
      an.update(v, st.app.style, now, dt);
      let mv = this.muzzle.get(v.id);
      if (!mv) this.muzzle.set(v.id, (mv = new THREE.Vector3()));
      mv.copy(an.muzzle);
      let hv = this.heads.get(v.id);
      if (!hv) this.heads.set(v.id, (hv = new THREE.Vector3()));
      hv.copy(an.headPos).y += 0.1;
      let hw = this.handsW.get(v.id);
      if (!hw) this.handsW.set(v.id, (hw = [new THREE.Vector3(), new THREE.Vector3()]));
      // centre de la paume (≈ 6 voxels sous le poignet)
      hw[0].set(0, -6 * RES, 0).applyMatrix4(an.mats[PART.HAND_L]);
      hw[1].set(0, -6 * RES, 0).applyMatrix4(an.mats[PART.HAND_R]);
      this.cyberGlow(st, v, an, now);
      if (!visible && !xr) continue;
      this.ePass = st.camo > 0.001 ? 1 : 0;
      this.eCamo = st.camo;
      this.eXray = xr;
      this.emitChar(st, an, tier, v, visible);
      drawn++;
    }
    this.cyber.flush();
    // libère les états des personnages disparus
    if (this.frame % 60 === 0) {
      for (const [id, st] of this.states) {
        if (this.frame - st.lastSeen > 120) {
          this.states.delete(id);
          if (st.row > 0) {
            ROW_POOL.push(st.row);
            this.cyber.clearRow(st.row);
          }
          this.muzzle.delete(id);
          this.heads.delete(id);
          this.handsW.delete(id);
        }
      }
      this.evict();
    }
    let inst = 0;
    let quads = 0;
    let camoN = 0;
    let xrayN = 0;
    const meshes = [0, 0, 0];
    const finish = (t: Tier) => {
      t.mesh.count = t.n;
      // les géométries sans instance ne coûtent rien (ni appel de dessin ni ombre)
      t.mesh.visible = t.n > 0;
      if (t.n) {
        t.mesh.instanceMatrix.needsUpdate = true;
        t.rows.needsUpdate = true;
        t.own.needsUpdate = true;
        t.fx.needsUpdate = true;
        inst += t.n;
        quads += t.n * (t.mesh.geometry.userData.quads as number);
      }
    };
    for (const pm of this.parts.values()) {
      for (let ti = 0; ti < TIERS; ti++) {
        const t = pm.tiers[ti];
        if (t.n) meshes[ti]++;
        finish(t);
        if (pm.camo) {
          camoN += pm.camo[ti].n;
          finish(pm.camo[ti]);
        }
        if (pm.xray) {
          xrayN += pm.xray[ti].n;
          finish(pm.xray[ti]);
        }
      }
    }
    this.stats.drawn = drawn;
    this.stats.instances = inst;
    this.stats.quads = quads;
    this.stats.meshes = meshes;
    this.stats.camo = camoN;
    this.stats.xray = xrayN;
  }

  /** Libère les pièces d'implants inutilisées depuis longtemps (≈ 30 s). */
  private evict(): void {
    for (const [key, pm] of this.parts) {
      if (!key.startsWith('cy') || this.frame - pm.used < 1800) continue;
      let busy = false;
      for (const st of this.states.values()) if (st.cyPending || (st.cy && cyberKeyList(st.cy.keys, HAND_POSES).includes(key))) busy = true;
      if (busy) {
        pm.used = this.frame;
        continue;
      }
      for (const list of [pm.tiers, pm.camo, pm.xray]) {
        if (!list) continue;
        for (const t of list) {
          t.mesh.removeFromParent();
          t.mesh.dispose();
          t.mesh.geometry.dispose();
        }
      }
      this.parts.delete(key);
    }
  }

  private tierOf(pm: PartMesh, pass: 'camo' | 'xray', ti: number): Tier {
    let list = pm[pass];
    if (!list) {
      const mat = pass === 'camo' ? this.camoMaterial : this.xrayMaterial;
      list = pm.tiers.map((t) => {
        const tier = this.makeTier(this.shareGeo(t.mesh.geometry), 2, false, mat);
        tier.mesh.renderOrder = pass === 'camo' ? 40 : 60;
        if (pass === 'camo') tier.mesh.onBeforeRender = (renderer) => this.cyber.copyScene(renderer);
        return tier;
      });
      pm[pass] = list;
    }
    return list[ti];
  }

  private put(t: Tier, m: THREE.Matrix4, st: CState): void {
    if (t.n >= t.cap) this.grow(t);
    m.toArray(t.mesh.instanceMatrix.array as Float32Array, t.n * 16);
    (t.rows.array as Float32Array)[t.n] = st.row;
    (t.own.array as Float32Array)[t.n] = st.owner;
    const f = t.fx.array as Float32Array;
    f[t.n * 2] = this.eHl;
    f[t.n * 2 + 1] = this.eCamo;
    t.n++;
  }

  private emit(key: string, m: THREE.Matrix4, st: CState, tier: number, visible = true): void {
    if (key === WHIP_KEY) tier = 0;
    if (tier === 2 && SKIP_FAR.test(key)) return;
    if (tier > 0) key = lodKey(key, tier);
    const pm = this.parts.get(key) ?? this.partMesh(key);
    pm.used = this.frame;
    if (visible) this.put(this.ePass === 1 ? this.tierOf(pm, 'camo', tier) : pm.tiers[tier], m, st);
    // silhouette thermique à travers les murs (niveau de détail moyen suffisant)
    if (this.eXray) this.put(this.tierOf(pm, 'xray', Math.max(tier, 1)), m, st);
  }

  /** Surbrillance d'une région : valeur d'émission courante. */
  private hlFor(st: CState, id: number, region: BodyRegion, base: number): number {
    const r = this.hlRegion.get(id);
    if (!r) return base;
    if (r === 'all' || r === region) return Math.max(base, 1);
    if (r === 'skin' && (region === 'head' || region === 'armL' || region === 'armR')) return Math.max(base, 0.8);
    if (r === 'spine' && region === 'torso') return Math.max(base, 0.6);
    void st;
    return base;
  }

  private emitChar(st: CState, an: CharAnim, tier: number, v: CharView, visible: boolean): void {
    const K = st.keys;
    const M = an.mats;
    const C = st.cy?.keys ?? null;
    const id = v.id;
    const base = clamp(v.highlight ?? 0, 0, 1);
    this.eHl = this.hlFor(st, id, 'torso', base);
    this.emit(K.pelvis, M[PART.PELVIS], st, tier, visible);
    this.eHl = this.hlFor(st, id, 'spine', this.hlFor(st, id, 'torso', base));
    this.emit(K.torso, M[PART.TORSO], st, tier, visible);
    if (C?.torso) this.emit(C.torso, M[PART.TORSO], st, tier, visible);
    this.eHl = this.hlFor(st, id, 'head', base);
    this.emit(K.head, M[PART.HEAD], st, tier, visible);
    if (K.hair) this.emit(K.hair, M[PART.HEAD], st, tier, visible);
    if (K.hat) this.emit(K.hat, M[PART.HEAD], st, tier, visible);
    if (K.face) this.emit(K.face, M[PART.HEAD], st, tier, visible);
    if (C?.head) this.emit(C.head, M[PART.HEAD], st, tier, visible);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 'L' : 'R';
      this.eHl = this.hlFor(st, id, i === 0 ? 'armL' : 'armR', base);
      this.emit(i === 0 ? K.uarmL : K.uarmR, M[PART.UARM_L + i], st, tier, visible);
      const farm = C?.farm[i];
      if (farm) {
        this.emit(farm, M[PART.FARM_L + i], st, tier, visible);
        this.emit(C!.hand[i]!.replace('%', an.hands[i]), M[PART.HAND_L + i], st, tier, visible);
        const impl = armImplant(st.cy!.spec, i);
        for (const [piece, key] of C!.mov[i]) {
          if (!impl || !this.movLocal(impl, piece, an.cyArm[i], st.app.style.build, i === 1, _mL)) continue;
          _m.multiplyMatrices(M[PART.FARM_L + i], _mL);
          this.emit(key, _m, st, tier, visible);
        }
        if (C!.whip && impl === 'fouet' && an.whipN > 0) for (let k = 0; k < an.whipN && k < WHIP_SEGS; k++) this.emit(C!.whip, an.whipMats[k], st, tier, visible);
      } else {
        this.emit(i === 0 ? K.farmL : K.farmR, M[PART.FARM_L + i], st, tier, visible);
        this.emit(handKey(K, an.hands[i], side), M[PART.HAND_L + i], st, tier, visible);
      }
    }
    this.eHl = this.hlFor(st, id, 'legs', base);
    this.emit(K.thighL, M[PART.THIGH_L], st, tier, visible);
    this.emit(K.thighR, M[PART.THIGH_R], st, tier, visible);
    this.emit(K.shinL, M[PART.SHIN_L], st, tier, visible);
    this.emit(K.shinR, M[PART.SHIN_R], st, tier, visible);
    this.emit(K.foot, M[PART.FOOT_L], st, tier, visible);
    this.emit(K.foot, M[PART.FOOT_R], st, tier, visible);
    if (C) {
      for (let i = 0; i < 2; i++) {
        if (C.thigh[i]) this.emit(C.thigh[i]!, M[PART.THIGH_L + i], st, tier, visible);
        if (C.shin[i]) this.emit(C.shin[i]!, M[PART.SHIN_L + i], st, tier, visible);
        if (C.foot) this.emit(C.foot, M[PART.FOOT_L + i], st, tier, visible);
      }
    }
    this.eHl = this.hlFor(st, id, 'legs', this.hlFor(st, id, 'torso', base) * 0.5);
    if (K.tailL && K.tailR) {
      this.emit(K.tailL, M[PART.TAIL_L], st, tier, visible);
      this.emit(K.tailR, M[PART.TAIL_R], st, tier, visible);
    }
    if (K.skirtL && K.skirtR) {
      this.emit(K.skirtL, M[PART.SKIRT_L], st, tier, visible);
      this.emit(K.skirtR, M[PART.SKIRT_R], st, tier, visible);
    }
    this.eHl = this.hlFor(st, id, 'armR', base);
    if (an.held) this.emit(`weapon:${an.held}`, M[PART.WEAPON], st, tier, visible);
  }

  /**
   * Repère local (avant-bras) d'une pièce mobile selon l'état du bras ; false : pièce cachée.
   * Les transformations sont écrites pour le bras gauche, le droit en est le miroir.
   */
  private movLocal(impl: string, piece: string, a: CyArmState, b: 'm' | 'f', R: boolean, out: THREE.Matrix4): boolean {
    out.identity();
    const k = RES;
    switch (`${impl}:${piece}`) {
      case 'pistoletBras:plateA':
      case 'pistoletBras:plateB': {
        const sg = piece === 'plateA' ? 1 : -1;
        const ang = sg * a.open * 1.95;
        if (Math.abs(ang) > 1e-3) out.makeTranslation(sg * VIPER_HINGE[0] * k, 0, VIPER_HINGE[1] * k).multiply(_t1.makeRotationY(ang)).multiply(_t2.makeTranslation(-sg * VIPER_HINGE[0] * k, 0, -VIPER_HINGE[1] * k));
        break;
      }
      case 'pistoletBras:barrel':
        out.makeTranslation(0, -VIPER_SLIDE * a.slide * k, 0);
        break;
      case 'lame:blade':
        out.makeTranslation(0, -MANTIS_SLIDE * a.blade * k, 0);
        break;
      case 'poing:rods':
        out.makeTranslation(0, a.rods * 3 * k, 0);
        break;
      case 'grappin:hook':
        if (a.hook < 0.55) return false;
        out.makeTranslation(0, -(1 - a.hook) * 9 * k, 0);
        break;
      case 'roquettes:pod':
      case 'roquettes:cover': {
        const h = podHinges(b);
        if (a.pod > 1e-3) {
          out.makeTranslation(a.pod * 1.2 * k + h.pod[0] * k, h.pod[1] * k, 0).multiply(_t1.makeRotationZ(a.pod * 0.32)).multiply(_t2.makeTranslation(-h.pod[0] * k, -h.pod[1] * k, 0));
        }
        if (piece === 'cover' && a.cover > 1e-3) {
          _t1.makeTranslation(h.cover[0] * k, h.cover[1] * k, 0).multiply(_t2.makeRotationZ(a.cover * 1.7));
          out.multiply(_t1).multiply(_t2.makeTranslation(-h.cover[0] * k, -h.cover[1] * k, 0));
        }
        break;
      }
      case 'outils:probe':
        if (a.probe < 0.02) return false;
        out.makeTranslation(0, -a.probe * 8 * k, 0);
        break;
      case 'bouclier:fins': {
        const y0 = podHinges(b).fins * k;
        out.makeTranslation(0, y0, 0).multiply(_t1.makeRotationX(a.fins)).multiply(_t2.makeTranslation(0, -y0, 0));
        break;
      }
    }
    if (R) out.premultiply(_mS).multiply(_mS);
    return true;
  }

  /** Intensités lumineuses des implants (texture d'état du personnage). */
  private cyberGlow(st: CState, v: CharView, an: CharAnim, now: number): void {
    const cd = this.cyber;
    const row = st.row;
    const spec = st.cy?.spec;
    if (!spec || row <= 0) {
      if (st.glowSet && row > 0) {
        cd.clearRow(row);
        st.glowSet = false;
      }
      return;
    }
    st.glowSet = true;
    const fx = v.anim === Anim.DEAD ? 0 : (v.fx ?? 0);
    const dead = v.anim === Anim.DEAD;
    const dim = dead ? 0.15 : 1;
    const lvl = (q: number) => (0.85 + 0.2 * q) * dim;
    // bras
    for (let i = 0; i < 2; i++) {
      const it = spec.arms[i];
      if (!it) {
        cd.setGlow(row, GLOW_CH.ARM_L + i, 0);
        cd.setGlow(row, GLOW_CH.ARM_L_ACT + i, 0);
        cd.setGlow(row, GLOW_CH.HEAT_L + i, 0);
        continue;
      }
      const a = an.cyArm[i];
      const tesla = it.id === 'choc';
      cd.setGlow(row, GLOW_CH.ARM_L + i, 1.35 * lvl(it.q), 0.12, 0.5);
      cd.setGlow(row, GLOW_CH.ARM_L_ACT + i, (0.25 + a.act * 4.2) * lvl(it.q), tesla ? 0.35 : 0.08, tesla ? 7 : 1.2, tesla && a.act > 1 ? 0.7 : 0);
      cd.setGlow(row, GLOW_CH.HEAT_L + i, a.heat * 4 * dim, 0.05, 2);
    }
    // jambes : liserés ; fibres du sprint et propulseurs
    if (spec.legs.length) {
      const q = Math.max(...spec.legs.map((l) => l.q));
      const sprint = (fx & CFX.SPRINT) !== 0;
      cd.setGlow(row, GLOW_CH.LEGS, 1.3 * lvl(q), 0.1, 0.4);
      cd.setGlow(row, GLOW_CH.LEGS_ACT, ((sprint ? 3.4 : 0.55) + an.thrust * 5) * lvl(q), sprint ? 0.35 : 0.12, sprint ? 3.2 : 0.6);
    } else {
      cd.setGlow(row, GLOW_CH.LEGS, 0);
      cd.setGlow(row, GLOW_CH.LEGS_ACT, 0);
    }
    // torse : liserés ; surcharge, cœur de secours (battement)
    if (spec.torso.length) {
      const q = Math.max(...spec.torso.map((l) => l.q));
      const over = (fx & CFX.OVERCHARGE) !== 0;
      const second = (fx & CFX.SECOND_WIND) !== 0;
      cd.setGlow(row, GLOW_CH.TORSO, 1.25 * lvl(q), 0.1, 0.5);
      cd.setGlow(row, GLOW_CH.TORSO_ACT, (over ? 4.6 : second ? 4.2 : 0.9) * lvl(q), over ? 0.25 : second ? 0.55 : 0.45, over ? 2.2 : second ? 5 : 1.15);
    } else {
      cd.setGlow(row, GLOW_CH.TORSO, 0);
      cd.setGlow(row, GLOW_CH.TORSO_ACT, 0);
    }
    const reflex = (fx & CFX.REFLEX) !== 0;
    cd.setGlow(row, GLOW_CH.SPINE, spec.spine ? (1.5 + (reflex ? 1.5 : 0)) * lvl(spec.spine.q) : 0, 0.3, spec.spine?.id === 'reflexesMoteurs' ? 1.6 : 0.6);
    const scan = (fx & CFX.SCAN) !== 0;
    const eq = spec.eyes.length ? Math.max(...spec.eyes.map((l) => l.q)) : 0;
    cd.setGlow(row, GLOW_CH.EYES, spec.eyes.length ? 1.9 * lvl(eq) * (scan ? 2.2 : 1) : 0, scan ? 0.4 : 0.08, scan ? 4 : 0.7);
    const nq = spec.neural.length ? Math.max(...spec.neural.map((l) => l.q)) : 0;
    cd.setGlow(row, GLOW_CH.NEURAL, spec.neural.length ? 1.5 * lvl(nq) : 0, 0.2, 0.8);
    cd.setGlow(row, GLOW_CH.NEURAL_ACT, spec.neural.length ? (reflex ? 5 : 0.7) * lvl(nq) : 0, reflex ? 0.3 : 0.1, reflex ? 4.5 : 0.5);
    cd.setGlow(row, GLOW_CH.TRIM, 0.9 * dim);
    cd.setGlow(row, GLOW_CH.WHIP, an.whipN > 0 ? 4.5 : 0, 0.2, 9, 0.15);
    // iris lumineux (première lentille qui en a)
    const eye = spec.eyes.find((e) => EYE_GLOW[e.id] !== undefined);
    if (eye && !dead) cd.setEye(row, EYE_GLOW[eye.id], (1.7 + 0.25 * eye.q) * (scan ? 1.6 : 1));
    else cd.setEye(row, 0, 0);
    // peau traitée, veines des nanobots
    const nano = spec.torso.find((t) => t.id === 'nanobots');
    cd.setSkin(row, spec.skin ? SKIN_MODE[spec.skin.id] ?? 0 : 0, spec.skin ? 0.55 + 0.12 * spec.skin.q : 0, nano ? 0.45 + 0.12 * nano.q : 0);
    void now;
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
  private poseTurret(v: CharView, st: CState, tier: number, now: number, visible: boolean): void {
    const dead = v.anim === Anim.DEAD;
    const mRoot = this.m0.makeTranslation(v.x, v.y, v.z);
    mRoot.multiply(this.m1.makeRotationY(st.baseYaw));
    this.emit('turret:base', mRoot, st, Math.min(tier, 1), visible);
    const sinceShot = now - v.shotAt;
    const kick = sinceShot >= 0 && sinceShot < 0.2 ? Math.exp(-sinceShot * 30) : 0;
    const sinceHit = now - v.hitAt;
    const jolt = sinceHit >= 0 && sinceHit < 0.4 ? Math.exp(-sinceHit * 12) * Math.sin(sinceHit * 60) * 0.06 : 0;
    const yoke = this.euler(new THREE.Matrix4(), v.x, v.y + P.TURRET_BASE_Y, v.z, 0, st.smoothYaw + jolt, dead ? 0.12 : 0);
    this.emit('turret:yoke', yoke, st, Math.min(tier, 1), visible);
    const gun = this.euler(this.m1, 0, P.TURRET_PIVOT_Y - P.TURRET_BASE_Y, -kick * 0.05, -st.smoothPitch + jolt - kick * 0.06, 0, 0);
    const mGun = new THREE.Matrix4().multiplyMatrices(yoke, gun);
    this.emit('turret:gun', mGun, st, Math.min(tier, 1), visible);
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
    for (const pm of this.parts.values()) {
      for (const t of pm.tiers) t.mesh.geometry.dispose();
      for (const list of [pm.camo, pm.xray]) if (list) for (const t of list) t.mesh.geometry.dispose();
    }
    for (const st of this.states.values()) if (st.row > 0) ROW_POOL.push(st.row);
    this.states.clear();
    this.material.dispose();
    this.camoMaterial.dispose();
    this.xrayMaterial.dispose();
    this.cyber.dispose();
  }
}

void hash32;
void _pv;
