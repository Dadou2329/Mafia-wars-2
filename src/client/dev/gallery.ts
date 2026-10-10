// Galerie de développement : affiche tous les modèles d'accessoires sur une grille.
import * as THREE from 'three';
import { PROP_KINDS, PROP_DEFS, type PropKind } from '../../shared/city/props';
import { propModelEntry, hasRealModel } from '../models/props';
import { meshModel } from '../models/modelMesher';
import { createObjectMaterial } from '../render/voxelObjectMaterial';
import { envUniforms, createMaterialTexture } from '../render/env';

export function startGallery(root: HTMLElement): void {
  createMaterialTexture();
  // volume d'éclairage minimal : ciel partout, lampes moyennes
  const data = new Uint8Array(2 * 2 * 2 * 2).fill(200);
  const tex = new THREE.Data3DTexture(data, 2, 2, 2);
  tex.format = THREE.RGFormat;
  tex.needsUpdate = true;
  envUniforms.uLightTex.value = tex;
  envUniforms.uLightOrigin.value.set(-1000, -1000, -1000);
  envUniforms.uLightSize.value.set(2000, 2000, 2000);
  envUniforms.uSkyAmb.value.setRGB(0.45, 0.47, 0.52);
  envUniforms.uLampCol.value.setRGB(0.5, 0.35, 0.2);
  envUniforms.uNight.value = 0.6;
  envUniforms.uFogDensity.value = 0;
  envUniforms.uFogColor.value.setRGB(0.2, 0.2, 0.22);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  root.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x3a3632);
  const sun = new THREE.DirectionalLight(0xfff0e0, 2.2);
  sun.position.set(30, 50, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 200 });
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0x5a5550 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const mat = createObjectMaterial();
  const params = new URLSearchParams(location.search);
  const filter = params.get('only');
  const kinds = PROP_KINDS.filter((k) => (filter ? filter.split(',').includes(k) : true));
  const cols = Math.ceil(Math.sqrt(kinds.length * 1.6));
  const spacing = 3.4;
  const labels: { kind: PropKind; pos: THREE.Vector3 }[] = [];
  kinds.forEach((kind, i) => {
    const e = propModelEntry(kind);
    const nv = Math.min(e.variants, 3);
    for (let v = 0; v < nv; v++) {
      const geo = meshModel(e.make(v));
      const mesh = new THREE.Mesh(geo, mat);
      const cx = (i % cols) * spacing;
      const cz = Math.floor(i / cols) * spacing;
      mesh.position.set(cx + (v - (nv - 1) / 2) * 1.0 * (PROP_DEFS[kind].size[0] < 1 ? 1 : 0.0), 0, cz + v * (PROP_DEFS[kind].size[0] >= 1 ? 1.2 : 0));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    labels.push({ kind, pos: new THREE.Vector3((i % cols) * spacing, 0, Math.floor(i / cols) * spacing) });
  });
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
  const rows = Math.ceil(kinds.length / cols);
  const center = new THREE.Vector3(((cols - 1) * spacing) / 2, 0, ((rows - 1) * spacing) / 2);
  const dist = Math.max(cols, rows) * spacing * 0.9;
  camera.position.set(center.x, dist * 0.75, center.z + dist * 0.8);
  camera.lookAt(center);
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:11px monospace;color:#fff;';
  root.appendChild(overlay);
  const api = {
    look(px: number, py: number, pz: number, tx: number, ty: number, tz: number) {
      camera.position.set(px, py, pz);
      camera.lookAt(tx, ty, tz);
    },
    render() {
      renderer.render(scene, camera);
      overlay.innerHTML = '';
      for (const l of labels) {
        const p = l.pos.clone().project(camera);
        if (p.z > 1) continue;
        const d = document.createElement('div');
        d.textContent = l.kind + (hasRealModel(l.kind) ? '' : ' (?)');
        d.style.cssText = `position:absolute;left:${((p.x + 1) / 2) * window.innerWidth}px;top:${((1 - p.y) / 2) * window.innerHeight + 8}px;transform:translateX(-50%);text-shadow:0 0 3px #000;`;
        overlay.appendChild(d);
      }
      return renderer.info.render;
    },
    setTime() {},
  };
  (window as unknown as { __viewer: typeof api }).__viewer = api;
  api.render();
}
