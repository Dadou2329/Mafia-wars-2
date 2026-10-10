// NYPD 2085 : patrouilles, poursuites des parrains recherchés.

import { CharKind, Weapon } from '../../shared/characters';
import { HP, VEHICLES } from '../../shared/constants';
import { BUILDINGS, Faction } from '../../shared/city/plan';
import { rightLane, roadRoute } from '../../shared/city/roadGraph';
import type { Slot } from '../../shared/protocol';
import type { Game } from './Game';
import { SLOTS } from './Game';
import type { Ent, Vec2 } from './types';
import { spawnVehicle } from './vehicles';
import { drive, type Route } from './autopilot';

const POLICE_COUNT = 6;
/** Délai entre deux croiseurs envoyés après le même parrain (s). */
const CRUISER_COOLDOWN = 75;

interface Cruiser {
  route: Route;
  target: number;
  officers: number;
  arrived: boolean;
  until: number;
}

const cruisers = new WeakMap<Game, Map<number, Cruiser>>();
const cruiserAt = new WeakMap<Game, Record<Slot, number>>();
function C(g: Game): Map<number, Cruiser> {
  let m = cruisers.get(g);
  if (!m) cruisers.set(g, (m = new Map()));
  return m;
}

/**
 * Un croiseur du NYPD part du commissariat le plus proche, toutes sirènes hurlantes, et suit les
 * rues jusqu'au plus près de la cible ; arrivé, il dépose ses agents.
 */
export function dispatchCruiser(g: Game, x: number, z: number, target: Ent, officers = 2): Ent | null {
  const yard = g.precinctNear(x, z);
  const from = yard.doors[0].out;
  const route = roadRoute(from.x, from.z, x, z);
  // on s'arrête sur la chaussée, au carrefour le plus proche de la cible (pas dans un immeuble)
  if (route.length > 2) route.pop();
  const pts = rightLane(route, 1.6);
  if (pts.length < 2) return null;
  const p0 = pts[0];
  const p1 = pts[1];
  const e = spawnVehicle(g, VEHICLES[5], p0.x, 0, p0.z, Math.atan2(p1.x - p0.x, p1.z - p0.z), null);
  e.veh!.auto = { phase: 'go', pts, i: 1, alt: 0, until: 0, home: from };
  C(g).set(e.id, { route: { pts, i: 1 }, target: target.id, officers, arrived: false, until: g.time + 90 });
  return e;
}

/** Croiseurs en route : pilote automatique, arrivée, dépôt des agents, départ. */
export function updateCruisers(g: Game, dt: number): void {
  for (const [id, c] of C(g)) {
    const e = g.ents.get(id);
    if (!e || !e.alive) {
      C(g).delete(id);
      continue;
    }
    if (c.arrived) {
      // un parrain a volé le croiseur : il est à lui
      if (e.veh!.driver >= 0) C(g).delete(id);
      else if (g.time > c.until) {
        e.removeAt = g.time + 1;
        C(g).delete(id);
      }
      continue;
    }
    const tgt = g.ents.get(c.target);
    if (drive(g, e, c.route, VEHICLES[5].speed * 0.85, dt, 2) || g.time > c.until) {
      c.arrived = true;
      c.until = g.time + 60;
      e.vx = e.vz = 0;
      e.veh!.auto = undefined;
      for (let i = 0; i < c.officers; i++) {
        const side = i % 2 ? 1 : -1;
        const ox = Math.cos(e.yaw) * side * 1.8;
        const oz = -Math.sin(e.yaw) * side * 1.8;
        const p = g.addEnt({ kind: CharKind.POLICE, role: 'police', faction: Faction.POLICE, x: e.x + ox, z: e.z + oz, y: e.y, hp: HP.police, weapon: Weapon.PISTOL, mode: 'patrol' });
        p.ammo = 12;
        p.ai!.patrol = tgt ? [{ x: tgt.x, z: tgt.z }] : [{ x: e.x, z: e.z }];
        p.ai!.run = true;
        p.ai!.leash = 70;
        if (tgt && tgt.alive) p.ai!.aggro.set(tgt.id, g.time + 60);
        p.removeAt = g.time + 150;
      }
    }
  }
}
/** Prochaine relève de police, par partie (plusieurs salons peuvent tourner en même temps). */
const respawnAt = new WeakMap<Game, number>();

function patrolRoute(g: Game, i: number): Vec2[] {
  // circuits dans les beaux quartiers de Manhattan, avec un détour par les autres
  const routes: string[][] = [
    ['midtown', 'wallstreet'],
    ['midtown', 'centralpark', 'harlem'],
    ['wallstreet', 'chinatown', 'midtown'],
  ];
  const districts = routes[i % routes.length];
  const pts: Vec2[] = [];
  for (const b of BUILDINGS) if (districts.includes(b.district) && !b.residence) pts.push(g.building(b.id).doors[0].out);
  // ordre aléatoire mais stable
  return pts.sort(() => g.rng.next() - 0.5).slice(0, 7);
}

export function spawnPolice(g: Game, n: number): void {
  const precincts = g.w.buildings.filter((b) => b.def.type === 'police');
  for (let i = 0; i < n; i++) {
    const yard = precincts[g.rng.int(0, precincts.length - 1)];
    const p = yard.doors[0].out;
    const e = g.addEnt({
      kind: CharKind.POLICE,
      role: 'police',
      faction: Faction.POLICE,
      x: p.x + g.rng.range(-2, 2),
      z: p.z + g.rng.range(-2, 2),
      hp: HP.police,
      weapon: Weapon.CLUB,
      mode: 'patrol',
    });
    e.ai!.patrol = patrolRoute(g, i + g.rng.int(0, 2));
    e.ai!.patrolI = g.rng.int(0, 5);
    e.ai!.leash = 60;
  }
}

export function updatePolice(g: Game, dt: number): void {
  if (g.tick % 10 !== 3) return;
  let alive = 0;
  for (const e of g.ents.values()) if (e.role === 'police' && e.alive) alive++;
  if (alive < POLICE_COUNT && g.time > (respawnAt.get(g) ?? 0)) {
    respawnAt.set(g, g.time + 50);
    spawnPolice(g, 1);
  }
  // armes selon le niveau de recherche des parrains poursuivis
  for (const e of g.ents.values()) {
    if (e.role !== 'police' || !e.alive) continue;
    const ai = e.ai!;
    const tgt = ai.target >= 0 ? g.ents.get(ai.target) : undefined;
    let heat = 0;
    if (tgt?.role === 'boss' && tgt.slot) heat = g.factions[tgt.slot].heat;
    const want = heat >= 2 || (tgt && tgt.role !== 'boss') ? Weapon.PISTOL : Weapon.CLUB;
    if (e.weapon !== want) {
      e.weapon = want;
      e.ammo = 6;
    }
    // poursuite : un policier qui voit un parrain recherché l'indique aux collègues
    if (tgt && tgt.role === 'boss' && tgt.slot) {
      g.factions[tgt.slot].heatSeenAt = g.time;
      ai.run = true;
    }
    if (!tgt && ai.mode === 'patrol') ai.run = false;
  }
  // un parrain recherché (niveau 2 et plus) : un croiseur du NYPD est envoyé à sa poursuite
  let cd = cruiserAt.get(g);
  if (!cd) cruiserAt.set(g, (cd = { dadou: 0, even: 0 }));
  for (const s of SLOTS) {
    const f = g.factions[s];
    if (f.heat < 2 || g.time < cd[s]) continue;
    const boss = g.ents.get(f.bossId)!;
    if (!boss.alive || [...C(g).values()].some((c) => c.target === boss.id && !c.arrived)) continue;
    if (dispatchCruiser(g, boss.x, boss.z, boss, f.heat >= 4 ? 3 : 2)) {
      cd[s] = g.time + CRUISER_COOLDOWN;
      g.notify(s, 'Un croiseur du NYPD fonce vers vous, sirènes hurlantes !', 'alert', 'cruiser', 30);
    }
  }
  // les parrains très recherchés attirent les patrouilles proches
  for (const s of SLOTS) {
    const f = g.factions[s];
    if (f.heat < 3) continue;
    const boss = g.ents.get(f.bossId)!;
    if (!boss.alive) continue;
    g.near(boss.x, boss.z, 70, (p) => {
      if (p.role === 'police' && p.alive && p.ai!.target < 0) {
        p.ai!.aggro.set(boss.id, g.time + 20);
      }
    });
  }
  void dt;
}
