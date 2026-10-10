// Sécurité des bâtiments protégés : tourelles automatiques (elles changent de camp avec le
// bâtiment), terminal piratable (coupe caméras et tourelles 90 s), braquages des coffres
// (activité libre : alarme, police, propriétaire prévenu). Les lieutenants savent aussi
// pirater et braquer (ordre « Braquer le coffre »).

import { CharKind, Weapon } from '../../shared/characters';
import { BOSS_NAME, HACK_DURATION, HACK_TIME, HACK_TIME_PRO, HEIST_COOLDOWN, HP, MAFIA_NAME } from '../../shared/constants';
import { BUILDINGS, DISTRICT_BY_ID, Faction } from '../../shared/city/plan';
import type { Slot } from '../../shared/protocol';
import { formatMoney } from '../../shared/util';
import { aNom, deNom, leNom } from '../../shared/french';
import type { Game } from './Game';
import { factionSlot, otherSlot, slotFaction } from './Game';
import type { Ent, Vec2 } from './types';

export interface SecState {
  level: number;
  hackedUntil: number;
  turrets: number[];
  turretPts: Vec2[];
  respawnAt: number;
  heistReadyAt: number;
}

export interface Heist {
  b: number;
  slot: Slot;
  /** Entité qui braque (parrain ou lieutenant). */
  by: number;
  progress: number;
  awayFor: number;
}

const state = new WeakMap<Game, { sec: Map<number, SecState>; heists: Map<number, Heist> }>();

function S(g: Game) {
  let s = state.get(g);
  if (!s) state.set(g, (s = { sec: new Map(), heists: new Map() }));
  return s;
}

export function securityOf(g: Game, bid: number): SecState | undefined {
  return S(g).sec.get(bid);
}

export function isHacked(g: Game, bid: number): boolean {
  const s = S(g).sec.get(bid);
  return !!s && g.time < s.hackedUntil;
}

export function heists(g: Game): Heist[] {
  return [...S(g).heists.values()];
}

export function hackedList(g: Game): number[] {
  const out: number[] = [];
  for (const [b, s] of S(g).sec) if (g.time < s.hackedUntil) out.push(b);
  return out;
}

/** Points des tourelles : dans le hall, face à l'entrée, et un à l'étage. */
function turretPoints(g: Game, bid: number): Vec2[] {
  const info = g.building(bid);
  const door = info.doors[0].in;
  const ground = info.defend.filter((d) => Math.abs((d.y ?? info.floorY) - info.floorY) < 0.6);
  ground.sort((a, b) => Math.hypot(b.x - door.x, b.z - door.z) - Math.hypot(a.x - door.x, a.z - door.z));
  const pts: Vec2[] = [];
  // deux tourelles assez loin de la porte pour couvrir l'entrée
  for (const p of ground) {
    if (pts.length >= 2) break;
    const d = Math.hypot(p.x - door.x, p.z - door.z);
    if (d < 5 || d > 16) continue;
    if (pts.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 6)) continue;
    pts.push(p);
  }
  const upper = info.defend.find((d) => (d.y ?? 0) > info.floorY + 2);
  if (upper) pts.push(upper);
  return pts;
}

function spawnTurret(g: Game, bid: number, p: Vec2): Ent {
  const owner = g.bstate.get(bid)!.owner;
  const e = g.addEnt({ kind: CharKind.TURRET, role: 'turret', faction: owner, slot: factionSlot(owner), x: p.x, z: p.z, y: p.y ?? 0, hp: HP.turret, weapon: Weapon.SMG, mode: 'guard', name: 'Tourelle' });
  e.ai!.home = bid;
  e.ai!.post = { x: p.x, z: p.z, y: p.y };
  e.ai!.leash = 0;
  e.ai!.accuracy = 0.48;
  return e;
}

export function setupSecurity(g: Game): void {
  for (const def of BUILDINGS) {
    if (!def.security) continue;
    const st: SecState = { level: def.security, hackedUntil: 0, turrets: [], turretPts: [], respawnAt: 0, heistReadyAt: 0 };
    S(g).sec.set(def.id, st);
    if (def.security >= 2) {
      st.turretPts = turretPoints(g, def.id);
      for (const p of st.turretPts) st.turrets.push(spawnTurret(g, def.id, p).id);
    }
  }
}

/** Le bâtiment change de propriétaire : ses tourelles aussi, et la sécurité est réinitialisée. */
export function securityOnCapture(g: Game, bid: number, owner: number): void {
  const st = S(g).sec.get(bid);
  if (!st) return;
  st.hackedUntil = 0;
  for (const id of st.turrets) {
    const t = g.ents.get(id);
    if (!t || !t.alive) continue;
    t.faction = owner;
    t.slot = factionSlot(owner);
    t.ai!.target = -1;
    t.ai!.aggro.clear();
    g.emitAll({ t: 'spawn', e: g.info(t) });
  }
  // braquage interrompu : le bâtiment est tombé aux mains de l'autre parrain
  const h = S(g).heists.get(bid);
  if (h && (owner === Faction.DADOU || owner === Faction.EVEN) && slotFaction(h.slot) !== owner) S(g).heists.delete(bid);
}

export function hackAction(g: Game, slot: Slot, bid: number): void {
  const f = g.factions[slot];
  const boss = g.ents.get(f.bossId)!;
  const info = g.w.byId.get(bid);
  const st = S(g).sec.get(bid);
  if (!info || !st || !info.terminal || !boss.alive) return;
  if (Math.hypot(boss.x - info.terminal.x, boss.z - info.terminal.z) > 2.6 || Math.abs(boss.y - (info.terminal.y ?? 0)) > 1.6) return;
  if (g.bstate.get(bid)!.owner === f.faction) return g.notify(slot, 'C’est votre propre sécurité : elle protège déjà vos intérêts.', 'info');
  if (g.time < st.hackedUntil) return g.notify(slot, 'La sécurité est déjà coupée.', 'info', 'hack-done', 3);
  if (f.hack) return;
  const dur = f.upgrades.has('hackers') ? HACK_TIME_PRO : HACK_TIME;
  f.hack = { b: bid, start: g.time, done: g.time + dur };
  g.notify(slot, `Piratage du terminal ${deNom(BUILDINGS[bid].name)}… restez à côté (${dur} s).`, 'info');
}

/** Coupe la sécurité d'un bâtiment (piratage réussi). */
function hacked(g: Game, slot: Slot, bid: number, by: string): void {
  const st = S(g).sec.get(bid)!;
  st.hackedUntil = g.time + HACK_DURATION;
  for (const id of st.turrets) {
    const t = g.ents.get(id);
    if (t && t.ai) t.ai.target = -1;
  }
  g.notify(slot, `${by} : sécurité ${deNom(BUILDINGS[bid].name)} coupée pour ${HACK_DURATION} s (caméras et tourelles hors service).`, 'good');
  const os = factionSlot(g.bstate.get(bid)!.owner);
  if (os && os !== slot) g.notify(os, `ALERTE — la sécurité ${deNom(BUILDINGS[bid].name)} a été piratée par ${BOSS_NAME[slot]} !`, 'alert');
}

export function heistAction(g: Game, slot: Slot, bid: number, by?: Ent): void {
  const f = g.factions[slot];
  const actor = by ?? g.ents.get(f.bossId)!;
  const def = BUILDINGS[bid];
  const info = g.w.byId.get(bid);
  if (!def?.heist || !info?.vault || !actor.alive) return;
  if (Math.hypot(actor.x - info.vault.x, actor.z - info.vault.z) > 3 || Math.abs(actor.y - (info.vault.y ?? 0)) > 1.6) return;
  const owner = g.bstate.get(bid)!.owner;
  if (owner === f.faction) return g.notify(slot, 'On ne braque pas son propre coffre !', 'info');
  const s = S(g);
  if (s.heists.has(bid)) return;
  const st = s.sec.get(bid);
  if (st && g.time < st.heistReadyAt) return g.notify(slot, `Le coffre est vide : il se remplit encore (${Math.ceil(st.heistReadyAt - g.time)} s).`, 'info', 'heist-cd', 4);
  if (st && st.level >= 2 && g.time >= st.hackedUntil) return g.notify(slot, 'Coffre verrouillé : piratez d’abord le terminal de sécurité, près de l’entrée.', 'bad', 'heist-lock', 4);
  s.heists.set(bid, { b: bid, slot, by: actor.id, progress: 0, awayFor: 0 });
  // l'alarme : police, gang local et propriétaire
  g.notify(slot, `${def.heist.label} : tenez bon ${def.heist.time} s près du coffre !`, 'alert');
  const os = factionSlot(owner);
  if (os) g.notify(os, `ALERTE — ${BOSS_NAME[slot]} braque ${leNom(def.name)} !`, 'alert');
  else g.notify(otherSlot(slot), `${BOSS_NAME[slot]} braque ${leNom(def.name)} (${DISTRICT_BY_ID[def.district].name}) !`, 'alert');
  g.emitAll({ t: 'sound', s: 'alarm_burst', x: info.vault.x, y: (info.vault.y ?? 0) + 2, z: info.vault.z });
  if (actor.role === 'boss') g.addHeat(slot, 2);
  for (const id of g.bstate.get(bid)!.thugs) {
    const t = g.ents.get(id);
    if (t && t.alive && t.ai) t.ai.aggro.set(actor.id, g.time + 60);
  }
  dispatchPolice(g, bid, actor);
}

/** Une patrouille du NYPD accourt sur les lieux du braquage. */
function dispatchPolice(g: Game, bid: number, target: Ent): void {
  const info = g.building(bid);
  const yard = g.precinctNear(info.center.x, info.center.z);
  for (let i = 0; i < 4; i++) {
    const p = yard.doors[0].out;
    const e = g.addEnt({ kind: CharKind.POLICE, role: 'police', faction: Faction.POLICE, x: p.x + g.rng.range(-2, 2), z: p.z + g.rng.range(-2, 2), hp: HP.police, weapon: Weapon.PISTOL, mode: 'patrol' });
    e.ai!.patrol = [info.doors[0].out, info.doors[0].in];
    e.ai!.run = true;
    e.ai!.leash = 60;
    e.ai!.aggro.set(target.id, g.time + 90);
    e.removeAt = g.time + 150;
  }
}

/** Piratages et braquages en cours, réapparition des tourelles. */
export function updateSecurity(g: Game, dt: number): void {
  const s = S(g);
  // piratages des parrains
  for (const slot of ['dadou', 'even'] as Slot[]) {
    const f = g.factions[slot];
    if (!f.hack) continue;
    const boss = g.ents.get(f.bossId)!;
    const info = g.building(f.hack.b);
    const t = info.terminal!;
    if (!boss.alive || Math.hypot(boss.x - t.x, boss.z - t.z) > 3.2 || Math.abs(boss.y - (t.y ?? 0)) > 1.6) {
      f.hack = null;
      g.notify(slot, 'Piratage interrompu.', 'bad');
      continue;
    }
    if (g.time >= f.hack.done) {
      const b = f.hack.b;
      f.hack = null;
      hacked(g, slot, b, BOSS_NAME[slot]);
    }
  }
  // braquages
  for (const [bid, h] of s.heists) {
    const def = BUILDINGS[bid];
    const info = g.building(bid);
    const v = info.vault!;
    const actor = g.ents.get(h.by);
    const near = !!actor && actor.alive && Math.hypot(actor.x - v.x, actor.z - v.z) < 5.5 && Math.abs(actor.y - (v.y ?? 0)) < 2;
    if (near) {
      h.awayFor = 0;
      h.progress += dt / def.heist!.time;
    } else {
      h.awayFor += dt;
      if (h.awayFor > 20 || !actor || !actor.alive) {
        s.heists.delete(bid);
        g.notify(h.slot, `Braquage ${deNom(def.name)} raté : le coffre est abandonné.`, 'bad');
        continue;
      }
    }
    if (h.progress >= 1) {
      s.heists.delete(bid);
      const f = g.factions[h.slot];
      const reward = def.heist!.reward;
      f.money += reward;
      f.earned += reward;
      const st = s.sec.get(bid);
      if (st) st.heistReadyAt = g.time + HEIST_COOLDOWN;
      g.notify(h.slot, `Braquage réussi ${aNom(def.name)} : +${formatMoney(reward)} !`, 'money');
      g.notify(otherSlot(h.slot), `${MAFIA_NAME[h.slot]} a braqué ${leNom(def.name)} (${formatMoney(reward)}).`, 'bad');
      g.emitAll({ t: 'sound', s: 'heist_success', x: v.x, y: (v.y ?? 0) + 1, z: v.z });
      g.news(`BRAQUAGE SPECTACULAIRE ${aNom(def.name).toUpperCase()}`, `${formatMoney(reward)} se sont envolés en quelques minutes. Les enquêteurs du NYPD soupçonnent ${MAFIA_NAME[h.slot].toLowerCase()}.`);
    }
  }
  // tourelles détruites : la société de sécurité les remplace au bout de 3 min
  if (g.tick % 20 === 0) {
    for (const [bid, st] of s.sec) {
      if (st.turretPts.length === 0) continue;
      const alive = st.turrets.filter((id) => g.ents.get(id)?.alive);
      if (alive.length === st.turrets.length) {
        st.respawnAt = 0;
        continue;
      }
      if (st.respawnAt === 0) st.respawnAt = g.time + 180;
      if (g.time >= st.respawnAt) {
        st.turrets = alive;
        for (const p of st.turretPts) {
          if (st.turrets.some((id) => {
            const t = g.ents.get(id)!;
            return Math.hypot(t.x - p.x, t.z - p.z) < 0.5;
          }))
            continue;
          st.turrets.push(spawnTurret(g, bid, p).id);
        }
        st.respawnAt = 0;
      }
    }
  }
}

/** Les hackers d'un lieutenant coupent la sécurité pendant un assaut (amélioration « hackers » : plus vite). */
export function squadHack(g: Game, slot: Slot, bid: number, ltName: string): boolean {
  const st = S(g).sec.get(bid);
  if (!st || g.time < st.hackedUntil) return false;
  hacked(g, slot, bid, ltName);
  return true;
}

export function heistOf(g: Game, bid: number): Heist | undefined {
  return S(g).heists.get(bid);
}
