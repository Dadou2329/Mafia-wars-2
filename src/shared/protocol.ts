// Protocole réseau entre le client et le serveur (Socket.IO).

import type { Anim, CharKind, Weapon } from './characters';
import type { BossId, DistrictId } from './city/plan';
import type { OrderType } from './constants';
import type { Equipment, SlotId } from './implants';

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
  /** Météo : 'variable' (pluie de temps en temps), 'rain' (pluie permanente), 'clear' (temps sec). */
  weather: 'variable' | 'rain' | 'clear';
  /** Conseils contextuels pour débuter (aucune quête). */
  tips: boolean;
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
  /** Implants visibles (parrains) : « emplacement=identifiant:niveau » (voir implants.ts). */
  cyber?: string[];
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
  /** QG actuel et palier de chaque parrain. */
  hq: Record<Slot, number>;
  tier: Record<Slot, number>;
  /** Pluie : 0 (sec) à 1. */
  rain: number;
  /** Véhicules occupés : [id du véhicule, id du conducteur]. */
  rides: [number, number][];
  /** Bâtiments dont la sécurité est piratée (caméras et tourelles coupées). */
  hacked: number[];
  /** Braquages en cours : bâtiment, parrain, progression 0..1. */
  heists: { b: number; slot: Slot; p: number }[];
  /** Convois blindés en route (camion, propriétaire, position, butin) et butins à ramasser. */
  convoys: { id: number; slot: Slot | null; x: number; z: number; reward: number; dest: string; p: number }[];
  loot: { x: number; z: number; reward: number }[];
  /** Équipements visibles du QG de chaque parrain (voir server/game/hq.ts) : le rival les voit s'il s'y introduit. */
  hqUpg?: Record<Slot, string[]>;
  /** Trophées exposés dans le QG de chaque parrain (salle des trophées). */
  hqTrophies?: Record<Slot, number>;
  /** Opérations de prise de contrôle en cours (voir shared/conquest.ts). */
  ops?: OpPub[];
}

/** Opération de prise de contrôle en cours (état public : tout est reconstruit à la reconnexion). */
export interface OpPub {
  /** Bâtiment visé. */
  b: number;
  /** Parrain qui mène l'opération. */
  slot: Slot;
  /** Étape en cours (index) et nombre d'étapes. */
  step: number;
  n: number;
  /** Progression de l'étape en cours (0..1). */
  p: number;
  /** Vitesse actuelle (/s, négative quand l'étape se perd) : interpolation côté client. */
  rate: number;
  contested: boolean;
  /** Opérateurs à l'œuvre : 1 = le parrain, 2 = un lieutenant (bits). */
  by: number;
  /** Nom du lieutenant à l'œuvre. */
  lt?: string;
  /** Auteurs des étapes accomplies (« Dadou », « Vinnie Moretti »). */
  who: string[];
  /** Porteur de l'objet emporté (id d'entité). */
  carrier?: number;
  /** Objet tombé (porteur abattu) : position [x, y, z]. */
  drop?: [number, number, number];
  /** Reprise de l'étape précédente par le propriétaire (0..1) et qui la mène (bits). */
  undo?: number;
  undoBy?: number;
  /** QG imprenable pour l'instant (quartiers insuffisants). */
  locked?: boolean;
  /** Défenseurs du gang encore debout : la dernière étape attend qu'ils soient éliminés. */
  gang?: number;
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
  income: number; // $/min
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
  maxLt: number;
  /** Palier du logement (1 planque … 5 tour) et bâtiment du QG actuel. */
  tier: number;
  hq: number;
  /** Véhicules possédés (identifiants de VehicleDef) et véhicule conduit (id d'entité, −1 à pied). */
  garage: number[];
  vehicle: number;
  /** Délai avant de pouvoir se faire livrer un véhicule (s). */
  callIn: number;
  /** Drone : délai avant le prochain lancement (s), quartier survolé. */
  droneIn: number;
  grenades: number;
  droneOver: DistrictId | null;
  /** Piratage en cours (bâtiment, progression 0..1). */
  hack: { b: number; p: number } | null;
  /** Délai avant de pouvoir envoyer un convoi (s). */
  convoyIn: number;
  /** Ennemis repérés (positions approximatives pour la carte). */
  spotted: { x: number; z: number; n: number }[];
  /** Implants cybernétiques. */
  cyber: CyberState;
  /** Équipements du QG (informations réservées à leur propriétaire), voir server/game/hq.ts. */
  hqUp?: HqPrivate;
}

/** Informations des équipements du QG (état privé). */
export interface HqPrivate {
  /** Carte holographique : garnisons exactes [bâtiment, défenseurs] et lieutenants du rival près de votre territoire. */
  garrisons?: [number, number][];
  rivalOps?: { name: string; x: number; z: number; order: string; target: string; b?: number; p?: number }[];
  /** Surveillance, drone de patrouille, rapports des lieutenants : ennemis repérés près d'un de vos sites. */
  watch?: { site: string; x: number; z: number; n: number }[];
  /** Centre d'opérations : opérations de vos lieutenants (bâtiment visé, progression 0..1, temps restant estimé en s). */
  ops?: { lt: number; name: string; b: number; p: number; eta: number }[];
  /** Recrues engagées par le terminal de recrutement. */
  recruits?: number;
  /** Salle des trophées : trophées (bâtiments clés, quartiers) et bonus de prestige ($/min). */
  trophies?: { kind: 'key' | 'district'; name: string }[];
  prestige?: number;
  /** Armurerie avancée : remise sur les armes (coefficient), prix des munitions, grenades en poche au maximum. */
  armory?: { weaponMul: number; ammo: number; grenadeMax: number };
  /** Drone de patrouille en vol au-dessus du QG. */
  patrol?: boolean;
}

/** Implants d'un parrain (état privé). */
export interface CyberState {
  /** Implants possédés et leur niveau (1 à n). */
  owned: Record<string, number>;
  /** Implant installé dans chaque emplacement. */
  equip: Equipment;
  /** Configurations enregistrées (null : vide). */
  loadouts: (Equipment | null)[];
  /** Recharge restante des capacités (s), par implant. */
  cd: Record<string, number>;
  /** Charges disponibles (esquive…), par implant. */
  charges: Record<string, number>;
  /** Le parrain est à une clinique ou à une station cybernétique (installation possible). */
  station: string | null;
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
  | { t: 'event'; kind: string; text: string; x: number; z: number; until: number }
  /** Un parrain emménage dans un nouveau QG. */
  | { t: 'hq'; slot: Slot; b: number; tier: number }
  /** Quelqu'un monte dans un véhicule ou en descend (driver = −1). */
  | { t: 'ride'; id: number; driver: number }
  /** Explosion (véhicule détruit…). */
  | { t: 'boom'; x: number; y: number; z: number; r: number }
  | { t: 'glass'; x: number; y: number; z: number; r: number }
  | { t: 'grenade'; id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  /** Implants visibles d'un personnage modifiés (installation, retrait). */
  | { t: 'cyber'; id: number; cyber: string[] }
  /**
   * Capacité cybernétique déclenchée (effets visuels et sonores chez tous) : ab = identifiant de
   * l'implant ou de l'effet ('grappin', 'grappin-fin', 'esquive', 'doubleSaut', 'repulseur',
   * 'choc', 'roquette', 'onde'…), (x, y, z) origine, (x2, y2, z2) cible ou direction, v valeur.
   */
  | { t: 'ab'; id: number; ab: string; x: number; y: number; z: number; x2?: number; y2?: number; z2?: number; v?: number; targets?: number[] }
  /**
   * Opération de prise de contrôle (effets et alertes) : lancée, étape réussie, étape reprise par
   * le propriétaire, objet tombé / ramassé / rendu, alarme (piratage raté), échec. step = étape.
   */
  | { t: 'op'; b: number; slot: Slot; ev: 'start' | 'step' | 'undo' | 'drop' | 'pickup' | 'return' | 'alarm' | 'fail'; step: number; x?: number; y?: number; z?: number };

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
  | { a: 'buyGrenade' }
  | { a: 'grenade'; o: number[]; d: number[] }
  | { a: 'buyBuilding'; b: number }
  /** Emménager dans le logement suivant de l'échelle (le QG s'y installe). */
  | { a: 'moveIn'; b: number }
  /** Taxi volant : retour au QG (hors combat, sans police aux trousses). */
  | { a: 'goHome' }
  /** Véhicules : monter (id d'entité), descendre, se faire livrer ou acheter (v = VehicleDef). */
  | { a: 'vehicle'; op: 'enter' | 'exit' | 'call' | 'buy'; id?: number; v?: number }
  /** Drone de reconnaissance au-dessus d'un quartier. */
  | { a: 'drone'; d: DistrictId }
  /** Pirater le terminal de sécurité d'un bâtiment, braquer son coffre. */
  | { a: 'hack'; b: number }
  | { a: 'heist'; b: number }
  /** Envoyer un convoi depuis un bâtiment logistique vers le QG. */
  | { a: 'convoy' }
  | { a: 'quick'; cmd: 'follow' | 'attack' | 'defend' | 'retreat'; target?: number; building?: number; x?: number; z?: number }
  | { a: 'customize'; custom: Record<string, unknown> }
  /**
   * Implants : acheter (id), améliorer (id), installer (id dans slot), retirer (slot),
   * enregistrer la configuration courante (n), appliquer une configuration (n). L'installation
   * et les configurations exigent une clinique ou la station cybernétique du QG.
   */
  | { a: 'cyber'; op: 'buy' | 'upgrade' | 'equip' | 'unequip' | 'save' | 'load'; id?: string; slot?: SlotId; n?: number }
  /**
   * Capacité cybernétique : id de l'implant, o origine (œil), d direction de visée,
   * p point visé (grappin), target entité visée, on (bouclier maintenu, visions).
   */
  | { a: 'ab'; id: string; o?: number[]; d?: number[]; p?: number[]; target?: number; on?: boolean; slot?: SlotId; v?: number }
  /**
   * Prise de contrôle : le parrain mène l'objectif k du bâtiment b (ou le reprend s'il est à lui),
   * en restant sur place ; k vide : il arrête. ok : issue du piratage interactif (true réussi,
   * false raté → alarme).
   */
  | { a: 'op'; b: number; k: string; ok?: boolean }
  | { a: 'interact'; what: string }
  | { a: 'rematch' }
  /** Outil de test : téléportation (serveur lancé avec MW_DEBUG=1 uniquement). */
  | { a: 'debugTp'; x: number; z: number; y?: number; yaw?: number; dayTime?: number; rain?: number }
  /** Outil de test : ajoute de l'argent (serveur lancé avec MW_DEBUG=1 uniquement). */
  | { a: 'debugMoney'; n: number }
  /** Outil de test : installe un implant au niveau voulu (serveur lancé avec MW_DEBUG=1 uniquement). */
  | { a: 'debugCyber'; id: string; lv: number; slot: SlotId }
  /** Outil de test : termine la partie (serveur lancé avec MW_DEBUG=1 uniquement). */
  | { a: 'debugEnd' }
  /** Outil de test : élimine les défenseurs (voyous, tourelles) d'un bâtiment (MW_DEBUG=1 uniquement). */
  | { a: 'debugClear'; b: number };

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
  /** États cybernétiques visibles (bits CFX, voir implants.ts). */
  fx: number;
}

export const SNAP_HEADER = 12;
export const SNAP_REC = 18;

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
    dv.setInt8(o + 10, Math.max(-127, Math.min(127, Math.round(e.vx * 4))));
    dv.setInt8(o + 11, Math.max(-127, Math.min(127, Math.round(e.vz * 4))));
    dv.setUint8(o + 12, e.anim);
    dv.setUint8(o + 13, e.flags);
    dv.setUint8(o + 14, e.weapon);
    dv.setUint8(o + 15, Math.max(0, Math.min(255, Math.round(e.hp * 255))));
    dv.setUint16(o + 16, e.fx & 0xffff, true);
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
      vx: dv.getInt8(o + 10) / 4,
      vz: dv.getInt8(o + 11) / 4,
      anim: dv.getUint8(o + 12) as Anim,
      flags: dv.getUint8(o + 13),
      weapon: dv.getUint8(o + 14) as Weapon,
      hp: dv.getUint8(o + 15) / 255,
      fx: dv.getUint16(o + 16, true),
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
