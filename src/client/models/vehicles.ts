// Modèles voxel des véhicules de New York 2085 : moto, berline, bolide, fourgon blindé,
// aéronef ADAV, croiseur du NYPD, camion blindé, drone, et les voitures de la circulation
// (taxis jaunes, berlines, utilitaires). Résolution 1/16 m, origine au centre de la base,
// l'avant regarde vers +Z. Les véhicules « flottent » sur des patins magnétiques lumineux.

import { SLOT, VoxelModel, shade } from './voxelModel';

const R = 1 / 16;
const v = (m: number): number => Math.round(m / R);

/** Variantes de la circulation : couleur de carrosserie. */
export const TRAFFIC_PAINTS = [0x1c1f26, 0xd8dce2, 0x5a1620, 0x1e3a5a, 0x3a3f46, 0x6a6e74, 0x14301e, 0x8a6a1e];
export const TAXI_YELLOW = 0xf2b81a;

interface BodyOpts {
  w: number; // m
  l: number;
  /** Hauteur du caisson bas, du toit (m). */
  body: number;
  roof: number;
  /** Début et fin de l'habitacle le long de la longueur (0 = arrière, 1 = avant). */
  cab0: number;
  cab1: number;
  paint: number;
  trim: number;
  /** Lueur des patins magnétiques. */
  glow: number;
  /** Garde au sol (m). */
  clearance: number;
}

/** Carrosserie générique : caisson arrondi, habitacle vitré, feux, patins lumineux. */
function hoverBody(o: BodyOpts): VoxelModel {
  const m = VoxelModel.meters(o.w, o.roof + 0.05, o.l);
  const W = m.sx;
  const L = m.sz;
  const y0 = v(o.clearance);
  const yb = v(o.body);
  const yr = v(o.roof);
  const dark = shade(o.paint, 0.62);
  const lite = shade(o.paint, 1.18);
  // caisson : arrondi aux quatre coins, avant et arrière fuyants
  for (let z = 0; z < L; z++) {
    const t = z / (L - 1);
    const nose = Math.min(1, Math.min(t, 1 - t) * 7); // 0 aux extrémités
    const inset = Math.round((1 - nose) * 3);
    const top = Math.round(y0 + (yb - y0) * (0.72 + 0.28 * nose));
    m.box(inset, y0, z, W - inset, top, z + 1, o.paint);
    // ligne de caisse claire et bas de caisse sombre
    m.box(inset, top - 1, z, W - inset, top, z + 1, lite);
    m.box(inset, y0, z, W - inset, y0 + 2, z + 1, dark);
  }
  // habitacle : pare-brise incliné, vitres sombres, montants
  const c0 = Math.round(L * o.cab0);
  const c1 = Math.round(L * o.cab1);
  for (let z = c0; z < c1; z++) {
    const t = (z - c0) / Math.max(1, c1 - c0 - 1);
    // pente du pare-brise (avant) et de la lunette (arrière)
    const slopeF = Math.min(1, (1 - t) * 3.2);
    const slopeB = Math.min(1, t * 4);
    const h = Math.round(yb + (yr - yb) * Math.min(slopeF, slopeB));
    if (h <= yb) continue;
    m.box(3, yb, z, W - 3, h, z + 1, SLOT.GLASS);
    m.box(3, h - 1, z, W - 3, h, z + 1, o.paint); // toit
  }
  // montants
  for (const z of [c0 + 2, Math.round((c0 + c1) / 2), c1 - 3]) m.box(2, yb, z, W - 2, yr - 1, z + 1, o.trim);
  m.box(2, yb, c0, 3, yr - 2, c1, o.trim);
  m.box(W - 3, yb, c0, W - 2, yr - 2, c1, o.trim);
  // phares LED (avant) et bandeau rouge (arrière)
  m.box(3, yb - 3, L - 1, W - 3, yb - 2, L, SLOT.LED);
  m.box(2, yb - 4, L - 2, 6, yb - 2, L, SLOT.LED);
  m.box(W - 6, yb - 4, L - 2, W - 2, yb - 2, L, SLOT.LED);
  m.box(3, yb - 3, 0, W - 3, yb - 2, 1, SLOT.NEON_RED);
  // calandre
  m.box(6, y0 + 3, L - 1, W - 6, yb - 5, L, shade(o.trim, 0.5));
  // patins magnétiques et lueur dessous
  const pz = [v(0.5), L - v(0.5) - v(0.7)];
  for (const z of pz) {
    for (const x of [1, W - 6]) {
      m.box(x, 1, z, x + 5, y0 + 1, z + v(0.7), shade(o.trim, 0.45));
      m.box(x + 1, 0, z + 1, x + 4, 1, z + v(0.7) - 1, o.glow);
    }
  }
  m.setOrigin(W / 2, 0, L / 2);
  return m;
}

/** Berline Nimbus (aussi : berlines de la circulation). */
export function sedanModel(paint = 0x1c1f26, trim = 0x2a2d33, glow: number = SLOT.NEON_CYAN): VoxelModel {
  return hoverBody({ w: 2.0, l: 4.4, body: 0.95, roof: 1.45, cab0: 0.26, cab1: 0.72, paint, trim, glow, clearance: 0.32 });
}

/** Taxi jaune de New York, version 2085 : damier, enseigne lumineuse sur le toit. */
export function taxiModel(): VoxelModel {
  const m = hoverBody({ w: 2.0, l: 4.4, body: 0.95, roof: 1.45, cab0: 0.26, cab1: 0.72, paint: TAXI_YELLOW, trim: 0x222222, glow: SLOT.NEON_AMBER, clearance: 0.32 });
  const W = m.sx;
  const L = m.sz;
  // damier le long des flancs
  const y = v(0.72);
  for (let z = 6; z < L - 6; z++) {
    for (let k = 0; k < 2; k++) {
      const c = (Math.floor(z / 2) + k) % 2 ? 0x111111 : 0xf2f2f2;
      m.set(0, y + k, z, c);
      m.set(W - 1, y + k, z, c);
    }
  }
  // enseigne de toit
  const zc = Math.round(L * 0.48);
  m.box(W / 2 - 5, v(1.45), zc - 3, W / 2 + 5, v(1.45) + 3, zc + 3, 0x111111);
  m.box(W / 2 - 4, v(1.45) + 1, zc - 2, W / 2 + 4, v(1.45) + 3, zc + 2, SLOT.NEON_AMBER);
  return m;
}

/** Utilitaire de livraison (circulation). */
export function vanModel(paint = 0xd8dce2): VoxelModel {
  const m = hoverBody({ w: 2.2, l: 5.4, body: 1.9, roof: 2.4, cab0: 0.7, cab1: 0.97, paint, trim: 0x2a2d33, glow: SLOT.NEON_CYAN, clearance: 0.35 });
  const W = m.sx;
  // bande publicitaire lumineuse sur les flancs
  m.box(0, v(1.2), 8, 1, v(1.6), Math.round(m.sz * 0.62), SLOT.SCREEN);
  m.box(W - 1, v(1.2), 8, W, v(1.6), Math.round(m.sz * 0.62), SLOT.SCREEN);
  return m;
}

/** Bolide Stingray : coupé bas en coin, aileron, néons. */
export function sportModel(owner: 1 | 2 | 0 = 0): VoxelModel {
  const paint = owner === 1 ? 0x8a0c18 : owner === 2 ? 0x13244a : 0x202024;
  const accent = owner === 1 ? SLOT.NEON_RED : owner === 2 ? SLOT.NEON_BLUE : SLOT.NEON_CYAN;
  const m = hoverBody({ w: 2.0, l: 4.6, body: 0.72, roof: 1.18, cab0: 0.3, cab1: 0.66, paint, trim: 0x111114, glow: accent, clearance: 0.22 });
  const W = m.sx;
  const L = m.sz;
  // aileron arrière
  m.box(2, v(0.95), 1, W - 2, v(1.0), 6, 0x111114);
  m.box(4, v(0.72), 3, 6, v(0.95), 5, 0x111114);
  m.box(W - 6, v(0.72), 3, W - 4, v(0.95), 5, 0x111114);
  // filets lumineux le long des flancs
  m.box(0, v(0.45), 6, 1, v(0.5), L - 6, accent);
  m.box(W - 1, v(0.45), 6, W, v(0.5), L - 6, accent);
  // bandes de course (couleurs de faction)
  m.box(W / 2 - 3, v(0.72) - 1, L - 18, W / 2 - 1, v(0.72), L - 1, SLOT.TINT2);
  m.box(W / 2 + 1, v(0.72) - 1, L - 18, W / 2 + 3, v(0.72), L - 1, SLOT.TINT2);
  return m;
}

/** Fourgon blindé Rhino : caisson anguleux, plaques rivetées, meurtrières. */
export function rhinoModel(): VoxelModel {
  const m = VoxelModel.meters(2.3, 2.45, 5.6);
  const W = m.sx;
  const L = m.sz;
  const body = 0x2f3338;
  const plate = 0x3c4148;
  const y0 = v(0.35);
  m.box(1, y0, 2, W - 1, v(2.25), L - 2, body);
  // capot et pare-chocs
  m.box(1, y0, L - 14, W - 1, v(1.3), L, body);
  m.box(0, y0, L - 3, W, v(0.8), L, 0x1a1c20);
  m.box(0, y0, 0, W, v(0.8), 3, 0x1a1c20);
  // pare-brise blindé étroit
  m.box(3, v(1.5), L - 15, W - 3, v(2.0), L - 14, SLOT.GLASS);
  // plaques et rivets
  for (let z = 6; z < L - 16; z += 10) {
    m.box(0, v(0.6), z, 1, v(2.1), z + 9, plate);
    m.box(W - 1, v(0.6), z, W, v(2.1), z + 9, plate);
    for (const y of [v(0.75), v(1.95)]) {
      m.set(0, y, z + 1, 0x8a9098).set(0, y, z + 7, 0x8a9098);
      m.set(W - 1, y, z + 1, 0x8a9098).set(W - 1, y, z + 7, 0x8a9098);
    }
  }
  // meurtrières
  for (let z = 10; z < L - 18; z += 14) {
    m.box(0, v(1.6), z, 1, v(1.75), z + 6, SLOT.GLASS);
    m.box(W - 1, v(1.6), z, W, v(1.75), z + 6, SLOT.GLASS);
  }
  // portes arrière, galerie de toit, gyrophare de faction
  m.box(3, v(0.5), 0, W - 3, v(2.1), 1, plate);
  m.box(W / 2, v(0.5), 0, W / 2 + 1, v(2.1), 1, 0x1a1c20);
  m.box(2, v(2.25), 8, W - 2, v(2.35), L - 18, 0x1a1c20);
  m.box(W / 2 - 3, v(2.25), L - 20, W / 2 + 3, v(2.42), L - 16, SLOT.TINT1);
  // phares et feux
  m.box(2, v(0.95), L - 1, 8, v(1.15), L, SLOT.LED);
  m.box(W - 8, v(0.95), L - 1, W - 2, v(1.15), L, SLOT.LED);
  m.box(2, v(1.0), 0, 6, v(1.2), 1, SLOT.NEON_RED);
  m.box(W - 6, v(1.0), 0, W - 2, v(1.2), 1, SLOT.NEON_RED);
  // patins
  for (const z of [6, L - 18]) {
    for (const x of [1, W - 7]) {
      m.box(x, 1, z, x + 6, y0, z + 12, 0x15171a);
      m.box(x + 1, 0, z + 1, x + 5, 1, z + 11, SLOT.NEON_CYAN);
    }
  }
  m.setOrigin(W / 2, 0, L / 2);
  return m;
}

/** Moto de récup : cadre bas, roues sans moyeu lumineuses, selle, guidon. */
export function motoModel(owner: 1 | 2 | 0 = 0): VoxelModel {
  const m = VoxelModel.meters(0.8, 1.2, 2.1);
  const W = m.sx;
  const L = m.sz;
  const cx = W / 2;
  const frame = owner === 1 ? 0x6a1018 : owner === 2 ? 0x1a2c52 : 0x3a3a40;
  const glow = owner === 1 ? SLOT.NEON_RED : owner === 2 ? SLOT.NEON_BLUE : SLOT.NEON_CYAN;
  // roues (anneaux)
  for (const zc of [v(0.38), L - v(0.38)]) {
    for (let a = 0; a < 48; a++) {
      const t = (a / 48) * Math.PI * 2;
      const y = Math.round(v(0.36) + Math.sin(t) * v(0.34));
      const z = Math.round(zc + Math.cos(t) * v(0.34));
      m.box(cx - 2, y, z, cx + 2, y + 1, z + 1, 0x141416);
      if (a % 3 === 0) m.box(cx - 1, y, z, cx + 1, y + 1, z + 1, glow);
    }
  }
  // cadre, réservoir, selle
  m.box(cx - 2, v(0.42), v(0.4), cx + 2, v(0.62), L - v(0.45), frame);
  m.box(cx - 3, v(0.6), v(0.75), cx + 3, v(0.85), v(1.35), frame);
  m.box(cx - 3, v(0.82), v(0.95), cx + 3, v(0.88), v(1.35), shade(frame, 1.25));
  m.box(cx - 3, v(0.7), v(0.35), cx + 3, v(0.8), v(0.8), 0x1a1a1c); // selle
  // fourche, guidon, phare
  m.line(cx, v(0.4), L - v(0.38), cx, v(1.0), L - v(0.6), 0x8a8e96, 1);
  m.box(cx - 6, v(1.0), L - v(0.62), cx + 6, v(1.04), L - v(0.58), 0x141416);
  m.box(cx - 2, v(0.85), L - v(0.5), cx + 2, v(0.95), L - v(0.45), SLOT.LED);
  m.box(cx - 2, v(0.75), v(0.3), cx + 2, v(0.8), v(0.33), SLOT.NEON_RED);
  // pot d'échappement électrique (bobine lumineuse)
  m.box(cx + 2, v(0.38), v(0.4), cx + 4, v(0.48), v(0.9), glow);
  m.setOrigin(W / 2, 0, L / 2);
  return m;
}

/** Aéronef Corvus (ADAV) : fuselage effilé, quatre soufflantes carénées, verrière. */
export function vtolModel(owner: 1 | 2 | 0 = 0): VoxelModel {
  const m = VoxelModel.meters(4.4, 2.0, 5.4);
  const W = m.sx;
  const L = m.sz;
  const cx = W / 2;
  const hull = owner === 1 ? 0x2a0a0e : owner === 2 ? 0x0e1830 : 0x2a2d33;
  const accent = owner === 1 ? SLOT.NEON_RED : owner === 2 ? SLOT.NEON_BLUE : SLOT.NEON_CYAN;
  // fuselage
  for (let z = 4; z < L - 2; z++) {
    const t = (z - 4) / (L - 6);
    const r = Math.round(v(0.55) * (0.55 + 0.45 * Math.sin(Math.min(1, t * 1.25) * Math.PI)));
    m.ellipsoid(cx, v(0.85), z, r + 2, Math.max(3, r - 1), 1, hull);
  }
  // verrière
  m.ellipsoid(cx, v(1.12), L - v(1.5), v(0.42), v(0.32), v(0.75), SLOT.GLASS);
  // ailes courtes et soufflantes
  m.box(cx - v(1.6), v(0.85), v(1.6), cx + v(1.6), v(0.95), v(3.0), hull);
  for (const [fx, fz] of [
    [cx - v(1.6), v(1.0)],
    [cx + v(1.6), v(1.0)],
    [cx - v(1.6), v(3.6)],
    [cx + v(1.6), v(3.6)],
  ]) {
    m.cylY(fx, fz, v(0.55), v(0.7), v(1.05), 0x1a1c20);
    m.cylY(fx, fz, v(0.45), v(0.7), v(1.05), -1);
    m.cylY(fx, fz, v(0.45), v(0.72), v(0.76), accent);
    m.box(fx - 1, v(0.75), fz - v(0.45), fx + 1, v(0.95), fz + v(0.45), 0x555a62);
  }
  // train d'atterrissage, feux de position, bandes de faction
  for (const [x, z] of [
    [cx - v(0.5), v(1.2)],
    [cx + v(0.5), v(1.2)],
    [cx, L - v(1.0)],
  ])
    m.box(x - 1, 0, z - 1, x + 1, v(0.55), z + 1, 0x333840);
  m.box(cx - v(1.6) - 1, v(0.9), v(2.3), cx - v(1.6), v(0.95), v(2.4), SLOT.NEON_RED);
  m.box(cx + v(1.6), v(0.9), v(2.3), cx + v(1.6) + 1, v(0.95), v(2.4), SLOT.NEON_GREEN);
  m.box(cx - 2, v(1.3), 4, cx + 2, v(1.36), L - v(2.3), SLOT.TINT1);
  m.box(cx - 2, v(0.6), L - 4, cx + 2, v(0.75), L - 2, SLOT.LED);
  m.setOrigin(W / 2, 0, L / 2);
  return m;
}

/** Croiseur du NYPD : bleu nuit et blanc, rampe lumineuse rouge et bleue. */
export function policeModel(): VoxelModel {
  const m = hoverBody({ w: 2.1, l: 4.8, body: 0.98, roof: 1.5, cab0: 0.26, cab1: 0.7, paint: 0x101a30, trim: 0xe8ecf2, glow: SLOT.NEON_BLUE, clearance: 0.32 });
  const W = m.sx;
  const L = m.sz;
  // portières blanches
  m.box(0, v(0.45), Math.round(L * 0.3), 1, v(0.9), Math.round(L * 0.68), 0xe8ecf2);
  m.box(W - 1, v(0.45), Math.round(L * 0.3), W, v(0.9), Math.round(L * 0.68), 0xe8ecf2);
  // rampe lumineuse
  const zc = Math.round(L * 0.5);
  m.box(4, v(1.5), zc - 2, W - 4, v(1.5) + 2, zc + 2, 0x111111);
  m.box(5, v(1.5) + 1, zc - 1, W / 2 - 1, v(1.5) + 3, zc + 1, SLOT.NEON_RED);
  m.box(W / 2 + 1, v(1.5) + 1, zc - 1, W - 5, v(1.5) + 3, zc + 1, SLOT.NEON_BLUE);
  return m;
}

/** Camion blindé de transport de fonds. */
export function truckModel(): VoxelModel {
  const m = VoxelModel.meters(2.5, 3.0, 7.0);
  const W = m.sx;
  const L = m.sz;
  const y0 = v(0.4);
  m.box(1, y0, 2, W - 1, v(2.9), L - v(2.0), 0x4a4e52);
  m.box(1, y0, L - v(2.0), W - 1, v(2.4), L, 0x3a3e44);
  m.box(3, v(1.7), L - v(0.6), W - 3, v(2.2), L - v(0.5), SLOT.GLASS);
  m.box(0, v(1.2), 10, 1, v(2.0), L - v(2.4), 0xc9a24a);
  m.box(W - 1, v(1.2), 10, W, v(2.0), L - v(2.4), 0xc9a24a);
  m.box(W / 2 - 4, v(2.9), L - v(2.6), W / 2 + 4, v(3.0), L - v(2.3), SLOT.NEON_AMBER);
  m.box(2, v(1.0), L - 1, 8, v(1.2), L, SLOT.LED);
  m.box(W - 8, v(1.0), L - 1, W - 2, v(1.2), L, SLOT.LED);
  for (const z of [6, L - v(1.6)]) {
    for (const x of [1, W - 8]) {
      m.box(x, 1, z, x + 7, y0, z + 14, 0x15171a);
      m.box(x + 1, 0, z + 1, x + 6, 1, z + 13, SLOT.NEON_AMBER);
    }
  }
  m.setOrigin(W / 2, 0, L / 2);
  return m;
}

/** Drone de reconnaissance (quadrirotor). */
export function droneModel(): VoxelModel {
  const m = VoxelModel.meters(1.2, 0.5, 1.2);
  const W = m.sx;
  const cx = W / 2;
  m.box(cx - 3, 2, cx - 4, cx + 3, 6, cx + 4, 0x23262c);
  m.box(cx - 1, 1, cx + 3, cx + 1, 3, cx + 5, SLOT.NEON_RED);
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    m.line(cx, 4, cx, cx + dx * 7, 4, cx + dz * 7, 0x3a3e46, 0);
    m.cylY(cx + dx * 7, cx + dz * 7, 3.2, 5, 6, 0x8a9098);
    m.set(cx + dx * 7, 3, cx + dz * 7, dx > 0 ? SLOT.NEON_GREEN : SLOT.NEON_RED);
  }
  m.setOrigin(W / 2, 0, W / 2);
  return m;
}

/** Modèle d'un véhicule de jeu selon son identifiant (VehicleDef.id) et son propriétaire. */
export function vehicleModel(def: number, owner: 0 | 1 | 2): VoxelModel {
  switch (def) {
    case 0:
      return motoModel(owner);
    case 1:
      return sedanModel(owner === 1 ? 0x1a0a0e : owner === 2 ? 0x0c1428 : 0x2a2d33, owner === 1 ? 0xc9a24a : owner === 2 ? 0xc9d1dc : 0x3a3d44, owner === 1 ? SLOT.NEON_RED : owner === 2 ? SLOT.NEON_BLUE : SLOT.NEON_CYAN);
    case 2:
      return sportModel(owner);
    case 3:
      return rhinoModel();
    case 4:
      return vtolModel(owner);
    case 5:
      return policeModel();
    case 6:
      return truckModel();
    default:
      return droneModel();
  }
}
