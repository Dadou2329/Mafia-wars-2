// Catalogue des accessoires (mobilier urbain, meubles, équipements) de New York 2085.
// Le serveur n'utilise que les encombrements (collisions) ; le client construit le modèle
// voxel détaillé de chaque type (il peut dépasser de l'encombrement : bras de lampadaire…).

export type Collide = 'none' | 'solid' | 'cover';

export interface PropDef {
  /** Encombrement en mètres : largeur (x local), hauteur, profondeur (z local). */
  size: [number, number, number];
  collide: Collide;
  /** Hauteur réelle de la collision (par défaut = hauteur). */
  collideH?: number;
  /** Source lumineuse : décalage local (m), intensité, rayon et couleur (sRGB). */
  light?: { y: number; z?: number; intensity: number; radius: number; color?: number };
  /** L'accessoire prend les couleurs d'une faction (bannières…). */
  tinted?: boolean;
  /** La variante choisit la couleur de la lumière parmi NEON_COLORS. */
  neonVariant?: boolean;
}

/** Couleurs des néons selon la variante (sRGB). */
export const NEON_COLORS = [0xff3cc8, 0x3ce8ff, 0xff2a40, 0x4a7aff, 0x40ff80, 0xffd040, 0xa848ff, 0xff8a20];

export const PROP_DEFS = {
  // ------------------------------------------------------------------ rue
  STREET_LIGHT: { size: [0.4, 7.4, 0.4], collide: 'solid', light: { y: 7.0, z: 2.1, intensity: 1, radius: 13, color: 0xdfe8ff } },
  STREET_LIGHT_DOUBLE: { size: [0.5, 7.4, 0.5], collide: 'solid', light: { y: 7.0, intensity: 1.2, radius: 14, color: 0xdfe8ff } },
  PARK_LAMP: { size: [0.4, 3.6, 0.4], collide: 'solid', light: { y: 3.3, intensity: 0.9, radius: 9, color: 0xffd8a8 } },
  TRAFFIC_LIGHT: { size: [0.4, 5.8, 0.4], collide: 'solid' },
  HYDRANT: { size: [0.45, 0.85, 0.45], collide: 'solid' },
  TRASH_CAN: { size: [0.6, 1.0, 0.6], collide: 'solid' },
  MAILBOX: { size: [0.6, 1.25, 0.6], collide: 'solid' },
  HOLO_KIOSK: { size: [1.2, 2.5, 0.8], collide: 'solid', light: { y: 1.6, z: 0.6, intensity: 0.6, radius: 4.5, color: 0x50e0ff } },
  VENDING_MACHINE: { size: [1.0, 2.0, 0.8], collide: 'solid', neonVariant: true, light: { y: 1.3, z: 0.6, intensity: 0.55, radius: 4 } },
  FOOD_CART: { size: [2.0, 2.4, 1.0], collide: 'solid', collideH: 1.1, light: { y: 2.0, z: 0.6, intensity: 0.6, radius: 4.5, color: 0xffc070 } },
  BENCH: { size: [1.8, 0.9, 0.6], collide: 'solid' },
  BOLLARD: { size: [0.3, 0.9, 0.3], collide: 'solid' },
  STEAM_VENT: { size: [0.8, 0.1, 0.8], collide: 'none' },
  BIKE_RACK: { size: [2.0, 0.9, 0.5], collide: 'solid' },
  HOLO_BOOTH: { size: [1.0, 2.3, 1.0], collide: 'solid', light: { y: 2.0, intensity: 0.5, radius: 3.5, color: 0x60c8ff } },
  PLANTER: { size: [1.2, 0.8, 1.2], collide: 'solid' },
  SUBWAY_GLOBE: { size: [0.35, 2.8, 0.35], collide: 'solid', light: { y: 2.6, intensity: 0.7, radius: 6, color: 0x80ffa0 } },
  RAILING: { size: [2.0, 1.1, 0.1], collide: 'solid' },
  JERSEY_BARRIER: { size: [2.0, 0.85, 0.6], collide: 'cover' },
  TRAFFIC_CONE: { size: [0.4, 0.7, 0.4], collide: 'none' },
  DUMPSTER: { size: [2.0, 1.4, 1.2], collide: 'cover' },
  AD_COLUMN: { size: [1.0, 3.0, 1.0], collide: 'solid', neonVariant: true, light: { y: 2.0, intensity: 0.6, radius: 4.5 } },
  BUS_SHELTER: { size: [3.6, 2.6, 1.5], collide: 'none', light: { y: 2.4, intensity: 0.6, radius: 5, color: 0xdfe8ff } },
  NEWS_STAND: { size: [2.2, 2.4, 1.6], collide: 'solid', light: { y: 2.1, z: 0.8, intensity: 0.6, radius: 4.5, color: 0xffd8a0 } },
  SIGN_STREET: { size: [0.2, 3.2, 0.2], collide: 'solid' },
  PARKING_METER: { size: [0.25, 1.4, 0.25], collide: 'solid' },
  CHARGING_POST: { size: [0.5, 1.6, 0.4], collide: 'solid', light: { y: 1.3, intensity: 0.3, radius: 2.5, color: 0x50ff90 } },
  SCAFFOLD: { size: [3.0, 3.2, 1.5], collide: 'none' },
  CAR_PARKED: { size: [2.0, 1.5, 4.4], collide: 'solid' },
  TAXI_PARKED: { size: [2.0, 1.5, 4.4], collide: 'solid' },
  VAN_PARKED: { size: [2.2, 2.4, 5.4], collide: 'solid' },

  // ------------------------------------------------------------------ toits et façades
  AC_UNIT: { size: [1.0, 0.7, 0.8], collide: 'solid' },
  AC_WINDOW: { size: [0.7, 0.45, 0.5], collide: 'none' },
  ROOF_VENT: { size: [0.6, 1.2, 0.6], collide: 'solid' },
  SAT_DISH: { size: [1.2, 1.4, 1.0], collide: 'solid' },
  ANTENNA: { size: [0.3, 4.0, 0.3], collide: 'solid' },
  NEON_SIGN: { size: [0.3, 3.0, 1.4], collide: 'none', neonVariant: true, light: { y: 1.5, z: 0.7, intensity: 0.9, radius: 7 } },
  NEON_WALL_SIGN: { size: [2.0, 0.8, 0.15], collide: 'none', neonVariant: true, light: { y: 0.4, z: 0.3, intensity: 0.8, radius: 6 } },
  LANTERN_RED: { size: [0.5, 0.8, 0.5], collide: 'none', light: { y: 0.4, intensity: 0.65, radius: 5, color: 0xff4030 } },
  LANTERN_STRING: { size: [4.0, 0.6, 0.2], collide: 'none', light: { y: 0.2, intensity: 0.5, radius: 5, color: 0xff6040 } },
  SECURITY_CAMERA: { size: [0.3, 0.3, 0.5], collide: 'none', tinted: true },
  FLAG_BANNER: { size: [1.0, 2.6, 0.15], collide: 'none', tinted: true },
  DOOR_LEAF: { size: [1.5, 2.5, 0.12], collide: 'none' },
  ELEVATOR_DOOR: { size: [1.6, 2.4, 0.15], collide: 'none', light: { y: 2.6, z: 0.2, intensity: 0.4, radius: 3, color: 0xdfe8ff } },
  ROLLUP_DOOR: { size: [3.6, 3.4, 0.15], collide: 'none' },

  // ------------------------------------------------------------------ séjour, chambre
  SOFA: { size: [2.2, 0.85, 0.95], collide: 'cover' },
  SOFA_LUXE: { size: [2.6, 0.85, 1.0], collide: 'cover' },
  SOFA_OLD: { size: [1.9, 0.9, 0.9], collide: 'cover' },
  ARMCHAIR: { size: [0.9, 0.95, 0.9], collide: 'solid' },
  COFFEE_TABLE: { size: [1.2, 0.45, 0.7], collide: 'cover' },
  TV_WALL: { size: [1.8, 1.0, 0.1], collide: 'none', light: { y: 0.5, z: 0.4, intensity: 0.35, radius: 3.5, color: 0x80b0ff } },
  TV_OLD: { size: [0.8, 0.6, 0.5], collide: 'solid', light: { y: 0.4, z: 0.4, intensity: 0.3, radius: 3, color: 0x90b8ff } },
  TV_STAND: { size: [1.8, 0.5, 0.45], collide: 'solid' },
  BED: { size: [1.8, 0.9, 2.2], collide: 'solid', collideH: 0.6 },
  BED_KING: { size: [2.2, 1.2, 2.4], collide: 'solid', collideH: 0.65 },
  MATTRESS: { size: [1.0, 0.3, 2.0], collide: 'none' },
  NIGHTSTAND: { size: [0.5, 0.55, 0.45], collide: 'solid' },
  WARDROBE: { size: [1.6, 2.3, 0.6], collide: 'solid' },
  DINING_TABLE: { size: [2.4, 0.76, 1.0], collide: 'cover' },
  TABLE_SMALL: { size: [0.9, 0.76, 0.9], collide: 'cover' },
  FOLDING_TABLE: { size: [1.2, 0.74, 0.7], collide: 'cover' },
  CHAIR: { size: [0.5, 0.9, 0.5], collide: 'solid' },
  CHAIR_PLASTIC: { size: [0.5, 0.82, 0.5], collide: 'solid' },
  KITCHEN_COUNTER: { size: [2.4, 0.95, 0.65], collide: 'solid' },
  KITCHEN_ISLAND: { size: [2.2, 0.95, 1.0], collide: 'cover' },
  KITCHENETTE: { size: [1.8, 1.0, 0.6], collide: 'solid' },
  FRIDGE: { size: [0.8, 1.9, 0.7], collide: 'solid' },
  BAR_COUNTER: { size: [2.0, 1.1, 0.7], collide: 'cover', neonVariant: true, light: { y: 0.6, z: 0.4, intensity: 0.4, radius: 3.5 } },
  BAR_STOOL: { size: [0.45, 0.8, 0.45], collide: 'solid' },
  BOTTLE_SHELF: { size: [2.0, 2.2, 0.4], collide: 'solid', light: { y: 1.6, z: 0.3, intensity: 0.5, radius: 4, color: 0xffb070 } },
  PLANT_BIG: { size: [0.7, 1.6, 0.7], collide: 'solid' },
  LAMP_FLOOR: { size: [0.4, 1.7, 0.4], collide: 'solid', light: { y: 1.5, intensity: 0.55, radius: 5, color: 0xffd0a0 } },
  CEILING_LIGHT: { size: [1.2, 0.1, 1.2], collide: 'none', light: { y: -0.2, intensity: 0.85, radius: 7, color: 0xf0f2ff } },
  PENDANT_LIGHT: { size: [0.5, 0.8, 0.5], collide: 'none', light: { y: 0.05, intensity: 0.8, radius: 6.5, color: 0xffd8a8 } },
  BARE_BULB: { size: [0.2, 0.5, 0.2], collide: 'none', light: { y: 0.05, intensity: 0.65, radius: 5.5, color: 0xffc080 } },
  NEON_TUBE_CEILING: { size: [1.8, 0.1, 0.2], collide: 'none', neonVariant: true, light: { y: -0.1, intensity: 0.7, radius: 6 } },
  CHANDELIER: { size: [1.6, 1.2, 1.6], collide: 'none', light: { y: 0.1, intensity: 1, radius: 10, color: 0xffe0b0 } },
  WALL_ART: { size: [1.2, 0.8, 0.06], collide: 'none' },
  NEON_ART: { size: [1.4, 1.0, 0.1], collide: 'none', neonVariant: true, light: { y: 0.5, z: 0.3, intensity: 0.6, radius: 4.5 } },
  PORTRAIT_BOSS: { size: [0.9, 1.2, 0.08], collide: 'none', tinted: true },
  AQUARIUM: { size: [2.0, 1.4, 0.6], collide: 'solid', light: { y: 1.0, z: 0.4, intensity: 0.5, radius: 4.5, color: 0x40c0ff } },
  GRAND_PIANO: { size: [1.5, 1.05, 2.1], collide: 'cover' },
  PIANO: { size: [1.55, 1.3, 0.65], collide: 'solid' },
  BATHTUB: { size: [1.7, 0.6, 0.8], collide: 'solid' },
  TOILET: { size: [0.4, 0.8, 0.65], collide: 'solid' },
  SINK: { size: [0.6, 0.9, 0.5], collide: 'solid' },
  SHOWER: { size: [1.0, 2.2, 1.0], collide: 'solid' },
  WASHING_MACHINE: { size: [0.6, 0.85, 0.6], collide: 'solid' },
  BOOKSHELF: { size: [1.3, 2.3, 0.45], collide: 'solid' },
  CARDBOARD_BOXES: { size: [1.0, 0.8, 0.8], collide: 'cover' },
  PIZZA_BOXES: { size: [0.5, 0.3, 0.5], collide: 'none' },
  TRASH_PILE: { size: [1.0, 0.5, 0.8], collide: 'none' },
  SPEAKER: { size: [0.5, 1.1, 0.45], collide: 'solid' },
  RUG: { size: [2.6, 0.03, 1.8], collide: 'none' },
  FIREPLACE: { size: [1.8, 1.0, 0.45], collide: 'solid', light: { y: 0.4, z: 0.3, intensity: 0.75, radius: 6, color: 0xff9040 } },
  TROPHY_CASE: { size: [1.4, 2.0, 0.5], collide: 'solid', tinted: true, light: { y: 1.4, z: 0.3, intensity: 0.35, radius: 3, color: 0xffe0a0 } },
  STATUE_BUST: { size: [0.6, 1.6, 0.6], collide: 'solid' },

  // ------------------------------------------------------------------ bureau, commandement, armurerie
  DESK: { size: [1.6, 0.76, 0.8], collide: 'cover' },
  DESK_BOSS: { size: [2.6, 0.88, 1.3], collide: 'cover' },
  OFFICE_CHAIR: { size: [0.6, 1.1, 0.6], collide: 'solid' },
  BOSS_CHAIR: { size: [0.85, 1.4, 0.8], collide: 'solid' },
  COMPUTER: { size: [0.6, 0.45, 0.3], collide: 'none', light: { y: 0.3, z: 0.2, intensity: 0.3, radius: 2.5, color: 0x80c0ff } },
  LAPTOP_TABLE: { size: [1.2, 0.76, 0.7], collide: 'cover', light: { y: 0.9, intensity: 0.35, radius: 2.5, color: 0x80c0ff } },
  MAP_TABLE: { size: [2.0, 0.9, 1.2], collide: 'cover', light: { y: 1.4, intensity: 0.5, radius: 4, color: 0xfff0d0 } },
  COMMAND_DESK: { size: [2.4, 1.3, 1.0], collide: 'cover', light: { y: 1.1, z: -0.3, intensity: 0.55, radius: 4, color: 0x60c0ff } },
  HOLO_TABLE: { size: [3.0, 1.0, 2.0], collide: 'cover', light: { y: 1.4, intensity: 0.85, radius: 7, color: 0x40d8ff } },
  SCREEN_WALL: { size: [3.0, 2.0, 0.2], collide: 'none', light: { y: 1.0, z: 0.5, intensity: 0.6, radius: 5, color: 0x70b8ff } },
  SERVER_RACK: { size: [0.7, 2.1, 1.0], collide: 'solid', light: { y: 1.2, z: 0.6, intensity: 0.3, radius: 2.5, color: 0x40ff90 } },
  FILING_CABINET: { size: [0.5, 1.3, 0.6], collide: 'solid' },
  SAFE: { size: [0.85, 1.25, 0.75], collide: 'cover' },
  VAULT_DOOR: { size: [2.6, 2.6, 0.6], collide: 'solid' },
  WEAPON_RACK: { size: [1.7, 2.0, 0.45], collide: 'solid', tinted: true },
  WEAPON_LOCKER: { size: [1.0, 2.0, 0.6], collide: 'solid', tinted: true, light: { y: 1.8, z: 0.35, intensity: 0.25, radius: 2.5, color: 0xff4040 } },
  AMMO_CRATE: { size: [0.9, 0.5, 0.55], collide: 'cover' },
  DUFFEL_BAG: { size: [0.8, 0.4, 0.4], collide: 'none' },
  WORKBENCH: { size: [2.1, 0.95, 0.85], collide: 'cover', light: { y: 1.5, z: -0.2, intensity: 0.45, radius: 4, color: 0xf0f0ff } },
  TOOL_WALL: { size: [2.0, 1.5, 0.1], collide: 'none' },
  CAR_LIFT: { size: [2.6, 0.3, 4.6], collide: 'none' },
  TIRE_STACK: { size: [0.7, 1.0, 0.7], collide: 'solid' },
  BARREL: { size: [0.62, 0.95, 0.62], collide: 'cover' },
  CRATE: { size: [0.85, 0.85, 0.85], collide: 'cover' },
  CRATE_STACK: { size: [1.0, 1.7, 1.0], collide: 'cover' },
  PALLET_STACK: { size: [1.2, 1.4, 1.0], collide: 'cover' },
  CONTAINER: { size: [2.4, 2.6, 6.0], collide: 'solid' },
  FORKLIFT: { size: [1.2, 2.2, 2.6], collide: 'solid' },
  SHELF_RACK: { size: [2.6, 3.0, 1.0], collide: 'solid' },

  // ------------------------------------------------------------------ commerces et loisirs
  DJ_BOOTH: { size: [2.4, 1.2, 1.0], collide: 'cover', neonVariant: true, light: { y: 1.2, intensity: 0.7, radius: 6 } },
  SPEAKER_STACK: { size: [1.0, 2.0, 0.8], collide: 'solid' },
  STAGE_LIGHTS: { size: [3.0, 0.5, 0.5], collide: 'none', neonVariant: true, light: { y: -0.3, intensity: 0.9, radius: 8 } },
  CASINO_TABLE: { size: [2.2, 0.95, 1.2], collide: 'cover', light: { y: 1.0, intensity: 0.45, radius: 3.5, color: 0x40ff90 } },
  SLOT_MACHINE: { size: [0.8, 1.8, 0.8], collide: 'solid', neonVariant: true, light: { y: 1.4, z: 0.4, intensity: 0.45, radius: 3.5 } },
  ROULETTE: { size: [1.1, 0.95, 2.2], collide: 'cover' },
  CARD_TABLE: { size: [1.4, 0.8, 1.4], collide: 'cover' },
  POOL_TABLE: { size: [2.5, 0.85, 1.4], collide: 'cover', light: { y: 1.6, intensity: 0.45, radius: 3.5, color: 0xfff0c0 } },
  PUNCHING_BAG: { size: [0.5, 2.3, 0.5], collide: 'solid' },
  WEIGHT_BENCH: { size: [1.6, 1.0, 0.6], collide: 'solid' },
  RING_POST: { size: [0.3, 1.6, 0.3], collide: 'solid' },
  MAHJONG_TABLE: { size: [1.0, 0.8, 1.0], collide: 'cover' },
  TEA_TABLE: { size: [1.2, 0.4, 1.2], collide: 'cover' },
  CUSHION: { size: [0.6, 0.15, 0.6], collide: 'none' },
  MARKET_STALL: { size: [2.4, 2.4, 1.4], collide: 'solid', collideH: 1.0, neonVariant: true, light: { y: 2.1, z: 0.5, intensity: 0.55, radius: 4.5 } },
  FOOD_STALL: { size: [2.4, 2.4, 1.4], collide: 'solid', collideH: 1.0, light: { y: 2.1, z: 0.5, intensity: 0.6, radius: 4.5, color: 0xffb060 } },
  DISPLAY_CASE: { size: [1.3, 1.05, 0.62], collide: 'cover', light: { y: 0.9, intensity: 0.3, radius: 2.5, color: 0xe0f0ff } },
  CLOTHES_RACK: { size: [1.6, 1.6, 0.5], collide: 'solid' },
  STORE_SHELF: { size: [2.0, 1.8, 0.5], collide: 'solid' },
  CHECKOUT: { size: [1.8, 1.0, 0.7], collide: 'cover' },
  MEDICAL_BED: { size: [1.0, 0.9, 2.1], collide: 'solid' },
  SURGERY_ARM: { size: [1.0, 2.2, 1.0], collide: 'solid', light: { y: 2.0, intensity: 0.5, radius: 3.5, color: 0xe8f8ff } },
  HOLO_CAMERA: { size: [0.8, 1.8, 0.8], collide: 'solid' },
  NEWS_DESK: { size: [3.0, 1.1, 1.0], collide: 'cover', light: { y: 1.2, intensity: 0.4, radius: 3.5, color: 0xa0c8ff } },
  STUDIO_LIGHT: { size: [0.8, 2.2, 0.8], collide: 'solid', light: { y: 2.0, z: 0.3, intensity: 0.8, radius: 7, color: 0xfff4e0 } },
  TRADING_DESK: { size: [2.0, 1.2, 0.9], collide: 'cover', light: { y: 1.1, z: -0.2, intensity: 0.35, radius: 3, color: 0x60ff90 } },
  RECEPTION_DESK: { size: [3.0, 1.1, 0.8], collide: 'cover', light: { y: 1.0, intensity: 0.35, radius: 3.5, color: 0xffe8c8 } },
  LUGGAGE_CART: { size: [1.0, 1.8, 0.6], collide: 'solid' },
  ART_PEDESTAL: { size: [0.8, 1.1, 0.8], collide: 'solid', light: { y: 2.2, intensity: 0.35, radius: 3, color: 0xfff4e0 } },
  SCULPTURE: { size: [1.0, 2.0, 1.0], collide: 'solid' },
  JUKEBOX: { size: [0.9, 1.6, 0.6], collide: 'solid', light: { y: 1.1, z: 0.4, intensity: 0.45, radius: 3.5, color: 0xff60c0 } },
  MIC_STAND: { size: [0.4, 1.6, 0.4], collide: 'none' },
  SEAT_ROW: { size: [2.4, 1.0, 0.65], collide: 'cover' },
  TICKET_BOOTH: { size: [1.6, 2.4, 1.4], collide: 'solid', light: { y: 2.0, intensity: 0.45, radius: 3.5, color: 0xffd090 } },
  BOAT: { size: [1.2, 0.6, 3.2], collide: 'none' },
  BREW_TANK: { size: [1.6, 3.2, 1.6], collide: 'solid' },
  CONVEYOR: { size: [3.0, 1.0, 1.0], collide: 'solid' },
  ROBOT_ARM: { size: [1.0, 2.0, 1.0], collide: 'solid' },
  DRONE_PARKED: { size: [1.2, 0.5, 1.2], collide: 'none', light: { y: 0.3, intensity: 0.2, radius: 2, color: 0x40ff90 } },
  TATTOO_CHAIR: { size: [0.8, 1.2, 1.6], collide: 'solid' },
  WASHER_ROW: { size: [2.4, 1.0, 0.7], collide: 'solid' },
  HERB_SHELF: { size: [2.0, 2.2, 0.45], collide: 'solid' },
  POLICE_DESK: { size: [2.2, 1.1, 0.8], collide: 'cover' },
  CELL_BARS: { size: [2.0, 2.6, 0.15], collide: 'solid' },
  BUNK_BED: { size: [0.95, 1.85, 2.0], collide: 'solid' },

  // ------------------------------------------------------------------ monuments
  STATUE: { size: [1.6, 4.6, 1.6], collide: 'solid' },
  BULL_STATUE: { size: [1.6, 1.9, 3.4], collide: 'solid' },
  FOUNTAIN_ANGEL: { size: [1.4, 4.0, 1.4], collide: 'solid' },
  BALL_TOWER: { size: [2.0, 2.0, 2.0], collide: 'none', light: { y: 1.0, intensity: 1, radius: 10, color: 0xffffff } },
} satisfies Record<string, PropDef>;

export type PropKind = keyof typeof PROP_DEFS;
export const PROP_KINDS = Object.keys(PROP_DEFS) as PropKind[];
export const PROP_INDEX: Record<PropKind, number> = Object.fromEntries(PROP_KINDS.map((k, i) => [k, i])) as Record<
  PropKind,
  number
>;
export const PROP_LIST: PropDef[] = PROP_KINDS.map((k) => PROP_DEFS[k] as PropDef);
