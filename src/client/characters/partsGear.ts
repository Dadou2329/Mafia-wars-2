// Armes tenues par les personnages (vue à la troisième personne, 1/64 m, mêmes modèles que
// la vue subjective : Vektor, Wasp, Hammer, Longbow, lame thermique, matraque électrique),
// grenade, téléphone, et tourelle de sécurité (1/32 m).
// Repère des armes : canon vers +Z, haut vers +Y, origine au centre de la poignée (là où se
// referme la main droite). Les lames et la matraque prolongent la poignée vers +Y.

import { SLOT, VoxelModel } from '../models/voxelModel';
import { Sculpt, segDist, type Col } from './sculpt';

export type WeaponKind = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'knife' | 'club' | 'grenade' | 'phone';

const GUNMETAL = 0x2b2c31;
const STEEL = 0x4f555f;
const STEEL_HI = 0x7a828e;
const POLY = 0x1d1e22;
const POLY_HI = 0x2f3137;
const WASP = 0xe0a81f;
const HAMMER = 0x9a2820;
const COPPER = 0xb87440;
const RUBBER = 0x18191c;
const BLADE = 0x8a9099;
const BLADE_DK = 0x50555d;
const BORE = 0x0b0c0f;

/** Points remarquables des armes (voxels, repère de l'arme). */
export interface WeaponMeta {
  /** Bouche du canon (pointe de la lame). */
  muzzle: [number, number, number];
  /** Point d'appui de la main gauche (longuesse, poignée avant), ou null. */
  support: [number, number, number] | null;
  /** Talon de crosse (appuyé au creux de l'épaule en visée), ou null. */
  butt: [number, number, number] | null;
}

export const WEAPON_META: Record<WeaponKind, WeaponMeta> = {
  pistol: { muzzle: [0, 6, 12], support: null, butt: null },
  smg: { muzzle: [0, 5, 21.5], support: [0, -1.5, 11], butt: null },
  shotgun: { muzzle: [0, 6.5, 43.5], support: [0, 3.5, 22], butt: [0, 3, -23] },
  rifle: { muzzle: [0, 6, 53.5], support: [0, 1, 23], butt: [0, 3.5, -24] },
  knife: { muzzle: [0, 17, 0], support: null, butt: null },
  club: { muzzle: [0, 25, 0], support: null, butt: null },
  grenade: { muzzle: [0, 0, 0], support: null, butt: null },
  phone: { muzzle: [0, 0, 0], support: null, butt: null },
};

/** Poignée de pistolet inclinée (2 × 3 voxels) de y0 à y1. */
function grip(s: Sculpt, y0: number, y1: number, c: Col = POLY, rake = 0.18): void {
  s.add((x, y, z) => {
    if (y < y0 || y > y1 || Math.abs(x) > 1) return -1;
    const zc = -(y1 - y) * rake;
    return Math.abs(z - zc) < 1.5 ? (Math.abs(z - zc - 1) < 0.5 && Math.round(y) % 2 === 0 ? POLY_HI : c) : -1;
  });
}

/** Pontet et détente. */
function guard(s: Sculpt, y: number, z0: number, z1: number): void {
  s.add((x, yy, z) => (Math.abs(x) < 0.6 && ((Math.abs(yy - y) < 0.5 && z > z0 && z < z1) || (Math.abs(z - z1 + 0.5) < 0.5 && yy > y && yy < y + 2.5)) ? GUNMETAL : -1));
  s.add((x, yy, z) => (Math.abs(x) < 0.6 && Math.abs(z - (z0 + 1.6)) < 0.5 && yy > y + 0.5 && yy < y + 2 ? STEEL_HI : -1));
}

export function weaponModel(kind: WeaponKind): VoxelModel {
  switch (kind) {
    case 'pistol': {
      // Vektor : culasse acier liserée de cyan, carcasse polymère, module de visée
      const s = new Sculpt(-1, 1, -6, 8, -3, 13);
      grip(s, -5, 3);
      s.add((x, y, z) => {
        if (Math.abs(x) > 1) return -1;
        if (y >= 5 && y < 7.5 && z > -2 && z < 12) return y > 6.5 ? STEEL_HI : z > 11 ? GUNMETAL : STEEL;
        if (y >= 3 && y < 5 && z > -1.5 && z < 11) return POLY;
        return -1;
      });
      guard(s, 2.5, 1, 5);
      for (const x of [-0.5, 0.5]) for (let z = 3; z <= 8; z++) s.side(x > 0 ? 1 : -1, 5.5, z + 0.5, SLOT.NEON_CYAN);
      s.set(0.5, 6, 11.5, BORE);
      s.set(-0.5, 7.5, 10.5, SLOT.NEON_CYAN);
      s.set(-0.5, -4.5, -0.8, SLOT.NEON_CYAN);
      return s.m;
    }
    case 'smg': {
      // Wasp : boîtier rayé jaune et noir, chargeur translucide dessus, poignée avant
      const s = new Sculpt(-1.5, 1.5, -6, 10, -5, 23);
      grip(s, -5, 2);
      grip(s, -4.5, 2, POLY, 0.05);
      s.carve((x, y, z) => y < 2 && z > 2.5 && z < 9);
      s.add((x, y, z) => {
        const ax = Math.abs(x);
        if (y >= 2 && y < 7 && z > -4 && z < 14 && ax < 1.5) return (Math.floor(z + y) & 3) < 2 && y > 3 && y < 6 ? WASP : POLY;
        if (y >= 7 && y < 9 && z > -2.5 && z < 10 && ax < 1.2) return Math.round(z) % 2 === 0 && y > 7.6 ? SLOT.NEON_AMBER : SLOT.GLASS;
        if (y >= 3.5 && y < 6.5 && z >= 14 && z < 21 && ax < 1.2) return z > 19 ? GUNMETAL : STEEL;
        return -1;
      });
      // poignée avant (main gauche)
      s.add((x, y, z) => (Math.abs(x) < 1 && y > -4.5 && y < 2 && Math.abs(z - 11) < 1.4 ? POLY : -1));
      guard(s, 1.5, 0.5, 4);
      s.set(0, 5, 21.5, BORE);
      return s.m;
    }
    case 'shotgun': {
      // Hammer : boîte massive à panneaux rouges, canon sur tube-magasin, pompe crantée, crosse
      const s = new Sculpt(-1.5, 1.5, -6, 9, -25, 45);
      grip(s, -5, 2.5, POLY, 0.3);
      s.add((x, y, z) => {
        const ax = Math.abs(x);
        if (ax > 1.5) return -1;
        // boîte de culasse
        if (y >= 2 && y < 8 && z > -3 && z < 11) return y > 3 && y < 6 && ax > 0.9 && z > -1 && z < 9 ? HAMMER : y > 7 ? STEEL_HI : GUNMETAL;
        // canon et tube-magasin
        if (y >= 6 && y < 7.6 && z >= 11 && z < 43.5 && ax < 1) return z > 42 ? BORE : STEEL;
        if (y >= 3.5 && y < 5.6 && z >= 11 && z < 37 && ax < 1) return GUNMETAL;
        // pompe
        if (y >= 2.2 && y < 6 && z >= 16 && z < 28) return Math.round(z) % 2 === 0 ? POLY_HI : POLY;
        // crosse : talon plus bas que la poignée
        if (z <= -3 && z > -24) {
          const u = (-3 - z) / 21;
          const top = 7 - u * 2;
          const bot = 2 - u * 4.5;
          if (y < top && y >= bot && ax < 1.2) return z < -22.5 ? RUBBER : y < bot + 1 ? POLY_HI : POLY;
        }
        return -1;
      });
      guard(s, 1.5, 0.5, 4);
      s.set(0, 7.6, 41.5, SLOT.NEON_RED);
      return s.m;
    }
    case 'rifle': {
      // Longbow : deux rails de cuivre, bobines lumineuses, lunette, cellule d'énergie, crosse squelette
      const s = new Sculpt(-2, 2, -7, 13, -26, 55);
      grip(s, -5, 2.5, POLY, 0.3);
      s.add((x, y, z) => {
        const ax = Math.abs(x);
        if (y >= 2 && y < 9 && z > -4 && z < 14 && ax < 1.5) return y > 4 && y < 6 && ax > 0.9 ? SLOT.NEON_CYAN : POLY;
        // rails supérieur et inférieur
        if (z >= 14 && z < 53 && ax < 1) {
          if (y >= 8 && y < 9.4) return y < 8.6 ? COPPER : STEEL;
          if (y >= 2.6 && y < 4) return y > 3.4 ? COPPER : STEEL;
        }
        // bobines (anneaux autour des rails)
        if ((Math.abs(z - 22) < 0.8 || Math.abs(z - 31) < 0.8 || Math.abs(z - 40) < 0.8) && ax < 2 && y >= 2 && y < 10.2 && !(ax < 1 && y > 4 && y < 8)) return SLOT.NEON_CYAN;
        // frein de bouche
        if (z >= 52 && z < 54 && ax < 1.6 && y >= 1.6 && y < 10.2 && !(ax < 0.8 && y > 4 && y < 8)) return GUNMETAL;
        // garde-main sous le rail inférieur
        if (z >= 15 && z < 30 && ax < 1.2 && y >= 0 && y < 2.6) return Math.round(z) % 3 === 0 ? POLY_HI : POLY;
        // lunette
        if (y >= 9 && y < 12 && z > 1 && z < 12 && ax < 1.1) return y > 11 && z > 10 ? SLOT.NEON_CYAN : z > 10.6 || z < 2 ? SLOT.GLASS : POLY;
        // cellule d'énergie sous la boîte
        if (y >= -2.5 && y < 2 && z > 5 && z < 11 && ax < 1.2) return ax > 0.6 && y > -1.5 && y < 1 ? SLOT.NEON_CYAN : POLY;
        // crosse squelette
        if (z <= -4 && z > -25 && ax < 1.1) {
          const u = (-4 - z) / 21;
          const top = 8 - u * 1.5;
          const bot = 1.5 - u * 4;
          if (y < top && y >= top - 1.6) return POLY;
          if (y >= bot && y < bot + 1.6) return POLY;
          if (z < -23) return y < top && y >= bot ? RUBBER : -1;
          if (Math.abs(z + 13) < 0.8 && y < top && y >= bot) return POLY;
        }
        return -1;
      });
      guard(s, 1.5, 0.5, 4);
      return s.m;
    }
    case 'knife': {
      // lame thermique : manche caoutchouté, garde, lame au tranchant chauffé au rouge
      const s = new Sculpt(-0.5, 0.5, -5, 18, -2, 3);
      s.add((x, y, z) => {
        if (y < -4.5 || y > 17.5) return -1;
        if (y < 4) return Math.abs(z) < 1.2 ? (Math.round(y) % 2 === 0 ? 0x26272b : RUBBER) : -1;
        if (y < 5) return Math.abs(z) < 2 ? STEEL : -1;
        const tip = y > 14 ? (y - 14) * 0.7 : 0;
        if (z < -0.6 + tip * 0.3 || z > 1.6 - tip) return -1;
        return z > 1 ? SLOT.NEON_AMBER : z > 0.2 ? 0x8a3a1c : z > -0.2 ? BLADE : BLADE_DK;
      });
      return s.m;
    }
    case 'club': {
      // matraque électrique télescopique : poignée, anneau lumineux, fût, électrodes bleues
      const s = new Sculpt(-1, 1, -6, 26, -1, 1);
      s.add((x, y, z) => {
        const r = Math.hypot(x, z);
        if (y < -5.5 || y > 25.5) return -1;
        if (y < 4) return r < 1.2 ? (Math.round(y) % 2 === 0 ? 0x26272b : RUBBER) : -1;
        if (y < 5) return r < 1.2 ? SLOT.NEON_BLUE : -1;
        if (y < 14) return r < 0.8 ? POLY : -1;
        if (y < 23) return r < 0.6 ? STEEL : -1;
        return r < 1 ? SLOT.NEON_BLUE : -1;
      });
      return s.m;
    }
    case 'grenade': {
      const s = new Sculpt(-2, 2, -2, 3, -2, 2);
      s.add((x, y, z) => (Math.hypot(x, y * 0.9, z) < 2 ? (Math.abs(y) < 0.5 ? SLOT.NEON_RED : 0x3a4030) : Math.abs(x) < 0.6 && y > 1.5 && y < 2.8 && Math.abs(z) < 0.6 ? STEEL : -1));
      return s.m;
    }
    case 'phone': {
      // téléphone tenu dans la main : dalle lumineuse tournée vers le visage
      const s = new Sculpt(-0.5, 0.5, -1, 9, -3, 3);
      s.add((x, y, z) => (y > -0.5 && y < 8.5 && Math.abs(z) < 2.2 ? (x < 0 ? (Math.abs(z) < 1.6 && y > 0.5 && y < 7.5 ? SLOT.SCREEN : 0x16171a) : 0x16171a) : -1));
      return s.m;
    }
  }
}

// ----------------------------------------------------------------------- tourelle (1/32 m)

const R32 = 1 / 32;

function fill(m: VoxelModel, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number): void {
  m.box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1) + 1, Math.max(y0, y1) + 1, Math.max(z0, z1) + 1, c);
}
function paint(m: VoxelModel, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number): void {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (m.get(x, y, z) >= 0) m.set(x, y, z, c);
}
function front(m: VoxelModel, x0: number, x1: number, y0: number, y1: number, c: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (let z = m.sz - 1; z >= 0; z--)
        if (m.get(x, y, z) >= 0) {
          m.set(x, y, z, c);
          break;
        }
}
function back(m: VoxelModel, x0: number, x1: number, y0: number, y1: number, c: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (let z = 0; z < m.sz; z++)
        if (m.get(x, y, z) >= 0) {
          m.set(x, y, z, c);
          break;
        }
}
function band(m: VoxelModel, y: number, c: number): void {
  for (let z = 0; z < m.sz; z++)
    for (let x = 0; x < m.sx; x++) {
      if (m.get(x, y, z) < 0) continue;
      if (m.get(x - 1, y, z) < 0 || m.get(x + 1, y, z) < 0 || m.get(x, y, z - 1) < 0 || m.get(x, y, z + 1) < 0) m.set(x, y, z, c);
    }
}

/** Socle de tourelle de sécurité (origine au sol, centre). Couleurs de la tenue (COAT, COAT2…). */
export function turretBase(): VoxelModel {
  const m = new VoxelModel(22, 28, 22, R32);
  fill(m, 3, 18, 0, 1, 3, 18, SLOT.SHOES);
  fill(m, 0, 21, 0, 0, 9, 12, SLOT.SHOES);
  fill(m, 9, 12, 0, 0, 0, 21, SLOT.SHOES);
  fill(m, 5, 16, 2, 6, 5, 16, SLOT.COAT2);
  band(m, 6, SLOT.ACCENT);
  fill(m, 7, 14, 7, 23, 7, 14, SLOT.COAT);
  for (let y = 10; y <= 20; y++) {
    front(m, 10, 11, y, y, SLOT.NEON);
    back(m, 10, 11, y, y, SLOT.NEON);
  }
  paint(m, 7, 7, 10, 20, 10, 11, SLOT.NEON);
  paint(m, 14, 14, 10, 20, 10, 11, SLOT.NEON);
  fill(m, 5, 16, 24, 27, 5, 16, SLOT.PANTS);
  band(m, 25, SLOT.ACCENT);
  m.setOrigin(11, 0, 11);
  return m;
}

/** Hauteur du sommet du socle (m). */
export const TURRET_BASE_Y = 28 * R32;
/** Hauteur (m) de l'axe de site de la tourelle au-dessus du sol. */
export const TURRET_PIVOT_Y = 36.5 * R32;

/** Fourche de la tourelle (tourne en lacet) : origine au sommet du socle (axe vertical). */
export function turretYoke(): VoxelModel {
  const m = new VoxelModel(18, 12, 10, R32);
  fill(m, 2, 15, 0, 1, 1, 8, SLOT.PANTS);
  for (const x0 of [0, 16]) fill(m, x0, x0 + 1, 0, 11, 2, 7, SLOT.COAT);
  paint(m, 0, 17, 7, 10, 2, 7, SLOT.COAT2);
  paint(m, 0, 0, 8, 9, 4, 5, SLOT.ACCENT);
  paint(m, 17, 17, 8, 9, 4, 5, SLOT.ACCENT);
  m.setOrigin(9, 0, 5);
  return m;
}

/** Canon de la tourelle (site + lacet) : origine sur l'axe de site, bouches vers +Z. */
export function turretGun(): VoxelModel {
  const m = new VoxelModel(16, 13, 32, R32);
  fill(m, 4, 11, 1, 8, 0, 19, SLOT.COAT);
  for (const y of [2, 4, 6]) back(m, 4, 11, y, y, SLOT.ACCENT);
  paint(m, 4, 4, 7, 7, 4, 16, SLOT.NEON);
  paint(m, 11, 11, 7, 7, 4, 16, SLOT.NEON);
  fill(m, 2, 13, 0, 9, 18, 19, SLOT.COAT2);
  for (const x of [5, 9]) {
    fill(m, x, x + 1, 3, 4, 20, 31, GUNMETAL);
    fill(m, x - 1, x + 2, 2, 5, 28, 29, SLOT.PANTS);
  }
  fill(m, 6, 9, 9, 11, 8, 15, SLOT.COAT);
  front(m, 6, 9, 9, 11, SLOT.GLASS);
  front(m, 7, 8, 10, 10, SLOT.NEON);
  fill(m, 12, 13, 1, 6, 6, 14, SLOT.DRESS);
  paint(m, 12, 13, 6, 6, 6, 14, SLOT.ACCENT);
  m.setOrigin(8, 5, 10);
  return m;
}

/** Bouche du canon droit de la tourelle dans le repère du canon (m) ; le gauche est symétrique. */
export const TURRET_MUZZLE: [number, number, number] = [-2 * R32, -1 * R32, 22 * R32];

void segDist;
