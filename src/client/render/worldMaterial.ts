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
if (gSpec > 0.004) {
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
if (gGlint > 0.22) {
  vec3 hv = normalize(directLight.direction + geometryViewDir);
  float sh = 16.0 + 400.0 * gGlint * gGlint;
  float g = pow(max(dot(geometryNormal, hv), 0.0), sh) * (sh + 8.0) * 0.0016 * gGlint * (1.0 + 3.0 * fres);
  reflectedLight.indirectDiffuse += directLight.color * g * skyVis;
}
#endif
// chaussée mouillée : flaques miroir du ciel (et, la nuit, des fenêtres éclairées alentour),
// reflets colorés des lampes et des néons en traînées verticales (à l'écran) ; couleur lue le
// long du rayon réfléchi, sans dérivées
if (gWetR > 0.0) {
  vec3 R = reflect(-vdir, wn);
  vec3 tq = lampTintLod(vWPos + R * 2.0);
  float tm = max(tq.r, max(tq.g, tq.b));
  vec3 rc = tm > 0.004 ? tq / tm : uLampCol;
  float dC = length(cameraPosition - vWPos);
  float sx = vViewPosition.x / max(vViewPosition.z, 0.05);
  float sn = vnoise(vec2(sx * 42.0, dC * 0.3));
  float pud = smoothstep(0.6, 1.0, gWetR);
  float streak = mix(0.3 + 1.3 * sn * sn, 0.65 + 0.35 * sn, pud);
  vec3 acc = rc * uLampPower * gL.y * gL.y * 0.85 * streak + skyReflect(R, 0.12) * gL.x * 0.35;
  acc += cityLights(vWPos, R, gPw / max(dC, 0.5), dC) * uNight * pud * 0.45;
  reflectedLight.indirectDiffuse += acc * gWetR * (0.15 + 0.9 * fres);
}`,
      )
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyHeightFog(gl_FragColor.rgb, vWPos);');
  };
  mat.customProgramCacheKey = () => 'voxel-world-v2';
  return mat;
}
