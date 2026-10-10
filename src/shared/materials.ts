// Palette des matériaux voxel du monde.
// Chaque voxel stocke un identifiant de matériau (0 = air). Le client transforme cette
// table en texture et le shader applique un motif procédural (briques, pavés, planches…)
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
}

export const enum Emissive {
  NONE = 0,
  ALWAYS = 1,
  NIGHT = 2, // fenêtres éclairées : brillent surtout la nuit
  FIRE = 3, // flamme vacillante
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
  grime?: number; // salissure extérieure (suie, éclaboussures) 0..1
  noise?: number; // variation de couleur par voxel 0..1
  /** solide pour les déplacements */
  solid?: boolean;
  /** laisse passer la lumière (verre, collisions invisibles…) */
  lightPass?: boolean;
  /** laisse passer les balles */
  bulletPass?: boolean;
  /** invisible (pas de maillage) */
  invisible?: boolean;
}

const DEFS = {
  AIR: { name: 'air', color: 0, pattern: Pattern.NONE, solid: false, lightPass: true, bulletPass: true, invisible: true },

  // --- Sol, rues, nature -------------------------------------------------
  ROAD: { name: 'pavés', color: 0x5d5852, color2: 0x2a2724, pattern: Pattern.COBBLE, noise: 0.5, grime: 0.3 },
  ROAD_DARK: { name: 'pavés sombres', color: 0x4b4743, color2: 0x232120, pattern: Pattern.COBBLE, noise: 0.5, grime: 0.3 },
  SIDEWALK: { name: 'dalles', color: 0x8a857c, color2: 0x58544e, pattern: Pattern.FLAGSTONE, noise: 0.3, grime: 0.4 },
  CURB: { name: 'bordure', color: 0x9b958b, color2: 0x6c675f, pattern: Pattern.ASHLAR, scale: 1, noise: 0.25 },
  DIRT: { name: 'terre', color: 0x5a4a38, color2: 0x463a2c, pattern: Pattern.DIRT, noise: 0.5 },
  MUD: { name: 'boue', color: 0x3b3228, color2: 0x2c251e, pattern: Pattern.DIRT, noise: 0.4 },
  GRASS: { name: 'herbe', color: 0x4b6a35, color2: 0x36502a, pattern: Pattern.GRASS, noise: 0.5 },
  LEAVES: { name: 'feuillage', color: 0x3f5f2c, color2: 0x263d1b, pattern: Pattern.FOLIAGE, noise: 0.6, lightPass: true },
  LEAVES_DARK: { name: 'feuillage sombre', color: 0x2f4a24, color2: 0x1d3015, pattern: Pattern.FOLIAGE, noise: 0.6, lightPass: true },
  HEDGE: { name: 'haie', color: 0x34522a, color2: 0x223a1a, pattern: Pattern.FOLIAGE, noise: 0.5 },
  BARK: { name: 'écorce', color: 0x4a3a2a, color2: 0x30251b, pattern: Pattern.BARK, noise: 0.4 },
  GRAVEL: { name: 'gravier', color: 0x7d766a, color2: 0x5f594f, pattern: Pattern.DIRT, noise: 0.7 },
  QUAY: { name: 'pierre de quai', color: 0x77726a, color2: 0x4f4b45, pattern: Pattern.ASHLAR, scale: 2, noise: 0.35, grime: 0.6 },
  DOCK_PLANK: { name: 'planches du quai', color: 0x6b5a45, color2: 0x3a3024, pattern: Pattern.PLANK, scale: 1, noise: 0.5, grime: 0.3 },
  RIVERBED: { name: 'lit du fleuve', color: 0x2f2a22, color2: 0x231f19, pattern: Pattern.DIRT, noise: 0.3 },

  // --- Murs extérieurs -----------------------------------------------------
  BRICK_RED: { name: 'brique rouge', color: 0x8e3b2e, color2: 0xb3a690, pattern: Pattern.BRICK, noise: 0.35, grime: 0.55 },
  BRICK_BROWN: { name: 'brique brune', color: 0x6e4a37, color2: 0xa89c8a, pattern: Pattern.BRICK, noise: 0.35, grime: 0.55 },
  BRICK_YELLOW: { name: 'brique de Londres', color: 0xa38d63, color2: 0xc9bea6, pattern: Pattern.BRICK, noise: 0.35, grime: 0.7 },
  BRICK_SOOT: { name: 'brique noircie', color: 0x4a3a33, color2: 0x6b625a, pattern: Pattern.BRICK, noise: 0.3, grime: 0.4 },
  BRICK_DARKRED: { name: 'brique bordeaux', color: 0x6a2a24, color2: 0x9d9180, pattern: Pattern.BRICK, noise: 0.35, grime: 0.5 },
  STONE: { name: 'pierre de Portland', color: 0xc9c2b2, color2: 0xa9a190, pattern: Pattern.ASHLAR, noise: 0.2, grime: 0.6 },
  STONE_GREY: { name: 'granit', color: 0x8d8b86, color2: 0x6a6863, pattern: Pattern.ASHLAR, noise: 0.25, grime: 0.4 },
  STONE_DARK: { name: 'pierre sombre', color: 0x5c5a56, color2: 0x45433f, pattern: Pattern.ASHLAR, noise: 0.25, grime: 0.3 },
  STUCCO: { name: 'stuc crème', color: 0xddd3bd, pattern: Pattern.PLASTER, noise: 0.12, grime: 0.5 },
  STUCCO_WHITE: { name: 'stuc blanc', color: 0xe6e1d6, pattern: Pattern.PLASTER, noise: 0.1, grime: 0.45 },
  STUCCO_GREY: { name: 'stuc gris', color: 0xa9a59c, pattern: Pattern.PLASTER, noise: 0.15, grime: 0.5 },
  TIMBER: { name: 'colombage', color: 0x3d2b1f, color2: 0x2a1d14, pattern: Pattern.PLANK, scale: 2, noise: 0.3 },
  WOOD_WALL: { name: 'bardage', color: 0x5e4d3b, color2: 0x3b3025, pattern: Pattern.PLANK, scale: 3, noise: 0.45, grime: 0.4 },
  CORRUGATED: { name: 'tôle ondulée', color: 0x6d6a66, color2: 0x4d4a47, pattern: Pattern.CORRUGATED, noise: 0.3, spec: 0.2, grime: 0.5 },

  PAINT_GREEN: { name: 'bois peint vert', color: 0x1f4a35, pattern: Pattern.PAINT, noise: 0.12, spec: 0.25, grime: 0.25 },
  PAINT_RED: { name: 'bois peint rouge', color: 0x7a1f1f, pattern: Pattern.PAINT, noise: 0.12, spec: 0.25, grime: 0.25 },
  PAINT_NAVY: { name: 'bois peint bleu', color: 0x1d2f52, pattern: Pattern.PAINT, noise: 0.12, spec: 0.25, grime: 0.25 },
  PAINT_BLACK: { name: 'bois peint noir', color: 0x1c1b1a, pattern: Pattern.PAINT, noise: 0.1, spec: 0.3, grime: 0.15 },
  PAINT_CREAM: { name: 'bois peint crème', color: 0xd8ccb0, pattern: Pattern.PAINT, noise: 0.1, spec: 0.2, grime: 0.4 },
  PAINT_MAROON: { name: 'bois peint bordeaux', color: 0x5a1d24, pattern: Pattern.PAINT, noise: 0.12, spec: 0.25, grime: 0.25 },
  PAINT_OCHRE: { name: 'bois peint ocre', color: 0xa67c2e, pattern: Pattern.PAINT, noise: 0.12, spec: 0.2, grime: 0.3 },
  PAINT_TEAL: { name: 'bois peint sarcelle', color: 0x245a58, pattern: Pattern.PAINT, noise: 0.12, spec: 0.25, grime: 0.25 },
  FRAME_WHITE: { name: 'menuiserie blanche', color: 0xd9d4c7, pattern: Pattern.PAINT, noise: 0.08, grime: 0.35 },
  FRAME_DARK: { name: 'menuiserie sombre', color: 0x2b2622, pattern: Pattern.PAINT, noise: 0.08 },

  IRON: { name: 'fonte', color: 0x222326, pattern: Pattern.METAL, spec: 0.5, noise: 0.1 },
  BRASS: { name: 'laiton', color: 0xb08d3c, pattern: Pattern.METAL, spec: 0.8, noise: 0.1 },
  GOLD: { name: 'dorure', color: 0xd4a640, pattern: Pattern.METAL, spec: 0.9, noise: 0.08 },
  LEAD: { name: 'plomb', color: 0x6b6f73, pattern: Pattern.METAL, spec: 0.2, noise: 0.2 },
  COPPER_GREEN: { name: 'cuivre vert-de-gris', color: 0x5f9a86, color2: 0x4a7c6b, pattern: Pattern.METAL, spec: 0.2, noise: 0.35 },

  GLASS: { name: 'vitre', color: 0x26313b, pattern: Pattern.GLASS, spec: 0.9, lightPass: true, bulletPass: true },
  GLASS_LIT: { name: 'vitre éclairée', color: 0x3a3428, pattern: Pattern.GLASS, spec: 0.6, emissive: 0xffa94d, emissiveMode: Emissive.NIGHT, lightPass: true, bulletPass: true },
  GLASS_SHOP: { name: 'vitrine', color: 0x343028, pattern: Pattern.GLASS, spec: 0.7, emissive: 0xffc77a, emissiveMode: Emissive.NIGHT, lightPass: true, bulletPass: true },
  GLASS_STAINED: { name: 'vitrail', color: 0x6a2a3a, pattern: Pattern.STAINED, spec: 0.4, emissive: 0xffffff, emissiveMode: Emissive.NIGHT, lightPass: true, bulletPass: true },

  SLATE: { name: 'ardoise', color: 0x3e434b, color2: 0x23272d, pattern: Pattern.SLATE, noise: 0.25, grime: 0.2 },
  ROOF_TILE: { name: 'tuile', color: 0x8a4a32, color2: 0x5a2c1e, pattern: Pattern.ROOF_TILE, noise: 0.3, grime: 0.3 },
  CHIMNEY_POT: { name: 'mitron', color: 0x9a5a3a, pattern: Pattern.PLASTER, noise: 0.2, grime: 0.8 },
  SOOT: { name: 'suie', color: 0x1e1c1b, pattern: Pattern.DIRT, noise: 0.3 },

  // --- Intérieurs -----------------------------------------------------------
  FLOOR_OAK: { name: 'plancher de chêne', color: 0x7a5634, color2: 0x4e3520, pattern: Pattern.PLANK, noise: 0.35 },
  FLOOR_DARK: { name: 'plancher sombre', color: 0x4a3322, color2: 0x2e1f14, pattern: Pattern.PLANK, noise: 0.35 },
  FLOOR_WORN: { name: 'plancher usé', color: 0x6a5a46, color2: 0x45392b, pattern: Pattern.PLANK, noise: 0.5 },
  PARQUET: { name: 'parquet', color: 0x8a6238, color2: 0x6a4626, pattern: Pattern.PARQUET, noise: 0.25, spec: 0.3 },
  CHECKER: { name: 'carrelage damier', color: 0xe8e2d4, color2: 0x26231f, pattern: Pattern.CHECKER, spec: 0.4 },
  FLOOR_FLAG: { name: 'dallage', color: 0x7d776d, color2: 0x55504a, pattern: Pattern.FLAGSTONE, noise: 0.3 },
  MARBLE: { name: 'marbre blanc', color: 0xe9e6df, color2: 0xa9a49b, pattern: Pattern.MARBLE, spec: 0.6 },
  MARBLE_BLACK: { name: 'marbre noir', color: 0x2a2725, color2: 0x6a645e, pattern: Pattern.MARBLE, spec: 0.6 },
  CARPET_RED: { name: 'tapis rouge', color: 0x7a1e22, color2: 0xc9a24a, pattern: Pattern.CARPET, noise: 0.1 },
  CARPET_BLUE: { name: 'tapis bleu', color: 0x22305a, color2: 0xb8a46a, pattern: Pattern.CARPET, noise: 0.1 },
  CARPET_GREEN: { name: 'tapis vert', color: 0x2b4a32, color2: 0xa88d4a, pattern: Pattern.CARPET, noise: 0.1 },
  CARPET_WORN: { name: 'tapis élimé', color: 0x6a4a3a, color2: 0x8a6a4a, pattern: Pattern.CARPET, noise: 0.25 },
  WP_RED: { name: 'papier peint rouge', color: 0x6e1c22, color2: 0x8f3036, pattern: Pattern.DAMASK, noise: 0.05 },
  WP_GREEN: { name: 'papier peint vert', color: 0x3d5a3f, color2: 0x587a52, pattern: Pattern.STRIPES, noise: 0.05 },
  WP_BLUE: { name: 'papier peint bleu', color: 0x283b63, color2: 0x3c5486, pattern: Pattern.DAMASK, noise: 0.05 },
  WP_OCHRE: { name: 'papier peint ocre', color: 0xa88a4f, color2: 0xc2a466, pattern: Pattern.STRIPES, noise: 0.05 },
  WP_FADED: { name: 'papier peint défraîchi', color: 0x8e8470, color2: 0x9c927d, pattern: Pattern.DAMASK, noise: 0.15 },
  WP_TEAL: { name: 'papier peint sarcelle', color: 0x2f5552, color2: 0x426f69, pattern: Pattern.DAMASK, noise: 0.05 },
  WP_BURGUNDY: { name: 'papier peint bordeaux', color: 0x4e1a22, color2: 0x6a2a30, pattern: Pattern.STRIPES, noise: 0.05 },
  PLASTER: { name: 'plâtre', color: 0xd6d0c2, pattern: Pattern.PLASTER, noise: 0.08 },
  PLASTER_DIRTY: { name: 'plâtre sale', color: 0xa39a86, pattern: Pattern.PLASTER, noise: 0.2 },
  PANEL_DARK: { name: 'lambris sombre', color: 0x3e2a1c, color2: 0x2a1c12, pattern: Pattern.PANEL, noise: 0.15, spec: 0.2 },
  PANEL_LIGHT: { name: 'lambris clair', color: 0x7a5a3a, color2: 0x5c4128, pattern: Pattern.PANEL, noise: 0.15, spec: 0.2 },
  CEILING: { name: 'plafond', color: 0xcfc6b2, pattern: Pattern.PLASTER, noise: 0.06 },
  BEAM: { name: 'poutre', color: 0x3a2a1d, color2: 0x26190f, pattern: Pattern.PLANK, scale: 2, noise: 0.3 },
  FIREBRICK: { name: 'brique réfractaire', color: 0x4a2a22, color2: 0x2a1a15, pattern: Pattern.BRICK, noise: 0.3 },
  FIRE: { name: 'feu', color: 0xff7a1a, pattern: Pattern.FIRE, emissive: 0xff8a2a, emissiveMode: Emissive.FIRE, lightPass: true, bulletPass: true },
  LAMP_GLOW: { name: 'flamme de lampe', color: 0xffe0a0, pattern: Pattern.NONE, emissive: 0xffc870, emissiveMode: Emissive.ALWAYS, lightPass: true },
  MAHOGANY: { name: 'acajou', color: 0x4f2318, color2: 0x36150d, pattern: Pattern.PLANK, scale: 4, noise: 0.2, spec: 0.4 },
  WALNUT: { name: 'noyer', color: 0x5a3a24, color2: 0x3c2516, pattern: Pattern.PLANK, scale: 4, noise: 0.2, spec: 0.35 },
  FELT: { name: 'feutre vert', color: 0x1f5a3a, pattern: Pattern.CLOTH, noise: 0.08 },
  BOOKS: { name: 'livres', color: 0x6a2a2a, pattern: Pattern.BOOKS, noise: 0.1 },
  CRATE: { name: 'caisse', color: 0x8a6a42, color2: 0x5e4428, pattern: Pattern.PLANK, scale: 5, noise: 0.35 },
  BARREL: { name: 'tonneau', color: 0x6a4a2a, color2: 0x45301b, pattern: Pattern.PLANK, scale: 6, noise: 0.3 },
  SACK: { name: 'sac de jute', color: 0xa89470, color2: 0x8a7656, pattern: Pattern.CLOTH, noise: 0.25 },
  HAY: { name: 'paille', color: 0xb8a050, color2: 0x8f7a38, pattern: Pattern.FOLIAGE, noise: 0.5 },
  COAL: { name: 'charbon', color: 0x1a1a1c, color2: 0x2e2e33, pattern: Pattern.DIRT, noise: 0.6, spec: 0.3 },
  MACHINE: { name: 'fonte de machine', color: 0x3a3d40, pattern: Pattern.METAL, spec: 0.45, noise: 0.15 },
  MACHINE_GREEN: { name: 'machine peinte', color: 0x2f4a3a, pattern: Pattern.METAL, spec: 0.35, noise: 0.12 },
  RUST: { name: 'rouille', color: 0x7a4a2a, color2: 0x5a3018, pattern: Pattern.DIRT, noise: 0.5 },
  COPPER: { name: 'cuivre', color: 0xb06a3a, pattern: Pattern.METAL, spec: 0.8, noise: 0.15 },
  CHURCH_STONE: { name: 'pierre d’église', color: 0x9d968a, color2: 0x7a746a, pattern: Pattern.ASHLAR, noise: 0.25, grime: 0.6 },
  PEW: { name: 'banc d’église', color: 0x4a3020, color2: 0x2e1d13, pattern: Pattern.PLANK, scale: 4, noise: 0.2 },
  POSTER: { name: 'affiches', color: 0xd8cfb5, color2: 0x2a2a2a, pattern: Pattern.POSTER, noise: 0.1, grime: 0.3 },
  CLOTH_WHITE: { name: 'nappe', color: 0xe8e2d4, pattern: Pattern.CLOTH, noise: 0.05 },
  ROPE: { name: 'cordage', color: 0x8a7650, pattern: Pattern.CLOTH, noise: 0.3 },
  SAIL: { name: 'voile', color: 0xd8d0bc, pattern: Pattern.CLOTH, noise: 0.15, grime: 0.3 },
  HULL: { name: 'coque', color: 0x2a2622, color2: 0x1a1714, pattern: Pattern.PLANK, scale: 1, noise: 0.25 },
  HULL_RED: { name: 'coque rouge', color: 0x6a2a22, color2: 0x4a1a15, pattern: Pattern.PLANK, scale: 1, noise: 0.25 },
  AWNING_RED: { name: 'auvent rayé rouge', color: 0x8a2a24, color2: 0xd8ccb0, pattern: Pattern.AWNING, noise: 0.1 },
  AWNING_GREEN: { name: 'auvent rayé vert', color: 0x2a5a3a, color2: 0xd8ccb0, pattern: Pattern.AWNING, noise: 0.1 },
  AWNING_BLUE: { name: 'auvent rayé bleu', color: 0x24406a, color2: 0xd8ccb0, pattern: Pattern.AWNING, noise: 0.1 },

  // --- Couleurs de faction (décor statique des QG) -----------------------------
  CLOTH_RED: { name: 'drap rouge', color: 0x8e1b22, pattern: Pattern.CLOTH, noise: 0.08 },
  CLOTH_NAVY: { name: 'drap bleu', color: 0x1d3461, pattern: Pattern.CLOTH, noise: 0.08 },
  SILVER: { name: 'argent', color: 0xc9d1dc, pattern: Pattern.METAL, spec: 0.9, noise: 0.06 },

  // --- Matériaux invisibles ------------------------------------------------------
  COVER: { name: 'couverture invisible', color: 0, pattern: Pattern.NONE, invisible: true, lightPass: true },
  COLLIDE: { name: 'collision invisible', color: 0, pattern: Pattern.NONE, invisible: true, lightPass: true, bulletPass: true },
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
for (let i = 0; i < MATERIALS.length; i++) {
  const d = MATERIALS[i];
  MAT_SOLID[i] = d.solid === false ? 0 : 1;
  MAT_BLOCKS_LIGHT[i] = d.lightPass ? 0 : 1;
  MAT_BLOCKS_BULLETS[i] = d.bulletPass || d.solid === false ? 0 : 1;
  MAT_VISIBLE[i] = d.invisible ? 0 : 1;
}
