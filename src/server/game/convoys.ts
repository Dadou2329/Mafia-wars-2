// Convois blindés : ceux de la Banque Fédérale (activité libre : on les intercepte pour le
// butin) et ceux des parrains (de leurs dépôts logistiques à leur QG ; l'adversaire peut les
// intercepter, les lieutenants peuvent les escorter). Un camion détruit laisse un butin que le
// premier parrain sur place empoche.

import { BOSS_NAME, VEHICLES } from '../../shared/constants';
import { BUILDINGS, BUILDING_BY_KEY, type BuildingType } from '../../shared/city/plan';
import { rightLane, roadRoute } from '../../shared/city/roadGraph';
import type { Slot } from '../../shared/protocol';
import { formatMoney } from '../../shared/util';
import { aNom, leNom } from '../../shared/french';
import type { Game } from './Game';
import { otherSlot, slotFaction } from './Game';
import type { Ent, Vec2 } from './types';
import { spawnVehicle, vdef } from './vehicles';

/** Bâtiments logistiques d'où partent les convois d'un parrain. */
export const LOGISTICS: BuildingType[] = ['depot', 'factory', 'junkyard', 'brewery', 'nightmarket', 'garage'];
export const CONVOY_COOLDOWN = 240;

export interface Convoy {
  id: number;
  owner: Slot | null;
  reward: number;
  pts: Vec2[];
  i: number;
  dest: string;
}

export interface Loot {
  x: number;
  z: number;
  y: number;
  reward: number;
  until: number;
}

const state = new WeakMap<Game, { convoys: Map<number, Convoy>; loot: Loot[]; nextAt: Record<Slot, number> }>();
function S(g: Game) {
  let s = state.get(g);
  if (!s) state.set(g, (s = { convoys: new Map(), loot: [], nextAt: { dadou: 0, even: 0 } }));
  return s;
}

export function convoys(g: Game): Convoy[] {
  return [...S(g).convoys.values()];
}

export function convoyOf(g: Game, id: number): Convoy | undefined {
  return S(g).convoys.get(id);
}

export function loots(g: Game): Loot[] {
  return S(g).loot;
}

export function convoyReadyIn(g: Game, slot: Slot): number {
  return Math.max(0, Math.ceil(S(g).nextAt[slot] - g.time));
}

function launch(g: Game, from: Vec2, to: Vec2, owner: Slot | null, reward: number, dest: string): Ent {
  const pts = rightLane(roadRoute(from.x, from.z, to.x, to.z), 1.6);
  const p0 = pts[0];
  const p1 = pts[1] ?? to;
  const truck = spawnVehicle(g, VEHICLES[6], p0.x, 0, p0.z, Math.atan2(p1.x - p0.x, p1.z - p0.z), owner);
  if (owner) g.factions[owner].vehicles.delete(6);
  truck.veh!.auto = { phase: 'go', pts, i: 1, alt: 0, until: 0, home: from };
  S(g).convoys.set(truck.id, { id: truck.id, owner, reward, pts, i: 1, dest });
  return truck;
}

/** Convoi de la Banque Fédérale (événement aléatoire). */
export function neutralConvoy(g: Game): Ent | null {
  const bank = g.building(BUILDING_BY_KEY['banque_federale'].id);
  const targets = ['grand_central', 'bourse', 'tour_axiom', 'casino_neon'].map((k) => g.building(BUILDING_BY_KEY[k].id));
  const dest = targets[g.rng.int(0, targets.length - 1)];
  const reward = 900 + 100 * g.rng.int(0, 6);
  const t = launch(g, bank.doors[0].out, dest.doors[0].out, null, reward, dest.def.name);
  return t;
}

/** Un parrain envoie un convoi depuis un de ses bâtiments logistiques vers son QG. */
export function sendConvoy(g: Game, slot: Slot): void {
  const f = g.factions[slot];
  const s = S(g);
  if (g.time < s.nextAt[slot]) return g.notify(slot, `Prochain convoi possible dans ${Math.ceil(s.nextAt[slot] - g.time)} s.`, 'info', 'convoy-cd', 3);
  if ([...s.convoys.values()].some((c) => c.owner === slot)) return g.notify(slot, 'Un de vos convois est déjà en route.', 'info');
  const hq = g.hq(slot);
  const owned = BUILDINGS.filter((b) => LOGISTICS.includes(b.type) && !b.residence && g.bstate.get(b.id)!.owner === f.faction && b.id !== hq.id);
  if (owned.length === 0) return g.notify(slot, 'Il vous faut un bâtiment logistique (dépôt, usine, casse, brasserie, marché…) pour envoyer un convoi.', 'bad');
  // le dépôt le plus éloigné du QG : un vrai trajet à travers la ville
  owned.sort((a, b) => Math.hypot(g.building(b.id).center.x - hq.center.x, g.building(b.id).center.z - hq.center.z) - Math.hypot(g.building(a.id).center.x - hq.center.x, g.building(a.id).center.z - hq.center.z));
  const from = g.building(owned[0].id);
  const reward = 250 + 120 * owned.length;
  launch(g, from.doors[0].out, hq.doors[0].out, slot, reward, hq.def.name);
  s.nextAt[slot] = g.time + CONVOY_COOLDOWN;
  g.notify(slot, `Convoi parti ${aNom(from.def.name)} vers votre QG : ${formatMoney(reward)} à bord. Escortez-le !`, 'good');
  g.notify(otherSlot(slot), `Un convoi ${slot === 'dadou' ? 'de Dadou' : 'd’Even'} chargé de ${formatMoney(reward)} quitte ${leNom(from.def.name)} ! Interceptez-le.`, 'alert');
}

/** Pilote automatique des camions, arrivées, butins. */
export function updateConvoys(g: Game, dt: number): void {
  const s = S(g);
  for (const [id, c] of s.convoys) {
    const e = g.ents.get(id);
    if (!e || !e.alive) {
      // camion détruit : le butin tombe sur la chaussée
      if (e) {
        s.loot.push({ x: e.x, z: e.z, y: e.y, reward: c.reward, until: g.time + 120 });
        g.notify('all', `Un convoi a été détruit ! Son butin (${formatMoney(c.reward)}) traîne sur la chaussée.`, 'alert');
        g.emitAll({ t: 'event', kind: 'loot', text: '', x: e.x, z: e.z, until: g.time + 120 });
      }
      s.convoys.delete(id);
      continue;
    }
    const def = vdef(e);
    // points trop proches (carrefours décalés sur la voie de droite) : on les saute
    while (c.pts[c.i] && c.pts[c.i + 1] && Math.hypot(c.pts[c.i].x - e.x, c.pts[c.i].z - e.z) < 1.5) c.i++;
    const target = c.pts[c.i];
    if (!target || (!c.pts[c.i + 1] && Math.hypot(target.x - e.x, target.z - e.z) < 1.5)) {
      // arrivée
      s.convoys.delete(id);
      e.removeAt = g.time + 2;
      if (c.owner) {
        const f = g.factions[c.owner];
        f.money += c.reward;
        f.earned += c.reward;
        g.notify(c.owner, `Convoi arrivé à bon port : +${formatMoney(c.reward)} !`, 'money');
        g.notify(otherSlot(c.owner), `Le convoi ${c.owner === 'dadou' ? 'de Dadou' : 'd’Even'} est arrivé à destination.`, 'info');
      } else g.notify('all', `Le convoi blindé est arrivé ${aNom(c.dest)}.`, 'info');
      continue;
    }
    // ralentir avant les virages serrés (seulement à l'approche du carrefour)
    const d0 = Math.hypot(target.x - e.x, target.z - e.z);
    const nxt = c.pts[c.i + 1];
    let speed = def.speed;
    if (nxt && d0 < 8) {
      const a1 = Math.atan2(target.x - e.x, target.z - e.z);
      const a2 = Math.atan2(nxt.x - target.x, nxt.z - target.z);
      let turn = Math.abs(a2 - a1);
      if (turn > Math.PI) turn = Math.PI * 2 - turn;
      speed *= 1 - Math.min(0.45, turn * 0.3);
    }
    // avance : la distance restante du pas se reporte sur les points suivants (pas d'arrêt à chaque nœud)
    let left = speed * dt;
    let hx = 0;
    let hz = 0;
    for (let guard = 0; left > 1e-3 && guard < 8; guard++) {
      const t = c.pts[c.i];
      if (!t) break;
      const dx = t.x - e.x;
      const dz = t.z - e.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-3) {
        if (!c.pts[c.i + 1]) break;
        c.i++;
        continue;
      }
      const step = Math.min(d, left);
      e.x += (dx / d) * step;
      e.z += (dz / d) * step;
      hx = dx / d;
      hz = dz / d;
      left -= step;
      if (step >= d - 1e-6) {
        if (!c.pts[c.i + 1]) break;
        c.i++;
      }
    }
    if (hx !== 0 || hz !== 0) {
      const want = Math.atan2(hx, hz);
      let diff = want - e.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      e.yaw += diff * Math.min(1, dt * 4);
      e.vx = hx * speed;
      e.vz = hz * speed;
    }
    const y = g.w.nav.heightAt(e.x, e.z, e.y);
    if (Number.isFinite(y)) e.y += (y - e.y) * Math.min(1, dt * 5);
  }
  // butins : le premier parrain sur place les empoche
  for (let i = s.loot.length - 1; i >= 0; i--) {
    const l = s.loot[i];
    if (g.time > l.until) {
      s.loot.splice(i, 1);
      continue;
    }
    for (const slot of ['dadou', 'even'] as Slot[]) {
      const f = g.factions[slot];
      // le parrain ou un de ses lieutenants
      const takers = [g.ents.get(f.bossId)!, ...f.lieutenants.map((id) => g.ents.get(id)).filter((x): x is Ent => !!x)];
      const boss = takers.find((t) => t.alive && Math.hypot(t.x - l.x, t.z - l.z) <= 2.8 && Math.abs(t.y - l.y) <= 2);
      if (!boss) continue;
      f.money += l.reward;
      f.earned += l.reward;
      g.notify(slot, `Butin du convoi récupéré : +${formatMoney(l.reward)} !`, 'money');
      g.notify(otherSlot(slot), `${boss.role === 'boss' ? BOSS_NAME[slot] : boss.name ?? 'Un lieutenant'} a raflé le butin du convoi (${BOSS_NAME[slot]}).`, 'bad');
      g.emitAll({ t: 'event', kind: 'loot-end', text: '', x: l.x, z: l.z, until: 0 });
      s.loot.splice(i, 1);
      break;
    }
  }
}

/** Les convois sont des cibles : ceux de l'adversaire toujours, ceux de la banque si on les attaque. */
export function convoyHostile(g: Game, a: Ent, b: Ent): boolean {
  const c = S(g).convoys.get(b.id);
  if (!c || !a.slot) return false;
  if (c.owner === a.slot) return false;
  if (c.owner) return slotFaction(c.owner) !== a.faction;
  // convoi neutre : seulement les hommes qui ont l'ordre de l'intercepter (ou qui suivent le parrain qui l'attaque)
  if (a.ai && a.ai.squad >= 0) {
    const sq = g.squads.get(a.ai.squad);
    return !!sq?.order && sq.order.type === 'intercept' && Number(sq.order.target) === b.id;
  }
  return a.ai?.forcedTarget === b.id;
}
