// Modèles d'accessoires de référence (style et conventions pour les autres modèles).
// Conventions : résolution 1/16 m, origine au centre de la base, l'avant regarde vers +Z.

import { SLOT, VoxelModel, jitter, shade } from '../voxelModel';
import { C } from './palette';

/** Réverbère victorien en fonte avec lanterne à gaz. */
export function lampPost(): VoxelModel {
  const m = new VoxelModel(12, 62, 10);
  const cx = 6;
  const cz = 5;
  // socle mouluré
  m.box(2, 0, 1, 10, 2, 9, C.iron);
  m.box(3, 2, 2, 9, 5, 8, C.iron);
  m.box(3.5, 5, 2.5, 8.5, 7, 7.5, C.ironHi);
  m.coneY(cx, cz, 2.6, 1.4, 7, 14, C.iron);
  // fût cannelé
  m.cylY(cx, cz, 1.3, 14, 46, C.iron);
  for (let y = 16; y < 44; y += 2) m.set(cx - 2, y, cz, C.ironHi).set(cx + 1, y, cz, C.ironHi);
  // bague décorative
  m.cylY(cx, cz, 2, 30, 31, C.ironHi);
  m.cylY(cx, cz, 2.2, 45, 47, C.iron);
  // barre d'appui de l'allumeur de réverbères
  m.box(0, 44, cz - 0.5, 12, 45, cz + 0.5, C.iron);
  m.set(0, 43, cz, C.iron).set(11, 43, cz, C.iron);
  // lanterne : base, vitres lumineuses, armature
  m.box(3, 47, 2, 9, 48, 8, C.iron);
  m.box(3, 48, 2, 9, 56, 8, SLOT.GLOW);
  for (const [x, z] of [
    [3, 2],
    [8, 2],
    [3, 7],
    [8, 7],
  ])
    m.box(x, 48, z, x + 1, 56, z + 1, C.iron);
  m.box(3, 52, 2, 9, 53, 8, C.iron);
  // chapeau pointu et fleuron
  m.box(2, 56, 1, 10, 57, 9, C.iron);
  m.box(3, 57, 2, 9, 58, 8, C.iron);
  m.box(4, 58, 3, 8, 59, 7, C.iron);
  m.box(5, 59, 4, 7, 61, 6, C.ironHi);
  m.set(cx, 61, cz, C.brass);
  m.setOrigin(6, 0, 5);
  return jitter(m, 0.05, 3);
}

/** Lanterne murale sur potence. */
export function lampWall(): VoxelModel {
  const m = new VoxelModel(6, 14, 10);
  // potence fixée au mur (z=0)
  m.box(2, 9, 0, 4, 10, 6, C.iron);
  m.box(2, 6, 0, 4, 7, 2, C.iron);
  m.line(3, 6, 1, 3, 9, 4, C.iron);
  // lanterne
  m.box(1, 2, 4, 5, 3, 9, C.iron);
  m.box(1, 3, 4, 5, 8, 9, SLOT.GLOW);
  m.box(1, 3, 4, 2, 8, 5, C.iron).box(4, 3, 4, 5, 8, 5, C.iron).box(1, 3, 8, 2, 8, 9, C.iron).box(4, 3, 8, 5, 8, 9, C.iron);
  m.box(0, 8, 3, 6, 9, 10, C.iron);
  m.box(1, 9, 5, 5, 10, 8, C.iron);
  m.box(2, 0, 6, 4, 2, 7, C.iron);
  m.setOrigin(3, 0, 5);
  return m;
}

/** Chaise bistrot en bois tourné. */
export function chair(variant = 0): VoxelModel {
  const wood = [C.walnut, C.oak, C.mahogany, C.pineDark][variant % 4];
  const m = new VoxelModel(8, 16, 8);
  // pieds
  for (const [x, z] of [
    [0, 0],
    [7, 0],
    [0, 7],
    [7, 7],
  ])
    m.box(x, 0, z, x + 1, 7, z + 1, wood);
  // traverses
  m.box(0, 2, 0, 8, 3, 1, shade(wood, 0.85)).box(0, 2, 7, 8, 3, 8, shade(wood, 0.85));
  // assise
  m.box(0, 7, 0, 8, 8, 8, wood);
  if (variant % 2 === 1) m.box(1, 8, 1, 7, 9, 7, C.leatherRed);
  // dossier (côté -Z, la personne regarde vers +Z)
  m.box(0, 8, 0, 1, 16, 1, wood).box(7, 8, 0, 8, 16, 1, wood);
  m.box(0, 14, 0, 8, 16, 1, wood);
  m.box(3, 9, 0, 5, 14, 1, shade(wood, 1.1));
  m.setOrigin(4, 0, 4);
  return jitter(m, 0.05, variant + 1);
}

/** Table ronde de pub. */
export function tableRound(variant = 0): VoxelModel {
  const wood = [C.mahogany, C.walnut, C.oak][variant % 3];
  const m = new VoxelModel(17, 13, 17);
  m.cylY(8.5, 8.5, 8.4, 11, 13, wood);
  m.cylY(8.5, 8.5, 7.6, 12, 13, shade(wood, 1.12));
  m.cylY(8.5, 8.5, 1.2, 2, 11, shade(wood, 0.85));
  m.cylY(8.5, 8.5, 3.5, 0, 2, C.iron);
  // pieds en croix
  m.box(2, 0, 8, 15, 1, 9, C.iron).box(8, 0, 2, 9, 1, 15, C.iron);
  // une chope et une bouteille
  if (variant % 2 === 0) {
    m.box(5, 13, 6, 7, 16, 8, C.clothWhite === 0 ? C.brass : 0xc8b07a);
    m.box(11, 13, 10, 12, 18, 11, C.bottleGreen);
  }
  m.setOrigin(8.5, 0, 8.5);
  return jitter(m, 0.04, variant + 7);
}

/** Tonneau cerclé de fer. */
export function barrel(variant = 0): VoxelModel {
  const wood = [C.oakDark, C.walnut, C.pineDark][variant % 3];
  const m = new VoxelModel(10, 15, 10);
  for (let y = 0; y < 15; y++) {
    const t = (y + 0.5) / 15;
    const r = 3.9 + Math.sin(t * Math.PI) * 1.0;
    m.cylY(5, 5, r, y, y + 1, wood);
  }
  // douelles
  m.forEach((x, y, z, c) => {
    const a = Math.atan2(z + 0.5 - 5, x + 0.5 - 5);
    const stave = Math.floor((a + Math.PI) / (Math.PI / 6));
    return stave % 2 === 0 ? shade(c, 0.88) : c;
  });
  for (const y of [1, 4, 10, 13]) {
    const t = (y + 0.5) / 15;
    m.cylY(5, 5, 4.05 + Math.sin(t * Math.PI) * 1.0, y, y + 1, C.iron);
  }
  m.cylY(5, 5, 3.6, 14, 15, shade(wood, 1.15));
  m.setOrigin(5, 0, 5);
  return m;
}

/** Caisse en bois à lattes. */
export function crate(variant = 0, size = 14): VoxelModel {
  const wood = [C.pine, C.weathered, C.oak][variant % 3];
  const m = new VoxelModel(size, size, size);
  m.box(0, 0, 0, size, size, size, wood);
  // lattes et cadres
  const dark = shade(wood, 0.72);
  m.forEach((x, y, z, c) => {
    const edge = (x === 0 || x === size - 1 ? 1 : 0) + (y === 0 || y === size - 1 ? 1 : 0) + (z === 0 || z === size - 1 ? 1 : 0);
    if (edge >= 2) return shade(wood, 1.12);
    if (y % 4 === 0 && (x === 0 || x === size - 1 || z === 0 || z === size - 1)) return dark;
    return c;
  });
  // diagonale de renfort sur la face avant
  for (let i = 1; i < size - 1; i++) m.set(i, i, size - 1, shade(wood, 1.1)).set(i, i, 0, shade(wood, 1.1));
  // marquage
  if (variant % 2 === 0) m.box(size / 2 - 2, size / 2 - 1, size - 1, size / 2 + 2, size / 2 + 1, size, C.ink);
  m.setOrigin(size / 2, 0, size / 2);
  return jitter(m, 0.06, variant + 11);
}

/** Banc public en fonte et lattes de bois. */
export function bench(): VoxelModel {
  const m = new VoxelModel(27, 15, 10);
  // pieds en fonte ornés
  for (const x of [1, 24]) {
    m.box(x, 0, 1, x + 2, 7, 9, C.iron);
    m.box(x, 7, 0, x + 2, 15, 2, C.iron);
    m.box(x, 0, 0, x + 2, 1, 10, C.iron);
    m.set(x, 4, 4, -1).set(x + 1, 4, 4, -1).set(x, 4, 5, -1).set(x + 1, 4, 5, -1);
  }
  // lattes de l'assise
  for (const z of [2, 4, 6, 8]) m.box(0, 7, z, 27, 8, z + 1, C.green);
  // dossier
  for (const y of [9, 11, 13]) m.box(0, y, 1, 27, y + 1, 2, C.green);
  m.setOrigin(13.5, 0, 5);
  return jitter(m, 0.05, 21);
}

/** Suspension de pub (lampe à huile). */
export function hangingLamp(): VoxelModel {
  const m = new VoxelModel(8, 15, 8);
  m.box(3.5, 7, 3.5, 4.5, 15, 4.5, C.iron);
  m.box(2, 6, 2, 6, 7, 6, C.brass);
  m.box(2, 3, 2, 6, 6, 6, SLOT.GLOW);
  m.box(1, 2, 1, 7, 3, 7, C.brass);
  m.box(0, 5, 0, 8, 6, 8, C.brassDark);
  m.box(3, 0, 3, 5, 2, 5, C.brass);
  m.setOrigin(4, 0, 4);
  return m;
}

/** Lustre à bougies. */
export function chandelier(): VoxelModel {
  const m = new VoxelModel(21, 18, 21);
  const c = 10.5;
  m.box(c - 0.5, 8, c - 0.5, c + 0.5, 18, c + 0.5, C.brass);
  m.sphere(c, 6, c, 2.2, C.brass);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const ex = c + Math.cos(a) * 9;
    const ez = c + Math.sin(a) * 9;
    m.line(c, 6, c, ex, 4, ez, C.brass);
    m.box(ex - 1, 4, ez - 1, ex + 1, 5, ez + 1, C.gold);
    m.box(ex - 0.5, 5, ez - 0.5, ex + 0.5, 7, ez + 0.5, C.clothWhite);
    m.set(ex - 0.5, 7, ez - 0.5, SLOT.GLOW);
  }
  // pampilles de cristal
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    m.box(c + Math.cos(a) * 5 - 0.5, 2, c + Math.sin(a) * 5 - 0.5, c + Math.cos(a) * 5 + 0.5, 4, c + Math.sin(a) * 5 + 0.5, 0xd8e4ea);
  }
  m.set(c, 1, c, C.gold).set(c, 0, c, C.gold);
  m.setOrigin(10.5, 0, 10.5);
  return m;
}

/** Bureau du parrain : grand bureau d'acajou à caissons. */
export function deskBoss(): VoxelModel {
  const m = new VoxelModel(42, 15, 21);
  const w = C.mahogany;
  // plateau avec sous-main en cuir (la carte stratégique est posée dessus côté client)
  m.box(0, 13, 0, 42, 15, 21, w);
  m.box(1, 14, 1, 41, 15, 20, shade(w, 1.15));
  m.box(4, 15, 4, 38, 15.1, 17, C.leatherGreen);
  // caissons
  m.box(1, 0, 1, 13, 13, 20, shade(w, 0.9));
  m.box(29, 0, 1, 41, 13, 20, shade(w, 0.9));
  // façade côté visiteur (+Z) avec panneaux
  m.box(13, 6, 18, 29, 13, 20, shade(w, 0.85));
  for (const x0 of [2, 30]) {
    for (const y0 of [1, 5, 9]) {
      m.box(x0, y0, 20, x0 + 10, y0 + 3, 21, shade(w, 1.08));
      m.set(x0 + 5, y0 + 1, 21, C.brass);
    }
  }
  // tiroirs côté parrain (-Z)
  for (const x0 of [2, 30]) for (const y0 of [1, 5, 9]) m.set(x0 + 5, y0 + 1, 0, C.brass);
  // pieds sculptés
  for (const [x, z] of [
    [0, 0],
    [41, 0],
    [0, 20],
    [41, 20],
  ])
    m.box(x, 0, z, x + 1, 13, z + 1, C.mahoganyDark);
  // encrier et plume
  m.box(36, 15, 2, 39, 17, 5, C.brass);
  m.box(37, 17, 3, 38, 19, 4, C.white);
  m.setOrigin(21, 0, 10.5);
  return jitter(m, 0.04, 31);
}

/** Fauteuil du parrain en cuir capitonné. */
export function bossChair(): VoxelModel {
  const m = new VoxelModel(14, 23, 13);
  const lea = C.leatherRed;
  m.box(1, 0, 1, 2, 4, 2, C.walnut).box(12, 0, 1, 13, 4, 2, C.walnut).box(1, 0, 11, 2, 4, 12, C.walnut).box(12, 0, 11, 13, 4, 12, C.walnut);
  m.box(0, 4, 0, 14, 8, 13, lea);
  m.box(2, 8, 2, 12, 9, 12, shade(lea, 1.1));
  // accoudoirs
  m.box(0, 8, 2, 2, 12, 13, lea).box(12, 8, 2, 14, 12, 13, lea);
  // haut dossier capitonné (côté -Z)
  m.box(0, 8, 0, 14, 23, 3, lea);
  for (let y = 10; y < 22; y += 3) for (let x = 2; x < 13; x += 3) m.set(x, y, 3, C.brassDark);
  m.box(0, 22, 0, 14, 23, 3, shade(lea, 0.85));
  m.setOrigin(7, 0, 6.5);
  return jitter(m, 0.04, 33);
}

/** Étagère murale à bouteilles derrière le comptoir. */
export function bottleShelf(variant = 0): VoxelModel {
  const m = new VoxelModel(29, 32, 6);
  const w = C.mahogany;
  m.box(0, 0, 0, 29, 32, 1, shade(w, 0.8));
  m.box(0, 0, 0, 1, 32, 6, w).box(28, 0, 0, 29, 32, 6, w);
  // miroir au fond
  m.box(2, 10, 0, 27, 30, 1, SLOT.GLASS);
  const bottles = [C.bottleGreen, C.bottleBrown, C.bottleClear, C.red, C.gold];
  for (const y0 of [8, 16, 24]) {
    m.box(0, y0, 0, 29, y0 + 1, 6, w);
    for (let x = 2; x < 27; x += 2) {
      const c = bottles[(x * 7 + y0 + variant * 3) % bottles.length];
      const h = 3 + ((x + y0 + variant) % 3);
      m.box(x, y0 + 1, 2, x + 1, y0 + 1 + h, 4, c);
      m.set(x, y0 + 1 + h, 3, shade(c, 0.6));
    }
  }
  m.box(0, 31, 0, 29, 32, 6, w);
  m.box(0, 0, 0, 29, 2, 6, w);
  m.setOrigin(14.5, 0, 3);
  return jitter(m, 0.04, 41 + variant);
}
