// Ciel, soleil/lune, brouillard et cycle jour/nuit.

import * as THREE from 'three';
import { envUniforms } from './env';
import { NOISE_GLSL } from './shaderChunks';
import { clamp, smoothstep, lerp } from '../../shared/util';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uNightS;
uniform float uTimeS;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform float uDusk;
varying vec3 vDir;
${NOISE_GLSL}
float skyline(float az) {
  float a = az * 60.0;
  float bin = floor(a);
  float h = 0.012 + 0.018 * h12(vec2(bin, 1.0));
  // cheminées et clochers
  float f = fract(a);
  float b2 = floor(az * 240.0);
  if (h12(vec2(b2, 7.0)) > 0.93) h += 0.02 * step(0.3, fract(az * 240.0)) * step(fract(az * 240.0), 0.7);
  // dôme de Saint-Paul
  float dd = abs(az - 0.35);
  if (dd < 0.05) h = max(h, 0.035 + sqrt(max(0.0, 0.0025 - dd * dd)) * 0.9);
  if (dd < 0.006) h = max(h, 0.095);
  // tours de Westminster au sud-ouest
  float dw = abs(az + 2.2);
  if (dw < 0.012) h = max(h, 0.09);
  // grues des docks
  float dk = abs(az - 2.4);
  if (dk < 0.15 && h12(vec2(floor(az * 300.0), 3.0)) > 0.8) h = max(h, 0.05);
  return h;
}
void main() {
  vec3 d = normalize(vDir);
  float el = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(el, 0.0, 1.0), 0.55));
  col = mix(col, uHorizon * 0.7, smoothstep(0.0, -0.15, el));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 4.0 + pow(sd, 10.0) * 0.22 + pow(sd, 3.0) * 0.12 * uDusk) * (1.0 - uNightS);
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.92, 0.94, 1.0) * smoothstep(0.99955, 0.9997, md) * uNightS;
  col += vec3(0.2, 0.24, 0.32) * pow(md, 24.0) * 0.5 * uNightS;
  if (el > 0.03) {
    vec3 sp = floor(d * 260.0);
    float s = h13(sp);
    float tw = 0.55 + 0.45 * sin(uTimeS * 2.5 + s * 60.0);
    col += vec3(step(0.9982, s)) * tw * uNightS * smoothstep(0.05, 0.35, el) * 0.85;
  }
  vec2 cp = d.xz / max(el, 0.06) * 0.5 + vec2(uTimeS * 0.0035, uTimeS * 0.001);
  float cl = fbm(cp * 1.6);
  cl = smoothstep(0.42, 0.85, cl) * smoothstep(0.0, 0.2, el);
  vec3 cloudCol = mix(uHorizon * 1.08, uZenith * 0.75, 0.35) + uSunColor * uDusk * 0.15;
  col = mix(col, cloudCol, cl * 0.75);
  float az = atan(d.x, d.z);
  float sh = skyline(az);
  float haze = exp(-max(el, 0.0) * 9.0);
  col = mix(col, uHorizon, haze * 0.75);
  if (el < sh && el > -0.2) {
    vec3 sil = mix(uHorizon, vec3(0.0), 0.32 + 0.25 * (1.0 - el / max(sh, 0.001)));
    // fenêtres éclairées lointaines
    vec2 wg = vec2(az * 900.0, el * 900.0);
    float win = step(0.86, h12(floor(wg))) * step(0.25, fract(wg.x)) * step(fract(wg.y), 0.6);
    sil += vec3(1.0, 0.7, 0.35) * win * 0.25 * uNightS * step(0.004, sh - el);
    col = sil;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Atmosphere {
  readonly sky: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly skyMat: THREE.ShaderMaterial;
  /** Heure du jour 0..1 (0 = minuit, 0.5 = midi). */
  time = 0.84;
  night = 1;
  private sunDir = new THREE.Vector3();
  private moonDir = new THREE.Vector3();
  private shadowSize = 48;

  constructor(scene: THREE.Scene, shadowMapSize = 2048) {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uNightS: { value: 1 },
        uTimeS: { value: 0 },
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunColor: { value: new THREE.Color() },
        uDusk: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.skyMat.toneMapped = false;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = shadowMapSize > 0;
    this.sun.shadow.mapSize.set(Math.max(512, shadowMapSize), Math.max(512, shadowMapSize));
    const cam = this.sun.shadow.camera;
    cam.left = -this.shadowSize;
    cam.right = this.shadowSize;
    cam.top = this.shadowSize;
    cam.bottom = -this.shadowSize;
    cam.near = 1;
    cam.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun);
    scene.add(this.sun.target);
  }

  setShadowMapSize(size: number): void {
    this.sun.castShadow = size > 0;
    if (size > 0) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  update(dt: number, elapsed: number, focus: THREE.Vector3, camera: THREE.Camera): void {
    const t = this.time;
    // soleil : lever à 0.25, coucher à 0.75
    const ang = (t - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(ang) * 0.8, Math.sin(ang), Math.cos(ang) * 0.35 + 0.35).normalize();
    this.moonDir.set(-this.sunDir.x * 0.9, -this.sunDir.y * 0.8 + 0.35, -this.sunDir.z + 0.4).normalize();
    const elev = this.sunDir.y;
    const night = smoothstep(0.08, -0.16, elev);
    const dusk = clamp(1 - Math.abs(elev) / 0.28, 0, 1);
    this.night = night;

    const zDay = new THREE.Color(0x7d93ab);
    const hDay = new THREE.Color(0xbdb6a6);
    const zDusk = new THREE.Color(0x3b4666);
    const hDusk = new THREE.Color(0xc98a62);
    const zNight = new THREE.Color(0x070b16);
    const hNight = new THREE.Color(0x1d2433);
    const zenith = zDay.clone().lerp(zNight, night).lerp(zDusk, dusk * 0.7);
    const horizon = hDay.clone().lerp(hNight, night).lerp(hDusk, dusk * 0.75);
    const u = this.skyMat.uniforms;
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    u.uNightS.value = night;
    u.uTimeS.value = elapsed;
    u.uZenith.value.copy(zenith);
    u.uHorizon.value.copy(horizon);
    u.uSunColor.value.set(0xffd2a0).lerp(new THREE.Color(0xff7a3a), dusk);
    u.uDusk.value = dusk;
    this.sky.position.copy(camera.position);

    // lumière directionnelle : soleil le jour, lune la nuit
    const useMoon = night > 0.5;
    const dir = useMoon ? this.moonDir : this.sunDir;
    const sunCol = new THREE.Color(0xfff0d8).lerp(new THREE.Color(0xffa060), dusk);
    const moonCol = new THREE.Color(0x8ea6d0);
    if (useMoon) {
      this.sun.color.copy(moonCol);
      this.sun.intensity = 0.75 * smoothstep(0.5, 0.8, night);
    } else {
      this.sun.color.copy(sunCol);
      this.sun.intensity = 2.7 * (1 - night) * (0.45 + 0.55 * smoothstep(0, 0.35, elev));
    }
    // la caméra d'ombre suit le point d'intérêt, alignée sur les texels
    const texel = (this.shadowSize * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + dir.x * 120, Math.max(10, dir.y * 120), fz + dir.z * 120);
    this.sun.target.updateMatrixWorld();

    // uniformes d'environnement
    const e = envUniforms;
    e.uNight.value = night;
    e.uTime.value = elapsed;
    const ambDay = new THREE.Color(0.52, 0.56, 0.66);
    const ambNight = new THREE.Color(0.075, 0.085, 0.13);
    e.uSkyAmb.value.copy(ambDay).lerp(ambNight, night);
    e.uSkyAmb.value.lerp(new THREE.Color(0.4, 0.3, 0.3), dusk * 0.3);
    e.uLampCol.value.setRGB(1.0, 0.58, 0.26).multiplyScalar(lerp(0.75, 1.9, night));
    e.uFogColor.value.copy(horizon).lerp(new THREE.Color(0x2a2c30), 0.15 * (1 - night));
    e.uFogDensity.value = lerp(0.0095, 0.0175, night);
    void dt;
  }
}
