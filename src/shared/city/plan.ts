// Plan de la ville : quartiers et bâtiments (coordonnées en mètres).
// Axe X vers l'est, axe Z vers le sud. La ville mesure 200 m × 160 m.

export const WORLD_W = 200; // m (axe X)
export const WORLD_D = 160; // m (axe Z)
export const WORLD_H = 48; // m (hauteur stockée, de -2 m à +46 m)

export const enum Faction {
  NEUTRAL = 0,
  DADOU = 1,
  EVEN = 2,
  POLICE = 3,
  NONE = 255, // bâtiment non capturable
}

export type BossId = 'dadou' | 'even';
export const BOSS_FACTION: Record<BossId, Faction> = { dadou: Faction.DADOU, even: Faction.EVEN };

export type DistrictId = 'soho' | 'city' | 'whitechapel' | 'westminster' | 'industrial' | 'docks';

export interface DistrictDef {
  id: DistrictId;
  index: number;
  name: string; // nom affiché (français)
  short: string;
  rect: [number, number, number, number]; // x0, z0, x1, z1 (zone d'appartenance)
  label: [number, number]; // position de l'étiquette sur la carte
  gang: string; // gang neutre local
  description: string;
}

export const DISTRICTS: DistrictDef[] = [
  {
    id: 'soho',
    index: 0,
    name: 'Soho',
    short: 'Soho',
    rect: [0, 0, 68, 74],
    label: [37, 42],
    gang: 'Les Chats de Soho',
    description: 'Pubs, tripots et music-halls : le cœur festif de Londres.',
  },
  {
    id: 'city',
    index: 1,
    name: 'La City',
    short: 'City',
    rect: [68, 0, 132, 74],
    label: [100, 34],
    gang: 'Les Gants Blancs',
    description: 'Banques et bureaux : l’argent de l’Empire.',
  },
  {
    id: 'whitechapel',
    index: 2,
    name: 'Whitechapel',
    short: 'Whitechapel',
    rect: [132, 0, 200, 74],
    label: [161, 46],
    gang: 'Les Rats de Whitechapel',
    description: 'Ruelles misérables, garnis et prêteurs sur gages.',
  },
  {
    id: 'westminster',
    index: 3,
    name: 'Westminster',
    short: 'Westminster',
    rect: [0, 74, 68, 160],
    label: [34, 101],
    gang: 'Le Cercle de Pembroke',
    description: 'Hôtels particuliers, clubs et la tour de l’Horloge.',
  },
  {
    id: 'industrial',
    index: 4,
    name: 'Quartier industriel',
    short: 'Industriel',
    rect: [68, 74, 132, 160],
    label: [101, 104],
    gang: 'Les Cogneurs de la Fonderie',
    description: 'Fonderies, brasseries et cheminées fumantes.',
  },
  {
    id: 'docks',
    index: 5,
    name: 'Les Docks',
    short: 'Docks',
    rect: [132, 74, 200, 160],
    label: [163, 128],
    gang: 'Le Gang du Quai',
    description: 'Entrepôts, contrebande et navires sur la Tamise.',
  },
];

export const DISTRICT_BY_ID: Record<DistrictId, DistrictDef> = Object.fromEntries(
  DISTRICTS.map((d) => [d.id, d]),
) as Record<DistrictId, DistrictDef>;

export function districtAt(x: number, z: number): DistrictDef {
  for (const d of DISTRICTS) {
    if (x >= d.rect[0] && x < d.rect[2] && z >= d.rect[1] && z < d.rect[3]) return d;
  }
  return x < 100 ? DISTRICTS[3] : DISTRICTS[5];
}

export type BuildingType =
  | 'pub'
  | 'hq'
  | 'shop'
  | 'gambling'
  | 'theatre'
  | 'cafe'
  | 'bank'
  | 'exchange'
  | 'offices'
  | 'jeweller'
  | 'post'
  | 'church'
  | 'lodging'
  | 'pawn'
  | 'butcher'
  | 'sweatshop'
  | 'tenement'
  | 'police'
  | 'mansion'
  | 'club'
  | 'clocktower'
  | 'foundry'
  | 'brewery'
  | 'mill'
  | 'housing'
  | 'gasworks'
  | 'warehouse'
  | 'customs'
  | 'shipyard'
  | 'bakery';

export type Side = 'N' | 'S' | 'E' | 'W';

export interface BuildingDef {
  id: number;
  key: string;
  name: string;
  type: BuildingType;
  district: DistrictId;
  rect: [number, number, number, number]; // x0, z0, x1, z1 en mètres (multiples de 0,5)
  door: Side;
  stories: number;
  isKey?: boolean;
  hq?: BossId;
  startOwner: Faction;
  /** Nombre de voyous neutres qui défendent le bâtiment au début (0 = à vendre). */
  guards: number;
  price: number; // prix d'achat si neutre et sans défenseurs
  income: number; // £/min
  capturable: boolean;
  /** Description courte pour la carte stratégique. */
  blurb: string;
  /** Variante de style (couleurs de façade…). */
  style?: number;
}

let nextId = 0;
function b(def: Omit<BuildingDef, 'id'>): BuildingDef {
  return { id: nextId++, ...def };
}

export const BUILDINGS: BuildingDef[] = [
  // ------------------------------------------------------------------ SOHO
  b({
    key: 'lion_rouge',
    name: 'Le Lion Rouge',
    type: 'hq',
    district: 'soho',
    rect: [10, 11, 28, 25],
    door: 'S',
    stories: 3,
    isKey: true,
    hq: 'dadou',
    startOwner: Faction.DADOU,
    guards: 0,
    price: 0,
    income: 25,
    capturable: true,
    blurb: 'Quartier général de la Mafia de Dadou.',
  }),
  b({
    key: 'chapellerie',
    name: 'Chapellerie Lock & Fils',
    type: 'shop',
    district: 'soho',
    rect: [28, 11, 37, 23],
    door: 'S',
    stories: 3,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 250,
    income: 15,
    capturable: true,
    blurb: 'Chapeaux melon et hauts-de-forme. À vendre.',
    style: 1,
  }),
  b({
    key: 'alhambra',
    name: 'Music-hall Alhambra',
    type: 'theatre',
    district: 'soho',
    rect: [40, 11, 64, 26],
    door: 'S',
    stories: 3,
    startOwner: Faction.NEUTRAL,
    guards: 5,
    price: 0,
    income: 35,
    capturable: true,
    blurb: 'Spectacles, chansons et recettes juteuses.',
  }),
  b({
    key: 'chat_noir',
    name: 'Le Chat Noir',
    type: 'pub',
    district: 'soho',
    rect: [10, 30, 20, 44],
    door: 'E',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 3,
    price: 0,
    income: 20,
    capturable: true,
    blurb: 'Pub tenu par les Chats de Soho.',
    style: 2,
  }),
  b({
    key: 'boulangerie',
    name: 'Boulangerie Dubois',
    type: 'bakery',
    district: 'soho',
    rect: [10, 47, 20, 57],
    door: 'E',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 200,
    income: 12,
    capturable: true,
    blurb: 'Pain chaud et petits arrangements. À vendre.',
    style: 3,
  }),
  b({
    key: 'valet_pique',
    name: 'Le Valet de Pique',
    type: 'gambling',
    district: 'soho',
    rect: [54, 30, 64, 48],
    door: 'W',
    stories: 3,
    isKey: true,
    startOwner: Faction.DADOU,
    guards: 0,
    price: 0,
    income: 35,
    capturable: true,
    blurb: 'Maison de jeu clandestine. Bâtiment clé de Soho.',
  }),
  b({
    key: 'cafe_royal',
    name: 'Café Royal',
    type: 'cafe',
    district: 'soho',
    rect: [26, 56, 42, 68],
    door: 'N',
    stories: 3,
    startOwner: Faction.NEUTRAL,
    guards: 3,
    price: 0,
    income: 25,
    capturable: true,
    blurb: 'Café élégant fréquenté par les artistes.',
  }),

  // ------------------------------------------------------------------ LA CITY
  b({
    key: 'banque',
    name: 'Banque Royale de Londres',
    type: 'bank',
    district: 'city',
    rect: [74, 11, 98, 28],
    door: 'S',
    stories: 3,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 6,
    price: 0,
    income: 60,
    capturable: true,
    blurb: 'Coffres pleins et gardes armés. Bâtiment clé de la City.',
  }),
  b({
    key: 'bourse',
    name: 'La Bourse',
    type: 'exchange',
    district: 'city',
    rect: [104, 11, 128, 28],
    door: 'S',
    stories: 3,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 5,
    price: 0,
    income: 55,
    capturable: true,
    blurb: 'Le temple de la spéculation. Bâtiment clé de la City.',
  }),
  b({
    key: 'lloyds',
    name: 'Café Lloyd’s',
    type: 'cafe',
    district: 'city',
    rect: [74, 42, 88, 54],
    door: 'N',
    stories: 3,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 300,
    income: 22,
    capturable: true,
    blurb: 'Café des assureurs maritimes. À vendre.',
    style: 1,
  }),
  b({
    key: 'compagnie_indes',
    name: 'Compagnie des Indes',
    type: 'offices',
    district: 'city',
    rect: [91, 42, 111, 58],
    door: 'N',
    stories: 4,
    startOwner: Faction.NEUTRAL,
    guards: 4,
    price: 0,
    income: 40,
    capturable: true,
    blurb: 'Bureaux de commerce colonial.',
  }),
  b({
    key: 'garrard',
    name: 'Bijouterie Garrard',
    type: 'jeweller',
    district: 'city',
    rect: [114, 42, 128, 54],
    door: 'N',
    stories: 3,
    startOwner: Faction.NEUTRAL,
    guards: 3,
    price: 0,
    income: 35,
    capturable: true,
    blurb: 'Diamants, montres et vitrines blindées.',
  }),
  b({
    key: 'postes',
    name: 'Hôtel des Postes',
    type: 'post',
    district: 'city',
    rect: [80, 60, 104, 70],
    door: 'S',
    stories: 3,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 400,
    income: 28,
    capturable: true,
    blurb: 'Le courrier de tout Londres. À vendre.',
  }),

  // ------------------------------------------------------------------ WHITECHAPEL
  b({
    key: 'dix_cloches',
    name: 'Les Dix Cloches',
    type: 'pub',
    district: 'whitechapel',
    rect: [138, 11, 150, 23],
    door: 'S',
    stories: 3,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 4,
    price: 0,
    income: 22,
    capturable: true,
    blurb: 'Pub légendaire de Whitechapel. Bâtiment clé.',
  }),
  b({
    key: 'preteur',
    name: 'Prêteur sur gages Cohen',
    type: 'pawn',
    district: 'whitechapel',
    rect: [150, 11, 160, 23],
    door: 'S',
    stories: 3,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 3,
    price: 0,
    income: 25,
    capturable: true,
    blurb: 'Tout s’y vend, même le butin. Bâtiment clé.',
  }),
  b({
    key: 'christ_church',
    name: 'Christ Church',
    type: 'church',
    district: 'whitechapel',
    rect: [168, 11, 190, 37],
    door: 'W',
    stories: 2,
    startOwner: Faction.NONE,
    guards: 0,
    price: 0,
    income: 0,
    capturable: false,
    blurb: 'Église paroissiale. Lieu neutre.',
  }),
  b({
    key: 'garni',
    name: 'Garni de Flower Street',
    type: 'lodging',
    district: 'whitechapel',
    rect: [138, 30, 154, 44],
    door: 'E',
    stories: 3,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 180,
    income: 12,
    capturable: true,
    blurb: 'Lits à quatre pence la nuit. À vendre.',
  }),
  b({
    key: 'boucherie',
    name: 'Boucherie Isaacs',
    type: 'butcher',
    district: 'whitechapel',
    rect: [138, 50, 150, 62],
    door: 'E',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 2,
    price: 0,
    income: 15,
    capturable: true,
    blurb: 'Viande fraîche et couteaux bien aiguisés.',
  }),
  b({
    key: 'atelier',
    name: 'Atelier de confection',
    type: 'sweatshop',
    district: 'whitechapel',
    rect: [168, 44, 190, 56],
    door: 'W',
    stories: 3,
    startOwner: Faction.NEUTRAL,
    guards: 3,
    price: 0,
    income: 20,
    capturable: true,
    blurb: 'Machines à coudre et marchandises « tombées du camion ».',
  }),
  b({
    key: 'dorset',
    name: 'Taudis de Dorset Street',
    type: 'tenement',
    district: 'whitechapel',
    rect: [168, 58, 190, 70],
    door: 'W',
    stories: 3,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 150,
    income: 10,
    capturable: true,
    blurb: 'Logements insalubres. À vendre.',
  }),

  // ------------------------------------------------------------------ WESTMINSTER
  b({
    key: 'scotland_yard',
    name: 'Scotland Yard',
    type: 'police',
    district: 'westminster',
    rect: [10, 80, 28, 96],
    door: 'E',
    stories: 3,
    startOwner: Faction.NONE,
    guards: 0,
    price: 0,
    income: 0,
    capturable: false,
    blurb: 'Commissariat central de la Police métropolitaine.',
  }),
  b({
    key: 'pembroke',
    name: 'Manoir Pembroke',
    type: 'mansion',
    district: 'westminster',
    rect: [36, 80, 60, 96],
    door: 'S',
    stories: 3,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 5,
    price: 0,
    income: 45,
    capturable: true,
    blurb: 'Demeure de lord Pembroke. Bâtiment clé de Westminster.',
  }),
  b({
    key: 'reform',
    name: 'Club Reform',
    type: 'club',
    district: 'westminster',
    rect: [10, 104, 30, 120],
    door: 'E',
    stories: 3,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 4,
    price: 0,
    income: 45,
    capturable: true,
    blurb: 'Club de gentlemen très fermé. Bâtiment clé.',
  }),
  b({
    key: 'ashford',
    name: 'Hôtel particulier Ashford',
    type: 'mansion',
    district: 'westminster',
    rect: [38, 104, 54, 118],
    door: 'W',
    stories: 3,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 450,
    income: 32,
    capturable: true,
    blurb: 'Belle demeure à vendre au plus offrant.',
    style: 1,
  }),
  b({
    key: 'horloge',
    name: 'Tour de l’Horloge',
    type: 'clocktower',
    district: 'westminster',
    rect: [54, 120, 62, 128],
    door: 'N',
    stories: 9,
    startOwner: Faction.NONE,
    guards: 0,
    price: 0,
    income: 0,
    capturable: false,
    blurb: 'Le célèbre beffroi de Westminster.',
  }),

  // ------------------------------------------------------------------ QUARTIER INDUSTRIEL
  b({
    key: 'fonderie',
    name: 'Fonderie Hawthorne',
    type: 'foundry',
    district: 'industrial',
    rect: [74, 80, 100, 100],
    door: 'E',
    stories: 2,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 5,
    price: 0,
    income: 45,
    capturable: true,
    blurb: 'Hauts fourneaux et canons. Bâtiment clé.',
  }),
  b({
    key: 'brasserie',
    name: 'Brasserie Royale',
    type: 'brewery',
    district: 'industrial',
    rect: [104, 80, 128, 98],
    door: 'W',
    stories: 3,
    isKey: true,
    startOwner: Faction.NEUTRAL,
    guards: 4,
    price: 0,
    income: 42,
    capturable: true,
    blurb: 'La bière de tout l’East End. Bâtiment clé.',
  }),
  b({
    key: 'filature',
    name: 'Filature Lancaster',
    type: 'mill',
    district: 'industrial',
    rect: [74, 108, 98, 130],
    door: 'N',
    stories: 3,
    startOwner: Faction.NEUTRAL,
    guards: 3,
    price: 0,
    income: 32,
    capturable: true,
    blurb: 'Métiers à tisser et ouvriers épuisés.',
  }),
  b({
    key: 'logements',
    name: 'Logements ouvriers',
    type: 'housing',
    district: 'industrial',
    rect: [104, 106, 128, 118],
    door: 'N',
    stories: 3,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 160,
    income: 10,
    capturable: true,
    blurb: 'Rangées de logements ouvriers. À vendre.',
  }),
  b({
    key: 'usine_gaz',
    name: 'Usine à gaz',
    type: 'gasworks',
    district: 'industrial',
    rect: [104, 122, 116, 130],
    door: 'N',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 2,
    price: 0,
    income: 25,
    capturable: true,
    blurb: 'Le gaz qui éclaire les rues de Londres.',
  }),

  // ------------------------------------------------------------------ DOCKS
  b({
    key: 'ancre_bleue',
    name: 'L’Ancre Bleue',
    type: 'hq',
    district: 'docks',
    rect: [172, 80, 190, 94],
    door: 'W',
    stories: 3,
    isKey: true,
    hq: 'even',
    startOwner: Faction.EVEN,
    guards: 0,
    price: 0,
    income: 25,
    capturable: true,
    blurb: 'Quartier général de la Mafia d’Even.',
    style: 1,
  }),
  b({
    key: 'entrepot_indes',
    name: 'Entrepôt des Indes',
    type: 'warehouse',
    district: 'docks',
    rect: [138, 80, 162, 98],
    door: 'E',
    stories: 2,
    isKey: true,
    startOwner: Faction.EVEN,
    guards: 0,
    price: 0,
    income: 35,
    capturable: true,
    blurb: 'Thé, épices et contrebande. Bâtiment clé des Docks.',
  }),
  b({
    key: 'entrepot_morgan',
    name: 'Entrepôt Morgan',
    type: 'warehouse',
    district: 'docks',
    rect: [166, 102, 190, 120],
    door: 'W',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 3,
    price: 0,
    income: 30,
    capturable: true,
    blurb: 'Occupé par le Gang du Quai.',
    style: 1,
  }),
  b({
    key: 'douanes',
    name: 'Douanes de Sa Majesté',
    type: 'customs',
    district: 'docks',
    rect: [138, 104, 160, 120],
    door: 'E',
    stories: 3,
    startOwner: Faction.NEUTRAL,
    guards: 4,
    price: 0,
    income: 38,
    capturable: true,
    blurb: 'Les taxes de la Couronne… et leurs saisies.',
  }),
  b({
    key: 'chantier',
    name: 'Chantier naval Thornycroft',
    type: 'shipyard',
    district: 'docks',
    rect: [140, 124, 160, 132],
    door: 'N',
    stories: 2,
    startOwner: Faction.NEUTRAL,
    guards: 0,
    price: 220,
    income: 20,
    capturable: true,
    blurb: 'Atelier de charpenterie marine. À vendre.',
  }),
];

export const BUILDING_BY_KEY: Record<string, BuildingDef> = Object.fromEntries(BUILDINGS.map((bd) => [bd.key, bd]));

export function buildingsInDistrict(d: DistrictId): BuildingDef[] {
  return BUILDINGS.filter((bd) => bd.district === d);
}

export function keyBuildings(d: DistrictId): BuildingDef[] {
  return BUILDINGS.filter((bd) => bd.district === d && bd.isKey);
}

export const HQ_BUILDING: Record<BossId, BuildingDef> = {
  dadou: BUILDING_BY_KEY['lion_rouge'],
  even: BUILDING_BY_KEY['ancre_bleue'],
};

/** Missions d'introduction : un établissement voisin tenu par un gang rival. */
export const FIRST_MISSION_TARGET: Record<BossId, string> = {
  dadou: 'chat_noir',
  even: 'entrepot_morgan',
};

/** Zones spéciales (jardins, places, marchés…) pour la génération et la carte. */
export interface AreaDef {
  kind: 'garden' | 'plaza' | 'market' | 'park' | 'yard';
  name?: string;
  rect: [number, number, number, number];
}

export const AREAS: AreaDef[] = [
  { kind: 'garden', name: 'Soho Square', rect: [24, 30, 50, 52] },
  { kind: 'market', name: 'Marché de Berwick Street', rect: [45, 55, 63, 68] },
  { kind: 'plaza', name: 'Place de la Bourse', rect: [76, 31, 126, 39] },
  { kind: 'market', name: 'Petticoat Lane', rect: [157, 28, 165, 68] },
  { kind: 'park', name: 'Jardins de l’Embankment', rect: [10, 122, 52, 132] },
  { kind: 'garden', name: 'Jardin Pembroke', rect: [38, 97, 58, 101] },
  { kind: 'yard', name: 'Cour de la fonderie', rect: [100, 100, 104, 106] },
];

/** Rues principales nommées (affichage carte). */
export const STREETS: { name: string; x: number; z: number; vertical?: boolean }[] = [
  { name: 'Oxford Street', x: 100, z: 74, vertical: false },
  { name: 'Charing Cross Road', x: 68, z: 40, vertical: true },
  { name: 'Commercial Road', x: 132, z: 40, vertical: true },
  { name: 'Victoria Embankment', x: 66, z: 136, vertical: false },
  { name: 'Mile End Road', x: 100, z: 8, vertical: false },
  { name: 'Tamise', x: 100, z: 151, vertical: false },
];

/** Jetées des docks (bois) qui s'avancent sur la Tamise. */
export const PIERS: [number, number, number, number][] = [
  [146, 140, 152, 156],
  [180, 140, 186, 156],
];

export const RIVER_Z = 140; // bord du quai
