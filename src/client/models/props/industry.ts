// Ateliers, manufactures et commerces de bouche : machine à coudre, métiers à tisser, enclume,
// établi, crochets de boucher, étagère du boulanger.
// Résolution 1/16 m, origine au centre de la base, l'avant regarde vers +Z.

import { C, P, VoxelModel, shade, grainBox, line6, wheel, hash3, rng, rotate180 } from './helpers';

const I = C.iron;
const IH = C.ironHi;

// ---------------------------------------------------------------------------------------
// Machine à coudre à pédale (type Singer, tête noire à décors dorés).
// Comme un bureau : la couturière est assise côté -Z (le côté +Z est la « face visiteur »).

export function sewingTable(): VoxelModel {
  const m = new VoxelModel(16, 18, 10);
  // flancs de fonte ajourés
  for (const x of [0, 15]) {
    m.box(x, 0, 1, x + 1, 11, 9, I);
    for (let y = 2; y < 10; y++) for (let z = 2; z < 8; z++) if ((y + z) % 2 === 0 && !(y === 6)) m.clear(x, y, z);
    m.box(x, 0, 0, x + 1, 1, 10, I);
  }
  // pédale treillissée
  for (let x = 2; x < 14; x++) for (let z = 3; z < 8; z++) if ((x + z) % 2 === 0 || z === 3 || z === 7) m.set(x, 1, z, IH);
  m.box(1, 2, 4, 15, 3, 5, I);
  // volant côté droit et bielle
  wheel(m, 'x', 6, 4.5, 13, 14, 3.6, { spokes: 5, wood: I, hub: IH, hubR: 0.9 });
  line6(m, 13, 2, 4, 13, 6, 4, IH);
  // plateau de bois et tiroir
  m.box(0, 11, 0, 16, 12, 10, C.walnut);
  m.box(1, 10, 9, 8, 11, 10, shade(C.walnut, 1.1));
  m.set(4, 10, 10 - 1, C.brass);
  // tête de machine
  const B = 0x141416;
  m.box(2, 12, 2, 13, 13, 8, B);
  m.box(10, 13, 3, 13, 17, 7, B);
  m.box(3, 15, 3, 13, 17, 6, B);
  m.box(2, 13, 3, 4, 17, 6, B);
  m.box(2, 17, 4, 4, 18, 5, P.steelLight);
  m.set(3, 13, 4, P.steelLight);
  for (const x of [5, 7, 9]) m.set(x, 16, 6, C.gold);
  m.set(11, 14, 7, C.gold).set(6, 15, 6, C.gold);
  // volant à main
  wheel(m, 'x', 15, 4.5, 13, 14, 2.2, { spokes: 4, wood: P.steelLight, hub: P.steel, hubR: 0.7 });
  // bobine de fil et étoffe sous l'aiguille
  m.box(8, 17, 4, 9, 18, 5, C.red);
  m.box(0, 12, 1, 5, 13, 9, 0x6a3a6a);
  for (let z = 1; z < 9; z += 2) m.set(0, 12, z, 0x8a5a8a).set(1, 12, z + 1, 0x8a5a8a);
  m.setOrigin(8, 0, 5);
  return rotate180(m);
}

// ---------------------------------------------------------------------------------------
// Métiers à tisser : 0 et 2 métiers mécaniques de fonte (Lancashire), 1 métier à bras en bois

export function loom(variant = 0): VoxelModel {
  const m = new VoxelModel(32, 30, 24);
  const v = variant % 3;
  const hand = v === 1;
  const F = hand ? C.oak : P.ironMid;
  const Fh = hand ? shade(C.oak, 1.15) : P.ironLight;
  const yarn = v === 2 ? 0xd8c8a8 : 0xeae4d4;
  const cloth = (x: number, z: number): number => {
    if (v === 0) return x % 6 < 2 ? 0x2a4a8a : 0xeae4d4;
    if (v === 1) return (Math.floor(x / 2) + Math.floor(z / 2)) % 2 ? 0x8a6a3a : 0xc8b07a;
    return (x % 4 < 2) !== (z % 4 < 2) ? 0xa82424 : 0x5a1414;
  };
  // bâti : flancs, traverses
  for (const x0 of [1, 29]) {
    for (const z of [2, 20]) m.box(x0, 0, z, x0 + 2, 22, z + 2, F);
    m.box(x0, 20, 2, x0 + 2, 22, 22, F);
    m.box(x0, 1, 2, x0 + 2, 3, 22, F);
    m.box(x0, 10, 4, x0 + 2, 11, 20, F);
  }
  m.box(1, 20, 2, 31, 22, 4, F);
  m.box(1, 2, 20, 31, 4, 22, F);
  // ensouple de chaîne (arrière) garnie de fils
  m.cylX(8, 5, 2.4, 3, 29, yarn);
  m.cylX(8, 5, 2.6, 3, 4, F).cylX(8, 5, 2.6, 28, 29, F);
  // nappe de chaîne : fils pairs vers le haut, impairs vers le bas (la foule)
  const sheet = (z0: number, y0: number, z1: number, y1: number, c: number) => {
    for (let z = z0; z <= z1; z++) {
      const y = Math.round(y0 + ((y1 - y0) * (z - z0)) / Math.max(1, z1 - z0));
      m.box(4, y, z, 28, y + 1, z + 1, c);
    }
  };
  sheet(6, 11, 7, 14, yarn);
  sheet(8, 14, 12, 16, yarn);
  sheet(13, 16, 15, 14, yarn);
  sheet(8, 13, 12, 12, shade(yarn, 0.82));
  sheet(13, 12, 15, 14, shade(yarn, 0.82));
  for (let x = 5; x < 28; x += 3) m.set(x, 15, 9, shade(yarn, 0.9));
  // lames (cadres de lisses)
  for (const z of [11, 13]) {
    m.box(3, 10, z, 29, 11, z + 1, Fh);
    m.box(3, 19, z, 29, 20, z + 1, Fh);
    m.box(3, 10, z, 4, 20, z + 1, Fh).box(28, 10, z, 29, 20, z + 1, Fh);
    for (let x = 6; x < 27; x += 4) m.set(x, z === 11 ? 17 : 15, z, P.steelLight);
  }
  m.box(14, 20, 11, 18, 22, 14, Fh);
  // battant avec peigne et boîtes à navette
  m.box(3, 11, 15, 29, 12, 17, hand ? shade(C.oak, 0.85) : C.oak);
  m.box(4, 13, 16, 28, 14, 17, P.steelLight);
  m.box(3, 15, 15, 29, 16, 17, hand ? shade(C.oak, 0.85) : C.oak);
  m.box(2, 12, 15, 5, 14, 17, F).box(27, 12, 15, 30, 14, 17, F);
  // navette dans la foule
  m.box(9, 14, 14, 13, 15, 15, C.walnut);
  m.set(8, 14, 14, P.steelLight).set(13, 14, 14, P.steelLight);
  // tissu : de la façure à la poitrinière puis à l'ensouple d'étoffe
  for (let x = 4; x < 28; x++) {
    for (let z = 16; z < 21; z++) m.set(x, 14, z, cloth(x, z));
    for (let y = 9; y < 14; y++) m.set(x, y, 21, cloth(x, 30 - y));
  }
  m.box(3, 14, 20, 29, 15, 22, Fh);
  m.cylX(8, 18, 2.2, 3, 29, cloth(0, 0));
  m.cylX(8, 18, 2.2, 4, 28, shade(cloth(3, 3), 0.95));
  if (!hand) {
    // poulie motrice et engrenage
    wheel(m, 'x', 13, 9, 30, 32, 5.5, { spokes: 6, wood: P.ironMid, tyre: P.ironLight, hub: P.ironLight, hubR: 1.2 });
    wheel(m, 'x', 7, 17, 0, 1, 3.4, { spokes: 4, wood: P.ironMid, tyre: P.ironLight, hub: P.ironLight, hubR: 0.9 });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      m.set(0, 7 + Math.sin(a) * 3.9 - 0.5, 17 + Math.cos(a) * 3.9 - 0.5, P.ironLight);
    }
    // courroie montant vers l'arbre de transmission
    m.box(31, 14, 8, 32, 30, 10, 0x3a2a1a);
  } else {
    // banc du tisserand
    m.box(6, 7, 22, 26, 8, 24, C.oak);
    m.box(7, 0, 22, 8, 7, 24, C.oak).box(24, 0, 22, 25, 7, 24, C.oak);
    // pédales
    for (let x = 12; x < 20; x += 3) m.box(x, 1, 8, x + 1, 2, 20, C.oakDark);
  }
  m.setOrigin(16, 0, 12);
  return m;
}

// ---------------------------------------------------------------------------------------
// Enclume sur billot

export function anvil(): VoxelModel {
  const m = new VoxelModel(11, 14, 6);
  // billot
  m.cylY(5.5, 3, 2.9, 0, 7, 0x5a3a20);
  m.cylY(5.5, 3, 2.2, 6, 7, 0x9a7a52);
  m.cylY(5.5, 3, 1.2, 6, 7, 0x8a6a42);
  m.forEach((x, y, z, c) => {
    if (c === 0x5a3a20 && (x + y * 2 + z) % 5 === 0) return 0x4a2e18;
  });
  // enclume (profil XY extrudé)
  const S = 0x3c4046;
  const Sl = 0x8a9098;
  m.box(2, 7, 1, 9, 8, 5, S);
  m.box(3, 8, 2, 8, 10, 4, S);
  m.box(1, 10, 1, 10, 12, 5, S);
  m.box(1, 12, 1, 10, 13, 5, Sl);
  m.box(0, 11, 2, 1, 12, 4, S);
  m.box(0, 12, 2, 1, 13, 4, Sl);
  m.set(9, 12, 3, 0x111111);
  // marteau posé et pinces
  m.box(6, 13, 0, 7, 14, 4, C.oak);
  m.box(5, 13, 4, 8, 14, 5, P.steel);
  line6(m, 9, 0, 5, 10, 7, 5, P.ironMid);
  line6(m, 10, 0, 5, 10, 7, 4, P.ironMid);
  m.setOrigin(5.5, 0, 3);
  return m;
}

// ---------------------------------------------------------------------------------------
// Établi de menuisier : étau de fer, outils, copeaux

export function workbench(variant = 0): VoxelModel {
  const m = new VoxelModel(34, 16, 14);
  const wood = variant % 2 === 0 ? C.oak : C.pineDark;
  const top = shade(wood, 1.12);
  for (const x of [1, 31]) for (const z of [1, 11]) m.box(x, 0, z, x + 2, 12, z + 2, wood);
  m.box(1, 3, 2, 33, 4, 12, shade(wood, 0.85));
  m.box(0, 12, 0, 34, 14, 13, top);
  m.box(0, 10, 12, 34, 12, 13, wood);
  grainBox(m, 0, 12, 0, 34, 14, 13, 'x', 0.08, 700 + variant);
  // étau parallèle à l'avant droit
  m.box(26, 9, 13, 32, 14, 14, I);
  m.box(26, 14, 12, 32, 15, 14, IH);
  m.box(28, 10, 13, 30, 11, 14, IH);
  m.box(24, 10, 13, 34, 11, 14, P.steelLight);
  // outils : marteau, scie, rabot, ciseaux, maillet, équerre, colle
  m.box(3, 14, 3, 9, 15, 4, C.walnut);
  m.box(8, 14, 2, 9, 15, 5, P.steel);
  m.box(11, 14, 7, 21, 15, 9, P.steelLight);
  m.box(20, 14, 7, 23, 16, 9, C.walnut);
  m.box(4, 14, 8, 9, 16, 11, C.oakDark);
  m.box(5, 16, 9, 7, 17, 10, C.walnut);
  m.set(8, 15, 9, P.steel);
  for (const z of [3, 5]) {
    m.box(13, 14, z, 17, 15, z + 1, C.walnut);
    m.box(17, 14, z, 19, 15, z + 1, P.steelLight);
  }
  m.box(23, 14, 2, 25, 16, 4, 0x9a7a52);
  m.box(25, 14, 3, 29, 15, 4, C.walnut);
  m.box(29, 14, 2, 30, 15, 6, P.steel);
  m.box(29, 14, 5, 33, 15, 6, P.steel);
  m.box(11, 14, 1, 13, 16, 3, 0x8a6a4a);
  m.set(11, 16, 1, 0xd8c890);
  // copeaux
  for (let i = 0; i < 18; i++) {
    const x = 2 + Math.floor(hash3(i, 1, 0, 70) * 22);
    const z = 1 + Math.floor(hash3(i, 2, 0, 70) * 11);
    if (m.get(x, 14, z) < 0) m.set(x, 14, z, i % 2 ? 0xe8d4a0 : 0xd8c08a);
  }
  for (let i = 0; i < 10; i++) m.set(4 + i * 2.5, 0, 6 + (i % 3), 0xe0c890);
  // planches et caisse à outils sur l'étagère basse
  m.box(3, 4, 3, 20, 5, 7, C.pine);
  m.box(4, 5, 4, 18, 6, 6, shade(C.pine, 0.9));
  m.box(22, 4, 4, 29, 8, 10, shade(wood, 0.9));
  m.box(23, 5, 5, 28, 8, 9, -1);
  m.box(25, 8, 6, 26, 9, 8, wood);
  m.setOrigin(17, 0, 6.5);
  return m;
}

// ---------------------------------------------------------------------------------------
// Crochets de boucher : 0 quartier de bœuf et jambons, 1 porc et volailles

export function meatRack(variant = 0): VoxelModel {
  const m = new VoxelModel(24, 35, 8);
  const v = variant % 2;
  // potence
  m.box(0, 0, 2, 2, 35, 5, P.ironMid);
  m.box(22, 0, 2, 24, 35, 5, P.ironMid);
  m.box(0, 32, 2, 24, 34, 5, P.ironMid);
  m.box(0, 0, 1, 3, 1, 7, P.ironMid).box(21, 0, 1, 24, 1, 7, P.ironMid);
  const hook = (x: number, y: number) => {
    m.set(x, 31, 3, P.steelLight).set(x, 30, 4, P.steelLight).set(x, 29, 3, P.steelLight);
    for (let yy = y; yy < 29; yy++) m.set(x, yy, 3, P.steel);
  };
  const meat = C.meat;
  const fat = C.fat;
  if (v === 0) {
    // quartier de bœuf : chair rouge, côtes nacrées, couverture de gras sur le dos
    hook(6, 28);
    for (let y = 6; y < 28; y++) {
      const w = y > 23 ? 2 + (27 - y) * 0.5 : y < 11 ? 2 + (y - 6) * 0.45 : 4.2 - Math.abs(y - 17) * 0.05;
      for (let x = Math.round(6 - w); x < Math.round(6 + w); x++)
        for (let z = 1; z < 7; z++) {
          if (Math.abs(z + 0.5 - 4) > 2.5) continue;
          const edge = x === Math.round(6 - w) || x === Math.round(6 + w) - 1;
          let c = meat;
          if (z === 1 || (edge && z < 4)) c = shade(fat, 0.95);
          else if (z === 6 && y > 12 && y < 24 && y % 3 === 0) c = fat;
          else if (hash3(x, y, z, 3) < 0.1) c = shade(meat, 0.8);
          else if (hash3(x, y, z, 4) < 0.06) c = shade(fat, 1.0);
          m.set(x, y, z, c);
        }
    }
    m.box(5, 4, 3, 7, 6, 5, P.porcelain);
    // jambons
    for (const x of [13, 18]) {
      hook(x, 27);
      m.box(x, 25, 3, x + 1, 28, 4, P.porcelain);
      m.ellipsoid(x + 0.5, 20, 3.5, 2.4, 5, 2.4, P.ham);
      m.ellipsoid(x + 0.5, 18.5, 3.5, 2.2, 3.5, 2.6, shade(P.ham, 0.85));
      m.set(x, 21, 6, fat).set(x + 1, 18, 6, fat);
    }
    // chapelet de saucisses
    hook(21, 28);
    for (let y = 8; y < 28; y++) m.set(20, y, 3, y % 3 === 0 ? P.hempDark : 0xa0503a);
  } else {
    // porc fendu
    hook(6, 29);
    for (let y = 5; y < 29; y++) {
      const w = y < 10 ? 2 + (y - 5) * 0.4 : y > 25 ? 2.5 : 3.5;
      for (let x = Math.round(6 - w); x < Math.round(6 + w); x++)
        for (let z = 2; z < 6; z++) m.set(x, y, z, z === 2 ? 0xc87a6a : (x + y) % 5 === 0 ? 0xf0d8c8 : 0xe8b8a8);
    }
    // volailles pendues par les pattes (oies, poulets) et faisans
    const bird = (x: number, skin: number, head: number, feathered: boolean) => {
      hook(x, 28);
      m.box(x, 26, 3, x + 1, 28, 4, C.orange);
      m.ellipsoid(x + 0.5, 21, 3.5, 1.8, 4, 1.8, skin);
      if (feathered) for (let y = 18; y < 25; y += 2) m.set(x - 1, y, 3, shade(skin, 0.75)).set(x + 2, y + 1, 3, shade(skin, 1.2));
      m.box(x, 14, 3, x + 1, 17, 4, feathered ? 0x2a5a3a : skin);
      m.set(x, 14, 3, head);
    };
    bird(12, 0xf0e0c8, C.orange, false);
    bird(16, 0xf0e0c8, C.orange, false);
    bird(20, 0x9a5a2a, 0xb02020, true);
  }
  m.setOrigin(12, 0, 4);
  return m;
}

// ---------------------------------------------------------------------------------------
// Étagère de boulanger

export function breadShelf(variant = 0): VoxelModel {
  const m = new VoxelModel(24, 30, 7);
  const wood = variant % 2 === 0 ? C.pine : C.oak;
  m.box(0, 0, 0, 24, 30, 1, shade(wood, 0.75));
  m.box(0, 0, 0, 1, 30, 7, wood).box(23, 0, 0, 24, 30, 7, wood);
  m.box(0, 28, 0, 24, 30, 7, wood);
  m.box(0, 29, 6, 24, 30, 7, shade(wood, 1.15));
  for (const y of [0, 7, 14, 21]) m.box(1, y, 1, 23, y + 1, 7, shade(wood, 1.08));
  const crust = [P.crustLight, C.bread, P.crust];
  const r = rng(800 + variant);
  // étage 1 : miches rondes et pains de campagne
  for (let x = 2; x < 22; x += 4) {
    const c = crust[Math.floor(r() * 2)];
    m.box(x, 1, 2, x + 3, 3, 5, c);
    m.box(x + 1, 3, 3, x + 2, 4, 4, c);
    if (x % 8 === 2) m.box(x, 3, 2, x + 3, 4, 5, shade(c, 1.05));
    m.set(x + 1, 3, 4, P.crust);
  }
  // étage 2 : pains longs entaillés et pains moulés
  for (let x = 2; x < 22; x += 5) {
    m.box(x, 8, 2, x + 4, 10, 5, C.bread);
    for (let k = 0; k < 4; k += 2) m.set(x + k, 10, 3, P.crust);
    m.box(x, 10, 2, x + 4, 11, 5, -1);
    m.box(x + 1, 10, 3, x + 3, 11, 5, P.crustLight);
  }
  // étage 3 : baguettes couchées et petits pains
  for (const z of [2, 4]) m.box(2, 15, z, 21, 16, z + 1, P.crustLight);
  for (let x = 2; x < 21; x += 3) m.set(x, 15, z0(x), P.crust);
  for (let x = 3; x < 21; x += 2) m.set(x, 16, 3, x % 4 === 1 ? C.bread : P.crustLight);
  // étage 4 : panier de baguettes debout, brioche tressée, gâteau glacé
  m.box(2, 22, 2, 7, 25, 6, P.straw);
  m.box(3, 23, 3, 6, 25, 5, -1);
  for (const [x, z] of [
    [3, 3],
    [4, 4],
    [5, 3],
    [4, 3],
  ])
    m.box(x, 23, z, x + 1, 28, z + 1, P.crustLight);
  for (let x = 9; x < 16; x++) m.box(x, 22, 3, x + 1, 24 + ((x % 2) as number), 5, x % 2 ? C.bread : P.crustLight);
  m.box(17, 22, 2, 22, 25, 6, C.white);
  m.box(17, 25, 3, 22, 26, 5, 0xe8a0b0);
  m.set(19, 26, 4, C.red);
  // farine
  m.forEach((x, y, z, c) => {
    if ((c === C.bread || c === P.crustLight) && m.get(x, y + 1, z) < 0 && hash3(x, y, z, 81) < 0.25) return 0xf0e8d8;
  });
  m.setOrigin(12, 0, 3.5);
  return m;
}
function z0(x: number): number {
  return x % 2 ? 2 : 4;
}

