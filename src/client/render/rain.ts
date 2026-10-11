// Pluie : des milliers de traits de pluie animés sur le GPU dans une boîte qui suit la caméra.
// Les gouttes à l'abri (sous un pont, un auvent, dans un bâtiment) sont masquées grâce au volume
// de lumière (exposition au ciel) et elles prennent la couleur des néons voisins la nuit.

import * as THREE from 'three';
import { envUniforms } from './env';
import { COMMON_UNIFORMS_GLSL, LIGHT_GLSL } from './shaderChunks';

const VERT = /* glsl */ `
${COMMON_UNIFORMS_GLSL}
${LIGHT_GLSL}
attribute vec3 aOff;
attribute float aSeed;
uniform vec3 uCam;
uniform vec3 uBox;
uniform float uIntensity;
uniform float uClock;
uniform vec2 uWind;
/** Taille d'un pixel (m) à 1 m de la caméra. */
uniform float uPixel;
varying float vA;
varying float vT;
varying vec3 vCol;
void main() {
  float on = step(aSeed, uIntensity);
  float fall = 17.0 + 7.0 * fract(aSeed * 13.7);
  vec3 dir = normalize(vec3(uWind.x, -fall, uWind.y));
  vec3 p = aOff * uBox + dir * fall * uClock;
  vec3 base = uCam - uBox * 0.5;
  vec3 head = mod(p - base, uBox) + base;
  // à l'abri : pas de pluie
  vec2 L = sampleLightVol(head);
  float open = smoothstep(0.12, 0.3, L.x);
  float len = 0.6 + 0.45 * fract(aSeed * 7.3);
  vec3 pt = head - dir * len * position.y;
  vec3 toCam = normalize(cameraPosition - head);
  vec3 side = normalize(cross(dir, toCam));
  float dist = distance(cameraPosition, head);
  // au moins un pixel et demi de large, quelle que soit la résolution (un trait plus fin ne se
  // dessine pas)
  pt += side * position.x * max(0.008, dist * uPixel * 1.2);
  // les gouttes trop proches de l'objectif gênent : on les estompe
  float near = smoothstep(0.8, 3.0, dist);
  vA = on * open * near * (0.16 + 0.2 * fract(aSeed * 3.1));
  vT = position.y;
  // les gouttes accrochent la lumière : ciel le jour, néons et lampadaires la nuit
  vec3 dropCol = mix(vec3(0.58, 0.62, 0.68), vec3(0.26, 0.3, 0.38), uNight);
  vCol = dropCol + lampColorAt(head) * clamp(L.y * 1.8, 0.0, 1.0) * 0.8 * uNight;
  gl_Position = projectionMatrix * viewMatrix * vec4(pt, 1.0);
  if (vA < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const FRAG = /* glsl */ `
varying float vA;
varying float vT;
varying vec3 vCol;
void main() {
  float a = vA * vT * (1.0 - vT) * 4.0;
  gl_FragColor = vec4(vCol, a);
}
`;

export class Rain {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private clock = 0;
  /** Intensité affichée (lissée). */
  intensity = 0;

  constructor(count = 6000) {
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
    quad.setIndex([0, 1, 2, 2, 1, 3]);
    const off = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    let s = 1234567;
    const rnd = (): number => {
      s = (s * 1103515245 + 12345) >>> 0;
      return (s >>> 8) / 16777216;
    };
    for (let i = 0; i < count; i++) {
      off[i * 3] = rnd();
      off[i * 3 + 1] = rnd();
      off[i * 3 + 2] = rnd();
      seed[i] = rnd();
    }
    quad.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
    quad.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    quad.instanceCount = count;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...envUniforms,
        uCam: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(34, 24, 34) },
        uIntensity: { value: 0 },
        uClock: { value: 0 },
        uWind: { value: new THREE.Vector2(1.6, 0.7) },
        uPixel: { value: 0.002 },
      },
      transparent: true,
      depthWrite: false,
      // le trait est orienté vers la caméra mais son sens de parcours dépend du vent : deux faces
      side: THREE.DoubleSide,
    });
    this.mat.toneMapped = false;
    this.mesh = new THREE.Mesh(quad, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    this.mesh.name = 'pluie';
  }

  /** target : pluie voulue (0..1) ; sheltered : caméra à l'intérieur ou sous terre ; viewH : hauteur de l'image en pixels. */
  update(dt: number, camera: THREE.PerspectiveCamera, target: number, sheltered: boolean, viewH = 1080): void {
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.6);
    const visible = this.intensity > 0.02 && !sheltered;
    this.mesh.visible = visible;
    if (!visible) return;
    this.clock = (this.clock + dt) % 1000;
    const u = this.mat.uniforms;
    u.uCam.value.copy(camera.position);
    u.uIntensity.value = Math.min(1, this.intensity * 1.1);
    u.uClock.value = this.clock;
    u.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, viewH);
  }
}
