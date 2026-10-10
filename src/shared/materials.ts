// Palette des matériaux voxel du monde (New York 2085).
// Chaque voxel stocke un identifiant de matériau (0 = air). Le client transforme cette
// table en texture et le shader applique un motif procédural (briques, asphalte, néons…)
// calculé à partir de la position dans le monde.

export const enum Pattern {
  NONE = 0,
  BRICK = 1,
  COBBLE = 2,
  PLANK = 3,
  SLATE = 4,
  ASHLAR = 5,
  STRIPES = 6,
  DAMASK = 7,
  CARPET = 8,
  CHECKER = 9,
  PLASTER = 10,
  METAL = 11,
  GLASS = 12,
  FOLIAGE = 13,
  PANEL = 14,
  ROOF_TILE = 15,
  CORRUGATED = 16,
  PAINT = 17,
  DIRT = 18,
  BOOKS = 19,
  MARBLE = 20,
  PARQUET = 21,
  FLAGSTONE = 22,
  GRASS = 23,
  FIRE = 24,
  BARK = 25,
  CLOTH = 26,
  POSTER = 27,
  STAINED = 28,
  AWNING = 29,
  // --- 2085
  ASPHALT = 30,
  CONCRETE = 31,
  TILE = 32,
  METAL_PANEL = 33,
  CURTAIN = 34,
  NEON = 35,
  SCREEN = 36,
  GRATE = 37,
  ROAD_PAINT = 38,
  LED = 39,
  TERRAZZO = 40,
  RUBBER = 41,
  GRAFFITI = 42,
  SLATS = 43,
  HEX = 44,
  SOLAR = 45,
  SIDEWALK = 46,
  WATER = 47,
}

export const enum Emissive {
  NONE = 0,
  ALWAYS = 1,
  NIGHT = 2, // fenêtres éclairées : brillent surtout la nuit
  FIRE = 3, // flamme vacillante
  NEON = 4, // tube néon : toujours allumé, léger scintillement
  SCREEN = 5, // écran LED animé
  PULSE = 6, // respiration lente (bandeaux LED)
}

export interface MaterialDef {
  name: string;
  color: number; // sRGB 0xRRGGBB
  color2?: number; // couleur secondaire du motif (joints, rayures…)
  pattern: Pattern;
  scale?: number; // paramètre de motif (0..255)
  emissive?: number; // couleur émissive sRGB
  emissiveMode?: Emissive;
  spec?: number; // reflet spéculaire factice 0..1
  grime?: number; // salissure extérieure 0..1
  noise?: number; // variation de couleur par voxel 0..1
  /** solide pour les déplacements */
  solid?: boolean;
  /** laisse passer la lumière (verre, collisions invisibles…) */
  lightPass?: boolean;
  /** laisse passer les balles */
  bulletPass?: boolean;
  /** invisible (pas de maillage) */
  invisible?: boolean;
  /** surface mouillée par la pluie (chaussées, trottoirs, toits plats) */
  wettable?: boolean;
}

const DEFS = {
  AIR: { name: 'air', color: 0, pattern: Pattern.NONE, solid: false, lightPass: true, bulletPass: true, invisible: true },

  // --- Sol, rues, nature -------------------------------------------------
  BEDROCK: { name: 'roche', color: 0x4a4744, color2: 0x3a3836, pattern: Pattern.DIRT, noise: 0.4 },
  ASPHALT: { name: 'asphalte', color: 0x2c2e33, color2: 0x1d1f23, pattern: Pattern.ASPHALT, noise: 0.25, spec: 0.15, wettable: true },
  ASPHALT_WORN: { name: 'asphalte usé', color: 0x34353a, color2: 0x222327, pattern: Pattern.ASPHALT, scale: 1, noise: 0.35, spec: 0.12, wettable: true },
  LINE_WHITE: { name: 'marquage blanc', color: 0xd8d8d0, color2: 0x2c2e33, pattern: Pattern.ROAD_PAINT, noise: 0.1, wettable: true },
  LINE_YELLOW: { name: 'marquage jaune', color: 0xe0b020, color2: 0x2c2e33, pattern: Pattern.ROAD_PAINT, noise: 0.1, wettable: true },
  SIDEWALK: { name: 'trottoir', color: 0x7d7b78, color2: 0x5e5c59, pattern: Pattern.SIDEWALK, noise: 0.2, grime: 0.35, wettable: true },
  SIDEWALK_DARK: { name: 'trottoir sombre', color: 0x5f5e5c, color2: 0x464543, pattern: Pattern.SIDEWALK, noise: 0.2, grime: 0.3, wettable: true },
  CURB: { name: 'bordure', color: 0x8e8b86, color2: 0x6c6964, pattern: Pattern.CONCRETE, scale: 1, noise: 0.2, wettable: true },
  PAVER_LED: { name: 'dalle lumineuse', color: 0x3a3f4a, color2: 0x232730, pattern: Pattern.HEX, emissive: 0x40c8ff, emissiveMode: Emissive.PULSE, spec: 0.3, wettable: true },
  PLAZA_RED: { name: 'dalle rouge', color: 0x8a2a2e, color2: 0x5a1a1e, pattern: Pattern.SIDEWALK, noise: 0.15, spec: 0.2, wettable: true },
  DIRT: { name: 'terre', color: 0x4a3c2e, color2: 0x3a2f24, pattern: Pattern.DIRT, noise: 0.5 },
  GRASS: { name: 'herbe', color: 0x3f6a34, color2: 0x2c5028, pattern: Pattern.GRASS, noise: 0.5 },
  LEAVES: { name: 'feuillage', color: 0x3a6a30, color2: 0x24461d, pattern: Pattern.FOLIAGE, noise: 0.6, lightPass: true },
  LEAVES_DARK: { name: 'feuillage sombre', color: 0x2a4f26, color2: 0x1a3317, pattern: Pattern.FOLIAGE, noise: 0.6, lightPass: true },
  LEAVES_PINK: { name: 'cerisier', color: 0xd88aa8, color2: 0xa85a7a, pattern: Pattern.FOLIAGE, noise: 0.5, lightPass: true },
  HEDGE: { name: 'haie', color: 0x34522a, color2: 0x223a1a, pattern: Pattern.FOLIAGE, noise: 0.5 },
  BARK: { name: 'écorce', color: 0x4a3a2a, color2: 0x30251b, pattern: Pattern.BARK, noise: 0.4 },
  GRAVEL: { name: 'gravier', color: 0x7d766a, color2: 0x5f594f, pattern: Pattern.DIRT, noise: 0.7, wettable: true },
  ROCK: { name: 'rocher de schiste', color: 0x6a6660, color2: 0x4e4a45, pattern: Pattern.ASHLAR, scale: 2, noise: 0.5 },
  QUAY: { name: 'pierre de quai', color: 0x6a6762, color2: 0x4a4744, pattern: Pattern.ASHLAR, scale: 2, noise: 0.35, grime: 0.6 },
  RIVERBED: { name: 'lit de la rivière', color: 0x2a2620, color2: 0x1f1c18, pattern: Pattern.DIRT, noise: 0.3 },
  DECK_WOOD: { name: 'platelage', color: 0x6b5a45, color2: 0x3a3024, pattern: Pattern.PLANK, scale: 1, noise: 0.5, grime: 0.3, wettable: true },

  // --- Murs extérieurs : brique, pierre, béton -------------------------------
  BRICK_RED: { name: 'brique rouge', color: 0x8a3a2c, color2: 0xa89a86, pattern: Pattern.BRICK, noise: 0.35, grime: 0.55 },
  BRICK_BROWN: { name: 'brique brune', color: 0x6a4434, color2: 0xa09280, pattern: Pattern.BRICK, noise: 0.35, grime: 0.55 },
  BRICK_DARK: { name: 'brique sombre', color: 0x4a3530, color2: 0x6b625a, pattern: Pattern.BRICK, noise: 0.3, grime: 0.4 },
  BRICK_YELLOW: { name: 'brique jaune', color: 0xa08a62, color2: 0xc9bea6, pattern: Pattern.BRICK, noise: 0.35, grime: 0.6 },
  BRICK_PAINTED: { name: 'brique peinte', color: 0x2c3a4a, color2: 0x3a4858, pattern: Pattern.BRICK, noise: 0.2, grime: 0.4 },
  BRICK_GRAFFITI: { name: 'brique taguée', color: 0x7a3a2e, color2: 0xa09280, pattern: Pattern.GRAFFITI, noise: 0.3, grime: 0.5 },
  BROWNSTONE: { name: 'grès brun', color: 0x6a4a3a, color2: 0x56392c, pattern: Pattern.ASHLAR, noise: 0.25, grime: 0.45 },
  LIMESTONE: { name: 'pierre calcaire', color: 0xc8bfae, color2: 0xa8a090, pattern: Pattern.ASHLAR, noise: 0.18, grime: 0.55 },
  GRANITE: { name: 'granit', color: 0x8d8b86, color2: 0x6a6863, pattern: Pattern.ASHLAR, noise: 0.25, grime: 0.4 },
  GRANITE_DARK: { name: 'granit noir', color: 0x3a3a3c, color2: 0x2a2a2c, pattern: Pattern.ASHLAR, noise: 0.2, spec: 0.35, grime: 0.2 },
  CONCRETE: { name: 'béton', color: 0x8a8884, color2: 0x6e6c68, pattern: Pattern.CONCRETE, noise: 0.25, grime: 0.6 },
  CONCRETE_DARK: { name: 'béton sombre', color: 0x55545a, color2: 0x45444a, pattern: Pattern.CONCRETE, noise: 0.25, grime: 0.5 },
  CONCRETE_WHITE: { name: 'béton blanc', color: 0xc8c6c0, color2: 0xa8a6a0, pattern: Pattern.CONCRETE, noise: 0.15, grime: 0.4 },
  STUCCO: { name: 'enduit', color: 0xd6ccb6, pattern: Pattern.PLASTER, noise: 0.12, grime: 0.5 },
  STUCCO_RED: { name: 'enduit rouge', color: 0x9a2a28, pattern: Pattern.PLASTER, noise: 0.12, grime: 0.4 },
  STUCCO_GREEN: { name: 'enduit vert jade', color: 0x2a6a5a, pattern: Pattern.PLASTER, noise: 0.12, grime: 0.4 },
  STUCCO_YELLOW: { name: 'enduit ocre', color: 0xc89a3a, pattern: Pattern.PLASTER, noise: 0.12, grime: 0.45 },
  METAL_PANEL: { name: 'bardage métallique', color: 0x5a6068, color2: 0x3a3f45, pattern: Pattern.METAL_PANEL, noise: 0.1, spec: 0.4, grime: 0.35 },
  METAL_PANEL_DARK: { name: 'bardage noir', color: 0x24272c, color2: 0x15171a, pattern: Pattern.METAL_PANEL, noise: 0.08, spec: 0.5, grime: 0.2 },
  METAL_PANEL_WHITE: { name: 'bardage blanc', color: 0xd0d4d8, color2: 0xa0a4a8, pattern: Pattern.METAL_PANEL, noise: 0.08, spec: 0.45, grime: 0.3 },
  CORRUGATED: { name: 'tôle ondulée', color: 0x6d6a66, color2: 0x4d4a47, pattern: Pattern.CORRUGATED, noise: 0.3, spec: 0.2, grime: 0.5 },
  CORRUGATED_BLUE: { name: 'tôle bleue', color: 0x2a4a6a, color2: 0x1a3048, pattern: Pattern.CORRUGATED, noise: 0.25, spec: 0.2, grime: 0.45 },
  CORRUGATED_RED: { name: 'tôle rouge', color: 0x7a2a26, color2: 0x501a18, pattern: Pattern.CORRUGATED, noise: 0.25, spec: 0.2, grime: 0.45 },
  WOOD_WALL: { name: 'bardage bois', color: 0x5e4d3b, color2: 0x3b3025, pattern: Pattern.PLANK, scale: 3, noise: 0.45, grime: 0.4 },
  TERRACOTTA: { name: 'terre cuite', color: 0xb06a46, color2: 0x8a4a30, pattern: Pattern.ASHLAR, scale: 1, noise: 0.2, grime: 0.4 },
  CURTAIN_BLUE: { name: 'mur-rideau bleu', color: 0x1c2a3c, color2: 0x55606c, pattern: Pattern.CURTAIN, scale: 0, emissive: 0xc8dcff, emissiveMode: Emissive.NIGHT, spec: 0.85 },
  CURTAIN_DARK: { name: 'mur-rideau fumé', color: 0x15181d, color2: 0x3a3f46, pattern: Pattern.CURTAIN, scale: 1, emissive: 0xffd8a0, emissiveMode: Emissive.NIGHT, spec: 0.9 },
  CURTAIN_GOLD: { name: 'mur-rideau doré', color: 0x3a3020, color2: 0x8a7040, pattern: Pattern.CURTAIN, scale: 2, emissive: 0xffe0a8, emissiveMode: Emissive.NIGHT, spec: 0.9 },
  CURTAIN_GREEN: { name: 'mur-rideau vert', color: 0x1a302c, color2: 0x4a5e58, pattern: Pattern.CURTAIN, scale: 0, emissive: 0xd0fff0, emissiveMode: Emissive.NIGHT, spec: 0.85 },

  // --- Menuiseries, métaux -------------------------------------------------------
  PAINT_GREEN: { name: 'peinture verte', color: 0x1f4a35, pattern: Pattern.PAINT, noise: 0.12, spec: 0.25, grime: 0.25 },
  PAINT_RED: { name: 'peinture rouge', color: 0x8a1f22, pattern: Pattern.PAINT, noise: 0.12, spec: 0.25, grime: 0.25 },
  PAINT_NAVY: { name: 'peinture bleu nuit', color: 0x1d2f52, pattern: Pattern.PAINT, noise: 0.12, spec: 0.25, grime: 0.25 },
  PAINT_BLACK: { name: 'peinture noire', color: 0x1c1b1a, pattern: Pattern.PAINT, noise: 0.1, spec: 0.3, grime: 0.15 },
  PAINT_CREAM: { name: 'peinture crème', color: 0xd8ccb0, pattern: Pattern.PAINT, noise: 0.1, spec: 0.2, grime: 0.4 },
  PAINT_YELLOW: { name: 'peinture jaune taxi', color: 0xe8b818, pattern: Pattern.PAINT, noise: 0.08, spec: 0.35, grime: 0.2 },
  PAINT_TEAL: { name: 'peinture sarcelle', color: 0x245a58, pattern: Pattern.PAINT, noise: 0.12, spec: 0.25, grime: 0.25 },
  PAINT_WHITE: { name: 'peinture blanche', color: 0xe4e2dc, pattern: Pattern.PAINT, noise: 0.06, spec: 0.2, grime: 0.3 },
  PAINT_GREY: { name: 'peinture grise', color: 0x6a6e74, pattern: Pattern.PAINT, noise: 0.08, spec: 0.2, grime: 0.3 },
  FRAME_DARK: { name: 'menuiserie sombre', color: 0x22252a, pattern: Pattern.PAINT, noise: 0.06, spec: 0.3 },
  FRAME_WHITE: { name: 'menuiserie blanche', color: 0xd9d6cf, pattern: Pattern.PAINT, noise: 0.06, grime: 0.35 },
  IRON: { name: 'acier noir', color: 0x1e2024, pattern: Pattern.METAL, spec: 0.5, noise: 0.1 },
  STEEL: { name: 'acier brossé', color: 0x7a8088, pattern: Pattern.METAL, spec: 0.6, noise: 0.08 },
  STEEL_BLUE: { name: 'acier peint bleu', color: 0x3a5a7a, pattern: Pattern.METAL, spec: 0.4, noise: 0.1, grime: 0.3 },
  STEEL_GREEN: { name: 'acier vert de pont', color: 0x5a7a6a, pattern: Pattern.METAL, spec: 0.3, noise: 0.15, grime: 0.4 },
  CHROME: { name: 'chrome', color: 0xc8ccd2, pattern: Pattern.METAL, spec: 0.95, noise: 0.04 },
  BRASS: { name: 'laiton', color: 0xb08d3c, pattern: Pattern.METAL, spec: 0.8, noise: 0.1 },
  GOLD: { name: 'dorure', color: 0xd4a640, pattern: Pattern.METAL, spec: 0.9, noise: 0.08 },
  SILVER: { name: 'argent', color: 0xc9d1dc, pattern: Pattern.METAL, spec: 0.9, noise: 0.06 },
  COPPER_GREEN: { name: 'cuivre vert-de-gris', color: 0x5f9a86, color2: 0x4a7c6b, pattern: Pattern.METAL, spec: 0.2, noise: 0.35 },
  GRATE: { name: 'caillebotis', color: 0x3a3d42, color2: 0x15161a, pattern: Pattern.GRATE, spec: 0.35, noise: 0.1 },
  RUST: { name: 'rouille', color: 0x7a4a2a, color2: 0x5a3018, pattern: Pattern.DIRT, noise: 0.5 },
  LEAD: { name: 'zinc de toiture', color: 0x5b5f63, pattern: Pattern.METAL, spec: 0.2, noise: 0.2, wettable: true },
  ROOF_TAR: { name: 'toit goudronné', color: 0x2e2e30, color2: 0x232325, pattern: Pattern.ASPHALT, scale: 2, noise: 0.3, wettable: true },
  ROOF_GRAVEL: { name: 'toit gravillonné', color: 0x6a6660, color2: 0x55514c, pattern: Pattern.DIRT, noise: 0.6, wettable: true },
  SOLAR: { name: 'panneau solaire', color: 0x14203a, color2: 0x8090a8, pattern: Pattern.SOLAR, spec: 0.85 },
  WATER_TANK: { name: 'douelles de réservoir', color: 0x6a5240, color2: 0x45362a, pattern: Pattern.PLANK, scale: 4, noise: 0.35, grime: 0.5 },

  // --- Vitrages -----------------------------------------------------------------------
  GLASS: { name: 'vitre', color: 0x20293a, pattern: Pattern.GLASS, spec: 0.9, lightPass: true, bulletPass: true },
  GLASS_LIT: { name: 'vitre éclairée', color: 0x3a3428, pattern: Pattern.GLASS, spec: 0.6, emissive: 0xffc890, emissiveMode: Emissive.NIGHT, lightPass: true, bulletPass: true },
  GLASS_COOL: { name: 'vitre éclairée froide', color: 0x28323a, pattern: Pattern.GLASS, spec: 0.7, emissive: 0xb8d8ff, emissiveMode: Emissive.NIGHT, lightPass: true, bulletPass: true },
  GLASS_SHOP: { name: 'vitrine', color: 0x343028, pattern: Pattern.GLASS, spec: 0.7, emissive: 0xffe0b8, emissiveMode: Emissive.NIGHT, lightPass: true, bulletPass: true },
  GLASS_CLEAR: { name: 'baie vitrée', color: 0x2a3540, pattern: Pattern.GLASS, scale: 1, spec: 0.95, lightPass: true, bulletPass: true },

  // --- Néons, écrans, lumières --------------------------------------------------------
  NEON_PINK: { name: 'néon rose', color: 0xff3cc8, pattern: Pattern.NEON, emissive: 0xff3cc8, emissiveMode: Emissive.NEON, lightPass: true },
  NEON_CYAN: { name: 'néon cyan', color: 0x3cf0ff, pattern: Pattern.NEON, emissive: 0x3ce8ff, emissiveMode: Emissive.NEON, lightPass: true },
  NEON_RED: { name: 'néon rouge', color: 0xff2a40, pattern: Pattern.NEON, emissive: 0xff2a40, emissiveMode: Emissive.NEON, lightPass: true },
  NEON_BLUE: { name: 'néon bleu', color: 0x3a6aff, pattern: Pattern.NEON, emissive: 0x4a7aff, emissiveMode: Emissive.NEON, lightPass: true },
  NEON_GREEN: { name: 'néon vert', color: 0x40ff80, pattern: Pattern.NEON, emissive: 0x40ff80, emissiveMode: Emissive.NEON, lightPass: true },
  NEON_YELLOW: { name: 'néon jaune', color: 0xffd040, pattern: Pattern.NEON, emissive: 0xffd040, emissiveMode: Emissive.NEON, lightPass: true },
  NEON_PURPLE: { name: 'néon violet', color: 0xa040ff, pattern: Pattern.NEON, emissive: 0xa848ff, emissiveMode: Emissive.NEON, lightPass: true },
  NEON_WHITE: { name: 'néon blanc', color: 0xf0f4ff, pattern: Pattern.NEON, emissive: 0xe8f0ff, emissiveMode: Emissive.NEON, lightPass: true },
  NEON_ORANGE: { name: 'néon orange', color: 0xff8a20, pattern: Pattern.NEON, emissive: 0xff8a20, emissiveMode: Emissive.NEON, lightPass: true },
  LED_WHITE: { name: 'bandeau LED', color: 0xdfe8ff, pattern: Pattern.LED, emissive: 0xdfe8ff, emissiveMode: Emissive.ALWAYS },
  LED_WARM: { name: 'bandeau LED chaud', color: 0xffd8a0, pattern: Pattern.LED, emissive: 0xffd0a0, emissiveMode: Emissive.ALWAYS },
  LED_CYAN: { name: 'bandeau LED cyan', color: 0x60e8ff, pattern: Pattern.LED, emissive: 0x50e0ff, emissiveMode: Emissive.PULSE },
  LED_PINK: { name: 'bandeau LED rose', color: 0xff60d0, pattern: Pattern.LED, emissive: 0xff50c8, emissiveMode: Emissive.PULSE },
  LED_RED: { name: 'bandeau LED rouge', color: 0xff3048, pattern: Pattern.LED, emissive: 0xff2a40, emissiveMode: Emissive.PULSE },
  LED_BLUE: { name: 'bandeau LED bleu', color: 0x4a8aff, pattern: Pattern.LED, emissive: 0x4a8aff, emissiveMode: Emissive.PULSE },
  LED_GOLD: { name: 'bandeau LED or', color: 0xffc860, pattern: Pattern.LED, emissive: 0xffc050, emissiveMode: Emissive.ALWAYS },
  SCREEN: { name: 'écran LED', color: 0x101418, pattern: Pattern.SCREEN, scale: 0, emissive: 0xffffff, emissiveMode: Emissive.SCREEN },
  SCREEN_ADS: { name: 'écran publicitaire', color: 0x101418, pattern: Pattern.SCREEN, scale: 1, emissive: 0xffffff, emissiveMode: Emissive.SCREEN },
  SCREEN_TICKER: { name: 'bandeau défilant', color: 0x101418, pattern: Pattern.SCREEN, scale: 2, emissive: 0xffffff, emissiveMode: Emissive.SCREEN },
  LAMP_GLOW: { name: 'lumière', color: 0xffe0a0, pattern: Pattern.NONE, emissive: 0xffc870, emissiveMode: Emissive.ALWAYS, lightPass: true },
  FIRE: { name: 'feu', color: 0xff7a1a, pattern: Pattern.FIRE, emissive: 0xff8a2a, emissiveMode: Emissive.FIRE, lightPass: true, bulletPass: true },

  // --- Intérieurs -------------------------------------------------------------------
  FLOOR_OAK: { name: 'plancher de chêne', color: 0x7a5634, color2: 0x4e3520, pattern: Pattern.PLANK, noise: 0.35 },
  FLOOR_DARK: { name: 'plancher sombre', color: 0x4a3322, color2: 0x2e1f14, pattern: Pattern.PLANK, noise: 0.35 },
  FLOOR_WORN: { name: 'plancher usé', color: 0x6a5a46, color2: 0x45392b, pattern: Pattern.PLANK, noise: 0.5 },
  FLOOR_WALNUT: { name: 'parquet de noyer', color: 0x5a3a24, color2: 0x3c2516, pattern: Pattern.PLANK, scale: 4, noise: 0.2, spec: 0.35 },
  PARQUET: { name: 'parquet', color: 0x8a6238, color2: 0x6a4626, pattern: Pattern.PARQUET, noise: 0.25, spec: 0.3 },
  LINOLEUM: { name: 'linoléum', color: 0x8a8a7a, color2: 0x6a6a5a, pattern: Pattern.CHECKER, spec: 0.3, noise: 0.15 },
  CHECKER: { name: 'carrelage damier', color: 0xe8e2d4, color2: 0x26231f, pattern: Pattern.CHECKER, spec: 0.4 },
  TILE_WHITE: { name: 'carreaux de métro', color: 0xe6e4dc, color2: 0x9a9890, pattern: Pattern.TILE, spec: 0.45, noise: 0.08 },
  TILE_GREEN: { name: 'carreaux verts', color: 0x3a6a5a, color2: 0x2a4a40, pattern: Pattern.TILE, spec: 0.45, noise: 0.08 },
  TILE_DARK: { name: 'carrelage sombre', color: 0x2a2c30, color2: 0x1a1c20, pattern: Pattern.TILE, scale: 1, spec: 0.5, noise: 0.08 },
  TERRAZZO: { name: 'terrazzo', color: 0xc8c2b6, color2: 0x6a645a, pattern: Pattern.TERRAZZO, spec: 0.45 },
  TERRAZZO_DARK: { name: 'terrazzo noir', color: 0x2e2c2a, color2: 0x9a948a, pattern: Pattern.TERRAZZO, spec: 0.5 },
  MARBLE: { name: 'marbre blanc', color: 0xe9e6df, color2: 0xa9a49b, pattern: Pattern.MARBLE, spec: 0.6 },
  MARBLE_BLACK: { name: 'marbre noir', color: 0x2a2725, color2: 0x6a645e, pattern: Pattern.MARBLE, spec: 0.6 },
  MARBLE_GREEN: { name: 'marbre vert', color: 0x2a4a3e, color2: 0x8aa89a, pattern: Pattern.MARBLE, spec: 0.6 },
  CARPET_RED: { name: 'moquette rouge', color: 0x7a1e22, color2: 0xc9a24a, pattern: Pattern.CARPET, noise: 0.1 },
  CARPET_BLUE: { name: 'moquette bleue', color: 0x22305a, color2: 0xb8a46a, pattern: Pattern.CARPET, noise: 0.1 },
  CARPET_GREY: { name: 'moquette grise', color: 0x4a4c50, color2: 0x5a5c62, pattern: Pattern.CARPET, noise: 0.12 },
  CARPET_PURPLE: { name: 'moquette violette', color: 0x3a1e4a, color2: 0xc840ff, pattern: Pattern.CARPET, noise: 0.1 },
  RUBBER: { name: 'sol caoutchouc', color: 0x2a2a2c, color2: 0x3a3a3e, pattern: Pattern.RUBBER, noise: 0.15 },
  WP_RED: { name: 'tenture rouge', color: 0x6e1c22, color2: 0x8f3036, pattern: Pattern.DAMASK, noise: 0.05 },
  WP_BLUE: { name: 'tenture bleue', color: 0x283b63, color2: 0x3c5486, pattern: Pattern.DAMASK, noise: 0.05 },
  WP_GREEN: { name: 'papier peint vert', color: 0x3d5a3f, color2: 0x587a52, pattern: Pattern.STRIPES, noise: 0.05 },
  WP_GOLD: { name: 'papier peint doré', color: 0x8a6a3a, color2: 0xb08a4a, pattern: Pattern.DAMASK, noise: 0.05 },
  WP_FADED: { name: 'papier peint défraîchi', color: 0x8e8470, color2: 0x9c927d, pattern: Pattern.DAMASK, noise: 0.15 },
  WP_BLACK: { name: 'tenture noire', color: 0x1a1a1e, color2: 0x2e2a30, pattern: Pattern.DAMASK, noise: 0.05 },
  PLASTER: { name: 'plâtre', color: 0xd6d0c2, pattern: Pattern.PLASTER, noise: 0.08 },
  PLASTER_WHITE: { name: 'plâtre blanc', color: 0xe8e6e0, pattern: Pattern.PLASTER, noise: 0.05 },
  PLASTER_DIRTY: { name: 'plâtre sale', color: 0x9a927e, pattern: Pattern.PLASTER, noise: 0.25 },
  PLASTER_GREY: { name: 'plâtre gris', color: 0x8a8a88, pattern: Pattern.PLASTER, noise: 0.1 },
  PLASTER_DARK: { name: 'plâtre anthracite', color: 0x34363a, pattern: Pattern.PLASTER, noise: 0.06 },
  PANEL_DARK: { name: 'lambris sombre', color: 0x3e2a1c, color2: 0x2a1c12, pattern: Pattern.PANEL, noise: 0.15, spec: 0.2 },
  PANEL_LIGHT: { name: 'lambris clair', color: 0x7a5a3a, color2: 0x5c4128, pattern: Pattern.PANEL, noise: 0.15, spec: 0.2 },
  SLATS_WOOD: { name: 'claustra bois', color: 0x8a6440, color2: 0x4a3420, pattern: Pattern.SLATS, noise: 0.1, spec: 0.2 },
  SLATS_DARK: { name: 'claustra noir', color: 0x2a2420, color2: 0x120e0c, pattern: Pattern.SLATS, noise: 0.1, spec: 0.3 },
  HEX_PANEL: { name: 'panneaux hexagonaux', color: 0x2a2e36, color2: 0x15181d, pattern: Pattern.HEX, spec: 0.4 },
  CEILING: { name: 'plafond', color: 0xd0cbc0, pattern: Pattern.PLASTER, noise: 0.06 },
  CEILING_DARK: { name: 'plafond sombre', color: 0x2a2a2e, pattern: Pattern.PLASTER, noise: 0.06 },
  CEILING_PANEL: { name: 'faux plafond', color: 0xc8c8c4, color2: 0x9a9a96, pattern: Pattern.TILE, scale: 2, noise: 0.05 },
  BEAM: { name: 'poutre', color: 0x3a2a1d, color2: 0x26190f, pattern: Pattern.PLANK, scale: 2, noise: 0.3 },
  MAHOGANY: { name: 'acajou', color: 0x4f2318, color2: 0x36150d, pattern: Pattern.PLANK, scale: 4, noise: 0.2, spec: 0.4 },
  WALNUT: { name: 'noyer', color: 0x5a3a24, color2: 0x3c2516, pattern: Pattern.PLANK, scale: 4, noise: 0.2, spec: 0.35 },
  FELT: { name: 'feutre vert', color: 0x1f5a3a, pattern: Pattern.CLOTH, noise: 0.08 },
  BOOKS: { name: 'livres', color: 0x6a2a2a, pattern: Pattern.BOOKS, noise: 0.1 },
  CRATE: { name: 'caisse', color: 0x8a6a42, color2: 0x5e4428, pattern: Pattern.PLANK, scale: 5, noise: 0.35 },
  POSTER: { name: 'affiches', color: 0xd8cfb5, color2: 0x2a2a2a, pattern: Pattern.POSTER, noise: 0.1, grime: 0.3 },
  CLOTH_WHITE: { name: 'tissu blanc', color: 0xe8e2d4, pattern: Pattern.CLOTH, noise: 0.05 },
  AWNING_RED: { name: 'auvent rouge', color: 0x8a2a24, color2: 0x6a1a18, pattern: Pattern.AWNING, noise: 0.1 },
  AWNING_GREEN: { name: 'auvent vert', color: 0x2a5a3a, color2: 0x1a3a26, pattern: Pattern.AWNING, noise: 0.1 },
  AWNING_BLUE: { name: 'auvent bleu', color: 0x24406a, color2: 0x162a48, pattern: Pattern.AWNING, noise: 0.1 },
  AWNING_BLACK: { name: 'auvent noir', color: 0x1e1e22, color2: 0x2e2e34, pattern: Pattern.AWNING, noise: 0.1 },

  // --- Couleurs de faction (décor statique des logements) ---------------------------------
  CLOTH_RED: { name: 'drap cramoisi', color: 0x8e1b22, pattern: Pattern.CLOTH, noise: 0.08 },
  CLOTH_NAVY: { name: 'drap bleu marine', color: 0x1d3461, pattern: Pattern.CLOTH, noise: 0.08 },

  // --- Matériaux invisibles ------------------------------------------------------
  COVER: { name: 'couverture invisible', color: 0, pattern: Pattern.NONE, invisible: true, lightPass: true },
  COLLIDE: { name: 'collision invisible', color: 0, pattern: Pattern.NONE, invisible: true, lightPass: true, bulletPass: true },
  /** Garde-corps invisible : bloque la marche mais ni la vue ni les balles. */
  BARRIER: { name: 'barrière invisible', color: 0, pattern: Pattern.NONE, invisible: true, lightPass: true, bulletPass: true },
} satisfies Record<string, MaterialDef>;

export type MatName = keyof typeof DEFS;

/** Identifiants numériques des matériaux : M.BRICK_RED, etc. */
export const M = {} as Record<MatName, number>;
export const MATERIALS: MaterialDef[] = [];
{
  let i = 0;
  for (const k of Object.keys(DEFS) as MatName[]) {
    M[k] = i;
    MATERIALS[i] = DEFS[k];
    i++;
  }
  if (i > 250) throw new Error('trop de matériaux');
}

// Tables de propriétés compactes pour les tests rapides.
export const MAT_SOLID = new Uint8Array(256);
export const MAT_BLOCKS_LIGHT = new Uint8Array(256);
export const MAT_BLOCKS_BULLETS = new Uint8Array(256);
export const MAT_VISIBLE = new Uint8Array(256);
export const MAT_WET = new Uint8Array(256);
for (let i = 0; i < MATERIALS.length; i++) {
  const d = MATERIALS[i];
  MAT_SOLID[i] = d.solid === false ? 0 : 1;
  MAT_BLOCKS_LIGHT[i] = d.lightPass ? 0 : 1;
  MAT_BLOCKS_BULLETS[i] = d.bulletPass || d.solid === false ? 0 : 1;
  MAT_VISIBLE[i] = d.invisible ? 0 : 1;
  MAT_WET[i] = d.wettable ? 1 : 0;
}
