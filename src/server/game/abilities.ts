// Capacités cybernétiques côté serveur : validation des actions des implants (grappin, esquive,
// bond, armes de bras, bouclier, répulseur, arc électrique, micro-roquettes, outils, camouflage,
// réflexes, surcharge, scanner, drone de combat), modificateurs de dégâts (protections, bouclier,
// cœur de secours, commandement), effets dans la durée (brûlure, étourdissement, projection,
// nanobots), allure maximale tolérée et dégâts de chute. Les effets ne touchent que le parrain
// qui les déclenche et ses cibles : rien ne ralentit le monde.

import { Anim, ARM_WEAPON_IMPLANT, FLAG, IMPLANT_ARM_WEAPON, INPUT_AIR, WEAPONS, Weapon, type WeaponDef } from '../../shared/characters';
import { armWeaponDef, FIST_CHARGE_TIME } from '../../shared/armWeapons';
import { VEHICLES } from '../../shared/constants';
import { CFX, implantParams, type SlotId } from '../../shared/implants';
import { DASH_TIME, grappleMaxSpeed, SPRINT_SPEED } from '../../shared/moveMods';
import type { ClientAction, Slot } from '../../shared/protocol';
import { angleDiff, clamp } from '../../shared/util';
import { cooldownMul, level, param, retractArm, type CyberRuntime } from './cyber';
import type { Game } from './Game';
import { empBuilding, remoteHack } from './security';
import type { Ent } from './types';
import { spawnVehicle } from './vehicles';

/** Type de dégâts (les implants de protection en réduisent certains). */
export type DamageKind = 'bullet' | 'pellet' | 'melee' | 'explosion' | 'shock' | 'burn' | 'fall' | 'impact' | 'other';

type AbAction = Extract<ClientAction, { a: 'ab' }>;

/** Part minimale des dégâts qui passe toujours (aucun parrain n'est invincible). */
const MIN_DAMAGE_PART = 0.15;
/** Hauteur de chute sans dégâts, sans implant (m), et dégâts par mètre au-delà. */
const SAFE_FALL = 6.5;
const FALL_DMG_PER_M = 7;
/** Vitesse des micro-roquettes (m/s). */
const ROCKET_SPEED = 42;

interface Rocket {
  slot: Slot;
  at: number;
  x: number;
  y: number;
  z: number;
  target: number;
  homing: number;
  dmg: number;
  radius: number;
}

const rockets = new WeakMap<Game, Rocket[]>();
function rocketList(g: Game): Rocket[] {
  let r = rockets.get(g);
  if (!r) rockets.set(g, (r = []));
  return r;
}

// ------------------------------------------------------------------------------ outils communs

const C = (g: Game, slot: Slot): CyberRuntime => g.factions[slot].cyber;

/** Prêt (avec une petite tolérance pour la latence) ? */
function ready(g: Game, c: CyberRuntime, id: string): boolean {
  return (c.readyAt.get(id) ?? 0) <= g.time + 0.2;
}

function startCd(g: Game, c: CyberRuntime, id: string, cd: number): void {
  c.readyAt.set(id, g.time + cd * cooldownMul(c));
}

/** Emplacement de bras où cet implant est installé. */
function armSlotOf(c: CyberRuntime, id: string): SlotId | null {
  return c.equip.brasG === id ? 'brasG' : c.equip.brasD === id ? 'brasD' : null;
}

function emitAb(g: Game, e: Ent, ab: string, x: number, y: number, z: number, p2?: { x: number; y: number; z: number } | null, v?: number, targets?: number[]): void {
  g.emitAll({
    t: 'ab',
    id: e.id,
    ab,
    x: r2(x),
    y: r2(y),
    z: r2(z),
    x2: p2 ? r2(p2.x) : undefined,
    y2: p2 ? r2(p2.y) : undefined,
    z2: p2 ? r2(p2.z) : undefined,
    v: v === undefined ? undefined : r2(v),
    targets,
  });
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

function vec(a: number[] | undefined): { x: number; y: number; z: number } | null {
  if (!a || a.length < 3 || !a.every(Number.isFinite)) return null;
  return { x: a[0], y: a[1], z: a[2] };
}

/** Cible légitime d'une capacité offensive : ennemis, voyous, policiers qui nous traquent. */
export function isFoe(g: Game, boss: Ent, e: Ent): boolean {
  if (!e.alive || e.id === boss.id || e.flags & FLAG.HIDDEN || e.invulnerable) return false;
  if (e.role === 'barman' || e.role === 'vehicle') return false;
  if (e.faction === boss.faction) return false;
  if (e.role === 'police') return !!boss.slot && g.factions[boss.slot].heat >= 1;
  return true;
}

/** Ennemi touché par un effet du parrain : étourdissement et projection (autre parrain : chez lui). */
function stunAndKnock(g: Game, boss: Ent, t: Ent, stun: number, vx: number, vy: number, vz: number): void {
  if (t.role === 'boss' && t.slot) {
    const red = param(C(g, t.slot), 'isolant', 'stun');
    const s = stun * (1 - red);
    g.emitTo(t.slot, { t: 'ab', id: t.id, ab: 'pousse', x: r2(t.x), y: r2(t.y), z: r2(t.z), x2: r2(vx), y2: r2(vy), z2: r2(vz), v: r2(s) });
    return;
  }
  if (t.role === 'vehicle') return;
  if (stun > 0) t.stunUntil = Math.max(t.stunUntil ?? 0, g.time + stun);
  if (t.role !== 'turret' && (vx !== 0 || vz !== 0)) t.knock = { vx, vz, until: g.time + 0.35 };
  void boss;
}

/** Le parrain tire ou frappe : le camouflage se lève (sauf « premier tir » au niveau 3). */
export function revealOnAttack(g: Game, slot: Slot): void {
  const c = C(g, slot);
  if (g.time >= c.camoUntil) return;
  if (c.camoKeep) {
    c.camoKeep = false;
    return;
  }
  endCamo(g, slot);
}

function endCamo(g: Game, slot: Slot): void {
  const c = C(g, slot);
  c.camoUntil = 0;
  if (!c.camoOn) return;
  c.camoOn = false;
  const e = g.ents.get(g.factions[slot].bossId);
  if (e) emitAb(g, e, 'camouflage-fin', e.x, e.y + 1, e.z);
}

/** Semelles silencieuses : un PNJ qui tourne le dos n'entend pas le parrain approcher. */
export function unheard(g: Game, boss: Ent, npc: Ent, d: number): boolean {
  if (!boss.slot) return false;
  const hear = param(C(g, boss.slot), 'silence', 'hear', 1);
  if (hear >= 1) return false;
  const off = Math.abs(angleDiff(npc.yaw, Math.atan2(boss.x - npc.x, boss.z - npc.z)));
  return off > 1.75 && d > 3 + 12 * hear;
}

/** Le parrain est-il invisible pour cet observateur (camouflage optique, à plus de 3 m) ? */
export function concealed(g: Game, target: Ent, viewer: Ent): boolean {
  if (target.role !== 'boss' || !target.slot) return false;
  const c = C(g, target.slot);
  if (g.time >= c.camoUntil) return false;
  return Math.hypot(target.x - viewer.x, target.z - viewer.z) > 3;
}

// ----------------------------------------------------------------------------------- dégâts

/** Type de dégâts d'après l'attaquant (arme tenue). */
export function damageKindOf(attacker: Ent | null): DamageKind {
  if (!attacker) return 'other';
  if (attacker.role === 'vehicle') return 'impact';
  if (attacker.weapon === Weapon.SHOTGUN) return 'pellet';
  return WEAPONS[attacker.weapon]?.ranged ? 'bullet' : 'melee';
}

/** Multiplicateur des tirs à la tête (analyseur tactique du tireur). */
export function headMul(g: Game, attacker: Ent | null): number {
  if (!attacker || attacker.role !== 'boss' || !attacker.slot) return 1.8;
  return 1.8 + param(C(g, attacker.slot), 'analyseur', 'head');
}

/** Bonus de commandement d'un homme proche de son parrain (dmg ou armor), 0 sinon. */
function commandBonus(g: Game, e: Ent, key: 'dmg' | 'armor'): number {
  if (!e.slot || (e.role !== 'gangster' && e.role !== 'lieutenant')) return 0;
  const f = g.factions[e.slot];
  const c = f.cyber;
  const lv = level(c, 'commandement');
  if (lv <= 0) return 0;
  const p = implantParams('commandement', lv);
  const boss = g.ents.get(f.bossId);
  if (!boss || !boss.alive || Math.hypot(boss.x - e.x, boss.z - e.z) > p.range) return 0;
  return p[key];
}

/** Dégâts infligés par un PNJ allié : commandement et cibles marquées. */
export function npcDamageMul(g: Game, shooter: Ent, target: Ent): number {
  let m = 1 + commandBonus(g, shooter, 'dmg');
  if (shooter.slot) {
    const c = C(g, shooter.slot);
    const until = c.marks.get(target.id);
    if (until !== undefined && until > g.time) m *= 1 + param(c, 'marqueur', 'squad');
  }
  return m;
}

/**
 * Dégâts reçus après les défenses : bouclier (arc frontal), invulnérabilité du cœur de secours,
 * protections cumulées (plafonnées), armure de commandement des hommes. Renvoie le reste.
 */
export function cyberDefense(g: Game, target: Ent, amount: number, attacker: Ent | null, kind: DamageKind, hx?: number, hz?: number): number {
  let a = amount;
  const arm = commandBonus(g, target, 'armor');
  if (arm > 0) a *= 1 - arm;
  if (target.role !== 'boss' || !target.slot) return a;
  const slot = target.slot;
  const c = C(g, slot);
  const t = g.time;
  if (t < c.invUntil) return 0;
  // bouclier d'énergie : il encaisse ce qui vient de face (ou de partout en bulle)
  const sh = c.shield;
  if (sh && t < sh.until && sh.hp > 0 && kind !== 'fall' && kind !== 'burn') {
    const fx = attacker ? attacker.x : hx;
    const fz = attacker ? attacker.z : hz;
    if (fx !== undefined && fz !== undefined) {
      const ang = Math.atan2(fx - target.x, fz - target.z);
      const off = (Math.abs(angleDiff(target.yaw, ang)) * 180) / Math.PI;
      if (sh.arc >= 360 || off <= sh.arc / 2 + 5) {
        const ab = Math.min(sh.hp, a);
        sh.hp -= ab;
        a -= ab;
        if (t - c.shieldFxAt > 0.08) {
          c.shieldFxAt = t;
          const d = Math.hypot(fx - target.x, fz - target.z) || 1;
          emitAb(g, target, 'bouclier-impact', target.x + ((fx - target.x) / d) * 0.7, target.y + 1.3, target.z + ((fz - target.z) / d) * 0.7);
        }
        if (sh.hp <= 0) breakShield(g, slot, true);
        if (a <= 0) return 0;
      }
    }
  }
  if (kind === 'shock' && param(c, 'isolant', 'shock') > 0) return 0;
  let part = 1;
  if (kind !== 'fall') part *= 1 - param(c, 'blindage', 'reduce');
  if (kind === 'bullet' || kind === 'pellet') part *= 1 - param(c, 'derme', 'reduce');
  if (kind === 'melee') part *= 1 - param(c, 'gel', 'melee');
  if (kind === 'pellet') part *= 1 - param(c, 'gel', 'pellets');
  if (kind === 'explosion') part *= 1 - param(c, 'antichoc', 'reduce');
  if (kind === 'burn') part *= 1 - param(c, 'isolant', 'burn');
  if (t < c.overUntil) part *= 1 - param(c, 'surcharge', 'reduce');
  if (t < c.reflexUntil) part *= 1 - param(c, 'reflexes', 'reduce');
  a *= Math.max(MIN_DAMAGE_PART, part);
  if (a > 0) c.hurtAt = t;
  return a;
}

/** Cœur de secours : sous le seuil (ou mortellement touché), le parrain se relève. */
export function secondWind(g: Game, target: Ent): boolean {
  if (target.role !== 'boss' || !target.slot) return false;
  const c = C(g, target.slot);
  const lv = level(c, 'secondSouffle');
  if (lv <= 0 || g.time < c.secondWindAt) return false;
  const p = implantParams('secondSouffle', lv);
  if (target.hp > target.maxHp * p.hp) return false;
  target.hp = Math.min(target.maxHp, Math.max(1, target.hp) + target.maxHp * p.heal);
  c.invUntil = g.time + p.inv;
  c.secondWindAt = g.time + p.cd * cooldownMul(c);
  emitAb(g, target, 'secondSouffle', target.x, target.y + 1.2, target.z, null, p.inv);
  g.notify(target.slot, `Cœur de secours : ${p.inv} s d’invulnérabilité !`, 'good');
  return true;
}

// --------------------------------------------------------------------------- armes de bras

/** Caractéristiques d'une arme du parrain (armes de bras selon l'implant, réflexes). */
export function bossWeaponDef(g: Game, slot: Slot, w: Weapon): WeaponDef {
  const c = C(g, slot);
  const id = ARM_WEAPON_IMPLANT[w];
  let def = id ? armWeaponDef(w, level(c, id)) : WEAPONS[w];
  if (g.time < c.reflexUntil) def = { ...def, cooldown: def.cooldown / param(c, 'reflexes', 'fire', 1) };
  return def;
}

/** Tir du pistolet d'avant-bras : munitions recyclées (chargeur seulement). */
export function armPistolShot(g: Game, slot: Slot): boolean {
  const c = C(g, slot);
  if (!armSlotOf(c, 'pistoletBras')) return false;
  if (g.time < c.armReloadUntil - 0.1) return false;
  if (c.armAmmo <= 0) return false;
  c.armAmmo--;
  return true;
}

export function armPistolReload(g: Game, slot: Slot): void {
  const c = C(g, slot);
  const lv = level(c, 'pistoletBras');
  if (lv <= 0) return;
  const p = implantParams('pistoletBras', lv);
  c.armReloadUntil = g.time + p.reload;
  c.armAmmo = p.mag;
}

/** Balle incendiaire du pistolet d'avant-bras (niveau 5). */
export function armPistolHit(g: Game, slot: Slot, t: Ent, by: Ent): void {
  const burn = param(C(g, slot), 'pistoletBras', 'burn');
  if (burn > 0 && t.role !== 'vehicle') t.burn = { dps: burn, until: g.time + 3, by: by.id };
}

/**
 * Coup d'une arme de bras (lame, poing, fouet) : renvoie true si le coup a été traité ici.
 * Le fouet balaie un arc (plusieurs cibles), le poing projette (et se charge).
 */
export function armMelee(g: Game, slot: Slot, w: Weapon, targetId: number): boolean {
  if (w !== Weapon.ARM_BLADE && w !== Weapon.ARM_FIST && w !== Weapon.ARM_WHIP) return false;
  const f = g.factions[slot];
  const c = f.cyber;
  const e = g.ents.get(f.bossId);
  if (!e || !e.alive) return true;
  const id = ARM_WEAPON_IMPLANT[w]!;
  const lv = level(c, id);
  if (lv <= 0) return true;
  const p = implantParams(id, lv);
  const def = bossWeaponDef(g, slot, w);
  if (g.time < e.nextFireAt - 0.08) return true;
  e.nextFireAt = g.time + def.cooldown * 0.9;
  e.weapon = w;
  revealOnAttack(g, slot);
  g.emitAll({ t: 'melee', id: e.id, w, target: targetId });
  if (w === Weapon.ARM_WHIP) {
    // balayage : tous les ennemis dans l'arc, à portée
    const hits: Ent[] = [];
    g.near(e.x, e.z, p.reach + 0.8, (o) => {
      if (!isFoe(g, e, o) && o.id !== targetId) return;
      if (!o.alive || o.id === e.id || o.role === 'vehicle' || (o.slot === slot && o.role !== 'boss')) return;
      const d = Math.hypot(o.x - e.x, o.z - e.z);
      if (d > p.reach + 0.6 || Math.abs(o.y - e.y) > 2) return;
      const off = (Math.abs(angleDiff(e.yaw, Math.atan2(o.x - e.x, o.z - e.z))) * 180) / Math.PI;
      if (off > p.arc / 2 && d > 1.2) return;
      if (!g.los(e, o)) return;
      hits.push(o);
    });
    hits.sort((a, b) => Math.hypot(a.x - e.x, a.z - e.z) - Math.hypot(b.x - e.x, b.z - e.z));
    for (const o of hits.slice(0, 5)) {
      g.damage(o, p.dmg, e, false, undefined, undefined, undefined, 'melee');
      if (p.pull > 0 && o.alive) {
        const d = Math.hypot(o.x - e.x, o.z - e.z) || 1;
        stunAndKnock(g, e, o, 0.4, ((e.x - o.x) / d) * p.pull, 1.5, ((e.z - o.z) / d) * p.pull);
      }
    }
    const tip = { x: e.x + Math.sin(e.yaw) * p.reach, y: e.y + 1.2, z: e.z + Math.cos(e.yaw) * p.reach };
    emitAb(g, e, 'fouet', e.x, e.y + 1.35, e.z, tip, p.arc, hits.slice(0, 5).map((h) => h.id));
    return true;
  }
  const t = g.ents.get(targetId);
  if (!t || !t.alive || (t.slot === slot && t.role !== 'boss')) {
    c.chargeAt = 0;
    return true;
  }
  const d = Math.hypot(t.x - e.x, t.z - e.z);
  const reach = w === Weapon.ARM_BLADE ? p.reach : def.range;
  // la fente de la lame a amené le parrain au contact : tolérance un peu plus large
  if (d > reach + 1.1 || Math.abs(t.y - e.y) > 1.6) {
    c.chargeAt = 0;
    return true;
  }
  if (w === Weapon.ARM_BLADE) {
    // la part perçante ignore les protections du parrain adverse
    const pierce = p.pierce ?? 0;
    g.damage(t, p.dmg * (1 - pierce), e, false, undefined, undefined, undefined, 'melee');
    if (pierce > 0 && t.alive) g.damage(t, p.dmg * pierce, e, false, undefined, undefined, undefined, 'other');
    emitAb(g, e, 'lame', e.x, e.y + 1.3, e.z, { x: t.x, y: t.y + 1.2, z: t.z }, 0, [t.id]);
  } else {
    // poing hydraulique : coup chargé (temps mesuré par le serveur), projection, étourdissement
    const frac = c.chargeAt > 0 ? clamp((g.time - c.chargeAt) / FIST_CHARGE_TIME, 0, 1) : 0;
    c.chargeAt = 0;
    const mul = 1 + (p.charge ?? 0) * frac;
    g.damage(t, p.dmg * mul, e, false, undefined, undefined, undefined, 'melee');
    if (t.alive) {
      const k = p.knock * (1 + frac * 0.6);
      const dd = d || 1;
      stunAndKnock(g, e, t, p.stun ?? 0, ((t.x - e.x) / dd) * k, 2.5 + frac * 2, ((t.z - e.z) / dd) * k);
    }
    emitAb(g, e, 'poing', e.x, e.y + 1.3, e.z, { x: t.x, y: t.y + 1.2, z: t.z }, frac, [t.id]);
  }
  return true;
}

// ------------------------------------------------------------------------------ déplacements

/** Vitesse horizontale maximale tolérée pour le parrain (m/s), d'après ses implants. */
export function moveAllowance(g: Game, slot: Slot): number {
  const c = C(g, slot);
  const t = g.time;
  let v = 9.5;
  const sp = param(c, 'sprint', 'speed');
  if (sp > 0) v = Math.max(v, sp * 1.12 + 1);
  // glissade : la vitesse de sprint relancée
  v = Math.max(v, Math.max(SPRINT_SPEED, sp) * param(c, 'glissade', 'boost', 1.12) * 1.1 + 1);
  const wr = param(c, 'courseMurale', 'speed');
  if (wr > 0) v = Math.max(v, wr * 1.15 + 1);
  if (t < c.reflexUntil) v *= param(c, 'reflexes', 'speed', 1);
  if (c.burst && t < c.burst.until) v = Math.max(v, c.burst.speed);
  return v;
}

/**
 * Entrée de position du parrain : suivi des chutes (hauteur depuis le dernier appui), dégâts de
 * chute à la réception, atterrissage sismique et onde du poing hydraulique.
 */
export function bossInput(g: Game, slot: Slot, e: Ent, flags: number, anim: number): void {
  const c = C(g, slot);
  const air = (flags & INPUT_AIR) !== 0;
  const holding = anim === Anim.GRAPPLE || anim === Anim.WALLRUN_L || anim === Anim.WALLRUN_R || anim === Anim.CLIMB || (c.grapple !== null && g.time < c.grapple.until);
  if (holding || !Number.isFinite(c.airTop)) c.airTop = e.y;
  else if (air) c.airTop = Math.max(c.airTop, e.y);
  if (c.air && !air && !holding) {
    const drop = c.airTop - e.y;
    landed(g, slot, e, drop);
  }
  if (!air) c.airTop = e.y;
  c.air = air;
}

function landed(g: Game, slot: Slot, e: Ent, drop: number): void {
  const c = C(g, slot);
  if (drop <= 1.5) return;
  if (drop > 5 && g.time - c.landFxAt > 0.4) {
    c.landFxAt = g.time;
    emitAb(g, e, 'atterrissage', e.x, e.y, e.z, null, clamp((drop - 4) / 14, 0.2, 1));
  }
  // dégâts de chute
  const safe = param(c, 'amortisseurs', 'safe', SAFE_FALL);
  if (drop > safe) {
    let dmg = (drop - safe) * FALL_DMG_PER_M;
    if (param(c, 'vertebres', 'roll') > 0) dmg *= 0.5;
    g.damage(e, dmg, null, false, e.x, e.y + 0.3, e.z, 'fall');
    if (!e.alive) return;
  }
  // atterrissage sismique (amortisseurs) et onde du poing hydraulique
  const quake = param(c, 'amortisseurs', 'quake');
  let radius = 0;
  let dmg = 0;
  if (quake > 0 && drop > 6) {
    radius = quake;
    dmg = param(c, 'amortisseurs', 'quakeDmg');
  }
  const slam = c.armOut && c.equip[c.armOut] === 'poing' ? param(c, 'poing', 'slam') : 0;
  if (slam > 0 && drop >= 3) {
    radius = Math.max(radius, slam);
    dmg = Math.max(dmg, param(c, 'poing', 'dmg') * 0.8);
  }
  if (radius > 0) shockwave(g, e, radius, dmg, 9);
}

/** Onde de choc autour du parrain : dégâts décroissants, projection, étourdissement bref. */
function shockwave(g: Game, e: Ent, radius: number, dmg: number, force: number): void {
  const hits: number[] = [];
  g.near(e.x, e.z, radius + 1, (o) => {
    if (!isFoe(g, e, o)) return;
    const d = Math.hypot(o.x - e.x, o.z - e.z);
    if (d > radius || Math.abs(o.y - e.y) > 2.2) return;
    const k = 1 - d / radius;
    g.damage(o, dmg * Math.max(0.3, k), e, false, o.x, o.y + 0.5, o.z, 'explosion');
    if (o.alive) {
      const dd = d || 1;
      stunAndKnock(g, e, o, 0.6, ((o.x - e.x) / dd) * force * (0.5 + k), 3, ((o.z - e.z) / dd) * force * (0.5 + k));
    }
    hits.push(o.id);
  });
  emitAb(g, e, 'onde', e.x, e.y + 0.1, e.z, null, radius, hits);
}

// ------------------------------------------------------------------------------- capacités

/** Action « ab » d'un joueur : capacité d'un implant. */
export function abilityAction(g: Game, slot: Slot, act: AbAction): void {
  const f = g.factions[slot];
  const c = f.cyber;
  const e = g.ents.get(f.bossId);
  if (!e || !e.alive || f.vehicle >= 0) return;
  const t = g.time;
  const stunned = (e.stunUntil ?? 0) > t;
  switch (act.id) {
    // ---------------------------------------------------------------- déplacements
    case 'grappin':
      if (!stunned) grapple(g, slot, e, act);
      return;
    case 'grappin-fin': {
      if (!c.grapple) return;
      const a = c.grapple;
      c.grapple = null;
      const pull = param(c, 'grappin', 'pull') * param(c, 'treuil', 'pull', 1);
      c.burst = { speed: grappleMaxSpeed(pull) * 1.25 + 5, until: t + 3 };
      emitAb(g, e, 'grappin-fin', a.x, a.y, a.z);
      return;
    }
    case 'esquive': {
      const lv = level(c, 'esquive');
      if (lv <= 0 || stunned) return;
      const p = implantParams('esquive', lv);
      if (!p.air && c.air) return;
      const ch = c.charges.get('esquive');
      if (!ch) return;
      // tolérance : la prochaine charge est presque là
      if (ch.n < 1) {
        if (ch.next > 0 && ch.next - t < 0.25) {
          ch.n++;
          ch.next = ch.n < p.charges ? t + p.cd * cooldownMul(c) : 0;
        } else return;
      }
      ch.n--;
      if (ch.next <= t) ch.next = t + p.cd * cooldownMul(c);
      const speed = p.dist / DASH_TIME;
      c.burst = { speed: Math.max(speed * 1.3, c.burst && t < c.burst.until ? c.burst.speed : 0), until: t + 0.6 };
      const to = vec(act.p) ?? { x: e.x + Math.sin(e.yaw) * p.dist, y: e.y, z: e.z + Math.cos(e.yaw) * p.dist };
      emitAb(g, e, 'esquive', e.x, e.y + 0.9, e.z, to);
      return;
    }
    case 'bond': {
      const lv = level(c, 'bond');
      if (lv <= 0 || stunned || !ready(g, c, 'bond')) return;
      const p = implantParams('bond', lv);
      startCd(g, c, 'bond', p.cd);
      c.burst = { speed: Math.sqrt((p.dist * 22) / Math.sin(0.6)) + 3, until: t + 3 };
      const to = vec(act.p);
      emitAb(g, e, 'bond', e.x, e.y, e.z, to, clamp(act.v ?? 1, 0, 1));
      return;
    }
    case 'doubleSaut':
      if (level(c, 'doubleSaut') > 0) emitAb(g, e, 'doubleSaut', e.x, e.y, e.z);
      return;
    case 'sautMural':
    case 'glissade':
    case 'escalade': {
      const to = vec(act.p);
      emitAb(g, e, act.id, e.x, e.y, e.z, to);
      return;
    }
    // ---------------------------------------------------------------- bras
    case 'bras': {
      const sid = act.slot;
      if (sid !== 'brasG' && sid !== 'brasD') return;
      const id = c.equip[sid];
      if (!id || IMPLANT_ARM_WEAPON[id] === undefined) return;
      if (c.armOut === sid) {
        retractArm(g, slot);
        emitAb(g, e, 'bras-rentre', e.x, e.y + 1.3, e.z, null, sid === 'brasG' ? 0 : 1);
      } else {
        c.armOut = sid;
        if (id === 'pistoletBras' && c.armAmmo <= 0) c.armAmmo = implantParams('pistoletBras', level(c, id)).mag;
        emitAb(g, e, 'bras-sortie', e.x, e.y + 1.3, e.z, null, sid === 'brasG' ? 0 : 1);
      }
      return;
    }
    case 'poing-charge': {
      if (!armSlotOf(c, 'poing') || param(c, 'poing', 'charge') <= 0) return;
      if (act.on === false) c.chargeAt = 0;
      else if (c.chargeAt === 0) {
        c.chargeAt = t;
        emitAb(g, e, 'poing-charge', e.x, e.y + 1.3, e.z);
      }
      return;
    }
    case 'lame': {
      // fente : bond vers la cible (niveau 3 et plus)
      const lunge = param(c, 'lame', 'lunge');
      const tg = act.target !== undefined ? g.ents.get(act.target) : undefined;
      if (lunge <= 0 || !tg || !tg.alive || stunned || !ready(g, c, 'lame')) return;
      const d = Math.hypot(tg.x - e.x, tg.z - e.z);
      if (d > lunge + 1.5 || !g.los(e, tg)) return;
      startCd(g, c, 'lame', 2.5);
      c.burst = { speed: 34, until: t + 0.6 };
      emitAb(g, e, 'esquive', e.x, e.y + 0.9, e.z, { x: tg.x, y: tg.y + 0.9, z: tg.z });
      return;
    }
    case 'bouclier':
      shieldAction(g, slot, e, act.on !== false);
      return;
    case 'repulseur':
      if (!stunned) repulsor(g, slot, e, act);
      return;
    case 'choc':
      if (!stunned) teslaArc(g, slot, e, act);
      return;
    case 'roquettes':
      if (!stunned) fireRockets(g, slot, e, act);
      return;
    case 'outils':
      if (!stunned) toolArm(g, slot, e, act);
      return;
    // ---------------------------------------------------------------- capacités
    case 'surcharge': {
      const lv = level(c, 'surcharge');
      if (lv <= 0 || !ready(g, c, 'surcharge')) return;
      const p = implantParams('surcharge', lv);
      c.overUntil = t + p.dur;
      startCd(g, c, 'surcharge', p.cd);
      emitAb(g, e, 'surcharge', e.x, e.y + 1.2, e.z, null, p.dur);
      return;
    }
    case 'reflexes': {
      const lv = level(c, 'reflexes');
      if (lv <= 0 || !ready(g, c, 'reflexes')) return;
      const p = implantParams('reflexes', lv);
      c.reflexUntil = t + p.dur;
      startCd(g, c, 'reflexes', p.cd);
      emitAb(g, e, 'reflexes', e.x, e.y + 1.2, e.z, null, p.dur);
      return;
    }
    case 'camouflage': {
      const lv = level(c, 'camouflage');
      if (lv <= 0 || !ready(g, c, 'camouflage')) return;
      const p = implantParams('camouflage', lv);
      c.camoUntil = t + p.dur;
      c.camoKeep = p.keep > 0;
      c.camoOn = true;
      startCd(g, c, 'camouflage', p.cd);
      // les PNJ perdent la trace du parrain
      for (const o of g.ents.values()) if (o.ai && o.ai.target === e.id && Math.hypot(o.x - e.x, o.z - e.z) > 3) o.ai.target = -1;
      emitAb(g, e, 'camouflage', e.x, e.y + 1, e.z, null, p.dur);
      return;
    }
    case 'scanner': {
      const lv = level(c, 'scanner');
      if (lv <= 0 || !ready(g, c, 'scanner')) return;
      const p = implantParams('scanner', lv);
      c.scanUntil = t + p.dur;
      startCd(g, c, 'scanner', p.cd);
      emitAb(g, e, 'scanner', e.x, e.y + 1.5, e.z, null, p.range);
      // le parrain adverse sent l'impulsion passer
      const other = slot === 'dadou' ? 'even' : 'dadou';
      const ob = g.ents.get(g.factions[other].bossId);
      if (ob && ob.alive && Math.hypot(ob.x - e.x, ob.z - e.z) < p.range) g.notify(other, 'Une impulsion de scanner vous a balayé : votre position est révélée.', 'alert', 'scanned', 8);
      return;
    }
    case 'liaisonDrone':
      combatDrone(g, slot, e);
      return;
    case 'marque': {
      // marqueur de cibles : le client signale l'ennemi visé (vos hommes concentrent le feu)
      const lv = level(c, 'marqueur');
      const tg = act.target !== undefined ? g.ents.get(act.target) : undefined;
      if (lv <= 0 || !tg || !tg.alive || !isFoe(g, e, tg)) return;
      const p = implantParams('marqueur', lv);
      if (Math.hypot(tg.x - e.x, tg.z - e.z) > p.range + 5) return;
      c.marks.set(tg.id, t + 3 + p.persist);
      return;
    }
    default:
      return;
  }
}

// ------------------------------------------------------------------------------- grappin

function grapple(g: Game, slot: Slot, e: Ent, act: AbAction): void {
  const c = C(g, slot);
  const lv = level(c, 'grappin');
  if (lv <= 0 || !armSlotOf(c, 'grappin') || !ready(g, c, 'grappin')) return;
  const p = implantParams('grappin', lv);
  const range = p.range * param(c, 'treuil', 'range', 1);
  const pull = p.pull * param(c, 'treuil', 'pull', 1);
  // origine de la visée : la caméra (jusqu'à ~5 m derrière le parrain en vue à la 3e personne)
  const o = vec(act.o) ?? { x: e.x, y: e.y + 1.6, z: e.z };
  if (Math.hypot(o.x - e.x, o.y - (e.y + 1.6), o.z - e.z) > 6.5) return;
  const t = g.time;
  // treuil spinal : on attire l'ennemi visé
  if (act.target !== undefined && param(c, 'treuil', 'yank') > 0) {
    const tg = g.ents.get(act.target);
    if (!tg || !isFoe(g, e, tg) || tg.role === 'turret') return;
    const d = Math.hypot(tg.x - e.x, tg.z - e.z);
    if (d > range + 2 || !g.los(e, tg)) return;
    startCd(g, c, 'grappin', p.cd);
    const dd = d || 1;
    const k = Math.min(16, 4 + d * 0.8);
    stunAndKnock(g, e, tg, 0.8, ((e.x - tg.x) / dd) * k, 3.5, ((e.z - tg.z) / dd) * k);
    emitAb(g, e, 'treuil', o.x, o.y - 0.25, o.z, { x: tg.x, y: tg.y + 1.2, z: tg.z }, 0, [tg.id]);
    return;
  }
  const a = vec(act.p);
  if (!a) return;
  const dist = Math.hypot(a.x - o.x, a.y - o.y, a.z - o.z);
  if (dist > range + 2 || dist < 0.5) return;
  // rien ne doit couper le câble avant l'ancre, et l'ancre doit être contre une surface
  const w = g.w.city.world;
  const ux = (a.x - o.x) / dist;
  const uy = (a.y - o.y) / dist;
  const uz = (a.z - o.z) / dist;
  const hit = w.raycast(o.x, o.y, o.z, ux, uy, uz, dist + 0.6, undefined, 'solid');
  if (hit >= 0 && hit < dist - 1.2) return;
  if (hit < 0) {
    let solid = false;
    for (const [dx, dy, dz] of [[0.2, 0, 0], [-0.2, 0, 0], [0, 0.2, 0], [0, -0.2, 0], [0, 0, 0.2], [0, 0, -0.2]])
      if (w.solidAt(a.x + dx, a.y + dy, a.z + dz)) solid = true;
    if (!solid) return;
  }
  startCd(g, c, 'grappin', p.cd);
  c.grapple = { x: a.x, y: a.y, z: a.z, until: t + 7 };
  c.burst = { speed: grappleMaxSpeed(pull) * 1.25 + 5, until: t + 9 };
  emitAb(g, e, 'grappin', o.x, o.y - 0.25, o.z, a, dist / 80);
}

// -------------------------------------------------------------------------- bouclier, armes

function shieldAction(g: Game, slot: Slot, e: Ent, on: boolean): void {
  const c = C(g, slot);
  const lv = level(c, 'bouclier');
  if (lv <= 0 || !armSlotOf(c, 'bouclier')) return;
  if (!on) {
    if (c.shield) breakShield(g, slot, false);
    return;
  }
  if (c.shield || !ready(g, c, 'bouclier')) return;
  const p = implantParams('bouclier', lv);
  c.shield = { hp: p.absorb, until: g.time + p.dur, arc: p.arc };
  emitAb(g, e, 'bouclier', e.x, e.y + 1.2, e.z, null, p.arc);
}

/** Le bouclier tombe (brisé ou baissé) : la recharge commence. */
function breakShield(g: Game, slot: Slot, broken: boolean): void {
  const c = C(g, slot);
  if (!c.shield) return;
  c.shield = null;
  startCd(g, c, 'bouclier', param(c, 'bouclier', 'cd', 10) * (broken ? 1.25 : 1));
  const e = g.ents.get(g.factions[slot].bossId);
  if (e) emitAb(g, e, broken ? 'bouclier-brise' : 'bouclier-fin', e.x, e.y + 1.2, e.z);
}

/** Direction horizontale de visée (d) ou regard du parrain. */
function aimDir(e: Ent, act: AbAction): { x: number; y: number; z: number } {
  const d = vec(act.d);
  if (d) {
    const l = Math.hypot(d.x, d.y, d.z);
    if (l > 1e-3) return { x: d.x / l, y: d.y / l, z: d.z / l };
  }
  return { x: Math.sin(e.yaw) * Math.cos(e.pitch), y: Math.sin(e.pitch), z: Math.cos(e.yaw) * Math.cos(e.pitch) };
}

function repulsor(g: Game, slot: Slot, e: Ent, act: AbAction): void {
  const c = C(g, slot);
  const lv = level(c, 'repulseur');
  if (lv <= 0 || !armSlotOf(c, 'repulseur') || !ready(g, c, 'repulseur')) return;
  const p = implantParams('repulseur', lv);
  startCd(g, c, 'repulseur', p.cd);
  revealOnAttack(g, slot);
  const d = aimDir(e, act);
  const hl = Math.hypot(d.x, d.z) || 1;
  const hx = d.x / hl;
  const hz = d.z / hl;
  const yaw = Math.atan2(hx, hz);
  const hits: number[] = [];
  g.near(e.x, e.z, p.range + 1, (o) => {
    if (!isFoe(g, e, o)) return;
    const dist = Math.hypot(o.x - e.x, o.z - e.z);
    if (dist > p.range || Math.abs(o.y - e.y) > 2.5) return;
    const off = (Math.abs(angleDiff(yaw, Math.atan2(o.x - e.x, o.z - e.z))) * 180) / Math.PI;
    if (off > p.arc / 2 && dist > 1) return;
    if (!g.los(e, o)) return;
    const k = 1 - (dist / p.range) * 0.5;
    g.damage(o, p.dmg * k, e, false, o.x, o.y + 1, o.z, 'impact');
    if (o.alive) stunAndKnock(g, e, o, p.stun, hx * p.force * k, 4 * k, hz * p.force * k);
    hits.push(o.id);
  });
  // la déflagration souffle les vitres devant soi
  if (p.glass > 0) for (const s of [2.5, 5, p.range * 0.85]) g.shatter(e.x + hx * s, e.y + 1.3 + d.y * s, e.z + hz * s, 1.4);
  emitAb(g, e, 'repulseur', e.x + hx * 0.6, e.y + 1.3, e.z + hz * 0.6, { x: e.x + hx * p.range, y: e.y + 1.3 + d.y * p.range, z: e.z + hz * p.range }, p.arc, hits);
  g.recordShot(e.x, e.z);
}

function teslaArc(g: Game, slot: Slot, e: Ent, act: AbAction): void {
  const c = C(g, slot);
  const lv = level(c, 'choc');
  if (lv <= 0 || !armSlotOf(c, 'choc') || !ready(g, c, 'choc')) return;
  const p = implantParams('choc', lv);
  revealOnAttack(g, slot);
  const d = aimDir(e, act);
  const yaw = Math.atan2(d.x, d.z);
  // première cible : celle visée, sinon l'ennemi le plus proche devant soi
  let first: Ent | null = null;
  const tg = act.target !== undefined ? g.ents.get(act.target) : undefined;
  if (tg && isFoe(g, e, tg) && Math.hypot(tg.x - e.x, tg.z - e.z) <= p.range + 1 && g.los(e, tg)) first = tg;
  if (!first) {
    let best = Infinity;
    g.near(e.x, e.z, p.range, (o) => {
      if (!isFoe(g, e, o)) return;
      const dist = Math.hypot(o.x - e.x, o.z - e.z);
      const off = Math.abs(angleDiff(yaw, Math.atan2(o.x - e.x, o.z - e.z)));
      if (dist > p.range || off > 0.9 || Math.abs(o.y - e.y) > 3) return;
      const score = dist * (1 + off);
      if (score < best && g.los(e, o)) {
        best = score;
        first = o;
      }
    });
  }
  startCd(g, c, 'choc', first ? p.cd : p.cd * 0.3);
  const chain: Ent[] = [];
  let cur: Ent | null = first;
  while (cur && chain.length < p.chain) {
    chain.push(cur);
    const from: Ent = cur;
    let next: Ent | null = null;
    let nd = 6;
    g.near(from.x, from.z, 6, (o) => {
      if (!isFoe(g, e, o) || chain.includes(o)) return;
      const dist = Math.hypot(o.x - from.x, o.z - from.z);
      if (dist < nd && g.los(from, o)) {
        nd = dist;
        next = o;
      }
    });
    cur = next;
  }
  let dmg = p.dmg;
  for (const o of chain) {
    g.damage(o, dmg, e, false, o.x, o.y + 1.2, o.z, 'shock');
    if (o.alive) {
      o.fx |= CFX.SHOCK;
      stunAndKnock(g, e, o, o.role === 'turret' ? p.emp : 0.7, 0, 0, 0);
    }
    dmg *= 0.85;
  }
  // impulsion électromagnétique : caméras et tourelles des bâtiments touchés coupées
  const pts = [{ x: e.x, z: e.z }, ...chain.map((o) => ({ x: o.x, z: o.z }))];
  const done = new Set<number>();
  for (const pt of pts) {
    const bid = g.buildingAt(pt.x, pt.z);
    if (bid >= 0 && !done.has(bid)) {
      done.add(bid);
      if (empBuilding(g, bid, g.time + p.emp)) g.notify(slot, `Impulsion électromagnétique : sécurité coupée ${p.emp} s.`, 'good', `emp-${bid}`, 5);
    }
  }
  const end = first ? null : { x: e.x + d.x * p.range, y: e.y + 1.3 + d.y * p.range, z: e.z + d.z * p.range };
  emitAb(g, e, 'choc', e.x + d.x * 0.5, e.y + 1.35, e.z + d.z * 0.5, end, p.emp > 0 ? 1 : 0, chain.map((o) => o.id));
  g.recordShot(e.x, e.z);
}

function fireRockets(g: Game, slot: Slot, e: Ent, act: AbAction): void {
  const c = C(g, slot);
  const lv = level(c, 'roquettes');
  if (lv <= 0 || !armSlotOf(c, 'roquettes') || !ready(g, c, 'roquettes')) return;
  const p = implantParams('roquettes', lv);
  startCd(g, c, 'roquettes', p.cd);
  revealOnAttack(g, slot);
  const o = { x: e.x, y: e.y + 1.7, z: e.z };
  const d = aimDir(e, act);
  let aim = vec(act.p);
  const tg = act.target !== undefined ? g.ents.get(act.target) : undefined;
  const target = tg && tg.alive && isFoe(g, e, tg) ? tg : null;
  if (target) aim = { x: target.x, y: target.y + 1, z: target.z };
  if (!aim || Math.hypot(aim.x - o.x, aim.z - o.z) > 90) {
    const w = g.w.city.world;
    let dist = w.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 80);
    if (dist < 0) dist = 80;
    aim = { x: o.x + d.x * dist, y: o.y + d.y * dist, z: o.z + d.z * dist };
  }
  const list = rocketList(g);
  const dist = Math.hypot(aim.x - o.x, aim.y - o.y, aim.z - o.z);
  for (let i = 0; i < p.n; i++) {
    const spread = 0.8 + dist * 0.02;
    const a = { x: aim.x + g.rng.range(-spread, spread), y: aim.y + g.rng.range(-0.3, 0.5), z: aim.z + g.rng.range(-spread, spread) };
    const flight = Math.max(0.15, dist / ROCKET_SPEED) + i * 0.09;
    list.push({ slot, at: g.time + flight, x: a.x, y: a.y, z: a.z, target: target ? target.id : -1, homing: p.homing, dmg: p.dmg, radius: p.radius });
    emitAb(g, e, 'roquette', o.x, o.y, o.z, a, flight, target ? [target.id] : undefined);
  }
  g.recordShot(e.x, e.z);
  g.addHeat(slot, 0.4);
}

function explodeRocket(g: Game, r: Rocket): void {
  const f = g.factions[r.slot];
  const by = g.ents.get(f.bossId) ?? null;
  let { x, y, z } = r;
  // tête chercheuse : l'impact suit la cible
  const tg = r.target >= 0 ? g.ents.get(r.target) : undefined;
  if (tg && tg.alive) {
    x += (tg.x - x) * r.homing;
    y += (tg.y + 1 - y) * r.homing;
    z += (tg.z - z) * r.homing;
  }
  // le son de l'impact est joué par l'effet de la roquette chez chacun
  g.emitAll({ t: 'boom', x, y, z, r: r.radius });
  const world = g.w.city.world;
  const hits: Ent[] = [];
  g.near(x, z, r.radius + 2, (e) => {
    if (!e.alive || e.flags & FLAG.HIDDEN || e.faction === f.faction || e.invulnerable || e.role === 'barman') return;
    const d = Math.hypot(e.x - x, e.y + 0.9 - y, e.z - z);
    if (d > r.radius + (e.role === 'vehicle' ? 1.2 : 0)) return;
    if (d > 1.2 && !world.lineOfSight(x, y + 0.2, z, e.x, e.y + 0.9, e.z)) return;
    hits.push(e);
  });
  for (const e of hits) {
    const d = Math.hypot(e.x - x, e.y + 0.9 - y, e.z - z);
    g.damage(e, r.dmg * Math.max(0.25, 1 - d / r.radius), by, false, x, y, z, 'explosion');
  }
  g.shatter(x, y, z, r.radius * 0.8);
  g.recordShot(x, z);
}

/** Bras tactique : piratage à distance du terminal visé, ou coupure instantanée des caméras. */
function toolArm(g: Game, slot: Slot, e: Ent, act: AbAction): void {
  const c = C(g, slot);
  const lv = level(c, 'outils');
  if (lv <= 0 || !armSlotOf(c, 'outils') || !ready(g, c, 'outils')) return;
  const p = implantParams('outils', lv);
  const aim = vec(act.p);
  const reach = Math.max(2.6, p.remote);
  // terminal le plus proche du point visé (ou du parrain)
  const from = aim ?? { x: e.x, y: e.y + 1, z: e.z };
  let best = -1;
  let bd = 4;
  for (const b of g.w.buildings) {
    const tm = b.terminal;
    if (!tm) continue;
    const d = Math.hypot(tm.x - from.x, tm.z - from.z);
    if (d < bd && Math.hypot(tm.x - e.x, tm.z - e.z) <= reach + 0.5 && Math.abs((tm.y ?? 0) - e.y) < (p.remote > 0 ? 12 : 1.8)) {
      bd = d;
      best = b.id;
    }
  }
  if (best >= 0) {
    const tm = g.building(best).terminal!;
    if (p.remote > 0 && !g.w.city.world.lineOfSight(e.x, e.y + 1.5, e.z, tm.x, (tm.y ?? 0) + 1.1, tm.z) && Math.hypot(tm.x - e.x, tm.z - e.z) > 2.8) {
      g.notify(slot, 'Pas de ligne de vue sur le terminal.', 'info', 'tool-los', 3);
      return;
    }
    if (remoteHack(g, slot, best, reach)) {
      startCd(g, c, 'outils', 3);
      emitAb(g, e, 'piratage', e.x, e.y + 1.35, e.z, { x: tm.x, y: (tm.y ?? 0) + 1.1, z: tm.z }, 2);
    }
    return;
  }
  // coupure des caméras du bâtiment visé (niveau 4 et plus)
  if (p.cams > 0 && aim) {
    const bid = g.buildingAt(aim.x, aim.z);
    if (bid >= 0 && Math.hypot(aim.x - e.x, aim.z - e.z) <= reach + 2 && empBuilding(g, bid, g.time + 20)) {
      startCd(g, c, 'outils', 25);
      g.notify(slot, 'Caméras coupées pour 20 s.', 'good');
      emitAb(g, e, 'piratage', e.x, e.y + 1.35, e.z, aim, 0.8);
      return;
    }
  }
  g.notify(slot, p.remote > 0 ? `Aucun terminal à moins de ${p.remote} m dans votre visée.` : 'Approchez-vous d’un terminal de sécurité.', 'info', 'tool-none', 3);
}

/** Drone de combat (liaison neuronale) : il suit le parrain et tire sur ses ennemis. */
function combatDrone(g: Game, slot: Slot, e: Ent): void {
  const c = C(g, slot);
  const lv = level(c, 'liaisonDrone');
  if (lv <= 0 || !ready(g, c, 'liaisonDrone')) return;
  const p = implantParams('liaisonDrone', lv);
  const old = c.drone >= 0 ? g.ents.get(c.drone) : undefined;
  if (old && old.alive) {
    old.alive = false;
    old.removeAt = g.time;
  }
  startCd(g, c, 'liaisonDrone', p.cd);
  const f = g.factions[slot];
  const had = f.vehicles.get(7);
  const d = spawnVehicle(g, VEHICLES[7], e.x, e.y + 2.6, e.z, e.yaw, slot);
  if (had !== undefined) f.vehicles.set(7, had);
  else f.vehicles.delete(7);
  d.name = 'Drone de combat';
  d.maxHp = d.hp = 70;
  d.removeAt = g.time + p.dur;
  d.nextFireAt = g.time + 0.6;
  c.drone = d.id;
  g.emitAll({ t: 'spawn', e: g.info(d) });
  emitAb(g, e, 'drone', d.x, d.y, d.z, null, p.dur);
}

function updateDrone(g: Game, slot: Slot, dt: number): void {
  const c = C(g, slot);
  if (c.drone < 0) return;
  const d = g.ents.get(c.drone);
  const boss = g.ents.get(g.factions[slot].bossId);
  if (!d || !d.alive || !boss || !boss.alive || g.time >= d.removeAt) {
    if (d && d.alive) {
      d.alive = false;
      d.removeAt = g.time;
    }
    c.drone = -1;
    return;
  }
  const p = implantParams('liaisonDrone', Math.max(1, level(c, 'liaisonDrone')));
  // vol stationnaire au-dessus de l'épaule, en tournant doucement
  const a = g.time * 0.9;
  const tx = boss.x + Math.cos(a) * 1.6;
  const tz = boss.z + Math.sin(a) * 1.6;
  const ty = boss.y + 2.6;
  const k = Math.min(1, dt * 3);
  d.vx = (tx - d.x) * 3;
  d.vz = (tz - d.z) * 3;
  d.x += (tx - d.x) * k;
  d.y += (ty - d.y) * k;
  d.z += (tz - d.z) * k;
  // cible : l'ennemi le plus proche en vue
  let target: Ent | null = null;
  let best = 22;
  g.near(d.x, d.z, 22, (o) => {
    if (!isFoe(g, boss, o) || o.role === 'turret') return;
    if (o.role === 'police' && !o.ai?.aggro.has(boss.id)) return;
    const dist = Math.hypot(o.x - d.x, o.z - d.z);
    if (dist < best && g.w.city.world.lineOfSight(d.x, d.y, d.z, o.x, o.y + 1.2, o.z)) {
      best = dist;
      target = o;
    }
  });
  if (!target) return;
  const tg = target as Ent;
  d.yaw = Math.atan2(tg.x - d.x, tg.z - d.z);
  if (g.time < d.nextFireAt) return;
  d.nextFireAt = g.time + 0.42;
  const hit = g.rng.chance(clamp(0.85 - best * 0.02, 0.4, 0.85));
  if (hit) {
    g.damage(tg, p.dmg, boss, false, tg.x, tg.y + 1.2, tg.z, 'bullet');
    if (p.mark > 0) c.marks.set(tg.id, g.time + 4);
  }
  const ox = hit ? 0 : g.rng.range(-1, 1);
  g.emitAll({ t: 'shot', id: d.id, w: Weapon.SMG, fx: d.x, fy: d.y, fz: d.z, tx: tg.x + ox, ty: tg.y + 1.2, tz: tg.z + ox * 0.5, hit: hit ? tg.id : -1 });
  g.recordShot(d.x, d.z);
}

// --------------------------------------------------------------------------- pas de simulation

/** Effets dans la durée : recharges, bouclier, camouflage, nanobots, brûlures, projections… */
export function updateCyber(g: Game, dt: number): void {
  const t = g.time;
  for (const slot of ['dadou', 'even'] as Slot[]) {
    const f = g.factions[slot];
    const c = f.cyber;
    const boss = g.ents.get(f.bossId);
    // charges d'esquive
    const ch = c.charges.get('esquive');
    if (ch) {
      const max = param(c, 'esquive', 'charges');
      if (ch.n < max && ch.next > 0 && t >= ch.next) {
        ch.n++;
        ch.next = ch.n < max ? t + param(c, 'esquive', 'cd', 3) * cooldownMul(c) : 0;
      } else if (ch.n < max && ch.next === 0) ch.next = t + param(c, 'esquive', 'cd', 3) * cooldownMul(c);
    }
    if (c.shield && (t >= c.shield.until || !boss?.alive)) breakShield(g, slot, false);
    if (c.camoOn && t >= c.camoUntil) endCamo(g, slot);
    if (c.grapple && t >= c.grapple.until) c.grapple = null;
    if (c.chargeAt > 0 && t - c.chargeAt > 4) c.chargeAt = 0;
    for (const [id, until] of c.marks) if (until < t) c.marks.delete(id);
    // nanobots réparateurs
    if (boss && boss.alive && boss.hp < boss.maxHp) {
      const lv = level(c, 'nanobots');
      if (lv > 0) {
        const p = implantParams('nanobots', lv);
        const rate = t - c.hurtAt > p.delay ? p.regen : p.combat;
        if (rate > 0) boss.hp = Math.min(boss.maxHp, boss.hp + rate * dt);
      }
    }
    if (g.tick % 2 === 0) updateDrone(g, slot, dt * 2);
  }
  // micro-roquettes en vol
  const list = rocketList(g);
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].at > t) continue;
    const r = list[i];
    list.splice(i, 1);
    explodeRocket(g, r);
  }
  // brûlures, étourdissements, projections des PNJ
  for (const e of g.ents.values()) {
    if (!e.alive) {
      e.fx = 0;
      continue;
    }
    let fx = 0;
    if (e.burn) {
      if (t >= e.burn.until) e.burn = undefined;
      else {
        fx |= CFX.BURN;
        const by = g.ents.get(e.burn.by) ?? null;
        e.burnAcc = (e.burnAcc ?? 0) + e.burn.dps * dt;
        if (e.burnAcc >= 4) {
          const dmg = Math.floor(e.burnAcc);
          e.burnAcc -= dmg;
          g.damage(e, dmg, by, false, e.x, e.y + 1, e.z, 'burn');
          if (!e.alive) continue;
        }
      }
    }
    if (e.stunUntil !== undefined) {
      if (t >= e.stunUntil) e.stunUntil = undefined;
      else fx |= CFX.STUN;
    }
    if (e.fx & CFX.SHOCK && (e.stunUntil ?? 0) > t) fx |= CFX.SHOCK;
    if (e.knock) {
      if (t >= e.knock.until) e.knock = undefined;
      else knockMove(g, e, dt);
    }
    e.fx = fx;
  }
}

/** Projection d'un PNJ : il glisse tant que rien ne l'arrête. */
function knockMove(g: Game, e: Ent, dt: number): void {
  const k = e.knock!;
  const w = g.w.city.world;
  const nx = e.x + k.vx * dt;
  const nz = e.z + k.vz * dt;
  const free = (x: number, z: number) => !w.solidAt(x, e.y + 0.5, z) && !w.solidAt(x, e.y + 1.4, z);
  if (free(nx, nz)) {
    e.x = nx;
    e.z = nz;
    // on suit le sol (marches, trottoirs)
    const gy = g.w.nav.heightAt(nx, nz, e.y);
    if (Number.isFinite(gy) && Math.abs(gy - e.y) < 1.2) e.y = gy;
  } else {
    k.vx = 0;
    k.vz = 0;
  }
  const f = Math.exp(-dt * 5);
  k.vx *= f;
  k.vz *= f;
  if (e.ai) e.ai.repathAt = 0;
}

/** Mort ou réapparition du parrain : les états temporaires disparaissent. */
export function resetCyberTransient(g: Game, slot: Slot): void {
  const c = C(g, slot);
  c.shield = null;
  c.camoUntil = 0;
  c.camoOn = false;
  c.reflexUntil = 0;
  c.overUntil = 0;
  c.invUntil = 0;
  c.scanUntil = 0;
  c.grapple = null;
  c.burst = null;
  c.chargeAt = 0;
  c.air = false;
  c.airTop = -Infinity;
  if (c.armOut) retractArm(g, slot);
  const d = c.drone >= 0 ? g.ents.get(c.drone) : undefined;
  if (d && d.alive) {
    d.alive = false;
    d.removeAt = g.time;
  }
  c.drone = -1;
}

/** Bits visibles du parrain ajoutés par la simulation (charge du poing, sprint renforcé). */
export function bossFxExtra(g: Game, slot: Slot, e: Ent): number {
  const c = C(g, slot);
  let fx = 0;
  if (c.chargeAt > 0) fx |= CFX.CHARGE;
  if (level(c, 'sprint') > 0 && Math.hypot(e.vx, e.vz) > SPRINT_SPEED + 0.8 && e.anim === Anim.RUN) fx |= CFX.SPRINT;
  return fx;
}
