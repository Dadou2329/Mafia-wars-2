// Types internes de la simulation serveur.

import type { Anim, CharKind, Weapon } from '../../shared/characters';
import type { OrderType } from '../../shared/constants';
import type { Slot } from '../../shared/protocol';

export type Role = 'boss' | 'gangster' | 'lieutenant' | 'thug' | 'police' | 'guard' | 'barman';
export type Mode = 'pool' | 'escort' | 'squad' | 'guard' | 'patrol' | 'flee' | 'hold' | 'idle';

export interface Vec2 {
  x: number;
  z: number;
}

export interface AiState {
  role: Role;
  mode: Mode;
  /** Lieutenant de rattachement (escouade) ou -1. */
  squad: number;
  /** Poste à tenir (garde, réserve, défense). */
  post: Vec2 | null;
  /** Entité à suivre (escorte, escouade en mouvement) et rang dans la colonne. */
  follow: number;
  rank: number;
  /** Bâtiment d'attache (voyous, gardes) ou -1. */
  home: number;
  leash: number;
  // déplacement
  path: number[] | null;
  pathI: number;
  pathGoalX: number;
  pathGoalZ: number;
  repathAt: number;
  stuck: number;
  lastX: number;
  lastZ: number;
  run: boolean;
  // combat
  target: number;
  scanAt: number;
  accuracy: number;
  /** Agressions subies : id de l'agresseur → instant d'expiration. */
  aggro: Map<number, number>;
  /** Cible imposée par un ordre (« Attaquez ! »). */
  forcedTarget: number;
  patrol: Vec2[];
  patrolI: number;
  /** Instant jusqu'auquel l'IA attend avant de bouger (pause naturelle). */
  waitUntil: number;
  /** Instant de la dernière vue de la cible. */
  lastSeen: number;
}

export interface Ent {
  id: number;
  kind: CharKind;
  role: Role;
  faction: number;
  slot: Slot | null; // faction joueur (dadou/even) si applicable
  look: number;
  gang: number;
  name?: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vz: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  deadAt: number;
  anim: Anim;
  flags: number;
  weapon: Weapon;
  ammo: number;
  reloadUntil: number;
  nextFireAt: number;
  lastDamageAt: number;
  lastAttacker: number;
  /** Instant jusqu'auquel l'entité est « criminelle » pour la police. */
  criminalUntil: number;
  ai: AiState | null;
  /** Invulnérable (barman). */
  invulnerable?: boolean;
  /** Supprimer de la simulation à cet instant (cadavres, fuyards). */
  removeAt: number;
  /** Entités pour lesquelles les infos ont été envoyées. */
  custom?: Record<string, unknown>;
}

export interface Order {
  type: OrderType;
  target?: number | string;
  x?: number;
  z?: number;
  targetName: string;
  startedAt: number;
}

export type SquadState = 'idle' | 'assemble' | 'move' | 'assault' | 'hold' | 'patrol' | 'follow' | 'reinforce' | 'retreat' | 'down';

export interface Squad {
  id: number; // id d'entité du lieutenant
  slot: Slot;
  name: string;
  members: Set<number>;
  order: Order | null;
  state: SquadState;
  goal: Vec2 | null;
  goalBuilding: number;
  queue: number[];
  queueTotal: number;
  done: number;
  menStart: number;
  progress: number;
  status: string;
  downUntil: number;
  stateSince: number;
  patrolPts: Vec2[];
  patrolI: number;
  lostNotified: number;
  reinfNotified: boolean;
  lastCombat: number;
}

export interface FactionState {
  slot: Slot;
  faction: number;
  bossId: number;
  money: number;
  earned: number;
  income: number;
  upgrades: Set<string>;
  weapons: Set<Weapon>;
  ammo: Map<Weapon, number>;
  lieutenants: number[];
  ltNames: string[];
  heat: number;
  heatSeenAt: number;
  respawnAt: number;
  tp: number;
  tpAt: number;
  lastInputAt: number;
  connected: boolean;
  kills: number;
  deaths: number;
  captured: number;
  lost: number;
  recruited: number;
  guardRespawnAt: number;
  spotted: { x: number; z: number; n: number }[];
  /** Anti-spam des notifications : clé → instant. */
  notifyAt: Map<string, number>;
  custom: Record<string, unknown>;
}

export interface BState {
  id: number;
  owner: number;
  progress: number;
  capBy: number;
  contested: boolean;
  /** Voyous d'origine (bâtiments neutres). */
  thugs: Set<number>;
  alertAt: number;
  attackers: number;
}
