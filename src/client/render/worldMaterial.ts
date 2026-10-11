// Matériau du monde voxel : MeshLambertMaterial (ombres du soleil/de la lune gérées par
// Three.js) enrichi par injection de code : motifs procéduraux, volume d'éclairage
// précalculé (ciel + lampes), occlusion ambiante, émission, reflets (ciel, lampes, éclat du
// soleil ou de la lune), chaussée mouillée et brouillard au sol.

import * as THREE from 'three';
import { envUniforms } from './env';
import { COMMON_UNIFORMS_GLSL, LIGHT_GLSL, MATERIAL_GLSL, NOISE_GLSL, PATTERN_GLSL, REFLECT_GLSL } from './shaderChunks';

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
${REFLECT_GLSL}
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
vec3 lampC = lampColorAt(vWPos);
vec3 gEmissive;
float gSpec;
diffuseColor.rgb = voxelMaterial(vMat, vWPos, wn, gL, lampC, gEmissive, gSpec);`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
float aoF = 0.34 + 0.66 * (vAO / 3.0);
float skyVis = smoothstep(0.02, 0.32, gL.x);
reflectedLight.directDiffuse *= mix(aoF, 1.0, 0.45) * skyVis;
reflectedLight.indirectDiffuse += diffuseColor.rgb * ambientLight(gL, wn, vWPos) * aoF;
totalEmissiveRadiance += gEmissive;
vec3 vdir = normalize(cameraPosition - vWPos);
float fres = pow(1.0 - max(dot(vdir, wn), 0.0), 4.0);
// reflets : ciel en dégradé (façades d'en face sous l'horizon) et lampes ; teintés pour les métaux
VX_IF(gSpec > 0.004) {
  vec3 R = reflect(-vdir, wn);
  float brk = mix(0.1, -0.02 + 0.05 * vnoise(vWPos.xz * 0.7 + vWPos.y * 0.3), gMetal);
  // (sur sol mouillé, les lampes ne se reflètent que le long du rayon réfléchi : voir plus bas)
  vec3 env = skyReflect(R, brk) * gL.x + lampC * gL.y * 0.7 * (1.0 - 0.85 * gWetR);
  // métal poli : la rue se reflète bien plus sombre que le ciel (ligne d'horizon nette)
  env *= mix(1.0, 0.3 + 0.7 * smoothstep(brk - 0.02, brk + 0.05, R.y), gMetal);
  vec3 tint = diffuseColor.rgb / max(max(diffuseColor.r, diffuseColor.g), max(diffuseColor.b, 0.02));
  env = mix(env, env * tint, gMetal);
  float F = mix(0.1 + 0.9 * fres, 0.75 + 0.25 * fres, gMetal);
  reflectedLight.indirectDiffuse += env * gSpec * F * mix(aoF, 1.0, 0.5) * 0.85;
}
// éclat du soleil (ou de la lune) sur le verre, le métal poli, les flaques
#if NUM_DIR_LIGHTS > 0
VX_IF(gGlint > 0.22) {
  vec3 hv = normalize(directLight.direction + geometryViewDir);
  float sh = 16.0 + 400.0 * gGlint * gGlint;
  float g = pow(max(dot(geometryNormal, hv), 0.0), sh) * (sh + 8.0) * 0.0016 * gGlint * (1.0 + 3.0 * fres);
  reflectedLight.indirectDiffuse += directLight.color * g * skyVis;
}
#endif
// chaussée mouillée : reflets flous des lampes et du ciel le long du rayon réfléchi, étirés en
// traînées verticales vers la caméra
if (gWetR > 0.0) {
  vec3 R = reflect(-vdir, wn);
  vec3 q1 = vWPos + R * 1.6;
  vec3 q2 = vWPos + R * 4.5;
  vec2 L1 = sampleLightVol(q1);
  vec2 L2 = sampleLightVol(q2);
  vec3 acc = lampColorAt(q1) * L1.y * L1.y * 0.8 + lampColorAt(q2) * L2.y * L2.y * 0.6;
  acc += skyReflect(R, 0.12) * max(L1.x, L2.x) * 0.25;
  vec2 dv = normalize(vdir.xz + vec2(1e-4, 0.0));
  float across = dot(vWPos.xz, vec2(-dv.y, dv.x));
  float along = dot(vWPos.xz, dv);
  float streak = 0.55 + 0.7 * vnoise(vec2(across * 2.2, along * 0.3));
  reflectedLight.indirectDiffuse += acc * streak * gWetR * (0.15 + 0.9 * fres);
}`,
      )
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyHeightFog(gl_FragColor.rgb, vWPos);');
  };
  mat.customProgramCacheKey = () => 'voxel-world-v2';
  return mat;
}
