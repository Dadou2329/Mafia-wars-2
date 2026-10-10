// Règles du jeu : économie, recrutement, améliorations, points de vie…

import { Weapon } from './characters';

export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

export const START_MONEY = 500;
export const START_GANGSTERS = 5;
export const MAX_GANGSTERS = 120;
export const RECRUIT_BUNDLES = [
  { n: 1, price: 60 },
  { n: 5, price: 280 },
  { n: 10, price: 520 },
];
export const LIEUTENANT_PRICES = [0, 250, 400, 600, 850, 1100];
export const MAX_LIEUTENANTS = 6;
export const DISTRICT_BONUS = 20; // £/min par quartier contrôlé
export const HQ_CAPTURE_MIN_DISTRICTS = 3;
export const INCOME_PERIOD = 5; // s

export const HP = {
  boss: 150,
  gangster: 70,
  lieutenant: 130,
  thug: 60,
  police: 90,
  guard: 110,
};

export const RESPAWN_TIME = 8;
export const RESPAWN_PENALTY = 0.1;
export const RESPAWN_PENALTY_MAX = 150;
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
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'revolvers', name: 'Revolvers pour tous', desc: 'Tous vos gangsters reçoivent un revolver Webley.', price: 350, category: 'gang' },
  { id: 'shotguns', name: 'Fusils de chasse', desc: 'Un gangster sur trois porte un fusil de chasse.', price: 600, category: 'gang', requires: 'revolvers' },
  { id: 'rifles', name: 'Carabines Martini-Henry', desc: 'Un gangster sur quatre porte une carabine de précision.', price: 900, category: 'gang', requires: 'revolvers' },
  { id: 'vests', name: 'Gilets matelassés', desc: '+35 % de points de vie pour tous vos hommes.', price: 500, category: 'gang' },
  { id: 'training', name: 'Entraînement au tir', desc: '+20 % de précision pour tous vos hommes.', price: 550, category: 'gang' },
  { id: 'guards', name: 'Gardes du QG', desc: 'Quatre gardes d’élite protègent votre quartier général en permanence.', price: 400, category: 'hq' },
  { id: 'office', name: 'Bureau de prestige', desc: 'Mobilier luxueux et trophées. +10 % sur tous vos revenus.', price: 450, category: 'hq' },
  { id: 'telegraph', name: 'Télégraphe', desc: 'Donnez vos ordres depuis la carte (touche M), où que vous soyez.', price: 500, category: 'hq' },
  { id: 'armory', name: 'Armurerie', desc: 'Achetez des armes au QG et faites le plein de munitions.', price: 300, category: 'hq' },
  { id: 'facade', name: 'Façade prestigieuse', desc: 'Drapeaux et lanternes à vos couleurs. +5 £/min par quartier contrôlé.', price: 600, category: 'hq' },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/** Armes que le parrain peut acheter à l'armurerie. */
export const BOSS_SHOP: { weapon: Weapon; price: number }[] = [
  { weapon: Weapon.SHOTGUN, price: 220 },
  { weapon: Weapon.RIFLE, price: 320 },
  { weapon: Weapon.KNIFE, price: 40 },
  { weapon: Weapon.CLUB, price: 25 },
];

export const AMMO_PRICE = 30;

/** Noms affichés des mafias. */
export const MAFIA_NAME = { dadou: 'La Mafia de Dadou', even: 'La Mafia d’Even' } as const;
export const BOSS_NAME = { dadou: 'Dadou', even: 'Even' } as const;
/** « de Dadou » / « d’Even » (élision). */
export const DE_BOSS = { dadou: 'de Dadou', even: 'd’Even' } as const;

export type OrderType = 'attack_district' | 'attack_building' | 'defend_district' | 'defend_building' | 'patrol' | 'follow' | 'reinforce' | 'retreat' | 'hold';

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
};

export const NEWSPAPER = 'LA GAZETTE DE LONDRES';
