// Plan de New York 2085 : quartiers, bâtiments, rues, rivière, ponts et métro (en mètres).
// Axe X vers l'est, axe Z vers le sud. La ville jouable mesure 288 m × 240 m.
// La carte est symétrique par rapport à l'axe z = 120 (Harlem ↔ Chinatown,
// Central Park ↔ Wall Street, Queens ↔ Brooklyn ; Midtown/Times Square au centre).

export const WORLD_W = 288; // m (axe X)
export const WORLD_D = 240; // m (axe Z)
export const WORLD_H = 72; // m (hauteur stockée, de −8,5 m à +63,5 m)
/** Plus haut sol intérieur autorisé (m) : au-dessus, seules les façades (éclairage précalculé). */
export const INTERIOR_MAX_Y = 44;

export const enum Faction {
  NEUTRAL = 0,
  DADOU = 1,
  EVEN = 2,
  POLICE = 3,
  NONE = 255, // bâtiment non capturable
}

export type BossId = 'dadou' | 'even';
export const BOSS_FACTION: Record<BossId, Faction> = { dadou: Faction.DADOU, even: Faction.EVEN };

export type DistrictId = 'harlem' | 'centralpark' | 'midtown' | 'chinatown' | 'wallstreet' | 'queens' | 'brooklyn';

export interface DistrictDef {
  id: DistrictId;
  index: number;
  name: string; // nom affiché (français)
  short: string;
  rect: [number, number, number, number]; // x0, z0, x1, z1 (zone d'appartenance)
  label: [number, number]; // position de l'étiquette sur la carte
  gang: string; // gang neutre local
  description: string;
  /** Teinte d'ambiance des néons du quartier (sRGB). */
  neon: number;
}

// ---------------------------------------------------------------------------- géographie

/** East River (x) et rives. */
export const RIVER_X0 = 196;
export const RIVER_X1 = 222;
/** Newtown Creek : canal entre Queens et Brooklyn. */
export const CREEK: [number, number, number, number] = [222, 114, 282, 126];
/** Niveau de l'eau et du lit (m). */
export const WATER_Y = -1.5;
export const RIVERBED_Y = -3.5;
/** Profondeur des quais du métro et des tunnels (sol, m). */
export const SUBWAY_Y = -7.5;

export const DISTRICTS: DistrictDef[] = [
  {
    id: 'harlem',
    index: 0,
    name: 'Harlem',
    short: 'Harlem',
    rect: [0, 0, 92, 76],
    label: [46, 32],
    gang: 'Les Lions de Lenox',
    description: 'Brownstones, clubs de jazz et salles de boxe : l’âme rebelle d’Uptown.',
    neon: 0xffb020,
  },
  {
    id: 'centralpark',
    index: 1,
    name: 'Central Park',
    short: 'Central Park',
    rect: [92, 0, 196, 76],
    label: [141, 30],
    gang: 'La Garde Sterling',
    description: 'Le grand parc et les tours de milliardaires de Central Park Sud.',
    neon: 0x7dffb0,
  },
  {
    id: 'midtown',
    index: 2,
    name: 'Times Square',
    short: 'Times Sq.',
    rect: [0, 76, 196, 164],
    label: [98, 120],
    gang: 'Les Néons de Broadway',
    description: 'Midtown et Times Square : écrans géants, casinos et la gare de Grand Central. Le joyau de New York.',
    neon: 0xff3cc8,
  },
  {
    id: 'chinatown',
    index: 3,
    name: 'Chinatown',
    short: 'Chinatown',
    rect: [0, 164, 92, 240],
    label: [46, 208],
    gang: 'La Triade du Jade',
    description: 'Ruelles serrées, maisons de thé et marché noir de la technologie.',
    neon: 0xff4040,
  },
  {
    id: 'wallstreet',
    index: 4,
    name: 'Wall Street',
    short: 'Wall Street',
    rect: [92, 164, 196, 240],
    label: [141, 210],
    gang: 'La Sécurité Axiom',
    description: 'Le quartier financier : la Bourse, les banques et les tours des corporations.',
    neon: 0x40c8ff,
  },
  {
    id: 'queens',
    index: 5,
    name: 'Queens',
    short: 'Queens',
    rect: [222, 0, 288, 120],
    label: [258, 46],
    gang: 'Les Rouleurs de Flushing',
    description: 'Dépôts, entrepôts logistiques et marchés de nuit. Le fief d’Even.',
    neon: 0x40a0ff,
  },
  {
    id: 'brooklyn',
    index: 6,
    name: 'Brooklyn',
    short: 'Brooklyn',
    rect: [222, 120, 288, 240],
    label: [258, 194],
    gang: 'Les Corbeaux de Red Hook',
    description: 'Rues rugueuses, garages et entrepôts du Navy Yard. Le fief de Dadou.',
    neon: 0xff3050,
  },
];

export const DISTRICT_BY_ID: Record<DistrictId, DistrictDef> = Object.fromEntries(
  DISTRICTS.map((d) => [d.id, d]),
) as Record<DistrictId, DistrictDef>;

export function districtAt(x: number, z: number): DistrictDef {
  for (const d of DISTRICTS) {
    if (x >= d.rect[0] && x < d.rect[2] && z >= d.rect[1] && z < d.rect[3]) return d;
  }
  // l'East River : on rattache au quartier le plus proche
  if (x >= RIVER_X0 && x < RIVER_X1) return z < 120 ? (x < 209 ? DISTRICT_BY_ID.centralpark : DISTRICT_BY_ID.queens) : x < 209 ? DISTRICT_BY_ID.wallstreet : DISTRICT_BY_ID.brooklyn;
  return z < 120 ? DISTRICT_BY_ID.harlem : DISTRICT_BY_ID.chinatown;
}

// ---------------------------------------------------------------------------- bâtiments

export type BuildingType =
  // logements de l'ascension des parrains
  | 'hideout'
  | 'garage'
  | 'loft'
  | 'penthouse'
  | 'tower'
  // commerces et lieux de pègre
  | 'club'
  | 'jazz'
  | 'casino'
  | 'theatre'
  | 'gym'
  | 'bodega'
  | 'diner'
  | 'pharmacy'
  | 'herbalist'
  | 'teahouse'
  | 'mahjong'
  | 'techmarket'
  | 'restaurant'
  | 'boathouse'
  | 'hotel'
  | 'gallery'
  | 'bank'
  | 'exchange'
  | 'corp'
  | 'security'
  | 'studio'
  | 'station'
  | 'showroom'
  | 'depot'
  | 'nightmarket'
  | 'factory'
  | 'brewery'
  | 'junkyard'
  | 'tattoo'
  // non capturables
  | 'police'
  | 'landmark'
  | 'filler';

export type Side = 'N' | 'S' | 'E' | 'W';

export interface ResidenceInfo {
  boss: BossId;
  tier: 1 | 2 | 3 | 4 | 5;
}

export interface BuildingDef {
  id: number;
  key: string;
  name: string;
  type: BuildingType;
  district: DistrictId;
  rect: [number, number, number, number]; // x0, z0, x1, z1 en mètres (multiples de 0,5)
  door: Side;
  /** Étages accessibles (rez-de-chaussée compris). */
  stories: number;
  /** Hauteur extérieure totale (m) si plus haute que les étages accessibles (tours). */
  height?: number;
  isKey?: boolean;
  /** Logement de l'échelle d'un parrain (planque, garage, loft, penthouse, tour). */
  residence?: ResidenceInfo;
  startOwner: Faction;
  /** Nombre de voyous neutres qui défendent le bâtiment au début (0 = à vendre). */
  guards: number;
  price: number; // prix d'achat si neutre et sans défenseurs (ou prix du logement)
  income: number; // $/min
  capturable: boolean;
  /** Description courte pour la carte stratégique. */
  blurb: string;
  /** Variante de style (couleurs de façade…). */
  style?: number;
  /** Niveau de sécurité : 0 aucun, 1 caméras, 2 caméras + tourelles. */
  security?: number;
  /** Braquage possible : butin ($) et durée (s). */
  heist?: { reward: number; time: number; label: string };
}

let nextId = 0;
function b(def: Omit<BuildingDef, 'id'>): BuildingDef {
  return { id: nextId++, ...def };
}

/** Raccourci pour les logements des parrains (réservés, non capturables avant l'achat). */
function residence(boss: BossId, tier: ResidenceInfo['tier'], def: Omit<BuildingDef, 'id' | 'residence' | 'startOwner' | 'guards' | 'capturable' | 'isKey'>): BuildingDef {
  return b({
    ...def,
    residence: { boss, tier },
    startOwner: tier === 1 ? (boss === 'dadou' ? Faction.DADOU : Faction.EVEN) : Faction.NEUTRAL,
    guards: 0,
    capturable: true,
  });
}

export const BUILDINGS: BuildingDef[] = [
  // ================================================================== BROOKLYN (Dadou)
  residence('dadou', 1, {
    key: 'planque_bushwick',
    name: 'Planque de Bushwick',
    type: 'hideout',
    district: 'brooklyn',
    rect: [240, 204, 254, 222],
    door: 'W',
    stories: 2,
    price: 0,
    income: 10,
    blurb: 'Un deux-pièces miteux au-dessus d’une laverie. Tout commence ici.',
  }),
  residence('dadou', 2, {
    key: 'garage_redhook',
    name: 'Garage de Red Hook',
    type: 'garage',
    district: 'brooklyn',
    rect: [238, 168, 256, 188],
    door: 'W',
    stories: 2,
    price: 1500,
    income: 30,
    blurb: 'Un garage de carrossage reconverti en base d’opérations.',
  }),
  b({
    key: 'navy_yard',
    name: 'Entrepôts du Navy Yard',
    type: 'depot',
    district: 'brooklyn',
    rect: [264, 158, 282, 188],
    door: 'W',
    stories: 2,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 4,
    price: 0,
    income: 60,
    capturable: true,
    blurb: 'Docks, conteneurs et marchandises détournées. Bâtiment clé de Brooklyn.',
  }),
  b({
    key: 'club_electric',
    name: 'Club Electric Brooklyn',
    type: 'club',
    district: 'brooklyn',
    rect: [264, 202, 282, 222],
    door: 'W',
    stories: 2,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 4,
    price: 0,
    income: 55,
    capturable: true,
    blurb: 'La boîte de nuit la plus bruyante de l’East River. Bâtiment clé.',
  }),
  b({
    key: 'brasserie_williamsburg',
    name: 'Brasserie de Williamsburg',
    type: 'brewery',
    district: 'brooklyn',
    rect: [238, 130, 256, 146],
    door: 'S',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 3,
    price: 0,
    income: 35,
    capturable: true,
    blurb: 'Bière artisanale et alambics clandestins.',
  }),
  b({
    key: 'tatoueur',
    name: 'Atelier de tatouage Neon Ink',
    type: 'tattoo',
    district: 'brooklyn',
    rect: [264, 130, 282, 146],
    door: 'S',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 350,
    income: 20,
    capturable: true,
    blurb: 'Tatouages lumineux et implants discrets. À vendre.',
  }),

  // ================================================================== QUEENS (Even)
  residence('even', 1, {
    key: 'planque_astoria',
    name: 'Planque d’Astoria',
    type: 'hideout',
    district: 'queens',
    rect: [240, 18, 254, 36],
    door: 'W',
    stories: 2,
    price: 0,
    income: 10,
    blurb: 'Un studio humide au-dessus d’une épicerie. Tout commence ici.',
    style: 1,
  }),
  residence('even', 2, {
    key: 'depot_lic',
    name: 'Dépôt de Long Island City',
    type: 'garage',
    district: 'queens',
    rect: [238, 52, 256, 72],
    door: 'W',
    stories: 2,
    price: 1500,
    income: 30,
    blurb: 'Un dépôt de livraison transformé en base d’opérations.',
    style: 1,
  }),
  b({
    key: 'hub_sunnyside',
    name: 'Hub logistique de Sunnyside',
    type: 'depot',
    district: 'queens',
    rect: [264, 52, 282, 82],
    door: 'W',
    stories: 2,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 4,
    price: 0,
    income: 60,
    capturable: true,
    blurb: 'Drones de livraison et camions autonomes. Bâtiment clé de Queens.',
    style: 1,
  }),
  b({
    key: 'marche_flushing',
    name: 'Marché de nuit de Flushing',
    type: 'nightmarket',
    district: 'queens',
    rect: [264, 18, 282, 38],
    door: 'W',
    stories: 2,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 4,
    price: 0,
    income: 55,
    capturable: true,
    blurb: 'Étals fumants, puces électroniques et marchandises volées. Bâtiment clé.',
  }),
  b({
    key: 'usine_drones',
    name: 'Usine de drones Steinway',
    type: 'factory',
    district: 'queens',
    rect: [238, 94, 256, 110],
    door: 'N',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 3,
    price: 0,
    income: 35,
    capturable: true,
    blurb: 'Chaînes d’assemblage de drones civils… et moins civils.',
  }),
  b({
    key: 'casse_willets',
    name: 'Casse de Willets Point',
    type: 'junkyard',
    district: 'queens',
    rect: [264, 94, 282, 110],
    door: 'N',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 350,
    income: 20,
    capturable: true,
    blurb: 'Carcasses de voitures volantes et pièces détachées. À vendre.',
  }),

  // ================================================================== HARLEM
  b({
    key: 'neo_apollo',
    name: 'Théâtre Néo-Apollo',
    type: 'theatre',
    district: 'harlem',
    rect: [14, 44, 42, 68],
    door: 'S',
    stories: 2,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 5,
    price: 0,
    income: 65,
    capturable: true,
    blurb: 'La scène mythique de la 125e Rue, en version holographique. Bâtiment clé.',
  }),
  b({
    key: 'savoy',
    name: 'Club de jazz Le Savoy',
    type: 'jazz',
    district: 'harlem',
    rect: [58, 18, 84, 40],
    door: 'N',
    stories: 2,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 4,
    price: 0,
    income: 55,
    capturable: true,
    blurb: 'Saxophones, whisky et rendez-vous discrets. Bâtiment clé.',
  }),
  b({
    key: 'boxe_harlem',
    name: 'Salle de boxe de Harlem',
    type: 'gym',
    district: 'harlem',
    rect: [14, 18, 28, 40],
    door: 'N',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 3,
    price: 0,
    income: 30,
    capturable: true,
    blurb: 'Ring, sacs de frappe et paris clandestins.',
  }),
  b({
    key: 'bodega_125',
    name: 'Bodega de la 125e Rue',
    type: 'bodega',
    district: 'harlem',
    rect: [30, 30, 42, 40],
    door: 'E',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 300,
    income: 18,
    capturable: true,
    blurb: 'Café, sandwichs et billets de loterie. À vendre.',
  }),
  b({
    key: 'police_28',
    name: 'Commissariat du 28e district',
    type: 'police',
    district: 'harlem',
    rect: [30, 18, 42, 28],
    door: 'N',
    stories: 2,
    startOwner: Faction.NONE,
    guards: 0,
    price: 0,
    income: 0,
    capturable: false,
    blurb: 'La police de New York (NYPD) pour tout Uptown.',
  }),
  residence('even', 3, {
    key: 'loft_lenox',
    name: 'Loft de Lenox Avenue',
    type: 'loft',
    district: 'harlem',
    rect: [58, 46, 84, 68],
    door: 'S',
    stories: 2,
    price: 4000,
    income: 45,
    blurb: 'Un loft d’artiste sous verrière, briques et néons bleus.',
    style: 1,
  }),

  // ================================================================== CHINATOWN
  b({
    key: 'marche_tech',
    name: 'Marché tech de Canal Street',
    type: 'techmarket',
    district: 'chinatown',
    rect: [14, 172, 42, 196],
    door: 'N',
    stories: 2,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 5,
    price: 0,
    income: 65,
    capturable: true,
    blurb: 'Puces, implants et logiciels pirates. Bâtiment clé de Chinatown.',
  }),
  b({
    key: 'maison_the',
    name: 'Maison de thé du Dragon de Jade',
    type: 'teahouse',
    district: 'chinatown',
    rect: [58, 200, 84, 222],
    door: 'S',
    stories: 2,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 4,
    price: 0,
    income: 55,
    capturable: true,
    blurb: 'Le quartier général de la Triade. Bâtiment clé.',
  }),
  b({
    key: 'mahjong',
    name: 'Salle de mah-jong du Lotus',
    type: 'mahjong',
    district: 'chinatown',
    rect: [14, 200, 28, 222],
    door: 'S',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 3,
    price: 0,
    income: 30,
    capturable: true,
    blurb: 'Tuiles qui claquent et dettes de jeu.',
  }),
  b({
    key: 'herboristerie',
    name: 'Herboristerie Wing Fat',
    type: 'herbalist',
    district: 'chinatown',
    rect: [30, 200, 42, 210],
    door: 'E',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 300,
    income: 18,
    capturable: true,
    blurb: 'Racines, thés et remèdes « spéciaux ». À vendre.',
  }),
  b({
    key: 'police_5',
    name: 'Commissariat du 5e district',
    type: 'police',
    district: 'chinatown',
    rect: [30, 212, 42, 222],
    door: 'S',
    stories: 2,
    startOwner: Faction.NONE,
    guards: 0,
    price: 0,
    income: 0,
    capturable: false,
    blurb: 'La police de New York (NYPD) pour tout le sud de Manhattan.',
  }),
  residence('dadou', 3, {
    key: 'loft_canal',
    name: 'Loft de Canal Street',
    type: 'loft',
    district: 'chinatown',
    rect: [58, 172, 84, 194],
    door: 'N',
    stories: 2,
    price: 4000,
    income: 45,
    blurb: 'Un loft industriel au-dessus des enseignes de Canal Street.',
  }),

  // ================================================================== CENTRAL PARK
  residence('even', 4, {
    key: 'penthouse_cps',
    name: 'Penthouse de Central Park Sud',
    type: 'penthouse',
    district: 'centralpark',
    rect: [100, 50, 122, 70],
    door: 'S',
    stories: 1,
    height: 52,
    price: 9000,
    income: 70,
    blurb: 'Le sommet d’une tour de milliardaires, vue sur tout Central Park.',
    style: 1,
  }),
  b({
    key: 'plaza',
    name: 'Hôtel Plaza Céleste',
    type: 'hotel',
    district: 'centralpark',
    rect: [126, 50, 150, 70],
    door: 'S',
    stories: 4,
    height: 30,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 5,
    price: 0,
    income: 75,
    capturable: true,
    security: 1,
    blurb: 'Le palace le plus célèbre de New York. Bâtiment clé.',
  }),
  b({
    key: 'galerie_sterling',
    name: 'Galerie Sterling',
    type: 'gallery',
    district: 'centralpark',
    rect: [154, 50, 182, 70],
    door: 'S',
    stories: 2,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 5,
    price: 0,
    income: 75,
    capturable: true,
    security: 2,
    heist: { reward: 2400, time: 40, label: 'Voler la collection holographique' },
    blurb: 'Œuvres d’art inestimables sous haute surveillance. Bâtiment clé.',
  }),
  b({
    key: 'tavern',
    name: 'Tavern on the Green',
    type: 'restaurant',
    district: 'centralpark',
    rect: [104, 22, 120, 34],
    door: 'S',
    stories: 1,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 4,
    price: 0,
    income: 70,
    capturable: true,
    blurb: 'Le restaurant chic au cœur du parc. Bâtiment clé.',
  }),
  b({
    key: 'boathouse',
    name: 'Boathouse du lac',
    type: 'boathouse',
    district: 'centralpark',
    rect: [160, 22, 176, 32],
    door: 'S',
    stories: 1,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 450,
    income: 25,
    capturable: true,
    blurb: 'Location de barques et café au bord du lac. À vendre.',
  }),

  // ================================================================== WALL STREET
  residence('dadou', 4, {
    key: 'penthouse_ws',
    name: 'Penthouse de Wall Street',
    type: 'penthouse',
    district: 'wallstreet',
    rect: [100, 170, 122, 190],
    door: 'N',
    stories: 1,
    height: 52,
    price: 9000,
    income: 70,
    blurb: 'Le dernier étage d’une tour de verre qui domine le quartier financier.',
  }),
  b({
    key: 'banque_federale',
    name: 'Banque Fédérale de New York',
    type: 'bank',
    district: 'wallstreet',
    rect: [126, 170, 150, 190],
    door: 'N',
    stories: 3,
    height: 30,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 5,
    price: 0,
    income: 75,
    capturable: true,
    security: 2,
    heist: { reward: 2400, time: 40, label: 'Braquer la salle des coffres' },
    blurb: 'Les réserves d’or de la ville, sous clé numérique. Bâtiment clé.',
  }),
  b({
    key: 'sentinel',
    name: 'Centre de sécurité Sentinel',
    type: 'security',
    district: 'wallstreet',
    rect: [154, 170, 182, 190],
    door: 'N',
    stories: 3,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 450,
    income: 25,
    capturable: true,
    security: 1,
    blurb: 'Les caméras de tout le quartier. À vendre au plus offrant.',
  }),
  b({
    key: 'bourse',
    name: 'Bourse de New York',
    type: 'exchange',
    district: 'wallstreet',
    rect: [100, 198, 128, 222],
    door: 'N',
    stories: 3,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 5,
    price: 0,
    income: 75,
    capturable: true,
    security: 1,
    blurb: 'Le temple des marchés, colonnes et écrans de cotation. Bâtiment clé.',
  }),
  b({
    key: 'tour_axiom',
    name: 'Tour Axiom',
    type: 'corp',
    district: 'wallstreet',
    rect: [134, 200, 156, 222],
    door: 'N',
    stories: 2,
    height: 58,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 5,
    price: 0,
    income: 70,
    capturable: true,
    security: 2,
    blurb: 'Siège de la corporation qui possède la moitié de Manhattan. Bâtiment clé.',
  }),

  // ================================================================== MIDTOWN / TIMES SQUARE
  residence('even', 5, {
    key: 'tour_zenith',
    name: 'Tour Zénith',
    type: 'tower',
    district: 'midtown',
    rect: [100, 82, 124, 98],
    door: 'S',
    stories: 1,
    height: 62,
    price: 16000,
    income: 100,
    blurb: 'Le gratte-ciel qui domine Times Square par le nord.',
    style: 1,
  }),
  residence('dadou', 5, {
    key: 'tour_meridien',
    name: 'Tour Méridien',
    type: 'tower',
    district: 'midtown',
    rect: [100, 142, 124, 158],
    door: 'N',
    stories: 1,
    height: 62,
    price: 16000,
    income: 100,
    blurb: 'Le gratte-ciel qui domine Times Square par le sud.',
  }),
  b({
    key: 'casino_neon',
    name: 'Casino Néon de Broadway',
    type: 'casino',
    district: 'midtown',
    rect: [56, 102, 70, 138],
    door: 'E',
    stories: 3,
    height: 22,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 6,
    price: 0,
    income: 90,
    capturable: true,
    security: 1,
    heist: { reward: 2400, time: 40, label: 'Vider la caisse du casino' },
    blurb: 'Tables holographiques et jetons en or. Bâtiment clé de Times Square.',
  }),
  b({
    key: 'studio_holo',
    name: 'Studio Holo-TV',
    type: 'studio',
    district: 'midtown',
    rect: [126, 102, 140, 138],
    door: 'W',
    stories: 3,
    height: 22,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 6,
    price: 0,
    income: 85,
    capturable: true,
    security: 1,
    blurb: 'Il contrôle les écrans géants de Times Square. Bâtiment clé.',
  }),
  b({
    key: 'grand_central',
    name: 'Grand Central',
    type: 'station',
    district: 'midtown',
    rect: [154, 100, 184, 140],
    door: 'W',
    stories: 2,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 6,
    price: 0,
    income: 85,
    capturable: true,
    blurb: 'La gare légendaire, plaque tournante de tous les trafics. Bâtiment clé.',
  }),
  b({
    key: 'theatre_lumiere',
    name: 'Théâtre Lumière',
    type: 'theatre',
    district: 'midtown',
    rect: [14, 84, 42, 112],
    door: 'E',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 4,
    price: 0,
    income: 50,
    capturable: true,
    blurb: 'Comédies musicales holographiques, guichets bondés.',
    style: 1,
  }),
  b({
    key: 'club_hudson',
    name: 'Club Hudson',
    type: 'club',
    district: 'midtown',
    rect: [14, 128, 42, 156],
    door: 'E',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 4,
    price: 0,
    income: 50,
    capturable: true,
    blurb: 'Le club où la jeunesse dorée vient se perdre.',
    style: 1,
  }),
  b({
    key: 'diner',
    name: 'Diner de la 8e Avenue',
    type: 'diner',
    district: 'midtown',
    rect: [58, 84, 84, 96],
    door: 'W',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 400,
    income: 22,
    capturable: true,
    blurb: 'Burgers, milk-shakes et néons rouges. À vendre.',
  }),
  b({
    key: 'pharmacie',
    name: 'Pharmacie 24/24',
    type: 'pharmacy',
    district: 'midtown',
    rect: [58, 144, 84, 156],
    door: 'W',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 400,
    income: 22,
    capturable: true,
    blurb: 'Médicaments… et stimulants sans ordonnance. À vendre.',
  }),
  b({
    key: 'concession',
    name: 'Concession Hover-Motors',
    type: 'showroom',
    district: 'midtown',
    rect: [126, 84, 140, 98],
    door: 'E',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 3,
    price: 0,
    income: 40,
    capturable: true,
    blurb: 'Voitures et motos de luxe en vitrine. Remise pour le propriétaire.',
  }),
  b({
    key: 'grand_magasin',
    name: 'Grand magasin Lumen',
    type: 'showroom',
    district: 'midtown',
    rect: [126, 142, 140, 156],
    door: 'E',
    stories: 3,
    startOwner: Faction.NEUTRAL,
    guards: 3,
    price: 0,
    income: 40,
    capturable: true,
    blurb: 'Six étages de luxe holographique. Une vitrine pour qui le tient.',
    style: 1,
  }),
  b({
    key: 'chrysler',
    name: 'Chrysler Building',
    type: 'landmark',
    district: 'midtown',
    rect: [156, 82, 172, 96],
    door: 'W',
    stories: 1,
    height: 63,
    startOwner: Faction.NONE,
    guards: 0,
    price: 0,
    income: 0,
    capturable: false,
    blurb: 'La flèche art déco la plus célèbre du monde, ravivée au néon.',
  }),
  b({
    key: 'empire_state',
    name: 'Empire State Building',
    type: 'landmark',
    district: 'midtown',
    rect: [156, 144, 184, 158],
    door: 'W',
    stories: 1,
    height: 63,
    startOwner: Faction.NONE,
    guards: 0,
    price: 0,
    income: 0,
    capturable: false,
    blurb: 'Le géant de la 34e Rue, couronné d’une antenne de lumière.',
    style: 1,
  }),
];

export const BUILDING_BY_KEY: Record<string, BuildingDef> = Object.fromEntries(BUILDINGS.map((bd) => [bd.key, bd]));

export function buildingsInDistrict(d: DistrictId): BuildingDef[] {
  return BUILDINGS.filter((bd) => bd.district === d);
}

export function keyBuildings(d: DistrictId): BuildingDef[] {
  return BUILDINGS.filter((bd) => bd.district === d && bd.isKey);
}

/** Échelle des logements de chaque parrain, du palier 1 au palier 5. */
export const RESIDENCES: Record<BossId, BuildingDef[]> = {
  dadou: BUILDINGS.filter((bd) => bd.residence?.boss === 'dadou').sort((a, c) => a.residence!.tier - c.residence!.tier),
  even: BUILDINGS.filter((bd) => bd.residence?.boss === 'even').sort((a, c) => a.residence!.tier - c.residence!.tier),
};

/** QG de départ (palier 1). */
export const HQ_BUILDING: Record<BossId, BuildingDef> = {
  dadou: RESIDENCES.dadou[0],
  even: RESIDENCES.even[0],
};

export const TIER_NAME: Record<number, string> = { 1: 'Planque', 2: 'Garage', 3: 'Loft', 4: 'Penthouse', 5: 'Tour' };

// ---------------------------------------------------------------------------- espaces publics

/** Zones spéciales (parcs, places…) pour la génération et la carte. */
export interface AreaDef {
  kind: 'park' | 'plaza' | 'lake' | 'promenade' | 'yard' | 'square';
  name?: string;
  rect: [number, number, number, number];
}

export const AREAS: AreaDef[] = [
  { kind: 'park', name: 'Central Park', rect: [98, 16, 184, 48] },
  { kind: 'lake', name: 'Le lac', rect: [126, 22, 154, 40] },
  { kind: 'plaza', name: 'Times Square', rect: [72, 100, 124, 140] },
  { kind: 'square', name: 'Place du Taureau', rect: [160, 198, 182, 222] },
  { kind: 'promenade', name: 'Battery Park', rect: [0, 234, 196, 240] },
  { kind: 'promenade', name: 'Hudson River Park', rect: [0, 6, 4, 234] },
  { kind: 'promenade', name: 'Quai de Brooklyn', rect: [222, 234, 284, 240] },
];

/** Voies de circulation (bande de roulement, hors trottoirs), pour les marquages et le trafic. */
export interface RoadDef {
  name: string;
  /** Rectangle de chaussée (m). */
  rect: [number, number, number, number];
  /** Axe principal : 'x' (est-ouest) ou 'z' (nord-sud). */
  axis: 'x' | 'z';
}

export const ROADS: RoadDef[] = [
  // Manhattan, avenues nord-sud
  { name: 'Riverside Drive', rect: [4, 8, 10, 232], axis: 'z' },
  { name: 'Amsterdam Avenue', rect: [46, 8, 54, 72], axis: 'z' },
  { name: '8e Avenue', rect: [46, 72, 54, 168], axis: 'z' },
  { name: 'Lafayette Street', rect: [46, 168, 54, 232], axis: 'z' },
  { name: 'Lenox Avenue', rect: [88, 8, 96, 72], axis: 'z' },
  { name: 'Broadway', rect: [88, 72, 96, 168], axis: 'z' },
  { name: 'Bowery', rect: [88, 168, 96, 232], axis: 'z' },
  { name: '5e Avenue', rect: [142, 72, 150, 168], axis: 'z' },
  { name: 'FDR Drive', rect: [186, 8, 192, 232], axis: 'z' },
  // Manhattan, rues est-ouest
  { name: '125e Rue', rect: [4, 8, 192, 14], axis: 'x' },
  { name: 'Central Park Sud', rect: [4, 72, 192, 80], axis: 'x' },
  { name: '42e Rue', rect: [4, 116, 54, 124], axis: 'x' },
  { name: 'Canal Street', rect: [4, 160, 192, 168], axis: 'x' },
  { name: 'Wall Street', rect: [96, 192, 186, 196], axis: 'x' },
  { name: 'South Street', rect: [4, 226, 192, 232], axis: 'x' },
  // ponts
  { name: 'Pont de Queensboro', rect: [192, 42, 228, 48], axis: 'x' },
  { name: 'Pont de Brooklyn', rect: [192, 192, 228, 198], axis: 'x' },
  // rive est
  { name: 'Vernon Boulevard', rect: [228, 8, 234, 112], axis: 'z' },
  { name: 'Kent Avenue', rect: [228, 128, 234, 232], axis: 'z' },
  { name: 'Steinway Street', rect: [258, 8, 262, 112], axis: 'z' },
  { name: 'Bedford Avenue', rect: [258, 128, 262, 232], axis: 'z' },
  { name: '36e Avenue', rect: [228, 8, 282, 14], axis: 'x' },
  { name: 'Queens Plaza', rect: [228, 42, 282, 48], axis: 'x' },
  { name: 'Jackson Avenue', rect: [228, 86, 282, 92], axis: 'x' },
  { name: 'Metropolitan Avenue', rect: [228, 148, 282, 154], axis: 'x' },
  { name: 'Fulton Street', rect: [228, 192, 282, 198], axis: 'x' },
  { name: 'Atlantic Avenue', rect: [228, 226, 282, 232], axis: 'x' },
  { name: 'Pont Pulaski', rect: [258, 112, 262, 128], axis: 'z' },
];

/** Immeubles de décor (non capturables, fermés) qui densifient la ville. */
export interface FillerDef {
  rect: [number, number, number, number];
  /** Hauteur (m). */
  height: number;
  /** Façade : walk-up de briques, tour de verre, art déco, entrepôt, maisons de Chinatown. */
  style: 'walkup' | 'glass' | 'deco' | 'warehouse' | 'shophouse';
  /** Face principale (vitrines, enseignes). */
  front: Side;
}

export const FILLERS: FillerDef[] = [
  { rect: [174, 82, 184, 96], height: 46, style: 'glass', front: 'N' },
  { rect: [238, 74, 256, 84], height: 16, style: 'walkup', front: 'W' },
  { rect: [238, 156, 256, 166], height: 16, style: 'walkup', front: 'W' },
];

/** Noms des rues pour la carte. */
export const STREETS: { name: string; x: number; z: number; vertical?: boolean }[] = [
  { name: 'Lenox Avenue', x: 92, z: 40, vertical: true },
  { name: 'Broadway', x: 92, z: 150, vertical: true },
  { name: 'Bowery', x: 92, z: 200, vertical: true },
  { name: '8e Avenue', x: 50, z: 150, vertical: true },
  { name: '5e Avenue', x: 146, z: 92, vertical: true },
  { name: 'FDR Drive', x: 189, z: 150, vertical: true },
  { name: '125e Rue', x: 30, z: 11 },
  { name: 'Central Park Sud', x: 150, z: 76 },
  { name: '42e Rue', x: 30, z: 120 },
  { name: 'Canal Street', x: 30, z: 164 },
  { name: 'Wall Street', x: 140, z: 194 },
  { name: 'East River', x: 209, z: 150, vertical: true },
  { name: 'Hudson', x: -6, z: 120, vertical: true },
];

/** Ponts sur l'East River. */
export const BRIDGES: { name: string; key: 'queensboro' | 'brooklyn'; rect: [number, number, number, number] }[] = [
  { name: 'Pont de Queensboro', key: 'queensboro', rect: [192, 40, 228, 50] },
  { name: 'Pont de Brooklyn', key: 'brooklyn', rect: [192, 190, 228, 200] },
];

// ---------------------------------------------------------------------------- métro

export interface SubwayStation {
  key: string;
  name: string;
  /** Quai souterrain (m). */
  rect: [number, number, number, number];
  /** Bouches de métro : départ de l'escalier dans la rue (x, z) et direction de descente. */
  entrances: { x: number; z: number; dir: Side }[];
  lines: string[];
}

export const SUBWAY_STATIONS: SubwayStation[] = [
  {
    key: 'times_square',
    name: 'Times Square – 42e Rue',
    rect: [78, 106, 118, 134],
    entrances: [
      { x: 82, z: 101.5, dir: 'S' },
      { x: 82, z: 138.5, dir: 'N' },
    ],
    lines: ['7', 'L'],
  },
  {
    key: 'queensboro_plaza',
    name: 'Queensboro Plaza',
    rect: [226, 54, 236, 82],
    entrances: [{ x: 235.5, z: 50, dir: 'S' }],
    lines: ['7'],
  },
  {
    key: 'bedford',
    name: 'Bedford Avenue',
    rect: [226, 158, 236, 186],
    entrances: [{ x: 235.5, z: 190, dir: 'N' }],
    lines: ['L'],
  },
];

/** Lignes de métro : stations desservies (dans l'ordre) et couleur. */
export const SUBWAY_LINES: { id: string; name: string; color: number; stations: string[] }[] = [
  { id: '7', name: 'Ligne 7', color: 0xb04fd8, stations: ['times_square', 'queensboro_plaza'] },
  { id: 'L', name: 'Ligne L', color: 0xa7a9ac, stations: ['times_square', 'bedford'] },
];

/** Tunnels (polylignes au niveau SUBWAY_Y, largeur 4 m). */
export const SUBWAY_TUNNELS: { line: string; pts: [number, number][] }[] = [
  {
    line: '7',
    pts: [
      [118, 110],
      [231, 110],
      [231, 82],
    ],
  },
  {
    line: 'L',
    pts: [
      [118, 130],
      [231, 130],
      [231, 158],
    ],
  },
];

// ---------------------------------------------------------------------------- eau

/** Le point (x, z) est-il sur l'eau (rivière, canal, baie) ? */
export function isWater(x: number, z: number): boolean {
  if (x >= RIVER_X0 && x < RIVER_X1) {
    for (const br of BRIDGES) if (z >= br.rect[1] && z < br.rect[3]) return false;
    return true;
  }
  if (x >= CREEK[0] && x < CREEK[2] && z >= CREEK[1] && z < CREEK[3]) {
    // le pont Pulaski enjambe le canal
    return !(x >= 252 && x < 262);
  }
  return false;
}

/** Sols interdits à la navigation : lit de la rivière et du canal (les tunnels, plus bas, restent permis). */
export function navExclude(x: number, z: number, y: number): boolean {
  return y < -0.3 && y > -5 && isWater(x, z);
}
