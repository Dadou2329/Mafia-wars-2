// Mobilier victorien : sièges, tables, lits, rangements, pianos.
// Résolution 1/16 m, origine au centre de la base, l'avant regarde vers +Z.

import { C, P, SLOT, VoxelModel, shade, mix, grain, grainBox, blockJitter, colors, line6, hash3, books, turnedLeg, framePanel, drawer } from './helpers';


// ---------------------------------------------------------------------------------------
// Sièges

/** Tabouret de pub (et tabouret de bar plus haut, assise de cuir cloutée). */
export function stool(variant = 0, bar = false): VoxelModel {
  const s = bar ? 7 : 7;
  const h = bar ? 13 : 12;
  const m = new VoxelModel(s, h, s);
  const wood = [C.oak, C.walnut, C.pineDark][variant % 3];
  const c = s / 2;
  // pieds légèrement écartés
  for (const [x, z] of [
    [1, 1],
    [5, 1],
    [1, 5],
    [5, 5],
  ]) {
    m.box(x, 2, z, x + 1, h - 2, z + 1, wood);
    m.box(x + (x < 3 ? -1 : 1), 0, z + (z < 3 ? -1 : 1), x + (x < 3 ? 0 : 2), 2, z + (z < 3 ? 0 : 2), wood);
  }
  // barreaux
  if (bar) {
    m.box(1, 4, 0, 6, 5, 7, -1);
    for (let x = 0; x < 7; x++) for (let z = 0; z < 7; z++) if ((x === 0 || x === 6 || z === 0 || z === 6) && !((x === 0 || x === 6) && (z === 0 || z === 6))) m.set(x, 4, z, C.brass);
    m.box(1, 4, 1, 2, 5, 2, C.brass).box(5, 4, 1, 6, 5, 2, C.brass).box(1, 4, 5, 2, 5, 6, C.brass).box(5, 4, 5, 6, 5, 6, C.brass);
  } else {
    m.box(1, 3, 1, 6, 4, 2, shade(wood, 0.85)).box(1, 3, 5, 6, 4, 6, shade(wood, 0.85));
    m.box(1, 5, 1, 2, 6, 6, shade(wood, 0.85)).box(5, 5, 1, 6, 6, 6, shade(wood, 0.85));
  }
  // assise ronde
  m.cylY(c, c, 3.4, h - 2, h - 1, shade(wood, 0.9));
  if (bar) {
    m.cylY(c, c, 3.4, h - 1, h, C.leatherRed);
    m.cylY(c, c, 2.4, h - 1, h, shade(C.leatherRed, 1.15));
    for (const [x, z] of [
      [0, 3],
      [6, 3],
      [3, 0],
      [3, 6],
    ])
      m.set(x, h - 2, z, C.brass);
  } else {
    m.cylY(c, c, 3.4, h - 1, h, wood);
    m.cylY(c, c, 2.2, h - 1, h, shade(wood, 1.12));
  }
  m.setOrigin(c, 0, c);
  return m;
}

/** Fauteuil à oreilles (cuir capitonné ou velours). */
export function armchair(variant = 0): VoxelModel {
  const m = new VoxelModel(14, 17, 14);
  const v = variant % 3;
  const U = [C.leatherBrown, C.velvetRed, C.velvetGreen][v];
  const Ud = shade(U, 0.72);
  const Ul = shade(U, 1.15);
  const leg = C.walnutDark;
  for (const [x, z] of [
    [1, 1],
    [12, 1],
    [1, 12],
    [12, 12],
  ])
    m.box(x, 0, z, x + 1, 3, z + 1, leg);
  m.set(1, 1, 12, C.brass).set(12, 1, 12, C.brass);
  // assise et jupe
  m.box(1, 3, 1, 13, 7, 13, U);
  m.box(1, 3, 13, 13, 4, 14, Ud);
  m.box(3, 7, 3, 11, 9, 13, Ul);
  m.box(3, 8, 12, 11, 9, 13, U);
  // accoudoirs roulés
  for (const x0 of [0, 11]) {
    m.box(x0, 3, 3, x0 + 3, 10, 14, U);
    m.box(x0, 10, 3, x0 + 3, 12, 14, U);
    m.box(x0 + (x0 === 0 ? 0 : 2), 11, 3, x0 + (x0 === 0 ? 1 : 3), 12, 14, -1);
    // volute sur la face avant
    m.set(x0 + 1, 9, 14, Ud).set(x0 + 1, 10, 14, Ud);
    m.box(x0, 4, 13, x0 + 3, 9, 14, shade(U, 0.92));
  }
  // dossier haut et oreilles
  m.box(1, 3, 0, 13, 17, 3, U);
  m.box(1, 16, 0, 2, 17, 3, -1).box(12, 16, 0, 13, 17, 3, -1);
  for (const x0 of [0, 12]) {
    m.box(x0, 10, 1, x0 + 2, 16, 6, U);
    m.box(x0, 15, 4, x0 + 2, 16, 6, -1);
    m.box(x0, 10, 5, x0 + 2, 12, 6, -1);
  }
  // capitons du dossier
  for (let y = 9; y < 16; y += 2)
    for (let x = 3; x < 12; x += 2) if (((x + y) >> 1) % 2 === 0) m.set(x, y, 3, Ud);
  // clous de laiton (cuir)
  if (v === 0) for (let z = 4; z < 14; z += 2) m.set(0, 10, z, C.brass).set(13, 10, z, C.brass);
  m.setOrigin(7, 0, 7);
  return blockJitter(m, 0.04, 100 + v, 2, colors(U, Ul));
}

/** Canapé Chesterfield capitonné. */
export function chesterfield(variant = 0): VoxelModel {
  const m = new VoxelModel(32, 14, 15);
  const v = variant % 3;
  const U = [0x5a1a14, 0x1f3d2a, 0x6a3c20][v];
  const Ud = shade(U, 0.65);
  const Ul = shade(U, 1.18);
  for (const x of [1, 15, 29]) for (const z of [1, 12]) m.box(x, 0, z, x + 2, 2, z + 2, C.walnutDark);
  // socle
  m.box(0, 2, 0, 32, 7, 15, U);
  m.box(0, 2, 14, 32, 3, 15, Ud);
  // trois coussins d'assise
  for (const x0 of [3, 12, 21]) {
    m.box(x0, 7, 4, x0 + 8, 9, 15, Ul);
    m.box(x0, 7, 14, x0 + 8, 8, 15, U);
  }
  m.box(11, 7, 4, 12, 9, 15, Ud).box(20, 7, 4, 21, 9, 15, Ud);
  // dossier à boudin
  m.box(0, 7, 0, 32, 13, 4, U);
  m.box(0, 13, 1, 32, 14, 3, U);
  m.box(0, 12, 3, 32, 13, 4, Ul);
  // accoudoirs de même hauteur, roulés vers l'extérieur
  for (const x0 of [0, 29]) {
    m.box(x0, 7, 0, x0 + 3, 12, 15, U);
    m.box(x0, 12, 1, x0 + 3, 13, 15, U);
    const out = x0 === 0 ? 0 : 2;
    m.box(x0 + out, 12, 1, x0 + out + 1, 13, 15, Ul);
    // face avant de l'accoudoir avec volute et capitons
    m.box(x0, 7, 14, x0 + 3, 12, 15, shade(U, 0.92));
    m.set(x0 + 1, 10, 15, Ud).set(x0 + 1, 9, 15, Ud);
  }
  // capitonnage en losanges (dossier, intérieur des accoudoirs)
  for (const y of [8, 10, 12])
    for (let x = 4; x < 28; x++) if (x % 4 === ((y / 2) % 2) * 2) m.set(x, y, 3, Ud);
  for (let z = 4; z < 14; z++) for (const y of [9, 11]) if ((z + y) % 4 === 0) m.set(2, y, z, Ud).set(29, y, z, Ud);
  // clous sur la face avant du socle
  for (let x = 1; x < 32; x += 2) m.set(x, 6, 15, C.brass);
  m.setOrigin(16, 0, 7.5);
  return blockJitter(m, 0.035, 110 + v, 2, colors(U, Ul));
}

// ---------------------------------------------------------------------------------------
// Tables

/** Table rectangulaire : nue, nappe vichy, ou nappe de dentelle avec service à thé. */
export function tableSquare(variant = 0): VoxelModel {
  const m = new VoxelModel(19, 14, 14);
  const v = variant % 3;
  const wood = [C.oak, C.walnut, C.mahogany][v];
  for (const [x, z] of [
    [2, 2],
    [16, 2],
    [2, 11],
    [16, 11],
  ])
    turnedLeg(m, x, z, 0, 11, wood, [3, 7]);
  m.box(2, 9, 2, 17, 11, 12, shade(wood, 0.85));
  m.box(1, 11, 1, 18, 12, 13, wood);
  grainBox(m, 1, 11, 1, 18, 12, 13, 'x', 0.07, 120 + v);
  if (v === 1) {
    // nappe à carreaux qui retombe
    const check = (x: number, z: number, y: number) => (((Math.floor(x / 2) + Math.floor(z / 2) + Math.floor(y / 2)) % 2 === 0 ? C.red : C.white));
    for (let x = 0; x < 19; x++)
      for (let z = 0; z < 14; z++) {
        const edge = x === 0 || x === 18 || z === 0 || z === 13;
        if (!edge) m.set(x, 12, z, check(x, z, 0));
        else for (let y = 9; y < 13; y++) m.set(x, y, z, check(x + 100, z + 100, y));
      }
    // miche de pain et couteau sur la planche
    m.box(6, 13, 5, 12, 14, 9, C.pine);
    m.box(7, 13, 6, 10, 14, 8, P.crustLight);
    m.box(10, 13, 7, 12, 14, 8, P.steelLight);
  } else if (v === 2) {
    // nappe de dentelle et service à thé
    m.box(0, 12, 0, 19, 13, 14, P.lace);
    for (let x = 0; x < 19; x += 2) m.set(x, 11, 13, P.lace).set(x, 11, 0, P.lace);
    for (let z = 0; z < 14; z += 2) m.set(18, 11, z, P.lace).set(0, 11, z, P.lace);
    m.box(8, 13, 6, 11, 16, 9, P.porcelain);
    m.box(9, 16, 7, 10, 17, 8, P.porcelain);
    m.box(8, 14, 6, 11, 15, 9, P.blueWare);
    m.set(11, 15, 7, P.porcelain).set(12, 16, 7, P.porcelain).set(7, 14, 7, P.porcelain).set(7, 15, 7, P.porcelain);
    for (const [x, z] of [
      [3, 3],
      [15, 10],
      [4, 10],
    ]) {
      m.box(x - 1, 13, z - 1, x + 2, 14, z + 2, P.porcelain);
      m.set(x, 14, z, P.blueWare);
    }
  } else {
    // chopes d'étain et assiette
    for (const [x, z] of [
      [4, 4],
      [13, 9],
    ]) {
      m.box(x, 12, z, x + 2, 15, z + 2, P.silverDark);
      m.set(x + 2, 13, z, P.silverDark);
    }
    m.box(9, 12, 4, 12, 13, 7, P.porcelain);
    m.set(10, 13, 5, C.bread);
  }
  m.setOrigin(9.5, 0, 7);
  return m;
}

/** Grande table de réfectoire en chêne à tréteaux. */
export function tableLong(variant = 0): VoxelModel {
  const m = new VoxelModel(40, 15, 17);
  const v = variant % 2;
  const wood = v === 0 ? C.oakDark : C.pine;
  const dark = shade(wood, 0.8);
  for (const x of [2, 19, 36]) {
    m.box(x, 0, 1, x + 2, 2, 16, dark);
    m.box(x, 2, 4, x + 2, 10, 13, wood);
    m.box(x, 4, 6, x + 2, 8, 11, -1);
    m.box(x, 10, 2, x + 2, 11, 15, dark);
  }
  m.box(2, 6, 7, 38, 7, 10, dark);
  m.box(0, 11, 0, 40, 13, 17, wood);
  for (let z = 4; z < 17; z += 4) m.box(0, 12, z, 40, 13, z + 1, shade(wood, 0.82));
  grainBox(m, 0, 11, 0, 40, 13, 17, 'x', 0.08, 130 + v);
  // objets
  if (v === 0) {
    for (const [x, z] of [
      [5, 3],
      [12, 12],
      [27, 4],
      [33, 11],
    ]) {
      m.box(x, 13, z, x + 2, 16, z + 2, P.silverDark);
      m.set(x + 2, 14, z, P.silverDark);
    }
    m.box(19, 13, 7, 22, 14, 10, C.brass);
    m.box(20, 14, 8, 21, 17, 9, P.candle);
    m.set(20, 17, 8, SLOT.GLOW);
  } else {
    for (const [x, z] of [
      [6, 3],
      [16, 11],
      [26, 3],
      [34, 11],
    ]) {
      m.box(x, 13, z, x + 3, 14, z + 3, P.porcelain);
      m.set(x + 1, 13, z + 1, C.bread);
    }
    m.box(18, 13, 7, 23, 15, 10, P.crustLight);
    m.box(18, 15, 8, 23, 16, 9, C.bread);
  }
  m.setOrigin(20, 0, 8.5);
  return m;
}

/** Table de salle à manger dressée : nappe blanche, couverts, chandeliers, surtout de fruits. */
export function tableDining(variant = 0): VoxelModel {
  const m = new VoxelModel(51, 19, 19);
  const cloth = 0xece7da;
  const wood = C.mahogany;
  for (const x of [2, 25, 48]) for (const z of [2, 16]) turnedLeg(m, x, z, 0, 9, wood, [2, 5]);
  m.box(0, 12, 0, 51, 13, 19, wood);
  // nappe tombante à liseré de dentelle
  m.box(0, 12, 0, 51, 13, 19, cloth);
  m.box(0, 9, 0, 51, 12, 1, cloth).box(0, 9, 18, 51, 12, 19, cloth);
  m.box(0, 9, 0, 1, 12, 19, cloth).box(50, 9, 0, 51, 12, 19, cloth);
  m.box(0, 9, 0, 51, 10, 1, P.lace).box(0, 9, 18, 51, 10, 19, P.lace);
  m.box(0, 9, 0, 1, 10, 19, P.lace).box(50, 9, 0, 51, 10, 19, P.lace);
  // chemin de table bordeaux
  m.box(4, 12, 8, 47, 13, 11, variant % 2 === 0 ? C.velvetRed : C.velvetGreen);
  // couverts : assiette à filet d'or, fourchette, couteau, verre
  for (let i = 0; i < 6; i++) {
    const x = 5 + i * 8;
    for (const [z, dir] of [
      [2, 1],
      [14, -1],
    ] as [number, number][]) {
      m.box(x - 1, 13, z, x + 2, 14, z + 3, P.porcelain);
      m.set(x, 13, z + 1, mix(P.porcelain, C.gold, 0.5));
      m.box(x - 2, 13, z, x - 1, 14, z + 3, C.silver);
      m.box(x + 2, 13, z, x + 3, 14, z + 3, C.silver);
      const gz = dir > 0 ? z + 4 : z - 2;
      m.box(x + 3, 13, gz, x + 4, 15, gz + 1, C.bottleClear);
      m.set(x - 1, 14, z + 1, C.red);
    }
  }
  // chandeliers d'argent
  for (const x of [12, 38]) {
    m.box(x - 1, 13, 8, x + 2, 14, 11, C.silver);
    m.box(x, 14, 9, x + 1, 17, 10, C.silver);
    m.box(x - 2, 16, 9, x + 3, 17, 10, C.silver);
    for (const dx of [-2, 0, 2]) {
      m.set(x + dx, 17, 9, P.candle);
      m.set(x + dx, 18, 9, SLOT.GLOW);
    }
  }
  // surtout de fruits
  m.box(23, 13, 8, 28, 14, 11, C.silver);
  m.box(24, 14, 8, 27, 15, 11, C.silver);
  m.box(24, 15, 8, 27, 16, 11, C.apple);
  m.set(25, 16, 9, P.grape).set(24, 15, 10, P.pear).set(26, 16, 10, C.orange);
  m.setOrigin(25.5, 0, 9.5);
  return m;
}

/** Bureau à caissons : sous-main de cuir, papiers, encrier, plume. Le rédacteur est côté -Z. */
export function desk(variant = 0): VoxelModel {
  const m = new VoxelModel(27, 16, 14);
  const v = variant % 2;
  const wood = v === 0 ? C.mahogany : C.oak;
  const lea = v === 0 ? C.leatherGreen : C.leatherRed;
  const dark = shade(wood, 0.8);
  // caissons
  m.box(1, 0, 1, 9, 12, 13, wood);
  m.box(18, 0, 1, 26, 12, 13, wood);
  m.box(1, 0, 1, 9, 1, 13, dark).box(18, 0, 1, 26, 1, 13, dark);
  m.box(9, 9, 2, 18, 12, 12, wood);
  // tiroirs côté rédacteur (-Z)
  for (const x0 of [1, 18])
    for (const y0 of [1, 4, 7]) {
      m.box(x0, y0, 1, x0 + 8, y0 + 3, 2, shade(wood, 1.07));
      m.box(x0, y0, 1, x0 + 8, y0 + 1, 2, shade(wood, 0.72));
      m.set(x0 + 3, y0 + 1, 0, C.brass).set(x0 + 4, y0 + 1, 0, C.brass);
    }
  m.box(10, 9, 1, 17, 11, 2, shade(wood, 1.07));
  m.set(13, 10, 0, C.brass);
  // façade visiteur (+Z) à panneaux
  for (const x0 of [1, 18]) framePanel(m, x0 + 1, 2, x0 + 7, 11, 13, shade(wood, 1.1));
  m.box(9, 9, 12, 18, 12, 13, dark);
  // plateau avec sous-main de cuir à filet doré
  m.box(0, 12, 0, 27, 13, 14, shade(wood, 1.05));
  m.box(2, 13, 2, 25, 14, 12, lea);
  for (let x = 3; x < 24; x++) m.set(x, 13, 3, C.gold).set(x, 13, 10, C.gold);
  for (let z = 3; z < 11; z++) m.set(3, 13, z, C.gold).set(23, 13, z, C.gold);
  grainBox(m, 0, 12, 0, 27, 13, 14, 'x', 0.06, 140 + v);
  // papiers, livre ouvert, encrier, plume, livres empilés
  m.box(8, 14, 4, 13, 15, 9, P.newsprint);
  m.box(9, 14, 5, 12, 15, 8, C.white);
  for (const z of [5, 7]) m.box(9, 14, z, 12, 15, z + 1, shade(C.ink, 1.6));
  m.box(14, 14, 5, 19, 15, 8, C.paper);
  m.set(16, 14, 6, C.ink).set(17, 14, 6, C.ink);
  m.box(20, 14, 4, 24, 15, 7, C.brass);
  m.box(21, 15, 5, 22, 16, 6, C.black);
  m.box(23, 15, 5, 24, 16, 6, C.bottleGreen);
  m.set(21, 16, 5, P.feather).set(21, 17, 4, P.feather).set(20, 18, 4, P.feather);
  m.box(2, 14, 3, 6, 15, 8, C.velvetRed);
  m.box(2, 15, 3, 6, 16, 8, C.leatherBrown);
  m.box(3, 16, 4, 6, 17, 7, C.navy);
  m.setOrigin(13.5, 0, 7);
  return m;
}

// ---------------------------------------------------------------------------------------
// Lits (tête de lit à -Z)

/** Patchwork déterministe. */
function patch(x: number, z: number, seed: number, pal: number[]): number {
  return pal[Math.floor(hash3(Math.floor(x / 3), 0, Math.floor(z / 3), seed) * pal.length)];
}

/** Lit : 0 fer forgé et patchwork, 1 acajou à couvre-lit blanc, 2 laiton et édredon bleu. */
export function bed(variant = 0): VoxelModel {
  const m = new VoxelModel(21, 19, 34);
  const v = variant % 3;
  const frame = [P.ironMid, C.mahogany, C.brass][v];
  const knobC = [C.brass, C.mahoganyDark, P.brassLight][v];
  // tête et pied de lit
  if (v === 1) {
    m.box(0, 0, 0, 21, 16, 2, frame);
    framePanel(m, 2, 6, 19, 15, 2, shade(frame, 1.2));
    m.box(3, 16, 0, 18, 17, 2, frame);
    m.box(6, 17, 0, 15, 18, 2, frame);
    m.box(9, 18, 0, 12, 19, 2, shade(frame, 1.2));
    m.box(0, 0, 32, 21, 10, 34, frame);
    framePanel(m, 2, 3, 19, 9, 34, shade(frame, 1.2));
    for (const x of [0, 20]) {
      m.box(x, 0, 0, x + 1, 17, 2, shade(frame, 0.85));
      m.box(x, 0, 32, x + 1, 11, 34, shade(frame, 0.85));
    }
  } else {
    for (const x of [0, 20]) {
      m.box(x, 0, 0, x + 1, 17, 1, frame);
      m.set(x, 17, 0, knobC).set(x, 18, 0, knobC);
      m.box(x, 0, 33, x + 1, 12, 34, frame);
      m.set(x, 12, 33, knobC);
    }
    m.box(0, 15, 0, 21, 16, 1, frame);
    m.box(0, 8, 0, 21, 9, 1, frame);
    for (let x = 2; x < 20; x += 2) m.box(x, 9, 0, x + 1, 15, 1, frame);
    // médaillon central
    m.box(9, 10, 0, 12, 14, 1, frame);
    m.set(10, 11, 0, knobC).set(10, 12, 0, knobC);
    m.box(0, 10, 33, 21, 11, 34, frame);
    m.box(0, 6, 33, 21, 7, 34, frame);
    for (let x = 2; x < 20; x += 2) m.box(x, 7, 33, x + 1, 10, 34, frame);
  }
  // sommier, matelas
  m.box(1, 4, 1, 20, 6, 33, v === 1 ? shade(frame, 0.85) : P.ironMid);
  m.box(1, 6, 2, 20, 9, 32, P.ticking);
  // oreillers
  for (const x0 of [2, 11]) {
    m.box(x0, 9, 2, x0 + 8, 11, 7, C.white);
    m.box(x0, 10, 2, x0 + 1, 11, 7, -1).box(x0 + 7, 10, 2, x0 + 8, 11, 7, -1);
  }
  // couverture : dessus + retombées
  const pal =
    v === 0
      ? [0xa83a30, 0x2e5a7a, 0xc8a050, 0x4a7a4a, 0xe8dcc0, 0x7a4a6a]
      : v === 1
        ? [P.lace, 0xf0ebe0]
        : [0x2a4a8a, 0xe8e4dc, 0x3a5a9a];
  for (let z = 8; z < 33; z++)
    for (let x = 0; x < 21; x++) {
      const c = v === 2 ? ((Math.floor(x / 2) + Math.floor(z / 2)) % 2 === 0 ? pal[0] : pal[1]) : patch(x, z, 150 + v, pal);
      if (x === 0 || x === 20) for (let y = 4; y < 9; y++) m.set(x, y, z, c);
      else m.set(x, 9, z, c);
    }
  for (let x = 0; x < 21; x++) for (let y = 4; y < 10; y++) m.set(x, y, 32, patch(x, 32 + y, 150 + v, pal));
  // drap rabattu
  m.box(1, 9, 8, 20, 10, 10, C.white);
  if (v === 1) {
    // couverture rouge pliée au pied
    m.box(1, 10, 26, 20, 11, 31, C.velvetRed);
    m.box(1, 10, 28, 20, 11, 29, shade(C.velvetRed, 0.8));
  }
  m.setOrigin(10.5, 0, 17);
  return m;
}

/** Lit de camp de pauvre : cadre de fer, paillasse rayée, couverture grise. */
export function bedPoor(variant = 0): VoxelModel {
  const m = new VoxelModel(14, 10, 31);
  const v = variant % 2;
  const frame = v === 0 ? P.ironMid : C.weathered;
  for (const x of [0, 13])
    for (const z of [0, 30]) m.box(x, 0, z, x + 1, z === 0 ? 10 : 8, z + 1, frame);
  m.box(0, 4, 0, 14, 5, 1, frame).box(0, 9, 0, 14, 10, 1, frame);
  m.box(0, 4, 30, 14, 5, 31, frame).box(0, 7, 30, 14, 8, 31, frame);
  if (v === 0) for (let x = 2; x < 13; x += 3) m.box(x, 5, 0, x + 1, 9, 1, frame);
  m.box(0, 4, 1, 1, 5, 30, frame).box(13, 4, 1, 14, 5, 30, frame);
  // paillasse rayée
  for (let x = 1; x < 13; x++) m.box(x, 5, 1, x + 1, 7, 30, x % 3 === 0 ? 0x8a9aaa : P.ticking);
  // oreiller plat
  m.box(2, 7, 1, 12, 8, 6, 0xd8d2c4);
  // couverture grise à bandes
  for (let z = 7; z < 30; z++)
    for (let x = 0; x < 14; x++) {
      const c = z === 9 || z === 27 ? P.woolDark : P.wool;
      if (x === 0 || x === 13) {
        m.set(x, 6, z, c).set(x, 5, z, c);
      } else m.set(x, 7, z, c);
    }
  blockJitter(m, 0.06, 160 + v, 3, colors(P.wool, P.woolDark));
  m.setOrigin(7, 0, 15.5);
  return m;
}

/** Lits superposés en bois avec échelle au pied (+Z). */
export function bunkBed(variant = 0): VoxelModel {
  const m = new VoxelModel(15, 30, 32);
  const wood = variant % 2 === 0 ? C.pineDark : C.oak;
  const blanket = variant % 2 === 0 ? P.wool : 0x6a4a3a;
  for (const x of [0, 13]) for (const z of [0, 30]) m.box(x, 0, z, x + 2, 30, z + 2, wood);
  for (const y0 of [3, 17]) {
    m.box(0, y0, 0, 15, y0 + 2, 2, wood).box(0, y0, 30, 15, y0 + 2, 32, wood);
    m.box(0, y0, 2, 2, y0 + 2, 30, wood).box(13, y0, 2, 15, y0 + 2, 30, wood);
    m.box(2, y0 + 1, 2, 13, y0 + 2, 30, shade(wood, 0.8));
    m.box(2, y0 + 2, 2, 13, y0 + 4, 30, P.ticking);
    m.box(3, y0 + 4, 2, 12, y0 + 5, 7, C.white);
    m.box(2, y0 + 4, 8, 13, y0 + 5, 30, blanket);
    m.box(2, y0 + 4, 8, 13, y0 + 5, 10, shade(blanket, 0.75));
    m.box(2, y0 + 2, 8, 3, y0 + 4, 30, blanket).box(12, y0 + 2, 8, 13, y0 + 4, 30, blanket);
  }
  // garde-corps du lit du haut et têtes
  m.box(0, 23, 0, 15, 24, 2, wood).box(0, 27, 0, 15, 28, 2, wood);
  m.box(13, 22, 2, 15, 24, 30, wood);
  m.box(0, 22, 2, 2, 24, 30, wood);
  // échelle au pied
  for (const x of [4, 10]) m.box(x, 0, 31, x + 1, 26, 32, wood);
  for (let y = 4; y < 26; y += 4) m.box(4, y, 31, 11, y + 1, 32, shade(wood, 1.1));
  grain(m, 'y', 0.06, 170 + variant, (c, x, y, z) => c === wood && (x < 2 || x >= 13) && (z < 2 || z >= 30));
  m.setOrigin(7.5, 0, 16);
  return m;
}

// ---------------------------------------------------------------------------------------
// Rangements

/** Armoire : 0 deux portes à panneaux, 1 trois portes avec miroir central. */
export function wardrobe(variant = 0): VoxelModel {
  const m = new VoxelModel(21, 35, 10);
  const v = variant % 2;
  const wood = v === 0 ? C.mahogany : C.walnut;
  const dark = shade(wood, 0.75);
  const light = shade(wood, 1.15);
  m.box(0, 0, 0, 21, 3, 10, dark);
  m.box(1, 3, 0, 20, 32, 9, wood);
  m.box(0, 32, 0, 21, 33, 10, dark);
  m.box(0, 33, 0, 21, 34, 10, wood);
  m.box(4, 34, 0, 17, 35, 9, wood);
  m.box(8, 34, 0, 13, 35, 9, light);
  // tiroir du bas
  drawer(m, 2, 3, 19, 6, 9, wood);
  if (v === 0) {
    for (const x0 of [1, 11]) {
      m.box(x0, 6, 9, x0 + 9, 31, 10, wood);
      framePanel(m, x0 + 1, 18, x0 + 8, 30, 9, light);
      framePanel(m, x0 + 1, 7, x0 + 8, 16, 9, light);
      m.box(x0 + 2, 19, 9, x0 + 7, 29, 10, shade(wood, 0.9));
      m.box(x0 + 2, 8, 9, x0 + 7, 15, 10, shade(wood, 0.9));
    }
    m.box(10, 6, 9, 11, 31, 10, dark);
    m.set(9, 18, 10, C.brass).set(12, 18, 10, C.brass);
  } else {
    for (const [x0, x1] of [
      [1, 7],
      [14, 20],
    ]) {
      m.box(x0, 6, 9, x1, 31, 10, wood);
      framePanel(m, x0 + 1, 8, x1 - 1, 29, 9, light);
    }
    m.box(7, 6, 9, 14, 31, 10, light);
    m.box(8, 8, 9, 13, 29, 10, SLOT.GLASS);
    m.box(7, 6, 9, 8, 31, 10, dark).box(13, 6, 9, 14, 31, 10, dark);
    m.set(6, 18, 10, C.brass).set(15, 18, 10, C.brass);
  }
  grain(m, 'y', 0.06, 180 + v, (c) => c === wood);
  m.setOrigin(10.5, 0, 5);
  return m;
}

/** Bibliothèque garnie de livres reliés. */
export function bookshelf(variant = 0): VoxelModel {
  const m = new VoxelModel(21, 38, 7);
  const v = variant % 3;
  const wood = [C.walnut, C.mahogany, C.oakDark][v];
  const dark = shade(wood, 0.72);
  m.box(0, 0, 0, 21, 38, 1, dark);
  m.box(0, 0, 0, 1, 38, 7, wood).box(20, 0, 0, 21, 38, 7, wood);
  m.box(0, 0, 0, 21, 2, 7, wood);
  m.box(0, 0, 6, 21, 1, 7, dark);
  m.box(0, 36, 0, 21, 37, 7, wood);
  m.box(0, 37, 0, 21, 38, 7, shade(wood, 1.12));
  const pal = [0x6e1c1c, 0x1f3d2a, 0x1d2f52, 0x5a3220, 0x2a2420, 0x7a5a2a, 0x4a1a3a, 0x8a3a20, 0x24443a];
  const shelves = [2, 8, 14, 20, 26, 32];
  for (let i = 0; i < shelves.length; i++) {
    const y = shelves[i];
    m.box(1, y, 1, 20, y + 1, 7, shade(wood, 1.05));
    const top = i + 1 < shelves.length ? shelves[i + 1] : 36;
    books(m, 1, 20, y + 1, top - y - 1, 1, 7, 190 + v * 10 + i, pal, 0.05);
  }
  // un globe ou un bibelot sur une étagère
  m.box(14, 33, 1, 17, 36, 7, -1);
  m.box(14, 33, 2, 17, 34, 5, C.brass);
  m.box(15, 34, 3, 16, 36, 4, C.brass);
  m.setOrigin(10.5, 0, 3.5);
  return m;
}

/** Bas de buffet : 0 portes à panneaux et tiroirs, 1 vaisselier à assiettes, 2 chiffonnier à marbre. */
export function cabinet(variant = 0): VoxelModel {
  const m = new VoxelModel(18, 21, 8);
  const v = variant % 3;
  const wood = [C.mahogany, C.oak, C.walnut][v];
  const dark = shade(wood, 0.75);
  m.box(0, 0, 0, 18, 2, 8, dark);
  m.box(1, 2, 0, 17, 15, 7, wood);
  m.box(0, 15, 0, 18, 16, 8, v === 2 ? C.marble : shade(wood, 1.08));
  if (v === 2) for (let x = 1; x < 17; x += 3) m.set(x, 15, 7, P.marbleVein);
  drawer(m, 1, 12, 9, 15, 7, wood);
  drawer(m, 9, 12, 17, 15, 7, wood);
  if (v === 1) {
    // étagère ouverte avec assiettes de faïence bleue
    m.box(2, 3, 5, 16, 12, 7, -1);
    m.box(2, 7, 5, 16, 8, 7, wood);
    for (const y of [3, 8])
      for (let x = 3; x < 16; x += 3) {
        m.box(x, y, 5, x + 2, y + 3, 6, P.porcelain);
        m.set(x, y + 1, 5, P.blueWare).set(x + 1, y + 2, 5, P.blueWare);
      }
  } else {
    for (const x0 of [1, 9]) {
      m.box(x0, 2, 7, x0 + 8, 12, 8, wood);
      framePanel(m, x0 + 1, 3, x0 + 7, 11, 7, shade(wood, 1.15));
    }
    m.set(8, 7, 8, C.brass).set(9, 7, 8, C.brass);
  }
  // objets posés dessus
  if (v === 0) {
    m.box(3, 16, 3, 6, 19, 6, P.blueWare);
    m.box(4, 19, 4, 5, 20, 5, P.blueWare);
    m.set(4, 20, 4, 0xc02030).set(3, 20, 4, P.leaf).set(5, 21, 4, 0xe8c030);
    m.box(11, 16, 2, 16, 18, 5, C.walnutDark);
    m.box(12, 18, 2, 15, 20, 5, C.walnutDark);
    m.box(12, 17, 5, 15, 19, 6, C.white);
    m.set(13, 18, 6, C.ink);
  } else if (v === 2) {
    m.box(7, 16, 2, 11, 17, 5, C.silver);
    m.box(8, 17, 3, 10, 20, 4, C.bottleClear);
    m.box(8, 17, 3, 10, 18, 4, 0x7a2030);
  }
  grain(m, 'x', 0.06, 200 + v, (c) => c === wood);
  m.setOrigin(9, 0, 4);
  return m;
}

/** Meuble à tiroirs de fiches en chêne. */
export function filingCabinet(): VoxelModel {
  const m = new VoxelModel(10, 22, 10);
  const wood = C.oak;
  m.box(0, 0, 0, 10, 2, 10, shade(wood, 0.75));
  m.box(0, 2, 0, 10, 21, 9, wood);
  m.box(0, 21, 0, 10, 22, 10, shade(wood, 1.1));
  for (let r = 0; r < 6; r++)
    for (let c = 0; c < 2; c++) {
      const x0 = 1 + c * 4;
      const y0 = 3 + r * 3;
      m.box(x0, y0, 9, x0 + 4, y0 + 3, 10, shade(wood, 1.08 - ((r + c) % 2) * 0.04));
      m.box(x0, y0, 9, x0 + 4, y0 + 1, 10, shade(wood, 0.72));
      m.set(x0 + 1, y0 + 2, 9, C.brass).set(x0 + 2, y0 + 2, 9, C.paper);
      m.set(x0 + 1, y0 + 1, 9, C.brassDark).set(x0 + 2, y0 + 1, 9, C.brassDark);
    }
  m.box(9, 3, 9, 10, 21, 10, shade(wood, 0.8));
  m.setOrigin(5, 0, 5);
  return m;
}

/** Desserte d'acajou avec service à thé en argent. */
export function sideboard(): VoxelModel {
  const m = new VoxelModel(27, 16, 8);
  const wood = C.mahogany;
  const dark = shade(wood, 0.72);
  const light = shade(wood, 1.18);
  for (const x of [0, 26]) m.box(x, 0, 0, x + 1, 2, 8, dark);
  m.box(0, 0, 6, 27, 2, 7, dark);
  m.box(1, 2, 0, 26, 12, 7, wood);
  m.box(0, 12, 0, 27, 13, 8, light);
  // galerie arrière sculptée
  m.box(0, 13, 0, 27, 15, 1, wood);
  m.box(9, 15, 0, 18, 16, 1, wood);
  m.set(13, 16, 0, light);
  // portes latérales, tiroirs et panneau central
  for (const x0 of [1, 19]) {
    m.box(x0, 2, 7, x0 + 7, 11, 8, wood);
    framePanel(m, x0 + 1, 3, x0 + 6, 10, 7, light);
    m.set(x0 + (x0 < 10 ? 6 : 0), 7, 8, C.brass);
  }
  drawer(m, 9, 9, 18, 12, 7, wood);
  drawer(m, 9, 5, 18, 8, 7, wood);
  m.box(9, 2, 7, 18, 4, 8, dark);
  // plateau d'argent, théière, sucrier, pot à lait
  const S = C.silver;
  const Sd = P.silverDark;
  m.box(6, 13, 2, 21, 14, 7, Sd);
  m.box(7, 13, 3, 20, 14, 6, S);
  m.box(11, 14, 3, 15, 17, 6, S);
  m.box(12, 17, 4, 14, 18, 5, S);
  m.set(13, 18, 4, Sd);
  m.set(15, 15, 4, S).set(16, 16, 4, S).set(17, 17, 4, S);
  m.box(10, 15, 4, 11, 17, 5, Sd);
  m.box(17, 14, 4, 19, 16, 6, S);
  m.set(17, 16, 4, Sd);
  m.box(8, 14, 3, 10, 16, 5, S);
  m.set(7, 15, 3, S);
  // carafe
  m.box(2, 13, 2, 4, 16, 4, C.bottleClear);
  m.box(2, 13, 2, 4, 14, 4, 0x8a3a1a);
  m.set(2, 16, 2, C.bottleClear).set(2, 17, 2, C.silver);
  grain(m, 'x', 0.06, 210, (c) => c === wood);
  m.setOrigin(13.5, 0, 4);
  return m;
}

// ---------------------------------------------------------------------------------------
// Pianos

/** Piano droit (clavier vers +Z). */
export function piano(variant = 0): VoxelModel {
  const m = new VoxelModel(25, 22, 10);
  const v = variant % 2;
  const wood = v === 0 ? C.walnut : P.rosewood;
  const dark = shade(wood, 0.72);
  const light = shade(wood, 1.2);
  m.box(0, 0, 0, 25, 21, 7, wood);
  m.box(0, 21, 0, 25, 22, 8, light);
  m.box(0, 0, 6, 25, 2, 7, dark);
  // panneau de façade ajouré sur soie plissée
  m.box(2, 13, 6, 23, 20, 7, light);
  for (let x = 3; x < 22; x++) for (let y = 14; y < 19; y++) m.set(x, y, 6, (x + y) % 3 === 0 ? light : x % 2 ? 0x8a2a2a : 0x6a1a1a);
  // bougeoirs de laiton
  for (const x of [3, 21]) {
    m.box(x, 15, 7, x + 1, 16, 9, C.brass);
    m.box(x, 16, 8, x + 1, 18, 9, P.candle);
  }
  // pupitre et partition
  m.box(7, 13, 7, 18, 14, 8, wood);
  m.box(8, 14, 7, 17, 18, 8, C.white);
  for (const y of [15, 17]) for (let x = 9; x < 16; x++) if ((x + y) % 3 !== 0) m.set(x, y, 7, shade(C.ink, 2.2));
  // clavier
  m.box(0, 10, 7, 25, 11, 10, wood);
  m.box(0, 10, 7, 2, 13, 10, wood).box(23, 10, 7, 25, 13, 10, wood);
  m.box(2, 11, 7, 23, 13, 8, dark);
  for (let x = 2; x < 23; x++) {
    m.box(x, 11, 8, x + 1, 12, 10, 0xf0ead8);
    const k = (x - 2) % 7;
    if (k === 0 || k === 1 || k === 3 || k === 4 || k === 5) m.box(x, 12, 8, x + 1, 13, 9, C.black);
  }
  // colonnes sous le clavier, pédales
  for (const x of [1, 23]) {
    m.box(x, 2, 8, x + 1, 10, 9, wood);
    m.set(x, 6, 8, light).set(x, 9, 8, light);
  }
  m.box(10, 1, 7, 11, 2, 9, C.brass).box(14, 1, 7, 15, 2, 9, C.brass);
  m.box(2, 3, 6, 23, 9, 7, shade(wood, 0.9));
  framePanel(m, 3, 3, 22, 9, 7, light);
  grain(m, 'x', 0.05, 220 + v, (c) => c === wood);
  m.setOrigin(12.5, 0, 5);
  return m;
}

/** Piano à queue au couvercle entrouvert (clavier vers +Z, queue vers -Z). */
export function grandPiano(variant = 0): VoxelModel {
  const m = new VoxelModel(24, 27, 34);
  const v = variant % 2;
  const wood = v === 0 ? P.rosewood : 0x1d1917;
  const light = v === 0 ? shade(wood, 1.35) : 0x3a3430;
  // silhouette de la caisse : côté gauche droit, côté droit en S vers la queue
  const right = (z: number) => {
    if (z >= 22) return 24;
    const t = z / 22;
    return 9 + 15 * Math.pow(t, 0.62);
  };
  const inCase = (x: number, z: number) => {
    if (z < 0 || z >= 28) return false;
    if (x + 0.5 > right(z)) return false;
    // queue arrondie
    if (z < 4) {
      const cxq = 5.5;
      return Math.hypot((x + 0.5 - cxq) / 5.5, (z + 0.5 - 4) / 4) <= 1;
    }
    return x >= 0;
  };
  for (let x = 0; x < 24; x++)
    for (let z = 0; z < 28; z++) {
      if (!inCase(x, z)) continue;
      const edge = !inCase(x - 1, z) || !inCase(x + 1, z) || !inCase(x, z - 1) || !inCase(x, z + 1);
      if (edge) m.box(x, 9, z, x + 1, 15, z + 1, wood);
      else {
        m.box(x, 9, z, x + 1, 10, z + 1, wood);
        // table d'harmonie, cadre doré, cordes
        const frameC = (x + z) % 9 === 0 || z === 24 || x === 2 ? C.gold : (x % 2 === 0 ? C.brass : 0xd8c098);
        m.set(x, 12, z, z > 22 ? C.gold : frameC);
      }
    }
  // clavier en saillie à l'avant
  m.box(0, 11, 28, 24, 12, 33, wood);
  m.box(0, 11, 28, 2, 14, 33, wood).box(22, 11, 28, 24, 14, 33, wood);
  for (let x = 2; x < 22; x++) {
    m.box(x, 12, 29, x + 1, 13, 33, 0xf0ead8);
    const k = (x - 2) % 7;
    if (k === 0 || k === 1 || k === 3 || k === 4 || k === 5) m.box(x, 13, 29, x + 1, 14, 31, C.black);
  }
  m.box(2, 12, 28, 22, 15, 29, wood);
  // pupitre et partition
  m.box(6, 15, 26, 18, 16, 28, wood);
  m.box(7, 16, 27, 17, 19, 28, C.white);
  for (const y of [17, 18]) for (let x = 8; x < 16; x++) if ((x * 3 + y) % 4 !== 0) m.set(x, y, 27, shade(C.ink, 2.2));
  // pieds tournés et lyre des pédales
  for (const [x, z] of [
    [1, 25],
    [21, 25],
    [6, 3],
  ]) {
    m.box(x, 0, z, x + 2, 9, z + 2, wood);
    m.box(x - 0.5, 0, z - 0.5, x + 2.5, 1, z + 2.5, C.brass);
    m.box(x, 5, z, x + 2, 6, z + 2, light);
  }
  m.box(10, 1, 22, 14, 9, 23, wood);
  m.box(11, 2, 22, 13, 8, 23, -1);
  m.box(10, 1, 23, 14, 2, 25, C.brass);
  // couvercle ouvert (charnière côté gauche -X, béquille côté droit)
  const lift = 0.47;
  for (let x = 0; x < 24; x++)
    for (let z = 0; z < 28; z++) {
      if (!inCase(x, z) || z > 25) continue;
      const y = 15 + Math.floor(x * lift);
      m.set(x, y, z, z === 25 || !inCase(x + 1, z) || !inCase(x, z - 1) ? light : wood);
    }
  line6(m, 18, 12, 14, 18, 15 + Math.floor(18 * lift) - 1, 14, light);
  m.setOrigin(12, 0, 17);
  return m;
}

