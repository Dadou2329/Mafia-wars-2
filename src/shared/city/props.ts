// Catalogue des accessoires (mobilier, objets de rue…). Le serveur n'utilise que les
// encombrements (collisions) ; le client construit le modèle voxel détaillé de chaque type.

export type Collide = 'none' | 'solid' | 'cover';

export interface PropDef {
  /** Encombrement en mètres : largeur (x local), hauteur, profondeur (z local). */
  size: [number, number, number];
  collide: Collide;
  /** Hauteur réelle de la collision (par défaut = hauteur). */
  collideH?: number;
  /** Source lumineuse : décalage local (m) et intensité/rayon. */
  light?: { y: number; z?: number; intensity: number; radius: number };
  /** L'accessoire prend les couleurs d'une faction (bannières…). */
  tinted?: boolean;
}

export const PROP_DEFS = {
  // --- rue
  LAMP_POST: { size: [0.5, 3.8, 0.5], collide: 'solid', light: { y: 3.35, intensity: 1, radius: 9.5 } },
  LAMP_WALL: { size: [0.4, 0.9, 0.6], collide: 'none', light: { y: 0.3, z: 0.35, intensity: 0.85, radius: 7.5 } },
  LAMP_DOUBLE: { size: [1.4, 4.4, 0.5], collide: 'solid', light: { y: 3.9, intensity: 1.2, radius: 11 } },
  BENCH: { size: [1.7, 0.95, 0.65], collide: 'solid' },
  BOLLARD: { size: [0.3, 0.9, 0.3], collide: 'solid' },
  PILLAR_BOX: { size: [0.55, 1.5, 0.55], collide: 'solid' },
  HORSE_TROUGH: { size: [1.9, 0.8, 0.75], collide: 'cover' },
  WATER_PUMP: { size: [0.5, 1.6, 0.7], collide: 'solid' },
  BARREL: { size: [0.62, 0.95, 0.62], collide: 'cover' },
  CRATE: { size: [0.85, 0.85, 0.85], collide: 'cover' },
  CRATE_SMALL: { size: [0.55, 0.5, 0.55], collide: 'solid' },
  CRATE_STACK: { size: [1.0, 1.7, 1.0], collide: 'cover' },
  SACKS: { size: [1.1, 0.65, 0.85], collide: 'cover' },
  HANDCART: { size: [1.0, 1.0, 1.9], collide: 'cover' },
  MARKET_STALL: { size: [2.5, 2.7, 1.5], collide: 'solid', collideH: 1.0 },
  NEWS_STAND: { size: [1.3, 2.1, 0.7], collide: 'solid' },
  STATUE: { size: [1.6, 4.6, 1.6], collide: 'solid' },
  STATUE_HORSE: { size: [1.8, 5.4, 3.4], collide: 'solid' },
  STREET_CLOCK: { size: [0.6, 4.2, 0.6], collide: 'solid' },
  RAILING: { size: [2.0, 1.25, 0.12], collide: 'solid' },
  ROPE_COIL: { size: [0.8, 0.3, 0.8], collide: 'none' },
  ANCHOR: { size: [1.2, 1.6, 0.4], collide: 'solid' },
  FISH_CRATES: { size: [1.2, 0.6, 0.8], collide: 'cover' },
  CART_WHEEL: { size: [0.15, 1.1, 1.1], collide: 'none' },
  GAS_LANTERN_PIER: { size: [0.4, 2.6, 0.4], collide: 'solid', light: { y: 2.3, intensity: 0.8, radius: 8 } },
  TREE_PLANTER: { size: [1.0, 0.5, 1.0], collide: 'solid' },
  POSTER_BOARD: { size: [1.6, 2.4, 0.3], collide: 'solid' },
  STREET_SIGN: { size: [0.9, 2.8, 0.15], collide: 'solid', collideH: 2.0 },
  HANGING_SIGN: { size: [0.9, 1.2, 0.9], collide: 'none', tinted: true },
  BANNER: { size: [1.0, 2.2, 0.15], collide: 'none', tinted: true },
  FLAG_POLE: { size: [0.3, 5.5, 1.5], collide: 'solid', tinted: true },
  DOOR_LEAF: { size: [1.5, 2.5, 0.12], collide: 'none' },

  // --- mobilier
  CHAIR: { size: [0.48, 0.98, 0.5], collide: 'solid' },
  STOOL: { size: [0.42, 0.75, 0.42], collide: 'solid' },
  ARMCHAIR: { size: [0.9, 1.05, 0.9], collide: 'solid' },
  CHESTERFIELD: { size: [2.0, 0.9, 0.95], collide: 'cover' },
  TABLE_ROUND: { size: [1.05, 0.78, 1.05], collide: 'cover' },
  TABLE_SQUARE: { size: [1.2, 0.78, 0.85], collide: 'cover' },
  TABLE_LONG: { size: [2.5, 0.8, 1.05], collide: 'cover' },
  TABLE_DINING: { size: [3.2, 0.8, 1.2], collide: 'cover' },
  DESK: { size: [1.7, 0.82, 0.85], collide: 'cover' },
  DESK_BOSS: { size: [2.6, 0.88, 1.3], collide: 'cover' },
  BOSS_CHAIR: { size: [0.85, 1.4, 0.8], collide: 'solid' },
  BED: { size: [1.3, 1.2, 2.1], collide: 'solid', collideH: 0.65 },
  BED_POOR: { size: [0.85, 0.6, 1.95], collide: 'solid' },
  BUNK_BED: { size: [0.95, 1.85, 2.0], collide: 'solid' },
  WARDROBE: { size: [1.3, 2.2, 0.62], collide: 'solid' },
  BOOKSHELF: { size: [1.3, 2.4, 0.45], collide: 'solid' },
  CABINET: { size: [1.1, 1.05, 0.5], collide: 'solid' },
  FILING_CABINET: { size: [0.6, 1.4, 0.65], collide: 'solid' },
  SIDEBOARD: { size: [1.7, 0.95, 0.52], collide: 'solid' },
  PIANO: { size: [1.55, 1.35, 0.65], collide: 'solid' },
  GRAND_PIANO: { size: [1.5, 1.05, 2.1], collide: 'cover' },
  CHANDELIER: { size: [1.3, 1.1, 1.3], collide: 'none', light: { y: 0.15, intensity: 1, radius: 9 } },
  OIL_LAMP: { size: [0.25, 0.5, 0.25], collide: 'none', light: { y: 0.35, intensity: 0.6, radius: 5 } },
  CANDELABRA: { size: [0.4, 0.6, 0.2], collide: 'none', light: { y: 0.5, intensity: 0.55, radius: 4.5 } },
  WALL_SCONCE: { size: [0.3, 0.45, 0.25], collide: 'none', light: { y: 0.3, z: 0.15, intensity: 0.65, radius: 6 } },
  HANGING_LAMP: { size: [0.5, 0.9, 0.5], collide: 'none', light: { y: 0.1, intensity: 0.85, radius: 8 } },
  PAINTING: { size: [1.1, 0.85, 0.08], collide: 'none' },
  PORTRAIT: { size: [0.75, 1.0, 0.08], collide: 'none' },
  MIRROR: { size: [0.9, 1.3, 0.06], collide: 'none' },
  GRANDFATHER_CLOCK: { size: [0.55, 2.15, 0.4], collide: 'solid' },
  PLANT_POT: { size: [0.55, 1.15, 0.55], collide: 'solid' },
  BOTTLE_SHELF: { size: [1.8, 2.0, 0.38], collide: 'solid' },
  BEER_TAPS: { size: [0.6, 0.5, 0.25], collide: 'none' },
  DARTBOARD: { size: [0.5, 0.5, 0.06], collide: 'none' },
  CARD_TABLE: { size: [1.3, 0.8, 1.3], collide: 'cover' },
  ROULETTE: { size: [1.1, 0.95, 2.2], collide: 'cover' },
  SAFE: { size: [0.85, 1.25, 0.75], collide: 'cover' },
  DISPLAY_CASE: { size: [1.3, 1.05, 0.62], collide: 'cover' },
  SEWING_TABLE: { size: [1.0, 1.05, 0.62], collide: 'cover' },
  LOOM: { size: [2.0, 1.85, 1.5], collide: 'solid' },
  ANVIL: { size: [0.7, 0.8, 0.35], collide: 'solid' },
  WORKBENCH: { size: [2.1, 0.95, 0.85], collide: 'cover' },
  MEAT_RACK: { size: [1.5, 2.2, 0.5], collide: 'solid' },
  BREAD_SHELF: { size: [1.5, 1.9, 0.45], collide: 'solid' },
  PEW: { size: [3.0, 1.0, 0.7], collide: 'cover' },
  ALTAR: { size: [2.0, 1.1, 0.9], collide: 'cover' },
  PULPIT: { size: [1.1, 1.8, 1.1], collide: 'solid' },
  SEAT_ROW: { size: [2.4, 1.0, 0.65], collide: 'cover' },
  GLOBE: { size: [0.6, 1.1, 0.6], collide: 'solid' },
  TYPEWRITER: { size: [0.4, 0.25, 0.35], collide: 'none' },
  WEAPON_RACK: { size: [1.7, 2.0, 0.45], collide: 'solid', tinted: true },
  AMMO_CRATE: { size: [0.9, 0.5, 0.55], collide: 'cover' },
  TROPHY_CASE: { size: [1.4, 2.0, 0.5], collide: 'solid', tinted: true },
  CELL_BARS: { size: [2.0, 2.6, 0.15], collide: 'solid' },
  CANNON: { size: [0.9, 1.0, 2.3], collide: 'cover' },
  TELEGRAPH: { size: [0.5, 0.35, 0.35], collide: 'none' },
  COAT_STAND: { size: [0.45, 1.85, 0.45], collide: 'solid' },
  UMBRELLA_STAND: { size: [0.35, 0.7, 0.35], collide: 'solid' },
  FIRE_SCREEN: { size: [0.9, 0.8, 0.15], collide: 'none' },
  BUCKET: { size: [0.35, 0.4, 0.35], collide: 'none' },
  WASH_STAND: { size: [0.9, 1.0, 0.5], collide: 'solid' },
  CHEST: { size: [1.0, 0.65, 0.6], collide: 'solid' },
  SHIP_WHEEL: { size: [1.2, 1.5, 0.4], collide: 'solid' },
  MAP_STAND: { size: [1.0, 1.9, 0.6], collide: 'solid' },
  POLICE_DESK: { size: [2.2, 1.1, 0.8], collide: 'cover' },
  TICKET_BOOTH: { size: [1.6, 2.4, 1.4], collide: 'solid' },
  CURTAIN: { size: [2.0, 3.2, 0.2], collide: 'none' },
  SPITTOON: { size: [0.3, 0.3, 0.3], collide: 'none' },
  BAR_STOOL_ROW: { size: [0.4, 0.8, 0.4], collide: 'solid' },
} satisfies Record<string, PropDef>;

export type PropKind = keyof typeof PROP_DEFS;
export const PROP_KINDS = Object.keys(PROP_DEFS) as PropKind[];
export const PROP_INDEX: Record<PropKind, number> = Object.fromEntries(PROP_KINDS.map((k, i) => [k, i])) as Record<
  PropKind,
  number
>;
export const PROP_LIST: PropDef[] = PROP_KINDS.map((k) => PROP_DEFS[k] as PropDef);
