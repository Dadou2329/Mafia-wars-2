// Bras cybernétiques de la vue subjective (1/128 m, comme les mains) : avant-bras mécaniques des
// onze implants de bras, pièces mobiles et points remarquables (bouche du canon, bout du lanceur…).
//
// Repère de l'avant-bras (celui des manches de viewmodels.ts) : origine au poignet, l'avant-bras
// s'étend selon +Z vers le coude ; dessus +Y ; côté extérieur +X pour le bras droit (le gauche
// en est le miroir). L'organe de l'implant est posé là où la vue subjective le montre : sur le
// dessus (lanceur du grappin, logement du Viper, vérins du poing, écran du bras tactique), sur
// la diagonale dessus-extérieur (émetteur du bouclier, nacelle de roquettes), sur le flanc
// extérieur (fourreau de la lame Mantis, bobine du fouet), autour de l'avant-bras (anneaux du
// répulseur, bobines Tesla, électroaimants du grip). Face intérieure : tendons chromés et muscle
// synthétique. Au coude, la manche du parrain (revers, liseré de néon de Dadou, boutons d'Even).

import { glow } from '../characters/charMesher';
import { GLOW_CH, type ArmImplant } from '../characters/cyber';
import { Sculpt, segDist, supEll } from '../characters/sculpt';
import { IMPLANT_BY_ID, QUALITY_COLOR } from '../../shared/implants';
import { mix, SLOT, type VoxelModel } from './voxelModel';
import { HAND_RES, mirrorModelX, type ArmLook, type MechHandFP, type Vec3 } from './viewmodels';

const R = HAND_RES;

// alliage (mêmes teintes que les mains mécaniques)
const AL = 0x8a929d;
const AL_HI = 0xbcc4cf;
const AL_MID = 0x5d646e;
const AL_DK = 0x41474f;
const GR = 0x24272d;
const GR_HI = 0x34383f;
const CHROME = 0xd2dae4;
const RUBBER = 0x1b1c20;
const MUSCLE = 0x4a1e22;
const MUSCLE_HI = 0x6e2c2e;
const COPPER = 0xc07a42;
const COPPER_DK = 0x7a4626;
const GOLD = 0xe0b04a;
const BORE = 0x0b0c0f;
const BLADE = 0xa7afba;
const BLADE_DK = 0x5c636d;
const HAZARD = 0xd8a020;

/** Longueur de l'avant-bras (voxels) : poignet z = 0 → coude z = L. */
const L = 42;

/** Style de main mécanique par implant. */
export const FP_HAND_STYLE: Record<ArmImplant, MechHandFP['style']> = {
  grappin: 'std',
  pistoletBras: 'std',
  lame: 'std',
  poing: 'fist',
  bouclier: 'std',
  repulseur: 'palm',
  choc: 'tesla',
  outils: 'tool',
  grip: 'mag',
  roquettes: 'std',
  fouet: 'whip',
};

/** Pièce mobile d'un bras mécanique : modèle (repère de l'avant-bras) et pivot éventuel (m). */
export interface CyFpPart {
  name: string;
  model: VoxelModel;
  /** Pivot de rotation (m, repère de l'avant-bras) ; la pièce est modelée autour de lui. */
  pivot: Vec3;
}

export interface CyFpArm {
  forearm: VoxelModel;
  parts: CyFpPart[];
  /** Points remarquables (m, repère de l'avant-bras ; bras droit, miroir pour le gauche). */
  points: Record<string, Vec3>;
  /** Courses des pièces (m) : canon, lame, sondes, tiges. */
  travel: Record<string, number>;
}

/** Couleurs lumineuses d'un côté (canaux du bras gauche ou droit). */
export function fpGlow(id: ArmImplant, side: 'L' | 'R'): { accent: number; act: number; heat: number } {
  const col = IMPLANT_BY_ID[id]?.color ?? 0x4fd8ff;
  const L_ = side === 'L';
  return {
    accent: glow(col, L_ ? GLOW_CH.ARM_L : GLOW_CH.ARM_R),
    act: glow(col, L_ ? GLOW_CH.ARM_L_ACT : GLOW_CH.ARM_R_ACT),
    heat: glow(id === 'lame' ? 0xff7a2a : 0xff5a2a, L_ ? GLOW_CH.HEAT_L : GLOW_CH.HEAT_R),
  };
}

/** Main mécanique de l'implant (couleurs du côté). */
export function fpMech(id: ArmImplant, side: 'L' | 'R'): MechHandFP {
  const g = fpGlow(id, side);
  return { style: FP_HAND_STYLE[id], accent: g.accent, act: g.act };
}

/** Demi-largeur (x) et demi-hauteur (y) de la coque à la profondeur z. */
function shell(id: ArmImplant, z: number): [number, number] {
  const u = Math.max(0, Math.min(1, z / L));
  const k = id === 'poing' ? 1.2 : 1;
  return [(4.4 + 2.2 * u) * k, (3.9 + 2.0 * u) * k];
}

/** Disque d'axe quelconque (centre c, axe a normé) : distance radiale et position le long de l'axe. */
function discCoords(x: number, y: number, z: number, c: Vec3, a: Vec3): [number, number] {
  const dx = x - c[0];
  const dy = y - c[1];
  const dz = z - c[2];
  const along = dx * a[0] + dy * a[1] + dz * a[2];
  const rx = dx - a[0] * along;
  const ry = dy - a[1] * along;
  const rz = dz - a[2] * along;
  return [Math.hypot(rx, ry, rz), along];
}

const DIAG: Vec3 = [Math.SQRT1_2, Math.SQRT1_2, 0];

/**
 * Avant-bras mécanique d'un implant (vue subjective), côté et gamme donnés, avec la manche du
 * parrain au coude.
 */
export function cyberForearmFP(id: ArmImplant, q: number, side: 'L' | 'R', look: ArmLook): CyFpArm {
  const g = fpGlow(id, side);
  const col = IMPLANT_BY_ID[id]?.color ?? 0x4fd8ff;
  const livery = mix(col, 0x26282d, 0.45);
  const trim = glow(QUALITY_COLOR[Math.max(0, Math.min(4, q))], GLOW_CH.TRIM);
  const edge = q >= 4 ? GOLD : AL_HI;
  const s = new Sculpt(-16, 16, -14, 20, -4, L + 3, R);
  const sl = look.sleeve;
  const slHi = mix(sl, 0xa4a4b0, look.boss === 'dadou' ? 0.14 : 0.1);
  const slDk = mix(sl, 0x000000, 0.3);
  s.add((x, y, z) => {
    const [hx, hy] = shell(id, z);
    // manche du parrain au coude (revers ; Dadou : fil de néon ; Even : boutons d'argent)
    if (z > 34 && z < L + 2.5) {
      const e = supEll(x, y, hx + 2.2, hy + 2.2, 2.6);
      if (e <= 1) {
        if (z < 36.5) return look.boss === 'dadou' && z < 35.4 ? SLOT.NEON_RED : look.trim;
        if (look.boss === 'even' && x > hx + 0.8 && Math.abs(y) < 1 && Math.abs(z - 39) < 0.8) return look.accent;
        return y > hy * 0.5 ? slHi : y < -hy * 0.5 ? slDk : sl;
      }
    }
    // poignet : bague et anneau lumineux
    if (z >= -1 && z < 3) {
      const e = supEll(x, y, 3.9, 3.4, 2.4);
      if (e <= 1) return z > 0.4 && z < 1.6 && e > 0.55 ? g.accent : GR;
    }
    if (z < 3 || z > 35) return -1;
    const e = supEll(x, y, hx, hy, 2.8);
    if (e > 1) return -1;
    // âme
    if (supEll(x, y, hx - 1.6, hy - 1.6, 2.8) <= 1) return GR;
    // face intérieure (vers le centre de l'écran pour le bras droit) : muscle synthétique
    if (x < -hx * 0.55 && y < hy * 0.45 && y > -hy * 0.6) return Math.round(z) % 3 === 0 ? MUSCLE_HI : MUSCLE;
    // dessous : composite sombre, évents
    if (y < -hy * 0.6) return Math.round(z) % 6 === 0 && Math.abs(x) < 2 ? GR : GR_HI;
    // plaques supérieures en trois segments séparés d'un joint, arête claire en tête
    const seg = z < 13.5 ? 0 : z < 24.5 ? 1 : 2;
    const segZ0 = seg === 0 ? 3 : seg === 1 ? 14.5 : 25.5;
    if (Math.abs(z - 13.8) < 0.6 || Math.abs(z - 24.8) < 0.6) return GR;
    // liseré lumineux sur le flanc extérieur
    if (x > hx * 0.6 && Math.abs(y + 0.3) < 0.8 && z > 5 && z < 33) return g.accent;
    if (x > hx * 0.55) return y > 0 ? AL : AL_MID;
    if (z < segZ0 + 1) return edge;
    if (Math.abs(x) < 0.5 && y > 0) return GR_HI;
    if (seg === 1) return livery;
    return AL;
  });
  // tendons chromés sur la face intérieure, attaches sombres
  s.add((x, y, z) => {
    for (const yy of [1.6, -1.8]) {
      const [hx] = shell(id, 18);
      const d = segDist(x, y, z, -hx + 0.3, yy, 5, -shell(id, 31)[0] + 0.6, yy * 1.1, 31);
      if (d < 0.95) return z < 7.5 || z > 29.5 ? GR : CHROME;
    }
    return -1;
  });
  // gamme : témoins sur le flanc extérieur près du coude
  if (q >= 1) {
    s.add((x, y, z) => {
      const [hx] = shell(id, 30);
      for (let i = 0; i < Math.min(4, q); i++) if (Math.abs(z - (31 - i * 1.6)) < 0.5 && Math.abs(y - 2) < 0.6 && x > hx - 0.6 && x < hx + 0.6) return trim;
      return -1;
    });
  }
  const top = (z: number) => shell(id, z)[1];
  const outer = (z: number) => shell(id, z)[0];
  const parts: CyFpPart[] = [];
  const points: Record<string, Vec3> = {};
  const travel: Record<string, number> = {};
  const part = (name: string, pivot: Vec3, fn: (x: number, y: number, z: number) => number, bounds: [number, number, number, number, number, number] = [-16, 16, -14, 20, -46, L + 3]) => {
    const p = new Sculpt(bounds[0], bounds[1], bounds[2], bounds[3], bounds[4], bounds[5], R);
    p.add(fn);
    parts.push({ name, model: p.m, pivot: [pivot[0] * R, pivot[1] * R, pivot[2] * R] });
  };
  switch (id) {
    case 'grappin': {
      // lanceur sur le dessus, bobine de câble sur le flanc, crochet à trois griffes
      const ty = top(14) + 2.6;
      s.add((x, y, z) => {
        const r = Math.hypot(x, y - ty);
        if (z >= 1 && z <= 27 && r <= 2.7) {
          if (z < 2.6) return r < 1.3 ? BORE : AL_HI;
          if (Math.abs(z - 3.6) < 0.6) return g.act;
          if (Math.abs(z - 9) < 0.7 || Math.abs(z - 16) < 0.7 || Math.abs(z - 23) < 0.7) return GR;
          return y > ty + 1.2 ? AL : AL_DK;
        }
        // berceau entre le lanceur et la coque
        if (z > 6 && z < 24 && Math.abs(x) < 1.6 && y > top(z) - 0.5 && y < ty) return GR;
        // bobine (axe X) sur le flanc extérieur
        const rb = Math.hypot(y - 0.5, z - 24);
        const ox = outer(24);
        if (x > ox - 0.6 && x < ox + 2.4 && rb < 4.6) return rb < 1.4 ? g.act : rb > 3.7 ? AL_HI : x > ox + 1.4 ? (Math.round((Math.atan2(y - 0.5, z - 24) * 6) / Math.PI) % 2 === 0 ? GR_HI : GR) : GR;
        return -1;
      });
      part('hook', [0, ty, 0], (x, y, z) => {
        if (z > 1.2 || z < -8) return -1;
        const r = Math.hypot(x, y - ty);
        if (r < 1.1 && z > -3.5) return CHROME;
        for (const a of [Math.PI / 2, (Math.PI * 7) / 6, (Math.PI * 11) / 6]) {
          const ex = Math.cos(a) * 3.4;
          const ey = ty + Math.sin(a) * 3.4;
          if (segDist(x, y, z, Math.cos(a) * 0.8, ty + Math.sin(a) * 0.8, -2.5, ex, ey, -6.5) < 0.95) return AL_HI;
          if (segDist(x, y, z, ex, ey, -6.5, ex * 0.55, ty + (ey - ty) * 0.55, -7.8) < 0.85) return g.act;
        }
        return -1;
      });
      points.tip = [0, ty * R, -7 * R];
      break;
    }
    case 'pistoletBras': {
      // logement du canon : parois, fond lumineux, culasse ; capot en deux plaques ; canon coulissant
      const by = top(14) + 2.8;
      s.add((x, y, z) => {
        if (z < 2 || z > 30) return -1;
        const t = top(z);
        if (y < t - 0.6 || y > t + 5.4 || Math.abs(x) > 3.6) return -1;
        if (z > 27.5) return GR;
        if (z < 4.2) return Math.abs(x) < 2.3 && Math.abs(y - by) < 2.3 && Math.hypot(x, y - by) < 2.2 ? -1 : GR;
        if (Math.abs(x) > 2.4) return y > t + 4 ? AL_HI : AL_DK;
        if (y < t + 0.9) return Math.abs(x) < 0.8 && Math.round(z) % 3 !== 0 ? g.act : GR;
        return -1;
      });
      const hingeY = top(14) + 5.8;
      for (const [nm, sg] of [
        ['plateA', 1],
        ['plateB', -1],
      ] as const) {
        part(nm, [sg * 3.6, hingeY, 0], (x, y, z) => {
          const xx = x * sg;
          if (z < 3 || z > 29 || xx < 0.05 || xx > 3.65 || y < hingeY - 0.7 || y > hingeY + 0.6) return -1;
          if (z < 4.2 || xx > 3) return AL_HI;
          if (Math.abs(xx - 1.6) < 0.5 && z > 6 && z < 26) return g.accent;
          return z > 12 && z < 20 ? livery : AL;
        });
      }
      part('barrel', [0, by, 0], (x, y, z) => {
        if (z < 3.8 || z > 28) return -1;
        const r = Math.hypot(x, y - by);
        if (z < 6.4) return r < 0.85 ? BORE : r < 2.25 ? (z < 5 && Math.abs(x) > 1.4 ? GR_HI : GR) : -1;
        if (z > 7.2 && z < 8.6 && r < 2.0) return g.heat;
        if (r > 1.85) return -1;
        return r < 0.6 ? BORE : Math.round(z) % 4 === 0 ? AL_DK : CHROME;
      });
      travel.barrel = 24 * R;
      points.muzzle = [0, by * R, (3.8 - 24) * R];
      points.sight = [0, (by + 4.5) * R, -2 * R];
      break;
    }
    case 'lame': {
      // fourreau haut sur le flanc extérieur (visible de l'œil du parrain), fente lumineuse ;
      // lame à tranchant chauffé sur le dessus
      const ly = 2.2;
      s.add((x, y, z) => {
        if (z < 3 || z > 33) return -1;
        const ox = outer(z) - 0.4;
        const yy = y - ly;
        if (x < ox - 0.6 || x > ox + 3.4 || Math.abs(yy) > 3.4) return -1;
        if (x > ox + 0.5 && x < ox + 2.1 && Math.abs(yy) < 2.8 && z < 31) return -1;
        if (x > ox + 2.4 && Math.abs(yy) < 0.6) return g.act;
        return z < 5 || z > 31 ? GR : yy > 1.6 ? AL_HI : yy > -1 ? AL : AL_DK;
      });
      const bx = outer(18) + 0.9;
      part('blade', [bx, ly, 0], (x, y, z) => {
        if (Math.abs(x - bx) > 0.85 || z < -2 || z > 42) return -1;
        const yy = y - ly;
        const t = Math.max(0, 6 - z);
        const yTop = 2.7 - t * 0.12 - (z < 2 ? (2 - z) * 0.55 : 0);
        const yBot = -2.7 + t * 0.42;
        if (yy > yTop || yy < yBot) return -1;
        if (yy > yTop - 1.2) return g.heat;
        if (yy < yBot + 0.9) return AL_HI;
        return Math.abs(yy + 0.3) < 0.5 ? BLADE_DK : BLADE;
      });
      travel.blade = 34 * R;
      points.tip = [bx * R, ly * R, (-2 - 34) * R];
      break;
    }
    case 'poing': {
      // vérins hydrauliques sur le dessus, évents ambrés, manomètre
      s.add((x, y, z) => {
        const t = top(z);
        for (const px of [-2.7, 2.7]) {
          const r = Math.hypot(x - px, y - (t + 1.7));
          if (z >= 13 && z <= 31 && r <= 1.9) return z < 14.4 || z > 29.6 ? AL_HI : AL_DK;
        }
        const ox = outer(z);
        if (x > ox - 0.6 && x < ox + 0.9 && Math.abs(y) < 2.4 && z > 6 && z < 26) return Math.round(z) % 3 === 0 ? g.act : GR;
        const rg = Math.hypot(x, z - 33);
        if (rg < 2.2 && y > top(33) - 0.4 && y < top(33) + 1.4) return rg < 1.3 ? g.act : AL_HI;
        return -1;
      });
      part('rods', [0, 0, 0], (x, y, z) => {
        const t = top(8);
        for (const px of [-2.7, 2.7]) if (z >= -1 && z <= 15 && Math.hypot(x - px, y - (t + 1.7)) <= 1.15) return CHROME;
        if (z >= -2.4 && z <= 0 && Math.abs(x) < 4.2 && y > t + 0.4 && y < t + 3.2) return Math.abs(x) < 1 ? g.act : GR;
        return -1;
      });
      travel.rods = 5 * R;
      break;
    }
    case 'bouclier': {
      // émetteur sur la diagonale dessus-extérieur : couronne, lentille lumineuse alvéolée
      const c: Vec3 = [outer(16) * 0.72 + 0.8, top(16) * 0.72 + 0.8, 16];
      s.add((x, y, z) => {
        const [r, a] = discCoords(x, y, z, c, DIAG);
        if (a < -1.2 || a > 2.2 || r > 6.4) return -1;
        if (r > 4.8) return a > 1 ? AL_HI : AL_DK;
        if (a > 1) {
          if (r < 1.2) return GR_HI;
          const hex = Math.abs(Math.sin(x * 1.3 + z * 0.7) * Math.sin(y * 1.3 - z * 0.7)) < 0.18;
          return hex ? GR : g.act;
        }
        return GR;
      });
      part('fins', c, (x, y, z) => {
        const [r, a] = discCoords(x, y, z, c, DIAG);
        if (a < 0.2 || a > 1.4 || r < 6.4 || r > 8.4) return -1;
        // quatre ailettes
        const ux = x - c[0];
        const uz = z - c[2];
        const ang = Math.atan2(uz, ux - (y - c[1]));
        const m = Math.abs((((ang / (Math.PI / 2)) % 1) + 1) % 1 - 0.5);
        return m < 0.12 ? (r > 7.6 ? g.act : AL_HI) : -1;
      });
      points.emitter = [c[0] * R, c[1] * R, c[2] * R];
      break;
    }
    case 'repulseur':
    case 'choc':
    case 'grip': {
      const zs = id === 'grip' ? [11, 23] : [8, 16, 24];
      s.add((x, y, z) => {
        for (const z0 of zs) {
          const d = z - z0;
          if (d < -1.6 || d > 1.6) continue;
          const [hx, hy] = shell(id, z0);
          const e = supEll(x, y, hx + 1.4, hy + 1.4, 2.8);
          if (e > 1 || supEll(x, y, hx - 0.3, hy - 0.3, 2.8) <= 1) continue;
          if (id === 'choc') {
            // bobine de cuivre : spires et cœur lumineux
            const ang = Math.atan2(y, x);
            const turn = (Math.round(ang * 3 + d * 2) & 1) === 0;
            return Math.abs(d) < 0.6 ? g.act : turn ? COPPER : COPPER_DK;
          }
          if (id === 'grip') return Math.abs(d) < 0.6 ? g.act : CHROME;
          return Math.abs(d) < 0.6 ? g.act : d > 0 ? GR : GR_HI;
        }
        if (id === 'choc') {
          // condensateur sur le flanc extérieur
          const ox = outer(z);
          if (x > ox - 0.6 && x < ox + 2 && Math.abs(y) < 2.2 && z > 5 && z < 28) return Math.abs(y) < 0.7 && (Math.abs(z - 11) < 1 || Math.abs(z - 21) < 1) ? g.act : GR;
        }
        return -1;
      });
      break;
    }
    case 'outils': {
      // écran d'interface sur le dessus, clavier, câbles sur la face intérieure ; sondes sous le poignet
      s.add((x, y, z) => {
        const t = top(z);
        if (z > 7 && z < 25 && Math.abs(x) < 3.4 && y > t - 0.6 && y < t + 1.2) {
          if (Math.abs(x) > 2.6 || z < 8 || z > 24) return GR;
          return Math.round(z) % 2 === 0 ? g.act : Math.abs(x) < 1 ? g.act : GR_HI;
        }
        if (z > 26 && z < 32 && Math.abs(x) < 2.6 && y > t - 0.6 && y < t + 0.9) return (Math.round(x) + Math.round(z)) % 2 === 0 ? AL_HI : GR;
        const ix = -outer(z);
        for (const yy of [2.2, -0.6]) if (z > 4 && z < 33 && segDist(x, y, z, ix - 0.6, yy, 4, ix - 0.4 - Math.sin(z * 0.3) * 0.4, yy * 0.8, 33) < 1.0) return Math.round(z) % 5 === 0 ? HAZARD : RUBBER;
        return -1;
      });
      part('probe', [0, 0, 0], (x, y, z) => {
        for (const px of [-1.6, 1.6]) if (Math.hypot(x - px, y + top(4) - 0.9) < 0.75 && z > -1 && z < 22) return z < 0.5 ? g.act : CHROME;
        return -1;
      });
      travel.probe = 20 * R;
      break;
    }
    case 'roquettes': {
      // rail de la nacelle sur la diagonale ; nacelle (2 × 2 tubes) et capot mobiles
      s.add((x, y, z) => {
        const [r, a] = discCoords(x, y, z, [0, 0, 16], DIAG);
        void r;
        if (z > 6 && z < 26 && a > outer(z) * 0.72 + top(z) * 0.0 - 0.6 && a < outer(z) * 0.72 + 1.2 && Math.abs((x - y) * Math.SQRT1_2) < 1.6) return z > 23 ? AL_HI : GR;
        return -1;
      });
      const base = outer(16) * 0.72 + 1.2;
      const pc: Vec3 = [base * Math.SQRT1_2 + 0.9, base * Math.SQRT1_2 + 0.9, 23];
      const inPod = (x: number, y: number, z: number) => {
        // repère de la nacelle : u le long de la diagonale (hauteur), v en travers
        const u = (x + y) * Math.SQRT1_2 - base;
        const v = (x - y) * Math.SQRT1_2;
        return { u, v, ok: u > 0 && u < 6 && Math.abs(v) < 4 && z > 5 && z < 25 };
      };
      part('pod', pc, (x, y, z) => {
        const { u, v, ok } = inPod(x, y, z);
        if (!ok) return -1;
        for (const tu of [1.8, 4.2])
          for (const tv of [-1.8, 1.8]) {
            const rr = Math.hypot(u - tu, v - tv);
            if (rr < 1.15 && z < 8.5) return z < 6.4 ? -1 : g.act;
          }
        if (u > 5.2 && z > 8 && z < 22) return (Math.floor(z * 0.5 + v * 0.5) & 1) === 0 ? HAZARD : RUBBER;
        if (z > 23) return GR;
        return u < 1 ? AL_DK : AL;
      });
      part('cover', [pc[0], pc[1], 5], (x, y, z) => {
        const { u, v } = inPod(x, y, z);
        if (u < 0 || u > 6 || Math.abs(v) > 4 || z < 3.9 || z > 5.1) return -1;
        return Math.abs(v) < 0.6 ? g.accent : AL_HI;
      });
      points.pod = [pc[0] * R, pc[1] * R, 6 * R];
      break;
    }
    case 'fouet': {
      // bobine du filament près du poignet (flanc extérieur), gorge lumineuse le long du bras
      s.add((x, y, z) => {
        const ox = outer(z);
        if (x > ox - 0.4 && x < ox + 0.9 && Math.abs(y - 0.8) < 0.6 && z > 9 && z < 32) return g.act;
        const rb = Math.hypot(y - 0.6, z - 6.5);
        const ox6 = outer(6.5);
        if (x > ox6 - 0.6 && x < ox6 + 2.2 && rb < 3.4) return rb < 1.2 ? g.act : rb > 2.6 ? AL_HI : GR;
        return -1;
      });
      break;
    }
  }
  let forearm = s.m;
  if (side === 'L') {
    forearm = mirrorModelX(forearm);
    for (const p of parts) {
      p.model = mirrorModelX(p.model);
      p.pivot = [-p.pivot[0], p.pivot[1], p.pivot[2]];
    }
    for (const k of Object.keys(points)) points[k] = [-points[k][0], points[k][1], points[k][2]];
  }
  return { forearm, parts, points, travel };
}

/** Segment lumineux du filament du fouet (1/128 m), d'axe +Z, longueur 8 voxels. */
export function whipSegmentFP(): VoxelModel {
  const s = new Sculpt(-0.5, 0.5, -0.5, 0.5, 0, 8, R);
  s.add(() => glow(IMPLANT_BY_ID.fouet.color, GLOW_CH.WHIP));
  return s.m;
}
export const WHIP_SEG_FP = 8 * R;

/** Éclair (Tesla) : ligne brisée lumineuse, d'axe −Z, pour les étincelles au bout des doigts. */
export function sparkFP(seed: number, ch: number = GLOW_CH.ARM_R_ACT): VoxelModel {
  const s = new Sculpt(-4, 4, -4, 4, -12, 1, R);
  let x = 0;
  let y = 0;
  let h = seed * 9301 + 49297;
  const rnd = () => {
    h = (h * 9301 + 49297) % 233280;
    return h / 233280;
  };
  const pts: Vec3[] = [[0, 0, 0]];
  for (let z = -2; z >= -11; z -= 1.5) {
    x += (rnd() - 0.5) * 2.4;
    y += (rnd() - 0.5) * 2.4;
    x = Math.max(-3.5, Math.min(3.5, x));
    y = Math.max(-3.5, Math.min(3.5, y));
    pts.push([x, y, z]);
  }
  s.add((px, py, pz) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (segDist(px, py, pz, a[0], a[1], a[2], b[0], b[1], b[2]) < 0.55) return glow(0xc8f6ff, ch);
    }
    return -1;
  });
  return s.m;
}
