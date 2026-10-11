// Sol lointain autour de la ville (au-delà des limites jouables) : le reste de Manhattan au nord,
// le Queens et Brooklyn à l'est, noyés dans le brouillard. L'Hudson et la baie sont de l'eau (water.ts).

import * as THREE from 'three';
import { envUniforms } from './env';
import { COMMON_UNIFORMS_GLSL, LIGHT_GLSL, NOISE_GLSL } from './shaderChunks';
import { CREEK, CREEK_FAR, RIVER_X0, RIVER_X1, WORLD_D, WORLD_W } from '../../shared/city/plan';

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
  col += mix(vec3(1.0, 0.65, 0.3), vec3(0.3, 0.8, 1.0), step(0.5, h12(c + 3.0))) * win * 0.45;
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
  const far = 900;
  add(0, -far, RIVER_X0, 0); // Manhattan au nord (Upper Manhattan, le Bronx)
  add(RIVER_X1, -far, WORLD_W + far, 0); // le Queens au nord-est
  add(WORLD_W, 0, WORLD_W + far, CREEK[1]); // le Queens à l'est
  add(WORLD_W, CREEK[3], WORLD_W + far, WORLD_D); // Brooklyn à l'est
  add(CREEK_FAR, CREEK[1], WORLD_W + far, CREEK[3]); // au-delà du bout de Newtown Creek
  add(RIVER_X1, WORLD_D, WORLD_W + far, WORLD_D + far); // Brooklyn au sud
  return g;
}
