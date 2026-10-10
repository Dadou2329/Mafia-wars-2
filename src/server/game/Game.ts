// Simulation autoritaire d'une partie : entités, combats, territoires, économie.

import { Anim, CharKind, FLAG, LIEUTENANT_NAMES, WEAPONS, Weapon } from '../../shared/characters';
import {
  BOSS_NAME,
  BOSS_SHOP,
  CAPTURE_TIME,
  DE_BOSS,
  DISTRICT_BONUS,
  HP,
  HQ_CAPTURE_MIN_DISTRICTS,
  LIEUTENANT_PRICES,
  LIEUTENANT_RECOVERY,
  MAFIA_NAME,
  MAX_GANGSTERS,
  MAX_LIEUTENANTS,
  NEWSPAPER,
  RECRUIT_BUNDLES,
  RESPAWN_PENALTY,
  RESPAWN_PENALTY_MAX,
  RESPAWN_TIME,
  START_GANGSTERS,
  START_MONEY,
  TICK_DT,
  UPGRADE_BY_ID,
  AMMO_PRICE,
  type OrderType,
} from '../../shared/constants';
import { BUILDINGS, DISTRICTS, DISTRICT_BY_ID, Faction, HQ_BUILDING, districtAt, keyBuildings, type DistrictId } from '../../shared/city/plan';
import type { BuildingInfo } from '../../shared/city/gen/context';
import {
  BOSS_ENTITY_ID,
  type ClientAction,
  type EntityInfo,
  type GameEvent,
  type LieutenantStatus,
  type MatchSettings,
  type MatchStats,
  type PlayerInput,
  type PrivateState,
  type PublicState,
  type Slot,
  type SnapEntity,
} from '../../shared/protocol';
import { Rng, clamp, formatMoney } from '../../shared/util';
import type { SharedWorld } from '../world';
import type { AiState, BState, Ent, FactionState, Mode, Role, Squad, Vec2 } from './types';
import { updateNpc } from './npc';
import { createSquad, giveOrder, squadStatus, updateSquad, releaseMember } from './squads';
import { updatePolice, spawnPolice } from './police';
import { aNom, cap, deNom, leNom, pluriel } from '../../shared/french';

export const SLOTS: Slot[] = ['dadou', 'even'];
export const otherSlot = (s: Slot): Slot => (s === 'dadou' ? 'even' : 'dadou');
export const slotFaction = (s: Slot): number => (s === 'dadou' ? Faction.DADOU : Faction.EVEN);
export const factionSlot = (f: number): Slot | null => (f === Faction.DADOU ? 'dadou' : f === Faction.EVEN ? 'even' : null);

export interface Outbox {
  /** Événements pour tout le monde. */
  all: GameEvent[];
  /** Événements privés. */
  dadou: GameEvent[];
  even: GameEvent[];
}

export class Game {
  readonly w: SharedWorld;
  readonly settings: MatchSettings;
  readonly rng = new Rng(Date.now() & 0x7fffffff);
  time = 0;
  tick = 0;
  ents = new Map<number, Ent>();
  private nextId = 10;
  factions: Record<Slot, FactionState>;
  bstate = new Map<number, BState>();
  districtOwner = new Map<DistrictId, number>();
  squads = new Map<number, Squad>();
  out: Outbox = { all: [], dadou: [], even: [] };
  over: { winner: Slot | null; reason: string } | null = null;
  /** Grille spatiale (cellules de 8 m). */
  private grid = new Map<number, Ent[]>();
  /** Tirs récents (pour la carte : combats en cours). */
  shots: { x: number; z: number; t: number }[] = [];
  /** Dernier passant abattu signalé par chaque joueur (anti-répétition). */
  private civHitAt = new Map<Slot, number>();
  pathBudget = 0;
  dayTime: number;
  newsAt = 90;
  eventAt = 240;
  /** Événement aléatoire en cours (cargaison, descente de police, brouillard, informateur). */
  activeEvent: { kind: string; x: number; z: number; until: number; reward: number; district: DistrictId; police: number[] } | null = null;
  /** Jusqu'à quand un informateur révèle toutes les positions ennemies (par camp). */
  private informantUntil: Record<Slot, number> = { dadou: -1, even: -1 };
  /** Instant de début de la dernière alerte « QG menacé » par camp. */
  private hqAlertAt: Record<Slot, number> = { dadou: -100, even: -100 };

  constructor(w: SharedWorld, settings: MatchSettings) {
    this.w = w;
    this.settings = settings;
    this.dayTime = settings.daytime === 'night' ? 0.92 : settings.daytime === 'dusk' ? 0.77 : 0.74;
    this.factions = {
      dadou: this.makeFaction('dadou'),
      even: this.makeFaction('even'),
    };
    for (const b of BUILDINGS) {
      this.bstate.set(b.id, { id: b.id, owner: b.startOwner, progress: 0, capBy: 0, contested: false, thugs: new Set(), alertAt: -100, attackers: 0 });
    }
    this.recomputeDistricts(true);
    this.setupStart();
  }

  private makeFaction(slot: Slot): FactionState {
    return {
      slot,
      faction: slotFaction(slot),
      bossId: BOSS_ENTITY_ID[slot],
      money: START_MONEY,
      earned: 0,
      income: 0,
      upgrades: new Set(),
      weapons: new Set([Weapon.FISTS, Weapon.REVOLVER]),
      ammo: new Map([[Weapon.REVOLVER, 36]]),
      lieutenants: [],
      ltNames: [...LIEUTENANT_NAMES[slot]],
      heat: 0,
      heatSeenAt: 0,
      respawnAt: -1,
      tp: 1,
      tpAt: 0,
      lastInputAt: 0,
      connected: true,
      kills: 0,
      deaths: 0,
      captured: 0,
      lost: 0,
      recruited: 0,
      guardRespawnAt: 0,
      spotted: [],
      notifyAt: new Map(),
      custom: {},
    };
  }

  // ======================================================================= mise en place

  hq(slot: Slot): BuildingInfo {
    return this.w.byId.get(HQ_BUILDING[slot].id)!;
  }

  building(id: number): BuildingInfo {
    return this.w.byId.get(id)!;
  }

  private setupStart(): void {
    for (const slot of SLOTS) {
      const f = this.factions[slot];
      const hq = this.hq(slot);
      // le parrain apparaît dans son bureau
      const sp = hq.deskSeat ?? hq.spawn[0];
      const boss = this.addEnt({
        id: f.bossId,
        kind: slot === 'dadou' ? CharKind.BOSS_DADOU : CharKind.BOSS_EVEN,
        role: 'boss',
        faction: f.faction,
        slot,
        x: sp.x,
        z: sp.z,
        name: BOSS_NAME[slot],
        hp: HP.boss,
        weapon: Weapon.REVOLVER,
      });
      boss.yaw = hq.desk ? hq.desk.yaw + Math.PI : 0;
      // barman recruteur
      if (hq.recruit) {
        const bar = this.addEnt({ kind: CharKind.BARMAN, role: 'barman', faction: f.faction, slot, x: hq.recruit.x, z: hq.recruit.z, hp: 100, weapon: Weapon.FISTS, mode: 'guard' });
        bar.invulnerable = true;
        // derrière le comptoir : on recule un peu
        const off = this.barmanOffset(hq);
        bar.x = off.x;
        bar.z = off.z;
        bar.ai!.post = { x: off.x, z: off.z };
        bar.name = slot === 'dadou' ? 'Bill le barman' : 'Molly la tenancière';
      }
      // premier lieutenant gratuit et cinq gangsters
      this.hireLieutenant(slot, true);
      for (let i = 0; i < START_GANGSTERS; i++) this.spawnGangster(slot);
    }
    // voyous des bâtiments neutres
    for (const b of BUILDINGS) {
      if (b.startOwner === Faction.NEUTRAL && b.guards > 0) {
        const info = this.building(b.id);
        const st = this.bstate.get(b.id)!;
        const pts = [...info.defend].sort(() => this.rng.next() - 0.5);
        for (let i = 0; i < b.guards; i++) {
          const p = pts[i % Math.max(1, pts.length)] ?? info.center;
          const w = this.rng.pick([Weapon.REVOLVER, Weapon.REVOLVER, Weapon.CLUB, Weapon.KNIFE, Weapon.SHOTGUN]);
          const e = this.addEnt({
            kind: CharKind.THUG,
            role: 'thug',
            faction: Faction.NEUTRAL,
            gang: DISTRICT_BY_ID[b.district].index,
            x: p.x,
            z: p.z,
            hp: HP.thug,
            weapon: w,
            mode: 'guard',
          });
          e.ai!.home = b.id;
          e.ai!.post = { x: p.x, z: p.z };
          e.ai!.leash = 16;
          st.thugs.add(e.id);
        }
      }
    }
    spawnPolice(this, 6);
  }

  private barmanOffset(hq: BuildingInfo): Vec2 {
    // le comptoir est le long du mur gauche de la salle : le barman se tient entre le mur et le comptoir
    const r = hq.rooms.find((x) => x.kind === 'bar')!.rect;
    const p = hq.recruit!;
    // on cherche le point praticable le plus proche du mur côté opposé à la salle
    let best = { x: p.x, z: p.z };
    let bestD = -1;
    for (let dx = -3; dx <= 3; dx += 0.5)
      for (let dz = -3; dz <= 3; dz += 0.5) {
        const x = p.x + dx;
        const z = p.z + dz;
        if (x < r[0] || x > r[2] || z < r[1] || z > r[3]) continue;
        if (!this.w.nav.walkable(x, z)) continue;
        if (this.w.nav.lineWalkable(p.x, p.z, x, z, 1)) continue; // de l'autre côté du comptoir
        const d = Math.min(x - r[0], r[2] - x, z - r[1], r[3] - z);
        if (bestD < 0 || d < bestD) {
          bestD = d;
          best = { x, z };
        }
      }
    return best;
  }

  addEnt(o: {
    id?: number;
    kind: CharKind;
    role: Role;
    faction: number;
    slot?: Slot | null;
    x: number;
    z: number;
    hp: number;
    weapon: Weapon;
    name?: string;
    gang?: number;
    mode?: Mode;
    look?: number;
  }): Ent {
    const id = o.id ?? this.nextId++;
    const y = this.w.nav.heightAt(o.x, o.z);
    const e: Ent = {
      id,
      kind: o.kind,
      role: o.role,
      faction: o.faction,
      slot: o.slot ?? factionSlot(o.faction),
      look: o.look ?? this.rng.int(0, 65535),
      gang: o.gang ?? 0,
      name: o.name,
      x: o.x,
      y: Number.isFinite(y) ? y : 0.25,
      z: o.z,
      yaw: this.rng.range(0, Math.PI * 2),
      pitch: 0,
      vx: 0,
      vz: 0,
      hp: o.hp,
      maxHp: o.hp,
      alive: true,
      deadAt: 0,
      anim: Anim.IDLE,
      flags: 0,
      weapon: o.weapon,
      ammo: WEAPONS[o.weapon].magazine,
      reloadUntil: 0,
      nextFireAt: 0,
      lastDamageAt: -100,
      lastAttacker: -1,
      criminalUntil: 0,
      ai: o.role === 'boss' ? null : this.makeAi(o.role, o.mode ?? 'idle'),
      removeAt: Infinity,
    };
    this.ents.set(id, e);
    this.emitAll({ t: 'spawn', e: this.info(e) });
    return e;
  }

  private makeAi(role: Role, mode: Mode): AiState {
    const acc = role === 'lieutenant' ? 0.62 : role === 'police' ? 0.55 : role === 'guard' ? 0.6 : role === 'thug' ? 0.42 : 0.5;
    return {
      role,
      mode,
      squad: -1,
      post: null,
      follow: -1,
      rank: 0,
      home: -1,
      leash: 30,
      path: null,
      pathI: 0,
      pathGoalX: 0,
      pathGoalZ: 0,
      repathAt: 0,
      stuck: 0,
      lastX: 0,
      lastZ: 0,
      run: false,
      target: -1,
      scanAt: this.rng.range(0, 0.4),
      accuracy: acc,
      aggro: new Map(),
      forcedTarget: -1,
      patrol: [],
      patrolI: 0,
      waitUntil: 0,
      lastSeen: -100,
    };
  }

  info(e: Ent): EntityInfo {
    const ai = e.ai;
    return {
      id: e.id,
      kind: e.kind,
      faction: e.faction,
      look: e.look,
      gang: e.gang,
      name: e.name,
      maxHp: e.maxHp,
      squad: ai ? ai.squad : -1,
      custom: e.role === 'boss' && e.slot ? this.factions[e.slot].custom : undefined,
    };
  }

  /** Arme d'un nouveau gangster selon les améliorations. */
  gangWeapon(slot: Slot): Weapon {
    const f = this.factions[slot];
    const r = this.rng.next();
    if (f.upgrades.has('rifles') && r < 0.25) return Weapon.RIFLE;
    if (f.upgrades.has('shotguns') && r < (f.upgrades.has('rifles') ? 0.55 : 0.33)) return Weapon.SHOTGUN;
    if (f.upgrades.has('revolvers')) return Weapon.REVOLVER;
    return r < 0.5 ? Weapon.REVOLVER : r < 0.8 ? Weapon.CLUB : Weapon.KNIFE;
  }

  gangHp(slot: Slot, base: number): number {
    return Math.round(base * (this.factions[slot].upgrades.has('vests') ? 1.35 : 1));
  }

  /** Point libre au QG pour un gangster de réserve. */
  poolPost(slot: Slot, i: number): Vec2 {
    const hq = this.hq(slot);
    const inside = hq.spawn.length ? hq.spawn : hq.defend;
    const all = [...hq.guardOut, ...inside];
    return all[i % all.length];
  }

  spawnGangster(slot: Slot): Ent | null {
    if (this.countMen(slot) >= MAX_GANGSTERS) return null;
    const f = this.factions[slot];
    const hq = this.hq(slot);
    const p = hq.spawn[this.rng.int(0, hq.spawn.length - 1)] ?? hq.center;
    const e = this.addEnt({
      kind: CharKind.GANGSTER,
      role: 'gangster',
      faction: f.faction,
      slot,
      x: p.x + this.rng.range(-0.3, 0.3),
      z: p.z + this.rng.range(-0.3, 0.3),
      hp: this.gangHp(slot, HP.gangster),
      weapon: this.gangWeapon(slot),
      mode: 'pool',
    });
    e.ai!.post = this.poolPost(slot, this.countPool(slot));
    if (f.upgrades.has('training')) e.ai!.accuracy *= 1.2;
    return e;
  }

  countMen(slot: Slot): number {
    let n = 0;
    for (const e of this.ents.values()) if (e.alive && e.slot === slot && e.role === 'gangster') n++;
    return n;
  }

  countPool(slot: Slot): number {
    let n = 0;
    for (const e of this.ents.values()) if (e.alive && e.slot === slot && e.role === 'gangster' && e.ai!.mode === 'pool') n++;
    return n;
  }

  poolMembers(slot: Slot): Ent[] {
    const out: Ent[] = [];
    for (const e of this.ents.values()) if (e.alive && e.slot === slot && e.role === 'gangster' && e.ai!.mode === 'pool') out.push(e);
    return out;
  }

  escortMembers(slot: Slot): Ent[] {
    const out: Ent[] = [];
    for (const e of this.ents.values()) if (e.alive && e.slot === slot && e.role === 'gangster' && e.ai!.mode === 'escort') out.push(e);
    return out;
  }

  hireLieutenant(slot: Slot, free = false): Ent | null {
    const f = this.factions[slot];
    if (f.lieutenants.length >= MAX_LIEUTENANTS) return null;
    const price = free ? 0 : LIEUTENANT_PRICES[f.lieutenants.length] ?? 99999;
    if (f.money < price) return null;
    f.money -= price;
    const hq = this.hq(slot);
    const p = hq.spawn[0] ?? hq.center;
    const name = f.ltNames.shift() ?? `Lieutenant ${f.lieutenants.length + 1}`;
    const e = this.addEnt({
      kind: CharKind.LIEUTENANT,
      role: 'lieutenant',
      faction: f.faction,
      slot,
      x: p.x,
      z: p.z,
      hp: this.gangHp(slot, HP.lieutenant),
      weapon: f.upgrades.has('rifles') ? Weapon.RIFLE : Weapon.REVOLVER,
      name,
      mode: 'squad',
    });
    f.lieutenants.push(e.id);
    createSquad(this, e, slot);
    e.ai!.post = this.poolPost(slot, 3 + f.lieutenants.length);
    return e;
  }

  // ======================================================================= événements

  emitAll(ev: GameEvent): void {
    this.out.all.push(ev);
  }

  emitTo(slot: Slot, ev: GameEvent): void {
    this.out[slot].push(ev);
  }

  notify(to: Slot | 'all', text: string, kind: 'info' | 'good' | 'bad' | 'alert' | 'money' = 'info', key?: string, cooldown = 0): void {
    if (key) {
      const targets: Slot[] = to === 'all' ? SLOTS : [to];
      for (const s of targets) {
        const f = this.factions[s];
        const last = f.notifyAt.get(key) ?? -1e9;
        if (this.time - last < cooldown) return;
        f.notifyAt.set(key, this.time);
      }
    }
    if (to === 'all') this.emitAll({ t: 'notify', text, kind });
    else this.emitTo(to, { t: 'notify', text, kind });
  }

  news(title: string, body: string): void {
    this.emitAll({ t: 'news', title, body });
  }

  // ======================================================================= requêtes spatiales

  private rebuildGrid(): void {
    this.grid.clear();
    for (const e of this.ents.values()) {
      if (!e.alive) continue;
      const k = (Math.floor(e.x / 8) & 1023) | ((Math.floor(e.z / 8) & 1023) << 10);
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(e);
    }
  }

  near(x: number, z: number, r: number, fn: (e: Ent, d2: number) => void): void {
    const x0 = Math.floor((x - r) / 8);
    const x1 = Math.floor((x + r) / 8);
    const z0 = Math.floor((z - r) / 8);
    const z1 = Math.floor((z + r) / 8);
    const r2 = r * r;
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.grid.get((cx & 1023) | ((cz & 1023) << 10));
        if (!arr) continue;
        for (const e of arr) {
          const dx = e.x - x;
          const dz = e.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) fn(e, d2);
        }
      }
  }

  los(a: Ent, b: Ent): boolean {
    return this.w.city.world.lineOfSight(a.x, a.y + 1.45, a.z, b.x, b.y + 1.3, b.z);
  }

  /** Le bâtiment (zone intérieure) qui contient le point, ou -1. */
  buildingAt(x: number, z: number, y?: number): number {
    for (const b of this.w.buildings) {
      const f = b.footprint;
      if (x < f[0] || x > f[2] || z < f[1] || z > f[3]) continue;
      for (const r of b.zone) {
        if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) {
          if (y === undefined || Math.abs(y - b.floorY) < 2.5) return b.id;
        }
      }
    }
    return -1;
  }

  // ======================================================================= hostilité

  hostile(a: Ent, b: Ent): boolean {
    if (!b.alive || a.id === b.id || b.invulnerable || a.invulnerable) return false;
    if (b.role === 'barman') return false;
    const t = this.time;
    // agression directe : on riposte toujours
    const ag = a.ai?.aggro.get(b.id);
    if (ag !== undefined && ag > t) return true;
    if (a.faction === b.faction) return false;
    const af = a.faction;
    const bf = b.faction;
    if ((af === Faction.DADOU && bf === Faction.EVEN) || (af === Faction.EVEN && bf === Faction.DADOU)) return true;
    if (af === Faction.POLICE) {
      if (b.role === 'boss' && b.slot) return this.factions[b.slot].heat >= 1;
      return b.criminalUntil > t;
    }
    if (bf === Faction.POLICE) {
      // les gangsters ne tirent sur la police que si elle les attaque
      return false;
    }
    if (af === Faction.NEUTRAL && a.role === 'thug') {
      // les voyous défendent leur territoire
      if (b.faction !== Faction.DADOU && b.faction !== Faction.EVEN) return false;
      const home = a.ai!.home;
      if (home < 0) return false;
      const hb = this.building(home);
      if (this.buildingAt(b.x, b.z) === home) return true;
      // devant la porte du repaire
      const door = hb.doors[0];
      return Math.hypot(b.x - door.out.x, b.z - door.out.z) < 3.5;
    }
    if (bf === Faction.NEUTRAL && b.role === 'thug') {
      // nos hommes attaquent les voyous du bâtiment visé ou ceux qui nous menacent
      const home = b.ai!.home;
      if (a.ai && a.ai.squad >= 0) {
        const sq = this.squads.get(a.ai.squad);
        if (sq && sq.goalBuilding === home && home >= 0) return true;
      }
      if (a.role === 'boss') return false;
      if (a.ai?.mode === 'escort' && a.slot) {
        const boss = this.ents.get(this.factions[a.slot].bossId)!;
        if (Math.hypot(boss.x - b.x, boss.z - b.z) < 14 && this.buildingAt(boss.x, boss.z) === home) return true;
      }
      // menace : un voyou qui vise un camarade proche
      return b.ai!.target >= 0 && this.ents.get(b.ai!.target)?.faction === af;
    }
    return false;
  }

  // ======================================================================= dégâts

  damage(target: Ent, amount: number, attacker: Ent | null, head = false, hx?: number, hy?: number, hz?: number): void {
    if (!target.alive || target.invulnerable || this.over) return;
    const dmg = Math.round(amount * (head ? 1.8 : 1));
    target.hp -= dmg;
    target.lastDamageAt = this.time;
    target.lastAttacker = attacker ? attacker.id : -1;
    this.emitAll({ t: 'hit', id: target.id, by: attacker ? attacker.id : -1, dmg, x: hx ?? target.x, y: hy ?? target.y + 1.3, z: hz ?? target.z, head });
    if (attacker) {
      // représailles : la victime et ses alliés proches ripostent
      if (target.ai) target.ai.aggro.set(attacker.id, this.time + 30);
      this.near(target.x, target.z, 16, (e) => {
        if (e.ai && e.faction === target.faction && e.id !== target.id) e.ai.aggro.set(attacker.id, this.time + 25);
      });
      if (target.role === 'police' && attacker.slot) {
        if (attacker.role === 'boss') this.addHeat(attacker.slot, 1.5);
        attacker.criminalUntil = this.time + 40;
      }
    }
    if (target.hp <= 0) this.kill(target, attacker);
  }

  kill(target: Ent, attacker: Ent | null): void {
    target.hp = 0;
    target.alive = false;
    target.deadAt = this.time;
    target.anim = Anim.DEAD;
    target.flags = 0;
    target.vx = target.vz = 0;
    this.emitAll({ t: 'death', id: target.id, by: attacker ? attacker.id : -1 });
    const killerName = attacker ? this.displayName(attacker) : 'Un inconnu';
    const victimName = this.displayName(target);
    if (target.role === 'boss' || target.role === 'lieutenant' || attacker?.role === 'boss') {
      this.emitAll({ t: 'killfeed', killer: killerName, victim: victimName, kf: attacker?.faction ?? 0, vf: target.faction });
    }
    if (attacker?.slot) this.factions[attacker.slot].kills++;
    if (attacker?.role === 'boss' && attacker.slot && target.role === 'police') this.addHeat(attacker.slot, 2);
    if (target.role === 'boss' && target.slot) {
      const f = this.factions[target.slot];
      f.deaths++;
      f.respawnAt = this.time + RESPAWN_TIME;
      const other = otherSlot(target.slot);
      if (attacker && attacker.slot === other) {
        this.notify(other, `Vous avez abattu ${BOSS_NAME[target.slot]} !`, 'good');
        this.notify(target.slot, `${BOSS_NAME[other]} vous a abattu !`, 'bad');
      } else {
        this.notify(target.slot, attacker?.role === 'police' ? 'La police vous a abattu !' : 'Vous avez été abattu !', 'bad');
      }
      target.removeAt = Infinity;
    } else if (target.role === 'lieutenant') {
      const sq = this.squads.get(target.id);
      if (sq && target.slot) {
        sq.state = 'down';
        sq.downUntil = this.time + LIEUTENANT_RECOVERY;
        sq.order = null;
        sq.status = 'Blessé';
        for (const m of [...sq.members]) {
          const me = this.ents.get(m);
          if (me && me.alive) {
            me.ai!.follow = -1;
            me.ai!.post = this.poolPost(target.slot, me.id);
          }
        }
        const where = DISTRICTS.find((d) => d.id === districtAt(target.x, target.z).id)!.name;
        this.notify(target.slot, `${target.name} est tombé ${aNom(where)} ! Ses hommes se replient.`, 'bad');
        const other = otherSlot(target.slot);
        if (attacker?.slot === other) this.notify(other, `Vous avez abattu ${target.name}, lieutenant ${DE_BOSS[target.slot]} !`, 'good');
      }
      // le lieutenant n'est que blessé : il revient au QG après sa convalescence
      target.removeAt = sq ? Infinity : this.time + 20;
    } else {
      // retrait des escouades
      if (target.ai && target.ai.squad >= 0) releaseMember(this, target, true);
      target.removeAt = this.time + 25;
    }
  }

  displayName(e: Ent): string {
    if (e.name) return e.name;
    switch (e.role) {
      case 'gangster':
        return e.slot ? `un homme ${DE_BOSS[e.slot]}` : 'un gangster';
      case 'thug':
        return 'un voyou';
      case 'police':
        return 'un policier';
      case 'guard':
        return 'un garde';
      default:
        return 'quelqu’un';
    }
  }

  addHeat(slot: Slot, amount: number): void {
    const f = this.factions[slot];
    const before = Math.floor(f.heat);
    f.heat = clamp(f.heat + amount, 0, 5);
    f.heatSeenAt = this.time;
    if (Math.floor(f.heat) > before) {
      this.emitTo(slot, { t: 'wanted', level: Math.floor(f.heat) });
      if (before === 0) this.notify(slot, 'La police vous recherche !', 'alert', 'wanted', 20);
    }
  }

  // ======================================================================= entrées des joueurs

  input(slot: Slot, inp: PlayerInput): void {
    const f = this.factions[slot];
    const e = this.ents.get(f.bossId);
    if (!e || !e.alive) return;
    const [x, y, z, yaw, pitch, vx, vz, anim, flags, weapon, tp] = inp;
    if (![x, y, z, yaw, pitch, vx, vz].every(Number.isFinite)) return;
    if (tp !== f.tp) return; // position antérieure à une téléportation
    const dt = Math.max(0.03, this.time - f.lastInputAt);
    f.lastInputAt = this.time;
    const dist = Math.hypot(x - e.x, z - e.z);
    const maxD = 9.5 * dt + 1.2;
    if (dist > maxD && this.time - f.tpAt > 1) {
      // déplacement impossible : on recale le joueur
      this.teleport(slot, e.x, e.y, e.z, e.yaw);
      return;
    }
    e.x = clamp(x, 0.5, 199.5);
    e.y = clamp(y, -3, 45);
    e.z = clamp(z, 0.5, 159.5);
    e.yaw = yaw;
    e.pitch = clamp(pitch, -1.5, 1.5);
    e.vx = clamp(vx, -8, 8);
    e.vz = clamp(vz, -8, 8);
    e.anim = anim === Anim.DEAD ? Anim.IDLE : (anim as Anim);
    e.flags = flags & ~FLAG.WANTED;
    if (f.weapons.has(weapon as Weapon)) e.weapon = weapon as Weapon;
    // tombé dans la Tamise
    if (e.y < -1.6 && e.z > 139) {
      this.notify(slot, 'Vous êtes tombé dans la Tamise ! On vous repêche…', 'info');
      const hq = this.hq(slot);
      this.respawnBoss(slot, hq, false);
    }
  }

  teleport(slot: Slot, x: number, y: number, z: number, yaw: number): void {
    const f = this.factions[slot];
    const e = this.ents.get(f.bossId)!;
    f.tp++;
    f.tpAt = this.time;
    e.x = x;
    e.y = y;
    e.z = z;
    e.yaw = yaw;
    this.emitTo(slot, { t: 'tp', x, y, z, yaw });
  }

  /** Tir du joueur : le client indique les impacts, le serveur les vérifie. */
  playerFire(slot: Slot, data: { w: number; o: number[]; d: number[]; hits: number[][] }): void {
    const f = this.factions[slot];
    const e = this.ents.get(f.bossId);
    if (!e || !e.alive || this.over) return;
    const w = data.w as Weapon;
    const def = WEAPONS[w];
    if (!def || !def.ranged || !f.weapons.has(w)) return;
    if (this.time < e.nextFireAt - 0.08) return;
    e.nextFireAt = this.time + def.cooldown * 0.9;
    const ammo = f.ammo.get(w) ?? 0;
    if (ammo <= 0) return;
    f.ammo.set(w, ammo - 1);
    e.weapon = w;
    const [ox, oy, oz] = data.o;
    const [dx, dy, dz] = data.d;
    if (![ox, oy, oz, dx, dy, dz].every(Number.isFinite)) return;
    if (Math.hypot(ox - e.x, oz - e.z) > 3.5) return;
    // point d'arrivée du traceur pour les autres
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;
    let end = this.w.city.world.raycast(ox, oy, oz, ux, uy, uz, def.range);
    if (end < 0) end = def.range;
    let firstHit = -1;
    let hitCount = 0;
    for (const h of data.hits.slice(0, def.pellets)) {
      const [id, hx, hy, hz, head] = h;
      const t = this.ents.get(id);
      if (!t || !t.alive || t.id === e.id) continue;
      if (t.slot === slot && t.role !== 'boss') continue; // pas de tir allié
      if (Math.hypot(hx - t.x, hz - t.z) > 1.6 || hy < t.y - 0.6 || hy > t.y + 2.4) continue;
      const dist = Math.hypot(hx - ox, hy - oy, hz - oz);
      if (dist > def.range + 1) continue;
      if (!this.w.city.world.lineOfSight(ox, oy, oz, hx, hy, hz)) continue;
      const falloff = w === Weapon.SHOTGUN ? clamp(1.25 - dist / 18, 0.25, 1) : 1;
      this.damage(t, def.damage * falloff, e, !!head, hx, hy, hz);
      if (firstHit < 0) firstHit = id;
      hitCount++;
    }
    this.emitAll({ t: 'shot', id: e.id, w, fx: ox, fy: oy, fz: oz, tx: ox + ux * end, ty: oy + uy * end, tz: oz + uz * end, hit: firstHit });
    this.recordShot(e.x, e.z);
    // la police entend les coups de feu
    let seen = false;
    this.near(e.x, e.z, 32, (p) => {
      if (p.role === 'police' && p.alive && !seen && this.los(p, e)) seen = true;
    });
    if (seen) this.addHeat(slot, 0.55);
    void hitCount;
  }

  playerMelee(slot: Slot, w: Weapon, targetId: number): void {
    const f = this.factions[slot];
    const e = this.ents.get(f.bossId);
    if (!e || !e.alive || this.over) return;
    const def = WEAPONS[w];
    if (!def || def.ranged || !f.weapons.has(w)) return;
    if (this.time < e.nextFireAt - 0.08) return;
    e.nextFireAt = this.time + def.cooldown * 0.9;
    this.emitAll({ t: 'melee', id: e.id, w, target: targetId });
    const t = this.ents.get(targetId);
    if (!t || !t.alive || (t.slot === slot && t.role !== 'boss')) return;
    const d = Math.hypot(t.x - e.x, t.z - e.z);
    if (d > def.range + 0.9 || Math.abs(t.y - e.y) > 1.5) return;
    this.damage(t, def.damage, e, false);
    // coup de poing ou de matraque : discret pour la police à moins d'être vu
    let seen = false;
    this.near(e.x, e.z, 18, (p) => {
      if (p.role === 'police' && p.alive && !seen && this.los(p, e)) seen = true;
    });
    if (seen) this.addHeat(slot, 0.4);
  }

  playerReload(slot: Slot): void {
    const f = this.factions[slot];
    this.emitAll({ t: 'reload', id: f.bossId });
  }

  recordShot(x: number, z: number): void {
    this.shots.push({ x, z, t: this.time });
  }

  // ======================================================================= actions de gestion

  action(slot: Slot, act: ClientAction): void {
    if (this.over && act.a !== 'rematch') return;
    const f = this.factions[slot];
    switch (act.a) {
      case 'recruit': {
        const b = RECRUIT_BUNDLES.find((x) => x.n === act.n);
        if (!b) return;
        const room = MAX_GANGSTERS - this.countMen(slot);
        if (room <= 0) return this.notify(slot, 'Effectif maximal atteint.', 'bad');
        if (f.money < b.price) return this.notify(slot, `Pas assez d’argent : il faut ${formatMoney(b.price)}.`, 'bad');
        f.money -= b.price;
        const n = Math.min(b.n, room);
        for (let i = 0; i < n; i++) this.spawnGangster(slot);
        f.recruited += n;
        this.notify(slot, n === 1 ? 'Une nouvelle recrue vous attend au QG.' : `${n} nouvelles recrues vous attendent au QG.`, 'money');
        break;
      }
      case 'hire': {
        if (f.lieutenants.length >= MAX_LIEUTENANTS) return this.notify(slot, 'Vous avez déjà le maximum de lieutenants.', 'bad');
        const price = LIEUTENANT_PRICES[f.lieutenants.length];
        if (f.money < price) return this.notify(slot, `Pas assez d’argent : il faut ${formatMoney(price)}.`, 'bad');
        const lt = this.hireLieutenant(slot);
        if (lt) this.notify(slot, `${lt.name} rejoint ${MAFIA_NAME[slot].toLowerCase()} et attend vos ordres au QG.`, 'good');
        break;
      }
      case 'assign': {
        const sq = this.squads.get(act.lt);
        if (!sq || sq.slot !== slot) return;
        this.assignMen(sq, Math.max(0, Math.floor(act.men)));
        break;
      }
      case 'order': {
        const sq = this.squads.get(act.lt);
        if (!sq || sq.slot !== slot) return;
        if (act.men !== undefined) this.assignMen(sq, Math.max(0, Math.floor(act.men)));
        giveOrder(this, sq, act.order as OrderType, act.target, act.x, act.z);
        break;
      }
      case 'cancel': {
        const sq = this.squads.get(act.lt);
        if (!sq || sq.slot !== slot) return;
        giveOrder(this, sq, 'retreat');
        break;
      }
      case 'upgrade': {
        const u = UPGRADE_BY_ID[act.id];
        if (!u || f.upgrades.has(u.id)) return;
        if (u.requires && !f.upgrades.has(u.requires)) return this.notify(slot, `Il faut d’abord : ${UPGRADE_BY_ID[u.requires].name}.`, 'bad');
        if (f.money < u.price) return this.notify(slot, `Pas assez d’argent : il faut ${formatMoney(u.price)}.`, 'bad');
        f.money -= u.price;
        f.upgrades.add(u.id);
        this.applyUpgrade(slot, u.id);
        this.notify(slot, `Amélioration acquise : ${u.name}.`, 'good');
        break;
      }
      case 'buyWeapon': {
        const item = BOSS_SHOP.find((x) => x.weapon === act.w);
        if (!item) return;
        if (!f.upgrades.has('armory')) return this.notify(slot, 'Il vous faut une armurerie au QG.', 'bad');
        if (f.weapons.has(item.weapon)) return;
        if (f.money < item.price) return this.notify(slot, `Pas assez d’argent : il faut ${formatMoney(item.price)}.`, 'bad');
        f.money -= item.price;
        f.weapons.add(item.weapon);
        const def = WEAPONS[item.weapon];
        if (def.ranged) f.ammo.set(item.weapon, def.magazine * 5);
        this.notify(slot, `Nouvelle arme : ${def.name}.`, 'good');
        break;
      }
      case 'buyAmmo': {
        if (f.money < AMMO_PRICE) return this.notify(slot, `Pas assez d’argent : il faut ${formatMoney(AMMO_PRICE)}.`, 'bad');
        f.money -= AMMO_PRICE;
        for (const w of f.weapons) {
          const def = WEAPONS[w];
          if (def.ranged) f.ammo.set(w, Math.min(def.magazine * 8, (f.ammo.get(w) ?? 0) + def.magazine * 4));
        }
        this.notify(slot, 'Munitions rechargées.', 'money');
        break;
      }
      case 'buyBuilding': {
        const st = this.bstate.get(act.b);
        const def = BUILDINGS[act.b];
        if (!st || !def || !def.capturable) return;
        if (st.owner !== Faction.NEUTRAL) return this.notify(slot, 'Ce bâtiment n’est pas à vendre.', 'bad');
        if (def.price <= 0 || [...st.thugs].some((id) => this.ents.get(id)?.alive)) return this.notify(slot, 'Ce bâtiment est tenu par un gang : il faut le prendre par la force.', 'bad');
        if (f.money < def.price) return this.notify(slot, `Pas assez d’argent : il faut ${formatMoney(def.price)}.`, 'bad');
        f.money -= def.price;
        this.setOwner(act.b, f.faction, slot);
        this.notify(slot, `Vous avez acheté ${leNom(def.name)}. Revenus : +${def.income} £/min.`, 'money');
        break;
      }
      case 'quick':
        this.quickCommand(slot, act);
        break;
      case 'debugTp': {
        // réservé aux tests automatisés (rendu logiciel trop lent pour marcher jusqu'au but)
        if (process.env.MW_DEBUG !== '1') return;
        const y = this.w.nav.heightAt(act.x, act.z);
        this.teleport(slot, act.x, Number.isFinite(y) ? y : 0, act.z, act.yaw ?? 0);
        if (typeof act.dayTime === 'number') this.dayTime = ((act.dayTime % 1) + 1) % 1;
        break;
      }
      case 'debugEnd': {
        if (process.env.MW_DEBUG !== '1') return;
        this.endGame(slot, `${BOSS_NAME[slot]} a pris le quartier général ${DE_BOSS[otherSlot(slot)]} ! (fin de test)`);
        break;
      }
      case 'interact': {
        // passant abattu (les passants n'existent que chez le client) : la police s'en mêle
        if (act.what === 'civilian') {
          const now = this.time;
          const last = this.civHitAt.get(slot) ?? -10;
          if (now - last < 0.3) return;
          this.civHitAt.set(slot, now);
          this.addHeat(slot, 1.25);
          this.notify(slot, 'Un passant innocent a été abattu ! Scotland Yard est sur les dents.', 'alert', 'civilian', 25);
        }
        break;
      }
      case 'customize': {
        const c = act.custom;
        const clean: Record<string, unknown> = {};
        for (const k of ['coat', 'vest', 'tie', 'hatband', 'accent']) if (typeof c[k] === 'number') clean[k] = c[k];
        if (typeof c.hat === 'string' && ['bowler', 'top', 'flatcap'].includes(c.hat)) clean.hat = c.hat;
        f.custom = clean;
        const e = this.ents.get(f.bossId)!;
        this.emitAll({ t: 'spawn', e: this.info(e) });
        break;
      }
      default:
        break;
    }
  }

  assignMen(sq: Squad, men: number): void {
    // retire les hommes en trop
    const current = [...sq.members].map((id) => this.ents.get(id)!).filter((e) => e && e.alive);
    if (current.length > men) {
      const extra = current.slice(men);
      for (const e of extra) releaseMember(this, e, false);
      return;
    }
    let need = men - current.length;
    if (need <= 0) return;
    const lt = this.ents.get(sq.id)!;
    const byDist = (a: Ent, b: Ent) => Math.hypot(a.x - lt.x, a.z - lt.z) - Math.hypot(b.x - lt.x, b.z - lt.z);
    // d'abord les hommes qui attendent au QG, puis ceux qui escortent le parrain
    const pool = [...this.poolMembers(sq.slot).sort(byDist), ...this.escortMembers(sq.slot).sort(byDist)];
    for (const e of pool) {
      if (need <= 0) break;
      e.ai!.mode = 'squad';
      e.ai!.squad = sq.id;
      sq.members.add(e.id);
      need--;
    }
    if (need > 0) this.notify(sq.slot, `Pas assez d’hommes disponibles : ${sq.name} part avec ${sq.members.size}.`, 'info', 'assign', 5);
    this.reEmitSquad(sq);
  }

  reEmitSquad(sq: Squad): void {
    let rank = 0;
    for (const id of sq.members) {
      const e = this.ents.get(id);
      if (!e) continue;
      e.ai!.rank = rank++;
    }
  }

  private applyUpgrade(slot: Slot, id: string): void {
    const f = this.factions[slot];
    for (const e of this.ents.values()) {
      if (e.slot !== slot || !e.alive) continue;
      if (e.role === 'gangster' && (id === 'revolvers' || id === 'shotguns' || id === 'rifles')) {
        if (id === 'revolvers' && (e.weapon === Weapon.CLUB || e.weapon === Weapon.KNIFE)) e.weapon = Weapon.REVOLVER;
        else if (id !== 'revolvers' && this.rng.chance(id === 'rifles' ? 0.25 : 0.33)) e.weapon = id === 'rifles' ? Weapon.RIFLE : Weapon.SHOTGUN;
        e.ammo = WEAPONS[e.weapon].magazine;
      }
      if (id === 'vests' && (e.role === 'gangster' || e.role === 'lieutenant')) {
        const ratio = e.hp / e.maxHp;
        e.maxHp = Math.round(e.maxHp * 1.35);
        e.hp = Math.round(e.maxHp * ratio);
        this.emitAll({ t: 'spawn', e: this.info(e) });
      }
      if (id === 'training' && e.ai) e.ai.accuracy *= 1.2;
    }
    if (id === 'guards') f.guardRespawnAt = this.time;
    if (id === 'armory') {
      for (const w of f.weapons) {
        const def = WEAPONS[w];
        if (def.ranged) f.ammo.set(w, def.magazine * 8);
      }
    }
  }

  private quickCommand(slot: Slot, act: Extract<ClientAction, { a: 'quick' }>): void {
    const f = this.factions[slot];
    const boss = this.ents.get(f.bossId)!;
    if (!boss.alive) return;
    // hommes concernés : l'escorte + les hommes libres à proximité
    const nearby: Ent[] = [];
    for (const e of this.ents.values()) {
      if (!e.alive || e.slot !== slot || e.role !== 'gangster') continue;
      const m = e.ai!.mode;
      const d = Math.hypot(e.x - boss.x, e.z - boss.z);
      if (m === 'escort' || (m === 'pool' && d < 40) || (m === 'hold' && d < 60)) nearby.push(e);
    }
    if (nearby.length === 0) {
      this.notify(slot, 'Aucun homme à portée de voix. Recrutez au QG ou rapprochez-vous de vos hommes.', 'info', 'quick-none', 3);
      return;
    }
    let rank = 0;
    switch (act.cmd) {
      case 'follow':
        for (const e of nearby) {
          e.ai!.mode = 'escort';
          e.ai!.follow = boss.id;
          e.ai!.rank = rank++;
          e.ai!.post = null;
          e.ai!.forcedTarget = -1;
        }
        this.notify(slot, `${nearby.length} homme${nearby.length > 1 ? 's' : ''} vous suivent.`, 'good');
        break;
      case 'attack': {
        const target = act.target !== undefined ? this.ents.get(act.target) : undefined;
        if (target && target.alive) {
          for (const e of nearby) {
            e.ai!.mode = 'escort';
            e.ai!.follow = boss.id;
            e.ai!.forcedTarget = target.id;
            e.ai!.aggro.set(target.id, this.time + 60);
          }
          this.notify(slot, `Vos hommes attaquent ${this.displayName(target)} !`, 'good');
        } else if (act.building !== undefined && this.w.byId.has(act.building)) {
          const b = this.building(act.building);
          const pts = [...b.defend];
          let i = 0;
          for (const e of nearby) {
            e.ai!.mode = 'hold';
            e.ai!.follow = -1;
            e.ai!.post = pts.length ? pts[i++ % pts.length] : b.center;
            e.ai!.run = true;
            e.ai!.forcedTarget = -1;
            // ils attaquent tous les défenseurs du bâtiment
            for (const t of this.bstate.get(b.id)!.thugs) e.ai!.aggro.set(t, this.time + 90);
          }
          this.notify(slot, `Vos hommes donnent l’assaut sur ${leNom(b.def.name)} !`, 'good');
        } else if (act.x !== undefined && act.z !== undefined) {
          for (const e of nearby) {
            e.ai!.mode = 'hold';
            e.ai!.follow = -1;
            e.ai!.post = { x: act.x + this.rng.range(-2, 2), z: act.z + this.rng.range(-2, 2) };
            e.ai!.run = true;
          }
          this.notify(slot, 'Vos hommes chargent !', 'good');
        }
        break;
      }
      case 'defend': {
        let pts: Vec2[] = [];
        let label = 'cette position';
        if (act.building !== undefined && this.w.byId.has(act.building)) {
          const b = this.building(act.building);
          pts = [...b.defend.slice(0, 10), ...b.guardOut];
          label = b.def.name;
        } else {
          const cx = act.x ?? boss.x;
          const cz = act.z ?? boss.z;
          for (let i = 0; i < nearby.length; i++) {
            const a = (i / nearby.length) * Math.PI * 2;
            pts.push({ x: cx + Math.cos(a) * 2.5, z: cz + Math.sin(a) * 2.5 });
          }
        }
        let i = 0;
        for (const e of nearby) {
          e.ai!.mode = 'hold';
          e.ai!.follow = -1;
          e.ai!.post = pts[i++ % pts.length];
          e.ai!.forcedTarget = -1;
          e.ai!.run = false;
        }
        this.notify(slot, `Vos hommes défendent ${label}.`, 'good');
        break;
      }
      case 'retreat':
        for (const e of nearby) {
          e.ai!.mode = 'pool';
          e.ai!.follow = -1;
          e.ai!.post = this.poolPost(slot, rank++);
          e.ai!.forcedTarget = -1;
          e.ai!.run = true;
        }
        this.notify(slot, 'Vos hommes se replient vers le QG.', 'info');
        break;
    }
  }

  // ======================================================================= territoires

  setOwner(bid: number, owner: number, by?: Slot | null): void {
    const st = this.bstate.get(bid)!;
    const prev = st.owner;
    if (prev === owner) return;
    st.owner = owner;
    st.progress = 0;
    st.capBy = 0;
    const def = BUILDINGS[bid];
    this.emitAll({ t: 'capture', b: bid, owner, prev });
    const prevSlot = factionSlot(prev);
    const newSlot = factionSlot(owner);
    if (newSlot) this.factions[newSlot].captured++;
    if (prevSlot) this.factions[prevSlot].lost++;
    if (newSlot && by !== undefined) {
      const bossName = BOSS_NAME[newSlot];
      this.notify(newSlot, `Les hommes ${DE_BOSS[newSlot]} ont capturé ${leNom(def.name)} ! (+${def.income} £/min)`, 'good');
      if (prevSlot) this.notify(prevSlot, `${MAFIA_NAME[prevSlot]} a perdu ${leNom(def.name)} au profit ${DE_BOSS[newSlot]} !`, 'bad');
      else this.notify(otherSlot(newSlot), `Les hommes ${DE_BOSS[newSlot]} ont capturé ${leNom(def.name)}.`, 'info');
    }
    // les voyous survivants s'enfuient
    if (prev === Faction.NEUTRAL) {
      for (const id of st.thugs) {
        const t = this.ents.get(id);
        if (t && t.alive) {
          t.ai!.mode = 'flee';
          t.ai!.post = { x: this.rng.range(10, 190), z: this.rng.range(10, 130) };
          t.ai!.run = true;
          t.ai!.target = -1;
          t.removeAt = this.time + 20;
          t.faction = Faction.NEUTRAL;
          t.ai!.home = -1;
        }
      }
      st.thugs.clear();
    }
    // victoire : prise du QG adverse
    if (def.hq && newSlot && def.hq !== newSlot) {
      this.endGame(newSlot, `${BOSS_NAME[newSlot]} a pris le quartier général ${DE_BOSS[def.hq]} !`);
    }
    this.recomputeDistricts(false);
  }

  recomputeDistricts(initial: boolean): void {
    for (const d of DISTRICTS) {
      const keys = keyBuildings(d.id);
      let owner = Faction.NEUTRAL as number;
      if (keys.length > 0) {
        const o = this.bstate.get(keys[0].id)!.owner;
        if ((o === Faction.DADOU || o === Faction.EVEN) && keys.every((k) => this.bstate.get(k.id)!.owner === o)) owner = o;
      }
      const prev = this.districtOwner.get(d.id) ?? Faction.NEUTRAL;
      this.districtOwner.set(d.id, owner);
      if (!initial && prev !== owner) {
        this.emitAll({ t: 'district', d: d.id, owner, prev });
        const ns = factionSlot(owner);
        const ps = factionSlot(prev);
        if (ns) {
          this.notify(ns, `${BOSS_NAME[ns]} contrôle désormais ${leNom(d.name)} ! (+${DISTRICT_BONUS} £/min)`, 'good');
          this.notify(otherSlot(ns), `${BOSS_NAME[ns]} contrôle désormais ${leNom(d.name)} !`, 'alert');
          if (this.rng.chance(0.6)) this.news(`${cap(leNom(d.name)).toUpperCase()} ${pluriel(d.name) ? 'PASSENT' : 'PASSE'} SOUS LA COUPE ${ns === 'dadou' ? 'DE DADOU' : 'D’EVEN'}`, `Les habitants ${deNom(d.name)} parlent à voix basse : ${MAFIA_NAME[ns].toLowerCase()} y fait désormais la loi.`);
        }
        if (ps && !ns) this.notify(ps, `${MAFIA_NAME[ps]} a perdu le contrôle ${deNom(d.name)}.`, 'bad');
      }
    }
  }

  territories(slot: Slot): number {
    const f = slotFaction(slot);
    let n = 0;
    for (const o of this.districtOwner.values()) if (o === f) n++;
    return n;
  }

  private updateCapture(dt: number): void {
    for (const def of BUILDINGS) {
      if (!def.capturable) continue;
      const st = this.bstate.get(def.id)!;
      const info = this.building(def.id);
      let c1 = 0;
      let c2 = 0;
      let cn = 0;
      const cx = (info.footprint[0] + info.footprint[2]) / 2;
      const cz = (info.footprint[1] + info.footprint[3]) / 2;
      const r = Math.hypot(info.footprint[2] - info.footprint[0], info.footprint[3] - info.footprint[1]) / 2 + 1;
      this.near(cx, cz, r, (e) => {
        if (!e.alive || e.role === 'barman' || e.role === 'police') return;
        if (Math.abs(e.y - info.floorY) > 2.5) return;
        let inside = false;
        for (const z of info.zone) if (e.x >= z[0] && e.x <= z[2] && e.z >= z[1] && e.z <= z[3]) inside = true;
        if (!inside) return;
        if (e.faction === Faction.DADOU) c1++;
        else if (e.faction === Faction.EVEN) c2++;
        else if (e.role === 'thug' && e.ai!.home === def.id) cn++;
      });
      const counts: Record<number, number> = { [Faction.NEUTRAL]: cn, [Faction.DADOU]: c1, [Faction.EVEN]: c2 };
      const owner = st.owner;
      const defenders = counts[owner] ?? 0;
      const attackers = [Faction.DADOU, Faction.EVEN].filter((f) => f !== owner && counts[f] > 0);
      st.attackers = attackers.reduce((s, f) => s + counts[f], 0);
      const time = def.hq ? CAPTURE_TIME.hq : def.isKey ? CAPTURE_TIME.key : CAPTURE_TIME.normal;
      st.contested = false;
      if (attackers.length === 1 && defenders === 0) {
        const F = attackers[0];
        const fs = factionSlot(F)!;
        if (def.hq && this.territories(fs) < HQ_CAPTURE_MIN_DISTRICTS) {
          st.contested = true;
          this.notify(fs, `Le QG ${DE_BOSS[def.hq]} est imprenable : contrôlez au moins ${HQ_CAPTURE_MIN_DISTRICTS} quartiers (vous en avez ${this.territories(fs)}).`, 'info', 'hq-locked', 15);
          continue;
        }
        if (st.capBy !== F) {
          st.capBy = F;
          st.progress = 0;
        }
        const n = counts[F];
        st.progress += (dt / time) * Math.min(3, 1 + 0.3 * (n - 1));
        // alerte du propriétaire
        const os = factionSlot(owner);
        if (os && this.time - st.alertAt > 25) {
          st.alertAt = this.time;
          this.notify(os, `ALERTE — ${BOSS_NAME[fs]} attaque ${leNom(def.name)} !`, 'alert');
          if (def.hq) this.notify(os, `ATTENTION ! ${BOSS_NAME[fs]} est dans votre quartier général !`, 'alert');
        }
        if (st.progress >= 1) this.setOwner(def.id, F, fs);
      } else if (attackers.length > 0) {
        st.contested = true;
      } else if (st.progress > 0) {
        st.progress = Math.max(0, st.progress - dt / (time * 2));
        if (st.progress === 0) st.capBy = 0;
      }
    }
  }

  // ======================================================================= boucle

  step(): void {
    if (this.over) return;
    const dt = TICK_DT;
    this.time += dt;
    this.tick++;
    this.pathBudget = 7; // ms de recherche de chemin par tick
    if (this.settings.daytime === 'cycle') this.dayTime = (this.dayTime + dt / (24 * 60)) % 1;
    this.rebuildGrid();
    this.updateFactions(dt);
    for (const sq of this.squads.values()) updateSquad(this, sq, dt);
    for (const e of this.ents.values()) if (e.ai && e.alive) updateNpc(this, e, dt);
    if (this.tick % 5 === 0) this.updateCapture(dt * 5);
    updatePolice(this, dt);
    if (this.tick % 20 === 0) this.updateSpotted();
    this.updateEvents();
    // nettoyage
    for (const e of this.ents.values()) {
      if (e.removeAt <= this.time) {
        this.ents.delete(e.id);
        this.emitAll({ t: 'despawn', id: e.id });
      }
    }
    this.shots = this.shots.filter((s) => this.time - s.t < 6);
    if (this.settings.timeLimit > 0 && this.time >= this.settings.timeLimit * 60 && !this.over) this.timeUp();
  }

  private updateFactions(dt: number): void {
    for (const slot of SLOTS) {
      const f = this.factions[slot];
      const boss = this.ents.get(f.bossId)!;
      // revenus
      let inc = 0;
      for (const def of BUILDINGS) if (this.bstate.get(def.id)!.owner === f.faction) inc += def.income;
      const terr = this.territories(slot);
      inc += terr * (DISTRICT_BONUS + (f.upgrades.has('facade') ? 5 : 0));
      if (f.upgrades.has('office')) inc *= 1.1;
      f.income = Math.round(inc);
      const gain = (inc / 60) * dt;
      f.money += gain;
      f.earned += gain;
      // réapparition du parrain
      if (!boss.alive && f.respawnAt > 0 && this.time >= f.respawnAt) {
        this.respawnBoss(slot, this.hq(slot), true);
      }
      // régénération
      if (boss.alive && boss.hp < boss.maxHp && this.time - boss.lastDamageAt > 6) boss.hp = Math.min(boss.maxHp, boss.hp + 5 * dt);
      // récupération des lieutenants
      // (gérée dans updateSquad)
      // gardes du QG
      if (f.upgrades.has('guards') && this.time >= f.guardRespawnAt) {
        f.guardRespawnAt = this.time + 45;
        let guards = 0;
        for (const e of this.ents.values()) if (e.alive && e.slot === slot && e.role === 'guard') guards++;
        const hq = this.hq(slot);
        for (let i = guards; i < 4; i++) {
          const p = hq.guardOut[i % hq.guardOut.length];
          const g = this.addEnt({ kind: CharKind.GANGSTER, role: 'guard', faction: f.faction, slot, x: p.x, z: p.z, hp: HP.guard, weapon: f.upgrades.has('shotguns') ? Weapon.SHOTGUN : Weapon.REVOLVER, mode: 'guard' });
          g.ai!.post = { x: p.x, z: p.z };
          g.ai!.leash = 22;
          g.ai!.home = hq.id;
        }
      }
      // alerte : ennemis près du QG
      const hq = this.hq(slot);
      let threats = 0;
      this.near(hq.center.x, hq.center.z, 24, (e) => {
        if (e.alive && e.slot === otherSlot(slot) && (e.role === 'gangster' || e.role === 'lieutenant' || e.role === 'boss')) threats++;
      });
      if (threats >= 2 && this.time - this.hqAlertAt[slot] > 45) {
        this.hqAlertAt[slot] = this.time;
        this.notify(slot, `Attention ! ${BOSS_NAME[otherSlot(slot)]} approche de votre quartier général !`, 'alert');
      }
      // recherche policière : décroissance
      if (f.heat > 0 && this.time - f.heatSeenAt > 12) {
        const before = Math.ceil(f.heat);
        f.heat = Math.max(0, f.heat - dt / 7);
        if (Math.ceil(f.heat) < before) this.emitTo(slot, { t: 'wanted', level: Math.ceil(f.heat) });
        if (f.heat === 0) this.notify(slot, 'La police a perdu votre trace.', 'good', 'lost-police', 10);
      }
    }
  }

  respawnBoss(slot: Slot, hq: BuildingInfo, penalty: boolean): void {
    const f = this.factions[slot];
    const boss = this.ents.get(f.bossId)!;
    f.respawnAt = -1;
    const sp = hq.deskSeat ?? hq.spawn[0] ?? hq.center;
    boss.alive = true;
    boss.hp = boss.maxHp;
    boss.anim = Anim.IDLE;
    boss.lastDamageAt = this.time;
    f.heat = 0;
    this.emitTo(slot, { t: 'wanted', level: 0 });
    if (penalty) {
      const cost = Math.min(RESPAWN_PENALTY_MAX, Math.round(f.money * RESPAWN_PENALTY));
      f.money -= cost;
      if (cost > 0) this.notify(slot, `Le docteur vous a recousu : −${formatMoney(cost)}.`, 'money');
    }
    const y = this.w.nav.heightAt(sp.x, sp.z);
    this.teleport(slot, sp.x, Number.isFinite(y) ? y : hq.floorY, sp.z, hq.desk ? hq.desk.yaw + Math.PI : 0);
    this.emitTo(slot, { t: 'respawned' });
    this.emitAll({ t: 'spawn', e: this.info(boss) });
  }

  private updateSpotted(): void {
    for (const slot of SLOTS) {
      const f = this.factions[slot];
      const mine: Ent[] = [];
      for (const e of this.ents.values()) if (e.alive && e.slot === slot && (e.role !== 'barman')) mine.push(e);
      const seen = new Map<number, { x: number; z: number; n: number }>();
      const enemy = otherSlot(slot);
      const informed = this.time < this.informantUntil[slot];
      for (const e of this.ents.values()) {
        if (!e.alive || e.slot !== enemy || e.role === 'barman' || e.role === 'boss') continue;
        let vis = informed;
        for (const m of mine) {
          if (Math.abs(m.x - e.x) < 36 && Math.abs(m.z - e.z) < 36) {
            vis = true;
            break;
          }
        }
        if (!vis) {
          // près d'un de nos bâtiments
          const bid = this.buildingAt(e.x, e.z);
          if (bid >= 0 && this.bstate.get(bid)!.owner === f.faction) vis = true;
        }
        if (!vis) continue;
        const k = Math.floor(e.x / 10) + Math.floor(e.z / 10) * 100;
        const s = seen.get(k);
        if (s) {
          s.x = (s.x * s.n + e.x) / (s.n + 1);
          s.z = (s.z * s.n + e.z) / (s.n + 1);
          s.n++;
        } else seen.set(k, { x: e.x, z: e.z, n: 1 });
      }
      f.spotted = [...seen.values()];
    }
  }

  private updateEvents(): void {
    if (this.time >= this.newsAt) {
      this.newsAt = this.time + this.rng.range(200, 320);
      this.headline();
    }
    if (this.time >= this.eventAt && !this.activeEvent) {
      this.eventAt = this.time + this.rng.range(230, 340);
      this.startRandomEvent();
    }
    const ev = this.activeEvent;
    if (!ev) return;
    if (ev.kind === 'contraband') {
      // le premier parrain arrivé sur place empoche la cargaison
      for (const s of SLOTS) {
        const boss = this.ents.get(this.factions[s].bossId)!;
        if (!boss.alive || Math.hypot(boss.x - ev.x, boss.z - ev.z) > 2.6) continue;
        const f = this.factions[s];
        f.money += ev.reward;
        f.earned += ev.reward;
        this.notify(s, `Cargaison récupérée : +${formatMoney(ev.reward)} !`, 'money');
        this.notify(otherSlot(s), `${BOSS_NAME[s]} a mis la main sur la cargaison de contrebande.`, 'bad');
        this.endEvent();
        return;
      }
    } else if (ev.kind === 'raid' && this.tick % 10 === 0) {
      // les agents de la descente interpellent les hommes armés qui se battent
      for (const id of ev.police) {
        const p = this.ents.get(id);
        if (!p || !p.alive || p.ai!.target >= 0) continue;
        this.near(p.x, p.z, 20, (e) => {
          if (!e.alive || !e.slot) return;
          const fighting = e.ai ? e.ai.target >= 0 : e.role === 'boss' && this.factions[e.slot].heat > 0;
          if ((e.role === 'gangster' || e.role === 'lieutenant' || e.role === 'boss') && fighting) p.ai!.aggro.set(e.id, this.time + 15);
        });
      }
    }
    if (this.time >= ev.until) this.endEvent();
  }

  /** Lance un événement aléatoire. */
  private startRandomEvent(): void {
    const kinds = ['contraband', 'contraband', 'raid', 'fog', 'informant'];
    const kind = kinds[this.rng.int(0, kinds.length - 1)];
    const districts = DISTRICTS.filter((d) => d.id !== 'soho' && d.id !== 'docks');
    const d = kind === 'contraband' ? DISTRICTS[this.rng.int(0, DISTRICTS.length - 1)] : districts[this.rng.int(0, districts.length - 1)];
    const inDistrict = BUILDINGS.filter((b) => b.district === d.id && !b.hq);
    const b = this.building(inDistrict[this.rng.int(0, inDistrict.length - 1)].id);
    const out = b.doors[0].out;
    // point praticable dans la rue, un peu à l'écart de la porte
    let x = out.x;
    let z = out.z;
    const n = this.w.nav.nearestWalkable(out.x + this.rng.range(-3, 3), out.z + this.rng.range(-3, 3), 8);
    if (n >= 0) [x, z] = this.w.nav.cellCenter(n);
    switch (kind) {
      case 'contraband': {
        const reward = 250 + 50 * this.rng.int(0, 4);
        this.activeEvent = { kind, x, z, until: this.time + 150, reward, district: d.id, police: [] };
        const text = `Une cargaison de whisky de contrebande attend preneur près ${deNom(b.def.name)} (${d.name}) ! Le premier parrain sur place empoche ${formatMoney(reward)}.`;
        this.emitAll({ t: 'event', kind, text, x, z, until: this.time + 150 });
        this.news('CONTREBANDE : LA DOUANE IMPUISSANTE', `Des tonneaux de whisky sans vignette auraient été aperçus du côté ${deNom(d.name)}. Les gangs de Dadou et d’Even sont sur le coup.`);
        break;
      }
      case 'raid': {
        const police: number[] = [];
        const yard = this.w.buildings.find((bb) => bb.def.type === 'police')!;
        const route = BUILDINGS.filter((bb) => bb.district === d.id).map((bb) => this.building(bb.id).doors[0].out);
        for (let i = 0; i < 4; i++) {
          const p = yard.doors[0].out;
          const e = this.addEnt({ kind: CharKind.POLICE, role: 'police', faction: Faction.POLICE, x: p.x + this.rng.range(-2, 2), z: p.z + this.rng.range(-2, 2), hp: HP.police, weapon: Weapon.REVOLVER, mode: 'patrol' });
          e.ai!.patrol = [...route].sort(() => this.rng.next() - 0.5);
          e.ai!.patrolI = 0;
          e.ai!.leash = 50;
          e.ai!.run = true;
          police.push(e.id);
        }
        this.activeEvent = { kind, x: districtCenterOf(d.id).x, z: districtCenterOf(d.id).z, until: this.time + 140, reward: 0, district: d.id, police };
        this.emitAll({ t: 'event', kind, text: `Descente de police ${aNom(d.name)} ! Les bobbies arrêtent tous ceux qui se battent dans le quartier.`, x: this.activeEvent.x, z: this.activeEvent.z, until: this.time + 140 });
        this.news('GRANDE DESCENTE DE POLICE', `Scotland Yard envoie ses meilleurs agents ${aNom(d.name)} pour rétablir l’ordre. Les gangs sont priés de se tenir tranquilles.`);
        break;
      }
      case 'fog': {
        this.activeEvent = { kind, x: 100, z: 70, until: this.time + 150, reward: 0, district: d.id, police: [] };
        this.emitAll({ t: 'event', kind, text: 'Un épais brouillard jaune — un vrai « pea-souper » — tombe sur Londres. Idéal pour une attaque surprise…', x: 100, z: 70, until: this.time + 150 });
        break;
      }
      case 'informant': {
        const s = SLOTS[this.rng.int(0, 1)];
        this.informantUntil[s] = this.time + 75;
        this.activeEvent = { kind, x: 100, z: 70, until: this.time + 75, reward: 0, district: d.id, police: [] };
        this.emitTo(s, { t: 'event', kind, text: `Un informateur vous vend les positions des hommes ${DE_BOSS[otherSlot(s)]} : elles apparaissent sur vos cartes pendant 75 secondes.`, x: 0, z: 0, until: this.time + 75 });
        this.updateSpotted();
        break;
      }
    }
  }

  private endEvent(): void {
    const ev = this.activeEvent;
    if (!ev) return;
    this.activeEvent = null;
    if (ev.kind === 'raid') {
      // fin de la descente : les agents rentrent au poste
      for (const id of ev.police) {
        const p = this.ents.get(id);
        if (p && p.alive) p.removeAt = this.time + 25;
        if (p && p.ai) p.ai.patrol = [this.w.buildings.find((bb) => bb.def.type === 'police')!.doors[0].in];
      }
      this.notify('all', 'La descente de police est terminée.', 'info');
    } else if (ev.kind === 'contraband' && this.time >= ev.until) {
      this.notify('all', 'Trop tard : la cargaison de contrebande a disparu.', 'info');
    }
    this.emitAll({ t: 'event', kind: 'end', text: '', x: ev.x, z: ev.z, until: 0 });
  }

  headline(): void {
    const td = this.territories('dadou');
    const te = this.territories('even');
    const kills = this.factions.dadou.kills + this.factions.even.kills;
    const options: [string, string][] = [
      ['GUERRE DES GANGS : DADOU ET EVEN SE DISPUTENT LONDRES !', 'Fusillades nocturnes, établissements rackettés : deux parrains rivaux mettent la capitale à feu et à sang. Scotland Yard promet des arrestations.'],
    ];
    if (td > te) options.push([`DADOU CONTRÔLE ${td} QUARTIER${td > 1 ? 'S' : ''} DE LA CAPITALE`, 'L’homme au chapeau melon étend son empire. Ses rivaux s’inquiètent ; Even prépare-t-il une riposte ?']);
    if (te > td) options.push([`EVEN TIENT ${te} QUARTIER${te > 1 ? 'S' : ''} SOUS SA COUPE`, 'L’élégant parrain au haut-de-forme impose sa loi. Dadou acceptera-t-il cet affront ?']);
    if (kills > 10) options.push([`${kills} MORTS DANS LA GUERRE DES GANGS`, 'Les morgues débordent. Le préfet de police réclame des renforts à Westminster.']);
    if (this.factions.dadou.heat > 2 || this.factions.even.heat > 2) options.push(['SCOTLAND YARD SUR LES DENTS', 'Les bobbies patrouillent par deux. Un témoin affirme avoir vu un parrain en personne, revolver à la main.']);
    const [title, body] = options[this.rng.int(0, options.length - 1)];
    this.news(title, body);
  }

  private timeUp(): void {
    const td = this.territories('dadou');
    const te = this.territories('even');
    let winner: Slot | null = null;
    if (td !== te) winner = td > te ? 'dadou' : 'even';
    else {
      const bd = BUILDINGS.filter((b) => this.bstate.get(b.id)!.owner === Faction.DADOU).length;
      const be = BUILDINGS.filter((b) => this.bstate.get(b.id)!.owner === Faction.EVEN).length;
      if (bd !== be) winner = bd > be ? 'dadou' : 'even';
      else if (Math.round(this.factions.dadou.money) !== Math.round(this.factions.even.money))
        winner = this.factions.dadou.money > this.factions.even.money ? 'dadou' : 'even';
    }
    this.endGame(winner, winner ? `Temps écoulé : ${BOSS_NAME[winner]} contrôle le plus de territoires.` : 'Temps écoulé : égalité parfaite !');
  }

  endGame(winner: Slot | null, reason: string): void {
    if (this.over) return;
    this.over = { winner, reason };
    const stats = {} as Record<Slot, MatchStats>;
    for (const s of SLOTS) {
      const f = this.factions[s];
      stats[s] = {
        kills: f.kills,
        deaths: f.deaths,
        captured: f.captured,
        lost: f.lost,
        territories: this.territories(s),
        recruited: f.recruited,
        earned: Math.round(f.earned),
        buildings: BUILDINGS.filter((b) => this.bstate.get(b.id)!.owner === f.faction).length,
      };
    }
    this.emitAll({ t: 'over', winner, reason, stats });
  }

  // ======================================================================= états envoyés

  snapshotFor(slot: Slot, lastSent: Map<number, number>): SnapEntity[] {
    const boss = this.ents.get(this.factions[slot].bossId)!;
    const out: SnapEntity[] = [];
    for (const e of this.ents.values()) {
      const d = Math.hypot(e.x - boss.x, e.z - boss.z);
      const last = lastSent.get(e.id) ?? -1000;
      const interval = e.role === 'boss' || d < 45 ? 1 : d < 90 ? 3 : 6;
      if (this.tick - last < interval) continue;
      lastSent.set(e.id, this.tick);
      let flags = e.flags;
      if (e.role === 'boss' && e.slot && this.factions[e.slot].heat >= 1) flags |= FLAG.WANTED;
      out.push({ id: e.id, x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch, vx: e.vx, vz: e.vz, anim: e.anim, flags, weapon: e.weapon, hp: e.maxHp > 0 ? Math.max(0, e.hp) / e.maxHp : 0 });
    }
    return out;
  }

  allInfos(): EntityInfo[] {
    return [...this.ents.values()].map((e) => this.info(e));
  }

  publicState(): PublicState {
    const battles: { x: number; z: number; intensity: number }[] = [];
    for (const s of this.shots) {
      const b = battles.find((x) => Math.hypot(x.x - s.x, x.z - s.z) < 14);
      if (b) b.intensity++;
      else battles.push({ x: s.x, z: s.z, intensity: 1 });
    }
    return {
      buildings: BUILDINGS.map((b) => {
        const st = this.bstate.get(b.id)!;
        let guards = 0;
        for (const id of st.thugs) if (this.ents.get(id)?.alive) guards++;
        return { id: b.id, owner: st.owner, cap: st.progress, capBy: st.capBy, contested: st.contested, guards };
      }),
      districts: DISTRICTS.map((d) => ({ id: d.id, owner: this.districtOwner.get(d.id) ?? 0 })),
      territories: { dadou: this.territories('dadou'), even: this.territories('even') },
      elapsed: this.time,
      timeLeft: this.settings.timeLimit > 0 ? Math.max(0, this.settings.timeLimit * 60 - this.time) : -1,
      dayTime: this.dayTime,
      battles: battles.filter((b) => b.intensity >= 2),
      event:
        this.activeEvent && this.activeEvent.kind !== 'informant'
          ? { kind: this.activeEvent.kind, x: this.activeEvent.x, z: this.activeEvent.z, until: this.activeEvent.until }
          : null,
    };
  }

  privateState(slot: Slot): PrivateState {
    const f = this.factions[slot];
    const boss = this.ents.get(f.bossId)!;
    let men = 0;
    let pool = 0;
    let escort = 0;
    for (const e of this.ents.values()) {
      if (!e.alive || e.slot !== slot || e.role !== 'gangster') continue;
      men++;
      if (e.ai!.mode === 'pool') pool++;
      if (e.ai!.mode === 'escort') escort++;
    }
    const lts: LieutenantStatus[] = f.lieutenants.map((id) => squadStatus(this, this.squads.get(id)!));
    return {
      money: Math.floor(f.money),
      income: f.income,
      men,
      pool,
      escort,
      maxMen: MAX_GANGSTERS,
      lieutenants: lts,
      upgrades: [...f.upgrades],
      weapons: [...f.weapons],
      ammo: Object.fromEntries([...f.ammo.entries()]),
      wanted: Math.ceil(f.heat - 0.001),
      dead: !boss.alive,
      respawnIn: boss.alive ? 0 : Math.max(0, f.respawnAt - this.time),
      tp: f.tp,
      kills: f.kills,
      deaths: f.deaths,
      captured: f.captured,
      nextLtPrice: f.lieutenants.length < MAX_LIEUTENANTS ? LIEUTENANT_PRICES[f.lieutenants.length] : -1,
      spotted: f.spotted,
    };
  }

  takeOutbox(): Outbox {
    const o = this.out;
    this.out = { all: [], dadou: [], even: [] };
    return o;
  }
}

export { NEWSPAPER };

/** Centre (étiquette) d'un quartier. */
function districtCenterOf(d: DistrictId): Vec2 {
  const def = DISTRICT_BY_ID[d];
  return { x: def.label[0], z: def.label[1] };
}
