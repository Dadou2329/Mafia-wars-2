// Règles du jeu : économie, recrutement, paliers de l'ascension, améliorations, points de vie…

import { Weapon } from './characters';

export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

export const START_MONEY = 600;
export const START_GANGSTERS = 4;
export const RECRUIT_BUNDLES = [
  { n: 1, price: 80 },
  { n: 5, price: 380 },
  { n: 10, price: 700 },
];
export const LIEUTENANT_PRICES = [0, 400, 700, 1000, 1400, 1800, 2300, 2900];
export const DISTRICT_BONUS = 40; // $/min par quartier contrôlé
/** Quartiers à contrôler pour pouvoir prendre le QG adverse (sur 7). */
export const HQ_CAPTURE_MIN_DISTRICTS = 4;
export const INCOME_PERIOD = 5; // s

/** Paliers de l'ascension : effectifs, lieutenants, bonus de revenus, gardes d'élite. */
export interface TierDef {
  tier: number;
  name: string;
  maxMen: number;
  maxLt: number;
  incomeMul: number;
  guards: number;
  /** Quartiers à contrôler pour emménager. */
  districts: number;
  /** Avantages affichés (français). */
  perks: string[];
}

export const TIERS: TierDef[] = [
  { tier: 1, name: 'Planque', maxMen: 40, maxLt: 2, incomeMul: 1, guards: 0, districts: 0, perks: ['40 hommes', '2 lieutenants'] },
  { tier: 2, name: 'Garage', maxMen: 70, maxLt: 3, incomeMul: 1.05, guards: 0, districts: 0, perks: ['70 hommes', '3 lieutenants', 'Véhicules au garage', 'Revenus +5 %'] },
  { tier: 3, name: 'Loft', maxMen: 100, maxLt: 4, incomeMul: 1.1, guards: 2, districts: 1, perks: ['100 hommes', '4 lieutenants', 'Ordres depuis le téléphone', 'Drones', '2 gardes', 'Revenus +10 %'] },
  { tier: 4, name: 'Penthouse', maxMen: 140, maxLt: 6, incomeMul: 1.2, guards: 4, districts: 2, perks: ['140 hommes', '6 lieutenants', 'Aéronef (ADAV)', '4 gardes d’élite', 'Revenus +20 %'] },
  { tier: 5, name: 'Tour', maxMen: 180, maxLt: 8, incomeMul: 1.35, guards: 8, districts: 3, perks: ['180 hommes', '8 lieutenants', 'Tourelles automatiques', '8 gardes d’élite', 'Revenus +35 %'] },
];

export function tierDef(t: number): TierDef {
  return TIERS[Math.max(0, Math.min(TIERS.length - 1, t - 1))];
}

export const MAX_GANGSTERS = 180;
export const MAX_LIEUTENANTS = 8;

export const HP = {
  boss: 160,
  gangster: 75,
  lieutenant: 140,
  thug: 65,
  police: 100,
  guard: 120,
  turret: 180,
};

export const RESPAWN_TIME = 8;
export const RESPAWN_PENALTY = 0.1;
export const RESPAWN_PENALTY_MAX = 300;
export const LIEUTENANT_RECOVERY = 45; // s

export const SPEED = {
  walk: 1.7,
  run: 4.4,
  bossWalk: 2.4,
  bossRun: 6.2,
  crouch: 1.3,
};

/** Temps de capture (s) pour une unité seule. */
export const CAPTURE_TIME = { normal: 12, key: 20, hq: 35 };

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  price: number;
  category: 'gang' | 'hq';
  requires?: string;
  /** Palier minimal du logement. */
  tier?: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'pistols', name: 'Pistolets pour tous', desc: 'Chacun de vos gangsters reçoit un pistolet Vektor.', price: 400, category: 'gang' },
  { id: 'smgs', name: 'Pistolets-mitrailleurs', desc: 'Un gangster sur trois porte un pistolet-mitrailleur Wasp.', price: 800, category: 'gang', requires: 'pistols' },
  { id: 'rifles', name: 'Fusils à rail', desc: 'Un gangster sur quatre porte un fusil à rail Longbow.', price: 1200, category: 'gang', requires: 'pistols' },
  { id: 'vests', name: 'Gilets en graphène', desc: '+35 % de points de vie pour tous vos hommes.', price: 700, category: 'gang' },
  { id: 'training', name: 'Implants de visée', desc: '+20 % de précision pour tous vos hommes.', price: 750, category: 'gang' },
  { id: 'hackers', name: 'Hackers de la bande', desc: 'Vos lieutenants et vous piratez les systèmes de sécurité deux fois plus vite.', price: 900, category: 'gang' },
  { id: 'crypto', name: 'Liaison cryptée', desc: 'Donnez vos ordres depuis la carte (touche M) et le téléphone, où que vous soyez.', price: 600, category: 'hq' },
  { id: 'armory', name: 'Armurerie', desc: 'Achetez des armes et des munitions dans votre QG.', price: 350, category: 'hq' },
  { id: 'drones', name: 'Drones de reconnaissance', desc: 'Envoyez un drone sur un quartier : les ennemis y apparaissent sur vos cartes.', price: 1500, category: 'hq', tier: 3 },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/** Armes que le parrain peut acheter à l'armurerie. */
export const BOSS_SHOP: { weapon: Weapon; price: number }[] = [
  { weapon: Weapon.SMG, price: 380 },
  { weapon: Weapon.SHOTGUN, price: 320 },
  { weapon: Weapon.RIFLE, price: 520 },
  { weapon: Weapon.KNIFE, price: 60 },
  { weapon: Weapon.CLUB, price: 45 },
];

export const AMMO_PRICE = 50;
/** Taxi volant vers le QG (téléphone). */
export const TAXI_PRICE = 60;

/** Véhicules : achetables au garage (à partir du palier indiqué), ou réservés (police, convois, drones). */
export type VehicleClass = 'moto' | 'car' | 'van' | 'truck' | 'vtol' | 'drone';

export interface VehicleDef {
  id: number;
  key: string;
  name: string;
  /** Prix au garage (−1 : non achetable). */
  price: number;
  tier: number;
  /** Places (conducteur compris). */
  seats: number;
  hp: number;
  /** Vitesse maximale (m/s), accélération (m/s²). */
  speed: number;
  accel: number;
  cls: VehicleClass;
  /** Encombrement (m) : largeur, hauteur, longueur. */
  size: [number, number, number];
  desc: string;
}

export const VEHICLES: VehicleDef[] = [
  { id: 0, key: 'moto', name: 'Moto de récup', price: 0, tier: 1, seats: 1, hp: 120, speed: 22, accel: 11, cls: 'moto', size: [0.8, 1.2, 2.1], desc: 'Une vieille moto électrique rafistolée. Rapide et nerveuse.' },
  { id: 1, key: 'berline', name: 'Berline Nimbus', price: 900, tier: 2, seats: 4, hp: 260, speed: 24, accel: 8, cls: 'car', size: [2.0, 1.45, 4.4], desc: 'Une berline à coussin magnétique, sobre, quatre places : trois hommes vous accompagnent.' },
  { id: 2, key: 'sport', name: 'Bolide Stingray', price: 2600, tier: 3, seats: 2, hp: 220, speed: 31, accel: 14, cls: 'car', size: [2.0, 1.2, 4.6], desc: 'Un coupé de sport à propulsion magnétique. Le plus rapide de New York.' },
  { id: 3, key: 'fourgon', name: 'Fourgon blindé Rhino', price: 3400, tier: 3, seats: 8, hp: 600, speed: 18, accel: 5, cls: 'van', size: [2.3, 2.4, 5.6], desc: 'Blindé, lent : il transporte toute une escouade (sept hommes).' },
  { id: 4, key: 'adav', name: 'Aéronef Corvus (ADAV)', price: 12000, tier: 4, seats: 4, hp: 420, speed: 26, accel: 7, cls: 'vtol', size: [4.4, 2.0, 5.4], desc: 'Un aéronef à décollage vertical : il se pose sur les toits. Rare et prestigieux.' },
  { id: 5, key: 'police', name: 'Croiseur du NYPD', price: -1, tier: 9, seats: 4, hp: 320, speed: 25, accel: 9, cls: 'car', size: [2.1, 1.5, 4.8], desc: 'Croiseur de patrouille du NYPD.' },
  { id: 6, key: 'convoi', name: 'Camion blindé', price: -1, tier: 9, seats: 2, hp: 900, speed: 14, accel: 4, cls: 'truck', size: [2.5, 3.0, 7.0], desc: 'Un camion blindé chargé de valeurs.' },
  { id: 7, key: 'drone', name: 'Drone de reconnaissance', price: -1, tier: 9, seats: 0, hp: 60, speed: 20, accel: 10, cls: 'drone', size: [1.2, 0.5, 1.2], desc: 'Un drone qui survole un quartier et repère les ennemis.' },
];

export const VEHICLE_BY_KEY: Record<string, VehicleDef> = Object.fromEntries(VEHICLES.map((v) => [v.key, v]));

/** Délai entre deux livraisons de véhicule (s), et après une destruction. */
export const VEHICLE_CALL_COOLDOWN = 20;
export const VEHICLE_WRECK_COOLDOWN = 60;

/** Noms affichés des mafias. */
export const MAFIA_NAME = { dadou: 'La Mafia de Dadou', even: 'La Mafia d’Even' } as const;
export const BOSS_NAME = { dadou: 'Dadou', even: 'Even' } as const;
/** « de Dadou » / « d’Even » (élision). */
export const DE_BOSS = { dadou: 'de Dadou', even: 'd’Even' } as const;

export type OrderType =
  | 'attack_district'
  | 'attack_building'
  | 'defend_district'
  | 'defend_building'
  | 'patrol'
  | 'follow'
  | 'reinforce'
  | 'retreat'
  | 'hold'
  | 'roof'
  | 'subway'
  | 'heist'
  | 'escort'
  | 'intercept';

export const ORDER_LABEL: Record<OrderType, string> = {
  attack_district: 'Attaquer le quartier',
  attack_building: 'Attaquer le bâtiment',
  defend_district: 'Défendre le quartier',
  defend_building: 'Défendre le bâtiment',
  patrol: 'Patrouiller',
  follow: 'Suivre le patron',
  reinforce: 'Renforcer',
  retreat: 'Se replier',
  hold: 'Tenir la position',
  roof: 'Tenir le toit',
  subway: 'Attaquer par le métro',
  heist: 'Braquer le coffre',
  escort: 'Escorter le convoi',
  intercept: 'Intercepter le convoi',
};

/** Libellé d'état des missions (affiché dans les rapports). */
export const ORDER_STATUS: Record<OrderType, string> = {
  attack_district: 'ATTAQUE EN COURS',
  attack_building: 'ASSAUT EN COURS',
  defend_district: 'DÉFENSE',
  defend_building: 'DÉFENSE',
  patrol: 'PATROUILLE',
  follow: 'ESCORTE',
  reinforce: 'RENFORTS',
  retreat: 'REPLI',
  hold: 'POSITION TENUE',
  roof: 'TOIT TENU',
  subway: 'ATTAQUE SOUTERRAINE',
  heist: 'BRAQUAGE',
  escort: 'ESCORTE DU CONVOI',
  intercept: 'INTERCEPTION',
};

/** Sécurité des bâtiments : durée d'un piratage (s), de la coupure, temps de rechargement des braquages. */
export const HACK_TIME = 7;
export const HACK_TIME_PRO = 3.5;
export const HACK_DURATION = 90;
export const HEIST_COOLDOWN = 480;

/** Le journal holographique de la ville. */
export const NEWSPAPER = 'LE FLASH DE NEW YORK';
