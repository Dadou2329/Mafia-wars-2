// Modèles détaillés de la vue subjective (1/64 m) : armes de 2085, mains et avant-bras des
// deux parrains.
//
// Repère commun à tous les modèles : −Z vers l'avant (vers la cible), +Y en haut, +X à
// droite ; l'origine est le point de prise de la main droite (le centre du poing autour de
// la poignée). Les métadonnées exportées (bouche du canon, point d'appui de la main gauche,
// ligne de mire, pièces mobiles) sont en mètres dans ce même repère.
//
// Les pièces mobiles (culasse, chargeurs, pompe, cellule d'énergie, levier d'armement) sont des
// modèles séparés que la vue subjective déplace en translation ; les poignées et les mains ont
// leur propre repère « main » (axe de la poignée selon +Y) incliné par `gripRot`.

import { SLOT, VoxelModel, mix, shade } from './voxelModel';

export const VM_RES = 1 / 64;
const R = VM_RES;

export type Vec3 = [number, number, number];

// ------------------------------------------------------------------ palette

/** Polymère noir (carcasses, poignées). */
const POLY = 0x1d1e22;
const POLY_HI = 0x2e3036;
const POLY_DK = 0x131417;
/** Acier traité (culasses, canons) : base, faces éclairées, arêtes, ombres. */
const STEEL = 0x353941;
const STEEL_HI = 0x545a66;
const STEEL_EDGE = 0x8a94a3;
const STEEL_DK = 0x22252b;
/** Culasse bicolore du Vektor (acier clair). */
const SLIDE = 0x4b525d;
const SLIDE_HI = 0x6a7381;
const CHROME = 0xb6bfcc;
const BORE = 0x0b0c0f;
/** Rayures jaunes du Wasp, rouge du Hammer, cuivre des rails du Longbow. */
const WASP_Y = 0xe2a91f;
const HAMMER = 0xa8281f;
const HAMMER_DK = 0x6e1a15;
const COPPER = 0xc07a42;
const COPPER_DK = 0x5e3820;
const RUBBER = 0x18191c;
const RUBBER_HI = 0x27282c;
/** Laiton des douilles, cartouches rouges. */
const BRASS = 0xc9a24a;
const BRASS_DK = 0x9c7a32;
const BRASS_HI = 0xe6c66e;
const SHELL_RED = 0xb0362c;
const SHELL_DK = 0x86271f;
/** Lame thermique : acier sombre, zone chauffée au rouge. */
const BLADE = 0x6a7079;
const BLADE_DK = 0x41464e;
const BLADE_HOT = 0x7e2a12;

// ------------------------------------------------------------------ grille locale

/**
 * Grille voxel adressée en coordonnées locales entières (bornes inclusives). Par défaut le
 * voxel (0,0,0) est centré sur l'origine ; `h` place l'origine ailleurs dans ce voxel
 * (0 = arête basse) pour centrer une pièce de largeur paire.
 */
class Grid {
  readonly m: VoxelModel;
  private readonly bx: number;
  private readonly by: number;
  private readonly bz: number;
  private readonly h: Vec3;

  constructor(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, h: Vec3 = [0.5, 0.5, 0.5]) {
    this.m = new VoxelModel(x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1, R);
    this.bx = -x0;
    this.by = -y0;
    this.bz = -z0;
    this.h = h;
    this.m.setOrigin(this.bx + h[0], this.by + h[1], this.bz + h[2]);
  }

  /** Coordonnée locale continue (centres de voxel aux entiers) → mètres. */
  p(x: number, y: number, z: number): Vec3 {
    return [(x + 0.5 - this.h[0]) * R, (y + 0.5 - this.h[1]) * R, (z + 0.5 - this.h[2]) * R];
  }

  set(x: number, y: number, z: number, c: number): this {
    this.m.set(x + this.bx, y + this.by, z + this.bz, c);
    return this;
  }

  get(x: number, y: number, z: number): number {
    return this.m.get(x + this.bx, y + this.by, z + this.bz);
  }

  /** Boîte aux bornes inclusives (couleur -1 = creuser). */
  fill(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number): this {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    this.m.box(x0 + this.bx, y0 + this.by, z0 + this.bz, x1 + this.bx + 1, y1 + this.by + 1, z1 + this.bz + 1, c);
    return this;
  }

  /** Repeint les cases déjà pleines d'une boîte. */
  paint(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number | ((x: number, y: number, z: number, old: number) => number)): this {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
          const old = this.get(x, y, z);
          if (old >= 0) this.set(x, y, z, typeof c === 'number' ? c : c(x, y, z, old));
        }
    return this;
  }

  /**
   * Couche horizontale dessinée : une chaîne par rangée z (z0, z0+1… : de l'avant vers
   * l'arrière), un caractère par colonne x (x0, x0+1… : de gauche à droite). '.' = vide.
   */
  layer(y: number, x0: number, z0: number, rows: string[], pal: Record<string, number>): this {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.' || ch === ' ') continue;
        const c = pal[ch];
        if (c === undefined) throw new Error(`couleur inconnue « ${ch} »`);
        this.set(x0 + i, y, z0 + j, c);
      }
    });
    return this;
  }
}

/** Copie miroir gauche/droite d'un modèle (pour la main gauche). */
export function mirrorModelX(m: VoxelModel): VoxelModel {
  const r = new VoxelModel(m.sx, m.sy, m.sz, m.res);
  for (let y = 0; y < m.sy; y++)
    for (let z = 0; z < m.sz; z++)
      for (let x = 0; x < m.sx; x++) r.data[r.idx(m.sx - 1 - x, y, z)] = m.data[m.idx(x, y, z)];
  r.setOrigin(m.sx - m.ox, m.oy, m.oz);
  return r;
}

const mirrorV = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];

// ------------------------------------------------------------------ métadonnées

export interface VmWeaponMeta {
  /** Bouche du canon (m) ; pointe de la lame ou bout de la matraque pour les armes blanches. */
  muzzle: Vec3;
  /** Point d'appui de la main gauche (m), ou null pour une arme tenue à une main. */
  support: Vec3 | null;
  /** Orientation de la main gauche au point d'appui (Euler XYZ, rad). */
  supportRot: Vec3;
  /** Pose de la main gauche : sous un garde-main (support) ou sur une poignée verticale (pistol). */
  supportPose?: 'support' | 'pistol';
  /** Orientation du repère « main droite » (poignée) par rapport à l'arme (Euler XYZ, rad). */
  gripRot: Vec3;
  /** Hauteur de la ligne de mire au-dessus de l'origine (m) ; elle est parallèle à −Z en x = 0. */
  sightY: number;
  /** Profondeur (z, m) de l'arrière et de l'avant des organes de visée. */
  rearSightZ: number;
  frontSightZ: number;
  /** Longueur hors tout (m). */
  length: number;
}

/** Poignée de pistolet 2 × 3 voxels (x −1..0, z −1..1) dans le repère main, axe selon +Y. */
function pistolGrip(top: number, bottom: number, c = POLY, strap = POLY_HI): Grid {
  const g = new Grid(-1, 0, bottom - 1, top + 1, -1, 3, [0, 0.5, 0.5]);
  g.fill(-1, 0, bottom, top, -1, 1, c);
  // dos de poignée texturé, ergot sous le pouce (queue de castor)
  for (let y = bottom; y < top; y += 2) g.paint(-1, 0, y, y, 1, 1, strap);
  g.fill(-1, 0, top + 1, top + 1, 1, 2, c);
  return g;
}

/** Pontet et détente sous la carcasse (repère de l'arme). */
function triggerGuard(g: Grid, c: number): void {
  g.fill(0, 0, -1, 0, -5, -5, c);
  g.fill(0, 0, -1, -1, -5, -1, c);
  g.set(0, 0, -3, STEEL_EDGE);
}

/**
 * Réticule de viseur holographique : anneau et point central lumineux, à une résolution
 * quatre fois plus fine que les armes (1/256 m) pour ne pas masquer la cible. Origine au centre.
 */
export function reticleModel(color: number): VoxelModel {
  const m = new VoxelModel(9, 9, 1, VM_RES / 4);
  for (let y = 0; y < 9; y++)
    for (let x = 0; x < 9; x++) {
      const d = Math.hypot(x - 4, y - 4);
      if ((d > 3.2 && d < 4.3) || (x === 4 && y === 4)) m.set(x, y, 0, color);
    }
  m.setOrigin(4.5, 4.5, 0.5);
  return m;
}

// ================================================================== PISTOLET VEKTOR

/** Pistolet intelligent Vektor : carcasse polymère, culasse acier, visée et compteur lumineux. */
export interface PistolModels {
  /** Carcasse, rail, module de visée, pontet (repère de l'arme). */
  frame: VoxelModel;
  /** Culasse (recule selon +Z au tir et pendant le rechargement). */
  slide: VoxelModel;
  /** Poignée (repère main, voir gripRot). */
  grip: VoxelModel;
  /** Chargeur (repère main) : glisse selon −Y quand on le libère. */
  mag: VoxelModel;
}

export const PISTOL: VmWeaponMeta = {
  muzzle: [0, 4 * R, -11.5 * R],
  support: null,
  supportRot: [0, 0, 0],
  gripRot: [-0.26, 0, 0],
  sightY: 6 * R,
  rearSightZ: 0,
  frontSightZ: -10 * R,
  length: 16 * R,
};

/** Course de la culasse au recul (m). */
export const PISTOL_SLIDE_TRAVEL = 3.5 * R;

export function pistolModels(): PistolModels {
  // --- carcasse
  const f = new Grid(-1, 1, -2, 2, -11, 1);
  f.fill(-1, 1, 1, 2, -9, 0, POLY);
  f.paint(-1, 1, 2, 2, -9, 0, POLY_HI);
  // rail d'accessoires et module de visée intelligente (lentille cyan)
  f.fill(-1, 1, 0, 0, -9, -7, POLY);
  f.set(-1, 0, -8, POLY_HI).set(1, 0, -8, POLY_HI);
  f.fill(-1, 1, 0, 1, -10, -10, STEEL_DK);
  f.set(0, 0, -11, SLOT.NEON_CYAN);
  f.fill(-1, 1, 1, 2, 1, 1, POLY);
  triggerGuard(f, POLY);
  // --- culasse bicolore, nez chanfreiné
  const s = new Grid(-1, 1, 3, 6, -11, 1);
  s.fill(-1, 1, 3, 5, -11, 1, SLIDE);
  s.paint(-1, 1, 5, 5, -11, 1, SLIDE_HI);
  s.paint(-1, 1, 3, 5, -11, -11, STEEL_DK);
  s.set(-1, 5, -11, -1).set(1, 5, -11, -1);
  s.set(0, 5, -11, STEEL);
  s.set(0, 4, -11, BORE);
  // stries avant et arrière, liseré cyan sur les flancs
  for (const z of [-1, 1, -9]) s.paint(-1, 1, 3, 4, z, z, STEEL_DK);
  s.paint(-1, -1, 4, 4, -7, -4, SLOT.NEON_CYAN);
  s.paint(1, 1, 4, 4, -7, -4, SLOT.NEON_CYAN);
  // fenêtre d'éjection, visée à trois points lumineux, compteur de munitions à l'arrière
  s.set(1, 5, -5, BORE).set(1, 5, -4, BORE);
  s.set(0, 6, -10, SLOT.NEON_CYAN);
  s.set(-1, 6, 0, STEEL_DK).set(1, 6, 0, STEEL_DK);
  s.set(-1, 6, 1, SLOT.NEON_CYAN).set(1, 6, 1, SLOT.NEON_CYAN);
  s.set(0, 4, 1, SLOT.NEON_CYAN);
  // --- poignée et chargeur (repère main)
  const g = pistolGrip(2, -3);
  g.paint(-1, 0, -1, -1, -1, -1, STEEL_HI);
  const mg = new Grid(-1, 0, -5, 1, -1, 2, [0, 0.5, 0.5]);
  mg.fill(-1, 0, -3, 1, -1, 1, POLY_DK);
  mg.fill(-1, 0, 1, 1, -1, -1, BRASS);
  mg.fill(-1, 0, -4, -4, -1, 2, POLY);
  mg.set(-1, -4, 2, SLOT.NEON_CYAN);
  return { frame: f.m, slide: s.m, grip: g.m, mag: mg.m };
}

// ================================================================== PISTOLET-MITRAILLEUR WASP

/** Pistolet-mitrailleur Wasp : chargeur translucide sur le dessus, viseur holographique. */
export interface SmgModels {
  /** Boîtier, canon, compensateur, viseur, pontet (repère de l'arme). */
  body: VoxelModel;
  /** Poignée (repère main, gripRot). */
  grip: VoxelModel;
  /** Poignée avant verticale (repère main gauche, posée en `support`). */
  foregrip: VoxelModel;
  /** Chargeur supérieur : se retire vers le haut et l'arrière. */
  mag: VoxelModel;
  /** Levier d'armement (côté gauche) : recule selon +Z. */
  handle: VoxelModel;
}

export const SMG: VmWeaponMeta = {
  muzzle: [0, 2 * R, -23.5 * R],
  support: [0, -3 * R, -11 * R],
  supportRot: [0.15, 0, 0],
  supportPose: 'pistol',
  gripRot: [-0.2, 0, 0],
  sightY: 9 * R,
  rearSightZ: 0,
  frontSightZ: -3 * R,
  length: 30 * R,
};

/** Centre du réticule du Wasp (dans la fenêtre du viseur). */
export const SMG_RETICLE: Vec3 = [0, 9 * R, -3.6 * R];

export function smgModels(): SmgModels {
  const b = new Grid(-2, 2, -2, 11, -23, 6);
  // boîtier à rayures de guêpe
  b.fill(-1, 1, 0, 3, -14, 5, POLY);
  b.paint(-1, 1, 3, 3, -14, 5, STEEL_DK);
  for (let z = -12; z <= 3; z++)
    for (let y = 1; y <= 2; y++) if ((((z + y) % 4) + 4) % 4 < 2) b.paint(-1, 1, y, y, z, z, WASP_Y);
  b.fill(-1, 1, 0, 3, 5, 6, POLY_DK);
  // manchon ajouré, compensateur aux évents lumineux
  b.fill(-1, 1, 1, 3, -20, -15, STEEL);
  for (const z of [-19, -17]) b.paint(-1, 1, 2, 2, z, z, BORE);
  b.fill(-1, 1, 1, 3, -23, -21, STEEL_DK);
  b.set(-1, 3, -22, SLOT.NEON_AMBER).set(1, 3, -22, SLOT.NEON_AMBER);
  b.set(0, 2, -23, BORE);
  triggerGuard(b, POLY);
  // viseur holographique sur le chargeur : embase, cadre fin à l'avant (réticule à part)
  b.fill(-1, 1, 7, 7, -3, 0, POLY_DK);
  b.fill(-2, -2, 7, 10, -3, -3, STEEL);
  b.fill(2, 2, 7, 10, -3, -3, STEEL);
  b.fill(-2, 2, 11, 11, -3, -3, STEEL);
  b.set(-2, 7, -2, POLY_DK).set(2, 7, -2, POLY_DK);
  // --- poignées
  const g = pistolGrip(2, -3);
  g.paint(-1, 0, -2, 0, 1, 1, WASP_Y);
  const fg = pistolGrip(1, -3, POLY, POLY_HI);
  fg.fill(-1, 0, 2, 2, -1, 1, STEEL_DK);
  // --- chargeur translucide : cartouches ambrées visibles
  const mg = new Grid(-1, 1, 4, 6, -13, 1);
  mg.fill(-1, 1, 4, 6, -13, 1, SLOT.GLASS);
  for (let z = -12; z <= 0; z += 2) mg.set(-1, 5, z, SLOT.NEON_AMBER).set(1, 5, z, SLOT.NEON_AMBER);
  mg.paint(-1, 1, 4, 6, 1, 1, POLY_DK);
  mg.paint(-1, 1, 4, 6, -13, -13, POLY_DK);
  // --- levier d'armement
  const h = new Grid(-3, -2, 3, 3, 2, 3);
  h.fill(-2, -2, 3, 3, 2, 3, STEEL_EDGE);
  h.set(-3, 3, 3, STEEL_HI);
  return { body: b.m, grip: g.m, foregrip: fg.m, mag: mg.m, handle: h.m };
}

// ================================================================== FUSIL À POMPE HAMMER

/** Fusil à pompe Hammer : boîte massive, canon à cache-chaleur sur tube-magasin, pompe crantée. */
export interface ShotgunModels {
  /** Boîte, canon, tube, porte-cartouches, crosse (repère de l'arme). */
  body: VoxelModel;
  /** Poignée (repère main, gripRot). */
  grip: VoxelModel;
  /** Pompe : coulisse selon +Z (la main gauche la suit). */
  pump: VoxelModel;
}

export const SHOTGUN: VmWeaponMeta = {
  muzzle: [0, 3.5 * R, -50.5 * R],
  support: [0, 1 * R, -24.5 * R],
  supportRot: [0, 0, 0],
  gripRot: [-0.36, 0, 0],
  sightY: 6 * R,
  rearSightZ: -2 * R,
  frontSightZ: -49 * R,
  length: 74 * R,
};

/** Course de la pompe (m). */
export const SHOTGUN_PUMP_TRAVEL = 6 * R;

export function shotgunModels(): ShotgunModels {
  const s = new Grid(-2, 1, -7, 7, -50, 22);
  // boîte de culasse, panneaux rouges, fenêtre de chargement dessous, éjection à droite
  s.fill(-1, 1, 0, 5, -10, 1, STEEL);
  s.paint(-1, 1, 5, 5, -10, 1, STEEL_HI);
  s.paint(-1, 1, 0, 1, -10, 1, STEEL_DK);
  s.paint(-1, -1, 2, 3, -9, -1, HAMMER);
  s.paint(1, 1, 2, 3, -9, -1, HAMMER);
  s.paint(-1, 1, 0, 0, -8, -3, BORE);
  s.paint(1, 1, 4, 4, -7, -4, BORE);
  // porte-cartouches sur le flanc gauche
  s.fill(-2, -2, 1, 4, -9, -2, POLY);
  for (const z of [-8, -6, -4]) {
    s.fill(-2, -2, 2, 4, z, z, SHELL_RED);
    s.set(-2, 1, z, BRASS);
  }
  // canon sous cache-chaleur, tube-magasin, guidon lumineux, œilleton
  s.fill(-1, 1, 3, 4, -50, -11, STEEL);
  s.paint(-1, 1, 4, 4, -50, -11, STEEL_HI);
  for (let z = -46; z <= -14; z += 4) s.paint(-1, 1, 3, 3, z, z, BORE);
  s.fill(-1, 1, 3, 4, -50, -50, STEEL_DK);
  s.set(0, 3, -50, BORE).set(0, 4, -50, BORE);
  s.fill(-1, 1, 0, 2, -44, -11, STEEL_DK);
  s.fill(-1, 1, 0, 2, -45, -45, STEEL_EDGE);
  s.set(0, 5, -49, STEEL_DK).set(0, 6, -49, SLOT.NEON_RED);
  s.set(-1, 6, -2, STEEL_DK).set(1, 6, -2, STEEL_DK).fill(-1, 1, 7, 7, -2, -2, STEEL_DK);
  triggerGuard(s, STEEL_DK);
  // crosse droite en polymère, filet rouge, plaque de couche
  for (let z = 2; z <= 20; z++) {
    const top = z < 12 ? 4 : 3;
    const bottom = -Math.floor((z - 2) * 0.32);
    s.fill(-1, 1, bottom, top, z, z, POLY);
  }
  s.paint(-1, 1, 3, 4, 2, 20, POLY_HI);
  s.paint(-1, -1, 1, 1, 4, 18, HAMMER);
  s.paint(1, 1, 1, 1, 4, 18, HAMMER);
  s.fill(-1, 1, -6, 3, 21, 22, RUBBER);
  // --- poignée
  const g = pistolGrip(2, -3);
  g.paint(-1, 0, -3, -3, -1, 1, HAMMER_DK);
  // --- pompe crantée (autour du tube)
  const p = new Grid(-2, 2, -1, 3, -31, -18);
  p.fill(-2, 2, -1, 3, -31, -18, POLY);
  for (let z = -30; z <= -19; z += 2) {
    p.paint(-2, -2, 0, 2, z, z, POLY_HI);
    p.paint(2, 2, 0, 2, z, z, POLY_HI);
    p.paint(-1, 1, -1, -1, z, z, POLY_HI);
  }
  p.paint(-2, 2, -1, 3, -31, -31, POLY_DK);
  p.paint(-2, 2, -1, 3, -18, -18, POLY_DK);
  return { body: s.m, grip: g.m, pump: p.m };
}

// ================================================================== FUSIL À RAIL LONGBOW

/** Fusil à rail Longbow : deux rails de cuivre, bobines lumineuses, cellule d'énergie. */
export interface RifleModels {
  /** Boîte, rails, frein de bouche, viseur, crosse squelette (repère de l'arme). */
  body: VoxelModel;
  /** Poignée (repère main, gripRot). */
  grip: VoxelModel;
  /** Cellule d'énergie (glisse selon −Y quand on l'éjecte). */
  cell: VoxelModel;
  /** Bobines éteintes et allumées (une par anneau, de l'arrière vers l'avant). */
  rings: VoxelModel[];
  ringsLit: VoxelModel[];
}

export const RIFLE: VmWeaponMeta = {
  muzzle: [0, 3 * R, -64.5 * R],
  support: [0, -1 * R, -25 * R],
  supportRot: [0, 0, 0],
  gripRot: [-0.3, 0, 0],
  sightY: 11 * R,
  rearSightZ: -3 * R,
  frontSightZ: -8 * R,
  length: 86 * R,
};

/** Centre du réticule du Longbow. */
export const RIFLE_RETICLE: Vec3 = [0, 11 * R, -8.6 * R];

/** Profondeur (voxels) du centre des bobines du Longbow. */
const RING_Z = [-23, -33, -43, -53];

export function rifleModels(): RifleModels {
  const s = new Grid(-2, 2, -6, 13, -64, 20);
  // boîte de culasse, flancs d'acier, voyants cyan
  s.fill(-1, 1, -1, 5, -14, 2, POLY);
  s.paint(-1, -1, 1, 3, -12, -2, STEEL);
  s.paint(1, 1, 1, 3, -12, -2, STEEL);
  s.paint(-1, -1, 4, 4, -12, -4, SLOT.NEON_CYAN);
  s.paint(1, 1, 4, 4, -12, -4, SLOT.NEON_CYAN);
  // rails supérieur et inférieur (faces intérieures en cuivre), fente entre les deux
  s.fill(-1, 1, 5, 6, -62, -15, STEEL);
  s.paint(-1, 1, 5, 5, -62, -15, COPPER);
  s.fill(-1, 1, 0, 1, -62, -15, STEEL);
  s.paint(-1, 1, 1, 1, -62, -15, COPPER);
  s.paint(-1, 1, 6, 6, -62, -15, STEEL_HI);
  // frein de bouche ajouré, bords lumineux autour de la fente
  s.fill(-2, 2, -1, 7, -64, -63, STEEL_DK);
  s.fill(-1, 1, 2, 4, -64, -63, -1);
  s.paint(-2, -2, 2, 4, -64, -64, SLOT.NEON_CYAN);
  s.paint(2, 2, 2, 4, -64, -64, SLOT.NEON_CYAN);
  // garde-main sous le rail inférieur
  s.fill(-1, 1, -2, -1, -32, -16, POLY);
  for (let z = -31; z <= -17; z += 3) s.paint(-1, 1, -2, -2, z, z, POLY_HI);
  // viseur holographique sur rehausse (au-dessus des bobines) : cadre fin à l'avant
  s.fill(-1, 1, 6, 8, -8, -2, POLY_DK);
  s.paint(-1, 1, 8, 8, -8, -2, POLY);
  s.fill(-2, 2, 9, 9, -8, -8, STEEL);
  s.fill(-2, -2, 10, 12, -8, -8, STEEL);
  s.fill(2, 2, 10, 12, -8, -8, STEEL);
  s.fill(-2, 2, 13, 13, -8, -8, STEEL);
  triggerGuard(s, POLY);
  // crosse squelette : barres supérieure et inférieure, entretoise, plaque de couche
  s.fill(-1, 1, 2, 3, 3, 18, POLY);
  s.fill(-1, 1, -5, -4, 8, 18, POLY);
  for (let i = 0; i <= 5; i++) s.fill(-1, 1, -4 + i, -4 + i, 8 - i, 8 - i, POLY);
  s.fill(-1, 1, -5, 3, 19, 20, RUBBER);
  s.paint(-1, 1, 3, 3, 3, 18, POLY_HI);
  // --- poignée
  const g = pistolGrip(2, -3);
  // --- cellule d'énergie (devant le pontet), fenêtre lumineuse
  const c = new Grid(-1, 1, -7, -2, -12, -8);
  c.fill(-1, 1, -6, -2, -12, -8, POLY_DK);
  c.paint(-1, -1, -5, -3, -11, -9, SLOT.NEON_CYAN);
  c.paint(1, 1, -5, -3, -11, -9, SLOT.NEON_CYAN);
  c.fill(-1, 1, -7, -7, -12, -8, STEEL_DK);
  // --- bobines (cadres autour des rails)
  const ring = (z: number, lit: boolean): VoxelModel => {
    const r = new Grid(-2, 2, -1, 7, z - 1, z);
    r.fill(-2, 2, -1, 7, z - 1, z, lit ? SLOT.NEON_CYAN : COPPER_DK);
    r.fill(-1, 1, 0, 6, z - 1, z, -1);
    if (!lit) r.paint(-2, 2, 7, 7, z - 1, z, COPPER);
    return r.m;
  };
  return { body: s.m, grip: g.m, cell: c.m, rings: RING_Z.map((z) => ring(z, false)), ringsLit: RING_Z.map((z) => ring(z, true)) };
}

// ================================================================== LAME THERMIQUE

export const KNIFE: VmWeaponMeta = {
  muzzle: [0, 0, -16.5 * R],
  support: null,
  supportRot: [0, 0, 0],
  gripRot: [0, 0, 0],
  sightY: 0,
  rearSightZ: 0,
  frontSightZ: 0,
  length: 22 * R,
};

/** Lame thermique : manche caoutchouté, garde, lame tantō au tranchant chauffé à blanc. */
export function knifeModel(): VoxelModel {
  // largeur 1, hauteur paire autour de l'origine (centre du manche entre les rangées -1 et 0)
  const g = new Grid(0, 0, -3, 2, -17, 5, [0.5, 0, 0.5]);
  g.fill(0, 0, -1, 0, -2, 4, RUBBER);
  for (const z of [-1, 1, 3]) g.paint(0, 0, -1, 0, z, z, RUBBER_HI);
  g.fill(0, 0, -1, 0, 5, 5, STEEL);
  g.set(0, 0, 5, SLOT.NEON_AMBER);
  g.fill(0, 0, -2, 1, -3, -3, STEEL_DK);
  // lame : dos sombre, corps chauffé, tranchant incandescent, pointe tantō
  g.fill(0, 0, 1, 1, -13, -4, BLADE_DK);
  g.fill(0, 0, 0, 0, -15, -4, BLADE);
  g.fill(0, 0, 0, 0, -14, -8, BLADE_HOT);
  g.fill(0, 0, -1, -1, -15, -5, SLOT.NEON_AMBER);
  g.set(0, -1, -4, BLADE);
  g.set(0, 1, -14, BLADE_DK);
  g.set(0, 0, -16, SLOT.NEON_AMBER);
  g.set(0, -1, -15, SLOT.FIRE);
  return g.m;
}

// ================================================================== MATRAQUE ÉLECTRIQUE

export const CLUB: VmWeaponMeta = {
  muzzle: [0, 0, -31.5 * R],
  support: null,
  supportRot: [0, 0, 0],
  gripRot: [0, 0, 0],
  sightY: 0,
  rearSightZ: 0,
  frontSightZ: 0,
  length: 37 * R,
};

/** Matraque électrique télescopique : poignée caoutchoutée, anneau lumineux, électrodes bleues. */
export function clubModel(): VoxelModel {
  const g = new Grid(-1, 1, -5, 1, -31, 6);
  const round = (z: number, c: number) => {
    g.fill(-1, 1, 0, 0, z, z, c);
    g.fill(0, 0, -1, 1, z, z, c);
  };
  // poignée (fine là où le poing la serre), pommeau, dragonne
  for (let z = -2; z <= 1; z++) g.set(0, 0, z, RUBBER);
  for (const z of [2, 3]) round(z, z & 1 ? RUBBER_HI : RUBBER);
  for (const z of [4, 5]) round(z, STEEL_DK);
  g.fill(0, 0, -3, -2, 5, 5, RUBBER);
  g.fill(0, 0, -4, -4, 4, 6, RUBBER_HI);
  // garde et anneau lumineux
  round(-3, STEEL);
  round(-4, SLOT.NEON_BLUE);
  // fût télescopique : trois segments de plus en plus fins
  for (let z = -13; z <= -5; z++) round(z, POLY);
  g.paint(0, 0, 1, 1, -11, -7, SLOT.NEON_BLUE);
  round(-14, STEEL_HI);
  for (let z = -21; z <= -15; z++) g.set(0, 0, z, STEEL);
  for (let z = -27; z <= -22; z++) g.set(0, 0, z, CHROME);
  // tête à électrodes
  for (const z of [-28, -29]) round(z, STEEL_DK);
  g.set(-1, 0, -30, SLOT.NEON_BLUE).set(1, 0, -30, SLOT.NEON_BLUE).set(0, 1, -30, SLOT.NEON_BLUE).set(0, -1, -30, SLOT.NEON_BLUE);
  g.set(0, 0, -31, SLOT.NEON_BLUE);
  return g.m;
}

// ================================================================== MAINS ET AVANT-BRAS

/** Poses de la main : poignée de pistolet, poignet de crosse, appui sous la longuesse, poing, manche. */
export type HandPose = 'pistol' | 'stock' | 'support' | 'fist' | 'blade';

/** Tenue des bras (couleurs sRGB issues de la tenue du parrain). */
export interface ArmLook {
  boss: 'dadou' | 'even';
  /** Couleur de la main : peau nue (Dadou) ou gant de cuir (Even). */
  hand: number;
  glove: boolean;
  /** Manche du manteau, parement (doublure, passepoil), poignet de chemise, bijoux/boutons. */
  sleeve: number;
  trim: number;
  cuff: number;
  accent: number;
}

export interface ArmModels {
  /** Main : origine au point de prise. */
  hand: VoxelModel;
  /** Avant-bras (manche, poignet de chemise) : origine au poignet, s'étend selon +Z vers le coude. */
  forearm: VoxelModel;
  /** Poignet dans le repère de la main (m). */
  wrist: Vec3;
}

/** Longueur de l'avant-bras (m). */
export const FOREARM_LENGTH = 21 * R;

interface HandPalette {
  [k: string]: number;
}

function handPalette(look: ArmLook): HandPalette {
  const b = look.hand;
  if (look.glove) {
    return {
      s: b,
      a: shade(b, 0.78),
      h: mix(b, 0x9a8a78, 0.32),
      d: shade(b, 0.68),
      n: mix(b, 0x9a8a78, 0.2),
      g: b,
      k: mix(b, 0xc8b496, 0.38),
      w: mix(b, 0x9a8a78, 0.16),
    };
  }
  return {
    s: b,
    a: shade(b, 0.87),
    h: shade(b, 1.1),
    d: shade(b, 0.74),
    n: mix(b, 0xfbe4dc, 0.6),
    g: look.accent,
    k: b,
    w: shade(b, 0.93),
  };
}

/**
 * Main droite refermée sur une crosse de revolver. Repère main : axe de la poignée selon +Y
 * (index en haut), dos de la main à droite (+X), doigts autour de l'avant (−Z), pouce le long
 * du flanc gauche ; poignée de 2 × 3 voxels (x ∈ {−1, 0}, z ∈ {−1, 0, 1}), origine centrée.
 */
function pistolHand(pal: HandPalette): { m: VoxelModel; wrist: Vec3 } {
  const g = new Grid(-2, 2, -3, 2, -3, 3, [0, 0.5, 0.5]);
  const L = (y: number, rows: string[]) => g.layer(y, -2, -3, rows, pal);
  // colonnes x : -2 (pouce, bouts des doigts), -1 0 (poignée), 1 (phalanges, paume), 2 (dos de la main)
  // rangées z : -3 (devant) … 3 (poignet) ; entre les bouts des doigts et l'éminence du pouce,
  // le noyer de la crosse reste visible
  L(2, ['n....', 's....', 's....', 'sss..', 'ssss.', '.hhs.', '.....']); // pouce le long de la carcasse, palmure
  L(1, ['.....', '..sh.', 'n..s.', 's..sh', 's..ss', '.hssa', '.....']); // index sur la détente
  L(0, ['.....', 'nssh.', 'n..sh', '...ss', 'h..ss', '.hssa', '.sss.']); // majeur
  L(-1, ['.....', 'naah.', 'n..gh', '...ak', 's..as', '.ssaa', '.sss.']); // annulaire (bague)
  L(-2, ['.....', '.nsh.', '.n.gh', '...ss', 's..sk', '.ssaa', '.ss..']); // auriculaire (chevalière)
  L(-3, ['.....', '.....', '.....', '...s.', '...sa', '..sa.', '.....']); // tranche de la main
  return { m: g.m, wrist: g.p(0, -1, 3.5) };
}

/**
 * Main droite sur le poignet d'une crosse d'arme longue (repère de l'arme) : poignet de
 * 3 × 3 voxels centré sur l'origine, doigts dessous, pouce par-dessus, index sur la détente.
 */
function stockHand(pal: HandPalette): { m: VoxelModel; wrist: Vec3 } {
  const g = new Grid(-2, 3, -3, 2, -4, 4);
  const L = (y: number, rows: string[]) => g.layer(y, -2, -4, rows, pal);
  // colonnes x : -2 (bouts des doigts), -1..1 (poignet de crosse), 2 (paume, phalanges), 3 (dos de la main)
  // rangées z : -4 (index sur la détente) … 4 (poignet) ; le pouce passe par-dessus
  L(2, ['......', '......', '.nssh.', '....hs', '....hs', '....hs', '....s.', '......', '......']);
  L(1, ['......', '......', '....ss', 'n...ss', 'n...ss', '....sk', '....ss', '....s.', '......']);
  L(0, ['......', '......', '....ss', 's...ss', 'a...as', '....sk', '....ss', '....ss', '......']);
  L(-1, ['......', '......', '....s.', 's...s.', 'a...a.', '....s.', '....ss', '....ss', '......']);
  L(-2, ['..ns..', '...h..', '...ss.', '.ssh..', '.aah..', '.ssh..', '......', '......', '......']);
  L(-3, ['......', '......', '......', '..d...', '..d...', '......', '......', '......', '......']);
  return { m: g.m, wrist: g.p(2.5, -0.5, 3.5) };
}

/**
 * Main gauche en coupe sous une longuesse (repère de l'arme) : longuesse de 3 × 3 voxels
 * centrée sur l'origine, paume dessous, pouce le long du flanc gauche, doigts remontant à droite.
 */
function supportHand(pal: HandPalette): { m: VoxelModel; wrist: Vec3 } {
  const g = new Grid(-2, 2, -3, 2, -4, 3);
  const L = (y: number, rows: string[]) => g.layer(y, -2, -4, rows, pal);
  // colonnes x : -2 (pouce couché le long du flanc gauche), -1..1 (longuesse), 2 (doigts remontant à droite)
  // rangées z : -4 (devant) … 3 (poignet)
  L(1, ['.....', '.....', '....n', '....n', '....n', '.....', '.....', '.....']);
  L(0, ['.....', 'n....', '....s', '....a', '....s', '....n', '.....', '.....']);
  L(-1, ['.....', '.....', 's...a', 's...s', 's...a', 's...s', '.....', '.....']);
  L(-2, ['.....', '.....', '.sssh', 'ssssh', 'ssssh', 'sssss', 'sss..', '.ss..']);
  L(-3, ['.....', '.....', '..ddd', '.dddd', '.ddkd', '.ddd.', '.ss..', '.ss..']);
  return { m: g.m, wrist: g.p(-0.5, -2.5, 3.5) };
}

/**
 * Poing droit fermé (boxe) : phalanges vers −Z, dos de la main vers +Y, pouce replié devant
 * l'index et le majeur. Origine au centre du poing.
 */
function fistHand(pal: HandPalette): { m: VoxelModel; wrist: Vec3 } {
  const g = new Grid(-2, 2, -2, 2, -4, 3);
  const L = (y: number, rows: string[]) => g.layer(y, -2, -4, rows, pal);
  // colonnes x : -2 (pouce), -1 index, 0 majeur, 1 annulaire, 2 auriculaire ; rangées z : -4 … 3
  L(1, ['.....', '.ghhg', '.ssss', '.skss', '.ssss', '..ss.', '..ss.', '.....']);
  L(0, ['.....', '.sasa', 'sssss', 'sssss', '.ssss', '.sss.', '.sss.', '.....']);
  L(-1, ['.....', '.sn..', 'sdada', '.dddd', '.dddd', '..ss.', '..ss.', '.....']);
  return { m: g.m, wrist: g.p(0.5, 0, 2.5) };
}

/**
 * Main droite serrée sur un manche dirigé vers −Z (couteau, matraque) : dos de la main à
 * droite, pouce par-dessus, doigts dessous et bouts des doigts à gauche. Manche de 1 × 2
 * voxels (x = 0, y ∈ {−1, 0}), origine au centre du manche.
 */
function bladeHand(pal: HandPalette): { m: VoxelModel; wrist: Vec3 } {
  const g = new Grid(-1, 2, -2, 1, -3, 3, [0.5, 0, 0.5]);
  const L = (y: number, rows: string[]) => g.layer(y, -1, -3, rows, pal);
  // colonnes x : -1 (bouts des doigts), 0 (manche), 1 (paume/phalanges), 2 (dos de la main)
  L(1, ['....', 'nssh', '.ssh', '.ssh', '.ssh', '...s', '....']);
  L(0, ['....', 's.ss', 's.ss', 'a.ak', 's.ss', '..ss', '....']);
  L(-1, ['....', 's.ss', 'n.ss', 'n.as', '..ss', '..ss', '....']);
  L(-2, ['....', '.sh.', '.sh.', '.ah.', '.sh.', '....', '....']);
  return { m: g.m, wrist: g.p(1.5, -0.5, 2.5) };
}

/**
 * Avant-bras : poignet, manchette de chemise, manche du manteau avec son parement. Origine au
 * poignet, la manche s'étend selon +Z vers le coude ; le côté extérieur du bras est +X.
 */
function forearmModel(look: ArmLook): VoxelModel {
  // section paire (6 × 6 pour la manche) : origine au coin commun des quatre voxels centraux
  const g = new Grid(-3, 2, -3, 2, -1, 20, [0, 0, 0.5]);
  const pal = handPalette(look);
  const ring = (z: number, r: number, c: number) => {
    // octogone : carré de côté 2r privé de ses coins
    g.fill(-r, r - 1, -r + 1, r - 2, z, z, c);
    g.fill(-r + 1, r - 2, -r, r - 1, z, z, c);
  };
  // poignet (sous la manchette)
  g.fill(-1, 0, -1, 0, -1, 0, pal.w);
  // manchette de chemise, bouton de manchette (or pour Dadou, argent pour Even)
  const cuff = look.cuff;
  ring(1, 2, cuff);
  g.paint(-2, 1, -2, -2, 1, 1, shade(cuff, 0.86));
  g.set(1, 0, 1, look.accent);
  g.set(1, -1, 1, look.accent);
  // manche : section octogonale, lustre du drap dessus, ombre dessous
  const sl = look.sleeve;
  const slHi = mix(sl, 0xa4a4b0, look.boss === 'dadou' ? 0.16 : 0.1);
  const slDk = shade(sl, 0.72);
  for (let z = 2; z <= 20; z++) ring(z, 3, sl);
  g.paint(-2, 1, 2, 2, 2, 20, slHi);
  g.paint(-2, 1, -3, -3, 2, 20, slDk);
  // plis du drap au creux du coude
  for (const z of [11, 15, 18]) {
    g.paint(-3, -3, -2, 1, z, z, slDk);
    g.paint(-2, 1, -3, -3, z, z, shade(sl, 0.6));
    g.set(-3, 1, z + 1, slHi);
  }
  const trim = look.trim;
  if (look.boss === 'dadou') {
    // revers cramoisi liseré d'un fil de néon rouge
    g.paint(-3, 2, -3, 2, 2, 3, trim);
    g.paint(-3, 2, -3, 2, 4, 4, SLOT.NEON_RED);
  } else {
    // revers bleu, trois boutons d'argent sur le côté extérieur
    g.paint(-3, 2, -3, 2, 2, 4, trim);
    for (const z of [6, 8, 10]) g.set(2, 0, z, look.accent);
  }
  return g.m;
}

/** Construit la main (pose donnée) et l'avant-bras d'un côté. */
export function armModels(side: 'R' | 'L', pose: HandPose, look: ArmLook): ArmModels {
  const pal = handPalette(look);
  let h: { m: VoxelModel; wrist: Vec3 };
  switch (pose) {
    case 'pistol':
      h = pistolHand(pal);
      break;
    case 'stock':
      h = stockHand(pal);
      break;
    case 'support':
      h = supportHand(pal);
      break;
    case 'blade':
      h = bladeHand(pal);
      break;
    case 'fist':
    default:
      h = fistHand(pal);
      break;
  }
  let hand = h.m;
  let wrist = h.wrist;
  let fore = forearmModel(look);
  // la main d'appui est dessinée gauche ; les autres sont dessinées droites
  const drawnLeft = pose === 'support';
  if ((side === 'L') !== drawnLeft) {
    hand = mirrorModelX(hand);
    wrist = mirrorV(wrist);
  }
  if (side === 'L') fore = mirrorModelX(fore);
  return { hand, forearm: fore, wrist };
}

/**
 * Drap vu de très près : on retire un peu de saturation (le rendu filmique pousse les
 * bleus sombres vers un bleu électrique) en gardant la teinte choisie par le joueur.
 */
function cloth(c: number, k = 0.28): number {
  const l = Math.round(((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11);
  return mix(c, (l << 16) | (l << 8) | l, k);
}

/** Tenue des bras d'un parrain à partir de sa tenue (couleurs de `appearanceFor`, personnalisation comprise). */
export function armLookFor(boss: 'dadou' | 'even', outfit: { skin: number; coat: number; coat2: number; shirt: number; accent: number; vest: number }): ArmLook {
  if (boss === 'even') {
    return {
      boss,
      hand: 0x2a2420,
      glove: true,
      sleeve: cloth(outfit.coat),
      trim: cloth(outfit.coat2),
      cuff: mix(outfit.shirt, outfit.vest, 0.25),
      accent: outfit.accent,
    };
  }
  return {
    boss,
    hand: outfit.skin,
    glove: false,
    sleeve: cloth(outfit.coat),
    trim: cloth(outfit.coat2, 0.12),
    cuff: outfit.shirt,
    accent: outfit.accent,
  };
}

// ================================================================== DOUILLES, CHARGEURS, CELLULES

/** Objets éjectés ou tenus par la main d'appoint pendant les rechargements. */
export type CasingKind = 'pistol' | 'shell' | 'mag' | 'smgMag' | 'cell' | 'cellSpent';

/**
 * Douille de pistolet (laiton), cartouche de fusil (rouge à culot de laiton), chargeur de
 * pistolet, chargeur translucide du Wasp, cellule d'énergie du Longbow (pleine ou vide). Les
 * chargeurs et cellules sont dans le même repère que sur l'arme (centrés sur leur origine).
 */
export function casingModel(kind: CasingKind): VoxelModel {
  switch (kind) {
    case 'shell': {
      const g = new Grid(0, 0, 0, 0, -2, 0);
      g.set(0, 0, 0, BRASS).set(0, 0, -1, SHELL_DK).set(0, 0, -2, SHELL_RED);
      return g.m;
    }
    case 'mag': {
      const g = new Grid(-1, 0, -3, 2, -1, 2, [0, 0.5, 0.5]);
      g.fill(-1, 0, -2, 2, -1, 1, POLY_DK);
      g.fill(-1, 0, 2, 2, -1, -1, BRASS);
      g.fill(-1, 0, -3, -3, -1, 2, POLY);
      g.set(-1, -3, 2, SLOT.NEON_CYAN);
      return g.m;
    }
    case 'smgMag': {
      const g = new Grid(-1, 1, -1, 1, -7, 7);
      g.fill(-1, 1, -1, 1, -7, 7, SLOT.GLASS);
      for (let z = -6; z <= 6; z += 2) g.set(-1, 0, z, SLOT.NEON_AMBER).set(1, 0, z, SLOT.NEON_AMBER);
      g.paint(-1, 1, -1, 1, 7, 7, POLY_DK);
      g.paint(-1, 1, -1, 1, -7, -7, POLY_DK);
      return g.m;
    }
    case 'cell':
    case 'cellSpent': {
      const g = new Grid(-1, 1, -3, 2, -2, 2);
      g.fill(-1, 1, -2, 2, -2, 2, POLY_DK);
      g.paint(-1, -1, -1, 1, -1, 1, kind === 'cell' ? SLOT.NEON_CYAN : COPPER_DK);
      g.paint(1, 1, -1, 1, -1, 1, kind === 'cell' ? SLOT.NEON_CYAN : COPPER_DK);
      g.fill(-1, 1, -3, -3, -2, 2, STEEL_DK);
      g.fill(-1, 1, 2, 2, -1, 1, kind === 'cell' ? COPPER : COPPER_DK);
      return g.m;
    }
    case 'pistol':
    default: {
      const g = new Grid(0, 0, 0, 0, -1, 0);
      g.set(0, 0, 0, BRASS_DK).set(0, 0, -1, BRASS_HI);
      return g.m;
    }
  }
}
