// Effets visuels et sonores des implants cybernétiques dans le monde (MAFIA WARS II, 2085).
//
// Deux sources pilotent ce module :
//  · play(ab, p, p2, opt) : une capacité déclenchée (événement « ab » du serveur, ou prédiction
//    locale du joueur) → effet ponctuel (arcs électriques, ondes de choc, roquettes, crochet du
//    grappin, éclats du bouclier…) ET ses sons (joués au bon moment : l'explosion d'une roquette
//    retentit quand la roquette arrive, le crochet claque quand il touche la façade) ;
//  · updateEntities(list, now) : l'état visible de chaque personnage (bits CFX, animation,
//    vitesse) → effets persistants (bouclier, flammes, arcs sur le corps, aura de surcharge,
//    images rémanentes des réflexes, étincelles de glissade et de course murale…) et sons continus
//    (loopSources : treuil, raclement, bourdonnement du bouclier et du camouflage).
//
// Rendu : quelques familles de primitives (render/fxPrims.ts), chacune en UN appel de dessin ;
// boucliers et cônes du répulseur en petits lots préparés d'avance. Tous les matériaux sont créés
// dans le constructeur ; warm() les compile avant la partie. La quantité de particules suit
// `quality` (0,5 en qualité basse) et la distance ; au-delà de `maxDistance`, rien n'est émis.
//
// Repères : positions des personnages = pieds ; avant = (sin yaw, 0, cos yaw) ; droite =
// (−cos yaw, 0, sin yaw) (comme player.ts).

import * as THREE from 'three';
import { Anim } from '../../shared/characters';
import { CFX } from '../../shared/implants';
import { makeRayHit, type VoxelWorld } from '../../shared/voxel';
import { audio } from '../audio/AudioEngine';
import type { SfxName } from '../audio/types';
import {
  BlockBatch,
  blockGeometry,
  DecalBatch,
  fxTime,
  GlowParticles,
  ModelBatch,
  RAMP,
  RibbonBatch,
  RING,
  RingBatch,
  rgb,
  SHAPE,
  SHELL,
  ShellBatch,
  type PartSpec,
} from '../render/fxPrims';
import { NOISE_GLSL } from '../render/shaderChunks';
import { envUniforms } from '../render/env';
import type { Effects } from './effects';
import type { LoopSource } from './engineSounds';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface CyberFxOptions {
  /** Valeur de l'événement : durée de vol (grappin, roquette, piratage), rayon (onde, scanner), charge (poing, bond), ouverture (bouclier, répulseur), PV soignés… */
  v?: number;
  /** Points touchés sur les entités visées (centre du corps, ≈ pieds + 1,2 m), dans l'ordre pour la chaîne électrique. */
  targets?: Vec3Like[];
  /** Couleur d'accent (0xRRGGBB) ; sinon celle de l'implant. */
  color?: number;
  /** Action prédite du joueur local (sons un peu plus présents, bouclier atténué en vue subjective). */
  local?: boolean;
  /**
   * Entité à l'origine de la capacité (id de l'événement) : bouclier, camouflage, traînée du bond…
   * Sans elle, le personnage connu le plus proche de p est pris.
   */
  id?: number;
}

/** Personnage vu par les effets (une entrée par personnage affiché, joueur local compris). */
export interface FxEntity {
  id: number;
  /** Pieds. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Bits CFX (shared/implants.ts). */
  fx?: number;
  /** Anim (shared/characters.ts). */
  anim: number;
  /** Vitesse horizontale (m/s) ; sinon calculée depuis vx, vz (CharView). */
  speed?: number;
  vx?: number;
  vz?: number;
  /** Non dessiné (joueur local en vue subjective, passager) : seuls bouclier et grappin restent. */
  hidden?: boolean;
}

export type GrapplePhase = 'fire' | 'attached' | 'retract';

/** Couleurs d'accent par défaut (catalogue des implants, ajustées pour la lisibilité). */
const COL = {
  grapple: 0x4fd8ff,
  blade: 0xff6a3d,
  fist: 0xffb13d,
  shield: 0x6ad8ff,
  repulsor: 0xb3a1ff,
  shock: 0x8ff6ff,
  tool: 0x8cff9a,
  rocket: 0xff8a3d,
  whip: 0xff4dd2,
  jump: 0x6ad8ff,
  leap: 0xb4ff3d,
  sprint: 0xffe14d,
  dash: 0x3dd8ff,
  slide: 0xffa040,
  wall: 0x3dffb4,
  wallJump: 0x3dff7d,
  land: 0xbfd8ff,
  quake: 0xffc890,
  secondWind: 0x5dff9a,
  over: 0xff3a1e,
  nano: 0x7dff6a,
  scan: 0x8cff9a,
  camo: 0x9affff,
  reflex: 0x4f9dff,
  reflexGold: 0xffd23d,
  drone: 0xb3a1ff,
  mark: 0xff3d5a,
  fire: 0xff7a2a,
  spark: 0xffc070,
  stun: 0xfff07a,
  grip: 0xc0d8ff,
} as const;

// ------------------------------------------------------------------ types de particules

const SP = {
  spark: { life: 0.42, size: 0.022, i: 2.2, grav: 9, drag: 1.2, stretch: 0.045, floor: true },
  sparkHot: { life: 0.24, size: 0.024, i: 2.2, grav: 4, drag: 2, stretch: 0.035 },
  ember: { life: 1.1, size: 0.02, size1: 0.008, i: 1.6, grav: -0.5, drag: 0.6, shape: SHAPE.BLOCK, flicker: 0.6 },
  flame: { life: 0.55, size: 0.15, size1: 0.05, i: 1.5, grav: -3.2, drag: 1.8, stretch: 0.05, ramp: RAMP.FIRE },
  glow: { life: 0.25, size: 0.22, size1: 0.36, i: 1, ramp: RAMP.POP, lifeJ: 0.1 },
  flash: { life: 0.12, size: 0.5, size1: 0.9, i: 1.4, ramp: RAMP.POP, lifeJ: 0.05 },
  mote: { life: 0.8, size: 0.028, i: 1.3, drag: 2, ramp: RAMP.INOUT, shape: SHAPE.BLOCK },
  streak: { life: 0.24, size: 0.018, i: 1.8, stretch: 0.09, drag: 3 },
  thrust: { life: 0.22, size: 0.08, size1: 0.025, i: 1.5, drag: 6, stretch: 0.035 },
  fireJet: { life: 0.16, size: 0.06, size1: 0.02, i: 1.2, drag: 5, stretch: 0.02, ramp: RAMP.FIRE },
  heal: { life: 1.1, size: 0.07, i: 1.15, grav: -0.7, drag: 1.4, shape: SHAPE.CROSS, ramp: RAMP.INOUT },
  shard: { life: 0.75, size: 0.045, size1: 0.02, i: 1.4, grav: 7, drag: 0.8, shape: SHAPE.BLOCK, floor: true },
  fireball: { life: 0.55, size: 0.3, size1: 0.8, i: 1.3, grav: -1.4, drag: 3.2, ramp: RAMP.FIRE },
  data: { life: 0.7, size: 0.024, i: 1.4, drag: 1.2, shape: SHAPE.BLOCK, ramp: RAMP.INOUT },
  diamond: { life: 1.6, size: 0.16, i: 1.3, ramp: RAMP.INOUT, shape: SHAPE.DIAMOND, lifeJ: 0 },
  ringP: { life: 0.35, size: 0.2, size1: 0.6, i: 1, ramp: RAMP.POP, shape: SHAPE.RING, lifeJ: 0 },
  dust: { life: 0.9, size: 0.05, size1: 0.12, i: 0.25, drag: 2.5, ramp: RAMP.INOUT },
  stunStar: { life: 0.05, size: 0.05, i: 1.4, shape: SHAPE.DIAMOND, ramp: RAMP.INOUT, lifeJ: 0 },
  suck: { life: 0.22, size: 0.018, i: 1.5, stretch: 0.05, ramp: RAMP.INOUT, lifeJ: 0.1 },
  leapIn: { life: 0.25, size: 0.02, i: 1.5, stretch: 0.05, ramp: RAMP.INOUT },
  gust: { life: 0.28, size: 0.02, i: 1.2, drag: 5, stretch: 0.05 },
  moteIn: { life: 0.45, size: 0.028, i: 1.3, drag: 2, ramp: RAMP.INOUT, shape: SHAPE.BLOCK },
  contact: { life: 0.05, size: 0.16, i: 1.1, ramp: RAMP.INOUT, lifeJ: 0 },
} satisfies Record<string, PartSpec>;

// ------------------------------------------------------------------ bouclier

const SS = /* glsl */ `
float ss(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}`;

const SHIELD_VERT = /* glsl */ `
varying vec3 vP;
varying vec3 vN;
varying vec3 vW;
void main() {
  vP = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SHIELD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uArc;
uniform float uOpen;
uniform float uBreak;
uniform float uI;
uniform float uInside;
uniform float uRadius;
uniform vec3 uColor;
uniform vec4 uHits[4];
varying vec3 vP;
varying vec3 vN;
varying vec3 vW;
${SS}
float hexD(vec2 p) {
  p = abs(p);
  return max(dot(p, vec2(0.5, 0.8660254)), p.x);
}
// arêtes (0 sur l'arête, 0,5 au centre) et identifiant de la cellule hexagonale
vec3 hexGrid(vec2 uv) {
  const vec2 r = vec2(1.0, 1.7320508);
  const vec2 hh = vec2(0.5, 0.8660254);
  vec2 a = mod(uv, r) - hh;
  vec2 b = mod(uv - hh, r) - hh;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return vec3(0.5 - hexD(gv), uv - gv);
}
void main() {
  vec3 p = normalize(vP);
  float ang = atan(p.x, p.z);
  float aa = abs(ang);
  if (aa > uArc || p.y < -0.74) discard;
  // déploiement depuis l'émetteur de l'avant-bras (devant, à mi-hauteur)
  float fromFront = acos(clamp(dot(p, vec3(0.0, -0.0995, 0.995)), -1.0, 1.0));
  float reveal = uOpen * 3.3;
  if (fromFront > reveal) discard;
  float openEdge = 1.0 - smoothstep(0.0, 0.22, reveal - fromFront);
  vec3 hg = hexGrid(vec2(ang * uRadius, p.y * uRadius) * 6.2);
  float edge = 1.0 - smoothstep(0.0, 0.075, hg.x);
  float cell = fract(sin(dot(hg.yz, vec2(12.9898, 78.233))) * 43758.5453);
  float twinkle = step(0.968, fract(cell * 7.13 + floor(uTime * 5.0 + cell * 3.0) * 0.618));
  float wave = 0.5 + 0.5 * sin(p.y * 9.0 - uTime * 3.2 + ang * 2.0);
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float fres = pow(1.0 - abs(dot(n, v)), 2.2);
  float border = uArc < 3.1 ? smoothstep(uArc - 0.14, uArc, aa) : 0.0;
  float bottom = ss(-0.6, -0.74, p.y);
  float k = 0.06 + edge * (0.2 + 0.18 * wave) + fres * 0.85 + twinkle * 0.45 + border * 0.9 + bottom * 0.35 + openEdge * 1.4;
  float hit = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 H = uHits[i];
    if (H.w < 0.0 || H.w > 1.0) continue;
    float d = acos(clamp(dot(p, H.xyz), -1.0, 1.0));
    float ring = exp(-pow((d - H.w * 3.2) / 0.13, 2.0)) * exp(-H.w * 3.0);
    float spot = exp(-d * d * 22.0) * exp(-H.w * 7.0);
    hit += ring * (0.5 + edge * 1.6) + spot * 2.8 + (1.0 - smoothstep(0.0, 0.5, d)) * edge * exp(-H.w * 5.0) * 1.2;
  }
  k += hit;
  if (uBreak > 0.0) {
    // bouclier brisé : les cellules s'éteignent, bord incandescent, éclair blanc
    float th = uBreak * 1.15 - 0.05;
    if (cell < th) discard;
    k += (1.0 - smoothstep(0.0, 0.1, cell - th)) * 2.2 + ss(0.2, 0.0, uBreak) * 2.0;
  }
  float back = gl_FrontFacing ? 1.0 : mix(0.5, 0.28, uInside);
  vec3 c = uColor * k + vec3(0.85, 0.95, 1.0) * (hit * 0.3 + openEdge * 0.4);
  gl_FragColor = vec4(c * uI * back, 1.0);
}`;

class ShieldView {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  readonly hits = [new THREE.Vector4(0, 0, 1, -1), new THREE.Vector4(0, 0, 1, -1), new THREE.Vector4(0, 0, 1, -1), new THREE.Vector4(0, 0, 1, -1)];
  owner = -1;

  constructor(geo: THREE.BufferGeometry) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SHIELD_VERT,
      fragmentShader: SHIELD_FRAG,
      uniforms: {
        uTime: fxTime,
        uArc: { value: 1.05 },
        uOpen: { value: 0 },
        uBreak: { value: 0 },
        uI: { value: 1 },
        uInside: { value: 0 },
        uRadius: { value: 1.2 },
        uColor: { value: new THREE.Color() },
        uHits: { value: this.hits },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mat.toneMapped = false;
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.name = 'bouclier';
  }
}

// ------------------------------------------------------------------ cône du répulseur

const CONE_VERT = /* glsl */ `
varying vec3 vP;
varying vec3 vN;
varying vec3 vW;
void main() {
  vP = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const CONE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uT;
uniform float uI;
uniform float uSeed;
uniform vec3 uColor;
varying vec3 vP;
varying vec3 vN;
varying vec3 vW;
${SS}
${NOISE_GLSL}
void main() {
  float z = vP.z;
  float front = uT * 1.3;
  float b1 = exp(-pow((z - front) / 0.07, 2.0));
  float b2 = exp(-pow((z - front + 0.2) / 0.05, 2.0)) * 0.6;
  float b3 = exp(-pow((z - front + 0.38) / 0.05, 2.0)) * 0.35;
  float ang = atan(vP.y, vP.x);
  float n = vnoise(vec2(ang * 2.5 + uSeed, z * 7.0 - uT * 14.0));
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vW))), 1.4);
  float inside = 1.0 - smoothstep(front - 0.02, front + 0.02, z);
  float fade = ss(1.02, 0.6, z) * smoothstep(0.0, 0.12, z);
  // fronts d'onde nets, voile intérieur à peine visible (l'air déformé)
  float k = (b1 * (0.3 + 0.7 * n) * 0.45 + (b2 + b3) * n * 0.2) * fade;
  k *= gl_FrontFacing ? 1.0 : 0.45;
  gl_FragColor = vec4(uColor * k * uI, 1.0);
}`;

class ConeView {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  t = 0;
  dur = 0;

  constructor(geo: THREE.BufferGeometry) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: CONE_VERT,
      fragmentShader: CONE_FRAG,
      uniforms: { uTime: fxTime, uT: { value: 0 }, uI: { value: 1 }, uSeed: { value: 0 }, uColor: { value: new THREE.Color() } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mat.toneMapped = false;
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.name = 'répulseur';
  }
}

// ------------------------------------------------------------------ états

interface Ghost {
  x: number;
  y: number;
  z: number;
  yaw: number;
  t: number;
  life: number;
  col: number;
  i: number;
  lean: number;
  stride: number;
}

interface EntState {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  fx: number;
  anim: number;
  speed: number;
  hidden: boolean;
  local: boolean;
  seen: number;
  fresh: boolean;
  /** Direction du déplacement (unitaire, horizontale). */
  mx: number;
  mz: number;
  lastT: number;
  // bouclier
  shield: number;
  shieldOn: boolean;
  shieldArc: number;
  shieldBreak: number;
  view: ShieldView | null;
  hitN: number;
  // minuteries et accumulateurs
  chargeT: number;
  overT: number;
  windT: number;
  scanT: number;
  arcT: number;
  acc: Float32Array;
  ghosts: Ghost[];
  trailUntil: number;
  trailCol: number;
  /** Dernier événement reçu par type (s). */
  evAt: Map<string, number>;
  /** Fronts d'états à traiter plus tard (l'événement correspondant peut arriver juste après). */
  pend: { kind: string; at: number; on: boolean }[];
}

// indices des accumulateurs
const A_FLAME = 0;
const A_EMBER = 1;
const A_SMOKE = 2;
const A_SPARK = 3;
const A_GHOST = 4;
const A_SPRINT = 5;
const A_SLIDE = 6;
const A_WALL = 7;
const A_STEP = 8;
const A_WIND = 9;
const A_MOTE = 10;
const A_DUST = 11;
const A_N = 12;

interface GrappleState {
  from: THREE.Vector3;
  to: THREE.Vector3;
  phase: GrapplePhase;
  /** Temps écoulé dans la phase (s). */
  t: number;
  /** Progression du vol ('fire') ou du retour ('retract'), 0..1. */
  k: number;
  /** Durée du vol du crochet (s). */
  dur: number;
  /** Piloté par setGrapple (l'appelant fait avancer les phases) ; sinon par les événements. */
  driven: boolean;
  /** Dernière mise à jour (s). */
  touched: number;
  /** Le point de départ a été donné par l'appelant cette image (sinon : main estimée). */
  fromSet: boolean;
  /** Normale de la surface d'ancrage. */
  n: THREE.Vector3;
  col: number;
  local: boolean;
  attachedAt: number;
  /** Position du crochet au début du retour. */
  back: THREE.Vector3;
}

interface Active {
  t: number;
  dur: number;
  step: (a: Active, dt: number) => void;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s1 = new THREE.Vector3(1, 1, 1);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const rnd = (a: number, b: number) => a + (b - a) * Math.random();
const sgn = () => (Math.random() < 0.5 ? -1 : 1);

export class CyberFx {
  readonly group = new THREE.Group();
  /** Densité des particules : 1 (haute), 0,75 (moyenne), 0,5 (basse). */
  quality = 1;
  /** Joue aussi les sons (désactivable pour les tests). */
  sound = true;
  /** Identifiant du joueur local (bouclier atténué en vue subjective, sons de fin d'état). */
  selfId = -1;
  /** Au-delà (m) de la caméra, aucun effet n'est émis. */
  maxDistance = 95;

  private world: VoxelWorld;
  private effects: Effects | null;
  private ribbons = new RibbonBatch(6000);
  private parts = new GlowParticles(3200);
  private rings = new RingBatch(72);
  private shells = new ShellBatch(48);
  private blocks = new BlockBatch(360);
  private decals = new DecalBatch(24);
  private rockets: ModelBatch;
  private hooks: ModelBatch;
  private shields: ShieldView[] = [];
  private cones: ConeView[] = [];
  private ents = new Map<number, EntState>();
  private grapples = new Map<number, GrappleState>();
  private active: Active[] = [];
  private frame = 0;
  private time = 0;
  private cam = new THREE.Vector3();
  private camFwd = new THREE.Vector3(0, 0, -1);
  private hit = makeRayHit();
  private bp = new Float32Array(65 * 3);
  private bu = new Float32Array(65);
  private bw = new Float32Array(65);
  private wk = new Float32Array(65);
  private ck = new Float32Array(65);
  private cable = new Float32Array(48 * 3);

  constructor(world: VoxelWorld, effects?: Effects) {
    this.world = world;
    this.effects = effects ?? null;
    this.group.name = 'effets cybernétiques';
    // crochet du grappin : tige, griffes, diode
    const hookGeo = blockGeometry([
      [0, 0, -0.02, 0.035, 0.035, 0.13, 0x8a94a6, 0],
      [0, 0, 0.055, 0.05, 0.05, 0.03, 0x4fd8ff, 0.9],
      [0.045, 0, 0.07, 0.07, 0.022, 0.022, 0x9aa4b6, 0],
      [-0.045, 0, 0.07, 0.07, 0.022, 0.022, 0x9aa4b6, 0],
      [0, 0.045, 0.07, 0.022, 0.07, 0.022, 0x9aa4b6, 0],
      [0.075, 0, 0.045, 0.02, 0.02, 0.05, 0xb8c2d4, 0],
      [-0.075, 0, 0.045, 0.02, 0.02, 0.05, 0xb8c2d4, 0],
      [0, 0.075, 0.045, 0.02, 0.05, 0.02, 0xb8c2d4, 0],
    ]);
    this.hooks = new ModelBatch(hookGeo, 6, 'crochets');
    // micro-roquette : corps, ogive, bague lumineuse, ailettes, tuyère
    const rocketGeo = blockGeometry([
      [0, 0, 0, 0.06, 0.06, 0.26, 0x3a3f4a, 0],
      [0, 0, 0.16, 0.045, 0.045, 0.07, 0xd8dde6, 0],
      [0, 0, 0.06, 0.065, 0.065, 0.025, 0xff8a3d, 1],
      [0.05, 0, -0.1, 0.05, 0.012, 0.06, 0x5a606c, 0],
      [-0.05, 0, -0.1, 0.05, 0.012, 0.06, 0x5a606c, 0],
      [0, 0.05, -0.1, 0.012, 0.05, 0.06, 0x5a606c, 0],
      [0, -0.05, -0.1, 0.012, 0.05, 0.06, 0x5a606c, 0],
      [0, 0, -0.14, 0.04, 0.04, 0.02, 0xffc070, 1.2],
    ]);
    this.rockets = new ModelBatch(rocketGeo, 24, 'roquettes');
    const shieldGeo = new THREE.SphereGeometry(1, 48, 28);
    for (let i = 0; i < 4; i++) {
      const s = new ShieldView(shieldGeo);
      this.shields.push(s);
      this.group.add(s.mesh);
    }
    const coneGeo = new THREE.ConeGeometry(1, 1, 36, 10, true);
    coneGeo.translate(0, -0.5, 0);
    coneGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 2; i++) {
      const c = new ConeView(coneGeo);
      this.cones.push(c);
      this.group.add(c.mesh);
    }
    this.group.add(this.decals.mesh, this.shells.mesh, this.blocks.mesh, this.rings.mesh, this.ribbons.mesh, this.parts.mesh, this.hooks.mesh, this.rockets.mesh);
  }

  /**
   * Compile tous les matériaux avant la partie (à appeler une fois, le groupe déjà dans la scène
   * et les lumières en place) : aucun accroc au premier effet.
   */
  warm(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene): void {
    renderer.compile(this.group, camera, scene);
  }

  // ===================================================================== API

  /**
   * Capacité déclenchée : effet ET son (une seule fois par action : prévision locale OU écho du
   * serveur). p = origine, p2 = cible / point visé (direction = p2 − p), opt.v = valeur,
   * opt.targets = points touchés (centre du corps), opt.id = entité à l'origine.
   */
  play(ab: string, p: Vec3Like, p2?: Vec3Like | null, opt: CyberFxOptions = {}): void {
    const o = opt;
    const d = Math.hypot(p.x - this.cam.x, p.y - this.cam.y, p.z - this.cam.z);
    const far = d > this.maxDistance && !o.local;
    const caster = this.who(o.id, p, !!o.local);
    caster?.evAt.set(ab, this.time);
    // loin : seulement le son (le moteur audio coupe lui-même au-delà de sa portée)
    const lod = far ? 0 : (d < 30 ? 1 : d < 60 ? 0.6 : 0.35) * this.quality;
    const v = o.v ?? 0;
    switch (ab) {
      // ------------------------------------------------------------ déplacements
      case 'grappin': {
        this.sfx('grapple_fire', p, 1, 1, o.local);
        // câble animé ici seulement si l'entité est connue et que personne ne le pilote (setGrapple)
        const g = o.id !== undefined ? this.grapples.get(o.id) : undefined;
        if (p2 && o.id !== undefined && !g?.driven) this.newGrapple(o.id, p, p2, v > 0 ? v : 0, o.color ?? COL.grapple, !!o.local);
        if (lod > 0) this.burst(p, COL.grapple, 6 * lod, 1.5, SP.sparkHot);
        break;
      }
      case 'grappin-fin': {
        this.sfx('grapple_release', p, 0.9, 1, o.local);
        const g = o.id !== undefined ? this.grapples.get(o.id) : undefined;
        if (g && !g.driven) this.grappleRetract(g);
        break;
      }
      case 'treuil':
        this.sfx('winch_yank', p2 ?? p, 1, 1, o.local);
        if (lod > 0 && p2) this.winch(this.feet(p), this.feet(p2), o.color ?? COL.grapple, lod);
        break;
      case 'esquive':
        this.sfx('dash_whoosh', p, 1, 1, o.local);
        if (lod > 0) this.dash(this.feet(p), this.feet(p2 ?? p), o.color ?? COL.dash, lod);
        break;
      case 'doubleSaut':
        this.sfx('jump_thrust', p, 1, 1, o.local);
        if (lod > 0) this.airJump(p, o.color ?? COL.jump, lod);
        break;
      case 'bond-charge':
        this.sfx('leap_charge', p, 0.9, 1, o.local);
        if (lod > 0) this.leapCharge(this.feet(p), o.color ?? COL.leap, lod);
        break;
      case 'bond':
        this.sfx('leap_launch', p, 0.75 + 0.35 * v, 1, o.local);
        if (lod > 0) this.leap(this.feet(p), p2, v || 0.6, o.color ?? COL.leap, lod, caster);
        break;
      case 'atterrissage':
        this.sfx('land_heavy', p, 0.5 + 0.6 * v, 1.05 - 0.15 * v, o.local);
        if (lod > 0) this.land(this.feet(p), v || 0.5, lod);
        break;
      case 'onde':
        this.sfx('ground_quake', p, 1, 1, o.local);
        if (lod > 0) this.quake(this.feet(p), v || 4.5, o.color ?? COL.quake, lod);
        break;
      case 'sautMural':
        this.sfx('jump_thrust', p, 0.8, 1.12, o.local);
        if (lod > 0) this.wallJump(p, p2, o.color ?? COL.wallJump, lod);
        break;
      case 'glissade':
        this.sfx('slide_start', p, 1, 1, o.local);
        if (lod > 0) this.slideStart(this.feet(p), p2, lod);
        break;
      case 'escalade':
        this.sfx('mantle_grab', p, 1, 1, o.local);
        if (lod > 0) this.mantle(p, lod);
        break;
      // ------------------------------------------------------------ combat
      case 'bras-sortie':
      case 'bras-rentre': {
        const out = ab === 'bras-sortie';
        this.sfx(out ? 'arm_deploy' : 'arm_retract', p, 1, 1, o.local);
        if (lod > 0) {
          this.effects?.addSmoke(p.x, p.y, p.z, rnd(-0.2, 0.2), 0.5, rnd(-0.2, 0.2), 0.7, 0.05, 0.25, 0.85, out ? 0.35 : 0.25);
          this.burst(p, out ? 0xbfe8ff : 0xffd0a0, 4 * lod, 1.2, SP.sparkHot);
        }
        break;
      }
      case 'lame':
        this.sfx('blade_slash', p, 1, 1, o.local);
        if (o.targets?.length) for (const t of o.targets) this.sfx('blade_hit', t, 0.9);
        if (lod > 0) this.slash(p, p2, o.targets, o.color ?? COL.blade, lod);
        break;
      case 'poing-charge':
        this.sfx('fist_charge', p, 1, 1, o.local);
        if (lod > 0) this.parts.emit(p.x, p.y, p.z, 0, 0, 0, SP.glow, o.color ?? COL.fist, 0.8);
        break;
      case 'poing':
        this.sfx('fist_heavy', p2 ?? p, 0.85 + 0.35 * v, 1.05 - 0.12 * v, o.local);
        if (lod > 0) this.punch(p, p2 ?? p, v, o.color ?? COL.fist, lod);
        break;
      case 'fouet':
        this.sfx('whip_crack', p2 ? { x: (p.x + p2.x) / 2, y: (p.y + p2.y) / 2, z: (p.z + p2.z) / 2 } : p, 1, 1, o.local);
        if (lod > 0 && p2) this.whip(p, p2, o.targets, o.color ?? COL.whip, lod);
        break;
      case 'bouclier': {
        this.sfx('shield_up', p, 1, 1, o.local);
        const e = caster ?? this.ent(o.id ?? -1, this.feet(p));
        if (e) {
          e.shieldOn = true;
          e.shieldBreak = 0;
          e.shieldArc = v > 0 ? v : e.shieldArc || 120;
          if (e.shield > 0.6) e.shield = 0.6;
        }
        if (lod > 0) this.burst({ x: p.x, y: p.y + 1.1, z: p.z }, o.color ?? COL.shield, 10 * lod, 2.2, SP.sparkHot);
        break;
      }
      case 'bouclier-impact': {
        this.sfx('shield_hit', p, 1, rnd(0.92, 1.08));
        const e = (caster?.view ? caster : null) ?? this.nearestShield(p);
        if (e) this.shieldHit(e, p);
        if (lod > 0) {
          this.burst(p, o.color ?? COL.shield, 8 * lod, 3, SP.spark);
          this.parts.emit(p.x, p.y, p.z, 0, 0, 0, SP.glow, 0xdff8ff, 0.7);
        }
        break;
      }
      case 'bouclier-brise': {
        this.sfx('shield_break', p, 1, 1, o.local);
        const e = (caster?.view ? caster : null) ?? this.nearestShield(p);
        if (e) this.shieldShatter(e, lod);
        else if (lod > 0) this.burst(p, COL.shield, 30 * lod, 4, SP.shard);
        break;
      }
      case 'bouclier-fin': {
        this.sfx('shield_down', p, 1, 1, o.local);
        const e = (caster && (caster.shieldOn || caster.view) ? caster : null) ?? this.nearestShield(p);
        if (e) e.shieldOn = false;
        break;
      }
      case 'repulseur':
        this.sfx('repulsor', p, 1, 1, o.local);
        if (lod > 0) this.repulse(p, p2, v || 75, o.targets, o.color ?? COL.repulsor, lod);
        break;
      case 'choc':
        this.sfx('shock_zap', p, 1, 1, o.local);
        if (v >= 1) this.sfx('emp_burst', p, 1, 1, o.local);
        if (lod > 0) this.chain(p, p2, o.targets ?? [], v >= 1, o.color ?? COL.shock, lod);
        break;
      case 'roquette':
        this.sfx('rocket_launch', p, 1, rnd(0.94, 1.06), o.local);
        if (p2) this.rocket(p, p2, v > 0 ? v : 0, o.color ?? COL.rocket, lod, !!o.local);
        break;
      case 'scanner':
        this.sfx('scan_ping', p, 1, 1, o.local);
        if (lod > 0 || o.local) this.scan(this.feet(p), v || 25, o.color ?? COL.scan);
        break;
      case 'camouflage':
      case 'camouflage-fin': {
        const on = ab === 'camouflage';
        this.sfx(on ? 'camo_on' : 'camo_off', p, 1, 1, o.local);
        if (lod > 0) this.camoBurst(this.feet(p), on, o.color ?? COL.camo, lod);
        break;
      }
      case 'reflexes':
        this.sfx('reflex_on', p, 1, 1, o.local);
        if (lod > 0) this.reflexBurst(this.feet(p), lod);
        break;
      case 'surcharge':
        this.sfx('overcharge_on', p, 1, 1, o.local);
        if (lod > 0) this.overBurst(this.feet(p), o.color ?? COL.over, lod);
        break;
      case 'secondSouffle':
        this.sfx('second_wind', p, 1, 1, o.local);
        if (lod > 0) this.secondWind(this.feet(p), o.color ?? COL.secondWind, lod);
        break;
      case 'nanobots':
        this.sfx('nano_heal', p, 0.7, 1, o.local);
        if (lod > 0) this.nano(this.feet(p), v, o.color ?? COL.nano, lod);
        break;
      case 'drone':
        this.sfx('drone_deploy', p, 1, 1, o.local);
        if (lod > 0) this.droneDeploy(p, o.color ?? COL.drone, lod);
        break;
      case 'piratage':
        this.sfx('tool_hack', p2 ?? p, 1, 1, o.local);
        if (lod > 0 && p2) this.hack(p, p2, v > 0 ? v : 2, o.color ?? COL.tool, lod);
        break;
      case 'marque':
        this.sfx('mark_ping', p, 0.8, 1, true);
        for (const t of o.targets ?? []) this.markPing(t, o.color ?? COL.mark);
        break;
      default:
        break;
    }
  }

  /**
   * Câble du grappin d'une entité, piloté par l'appelant à chaque image : `from` = main (vue
   * extérieure) ou lanceur (vue subjective), `to` = ancrage, `phase` et `t` = progression 0..1
   * du vol ('fire') ou du retour ('retract'), secondes depuis l'accroche ('attached'). Le passage
   * de 'fire' à 'attached' déclenche l'accroche (étincelles, son). null : câble retiré.
   * (Sans appel à setGrapple, play('grappin', …, { id, v }) anime seul le vol et l'accroche, et le
   * câble suit le bit CFX.GRAPPLE de l'entité.)
   */
  setGrapple(id: number, s: { from: THREE.Vector3; to: THREE.Vector3; phase: GrapplePhase; t: number } | null): void {
    if (!s) {
      this.grapples.delete(id);
      return;
    }
    let g = this.grapples.get(id);
    if (!g) g = this.newGrapple(id, s.from, s.to, 0.3, COL.grapple, id === this.selfId);
    g.driven = true;
    g.touched = this.time;
    g.from.copy(s.from);
    g.fromSet = true;
    if (g.to.distanceToSquared(s.to) > 1e-6) {
      g.to.copy(s.to);
      this.anchorNormal(g);
    }
    const t = Number.isFinite(s.t) ? s.t : 0;
    if (s.phase === 'fire') {
      if (g.phase !== 'fire') g.t = 0;
      g.phase = 'fire';
      g.k = Math.max(0, Math.min(1, t));
    } else if (s.phase === 'attached') {
      if (g.phase !== 'attached') this.grappleAttach(g);
      g.t = Math.max(0, t);
    } else {
      if (g.phase !== 'retract') this.grappleRetract(g);
      g.k = Math.max(0, Math.min(1, t));
    }
  }

  /** Point de départ du câble à cette image (main en vue extérieure, lanceur en vue subjective). */
  setGrappleFrom(id: number, from: Vec3Like): void {
    const g = this.grapples.get(id);
    if (!g) return;
    g.from.set(from.x, from.y, from.z);
    g.fromSet = true;
  }

  /** États visibles des personnages (à chaque image, avant update). */
  updateEntities(list: FxEntity[], now: number): void {
    this.time = now;
    const f = ++this.frame;
    for (const it of list) {
      let e = this.ents.get(it.id);
      const ifx = it.fx ?? 0;
      const speed = it.speed ?? Math.hypot(it.vx ?? 0, it.vz ?? 0);
      if (!e) {
        e = this.newEnt(it.id, it.x, it.y, it.z);
        e.fx = ifx;
        e.anim = it.anim;
        e.shieldOn = (ifx & CFX.SHIELD) !== 0;
        e.shield = e.shieldOn ? 1 : 0;
        this.ents.set(it.id, e);
      } else if (e.fresh && e.seen === -1) {
        // créé par un événement avant d'être vu : premier état sans front
        e.fx = ifx;
        e.anim = it.anim;
      }
      const dtp = Math.max(1e-3, now - e.lastT);
      const dx = it.x - e.x;
      const dz = it.z - e.z;
      const dl = Math.hypot(dx, dz);
      if (dl > 0.02 && dl / dtp < 60) {
        e.mx = dx / dl;
        e.mz = dz / dl;
      } else if (dl / dtp >= 60 || speed < 0.3) {
        e.mx = Math.sin(it.yaw);
        e.mz = Math.cos(it.yaw);
      }
      e.lastT = now;
      e.x = it.x;
      e.y = it.y;
      e.z = it.z;
      e.yaw = it.yaw;
      e.speed = speed;
      e.hidden = !!it.hidden;
      e.local = it.id === this.selfId;
      if (e.seen >= 0 && !e.fresh) this.transitions(e, ifx, it.anim);
      e.fx = ifx;
      e.anim = it.anim;
      e.seen = f;
      e.fresh = false;
    }
    for (const [id, e] of this.ents) {
      if (e.seen === f || (e.seen === -1 && now - e.lastT < 2)) continue;
      // disparu (hors de portée, mort, déconnecté) : on libère son bouclier
      if (e.view) {
        e.view.mesh.visible = false;
        e.view.owner = -1;
      }
      this.ents.delete(id);
    }
  }

  /** Sons continus des implants, à ajouter à la liste de EngineSounds (toutes les 0,1 s). */
  loopSources(out: LoopSource[]): void {
    const c = this.cam;
    for (const e of this.ents.values()) {
      if (Math.abs(e.x - c.x) > 45 || Math.abs(e.z - c.z) > 45) continue;
      if (e.fx & CFX.SHIELD) out.push({ key: `cy-bouclier${e.id}`, loop: 'shield_hum', x: e.x, y: e.y + 1.1, z: e.z, pitch: 1, volume: e.local ? 0.55 : 0.75 });
      if (e.fx & CFX.CAMO) out.push({ key: `cy-camo${e.id}`, loop: 'camo_hum', x: e.x, y: e.y + 1.2, z: e.z, pitch: 1, volume: e.local ? 0.4 : 0.6 });
      if (e.anim === Anim.SLIDE && !(e.fx & CFX.CAMO)) out.push({ key: `cy-glisse${e.id}`, loop: 'slide_scrape', x: e.x, y: e.y + 0.1, z: e.z, pitch: Math.min(2.2, 0.9 + e.speed / 10), volume: 0.9 });
    }
    for (const [id, g] of this.grapples) {
      if (g.phase !== 'attached') continue;
      const e = this.ents.get(id);
      const sp = e ? e.speed : 12;
      out.push({ key: `cy-treuil${id}`, loop: 'grapple_reel', x: g.from.x, y: g.from.y, z: g.from.z, pitch: Math.min(2.4, 0.9 + sp / 14), volume: g.local ? 0.75 : 0.85 });
    }
  }

  /** À chaque image, après updateEntities et avant le rendu. */
  update(dt: number, camera: THREE.Camera, now: number): void {
    this.time = now;
    fxTime.value = now % 1000;
    camera.getWorldPosition(this.cam);
    camera.getWorldDirection(this.camFwd);
    this.parts.limit = Math.max(400, Math.round(this.parts.capacity * Math.min(1, this.quality)));
    this.ribbons.begin(this.cam);
    this.shells.begin();
    this.blocks.begin();
    this.hooks.begin();
    this.rockets.begin();
    // effets ponctuels en cours
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.t += dt;
      a.step(a, dt);
      if (a.t >= a.dur) this.active.splice(i, 1);
    }
    this.updateGrapples(dt);
    for (const e of this.ents.values()) this.updateEnt(e, dt);
    for (const c of this.cones) {
      if (!c.mesh.visible) continue;
      c.t += dt;
      const k = c.t / c.dur;
      if (k >= 1) {
        c.mesh.visible = false;
        continue;
      }
      c.mat.uniforms.uT.value = k;
      c.mat.uniforms.uI.value = 0.9 * (1 - k * k);
    }
    this.parts.update(dt);
    this.parts.write(now);
    this.rings.update(dt);
    this.decals.update(dt);
    this.ribbons.end();
    this.shells.end();
    this.blocks.end();
    this.hooks.end();
    this.rockets.end();
  }

  /** Efface tout (nouvelle partie, reconnexion). */
  clear(): void {
    this.active.length = 0;
    this.grapples.clear();
    for (const e of this.ents.values()) if (e.view) e.view.mesh.visible = false;
    for (const s of this.shields) s.owner = -1;
    for (const c of this.cones) c.mesh.visible = false;
    this.ents.clear();
    this.parts.clear();
    this.rings.clear();
    this.decals.clear();
  }

  dispose(): void {
    this.clear();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat) mat.dispose();
    });
    this.group.removeFromParent();
  }

  /** Nombre d'éléments actifs (débogage, banc d'essai). */
  stats(): { particles: number; active: number; grapples: number; entities: number } {
    return { particles: this.parts.count, active: this.active.length, grapples: this.grapples.size, entities: this.ents.size };
  }

  // ===================================================================== interne : outils

  private sfx(name: SfxName, p: Vec3Like, vol = 1, pitch = 1, local = false): void {
    if (!this.sound) return;
    audio.play(name, { pos: { x: p.x, y: p.y, z: p.z }, volume: vol * (local ? 1.12 : 1), pitch });
  }

  private newEnt(id: number, x: number, y: number, z: number): EntState {
    return {
      id,
      x,
      y,
      z,
      yaw: 0,
      fx: 0,
      anim: 0,
      speed: 0,
      hidden: false,
      local: id === this.selfId,
      seen: -1,
      fresh: true,
      mx: 0,
      mz: 1,
      lastT: this.time,
      shield: 0,
      shieldOn: false,
      shieldArc: 120,
      shieldBreak: 0,
      view: null,
      hitN: 0,
      chargeT: 0,
      overT: 0,
      windT: 0,
      scanT: 0,
      arcT: 0,
      acc: new Float32Array(A_N),
      ghosts: [],
      trailUntil: 0,
      trailCol: 0,
      evAt: new Map(),
      pend: [],
    };
  }

  /** État d'une entité (créé au besoin à la position p si l'entité n'a pas encore été vue). */
  private ent(id: number, p: Vec3Like | null): EntState | null {
    if (id < 0) return null;
    let e = this.ents.get(id);
    if (!e && p) {
      e = this.newEnt(id, p.x, p.y, p.z);
      this.ents.set(id, e);
    }
    return e ?? null;
  }

  private nearestShield(p: Vec3Like): EntState | null {
    let best: EntState | null = null;
    let bd = 3.5;
    for (const e of this.ents.values()) {
      if (!e.shieldOn && e.shield <= 0) continue;
      const d = Math.hypot(e.x - p.x, e.y + 1 - p.y, e.z - p.z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /**
   * Personnage à l'origine d'un effet : l'entité `id` (créée au besoin), le joueur local pour une
   * action prédite, sinon le personnage connu le plus proche de p.
   */
  private who(id: number | undefined, p: Vec3Like, local: boolean): EntState | null {
    if (id !== undefined && id >= 0) return this.ents.get(id) ?? this.ent(id, this.feet(p));
    if (local && this.selfId >= 0) {
      const me = this.ents.get(this.selfId);
      if (me) return me;
    }
    let best: EntState | null = null;
    let bd = 1.6;
    for (const e of this.ents.values()) {
      const dh = Math.hypot(e.x - p.x, e.z - p.z);
      const dy = p.y - e.y;
      if (dh < bd && dy > -0.6 && dy < 2.4) {
        bd = dh;
        best = e;
      }
    }
    return best;
  }

  /** Pieds sous p : un point donné à hauteur du corps (sol 0,35 à 1,3 m plus bas) est ramené au sol. */
  private feet(p: Vec3Like): Vec3Like {
    const g = this.groundY(p.x, p.y, p.z, 1.3);
    if (!Number.isNaN(g) && p.y - g > 0.35) return { x: p.x, y: g, z: p.z };
    return p;
  }

  /** Facteur de densité selon la distance à la caméra (0 : trop loin). */
  private lodAt(x: number, y: number, z: number): number {
    const d = Math.hypot(x - this.cam.x, y - this.cam.y, z - this.cam.z);
    if (d > this.maxDistance) return 0;
    return (d < 25 ? 1 : d < 55 ? 0.6 : 0.3) * this.quality;
  }

  /** Gerbe de particules autour de p (vitesse aléatoire de norme ≤ sp). */
  private burst(p: Vec3Like, col: number, n: number, sp: number, spec: PartSpec, up = 0.6, k = 1): void {
    const m = Math.round(n);
    for (let i = 0; i < m; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - u * u);
      const s = sp * (0.35 + 0.65 * Math.random());
      this.parts.emit(p.x, p.y, p.z, Math.cos(a) * r * s, u * s * 0.8 + up * sp * 0.5, Math.sin(a) * r * s, spec, col, k);
    }
  }

  /** Gerbe dirigée (cône d'ouverture `spread` rad autour de d). */
  private cone(p: Vec3Like, dx: number, dy: number, dz: number, spread: number, n: number, s0: number, s1: number, col: number, spec: PartSpec, k = 1): void {
    const dl = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / dl;
    const uy = dy / dl;
    const uz = dz / dl;
    const m = Math.round(n);
    for (let i = 0; i < m; i++) {
      const s = rnd(s0, s1);
      const ox = (Math.random() * 2 - 1) * spread;
      const oy = (Math.random() * 2 - 1) * spread;
      const oz = (Math.random() * 2 - 1) * spread;
      this.parts.emit(p.x, p.y, p.z, (ux + ox) * s, (uy + oy) * s, (uz + oz) * s, spec, col, k);
    }
  }

  /** Sol sous (x, y, z) dans la limite de maxD (m), ou NaN. */
  private groundY(x: number, y: number, z: number, maxD = 2.5): number {
    const d = this.world.raycast(x, y + 0.3, z, 0, -1, 0, maxD + 0.3, this.hit, 'solid');
    return d < 0 ? NaN : y + 0.3 - d;
  }

  /** Surface touchée en allant de p vers q (normale dans this.hit), ou faux. */
  private surface(p: Vec3Like, q: Vec3Like, extra = 0.6): boolean {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const dz = q.z - p.z;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-3) return false;
    const back = Math.min(l, 1.2);
    const ox = q.x - (dx / l) * back;
    const oy = q.y - (dy / l) * back;
    const oz = q.z - (dz / l) * back;
    return this.world.raycast(ox, oy, oz, dx / l, dy / l, dz / l, back + extra, this.hit, 'solid') >= 0;
  }

  /** Arc électrique dentelé de a à b, régénéré à chaque appel (scintillement). */
  private bolt(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, col: number, i: number, jag = 0.18, n = 17, branches = 1): void {
    const P = this.bp;
    const U = this.bu;
    const W = this.bw;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.02) return;
    // base orthonormée autour de la direction
    let ux = dz;
    let uy = 0;
    let uz = -dx;
    let ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-4 * len) {
      ux = 1;
      uy = 0;
      uz = 0;
      ul = 1;
    }
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const wx = (dy * uz - dz * uy) / len;
    const wy = (dz * ux - dx * uz) / len;
    const wz = (dx * uy - dy * ux) / len;
    U[0] = U[n - 1] = W[0] = W[n - 1] = 0;
    let step = n - 1;
    let amp = len * jag;
    while (step > 1) {
      const h = step >> 1;
      for (let k = h; k < n - 1; k += step) {
        U[k] = (U[k - h] + U[k + h]) * 0.5 + (Math.random() * 2 - 1) * amp;
        W[k] = (W[k - h] + W[k + h]) * 0.5 + (Math.random() * 2 - 1) * amp;
      }
      amp *= 0.52;
      step = h;
    }
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      P[k * 3] = ax + dx * t + ux * U[k] + wx * W[k];
      P[k * 3 + 1] = ay + dy * t + uy * U[k] + wy * W[k];
      P[k * 3 + 2] = az + dz * t + uz * U[k] + wz * W[k];
      this.wk[k] = 0.55 + 0.45 * Math.sin(Math.PI * t);
      this.ck[k] = 0.75 + 0.25 * Math.random();
    }
    const [r, g, b] = rgb(col, i);
    // halo large et diffus, puis le trait chauffé à blanc
    this.ribbons.strip(P, n, w * 3.2, r * 0.22, g * 0.22, b * 0.22, this.wk, this.ck);
    this.ribbons.strip(P, n, w, r, g, b, this.wk, this.ck);
    // ramifications plus fines
    for (let j = 0; j < branches; j++) {
      if (Math.random() > 0.7) continue;
      const k = 2 + Math.floor(Math.random() * (n - 5));
      const sx = P[k * 3];
      const sy = P[k * 3 + 1];
      const sz = P[k * 3 + 2];
      const bl = len * rnd(0.18, 0.4);
      const ex = sx + (dx / len) * bl * 0.6 + rnd(-1, 1) * bl * 0.6;
      const ey = sy + (dy / len) * bl * 0.6 + rnd(-1, 1) * bl * 0.6;
      const ez = sz + (dz / len) * bl * 0.6 + rnd(-1, 1) * bl * 0.6;
      this.bolt(sx, sy, sz, ex, ey, ez, w * 0.55, col, i * 0.7, jag * 1.2, 9, 0);
    }
  }

  /** Silhouette rémanente en blocs (tête, torse, bassin, bras, jambes) ; pieds en (x, y, z). */
  private ghost(x: number, y: number, z: number, yaw: number, col: number, i: number, lean = 0.15, stride = 0.4): void {
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const sl = Math.sin(lean);
    const cl = Math.cos(lean);
    const B = this.blocks;
    // (droite, haut, avant) → monde, avec inclinaison vers l'avant autour des pieds
    const put = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, pitch: number) => {
      const fy = ly * cl - lz * sl;
      const fz = lz * cl + ly * sl;
      B.box(x - c * lx + s * fz, y + fy, z + s * lx + c * fz, sx, sy, sz, yaw, lean + pitch, col, i);
    };
    put(0, 1.63, 0, 0.22, 0.24, 0.22, 0);
    put(0, 1.27, 0, 0.42, 0.48, 0.23, 0);
    put(0, 0.97, 0, 0.34, 0.16, 0.2, 0);
    put(-0.29, 1.2, 0.05 * stride, 0.11, 0.5, 0.11, -stride * 0.8);
    put(0.29, 1.2, -0.05 * stride, 0.11, 0.5, 0.11, stride * 0.8);
    put(-0.1, 0.46, 0.14 * stride, 0.14, 0.86, 0.15, -stride * 0.7);
    put(0.1, 0.46, -0.14 * stride, 0.14, 0.86, 0.15, stride * 0.7);
  }

  /**
   * Point au hasard autour du corps (cylindre), pieds en (x, y, z) ; `out` m au-delà de la surface
   * (sinon le personnage masque l'effet).
   */
  private bodyPt(e: { x: number; y: number; z: number }, out: THREE.Vector3, h0 = 0.15, h1 = 1.75, off = 0.05): THREE.Vector3 {
    const h = rnd(h0, h1);
    const r = (h > 1.48 ? 0.14 : h < 0.85 ? 0.16 : 0.24) + off;
    const a = Math.random() * Math.PI * 2;
    return out.set(e.x + Math.cos(a) * r, e.y + h, e.z + Math.sin(a) * r);
  }

  /** Main (gauche −1, droite +1) estimée, bras levé devant. */
  private hand(e: EntState, side: number, out: THREE.Vector3): THREE.Vector3 {
    const s = Math.sin(e.yaw);
    const c = Math.cos(e.yaw);
    return out.set(e.x + s * 0.34 - c * 0.24 * side, e.y + 1.2, e.z + c * 0.34 + s * 0.24 * side);
  }

  private addActive(dur: number, step: (a: Active, dt: number) => void): void {
    if (this.active.length > 160) this.active.shift();
    this.active.push({ t: 0, dur, step });
  }

  // ===================================================================== grappin

  private newGrapple(id: number, p: Vec3Like, p2: Vec3Like, dur: number, col: number, local: boolean): GrappleState {
    const g: GrappleState = {
      from: new THREE.Vector3(p.x, p.y, p.z),
      to: new THREE.Vector3(p2.x, p2.y, p2.z),
      phase: 'fire',
      t: 0,
      k: 0,
      dur: dur > 0 ? dur : Math.max(0.08, Math.hypot(p2.x - p.x, p2.y - p.y, p2.z - p.z) / 70),
      driven: false,
      touched: this.time,
      fromSet: false,
      n: new THREE.Vector3(0, 1, 0),
      col,
      local,
      attachedAt: 0,
      back: new THREE.Vector3(),
    };
    this.anchorNormal(g);
    this.grapples.set(id, g);
    return g;
  }

  /** Normale de la surface où le crochet se plante (sinon : vers le tireur). */
  private anchorNormal(g: GrappleState): void {
    if (this.surface(g.from, g.to)) g.n.set(this.hit.nx, this.hit.ny, this.hit.nz);
    else g.n.subVectors(g.from, g.to).normalize();
  }

  private grappleAttach(g: GrappleState): void {
    g.phase = 'attached';
    g.t = 0;
    g.k = 1;
    g.attachedAt = this.time;
    this.sfx('grapple_hit', g.to, 1, rnd(0.95, 1.05), g.local);
    const lod = this.lodAt(g.to.x, g.to.y, g.to.z);
    if (lod <= 0) return;
    const n = g.n;
    this.rings.add(g.to.x + n.x * 0.03, g.to.y + n.y * 0.03, g.to.z + n.z * 0.03, n.x, n.y, n.z, 0.05, 0.4, 0.05, 0.14, 0xdff8ff, 1.6, RING.FLASH);
    this.rings.add(g.to.x + n.x * 0.04, g.to.y + n.y * 0.04, g.to.z + n.z * 0.04, n.x, n.y, n.z, 0.08, 1.0, 0.045, 0.4, g.col, 1.1, RING.ENERGY);
    this.cone(g.to, n.x, n.y + 0.3, n.z, 0.75, 22 * lod, 2, 6, COL.spark, SP.spark, 1.4);
    this.parts.emit(g.to.x + n.x * 0.05, g.to.y + n.y * 0.05, g.to.z + n.z * 0.05, 0, 0, 0, SP.flash, g.col, 0.6);
    this.effects?.addSmoke(g.to.x + n.x * 0.15, g.to.y + n.y * 0.15, g.to.z + n.z * 0.15, n.x * 0.4, 0.2, n.z * 0.4, 1.0, 0.08, 0.35, 0.6, 0.35);
    this.effects?.light(g.to, g.col, 3, 0.15, 5);
  }

  private grappleRetract(g: GrappleState): void {
    // le crochet repart de là où il est (en vol ou accroché)
    const k = g.phase === 'fire' ? 1 - (1 - g.k) * (1 - g.k) : 1;
    g.back.copy(g.from).lerp(g.to, k);
    g.phase = 'retract';
    g.t = 0;
    g.k = 0;
  }

  private updateGrapples(dt: number): void {
    for (const [id, g] of this.grapples) {
      const e = this.ents.get(id);
      if (!g.fromSet && e) this.hand(e, 1, g.from);
      g.fromSet = false;
      g.t += dt;
      if (g.driven) {
        // l'appelant ne donne plus de nouvelles : on retire le câble
        if (this.time - g.touched > 0.6) {
          this.grapples.delete(id);
          continue;
        }
      } else {
        if (g.phase === 'fire') {
          g.k = Math.min(1, g.t / g.dur);
          if (g.k >= 1) this.grappleAttach(g);
        } else if (g.phase === 'retract') g.k = Math.min(1, g.t / 0.24);
        // câble lâché sans événement (bit éteint) ou entité inconnue depuis longtemps : retour du crochet
        if (g.phase === 'attached' && g.t > 0.35 && (e ? e.seen > 0 && !((e.fx ?? 0) & CFX.GRAPPLE) : g.t > 8)) this.grappleRetract(g);
        if (g.phase === 'retract' && g.k >= 1) {
          this.grapples.delete(id);
          continue;
        }
      }
      this.drawGrapple(g);
    }
  }

  private drawGrapple(g: GrappleState): void {
    const P = this.cable;
    const N = 32;
    const a = g.from;
    let hx: number;
    let hy: number;
    let hz: number;
    let wave = 0;
    let sag = 0;
    let ext = 1;
    if (g.phase === 'fire') {
      const k = g.k;
      const e = 1 - (1 - k) * (1 - k);
      hx = a.x + (g.to.x - a.x) * e;
      hy = a.y + (g.to.y - a.y) * e;
      hz = a.z + (g.to.z - a.z) * e;
      wave = 0.14 * (1 - k);
      sag = 0.35 * (1 - k * 0.6);
    } else if (g.phase === 'attached') {
      hx = g.to.x;
      hy = g.to.y;
      hz = g.to.z;
      // vibration du câble tendu juste après l'accroche
      wave = 0.07 * Math.exp(-g.t * 7);
    } else {
      const k = g.k;
      const e = k * k;
      hx = g.back.x + (a.x - g.back.x) * e;
      hy = g.back.y + (a.y - g.back.y) * e;
      hz = g.back.z + (a.z - g.back.z) * e;
      wave = 0.12 + 0.2 * k;
      ext = 1 - k;
      sag = 0.2;
    }
    const dx = hx - a.x;
    const dy = hy - a.y;
    const dz = hz - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.05) return;
    // perpendiculaire « latérale » pour l'ondulation
    let px = -dz;
    let pz = dx;
    const pl = Math.hypot(px, pz) || 1;
    px /= pl;
    pz /= pl;
    const freq = Math.max(2, len / 2.2);
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const env = Math.sin(Math.PI * t);
      const w = Math.sin(t * freq * Math.PI * 2 - this.time * 30) * wave * env * Math.min(1, len / 4);
      const s = -sag * env * Math.min(1, len / 10);
      P[i * 3] = a.x + dx * t + px * w;
      P[i * 3 + 1] = a.y + dy * t + s + w * 0.4;
      P[i * 3 + 2] = a.z + dz * t + pz * w;
      this.wk[i] = 1;
      this.ck[i] = (0.75 + 0.25 * t) * ext + 0.25;
    }
    const [r, gg, b] = rgb(g.col, 1.35);
    const reel = g.phase === 'attached';
    this.ribbons.strip(P, N, 0.11, r * 0.16, gg * 0.16, b * 0.16, this.wk, this.ck);
    this.ribbons.strip(P, N, 0.034, r, gg, b, this.wk, this.ck, reel ? 1.3 : 0, reel ? -7 : 0);
    // crochet
    _v1.set(dx, dy, dz).normalize();
    if (g.phase === 'retract') _v1.negate();
    _q.setFromUnitVectors(Z_AXIS, _v1);
    _m.compose(_v2.set(hx, hy, hz), _q, _s1);
    this.hooks.put(_m);
    // diode et lueur du crochet
    const blink = g.phase === 'attached' ? (Math.sin(this.time * 18) > 0 ? 1 : 0.35) : 1;
    this.shells.put(hx, hy, hz, 0.06, 0.06, 0.06, 0, g.col, 1.2 * blink, 1.2);
    if (g.phase === 'fire' && Math.random() < 0.8 * this.quality) this.parts.emit(hx, hy, hz, rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(-0.5, 0.5), SP.sparkHot, g.col, 0.8);
  }

  // ===================================================================== entités

  private transitions(e: EntState, fx: number, anim: number): void {
    const rise = fx & ~e.fx;
    const fall = e.fx & ~fx;
    const now = this.time;
    const pend = (kind: string, on: boolean) => e.pend.push({ kind, at: now, on });
    if (rise & CFX.SHIELD) pend('bouclier', true);
    if (fall & CFX.SHIELD) pend('bouclier', false);
    if (rise & CFX.CAMO) pend('camouflage', true);
    if (fall & CFX.CAMO) pend('camouflage', false);
    if (rise & CFX.SECOND_WIND) pend('secondSouffle', true);
    if (rise & CFX.CHARGE) {
      e.chargeT = 0;
      pend('poing-charge', true);
    }
    if (rise & CFX.OVERCHARGE) e.overT = 0;
    if (rise & CFX.SECOND_WIND) e.windT = 0;
    if (rise & CFX.SCAN) e.scanT = 0;
    if (fall & CFX.REFLEX) this.sfx('reflex_off', { x: e.x, y: e.y + 1.6, z: e.z }, e.local ? 0.9 : 0.6);
    if (fall & CFX.OVERCHARGE && this.lodAt(e.x, e.y, e.z) > 0) this.burst({ x: e.x, y: e.y + 1, z: e.z }, COL.over, 10 * this.quality, 1.5, SP.spark);
    if (anim !== e.anim) {
      if (anim === Anim.SLIDE) pend('glissade', true);
      // (joueur local : play('bond-charge') au moment où il s'accroupit)
      if (anim === Anim.LEAP && !e.local && e.speed < 1.5) this.sfx('leap_charge', { x: e.x, y: e.y + 0.4, z: e.z }, 0.75);
      if (anim === Anim.WALLRUN_L || anim === Anim.WALLRUN_R) e.acc[A_STEP] = 0.2;
    }
  }

  /** Fronts d'état sans événement correspondant (événement perdu ou joueur arrivé en cours) : effet de repli. */
  private resolvePending(e: EntState): void {
    if (!e.pend.length) return;
    const now = this.time;
    for (let i = e.pend.length - 1; i >= 0; i--) {
      const pd = e.pend[i];
      if (now - pd.at < 0.3) continue;
      e.pend.splice(i, 1);
      const evKind = pd.on ? pd.kind : `${pd.kind}-fin`;
      const ev = e.evAt.get(evKind) ?? -1e9;
      if (Math.abs(ev - pd.at) < 0.8) continue;
      const p = { x: e.x, y: e.y, z: e.z };
      if (pd.kind === 'bouclier') {
        if (pd.on) {
          e.shieldOn = true;
          this.sfx('shield_up', p, 0.9);
        } else {
          if ((e.evAt.get('bouclier-brise') ?? -1e9) > pd.at - 0.8) continue;
          e.shieldOn = false;
          this.sfx('shield_down', p, 0.9);
        }
      } else if (pd.kind === 'camouflage') {
        if ((e.evAt.get(pd.on ? 'camouflage' : 'camouflage-fin') ?? -1e9) > pd.at - 0.8) continue;
        this.sfx(pd.on ? 'camo_on' : 'camo_off', p, 0.9);
        if (this.lodAt(e.x, e.y, e.z) > 0) this.camoBurst(p, pd.on, COL.camo, this.quality);
      } else if (pd.kind === 'secondSouffle') {
        this.sfx('second_wind', p);
        if (this.lodAt(e.x, e.y, e.z) > 0) this.secondWind(p, COL.secondWind, this.quality);
      } else if (pd.kind === 'poing-charge') {
        this.sfx('fist_charge', p, 0.9);
      } else if (pd.kind === 'glissade') {
        this.sfx('slide_start', p, 0.9);
        if (this.lodAt(e.x, e.y, e.z) > 0) this.slideStart(p, { x: e.x + e.mx, y: e.y, z: e.z + e.mz }, this.quality);
      }
    }
  }

  private updateEnt(e: EntState, dt: number): void {
    this.resolvePending(e);
    const fx = e.fx;
    // bouclier (même invisible en vue subjective : il est devant soi)
    const shTarget = e.shieldOn ? 1 : 0;
    if (e.shieldBreak > 0) e.shieldBreak += dt * 1.6;
    else e.shield += (shTarget - e.shield) * Math.min(1, dt * (shTarget > e.shield ? 7 : 9));
    if (e.shield > 0.004 || e.shieldBreak > 0) this.drawShield(e, dt);
    else if (e.view) {
      e.view.mesh.visible = false;
      e.view.owner = -1;
      e.view = null;
    }
    if (fx & CFX.CHARGE) e.chargeT += dt;
    // le reste suit le corps : rien si le personnage n'est pas dessiné ou trop loin
    if (e.hidden) {
      e.ghosts.length = 0;
      return;
    }
    const lod = this.lodAt(e.x, e.y + 1, e.z);
    if (lod <= 0) {
      e.ghosts.length = 0;
      return;
    }
    const acc = e.acc;
    const t = this.time;
    const s = Math.sin(e.yaw);
    const c = Math.cos(e.yaw);
    // ---------------------------------------------------------------- brûlure
    if (fx & CFX.BURN) {
      acc[A_FLAME] += dt * 70 * lod;
      while (acc[A_FLAME] >= 1) {
        acc[A_FLAME]--;
        // langues de flamme qui lèchent le corps (plus nourries sur le torse et les jambes)
        this.bodyPt(e, _v1, 0.1, 1.55, 0.1);
        this.parts.emit(_v1.x, _v1.y, _v1.z, rnd(-0.3, 0.3), rnd(1.0, 2.0), rnd(-0.3, 0.3), SP.flame, Math.random() < 0.3 ? 0xffb040 : COL.fire, rnd(0.75, 1.3));
      }
      acc[A_EMBER] += dt * 9 * lod;
      while (acc[A_EMBER] >= 1) {
        acc[A_EMBER]--;
        this.bodyPt(e, _v1, 0.3, 1.6);
        this.parts.emit(_v1.x, _v1.y, _v1.z, rnd(-0.6, 0.6), rnd(0.6, 1.8), rnd(-0.6, 0.6), SP.ember, 0xffb050);
      }
      acc[A_SMOKE] += dt * 2.5 * lod;
      while (acc[A_SMOKE] >= 1) {
        acc[A_SMOKE]--;
        this.effects?.addSmoke(e.x + rnd(-0.2, 0.2), e.y + 1.6, e.z + rnd(-0.2, 0.2), rnd(-0.1, 0.1), 0.8, rnd(-0.1, 0.1), 1.6, 0.12, 0.35, 0.22, 0.4);
      }
    }
    // ---------------------------------------------------------------- décharge électrique
    if (fx & (CFX.SHOCK | CFX.STUN)) {
      e.arcT -= dt;
      const shock = (fx & CFX.SHOCK) !== 0;
      const nArcs = shock ? 5 : 1;
      if (shock || e.arcT < 0.05) {
        for (let k = 0; k < nArcs; k++) {
          if (Math.random() > (shock ? 0.8 : 0.6)) continue;
          // arc qui rampe d'un point du corps à un autre
          this.bodyPt(e, _v1, 0.2, 1.75, 0.07);
          this.bodyPt(e, _v2, Math.max(0.15, _v1.y - e.y - 0.6), Math.min(1.8, _v1.y - e.y + 0.6), 0.07);
          this.bolt(_v1.x, _v1.y, _v1.z, _v2.x, _v2.y, _v2.z, 0.06, shock ? COL.shock : COL.stun, 1.4, 0.3, 9, 0);
        }
      }
      if (e.arcT < 0) e.arcT = rnd(0.12, 0.3);
      acc[A_SPARK] += dt * (shock ? 16 : 5) * lod;
      while (acc[A_SPARK] >= 1) {
        acc[A_SPARK]--;
        this.bodyPt(e, _v1);
        this.burst(_v1, shock ? 0xcffcff : COL.stun, 1, 2.5, SP.spark);
      }
      if (fx & CFX.STUN) {
        // petites étincelles qui tournent au-dessus de la tête (étourdi)
        for (let k = 0; k < 3; k++) {
          const a = t * 5.5 + (k * Math.PI * 2) / 3;
          this.parts.emit(e.x + Math.cos(a) * 0.3, e.y + 1.95 + Math.sin(t * 7 + k) * 0.03, e.z + Math.sin(a) * 0.3, 0, 0, 0, SP.stunStar, COL.stun);
        }
      }
    }
    // ---------------------------------------------------------------- surcharge défensive
    if (fx & CFX.OVERCHARGE) {
      e.overT += dt;
      const pulse = 0.7 + 0.3 * Math.sin(t * 9);
      this.shells.put(e.x, e.y + 0.95, e.z, 0.5, 1.02, 0.5, e.yaw, COL.over, 0.8 * pulse, 2.4, SHELL.CRACKLE, e.id * 7.3);
      this.shells.put(e.x, e.y + 0.95, e.z, 0.44, 0.96, 0.44, e.yaw, 0xff8a40, 0.22, 4);
      if (Math.random() < 0.55) {
        this.bodyPt(e, _v1, 0.3, 1.7);
        _v2.set(_v1.x + rnd(-0.4, 0.4), _v1.y + rnd(-0.4, 0.5), _v1.z + rnd(-0.4, 0.4));
        this.bolt(_v1.x, _v1.y, _v1.z, _v2.x, _v2.y, _v2.z, 0.045, 0xff4a30, 1, 0.3, 9, 0);
      }
      acc[A_SPARK] += dt * 10 * lod;
      while (acc[A_SPARK] >= 1) {
        acc[A_SPARK]--;
        this.bodyPt(e, _v1);
        this.parts.emit(_v1.x, _v1.y, _v1.z, rnd(-0.4, 0.4), rnd(0.5, 1.5), rnd(-0.4, 0.4), SP.mote, 0xff5030);
      }
    }
    // ---------------------------------------------------------------- réflexes : images rémanentes
    if (fx & CFX.REFLEX) {
      if (e.speed > 1.5) {
        acc[A_GHOST] += dt;
        if (acc[A_GHOST] > 0.075) {
          acc[A_GHOST] = 0;
          if (e.ghosts.length > 7) e.ghosts.shift();
          e.ghosts.push({ x: e.x, y: e.y, z: e.z, yaw: Math.atan2(e.mx, e.mz), t: 0, life: 0.3, col: COL.reflex, i: 0.38, lean: Math.min(0.3, e.speed * 0.025), stride: 0.45 });
        }
      }
      // halo doré autour de la tête (cerveau en surrégime)
      this.shells.put(e.x, e.y + 1.62, e.z, 0.2, 0.2, 0.2, 0, COL.reflexGold, 0.5 + 0.2 * Math.sin(t * 12), 1.8);
    }
    if (e.ghosts.length) {
      for (let k = e.ghosts.length - 1; k >= 0; k--) {
        const g = e.ghosts[k];
        g.t += dt;
        if (g.t >= g.life) {
          e.ghosts.splice(k, 1);
          continue;
        }
        const f = 1 - g.t / g.life;
        this.ghost(g.x, g.y, g.z, g.yaw, g.col, g.i * f * f, g.lean, g.stride);
      }
    }
    // ---------------------------------------------------------------- cœur de secours
    if (fx & CFX.SECOND_WIND) {
      e.windT += dt;
      // battements (« lub-dub ») : deux impulsions toutes les 0,85 s
      const ph = e.windT % 0.85;
      const beat = Math.exp(-ph * 9) + 0.7 * Math.exp(-Math.max(0, ph - 0.2) * 9) * (ph > 0.2 ? 1 : 0);
      this.shells.put(e.x, e.y + 0.95, e.z, 0.4, 0.95, 0.4, e.yaw, COL.secondWind, 0.1 + 0.45 * beat, 3.5);
      const r = 0.45 + (ph / 0.85) * 1.2;
      this.shells.put(e.x, e.y + 1.0, e.z, r, r * 1.25, r, 0, COL.secondWind, 0.45 * (1 - ph / 0.85) * (1 - ph / 0.85), 3.5);
      acc[A_WIND] += dt * 14 * lod;
      while (acc[A_WIND] >= 1) {
        acc[A_WIND]--;
        this.bodyPt(e, _v1);
        this.parts.emit(_v1.x, _v1.y, _v1.z, rnd(-0.2, 0.2), rnd(0.6, 1.4), rnd(-0.2, 0.2), Math.random() < 0.35 ? SP.heal : SP.mote, COL.secondWind);
      }
    }
    // ---------------------------------------------------------------- impulsion de scan (balayage des yeux)
    if (fx & CFX.SCAN) {
      e.scanT += dt;
      const ex = e.x + s * 0.12;
      const ey = e.y + 1.62;
      const ez = e.z + c * 0.12;
      const L = 5.5;
      for (let k = 0; k < 5; k++) {
        const a = e.yaw + Math.sin((e.scanT - k * 0.035) * 3.2) * 0.62;
        const pitch = -0.12 + Math.sin(e.scanT * 1.3) * 0.05;
        const i = k === 0 ? 1.3 : 0.45 * (1 - k / 5);
        const P = this.bp;
        P[0] = ex;
        P[1] = ey;
        P[2] = ez;
        P[3] = ex + Math.sin(a) * L * Math.cos(pitch);
        P[4] = ey + Math.sin(pitch) * L;
        P[5] = ez + Math.cos(a) * L * Math.cos(pitch);
        this.wk[0] = 0.4;
        this.wk[1] = 1;
        this.ck[0] = 1;
        this.ck[1] = 0.05;
        const [r, g, b] = rgb(COL.scan, i);
        this.ribbons.strip(P, 2, k === 0 ? 0.035 : 0.06, r, g, b, this.wk, this.ck);
      }
      this.shells.put(ex, ey, ez, 0.07, 0.04, 0.07, e.yaw, COL.scan, 1.2, 1.2);
    }
    // ---------------------------------------------------------------- sprint renforcé : traits de vitesse
    if (fx & CFX.SPRINT && e.speed > 4.5) {
      acc[A_SPRINT] += dt * 60 * lod;
      while (acc[A_SPRINT] >= 1) {
        acc[A_SPRINT]--;
        const side = sgn();
        const h = rnd(0.12, 0.95);
        this.parts.emit(e.x - c * 0.14 * side + rnd(-0.05, 0.05), e.y + h, e.z + s * 0.14 * side + rnd(-0.05, 0.05), -e.mx * rnd(2, 4), rnd(-0.1, 0.2), -e.mz * rnd(2, 4), SP.streak, COL.sprint, rnd(0.8, 1.2));
      }
    }
    // ---------------------------------------------------------------- poing chargé
    if (fx & CFX.CHARGE) {
      const side = fx & CFX.ARM_L && !(fx & CFX.ARM_R) ? -1 : 1;
      this.hand(e, side, _v1);
      const k = Math.min(1, e.chargeT / 1.0);
      const fl = 0.85 + 0.15 * Math.sin(t * 40);
      this.shells.put(_v1.x, _v1.y, _v1.z, 0.08 + 0.1 * k, 0.08 + 0.1 * k, 0.08 + 0.1 * k, 0, COL.fist, (0.6 + 1.2 * k) * fl, 1.1);
      if (Math.random() < 0.9 * lod) {
        // énergie aspirée vers le poing
        const a = Math.random() * Math.PI * 2;
        const u = rnd(-1, 1);
        const r = Math.sqrt(1 - u * u);
        const R = rnd(0.35, 0.6);
        this.parts.emit(_v1.x + Math.cos(a) * r * R, _v1.y + u * R, _v1.z + Math.sin(a) * r * R, -Math.cos(a) * r * R * 4, -u * R * 4, -Math.sin(a) * r * R * 4, SP.suck, k > 0.95 ? 0xfff0c0 : COL.fist);
      }
      if (k > 0.45 && Math.random() < 0.35) this.bolt(_v1.x, _v1.y, _v1.z, _v1.x + rnd(-0.25, 0.25), _v1.y + rnd(-0.25, 0.25), _v1.z + rnd(-0.25, 0.25), 0.03, COL.fist, 1.2, 0.3, 5, 0);
    }
    // ---------------------------------------------------------------- mouvements
    const anim = e.anim;
    if (anim === Anim.SLIDE && e.speed > 1) {
      // étincelles et poussière sous les pieds (pieds en avant)
      const fx0 = e.x + e.mx * 0.45;
      const fz0 = e.z + e.mz * 0.45;
      acc[A_SLIDE] += dt * 60 * lod * Math.min(1.5, e.speed / 7);
      while (acc[A_SLIDE] >= 1) {
        acc[A_SLIDE]--;
        const side = rnd(-0.12, 0.12);
        this.parts.emit(fx0 - e.mz * side, e.y + 0.04, fz0 + e.mx * side, -e.mx * rnd(1.5, 4.5) + rnd(-0.8, 0.8), rnd(0.4, 1.8), -e.mz * rnd(1.5, 4.5) + rnd(-0.8, 0.8), SP.spark, Math.random() < 0.3 ? 0xfff0c0 : COL.slide);
      }
      acc[A_DUST] += dt * 12 * lod;
      while (acc[A_DUST] >= 1) {
        acc[A_DUST]--;
        this.effects?.addSmoke(e.x + rnd(-0.2, 0.2), e.y + 0.1, e.z + rnd(-0.2, 0.2), -e.mx * 0.6 + rnd(-0.2, 0.2), 0.25, -e.mz * 0.6 + rnd(-0.2, 0.2), 0.9, 0.08, 0.4, 0.62, 0.4);
      }
    } else if (anim === Anim.WALLRUN_L || anim === Anim.WALLRUN_R) {
      // étincelles au contact du mur, propulseurs verts
      const side = anim === Anim.WALLRUN_R ? 1 : -1;
      const wx = e.x - c * 0.36 * side;
      const wz = e.z + s * 0.36 * side;
      // point de contact chauffé, étincelles qui giclent vers l'arrière
      this.parts.emit(wx, e.y + 0.3, wz, 0, 0, 0, SP.contact, COL.wall, 0.9 + 0.3 * Math.random());
      acc[A_WALL] += dt * 70 * lod;
      while (acc[A_WALL] >= 1) {
        acc[A_WALL]--;
        this.parts.emit(wx, e.y + rnd(0.15, 0.6), wz, -e.mx * rnd(1, 3) + c * side * rnd(0.3, 1.5), rnd(-0.5, 1.2), -e.mz * rnd(1, 3) - s * side * rnd(0.3, 1.5), SP.spark, Math.random() < 0.4 ? COL.wall : COL.spark);
      }
      acc[A_MOTE] += dt * 18 * lod;
      while (acc[A_MOTE] >= 1) {
        acc[A_MOTE]--;
        this.parts.emit(e.x + rnd(-0.1, 0.1), e.y + rnd(0.1, 0.5), e.z + rnd(-0.1, 0.1), -e.mx * 2.5, -0.6, -e.mz * 2.5, SP.thrust, COL.wall, 0.7);
      }
      acc[A_STEP] -= dt;
      if (acc[A_STEP] <= 0) {
        acc[A_STEP] = 0.24;
        this.sfx('wallrun_step', { x: wx, y: e.y + 0.4, z: wz }, e.local ? 0.9 : 0.8, rnd(0.95, 1.08));
      }
    } else if (anim === Anim.DASH) {
      this.cone({ x: e.x, y: e.y + 0.35, z: e.z }, -e.mx, -0.15, -e.mz, 0.25, 3 * lod, 2, 5, COL.dash, SP.thrust);
    } else if (anim === Anim.LEAP) {
      if (e.speed < 1.2) {
        // vérins comprimés : énergie qui converge vers les jambes
        if (Math.random() < 0.8 * lod) {
          const a = Math.random() * Math.PI * 2;
          const R = rnd(0.4, 0.7);
          this.parts.emit(e.x + Math.cos(a) * R, e.y + rnd(0.05, 0.5), e.z + Math.sin(a) * R, -Math.cos(a) * R * 3, rnd(-0.2, 0.2), -Math.sin(a) * R * 3, SP.leapIn, COL.leap);
        }
        this.shells.put(e.x, e.y + 0.3, e.z, 0.32, 0.3, 0.32, e.yaw, COL.leap, 0.12 + 0.08 * Math.sin(t * 20), 3.5);
      }
    }
    // traînée du bond chargé
    if (e.trailUntil > t && e.speed > 1) {
      acc[A_MOTE] += dt * 40 * lod;
      while (acc[A_MOTE] >= 1) {
        acc[A_MOTE]--;
        this.parts.emit(e.x + rnd(-0.15, 0.15), e.y + rnd(0.1, 1.5), e.z + rnd(-0.15, 0.15), -e.mx * 1.5, -0.4, -e.mz * 1.5, SP.streak, e.trailCol, 1.1);
      }
    }
  }

  // ===================================================================== bouclier

  private drawShield(e: EntState, dt: number): void {
    if (!e.view) {
      const v = this.shields.find((x) => x.owner < 0) ?? null;
      if (!v) return;
      v.owner = e.id;
      for (const h of v.hits) h.w = -1;
      e.view = v;
    }
    const v = e.view;
    const u = v.mat.uniforms;
    for (const h of v.hits) if (h.w >= 0) h.w = h.w + dt > 1 ? -1 : h.w + dt;
    if (e.shieldBreak > 1) {
      e.shieldBreak = 0;
      e.shield = 0;
      e.shieldOn = false;
      v.mesh.visible = false;
      v.owner = -1;
      e.view = null;
      return;
    }
    const arc = Math.min(360, Math.max(30, e.shieldArc || 120));
    u.uArc.value = arc >= 359 ? Math.PI + 0.01 : ((arc / 2) * Math.PI) / 180;
    u.uOpen.value = e.shieldBreak > 0 ? 1 : e.shield;
    u.uBreak.value = e.shieldBreak;
    u.uInside.value = e.local && e.hidden ? 1 : 0;
    u.uI.value = (e.local && e.hidden ? 0.55 : 1) * (e.shieldOn || e.shieldBreak > 0 ? 1 : Math.min(1, e.shield * 1.6));
    (u.uColor.value as THREE.Color).setRGB(...rgb(COL.shield));
    const R = arc >= 359 ? 1.25 : 1.2;
    u.uRadius.value = R;
    v.mesh.position.set(e.x, e.y + 0.98, e.z);
    v.mesh.rotation.set(0, e.yaw, 0);
    v.mesh.scale.set(R, R * 1.05, R);
    v.mesh.visible = true;
  }

  private shieldHit(e: EntState, p: Vec3Like): void {
    const v = e.view;
    if (!v) return;
    // direction de l'impact dans le repère du bouclier (rotation inverse de yaw)
    const dx = p.x - e.x;
    const dy = p.y - (e.y + 0.98);
    const dz = p.z - e.z;
    const s = Math.sin(-e.yaw);
    const c = Math.cos(-e.yaw);
    const lx = dx * c + dz * s;
    const lz = -dx * s + dz * c;
    const l = Math.hypot(lx, dy, lz) || 1;
    const h = v.hits[e.hitN++ % 4];
    h.set(lx / l, dy / l, lz / l, 0);
  }

  private shieldShatter(e: EntState, lod: number): void {
    e.shieldBreak = 0.001;
    e.shieldOn = false;
    if (!e.view) e.shield = 1;
    if (lod <= 0) return;
    const cx = e.x;
    const cy = e.y + 0.98;
    const cz = e.z;
    const arc = ((Math.min(360, e.shieldArc || 120) / 2) * Math.PI) / 180;
    // éclats hexagonaux projetés depuis la surface du bouclier
    const n = Math.round(46 * lod);
    for (let i = 0; i < n; i++) {
      const a = e.yaw + rnd(-arc, arc);
      const el = rnd(-0.6, 0.9);
      const dx = Math.sin(a) * Math.cos(el);
      const dy = Math.sin(el);
      const dz = Math.cos(a) * Math.cos(el);
      const sp = rnd(1.5, 4.5);
      this.parts.emit(cx + dx * 1.2, cy + dy * 1.2, cz + dz * 1.2, dx * sp, dy * sp + 1, dz * sp, SP.shard, Math.random() < 0.3 ? 0xffffff : COL.shield, rnd(0.8, 1.5));
    }
    this.parts.emit(cx + Math.sin(e.yaw) * 0.9, cy, cz + Math.cos(e.yaw) * 0.9, 0, 0, 0, SP.flash, 0xdff8ff, 1.6);
    this.rings.add(cx, e.y + 0.05, cz, 0, 1, 0, 0.6, 3.2, 0.12, 0.45, COL.shield, 1.2, RING.ENERGY);
    this.effects?.light({ x: cx, y: cy, z: cz }, COL.shield, 7, 0.25, 7);
  }

  // ===================================================================== effets ponctuels

  private winch(p: Vec3Like, p2: Vec3Like, col: number, lod: number): void {
    // la cible (p) est arrachée vers le tireur (p2) : câble tendu qui la ramène
    const a = new THREE.Vector3(p2.x, p2.y + 1.25, p2.z);
    const b0 = new THREE.Vector3(p.x, p.y + 1.1, p.z);
    this.burst(b0, COL.spark, 12 * lod, 3, SP.spark);
    this.parts.emit(b0.x, b0.y, b0.z, 0, 0, 0, SP.flash, col, 0.6);
    this.addActive(0.42, (s) => {
      const k = Math.min(1, s.t / 0.38);
      const e = k * k * (3 - 2 * k);
      _v1.copy(b0).lerp(a, e * 0.85);
      const P = this.bp;
      const n = 12;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        P[i * 3] = a.x + (_v1.x - a.x) * t;
        P[i * 3 + 1] = a.y + (_v1.y - a.y) * t + Math.sin(Math.PI * t) * 0.04 * Math.sin(this.time * 60);
        P[i * 3 + 2] = a.z + (_v1.z - a.z) * t;
        this.wk[i] = 1;
        this.ck[i] = 1 - k * 0.6;
      }
      const [r, g, bb] = rgb(col, 1.2);
      this.ribbons.strip(P, n, 0.04, r, g, bb, this.wk, this.ck, 2, -12);
      if (Math.random() < lod) this.parts.emit(_v1.x + rnd(-0.2, 0.2), _v1.y + rnd(-0.5, 0.5), _v1.z + rnd(-0.2, 0.2), (a.x - b0.x) * 0.5, 0, (a.z - b0.z) * 0.5, SP.streak, col);
    });
  }

  private dash(p: Vec3Like, p2: Vec3Like, col: number, lod: number): void {
    const dx = p2.x - p.x;
    const dz = p2.z - p.z;
    const dy = p2.y - p.y;
    const len = Math.hypot(dx, dz) || 1e-3;
    const yaw = Math.atan2(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    // poussée des propulseurs au départ
    this.cone({ x: p.x, y: p.y + 0.4, z: p.z }, -ux, -0.1, -uz, 0.3, 22 * lod, 3, 7, col, SP.thrust);
    this.rings.add(p.x + ux * 0.3, p.y + 1.0, p.z + uz * 0.3, ux, 0, uz, 0.2, 1.3, 0.08, 0.3, col, 1.1, RING.ENERGY);
    this.rings.add(p.x, p.y + 0.05, p.z, 0, 1, 0, 0.2, 1.4, 0.1, 0.35, 0xd8f4ff, 0.5, RING.SHOCK);
    if (!Number.isNaN(this.groundY(p.x, p.y, p.z, 0.4))) {
      for (let i = 0; i < 4 * lod; i++) this.effects?.addSmoke(p.x + rnd(-0.3, 0.3), p.y + 0.1, p.z + rnd(-0.3, 0.3), -ux * rnd(0.5, 1.5), 0.3, -uz * rnd(0.5, 1.5), 1, 0.1, 0.45, 0.62, 0.35);
    }
    // silhouettes laissées le long de la trajectoire + traits de vitesse
    const nG = 5;
    const dur = 0.2;
    const shown = new Array(nG).fill(false);
    this.addActive(dur + 0.36, (s) => {
      for (let i = 0; i < nG; i++) {
        const ti = (i / (nG - 1)) * dur;
        const age = s.t - ti;
        if (age < 0 || age > 0.34) continue;
        shown[i] = true;
        const f = 1 - age / 0.34;
        const k = i / (nG - 1);
        this.ghost(p.x + dx * k, p.y + dy * k, p.z + dz * k, yaw, col, 0.55 * f * f, 0.32, 0.5);
      }
      const head = Math.min(1, s.t / dur);
      const tail = Math.max(0, (s.t - 0.12) / (dur + 0.22));
      if (tail >= head) return;
      const P = this.bp;
      for (const [hgt, side] of [
        [0.45, 0.2],
        [1.0, -0.25],
        [1.45, 0.15],
        [0.75, 0],
      ]) {
        const ox = -uz * side;
        const oz = ux * side;
        P[0] = p.x + dx * tail + ox;
        P[1] = p.y + dy * tail + hgt;
        P[2] = p.z + dz * tail + oz;
        P[3] = p.x + dx * head + ox;
        P[4] = p.y + dy * head + hgt;
        P[5] = p.z + dz * head + oz;
        this.wk[0] = 0.3;
        this.wk[1] = 1;
        this.ck[0] = 0.1;
        this.ck[1] = 1;
        const [r, g, b] = rgb(col, 0.9 * (1 - tail));
        this.ribbons.strip(P, 2, 0.05, r, g, b, this.wk, this.ck);
      }
    });
  }

  private airJump(p: Vec3Like, col: number, lod: number): void {
    // jets des talons vers le bas, onde d'air horizontale
    for (const side of [-1, 1]) this.cone({ x: p.x + side * 0.1, y: p.y + 0.05, z: p.z }, 0, -1, 0, 0.22, 12 * lod, 3, 6.5, col, SP.thrust);
    this.cone({ x: p.x, y: p.y, z: p.z }, 0, -1, 0, 0.5, 8 * lod, 2, 4, 0xffffff, SP.sparkHot);
    this.rings.add(p.x, p.y - 0.05, p.z, 0, 1, 0, 0.15, 1.3, 0.07, 0.3, col, 1.3, RING.ENERGY);
    this.rings.add(p.x, p.y - 0.15, p.z, 0, 1, 0, 0.1, 2.3, 0.18, 0.45, 0xcfe8ff, 0.5, RING.SHOCK);
    this.parts.emit(p.x, p.y, p.z, 0, 0, 0, SP.glow, col, 1.2);
  }

  private leapCharge(p: Vec3Like, col: number, lod: number): void {
    // vérins comprimés : anneau qui se resserre, énergie aspirée vers les jambes
    this.rings.add(p.x, p.y + 0.04, p.z, 0, 1, 0, 1.3, 0.25, 0.06, 0.5, col, 1.1, RING.TECH, 1);
    const n = Math.round(16 * lod);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const R = rnd(0.6, 1.1);
      this.parts.emit(p.x + Math.cos(a) * R, p.y + rnd(0.05, 0.5), p.z + Math.sin(a) * R, -Math.cos(a) * R * 3, rnd(-0.2, 0.2), -Math.sin(a) * R * 3, SP.leapIn, col);
    }
  }

  private leap(p: Vec3Like, p2: Vec3Like | null | undefined, v: number, col: number, lod: number, who: EntState | null): void {
    const gy = p.y + 0.04;
    this.rings.add(p.x, gy, p.z, 0, 1, 0, 0.2, 2.2 + 2.2 * v, 0.14 + 0.08 * v, 0.45, 0xd8e8c8, 0.8, RING.SHOCK);
    this.rings.add(p.x, gy + 0.02, p.z, 0, 1, 0, 0.1, 1.4 + v, 0.06, 0.35, col, 1.3, RING.ENERGY);
    this.dustRing(p, 1, (8 + 8 * v) * lod, 2 + 2 * v);
    this.effects?.spray({ x: p.x, y: p.y + 0.1, z: p.z }, 0, 2.5 + 2 * v, 0, 2 + 1.5 * v, (6 + 10 * v) * lod, [0x5a5650, 0x6e6a62, 0x4a4640]);
    this.cone({ x: p.x, y: p.y + 0.1, z: p.z }, 0, 1, 0, 0.9, 24 * lod, 3, 8, col, SP.streak);
    this.parts.emit(p.x, p.y + 0.2, p.z, 0, 0, 0, SP.flash, col, 0.8 + 0.4 * v);
    if (v > 0.6) this.decals.add(p.x, gy, p.z, 0, 1, 0, 0.5 + 0.5 * v, 6, 0, 0.6);
    if (who) {
      who.trailUntil = this.time + 0.55 + 0.3 * v;
      who.trailCol = col;
    }
    void p2;
  }

  /** Poussière en anneau au sol (fumées d'effects.ts). */
  private dustRing(p: Vec3Like, r0: number, n: number, speed: number, shade = 0.6): void {
    const fx = this.effects;
    if (!fx) return;
    const m = Math.round(n);
    for (let i = 0; i < m; i++) {
      const a = (i / Math.max(1, m)) * Math.PI * 2 + rnd(-0.2, 0.2);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      fx.addSmoke(p.x + ca * r0 * 0.4, p.y + 0.12, p.z + sa * r0 * 0.4, ca * speed * rnd(0.6, 1), rnd(0.1, 0.4), sa * speed * rnd(0.6, 1), rnd(0.9, 1.5), rnd(0.12, 0.2), 0.55, shade, 0.45);
    }
  }

  private land(p: Vec3Like, v: number, lod: number): void {
    this.rings.add(p.x, p.y + 0.04, p.z, 0, 1, 0, 0.2, 1.2 + 1.8 * v, 0.12 + 0.08 * v, 0.4, 0xd8d0c0, 0.45 + 0.35 * v, RING.SHOCK);
    this.dustRing(p, 0.6, (6 + 10 * v) * lod, 1.5 + 2.5 * v);
    this.effects?.spray({ x: p.x, y: p.y + 0.08, z: p.z }, 0, 1.5 + 2 * v, 0, 1.5 + 1.5 * v, (4 + 8 * v) * lod, [0x5a5650, 0x6e6a62, 0x4a4640]);
    if (v > 0.5) this.decals.add(p.x, p.y + 0.01, p.z, 0, 1, 0, 0.6 + 0.6 * v, 7, 0, 0.3);
  }

  private quake(p: Vec3Like, radius: number, col: number, lod: number): void {
    const gy = p.y + 0.05;
    this.rings.add(p.x, gy, p.z, 0, 1, 0, 0.3, radius, 0.35, 0.5, col, 1.5, RING.SHOCK, 0.5);
    this.rings.add(p.x, gy + 0.02, p.z, 0, 1, 0, 0.2, radius * 0.8, 0.08, 0.38, 0xffffff, 1.2, RING.ENERGY, 0.5);
    this.rings.add(p.x, gy, p.z, 0, 1, 0, 0.1, radius * 0.45, 0.6, 0.25, 0xffa060, 0.9, RING.FLASH);
    this.dustRing(p, 1, 18 * lod, radius * 1.4, 0.55);
    this.effects?.spray({ x: p.x, y: p.y + 0.1, z: p.z }, 0, 3, 0, 3.5, 30 * lod, [0x5a5650, 0x6e6a62, 0x4a4640, 0x3a3834], 0.055, 1);
    this.burst({ x: p.x, y: p.y + 0.2, z: p.z }, COL.spark, 20 * lod, 6, SP.spark, 0.8);
    this.decals.add(p.x, p.y + 0.01, p.z, 0, 1, 0, Math.max(1, radius * 0.4), 9, 0, 1);
    this.effects?.light({ x: p.x, y: p.y + 0.6, z: p.z }, 0xffb070, 10, 0.3, radius * 2.5);
    // onde qui soulève de la poussière en s'éloignant
    this.addActive(0.45, (s) => {
      const r = 0.3 + (radius - 0.3) * (1 - Math.pow(1 - s.t / 0.45, 2));
      if (Math.random() < 0.9 * lod) {
        const a = Math.random() * Math.PI * 2;
        this.parts.emit(p.x + Math.cos(a) * r, gy + 0.05, p.z + Math.sin(a) * r, Math.cos(a) * 1.5, rnd(1, 2.5), Math.sin(a) * 1.5, SP.ember, 0xffb050);
      }
    });
  }

  private wallJump(p: Vec3Like, p2: Vec3Like | null | undefined, col: number, lod: number): void {
    let nx = p2 ? p2.x - p.x : 0;
    let ny = p2 ? p2.y - p.y : 0;
    let nz = p2 ? p2.z - p.z : 1;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    this.cone(p, nx, ny + 0.5, nz, 0.6, 22 * lod, 2.5, 6, COL.spark, SP.spark);
    this.cone(p, nx, ny - 0.3, nz, 0.45, 18 * lod, 2, 5, col, SP.thrust);
    this.rings.add(p.x + nx * 0.03, p.y + ny * 0.03, p.z + nz * 0.03, nx, ny, nz, 0.05, 0.45, 0.05, 0.16, 0xe0ffe8, 1.5, RING.FLASH);
    this.rings.add(p.x + nx * 0.04, p.y + ny * 0.04, p.z + nz * 0.04, nx, ny, nz, 0.1, 1.1, 0.06, 0.4, col, 1.2, RING.ENERGY);
    this.parts.emit(p.x + nx * 0.1, p.y + ny * 0.1, p.z + nz * 0.1, 0, 0, 0, SP.glow, col, 1.2);
    this.effects?.addSmoke(p.x + nx * 0.2, p.y + 0.4, p.z + nz * 0.2, nx * 0.6, 0.2, nz * 0.6, 0.9, 0.1, 0.4, 0.6, 0.4);
  }

  private slideStart(p: Vec3Like, p2: Vec3Like | null | undefined, lod: number): void {
    let ux = p2 ? p2.x - p.x : 0;
    let uz = p2 ? p2.z - p.z : 1;
    const l = Math.hypot(ux, uz) || 1;
    ux /= l;
    uz /= l;
    this.cone({ x: p.x + ux * 0.3, y: p.y + 0.05, z: p.z + uz * 0.3 }, -ux, 0.45, -uz, 0.45, 18 * lod, 2, 5, COL.slide, SP.spark);
    for (let i = 0; i < 4 * lod; i++) this.effects?.addSmoke(p.x + rnd(-0.2, 0.2), p.y + 0.1, p.z + rnd(-0.2, 0.2), -ux * rnd(0.5, 1.2), 0.3, -uz * rnd(0.5, 1.2), 1, 0.1, 0.45, 0.62, 0.4);
  }

  private mantle(p: Vec3Like, lod: number): void {
    for (let i = 0; i < 3 * lod; i++) this.effects?.addSmoke(p.x + rnd(-0.3, 0.3), p.y + 0.05, p.z + rnd(-0.3, 0.3), rnd(-0.3, 0.3), 0.3, rnd(-0.3, 0.3), 0.8, 0.07, 0.35, 0.62, 0.35);
    for (const side of [-0.25, 0.25]) {
      this.parts.emit(p.x + side, p.y + 0.05, p.z, 0, 0, 0, SP.glow, COL.grip, 0.5);
      this.burst({ x: p.x + side, y: p.y + 0.05, z: p.z }, COL.grip, 3 * lod, 1.5, SP.sparkHot);
    }
  }

  private slash(p: Vec3Like, p2: Vec3Like | null | undefined, targets: Vec3Like[] | undefined, col: number, lod: number): void {
    let ux = p2 ? p2.x - p.x : 0;
    let uz = p2 ? p2.z - p.z : 1;
    const l = Math.hypot(ux, uz) || 1;
    ux /= l;
    uz /= l;
    const tilt = rnd(-0.45, 0.45);
    const dir = sgn();
    const R = 1.05;
    const cx = p.x - ux * 0.35;
    const cz = p.z - uz * 0.35;
    const N = 22;
    const span = 1.25;
    this.addActive(0.3, (s) => {
      const sweep = Math.min(1, s.t / 0.075);
      const fade = s.t < 0.075 ? 1 : Math.max(0, 1 - (s.t - 0.075) / 0.2);
      const P = this.bp;
      const lead = -span + 2 * span * sweep;
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const a = dir * (-span + (lead + span) * t);
        P[i * 3] = cx + ux * Math.cos(a) * R - uz * Math.sin(a) * R;
        P[i * 3 + 1] = p.y + Math.sin(a) * R * tilt - 0.05;
        P[i * 3 + 2] = cz + uz * Math.cos(a) * R + ux * Math.sin(a) * R;
        // croissant : épais au bord d'attaque, effilé à la traîne
        this.wk[i] = Math.pow(t, 1.4) * (1 - Math.pow(t, 12) * 0.6);
        this.ck[i] = Math.pow(t, 0.8) * fade;
      }
      const [r, g, b] = rgb(col, 1.3);
      this.ribbons.strip(P, N, 0.2, r, g, b, this.wk, this.ck);
      for (let i = 0; i < N; i++) this.ck[i] *= 0.3;
      this.ribbons.strip(P, N, 0.55, r, g * 0.8, b * 0.6, this.wk, this.ck);
    });
    for (const q of targets ?? []) {
      this.cone(q, ux, 0.2, uz, 0.7, 14 * lod, 2, 5, Math.random() < 0.5 ? COL.spark : col, SP.spark);
      this.parts.emit(q.x, q.y, q.z, 0, 0, 0, SP.glow, col, 1);
    }
  }

  private punch(p: Vec3Like, p2: Vec3Like, v: number, col: number, lod: number): void {
    let dx = p2.x - p.x;
    let dy = p2.y - p.y;
    let dz = p2.z - p.z;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-3) {
      dx = 0;
      dy = 0;
      dz = 1;
    } else {
      dx /= l;
      dy /= l;
      dz /= l;
    }
    const k = 0.6 + 0.8 * v;
    this.parts.emit(p2.x, p2.y, p2.z, 0, 0, 0, SP.flash, 0xfff0d0, 0.8 * k);
    this.rings.add(p2.x, p2.y, p2.z, dx, dy, dz, 0.1, 0.9 + 1.4 * v, 0.12 + 0.1 * v, 0.32, col, 1.3, RING.SHOCK);
    this.rings.add(p2.x + dx * 0.4, p2.y + dy * 0.4, p2.z + dz * 0.4, dx, dy, dz, 0.05, 0.6 + v, 0.06, 0.25, 0xffffff, 1, RING.ENERGY);
    this.cone(p2, dx, dy + 0.2, dz, 0.55, (14 + 22 * v) * lod, 3, 8 + 6 * v, COL.spark, SP.spark);
    this.cone(p2, dx, dy, dz, 0.35, (4 + 6 * v) * lod, 1, 3, col, SP.fireJet);
    for (let i = 0; i < (2 + 4 * v) * lod; i++) this.effects?.addSmoke(p2.x, p2.y, p2.z, dx * rnd(1, 3), rnd(0, 0.6), dz * rnd(1, 3), 1.1, 0.1, 0.5, 0.65, 0.35);
    this.effects?.light(p2, 0xffc080, 4 + 6 * v, 0.14, 6);
    if (v > 0.3 && this.surface(p, { x: p2.x + dx * 0.4, y: p2.y + dy * 0.4, z: p2.z + dz * 0.4 })) {
      const h = this.hit;
      this.decals.add(h.x, h.y, h.z, h.nx, h.ny, h.nz, 0.35 + 0.4 * v, 6, 0, 0.5);
      this.effects?.spray(h, h.nx * 2, h.ny * 2 + 1, h.nz * 2, 1.5, 8 * lod, [0x5a5650, 0x6e6a62]);
    }
  }

  private whip(p: Vec3Like, p2: Vec3Like, targets: Vec3Like[] | undefined, col: number, lod: number): void {
    const a = new THREE.Vector3(p.x, p.y, p.z);
    const b = new THREE.Vector3(p2.x, p2.y, p2.z);
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length() || 1;
    // contrôle latéral : le filament balaie un arc avant de se tendre
    const side = new THREE.Vector3(-d.z, 0, d.x).normalize().multiplyScalar(len * 0.55 * sgn());
    const N = 28;
    let cracked = false;
    this.addActive(0.42, (s) => {
      const ext = Math.min(1, s.t / 0.13);
      const fade = s.t < 0.13 ? 1 : Math.max(0, 1 - (s.t - 0.13) / 0.28);
      const P = this.bp;
      const sw = (1 - ext) * (1 - ext);
      for (let i = 0; i < N; i++) {
        const t = (i / (N - 1)) * ext;
        // bout du filament : de la main vers p2 en balayant ; corps : courbe de Bézier
        const ix = a.x + d.x * t + side.x * Math.sin(Math.PI * t) * (0.3 + sw);
        const iy = a.y + d.y * t + Math.sin(Math.PI * t) * 0.15 * sw + Math.sin(t * 18 - s.t * 40) * 0.03 * fade;
        const iz = a.z + d.z * t + side.z * Math.sin(Math.PI * t) * (0.3 + sw);
        P[i * 3] = ix;
        P[i * 3 + 1] = iy;
        P[i * 3 + 2] = iz;
        this.wk[i] = 1 - 0.6 * (i / (N - 1));
        this.ck[i] = fade * (0.5 + 0.5 * (i / (N - 1)));
      }
      const [r, g, bb] = rgb(col, 1.6);
      this.ribbons.strip(P, N, 0.1, r * 0.18, g * 0.18, bb * 0.18, this.wk, this.ck);
      this.ribbons.strip(P, N, 0.035, r, g, bb, this.wk, this.ck);
      if (!cracked && ext >= 1) {
        cracked = true;
        const tip = { x: P[(N - 1) * 3], y: P[(N - 1) * 3 + 1], z: P[(N - 1) * 3 + 2] };
        this.parts.emit(tip.x, tip.y, tip.z, 0, 0, 0, SP.flash, 0xffd0f0, 0.5);
        this.burst(tip, col, 12 * lod, 3, SP.spark);
        this.rings.add(tip.x, tip.y, tip.z, d.x / len, d.y / len, d.z / len, 0.05, 0.7, 0.05, 0.22, 0xffffff, 1, RING.ENERGY);
      }
    });
    for (const q of targets ?? []) {
      this.burst(q, col, 10 * lod, 3, SP.spark);
      this.parts.emit(q.x, q.y, q.z, 0, 0, 0, SP.glow, col, 0.9);
    }
  }

  private repulse(p: Vec3Like, p2: Vec3Like | null | undefined, arcDeg: number, targets: Vec3Like[] | undefined, col: number, lod: number): void {
    const dir = new THREE.Vector3(p2 ? p2.x - p.x : 0, p2 ? p2.y - p.y : 0, p2 ? p2.z - p.z : 6);
    const range = Math.max(2, dir.length());
    dir.normalize();
    const half = Math.min(1.3, ((arcDeg / 2) * Math.PI) / 180);
    // le cône visible est plus serré que la zone touchée : une onde, pas un mur de lumière
    const R = Math.tan(half * 0.7) * range;
    const cv = this.cones.find((c) => !c.mesh.visible) ?? this.cones[0];
    cv.t = 0;
    cv.dur = 0.42;
    cv.mat.uniforms.uSeed.value = Math.random() * 10;
    (cv.mat.uniforms.uColor.value as THREE.Color).setRGB(...rgb(col));
    _q.setFromUnitVectors(Z_AXIS, dir);
    cv.mesh.position.set(p.x, p.y, p.z);
    cv.mesh.quaternion.copy(_q);
    cv.mesh.scale.set(R, R, range);
    cv.mesh.visible = true;
    // anneaux de pression qui filent vers le bout du cône
    let ringAcc = 0;
    const tanH = Math.tan(half * 0.7);
    this.addActive(0.32, (s, dt) => {
      ringAcc += dt;
      if (ringAcc < 0.03) return;
      ringAcc = 0;
      const k = Math.min(1, s.t / 0.3);
      const d = 0.4 + (range - 0.4) * (1 - (1 - k) * (1 - k));
      const rr = Math.max(0.2, tanH * d);
      this.rings.add(p.x + dir.x * d, p.y + dir.y * d, p.z + dir.z * d, dir.x, dir.y, dir.z, rr * 0.85, rr, 0.08 + 0.12 * k, 0.12, k < 0.3 ? 0xffffff : col, 0.9 * (1 - k * 0.7), RING.SHOCK, 1);
    });
    this.rings.add(p.x + dir.x * 0.25, p.y + dir.y * 0.25, p.z + dir.z * 0.25, dir.x, dir.y, dir.z, 0.1, 0.65, 0.06, 0.25, 0xffffff, 1.4, RING.ENERGY);
    this.rings.add(p.x + dir.x * 0.4, p.y + dir.y * 0.4, p.z + dir.z * 0.4, dir.x, dir.y, dir.z, 0.15, 1.1, 0.14, 0.3, col, 1, RING.SHOCK);
    this.parts.emit(p.x, p.y, p.z, 0, 0, 0, SP.flash, col, 0.7);
    // air et poussière balayés dans le cône
    const n = Math.round(40 * lod);
    for (let i = 0; i < n; i++) {
      const sp = rnd(8, 18);
      const ox = rnd(-1, 1) * Math.tan(half) * 0.8;
      const oy = rnd(-0.5, 0.5) * Math.tan(half) * 0.5;
      // perpendiculaires approximatives : (−dz, 0, dx) et y
      this.parts.emit(p.x + dir.x * 0.3, p.y + dir.y * 0.3, p.z + dir.z * 0.3, (dir.x - dir.z * ox) * sp, (dir.y + oy) * sp, (dir.z + dir.x * ox) * sp, SP.gust, Math.random() < 0.5 ? 0xffffff : col);
    }
    const gy = this.groundY(p.x, p.y, p.z, 2);
    if (!Number.isNaN(gy) && this.effects) {
      for (let i = 0; i < 8 * lod; i++) {
        const t = rnd(0.15, 0.9);
        const ox = rnd(-1, 1) * Math.tan(half) * t * range * 0.7;
        this.effects.addSmoke(p.x + dir.x * range * t - dir.z * ox, gy + 0.15, p.z + dir.z * range * t + dir.x * ox, dir.x * rnd(3, 6), 0.3, dir.z * rnd(3, 6), 1, 0.15, 0.6, 0.6, 0.4);
      }
    }
    for (const q of targets ?? []) {
      this.parts.emit(q.x, q.y, q.z, 0, 0, 0, SP.glow, col, 1.2);
      this.cone(q, dir.x, dir.y + 0.3, dir.z, 0.5, 10 * lod, 2, 6, 0xffffff, SP.sparkHot);
    }
  }

  private chain(p: Vec3Like, p2: Vec3Like | null | undefined, targets: Vec3Like[], emp: boolean, col: number, lod: number): void {
    const pts: THREE.Vector3[] = [new THREE.Vector3(p.x, p.y, p.z)];
    for (const t of targets) pts.push(new THREE.Vector3(t.x, t.y, t.z));
    if (pts.length === 1) {
      // aucune cible : la décharge se perd dans l'air devant
      const d = new THREE.Vector3(p2 ? p2.x - p.x : 0, p2 ? p2.y - p.y : 0, p2 ? p2.z - p.z : 1).normalize();
      pts.push(new THREE.Vector3(p.x + d.x * 2.6 + rnd(-0.4, 0.4), p.y + d.y * 2.6 + rnd(-0.3, 0.3), p.z + d.z * 2.6 + rnd(-0.4, 0.4)));
    }
    const hop = 0.06;
    const life = 0.42;
    const hitDone = new Array(pts.length).fill(false);
    this.parts.emit(p.x, p.y, p.z, 0, 0, 0, SP.flash, col, 0.6);
    this.effects?.light(p, col, 6, 0.3, 8);
    this.addActive(hop * pts.length + life, (s) => {
      for (let k = 1; k < pts.length; k++) {
        const age = s.t - (k - 1) * hop;
        if (age < 0 || age > life) continue;
        const a = pts[k - 1];
        const b = pts[k];
        const fl = (1 - age / life) * (Math.random() < 0.15 ? 0.3 : 1);
        this.bolt(a.x, a.y, a.z, b.x, b.y, b.z, 0.13, col, 1.6 * fl, 0.17, 33, 2);
        if (Math.random() < 0.6) this.bolt(a.x, a.y, a.z, b.x, b.y, b.z, 0.06, 0xffffff, 1.1 * fl, 0.22, 17, 1);
        if (!hitDone[k]) {
          hitDone[k] = true;
          this.parts.emit(b.x, b.y, b.z, 0, 0, 0, SP.flash, col, 0.7);
          this.burst(b, 0xd8fcff, 14 * lod, 4, SP.spark);
          this.rings.add(b.x, b.y, b.z, b.x - a.x, b.y - a.y, b.z - a.z, 0.05, 0.6, 0.05, 0.25, col, 1.2, RING.ENERGY);
        }
      }
    });
    if (emp) {
      const c = new THREE.Vector3(p.x, p.y, p.z);
      this.rings.add(p.x, p.y - 1.0, p.z, 0, 1, 0, 0.3, 8, 0.3, 0.6, col, 1.1, RING.TECH, 0.45);
      this.parts.emit(p.x, p.y, p.z, 0, 0, 0, SP.flash, 0xffffff, 1.5);
      this.addActive(0.55, (s) => {
        const k = s.t / 0.55;
        const r = 0.5 + 7.5 * (1 - Math.pow(1 - k, 2.2));
        const f = (1 - k) * (1 - k);
        this.shells.put(c.x, c.y - 0.6, c.z, r, r * 0.6, r, 0, col, 0.4 * f, 4, SHELL.CRACKLE, 3.3);
        this.shells.put(c.x, c.y - 0.6, c.z, r * 0.97, r * 0.58, r * 0.97, 0, 0xffffff, 0.22 * f, 7);
      });
    }
  }

  private rocket(p: Vec3Like, p2: Vec3Like, flight: number, col: number, lod: number, local: boolean): void {
    const a = new THREE.Vector3(p.x, p.y, p.z);
    const b = new THREE.Vector3(p2.x, p2.y, p2.z);
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length() || 1;
    const dur = flight > 0 ? flight : Math.max(0.15, len / 32);
    // point de contrôle : la roquette monte un peu et dévie (salve en éventail)
    const side = new THREE.Vector3(-d.z, 0, d.x).normalize();
    const c = a
      .clone()
      .addScaledVector(d, 0.35)
      .addScaledVector(side, rnd(-0.18, 0.18) * len)
      .add(new THREE.Vector3(0, len * rnd(0.08, 0.18), 0));
    const pos = new THREE.Vector3();
    const prev = a.clone();
    const tan = new THREE.Vector3();
    let smokeAcc = 0;
    let done = false;
    this.parts.emit(a.x, a.y, a.z, 0, 0, 0, SP.glow, 0xffd0a0, 0.8);
    this.cone(a, -d.x, -d.y, -d.z, 0.4, 8 * Math.max(lod, 0.3), 1, 3, 0xffc070, SP.fireJet);
    this.addActive(dur + 0.02, (s) => {
      if (done) return;
      const k = Math.min(1, s.t / dur);
      const u = Math.pow(k, 1.25);
      const iu = 1 - u;
      pos.set(iu * iu * a.x + 2 * iu * u * c.x + u * u * b.x, iu * iu * a.y + 2 * iu * u * c.y + u * u * b.y, iu * iu * a.z + 2 * iu * u * c.z + u * u * b.z);
      tan.subVectors(pos, prev);
      if (tan.lengthSq() > 1e-8) {
        tan.normalize();
        _q.setFromUnitVectors(Z_AXIS, tan);
        _m.compose(pos, _q, _s1);
        this.rockets.put(_m);
      }
      if (lod > 0) {
        // flamme de la tuyère et traînée de fumée
        this.parts.emit(pos.x - tan.x * 0.16, pos.y - tan.y * 0.16, pos.z - tan.z * 0.16, -tan.x * 2, -tan.y * 2, -tan.z * 2, SP.fireJet, 0xffb050, 1.1);
        this.shells.put(pos.x - tan.x * 0.17, pos.y - tan.y * 0.17, pos.z - tan.z * 0.17, 0.09, 0.09, 0.09, 0, 0xffa040, 1.3, 1);
        smokeAcc += s.t > 0 ? 1 : 0;
        const steps = Math.max(1, Math.ceil(pos.distanceTo(prev) / 0.25));
        for (let i = 0; i < steps; i++) {
          if (Math.random() > 0.85 * lod) continue;
          const f = i / steps;
          this.effects?.addSmoke(prev.x + (pos.x - prev.x) * f, prev.y + (pos.y - prev.y) * f, prev.z + (pos.z - prev.z) * f, rnd(-0.15, 0.15), rnd(0.05, 0.25), rnd(-0.15, 0.15), rnd(1.2, 2), 0.07, 0.3, 0.7, 0.42);
        }
      }
      prev.copy(pos);
      if (k >= 1) {
        done = true;
        this.explode(b, tan.clone(), col, lod, local);
      }
    });
    void smokeAcc;
  }

  /** Explosion d'une micro-roquette (rayon ≈ 3 m). */
  private explode(b: THREE.Vector3, dir: THREE.Vector3, col: number, lod: number, local: boolean): void {
    this.sfx('rocket_hit', b, 1, rnd(0.92, 1.08), local);
    this.effects?.light(b, 0xffa040, 14, 0.25, 12);
    if (lod <= 0) return;
    this.parts.emit(b.x, b.y, b.z, 0, 0, 0, SP.flash, 0xffd890, 1.6);
    for (let i = 0; i < 12 * lod; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = rnd(-0.4, 1);
      const r = Math.sqrt(1 - u * u);
      const sp = rnd(1.5, 4.5);
      this.parts.emit(b.x, b.y + 0.1, b.z, Math.cos(a) * r * sp, u * sp, Math.sin(a) * r * sp, SP.fireball, Math.random() < 0.4 ? 0xffc050 : col, rnd(0.8, 1.3));
    }
    this.burst(b, COL.spark, 26 * lod, 11, SP.spark, 0.5);
    this.burst(b, 0xffb050, 12 * lod, 4, SP.ember, 0.8);
    this.addActive(0.18, (s) => {
      const k = s.t / 0.18;
      this.shells.put(b.x, b.y, b.z, 0.4 + 1.3 * k, 0.4 + 1.3 * k, 0.4 + 1.3 * k, 0, 0xff9030, 1.3 * (1 - k) * (1 - k), 1.4);
    });
    const fx = this.effects;
    if (fx) {
      for (let i = 0; i < 9 * lod; i++) fx.addSmoke(b.x + rnd(-0.5, 0.5), b.y + rnd(0, 0.6), b.z + rnd(-0.5, 0.5), rnd(-1, 1), rnd(0.4, 1.4), rnd(-1, 1), rnd(2.5, 4), rnd(0.25, 0.45), 0.8, 0.22, 0.6);
      fx.spray(b, 0, 3, 0, 4, 14 * lod, [0x3a3834, 0x5a5650, 0x2a2826], 0.05, 1.1);
    }
    // marque de brûlure et onde au sol si proche
    if (this.surface({ x: b.x - dir.x, y: b.y - dir.y, z: b.z - dir.z }, b, 0.8)) {
      const h = this.hit;
      this.decals.add(h.x, h.y, h.z, h.nx, h.ny, h.nz, rnd(0.9, 1.3), 12, 1, 0.8);
    }
    const gy = this.groundY(b.x, b.y, b.z, 1.6);
    if (!Number.isNaN(gy)) {
      this.rings.add(b.x, gy + 0.05, b.z, 0, 1, 0, 0.3, 3.4, 0.3, 0.4, 0xffa060, 1.2, RING.SHOCK, 0.45);
      if (Math.abs(gy - b.y) > 0.5) this.decals.add(b.x, gy, b.z, 0, 1, 0, 1.1, 12, 1, 0.8);
    }
  }

  private scan(p: Vec3Like, radius: number, col: number): void {
    const c = new THREE.Vector3(p.x, p.y + 1, p.z);
    const dur = Math.min(1.6, 0.5 + radius / 40);
    this.rings.add(p.x, p.y + 0.06, p.z, 0, 1, 0, 0.4, radius, 0.5, dur * 1.1, col, 1.2, RING.TECH, 0.7);
    this.rings.add(p.x, p.y + 0.07, p.z, 0, 1, 0, 0.3, radius * 0.92, 0.12, dur, 0xe0ffe8, 0.9, RING.ENERGY, 0.7);
    this.parts.emit(c.x, c.y + 0.6, c.z, 0, 0, 0, SP.ringP, col, 1.5);
    this.addActive(dur, (s) => {
      const k = s.t / dur;
      const r = 0.5 + (radius - 0.5) * (1 - Math.pow(1 - k, 1.4));
      const i = (1 - k) * (1 - k * 0.5);
      // coque translucide (rien d'aveuglant de l'intérieur) avec bandes de balayage
      this.shells.put(c.x, c.y, c.z, r, r * 0.55, r, 0, col, 0.5 * i, 2.6, SHELL.SCAN, 1);
    });
  }

  private camoBurst(p: Vec3Like, on: boolean, col: number, lod: number): void {
    const c = new THREE.Vector3(p.x, p.y, p.z);
    this.addActive(0.6, (s) => {
      const k = s.t / 0.6;
      const i = on ? 1 - k : Math.sin(Math.PI * Math.min(1, k * 1.4));
      const sc = on ? 1 + k * 0.25 : 1.25 - k * 0.25;
      this.shells.put(c.x, c.y + 0.95, c.z, 0.5 * sc, 1.0 * sc, 0.5 * sc, 0, col, 1.3 * i, 1.6, SHELL.SHIMMER, 2);
      // anneau qui parcourt le corps (de la tête aux pieds à l'activation, l'inverse à l'arrêt)
      const h = on ? 1.85 * (1 - Math.min(1, k * 1.6)) : 1.85 * Math.min(1, k * 1.6);
      if (k < 0.65) this.shells.put(c.x, c.y + h, c.z, 0.42, 0.03, 0.42, 0, 0xffffff, 1.2 * (1 - k), 1);
    });
    const n = Math.round(26 * lod);
    for (let i = 0; i < n; i++) {
      _v1.set(0, 0, 0);
      this.bodyPt(c, _v1);
      const dx = _v1.x - c.x;
      const dz = _v1.z - c.z;
      if (on) this.parts.emit(_v1.x, _v1.y, _v1.z, dx * 3, rnd(-0.2, 0.4), dz * 3, SP.mote, Math.random() < 0.5 ? col : 0xffffff);
      else this.parts.emit(_v1.x + dx * 2, _v1.y, _v1.z + dz * 2, -dx * 3, 0, -dz * 3, SP.moteIn, col);
    }
  }

  private reflexBurst(p: Vec3Like, lod: number): void {
    const hy = p.y + 1.62;
    this.rings.add(p.x, hy, p.z, 0, 1, 0, 0.15, 1.1, 0.05, 0.35, COL.reflexGold, 1.4, RING.ENERGY);
    this.rings.add(p.x, p.y + 0.05, p.z, 0, 1, 0, 0.3, 2.6, 0.08, 0.5, COL.reflex, 1, RING.TECH);
    this.parts.emit(p.x, hy, p.z, 0, 0, 0, SP.flash, COL.reflexGold, 0.6);
    const c = new THREE.Vector3(p.x, p.y, p.z);
    this.addActive(0.3, (s) => {
      const k = s.t / 0.3;
      this.shells.put(c.x, c.y + 0.95, c.z, 0.5 + 0.4 * k, 1 + 0.3 * k, 0.5 + 0.4 * k, 0, COL.reflex, 1.4 * (1 - k), 1.8);
    });
    this.burst({ x: p.x, y: hy, z: p.z }, COL.reflexGold, 12 * lod, 2.5, SP.mote);
  }

  private overBurst(p: Vec3Like, col: number, lod: number): void {
    const c = new THREE.Vector3(p.x, p.y + 1, p.z);
    this.rings.add(p.x, p.y + 0.05, p.z, 0, 1, 0, 0.3, 2.6, 0.2, 0.4, col, 1.2, RING.SHOCK);
    this.parts.emit(c.x, c.y, c.z, 0, 0, 0, SP.flash, 0xff8060, 1.1);
    this.effects?.light(c, col, 5, 0.3, 6);
    this.addActive(0.35, (s) => {
      const k = s.t / 0.35;
      this.shells.put(c.x, c.y - 0.05, c.z, 0.9 - 0.4 * k, 1.5 - 0.5 * k, 0.9 - 0.4 * k, 0, col, 1.6 * (1 - k), 1.6, SHELL.CRACKLE, 5);
      if (k < 0.7)
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * Math.PI * 2;
          this.bolt(c.x, c.y + rnd(-0.5, 0.5), c.z, c.x + Math.cos(a) * rnd(0.8, 1.4), c.y + rnd(-0.9, 0.6), c.z + Math.sin(a) * rnd(0.8, 1.4), 0.07, col, 1.2, 0.2, 9, 1);
        }
    });
    this.burst(c, 0xff6040, 16 * lod, 3, SP.spark);
  }

  private secondWind(p: Vec3Like, col: number, lod: number): void {
    const c = new THREE.Vector3(p.x, p.y + 1, p.z);
    this.parts.emit(c.x, c.y, c.z, 0, 0, 0, SP.flash, 0xe8ffe8, 2);
    this.effects?.light(c, col, 8, 0.4, 8);
    this.rings.add(p.x, p.y + 0.05, p.z, 0, 1, 0, 0.3, 4.2, 0.16, 0.6, col, 1.4, RING.ENERGY, 0.5);
    this.addActive(0.9, (s) => {
      // second battement
      if (s.t > 0.22 && s.t - 0.016 * 2 <= 0.22) this.rings.add(p.x, p.y + 0.06, p.z, 0, 1, 0, 0.3, 3, 0.12, 0.5, 0xffffff, 1, RING.ENERGY, 0.5);
      const k = s.t / 0.9;
      const r = 0.5 + 2.4 * (1 - Math.pow(1 - k, 2));
      this.shells.put(c.x, c.y, c.z, r, r, r, 0, col, 1.2 * (1 - k), 2.4);
    });
    for (let i = 0; i < 18 * lod; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rnd(0.2, 0.7);
      this.parts.emit(p.x + Math.cos(a) * r, p.y + rnd(0.1, 1.2), p.z + Math.sin(a) * r, Math.cos(a) * 0.4, rnd(1, 2.4), Math.sin(a) * 0.4, SP.heal, col, rnd(1, 1.6));
    }
    this.burst(c, 0xd8ffe0, 24 * lod, 3, SP.mote, 1);
  }

  private nano(p: Vec3Like, hp: number, col: number, lod: number): void {
    const n = Math.round(Math.min(16, 6 + hp / 3) * lod);
    for (let i = 0; i < n; i++) {
      _v1.set(0, 0, 0);
      this.bodyPt(p, _v1, 0.3, 1.6);
      this.parts.emit(_v1.x, _v1.y, _v1.z, rnd(-0.1, 0.1), rnd(0.4, 0.9), rnd(-0.1, 0.1), Math.random() < 0.6 ? SP.heal : SP.mote, col, rnd(0.8, 1.2));
    }
    this.rings.add(p.x, p.y + 0.05, p.z, 0, 1, 0, 0.6, 0.25, 0.04, 0.6, col, 0.9, RING.ENERGY, 1);
  }

  private droneDeploy(p: Vec3Like, col: number, lod: number): void {
    this.parts.emit(p.x, p.y, p.z, 0, 0, 0, SP.flash, col, 0.9);
    this.rings.add(p.x, p.y, p.z, 0, 1, 0, 0.2, 1.3, 0.06, 0.45, col, 1.3, RING.TECH);
    this.rings.add(p.x, p.y - 0.1, p.z, 0, 1, 0, 0.1, 0.9, 0.08, 0.3, 0xffffff, 0.9, RING.ENERGY);
    this.burst(p, col, 12 * lod, 2.5, SP.sparkHot);
    this.cone(p, 0, -1, 0, 0.4, 10 * lod, 1.5, 3, col, SP.thrust);
  }

  private hack(p: Vec3Like, p2: Vec3Like, dur: number, col: number, lod: number): void {
    const a = new THREE.Vector3(p.x, p.y, p.z);
    const b = new THREE.Vector3(p2.x, p2.y, p2.z);
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    let nx = -d.x / (len || 1);
    let ny = -d.y / (len || 1);
    let nz = -d.z / (len || 1);
    if (this.surface(p, p2, 0.5)) {
      nx = this.hit.nx;
      ny = this.hit.ny;
      nz = this.hit.nz;
    }
    this.rings.add(b.x + nx * 0.03, b.y + ny * 0.03, b.z + nz * 0.03, nx, ny, nz, 0.05, 0.35, 0.03, Math.min(dur, 6), col, 1.2, RING.TECH, 0.15);
    this.parts.emit(a.x, a.y, a.z, 0, 0, 0, SP.glow, col, 0.6);
    const N = 20;
    let glyph = 0;
    this.addActive(dur + 0.25, (s) => {
      const out = s.t > dur ? 1 - (s.t - dur) / 0.25 : Math.min(1, s.t / 0.12);
      const ext = Math.min(1, s.t / 0.12);
      const P = this.bp;
      for (let i = 0; i < N; i++) {
        const t = (i / (N - 1)) * ext;
        P[i * 3] = a.x + d.x * t;
        P[i * 3 + 1] = a.y + d.y * t - Math.sin(Math.PI * t) * Math.min(0.35, len * 0.06);
        P[i * 3 + 2] = a.z + d.z * t;
        this.wk[i] = 1;
        this.ck[i] = out;
      }
      const [r, g, bb] = rgb(col, 1.5);
      this.ribbons.strip(P, N, 0.12, r * 0.15, g * 0.15, bb * 0.15, this.wk, this.ck);
      this.ribbons.strip(P, N, 0.04, r, g, bb, this.wk, this.ck, 2.2, 3.5);
      // glyphes de données qui sortent du terminal
      glyph += 0.016 * 30 * lod;
      while (glyph >= 1 && s.t < dur) {
        glyph--;
        const gx = rnd(-0.25, 0.25);
        const gy = rnd(-0.2, 0.25);
        this.parts.emit(b.x + nx * 0.06 - nz * gx, b.y + ny * 0.06 + gy, b.z + nz * 0.06 + nx * gx, nx * 0.3, 0.15, nz * 0.3, SP.data, Math.random() < 0.3 ? 0xffffff : col);
      }
      if (Math.random() < 0.08 * lod) this.burst(b, col, 3, 1.5, SP.sparkHot);
    });
  }

  private markPing(t: Vec3Like, col: number): void {
    // t = centre du corps : losange au-dessus de la tête, anneau au sol
    const f = this.feet(t);
    const fy = f === t ? t.y - 1.2 : f.y;
    const hy = fy + 2.25;
    this.parts.emit(t.x, hy, t.z, 0, 0, 0, SP.diamond, col, 1.2);
    this.parts.emit(t.x, hy, t.z, 0, 0, 0, SP.ringP, col, 1.3);
    this.rings.add(t.x, fy + 0.05, t.z, 0, 1, 0, 0.9, 0.5, 0.05, 1.1, col, 1.2, RING.TECH, 1);
    const c = new THREE.Vector3(t.x, fy, t.z);
    this.addActive(0.5, (s) => {
      // trait lumineux qui « verrouille » la cible
      const k = s.t / 0.5;
      const P = this.bp;
      P[0] = c.x;
      P[1] = c.y + 0.1;
      P[2] = c.z;
      P[3] = c.x;
      P[4] = c.y + 2.1;
      P[5] = c.z;
      this.wk[0] = 1;
      this.wk[1] = 0.3;
      this.ck[0] = 1;
      this.ck[1] = 0.2;
      const [r, g, b] = rgb(col, 0.8 * (1 - k));
      this.ribbons.strip(P, 2, 0.05, r, g, b, this.wk, this.ck);
    });
  }
}
