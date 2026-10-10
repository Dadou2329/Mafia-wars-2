// Lieutenants et escouades : exécution autonome des ordres dans la ville.

import { Anim } from '../../shared/characters';
import { BOSS_NAME, ORDER_LABEL, type OrderType } from '../../shared/constants';
import { BUILDINGS, DISTRICT_BY_ID, Faction, HQ_BUILDING, buildingsInDistrict, type DistrictId } from '../../shared/city/plan';

const HOME_DISTRICT = { dadou: HQ_BUILDING.dadou.district, even: HQ_BUILDING.even.district };
import type { LieutenantStatus, Slot } from '../../shared/protocol';
import { formatTime } from '../../shared/util';
import { type Game, otherSlot, slotFaction } from './Game';
import type { Ent, Squad, Vec2 } from './types';
import { aNom, cap, leNom, pluriel } from '../../shared/french';

export function createSquad(g: Game, lt: Ent, slot: Slot): Squad {
  const sq: Squad = {
    id: lt.id,
    slot,
    name: lt.name ?? 'Lieutenant',
    members: new Set(),
    order: null,
    state: 'idle',
    goal: null,
    goalBuilding: -1,
    queue: [],
    queueTotal: 0,
    done: 0,
    menStart: 0,
    progress: 0,
    status: 'En attente d’ordres',
    downUntil: 0,
    stateSince: g.time,
    patrolPts: [],
    patrolI: 0,
    lostNotified: 0,
    reinfNotified: false,
    lastCombat: -100,
  };
  g.squads.set(lt.id, sq);
  lt.ai!.squad = lt.id;
  return sq;
}

export function releaseMember(g: Game, e: Ent, dead: boolean): void {
  const ai = e.ai!;
  const sq = g.squads.get(ai.squad);
  if (sq) sq.members.delete(e.id);
  ai.squad = -1;
  if (!dead && e.slot) {
    ai.mode = 'pool';
    ai.follow = -1;
    ai.post = g.poolPost(e.slot, e.id);
    ai.run = false;
  }
}

function members(g: Game, sq: Squad): Ent[] {
  const out: Ent[] = [];
  for (const id of sq.members) {
    const e = g.ents.get(id);
    if (e && e.alive) out.push(e);
    else sq.members.delete(id);
  }
  return out;
}

function setState(g: Game, sq: Squad, s: Squad['state']): void {
  sq.state = s;
  sq.stateSince = g.time;
  const ms = members(g, sq);
  const lt = g.ents.get(sq.id)!;
  // par défaut : colonne derrière le lieutenant
  let rank = 0;
  for (const m of ms) {
    m.ai!.mode = 'squad';
    m.ai!.squad = sq.id;
    m.ai!.follow = lt.id;
    m.ai!.rank = rank++;
    m.ai!.post = null;
    m.ai!.run = false;
  }
  lt.ai!.follow = -1;
  lt.ai!.run = false;
  if (s === 'assault' || s === 'hold') assignPosts(g, sq, s === 'assault');
}

/** Répartit les hommes sur les points de défense du bâtiment (ou autour du point tenu). */
function assignPosts(g: Game, sq: Squad, assault: boolean): void {
  const ms = members(g, sq);
  let inside: Vec2[] = [];
  let outside: Vec2[] = [];
  if (sq.goalBuilding >= 0) {
    const b = g.building(sq.goalBuilding);
    inside = [...b.defend].sort(() => g.rng.next() - 0.5);
    outside = b.guardOut;
  } else if (sq.goal) {
    for (let i = 0; i < Math.max(4, ms.length); i++) {
      const a = (i / Math.max(4, ms.length)) * Math.PI * 2;
      const r = 2 + (i % 3) * 1.2;
      const p = { x: sq.goal.x + Math.cos(a) * r, z: sq.goal.z + Math.sin(a) * r };
      if (g.w.nav.walkable(p.x, p.z)) outside.push(p);
    }
    if (outside.length === 0) outside.push(sq.goal);
  }
  const maxInside = assault ? 14 : 10;
  let i = 0;
  for (const m of ms) {
    m.ai!.follow = -1;
    m.ai!.run = assault;
    if (i < maxInside && inside.length > 0) m.ai!.post = inside[i % inside.length];
    else if (outside.length > 0) m.ai!.post = outside[i % outside.length];
    else m.ai!.post = inside.length ? inside[i % inside.length] : sq.goal;
    i++;
  }
  const lt = g.ents.get(sq.id)!;
  if (sq.goalBuilding >= 0) {
    const b = g.building(sq.goalBuilding);
    // le lieutenant dirige l'assaut depuis l'entrée ; ses hommes entrent les premiers
    lt.ai!.post = assault ? b.doors[0].out : b.doors[0].in;
    lt.ai!.run = assault;
  } else if (sq.goal) lt.ai!.post = sq.goal;
}

function districtCenter(d: DistrictId): Vec2 {
  const def = DISTRICT_BY_ID[d];
  return { x: def.label[0], z: def.label[1] };
}

export function giveOrder(g: Game, sq: Squad, type: OrderType, target?: number | string, x?: number, z?: number): void {
  const lt = g.ents.get(sq.id)!;
  const mine = slotFaction(sq.slot);
  if (sq.state === 'down' || !lt.alive) {
    g.emitTo(sq.slot, { t: 'order', lt: sq.id, ok: false, text: `${sq.name} est blessé et ne peut pas exécuter d’ordre pour le moment.` });
    return;
  }
  let targetName = '';
  sq.queue = [];
  sq.goal = null;
  sq.goalBuilding = -1;
  sq.patrolPts = [];
  switch (type) {
    case 'attack_district': {
      const d = String(target) as DistrictId;
      const def = DISTRICT_BY_ID[d];
      if (!def) return;
      targetName = def.name;
      const list = buildingsInDistrict(d).filter((b) => b.capturable && g.bstate.get(b.id)!.owner !== mine);
      if (list.length === 0) {
        g.emitTo(sq.slot, { t: 'order', lt: sq.id, ok: false, text: `${cap(leNom(def.name))} ${pluriel(def.name) ? 'vous appartiennent' : 'vous appartient'} déjà entièrement : ${sq.name} va ${pluriel(def.name) ? 'les' : 'le'} défendre.` });
        return giveOrder(g, sq, 'defend_district', d);
      }
      list.sort((a, b) => {
        if (!!a.isKey !== !!b.isKey) return a.isKey ? -1 : 1;
        const ia = g.building(a.id).center;
        const ib = g.building(b.id).center;
        return Math.hypot(ia.x - lt.x, ia.z - lt.z) - Math.hypot(ib.x - lt.x, ib.z - lt.z);
      });
      sq.queue = list.map((b) => b.id);
      break;
    }
    case 'attack_building': {
      const b = BUILDINGS[Number(target)];
      if (!b || !b.capturable) return;
      targetName = b.name;
      if (g.bstate.get(b.id)!.owner === mine) {
        g.emitTo(sq.slot, { t: 'order', lt: sq.id, ok: false, text: `${b.name} vous appartient déjà : ${sq.name} va le défendre.` });
        return giveOrder(g, sq, 'defend_building', b.id);
      }
      sq.queue = [b.id];
      break;
    }
    case 'defend_building': {
      const b = BUILDINGS[Number(target)];
      if (!b) return;
      targetName = b.name;
      sq.goalBuilding = b.id;
      sq.goal = g.building(b.id).doors[0].out;
      break;
    }
    case 'defend_district': {
      const d = String(target) as DistrictId;
      const def = DISTRICT_BY_ID[d];
      if (!def) return;
      targetName = def.name;
      const owned = buildingsInDistrict(d).filter((b) => g.bstate.get(b.id)!.owner === mine);
      owned.sort((a, b) => (a.isKey === b.isKey ? b.income - a.income : a.isKey ? -1 : 1));
      if (owned.length > 0) {
        sq.goalBuilding = owned[0].id;
        sq.goal = g.building(owned[0].id).doors[0].out;
      } else sq.goal = nearestWalkable(g, districtCenter(d));
      break;
    }
    case 'patrol': {
      const d = String(target) as DistrictId;
      const def = DISTRICT_BY_ID[d];
      if (!def) return;
      targetName = def.name;
      const c = districtCenter(d);
      sq.patrolPts = buildingsInDistrict(d)
        .map((b) => g.building(b.id).doors[0].out)
        .sort((a, b) => Math.atan2(a.z - c.z, a.x - c.x) - Math.atan2(b.z - c.z, b.x - c.x));
      sq.patrolI = 0;
      break;
    }
    case 'follow':
      targetName = `le patron (${BOSS_NAME[sq.slot]})`;
      break;
    case 'reinforce': {
      const other = g.squads.get(Number(target));
      if (!other || other.slot !== sq.slot || other.id === sq.id) return;
      targetName = other.name;
      break;
    }
    case 'retreat':
      targetName = 'le QG';
      sq.goal = g.hq(sq.slot).doors[0].in;
      break;
    case 'hold':
      if (x === undefined || z === undefined) return;
      targetName = 'la position indiquée';
      sq.goal = nearestWalkable(g, { x, z });
      break;
  }
  sq.order = { type, target, x, z, targetName, startedAt: g.time };
  sq.queueTotal = sq.queue.length;
  sq.done = 0;
  sq.progress = 0;
  sq.lostNotified = 0;
  sq.reinfNotified = false;
  sq.menStart = members(g, sq).length;
  setState(g, sq, type === 'retreat' ? 'retreat' : 'assemble');
  const lines = ['Bien reçu, patron.', 'Comptez sur moi.', 'C’est comme si c’était fait.', 'On y va, les gars !', 'À vos ordres.'];
  g.emitTo(sq.slot, {
    t: 'order',
    lt: sq.id,
    ok: true,
    text: `${sq.name} : « ${lines[g.rng.int(0, lines.length - 1)]} » — ${ORDER_LABEL[type]} : ${targetName} (${sq.menStart} homme${sq.menStart > 1 ? 's' : ''})`,
  });
}

function nearestWalkable(g: Game, p: Vec2): Vec2 {
  const n = g.w.nav.nearestWalkable(p.x, p.z, 20);
  if (n < 0) return p;
  const [x, z] = g.w.nav.cellCenter(n);
  return { x, z };
}

function nextTarget(g: Game, sq: Squad): boolean {
  const mine = slotFaction(sq.slot);
  while (sq.queue.length > 0) {
    const b = sq.queue[0];
    if (g.bstate.get(b)!.owner === mine) {
      sq.queue.shift();
      sq.done++;
      continue;
    }
    sq.goalBuilding = b;
    sq.goal = g.building(b).doors[0].out;
    return true;
  }
  return false;
}

export function updateSquad(g: Game, sq: Squad, dt: number): void {
  const lt = g.ents.get(sq.id);
  if (!lt) return;
  const mine = slotFaction(sq.slot);
  if (!lt.alive) {
    if (sq.state === 'down' && g.time >= sq.downUntil) {
      // le lieutenant revient, soigné, au QG
      const hq = g.hq(sq.slot);
      const p = hq.spawn[1] ?? hq.center;
      lt.alive = true;
      lt.hp = lt.maxHp;
      lt.anim = Anim.IDLE;
      lt.x = p.x;
      lt.z = p.z;
      lt.y = hq.floorY;
      lt.removeAt = Infinity;
      lt.ai!.target = -1;
      lt.ai!.aggro.clear();
      g.emitAll({ t: 'spawn', e: g.info(lt) });
      sq.order = null;
      setState(g, sq, 'idle');
      lt.ai!.post = g.poolPost(sq.slot, 4 + sq.id % 5);
      g.notify(sq.slot, `${sq.name} est remis sur pied et attend vos ordres au QG.`, 'good');
    }
    return;
  }
  if (g.tick % 5 !== sq.id % 5) return; // logique à 4 Hz, étalée
  const ms = members(g, sq);
  const step = dt * 5;
  void step;
  let fighting = lt.ai!.target >= 0;
  for (const m of ms) if (m.ai!.target >= 0) fighting = true;
  if (fighting) sq.lastCombat = g.time;
  // pertes
  if (sq.order && sq.menStart >= 4) {
    const ratio = ms.length / sq.menStart;
    const where = g.buildingAt(lt.x, lt.z) >= 0 ? BUILDINGS[g.buildingAt(lt.x, lt.z)].name : DISTRICT_NAME(lt);
    if (ratio < 0.7 && sq.lostNotified === 0 && sq.order.type.startsWith('attack')) {
      sq.lostNotified = 1;
      g.notify(sq.slot, `${sq.name} rencontre une forte résistance ${aNom(where)}.`, 'alert');
    }
    if (ratio < 0.4 && !sq.reinfNotified) {
      sq.reinfNotified = true;
      g.notify(sq.slot, `${sq.name} demande des renforts ! (${ms.length}/${sq.menStart} hommes)`, 'alert');
    }
  }
  const ltd = (p: Vec2) => Math.hypot(p.x - lt.x, p.z - lt.z);
  switch (sq.state) {
    case 'idle': {
      sq.status = Math.hypot(lt.x - g.hq(sq.slot).center.x, lt.z - g.hq(sq.slot).center.z) < 20 ? 'En attente d’ordres au QG' : 'En attente d’ordres';
      sq.progress = 0;
      if (!lt.ai!.post) lt.ai!.post = g.poolPost(sq.slot, 4 + (sq.id % 5));
      break;
    }
    case 'assemble': {
      sq.status = 'Rassemble ses hommes';
      lt.ai!.post = null;
      const near = ms.filter((m) => Math.hypot(m.x - lt.x, m.z - lt.z) < 10).length;
      if (ms.length === 0 || near >= ms.length * 0.7 || g.time - sq.stateSince > 12) {
        const o = sq.order!;
        switch (o.type) {
          case 'attack_district':
          case 'attack_building':
            if (nextTarget(g, sq)) setState(g, sq, 'move');
            else finish(g, sq);
            break;
          case 'patrol':
            setState(g, sq, 'patrol');
            break;
          case 'follow':
            setState(g, sq, 'follow');
            break;
          case 'reinforce':
            setState(g, sq, 'reinforce');
            break;
          default:
            setState(g, sq, 'move');
        }
      }
      break;
    }
    case 'move': {
      if (!sq.goal) {
        setState(g, sq, 'idle');
        break;
      }
      const o = sq.order!;
      sq.status = `En route vers ${leNom(sq.goalBuilding >= 0 ? BUILDINGS[sq.goalBuilding].name : o.targetName)}`;
      // on attend les traînards
      const far = ms.filter((m) => Math.hypot(m.x - lt.x, m.z - lt.z) > 16).length;
      const waiting = far > ms.length * 0.4 && g.time - sq.lastCombat > 3;
      lt.ai!.post = waiting ? null : sq.goal;
      lt.ai!.run = false;
      if (o.type.startsWith('attack')) sq.progress = sq.queueTotal ? sq.done / sq.queueTotal : 0;
      else sq.progress = 0.5;
      if (ltd(sq.goal) < 3.2) {
        if (o.type === 'attack_district' || o.type === 'attack_building') {
          setState(g, sq, 'assault');
          const b = BUILDINGS[sq.goalBuilding];
          const owner = g.bstate.get(b.id)!.owner;
          const os = owner === Faction.DADOU ? 'dadou' : owner === Faction.EVEN ? 'even' : null;
          g.notify(sq.slot, `${sq.name} lance l’assaut sur ${b.name} !`, 'info');
          if (os && os !== sq.slot) g.notify(os, `ALERTE — ${BOSS_NAME[sq.slot]} attaque ${leNom(b.name)} (${DISTRICT_BY_ID[b.district].name}) !`, 'alert', `atk-${b.id}`, 30);
          else if (g.districtOwner.get(b.district) !== mine && HOME_DISTRICT[sq.slot] !== b.district)
            g.notify(otherSlot(sq.slot), `${BOSS_NAME[sq.slot]} attaque ${leNom(DISTRICT_BY_ID[b.district].name)} !`, 'alert', `atkd-${b.district}`, 90);
        } else {
          setState(g, sq, 'hold');
        }
      }
      break;
    }
    case 'assault': {
      const b = BUILDINGS[sq.goalBuilding];
      const st = g.bstate.get(b.id)!;
      sq.status = `Assaut : ${b.name}`;
      const cur = st.capBy === mine ? st.progress : 0;
      sq.progress = sq.order!.type === 'attack_building' ? cur : (sq.done + cur) / Math.max(1, sq.queueTotal);
      if (st.owner === mine) {
        sq.queue.shift();
        sq.done++;
        if (nextTarget(g, sq)) {
          setState(g, sq, 'move');
        } else {
          finish(g, sq);
        }
      } else if (g.tick % 40 === sq.id % 40) {
        // relance les hommes inactifs vers l'intérieur
        assignPosts(g, sq, true);
      }
      break;
    }
    case 'hold': {
      const o = sq.order;
      sq.status = o ? (o.type === 'hold' ? 'Tient la position' : `Défend ${leNom(sq.goalBuilding >= 0 ? BUILDINGS[sq.goalBuilding].name : o.targetName)}`) : 'En position';
      sq.progress = 1;
      break;
    }
    case 'patrol': {
      const o = sq.order!;
      sq.status = `Patrouille dans ${leNom(o.targetName)}`;
      sq.progress = 1;
      if (sq.patrolPts.length === 0) break;
      const p = sq.patrolPts[sq.patrolI % sq.patrolPts.length];
      lt.ai!.post = p;
      if (ltd(p) < 3) sq.patrolI++;
      break;
    }
    case 'follow': {
      const boss = g.ents.get(g.factions[sq.slot].bossId)!;
      sq.status = 'Escorte le patron';
      sq.progress = 1;
      lt.ai!.post = null;
      lt.ai!.follow = boss.alive ? boss.id : -1;
      lt.ai!.rank = 0;
      if (!boss.alive) lt.ai!.post = g.hq(sq.slot).doors[0].in;
      break;
    }
    case 'reinforce': {
      const other = g.squads.get(Number(sq.order!.target));
      const ol = other ? g.ents.get(other.id) : undefined;
      if (!other || !ol || !ol.alive) {
        g.notify(sq.slot, `${sq.name} : impossible de rejoindre ${leNom(sq.order!.targetName)}. Il tient sa position.`, 'info');
        sq.goal = { x: lt.x, z: lt.z };
        setState(g, sq, 'hold');
        break;
      }
      sq.status = `Rejoint ${other.name}`;
      sq.progress = clamp01(1 - Math.hypot(ol.x - lt.x, ol.z - lt.z) / 120);
      lt.ai!.follow = ol.id;
      lt.ai!.rank = 4;
      lt.ai!.post = null;
      lt.ai!.run = Math.hypot(ol.x - lt.x, ol.z - lt.z) > 20;
      break;
    }
    case 'retreat': {
      sq.status = 'Se replie vers le QG';
      const hq = g.hq(sq.slot);
      lt.ai!.post = hq.doors[0].in;
      lt.ai!.run = true;
      for (const m of ms) m.ai!.run = true;
      sq.progress = clamp01(1 - ltd(hq.center) / 150);
      if (ltd(hq.doors[0].in) < 3) {
        sq.order = null;
        setState(g, sq, 'idle');
        lt.ai!.post = g.poolPost(sq.slot, 4 + (sq.id % 5));
      }
      break;
    }
    case 'down':
      break;
  }
}

function finish(g: Game, sq: Squad): void {
  const o = sq.order!;
  const lastB = sq.goalBuilding;
  g.notify(sq.slot, `${sq.name} : « Mission accomplie, patron ! » (${o.targetName})`, 'good');
  if (lastB >= 0) {
    sq.goalBuilding = lastB;
    sq.goal = g.building(lastB).doors[0].out;
  } else sq.goal = { x: g.ents.get(sq.id)!.x, z: g.ents.get(sq.id)!.z };
  sq.progress = 1;
  setState(g, sq, 'hold');
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function DISTRICT_NAME(e: Ent): string {
  for (const d of Object.values(DISTRICT_BY_ID)) {
    if (e.x >= d.rect[0] && e.x < d.rect[2] && e.z >= d.rect[1] && e.z < d.rect[3]) return d.name;
  }
  return 'Londres';
}

export function squadStatus(g: Game, sq: Squad): LieutenantStatus {
  const lt = g.ents.get(sq.id);
  if (!lt) {
    return { id: sq.id, name: sq.name, alive: false, recoverIn: 0, men: 0, menStart: 0, order: null, targetName: '', state: 'Disparu', progress: 0, x: 0, z: 0 };
  }
  const alive = lt.alive;
  const ms = members(g, sq);
  return {
    id: sq.id,
    name: sq.name,
    alive,
    recoverIn: alive ? 0 : Math.max(0, sq.downUntil - g.time),
    men: ms.length,
    menStart: sq.order ? Math.max(sq.menStart, ms.length) : ms.length,
    order: sq.order ? sq.order.type : null,
    targetName: sq.order ? sq.order.targetName : '',
    state: alive ? sq.status : `Blessé — de retour dans ${formatTime(Math.max(0, sq.downUntil - g.time))}`,
    progress: sq.progress,
    x: lt.x,
    z: lt.z,
  };
}
