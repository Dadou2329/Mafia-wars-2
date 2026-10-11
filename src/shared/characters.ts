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
  /** Véhicule (le modèle est donné par EntityInfo.gang = identifiant de VehicleDef). */
  VEHICLE = 10,
}

export const enum Weapon {
  FISTS = 0,
  PISTOL = 1,
  SHOTGUN = 2,
  RIFLE = 3,
  KNIFE = 4,
  CLUB = 5,
  SMG = 6,
  /** Armes de bras (implants) : sorties par la touche du bras. */
  ARM_PISTOL = 7,
  ARM_BLADE = 8,
  ARM_FIST = 9,
  ARM_WHIP = 10,
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
  // armes de bras : valeurs du niveau 1 (les niveaux des implants les remplacent, voir implants.ts)
  [Weapon.ARM_PISTOL]: { id: Weapon.ARM_PISTOL, name: 'Pistolet d’avant-bras Viper', ranged: true, damage: 22, pellets: 1, spread: 0.016, range: 55, cooldown: 0.3, magazine: 8, reload: 1.6, price: 0, npcRange: 22 },
  [Weapon.ARM_BLADE]: { id: Weapon.ARM_BLADE, name: 'Lame d’avant-bras Mantis', ranged: false, damage: 40, pellets: 1, spread: 0, range: 2.1, cooldown: 0.5, magazine: 0, reload: 0, price: 0, npcRange: 2 },
  [Weapon.ARM_FIST]: { id: Weapon.ARM_FIST, name: 'Poing hydraulique', ranged: false, damage: 35, pellets: 1, spread: 0, range: 1.9, cooldown: 0.6, magazine: 0, reload: 0, price: 0, npcRange: 1.8 },
  [Weapon.ARM_WHIP]: { id: Weapon.ARM_WHIP, name: 'Fouet monofilament', ranged: false, damage: 28, pellets: 1, spread: 0, range: 4.5, cooldown: 0.7, magazine: 0, reload: 0, price: 0, npcRange: 4 },
};

/** Arme de bras → implant correspondant. */
export const ARM_WEAPON_IMPLANT: Partial<Record<Weapon, string>> = {
  [Weapon.ARM_PISTOL]: 'pistoletBras',
  [Weapon.ARM_BLADE]: 'lame',
  [Weapon.ARM_FIST]: 'poing',
  [Weapon.ARM_WHIP]: 'fouet',
};

/** Implant d'arme de bras → arme. */
export const IMPLANT_ARM_WEAPON: Record<string, Weapon> = {
  pistoletBras: Weapon.ARM_PISTOL,
  lame: Weapon.ARM_BLADE,
  poing: Weapon.ARM_FIST,
  fouet: Weapon.ARM_WHIP,
};

export function isArmWeapon(w: Weapon): boolean {
  return w >= Weapon.ARM_PISTOL && w <= Weapon.ARM_WHIP;
}

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
  /** Glissade (pieds en avant, une main au sol). */
  SLIDE = 7,
  /** Esquive (poussée des propulseurs). */
  DASH = 8,
  /** Course murale, mur à gauche / à droite. */
  WALLRUN_L = 9,
  WALLRUN_R = 10,
  /** Tracté par le grappin (bras tendu vers le crochet). */
  GRAPPLE = 11,
  /** En l'air (saut, chute). */
  AIR = 12,
  /** Réception d'un saut (genoux fléchis). */
  LAND = 13,
  /** Se hisse sur un rebord / escalade. */
  CLIMB = 14,
  /** Bond chargé (accroupi, puis projeté). */
  LEAP = 15,
  /** Accroupi, immobile ou en marche. */
  CROUCH = 16,
  CROUCH_WALK = 17,
  /** Saut en l'air (double saut, rebond mural). */
  AIR_JUMP = 18,
}

/** Nombre d'animations (validation des entrées). */
export const ANIM_COUNT = 19;

/** Drapeaux d'état (bits). */
export const FLAG = {
  AIM: 1,
  CROUCH: 2,
  INTERACT: 4,
  WANTED: 8,
  INSIDE: 16,
  LEADER: 32,
  /** Personnage : au volant ou passager d'un véhicule. Véhicule : occupé. */
  VEHICLE: 64,
  /** Invisible : dans un ascenseur, passager à l'intérieur d'un véhicule. */
  HIDDEN: 128,
} as const;

/** Drapeau d'entrée seulement (jamais dans les instantanés) : le parrain est en l'air. */
export const INPUT_AIR = 256;

export const LIEUTENANT_NAMES: Record<'dadou' | 'even', string[]> = {
  dadou: ['Vinnie Moretti', 'Sal Romano', 'Rocco Caruso', 'Tony Valenti', 'Nico Ferraro', 'Lenny Russo', 'Frankie Bruno', 'Joey Marino'],
  even: ['Jack Harlow', 'Ray Navarro', 'Eddie Kowalski', 'Marcus Reed', 'Leo Fitzgerald', 'Danny O’Brien', 'Sam Whitaker', 'Victor Hale'],
};

/** Le rabatteur qui recrute au QG. */
export const RECRUITER_NAME: Record<'dadou' | 'even', string> = { dadou: 'Gino le Rabatteur', even: 'Nina la Recruteuse' };

export const GANGSTER_FIRST = ['Mickey', 'Joey', 'Rico', 'Danny', 'Eddie', 'Frankie', 'Kenji', 'Luis', 'Jimmy', 'Lenny', 'Tommy', 'Andre', 'Marco', 'Dmitri', 'Ray', 'Sonny', 'Malik', 'Pete', 'Vince', 'Bobby'];
export const GANGSTER_LAST = ['Rossi', 'Kim', 'Diaz', 'Murphy', 'Cohen', 'Novak', 'Ortiz', 'Chen', 'Walsh', 'Romano', 'Brooks', 'Silva', 'Park', 'Russo', 'Nguyen', 'Kelly', 'Moreau', 'Vargas', 'Hughes', 'Okafor'];
