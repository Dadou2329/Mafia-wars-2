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
uniform float uRain;
uniform float uFlash;
varying vec3 vDir;
${NOISE_GLSL}
// Silhouette lointaine de New York 2085 : forêt de tours, flèches, antennes et méga-tours.
float skyline(float az, out float bin, out float spire) {
  float a = az * 46.0;
  bin = floor(a);
  float r = h12(vec2(bin, 1.0));
  float h = 0.018 + 0.05 * r * r;
  // grappes de très hautes tours (Midtown au nord, Lower Manhattan au sud, Jersey City à l'ouest)
  float c1 = exp(-pow((az - 0.15) * 3.2, 2.0));
  float c2 = exp(-pow((az + 2.9) * 3.0, 2.0)) + exp(-pow((az - 3.05) * 3.0, 2.0));
  float c3 = exp(-pow((az + 1.45) * 2.6, 2.0));
  h += (0.06 * c1 + 0.045 * c2 + 0.03 * c3) * h12(vec2(bin, 5.0));
  // retraits en gradins (art déco) près du sommet
  float f = fract(a);
  float step1 = step(0.18, f) * step(f, 0.82);
  h -= 0.008 * (1.0 - step1) * step(0.5, h12(vec2(bin, 9.0)));
  // flèches et antennes
  spire = 0.0;
  if (h12(vec2(bin, 3.0)) > 0.8) {
    float w = abs(f - 0.5);
    spire = max(0.0, 0.035 * (1.0 - w * 9.0)) * (0.5 + c1);
    h += spire;
  }
  // tours basses intercalées
  float b2 = floor(az * 160.0);
  if (h12(vec2(b2, 7.0)) > 0.7) h = max(h, 0.012 + 0.012 * h12(vec2(b2, 8.0)));
  return h;
}
void main() {
  vec3 d = normalize(vDir);
  float el = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(el, 0.0, 1.0), 0.55));
  col = mix(col, uHorizon * 0.7, smoothstep(0.0, -0.15, el));
  float clear = 1.0 - uRain;
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 4.0 * clear + pow(sd, 10.0) * 0.22 + pow(sd, 3.0) * 0.12 * uDusk) * (1.0 - uNightS);
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.92, 0.94, 1.0) * smoothstep(0.99955, 0.9997, md) * uNightS * clear;
  col += vec3(0.2, 0.24, 0.32) * pow(md, 24.0) * 0.5 * uNightS * clear;
  if (el > 0.03) {
    vec3 sp = floor(d * 260.0);
    float s = h13(sp);
    float tw = 0.55 + 0.45 * sin(uTimeS * 2.5 + s * 60.0);
    // peu d'étoiles : la pollution lumineuse de la ville les efface
    col += vec3(step(0.9988, s)) * tw * uNightS * smoothstep(0.12, 0.5, el) * 0.6 * clear;
  }
  // nuages (couverture plus épaisse sous la pluie), éclairés par en dessous par les néons
  vec2 cp = d.xz / max(el, 0.06) * 0.5 + vec2(uTimeS * 0.0045, uTimeS * 0.0015);
  float cl = fbm(cp * 1.6);
  cl = smoothstep(0.42 - 0.3 * uRain, 0.85 - 0.25 * uRain, cl) * smoothstep(0.0, 0.2, el);
  vec3 cloudCol = mix(uHorizon * 1.08, uZenith * 0.75, 0.35) + uSunColor * uDusk * 0.15;
  cloudCol += vec3(0.3, 0.08, 0.32) * uNightS * 0.35 * exp(-el * 4.0);
  cloudCol += vec3(0.75, 0.8, 1.0) * uFlash * 1.6;
  col = mix(col, cloudCol, cl * (0.75 + 0.2 * uRain));
  col += vec3(0.55, 0.6, 0.85) * uFlash * 0.5 * smoothstep(0.0, 0.3, el);
  float az = atan(d.x, d.z);
  float bin;
  float spire;
  float sh = skyline(az, bin, spire);
  float haze = exp(-max(el, 0.0) * 9.0);
  col = mix(col, uHorizon, haze * 0.75);
  // halo de la ville la nuit (néons magenta et cyan sous le smog)
  col += mix(vec3(0.42, 0.1, 0.42), vec3(0.08, 0.3, 0.45), 0.5 + 0.5 * sin(az * 3.0)) * exp(-max(el, 0.0) * 14.0) * uNightS * 0.32;
  if (el < sh && el > -0.2) {
    vec3 sil = mix(uHorizon, vec3(0.0), 0.38 + 0.28 * (1.0 - el / max(sh, 0.001)));
    // fenêtres éclairées : blanc chaud, cyan, magenta
    vec2 wg = vec2(az * 1100.0, el * 1300.0);
    float win = step(0.8, h12(floor(wg))) * step(0.3, fract(wg.x)) * step(fract(wg.y), 0.55);
    float hue = h12(vec2(bin, 11.0));
    vec3 wc = hue < 0.55 ? vec3(1.0, 0.78, 0.5) : hue < 0.8 ? vec3(0.35, 0.9, 1.0) : vec3(1.0, 0.35, 0.8);
    sil += wc * win * 0.32 * mix(0.25, 1.0, uNightS) * step(0.004, sh - el - spire);
    // bandeaux de LED horizontaux sur certaines tours
    float band = step(0.86, h12(vec2(bin, 13.0))) * step(abs(fract(el * 55.0) - 0.5), 0.06);
    sil += mix(vec3(1.0, 0.2, 0.6), vec3(0.2, 0.9, 1.0), h12(vec2(bin, 17.0))) * band * 0.7 * uNightS * step(0.003, sh - el - spire);
    // feux d'obstacle rouges qui clignotent au sommet
    float top = smoothstep(0.004, 0.0, abs(el - (sh - 0.002))) * step(0.04, sh);
    float blink = step(0.5, fract(uTimeS * 0.6 + h12(vec2(bin, 21.0))));
    sil += vec3(1.0, 0.08, 0.05) * top * blink * step(0.4, abs(fract(az * 46.0) - 0.5) * 2.0 + 0.4) * 1.4;
    sil += vec3(0.55, 0.6, 0.85) * uFlash * 0.12;
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
  /** Pluie affichée (0..1) et orage (éclairs). */
  rain = 0;
  storm = 0;
  /** Instant (horloge du rendu) du prochain coup de tonnerre, 0 si aucun. */
  thunderAt = 0;
  private flash = 0;
  private flashHold = 0;
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
        uRain: { value: 0 },
        uFlash: { value: 0 },
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

    // New York 2085 : ciel enfumé le jour, crépuscule rose orangé, nuit violette (pollution lumineuse)
    const zDay = new THREE.Color(0x6f8db5);
    const hDay = new THREE.Color(0xc4b9b0);
    const zDusk = new THREE.Color(0x2c2f62);
    const hDusk = new THREE.Color(0xe07a68);
    const zNight = new THREE.Color(0x05060f);
    const hNight = new THREE.Color(0x261a36);
    const zenith = zDay.clone().lerp(zNight, night).lerp(zDusk, dusk * 0.7);
    const horizon = hDay.clone().lerp(hNight, night).lerp(hDusk, dusk * 0.75);
    // pluie : ciel bas et gris
    const rain = clamp(this.rain, 0, 1);
    zenith.lerp(new THREE.Color(0x3a4048).lerp(new THREE.Color(0x0a0b10), night), rain * 0.65);
    horizon.lerp(new THREE.Color(0x5a5e66).lerp(new THREE.Color(0x1c1822), night), rain * 0.55);
    // éclairs pendant les averses fortes et les orages
    this.flash = Math.max(0, this.flash - dt * 5);
    if (this.flashHold > 0) {
      this.flashHold -= dt;
      if (Math.random() < dt * 14) this.flash = Math.max(this.flash, 0.5 + Math.random() * 0.5);
    }
    const stormy = Math.max(this.storm, smoothstep(0.75, 1, rain));
    if (stormy > 0.01 && Math.random() < dt * 0.07 * stormy) {
      this.flash = 1;
      this.flashHold = 0.25 + Math.random() * 0.35;
      this.thunderAt = elapsed + 0.7 + Math.random() * 2.5;
    }
    const u = this.skyMat.uniforms;
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    u.uNightS.value = night;
    u.uTimeS.value = elapsed;
    u.uZenith.value.copy(zenith);
    u.uHorizon.value.copy(horizon);
    u.uSunColor.value.set(0xffd2a0).lerp(new THREE.Color(0xff7a3a), dusk);
    u.uDusk.value = dusk;
    u.uRain.value = rain;
    u.uFlash.value = this.flash;
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
    this.sun.intensity *= 1 - 0.6 * rain;
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
    e.uSkyAmb.value.lerp(new THREE.Color(0.4, 0.28, 0.36), dusk * 0.3);
    e.uSkyAmb.value.multiplyScalar(1 - 0.25 * rain);
    e.uSkyAmb.value.add(new THREE.Color(0.55, 0.6, 0.8).multiplyScalar(this.flash * 0.9));
    e.uLampCol.value.setRGB(1.0, 0.72, 0.45);
    e.uLampPower.value = lerp(0.75, 1.9, night);
    e.uFogColor.value.copy(horizon).lerp(new THREE.Color(0x2a2c34), 0.15 * (1 - night));
    e.uFogDensity.value = lerp(0.0095, 0.0175, night) * (1 + 0.8 * rain);
  }
}
