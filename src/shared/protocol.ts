// Protocole réseau entre le client et le serveur (Socket.IO).

import type { Anim, CharKind, Weapon } from './characters';
import type { BossId, DistrictId } from './city/plan';
import type { OrderType } from './constants';

export type Slot = BossId;

export interface LobbyPlayer {
  connected: boolean;
  ready: boolean;
  name: string;
}

export interface MatchSettings {
  /** Durée maximale en minutes (0 = illimitée). */
  timeLimit: number;
  /** 'cycle' (jour/nuit), 'night' (nuit permanente), 'dusk' (crépuscule permanent). */
  daytime: 'cycle' | 'night' | 'dusk';
  /** Commencer par la mission d'introduction. */
  tutorial: boolean;
}

export interface RoomState {
  code: string;
  phase: 'lobby' | 'playing' | 'ended';
  /** Joueur ayant créé la partie (peut la lancer). */
  host: string | null; // id de session
  players: Record<string, { slot: Slot | null; name: string; connected: boolean; ready: boolean; isHost: boolean }>;
  picks: Record<Slot, string | null>; // session qui joue ce parrain
  settings: MatchSettings;
}

/** Description complète d'une entité (envoyée une fois). */
export interface EntityInfo {
  id: number;
  kind: CharKind;
  faction: number;
  look: number;
  gang: number;
  name?: string;
  maxHp: number;
  /** Lieutenant associé (gangsters d'escouade) ou -1. */
  squad?: number;
  custom?: Record<string, unknown>;
}

export interface BuildingPub {
  id: number;
  owner: number; // Faction
  /** Progression de capture 0..1 et faction qui capture (0 = aucune). */
  cap: number;
  capBy: number;
  contested: boolean;
  /** Nombre de défenseurs visibles (pour la carte, approximatif). */
  guards: number;
}

export interface DistrictPub {
  id: DistrictId;
  owner: number;
}

export interface PublicState {
  buildings: BuildingPub[];
  districts: DistrictPub[];
  territories: Record<Slot, number>;
  /** Temps de jeu écoulé (s). */
  elapsed: number;
  timeLeft: number; // s, -1 si illimité
  dayTime: number; // 0..1
  battles: { x: number; z: number; intensity: number }[];
  /** Événement aléatoire public en cours (cargaison, descente de police, brouillard). */
  event?: { kind: string; x: number; z: number; until: number } | null;
}

export interface LieutenantStatus {
  id: number; // id d'entité
  name: string;
  alive: boolean;
  recoverIn: number; // s restants avant de revenir (si blessé)
  men: number; // hommes assignés vivants
  menStart: number; // effectif au lancement de l'ordre
  order: OrderType | null;
  targetName: string;
  state: string; // texte d'état en français
  progress: number; // 0..1
  x: number;
  z: number;
}

export interface PrivateState {
  money: number;
  income: number; // £/min
  men: number; // gangsters vivants
  pool: number; // gangsters libres au QG
  escort: number; // gangsters qui suivent le parrain
  maxMen: number;
  lieutenants: LieutenantStatus[];
  upgrades: string[];
  weapons: Weapon[];
  ammo: Record<number, number>;
  wanted: number; // 0..5
  dead: boolean;
  respawnIn: number;
  tp: number; // compteur de téléportation
  kills: number;
  deaths: number;
  captured: number;
  nextLtPrice: number;
  /** Ennemis repérés (positions approximatives pour la carte). */
  spotted: { x: number; z: number; n: number }[];
}

// ---------------------------------------------------------------------------- événements

export type GameEvent =
  | { t: 'shot'; id: number; w: Weapon; fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; hit: number }
  | { t: 'melee'; id: number; w: Weapon; target: number }
  | { t: 'hit'; id: number; by: number; dmg: number; x: number; y: number; z: number; head?: boolean }
  | { t: 'death'; id: number; by: number }
  | { t: 'spawn'; e: EntityInfo }
  | { t: 'despawn'; id: number }
  | { t: 'reload'; id: number }
  | { t: 'notify'; text: string; kind: 'info' | 'good' | 'bad' | 'alert' | 'money'; to?: Slot }
  | { t: 'capture'; b: number; owner: number; prev: number }
  | { t: 'district'; d: DistrictId; owner: number; prev: number }
  | { t: 'chat'; from: Slot | 'system'; text: string }
  | { t: 'news'; title: string; body: string }
  | { t: 'tp'; x: number; y: number; z: number; yaw: number }
  | { t: 'respawned' }
  | { t: 'killfeed'; killer: string; victim: string; kf: number; vf: number }
  | { t: 'order'; lt: number; ok: boolean; text: string }
  | { t: 'wanted'; level: number }
  | { t: 'over'; winner: Slot | null; reason: string; stats: Record<Slot, MatchStats> }
  | { t: 'sound'; s: string; x: number; y: number; z: number }
  | { t: 'event'; kind: string; text: string; x: number; z: number; until: number };

export interface MatchStats {
  kills: number;
  deaths: number;
  captured: number;
  lost: number;
  territories: number;
  recruited: number;
  earned: number;
  buildings: number;
}

// ---------------------------------------------------------------------------- actions client

export type ClientAction =
  | { a: 'recruit'; n: number }
  | { a: 'hire' }
  | { a: 'assign'; lt: number; men: number }
  | { a: 'order'; lt: number; order: OrderType; target?: number | string; x?: number; z?: number; men?: number }
  | { a: 'cancel'; lt: number }
  | { a: 'upgrade'; id: string }
  | { a: 'buyWeapon'; w: Weapon }
  | { a: 'buyAmmo' }
  | { a: 'buyBuilding'; b: number }
  | { a: 'quick'; cmd: 'follow' | 'attack' | 'defend' | 'retreat'; target?: number; building?: number; x?: number; z?: number }
  | { a: 'customize'; custom: Record<string, unknown> }
  | { a: 'interact'; what: string }
  | { a: 'rematch' }
  /** Outil de test : téléportation (serveur lancé avec MW_DEBUG=1 uniquement). */
  | { a: 'debugTp'; x: number; z: number; yaw?: number; dayTime?: number }
  /** Outil de test : termine la partie (serveur lancé avec MW_DEBUG=1 uniquement). */
  | { a: 'debugEnd' };

// ---------------------------------------------------------------------------- instantanés binaires

/** Enregistrement d'une entité dans un instantané. */
export interface SnapEntity {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vz: number;
  anim: Anim;
  flags: number;
  weapon: Weapon;
  hp: number; // 0..1
}

export const SNAP_HEADER = 12;
export const SNAP_REC = 16;

export function encodeSnapshot(time: number, tick: number, ents: SnapEntity[]): ArrayBuffer {
  const buf = new ArrayBuffer(SNAP_HEADER + ents.length * SNAP_REC);
  const dv = new DataView(buf);
  dv.setFloat64(0, time, true);
  dv.setUint16(8, tick & 0xffff, true);
  dv.setUint16(10, ents.length, true);
  let o = SNAP_HEADER;
  for (const e of ents) {
    dv.setUint16(o, e.id, true);
    dv.setUint16(o + 2, Math.max(0, Math.min(65535, Math.round(e.x * 64))), true);
    dv.setUint16(o + 4, Math.max(0, Math.min(65535, Math.round(e.z * 64))), true);
    dv.setInt16(o + 6, Math.max(-32768, Math.min(32767, Math.round(e.y * 256))), true);
    let yaw = e.yaw % (Math.PI * 2);
    if (yaw < 0) yaw += Math.PI * 2;
    dv.setUint8(o + 8, Math.round((yaw / (Math.PI * 2)) * 256) & 255);
    dv.setInt8(o + 9, Math.max(-127, Math.min(127, Math.round((e.pitch / (Math.PI / 2)) * 127))));
    dv.setInt8(o + 10, Math.max(-127, Math.min(127, Math.round(e.vx * 16))));
    dv.setInt8(o + 11, Math.max(-127, Math.min(127, Math.round(e.vz * 16))));
    dv.setUint8(o + 12, e.anim);
    dv.setUint8(o + 13, e.flags);
    dv.setUint8(o + 14, e.weapon);
    dv.setUint8(o + 15, Math.max(0, Math.min(255, Math.round(e.hp * 255))));
    o += SNAP_REC;
  }
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): { time: number; tick: number; ents: SnapEntity[] } {
  const dv = new DataView(buf);
  const time = dv.getFloat64(0, true);
  const tick = dv.getUint16(8, true);
  const n = dv.getUint16(10, true);
  const ents: SnapEntity[] = new Array(n);
  let o = SNAP_HEADER;
  for (let i = 0; i < n; i++) {
    ents[i] = {
      id: dv.getUint16(o, true),
      x: dv.getUint16(o + 2, true) / 64,
      z: dv.getUint16(o + 4, true) / 64,
      y: dv.getInt16(o + 6, true) / 256,
      yaw: (dv.getUint8(o + 8) / 256) * Math.PI * 2,
      pitch: (dv.getInt8(o + 9) / 127) * (Math.PI / 2),
      vx: dv.getInt8(o + 10) / 16,
      vz: dv.getInt8(o + 11) / 16,
      anim: dv.getUint8(o + 12) as Anim,
      flags: dv.getUint8(o + 13),
      weapon: dv.getUint8(o + 14) as Weapon,
      hp: dv.getUint8(o + 15) / 255,
    };
    o += SNAP_REC;
  }
  return { time, tick, ents };
}

/** État envoyé par le client pour son parrain (20 Hz). */
export type PlayerInput = [
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  vx: number,
  vz: number,
  anim: number,
  flags: number,
  weapon: number,
  tp: number,
];

export const BOSS_ENTITY_ID: Record<Slot, number> = { dadou: 1, even: 2 };
