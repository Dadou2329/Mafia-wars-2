// Monuments : statue d'homme d'État et statue équestre, bronze patiné sur piédestal.
// Résolution 1/16 m, origine au centre de la base, l'avant regarde vers +Z.

import { P, VoxelModel, shade, mix, hash3, colors } from './helpers';

const BR = 0x483c2b;
const BRD = 0x30281e;
const BRL = 0x66563d;
const PAT = 0x4f7a68;

/** Patine : seules les surfaces planes exposées au ciel verdissent (par plaques). */
function patina(m: VoxelModel, seed: number, isBronze: (c: number) => boolean): void {
  const top = mix(PAT, BR, 0.25);
  const streak = mix(PAT, BR, 0.6);
  const open = (x: number, y: number, z: number) => m.get(x, y + 1, z) < 0;
  const marks: [number, number, number, number][] = [];
  m.forEach((x, y, z, c) => {
    if (!isBronze(c) || !open(x, y, z)) return;
    let flat = 0;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      if (m.get(x + dx, y, z + dz) >= 0 && open(x + dx, y, z + dz)) flat++;
    if (flat < 3) return;
    const h = hash3(Math.floor(x / 3), Math.floor(y / 3), Math.floor(z / 3), seed);
    if (h < 0.7) {
      marks.push([x, y, z, top]);
      if (h < 0.3 && m.get(x, y - 1, z) >= 0) marks.push([x, y - 1, z, streak]);
    }
  });
  for (const [x, y, z, c] of marks) if (isBronze(m.get(x, y, z))) m.set(x, y, z, c);
}

/** Assises de pierre : joints horizontaux tous les 4 voxels sur les faces verticales. */
function ashlar(m: VoxelModel, seed: number, isStone: (c: number) => boolean): void {
  m.forEach((x, y, z, c) => {
    if (!isStone(c)) return;
    if (y % 4 === 3 && m.get(x, y + 1, z) >= 0) return shade(c, 0.92);
  });
  void seed;
}

/** Piédestal : socle de granit, dé de pierre de Portland, corniche. Renvoie le niveau du dessus. */
function pedestal(m: VoxelModel, x0: number, z0: number, x1: number, z1: number, dieH: number): number {
  const S = P.portland;
  const Sd = P.portlandDark;
  m.box(x0, 0, z0, x1, 4, z1, P.granite);
  m.box(x0, 0, z0, x1, 1, z1, P.graniteDark);
  m.box(x0, 3, z0, x1, 4, z1, P.graniteLight);
  m.box(x0 + 3, 4, z0 + 3, x1 - 3, 6, z1 - 3, Sd);
  let y = 6;
  m.box(x0 + 4, y, z0 + 4, x1 - 4, y + dieH, z1 - 4, S);
  y += dieH;
  m.box(x0 + 3, y, z0 + 3, x1 - 3, y + 2, z1 - 3, S);
  m.box(x0 + 3, y, z0 + 3, x1 - 3, y + 1, z1 - 3, Sd);
  y += 2;
  return y;
}

/** Plaque de bronze avec inscription (texte suggéré) sur une face. */
function plaque(m: VoxelModel, face: 'front' | 'back' | 'left' | 'right', a0: number, a1: number, y0: number, y1: number, at: number, seed: number): void {
  for (let a = a0; a < a1; a++)
    for (let y = y0; y < y1; y++) {
      const border = a === a0 || a === a1 - 1 || y === y0 || y === y1 - 1;
      let c = border ? BRL : BRD;
      if (!border && (y - y0) % 2 === 0 && y > y0 + 1 && y < y1 - 2 && hash3(a, y, 0, seed) > 0.35 && (a - a0) % 6 !== 5) c = mix(P.verdigris, BRL, 0.5);
      if (face === 'front') m.set(a, y, at, c);
      else if (face === 'back') m.set(a, y, at, c);
      else m.set(at, y, a, c);
    }
}

// ---------------------------------------------------------------------------------------

/** Statue en bronze d'un homme d'État victorien (redingote, rouleau, geste d'orateur). */
export function statue(): VoxelModel {
  const m = new VoxelModel(26, 74, 26);
  const top = pedestal(m, 0, 0, 26, 26, 25);
  // plaques
  plaque(m, 'front', 8, 18, 12, 24, 22, 1);
  plaque(m, 'back', 9, 17, 14, 22, 3, 2);
  // socle de bronze
  const Y = top;
  m.box(7, Y, 7, 19, Y + 1, 19, BRD);
  const b = Y + 1;
  const sweep = (pts: [number, number, number][], x0: number, x1: number, c = BR) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ay, az, ah] = pts[i];
      const [by2, bz, bh] = pts[i + 1];
      const n = Math.ceil(Math.hypot(by2 - ay, bz - az) * 2);
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const y = ay + (by2 - ay) * t;
        const z = az + (bz - az) * t;
        const h = ah + (bh - ah) * t;
        m.box(x0, b + y - h, z - 1, x1, b + y + h, z + 1, c);
      }
    }
  };
  // souliers (pointes vers +Z) et jambes du pantalon, la droite (-X) avancée
  m.box(10, b, 13, 12.5, b + 1, 17, BRD);
  m.box(13.5, b, 12, 16, b + 1, 16, BRD);
  m.box(10, b + 1, 13, 12.5, b + 12, 16, BR);
  m.box(13.5, b + 1, 11.5, 16, b + 12, 14.5, BR);
  // redingote : pans évasés jusqu'au genou, ouverts devant
  for (let y = b + 8; y < b + 19; y++) {
    const flare = y < b + 11 ? 1 : 0;
    m.box(9 - flare, y, 10 - flare, 17 + flare, y + 1, 16, BR);
    if (y < b + 15) m.box(12, y, 15, 14, y + 1, 16, -1);
  }
  m.box(12, b + 8, 9, 14, b + 18, 10, BRD);
  // torse, gilet boutonné, revers
  m.box(9, b + 19, 10, 17, b + 28, 15, BR);
  m.box(12, b + 19, 15, 14, b + 26, 16, mix(BR, BRL, 0.3));
  for (const y of [b + 20, b + 22, b + 24]) m.set(12, y, 16, BRL);
  m.box(10, b + 24, 15, 12, b + 28, 16, BRD).box(14, b + 24, 15, 16, b + 28, 16, BRD);
  // épaules
  m.box(8, b + 27, 9, 18, b + 29, 15, BR);
  m.box(7, b + 26, 10, 19, b + 27, 14, BR);
  // cape drapée dans le dos et sur l'épaule gauche
  for (let y = b + 10; y < b + 29; y++) {
    const t = (b + 29 - y) / 19;
    const x0 = Math.round(9 - t * 1.5);
    const x1 = Math.round(17 + t * 2);
    const zb = Math.round(9 - t * 1.2);
    m.box(x0, y, zb, x1, y + 1, zb + 2, BR);
    for (let x = x0; x < x1; x += 3) m.set(x, y, zb, mix(BR, BRD, 0.5));
  }
  m.box(17, b + 14, 9, 19, b + 29, 12, BR);
  // bras gauche (+X) le long du corps, tenant un rouleau
  m.box(17, b + 16, 11, 19, b + 27, 14, BR);
  m.box(17, b + 14, 11, 19, b + 16, 14, BRL);
  m.box(17, b + 13, 10, 19, b + 14, 18, BRL);
  m.set(17, b + 13, 17, BRD).set(18, b + 13, 17, BRD);
  // bras droit (-X) tendu vers la foule, main ouverte
  m.box(7, b + 21, 11, 9, b + 27, 14, BR);
  sweep(
    [
      [22, 12.5, 1],
      [24.5, 18.5, 1],
    ],
    7,
    9,
  );
  m.box(7, b + 24, 19, 9, b + 27, 21, BRL);
  m.set(7, b + 27, 20, BRL);
  // cou, tête : cheveux, favoris, barbe, nez, sourcils
  m.box(12, b + 29, 12, 14, b + 30, 14, BR);
  m.box(10, b + 28, 11, 16, b + 30, 15, BR);
  m.box(11, b + 30, 11, 15, b + 36, 15, BR);
  m.box(11, b + 34, 11, 15, b + 37, 14, BRD);
  m.box(11, b + 33, 11, 12, b + 35, 13, BRD).box(14, b + 33, 11, 15, b + 35, 13, BRD);
  m.box(11, b + 30, 13, 15, b + 32, 15.5, BRD);
  m.box(12, b + 29, 14, 14, b + 30, 15, BRD);
  m.box(12, b + 32, 15, 14, b + 33, 16, BRL);
  m.set(11, b + 34, 14, BRD).set(14, b + 34, 14, BRD);
  patina(m, 11, colors(BR, BRD, BRL));
  ashlar(m, 12, colors(P.portland, P.portlandDark, shade(P.portland, 1.06), shade(P.portland, 1.04), shade(P.portland, 1.05), P.granite, P.graniteDark));
  m.setOrigin(13, 0, 13);
  return m;
}

// ---------------------------------------------------------------------------------------

/** Statue équestre : cavalier en bicorne, sabre levé, cheval au pas, sur haut piédestal. */
export function statueHorse(): VoxelModel {
  const m = new VoxelModel(29, 86, 54);
  const top = pedestal(m, 0, 0, 29, 54, 30);
  // bas-reliefs sur les longs côtés, plaques avant et arrière
  plaque(m, 'front', 10, 19, 15, 27, 50, 3);
  plaque(m, 'back', 10, 19, 15, 27, 3, 4);
  for (const x of [4, 24]) {
    const out = x < 14 ? -1 : 1;
    for (let z = 10; z < 44; z++)
      for (let y = 14; y < 31; y++) {
        const border = z === 10 || z === 43 || y === 14 || y === 30;
        m.set(x, y, z, border ? BRL : BRD);
      }
    // couronne de laurier et épées croisées en relief, inscription de part et d'autre
    const zc = 26.5;
    const yc = 22.5;
    for (let z = 19; z < 35; z++)
      for (let y = 15; y < 31; y++) {
        const d = Math.hypot(z + 0.5 - zc, y + 0.5 - yc);
        if (d > 4.2 && d < 6.0 && !(y < 18 && Math.abs(z + 0.5 - zc) < 2)) m.set(x + out, y, z, (z + y) % 2 ? mix(BR, PAT, 0.45) : BRL);
      }
    for (let i = -4; i <= 4; i++) {
      m.set(x + out, Math.floor(yc + i), Math.floor(zc + i), P.silverDark);
      m.set(x + out, Math.floor(yc + i), Math.floor(zc - i), P.silverDark);
    }
    m.set(x + out, Math.floor(yc - 4), Math.floor(zc - 4), BRL).set(x + out, Math.floor(yc - 4), Math.floor(zc + 4), BRL);
    for (const [z0, z1] of [
      [12, 19],
      [35, 42],
    ])
      for (const y of [18, 21, 24, 27]) for (let z = z0; z < z1; z++) if (hash3(z, y, x, 7) > 0.3) m.set(x, y, z, mix(BRL, PAT, 0.3));
  }
  const Y = top;
  const cx = 14.5;
  const bronze = BR;
  const ell = (x: number, y: number, z: number, rx: number, ry: number, rz: number, c = bronze) => m.ellipsoid(x, Y + y, z, rx, ry, rz, c);
  const limb = (pts: [number, number, number][], r: number, c = bronze) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay, az] = pts[i];
      const [bx, by, bz] = pts[i + 1];
      const n = Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) * 2);
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        const z = az + (bz - az) * t;
        m.box(x - r, Y + y - r, z - r, x + r, Y + y + r, z + r, c);
      }
    }
  };
  // --- cheval
  ell(cx, 19, 26, 4.6, 5.4, 11.5);
  ell(cx, 20, 36, 4.3, 6.2, 5);
  ell(cx, 20.5, 16.5, 5, 6, 6);
  // encolure et crinière
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    ell(cx, 23 + t * 9, 37.5 + t * 6, 3.2 - t * 0.9, 3.6 - t * 0.6, 3.2 - t * 0.6);
  }
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    m.box(cx - 1, Y + 26 + t * 8.5, 35 + t * 7, cx + 1, Y + 28 + t * 8.5, 37 + t * 7, BRD);
  }
  // tête inclinée vers le bas, oreilles
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    m.box(cx - 1.5 + t * 0.3, Y + 33 - t * 6, 44 + t * 5, cx + 1.5 - t * 0.3, Y + 36 - t * 6.5, 46 + t * 5, bronze);
  }
  m.box(cx - 1.5, Y + 36, 44, cx - 0.5, Y + 38, 45, bronze).box(cx + 0.5, Y + 36, 44, cx + 1.5, Y + 38, 45, bronze);
  m.set(cx - 1.5, Y + 32, 47, BRD).set(cx + 1.5, Y + 32, 47, BRD);
  m.box(cx - 1, Y + 26, 50, cx + 1, Y + 28, 51, BRD);
  // jambes : antérieur gauche (+X) d'appui, antérieur droit levé, postérieurs
  limb(
    [
      [cx + 2, 15, 37],
      [cx + 2, 8, 37.5],
      [cx + 2, 1.5, 37.5],
    ],
    1,
  );
  limb(
    [
      [cx - 2, 15, 37],
      [cx - 2, 10, 40.5],
      [cx - 2, 6.5, 38.5],
    ],
    1,
  );
  limb(
    [
      [cx + 2, 16, 16],
      [cx + 2.5, 8, 12.5],
      [cx + 2.5, 1.5, 14],
    ],
    1.1,
  );
  limb(
    [
      [cx - 2, 16, 16],
      [cx - 2.5, 8, 14],
      [cx - 2.5, 1.5, 17],
    ],
    1.1,
  );
  // sabots
  for (const [x, z] of [
    [cx + 2, 37.5],
    [cx + 2.5, 14],
    [cx - 2.5, 17],
  ])
    m.box(x - 1.5, Y, z - 1.5, x + 1.5, Y + 1.5, z + 1.5, BRD);
  m.box(cx - 3, Y + 5.5, 37.5, cx - 1, Y + 7, 39.5, BRD);
  // queue
  limb(
    [
      [cx, 23, 10.5],
      [cx, 21, 7.5],
      [cx, 16, 6.5],
      [cx + 0.5, 10, 7.5],
      [cx + 0.5, 7, 8.5],
    ],
    1.1,
    BRD,
  );
  m.box(cx - 1, Y + 6, 7, cx + 2, Y + 9, 10, BRD);
  // tapis de selle à bordure
  for (let z = 22; z < 32; z++)
    for (let y = 17; y < 26; y++)
      for (const x of [cx - 5.5, cx + 4.5]) {
        if (m.get(Math.floor(x + (x < cx ? 1 : -1)), Y + y, z) < 0) continue;
        m.set(x, Y + y, z, y === 17 || z === 22 || z === 31 ? BRL : mix(BR, BRD, 0.4));
      }
  // --- cavalier
  // cuisses et bottes de part et d'autre
  for (const s of [-1, 1]) {
    limb(
      [
        [cx + s * 3, 25.5, 27],
        [cx + s * 5, 22, 31],
        [cx + s * 5.5, 14, 29.5],
      ],
      1.1,
    );
    m.box(cx + s * 5.5 - 1, Y + 12, 29, cx + s * 5.5 + 1, Y + 13, 33, BRD);
  }
  // torse, ceinturon, cape
  m.box(cx - 3, Y + 25, 25, cx + 3, Y + 35, 30, bronze);
  m.box(cx - 3, Y + 28, 25, cx + 3, Y + 29, 30, BRL);
  m.box(cx - 4, Y + 33, 25, cx + 4, Y + 36, 30, bronze);
  for (let y = 22; y < 36; y++) {
    const w = 4 + Math.floor((36 - y) / 5);
    m.box(cx - w, Y + y, 22 - Math.floor((36 - y) / 6), cx + w, Y + y + 1, 25, mix(BR, BRD, 0.25));
  }
  // épaulettes
  m.box(cx - 5, Y + 34, 26, cx - 3, Y + 36, 29, BRL).box(cx + 3, Y + 34, 26, cx + 5, Y + 36, 29, BRL);
  // tête et bicorne
  m.box(cx - 1, Y + 36, 26.5, cx + 1, Y + 37, 28.5, bronze);
  m.box(cx - 1.5, Y + 37, 26, cx + 1.5, Y + 41, 29, bronze);
  m.box(cx - 0.5, Y + 38, 29, cx + 0.5, Y + 39, 30, BRL);
  m.box(cx - 5, Y + 41, 26, cx + 5, Y + 42, 29, BRD);
  m.box(cx - 3.5, Y + 42, 26.5, cx + 3.5, Y + 44, 28.5, BRD);
  m.box(cx - 1.5, Y + 44, 27, cx + 1.5, Y + 45, 28, BRD);
  m.box(cx - 0.5, Y + 42, 28.5, cx + 0.5, Y + 44, 29.5, BRL);
  // bras droit (-X) levé brandissant le sabre
  limb(
    [
      [cx - 4, 34.5, 27.5],
      [cx - 6, 37.5, 31],
      [cx - 6, 40.5, 34],
    ],
    1,
  );
  for (let i = 0; i < 9; i++) m.set(cx - 6, Y + 41 + i * 0.95, 35 + i * 0.75, P.silverDark);
  m.box(cx - 7, Y + 40.5, 33.5, cx - 5, Y + 41.5, 35.5, BRL);
  // bras gauche (+X) tenant les rênes
  limb(
    [
      [cx + 4, 34.5, 27.5],
      [cx + 4.5, 30, 29],
      [cx + 2, 27.5, 33],
    ],
    1,
  );
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    m.set(cx + 1.5 - t * 0.5, Y + 27.5 + Math.sin(t * Math.PI) * 1.2 - t * 0.5, 33 + t * 16.5, BRD);
  }
  patina(m, 21, colors(BR, BRD, BRL, mix(BR, BRD, 0.4), mix(BR, BRD, 0.25)));
  ashlar(m, 22, colors(P.portland, P.portlandDark, shade(P.portland, 1.06), shade(P.portland, 1.04), shade(P.portland, 1.05), P.granite, P.graniteDark));
  m.setOrigin(14.5, 0, 27);
  return m;
}

