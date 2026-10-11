// Primitives de rendu des effets cybernétiques (voir game/cyberFx.ts) : rubans lumineux tournés
// vers la caméra (arcs électriques, câbles, filaments), particules lumineuses étirées selon leur
// vitesse (étincelles, flammes, braises), anneaux d'onde, coques sphériques (impulsions, auras),
// silhouettes fantômes en blocs (images rémanentes), marques au sol et petits modèles (roquettes,
// crochet). Chaque famille est UN appel de dessin (tampon dynamique ou géométrie instanciée), ses
// matériaux sont créés une fois pour toutes : aucun shader n'est compilé pendant la partie.
//
// Les couleurs sont données en valeurs d'affichage (0xRRGGBB → 0..1, sans conversion linéaire) et
// peuvent dépasser 1 (cœurs chauffés à blanc, halo du bloom). Mélange additif, sans écriture de
// profondeur ; le brouillard de la ville atténue les effets lointains.

import * as THREE from 'three';
import { envUniforms } from './env';
import { NOISE_GLSL } from './shaderChunks';

/** Horloge partagée des shaders d'effets (s). */
export const fxTime = { value: 0 };

const _rgb: [number, number, number] = [0, 0, 0];

/**
 * 0xRRGGBB → [r, g, b] (valeurs d'affichage 0..1) multipliées par k. Renvoie un tableau partagé
 * (aucune allocation par appel) : à déstructurer tout de suite.
 */
export function rgb(hex: number, k = 1): [number, number, number] {
  _rgb[0] = (((hex >> 16) & 255) / 255) * k;
  _rgb[1] = (((hex >> 8) & 255) / 255) * k;
  _rgb[2] = ((hex & 255) / 255) * k;
  return _rgb;
}

/** smoothstep sans contrainte d'ordre des bords (smoothstep(a, b, x) avec a > b est indéfini en GLSL). */
const SS_GLSL = /* glsl */ `
float ss(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}`;

function additive(vertexShader: string, fragmentShader: string, extra: Record<string, THREE.IUniform> = {}, side: THREE.Side = THREE.FrontSide): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uTime: fxTime, uFogDensity: envUniforms.uFogDensity, ...extra },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side,
  });
  m.toneMapped = false;
  return m;
}

// ======================================================================= rubans

const RIBBON_VERT = /* glsl */ `
attribute vec3 aCol;
attribute vec2 aUv;
attribute vec2 aDash;
uniform float uFogDensity;
varying vec3 vCol;
varying vec2 vUv;
varying vec2 vDash;
varying float vFog;
void main() {
  vCol = aCol;
  vUv = aUv;
  vDash = aDash;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  // brouillard au loin ; tout près de l'œil, le trait s'efface (bras en vue subjective)
  vFog = exp(-length(mv.xyz) * uFogDensity * 0.45) * smoothstep(0.04, 0.22, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const RIBBON_FRAG = /* glsl */ `
${SS_GLSL}
uniform float uTime;
varying vec3 vCol;
varying vec2 vUv;
varying vec2 vDash;
varying float vFog;
void main() {
  float d = abs(vUv.y);
  float core = exp(-d * d * 30.0);
  float halo = (1.0 - d) * (1.0 - d);
  float k = 1.0;
  if (vDash.x > 0.0) {
    // paquets de données qui filent le long du câble
    float ph = fract(vUv.x * vDash.x - uTime * vDash.y);
    k = 0.3 + 2.4 * smoothstep(0.74, 0.9, ph) * ss(1.0, 0.93, ph);
  }
  float m = max(vCol.r, max(vCol.g, vCol.b));
  vec3 c = vCol * halo * 0.42 + (vCol * 0.65 + vec3(0.5 * m)) * core;
  gl_FragColor = vec4(c * k * vFog, 1.0);
}`;

/**
 * Rubans lumineux : polylignes reconstruites à chaque image, élargies face à la caméra, avec un
 * cœur blanc et un halo. Largeur et couleur par point. Un seul tampon, un seul appel de dessin.
 */
export class RibbonBatch {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private col: Float32Array;
  private uv: Float32Array;
  private dash: Float32Array;
  private idx: Uint32Array;
  private attrs: THREE.BufferAttribute[];
  private nv = 0;
  private ni = 0;
  private readonly maxV: number;
  private cam = new THREE.Vector3();
  /** Largeur minimale (m) par mètre de distance : un trait lointain garde ~2 pixels. */
  minWidthPerMeter = 0.0028;

  constructor(maxPoints = 6000) {
    this.maxV = maxPoints * 2;
    this.pos = new Float32Array(this.maxV * 3);
    this.col = new Float32Array(this.maxV * 3);
    this.uv = new Float32Array(this.maxV * 2);
    this.dash = new Float32Array(this.maxV * 2);
    this.idx = new Uint32Array(maxPoints * 6);
    const dyn = (a: Float32Array, n: number) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3));
    this.geo.setAttribute('aCol', dyn(this.col, 3));
    this.geo.setAttribute('aUv', dyn(this.uv, 2));
    this.geo.setAttribute('aDash', dyn(this.dash, 2));
    this.geo.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(THREE.DynamicDrawUsage));
    this.attrs = ['position', 'aCol', 'aUv', 'aDash'].map((n) => this.geo.getAttribute(n) as THREE.BufferAttribute);
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, additive(RIBBON_VERT, RIBBON_FRAG, {}, THREE.DoubleSide));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.name = 'rubans';
  }

  begin(camPos: THREE.Vector3): void {
    this.nv = 0;
    this.ni = 0;
    this.cam.copy(camPos);
  }

  /**
   * Ajoute une polyligne : `pts` (x, y, z à plat) de n points ; largeur totale `w` (m) multipliée
   * par `wk[i]` si donné ; couleur (r, g, b) multipliée par `ck[i]` si donné ; `dash` = fréquence
   * des paquets (1/m) et vitesse (m/s), ou 0.
   */
  strip(pts: ArrayLike<number>, n: number, w: number, r: number, g: number, b: number, wk?: ArrayLike<number> | null, ck?: ArrayLike<number> | null, dashFreq = 0, dashSpeed = 0): void {
    if (n < 2 || this.nv + n * 2 > this.maxV) return;
    const P = this.pos;
    const cx = this.cam.x;
    const cy = this.cam.y;
    const cz = this.cam.z;
    let len = 0;
    let sx = 1;
    let sy = 0;
    let sz = 0;
    const base = this.nv;
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1) * 3;
      const i1 = Math.min(n - 1, i + 1) * 3;
      const x = pts[i * 3];
      const y = pts[i * 3 + 1];
      const z = pts[i * 3 + 2];
      if (i > 0) len += Math.hypot(x - pts[i * 3 - 3], y - pts[i * 3 - 2], z - pts[i * 3 - 1]);
      const tx = pts[i1] - pts[i0];
      const ty = pts[i1 + 1] - pts[i0 + 1];
      const tz = pts[i1 + 2] - pts[i0 + 2];
      const vx = x - cx;
      const vy = y - cy;
      const vz = z - cz;
      // côté = tangente × vue
      let ax = ty * vz - tz * vy;
      let ay = tz * vx - tx * vz;
      let az = tx * vy - ty * vx;
      const al = Math.hypot(ax, ay, az);
      if (al > 1e-7) {
        ax /= al;
        ay /= al;
        az /= al;
        sx = ax;
        sy = ay;
        sz = az;
      }
      const dist = Math.hypot(vx, vy, vz);
      const want = w * (wk ? wk[i] : 1);
      // ≥ ~2 pixels au loin ; tout près de la caméra, pas plus large qu'un doigt à l'écran
      const ww = Math.min(Math.max(want, dist * this.minWidthPerMeter), Math.max(0.004, dist * 0.06));
      // un trait élargi au loin garde la même énergie
      const kc = (ck ? ck[i] : 1) * (want > 0 ? Math.max(0.2, want / ww) : 0);
      const hw = ww * 0.5;
      const v = this.nv;
      P[v * 3] = x + sx * hw;
      P[v * 3 + 1] = y + sy * hw;
      P[v * 3 + 2] = z + sz * hw;
      P[v * 3 + 3] = x - sx * hw;
      P[v * 3 + 4] = y - sy * hw;
      P[v * 3 + 5] = z - sz * hw;
      const C = this.col;
      C[v * 3] = C[v * 3 + 3] = r * kc;
      C[v * 3 + 1] = C[v * 3 + 4] = g * kc;
      C[v * 3 + 2] = C[v * 3 + 5] = b * kc;
      const U = this.uv;
      U[v * 2] = U[v * 2 + 2] = len;
      U[v * 2 + 1] = 1;
      U[v * 2 + 3] = -1;
      const D = this.dash;
      D[v * 2] = D[v * 2 + 2] = dashFreq;
      D[v * 2 + 1] = D[v * 2 + 3] = dashSpeed;
      this.nv += 2;
    }
    const I = this.idx;
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      I[this.ni++] = a;
      I[this.ni++] = a + 1;
      I[this.ni++] = a + 2;
      I[this.ni++] = a + 1;
      I[this.ni++] = a + 3;
      I[this.ni++] = a + 2;
    }
  }

  end(): void {
    const g = this.geo;
    if (this.nv > 0) {
      for (const a of this.attrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, this.nv * a.itemSize);
        a.needsUpdate = true;
      }
      const ia = g.getIndex()!;
      ia.clearUpdateRanges();
      ia.addUpdateRange(0, this.ni);
      ia.needsUpdate = true;
    }
    g.setDrawRange(0, this.ni);
    this.mesh.visible = this.ni > 0;
  }
}

// ======================================================================= particules

const PART_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iCol;
attribute float iSize;
uniform float uFogDensity;
uniform float uMinSize;
varying vec2 vUv;
varying vec3 vCol;
varying float vShape;
varying float vFog;
void main() {
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  // taille minimale à l'écran (~1 pixel de rayon) : une étincelle lointaine reste visible
  float size = max(iSize, -mv.z * uMinSize);
  float keep = iSize / size;
  // étirement selon la vitesse (traînée de mouvement), projeté dans le plan de l'écran
  vec2 d = (mat3(viewMatrix) * iVel).xy;
  float len = length(d);
  vec2 ax = len > 1e-5 ? d / len : vec2(1.0, 0.0);
  vec2 pp = vec2(-ax.y, ax.x);
  float hl = size + len * 0.5;
  mv.xy += ax * (position.x * hl - len * 0.5) + pp * (position.y * size);
  vUv = position.xy;
  vCol = iCol.rgb * keep;
  vShape = iCol.a;
  vFog = exp(-length(mv.xyz) * uFogDensity * 0.45) * smoothstep(0.1, 0.45, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const PART_FRAG = /* glsl */ `
${SS_GLSL}
varying vec2 vUv;
varying vec3 vCol;
varying float vShape;
varying float vFog;
void main() {
  vec2 q = vUv;
  float k;
  if (vShape < 0.5) {
    // lueur ronde : halo doux et cœur
    float r2 = dot(q, q);
    k = exp(-r2 * 4.5) * 0.75 + exp(-r2 * 24.0) * 0.9;
  } else if (vShape < 1.5) {
    // bloc (voxel) lumineux
    float m = max(abs(q.x), abs(q.y));
    k = ss(1.0, 0.6, m) * 0.85 + ss(0.55, 0.15, m) * 0.6;
  } else if (vShape < 2.5) {
    // anneau
    float r = length(q);
    k = exp(-pow((r - 0.7) / 0.13, 2.0)) + exp(-r * r * 30.0) * 0.4;
  } else if (vShape < 3.5) {
    // losange (marque de cible)
    float m = abs(q.x) + abs(q.y);
    k = exp(-pow((m - 0.68) / 0.1, 2.0)) * 1.1 + exp(-m * m * 14.0) * 0.6;
  } else {
    // croix (soin)
    float a = min(abs(q.x), abs(q.y));
    float b = max(abs(q.x), abs(q.y));
    k = ss(0.34, 0.16, a) * ss(0.98, 0.7, b) + exp(-dot(q, q) * 3.0) * 0.25;
  }
  float m3 = max(vCol.r, max(vCol.g, vCol.b));
  // cœur chauffé à blanc (sauf croix et losanges : leur couleur doit rester lisible)
  vec3 c = vCol * k + vec3(m3 * (vShape > 2.5 ? 0.08 : 0.3)) * k * k * k;
  gl_FragColor = vec4(c * vFog, 1.0);
}`;

/** Formes de particules. */
export const SHAPE = { GLOW: 0, BLOCK: 1, RING: 2, DIAMOND: 3, CROSS: 4 } as const;
/** Évolution au cours de la vie : extinction simple, feu (blanc → jaune → orange → rouge sombre), éclat bref, fondu entrant/sortant. */
export const RAMP = { FADE: 0, FIRE: 1, POP: 2, INOUT: 3 } as const;

/** Paramètres d'un type de particule (objets constants réutilisés). */
export interface PartSpec {
  life: number;
  /** Variation aléatoire de la vie (fraction). */
  lifeJ?: number;
  size: number;
  /** Taille en fin de vie (même que `size` par défaut). */
  size1?: number;
  /** Intensité (multiplie la couleur). */
  i?: number;
  grav?: number;
  /** Freinage (1/s). */
  drag?: number;
  shape?: number;
  /** Traînée : secondes de mouvement dessinées (étincelles ≈ 0,03). */
  stretch?: number;
  ramp?: number;
  /** Scintillement 0..1. */
  flicker?: number;
  /** Rebondit sur le sol (y du point d'émission − 0,02 par défaut si `floor` vrai). */
  floor?: boolean;
}

const S = 21; // pas des données de simulation

/**
 * Particules lumineuses (additives) simulées sur le processeur : position, vitesse, gravité,
 * freinage, rebond au sol, couleur selon la vie, scintillement. Une instance par particule.
 */
export class GlowParticles {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  private geo: THREE.InstancedBufferGeometry;
  private d: Float32Array;
  private n = 0;
  private iPos: THREE.InstancedBufferAttribute;
  private iVel: THREE.InstancedBufferAttribute;
  private iCol: THREE.InstancedBufferAttribute;
  private iSize: THREE.InstancedBufferAttribute;
  private attrs: THREE.InstancedBufferAttribute[];
  /** Nombre maximal accepté (qualité) ; au-delà, les plus anciennes sont remplacées. */
  limit: number;

  constructor(capacity = 3000) {
    this.capacity = capacity;
    this.limit = capacity;
    this.d = new Float32Array(capacity * S);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const inst = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.iPos = inst(3);
    this.iVel = inst(3);
    this.iCol = inst(4);
    this.iSize = inst(1);
    g.setAttribute('iPos', this.iPos);
    g.setAttribute('iVel', this.iVel);
    g.setAttribute('iCol', this.iCol);
    g.setAttribute('iSize', this.iSize);
    this.attrs = [this.iPos, this.iVel, this.iCol, this.iSize];
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, additive(PART_VERT, PART_FRAG, { uMinSize: { value: 0.0016 } }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
    this.mesh.name = 'particules';
  }

  get count(): number {
    return this.n;
  }

  /** Émet une particule ; `col` = 0xRRGGBB ; `k` multiplie taille et intensité. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, sp: PartSpec, col: number, k = 1): void {
    let i: number;
    if (this.n < this.limit) i = this.n++;
    else i = Math.floor(Math.random() * this.n); // plein : on remplace au hasard
    const o = i * S;
    const d = this.d;
    const life = sp.life * (1 + (sp.lifeJ ?? 0.25) * (Math.random() * 2 - 1));
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = vx;
    d[o + 4] = vy;
    d[o + 5] = vz;
    d[o + 6] = life;
    d[o + 7] = life;
    d[o + 8] = sp.size * k;
    d[o + 9] = (sp.size1 ?? sp.size) * k;
    const ii = (sp.i ?? 1) * Math.min(1.5, k);
    d[o + 10] = (((col >> 16) & 255) / 255) * ii;
    d[o + 11] = (((col >> 8) & 255) / 255) * ii;
    d[o + 12] = ((col & 255) / 255) * ii;
    d[o + 13] = sp.grav ?? 0;
    d[o + 14] = sp.drag ?? 0;
    d[o + 15] = sp.shape ?? 0;
    d[o + 16] = sp.stretch ?? 0;
    d[o + 17] = sp.ramp ?? 0;
    d[o + 18] = sp.flicker ?? 0;
    d[o + 19] = sp.floor ? y - 0.02 : -1e9;
    d[o + 20] = Math.random() * 100;
  }

  clear(): void {
    this.n = 0;
  }

  update(dt: number): void {
    const d = this.d;
    let n = this.n;
    for (let i = 0; i < n; i++) {
      const o = i * S;
      d[o + 6] -= dt;
      if (d[o + 6] <= 0) {
        // retrait par échange avec la dernière
        n--;
        if (i !== n) d.copyWithin(o, n * S, n * S + S);
        i--;
        continue;
      }
      const drag = d[o + 14];
      if (drag > 0) {
        const f = Math.max(0, 1 - drag * dt);
        d[o + 3] *= f;
        d[o + 4] *= f;
        d[o + 5] *= f;
      }
      d[o + 4] -= d[o + 13] * dt;
      d[o] += d[o + 3] * dt;
      d[o + 1] += d[o + 4] * dt;
      d[o + 2] += d[o + 5] * dt;
      if (d[o + 1] < d[o + 19] && d[o + 4] < 0) {
        d[o + 1] = d[o + 19];
        d[o + 4] *= -0.35;
        d[o + 3] *= 0.6;
        d[o + 5] *= 0.6;
      }
    }
    this.n = n;
  }

  /** Remplit les tampons d'instances (à appeler après update). */
  write(time: number): void {
    const d = this.d;
    const P = this.iPos.array as Float32Array;
    const V = this.iVel.array as Float32Array;
    const C = this.iCol.array as Float32Array;
    const Z = this.iSize.array as Float32Array;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const o = i * S;
      const t = 1 - d[o + 6] / d[o + 7]; // 0 → 1
      P[i * 3] = d[o];
      P[i * 3 + 1] = d[o + 1];
      P[i * 3 + 2] = d[o + 2];
      const st = d[o + 16];
      V[i * 3] = d[o + 3] * st;
      V[i * 3 + 1] = d[o + 4] * st;
      V[i * 3 + 2] = d[o + 5] * st;
      Z[i] = d[o + 8] + (d[o + 9] - d[o + 8]) * t;
      let r = d[o + 10];
      let g = d[o + 11];
      let b = d[o + 12];
      let a: number;
      const ramp = d[o + 17];
      if (ramp === 1) {
        // feu : chauffé à blanc, puis jaune, orange, rouge sombre
        const w = Math.max(0, 1 - t * 3.2);
        const m = Math.max(r, g, b);
        r = r + (m * 1.2 - r) * w;
        g = g * (1 - t * 0.85) + (m - g) * w;
        b = b * (1 - t) + (m * 0.8 - b) * w;
        a = Math.min(1, t * 12) * (1 - t) * (1 - t * 0.4);
      } else if (ramp === 2) {
        a = (1 - t) * (1 - t) * (1 - t);
      } else if (ramp === 3) {
        a = Math.sin(Math.PI * t);
      } else {
        a = Math.min(1, t * 14) * Math.pow(1 - t, 1.3);
      }
      const fl = d[o + 18];
      if (fl > 0) a *= 1 - fl + fl * (0.5 + 0.5 * Math.sin(time * 37 + d[o + 20]) * Math.sin(time * 23 + d[o + 20] * 1.7));
      C[i * 4] = r * a;
      C[i * 4 + 1] = g * a;
      C[i * 4 + 2] = b * a;
      C[i * 4 + 3] = d[o + 15];
    }
    for (const at of this.attrs) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, n * at.itemSize);
      at.needsUpdate = true;
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
  }
}

// ======================================================================= anneaux

const RING_VERT = /* glsl */ `
attribute vec4 iRing;
attribute vec3 iColor;
uniform float uFogDensity;
varying vec2 vUv;
varying vec4 vRing;
varying vec3 vColor;
varying float vFog;
void main() {
  vUv = position.xy;
  vRing = iRing;
  vColor = iColor;
  vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  vFog = exp(-length(mv.xyz) * uFogDensity * 0.45) * smoothstep(0.45, 1.8, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const RING_FRAG = /* glsl */ `
${SS_GLSL}
uniform float uTime;
varying vec2 vUv;
varying vec4 vRing; // rayon (fraction), largeur (fraction), intensité, style + graine
varying vec3 vColor;
varying float vFog;
${NOISE_GLSL}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float style = floor(vRing.w);
  float seed = fract(vRing.w) * 100.0;
  float a = atan(vUv.y, vUv.x);
  float x = (r - vRing.x) / max(vRing.y, 1e-3);
  float band = exp(-x * x);
  float k;
  if (style < 0.5) {
    // anneau d'énergie net, bord intérieur plus doux
    k = band + exp(-max(-x, 0.0) * 0.6) * step(r, vRing.x) * 0.08;
  } else if (style < 1.5) {
    // onde de choc : front net légèrement irrégulier, traîne intérieure striée (poussière, air)
    float n = vnoise(vec2(a * 6.0 + seed, uTime * 3.0));
    float streak = vnoise(vec2(a * 22.0 + seed * 3.0, r * 3.0 - uTime));
    float trail = r < vRing.x ? exp(-(vRing.x - r) / max(vRing.y * 2.5, 1e-3)) : 0.0;
    k = band * (0.65 + 0.5 * n) + trail * (0.15 + 0.45 * streak);
  } else if (style < 2.5) {
    // anneau technique : segments qui tournent, graduations
    float seg = step(0.32, fract(a * 3.0 / 6.2831 + uTime * 0.35 + seed));
    float tick = step(0.82, fract(a * 24.0 / 6.2831));
    k = band * (0.35 + 0.65 * seg) + exp(-pow((r - vRing.x * 0.86) / max(vRing.y * 0.5, 1e-3), 2.0)) * tick * 0.6;
  } else {
    // disque d'éclat (impact sur une surface)
    k = exp(-r * r * 5.0 / max(vRing.x * vRing.x, 0.02)) + band * 0.6;
  }
  k *= ss(1.0, 0.92, r);
  gl_FragColor = vec4(vColor * k * vRing.z * vFog, 1.0);
}`;

/** Styles d'anneaux. */
export const RING = { ENERGY: 0, SHOCK: 1, TECH: 2, FLASH: 3 } as const;

interface RingState {
  x: number;
  y: number;
  z: number;
  /** Normale (axe de l'anneau). */
  nx: number;
  ny: number;
  nz: number;
  r0: number;
  r1: number;
  w: number;
  life: number;
  max: number;
  r: number;
  g: number;
  b: number;
  i: number;
  style: number;
  seed: number;
  /** Exposant de l'expansion (1 linéaire, < 1 rapide puis lent). */
  ease: number;
}

/** Anneaux d'onde (sol, air, surfaces) : un quad instancié par anneau. */
export class RingBatch {
  readonly mesh: THREE.InstancedMesh;
  private list: RingState[] = [];
  private iRing: THREE.InstancedBufferAttribute;
  private iColor: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 0, 1);
  private nrm = new THREE.Vector3();
  readonly capacity: number;

  constructor(capacity = 64) {
    this.capacity = capacity;
    const g = new THREE.PlaneGeometry(2, 2);
    this.iRing = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    g.setAttribute('iRing', this.iRing);
    g.setAttribute('iColor', this.iColor);
    this.mesh = new THREE.InstancedMesh(g, additive(RING_VERT, RING_FRAG, {}, THREE.DoubleSide), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.name = 'anneaux';
  }

  /** Nouvel anneau : centre, normale, rayons de départ et d'arrivée (m), épaisseur (m), vie (s). */
  add(x: number, y: number, z: number, nx: number, ny: number, nz: number, r0: number, r1: number, w: number, life: number, col: number, i = 1, style = 0, ease = 0.6): void {
    if (this.list.length >= this.capacity) this.list.shift();
    const [r, g, b] = rgb(col);
    this.list.push({ x, y, z, nx, ny, nz, r0, r1, w, life, max: life, r, g, b, i, style, seed: Math.random() * 0.99, ease });
  }

  clear(): void {
    this.list.length = 0;
  }

  update(dt: number): void {
    let c = 0;
    const R = this.iRing.array as Float32Array;
    const C = this.iColor.array as Float32Array;
    for (let k = this.list.length - 1; k >= 0; k--) {
      this.list[k].life -= dt;
      if (this.list[k].life <= 0) this.list.splice(k, 1);
    }
    for (const s of this.list) {
      const t = 1 - s.life / s.max;
      const e = 1 - Math.pow(1 - t, 1 / Math.max(0.05, s.ease));
      const rad = s.r0 + (s.r1 - s.r0) * e;
      const S = Math.max(rad + s.w * 1.5, 0.01);
      this.nrm.set(s.nx, s.ny, s.nz).normalize();
      this.q.setFromUnitVectors(this.up, this.nrm);
      this.m.compose(this.v.set(s.x, s.y, s.z), this.q, this.s.set(S, S, S));
      this.mesh.setMatrixAt(c, this.m);
      const fade = Math.min(1, t * 10) * (1 - t) * (1 - t * 0.3);
      R[c * 4] = rad / S;
      R[c * 4 + 1] = s.w / S;
      R[c * 4 + 2] = s.i * fade;
      R[c * 4 + 3] = s.style + s.seed;
      C[c * 3] = s.r;
      C[c * 3 + 1] = s.g;
      C[c * 3 + 2] = s.b;
      c++;
    }
    this.mesh.count = c;
    this.mesh.visible = c > 0;
    if (c > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.iRing.needsUpdate = true;
      this.iColor.needsUpdate = true;
    }
  }
}

// ======================================================================= coques

const SHELL_VERT = /* glsl */ `
attribute vec3 iColor;
attribute vec4 iPar;
uniform float uFogDensity;
varying vec3 vN;
varying vec3 vV;
varying vec3 vColor;
varying vec4 vPar;
varying vec3 vLocal;
varying float vFog;
void main() {
  mat4 mm = modelMatrix * instanceMatrix;
  vec4 wp = mm * vec4(position, 1.0);
  vN = normalize(mat3(mm) * normal);
  vV = cameraPosition - wp.xyz;
  vColor = iColor;
  vPar = iPar;
  vLocal = position;
  vec4 mv = viewMatrix * wp;
  vFog = exp(-length(mv.xyz) * uFogDensity * 0.45) * smoothstep(0.3, 1.3, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const SHELL_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying vec3 vColor;
varying vec4 vPar; // intensité, puissance de Fresnel, style, graine
varying vec3 vLocal;
varying float vFog;
${NOISE_GLSL}
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(f, vPar.y);
  float style = vPar.z;
  float k = rim;
  if (style > 0.5 && style < 1.5) {
    // balayage du scanner : bandes horizontales qui montent, quadrillage discret
    float band = smoothstep(0.86, 1.0, fract(vLocal.y * 4.0 - uTime * 2.2));
    float grid = step(0.94, fract(atan(vLocal.z, vLocal.x) * 12.0 / 6.2831)) * 0.25;
    k = rim * 0.9 + (band * 0.55 + grid) * (0.3 + rim);
  } else if (style > 1.5 && style < 2.5) {
    // aura électrique : crépitement
    float n = vnoise(vLocal.xy * 7.0 + vec2(uTime * 6.0, vPar.w * 9.0)) * vnoise(vLocal.zy * 9.0 - vec2(vPar.w * 4.0, uTime * 8.0));
    k = rim * (0.35 + 2.6 * smoothstep(0.18, 0.5, n));
  } else if (style > 2.5) {
    // miroitement (camouflage optique) : franges qui ondulent
    float w = sin(vLocal.y * 22.0 + uTime * 9.0 + vnoise(vLocal.xz * 5.0 + uTime) * 5.0);
    k = rim * (0.5 + 0.5 * w) + smoothstep(0.9, 1.0, w) * 0.25;
  }
  gl_FragColor = vec4(vColor * k * vPar.x * vFog, 1.0);
}`;

/** Styles de coques. */
export const SHELL = { RIM: 0, SCAN: 1, CRACKLE: 2, SHIMMER: 3 } as const;

/**
 * Coques sphériques / ellipsoïdales additives (impulsions de scan, auras, éclats) : une sphère
 * instanciée par coque, Fresnel sur le pourtour. Les états sont posés à chaque image par
 * l'appelant (begin / put / end).
 */
export class ShellBatch {
  readonly mesh: THREE.InstancedMesh;
  private iColor: THREE.InstancedBufferAttribute;
  private iPar: THREE.InstancedBufferAttribute;
  private c = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  readonly capacity: number;

  constructor(capacity = 32) {
    this.capacity = capacity;
    const g = new THREE.IcosahedronGeometry(1, 3);
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.iPar = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    g.setAttribute('iColor', this.iColor);
    g.setAttribute('iPar', this.iPar);
    this.mesh = new THREE.InstancedMesh(g, additive(SHELL_VERT, SHELL_FRAG, {}, THREE.DoubleSide), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'coques';
  }

  begin(): void {
    this.c = 0;
  }

  /** Une coque : centre, demi-axes (m), rotation autour de y, couleur, intensité, Fresnel, style. */
  put(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, col: number, i: number, pow = 2.5, style = 0, seed = 0): void {
    if (this.c >= this.capacity || i <= 0.002) return;
    const c = this.c++;
    this.q.setFromAxisAngle(this.v.set(0, 1, 0), yaw);
    this.m.compose(this.v.set(x, y, z), this.q, this.s.set(sx, sy, sz));
    this.mesh.setMatrixAt(c, this.m);
    const C = this.iColor.array as Float32Array;
    const [r, g, b] = rgb(col);
    C[c * 3] = r;
    C[c * 3 + 1] = g;
    C[c * 3 + 2] = b;
    const P = this.iPar.array as Float32Array;
    P[c * 4] = i;
    P[c * 4 + 1] = pow;
    P[c * 4 + 2] = style;
    P[c * 4 + 3] = seed;
  }

  end(): void {
    this.mesh.count = this.c;
    this.mesh.visible = this.c > 0;
    if (this.c > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.iColor.needsUpdate = true;
      this.iPar.needsUpdate = true;
    }
  }
}

// ======================================================================= blocs fantômes

const GHOST_VERT = /* glsl */ `
attribute vec4 iCol;
uniform float uFogDensity;
varying vec3 vLocal;
varying vec4 vCol;
varying float vFog;
void main() {
  vLocal = position;
  vCol = iCol;
  vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  vFog = exp(-length(mv.xyz) * uFogDensity * 0.45) * smoothstep(0.3, 1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const GHOST_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vLocal;
varying vec4 vCol;
varying float vFog;
void main() {
  // arêtes du bloc lumineuses, faces voilées, lignes de balayage
  vec3 a = abs(vLocal) * 2.0;
  float mx = max(a.x, max(a.y, a.z));
  float mn = min(a.x, min(a.y, a.z));
  float second = a.x + a.y + a.z - mx - mn;
  float edge = smoothstep(0.72, 0.98, second);
  float scan = 0.75 + 0.25 * step(0.5, fract(gl_FragCoord.y * 0.25 + uTime * 3.0));
  gl_FragColor = vec4(vCol.rgb * (edge * 0.9 + 0.22) * scan * vCol.a * vFog, 1.0);
}`;

/** Blocs lumineux translucides (silhouettes rémanentes, éclats de bouclier) : un cube instancié par bloc. */
export class BlockBatch {
  readonly mesh: THREE.InstancedMesh;
  private iCol: THREE.InstancedBufferAttribute;
  private c = 0;
  private m = new THREE.Matrix4();
  readonly capacity: number;

  constructor(capacity = 256) {
    this.capacity = capacity;
    const g = new THREE.BoxGeometry(1, 1, 1);
    this.iCol = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    g.setAttribute('iCol', this.iCol);
    this.mesh = new THREE.InstancedMesh(g, additive(GHOST_VERT, GHOST_FRAG), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'blocs';
  }

  begin(): void {
    this.c = 0;
  }

  /** Un bloc : matrice monde (échelle = dimensions), couleur, intensité. */
  put(m: THREE.Matrix4, col: number, i: number): void {
    if (this.c >= this.capacity || i <= 0.003) return;
    const c = this.c++;
    this.mesh.setMatrixAt(c, m);
    const [r, g, b] = rgb(col);
    const A = this.iCol.array as Float32Array;
    A[c * 4] = r;
    A[c * 4 + 1] = g;
    A[c * 4 + 2] = b;
    A[c * 4 + 3] = i;
  }

  /** Raccourci : bloc centré en (x, y, z), dimensions, tourné de `yaw` (et `pitch` autour de x local). */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, pitch: number, col: number, i: number): void {
    const cy = Math.cos(yaw);
    const sy2 = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    // R = Ry(yaw) · Rx(pitch), puis échelle
    this.m.set(cy * sx, sy2 * sp * sy, sy2 * cp * sz, x, 0, cp * sy, -sp * sz, y, -sy2 * sx, cy * sp * sy, cy * cp * sz, z, 0, 0, 0, 1);
    this.put(this.m, col, i);
  }

  end(): void {
    this.mesh.count = this.c;
    this.mesh.visible = this.c > 0;
    if (this.c > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.iCol.needsUpdate = true;
    }
  }
}

// ======================================================================= marques au sol

const DECAL_VERT = /* glsl */ `
attribute vec4 iDecal;
varying vec2 vUv;
varying vec4 vDecal;
void main() {
  vUv = position.xy;
  vDecal = iDecal;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const DECAL_FRAG = /* glsl */ `
${SS_GLSL}
varying vec2 vUv;
varying vec4 vDecal; // opacité, style, graine, braise
${NOISE_GLSL}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float a = atan(vUv.y, vUv.x);
  float seed = vDecal.z;
  float alpha;
  vec3 col = vec3(0.035, 0.03, 0.028);
  if (vDecal.y < 0.5) {
    // fissures rayonnantes et cratère
    float w = vnoise(vec2(r * 5.0, seed)) * 1.6 + vnoise(vec2(r * 13.0, seed + 7.0)) * 0.5;
    float lines = abs(sin(a * 4.0 + w + seed));
    float crack = ss(0.08 + r * 0.05, 0.0, lines * (0.7 + r)) * ss(1.0, 0.25, r);
    float n = vnoise(vUv * 6.0 + seed);
    float crater = ss(0.42, 0.0, r + n * 0.12);
    alpha = max(crack * 0.95, crater * 0.75);
    col += vec3(1.0, 0.45, 0.12) * vDecal.w * crack * ss(0.6, 0.0, r) * 2.0;
  } else {
    // brûlure : tache sombre irrégulière
    float n = vnoise(vUv * 3.0 + seed) * 0.6 + vnoise(vUv * 9.0 - seed) * 0.4;
    alpha = ss(1.0, 0.2, r + n * 0.45) * 0.85;
    col += vec3(1.0, 0.35, 0.08) * vDecal.w * ss(0.5, 0.0, r + n * 0.3) * 1.5;
  }
  gl_FragColor = vec4(col, alpha * vDecal.x);
}`;

interface DecalState {
  m: THREE.Matrix4;
  life: number;
  max: number;
  style: number;
  seed: number;
  ember: number;
}

/** Marques au sol ou sur les murs (fissures, brûlures), en mélange normal, qui s'effacent. */
export class DecalBatch {
  readonly mesh: THREE.InstancedMesh;
  private list: DecalState[] = [];
  private iDecal: THREE.InstancedBufferAttribute;
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private n = new THREE.Vector3();
  readonly capacity: number;

  constructor(capacity = 24) {
    this.capacity = capacity;
    const g = new THREE.PlaneGeometry(2, 2);
    this.iDecal = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    g.setAttribute('iDecal', this.iDecal);
    const mat = new THREE.ShaderMaterial({
      vertexShader: DECAL_VERT,
      fragmentShader: DECAL_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    mat.toneMapped = false;
    this.mesh = new THREE.InstancedMesh(g, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'marques';
  }

  /** Marque de rayon r (m) en p, plaquée sur la surface de normale n ; style 0 fissures, 1 brûlure. */
  add(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, life: number, style: number, ember = 0): void {
    if (this.list.length >= this.capacity) this.list.shift();
    this.n.set(nx, ny, nz).normalize();
    this.q.setFromUnitVectors(this.v.set(0, 0, 1), this.n);
    this.q2.setFromAxisAngle(this.v.set(0, 0, 1), Math.random() * Math.PI * 2);
    this.q.multiply(this.q2);
    const m = new THREE.Matrix4().compose(this.v.set(x + this.n.x * 0.02, y + this.n.y * 0.02, z + this.n.z * 0.02), this.q, this.s.set(r, r, r));
    this.list.push({ m, life, max: life, style, seed: Math.random() * 50, ember });
  }

  clear(): void {
    this.list.length = 0;
  }

  update(dt: number): void {
    for (let k = this.list.length - 1; k >= 0; k--) {
      this.list[k].life -= dt;
      if (this.list[k].life <= 0) this.list.splice(k, 1);
    }
    const D = this.iDecal.array as Float32Array;
    let c = 0;
    for (const s of this.list) {
      const t = 1 - s.life / s.max;
      this.mesh.setMatrixAt(c, s.m);
      D[c * 4] = Math.min(1, t * 30) * Math.min(1, (1 - t) * 3);
      D[c * 4 + 1] = s.style;
      D[c * 4 + 2] = s.seed;
      D[c * 4 + 3] = s.ember * Math.max(0, 1 - t * 4);
      c++;
    }
    this.mesh.count = c;
    this.mesh.visible = c > 0;
    if (c > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.iDecal.needsUpdate = true;
    }
  }
}

// ======================================================================= petits modèles

const MODEL_VERT = /* glsl */ `
attribute vec4 color;
uniform float uFogDensity;
varying vec3 vN;
varying vec4 vC;
varying float vFog;
void main() {
  mat4 mm = modelMatrix * instanceMatrix;
  vN = normalize(mat3(mm) * normal);
  vC = color;
  vec4 mv = viewMatrix * mm * vec4(position, 1.0);
  vFog = exp(-length(mv.xyz) * uFogDensity * 0.45);
  gl_Position = projectionMatrix * mv;
}`;

const MODEL_FRAG = /* glsl */ `
uniform vec3 uFogColor;
varying vec3 vN;
varying vec4 vC; // couleur, émission
varying float vFog;
void main() {
  vec3 n = normalize(vN);
  float l = 0.42 + 0.4 * max(dot(n, normalize(vec3(0.3, 1.0, 0.2))), 0.0) + 0.18 * max(-n.y, 0.0);
  vec3 c = vC.rgb * l * 0.6 + vC.rgb * vC.a * 1.6;
  gl_FragColor = vec4(mix(uFogColor, c, vFog), 1.0);
}`;

/** Petit modèle voxel (roquette, crochet) : liste de blocs [x, y, z, sx, sy, sz, couleur, émission]. */
export function blockGeometry(blocks: [number, number, number, number, number, number, number, number][]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [x, y, z, sx, sy, sz, col, em] of blocks) {
    const b = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
    b.translate(x, y, z);
    const n = b.getAttribute('position').count;
    const c = new Float32Array(n * 4);
    const [r, g, bb] = rgb(col);
    for (let i = 0; i < n; i++) {
      c[i * 4] = r;
      c[i * 4 + 1] = g;
      c[i * 4 + 2] = bb;
      c[i * 4 + 3] = em;
    }
    b.setAttribute('color', new THREE.BufferAttribute(c, 4));
    b.deleteAttribute('uv');
    parts.push(b);
  }
  // fusion simple (mêmes attributs)
  let total = 0;
  for (const p of parts) total += p.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const col = new Float32Array(total * 4);
  let o = 0;
  for (const p of parts) {
    const n = p.getAttribute('position').count;
    pos.set(p.getAttribute('position').array as Float32Array, o * 3);
    nrm.set(p.getAttribute('normal').array as Float32Array, o * 3);
    col.set(p.getAttribute('color').array as Float32Array, o * 4);
    o += n;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return g;
}

/** Instances d'un petit modèle opaque (roquettes, crochets), posées à chaque image. */
export class ModelBatch {
  readonly mesh: THREE.InstancedMesh;
  private c = 0;
  readonly capacity: number;

  constructor(geo: THREE.BufferGeometry, capacity: number, name: string) {
    this.capacity = capacity;
    const mat = new THREE.ShaderMaterial({
      vertexShader: MODEL_VERT,
      fragmentShader: MODEL_FRAG,
      uniforms: { uFogDensity: envUniforms.uFogDensity, uFogColor: envUniforms.uFogColor },
    });
    mat.toneMapped = false;
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = name;
  }

  begin(): void {
    this.c = 0;
  }

  put(m: THREE.Matrix4): void {
    if (this.c >= this.capacity) return;
    this.mesh.setMatrixAt(this.c++, m);
  }

  end(): void {
    this.mesh.count = this.c;
    this.mesh.visible = this.c > 0;
    if (this.c > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
