// Matériau des objets voxel (accessoires, personnages) : couleurs par sommet ou par
// emplacement (teinte de faction, tenue du personnage), éclairage précalculé du monde,
// ombres du soleil, émission et brouillard au sol.

import * as THREE from 'three';
import { envUniforms } from './env';
import { COMMON_UNIFORMS_GLSL, LIGHT_GLSL, NOISE_GLSL } from './shaderChunks';

/** Couleurs de faction (sRGB) : [neutre, Dadou, Even] × [principale, secondaire, sombre]. */
export const factionUniform = {
  uFaction: {
    value: [
      new THREE.Color(0x6b5f52),
      new THREE.Color(0xb8a27a),
      new THREE.Color(0x2e2924),
      new THREE.Color(0x9e1b22),
      new THREE.Color(0xd4a640),
      new THREE.Color(0x2a0a0d),
      new THREE.Color(0x1d3461),
      new THREE.Color(0xc9d1dc),
      new THREE.Color(0x0c1426),
    ],
  },
};

/** Palette des personnages : texture 32 emplacements × N lignes (une ligne par personnage). */
export const PALETTE_ROWS = 1024;
export const paletteData = new Uint8Array(32 * PALETTE_ROWS * 4);
export const paletteTexture = new THREE.DataTexture(paletteData, 32, PALETTE_ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
paletteTexture.magFilter = THREE.NearestFilter;
paletteTexture.minFilter = THREE.NearestFilter;
paletteTexture.generateMipmaps = false;
paletteTexture.needsUpdate = true;
export const paletteUniform = { uPalette: { value: paletteTexture } };

export interface ObjectMaterialOptions {
  /** Utilise la palette par instance (personnages). */
  palette?: boolean;
  /** Pour les vues à la première personne : pas de brouillard. */
  noFog?: boolean;
  /** Le modèle est dessiné sans instanciation. */
  single?: boolean;
  /** Teinte de surbrillance (sélection). */
  key?: string;
}

export function createObjectMaterial(opts: ObjectMaterialOptions = {}): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, envUniforms, factionUniform, paletteUniform);
    shader.uniforms.uFlash = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aExt;
attribute float aOwner;
attribute float aRow;
attribute vec3 aLight;
varying vec3 vWPos;
varying vec3 vWNrm;
varying float vAO;
flat varying int vSlot;
flat varying int vOwner;
flat varying int vRow;
varying vec3 vInstLight;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  mat4 wMatX = modelMatrix * instanceMatrix;
#else
  mat4 wMatX = modelMatrix;
#endif
vWPos = (wMatX * vec4(transformed, 1.0)).xyz;
vWNrm = normalize(mat3(wMatX) * normal);
vSlot = int(aExt.x + 0.5);
vAO = aExt.y;
vOwner = int(aOwner + 0.5);
vRow = int(aRow + 0.5);
vInstLight = aLight;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHT_GLSL}
uniform vec3 uFaction[9];
uniform sampler2D uPalette;
varying vec3 vWPos;
varying vec3 vWNrm;
varying float vAO;
flat varying int vSlot;
flat varying int vOwner;
flat varying int vRow;
varying vec3 vInstLight;`,
      )
      .replace(
        '#include <color_fragment>',
        `vec3 wn = normalize(vWNrm);
vec3 albedo = pow(vColor.rgb, vec3(2.2));
vec3 gEm = vec3(0.0);
float gSpec = 0.0;
if (vSlot >= 1 && vSlot <= 3) {
  // les couleurs THREE.Color sont déjà linéaires (gestion des couleurs active)
  albedo = uFaction[clamp(vOwner, 0, 2) * 3 + vSlot - 1];
  gSpec = vSlot == 2 ? 0.5 : 0.0;
} else if (vSlot == 4) {
  albedo = vec3(1.0, 0.75, 0.4);
  gEm = vec3(1.0, 0.62, 0.28) * (1.4 + 2.2 * uNight);
} else if (vSlot == 5) {
  float fl = 0.7 + 0.3 * vnoise(vec2(uTime * 9.0, vWPos.x * 3.0 + vWPos.z));
  albedo = vec3(1.0, 0.45, 0.1);
  gEm = vec3(1.0, 0.45, 0.12) * 3.0 * fl;
} else if (vSlot == 6) {
  albedo = vec3(0.05, 0.06, 0.07);
  gSpec = 1.0;
} else if (vSlot >= 16) {
  vec4 pc = texelFetch(uPalette, ivec2(vSlot - 16, vRow), 0);
  albedo = pow(pc.rgb, vec3(2.2));
  gSpec = pc.a < 0.99 ? (1.0 - pc.a) * 2.0 : 0.0;
}
diffuseColor.rgb = albedo;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
vec2 gL = sampleLightVol(vWPos + wn * 0.12);
gL = max(gL, vInstLight.xy);
float aoF = 0.42 + 0.58 * (vAO / 3.0);
reflectedLight.directDiffuse *= mix(aoF, 1.0, 0.5) * smoothstep(0.02, 0.3, gL.x);
reflectedLight.indirectDiffuse += diffuseColor.rgb * ambientLight(gL, wn) * aoF;
totalEmissiveRadiance += gEm;
vec3 vdir = normalize(cameraPosition - vWPos);
float fres = pow(1.0 - max(dot(vdir, wn), 0.0), 3.0);
reflectedLight.indirectDiffuse += gSpec * (0.2 + fres) * (uSkyAmb * gL.x + uLampCol * gL.y * 0.8) * 0.45;`,
      )
      .replace('#include <fog_fragment>', opts.noFog ? '' : 'gl_FragColor.rgb = applyHeightFog(gl_FragColor.rgb, vWPos);');
  };
  mat.customProgramCacheKey = () => `voxel-object-${opts.noFog ? 'nofog' : 'fog'}-${opts.key ?? ''}`;
  return mat;
}
