// Modèles voxel des équipements du QG (carte holographique, surveillance, drones, communications,
// sécurité, station cybernétique, armurerie avancée, centre d'opérations, transport, recrutement,
// trophées) et des fauteuils des cliniques. Résolution 1/16 m, l'avant regarde vers +Z ; les
// modèles muraux ont l'origine au milieu du dos (posé contre le mur). Les pièces aux couleurs du
// parrain utilisent les emplacements TINT ; les diodes NEON_GREEN / NEON_AMBER clignotent (voir
// hqVisuals.ts) ; les écrans des feeds sont des toiles posées sur les zones SCREENS.

import { K, SLOT, V, VoxelModel, cbox, discXY, discXZ, grit, hazardXY, line6, monitor, paint, text, textWidth, type M } from './kit';

/** Zone d'écran (voxels du modèle) : la toile animée s'y pose, derrière les cadres. */
export interface ScreenZone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Profondeur de la toile (voxels depuis le dos). */
  z: number;
  /** Écrans individuels (voxels) : [x0, y0, x1, y1]. */
  cells: [number, number, number, number][];
}

/** Modèle dos au mur, dimensions en voxels. */
function back(sx: number, sy: number, sz: number): M {
  return new VoxelModel(sx, sy, sz).setOrigin(sx / 2, 0, 0);
}

/** Cadre d'écran creux (la toile est derrière). */
function hollowBezel(m: M, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, c = K.black): void {
  m.box(x0, y0, z0, x1, y1, z1, c);
  m.box(x0 + 1, y0 + 1, z0, x1 - 1, y1 - 1, z1, -1);
}

// ====================================================================== surveillance

export const SURVEIL_ZONE: ScreenZone = {
  x0: 2,
  y0: 16,
  x1: 40,
  y1: 35,
  z: 1.4,
  cells: [
    [2, 26, 14, 35],
    [15, 26, 27, 35],
    [28, 26, 40, 35],
    [2, 16, 14, 25],
    [15, 16, 27, 25],
    [28, 16, 40, 25],
  ],
};

/** Mur d'écrans de surveillance : six moniteurs (flux des caméras), console et clavier, serveur au sol. */
export function surveilModel(): M {
  const m = back(42, 39, 8);
  // rails muraux et panneau arrière
  m.box(1, 10, 0, 41, 37, 1, K.carbon);
  m.box(2, 9, 0, 4, 38, 2, K.gunDk);
  m.box(38, 9, 0, 40, 38, 2, K.gunDk);
  // moniteurs (cadres creux : la toile des flux est derrière)
  for (const [x0, y0, x1, y1] of SURVEIL_ZONE.cells) {
    hollowBezel(m, x0, y0, x1, y1, 1, 3);
    m.set(x1 - 2, y0, 2, SLOT.NEON_GREEN);
  }
  // bandeau supérieur aux couleurs du parrain
  m.box(1, 35, 0, 41, 39, 3, SLOT.TINT1);
  m.box(1, 35, 3, 41, 36, 4, SLOT.NEON_CYAN);
  m.box(2, 37, 3, 40, 38, 4, SLOT.TINT2);
  m.box(36, 36, 3, 38, 38, 4, SLOT.NEON_RED);
  // console : plateau, liseré, clavier, manette
  m.box(4, 13, 1, 38, 14, 8, K.gun);
  m.box(4, 13, 7, 38, 14, 8, SLOT.TINT2);
  m.box(4, 12, 7, 38, 13, 8, SLOT.LED);
  m.box(13, 14, 3, 29, 15, 6, K.black);
  for (let x = 14; x < 28; x += 2) for (let z = 3; z < 6; z++) m.set(x, 14, z, K.gunLt);
  m.box(32, 14, 4, 33, 17, 5, K.gunLt);
  m.box(31, 17, 3, 34, 18, 6, SLOT.NEON_RED);
  m.box(6, 14, 4, 10, 15, 6, K.gunLt);
  m.set(7, 15, 4, SLOT.NEON_AMBER);
  m.set(9, 15, 4, SLOT.NEON_GREEN);
  // consoles de soutien et serveur au sol
  for (const x of [6, 36]) line6(m, x, 13, 1, x, 7, 1, K.gunDk);
  m.box(7, 0, 1, 17, 9, 7, K.carbon);
  m.box(7, 8, 1, 17, 9, 7, K.gunDk);
  for (let y = 2; y < 8; y += 2) {
    m.box(8, y, 6, 16, y + 1, 7, K.gun);
    m.set(9, y, 7, SLOT.NEON_GREEN);
    m.set(11, y, 7, y === 4 ? SLOT.NEON_AMBER : SLOT.NEON_GREEN);
  }
  // goulotte de câbles jusqu'au sol
  m.box(21, 0, 0, 24, 13, 1, K.gunDk);
  m.box(21, 6, 1, 24, 7, 2, K.yellow);
  return grit(m, 0.05, 11);
}

// ====================================================================== drones

/** Drone de surveillance à quatre rotors (posé ou en vol), ≈ 0,7 m. */
export function droneModel(): M {
  const m = new VoxelModel(13, 5, 13);
  const c = 6.5;
  // patins
  m.box(3, 0, 4, 4, 1, 9, K.gunDk);
  m.box(9, 0, 4, 10, 1, 9, K.gunDk);
  // corps : coque, dôme, caméra
  cbox(m, 4, 1, 4, 9, 3, 9, K.carbon, 1);
  m.box(5, 3, 5, 8, 4, 8, SLOT.TINT1);
  m.box(5, 1, 9, 8, 3, 10, K.black);
  m.set(6, 2, 10, SLOT.NEON_CYAN);
  m.set(4, 2, 3, SLOT.NEON_RED);
  // bras et rotors carénés
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const rx = c + sx * 4.2;
    const rz = c + sz * 4.2;
    line6(m, c + sx * 1.5, 3, c + sz * 1.5, rx, 3, rz, K.gunDk);
    discXZ(m, rx, rz, 2.6, 3, 4, (dx, dz, d) => (d > 1.9 ? SLOT.TINT2 : d < 0.7 ? K.gunLt : -2));
    m.set(Math.floor(rx), 4, Math.floor(rz), K.black);
  }
  return m.setOrigin(6.5, 0, 6.5);
}

/** Râtelier de recharge des drones : trois berceaux lumineux, deux drones posés (le troisième patrouille). */
export function droneRackModel(): M {
  const m = back(26, 36, 10);
  m.box(0, 0, 0, 26, 36, 1, K.carbon);
  m.box(0, 0, 0, 2, 36, 10, K.gunDk);
  m.box(24, 0, 0, 26, 36, 10, K.gunDk);
  m.box(0, 0, 0, 26, 2, 10, K.black);
  m.box(0, 33, 0, 26, 36, 10, K.gunDk);
  m.box(2, 34, 9, 24, 35, 10, SLOT.TINT1);
  m.box(1, 2, 9, 2, 33, 10, SLOT.TINT2);
  m.box(24, 2, 9, 25, 33, 10, SLOT.TINT2);
  const drone = droneModel();
  [6, 16, 26].forEach((y, i) => {
    // berceau : plateau, anneau de charge, contacts, écran d'état
    m.box(2, y, 1, 24, y + 1, 10, K.gun);
    discXZ(m, 13, 5.5, 5.2, y + 1, y + 2, (dx, dz, d) => (d > 4.4 ? (i === 2 ? SLOT.NEON_AMBER : SLOT.NEON_GREEN) : -2));
    m.box(12, y + 1, 1, 14, y + 2, 2, K.chrome);
    monitor(m, 9, y + 5, 17, y + 8, 0, K.black);
    if (i < 2) m.paste(drone, 7, y + 1, 0);
  });
  // antenne de liaison
  m.box(20, 33, 2, 21, 36, 3, K.alu);
  m.set(20, 35, 3, SLOT.NEON_RED);
  return grit(m, 0.05, 12);
}

// ====================================================================== communications

/** Baie de communications : serveurs à diodes, émetteur à écran radar, parabole et antennes. */
export function commsModel(): M {
  const m = back(26, 37, 14);
  // baie de serveurs (gauche)
  cbox(m, 0, 0, 0, 12, 32, 14, K.carbon, 1);
  m.box(0, 0, 0, 12, 1, 14, K.black);
  m.box(1, 2, 13, 11, 31, 14, -1);
  let k = 0;
  for (let y = 2; y < 31; y += 2) {
    const face = k % 3 === 2 ? K.gun : K.gunDk;
    m.box(1, y, 12, 11, y + 2, 13, face);
    m.set(2, y, 13, k % 4 === 1 ? SLOT.NEON_AMBER : SLOT.NEON_GREEN);
    m.set(4, y, 13, SLOT.NEON_GREEN);
    if (k % 2 === 0) m.set(6, y + 1, 13, SLOT.NEON_CYAN);
    for (let x = 8; x < 11; x++) m.set(x, y, 13, K.gunLt);
    k++;
  }
  m.box(0, 31, 13, 12, 32, 14, SLOT.TINT1);
  // émetteur (droite) : écran radar, molettes, vumètre, combiné
  cbox(m, 13, 0, 0, 26, 28, 13, K.gunDk, 1);
  m.box(13, 0, 0, 26, 1, 13, K.black);
  discXY(m, 19.5, 18, 4.6, 12, 14, (dx, dy, d) => (d > 3.8 ? K.black : d > 3 ? SLOT.NEON_GREEN : Math.abs(dx) < 0.5 || Math.abs(dy) < 0.5 ? SLOT.NEON_GREEN : SLOT.SCREEN));
  for (const x of [15, 19, 23]) {
    m.box(x, 9, 13, x + 2, 11, 14, K.chrome);
    m.set(x, 10, 13, K.black);
  }
  for (let x = 15; x < 24; x++) m.set(x, 6, 13, x < 20 ? SLOT.NEON_CYAN : x < 22 ? SLOT.NEON_AMBER : SLOT.NEON_RED);
  m.box(14, 2, 13, 25, 4, 14, K.gun);
  m.box(23, 12, 13, 25, 16, 14, K.black);
  m.box(23, 15, 13, 25, 16, 14, K.gunLt);
  m.box(25, 22, 6, 26, 26, 9, SLOT.TINT2);
  // chemin de câbles vers le plafond
  m.box(2, 32, 2, 11, 33, 12, K.gunDk);
  m.box(3, 33, 0, 5, 37, 1, K.gunDk);
  m.box(6, 33, 0, 7, 37, 1, 0x2a4f86);
  m.box(8, 33, 0, 9, 37, 1, K.yellow);
  // parabole et antennes fouet
  discXY(m, 19.5, 32, 4.4, 4, 5, (dx, dy, d) => (d > 3.6 ? K.alu : K.white));
  m.box(19, 28, 3, 21, 32, 5, K.gunLt);
  line6(m, 19.5, 32, 5, 19.5, 32, 8, K.gunLt);
  m.set(19, 32, 8, SLOT.NEON_RED);
  for (const x of [14, 25]) {
    m.box(x, 28, 10, x + 1, 37, 11, K.alu);
    m.set(x, 36, 10, SLOT.NEON_RED);
  }
  return grit(m, 0.05, 13);
}

// ====================================================================== sécurité

/**
 * Sécurité renforcée autour de la porte (largeur en m) : cadre blindé à bandes de danger, linteau à
 * gyrophare, caméra-dôme, portique de détection juste derrière l'entrée (on le traverse).
 */
export function securityModel(doorW: number): M {
  const dw = Math.round(doorW * V);
  const sx = dw + 16;
  const m = back(sx, 47, 18);
  // montants blindés et linteau
  for (const x0 of [0, sx - 8]) {
    m.box(x0, 0, 0, x0 + 8, 46, 4, K.steel);
    m.box(x0 + 1, 0, 3, x0 + 7, 44, 4, K.gun);
    hazardXY(m, x0 + 1, 2, x0 + 7, 18, 4, K.yellow, K.black, 2);
    for (let y = 22; y < 44; y += 4) {
      m.set(x0 + 1, y, 4, K.chrome);
      m.set(x0 + 6, y, 4, K.chrome);
    }
  }
  m.box(0, 38, 0, sx, 47, 5, K.steel);
  hazardXY(m, 1, 39, sx - 1, 41, 5, K.yellow, K.black, 2);
  m.box(1, 42, 4, sx - 1, 46, 5, K.gun);
  m.box(sx / 2 - 2, 43, 5, sx / 2 + 2, 45, 6, SLOT.NEON_RED);
  // caméra-dôme sous le linteau
  discXZ(m, sx / 2 + 6, 7, 2.2, 36, 38, K.black);
  m.box(sx / 2 + 5, 38, 5, sx / 2 + 7, 39, 9, K.gunDk);
  m.set(sx / 2 + 6, 36, 8, SLOT.NEON_RED);
  // portique de détection (piliers blancs, diodes rouges intérieures, écran)
  const z0 = 12;
  const z1 = 17;
  for (const [x0, x1, inner] of [
    [5, 9, 9],
    [sx - 9, sx - 5, sx - 10],
  ] as [number, number, number][]) {
    cbox(m, x0, 0, z0, x1, 38, z1, K.plastW, 1);
    m.box(x0, 0, z0, x1, 2, z1, K.black);
    for (let y = 4; y < 35; y++) m.set(inner, y, z0 + 2, y % 3 === 0 ? SLOT.NEON_RED : K.gunDk);
  }
  m.box(5, 36, z0, sx - 5, 41, z1, K.plastW);
  m.box(6, 35, z0 + 1, sx - 6, 36, z1 - 1, SLOT.NEON_RED);
  monitor(m, sx / 2 - 4, 37, sx / 2 + 4, 40, z1 - 1, K.black);
  m.box(9, 0, z0, sx - 9, 1, z1, K.black);
  m.box(9, 0, z0, sx - 9, 1, z0 + 1, K.yellow);
  m.box(9, 0, z1 - 1, sx - 9, 1, z1, K.yellow);
  return grit(m, 0.04, 14);
}

// ====================================================================== station cybernétique et cliniques

/** Points d'appui des bras robotisés (voxels) : épaule, coude, poignet, outil (couleur de l'extrémité). */
export const ARM_JOINTS: { sh: [number, number, number]; el: [number, number, number]; wr: [number, number, number]; tip: number }[] = [
  { sh: [9, 33, 6], el: [7, 26, 12], wr: [10, 20, 15], tip: SLOT.NEON_RED },
  { sh: [19, 33, 6], el: [21, 27, 11], wr: [19, 21, 15], tip: SLOT.LED },
  { sh: [29, 33, 6], el: [31, 26, 12], wr: [28, 20, 15], tip: SLOT.NEON_CYAN },
];

/**
 * Fauteuil d'implantation : couchette inclinable sur vérin, portique blanc et trois bras robotisés
 * (laser, scanner, injecteur), écran du schéma corporel, plateau d'instruments, sol lumineux.
 * clinic : version de clinique (blanc et sarcelle), sinon aux couleurs du parrain.
 */
export function cyberStationModel(clinic: boolean): M {
  const m = back(38, 37, 28);
  const trim = clinic ? K.teal : SLOT.TINT1;
  const trim2 = clinic ? K.tealDk : SLOT.TINT2;
  const glow = clinic ? SLOT.NEON_CYAN : SLOT.TINT1;
  // sol technique à alvéoles et liseré lumineux
  for (let x = 1; x < 37; x++)
    for (let z = 1; z < 27; z++) {
      const edge = x === 1 || x === 36 || z === 1 || z === 26;
      m.set(x, 0, z, edge ? (clinic ? SLOT.NEON_CYAN : SLOT.TINT1) : (x + (z >> 1)) % 4 === 0 || z % 4 === 0 ? K.gunDk : K.carbon);
    }
  // vérin et socle
  m.box(12, 1, 11, 26, 2, 20, K.gunDk);
  cbox(m, 15, 2, 13, 23, 7, 18, K.chrome, 1);
  m.box(15, 4, 18, 23, 5, 19, glow);
  // couchette : repose-jambes, assise, dossier relevé vers la tête (x faible)
  for (let x = 5; x < 33; x++) {
    let y0 = 7;
    let y1 = 10;
    if (x >= 26) {
      y0 = 7 - Math.round((x - 26) * 0.35);
      y1 = y0 + 3;
    } else if (x < 15) {
      y1 = 10 + Math.round((15 - x) * 0.75);
      y0 = y1 - 3;
    }
    m.box(x, y0, 11, x + 1, y1, 21, K.plastW);
    m.box(x, y1 - 1, 12, x + 1, y1, 20, K.white);
    m.set(x, y1 - 1, 16, trim);
    m.box(x, y0, 11, x + 1, y0 + 1, 21, K.gunLt);
  }
  // appui-tête, accoudoirs
  m.box(3, 16, 13, 6, 21, 19, K.black);
  m.box(3, 20, 14, 6, 21, 18, trim2);
  for (const z of [10, 21]) {
    m.box(13, 10, z, 21, 11, z + 1, K.chrome);
    m.box(14, 7, z, 15, 10, z + 1, K.chrome);
  }
  // portique : montants, poutre, rail et rampe lumineuse
  for (const x0 of [0, 36]) {
    m.box(x0, 1, 0, x0 + 2, 36, 4, K.white);
    m.box(x0, 1, 3, x0 + 2, 36, 4, trim2);
    m.box(x0, 1, 0, x0 + 2, 3, 4, K.gunDk);
  }
  m.box(0, 34, 0, 38, 37, 10, K.white);
  m.box(1, 34, 3, 37, 35, 8, SLOT.LED);
  m.box(1, 36, 9, 37, 37, 10, trim);
  // bras robotisés
  for (const a of ARM_JOINTS) {
    line6(m, a.sh[0], a.sh[1], a.sh[2], a.el[0], a.el[1], a.el[2], K.white, 1);
    line6(m, a.el[0], a.el[1], a.el[2], a.wr[0], a.wr[1], a.wr[2], K.plastW, 0);
    m.box(a.sh[0] - 1, a.sh[1] - 1, a.sh[2] - 1, a.sh[0] + 2, a.sh[1] + 2, a.sh[2] + 2, K.gunDk);
    m.box(a.el[0] - 1, a.el[1] - 1, a.el[2] - 1, a.el[0] + 1, a.el[1] + 1, a.el[2] + 1, K.gunLt);
    m.box(a.wr[0], a.wr[1] - 3, a.wr[2], a.wr[0] + 1, a.wr[1], a.wr[2] + 1, K.chrome);
    m.set(a.wr[0], a.wr[1] - 4, a.wr[2], a.tip);
  }
  // écran du schéma corporel (silhouette et points d'implants)
  m.box(12, 16, 0, 26, 32, 2, K.black);
  m.box(13, 17, 1, 25, 31, 2, K.glassDk);
  const body = ['...k...', '..kkk..', '...k...', '.kkkkk.', 'k.kkk.k', 'k.kkk.k', '..kkk..', '..k.k..', '..k.k..', '..k.k..', '.kk.kk.'];
  body.forEach((row, r) => {
    for (let i = 0; i < row.length; i++) if (row[i] === 'k') m.set(16 + i, 29 - r, 2, SLOT.NEON_CYAN);
  });
  for (const [x, y] of [
    [19, 28],
    [16, 25],
    [22, 25],
    [18, 21],
  ])
    m.set(x, y, 2, SLOT.NEON_RED);
  m.box(13, 31, 1, 25, 32, 2, trim);
  // plateau d'instruments au pied du fauteuil
  m.box(33, 1, 21, 34, 11, 22, K.chrome);
  m.box(30, 11, 19, 37, 12, 25, K.chrome);
  m.set(31, 12, 21, K.red);
  m.set(33, 12, 22, SLOT.NEON_CYAN);
  m.set(35, 12, 20, K.white);
  m.box(31, 12, 23, 34, 13, 24, K.teal);
  return grit(m, 0.04, clinic ? 15 : 16);
}

// ====================================================================== armurerie avancée

/** Râtelier lumineux : fusil à rail, pistolet-mitrailleur, fusil à pompe, pistolets, lame thermique, six grenades. */
export function armoryModel(): M {
  const m = back(32, 36, 8);
  m.box(0, 0, 0, 32, 36, 1, K.carbon);
  // cadre et enseigne
  m.box(0, 0, 0, 1, 36, 2, SLOT.TINT2);
  m.box(31, 0, 0, 32, 36, 2, SLOT.TINT2);
  m.box(0, 29, 0, 32, 36, 2, K.black);
  m.box(0, 29, 1, 32, 30, 3, SLOT.TINT1);
  m.box(0, 35, 1, 32, 36, 3, SLOT.TINT1);
  const w = textWidth('ARSENAL');
  text(m, 'ARSENAL', Math.round(16 - w / 2), 33, 2, SLOT.NEON_RED);
  // grille perforée
  for (let y = 8; y < 29; y++) for (let x = 2; x < 30; x++) if ((x + y) % 3 === 0) m.set(x, y, 1, K.gunDk);
  // fusil à rail Longbow
  m.box(3, 24, 1, 29, 26, 3, K.gunLt);
  m.box(3, 23, 1, 9, 26, 3, K.black);
  m.box(13, 26, 1, 19, 27, 3, K.black);
  m.set(19, 26, 2, SLOT.NEON_CYAN);
  for (let x = 20; x < 29; x += 2) m.set(x, 25, 3, SLOT.NEON_CYAN);
  // pistolet-mitrailleur Wasp
  m.box(4, 19, 1, 13, 22, 3, K.gun);
  m.box(8, 16, 1, 10, 19, 3, K.black);
  m.box(4, 21, 3, 13, 22, 4, SLOT.NEON_AMBER);
  // fusil à pompe Hammer
  m.box(15, 19, 1, 29, 21, 3, K.gunLt);
  m.box(15, 18, 1, 20, 21, 3, K.walnut);
  m.box(23, 18, 1, 26, 19, 3, K.walnut);
  // pistolets Vektor
  for (const x of [4, 11]) {
    m.box(x, 13, 1, x + 6, 15, 3, K.gun);
    m.box(x, 11, 1, x + 2, 13, 3, K.black);
    m.box(x + 1, 15, 2, x + 6, 16, 3, SLOT.NEON_CYAN);
  }
  // lame thermique
  m.box(19, 12, 1, 22, 14, 3, K.black);
  m.box(22, 12, 1, 29, 14, 2, K.steelLt);
  m.box(22, 13, 2, 29, 14, 3, SLOT.NEON_AMBER);
  // tablette à grenades (capacité +2 : six places)
  m.box(1, 5, 1, 31, 6, 7, K.gunLt);
  m.box(1, 5, 6, 31, 6, 7, SLOT.LED);
  for (let i = 0; i < 6; i++) {
    const x = 3 + i * 5;
    m.box(x, 6, 2, x + 2, 9, 4, 0x4f5838);
    m.set(x, 7, 4, K.yellow);
    m.set(x + 1, 7, 4, K.yellow);
    m.set(x, 9, 3, K.gunLt);
  }
  // caisses de munitions au sol
  for (const [x0, x1] of [
    [2, 14],
    [16, 30],
  ]) {
    m.box(x0, 0, 1, x1, 5, 8, 0x4f5838);
    m.box(x0, 4, 1, x1, 5, 8, 0x363d26);
    m.box(x0 + 2, 1, 7, x0 + 6, 3, 8, K.yellow);
  }
  return grit(m, 0.04, 17);
}

// ====================================================================== centre d'opérations

export const OPS_ZONE: ScreenZone = {
  x0: 2,
  y0: 15,
  x1: 36,
  y1: 30,
  z: 3.4,
  cells: [
    [2, 15, 13, 22],
    [13, 15, 25, 22],
    [25, 15, 36, 22],
    [7, 22, 19, 30],
    [19, 22, 31, 30],
  ],
};

/** Console des opérations : pupitre galbé, cinq écrans (opérations en direct), claviers, palet holographique. */
export function opsModel(): M {
  const m = back(38, 31, 16);
  const cx = 18.5;
  const front = (x: number) => 12 + Math.round(3 * (1 - ((x + 0.5 - cx) / cx) ** 2));
  for (let x = 0; x < 38; x++) {
    const f = front(x);
    m.box(x, 1, 2, x + 1, 12, f - 1, K.gunDk);
    m.box(x, 0, 2, x + 1, 1, f - 1, K.black);
    m.box(x, 12, 1, x + 1, 13, f + 1, K.gun);
    m.set(x, 12, f, SLOT.TINT1);
    m.set(x, 11, f - 1, SLOT.LED);
    if (x % 6 === 2) m.box(x, 3, f - 1, x + 1, 10, f, K.gun);
  }
  // pied central des écrans et cadres (toile derrière)
  m.box(17, 13, 1, 21, 15, 3, K.gunDk);
  m.box(1, 14, 1, 37, 31, 2, K.carbon);
  for (const [x0, y0, x1, y1] of OPS_ZONE.cells) hollowBezel(m, x0, y0, x1, y1, 2, 4);
  m.box(1, 30, 1, 37, 31, 4, SLOT.TINT1);
  // claviers, palet holographique, tasse
  for (const x0 of [4, 15, 26]) {
    m.box(x0, 13, 8, x0 + 8, 14, 11, K.black);
    for (let x = x0 + 1; x < x0 + 7; x += 2) m.set(x, 13, 9, K.gunLt);
  }
  discXZ(m, 18.5, 13, 2.2, 13, 14, (dx, dz, d) => (d > 1.5 ? SLOT.NEON_CYAN : K.chrome));
  m.box(33, 13, 9, 35, 15, 11, K.white);
  m.set(33, 14, 9, 0x3a2414);
  return grit(m, 0.04, 18);
}

// ====================================================================== transport personnel

/** Aire d'appontage : disque lumineux à chevrons, borne de recharge. Origine au centre. */
export function padModel(): M {
  const R = 25;
  const m = new VoxelModel(52, 26, 52);
  const c = 26;
  discXZ(m, c, c, R, 0, 1, (dx, dz, d) => {
    const a = Math.atan2(dz, dx);
    if (d > R - 1.4) return SLOT.NEON_AMBER;
    if (d > R - 3.5) return Math.floor(((a + Math.PI) / (Math.PI * 2)) * 24) % 2 ? K.yellow : K.black;
    if (d > 15 && d < 16.2) return SLOT.TINT2;
    if (d < 3) return SLOT.TINT1;
    return K.concreteDk;
  });
  for (const [dx, dz] of [
    [0, -20],
    [0, 20],
    [-20, 0],
    [20, 0],
  ])
    m.box(c + dx - 1, 1, c + dz - 1, c + dx + 1, 2, c + dz + 1, SLOT.LED);
  // chevrons d'approche
  for (let k = 0; k < 3; k++) for (let i = -4; i <= 4; i++) m.set(c + i, 1, c - 9 + Math.abs(i) - k * 3, K.yellow);
  // borne de recharge (bord est)
  m.box(46, 1, 23, 50, 23, 28, K.gunDk);
  m.box(46, 1, 27, 50, 23, 28, SLOT.TINT1);
  m.box(47, 12, 22, 49, 17, 23, SLOT.SCREEN);
  m.box(47, 22, 23, 49, 24, 27, SLOT.NEON_GREEN);
  m.box(45, 5, 24, 46, 7, 26, K.black);
  line6(m, 45, 6, 25, 40, 3, 25, K.black);
  return grit(m, 0.05, 19).setOrigin(c, 0, c);
}

/** Moto à sustentation : carénage effilé aux couleurs du parrain, patins lumineux, pare-brise. Origine au centre. */
export function hoverBikeModel(): M {
  const m = new VoxelModel(13, 13, 34);
  const cx = 6.5;
  for (let z = 2; z < 32; z++) {
    // section : plus large au milieu, effilée à l'avant (+z)
    const t = (z - 2) / 30;
    const half = Math.max(1.5, 4.6 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
    const top = 5 + Math.round(3 * Math.sin(Math.PI * t));
    for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) {
      m.box(x, 3, z, x + 1, top, z + 1, Math.abs(x + 0.5 - cx) > half - 1.2 ? SLOT.TINT1 : K.carbon);
    }
    m.set(Math.floor(cx), top - 1, z, SLOT.TINT2);
  }
  // patins de sustentation (avant et arrière)
  discXZ(m, cx, 7, 3.2, 1, 3, (dx, dz, d) => (d > 2.3 ? K.gunDk : SLOT.NEON_CYAN));
  discXZ(m, cx, 27, 3.2, 1, 3, (dx, dz, d) => (d > 2.3 ? K.gunDk : SLOT.NEON_CYAN));
  // selle, pare-brise, guidon, feux
  m.box(4, 8, 8, 9, 10, 17, K.black);
  m.box(4, 9, 21, 9, 12, 24, SLOT.GLASS);
  m.box(1, 9, 20, 12, 10, 21, K.chrome);
  m.box(5, 5, 32, 8, 7, 34, SLOT.LED);
  m.box(5, 5, 0, 8, 7, 2, SLOT.NEON_RED);
  return m.setOrigin(cx, 0, 17);
}

// ====================================================================== recrutement automatique

/** Borne de recrutement : grand écran, lecteur d'identité, fente des contrats, projecteur holographique. */
export function kioskModel(): M {
  const m = back(15, 33, 10);
  m.box(1, 0, 1, 14, 2, 10, K.black);
  m.box(1, 1, 9, 14, 2, 10, SLOT.TINT1);
  cbox(m, 2, 2, 1, 13, 29, 8, K.gunDk, 1);
  m.box(2, 2, 0, 13, 29, 1, K.carbon);
  monitor(m, 3, 12, 12, 27, 7, K.black);
  m.box(4, 7, 7, 11, 10, 9, K.black);
  m.box(5, 8, 9, 10, 9, 10, SLOT.NEON_GREEN);
  m.box(5, 5, 8, 10, 6, 9, K.gunLt);
  m.box(1, 3, 3, 2, 28, 6, SLOT.TINT2);
  m.box(13, 3, 3, 14, 28, 6, SLOT.TINT2);
  // couronne et projecteur
  m.box(2, 29, 1, 13, 32, 8, SLOT.TINT1);
  m.box(3, 30, 8, 12, 31, 9, SLOT.LED);
  discXZ(m, 7.5, 4.5, 2.4, 32, 33, (dx, dz, d) => (d > 1.6 ? K.chrome : SLOT.NEON_CYAN));
  return grit(m, 0.04, 20);
}

// ====================================================================== trophées

/** Emplacements des trophées sur les étagères (m, repère du modèle) : 3 étagères × 6. */
export const TROPHY_SLOTS: [number, number, number][] = (() => {
  const out: [number, number, number][] = [];
  for (const y of [30, 22, 14]) for (let i = 0; i < 6; i++) out.push([(3.5 + i * 5 - 16) / V, (y + 1) / V, 3.5 / V]);
  return out;
})();

/** Vitrine des trophées : fond de noyer à filets d'or, trois étagères de verre éclairées, couronne. */
export function trophyShelfModel(): M {
  const m = back(32, 38, 7);
  m.box(0, 0, 0, 32, 37, 1, K.walnutDk);
  for (let y = 1; y < 36; y += 3) m.box(1, y, 0, 31, y + 1, 1, K.walnut);
  m.box(0, 0, 0, 1, 37, 3, SLOT.TINT2);
  m.box(31, 0, 0, 32, 37, 3, SLOT.TINT2);
  m.box(0, 36, 0, 32, 37, 3, SLOT.TINT2);
  // buffet bas à poignées d'or
  m.box(0, 0, 1, 32, 8, 6, K.walnut);
  m.box(0, 7, 1, 32, 8, 7, K.marbleBlk);
  m.box(15, 1, 6, 17, 7, 7, K.walnutDk);
  m.box(6, 4, 6, 9, 5, 7, SLOT.TINT2);
  m.box(23, 4, 6, 26, 5, 7, SLOT.TINT2);
  // étagères de verre éclairées
  for (const y of [13, 21, 29]) {
    m.box(1, y, 1, 31, y + 1, 6, SLOT.GLASS);
    m.box(1, y - 1, 1, 31, y, 2, SLOT.LED);
  }
  // couronne
  const crown = ['k.k.k', 'kkkkk', 'kkkkk'];
  crown.forEach((row, r) => {
    for (let i = 0; i < row.length; i++) if (row[i] === 'k') m.set(14 + i, 36 + 1 - r, 1, SLOT.TINT2);
  });
  return grit(m, 0.04, 21);
}

/** Trophées (statuettes dorées) : gratte-ciel (bâtiment clé), écusson (quartier), coupe. Origine au centre de la base. */
export function trophyModels(): M[] {
  const tower = new VoxelModel(4, 8, 3);
  tower.box(0, 0, 0, 4, 1, 3, K.black);
  tower.box(1, 1, 1, 3, 6, 2, K.gold);
  tower.box(1, 6, 1, 2, 8, 2, K.goldLt);
  tower.set(2, 3, 1, K.goldDk);
  tower.set(2, 5, 1, K.goldDk);
  tower.setOrigin(2, 0, 1.5);
  const shield = new VoxelModel(5, 7, 2);
  shield.box(1, 0, 0, 4, 1, 2, K.black);
  shield.box(0, 2, 0, 5, 6, 1, K.gold);
  shield.box(1, 1, 0, 4, 2, 1, K.gold);
  shield.set(2, 4, 1, SLOT.TINT1);
  shield.set(2, 6, 0, K.goldLt);
  shield.setOrigin(2.5, 0, 1);
  const cup = new VoxelModel(5, 7, 3);
  cup.box(1, 0, 0, 4, 1, 3, K.black);
  cup.box(2, 1, 1, 3, 3, 2, K.goldDk);
  cup.box(1, 3, 0, 4, 7, 3, K.gold);
  cup.box(2, 4, 1, 3, 7, 2, -1);
  cup.set(0, 5, 1, K.goldLt);
  cup.set(4, 5, 1, K.goldLt);
  cup.setOrigin(2.5, 0, 1.5);
  return [tower, shield, cup];
}

// ====================================================================== carte holographique

/** Projecteur de la carte holographique (posé sur la table). Origine au centre. */
export function projectorModel(): M {
  const m = new VoxelModel(9, 2, 9);
  discXZ(m, 4.5, 4.5, 4.4, 0, 1, (dx, dz, d) => (d > 3.6 ? K.gunDk : K.chrome));
  discXZ(m, 4.5, 4.5, 3, 1, 2, (dx, dz, d) => (d > 2.2 ? SLOT.NEON_CYAN : K.black));
  return m.setOrigin(4.5, 0, 4.5);
}

/** Repeint en couleur unie (silhouettes des drones en vol). */
export function tinted(m: M, c: number): M {
  return paint(m, 0, 0, 0, m.sx, m.sy, m.sz, c);
}
