// La Tamise : surface d'eau animée avec reflets du ciel et des lampes.

import * as THREE from 'three';
import { envUniforms } from './env';
import { COMMON_UNIFORMS_GLSL, LIGHT_GLSL, NOISE_GLSL } from './shaderChunks';
import { RIVER_Z, WORLD_W } from '../../shared/city/plan';

const VERT = /* glsl */ `
varying vec3 vWPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHT_GLSL}
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uMoonDirW;
varying vec3 vWPos;
void main() {
  vec2 p = vWPos.xz;
  float t = uTime;
  float e = 0.08;
  float h0 = vnoise(p * 0.7 + vec2(t * 0.25, t * 0.1)) + 0.5 * vnoise(p * 2.1 - vec2(t * 0.4, -t * 0.3));
  float hx = vnoise((p + vec2(e, 0.0)) * 0.7 + vec2(t * 0.25, t * 0.1)) + 0.5 * vnoise((p + vec2(e, 0.0)) * 2.1 - vec2(t * 0.4, -t * 0.3));
  float hz = vnoise((p + vec2(0.0, e)) * 0.7 + vec2(t * 0.25, t * 0.1)) + 0.5 * vnoise((p + vec2(0.0, e)) * 2.1 - vec2(t * 0.4, -t * 0.3));
  vec3 n = normalize(vec3((h0 - hx) * 2.2, 1.0, (h0 - hz) * 2.2));
  vec3 v = normalize(cameraPosition - vWPos);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(v, n), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 skyCol = mix(uSkyHorizon, uSkyTop, clamp(r.y, 0.0, 1.0));
  vec3 deep = vec3(0.035, 0.05, 0.045) * (0.3 + 1.6 * (1.0 - uNight));
  vec2 L = sampleLightVol(vWPos + vec3(0.0, 0.6, 0.0));
  vec3 lampRefl = uLampCol * L.y * L.y * 0.9 * (0.6 + 0.8 * pow(max(r.y, 0.0), 2.0));
  vec3 col = mix(deep, skyCol, fres * 0.85) + lampRefl * (0.3 + fres);
  float glint = pow(max(dot(r, uMoonDirW), 0.0), 220.0);
  col += vec3(0.8, 0.85, 1.0) * glint * (0.4 + 0.8 * uNight);
  col = applyHeightFog(col, vWPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createWater(): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      ...envUniforms,
      uSkyTop: { value: new THREE.Color(0.1, 0.12, 0.18) },
      uSkyHorizon: { value: new THREE.Color(0.2, 0.22, 0.26) },
      uMoonDirW: { value: new THREE.Vector3(0, 1, 0) },
    },
  });
  mat.toneMapped = false;
  const w = WORLD_W + 600;
  const d = 400;
  const geo = new THREE.PlaneGeometry(w, 35, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(WORLD_W / 2, -1.05, RIVER_Z + 17.5);
  mesh.receiveShadow = false;
  return { mesh, mat };
}
