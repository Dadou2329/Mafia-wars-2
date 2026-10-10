// Types de personnages et apparence (partagé client/serveur).

export const enum CharKind {
  BOSS_DADOU = 0,
  BOSS_EVEN = 1,
  GANGSTER = 2,
  LIEUTENANT = 3,
  THUG = 4, // voyou neutre (gangs locaux)
  POLICE = 5,
  CIVILIAN = 6,
  CIVILIAN_F = 7,
  BARMAN = 8,
}

export const enum Weapon {
  FISTS = 0,
  REVOLVER = 1,
  SHOTGUN = 2,
  RIFLE = 3,
  KNIFE = 4,
  CLUB = 5,
}

export interface WeaponDef {
  id: Weapon;
  name: string; // français
  ranged: boolean;
  damage: number;
  pellets: number;
  spread: number; // radians
  range: number; // m
  cooldown: number; // s entre deux tirs
  magazine: number;
  reload: number; // s
  price: number;
  /** Portée effective des PNJ. */
  npcRange: number;
}

export const WEAPONS: Record<Weapon, WeaponDef> = {
  [Weapon.FISTS]: { id: Weapon.FISTS, name: 'Poings', ranged: false, damage: 12, pellets: 1, spread: 0, range: 1.7, cooldown: 0.45, magazine: 0, reload: 0, price: 0, npcRange: 1.6 },
  [Weapon.REVOLVER]: { id: Weapon.REVOLVER, name: 'Revolver Webley', ranged: true, damage: 26, pellets: 1, spread: 0.012, range: 60, cooldown: 0.38, magazine: 6, reload: 1.6, price: 0, npcRange: 22 },
  [Weapon.SHOTGUN]: { id: Weapon.SHOTGUN, name: 'Fusil de chasse', ranged: true, damage: 13, pellets: 7, spread: 0.075, range: 25, cooldown: 0.9, magazine: 2, reload: 2.2, price: 220, npcRange: 11 },
  [Weapon.RIFLE]: { id: Weapon.RIFLE, name: 'Carabine Martini-Henry', ranged: true, damage: 55, pellets: 1, spread: 0.004, range: 110, cooldown: 1.1, magazine: 5, reload: 2.6, price: 320, npcRange: 34 },
  [Weapon.KNIFE]: { id: Weapon.KNIFE, name: 'Couteau', ranged: false, damage: 32, pellets: 1, spread: 0, range: 1.8, cooldown: 0.55, magazine: 0, reload: 0, price: 40, npcRange: 1.7 },
  [Weapon.CLUB]: { id: Weapon.CLUB, name: 'Matraque', ranged: false, damage: 24, pellets: 1, spread: 0, range: 2.0, cooldown: 0.6, magazine: 0, reload: 0, price: 25, npcRange: 1.9 },
};

/** Animation / état visuel transmis dans les instantanés. */
export const enum Anim {
  IDLE = 0,
  WALK = 1,
  RUN = 2,
  DEAD = 3,
  COWER = 4,
  SIT = 5,
}

/** Drapeaux d'état (bits). */
export const FLAG = {
  AIM: 1,
  CROUCH: 2,
  INTERACT: 4,
  WANTED: 8,
  INSIDE: 16,
  LEADER: 32,
  CARRIAGE: 64,
  HIDDEN: 128,
} as const;

export const LIEUTENANT_NAMES: Record<'dadou' | 'even', string[]> = {
  dadou: ['Arthur Collins', 'Thomas Blake', 'Henry Walsh', 'Edward Miller', 'Frederick Hale', 'Walter Briggs'],
  even: ['William Hayes', 'George Turner', 'Charles Reed', 'James Fletcher', 'Albert Crane', 'Samuel Pike'],
};

export const GANGSTER_FIRST = ['Alfie', 'Bert', 'Charlie', 'Danny', 'Eddie', 'Fred', 'Georgie', 'Harry', 'Jack', 'Lenny', 'Micky', 'Ned', 'Ollie', 'Percy', 'Ronnie', 'Sid', 'Tommy', 'Wally', 'Archie', 'Billy'];
export const GANGSTER_LAST = ['Smith', 'Jones', 'Brown', 'Taylor', 'Wilson', 'Evans', 'Thomas', 'Roberts', 'Walker', 'Wright', 'Hughes', 'Green', 'Hall', 'Wood', 'Clarke', 'Cooper', 'Ward', 'Morris', 'Hill', 'Kelly'];
