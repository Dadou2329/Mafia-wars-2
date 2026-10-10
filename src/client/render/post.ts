// Halo lumineux (bloom) des lampes à gaz, des fenêtres éclairées et des flammes.
// La scène est dessinée normalement à l'écran (mêmes couleurs, même anticrénelage) ; on
// copie ensuite l'image, on en extrait les zones les plus claires, on les floute sur une
// chaîne de demi-résolutions (filtre « dual Kawase ») et on les rajoute par-dessus.

import * as THREE from 'three';
import { envUniforms } from './env';

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
  // les lumières chaudes (lampes, feu) brillent davantage que le ciel gris
  float warm = clamp((c.r - c.b) * 2.0, 0.0, 1.0);
  return c * w * (0.35 + 0.65 * warm);
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

const COMPOSITE = /* glsl */ `
uniform sampler2D tSrc;
uniform float uStrength;
varying vec2 vUv;
void main() {
  vec3 b = texture2D(tSrc, vUv).rgb * uStrength;
  // courbe douce pour éviter de brûler les blancs
  b = b / (1.0 + b);
  gl_FragColor = vec4(b, 1.0);
}`;

const LEVELS = 5;

export class PostFX {
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
  private compMat: THREE.ShaderMaterial;
  private size = new THREE.Vector2();
  private failed = false;

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
    this.brightMat = mk(BRIGHT, { uThreshold: { value: 0.8 } });
    this.downMat = mk(DOWN);
    this.upMat = mk(UP, { uWeight: { value: 1 } }, true);
    this.compMat = mk(COMPOSITE, { uStrength: { value: 1 } }, true);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.brightMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setEnabled(on: boolean): void {
    this.enabled = on && !this.failed;
    if (!this.enabled) this.release();
  }

  setSize(w: number, h: number): void {
    void w;
    void h;
    // les cibles sont recréées au prochain rendu, à la taille réelle du tampon
    this.release();
  }

  private release(): void {
    this.frame?.dispose();
    this.frame = null;
    for (const rt of this.rts) rt.dispose();
    this.rts = [];
  }

  private ensure(): boolean {
    const sz = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.frame && sz.equals(this.size)) return true;
    this.release();
    this.size.copy(sz);
    if (sz.x < 8 || sz.y < 8) return false;
    this.frame = new THREE.FramebufferTexture(sz.x, sz.y);
    this.frame.minFilter = THREE.LinearFilter;
    this.frame.magFilter = THREE.LinearFilter;
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
    return true;
  }

  private pass(mat: THREE.ShaderMaterial, src: THREE.Texture, srcW: number, srcH: number, target: THREE.WebGLRenderTarget | null): void {
    mat.uniforms.tSrc.value = src;
    (mat.uniforms.uTexel.value as THREE.Vector2).set(1 / srcW, 1 / srcH);
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(dt: number): void {
    void dt;
    const r = this.renderer;
    r.render(this.scene, this.camera);
    if (!this.enabled || !this.ensure() || !this.frame) return;
    const night = envUniforms.uNight.value;
    const prevAuto = r.autoClear;
    try {
      r.copyFramebufferToTexture(this.frame);
      r.autoClear = false;
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
      this.compMat.uniforms.uStrength.value = this.strength * (0.16 + 0.26 * night);
      this.pass(this.compMat, this.rts[0].texture, this.rts[0].width, this.rts[0].height, null);
    } catch (e) {
      // matériel incapable (copie du tampon refusée…) : on désactive le halo
      console.warn('Bloom désactivé :', e);
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
    this.compMat.dispose();
    this.quad.geometry.dispose();
  }
}
