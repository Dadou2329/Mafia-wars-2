// Visionneuse de développement : affiche la ville avec une caméra libre (utilisée pour les captures).
import * as THREE from 'three';
import { generateCity } from '../../shared/city/gen/city';
import { computeTintVolume } from '../render/lightVolume';
import { createMaterialTexture, createTintTexture } from '../render/env';
import { lightDims } from '../render/lightService';
import { LightStream } from '../render/lightStream';
import { WorkerLightFeed } from '../world/lightFeed';
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
  createMaterialTexture();
  createTintTexture(computeTintVolume(city.world, city.ctx.lights));
  const t2 = performance.now();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  root.appendChild(renderer.domElement);
  // éclairage en tuiles, comme en jeu (worker d'éclairage, fenêtre fine autour de la caméra)
  const w = city.world;
  const light = new LightStream(new WorkerLightFeed(lightDims(w), [w.sx, w.sy, w.sz], w.exportChunks(), city.ctx.lights), renderer);
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
    /** Attend que l'éclairage fin entoure la caméra (à appeler avant une capture). */
    async settle(maxMs = 60000): Promise<boolean> {
      const until = performance.now() + maxMs;
      while (performance.now() < until) {
        light.update(camera.position.x, camera.position.z);
        if (light.complete) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    },
    render() {
      light.update(camera.position.x, camera.position.z);
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
