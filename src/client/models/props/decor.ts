// Décor intérieur : luminaires, tableaux, portraits, miroirs, horloge, plantes et petits objets.
// Résolution 1/16 m, origine au centre de la base, l'avant regarde vers +Z.
// Objets muraux : dos à z = 0 contre le mur, origine à la demi-profondeur déclarée.

import { C, P, SLOT, VoxelModel, shade, grain, pix, curve, line6, discXY, hash3, rng, framePanel, turnedLeg, drawer, rotate180 } from './helpers';

const I = C.iron;
const G = C.gold;
const GD = P.goldDark;
const GL = P.goldLight;

// ---------------------------------------------------------------------------------------
// Luminaires

/** Lampe à pétrole de table : pied de laiton, réservoir de verre rubis, verre de lampe allumé. */
export function oilLamp(variant = 0): VoxelModel {
  const m = new VoxelModel(4, 8, 4);
  const font = [0x8a1a2a, 0x2a6a4a, C.brass][variant % 3];
  m.box(0, 0, 1, 4, 1, 3, C.brass).box(1, 0, 0, 3, 1, 4, C.brass);
  m.box(1, 1, 1, 3, 2, 3, C.brassDark);
  m.box(0, 2, 1, 4, 4, 3, font).box(1, 2, 0, 3, 4, 4, font);
  m.box(1, 4, 1, 3, 5, 3, C.brass);
  m.box(1, 5, 1, 3, 8, 3, SLOT.GLOW);
  m.setOrigin(2, 0, 2);
  return m;
}

/** Candélabre à trois bougies allumées. */
export function candelabra(variant = 0): VoxelModel {
  const m = new VoxelModel(7, 10, 3);
  const M = variant % 2 === 0 ? C.silver : C.brass;
  const Md = shade(M, 0.75);
  m.box(2, 0, 0, 5, 1, 3, Md);
  m.box(3, 1, 1, 4, 5, 2, M);
  m.set(3, 2, 1, Md);
  // bras en volute
  m.box(1, 4, 1, 6, 5, 2, M);
  m.set(0, 5, 1, M).set(6, 5, 1, M).set(1, 5, 1, Md).set(5, 5, 1, Md);
  // bobèches, bougies, flammes
  for (const [x, y0, h] of [
    [0, 6, 2],
    [3, 5, 3],
    [6, 6, 2],
  ]) {
    m.set(x, y0, 1, M);
    m.box(x, y0 + 1, 1, x + 1, y0 + 1 + h, 2, P.candle);
    m.set(x, y0 + 1 + h, 1, SLOT.GLOW);
  }
  m.setOrigin(3.5, 0, 1.5);
  return m;
}

/** Applique murale à gaz : rosace de laiton, bras, tulipe de verre allumée. */
export function wallSconce(): VoxelModel {
  const m = new VoxelModel(5, 7, 4);
  m.box(1, 1, 0, 4, 5, 1, C.brass);
  m.set(2, 0, 0, C.brass).set(2, 5, 0, C.brass).set(0, 3, 0, C.brassDark).set(4, 3, 0, C.brassDark);
  m.set(2, 2, 1, C.brassDark).set(2, 2, 2, C.brass);
  m.box(1, 3, 1, 4, 4, 4, C.brass);
  m.box(1, 4, 1, 4, 7, 4, SLOT.GLOW);
  m.set(1, 6, 1, C.brass).set(3, 6, 1, C.brass).set(1, 6, 3, C.brass).set(3, 6, 3, C.brass);
  m.setOrigin(2.5, 0, 2);
  return m;
}

// ---------------------------------------------------------------------------------------
// Cadres dorés

/** Cadre doré mouluré : anneau extérieur, filet intérieur, coins ornés. Dos à z=0, face à z=1. */
function gildedFrame(m: VoxelModel, w: number, h: number, ring = 2): void {
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++) {
      const d = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (d >= ring) continue;
      const corner = (x < 3 || x > w - 4) && (y < 3 || y > h - 4);
      const mid = Math.abs(x - (w - 1) / 2) < 1 || Math.abs(y - (h - 1) / 2) < 1;
      let c = d === 0 ? G : GD;
      if (d === 0 && (corner || mid)) c = GL;
      m.box(x, y, 0, x + 1, y + 1, 2, c);
    }
}

// ---------------------------------------------------------------------------------------
// Tableaux : 8 scènes en pixel art dans des cadres dorés

const SCENE_PAL: Record<string, number> = {
  s: 0xb4d0e4,
  S: 0x8eb4d4,
  c: 0xf0f0ea,
  y: 0xf0c868,
  o: 0xe08838,
  p: 0x7a5a8a,
  r: 0xb83a2a,
  h: 0x6a8a9a,
  g: 0x6a9a44,
  G: 0x3a6a2e,
  l: 0x9ab85a,
  t: 0x5a3a20,
  w: 0xeae2d2,
  R: 0xa83a2a,
  k: 0x1e1a18,
  B: 0x284a6a,
  b: 0x3e6e8e,
  f: 0xe0eaee,
  n: 0x5e3e22,
  W: 0xf2ecdc,
  D: 0x2e2018,
  T: 0x6a4424,
  a: 0xc03428,
  q: 0xdcc454,
  v: 0x5e2e6e,
  e: 0x1e5a32,
  L: 0xe8e0d0,
  H: 0x6e3c1c,
  C: 0xc02a20,
  d: 0xe0d4bc,
  m: 0x8a8aa0,
  M: 0x5e5e70,
  x: 0xf4f4f4,
  u: 0x7e4e2a,
};

const SCENES: string[][] = [
  // paysage pastoral et chaumière
  ['sssssccsssssss', 'sssscccccsssss', 'SSSSSSSSSSSSSS', 'hhhSSSSShhhhSS', 'hhhhhhhhhhhhhG', 'gggggRRRgggGGG', 'ggggRRRRRggGGG', 'gggggwwwggggtg', 'lggggwkwgglltl', 'llllllllllllll'],
  // trois-mâts en mer
  ['ssssssssssssss', 'sscccsssssWsss', 'ssssssssWsWWss', 'SSSSSSSWWsWWWS', 'SSSSSSSWWkWWWS', 'SSSSSSSSSkSSSS', 'bbbbbnnnnnnnbb', 'bbbbbbnnnnnbbb', 'BBfBBBBBBBBfBB', 'BBBBBfBBBBBBBB'],
  // nature morte : fruits et bouteille
  ['DDDDDDDDDDDDDD', 'DDDDDDDDDeDDDD', 'DDDDDDDDDeDDDD', 'DDDDDDDDeeeDDD', 'DDDDDDDDeeeDDD', 'DDDDvqDDeeeDDD', 'DDDvvaaqeeeDDD', 'DDLLLLLLLLLLLD', 'TTTTTTTTTTTTTT', 'TTTTTTTTTTTTTT'],
  // chasse à courre
  ['ssssssssssssss', 'sssccsssssccss', 'hhhhhhhhhhhhhh', 'GGGhhhhhhhhGGG', 'gGgggggCgggGGg', 'gggggggCkggggg', 'gggggHHHHHgggg', 'gddgdHgggHgdgg', 'ggdggHgggHggdg', 'llllllllllllll'],
  // la Tamise au crépuscule, dôme de Saint-Paul
  ['pppppppppppppp', 'pppppppppkpppp', 'yyyyyyyykkkyyy', 'ooooooookkkkko', 'ooookkookkkkko', 'kkkkkkkkkkkkkk', 'BBBoBBBBBBoBBB', 'BBBBoBBBBoBBBB', 'BBBBBBBoBBBBBB', 'BBBBBBBBBBBBBB'],
  // tempête et phare
  ['MMmmmmMMMmmmmm', 'mmmMMMmmmmmMMm', 'mmmmmmmmmmmmyy', 'mmmmmmmmmmmwmm', 'mmmmmmmmmmrwmm', 'mmmmmmmmmmwwmm', 'BBBBfBBBBMMMMM', 'BBfBBBBBMMMMMM', 'BBBBBBfBBBBBfB', 'BfBBBBBBBBBBBB'],
  // cheval de course (à la Stubbs)
  ['ssssssssssssss', 'sssssssssHHHss', 'ssssssssHHHHks', 'SSSSSSSSHHSSSS', 'hhHHHHHHHHhhhh', 'gHHHHHHHHHgggg', 'gHgHgggHgHgggg', 'gHgHgggHgHgggg', 'gkgkgggkgkgggg', 'llllllllllllll'],
  // cerf des Highlands
  ['xxmmmmmmxxmmmm', 'mmMMMmmmmMMMmm', 'MMMMMMuMuMMMMM', 'hhhhhhuuuhhhhh', 'hhhhhhhuhhhhhh', 'gggggguuuggggg', 'ggggguuuuugggg', 'ggggguggguggGG', 'ggggguggguGGGG', 'llllllllllllll'],
];

export const PAINTING_VARIANTS = SCENES.length;

export function painting(variant = 0): VoxelModel {
  const m = new VoxelModel(18, 14, 2);
  gildedFrame(m, 18, 14);
  const scene = SCENES[variant % SCENES.length];
  pix(m, scene, SCENE_PAL, 'xy', 2, 11, 0);
  // touches de matière (empâtements)
  m.forEach((x, y, z, c) => {
    if (z === 0 && x >= 2 && x < 16 && y >= 2 && y < 12 && hash3(x, y, variant, 5) < 0.2) return shade(c, 1.08);
  });
  m.setOrigin(9, 0, 0.64);
  return m;
}

// ---------------------------------------------------------------------------------------
// Portraits : 10 personnages (le 9 est le parrain, fond aux couleurs de la faction)

interface Sitter {
  bg: number;
  hair: number;
  style: 'short' | 'bald' | 'bun' | 'long' | 'cap' | 'tophat' | 'bowler';
  beard?: 'full' | 'chops' | 'moustache';
  beardC?: number;
  coat: number;
  shirt: number;
  tie?: number;
  accent?: number;
  lady?: boolean;
  oval?: boolean;
  crown?: boolean;
  cigar?: boolean;
  skin?: number;
}

const SKIN = 0xe0b896;

const SITTERS: Sitter[] = [
  { bg: 0x1e3a2a, hair: 0x5a3a20, style: 'short', beard: 'chops', coat: 0x1a1a1e, shirt: C.white, tie: C.black },
  { bg: 0x1d2a4a, hair: 0x8a3a1a, style: 'bun', coat: 0x6e1a2a, shirt: 0xf0e8e0, accent: 0xf4f0e8, lady: true, oval: true },
  { bg: 0x3a2618, hair: 0xe8e4dc, style: 'bald', beard: 'full', beardC: 0xeeeae2, coat: 0x1a1a1e, shirt: C.white, tie: C.black },
  { bg: 0x241a14, hair: 0x1a1410, style: 'short', beard: 'moustache', coat: 0xa82020, shirt: C.gold, tie: C.gold, accent: C.gold },
  { bg: 0x5a1820, hair: 0x7a6a5a, style: 'cap', coat: 0x141414, shirt: 0xf4f0e8, accent: 0x2a4a9a, lady: true, oval: true, crown: true },
  { bg: 0xcabf9e, hair: 0xb04a20, style: 'long', coat: 0x2a5a3a, shirt: 0xf0e8e0, lady: true, oval: true },
  { bg: 0x4a4a2a, hair: 0x9a9a92, style: 'short', coat: 0x101012, shirt: C.white, tie: C.white },
  { bg: 0x3a2a1a, hair: 0x3a2a1a, style: 'tophat', beard: 'moustache', beardC: 0x3a2a1a, coat: 0x4a4a52, shirt: C.white, tie: 0x6a1a1a },
  { bg: 0x5a5a62, hair: 0x14100c, style: 'bun', coat: 0x24407a, shirt: 0xf0e8e0, accent: 0xf4f0e8, lady: true },
  { bg: SLOT.TINT1, hair: 0x14100c, style: 'bowler', beard: 'moustache', beardC: 0x14100c, coat: 0x141416, shirt: C.white, tie: SLOT.TINT2, accent: SLOT.TINT2, cigar: true },
];

export const PORTRAIT_VARIANTS = SITTERS.length;

function sitterGrid(s: Sitter): number[][] {
  const W = 8;
  const H = 12;
  const g: number[][] = Array.from({ length: H }, () => Array(W).fill(s.bg));
  const set = (x: number, r: number, c: number) => {
    if (x >= 0 && x < W && r >= 0 && r < H) g[r][x] = c;
  };
  const row = (r: number, x0: number, x1: number, c: number) => {
    for (let x = x0; x <= x1; x++) set(x, r, c);
  };
  const skin = s.skin ?? SKIN;
  const shadeSkin = shade(skin, 0.82);
  // buste
  if (s.lady) {
    row(8, 1, 6, s.coat);
    for (let r = 9; r < 12; r++) row(r, 0, 7, s.coat);
    row(8, 3, 4, skin);
    row(9, 2, 5, skin);
    if (s.accent !== undefined) row(9, 2, 5, s.accent);
    row(9, 3, 4, skin);
    if (s.accent !== undefined) set(3, 10, s.accent), set(4, 10, s.accent);
  } else {
    row(8, 1, 6, s.coat);
    for (let r = 9; r < 12; r++) row(r, 0, 7, s.coat);
    row(8, 3, 4, skin);
    row(9, 3, 4, s.shirt);
    row(10, 3, 4, s.shirt);
    if (s.tie !== undefined) set(3, 10, s.tie), set(4, 10, s.tie), set(3, 11, s.tie);
    if (s.accent !== undefined && s.coat === 0xa82020) {
      row(8, 0, 1, s.accent);
      row(8, 6, 7, s.accent);
      set(1, 10, s.accent);
      set(6, 10, s.accent);
    }
    if (s.cigar) {
      // chaîne de montre
      set(5, 11, SLOT.TINT2);
      set(6, 11, SLOT.TINT2);
    }
  }
  // visage
  row(3, 2, 5, skin);
  row(4, 1, 6, skin);
  row(5, 1, 6, skin);
  row(6, 2, 5, skin);
  row(7, 3, 4, skin);
  set(2, 4, 0x2a1e18);
  set(5, 4, 0x2a1e18);
  set(3, 5, shadeSkin);
  set(4, 5, shadeSkin);
  set(3, 6, 0x9a4a3a);
  set(4, 6, 0x9a4a3a);
  // cheveux et coiffures
  const hc = s.hair;
  switch (s.style) {
    case 'short':
      row(1, 2, 5, hc);
      row(2, 1, 6, hc);
      set(1, 3, hc);
      set(6, 3, hc);
      break;
    case 'bald':
      row(2, 2, 5, skin);
      row(1, 3, 4, skin);
      set(1, 3, hc);
      set(6, 3, hc);
      set(1, 4, hc);
      set(6, 4, hc);
      break;
    case 'bun':
      row(0, 3, 4, hc);
      row(1, 2, 5, hc);
      row(2, 1, 6, hc);
      set(1, 3, hc);
      set(6, 3, hc);
      set(1, 4, hc);
      set(6, 4, hc);
      break;
    case 'long':
      row(1, 2, 5, hc);
      row(2, 1, 6, hc);
      for (let r = 3; r < 10; r++) {
        set(1, r, hc);
        set(6, r, hc);
        if (r > 4) {
          set(0, r, hc);
          set(7, r, hc);
        }
      }
      break;
    case 'cap':
      row(1, 1, 6, 0xf4f0e8);
      row(2, 1, 6, 0xf4f0e8);
      row(3, 1, 1, 0xf4f0e8);
      set(6, 3, 0xf4f0e8);
      row(2, 2, 5, hc);
      for (let r = 3; r < 9; r++) {
        set(0, r, 0xf4f0e8);
        set(7, r, 0xf4f0e8);
      }
      break;
    case 'tophat':
      row(0, 2, 5, 0x141414);
      row(1, 2, 5, 0x141414);
      row(2, 1, 6, 0x141414);
      set(1, 3, hc);
      set(6, 3, hc);
      break;
    case 'bowler':
      row(0, 2, 5, 0x141414);
      row(1, 1, 6, 0x141414);
      row(2, 0, 7, 0x141414);
      set(1, 3, hc);
      set(6, 3, hc);
      break;
  }
  if (s.crown) {
    set(3, 0, C.gold);
    set(4, 0, C.gold);
    set(2, 1, C.gold);
    set(5, 1, C.gold);
  }
  // barbes
  const bc = s.beardC ?? hc;
  if (s.beard === 'full') {
    row(6, 1, 6, bc);
    row(7, 2, 5, bc);
    row(8, 3, 4, bc);
    set(3, 6, shade(bc, 0.8));
    set(4, 6, shade(bc, 0.8));
  } else if (s.beard === 'chops') {
    for (let r = 4; r < 7; r++) {
      set(1, r, hc);
      set(6, r, hc);
    }
    set(2, 6, hc);
    set(5, 6, hc);
  } else if (s.beard === 'moustache') {
    row(6, 2, 5, bc);
  }
  if (s.cigar) {
    set(6, 6, 0x7a4a2a);
    set(7, 6, SLOT.GLOW);
  }
  // médaillon ovale : coins masqués
  if (s.oval) {
    for (let r = 0; r < H; r++)
      for (let x = 0; x < W; x++) {
        const dx = (x + 0.5 - 4) / 4.1;
        const dy = (r + 0.5 - 6) / 6.1;
        if (dx * dx + dy * dy > 1) g[r][x] = -1;
      }
  }
  return g;
}

export function portrait(variant = 0): VoxelModel {
  const m = new VoxelModel(12, 16, 2);
  gildedFrame(m, 12, 16);
  const s = SITTERS[variant % SITTERS.length];
  const g = sitterGrid(s);
  for (let r = 0; r < g.length; r++)
    for (let x = 0; x < g[r].length; x++) {
      const c = g[r][x];
      if (c === -1) m.box(2 + x, 13 - r, 0, 3 + x, 14 - r, 2, GD);
      else m.set(2 + x, 13 - r, 0, c);
    }
  // plaque de cuivre sous le portrait du parrain
  if (s.cigar) m.box(4, 0, 1, 8, 1, 2, GL);
  m.setOrigin(6, 0, 0.64);
  return m;
}

// ---------------------------------------------------------------------------------------
// Miroir doré

export function mirror(variant = 0): VoxelModel {
  const m = new VoxelModel(14, 21, 2);
  const v = variant % 2;
  const glassTop = v === 0 ? 15 : 17;
  for (let x = 0; x < 14; x++)
    for (let y = 0; y < 21; y++) {
      // silhouette : rectangle + arc (v0) ou fronton (v1)
      let inside: boolean;
      let inGlass: boolean;
      const dx = x + 0.5 - 7;
      if (v === 0) {
        inside = y < 16 || Math.hypot(dx / 7, (y + 0.5 - 15.5) / 5) <= 1;
        inGlass = x >= 2 && x < 12 && y >= 2 && (y < glassTop || Math.hypot(dx / 5, (y + 0.5 - 15.5) / 3.6) <= 1);
      } else {
        inside = y < 18 || (y < 21 && Math.abs(dx) < 7 - (y - 17) * 1.6);
        inGlass = x >= 2 && x < 12 && y >= 2 && y < glassTop;
      }
      if (!inside) continue;
      if (inGlass) m.set(x, y, 0, SLOT.GLASS);
      else {
        const edge = !(x > 0 && x < 13 && y > 0);
        m.box(x, y, 0, x + 1, y + 1, 2, edge || (x + y) % 5 === 0 ? G : GD);
      }
    }
  // crête en coquille
  if (v === 0) {
    m.box(5, 19, 0, 9, 21, 2, G);
    m.set(6, 20, 1, GL).set(7, 20, 1, GL).set(6, 19, 1, GL);
  } else {
    m.box(6, 18, 1, 8, 20, 2, GL);
  }
  for (const [x, y] of [
    [0, 0],
    [13, 0],
    [0, 12],
    [13, 12],
  ])
    m.set(x, y, 1, GL);
  m.setOrigin(7, 0, 0.48);
  return m;
}

// ---------------------------------------------------------------------------------------
// Horloge comtoise (de parquet)

export function grandfatherClock(variant = 0): VoxelModel {
  const m = new VoxelModel(9, 34, 6);
  const wood = variant % 2 === 0 ? C.mahogany : C.oak;
  const dark = shade(wood, 0.72);
  const light = shade(wood, 1.2);
  // socle
  m.box(0, 0, 0, 9, 1, 6, dark);
  m.box(0, 1, 0, 9, 7, 6, wood);
  framePanel(m, 1, 2, 8, 6, 6, light);
  m.box(0, 7, 0, 9, 8, 6, light);
  // fût avec porte vitrée et balancier
  m.box(1, 8, 0, 8, 22, 5, wood);
  m.box(2, 9, 5, 7, 21, 6, light);
  m.box(3, 13, 5, 6, 20, 6, 0x1a1410);
  m.set(4, 19, 5, C.brass).set(4, 18, 5, C.brass).set(4, 17, 5, C.brass);
  m.box(3, 14, 5, 6, 16, 6, C.brass);
  m.set(4, 15, 5, P.brassLight);
  m.set(6, 11, 6, C.brass);
  // capuchon (tête)
  m.box(0, 22, 0, 9, 23, 6, light);
  m.box(0, 23, 0, 9, 31, 6, wood);
  // colonnettes
  for (const x of [0, 8]) {
    m.box(x, 23, 5, x + 1, 31, 6, dark);
    m.set(x, 23, 5, C.brass).set(x, 30, 5, C.brass);
  }
  // cadran : arche lunaire, chiffres, aiguilles
  m.box(1, 23, 5, 8, 30, 6, C.brass);
  m.box(2, 24, 5, 7, 28, 6, P.cream);
  m.box(2, 28, 5, 7, 30, 6, 0x1e3a6a);
  m.set(3, 29, 5, C.gold).set(5, 28, 5, P.cream).set(6, 29, 5, C.white);
  m.set(4, 27, 5, C.ink).set(2, 26, 5, C.ink).set(6, 26, 5, C.ink).set(4, 24, 5, C.ink);
  m.set(4, 26, 5, C.black).set(3, 26, 5, C.black).set(4, 27, 5, C.black);
  // fronton à volutes et fleurons
  m.box(0, 31, 0, 9, 32, 6, dark);
  m.box(1, 32, 1, 3, 33, 6, wood).box(6, 32, 1, 8, 33, 6, wood);
  for (const x of [1, 4, 7]) m.box(x, 33, 3, x + 1, 34, 4, C.brass);
  m.box(4, 32, 2, 5, 33, 5, wood);
  grain(m, 'y', 0.06, 300 + variant, (c) => c === wood);
  m.setOrigin(4.5, 0, 3);
  return m;
}

// ---------------------------------------------------------------------------------------
// Plantes en pot

/** Feuille arquée (courbe de Bézier) partant de (x, y, z) dans la direction a. */
function leaf(m: VoxelModel, x: number, y: number, z: number, a: number, len: number, rise: number, c: number, c2: number): void {
  const dx = Math.cos(a);
  const dz = Math.sin(a);
  const p1: [number, number, number] = [x + dx * len * 0.45, y + rise, z + dz * len * 0.45];
  const p2: [number, number, number] = [x + dx * len, y + rise * 0.45, z + dz * len];
  curve(m, [x, y, z], p1, p2, c);
  curve(m, [x + 0.5, y + 0.5, z], [p1[0] + 0.5, p1[1] - 0.6, p1[2]], [p2[0], p2[1] - 0.5, p2[2]], c2);
}

/** Plantes : 0 aspidistra en cache-pot de faïence, 1 fougère sur sellette, 2 palmier en pot de laiton. */
export function plantPot(variant = 0): VoxelModel {
  const m = new VoxelModel(9, 18, 9);
  const v = variant % 3;
  const c = 4.5;
  const r = rng(400 + v);
  if (v === 0) {
    // cache-pot bleu et blanc
    m.cylY(c, c, 3.2, 0, 1, P.blueWare);
    m.cylY(c, c, 3.6, 1, 5, P.porcelain);
    m.cylY(c, c, 4.2, 5, 6, P.porcelain);
    m.forEach((x, y, z, col) => {
      if (col === P.porcelain && (y === 2 || y === 4 || (y === 3 && (x + z) % 2 === 0))) return P.blueWare;
    });
    m.cylY(c, c, 3.3, 5, 6, P.earth);
    for (let i = 0; i < 13; i++) {
      const a = (i / 13) * Math.PI * 2 + r() * 0.3;
      leaf(m, c - 0.5 + Math.cos(a) * 0.6, 6, c - 0.5 + Math.sin(a) * 0.6, a, 3.2 + r() * 1.2, 10 + r() * 9, i % 3 === 0 ? P.leaf : P.leafDark, P.leafDark);
    }
    for (let y = 6; y < 13; y++) m.set(4, y, 4, P.leafDark);
  } else if (v === 1) {
    // sellette d'acajou à trois pieds et fougère retombante
    const w = C.mahogany;
    m.box(1, 0, 3, 2, 1, 6, w).box(7, 0, 3, 8, 1, 6, w).box(3, 0, 7, 6, 1, 8, w);
    m.box(3, 1, 3, 6, 2, 6, w);
    m.box(4, 2, 4, 5, 9, 5, w);
    m.set(4, 4, 4, shade(w, 1.2)).set(4, 7, 4, shade(w, 1.2));
    m.cylY(c, c, 3.2, 9, 10, w);
    m.cylY(c, c, 2.6, 10, 13, 0xa0502a);
    m.cylY(c, c, 3.0, 12, 13, 0xb0603a);
    m.cylY(c, c, 2.2, 12, 13, P.earth);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + r() * 0.4;
      leaf(m, c - 0.5, 13, c - 0.5, a, 4 + r() * 0.8, 3 + r() * 2.5, i % 2 ? P.leafLight : P.leaf, P.leaf);
    }
    m.box(3, 13, 3, 6, 16, 6, P.leaf);
    m.box(4, 16, 4, 5, 17, 5, P.leafLight);
  } else {
    // palmier kentia en pot de laiton martelé
    m.cylY(c, c, 3.0, 0, 1, C.brassDark);
    m.cylY(c, c, 3.6, 1, 6, C.brass);
    m.cylY(c, c, 3.9, 5, 6, P.brassLight);
    m.cylY(c, c, 3.0, 5, 6, P.earth);
    for (const [y, x] of [
      [2, 1],
      [3, 7],
      [4, 1],
    ])
      m.set(x, y, 4, C.brassDark);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const sx = c - 0.5 + Math.cos(a) * 0.8;
      const sz = c - 0.5 + Math.sin(a) * 0.8;
      const top = 11 + (i % 3) * 2;
      line6(m, Math.floor(sx), 6, Math.floor(sz), Math.floor(c - 0.5 + Math.cos(a) * 2), top, Math.floor(c - 0.5 + Math.sin(a) * 2), P.leafDark);
      leaf(m, c - 0.5 + Math.cos(a) * 2, top, c - 0.5 + Math.sin(a) * 2, a, 3, 1.5, P.leaf, P.leafLight);
    }
  }
  m.setOrigin(4.5, 0, 4.5);
  return m;
}

// ---------------------------------------------------------------------------------------
// Petits objets

/** Cible de fléchettes sur planche, deux fléchettes plantées. */
export function dartboard(): VoxelModel {
  const m = new VoxelModel(8, 8, 3);
  m.box(0, 0, 0, 8, 8, 1, C.walnutDark);
  discXY(m, 4, 4, 4.0, 1, 2, (dx, dy, d) => {
    const a = Math.atan2(dy, dx);
    const sector = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 20 + 0.5) % 2;
    if (d > 3.25) return C.black;
    if (d > 2.6) return sector ? 0xb02020 : 0x1e7a3a;
    if (d > 1.4) return sector ? C.black : 0xe8dcc0;
    if (d > 0.9) return sector ? 0xb02020 : 0x1e7a3a;
    return 0xb02020;
  });
  // fléchettes
  m.set(2, 5, 2, C.brass).set(5, 3, 2, C.brass);
  m.set(2, 5, 3, C.red);
  m.setOrigin(4, 0, 0.48);
  return m;
}

/** Globe terrestre de bibliothèque sur trépied, cercle d'horizon et méridien de laiton. */
export function globe(): VoxelModel {
  const m = new VoxelModel(10, 18, 10);
  const w = C.walnut;
  // trépied à pieds galbés et entretoise
  for (const [x, z] of [
    [1, 2],
    [8, 2],
    [4, 8],
  ]) {
    m.set(x, 0, z, shade(w, 0.8));
    line6(m, x, 1, z, x > 4 ? 5 : 4, 8, z > 4 ? 5 : 4, w);
  }
  m.box(4, 3, 4, 6, 4, 6, shade(w, 1.2));
  m.box(4, 7, 4, 6, 9, 6, w);
  // sphère : océans bleu-vert, continents colorés (Empire britannique en rose)
  const MAP = [
    '........................',
    '...ppp....gg.yyyyyy.....',
    '..ppppp...gyyyyyyyyy....',
    '...ppp....yyyyyyyyyy....',
    '....pp...ooopppyyyy.....',
    '.....g...ooooo.ppp.g....',
    '......gg..ooo...p...g...',
    '......ggg..oo........pp.',
    '.......g...pp.......ppp.',
    '...........p............',
    '..........xxxxx.........',
    '........................',
  ];
  const CC: Record<string, number> = { p: 0xd8848e, g: 0x8aaa5a, y: 0xd8c070, o: 0xd8984a, x: 0xf0f0f0 };
  const cy = 13;
  const R = 4.1;
  for (let x = 0; x < 10; x++)
    for (let y = 8; y < 18; y++)
      for (let z = 0; z < 10; z++) {
        const dx = x + 0.5 - 5;
        const dy = y + 0.5 - cy;
        const dz = z + 0.5 - 5;
        if (dx * dx + dy * dy + dz * dz > R * R) continue;
        const lat = Math.asin(Math.max(-1, Math.min(1, dy / R)));
        const lon = Math.atan2(dx, dz);
        const row = Math.floor(((Math.PI / 2 - lat) / Math.PI) * 12);
        const col = Math.floor(((lon + Math.PI) / (Math.PI * 2)) * 24 + 10) % 24;
        const ch = MAP[Math.min(11, Math.max(0, row))][col];
        m.set(x, y, z, ch === '.' ? 0x5e8e9a : CC[ch]);
      }
  // cercle d'horizon (bois clair et papier gradué)
  for (let x = 0; x < 10; x++)
    for (let z = 0; z < 10; z++) {
      const d = Math.hypot(x + 0.5 - 5, z + 0.5 - 5);
      if (d > 4.1 && d <= 5) m.set(x, 12, z, (x + z) % 3 === 0 ? P.parchment : shade(w, 1.2));
    }
  // méridien de laiton (anneau vertical dans le plan XY)
  for (let x = 0; x < 10; x++)
    for (let y = 8; y < 18; y++) {
      const d = Math.hypot(x + 0.5 - 5, y + 0.5 - cy);
      if (d > 4.2 && d <= 5.0 && y >= 9) m.set(x, y, 5, C.brass);
    }
  m.setOrigin(5, 0, 5);
  return m;
}

/** Machine à écrire (Remington noire à décor doré). Comme un bureau : la dactylo est côté -Z. */
export function typewriter(): VoxelModel {
  const m = new VoxelModel(7, 6, 6);
  const B = 0x18181a;
  m.box(0, 0, 0, 7, 1, 6, B);
  m.box(0, 1, 0, 7, 3, 3, B);
  m.box(1, 1, 3, 6, 2, 6, B);
  // touches
  for (let x = 1; x < 6; x++) {
    m.set(x, 2, 4, (x % 2 ? P.cream : 0xd8d0c0));
    m.set(x, 2, 5, (x % 2 ? 0xd8d0c0 : P.cream));
  }
  m.set(0, 1, 2, C.gold).set(6, 1, 2, C.gold).set(3, 1, 3, C.gold);
  // chariot, rouleau, feuille
  m.box(0, 3, 0, 7, 4, 2, B);
  m.set(0, 3, 1, P.silverDark).set(6, 3, 1, P.silverDark);
  m.box(1, 4, 0, 6, 6, 1, C.white);
  m.set(2, 5, 0, C.ink).set(3, 5, 0, C.ink).set(4, 4, 0, C.ink);
  m.setOrigin(3.5, 0, 3);
  return rotate180(m);
}

/** Télégraphe : manipulateur Morse de laiton et parleur à électro-aimants. Comme un bureau : l'opérateur est côté -Z. */
export function telegraph(): VoxelModel {
  const m = new VoxelModel(8, 6, 6);
  const w = C.mahogany;
  m.box(0, 0, 0, 8, 1, 6, w);
  m.box(0, 0, 5, 8, 1, 6, shade(w, 1.2));
  // manipulateur Morse (devant, côté opérateur avant rotation)
  m.box(2, 1, 3, 6, 2, 6, C.brass);
  m.box(3, 2, 3, 5, 3, 4, C.brassDark);
  m.box(3, 3, 2, 5, 4, 6, P.brassLight);
  m.box(3, 3, 5, 5, 5, 6, C.black);
  // parleur : deux bobines noires cerclées de cuivre, armature de laiton
  for (const x of [1, 5]) {
    m.box(x, 1, 0, x + 2, 4, 2, C.black);
    m.box(x, 2, 0, x + 2, 3, 2, C.copper);
  }
  m.box(1, 4, 0, 7, 5, 2, C.brass);
  m.box(7, 1, 0, 8, 6, 1, C.brass);
  m.box(0, 5, 0, 8, 6, 1, C.brass);
  // bornes
  m.set(0, 1, 3, C.brass).set(7, 1, 3, C.brass);
  m.setOrigin(4, 0, 3);
  return rotate180(m);
}

/** Portemanteau tourné avec manteau et chapeau haut-de-forme. */
export function coatStand(variant = 0): VoxelModel {
  const m = new VoxelModel(7, 30, 7);
  const w = C.walnut;
  // pieds en croix
  m.box(0, 0, 3, 7, 1, 4, w).box(3, 0, 0, 4, 1, 7, w);
  m.box(1, 1, 3, 6, 2, 4, w).box(3, 1, 1, 4, 2, 6, w);
  turnedLeg(m, 3, 3, 2, 28, w, [6, 14, 25]);
  m.box(3, 28, 3, 4, 30, 4, shade(w, 1.2));
  // patères
  for (const [x, z] of [
    [2, 3],
    [4, 3],
    [3, 2],
    [3, 4],
  ])
    m.set(x, 26, z, C.brass);
  m.set(1, 27, 3, C.brass).set(5, 27, 3, C.brass).set(3, 27, 1, C.brass).set(3, 27, 5, C.brass);
  // manteau pendu (redingote) côté +Z
  const coat = variant % 2 === 0 ? 0x2a2a30 : 0x4a3a2a;
  m.box(1, 13, 4, 6, 26, 6, coat);
  m.box(2, 12, 5, 5, 13, 6, coat);
  m.box(2, 24, 4, 5, 26, 7, coat);
  m.set(3, 25, 6, shade(coat, 0.7)).set(2, 20, 6, shade(coat, 0.75));
  m.box(3, 13, 6, 4, 24, 7, shade(coat, 0.85));
  // haut-de-forme côté -X
  m.box(0, 26, 2, 3, 27, 5, C.black);
  m.box(0, 27, 2, 2, 29, 4, C.black);
  m.set(0, 27, 2, 0x6a1a1a);
  // écharpe côté -Z
  m.box(3, 18, 1, 4, 26, 2, C.red);
  m.box(3, 18, 2, 4, 19, 3, C.red);
  m.setOrigin(3.5, 0, 3.5);
  return m;
}

/** Porte-parapluies en faïence avec parapluies et canne. */
export function umbrellaStand(): VoxelModel {
  const m = new VoxelModel(6, 11, 6);
  const c = 3;
  m.cylY(c, c, 2.8, 0, 1, P.blueWare);
  m.cylY(c, c, 2.6, 1, 7, P.porcelain);
  m.cylY(c, c, 2.9, 7, 8, P.blueWare);
  m.forEach((x, y, z, col) => {
    if (col === P.porcelain && (y === 3 || y === 5) && (x + z) % 2 === 0) return P.blueWare;
  });
  m.cylY(c, c, 1.9, 7, 8, C.black);
  // parapluies roulés et poignées en crosse
  m.box(2, 7, 2, 3, 10, 3, C.black);
  m.box(2, 10, 2, 4, 11, 3, C.walnut);
  m.set(3, 9, 2, C.walnut);
  m.box(3, 7, 3, 4, 9, 4, 0x2a3a2a);
  m.box(3, 9, 3, 4, 10, 5, 0x6a3a1a);
  // canne à pommeau d'argent
  m.box(2, 7, 3, 3, 10, 4, C.walnutDark);
  m.set(2, 10, 3, C.silver);
  m.setOrigin(3, 0, 3);
  return m;
}

/** Pare-feu de laiton à grille fine et éventail central. */
export function fireScreen(): VoxelModel {
  const m = new VoxelModel(14, 13, 3);
  // pieds à volutes
  for (const x of [1, 11]) {
    m.box(x, 0, 0, x + 2, 1, 3, C.brass);
    m.set(x, 1, 1, C.brass).set(x + 1, 1, 1, C.brass);
  }
  // cadre cintré
  for (let x = 0; x < 14; x++)
    for (let y = 1; y < 13; y++) {
      const top = 11 + Math.round(Math.cos(((x + 0.5 - 7) / 7) * (Math.PI / 2)) * 1.4);
      if (y > top) continue;
      const edge = x === 0 || x === 13 || y === 1 || y === top;
      if (edge) m.set(x, y, 1, C.brass);
      else m.set(x, y, 1, (x + y) % 2 === 0 ? 0x2a2622 : 0x4a443c);
    }
  // éventail de laiton
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (0.15 + (i / 6) * 0.7);
    for (let r = 1; r < 5; r++) m.set(7 + Math.cos(a) * r - 0.5, 3 + Math.sin(a) * r, 2, i % 2 ? C.brass : P.brassLight);
  }
  m.box(6, 2, 2, 8, 4, 3, C.brass);
  m.set(6, 13 - 1, 1, P.brassLight).set(7, 13 - 1, 1, P.brassLight);
  m.setOrigin(7, 0, 1.5);
  return m;
}

/** Seau : 0 seau de bois cerclé plein d'eau, 1 seau à charbon en fer. */
export function bucket(variant = 0): VoxelModel {
  const m = new VoxelModel(6, 7, 6);
  const c = 3;
  if (variant % 2 === 0) {
    m.cylY(c, c, 2.5, 0, 5, C.pine);
    m.forEach((x, y, z, col) => {
      if (col === C.pine && (x + z) % 2 === 0) return shade(col, 0.86);
    });
    m.cylY(c, c, 2.6, 1, 2, P.ironLight);
    m.cylY(c, c, 2.6, 3, 4, P.ironLight);
    m.cylY(c, c, 1.6, 4, 5, SLOT.GLASS);
    // anse
    m.set(0, 5, 3, I).set(5, 5, 2, I).set(1, 6, 3, I).set(4, 6, 2, I).set(2, 6, 3, I).set(3, 6, 2, I);
  } else {
    m.cylY(c, c, 2.4, 0, 5, P.ironMid);
    m.cylY(c, c, 2.7, 4, 5, P.ironLight);
    m.cylY(c, c, 1.8, 4, 5, C.coal);
    m.set(2, 5, 2, C.coal).set(3, 5, 3, C.coal).set(3, 5, 2, shade(C.coal, 1.4));
    m.set(0, 5, 3, I).set(5, 5, 2, I).set(1, 6, 3, I).set(4, 6, 2, I).set(2, 6, 3, I).set(3, 6, 2, I);
  }
  m.setOrigin(3, 0, 3);
  return m;
}

/** Table de toilette : dessus de marbre, crédence carrelée, cuvette et broc, serviettes. */
export function washStand(): VoxelModel {
  const m = new VoxelModel(14, 16, 8);
  const w = C.mahogany;
  for (const x of [0, 13]) for (const z of [0, 7]) m.box(x, 0, z, x + 1, 11, z + 1, w);
  m.box(0, 2, 0, 14, 3, 8, shade(w, 0.85));
  m.box(1, 3, 0, 13, 4, 1, shade(w, 0.85));
  // pot de chambre sur la tablette basse
  m.box(9, 3, 3, 12, 5, 6, P.porcelain);
  m.box(10, 4, 4, 11, 5, 5, P.blueWare);
  drawer(m, 1, 8, 13, 10, 7, w);
  m.box(0, 10, 0, 14, 11, 8, w);
  m.box(0, 11, 0, 14, 12, 8, C.marble);
  for (let x = 1; x < 14; x += 4) m.set(x, 11, 7, P.marbleVein).set(x + 1, 11, 6, P.marbleVein);
  // crédence de carreaux
  for (let x = 0; x < 14; x++) for (let y = 12; y < 16; y++) m.set(x, y, 0, (x + y) % 2 ? 0xe8e8e0 : 0x5a7a9a);
  m.box(0, 15, 0, 14, 16, 1, C.marble);
  // cuvette et broc
  m.box(3, 12, 2, 10, 13, 7, P.porcelain);
  m.box(4, 13, 2, 9, 14, 7, P.porcelain);
  m.box(5, 13, 3, 8, 14, 6, 0x9ab8c8);
  m.box(5, 14, 4, 8, 16, 6, P.porcelain);
  m.box(6, 16, 4, 7, 17, 5, P.porcelain);
  m.set(8, 15, 4, P.porcelain).set(4, 15, 5, P.porcelain);
  m.box(5, 14, 4, 8, 15, 6, P.blueWare);
  // porte-serviettes et serviette
  m.box(13, 9, 1, 14, 10, 7, w);
  m.box(13, 4, 2, 14, 9, 6, C.white);
  m.set(13, 5, 3, 0x9a2a2a).set(13, 5, 4, 0x9a2a2a);
  m.setOrigin(7, 0, 4);
  return m;
}

