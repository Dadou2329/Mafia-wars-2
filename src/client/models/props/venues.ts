// Accessoires des lieux : pub, casino, église, théâtre, commissariat, caserne, docks.
// Résolution 1/16 m, origine au centre de la base, l'avant regarde vers +Z.

import { C, P, SLOT, VoxelModel, shade, mix, grain, grainBox, blockJitter, colors, rbox, pix, line6, wheel, discXY, hash3, rng, framePanel, turnedLeg, text } from './helpers';

const I = C.iron;
const CHIPS = [0xb02020, 0xf0ece2, 0x1d3a8a, 0x161514, C.gold];

// ---------------------------------------------------------------------------------------
// Pub

/** Pompes à bière : quatre leviers à manche de porcelaine, plaques de brasseur, cols de cygne. */
export function beerTaps(): VoxelModel {
  const m = new VoxelModel(10, 9, 4);
  m.box(0, 0, 0, 10, 1, 4, C.mahogany);
  m.box(0, 1, 1, 10, 2, 4, C.brass);
  const clips = [0xb02020, 0x1d3a8a, 0x2e6a3a, 0xc8a040];
  [1, 3, 6, 8].forEach((x, i) => {
    m.set(x, 2, 2, C.brassDark);
    m.box(x, 3, 2, x + 1, 8, 3, i % 2 === 0 ? P.porcelain : C.walnutDark);
    m.set(x, 8, 2, C.brass);
    // plaque de brasseur côté client (+Z)
    m.set(x, 6, 3, clips[i]).set(x, 5, 3, shade(clips[i], 0.8));
    // col de cygne côté comptoir (-Z)
    m.set(x, 2, 1, C.brass).set(x, 3, 0, C.brass).set(x, 2, 0, C.brass);
  });
  // égouttoir
  for (let x = 0; x < 10; x++) if (x % 2 === 0) m.set(x, 1, 0, P.brassLight);
  m.setOrigin(5, 0, 2);
  return m;
}

/** Crachoir de laiton. */
export function spittoon(): VoxelModel {
  const m = new VoxelModel(5, 5, 5);
  const c = 2.5;
  m.cylY(c, c, 1.6, 0, 1, C.brassDark);
  m.cylY(c, c, 2.4, 1, 3, C.brass);
  m.cylY(c, c, 1.6, 3, 4, C.brass);
  m.cylY(c, c, 2.5, 4, 5, P.brassLight);
  m.cylY(c, c, 1.1, 2, 5, -1);
  m.set(2, 2, 2, 0x2a1a0a);
  m.setOrigin(2.5, 0, 2.5);
  return m;
}

// ---------------------------------------------------------------------------------------
// Casino

/** Table de jeu ronde à tapis vert : cartes distribuées, piles de jetons, pot central. */
export function cardTable(variant = 0): VoxelModel {
  const m = new VoxelModel(21, 15, 21);
  const c = 10.5;
  const wood = C.mahogany;
  // pied central à quatre griffes
  m.cylY(c, c, 1.6, 2, 11, wood);
  m.cylY(c, c, 2.2, 6, 7, shade(wood, 1.2));
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    for (let k = 1; k < 8; k++) m.box(c - 1 + dx * k, Math.max(0, 2 - k * 0.3), c - 1 + dz * k, c + 1 + dx * k, 2.5 - k * 0.25, c + 1 + dz * k, wood);
    m.box(c - 1 + dx * 8, 0, c - 1 + dz * 8, c + 1 + dx * 8, 1, c + 1 + dz * 8, C.brass);
  }
  // plateau, ceinture de cuir, tapis
  m.cylY(c, c, 10.4, 10, 11, shade(wood, 0.85));
  m.cylY(c, c, 10.4, 11, 13, C.leatherRed);
  m.cylY(c, c, 8.8, 12, 13, -1);
  m.cylY(c, c, 8.8, 11, 12, C.felt);
  // places : cartes et jetons
  const r = rng(500 + variant);
  const seats = 6;
  for (let i = 0; i < seats; i++) {
    const a = (i / seats) * Math.PI * 2 + 0.3;
    const px = c + Math.cos(a) * 6.5;
    const pz = c + Math.sin(a) * 6.5;
    // deux cartes
    m.set(px - 0.5, 12, pz - 0.5, C.white);
    m.set(px + 0.5, 12, pz - 0.5, r() < 0.5 ? C.white : 0x9a1a1a);
    // piles de jetons
    const cx2 = c + Math.cos(a) * 4.5;
    const cz2 = c + Math.sin(a) * 4.5;
    for (let k = 0; k < 2; k++) {
      const h = 1 + Math.floor(r() * 3);
      const col = CHIPS[Math.floor(r() * CHIPS.length)];
      for (let y = 0; y < h; y++) m.set(cx2 + k - 0.5, 12 + y, cz2, y % 2 ? shade(col, 0.85) : col);
    }
  }
  // pot central et paquet de cartes
  for (const [dx, dz, h, col] of [
    [0, 0, 3, CHIPS[0]],
    [1, 0, 2, CHIPS[2]],
    [0, 1, 4, CHIPS[1]],
    [-1, 0, 2, CHIPS[4]],
    [0, -1, 1, CHIPS[3]],
  ] as [number, number, number, number][])
    for (let y = 0; y < h; y++) m.set(c - 0.5 + dx, 12 + y, c - 0.5 + dz, y % 2 ? shade(col, 0.85) : col);
  m.box(c + 1.5, 12, c - 2.5, c + 3.5, 13, c - 0.5, 0x8a1a1a);
  if (variant % 2 === 1) {
    // verre de whisky et cendrier
    m.box(c - 4, 12, c + 2, c - 3, 14, c + 3, C.bottleClear);
    m.set(c - 4, 12, c + 2, 0xa0602a);
    m.box(c + 3, 12, c + 3, c + 5, 13, c + 5, C.silver);
    m.set(c + 4, 13, c + 4, 0x7a4a2a).set(c + 5, 13, c + 4, SLOT.GLOW);
  }
  m.setOrigin(c, 0, c);
  return m;
}

/** Table de roulette : cylindre à cases rouges et noires, tapis numéroté, râteau du croupier. */
export function roulette(): VoxelModel {
  const m = new VoxelModel(18, 17, 35);
  const wood = C.mahogany;
  for (const x of [1, 16]) for (const z of [1, 33]) turnedLeg(m, x, z, 0, 11, wood, [3, 8]);
  m.box(1, 9, 1, 17, 12, 34, shade(wood, 0.9));
  for (let z = 3; z < 32; z += 7) framePanel(m, 2, 9, 16, 12, 34, shade(wood, 1.15));
  m.box(0, 12, 0, 18, 13, 35, wood);
  m.box(0, 13, 0, 18, 14, 35, C.leatherBrown);
  m.box(1, 13, 1, 17, 14, 34, -1);
  m.box(1, 12, 1, 17, 13, 34, C.felt);
  // cylindre (côté -Z)
  const wc = 9;
  const wz = 8.5;
  for (let x = 0; x < 18; x++)
    for (let z = 0; z < 18; z++) {
      const d = Math.hypot(x + 0.5 - wc, z + 0.5 - wz);
      const a = Math.atan2(z + 0.5 - wz, x + 0.5 - wc);
      if (d <= 7.2 && d > 6.0) m.box(x, 12, z, x + 1, 15, z + 1, shade(wood, 1.15));
      else if (d <= 6.0 && d > 4.0) {
        const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 37);
        m.box(x, 12, z, x + 1, 14, z + 1, k === 0 ? 0x1e7a3a : k % 2 ? 0xb01e1e : 0x141414);
      } else if (d <= 4.0) {
        m.box(x, 12, z, x + 1, d < 2 ? 15 : 14, z + 1, d < 2 ? C.gold : shade(wood, 1.3));
      }
    }
  m.box(wc - 2, 15, wz - 0.5, wc + 2, 16, wz + 0.5, C.gold);
  m.box(wc - 0.5, 15, wz - 2, wc + 0.5, 16, wz + 2, C.gold);
  m.set(wc + 3.5, 14, wz + 2.5, C.white);
  // tapis de mise : zéro puis grille de numéros rouges/noires sur filets blancs
  const zz0 = 17;
  m.box(3, 12, zz0, 15, 13, zz0 + 2, 0x1e7a3a);
  for (let row = 0; row < 5; row++)
    for (let col = 0; col < 3; col++) {
      const z0 = zz0 + 3 + row * 3;
      const x0 = 3 + col * 4;
      const red = (row + col) % 2 === 0;
      m.box(x0, 12, z0, x0 + 3, 13, z0 + 2, red ? 0xb01e1e : 0x141414);
    }
  for (let z = zz0 - 1; z < zz0 + 18; z++) if ((z - zz0) % 3 === 2 || z === zz0 - 1) m.box(2, 12, z, 16, 13, z + 1, C.white);
  for (const x of [2, 6, 10, 14]) m.box(x, 12, zz0 - 1, x + 1, 13, zz0 + 17, C.white);
  // jetons misés et râteau
  for (const [x, z, h, col] of [
    [4, 21, 2, CHIPS[0]],
    [8, 27, 3, CHIPS[2]],
    [12, 24, 1, CHIPS[1]],
    [8, 30, 2, CHIPS[4]],
  ] as [number, number, number, number][])
    for (let y = 0; y < h; y++) m.set(x, 13 + y, z, y % 2 ? shade(col, 0.8) : col);
  line6(m, 15, 13, 32, 15, 13, 20, C.walnut);
  m.box(14, 13, 32, 17, 14, 33, C.walnut);
  m.setOrigin(9, 0, 17.5);
  return m;
}

/** Coffre-fort de fonte noire à filets dorés, cadran et poignée de laiton. */
export function safe(variant = 0): VoxelModel {
  const m = new VoxelModel(14, 20, 12);
  const body = variant % 2 === 0 ? 0x1c1c1e : 0x1d2e24;
  const panel = variant % 2 === 0 ? 0x2a1e18 : 0x2a3a2e;
  for (const x of [1, 12]) for (const z of [1, 9]) m.box(x, 0, z, x + 1, 1, z + 2, C.brass);
  rbox(m, 0, 1, 0, 14, 19, 11, body);
  m.box(1, 19, 1, 13, 20, 10, shade(body, 1.3));
  // porte
  m.box(1, 2, 11, 13, 18, 12, body);
  m.box(2, 3, 11, 12, 17, 12, panel);
  for (let x = 2; x < 12; x++) m.set(x, 3, 11, C.gold).set(x, 16, 11, C.gold);
  for (let y = 3; y < 17; y++) m.set(2, y, 11, C.gold).set(11, y, 11, C.gold);
  m.set(3, 4, 11, P.goldLight).set(10, 4, 11, P.goldLight).set(3, 15, 11, P.goldLight).set(10, 15, 11, P.goldLight);
  // cadran
  discXY(m, 7, 12, 2.2, 11, 12, (dx, dy, d) => (d > 1.4 ? C.brass : P.brassLight));
  m.set(6, 12, 11, C.black);
  // poignée, entrée de serrure, plaque du fabricant, gonds
  m.box(5, 7, 11, 9, 8, 12, C.brass);
  m.box(6, 6, 11, 8, 9, 12, C.brass);
  m.set(6, 7, 11, P.brassLight);
  m.set(10, 9, 11, C.gold).set(10, 8, 11, C.black);
  m.box(5, 17, 11, 9, 18, 12, C.gold);
  for (const y of [5, 14]) m.box(0, y, 10, 1, y + 2, 12, C.brass);
  m.setOrigin(7, 0, 6);
  return m;
}

/** Vitrine de bijoutier : meuble d'acajou, présentoir de velours, bijoux (dessus vitré invisible). */
export function displayCase(): VoxelModel {
  const m = new VoxelModel(21, 17, 10);
  const wood = C.mahogany;
  m.box(0, 0, 0, 21, 1, 10, shade(wood, 0.75));
  m.box(1, 1, 0, 20, 11, 9, wood);
  for (const x0 of [1, 8, 14]) framePanel(m, x0 + 1, 2, x0 + 6, 10, 9, shade(wood, 1.15));
  m.box(0, 10, 0, 21, 11, 10, shade(wood, 1.1));
  // cadre de laiton du dessus vitré
  for (const [x, z] of [
    [0, 0],
    [20, 0],
    [0, 9],
    [20, 9],
  ])
    m.box(x, 11, z, x + 1, 16, z + 1, C.brass);
  m.box(0, 16, 0, 21, 17, 1, C.brass).box(0, 16, 9, 21, 17, 10, C.brass);
  m.box(0, 16, 0, 1, 17, 10, C.brass).box(20, 16, 0, 21, 17, 10, C.brass);
  // vitres verticales avant et latérales (reflets), dessus ouvert
  m.box(1, 11, 9, 20, 16, 10, SLOT.GLASS);
  m.box(1, 11, 0, 20, 12, 9, 0x1d2a5a);
  m.box(1, 12, 1, 20, 13, 6, 0x1d2a5a);
  // bijoux : bagues, colliers de perles, broches, montre
  const gems = [0xc01830, 0x1a8a4a, 0x2040c0, 0xf0f0ff];
  for (let i = 0; i < 6; i++) {
    const x = 2 + i * 3;
    m.set(x, 12, 8, C.gold).set(x, 13, 8, gems[i % 4]);
  }
  for (let x = 3; x < 9; x++) m.set(x, 13, 2 + Math.round(Math.sin((x - 3) * 0.6) * 1.5 + 1.5), P.lace);
  for (let x = 12; x < 18; x++) m.set(x, 13, 2 + Math.round(Math.sin((x - 12) * 0.6) * 1.5 + 1.5), C.gold);
  m.set(15, 13, 4, 0xc01830);
  m.box(9, 12, 6, 11, 13, 8, C.gold);
  m.set(9, 13, 6, P.cream);
  m.set(10, 12, 3, C.silver).set(11, 12, 3, gems[2]);
  m.setOrigin(10.5, 0, 5);
  return m;
}

// ---------------------------------------------------------------------------------------
// Église

/** Banc d'église à joues sculptées, tablette à recueils de cantiques à l'arrière. */
export function pew(variant = 0): VoxelModel {
  const m = new VoxelModel(48, 16, 11);
  const wood = variant % 2 === 0 ? C.oakDark : C.walnut;
  const dark = shade(wood, 0.72);
  const light = shade(wood, 1.15);
  // joues
  for (const x0 of [0, 46]) {
    m.box(x0, 0, 0, x0 + 2, 13, 11, wood);
    m.box(x0, 13, 0, x0 + 2, 15, 6, wood);
    m.box(x0, 15, 1, x0 + 2, 16, 4, light);
    m.box(x0, 13, 6, x0 + 2, 14, 8, wood);
    // arc gothique en creux
    const face = x0 === 0 ? 0 : 47;
    for (let z = 2; z < 9; z++)
      for (let y = 2; y < 11; y++) {
        const inArch = y < 8 || Math.hypot(z + 0.5 - 5.5, (y - 8) * 1.3) < 3.5;
        if (inArch && z > 2 && z < 9) m.set(face, y, z, dark);
      }
  }
  // tablette arrière et recueils
  m.box(2, 11, 0, 46, 12, 2, light);
  for (let x = 4; x < 45; x += 7) {
    m.box(x, 12, 0, x + 2, 14, 1, (x / 7) % 2 < 1 ? 0x6e1c1c : 0x1a1a1e);
    m.set(x, 13, 0, C.gold);
  }
  // dossier, assise, bandeau avant
  m.box(2, 6, 2, 46, 15, 4, wood);
  m.box(2, 15, 2, 46, 16, 4, light);
  m.box(2, 6, 4, 46, 7, 11, wood);
  m.box(2, 7, 5, 46, 8, 10, light);
  m.box(2, 3, 10, 46, 6, 11, dark);
  grainBox(m, 2, 0, 0, 46, 16, 11, 'x', 0.06, 600 + variant);
  m.setOrigin(24, 0, 5.5);
  return m;
}

/** Autel : nappe blanche, antependium de velours brodé, croix, chandeliers allumés, missel. */
export function altar(variant = 0): VoxelModel {
  const m = new VoxelModel(32, 18, 14);
  const v = variant % 3;
  const front = [C.velvetRed, 0x4a1a5a, C.velvetGreen][v];
  const stone = P.portland;
  // marchepied et table
  m.box(0, 0, 0, 32, 1, 14, P.portlandDark);
  m.box(1, 1, 1, 31, 12, 12, stone);
  m.box(0, 12, 0, 32, 13, 13, C.marble);
  // nappe tombant sur les côtés et antependium devant
  m.box(0, 13, 0, 32, 14, 13, C.white);
  m.box(0, 9, 12, 32, 14, 13, C.white);
  for (let x = 0; x < 32; x += 2) m.set(x, 8, 12, P.lace);
  m.box(3, 1, 12, 29, 9, 13, front);
  for (let x = 3; x < 29; x++) m.set(x, 1, 13, C.gold);
  for (let x = 3; x < 29; x += 2) m.set(x, 0, 13, C.gold);
  for (let y = 2; y < 9; y++) m.set(3, y, 12, C.gold).set(28, y, 12, C.gold);
  // croix brodée et IHS
  m.box(15, 2, 13, 17, 8, 14, C.gold);
  m.box(13, 5, 13, 19, 6, 14, C.gold);
  for (const x of [7, 24]) {
    m.box(x, 4, 13, x + 2, 6, 14, C.gold);
    m.set(x, 5, 13, front);
  }
  // gradin, croix d'autel, chandeliers
  m.box(5, 14, 0, 27, 15, 4, stone);
  m.box(14, 15, 1, 18, 16, 3, C.brass);
  m.box(15, 16, 1, 17, 18, 3, C.brass);
  m.box(13, 17, 1, 19, 18, 3, C.brass);
  for (const x of [7, 11, 20, 24]) {
    m.box(x, 15, 1, x + 1, 16, 3, C.brass);
    m.box(x, 16, 1, x + 1, 17, 2, P.candle);
    m.set(x, 17, 1, SLOT.GLOW);
  }
  // missel sur pupitre
  m.box(22, 14, 8, 26, 15, 11, C.brass);
  m.box(22, 15, 8, 26, 16, 11, 0x6e1c1c);
  m.box(23, 15, 8, 25, 16, 11, C.white);
  m.setOrigin(16, 0, 7);
  return blockJitter(m, 0.04, 610 + v, 2, colors(stone, P.portlandDark));
}

/** Chaire à prêcher octogonale sur pied, escalier à rampe, pupitre et tombée de chaire. */
export function pulpit(): VoxelModel {
  const m = new VoxelModel(18, 29, 18);
  const wood = C.oakDark;
  const dark = shade(wood, 0.7);
  const light = shade(wood, 1.2);
  const cx = 9;
  const cz = 10;
  // pied
  const L = 5;
  m.box(5, 0, 6, 13, 2, 14, P.portlandDark);
  m.cylY(cx, cz, 2.2, 2, 9 + L, wood);
  m.cylY(cx, cz, 3.0, 4, 5, light);
  m.cylY(cx, cz, 3.0, 9, 10, light);
  m.coneY(cx, cz, 2.2, 6.0, 7 + L, 10 + L, wood);
  // cuve octogonale à panneaux gothiques
  const oct = (x: number, z: number, r: number) => {
    const dx = Math.abs(x + 0.5 - cx);
    const dz = Math.abs(z + 0.5 - cz);
    return dx <= r && dz <= r && dx + dz <= r * 1.42;
  };
  for (let x = 0; x < 18; x++)
    for (let z = 0; z < 18; z++) {
      if (!oct(x, z, 7)) continue;
      m.set(x, 10 + L, z, wood);
      if (!oct(x, z, 6)) {
        for (let y = 11 + L; y < 20 + L; y++) {
          const arch = y > 12 + L && y < 18 + L && (x + z) % 4 !== 0;
          m.set(x, y, z, arch ? dark : wood);
        }
        m.set(x, 20 + L, z, light);
      }
    }
  // entrée à l'arrière
  m.box(7, 11 + L, 3, 11, 20 + L, 5, -1);
  // escalier droit à l'arrière, rampe
  for (let i = 0; i < 7; i++) m.box(i * 1.5, 0, 0, 2 + i * 1.5, 2 + i * 2, 3, i % 2 ? wood : light);
  line6(m, 0, 8, 0, 10, 22, 0, dark);
  m.box(0, 0, 0, 1, 8, 1, dark);
  // pupitre incliné, Bible, tombée de chaire
  m.box(5, 20 + L, 14, 13, 21 + L, 17, light);
  m.box(6, 21 + L, 14, 12, 22 + L, 16, 0x161414);
  m.box(7, 21 + L, 14, 11, 22 + L, 16, C.white);
  m.box(6, 13 + L, 17, 12, 21 + L, 18, C.velvetRed);
  for (let x = 6; x < 12; x++) m.set(x, 13 + L, 17, C.gold);
  m.box(8, 16 + L, 17, 10, 20 + L, 18, C.gold);
  m.box(7, 18 + L, 17, 11, 19 + L, 18, C.gold);
  grain(m, 'y', 0.05, 620, (c) => c === wood);
  m.setOrigin(9, 0, 9);
  return m;
}

// ---------------------------------------------------------------------------------------
// Théâtre

/** Rangée de 4 fauteuils de théâtre en velours rouge (un strapontin relevé). */
export function seatRow(): VoxelModel {
  const m = new VoxelModel(38, 16, 10);
  const V = C.velvetRed;
  const Vd = shade(V, 0.72);
  const Vl = shade(V, 1.2);
  // montants de fonte et accoudoirs
  for (const x of [0, 9, 18, 28, 37]) {
    m.box(x, 0, 2, x + 1, 10, 9, I);
    m.box(x, 2, 3, x + 1, 8, 8, -1);
    m.set(x, 4, 5, I).set(x, 5, 5, C.gold).set(x, 6, 5, I);
    m.box(x, 10, 2, x + 1, 11, 9, C.walnut);
    m.box(x, 0, 1, x + 1, 1, 9, I);
  }
  const seats: [number, number][] = [
    [1, 9],
    [10, 18],
    [19, 28],
    [29, 37],
  ];
  seats.forEach(([x0, x1], i) => {
    // dossier
    m.box(x0, 6, 1, x1, 15, 3, V);
    m.box(x0, 15, 1, x1, 16, 3, C.walnut);
    m.box(x0 + 1, 8, 3, x1 - 1, 14, 4, Vl);
    m.set(Math.floor((x0 + x1) / 2), 14, 0, C.brass);
    // assise (la troisième relevée)
    if (i === 2) {
      m.box(x0, 6, 7, x1, 13, 9, V);
      m.box(x0, 6, 9, x1, 13, 10, Vd);
    } else {
      m.box(x0, 5, 3, x1, 7, 9, V);
      m.box(x0, 7, 4, x1, 8, 9, Vl);
      m.box(x0, 5, 9, x1, 7, 10, Vd);
    }
  });
  m.setOrigin(19, 0, 5);
  return blockJitter(m, 0.04, 630, 2, colors(V, Vl));
}

/** Guichet de théâtre : kiosque bordeaux à filets d'or, vitre à grille, lanternes, enseigne. */
export function ticketBooth(): VoxelModel {
  const m = new VoxelModel(26, 38, 22);
  const R = 0x5a1420;
  const Rd = shade(R, 0.7);
  const G = C.gold;
  m.box(0, 0, 0, 26, 2, 22, P.ironMid);
  m.box(1, 2, 1, 25, 30, 21, R);
  // pilastres et bandeaux dorés
  for (const [x, z] of [
    [1, 1],
    [24, 1],
    [1, 20],
    [24, 20],
  ])
    m.box(x, 2, z, x + 1, 30, z + 1, G);
  m.box(1, 11, 20, 25, 12, 21, G);
  m.box(1, 11, 1, 2, 12, 20, G).box(24, 11, 1, 25, 12, 20, G);
  // panneaux bas
  for (const x0 of [3, 10, 17]) framePanel(m, x0, 3, x0 + 6, 10, 21, Rd);
  // guichet vitré cintré avec grille de laiton
  for (let x = 5; x < 21; x++)
    for (let y = 13; y < 28; y++) {
      const top = 25 + Math.round(Math.cos(((x + 0.5 - 13) / 8) * (Math.PI / 2)) * 2.5);
      if (y > top) continue;
      m.set(x, y, 20, y < 15 ? 0x120c08 : SLOT.GLASS);
    }
  for (const x of [8, 13, 17]) m.box(x, 15, 21, x + 1, 26, 22, C.brass);
  m.box(5, 15, 21, 21, 16, 22, C.brass);
  m.box(4, 12, 21, 22, 13, 22, C.walnut);
  // corniche, toit à pans, enseigne TICKETS, fleuron
  m.box(0, 30, 0, 26, 31, 22, Rd);
  m.box(0, 31, 0, 26, 32, 22, G);
  m.box(2, 32, 2, 24, 33, 20, R);
  m.box(4, 33, 4, 22, 34, 18, Rd);
  m.box(7, 34, 7, 19, 35, 15, R);
  m.box(10, 35, 10, 16, 36, 12, Rd);
  m.box(12, 36, 10, 14, 38, 12, G);
  m.box(0, 32, 20, 26, 38, 22, R);
  m.box(0, 37, 20, 26, 38, 22, G);
  const w = text(m, 'TICKETS', 0, 0, 0, 0, true);
  text(m, 'TICKETS', Math.floor((26 - w) / 2), 36, 21, G);
  // lanternes de façade
  for (const x of [1, 24]) {
    m.box(x, 24, 21, x + 1, 25, 22, I);
    m.box(x, 25, 21, x + 1, 28, 22, SLOT.GLOW);
    m.box(x, 28, 21, x + 1, 29, 22, I);
  }
  // porte latérale (-X) et affiche (+X)
  m.box(0, 2, 6, 1, 24, 15, Rd);
  framePanel(m, 0, 4, 1, 22, 15, G);
  m.set(0, 13, 13, C.brass);
  for (let y = 14; y < 26; y++) for (let z = 6; z < 14; z++) m.set(25, y, z, (y === 24 || y === 23) ? 0xb02020 : (y % 3 === 0 && z % 2 === 0 ? C.ink : P.cream));
  m.setOrigin(13, 0, 11);
  return m;
}

/** Lourds rideaux de velours rouge, lambrequin à franges dorées, embrasses à glands. */
export function curtain(): VoxelModel {
  const m = new VoxelModel(32, 51, 3);
  const V = C.velvetRed;
  const shadeV = [shade(V, 0.62), shade(V, 0.85), shade(V, 1.12)];
  // tringle dorée
  m.box(0, 49, 1, 32, 50, 2, C.gold);
  m.box(0, 48, 1, 1, 51, 2, P.goldLight).box(31, 48, 1, 32, 51, 2, P.goldLight);
  // drapés : largeur variable (resserrée à l'embrasse), plis par colonnes
  const half = (y: number) => {
    if (y >= 46) return 12;
    if (y > 18) return 7 + Math.round(((y - 18) / 28) * 5);
    if (y > 14) return 7;
    return 7 + Math.round(((14 - y) / 14) * 3);
  };
  for (let y = 0; y < 48; y++) {
    const w = half(y);
    for (let i = 0; i < w; i++) {
      const front = Math.floor(i / 2) % 2 === 0;
      for (const x of [i, 31 - i]) {
        if (front) m.box(x, y, 1, x + 1, y + 1, 3, i === w - 1 ? shadeV[1] : shadeV[2]);
        else m.set(x, y, 0, shadeV[0]);
      }
    }
  }
  // lambrequin festonné
  for (let x = 0; x < 32; x++) {
    const drop = 3 + Math.round(Math.abs(Math.sin((x / 32) * Math.PI * 3)) * 3);
    for (let y = 48 - drop; y < 49; y++) m.set(x, y, 2, y === 48 - drop ? C.gold : V);
    if (x % 2 === 0) m.set(x, 48 - drop - 1, 2, P.goldLight);
  }
  for (const x of [5, 16, 26]) {
    m.box(x, 40, 2, x + 1, 42, 3, C.gold);
    m.set(x, 39, 2, P.goldLight);
  }
  // embrasses et glands
  for (const x0 of [0, 25]) {
    m.box(x0, 18, 2, x0 + 7, 19, 3, C.gold);
    const gx = x0 === 0 ? 6 : 25;
    m.box(gx, 14, 2, gx + 1, 18, 3, C.gold);
    m.box(gx - 0.5, 13, 2, gx + 1.5, 15, 3, P.goldLight);
  }
  m.setOrigin(16, 0, 1.6);
  return m;
}

// ---------------------------------------------------------------------------------------
// Commissariat et caserne

/** Haut comptoir de commissariat : panneaux, plaque POLICE, registre, sonnette, lanterne sourde. */
export function policeDesk(): VoxelModel {
  const m = new VoxelModel(35, 19, 13);
  const wood = C.walnut;
  const dark = shade(wood, 0.72);
  const light = shade(wood, 1.18);
  m.box(0, 0, 2, 35, 1, 13, dark);
  m.box(0, 1, 2, 35, 16, 12, wood);
  m.box(0, 16, 0, 35, 17, 13, light);
  // panneaux côté public (+Z)
  for (let x0 = 1; x0 < 33; x0 += 6) framePanel(m, x0, 2, x0 + 5, 8, 12, light);
  // plaque bleue POLICE
  m.box(5, 9, 12, 30, 15, 13, 0x1d2f6a);
  const w = text(m, 'POLICE', 0, 0, 0, 0, true);
  text(m, 'POLICE', Math.floor((35 - w) / 2), 14, 12, C.white);
  // casiers côté agent (-Z)
  m.box(1, 3, 2, 34, 15, 3, -1);
  for (let x = 1; x < 34; x += 4) m.box(x, 3, 2, x + 1, 15, 3, dark);
  for (const y of [7, 11]) m.box(1, y, 2, 34, y + 1, 3, dark);
  for (let x = 2; x < 33; x += 4) for (const y of [4, 8, 12]) if (hash3(x, y, 0, 3) < 0.6) m.box(x, y, 2, x + 2, y + 2, 3, C.paper);
  // registre ouvert, encrier, sonnette, lanterne sourde
  m.box(8, 17, 4, 18, 18, 10, 0x3a1a12);
  m.box(9, 17, 4, 17, 18, 9, P.newsprint);
  m.box(13, 17, 4, 13.5, 18, 9, shade(P.newsprint, 0.8));
  for (const z of [5, 7]) for (let x = 9; x < 17; x++) if (x !== 13 && (x + z) % 3 !== 0) m.set(x, 17, z, shade(C.ink, 1.8));
  m.box(20, 17, 6, 22, 18, 8, C.black);
  m.set(21, 18, 6, P.feather);
  m.box(25, 17, 8, 27, 18, 10, C.brass);
  m.set(25, 18, 8, P.brassLight);
  m.box(29, 17, 5, 32, 20, 8, I);
  m.box(30, 18, 8, 32, 19, 9, SLOT.GLOW);
  m.set(30, 20, 6, I);
  m.setOrigin(17.5, 0, 6.5);
  return grain(m, 'x', 0.05, 640, (c) => c === wood);
}

/** Grille de cellule à barreaux avec porte à serrure. */
export function cellBars(): VoxelModel {
  const m = new VoxelModel(32, 42, 2);
  const B = P.ironMid;
  m.box(0, 0, 0, 32, 1, 2, B);
  m.box(0, 40, 0, 32, 42, 2, B);
  for (let x = 1; x < 32; x += 3) m.box(x, 1, 0, x + 1, 40, 2, B);
  for (const y of [13, 27]) {
    m.box(0, y, 0, 32, y + 1, 2, B);
    for (let x = 0; x < 32; x += 3) m.set(x, y, 1, P.ironLight);
  }
  // porte : montants renforcés, traverse, serrure, gonds
  m.box(12, 1, 0, 14, 37, 2, I);
  m.box(24, 1, 0, 26, 37, 2, I);
  m.box(12, 36, 0, 26, 37, 2, I);
  m.box(21, 16, 0, 25, 21, 2, P.ironLight);
  m.box(22, 17, 1, 24, 20, 2, I);
  m.set(23, 18, 1, C.black);
  m.box(13, 4, 0, 14, 7, 2, P.ironLight);
  m.box(13, 31, 0, 14, 34, 2, P.ironLight);
  // rouille
  m.forEach((x, y, z, c) => {
    if (c === B && hash3(x, Math.floor(y / 3), z, 650) < 0.08) return mix(B, P.rust, 0.6);
  });
  m.setOrigin(16, 0, 1);
  return m;
}

/** Râtelier d'armes aux couleurs du propriétaire : fusils Martini-Henry, revolvers, sabre. */
export function weaponRack(): VoxelModel {
  const m = new VoxelModel(27, 32, 7);
  const wood = C.walnutDark;
  const T1 = SLOT.TINT1;
  const T2 = SLOT.TINT2;
  const T3 = SLOT.TINT3;
  m.box(0, 0, 0, 27, 32, 1, wood);
  m.box(0, 0, 0, 1, 32, 7, wood).box(26, 0, 0, 27, 32, 7, wood);
  m.box(0, 0, 0, 27, 3, 7, wood);
  m.box(1, 2, 1, 26, 3, 6, T3);
  // corniche aux couleurs : bandeau, filet, écusson
  m.box(0, 29, 0, 27, 32, 7, T1);
  m.box(0, 29, 6, 27, 30, 7, T2);
  m.box(0, 31, 6, 27, 32, 7, T2);
  m.box(11, 29, 6, 16, 32, 7, T3);
  m.set(13, 30, 6, T2).set(12, 30, 6, T2).set(14, 30, 6, T2);
  // panneau du fond peint
  m.box(1, 3, 0, 26, 29, 1, T3);
  // barre à encoches
  m.box(1, 22, 1, 19, 23, 5, T1);
  m.box(1, 22, 5, 19, 23, 6, T2);
  // fusils
  for (let i = 0; i < 6; i++) {
    const x = 2 + i * 3;
    m.box(x, 3, 2, x + 2, 7, 4, C.walnut);
    m.box(x, 7, 2, x + 1, 11, 4, C.walnut);
    m.box(x, 11, 3, x + 1, 13, 4, P.steel);
    m.box(x, 13, 3, x + 1, 22, 4, C.walnut);
    m.box(x, 22, 3, x + 1, 28, 4, P.steel);
    m.set(x, 28, 3, P.steelLight);
    m.set(x + 1, 12, 3, P.steel);
  }
  // revolvers accrochés et sabre
  for (const y of [9, 15, 21]) {
    pix(m, ['ssss.', '..ssw', '...ww'], { s: P.steel, w: C.walnut }, 'xy', 20, y + 2, 1);
    m.set(21, y + 2, 1, P.steelLight);
  }
  for (let y = 5; y < 28; y++) m.set(25, y, 1, P.steelLight);
  m.box(24, 5, 1, 26, 6, 2, C.brass);
  m.box(25, 3, 1, 26, 5, 2, C.brass);
  // boîte de cartouches au pied
  m.box(20, 3, 2, 25, 6, 6, C.oak);
  m.box(21, 6, 3, 24, 7, 5, C.brass);
  m.setOrigin(13.5, 0, 3.5);
  return m;
}

/** Caisse de munitions ouverte : cartouches de laiton, flèche du War Office, couvercle repoussé. */
export function ammoCrate(): VoxelModel {
  const m = new VoxelModel(14, 8, 9);
  const wood = 0x6a6a4a;
  m.box(0, 0, 0, 14, 7, 9, wood);
  m.box(1, 1, 1, 13, 7, 8, -1);
  m.box(0, 6, 0, 14, 7, 1, shade(wood, 1.15)).box(0, 6, 8, 14, 7, 9, shade(wood, 1.15));
  for (const x of [0, 13]) m.box(x, 0, 0, x + 1, 7, 9, shade(wood, 0.85));
  // cartouches debout : laiton et balles de plomb
  for (let x = 1; x < 13; x++)
    for (let z = 4; z < 8; z++) {
      m.box(x, 1, z, x + 1, 6, z + 1, C.brass);
      if ((x + z) % 2 === 0) m.set(x, 6, z, 0x8a8a90);
      else m.set(x, 5, z, P.brassLight);
    }
  // couvercle repoussé à l'arrière
  m.box(0, 7, 0, 14, 8, 4, shade(wood, 1.05));
  m.box(0, 7, 1, 14, 8, 2, shade(wood, 0.8));
  // flèche large du War Department, poignées de corde
  pix(m, ['..k..', '.kkk.', 'k.k.k', '..k..'], { k: C.ink }, 'xy', 4, 5, 9 - 1);
  m.set(9, 4, 8, C.ink).set(10, 4, 8, C.ink).set(9, 3, 8, C.ink);
  for (const x of [0, 13]) m.box(x, 3, 3, x + 1, 4, 6, P.hemp);
  m.setOrigin(7, 0, 4.5);
  return m;
}

/** Vitrine à trophées doublée de velours aux couleurs du propriétaire. */
export function trophyCase(): VoxelModel {
  const m = new VoxelModel(22, 32, 8);
  const wood = C.walnutDark;
  const T1 = SLOT.TINT1;
  const T2 = SLOT.TINT2;
  const T3 = SLOT.TINT3;
  m.box(0, 0, 0, 22, 3, 8, wood);
  m.box(0, 3, 0, 22, 29, 1, T1);
  m.box(0, 3, 0, 1, 29, 8, wood).box(21, 3, 0, 22, 29, 8, wood);
  m.box(0, 29, 0, 22, 30, 8, wood);
  m.box(0, 30, 0, 22, 32, 8, T3);
  m.box(0, 30, 7, 22, 31, 8, T2);
  m.box(8, 31, 3, 14, 32, 8, T2);
  // étagères (bord aux couleurs)
  for (const y of [11, 19]) {
    m.box(1, y, 1, 21, y + 1, 7, wood);
    m.box(1, y, 7, 21, y + 1, 8, T2);
  }
  // croisillons des portes vitrées (sans verre pour voir les trophées)
  m.box(0, 3, 7, 22, 4, 8, wood);
  m.box(10, 3, 7, 12, 29, 8, wood);
  m.box(0, 28, 7, 22, 29, 8, wood);
  m.set(9, 15, 7, C.brass).set(12, 15, 7, C.brass);
  // coupes, plateaux, médailles, ceinture
  const cup = (x: number, y: number, c: number, big = false) => {
    m.box(x, y, 3, x + 3, y + 1, 5, shade(c, 0.8));
    m.box(x + 1, y + 1, 3, x + 2, y + 2, 5, c);
    m.box(x, y + 2, 3, x + 3, y + (big ? 6 : 5), 5, c);
    m.box(x + 1, y + 3, 4, x + 2, y + (big ? 6 : 5), 5, shade(c, 0.6));
    m.set(x - 1, y + 3, 4, c).set(x + 3, y + 3, 4, c);
  };
  cup(2, 4, C.gold, true);
  cup(7, 4, C.silver);
  cup(14, 4, C.gold);
  m.box(17, 4, 2, 20, 9, 3, C.silver);
  m.box(18, 5, 2, 19, 8, 3, P.silverDark);
  cup(3, 12, C.silver, true);
  for (const x of [13, 16, 19]) {
    m.box(x, 15, 1, x + 1, 18, 2, x === 16 ? 0x2a4a9a : 0xb02020);
    m.box(x, 13, 1, x + 1, 15, 2, C.gold);
  }
  m.box(7, 12, 1, 9, 17, 2, C.brass);
  // ceinture de champion
  m.box(2, 22, 2, 19, 24, 3, T1);
  m.box(8, 21, 2, 13, 25, 3, C.gold);
  m.set(10, 23, 3, T3);
  cup(15, 20, C.gold, true);
  m.setOrigin(11, 0, 4);
  return m;
}

/** Canon de fonte sur affût de bois à quatre roues (bouche vers +Z). */
export function cannon(): VoxelModel {
  const m = new VoxelModel(14, 16, 37);
  const wood = 0x6a4022;
  const dark = shade(wood, 0.75);
  // flasques étagées
  for (const x0 of [2, 10]) {
    m.box(x0, 3, 4, x0 + 2, 7, 27, wood);
    m.box(x0, 7, 10, x0 + 2, 9, 27, wood);
    m.box(x0, 9, 18, x0 + 2, 11, 27, wood);
    m.box(x0, 4, 26, x0 + 2, 6, 27, I);
    for (const z of [6, 14, 22]) m.set(x0, 5, z, I).set(x0 + 1, 5, z, I);
  }
  // essieux et roues pleines
  for (const z of [8, 22]) {
    m.box(1, 2, z - 1, 13, 4, z + 1, dark);
    for (const [w0, w1] of [
      [0, 2],
      [12, 14],
    ])
      wheel(m, 'x', 2.6, z, w0, w1, 2.6, { spokes: 4, wood, tyre: I, hub: I, hubR: 0.8 });
  }
  m.box(4, 3, 4, 10, 4, 27, dark);
  // fût du canon
  const bx = 7;
  const by = 11.5;
  for (let z = 0; z < 37; z++) {
    let r = 3.3 - (z / 37) * 1.1;
    if (z < 2) r = 1.6;
    else if (z < 3) r = 3.0;
    const ring = [7, 8, 16, 17].includes(z);
    if (ring) r += 0.6;
    if (z >= 34) r = 2.9;
    m.cylZ(bx, by, r, z, z + 1, z < 2 || ring || z >= 35 ? P.ironLight : P.ironMid);
  }
  m.cylZ(bx, by, 1.0, 34, 37, C.black);
  m.sphere(bx, by, 0.6, 1.4, I);
  // tourillons et sus-bandes
  m.box(3, 10, 18, 11, 12, 20, P.ironMid);
  m.box(2, 12, 18, 4, 13, 20, I).box(10, 12, 18, 12, 13, 20, I);
  // coin de mire
  m.box(5, 7, 4, 9, 8, 9, shade(wood, 1.15));
  // boulets empilés
  for (const [x, z] of [
    [4, 1],
    [8, 1],
    [6, 2],
  ])
    m.sphere(x, 1.5, z + 0.5, 1.3, I);
  m.setOrigin(7, 0, 18.5);
  return m;
}

// ---------------------------------------------------------------------------------------
// Docks et marine

/** Coffre de marin cerclé de fer (variante peinte avec un trois-mâts). */
export function chest(variant = 0): VoxelModel {
  const m = new VoxelModel(16, 10, 10);
  const v = variant % 2;
  const wood = v === 0 ? C.oak : 0x2a4a6a;
  const dark = shade(wood, 0.75);
  m.box(1, 0, 0, 15, 7, 9, wood);
  m.box(1, 7, 0, 15, 9, 9, shade(wood, 1.08));
  m.box(2, 9, 1, 14, 10, 8, shade(wood, 1.08));
  m.box(1, 7, 0, 15, 8, 9, dark);
  // ferrures
  for (const x of [2, 12]) {
    m.box(x, 0, 0, x + 2, 9, 1, I);
    m.box(x, 0, 8, x + 2, 9, 9, I);
    m.box(x, 9, 1, x + 2, 10, 8, I);
    m.box(x, 8, 0, x + 2, 9, 9, I);
  }
  for (const [x, z] of [
    [1, 0],
    [14, 0],
    [1, 8],
    [14, 8],
  ])
    m.box(x, 0, z, x + 1, 2, z + 1, I);
  // moraillon et cadenas
  m.box(7, 5, 9, 9, 9, 10, I);
  m.box(7, 3, 9, 9, 5, 10, C.brass);
  m.set(7, 4, 9, C.black);
  // poignées de corde
  for (const x of [0, 15]) {
    m.box(x, 5, 3, x + 1, 6, 6, P.hemp);
    m.set(x, 4, 3, P.hemp).set(x, 4, 5, P.hemp);
  }
  if (v === 1) {
    // ancre blanche peinte sur le couvercle, liseré rouge
    pix(m, ['..w..', '.www.', '..w..', 'w.w.w', '.www.'], { w: C.white }, 'xz', 6, 2, 9);
    m.box(1, 7, 0, 15, 8, 9, C.red);
    for (const x of [2, 12]) m.box(x, 7, 0, x + 2, 8, 9, I);
  }
  m.setOrigin(8, 0, 5);
  return grain(m, 'x', 0.07, 660 + v, (c) => c === wood);
}

/** Roue de gouvernail à poignées tournées sur son piédestal. */
export function shipWheel(): VoxelModel {
  const m = new VoxelModel(19, 24, 6);
  const teak = P.teak;
  const dark = shade(teak, 0.75);
  const cx = 9.5;
  const cy = 14.5;
  // piédestal
  m.box(6, 0, 0, 13, 2, 5, dark);
  m.box(7, 2, 1, 12, 13, 4, teak);
  m.box(6, 12, 0, 13, 13, 5, shade(teak, 1.15));
  m.box(8, 13, 1, 11, 15, 4, teak);
  m.box(7, 6, 4, 12, 7, 5, C.brass);
  // jante
  for (let x = 0; x < 19; x++)
    for (let y = 5; y < 24; y++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d >= 5.4 && d <= 6.9) m.set(x, y, 4, d > 6.2 ? shade(teak, 1.12) : teak);
    }
  // rayons prolongés en poignées tournées
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k / 8) * Math.PI * 2;
    for (let r = 1.4; r <= 9.2; r += 0.35) {
      const c = r > 6.9 ? (r > 8.4 ? shade(teak, 1.3) : teak) : r < 5.4 ? dark : teak;
      m.set(cx + Math.cos(a) * r - 0.5, cy + Math.sin(a) * r - 0.5, 4, c);
    }
  }
  // moyeu de laiton
  for (let x = 7; x < 12; x++)
    for (let y = 12; y < 17; y++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= 1.8) m.box(x, y, 4, x + 1, y + 1, 6, d < 0.8 ? P.brassLight : C.brass);
    }
  m.setOrigin(9.5, 0, 3);
  return m;
}

/** Chevalet portant une carte de Londres avec épingles rouges et bleues. */
export function mapStand(): VoxelModel {
  const m = new VoxelModel(16, 30, 10);
  const w = C.oak;
  // pieds avant et arrière
  line6(m, 2, 0, 8, 6, 29, 5, w);
  line6(m, 13, 0, 8, 9, 29, 5, w);
  line6(m, 8, 0, 0, 8, 25, 4, shade(w, 0.85));
  m.box(1, 9, 6, 15, 10, 9, w);
  m.box(6, 28, 4, 10, 29, 6, w);
  // carte inclinée vers l'arrière
  const MAP = [
    'ffffffffffffff',
    'fpppggppppKppf',
    'fpgggpppRpppBf',
    'fppppppppppppf',
    'fwwpppwwwwpppf',
    'fpwwwwwppwwwwf',
    'fppppppppppwwf',
    'fpBpppGGpppppf',
    'fppppGGGppRppf',
    'fpppppGpppppBf',
    'fRpppppppppppf',
    'fppppBppppKppf',
    'ffffffffffffff',
  ];
  const L = { f: C.walnutDark, p: P.parchment, g: 0x8aa060, G: 0x6a8a4a, w: 0x5a8ab0, R: 0xc02020, B: 0x1d3a8a, K: C.ink };
  for (let r = 0; r < MAP.length; r++) {
    const y = 23 - r;
    const z = 5 + Math.floor((23 - y) / 6);
    for (let x = 0; x < MAP[r].length; x++) {
      const ch = MAP[r][x];
      m.set(1 + x, y, z, L[ch as keyof typeof L]);
      m.set(1 + x, y, z - 1, C.walnutDark);
    }
  }
  m.setOrigin(8, 0, 5);
  return m;
}

