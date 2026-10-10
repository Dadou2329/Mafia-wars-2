// Uniformes d'environnement partagés (éclairage, brouillard, heure) et texture des matériaux.

import * as THREE from 'three';
import { MATERIALS } from '../../shared/materials';
import type { LightVolume } from './lightVolume';

export const envUniforms = {
  uLightTex: { value: null as THREE.Data3DTexture | null },
  uLightOrigin: { value: new THREE.Vector3(0, -2, 0) },
  uLightSize: { value: new THREE.Vector3(200, 32, 160) },
  uSkyAmb: { value: new THREE.Color(0.5, 0.55, 0.65) },
  uLampCol: { value: new THREE.Color(1.0, 0.62, 0.3) },
  uNight: { value: 0.8 },
  uTime: { value: 0 },
  uFogColor: { value: new THREE.Color(0.2, 0.22, 0.27) },
  uFogDensity: { value: 0.012 },
  uFogHeightK: { value: 0.08 },
  uLampBoost: { value: 1 },
  uMatTex: { value: null as THREE.DataTexture | null },
};

/** Texture 256×4 RGBA : couleur+motif, couleur2+échelle, émissif+mode, (spéculaire, salissure, bruit). */
export function createMaterialTexture(): THREE.DataTexture {
  const W = 256;
  const data = new Uint8Array(W * 4 * 4);
  const put = (x: number, row: number, r: number, g: number, b: number, a: number) => {
    const i = (row * W + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  };
  for (let i = 0; i < MATERIALS.length; i++) {
    const m = MATERIALS[i];
    const c = m.color;
    const c2 = m.color2 ?? m.color;
    const e = m.emissive ?? 0;
    put(i, 0, (c >> 16) & 255, (c >> 8) & 255, c & 255, m.pattern);
    put(i, 1, (c2 >> 16) & 255, (c2 >> 8) & 255, c2 & 255, m.scale ?? 0);
    put(i, 2, (e >> 16) & 255, (e >> 8) & 255, e & 255, m.emissiveMode ?? 0);
    put(i, 3, Math.round((m.spec ?? 0) * 255), Math.round((m.grime ?? 0) * 255), Math.round((m.noise ?? 0.2) * 255), 0);
  }
  const tex = new THREE.DataTexture(data, W, 4, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  envUniforms.uMatTex.value = tex;
  return tex;
}

export function createLightTexture(v: LightVolume): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(v.data, v.nx, v.ny, v.nz);
  tex.format = THREE.RGFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  envUniforms.uLightTex.value = tex;
  envUniforms.uLightOrigin.value.set(v.origin[0], v.origin[1], v.origin[2]);
  envUniforms.uLightSize.value.set(v.nx * v.cell, v.ny * v.cell, v.nz * v.cell);
  return tex;
}
