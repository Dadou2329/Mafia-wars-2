// Mobilier urbain et objets de rue (Londres, 1888).
// Résolution 1/16 m, origine au centre de la base, l'avant regarde vers +Z.

import { C, P, SLOT, VoxelModel, shade, mix, grain, blockJitter, speckle, colors, rbox, paint, pix, curve, line6, wheel, hash3, rng, text } from './helpers';

const I = C.iron;
const H = C.ironHi;

// ---------------------------------------------------------------------------------------
// Réverbère double

/** Grand candélabre de fonte à deux bras et deux lanternes. */
export function lampDouble(): VoxelModel {
  const m = new VoxelModel(22, 70, 8);
  const cx = 11;
  const cz = 4;
  const G = C.gold;
  // socle mouluré à panneaux
  m.box(7, 0, 0, 15, 2, 8, I);
  m.box(8, 2, 1, 14, 3, 7, H);
  m.box(8, 3, 1, 14, 9, 7, I);
  // panneaux en creux + rosaces dorées
  m.box(9, 4, 6, 13, 8, 7, -1).box(9, 4, 5, 13, 8, 6, H).box(10, 5, 5, 12, 7, 6, G);
  m.box(9, 4, 1, 13, 8, 2, -1).box(9, 4, 2, 13, 8, 3, H).box(10, 5, 2, 12, 7, 3, G);
  m.box(8, 4, 2, 9, 8, 6, -1).box(9, 4, 2, 10, 8, 6, H).box(9, 5, 3, 10, 7, 5, G);
  m.box(13, 4, 2, 14, 8, 6, -1).box(12, 4, 2, 13, 8, 6, H).box(12, 5, 3, 13, 7, 5, G);
  m.box(7, 9, 0, 15, 10, 8, I);
  m.box(8, 10, 1, 14, 11, 7, H);
  // cloche
  m.coneY(cx, cz, 3.1, 1.9, 11, 17, I);
  m.cylY(cx, cz, 2.2, 17, 18, G);
  // fût cannelé
  m.cylY(cx, cz, 1.8, 18, 52, I);
  for (let y = 18; y < 52; y++) {
    m.set(10, y, 5, H).set(10, y, 2, H).set(9, y, 4, H).set(12, y, 3, H);
  }
  for (const y of [28, 41]) m.cylY(cx, cz, 2.2, y, y + 1, G);
  // chapiteau évasé
  m.cylY(cx, cz, 2.2, 50, 52, H);
  m.cylY(cx, cz, 2.7, 52, 53, I);
  m.cylY(cx, cz, 3.1, 53, 54, I);
  // traverse
  m.box(2, 54, 3, 20, 55, 5, I);
  m.box(4, 53, 3, 7, 54, 5, I);
  // consoles en volute sous la traverse
  for (const z of [3, 4]) {
    curve(m, [9, 44, z], [3.5, 45, z], [3.5, 53, z], I);
    curve(m, [9, 48, z], [6, 48.5, z], [6, 53, z], I);
  }
  m.box(4, 46, 3, 6, 48, 5, I).set(5, 47, 3, G).set(5, 47, 4, G);
  // fleuron central
  m.cylY(cx, cz, 2.2, 55, 56, H);
  m.cylY(cx, cz, 1.8, 56, 58, I);
  m.box(10, 58, 3, 12, 60, 5, I);
  m.box(10, 60, 3, 12, 62, 5, G);
  // lanterne gauche (puis symétrie)
  m.box(2, 55, 3, 5, 56, 5, I);
  m.box(1, 56, 2, 6, 57, 6, I);
  m.box(1, 57, 2, 6, 63, 6, SLOT.GLOW);
  for (const [x, z] of [
    [1, 2],
    [5, 2],
    [1, 5],
    [5, 5],
  ])
    m.box(x, 57, z, x + 1, 63, z + 1, I);
  m.box(0, 63, 1, 7, 64, 7, I);
  m.box(1, 64, 2, 6, 65, 6, I);
  m.box(2, 65, 3, 5, 66, 5, H);
  m.box(3, 66, 3, 4, 68, 5, I);
  m.box(3, 68, 3, 4, 69, 5, G);
  m.mirrorX();
  m.setOrigin(11, 0, 4);
  return m;
}

// ---------------------------------------------------------------------------------------
// Borne en forme de canon

export function bollard(): VoxelModel {
  const m = new VoxelModel(5, 14, 5);
  const c = 2.5;
  m.cylY(c, c, 2.5, 0, 1, H);
  m.cylY(c, c, 2.3, 1, 10, I);
  m.cylY(c, c, 2.3, 2, 3, H);
  m.cylY(c, c, 2.9, 10, 11, I);
  m.cylY(c, c, 2.3, 11, 12, H);
  m.cylY(c, c, 1.5, 12, 13, I);
  m.cylY(c, c, 1.0, 13, 14, I);
  // usure : arêtes du sommet plus claires
  m.set(2, 13, 2, P.ironLight);
  m.setOrigin(2.5, 0, 2.5);
  return m;
}

// ---------------------------------------------------------------------------------------
// Boîte aux lettres hexagonale « Penfold »

export function pillarBox(): VoxelModel {
  const m = new VoxelModel(9, 24, 9);
  const R = C.postRed;
  const Rd = shade(R, 0.72);
  const Rl = shade(R, 1.2);
  const G = C.gold;
  const hex = (y0: number, y1: number, rad: number, col: number) => {
    for (let x = 0; x < 9; x++)
      for (let z = 0; z < 9; z++) {
        const dx = Math.abs(x + 0.5 - 4.5);
        const dz = Math.abs(z + 0.5 - 4.5);
        if (dz <= rad * 0.866 && dx + dz * 0.577 <= rad) m.box(x, y0, z, x + 1, y1, z + 1, col);
      }
  };
  hex(0, 1, 5.3, Rd);
  hex(1, 2, 5.0, R);
  hex(2, 15, 4.6, R);
  hex(15, 16, 4.9, R);
  hex(16, 17, 5.3, Rl);
  hex(17, 18, 5.0, R);
  hex(18, 19, 4.3, R);
  hex(19, 20, 3.4, Rl);
  hex(20, 21, 2.6, R);
  hex(21, 22, 1.6, R);
  hex(22, 23, 1.6, Rl);
  m.set(4, 23, 4, R);
  // feuilles d'acanthe autour du chapeau
  m.forEach((x, y, z, c) => {
    if (y === 18 && (x + z) % 2 === 0) return Rl;
    if (y === 17 && (x + z) % 2 === 1) return shade(R, 0.9);
  });
  // fente (avant, z=7) et auvent
  m.box(3, 14, 7, 6, 15, 8, -1).box(3, 14, 6, 6, 15, 7, C.black);
  m.box(2, 15, 8, 7, 16, 9, R);
  // porte : joint discret, plaque émaillée, couronne et chiffre VR dorés, serrure
  m.box(2, 3, 7, 3, 13, 8, shade(R, 0.85)).box(6, 3, 7, 7, 13, 8, shade(R, 0.85));
  m.box(3, 6, 7, 6, 8, 8, P.cream);
  m.set(4, 7, 7, C.ink).set(3, 6, 7, shade(P.cream, 0.85)).set(5, 6, 7, shade(P.cream, 0.85));
  pix(m, ['g.g', 'ggg'], { g: G }, 'xy', 3, 12, 8);
  m.set(3, 10, 7, G).set(5, 10, 7, G);
  m.set(4, 4, 7, G);
  m.setOrigin(4.5, 0, 4.5);
  return m;
}

// ---------------------------------------------------------------------------------------
// Abreuvoir en granit

export function horseTrough(): VoxelModel {
  const m = new VoxelModel(30, 13, 12);
  const G = P.granite;
  const Gd = P.graniteDark;
  const Gl = P.graniteLight;
  const inside = (x: number, z: number, r: number) => {
    const px = x + 0.5;
    const pz = z + 0.5;
    const cx = Math.min(Math.max(px, 6), 24);
    return Math.hypot(px - cx, pz - 6) <= r;
  };
  for (let x = 0; x < 30; x++)
    for (let z = 0; z < 12; z++) {
      if (inside(x, z, 6.05)) m.box(x, 0, z, x + 1, 1, z + 1, Gd);
      if (inside(x, z, 5.6)) m.box(x, 1, z, x + 1, 11, z + 1, G);
      if (inside(x, z, 6.05)) m.box(x, 11, z, x + 1, 13, z + 1, inside(x, z, 5.5) ? Gl : G);
      if (inside(x, z, 4.1)) {
        m.box(x, 3, z, x + 1, 13, z + 1, -1);
        m.box(x, 3, z, x + 1, 10, z + 1, SLOT.GLASS);
      }
    }
  // inscription sur la face avant (bandeau en creux, lettres claires)
  const band = shade(G, 0.88);
  for (let x = 8; x < 22; x++) {
    for (let y = 4; y < 10; y++) m.set(x, y, 11, band);
    for (const y of [5, 7]) {
      const word = (x - 8) % 7 === 6;
      if (!word && hash3(x, y, 3, 77) > 0.4) m.set(x, y, 11, shade(G, 0.7));
    }
  }
  // inscription au dos aussi
  for (let x = 8; x < 22; x++) {
    for (let y = 5; y < 9; y++) m.set(x, y, 0, band);
    for (const y of [6]) if ((x - 8) % 5 !== 4 && hash3(x, y, 9, 78) > 0.35) m.set(x, y, 0, shade(G, 0.7));
  }
  // déversoir en laiton à une extrémité
  m.box(27, 9, 5, 30, 10, 7, C.brass);
  blockJitter(m, 0.07, 81, 2, colors(G, Gl, Gd, band));
  m.setOrigin(15, 0, 6);
  return m;
}

// ---------------------------------------------------------------------------------------
// Pompe à eau de rue

export function waterPump(): VoxelModel {
  const m = new VoxelModel(8, 26, 11);
  const B = P.brunswick;
  const Bd = shade(P.brunswick, 0.7);
  const Bl = P.brunswickLight;
  const G = C.gold;
  // dalle de pierre et grille d'évacuation devant le bec
  m.box(0, 0, 0, 8, 1, 11, P.portland);
  for (let x = 2; x < 6; x++) for (let z = 7; z < 10; z++) m.set(x, 0, z, (x + z) % 2 ? C.black : P.ironLight);
  // socle
  m.box(1, 1, 1, 7, 3, 7, Bd);
  m.box(1.5, 3, 1.5, 6.5, 4, 6.5, Bl);
  // fût carré cannelé aux angles abattus
  rbox(m, 2, 4, 2, 6, 19, 6, B);
  for (let y = 5; y < 18; y++) m.set(3, y, 5, Bl).set(5, y, 3, Bl).set(2, y, 3, Bl).set(5, y, 5, Bd);
  for (const y of [6, 17]) m.box(2, y, 2, 6, y + 1, 6, G);
  // chapiteau, pyramide, pomme dorée
  m.box(1, 19, 1, 7, 20, 7, Bd);
  m.box(1, 20, 1, 7, 21, 7, B);
  m.box(2, 21, 2, 6, 22, 6, B);
  m.box(3, 22, 3, 5, 23, 5, Bd);
  m.box(3, 23, 3, 5, 25, 5, G);
  m.set(3, 25, 3, G);
  // mufle de lion en laiton et bec recourbé
  pix(m, ['.bb.', 'bkkb', 'bbbb', '.bb.'], { b: C.brass, k: C.black }, 'xy', 2, 15, 6);
  m.box(3, 11, 6, 5, 12, 9, Bd);
  m.box(3, 10, 8, 5, 11, 9, Bd);
  m.box(3, 9, 8, 5, 10, 9, C.brass);
  // crochet à seau
  m.box(3, 6, 6, 5, 7, 8, Bd);
  m.set(3, 7, 7, Bd).set(4, 7, 7, Bd);
  // levier latéral (+X) au repos, en col de cygne
  m.box(6, 17, 3, 7, 19, 5, Bd);
  m.box(6, 18, 3, 8, 19, 5, B);
  for (let y = 9; y < 18; y++) m.box(7, y, 3, 8, y + 1, 5, B);
  m.box(7, 8, 3, 8, 9, 5, C.brass);
  m.setOrigin(4, 0, 5.5);
  return m;
}

// ---------------------------------------------------------------------------------------
// Horloge sur colonne

export function streetClock(): VoxelModel {
  const m = new VoxelModel(9, 67, 9);
  const c = 4.5;
  const Pt = P.brunswick;
  const Pl = P.brunswickLight;
  const G = C.gold;
  // socle
  m.box(0, 0, 0, 9, 1, 9, shade(Pt, 0.8));
  m.box(1, 1, 1, 8, 3, 8, Pt);
  m.box(1, 3, 1, 8, 4, 8, Pl);
  m.box(1.5, 4, 1.5, 7.5, 11, 7.5, Pt);
  // panneaux et rosaces
  for (const z of [1, 7]) {
    m.box(3, 6, z, 6, 9, z + 1, Pl);
    m.set(4, 7, z, G);
  }
  for (const x of [1, 7]) {
    m.box(x, 6, 3, x + 1, 9, 6, Pl);
    m.set(x, 7, 4, G);
  }
  m.box(1, 11, 1, 8, 12, 8, Pt);
  m.box(2, 12, 2, 7, 13, 7, Pl);
  m.coneY(c, c, 2.7, 1.6, 13, 18, Pt);
  // colonne
  m.cylY(c, c, 1.5, 18, 47, Pt);
  for (let y = 19; y < 47; y++) m.set(4, y, 6, Pl).set(4, y, 2, Pl).set(2, y, 4, Pl).set(6, y, 4, Pl);
  for (const y of [18, 27, 37]) m.cylY(c, c, 2.0, y, y + 1, G);
  // console sous le cadran
  m.cylY(c, c, 2.0, 47, 49, Pt);
  m.cylY(c, c, 2.6, 49, 50, Pl);
  // tête d'horloge
  m.box(0, 50, 1, 9, 61, 8, Pt);
  m.box(0, 50, 1, 1, 61, 2, Pl).box(8, 50, 1, 9, 61, 2, Pl).box(0, 50, 7, 1, 61, 8, Pl).box(8, 50, 7, 9, 61, 8, Pl);
  // cadrans avant et arrière (10 h 10)
  const dialRows = [
    '..GGGGG..',
    '.GWWIWWG.',
    'GWWWWWBWG',
    'GWWBWBWWG',
    'GIWWBWWIG',
    'GWWWWWWWG',
    'GWWWWWWWG',
    '.GWWIWWG.',
    '..GGGGG..',
  ];
  const lg = { G: G, W: C.white, I: C.ink, B: C.black };
  pix(m, dialRows, lg, 'xy', 0, 59, 8);
  pix(m, dialRows.map((r) => r.split('').reverse().join('')), lg, 'xy', 0, 59, 0);
  // fronton au-dessus des cadrans
  for (const z of [0, 8]) m.set(4, 60, z, G);
  // corniche et dôme
  m.box(0, 61, 0, 9, 62, 9, Pt);
  m.box(1, 62, 1, 8, 63, 8, Pl);
  m.cylY(c, c, 2.9, 63, 64, Pt);
  m.cylY(c, c, 2.0, 64, 65, Pt);
  m.box(4, 65, 4, 5, 67, 5, G);
  m.setOrigin(4.5, 0, 4.5);
  return m;
}

// ---------------------------------------------------------------------------------------
// Grille en fer forgé (section de 2 m, se raccorde bout à bout)

export function railing(): VoxelModel {
  const m = new VoxelModel(32, 20, 1);
  // lisses basse et haute
  m.box(0, 0, 0, 32, 2, 1, I);
  m.box(0, 13, 0, 32, 14, 1, I);
  for (let x = 1; x < 32; x += 2) {
    const tall = (x - 1) % 4 === 0;
    m.box(x, 2, 0, x + 1, tall ? 17 : 15, 1, I);
    if (tall) {
      // pointe de lance
      m.box(x - 1, 17, 0, x + 2, 18, 1, I);
      m.box(x, 18, 0, x + 1, 20, 1, H);
    }
  }
  m.setOrigin(16, 0, 0.5);
  return m;
}

// ---------------------------------------------------------------------------------------
// Lanterne de quai (candélabre aux dauphins)

export function gasLanternPier(): VoxelModel {
  const m = new VoxelModel(6, 42, 6);
  const c = 3;
  const B = P.brunswick;
  const Bl = P.brunswickLight;
  const G = C.gold;
  m.box(0, 0, 0, 6, 2, 6, B);
  m.box(0.5, 2, 0.5, 5.5, 3, 5.5, Bl);
  // pied aux dauphins enroulés (bossages vert-de-gris)
  m.cylY(c, c, 2.2, 3, 10, B);
  for (const [x, z] of [
    [0, 0],
    [5, 0],
    [0, 5],
    [5, 5],
  ]) {
    m.box(x, 3, z, x + 1, 6, z + 1, P.verdigris);
    m.set(x, 6, z, P.verdigrisDark);
  }
  m.box(2, 7, 0, 4, 9, 1, P.verdigris).box(2, 7, 5, 4, 9, 6, P.verdigris);
  m.box(0, 7, 2, 1, 9, 4, P.verdigris).box(5, 7, 2, 6, 9, 4, P.verdigris);
  m.cylY(c, c, 1.8, 10, 12, B);
  // fût
  m.box(2, 12, 2, 4, 31, 4, B);
  for (const y of [18, 25]) m.cylY(c, c, 1.8, y, y + 1, G);
  m.cylY(c, c, 1.8, 31, 32, B);
  m.box(0, 32, 0, 6, 33, 6, B);
  // lanterne
  m.box(1, 33, 1, 5, 40, 5, SLOT.GLOW);
  for (const [x, z] of [
    [1, 1],
    [4, 1],
    [1, 4],
    [4, 4],
  ])
    m.box(x, 33, z, x + 1, 40, z + 1, B);
  m.box(0, 39, 0, 6, 40, 6, B);
  m.box(1, 40, 1, 5, 41, 5, Bl);
  m.box(2, 41, 2, 4, 42, 4, G);
  m.setOrigin(3, 0, 3);
  return m;
}

// ---------------------------------------------------------------------------------------
// Plaque de rue sur poteau (le texte est ajouté à part)

/** Plaque vierge : centre à y ≈ 2,53 m, faces à z = ±0,0625 m, champ blanc 0,75 × 0,31 m. */
export function streetSign(): VoxelModel {
  const m = new VoxelModel(14, 45, 2);
  const B = I;
  m.box(5, 0, 0, 9, 2, 2, B);
  m.box(6, 2, 0, 8, 38, 2, B);
  m.box(5, 12, 0, 9, 13, 2, H);
  // plaque émaillée : cadre noir, champ blanc
  m.box(0, 37, 0, 14, 44, 2, C.black);
  m.box(1, 38, 0, 13, 43, 2, C.white);
  m.box(6, 44, 0, 8, 45, 2, B);
  m.setOrigin(7, 0, 1);
  return m;
}

// ---------------------------------------------------------------------------------------
// Enseigne suspendue à potence (le mur est du côté +X, planche perpendiculaire à la façade)

export function hangingSign(): VoxelModel {
  const m = new VoxelModel(14, 19, 14);
  const B = I;
  const z0 = 6;
  const z1 = 8;
  // platine murale boulonnée
  m.box(13, 10, 5, 14, 19, 9, B);
  m.set(13, 11, 5, H).set(13, 11, 8, H).set(13, 17, 5, H).set(13, 17, 8, H);
  // potence : barre haute, console courbe, petite crosse à l'extrémité
  m.box(1, 17, z0, 13, 18, z1, B);
  for (const z of [z0, z1 - 1]) {
    curve(m, [13, 11, z], [8, 11.5, z], [5, 17, z], B);
    m.set(0, 17, z, B).set(0, 18, z, B).set(1, 18, z, B);
    m.set(9, 15, z, B).set(10, 16, z, B);
  }
  m.box(0, 16, z0, 1, 17, z1, C.gold);
  // chaînes
  for (const x of [2, 10]) for (let y = 14; y < 17; y++) m.set(x, y, y % 2 ? z0 : z1 - 1, B);
  // planche aux couleurs du propriétaire
  m.box(1, 1, z0, 12, 14, z1, SLOT.TINT3);
  m.box(2, 2, z0, 11, 13, z1, SLOT.TINT2);
  m.box(3, 3, z0, 10, 12, z1, SLOT.TINT1);
  // couronne en relief sur les deux faces, bandeau du nom dessous
  const crown = ['g.g.g', 'ggggg', 'gtgtg', 'ggggg'];
  const lg = { g: SLOT.TINT2, t: SLOT.TINT3 };
  pix(m, crown, lg, 'xy', 4, 10, z1);
  pix(m, crown, lg, 'xy', 4, 10, z0 - 1);
  m.box(4, 5, z1, 9, 6, z1 + 1, SLOT.TINT2).box(4, 5, z0 - 1, 9, 6, z0, SLOT.TINT2);
  m.setOrigin(7, 0, 7);
  return m;
}

// ---------------------------------------------------------------------------------------
// Bannière de façade aux couleurs du propriétaire

export function banner(): VoxelModel {
  const m = new VoxelModel(16, 35, 2);
  const T1 = SLOT.TINT1;
  const T2 = SLOT.TINT2;
  const T3 = SLOT.TINT3;
  // tissu en pointe
  for (let x = 1; x < 15; x++) {
    const bottom = Math.round(1 + Math.abs(x + 0.5 - 8) * 0.55);
    m.box(x, bottom, 1, x + 1, 33, 2, T1);
    m.set(x, bottom, 1, T2);
  }
  // bordure dorée
  for (let y = 4; y < 31; y++) m.set(2, y, 1, T2).set(13, y, 1, T2);
  m.box(2, 30, 1, 14, 31, 2, T2);
  // bandeau supérieur sombre
  m.box(1, 31, 1, 15, 33, 2, T3);
  for (let x = 2; x < 14; x += 2) m.set(x, 32, 1, T2);
  // emblème : couronne au-dessus de deux sabres croisés
  const crown = ['g.g..g.g', 'gggggggg', 'gtggggtg', 'gggggggg'];
  pix(m, crown, { g: T2, t: T3 }, 'xy', 4, 28, 1);
  // sabres croisés, pointes vers le haut
  const sabre = (mx: (x: number) => number) => {
    m.set(mx(3), 10, 1, T2);
    m.set(mx(4), 11, 1, T3).set(mx(5), 12, 1, T3);
    m.set(mx(4), 13, 1, T2).set(mx(6), 11, 1, T2);
    for (let i = 0; i < 6; i++) m.set(mx(6 + i), 13 + i, 1, T2);
    m.set(mx(12), 20, 1, T2);
  };
  sabre((x) => x);
  sabre((x) => 15 - x);
  // plis : colonnes en retrait
  for (const x of [1, 14]) for (let y = 3; y < 31; y++) if (m.get(x, y, 1) >= 0) {
    m.set(x, y, 0, m.get(x, y, 1));
    m.clear(x, y, 1);
  }
  // pompon
  m.set(7, 0, 1, T2).set(8, 0, 1, T2);
  // tringle et fixations
  m.box(0, 33, 1, 16, 34, 2, I);
  m.box(0, 32, 1, 1, 35, 2, C.gold).box(15, 32, 1, 16, 35, 2, C.gold);
  m.set(3, 33, 0, I).set(12, 33, 0, I);
  m.setOrigin(8, 0, 1.2);
  return m;
}

// ---------------------------------------------------------------------------------------
// Mât avec drapeau (le drapeau flotte vers +Z)

export function flagPole(): VoxelModel {
  const m = new VoxelModel(5, 88, 24);
  const c = 2.5;
  const T1 = SLOT.TINT1;
  const T2 = SLOT.TINT2;
  const T3 = SLOT.TINT3;
  const pole = P.cream;
  // socle de pierre et collier de fonte
  m.box(0, 0, 0, 5, 2, 5, P.portland);
  m.box(0.5, 2, 0.5, 4.5, 3, 4.5, P.portlandDark);
  m.box(1, 3, 1, 4, 6, 4, I);
  m.box(1, 6, 1, 4, 30, 4, pole);
  m.cylY(c, c, 1.0, 30, 86, pole);
  m.cylY(c, c, 1.5, 86, 88, C.gold);
  // drisse et taquet
  for (let y = 12; y < 86; y++) m.set(2, y, 4, P.hemp);
  m.box(2, 12, 4, 3, 14, 5, C.brass);
  // drapeau ondulant
  const top = (z: number) => 84 - (z - 4) * 0.12;
  const bot = (z: number) => 68 - (z - 4) * 0.02;
  let prevX = 2;
  for (let z = 4; z < 24; z++) {
    const xw = Math.round(2 + Math.sin((z - 4) * 0.55) * 1.2 * Math.min(1, (z - 4) / 4));
    const y1 = Math.round(top(z));
    const y0 = Math.round(bot(z));
    for (let y = y0; y < y1; y++) {
      const rel = (y - y0) / (y1 - y0);
      let col: number = T1;
      if (rel > 0.4 && rel < 0.62) col = T2;
      if (z < 6) col = T3;
      m.set(xw, y, z, col);
      if (xw !== prevX) m.set(prevX, y, z, col);
    }
    prevX = xw;
  }
  m.setOrigin(2.5, 0, 12);
  return m;
}

// ---------------------------------------------------------------------------------------
// Caisses, sacs, marchandises

/** Pochoirs (pixel art) pour marquer les caisses. */
const STENCILS: Record<string, string[]> = {
  diamond: ['..k..', '.k.k.', 'k...k', '.k.k.', '..k..'],
  xxx: ['k.k.k.k.k.k', '.k...k...k.', 'k.k.k.k.k.k'],
  arrow: ['..k..', '.kkk.', 'k.k.k', '..k..', '..k..'],
  ring: ['.kkk.', 'k...k', 'k.k.k', 'k...k', '.kkk.'],
  bars: ['kkkkk', '.....', 'kkkkk'],
};

/** Caisse à claire-voie posée en (x0, y0, z0), dimensions w × h × d. */
export function crateAt(
  m: VoxelModel,
  x0: number,
  y0: number,
  z0: number,
  w: number,
  h: number,
  d: number,
  wood: number,
  o: { mark?: string; markC?: number; markSide?: boolean; straw?: boolean; seed?: number } = {},
): void {
  const x1 = x0 + w;
  const y1 = y0 + h;
  const z1 = z0 + d;
  const dark = shade(wood, 0.7);
  const light = shade(wood, 1.14);
  const seed = o.seed ?? x0 * 7 + y0 * 13 + z0 * 3;
  m.box(x0, y0, z0, x1, y1, z1, wood);
  for (let y = y0; y < y1; y++)
    for (let z = z0; z < z1; z++)
      for (let x = x0; x < x1; x++) {
        const ex = x === x0 || x === x1 - 1;
        const ey = y === y0 || y === y1 - 1;
        const ez = z === z0 || z === z1 - 1;
        const edges = (ex ? 1 : 0) + (ey ? 1 : 0) + (ez ? 1 : 0);
        if (edges === 0) continue;
        if (edges >= 2) m.set(x, y, z, light);
        else if ((ex || ez) && (y - y0) % 3 === 2) m.set(x, y, z, dark);
        else if (ey && y === y1 - 1 && (z - z0) % 3 === 2) m.set(x, y, z, dark);
        else {
          // une teinte par planche (les faces fusionnent le long des planches)
          const plank = ey ? Math.floor((z - z0) / 3) : Math.floor((y - y0) / 3);
          const face = ex ? (x === x0 ? 1 : 2) : ez ? (z === z0 ? 3 : 4) : 5;
          m.set(x, y, z, shade(wood, 0.93 + hash3(plank, face, 0, seed) * 0.14));
        }
      }
  if (o.straw) {
    m.box(x0 + 1, y1 - 1, z0 + 1, x1 - 1, y1, z1 - 1, P.straw);
    const r = rng(o.seed ?? 1);
    for (let i = 0; i < (w * d) / 6; i++) {
      const sx = x0 + 1 + Math.floor(r() * (w - 2));
      const sz = z0 + 1 + Math.floor(r() * (d - 2));
      m.set(sx, y1, sz, r() < 0.5 ? P.straw : shade(P.straw, 0.85));
    }
  }
  if (o.mark) {
    const rows = STENCILS[o.mark];
    const mw = rows[0].length;
    const mh = rows.length;
    const mc = o.markC ?? C.ink;
    if (w >= mw + 2 && h >= mh + 1) pix(m, rows, { k: mc }, 'xy', x0 + Math.floor((w - mw) / 2), y0 + Math.floor((h + mh) / 2) - 1, z1 - 1);
    if (o.markSide && d >= mw + 2) pix(m, rows, { k: mc }, 'zy', z0 + Math.floor((d - mw) / 2), y0 + Math.floor((h + mh) / 2) - 1, x1 - 1);
  }
}

export function crateStack(variant = 0): VoxelModel {
  const m = new VoxelModel(16, 27, 16);
  const v = variant % 3;
  if (v === 0) {
    crateAt(m, 0, 0, 0, 16, 11, 16, C.pine, { mark: 'diamond', markSide: true });
    crateAt(m, 1, 11, 2, 12, 9, 12, C.weathered, { mark: 'ring', markC: C.red });
    crateAt(m, 5, 20, 5, 8, 7, 8, C.oak, { straw: true, seed: 3 });
  } else if (v === 1) {
    crateAt(m, 0, 0, 0, 8, 9, 16, C.oak, { mark: 'bars', markSide: true });
    crateAt(m, 8, 0, 0, 8, 9, 16, C.pine, { mark: 'arrow' });
    crateAt(m, 0, 9, 1, 16, 8, 14, C.weathered, { mark: 'diamond', markC: C.navy });
    crateAt(m, 6, 17, 4, 9, 9, 9, C.pine, { mark: 'ring', markSide: true });
  } else {
    crateAt(m, 0, 0, 0, 16, 10, 8, C.pine, { mark: 'arrow', markC: C.red });
    crateAt(m, 0, 0, 8, 16, 10, 8, C.oak, { mark: 'diamond' });
    crateAt(m, 2, 10, 2, 13, 9, 13, C.weathered, { mark: 'ring', markSide: true });
    // sac affaissé sur le dessus
    sackAt(m, 8, 19, 8, 5.5, 3.6, 4.5, C.burlap, 5, 'x');
  }
  m.setOrigin(8, 0, 8);
  return m;
}

/**
 * Sac de toile rempli. axis 'x'/'z' : couché (col noué à l'extrémité +, oreilles à l'autre),
 * 'y' : debout, noué en haut. (cx, cz) centre au sol, y0 base, (rx, ry, rz) demi-dimensions.
 * print : couleur des bandes imprimées (sacs de farine) ou d'un pochoir.
 */
export function sackAt(
  m: VoxelModel,
  cx: number,
  y0: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  col: number,
  seed: number,
  axis: 'x' | 'z' | 'y',
  print?: number,
): void {
  const dark = shade(col, 0.8);
  const light = shade(col, 1.08);
  const cy = y0 + ry;
  for (let y = Math.floor(y0); y <= Math.ceil(y0 + ry * 2); y++)
    for (let z = Math.floor(cz - rz - 1); z <= Math.ceil(cz + rz); z++)
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx); x++) {
        if (y < y0) continue;
        const px = (x + 0.5 - cx) / rx;
        const py = (y + 0.5 - cy) / ry;
        const pz = (z + 0.5 - cz) / rz;
        const t = axis === 'x' ? px : axis === 'z' ? pz : py;
        const u = axis === 'x' ? pz : px;
        const v = axis === 'y' ? pz : py;
        if (Math.abs(t) > 1) continue;
        // plus plein au milieu, extrémités arrondies ; base aplatie par le poids
        const sec = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(t), 4))) * (1 + (hash3(Math.floor(x / 2), Math.floor(y / 2), Math.floor(z / 2), seed) - 0.5) * 0.14);
        const vv = axis === 'y' ? v : Math.max(v, -0.55) * (v > 0 ? 1.08 : 1);
        if (u * u + vv * vv > sec * sec) continue;
        if (axis === 'y' && t > 0.93) continue;
        let c = col;
        if (v > 0.5 && axis !== 'y') c = light;
        if (axis === 'y' && t > 0.6) c = light;
        if (hash3(x, y, z, seed + 9) < 0.06) c = dark;
        // bandes imprimées autour de la panse
        if (print !== undefined && axis !== 'y' && (Math.abs(t + 0.3) < 0.07 || Math.abs(t - 0.3) < 0.07)) c = print;
        m.set(x, y, z, c);
      }
  const ix = Math.floor(cx);
  const iz = Math.floor(cz);
  if (axis === 'y') {
    const top = Math.round(y0 + ry * 2 * 0.95);
    m.box(ix - 1, top - 1, iz - 1, ix + 1, top, iz + 1, P.hempDark);
    m.box(ix - 1, top, iz - 1, ix + 1, top + 1, iz + 1, light);
    m.set(ix - 1, top + 1, iz, light).set(ix, top + 1, iz - 1, light);
    if (print !== undefined) {
      // pochoir sur le flanc avant
      const fz = Math.floor(cz + rz) - 1;
      pix(m, ['.k.', 'k.k', '.k.'], { k: print }, 'xy', ix - 1, Math.round(cy + 1), fz + 1);
    }
  } else {
    const iy = Math.round(cy);
    if (axis === 'x') {
      const ex = Math.round(cx + rx);
      m.box(ex - 1, iy - 1, iz - 1, ex, iy + 1, iz + 1, P.hempDark);
      m.box(ex, iy - 1, iz - 1, ex + 1, iy + 1, iz + 1, light);
      const bx = Math.round(cx - rx);
      m.set(bx, iy + 1, Math.round(cz - rz * 0.6), light).set(bx, iy + 1, Math.round(cz + rz * 0.6) - 1, light);
    } else {
      const ez = Math.round(cz + rz);
      m.box(ix - 1, iy - 1, ez - 1, ix + 1, iy + 1, ez, P.hempDark);
      m.box(ix - 1, iy - 1, ez, ix + 1, iy + 1, ez + 1, light);
      const bz = Math.round(cz - rz);
      m.set(Math.round(cx - rx * 0.6), iy + 1, bz, light).set(Math.round(cx + rx * 0.6) - 1, iy + 1, bz, light);
    }
  }
}

export function sacks(variant = 0): VoxelModel {
  const m = new VoxelModel(18, 10, 14);
  if (variant % 2 === 0) {
    const flour = 0xe2dccb;
    sackAt(m, 8.5, 0, 3.7, 8, 2.8, 3.8, flour, 1, 'x', 0x3a5a9a);
    sackAt(m, 9.5, 0, 10.3, 8, 2.8, 3.8, shade(flour, 0.96), 2, 'x', 0x3a5a9a);
    sackAt(m, 8.5, 4.2, 7, 7.5, 2.8, 3.6, shade(flour, 1.02), 3, 'x', C.red);
  } else {
    sackAt(m, 3.5, 0, 4, 3.4, 4.8, 3.4, C.burlap, 4, 'y', C.ink);
    sackAt(m, 12, 0, 3.6, 5.5, 2.6, 3.4, C.burlapDark, 5, 'x');
    sackAt(m, 9, 0, 10.4, 8.5, 2.6, 3.4, C.burlap, 6, 'x');
    sackAt(m, 12.5, 4.0, 7, 3.3, 2.5, 5.5, shade(C.burlap, 1.05), 7, 'z');
  }
  m.setOrigin(9, 0, 7);
  return m;
}

// ---------------------------------------------------------------------------------------
// Charrette à bras de marchand des quatre saisons

export function handcart(variant = 0): VoxelModel {
  const m = new VoxelModel(16, 16, 30);
  const wood = variant % 2 === 0 ? C.oak : C.weathered;
  const paintC = variant % 2 === 0 ? P.brunswickLight : C.red;
  // roues
  for (const [w0, w1, h0, h1] of [
    [0, 1, 1, 3],
    [15, 16, 13, 15],
  ])
    wheel(m, 'x', 7.5, 10, w0, w1, 7.5, { spokes: 10, wood: shade(paintC, 1.1), tyre: I, hub: C.walnutDark, hubR: 1.4, hubW: [h0, h1], spokeW: 0.45 });
  m.box(1, 7, 9, 15, 8, 11, I);
  // brancards (prolongés en poignées vers +Z)
  m.box(3, 8, 0, 4, 9, 30, wood).box(12, 8, 0, 13, 9, 30, wood);
  m.box(3, 8, 26, 4, 9, 30, shade(wood, 1.2)).box(12, 8, 26, 13, 9, 30, shade(wood, 1.2));
  // pieds de repos
  m.box(3, 0, 22, 4, 8, 23, wood).box(12, 0, 22, 13, 8, 23, wood);
  m.box(3, 3, 22, 13, 4, 23, shade(wood, 0.85));
  // plateau et ridelles
  m.box(2, 9, 1, 14, 10, 24, shade(wood, 1.05));
  for (let z = 1; z < 24; z += 3) m.box(2, 9, z, 14, 10, z + 1, shade(wood, 0.85));
  m.box(2, 10, 1, 3, 12, 24, wood).box(13, 10, 1, 14, 12, 24, wood);
  m.box(2, 10, 1, 14, 12, 2, wood).box(2, 10, 23, 14, 12, 24, wood);
  m.box(2, 11, 1, 3, 12, 24, paintC).box(13, 11, 1, 14, 12, 24, paintC);
  if (variant % 2 === 0) {
    // chargement : caisses et sac
    crateAt(m, 3, 10, 2, 7, 5, 8, C.pine, { mark: 'bars' });
    crateAt(m, 4, 15, 3, 5, 1, 6, C.pine);
    sackAt(m, 8, 10, 15, 4.6, 2.6, 3.5, C.burlap, 11, 'z', C.red);
    crateAt(m, 9, 10, 3, 4, 4, 5, C.weathered, {});
  } else {
    // fruits et légumes en tas dans des paniers
    const pile = (x0: number, z0: number, w: number, d: number, cols: number[], seed: number) => {
      for (let x = x0; x < x0 + w; x++)
        for (let z = z0; z < z0 + d; z++) {
          const e = Math.min(x - x0, x0 + w - 1 - x, z - z0, z0 + d - 1 - z);
          const hh = Math.min(3, 1 + e);
          for (let y = 10; y < 10 + hh; y++) m.set(x, y, z, cols[Math.floor(hash3(x, y, z, seed) * cols.length)]);
        }
    };
    pile(3, 2, 10, 6, [C.apple, shade(C.apple, 0.8), 0xc84a2a], 1);
    pile(3, 9, 10, 6, [C.orange, shade(C.orange, 0.85)], 2);
    pile(3, 16, 10, 7, [C.cabbage, shade(C.cabbage, 0.8), P.leafLight], 3);
    // balance en laiton
    m.box(12, 12, 20, 13, 15, 21, C.brass);
    m.box(10, 15, 20, 14, 16, 21, C.brass);
  }
  m.setOrigin(8, 0, 15);
  return grain(m, 'z', 0.07, 50 + variant, (c) => c === wood || c === shade(wood, 1.05) || c === shade(wood, 0.85));
}

// ---------------------------------------------------------------------------------------
// Étal de marché (5 commerces) sous auvent rayé

/** Tas bombé de petits produits (pommes, pommes de terre…) entre [x0,x1)×[z0,z1). */
function heap(m: VoxelModel, x0: number, x1: number, z0: number, z1: number, y0: number, cols: number[], maxH: number, seed: number): void {
  for (let x = x0; x < x1; x++)
    for (let z = z0; z < z1; z++) {
      const e = Math.min(x - x0, x1 - 1 - x, z - z0, z1 - 1 - z);
      const hh = Math.min(maxH, 1 + e + (hash3(x, 0, z, seed) < 0.3 ? 1 : 0));
      for (let y = y0; y < y0 + hh; y++) m.set(x, y, z, cols[Math.floor(hash3(x, y, z, seed + 1) * cols.length)]);
    }
}

/** Corbeille d'osier (creuse) avec un contenu. */
function basket(m: VoxelModel, x0: number, y0: number, z0: number, w: number, h: number, d: number, fill: number[], seed: number): void {
  const wick = P.straw;
  m.box(x0, y0, z0, x0 + w, y0 + h, z0 + d, wick);
  m.box(x0 + 1, y0 + 1, z0 + 1, x0 + w - 1, y0 + h, z0 + d - 1, -1);
  for (let y = y0; y < y0 + h; y++) if ((y - y0) % 2 === 1) paint(m, x0, y, z0, x0 + w, y + 1, z0 + d, shade(wick, 0.82));
  heap(m, x0 + 1, x0 + w - 1, z0 + 1, z0 + d - 1, y0 + 1, fill, h, seed);
}

export function marketStall(variant = 0): VoxelModel {
  const m = new VoxelModel(40, 43, 24);
  const v = variant % 5;
  const AWN: [number, number][] = [
    [0x2e6a3a, P.canvas],
    [0x24407a, 0xf0f0ea],
    [0xa82424, P.canvas],
    [0x6a2452, 0xe8c860],
    [0x3a7a62, 0xeaa6b6],
  ];
  const [a1, a2] = AWN[v];
  const wood = C.weathered;
  const woodD = shade(wood, 0.8);
  const woodL = shade(C.pine, 1.05);
  // poteaux, traverses
  const awnY = (z: number) => 42 - Math.floor(z / 5);
  for (const [x, z, h] of [
    [1, 1, 42],
    [38, 1, 42],
    [1, 21, 38],
    [38, 21, 38],
  ])
    m.box(x, 0, z, x + 1, h, z + 1, wood);
  m.box(1, 41, 1, 39, 42, 2, woodD);
  m.box(1, 37, 21, 39, 38, 22, woodD);
  for (const x of [1, 38]) line6(m, x, 41, 2, x, 37, 20, woodD);
  // auvent rayé en gradins
  for (let z = 0; z < 24; z++) for (let x = 0; x < 40; x++) m.set(x, awnY(z), z, Math.floor(x / 3) % 2 === 0 ? a1 : a2);
  // lambrequin festonné (avant et côtés)
  for (let x = 0; x < 40; x++) {
    const drop = [1, 2, 3, 2][x % 4];
    for (let k = 1; k <= drop; k++) m.set(x, awnY(23) - k, 23, Math.floor(x / 3) % 2 === 0 ? a1 : a2);
  }
  for (let z = 0; z < 24; z++) for (const x of [0, 39]) m.set(x, awnY(z) - 1, z, z % 4 < 2 ? a1 : a2);
  // tréteaux et plateau
  for (const x of [3, 36]) {
    line6(m, x, 0, 9, x, 13, 21, woodD);
    line6(m, x, 0, 21, x, 13, 9, woodD);
  }
  m.box(1, 14, 8, 39, 15, 23, woodL);
  for (let z = 9; z < 23; z += 4) m.box(1, 14, z, 39, 15, z + 1, shade(woodL, 0.88));
  // gradins d'exposition à l'arrière du plateau
  m.box(1, 15, 8, 39, 17, 14, wood);
  m.box(1, 17, 8, 39, 19, 11, wood);
  // planche peinte à l'avant (enseigne du marchand)
  m.box(2, 10, 23, 38, 14, 24, a1);
  m.box(3, 11, 23, 37, 13, 24, a2);
  for (let x = 6; x < 34; x++) if ((x - 6) % 5 !== 4 && hash3(x, 0, 0, 90 + v) > 0.3) m.set(x, 12, 23, a1);
  // marchandises
  if (v === 0) {
    heap(m, 2, 10, 15, 23, 15, [C.apple, shade(C.apple, 0.8), 0xc84a2a], 3, 1);
    heap(m, 11, 19, 15, 23, 15, [C.orange, shade(C.orange, 0.88)], 3, 2);
    // choux
    for (let x = 21; x < 29; x += 3) for (let z = 15; z < 22; z += 3) m.box(x, 15, z, x + 3, 17, z + 3, hash3(x, 1, z, 3) < 0.5 ? C.cabbage : shade(C.cabbage, 0.85)).set(x + 1, 17, z + 1, P.leafLight);
    heap(m, 30, 38, 15, 23, 15, [C.potato, shade(C.potato, 0.85)], 3, 4);
    // carottes en bottes et navets sur les gradins
    for (let x = 2; x < 20; x += 2) {
      m.box(x, 17, 11, x + 1, 18, 14, P.carrot);
      m.set(x, 17, 10, P.leafLight).set(x, 18, 10, P.leaf);
    }
    heap(m, 21, 38, 11, 14, 17, [P.turnip, P.turnipTop], 2, 5);
    heap(m, 2, 18, 8, 11, 19, [P.pear, shade(P.pear, 0.9)], 2, 6);
    heap(m, 20, 38, 8, 11, 19, [P.grape, shade(P.grape, 1.2), P.leaf], 2, 7);
    basket(m, 6, 0, 11, 7, 5, 7, [C.potato, shade(C.potato, 0.9)], 8);
    basket(m, 26, 0, 11, 7, 5, 7, [C.apple, 0xc84a2a], 9);
  } else if (v === 1) {
    // glace pilée et poissons couchés sur le flanc
    m.box(1, 15, 14, 39, 16, 23, P.ice);
    for (let x = 2; x < 38; x += 3) {
      const mack = hash3(x, 0, 0, 11) < 0.5;
      const back = mack ? 0x2f5a6a : 0x4a5a52;
      const zo = (x / 3) % 2 === 0 ? 0 : 1;
      m.box(x, 16, 16 + zo, x + 1, 17, 21 + zo, back);
      m.box(x + 1, 16, 16 + zo, x + 2, 17, 21 + zo, C.fish);
      if (mack) for (let z = 17 + zo; z < 20 + zo; z += 2) m.set(x, 16, z, 0x1a3a4a);
      m.set(x, 16, 21 + zo, shade(C.fish, 0.75)).set(x + 1, 16, 21 + zo, C.black);
      m.set(x, 16, 15 + zo, back).set(x + 1, 16, 14 + zo, back);
    }
    // saumon et homards sur les gradins
    m.box(1, 17, 11, 39, 18, 14, P.ice);
    m.box(4, 18, 12, 16, 19, 13, P.salmon);
    m.box(5, 19, 12, 15, 20, 13, shade(P.salmon, 0.8));
    m.box(3, 18, 12, 4, 20, 13, shade(P.salmon, 0.7));
    for (const x of [20, 27, 33]) {
      m.box(x, 18, 11, x + 4, 19, 13, P.lobster);
      m.set(x - 1, 18, 13, P.lobster).set(x + 4, 18, 13, P.lobster);
      m.set(x + 1, 19, 12, shade(P.lobster, 0.8));
    }
    heap(m, 2, 38, 8, 11, 19, [0xb0703a, 0x9a5a2a, 0xc8884a], 2, 12);
    // seau d'anguilles et pain de glace par terre
    m.cylY(10, 15, 2.6, 0, 5, P.steel);
    m.cylY(10, 15, 1.7, 4, 5, SLOT.GLASS);
    m.box(25, 0, 12, 33, 4, 18, P.ice);
  } else if (v === 2) {
    // miches, pains longs, baguettes
    for (let x = 2; x < 14; x += 4)
      for (const z of [15, 19]) {
        m.box(x, 15, z, x + 3, 17, z + 3, P.crustLight);
        m.box(x + 1, 17, z + 1, x + 2, 18, z + 2, P.crustLight);
        m.set(x + 1, 16, z + 2, C.bread);
      }
    for (let x = 15; x < 26; x += 3) {
      m.box(x, 15, 15, x + 2, 17, 22, C.bread);
      for (let z = 16; z < 22; z += 2) m.set(x, 16, z, P.crust).set(x + 1, 16, z, P.crust);
    }
    for (let x = 27; x < 38; x++) if (x % 2 === 1) m.box(x, 15, 14, x + 1, 16, 23, P.crustLight);
    // gâteaux glacés et tourtes sur les gradins
    for (let x = 3; x < 37; x += 5) {
      if ((x / 5) % 2 < 1) {
        m.box(x, 17, 11, x + 3, 19, 14, C.white);
        m.set(x + 1, 19, 12, C.red);
      } else {
        m.box(x, 17, 11, x + 3, 18, 14, P.crustLight);
        m.set(x + 1, 18, 12, P.crust);
      }
    }
    heap(m, 2, 38, 8, 11, 19, [P.crustLight, C.bread], 1, 13);
    // panier de baguettes debout
    basket(m, 8, 0, 12, 5, 5, 5, [P.crustLight], 14);
    for (const [x, z] of [
      [9, 13],
      [10, 14],
      [11, 13],
      [9, 15],
      [11, 15],
    ])
      m.box(x, 5, z, x + 1, 13 - ((x + z) % 3), z + 1, P.crustLight);
    crateAt(m, 25, 0, 11, 8, 6, 8, C.pine, {});
  } else if (v === 3) {
    // pièces de tissu (bolts) empilées
    const cloth = [0x7a1e2a, 0x24407a, 0x2e6a3a, 0xc8a040, 0x5a3a6a, 0xd8d0c0, 0x8a4a2a, 0x2a2a2a];
    let k = 0;
    for (const [y, x0, n, zf] of [
      [15, 2, 9, 22],
      [17, 3, 8, 21],
      [19, 5, 6, 20],
    ] as [number, number, number, number][]) {
      for (let i = 0; i < n; i++) {
        const x = x0 + i * 4;
        const c = cloth[k++ % cloth.length];
        m.box(x, y, 15, x + 4, y + 2, zf, c);
        m.box(x, y, zf - 1, x + 4, y + 2, zf, shade(c, 0.78));
        if (k % 3 === 0) m.box(x + 1, y + 1, 15, x + 2, y + 2, zf, shade(c, 1.35));
      }
    }
    // étoffes pliées sur les gradins
    for (let x = 2; x < 38; x += 4) {
      const c = cloth[(x / 4) % cloth.length | 0];
      m.box(x, 17, 11, x + 3, 18, 14, c);
      m.box(x, 18, 11, x + 3, 19, 14, cloth[((x / 4) | 0) + 3 < cloth.length ? ((x / 4) | 0) + 3 : 0]);
    }
    // coupons suspendus à la traverse avant
    for (const [x0, c, c2] of [
      [4, 0x7a1e2a, 0xc8a040],
      [17, 0x24407a, 0xd8d0c0],
      [30, 0x2e6a3a, 0x7a1e2a],
    ] as [number, number, number][]) {
      for (let x = x0; x < x0 + 6; x++)
        for (let y = 24 + ((x - x0) % 2); y < 37; y++) m.set(x, y, 22, (x - x0) === 2 ? c2 : c);
    }
  } else {
    // seaux de fleurs : bouquets serrés
    const flowers = [0xc02030, 0xe8c030, 0xf4f0e8, 0x8a4ab0, 0xe07090, 0xe86a20];
    for (let i = 0; i < 9; i++) {
      const x = 2 + i * 4;
      const z = 16 + (i % 2) * 3;
      m.box(x, 15, z, x + 3, 18, z + 3, P.steel);
      m.box(x, 17, z, x + 3, 18, z + 3, P.steelLight);
      const fc = flowers[i % flowers.length];
      m.box(x, 18, z, x + 3, 19, z + 3, P.leaf);
      m.box(x, 19, z, x + 3, 20, z + 3, fc);
      m.set(x + 1, 20, z + 1, fc).set(x, 19, z, P.leafLight).set(x + 2, 20, z + 2, shade(fc, 0.85));
      m.set(x - 1, 19, z + 1, P.leafLight).set(x + 3, 19, z + 1, P.leaf);
    }
    // pots fleuris sur les gradins
    for (let x = 2; x < 38; x += 3) {
      m.box(x, 17, 12, x + 2, 19, 14, 0xa0502a);
      m.box(x, 19, 12, x + 2, 20, 14, P.leaf);
      m.set(x, 20, 12, flowers[(x * 7) % flowers.length]).set(x + 1, 20, 13, flowers[(x * 3) % flowers.length]);
    }
    // grands seaux de glaïeuls par terre
    for (const x of [6, 25]) {
      m.box(x, 0, 13, x + 4, 6, 17, P.steel);
      m.box(x, 5, 13, x + 4, 6, 17, P.steelLight);
      m.box(x + 1, 6, 14, x + 3, 11, 16, P.leaf);
      m.box(x, 10, 13, x + 4, 13, 17, flowers[(x * 3) % flowers.length]);
      m.box(x + 1, 13, 14, x + 3, 14, 16, flowers[(x * 5 + 1) % flowers.length]);
    }
  }
  // balance suspendue (primeur, poissonnier)
  if (v <= 1) {
    for (let y = 29; y < 37; y++) m.set(20, y, 21, I);
    m.box(17, 28, 21, 24, 29, 22, C.brass);
    m.box(16, 26, 20, 19, 27, 23, C.brass).box(22, 26, 20, 25, 27, 23, C.brass);
    m.set(17, 27, 21, I).set(23, 27, 21, I);
  }
  m.setOrigin(20, 0, 12);
  // une teinte par bande d'auvent, veinage des planches
  grain(m, 'x', 0.06, 62 + v, (c, x, y) => (c === woodL || c === shade(woodL, 0.88)) && y >= 14);
  grain(m, 'y', 0.08, 63 + v, (c, x, y) => c === wood || c === woodD);
  return m;
}

// ---------------------------------------------------------------------------------------
// Kiosque à journaux

export function newsStand(): VoxelModel {
  const m = new VoxelModel(21, 34, 11);
  const G = P.brunswick;
  const Gl = P.brunswickLight;
  // panneau arrière et montants
  m.box(0, 0, 0, 21, 31, 2, G);
  m.box(0, 0, 0, 1, 31, 4, Gl).box(20, 0, 0, 21, 31, 4, Gl);
  // auvent et bandeau d'enseigne
  for (let z = 0; z < 11; z++) m.box(0, 33 - Math.floor(z / 4), z, 21, 34 - Math.floor(z / 4), z + 1, G);
  m.box(0, 27, 9, 21, 31, 10, P.cream);
  m.box(0, 26, 9, 21, 27, 10, C.gold);
  const w = text(m, 'NEWS', 0, 0, 0, 0, true);
  text(m, 'NEWS', Math.floor((21 - w) / 2), 30, 10, C.red);
  for (const x of [0, 20]) m.box(x, 26, 2, x + 1, 33, 10, Gl);
  // affiches des manchettes (contents bills)
  const bill = (x0: number, title: number) => {
    m.box(x0, 15, 2, x0 + 8, 25, 3, C.white);
    m.box(x0 + 1, 22, 2, x0 + 7, 24, 3, title);
    for (let y = 16; y < 21; y++) for (let x = x0 + 1; x < x0 + 7; x++) if (y % 2 === 0 && hash3(x, y, x0, 5) > 0.25) m.set(x, y, 2, C.ink);
  };
  bill(2, C.ink);
  bill(11, C.red);
  // présentoir incliné garni de journaux
  for (let z = 2; z < 10; z++) {
    const y = 14 - Math.floor((z - 2) / 2);
    m.box(1, 0, z, 20, y, z + 1, shade(G, 0.9));
  }
  m.box(1, 0, 9, 20, 11, 10, G);
  for (let i = 0; i < 4; i++) {
    const x0 = 2 + i * 4.5;
    for (let z = 3; z < 9; z++) {
      const y = 14 - Math.floor((z - 2) / 2);
      m.box(x0, y, z, x0 + 4, y + 1, z + 1, P.newsprint);
      if (z === 4 || z === 6) m.box(x0 + 0.5, y, z, x0 + 3.5, y + 1, z + 1, C.ink);
    }
  }
  // paquets ficelés par terre
  for (const [x, z] of [
    [3, 9],
    [14, 9],
  ]) {
    m.box(x, 0, z, x + 4, 3, z + 2, P.newsprint);
    m.box(x + 1, 0, z, x + 2, 3, z + 2, P.hempDark);
    m.box(x, 1, z, x + 4, 2, z + 2, P.hempDark);
  }
  m.setOrigin(10.5, 0, 5.5);
  return blockJitter(m, 0.04, 70, 2, colors(G, Gl, P.newsprint));
}

// ---------------------------------------------------------------------------------------
// Rouleau de cordage

export function ropeCoil(): VoxelModel {
  const m = new VoxelModel(13, 5, 13);
  const c = 6.5;
  // spires concentriques empilées en tas, alternance clair/sombre = torsion du cordage
  const layers: [number, number, number][] = [
    [0, 1.6, 6.5],
    [1, 1.6, 6.3],
    [2, 2.2, 5.6],
    [3, 2.8, 4.6],
    [4, 3.4, 3.9],
  ];
  for (const [y, r0, r1] of layers)
    for (let x = 0; x < 13; x++)
      for (let z = 0; z < 13; z++) {
        const r = Math.hypot(x + 0.5 - c, z + 0.5 - c);
        if (r < r0 || r > r1) continue;
        const turn = Math.floor(r - r0 + (y % 2) * 0.5);
        const a = Math.atan2(z + 0.5 - c, x + 0.5 - c);
        const twist = Math.floor((a / Math.PI) * 10 + turn * 3) % 2 === 0;
        const base = turn % 2 === 0 ? P.hemp : shade(P.hemp, 0.88);
        m.set(x, y, z, twist ? base : shade(base, 0.86));
      }
  // bout libre qui serpente
  for (const [x, z] of [
    [9, 11],
    [10, 11],
    [10, 12],
    [11, 12],
    [12, 12],
  ])
    m.set(x, 0, z, P.hempDark);
  m.setOrigin(6.5, 0, 6.5);
  return m;
}

// ---------------------------------------------------------------------------------------
// Ancre de marine (posée, légèrement inclinée vers l'arrière)

export function anchor(): VoxelModel {
  const m = new VoxelModel(19, 26, 6);
  // dessin 2D (x, y) puis cisaillement en z
  const flat = new VoxelModel(19, 26, 1);
  const A = P.ironMid;
  // anneau
  for (let x = 6; x < 13; x++)
    for (let y = 21; y < 26; y++) {
      const d = Math.hypot(x + 0.5 - 9.5, (y + 0.5 - 23.3) * 1.05);
      if (d > 1.1 && d < 2.6) flat.set(x, y, 0, A);
    }
  // jas (barre transversale) à boules
  flat.box(3, 18, 0, 16, 20, 1, A);
  flat.box(2, 17.5, 0, 3, 20.5, 1, A).box(16, 17.5, 0, 17, 20.5, 1, A);
  // verge
  flat.box(9, 3, 0, 10, 21, 1, A);
  flat.box(8, 3, 0, 11, 6, 1, A);
  // bras en arc
  for (let i = 0; i <= 60; i++) {
    const t = ((i / 60) * 2 - 1) * (Math.PI / 3);
    const x = 9.5 + Math.sin(t) * 8.2;
    const y = 11.5 - Math.cos(t) * 9.2;
    flat.box(x - 0.5, y - 0.5, 0, x + 0.5, y + 1.0, 1, A);
  }
  flat.box(8, 1, 0, 11, 3, 1, A);
  flat.set(9, 0, 0, A);
  // pattes (becs)
  const fluke = ['k..', 'kk.', 'kkk', 'kkk', '.kk'];
  pix(flat, fluke, { k: A }, 'xy', 0, 12, 0);
  pix(flat, fluke.map((r) => r.split('').reverse().join('')), { k: A }, 'xy', 16, 12, 0);
  flat.forEach((x, y) => {
    const z0 = 3 - Math.round(y * 0.1);
    const rusty = hash3(Math.floor(x / 3), Math.floor(y / 3), 0, 5) < 0.3 && hash3(x, y, 2, 5) < 0.7;
    const col = rusty ? mix(A, P.rust, 0.55) : y < 3 ? shade(A, 0.85) : A;
    m.box(x, y, z0, x + 1, y + 1, z0 + 2, col);
  });
  m.setOrigin(9.5, 0, 3);
  return m;
}

// ---------------------------------------------------------------------------------------
// Caisses de poisson

export function fishCrates(): VoxelModel {
  const m = new VoxelModel(19, 10, 13);
  const tray = (x0: number, y0: number, z0: number, w: number, d: number, wood: number, seed: number) => {
    m.box(x0, y0, z0, x0 + w, y0 + 4, z0 + d, wood);
    m.box(x0 + 1, y0 + 1, z0 + 1, x0 + w - 1, y0 + 4, z0 + d - 1, -1);
    m.box(x0, y0 + 3, z0, x0 + w, y0 + 4, z0 + 1, shade(wood, 1.15)).box(x0, y0 + 3, z0 + d - 1, x0 + w, y0 + 4, z0 + d, shade(wood, 1.15));
    m.box(x0 + 1, y0 + 1, z0 + 1, x0 + w - 1, y0 + 3, z0 + d - 1, P.ice);
    // poissons couchés en travers
    for (let x = x0 + 1; x < x0 + w - 1; x += 2) {
      const flip = hash3(x, y0, z0, seed) < 0.5;
      const zA = z0 + 2;
      const zB = z0 + d - 3;
      const back = hash3(x, 0, seed, 3) < 0.5 ? 0x3a5a6a : 0x5a6a5a;
      m.box(x, y0 + 3, zA, x + 1, y0 + 4, zB, C.fish);
      m.set(x, y0 + 4, zA + 1, back).set(x, y0 + 4, zA + 2, back);
      m.set(x, y0 + 3, flip ? zA : zB - 1, shade(C.fish, 0.65));
      m.set(x, y0 + 3, flip ? zB : zA - 1, C.fish);
    }
  };
  tray(0, 0, 0, 9, 13, C.pine, 1);
  tray(10, 0, 0, 9, 13, C.weathered, 2);
  tray(4, 4, 1, 11, 11, C.oak, 3);
  // un turbot / une plie posée sur le dessus
  m.box(7, 8, 4, 12, 9, 8, 0x8a7458);
  for (const [x, z] of [
    [8, 5],
    [10, 6],
    [9, 7],
  ])
    m.set(x, 8, z, C.orange);
  m.set(12, 8, 6, 0x8a7458).set(6, 8, 6, 0x7a6448);
  m.setOrigin(9.5, 0, 6.5);
  return grain(m, 'x', 0.08, 80, colors(C.pine, C.weathered, C.oak));
}

// ---------------------------------------------------------------------------------------
// Roue de charrette dressée

export function cartWheel(variant = 0): VoxelModel {
  const m = new VoxelModel(3, 18, 18);
  const wood = variant % 2 === 0 ? C.oak : shade(C.red, 0.8);
  wheel(m, 'x', 9, 9, 1, 2, 9, { spokes: 10, wood, tyre: P.ironMid, hub: shade(wood, 0.75), hubR: 1.7, hubW: [0, 3], rimW: 1.3, spokeW: 0.42 });
  // moyeu cerclé
  m.set(0, 9, 9, I).set(2, 9, 9, I).set(0, 8, 8, I).set(2, 8, 8, I);
  m.setOrigin(1.5, 0, 9);
  return speckle(m, 0.06, 90 + variant, (c) => c === wood || c === shade(wood, 1.08));
}

// ---------------------------------------------------------------------------------------
// Jardinière de pierre avec buis taillé et géraniums

export function treePlanter(): VoxelModel {
  const m = new VoxelModel(16, 8, 16);
  const S = P.portland;
  const Sd = P.portlandDark;
  m.box(0, 0, 0, 16, 1, 16, Sd);
  m.box(1, 1, 1, 15, 5, 15, S);
  // panneaux en creux sur les faces
  for (const z of [1, 14]) m.box(3, 2, z, 13, 4, z + 1, Sd);
  for (const x of [1, 14]) m.box(x, 2, 3, x + 1, 4, 13, Sd);
  m.box(0, 5, 0, 16, 6, 16, S);
  m.box(2, 5, 2, 14, 6, 14, P.earth);
  // buis en dôme
  m.ellipsoid(8, 5.6, 8, 5.2, 3.0, 5.2, P.leafDark);
  m.forEach((x, y, z, c) => {
    if (c === P.leafDark && hash3(x, y, z, 7) < 0.3) return P.leaf;
  });
  // géraniums aux angles
  for (const [x, z] of [
    [2, 2],
    [13, 2],
    [2, 13],
    [13, 13],
  ]) {
    m.box(x, 6, z, x + 1, 7, z + 1, P.leaf);
    m.set(x, 7, z, 0xc02030);
  }
  m.setOrigin(8, 0, 8);
  return blockJitter(m, 0.05, 95, 2, colors(S, Sd));
}

// ---------------------------------------------------------------------------------------
// Panneau d'affichage (affiches de théâtre des deux côtés)

export function posterBoard(): VoxelModel {
  const m = new VoxelModel(26, 38, 5);
  const G = P.brunswick;
  const Gl = P.brunswickLight;
  // pieds
  for (const x of [3, 21]) {
    m.box(x - 1, 0, 0, x + 3, 2, 5, G);
    m.box(x, 2, 1, x + 2, 9, 4, G);
  }
  // panneau et cadre
  m.box(1, 9, 2, 25, 35, 3, P.creamDark);
  m.box(0, 8, 1, 26, 9, 4, Gl).box(0, 35, 1, 26, 36, 4, Gl);
  m.box(0, 8, 1, 1, 36, 4, Gl).box(25, 8, 1, 26, 36, 4, Gl);
  // fronton
  m.box(0, 36, 1, 26, 37, 4, G);
  m.box(10, 37, 2, 16, 38, 3, G);
  // affiches (face avant z=3, face arrière z=1)
  const circus = [
    'yyyyyyyy',
    'yrrrrrry',
    'yrwwwwry',
    'yrrrrrry',
    'yyyyyyyy',
    'yy.oo.yy',
    'y.oooo.y',
    'y.okko.y',
    'y.oooo.y',
    'yy.oo.yy',
    'yyyyyyyy',
    'ykkkkkky',
    'yyyyyyyy',
  ];
  const magic = [
    'bbbbbbbb',
    'bwwwwwwb',
    'bbbbbbbb',
    'bbyb.bbb',
    'bbbkkbyb',
    'bbbkkbbb',
    'bbkkkkbb',
    'bybbbbbb',
    'bbbbbyb.',
    'bwwwwwwb',
    'bbbbbbbb',
    'bwbwbwbb',
    'bbbbbbbb',
  ].map((r) => r.replace('.', 'b'));
  const playbill = [
    'cccccccc',
    'crrrrrrc',
    'cccccccc',
    'ckkkkkkc',
    'ckkkkkkc',
    'cccccccc',
    'ck.kk.kc',
    'cccccccc',
    'ckk.kkkc',
    'cccccccc',
    'ck.kkk.c',
    'cccccccc',
    'crrrrrrc',
  ].map((r) => r.replace(/\./g, 'c'));
  const melodrama = [
    'rrrrrrrrrrrr',
    'rwwwwwwwwwwr',
    'rrrrrrrrrrrr',
    'rrrkkkrrrrrr',
    'rrkkkkkrrrrr',
    'rrrsssrrrppr',
    'rrrkkkrrppppr',
    'rrkkkkkrrpprr',
    'rrkkkkkrppppr',
    'rrrkrkrrppppr',
    'rrrrrrrrrrrrr',
    'rkkkkkkkkkkr',
  ].map((r) => r.slice(0, 12));
  const music = [
    'gggggggggggg',
    'gyyyyyyyyyyg',
    'gggggggggggg',
    'ggggsssggggg',
    'gggpppppgggg',
    'ggpppppppggg',
    'gggpppppgggg',
    'ggpppppppggg',
    'gpppppppppgg',
    'gggggggggggg',
    'gwwwwwwwwwwg',
    'gggggggggggg',
  ];
  const L = {
    y: 0xe8c040,
    r: 0xb02020,
    w: C.white,
    o: 0xd88a2a,
    k: C.ink,
    b: 0x1e2a5a,
    c: P.cream,
    s: C.skinPale,
    p: 0xd86a9a,
    g: 0x2e6a3a,
  };
  pix(m, circus, L, 'xy', 1, 34, 3);
  pix(m, playbill, L, 'xy', 9, 34, 3);
  pix(m, magic, L, 'xy', 17, 34, 3);
  pix(m, melodrama, L, 'xy', 1, 21, 3);
  pix(m, music, L, 'xy', 13, 21, 3);
  // dos : avis de vente aux enchères et réclame de savon
  pix(m, playbill, L, 'xy', 2, 33, 1);
  pix(m, music, L, 'xy', 12, 33, 1);
  pix(m, circus, L, 'xy', 4, 20, 1);
  pix(m, magic, L, 'xy', 14, 20, 1);
  m.setOrigin(13, 0, 2.5);
  return m;
}
