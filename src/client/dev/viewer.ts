// Visionneuse de développement : affiche la ville avec une caméra libre (utilisée pour les captures).
import * as THREE from 'three';
import { generateCity } from '../../shared/city/gen/city';
import { computeLightVolume } from '../render/lightVolume';
import { createLightTexture, createMaterialTexture } from '../render/env';
import { createWorldMaterial } from '../render/worldMaterial';
import { buildWorldMeshes } from '../render/worldMesh';
import { Atmosphere } from '../render/atmosphere';
import { createWater } from '../render/water';
import { createOuterGround } from '../render/outer';
import { PropRenderer } from '../render/propRenderer';

export async function startViewer(root: HTMLElement): Promise<void> {
  const t0 = performance.now();
  const city = generateCity();
  const t1 = performance.now();
  const lv = computeLightVolume(city.world, city.ctx.lights);
  const t2 = performance.now();
  createMaterialTexture();
  createLightTexture(lv);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  root.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 600);
  const mat = createWorldMaterial();
  const { group, stats } = buildWorldMeshes(city.world, mat);
  scene.add(group);
  const atmo = new Atmosphere(scene, 2048);
  const water = createWater();
  scene.add(water.mesh);
  scene.add(createOuterGround());
  const props = new PropRenderer(city.ctx.props, city.buildings);
  scene.add(props.group);
  for (const b of city.buildings) props.setOwner(b.id, b.def.startOwner === 1 ? 1 : b.def.startOwner === 2 ? 2 : 0);
  const info = { propStats: props.stats, gen: t1 - t0, light: t2 - t1, mesh: stats.ms, quads: stats.quads, regions: stats.regions, props: city.ctx.props.length };
  console.log('viewer stats', JSON.stringify(info));
  const target = new THREE.Vector3(37, 2, 30);
  camera.position.set(20, 6, 50);
  const api = {
    info,
    setTime(t: number) { atmo.time = t; },
    look(px: number, py: number, pz: number, tx: number, ty: number, tz: number) {
      camera.position.set(px, py, pz);
      target.set(tx, ty, tz);
      camera.lookAt(target);
    },
    render() {
      props.update(camera.position, true);
      atmo.update(0, performance.now() / 1000, target, camera);
      const wm = water.mat.uniforms;
      wm.uSkyTop.value.copy(atmo.skyMat.uniforms.uZenith.value);
      wm.uSkyHorizon.value.copy(atmo.skyMat.uniforms.uHorizon.value);
      renderer.render(scene, camera);
      return renderer.info.render;
    },
  };
  (window as unknown as { __viewer: typeof api }).__viewer = api;
  camera.lookAt(target);
  const loop = () => {
    api.render();
    requestAnimationFrame(loop);
  };
  if (!new URLSearchParams(location.search).has('still')) loop();
  else api.render();
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
