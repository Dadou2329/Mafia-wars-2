// L'East River, l'Hudson et la baie : surface d'eau animée avec reflets du ciel et des néons.

import * as THREE from 'three';
import { envUniforms } from './env';
import { COMMON_UNIFORMS_GLSL, LIGHT_GLSL, NOISE_GLSL } from './shaderChunks';
import { CREEK, RIVER_X0, RIVER_X1, WATER_Y, WORLD_D } from '../../shared/city/plan';

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
  vec3 lampRefl = lampColorAt(vWPos) * L.y * L.y * 0.9 * (0.6 + 0.8 * pow(max(r.y, 0.0), 2.0));
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
  // une seule géométrie : l'East River (prolongée au nord et au sud), Newtown Creek,
  // l'Hudson à l'ouest de Manhattan et la baie au sud de la pointe
  const far = 700;
  const rects: [number, number, number, number][] = [
    [RIVER_X0, -far, RIVER_X1, WORLD_D + far],
    [CREEK[0], CREEK[1], CREEK[2], CREEK[3]],
    [-far, -far, 0, WORLD_D + far],
    [0, WORLD_D + 6, RIVER_X0, WORLD_D + far],
  ];
  const geos = rects.map(([x0, z0, x1, z1]) => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    return g;
  });
  const geo = mergeGeometries(geos);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, WATER_Y + 0.05, 0);
  mesh.receiveShadow = false;
  return { mesh, mat };
}

/** Fusion de géométries non indexées de même format (positions, normales, UV). */
function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const parts = geos.map((g) => g.getAttribute(name) as THREE.BufferAttribute);
    const size = parts[0].itemSize;
    const arr = new Float32Array(parts.reduce((n, a) => n + a.count * size, 0));
    let o = 0;
    for (const a of parts) {
      arr.set(a.array as Float32Array, o);
      o += a.count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
