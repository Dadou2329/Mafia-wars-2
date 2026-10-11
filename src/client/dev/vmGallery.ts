// Banc d'essai de la vue subjective (développement, route ?vm) : une ruelle simple, la vue
// subjective attachée à la caméra, et des commandes pour passer en revue chaque arme, chaque
// parrain, la visée, le tir (automatique pour le Wasp), les coups, le rechargement, le jour et
// la nuit.
//
// Clavier : 1-7 arme · L Dadou/Even · clic droit (ou A) viser · clic gauche (ou F) tirer/frapper
// (maintenu : rafale) · R recharger · W marcher · Maj courir · Espace sauter · N jour/nuit/intérieur
// · M repère de bouche du canon · P pause · glisser la souris (Maj + clic) pour tourner la tête.
//
// Bras cybernétiques : ?vm&arms=grappin,pistoletBras (implants des bras gauche et droit, « - »
// pour aucun ; &lv=1..5 niveau), ou &cyber=brasG=grappin:3,brasD=lame:2, ou &preset=combat (voir
// la galerie des personnages). Clavier : 9 / 8 sortir-rentrer l'arme du bras gauche / droit ·
// Q / E capacité du bras gauche / droit (grappin tiré puis lâché, bouclier levé puis baissé,
// répulseur, arc électrique, roquettes, piratage ; arme de bras : sortie) · C charge du poing
// hydraulique (une fois : charge, deux fois : coup chargé) · X posture de déplacement (glissade,
// esquive, course murale, escalade, saut, réception, grappin) · V vision (normale, thermique).
//
// API pour les captures automatiques : window.__vm (set, step, fire, burst, swing, reload,
// reloadAt, render, cyber, arm, ability, action, move, grapple, charge…). Avec ?vm&still la
// boucle d'animation est arrêtée : on avance le temps avec __vm.step(). Avec ?vm&inspect les
// modèles sont affichés à plat, en grand, pour les vérifier (?vm&inspect=pistol,smg%2Bdadou… ;
// cy-grappin… : avant-bras mécaniques déployés ; sans liste : tous).

import * as THREE from 'three';
import { IMPLANT_ARM_WEAPON, isArmWeapon, WEAPONS, Weapon } from '../../shared/characters';
import type { Slot } from '../../shared/protocol';
import { CyberShaderData, patchCharMaterial } from '../characters/charMaterial';
import { meshChar } from '../characters/charMesher';
import { ARM_IMPLANTS, type ArmImplant } from '../characters/cyber';
import { Viewmodel, type MoveState } from '../game/viewmodel';
import { cyberForearmFP, fpMech } from '../models/cyberArms';
import { CYBER_PRESETS } from './charGallery';
import type { PlayerController } from '../game/player';
import type { WeaponSystem } from '../game/weapons';
import { meshModel } from '../models/modelMesher';
import * as VM from '../models/viewmodels';
import { createMaterialTexture, envUniforms } from '../render/env';
import { createObjectMaterial } from '../render/voxelObjectMaterial';

type EnvKind = 'day' | 'night' | 'indoor';

const WEAPON_NAMES: Record<number, string> = Object.fromEntries(Object.values(WEAPONS).map((d) => [d.id, d.name]));
const ORDER = [Weapon.FISTS, Weapon.PISTOL, Weapon.SHOTGUN, Weapon.RIFLE, Weapon.KNIFE, Weapon.CLUB, Weapon.SMG];
const MOVES: MoveState[] = ['normal', 'slide', 'dash', 'wallrunL', 'wallrunR', 'climb', 'air', 'land', 'grapple'];
const MOVE_NAMES: Record<MoveState, string> = {
  normal: 'normale',
  sprint: 'course',
  slide: 'glissade',
  dash: 'esquive',
  wallrunL: 'course murale (mur à gauche)',
  wallrunR: 'course murale (mur à droite)',
  climb: 'escalade',
  air: 'en l’air',
  land: 'réception',
  grapple: 'grappin',
};

/** Implants des bras d'après l'adresse (?arms=, ?cyber=, ?preset=). */
function cyberFromParams(params: URLSearchParams): string[] {
  const raw = params.get('cyber');
  if (raw) return raw.split(',').filter(Boolean);
  const preset = params.get('preset');
  if (preset && CYBER_PRESETS[preset]) return CYBER_PRESETS[preset];
  const arms = params.get('arms');
  if (!arms) return [];
  const lv = params.get('lv') ?? '3';
  const [l, r] = arms.split(',');
  const out: string[] = [];
  if (l && l !== '-') out.push(`brasG=${l}:${lv}`);
  if (r && r !== '-') out.push(`brasD=${r}:${lv}`);
  return out;
}

/** Volume de lumière minimal (2×2×2, uniforme) : ciel, lampes. */
function lightTexture(): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(new Uint8Array(16), 2, 2, 2);
  tex.format = THREE.RGFormat;
  tex.type = THREE.UnsignedByteType;
  tex.needsUpdate = true;
  envUniforms.uLightTex.value = tex;
  envUniforms.uLightOrigin.value.set(-1000, -1000, -1000);
  envUniforms.uLightSize.value.set(2000, 2000, 2000);
  envUniforms.uFogDensity.value = 0;
  return tex;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function brick(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#4a3a33';
  g.fillRect(0, 0, 64, 64);
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 4; c++) {
      const x = c * 16 + (r & 1 ? 8 : 0);
      const v = 90 + ((r * 7 + c * 13) % 5) * 9;
      g.fillStyle = `rgb(${v + 20},${v - 30},${v - 45})`;
      g.fillRect(x + 1, r * 8 + 1, 14, 6);
      g.fillRect(x - 15, r * 8 + 1, 14, 6);
    }
}

function cobble(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#2f2c29';
  g.fillRect(0, 0, 64, 64);
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const v = 70 + ((r * 5 + c * 11) % 6) * 7;
      g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      g.fillRect(c * 8 + (r & 1 ? 4 : 0) + 1, r * 8 + 1, 6, 6);
    }
}

export function startVmGallery(root: HTMLElement): void {
  createMaterialTexture();
  const ltex = lightTexture();
  const params = new URLSearchParams(location.search);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  root.appendChild(renderer.domElement);
  if (params.has('inspect')) {
    startInspect(renderer, params.get('inspect') ?? '');
    return;
  }

  // ---------------------------------------------------------------- décor : une ruelle
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xb8c4d8, 0x3a3028, 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
  sun.position.set(-6, 12, 4);
  scene.add(sun);
  const floorMat = new THREE.MeshLambertMaterial({ map: canvasTexture(64, 64, cobble, [16, 16]) });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const wallMat = new THREE.MeshLambertMaterial({ map: canvasTexture(64, 64, brick, [6, 2]) });
  for (const [x, z, ry, len] of [
    [-3.2, -4, Math.PI / 2, 16],
    [3.2, -4, -Math.PI / 2, 16],
    [0, -11, 0, 6.4],
  ] as const) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, 5), wallMat);
    wall.position.set(x, 2.5, z);
    wall.rotation.y = ry;
    scene.add(wall);
  }
  const crateMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2e });
  for (const [x, z, s] of [
    [-1.6, -5, 0.9],
    [-1.9, -6.2, 0.7],
    [1.5, -7.5, 1.0],
    [0.4, -9.5, 0.8],
  ]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
    c.position.set(x, s / 2, z);
    scene.add(c);
  }
  // réverbère au gaz
  const lampPost = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.2, 0.12), new THREE.MeshLambertMaterial({ color: 0x1c1c1e }));
  lampPost.position.set(2.6, 1.6, -5.5);
  scene.add(lampPost);
  const lampGlass = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.35), new THREE.MeshBasicMaterial({ color: 0xffc070 }));
  lampGlass.position.set(2.6, 3.35, -5.5);
  scene.add(lampGlass);
  const lampLight = new THREE.PointLight(0xffa860, 0, 12, 1.4);
  lampLight.position.copy(lampGlass.position);
  scene.add(lampLight);
  // cible : silhouette au loin, au centre de l'écran
  const target = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.3), new THREE.MeshLambertMaterial({ color: 0x7a2a22 }));
  target.position.set(0, 0.85, -10.4);
  scene.add(target);
  const targetHead = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), new THREE.MeshLambertMaterial({ color: 0xd8b494 }));
  targetHead.position.set(0, 1.85, -10.4);
  scene.add(targetHead);
  // repère de la bouche du canon (vérifie muzzleWorld)
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a2a, depthTest: false }));
  marker.renderOrder = 10;
  marker.visible = false;
  scene.add(marker);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.9, depthTest: false }));
  flash.renderOrder = 11;
  flash.visible = false;
  scene.add(flash);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 200);
  const baseFov = 75;

  // ---------------------------------------------------------------- joueur et armes factices
  const player = {
    vel: new THREE.Vector3(),
    onGround: true,
    sprint: false,
    aiming: false,
    yaw: Math.PI,
    pitch: 0,
  };
  const weapons = {
    current: Weapon.PISTOL as Weapon,
    reloadUntil: 0,
    mag: new Map<Weapon, number>([...ORDER, Weapon.ARM_PISTOL].filter((w) => WEAPONS[w].ranged).map((w) => [w, WEAPONS[w].magazine])),
    reloading(now: number) {
      return now < this.reloadUntil;
    },
  };
  const vm = new Viewmodel();
  const state = {
    look: 'dadou' as Slot,
    walk: 0,
    env: 'day' as EnvKind,
    markerOn: params.has('marker'),
    paused: params.has('still'),
    aimToggle: false,
    jumpT: -1,
    /** Bouton de tir maintenu (rafale du Wasp). */
    trigger: false,
    nextShot: 0,
    // implants des bras
    cyber: cyberFromParams(params),
    armOut: null as 'L' | 'R' | null,
    prevWeapon: Weapon.PISTOL as Weapon,
    move: 'normal' as MoveState,
    grapple: null as 'L' | 'R' | null,
    shield: null as 'L' | 'R' | null,
    charging: null as 'L' | 'R' | null,
    vision: 'normal' as 'normal' | 'thermal',
  };
  vm.setCyber(state.cyber);
  let now = 1;
  let flashT = 0;

  const applyEnv = (e: EnvKind) => {
    state.env = e;
    const d = ltex.image.data as Uint8Array;
    const [sky, lamp] = e === 'day' ? [255, 0] : e === 'night' ? [255, 150] : [50, 120];
    for (let i = 0; i < 8; i++) {
      d[i * 2] = sky;
      d[i * 2 + 1] = lamp;
    }
    ltex.needsUpdate = true;
    const night = e === 'day' ? 0 : 1;
    envUniforms.uNight.value = e === 'indoor' ? 0.3 : night;
    envUniforms.uSkyAmb.value.setRGB(0.52, 0.56, 0.66).lerp(new THREE.Color(0.075, 0.085, 0.13), e === 'day' ? 0 : e === 'night' ? 1 : 0.3);
    envUniforms.uLampCol.value.setRGB(1.0, 0.58, 0.26).multiplyScalar(e === 'day' ? 0.75 : 1.9);
    scene.background = new THREE.Color(e === 'day' ? 0x9aa8b8 : e === 'night' ? 0x0b0f1a : 0x241a14);
    hemi.intensity = e === 'day' ? 1.2 : e === 'night' ? 0.12 : 0.25;
    sun.intensity = e === 'day' ? 2.2 : e === 'night' ? 0.15 : 0;
    lampLight.intensity = e === 'day' ? 0 : 6;
    wallMat.color.setScalar(e === 'indoor' ? 0.6 : 1);
  };
  applyEnv((params.get('env') as EnvKind) ?? 'day');

  const fire = () => {
    const w = weapons.current;
    const def = WEAPONS[w];
    if (!def.ranged) {
      vm.swing();
      return;
    }
    if (weapons.reloading(now)) return;
    const m = weapons.mag.get(w) ?? 0;
    if (m <= 0) {
      reload();
      return;
    }
    if (now < state.nextShot) return;
    state.nextShot = now + def.cooldown;
    weapons.mag.set(w, m - 1);
    const big = w === Weapon.SHOTGUN || w === Weapon.RIFLE;
    const smg = w === Weapon.SMG;
    const p = vm.muzzleWorld(camera);
    flash.position.copy(p);
    flash.visible = true;
    flashT = smg ? 0.03 : 0.06;
    vm.kick(big ? 1.4 : smg ? 0.5 : 1);
  };
  const reload = () => {
    const w = weapons.current;
    const def = WEAPONS[w];
    if (!def.ranged || weapons.reloading(now)) return;
    weapons.reloadUntil = now + def.reload;
    const until = weapons.reloadUntil;
    const refill = () => {
      if (weapons.reloadUntil === until && now >= until) weapons.mag.set(w, def.magazine);
    };
    pending.push({ at: until, fn: refill });
  };
  const pending: { at: number; fn: () => void }[] = [];
  const setWeapon = (w: Weapon) => {
    weapons.current = w;
    weapons.reloadUntil = 0;
    state.nextShot = 0;
    if (!isArmWeapon(w) && state.armOut) {
      state.armOut = null;
      vm.setArmOut(null);
    }
  };

  // ---------------------------------------------------------------- implants des bras
  const armId = (side: 'L' | 'R'): string | null => {
    const slot = side === 'L' ? 'brasG=' : 'brasD=';
    const it = state.cyber.find((x) => x.startsWith(slot));
    return it ? it.slice(slot.length).split(':')[0] : null;
  };
  /** Sortir (ou rentrer) l'arme du bras. */
  const armOut = (side: 'L' | 'R' | null) => {
    if (!side || state.armOut === side) {
      if (isArmWeapon(weapons.current)) setWeapon(state.prevWeapon);
      state.armOut = null;
      vm.setArmOut(null);
      return;
    }
    const id = armId(side);
    const w = id ? IMPLANT_ARM_WEAPON[id] : undefined;
    if (w === undefined) return;
    if (!isArmWeapon(weapons.current)) state.prevWeapon = weapons.current;
    setWeapon(w);
    state.armOut = side;
    vm.setArmOut(side);
  };
  /** Grappin : tiré vers le haut de la ruelle, puis lâché. */
  const grapple = (side: 'L' | 'R' | null) => {
    if (state.grapple) {
      vm.armAction(state.grapple, 'grapple-release');
      vm.setGrappleTarget(null);
      state.grapple = null;
      if (state.move === 'grapple') move('normal');
    }
    if (!side) return;
    state.grapple = side;
    vm.setGrappleTarget(new THREE.Vector3(side === 'L' ? -2.4 : 2.4, 4.6, -7.5));
    vm.armAction(side, 'grapple-fire');
  };
  const move = (m: MoveState, t?: number) => {
    state.move = m;
    vm.setMoveState(m, t);
    player.onGround = m !== 'air' && m !== 'wallrunL' && m !== 'wallrunR' && m !== 'grapple' && m !== 'climb';
  };
  /** Capacité du bras (touche Q / E en jeu). */
  const ability = (side: 'L' | 'R') => {
    const id = armId(side);
    switch (id) {
      case 'grappin':
        grapple(state.grapple ? null : side);
        break;
      case 'bouclier':
        state.shield = state.shield ? null : side;
        vm.armAction(side, state.shield ? 'shield-on' : 'shield-off');
        break;
      case 'repulseur':
        vm.armAction(side, 'repulse');
        break;
      case 'choc':
        vm.armAction(side, 'shock');
        break;
      case 'roquettes':
        vm.armAction(side, 'rockets');
        break;
      case 'outils':
        vm.armAction(side, 'hack');
        break;
      case 'pistoletBras':
      case 'lame':
      case 'poing':
      case 'fouet':
        armOut(side);
        break;
      default:
        break;
    }
  };
  /** Poing hydraulique : début de charge, puis coup chargé. */
  const charge = () => {
    const side = state.armOut;
    if (!side || weapons.current !== Weapon.ARM_FIST) return;
    if (!state.charging) {
      state.charging = side;
      vm.armAction(side, 'charge-start');
    } else {
      vm.armAction(state.charging, 'charge-release');
      state.charging = null;
      vm.swing();
    }
  };

  // ---------------------------------------------------------------- simulation
  const step = (dt: number) => {
    now += dt;
    // marche / course : vitesse dans la direction du regard
    const sp = state.walk === 0 ? 0 : player.sprint ? 6.4 : player.aiming ? 2.6 : 4.2;
    player.vel.x = Math.sin(player.yaw) * sp * (state.walk ? 1 : 0);
    player.vel.z = Math.cos(player.yaw) * sp * (state.walk ? 1 : 0);
    // saut scripté (0,55 s en l'air)
    if (state.jumpT >= 0) {
      state.jumpT += dt;
      player.onGround = state.jumpT > 0.55;
      player.vel.y = player.onGround ? 0 : 6.4 - 22 * state.jumpT;
      if (player.onGround) state.jumpT = -1;
    }
    for (let i = pending.length - 1; i >= 0; i--)
      if (now >= pending[i].at) {
        pending[i].fn();
        pending.splice(i, 1);
      }
    // tir automatique tant que la détente est tenue
    if (state.trigger && WEAPONS[weapons.current].auto) fire();
    // caméra : œil à 1,64 m, zoom de visée comme en jeu
    const fovT = player.aiming ? (weapons.current === Weapon.RIFLE ? baseFov * 0.5 : weapons.current === Weapon.FISTS || weapons.current === Weapon.KNIFE || weapons.current === Weapon.CLUB ? baseFov : baseFov * 0.72) : player.sprint && state.walk ? baseFov * 1.06 : baseFov;
    camera.fov += (fovT - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
    camera.position.set(0, 1.64 + (player.onGround ? 0 : 0.3), 0);
    const dir = new THREE.Vector3(Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), Math.cos(player.yaw) * Math.cos(player.pitch));
    camera.lookAt(camera.position.clone().add(dir));
    camera.updateMatrixWorld(true);
    vm.setMoveState(state.move);
    vm.update(dt, player as unknown as PlayerController, weapons as unknown as WeaponSystem, now);
    if (flashT > 0) {
      flashT -= dt;
      if (flashT <= 0) flash.visible = false;
    }
  };
  const render = () => {
    marker.visible = state.markerOn && WEAPONS[weapons.current].ranged;
    if (marker.visible) marker.position.copy(vm.muzzleWorld(camera));
    renderer.render(scene, camera);
    vm.render(renderer, camera);
    hud();
  };

  // ---------------------------------------------------------------- interface
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:12px/1.4 monospace;color:#f2e8d8;text-shadow:0 0 3px #000;';
  root.appendChild(overlay);
  const cross = document.createElement('div');
  cross.style.cssText = 'position:fixed;left:50%;top:50%;width:9px;height:9px;margin:-5px 0 0 -5px;pointer-events:none;';
  cross.innerHTML = '<div style="position:absolute;left:4px;top:0;width:1px;height:9px;background:#0f0"></div><div style="position:absolute;top:4px;left:0;height:1px;width:9px;background:#0f0"></div>';
  root.appendChild(cross);
  const info = document.createElement('div');
  info.style.cssText = 'position:fixed;left:10px;top:8px;';
  overlay.appendChild(info);
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:10px;bottom:10px;display:flex;flex-wrap:wrap;gap:4px;max-width:520px;pointer-events:auto;';
  root.appendChild(bar);
  if (params.has('noui')) bar.style.display = info.style.display = 'none';
  const button = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:11px monospace;padding:3px 6px;background:#2a2220cc;color:#f2e8d8;border:1px solid #6a5a4a;cursor:pointer;';
    b.onclick = (ev) => {
      ev.stopPropagation();
      fn();
    };
    bar.appendChild(b);
  };
  for (const w of ORDER) button(`${w + 1} ${WEAPON_NAMES[w]}`, () => setWeapon(w));
  button('9 arme bras G', () => armOut('L'));
  button('8 arme bras D', () => armOut('R'));
  button('Q capacité G', () => ability('L'));
  button('E capacité D', () => ability('R'));
  button('C charge', charge);
  button('X posture', () => move(MOVES[(MOVES.indexOf(state.move) + 1) % MOVES.length]));
  button('V vision', () => {
    state.vision = state.vision === 'normal' ? 'thermal' : 'normal';
    vm.setVision(state.vision);
  });
  button('L Dadou/Even', () => api.set({ look: state.look === 'dadou' ? 'even' : 'dadou' }));
  button('A viser', () => (state.aimToggle = player.aiming = !player.aiming));
  button('F tirer/frapper', fire);
  button('R recharger', reload);
  button('W marcher', () => (state.walk = state.walk ? 0 : 1));
  button('Maj courir', () => (player.sprint = !player.sprint));
  button('Espace sauter', () => (state.jumpT = 0));
  button('N jour/nuit', () => applyEnv(state.env === 'day' ? 'night' : state.env === 'night' ? 'indoor' : 'day'));
  button('M bouche', () => (state.markerOn = !state.markerOn));
  button('P pause', () => (state.paused = !state.paused));
  const hud = () => {
    const w = weapons.current;
    info.innerHTML =
      `<b>Vue subjective</b> — ${WEAPON_NAMES[w]} — ${state.look === 'dadou' ? 'Dadou' : 'Even'} — ${state.env}<br>` +
      `${player.aiming ? 'visée · ' : ''}${state.walk ? (player.sprint ? 'course · ' : 'marche · ') : ''}${weapons.reloading(now) ? 'rechargement · ' : ''}munitions ${WEAPONS[w].ranged ? weapons.mag.get(w) : '—'}${state.paused ? ' · pause' : ''}<br>` +
      `bras G : ${armId('L') ?? 'chair'} · bras D : ${armId('R') ?? 'chair'} · posture : ${MOVE_NAMES[state.move]}${state.vision === 'thermal' ? ' · thermique' : ''}`;
  };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '7') setWeapon((Number(k) - 1) as Weapon);
    else if (k === '9') armOut('L');
    else if (k === '8') armOut('R');
    else if (k === 'q') ability('L');
    else if (k === 'e') ability('R');
    else if (k === 'c') charge();
    else if (k === 'x') move(MOVES[(MOVES.indexOf(state.move) + 1) % MOVES.length]);
    else if (k === 'v') {
      state.vision = state.vision === 'normal' ? 'thermal' : 'normal';
      vm.setVision(state.vision);
    }
    else if (k === 'l') api.set({ look: state.look === 'dadou' ? 'even' : 'dadou' });
    else if (k === 'a') state.aimToggle = player.aiming = !player.aiming;
    else if (k === 'f') fire();
    else if (k === 'r') reload();
    else if (k === 'w') state.walk = state.walk ? 0 : 1;
    else if (k === 'shift') player.sprint = !player.sprint;
    else if (k === ' ') state.jumpT = 0;
    else if (k === 'n') applyEnv(state.env === 'day' ? 'night' : state.env === 'night' ? 'indoor' : 'day');
    else if (k === 'm') state.markerOn = !state.markerOn;
    else if (k === 'p') state.paused = !state.paused;
  });
  let drag: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  renderer.domElement.addEventListener('mousedown', (e) => {
    if (e.button === 2) player.aiming = true;
    else if (e.button === 0) {
      if (e.shiftKey) drag = { x: e.clientX, y: e.clientY };
      else {
        state.trigger = true;
        fire();
      }
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) player.aiming = state.aimToggle;
    if (e.button === 0) state.trigger = false;
    drag = null;
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    player.yaw -= (e.clientX - drag.x) * 0.004;
    player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch - (e.clientY - drag.y) * 0.004));
    drag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // ---------------------------------------------------------------- API de capture
  const api = {
    set(o: { weapon?: Weapon; look?: Slot; aim?: boolean; walk?: number; sprint?: boolean; env?: EnvKind; marker?: boolean; yaw?: number; pitch?: number }) {
      if (o.weapon !== undefined) setWeapon(o.weapon);
      if (o.look) {
        state.look = o.look;
        vm.setLook(o.look, {});
      }
      if (o.aim !== undefined) player.aiming = state.aimToggle = o.aim;
      if (o.walk !== undefined) state.walk = o.walk;
      if (o.sprint !== undefined) player.sprint = o.sprint;
      if (o.env) applyEnv(o.env);
      if (o.marker !== undefined) state.markerOn = o.marker;
      if (o.yaw !== undefined) player.yaw = o.yaw;
      if (o.pitch !== undefined) player.pitch = o.pitch;
    },
    /** Avance la simulation de `sec` secondes (pas de 1/60 s) puis dessine. */
    step(sec: number) {
      const n = Math.max(1, Math.round(sec * 60));
      for (let i = 0; i < n; i++) step(1 / 60);
      render();
    },
    /** Tourne la tête de `dyaw` radians pendant `sec` secondes (teste l'inertie). */
    turn(dyaw: number, sec: number) {
      const n = Math.max(1, Math.round(sec * 60));
      for (let i = 0; i < n; i++) {
        player.yaw += dyaw / n;
        step(1 / 60);
      }
      render();
    },
    fire,
    /** Rafale : `n` tirs au rythme de l'arme (la simulation avance entre deux tirs). */
    burst(n: number) {
      for (let i = 0; i < n; i++) {
        fire();
        const dt = Math.max(1 / 60, WEAPONS[weapons.current].cooldown);
        const k = Math.max(1, Math.round(dt * 60));
        for (let j = 0; j < k; j++) step(1 / 60);
      }
      render();
    },
    swing: () => vm.swing(),
    reload,
    /** Fige le rechargement de l'arme courante à la fraction `t` (0..1) puis dessine. */
    reloadAt(t: number) {
      const def = WEAPONS[weapons.current];
      if (!def.ranged) return;
      weapons.reloadUntil = now + 1e-4 + def.reload * (1 - t);
      step(1e-4);
      render();
    },
    jump: () => (state.jumpT = 0),
    /** Implants (liste « emplacement=identifiant:niveau » ou nom d'un préréglage). */
    cyber(list: string[] | string) {
      state.cyber = typeof list === 'string' ? (CYBER_PRESETS[list] ?? list.split(',').filter(Boolean)) : list;
      vm.setCyber(state.cyber);
    },
    /** Sortir l'arme du bras ('L', 'R') ou la rentrer (null). */
    arm: armOut,
    ability,
    action: (side: 'L' | 'R', a: string) => vm.armAction(side, a),
    move,
    grapple,
    charge,
    vision(m: 'normal' | 'thermal') {
      state.vision = m;
      vm.setVision(m);
    },
    /** La vue elle-même (mise au point). */
    viewmodel: vm,
    render,
    now: () => now,
    muzzle() {
      const p = vm.muzzleWorld(camera).clone().project(camera);
      return { x: ((p.x + 1) / 2) * window.innerWidth, y: ((1 - p.y) / 2) * window.innerHeight };
    },
  };
  (window as unknown as { __vm: typeof api }).__vm = api;
  api.step(0.6);
  let last = performance.now();
  const loop = (t: number) => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (!state.paused) {
      step(dt);
      render();
    }
    requestAnimationFrame(loop);
  };
  if (!state.paused) requestAnimationFrame(loop);
}

/** Planche des modèles (?vm&inspect=pistol,smg…) : chaque pièce à plat, sous plusieurs angles. */
function startInspect(renderer: THREE.WebGLRenderer, which: string): void {
  envUniforms.uNight.value = 0;
  envUniforms.uSkyAmb.value.setRGB(0.52, 0.56, 0.66);
  const d = envUniforms.uLightTex.value!.image.data as Uint8Array;
  for (let i = 0; i < 8; i++) {
    d[i * 2] = 255;
    d[i * 2 + 1] = 0;
  }
  envUniforms.uLightTex.value!.needsUpdate = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6d7480);
  const sun = new THREE.DirectionalLight(0xfff4e8, 1.6);
  sun.position.set(-2, 4, 3);
  scene.add(sun);
  const mat = createObjectMaterial({ noFog: true, key: 'inspect' });
  const look = (boss: 'dadou' | 'even') =>
    VM.armLookFor(
      boss,
      boss === 'dadou'
        ? { skin: 0xdcb08a, coat: 0x161418, coat2: 0x9e1b26, shirt: 0xece6da, accent: 0xd9a640, vest: 0x5a1218 }
        : { skin: 0xecc6a4, coat: 0x1d3461, coat2: 0x2c4a80, shirt: 0xf2eee6, accent: 0xc9d1dc, vest: 0x8a8f98 },
    );
  const mesh = (m: Parameters<typeof meshModel>[0], pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0]) => {
    const o = new THREE.Mesh(meshModel(m), mat);
    o.position.set(...pos);
    o.rotation.set(...rot);
    return o;
  };
  const group = (...objs: THREE.Object3D[]) => {
    const g = new THREE.Group();
    g.add(...objs);
    return g;
  };
  const groups: Record<string, () => THREE.Object3D> = {
    pistol: () => {
      const p = VM.pistolModels();
      return group(mesh(p.frame), mesh(p.slide), mesh(p.grip, [0, 0, 0], VM.PISTOL.gripRot), mesh(p.mag, [0, 0, 0], VM.PISTOL.gripRot));
    },
    smg: () => {
      const p = VM.smgModels();
      return group(mesh(p.body), mesh(p.grip, [0, 0, 0], VM.SMG.gripRot), mesh(p.foregrip, VM.SMG.support!, VM.SMG.supportRot), mesh(p.mag), mesh(p.handle));
    },
    shotgun: () => {
      const p = VM.shotgunModels();
      return group(mesh(p.body), mesh(p.grip, [0, 0, 0], VM.SHOTGUN.gripRot), mesh(p.pump));
    },
    rifle: () => {
      const p = VM.rifleModels();
      return group(mesh(p.body), mesh(p.grip, [0, 0, 0], VM.RIFLE.gripRot), mesh(p.cell), ...p.ringsLit.map((m) => mesh(m)));
    },
    rifleOff: () => {
      const p = VM.rifleModels();
      return group(mesh(p.body), mesh(p.grip, [0, 0, 0], VM.RIFLE.gripRot), mesh(p.cell), ...p.rings.map((m) => mesh(m)));
    },
    knife: () => mesh(VM.knifeModel()),
    club: () => mesh(VM.clubModel()),
    items: () => {
      const kinds: VM.CasingKind[] = ['pistol', 'shell', 'mag', 'smgMag', 'cell', 'cellSpent'];
      return group(...kinds.map((k, i) => mesh(VM.casingModel(k), [0, 0, -i * 0.06])));
    },
  };
  // arme + main(s) dans leur repère commun (comme en jeu)
  const withHands = (name: string, slots: [VM.HandPose, 'R' | 'L', [number, number, number], [number, number, number]][], boss: 'dadou' | 'even') => {
    groups[`${name}+${boss}`] = () => {
      const g = groups[name]();
      for (const [pose, side, pos, rot] of slots) {
        const a = VM.armModels(side, pose, look(boss));
        g.add(mesh(a.hand, pos, rot));
      }
      return g;
    };
  };
  for (const boss of ['dadou', 'even'] as const) {
    withHands('pistol', [['pistol', 'R', [0, 0, 0], VM.PISTOL.gripRot]], boss);
    withHands('smg', [['pistol', 'R', [0, 0, 0], VM.SMG.gripRot], ['pistol', 'L', VM.SMG.support!, VM.SMG.supportRot]], boss);
    withHands('shotgun', [['pistol', 'R', [0, 0, 0], VM.SHOTGUN.gripRot], ['support', 'L', VM.SHOTGUN.support!, VM.SHOTGUN.supportRot]], boss);
    withHands('rifle', [['pistol', 'R', [0, 0, 0], VM.RIFLE.gripRot], ['support', 'L', VM.RIFLE.support!, VM.RIFLE.supportRot]], boss);
    withHands('knife', [['blade', 'R', [0, 0, 0], [0, 0, 0]]], boss);
    withHands('club', [['blade', 'R', [0, 0, 0], [0, 0, 0]]], boss);
  }
  for (const pose of ['pistol', 'stock', 'support', 'fist', 'blade'] as VM.HandPose[]) {
    for (const boss of ['dadou', 'even'] as const) {
      groups[`${pose}-${boss}`] = () => {
        const side = pose === 'support' ? 'L' : 'R';
        const a = VM.armModels(side, pose, look(boss));
        const f = mesh(a.forearm, a.wrist, [-0.6, 0, 0]);
        return group(mesh(a.hand), f);
      };
    }
  }
  // avant-bras mécaniques (vue subjective) : coque, pièces déployées, main mécanique
  const cd = new CyberShaderData(1);
  for (let ch = 0; ch < 16; ch++) cd.setGlow(0, ch, 1.4);
  cd.flush();
  const cmat = patchCharMaterial(createObjectMaterial({ noFog: true, key: 'inspect-cy' }), cd);
  const cmesh = (m: Parameters<typeof meshChar>[0], pos: [number, number, number] = [0, 0, 0]) => {
    const o = new THREE.Mesh(meshChar(m, 3), cmat);
    o.position.set(...pos);
    return o;
  };
  const S2 = Math.SQRT1_2;
  for (const id of ARM_IMPLANTS as readonly ArmImplant[]) {
    for (const side of ['R', 'L'] as const) {
      groups[`cy${side === 'L' ? 'L' : ''}-${id}`] = () => {
        const lk = look(side === 'L' ? 'even' : 'dadou');
        const a = cyberForearmFP(id, 3, side, lk);
        const g = group(cmesh(a.forearm));
        const podAx = new THREE.Vector3(S2, side === 'L' ? S2 : -S2, 0);
        const pivots = new Map<string, THREE.Group>();
        for (const p of a.parts) {
          const pivot = new THREE.Group();
          pivot.position.set(...p.pivot);
          const m = cmesh(p.model, [-p.pivot[0], -p.pivot[1], -p.pivot[2]]);
          pivot.add(m);
          pivots.set(p.name, pivot);
          // pièces en position déployée
          if (p.name === 'plateA' || p.name === 'plateB') pivot.rotation.z = -Math.sign(p.pivot[0]) * Math.PI;
          else if (p.name === 'barrel') pivot.position.z -= a.travel.barrel ?? 0;
          else if (p.name === 'blade') pivot.position.z -= a.travel.blade ?? 0;
          else if (p.name === 'rods') pivot.position.z += a.travel.rods ?? 0;
          else if (p.name === 'probe') pivot.position.z -= a.travel.probe ?? 0;
          else if (p.name === 'pod') pivot.quaternion.setFromAxisAngle(podAx, 0.5);
          else if (p.name === 'cover') {
            const pod = a.parts.find((q) => q.name === 'pod');
            const qp = new THREE.Quaternion().setFromAxisAngle(podAx, 0.5);
            if (pod) pivot.position.sub(new THREE.Vector3(...pod.pivot)).applyQuaternion(qp).add(new THREE.Vector3(...pod.pivot));
            pivot.quaternion.copy(qp).multiply(new THREE.Quaternion().setFromAxisAngle(podAx, -1.7));
          }
          g.add(pivot);
        }
        const h = VM.mechHandModel(side, id === 'fouet' ? 'relax' : 'wfist', lk, fpMech(id, side));
        g.add(cmesh(h.hand, [-h.wrist[0], -h.wrist[1], -h.wrist[2]]));
        return g;
      };
    }
  }
  const names = which ? which.split(',') : Object.keys(groups);
  const params = new URLSearchParams(location.search);
  // vues : de gauche (côté visible en jeu), de trois quarts arrière-haut (œil du tireur), de droite, de dessus
  const views: [number, number][] = [
    [-Math.PI / 2, 0],
    [Math.PI + 0.55, 0.55],
    [Math.PI / 2, 0],
    [0, Math.PI / 2],
  ];
  const quads: Record<string, number> = {};
  // une ligne par modèle (4 vues) ; avec un seul modèle : grille 2 × 2
  const single = names.length === 1;
  const cols = single ? 2 : 4;
  const rows = single ? 2 : names.length;
  const aspect = window.innerWidth / window.innerHeight;
  const cellH = 1;
  const cellW = (cellH * rows * aspect) / cols;
  names.forEach((n, row) => {
    views.forEach(([ry, rx], vi) => {
      const o = groups[n]();
      if (params.has('noarm')) o.children.slice(1).forEach((c) => (c.visible = false));
      o.traverse((m) => {
        if (m instanceof THREE.Mesh && m.visible && vi === 0) quads[n] = (quads[n] ?? 0) + m.geometry.userData.quads;
      });
      const pivot = new THREE.Group();
      pivot.add(o);
      pivot.rotation.set(rx, ry, 0, 'YXZ');
      pivot.updateMatrixWorld(true);
      const box = new THREE.Box3();
      o.traverse((m) => {
        if (m instanceof THREE.Mesh && m.visible) box.expandByObject(m);
      });
      const size = box.getSize(new THREE.Vector3());
      const k = 0.9 * Math.min(cellW / Math.max(1e-3, size.x), cellH / Math.max(1e-3, size.y));
      const c = box.getCenter(new THREE.Vector3());
      const holder = new THREE.Group();
      holder.add(pivot);
      pivot.position.copy(c).multiplyScalar(-1);
      holder.scale.setScalar(k);
      const col = single ? vi % 2 : vi;
      const r = single ? Math.floor(vi / 2) : row;
      holder.position.set((col - (cols - 1) / 2) * cellW, -(r - (rows - 1) / 2) * cellH, 0);
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
  (window as unknown as { __vm: object }).__vm = { quads, render: () => renderer.render(scene, camera) };
}
