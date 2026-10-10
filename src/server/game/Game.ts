// Simulation autoritaire d'une partie : entités, combats, territoires, économie.

import { Anim, CharKind, FLAG, LIEUTENANT_NAMES, RECRUITER_NAME, WEAPONS, Weapon } from '../../shared/characters';
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
  TAXI_PRICE,
  TIERS,
  tierDef,
  type OrderType,
} from '../../shared/constants';
import {
  BUILDINGS,
  DISTRICTS,
  DISTRICT_BY_ID,
  Faction,
  HQ_BUILDING,
  INTERIOR_MAX_Y,
  RESIDENCES,
  WATER_Y,
  WORLD_D,
  WORLD_W,
  districtAt,
  isWater,
  keyBuildings,
  type DistrictId,
} from '../../shared/city/plan';
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
import { closed, driveInput, explodeVehicle, launchDrone, leaveVehicle, setupVehicles, updateVehicles, vdef, vehicleAction } from './vehicles';
import { hackAction, hackedList, heistAction, heists, isHacked, securityOnCapture, setupSecurity, updateSecurity } from './security';
import { convoyHostile, convoyReadyIn, convoys, loots, neutralConvoy, sendConvoy, updateConvoys } from './convoys';
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
  /** Pluie (0..1), sa cible et le prochain changement de temps. */
  rain = 0;
  private rainTarget = 0;
  private rainNextAt = 0;

  constructor(w: SharedWorld, settings: MatchSettings) {
    this.w = w;
    this.settings = settings;
    // la partie commence à la tombée de la nuit : les néons s'allument
    this.dayTime = settings.daytime === 'night' ? 0.92 : settings.daytime === 'dusk' ? 0.77 : 0.79;
    // une bruine au début (rues mouillées qui reflètent les néons), sauf temps sec
    this.rain = this.rainTarget = settings.weather === 'clear' ? 0 : settings.weather === 'rain' ? 1 : 0.35;
    this.rainNextAt = this.rng.range(150, 220);
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
      weapons: new Set([Weapon.FISTS, Weapon.PISTOL]),
      ammo: new Map([[Weapon.PISTOL, 36]]),
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
      tier: 1,
      hqId: HQ_BUILDING[slot].id,
      garage: new Set([0]),
      vehicles: new Map(),
      vehicle: -1,
      callAt: 0,
      droneAt: 0,
      droneReveal: null,
      hack: null,
    };
  }

  // ======================================================================= mise en place

  /** QG actuel (le logement le plus élevé de l'échelle). */
  hq(slot: Slot): BuildingInfo {
    return this.w.byId.get(this.factions[slot].hqId)!;
  }

  /** Parrain dont ce bâtiment est le QG actuel, ou null. */
  hqOwnerOf(bid: number): Slot | null {
    for (const s of SLOTS) if (this.factions[s].hqId === bid) return s;
    return null;
  }

  /** Logement réservé : pas encore acheté par son parrain (ni capturable, ni à vendre aux autres). */
  isReserved(bid: number): boolean {
    const def = BUILDINGS[bid];
    return !!def.residence && this.bstate.get(bid)!.owner === Faction.NEUTRAL;
  }

  tierOf(slot: Slot) {
    return tierDef(this.factions[slot].tier);
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
        y: sp.y ?? hq.floorY,
        name: BOSS_NAME[slot],
        hp: HP.boss,
        weapon: Weapon.PISTOL,
      });
      boss.yaw = hq.desk ? hq.desk.yaw + Math.PI : 0;
      // le rabatteur qui recrute au QG
      const rp = hq.recruit ?? hq.spawn[0] ?? hq.center;
      const bar = this.addEnt({ kind: CharKind.BARMAN, role: 'barman', faction: f.faction, slot, x: rp.x, z: rp.z, y: rp.y ?? hq.floorY, hp: 100, weapon: Weapon.FISTS, mode: 'guard', name: RECRUITER_NAME[slot] });
      bar.invulnerable = true;
      bar.ai!.post = { x: rp.x, z: rp.z, y: rp.y ?? hq.floorY };
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
        // un guetteur sur le toit des bâtiments bien gardés
        const roof = info.roofPts.length && b.guards >= 4 ? info.roofPts[this.rng.int(0, info.roofPts.length - 1)] : null;
        for (let i = 0; i < b.guards; i++) {
          const p = (i === 0 && roof) || (pts[i % Math.max(1, pts.length)] ?? info.center);
          const w = this.rng.pick([Weapon.PISTOL, Weapon.PISTOL, Weapon.CLUB, Weapon.KNIFE, Weapon.SHOTGUN]);
          const e = this.addEnt({
            kind: CharKind.THUG,
            role: 'thug',
            faction: Faction.NEUTRAL,
            gang: DISTRICT_BY_ID[b.district].index,
            x: p.x,
            z: p.z,
            y: p.y ?? info.floorY,
            hp: HP.thug,
            weapon: w,
            mode: 'guard',
          });
          e.ai!.home = b.id;
          e.ai!.post = { x: p.x, z: p.z, y: p.y ?? info.floorY };
          e.ai!.leash = 16;
          st.thugs.add(e.id);
        }
      }
    }
    spawnPolice(this, 6);
    setupVehicles(this);
    setupSecurity(this);
  }

  addEnt(o: {
    id?: number;
    kind: CharKind;
    role: Role;
    faction: number;
    slot?: Slot | null;
    x: number;
    z: number;
    /** Altitude du sol visé (étages) ; la rue par défaut. */
    y?: number;
    hp: number;
    weapon: Weapon;
    name?: string;
    gang?: number;
    mode?: Mode;
    look?: number;
  }): Ent {
    const id = o.id ?? this.nextId++;
    const y = this.w.nav.heightAt(o.x, o.z, o.y ?? 0);
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
      y: Number.isFinite(y) ? y : (o.y ?? 0.25),
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
      ai: o.role === 'boss' || o.role === 'vehicle' ? null : this.makeAi(o.role, o.mode ?? 'idle'),
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
      pathGoalY: 0,
      ride: null,
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
    if (f.upgrades.has('smgs') && r < (f.upgrades.has('rifles') ? 0.55 : 0.33)) return Weapon.SMG;
    if (f.upgrades.has('pistols')) return r < 0.85 ? Weapon.PISTOL : Weapon.SHOTGUN;
    return r < 0.5 ? Weapon.PISTOL : r < 0.8 ? Weapon.CLUB : Weapon.KNIFE;
  }

  gangHp(slot: Slot, base: number): number {
    return Math.round(base * (this.factions[slot].upgrades.has('vests') ? 1.35 : 1));
  }

  /** Point libre au QG pour un gangster de réserve. */
  poolPost(slot: Slot, i: number): Vec2 {
    const hq = this.hq(slot);
    // les hommes de réserve attendent devant et dans le QG (jamais au-delà de 60 postes : ils se serrent)
    const all = [...hq.guardOut, ...hq.defend];
    return all[i % all.length];
  }

  spawnGangster(slot: Slot): Ent | null {
    if (this.countMen(slot) >= this.tierOf(slot).maxMen) return null;
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
      y: p.y ?? hq.floorY,
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
    if (f.lieutenants.length >= this.tierOf(slot).maxLt) return null;
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
      y: p.y ?? hq.floorY,
      hp: this.gangHp(slot, HP.lieutenant),
      weapon: f.upgrades.has('rifles') ? Weapon.RIFLE : Weapon.PISTOL,
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
      for (const zn of b.zone) {
        const r = zn.rect;
        if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) {
          if (y === undefined || (y >= zn.y0 - 0.6 && y <= zn.y1)) return b.id;
        }
      }
    }
    return -1;
  }

  /** Dans le bâtiment ou sur son toit. */
  inBuildingArea(b: BuildingInfo, x: number, y: number, z: number): boolean {
    const f = b.footprint;
    if (x < f[0] || x > f[2] || z < f[1] || z > f[3]) return false;
    if (b.roofY !== null && y >= b.roofY - 0.6) return true;
    return this.insideBuilding(b, x, y, z);
  }

  /** Le point est-il dans un des volumes intérieurs du bâtiment ? */
  insideBuilding(b: BuildingInfo, x: number, y: number, z: number): boolean {
    for (const zn of b.zone) {
      const r = zn.rect;
      if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3] && y >= zn.y0 - 0.6 && y <= zn.y1) return true;
    }
    return false;
  }

  // ======================================================================= hostilité

  hostile(a: Ent, b: Ent): boolean {
    if (!b.alive || a.id === b.id || b.invulnerable || a.invulnerable) return false;
    if (b.flags & FLAG.HIDDEN) return false; // dans un ascenseur, à l'intérieur d'un véhicule
    if (b.role === 'barman' || a.role === 'vehicle') return false;
    // tourelles : elles tirent sur les intrus du camp adverse dans leur bâtiment (sauf piratées)
    if (a.role === 'turret') {
      const home = a.ai!.home;
      if (home < 0 || isHacked(this, home)) return false;
      if (b.role === 'vehicle' || b.role === 'turret' || b.role === 'police') return false;
      if (b.faction !== Faction.DADOU && b.faction !== Faction.EVEN) return false;
      if (b.faction === a.faction) return false;
      return this.inBuildingArea(this.building(home), b.x, b.y, b.z) || Math.hypot(b.x - a.x, b.z - a.z) < 9;
    }
    if (b.role === 'turret') {
      if (isHacked(this, b.ai!.home)) return false;
      if (b.faction === a.faction || a.faction === Faction.POLICE) return false;
      if (b.faction === Faction.DADOU || b.faction === Faction.EVEN) return a.faction === Faction.DADOU || a.faction === Faction.EVEN;
      // tourelle neutre : on la vise si elle nous menace ou si on prend son bâtiment
      if (a.ai && a.ai.squad >= 0 && this.squads.get(a.ai.squad)?.goalBuilding === b.ai!.home) return true;
      return b.ai!.target >= 0 && this.ents.get(b.ai!.target)?.faction === a.faction;
    }
    if (b.role === 'vehicle') {
      // convoi blindé (pilote automatique)
      if (b.veh?.auto && vdef(b).cls === 'truck') return convoyHostile(this, a, b);
      // un véhicule est une cible si son conducteur en est une
      const d = b.veh && b.veh.driver >= 0 ? this.ents.get(b.veh.driver) : undefined;
      if (!d || !d.alive) return false;
      const hidden = d.flags & FLAG.HIDDEN;
      d.flags &= ~FLAG.HIDDEN;
      const h = this.hostile(a, d);
      d.flags |= hidden;
      return h;
    }
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
      if (this.inBuildingArea(hb, b.x, b.y, b.z)) return true;
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
        if (Math.hypot(boss.x - b.x, boss.z - b.z) < 14 && home >= 0 && this.inBuildingArea(this.building(home), boss.x, boss.y, boss.z)) return true;
      }
      // menace : un voyou qui vise un camarade proche
      return b.ai!.target >= 0 && this.ents.get(b.ai!.target)?.faction === af;
    }
    return false;
  }

  // ======================================================================= dégâts

  damage(target: Ent, amount: number, attacker: Ent | null, head = false, hx?: number, hy?: number, hz?: number): void {
    if (!target.alive || target.invulnerable || this.over) return;
    const dmg = Math.round(amount * (head && target.role !== 'vehicle' ? 1.8 : 1));
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
    if (target.role === 'vehicle') {
      explodeVehicle(this, target, attacker);
      return;
    }
    // parrain abattu sur sa moto : il tombe
    if (target.role === 'boss' && target.slot && this.factions[target.slot].vehicle >= 0) {
      const v = this.ents.get(this.factions[target.slot].vehicle);
      if (v && v.veh) {
        v.veh.driver = -1;
        v.flags &= ~FLAG.VEHICLE;
        this.emitAll({ t: 'ride', id: v.id, driver: -1 });
      }
      this.factions[target.slot].vehicle = -1;
    }
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
      case 'turret':
        return 'une tourelle';
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
    // au volant : le client envoie la position du véhicule
    if (f.vehicle >= 0) {
      const v = this.ents.get(f.vehicle);
      if (!v || !v.alive || !v.veh || v.veh.driver !== e.id) {
        f.vehicle = -1;
        e.flags &= ~(FLAG.VEHICLE | FLAG.HIDDEN);
      } else {
        const cx = clamp(x, 0.5, WORLD_W - 0.5);
        const cz = clamp(z, 0.5, WORLD_D - 0.5);
        if (!driveInput(this, slot, v, cx, clamp(y, -9, 90), cz, yaw, vx, vz, dt) && this.time - f.tpAt > 1) {
          this.teleport(slot, v.x, v.y, v.z, v.yaw);
          return;
        }
        e.pitch = clamp(pitch, -1.5, 1.5);
        const keep = FLAG.VEHICLE | (closed(vdef(v)) ? FLAG.HIDDEN : 0);
        e.flags = (flags & FLAG.AIM) | keep;
        if (f.weapons.has(weapon as Weapon)) e.weapon = weapon as Weapon;
        return;
      }
    }
    const dist = Math.hypot(x - e.x, z - e.z);
    const maxD = 9.5 * dt + 1.2;
    if (dist > maxD && this.time - f.tpAt > 1) {
      // déplacement impossible : on recale le joueur
      this.teleport(slot, e.x, e.y, e.z, e.yaw);
      return;
    }
    e.x = clamp(x, 0.5, WORLD_W - 0.5);
    e.y = clamp(y, -9, INTERIOR_MAX_Y + 20);
    e.z = clamp(z, 0.5, WORLD_D - 0.5);
    e.yaw = yaw;
    e.pitch = clamp(pitch, -1.5, 1.5);
    e.vx = clamp(vx, -8, 8);
    e.vz = clamp(vz, -8, 8);
    e.anim = anim === Anim.DEAD ? Anim.IDLE : (anim as Anim);
    e.flags = flags & ~FLAG.WANTED;
    if (f.weapons.has(weapon as Weapon)) e.weapon = weapon as Weapon;
    // tombé dans l'East River
    if (e.y < WATER_Y - 0.4 && e.y > WATER_Y - 4 && isWater(e.x, e.z)) {
      this.notify(slot, 'Vous êtes tombé dans l’East River ! Un drone de secours vous repêche…', 'info');
      this.respawnBoss(slot, this.hq(slot), false);
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
      if (t.flags & FLAG.HIDDEN) continue;
      if (t.role === 'vehicle') {
        const vd = vdef(t);
        if (Math.hypot(hx - t.x, hz - t.z) > Math.max(vd.size[0], vd.size[2]) / 2 + 0.6 || hy < t.y - 0.6 || hy > t.y + vd.size[1] + 0.6) continue;
      } else if (Math.hypot(hx - t.x, hz - t.z) > 1.6 || hy < t.y - 0.6 || hy > t.y + 2.4) continue;
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
        const room = this.tierOf(slot).maxMen - this.countMen(slot);
        if (room <= 0) {
          const next = f.tier < TIERS.length ? ` Emménagez dans un logement plus grand pour en accueillir davantage.` : '';
          return this.notify(slot, `Effectif maximal atteint (${this.tierOf(slot).maxMen} hommes).${next}`, 'bad');
        }
        if (f.money < b.price) return this.notify(slot, `Pas assez d’argent : il faut ${formatMoney(b.price)}.`, 'bad');
        f.money -= b.price;
        const n = Math.min(b.n, room);
        for (let i = 0; i < n; i++) this.spawnGangster(slot);
        f.recruited += n;
        this.notify(slot, n === 1 ? 'Une nouvelle recrue vous attend au QG.' : `${n} nouvelles recrues vous attendent au QG.`, 'money');
        break;
      }
      case 'hire': {
        if (f.lieutenants.length >= this.tierOf(slot).maxLt) {
          const next = f.tier < TIERS.length ? ' Un QG plus prestigieux vous permettra d’en engager davantage.' : '';
          return this.notify(slot, `Vous avez déjà le maximum de lieutenants (${this.tierOf(slot).maxLt}).${next}`, 'bad');
        }
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
        if (u.tier && f.tier < u.tier) return this.notify(slot, `Il faut un QG plus prestigieux (${tierDef(u.tier).name.toLowerCase()} ou mieux).`, 'bad');
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
        if (def.residence) return this.action(slot, { a: 'moveIn', b: def.id });
        if (st.owner !== Faction.NEUTRAL) return this.notify(slot, 'Ce bâtiment n’est pas à vendre.', 'bad');
        if (def.price <= 0 || [...st.thugs].some((id) => this.ents.get(id)?.alive)) return this.notify(slot, 'Ce bâtiment est tenu par un gang : il faut le prendre par la force.', 'bad');
        if (f.money < def.price) return this.notify(slot, `Pas assez d’argent : il faut ${formatMoney(def.price)}.`, 'bad');
        f.money -= def.price;
        this.setOwner(act.b, f.faction, slot);
        this.notify(slot, `Vous avez acheté ${leNom(def.name)}. Revenus : +${def.income} $/min.`, 'money');
        break;
      }
      case 'moveIn': {
        const def = BUILDINGS[act.b];
        if (!def || !def.residence) return;
        if (def.residence.boss !== slot) return this.notify(slot, `Ce logement est réservé à ${BOSS_NAME[def.residence.boss]}.`, 'bad');
        const tier = def.residence.tier;
        if (tier <= f.tier) return this.notify(slot, 'Vous avez déjà un QG plus prestigieux.', 'info');
        if (tier !== f.tier + 1) return this.notify(slot, `Il faut d’abord emménager ${aNom(RESIDENCES[slot][f.tier].name)}.`, 'bad');
        if (this.bstate.get(def.id)!.owner !== Faction.NEUTRAL) return;
        const need = tierDef(tier).districts;
        const have = this.territories(slot);
        if (have < need) return this.notify(slot, `Pour emménager ${aNom(def.name)}, contrôlez au moins ${need} quartier${need > 1 ? 's' : ''} (vous en avez ${have}).`, 'bad');
        if (f.money < def.price) return this.notify(slot, `Pas assez d’argent : il faut ${formatMoney(def.price)}.`, 'bad');
        f.money -= def.price;
        this.moveHq(slot, def.id);
        break;
      }
      case 'goHome': {
        const boss = this.ents.get(f.bossId)!;
        if (!boss.alive) return;
        if (f.heat >= 1) return this.notify(slot, 'Impossible : la police vous recherche. Semez-la d’abord !', 'bad');
        if (this.time - boss.lastDamageAt < 12) return this.notify(slot, 'Impossible en plein combat.', 'bad');
        if (f.money < TAXI_PRICE) return this.notify(slot, `Pas assez d’argent : il faut ${formatMoney(TAXI_PRICE)}.`, 'bad');
        f.money -= TAXI_PRICE;
        const hq = this.hq(slot);
        const sp = hq.deskSeat ?? hq.spawn[0] ?? hq.center;
        const y = this.w.nav.heightAt(sp.x, sp.z, sp.y ?? hq.floorY);
        this.teleport(slot, sp.x, Number.isFinite(y) ? y : (sp.y ?? hq.floorY), sp.z, hq.desk ? hq.desk.yaw + Math.PI : 0);
        this.notify(slot, `Un taxi volant vous dépose ${aNom(hq.def.name)} (−${formatMoney(TAXI_PRICE)}).`, 'money');
        break;
      }
      case 'quick':
        this.quickCommand(slot, act);
        break;
      case 'vehicle':
        vehicleAction(this, slot, act.op, act.id, act.v);
        break;
      case 'drone':
        launchDrone(this, slot, act.d);
        break;
      case 'hack':
        hackAction(this, slot, act.b);
        break;
      case 'heist':
        heistAction(this, slot, act.b);
        break;
      case 'convoy':
        sendConvoy(this, slot);
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
          this.notify(slot, 'Un passant innocent a été abattu ! Le NYPD est sur les dents.', 'alert', 'civilian', 25);
        }
        break;
      }
      case 'customize': {
        const c = act.custom;
        const clean: Record<string, unknown> = {};
        for (const k of ['coat', 'vest', 'tie', 'hatband', 'accent']) if (typeof c[k] === 'number') clean[k] = c[k];
        if (typeof c.hat === 'string' && ['bowler', 'top', 'flatcap', 'fedora'].includes(c.hat)) clean.hat = c.hat;
        f.custom = clean;
        const e = this.ents.get(f.bossId)!;
        this.emitAll({ t: 'spawn', e: this.info(e) });
        break;
      }
      default:
        break;
    }
  }

  /** Le parrain emménage dans le logement suivant : le QG, le rabatteur, la réserve et les gardes déménagent. */
  moveHq(slot: Slot, bid: number): void {
    const f = this.factions[slot];
    const def = BUILDINGS[bid];
    const prevHq = this.hq(slot);
    f.tier = def.residence!.tier;
    f.hqId = bid;
    this.setOwner(bid, f.faction);
    const hq = this.hq(slot);
    // le rabatteur prend un taxi volant : il attend déjà au nouveau QG
    for (const e of this.ents.values()) {
      if (e.slot !== slot || !e.alive) continue;
      if (e.role === 'barman') {
        const rp = hq.recruit ?? hq.spawn[0] ?? hq.center;
        e.x = rp.x;
        e.z = rp.z;
        e.y = rp.y ?? hq.floorY;
        e.ai!.post = { x: rp.x, z: rp.z, y: rp.y ?? hq.floorY };
        e.ai!.path = null;
      }
    }
    // la réserve rejoint le nouveau QG à pied (vraiment, à travers la ville)
    let i = 0;
    for (const e of this.poolMembers(slot)) {
      e.ai!.post = this.poolPost(slot, i++);
      e.ai!.run = true;
    }
    // les lieutenants sans ordre aussi
    f.lieutenants.forEach((id, k) => {
      const sq = this.squads.get(id);
      const lt = this.ents.get(id);
      if (sq && lt && lt.alive && !sq.order) lt.ai!.post = this.poolPost(slot, 3 + k);
    });
    // les gardes d'élite déménagent
    let g = 0;
    for (const e of this.ents.values()) {
      if (e.slot !== slot || !e.alive || e.role !== 'guard') continue;
      e.ai!.post = this.guardPost(slot, g++);
      e.ai!.home = hq.id;
    }
    f.guardRespawnAt = this.time + 5;
    const td = this.tierOf(slot);
    this.emitAll({ t: 'hq', slot, b: bid, tier: f.tier });
    this.notify(slot, `Bienvenue chez vous : ${def.name} ! (${td.name} — ${td.perks.join(', ')})`, 'good');
    this.notify(otherSlot(slot), `${BOSS_NAME[slot]} s’installe ${aNom(def.name)} : son nouveau quartier général.`, 'alert');
    void prevHq;
    const where = DISTRICT_BY_ID[def.district].name;
    const titles: Record<number, string> = {
      2: `${BOSS_NAME[slot].toUpperCase()} OUVRE UN GARAGE ${aNom(where).toUpperCase()}`,
      3: `${BOSS_NAME[slot].toUpperCase()} S’OFFRE UN LOFT ${aNom(where).toUpperCase()}`,
      4: `${BOSS_NAME[slot].toUpperCase()} EMMÉNAGE DANS UN PENTHOUSE DE LUXE`,
      5: `${BOSS_NAME[slot].toUpperCase()} PREND POSSESSION ${deNom(def.name).toUpperCase()}`,
    };
    if (titles[f.tier]) this.news(titles[f.tier], `${MAFIA_NAME[slot]} prend du galon : son parrain règne désormais depuis ${leNom(def.name)}. ${BOSS_NAME[otherSlot(slot)]} n’a qu’à bien se tenir.`);
  }

  /** Poste d'un garde d'élite : la moitié dehors devant l'entrée, l'autre à l'intérieur. */
  guardPost(slot: Slot, i: number): Vec2 {
    const hq = this.hq(slot);
    if (i % 2 === 0 || hq.defend.length === 0) return hq.guardOut[(i >> 1) % hq.guardOut.length];
    return hq.defend[(i * 7) % hq.defend.length];
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
      if (e.role === 'gangster' && (id === 'pistols' || id === 'smgs' || id === 'rifles')) {
        if (id === 'pistols' && (e.weapon === Weapon.CLUB || e.weapon === Weapon.KNIFE || e.weapon === Weapon.FISTS)) e.weapon = Weapon.PISTOL;
        else if (id !== 'pistols' && this.rng.chance(id === 'rifles' ? 0.25 : 0.33)) e.weapon = id === 'rifles' ? Weapon.RIFLE : Weapon.SMG;
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
    securityOnCapture(this, bid, owner);
    const prevSlot = factionSlot(prev);
    const newSlot = factionSlot(owner);
    if (newSlot) this.factions[newSlot].captured++;
    if (prevSlot) this.factions[prevSlot].lost++;
    if (newSlot && by !== undefined) {
      const bossName = BOSS_NAME[newSlot];
      this.notify(newSlot, `Les hommes ${DE_BOSS[newSlot]} ont capturé ${leNom(def.name)} ! (+${def.income} $/min)`, 'good');
      if (prevSlot) this.notify(prevSlot, `${MAFIA_NAME[prevSlot]} a perdu ${leNom(def.name)} au profit ${DE_BOSS[newSlot]} !`, 'bad');
      else this.notify(otherSlot(newSlot), `Les hommes ${DE_BOSS[newSlot]} ont capturé ${leNom(def.name)}.`, 'info');
    }
    // les voyous survivants s'enfuient
    if (prev === Faction.NEUTRAL) {
      for (const id of st.thugs) {
        const t = this.ents.get(id);
        if (t && t.alive) {
          t.ai!.mode = 'flee';
          t.ai!.post = { x: clamp(t.x + this.rng.range(-40, 40), 4, WORLD_W - 4), z: clamp(t.z + this.rng.range(-40, 40), 4, WORLD_D - 4) };
          t.ai!.run = true;
          t.ai!.target = -1;
          t.removeAt = this.time + 20;
          t.faction = Faction.NEUTRAL;
          t.ai!.home = -1;
        }
      }
      st.thugs.clear();
    }
    // victoire : prise du QG actuel du parrain adverse
    const hqOf = this.hqOwnerOf(bid);
    if (hqOf && newSlot && hqOf !== newSlot) {
      this.endGame(newSlot, `${BOSS_NAME[newSlot]} a pris ${leNom(def.name)}, le quartier général ${DE_BOSS[hqOf]} !`);
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
          this.notify(ns, `${BOSS_NAME[ns]} a pris le contrôle ${deNom(d.name)} ! (+${DISTRICT_BONUS} $/min)`, 'good');
          this.notify(otherSlot(ns), `${BOSS_NAME[ns]} a pris le contrôle ${deNom(d.name)} !`, 'alert');
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
      if (!def.capturable || this.isReserved(def.id)) continue;
      const st = this.bstate.get(def.id)!;
      const info = this.building(def.id);
      const hqOf = this.hqOwnerOf(def.id);
      let c1 = 0;
      let c2 = 0;
      let cn = 0;
      const cx = (info.footprint[0] + info.footprint[2]) / 2;
      const cz = (info.footprint[1] + info.footprint[3]) / 2;
      const r = Math.hypot(info.footprint[2] - info.footprint[0], info.footprint[3] - info.footprint[1]) / 2 + 1;
      this.near(cx, cz, r, (e) => {
        if (!e.alive || e.role === 'barman' || e.role === 'police' || e.role === 'vehicle' || e.role === 'turret' || e.flags & FLAG.HIDDEN) return;
        if (!this.insideBuilding(info, e.x, e.y, e.z)) return;
        if (e.faction === Faction.DADOU) c1++;
        else if (e.faction === Faction.EVEN) c2++;
        else if (e.role === 'thug' && e.ai!.home === def.id) cn++;
      });
      const counts: Record<number, number> = { [Faction.NEUTRAL]: cn, [Faction.DADOU]: c1, [Faction.EVEN]: c2 };
      const owner = st.owner;
      const defenders = counts[owner] ?? 0;
      const attackers = [Faction.DADOU, Faction.EVEN].filter((f) => f !== owner && counts[f] > 0);
      st.attackers = attackers.reduce((s, f) => s + counts[f], 0);
      const time = hqOf ? CAPTURE_TIME.hq : def.isKey ? CAPTURE_TIME.key : CAPTURE_TIME.normal;
      st.contested = false;
      if (attackers.length === 1 && defenders === 0) {
        const F = attackers[0];
        const fs = factionSlot(F)!;
        if (hqOf && this.territories(fs) < HQ_CAPTURE_MIN_DISTRICTS) {
          st.contested = true;
          this.notify(fs, `Le QG ${DE_BOSS[hqOf]} est imprenable : contrôlez au moins ${HQ_CAPTURE_MIN_DISTRICTS} quartiers sur 7 (vous en avez ${this.territories(fs)}).`, 'info', 'hq-locked', 15);
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
          if (hqOf === os) this.notify(os, `ATTENTION ! ${BOSS_NAME[fs]} est dans votre quartier général !`, 'alert');
          else if (def.isKey) this.notify(os, `${MAFIA_NAME[os]} risque de perdre un bâtiment stratégique ${aNom(DISTRICT_BY_ID[def.district].name)} !`, 'alert', `key-${def.id}`, 60);
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
    updateVehicles(this);
    updateSecurity(this, dt);
    updateConvoys(this, dt);
    if (this.tick % 20 === 0) this.updateSpotted();
    this.updateEvents();
    this.updateWeather(dt);
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
      inc += this.territories(slot) * DISTRICT_BONUS;
      inc *= this.tierOf(slot).incomeMul;
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
      // gardes d'élite du QG (selon le palier du logement)
      const wantGuards = this.tierOf(slot).guards;
      if (wantGuards > 0 && this.time >= f.guardRespawnAt) {
        f.guardRespawnAt = this.time + 45;
        let guards = 0;
        for (const e of this.ents.values()) if (e.alive && e.slot === slot && e.role === 'guard') guards++;
        const hq = this.hq(slot);
        for (let i = guards; i < wantGuards; i++) {
          const p = this.guardPost(slot, i);
          const w = f.tier >= 5 ? (i % 3 === 0 ? Weapon.RIFLE : Weapon.SMG) : f.tier >= 4 ? Weapon.SMG : Weapon.SHOTGUN;
          const g = this.addEnt({ kind: CharKind.GANGSTER, role: 'guard', faction: f.faction, slot, x: p.x, z: p.z, y: p.y ?? 0, hp: HP.guard, weapon: w, mode: 'guard' });
          g.ai!.post = { x: p.x, z: p.z, y: p.y ?? 0 };
          g.ai!.leash = 22;
          g.ai!.home = hq.id;
          g.ai!.accuracy = 0.66;
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
    if (f.vehicle >= 0) {
      const v = this.ents.get(f.vehicle);
      if (v && v.veh && v.alive) leaveVehicle(this, slot, v);
      f.vehicle = -1;
    }
    boss.flags &= ~(FLAG.VEHICLE | FLAG.HIDDEN);
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
    const y = this.w.nav.heightAt(sp.x, sp.z, sp.y ?? hq.floorY);
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
      const drone = f.droneReveal && this.time < f.droneReveal.until ? DISTRICT_BY_ID[f.droneReveal.district as DistrictId] : null;
      for (const e of this.ents.values()) {
        if (!e.alive || e.slot !== enemy || e.role === 'barman' || e.role === 'boss' || e.role === 'vehicle' || e.flags & FLAG.HIDDEN) continue;
        let vis = informed || (!!drone && e.x >= drone.rect[0] && e.x < drone.rect[2] && e.z >= drone.rect[1] && e.z < drone.rect[3]);
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

  private updateWeather(dt: number): void {
    const w = this.settings.weather;
    if (this.activeEvent?.kind === 'storm') this.rainTarget = 1;
    else if (w === 'rain') this.rainTarget = 1;
    else if (w === 'clear') this.rainTarget = 0;
    else if (this.time >= this.rainNextAt) {
      // alternance : temps sec 4 à 8 min, averse 2 à 4 min
      if (this.rainTarget > 0) {
        this.rainTarget = 0;
        this.rainNextAt = this.time + this.rng.range(240, 480);
      } else {
        this.rainTarget = this.rng.range(0.45, 1);
        this.rainNextAt = this.time + this.rng.range(120, 240);
      }
    }
    this.rain += clamp(this.rainTarget - this.rain, -dt / 25, dt / 25);
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
    } else if (ev.kind === 'convoy' && !convoys(this).some((c) => !c.owner)) {
      this.endEvent();
      return;
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

  /** Commissariat le plus proche d'un point. */
  precinctNear(x: number, z: number): BuildingInfo {
    let best = this.w.buildings[0];
    let bd = Infinity;
    for (const b of this.w.buildings) {
      if (b.def.type !== 'police') continue;
      const d = Math.hypot(b.center.x - x, b.center.z - z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  /** Lance un événement aléatoire. */
  private startRandomEvent(): void {
    const kinds = ['contraband', 'contraband', 'convoy', 'convoy', 'raid', 'storm', 'informant'];
    const kind = kinds[this.rng.int(0, kinds.length - 1)];
    // pas de descente dans les fiefs de départ (Brooklyn et le Queens)
    const districts = DISTRICTS.filter((d) => d.id !== HQ_BUILDING.dadou.district && d.id !== HQ_BUILDING.even.district);
    const d = kind === 'contraband' ? DISTRICTS[this.rng.int(0, DISTRICTS.length - 1)] : districts[this.rng.int(0, districts.length - 1)];
    const inDistrict = BUILDINGS.filter((b) => b.district === d.id && !b.residence && b.type !== 'landmark');
    const b = this.building(inDistrict[this.rng.int(0, inDistrict.length - 1)].id);
    const out = b.doors[0].out;
    // point praticable dans la rue, un peu à l'écart de la porte
    let x = out.x;
    let z = out.z;
    const n = this.w.nav.nearestWalkable(out.x + this.rng.range(-3, 3), out.z + this.rng.range(-3, 3), 0, 8);
    if (n >= 0) [x, z] = this.w.nav.nodeCenter(n);
    switch (kind) {
      case 'contraband': {
        const reward = 300 + 60 * this.rng.int(0, 5);
        const loot = this.rng.pick(['puces neurales', 'implants militaires', 'batteries à fusion', 'cartouches de crypto-monnaie']);
        this.activeEvent = { kind, x, z, until: this.time + 150, reward, district: d.id, police: [] };
        const text = `Une cargaison de ${loot} de contrebande attend preneur près ${deNom(b.def.name)} (${d.name}) ! Le premier parrain sur place empoche ${formatMoney(reward)}.`;
        this.emitAll({ t: 'event', kind, text, x, z, until: this.time + 150 });
        this.news('CONTREBANDE : LES DOUANES DÉBORDÉES', `Des caisses de ${loot} sans licence auraient été aperçues du côté ${deNom(d.name)}. Les gangs de Dadou et d’Even sont sur le coup.`);
        break;
      }
      case 'raid': {
        const police: number[] = [];
        const c = districtCenterOf(d.id);
        const yard = this.precinctNear(c.x, c.z);
        const route = BUILDINGS.filter((bb) => bb.district === d.id && !bb.residence).map((bb) => this.building(bb.id).doors[0].out);
        for (let i = 0; i < 5; i++) {
          const p = yard.doors[0].out;
          const e = this.addEnt({ kind: CharKind.POLICE, role: 'police', faction: Faction.POLICE, x: p.x + this.rng.range(-2, 2), z: p.z + this.rng.range(-2, 2), hp: HP.police, weapon: Weapon.PISTOL, mode: 'patrol' });
          e.ai!.patrol = [...route].sort(() => this.rng.next() - 0.5);
          e.ai!.patrolI = 0;
          e.ai!.leash = 50;
          e.ai!.run = true;
          police.push(e.id);
        }
        this.activeEvent = { kind, x: c.x, z: c.z, until: this.time + 140, reward: 0, district: d.id, police };
        this.emitAll({ t: 'event', kind, text: `Descente du NYPD ${aNom(d.name)} ! Les agents arrêtent tous ceux qui se battent dans le quartier.`, x: c.x, z: c.z, until: this.time + 140 });
        this.news('LE NYPD FRAPPE FORT', `La maire envoie ses unités d’élite ${aNom(d.name)} pour rétablir l’ordre. Les gangs sont priés de se tenir tranquilles.`);
        break;
      }
      case 'convoy': {
        const t = neutralConvoy(this);
        if (!t) return;
        this.activeEvent = { kind, x: t.x, z: t.z, until: this.time + 200, reward: 0, district: d.id, police: [] };
        this.emitAll({ t: 'event', kind, text: 'Un convoi blindé de la Banque Fédérale traverse Manhattan ! Détruisez le camion pour rafler son chargement — le NYPD n’appréciera pas.', x: t.x, z: t.z, until: this.time + 200 });
        this.news('UN CONVOI DE LA BANQUE FÉDÉRALE SOUS HAUTE TENSION', 'Les parrains de la ville rôdent autour du camion blindé. La banque assure que « tout est sous contrôle ».');
        break;
      }
      case 'storm': {
        this.activeEvent = { kind, x: WORLD_W / 2, z: WORLD_D / 2, until: this.time + 150, reward: 0, district: d.id, police: [] };
        this.emitAll({ t: 'event', kind, text: 'Un orage magnétique s’abat sur New York : pluie battante, visibilité réduite, drones de police cloués au sol. Idéal pour une attaque surprise…', x: WORLD_W / 2, z: WORLD_D / 2, until: this.time + 150 });
        break;
      }
      case 'informant': {
        const s = SLOTS[this.rng.int(0, 1)];
        this.informantUntil[s] = this.time + 75;
        this.activeEvent = { kind, x: WORLD_W / 2, z: WORLD_D / 2, until: this.time + 75, reward: 0, district: d.id, police: [] };
        this.emitTo(s, { t: 'event', kind, text: `Une hackeuse vous vend les positions des hommes ${DE_BOSS[otherSlot(s)]} : elles apparaissent sur vos cartes pendant 75 secondes.`, x: 0, z: 0, until: this.time + 75 });
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
        if (p && p.ai) p.ai.patrol = [this.precinctNear(p.x, p.z).doors[0].in];
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
      ['GUERRE DES GANGS : DADOU ET EVEN SE DISPUTENT NEW YORK !', 'Fusillades sous les néons, établissements rackettés : deux parrains rivaux mettent la ville à feu et à sang. Le NYPD promet des arrestations.'],
      ['LA VILLE QUI NE DORT JAMAIS RETIENT SON SOUFFLE', 'Des écrans de Times Square aux quais de Red Hook, tout New York parle de la guerre entre Dadou et Even.'],
    ];
    if (td > te) options.push([`DADOU CONTRÔLE ${td} QUARTIER${td > 1 ? 'S' : ''} DE NEW YORK`, 'L’homme au chapeau melon étend son empire. Ses rivaux s’inquiètent ; Even prépare-t-il une riposte ?']);
    if (te > td) options.push([`EVEN TIENT ${te} QUARTIER${te > 1 ? 'S' : ''} SOUS SA COUPE`, 'L’élégant parrain au haut-de-forme impose sa loi. Dadou acceptera-t-il cet affront ?']);
    if (kills > 10) options.push([`${kills} MORTS DANS LA GUERRE DES GANGS`, 'Les morgues débordent. La maire réclame des drones de police supplémentaires.']);
    if (this.factions.dadou.heat > 2 || this.factions.even.heat > 2) options.push(['LE NYPD SUR LES DENTS', 'Les drones de police quadrillent le ciel. Un témoin affirme avoir vu un parrain en personne, arme au poing.']);
    for (const sl of SLOTS) {
      const f = this.factions[sl];
      if (f.tier >= 4) options.push([`${BOSS_NAME[sl].toUpperCase()} VIT AU SOMMET`, `Depuis ${leNom(this.hq(sl).def.name)}, le parrain contemple la ville qu’il veut faire sienne.`]);
    }
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
    const rides: [number, number][] = [];
    for (const e of this.ents.values()) if (e.role === 'vehicle' && e.alive && e.veh && e.veh.driver >= 0) rides.push([e.id, e.veh.driver]);
    return {
      rides,
      hacked: hackedList(this),
      convoys: convoys(this).map((c) => {
        const e = this.ents.get(c.id);
        return { id: c.id, slot: c.owner, x: e ? Math.round(e.x * 10) / 10 : 0, z: e ? Math.round(e.z * 10) / 10 : 0, reward: c.reward };
      }),
      loot: loots(this).map((l) => ({ x: l.x, z: l.z, reward: l.reward })),
      heists: heists(this).map((h) => ({ b: h.b, slot: h.slot, p: Math.min(1, h.progress) })),
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
      hq: { dadou: this.factions.dadou.hqId, even: this.factions.even.hqId },
      tier: { dadou: this.factions.dadou.tier, even: this.factions.even.tier },
      rain: Math.round(this.rain * 100) / 100,
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
      maxMen: this.tierOf(slot).maxMen,
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
      nextLtPrice: f.lieutenants.length < this.tierOf(slot).maxLt ? LIEUTENANT_PRICES[f.lieutenants.length] : -1,
      maxLt: this.tierOf(slot).maxLt,
      tier: f.tier,
      hq: f.hqId,
      garage: [...f.garage],
      vehicle: f.vehicle,
      callIn: Math.max(0, Math.ceil(f.callAt - this.time)),
      droneIn: Math.max(0, Math.ceil(f.droneAt - this.time)),
      droneOver: f.droneReveal && this.time < f.droneReveal.until ? (f.droneReveal.district as DistrictId) : null,
      hack: f.hack ? { b: f.hack.b, p: Math.min(1, (this.time - f.hack.start) / Math.max(0.1, f.hack.done - f.hack.start)) } : null,
      convoyIn: convoyReadyIn(this, slot),
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
