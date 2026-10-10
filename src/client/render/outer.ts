// Sol lointain autour de la ville (au-delà des limites jouables), noyé dans le brouillard.

import * as THREE from 'three';
import { envUniforms } from './env';
import { COMMON_UNIFORMS_GLSL, LIGHT_GLSL, NOISE_GLSL } from './shaderChunks';
import { RIVER_Z, WORLD_D, WORLD_W } from '../../shared/city/plan';

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
varying vec3 vWPos;
void main() {
  vec2 p = vWPos.xz;
  // toits lointains : damier sombre et irrégulier
  vec2 c = floor(p / 9.0);
  float r = h12(c);
  vec3 col = mix(vec3(0.075, 0.07, 0.07), vec3(0.13, 0.1, 0.09), r);
  col *= 0.8 + 0.3 * vnoise(p * 0.3);
  col *= 0.4 + 0.6 * (1.0 - uNight * 0.8);
  // quelques fenêtres lointaines la nuit
  float win = step(0.992, h12(floor(p * 0.5))) * uNight;
  col += vec3(1.0, 0.65, 0.3) * win * 0.35;
  col = applyHeightFog(col, vWPos + vec3(0.0, 4.0, 0.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createOuterGround(): THREE.Group {
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...envUniforms } });
  mat.toneMapped = false;
  const g = new THREE.Group();
  const add = (x0: number, z0: number, x1: number, z1: number) => {
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set((x0 + x1) / 2, -0.03, (z0 + z1) / 2);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    g.add(m);
  };
  const far = 700;
  add(-far, -far, WORLD_W + far, 0); // nord
  add(-far, 0, 0, RIVER_Z); // ouest
  add(WORLD_W, 0, WORLD_W + far, RIVER_Z); // est
  add(-far, WORLD_D + 22, WORLD_W + far, WORLD_D + far); // rive sud
  return g;
}
