// Têtes au 1/64 m : crâne et visage (yeux avec blanc et iris, sourcils, nez, lèvres, oreilles),
// pilosité faciale, coiffures (volume au-dessus du crâne), couvre-chefs et accessoires du
// visage (lunettes, visières, monocle cybernétique, masques). Toutes ces pièces partagent
// le repère de la tête : origine au pivot du cou, visage vers +Z ; les rangées du visage :
// menton −4, bouche −1, nez 1-2, yeux 3, paupières 4, sourcils 5, front 6-8, sommet 10.

import { SLOT } from '../models/voxelModel';
import type { VoxelModel } from '../models/voxelModel';
import { XS } from './charMesher';
import type { Build } from './rig';
import { hash3, inEllipsoid, Sculpt, segDist, supEll, type Col } from './sculpt';

const EYE_W = 0xeee9e2;
const FRAME = 0x1e2024;
const LASH = 0x231a18;

export type BeardStyle = 'none' | 'stubble' | 'handlebar' | 'boxed' | 'full' | 'goatee' | 'mustache' | 'pencil' | 'chinstrap';
export type FaceShape = 'a' | 'b' | 'c';
export type HairStyle =
  | 'none'
  | 'short'
  | 'slick'
  | 'buzz'
  | 'fade'
  | 'curly'
  | 'afro'
  | 'long'
  | 'ponytail'
  | 'bun'
  | 'bob'
  | 'mohawk'
  | 'pompadour'
  | 'undercut'
  | 'old'
  | 'locs'
  | 'braids'
  | 'sidepart';
export type HatStyle = 'bowler' | 'top' | 'fedora' | 'flatcap' | 'cap' | 'beanie' | 'police' | 'helmet' | 'hood' | 'headset' | 'none';
export type FaceGear = 'none' | 'shades' | 'visor' | 'ar' | 'monocle' | 'mask' | 'cybereye' | 'tint' | 'implant';

/** Tête : morphologie, pilosité, âge, implants. */
export interface HeadDef {
  build: Build;
  shape: FaceShape;
  beard: BeardStyle;
  /** 0 jeune, 1 rides légères, 2 âgé. */
  age: number;
  /** Lignes d'implants lumineux sur la tempe. */
  cyber: boolean;
}

export function headKey(d: HeadDef): string {
  return `${d.build}${d.shape}${d.beard}${d.age}${d.cyber ? 'c' : ''}`;
}

export function parseHeadKey(k: string): HeadDef {
  const build = k[0] as Build;
  const shape = k[1] as FaceShape;
  const cyber = k.endsWith('c');
  const body = cyber ? k.slice(2, -1) : k.slice(2);
  const age = Number(body[body.length - 1]);
  return { build, shape, beard: body.slice(0, -1) as BeardStyle, age, cyber };
}

// --------------------------------------------------------------------- crâne

const CR = { m: { cy: 3.6, cz: -0.2, rx: 5.5, ry: 7.0, rz: 6.6 }, f: { cy: 3.6, cz: -0.3, rx: 5.35, ry: 6.9, rz: 6.4 } };

/** Valeur de la superellipsoïde du crâne gonflée de t (≤ 1 dedans). */
function cran(b: Build, x: number, y: number, z: number, t = 0): number {
  const c = CR[b];
  const n = 2.4;
  return Math.pow(Math.abs(x) / (c.rx + t), n) + Math.pow(Math.abs(y - c.cy) / (c.ry + t), n) + Math.pow(Math.abs(z - c.cz) / (c.rz + t), n);
}

/** Avant du visage (z du dernier voxel plein) par rangée y et colonne |x| (−9 : rien). */
const FACE: Record<Build, Record<number, number[]>> = {
  m: {
    8: [6, 6, 6, 5, 5, 4],
    7: [6, 6, 6, 6, 5, 4],
    6: [6, 6, 6, 6, 5, 4],
    5: [6, 6, 6, 6, 6, 4],
    4: [6, 6, 6, 6, 6, 4],
    3: [6, 6, 5, 5, 5, 4],
    2: [7, 6, 6, 6, 5, 4],
    1: [7, 6, 6, 6, 5, 4],
    0: [6, 6, 6, 5, 5, 3],
    [-1]: [6, 6, 6, 5, 4, 3],
    [-2]: [6, 6, 5, 5, 4, -9],
    [-3]: [6, 5, 5, 4, -9, -9],
    [-4]: [5, 4, 3, -9, -9, -9],
  },
  f: {
    8: [6, 6, 6, 5, 5, 4],
    7: [6, 6, 6, 6, 5, 4],
    6: [6, 6, 6, 6, 5, 4],
    5: [6, 6, 6, 6, 6, 4],
    4: [6, 6, 6, 6, 6, 4],
    3: [6, 6, 5, 5, 5, 4],
    2: [6, 6, 6, 6, 5, 4],
    1: [7, 6, 6, 6, 5, 3],
    0: [6, 6, 6, 5, 4, -9],
    [-1]: [6, 6, 6, 5, 4, -9],
    [-2]: [6, 6, 5, 4, -9, -9],
    [-3]: [6, 5, 4, -9, -9, -9],
    [-4]: [5, 4, -9, -9, -9, -9],
  },
};

/** Tête (sans les cheveux) : origine au pivot du cou. */
export function head(d: HeadDef): VoxelModel {
  const b = d.build;
  const fem = b === 'f';
  const s = new Sculpt(-7.5, 7.5, -6.5, 12.5, -8.5, 9.5);
  const face = FACE[b];
  // largeur de la mâchoire selon la morphologie
  const jaw = d.shape === 'a' ? 0 : d.shape === 'b' ? 0.5 : -0.5;
  s.add((x, y, z) => {
    const ax = Math.abs(x);
    const ix = Math.round(ax);
    const iy = Math.round(y);
    // crâne, sauf l'arrière du bas (place du cou)
    let inside = cran(b, x, y, z) <= 1 && !(y < 1.6 && z < -2.4 + (1.6 - y) * 0.75);
    // visage : du plan z ≥ −1 jusqu'à la profondeur tabulée
    const row = face[iy];
    if (row && ix <= 5) {
      let zf = row[Math.min(5, ix)];
      // mâchoire large : une colonne de plus en bas du visage
      if (jaw > 0 && iy <= 0 && iy >= -3 && zf < 0 && ix <= 5) zf = row[Math.min(5, ix - 1)] - 1;
      if (jaw < 0 && iy <= -1 && ix >= 3) zf -= 1;
      if (zf > -9 && z <= zf + 0.5 && z >= -1.5 + Math.max(0, -iy - 1) * 0.9) inside = true;
      if (zf > -9 && z > zf + 0.5) inside = false;
    }
    if (iy <= 8 && iy >= -4 && !row) inside = inside && z < 4;
    // oreilles
    if (ix === 6 && y > 0.5 && y < 4.5 && z > -1.6 && z < 0.6) return y < 1.5 || z < -1 ? XS.SKIN_D : SLOT.SKIN;
    if (!inside) return -1;
    return SLOT.SKIN;
  });
  // --- traits du visage
  const at = (x: number, y: number) => s.frontZ(x, y);
  const paintF = (x: number, y: number, c: Col) => s.front(x, y, c);
  for (const sx of [-1, 1]) {
    // yeux : blanc, iris, blanc (dans l'orbite), cils
    paintF(sx * 2, 3, EYE_W);
    paintF(sx * 3, 3, SLOT.EYES);
    paintF(sx * 4, 3, fem ? LASH : EYE_W);
    if (fem) {
      paintF(sx * 4, 4, LASH);
      paintF(sx * 3, 4, XS.MAKEUP);
      paintF(sx * 2, 4, XS.MAKEUP);
    }
    // sourcils
    if (fem) {
      paintF(sx * 3, 5, SLOT.HAIR);
      paintF(sx * 4, 5, SLOT.HAIR);
      paintF(sx * 2, 5, XS.SKIN_L);
    } else {
      for (const xx of [2, 3, 4]) paintF(sx * xx, 5, SLOT.HAIR);
    }
    // pommettes, ailes du nez, coins de la bouche
    paintF(sx * 3, 2, XS.SKIN_L);
    paintF(sx * 1, 1, XS.SKIN_D);
    paintF(sx * 2, -1, XS.SKIN_D);
    // tempes
    paintF(sx * 5, 3, XS.SKIN_D);
  }
  // arête du nez, bout du nez
  paintF(0, 2, XS.SKIN_L);
  paintF(0, 3, XS.SKIN_L);
  // bouche : lèvre supérieure (ligne), lèvre inférieure au milieu
  for (const xx of [-1, 0, 1]) paintF(xx, -1, XS.LIP);
  paintF(0, -2, XS.LIP);
  // menton (reflet), dessous ombré
  paintF(0, -3, XS.SKIN_L);
  s.paintSurf((x, y, z, c, nx, ny) => (c === SLOT.SKIN && ny < 0 && y < 0 ? XS.SKIN_D : c));
  // âge : rides du front, pattes-d'oie, sillons nasogéniens
  if (d.age >= 1) {
    for (const sx of [-1, 1]) {
      paintF(sx * 2, 0, XS.SKIN_D);
      if (d.age >= 2) paintF(sx * 5, 4, XS.SKIN_D);
    }
    if (d.age >= 2) for (let x = -3; x <= 3; x++) paintF(x, 7, XS.SKIN_D);
  }
  // implants : lignes lumineuses sur la tempe gauche
  if (d.cyber) {
    for (const [y, z] of [
      [2, 2],
      [3, 3],
      [4, 3],
      [5, 4],
    ])
      s.side(1, y, z, SLOT.NEON);
    s.side(1, 3, 2, SLOT.ACCENT);
  }
  // --- pilosité faciale
  const fz = (x: number, y: number) => at(x, y);
  const grow = (x: number, y: number, c: Col = SLOT.BEARD, dz = 1) => {
    const z = fz(x, y);
    if (Number.isFinite(z)) for (let k = 1; k <= dz; k++) s.set(x, y, z + k, c);
  };
  const shade = (x: number, y: number) => paintF(x, y, SLOT.BEARD);
  switch (d.beard) {
    case 'handlebar': {
      // Dadou : grande moustache en guidon, pointes relevées en crosse
      for (let x = -3; x <= 3; x++) grow(x, 0);
      for (const sx of [-1, 1]) {
        grow(sx * 2, -1);
        grow(sx * 3, -1);
        s.set(sx * 4, -1, 6, SLOT.BEARD);
        s.set(sx * 4, 0, 6, SLOT.BEARD);
        s.set(sx * 5, -0.0, 5, SLOT.BEARD);
        s.set(sx * 5, -1, 5, SLOT.BEARD);
        s.set(sx * 6, 0, 4, SLOT.BEARD);
        s.set(sx * 6, 1, 4, SLOT.BEARD);
        s.set(sx * 6, 2, 4, SLOT.BEARD);
        s.set(sx * 5, 2, 5, SLOT.BEARD);
      }
      // ombre de barbe de trois jours sur le menton
      for (let x = -1; x <= 1; x++) shade(x, -3);
      break;
    }
    case 'boxed':
    case 'full': {
      // barbe taillée (Even) : joues, mâchoire, menton ; moustache ; lèvres dégagées
      const long = d.beard === 'full';
      for (let y = -4; y <= 2; y++)
        for (let x = -5; x <= 5; x++) {
          const ax = Math.abs(x);
          if (y >= 1 && ax < 4) continue;
          if (y === 0 && ax < 3 && ax > 2) continue;
          if ((y === -1 || y === -2) && ax <= 1) continue;
          if (y === -1 && ax === 2) continue;
          if (!Number.isFinite(fz(x, y))) continue;
          grow(x, y, SLOT.BEARD, long && y <= -2 ? 2 : 1);
        }
      for (let x = -2; x <= 2; x++) grow(x, 0);
      // côtés de la mâchoire
      s.add((x, y, z) => (y < 2 && y > -4 && Math.abs(x) > 4.5 && Math.abs(x) < 6 && z > -2 && z < 4 && !(Math.abs(x) > 5.5 && y > 0.5) ? SLOT.BEARD : -1));
      if (long) for (let x = -2; x <= 2; x++) s.set(x, -5, 5, SLOT.BEARD).set(x, -5, 4, SLOT.BEARD);
      break;
    }
    case 'goatee':
      for (let x = -2; x <= 2; x++) grow(x, 0);
      for (let x = -1; x <= 1; x++) {
        grow(x, -3);
        grow(x, -4);
      }
      grow(-2, -2);
      grow(2, -2);
      break;
    case 'mustache':
      for (let x = -2; x <= 2; x++) grow(x, 0);
      grow(-2, -1);
      grow(2, -1);
      break;
    case 'pencil':
      for (const x of [-2, -1, 1, 2]) shade(x, 0);
      break;
    case 'chinstrap':
      for (let x = -5; x <= 5; x++) for (const y of [-3, -4]) shade(x, y);
      for (const sx of [-1, 1]) for (let y = -2; y <= 2; y++) s.side(sx, y, 1, SLOT.BEARD);
      break;
    case 'stubble':
      s.paintSurf((x, y, z, c) => {
        if (c !== SLOT.SKIN && c !== XS.SKIN_D && c !== XS.SKIN_L) return c;
        const ax = Math.abs(x);
        if (y <= 0 && y >= -4 && !(y === -1 && ax <= 1) && !(y === -2 && ax === 0)) return SLOT.BEARD;
        if (y <= 2 && ax >= 4 && z > -2) return SLOT.BEARD;
        return c;
      });
      break;
  }
  return s.m;
}

// --------------------------------------------------------------------- coiffures

/** Zone du cuir chevelu (où poussent les cheveux). */
function scalp(x: number, y: number, z: number, hairline = 7.5): boolean {
  const ax = Math.abs(x);
  if (z > 2.2) return y >= hairline;
  if (z > -1.6) return y >= (ax > 4.5 ? 1.2 : hairline - 1) && !(ax > 5.3 && y < 4.6 && z < 0.8);
  return y >= -0.6;
}

/** Coiffure (au-dessus du crâne), même repère que la tête. */
export function hair(style: HairStyle, b: Build): VoxelModel {
  const s = new Sculpt(-9.5, 9.5, -14.5, 17.5, -11.5, 11.5);
  const shell = (x: number, y: number, z: number, t: number, hl = 7.5) => cran(b, x, y, z, t) <= 1 && cran(b, x, y, z, 0) > 1 && scalp(x, y, z, hl);
  const H = SLOT.HAIR;
  switch (style) {
    case 'short':
      s.add((x, y, z) => (shell(x, y, z, y > 7 ? 1.6 : 1.1) ? H : -1));
      break;
    case 'sidepart':
      s.add((x, y, z) => (shell(x, y, z, y > 7 ? 1.9 + (x > 1 ? 0.3 : 0) : 1.1) ? H : -1));
      s.paintSurf((x, y, z, c, nx, ny) => (ny > 0 && x > -2.6 && x < -1.6 ? XS.HAIR_D : c));
      break;
    case 'slick':
      s.add((x, y, z) => (shell(x, y, z, y > 7 ? 1.5 : 1.0, 7.8) ? H : -1));
      // reflets du gel : stries de l'avant vers l'arrière
      s.paintSurf((x, y, z, c, nx, ny) => (ny > 0 && Math.abs(((x + 20) % 3) - 1) < 0.5 ? XS.HAIR_L : c));
      break;
    case 'buzz':
      s.add((x, y, z) => (shell(x, y, z, 0.9, 8.2) ? XS.HAIR_D : -1));
      break;
    case 'fade':
      s.add((x, y, z) => {
        if (y > 6.5 && shell(x, y, z, 2.1, 7.5)) return H;
        if (shell(x, y, z, 0.9, 7.5)) return y > 4 ? XS.HAIR_D : -1;
        return -1;
      });
      break;
    case 'curly':
      s.add((x, y, z) => (shell(x, y, z, 2.0 + hash3(x, y, z, 7) * 0.9, 7.2) ? (hash3(x, y, z, 3) > 0.7 ? XS.HAIR_D : H) : -1));
      break;
    case 'afro':
      s.add((x, y, z) => {
        if (cran(b, x, y, z) <= 1) return -1;
        if (z > 2.4 && y < 7.3) return -1;
        if (y < 0.5 && z > -2) return -1;
        if (Math.abs(x) > 5.2 && y < 4.6 && z > -1.8 && z < 1) return -1;
        return inEllipsoid(x, y, z, 0, 6.2, -1, 8.6 + hash3(x, y, z, 1) * 0.6, 7.6, 8.4) ? (hash3(x, y, z, 2) > 0.75 ? XS.HAIR_D : H) : -1;
      });
      break;
    case 'long':
    case 'locs':
      s.add((x, y, z) => {
        if (shell(x, y, z, 1.3, 7.2)) return H;
        if (cran(b, x, y, z) <= 1) return -1;
        const ax = Math.abs(x);
        // rideau dans le dos et mèches sur les côtés (par-dessus les oreilles)
        if (z < -2.5 && z > -8.6 && y < 6 && y > -12 && ax < 6.2 - Math.max(0, -y - 6) * 0.15 && cran(b, x, Math.max(y, 2), z, 1.6) <= 1.25) return H;
        if (ax > 4.4 && ax < 7 && y < 6 && y > -6 && z > -3 && z < 3.2) return H;
        return -1;
      });
      if (style === 'locs') s.carve((x, y, z) => y < 2 && Math.abs(((x + z) * 1.3 + 40) % 2.6) < 0.7);
      s.paintSurf((x, y, z, c, nx) => (Math.abs(((x + 30) * 1.1) % 3) < 0.6 && y < 4 ? XS.HAIR_D : c));
      break;
    case 'ponytail':
      s.add((x, y, z) => {
        if (shell(x, y, z, 1.0, 7.4)) return H;
        if (segDist(x, y, z, 0, 5, -7.6, 0, -8, -8.6) < 1.6 - Math.max(0, -y) * 0.05) return y > 3.5 ? SLOT.NEON : H;
        return -1;
      });
      s.paintSurf((x, y, z, c, nx, ny) => (ny > 0 && Math.abs(((x + 20) % 3) - 1) < 0.5 && y > 7 ? XS.HAIR_L : c));
      break;
    case 'bun':
      s.add((x, y, z) => {
        if (shell(x, y, z, 1.0, 7.4)) return H;
        if (inEllipsoid(x, y, z, 0, 9.6, -5.6, 2.8, 2.6, 2.6)) return H;
        if (Math.abs(x) < 3.6 && Math.abs(y - 10.6) < 0.5 && Math.abs(z + 5.6) < 0.5) return SLOT.NEON;
        return -1;
      });
      break;
    case 'bob':
      s.add((x, y, z) => {
        if (cran(b, x, y, z) <= 1) return -1;
        const ax = Math.abs(x);
        // frange
        if (z > 2.2 && y > 6.6 && ax < 5 && cran(b, x, y, z, 1.4) <= 1) return H;
        if (z > 2.2) return y >= 7 && cran(b, x, y, z, 1.4) <= 1 ? H : -1;
        if (y < -2.5) return -1;
        return cran(b, x, Math.max(y, 3), z, 1.6) <= 1 && (ax > 3.8 || z < -1) ? H : cran(b, x, y, z, 1.4) <= 1 ? H : -1;
      });
      break;
    case 'mohawk':
      s.add((x, y, z) => {
        if (shell(x, y, z, 0.8, 8.4) && Math.abs(x) > 1.4) return XS.HAIR_D;
        if (Math.abs(x) > 1.2 || cran(b, x, y, z) <= 1) return -1;
        const zz = Math.max(-6.5, Math.min(6, z));
        const hgt = 4.6 - Math.abs(zz - 1) * 0.12;
        return cran(b, x, y, z, hgt) <= 1 && y > 2 && z > -7.2 && z < 6.8 ? H : -1;
      });
      break;
    case 'pompadour':
      s.add((x, y, z) => {
        if (shell(x, y, z, 1.1, 7.6)) return H;
        if (cran(b, x, y, z) > 1 && inEllipsoid(x, y, z, 0, 10.6, 2.6, 4.6, 3.2, 5.6) && y > 8) return H;
        return -1;
      });
      s.paintSurf((x, y, z, c, nx, ny) => (ny > 0 && Math.abs(((x + 20) % 2.5) - 1) < 0.45 ? XS.HAIR_L : c));
      break;
    case 'undercut':
      s.add((x, y, z) => {
        if (y > 7 && shell(x, y, z, 2.2 + (x > 0 ? 0.5 : 0), 7.4)) return H;
        if (shell(x, y, z, 0.8, 7.4)) return y > 5 ? XS.HAIR_D : -1;
        return -1;
      });
      break;
    case 'old':
      s.add((x, y, z) => (shell(x, y, z, 1.0) && y < 6.4 && (z < 2 || Math.abs(x) > 4.6) ? H : -1));
      break;
    case 'braids':
      s.add((x, y, z) => (shell(x, y, z, 1.0, 7.4) ? (Math.abs(((x + 20) % 2.4) - 1.2) < 0.5 ? XS.HAIR_D : H) : -1));
      s.add((x, y, z) => (segDist(x, y, z, 0, 3, -7.2, 0, -9, -7.8) < 1.1 ? H : -1));
      break;
    case 'none':
      break;
  }
  // reflets en haut, ombre en bas
  if (style !== 'none' && style !== 'slick' && style !== 'pompadour')
    s.paintSurf((x, y, z, c, nx, ny) => (c === H && ny > 0 && y > 9 && hash3(x, y, z, 5) > 0.55 ? XS.HAIR_L : c));
  return s.m;
}

// --------------------------------------------------------------------- couvre-chefs

/** Disque elliptique horizontal (rayons rx, rz). */
const inDisc = (x: number, z: number, rx: number, rz: number, cz = 0) => (x / rx) ** 2 + ((z - cz) / rz) ** 2 <= 1;

/** Couvre-chefs : même repère que la tête (posés sur une coiffure courte). */
export function hat(style: HatStyle): VoxelModel {
  const s = new Sculpt(-10.5, 10.5, -12.5, 22.5, -11.5, 13.5);
  const C = SLOT.HAT;
  switch (style) {
    case 'bowler': {
      // melon : calotte bombée, ruban, fil lumineux, bord roulé relevé sur les côtés
      s.add((x, y, z) => {
        if (y >= 8.2 && y < 15.2) {
          const t = (y - 8.2) / 7;
          const k = Math.sqrt(Math.max(0, 1 - t * t * 0.92));
          if (inDisc(x, z, 6.9 * k + 0.2, 7.4 * k + 0.2, -0.3)) return y < 9.6 ? SLOT.HATBAND : y < 10.4 ? SLOT.NEON : C;
          return -1;
        }
        const curl = Math.abs(x) > 6.6 ? 1 : 0;
        if (y >= 7.2 + curl && y < 8.2 + curl && inDisc(x, z, 8.9, 9.6, -0.2)) return C;
        return -1;
      });
      s.paintSurf((x, y, z, c, nx, ny) => (c === C && ny > 0 && y > 13.5 ? XS.HAT_L : c));
      s.side(1, 9, 1, SLOT.ACCENT);
      break;
    }
    case 'top': {
      // haut-de-forme : bord relevé, haute calotte légèrement évasée, ruban, filet d'argent
      s.add((x, y, z) => {
        if (y >= 8.2 && y < 19.6) {
          const r = 6.2 + (y - 8.2) * 0.03;
          if (supEll(x, z + 0.3, r, r + 0.5, 2.3) <= 1) return y < 10.4 ? SLOT.HATBAND : y < 11.2 ? SLOT.ACCENT : C;
          return -1;
        }
        const curl = Math.abs(x) > 6.8 ? 1 : 0;
        if (y >= 7.4 + curl && y < 8.4 + curl && inDisc(x, z, 8.7, 9.4, -0.3)) return C;
        return -1;
      });
      s.side(1, 9.5, 1, SLOT.NEON);
      s.paintSurf((x, y, z, c, nx, ny) => (c === C && (ny > 0 || (nx < 0 && z > 2)) && y > 17 ? XS.HAT_L : c));
      break;
    }
    case 'fedora': {
      // feutre : calotte pincée, ruban, bord cassé devant
      s.add((x, y, z) => {
        if (y >= 8 && y < 14.2) {
          const t = (y - 8) / 6.2;
          const rx = 6.6 - t * 1.4;
          const rz = 7.2 - t * 1.2;
          if (!inDisc(x, z, rx, rz, -0.4)) return -1;
          if (y > 12.8 && Math.abs(x) < 0.8 && z > -4.6 && z < 4) return -1;
          if (y > 11.6 && z > 3 && Math.abs(Math.abs(x) - 2.6) < 1.1) return -1;
          return y < 9.8 ? SLOT.HATBAND : C;
        }
        const brimY = 7.2 - (z > 4 ? (z - 4) * 0.35 : 0) + (z < -4 ? (-4 - z) * 0.2 : 0);
        if (y >= brimY && y < brimY + 1 && inDisc(x, z, 9.4, 10.2, -0.2)) return C;
        return -1;
      });
      break;
    }
    case 'flatcap': {
      s.add((x, y, z) => {
        if (y >= 7.6 && y < 11.2 - Math.max(0, z - 2) * 0.22 && inDisc(x, z, 6.9, 7.8, 0.6)) return C;
        if (y >= 7.4 && y < 8.4 && z > 5 && z < 10 && inDisc(x, z, 5.4, 9.6, 1.5)) return C;
        return -1;
      });
      s.paintSurf((x, y, z, c, nx, ny) => (ny > 0 && Math.abs(x) < 0.5 ? SLOT.HATBAND : c));
      break;
    }
    case 'cap': {
      s.add((x, y, z) => {
        if (y >= 7.4 && y < 13.4) {
          const t = (y - 7.4) / 6;
          const k = Math.sqrt(Math.max(0, 1 - t * t * 0.9));
          if (inDisc(x, z, 6.7 * k + 0.2, 7.3 * k + 0.2, -0.2)) return C;
        }
        if (y >= 7.2 && y < 8.1 && z > 4.5 && inDisc(x, z, 5.6, 11.4, 0)) return SLOT.HATBAND;
        if (Math.abs(x) < 0.6 && Math.abs(z + 0.2) < 0.6 && y >= 13.4 && y < 14.2) return SLOT.HATBAND;
        return -1;
      });
      s.front(0, 10, SLOT.NEON);
      s.front(-1, 10, SLOT.NEON);
      s.front(0, 11, SLOT.NEON);
      break;
    }
    case 'beanie': {
      s.add((x, y, z) => {
        if (y < 6.4 || y > 14) return -1;
        const t = Math.max(0, (y - 9) / 5);
        const k = Math.sqrt(Math.max(0, 1 - t * t * 0.95));
        const cuff = y < 8.6 ? 0.4 : 0;
        if (!inDisc(x, z, 6.8 * k + cuff, 7.5 * k + cuff, -0.3)) return -1;
        if (y < 8.6) return SLOT.HATBAND;
        return Math.abs(((x + 20) % 2) - 1) < 0.4 ? XS.HAT_L : C;
      });
      s.front(2, 7.5, SLOT.NEON);
      break;
    }
    case 'police': {
      // casquette du NYPD 2085 : calotte à flancs droits, bandeau lumineux, insigne, visière vernie
      s.add((x, y, z) => {
        if (y >= 7.8 && y < 13.2 && supEll(x, z + 0.1, 6.8 + (y - 7.8) * 0.05, 7.4 + (y - 7.8) * 0.08, 3) <= 1) return y < 9.2 ? SLOT.HATBAND : y < 9.9 ? SLOT.LED : C;
        if (y >= 7.3 && y < 8.0 && z > 4.8 && inDisc(x, z, 5.8, 10.6, 0)) return SLOT.HATBAND;
        return -1;
      });
      for (const [x, y] of [
        [0, 10.5],
        [0, 11.5],
        [-1, 11],
        [1, 11],
        [0, 12.4],
      ])
        s.front(x, y, SLOT.ACCENT);
      break;
    }
    case 'helmet': {
      // casque tactique : coque, visière sombre barrée d'un trait lumineux, protections d'oreilles
      s.add((x, y, z) => {
        const r = supEll(x, z + 0.4, 7.5, 8.2, 2.3) + Math.pow(Math.max(0, y - 4.6) / 9.4, 2.3);
        if (r > 1 || y < 0.8) return -1;
        if (cran('m', x, y, z, 1.4) <= 1) return -1;
        if (z > 2.6 && y < 7.6) {
          // ouverture du visage, visière devant les yeux
          if (y > 2 && Math.abs(x) < 5.6 && z > 6.2) return Math.abs(y - 4.5) < 0.5 ? SLOT.NEON : SLOT.GLASS;
          return -1;
        }
        if (Math.abs(x) > 6.6 && y < 6 && y > 1.5 && z > -2 && z < 2) return SLOT.HATBAND;
        return y > 7.6 && y < 8.4 ? SLOT.HATBAND : C;
      });
      s.add((x, y, z) => (Math.abs(x) < 0.7 && y > 13 && y < 14.6 && z > -5 && z < 5 && cran('m', x, y - 1, z, 3.6) <= 1.05 ? SLOT.HATBAND : -1));
      s.side(1, 4, 0, SLOT.LED);
      break;
    }
    case 'hood': {
      // capuche relevée : tombe sur la nuque et le haut du dos
      s.add((x, y, z) => {
        const outer = inEllipsoid(x, y, z, 0, 4.6, -0.8, 7.9, 8.4, 8.2);
        if (!outer) {
          if (y < 1 && y > -11 && z < -1 && z > -9.5 && Math.abs(x) < 6.6 - Math.max(0, -y - 4) * 0.2 && z < -1 - Math.max(0, -y) * 0.15) return SLOT.COAT;
          return -1;
        }
        if (cran('m', x, y, z, 1.5) <= 1) return -1;
        if (z > 2.4 && Math.abs(x) < 5.4 && y < 9 && y > -3.6) return -1;
        if (y < -2.5 && z > -1) return -1;
        return z > 5.2 ? SLOT.COAT2 : SLOT.COAT;
      });
      break;
    }
    case 'headset': {
      // casque audio : arceau, écouteurs à anneau lumineux, micro
      s.add((x, y, z) => {
        const ax = Math.abs(x);
        if (ax > 5.6 && ax < 7.6 && y > 0.6 && y < 5.4 && z > -2.2 && z < 1.4) return ax > 6.8 && Math.hypot(y - 3, z + 0.4) < 1.3 ? SLOT.NEON : SLOT.HATBAND;
        const r = Math.hypot(x / 6.8, (y - 3.2) / 8.6);
        if (Math.abs(r - 1) < 0.07 && y > 3 && Math.abs(z + 0.4) < 0.9) return SLOT.HATBAND;
        if (segDist(x, y, z, -6.4, 1.2, 0.6, -3.2, -1.2, 6.2) < 0.55) return SLOT.HATBAND;
        return -1;
      });
      break;
    }
    case 'none':
      break;
  }
  return s.m;
}

// --------------------------------------------------------------------- visage : lunettes, masques

/** Accessoires du visage, même repère que la tête. */
export function faceGear(style: FaceGear): VoxelModel {
  const s = new Sculpt(-7.5, 7.5, -5.5, 7.5, -3.5, 9.5);
  const at = (x: number, y: number, z: number, c: Col) => s.set(x, y, z, c);
  switch (style) {
    case 'shades':
    case 'tint': {
      const lens: Col = style === 'tint' ? SLOT.GLASS : SLOT.GLASS;
      const frame: Col = style === 'tint' ? SLOT.ACCENT : FRAME;
      for (const sx of [-1, 1]) {
        for (const x of [2, 3, 4]) at(sx * x, 3, 7, lens);
        for (const x of [2, 3, 4]) at(sx * x, 4, 7, frame);
        at(sx * 4.6, 3, 6.6, frame);
        for (let z = -1; z <= 6; z++) at(sx * 6, 4, z, frame);
      }
      at(-1, 4, 7, frame);
      at(0, 4, 7, frame);
      at(1, 4, 7, frame);
      break;
    }
    case 'ar': {
      // lunettes de réalité augmentée : verre lumineux, monture d'argent
      for (const sx of [-1, 1]) {
        for (const x of [2, 3, 4]) at(sx * x, 3, 7, SLOT.NEON);
        for (let z = 0; z <= 6; z++) at(sx * 6, 4, z, SLOT.ACCENT);
        at(sx * 5, 3.5, 6, SLOT.ACCENT);
      }
      for (let x = -4; x <= 4; x++) at(x, 4, 7, SLOT.ACCENT);
      break;
    }
    case 'visor': {
      // visière enveloppante lumineuse
      for (let x = -5; x <= 5; x++) {
        at(x, 3, 7, Math.abs(x) <= 4 ? SLOT.NEON : FRAME);
        at(x, 4, 7, FRAME);
      }
      for (const sx of [-1, 1]) for (let z = 1; z <= 6; z++) {
        at(sx * 6, 3, z, z > 4 ? SLOT.NEON : FRAME);
        at(sx * 6, 4, z, FRAME);
      }
      break;
    }
    case 'monocle': {
      // Even : monocle cybernétique sur l'œil gauche (cerclage d'argent, lentille cyan),
      // implant sur la tempe relié par un fil
      for (const [x, y] of [
        [2, 2],
        [3, 2],
        [4, 2],
        [2, 4],
        [3, 4],
        [4, 4],
        [2, 3],
        [4, 3],
      ])
        at(x, y, 7, SLOT.ACCENT);
      at(3, 3, 7, SLOT.NEON_CYAN);
      at(5, 3, 6, SLOT.ACCENT);
      at(5, 3, 5, SLOT.ACCENT);
      for (const [y, z] of [
        [3, 4],
        [4, 3],
        [5, 2],
      ])
        at(6, y, z, SLOT.ACCENT);
      at(6, 4, 2, SLOT.NEON_CYAN);
      at(6, 5, 1, SLOT.NEON_CYAN);
      break;
    }
    case 'mask': {
      // masque filtrant : bas du visage, cartouches lumineuses
      s.add((x, y, z) => {
        const ax = Math.abs(x);
        if (y > 1.6 || y < -4.6) return -1;
        if (ax > 5.4) return -1;
        const zf = 7 - Math.max(0, ax - 2) * 0.55 - Math.max(0, -y - 3) * 0.8;
        if (z > zf + 0.5 || z < zf - 1.5) return -1;
        return y > 0.6 ? SLOT.DRESS : XS.DRESS_D;
      });
      for (const sx of [-1, 1]) {
        s.add((x, y, z) => (Math.hypot(x - sx * 4.6, y + 1.4) < 1.5 && z > 4 && z < 7 ? (z > 6 ? SLOT.NEON : FRAME) : -1));
      }
      for (let x = -1; x <= 1; x++) at(x, -1, 8, FRAME);
      break;
    }
    case 'cybereye': {
      // œil droit cybernétique : plaque de métal, lentille rouge
      for (const [x, y] of [
        [-2, 2],
        [-3, 2],
        [-4, 2],
        [-2, 4],
        [-3, 4],
        [-4, 4],
        [-2, 3],
        [-4, 3],
        [-5, 3],
        [-5, 4],
      ])
        at(x, y, 6.6, SLOT.ACCENT);
      at(-3, 3, 6.6, SLOT.NEON_RED);
      at(-6, 4, 2, SLOT.ACCENT);
      at(-6, 3, 3, SLOT.NEON_RED);
      break;
    }
    case 'implant': {
      for (const [y, z] of [
        [1, 3],
        [2, 4],
        [3, 4],
      ])
        at(-5.6, y, z, SLOT.NEON);
      break;
    }
    case 'none':
      break;
  }
  return s.m;
}
