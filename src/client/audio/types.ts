/**
 * Types publics du moteur audio procédural de
 * « MAFIA WARS II : Dadou vs Even » (New York, 2085).
 */

export type Vec3Like = { x: number; y: number; z: number };

export type SfxName =
  // armes à feu (2085)
  | 'pistol' | 'pistol_far' | 'smg' | 'smg_far' | 'railgun' | 'rail_far' | 'shotgun' | 'turret_fire'
  // anciens noms conservés : revolver → pistolet, rifle → fusil électromagnétique
  | 'revolver' | 'revolver_far' | 'rifle' | 'rifle_far'
  // mêlée
  | 'punch' | 'knife' | 'thermal_knife' | 'club' | 'stun_baton' | 'swing'
  // impacts et destructions
  | 'hit_flesh' | 'hit_wall' | 'hit_wood' | 'hit_metal' | 'ricochet' | 'glass' | 'glass_break' | 'explosion'
  // manipulation des armes
  | 'reload' | 'empty_click' | 'weapon_switch'
  // pas
  | 'footstep_stone' | 'footstep_concrete' | 'footstep_metal' | 'footstep_wood' | 'footstep_carpet'
  // voix (non verbales)
  | 'pain' | 'death'
  // interface (HUD), téléphone, piratage
  | 'ui_click' | 'ui_hover' | 'ui_open' | 'ui_close' | 'ui_error' | 'paper'
  | 'phone_open' | 'phone_close' | 'phone_notify'
  | 'hack_beep' | 'hack_success' | 'hack_fail'
  // argent, progression et signaux
  | 'cash' | 'purchase' | 'recruit' | 'move_in' | 'heist_success'
  | 'capture' | 'territory_lost' | 'alert' | 'notify'
  | 'victory' | 'defeat'
  // ville
  | 'door_open' | 'door_close' | 'elevator_ding' | 'alarm_burst'
  | 'police_siren' | 'police_radio'
  | 'car_horn' | 'hover_pass' | 'drone_pass' | 'subway_train' | 'vehicle_door' | 'vehicle_crash'
  // anciens noms conservés : sifflet → sirène, fiacre → voiture volante, hennissement → klaxon
  | 'police_whistle' | 'horse_clop' | 'carriage_wheels' | 'neigh'
  // implants cybernétiques (sfx_cyber.ts)
  // grappin, treuil
  | 'grapple_fire' | 'grapple_hit' | 'grapple_release' | 'winch_yank'
  // armes de bras
  | 'arm_deploy' | 'arm_retract' | 'arm_pistol' | 'arm_pistol_far' | 'blade_slash' | 'blade_hit' | 'fist_heavy' | 'fist_charge' | 'whip_crack'
  // bouclier, répulseur, décharges, roquettes
  | 'shield_up' | 'shield_hit' | 'shield_break' | 'shield_down' | 'repulsor' | 'shock_zap' | 'emp_burst' | 'rocket_launch' | 'rocket_hit'
  // déplacements augmentés
  | 'dash_whoosh' | 'jump_thrust' | 'leap_charge' | 'leap_launch' | 'slide_start' | 'wallrun_step' | 'mantle_grab' | 'land_heavy' | 'ground_quake'
  // yeux, peau, système neuronal, torse
  | 'scan_ping' | 'vision_on' | 'vision_off' | 'camo_on' | 'camo_off' | 'reflex_on' | 'reflex_off' | 'overcharge_on' | 'second_wind' | 'nano_heal' | 'drone_deploy' | 'tool_hack' | 'mark_ping' | 'threat_warn'
  // clinique et écran des implants
  | 'implant_install' | 'implant_upgrade' | 'implant_remove' | 'cyber_ui_hover' | 'cyber_ui_select';

/** Tous les SfxName, dans l'ordre de déclaration (tests, menus de débogage, préchargement). */
export const SFX_NAMES: readonly SfxName[] = [
  'pistol', 'pistol_far', 'smg', 'smg_far', 'railgun', 'rail_far', 'shotgun', 'turret_fire',
  'revolver', 'revolver_far', 'rifle', 'rifle_far',
  'punch', 'knife', 'thermal_knife', 'club', 'stun_baton', 'swing',
  'hit_flesh', 'hit_wall', 'hit_wood', 'hit_metal', 'ricochet', 'glass', 'glass_break', 'explosion',
  'reload', 'empty_click', 'weapon_switch',
  'footstep_stone', 'footstep_concrete', 'footstep_metal', 'footstep_wood', 'footstep_carpet',
  'pain', 'death',
  'ui_click', 'ui_hover', 'ui_open', 'ui_close', 'ui_error', 'paper',
  'phone_open', 'phone_close', 'phone_notify',
  'hack_beep', 'hack_success', 'hack_fail',
  'cash', 'purchase', 'recruit', 'move_in', 'heist_success',
  'capture', 'territory_lost', 'alert', 'notify',
  'victory', 'defeat',
  'door_open', 'door_close', 'elevator_ding', 'alarm_burst',
  'police_siren', 'police_radio',
  'car_horn', 'hover_pass', 'drone_pass', 'subway_train', 'vehicle_door', 'vehicle_crash',
  'police_whistle', 'horse_clop', 'carriage_wheels', 'neigh',
  'grapple_fire', 'grapple_hit', 'grapple_release', 'winch_yank',
  'arm_deploy', 'arm_retract', 'arm_pistol', 'arm_pistol_far', 'blade_slash', 'blade_hit', 'fist_heavy', 'fist_charge', 'whip_crack',
  'shield_up', 'shield_hit', 'shield_break', 'shield_down', 'repulsor', 'shock_zap', 'emp_burst', 'rocket_launch', 'rocket_hit',
  'dash_whoosh', 'jump_thrust', 'leap_charge', 'leap_launch', 'slide_start', 'wallrun_step', 'mantle_grab', 'land_heavy', 'ground_quake',
  'scan_ping', 'vision_on', 'vision_off', 'camo_on', 'camo_off', 'reflex_on', 'reflex_off', 'overcharge_on', 'second_wind', 'nano_heal', 'drone_deploy', 'tool_hack', 'mark_ping', 'threat_warn',
  'implant_install', 'implant_upgrade', 'implant_remove', 'cyber_ui_hover', 'cyber_ui_select',
];

export interface PlayOptions {
  /** Position dans le monde (mètres, y vers le haut). Absente : son non positionnel (2D). */
  pos?: Vec3Like;
  /** Multiplicateur de gain linéaire, 1 par défaut. */
  volume?: number;
  /** Multiplicateur de hauteur, 1 par défaut (une petite variation aléatoire est toujours ajoutée). */
  pitch?: number;
  /** Le son se produit à l'intérieur (réverbération de pièce). Par défaut : l'état de l'auditeur. */
  indoor?: boolean;
  /** Optionnel : instant absolu (horloge de l'AudioContext) de départ, « maintenant » par défaut. */
  when?: number;
}

/**
 * Sons continus (véhicules, sources permanentes) joués en boucle par `audio.loop()`.
 * La hauteur (`pitch`) suit le régime : 1 ≈ ralenti, 2,5 = pleine vitesse.
 */
export type LoopName =
  | 'engine_car' | 'engine_moto' | 'engine_heavy' | 'vtol' | 'drone' | 'alarm' | 'siren'
  // implants : treuil du grappin, raclement de glissade, bourdonnement du bouclier et du camouflage
  | 'grapple_reel' | 'slide_scrape' | 'shield_hum' | 'camo_hum';

/** Tous les LoopName. */
export const LOOP_NAMES: readonly LoopName[] = [
  'engine_car', 'engine_moto', 'engine_heavy', 'vtol', 'drone', 'alarm', 'siren',
  'grapple_reel', 'slide_scrape', 'shield_hum', 'camo_hum',
];

export interface LoopOptions {
  /** Position dans le monde ; absente à la création : boucle non positionnelle (2D). */
  pos?: Vec3Like;
  /** Multiplicateur de gain linéaire (1 par défaut). */
  volume?: number;
  /** Régime / hauteur : 1 ≈ ralenti, 2,5 = pleine vitesse (1 par défaut). */
  pitch?: number;
}

/** Poignée d'un son en boucle renvoyée par `audio.loop()`. */
export interface LoopHandle {
  readonly name: LoopName;
  /** Faux une fois `stop()` appelé (ou le moteur détruit). */
  readonly active: boolean;
  /** Met à jour la position, le volume et/ou le régime (les champs absents ne changent pas). */
  update(p: LoopOptions): void;
  /** Arrête la boucle avec un fondu (0,25 s par défaut) puis libère tous ses nœuds. */
  stop(fadeSeconds?: number): void;
}

export interface AmbienceParams {
  /** 0 jour .. 1 nuit */
  night: number;
  /** À l'intérieur d'un bâtiment (ambiance extérieure étouffée, souffle de pièce, réverbération intérieure). */
  indoor: boolean;
  /** 0..1 clapotis du fleuve, mouettes le jour, cornes de navires. */
  nearWater: number;
  /** 0..1 intensité des combats proches (pilote l'intensité de la musique). */
  combat: number;
  /** 0..1 passants proches (rumeur de foule). */
  crowd: number;
  /** 0..1 pluie (même faible : gouttes dans les flaques). */
  rain?: number;
  /** 0..1 dans le métro : grondement, réverbération du quai, crissements de rames au loin. */
  underground?: number;
  /** Mètres au-dessus de la rue : vent sur les toits, circulation plus lointaine. */
  altitude?: number;
}

export type MusicTrackName = 'menu' | 'game' | 'tension' | 'victory' | 'defeat' | 'none';

export interface VolumeSettings {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
}
