// Test des déplacements du parrain (sans navigateur) : marche, sprint, saut, glissade, rebords,
// double saut, esquive, course murale, escalade, bond chargé, grappin, réception.
// Usage : npx tsx tests/movement.ts
import * as THREE from 'three';
import { emptyEquipment, type Equipment } from '../src/shared/implants';
import { M } from '../src/shared/materials';
import { moveMods } from '../src/shared/moveMods';
import { GROUND_VY, INV_VOXEL, VoxelWorld } from '../src/shared/voxel';
import { PlayerController, type MoveEvent } from '../src/client/game/player';
import type { Input } from '../src/client/input/input';

let failures = 0;
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${info ? ` — ${info}` : ''}`);
  if (!ok) failures++;
}

// ------------------------------------------------------------------ monde d'essai
const W = new VoxelWorld(320, 200, 320);
const CONC = M.CONCRETE;
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  for (let vy = Math.floor(y0 * INV_VOXEL) + GROUND_VY; vy < Math.floor(y1 * INV_VOXEL) + GROUND_VY; vy++)
    for (let vz = Math.floor(z0 * INV_VOXEL); vz < Math.floor(z1 * INV_VOXEL); vz++)
      for (let vx = Math.floor(x0 * INV_VOXEL); vx < Math.floor(x1 * INV_VOXEL); vx++) W.set(vx, vy, vz, CONC);
}
box(0, -GROUND_VY / INV_VOXEL, 0, 80, 0, 80); // sol
box(20, 0, 8, 24, 1.25, 16); // rebord de 1,25 m
box(10, 0, 30, 60, 6, 30.5); // long mur (course murale)
box(40, 0, 40, 50, 15, 50); // tour de 15 m (grappin, escalade)
box(60, 0, 8, 64, 2.75, 16); // rebord de 2,75 m (grip)

class FakeInput {
  held = new Set<string>();
  pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  is(a: string): boolean {
    return this.held.has(a);
  }
  hit(a: string): boolean {
    return this.pressed.has(a);
  }
  press(a: string): void {
    this.pressed.add(a);
    this.held.add(a);
  }
  hold(a: string): void {
    this.held.add(a);
  }
  release(a: string): void {
    this.held.delete(a);
  }
  endFrame(): void {
    this.pressed.clear();
  }
}

const DT = 1 / 60;

function make(equip: Partial<Equipment> = {}, levels: Record<string, number> = {}): { p: PlayerController; inp: FakeInput; events: MoveEvent[] } {
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 500);
  const p = new PlayerController(cam, W);
  p.firstPerson = true;
  const e = { ...emptyEquipment(), ...equip };
  const owned: Record<string, number> = {};
  for (const id of Object.values(e)) if (id) owned[id] = levels[id] ?? 1;
  p.setMods(moveMods(e, owned));
  const events: MoveEvent[] = [];
  p.onMove = (ev) => events.push(ev);
  return { p, inp: new FakeInput(), events };
}

function run(p: PlayerController, inp: FakeInput, seconds: number, each?: (t: number) => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    each?.(i * DT);
    p.update(DT, inp as unknown as Input);
    p.updateCamera(DT, 75);
    inp.endFrame();
  }
}

/** Pose le joueur au sol, regard selon yaw (0 : +z, π/2 : +x). */
function place(p: PlayerController, x: number, z: number, yaw: number, y = 0): void {
  p.teleport(x, y, z, yaw);
  p.yaw = yaw;
  run(p, new FakeInput(), 0.2);
}

// ------------------------------------------------------------------ marche, sprint, saut
{
  const { p, inp } = make();
  place(p, 30, 60, Math.PI / 2);
  inp.hold('forward');
  run(p, inp, 1);
  check('marche à 4,2 m/s', Math.abs(p.hspeed() - 4.2) < 0.05, `${p.hspeed().toFixed(2)} m/s`);
  inp.hold('sprint');
  run(p, inp, 0.6);
  check('sprint à 6,4 m/s', Math.abs(p.hspeed() - 6.4) < 0.05, `${p.hspeed().toFixed(2)} m/s`);
  inp.release('sprint');
  inp.release('forward');
  run(p, inp, 0.5);
  check('arrêt franc', p.hspeed() < 0.05, `${p.hspeed().toFixed(2)} m/s`);
  let top = 0;
  inp.press('jump');
  run(p, inp, 1.2, () => (top = Math.max(top, p.pos.y)));
  check('saut de base ≈ 0,93 m', Math.abs(top - 0.93) < 0.08, `${top.toFixed(2)} m`);
  check('retour au sol', p.onGround && p.pos.y < 0.01);
}

// ------------------------------------------------------------------ pistons de saut niveau 4
{
  const { p, inp } = make({ jambes1: 'saut' }, { saut: 4 });
  place(p, 30, 60, 0);
  let top = 0;
  inp.press('jump');
  run(p, inp, 2, () => (top = Math.max(top, p.pos.y)));
  check('pistons de saut (×2,05) ≈ 3,9 m', Math.abs(top - 3.9) < 0.25, `${top.toFixed(2)} m`);
}

// ------------------------------------------------------------------ saut court (touche relâchée)
{
  const { p, inp } = make();
  place(p, 30, 60, 0);
  let top = 0;
  inp.press('jump');
  run(p, inp, 0.05);
  inp.release('jump');
  run(p, inp, 1, () => (top = Math.max(top, p.pos.y)));
  check('saut écourté plus bas', top < 0.6, `${top.toFixed(2)} m`);
}

// ------------------------------------------------------------------ glissade
{
  const { p, inp, events } = make();
  place(p, 5, 60, Math.PI / 2);
  inp.hold('forward');
  inp.hold('sprint');
  run(p, inp, 0.8);
  inp.press('crouch');
  run(p, inp, 0.1);
  check('glissade déclenchée en sprint', p.mode === 'slide' && events.some((e) => e.k === 'slide'), `mode ${p.mode}, ${p.hspeed().toFixed(1)} m/s`);
  check('glissade plus rapide que le sprint', p.hspeed() > 6.6, `${p.hspeed().toFixed(2)} m/s`);
  run(p, inp, 1.2);
  check('fin de glissade', p.mode === 'walk', `mode ${p.mode}`);
}

// ------------------------------------------------------------------ rebord (1,25 m)
{
  const { p, inp, events } = make();
  place(p, 18.6, 12, Math.PI / 2);
  inp.hold('forward');
  inp.press('jump');
  run(p, inp, 1.2);
  check('se hisse sur un rebord de 1,25 m', Math.abs(p.pos.y - 1.25) < 0.05 && p.pos.x > 20, `pos (${p.pos.x.toFixed(2)}, ${p.pos.y.toFixed(2)}) ${events.map((e) => e.k).join(',')}`);
}

// ------------------------------------------------------------------ rebord de 2,75 m : trop haut sans grip, facile avec
{
  const a = make();
  place(a.p, 58.6, 12, Math.PI / 2);
  a.inp.hold('forward');
  a.inp.press('jump');
  run(a.p, a.inp, 1.2);
  check('rebord de 2,75 m hors de portée sans implant', a.p.pos.y < 0.1, `y ${a.p.pos.y.toFixed(2)}`);
  const b = make({ brasG: 'grip' }, { grip: 2 });
  place(b.p, 58.6, 12, Math.PI / 2);
  b.inp.hold('forward');
  b.inp.press('jump');
  run(b.p, b.inp, 1.5);
  check('grip magnétique : rebord de 2,75 m atteint', Math.abs(b.p.pos.y - 2.75) < 0.05, `y ${b.p.pos.y.toFixed(2)}`);
}

// ------------------------------------------------------------------ double saut
{
  const { p, inp, events } = make({ jambes1: 'doubleSaut' }, { doubleSaut: 1 });
  place(p, 30, 60, 0);
  let top = 0;
  inp.press('jump');
  run(p, inp, 0.35, () => (top = Math.max(top, p.pos.y)));
  inp.press('jump');
  run(p, inp, 1.5, () => (top = Math.max(top, p.pos.y)));
  check('double saut', events.some((e) => e.k === 'airJump') && top > 1.4, `sommet ${top.toFixed(2)} m`);
}

// ------------------------------------------------------------------ esquive
{
  const { p, inp, events } = make({ jambes1: 'esquive' }, { esquive: 1 });
  place(p, 10, 60, Math.PI / 2);
  const x0 = p.pos.x;
  inp.press('dash');
  run(p, inp, 0.22);
  const d = p.pos.x - x0;
  check('esquive ≈ 6 m', Math.abs(d - 6) < 0.6 && events.some((e) => e.k === 'dash'), `${d.toFixed(2)} m`);
  inp.press('dash');
  run(p, inp, 0.3);
  check('une seule charge au niveau 1', events.filter((e) => e.k === 'dash').length === 1);
  run(p, inp, 3.6);
  check('charge rechargée', p.dashCharges === 1);
}

// ------------------------------------------------------------------ course murale puis saut mural
{
  const { p, inp, events } = make({ jambes1: 'courseMurale' }, { courseMurale: 2 });
  // le long du mur (z = 30), côté sud, en courant vers +x
  place(p, 12, 29.55, Math.PI / 2);
  inp.hold('forward');
  inp.hold('sprint');
  run(p, inp, 0.7);
  inp.press('jump');
  let maxT = 0;
  let wallT = 0;
  run(p, inp, 1.4, () => {
    if (p.mode === 'wallrun') wallT += DT;
    maxT = Math.max(maxT, p.pos.y);
  });
  check('course murale', events.some((e) => e.k === 'wallrun') && wallT > 0.5, `${wallT.toFixed(2)} s sur le mur, sommet ${maxT.toFixed(2)} m`);
}

// ------------------------------------------------------------------ escalade (grip niveau 2) contre la tour
{
  const { p, inp, events } = make({ brasG: 'grip' }, { grip: 2 });
  place(p, 45, 39.2, 0);
  inp.hold('forward');
  run(p, inp, 0.3);
  inp.press('jump');
  let top = 0;
  run(p, inp, 1.5, () => (top = Math.max(top, p.pos.y)));
  check('escalade de 3 m', events.some((e) => e.k === 'climb') && top > 2.6, `sommet ${top.toFixed(2)} m`);
}

// ------------------------------------------------------------------ bond chargé
{
  const { p, inp, events } = make({ jambes1: 'bond' }, { bond: 1 });
  place(p, 5, 70, Math.PI / 2);
  inp.press('crouch');
  run(p, inp, 0.9);
  const x0 = p.pos.x;
  inp.press('jump');
  run(p, inp, 2.5);
  const d = p.pos.x - x0;
  check('bond chargé ≈ 12 m', events.some((e) => e.k === 'leap') && Math.abs(d - 12) < 2, `${d.toFixed(2)} m`);
}

// ------------------------------------------------------------------ grappin jusqu'au toit de la tour
{
  const { p, inp, events } = make({ brasG: 'grappin' }, { grappin: 3 });
  // à l'est de la tour, regard vers −x : viser le haut de la façade (x = 50, y ≈ 14,7)
  place(p, 58, 45, -Math.PI / 2);
  p.pitch = Math.atan2(14.7 - 1.64, 58 - 0.12 - 50);
  run(p, inp, 0.05);
  const r = p.fireGrapple();
  let attached = false;
  let top = 0;
  run(p, inp, 3, () => {
    if (p.grapple) attached = true;
    top = Math.max(top, p.pos.y);
  });
  check('grappin tiré', r === 'fire', r);
  check('grappin accroché', attached && events.some((e) => e.k === 'grappleAttach'));
  check('arrivé sur le toit (15 m)', Math.abs(p.pos.y - 15) < 0.1 && p.onGround, `y ${p.pos.y.toFixed(2)}, mode ${p.mode}, ${events.map((e) => e.k).join(',')}`);
}

// ------------------------------------------------------------------ chute : hauteur mesurée
{
  const { p, inp, events } = make();
  place(p, 45, 45, 0, 15);
  inp.hold('forward');
  run(p, inp, 3);
  const land = events.filter((e) => e.k === 'land').pop();
  check('chute du toit mesurée (≈ 15 m)', !!land && Math.abs((land.h ?? 0) - 15) < 0.5, `h ${land?.h?.toFixed(2)} m, impact ${land?.v?.toFixed(1)} m/s`);
}

// ------------------------------------------------------------------ enchaînement : sprint → glissade → saut → grappin → toit
{
  const { p, inp, events } = make({ brasG: 'grappin', jambes1: 'glissade' }, { grappin: 3, glissade: 3 });
  // départ à l'est, course vers la tour (−x)
  place(p, 75, 45, -Math.PI / 2);
  inp.hold('forward');
  inp.hold('sprint');
  run(p, inp, 0.9);
  inp.press('crouch');
  run(p, inp, 0.35);
  const slid = p.mode === 'slide';
  inp.press('jump');
  run(p, inp, 0.12);
  const airborne = !p.onGround;
  // en l'air : viser le haut de la façade est de la tour
  const dx = p.pos.x - 50;
  p.pitch = Math.atan2(14.7 - (p.pos.y + 1.64), dx - 0.12);
  run(p, inp, 1 / 60);
  const r = p.fireGrapple();
  run(p, inp, 3);
  check('enchaînement sprint → glissade → saut → grappin → toit', slid && airborne && r === 'fire' && Math.abs(p.pos.y - 15) < 0.1, `glissade ${slid}, en l'air ${airborne}, grappin ${r}, y ${p.pos.y.toFixed(2)} (${events.map((e) => e.k).join(',')})`);
}

// ------------------------------------------------------------------ élan conservé en lâchant le grappin
{
  const { p, inp } = make({ brasG: 'grappin' }, { grappin: 5 });
  place(p, 58, 45, -Math.PI / 2);
  p.pitch = Math.atan2(14.7 - 1.64, 58 - 0.12 - 50);
  run(p, inp, 1 / 60);
  p.fireGrapple();
  run(p, inp, 0.5);
  const sp = p.vel.length();
  p.releaseGrapple(false);
  const after = p.vel.length();
  check('élan conservé au lâcher (×1,45 au niveau 5)', p.mode === 'walk' && after > sp * 1.3, `${sp.toFixed(1)} → ${after.toFixed(1)} m/s`);
}

// ------------------------------------------------------------------ rebond mural
{
  const { p, inp, events } = make({ jambes1: 'sautMural' }, { sautMural: 1 });
  place(p, 45, 39.6, 0);
  inp.hold('forward');
  inp.press('jump');
  run(p, inp, 0.25);
  inp.release('forward');
  inp.press('jump');
  let top = 0;
  run(p, inp, 1.2, () => (top = Math.max(top, p.pos.y)));
  check('rebond mural', events.some((e) => e.k === 'wallJump') && top > 1.4, `sommet ${top.toFixed(2)} m`);
}

// ------------------------------------------------------------------ plané (colonne gyroscopique)
{
  const a = make();
  const b = make({ colonne: 'gyro' }, { gyro: 3 });
  let ta = 0;
  let tb = 0;
  for (const [o, setT] of [
    [a, (v: number) => (ta = v)],
    [b, (v: number) => (tb = v)],
  ] as const) {
    place(o.p, 45, 45, 0, 15);
    o.inp.hold('forward');
    o.inp.hold('aim');
    let t = 0;
    run(o.p, o.inp, 4, () => {
      if (!o.p.onGround) t += DT;
    });
    setT(t);
  }
  check('plané : la chute dure plus longtemps', tb > ta + 0.7, `${ta.toFixed(2)} s → ${tb.toFixed(2)} s`);
}

if (failures > 0) {
  console.log(`\n${failures} échec(s).`);
  process.exit(1);
}
console.log('\nDéplacements : tout est bon.');
