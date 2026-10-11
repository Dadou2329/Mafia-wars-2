// Banc d'essai des effets cybernétiques (développement, route ?fx) : une rue de nuit (sol, mur,
// néon, terminal, accessoires), des personnages (ou des silhouettes de secours), et des boutons
// pour déclencher chaque capacité (événements « ab »), chaque état visible (bits CFX, animations),
// les visions et teintes, les surimpressions, et chaque nouveau son.
//
// ?fx&w=800&h=450 (taille de rendu) · &still (pas de boucle : rendu à la demande) · &nobloom
// API de capture (Playwright) : window.__fx — play(ab), setFx(i, bits), setAnim(i, anim),
// move(i, on), vision(mode), tint(kind), cam(nom | [px,py,pz,tx,ty,tz]), pause(b), step(s),
// render(), overlay(...), sound(nom), soundReport(), loopReport(), stats().

import * as THREE from 'three';
import { Anim, CharKind, Weapon } from '../../shared/characters';
import { CFX } from '../../shared/implants';
import { M } from '../../shared/materials';
import { GROUND_VY, INV_VOXEL, VoxelWorld } from '../../shared/voxel';
import { AudioEngine, audio } from '../audio/AudioEngine';
import { LOOP_NAMES, SFX_NAMES, type LoopName, type SfxName } from '../audio/types';
import type { CharView } from '../characters/characterRenderer';
import { CyberFx, type FxEntity } from '../game/cyberFx';
import { CyberOverlay, type OverlayTint, type ScanReveal } from '../game/cyberOverlay';
import { Effects } from '../game/effects';
import { EngineSounds, type LoopSource } from '../game/engineSounds';
import { createMaterialTexture, envUniforms } from '../render/env';
import { PostFX, type TintKind, type VisionMode } from '../render/post';

/** Centre de la scène dans le petit monde voxel (coordonnées positives). */
const O = new THREE.Vector3(30, 0, 30);
const WALL_Z = O.z - 4;

const NEW_SFX: SfxName[] = SFX_NAMES.slice(SFX_NAMES.indexOf('grapple_fire')) as SfxName[];
const NEW_LOOPS: LoopName[] = ['grapple_reel', 'slide_scrape', 'shield_hum', 'camo_hum'];
const REF_SFX: SfxName[] = ['pistol', 'smg', 'shotgun', 'explosion', 'punch', 'swing', 'stun_baton', 'hit_metal', 'ui_click', 'ui_open', 'footstep_concrete'];

interface Dummy {
  view: CharView;
  fx: number;
  anim: Anim;
  moving: boolean;
  home: THREE.Vector3;
  homeYaw: number;
  phase: number;
  box: THREE.Group | null;
}

export async function startFxLab(root: HTMLElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  const W = Number(params.get('w') ?? 0) || window.innerWidth;
  const H = Number(params.get('h') ?? 0) || window.innerHeight;
  root.style.cssText = 'position:relative;width:100vw;height:100vh;overflow:hidden;background:#05060d;';
  // ------------------------------------------------------------------ éclairage d'ambiance (nuit)
  createMaterialTexture();
  const lightData = new Uint8Array(16).fill(150);
  const lightTex = new THREE.Data3DTexture(lightData, 2, 2, 2);
  lightTex.format = THREE.RGFormat;
  lightTex.needsUpdate = true;
  envUniforms.uLightTex.value = lightTex;
  envUniforms.uLightOrigin.value.set(-1000, -1000, -1000);
  envUniforms.uLightSize.value.set(2000, 2000, 2000);
  envUniforms.uNight.value = 0.9;
  envUniforms.uSkyAmb.value.setRGB(0.16, 0.19, 0.3);
  envUniforms.uLampCol.value.setRGB(0.55, 0.38, 0.24);
  envUniforms.uFogColor.value.setRGB(0.05, 0.06, 0.1);
  envUniforms.uFogDensity.value = 0.012;
  // ------------------------------------------------------------------ rendu
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;`;
  root.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070a14);
  const camera = new THREE.PerspectiveCamera(62, W / H, 0.08, 300);
  const hemi = new THREE.HemisphereLight(0x6a7ab8, 0x2a2018, 1.25);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xaab8ff, 0.7);
  moon.position.set(O.x + 8, 20, O.z + 12);
  scene.add(moon);
  const lamp = new THREE.PointLight(0xffb070, 18, 18, 1.6);
  lamp.position.set(O.x - 4, 5.5, O.z + 1);
  scene.add(lamp);
  const neonLight = new THREE.PointLight(0xff3cc8, 6, 9, 1.6);
  neonLight.position.set(O.x + 2, 3.2, WALL_Z + 0.8);
  scene.add(neonLight);
  // sol : asphalte, lignes, flaques sombres
  const tc = document.createElement('canvas');
  tc.width = tc.height = 512;
  const c2 = tc.getContext('2d')!;
  c2.fillStyle = '#3a3c42';
  c2.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 3000; i++) {
    const v = 40 + Math.random() * 34;
    c2.fillStyle = `rgb(${v},${v + 1},${v + 5})`;
    c2.fillRect(Math.random() * 512, Math.random() * 512, 3, 3);
  }
  // dalles de trottoir (joints)
  c2.strokeStyle = 'rgba(10,10,14,0.55)';
  c2.lineWidth = 3;
  for (let i = 0; i <= 512; i += 128) {
    c2.beginPath();
    c2.moveTo(0, i);
    c2.lineTo(512, i);
    c2.moveTo(i, 0);
    c2.lineTo(i, 512);
    c2.stroke();
  }
  const groundTex = new THREE.CanvasTexture(tc);
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(15, 15);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ map: groundTex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(O.x, 0, O.z);
  scene.add(ground);
  // mur de béton, bande de néon, terminal
  const wall = new THREE.Mesh(new THREE.BoxGeometry(18, 7, 0.5), new THREE.MeshLambertMaterial({ color: 0x55565c }));
  wall.position.set(O.x, 3.5, WALL_Z - 0.25);
  scene.add(wall);
  for (const [x, y, w, col] of [
    [O.x + 2, 3.1, 4, 0xff3cc8],
    [O.x - 3, 4.6, 2.4, 0x3ce8ff],
  ] as const) {
    const n = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, 0.1), new THREE.MeshBasicMaterial({ color: col }));
    n.position.set(x, y, WALL_Z + 0.06);
    scene.add(n);
  }
  const term = new THREE.Group();
  const tb = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.5, 0.45), new THREE.MeshLambertMaterial({ color: 0x2c3038 }));
  tb.position.y = 0.75;
  const ts = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.36), new THREE.MeshBasicMaterial({ color: 0x48ffa0 }));
  ts.position.set(0, 1.12, 0.231);
  term.add(tb, ts);
  term.position.set(O.x - 0.6, 0, WALL_Z + 0.25);
  scene.add(term);
  // caisses
  for (const [x, z, s] of [
    [O.x + 6, O.z - 2.6, 1.1],
    [O.x + 6.9, O.z - 2.2, 0.8],
    [O.x - 7, O.z + 1.5, 1],
  ]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshLambertMaterial({ color: 0x6a5a40 }));
    b.position.set(x, s / 2, z);
    b.rotation.y = x * 1.3;
    scene.add(b);
  }
  // petit monde voxel pour les lancers de rayon des effets (sol, mur, terminal)
  const vw = new VoxelWorld(240, 96, 240);
  const conc = M.CONCRETE;
  vw.fill(0, 0, 0, 239, GROUND_VY - 1, 239, conc);
  const vx = (x: number) => Math.floor(x * INV_VOXEL);
  const vy = (y: number) => Math.floor(y * INV_VOXEL) + GROUND_VY;
  vw.fill(vx(O.x - 9), vy(0), vx(WALL_Z - 0.5), vx(O.x + 9), vy(7), vx(WALL_Z) - 1, conc);
  vw.fill(vx(O.x - 0.95), vy(0), vx(WALL_Z + 0.03), vx(O.x - 0.25), vy(1.5), vx(WALL_Z + 0.47), conc);
  // ------------------------------------------------------------------ effets
  const effects = new Effects();
  scene.add(effects.group);
  const fx = new CyberFx(vw, effects);
  scene.add(fx.group);
  fx.selfId = 1;
  const post = new PostFX(renderer, scene, camera);
  post.setEnabled(!params.has('nobloom'));
  const overlayHost = document.createElement('div');
  overlayHost.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;`;
  root.appendChild(overlayHost);
  const overlay = new CyberOverlay(overlayHost);
  const engines = new EngineSounds();
  // ------------------------------------------------------------------ personnages
  let nextId = 1;
  const mkView = (kind: CharKind, faction: number, x: number, z: number, yaw: number, weapon: Weapon, extra: Partial<CharView> = {}): CharView => ({
    id: nextId++,
    kind,
    faction,
    look: 3 + nextId * 7,
    gang: 1,
    x,
    y: 0,
    z,
    yaw,
    pitch: 0,
    vx: 0,
    vz: 0,
    anim: Anim.IDLE,
    aiming: false,
    weapon,
    shotAt: -10,
    hitAt: -10,
    meleeAt: -10,
    interactAt: -10,
    deathAt: -10,
    ...extra,
  });
  const dummies: Dummy[] = [
    mkView(CharKind.BOSS_DADOU, 1, O.x - 2.6, O.z + 0.6, Math.PI / 2, Weapon.FISTS, { cyber: ['brasD=poing:3', 'brasG=grappin:3', 'jambes1=sprint:2', 'yeux1=thermique:2'] }),
    mkView(CharKind.BOSS_EVEN, 2, O.x + 1.4, O.z - 0.4, -Math.PI / 2, Weapon.PISTOL, { cyber: ['brasD=lame:2', 'torse1=surcharge:2'] }),
    mkView(CharKind.GANGSTER, 2, O.x + 3.1, O.z + 1.3, -Math.PI / 2 - 0.3, Weapon.SMG),
    mkView(CharKind.POLICE, 3, O.x + 4.6, O.z - 1.2, -Math.PI / 2 + 0.3, Weapon.PISTOL),
    mkView(CharKind.THUG, 0, O.x - 5.2, O.z + 3.2, 0.6, Weapon.KNIFE),
  ].map((view, i) => ({ view, fx: 0, anim: Anim.IDLE, moving: false, home: new THREE.Vector3(view.x, 0, view.z), homeYaw: view.yaw, phase: i * 1.3, box: null }));
  let chars: { update(v: CharView[], c: THREE.Camera, now: number, dt: number): void; group: THREE.Group } | null = null;
  try {
    const m = await import('../characters/characterRenderer');
    const cr = new m.CharacterRenderer();
    scene.add(cr.group);
    chars = cr;
  } catch (e) {
    console.warn('Personnages indisponibles, silhouettes de secours :', e);
  }
  const boxFallback = () => {
    for (const d of dummies) {
      if (d.box) continue;
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: d.view.faction === 1 ? 0x8a2a30 : d.view.faction === 2 ? 0x2a4a8a : 0x5a5a60 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.1, 0.26), mat);
      body.position.y = 1.05;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.22), new THREE.MeshLambertMaterial({ color: 0xc89a7a }));
      head.position.y = 1.72;
      const legs = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.55, 0.22), new THREE.MeshLambertMaterial({ color: 0x24252a }));
      legs.position.y = 0.28;
      g.add(body, head, legs);
      scene.add(g);
      d.box = g;
    }
  };
  if (!chars) boxFallback();
  // ------------------------------------------------------------------ caméra
  const cams: Record<string, number[]> = {
    side: [O.x + 0.6, 2.4, O.z + 8.2, O.x + 0.8, 1.2, O.z - 0.6],
    mid: [O.x + 0.2, 1.9, O.z + 5.4, O.x + 0.4, 1.15, O.z - 0.2],
    close: [O.x - 0.6, 1.75, O.z + 3.6, O.x - 2.4, 1.05, O.z + 0.4],
    top: [O.x + 0.5, 9.5, O.z + 8.5, O.x + 0.5, 0, O.z - 0.5],
    wide: [O.x, 4.2, O.z + 13, O.x, 1.6, O.z - 2],
    wall: [O.x + 1, 3.2, O.z + 5.5, O.x + 1.8, 3.6, WALL_Z],
    fp: [O.x - 2.45, 1.62, O.z + 0.6, O.x + 4, 1.2, O.z + 0.2],
    target: [O.x + 4.2, 1.9, O.z + 4.4, O.x + 1.6, 1.0, O.z - 0.2],
  };
  const camTarget = new THREE.Vector3();
  const setCam = (v: number[]) => {
    camera.position.set(v[0], v[1], v[2]);
    camTarget.set(v[3], v[4], v[5]);
    camera.lookAt(camTarget);
    camera.updateMatrixWorld();
  };
  setCam(cams.side);
  // orbite à la souris (glisser) et zoom (molette)
  let drag: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY }));
  window.addEventListener('pointerup', () => (drag = null));
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY };
    const off = camera.position.clone().sub(camTarget);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta -= dx * 0.006;
    sph.phi = Math.max(0.15, Math.min(1.5, sph.phi - dy * 0.006));
    camera.position.copy(camTarget).add(new THREE.Vector3().setFromSpherical(sph));
    camera.lookAt(camTarget);
  });
  renderer.domElement.addEventListener('wheel', (e) => {
    const off = camera.position.clone().sub(camTarget).multiplyScalar(e.deltaY > 0 ? 1.1 : 0.9);
    camera.position.copy(camTarget).add(off);
  });
  // ------------------------------------------------------------------ simulation
  let time = 1;
  let paused = params.has('still');
  let marksOn = false;
  let threatsOn = false;
  let speedV = 0;
  /** Vue subjective du parrain 0 : il n'est plus dessiné, le câble part du lanceur à l'écran. */
  let fpMode = false;
  const caster = dummies[0];
  const chest = (d: Dummy) => ({ x: d.view.x, y: d.view.y + 1.2, z: d.view.z });
  const feet = (d: Dummy) => ({ x: d.view.x, y: d.view.y, z: d.view.z });
  const hand = (d: Dummy, side = 1) => {
    const s = Math.sin(d.view.yaw);
    const c = Math.cos(d.view.yaw);
    return { x: d.view.x + s * 0.4 - c * 0.24 * side, y: d.view.y + 1.25, z: d.view.z + c * 0.4 + s * 0.24 * side };
  };
  const ahead = (d: Dummy, dist: number, h = 1.2) => ({ x: d.view.x + Math.sin(d.view.yaw) * dist, y: d.view.y + h, z: d.view.z + Math.cos(d.view.yaw) * dist });
  const targets = () => dummies.slice(1, 4).map(chest);

  /** Préréglages de chaque capacité dans la scène. */
  const PRESETS: Record<string, () => [{ x: number; y: number; z: number }, { x: number; y: number; z: number } | null, { v?: number; targets?: { x: number; y: number; z: number }[]; id?: number }]> = {
    grappin: () => [hand(caster, -1), { x: O.x + 1.6, y: 4.4, z: WALL_Z + 0.02 }, { v: 0.22, id: caster.view.id }],
    'grappin-fin': () => [hand(caster, -1), null, { id: caster.view.id }],
    treuil: () => [feet(dummies[2]), feet(caster), { id: caster.view.id }],
    esquive: () => [feet(caster), { x: caster.view.x + 4.5, y: 0, z: caster.view.z + 0.6 }, { id: caster.view.id }],
    doubleSaut: () => [{ x: caster.view.x, y: 1.4, z: caster.view.z }, null, { id: caster.view.id }],
    'bond-charge': () => [feet(caster), null, { id: caster.view.id }],
    bond: () => [feet(caster), ahead(caster, 12, 0), { v: 1, id: caster.view.id }],
    atterrissage: () => [feet(caster), null, { v: 0.9, id: caster.view.id }],
    onde: () => [feet(caster), null, { v: 5, id: caster.view.id }],
    sautMural: () => [{ x: O.x - 1, y: 1.2, z: WALL_Z + 0.05 }, { x: O.x - 1, y: 1.2, z: WALL_Z + 1.05 }, {}],
    glissade: () => [feet(caster), ahead(caster, 2, 0), { id: caster.view.id }],
    escalade: () => [{ x: O.x - 6.6, y: 1.0, z: O.z + 1.5 }, null, {}],
    'bras-sortie': () => [hand(caster, 1), null, { v: 1, id: caster.view.id }],
    'bras-rentre': () => [hand(caster, 1), null, { v: 1, id: caster.view.id }],
    lame: () => [chest(caster), ahead(caster, 2), { targets: [chest(dummies[1])], id: caster.view.id }],
    'poing-charge': () => [hand(caster, 1), null, { id: caster.view.id }],
    poing: () => [hand(caster, 1), { x: dummies[1].view.x - 0.25, y: 1.25, z: dummies[1].view.z }, { v: 1, id: caster.view.id }],
    fouet: () => [hand(caster, 1), { x: caster.view.x + 5, y: 1.0, z: caster.view.z - 0.4 }, { targets: [chest(dummies[1])], id: caster.view.id }],
    bouclier: () => [feet(caster), null, { v: 130, id: caster.view.id }],
    'bouclier-impact': () => [ahead(caster, 1.15, 1.3 + (Math.random() - 0.5) * 0.6), null, { id: caster.view.id }],
    'bouclier-brise': () => [ahead(caster, 1.1, 1.2), null, { id: caster.view.id }],
    'bouclier-fin': () => [feet(caster), null, { id: caster.view.id }],
    repulseur: () => [hand(caster, 1), ahead(caster, 9, 1.1), { v: 80, targets: [chest(dummies[1]), chest(dummies[2])], id: caster.view.id }],
    choc: () => [hand(caster, 1), null, { v: 0, targets: targets(), id: caster.view.id }],
    'choc-iem': () => [hand(caster, 1), null, { v: 1, targets: targets(), id: caster.view.id }],
    roquette: () => [{ x: caster.view.x, y: 1.6, z: caster.view.z }, chest(dummies[3]), { v: 0.55, id: caster.view.id }],
    scanner: () => [feet(caster), null, { v: 14, id: caster.view.id }],
    camouflage: () => [feet(caster), null, { id: caster.view.id }],
    'camouflage-fin': () => [feet(caster), null, { id: caster.view.id }],
    reflexes: () => [feet(caster), null, { id: caster.view.id }],
    surcharge: () => [feet(caster), null, { id: caster.view.id }],
    secondSouffle: () => [feet(caster), null, { id: caster.view.id }],
    nanobots: () => [feet(caster), null, { v: 12, id: caster.view.id }],
    drone: () => [{ x: caster.view.x - 0.4, y: 2.2, z: caster.view.z + 0.3 }, null, { id: caster.view.id }],
    piratage: () => [hand(caster, 1), { x: O.x - 0.6, y: 1.12, z: WALL_Z + 0.48 }, { v: 3, id: caster.view.id }],
    marque: () => [chest(caster), null, { targets: targets() }],
  };

  const playAb = (ab: string) => {
    const pr = PRESETS[ab];
    if (!pr) return;
    const [p, p2, o] = pr();
    if (ab === 'roquette') {
      // salve de quatre micro-roquettes
      for (let i = 0; i < 4; i++) setTimeout(() => fx.play('roquette', p, { x: p2!.x + (Math.random() - 0.5) * 1.2, y: p2!.y + (Math.random() - 0.5) * 0.8, z: p2!.z + (Math.random() - 0.5) * 1.2 }, { v: 0.5 + i * 0.06, id: o.id }), i * 90);
      return;
    }
    if (ab === 'choc-iem') {
      fx.play('choc', p, p2, o);
      overlay.flash('emp', 0.7);
      return;
    }
    // états qui accompagnent certaines capacités (comme le ferait le serveur)
    if (ab === 'bouclier') caster.fx |= CFX.SHIELD;
    if (ab === 'bouclier-fin' || ab === 'bouclier-brise') caster.fx &= ~CFX.SHIELD;
    if (ab === 'camouflage') caster.fx |= CFX.CAMO;
    if (ab === 'camouflage-fin') caster.fx &= ~CFX.CAMO;
    if (ab === 'grappin') caster.fx |= CFX.GRAPPLE;
    if (ab === 'grappin-fin') caster.fx &= ~CFX.GRAPPLE;
    fx.play(ab, p, p2, o);
    if (ab === 'scanner') {
      const rv: ScanReveal[] = dummies.slice(1).map((d) => ({ ...feet(d), kind: 'enemy' }));
      rv.push({ x: O.x - 0.6, y: 0, z: WALL_Z + 0.25, kind: 'terminal' });
      overlay.scan(p, o.v ?? 14, rv, 6);
    }
    if (ab === 'atterrissage' || ab === 'onde') overlay.flash('land', 0.9);
    if (ab === 'bouclier-brise') overlay.flash('break', 0.8);
    if (ab === 'secondSouffle') overlay.flash('revive', 1);
  };

  const sim = (dt: number) => {
    time += dt;
    for (const d of dummies) {
      const v = d.view;
      if (d.moving) {
        d.phase += dt;
        if (d.anim === Anim.WALLRUN_L || d.anim === Anim.WALLRUN_R) {
          // le long du mur, aller-retour
          const x = O.x - 6 + ((d.phase * 7) % 12);
          v.x = x;
          v.z = WALL_Z + 0.45;
          v.y = 1.2 + Math.sin(d.phase * 3) * 0.1;
          v.yaw = Math.PI / 2;
          v.vx = 7;
          v.vz = 0;
        } else {
          const R = 3.2;
          const w = d.anim === Anim.SLIDE ? 2.4 : 2;
          const a = d.phase * w;
          v.x = d.home.x + Math.cos(a) * R;
          v.z = d.home.z + Math.sin(a) * R;
          v.y = 0;
          v.vx = -Math.sin(a) * R * w;
          v.vz = Math.cos(a) * R * w;
          v.yaw = Math.atan2(v.vx, v.vz);
        }
      } else {
        v.vx = 0;
        v.vz = 0;
      }
      v.anim = d.anim;
      v.fx = d.fx;
      if (d.box) {
        d.box.position.set(v.x, v.y, v.z);
        d.box.rotation.y = v.yaw;
      }
    }
    const list: FxEntity[] = dummies.map((d) => ({ id: d.view.id, x: d.view.x, y: d.view.y, z: d.view.z, yaw: d.view.yaw, fx: d.fx, anim: d.anim, speed: Math.hypot(d.view.vx, d.view.vz), hidden: fpMode && d === caster }));
    caster.view.hidden = fpMode;
    fx.updateEntities(list, time);
    if (fpMode) {
      // lanceur du bras gauche, en bas à gauche de l'écran
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
      const tip = camera.position.clone().addScaledVector(fwd, 0.55).addScaledVector(right, -0.24).addScaledVector(camera.up, -0.2);
      fx.setGrappleFrom(caster.view.id, tip);
    }
    if (chars) {
      try {
        chars.update(
          dummies.map((d) => d.view),
          camera,
          time,
          dt,
        );
      } catch (e) {
        console.warn('Rendu des personnages en échec, silhouettes de secours :', e);
        scene.remove(chars.group);
        chars = null;
        boxFallback();
      }
    }
    fx.update(dt, camera, time);
    effects.update(dt, camera.position);
    // surimpressions de démonstration
    overlay.setMarks(marksOn ? dummies.slice(1, 4).map((d) => ({ id: d.view.id, x: d.view.x, y: d.view.y + 2.15, z: d.view.z })) : []);
    overlay.setThreats(threatsOn ? [0.9, -2.4] : []);
    overlay.setSpeed(speedV);
    overlay.update(dt, camera, W, H);
  };
  let loopAcc = 0;
  const render = () => {
    if (post.needsRender) post.render(1 / 60);
    else renderer.render(scene, camera);
    return renderer.info.render;
  };
  let last = performance.now();
  const loop = () => {
    const t = performance.now();
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (!paused) {
      sim(dt);
      loopAcc += dt;
      if (loopAcc > 0.1) {
        loopAcc = 0;
        const src: LoopSource[] = [];
        fx.loopSources(src);
        engines.update(src, camera.position.x, camera.position.y, camera.position.z);
      }
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      audio.setListener(camera.position, fwd, camera.up);
      audio.update(dt);
      render();
    }
    requestAnimationFrame(loop);
  };
  fx.warm(renderer, camera, scene);
  requestAnimationFrame(loop);

  // ------------------------------------------------------------------ interface
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:absolute;right:0;top:0;bottom:0;width:300px;overflow-y:auto;background:rgba(8,10,20,0.88);color:#dfe6ff;font:12px Rajdhani,system-ui,sans-serif;padding:8px;box-sizing:border-box;z-index:5;';
  root.appendChild(panel);
  if (params.has('nopanel')) panel.style.display = 'none';
  const sec = (title: string) => {
    const h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = 'margin:10px 0 4px;font-weight:700;letter-spacing:.08em;color:#8fdcff;text-transform:uppercase;font-size:11px;';
    panel.appendChild(h);
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;';
    panel.appendChild(box);
    return box;
  };
  const btn = (box: HTMLElement, label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:#1a2036;color:#dfe6ff;border:1px solid #33406a;border-radius:3px;padding:2px 6px;cursor:pointer;font:inherit;';
    b.onclick = () => {
      audio.unlock();
      fn();
    };
    box.appendChild(b);
    return b;
  };
  const mv = sec('Déplacements');
  for (const k of ['grappin', 'grappin-fin', 'treuil', 'esquive', 'doubleSaut', 'bond-charge', 'bond', 'atterrissage', 'onde', 'sautMural', 'glissade', 'escalade']) btn(mv, k, () => playAb(k));
  const cb = sec('Combat');
  for (const k of ['bras-sortie', 'bras-rentre', 'lame', 'poing-charge', 'poing', 'fouet', 'bouclier', 'bouclier-impact', 'bouclier-brise', 'bouclier-fin', 'repulseur', 'choc', 'choc-iem', 'roquette'])
    btn(cb, k, () => playAb(k));
  const ut = sec('Yeux, peau, neural, torse');
  for (const k of ['scanner', 'camouflage', 'camouflage-fin', 'reflexes', 'surcharge', 'secondSouffle', 'nanobots', 'drone', 'piratage', 'marque']) btn(ut, k, () => playAb(k));
  const st = sec('États (personnage choisi)');
  let sel = 0;
  const selBox = document.createElement('select');
  dummies.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${i} — ${['Dadou', 'Even', 'Gangster', 'Police', 'Voyou'][i]}`;
    selBox.appendChild(o);
  });
  selBox.onchange = () => (sel = Number(selBox.value));
  st.appendChild(selBox);
  for (const [name, bit] of Object.entries(CFX)) btn(st, name, () => (dummies[sel].fx ^= bit));
  btn(st, 'aucun', () => (dummies[sel].fx = 0));
  btn(st, 'en mouvement', () => (dummies[sel].moving = !dummies[sel].moving));
  const an = sec('Animation');
  for (const [name, a] of [
    ['IDLE', Anim.IDLE],
    ['RUN', Anim.RUN],
    ['SLIDE', Anim.SLIDE],
    ['DASH', Anim.DASH],
    ['WALLRUN_L', Anim.WALLRUN_L],
    ['WALLRUN_R', Anim.WALLRUN_R],
    ['GRAPPLE', Anim.GRAPPLE],
    ['LEAP', Anim.LEAP],
    ['AIR', Anim.AIR],
  ] as const)
    btn(an, name, () => (dummies[sel].anim = a));
  const vis = sec('Visions et teintes');
  for (const m of ['normal', 'thermal', 'night'] as VisionMode[]) btn(vis, m, () => api.vision(m));
  for (const k of ['aucune', 'reflex', 'overcharge', 'camo', 'secondWind']) btn(vis, k, () => api.tint(k === 'aucune' ? null : (k as TintKind)));
  btn(vis, 'halo on/off', () => post.setEnabled(!post.enabled));
  const ovs = sec('Surimpressions');
  btn(ovs, 'marques', () => (marksOn = !marksOn));
  btn(ovs, 'menaces', () => (threatsOn = !threatsOn));
  let aimI = 0;
  btn(ovs, 'visée grappin', () => overlay.setGrappleAim((['ok', 'far', 'none'] as const)[aimI++ % 3], 21));
  btn(ovs, 'vitesse', () => (speedV = speedV > 0 ? 0 : 22));
  btn(ovs, 'éclair réception', () => overlay.flash('land', 1));
  const cm = sec('Caméra');
  for (const k of Object.keys(cams)) btn(cm, k, () => setCam(cams[k]));
  btn(cm, 'pause', () => (paused = !paused));
  const sd = sec('Sons');
  for (const n of NEW_SFX) btn(sd, n, () => audio.play(n));
  for (const n of NEW_LOOPS) {
    let h: ReturnType<typeof audio.loop> = null;
    btn(sd, `⟳ ${n}`, () => {
      if (h) {
        h.stop();
        h = null;
      } else h = audio.loop(n, { volume: 1 });
    });
  }
  const rep = document.createElement('pre');
  rep.style.cssText = 'white-space:pre-wrap;font:10px monospace;color:#bfe;';
  btn(sd, 'rapport audio', async () => {
    rep.textContent = 'rendu…';
    const r = await api.soundReport();
    rep.textContent = r.map((x) => `${x.name.padEnd(18)} ${x.ok ? 'ok ' : '!! '} loud ${x.loud.toFixed(3)} peak ${x.peak.toFixed(2)} ${x.dur.toFixed(2)} s`).join('\n');
  });
  panel.appendChild(rep);

  // ------------------------------------------------------------------ API de capture
  const analyze = (buf: AudioBuffer) => {
    let peak = 0;
    let nan = 0;
    let sum = 0;
    let n = 0;
    let loud = 0;
    let lastLoud = 0;
    const win = Math.floor(buf.sampleRate * 0.05);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      let ws = 0;
      for (let i = 0; i < d.length; i++) {
        const x = d[i];
        if (!Number.isFinite(x)) {
          nan++;
          continue;
        }
        const a = Math.abs(x);
        if (a > peak) peak = a;
        sum += x * x;
        ws += x * x;
        n++;
        if ((i + 1) % win === 0) {
          const r = Math.sqrt(ws / win);
          if (r > loud) loud = r;
          if (r > 0.002) lastLoud = Math.max(lastLoud, (i + 1) / buf.sampleRate);
          ws = 0;
        }
      }
    }
    return { peak, nan, rms: Math.sqrt(sum / Math.max(1, n)), loud, dur: lastLoud };
  };
  const api = {
    /** État initial : effets effacés, personnages à leur place, ni vision ni teinte. */
    reset: () => {
      fx.clear();
      for (const d of dummies) {
        d.fx = 0;
        d.anim = Anim.IDLE;
        d.moving = false;
        d.phase = 0;
        d.view.x = d.home.x;
        d.view.y = 0;
        d.view.z = d.home.z;
        d.view.yaw = d.homeYaw;
      }
      marksOn = false;
      threatsOn = false;
      speedV = 0;
      fpMode = false;
      api.vision('normal');
      post.setTint(null);
      post.skipTransitions();
      overlay.setVision('normal');
      overlay.clear();
      // laisse retomber fumées et débris d'effects.ts
      for (let i = 0; i < 240; i++) sim(1 / 60);
    },
    play: (ab: string) => playAb(ab),
    playRaw: (ab: string, p: number[], p2: number[] | null, o: Record<string, unknown> = {}) => fx.play(ab, { x: p[0], y: p[1], z: p[2] }, p2 ? { x: p2[0], y: p2[1], z: p2[2] } : null, o),
    setFx: (i: number, bits: number) => (dummies[i].fx = bits),
    setAnim: (i: number, a: number) => (dummies[i].anim = a as Anim),
    move: (i: number, on: boolean) => (dummies[i].moving = on),
    place: (i: number, x: number, z: number, yaw?: number) => {
      const v = dummies[i].view;
      v.x = O.x + x;
      v.z = O.z + z;
      if (yaw !== undefined) v.yaw = yaw;
      dummies[i].home.set(v.x, 0, v.z);
    },
    vision: (m: VisionMode) => {
      post.setVision(m, 1);
      overlay.setVision(m);
      const cr = chars as unknown as { setVision?: (m: VisionMode) => void } | null;
      cr?.setVision?.(m);
    },
    tint: (k: TintKind | null) => {
      post.setTint(k);
      overlay.setTint(k as OverlayTint | null);
    },
    overlay: (o: { marks?: boolean; threats?: boolean; aim?: 'none' | 'ok' | 'far'; speed?: number; range?: number }) => {
      if (o.range !== undefined) overlay.setRange(o.range);
      if (o.marks !== undefined) marksOn = o.marks;
      if (o.threats !== undefined) threatsOn = o.threats;
      if (o.aim) overlay.setGrappleAim(o.aim, 21);
      if (o.speed !== undefined) speedV = o.speed;
    },
    cam: (c: string | number[]) => setCam(typeof c === 'string' ? cams[c] : c),
    pause: (b: boolean) => (paused = b),
    /** Avance la simulation de `sec` secondes par pas de 1/60 s, puis rend une image. */
    step: (sec: number) => {
      const n = Math.max(1, Math.round(sec * 60));
      for (let i = 0; i < n; i++) sim(1 / 60);
      post.skipTransitions();
      return render();
    },
    render,
    stats: () => ({ ...fx.stats(), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, programs: renderer.info.programs?.length ?? 0 }),
    sound: (n: SfxName) => {
      audio.unlock();
      audio.play(n);
    },
    /** Rendu hors ligne de chaque nouveau son (et de quelques références) : niveau, crête, durée. */
    soundReport: async () => {
      const out: { name: string; ok: boolean; peak: number; rms: number; loud: number; dur: number; nan: number }[] = [];
      for (const name of [...REF_SFX, ...NEW_SFX]) {
        const buf = await AudioEngine.renderOffline(name === 'ground_quake' || name === 'rocket_hit' ? 3 : 2.2, (e) => {
          e.setVolumes({ master: 1, music: 0, sfx: 1, ambience: 0 });
          e.play(name);
        });
        const a = analyze(buf);
        out.push({ name, ok: a.nan === 0 && a.peak <= 1.2 && a.rms > 1e-4, ...a });
      }
      return out;
    },
    loopReport: async () => {
      const out: { name: string; ok: boolean; peak: number; rms: number; loud: number; dur: number; nan: number }[] = [];
      for (const name of LOOP_NAMES) {
        const buf = await AudioEngine.renderOffline(3, (e) => {
          e.setVolumes({ master: 1, music: 0, sfx: 1, ambience: 0 });
          e.loop(name, { pitch: 1 });
        });
        const a = analyze(buf);
        out.push({ name, ok: a.nan === 0 && a.peak <= 1.2 && a.rms > 1e-3, ...a });
      }
      return out;
    },
    /** Vue subjective du parrain 0 (caméra à ses yeux, corps masqué). */
    fp: (on: boolean) => {
      fpMode = on;
      if (on) setCam(cams.fp);
    },
    /** Jour (ciel clair, soleil) ou nuit. */
    day: (on: boolean) => {
      scene.background = new THREE.Color(on ? 0x9fb4c8 : 0x070a14);
      hemi.intensity = on ? 2.6 : 1.25;
      hemi.color.setHex(on ? 0xcfe0ff : 0x6a7ab8);
      moon.intensity = on ? 2.4 : 0.7;
      moon.color.setHex(on ? 0xfff2dc : 0xaab8ff);
      envUniforms.uNight.value = on ? 0.1 : 0.9;
      envUniforms.uSkyAmb.value.setRGB(...((on ? [0.7, 0.75, 0.85] : [0.16, 0.19, 0.3]) as [number, number, number]));
      envUniforms.uFogColor.value.setRGB(...((on ? [0.6, 0.66, 0.74] : [0.05, 0.06, 0.1]) as [number, number, number]));
    },
    /** Programmes WebGL compilés (vérifie qu'aucun effet n'en compile de nouveau après warm()). */
    programs: () => renderer.info.programs?.length ?? 0,
    programNames: () => (renderer.info.programs ?? []).map((p) => {
      const q = p as unknown as { name: string; cacheKey: string; id: number };
      return `${q.id} ${q.name} ${q.cacheKey.length > 300 ? q.cacheKey.slice(0, 60) + '…' + q.cacheKey.slice(-160) : q.cacheKey}`;
    }),
    /**
     * Banc de charge : n personnages factices (brûlures, décharges, étourdissements, coureurs) + les
     * deux parrains chargés d'états, rafales d'effets ; temps processeur moyen par image (ms).
     */
    bench: (n = 140, frames = 180) => {
      const list: FxEntity[] = [];
      for (let i = 0; i < n; i++) {
        const fxb = i % 9 === 0 ? CFX.BURN : i % 13 === 0 ? CFX.SHOCK : i % 17 === 0 ? CFX.STUN : 0;
        list.push({ id: 2000 + i, x: O.x - 12 + (i % 14) * 1.8, y: 0, z: O.z - 3 + Math.floor(i / 14) * 1.8, yaw: i, fx: fxb, anim: i % 4 === 0 ? Anim.RUN : Anim.IDLE, speed: i % 4 === 0 ? 4 : 0 });
      }
      list.push({ id: 1, x: O.x - 2, y: 0, z: O.z, yaw: 1.2, fx: CFX.SHIELD | CFX.OVERCHARGE | CFX.REFLEX | CFX.SCAN | CFX.SPRINT, anim: Anim.RUN, speed: 9 });
      list.push({ id: 2, x: O.x + 2, y: 0, z: O.z, yaw: -1.2, fx: CFX.CAMO | CFX.SECOND_WIND | CFX.CHARGE | CFX.ARM_R, anim: Anim.SLIDE, speed: 8 });
      const abs = Object.keys(PRESETS);
      let t = time;
      let worst = 0;
      const spikes: string[] = [];
      const times: number[] = [];
      const t0 = performance.now();
      for (let f = 0; f < frames; f++) {
        let ab = '';
        let tp = 0;
        if (f % 6 === 0) {
          ab = abs[(f / 6) % abs.length];
          const a0 = performance.now();
          playAb(ab);
          tp = performance.now() - a0;
        }
        for (const e of list) if (e.speed) e.x += Math.sin(e.yaw) * (e.speed ?? 0) / 60;
        const a = performance.now();
        fx.updateEntities(list, t);
        const tu = performance.now();
        fx.update(1 / 60, camera, t);
        const d = performance.now() - a + tp;
        times.push(d);
        if (d > 8) spikes.push(`${f}:${ab}:play ${tp.toFixed(1)} ents ${(tu - a).toFixed(1)} upd ${(performance.now() - tu).toFixed(1)}`);
        worst = Math.max(worst, d);
        t += 1 / 60;
      }
      const ms = (performance.now() - t0) / frames;
      time = t;
      const sorted = times.sort((x, y) => x - y);
      return { msPerFrame: +ms.toFixed(3), median: +sorted[Math.floor(frames / 2)].toFixed(3), p95: +sorted[Math.floor(frames * 0.95)].toFixed(3), worstMs: +worst.toFixed(2), spikes: spikes.slice(0, 6), ...fx.stats() };
    },
    fx,
    post,
    ov: overlay,
    dummies,
  };
  (window as unknown as { __fx: typeof api }).__fx = api;
  render();
}
