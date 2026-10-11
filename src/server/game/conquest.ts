// Prise de contrôle des bâtiments (serveur autoritaire) : opérations par objectifs.
// Les étapes de chaque bâtiment sont décrites dans shared/conquest.ts. Le parrain (action « op »)
// et ses lieutenants (squads.ts) mènent physiquement chaque étape à son ancre ; un ennemi présent
// la conteste ; tuer l'opérateur l'interrompt (l'étape se perd lentement) ; le propriétaire peut
// reprendre la dernière étape volée. La dernière étape réussie donne le bâtiment (Game.setOwner).
// Une seule opération par bâtiment, tenue par le serveur : jamais deux propriétaires à la fois.

import { FLAG } from '../../shared/characters';
import { BOSS_NAME, DE_BOSS, HQ_CAPTURE_MIN_DISTRICTS } from '../../shared/constants';
import { BUILDINGS, DISTRICTS, DISTRICT_BY_ID, Faction } from '../../shared/city/plan';
import type { OpAnchor } from '../../shared/city/gen/context';
import {
  NO_BOSS_PARAMS,
  OP_ABANDON,
  OP_BOTH_MUL,
  OP_CONTEST_RADIUS,
  OP_DECAY,
  OP_DROP_RETURN,
  OP_MINIGAME_MIN,
  OP_PICKUP_RADIUS,
  OP_RIVAL_TAKEOVER,
  OP_UNDO_FACTOR,
  OP_UNDO_MIN,
  bossWorkMul,
  bossWorkRange,
  dePlace,
  opOverall,
  opPlan,
  opRadius,
  type OpBossParams,
  type OpPlan,
  type OpStep,
} from '../../shared/conquest';
import type { ClientAction, OpPub, PublicState, Slot } from '../../shared/protocol';
import { aNom, cap, deNom, leNom } from '../../shared/french';
import type { Game } from './Game';
import { factionSlot, otherSlot, slotFaction } from './Game';
import type { GameModule } from './modules';
import type { Ent, Vec2 } from './types';
import { param } from './cyber';
import { isHacked, securityOf, squadHack } from './security';
import { HQ_HOOKS, hqDefenseMul, opsSpeedMul } from './hq';

/** Opération en cours sur un bâtiment. */
export interface Op {
  b: number;
  slot: Slot;
  faction: number;
  /** Plan du QG (le bâtiment était le QG d'un parrain au lancement). */
  hq: boolean;
  plan: OpPlan;
  step: number;
  prog: number;
  /** Vitesse au dernier calcul (/s). */
  rate: number;
  /** Opérateurs à l'œuvre (1 parrain, 2 lieutenant) et lieutenant principal. */
  by: number;
  lt: string;
  contested: boolean;
  /** Auteurs des étapes accomplies. */
  who: string[];
  /** Porteur de l'objet emporté (id d'entité) et objet tombé. */
  carrier: number;
  drop: { x: number; y: number; z: number; at: number } | null;
  /** Reprise de l'étape précédente par le propriétaire. */
  undo: number;
  undoBy: number;
  locked: boolean;
  gang: number;
  presentAt: number;
  rivalAt: number;
  startedAt: number;
}

/** Le parrain mène (ou reprend) une étape. */
interface Work {
  b: number;
  step: number;
  undo: boolean;
  since: number;
  /** Piratage interactif en cours (le serveur attend son issue). */
  mini: boolean;
}

interface State {
  ops: Map<number, Op>;
  work: Record<Slot, Work | null>;
  /** Après un piratage raté (alarme), pas de nouvel essai avant cet instant. */
  lockout: Record<Slot, number>;
}

const state = new WeakMap<Game, State>();

function S(g: Game): State {
  let s = state.get(g);
  if (!s) state.set(g, (s = { ops: new Map(), work: { dadou: null, even: null }, lockout: { dadou: 0, even: 0 } }));
  return s;
}

// ---------------------------------------------------------------------------- requêtes

export function opOf(g: Game, bid: number): Op | undefined {
  return S(g).ops.get(bid);
}

export function opsList(g: Game): Op[] {
  return [...S(g).ops.values()];
}

/** Plan de l'opération d'un bâtiment (celui du QG si c'est le QG actuel d'un parrain). */
export function planOf(g: Game, bid: number): OpPlan | null {
  const info = g.w.byId.get(bid);
  return info ? opPlan(info, !!g.hqOwnerOf(bid)) : null;
}

/** Le QG d'un parrain reste imprenable tant que l'attaquant n'a pas assez de quartiers. */
export function hqLocked(g: Game, bid: number, slot: Slot): boolean {
  const of = g.hqOwnerOf(bid);
  return !!of && of !== slot && g.territories(slot) < HQ_CAPTURE_MIN_DISTRICTS;
}

function bossParams(g: Game, slot: Slot): OpBossParams {
  const c = g.factions[slot].cyber;
  if (!c) return NO_BOSS_PARAMS;
  return { hack: param(c, 'outils', 'hack', 1), doors: param(c, 'outils', 'doors', 0), remote: param(c, 'outils', 'remote', 0), breach: param(c, 'poing', 'breach', 0) };
}

const losTo = (g: Game, a: OpAnchor, e: Ent): boolean => g.w.city.world.lineOfSight(a.x, a.y + 1.0, a.z, e.x, e.y + 1.3, e.z);

/** L'entité est à son poste de travail : assez près de l'ancre, au même étage, en vue. */
function atAnchor(g: Game, e: Ent, a: OpAnchor, r: number): boolean {
  if (!e.alive || e.flags & FLAG.HIDDEN) return false;
  if (Math.abs(e.y - a.y) > 1.6) return false;
  const d = Math.hypot(e.x - a.x, e.z - a.z);
  if (d > r) return false;
  return d < 0.9 || losTo(g, a, e);
}

/** Le parrain peut mener l'étape d'ici (vivant, à pied, assez près, en vue). */
function bossCanWork(g: Game, slot: Slot, a: OpAnchor, r: number): boolean {
  const f = g.factions[slot];
  const boss = g.ents.get(f.bossId);
  return !!boss && f.vehicle < 0 && atAnchor(g, boss, a, r);
}

const isMan = (e: Ent) => e.role === 'boss' || e.role === 'lieutenant' || e.role === 'gangster' || e.role === 'guard';

/** Un défenseur (ou un rival) qui conteste l'objectif de l'attaquant `faction`. */
function contests(g: Game, e: Ent, faction: number, bid: number): boolean {
  if (!e.alive || e.flags & FLAG.HIDDEN || e.faction === faction) return false;
  if (e.role === 'turret') return e.ai?.home === bid && !isHacked(g, bid);
  if (e.role === 'thug') return true;
  return isMan(e) && (e.faction === Faction.DADOU || e.faction === Faction.EVEN);
}

function contestedAt(g: Game, a: OpAnchor, faction: number, bid: number): boolean {
  let found = false;
  g.near(a.x, a.z, OP_CONTEST_RADIUS, (e) => {
    if (found || Math.abs(e.y - a.y) > 2.2 || !contests(g, e, faction, bid)) return;
    if (losTo(g, a, e)) found = true;
  });
  return found;
}

/** Défenseurs encore debout dans le bâtiment, hostiles à l'attaquant (phase de nettoyage des lieutenants). */
export function defendersLeft(g: Game, bid: number, faction: number): number {
  const info = g.building(bid);
  const cx = (info.footprint[0] + info.footprint[2]) / 2;
  const cz = (info.footprint[1] + info.footprint[3]) / 2;
  const r = Math.hypot(info.footprint[2] - info.footprint[0], info.footprint[3] - info.footprint[1]) / 2 + 1;
  let n = 0;
  g.near(cx, cz, r, (e) => {
    if (!contests(g, e, faction, bid)) return;
    if (e.role === 'thug' && e.ai?.home !== bid) return;
    if (g.inBuildingArea(info, e.x, e.y, e.z)) n++;
  });
  return n;
}

function gangLeft(g: Game, bid: number): number {
  let n = 0;
  for (const id of g.bstate.get(bid)!.thugs) if (g.ents.get(id)?.alive) n++;
  return n;
}

// ---------------------------------------------------------------------------- lancement, fin

function notifyOwner(g: Game, bid: number, text: string, key: string, cd: number): void {
  const os = factionSlot(g.bstate.get(bid)!.owner);
  if (os) g.notify(os, text, 'alert', key, cd);
}

/** Lance l'opération d'un parrain sur un bâtiment (null si c'est impossible). */
export function startOp(g: Game, bid: number, slot: Slot, by: Ent | null): Op | null {
  const s = S(g);
  const def = BUILDINGS[bid];
  const st = g.bstate.get(bid);
  if (!def?.capturable || !st || g.isReserved(bid)) return null;
  const faction = slotFaction(slot);
  if (st.owner === faction) return null;
  const cur = s.ops.get(bid);
  if (cur) return cur.slot === slot ? cur : null;
  if (hqLocked(g, bid, slot)) {
    const of = g.hqOwnerOf(bid)!;
    g.notify(slot, `Le QG ${DE_BOSS[of]} est imprenable : contrôlez au moins ${HQ_CAPTURE_MIN_DISTRICTS} quartiers sur ${DISTRICTS.length} (vous en avez ${g.territories(slot)}).`, 'info', 'hq-locked', 15);
    return null;
  }
  const plan = planOf(g, bid);
  if (!plan || plan.steps.length === 0) return null;
  const op: Op = {
    b: bid,
    slot,
    faction,
    hq: !!g.hqOwnerOf(bid),
    plan,
    step: 0,
    prog: 0,
    rate: 0,
    by: 0,
    lt: '',
    contested: false,
    who: [],
    carrier: -1,
    drop: null,
    undo: 0,
    undoBy: 0,
    locked: false,
    gang: gangLeft(g, bid),
    presentAt: g.time,
    rivalAt: -100,
    startedAt: g.time,
  };
  s.ops.set(bid, op);
  const a = plan.steps[0].anchor;
  g.emitAll({ t: 'op', b: bid, slot, ev: 'start', step: 0, x: a.x, y: a.y, z: a.z });
  const n = plan.steps.length;
  g.notify(slot, `Prise de contrôle ${deNom(def.name)} : ${n > 1 ? `étape 1/${n} — ` : ''}${plan.steps[0].label}.`, 'info', `op-start-${bid}`, 20);
  const os = factionSlot(st.owner);
  if (os) {
    if (op.hq) g.notify(os, `ATTENTION ! ${BOSS_NAME[slot]} donne l’assaut à votre quartier général !`, 'alert', `op-hq-${bid}`, 30);
    else g.notify(os, `ALERTE — ${BOSS_NAME[slot]} tente de prendre ${leNom(def.name)} (${DISTRICT_BY_ID[def.district].name}) !`, 'alert', `op-al-${bid}`, 30);
  } else if (def.isKey) g.notify(otherSlot(slot), `${BOSS_NAME[slot]} tente de prendre ${leNom(def.name)} (${DISTRICT_BY_ID[def.district].name}).`, 'info', `op-al-${bid}`, 90);
  // le gang local se jette sur l'intrus
  if (by) for (const id of st.thugs) g.ents.get(id)?.ai?.aggro.set(by.id, g.time + 60);
  return op;
}

function endOp(g: Game, bid: number): void {
  const s = S(g);
  s.ops.delete(bid);
  for (const slot of ['dadou', 'even'] as Slot[]) if (s.work[slot]?.b === bid) s.work[slot] = null;
  const st = g.bstate.get(bid);
  if (st) {
    st.progress = 0;
    st.capBy = 0;
    st.contested = false;
  }
}

/** Opération abandonnée ou annulée : tout est remis en place. */
function cancelOp(g: Game, op: Op, why: 'abandon' | 'moved'): void {
  const def = BUILDINGS[op.b];
  endOp(g, op.b);
  g.emitAll({ t: 'op', b: op.b, slot: op.slot, ev: 'fail', step: op.step });
  if (why === 'moved') {
    g.notify(op.slot, `Le QG a déménagé : l’opération sur ${leNom(def.name)} est annulée.`, 'info');
    return;
  }
  g.notify(op.slot, `L’opération sur ${leNom(def.name)} est abandonnée : plus aucun de vos hommes sur place.`, 'bad', `op-end-${op.b}`, 10);
  notifyOwner(g, op.b, `L’opération ${DE_BOSS[op.slot]} contre ${leNom(def.name)} a échoué.`, `op-end-${op.b}`, 10);
}

/** Une étape réussie : la suivante, ou le bâtiment change de mains. */
function completeStep(g: Game, op: Op, name: string, carrier: Ent | null): void {
  const def = BUILDINGS[op.b];
  const step = op.plan.steps[op.step];
  const n = op.plan.steps.length;
  op.who.push(name);
  op.step++;
  op.prog = 0;
  op.undo = 0;
  op.rate = 0;
  if (step.kind === 'secure' && carrier) op.carrier = carrier.id;
  if (step.kind === 'deliver') op.carrier = -1;
  const a = step.anchor;
  g.emitAll({ t: 'op', b: op.b, slot: op.slot, ev: 'step', step: op.step - 1, x: a.x, y: a.y, z: a.z });
  // caméras coupées, sécurité d'un QG neutralisée : caméras et tourelles se taisent un moment
  if ((step.key === 'gate' || step.key === 'terminal') && securityOf(g, op.b) && !isHacked(g, op.b)) squadHack(g, op.slot, op.b, name);
  if (op.step >= n) {
    g.setOwner(op.b, op.faction, op.slot);
    return;
  }
  const next = op.plan.steps[op.step];
  if (step.kind === 'secure' && step.item) {
    g.notify(op.slot, `${name} emporte ${step.item} : direction ${next.place} !`, 'good');
    notifyOwner(g, op.b, `ALERTE — ${BOSS_NAME[op.slot]} emporte ${step.item} ${deNom(def.name)} ! Abattez le porteur.`, `op-carry-${op.b}`, 10);
  } else {
    g.notify(op.slot, `Étape ${op.step}/${n} réussie ${aNom(def.name)} (${step.label.toLowerCase()}). Prochaine étape : ${next.label}.`, 'good');
    notifyOwner(g, op.b, `ALERTE — ${cap(leNom(def.name))} : ${BOSS_NAME[op.slot]} a franchi l’étape ${op.step}/${n} (${step.place}).${step.undo ? ' Reprenez-la !' : ''}`, `op-step-${op.b}`, 8);
  }
}

// ---------------------------------------------------------------------------- objet emporté

function itemOf(op: Op): string {
  for (let i = op.step; i >= 0; i--) {
    const it = op.plan.steps[i]?.item;
    if (it) return it;
  }
  return 'le document';
}

/** Le porteur est tombé, l'objet est ramassé ou rendu au coffre. */
function updateCarry(g: Game, op: Op): void {
  const def = BUILDINGS[op.b];
  if (op.carrier >= 0) {
    const c = g.ents.get(op.carrier);
    if (!c || !c.alive) {
      const x = c ? c.x : op.plan.steps[op.step].anchor.x;
      const y = c ? c.y : op.plan.steps[op.step].anchor.y;
      const z = c ? c.z : op.plan.steps[op.step].anchor.z;
      op.carrier = -1;
      op.drop = { x, y, z, at: g.time };
      const it = itemOf(op);
      g.emitAll({ t: 'op', b: op.b, slot: op.slot, ev: 'drop', step: op.step, x, y, z });
      g.notify(op.slot, `Le porteur est tombé : ${it} est à terre. Ramassez-le !`, 'bad');
      notifyOwner(g, op.b, `Le porteur ${DE_BOSS[op.slot]} est tombé : reprenez ${it} ${deNom(def.name)} !`, `op-drop-${op.b}`, 5);
    }
    return;
  }
  const d = op.drop;
  if (!d) return;
  const owner = g.bstate.get(op.b)!.owner;
  let taker: Ent | null = null;
  let back = false;
  g.near(d.x, d.z, OP_PICKUP_RADIUS, (e) => {
    if (taker || back || !e.alive || e.flags & FLAG.HIDDEN || Math.abs(e.y - d.y) > 1.5) return;
    if (e.faction === op.faction && (e.role === 'boss' || e.role === 'lieutenant')) taker = e;
    else if (e.faction === owner && (owner === Faction.DADOU || owner === Faction.EVEN) && isMan(e)) back = true;
  });
  const t = taker as Ent | null;
  if (t) {
    op.carrier = t.id;
    op.drop = null;
    g.emitAll({ t: 'op', b: op.b, slot: op.slot, ev: 'pickup', step: op.step, x: d.x, y: d.y, z: d.z });
    g.notify(op.slot, `${t.role === 'boss' ? 'Vous avez' : `${t.name ?? 'Votre lieutenant'} a`} récupéré ${itemOf(op)}.`, 'good');
  } else if (back || g.time - d.at > OP_DROP_RETURN) {
    // rendu au coffre : il faut le récupérer à nouveau
    const it = itemOf(op);
    op.drop = null;
    op.step = Math.max(0, op.step - 1);
    op.prog = 0;
    op.who.length = Math.min(op.who.length, op.step);
    g.emitAll({ t: 'op', b: op.b, slot: op.slot, ev: 'return', step: op.step });
    g.notify(op.slot, `${cap(it)} a été remis au coffre ${deNom(def.name)}.`, 'bad');
    const os = factionSlot(owner);
    if (os) g.notify(os, `${cap(it)} ${deNom(def.name)} est de retour au coffre.`, 'good');
  }
}

// ---------------------------------------------------------------------------- progression

/** Opérateurs à l'œuvre sur l'étape en cours. */
function operators(g: Game, op: Op, step: OpStep): { boss: Ent | null; bossMul: number; lts: Ent[] } {
  const s = S(g);
  const a = step.anchor;
  const r = opRadius(step.kind);
  const f = g.factions[op.slot];
  const lts: Ent[] = [];
  let boss: Ent | null = null;
  let bossMul = 0;
  if (step.kind === 'deliver') {
    // seul le porteur dépose l'objet (sans rien demander : il suffit d'arriver)
    const c = g.ents.get(op.carrier);
    if (c && atAnchor(g, c, a, r) && (c.role !== 'boss' || f.vehicle < 0)) {
      if (c.role === 'boss') {
        boss = c;
        bossMul = 1;
      } else lts.push(c);
    }
    return { boss, bossMul, lts };
  }
  const w = s.work[op.slot];
  if (w && w.b === op.b && !w.undo && w.step === op.step) {
    const p = bossParams(g, op.slot);
    if (bossCanWork(g, op.slot, a, bossWorkRange(step.kind, p))) {
      boss = g.ents.get(f.bossId)!;
      // piratage interactif : le parrain joue l'épreuve, le temps ne compte pas pour lui
      bossMul = w.mini ? 0 : bossWorkMul(step.kind, p);
    } else {
      s.work[op.slot] = null;
      g.notify(op.slot, 'Vous avez quitté l’objectif : l’étape attend votre retour.', 'info', `op-left-${op.b}`, 6);
    }
  }
  g.near(a.x, a.z, r + 0.5, (e) => {
    if (e.role === 'lieutenant' && e.slot === op.slot && atAnchor(g, e, a, r)) lts.push(e);
  });
  return { boss, bossMul, lts };
}

function stepOp(g: Game, op: Op, dt: number): void {
  const s = S(g);
  const def = BUILDINGS[op.b];
  const info = g.building(op.b);
  const st = g.bstate.get(op.b)!;
  if (st.owner === op.faction) return endOp(g, op.b);
  if (op.hq !== !!g.hqOwnerOf(op.b)) return cancelOp(g, op, 'moved');
  // présence de l'attaquant (et d'un troisième larron sur un bâtiment neutre)
  const rivalF = st.owner === Faction.NEUTRAL ? slotFaction(otherSlot(op.slot)) : -1;
  const cx = (info.footprint[0] + info.footprint[2]) / 2;
  const cz = (info.footprint[1] + info.footprint[3]) / 2;
  const rad = Math.hypot(info.footprint[2] - info.footprint[0], info.footprint[3] - info.footprint[1]) / 2 + 1;
  let present = op.carrier >= 0;
  let rival = false;
  g.near(cx, cz, rad, (e) => {
    if ((present && (rival || rivalF < 0)) || !e.alive || e.flags & FLAG.HIDDEN || !isMan(e)) return;
    if (e.faction !== op.faction && e.faction !== rivalF) return;
    if (!g.inBuildingArea(info, e.x, e.y, e.z)) return;
    if (e.faction === op.faction) present = true;
    else rival = true;
  });
  if (present) op.presentAt = g.time;
  if (rival) op.rivalAt = g.time;
  const away = g.time - op.presentAt;
  if (away > OP_ABANDON || (rival && away > OP_RIVAL_TAKEOVER)) return cancelOp(g, op, 'abandon');
  op.locked = hqLocked(g, op.b, op.slot);
  op.gang = gangLeft(g, op.b);
  updateCarry(g, op);
  const step = op.plan.steps[op.step];
  if (!step) return;
  // « couper les caméras » : la sécurité déjà piratée (terminal de l'entrée) vaut l'étape
  if (step.key === 'terminal' && isHacked(g, op.b)) return completeStep(g, op, BOSS_NAME[op.slot], null);
  const { boss, bossMul, lts } = operators(g, op, step);
  op.by = (boss ? 1 : 0) | (lts.length ? 2 : 0);
  op.lt = lts.length ? (lts[0].name ?? '') : '';
  op.contested = !op.drop && contestedAt(g, step.anchor, op.faction, op.b);
  if (op.contested) g.notify(op.slot, `Objectif contesté ${aNom(def.name)} : éliminez les ennemis près ${dePlace(step.place)} !`, 'alert', `op-contest-${op.b}`, 25);
  let rate = 0;
  if (!op.locked && !op.contested && !op.drop && (boss || lts.length)) {
    const ltMul = lts.length ? Math.min(1.5, 1 + 0.25 * (lts.length - 1)) * opsSpeedMul(g, op.slot) : 0;
    const both = boss && lts.length ? OP_BOTH_MUL / 2 : 1;
    rate = ((bossMul + ltMul) * both * hqDefenseMul(g, op.b)) / Math.max(1, step.time);
  } else if (!op.contested && !(boss && s.work[op.slot]?.mini)) rate = -OP_DECAY;
  op.rate = rate;
  op.prog = Math.max(0, op.prog + rate * dt);
  // le gang tient encore les lieux : la dernière étape attend qu'il soit éliminé
  const last = op.step === op.plan.steps.length - 1;
  if (last && op.gang > 0 && op.prog > 0.95) {
    op.prog = 0.95;
    op.rate = 0;
    g.notify(op.slot, `Les derniers voyous tiennent encore ${leNom(def.name)} : éliminez-les (${op.gang}) !`, 'info', `op-gang-${op.b}`, 12);
  }
  if (op.prog >= 1) {
    const name = boss && (bossMul > 0 || !lts.length) ? BOSS_NAME[op.slot] : (lts[0]?.name ?? BOSS_NAME[op.slot]);
    const carrier = step.kind === 'secure' ? (boss ?? lts[0] ?? null) : null;
    if (s.work[op.slot]?.b === op.b) s.work[op.slot] = null;
    completeStep(g, op, name, carrier);
    return;
  }
  updateUndo(g, op, dt);
}

/** Le propriétaire reprend la dernière étape volée (son parrain ou ses lieutenants, sur place). */
function updateUndo(g: Game, op: Op, dt: number): void {
  const s = S(g);
  const owner = g.bstate.get(op.b)!.owner;
  const os = factionSlot(owner);
  op.undoBy = 0;
  const prev = op.step > 0 ? op.plan.steps[op.step - 1] : null;
  if (!os || !prev || !prev.undo || prev.kind === 'secure' || op.carrier >= 0 || op.drop) {
    op.undo = 0;
    return;
  }
  const a = prev.anchor;
  const r = opRadius(prev.kind);
  const w = s.work[os];
  let mul = 0;
  if (w && w.b === op.b && w.undo && w.step === op.step - 1) {
    if (bossCanWork(g, os, a, r)) {
      mul += 1;
      op.undoBy |= 1;
    } else s.work[os] = null;
  }
  g.near(a.x, a.z, r + 0.5, (e) => {
    if (e.role === 'lieutenant' && e.slot === os && atAnchor(g, e, a, r)) {
      if (!(op.undoBy & 2)) mul += 1;
      op.undoBy |= 2;
    }
  });
  if (mul > 0 && !contestedAt(g, a, owner, op.b)) {
    op.undo += (dt * Math.min(OP_BOTH_MUL, mul * (mul > 1 ? OP_BOTH_MUL / 2 : 1))) / Math.max(OP_UNDO_MIN, prev.time * OP_UNDO_FACTOR);
  } else op.undo = Math.max(0, op.undo - dt * 0.25);
  if (op.undo < 1) return;
  // étape reprise
  const def = BUILDINGS[op.b];
  op.step--;
  op.prog = 0;
  op.undo = 0;
  op.who.length = Math.min(op.who.length, op.step);
  if (s.work[os]?.undo) s.work[os] = null;
  if (s.work[op.slot]?.b === op.b) s.work[op.slot] = null;
  g.emitAll({ t: 'op', b: op.b, slot: op.slot, ev: 'undo', step: op.step, x: a.x, y: a.y, z: a.z });
  g.notify(os, `Vous avez repris ${prev.place} ${deNom(def.name)}.`, 'good');
  g.notify(op.slot, `${BOSS_NAME[os]} a repris ${prev.place} ${deNom(def.name)} : l’étape ${op.step + 1} est à refaire.`, 'bad');
}

/** Opérations : lancement par les lieutenants arrivés sur place, progression, état public. */
export function updateConquest(g: Game, dt: number): void {
  const s = S(g);
  // un lieutenant arrivé au premier objectif lance l'opération
  for (const sq of g.squads.values()) {
    if (sq.state !== 'assault' || sq.goalBuilding < 0 || s.ops.has(sq.goalBuilding)) continue;
    const lt = g.ents.get(sq.id);
    if (!lt || !lt.alive) continue;
    const plan = planOf(g, sq.goalBuilding);
    const first = plan?.steps[0];
    if (!first || !atAnchor(g, lt, first.anchor, opRadius(first.kind))) continue;
    startOp(g, sq.goalBuilding, sq.slot, lt);
  }
  for (const op of [...s.ops.values()]) stepOp(g, op, dt);
  // travail du parrain sur un bâtiment sans opération (déjà prise, annulée) : on l'oublie
  for (const slot of ['dadou', 'even'] as Slot[]) {
    const w = s.work[slot];
    if (w && !s.ops.has(w.b)) s.work[slot] = null;
  }
  // états hérités (cartes) : progression globale de l'opération, camp qui la mène, contestation
  for (const st of g.bstate.values()) {
    const op = s.ops.get(st.id);
    st.progress = op ? opOverall({ step: op.step, n: op.plan.steps.length, p: op.prog }) : 0;
    st.capBy = op ? op.faction : 0;
    st.contested = !!op && op.contested;
  }
}

// ---------------------------------------------------------------------------- action du parrain

function bossAction(g: Game, slot: Slot, act: Extract<ClientAction, { a: 'op' }>): void {
  const s = S(g);
  const f = g.factions[slot];
  const boss = g.ents.get(f.bossId);
  const bid = act.b;
  const def = BUILDINGS[bid];
  const info = g.w.byId.get(bid);
  if (!boss || !def || !info || !def.capturable || typeof act.k !== 'string') return;
  // k vide : le parrain arrête (piratage interactif abandonné)
  if (act.k === '') {
    if (s.work[slot]?.b === bid) s.work[slot] = null;
    return;
  }
  if (!boss.alive || f.vehicle >= 0) return;
  const st = g.bstate.get(bid)!;
  const mine = slotFaction(slot);
  const op = s.ops.get(bid);
  // ------------------------------------------------ le propriétaire reprend l'étape volée
  if (st.owner === mine) {
    const prev = op && op.step > 0 ? op.plan.steps[op.step - 1] : null;
    if (!op || !prev || prev.key !== act.k || !prev.undo || prev.kind === 'secure') return;
    if (!bossCanWork(g, slot, prev.anchor, opRadius(prev.kind))) return g.notify(slot, 'Approchez-vous de l’objectif.', 'info', 'op-far', 3);
    s.work[slot] = { b: bid, step: op.step - 1, undo: true, since: g.time, mini: false };
    g.notify(slot, `${prev.undo} : restez sur place.`, 'info', `op-undo-${bid}`, 5);
    return;
  }
  // ------------------------------------------------ l'attaquant mène l'étape en cours
  if (g.isReserved(bid)) return;
  if (op && op.slot !== slot) return g.notify(slot, `${BOSS_NAME[op.slot]} mène déjà une opération ici : chassez ses hommes pour prendre la main.`, 'bad', 'op-busy', 4);
  const plan = op?.plan ?? planOf(g, bid);
  if (!plan) return;
  // caméras déjà coupées (terminal piraté) : la première étape est acquise
  const skip = !op && plan.steps[0].key === 'terminal' && plan.steps.length > 1 && isHacked(g, bid) ? 1 : 0;
  const idx = op ? op.step : skip;
  const step = plan.steps[idx];
  if (!step || step.key !== act.k || step.kind === 'deliver') return;
  if (hqLocked(g, bid, slot)) {
    const of = g.hqOwnerOf(bid)!;
    return g.notify(slot, `Le QG ${DE_BOSS[of]} est imprenable : contrôlez au moins ${HQ_CAPTURE_MIN_DISTRICTS} quartiers sur ${DISTRICTS.length} (vous en avez ${g.territories(slot)}).`, 'info', 'hq-locked', 6);
  }
  const p = bossParams(g, slot);
  if (!bossCanWork(g, slot, step.anchor, bossWorkRange(step.kind, p))) return g.notify(slot, 'Trop loin de l’objectif.', 'info', 'op-far', 3);
  // issue du piratage interactif
  if (act.ok !== undefined) {
    const w = s.work[slot];
    if (!op || !w || w.b !== bid || w.step !== op.step || !w.mini) return;
    if (act.ok) {
      if (g.time - w.since < OP_MINIGAME_MIN || op.locked) return;
      if (op.contested) return g.notify(slot, 'Impossible : l’objectif est contesté !', 'bad', 'op-contest-mini', 3);
      if (op.step === plan.steps.length - 1 && gangLeft(g, bid) > 0) return g.notify(slot, `Les derniers voyous tiennent encore ${leNom(def.name)} : éliminez-les d’abord.`, 'info', `op-gang-${bid}`, 5);
      s.work[slot] = null;
      op.prog = 1;
      completeStep(g, op, BOSS_NAME[slot], boss);
    } else {
      // piratage raté : l'alarme sonne, les défenseurs accourent
      s.work[slot] = null;
      s.lockout[slot] = g.time + 3;
      op.prog = Math.max(0, op.prog - 0.25);
      const a = step.anchor;
      g.emitAll({ t: 'op', b: bid, slot, ev: 'alarm', step: op.step, x: a.x, y: a.y, z: a.z });
      g.emitAll({ t: 'sound', s: 'alarm_burst', x: a.x, y: a.y + 2, z: a.z });
      g.notify(slot, 'Piratage raté : l’alarme sonne ! Recommencez vite.', 'bad');
      notifyOwner(g, bid, `ALERTE — piratage raté ${aNom(def.name)} : ${BOSS_NAME[slot]} est dans les murs !`, `op-alarm-${bid}`, 15);
      g.near(a.x, a.z, 30, (e) => {
        if (e.ai && e.alive && e.faction !== mine && (e.role === 'thug' || isMan(e))) e.ai.aggro.set(boss.id, g.time + 30);
      });
    }
    return;
  }
  if (g.time < s.lockout[slot]) return g.notify(slot, 'L’alarme sonne encore : attendez un instant avant de recommencer.', 'info', 'op-lock', 2);
  const o = op ?? startOp(g, bid, slot, boss);
  if (!o) return;
  if (o.step < idx) completeStep(g, o, BOSS_NAME[slot], null);
  if (o.step !== idx) return;
  s.work[slot] = { b: bid, step: o.step, undo: false, since: g.time, mini: step.kind === 'minigame' };
  if (step.kind !== 'minigame') g.notify(slot, `${step.label} : restez près de l’objectif.`, 'info', `op-work-${bid}-${o.step}`, 8);
}

// ---------------------------------------------------------------------------- état public, module

function toPub(op: Op): OpPub {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const out: OpPub = {
    b: op.b,
    slot: op.slot,
    step: op.step,
    n: op.plan.steps.length,
    p: r2(Math.min(1, op.prog)),
    rate: Math.round(op.rate * 1000) / 1000,
    contested: op.contested,
    by: op.by,
    who: [...op.who],
  };
  if (op.by & 2 && op.lt) out.lt = op.lt;
  if (op.carrier >= 0) out.carrier = op.carrier;
  if (op.drop) out.drop = [r2(op.drop.x), r2(op.drop.y), r2(op.drop.z)];
  if (op.undo > 0) out.undo = r2(op.undo);
  if (op.undoBy) out.undoBy = op.undoBy;
  if (op.locked) out.locked = true;
  if (op.gang > 0 && op.step === op.plan.steps.length - 1) out.gang = op.gang;
  return out;
}

export function conquestModule(g: Game): GameModule {
  void S(g);
  // les équipements du QG (centre d'opérations, porte blindée) sont appliqués ici (stepOp)
  HQ_HOOKS.captureHandled = true;
  return {
    action(slot, act) {
      if (act.a === 'debugClear') {
        // réservé aux tests automatisés : on vide un bâtiment de ses défenseurs
        if (process.env.MW_DEBUG === '1') {
          for (const id of g.bstate.get(act.b)?.thugs ?? []) {
            const t = g.ents.get(id);
            if (t && t.alive) g.damage(t, 9999, null);
          }
          for (const e of g.ents.values()) if (e.role === 'turret' && e.ai?.home === act.b && e.alive) g.damage(e, 9999, null);
        }
        return true;
      }
      if (act.a !== 'op') return false;
      bossAction(g, slot, act);
      return true;
    },
    pub(out: PublicState) {
      out.ops = opsList(g).map(toPub);
    },
    onOwner(bid) {
      endOp(g, bid);
    },
    onMoveHq() {
      for (const op of opsList(g)) if (op.hq !== !!g.hqOwnerOf(op.b)) cancelOp(g, op, 'moved');
    },
  };
}

/** Point visé par un lieutenant de l'attaquant dans le bâtiment (squads.ts). */
export interface OpGoal {
  mode: 'work' | 'pickup' | 'carry' | 'escort' | 'contest' | 'locked';
  pt: Vec2 & { y: number };
  step: OpStep | null;
  idx: number;
  n: number;
  op: Op | null;
}

export function attackGoal(g: Game, bid: number, slot: Slot, lt: Ent): OpGoal | null {
  const plan = planOf(g, bid);
  if (!plan || !plan.steps.length) return null;
  const info = g.building(bid);
  const op = opOf(g, bid) ?? null;
  const n = plan.steps.length;
  if (hqLocked(g, bid, slot)) return { mode: 'locked', pt: { ...info.doors[0].in, y: info.doors[0].in.y ?? info.floorY }, step: null, idx: 0, n, op };
  if (op && op.slot !== slot) {
    const st = op.plan.steps[op.step];
    const a = op.drop ?? st.anchor;
    return { mode: 'contest', pt: { x: a.x, y: a.y, z: a.z }, step: st, idx: op.step, n, op };
  }
  const idx = op ? op.step : 0;
  const step = (op?.plan ?? plan).steps[idx];
  if (!step) return null;
  if (op?.drop) return { mode: 'pickup', pt: { x: op.drop.x, y: op.drop.y, z: op.drop.z }, step, idx, n, op };
  const a = step.anchor;
  if (op && op.carrier >= 0) return { mode: op.carrier === lt.id ? 'carry' : 'escort', pt: { x: a.x, y: a.y, z: a.z }, step, idx, n, op };
  return { mode: 'work', pt: { x: a.x, y: a.y, z: a.z }, step, idx, n, op };
}

/** Point visé par un lieutenant du propriétaire qui défend un bâtiment visé par une opération. */
export function defendGoal(g: Game, bid: number, slot: Slot): { mode: 'undo' | 'contest' | 'recover'; pt: Vec2 & { y: number }; step: OpStep; op: Op } | null {
  const op = opOf(g, bid);
  if (!op || op.slot === slot) return null;
  const cur = op.plan.steps[op.step];
  if (!cur) return null;
  if (op.drop) return { mode: 'recover', pt: { x: op.drop.x, y: op.drop.y, z: op.drop.z }, step: cur, op };
  const prev = op.step > 0 ? op.plan.steps[op.step - 1] : null;
  if (prev && prev.undo && prev.kind !== 'secure' && op.carrier < 0 && !contestedAt(g, prev.anchor, slotFaction(slot), op.b)) {
    const a = prev.anchor;
    return { mode: 'undo', pt: { x: a.x, y: a.y, z: a.z }, step: prev, op };
  }
  const a = cur.anchor;
  return { mode: 'contest', pt: { x: a.x, y: a.y, z: a.z }, step: cur, op };
}

/** Postes autour d'un objectif (praticables, en vue) : les hommes couvrent l'opérateur. */
export function anchorRing(g: Game, pt: Vec2 & { y: number }, n: number, r = 2.6): (Vec2 & { y: number })[] {
  const out: (Vec2 & { y: number })[] = [];
  for (let i = 0; i < 8 && out.length < n; i++) {
    const ang = (i / 8) * Math.PI * 2 + 0.4;
    const x = pt.x + Math.cos(ang) * r;
    const z = pt.z + Math.sin(ang) * r;
    if (g.w.nav.walkable(x, z, pt.y, 0.8) && g.w.city.world.lineOfSight(pt.x, pt.y + 1, pt.z, x, pt.y + 1, z)) out.push({ x, z, y: pt.y });
  }
  return out;
}
