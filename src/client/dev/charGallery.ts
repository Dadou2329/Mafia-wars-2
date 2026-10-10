// Galerie des personnages (développement) : poses et tenues.
import * as THREE from 'three';
import { Anim, CharKind, Weapon } from '../../shared/characters';
import { CharacterRenderer, type CharView } from '../characters/characterRenderer';
import { envUniforms, createMaterialTexture } from '../render/env';

export function startCharGallery(root: HTMLElement): void {
  createMaterialTexture();
  const data = new Uint8Array(16).fill(190);
  const tex = new THREE.Data3DTexture(data, 2, 2, 2);
  tex.format = THREE.RGFormat;
  tex.needsUpdate = true;
  envUniforms.uLightTex.value = tex;
  envUniforms.uLightOrigin.value.set(-1000, -1000, -1000);
  envUniforms.uLightSize.value.set(2000, 2000, 2000);
  envUniforms.uSkyAmb.value.setRGB(0.5, 0.52, 0.58);
  envUniforms.uLampCol.value.setRGB(0.45, 0.32, 0.2);
  envUniforms.uFogDensity.value = 0;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  root.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x3d3934);
  const sun = new THREE.DirectionalLight(0xfff0e0, 2.4);
  sun.position.set(6, 12, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, far: 60 });
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: 0x5e5852 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const cr = new CharacterRenderer();
  scene.add(cr.group);
  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 200);
  camera.position.set(0, 1.6, 7.5);
  camera.lookAt(0, 1.0, 0);
  const base = (id: number, kind: CharKind, faction: number, x: number, z: number, extra: Partial<CharView> = {}): CharView => ({
    id, kind, faction, look: id * 13 + 5, gang: 2, x, y: 0, z, yaw: 0, pitch: 0, vx: 0, vz: 0, anim: Anim.IDLE,
    aiming: false, weapon: Weapon.REVOLVER, shotAt: -10, hitAt: -10, meleeAt: -10, interactAt: -10, deathAt: -10, ...extra,
  });
  const scene1 = (): CharView[] => [
    base(1, CharKind.BOSS_DADOU, 1, -3.0, 0),
    base(2, CharKind.BOSS_EVEN, 2, -1.8, 0),
    base(3, CharKind.GANGSTER, 1, -0.6, 0, { weapon: Weapon.CLUB }),
    base(4, CharKind.GANGSTER, 2, 0.6, 0, { weapon: Weapon.SHOTGUN }),
    base(5, CharKind.LIEUTENANT, 1, 1.8, 0),
    base(6, CharKind.POLICE, 3, 3.0, 0, { weapon: Weapon.CLUB }),
    base(7, CharKind.THUG, 0, -2.4, -1.6, { weapon: Weapon.KNIFE }),
    base(8, CharKind.CIVILIAN, 0, -1.2, -1.6, { weapon: Weapon.FISTS }),
    base(9, CharKind.CIVILIAN_F, 0, 0, -1.6, { weapon: Weapon.FISTS }),
    base(10, CharKind.CIVILIAN, 0, 1.2, -1.6, { weapon: Weapon.FISTS, look: 77 }),
    base(11, CharKind.LIEUTENANT, 2, 2.4, -1.6, { weapon: Weapon.RIFLE }),
  ];
  let views = scene1();
  const api = {
    t: 0,
    look(px: number, py: number, pz: number, tx: number, ty: number, tz: number) {
      camera.position.set(px, py, pz);
      camera.lookAt(tx, ty, tz);
    },
    pose(mode: string) {
      views = scene1();
      if (mode === 'walk') views.forEach((v, i) => { v.vz = 1.4; v.anim = Anim.WALK; v.yaw = 0; api.t = 0.31 * (i + 1); });
      if (mode === 'run') views.forEach((v) => { v.vz = 5.5; v.anim = Anim.RUN; });
      if (mode === 'aim') views.forEach((v, i) => { v.aiming = true; v.weapon = [Weapon.REVOLVER, Weapon.RIFLE, Weapon.SHOTGUN][i % 3]; v.pitch = 0.1; });
      if (mode === 'dead') views.forEach((v) => { v.anim = Anim.DEAD; v.deathAt = 0; });
      if (mode === 'side') views.forEach((v) => { v.yaw = Math.PI / 2; });
      if (mode === 'back') views.forEach((v) => { v.yaw = Math.PI; });
    },
    render(time = 0.8) {
      // simule quelques images pour stabiliser l'animation
      for (let i = 0; i < 40; i++) cr.update(views, camera, time + i * 0.016, 0.016);
      renderer.render(scene, camera);
      return renderer.info.render;
    },
    setTime() {},
  };
  (window as unknown as { __viewer: typeof api }).__viewer = api;
  api.render();
}
