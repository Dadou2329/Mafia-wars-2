// Matériau du monde voxel : MeshLambertMaterial (ombres du soleil/de la lune gérées par
// Three.js) enrichi par injection de code : motifs procéduraux, volume d'éclairage
// précalculé (ciel + lampes), occlusion ambiante, émission et brouillard au sol.

import * as THREE from 'three';
import { envUniforms } from './env';
import { COMMON_UNIFORMS_GLSL, LIGHT_GLSL, MATERIAL_GLSL, NOISE_GLSL, PATTERN_GLSL } from './shaderChunks';

export function createWorldMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, envUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aData;
varying vec3 vWPos;
varying vec3 vWNrm;
varying float vAO;
flat varying int vMat;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normal;
vAO = aData.x;
vMat = int(aData.y + 0.5);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHT_GLSL}
${PATTERN_GLSL}
${MATERIAL_GLSL}
varying vec3 vWPos;
varying vec3 vWNrm;
varying float vAO;
flat varying int vMat;`,
      )
      .replace(
        '#include <color_fragment>',
        `vec3 wn = normalize(vWNrm);
vec2 gL = sampleLightVol(vWPos + wn * 0.26);
vec3 gEmissive;
float gSpec;
diffuseColor.rgb = voxelMaterial(vMat, vWPos, wn, gL, gEmissive, gSpec);`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
float aoF = 0.34 + 0.66 * (vAO / 3.0);
reflectedLight.directDiffuse *= mix(aoF, 1.0, 0.45) * smoothstep(0.02, 0.32, gL.x);
reflectedLight.indirectDiffuse += diffuseColor.rgb * ambientLight(gL, wn) * aoF;
totalEmissiveRadiance += gEmissive;
vec3 vdir = normalize(cameraPosition - vWPos);
float fres = pow(1.0 - max(dot(vdir, wn), 0.0), 4.0);
reflectedLight.indirectDiffuse += gSpec * (0.15 + fres) * (uSkyAmb * gL.x * 0.8 + uLampCol * gL.y * 0.7) * 0.5;`,
      )
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyHeightFog(gl_FragColor.rgb, vWPos);');
  };
  mat.customProgramCacheKey = () => 'voxel-world-v1';
  return mat;
}
