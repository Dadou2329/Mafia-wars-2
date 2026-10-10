// Types de personnages, armes et apparence (partagé client/serveur).

export const enum CharKind {
  BOSS_DADOU = 0,
  BOSS_EVEN = 1,
  GANGSTER = 2,
  LIEUTENANT = 3,
  THUG = 4, // voyou neutre (gangs locaux)
  POLICE = 5,
  CIVILIAN = 6,
  CIVILIAN_F = 7,
  BARMAN = 8, // rabatteur du QG
  TURRET = 9, // tourelle de sécurité
}

export const enum Weapon {
  FISTS = 0,
  PISTOL = 1,
  SHOTGUN = 2,
  RIFLE = 3,
  KNIFE = 4,
  CLUB = 5,
  SMG = 6,
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
  /** Tir automatique (bouton maintenu). */
  auto?: boolean;
}

export const WEAPONS: Record<Weapon, WeaponDef> = {
  [Weapon.FISTS]: { id: Weapon.FISTS, name: 'Poings', ranged: false, damage: 13, pellets: 1, spread: 0, range: 1.7, cooldown: 0.42, magazine: 0, reload: 0, price: 0, npcRange: 1.6 },
  [Weapon.PISTOL]: { id: Weapon.PISTOL, name: 'Pistolet Vektor', ranged: true, damage: 24, pellets: 1, spread: 0.012, range: 60, cooldown: 0.26, magazine: 12, reload: 1.5, price: 0, npcRange: 24 },
  [Weapon.SHOTGUN]: { id: Weapon.SHOTGUN, name: 'Fusil à pompe Hammer', ranged: true, damage: 12, pellets: 8, spread: 0.075, range: 26, cooldown: 0.8, magazine: 6, reload: 2.4, price: 320, npcRange: 12 },
  [Weapon.RIFLE]: { id: Weapon.RIFLE, name: 'Fusil à rail Longbow', ranged: true, damage: 62, pellets: 1, spread: 0.003, range: 130, cooldown: 1.05, magazine: 5, reload: 2.6, price: 520, npcRange: 36 },
  [Weapon.KNIFE]: { id: Weapon.KNIFE, name: 'Lame thermique', ranged: false, damage: 34, pellets: 1, spread: 0, range: 1.8, cooldown: 0.5, magazine: 0, reload: 0, price: 60, npcRange: 1.7 },
  [Weapon.CLUB]: { id: Weapon.CLUB, name: 'Matraque électrique', ranged: false, damage: 26, pellets: 1, spread: 0, range: 2.0, cooldown: 0.55, magazine: 0, reload: 0, price: 45, npcRange: 1.9 },
  [Weapon.SMG]: { id: Weapon.SMG, name: 'Pistolet-mitrailleur Wasp', ranged: true, damage: 13, pellets: 1, spread: 0.032, range: 45, cooldown: 0.085, magazine: 32, reload: 1.9, price: 380, npcRange: 18, auto: true },
};

/** Ordre des armes dans la roue (touches 1 à 5). */
export const WEAPON_SLOTS: Weapon[][] = [[Weapon.FISTS, Weapon.KNIFE, Weapon.CLUB], [Weapon.PISTOL], [Weapon.SMG], [Weapon.SHOTGUN], [Weapon.RIFLE]];

/** Animation / état visuel transmis dans les instantanés. */
export const enum Anim {
  IDLE = 0,
  WALK = 1,
  RUN = 2,
  DEAD = 3,
  COWER = 4,
  SIT = 5,
  DRIVE = 6,
}

/** Drapeaux d'état (bits). */
export const FLAG = {
  AIM: 1,
  CROUCH: 2,
  INTERACT: 4,
  WANTED: 8,
  INSIDE: 16,
  LEADER: 32,
  VEHICLE: 64,
  HIDDEN: 128,
} as const;

export const LIEUTENANT_NAMES: Record<'dadou' | 'even', string[]> = {
  dadou: ['Vinnie Moretti', 'Sal Romano', 'Rocco Caruso', 'Tony Valenti', 'Nico Ferraro', 'Lenny Russo', 'Frankie Bruno', 'Joey Marino'],
  even: ['Jack Harlow', 'Ray Navarro', 'Eddie Kowalski', 'Marcus Reed', 'Leo Fitzgerald', 'Danny O’Brien', 'Sam Whitaker', 'Victor Hale'],
};

/** Le rabatteur qui recrute au QG. */
export const RECRUITER_NAME: Record<'dadou' | 'even', string> = { dadou: 'Gino le Rabatteur', even: 'Nina la Recruteuse' };

export const GANGSTER_FIRST = ['Mickey', 'Joey', 'Rico', 'Danny', 'Eddie', 'Frankie', 'Kenji', 'Luis', 'Jimmy', 'Lenny', 'Tommy', 'Andre', 'Marco', 'Dmitri', 'Ray', 'Sonny', 'Malik', 'Pete', 'Vince', 'Bobby'];
export const GANGSTER_LAST = ['Rossi', 'Kim', 'Diaz', 'Murphy', 'Cohen', 'Novak', 'Ortiz', 'Chen', 'Walsh', 'Romano', 'Brooks', 'Silva', 'Park', 'Russo', 'Nguyen', 'Kelly', 'Moreau', 'Vargas', 'Hughes', 'Okafor'];
