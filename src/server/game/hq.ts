// Équipements du quartier général (catégorie « hq » de UPGRADES) : carte holographique,
// surveillance, drones, communications, sécurité, gardes d'élite, station cybernétique, armurerie
// avancée, centre d'opérations, transport, recrutement automatique et salle des trophées.
// Ils appartiennent au parrain, pas au bâtiment : ils déménagent avec lui et réapparaissent dans
// le nouveau bureau (le client les dessine aux emplacements BuildingInfo.hqAnchors, voir
// client/game/hqVisuals.ts). Mêmes règles et mêmes prix pour Dadou et Even.
// Cliniques cybernétiques (gen/clinics.ts) : avec la station du QG, ce sont les seuls points
// d'installation des implants ; une clinique est fermée au parrain dont le rival tient le bâtiment.

import { CharKind, FLAG, WEAPONS, Weapon } from '../../shared/characters';
import { AMMO_PRICE, BOSS_NAME, BOSS_SHOP, DE_BOSS, ORDER_LABEL, VEHICLES } from '../../shared/constants';
import { BUILDINGS, DISTRICTS, DISTRICT_BY_ID, type DistrictId } from '../../shared/city/plan';
import type { BuildingInfo, ClinicInfo, HqAnchor } from '../../shared/city/gen/context';
import { clinicSeat } from '../../shared/city/gen/clinics';
import { GRENADE_MAX, GRENADE_PRICE } from '../../shared/grenade';
import { aNom, deNom, leNom } from '../../shared/french';
import type { ClientAction, HqPrivate, PrivateState, PublicState, Slot } from '../../shared/protocol';
import { formatMoney } from '../../shared/util';
import { setStationPoints, STATION_RANGE } from './cyber';
import { SLOTS, deskFacing, factionSlot, otherSlot, slotFaction, type Game } from './Game';
import type { GameModule } from './modules';
import { installHqTurrets } from './security';
import { opsList } from './conquest';
import type { Ent } from './types';
import { DRONE_COOLDOWN, spawnVehicle } from './vehicles';

/** Équipements du QG visibles dans le bureau (état public : le rival les voit s'il s'y introduit). */
export const HQ_UPGRADES = ['holomap', 'surveil', 'autorecruit', 'security', 'comms', 'cyberstation', 'armory2', 'transport', 'trophies', 'elite', 'dronecmd', 'opscenter'] as const;
export type HqUpgrade = (typeof HQ_UPGRADES)[number];

/** Réglages des équipements (identiques pour les deux parrains). */
export const HQ = {
  /** Surveillance : rayon autour du QG et des bâtiments clés (m). */
  surveilHq: 50,
  surveilKey: 30,
  /** Drone de patrouille : rayon de détection autour du QG (m), délai avant un nouveau drone (s). */
  patrolRange: 45,
  patrolRespawn: 60,
  /** Drones de reconnaissance : recharge ×0,5, survol prolongé (s). */
  droneCdMul: 0.5,
  droneExtra: 30,
  /** Communications : rayon des rapports autour des lieutenants (m). */
  ltReport: 30,
  /** Gardes d'élite. */
  eliteCount: 4,
  eliteHp: 240,
  eliteRespawn: 60,
  /** Centre d'opérations : vitesse des prises menées par les lieutenants ; porte blindée du QG. */
  opsMul: 1.35,
  doorMul: 0.67,
  /** Recrutement automatique : réserve visée, cadence (s), prix d'une recrue, argent préservé. */
  autoPool: 4,
  autoEvery: 15,
  autoPrice: 80,
  autoReserve: 500,
  /** Prestige des trophées ($/min par quartier tenu). */
  prestige: 15,
  /** Armurerie avancée. */
  weaponMul: 0.75,
  ammoMul: 0.5,
  grenadeBonus: 2,
  /** Transport : délais de livraison des véhicules ×0,5. */
  callMul: 0.5,
} as const;

/**
 * Crochets pour la conquête : tant que le code de conquête ne déclare pas appliquer lui-même
 * opsSpeedMul / hqDefenseMul (captureHandled = true), ce module ajuste la progression des prises.
 */
export const HQ_HOOKS = { captureHandled: false };

const has = (g: Game, slot: Slot, id: string): boolean => g.factions[slot].upgrades.has(id);

/** Vitesse des opérations de conquête menées par les lieutenants de ce parrain. */
export function opsSpeedMul(g: Game, slot: Slot): number {
  return has(g, slot, 'opscenter') ? HQ.opsMul : 1;
}

/** Vitesse de prise d'un bâtiment par l'ennemi : porte blindée du QG (sécurité renforcée). */
export function hqDefenseMul(g: Game, bid: number): number {
  const s = g.hqOwnerOf(bid);
  return s && has(g, s, 'security') ? HQ.doorMul : 1;
}

/** Délai de transmission des ordres (communications avancées). */
export function orderDelayMul(g: Game, slot: Slot): number {
  return has(g, slot, 'comms') ? 0.5 : 1;
}

/** Opérations simultanées supplémentaires (communications avancées). */
export function extraOps(g: Game, slot: Slot): number {
  return has(g, slot, 'comms') ? 1 : 0;
}

/** Grenades en poche au maximum (armurerie avancée). */
export function grenadeMax(g: Game, slot: Slot): number {
  return GRENADE_MAX + (has(g, slot, 'armory2') ? HQ.grenadeBonus : 0);
}

/** Emplacement d'un équipement dans le QG (null si le logement n'en a pas). */
export function anchorOf(hq: BuildingInfo, id: string): HqAnchor | null {
  return hq.hqAnchors?.[id] ?? null;
}

/** Centre de l'assise de la station cybernétique (le modèle est adossé à l'emplacement). */
export function stationSeat(a: HqAnchor): { x: number; y: number; z: number } {
  return clinicSeat({ name: '', x: a.x, y: a.y, z: a.z, yaw: a.yaw });
}

/** Cliniques de la ville (bâtiment et fauteuil). */
export function clinicsOf(g: Game): { bid: number; c: ClinicInfo }[] {
  let list = clinicCache.get(g.w.buildings);
  if (!list) {
    list = g.w.buildings.filter((b) => !!b.clinic).map((b) => ({ bid: b.id, c: b.clinic! }));
    clinicCache.set(g.w.buildings, list);
  }
  return list;
}
const clinicCache = new WeakMap<object, { bid: number; c: ClinicInfo }[]>();

/** Clinique fermée à ce parrain (le rival tient le bâtiment). */
export function clinicClosed(g: Game, slot: Slot, bid: number): boolean {
  return g.bstate.get(bid)?.owner === slotFaction(otherSlot(slot));
}

// Points d'installation des implants : cliniques ouvertes et station du QG (si achetée).
setStationPoints((g, slot) => {
  const out: { key: string; x: number; y: number; z: number }[] = [];
  for (const { bid, c } of clinicsOf(g)) {
    if (clinicClosed(g, slot, bid)) continue;
    const s = clinicSeat(c);
    out.push({ key: `clinique:${bid}`, x: s.x, y: s.y, z: s.z });
  }
  if (has(g, slot, 'cyberstation')) {
    const a = anchorOf(g.hq(slot), 'cyberstation');
    const hq = g.hq(slot);
    const s = a ? stationSeat(a) : { x: (hq.desk ?? hq.center).x, y: (hq.desk ?? hq.center).y ?? hq.floorY, z: (hq.desk ?? hq.center).z };
    out.push({ key: 'qg', x: s.x, y: s.y, z: s.z });
  }
  return out;
});

// ======================================================================= état du module

interface SlotState {
  /** Équipements déjà pris en compte (effets immédiats à l'achat). */
  known: Set<string>;
  elites: number[];
  eliteAt: number;
  stdAt: number;
  /** Les gardes d'élite rejoignent leurs postes (après un déménagement). */
  repost: boolean;
  patrol: number;
  patrolAt: number;
  extended: WeakSet<object>;
  droneSeen: number;
  callSeen: number;
  recruitAt: number;
  recruits: number;
  ammoAt: number;
  /** Trophées gagnés depuis le début de la partie (bâtiments clés, quartiers). */
  keys: number[];
  districts: DistrictId[];
  /** Calculés chaque seconde. */
  watch: { site: string; x: number; z: number; n: number }[];
  reveals: { x: number; z: number; n: number }[];
  garrisons: [number, number][];
  rivalOps: { name: string; x: number; z: number; order: string; target: string; b?: number; p?: number }[];
  ops: { lt: number; name: string; b: number; p: number; eta: number }[];
  /** Vitesse de prise mesurée (progression par seconde) par bâtiment visé. */
  rate: Map<number, { p: number; t: number; v: number }>;
}

function makeSlot(): SlotState {
  return {
    known: new Set(),
    elites: [],
    eliteAt: 0,
    stdAt: 0,
    repost: false,
    patrol: -1,
    patrolAt: 0,
    extended: new WeakSet(),
    droneSeen: 0,
    callSeen: 0,
    recruitAt: 0,
    recruits: 0,
    ammoAt: 0,
    keys: [],
    districts: [],
    watch: [],
    reveals: [],
    garrisons: [],
    rivalOps: [],
    ops: [],
    rate: new Map(),
  };
}

export function createHq(g: Game): GameModule {
  const S: Record<Slot, SlotState> = { dadou: makeSlot(), even: makeSlot() };
  /** Progression des prises au pas précédent (ajustement opérations / porte blindée). */
  const prevCap = new Map<number, { by: number; p: number }>();
  const mod: GameModule & { state: typeof S } = {
    state: S,
    step(dt) {
      for (const slot of SLOTS) {
        const s = S[slot];
        const f = g.factions[slot];
        for (const id of f.upgrades) if (!s.known.has(id)) {
          s.known.add(id);
          acquire(g, s, slot, id);
        }
        trackTrophies(g, s, slot);
        if (has(g, slot, 'trophies')) {
          // prestige : un petit revenu par quartier tenu
          const bonus = g.territories(slot) * HQ.prestige;
          f.money += (bonus / 60) * dt;
          f.earned += (bonus / 60) * dt;
          f.income += bonus;
        }
        if (has(g, slot, 'elite')) elites(g, s, slot);
        if (has(g, slot, 'dronecmd')) drones(g, s, slot);
        if (has(g, slot, 'transport') && f.callAt > s.callSeen + 1e-6) {
          // livraison des véhicules : délais (appel, épave) divisés par deux
          f.callAt = g.time + Math.max(0, f.callAt - g.time) * HQ.callMul;
          s.callSeen = f.callAt;
        }
        if (g.tick % 20 === (slot === 'dadou' ? 3 : 13)) {
          if (has(g, slot, 'autorecruit')) autoRecruit(g, s, slot);
          if (has(g, slot, 'armory2')) armoryRefill(g, s, slot);
          scan(g, s, slot);
        }
      }
      if (!HQ_HOOKS.captureHandled) adjustCaptures(g, prevCap);
    },
    action(slot, act) {
      return action(g, S[slot], slot, act);
    },
    pub(out: PublicState) {
      const upg = {} as Record<Slot, string[]>;
      const tro = {} as Record<Slot, number>;
      for (const slot of SLOTS) {
        upg[slot] = HQ_UPGRADES.filter((id) => has(g, slot, id));
        tro[slot] = has(g, slot, 'trophies') ? S[slot].keys.length + S[slot].districts.length : 0;
      }
      out.hqUpg = upg;
      out.hqTrophies = tro;
    },
    priv(slot: Slot, out: PrivateState) {
      const s = S[slot];
      const hq: HqPrivate = {};
      if (has(g, slot, 'holomap')) {
        hq.garrisons = s.garrisons;
        hq.rivalOps = s.rivalOps;
      }
      if (s.watch.length) hq.watch = s.watch;
      if (has(g, slot, 'opscenter')) hq.ops = s.ops;
      if (has(g, slot, 'autorecruit')) hq.recruits = s.recruits;
      if (has(g, slot, 'trophies')) {
        hq.trophies = [...s.keys.map((b) => ({ kind: 'key' as const, name: BUILDINGS[b].name })), ...s.districts.map((d) => ({ kind: 'district' as const, name: DISTRICT_BY_ID[d].name }))];
        hq.prestige = g.territories(slot) * HQ.prestige;
      }
      if (has(g, slot, 'armory2')) hq.armory = { weaponMul: HQ.weaponMul, ammo: Math.round(AMMO_PRICE * HQ.ammoMul), grenadeMax: grenadeMax(g, slot) };
      if (has(g, slot, 'dronecmd')) hq.patrol = !!g.ents.get(s.patrol)?.alive;
      out.hqUp = hq;
      // ennemis révélés par les équipements : positions exactes, ajoutées aux repérages
      if (s.reveals.length) {
        const spotted = [...out.spotted];
        for (const r of s.reveals) if (!spotted.some((q) => Math.hypot(q.x - r.x, q.z - r.z) < 4)) spotted.push(r);
        out.spotted = spotted;
      }
    },
    onOwner(bid, owner) {
      // trophée : premier bâtiment clé pris par un parrain
      const sl = factionSlot(owner);
      if (sl && BUILDINGS[bid].isKey && !S[sl].keys.includes(bid)) {
        S[sl].keys.push(bid);
        if (has(g, sl, 'trophies')) g.notify(sl, `Nouveau trophée : ${BUILDINGS[bid].name} rejoint votre salle des trophées.`, 'good');
      }
    },
    onMoveHq(slot, bid) {
      const s = S[slot];
      const f = g.factions[slot];
      // la sécurité, les gardes d'élite et le drone de patrouille suivent le parrain
      if (f.upgrades.has('security')) installHqTurrets(g, bid);
      s.repost = true;
      const pd = g.ents.get(s.patrol);
      if (pd && pd.alive && pd.veh?.auto) {
        const hq = g.building(bid);
        pd.veh.auto.pts = [{ x: hq.center.x, z: hq.center.z }];
        pd.veh.auto.home = { x: hq.center.x, z: hq.center.z };
        pd.veh.auto.alt = patrolAlt(hq);
      }
    },
  };
  return mod;
}

// ======================================================================= achat

function acquire(g: Game, s: SlotState, slot: Slot, id: string): void {
  const f = g.factions[slot];
  switch (id) {
    case 'security':
      installHqTurrets(g, f.hqId);
      break;
    case 'elite':
      s.eliteAt = 0;
      s.stdAt = 0;
      break;
    case 'dronecmd':
      s.patrolAt = 0;
      // un drone déjà en recharge en profite tout de suite
      if (f.droneAt > g.time) f.droneAt = g.time + (f.droneAt - g.time) * HQ.droneCdMul;
      s.droneSeen = f.droneAt;
      break;
    case 'transport':
      s.callSeen = f.callAt;
      break;
    case 'autorecruit':
      s.recruitAt = g.time + 2;
      break;
  }
  void slot;
}

// ======================================================================= actions

function action(g: Game, s: SlotState, slot: Slot, act: ClientAction): boolean {
  const f = g.factions[slot];
  switch (act.a) {
    case 'goHome': {
      if (!f.upgrades.has('transport')) return false;
      // aéronef personnel : gratuit, même avec la police aux trousses (pas en plein combat)
      const boss = g.ents.get(f.bossId)!;
      if (!boss.alive) return true;
      if (f.vehicle >= 0) {
        g.notify(slot, 'Descendez d’abord de votre véhicule.', 'info');
        return true;
      }
      if (g.time - boss.lastDamageAt < 8) {
        g.notify(slot, 'Impossible en plein combat.', 'bad');
        return true;
      }
      const hq = g.hq(slot);
      const sp = hq.deskSeat ?? hq.spawn[0] ?? hq.center;
      const y = g.w.nav.heightAt(sp.x, sp.z, sp.y ?? hq.floorY);
      g.teleport(slot, sp.x, Number.isFinite(y) ? y : (sp.y ?? hq.floorY), sp.z, deskFacing(hq));
      g.notify(slot, `Votre aéronef personnel vous dépose ${aNom(hq.def.name)}.`, 'good');
      return true;
    }
    case 'buyWeapon': {
      if (!f.upgrades.has('armory2')) return false;
      const item = BOSS_SHOP.find((x) => x.weapon === act.w);
      if (!item || f.weapons.has(item.weapon)) return true;
      const price = Math.round(item.price * HQ.weaponMul);
      if (f.money < price) {
        g.notify(slot, `Pas assez d’argent : il faut ${formatMoney(price)}.`, 'bad');
        return true;
      }
      f.money -= price;
      f.weapons.add(item.weapon);
      const def = WEAPONS[item.weapon];
      if (def.ranged) f.ammo.set(item.weapon, def.magazine * 5);
      g.notify(slot, `Nouvelle arme : ${def.name} (armurerie avancée, −${formatMoney(item.price - price)}).`, 'good');
      return true;
    }
    case 'buyAmmo': {
      if (!f.upgrades.has('armory2')) return false;
      const price = Math.round(AMMO_PRICE * HQ.ammoMul);
      if (f.money < price) {
        g.notify(slot, `Pas assez d’argent : il faut ${formatMoney(price)}.`, 'bad');
        return true;
      }
      f.money -= price;
      for (const w of f.weapons) {
        const def = WEAPONS[w];
        if (def.ranged && w !== Weapon.ARM_PISTOL) f.ammo.set(w, Math.min(def.magazine * 8, (f.ammo.get(w) ?? 0) + def.magazine * 4));
      }
      g.notify(slot, `Munitions rechargées (−${formatMoney(price)}).`, 'money');
      return true;
    }
    case 'buyGrenade': {
      if (!f.upgrades.has('armory2')) return false;
      const max = grenadeMax(g, slot);
      if (f.grenades >= max) {
        g.notify(slot, `Vous avez déjà ${max} grenades.`, 'info', 'gren-max', 3);
        return true;
      }
      if (f.money < GRENADE_PRICE) {
        g.notify(slot, `Pas assez d’argent : il faut ${formatMoney(GRENADE_PRICE)}.`, 'bad');
        return true;
      }
      f.money -= GRENADE_PRICE;
      f.grenades++;
      g.notify(slot, `Grenade achetée (${f.grenades}/${max}).`, 'money');
      return true;
    }
    case 'cyber': {
      // clinique tenue par le rival : fermée (seule raison d'un refus ici)
      if (act.op === 'save') return false;
      const boss = g.ents.get(f.bossId);
      if (!boss || !boss.alive) return false;
      let open = false;
      let closed: { bid: number; c: ClinicInfo } | null = null;
      for (const cl of clinicsOf(g)) {
        const st = clinicSeat(cl.c);
        if (Math.hypot(boss.x - st.x, boss.z - st.z) >= STATION_RANGE || Math.abs(boss.y - st.y) >= 2) continue;
        if (clinicClosed(g, slot, cl.bid)) closed = cl;
        else open = true;
      }
      if (!closed || open) return false;
      const rival = otherSlot(slot);
      g.notify(slot, `Clinique fermée : ${BOSS_NAME[rival]} contrôle ${leNom(BUILDINGS[closed.bid].name)}. Reprenez le bâtiment ou trouvez une autre clinique.`, 'bad', 'clinic-closed', 3);
      return true;
    }
  }
  void s;
  return false;
}

// ======================================================================= gardes d'élite

function elites(g: Game, s: SlotState, slot: Slot): void {
  const f = g.factions[slot];
  const hq = g.hq(slot);
  s.elites = s.elites.filter((id) => g.ents.get(id)?.alive);
  const post = (i: number) => {
    const a = anchorOf(hq, `elite${i + 1}`);
    if (a) return { x: a.x, z: a.z, y: a.y };
    const p = g.guardPost(slot, i);
    return { x: p.x, z: p.z, y: p.y ?? hq.floorY };
  };
  if (s.repost) {
    // déménagement : les gardes d'élite prennent le taxi volant avec le rabatteur
    s.repost = false;
    s.elites.forEach((id, i) => {
      const e = g.ents.get(id)!;
      const p = post(i);
      e.x = p.x;
      e.z = p.z;
      e.y = p.y;
      e.ai!.post = p;
      e.ai!.home = hq.id;
      e.ai!.path = null;
      e.ai!.target = -1;
    });
  }
  if (g.time >= s.eliteAt && s.elites.length < HQ.eliteCount) {
    s.eliteAt = g.time + HQ.eliteRespawn;
    const taken = new Set(s.elites.map((id) => g.ents.get(id)!.ai!.rank));
    for (let i = 0; i < HQ.eliteCount && s.elites.length < HQ.eliteCount; i++) {
      if (taken.has(i)) continue;
      const p = post(i);
      const e = g.addEnt({ kind: CharKind.GANGSTER, role: 'guard', faction: f.faction, slot, x: p.x, z: p.z, y: p.y, hp: HQ.eliteHp, weapon: i < 2 ? Weapon.RIFLE : Weapon.SMG, mode: 'guard', name: 'Garde d’élite', gang: 1 });
      e.ai!.post = p;
      e.ai!.leash = 14;
      e.ai!.home = hq.id;
      e.ai!.accuracy = 0.74;
      e.ai!.rank = i;
      s.elites.push(e.id);
    }
  }
  // les gardes ordinaires du logement restent au complet (le jeu compte aussi les gardes d'élite)
  const want = g.tierOf(slot).guards;
  if (want > 0 && g.time >= s.stdAt) {
    s.stdAt = g.time + 45;
    const elite = new Set(s.elites);
    let std = 0;
    for (const e of g.ents.values()) if (e.alive && e.slot === slot && e.role === 'guard' && !elite.has(e.id)) std++;
    for (let i = std; i < want; i++) {
      const p = g.guardPost(slot, i);
      const w = f.tier >= 5 ? (i % 3 === 0 ? Weapon.RIFLE : Weapon.SMG) : f.tier >= 4 ? Weapon.SMG : Weapon.SHOTGUN;
      const e = g.addEnt({ kind: CharKind.GANGSTER, role: 'guard', faction: f.faction, slot, x: p.x, z: p.z, y: p.y ?? 0, hp: 120, weapon: w, mode: 'guard' });
      e.ai!.post = { x: p.x, z: p.z, y: p.y ?? 0 };
      e.ai!.leash = 22;
      e.ai!.home = hq.id;
      e.ai!.accuracy = 0.66;
    }
  }
}

/** Gardes d'élite vivants d'un parrain (tests, client). */
export function eliteGuards(g: Game, slot: Slot): Ent[] {
  const out: Ent[] = [];
  for (const e of g.ents.values()) if (e.alive && e.slot === slot && e.role === 'guard' && e.gang === 1 && e.name === 'Garde d’élite') out.push(e);
  return out;
}

// ======================================================================= drones

function patrolAlt(hq: BuildingInfo): number {
  return Math.max(20, Math.min(62, (hq.roofY ?? hq.height) + 7));
}

function drones(g: Game, s: SlotState, slot: Slot): void {
  const f = g.factions[slot];
  // reconnaissance : recharge réduite dès le lancement
  if (f.droneAt > s.droneSeen + 1e-6) {
    f.droneAt = g.time + Math.max(0, f.droneAt - g.time) * HQ.droneCdMul;
    s.droneSeen = f.droneAt;
  }
  // survol prolongé
  const rv = f.droneReveal;
  if (rv && g.time < rv.until && !s.extended.has(rv)) {
    s.extended.add(rv);
    rv.until += HQ.droneExtra;
    for (const e of g.ents.values()) {
      const a = e.veh?.auto;
      if (e.alive && e.role === 'vehicle' && e.veh?.owner === slot && e.veh.def === 7 && a && a.phase === 'hover' && a.district === rv.district) a.until = rv.until;
    }
  }
  // le drone de patrouille abattu efface la reconnaissance en cours (règle des drones) : on la rend
  // tant que le drone de reconnaissance survole encore son quartier
  const pd = s.patrol >= 0 ? g.ents.get(s.patrol) : undefined;
  if (s.patrol >= 0 && (!pd || !pd.alive)) {
    s.patrol = -1;
    s.patrolAt = g.time + HQ.patrolRespawn;
    g.notify(slot, `Votre drone de patrouille a été abattu : un autre décolle du QG dans ${HQ.patrolRespawn} s.`, 'bad', 'patrol-down', 5);
  }
  if (!f.droneReveal) {
    const recon = hoveringRecon(g, slot);
    if (recon) {
      // (le survol de ce drone est déjà prolongé)
      s.extended.add(recon);
      f.droneReveal = recon;
    }
  }
  if (s.patrol < 0 && g.time >= s.patrolAt) {
    const hq = g.hq(slot);
    const alt = patrolAlt(hq);
    const e = spawnVehicle(g, VEHICLES[7], hq.center.x, alt, hq.center.z, 0, slot);
    f.vehicles.delete(7);
    e.name = 'Drone de patrouille';
    e.veh!.auto = { phase: 'hover', pts: [{ x: hq.center.x, z: hq.center.z }], i: 0, alt, until: Infinity, home: { x: hq.center.x, z: hq.center.z } };
    g.emitAll({ t: 'spawn', e: g.info(e) });
    s.patrol = e.id;
  }
}

/** Reconnaissance d'un drone qui survole encore son quartier (null s'il n'y en a pas). */
function hoveringRecon(g: Game, slot: Slot): { district: string; until: number } | null {
  for (const e of g.ents.values()) {
    const a = e.veh?.auto;
    if (e.alive && e.role === 'vehicle' && e.veh?.owner === slot && e.veh.def === 7 && a && a.phase === 'hover' && a.district && g.time < a.until) return { district: a.district, until: a.until };
  }
  return null;
}

// ======================================================================= recrutement, armurerie

function autoRecruit(g: Game, s: SlotState, slot: Slot): void {
  const f = g.factions[slot];
  if (g.time < s.recruitAt) return;
  if (g.countPool(slot) >= HQ.autoPool || g.countMen(slot) >= g.tierOf(slot).maxMen) return;
  if (f.money < HQ.autoPrice + HQ.autoReserve) return;
  const e = g.spawnGangster(slot);
  if (!e) return;
  f.money -= HQ.autoPrice;
  f.recruited++;
  s.recruits++;
  s.recruitAt = g.time + HQ.autoEvery;
  g.notify(slot, `Terminal de recrutement : une recrue rejoint la réserve du QG (−${formatMoney(HQ.autoPrice)}).`, 'money', 'auto-recruit', 45);
}

function armoryRefill(g: Game, s: SlotState, slot: Slot): void {
  const f = g.factions[slot];
  if (g.time < s.ammoAt) return;
  const boss = g.ents.get(f.bossId)!;
  if (!boss.alive || f.vehicle >= 0 || !g.inBuildingArea(g.hq(slot), boss.x, boss.y, boss.z)) return;
  let refilled = false;
  for (const w of f.weapons) {
    const def = WEAPONS[w];
    if (!def.ranged || w === Weapon.ARM_PISTOL) continue;
    if ((f.ammo.get(w) ?? 0) < def.magazine * 8) {
      f.ammo.set(w, def.magazine * 8);
      refilled = true;
    }
  }
  if (refilled) {
    s.ammoAt = g.time + 5;
    g.notify(slot, 'Armurerie avancée : munitions rechargées gratuitement.', 'good', 'armory2-refill', 30);
  }
}

// ======================================================================= trophées

function trackTrophies(g: Game, s: SlotState, slot: Slot): void {
  if (g.tick % 10 !== 0) return;
  const mine = slotFaction(slot);
  for (const d of DISTRICTS) {
    if (g.districtOwner.get(d.id) !== mine || s.districts.includes(d.id)) continue;
    s.districts.push(d.id);
    if (has(g, slot, 'trophies')) g.notify(slot, `Nouveau trophée : la conquête ${deNom(d.name)} s’expose au QG (prestige +${HQ.prestige} $/min tant que vous le tenez).`, 'good');
  }
}

// ======================================================================= renseignement (chaque seconde)

const UNIT_ROLES = new Set(['gangster', 'lieutenant', 'guard', 'boss']);

function scan(g: Game, s: SlotState, slot: Slot): void {
  const f = g.factions[slot];
  const mine = slotFaction(slot);
  const rival = otherSlot(slot);
  const enemies: Ent[] = [];
  for (const e of g.ents.values()) if (e.alive && e.slot === rival && UNIT_ROLES.has(e.role) && !(e.flags & FLAG.HIDDEN)) enemies.push(e);
  const watch: SlotState['watch'] = [];
  const seen = new Set<number>();
  const hq = g.hq(slot);
  const see = (site: string, list: Ent[]) => {
    for (const e of list) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      watch.push({ site, x: Math.round(e.x * 10) / 10, z: Math.round(e.z * 10) / 10, n: 1 });
    }
  };
  const around = (x: number, z: number, r: number) => enemies.filter((e) => Math.hypot(e.x - x, e.z - z) < r);
  // surveillance tactique : QG et bâtiments clés
  if (f.upgrades.has('surveil')) {
    const near = around(hq.center.x, hq.center.z, HQ.surveilHq);
    if (near.length) alert(g, slot, 'surv-hq', `Surveillance : ${count(near, rival)} près de votre QG !`);
    see('QG', near);
    for (const b of BUILDINGS) {
      if (!b.isKey || g.bstate.get(b.id)!.owner !== mine) continue;
      const info = g.building(b.id);
      const list = around((info.footprint[0] + info.footprint[2]) / 2, (info.footprint[1] + info.footprint[3]) / 2, HQ.surveilKey);
      if (list.length) alert(g, slot, `surv-${b.id}`, `Surveillance : ${count(list, rival)} près ${deNom(b.name)}.`);
      see(b.name, list);
    }
  }
  // drone de patrouille : intrus autour du QG
  const pd = s.patrol >= 0 ? g.ents.get(s.patrol) : undefined;
  if (f.upgrades.has('dronecmd') && pd && pd.alive) {
    const list = around(hq.center.x, hq.center.z, HQ.patrolRange);
    if (list.length) alert(g, slot, 'patrol', `Drone de patrouille : ${count(list, rival)} autour du QG.`);
    see('Drone de patrouille', list);
  }
  // communications avancées : les lieutenants signalent leurs assaillants
  if (f.upgrades.has('comms')) {
    for (const b of BUILDINGS) {
      const st = g.bstate.get(b.id)!;
      if (st.owner !== mine) continue;
      const info = g.building(b.id);
      const list = enemies.filter((e) => g.inBuildingArea(info, e.x, e.y, e.z) || (st.capBy && st.capBy !== mine && Math.hypot(e.x - info.center.x, e.z - info.center.z) < 14));
      if (!list.length) continue;
      alert(g, slot, `comms-${b.id}`, `Rapport ${reporter(g, slot, info)} : ${count(list, rival)} attaquent ${leNom(b.name)} (${DISTRICT_BY_ID[b.district].name}).`);
      see(b.name, list);
    }
    for (const id of f.lieutenants) {
      const lt = g.ents.get(id);
      if (!lt || !lt.alive) continue;
      const list = around(lt.x, lt.z, HQ.ltReport).filter((e) => Math.abs(e.y - lt.y) < 6);
      see(lt.name ?? 'Lieutenant', list);
    }
  }
  s.watch = watch;
  // repérages exacts : petits groupes de 3 m
  const reveals: SlotState['reveals'] = [];
  for (const w of watch) {
    const r = reveals.find((q) => Math.hypot(q.x - w.x, q.z - w.z) < 3);
    if (r) {
      r.x = (r.x * r.n + w.x) / (r.n + 1);
      r.z = (r.z * r.n + w.z) / (r.n + 1);
      r.n++;
    } else reveals.push({ x: w.x, z: w.z, n: 1 });
  }
  s.reveals = reveals;
  // carte holographique : garnisons exactes, lieutenants du rival près de votre territoire
  if (f.upgrades.has('holomap')) {
    const garrisons: [number, number][] = [];
    for (const b of BUILDINGS) {
      const st = g.bstate.get(b.id)!;
      if (!b.capturable || st.owner === mine) continue;
      let n = 0;
      if (st.owner === slotFaction(rival)) {
        const info = g.building(b.id);
        for (const e of enemies) if (e.role !== 'boss' && g.insideBuilding(info, e.x, e.y, e.z)) n++;
        for (const e of g.ents.values()) if (e.alive && e.role === 'turret' && e.ai?.home === b.id && e.slot === rival) n++;
      } else for (const id of st.thugs) if (g.ents.get(id)?.alive) n++;
      if (n > 0) garrisons.push([b.id, n]);
    }
    s.garrisons = garrisons;
    const ops: SlotState['rivalOps'] = [];
    const myBuildings = BUILDINGS.filter((b) => g.bstate.get(b.id)!.owner === mine).map((b) => g.building(b.id).center);
    for (const sq of g.squads.values()) {
      if (sq.slot !== rival || !sq.order) continue;
      const lt = g.ents.get(sq.id);
      if (!lt || !lt.alive) continue;
      const targetMine = sq.goalBuilding >= 0 && g.bstate.get(sq.goalBuilding)?.owner === mine;
      const near = myBuildings.some((c) => Math.hypot(c.x - lt.x, c.z - lt.z) < 80);
      if (!targetMine && !near) continue;
      ops.push({ name: sq.name, x: Math.round(lt.x), z: Math.round(lt.z), order: ORDER_LABEL[sq.order.type], target: sq.order.targetName });
    }
    // prises en cours du rival (opérations de conquête) sur vos bâtiments ou près de votre territoire
    for (const op of opsList(g)) {
      if (op.slot !== rival) continue;
      const c = g.building(op.b).center;
      if (g.bstate.get(op.b)?.owner !== mine && !myBuildings.some((m) => Math.hypot(m.x - c.x, m.z - c.z) < 80)) continue;
      ops.push({ name: op.lt || BOSS_NAME[rival], x: Math.round(c.x), z: Math.round(c.z), order: 'Prise en cours', target: BUILDINGS[op.b].name, b: op.b, p: Math.round(opProgress(op) * 100) / 100 });
    }
    s.rivalOps = ops;
  }
  // centre d'opérations : prises en cours (opérations de conquête), sinon ordres des lieutenants
  if (f.upgrades.has('opscenter')) {
    const ops: SlotState['ops'] = [];
    for (const op of opsList(g)) {
      if (op.slot !== slot) continue;
      const lt = f.lieutenants.find((id) => g.ents.get(id)?.name === op.lt) ?? -1;
      ops.push({ lt, name: op.lt || BOSS_NAME[slot], b: op.b, p: Math.round(opProgress(op) * 100) / 100, eta: opEta(op) });
    }
    for (const id of f.lieutenants) {
      const sq = g.squads.get(id);
      if (!sq || !sq.order) continue;
      const b = sq.goalBuilding >= 0 ? sq.goalBuilding : sq.queue[0] ?? -1;
      if (b < 0) continue;
      if (ops.some((o) => o.b === b)) continue;
      const st = g.bstate.get(b)!;
      const p = st.capBy === mine ? st.progress : 0;
      const r = s.rate.get(b);
      let v = 0;
      if (r && g.time > r.t) v = r.v * 0.6 + (Math.max(0, p - r.p) / (g.time - r.t)) * 0.4;
      s.rate.set(b, { p, t: g.time, v });
      ops.push({ lt: id, name: sq.name, b, p: Math.round(p * 100) / 100, eta: v > 1e-4 ? Math.round((1 - p) / v) : -1 });
    }
    s.ops = ops;
  }
}

/** Progression globale d'une opération de conquête (0..1). */
function opProgress(op: { step: number; prog: number; plan: { steps: unknown[] } }): number {
  return Math.max(0, Math.min(1, (op.step + op.prog) / Math.max(1, op.plan.steps.length)));
}

/** Temps restant estimé d'une opération (s), −1 si elle n'avance pas. */
function opEta(op: { step: number; prog: number; rate: number; plan: { steps: { time: number }[] } }): number {
  const steps = op.plan.steps;
  const cur = steps[op.step];
  if (!cur || op.rate <= 1e-4) return -1;
  // vitesse relative de l'étape en cours, appliquée aux suivantes
  const mul = op.rate * cur.time;
  let rest = (1 - op.prog) / op.rate;
  for (let k = op.step + 1; k < steps.length; k++) rest += steps[k].time / Math.max(0.05, mul);
  return Math.round(rest);
}

/** « 3 hommes d'Even », « Even en personne et 2 de ses hommes ». */
function count(list: Ent[], rival: Slot): string {
  const boss = list.some((e) => e.role === 'boss');
  const men = list.length - (boss ? 1 : 0);
  if (boss && men === 0) return `${BOSS_NAME[rival]} en personne`;
  const m = `${men} homme${men > 1 ? 's' : ''} ${DE_BOSS[rival]}`;
  return boss ? `${BOSS_NAME[rival]} en personne et ${m}` : m;
}

/** Le lieutenant le plus proche fait le rapport, sinon les guetteurs. */
function reporter(g: Game, slot: Slot, info: BuildingInfo): string {
  let best: Ent | null = null;
  let bd = Infinity;
  for (const id of g.factions[slot].lieutenants) {
    const lt = g.ents.get(id);
    if (!lt || !lt.alive) continue;
    const d = Math.hypot(lt.x - info.center.x, lt.z - info.center.z);
    if (d < bd) {
      bd = d;
      best = lt;
    }
  }
  return best?.name ? `de ${best.name}` : 'de vos guetteurs';
}

function alert(g: Game, slot: Slot, key: string, text: string): void {
  g.notify(slot, text, 'alert', key, 40);
}

// ======================================================================= prises de bâtiments

/** Repli tant que la conquête n'applique pas elle-même les crochets : on ajuste la progression. */
function adjustCaptures(g: Game, prev: Map<number, { by: number; p: number }>): void {
  for (const [bid, st] of g.bstate) {
    const last = prev.get(bid);
    if (!st.capBy || st.progress <= 0) {
      if (last) prev.delete(bid);
      continue;
    }
    if (last && last.by === st.capBy && st.progress > last.p) {
      const by = factionSlot(st.capBy);
      let mul = hqDefenseMul(g, bid);
      if (by && has(g, by, 'opscenter') && ledByLieutenant(g, by, bid)) mul *= HQ.opsMul;
      if (mul !== 1) st.progress = last.p + (st.progress - last.p) * mul;
    }
    prev.set(bid, { by: st.capBy, p: st.progress });
  }
}

/** Une opération d'un lieutenant de ce parrain vise ce bâtiment. */
function ledByLieutenant(g: Game, slot: Slot, bid: number): boolean {
  for (const sq of g.squads.values()) if (sq.slot === slot && sq.order && (sq.goalBuilding === bid || sq.queue[0] === bid)) return true;
  return false;
}
