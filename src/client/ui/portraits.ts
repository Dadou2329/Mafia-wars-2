// Portraits 3D des deux parrains, rendus une seule fois pour les menus et le salon.

import * as THREE from 'three';
import { Anim, CharKind, Weapon } from '../../shared/characters';
import { CharacterRenderer, type CharView } from '../characters/characterRenderer';
import { createMaterialTexture, envUniforms } from '../render/env';
import type { Portraits } from '../appApi';
import { settings } from '../settings';

function ensureDefaultLight(): void {
  if (envUniforms.uLightTex.value) return;
  const data = new Uint8Array(2 * 2 * 2 * 2);
  for (let i = 0; i < 8; i++) {
    data[i * 2] = 200;
    data[i * 2 + 1] = 120;
  }
  const tex = new THREE.Data3DTexture(data, 2, 2, 2);
  tex.format = THREE.RGFormat;
  tex.needsUpdate = true;
  envUniforms.uLightTex.value = tex;
  envUniforms.uLightOrigin.value.set(-1000, -1000, -1000);
  envUniforms.uLightSize.value.set(2000, 2000, 2000);
}

export async function renderPortraits(width = 360, height = 480): Promise<Portraits> {
  await new Promise((r) => setTimeout(r, 50));
  if (!envUniforms.uMatTex.value) createMaterialTexture();
  ensureDefaultLight();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return { dadou: '', even: '' };
  }
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = false;
  const saved = {
    sky: envUniforms.uSkyAmb.value.clone(),
    lamp: envUniforms.uLampCol.value.clone(),
    fog: envUniforms.uFogDensity.value,
    night: envUniforms.uNight.value,
  };
  envUniforms.uSkyAmb.value.setRGB(0.42, 0.42, 0.48);
  envUniforms.uLampCol.value.setRGB(0.9, 0.55, 0.28);
  envUniforms.uFogDensity.value = 0;
  envUniforms.uNight.value = 0.6;
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffe2b8, 2.6);
  key.position.set(2, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9ab8ff, 1.2);
  rim.position.set(-3, 2, -2);
  scene.add(rim);
  const cr = new CharacterRenderer();
  scene.add(cr.group);
  const camera = new THREE.PerspectiveCamera(28, width / height, 0.05, 50);
  const out: Portraits = { dadou: '', even: '' };
  for (const slot of ['dadou', 'even'] as const) {
    const v: CharView = {
      id: slot === 'dadou' ? 60001 : 60002,
      kind: slot === 'dadou' ? CharKind.BOSS_DADOU : CharKind.BOSS_EVEN,
      faction: slot === 'dadou' ? 1 : 2,
      look: 1,
      gang: 0,
      custom: settings.custom[slot],
      x: 0,
      y: 0,
      z: 0,
      yaw: slot === 'dadou' ? 0.35 : -0.35,
      pitch: 0,
      vx: 0,
      vz: 0,
      anim: Anim.IDLE,
      aiming: false,
      weapon: Weapon.REVOLVER,
      shotAt: -10,
      hitAt: -10,
      meleeAt: -10,
      interactAt: -10,
      deathAt: -10,
    };
    // cadrage en pied, chapeau compris (le haut-de-forme d'Even dépasse 2 m)
    camera.position.set(slot === 'dadou' ? 0.5 : -0.5, 1.5, 3.85);
    camera.lookAt(0, 1.13, 0);
    for (let i = 0; i < 30; i++) cr.update([v], camera, 2 + i * 0.016, 0.016);
    renderer.render(scene, camera);
    out[slot] = canvas.toDataURL('image/png');
  }
  cr.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  envUniforms.uSkyAmb.value.copy(saved.sky);
  envUniforms.uLampCol.value.copy(saved.lamp);
  envUniforms.uFogDensity.value = saved.fog;
  envUniforms.uNight.value = saved.night;
  return out;
}
