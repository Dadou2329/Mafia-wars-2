// Implants cybernétiques des personnages au 1/64 m (vue à la troisième personne).
//
// - Bras : avant-bras mécanique (manche coupée au coude, revers, articulation du coude,
//   coque d'alliage, poignet) portant l'organe de l'implant (lanceur du grappin, logement du
//   pistolet Viper, fourreau de la lame Mantis, vérins du poing, émetteur du bouclier, anneaux du
//   répulseur, bobines Tesla, interface et câbles du bras tactique, électroaimants du grip,
//   nacelle de micro-roquettes, bobine du fouet) ; main mécanique (même squelette que la main de
//   chair, décor selon l'implant) ; pièces mobiles séparées (plaques, canon, lame, tiges de
//   vérin, crochet, nacelle et capot, sondes, ailettes, segment du filament).
// - Jambes : pièces composées par os (cuisse, jambe, pied) pour toute combinaison d'implants
//   (jusqu'à trois), posées sur la surface d'un pantalon type : vérins des mollets, propulseurs
//   des talons et des chevilles, compresseur du genou, fibres musculaires, patins des tibias,
//   amortisseurs, roues de course murale, lames-ressorts, semelles amorties.
// - Torse et colonne : pièces posées sur la surface du vêtement réel (style du torse) : plaques
//   sous-cutanées, port du cœur de secours, cellules de l'accumulateur, plastron de surcharge,
//   collier antichoc, injecteurs de nanobots ; gyroscopes, faisceau de fibres, vertèbres, treuil.
// - Tête : lentille télescopique, lunettes, réticule, monocle tactique, visière de scan, puces
//   des tempes, couronne neuronale, capteurs, ports de la nuque, antennes.
// Repère et conventions : ceux des membres (parts.ts) ; les pièces latérales sont construites
// à gauche (+X = extérieur) puis copiées en miroir ; couleurs lumineuses : glow(couleur, canal).

import { IMPLANT_BY_ID, QUALITY_COLOR } from '../../shared/implants';
import { mix, SLOT, type VoxelModel } from '../models/voxelModel';
import { glow } from './charMesher';
import { GLOW_CH, HAND_STYLE, type ArmImplant, type CyHandStyle } from './cyber';
import * as B from './partsBody';
import { DIMS, type Build } from './rig';
import { hash3, inEllipsoid, Sculpt, segDist, supEll, type Col } from './sculpt';

// ------------------------------------------------------------------ palette des implants

/** Alliage des plaques, arêtes éclairées, plaques sombres. */
const AL = 0x7d8590;
const AL_HI = 0xb3bbc6;
const AL_DK = 0x464c56;
/** Graphite des articulations et des logements. */
const GR = 0x24272d;
const GR_HI = 0x363a42;
const CHROME = 0xccd4de;
const CARBON = 0x17181c;
const COPPER = 0xb8743e;
const GOLD = 0xd9a640;
const RUBBER = 0x1c1d20;
const FOAM = 0x56606e;
const FOAM_DK = 0x3c444f;
const BORE = 0x0b0c0f;
const BLADE_C = 0x9ea6b1;
const HAZARD = 0xd8a020;

const colorOf = (id: string) => IMPLANT_BY_ID[id]?.color ?? 0x4fd8ff;

// ------------------------------------------------------------------ sonde de surface

/** Interroge un modèle voxel (membre de base) en coordonnées continues du membre. */
class Probe {
  constructor(readonly m: VoxelModel) {}
  inside(x: number, y: number, z: number): boolean {
    return this.m.get(Math.floor(x + this.m.ox), Math.floor(y + this.m.oy), Math.floor(z + this.m.oz)) >= 0;
  }
  /** Face avant (+Z) de la colonne (x, y), NaN si vide. */
  front(x: number, y: number): number {
    const m = this.m;
    const i = Math.floor(x + m.ox);
    const j = Math.floor(y + m.oy);
    for (let k = m.sz - 1; k >= 0; k--) if (m.get(i, j, k) >= 0) return k + 1 - m.oz;
    return NaN;
  }
  /** Face arrière (−Z). */
  back(x: number, y: number): number {
    const m = this.m;
    const i = Math.floor(x + m.ox);
    const j = Math.floor(y + m.oy);
    for (let k = 0; k < m.sz; k++) if (m.get(i, j, k) >= 0) return k - m.oz;
    return NaN;
  }
  /** Flanc +X (sign > 0) ou −X de la rangée (y, z). */
  side(sign: number, y: number, z: number): number {
    const m = this.m;
    const j = Math.floor(y + m.oy);
    const k = Math.floor(z + m.oz);
    if (sign > 0) {
      for (let i = m.sx - 1; i >= 0; i--) if (m.get(i, j, k) >= 0) return i + 1 - m.ox;
    } else for (let i = 0; i < m.sx; i++) if (m.get(i, j, k) >= 0) return i - m.ox;
    return NaN;
  }
  /** Dessus (+Y) de la colonne (x, z). */
  top(x: number, z: number): number {
    const m = this.m;
    const i = Math.floor(x + m.ox);
    const k = Math.floor(z + m.oz);
    for (let j = m.sy - 1; j >= 0; j--) if (m.get(i, j, k) >= 0) return j + 1 - m.oy;
    return NaN;
  }
  /** Rayon de la surface dans la direction φ (0 = avant +Z, π/2 = +X) autour de (cx, cz). */
  radial(y: number, phi: number, cx = 0, cz = 0): number {
    const dx = Math.sin(phi);
    const dz = Math.cos(phi);
    let r = 0;
    for (let t = 0; t < 14; t += 0.25) if (this.inside(cx + dx * t, y, cz + dz * t)) r = t;
    return r;
  }
  /** Juste à l'extérieur de la surface (à moins de t voxels, dans le plan horizontal). */
  near(x: number, y: number, z: number, t: number): boolean {
    if (this.inside(x, y, z)) return false;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      if (this.inside(x + Math.cos(ang) * t, y, z + Math.sin(ang) * t)) return true;
    }
    return false;
  }
}

const probeCache = new Map<string, Probe>();
function probe(key: string, make: () => VoxelModel): Probe {
  let p = probeCache.get(key);
  if (!p) probeCache.set(key, (p = new Probe(make())));
  return p;
}

// ================================================================== BRAS

interface ArmCtx {
  id: ArmImplant;
  q: number;
  b: Build;
  R: boolean;
  /** Longueur de l'avant-bras (voxels, coude → poignet). */
  F: number;
  k: number;
  accent: Col;
  act: Col;
  heat: Col;
  trim: Col;
  /** Peinture des plaques (couleur de l'implant assombrie). */
  livery: Col;
}

function armCtx(id: ArmImplant, q: number, b: Build, R: boolean): ArmCtx {
  const col = colorOf(id);
  return {
    id,
    q,
    b,
    R,
    F: DIMS[b].fore,
    k: b === 'f' ? 0.92 : 1,
    accent: glow(col, R ? GLOW_CH.ARM_R : GLOW_CH.ARM_L),
    act: glow(col, R ? GLOW_CH.ARM_R_ACT : GLOW_CH.ARM_L_ACT),
    heat: glow(id === 'lame' ? 0xff7a2a : 0xff5a2a, R ? GLOW_CH.HEAT_R : GLOW_CH.HEAT_L),
    trim: glow(QUALITY_COLOR[Math.max(0, Math.min(4, q))], GLOW_CH.TRIM),
    livery: mix(col, 0x2a2c31, 0.42),
  };
}

/** Demi-largeurs de la coque de l'avant-bras à la hauteur y (u = 0 au coude → 1 au poignet). */
function shellHW(c: ArmCtx, y: number): [number, number] {
  const u = Math.max(0, Math.min(1, (-1 - y) / (c.F - 2.5)));
  const hk = c.id === 'poing' ? 1.22 : 1;
  return [(2.75 - 0.7 * u) * c.k * hk, (2.6 - 0.5 * u) * c.k * hk];
}

/**
 * Avant-bras mécanique gauche (le droit en est le miroir) : origine au coude, poignet en
 * y = −F ; +Z = côté du pouce (dessus quand on vise), +X = extérieur.
 */
export function cyForearm(id: ArmImplant, q: number, cuff: 'b' | 's', b: Build, R: boolean): VoxelModel {
  const c = armCtx(id, q, b, R);
  const { F, k } = c;
  const s = new Sculpt(-7.5, 11.5, -F - 3, 4.5, -7.5, 9.5);
  const edge = q >= 4 ? GOLD : AL_HI;
  const gapY = -F * 0.48;
  s.add((x, y, z) => {
    // coque : âme de graphite, plaques d'alliage dessus et dehors (deux segments), face
    // intérieure en composite sombre ; un trait de lumière court le long des plaques
    if (y <= -1 && y >= -F + 1.5) {
      const [hx, hz] = shellHW(c, y);
      if (supEll(x, z, hx, hz, 3.0) <= 1) {
        if (supEll(x, z, hx - 1, hz - 1, 3.0) <= 1) return GR;
        if (Math.abs(y - gapY) < 0.5) return GR;
        const dorsal = x > -0.4 || z > hz * 0.45;
        if (!dorsal) return GR_HI;
        // liseré lumineux sur l'arête extérieure
        if (x > hx - 1 && Math.abs(z + 0.4) < 0.55 && y < -2.4 && y > -F + 2.6 && Math.abs(y - gapY) > 1.2) return c.accent;
        // arêtes éclairées en tête de chaque segment ; segment du poignet peint
        if (y > -2 || (y < gapY - 0.5 && y > gapY - 1.5)) return edge;
        return y < gapY ? c.livery : AL;
      }
    }
    // coude : charnière d'axe X, flasques claires, voyant extérieur
    if (y > -2.4 && y < 1.6) {
      const r = Math.hypot(y + 0.4, z + 0.2);
      if (r < 2.55 * k && Math.abs(x) < 3.05 * k) {
        if (Math.abs(x) > 2.45 * k) return x > 0 && r < 1.1 ? c.accent : edge;
        return GR;
      }
    }
    // poignet : bague sombre et anneau lumineux
    if (y < -F + 2 && y >= -F + 0.2 && supEll(x, z, 1.95 * k, 1.95 * k, 2.4) <= 1) return Math.abs(y + F - 1.3) < 0.5 ? c.accent : GR;
    // vérin-tendon chromé sur la face intérieure (côté paume)
    const [hx0] = shellHW(c, y);
    if (segDist(x, y, z, -hx0 - 0.15, -2.6, -1.1, -hx0 + 0.2, -F + 3.2, -0.9) < 0.6) return y > -4.2 ? GR : CHROME;
    // manche coupée au coude : revers du vêtement (bras nus : manchon de peau et bague)
    if (cuff === 's' && y > 0.4 && y < 3.7) {
      const e = supEll(x, z, 3.95 * k, 3.95 * k, 2.6);
      if (e <= 1 && e > 0.4) return y < 1.4 ? SLOT.COAT2 : SLOT.COAT;
    }
    if (cuff === 'b' && y > 0.4 && y < 2.7 && supEll(x, z, 3.0 * k, 3.0 * k, 2.6) <= 1) return y < 1.3 ? GR : SLOT.SKIN;
    return -1;
  });
  // gamme : témoins sur la plaque près du coude (un par gamme), filets d'or pour la Légendaire
  if (q >= 1) {
    const pips = Math.min(3, q);
    s.paintSurf((x, y, z, col, nx, ny, nz) => {
      if (col !== AL || nz <= 0) return col;
      const yy = -3.5;
      if (Math.abs(y - yy) < 0.5 && x > -1.2 && x < -1.2 + pips * 1.0 && Math.round(x * 2) % 2 !== 0) return c.trim;
      return col;
    });
  }
  armDevice(s, c);
  return s.m;
}

/** Organe fixe de chaque implant sur l'avant-bras. */
function armDevice(s: Sculpt, c: ArmCtx): void {
  const { F, k } = c;
  const top = (y: number) => shellHW(c, y)[1];
  const out = (y: number) => shellHW(c, y)[0];
  switch (c.id) {
    case 'grappin': {
      // lanceur sur le dessus, bobine de câble sur le flanc près du coude
      const tz = 2.55 * k + 1.5;
      s.add((x, y, z) => {
        const r = Math.hypot(x, z - tz);
        if (y <= -3 && y >= -F + 0.6 && r <= 1.55) {
          if (y < -F + 1.7) return r < 0.7 ? BORE : AL_HI;
          if (Math.abs(y + F - 2.6) < 0.5) return c.act;
          return Math.abs(y + 6) < 0.5 ? GR : AL_DK;
        }
        if (y > -3.6 && y < -2.4 && r < 1.9) return GR;
        // bobine du câble
        const rb = Math.hypot(y + 4, z - 1.2);
        if (x > out(-4) - 0.4 && x < out(-4) + 1.4 && rb < 2.3) return rb < 0.9 ? c.act : rb > 1.7 ? AL_HI : GR;
        return -1;
      });
      break;
    }
    case 'pistoletBras': {
      // logement du canon sur le dessus (le capot est fait de deux plaques mobiles)
      s.add((x, y, z) => {
        if (y > -2.2 || y < -F + 1.2) return -1;
        const hz = top(y);
        if (z < hz - 0.6 || z > 4.3 || Math.abs(x) > 2.3) return -1;
        if (y > -3.1) return GR;
        if (Math.abs(x) >= 1.4) return Math.abs(x) > 1.9 && z > 3.6 ? AL_HI : AL_DK;
        if (z < 2.9) return z > 2.4 && Math.round(y) % 2 === 0 ? c.act : GR;
        return -1;
      });
      break;
    }
    case 'lame': {
      // fourreau sur le flanc extérieur, fente lumineuse
      s.add((x, y, z) => {
        if (y > -2.4 || y < -F + 1.4) return -1;
        const ox = out(y);
        if (x < ox - 0.5 || x > ox + 2.1 || Math.abs(z) > 1.9) return -1;
        if (x > ox + 0.6 && x < ox + 1.4 && Math.abs(z) < 1.5 && y < -3.2) return -1;
        if (x > ox + 1.5 && Math.abs(z) < 0.5) return c.act;
        return y > -3.4 ? GR : AL_DK;
      });
      break;
    }
    case 'poing': {
      // corps des vérins sur le dessus, évents ambrés sur le flanc
      s.add((x, y, z) => {
        const hz = top(-4);
        for (const px of [-1.35, 1.35]) {
          const r = Math.hypot(x - px, z - (hz + 0.9));
          if (y <= -2.4 && y >= -9.2 && r <= 1.05) return y > -3.3 || y < -8.4 ? AL_HI : AL_DK;
        }
        const ox = out(y);
        if (x > ox - 0.4 && x < ox + 0.7 && Math.abs(z) < 1.7 && y < -3 && y > -10.5) return (Math.round(-y) % 2 === 0 ? c.act : GR);
        return -1;
      });
      break;
    }
    case 'bouclier': {
      // émetteur circulaire sur le flanc extérieur : couronne claire, lentille lumineuse
      s.add((x, y, z) => {
        const ox = out(-8.5);
        const r = Math.hypot(y + 8.5, z);
        if (x > ox - 0.6 && x < ox + 2.1 && r <= 3.45 * k) {
          if (r > 2.45 * k) return x > ox + 1.1 ? AL_HI : AL_DK;
          if (x > ox + 1.1) return r < 0.9 ? GR_HI : c.act;
          return GR;
        }
        return -1;
      });
      break;
    }
    case 'repulseur':
    case 'choc':
    case 'grip': {
      // anneaux autour de la coque : condensateurs (répulseur), bobines de cuivre (Tesla), électroaimants (grip)
      const ys = c.id === 'grip' ? [-5, -10.5] : [-4.2, -7.8, -11.4];
      s.add((x, y, z) => {
        for (const y0 of ys) {
          const d = y - y0;
          if (d < -1 || d > 1) continue;
          const [hx, hz] = shellHW(c, y0);
          const e = supEll(x, z, hx + 0.9, hz + 0.9, 3);
          if (e > 1 || supEll(x, z, hx - 0.2, hz - 0.2, 3) <= 1) continue;
          if (c.id === 'choc') return d > 0 ? COPPER : c.act;
          if (c.id === 'grip') return d > 0 ? CHROME : c.act;
          return d > 0 ? GR : c.act;
        }
        // Tesla : condensateur sur le flanc
        if (c.id === 'choc') {
          const ox = out(y);
          if (x > ox - 0.4 && x < ox + 1.5 && Math.abs(z) < 1.5 && y < -2.8 && y > -12.8) return Math.abs(z) < 0.5 && (Math.abs(y + 5) < 0.5 || Math.abs(y + 10) < 0.5) ? c.act : GR;
        }
        return -1;
      });
      break;
    }
    case 'outils': {
      // écran d'interface sur le dessus, câbles sur le flanc
      s.add((x, y, z) => {
        const hz = top(y);
        if (y < -3.2 && y > -11.2 && Math.abs(x) < 1.9 && z > hz - 0.5 && z < hz + 0.8) {
          if (Math.abs(x) > 1.3 || y > -3.9 || y < -10.5) return GR;
          return Math.round(y) % 2 === 0 ? c.act : GR_HI;
        }
        const ox = out(y);
        for (const zz of [-1.1, 1.1]) if (y < -2 && y > -F + 1.6 && segDist(x, y, z, ox + 0.5, -2, zz, ox + 0.3, -F + 1.6, zz * 0.7) < 0.7) return Math.round(y) % 3 === 0 ? AL_DK : RUBBER;
        return -1;
      });
      break;
    }
    case 'roquettes': {
      // rail et charnière de la nacelle sur le flanc
      s.add((x, y, z) => {
        const ox = out(y);
        if (x > ox - 0.4 && x < ox + 0.8 && Math.abs(z) < 1.1 && y < -2.4 && y > -12.6) return y > -3.4 ? AL_HI : GR;
        return -1;
      });
      break;
    }
    case 'fouet': {
      // gorge du filament sur le flanc, carter du dévidoir près du poignet
      s.add((x, y, z) => {
        const ox = out(y);
        if (x > ox - 0.3 && x < ox + 0.6 && Math.abs(z) < 0.5 && y < -2.5 && y > -F + 1.6) return c.act;
        const r = Math.hypot(y + F - 3.6, z);
        if (x > out(-F + 3.6) - 0.3 && x < out(-F + 3.6) + 1.1 && r < 1.7 * k) return r < 0.7 ? c.accent : r > 1.2 ? AL_HI : GR;
        return -1;
      });
      break;
    }
  }
}

/** Plaques du pistolet Viper : charnières (repère gauche, axe parallèle à Y). */
export const VIPER_HINGE: [number, number] = [2.3, 4.8];
/** Course du canon (voxels) et bouche du canon rentré (repère gauche du bras, voxels). */
export const VIPER_SLIDE = 8;
export function viperMuzzle(b: Build): [number, number, number] {
  return [0, -DIMS[b].fore + 0.2, 3.6];
}
/** Course de la lame Mantis (voxels). */
export const MANTIS_SLIDE = 16;
/** Bout du lanceur du grappin (repère gauche du bras, voxels). */
export function grappleTip(b: Build): [number, number, number] {
  const k = b === 'f' ? 0.92 : 1;
  return [0, -DIMS[b].fore - 1.2, 2.55 * k + 1.5];
}
/** Charnière de la nacelle de roquettes (x, y), de son capot (x, y) ; pivot des ailettes du bouclier (y). */
export function podHinges(b: Build): { pod: [number, number]; cover: [number, number]; fins: number } {
  const k = b === 'f' ? 0.92 : 1;
  const ox = 2.75 * k;
  return { pod: [ox + 0.8, -2.5], cover: [ox + 4.0, -13.6], fins: -8.5 };
}

/** Pièces mobiles d'un implant de bras (repère gauche de l'avant-bras). */
export function cyMoving(id: ArmImplant, piece: string, b: Build, R: boolean): VoxelModel {
  const c = armCtx(id, 2, b, R);
  const { F, k } = c;
  const s = new Sculpt(-8.5, 12.5, -F - 22, 4.5, -7.5, 9.5);
  switch (`${id}:${piece}`) {
    case 'pistoletBras:plateA':
    case 'pistoletBras:plateB': {
      const sg = piece === 'plateA' ? 1 : -1;
      s.add((x, y, z) => {
        const xx = x * sg;
        if (y > -2.6 || y < -F + 1.2 || xx < 0.05 || xx > 2.35 || z < 4.3 || z > 5.3) return -1;
        if (xx > 1.9 || y > -3.4) return AL_HI;
        return Math.abs(xx - 1.0) < 0.5 && y < -4 && y > -F + 3 ? c.accent : AL;
      });
      break;
    }
    case 'pistoletBras:barrel': {
      s.add((x, y, z) => {
        const r = Math.hypot(x, z - 3.6);
        if (y > -3.2 || y < -F + 0.2) return -1;
        if (y < -F + 1.4) return r < 0.55 ? BORE : r < 1.25 ? GR : -1;
        if (Math.abs(y + F - 2.4) < 0.5 && r < 1.1) return c.heat;
        return r < 0.95 ? (r < 0.5 ? CHROME : Math.round(y) % 3 === 0 ? AL_DK : CHROME) : -1;
      });
      break;
    }
    case 'lame:blade': {
      // lame courbe : dos clair, plat d'acier, tranchant chauffé ; pointe recourbée
      const ox = 2.75 * k;
      s.add((x, y, z) => {
        if (x < ox + 0.65 || x > ox + 1.35) return -1;
        if (y > -3 || y < -F - 2.5) return -1;
        const tipStart = -F + 3;
        const t = Math.max(0, tipStart - y);
        const zTop = 1.4 - t * 0.42;
        const zBot = -1.4 + t * 0.12 + t * t * 0.02;
        if (z > zTop || z < zBot) return -1;
        if (z < zBot + 0.9) return c.heat;
        if (z > zTop - 0.9) return AL_HI;
        return BLADE_C;
      });
      break;
    }
    case 'poing:rods': {
      const hz = shellHW(c, -4)[1];
      s.add((x, y, z) => {
        for (const px of [-1.35, 1.35]) {
          const r = Math.hypot(x - px, z - (hz + 0.9));
          if (y <= -8.4 && y >= -F + 1.4 && r <= 0.62) return CHROME;
        }
        if (y < -F + 1.6 && y > -F + 0.2 && Math.abs(x) < 2.1 && z > hz + 0.1 && z < hz + 1.7) return Math.abs(x) < 0.6 ? c.act : GR;
        return -1;
      });
      break;
    }
    case 'grappin:hook': {
      const tz = 2.55 * k + 1.5;
      s.add((x, y, z) => {
        if (y > -F + 0.9 || y < -F - 3) return -1;
        if (Math.abs(x) < 0.6 && Math.abs(z - tz) < 0.6 && y > -F - 1.4) return CHROME;
        for (const a of [Math.PI / 2, (Math.PI * 7) / 6, (Math.PI * 11) / 6]) {
          const ex = Math.cos(a) * 1.7;
          const ez = tz + Math.sin(a) * 1.7;
          if (segDist(x, y, z, 0, -F - 0.6, tz, ex, -F - 2.4, ez) < 0.55) return AL_HI;
          if (segDist(x, y, z, ex, -F - 2.4, ez, ex * 0.6, -F - 2.9, tz + (ez - tz) * 0.6) < 0.5) return c.act;
        }
        return -1;
      });
      break;
    }
    case 'roquettes:pod': {
      const ox = 2.75 * k;
      s.add((x, y, z) => {
        if (x < ox + 0.8 || x > ox + 4.1 || y > -2.4 || y < -13.6 || Math.abs(z) > 2.45) return -1;
        // tubes (2 × 2) : ogives orange au fond
        for (const tx of [ox + 1.8, ox + 3.2])
          for (const tz of [-1.15, 1.15]) {
            const r = Math.hypot(x - tx, z - tz);
            if (r < 0.62 && y < -11.4) return y < -12.3 ? -1 : c.act;
          }
        if (x > ox + 3.5 && y < -4 && y > -11) return (Math.floor(y + z * 1.2) & 1) === 0 ? HAZARD : CARBON;
        if (y > -3.3) return GR;
        return x < ox + 1.4 ? AL_DK : AL;
      });
      break;
    }
    case 'roquettes:cover': {
      const ox = 2.75 * k;
      s.add((x, y, z) => (x >= ox + 0.8 && x <= ox + 4.1 && y <= -13.6 && y > -14.5 && Math.abs(z) <= 2.45 ? (Math.abs(z) < 0.5 ? c.accent : AL_HI) : -1));
      break;
    }
    case 'outils:probe': {
      const ox = 2.75 * k;
      s.add((x, y, z) => {
        for (const zz of [-0.9, 0.9]) {
          if (Math.abs(x + ox + 0.25) < 0.45 && Math.abs(z - zz) < 0.45 && y < -5 && y > -F + 0.4) return y < -F + 1.4 ? c.act : CHROME;
        }
        return -1;
      });
      break;
    }
    case 'bouclier:fins': {
      const ox = 2.75 * k;
      s.add((x, y, z) => {
        if (x < ox + 0.2 || x > ox + 1.0) return -1;
        const yy = y + 8.5;
        const r = Math.hypot(yy, z);
        if (r < 3.3 * k || r > 4.7 * k) return -1;
        const a = Math.atan2(z, yy);
        const m = Math.abs(((a / (Math.PI / 2)) % 1 + 1) % 1 - 0.5);
        return m < 0.13 ? (r > 4.2 * k ? c.act : AL_HI) : -1;
      });
      break;
    }
    case 'fouet:seg': {
      const s2 = new Sculpt(-0.5, 0.5, 0, 4, -0.5, 0.5);
      s2.add(() => glow(colorOf('fouet'), GLOW_CH.WHIP));
      return s2.m;
    }
  }
  return s.m;
}

/** Longueur (m) du segment de filament du fouet (avant mise à l'échelle). */
export const WHIP_SEG_LEN = 4 / 64;

/** Main mécanique gauche (la droite en est le miroir) dans une pose donnée. */
export function cyHand(style: CyHandStyle, pose: B.HandPose, b: Build, R: boolean): VoxelModel {
  const impl = (Object.keys(HAND_STYLE) as ArmImplant[]).find((i) => HAND_STYLE[i] === style && style !== 'std') ?? 'grappin';
  const col = style === 'std' ? 0x4fd8ff : colorOf(impl);
  const chA = R ? GLOW_CH.ARM_R : GLOW_CH.ARM_L;
  const chX = R ? GLOW_CH.ARM_R_ACT : GLOW_CH.ARM_L_ACT;
  const accent = glow(style === 'std' ? 0x8fdcff : col, chA);
  const act = glow(col, chX);
  const heavy = style === 'fist';
  return B.hand(pose, b, 'bare', {
    c: AL,
    d: GR,
    l: AL_HI,
    deco: (s, { pose: p, palmBot }) => {
      // jointures des phalanges (anneaux sombres), dos de la main en plaques
      s.paintSurf((x, y, z, c0, nx) => {
        if (c0 !== AL && c0 !== AL_HI) return c0;
        if (y < palmBot - 0.5 && (Math.abs(y - (palmBot - 1.9)) < 0.5 || Math.abs(y - (palmBot - 3.7)) < 0.5)) return GR_HI;
        if (nx > 0 && y > palmBot + 0.6 && y < -1.4 && Math.abs(z) < 0.6) return accent;
        return c0;
      });
      if (heavy) {
        // gantelet : coque épaisse autour de la paume, plaque des jointures
        s.add((x, y, z) => {
          if (y < palmBot + 0.2 && y > -1.6 && x > -2.2 && x < 2.2 && z > -3.3 && z < 3.1 && !(x < -1.4 && y < -2)) return Math.abs(z) < 0.6 && x > 1.4 ? act : AL_DK;
          return -1;
        });
        s.paintSurf((x, y, z, c0, nx, ny) => (y < palmBot + 0.6 && y > palmBot - 3.2 && (ny < 0 || nx > 0) && c0 !== act ? AL_HI : c0));
      }
      if (style === 'palm' || style === 'mag') {
        // émetteur (répulseur) ou plaques aimantées (grip) au creux de la paume
        s.paintSurf((x, y, z, c0, nx) => {
          if (nx >= 0 || x > -0.8) return c0;
          const r = Math.hypot(y + 3.9, z);
          if (style === 'palm') return r < 1.2 ? act : r < 2.0 ? GR : c0;
          return r < 2.2 ? (r < 0.8 ? act : CHROME) : c0;
        });
      }
      if (style === 'tesla') {
        // électrodes au bout des doigts, bagues de cuivre
        s.paintSurf((x, y, z, c0) => {
          if (y < palmBot - (p === 'fist' ? 1.8 : 4.0) && c0 !== GR) return act;
          if (Math.abs(y - (palmBot - 0.6)) < 0.5) return COPPER;
          return c0;
        });
      }
      if (style === 'whip') {
        // dévidoir sur le dos de la main, index lumineux
        s.add((x, y, z) => {
          const r = Math.hypot(y + 3.6, z);
          return x > 1.0 && x < 2.4 && r < 1.7 ? (r < 0.7 ? act : r > 1.2 ? AL_HI : GR) : -1;
        });
        s.paintSurf((x, y, z, c0) => (z > 1.2 && y < palmBot - (p === 'fist' ? 1.5 : 3.6) ? act : c0));
      }
      if (style === 'tool') {
        // pointes de sonde à l'index et au majeur
        s.paintSurf((x, y, z, c0) => (z > -0.4 && y < palmBot - (p === 'fist' ? 1.8 : 4.0) ? act : c0));
      }
    },
  });
}

// ================================================================== JAMBES

interface LegItem {
  id: string;
  q: number;
}

function parseItems(list: string): LegItem[] {
  return list.split('+').map((s) => ({ id: s.replace(/\d+$/, ''), q: Number(/\d+$/.exec(s)?.[0] ?? 0) }));
}

/** Pièces des jambes : `bone` cuisse, jambe ou pied ; `list` « id+gamme » triés. */
export function cyLeg(bone: string, b: Build, list: string, R: boolean): VoxelModel {
  const items = parseItems(list);
  const has = (id: string) => items.some((i) => i.id === id);
  const chL = GLOW_CH.LEGS;
  const chX = GLOW_CH.LEGS_ACT;
  const acc = (id: string) => glow(colorOf(id), chL);
  const act = (id: string) => glow(colorOf(id), chX);
  void R;
  if (bone === 'foot') {
    const D = DIMS[b];
    const s = new Sculpt(-7.5, 7.5, -D.ankle - 1.5, 6, -D.heel - 4, D.toe + 2.5);
    const P = probe(`foot:${b}`, () => B.foot('sneaker', b));
    const sole = -D.ankle;
    for (const it of items) {
      if (it.id === 'doubleSaut') {
        // micro-propulseurs au talon : tuyères tournées vers l'arrière et le bas
        s.add((x, y, z) => {
          for (const px of [-1.5, 1.5]) {
            const r = Math.hypot(x - px, y - (sole + 2.2));
            if (z < -D.heel + 0.6 && z > -D.heel - 2.6 && r < 1.15) {
              if (z < -D.heel - 1.9) return r < 0.62 ? act(it.id) : AL_HI;
              return GR;
            }
            if (segDist(x, y, z, px * 0.8, sole + 3, -D.heel - 0.4, px * 0.5, 1.5, -D.heel + 0.6) < 0.5) return GR_HI;
          }
          return -1;
        });
      }
      if (it.id === 'sprint') {
        // liserés lumineux le long des flancs de la chaussure
        s.add((x, y, z) => {
          if (y < sole + 1.4 || y > sole + 2.3 || z < -D.heel + 1 || z > D.toe - 2.5) return -1;
          if (P.inside(x, y, z) || !(P.inside(x - 0.8, y, z) || P.inside(x + 0.8, y, z))) return -1;
          return Math.floor(z) % 3 === 0 ? GR : act(it.id);
        });
      }
      if (it.id === 'glissade') {
        // embout de patin sur la pointe, filet orange
        s.add((x, y, z) => {
          if (z < D.toe - 5.2 || z > D.toe + 0.9 || y < sole + 0.6) return -1;
          if (P.inside(x, y, z)) return -1;
          if (!(P.inside(x, y - 1, z) || P.inside(x, y, z - 1) || P.inside(x - 0.9, y, z) || P.inside(x + 0.9, y, z))) return -1;
          return z > D.toe - 0.4 && y < sole + 1.8 ? acc(it.id) : AL_HI;
        });
      }
      if (it.id === 'amortisseurs') {
        // patins amortisseurs de part et d'autre du talon
        const y0 = has('silence') ? sole + 1.7 : sole + 0.5;
        s.add((x, y, z) => {
          if (y < y0 || y > y0 + 2.3 || z < -D.heel + 0.4 || z > 1.6) return -1;
          for (const sg of [-1, 1]) {
            const sx = P.side(sg, sole + 2, -1);
            if (!Number.isFinite(sx)) continue;
            const xx = sg * (x - sx);
            if (xx > -0.2 && xx < 0.9) return Math.abs(z + 1) < 0.6 && y > y0 + 1 ? acc(it.id) : Math.round(y) % 2 === 0 ? CHROME : GR;
          }
          return -1;
        });
      }
      if (it.id === 'silence') {
        // semelle amortie : bourrelet de mousse, disques amortisseurs aux chevilles
        s.add((x, y, z) => {
          if (y >= sole && y < sole + 1.6 && !P.inside(x, y, z) && (P.inside(x - 1, y, z) || P.inside(x + 1, y, z) || P.inside(x, y, z - 1) || P.inside(x, y, z + 1))) return (Math.floor(z) & 1) === 0 ? FOAM : FOAM_DK;
          for (const sg of [-1, 1]) {
            const sx = P.side(sg, -1, 0);
            if (!Number.isFinite(sx)) continue;
            const r = Math.hypot(y + 0.6, z + 0.2);
            if (sg * x > sg * sx - 0.2 && sg * x < sg * sx + 0.9 && r < 1.4) return r < 0.6 ? acc(it.id) : GR;
          }
          return -1;
        });
      }
    }
    return s.m;
  }
  if (bone === 'thigh') {
    const s = new Sculpt(-9.5, 10.5, -32, 3, -10.5, 11.5);
    const P = probe(`thigh:${b}`, () => B.thigh('pants', b));
    for (const it of items) {
      if (it.id === 'bond') {
        // compresseur sur le devant de la cuisse, tige vers le genou
        const zc = P.front(0, -18) + 1.7;
        s.add((x, y, z) => {
          const r = Math.hypot(x, z - zc);
          if (y <= -11.5 && y >= -22.8 && r <= 1.75) {
            if (Math.abs(y + 14) < 0.5 || Math.abs(y + 17.5) < 0.5 || Math.abs(y + 21) < 0.5) return AL_HI;
            if (Math.abs(x) > 1.0 && (Math.abs(y + 15.8) < 0.5 || Math.abs(y + 19.2) < 0.5)) return acc(it.id);
            return AL;
          }
          if (y < -22.8 && y > -27.5 && r <= 0.72) return CHROME;
          if (y > -12.4 && y < -10.6 && Math.abs(x) < 2.6 && z > zc - 2.4 && z < zc + 0.6 && P.near(x, y, z, 1.2)) return GR;
          return -1;
        });
      }
      if (it.id === 'sprint') strands(s, P, [0.7, 1.13, 1.57], -3.5, -24, act(it.id));
      if (it.id === 'amortisseurs') {
        // amortisseurs de part et d'autre du genou (moitié haute)
        s.add((x, y, z) => {
          for (const sg of [-1, 1]) {
            const sx = P.side(sg, -24, 0.3);
            if (!Number.isFinite(sx)) continue;
            const cx = sx + sg * 1.25;
            const r = Math.hypot(x - cx, z - 0.3);
            if (y <= -18.5 && y >= -27.6) {
              if (y > -19.6 && r < 1.0) return acc(it.id);
              if (y < -20.5 && y > -26.3 && r < 1.3 && r > 0.75) return Math.round(y) % 2 === 0 ? CHROME : GR;
              if (r < 0.95) return AL_DK;
            }
          }
          return -1;
        });
      }
    }
    return s.m;
  }
  // ------------------------------------------------------------- jambe (genou → cheville)
  const s = new Sculpt(-9.5, 10.5, -29, 4, -11.5, 10.5);
  const P = probe(`shin:${b}`, () => B.shin('pants', 'dress', b));
  const back = (x: number, y: number) => P.back(x, y);
  for (const it of items) {
    switch (it.id) {
      case 'saut': {
        // vérins de saut : deux corps derrière le mollet, tiges chromées jusqu'au talon
        s.add((x, y, z) => {
          for (const px of [-1.6, 1.6]) {
            const zc = back(px, -8) - 1.15;
            const r = Math.hypot(x - px, z - zc);
            if (y <= -2.6 && y >= -12.6 && r <= 1.12) return y > -3.5 ? AL_HI : y < -11.7 ? acc(it.id) : AL;
            if (y < -12.6 && y >= -23.4 && r <= 0.6) return CHROME;
            if (y < -22.4 && y > -24.6 && Math.abs(x - px) < 0.8 && z > back(px, -23) - 0.6 && z < zc + 0.7) return GR;
          }
          if (y < -1.8 && y > -3.2 && P.near(x, y, z, 1.0) && z < 1) return GR;
          return -1;
        });
        break;
      }
      case 'doubleSaut': {
        // réservoir des propulseurs, derrière le bas de la jambe
        s.add((x, y, z) => {
          const zc = back(0, -19) - 1.0;
          const r = Math.hypot(x, z - zc);
          if (y <= -15.6 && y >= -21.6 && r <= 0.95) return Math.abs(y + 18.6) < 0.5 ? acc(it.id) : AL;
          return -1;
        });
        break;
      }
      case 'bond': {
        // logement du compresseur sur le haut du tibia, voyant ; second vérin sur le bas du tibia
        s.add((x, y, z) => {
          if (y > 1.8 || y < -3.4 || Math.abs(x) > 2.4) return -1;
          const fz = P.front(x, y);
          if (!Number.isFinite(fz) || z < fz - 0.2 || z > fz + 1.1) return -1;
          return Math.abs(x) < 0.6 && Math.abs(y + 0.8) < 0.6 ? acc(it.id) : AL_DK;
        });
        const bx = has('glissade') ? 2.6 : 0;
        const bzc = P.front(bx * 0.6, -19) + 1.3;
        s.add((x, y, z) => {
          const r = Math.hypot(x - bx, z - bzc);
          if (y <= -14.5 && y >= -22 && r <= 1.35) {
            if (Math.abs(y + 16.5) < 0.5 || Math.abs(y + 19.5) < 0.5) return Math.abs(x - bx) > 0.7 ? acc(it.id) : AL_HI;
            return y > -15.4 ? GR : AL;
          }
          if (y < -22 && y > -25.2 && r <= 0.6) return CHROME;
          return -1;
        });
        break;
      }
      case 'sprint':
        strands(s, P, has('saut') ? [4.3, 4.85] : [3.75, 4.3], -3.5, -24.5, act(it.id));
        break;
      case 'esquive': {
        // propulseurs d'esquive de chaque côté de la cheville
        s.add((x, y, z) => {
          if (y > -21 || y < -25.4) return -1;
          for (const sg of [-1, 1]) {
            const sx = P.side(sg, -22, 0);
            if (!Number.isFinite(sx)) continue;
            const xx = sg * (x - sx);
            if (xx > -0.3 && xx < 1.7 && z > -1.7 && z < 1.1) return y > -21.8 ? AL_HI : AL_DK;
            const r = Math.hypot(xx - 0.7, y + 23.2);
            if (z <= -1.7 && z > -2.8 && r < 1.0) return r < 0.55 ? act(it.id) : GR;
          }
          return -1;
        });
        break;
      }
      case 'glissade': {
        // patins des tibias : trois plaques étagées, filet lumineux en bas de chacune
        s.add((x, y, z) => {
          if (y > 2 || y < -20.6 || z < 0.5 || Math.abs(x) > 3.3) return -1;
          if (!P.near(x, y, z, 1.25)) return -1;
          if (y > -2.2) return AL_DK;
          const seg = Math.floor((-2.2 - y) / 6.1);
          const local = (-2.2 - y) - seg * 6.1;
          if (local > 5.3) return acc(it.id);
          return local < 1 ? AL_HI : AL;
        });
        break;
      }
      case 'amortisseurs': {
        // moitié basse des amortisseurs (tiges et fixation)
        s.add((x, y, z) => {
          for (const sg of [-1, 1]) {
            const sx = P.side(sg, -2, 0.3);
            if (!Number.isFinite(sx)) continue;
            const cx = sx + sg * 1.25;
            const r = Math.hypot(x - cx, z - 0.3);
            if (y <= 1.2 && y >= -6.4 && r <= 0.62) return CHROME;
            if (y < -6.4 && y > -8.6 && r <= 1.05) return Math.abs(y + 7.5) < 0.5 && r < 0.5 ? acc(it.id) : GR;
          }
          // ressorts de cheville derrière le talon (sous l'ourlet des manteaux)
          {
            for (const px of has('saut') ? [0] : [-1.3, 1.3]) {
              const zc = back(px, -22) - 0.9;
              const r = Math.hypot(x - px, z - zc);
              if (y <= -19.4 && y >= -25.6 && r <= 0.95) return y > -20.2 ? acc(it.id) : Math.round(y) % 2 === 0 ? CHROME : GR;
            }
          }
          return -1;
        });
        break;
      }
      case 'courseMurale': {
        // rail et roues d'adhérence sur le flanc extérieur
        s.add((x, y, z) => {
          if (y > -9.8 || y < -23.3) return -1;
          const sx = P.side(1, -16, 0);
          if (!Number.isFinite(sx)) return -1;
          const xx = x - sx;
          if (xx > -0.3 && xx < 0.8 && Math.abs(z) < 0.85) return GR;
          for (const wy of [-12, -16.6, -21.2]) {
            const r = Math.hypot(y - wy, z);
            if (xx >= 0.8 && xx < 2.1 && r < 2.05) return r < 0.85 ? acc(it.id) : r > 1.45 ? RUBBER : AL_HI;
          }
          return -1;
        });
        break;
      }
      case 'sautMural': {
        // lame-ressort arquée derrière le mollet (déportée sur le côté si les vérins y sont)
        const x0 = has('saut') ? 3.0 : 0;
        s.add((x, y, z) => {
          if (y > -3.5 || y < -24.5 || Math.abs(x - x0) > 1.05) return -1;
          const bz = back(Math.min(x0, 2.5), Math.max(-23, Math.min(-4, y)));
          if (!Number.isFinite(bz)) return -1;
          const bow = Math.sin((Math.PI * (y + 3.5)) / -21) * 2.3;
          const zc = bz - 0.7 - bow;
          if (Math.abs(z - zc) > 0.6) return -1;
          if (y > -5 || y < -23) return GR;
          return bow > 1.9 ? acc(it.id) : AL_HI;
        });
        break;
      }
    }
  }
  return s.m;
}

/** Fibres musculaires lumineuses sur la surface d'un membre (angles φ autour de l'axe). */
function strands(s: Sculpt, P: Probe, phis: number[], y0: number, y1: number, col: Col): void {
  const cache = new Map<number, number[]>();
  const radii = (y: number) => {
    const yi = Math.floor(y);
    let r = cache.get(yi);
    if (!r) cache.set(yi, (r = phis.map((p) => P.radial(yi + 0.5, p))));
    return r;
  };
  s.add((x, y, z) => {
    if (y > y0 || y < y1) return -1;
    const rr = radii(y);
    for (let i = 0; i < phis.length; i++) {
      if (rr[i] <= 0) continue;
      const r = rr[i] + 0.55;
      const px = Math.sin(phis[i]) * r;
      const pz = Math.cos(phis[i]) * r;
      if (Math.hypot(x - px, z - pz) < 0.72) return (Math.floor(-y) % 4 === 0) ? GR : col;
    }
    return -1;
  });
}

// ================================================================== TORSE ET COLONNE

/** Pièces du torse et de la colonne, posées sur le vêtement du style donné. */
export function cyTorso(style: B.TorsoStyle, b: Build, list: string): VoxelModel {
  const items = parseItems(list);
  const has = (id: string) => items.some((i) => i.id === id);
  const P = probe(`torso:${style}:${b}`, () => B.torso(style, b));
  const s = new Sculpt(-19.5, 19.5, -8, 44, -16.5, 16.5);
  const chT = GLOW_CH.TORSO;
  const chX = GLOW_CH.TORSO_ACT;
  const chS = GLOW_CH.SPINE;
  const acc = (id: string, ch: number = chT) => glow(colorOf(id), ch);
  const neckR = b === 'f' ? 3.1 : 3.5;
  const neckZ = b === 'f' ? -0.5 : -0.6;
  /** Plaque d'épaisseur t posée sur la face avant (ou arrière) dans un domaine. */
  const onFront = (x: number, y: number, z: number, t: number) => {
    const f = P.front(x, y);
    return Number.isFinite(f) && z > f - 0.3 && z < f + t;
  };
  const onBack = (x: number, y: number, z: number, t: number) => {
    const bk = P.back(x, y);
    return Number.isFinite(bk) && z < bk + 0.3 && z > bk - t;
  };
  const heart: [number, number] = [5, 19];
  for (const it of items) {
    switch (it.id) {
      case 'blindage': {
        const collar = !has('antichoc');
        s.add((x, y, z) => {
          const ax = Math.abs(x);
          // plaques sous-cutanées à la base du cou (gorgerin)
          if (collar && y > 31.2 && y < 34.6 && z > neckZ) {
            const r = supEll(x, z - neckZ, neckR + 1.1, neckR + 1.2, 2.2);
            if (r <= 1 && r > 0.55) return Math.round(y) % 2 === 0 ? AL_HI : AL;
          }
          // plaques des clavicules
          if (collar && ax > 4.4 && ax < 9.2 && Math.abs(z) < 2.6) {
            const t = P.top(x, z);
            if (Number.isFinite(t) && y > t - 0.3 && y < t + 1.0) return ax > 6.6 && ax < 7.2 ? GR : AL;
          }
          // plaques du sternum (si le collier antichoc occupe le cou)
          if (!collar && ax < 2.2 && y > 22 && y < 28.5 && onFront(x, y, z, 1.0)) return Math.round(y) % 3 === 0 ? GR : AL;
          return -1;
        });
        break;
      }
      case 'secondSouffle': {
        // port du cœur de secours sur le côté gauche de la poitrine
        s.add((x, y, z) => {
          const r = Math.hypot(x - heart[0], y - heart[1]);
          if (r > 3.1) return -1;
          if (!onFront(x, y, z, r < 1.9 ? 2.0 : 1.4)) return -1;
          if (r < 0.7) return GR;
          if (r < 2.0) return Math.abs(x - heart[0]) < 0.6 || Math.abs(y - heart[1]) < 0.6 ? GR_HI : glow(0xff2a40, chX);
          return r > 2.6 ? AL_DK : AL_HI;
        });
        break;
      }
      case 'accumulateur': {
        // cellules de batterie sur les flancs
        s.add((x, y, z) => {
          if (y < 4.6 || y > 16.4) return -1;
          for (const sg of [-1, 1]) {
            for (const zc of [-1.8, 1.8]) {
              const sx = P.side(sg, 10, zc);
              if (!Number.isFinite(sx)) continue;
              const cx = sx + sg * 1.2;
              const r = Math.hypot(x - cx, z - zc);
              if (r <= 1.3) {
                if (y < 5.6 || y > 15.4) return GR;
                return Math.abs(z - zc) < 0.5 && sg * (x - cx) > 0.5 ? acc(it.id) : AL_DK;
              }
            }
          }
          return -1;
        });
        break;
      }
      case 'surcharge': {
        // plastron de plaques séparées par des coutures d'énergie
        s.add((x, y, z) => {
          const ax = Math.abs(x);
          // deux plaques pectorales et quatre abdominales, coutures d'énergie entre elles
          const pec = y > 15.5 && y < 23.5 && ax > 1 && ax < 7.6;
          const abd = y > 6.5 && y < 15 && ax > 0.4 && ax < 5.2;
          if (!pec && !abd) return -1;
          if (has('secondSouffle') && Math.hypot(x - heart[0], y - heart[1]) < 3.3) return -1;
          if (!onFront(x, y, z, 1.2)) return -1;
          const seam = (pec && (ax < 1.6 || y < 16.3)) || (abd && (ax < 1.2 || Math.abs(y - 10.8) < 0.55 || ax > 4.4));
          if (seam) return acc(it.id, chX);
          return y > 22.5 || (pec && ax > 6.6) ? AL : AL_DK;
        });
        break;
      }
      case 'antichoc': {
        // collier amortisseur et barres d'épaules, butées ambrées
        s.add((x, y, z) => {
          const ax = Math.abs(x);
          if (y > 29.6 && y < 32.8) {
            const r = supEll(x, z - neckZ, neckR + 3.4, neckR + 3.2, 2.2);
            const ri = supEll(x, z - neckZ, neckR + 1.4, neckR + 1.3, 2.2);
            if (r <= 1 && ri > 1) {
              const ang = Math.atan2(z - neckZ, x);
              const m = Math.abs((((ang / (Math.PI / 2)) % 1) + 1) % 1 - 0.5);
              return m < 0.12 ? acc(it.id) : y > 31.8 ? AL_HI : AL_DK;
            }
          }
          if (ax > 6.5 && ax < 11.5 && Math.abs(z) < 1.3) {
            const t = P.top(x, z);
            if (Number.isFinite(t) && y > t - 0.2 && y < t + 1.3) return ax > 10.4 ? acc(it.id) : GR;
          }
          return -1;
        });
        break;
      }
      case 'nanobots': {
        // injecteurs de nanobots de chaque côté du cou
        s.add((x, y, z) => {
          for (const sg of [-1, 1]) {
            const r = Math.hypot(x - sg * (neckR + 1.2), z - (neckZ - 0.4));
            if (y > 30.5 && y < 35.2 && r < 0.95) return Math.abs(y - 33) < 0.6 ? acc(it.id) : y > 34.4 ? AL_HI : AL;
          }
          return -1;
        });
        break;
      }
      // ------------------------------------------------- colonne
      case 'gyro': {
        // trois gyroscopes le long de la colonne : anneau clair, rotor sombre à rayons lumineux
        s.add((x, y, z) => {
          for (const yc of [6, 13, 20]) {
            const r = Math.hypot(x, y - yc);
            if (r > 2.7) continue;
            if (!onBack(x, y, z, r < 2.0 ? 1.8 : 1.3)) continue;
            if (r > 2.0) return AL_HI;
            const a = Math.atan2(y - yc, x);
            const spoke = Math.abs(Math.sin(a * 2)) < 0.3;
            return r < 0.6 ? GR_HI : spoke ? acc(it.id, chS) : GR;
          }
          return -1;
        });
        break;
      }
      case 'reflexesMoteurs': {
        // faisceau de fibres tressées le long de la colonne
        s.add((x, y, z) => {
          if (y < -3 || y > 30.5) return -1;
          const ax = Math.abs(x);
          if (ax < 1.2 && onBack(x, y, z, 1.4)) return (Math.floor(y) + (x > 0 ? 1 : 0)) % 2 === 0 ? acc(it.id, chS) : GR;
          if (Math.abs(ax - 2.3) < 0.5 && y > 1 && y < 27 && onBack(x, y, z, 0.9)) return Math.floor(y) % 4 === 0 ? acc(it.id, chS) : GR_HI;
          return -1;
        });
        break;
      }
      case 'vertebres': {
        // arête de vertèbres segmentées
        s.add((x, y, z) => {
          if (y < -2 || y > 29 || Math.abs(x) > 1.6) return -1;
          const seg = (y + 2) % 3.4;
          if (seg > 2.2) return -1;
          if (!onBack(x, y, z, 2.1)) return -1;
          const bk = P.back(x, y);
          return Math.abs(x) < 0.55 && z < bk - 1.4 ? acc(it.id, chS) : seg < 0.8 ? AL_HI : AL;
        });
        break;
      }
      case 'treuil': {
        // treuil entre les omoplates : tambour d'axe X, flasques, câble enroulé
        const zc = P.back(0, 21) - 2.9;
        s.add((x, y, z) => {
          const r = Math.hypot(y - 21, z - zc);
          const ax = Math.abs(x);
          if (ax <= 4.4 && r <= 2.9) {
            if (ax > 3.6) return r < 1 ? acc(it.id, chS) : AL_HI;
            if (r > 2.2) return Math.round(x) % 2 === 0 ? CHROME : AL_DK;
            return GR;
          }
          // supports vers le dos
          if (ax > 3.2 && ax < 4.4 && y > 19 && y < 23 && z > zc && onBack(x, y, z, 3.5)) return GR;
          return -1;
        });
        break;
      }
    }
  }
  void hash3;
  return s.m;
}

// ================================================================== TÊTE

/** Crâne (même forme que partsHead) : valeur de la superellipsoïde gonflée de t. */
function skull(b: Build, x: number, y: number, z: number, t = 0): number {
  const c = b === 'f' ? { cy: 3.6, cz: -0.3, rx: 5.35, ry: 6.9, rz: 6.4 } : { cy: 3.6, cz: -0.2, rx: 5.5, ry: 7.0, rz: 6.6 };
  const n = 2.4;
  return Math.pow(Math.abs(x) / (c.rx + t), n) + Math.pow(Math.abs(y - c.cy) / (c.ry + t), n) + Math.pow(Math.abs(z - c.cz) / (c.rz + t), n);
}

/**
 * Implants de la tête (yeux et système neuronal), repère de la tête. flags : 'm' si l'œil
 * gauche porte déjà un monocle (les pièces d'un seul œil passent à droite).
 */
export function cyHead(b: Build, list: string, flags: string): VoxelModel {
  const items = parseItems(list);
  const has = (id: string) => items.some((i) => i.id === id);
  const s = new Sculpt(-9.5, 9.5, -7.5, 16.5, -10.5, 11.5);
  const chE = GLOW_CH.EYES;
  const chN = GLOW_CH.NEURAL;
  const acc = (id: string, ch: number) => glow(colorOf(id), ch);
  // un œil par pièce : l'œil droit (−X) d'abord, le gauche ensuite (sauf monocle à gauche)
  const eyeSide: Record<string, number> = {};
  let nextEye = -1;
  for (const id of ['zoom', 'marqueur', 'analyseur']) {
    if (!has(id)) continue;
    eyeSide[id] = nextEye;
    nextEye = flags.includes('m') ? -1 : 1;
  }
  for (const it of items) {
    switch (it.id) {
      case 'zoom': {
        const ex = 3 * eyeSide.zoom;
        s.add((x, y, z) => {
          const r = Math.hypot(x - ex, y - 3);
          if (z > 6.4 && z < 9.6 && r < 1.55) {
            if (z > 8.8) return r < 0.9 ? acc(it.id, chE) : AL_HI;
            return Math.floor(z) % 2 === 0 ? GR : AL;
          }
          if (segDist(x, y, z, ex + Math.sign(ex) * 1.2, 3.6, 7.2, Math.sign(ex) * 6.3, 4, 3.5) < 0.55) return GR_HI;
          return -1;
        });
        break;
      }
      case 'thermique': {
        // capteurs thermiques au coin externe des yeux
        s.add((x, y, z) => (Math.abs(Math.abs(x) - 5.2) < 0.5 && Math.abs(y - 3) < 0.5 && z > 5 && z < 6.6 ? acc(it.id, chE) : -1));
        break;
      }
      case 'nocturne': {
        // lunettes à lentilles vertes, monture sombre
        const ly = has('scanner') ? 3 : 3;
        s.add((x, y, z) => {
          const ax = Math.abs(x);
          if (z > 6.5 && z < 7.6 && ax > 1.5 && ax < 4.6 && Math.abs(y - ly) < 0.6) return acc(it.id, chE);
          if (z > 6.5 && z < 7.6 && ax > 1.5 && ax < 4.6 && Math.abs(y - (ly + 1)) < 0.6) return GR;
          if (z > 6.5 && z < 7.6 && ax < 1.5 && Math.abs(y - (ly + 1)) < 0.6) return GR;
          if (ax > 5.6 && ax < 6.6 && Math.abs(y - (ly + 1)) < 0.6 && z > 0 && z < 6.6) return GR;
          return -1;
        });
        break;
      }
      case 'marqueur': {
        // réticule rouge autour d'un œil
        // œil de visée : orbite de métal sombre, réticule rouge au centre, fil vers la tempe
        const ex = 3 * eyeSide.marqueur;
        s.add((x, y, z) => {
          if (z < 6.4 || z > 7.6) return -1;
          const dx = Math.abs(x - ex);
          const dy = Math.abs(y - 3);
          if (dx > 1.6 || dy > 1.6) return -1;
          if (dx < 0.6 && dy < 0.6) return acc(it.id, chE);
          return dx > 0.6 && dy > 0.6 ? AL_DK : GR;
        });
        s.add((x, y, z) => (segDist(x, y, z, ex + Math.sign(ex) * 1.6, 3.5, 6.5, Math.sign(ex) * 6.2, 4.0, 3) < 0.5 ? GR_HI : -1));
        break;
      }
      case 'analyseur': {
        // barre ATH jaune devant un œil, attache sur la tempe
        const sg = eyeSide.analyseur;
        s.add((x, y, z) => {
          const xx = x * sg;
          // verre de l'afficheur devant l'œil (lumineux), cadre fin
          if (z > 7 && z < 8 && y > 2 && y < 4 && xx > 1.5 && xx < 4.5) return acc(it.id, chE);
          if (z > 7 && z < 8 && y > 4 && y < 5 && xx > 1.5 && xx < 5.5) return GR;
          // bras de l'afficheur jusqu'à la tempe
          if (xx > 5 && xx < 6.6 && y > 3.6 && y < 5 && z > 1.5 && z < 8) return z < 3.5 ? AL_HI : GR;
          return -1;
        });
        break;
      }
      case 'scanner': {
        // visière de scan verte (au-dessus des lunettes de nuit s'il y en a)
        const vy = has('nocturne') ? 5.5 : 3.5;
        s.add((x, y, z) => {
          const ax = Math.abs(x);
          // bandeau de scan devant les yeux, nacelles sur les tempes
          if (z > 7 && z < 8 && ax < 5.5 && Math.abs(y - vy) < 1) return Math.abs(y - vy) < 0.5 ? acc(it.id, chE) : GR;
          if (ax > 5.4 && ax < 6.8 && Math.abs(y - vy) < 1.1 && z > 2.4 && z < 8) return z > 6 ? GR_HI : GR;
          return -1;
        });
        break;
      }
      case 'visee': {
        // puce de visée sur la tempe gauche, diode rouge
        s.add((x, y, z) => {
          if (x < 5.6 || x > 7.4 || y < 3.4 || y > 6.6 || z < 0.6 || z > 3.6) return -1;
          if (skull(b, x, y, z) <= 1) return -1;
          return x > 6.5 && Math.abs(y - 5) < 0.6 && Math.abs(z - 2.1) < 0.6 ? acc(it.id, chN) : x > 6.5 ? GR_HI : GR;
        });
        break;
      }
      case 'reflexes': {
        // couronne neuronale dorée : bandeau et ports lumineux autour du crâne
        // couronne neuronale : clous dorés autour du crâne, port frontal en losange
        s.add((x, y, z) => {
          if (y < 5.6 || y > 7.6) return -1;
          const v = skull(b, x, 6.6, z, 1.6);
          const vi = skull(b, x, 6.6, z, 0.5);
          if (v > 1 || vi <= 1) return -1;
          const a = Math.atan2(z + 0.2, x);
          const m = Math.abs((((a / (Math.PI / 4)) % 1) + 1) % 1 - 0.5);
          // pas de clou sur le front (le port y est)
          if (m > 0.11 || (z > 4 && Math.abs(x) < 2)) return -1;
          return y > 6.6 ? glow(0xffd23d, GLOW_CH.NEURAL_ACT) : GOLD;
        });
        s.add((x, y, z) => (z > 5.8 && z < 7.2 && Math.abs(x) + Math.abs(y - 7.6) < 1.3 && y > 6.4 && y < 8.8 ? (Math.abs(x) < 0.5 && Math.abs(y - 7.6) < 0.5 ? glow(0xffd23d, GLOW_CH.NEURAL_ACT) : GOLD) : -1));
        break;
      }
      case 'conscience': {
        // nœuds capteurs derrière les oreilles
        s.add((x, y, z) => {
          for (const sg of [-1, 1])
            for (const [yy, zz] of [
              [2.4, -2.6],
              [0.4, -2.2],
            ])
              if (Math.abs(x - sg * 6.1) < 0.65 && Math.abs(y - yy) < 0.6 && Math.abs(z - zz) < 0.6) return acc(it.id, chN);
          return -1;
        });
        break;
      }
      case 'coprocesseur': {
        // rangée de ports à la nuque
        s.add((x, y, z) => {
          if (Math.abs(x) > 2.6 || y < -1.6 || y > 3.6) return -1;
          const sk = skull(b, x, y, z, 0.9);
          if (z > -3 || sk > 1 || skull(b, x, y, z, -0.2) <= 1) return -1;
          const port = Math.abs(x) > 0.4 && (Math.round(x) & 1) === 1 && (Math.round(y) & 1) === 0;
          return port ? acc(it.id, chN) : GR;
        });
        break;
      }
      case 'liaisonDrone': {
        // trois antennes derrière l'oreille droite, pointes lumineuses
        s.add((x, y, z) => {
          if (Math.abs(x + 6.0) < 0.8 && Math.abs(y - 3.2) < 1.2 && Math.abs(z + 2.6) < 1.0) return GR;
          for (const [tx, ty, tz] of [
            [-6.6, 13.5, -3.8],
            [-7.4, 12.0, -2.4],
            [-6.0, 11.0, -4.8],
          ]) {
            if (segDist(x, y, z, -6.1, 4, -2.8, tx, ty, tz) < 0.45) return y > ty - 1 ? acc(it.id, chN) : AL_HI;
          }
          return -1;
        });
        break;
      }
      case 'commandement': {
        // implant de commandement : plaque ambrée sur la tempe droite
        s.add((x, y, z) => {
          if (x > -5.6 || x < -7.6 || y < 2.4 || y > 6.8 || z < -1.6 || z > 3.4) return -1;
          if (skull(b, x, y, z) <= 1) return -1;
          const chev = Math.abs(Math.abs(z - 0.9) - (y - 3.2) * 0.6) < 0.5 && x < -6.6;
          return chev ? acc(it.id, chN) : x < -6.6 ? AL : GR;
        });
        break;
      }
    }
  }
  void inEllipsoid;
  return s.m;
}
