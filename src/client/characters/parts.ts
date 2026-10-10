// Modèles voxel des membres des personnages (résolution 1/32 m). Chaque membre a son
// origine au point d'articulation. Les couleurs sont des emplacements de palette (SLOT.*)
// pour que chaque personnage ait sa propre tenue sans dupliquer la géométrie.
// Repère : +Y en haut, +Z vers l'avant, +X vers la gauche du personnage.

import { SLOT, VoxelModel } from '../models/voxelModel';

export const RES = 1 / 32;
const SOLE = 0x121110;
const MOUTH = 0x7a4038;

export type TorsoStyle = 'longcoat' | 'frock' | 'jacket' | 'vest' | 'tunic' | 'bodice' | 'apron';
export type HeadStyle = 'dadou' | 'even' | 'mustache' | 'beard' | 'clean' | 'stubble' | 'woman' | 'sideburns' | 'old';
export type HatStyle = 'bowler' | 'top' | 'flatcap' | 'police' | 'bonnet' | 'none' | 'hairbun';
export type TailStyle = 'longcoat' | 'frock' | 'tunic' | 'none';
export type ArmStyle = 'coat' | 'shirt';

// --------------------------------------------------------------------------- torse

/** Torse : origine à la taille (centre). Hauteur 15 + cou. */
export function torso(style: TorsoStyle): VoxelModel {
  const m = new VoxelModel(16, 18, 10, RES);
  const cx = 8;
  const cz = 5;
  const woman = style === 'bodice';
  const base = woman ? SLOT.DRESS : style === 'vest' || style === 'apron' ? SLOT.SHIRT : SLOT.COAT;
  for (let y = 0; y < 15; y++) {
    let hw = woman ? (y < 6 ? 5 : y < 11 ? 5.5 : 6.5) : y < 4 ? 6 : y < 12 ? 6.5 : 7;
    const hd = y < 4 ? 3.5 : 4;
    if (y >= 14) hw -= 0.5;
    m.box(cx - hw, y, cz - hd, cx + hw, y + 1, cz + hd, base);
  }
  // épaules arrondies
  m.clear(1, 14, 1).clear(14, 14, 1).clear(1, 14, 8).clear(14, 14, 8);
  // cou
  m.box(cx - 2, 15, cz - 2, cx + 2, 18, cz + 2, SLOT.SKIN);
  const front = cz + 4 - 1; // dernière couche avant (z = 8)
  if (style === 'longcoat' || style === 'frock' || style === 'jacket') {
    // col de chemise et cravate
    m.box(cx - 2.5, 15, cz - 2.5, cx + 2.5, 16, cz + 2.5, SLOT.SHIRT);
    m.box(cx - 2, 15, cz - 2, cx + 2, 16, cz + 2, SLOT.SKIN);
    // ouverture en V montrant le gilet
    for (let y = 5; y < 15; y++) {
      const v = Math.max(0.6, (y - 5) * 0.42 + 0.6);
      m.box(cx - v, y, front - 1, cx + v, y + 1, front + 1, SLOT.VEST);
    }
    // plastron de chemise et cravate
    for (let y = 11; y < 15; y++) {
      const v = (y - 10) * 0.45 + 0.4;
      m.box(cx - v, y, front, cx + v, y + 1, front + 1, SLOT.SHIRT);
    }
    m.box(cx - 1, 11, front, cx + 1, 15, front + 1, SLOT.TIE);
    m.box(cx - 1.5, 13.5, front, cx + 1.5, 14.5, front + 1, SLOT.TIE);
    // boutons du gilet
    for (const y of [6, 8, 10]) m.set(cx, y, front, SLOT.ACCENT);
    // revers (doublure visible)
    for (let y = 7; y < 15; y++) {
      const v = Math.max(0.6, (y - 5) * 0.42 + 0.6);
      m.set(cx - v - 1, y, front, SLOT.COAT2).set(cx + v, y, front, SLOT.COAT2);
    }
    if (style === 'frock') {
      // redingote croisée : deux rangées de boutons
      for (const y of [3, 5, 7]) {
        m.set(cx - 4, y, front, SLOT.ACCENT).set(cx + 3, y, front, SLOT.ACCENT);
      }
      m.box(cx - 1, 0, front, cx + 1, 5, front + 1, SLOT.COAT2);
    }
    if (style === 'longcoat') {
      // chaîne de montre en travers du gilet
      m.set(cx - 2, 7, front, SLOT.ACCENT).set(cx - 1, 6, front, SLOT.ACCENT).set(cx + 1, 6, front, SLOT.ACCENT).set(cx + 2, 7, front, SLOT.ACCENT);
      // pochette
      m.box(cx + 3, 11, front, cx + 5, 12, front + 1, SLOT.COAT2);
    }
    if (style === 'jacket') {
      // poches de veste
      m.box(cx - 6, 3, front, cx - 3, 4, front + 1, SLOT.COAT2);
      m.box(cx + 3, 3, front, cx + 6, 4, front + 1, SLOT.COAT2);
    }
    // brassard porté sur la manche ? (sur le bras) — rien ici
  } else if (style === 'vest' || style === 'apron') {
    // gilet sans manches par-dessus la chemise
    for (let y = 1; y < 13; y++) {
      const hw = y < 4 ? 6 : 6.5;
      m.box(cx - hw, y, cz - 4, cx + hw, y + 1, cz + 4, SLOT.VEST);
    }
    for (let y = 8; y < 13; y++) {
      const v = (y - 8) * 0.5 + 0.5;
      m.box(cx - v, y, front, cx + v, y + 1, front + 1, SLOT.SHIRT);
    }
    for (const y of [3, 5, 7]) m.set(cx, y, front, SLOT.ACCENT);
    // foulard
    m.box(cx - 2.5, 14, cz - 2.5, cx + 2.5, 15.5, cz + 2.5, SLOT.TIE);
    m.box(cx - 1, 12, front, cx + 1, 14, front + 1, SLOT.TIE);
    // bretelles
    m.box(cx - 4, 1, front, cx - 3, 14, front + 1, SLOT.PANTS);
    m.box(cx + 3, 1, front, cx + 4, 14, front + 1, SLOT.PANTS);
    if (style === 'apron') m.box(cx - 5, 0, front, cx + 5, 10, front + 1, SLOT.COAT2);
  } else if (style === 'tunic') {
    // tunique de policier : boutons argentés, ceinturon, col montant
    m.box(cx - 2.5, 15, cz - 2.5, cx + 2.5, 16.5, cz + 2.5, SLOT.COAT);
    m.box(cx - 2, 15, cz - 2, cx + 2, 17, cz + 2, SLOT.SKIN);
    for (let y = 1; y < 14; y += 2) m.set(cx, y, front, SLOT.ACCENT);
    m.box(cx - 6.5, 2, cz - 3.5, cx + 6.5, 4, cz + 3.5, SLOT.SHOES);
    m.box(cx - 1, 2, front, cx + 1, 4, front + 1, SLOT.ACCENT);
    m.set(cx - 2, 15, front - 1, SLOT.ACCENT).set(cx + 1, 15, front - 1, SLOT.ACCENT);
  } else if (style === 'bodice') {
    // corsage, châle sur les épaules, laçage
    for (let y = 10; y < 15; y++) {
      const hw = 6.5;
      m.box(cx - hw, y, cz - 4, cx + hw, y + 1, cz + 4, SLOT.COAT2);
    }
    m.clear(1, 14, 1).clear(14, 14, 1).clear(1, 14, 8).clear(14, 14, 8);
    for (let y = 2; y < 10; y += 2) m.set(cx, y, front, SLOT.ACCENT);
    m.box(cx - 2.5, 15, cz - 2.5, cx + 2.5, 16, cz + 2.5, SLOT.COAT2);
    m.box(cx - 2, 15, cz - 2, cx + 2, 17.5, cz + 2, SLOT.SKIN);
  }
  m.setOrigin(8, 0, 5);
  return m;
}

/** Bassin : origine en haut (taille). */
export function pelvis(style: TorsoStyle): VoxelModel {
  const m = new VoxelModel(14, 5, 9, RES);
  const coat = style === 'longcoat' || style === 'frock' || style === 'jacket' || style === 'tunic';
  m.box(1, 0, 1, 13, 5, 8, SLOT.PANTS);
  if (coat) {
    m.box(0.5, 2, 0.5, 13.5, 5, 8.5, SLOT.COAT);
    if (style === 'tunic') m.box(0.5, 4, 0.5, 13.5, 5, 8.5, SLOT.SHOES);
  } else if (style === 'bodice') {
    m.box(0, 0, 0, 14, 5, 9, SLOT.DRESS);
  } else {
    // ceinture
    m.box(1, 4, 1, 13, 5, 8, SLOT.SHOES);
    m.box(6, 4, 7, 8, 5, 8, SLOT.ACCENT);
  }
  m.setOrigin(7, 5, 4.5);
  return m;
}

/** Cuisse : origine à la hanche (haut). */
export function thigh(): VoxelModel {
  const m = new VoxelModel(6, 14, 6, RES);
  m.box(0.5, 3, 0.5, 5.5, 14, 5.5, SLOT.PANTS);
  m.box(0.75, 0, 0.75, 5.25, 3, 5.25, SLOT.PANTS);
  m.setOrigin(3, 14, 3);
  return m;
}

/** Jambe + chaussure : origine au genou (haut). */
export function shin(): VoxelModel {
  const m = new VoxelModel(6, 17, 11, RES);
  m.box(0.75, 4, 1.75, 5.25, 17, 6.25, SLOT.PANTS);
  m.box(0.5, 3, 1.5, 5.5, 5, 6.5, SLOT.PANTS);
  // chaussure
  m.box(1, 1, 1.5, 5, 3, 9.5, SLOT.SHOES);
  m.box(1.5, 3, 5, 4.5, 4, 8, SLOT.SHOES);
  m.box(1, 0, 1.5, 5, 1, 10, SOLE);
  m.box(1, 0, 1.5, 5, 2, 3, SOLE);
  m.setOrigin(3, 17, 4);
  return m;
}

/** Bras : origine à l'épaule. */
export function upperArm(style: ArmStyle): VoxelModel {
  const m = new VoxelModel(5, 11, 5, RES);
  const c = style === 'coat' ? SLOT.COAT : SLOT.SHIRT;
  m.box(0.5, 0, 0.5, 4.5, 10, 4.5, c);
  m.box(1, 10, 1, 4, 11, 4, c);
  m.setOrigin(2.5, 11, 2.5);
  return m;
}

/** Brassard de faction (gangsters) : bras de manteau avec un brassard teinté. */
export function upperArmBand(): VoxelModel {
  const m = upperArm('coat');
  m.box(0.4, 4, 0.4, 4.6, 6, 4.6, SLOT.ARMBAND);
  return m;
}

/** Avant-bras + main : origine au coude. */
export function forearm(style: ArmStyle): VoxelModel {
  const m = new VoxelModel(5, 13, 5, RES);
  if (style === 'coat') {
    m.box(0.6, 4, 0.6, 4.4, 13, 4.4, SLOT.COAT);
    m.box(0.8, 3, 0.8, 4.2, 4, 4.2, SLOT.SHIRT);
  } else {
    // manche retroussée
    m.box(0.8, 3, 0.8, 4.2, 9, 4.2, SLOT.SKIN);
    m.box(0.4, 9, 0.4, 4.6, 13, 4.6, SLOT.SHIRT);
  }
  // main (poing légèrement fermé)
  m.box(1, 0, 1, 4, 3, 4, SLOT.SKIN);
  m.box(1.5, 0, 4, 3.5, 2, 4.6, SLOT.SKIN);
  m.setOrigin(2.5, 13, 2.5);
  return m;
}

// --------------------------------------------------------------------------- tête

/** Tête : origine au sommet du cou (centre). Visage vers +Z. */
export function head(style: HeadStyle): VoxelModel {
  const m = new VoxelModel(11, 11, 11, RES);
  const S = SLOT.SKIN;
  // crâne (9 × 9 × 9) aux angles arrondis
  m.box(1, 0, 1, 10, 9, 10, S);
  for (const [x, z] of [
    [1, 1],
    [9, 1],
    [1, 9],
    [9, 9],
  ]) {
    m.clear(x, 8, z);
    m.clear(x, 0, z);
  }
  // mâchoire plus étroite
  m.clear(1, 0, 6).clear(9, 0, 6).clear(1, 0, 7).clear(9, 0, 7).clear(1, 0, 8).clear(9, 0, 8);
  // oreilles
  m.box(0, 4, 4, 1, 6, 6, S).box(10, 4, 4, 11, 6, 6, S);
  const fz = 9; // couche du visage (z)
  // yeux et sourcils
  m.set(3, 5, fz, SLOT.EYES).set(7, 5, fz, SLOT.EYES);
  m.set(4, 5, fz, 0xf2ede4).set(6, 5, fz, 0xf2ede4);
  m.box(2, 6, fz, 5, 7, fz + 1, SLOT.HAIR).box(6, 6, fz, 9, 7, fz + 1, SLOT.HAIR);
  // nez
  m.box(5, 3, fz + 1, 6, 5, fz + 2, S);
  m.set(5, 5, fz + 1, S);
  // bouche
  m.box(4, 1, fz, 7, 2, fz + 1, MOUTH);
  // cheveux : dessus et arrière
  const hairTop = style === 'old' ? 8 : 7;
  m.box(1, hairTop, 1, 10, 9, 9, SLOT.HAIR);
  m.box(1, 2, 1, 10, 9, 3, SLOT.HAIR);
  m.box(1, 5, 1, 2, 9, 7, SLOT.HAIR).box(9, 5, 1, 10, 9, 7, SLOT.HAIR);
  m.box(2, 9, 2, 9, 10, 8, SLOT.HAIR);
  if (style !== 'woman') m.box(2, 8, 8, 9, 9, 10, SLOT.HAIR); // frange courte
  switch (style) {
    case 'dadou':
      // moustache en guidon recourbée
      m.box(3, 2, fz + 1, 8, 3, fz + 2, SLOT.BEARD);
      m.set(2, 3, fz + 1, SLOT.BEARD).set(8, 3, fz + 1, SLOT.BEARD);
      m.set(2, 4, fz + 1, SLOT.BEARD).set(8, 4, fz + 1, SLOT.BEARD);
      // favoris courts
      m.box(1, 3, 6, 2, 6, 8, SLOT.HAIR).box(9, 3, 6, 10, 6, 8, SLOT.HAIR);
      // menton volontaire
      m.box(4, 0, fz, 7, 1, fz + 1, S);
      break;
    case 'even':
      // côtelettes reliées à la moustache
      m.box(1, 1, 5, 3, 7, 10, SLOT.BEARD);
      m.box(8, 1, 5, 10, 7, 10, SLOT.BEARD);
      m.box(3, 2, fz + 1, 8, 3, fz + 2, SLOT.BEARD);
      m.box(2, 1, fz, 3, 3, fz + 1, SLOT.BEARD).box(8, 1, fz, 9, 3, fz + 1, SLOT.BEARD);
      // monocle cerclé d'argent sur l'œil gauche (côté +X), avec sa chaînette
      m.set(6, 5, fz + 1, SLOT.ACCENT).set(8, 5, fz + 1, SLOT.ACCENT).set(7, 4, fz + 1, SLOT.ACCENT).set(7, 6, fz + 1, SLOT.ACCENT);
      m.set(8, 4, fz + 1, SLOT.ACCENT).set(8, 3, fz, SLOT.ACCENT).set(9, 2, fz - 1, SLOT.ACCENT);
      break;
    case 'mustache':
      m.box(3, 2, fz + 1, 8, 3, fz + 2, SLOT.BEARD);
      break;
    case 'beard':
      m.box(2, 0, 6, 9, 3, fz + 1, SLOT.BEARD);
      m.box(3, -1 + 1, fz, 8, 1, fz + 2, SLOT.BEARD);
      m.box(3, 2, fz + 1, 8, 3, fz + 2, SLOT.BEARD);
      m.box(4, 1, fz, 7, 2, fz + 1, MOUTH);
      break;
    case 'sideburns':
      m.box(1, 2, 5, 2, 7, 8, SLOT.BEARD).box(9, 2, 5, 10, 7, 8, SLOT.BEARD);
      break;
    case 'stubble':
      m.box(2, 0, fz, 9, 2, fz + 1, SLOT.BEARD);
      m.box(4, 1, fz, 7, 2, fz + 1, MOUTH);
      break;
    case 'old':
      m.box(2, 0, 6, 9, 4, fz + 1, SLOT.BEARD);
      m.box(4, 1, fz, 7, 2, fz + 1, MOUTH);
      m.box(2, 6, fz, 5, 7, fz + 1, SLOT.BEARD).box(6, 6, fz, 9, 7, fz + 1, SLOT.BEARD);
      break;
    case 'woman':
      // cheveux longs relevés, lèvres
      m.box(1, 3, 1, 10, 9, 4, SLOT.HAIR);
      m.box(1, 3, 1, 2, 9, 8, SLOT.HAIR).box(9, 3, 1, 10, 9, 8, SLOT.HAIR);
      m.box(2, 8, 7, 9, 9, 9, SLOT.HAIR);
      m.box(4, 1, fz, 7, 2, fz + 1, 0xa03a3a);
      break;
    default:
      break;
  }
  m.setOrigin(5.5, 0, 5.5);
  return m;
}

/** Chapeaux : même origine que la tête (sommet du cou). */
export function hat(style: HatStyle): VoxelModel {
  const m = new VoxelModel(15, 22, 15, RES);
  const c = 7.5;
  switch (style) {
    case 'bowler':
      for (let y = 9; y < 14; y++) {
        const t = (y - 8.5) / 5;
        const r = 4.9 * Math.sqrt(Math.max(0, 1 - t * t * 0.85));
        m.cylY(c, c, r, y, y + 1, SLOT.HAT);
      }
      m.cylY(c, c, 4.95, 9, 10, SLOT.HATBAND);
      for (let x = 0; x < 15; x++)
        for (let z = 0; z < 15; z++) {
          const dx = (x + 0.5 - c) / 6.3;
          const dz = (z + 0.5 - c) / 6.8;
          if (dx * dx + dz * dz <= 1) m.set(x, 8, z, SLOT.HAT);
        }
      // bord relevé sur les côtés
      m.forEach((x, y, z, col) => {
        if (y === 8 && Math.abs(x + 0.5 - c) > 5.2) {
          m.set(x, 9, z, col);
        }
      });
      break;
    case 'top':
      m.cylY(c, c, 6.3, 8, 9, SLOT.HAT);
      m.cylY(c, c, 4.4, 9, 18, SLOT.HAT);
      m.cylY(c, c, 4.7, 17, 18, SLOT.HAT);
      m.cylY(c, c, 4.5, 9, 11, SLOT.HATBAND);
      break;
    case 'flatcap':
      for (let y = 8; y < 11; y++) {
        const r = y === 10 ? 4.6 : 5.4;
        for (let x = 0; x < 15; x++)
          for (let z = 0; z < 15; z++) {
            const dx = (x + 0.5 - c) / r;
            const dz = (z + 0.5 - c + 0.6) / (r + 0.6);
            if (dx * dx + dz * dz <= 1) m.set(x, y, z, SLOT.HAT);
          }
      }
      // visière
      m.box(c - 4, 8, c + 4, c + 4, 9, c + 7, SLOT.HAT);
      m.box(c - 3, 8, c + 7, c + 3, 9, c + 7.5, SLOT.HAT);
      m.set(c - 0.5, 11, c - 0.5, SLOT.HATBAND);
      break;
    case 'police':
      for (let y = 6; y < 18; y++) {
        const t = (y - 6) / 12;
        const r = 5.3 * Math.sqrt(Math.max(0, 1 - t * t * 0.92)) + 0.3;
        for (let x = 0; x < 15; x++)
          for (let z = 0; z < 15; z++) {
            const dx = (x + 0.5 - c) / r;
            const dz = (z + 0.5 - c) / (r * 1.08);
            if (dx * dx + dz * dz <= 1) m.set(x, y, z, SLOT.HAT);
          }
      }
      // creuser pour le visage
      m.box(c - 4, 0, c + 1, c + 4, 8, 15, -1);
      m.cylY(c, c, 6, 6, 7, SLOT.HAT);
      m.box(c - 4, 6, c + 1, c + 4, 7, 15, -1);
      // plaque et pointe
      m.box(c - 1.5, 10, c + 5, c + 1.5, 13, c + 6, SLOT.ACCENT);
      m.set(c - 0.5, 18, c - 0.5, SLOT.ACCENT).set(c - 0.5, 19, c - 0.5, SLOT.ACCENT);
      break;
    case 'bonnet':
      for (let y = 4; y < 11; y++)
        for (let x = 0; x < 15; x++)
          for (let z = 0; z < 15; z++) {
            const dx = (x + 0.5 - c) / 5.6;
            const dy = (y - 5) / 6;
            const dz = (z + 0.5 - c + 0.8) / 6;
            if (dx * dx + dy * dy + dz * dz <= 1 && z < c + 4) m.set(x, y, z, SLOT.HAT);
          }
      m.box(c - 5, 4, c + 2, c + 5, 10, c + 4, -1);
      m.box(c - 5.5, 6, c + 2, c + 5.5, 7, c + 3, SLOT.HATBAND);
      m.box(c - 3, 3, c + 2, c - 2, 6, c + 3, SLOT.HATBAND);
      break;
    case 'hairbun':
      m.sphere(c, 7, c - 5.2, 2.6, SLOT.HAIR);
      break;
    case 'none':
      break;
  }
  m.setOrigin(7.5, 0, 7.5);
  return m;
}

/** Pan de manteau (côté gauche) attaché à la hanche. side = 1 gauche, -1 droite. */
export function coatTail(style: TailStyle, side: 1 | -1): VoxelModel {
  const m = new VoxelModel(8, 19, 10, RES);
  const length = style === 'longcoat' ? 16 : style === 'frock' ? 13 : style === 'tunic' ? 6 : 0;
  const top = 18;
  for (let y = top - 3 - length; y < top; y++) {
    if (y < 0) continue;
    const flare = (top - y) / 19;
    const x0 = side === 1 ? 0.5 - flare * 0.4 : 0.5 - flare * 1.2;
    const x1 = side === 1 ? 7.5 + flare * 1.2 : 7.5 + flare * 0.4;
    m.box(Math.max(0, x0), y, 0.3 - flare * 0.5, Math.min(8, x1), y + 1, 9.7, SLOT.COAT);
  }
  // doublure visible au bord avant intérieur
  const innerX = side === 1 ? 0 : 7;
  for (let y = top - 3 - length; y < top - 2; y++) {
    if (y < 0) continue;
    m.set(innerX, y, 9, SLOT.COAT2);
  }
  // l'intérieur est creux pour la cuisse : rien à faire (elle est cachée dedans)
  m.setOrigin(4, 15, 5);
  return m;
}

/** Jupe à tournure (mode de 1888) attachée au bassin. */
export function skirt(): VoxelModel {
  const H = 34;
  const m = new VoxelModel(24, H + 1, 26, RES);
  const cx = 12;
  const cz = 12;
  for (let y = 0; y < H; y++) {
    const t = 1 - y / H;
    const rx = 6 + t * 5.2;
    let rzBack = 6 + t * 5.6;
    const rzFront = 5.5 + t * 4.6;
    // tournure : renflement à l'arrière en haut
    if (y > 19 && y < 32) rzBack += Math.sin(((y - 19) / 13) * Math.PI) * 4.5;
    for (let x = 0; x < 24; x++)
      for (let z = 0; z < 26; z++) {
        const dx = (x + 0.5 - cx) / rx;
        const dzv = z + 0.5 - cz;
        const dz = dzv < 0 ? dzv / rzBack : dzv / rzFront;
        if (dx * dx + dz * dz <= 1) m.set(x, y, z, y < 2 ? SLOT.ACCENT : SLOT.DRESS);
      }
  }
  // tablier ou drapé à l'avant
  for (let y = 4; y < 30; y += 7) m.box(cx - 4, y, cz + 5 + (H - y) / 6, cx + 4, y + 1, cz + 6 + (H - y) / 6, SLOT.COAT2);
  m.setOrigin(12, H, 12);
  return m;
}

// --------------------------------------------------------------------------- armes

const GUNMETAL = 0x2b2c30;
const GUNSTEEL = 0x55585e;
const WOOD = 0x5a3a24;
const WOOD_LIGHT = 0x7a5232;

/** Armes : construites le canon vers +Z, origine à la poignée. */
export function weaponModel(kind: 'revolver' | 'shotgun' | 'rifle' | 'knife' | 'club'): VoxelModel {
  switch (kind) {
    case 'revolver': {
      const m = new VoxelModel(3, 7, 12, RES);
      m.box(1, 4, 2, 2, 5, 11, GUNMETAL); // canon
      m.box(0.5, 3.5, 2, 2.5, 5.5, 3, GUNSTEEL);
      m.box(0, 3, 3, 3, 6, 6, GUNSTEEL); // barillet
      m.box(1, 6, 3, 2, 7, 4, GUNMETAL); // chien
      m.box(1, 4, 0, 2, 5, 3, GUNMETAL);
      m.box(0.5, 0, 0, 2.5, 4, 2, WOOD); // crosse
      m.box(1, 2, 2, 2, 3, 4, GUNMETAL); // pontet
      m.set(1, 5, 10, GUNSTEEL);
      m.setOrigin(1.5, 1.5, 1);
      return m;
    }
    case 'shotgun': {
      const m = new VoxelModel(4, 6, 36, RES);
      m.box(0.5, 3, 8, 1.5, 4, 36, GUNMETAL);
      m.box(2, 3, 8, 3, 4, 36, GUNMETAL);
      m.box(0.5, 2, 8, 3, 3, 30, WOOD_LIGHT);
      m.box(0.5, 2, 4, 3, 5, 9, GUNSTEEL);
      m.box(1, 0, -1 + 1, 2.5, 4, 5, WOOD);
      m.box(0.5, 1, -8 + 8, 3, 4, 2, WOOD);
      m.setOrigin(1.75, 2, 5);
      return m;
    }
    case 'rifle': {
      const m = new VoxelModel(3, 6, 42, RES);
      m.box(1, 3, 10, 2, 4, 42, GUNMETAL);
      m.box(0.5, 2, 9, 2.5, 3.5, 34, WOOD_LIGHT);
      m.box(0.5, 2, 5, 2.5, 5, 11, GUNSTEEL);
      m.box(1, 5, 7, 2, 6, 9, GUNSTEEL);
      m.box(1, 0, 3, 2, 3, 7, WOOD);
      m.box(0.5, 1, 0, 2.5, 4, 6, WOOD);
      m.set(1, 4, 41, GUNSTEEL);
      m.setOrigin(1.5, 2, 6);
      return m;
    }
    case 'knife': {
      const m = new VoxelModel(2, 3, 11, RES);
      m.box(0.5, 1, 0, 1.5, 2, 4, WOOD);
      m.box(0, 0.5, 4, 2, 2.5, 5, GUNSTEEL);
      m.box(0.5, 1, 5, 1.5, 2.5, 10, 0xc8ccd2);
      m.set(0.5, 1, 10, 0xc8ccd2);
      m.setOrigin(1, 1.5, 2);
      return m;
    }
    case 'club': {
      const m = new VoxelModel(3, 3, 17, RES);
      m.box(0.5, 0.5, 0, 2.5, 2.5, 6, 0x2a1d14);
      m.box(0, 0, 6, 3, 3, 17, WOOD);
      m.box(0.5, 0.5, 16, 2.5, 2.5, 17, WOOD_LIGHT);
      m.setOrigin(1.5, 1.5, 2);
      return m;
    }
  }
}
