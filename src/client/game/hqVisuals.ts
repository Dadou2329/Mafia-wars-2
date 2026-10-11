// Équipements du QG et cliniques cybernétiques, côté client : les modèles voxel apparaissent aux
// emplacements des logements (BuildingInfo.hqAnchors) dès que l'état public les annonce (pub.hqUpg,
// visibles des deux parrains), avec une courte matérialisation. Animations : carte holographique de
// New York en direct, écrans des caméras et des opérations, drone en vol dans le bureau, diodes,
// portique de détection, moto à sustentation, hologrammes des cliniques et du recrutement.
// Collisions locales des meubles posés au sol, interactions (station, cliniques, terminal, trophées…)
// et dessins sur la carte stratégique et la mini-carte.

import * as THREE from 'three';
import { AMMO_PRICE, BOSS_NAME, TAXI_PRICE } from '../../shared/constants';
import { GRENADE_MAX } from '../../shared/grenade';
import { BUILDINGS, FILLERS, Faction, WORLD_D, WORLD_W } from '../../shared/city/plan';
import type { BuildingInfo, HqAnchor } from '../../shared/city/gen/context';
import { CLINIC_REACH, CLINIC_SEAT_DEPTH, clinicSeat } from '../../shared/city/gen/clinics';
import { HQ_FOOTPRINT } from '../../shared/city/gen/residences';
import { leNom } from '../../shared/french';
import { M as MAT } from '../../shared/materials';
import type { PrivateState, PublicState, Slot } from '../../shared/protocol';
import { GROUND_VY, INV_VOXEL, VOXEL } from '../../shared/voxel';
import { audio } from '../audio/AudioEngine';
import { meshModel } from '../models/modelMesher';
import type { VoxelModel } from '../models/voxelModel';
import {
  KIOSK_ZONE,
  OPS_ZONE,
  SURVEIL_ZONE,
  TROPHY_SLOTS,
  armoryModel,
  commsModel,
  cyberStationModel,
  droneModel,
  droneRackModel,
  hoverBikeModel,
  kioskModel,
  opsModel,
  padModel,
  projectorModel,
  securityModel,
  surveilModel,
  trophyModels,
  trophyShelfModel,
  type ScreenZone,
} from '../models/hq/models';
import { SLOT as VSLOT, voxelsOf } from '../models/hq/kit';
import { createObjectMaterial } from '../render/voxelObjectMaterial';
import { actionKey } from '../input/bindings';
import { settings } from '../settings';
import { MAP_FONT, MAP_FONT_TITLE, MAP_SCALE } from './cityMap';
import { openCyberScreen } from './cyberUi';
import type { GameClient } from './GameClient';
import type { ClientModule, Interaction } from './modules';

const SLOTS: Slot[] = ['dadou', 'even'];
const FACTION: Record<Slot, number> = { dadou: Faction.DADOU, even: Faction.EVEN };

/** Équipements dessinés dans le bureau (les gardes d'élite sont des personnages du serveur). */
const VISUAL = ['holomap', 'surveil', 'autorecruit', 'security', 'comms', 'cyberstation', 'armory2', 'transport', 'trophies', 'dronecmd', 'opscenter'] as const;
type VisualId = (typeof VISUAL)[number];

/** Taxi volant vers le QG (téléphone) : gratuit avec le module de transport personnel. */
export function taxiPrice(priv: PrivateState): number {
  return priv.upgrades.includes('transport') ? 0 : TAXI_PRICE;
}

/** Prix de l'armurerie du parrain (armurerie avancée : remises, grenades en plus). */
export function armoryPrices(priv: PrivateState): { weapon: (base: number) => number; ammo: number; grenadeMax: number } {
  const a = priv.hqUp?.armory;
  return { weapon: (base) => (a ? Math.round(base * a.weaponMul) : base), ammo: a ? a.ammo : AMMO_PRICE, grenadeMax: a ? a.grenadeMax : GRENADE_MAX };
}

/** Équipements du bureau (onglet des améliorations : section à part). */
export const OFFICE_UPGRADES = new Set<string>([...VISUAL, 'elite']);

/** État d'un équipement acquis, pour l'onglet des améliorations. */
export function officeStatus(id: string, priv: PrivateState, pub: PublicState, you: Slot): string {
  const hq = priv.hqUp;
  switch (id) {
    case 'trophies':
      return `${pub.hqTrophies?.[you] ?? 0} trophée${(pub.hqTrophies?.[you] ?? 0) > 1 ? 's' : ''} — prestige : +${hq?.prestige ?? 0} $/min`;
    case 'autorecruit':
      return `${hq?.recruits ?? 0} recrue${(hq?.recruits ?? 0) > 1 ? 's' : ''} automatique${(hq?.recruits ?? 0) > 1 ? 's' : ''}`;
    case 'surveil':
      return hq?.watch?.length ? `${hq.watch.length} intrus repéré${hq.watch.length > 1 ? 's' : ''}` : 'Rien à signaler';
    case 'opscenter':
      return `${hq?.ops?.length ?? 0} opération${(hq?.ops?.length ?? 0) > 1 ? 's' : ''} suivie${(hq?.ops?.length ?? 0) > 1 ? 's' : ''}`;
    case 'dronecmd':
      return hq?.patrol ? 'Drone de patrouille en vol' : 'Drone de patrouille en préparation';
    case 'transport':
      return 'Taxi volant : gratuit';
    default:
      return 'Installé dans le bureau';
  }
}

// ====================================================================== shaders

const holoUniforms = { uTime: { value: 0 } };

const HOLO_VERT = /* glsl */ `
uniform float uTime;
varying vec3 vCol;
varying float vH;
varying vec3 vW;
void main() {
  vec4 p = vec4(position, 1.0);
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
#endif
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#else
  vCol = vec3(1.0);
#endif
  vH = clamp(position.y, 0.0, 1.0);
  vec4 wp = modelMatrix * p;
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const HOLO_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uTint;
varying vec3 vCol;
varying float vH;
varying vec3 vW;
void main() {
  float scan = 0.72 + 0.28 * step(0.5, fract(vW.y * 46.0 - uTime * 1.7));
  float band = 0.75 + 0.25 * smoothstep(0.0, 0.1, abs(fract(vW.y * 2.0 - uTime * 0.35) - 0.5));
  float fl = 0.9 + 0.1 * sin(uTime * 31.0 + vW.x * 9.0) * sin(uTime * 7.0);
  vec3 c = vCol * uTint * (0.38 + 0.62 * vH) * scan * band * fl * uAlpha;
  gl_FragColor = vec4(c, 1.0);
}
`;

/** Plan holographique texturé (enseignes, silhouettes) : alpha de la toile, balayage, scintillement. */
const SPRITE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uTint;
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vW;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float scan = 0.7 + 0.3 * step(0.5, fract(vW.y * 26.0 - uTime * 1.5));
  float fl = 0.88 + 0.12 * sin(uTime * 37.0 + vW.x * 3.0) * sin(uTime * 11.0);
  if (fract(uTime * 0.17 + vW.x * 0.01) < 0.01) fl *= 0.35;
  gl_FragColor = vec4(t.rgb * uTint * t.a * scan * fl * uAlpha, 1.0);
}
`;
const SPRITE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** Écran (toile) : trame de diodes, luminosité de nuit. */
const SCREEN_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uBright;
varying vec2 vUv;
varying vec3 vW;
void main() {
  vec3 c = texture2D(uMap, vUv).rgb;
  vec2 px = fract(vUv * vec2(260.0, 130.0));
  float led = 0.8 + 0.2 * step(0.2, px.x) * step(0.2, px.y);
  gl_FragColor = vec4(c * led * uBright, 1.0);
}
`;

/** Diodes clignotantes (points additifs). */
const LED_VERT = /* glsl */ `
uniform float uTime;
attribute float aPhase;
attribute vec3 aColor;
varying vec3 vCol;
varying float vOn;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float r = fract(sin(aPhase * 91.7 + floor(uTime * (2.0 + fract(aPhase * 7.3) * 5.0)) * 12.9898) * 43758.5453);
  vOn = r > 0.35 ? 1.0 : 0.12;
  vCol = aColor;
  gl_PointSize = clamp(34.0 / -mv.z, 1.5, 9.0);
  gl_Position = projectionMatrix * mv;
}
`;
const LED_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vOn;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(d));
  gl_FragColor = vec4(vCol * a * vOn * 1.6, 1.0);
}
`;

function additive(frag: string, vert: string, extra: Record<string, THREE.IUniform> = {}): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: { uTime: holoUniforms.uTime, uAlpha: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) }, ...extra },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  m.toneMapped = false;
  return m;
}

// ====================================================================== modèles instanciés

type ModelKey = VisualId | 'clinic' | 'drone' | 'bike' | 'projector' | 'trophy0' | 'trophy1' | 'trophy2' | `security${number}`;

interface Batch {
  mesh: THREE.InstancedMesh;
  owner: THREE.InstancedBufferAttribute;
  cap: number;
  model: VoxelModel;
}

/** Un équipement posé dans un QG (ou un fauteuil de clinique). */
interface Placed {
  key: string;
  slot: Slot | null;
  bid: number;
  id: VisualId | 'clinic';
  a: HqAnchor;
  /** Repère de l'emplacement (sans l'animation d'apparition). */
  base: THREE.Matrix4;
  model: ModelKey;
  /** Instant d'apparition (animation), −1 sans animation. */
  born: number;
  /** Objets propres (hologrammes, écrans, diodes). */
  fx: THREE.Object3D[];
  update?: (now: number, near: boolean) => void;
  dispose?: () => void;
  /** Voxels de collision posés localement. */
  vox: number[] | null;
}

const UP = new THREE.Vector3(0, 1, 0);

function anchorMatrix(a: HqAnchor, dy = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(a.x, a.y + dy, a.z), new THREE.Quaternion().setFromAxisAngle(UP, a.yaw), new THREE.Vector3(1, 1, 1));
}

/** Point devant un équipement (m), à d mètres de son appui. */
function ahead(a: HqAnchor, d: number): { x: number; z: number } {
  return { x: a.x + Math.sin(a.yaw) * d, z: a.z + Math.cos(a.yaw) * d };
}

/** Hasard déterministe [0, 1). */
function rnd(k: number): number {
  const s = Math.sin(k * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** Image d'une caméra de surveillance (scène simplifiée, tons froids) : 0 entrée, 1 rue, 2 toit, 3 hall, 4 bureau. */
function cctv(c: CanvasRenderingContext2D, X: number, Y: number, w: number, h: number, kind: number, t: number): void {
  const cx = X + w / 2;
  const hz = Y + h * 0.45;
  const g = c.createLinearGradient(0, Y, 0, Y + h);
  g.addColorStop(0, kind === 1 || kind === 2 ? '#5f7d88' : '#7a9296');
  g.addColorStop(kind === 1 || kind === 2 ? 0.45 : 1, kind === 1 || kind === 2 ? '#93acb0' : '#566d71');
  if (kind === 1 || kind === 2) g.addColorStop(1, '#3f555a');
  c.fillStyle = g;
  c.fillRect(X, Y, w, h);
  if (kind === 1) {
    // rue : façades éclairées, chaussée, voiture qui passe
    const n = 6;
    for (let k = 0; k < n; k++) {
      const bx = X + (k * w) / n;
      const bh = h * (0.2 + 0.25 * rnd(k + 1));
      c.fillStyle = k % 2 ? '#3f5459' : '#4c6368';
      c.fillRect(bx, hz - bh, w / n + 1, bh);
      c.fillStyle = 'rgba(255,236,170,0.85)';
      for (let wy = hz - bh + 4; wy < hz - 5; wy += 7) for (let wx = bx + 3; wx < bx + w / n - 4; wx += 6) if (rnd(wx * 0.37 + wy * 1.7) > 0.5) c.fillRect(wx, wy, 3, 3);
    }
    c.fillStyle = '#3a4e52';
    c.fillRect(X, hz, w, Y + h - hz);
    c.fillStyle = '#26363a';
    c.beginPath();
    c.moveTo(X - w * 0.2, Y + h);
    c.lineTo(cx - w * 0.06, hz);
    c.lineTo(cx + w * 0.06, hz);
    c.lineTo(X + w * 1.2, Y + h);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(240,220,140,0.85)';
    c.lineWidth = 2;
    c.setLineDash([5, 7]);
    c.lineDashOffset = -t * 25;
    c.beginPath();
    c.moveTo(cx, hz);
    c.lineTo(cx, Y + h);
    c.stroke();
    c.setLineDash([]);
    c.lineWidth = 1;
    const u = ((t * 0.18) % 1.5) - 0.25;
    const vy = hz + (Y + h - hz) * 0.5;
    const vx = X + u * w;
    c.fillStyle = '#182124';
    c.fillRect(vx, vy - 8, 36, 10);
    c.fillRect(vx + 7, vy - 14, 20, 7);
    c.fillStyle = '#fff4c4';
    c.fillRect(vx + 33, vy - 6, 3, 3);
    c.fillStyle = '#ff5050';
    c.fillRect(vx, vy - 6, 2, 3);
  } else if (kind === 2) {
    // toit : silhouette de la ville, parapet, antenne à feu clignotant
    for (let x = X, k = 0; x < X + w; k++) {
      const bw = 10 + rnd(k + 7) * 22;
      const bh = h * (0.14 + rnd(k + 3) * 0.32);
      const top = hz + h * 0.12 - bh;
      c.fillStyle = '#33474b';
      c.fillRect(x, top, bw, bh);
      c.fillStyle = 'rgba(255,230,160,0.8)';
      for (let wy = top + 3; wy < top + bh - 3; wy += 6) for (let wx = x + 2; wx < x + bw - 3; wx += 5) if (rnd(wx * 0.91 + wy * 0.13) > 0.62) c.fillRect(wx, wy, 2, 2);
      x += bw + 1;
    }
    c.fillStyle = '#44595e';
    c.fillRect(X, Y + h * 0.7, w, h * 0.3);
    c.fillStyle = '#62797e';
    c.fillRect(X, Y + h * 0.68, w, 4);
    c.fillStyle = '#1d2a2d';
    c.fillRect(X + w * 0.78, Y + h * 0.3, 2, h * 0.4);
    if (Math.sin(t * 4) > 0) {
      c.fillStyle = '#ff3a3a';
      c.fillRect(X + w * 0.78 - 1, Y + h * 0.28, 4, 4);
    }
  } else {
    // intérieur en perspective : mur du fond, sol carrelé, plafonniers
    const bw = w * 0.36;
    const bh = h * 0.42;
    const bx = cx - bw / 2 + (kind - 3) * w * 0.08;
    const by = Y + h * 0.22;
    c.fillStyle = '#617a7e';
    c.beginPath();
    c.moveTo(X, Y + h);
    c.lineTo(bx, by + bh);
    c.lineTo(bx + bw, by + bh);
    c.lineTo(X + w, Y + h);
    c.closePath();
    c.fill();
    c.fillStyle = '#879fa2';
    c.beginPath();
    c.moveTo(X, Y);
    c.lineTo(bx, by);
    c.lineTo(bx + bw, by);
    c.lineTo(X + w, Y);
    c.closePath();
    c.fill();
    c.fillStyle = '#98aeb0';
    c.fillRect(bx, by, bw, bh);
    c.strokeStyle = 'rgba(20,30,32,0.45)';
    c.beginPath();
    for (const [x0, y0, x1, y1] of [
      [X, Y, bx, by],
      [X + w, Y, bx + bw, by],
      [X, Y + h, bx, by + bh],
      [X + w, Y + h, bx + bw, by + bh],
    ]) {
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
    }
    for (let k = 1; k < 5; k++) {
      const f = (k / 5) ** 1.6;
      const yy = by + bh + (Y + h - by - bh) * f;
      c.moveTo(bx - (bx - X) * f, yy);
      c.lineTo(bx + bw + (X + w - bx - bw) * f, yy);
    }
    c.stroke();
    c.fillStyle = 'rgba(255,255,232,0.95)';
    c.fillRect(cx - 10, Y + h * 0.08, 20, 3);
    c.fillRect(bx + bw / 2 - 6, by - 6, 12, 2);
    if (kind === 0) {
      // porte d'entrée, lumière de la rue
      c.fillStyle = '#d6e4e4';
      c.fillRect(bx + bw * 0.38, by + bh * 0.25, bw * 0.24, bh * 0.75);
      c.fillStyle = '#26363a';
      c.fillRect(bx + bw * 0.36, by + bh * 0.22, 2, bh * 0.78);
      c.fillRect(bx + bw * 0.62, by + bh * 0.22, 2, bh * 0.78);
    } else if (kind === 3) {
      // hall : colonnes et escalier
      c.fillStyle = '#4a5f63';
      c.fillRect(X + w * 0.14, Y + h * 0.12, 8, h * 0.8);
      c.fillRect(X + w * 0.82, Y + h * 0.12, 8, h * 0.8);
      c.fillStyle = '#6f8589';
      for (let k = 0; k < 5; k++) c.fillRect(bx + bw * 0.55, by + bh - k * 5 - 5, bw * 0.4, 3);
    } else {
      // bureau : table, fauteuil, écran allumé
      c.fillStyle = '#1e2a2c';
      c.fillRect(cx - 7, Y + h * 0.5, 14, h * 0.16);
      c.fillStyle = '#2c3a3d';
      c.fillRect(cx - w * 0.18, Y + h * 0.66, w * 0.36, 8);
      c.fillRect(cx - w * 0.16, Y + h * 0.66 + 8, 4, h * 0.18);
      c.fillRect(cx + w * 0.16 - 4, Y + h * 0.66 + 8, 4, h * 0.18);
      c.fillStyle = '#b8f0ff';
      c.fillRect(cx - 9, Y + h * 0.66 - 12, 18, 11);
    }
  }
}

export class HqVisuals implements ClientModule {
  readonly group = new THREE.Group();
  private gc: GameClient;
  private material = createObjectMaterial();
  private batches = new Map<ModelKey, Batch>();
  private placed = new Map<string, Placed>();
  private clinics: Placed[] = [];
  private signs: { b: BuildingInfo; mesh: THREE.Mesh; mat: THREE.ShaderMaterial; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; state: string }[] = [];
  private known: Record<Slot, Set<string> | null> = { dadou: null, even: null };
  private hqOf: Record<Slot, number> = { dadou: -1, even: -1 };
  private trophies: Record<Slot, number> = { dadou: -1, even: -1 };
  private time = 0;
  private dirty = true;
  private pendingVox: Placed[] = [];

  constructor(gc: GameClient) {
    this.gc = gc;
    this.group.name = 'equipements du QG';
    gc.scene.add(this.group);
    this.buildClinics();
  }

  // -------------------------------------------------------------- lots instanciés

  private makeModel(k: ModelKey): VoxelModel {
    if (k.startsWith('security')) return securityModel(Number(k.slice(8)) / 100);
    switch (k) {
      case 'holomap':
      case 'projector':
        return projectorModel();
      case 'surveil':
        return surveilModel();
      case 'autorecruit':
        return kioskModel();
      case 'comms':
        return commsModel();
      case 'cyberstation':
        return cyberStationModel(false);
      case 'clinic':
        return cyberStationModel(true);
      case 'armory2':
        return armoryModel();
      case 'transport':
        return padModel();
      case 'bike':
        return hoverBikeModel();
      case 'trophies':
        return trophyShelfModel();
      case 'trophy0':
      case 'trophy1':
      case 'trophy2':
        return trophyModels()[Number(k.slice(6))];
      case 'dronecmd':
        return droneRackModel();
      case 'drone':
        return droneModel();
      case 'opscenter':
        return opsModel();
      default:
        return projectorModel();
    }
  }

  private batch(k: ModelKey, cap: number): Batch {
    let b = this.batches.get(k);
    if (b && b.cap >= cap) return b;
    const model = b?.model ?? this.makeModel(k);
    const geo = b ? b.mesh.geometry : meshModel(model);
    if (b) {
      this.group.remove(b.mesh);
      b.mesh.dispose();
    }
    const n = Math.max(cap, 2);
    const mesh = new THREE.InstancedMesh(geo, this.material, n);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const owner = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    geo.setAttribute('aOwner', owner);
    this.group.add(mesh);
    b = { mesh, owner, cap: n, model };
    this.batches.set(k, b);
    return b;
  }

  // -------------------------------------------------------------- cliniques

  private buildClinics(): void {
    for (const b of this.gc.world.buildings) {
      if (!b.clinic) continue;
      const c = b.clinic;
      const a: HqAnchor = { x: c.x, y: c.y, z: c.z, yaw: c.yaw };
      const p: Placed = { key: `clinique:${b.id}`, slot: null, bid: b.id, id: 'clinic', a, base: anchorMatrix(a), model: 'clinic', born: -1, fx: [], vox: null };
      this.decorateCyber(p, true);
      this.clinics.push(p);
      this.makeSign(b);
    }
    this.dirty = true;
  }

  /** Enseigne holographique « CLINIQUE CYBERNÉTIQUE » au-dessus de l'entrée, côté rue. */
  private makeSign(b: BuildingInfo): void {
    const d = b.doors[0];
    const n = d.side === 'N' ? [0, -1] : d.side === 'S' ? [0, 1] : d.side === 'E' ? [1, 0] : [-1, 0];
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = additive(SPRITE_FRAG, SPRITE_VERT, { uMap: { value: tex } });
    mat.uniforms.uAlpha.value = 1.3;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.0), mat);
    // sous l'enseigne du bâtiment (qu'elle ne doit pas masquer), au-dessus de la porte
    const fy = b.floorY ?? 0;
    const y = b.sign ? Math.max(fy + 3.0, Math.min(fy + 4.1, b.sign.y - b.sign.h / 2 - 0.65)) : fy + 4.1;
    mesh.position.set(d.x + n[0] * 1.3, y, d.z + n[1] * 1.3);
    mesh.rotation.y = Math.atan2(n[0], n[1]);
    // panneau sombre derrière le néon : l'enseigne reste lisible en plein jour
    const back = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 1.1), new THREE.MeshBasicMaterial({ color: 0x03070b, transparent: true, opacity: 0.7, depthWrite: false }));
    back.position.z = -0.03;
    mesh.add(back);
    this.group.add(mesh);
    this.signs.push({ b, mesh, mat, canvas, tex, state: '' });
  }

  private drawSign(s: (typeof this.signs)[number], closed: boolean): void {
    const c = s.canvas.getContext('2d')!;
    const W = s.canvas.width;
    const H = s.canvas.height;
    c.clearRect(0, 0, W, H);
    const col = closed ? '#ff4a5a' : '#5ff0ff';
    c.strokeStyle = col;
    c.fillStyle = col;
    c.lineWidth = 6;
    c.beginPath();
    c.roundRect(6, 6, W - 12, H - 12, 18);
    c.stroke();
    // croix médicale
    c.fillRect(34, 50, 60, 20);
    c.fillRect(54, 30, 20, 60);
    c.font = `900 40px ${MAP_FONT_TITLE}`;
    c.textBaseline = 'middle';
    c.fillText('CLINIQUE', 116, 48);
    c.font = `700 30px ${MAP_FONT_TITLE}`;
    c.fillText('CYBERNÉTIQUE', 116, 88);
    c.font = `600 22px ${MAP_FONT}`;
    c.fillStyle = '#ffffff';
    const name = s.b.clinic?.name ?? '';
    c.fillText(closed ? 'FERMÉE — bâtiment tenu par le rival' : name, 34, 130);
    s.tex.needsUpdate = true;
  }

  // -------------------------------------------------------------- état public

  onPub(p: PublicState, initial: boolean): void {
    const world = this.gc.world.buildings;
    const want = new Map<string, { slot: Slot; bid: number; id: VisualId; a: HqAnchor }>();
    for (const slot of SLOTS) {
      const bid = p.hq[slot];
      const b = world[bid];
      const ids = p.hqUpg?.[slot] ?? [];
      for (const id of ids) {
        if (!(VISUAL as readonly string[]).includes(id)) continue;
        const a = b?.hqAnchors?.[id];
        if (a) want.set(`${slot}:${bid}:${id}`, { slot, bid, id: id as VisualId, a });
      }
    }
    for (const [k, pl] of this.placed) if (!want.has(k)) this.remove(pl), this.placed.delete(k);
    const now = this.time;
    let chimes = 0;
    for (const [k, w] of want) {
      if (this.placed.has(k)) continue;
      // nouvel achat (matérialisation et carillon) ou déménagement (matérialisation seule)
      const fresh = !initial && this.known[w.slot] !== null;
      const bought = fresh && this.hqOf[w.slot] === w.bid && !this.known[w.slot]!.has(w.id);
      this.placed.set(k, this.add(w.slot, w.bid, w.id, w.a, fresh ? now : -1, bought && chimes++ === 0));
    }
    for (const slot of SLOTS) {
      this.known[slot] = new Set(p.hqUpg?.[slot] ?? []);
      this.hqOf[slot] = p.hq[slot];
    }
    // trophées exposés
    for (const slot of SLOTS) {
      const n = Math.min(TROPHY_SLOTS.length, p.hqTrophies?.[slot] ?? 0);
      if (n !== this.trophies[slot]) {
        if (!initial && this.trophies[slot] >= 0 && n > this.trophies[slot]) {
          const shelf = [...this.placed.values()].find((q) => q.slot === slot && q.id === 'trophies');
          if (shelf) audio.play('cash', { pos: { x: shelf.a.x, y: shelf.a.y + 1.5, z: shelf.a.z }, volume: 0.6 });
        }
        this.trophies[slot] = n;
        this.dirty = true;
      }
    }
    // enseignes des cliniques : ouvertes ou fermées pour nous
    const rival = FACTION[this.gc.you === 'dadou' ? 'even' : 'dadou'];
    for (const s of this.signs) {
      const closed = p.buildings[s.b.id]?.owner === rival;
      const state = closed ? 'fermee' : 'ouverte';
      if (state !== s.state) {
        s.state = state;
        this.drawSign(s, closed);
        s.mat.uniforms.uTint.value.set(closed ? 0xff8090 : 0xffffff);
      }
    }
    this.dirty = true;
  }

  // -------------------------------------------------------------- pose et retrait

  private add(slot: Slot, bid: number, id: VisualId, a: HqAnchor, born: number, chime = false): Placed {
    const model: ModelKey = id === 'security' ? `security${Math.round((a.s ?? 1.5) * 100)}` : id;
    const dy = id === 'holomap' ? (a.h ?? 0.8) : id === 'transport' ? this.groundAt(a) - a.y : 0;
    const p: Placed = { key: `${slot}:${bid}:${id}`, slot, bid, id, a, base: anchorMatrix(a, dy), model, born, fx: [], vox: null };
    switch (id) {
      case 'holomap':
        this.decorateHolomap(p);
        break;
      case 'surveil':
        this.decorateScreens(p, SURVEIL_ZONE, 512, 256, (c, w, h, t) => this.drawSurveil(p, c, w, h, t));
        this.decorateLeds(p);
        break;
      case 'opscenter':
        this.decorateScreens(p, OPS_ZONE, 512, 224, (c, w, h, t) => this.drawOps(p, c, w, h, t));
        break;
      case 'comms':
      case 'dronecmd':
        this.decorateLeds(p);
        break;
      case 'security':
        this.decorateSecurity(p);
        break;
      case 'cyberstation':
        this.decorateCyber(p, false);
        break;
      case 'autorecruit':
        this.decorateKiosk(p);
        this.decorateScreens(p, KIOSK_ZONE, 112, 208, (c, w, h, t) => this.drawKiosk(p, c, w, h, t));
        break;
    }
    if (HQ_FOOTPRINT[id]) this.pendingVox.push(p);
    if (born >= 0) {
      this.materialize(p);
      if (chime) audio.play('hack_success', { pos: { x: a.x, y: a.y + 1.2, z: a.z }, volume: 0.9 });
    }
    this.dirty = true;
    return p;
  }

  private remove(p: Placed): void {
    for (const o of p.fx) {
      this.group.remove(o);
      o.traverse((x) => {
        const m = x as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (mat && !Array.isArray(mat) && mat !== this.material) mat.dispose();
      });
    }
    p.dispose?.();
    this.clearVox(p);
    this.pendingVox = this.pendingVox.filter((q) => q !== p);
    this.dirty = true;
  }

  /** Altitude du sol sous un point (rue, trottoir), depuis la grille voxel. */
  private groundAt(a: HqAnchor): number {
    const w = this.gc.world.world;
    const x = Math.floor(a.x * INV_VOXEL);
    const z = Math.floor(a.z * INV_VOXEL);
    for (let y = Math.floor((a.y + 1.5) * INV_VOXEL) + GROUND_VY; y > GROUND_VY - 8; y--) if (w.get(x, y, z) !== 0) return (y + 1 - GROUND_VY) * VOXEL;
    return a.y;
  }

  // -------------------------------------------------------------- collisions locales

  /** Les meubles posés au sol bloquent le parrain (grille du client seulement, effacée au retrait). */
  private placeVox(p: Placed): boolean {
    const f = HQ_FOOTPRINT[p.id];
    if (!f) return true;
    const w = this.gc.world.world;
    const me = this.gc.player.pos;
    const s = Math.sin(p.a.yaw);
    const c = Math.cos(p.a.yaw);
    const inside = (x: number, z: number, m: number) => {
      const dx = x - p.a.x;
      const dz = z - p.a.z;
      const v = dx * s + dz * c;
      const u = dx * c - dz * s;
      return Math.abs(u) <= f[0] / 2 + m && v >= 0.05 - m && v <= f[1] + m;
    };
    // le parrain est dedans : on attend qu'il s'écarte
    if (Math.abs(me.y - p.a.y) < 2.2 && inside(me.x, me.z, 0.45)) return false;
    const vox: number[] = [];
    const r = Math.hypot(f[0] / 2, f[1]) + 0.3;
    const y0 = Math.floor(p.a.y * INV_VOXEL + 0.01) + GROUND_VY;
    const y1 = y0 + Math.max(1, Math.round(Math.min(f[2], 2.2) * INV_VOXEL));
    for (let vz = Math.floor((p.a.z - r) * INV_VOXEL); vz <= Math.floor((p.a.z + r) * INV_VOXEL); vz++)
      for (let vx = Math.floor((p.a.x - r) * INV_VOXEL); vx <= Math.floor((p.a.x + r) * INV_VOXEL); vx++) {
        if (!inside((vx + 0.5) * VOXEL, (vz + 0.5) * VOXEL, -0.08)) continue;
        for (let vy = y0; vy < y1; vy++) {
          if (w.get(vx, vy, vz) !== 0) continue;
          w.set(vx, vy, vz, MAT.COLLIDE);
          vox.push(vx, vy, vz);
        }
      }
    p.vox = vox;
    return true;
  }

  private clearVox(p: Placed): void {
    if (!p.vox) return;
    const w = this.gc.world.world;
    for (let i = 0; i < p.vox.length; i += 3) if (w.get(p.vox[i], p.vox[i + 1], p.vox[i + 2]) === MAT.COLLIDE) w.set(p.vox[i], p.vox[i + 1], p.vox[i + 2], 0);
    p.vox = null;
  }

  // -------------------------------------------------------------- décors animés

  /** Matérialisation : colonne de lumière qui s'élève puis s'efface. */
  private materialize(p: Placed): void {
    const f = HQ_FOOTPRINT[p.id] ?? [1.6, 1.2, 2.2];
    const mat = additive(SPRITE_FRAG.replace('vec4 t = texture2D(uMap, vUv);', 'vec4 t = vec4(1.0, 1.0, 1.0, (1.0 - vUv.y) * (0.35 + 0.65 * step(0.5, fract(vUv.y * 9.0 - uTime * 3.0))));'), SPRITE_VERT, {
      uMap: { value: null },
    });
    mat.uniforms.uTint.value.set(p.slot === 'dadou' ? 0xff6070 : 0x70b0ff);
    const geo = new THREE.CylinderGeometry(Math.max(f[0], f[1]) * 0.62, Math.max(f[0], f[1]) * 0.62, 2.6, 24, 1, true);
    geo.translate(0, 1.3, 0);
    const mesh = new THREE.Mesh(geo, mat);
    const c = ahead(p.a, p.id === 'holomap' || p.id === 'transport' || p.id === 'security' ? 0 : f[1] / 2);
    mesh.position.set(c.x, p.a.y, c.z);
    this.group.add(mesh);
    const t0 = this.time;
    const prevUpdate = p.update;
    p.fx.push(mesh);
    p.update = (now, near) => {
      prevUpdate?.(now, near);
      const k = (now - t0) / 1.6;
      if (k >= 1) {
        mesh.visible = false;
        return;
      }
      mat.uniforms.uAlpha.value = Math.sin(Math.min(1, k) * Math.PI) * 1.3;
      mesh.scale.set(1 + k * 0.15, 0.2 + Math.min(1, k * 1.6), 1 + k * 0.15);
    };
  }

  /** Carte holographique : New York en volumes lumineux aux couleurs des propriétaires, en direct. */
  private decorateHolomap(p: Placed): void {
    const a = p.a;
    const width = Math.max(0.9, (a.s ?? 1.2) * 0.92);
    const k = width / WORLD_W;
    const hk = k * 1.7;
    const root = new THREE.Group();
    // maquette orientée comme la ville (le nord vers −z)
    root.position.set(a.x, a.y + (a.h ?? 0.8) + 0.12, a.z);
    // volumes : bâtiments du jeu puis immeubles de décor
    const blds = this.gc.world.buildings;
    const n = blds.length + FILLERS.length;
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const mat = additive(HOLO_FRAG, HOLO_VERT);
    const inst = new THREE.InstancedMesh(box, mat, n);
    inst.frustumCulled = false;
    const tmp = new THREE.Matrix4();
    const put = (i: number, r: readonly number[], h: number) => {
      tmp.makeScale((r[2] - r[0]) * k * 0.9, Math.max(0.006, h * hk), (r[3] - r[1]) * k * 0.9);
      tmp.setPosition(((r[0] + r[2]) / 2 - WORLD_W / 2) * k, 0, ((r[1] + r[3]) / 2 - WORLD_D / 2) * k);
      inst.setMatrixAt(i, tmp);
      inst.setColorAt(i, new THREE.Color(0x2a6a80));
    };
    blds.forEach((b, i) => put(i, b.footprint, Math.min(70, b.height)));
    FILLERS.forEach((f, i) => put(blds.length + i, f.rect, f.height));
    inst.instanceMatrix.needsUpdate = true;
    root.add(inst);
    // socle : quadrillage, rivière, anneaux
    const grid = document.createElement('canvas');
    grid.width = 256;
    grid.height = 214;
    const g = grid.getContext('2d')!;
    g.strokeStyle = 'rgba(90,220,255,0.55)';
    g.lineWidth = 1;
    for (let x = 0; x <= 256; x += 16) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 214);
      g.stroke();
    }
    for (let y = 0; y <= 214; y += 16) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(256, y);
      g.stroke();
    }
    g.fillStyle = 'rgba(40,120,255,0.55)';
    g.fillRect((390 / WORLD_W) * 256, 0, (40 / WORLD_W) * 256, 214);
    g.strokeStyle = 'rgba(160,240,255,0.9)';
    g.lineWidth = 3;
    g.strokeRect(1, 1, 254, 212);
    const gt = new THREE.CanvasTexture(grid);
    const gm = additive(SPRITE_FRAG, SPRITE_VERT, { uMap: { value: gt } });
    gm.uniforms.uAlpha.value = 0.55;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, WORLD_D * k), gm);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.002;
    root.add(plane);
    const ringMat = additive(HOLO_FRAG, HOLO_VERT);
    ringMat.uniforms.uTint.value.set(0x60e8ff);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(width * 0.62, 0.006 + width * 0.004, 4, 64), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.04;
    root.add(ring);
    // repères : lieutenants (nos hommes), ennemis repérés, combats
    const markGeo = new THREE.BoxGeometry(1, 1, 1);
    markGeo.translate(0, 0.5, 0);
    const marks = new THREE.InstancedMesh(markGeo, additive(HOLO_FRAG, HOLO_VERT), 64);
    marks.frustumCulled = false;
    marks.count = 0;
    root.add(marks);
    this.group.add(root);
    p.fx.push(root);
    let acc = 1;
    p.update = (now, near) => {
      root.visible = near;
      if (!near) return;
      ring.rotation.z = now * 0.4;
      root.position.y = a.y + (a.h ?? 0.8) + 0.12 + Math.sin(now * 1.3) * 0.006;
      acc += 1 / 60;
      if (acc < 0.5) return;
      acc = 0;
      // couleurs des propriétaires et marques en direct
      const pub = this.gc.pub;
      const c = new THREE.Color();
      blds.forEach((b, i) => {
        const st = pub.buildings[b.id];
        const own = st?.owner ?? Faction.NONE;
        if (pub.hq.dadou === b.id || pub.hq.even === b.id) c.set(pub.hq.dadou === b.id ? 0xff7080 : 0x8fc0ff);
        else if (own === Faction.DADOU) c.set(0xd02838);
        else if (own === Faction.EVEN) c.set(0x3a6cff);
        else if (BUILDINGS[b.id]?.isKey) c.set(0xffd040);
        else c.set(0x30a8c8);
        if (st && st.cap > 0 && st.capBy && Math.sin(now * 8) > 0) c.set(0xffa040);
        inst.setColorAt(i, c);
      });
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      let m = 0;
      const mark = (x: number, z: number, h: number, col: number, wd = 3) => {
        if (m >= 64) return;
        tmp.makeScale(wd * k, h, wd * k);
        tmp.setPosition((x - WORLD_W / 2) * k, 0, (z - WORLD_D / 2) * k);
        marks.setMatrixAt(m, tmp);
        marks.setColorAt(m, c.set(col));
        m++;
      };
      if (p.slot === this.gc.you) {
        const priv = this.gc.priv;
        for (const lt of priv.lieutenants) if (lt.alive) mark(lt.x, lt.z, 0.16 * width, 0xffe060, 4);
        for (const s of priv.spotted) mark(s.x, s.z, 0.08 * width, 0xff3030, 3 + Math.min(4, s.n));
        for (const o of priv.hqUp?.rivalOps ?? []) mark(o.x, o.z, 0.12 * width, 0xff60ff, 5);
      }
      for (const bt of pub.battles) mark(bt.x, bt.z, 0.05 * width, 0xff8020, 8);
      marks.count = m;
      marks.instanceMatrix.needsUpdate = true;
      if (marks.instanceColor) marks.instanceColor.needsUpdate = true;
    };
  }

  /** Écrans animés (toile redessinée quelques fois par seconde quand on est tout près). */
  private decorateScreens(p: Placed, zone: ScreenZone, W: number, H: number, draw: (c: CanvasRenderingContext2D, w: number, h: number, t: number) => void): void {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.ShaderMaterial({ vertexShader: SPRITE_VERT, fragmentShader: SCREEN_FRAG, uniforms: { uMap: { value: tex }, uBright: { value: 1.25 } } });
    mat.toneMapped = false;
    const m = this.batch(p.model, 2).model;
    const w = (zone.x1 - zone.x0) / 16;
    const h = (zone.y1 - zone.y0) / 16;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const cx = ((zone.x0 + zone.x1) / 2 - m.ox) / 16;
    const cy = (zone.y0 + zone.y1) / 2 / 16;
    mesh.position.set(cx, cy, zone.z / 16);
    const holder = new THREE.Group();
    holder.position.set(p.a.x, p.a.y, p.a.z);
    holder.rotation.y = p.a.yaw;
    holder.add(mesh);
    this.group.add(holder);
    p.fx.push(holder);
    let acc = 1;
    draw(ctx, W, H, 0);
    tex.needsUpdate = true;
    const prev = p.update;
    p.update = (now, near) => {
      prev?.(now, near);
      if (!near) return;
      acc += 1 / 60;
      if (acc < 0.25) return;
      acc = 0;
      draw(ctx, W, H, now);
      tex.needsUpdate = true;
    };
  }

  /** Diodes clignotantes : les voxels NEON_GREEN et NEON_AMBER du modèle. */
  private decorateLeds(p: Placed): void {
    const m = this.batch(p.model, 2).model;
    const pts = [...voxelsOf(m, VSLOT.NEON_GREEN).map((q) => [...q, 0] as const), ...voxelsOf(m, VSLOT.NEON_AMBER).map((q) => [...q, 1] as const)];
    if (!pts.length) return;
    const pos = new Float32Array(pts.length * 3);
    const col = new Float32Array(pts.length * 3);
    const ph = new Float32Array(pts.length);
    pts.forEach((q, i) => {
      pos.set([q[0], q[1], q[2] + 0.035], i * 3);
      col.set(q[3] ? [1, 0.65, 0.15] : [0.3, 1, 0.5], i * 3);
      ph[i] = (i * 0.6180339) % 1;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    const mat = new THREE.ShaderMaterial({ vertexShader: LED_VERT, fragmentShader: LED_FRAG, uniforms: { uTime: holoUniforms.uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.toneMapped = false;
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.position.set(p.a.x, p.a.y, p.a.z);
    points.rotation.y = p.a.yaw;
    this.group.add(points);
    p.fx.push(points);
    const prev = p.update;
    p.update = (now, near) => {
      prev?.(now, near);
      points.visible = near;
    };
  }

  /** Portique : nappe laser qui balaie l'ouverture de haut en bas. */
  private decorateSecurity(p: Placed): void {
    const dw = (p.a.s ?? 1.5) - 0.25;
    const mat = additive(SPRITE_FRAG.replace('vec4 t = texture2D(uMap, vUv);', 'vec4 t = vec4(1.0, 1.0, 1.0, smoothstep(0.0, 0.5, 1.0 - abs(vUv.y - 0.5) * 2.0));'), SPRITE_VERT, { uMap: { value: null } });
    mat.uniforms.uTint.value.set(0xff2030);
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(dw, 0.07), mat);
    sheet.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.position.set(p.a.x, p.a.y, p.a.z);
    holder.rotation.y = p.a.yaw;
    sheet.position.set(0, 1, 14.5 / 16);
    holder.add(sheet);
    this.group.add(holder);
    p.fx.push(holder);
    const prev = p.update;
    p.update = (now, near) => {
      prev?.(now, near);
      holder.visible = near;
      if (!near) return;
      sheet.position.y = 0.15 + (0.5 + 0.5 * Math.sin(now * 1.6)) * 2.05;
      mat.uniforms.uAlpha.value = 0.8 + 0.2 * Math.sin(now * 23);
    };
  }

  /** Fauteuil d'implantation : silhouette holographique allongée et anneau de scan qui la parcourt. */
  private decorateCyber(p: Placed, clinic: boolean): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const c = canvas.getContext('2d')!;
    c.strokeStyle = '#ffffff';
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 4;
    // silhouette allongée (tête à gauche)
    c.beginPath();
    c.arc(34, 48, 15, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.beginPath();
    c.roundRect(52, 30, 92, 36, 14);
    c.fill();
    c.stroke();
    c.beginPath();
    c.moveTo(144, 38);
    c.lineTo(236, 34);
    c.moveTo(144, 58);
    c.lineTo(236, 62);
    c.moveTo(70, 30);
    c.lineTo(120, 12);
    c.moveTo(70, 66);
    c.lineTo(120, 84);
    c.stroke();
    c.fillStyle = '#ff3050';
    for (const [x, y] of [
      [34, 48],
      [90, 40],
      [112, 56],
      [200, 36],
    ]) {
      c.beginPath();
      c.arc(x, y, 5, 0, Math.PI * 2);
      c.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    const mat = additive(SPRITE_FRAG, SPRITE_VERT, { uMap: { value: tex } });
    mat.uniforms.uTint.value.set(clinic ? 0x60f0ff : p.slot === 'dadou' ? 0xff7080 : 0x80b8ff);
    mat.uniforms.uAlpha.value = 0.7;
    const body = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 0.66), mat);
    body.rotation.x = -Math.PI / 2;
    body.position.set(-0.05, 0.98, CLINIC_SEAT_DEPTH);
    const ringMat = additive(HOLO_FRAG, HOLO_VERT);
    ringMat.uniforms.uTint.value.set(clinic ? 0x60f0ff : 0xffffff);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.012, 4, 40), ringMat);
    ring.rotation.y = Math.PI / 2;
    const holder = new THREE.Group();
    holder.position.set(p.a.x, p.a.y, p.a.z);
    holder.rotation.y = p.a.yaw;
    holder.add(body, ring);
    this.group.add(holder);
    p.fx.push(holder);
    const prev = p.update;
    p.update = (now, near) => {
      prev?.(now, near);
      holder.visible = near;
      if (!near) return;
      ring.position.set(Math.sin(now * 0.9) * 0.85, 0.95, CLINIC_SEAT_DEPTH);
      body.position.y = 0.98 + Math.sin(now * 1.7) * 0.015;
    };
  }

  /** Terminal de recrutement : hologramme « RECRUTEMENT » qui tourne au-dessus de la borne. */
  private decorateKiosk(p: Placed): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#ffffff';
    c.lineWidth = 5;
    // silhouette au chapeau
    c.fillRect(104, 6, 48, 6);
    c.fillRect(114, 0, 28, 10);
    c.beginPath();
    c.arc(128, 26, 12, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(100, 70);
    c.lineTo(110, 42);
    c.lineTo(146, 42);
    c.lineTo(156, 70);
    c.closePath();
    c.fill();
    c.font = `900 26px ${MAP_FONT_TITLE}`;
    c.textAlign = 'center';
    c.fillText('RECRUTEMENT', 128, 100);
    c.font = `700 18px ${MAP_FONT}`;
    c.fillText('+1 TOUTES LES 15 s', 128, 122);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = additive(SPRITE_FRAG, SPRITE_VERT, { uMap: { value: tex } });
    mat.uniforms.uTint.value.set(p.slot === 'dadou' ? 0xff8090 : 0x90c8ff);
    const sprite = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), mat);
    const holder = new THREE.Group();
    const f = ahead(p.a, 0.3);
    holder.position.set(f.x, p.a.y + 2.32, f.z);
    holder.add(sprite);
    this.group.add(holder);
    p.fx.push(holder);
    const prev = p.update;
    const cam = this.gc.camera.position;
    p.update = (now, near) => {
      prev?.(now, near);
      holder.visible = near;
      if (!near) return;
      // toujours face au regard (le texte ne passe jamais à l'envers), léger flottement
      holder.rotation.y = Math.atan2(cam.x - holder.position.x, cam.z - holder.position.z);
      holder.position.y = p.a.y + 2.32 + Math.sin(now * 1.3) * 0.03;
    };
  }

  // -------------------------------------------------------------- toiles des écrans

  private drawSurveil(p: Placed, c: CanvasRenderingContext2D, W: number, H: number, t: number): void {
    const mine = p.slot === this.gc.you;
    const watch = mine ? (this.gc.priv.hqUp?.watch ?? []) : [];
    const hq = this.gc.world.buildings[p.bid];
    const z = SURVEIL_ZONE;
    const sx = W / (z.x1 - z.x0);
    const sy = H / (z.y1 - z.y0);
    c.fillStyle = '#020407';
    c.fillRect(0, 0, W, H);
    const names = ['CAM 01 · ENTRÉE', 'CAM 02 · RUE', 'CAM 03 · TOIT', 'CAM 04 · HALL', 'CAM 05 · BUREAU', 'RADAR · 50 m'];
    z.cells.forEach(([x0, y0, x1, y1], i) => {
      const X = (x0 + 1 - z.x0) * sx;
      const Y = (z.y1 - y1 + 1) * sy;
      const w = (x1 - x0 - 2) * sx;
      const h = (y1 - y0 - 2) * sy;
      c.save();
      c.beginPath();
      c.rect(X, Y, w, h);
      c.clip();
      if (!mine) {
        // flux chiffrés : neige
        for (let k = 0; k < 140; k++) {
          c.fillStyle = `rgba(160,170,190,${Math.random() * 0.5})`;
          c.fillRect(X + Math.random() * w, Y + Math.random() * h, 3, 2);
        }
        c.fillStyle = '#ff5060';
        c.font = `700 14px ${MAP_FONT_TITLE}`;
        c.fillText('FLUX CRYPTÉ', X + 8, Y + h / 2);
        c.restore();
        return;
      }
      if (i === 5) {
        // radar : intrus autour du QG
        c.fillStyle = '#0c2a1d';
        c.fillRect(X, Y, w, h);
        const cx = X + w / 2;
        const cy = Y + h / 2;
        const R = Math.min(w, h) * 0.46;
        c.strokeStyle = 'rgba(110,255,170,0.55)';
        for (const r of [R, R * 0.66, R * 0.33]) {
          c.beginPath();
          c.arc(cx, cy, r, 0, Math.PI * 2);
          c.stroke();
        }
        const a = t * 2;
        const sweep = c.createRadialGradient(cx, cy, 0, cx, cy, R);
        sweep.addColorStop(0, 'rgba(110,255,170,0.35)');
        sweep.addColorStop(1, 'rgba(110,255,170,0.05)');
        c.fillStyle = sweep;
        c.beginPath();
        c.moveTo(cx, cy);
        c.arc(cx, cy, R, a - 0.6, a);
        c.closePath();
        c.fill();
        c.strokeStyle = 'rgba(140,255,190,0.95)';
        c.beginPath();
        c.moveTo(cx, cy);
        c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        c.stroke();
        c.fillStyle = '#7dffb0';
        c.fillRect(cx - 3, cy - 3, 6, 6);
        for (const wv of watch) {
          const dx = (wv.x - hq.center.x) / 50;
          const dz = (wv.z - hq.center.z) / 50;
          if (Math.hypot(dx, dz) > 1) continue;
          c.fillStyle = Math.sin(t * 9) > 0 ? '#ff4040' : '#ff9090';
          c.beginPath();
          c.arc(cx + dx * R, cy + dz * R, 4, 0, Math.PI * 2);
          c.fill();
        }
      } else {
        // vue de caméra (scène selon l'emplacement), intrus repérés encadrés
        cctv(c, X, Y, w, h, i, t);
        const seen = watch.filter((wv) => (i < 2 || i === 3 ? wv.site === 'QG' : wv.site !== 'QG'));
        const show = seen.slice(0, 3);
        show.forEach((wv, k) => {
          const px = X + w * (0.25 + 0.25 * k) + Math.sin(t * 0.7 + k) * 4;
          const py = Y + h * 0.86;
          c.fillStyle = '#0d1214';
          c.fillRect(px - 5, py - 24, 10, 24);
          c.beginPath();
          c.arc(px, py - 29, 5, 0, Math.PI * 2);
          c.fill();
          c.strokeStyle = '#ff3a3a';
          c.lineWidth = 2;
          c.strokeRect(px - 10, py - 38, 20, 40);
          c.lineWidth = 1;
          c.fillStyle = '#ff4a4a';
          c.font = `800 10px ${MAP_FONT_TITLE}`;
          c.fillText('INTRUS', px - 17, py - 42);
          void wv;
        });
        // grain, ligne de balayage, vignettage, teinte des caméras
        c.fillStyle = 'rgba(255,255,255,0.08)';
        c.fillRect(X, Y + ((t * 40 + i * 13) % h), w, 4);
        for (let k = 0; k < 36; k++) {
          c.fillStyle = `rgba(255,255,255,${(Math.random() * 0.14).toFixed(3)})`;
          c.fillRect(X + Math.random() * w, Y + Math.random() * h, 2, 1);
        }
        const v = c.createRadialGradient(X + w / 2, Y + h / 2, Math.min(w, h) * 0.35, X + w / 2, Y + h / 2, Math.max(w, h) * 0.72);
        v.addColorStop(0, 'rgba(0,0,0,0)');
        v.addColorStop(1, 'rgba(0,0,0,0.5)');
        c.fillStyle = v;
        c.fillRect(X, Y, w, h);
        c.fillStyle = 'rgba(70,255,170,0.07)';
        c.fillRect(X, Y, w, h);
        const s = Math.floor(this.gc.pub.elapsed);
        c.fillStyle = show.length ? '#ff7070' : 'rgba(190,255,215,0.9)';
        c.font = `700 10px ${MAP_FONT_TITLE}`;
        c.fillText(show.length ? `ALERTE · ${seen.length}` : 'RAS', X + 4, Y + h - 5);
        c.fillStyle = 'rgba(230,245,255,0.85)';
        c.font = `600 10px ${MAP_FONT}`;
        c.fillText(`${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`, X + w - 50, Y + h - 5);
      }
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.fillRect(X, Y, w, 14);
      c.fillStyle = '#d8f4ff';
      c.font = `600 11px ${MAP_FONT}`;
      c.fillText(names[i], X + 4, Y + 11);
      if (Math.floor(t * 2) % 2 === 0) {
        c.fillStyle = '#ff3040';
        c.beginPath();
        c.arc(X + w - 8, Y + 7, 3.5, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    });
  }

  /** Écran de la borne de recrutement : réserve du QG, recrue suivante, compteur. */
  private drawKiosk(p: Placed, c: CanvasRenderingContext2D, W: number, H: number, t: number): void {
    const mine = p.slot === this.gc.you;
    const dadou = p.slot === 'dadou';
    const accent = dadou ? '#ff6474' : '#7fb4ff';
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, dadou ? '#5a1621' : '#16305a');
    g.addColorStop(1, '#0b0f16');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.textAlign = 'center';
    c.fillStyle = accent;
    c.font = `900 14px ${MAP_FONT_TITLE}`;
    c.fillText('RECRUTEMENT', W / 2, 20, W - 10);
    c.fillRect(10, 27, W - 20, 2);
    if (!mine) {
      c.fillStyle = '#ff5060';
      c.font = `800 14px ${MAP_FONT_TITLE}`;
      c.fillText('ACCÈS', W / 2, H / 2 - 4);
      c.fillText('REFUSÉ', W / 2, H / 2 + 14);
      c.textAlign = 'left';
      return;
    }
    const priv = this.gc.priv;
    const pool = priv.pool;
    const full = pool >= 4;
    const broke = priv.money < 500;
    // silhouette au chapeau
    c.fillStyle = '#eef3f8';
    c.fillRect(W / 2 - 15, 41, 30, 4);
    c.fillRect(W / 2 - 9, 34, 18, 8);
    c.beginPath();
    c.arc(W / 2, 53, 8, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(W / 2 - 20, 86);
    c.lineTo(W / 2 - 13, 64);
    c.lineTo(W / 2 + 13, 64);
    c.lineTo(W / 2 + 20, 86);
    c.closePath();
    c.fill();
    c.fillStyle = '#d8e4ee';
    c.font = `800 11px ${MAP_FONT_TITLE}`;
    c.fillText('RÉSERVE DU QG', W / 2, 104, W - 12);
    c.fillStyle = full ? '#7dffb0' : '#ffd24a';
    c.font = `900 30px ${MAP_FONT_TITLE}`;
    c.fillText(String(Math.min(pool, 999)), W / 2, 136);
    c.fillStyle = 'rgba(255,255,255,0.16)';
    c.fillRect(12, 146, W - 24, 9);
    c.fillStyle = full ? '#7dffb0' : broke ? '#ff5060' : accent;
    c.fillRect(12, 146, (W - 24) * (full ? 1 : broke ? 0.08 : (t / 15) % 1), 9);
    c.fillStyle = '#d8e4ee';
    c.font = `700 10px ${MAP_FONT}`;
    c.fillText(full ? 'Réserve complète' : broke ? 'Fonds insuffisants' : 'Recrue suivante…', W / 2, 170, W - 8);
    const n = priv.hqUp?.recruits ?? 0;
    c.fillText(`${n} recrue${n > 1 ? 's' : ''} · 80 $`, W / 2, 186, W - 8);
    c.fillStyle = 'rgba(216,228,238,0.6)';
    c.fillText('seuil : 4 hommes', W / 2, 200, W - 8);
    c.textAlign = 'left';
  }

  private drawOps(p: Placed, c: CanvasRenderingContext2D, W: number, H: number, t: number): void {
    const mine = p.slot === this.gc.you;
    const z = OPS_ZONE;
    const sx = W / (z.x1 - z.x0);
    const sy = H / (z.y1 - z.y0);
    c.fillStyle = '#0a1420';
    c.fillRect(0, 0, W, H);
    const ops = mine ? (this.gc.priv.hqUp?.ops ?? []) : [];
    const accent = p.slot === 'dadou' ? '#ff6a78' : '#8cbcff';
    z.cells.forEach(([x0, y0, x1, y1], i) => {
      const X = (x0 + 1 - z.x0) * sx;
      const Y = (z.y1 - y1 + 1) * sy;
      const w = (x1 - x0 - 2) * sx;
      const h = (y1 - y0 - 2) * sy;
      c.save();
      c.beginPath();
      c.rect(X, Y, w, h);
      c.clip();
      const g = c.createLinearGradient(0, Y, 0, Y + h);
      g.addColorStop(0, '#163252');
      g.addColorStop(1, '#0c1b2e');
      c.fillStyle = g;
      c.fillRect(X, Y, w, h);
      if (!mine) {
        c.fillStyle = '#ff5060';
        c.font = `800 15px ${MAP_FONT_TITLE}`;
        c.fillText('ACCÈS REFUSÉ', X + 8, Y + h / 2 + 5);
        c.restore();
        return;
      }
      if (i < 3) {
        const op = ops[i];
        c.fillStyle = accent;
        c.fillRect(X, Y, w, 18);
        c.fillStyle = '#0a1018';
        c.font = `900 13px ${MAP_FONT_TITLE}`;
        c.fillText(`OPÉRATION ${i + 1}`, X + 5, Y + 14);
        if (!op) {
          c.fillStyle = 'rgba(210,228,255,0.75)';
          c.font = `700 13px ${MAP_FONT}`;
          c.fillText('En attente', X + 6, Y + 40);
          c.fillText('d’ordres', X + 6, Y + 56);
        } else {
          const b = BUILDINGS[op.b];
          c.fillStyle = '#f2f8ff';
          c.font = `800 14px ${MAP_FONT}`;
          c.fillText(op.name, X + 5, Y + 35, w - 80);
          c.fillStyle = 'rgba(210,228,255,0.85)';
          c.font = `600 12px ${MAP_FONT}`;
          c.fillText(b ? b.name : '', X + 5, Y + 50, w - 10);
          c.fillStyle = 'rgba(255,255,255,0.18)';
          c.fillRect(X + 5, Y + h - 14, w - 10, 10);
          c.fillStyle = accent;
          c.fillRect(X + 5, Y + h - 14, (w - 10) * op.p, 10);
          c.fillStyle = '#ffffff';
          c.font = `800 12px ${MAP_FONT_TITLE}`;
          c.fillText(`${Math.round(op.p * 100)} %${op.eta >= 0 ? ` · ${op.eta} s` : ''}`, X + w - 70, Y + 35);
        }
      } else if (i === 3) {
        // carte des cibles
        c.strokeStyle = 'rgba(140,210,255,0.5)';
        c.strokeRect(X + 4, Y + 4, w - 8, h - 8);
        const k = Math.min((w - 8) / WORLD_W, (h - 8) / WORLD_D);
        const ox = X + 4 + (w - 8 - WORLD_W * k) / 2;
        c.strokeStyle = 'rgba(140,210,255,0.22)';
        c.beginPath();
        for (let gx = 0; gx <= WORLD_W; gx += 100) {
          c.moveTo(ox + gx * k, Y + 4);
          c.lineTo(ox + gx * k, Y + 4 + WORLD_D * k);
        }
        c.stroke();
        for (const op of ops) {
          const b = this.gc.world.buildings[op.b];
          if (!b) continue;
          const px = ox + b.center.x * k;
          const py = Y + 4 + b.center.z * k;
          c.strokeStyle = accent;
          c.lineWidth = 2;
          c.beginPath();
          c.arc(px, py, 4 + ((t * 6) % 7), 0, Math.PI * 2);
          c.stroke();
          c.lineWidth = 1;
        }
        const hq = this.gc.world.buildings[p.bid];
        c.fillStyle = '#ffd24a';
        c.fillRect(ox + hq.center.x * k - 3, Y + 4 + hq.center.z * k - 3, 6, 6);
      } else {
        c.fillStyle = accent;
        c.font = `900 17px ${MAP_FONT_TITLE}`;
        c.fillText('OPÉRATIONS', X + 6, Y + 21, w - 12);
        c.fillStyle = '#f2f8ff';
        c.font = `700 14px ${MAP_FONT}`;
        c.fillText(`${ops.length} en cours`, X + 6, Y + 42);
        c.fillText('Prises ×1,35', X + 6, Y + 60);
        c.fillStyle = 'rgba(210,228,255,0.7)';
        c.font = `600 12px ${MAP_FONT}`;
        const s = Math.floor(this.gc.pub.elapsed);
        c.fillText(`T+${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`, X + 6, Y + h - 6);
      }
      c.restore();
    });
  }

  // -------------------------------------------------------------- image

  update(dt: number, now: number): void {
    this.time = now;
    holoUniforms.uTime.value = now;
    if (this.dirty) this.rebuild();
    // collisions en attente (le parrain se tenait dedans)
    if (this.pendingVox.length) this.pendingVox = this.pendingVox.filter((p) => !this.placeVox(p));
    const cam = this.gc.camera.position;
    const near = (p: Placed, r = 34) => Math.abs(p.a.x - cam.x) < r && Math.abs(p.a.z - cam.z) < r && Math.abs(p.a.y - cam.y) < 9;
    let anim = false;
    for (const p of this.placed.values()) {
      p.update?.(now, near(p));
      if (p.born >= 0 && now - p.born < 1.2) anim = true;
      else if (p.born >= 0 && now - p.born >= 1.2) {
        p.born = -1;
        anim = true;
      }
    }
    for (const p of this.clinics) p.update?.(now, near(p, 30));
    for (const s of this.signs) {
      const d = Math.hypot(s.mesh.position.x - cam.x, s.mesh.position.z - cam.z);
      s.mesh.visible = d < 140;
    }
    if (anim) this.writeMatrices(now);
    this.animateMovers(now);
    void dt;
  }

  /** Reconstruit les instances (poses, propriétaires, trophées). */
  private rebuild(): void {
    this.dirty = false;
    const counts = new Map<ModelKey, number>();
    const all = [...this.placed.values(), ...this.clinics];
    for (const p of all) counts.set(p.model, (counts.get(p.model) ?? 0) + 1);
    for (const p of this.placed.values()) {
      if (p.id === 'holomap') counts.set('projector', (counts.get('projector') ?? 0) + 1);
      if (p.id === 'transport') counts.set('bike', (counts.get('bike') ?? 0) + 1);
      if (p.id === 'dronecmd') counts.set('drone', (counts.get('drone') ?? 0) + 1);
    }
    for (const slot of SLOTS) {
      const shelf = [...this.placed.values()].find((q) => q.slot === slot && q.id === 'trophies');
      if (!shelf) continue;
      for (let i = 0; i < Math.max(0, this.trophies[slot]); i++) counts.set(`trophy${i % 3}` as ModelKey, (counts.get(`trophy${i % 3}` as ModelKey) ?? 0) + 1);
    }
    for (const [k, b] of this.batches) if (!counts.has(k)) b.mesh.count = 0;
    for (const [k, n] of counts) this.batch(k, n);
    this.writeMatrices(this.time);
  }

  /** Échelle d'apparition : de 0 à 1 avec un léger rebond. */
  private grow(p: Placed, now: number): number {
    if (p.born < 0) return 1;
    const k = Math.min(1, Math.max(0, (now - p.born - 0.25) / 0.8));
    return k <= 0 ? 0.001 : 1 + Math.sin(k * Math.PI) * 0.06 - (1 - k) * (1 - k);
  }

  private writeMatrices(now: number): void {
    const fill = new Map<ModelKey, number>();
    const tmp = new THREE.Matrix4();
    const sc = new THREE.Matrix4();
    const put = (k: ModelKey, m: THREE.Matrix4, owner: number) => {
      const b = this.batches.get(k);
      if (!b) return;
      const i = fill.get(k) ?? 0;
      if (i >= b.cap) return;
      b.mesh.setMatrixAt(i, m);
      b.owner.array[i] = owner;
      fill.set(k, i + 1);
    };
    const ownerOf = (p: Placed) => (p.slot ? FACTION[p.slot] : this.gc.pub.buildings[p.bid]?.owner === Faction.DADOU ? 1 : this.gc.pub.buildings[p.bid]?.owner === Faction.EVEN ? 2 : 0);
    for (const p of [...this.placed.values(), ...this.clinics]) {
      const g = this.grow(p, now);
      tmp.copy(p.base).multiply(sc.makeScale(g, g, g));
      const owner = ownerOf(p);
      if (p.id === 'holomap') {
        put('projector', tmp, owner);
        continue;
      }
      put(p.model, tmp, owner);
      if (p.id === 'trophies' && p.slot) {
        const n = Math.max(0, this.trophies[p.slot]);
        for (let i = 0; i < n; i++) {
          const s = TROPHY_SLOTS[i];
          const m = new THREE.Matrix4().makeTranslation(s[0], s[1], s[2]);
          put(`trophy${i % 3}` as ModelKey, new THREE.Matrix4().copy(tmp).multiply(m), owner);
        }
      }
    }
    for (const [k, b] of this.batches) {
      if (k === 'bike' || k === 'drone') continue;
      b.mesh.count = fill.get(k) ?? 0;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.owner.needsUpdate = true;
    }
  }

  /** Moto à sustentation qui flotte, drone qui patrouille dans le bureau. */
  private animateMovers(now: number): void {
    const bike = this.batches.get('bike');
    const drone = this.batches.get('drone');
    let nb = 0;
    let nd = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (const p of this.placed.values()) {
      const g = this.grow(p, now);
      if (p.id === 'transport' && bike && nb < bike.cap) {
        const base = new THREE.Vector3().setFromMatrixPosition(p.base);
        const bob = Math.sin(now * 1.7 + p.a.x) * 0.05;
        e.set(0, p.a.yaw + 0.6, Math.sin(now * 1.1) * 0.03);
        q.setFromEuler(e);
        m.compose(new THREE.Vector3(base.x, base.y + 0.62 + bob, base.z), q, new THREE.Vector3(g, g, g));
        bike.mesh.setMatrixAt(nb, m);
        bike.owner.array[nb] = p.slot ? FACTION[p.slot] : 0;
        nb++;
      }
      if (p.id === 'dronecmd' && drone && nd < drone.cap) {
        // boucle devant le râtelier, à hauteur de plafond
        const t = now * 0.55 + p.a.x;
        const u = Math.cos(t) * 1.1;
        const v = 1.25 + Math.sin(t * 2) * 0.45;
        const s = Math.sin(p.a.yaw);
        const c = Math.cos(p.a.yaw);
        const x = p.a.x + s * v + c * u;
        const z = p.a.z + c * v - s * u;
        const vx = -Math.sin(t) * c + Math.cos(t * 2) * 0.9 * s;
        const vz = Math.sin(t) * s + Math.cos(t * 2) * 0.9 * c;
        e.set(0.12, Math.atan2(vx, vz), Math.sin(now * 2) * 0.08);
        q.setFromEuler(e);
        m.compose(new THREE.Vector3(x, p.a.y + 2.05 + Math.sin(now * 3.1) * 0.04, z), q, new THREE.Vector3(g, g, g));
        drone.mesh.setMatrixAt(nd, m);
        drone.owner.array[nd] = p.slot ? FACTION[p.slot] : 0;
        nd++;
      }
    }
    if (bike) {
      bike.mesh.count = nb;
      bike.mesh.instanceMatrix.needsUpdate = true;
      bike.owner.needsUpdate = true;
    }
    if (drone) {
      drone.mesh.count = nd;
      drone.mesh.instanceMatrix.needsUpdate = true;
      drone.owner.needsUpdate = true;
    }
  }

  // -------------------------------------------------------------- interactions

  interaction(bid: number): Interaction | null {
    void bid;
    const gc = this.gc;
    if (gc.player.dead) return null;
    const me = gc.player.pos;
    const key = actionKey(settings.bindings, 'interact');
    const close = (x: number, y: number, z: number, r: number) => Math.hypot(x - me.x, z - me.z) < r && Math.abs(me.y - y) < 1.6;
    // cliniques
    for (const p of this.clinics) {
      const b = gc.world.buildings[p.bid];
      const s = clinicSeat(b.clinic!);
      if (!close(s.x, s.y, s.z, CLINIC_REACH)) continue;
      const rival = gc.you === 'dadou' ? 'even' : 'dadou';
      if (gc.pub.buildings[p.bid]?.owner === FACTION[rival])
        return { key, text: 'Clinique fermée', sub: `${BOSS_NAME[rival]} contrôle ${leNom(b.def.name)}`, run: () => gc.hud.notify(`Clinique fermée : ${BOSS_NAME[rival]} contrôle ${leNom(b.def.name)}. Reprenez le bâtiment ou trouvez une autre clinique.`, 'bad') };
      return { key, text: `${b.clinic!.name}`, sub: 'Implants : achat, installation, améliorations, configurations', run: () => openCyberScreen(gc) };
    }
    // équipements de notre QG
    for (const p of this.placed.values()) {
      if (p.slot !== gc.you) continue;
      const f = HQ_FOOTPRINT[p.id];
      const front = ahead(p.a, (f ? f[1] : 0) + 0.55);
      const hq = gc.world.buildings[p.bid];
      const priv = gc.priv;
      switch (p.id) {
        case 'cyberstation': {
          const s = clinicSeat({ name: '', ...p.a });
          if (close(s.x, s.y, s.z, CLINIC_REACH)) return { key, text: 'Station cybernétique', sub: 'Implants : achat, installation, améliorations, configurations', run: () => openCyberScreen(gc) };
          break;
        }
        case 'autorecruit':
          if (close(front.x, p.a.y, front.z, 1.6)) {
            const n = priv.hqUp?.recruits ?? 0;
            return { key, text: 'Terminal de recrutement', sub: `${n} recrue${n > 1 ? 's' : ''} automatique${n > 1 ? 's' : ''} — il garde la réserve à 4 hommes`, run: () => gc.strategic.show('recruit') };
          }
          break;
        case 'trophies':
          if (close(front.x, p.a.y, front.z, 1.8)) {
            const list = priv.hqUp?.trophies ?? [];
            return {
              key,
              text: 'Salle des trophées',
              sub: `${list.length} trophée${list.length > 1 ? 's' : ''} — prestige : +${priv.hqUp?.prestige ?? 0} $/min`,
              run: () => gc.hud.notify(list.length ? `Vos trophées : ${list.map((t) => t.name).join(', ')}.` : 'Pas encore de trophée : prenez des bâtiments clés et des quartiers !', 'good', 8000),
            };
          }
          break;
        case 'surveil':
          if (close(front.x, p.a.y, front.z, 1.8)) {
            const n = priv.hqUp?.watch?.length ?? 0;
            return { key, text: 'Écrans de surveillance', sub: n ? `${n} intrus repéré${n > 1 ? 's' : ''} près de vos sites` : 'Rien à signaler', run: () => gc.strategic.show('orders') };
          }
          break;
        case 'opscenter':
          if (close(front.x, p.a.y, front.z, 1.9)) {
            const n = priv.hqUp?.ops?.length ?? 0;
            return { key, text: 'Centre d’opérations', sub: `${n} opération${n > 1 ? 's' : ''} en cours`, run: () => gc.strategic.show('lieutenants') };
          }
          break;
        case 'dronecmd':
          if (close(front.x, p.a.y, front.z, 1.6))
            return { key, text: 'Commande des drones', sub: priv.hqUp?.patrol ? 'Drone de patrouille en vol au-dessus du QG' : 'Drone de patrouille en préparation', run: () => gc.phone.show('drones') };
          break;
        case 'comms':
          if (close(front.x, p.a.y, front.z, 1.6)) return { key, text: 'Communications avancées', sub: 'Rapports des lieutenants et ordres à distance', run: () => gc.strategic.show('lieutenants') };
          break;
        case 'armory2':
          if (close(front.x, p.a.y, front.z, 1.6)) return { key, text: 'Armurerie avancée', sub: 'Armes −25 %, munitions à moitié prix', run: () => gc.strategic.show('armory') };
          break;
      }
      void hq;
    }
    return null;
  }

  reset(): void {
    for (const p of this.placed.values()) this.remove(p);
    this.placed.clear();
    this.known = { dadou: null, even: null };
    this.hqOf = { dadou: -1, even: -1 };
    this.trophies = { dadou: -1, even: -1 };
    for (const s of this.signs) s.state = '';
    this.dirty = true;
  }

  dispose(): void {
    this.reset();
    for (const p of this.clinics) this.remove(p);
    for (const b of this.batches.values()) b.mesh.dispose();
    this.gc.scene.remove(this.group);
  }
}

export function createHqVisuals(gc: GameClient): ClientModule {
  return new HqVisuals(gc);
}

// ====================================================================== cartes

/** Carte stratégique (repère de la carte : mètres × MAP_SCALE, S = échelle) : cliniques, renseignements du QG. */
export function drawHqOverlay(c: CanvasRenderingContext2D, gc: GameClient, S: number, now: number): void {
  const Mk = MAP_SCALE;
  const pub = gc.pub;
  const priv = gc.priv;
  const rival = gc.you === 'dadou' ? 'even' : 'dadou';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  // cliniques : croix cyan (ouvertes) ou rouges (tenues par le rival)
  for (const b of gc.world.buildings) {
    if (!b.clinic) continue;
    const s = clinicSeat(b.clinic);
    const closed = pub.buildings[b.id]?.owner === FACTION[rival];
    const x = s.x * Mk;
    const z = s.z * Mk;
    const r = 10 / S;
    c.fillStyle = closed ? 'rgba(255,70,90,0.9)' : 'rgba(60,230,255,0.95)';
    c.strokeStyle = '#03101a';
    c.lineWidth = 2 / S;
    c.beginPath();
    c.arc(x, z, r, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = '#03101a';
    c.fillRect(x - r * 0.6, z - r * 0.2, r * 1.2, r * 0.4);
    c.fillRect(x - r * 0.2, z - r * 0.6, r * 0.4, r * 1.2);
  }
  const hq = priv.hqUp;
  if (!hq) return;
  // carte holographique : garnisons exactes
  for (const [bid, n] of hq.garrisons ?? []) {
    const b = gc.world.buildings[bid];
    if (!b) continue;
    const f = b.footprint;
    const x = f[2] * Mk;
    const z = f[1] * Mk;
    c.fillStyle = 'rgba(10,14,24,0.85)';
    c.strokeStyle = pub.buildings[bid]?.owner === FACTION[rival] ? '#ff6a7a' : '#c8d0e0';
    c.lineWidth = 2 / S;
    c.beginPath();
    c.roundRect(x - 13 / S, z - 9 / S, 26 / S, 18 / S, 5 / S);
    c.fill();
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = `700 ${12 / S}px ${MAP_FONT_TITLE}`;
    c.fillText(String(n), x, z + 0.5 / S);
  }
  // opérations du rival près de votre territoire
  for (const o of hq.rivalOps ?? []) {
    const x = o.x * Mk;
    const z = o.z * Mk;
    c.strokeStyle = 'rgba(255,90,255,0.9)';
    c.lineWidth = 3 / S;
    c.setLineDash([6 / S, 4 / S]);
    c.beginPath();
    c.arc(x, z, (14 + Math.sin(now * 4) * 2) / S, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = '#ff9aff';
    c.font = `600 ${11 / S}px ${MAP_FONT}`;
    c.fillText(`${o.name} — ${o.order}${o.p !== undefined ? ` ${Math.round(o.p * 100)} %` : ''}`, x, z - 22 / S);
  }
  // centre d'opérations : progression des prises de vos lieutenants
  for (const o of hq.ops ?? []) {
    const b = gc.world.buildings[o.b];
    if (!b) continue;
    const x = b.center.x * Mk;
    const z = b.center.z * Mk;
    const r = 18 / S;
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = 6 / S;
    c.beginPath();
    c.arc(x, z, r, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = gc.you === 'dadou' ? '#ff5a6a' : '#7fb0ff';
    c.lineWidth = 5 / S;
    c.beginPath();
    c.arc(x, z, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * o.p);
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = `700 ${11 / S}px ${MAP_FONT_TITLE}`;
    c.fillText(`${Math.round(o.p * 100)} %${o.eta >= 0 ? ` · ${o.eta} s` : ''}`, x, z + r + 10 / S);
  }
  // surveillance : intrus repérés (positions exactes)
  for (const w of hq.watch ?? []) {
    const a = 0.5 + 0.5 * Math.sin(now * 6 + w.x);
    c.fillStyle = `rgba(255,${Math.round(60 + 80 * a)},60,0.95)`;
    c.beginPath();
    c.arc(w.x * Mk, w.z * Mk, 5 / S + 1.2 * Mk * 0.4, 0, Math.PI * 2);
    c.fill();
  }
}

/** Mini-carte (repère de la carte de base) : cliniques. */
export function drawHqMinimap(c: CanvasRenderingContext2D, s: number, buildings: BuildingInfo[], pub: PublicState | null, me: Slot): void {
  const rival = me === 'dadou' ? 'even' : 'dadou';
  for (const b of buildings) {
    if (!b.clinic) continue;
    const p = clinicSeat(b.clinic);
    const closed = pub?.buildings[b.id]?.owner === FACTION[rival];
    const x = p.x * MAP_SCALE;
    const z = p.z * MAP_SCALE;
    const r = 2.4 * MAP_SCALE;
    c.fillStyle = closed ? '#ff4a5a' : '#3ce8ff';
    c.strokeStyle = '#000';
    c.lineWidth = 2 / s;
    c.beginPath();
    c.arc(x, z, r, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = '#03101a';
    c.fillRect(x - r * 0.6, z - r * 0.18, r * 1.2, r * 0.36);
    c.fillRect(x - r * 0.18, z - r * 0.6, r * 0.36, r * 1.2);
  }
}
