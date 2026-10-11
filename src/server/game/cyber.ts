// Implants cybernétiques côté serveur : achats, améliorations, installation (clinique ou station
// du QG), configurations enregistrées, et l'état d'exécution des capacités (recharges, charges,
// bouclier, camouflage…). Les effets de combat et de déplacement sont lus par Game.ts.

import { IMPLANT_ARM_WEAPON, Weapon } from '../../shared/characters';
import { formatMoney } from '../../shared/util';
import {
  CFX,
  cyberLook,
  emptyEquipment,
  IMPLANT_BY_ID,
  implantParams,
  LOADOUT_COUNT,
  LOADOUT_NAMES,
  qualityOf,
  SLOT_BY_ID,
  SLOTS,
  type Equipment,
  type SlotId,
} from '../../shared/implants';
import type { CyberState, Slot } from '../../shared/protocol';
import type { Game } from './Game';

/** Distance (m) d'interaction avec une clinique ou la station du QG. */
export const STATION_RANGE = 3.2;

/** État d'exécution des implants d'un parrain. */
export interface CyberRuntime {
  owned: Map<string, number>;
  equip: Equipment;
  loadouts: (Equipment | null)[];
  /** Instant où chaque capacité est de nouveau prête. */
  readyAt: Map<string, number>;
  /** Charges (esquive) : nombre et instant de la prochaine recharge. */
  charges: Map<string, { n: number; next: number }>;
  /** Bouclier levé : points restants, fin, ouverture (degrés). */
  shield: { hp: number; until: number; arc: number } | null;
  camoUntil: number;
  /** Le premier tir ne révèle pas (camouflage niveau 3). */
  camoKeep: boolean;
  reflexUntil: number;
  overUntil: number;
  invUntil: number;
  secondWindAt: number;
  scanUntil: number;
  /** Grappin accroché : point d'ancrage et fin de validité. */
  grapple: { x: number; y: number; z: number; until: number } | null;
  /** Poussée en cours (esquive, bond, fente, grappin) : vitesse horizontale tolérée et fin. */
  burst: { speed: number; until: number } | null;
  /** Arme de bras sortie : emplacement du bras. */
  armOut: SlotId | null;
  /** Munitions du pistolet d'avant-bras (chargeur) et fin du rechargement. */
  armAmmo: number;
  armReloadUntil: number;
  /** Plus haute altitude depuis le dernier appui au sol (dégâts de chute). */
  airTop: number;
  /** Drone de combat (id d'entité, −1). */
  drone: number;
  /** Dernière blessure (nanobots). */
  hurtAt: number;
  /** En l'air d'après la dernière entrée (atterrissages, dégâts de chute). */
  air: boolean;
  /** Début de la charge du poing hydraulique (0 : pas de charge). */
  chargeAt: number;
  /** Camouflage actif (pour annoncer sa fin une seule fois). */
  camoOn: boolean;
  /** Ennemis marqués (marqueur de cibles, drone) : id → fin de la marque. */
  marks: Map<number, number>;
  /** Caméras : temps passé à découvert devant celles de chaque bâtiment (semelles silencieuses). */
  camSeen: Map<number, number>;
  /** Dernier effet d'atterrissage diffusé (anti-répétition). */
  landFxAt: number;
  /** Dernier impact de bouclier diffusé (anti-répétition). */
  shieldFxAt: number;
}

export function makeCyber(): CyberRuntime {
  return {
    owned: new Map(),
    equip: emptyEquipment(),
    loadouts: new Array(LOADOUT_COUNT).fill(null),
    readyAt: new Map(),
    charges: new Map(),
    shield: null,
    camoUntil: 0,
    camoKeep: false,
    reflexUntil: 0,
    overUntil: 0,
    invUntil: 0,
    secondWindAt: 0,
    scanUntil: 0,
    grapple: null,
    burst: null,
    armOut: null,
    armAmmo: 0,
    armReloadUntil: 0,
    airTop: -Infinity,
    drone: -1,
    hurtAt: -100,
    air: false,
    chargeAt: 0,
    camoOn: false,
    marks: new Map(),
    camSeen: new Map(),
    landFxAt: -10,
    shieldFxAt: -10,
  };
}

/** Implant installé (niveau) ou 0. */
export function level(c: CyberRuntime, id: string): number {
  for (const s of SLOTS) if (c.equip[s.id] === id) return c.owned.get(id) ?? 0;
  return 0;
}

/** Paramètre d'un implant installé (ou valeur par défaut s'il n'est pas installé). */
export function param(c: CyberRuntime, id: string, key: string, dflt = 0): number {
  const lv = level(c, id);
  if (lv <= 0) return dflt;
  const v = implantParams(id, lv)[key];
  return v === undefined ? dflt : v;
}

/** Réduction totale des recharges (accumulateur + coprocesseur), plafonnée. */
export function cooldownMul(c: CyberRuntime): number {
  const r = param(c, 'accumulateur', 'cdr') + param(c, 'coprocesseur', 'cdr');
  return 1 - Math.min(0.35, r);
}

/** Apparence publique (pour les autres joueurs). */
export function lookOf(c: CyberRuntime): string[] {
  return cyberLook(c.equip, Object.fromEntries(c.owned));
}

/** Bits d'état visibles (instantanés). */
export function fxOf(g: Game, c: CyberRuntime): number {
  const t = g.time;
  let fx = 0;
  if (c.grapple && t < c.grapple.until) fx |= CFX.GRAPPLE;
  if (c.shield && t < c.shield.until && c.shield.hp > 0) fx |= CFX.SHIELD;
  if (t < c.camoUntil) fx |= CFX.CAMO;
  if (c.armOut === 'brasG') fx |= CFX.ARM_L;
  if (c.armOut === 'brasD') fx |= CFX.ARM_R;
  if (t < c.reflexUntil) fx |= CFX.REFLEX;
  if (t < c.overUntil) fx |= CFX.OVERCHARGE;
  if (t < c.invUntil) fx |= CFX.SECOND_WIND;
  if (t < c.scanUntil) fx |= CFX.SCAN;
  return fx;
}

/** État privé envoyé au joueur. */
export function cyberPrivate(g: Game, slot: Slot): CyberState {
  const c = g.factions[slot].cyber;
  const cd: Record<string, number> = {};
  for (const [id, at] of c.readyAt) if (at > g.time) cd[id] = Math.round((at - g.time) * 10) / 10;
  const charges: Record<string, number> = {};
  for (const [id, ch] of c.charges) charges[id] = ch.n;
  return {
    owned: Object.fromEntries(c.owned),
    equip: { ...c.equip },
    loadouts: c.loadouts.map((l) => (l ? { ...l } : null)),
    cd,
    charges,
    station: stationNear(g, slot),
  };
}

// --------------------------------------------------------------------------- stations et cliniques

/**
 * Lieu d'installation à portée du parrain : « qg » (station cybernétique du QG, si achetée),
 * « clinique:<bâtiment> » (clinique qui n'appartient pas à l'adversaire), ou null.
 * Les points d'interaction viennent de stationPoints() (cliniques et station du QG).
 */
export function stationNear(g: Game, slot: Slot): string | null {
  const boss = g.ents.get(g.factions[slot].bossId);
  if (!boss || !boss.alive) return null;
  for (const st of stationPoints(g, slot)) {
    if (Math.hypot(boss.x - st.x, boss.z - st.z) < STATION_RANGE && Math.abs(boss.y - st.y) < 2) return st.key;
  }
  return null;
}

/** Points d'installation accessibles à ce parrain. Remplacée par le module des cliniques. */
export let stationPoints = (g: Game, slot: Slot): { key: string; x: number; y: number; z: number }[] => {
  // par défaut : le bureau du QG (avant l'arrivée des cliniques et de la station)
  const hq = g.hq(slot);
  const p = hq.desk ?? hq.center;
  return [{ key: 'qg', x: p.x, y: p.y ?? hq.floorY, z: p.z }];
};

/** Permet au module des cliniques de fournir les points d'installation. */
export function setStationPoints(fn: typeof stationPoints): void {
  stationPoints = fn;
}

// ------------------------------------------------------------------------------ gestion des implants

function ownedEquip(c: CyberRuntime, e: Equipment): Equipment {
  // une configuration ne garde que des implants possédés, chacun une seule fois, au bon endroit
  const out = emptyEquipment();
  const used = new Set<string>();
  for (const s of SLOTS) {
    const id = e[s.id];
    if (!id || used.has(id) || !c.owned.has(id)) continue;
    const def = IMPLANT_BY_ID[id];
    if (!def || def.cat !== s.cat) continue;
    out[s.id] = id;
    used.add(id);
  }
  return out;
}

/** Action « cyber » d'un joueur. */
export function cyberAction(g: Game, slot: Slot, op: string, id?: string, slotId?: SlotId, n?: number): void {
  const f = g.factions[slot];
  const c = f.cyber;
  const station = stationNear(g, slot);
  const needStation = (): boolean => {
    if (station) return true;
    g.notify(slot, 'Rendez-vous dans une clinique cybernétique ou à la station de votre QG.', 'info', 'cyber-station', 3);
    return false;
  };
  switch (op) {
    case 'buy':
    case 'upgrade': {
      const def = id ? IMPLANT_BY_ID[id] : undefined;
      if (!def) return;
      if (!needStation()) return;
      const cur = c.owned.get(def.id) ?? 0;
      if (op === 'buy' && cur > 0) return g.notify(slot, `Vous possédez déjà : ${def.name}.`, 'info');
      if (op === 'upgrade' && cur <= 0) return;
      if (cur >= def.levels.length) return g.notify(slot, `${def.name} est déjà au niveau maximal.`, 'info');
      const price = def.levels[cur].price;
      if (f.money < price) return g.notify(slot, `Pas assez d’argent : il faut ${formatMoney(price)}.`, 'bad');
      f.money -= price;
      c.owned.set(def.id, cur + 1);
      g.notify(slot, cur === 0 ? `Implant acquis : ${def.name} (${qualityOf(def, 1)}).` : `${def.name} amélioré : niveau ${cur + 1} (${qualityOf(def, cur + 1)}).`, 'money');
      // à l'achat, installation automatique si un emplacement de la catégorie est libre
      if (cur === 0) {
        const free = SLOTS.find((s) => s.cat === def.cat && !c.equip[s.id]);
        if (free) equip(g, slot, def.id, free.id, true);
      } else if (level(c, def.id) > 0) refreshLook(g, slot);
      break;
    }
    case 'equip': {
      if (!id || !slotId || !needStation()) return;
      equip(g, slot, id, slotId, false);
      break;
    }
    case 'unequip': {
      if (!slotId || !SLOT_BY_ID[slotId] || !needStation()) return;
      const was = c.equip[slotId];
      if (!was) return;
      if (c.armOut === slotId) retractArm(g, slot);
      c.equip[slotId] = null;
      g.notify(slot, `${IMPLANT_BY_ID[was]?.name ?? 'Implant'} retiré.`, 'info');
      refreshLook(g, slot);
      break;
    }
    case 'save': {
      const k = Math.floor(n ?? -1);
      if (k < 0 || k >= LOADOUT_COUNT) return;
      c.loadouts[k] = { ...c.equip };
      g.notify(slot, `Configuration « ${LOADOUT_NAMES[k]} » enregistrée.`, 'good');
      break;
    }
    case 'load': {
      const k = Math.floor(n ?? -1);
      const lo = c.loadouts[k];
      if (k < 0 || k >= LOADOUT_COUNT || !lo || !needStation()) return;
      if (c.armOut) retractArm(g, slot);
      c.equip = ownedEquip(c, lo);
      g.notify(slot, `Configuration « ${LOADOUT_NAMES[k]} » installée.`, 'good');
      refreshLook(g, slot);
      break;
    }
  }
}

function equip(g: Game, slot: Slot, id: string, slotId: SlotId, silent: boolean): void {
  const c = g.factions[slot].cyber;
  const def = IMPLANT_BY_ID[id];
  const sd = SLOT_BY_ID[slotId];
  if (!def || !sd || !c.owned.has(id)) return;
  if (sd.cat !== def.cat) return g.notify(slot, `${def.name} ne se pose pas à cet emplacement (${sd.label}).`, 'bad');
  // déjà installé ailleurs : on le déplace
  for (const s of SLOTS) if (c.equip[s.id] === id) c.equip[s.id] = null;
  if (c.armOut === slotId) retractArm(g, slot);
  c.equip[slotId] = id;
  if (!silent) g.notify(slot, `${def.name} installé (${sd.label}).`, 'good');
  else g.notify(slot, `${def.name} installé (${sd.label}).`, 'info');
  refreshLook(g, slot);
}

/** Envoie la nouvelle apparence du parrain et met à jour ses armes de bras. */
export function refreshLook(g: Game, slot: Slot): void {
  const f = g.factions[slot];
  const c = f.cyber;
  // armes de bras disponibles
  for (const w of [Weapon.ARM_PISTOL, Weapon.ARM_BLADE, Weapon.ARM_FIST, Weapon.ARM_WHIP]) f.weapons.delete(w);
  for (const s of ['brasG', 'brasD'] as SlotId[]) {
    const id = c.equip[s];
    if (id && IMPLANT_ARM_WEAPON[id] !== undefined) f.weapons.add(IMPLANT_ARM_WEAPON[id]);
  }
  // pistolet d'avant-bras : munitions recyclées (réserve illimitée, seul le chargeur compte)
  if (f.weapons.has(Weapon.ARM_PISTOL)) f.ammo.set(Weapon.ARM_PISTOL, 999);
  else f.ammo.delete(Weapon.ARM_PISTOL);
  if (c.armOut && IMPLANT_ARM_WEAPON[c.equip[c.armOut] ?? ''] === undefined) retractArm(g, slot);
  // charges d'esquive
  const ch = param(c, 'esquive', 'charges');
  if (ch > 0) {
    const cur = c.charges.get('esquive');
    if (!cur) c.charges.set('esquive', { n: ch, next: 0 });
    else cur.n = Math.min(cur.n, ch);
  } else c.charges.delete('esquive');
  g.emitAll({ t: 'cyber', id: f.bossId, cyber: lookOf(c) });
}

/** Outil de test : implant possédé au niveau voulu et installé dans l'emplacement. */
export function debugCyber(g: Game, slot: Slot, id: string, lv: number, slotId: SlotId): void {
  const def = IMPLANT_BY_ID[id];
  const sd = SLOT_BY_ID[slotId];
  if (!def || !sd || sd.cat !== def.cat) return;
  const c = g.factions[slot].cyber;
  c.owned.set(id, Math.max(1, Math.min(def.levels.length, Math.floor(lv))));
  for (const s of SLOTS) if (c.equip[s.id] === id) c.equip[s.id] = null;
  c.equip[slotId] = id;
  refreshLook(g, slot);
}

/** Rentre l'arme de bras sortie. */
export function retractArm(g: Game, slot: Slot): void {
  const f = g.factions[slot];
  const c = f.cyber;
  c.armOut = null;
  const boss = g.ents.get(f.bossId);
  if (boss && boss.weapon >= Weapon.ARM_PISTOL) boss.weapon = Weapon.FISTS;
}
