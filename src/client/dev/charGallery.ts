// Galerie des personnages (développement, route ?chars) : tenues, poses et armes de New York 2085.
//
// ?chars&scene=lineup|bosses|mafia|gangs|police|civ|weapons|turrets|strip|cyber|cyberarms|
// cyberlegs|cyberposes|cybergestures · &row=N (une seule rangée) · &only=N (un seul personnage) ·
// &pose=idle|walk|jog|run|aim|fire|throw|melee|hit|dead|sit|drive|cower|interact|side|back|
// crouch|crouchwalk|slide|dash|wallrunL|wallrunR|grapple|air|airjump|land|climb|leap|launch|
// slam|stun|shock (déplacements augmentés) · shield|repulse|choc|rockets|hack|grapplefire|
// armpistol|armfire|armblade|armslash|armfist|armpunch|charge|armwhip|whip (gestes des implants)
// · &t=s (instant de l'animation après l'événement : lancer, coup, chute, capacité…) ·
// &speed=m/s · &yaw=degrés · &pitch=rad (visée) · &weapon=N · &night (néons de nuit) · &muzzle
// (repères rouges sur les bouches de canon, vérifie muzzleOf) · &ao=N (occlusion du maillage).
// Implants : &cyber=brasD=pistoletBras:3,brasG=grappin:5,jambes1=saut:2 (apparence publique,
// « emplacement=identifiant:niveau ») ou &preset=combat|mobilite|infiltration|tout|dadou|even|
// bras|jambes|torse|tete|peau ; &fx=bouclier,camo,armL,armR,charge,reflex,surcharge,sprint,
// secondsouffle,scan,grappin… (ou un nombre : bits CFX) ; &ab=roquettes&abside=L&abt=0.4
// (capacité ponctuelle) ; &vision=thermal|night ; &xray (silhouettes à travers un mur) ;
// &hl=brasG|jambes1|… (surbrillance d'un emplacement, comme l'écran d'équipement).
// scene=strip : un personnage dans toutes les poses (&kind, &faction, &look, &weapon, &poses=a,b).
// Un personnage précis : ?chars&scene=one&kind=4&faction=0&look=401&gang=6&weapon=1. API de
// capture : window.__viewer (scene, pose, look, night, labels, render, stats, cyber, fx, vision).

import * as THREE from 'three';
import { Anim, CharKind, Weapon } from '../../shared/characters';
import { CFX } from '../../shared/implants';
import { CharacterRenderer, type CharView } from '../characters/characterRenderer';
import { createCharMaterial, CyberShaderData } from '../characters/charMaterial';
import { meshChar } from '../characters/charMesher';
import { buildPart } from '../characters/parts';
import { appearanceFor, extendedColors, OUTFIT_ORDER, type BossCustom } from '../characters/styles';
import { paletteData, paletteTexture } from '../render/voxelObjectMaterial';
import { envUniforms, createMaterialTexture } from '../render/env';

const GANG_NAMES = ['Lions de Lenox', 'Garde Sterling', 'Néons de Broadway', 'Triade du Jade', 'Sécurité Axiom', 'Rouleurs de Ditmars', 'Corbeaux de Bushwick'];
const WEAPON_LABEL: Record<number, string> = {
  [Weapon.FISTS]: 'Poings',
  [Weapon.PISTOL]: 'Vektor',
  [Weapon.SMG]: 'Wasp',
  [Weapon.SHOTGUN]: 'Hammer',
  [Weapon.RIFLE]: 'Longbow',
  [Weapon.KNIFE]: 'Lame thermique',
  [Weapon.CLUB]: 'Matraque',
  [Weapon.ARM_PISTOL]: 'Viper',
  [Weapon.ARM_BLADE]: 'Mantis',
  [Weapon.ARM_FIST]: 'Poing hydraulique',
  [Weapon.ARM_WHIP]: 'Fouet',
};

/** Configurations d'implants toutes prêtes (apparence publique). */
export const CYBER_PRESETS: Record<string, string[]> = {
  combat: ['brasG=bouclier:3', 'brasD=pistoletBras:4', 'jambes1=amortisseurs:2', 'jambes2=sprint:3', 'torse1=surcharge:2', 'torse2=blindage:4', 'colonne=reflexesMoteurs:2', 'yeux1=marqueur:2', 'neural1=visee:3', 'neural2=reflexes:2'],
  mobilite: ['brasG=grappin:5', 'brasD=lame:3', 'jambes1=saut:3', 'jambes2=doubleSaut:2', 'jambes3=courseMurale:2', 'torse1=accumulateur:2', 'colonne=gyro:3', 'yeux1=zoom:2', 'neural1=coprocesseur:2'],
  infiltration: ['brasG=outils:3', 'brasD=fouet:2', 'jambes1=silence:3', 'jambes2=glissade:2', 'jambes3=esquive:3', 'torse1=nanobots:2', 'colonne=vertebres:2', 'yeux1=nocturne:2', 'yeux2=scanner:2', 'peau=camouflage:2', 'neural1=conscience:2'],
  tout: [
    'brasG=roquettes:3',
    'brasD=poing:5',
    'jambes1=bond:3',
    'jambes2=esquive:4',
    'jambes3=sautMural:2',
    'torse1=secondSouffle:2',
    'torse2=antichoc:3',
    'colonne=treuil:3',
    'yeux1=thermique:3',
    'yeux2=analyseur:2',
    'peau=derme:3',
    'neural1=liaisonDrone:2',
    'neural2=commandement:3',
  ],
  dadou: ['brasG=grappin:3', 'brasD=pistoletBras:5', 'jambes1=saut:3', 'jambes2=glissade:2', 'torse1=secondSouffle:2', 'colonne=treuil:2', 'yeux1=thermique:2', 'neural1=reflexes:3'],
  even: ['brasG=bouclier:4', 'brasD=choc:3', 'jambes1=amortisseurs:3', 'jambes2=courseMurale:2', 'torse1=surcharge:3', 'colonne=gyro:2', 'yeux1=analyseur:3', 'neural1=commandement:3', 'peau=isolant:2'],
  bras: ['brasG=grappin:4', 'brasD=pistoletBras:4'],
  jambes: ['jambes1=saut:3', 'jambes2=sprint:3', 'jambes3=esquive:3'],
  torse: ['torse1=surcharge:3', 'torse2=accumulateur:2', 'colonne=vertebres:3'],
  tete: ['yeux1=zoom:3', 'yeux2=scanner:2', 'neural1=reflexes:3', 'neural2=liaisonDrone:2'],
  peau: ['peau=gel:3', 'torse1=nanobots:3'],
};

const ARM_LIST = ['grappin', 'pistoletBras', 'lame', 'poing', 'bouclier', 'repulseur', 'choc', 'outils', 'grip', 'roquettes', 'fouet'];
const ARM_NAMES: Record<string, string> = {
  grappin: 'Grappin',
  pistoletBras: 'Pistolet Viper',
  lame: 'Lame Mantis',
  poing: 'Poing hydraulique',
  bouclier: 'Bouclier',
  repulseur: 'Répulseur',
  choc: 'Bras Tesla',
  outils: 'Bras tactique',
  grip: 'Grip magnétique',
  roquettes: 'Micro-roquettes',
  fouet: 'Fouet monofilament',
};
const LEG_LIST = ['saut', 'doubleSaut', 'bond', 'sprint', 'esquive', 'glissade', 'amortisseurs', 'courseMurale', 'sautMural', 'silence'];

const FX_NAMES: Record<string, number> = {
  grappin: CFX.GRAPPLE,
  bouclier: CFX.SHIELD,
  camo: CFX.CAMO,
  armL: CFX.ARM_L,
  armR: CFX.ARM_R,
  charge: CFX.CHARGE,
  reflex: CFX.REFLEX,
  surcharge: CFX.OVERCHARGE,
  sprint: CFX.SPRINT,
  secondsouffle: CFX.SECOND_WIND,
  scan: CFX.SCAN,
  burn: CFX.BURN,
  stun: CFX.STUN,
  shock: CFX.SHOCK,
};

function parseFx(s: string | null): number {
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);
  let f = 0;
  for (const n of s.split(',')) f |= FX_NAMES[n.trim()] ?? 0;
  return f;
}

interface Entry {
  view: CharView;
  label: string;
}

/** Événements d'un personnage : instant (s) avant l'instant de rendu ; animation programmée. */
interface Ev {
  shot?: number;
  melee?: number;
  hit?: number;
  death?: number;
  interact?: number;
  ab?: { kind: string; t: number; side?: 'L' | 'R'; x?: number; y?: number; z?: number };
  /** Animation avant puis après l'instant `at` (s avant le rendu). */
  anim?: { before: Anim; after: Anim; at: number };
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
  if (params.has('inspect')) {
    startInspect(root, params);
    return;
  }
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
  // décor du camouflage (bandes colorées derrière les personnages) et mur des silhouettes
  const backdrop = new THREE.Group();
  const stripes = ['#c8384a', '#2a8a8a', '#d8b030', '#3a5aa8', '#e8e4dc'];
  stripes.forEach((c, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 4), new THREE.MeshLambertMaterial({ color: c }));
    m.position.set((i - 2) * 1.6, 2, -2.2);
    backdrop.add(m);
  });
  backdrop.visible = params.has('backdrop') || params.get('fx')?.includes('camo') === true;
  scene.add(backdrop);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(14, 3.2, 0.2), new THREE.MeshLambertMaterial({ color: 0x6a645e }));
  wall.position.set(0, 1.6, 1.1);
  wall.visible = params.has('xray');
  scene.add(wall);
  if (params.has('ao')) CharacterRenderer.aoKeep = Number(params.get('ao'));
  const cr = new CharacterRenderer();
  scene.add(cr.group);
  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 200);
  if (params.has('vision')) cr.setVision(params.get('vision') as 'normal' | 'thermal' | 'night');

  const setNight = (night: boolean) => {
    envUniforms.uNight.value = night ? 1 : 0.15;
    envUniforms.uSkyAmb.value.setRGB(0.5, 0.52, 0.58).multiplyScalar(night ? 0.35 : 1);
    envUniforms.uLampCol.value.setRGB(0.45, 0.32, 0.2);
    sun.intensity = night ? 0.35 : 2.4;
    scene.background = new THREE.Color(night ? 0x0c0f18 : 0x3d3a40);
    floorMat.color.setHex(night ? 0x1c1c22 : 0x4e4c50);
  };
  setNight(params.has('night'));

  // apparence cybernétique commune (paramètres)
  const globalCyber: string[] | undefined = params.has('cyber') ? params.get('cyber')!.split(',').filter(Boolean) : params.has('preset') ? CYBER_PRESETS[params.get('preset')!] : undefined;
  const globalFx = parseFx(params.get('fx'));

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
  type Item = [string, CharKind, number, Partial<CharView>];
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
        GANG_NAMES.map((n, g) => [n, CharKind.THUG, 0, { gang: g, look: 3 + g * 5, weapon: [Weapon.PISTOL, Weapon.SMG, Weapon.KNIFE, Weapon.CLUB][g % 4] }] as Item),
        -2.2,
      ),
      row(
        [0, 1, 2, 3, 4].map((k) => ['Homme de Dadou', CharKind.GANGSTER, 1, { look: 20 + k * 7, weapon: [Weapon.PISTOL, Weapon.SMG, Weapon.SHOTGUN, Weapon.FISTS, Weapon.RIFLE][k] }] as Item).concat(
          [0, 1, 2, 3, 4].map((k) => ['Homme d’Even', CharKind.GANGSTER, 2, { look: 60 + k * 7, weapon: [Weapon.PISTOL, Weapon.SMG, Weapon.SHOTGUN, Weapon.FISTS, Weapon.RIFLE][k] }] as Item),
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
      row(Array.from({ length: 8 }, (_, k) => ['Dadou', CharKind.GANGSTER, 1, { look: 100 + k * 13 }] as Item), 0),
      row(Array.from({ length: 8 }, (_, k) => ['Even', CharKind.GANGSTER, 2, { look: 200 + k * 13 }] as Item), -2),
      row(Array.from({ length: 8 }, (_, k) => ['Lieutenant', CharKind.LIEUTENANT, k < 4 ? 1 : 2, { look: 300 + k * 17 }] as Item), -4),
      row(Array.from({ length: 8 }, (_, k) => ['Garde d’élite', CharKind.GANGSTER, k < 4 ? 1 : 2, { look: 400 + k * 13, gang: 1, weapon: k % 2 ? Weapon.RIFLE : Weapon.SMG }] as Item), -6),
    ],
    gangs: () => GANG_NAMES.map((n, g) => row([0, 1, 2, 3].map((k) => [k === 0 ? n : '', CharKind.THUG, 0, { gang: g, look: 400 + g * 31 + k * 7 }] as Item), -g * 1.6, 1.0)),
    police: () => [
      row(Array.from({ length: 8 }, (_, k) => ['NYPD', CharKind.POLICE, 3, { look: 500 + k * 11, weapon: k % 2 ? Weapon.CLUB : Weapon.PISTOL }] as Item), 0),
      row(
        [
          ['Gino le Rabatteur', CharKind.BARMAN, 1, {}],
          ['Nina la Recruteuse', CharKind.BARMAN, 2, {}],
          ['Tourelle (Dadou)', CharKind.TURRET, 1, {}],
          ['Tourelle (Even)', CharKind.TURRET, 2, {}],
          ['Tourelle (neutre)', CharKind.TURRET, 0, {}],
        ],
        -2.2,
        1.5,
      ),
    ],
    civ: () => [
      row(Array.from({ length: 9 }, (_, k) => ['', CharKind.CIVILIAN, 0, { look: 600 + k * 19 }] as Item), 0, 1.1),
      row(Array.from({ length: 9 }, (_, k) => ['', CharKind.CIVILIAN_F, 0, { look: 700 + k * 23 }] as Item), -2, 1.1),
      row(Array.from({ length: 9 }, (_, k) => ['', k % 2 ? CharKind.CIVILIAN_F : CharKind.CIVILIAN, 0, { look: 800 + k * 29 }] as Item), -4, 1.1),
    ],
    weapons: () => [
      row([Weapon.FISTS, Weapon.PISTOL, Weapon.SMG, Weapon.SHOTGUN, Weapon.RIFLE, Weapon.KNIFE, Weapon.CLUB].map((w) => [WEAPON_LABEL[w], CharKind.GANGSTER, 1, { weapon: w, aiming: true, pitch: 0.05, look: 31 }] as Item), 0, 1.3),
      row([Weapon.FISTS, Weapon.PISTOL, Weapon.SMG, Weapon.SHOTGUN, Weapon.RIFLE, Weapon.KNIFE, Weapon.CLUB].map((w) => [WEAPON_LABEL[w], CharKind.GANGSTER, 2, { weapon: w, look: 77 }] as Item), -2.2, 1.3),
    ],
    one: () => {
      const n = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
      const kinds = ['Dadou', 'Even', 'Gangster', 'Lieutenant', 'Voyou', 'NYPD', 'Civil', 'Civile', 'Rabatteur', 'Tourelle'];
      const kind = n('kind', CharKind.CIVILIAN) as CharKind;
      return [row([-1, 0, 1].map((o) => [`${kinds[kind] ?? kind} n° ${n('look', 1) + o}`, kind, n('faction', 0), { look: n('look', 1) + o, gang: n('gang', 0), weapon: n('weapon', Weapon.FISTS) as Weapon }] as Item), 0, 1.1)];
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
    // implants : les deux parrains avec les configurations toutes prêtes
    cyber: () => [
      row(
        (['combat', 'mobilite', 'infiltration', 'tout'] as const).flatMap((p, k) => [
          [`Dadou — ${p}`, CharKind.BOSS_DADOU, 1, { cyber: CYBER_PRESETS[p], look: 1 + k }] as Item,
          [`Even — ${p}`, CharKind.BOSS_EVEN, 2, { cyber: CYBER_PRESETS[p], look: 1 + k }] as Item,
        ]),
        0,
        1.25,
      ),
    ],
    // les onze implants de bras (bras gauche), armes de bras sorties
    cyberarms: () => {
      const wOf: Record<string, Weapon> = { pistoletBras: Weapon.ARM_PISTOL, lame: Weapon.ARM_BLADE, poing: Weapon.ARM_FIST, fouet: Weapon.ARM_WHIP };
      return [
        row(
          ARM_LIST.map((id, k) => [ARM_NAMES[id], k % 2 ? CharKind.BOSS_EVEN : CharKind.BOSS_DADOU, k % 2 ? 2 : 1, { cyber: [`brasD=${id}:${1 + (k % 5)}`], weapon: wOf[id] ?? Weapon.FISTS, fx: wOf[id] ? CFX.ARM_R : id === 'bouclier' ? CFX.SHIELD : 0 }] as Item),
          0,
          1.05,
        ),
      ];
    },
    // implants de jambes, un par personnage
    cyberlegs: () => [row(LEG_LIST.map((id, k) => [id, k % 2 ? CharKind.BOSS_EVEN : CharKind.BOSS_DADOU, k % 2 ? 2 : 1, { cyber: [`jambes1=${id}:${2 + (k % 3)}`] }] as Item), 0, 1.0)],
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
    // les deux parrains, tous implants installés, au premier rang
    out[0][4].view.kind = CharKind.BOSS_DADOU;
    out[0][4].view.faction = 1;
    out[0][4].view.cyber = CYBER_PRESETS.tout;
    out[0][5].view.kind = CharKind.BOSS_EVEN;
    out[0][5].view.faction = 2;
    out[0][5].view.cyber = CYBER_PRESETS.combat;
    return out;
  };

  // scène « strip » : un même personnage dans toutes les poses
  const POSES = ['idle', 'walk', 'jog', 'run', 'aim', 'fire', 'throw', 'melee', 'hit', 'dead', 'sit', 'drive', 'cower', 'interact'];
  const MOVE_POSES = ['crouch', 'crouchwalk', 'slide', 'dash', 'wallrunL', 'wallrunR', 'grapple', 'air', 'airjump', 'land', 'climb', 'leap', 'launch', 'slam'];
  const GESTURE_POSES = ['armpistol', 'armfire', 'armblade', 'armslash', 'armfist', 'charge', 'armpunch', 'armwhip', 'whip', 'shield', 'repulse', 'choc', 'rockets', 'hack', 'grapplefire'];
  const strip = (list: string[], cyber?: string[]) => {
    const n = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
    const kind = n('kind', CharKind.BOSS_DADOU) as CharKind;
    const fac = n('faction', kind === CharKind.BOSS_EVEN ? 2 : 1);
    return [row(list.map((p) => [p, kind, fac, { look: n('look', 1), gang: n('gang', 0), weapon: n('weapon', Weapon.PISTOL) as Weapon, pose: p, cyber }] as unknown as Item), 0, 1.25)];
  };
  scenes.strip = () => strip((params.get('poses') ?? POSES.join(',')).split(','));
  scenes.cyberposes = () => strip((params.get('poses') ?? MOVE_POSES.join(',')).split(','), CYBER_PRESETS.mobilite);
  scenes.cybergestures = () =>
    strip(
      (params.get('poses') ?? GESTURE_POSES.join(',')).split(','),
      ['brasG=grappin:4', 'brasD=pistoletBras:4', 'jambes1=saut:2'],
    );

  let sceneName = params.get('scene') ?? 'lineup';
  let mode = params.get('pose') ?? 'idle';
  let rowSel = params.has('row') ? Number(params.get('row')) : -1;
  let onlySel = params.has('only') ? Number(params.get('only')) : -1;
  let entries: Entry[] = [];
  const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
  const events = new Map<number, Ev>();
  /** Gestes : bras qui porte un implant (préférence au côté donné). */
  const sideWith = (v: CharView, ids: string[], pref: 'L' | 'R' = 'R'): 'L' | 'R' => {
    const look = v.cyber ?? [];
    const has = (s: string) => look.some((c) => ids.some((id) => c.startsWith(`${s}=${id}:`)));
    if (has(pref === 'L' ? 'brasG' : 'brasD')) return pref;
    if (has('brasG')) return 'L';
    if (has('brasD')) return 'R';
    return pref;
  };
  /** S'assure qu'un implant de bras est installé pour un geste (sinon on l'ajoute à droite). */
  const ensureArm = (v: CharView, id: string, slot = 'brasD') => {
    const look = v.cyber ?? [];
    if (!look.some((c) => c.includes(`=${id}:`))) v.cyber = [...look.filter((c) => !c.startsWith(`${slot}=`)), `${slot}=${id}:3`];
  };
  /** Pose d'un personnage (vitesse, état, événements). */
  const applyPose = (v: CharView, pose: string) => {
    const t = num('t', -1);
    const ev: Ev = {};
    const T = (d: number) => (t >= 0 ? t : d);
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
        if (pose === 'fire') ev.shot = T(0.04);
        break;
      case 'throw':
        if (v.weapon === Weapon.FISTS || v.weapon === Weapon.KNIFE || v.weapon === Weapon.CLUB) v.weapon = Weapon.PISTOL;
        ev.melee = T(0.24);
        break;
      case 'melee':
        if (v.weapon !== Weapon.FISTS && v.weapon !== Weapon.KNIFE && v.weapon !== Weapon.CLUB) v.weapon = Weapon.CLUB;
        ev.melee = T(0.14);
        break;
      case 'hit':
        ev.hit = T(0.08);
        break;
      case 'dead':
        v.anim = Anim.DEAD;
        ev.death = T(2.5);
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
        ev.interact = T(0.3);
        break;
      case 'side':
        v.yaw = Math.PI / 2;
        break;
      case 'back':
        v.yaw = Math.PI;
        break;
      // ------------------------------------------------- déplacements augmentés
      case 'crouch':
        v.anim = Anim.CROUCH;
        break;
      case 'crouchwalk':
        v.anim = Anim.CROUCH_WALK;
        v.vz = num('speed', 1.8);
        break;
      case 'slide':
        v.anim = Anim.SLIDE;
        v.vz = num('speed', 7.5);
        break;
      case 'dash':
        v.anim = Anim.DASH;
        v.vz = num('speed', 12);
        break;
      case 'wallrunL':
      case 'wallrunR':
        v.anim = pose === 'wallrunL' ? Anim.WALLRUN_L : Anim.WALLRUN_R;
        v.vz = num('speed', 8);
        v.y = 0.4;
        break;
      case 'grapple':
        v.anim = Anim.GRAPPLE;
        v.fx = (v.fx ?? 0) | CFX.GRAPPLE;
        v.y = 1.2;
        v.vz = 12;
        ensureArm(v, 'grappin', 'brasG');
        ev.ab = { kind: 'grappin', t: T(0.6), side: sideWith(v, ['grappin'], 'L'), x: v.x + 2, y: 12, z: v.z + 9 };
        break;
      case 'air':
        v.anim = Anim.AIR;
        v.y = 0.8;
        v.vz = 4;
        ev.anim = { before: Anim.IDLE, after: Anim.AIR, at: T(0.15) };
        break;
      case 'airjump':
        v.y = 1.4;
        v.vz = 4;
        ev.anim = { before: Anim.AIR, after: Anim.AIR_JUMP, at: T(0.24) };
        break;
      case 'land':
        ev.anim = { before: Anim.AIR, after: Anim.LAND, at: T(0.1) };
        break;
      case 'climb':
        ev.anim = { before: Anim.IDLE, after: Anim.CLIMB, at: T(0.3) };
        v.y = 0.3;
        break;
      case 'leap':
        v.anim = Anim.LEAP;
        break;
      case 'launch':
        v.anim = Anim.LEAP;
        v.vz = 11;
        v.y = 1.1;
        break;
      case 'slam':
        ev.ab = { kind: 'onde', t: T(0.25) };
        ev.anim = { before: Anim.AIR, after: Anim.LAND, at: T(0.25) };
        break;
      case 'stun':
        v.fx = (v.fx ?? 0) | CFX.STUN;
        break;
      case 'shock':
        v.fx = (v.fx ?? 0) | CFX.SHOCK;
        break;
      // ------------------------------------------------- implants de bras
      case 'armpistol':
      case 'armfire':
        ensureArm(v, 'pistoletBras');
        v.weapon = Weapon.ARM_PISTOL;
        v.aiming = true;
        v.pitch = num('pitch', 0.06);
        v.fx = (v.fx ?? 0) | (sideWith(v, ['pistoletBras']) === 'L' ? CFX.ARM_L : CFX.ARM_R);
        if (pose === 'armfire') ev.shot = T(0.04);
        break;
      case 'armblade':
      case 'armslash':
        ensureArm(v, 'lame');
        v.weapon = Weapon.ARM_BLADE;
        v.fx = (v.fx ?? 0) | (sideWith(v, ['lame']) === 'L' ? CFX.ARM_L : CFX.ARM_R);
        if (pose === 'armslash') ev.melee = T(0.14);
        else v.aiming = true;
        break;
      case 'armfist':
      case 'charge':
      case 'armpunch':
        ensureArm(v, 'poing');
        v.weapon = Weapon.ARM_FIST;
        v.fx = (v.fx ?? 0) | (sideWith(v, ['poing']) === 'L' ? CFX.ARM_L : CFX.ARM_R) | (pose === 'charge' ? CFX.CHARGE : 0);
        if (pose === 'armpunch') ev.melee = T(0.12);
        break;
      case 'armwhip':
      case 'whip':
        ensureArm(v, 'fouet');
        v.weapon = Weapon.ARM_WHIP;
        v.fx = (v.fx ?? 0) | (sideWith(v, ['fouet']) === 'L' ? CFX.ARM_L : CFX.ARM_R);
        if (pose === 'whip') ev.melee = T(0.3);
        break;
      case 'shield':
        ensureArm(v, 'bouclier', 'brasG');
        v.fx = (v.fx ?? 0) | CFX.SHIELD;
        break;
      case 'repulse':
        ensureArm(v, 'repulseur', 'brasG');
        ev.ab = { kind: 'repulseur', t: T(0.12), side: sideWith(v, ['repulseur'], 'L') };
        break;
      case 'choc':
        ensureArm(v, 'choc', 'brasG');
        ev.ab = { kind: 'choc', t: T(0.3), side: sideWith(v, ['choc'], 'L') };
        break;
      case 'rockets':
        ensureArm(v, 'roquettes', 'brasG');
        ev.ab = { kind: 'roquettes', t: T(0.45), side: sideWith(v, ['roquettes'], 'L') };
        break;
      case 'hack':
        ensureArm(v, 'outils', 'brasG');
        ev.ab = { kind: 'outils', t: T(0.5), side: sideWith(v, ['outils'], 'L') };
        break;
      case 'grapplefire':
        ensureArm(v, 'grappin', 'brasG');
        v.fx = (v.fx ?? 0) | CFX.GRAPPLE;
        ev.ab = { kind: 'grappin', t: T(0.2), side: sideWith(v, ['grappin'], 'L'), x: v.x + 1.5, y: 9, z: v.z + 10 };
        break;
    }
    if (params.has('ab')) {
      const k = params.get('ab')!;
      ev.ab = { kind: k, t: num('abt', 0.3), side: (params.get('abside') as 'L' | 'R') ?? undefined };
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
      if (params.has('weapon') && sceneName !== 'one' && !sceneName.startsWith('strip') && sceneName !== 'cyberposes' && sceneName !== 'cybergestures') v.weapon = num('weapon', 0) as Weapon;
      if (globalCyber && (!v.cyber || params.has('cyber') || params.has('preset'))) v.cyber = globalCyber;
      if (globalFx) v.fx = (v.fx ?? 0) | globalFx;
      if (yawDeg !== null) v.yaw += yawDeg;
      const own = (v as unknown as { pose?: string }).pose;
      applyPose(v, own ?? mode);
      // la vitesse est donnée vers l'avant (ou de côté avec &strafe) : on l'oriente selon le lacet
      const sp = v.vz;
      const dir = v.yaw + (params.has('strafe') ? Math.PI / 2 : params.has('backward') ? Math.PI : 0);
      v.vx = Math.sin(dir) * sp;
      v.vz = Math.cos(dir) * sp;
      if (params.has('hl')) cr.highlightRegion(v.id, params.get('hl') as 'brasG');
    }
    if (params.has('xray')) cr.setXray(new Set(views.map((v) => v.id)));
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
    if (params.has('xray')) {
      camera.position.z += 2.5;
      camera.position.y += 0.2;
    }
    if (params.has('cam')) {
      // &cam=px,py,pz,tx,ty,tz (relatif au premier personnage)
      const c = params.get('cam')!.split(',').map(Number);
      const o = views[0] ?? { x: 0, y: 0, z: 0 };
      camera.position.set(o.x + c[0], o.y + c[1], o.z + c[2]);
      camera.lookAt(o.x + c[3], o.y + c[4], o.z + c[5]);
    }
    if (params.has('fov')) {
      camera.fov = num('fov', 40);
      camera.updateProjectionMatrix();
    }
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
        markers[i].renderOrder = 100;
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

  /** Applique les événements et les animations programmées d'un personnage à l'instant tt. */
  const applyEvents = (v: CharView, time: number, tt: number) => {
    const ev = events.get(v.id);
    if (!ev) return;
    if (ev.shot !== undefined) v.shotAt = time - ev.shot;
    if (ev.melee !== undefined) v.meleeAt = time - ev.melee;
    if (ev.hit !== undefined) v.hitAt = time - ev.hit;
    if (ev.death !== undefined) v.deathAt = time - ev.death;
    if (ev.interact !== undefined) v.interactAt = time - ev.interact;
    if (ev.ab) v.ab = tt >= time - ev.ab.t - 1e-6 ? { kind: ev.ab.kind, at: time - ev.ab.t, side: ev.ab.side, x: ev.ab.x, y: ev.ab.y, z: ev.ab.z } : undefined;
    if (ev.anim) v.anim = tt >= time - ev.anim.at - 1e-6 ? ev.anim.after : ev.anim.before;
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
    /** Apparence cybernétique de tous les personnages (ou d'un seul : index). */
    cyber(look: string[] | string, only = -1) {
      const l = typeof look === 'string' ? (CYBER_PRESETS[look] ?? look.split(',')) : look;
      entries.forEach((e, i) => {
        if (only < 0 || i === only) e.view.cyber = l;
      });
    },
    fx(bits: number | string, only = -1) {
      const f = typeof bits === 'number' ? bits : parseFx(bits);
      entries.forEach((e, i) => {
        if (only < 0 || i === only) e.view.fx = f;
      });
    },
    vision(mode: 'normal' | 'thermal' | 'night') {
      cr.setVision(mode);
    },
    highlight(slot: string | null) {
      for (const e of entries) cr.highlightRegion(e.view.id, slot as 'brasG' | null);
    },
    render(time = 0.8, frames = num('frames', 40)) {
      // simule quelques images pour stabiliser l'animation ; les événements sont placés avant
      // l'instant de rendu
      const views = entries.map((e) => e.view);
      envUniforms.uTime.value = time;
      for (let i = frames - 1; i >= 0; i--) {
        const tt = time - i * 0.016;
        for (const v of views) applyEvents(v, time, tt);
        cr.update(views, camera, tt, 0.016);
      }
      drawMuzzles();
      renderer.render(scene, camera);
      drawLabels();
      return { ...renderer.info.render, instances: cr.stats.instances, quads: cr.stats.quads, drawn: cr.stats.drawn, camo: cr.stats.camo, xray: cr.stats.xray };
    },
    /** Avance la simulation de `sec` secondes (images de 1/60 s) puis dessine (séquences animées). */
    step(sec = 1 / 60) {
      const views = entries.map((e) => e.view);
      const n = Math.max(1, Math.round(sec * 60));
      for (let i = 0; i < n; i++) {
        clock += 1 / 60;
        envUniforms.uTime.value = clock;
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
      return { ...cr.stats, calls: renderer.info.render.calls };
    },
    /** Quads d'un membre à chaque niveau de détail. */
    quads(key: string) {
      return cr.quadsOf(key);
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
  api.render(num('time', 0.8));
}

/**
 * Planche des membres (?chars&inspect=cyfarm:grappin:2:s:m:L,cyhand:std:fist:m:L…) : chaque
 * membre à plat sous quatre angles (devant, gauche, derrière, trois quarts), tenue de Dadou
 * (&kind=1 : Even), implants allumés. Liste prédéfinie : &inspect=arms|hands|legs|torso|head.
 */
function startInspect(root: HTMLElement, params: URLSearchParams): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  root.appendChild(renderer.domElement);
  const lt = new THREE.Data3DTexture(new Uint8Array(16).fill(200), 2, 2, 2);
  lt.format = THREE.RGFormat;
  lt.needsUpdate = true;
  envUniforms.uLightTex.value = lt;
  envUniforms.uLightOrigin.value.set(-1000, -1000, -1000);
  envUniforms.uLightSize.value.set(2000, 2000, 2000);
  envUniforms.uFogDensity.value = 0;
  envUniforms.uNight.value = params.has('night') ? 1 : 0.3;
  envUniforms.uSkyAmb.value.setRGB(0.5, 0.52, 0.58);
  // ligne de palette 0 : tenue du parrain
  const kind = Number(params.get('kind') ?? 0) === 1 ? CharKind.BOSS_EVEN : CharKind.BOSS_DADOU;
  const app = appearanceFor(kind, kind === CharKind.BOSS_EVEN ? 2 : 1, 1, 0);
  const ext = extendedColors(app.outfit);
  for (let i = 0; i < 32; i++) {
    const c = i < 16 ? (app.outfit[OUTFIT_ORDER[i]] as number) : ext[i - 16];
    paletteData[i * 4] = (c >> 16) & 255;
    paletteData[i * 4 + 1] = (c >> 8) & 255;
    paletteData[i * 4 + 2] = c & 255;
    paletteData[i * 4 + 3] = 255;
  }
  paletteTexture.needsUpdate = true;
  const cd = new CyberShaderData(4);
  const glowK = Number(params.get('glow') ?? 1.6);
  for (let ch = 0; ch < 16; ch++) cd.setGlow(0, ch, glowK);
  cd.setEye(0, 0xff6a3d, 2);
  cd.flush();
  const mat = createCharMaterial(cd, 'inspect');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x5d6470);
  const sun = new THREE.DirectionalLight(0xfff4e8, 2.0);
  sun.position.set(-2, 4, 3);
  scene.add(sun);
  const back = new THREE.DirectionalLight(0x9ab0ff, 0.6);
  back.position.set(3, 1, -3);
  scene.add(back);
  const presets: Record<string, string[]> = {
    arms: ['grappin', 'pistoletBras', 'lame', 'poing', 'bouclier', 'repulseur', 'choc', 'outils', 'grip', 'roquettes', 'fouet'].map((id) => `cyfarm:${id}:2:s:m:L`),
    hands: ['std', 'palm', 'mag', 'tesla', 'whip', 'fist', 'tool'].flatMap((st) => [`cyhand:${st}:relax:m:L`, `cyhand:${st}:fist:m:L`]),
    legs: ['saut', 'doubleSaut', 'bond', 'sprint', 'esquive', 'glissade', 'amortisseurs', 'courseMurale', 'sautMural', 'silence'].flatMap((id) => [`cyleg:thigh:m:${id}2:L`, `cyleg:shin:m:${id}2:L`, `cyleg:foot:m:${id}2:S`]),
    torso: ['blindage', 'secondSouffle', 'accumulateur', 'surcharge', 'antichoc', 'nanobots', 'gyro', 'reflexesMoteurs', 'vertebres', 'treuil'].map((id) => `cytorso:longcoat:m:${id}2`),
    head: ['zoom', 'thermique', 'nocturne', 'marqueur', 'analyseur', 'scanner', 'visee', 'reflexes', 'conscience', 'coprocesseur', 'liaisonDrone', 'commandement'].map((id) => `cyhead:m:${id}2:-`),
  };
  const raw = params.get('inspect') ?? 'arms';
  const names = presets[raw] ?? raw.split(',');
  // membres de base affichés avec la pièce (contexte) : &base=1
  const withBase = params.has('base');
  const baseOf = (key: string): string[] => {
    if (!withBase) return [];
    const a = key.split(':');
    if (a[0] === 'cyleg') return a[1] === 'thigh' ? ['thigh:pants:m:L'] : a[1] === 'shin' ? ['shin:pants:dress:m:L'] : ['foot:dress:m'];
    if (a[0] === 'cytorso') return [`torso:${a[1]}:${a[2]}`];
    if (a[0] === 'cyhead') return ['head:mbhandlebar1', 'hair:slick:m'];
    return [];
  };
  const views: [number, number][] = [
    [0, 0],
    [Math.PI / 2, 0],
    [Math.PI, 0],
    [-Math.PI / 4, 0.4],
  ];
  const cols = 4;
  const rows = names.length;
  const aspect = window.innerWidth / window.innerHeight;
  const cellH = 1;
  const cellW = (cellH * rows * aspect) / cols;
  const quads: Record<string, number> = {};
  names.forEach((key, r) => {
    views.forEach(([ry, rx], vi) => {
      const g = new THREE.Group();
      // « a|b|c » : plusieurs membres ensemble (avant-bras et ses pièces mobiles…)
      for (const k of [...key.split('|'), ...baseOf(key)]) {
        const geo = meshChar(buildPart(k));
        if (vi === 0) quads[key] = (quads[key] ?? 0) + geo.userData.quads;
        g.add(new THREE.Mesh(geo, mat));
      }
      const pivot = new THREE.Group();
      pivot.add(g);
      pivot.rotation.set(rx, ry, 0, 'YXZ');
      pivot.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(pivot);
      const size = box.getSize(new THREE.Vector3());
      const k = 0.9 * Math.min(cellW / Math.max(1e-3, size.x), cellH / Math.max(1e-3, size.y));
      const c = box.getCenter(new THREE.Vector3());
      const holder = new THREE.Group();
      holder.add(pivot);
      pivot.position.copy(c).multiplyScalar(-1);
      holder.scale.setScalar(k);
      holder.position.set((vi - (cols - 1) / 2) * cellW, -(r - (rows - 1) / 2) * cellH, 0);
      scene.add(holder);
    });
  });
  const h = rows * cellH;
  const camera = new THREE.OrthographicCamera((-h * 0.5 * window.innerWidth) / window.innerHeight, (h * 0.5 * window.innerWidth) / window.innerHeight, h * 0.5, -h * 0.5, -50, 50);
  camera.position.set(0, 0, 20);
  renderer.render(scene, camera);
  const label = document.createElement('pre');
  label.style.cssText = 'position:fixed;left:6px;top:4px;margin:0;font:11px monospace;color:#fff;text-shadow:0 0 2px #000;';
  label.textContent = names.map((n) => `${n}: ${quads[n]} quads`).join('\n');
  document.body.appendChild(label);
  (window as unknown as { __viewer: object }).__viewer = { quads, render: () => renderer.render(scene, camera) };
}
