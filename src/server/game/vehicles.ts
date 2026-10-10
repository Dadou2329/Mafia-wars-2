// Véhicules : motos, voitures, fourgons et aéronefs des parrains (achat, livraison, conduite,
// passagers), épaves et explosions, écrasement des piétons. Le conducteur pilote son véhicule
// côté client (comme il déplace son parrain) ; le serveur vérifie les vitesses.

import { Anim, CharKind, FLAG, Weapon } from '../../shared/characters';
import { BOSS_NAME, VEHICLES, VEHICLE_CALL_COOLDOWN, VEHICLE_WRECK_COOLDOWN, type VehicleDef } from '../../shared/constants';
import { GM } from '../../shared/city/gen/city';
import { DISTRICT_BY_ID, Faction, WATER_Y, isWater, type DistrictId } from '../../shared/city/plan';
import { leNom } from '../../shared/french';
import type { Slot } from '../../shared/protocol';
import { clamp, formatMoney } from '../../shared/util';
import { GROUND_VY, INV_VOXEL } from '../../shared/voxel';
import { MAT_SOLID } from '../../shared/materials';
import type { Game } from './Game';
import { otherSlot, slotFaction } from './Game';
import type { Ent, Vec2 } from './types';

export const vdef = (e: Ent): VehicleDef => VEHICLES[e.veh!.def];

/** Les occupants d'un véhicule fermé sont invisibles et protégés par la carrosserie. */
export const closed = (d: VehicleDef): boolean => d.cls !== 'moto';

/** Crée un véhicule (stationné) au point indiqué. */
export function spawnVehicle(g: Game, def: VehicleDef, x: number, y: number, z: number, yaw: number, owner: Slot | null): Ent {
  const e = g.addEnt({
    kind: CharKind.VEHICLE,
    role: 'vehicle',
    faction: owner ? slotFaction(owner) : Faction.NEUTRAL,
    slot: owner,
    x,
    z,
    y,
    hp: def.hp,
    weapon: Weapon.FISTS,
    gang: def.id,
    name: def.name,
  });
  e.y = y;
  e.yaw = yaw;
  e.veh = { def: def.id, driver: -1, passengers: [], owner, rammed: new Map() };
  if (owner) g.factions[owner].vehicles.set(def.id, e.id);
  return e;
}

/** Le volume (largeur × longueur) du véhicule posé en (x, y, z) est-il libre de tout obstacle ? */
function fits(g: Game, def: VehicleDef, x: number, y: number, z: number, yaw: number): boolean {
  const w = g.w.city.world;
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const hw = def.size[0] / 2;
  const hl = def.size[2] / 2;
  for (let a = -hl; a <= hl + 1e-3; a += 0.5)
    for (let b = -hw; b <= hw + 1e-3; b += 0.5) {
      const px = x + s * a + c * b;
      const pz = z + c * a - s * b;
      const vx = Math.floor(px * INV_VOXEL);
      const vz = Math.floor(pz * INV_VOXEL);
      const vy0 = Math.round(y * INV_VOXEL) + GROUND_VY;
      if (!MAT_SOLID[w.get(vx, vy0 - 1, vz)]) return false; // pas de sol
      for (let k = 0; k < Math.ceil(def.size[1] * INV_VOXEL); k++) if (MAT_SOLID[w.get(vx, vy0 + k, vz)]) return false;
    }
  return true;
}

/** Point de livraison : une chaussée dégagée près du parrain (ou un toit pour l'aéronef). */
function deliveryPoint(g: Game, def: VehicleDef, boss: Ent): { x: number; y: number; z: number; yaw: number } | null {
  const city = g.w.city;
  const tries: { x: number; z: number; d: number }[] = [];
  for (let r = 5; r <= 40; r += 2.5) {
    const n = Math.max(8, Math.round(r * 1.2));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      tries.push({ x: boss.x + Math.cos(a) * r, z: boss.z + Math.sin(a) * r, d: r });
    }
  }
  for (const t of tries) {
    const vx = Math.floor(t.x * INV_VOXEL);
    const vz = Math.floor(t.z * INV_VOXEL);
    if (vx < 0 || vz < 0 || vx >= city.gw || vz >= city.gd) continue;
    const gm = city.groundMap[vz * city.gw + vx];
    if (def.cls !== 'vtol' && gm !== GM.ROAD && gm !== GM.BRIDGE) continue;
    if (isWater(t.x, t.z)) continue;
    // altitude du sol : la rue, ou le toit le plus proche sous les pieds du parrain pour l'aéronef
    const y = def.cls === 'vtol' ? g.w.nav.heightAt(t.x, t.z, boss.y + 2) : g.w.nav.heightAt(t.x, t.z, 0);
    if (!Number.isFinite(y)) continue;
    if (def.cls !== 'vtol' && Math.abs(y) > 0.6) continue;
    // orientation : le long de la rue (on essaie les deux axes)
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      if (fits(g, def, t.x, y, t.z, yaw)) return { x: t.x, y, z: t.z, yaw };
    }
  }
  return null;
}

/** Au début de la partie : la moto de chaque parrain l'attend devant sa planque. */
export function setupVehicles(g: Game): void {
  for (const slot of ['dadou', 'even'] as Slot[]) {
    const f = g.factions[slot];
    const boss = g.ents.get(f.bossId)!;
    const hq = g.hq(slot);
    const out = hq.doors[0].out;
    const probe = { ...boss, x: out.x, z: out.z, y: 0 } as Ent;
    const p = deliveryPoint(g, VEHICLES[0], probe);
    if (p) spawnVehicle(g, VEHICLES[0], p.x, p.y, p.z, p.yaw, slot);
  }
}

export function vehicleAction(g: Game, slot: Slot, op: 'enter' | 'exit' | 'call' | 'buy', id?: number, v?: number): void {
  const f = g.factions[slot];
  const boss = g.ents.get(f.bossId)!;
  if (!boss.alive) return;
  switch (op) {
    case 'buy': {
      const def = VEHICLES[v ?? -1];
      if (!def || def.price < 0) return;
      if (f.garage.has(def.id)) return g.notify(slot, `Vous possédez déjà : ${def.name}.`, 'info');
      if (def.tier > f.tier) return g.notify(slot, `Il faut un QG plus prestigieux pour acheter ${def.name}.`, 'bad');
      if (f.money < def.price) return g.notify(slot, `Pas assez d’argent : il faut ${formatMoney(def.price)}.`, 'bad');
      f.money -= def.price;
      f.garage.add(def.id);
      g.notify(slot, `Nouveau véhicule : ${def.name} ! Faites-le livrer depuis votre téléphone.`, 'money');
      f.callAt = 0;
      return vehicleAction(g, slot, 'call', undefined, def.id);
    }
    case 'call': {
      const def = VEHICLES[v ?? -1];
      if (!def || !f.garage.has(def.id)) return;
      if (f.vehicle >= 0) return g.notify(slot, 'Descendez d’abord de votre véhicule.', 'info');
      if (g.time < f.callAt) return g.notify(slot, `Le garage est occupé : encore ${Math.ceil(f.callAt - g.time)} s.`, 'info', 'veh-call', 3);
      const p = deliveryPoint(g, def, boss);
      if (!p) return g.notify(slot, def.cls === 'vtol' ? 'Aucun endroit dégagé pour poser l’aéronef ici : allez dans une rue ou sur un toit.' : 'Aucune rue dégagée à proximité : rapprochez-vous d’une chaussée.', 'bad');
      const cur = f.vehicles.get(def.id);
      const ce = cur !== undefined ? g.ents.get(cur) : undefined;
      if (ce && ce.alive && ce.veh && ce.veh.driver < 0) {
        // le véhicule en service vient tout seul (pilote automatique)
        ejectPassengers(g, ce);
        ce.x = p.x;
        ce.y = p.y;
        ce.z = p.z;
        ce.yaw = p.yaw;
        ce.vx = ce.vz = 0;
      } else {
        if (ce && ce.veh) {
          ce.veh.owner = null; // volé ou détruit : il ne nous appartient plus
          ce.slot = null;
        }
        spawnVehicle(g, def, p.x, p.y, p.z, p.yaw, slot);
      }
      f.callAt = g.time + VEHICLE_CALL_COOLDOWN;
      g.notify(slot, `${def.name} vous attend à ${Math.round(Math.hypot(p.x - boss.x, p.z - boss.z))} m.`, 'good');
      return;
    }
    case 'enter': {
      if (f.vehicle >= 0) return;
      const e = id !== undefined ? g.ents.get(id) : undefined;
      if (!e || !e.alive || !e.veh) return;
      if (e.veh.driver >= 0) return g.notify(slot, 'Quelqu’un est déjà au volant.', 'bad');
      if (Math.hypot(e.x - boss.x, e.z - boss.z) > 4.2 || Math.abs(e.y - boss.y) > 2.5) return;
      const def = vdef(e);
      if (def.cls === 'drone') return;
      e.veh.driver = boss.id;
      e.flags |= FLAG.VEHICLE;
      f.vehicle = e.id;
      boss.flags |= FLAG.VEHICLE;
      if (closed(def)) boss.flags |= FLAG.HIDDEN;
      g.teleport(slot, e.x, e.y, e.z, e.yaw);
      // l'escorte monte avec le parrain tant qu'il y a des places
      let boarded = 0;
      const free = def.seats - 1;
      for (const m of g.escortMembers(slot)) {
        if (boarded >= free) break;
        if (Math.hypot(m.x - e.x, m.z - e.z) > 16 || Math.abs(m.y - e.y) > 3) continue;
        m.ai!.mode = 'ride';
        m.ai!.follow = -1;
        m.ai!.post = null;
        m.ai!.path = null;
        m.ai!.target = -1;
        m.flags = FLAG.HIDDEN | FLAG.VEHICLE;
        e.veh.passengers.push(m.id);
        boarded++;
      }
      if (e.veh.owner && e.veh.owner !== slot) {
        g.notify(slot, `Vous volez le véhicule ${e.veh.owner === 'dadou' ? 'de Dadou' : 'd’Even'} !`, 'good');
        g.notify(otherSlot(slot), `${BOSS_NAME[slot]} vous a volé votre ${def.name} !`, 'alert');
      } else if (boarded > 0) g.notify(slot, `${boarded} homme${boarded > 1 ? 's montent' : ' monte'} avec vous.`, 'info');
      g.emitAll({ t: 'ride', id: e.id, driver: boss.id });
      return;
    }
    case 'exit': {
      const e = g.ents.get(f.vehicle);
      if (!e || !e.veh) {
        f.vehicle = -1;
        boss.flags &= ~(FLAG.VEHICLE | FLAG.HIDDEN);
        return;
      }
      const def = vdef(e);
      if (Math.hypot(e.vx, e.vz) > 5) return g.notify(slot, 'Ralentissez d’abord !', 'info', 'veh-exit', 2);
      if (def.cls === 'vtol') {
        const ground = g.w.nav.heightAt(e.x, e.z, e.y);
        if (!Number.isFinite(ground) || e.y - ground > 1.5) return g.notify(slot, 'Posez-vous d’abord (descendez près du sol ou d’un toit).', 'info', 'veh-exit', 2);
      }
      leaveVehicle(g, slot, e);
      return;
    }
  }
}

/** Point à côté du véhicule où descendre (portière gauche, sinon droite, arrière, avant). */
function exitPoint(g: Game, e: Ent): Vec2 & { y: number } {
  const def = vdef(e);
  const s = Math.sin(e.yaw);
  const c = Math.cos(e.yaw);
  const side = def.size[0] / 2 + 0.7;
  const back = def.size[2] / 2 + 0.8;
  const cands: [number, number][] = [
    [c * side, -s * side],
    [-c * side, s * side],
    [-s * back, -c * back],
    [s * back, c * back],
  ];
  for (const [dx, dz] of cands) {
    const x = e.x + dx;
    const z = e.z + dz;
    if (g.w.nav.walkable(x, z, e.y, 1.0)) {
      const y = g.w.nav.heightAt(x, z, e.y);
      return { x, z, y: Number.isFinite(y) ? y : e.y };
    }
  }
  const n = g.w.nav.nearestWalkable(e.x, e.z, e.y, 6);
  if (n >= 0) {
    const [x, z] = g.w.nav.nodeCenter(n);
    return { x, z, y: g.w.nav.nodeY(n) };
  }
  return { x: e.x, z: e.z, y: e.y };
}

function ejectPassengers(g: Game, e: Ent): void {
  const veh = e.veh!;
  const out = exitPoint(g, e);
  let i = 0;
  for (const id of veh.passengers) {
    const m = g.ents.get(id);
    if (!m || !m.alive) continue;
    const a = (i++ / Math.max(1, veh.passengers.length)) * Math.PI * 2;
    const x = out.x + Math.cos(a) * 1.1;
    const z = out.z + Math.sin(a) * 1.1;
    const ok = g.w.nav.walkable(x, z, out.y, 1.0);
    m.x = ok ? x : out.x;
    m.z = ok ? z : out.z;
    m.y = out.y;
    m.flags = 0;
    if (m.ai) {
      m.ai.mode = 'escort';
      m.ai.follow = m.slot ? g.factions[m.slot].bossId : -1;
      m.ai.path = null;
    }
  }
  veh.passengers = [];
}

/** Le parrain descend (ou est éjecté) de son véhicule. */
export function leaveVehicle(g: Game, slot: Slot, e: Ent): void {
  const f = g.factions[slot];
  const boss = g.ents.get(f.bossId)!;
  const veh = e.veh!;
  const out = exitPoint(g, e);
  ejectPassengers(g, e);
  veh.driver = -1;
  e.flags &= ~FLAG.VEHICLE;
  e.vx = e.vz = 0;
  f.vehicle = -1;
  boss.flags &= ~(FLAG.VEHICLE | FLAG.HIDDEN);
  boss.anim = Anim.IDLE;
  if (boss.alive) g.teleport(slot, out.x, out.y, out.z, e.yaw);
  g.emitAll({ t: 'ride', id: e.id, driver: -1 });
}

/** Le conducteur envoie la position de son véhicule (voir Game.input). */
export function driveInput(g: Game, slot: Slot, e: Ent, x: number, y: number, z: number, yaw: number, vx: number, vz: number, dt: number): boolean {
  const def = vdef(e);
  const dist = Math.hypot(x - e.x, z - e.z);
  const maxD = def.speed * 1.4 * dt + 1.5;
  if (dist > maxD) return false;
  e.x = x;
  e.y = y;
  e.z = z;
  e.yaw = yaw;
  e.vx = clamp(vx, -def.speed * 1.2, def.speed * 1.2);
  e.vz = clamp(vz, -def.speed * 1.2, def.speed * 1.2);
  const boss = g.ents.get(g.factions[slot].bossId)!;
  boss.x = x;
  boss.y = y;
  boss.z = z;
  boss.yaw = yaw;
  boss.vx = e.vx;
  boss.vz = e.vz;
  boss.anim = Anim.DRIVE;
  // piétons écrasés (gangsters, voyous, policiers) : dégâts selon la vitesse
  const sp = Math.hypot(e.vx, e.vz);
  if (sp > 7 && def.cls !== 'vtol') {
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    g.near(x, z, def.size[2] / 2 + 1, (o) => {
      if (!o.alive || o === e || o === boss || o.role === 'vehicle' || o.role === 'barman' || o.flags & FLAG.HIDDEN) return;
      if (o.slot === slot && o.role !== 'boss') return; // on n'écrase pas ses propres hommes
      if (Math.abs(o.y - y) > 1.5) return;
      // repère du véhicule
      const dx = o.x - x;
      const dz = o.z - z;
      const along = dx * s + dz * c;
      const across = dx * c - dz * s;
      if (Math.abs(along) > def.size[2] / 2 + 0.3 || Math.abs(across) > def.size[0] / 2 + 0.3) return;
      const last = e.veh!.rammed.get(o.id) ?? -10;
      if (g.time - last < 1.2) return;
      e.veh!.rammed.set(o.id, g.time);
      g.damage(o, Math.min(140, sp * 5.5), boss, false, o.x, o.y + 1, o.z);
      if (o.role === 'police') g.addHeat(slot, 1);
    });
  }
  return true;
}

export const DRONE_COOLDOWN = 90;
export const DRONE_REVEAL = 60;

/** Lance un drone de reconnaissance depuis le QG vers un quartier. */
export function launchDrone(g: Game, slot: Slot, d: DistrictId): void {
  const f = g.factions[slot];
  const dist = DISTRICT_BY_ID[d];
  if (!dist) return;
  if (!f.upgrades.has('drones')) return g.notify(slot, 'Il vous faut l’amélioration « Drones de reconnaissance ».', 'bad');
  if (g.time < f.droneAt) return g.notify(slot, `Drone en cours de recharge : encore ${Math.ceil(f.droneAt - g.time)} s.`, 'info', 'drone-cd', 3);
  const hq = g.hq(slot);
  const alt = Math.max(30, hq.height + 6);
  const e = spawnVehicle(g, VEHICLES[7], hq.center.x, alt, hq.center.z, 0, slot);
  f.vehicles.delete(7);
  const target = { x: dist.label[0], z: dist.label[1] };
  e.veh!.auto = { phase: 'go', pts: [target], i: 0, alt: 34, until: 0, district: d, home: { x: hq.center.x, z: hq.center.z } };
  f.droneAt = g.time + DRONE_COOLDOWN;
  g.notify(slot, `Drone lancé vers ${leNom(dist.name)}.`, 'good');
}

/** Pilote automatique des drones : aller, survol en cercle (reconnaissance), retour. */
function updateDrone(g: Game, e: Ent, dt: number): void {
  const a = e.veh!.auto!;
  const def = vdef(e);
  const slot = e.veh!.owner;
  let tx: number;
  let tz: number;
  if (a.phase === 'hover') {
    const t = g.time * 0.35 + e.id;
    tx = a.pts[0].x + Math.cos(t) * 14;
    tz = a.pts[0].z + Math.sin(t) * 14;
    if (g.time >= a.until) {
      a.phase = 'back';
      if (slot) {
        g.factions[slot].droneReveal = null;
        g.notify(slot, 'Le drone rentre au QG.', 'info');
      }
    }
  } else if (a.phase === 'go') {
    tx = a.pts[0].x;
    tz = a.pts[0].z;
  } else {
    tx = a.home.x;
    tz = a.home.z;
  }
  const dx = tx - e.x;
  const dz = tz - e.z;
  const d = Math.hypot(dx, dz);
  const sp = Math.min(def.speed, d / Math.max(dt, 1e-3));
  if (d > 0.01) {
    e.vx = (dx / d) * sp;
    e.vz = (dz / d) * sp;
    e.yaw = Math.atan2(dx, dz);
  }
  e.x += e.vx * dt;
  e.z += e.vz * dt;
  e.y += (a.alt - e.y) * Math.min(1, dt * 1.5);
  if (a.phase === 'go' && d < 4) {
    a.phase = 'hover';
    a.until = g.time + DRONE_REVEAL;
    if (slot && a.district) {
      g.factions[slot].droneReveal = { district: a.district, until: a.until };
      g.notify(slot, `Le drone survole ${leNom(DISTRICT_BY_ID[a.district as DistrictId].name)} : les ennemis apparaissent sur vos cartes.`, 'good');
      g.notify(otherSlot(slot), `Un drone ${slot === 'dadou' ? 'de Dadou' : 'd’Even'} survole ${leNom(DISTRICT_BY_ID[a.district as DistrictId].name)} ! Abattez-le.`, 'alert');
    }
  } else if (a.phase === 'back' && d < 3) {
    e.removeAt = g.time;
  }
}

/** Mise à jour des véhicules (passagers, épaves, noyades). */
export function updateVehicles(g: Game): void {
  for (const e of g.ents.values()) {
    if (e.role !== 'vehicle' || !e.veh) continue;
    const veh = e.veh;
    if (!e.alive) continue;
    if (veh.auto && vdef(e).cls === 'drone') {
      updateDrone(g, e, 1 / 20);
      continue;
    }
    // passagers : cachés dans l'habitacle, ils suivent le véhicule
    for (let i = veh.passengers.length - 1; i >= 0; i--) {
      const m = g.ents.get(veh.passengers[i]);
      if (!m || !m.alive) {
        veh.passengers.splice(i, 1);
        continue;
      }
      m.x = e.x;
      m.y = e.y;
      m.z = e.z;
      m.vx = e.vx;
      m.vz = e.vz;
    }
    if (veh.driver < 0 && !veh.auto) {
      e.vx = e.vz = 0;
    }
    // tombé dans l'East River
    if (e.y < WATER_Y - 0.3 && isWater(e.x, e.z) && vdef(e).cls !== 'vtol') {
      if (veh.driver >= 0) {
        const d = g.ents.get(veh.driver);
        if (d?.slot) g.notify(d.slot, 'Votre véhicule coule dans l’East River !', 'bad');
      }
      g.damage(e, 99999, null);
    }
  }
}

/** Destruction : explosion, occupants éjectés et blessés, épave fumante. */
export function explodeVehicle(g: Game, e: Ent, attacker: Ent | null): void {
  const veh = e.veh!;
  const def = vdef(e);
  g.emitAll({ t: 'boom', x: e.x, y: e.y + 1, z: e.z, r: def.cls === 'drone' ? 2 : 5 });
  g.emitAll({ t: 'sound', s: 'explosion', x: e.x, y: e.y + 1, z: e.z });
  // le souffle brise les vitres alentour
  g.shatter(e.x, e.y + 1.2, e.z, def.cls === 'drone' ? 1.5 : 3.2);
  // occupants
  const driver = veh.driver >= 0 ? g.ents.get(veh.driver) : undefined;
  ejectPassengers(g, e);
  if (driver && driver.slot && driver.role === 'boss') {
    leaveVehicle(g, driver.slot, e);
  }
  veh.driver = -1;
  // souffle
  if (def.cls !== 'drone') {
    g.near(e.x, e.z, 5.5, (o, d2) => {
      if (!o.alive || o === e || o.flags & FLAG.HIDDEN) return;
      if (Math.abs(o.y - e.y) > 3) return;
      const d = Math.sqrt(d2);
      g.damage(o, Math.round(95 * (1 - d / 5.5)), attacker, false, o.x, o.y + 1, o.z);
    });
  }
  if (veh.owner && def.cls === 'drone') {
    g.factions[veh.owner].droneReveal = null;
    g.notify(veh.owner, 'Votre drone a été abattu !', 'bad');
    if (attacker?.slot && attacker.slot !== veh.owner) g.notify(attacker.slot, 'Drone ennemi abattu !', 'good');
    e.removeAt = g.time + 8;
    return;
  }
  if (veh.owner) {
    const f = g.factions[veh.owner];
    if (f.vehicles.get(def.id) === e.id) f.vehicles.delete(def.id);
    f.callAt = Math.max(f.callAt, g.time + VEHICLE_WRECK_COOLDOWN);
    g.notify(veh.owner, `${def.name} a été détruit ! Le garage vous en prépare un autre (${VEHICLE_WRECK_COOLDOWN} s).`, 'bad');
  }
  e.removeAt = g.time + 40;
}
