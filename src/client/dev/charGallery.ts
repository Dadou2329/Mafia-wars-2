// Galerie des personnages (développement, route ?chars) : tenues, poses et armes de New York 2085.
//
// ?chars&scene=lineup|bosses|mafia|gangs|police|civ|weapons|turrets · &row=N (une seule rangée)
// · &only=N (un seul personnage) · &pose=walk|run|aim|fire|dead|side|back|sit|drive · &night (néons de
// nuit) · &muzzle (repères rouges sur les bouches de canon, vérifie muzzleOf). Un personnage
// précis : ?chars&scene=one&kind=4&faction=0&look=401&gang=6&weapon=1. API de capture :
// window.__viewer (scene, pose, look, night, labels, render).

import * as THREE from 'three';
import { Anim, CharKind, Weapon } from '../../shared/characters';
import { CharacterRenderer, type CharView } from '../characters/characterRenderer';
import type { BossCustom } from '../characters/styles';
import { envUniforms, createMaterialTexture } from '../render/env';

const GANG_NAMES = ['Lions de Lenox', 'Garde Sterling', 'Néons de Broadway', 'Triade du Jade', 'Sécurité Axiom', 'Rouleurs de Flushing', 'Corbeaux de Red Hook'];
const WEAPON_LABEL: Record<number, string> = {
  [Weapon.FISTS]: 'Poings',
  [Weapon.PISTOL]: 'Vektor',
  [Weapon.SMG]: 'Wasp',
  [Weapon.SHOTGUN]: 'Hammer',
  [Weapon.RIFLE]: 'Longbow',
  [Weapon.KNIFE]: 'Lame thermique',
  [Weapon.CLUB]: 'Matraque',
};

interface Entry {
  view: CharView;
  label: string;
}

export function startCharGallery(root: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  createMaterialTexture();
  const data = new Uint8Array(16).fill(190);
  const tex = new THREE.Data3DTexture(data, 2, 2, 2);
  tex.format = THREE.RGFormat;
  tex.needsUpdate = true;
  envUniforms.uLightTex.value = tex;
  envUniforms.uLightOrigin.value.set(-1000, -1000, -1000);
  envUniforms.uLightSize.value.set(2000, 2000, 2000);
  envUniforms.uFogDensity.value = 0;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  root.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xfff0e0, 2.4);
  sun.position.set(6, 12, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, far: 60 });
  scene.add(sun);
  const floorMat = new THREE.MeshLambertMaterial({ color: 0x4e4c50 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const cr = new CharacterRenderer();
  scene.add(cr.group);
  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 200);

  const setNight = (night: boolean) => {
    envUniforms.uNight.value = night ? 1 : 0.15;
    envUniforms.uSkyAmb.value.setRGB(0.5, 0.52, 0.58).multiplyScalar(night ? 0.35 : 1);
    envUniforms.uLampCol.value.setRGB(0.45, 0.32, 0.2);
    sun.intensity = night ? 0.35 : 2.4;
    scene.background = new THREE.Color(night ? 0x0c0f18 : 0x3d3a40);
    floorMat.color.setHex(night ? 0x1c1c22 : 0x4e4c50);
  };
  setNight(params.has('night'));

  let nextId = 1;
  const mk = (kind: CharKind, faction: number, x: number, z: number, extra: Partial<CharView> = {}): CharView => ({
    id: nextId++,
    kind,
    faction,
    look: 11 + nextId * 37,
    gang: 0,
    x,
    y: 0,
    z,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vz: 0,
    anim: Anim.IDLE,
    aiming: false,
    weapon: Weapon.FISTS,
    shotAt: -10,
    hitAt: -10,
    meleeAt: -10,
    interactAt: -10,
    deathAt: -10,
    ...extra,
  });
  /** Range une liste d'entrées sur une ligne centrée en x (pas `dx`), à la profondeur z. */
  const row = (items: [string, CharKind, number, Partial<CharView>?][], z: number, dx = 1.2): Entry[] =>
    items.map(([label, kind, faction, extra], i) => ({ label, view: mk(kind, faction, (i - (items.length - 1) / 2) * dx, z, extra) }));

  const dadouCustom: BossCustom = { hat: 'fedora', coat: 0x4a1820, vest: 0x161418, tie: 0xd4a640, hatband: 0xd4a640 };
  const evenCustom: BossCustom = { hat: 'flatcap', coat: 0x2b2b31, vest: 0x2f4a3a, tie: 0x1d3461, hatband: 0xc9d1dc };
  const scenes: Record<string, () => Entry[][]> = {
    lineup: () => [
      row(
        [
          ['Dadou', CharKind.BOSS_DADOU, 1, { weapon: Weapon.PISTOL }],
          ['Even', CharKind.BOSS_EVEN, 2, { weapon: Weapon.PISTOL }],
          ['Gino', CharKind.BARMAN, 1],
          ['Nina', CharKind.BARMAN, 2],
          ['NYPD', CharKind.POLICE, 3, { weapon: Weapon.PISTOL, look: 4 }],
          ['NYPD', CharKind.POLICE, 3, { weapon: Weapon.CLUB, look: 9 }],
          ['Lieutenant', CharKind.LIEUTENANT, 1, { weapon: Weapon.SMG, look: 5 }],
          ['Lieutenant', CharKind.LIEUTENANT, 2, { weapon: Weapon.SHOTGUN, look: 8 }],
        ],
        0,
      ),
      row(
        GANG_NAMES.map((n, g) => [n, CharKind.THUG, 0, { gang: g, look: 3 + g * 5, weapon: [Weapon.PISTOL, Weapon.SMG, Weapon.KNIFE, Weapon.CLUB][g % 4] }] as [string, CharKind, number, Partial<CharView>]),
        -2.2,
      ),
      row(
        [0, 1, 2, 3, 4].map((k) => ['Homme de Dadou', CharKind.GANGSTER, 1, { look: 20 + k * 7, weapon: [Weapon.PISTOL, Weapon.SMG, Weapon.SHOTGUN, Weapon.FISTS, Weapon.RIFLE][k] }] as [string, CharKind, number, Partial<CharView>]).concat(
          [0, 1, 2, 3, 4].map((k) => ['Homme d’Even', CharKind.GANGSTER, 2, { look: 60 + k * 7, weapon: [Weapon.PISTOL, Weapon.SMG, Weapon.SHOTGUN, Weapon.FISTS, Weapon.RIFLE][k] }] as [string, CharKind, number, Partial<CharView>]),
        ),
        -4.4,
      ),
    ],
    bosses: () => [
      row(
        [
          ['Dadou (melon)', CharKind.BOSS_DADOU, 1, { weapon: Weapon.PISTOL }],
          ['Dadou (feutre)', CharKind.BOSS_DADOU, 1, { custom: dadouCustom, weapon: Weapon.SMG }],
          ['Dadou (haut-de-forme)', CharKind.BOSS_DADOU, 1, { custom: { hat: 'top' } }],
          ['Dadou (casquette)', CharKind.BOSS_DADOU, 1, { custom: { hat: 'flatcap', coat: 0x3e2c22 } }],
          ['Even (haut-de-forme)', CharKind.BOSS_EVEN, 2, { weapon: Weapon.PISTOL }],
          ['Even (casquette)', CharKind.BOSS_EVEN, 2, { custom: evenCustom, weapon: Weapon.RIFLE }],
          ['Even (melon)', CharKind.BOSS_EVEN, 2, { custom: { hat: 'bowler' } }],
          ['Even (feutre)', CharKind.BOSS_EVEN, 2, { custom: { hat: 'fedora', coat: 0x55606c, tie: 0x2e6a46 } }],
        ],
        0,
      ),
    ],
    mafia: () => [
      row(Array.from({ length: 8 }, (_, k) => ['Dadou', CharKind.GANGSTER, 1, { look: 100 + k * 13 }] as [string, CharKind, number, Partial<CharView>]), 0),
      row(Array.from({ length: 8 }, (_, k) => ['Even', CharKind.GANGSTER, 2, { look: 200 + k * 13 }] as [string, CharKind, number, Partial<CharView>]), -2),
      row(
        Array.from({ length: 8 }, (_, k) => ['Lieutenant', CharKind.LIEUTENANT, k < 4 ? 1 : 2, { look: 300 + k * 17 }] as [string, CharKind, number, Partial<CharView>]),
        -4,
      ),
    ],
    gangs: () =>
      GANG_NAMES.map((n, g) =>
        row(
          [0, 1, 2, 3].map((k) => [k === 0 ? n : '', CharKind.THUG, 0, { gang: g, look: 400 + g * 31 + k * 7 }] as [string, CharKind, number, Partial<CharView>]),
          -g * 1.6,
          1.0,
        ),
      ),
    police: () => [
      row(Array.from({ length: 8 }, (_, k) => ['NYPD', CharKind.POLICE, 3, { look: 500 + k * 11, weapon: k % 2 ? Weapon.CLUB : Weapon.PISTOL }] as [string, CharKind, number, Partial<CharView>]), 0),
      row(
        [
          ['Gino le Rabatteur', CharKind.BARMAN, 1],
          ['Nina la Recruteuse', CharKind.BARMAN, 2],
          ['Tourelle (Dadou)', CharKind.TURRET, 1],
          ['Tourelle (Even)', CharKind.TURRET, 2],
          ['Tourelle (neutre)', CharKind.TURRET, 0],
        ],
        -2.2,
        1.5,
      ),
    ],
    civ: () => [
      row(Array.from({ length: 9 }, (_, k) => ['', CharKind.CIVILIAN, 0, { look: 600 + k * 19 }] as [string, CharKind, number, Partial<CharView>]), 0, 1.1),
      row(Array.from({ length: 9 }, (_, k) => ['', CharKind.CIVILIAN_F, 0, { look: 700 + k * 23 }] as [string, CharKind, number, Partial<CharView>]), -2, 1.1),
      row(Array.from({ length: 9 }, (_, k) => ['', k % 2 ? CharKind.CIVILIAN_F : CharKind.CIVILIAN, 0, { look: 800 + k * 29 }] as [string, CharKind, number, Partial<CharView>]), -4, 1.1),
    ],
    weapons: () => [
      row(
        [Weapon.FISTS, Weapon.PISTOL, Weapon.SMG, Weapon.SHOTGUN, Weapon.RIFLE, Weapon.KNIFE, Weapon.CLUB].map(
          (w) => [WEAPON_LABEL[w], CharKind.GANGSTER, 1, { weapon: w, aiming: true, pitch: 0.05, look: 31 }] as [string, CharKind, number, Partial<CharView>],
        ),
        0,
        1.3,
      ),
      row(
        [Weapon.FISTS, Weapon.PISTOL, Weapon.SMG, Weapon.SHOTGUN, Weapon.RIFLE, Weapon.KNIFE, Weapon.CLUB].map(
          (w) => [WEAPON_LABEL[w], CharKind.GANGSTER, 2, { weapon: w, look: 77 }] as [string, CharKind, number, Partial<CharView>],
        ),
        -2.2,
        1.3,
      ),
    ],
    one: () => {
      const n = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
      const kinds = ['Dadou', 'Even', 'Gangster', 'Lieutenant', 'Voyou', 'NYPD', 'Civil', 'Civile', 'Rabatteur', 'Tourelle'];
      const kind = n('kind', CharKind.CIVILIAN) as CharKind;
      return [
        row(
          [-1, 0, 1].map(
            (o) =>
              [`${kinds[kind] ?? kind} n° ${n('look', 1) + o}`, kind, n('faction', 0), { look: n('look', 1) + o, gang: n('gang', 0), weapon: n('weapon', Weapon.FISTS) as Weapon }] as [
                string,
                CharKind,
                number,
                Partial<CharView>,
              ],
          ),
          0,
          1.1,
        ),
      ];
    },
    turrets: () => [
      row(
        [
          ['Tourelle (Dadou)', CharKind.TURRET, 1, { yaw: 0.6, pitch: 0.15 }],
          ['Tourelle (Even)', CharKind.TURRET, 2, { yaw: -0.4, pitch: -0.2 }],
          ['Tourelle (neutre)', CharKind.TURRET, 0, { yaw: 0, pitch: 0.4 }],
          ['Tourelle détruite', CharKind.TURRET, 1, { anim: Anim.DEAD, deathAt: 0 }],
        ],
        0,
        1.6,
      ),
    ],
  };

  let sceneName = params.get('scene') ?? 'lineup';
  let mode = params.get('pose') ?? 'idle';
  let rowSel = params.has('row') ? Number(params.get('row')) : -1;
  let onlySel = params.has('only') ? Number(params.get('only')) : -1;
  let entries: Entry[] = [];
  const build = () => {
    nextId = 1;
    const rows = (scenes[sceneName] ?? scenes.lineup)();
    entries = rowSel >= 0 ? (rows[rowSel] ?? []).map((e) => ((e.view.z = 0), e)) : rows.flat();
    if (onlySel >= 0) entries = entries.slice(onlySel, onlySel + 1).map((e) => ((e.view.x = 0), e));
    const views = entries.map((e) => e.view);
    if (mode === 'walk') views.forEach((v) => ((v.vz = 1.4), (v.anim = Anim.WALK)));
    if (mode === 'run') views.forEach((v) => ((v.vz = 5.5), (v.anim = Anim.RUN)));
    if (mode === 'aim')
      views.forEach((v) => {
        v.aiming = true;
        v.pitch = 0.08;
        if (v.weapon === Weapon.FISTS && v.kind !== CharKind.TURRET) v.weapon = Weapon.PISTOL;
      });
    if (mode === 'fire') views.forEach((v) => ((v.aiming = true), (v.shotAt = 0.75)));
    if (mode === 'dead') views.forEach((v) => ((v.anim = Anim.DEAD), (v.deathAt = 0)));
    if (mode === 'sit') views.forEach((v) => (v.anim = Anim.SIT));
    if (mode === 'drive') views.forEach((v) => (v.anim = Anim.DRIVE));
    if (mode === 'side') views.forEach((v) => (v.yaw = Math.PI / 2));
    if (mode === 'back') views.forEach((v) => (v.yaw = Math.PI));
    // cadrage par défaut : toute la scène
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    for (const v of views) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minZ = Math.min(minZ, v.z);
    }
    const w = maxX - minX + 1.1;
    const depth = -minZ;
    const dist = Math.max(onlySel >= 0 ? 2.3 : 3.2, (w / 2 / Math.tan(THREE.MathUtils.degToRad(20)) / camera.aspect) * 1.02) + depth * 0.35;
    camera.position.set((minX + maxX) / 2, 1.25 + depth * 0.75, dist);
    camera.lookAt((minX + maxX) / 2, 0.85, -depth * 0.42);
    camera.updateMatrixWorld();
  };

  // repères des bouches de canon (origine des traçantes)
  const markers: THREE.Mesh[] = [];
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xff2020, depthTest: false });
  const showMuzzles = params.has('muzzle');
  const drawMuzzles = () => {
    if (!showMuzzles) return;
    entries.forEach((e, i) => {
      if (!markers[i]) {
        markers[i] = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), markerMat);
        markers[i].renderOrder = 10;
        scene.add(markers[i]);
      }
      const m = cr.muzzleOf(e.view.id);
      markers[i].visible = !!m;
      if (m) markers[i].position.copy(m);
    });
  };

  const labelBox = document.createElement('div');
  labelBox.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:11px/1.2 sans-serif;color:#fff;text-shadow:0 0 3px #000,0 0 2px #000;';
  root.appendChild(labelBox);
  let showLabels = !params.has('nolabels');
  const drawLabels = () => {
    labelBox.innerHTML = '';
    if (!showLabels) return;
    const v = new THREE.Vector3();
    for (const e of entries) {
      if (!e.label) continue;
      const h = cr.heads.get(e.view.id);
      if (!h) continue;
      v.copy(h).add(new THREE.Vector3(0, 0.32, 0)).project(camera);
      if (v.z > 1) continue;
      const d = document.createElement('div');
      d.textContent = e.label;
      d.style.cssText = `position:absolute;left:${((v.x + 1) / 2) * window.innerWidth}px;top:${((1 - v.y) / 2) * window.innerHeight}px;transform:translate(-50%,-100%);white-space:nowrap;`;
      labelBox.appendChild(d);
    }
  };

  const api = {
    t: 0,
    scene(name: string, row = -1, only = -1) {
      sceneName = name;
      rowSel = row;
      onlySel = only;
      build();
    },
    look(px: number, py: number, pz: number, tx: number, ty: number, tz: number) {
      camera.position.set(px, py, pz);
      camera.lookAt(tx, ty, tz);
      camera.updateMatrixWorld();
    },
    pose(m: string) {
      mode = m;
      build();
    },
    night(on: boolean) {
      setNight(on);
    },
    labels(on: boolean) {
      showLabels = on;
    },
    render(time = 0.8) {
      // simule quelques images pour stabiliser l'animation
      const views = entries.map((e) => e.view);
      for (let i = 0; i < 40; i++) cr.update(views, camera, time + i * 0.016, 0.016);
      drawMuzzles();
      renderer.render(scene, camera);
      drawLabels();
      return { ...renderer.info.render, instances: cr.stats.instances };
    },
    setTime() {},
  };
  (window as unknown as { __viewer: typeof api }).__viewer = api;
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    api.render();
  });
  build();
  api.render();
}
