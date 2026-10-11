// Plan de New York 2085 : quartiers, bâtiments, rues, rivières, ponts et métro (en mètres).
// Axe X vers l'est, axe Z vers le sud. La ville jouable mesure 576 m × 480 m.
//
// Manhattan occupe l'ouest (x 0 → 390, l'Hudson au-delà de x = 0), l'East River coule de x 390
// à 430, et la rive est porte le Queens au nord (Astoria, Long Island City) et Brooklyn au sud
// (Williamsburg, Bushwick), séparés par Newtown Creek.
//
// Équilibre : la carte est symétrique par rapport à l'axe z = 240. Chaque quartier du nord a son
// jumeau au sud, avec des bâtiments aux mêmes règles, placés en miroir :
//   Harlem ↔ Chinatown, Upper West Side ↔ Greenwich Village, Central Park ↔ Wall Street,
//   Upper East Side ↔ Lower East Side, Astoria (Even) ↔ Bushwick (Dadou),
//   Long Island City ↔ Williamsburg. Times Square (Midtown), le joyau, est au centre.
//
//            x: 0 ──────── 136 ────────── 254 ──────── 390 ─ 430 ────────── 576
//   z=0    │ HARLEM                                    │ East │ ASTORIA (Even)  │
//   z=84   ├────────────┬──────────────┬───────────────┤ River├─────────────────┤ z=116
//          │ UPPER WEST │ CENTRAL PARK │ UPPER EAST    │      │ LONG ISLAND CITY│
//   z=190  ├────────────┴──────────────┴───────────────┤      │                 │
//          │        MIDTOWN — TIMES SQUARE (centre)    │      ├── Newtown Creek ┤ z=240
//   z=290  ├────────────┬──────────────┬───────────────┤      │ WILLIAMSBURG    │
//          │ GREENWICH  │ WALL STREET  │ LOWER EAST    │      ├─────────────────┤ z=364
//   z=396  ├────────────┴──────────────┴───────────────┤      │ BUSHWICK (Dadou)│
//   z=480  │ CHINATOWN … Battery Park                  │      │                 │

export const WORLD_W = 576; // m (axe X)
export const WORLD_D = 480; // m (axe Z)
export const WORLD_H = 72; // m (hauteur stockée, de −8,5 m à +63,5 m)
/** Plus haut sol intérieur autorisé (m) : au-dessus, seules les façades (éclairage précalculé). */
export const INTERIOR_MAX_Y = 44;
/** Axe de symétrie nord-sud (m). */
export const MID_Z = WORLD_D / 2;

export const enum Faction {
  NEUTRAL = 0,
  DADOU = 1,
  EVEN = 2,
  POLICE = 3,
  NONE = 255, // bâtiment non capturable
}

export type BossId = 'dadou' | 'even';
export const BOSS_FACTION: Record<BossId, Faction> = { dadou: Faction.DADOU, even: Faction.EVEN };

export type Rect = [number, number, number, number];

export type DistrictId =
  | 'harlem'
  | 'uws'
  | 'centralpark'
  | 'ues'
  | 'midtown'
  | 'village'
  | 'wallstreet'
  | 'les'
  | 'chinatown'
  | 'astoria'
  | 'lic'
  | 'williamsburg'
  | 'bushwick';

export interface DistrictDef {
  id: DistrictId;
  index: number;
  name: string; // nom affiché (français)
  short: string;
  rect: Rect; // x0, z0, x1, z1 (zone d'appartenance)
  label: [number, number]; // position de l'étiquette sur la carte
  gang: string; // gang neutre local
  /** Allure des voyous du gang local (0 à 6, voir characters/styles.ts). */
  look: number;
  description: string;
  /** Teinte d'ambiance des néons du quartier (sRGB). */
  neon: number;
}

// ---------------------------------------------------------------------------- géographie

/** East River (x) et rives. */
export const RIVER_X0 = 390;
export const RIVER_X1 = 430;
/** Limite est de la ville : au-delà, la voie rapide surélevée (BQE). */
export const EAST_LIMIT = 568;
/** Newtown Creek : canal entre le Queens et Brooklyn. */
export const CREEK: Rect = [RIVER_X1, 232, WORLD_W, 248];
/** Le canal se prolonge vers l'est au-delà de la ville (décor), jusqu'à cette abscisse (m). */
export const CREEK_FAR = WORLD_W + 160;
/** Niveau de l'eau et du lit (m). */
export const WATER_Y = -1.5;
export const RIVERBED_Y = -3.5;
/** Profondeur des quais du métro et des tunnels (sol, m). */
export const SUBWAY_Y = -7.5;

/** Rectangle symétrique (nord ↔ sud). */
export const mirrorRect = (r: Rect): Rect => [r[0], WORLD_D - r[3], r[2], WORLD_D - r[1]];

export const DISTRICTS: DistrictDef[] = [
  {
    id: 'harlem',
    index: 0,
    name: 'Harlem',
    short: 'Harlem',
    rect: [0, 0, 390, 84],
    label: [240, 66],
    gang: 'Les Lions de Lenox',
    look: 0,
    description: 'Brownstones, clubs de jazz, salles de boxe et marché de La Marqueta : l’âme rebelle d’Uptown.',
    neon: 0xffb020,
  },
  {
    id: 'uws',
    index: 1,
    name: 'Upper West Side',
    short: 'Upper West',
    rect: [0, 84, 136, 190],
    label: [68, 137],
    gang: 'Le Cercle du Dakota',
    look: 1,
    description: 'Musées, opéra et immeubles cossus entre Riverside Park et Central Park.',
    neon: 0x8fd0ff,
  },
  {
    id: 'centralpark',
    index: 2,
    name: 'Central Park',
    short: 'Central Park',
    rect: [136, 84, 254, 190],
    label: [189, 108],
    gang: 'La Garde Sterling',
    look: 1,
    description: 'Le grand parc, son lac et son réservoir, et les tours de milliardaires de Central Park Sud.',
    neon: 0x7dffb0,
  },
  {
    id: 'ues',
    index: 3,
    name: 'Upper East Side',
    short: 'Upper East',
    rect: [254, 84, 390, 190],
    label: [322, 137],
    gang: 'Les Héritiers de Park Avenue',
    look: 4,
    description: 'Musées, palaces et hôtels des ventes : le vieil argent de New York.',
    neon: 0xc8a8ff,
  },
  {
    id: 'midtown',
    index: 4,
    name: 'Times Square',
    short: 'Times Sq.',
    rect: [0, 190, 390, 290],
    label: [240, 240],
    gang: 'Les Néons de Broadway',
    look: 2,
    description: 'Midtown et Times Square : écrans géants, casino, Grand Central et l’Empire State. Le joyau de New York.',
    neon: 0xff3cc8,
  },
  {
    id: 'village',
    index: 5,
    name: 'Greenwich Village',
    short: 'Village',
    rect: [0, 290, 136, 396],
    label: [68, 343],
    gang: 'Les Fantômes de Bleecker',
    look: 2,
    description: 'Caves de jazz, galeries de SoHo et marché de Chelsea : la bohème de Downtown.',
    neon: 0xffd060,
  },
  {
    id: 'wallstreet',
    index: 6,
    name: 'Wall Street',
    short: 'Wall Street',
    rect: [136, 290, 254, 396],
    label: [195, 356],
    gang: 'La Sécurité Axiom',
    look: 4,
    description: 'Le quartier financier : la Bourse, la Banque Fédérale et les tours des corporations.',
    neon: 0x40c8ff,
  },
  {
    id: 'les',
    index: 7,
    name: 'Lower East Side',
    short: 'Lower East',
    rect: [254, 290, 390, 396],
    label: [322, 343],
    gang: 'Les Rats de Delancey',
    look: 0,
    description: 'Banques d’épargne, traiteurs et salles de concert : le Lower East Side ne dort jamais.',
    neon: 0xff7a3c,
  },
  {
    id: 'chinatown',
    index: 8,
    name: 'Chinatown',
    short: 'Chinatown',
    rect: [0, 396, 390, 480],
    label: [240, 414],
    gang: 'La Triade du Jade',
    look: 3,
    description: 'Ruelles serrées, maisons de thé et marché noir de la technologie, de Canal Street à Battery Park.',
    neon: 0xff4040,
  },
  {
    id: 'astoria',
    index: 9,
    name: 'Astoria',
    short: 'Astoria',
    rect: [RIVER_X1, 0, WORLD_W, 116],
    label: [503, 100],
    gang: 'Les Rouleurs de Ditmars',
    look: 5,
    description: 'Marchés de nuit, studios de cinéma et tavernes grecques, dans le Queens. Le fief d’Even.',
    neon: 0x40a0ff,
  },
  {
    id: 'lic',
    index: 10,
    name: 'Long Island City',
    short: 'Long Island',
    rect: [RIVER_X1, 116, WORLD_W, 240],
    label: [503, 153],
    gang: 'Le Syndicat de Queens Plaza',
    look: 5,
    description: 'Tours de verre, dépôts logistiques et usines de drones au pied du pont de Queensboro.',
    neon: 0x3ce8ff,
  },
  {
    id: 'williamsburg',
    index: 11,
    name: 'Williamsburg',
    short: 'Williamsburg',
    rect: [RIVER_X1, 240, WORLD_W, 364],
    label: [503, 327],
    gang: 'Les Vautours du Navy Yard',
    look: 6,
    description: 'Brasseries, raffinerie et entrepôts du Navy Yard au pied du pont de Williamsburg, à Brooklyn.',
    neon: 0xff6a8a,
  },
  {
    id: 'bushwick',
    index: 12,
    name: 'Bushwick',
    short: 'Bushwick',
    rect: [RIVER_X1, 364, WORLD_W, WORLD_D],
    label: [503, 380],
    gang: 'Les Corbeaux de Bushwick',
    look: 6,
    description: 'Rues rugueuses, murs peints, clubs et casses automobiles, à Brooklyn. Le fief de Dadou.',
    neon: 0xff3050,
  },
];

export const DISTRICT_BY_ID: Record<DistrictId, DistrictDef> = Object.fromEntries(
  DISTRICTS.map((d) => [d.id, d]),
) as Record<DistrictId, DistrictDef>;

/** Quartier d'un point (sur l'eau ou hors de la ville : le plus proche). */
export function districtAt(x: number, z: number): DistrictDef {
  for (const d of DISTRICTS) {
    if (x >= d.rect[0] && x < d.rect[2] && z >= d.rect[1] && z < d.rect[3]) return d;
  }
  let best = DISTRICTS[0];
  let bd = Infinity;
  for (const d of DISTRICTS) {
    const dx = Math.max(d.rect[0] - x, 0, x - d.rect[2]);
    const dz = Math.max(d.rect[1] - z, 0, z - d.rect[3]);
    const dd = dx * dx + dz * dz;
    if (dd < bd) {
      bd = dd;
      best = d;
    }
  }
  return best;
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

/** Façade symétrique (nord ↔ sud). */
export const mirrorSide = (s: Side): Side => (s === 'N' ? 'S' : s === 'S' ? 'N' : s);

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
  rect: Rect; // x0, z0, x1, z1 en mètres (multiples de 0,5)
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

type Def = Omit<BuildingDef, 'id'>;
const DEFS: Def[] = [];

/** Bâtiment capturable tenu par un gang local (ou à vendre si guards = 0). */
function bld(d: Omit<Def, 'startOwner' | 'capturable'>): Def {
  return { ...d, startOwner: Faction.NEUTRAL, capturable: true };
}

/** Bâtiment non capturable (commissariat, monument). */
function fixed(d: Omit<Def, 'startOwner' | 'capturable' | 'guards' | 'price' | 'income'>): Def {
  return { ...d, startOwner: Faction.NONE, capturable: false, guards: 0, price: 0, income: 0 };
}

/** Logement de l'échelle d'un parrain (réservé, non capturable avant l'achat). */
function residence(boss: BossId, tier: ResidenceInfo['tier'], d: Omit<Def, 'residence' | 'startOwner' | 'guards' | 'capturable' | 'isKey'>): Def {
  return {
    ...d,
    residence: { boss, tier },
    startOwner: tier === 1 ? (boss === 'dadou' ? Faction.DADOU : Faction.EVEN) : Faction.NEUTRAL,
    guards: 0,
    capturable: true,
  };
}

/** Ce qui change chez le jumeau du sud : identité, apparence ; les règles restent les mêmes. */
interface TwinSpec {
  key: string;
  name: string;
  type: BuildingType;
  district: DistrictId;
  blurb: string;
  style?: number;
  stories?: number;
  height?: number;
  heistLabel?: string;
}

/** Un bâtiment du nord et son jumeau du sud, en miroir (mêmes revenus, gardes, prix, sécurité). */
function twin(n: Def, s: TwinSpec): void {
  DEFS.push(n);
  const south: Def = {
    ...n,
    key: s.key,
    name: s.name,
    type: s.type,
    district: s.district,
    blurb: s.blurb,
    rect: mirrorRect(n.rect),
    door: mirrorSide(n.door),
  };
  if (s.style !== undefined) south.style = s.style;
  else delete south.style;
  if (s.stories !== undefined) south.stories = s.stories;
  if (s.height !== undefined) south.height = s.height;
  if (n.heist) south.heist = { ...n.heist, label: s.heistLabel ?? n.heist.label };
  if (n.residence) {
    const boss: BossId = n.residence.boss === 'even' ? 'dadou' : 'even';
    south.residence = { boss, tier: n.residence.tier };
    south.startOwner = n.residence.tier === 1 ? BOSS_FACTION[boss] : Faction.NEUTRAL;
  }
  DEFS.push(south);
}

// ===================================================================== HARLEM ↔ CHINATOWN
twin(
  bld({
    key: 'neo_apollo',
    name: 'Théâtre Néo-Apollo',
    type: 'theatre',
    district: 'harlem',
    rect: [146, 16, 176, 42],
    door: 'S',
    stories: 2,
    isKey: true,
    guards: 4,
    price: 0,
    income: 60,
    blurb: 'La scène mythique de la 125e Rue, en version holographique. Bâtiment clé.',
  }),
  { key: 'maison_the', name: 'Maison de thé du Dragon de Jade', type: 'teahouse', district: 'chinatown', blurb: 'Le quartier général de la Triade, entre dim sum et règlements de comptes. Bâtiment clé.' },
);
twin(
  bld({
    key: 'savoy',
    name: 'Club de jazz Le Savoy',
    type: 'jazz',
    district: 'harlem',
    rect: [146, 56, 172, 78],
    door: 'S',
    stories: 2,
    isKey: true,
    guards: 4,
    price: 0,
    income: 55,
    blurb: 'Saxophones, whisky et rendez-vous discrets sur Lenox Avenue. Bâtiment clé.',
  }),
  { key: 'marche_tech', name: 'Marché tech de Canal Street', type: 'techmarket', district: 'chinatown', blurb: 'Puces, implants et logiciels pirates. Bâtiment clé de Chinatown.' },
);
twin(
  bld({
    key: 'marqueta',
    name: 'Marché de nuit de La Marqueta',
    type: 'nightmarket',
    district: 'harlem',
    rect: [303, 54, 333, 78],
    door: 'W',
    stories: 2,
    isKey: true,
    guards: 3,
    price: 0,
    income: 50,
    blurb: 'Sous le viaduc de Park Avenue : étals fumants, épices et puces volées. Bâtiment clé.',
  }),
  { key: 'mahjong', name: 'Salle de mah-jong du Lotus', type: 'mahjong', district: 'chinatown', blurb: 'Tuiles qui claquent, dettes de jeu et paris de la Triade. Bâtiment clé.' },
);
twin(
  bld({
    key: 'boxe_harlem',
    name: 'Salle de boxe de Harlem',
    type: 'gym',
    district: 'harlem',
    rect: [60, 16, 80, 42],
    door: 'S',
    stories: 2,
    guards: 3,
    price: 0,
    income: 30,
    blurb: 'Ring, sacs de frappe et paris clandestins.',
  }),
  { key: 'tigre_or', name: 'Club du Tigre d’or', type: 'club', district: 'chinatown', blurb: 'Karaoké, néons rouges et salons privés.', style: 0 },
);
twin(
  bld({
    key: 'studio_sugarhill',
    name: 'Studio Sugar Hill',
    type: 'studio',
    district: 'harlem',
    rect: [102, 14, 130, 30],
    door: 'N',
    stories: 2,
    guards: 2,
    price: 0,
    income: 28,
    blurb: 'Un studio d’enregistrement où se pressent les rappeurs de 2085.',
  }),
  { key: 'tatouage_dragon', name: 'Atelier de tatouage du Dragon', type: 'tattoo', district: 'chinatown', blurb: 'Dragons lumineux sous la peau et implants discrets.' },
);
twin(
  bld({
    key: 'bodega_125',
    name: 'Bodega de la 125e Rue',
    type: 'bodega',
    district: 'harlem',
    rect: [102, 32, 116, 42],
    door: 'S',
    stories: 2,
    guards: 0,
    price: 300,
    income: 18,
    blurb: 'Café, sandwichs et billets de loterie. À vendre.',
  }),
  { key: 'herboristerie', name: 'Herboristerie Wing Fat', type: 'herbalist', district: 'chinatown', blurb: 'Racines, thés et remèdes « spéciaux ». À vendre.' },
);
twin(
  fixed({
    key: 'police_28',
    name: 'Commissariat du 28e district',
    type: 'police',
    district: 'harlem',
    rect: [60, 56, 76, 70],
    door: 'N',
    stories: 2,
    blurb: 'La police de New York (NYPD) pour tout Harlem.',
  }),
  { key: 'police_5', name: 'Commissariat du 5e district', type: 'police', district: 'chinatown', blurb: 'La police de New York (NYPD) pour Chinatown et la pointe de Manhattan.' },
);
twin(
  residence('even', 3, {
    key: 'loft_lenox',
    name: 'Loft de Lenox Avenue',
    type: 'loft',
    district: 'harlem',
    rect: [201, 56, 227, 78],
    door: 'S',
    stories: 2,
    price: 4000,
    income: 45,
    blurb: 'Un loft d’artiste sous verrière, briques et néons bleus, au coin de Lenox Avenue.',
    style: 1,
  }),
  { key: 'loft_canal', name: 'Loft de Canal Street', type: 'loft', district: 'chinatown', blurb: 'Un loft industriel au-dessus des enseignes de Canal Street.' },
);

// ===================================================================== UPPER WEST SIDE ↔ GREENWICH VILLAGE
twin(
  bld({
    key: 'museum',
    name: 'Muséum d’histoire naturelle',
    type: 'gallery',
    district: 'uws',
    rect: [102, 92, 130, 132],
    door: 'E',
    stories: 2,
    isKey: true,
    guards: 4,
    price: 0,
    income: 65,
    security: 2,
    heist: { reward: 1800, time: 35, label: 'Dérober les diamants de la salle des minéraux' },
    blurb: 'Dinosaures, météorites et la plus belle collection de gemmes de la ville. Bâtiment clé.',
    style: 1,
  }),
  {
    key: 'galerie_soho',
    name: 'Galerie Prince Street',
    type: 'gallery',
    district: 'village',
    blurb: 'Les galeries de SoHo et leurs toiles hors de prix, sous haute surveillance. Bâtiment clé.',
    heistLabel: 'Voler les toiles holographiques',
  },
);
twin(
  bld({
    key: 'lincoln_center',
    name: 'Opéra du Lincoln Center',
    type: 'theatre',
    district: 'uws',
    rect: [60, 154, 90, 184],
    door: 'E',
    stories: 2,
    isKey: true,
    guards: 4,
    price: 0,
    income: 60,
    blurb: 'Le temple de l’opéra et du ballet, illuminé de mille hologrammes. Bâtiment clé.',
    style: 1,
  }),
  { key: 'vanguard', name: 'Club de jazz du Village Vanguard', type: 'jazz', district: 'village', blurb: 'La cave de jazz la plus célèbre du monde, et ses arrière-salles. Bâtiment clé.' },
);
twin(
  bld({
    key: 'dakota',
    name: 'Le Dakota',
    type: 'hotel',
    district: 'uws',
    rect: [104, 146, 130, 170],
    door: 'E',
    stories: 3,
    height: 24,
    guards: 3,
    price: 0,
    income: 40,
    blurb: 'L’immeuble le plus célèbre de Central Park Ouest : appartements de légende.',
  }),
  { key: 'hotel_chelsea', name: 'Hôtel Chelsea', type: 'hotel', district: 'village', blurb: 'L’hôtel des artistes, des poètes… et des trafiquants.' },
);
twin(
  bld({
    key: 'beacon',
    name: 'Salle Beacon',
    type: 'theatre',
    district: 'uws',
    rect: [60, 90, 88, 112],
    door: 'N',
    stories: 2,
    guards: 3,
    price: 0,
    income: 35,
    blurb: 'Une salle de concert Art déco où l’on joue (et parie) toute la nuit.',
    style: 1,
  }),
  { key: 'chelsea_market', name: 'Marché de Chelsea', type: 'nightmarket', district: 'village', blurb: 'Halles gourmandes le jour, marché noir la nuit.' },
);
twin(
  bld({
    key: 'zabar',
    name: 'Épicerie fine Zabar’s',
    type: 'bodega',
    district: 'uws',
    rect: [76, 120, 90, 132],
    door: 'E',
    stories: 2,
    guards: 0,
    price: 350,
    income: 20,
    blurb: 'Bagels, saumon fumé et caviar de synthèse. À vendre.',
  }),
  { key: 'cafe_wha', name: 'Café Wha?', type: 'diner', district: 'village', blurb: 'Le café-concert de MacDougal Street. À vendre.' },
);
twin(
  bld({
    key: 'salle_riverside',
    name: 'Salle de sport de Riverside',
    type: 'gym',
    district: 'uws',
    rect: [18, 146, 42, 170],
    door: 'W',
    stories: 2,
    guards: 2,
    price: 0,
    income: 28,
    blurb: 'Haltères, ring et stéroïdes de synthèse.',
  }),
  { key: 'stonewall', name: 'Club Stonewall', type: 'club', district: 'village', blurb: 'Le bar légendaire de Christopher Street, devenu un club électro.', style: 1 },
);

// ===================================================================== CENTRAL PARK ↔ WALL STREET
twin(
  residence('even', 4, {
    key: 'penthouse_cps',
    name: 'Penthouse de Central Park Sud',
    type: 'penthouse',
    district: 'centralpark',
    rect: [144, 162, 166, 184],
    door: 'S',
    stories: 1,
    height: 52,
    price: 9000,
    income: 70,
    blurb: 'Le sommet d’une tour de milliardaires, vue sur tout Central Park.',
    style: 1,
  }),
  { key: 'penthouse_ws', name: 'Penthouse de Wall Street', type: 'penthouse', district: 'wallstreet', blurb: 'Le dernier étage d’une tour de verre qui domine le quartier financier.' },
);
twin(
  bld({
    key: 'plaza',
    name: 'Hôtel Plaza Céleste',
    type: 'hotel',
    district: 'centralpark',
    rect: [170, 162, 196, 184],
    door: 'S',
    stories: 4,
    height: 30,
    isKey: true,
    guards: 4,
    price: 0,
    income: 75,
    security: 1,
    blurb: 'Le palace le plus célèbre de New York. Bâtiment clé.',
  }),
  { key: 'bourse', name: 'Bourse de New York', type: 'exchange', district: 'wallstreet', blurb: 'Le temple des marchés, colonnes et écrans de cotation. Bâtiment clé.', stories: 3 },
);
twin(
  bld({
    key: 'galerie_sterling',
    name: 'Galerie Sterling',
    type: 'gallery',
    district: 'centralpark',
    rect: [200, 162, 226, 184],
    door: 'S',
    stories: 2,
    isKey: true,
    guards: 4,
    price: 0,
    income: 75,
    security: 2,
    heist: { reward: 2400, time: 40, label: 'Voler la collection holographique' },
    blurb: 'Œuvres d’art inestimables sous haute surveillance. Bâtiment clé.',
  }),
  {
    key: 'banque_federale',
    name: 'Banque Fédérale de New York',
    type: 'bank',
    district: 'wallstreet',
    blurb: 'Les réserves d’or de la ville, sous clé numérique. Bâtiment clé.',
    stories: 3,
    height: 30,
    heistLabel: 'Braquer la salle des coffres',
  },
);
twin(
  bld({
    key: 'tavern',
    name: 'Tavern on the Green',
    type: 'restaurant',
    district: 'centralpark',
    rect: [144, 128, 162, 146],
    door: 'E',
    stories: 1,
    isKey: true,
    guards: 4,
    price: 0,
    income: 70,
    security: 1,
    blurb: 'Le restaurant chic au cœur du parc. Bâtiment clé.',
  }),
  { key: 'tour_axiom', name: 'Tour Axiom', type: 'corp', district: 'wallstreet', blurb: 'Siège de la corporation qui possède la moitié de Manhattan. Bâtiment clé.', height: 58 },
);
twin(
  bld({
    key: 'boathouse',
    name: 'Boathouse du lac',
    type: 'boathouse',
    district: 'centralpark',
    rect: [224, 134, 238, 144],
    door: 'W',
    stories: 1,
    guards: 0,
    price: 450,
    income: 25,
    blurb: 'Location de barques et café au bord du lac. À vendre.',
  }),
  { key: 'sentinel', name: 'Centre de sécurité Sentinel', type: 'security', district: 'wallstreet', blurb: 'Les caméras de tout le quartier. À vendre au plus offrant.', stories: 3 },
);
twin(
  bld({
    key: 'belvedere',
    name: 'Château du Belvédère',
    type: 'security',
    district: 'centralpark',
    rect: [228, 98, 244, 114],
    door: 'W',
    stories: 2,
    guards: 3,
    price: 0,
    income: 40,
    security: 1,
    blurb: 'Le château du parc, devenu le poste de surveillance de la Garde Sterling.',
    style: 2,
  }),
  { key: 'hyperion', name: 'Centre de données Hyperion', type: 'security', district: 'wallstreet', blurb: 'Des kilomètres de serveurs qui murmurent les secrets de la finance.', style: 0 },
);

// ===================================================================== UPPER EAST SIDE ↔ LOWER EAST SIDE
twin(
  bld({
    key: 'guggenheim',
    name: 'Musée Guggenheim',
    type: 'gallery',
    district: 'ues',
    rect: [260, 94, 292, 126],
    door: 'W',
    stories: 2,
    isKey: true,
    guards: 4,
    price: 0,
    income: 65,
    security: 2,
    heist: { reward: 1800, time: 35, label: 'Voler les toiles de la rotonde' },
    blurb: 'La rotonde blanche de la 5e Avenue et ses toiles inestimables. Bâtiment clé.',
  }),
  {
    key: 'banque_bowery',
    name: 'Banque d’épargne du Bowery',
    type: 'bank',
    district: 'les',
    blurb: 'Un palais bancaire de marbre où dorment les économies du Lower East Side. Bâtiment clé.',
    stories: 3,
    heistLabel: 'Vider la salle des coffres',
  },
);
twin(
  bld({
    key: 'carlyle',
    name: 'Hôtel Carlyle',
    type: 'hotel',
    district: 'ues',
    rect: [260, 146, 290, 172],
    door: 'W',
    stories: 3,
    height: 26,
    isKey: true,
    guards: 4,
    price: 0,
    income: 60,
    blurb: 'Le palace discret des présidents et des parrains. Bâtiment clé.',
    style: 1,
  }),
  { key: 'marche_essex', name: 'Marché d’Essex', type: 'nightmarket', district: 'les', blurb: 'Le marché couvert du Lower East Side, plaque tournante des trafics. Bâtiment clé.', stories: 2 },
);
twin(
  bld({
    key: 'clinique_lenox',
    name: 'Clinique de Lenox Hill',
    type: 'pharmacy',
    district: 'ues',
    rect: [304, 146, 328, 168],
    door: 'W',
    stories: 2,
    guards: 3,
    price: 0,
    income: 35,
    blurb: 'Soins de luxe, greffes d’implants et ordonnances de complaisance.',
  }),
  { key: 'katz', name: 'Traiteur Katz’s', type: 'diner', district: 'les', blurb: 'Le pastrami le plus célèbre du monde… et ses arrière-salles.' },
);
twin(
  bld({
    key: 'sothebys',
    name: 'Hôtel des ventes Sotheby’s',
    type: 'exchange',
    district: 'ues',
    rect: [350, 150, 374, 178],
    door: 'W',
    stories: 2,
    guards: 3,
    price: 0,
    income: 40,
    blurb: 'Ventes aux enchères de chefs-d’œuvre, parfois volés.',
  }),
  { key: 'bowery_ballroom', name: 'Club Bowery Ballroom', type: 'club', district: 'les', blurb: 'La salle de concert rock du Lower East Side.' },
);
twin(
  bld({
    key: 'bloomingdale',
    name: 'Grand magasin Bloomingdale’s',
    type: 'showroom',
    district: 'ues',
    rect: [304, 172, 334, 184],
    door: 'S',
    stories: 3,
    guards: 2,
    price: 0,
    income: 30,
    blurb: 'Six étages de luxe holographique sur Lexington Avenue.',
    style: 1,
  }),
  { key: 'concession', name: 'Concession Hover-Motors', type: 'showroom', district: 'les', blurb: 'Voitures et motos de luxe en vitrine sur Delancey Street.', style: 0 },
);
twin(
  bld({
    key: 'gracie_mansion',
    name: 'Résidence du maire',
    type: 'hotel',
    district: 'ues',
    rect: [348, 96, 372, 122],
    door: 'W',
    stories: 2,
    guards: 3,
    price: 0,
    income: 35,
    blurb: 'Gracie Mansion, la maison du maire… et ses dossiers compromettants.',
  }),
  { key: 'hotel_ludlow', name: 'Hôtel Ludlow', type: 'hotel', district: 'les', blurb: 'Un hôtel branché où l’on négocie dans les suites.', style: 1 },
);

// ===================================================================== MIDTOWN / TIMES SQUARE
twin(
  residence('even', 5, {
    key: 'tour_zenith',
    name: 'Tour Zénith',
    type: 'tower',
    district: 'midtown',
    rect: [102, 196, 130, 212],
    door: 'S',
    stories: 1,
    height: 62,
    price: 16000,
    income: 100,
    blurb: 'Le gratte-ciel qui domine Times Square par le nord.',
    style: 1,
  }),
  { key: 'tour_meridien', name: 'Tour Méridien', type: 'tower', district: 'midtown', blurb: 'Le gratte-ciel qui domine Times Square par le sud.' },
);
DEFS.push(
  bld({
    key: 'grand_central',
    name: 'Grand Central',
    type: 'station',
    district: 'midtown',
    rect: [303, 220, 334, 260],
    door: 'W',
    stories: 2,
    isKey: true,
    guards: 4,
    price: 0,
    income: 90,
    blurb: 'La gare légendaire, plaque tournante de tous les trafics. Bâtiment clé.',
  }),
);
twin(
  bld({
    key: 'casino_neon',
    name: 'Casino Néon de Broadway',
    type: 'casino',
    district: 'midtown',
    rect: [142, 198, 170, 232],
    door: 'W',
    stories: 3,
    height: 24,
    isKey: true,
    guards: 4,
    price: 0,
    income: 85,
    security: 1,
    heist: { reward: 2400, time: 40, label: 'Vider la caisse du casino' },
    blurb: 'Tables holographiques et jetons en or. Bâtiment clé de Times Square.',
  }),
  {
    key: 'studio_holo',
    name: 'Studio Holo-TV',
    type: 'studio',
    district: 'midtown',
    blurb: 'Il contrôle les écrans géants de Times Square. Bâtiment clé.',
    heistLabel: 'Pirater la régie publicitaire',
  },
);
twin(
  bld({
    key: 'theatre_lumiere',
    name: 'Théâtre Lumière',
    type: 'theatre',
    district: 'midtown',
    rect: [18, 198, 46, 228],
    door: 'E',
    stories: 2,
    guards: 3,
    price: 0,
    income: 45,
    blurb: 'Comédies musicales holographiques, guichets bondés.',
    style: 1,
  }),
  { key: 'club_hudson', name: 'Club Hudson', type: 'club', district: 'midtown', blurb: 'Le club de Hudson Yards où la jeunesse dorée vient se perdre.', style: 1 },
);
twin(
  bld({
    key: 'radio_city',
    name: 'Radio City Music Hall',
    type: 'theatre',
    district: 'midtown',
    rect: [201, 198, 246, 226],
    door: 'W',
    stories: 2,
    guards: 3,
    price: 0,
    income: 50,
    blurb: 'La grande salle Art déco du Rockefeller Center.',
    style: 1,
  }),
  { key: 'madison_square_garden', name: 'Madison Square Garden', type: 'theatre', district: 'midtown', blurb: 'L’arène des combats de boxe, des concerts… et des paris.', style: 0 },
);
twin(
  fixed({
    key: 'police_midtown_nord',
    name: 'Commissariat de Midtown Nord',
    type: 'police',
    district: 'midtown',
    rect: [346, 198, 366, 214],
    door: 'W',
    stories: 2,
    blurb: 'La police de New York (NYPD) pour le nord de Midtown.',
  }),
  { key: 'police_midtown_sud', name: 'Commissariat de Midtown Sud', type: 'police', district: 'midtown', blurb: 'La police de New York (NYPD) pour le sud de Midtown.' },
);
DEFS.push(
  fixed({
    key: 'chrysler',
    name: 'Chrysler Building',
    type: 'landmark',
    district: 'midtown',
    rect: [347, 216, 365, 234],
    door: 'W',
    stories: 1,
    height: 63,
    blurb: 'La flèche art déco la plus célèbre du monde, ravivée au néon.',
  }),
  fixed({
    key: 'empire_state',
    name: 'Empire State Building',
    type: 'landmark',
    district: 'midtown',
    rect: [262, 254, 290, 284],
    door: 'W',
    stories: 1,
    height: 63,
    blurb: 'Le géant de la 34e Rue, couronné d’une antenne de lumière.',
    style: 1,
  }),
);

// ===================================================================== ASTORIA (Even) ↔ BUSHWICK (Dadou)
twin(
  residence('even', 1, {
    key: 'planque_astoria',
    name: 'Planque d’Astoria',
    type: 'hideout',
    district: 'astoria',
    rect: [512, 56, 526, 74],
    door: 'W',
    stories: 2,
    price: 0,
    income: 10,
    blurb: 'Un studio humide au-dessus d’une épicerie. Tout commence ici.',
    style: 1,
  }),
  { key: 'planque_bushwick', name: 'Planque de Bushwick', type: 'hideout', district: 'bushwick', blurb: 'Un deux-pièces miteux au-dessus d’une laverie. Tout commence ici.' },
);
twin(
  bld({
    key: 'marche_astoria',
    name: 'Marché de nuit d’Astoria',
    type: 'nightmarket',
    district: 'astoria',
    rect: [448, 16, 478, 42],
    door: 'W',
    stories: 2,
    isKey: true,
    guards: 4,
    price: 0,
    income: 55,
    blurb: 'Étals fumants, puces électroniques et marchandises volées. Bâtiment clé.',
  }),
  { key: 'club_electric', name: 'Club Electric Brooklyn', type: 'club', district: 'bushwick', blurb: 'La boîte de nuit la plus bruyante de Brooklyn. Bâtiment clé.', style: 0 },
);
twin(
  bld({
    key: 'studios_kaufman',
    name: 'Studios Kaufman',
    type: 'studio',
    district: 'astoria',
    rect: [510, 16, 548, 42],
    door: 'S',
    stories: 2,
    isKey: true,
    guards: 4,
    price: 0,
    income: 55,
    blurb: 'Les plateaux de cinéma d’Astoria, où l’on tourne aussi des faux. Bâtiment clé.',
  }),
  { key: 'bushwick_collective', name: 'Galerie Bushwick Collective', type: 'gallery', district: 'bushwick', blurb: 'Murs peints, art de rue et recel d’œuvres. Bâtiment clé.', style: 2 },
);
twin(
  bld({
    key: 'brasserie_boheme',
    name: 'Brasserie bohème d’Astoria',
    type: 'brewery',
    district: 'astoria',
    rect: [448, 56, 476, 78],
    door: 'W',
    stories: 2,
    guards: 3,
    price: 0,
    income: 35,
    blurb: 'Le grand jardin à bière d’Astoria et ses caves secrètes.',
  }),
  { key: 'casse_bushwick', name: 'Casse de Bushwick', type: 'junkyard', district: 'bushwick', blurb: 'Carcasses de voitures volantes et pièces détachées.' },
);
twin(
  bld({
    key: 'taverne_grecque',
    name: 'Taverne grecque d’Astoria',
    type: 'restaurant',
    district: 'astoria',
    rect: [532, 56, 556, 76],
    door: 'S',
    stories: 1,
    guards: 3,
    price: 0,
    income: 30,
    blurb: 'Grillades, ouzo et parties de cartes clandestines.',
  }),
  { key: 'pizzeria_robertas', name: 'Pizzeria Roberta’s', type: 'restaurant', district: 'bushwick', blurb: 'Pizzas au feu de bois et rendez-vous discrets.' },
);
twin(
  bld({
    key: 'diner_astoria',
    name: 'Diner d’Astoria',
    type: 'diner',
    district: 'astoria',
    rect: [448, 92, 470, 110],
    door: 'W',
    stories: 2,
    guards: 0,
    price: 350,
    income: 20,
    blurb: 'Burgers, milk-shakes et néons rouges. À vendre.',
  }),
  { key: 'bodega_myrtle', name: 'Bodega de Myrtle Avenue', type: 'bodega', district: 'bushwick', blurb: 'Café, sandwichs et billets de loterie. À vendre.' },
);

// ===================================================================== LONG ISLAND CITY ↔ WILLIAMSBURG
twin(
  residence('even', 2, {
    key: 'depot_lic',
    name: 'Dépôt de Long Island City',
    type: 'garage',
    district: 'lic',
    rect: [446, 160, 466, 182],
    door: 'W',
    stories: 2,
    price: 1500,
    income: 30,
    blurb: 'Un dépôt de livraison transformé en base d’opérations.',
    style: 1,
  }),
  { key: 'garage_williamsburg', name: 'Garage de Williamsburg', type: 'garage', district: 'williamsburg', blurb: 'Un garage de carrossage reconverti en base d’opérations.' },
);
twin(
  bld({
    key: 'hub_sunnyside',
    name: 'Hub logistique de Sunnyside',
    type: 'depot',
    district: 'lic',
    rect: [448, 198, 488, 228],
    door: 'N',
    stories: 2,
    isKey: true,
    guards: 4,
    price: 0,
    income: 55,
    blurb: 'Drones de livraison et camions autonomes. Bâtiment clé de Long Island City.',
    style: 1,
  }),
  { key: 'navy_yard', name: 'Entrepôts du Navy Yard', type: 'depot', district: 'williamsburg', blurb: 'Docks, conteneurs et marchandises détournées. Bâtiment clé de Williamsburg.', style: 0 },
);
twin(
  bld({
    key: 'tour_citadel',
    name: 'Tour Citadel',
    type: 'corp',
    district: 'lic',
    rect: [512, 160, 536, 184],
    door: 'S',
    stories: 2,
    height: 50,
    isKey: true,
    guards: 4,
    price: 0,
    income: 55,
    blurb: 'La tour de verre de Long Island City, siège de toutes les combines. Bâtiment clé.',
  }),
  { key: 'raffinerie_domino', name: 'Raffinerie Domino', type: 'factory', district: 'williamsburg', blurb: 'La vieille raffinerie de sucre, devenue un laboratoire clandestin. Bâtiment clé.' },
);
twin(
  bld({
    key: 'usine_drones',
    name: 'Usine de drones Steinway',
    type: 'factory',
    district: 'lic',
    rect: [508, 124, 540, 148],
    door: 'W',
    stories: 2,
    guards: 3,
    price: 0,
    income: 35,
    blurb: 'Chaînes d’assemblage de drones civils… et moins civils.',
    style: 1,
  }),
  { key: 'brasserie_williamsburg', name: 'Brasserie de Williamsburg', type: 'brewery', district: 'williamsburg', blurb: 'Bière artisanale et alambics clandestins.', style: 0 },
);
twin(
  bld({
    key: 'casse_newtown',
    name: 'Casse de Newtown Creek',
    type: 'junkyard',
    district: 'lic',
    rect: [512, 208, 540, 230],
    door: 'N',
    stories: 2,
    guards: 0,
    price: 350,
    income: 20,
    blurb: 'Carcasses de voitures volantes au bord du canal. À vendre.',
  }),
  { key: 'tatoueur', name: 'Atelier de tatouage Neon Ink', type: 'tattoo', district: 'williamsburg', blurb: 'Tatouages lumineux et implants discrets. À vendre.' },
);
twin(
  bld({
    key: 'ps1',
    name: 'Musée PS1',
    type: 'gallery',
    district: 'lic',
    rect: [448, 124, 476, 148],
    door: 'W',
    stories: 2,
    guards: 3,
    price: 0,
    income: 35,
    blurb: 'Art contemporain dans une vieille école, et réserves bien gardées.',
    style: 2,
  }),
  { key: 'smorgasburg', name: 'Marché de Smorgasburg', type: 'nightmarket', district: 'williamsburg', blurb: 'Le marché gourmand du bord de l’eau, et ses étals de contrebande.' },
);

export const BUILDINGS: BuildingDef[] = DEFS.map((d, id) => ({ id, ...d }));

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

export type YardStyle = 'parking' | 'containers' | 'court' | 'garden' | 'market';

/** Zones spéciales (parcs, places…) pour la génération et la carte. */
export interface AreaDef {
  kind: 'park' | 'plaza' | 'lake' | 'reservoir' | 'promenade' | 'yard' | 'square' | 'highline';
  name?: string;
  rect: Rect;
  /** Parcs : fontaine (centre, m). */
  fountain?: [number, number];
  /** Parcs : monument (arche de Washington Square, tombeau de Grant). */
  monument?: 'arch' | 'tomb';
  /** Places : statue (taureau de bronze) ou fontaine ; sans statue : bosquet d'arbres et bancs. */
  statue?: 'bull' | 'fountain';
  /** Terrains : parking, parc à conteneurs, terrain de basket, jardin partagé, marché en plein air. */
  style?: YardStyle;
}

const AREA_LIST: AreaDef[] = [
  { kind: 'park', name: 'Central Park', rect: [140, 88, 250, 160], fountain: [198, 154] },
  { kind: 'reservoir', name: 'Le réservoir', rect: [156, 94, 222, 122] },
  { kind: 'lake', name: 'Le lac', rect: [176, 128, 220, 148] },
  { kind: 'plaza', name: 'Times Square', rect: [100, 214, 132, 266] },
  { kind: 'promenade', name: 'Hudson River Park', rect: [0, 6, 8, 474] },
  { kind: 'promenade', name: 'Promenade de l’East River', rect: [384, 6, 390, 474] },
  { kind: 'promenade', name: 'Promenade de Battery Park', rect: [0, 474, 390, 480] },
  { kind: 'promenade', name: 'Gantry Plaza', rect: [RIVER_X1, 6, RIVER_X1 + 6, 232] },
  { kind: 'promenade', name: 'Domino Park', rect: [RIVER_X1, 248, RIVER_X1 + 6, 474] },
  // square de Wall Street, entre la société de sécurité et le centre de données
  { kind: 'square', name: 'Zuccotti Park', rect: [224, 350, 248, 362] },
];

/** Espace public du nord et son jumeau du sud. */
function twinArea(n: AreaDef, south: Partial<AreaDef>): void {
  AREA_LIST.push(n, { ...n, ...south, rect: mirrorRect(n.rect) });
}
twinArea({ kind: 'park', name: 'Morningside Park', rect: [18, 14, 48, 42] }, { name: 'Battery Park' });
twinArea({ kind: 'park', name: 'Riverside Park', rect: [18, 90, 48, 132], monument: 'tomb' }, { name: 'Washington Square Park', monument: 'arch' });
twinArea({ kind: 'square', name: 'Grand Army Plaza', rect: [230, 162, 248, 184], statue: 'fountain' }, { name: 'Place du Taureau', statue: 'bull' });
twinArea({ kind: 'yard', style: 'court', name: 'Rucker Park', rect: [304, 16, 334, 42] }, { name: 'Columbus Park' });
twinArea({ kind: 'yard', style: 'garden', name: 'Jardin partagé de la 140e Rue', rect: [260, 14, 292, 42] }, { name: 'Jardin Sara Roosevelt' });
twinArea({ kind: 'yard', style: 'parking', name: 'Parking de Park Avenue', rect: [260, 54, 292, 78] }, { name: 'Parking de Canal Street' });
twinArea({ kind: 'yard', style: 'market', name: 'Marché Malcolm Shabazz', rect: [18, 54, 48, 78] }, { name: 'Marché de Canal Street' });
twinArea({ kind: 'yard', style: 'parking', name: 'Parking de Vernon Boulevard', rect: [474, 92, 494, 110] }, { name: 'Parking de Myrtle Avenue' });
twinArea({ kind: 'yard', style: 'containers', name: 'Parc à conteneurs de Newtown', rect: [544, 198, 558, 228] }, { name: 'Quai du Navy Yard' });
// promenades plantées sur d'anciennes voies ferrées surélevées (6 m), au-dessus des quais de l'Hudson
twinArea({ kind: 'highline', name: 'Riverside Walk', rect: [1, 144, 7, 230] }, { name: 'High Line' });

/** Hauteur du tablier des promenades surélevées (m). */
export const HIGHLINE_Y = 6;

export const AREAS: AreaDef[] = AREA_LIST;

/** Le point (x, z) est-il dans un lac ou le réservoir de Central Park ? */
export function lakeAt(x: number, z: number): boolean {
  for (const a of AREAS) {
    if (a.kind !== 'lake' && a.kind !== 'reservoir') continue;
    const [x0, z0, x1, z1] = a.rect;
    const dx = (x - (x0 + x1) / 2) / ((x1 - x0) / 2);
    const dz = (z - (z0 + z1) / 2) / ((z1 - z0) / 2);
    if (dx * dx + dz * dz < 0.9) return true;
  }
  return false;
}

/** Décors pleins de Times Square : One Times Square (tour d'écrans) et les gradins rouges. */
export const ONE_TIMES_SQUARE: Rect = [110, 252, 122, 264];
export const TKTS_STEPS: Rect = [110, 218, 126, 234];

/** Voies de circulation (bande de roulement, hors trottoirs), pour les marquages et le trafic. */
export interface RoadDef {
  name: string;
  /** Rectangle de chaussée (m). */
  rect: Rect;
  /** Axe principal : 'x' (est-ouest) ou 'z' (nord-sud). */
  axis: 'x' | 'z';
}

const ROAD_LIST: RoadDef[] = [];
/** Avenue nord-sud (x0..x1) entre z0 et z1. */
const avenue = (name: string, x0: number, x1: number, z0: number, z1: number): void => {
  ROAD_LIST.push({ name, rect: [x0, z0, x1, z1], axis: 'z' });
};
/** Rue est-ouest (z0..z1) entre x0 et x1, et sa jumelle du sud. */
const street = (name: string, south: string | null, z0: number, z1: number, x0: number, x1: number): void => {
  ROAD_LIST.push({ name, rect: [x0, z0, x1, z1], axis: 'x' });
  if (south) ROAD_LIST.push({ name: south, rect: [x0, WORLD_D - z1, x1, WORLD_D - z0], axis: 'x' });
};

// Manhattan, avenues nord-sud (d'ouest en est)
avenue('Riverside Drive', 8, 16, 6, 190);
avenue('12e Avenue', 8, 16, 190, 290);
avenue('West Street', 8, 16, 290, 474);
avenue('Amsterdam Avenue', 50, 57, 6, 190);
avenue('8e Avenue', 50, 57, 190, 290);
avenue('Hudson Street', 50, 57, 290, 474);
avenue('Broadway', 92, 100, 6, 474);
avenue('Adam Clayton Powell Boulevard', 132, 140, 6, 84);
avenue('Central Park Ouest', 132, 140, 84, 190);
avenue('7e Avenue', 132, 140, 190, 290);
avenue('7e Avenue Sud', 132, 140, 290, 396);
avenue('Varick Street', 132, 140, 396, 474);
avenue('Lenox Avenue', 191, 199, 6, 84);
avenue('6e Avenue', 191, 199, 186, 294);
avenue('Mott Street', 191, 199, 396, 474);
avenue('5e Avenue', 250, 258, 6, 290);
avenue('Bowery', 250, 258, 290, 474);
avenue('Park Avenue', 294, 301, 6, 290);
avenue('Orchard Street', 294, 301, 290, 474);
avenue('Lexington Avenue', 336, 343, 6, 290);
avenue('Essex Street', 336, 343, 290, 474);
avenue('FDR Drive', 376, 384, 6, 474);
// Manhattan, rues est-ouest (nord et jumelles du sud)
street('145e Rue', 'South Street', 6, 12, 8, 384);
street('125e Rue', 'Park Row', 44, 52, 8, 384);
street('110e Rue', 'Canal Street', 80, 88, 8, 140);
street('Central Park Nord', 'Canal Street', 80, 88, 140, 250);
street('110e Rue', 'Canal Street', 80, 88, 250, 384);
street('86e Rue', 'Houston Street', 134, 141, 8, 140);
street('86e Rue', 'Houston Street', 134, 141, 250, 384);
street('59e Rue', '34e Rue', 186, 194, 8, 140);
street('Central Park Sud', 'Wall Street', 186, 194, 140, 250);
street('59e Rue', 'Delancey Street', 186, 194, 250, 384);
// la 42e Rue traverse Midtown, coupée par Grand Central entre Park Avenue et Lexington Avenue
street('42e Rue', null, 236, 244, 8, 294);
street('42e Rue', null, 236, 244, 343, 384);
// ponts sur l'East River et sur Newtown Creek
street('Pont de Triborough', 'Pont de Brooklyn', 44, 52, 384, RIVER_X1 + 6);
street('Pont de Queensboro', 'Pont de Williamsburg', 186, 194, 384, RIVER_X1 + 6);
avenue('Pont Pulaski', 496, 504, 232, 248);
// rive est : avenues nord-sud
avenue('Vernon Boulevard', 436, 444, 6, 232);
avenue('Kent Avenue', 436, 444, 248, 474);
avenue('Steinway Street', 496, 504, 6, 116);
avenue('21e Rue', 496, 504, 116, 232);
avenue('Bedford Avenue', 496, 504, 248, 364);
avenue('Bushwick Avenue', 496, 504, 364, 474);
avenue('31e Rue', 560, 568, 6, 232);
avenue('Knickerbocker Avenue', 560, 568, 248, 474);
// rive est : rues est-ouest
street('Ditmars Boulevard', 'Atlantic Avenue', 6, 12, 436, 568);
street('Astoria Boulevard', 'Myrtle Avenue', 44, 52, 436, 568);
street('30e Avenue', 'DeKalb Avenue', 80, 88, 436, 568);
street('Northern Boulevard', 'Flushing Avenue', 112, 120, 436, 568);
street('Jackson Avenue', 'Grand Street', 150, 156, 436, 568);
street('Queens Plaza', 'Metropolitan Avenue', 186, 194, 436, 568);

export const ROADS: RoadDef[] = ROAD_LIST;

/** Immeubles de décor (non capturables, fermés) qui densifient la ville. */
export interface FillerDef {
  rect: Rect;
  /** Hauteur (m). */
  height: number;
  /** Façade : walk-up de briques, tour de verre, art déco, entrepôt, maisons de Chinatown. */
  style: 'walkup' | 'glass' | 'deco' | 'warehouse' | 'shophouse';
  /** Face principale (vitrines, enseignes). */
  front: Side;
  /** Murs d'écrans publicitaires sur la face principale (Times Square). */
  screens?: boolean;
}

const FILLER_LIST: FillerDef[] = [
  // Midtown : tours de bureaux autour de Times Square (murs d'écrans face à la place) et de Grand Central
  { rect: [60, 196, 90, 216], height: 44, style: 'glass', front: 'E', screens: true },
  { rect: [60, 264, 90, 284], height: 40, style: 'glass', front: 'E', screens: true },
  { rect: [60, 220, 85, 234], height: 34, style: 'deco', front: 'E', screens: true },
  { rect: [60, 246, 85, 260], height: 34, style: 'deco', front: 'E', screens: true },
  { rect: [172, 196, 189, 234], height: 46, style: 'glass', front: 'E' },
  { rect: [172, 246, 189, 284], height: 42, style: 'deco', front: 'E' },
  { rect: [262, 198, 290, 230], height: 30, style: 'deco', front: 'W' },
  { rect: [303, 196, 334, 216], height: 50, style: 'glass', front: 'S' },
  { rect: [303, 264, 334, 284], height: 40, style: 'glass', front: 'N' },
  { rect: [346, 246, 374, 262], height: 44, style: 'glass', front: 'W' },
  // Wall Street : les gratte-ciel du bas de Manhattan (le parc leur fait face au nord)
  { rect: [170, 324, 196, 350], height: 52, style: 'deco', front: 'N' },
  { rect: [204, 324, 220, 350], height: 24, style: 'deco', front: 'N' },
  { rect: [176, 360, 214, 390], height: 63, style: 'glass', front: 'S' },
  { rect: [148, 360, 168, 388], height: 46, style: 'deco', front: 'W' },
];

/** Immeuble de décor du nord et son jumeau du sud. */
function twinFiller(n: FillerDef, southStyle?: FillerDef['style']): void {
  FILLER_LIST.push(n, { ...n, rect: mirrorRect(n.rect), front: mirrorSide(n.front), style: southStyle ?? n.style });
}
// Harlem ↔ Chinatown (maisons à boutiques de Chinatown au sud)
twinFiller({ rect: [82, 14, 90, 42], height: 16, style: 'walkup', front: 'E' }, 'shophouse');
twinFiller({ rect: [178, 14, 189, 42], height: 18, style: 'walkup', front: 'E' }, 'shophouse');
twinFiller({ rect: [204, 14, 230, 40], height: 26, style: 'deco', front: 'W' });
twinFiller({ rect: [346, 14, 374, 42], height: 22, style: 'walkup', front: 'W' });
twinFiller({ rect: [106, 54, 130, 78], height: 18, style: 'walkup', front: 'E' }, 'shophouse');
twinFiller({ rect: [346, 54, 374, 78], height: 24, style: 'walkup', front: 'W' }, 'shophouse');
twinFiller({ rect: [230, 54, 248, 78], height: 16, style: 'walkup', front: 'E' }, 'shophouse');
twinFiller({ rect: [175, 54, 189, 78], height: 18, style: 'walkup', front: 'E' }, 'shophouse');
// Upper West Side ↔ Greenwich Village
twinFiller({ rect: [104, 174, 130, 184], height: 20, style: 'walkup', front: 'E' });
twinFiller({ rect: [18, 172, 48, 184], height: 16, style: 'walkup', front: 'W' });
// Upper East Side ↔ Lower East Side
twinFiller({ rect: [303, 90, 334, 132], height: 18, style: 'walkup', front: 'W' });
twinFiller({ rect: [260, 174, 292, 184], height: 16, style: 'walkup', front: 'W' });
// Queens ↔ Brooklyn (tours de verre de Long Island City, entrepôts, maisons de rapport)
twinFiller({ rect: [508, 90, 556, 110], height: 16, style: 'walkup', front: 'S' });
twinFiller({ rect: [470, 160, 488, 184], height: 12, style: 'warehouse', front: 'N' });
twinFiller({ rect: [480, 14, 494, 42], height: 16, style: 'walkup', front: 'E' });
twinFiller({ rect: [478, 122, 494, 148], height: 12, style: 'warehouse', front: 'E' });
twinFiller({ rect: [540, 158, 558, 184], height: 38, style: 'glass', front: 'S' }, 'walkup');

export const FILLERS: FillerDef[] = FILLER_LIST;

/** Noms des rues pour la carte. */
export const STREETS: { name: string; x: number; z: number; vertical?: boolean }[] = [
  { name: 'Riverside Drive', x: 12, z: 110, vertical: true },
  { name: '12e Avenue', x: 12, z: 226, vertical: true },
  { name: 'West Street', x: 12, z: 370, vertical: true },
  { name: 'Amsterdam Avenue', x: 53.5, z: 122, vertical: true },
  { name: '8e Avenue', x: 53.5, z: 255, vertical: true },
  { name: 'Hudson Street', x: 53.5, z: 358, vertical: true },
  { name: 'Broadway', x: 96, z: 168, vertical: true },
  { name: 'Broadway', x: 96, z: 312, vertical: true },
  { name: 'Central Park Ouest', x: 136, z: 112, vertical: true },
  { name: '7e Avenue', x: 136, z: 210, vertical: true },
  { name: '7e Avenue Sud', x: 136, z: 368, vertical: true },
  { name: 'Lenox Avenue', x: 195, z: 26, vertical: true },
  { name: 'Mott Street', x: 195, z: 454, vertical: true },
  { name: '6e Avenue', x: 195, z: 262, vertical: true },
  { name: '5e Avenue', x: 254, z: 112, vertical: true },
  { name: 'Bowery', x: 254, z: 368, vertical: true },
  { name: 'Park Avenue', x: 297.5, z: 160, vertical: true },
  { name: 'Lexington Avenue', x: 339.5, z: 110, vertical: true },
  { name: 'Essex Street', x: 339.5, z: 370, vertical: true },
  { name: 'FDR Drive', x: 380, z: 240, vertical: true },
  { name: '125e Rue', x: 240, z: 48 },
  { name: '110e Rue', x: 70, z: 84 },
  { name: 'Central Park Nord', x: 220, z: 84 },
  { name: '86e Rue', x: 70, z: 137.5 },
  { name: '59e Rue', x: 74, z: 190 },
  { name: 'Central Park Sud', x: 210, z: 190 },
  { name: '42e Rue', x: 30, z: 240 },
  { name: '34e Rue', x: 74, z: 290 },
  { name: 'Wall Street', x: 210, z: 290 },
  { name: 'Delancey Street', x: 320, z: 290 },
  { name: 'Houston Street', x: 70, z: 342.5 },
  { name: 'Canal Street', x: 70, z: 396 },
  { name: 'Park Row', x: 240, z: 432 },
  { name: 'Vernon Boulevard', x: 440, z: 104, vertical: true },
  { name: 'Kent Avenue', x: 440, z: 376, vertical: true },
  { name: 'Steinway Street', x: 500, z: 100, vertical: true },
  { name: 'Bedford Avenue', x: 500, z: 340, vertical: true },
  { name: 'Astoria Boulevard', x: 530, z: 48 },
  { name: 'Queens Plaza', x: 540, z: 190 },
  { name: 'Metropolitan Avenue', x: 540, z: 290 },
  { name: 'Myrtle Avenue', x: 530, z: 432 },
  { name: 'Northern Boulevard', x: 530, z: 116 },
  { name: 'Flushing Avenue', x: 530, z: 364 },
  { name: 'Newtown Creek', x: 540, z: 240 },
  { name: 'East River', x: 410, z: 120, vertical: true },
  { name: 'East River', x: 410, z: 360, vertical: true },
  { name: 'Hudson', x: -6, z: 240, vertical: true },
];

export type BridgeKey = 'triborough' | 'queensboro' | 'williamsburg' | 'brooklyn' | 'pulaski';

/** Ponts (tablier complet, trottoirs compris) : sur l'East River (axe x) et sur Newtown Creek (axe z). */
export const BRIDGES: { name: string; key: BridgeKey; rect: Rect; axis: 'x' | 'z' }[] = [
  { name: 'Pont de Triborough', key: 'triborough', rect: [384, 42, RIVER_X1 + 6, 54], axis: 'x' },
  { name: 'Pont de Queensboro', key: 'queensboro', rect: [384, 184, RIVER_X1 + 6, 196], axis: 'x' },
  { name: 'Pont de Williamsburg', key: 'williamsburg', rect: [384, 284, RIVER_X1 + 6, 296], axis: 'x' },
  { name: 'Pont de Brooklyn', key: 'brooklyn', rect: [384, 426, RIVER_X1 + 6, 438], axis: 'x' },
  { name: 'Pont Pulaski', key: 'pulaski', rect: [494, CREEK[1], 506, CREEK[3]], axis: 'z' },
];

// ---------------------------------------------------------------------------- métro

export interface SubwayStation {
  key: string;
  name: string;
  /** Quai souterrain (m). */
  rect: Rect;
  /** Bouches de métro : départ de l'escalier dans la rue (x, z) et direction de descente. */
  entrances: { x: number; z: number; dir: Side }[];
  lines: string[];
}

const STATION_LIST: SubwayStation[] = [
  {
    key: 'times_square',
    name: 'Times Square – 42e Rue',
    rect: [84, 220, 134, 260],
    entrances: [
      { x: 104, z: 216, dir: 'S' },
      { x: 104, z: 264, dir: 'N' },
      { x: 88, z: 221, dir: 'S' },
    ],
    lines: ['1', '7', 'L'],
  },
  {
    key: 'grand_central',
    name: 'Grand Central – 42e Rue',
    rect: [302, 214, 346, 266],
    entrances: [
      { x: 306, z: 218, dir: 'E' },
      { x: 306, z: 262, dir: 'E' },
    ],
    lines: ['6', '7', 'L'],
  },
];

/** Station du nord et sa jumelle du sud. */
function twinStation(n: SubwayStation, s: { key: string; name: string; lines: string[] }): void {
  STATION_LIST.push(n, { ...s, rect: mirrorRect(n.rect), entrances: n.entrances.map((e) => ({ x: e.x, z: WORLD_D - e.z, dir: mirrorSide(e.dir) })) });
}
twinStation(
  {
    key: 'st_125',
    name: '125e Rue',
    rect: [84, 56, 114, 78],
    entrances: [
      { x: 88, z: 54.5, dir: 'S' },
      { x: 102.5, z: 79.5, dir: 'N' },
    ],
    lines: ['1'],
  },
  { key: 'canal', name: 'Canal Street', lines: ['1'] },
);
twinStation({ key: 'st_79', name: '79e Rue', rect: [84, 144, 114, 166], entrances: [{ x: 88, z: 143, dir: 'S' }], lines: ['1'] }, { key: 'christopher', name: 'Christopher Street', lines: ['1'] });
twinStation({ key: 'st_86', name: '86e Rue', rect: [329, 142, 356, 166], entrances: [{ x: 333, z: 143, dir: 'S' }], lines: ['6'] }, { key: 'spring', name: 'Spring Street', lines: ['6'] });
twinStation(
  {
    key: 'queensboro_plaza',
    name: 'Queensboro Plaza',
    rect: [490, 174, 516, 206],
    entrances: [
      { x: 492, z: 172.5, dir: 'S' },
      { x: 508, z: 207.5, dir: 'N' },
    ],
    lines: ['7'],
  },
  { key: 'bedford', name: 'Bedford Avenue', lines: ['L'] },
);
twinStation(
  {
    key: 'ditmars',
    name: 'Astoria – Ditmars Boulevard',
    rect: [490, 54, 516, 82],
    entrances: [
      { x: 492, z: 54.5, dir: 'S' },
      { x: 508, z: 79.5, dir: 'N' },
    ],
    lines: ['7'],
  },
  { key: 'myrtle_wyckoff', name: 'Myrtle – Wyckoff', lines: ['L'] },
);

export const SUBWAY_STATIONS: SubwayStation[] = STATION_LIST;

/**
 * Point de correspondance d'une station (m) : le centre du quai. Les rames y partent et y arrivent,
 * et les lieutenants qui « prennent le métro » viennent s'y placer.
 */
export function stationHub(s: SubwayStation): { x: number; z: number; y: number } {
  return { x: (s.rect[0] + s.rect[2]) / 2, z: (s.rect[1] + s.rect[3]) / 2, y: SUBWAY_Y + 0.5 };
}

/** Lignes de métro : stations desservies (dans l'ordre) et couleur. */
export const SUBWAY_LINES: { id: string; name: string; color: number; stations: string[] }[] = [
  { id: '1', name: 'Ligne 1', color: 0xee352e, stations: ['st_125', 'st_79', 'times_square', 'christopher', 'canal'] },
  { id: '6', name: 'Ligne 6', color: 0x00933c, stations: ['st_86', 'grand_central', 'spring'] },
  { id: '7', name: 'Ligne 7', color: 0xb933ad, stations: ['times_square', 'grand_central', 'queensboro_plaza', 'ditmars'] },
  { id: 'L', name: 'Ligne L', color: 0xa7a9ac, stations: ['times_square', 'grand_central', 'bedford', 'myrtle_wyckoff'] },
];

/** Tunnels (polylignes au niveau SUBWAY_Y, largeur 4 m, segments parallèles aux axes). */
export const SUBWAY_TUNNELS: { line: string; pts: [number, number][] }[] = [
  {
    line: '1',
    pts: [
      [96, 58],
      [96, 422],
    ],
  },
  {
    line: '6',
    pts: [
      [339.5, 146],
      [339.5, 334],
    ],
  },
  {
    line: '7',
    pts: [
      [104, 228],
      [500, 228],
      [500, 60],
    ],
  },
  {
    line: 'L',
    pts: [
      [104, 252],
      [500, 252],
      [500, 420],
    ],
  },
];

// ---------------------------------------------------------------------------- eau

/** Le point (x, z) est-il sur l'eau (East River, Newtown Creek) ? */
export function isWater(x: number, z: number): boolean {
  if (x >= RIVER_X0 && x < RIVER_X1) {
    for (const br of BRIDGES) if (br.axis === 'x' && z >= br.rect[1] && z < br.rect[3]) return false;
    return true;
  }
  if (x >= CREEK[0] && x < CREEK[2] && z >= CREEK[1] && z < CREEK[3]) {
    // le pont Pulaski enjambe le canal
    for (const br of BRIDGES) if (br.axis === 'z' && x >= br.rect[0] && x < br.rect[2]) return false;
    return true;
  }
  return false;
}

/**
 * Sols interdits à la navigation : lit de la rivière et du canal, fond des lacs, et voies des
 * tunnels du métro entre les stations (les PNJ voyagent en rame, d'un quai à l'autre).
 */
export function navExclude(x: number, z: number, y: number): boolean {
  if (y >= -0.3) return false;
  if (y < -5) {
    for (const s of SUBWAY_STATIONS) if (x >= s.rect[0] && x < s.rect[2] && z >= s.rect[1] && z < s.rect[3]) return false;
    return true;
  }
  return (y > -5 && isWater(x, z)) || (y > -4 && lakeAt(x, z));
}
