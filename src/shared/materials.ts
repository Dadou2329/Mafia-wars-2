// Palette des matériaux voxel du monde (New York 2085).
// Chaque voxel stocke un identifiant de matériau (0 = air). Le client transforme cette
// table en texture et le shader applique un motif procédural (briques, asphalte, néons…)
// calculé à partir de la position dans le monde. Le paramètre `scale` choisit la variante
// du motif (voir les commentaires de shaderChunks.ts : PATTERN_GLSL).

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
  /** Membrane d'étanchéité des toits-terrasses (lés soudés). */
  ROOF = 48,
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
  scale?: number; // variante du motif (0..255)
  emissive?: number; // couleur émissive sRGB
  emissiveMode?: Emissive;
  spec?: number; // reflet spéculaire 0..1
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
  BEDROCK: { name: 'roche', color: 0x4d4a47, color2: 0x3a3836, pattern: Pattern.DIRT, scale: 3, noise: 0.3 },
  // enrobé sombre à granulats, rapiéçages, fissures colmatées, plaques d'égout
  ASPHALT: { name: 'asphalte', color: 0x303237, color2: 0x1d1f23, pattern: Pattern.ASPHALT, noise: 0.03, spec: 0.16, wettable: true },
  ASPHALT_WORN: { name: 'asphalte usé', color: 0x303237, color2: 0x1d1f23, pattern: Pattern.ASPHALT, noise: 0.03, spec: 0.16, wettable: true },
  // marquage thermoplastique net
  LINE_WHITE: { name: 'marquage blanc', color: 0xe8e8e2, color2: 0x303237, pattern: Pattern.ROAD_PAINT, noise: 0.02, spec: 0.3, wettable: true },
  LINE_YELLOW: { name: 'marquage jaune', color: 0xf2b51c, color2: 0x303237, pattern: Pattern.ROAD_PAINT, noise: 0.02, spec: 0.3, wettable: true },
  // dalles de trottoir de 1,5 m (5 pieds), bords lissés, chewing-gums
  SIDEWALK: { name: 'trottoir', color: 0x9d9b96, color2: 0x6b6965, pattern: Pattern.SIDEWALK, noise: 0.03, spec: 0.06, grime: 0.2, wettable: true },
  // pavés anthracite modernes (places, parvis)
  SIDEWALK_DARK: { name: 'trottoir sombre', color: 0x64676c, color2: 0x393b3f, pattern: Pattern.SIDEWALK, scale: 1, noise: 0.03, spec: 0.1, grime: 0.15, wettable: true },
  // bordure de granit
  CURB: { name: 'bordure', color: 0xb5b3ae, color2: 0x5d5b58, pattern: Pattern.SIDEWALK, scale: 3, noise: 0.03, spec: 0.12, wettable: true },
  PAVER_LED: { name: 'dalle lumineuse', color: 0x343a46, color2: 0x1a1e26, pattern: Pattern.HEX, emissive: 0x40c8ff, emissiveMode: Emissive.PULSE, spec: 0.4, wettable: true },
  // granit rouge poli de Times Square, pastilles d'acier
  PLAZA_RED: { name: 'dalle rouge', color: 0x7c2a2f, color2: 0x461216, pattern: Pattern.SIDEWALK, scale: 2, noise: 0.03, spec: 0.3, wettable: true },
  DIRT: { name: 'terre', color: 0x4d3b2d, color2: 0x2f241b, pattern: Pattern.DIRT, noise: 0.35 },
  GRASS: { name: 'herbe', color: 0x4f8442, color2: 0x33602c, pattern: Pattern.GRASS, noise: 0.3 },
  LEAVES: { name: 'feuillage', color: 0x4b843c, color2: 0x2b5a27, pattern: Pattern.FOLIAGE, noise: 0.5, lightPass: true },
  LEAVES_DARK: { name: 'feuillage sombre', color: 0x32702f, color2: 0x1c4420, pattern: Pattern.FOLIAGE, noise: 0.5, lightPass: true },
  LEAVES_PINK: { name: 'cerisier', color: 0xec9fbd, color2: 0xb96c8c, pattern: Pattern.FOLIAGE, noise: 0.45, lightPass: true },
  HEDGE: { name: 'haie', color: 0x3f6e33, color2: 0x274a20, pattern: Pattern.FOLIAGE, noise: 0.45 },
  BARK: { name: 'écorce', color: 0x5b4737, color2: 0x3a2c22, pattern: Pattern.BARK, noise: 0.35 },
  GRAVEL: { name: 'gravier', color: 0x8d887f, color2: 0x5c5850, pattern: Pattern.DIRT, scale: 1, noise: 0.25, wettable: true },
  // schiste de Manhattan (feuilleté, mica, lichens)
  ROCK: { name: 'rocher de schiste', color: 0x737270, color2: 0x4a4948, pattern: Pattern.ASHLAR, scale: 5, noise: 0.3 },
  QUAY: { name: 'pierre de quai', color: 0x7a7873, color2: 0x4d4b48, pattern: Pattern.ASHLAR, scale: 2, noise: 0.15, grime: 0.45 },
  RIVERBED: { name: 'lit de la rivière', color: 0x2a2620, color2: 0x1f1c18, pattern: Pattern.DIRT, scale: 3, noise: 0.3 },
  // lames d'ipé (promenade du pont, toits-terrasses)
  DECK_WOOD: { name: 'platelage', color: 0x8e6b4b, color2: 0x2a2018, pattern: Pattern.PLANK, scale: 1, noise: 0.2, spec: 0.1, grime: 0.2, wettable: true },

  // --- Murs extérieurs : brique, pierre, béton -------------------------------
  // brique rouge de Harlem, appareil américain, joints gris clair nets
  BRICK_RED: { name: 'brique rouge', color: 0x8c3e31, color2: 0xbcb7ae, pattern: Pattern.BRICK, noise: 0.08, spec: 0.04, grime: 0.3 },
  // brique romaine longue et fine, couleur caramel (immeubles modernistes)
  BRICK_BROWN: { name: 'brique brune', color: 0xa3704f, color2: 0xd7d0c3, pattern: Pattern.BRICK, scale: 2, noise: 0.08, spec: 0.04, grime: 0.3 },
  // brique émaillée graphite
  BRICK_DARK: { name: 'brique sombre', color: 0x3d3f46, color2: 0x8e9095, pattern: Pattern.BRICK, scale: 3, noise: 0.06, spec: 0.3, grime: 0.18 },
  // brique émaillée crème (immeubles d'habitation new-yorkais)
  BRICK_YELLOW: { name: 'brique jaune', color: 0xdacfb2, color2: 0xa29e96, pattern: Pattern.BRICK, scale: 3, noise: 0.06, spec: 0.25, grime: 0.28 },
  // brique peinte bleu ardoise, écailles laissant voir la brique rouge (color2)
  BRICK_PAINTED: { name: 'brique peinte', color: 0x30465a, color2: 0x8e4636, pattern: Pattern.BRICK, scale: 1, noise: 0.05, spec: 0.12, grime: 0.25 },
  BRICK_GRAFFITI: { name: 'brique taguée', color: 0x9a4535, color2: 0xb9b4aa, pattern: Pattern.GRAFFITI, noise: 0.08, spec: 0.04, grime: 0.35 },
  BROWNSTONE: { name: 'grès brun', color: 0x805849, color2: 0x5e3f33, pattern: Pattern.ASHLAR, scale: 6, noise: 0.08, grime: 0.3 },
  // calcaire en grands panneaux (bandeaux, corniches, façades de prestige)
  LIMESTONE: { name: 'pierre calcaire', color: 0xd3cab9, color2: 0xa39b8c, pattern: Pattern.ASHLAR, noise: 0.05, spec: 0.05, grime: 0.35 },
  // granit gris moucheté
  GRANITE: { name: 'granit', color: 0x9d9b97, color2: 0x5f5d5a, pattern: Pattern.ASHLAR, scale: 3, noise: 0.05, spec: 0.15, grime: 0.25 },
  // granit noir poli pailleté
  GRANITE_DARK: { name: 'granit noir', color: 0x2b2c2f, color2: 0x141517, pattern: Pattern.ASHLAR, scale: 4, noise: 0.03, spec: 0.55, grime: 0.1 },
  // béton architectonique : banches et cônes de tirants (murs), béton ciré (sols)
  CONCRETE: { name: 'béton', color: 0x9e9c98, color2: 0x6f6d69, pattern: Pattern.CONCRETE, noise: 0.06, grime: 0.35 },
  // béton brut planché (murs), béton ciré sombre (sols)
  CONCRETE_DARK: { name: 'béton sombre', color: 0x5d5e62, color2: 0x3e3f43, pattern: Pattern.CONCRETE, scale: 2, noise: 0.06, grime: 0.3 },
  CONCRETE_WHITE: { name: 'béton blanc', color: 0xd7d5cf, color2: 0xa9a7a1, pattern: Pattern.CONCRETE, noise: 0.04, grime: 0.3 },
  // enduits de façade (refends au rez-de-chaussée)
  STUCCO: { name: 'enduit', color: 0xddd4bf, pattern: Pattern.PLASTER, scale: 2, noise: 0.06, grime: 0.3 },
  STUCCO_RED: { name: 'enduit rouge', color: 0x942a29, pattern: Pattern.PLASTER, scale: 2, noise: 0.06, grime: 0.25 },
  STUCCO_GREEN: { name: 'enduit vert jade', color: 0x237262, pattern: Pattern.PLASTER, scale: 2, noise: 0.06, grime: 0.25 },
  STUCCO_YELLOW: { name: 'enduit ocre', color: 0xd3a43f, pattern: Pattern.PLASTER, scale: 2, noise: 0.06, grime: 0.3 },
  // cassettes composites à fixations apparentes
  METAL_PANEL: { name: 'bardage métallique', color: 0x7d848d, color2: 0x30343a, pattern: Pattern.METAL_PANEL, noise: 0.04, spec: 0.35, grime: 0.2 },
  // cassettes graphite, certaines perforées ; tôle larmée au sol
  METAL_PANEL_DARK: { name: 'bardage noir', color: 0x283039, color2: 0x0f1216, pattern: Pattern.METAL_PANEL, scale: 1, noise: 0.03, spec: 0.45, grime: 0.12 },
  // panneaux émaillés blancs (diner rétro-futuriste)
  METAL_PANEL_WHITE: { name: 'bardage blanc', color: 0xdfe3e6, color2: 0x8d9196, pattern: Pattern.METAL_PANEL, scale: 2, noise: 0.03, spec: 0.45, grime: 0.15 },
  // tôle galvanisée, coulures de rouille (color2)
  CORRUGATED: { name: 'tôle ondulée', color: 0x878b8f, color2: 0x7a5236, pattern: Pattern.CORRUGATED, noise: 0.08, spec: 0.25, grime: 0.35 },
  CORRUGATED_BLUE: { name: 'tôle bleue', color: 0x2f5a82, color2: 0x1a2e44, pattern: Pattern.CORRUGATED, noise: 0.06, spec: 0.25, grime: 0.3 },
  CORRUGATED_RED: { name: 'tôle rouge', color: 0x97332a, color2: 0x4e1a14, pattern: Pattern.CORRUGATED, noise: 0.06, spec: 0.25, grime: 0.3 },
  // bardage à clin
  WOOD_WALL: { name: 'bardage bois', color: 0x7b5b3f, color2: 0x3a2a1e, pattern: Pattern.PLANK, scale: 3, noise: 0.15, grime: 0.3 },
  // baguettes de terre cuite émaillée (pare-soleil horizontaux)
  TERRACOTTA: { name: 'terre cuite', color: 0xb8653f, color2: 0x3a2a24, pattern: Pattern.ASHLAR, scale: 1, noise: 0.05, spec: 0.3, grime: 0.2 },
  // murs-rideaux : meneaux, allèges émaillées, verre irisé, bureaux éclairés (planchers à y = 3,5 k)
  CURTAIN_BLUE: { name: 'mur-rideau bleu', color: 0x1c2b40, color2: 0x8d98a6, pattern: Pattern.CURTAIN, scale: 0, emissive: 0xd0e4ff, emissiveMode: Emissive.NIGHT, spec: 0.85 },
  CURTAIN_DARK: { name: 'mur-rideau fumé', color: 0x13171d, color2: 0x2c3138, pattern: Pattern.CURTAIN, scale: 1, emissive: 0xffdcb0, emissiveMode: Emissive.NIGHT, spec: 0.9 },
  CURTAIN_GOLD: { name: 'mur-rideau doré', color: 0x302719, color2: 0xb8964e, pattern: Pattern.CURTAIN, scale: 2, emissive: 0xffe2b0, emissiveMode: Emissive.NIGHT, spec: 0.9 },
  CURTAIN_GREEN: { name: 'mur-rideau vert', color: 0x16312d, color2: 0x7e9c96, pattern: Pattern.CURTAIN, scale: 0, emissive: 0xd8fff0, emissiveMode: Emissive.NIGHT, spec: 0.85 },

  // --- Menuiseries, métaux -------------------------------------------------------
  PAINT_GREEN: { name: 'peinture verte', color: 0x1f5a41, pattern: Pattern.PAINT, noise: 0.05, spec: 0.25, grime: 0.2 },
  PAINT_RED: { name: 'peinture rouge', color: 0xa3232b, pattern: Pattern.PAINT, noise: 0.05, spec: 0.25, grime: 0.2 },
  PAINT_NAVY: { name: 'peinture bleu nuit', color: 0x1e3561, pattern: Pattern.PAINT, noise: 0.05, spec: 0.25, grime: 0.2 },
  PAINT_BLACK: { name: 'peinture noire', color: 0x1d1e21, pattern: Pattern.PAINT, noise: 0.04, spec: 0.3, grime: 0.12 },
  PAINT_CREAM: { name: 'peinture crème', color: 0xe3d7bd, pattern: Pattern.PAINT, noise: 0.04, spec: 0.2, grime: 0.3 },
  PAINT_YELLOW: { name: 'peinture jaune taxi', color: 0xf2bf1b, pattern: Pattern.PAINT, noise: 0.04, spec: 0.35, grime: 0.15 },
  PAINT_TEAL: { name: 'peinture sarcelle', color: 0x1f6b67, pattern: Pattern.PAINT, noise: 0.05, spec: 0.25, grime: 0.2 },
  PAINT_WHITE: { name: 'peinture blanche', color: 0xebe9e4, pattern: Pattern.PAINT, noise: 0.03, spec: 0.2, grime: 0.25 },
  PAINT_GREY: { name: 'peinture grise', color: 0x6f747b, pattern: Pattern.PAINT, noise: 0.04, spec: 0.2, grime: 0.25 },
  FRAME_DARK: { name: 'menuiserie sombre', color: 0x25282d, pattern: Pattern.PAINT, noise: 0.03, spec: 0.3 },
  FRAME_WHITE: { name: 'menuiserie blanche', color: 0xe0ddd6, pattern: Pattern.PAINT, noise: 0.03, grime: 0.25 },
  IRON: { name: 'acier noir', color: 0x212429, pattern: Pattern.METAL, spec: 0.4, noise: 0.05 },
  STEEL: { name: 'acier brossé', color: 0x8b919a, pattern: Pattern.METAL, spec: 0.6, noise: 0.04 },
  STEEL_BLUE: { name: 'acier peint bleu', color: 0x3d6287, pattern: Pattern.METAL, spec: 0.4, noise: 0.05, grime: 0.25 },
  // acier rivé des ponts
  STEEL_GREEN: { name: 'acier vert de pont', color: 0x6a8f7e, pattern: Pattern.METAL, scale: 2, spec: 0.3, noise: 0.08, grime: 0.3 },
  CHROME: { name: 'chrome', color: 0xd3d7dd, pattern: Pattern.METAL, scale: 3, spec: 0.95, noise: 0.02 },
  BRASS: { name: 'laiton', color: 0xc39b48, pattern: Pattern.METAL, scale: 3, spec: 0.8, noise: 0.05 },
  GOLD: { name: 'dorure', color: 0xdcae4a, pattern: Pattern.METAL, scale: 3, spec: 0.9, noise: 0.04 },
  SILVER: { name: 'argent', color: 0xd0d7e0, pattern: Pattern.METAL, scale: 3, spec: 0.9, noise: 0.03 },
  // vert-de-gris en coulures, cuivre qui affleure (color2)
  COPPER_GREEN: { name: 'cuivre vert-de-gris', color: 0x5fa48c, color2: 0x8a5a36, pattern: Pattern.METAL, scale: 1, spec: 0.15, noise: 0.2 },
  GRATE: { name: 'caillebotis', color: 0x3c4046, color2: 0x0c0d0f, pattern: Pattern.GRATE, spec: 0.35, noise: 0.05 },
  RUST: { name: 'rouille', color: 0x8a4a26, color2: 0x5a2e16, pattern: Pattern.DIRT, scale: 2, noise: 0.35 },
  // zinc à joints debout
  LEAD: { name: 'zinc de toiture', color: 0x6a7076, pattern: Pattern.METAL, scale: 4, spec: 0.25, noise: 0.08, wettable: true },
  // membrane claire (toit frais) en lés soudés
  ROOF_TAR: { name: 'toit goudronné', color: 0x92979d, color2: 0x767a80, pattern: Pattern.ROOF, noise: 0.03, spec: 0.08, wettable: true },
  ROOF_GRAVEL: { name: 'toit gravillonné', color: 0x908b83, color2: 0x67625b, pattern: Pattern.DIRT, scale: 1, noise: 0.2, wettable: true },
  SOLAR: { name: 'panneau solaire', color: 0x162544, color2: 0xa4b0c4, pattern: Pattern.SOLAR, spec: 0.85 },
  // douelles verticales de cèdre (châteaux d'eau)
  WATER_TANK: { name: 'douelles de réservoir', color: 0x7c5b41, color2: 0x3a2a1e, pattern: Pattern.PLANK, scale: 6, noise: 0.2, grime: 0.4 },

  // --- Vitrages -----------------------------------------------------------------------
  GLASS: { name: 'vitre', color: 0x1e2633, pattern: Pattern.GLASS, spec: 0.9, lightPass: true, bulletPass: true },
  GLASS_LIT: { name: 'vitre éclairée', color: 0x2d2b27, pattern: Pattern.GLASS, spec: 0.6, emissive: 0xffc890, emissiveMode: Emissive.NIGHT, lightPass: true, bulletPass: true },
  GLASS_COOL: { name: 'vitre éclairée froide', color: 0x272e37, pattern: Pattern.GLASS, spec: 0.7, emissive: 0xc0dcff, emissiveMode: Emissive.NIGHT, lightPass: true, bulletPass: true },
  // vitrine : rayonnages garnis visibles en profondeur
  GLASS_SHOP: { name: 'vitrine', color: 0x2f2b25, pattern: Pattern.GLASS, scale: 2, spec: 0.7, emissive: 0xffe4c0, emissiveMode: Emissive.NIGHT, lightPass: true, bulletPass: true },
  GLASS_CLEAR: { name: 'baie vitrée', color: 0x25313b, pattern: Pattern.GLASS, scale: 1, spec: 0.95, lightPass: true, bulletPass: true },

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
  // parquet de chêne en lames larges
  FLOOR_OAK: { name: 'plancher de chêne', color: 0x9b7853, color2: 0x5a3d24, pattern: Pattern.PLANK, noise: 0.12, spec: 0.22 },
  // chêne fumé
  FLOOR_DARK: { name: 'plancher sombre', color: 0x4f3727, color2: 0x2a1b12, pattern: Pattern.PLANK, noise: 0.12, spec: 0.25 },
  // plancher usé de la planque : éraflures, taches
  FLOOR_WORN: { name: 'plancher usé', color: 0x77634b, color2: 0x3e3226, pattern: Pattern.PLANK, scale: 7, noise: 0.25 },
  // noyer en chevrons (luxe)
  FLOOR_WALNUT: { name: 'parquet de noyer', color: 0x6b452a, color2: 0x3e2616, pattern: Pattern.PARQUET, scale: 1, noise: 0.08, spec: 0.4 },
  // chêne miel en chevrons
  PARQUET: { name: 'parquet', color: 0x9e703f, color2: 0x6a4626, pattern: Pattern.PARQUET, noise: 0.08, spec: 0.3 },
  // dalles vinyle mouchetées
  LINOLEUM: { name: 'linoléum', color: 0x9b9b8d, color2: 0x86867a, pattern: Pattern.CHECKER, scale: 1, spec: 0.25, noise: 0.06 },
  CHECKER: { name: 'carrelage damier', color: 0xede7db, color2: 0x1f1d1c, pattern: Pattern.CHECKER, spec: 0.45, noise: 0.03 },
  TILE_WHITE: { name: 'carreaux de métro', color: 0xedebe4, color2: 0xa29f97, pattern: Pattern.TILE, spec: 0.5, noise: 0.03 },
  TILE_GREEN: { name: 'carreaux verts', color: 0x2f7a66, color2: 0x1e4a3e, pattern: Pattern.TILE, spec: 0.5, noise: 0.03 },
  TILE_DARK: { name: 'carrelage sombre', color: 0x2b2e34, color2: 0x15171a, pattern: Pattern.TILE, scale: 1, spec: 0.5, noise: 0.03 },
  TERRAZZO: { name: 'terrazzo', color: 0xd3cdc1, color2: 0x5f5a52, pattern: Pattern.TERRAZZO, spec: 0.45, noise: 0.03 },
  TERRAZZO_DARK: { name: 'terrazzo noir', color: 0x2d2c2d, color2: 0xa39d92, pattern: Pattern.TERRAZZO, spec: 0.5, noise: 0.03 },
  // marbre blanc à joints de laiton
  MARBLE: { name: 'marbre blanc', color: 0xefece6, color2: 0x9a958d, pattern: Pattern.MARBLE, spec: 0.65, noise: 0.02 },
  // nero marquina : noir veiné de blanc
  MARBLE_BLACK: { name: 'marbre noir', color: 0x201f21, color2: 0xd8d4cc, pattern: Pattern.MARBLE, scale: 1, spec: 0.65, noise: 0.02 },
  MARBLE_GREEN: { name: 'marbre vert', color: 0x23483c, color2: 0x9cbcae, pattern: Pattern.MARBLE, spec: 0.65, noise: 0.02 },
  // moquettes : treillis art déco à fils d'or (Dadou) ou d'argent (Even), dalles de bureau, VIP néon
  CARPET_RED: { name: 'moquette rouge', color: 0x6a1520, color2: 0xc9a24a, pattern: Pattern.CARPET, noise: 0.04 },
  CARPET_BLUE: { name: 'moquette bleue', color: 0x1c2b55, color2: 0xaab6c8, pattern: Pattern.CARPET, noise: 0.04 },
  CARPET_GREY: { name: 'moquette grise', color: 0x4d5259, color2: 0x5d636b, pattern: Pattern.CARPET, scale: 1, noise: 0.04 },
  CARPET_PURPLE: { name: 'moquette violette', color: 0x2d1641, color2: 0xc048ff, pattern: Pattern.CARPET, scale: 2, noise: 0.04 },
  // sol de salle de sport en caoutchouc à paillettes bleues
  RUBBER: { name: 'sol caoutchouc', color: 0x2a2b2e, color2: 0x4a78c8, pattern: Pattern.RUBBER, noise: 0.08 },
  // revêtements muraux : panneaux tendus à joints métalliques (cramoisi et or, marine et argent)
  WP_RED: { name: 'tenture rouge', color: 0x6e1620, color2: 0xc9a24a, pattern: Pattern.DAMASK, noise: 0.03 },
  WP_BLUE: { name: 'tenture bleue', color: 0x1b2b50, color2: 0xb4bfd0, pattern: Pattern.DAMASK, noise: 0.03 },
  WP_GREEN: { name: 'papier peint vert', color: 0x3d5a3f, color2: 0x587a52, pattern: Pattern.STRIPES, noise: 0.05 },
  // soie champagne à éventails art déco
  WP_GOLD: { name: 'papier peint doré', color: 0xb39b70, color2: 0xe2cc98, pattern: Pattern.DAMASK, scale: 1, noise: 0.03 },
  // papier peint des années 1970, passé et taché
  WP_FADED: { name: 'papier peint défraîchi', color: 0x8f927f, color2: 0xb3aa86, pattern: Pattern.DAMASK, scale: 2, noise: 0.08 },
  // capitons noirs (club)
  WP_BLACK: { name: 'tenture noire', color: 0x1a1a1e, color2: 0x2f2c35, pattern: Pattern.DAMASK, scale: 3, noise: 0.03 },
  PLASTER: { name: 'plâtre', color: 0xddd8cc, pattern: Pattern.PLASTER, noise: 0.04 },
  PLASTER_WHITE: { name: 'plâtre blanc', color: 0xefede8, pattern: Pattern.PLASTER, noise: 0.03 },
  // auréoles d'humidité, coulures (planque)
  PLASTER_DIRTY: { name: 'plâtre sale', color: 0xa69e89, pattern: Pattern.PLASTER, scale: 1, noise: 0.12 },
  PLASTER_GREY: { name: 'plâtre gris', color: 0x8f8f8d, pattern: Pattern.PLASTER, noise: 0.05 },
  PLASTER_DARK: { name: 'plâtre anthracite', color: 0x35383d, pattern: Pattern.PLASTER, noise: 0.04 },
  // placages affleurants à joints creux
  PANEL_DARK: { name: 'lambris sombre', color: 0x4a3121, color2: 0x1e140d, pattern: Pattern.PANEL, noise: 0.05, spec: 0.25 },
  PANEL_LIGHT: { name: 'lambris clair', color: 0x9b7751, color2: 0x4a3420, pattern: Pattern.PANEL, noise: 0.05, spec: 0.2 },
  SLATS_WOOD: { name: 'claustra bois', color: 0x8c6642, color2: 0x4a3420, pattern: Pattern.SLATS, noise: 0.05, spec: 0.2 },
  SLATS_DARK: { name: 'claustra noir', color: 0x2b2521, color2: 0x120e0c, pattern: Pattern.SLATS, noise: 0.05, spec: 0.3 },
  HEX_PANEL: { name: 'panneaux hexagonaux', color: 0x2d323b, color2: 0x15181d, pattern: Pattern.HEX, spec: 0.4, noise: 0.03 },
  CEILING: { name: 'plafond', color: 0xd9d5cb, pattern: Pattern.PLASTER, noise: 0.03 },
  CEILING_DARK: { name: 'plafond sombre', color: 0x2b2c30, pattern: Pattern.PLASTER, noise: 0.03 },
  CEILING_PANEL: { name: 'faux plafond', color: 0xd1d1cd, color2: 0x9a9a96, pattern: Pattern.TILE, scale: 2, noise: 0.03 },
  BEAM: { name: 'poutre', color: 0x4b3525, color2: 0x26190f, pattern: Pattern.PLANK, scale: 2, noise: 0.2 },
  MAHOGANY: { name: 'acajou', color: 0x5b2719, color2: 0x36150d, pattern: Pattern.PLANK, scale: 4, noise: 0.1, spec: 0.45 },
  WALNUT: { name: 'noyer', color: 0x5f3e27, color2: 0x3c2516, pattern: Pattern.PLANK, scale: 4, noise: 0.1, spec: 0.4 },
  FELT: { name: 'feutre vert', color: 0x1f5a3a, pattern: Pattern.CLOTH, noise: 0.05 },
  BOOKS: { name: 'livres', color: 0x6a2a2a, pattern: Pattern.BOOKS, noise: 0.1 },
  CRATE: { name: 'caisse', color: 0x9b7b4f, color2: 0x5e4428, pattern: Pattern.PLANK, scale: 5, noise: 0.25 },
  // affiches collées (collage coloré)
  POSTER: { name: 'affiches', color: 0xe3ddcc, color2: 0x1a1a1a, pattern: Pattern.POSTER, noise: 0.05, grime: 0.25 },
  CLOTH_WHITE: { name: 'tissu blanc', color: 0xece7db, pattern: Pattern.CLOTH, noise: 0.03 },
  AWNING_RED: { name: 'auvent rouge', color: 0xa3292a, color2: 0xebe4d6, pattern: Pattern.AWNING, noise: 0.05 },
  AWNING_GREEN: { name: 'auvent vert', color: 0x22704a, color2: 0xebe4d6, pattern: Pattern.AWNING, noise: 0.05 },
  AWNING_BLUE: { name: 'auvent bleu', color: 0x24477a, color2: 0xebe4d6, pattern: Pattern.AWNING, noise: 0.05 },
  AWNING_BLACK: { name: 'auvent noir', color: 0x1e1e22, color2: 0x3a3a42, pattern: Pattern.AWNING, noise: 0.05 },

  // --- Couleurs de faction (décor statique des logements) ---------------------------------
  CLOTH_RED: { name: 'drap cramoisi', color: 0x8e1b22, pattern: Pattern.CLOTH, noise: 0.05 },
  CLOTH_NAVY: { name: 'drap bleu marine', color: 0x1d3461, pattern: Pattern.CLOTH, noise: 0.05 },

  // --- Eau des fontaines (peu profonde : on y marche) -----------------------------------
  FOUNTAIN_WATER: { name: 'eau de fontaine', color: 0x16405a, color2: 0x2a6a8a, pattern: Pattern.NONE, spec: 0.95, emissive: 0x1e5a7a, emissiveMode: Emissive.PULSE, solid: false, lightPass: true, bulletPass: true },

  // --- Matériaux invisibles ------------------------------------------------------
  COVER: { name: 'couverture invisible', color: 0, pattern: Pattern.NONE, invisible: true, lightPass: true },
  COLLIDE: { name: 'collision invisible', color: 0, pattern: Pattern.NONE, invisible: true, lightPass: true, bulletPass: true },
  /** Garde-corps invisible : bloque la marche mais ni la vue ni les balles. */
  BARRIER: { name: 'barrière invisible', color: 0, pattern: Pattern.NONE, invisible: true, lightPass: true, bulletPass: true },

  // --- 2085 : revêtements supplémentaires (disponibles pour le générateur) ---------------
  /** Céramique de façade grand format (120 × 60), blanc brillant, joints fins. */
  CLAD_CERAMIC: { name: 'céramique de façade', color: 0xe8e6e1, color2: 0x9a9892, pattern: Pattern.ASHLAR, scale: 7, noise: 0.02, spec: 0.35, grime: 0.15 },
  /** Tôle perforée (pare-soleil, garde-corps, habillage de parkings). */
  METAL_PERFORATED: { name: 'tôle perforée', color: 0x8c929b, color2: 0x1a1c1f, pattern: Pattern.METAL_PANEL, scale: 3, noise: 0.03, spec: 0.4, grime: 0.12 },
  /** Panneaux de composite carbone (sergé), accents 2085. */
  CARBON_PANEL: { name: 'panneau carbone', color: 0x272b33, color2: 0x101113, pattern: Pattern.METAL_PANEL, scale: 4, noise: 0.02, spec: 0.55 },
  /** Verre holographique : mur-rideau à reflets irisés marqués. */
  GLASS_HOLO: { name: 'verre holographique', color: 0x1a2238, color2: 0x6a7690, pattern: Pattern.CURTAIN, scale: 3, emissive: 0xb8f0ff, emissiveMode: Emissive.NIGHT, spec: 0.9 },
  /** Grille d'arbre en fonte (fosses des arbres d'alignement). */
  TREE_GRATE: { name: "grille d'arbre", color: 0x2c2e33, color2: 0x2b2018, pattern: Pattern.GRATE, scale: 1, noise: 0.05, spec: 0.3, wettable: true },
  /** Toiture végétalisée (sedum vert et rouge). */
  ROOF_GREEN: { name: 'toiture végétalisée', color: 0x5f8a3e, color2: 0x8e4a3a, pattern: Pattern.GRASS, scale: 1, noise: 0.2, wettable: true },
  /** Bande podotactile jaune (bords de quais, passages piétons). */
  TACTILE: { name: 'bande podotactile', color: 0xe2b322, color2: 0x8a6a10, pattern: Pattern.SIDEWALK, scale: 4, noise: 0.03, spec: 0.2, wettable: true },
  /** Brique peinte en blanc (écailles sur brique rouge). */
  BRICK_WHITE: { name: 'brique peinte blanche', color: 0xe9e6df, color2: 0x9a4a38, pattern: Pattern.BRICK, scale: 1, noise: 0.04, spec: 0.12, grime: 0.3 },
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
