// Post-traitement : halo lumineux (bloom) des lampes, fenêtres et néons, et étalonnage des
// visions cybernétiques (thermique, nocturne) et des états (réflexes, surcharge, camouflage,
// cœur de secours).
//
// La scène est dessinée normalement à l'écran (mêmes couleurs, même anticrénelage) ; on copie
// ensuite l'image. Halo : on en extrait les zones les plus claires, on les floute sur une chaîne
// de demi-résolutions (filtre « dual Kawase »). Une passe finale unique recompose l'image (image
// + halo) et applique l'étalonnage en cours : sans vision ni teinte, c'est exactement l'ancien
// composite additif ; sans halo (qualité basse), seule la copie et la passe finale restent.
// Les transitions durent ~0,25 s. needsRender dit à l'appelant s'il faut passer par render().

import * as THREE from 'three';
import { envUniforms } from './env';

export type VisionMode = 'normal' | 'thermal' | 'night';
export type TintKind = 'reflex' | 'overcharge' | 'camo' | 'secondWind';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
vec3 pick(vec2 uv) {
  vec3 c = texture2D(tSrc, uv).rgb;
  float br = max(c.r, max(c.g, c.b));
  // genou doux : seules les zones presque saturées contribuent
  float w = smoothstep(uThreshold, uThreshold + 0.07, br);
  // les lumières chaudes (lampes, feu) et les néons saturés brillent davantage que le ciel gris
  float warm = clamp((c.r - c.b) * 2.0, 0.0, 1.0);
  float sat = (br - min(c.r, min(c.g, c.b))) / max(br, 1e-3);
  return c * w * (0.35 + 0.65 * max(warm, sat * 0.5));
}
void main() {
  vec2 o = uTexel;
  vec3 s = pick(vUv) * 4.0 + pick(vUv + vec2(-o.x, -o.y)) + pick(vUv + vec2(o.x, -o.y)) + pick(vUv + vec2(-o.x, o.y)) + pick(vUv + vec2(o.x, o.y));
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 o = uTexel;
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb;
  s += texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb;
  s += texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb;
  s += texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

const UP = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
void main() {
  vec2 o = uTexel;
  vec3 s = texture2D(tSrc, vUv + vec2(-2.0 * o.x, 0.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(2.0 * o.x, 0.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(0.0, -2.0 * o.y)).rgb;
  s += texture2D(tSrc, vUv + vec2(0.0, 2.0 * o.y)).rgb;
  s += texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb * 2.0;
  gl_FragColor = vec4(s / 12.0 * uWeight, 1.0);
}`;

/** Passe finale : image + halo, puis visions et teintes (branches uniformes : quasi gratuites à 0). */
const FINAL = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tBloom;
uniform float uBloom;
uniform vec2 uRes;
uniform float uTime;
uniform float uThermal;
uniform float uNight;
uniform float uGain;
uniform float uReflex;
uniform float uOver;
uniform float uCamo;
uniform float uWind;
uniform float uSwitch;
varying vec2 vUv;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float ss(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
vec3 sceneAt(vec2 uv) {
  vec3 c = texture2D(tSrc, uv).rgb;
  if (uBloom > 0.0) {
    // courbe douce pour éviter de brûler les blancs (ancien composite additif)
    vec3 b = texture2D(tBloom, uv).rgb * uBloom;
    c += b / (1.0 + b);
  }
  return min(c, vec3(1.0));
}
// palette « fer chaud » : froid (bleu nuit, violet) → chaud (magenta, orange, jaune, blanc)
vec3 ironbow(float h) {
  h = clamp(h, 0.0, 1.0) * 6.0;
  vec3 c0 = vec3(0.012, 0.014, 0.05);
  vec3 c1 = vec3(0.035, 0.06, 0.3);
  vec3 c2 = vec3(0.3, 0.06, 0.46);
  vec3 c3 = vec3(0.78, 0.1, 0.34);
  vec3 c4 = vec3(1.0, 0.42, 0.08);
  vec3 c5 = vec3(1.0, 0.84, 0.25);
  vec3 c6 = vec3(1.0, 1.0, 0.92);
  if (h < 1.0) return mix(c0, c1, h);
  if (h < 2.0) return mix(c1, c2, h - 1.0);
  if (h < 3.0) return mix(c2, c3, h - 2.0);
  if (h < 4.0) return mix(c3, c4, h - 3.0);
  if (h < 5.0) return mix(c4, c5, h - 4.0);
  return mix(c5, c6, h - 5.0);
}
void main() {
  vec2 uv = vUv;
  vec2 cc = uv - 0.5;
  float r = length(cc) * 1.414;
  // bascule de vision : lignes décalées, parasites
  if (uSwitch > 0.0) {
    float band = step(0.55, hash(vec2(floor(uv.y * 36.0), floor(uTime * 30.0))));
    uv.x += (hash(vec2(floor(uv.y * 120.0), floor(uTime * 60.0))) - 0.5) * 0.05 * uSwitch * band;
  }
  // camouflage optique : réfraction qui ondule, plus forte sur les bords
  if (uCamo > 0.0) {
    float e = ss(0.3, 0.95, r);
    uv += vec2(sin(uv.y * 40.0 + uTime * 4.0), cos(uv.x * 32.0 - uTime * 3.0)) * 0.004 * uCamo * e;
  }
  vec3 c;
  float ca = (uReflex * 0.007 + uCamo * 0.005 + uSwitch * 0.01) * r;
  if (ca > 0.0002) {
    // aberration chromatique radiale
    vec2 dir = cc / max(length(cc), 1e-4) * ca;
    c = vec3(sceneAt(uv + dir).r, sceneAt(uv).g, sceneAt(uv - dir).b);
  } else {
    c = sceneAt(uv);
  }
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // ---------------------------------------------------------------- vision thermique
  if (uThermal > 0.0) {
    // le monde reste dans le froid (bleu nuit → violet), même en plein jour ; seul ce qui est
    // très lumineux ou chaud (lampes, feu, silhouettes thermiques des personnages) monte vers
    // le magenta, l'orange et le blanc
    float warm = clamp(c.r - c.b, 0.0, 1.0);
    float cold = 0.36 * pow(lum, 0.9) * (1.0 - 0.6 * clamp((c.b - c.r) * 2.0, 0.0, 1.0));
    float hot = ss(0.7, 0.95, lum) * (0.75 + 0.25 * warm) + warm * 0.8 * ss(0.25, 0.6, lum);
    float heat = max(cold, hot);
    vec3 th = ironbow(heat);
    th = mix(th, c, ss(0.75, 0.98, heat) * 0.45);
    th *= 0.92 + 0.08 * hash(gl_FragCoord.xy + fract(uTime * 7.0) * 100.0);
    th *= 1.0 - 0.3 * ss(0.5, 1.0, r);
    th += vec3(0.02, 0.03, 0.09) * ss(0.965, 1.0, fract(uv.y * 2.5 - uTime * 0.35));
    c = mix(c, th, uThermal);
  }
  // ---------------------------------------------------------------- vision nocturne
  if (uNight > 0.0) {
    // amplification de lumière, phosphore vert, grain, lignes, vignette
    float l = dot(c, vec3(0.3, 0.59, 0.11)) * uGain;
    float v = l / (1.0 + l * 0.45) * 1.35;
    vec3 g = vec3(0.1, 1.0, 0.3) * v + vec3(0.55, 0.9, 0.6) * max(v - 0.8, 0.0) * 1.5;
    float gr = hash(gl_FragCoord.xy * 0.5 + floor(uTime * 24.0) * 17.0) - 0.5;
    g += vec3(0.05, 0.25, 0.08) * gr * (0.35 + v * 0.5);
    g *= 0.86 + 0.14 * sin(gl_FragCoord.y * 1.7 + uTime * 6.0);
    g *= 1.0 - 0.55 * ss(0.4, 1.05, r);
    c = mix(c, g, uNight);
  }
  // ---------------------------------------------------------------- teintes
  if (uReflex > 0.0) {
    // le temps ralentit : ombres bleutées, lumières dorées, contraste, vignette
    float l2 = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 split = mix(vec3(l2) * vec3(0.72, 0.9, 1.25), vec3(l2) * vec3(1.28, 1.05, 0.68), ss(0.3, 0.85, l2));
    vec3 rc = mix(c, split, 0.55);
    rc = (rc - 0.25) * 1.08 + 0.25;
    rc *= 1.0 - 0.25 * ss(0.55, 1.15, r);
    c = mix(c, max(rc, 0.0), uReflex);
  }
  if (uOver > 0.0) {
    // surcharge : chaleur rouge qui bat sur les bords
    float pulse = 0.65 + 0.35 * sin(uTime * 7.0);
    vec3 oc = c * vec3(1.12, 0.9, 0.85);
    oc += vec3(0.38, 0.04, 0.015) * ss(0.5, 1.15, r) * pulse;
    c = mix(c, oc, uOver);
  }
  if (uCamo > 0.0) {
    float l3 = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 cm = mix(c, vec3(l3) * vec3(0.7, 1.05, 1.15), 0.45);
    cm += vec3(0.0, 0.12, 0.14) * ss(0.55, 1.15, r) * (0.7 + 0.3 * sin(uTime * 3.0 + uv.y * 20.0));
    c = mix(c, cm, uCamo);
  }
  if (uWind > 0.0) {
    // cœur de secours : battements (désaturation, pulsations vertes sur les bords)
    float ph = mod(uTime, 0.85);
    float beat = exp(-ph * 9.0) + 0.7 * exp(-max(ph - 0.2, 0.0) * 9.0) * step(0.2, ph);
    float l4 = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 wc = mix(c, vec3(l4), 0.35 + 0.2 * beat);
    wc += vec3(0.1, 0.55, 0.25) * ss(0.4, 1.15, r) * beat * 0.6;
    wc *= 1.0 + 0.08 * beat;
    c = mix(c, wc, uWind);
  }
  if (uSwitch > 0.0) {
    c += (hash(gl_FragCoord.xy + uTime * 91.0) - 0.5) * 0.25 * uSwitch;
    c *= 1.0 + 0.6 * uSwitch * step(0.97, fract(uv.y * 2.0 + uTime * 9.0));
  }
  gl_FragColor = vec4(c, 1.0);
}`;

const LEVELS = 5;
/** Vitesse des transitions (1/s : ~0,25 s). */
const RATE = 4;

export class PostFX {
  /** Halo lumineux activé (réglage « bloom » et qualité). */
  enabled = false;
  /** Intensité du halo (multipliée par un facteur nuit/jour). */
  strength = 1;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private frame: THREE.FramebufferTexture | null = null;
  private rts: THREE.WebGLRenderTarget[] = [];
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private brightMat: THREE.ShaderMaterial;
  private downMat: THREE.ShaderMaterial;
  private upMat: THREE.ShaderMaterial;
  private finalMat: THREE.ShaderMaterial;
  private black: THREE.DataTexture;
  private size = new THREE.Vector2();
  private tmp = new THREE.Vector2();
  private failed = false;
  private time = 0;
  // étalonnage : cibles et valeurs courantes (animées)
  private visionMode: VisionMode = 'normal';
  private target = { thermal: 0, night: 0, reflex: 0, overcharge: 0, camo: 0, secondWind: 0 };
  private cur = { thermal: 0, night: 0, reflex: 0, overcharge: 0, camo: 0, secondWind: 0 };
  private switchT = 0;
  private nightGain = 3.5;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    const mk = (frag: string, extra: Record<string, THREE.IUniform> = {}, blend = false) =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: frag,
        uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, ...extra },
        depthTest: false,
        depthWrite: false,
        blending: blend ? THREE.CustomBlending : THREE.NoBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        toneMapped: false,
      });
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    this.black.needsUpdate = true;
    this.brightMat = mk(BRIGHT, { uThreshold: { value: 0.8 } });
    this.downMat = mk(DOWN);
    this.upMat = mk(UP, { uWeight: { value: 1 } }, true);
    this.finalMat = mk(FINAL, {
      tBloom: { value: this.black },
      uBloom: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uThermal: { value: 0 },
      uNight: { value: 0 },
      uGain: { value: 3.5 },
      uReflex: { value: 0 },
      uOver: { value: 0 },
      uCamo: { value: 0 },
      uWind: { value: 0 },
      uSwitch: { value: 0 },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.brightMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.warm();
  }

  /**
   * Compile la passe finale (étalonnage) dès maintenant : la première vision activée ne provoque
   * pas d'accroc, même halo coupé. Dessine un quad noir sur l'écran (avant la première image).
   */
  warm(): void {
    try {
      const u = this.finalMat.uniforms;
      u.tBloom.value = this.black;
      u.uBloom.value = 0;
      const prevAuto = this.renderer.autoClear;
      this.renderer.autoClear = false;
      this.pass(this.finalMat, this.black, 1, 1, null);
      this.renderer.autoClear = prevAuto;
    } catch {
      /* compilé au premier usage */
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on && !this.failed;
    if (!this.enabled) this.releaseBloom();
  }

  setSize(w: number, h: number): void {
    void w;
    void h;
    // les cibles sont recréées au prochain rendu, à la taille réelle du tampon
    this.release();
  }

  /**
   * Vision cybernétique : 'thermal' (monde froid bleu-violet, sources chaudes et silhouettes
   * thermiques en couleurs vives), 'night' (amplification, phosphore vert, grain, lignes) ou
   * 'normal'. `amount` < 1 : mélange partiel. Transition animée avec un bref parasite.
   */
  setVision(mode: VisionMode, amount = 1): void {
    const a = Math.max(0, Math.min(1, amount));
    if (mode !== this.visionMode) this.switchT = 1;
    this.visionMode = mode;
    this.target.thermal = mode === 'thermal' ? a : 0;
    this.target.night = mode === 'night' ? a : 0;
  }

  /** Amplification de la vision nocturne (implant : 3 à 4,5), atténuée le jour. */
  setNightGain(g: number): void {
    this.nightGain = Math.max(1, g);
  }

  /** Teinte d'état exclusive (réflexes, surcharge, camouflage, cœur de secours) ou aucune. */
  setTint(kind: TintKind | null): void {
    this.setTints(kind ? [kind] : []);
  }

  /** Plusieurs teintes à la fois (ex. réflexes et surcharge). */
  setTints(kinds: readonly TintKind[]): void {
    this.target.reflex = kinds.includes('reflex') ? 1 : 0;
    this.target.overcharge = kinds.includes('overcharge') ? 1 : 0;
    this.target.camo = kinds.includes('camo') ? 1 : 0;
    this.target.secondWind = kinds.includes('secondWind') ? 1 : 0;
  }

  /** Termine tout de suite les transitions en cours (captures d'écran, tests). */
  skipTransitions(): void {
    Object.assign(this.cur, this.target);
    this.switchT = 0;
  }

  /** Vision demandée (cible de la transition). */
  get vision(): VisionMode {
    return this.visionMode;
  }

  /** Étalonnage en cours (vision, teinte, transition) : render() est alors nécessaire même sans halo. */
  get grading(): boolean {
    const c = this.cur;
    const t = this.target;
    return this.switchT > 0 || c.thermal + c.night + c.reflex + c.overcharge + c.camo + c.secondWind > 0.002 || t.thermal + t.night + t.reflex + t.overcharge + t.camo + t.secondWind > 0;
  }

  /** Vrai s'il faut appeler render() (halo actif ou étalonnage en cours) ; sinon un rendu direct suffit. */
  get needsRender(): boolean {
    return !this.failed && (this.enabled || this.grading);
  }

  private releaseBloom(): void {
    for (const rt of this.rts) rt.dispose();
    this.rts = [];
  }

  private release(): void {
    this.frame?.dispose();
    this.frame = null;
    this.releaseBloom();
  }

  private ensure(bloom: boolean): boolean {
    const sz = this.renderer.getDrawingBufferSize(this.tmp);
    if (!this.frame || !sz.equals(this.size)) {
      this.release();
      this.size.copy(sz);
      if (sz.x < 8 || sz.y < 8) return false;
      this.frame = new THREE.FramebufferTexture(sz.x, sz.y);
      this.frame.minFilter = THREE.LinearFilter;
      this.frame.magFilter = THREE.LinearFilter;
    }
    if (bloom && this.rts.length === 0) {
      let w = Math.max(1, sz.x >> 1);
      let h = Math.max(1, sz.y >> 1);
      for (let i = 0; i < LEVELS; i++) {
        const rt = new THREE.WebGLRenderTarget(w, h, {
          type: THREE.HalfFloatType,
          format: THREE.RGBAFormat,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
          stencilBuffer: false,
          generateMipmaps: false,
        });
        this.rts.push(rt);
        w = Math.max(1, w >> 1);
        h = Math.max(1, h >> 1);
      }
    }
    return true;
  }

  private pass(mat: THREE.ShaderMaterial, src: THREE.Texture, srcW: number, srcH: number, target: THREE.WebGLRenderTarget | null): void {
    mat.uniforms.tSrc.value = src;
    (mat.uniforms.uTexel.value as THREE.Vector2).set(1 / srcW, 1 / srcH);
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  /** Fait avancer les transitions de l'étalonnage. */
  private advance(dt: number): void {
    const step = dt * RATE;
    const c = this.cur as Record<string, number>;
    const t = this.target as Record<string, number>;
    for (const key in c) {
      const d = t[key] - c[key];
      c[key] = Math.abs(d) <= step ? t[key] : c[key] + Math.sign(d) * step;
    }
    this.switchT = Math.max(0, this.switchT - dt * 3.5);
  }

  /**
   * Dessine la scène puis le halo et l'étalonnage. `overlay` (facultatif) est appelé juste après
   * la scène, avant la copie : ce qu'il dessine (bras en vue subjective) est étalonné aussi.
   */
  render(dt: number, overlay?: () => void): void {
    this.time += Math.max(0, Math.min(0.1, dt));
    this.advance(Math.max(0, Math.min(0.1, dt)));
    const r = this.renderer;
    r.render(this.scene, this.camera);
    overlay?.();
    const bloom = this.enabled;
    const grade = this.grading;
    if (this.failed || (!bloom && !grade) || !this.ensure(bloom) || !this.frame) return;
    const night = envUniforms.uNight.value;
    const prevAuto = r.autoClear;
    try {
      r.copyFramebufferToTexture(this.frame);
      r.autoClear = false;
      const u = this.finalMat.uniforms;
      u.tBloom.value = this.black;
      u.uBloom.value = 0;
      if (bloom) {
        this.brightMat.uniforms.uThreshold.value = 0.92 - 0.07 * night;
        this.pass(this.brightMat, this.frame, this.size.x, this.size.y, this.rts[0]);
        for (let i = 1; i < LEVELS; i++) {
          const src = this.rts[i - 1];
          this.pass(this.downMat, src.texture, src.width, src.height, this.rts[i]);
        }
        // remontée : chaque niveau reçoit le niveau inférieur flouté (addition), avec un
        // poids décroissant pour que le halo reste local autour des sources
        for (let i = LEVELS - 1; i > 0; i--) {
          const src = this.rts[i];
          this.upMat.uniforms.uWeight.value = 0.55;
          this.pass(this.upMat, src.texture, src.width, src.height, this.rts[i - 1]);
        }
        u.tBloom.value = this.rts[0].texture;
        u.uBloom.value = this.strength * (0.16 + 0.26 * night);
      }
      const c = this.cur;
      (u.uRes.value as THREE.Vector2).copy(this.size);
      u.uTime.value = this.time % 1000;
      u.uThermal.value = c.thermal;
      u.uNight.value = c.night;
      u.uGain.value = this.nightGain * (0.22 + 0.78 * night);
      u.uReflex.value = c.reflex;
      u.uOver.value = c.overcharge;
      u.uCamo.value = c.camo;
      u.uWind.value = c.secondWind;
      u.uSwitch.value = this.switchT;
      this.pass(this.finalMat, this.frame, this.size.x, this.size.y, null);
    } catch (e) {
      // matériel incapable (copie du tampon refusée…) : on désactive le post-traitement
      console.warn('Post-traitement désactivé :', e);
      this.failed = true;
      this.enabled = false;
      this.release();
    } finally {
      r.autoClear = prevAuto;
      r.setRenderTarget(null);
    }
  }

  dispose(): void {
    this.release();
    this.brightMat.dispose();
    this.downMat.dispose();
    this.upMat.dispose();
    this.finalMat.dispose();
    this.black.dispose();
    this.quad.geometry.dispose();
  }
}
