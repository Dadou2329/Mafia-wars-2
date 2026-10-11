// Galerie des personnages (développement, route ?chars) : tenues, poses et armes de New York 2085.
//
// ?chars&scene=lineup|bosses|mafia|gangs|police|civ|weapons|turrets|strip · &row=N (une seule
// rangée) · &only=N (un seul personnage) · &pose=idle|walk|jog|run|aim|fire|throw|melee|hit|dead|
// sit|drive|cower|interact|side|back · &t=s (instant de l'animation après l'événement : lancer,
// coup, chute…) · &speed=m/s · &yaw=degrés · &pitch=rad (visée) · &weapon=N · &night (néons de nuit)
// · &muzzle (repères rouges sur les bouches de canon, vérifie muzzleOf) · &ao=N (occlusion du
// maillage). scene=strip : un personnage dans toutes les poses (&kind, &faction, &look, &weapon).
// Un personnage précis : ?chars&scene=one&kind=4&faction=0&look=401&gang=6&weapon=1. API de
// capture : window.__viewer (scene, pose, look, night, labels, render, stats).

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
  if (params.has('portraits')) {
    // portraits du salon et de l'interface (ui/portraits.ts), tels qu'affichés en jeu
    root.style.cssText = 'background:#14121a;display:flex;gap:16px;padding:16px;';
    void import('../ui/portraits').then(async (m) => {
      const p = await m.renderPortraits();
      for (const src of [p.dadou, p.even]) {
        const img = document.createElement('img');
        img.src = src;
        img.style.cssText = 'width:360px;height:480px;border:1px solid #444;';
        root.appendChild(img);
      }
      (window as unknown as { __viewer: object }).__viewer = { render: () => 0 };
    });
    return;
  }
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
  if (params.has('ao')) CharacterRenderer.aoKeep = Number(params.get('ao'));
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

  // scène « crowd » : foule de 150 personnages variés sur 100 m (niveaux de détail, coût)
  scenes.crowd = () => {
    const kinds = [CharKind.CIVILIAN, CharKind.CIVILIAN_F, CharKind.GANGSTER, CharKind.GANGSTER, CharKind.THUG, CharKind.POLICE, CharKind.LIEUTENANT, CharKind.CIVILIAN, CharKind.CIVILIAN_F];
    const out: Entry[][] = [];
    for (let r = 0; r < 15; r++) {
      const items: [string, CharKind, number, Partial<CharView>?][] = [];
      for (let c = 0; c < 10; c++) {
        const k = kinds[(r * 10 + c) % kinds.length];
        items.push(['', k, k === CharKind.GANGSTER || k === CharKind.LIEUTENANT ? 1 + ((r + c) & 1) : k === CharKind.POLICE ? 3 : 0, { look: 1000 + r * 31 + c * 7, gang: (r + c) % 7, weapon: [Weapon.FISTS, Weapon.PISTOL, Weapon.SMG, Weapon.FISTS][(r + c) % 4] }]);
      }
      out.push(row(items, -r * 7, 3.2));
    }
    return out;
  };

  // scène « strip » : un même personnage dans toutes les poses
  const POSES = ['idle', 'walk', 'jog', 'run', 'aim', 'fire', 'throw', 'melee', 'hit', 'dead', 'sit', 'drive', 'cower', 'interact'];
  scenes.strip = () => {
    const n = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
    const kind = n('kind', CharKind.BOSS_DADOU) as CharKind;
    const fac = n('faction', kind === CharKind.BOSS_EVEN ? 2 : 1);
    const list = (params.get('poses') ?? POSES.join(',')).split(',');
    return [
      row(
        list.map((p) => [p, kind, fac, { look: n('look', 1), gang: n('gang', 0), weapon: n('weapon', Weapon.PISTOL) as Weapon, pose: p }] as unknown as [string, CharKind, number, Partial<CharView>]),
        0,
        1.25,
      ),
    ];
  };

  let sceneName = params.get('scene') ?? 'lineup';
  let mode = params.get('pose') ?? 'idle';
  let rowSel = params.has('row') ? Number(params.get('row')) : -1;
  let onlySel = params.has('only') ? Number(params.get('only')) : -1;
  let entries: Entry[] = [];
  const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
  /** Événements de chaque personnage : instant (s) avant l'instant de rendu. */
  const events = new Map<number, { shot?: number; melee?: number; hit?: number; death?: number; interact?: number }>();
  /** Pose d'un personnage (vitesse, état, événements). */
  const applyPose = (v: CharView, pose: string) => {
    const t = num('t', -1);
    const ev: { shot?: number; melee?: number; hit?: number; death?: number; interact?: number } = {};
    switch (pose) {
      case 'walk':
        v.vz = num('speed', 1.5);
        v.anim = Anim.WALK;
        break;
      case 'jog':
        v.vz = num('speed', 4.2);
        v.anim = Anim.WALK;
        break;
      case 'run':
        v.vz = num('speed', 6.2);
        v.anim = Anim.RUN;
        break;
      case 'aim':
      case 'fire':
        v.aiming = true;
        v.pitch = num('pitch', 0.06);
        if (v.weapon === Weapon.FISTS || v.weapon === Weapon.KNIFE || v.weapon === Weapon.CLUB) v.weapon = Weapon.PISTOL;
        if (pose === 'fire') ev.shot = t >= 0 ? t : 0.04;
        break;
      case 'throw':
        if (v.weapon === Weapon.FISTS || v.weapon === Weapon.KNIFE || v.weapon === Weapon.CLUB) v.weapon = Weapon.PISTOL;
        ev.melee = t >= 0 ? t : 0.24;
        break;
      case 'melee':
        if (v.weapon !== Weapon.FISTS && v.weapon !== Weapon.KNIFE && v.weapon !== Weapon.CLUB) v.weapon = Weapon.CLUB;
        ev.melee = t >= 0 ? t : 0.14;
        break;
      case 'hit':
        ev.hit = t >= 0 ? t : 0.08;
        break;
      case 'dead':
        v.anim = Anim.DEAD;
        ev.death = t >= 0 ? t : 2.5;
        break;
      case 'sit':
        v.anim = Anim.SIT;
        break;
      case 'drive':
        v.anim = Anim.DRIVE;
        break;
      case 'cower':
        v.anim = Anim.COWER;
        break;
      case 'interact':
        ev.interact = t >= 0 ? t : 0.3;
        break;
      case 'side':
        v.yaw = Math.PI / 2;
        break;
      case 'back':
        v.yaw = Math.PI;
        break;
    }
    events.set(v.id, ev);
  };
  const build = () => {
    nextId = 1;
    events.clear();
    const rows = (scenes[sceneName] ?? scenes.lineup)();
    entries = rowSel >= 0 ? (rows[rowSel] ?? []).map((e) => ((e.view.z = 0), e)) : rows.flat();
    if (onlySel >= 0) entries = entries.slice(onlySel, onlySel + 1).map((e) => ((e.view.x = 0), e));
    const views = entries.map((e) => e.view);
    const yawDeg = params.has('yaw') ? (num('yaw', 0) * Math.PI) / 180 : null;
    for (const v of views) {
      if (params.has('weapon') && sceneName !== 'one' && sceneName !== 'strip') v.weapon = num('weapon', 0) as Weapon;
      if (yawDeg !== null) v.yaw += yawDeg;
      const own = (v as unknown as { pose?: string }).pose;
      applyPose(v, own ?? mode);
      // la vitesse est donnée vers l'avant (ou de côté avec &strafe) : on l'oriente selon le lacet
      const sp = v.vz;
      const dir = v.yaw + (params.has('strafe') ? Math.PI / 2 : params.has('backward') ? Math.PI : 0);
      v.vx = Math.sin(dir) * sp;
      v.vz = Math.cos(dir) * sp;
    }
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
    const dist = Math.max(onlySel >= 0 ? 3.4 : 3.2, (w / 2 / Math.tan(THREE.MathUtils.degToRad(20)) / camera.aspect) * 1.02) + depth * 0.35;
    camera.position.set((minX + maxX) / 2, 1.25 + depth * 0.75, dist);
    camera.lookAt((minX + maxX) / 2, onlySel >= 0 ? 0.95 : 0.85, -depth * 0.42);
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

  let clock = 1;
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
      // simule quelques images pour stabiliser l'animation ; les événements sont placés avant
      // l'instant de rendu
      const views = entries.map((e) => e.view);
      for (const v of views) {
        const ev = events.get(v.id);
        if (!ev) continue;
        if (ev.shot !== undefined) v.shotAt = time - ev.shot;
        if (ev.melee !== undefined) v.meleeAt = time - ev.melee;
        if (ev.hit !== undefined) v.hitAt = time - ev.hit;
        if (ev.death !== undefined) v.deathAt = time - ev.death;
        if (ev.interact !== undefined) v.interactAt = time - ev.interact;
      }
      for (let i = 39; i >= 0; i--) cr.update(views, camera, time - i * 0.016, 0.016);
      drawMuzzles();
      renderer.render(scene, camera);
      drawLabels();
      return { ...renderer.info.render, instances: cr.stats.instances, quads: cr.stats.quads, drawn: cr.stats.drawn };
    },
    /** Avance la simulation de `sec` secondes (images de 1/60 s) puis dessine (séquences animées). */
    step(sec = 1 / 60) {
      const views = entries.map((e) => e.view);
      const n = Math.max(1, Math.round(sec * 60));
      for (let i = 0; i < n; i++) {
        clock += 1 / 60;
        cr.update(views, camera, clock, 1 / 60);
      }
      drawMuzzles();
      renderer.render(scene, camera);
      drawLabels();
      return { quads: cr.stats.quads, clock };
    },
    /** Membres dessinés à un niveau de détail (0 près, 1 moyen, 2 loin). */
    keys(tier = 1) {
      return cr.keysInUse(tier);
    },
    /** Statistiques du rendu des personnages (quads, instances). */
    stats() {
      return { ...cr.stats };
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
