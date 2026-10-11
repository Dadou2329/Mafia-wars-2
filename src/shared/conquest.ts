// Prise de contrôle des bâtiments : opérations par objectifs, partagées par le serveur (règles)
// et le client (interface). Chaque bâtiment capturable a une opération en quelques étapes,
// menées sur place (pirater le serveur, forcer la chambre forte, prendre le bureau…), dont la
// complexité suit l'importance du bâtiment : un objectif court pour les petits commerces, deux à
// trois étapes pour les bâtiments clés, l'assaut le plus long pour le QG d'un parrain.
// Aucune quête : ce sont des lieux réels du bâtiment (ancres BuildingInfo.ops, générées avec la
// ville), que les lieutenants et le parrain vont tenir physiquement.
//
// Équilibre : les jumeaux nord/sud du plan partagent les mêmes règles (clé, revenus, sécurité) ;
// le niveau de l'opération (donc son budget de temps total) n'en dépend que, quel que soit le
// type du bâtiment. Le type ne change que la mise en scène des étapes.

import type { BuildingDef, BuildingType } from './city/plan';
import type { BuildingInfo, OpAnchor } from './city/gen/context';
import type { OpPub } from './protocol';

export type { OpPub };

/**
 * Nature d'une étape :
 * hack/minigame (pirater ; le parrain joue un court piratage interactif pour « minigame »),
 * crack (forcer une porte blindée, un coffre), override (prendre une console de contrôle),
 * hold (tenir une pièce), seize (prendre un bureau, un registre), secure (récupérer un document,
 * qu'il faut ensuite emporter), deliver (déposer le document), sabotage, climb (sommet d'une tour).
 */
export type OpKind = 'hack' | 'minigame' | 'crack' | 'override' | 'hold' | 'seize' | 'secure' | 'deliver' | 'sabotage' | 'climb';

/** Importance du bâtiment : petit commerce, bâtiment ordinaire, clé, clé majeur, QG d'un parrain. */
export type OpLevel = 'small' | 'standard' | 'key' | 'major' | 'hq';

export interface OpStepDef {
  /** Ancre de l'objectif (BuildingInfo.ops). */
  key: string;
  kind: OpKind;
  /** Invite et liste des étapes (infinitif) : « Pirater le serveur ». */
  label: string;
  /** Rapport d'un lieutenant (3e personne) : « Pirate le serveur ». */
  doing: string;
  /** Le lieu : « Se dirige vers le serveur central », alertes. */
  place: string;
  /** Le propriétaire reprend l'étape : « Rétablir le serveur » (absent : impossible par l'ancre). */
  undo?: string;
  /** Objet emporté après l'étape (secure) : « l’acte de propriété ». */
  item?: string;
  /** Qui peut mener l'étape (par défaut : le parrain comme ses lieutenants). */
  who?: 'any' | 'boss' | 'lt';
}

export interface OpStep extends OpStepDef {
  /** Temps de travail (s) pour un opérateur seul. */
  time: number;
  anchor: OpAnchor;
}

export interface OpPlan {
  level: OpLevel;
  steps: OpStep[];
  /** Somme des temps de travail (s). */
  total: number;
}

/** Budget de temps de travail d'une opération selon l'importance du bâtiment (s, un opérateur seul). */
export const OP_BUDGET: Record<OpLevel, number> = { small: 7, standard: 14, key: 28, major: 42, hq: 60 };

export const OP_LEVEL_NAME: Record<OpLevel, string> = {
  small: 'petit commerce',
  standard: 'bâtiment',
  key: 'bâtiment clé',
  major: 'bâtiment clé majeur',
  hq: 'quartier général',
};

/** Rayon de travail (m) : à côté de l'objectif ; plus large pour tenir une pièce. */
export const OP_WORK_RADIUS = 2.4;
export const OP_HOLD_RADIUS = 4;
/** Un ennemi à moins de 7 m de l'objectif (même étage, en vue) le conteste. */
export const OP_CONTEST_RADIUS = 7;
/** Sans personne à l'œuvre, l'étape en cours se perd lentement (fraction par seconde). */
export const OP_DECAY = 0.012;
/** L'opération est abandonnée après 2 min sans aucun homme de l'attaquant sur place. */
export const OP_ABANDON = 120;
/** … ou 15 s si un troisième larron (l'autre parrain) occupe les lieux d'un bâtiment neutre. */
export const OP_RIVAL_TAKEOVER = 15;
/** Le parrain et un lieutenant ensemble : progression ×1,6. */
export const OP_BOTH_MUL = 1.6;
/** Reprendre une étape volée prend la moitié du temps (4 s au moins). */
export const OP_UNDO_FACTOR = 0.5;
export const OP_UNDO_MIN = 4;
/** Piratage interactif : durée minimale admise par le serveur, durée maximale de l'épreuve (s). */
export const OP_MINIGAME_MIN = 1.5;
export const OP_MINIGAME_MAX = 10;
/** Un objet tombé (porteur abattu) revient au coffre au bout de 45 s. */
export const OP_DROP_RETURN = 45;
/** Distance de ramassage d'un objet tombé (m). */
export const OP_PICKUP_RADIUS = 1.6;

/** Poids des étapes dans le budget (forcer un coffre est long, récupérer un document est court). */
const KIND_WEIGHT: Record<OpKind, number> = {
  hack: 1,
  minigame: 1,
  crack: 1.3,
  override: 1,
  hold: 1,
  seize: 1,
  secure: 0.45,
  deliver: 0.3,
  sabotage: 1,
  climb: 0.8,
};

/** Étape de piratage (bras tactique « outils » : plus rapide, à distance). */
export function isHackKind(k: OpKind): boolean {
  return k === 'hack' || k === 'minigame' || k === 'override';
}

/** Porte blindée, coffre (poing hydraulique, bras tactique : bien plus vite). */
export function isDoorKind(k: OpKind): boolean {
  return k === 'crack';
}

export function opRadius(k: OpKind): number {
  return k === 'hold' || k === 'climb' ? OP_HOLD_RADIUS : OP_WORK_RADIUS;
}

/** Paramètres d'implants du parrain qui comptent dans une opération. */
export interface OpBossParams {
  /** Bras tactique : vitesse de piratage (×), portes forcées (0/1), piratage à distance (m). */
  hack: number;
  doors: number;
  remote: number;
  /** Poing hydraulique : défonce les portes renforcées (0/1). */
  breach: number;
}

export const NO_BOSS_PARAMS: OpBossParams = { hack: 1, doors: 0, remote: 0, breach: 0 };

/** Multiplicateur de vitesse du parrain sur une étape, selon ses implants. */
export function bossWorkMul(k: OpKind, p: OpBossParams): number {
  if (isHackKind(k)) return Math.max(1, p.hack);
  if (isDoorKind(k)) return p.breach > 0 ? 4 : p.doors > 0 ? 2.5 : 1;
  return 1;
}

/** Portée de travail du parrain (piratage à distance avec le bras tactique). */
export function bossWorkRange(k: OpKind, p: OpBossParams): number {
  const r = opRadius(k);
  return isHackKind(k) && p.remote > r ? p.remote : r;
}

// ---------------------------------------------------------------------------- étapes

const st = (key: string, kind: OpKind, label: string, doing: string, place: string, undo?: string, extra?: Partial<OpStepDef>): OpStepDef => ({
  key,
  kind,
  label,
  doing,
  place,
  undo,
  ...extra,
});

const S = {
  // bureaux
  officeDirection: st('office', 'seize', 'Prendre le bureau de la direction', 'Prend le bureau de la direction', 'le bureau de la direction', 'Reprendre le bureau de la direction'),
  officePatron: st('office', 'seize', 'Prendre le bureau du patron', 'Prend le bureau du patron', 'le bureau du patron', 'Reprendre le bureau du patron'),
  officeDirecteur: st('office', 'seize', 'Prendre le bureau du directeur', 'Prend le bureau du directeur', 'le bureau du directeur', 'Reprendre le bureau du directeur'),
  officeCoach: st('office', 'seize', 'Prendre le bureau de l’entraîneur', 'Prend le bureau de l’entraîneur', 'le bureau de l’entraîneur', 'Reprendre le bureau de l’entraîneur'),
  officeTriade: st('office', 'seize', 'Prendre le bureau de la Triade', 'Prend le bureau de la Triade', 'le bureau de la Triade', 'Reprendre le bureau de la Triade'),
  officePresident: st('office', 'seize', 'Prendre le bureau du président', 'Prend le bureau du président', 'le bureau du président', 'Reprendre le bureau du président'),
  officeAuction: st('office', 'seize', 'Prendre le bureau du commissaire-priseur', 'Prend le bureau du commissaire-priseur', 'le bureau du commissaire-priseur', 'Reprendre le bureau du commissaire-priseur'),
  officeBrewer: st('office', 'seize', 'Prendre le bureau du brasseur', 'Prend le bureau du brasseur', 'le bureau du brasseur', 'Reprendre le bureau du brasseur'),
  execFloor: st('office', 'seize', 'Prendre l’étage de direction', 'Prend l’étage de direction', 'l’étage de direction', 'Reprendre l’étage de direction'),
  // salons
  vipCarre: st('vip', 'hold', 'Prendre le carré VIP', 'Tient le carré VIP', 'le carré VIP', 'Reprendre le carré VIP'),
  vipSalon: st('vip', 'hold', 'Prendre le salon VIP', 'Tient le salon VIP', 'le salon VIP', 'Reprendre le salon VIP'),
  vipPrive: st('vip', 'hold', 'Prendre le salon privé', 'Tient le salon privé', 'le salon privé', 'Reprendre le salon privé'),
  vipTop: st('vip', 'hold', 'Prendre le salon du dernier étage', 'Tient le salon du dernier étage', 'le salon du dernier étage', 'Reprendre le salon du dernier étage'),
  suite: st('suite', 'hold', 'Prendre la suite présidentielle', 'Tient la suite présidentielle', 'la suite présidentielle', 'Reprendre la suite présidentielle'),
  // serveurs, réseaux, consoles
  serverCentral: st('server', 'minigame', 'Pirater le serveur central', 'Pirate le serveur central', 'le serveur central', 'Rétablir le serveur central'),
  serversData: st('server', 'minigame', 'Pirater les serveurs', 'Pirate les serveurs', 'la salle des serveurs', 'Rétablir les serveurs'),
  serverFactory: st('server', 'minigame', 'Pirater le serveur de l’usine', 'Pirate le serveur de l’usine', 'le serveur de l’usine', 'Rétablir le serveur de l’usine'),
  serverLab: st('server', 'minigame', 'Pirater le serveur du laboratoire', 'Pirate le serveur du laboratoire', 'le serveur du laboratoire', 'Rétablir le serveur du laboratoire'),
  serversQuotes: st('server', 'hack', 'Pirater les serveurs de cotation', 'Pirate les serveurs de cotation', 'les serveurs de cotation', 'Rétablir les serveurs de cotation'),
  serversCorp: st('server', 'hack', 'Pirater les serveurs de la tour', 'Pirate les serveurs de la tour', 'les serveurs de la tour', 'Rétablir les serveurs de la tour'),
  network: st('network', 'hack', 'Pirater le réseau de contrôle', 'Pirate le réseau de contrôle', 'le réseau de contrôle', 'Rétablir le réseau de contrôle'),
  antenna: st('antenna', 'hack', 'Pirater l’émetteur', 'Pirate l’émetteur', 'l’émetteur du studio', 'Rétablir l’émetteur'),
  terminal: st('terminal', 'hack', 'Couper les caméras', 'Coupe les caméras', 'le terminal de sécurité', 'Rétablir les caméras'),
  regieStudio: st('control', 'override', 'Prendre la régie', 'Prend le contrôle de la régie', 'la régie', 'Reprendre la régie'),
  regieTheatre: st('regie', 'override', 'Prendre la régie', 'Prend le contrôle de la régie', 'la régie', 'Reprendre la régie'),
  securityRoom: st('security', 'override', 'Prendre la salle de sécurité', 'Prend la salle de sécurité', 'la salle de sécurité', 'Reprendre la salle de sécurité'),
  securityPost: st('security', 'override', 'Prendre le poste de sécurité', 'Prend le poste de sécurité', 'le poste de sécurité', 'Reprendre le poste de sécurité'),
  logistics: st('logistics', 'override', 'Prendre la salle de contrôle logistique', 'Prend la salle de contrôle logistique', 'la salle de contrôle logistique', 'Reprendre la salle de contrôle'),
  switchPost: st('switch', 'override', 'Prendre le contrôle des aiguillages', 'Prend le contrôle des aiguillages', 'le poste d’aiguillage', 'Reprendre les aiguillages'),
  lobby: st('lobby', 'override', 'Prendre le hall et les ascenseurs', 'Prend le contrôle du hall', 'le hall de la tour', 'Reprendre le hall'),
  // registres, comptoirs
  regDebts: st('registry', 'seize', 'Saisir le registre des dettes', 'Saisit le registre des dettes', 'le registre des dettes', 'Reprendre le registre des dettes'),
  regStalls: st('registry', 'seize', 'Saisir le registre des emplacements', 'Saisit le registre des emplacements', 'le registre des emplacements', 'Reprendre le registre des emplacements'),
  regWrecks: st('registry', 'seize', 'Saisir le registre des épaves', 'Saisit le registre des épaves', 'le registre des épaves', 'Reprendre le registre des épaves'),
  regSales: st('registry', 'seize', 'Saisir le registre des ventes', 'Saisit le registre des ventes', 'le registre des ventes', 'Reprendre le registre des ventes'),
  regPrescriptions: st('registry', 'seize', 'Saisir le registre des ordonnances', 'Saisit le registre des ordonnances', 'le registre des ordonnances', 'Reprendre le registre des ordonnances'),
  regHotel: st('registry', 'seize', 'Saisir le registre de la réception', 'Saisit le registre de la réception', 'la réception', 'Reprendre la réception'),
  counter: st('counter', 'seize', 'Prendre le comptoir', 'Prend le comptoir', 'le comptoir', 'Reprendre le comptoir'),
  tattooSalon: st('counter', 'hold', 'Prendre le salon', 'Tient le salon de tatouage', 'le salon de tatouage', 'Reprendre le salon'),
  // salles
  stage: st('stage', 'hold', 'Prendre la scène', 'Tient la scène', 'la scène', 'Reprendre la scène'),
  hallMarket: st('hall', 'hold', 'Tenir la halle', 'Tient la halle', 'la halle', 'Reprendre la halle'),
  hallGame: st('hall_top', 'hold', 'Prendre la salle de jeu', 'Tient la salle de jeu', 'la salle de jeu', 'Reprendre la salle de jeu'),
  hallGalleryTop: st('hall_top', 'hold', 'Prendre la grande galerie', 'Tient la grande galerie', 'la grande galerie', 'Reprendre la grande galerie'),
  hallGallery: st('hall', 'hold', 'Tenir la grande galerie', 'Tient la grande galerie', 'la grande galerie', 'Reprendre la grande galerie'),
  hallFloor: st('hall', 'hold', 'Prendre la corbeille', 'Tient la corbeille', 'la corbeille', 'Reprendre la corbeille'),
  hallStation: st('hall', 'hold', 'Prendre le grand hall', 'Tient le grand hall', 'le grand hall', 'Reprendre le grand hall'),
  hallAny: st('hall', 'hold', 'Prendre la grande salle', 'Tient la grande salle', 'la grande salle', 'Reprendre la grande salle'),
  kitchen: st('kitchen', 'hold', 'Prendre la cuisine', 'Tient la cuisine', 'la cuisine', 'Reprendre la cuisine'),
  kitchenBack: st('kitchen', 'hold', 'Prendre l’arrière-cuisine', 'Tient l’arrière-cuisine', 'l’arrière-cuisine', 'Reprendre l’arrière-cuisine'),
  clinic: st('clinic', 'hold', 'Prendre la clinique clandestine', 'Tient la clinique clandestine', 'la clinique clandestine', 'Reprendre la clinique clandestine'),
  docks: st('docks', 'hold', 'Prendre les quais de chargement', 'Tient les quais de chargement', 'les quais de chargement', 'Reprendre les quais'),
  // coffres et documents
  vaultBank: st('vault', 'crack', 'Forcer la chambre forte', 'Force la chambre forte', 'la chambre forte', 'Refermer la chambre forte'),
  deedBank: st('vault', 'secure', 'Récupérer l’acte de propriété', 'Récupère l’acte de propriété', 'l’acte de propriété', undefined, { item: 'l’acte de propriété' }),
  deedDeliver: st('office', 'deliver', 'Faire enregistrer l’acte au bureau du directeur', 'Fait enregistrer l’acte de propriété', 'le bureau du directeur'),
  vaultGallery: st('vault', 'crack', 'Forcer la réserve blindée', 'Force la réserve blindée', 'la réserve blindée', 'Refermer la réserve blindée'),
  vaultReserve: st('vault', 'crack', 'Forcer la réserve', 'Force la réserve', 'la réserve', 'Refermer la réserve'),
  vaultManager: st('vault', 'crack', 'Forcer le coffre du gérant', 'Force le coffre du gérant', 'le coffre du gérant', 'Refermer le coffre du gérant'),
  // industrie, tours
  line: st('line', 'sabotage', 'Arrêter la chaîne de production', 'Arrête la chaîne de production', 'la chaîne de production', 'Relancer la chaîne de production'),
  roof: st('roof', 'climb', 'Hisser vos couleurs sur le toit', 'Hisse les couleurs sur le toit', 'le toit de la tour', 'Arracher les couleurs du toit'),
  // logements des parrains
  gate: st('gate', 'override', 'Neutraliser la sécurité du QG', 'Neutralise la sécurité du QG', 'l’entrée du QG', 'Rétablir la sécurité du QG'),
  armory: st('armory', 'crack', 'Forcer l’armurerie', 'Force l’armurerie', 'l’armurerie', 'Refermer l’armurerie'),
  deskBoss: st('desk', 'seize', 'Prendre le bureau du parrain', 'Prend le bureau du parrain', 'le bureau du parrain', 'Reprendre le bureau du parrain'),
  desk: st('desk', 'seize', 'Prendre le bureau', 'Prend le bureau', 'le bureau', 'Reprendre le bureau'),
  garageReg: st('desk', 'seize', 'Saisir le registre du garage', 'Saisit le registre du garage', 'le registre du garage', 'Reprendre le registre du garage'),
};

type LevelPlans = Partial<Record<OpLevel, OpStepDef[]>>;

/** Mise en scène des opérations par type de bâtiment et par niveau. */
const PLANS: Partial<Record<BuildingType, LevelPlans>> = {
  club: { standard: [S.officeDirection], key: [S.vipCarre, S.officeDirection] },
  jazz: { standard: [S.officePatron], key: [S.stage, S.officePatron] },
  casino: { major: [S.network, S.officeDirection, S.vipSalon] },
  theatre: { standard: [S.officeDirecteur], key: [S.regieTheatre, S.officeDirecteur] },
  gym: { standard: [S.officeCoach] },
  bodega: { small: [S.counter] },
  herbalist: { small: [S.counter] },
  pharmacy: { small: [S.counter], standard: [S.regPrescriptions] },
  tattoo: { small: [S.tattooSalon], standard: [S.tattooSalon] },
  diner: { small: [S.counter], standard: [S.kitchenBack] },
  teahouse: { key: [S.vipPrive, S.officeTriade] },
  mahjong: { key: [S.hallGame, S.regDebts] },
  techmarket: { key: [S.clinic, S.serverCentral] },
  restaurant: { standard: [S.kitchen], major: [S.terminal, S.kitchen, S.vaultManager] },
  boathouse: { small: [S.counter] },
  hotel: { standard: [S.regHotel], key: [S.regHotel, S.suite], major: [S.terminal, S.regHotel, S.vipTop] },
  gallery: { standard: [S.vaultReserve], key: [S.hallGalleryTop, S.vaultReserve], major: [S.securityRoom, S.vaultGallery, S.hallGallery] },
  bank: { major: [S.vaultBank, S.deedBank, S.deedDeliver] },
  exchange: { standard: [S.officeAuction], major: [S.hallFloor, S.officePresident, S.serversQuotes] },
  corp: { key: [S.lobby, S.execFloor, S.serversCorp], major: [S.lobby, S.execFloor, S.roof] },
  security: { small: [S.securityPost], standard: [S.serversData] },
  studio: { standard: [S.regieStudio], key: [S.regieStudio, S.vipSalon], major: [S.regieStudio, S.vipSalon, S.antenna] },
  station: { major: [S.hallStation, S.securityPost, S.switchPost] },
  showroom: { standard: [S.regSales] },
  depot: { key: [S.docks, S.logistics] },
  factory: { standard: [S.serverFactory], key: [S.line, S.officeDirecteur, S.serverLab] },
  nightmarket: { standard: [S.regStalls], key: [S.hallMarket, S.regStalls] },
  brewery: { standard: [S.officeBrewer] },
  junkyard: { small: [S.regWrecks], standard: [S.regWrecks] },
  hideout: { small: [S.desk] },
  garage: { small: [S.garageReg] },
  loft: { small: [S.desk] },
  penthouse: { small: [S.desk] },
  tower: { small: [S.desk] },
};

/** L'assaut d'un QG : la sécurité de l'entrée, l'armurerie, puis le bureau du parrain. */
const HQ_PLAN: OpStepDef[] = [S.gate, S.armory, S.deskBoss];

const LEVEL_ORDER: OpLevel[] = ['small', 'standard', 'key', 'major'];

/** Importance d'un bâtiment (les jumeaux du plan ont toujours la même). */
export function opLevel(def: BuildingDef, hq: boolean): OpLevel {
  if (hq) return 'hq';
  if (def.residence) return 'small';
  if (def.isKey) return def.income >= 65 || (def.security ?? 0) >= 1 ? 'major' : 'key';
  if (def.guards <= 0 && def.price > 0) return 'small';
  return 'standard';
}

/** Étapes prévues (sans les ancres) pour un type et un niveau. */
export function opStepDefs(type: BuildingType, level: OpLevel): OpStepDef[] {
  if (level === 'hq') return HQ_PLAN;
  const plans = PLANS[type];
  if (!plans) return [S.hallAny];
  if (plans[level]) return plans[level]!;
  // niveau absent pour ce type : le plus proche, d'abord en dessous
  const i = LEVEL_ORDER.indexOf(level);
  for (let d = 1; d < LEVEL_ORDER.length; d++) {
    const lo = LEVEL_ORDER[i - d];
    if (lo && plans[lo]) return plans[lo]!;
    const hi = LEVEL_ORDER[i + d];
    if (hi && plans[hi]) return plans[hi]!;
  }
  return [S.hallAny];
}

/** Clés des ancres utiles à un bâtiment (génération de la ville) : son niveau, et le QG pour les logements. */
export function opAnchorKeys(def: BuildingDef): string[] {
  const keys = new Set<string>();
  for (const s of opStepDefs(def.type, opLevel(def, false))) keys.add(s.key);
  if (def.residence) for (const s of HQ_PLAN) keys.add(s.key);
  return [...keys];
}

export function opAnchor(info: BuildingInfo, key: string): OpAnchor | undefined {
  return info.ops?.find((a) => a.key === key);
}

const planCache = new WeakMap<BuildingInfo, (OpPlan | null)[]>();

/**
 * Opération d'un bâtiment capturable (null sinon). hq : c'est le QG actuel d'un parrain.
 * Une étape dont l'ancre manque est remplacée par la tenue de la grande salle.
 */
export function opPlan(info: BuildingInfo, hq: boolean): OpPlan | null {
  let cached = planCache.get(info);
  if (!cached) planCache.set(info, (cached = [undefined as unknown as OpPlan, undefined as unknown as OpPlan]));
  const slot = hq ? 1 : 0;
  if (cached[slot] !== undefined) return cached[slot];
  const def = info.def;
  let plan: OpPlan | null = null;
  if (def.capturable) {
    const level = opLevel(def, hq);
    const defs = opStepDefs(def.type, level);
    const steps: OpStep[] = [];
    const wsum = defs.reduce((s, d) => s + KIND_WEIGHT[d.kind], 0);
    for (const d of defs) {
      const anchor = opAnchor(info, d.key) ?? opAnchor(info, 'hall') ?? { key: 'hall', x: info.center.x, y: info.center.y ?? info.floorY, z: info.center.z, floor: 0 };
      const time = Math.max(3, Math.round(((OP_BUDGET[level] * KIND_WEIGHT[d.kind]) / wsum) * 2) / 2);
      steps.push({ ...d, time, anchor });
    }
    plan = { level, steps, total: steps.reduce((s, x) => s + x.time, 0) };
  }
  cached[slot] = plan;
  return plan;
}

// ---------------------------------------------------------------------------- état public

/** Progression globale de l'opération (0..1). */
export function opOverall(op: Pick<OpPub, 'step' | 'n' | 'p'>): number {
  return Math.max(0, Math.min(1, (op.step + op.p) / Math.max(1, op.n)));
}

/** « du serveur », « de la chambre forte », « des quais », « de l’armurerie » (lieux d'objectifs). */
export function dePlace(place: string): string {
  if (place.startsWith('le ')) return `du ${place.slice(3)}`;
  if (place.startsWith('les ')) return `des ${place.slice(4)}`;
  return `de ${place}`;
}

/** « au serveur », « à la chambre forte », « aux quais », « à l’armurerie ». */
export function aPlace(place: string): string {
  if (place.startsWith('le ')) return `au ${place.slice(3)}`;
  if (place.startsWith('les ')) return `aux ${place.slice(4)}`;
  return `à ${place}`;
}
