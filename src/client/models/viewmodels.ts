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

/**
 * Mains et avant-bras de la vue subjective, au 1/128 m (deux fois plus fins que les armes) :
 * une main anatomique (paume, éminence du pouce, quatre doigts à trois phalanges, pouce, ongles,
 * jointures, plis) posée sur chaque prise par ses angles d'articulation, puis voxelisée dans le
 * repère de la prise. Manches des parrains : drap du manteau, revers, poignet de chemise,
 * boutons de manchette, fil de néon (Dadou) ; gants de cuir (Even).
 */
export const HAND_RES = 1 / 128;

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

// --- géométrie de la main droite, repère anatomique A (cm) : origine au poignet, doigts vers
// +Y, paume vers +Z, pouce vers +X.

type P3 = [number, number, number];

interface FingerDef {
  base: P3;
  len: [number, number, number];
  rad: [number, number, number];
  /** Écartement (rad, dans le plan de la paume). */
  spread: number;
}

const FINGERS: FingerDef[] = [
  { base: [2.75, 9.0, -0.2], len: [4.0, 2.4, 1.9], rad: [0.98, 0.9, 0.82], spread: 0.08 }, // index
  { base: [0.9, 9.3, -0.2], len: [4.4, 2.8, 2.0], rad: [1.0, 0.92, 0.84], spread: 0 }, // majeur
  { base: [-0.95, 9.0, -0.2], len: [4.1, 2.6, 1.9], rad: [0.95, 0.88, 0.8], spread: -0.06 }, // annulaire
  { base: [-2.75, 8.3, -0.25], len: [3.3, 2.0, 1.7], rad: [0.82, 0.76, 0.7], spread: -0.14 }, // auriculaire
];

/** Pose d'une main : flexions des doigts (MCP, IPP, IPD), chaîne du pouce, placement. */
interface HandPoseDef {
  /** Flexion de chaque doigt (rad) : index, majeur, annulaire, auriculaire. */
  curl: [number, number, number][];
  /** Pouce : points (repère A, cm) de la base vers la pointe. */
  thumb: P3[];
  /** Repère A → repère de la prise : axes de A exprimés dans la prise, puis translation (cm). */
  ax: P3;
  ay: P3;
  az: P3;
  t: P3;
}

const deg = (d: number) => (d * Math.PI) / 180;

/** Normalise et orthogonalise une base (y prioritaire, puis z), x = y × z. */
function basis(y: P3, z: P3): { x: P3; y: P3; z: P3 } {
  const ny = norm(y);
  let nz = sub(z, scale(ny, dot(z, ny)));
  nz = norm(nz);
  const nx = cross(ny, nz);
  return { x: nx, y: ny, z: nz };
}
const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: P3, k: number): P3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: P3): P3 => scale(a, 1 / Math.max(1e-9, Math.hypot(a[0], a[1], a[2])));

/**
 * Poses. La prise est dans le repère de l'arme ou de sa pièce (voir les modèles d'armes) :
 * poignée de pistolet selon +Y (canon vers −Z, 3,1 × 4,7 cm), longuesse selon Z, manche du
 * couteau selon Z. Valeurs mises au point à la planche d'inspection (?vm&inspect).
 */
function poseDef(pose: HandPose): HandPoseDef {
  switch (pose) {
    case 'pistol':
    case 'stock': {
      // doigts autour de la face avant de la poignée, index sur la détente, pouce le long du
      // flanc gauche ; paume contre le flanc droit
      const b = basis([0, 0.06, -1], [-1, 0, 0.12]);
      return {
        curl: [
          [deg(28), deg(48), deg(18)],
          [deg(80), deg(92), deg(38)],
          [deg(82), deg(95), deg(38)],
          [deg(84), deg(96), deg(38)],
        ],
        thumb: [
          [3.1, 1.9, 0.5],
          [4.4, 5.0, 2.4],
          [4.0, 7.6, 4.0],
          [3.4, 9.9, 4.6],
        ],
        ax: b.x,
        ay: b.y,
        az: b.z,
        t: [2.85, pose === 'stock' ? -0.6 : -0.45, 6.75],
      };
    }
    case 'support': {
      // main droite sous la longuesse (dessinée droite puis copiée en miroir pour la gauche) :
      // paume vers le haut, doigts remontant sur le flanc gauche, pouce le long du flanc droit
      const b = basis([-0.72, 0.12, -0.62], [0.12, 1, -0.08]);
      return {
        curl: [
          [deg(38), deg(62), deg(26)],
          [deg(42), deg(66), deg(28)],
          [deg(44), deg(68), deg(28)],
          [deg(48), deg(70), deg(28)],
        ],
        thumb: [
          [3.1, 1.9, 0.5],
          [4.6, 5.0, 1.4],
          [5.2, 7.8, 1.6],
          [5.3, 10.2, 1.4],
        ],
        ax: b.x,
        ay: b.y,
        az: b.z,
        t: [4.9, -4.0, 6.6],
      };
    }
    case 'blade': {
      // poing serré sous un manche dirigé vers −Z (lame en avant) : main sous le manche, doigts
      // qui remontent autour, index vers la lame, poignet en dessous et en arrière
      const b = basis([0.2, 1, -0.35], [1, 0, 0]);
      const c: P3 = [0, 9.0, 2.3];
      return {
        curl: [
          [deg(70), deg(102), deg(48)],
          [deg(74), deg(104), deg(48)],
          [deg(76), deg(104), deg(48)],
          [deg(78), deg(102), deg(46)],
        ],
        thumb: [
          [3.1, 1.9, 0.5],
          [3.9, 5.2, 2.7],
          [2.5, 7.6, 4.1],
          [0.7, 8.6, 4.4],
        ],
        ax: b.x,
        ay: b.y,
        az: b.z,
        t: scale(add(add(scale(b.x, c[0]), scale(b.y, c[1])), scale(b.z, c[2])), -1),
      };
    }
    case 'fist':
    default: {
      // poing fermé : jointures vers −Z, dos de la main vers +Y, pouce replié devant
      const b = basis([0, 0.02, -1], [0, -1, 0]);
      return {
        curl: [
          [deg(88), deg(112), deg(74)],
          [deg(90), deg(114), deg(74)],
          [deg(92), deg(114), deg(74)],
          [deg(94), deg(112), deg(72)],
        ],
        thumb: [
          [3.1, 1.9, 0.5],
          [3.9, 5.4, 2.8],
          [2.4, 7.6, 4.4],
          [0.2, 8.1, 4.7],
        ],
        ax: b.x,
        ay: b.y,
        az: b.z,
        t: [0, 1.7, 6.5],
      };
    }
  }
}

/** Points des phalanges d'un doigt (repère A) pour des flexions données. */
function fingerChain(f: FingerDef, curl: [number, number, number]): P3[] {
  const pts: P3[] = [f.base];
  let phi = 0;
  let p = f.base;
  for (let k = 0; k < 3; k++) {
    phi += curl[k];
    const d: P3 = [Math.sin(f.spread) * Math.cos(phi), Math.cos(f.spread) * Math.cos(phi), Math.sin(phi)];
    p = add(p, scale(d, f.len[k]));
    pts.push(p);
  }
  return pts;
}

/** Distance d'un point au segment [a, b] et paramètre t. */
function segT(p: P3, a: P3, b: P3): [number, number] {
  const ab = sub(b, a);
  const l2 = Math.max(1e-9, dot(ab, ab));
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const q = add(a, scale(ab, t));
  return [Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), t];
}

interface HandPalette {
  skin: number;
  dark: number;
  light: number;
  nail: number;
  palm: number;
  seam: number;
  ring: number;
}

function handPalette(look: ArmLook): HandPalette {
  const b = look.hand;
  if (look.glove)
    return { skin: b, dark: shade(b, 0.72), light: mix(b, 0x9a8a78, 0.28), nail: mix(b, 0x9a8a78, 0.16), palm: shade(b, 0.85), seam: mix(b, 0xb8a888, 0.35), ring: look.accent };
  return { skin: b, dark: shade(b, 0.8), light: mix(b, 0xfff0e2, 0.22), nail: mix(b, 0xf8dcd4, 0.55), palm: mix(shade(b, 0.95), 0xd88878, 0.1), seam: shade(b, 0.86), ring: look.accent };
}

/**
 * Main droite voxelisée (1/128 m) dans le repère de la prise ; renvoie le modèle et le poignet
 * (m). rings : bagues d'or (annulaire, auriculaire, chevalière).
 */
function buildHand(pose: HandPose, look: ArmLook): { m: VoxelModel; wrist: Vec3 } {
  const P = poseDef(pose);
  const pal = handPalette(look);
  const chains = FINGERS.map((f, i) => fingerChain(f, P.curl[i]));
  // A → prise : g = t + x·ax + y·ay + z·az ; inverse par produits scalaires (base orthonormée)
  const toA = (g: P3): P3 => {
    const d = sub(g, P.t);
    return [dot(d, P.ax), dot(d, P.ay), dot(d, P.az)];
  };
  const toG = (a: P3): P3 => add(P.t, add(add(scale(P.ax, a[0]), scale(P.ay, a[1])), scale(P.az, a[2])));
  // boîte englobante dans le repère de la prise
  let lo: P3 = [Infinity, Infinity, Infinity];
  let hi: P3 = [-Infinity, -Infinity, -Infinity];
  const grow = (a: P3) => {
    const g = toG(a);
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], g[k] - 1.6);
      hi[k] = Math.max(hi[k], g[k] + 1.6);
    }
  };
  for (const x of [-4.5, 4.5]) for (const y of [-2.5, 9.6]) for (const z of [-1.8, 1.6]) grow([x, y, z]);
  for (const c of chains) for (const p of c) grow(p);
  for (const p of P.thumb) grow(p);
  const vox = HAND_RES * 100; // cm par voxel
  const nx = Math.ceil((hi[0] - lo[0]) / vox);
  const ny = Math.ceil((hi[1] - lo[1]) / vox);
  const nz = Math.ceil((hi[2] - lo[2]) / vox);
  const m = new VoxelModel(nx, ny, nz, HAND_RES);
  m.setOrigin(-lo[0] / vox, -lo[1] / vox, -lo[2] / vox);
  const ringsOn = look.accent !== undefined && !look.glove && look.boss === 'dadou';
  for (let j = 0; j < ny; j++)
    for (let k = 0; k < nz; k++)
      for (let i = 0; i < nx; i++) {
        const g: P3 = [lo[0] + (i + 0.5) * vox, lo[1] + (j + 0.5) * vox, lo[2] + (k + 0.5) * vox];
        const a = toA(g);
        let c = -1;
        // poignet (ellipse) et paume (boîte arrondie qui s'élargit vers les jointures)
        if (a[1] > -2.6 && a[1] < 1.2) {
          if ((a[0] / 2.9) ** 2 + ((a[2] + 0.1) / 1.55) ** 2 <= 1) c = pal.skin;
        }
        if (c < 0 && a[1] >= 0.4 && a[1] <= 9.5) {
          const w = 3.4 + Math.min(1, (a[1] - 0.4) / 4) * 0.85;
          const top = a[1] > 8.6 ? 9.5 - (a[1] - 8.6) * 0.0 : 9.5;
          const r = 0.9;
          const qx = Math.max(Math.abs(a[0] + 0.1) - (w - r), 0);
          const qz = Math.max(Math.abs(a[2] + 0.15) - (1.35 - r), 0);
          if (qx * qx + qz * qz <= r * r && a[1] <= top) c = a[2] > 0.9 ? pal.palm : pal.skin;
        }
        // éminence du pouce
        if (c < 0 && ((a[0] - 2.5) / 1.9) ** 2 + ((a[1] - 3.6) / 2.7) ** 2 + ((a[2] - 0.6) / 1.35) ** 2 <= 1) c = pal.palm;
        // doigts
        if (c < 0) {
          for (let f = 0; f < 4 && c < 0; f++) {
            const ch = chains[f];
            const fd = FINGERS[f];
            for (let s = 0; s < 3; s++) {
              const [d, t] = segT(a, ch[s], ch[s + 1]);
              const rr = fd.rad[s] * (1 - 0.08 * t);
              if (d <= rr) {
                c = pal.skin;
                // ongle (dos de la dernière phalange), plis des articulations, bagues
                if (s === 2 && t > 0.45) {
                  const dir = norm(sub(ch[3], ch[2]));
                  const back = sub(a, add(ch[2], scale(sub(ch[3], ch[2]), t)));
                  // côté dorsal : −Z de la phalange (perpendiculaire à l'axe, vers le dos)
                  const dorsal = sub(cross([1, 0, 0], dir), [0, 0, 0]);
                  if (dot(back, dorsal) < -0.35 * rr && !look.glove) c = pal.nail;
                  void dorsal;
                }
                if (t < 0.12 && s > 0) c = pal.dark;
                if (ringsOn && s === 0 && (f === 2 || f === 3) && t > 0.35 && t < 0.55) c = pal.ring;
                break;
              }
            }
          }
        }
        // pouce
        if (c < 0) {
          const th = P.thumb;
          for (let s = 0; s < th.length - 1 && c < 0; s++) {
            const [d, t] = segT(a, th[s], th[s + 1]);
            const rr = (s === 0 ? 1.35 : s === 1 ? 1.12 : 1.02) * (1 - 0.06 * t);
            if (d <= rr) c = s === 2 && t > 0.6 && !look.glove ? pal.light : pal.skin;
          }
        }
        if (c >= 0) m.set(i, j, k, c);
      }
  // relief : jointures éclairées sur le dos de la main, dessous ombré ; chevalière ; coutures du gant
  m.forEach((x, y, z, c) => {
    if (c !== pal.skin) return;
    const g: P3 = [lo[0] + (x + 0.5) * vox, lo[1] + (y + 0.5) * vox, lo[2] + (z + 0.5) * vox];
    const a = toA(g);
    if (a[2] < -1.0 && a[1] > 8.2 && a[1] < 9.8) return look.glove ? pal.light : pal.light;
    if (look.glove && a[2] < -1.1 && Math.abs(a[1] - 5.5) < 3 && (Math.abs(a[0] - 1.9) < 0.35 || Math.abs(a[0]) < 0.35 || Math.abs(a[0] + 1.9) < 0.35)) return pal.seam;
    if (look.glove && a[1] < 0.6 && a[1] > -0.4) return pal.dark;
    if (ringsOn && a[2] < -0.9 && a[1] > 9.6 && a[1] < 10.6 && a[0] < -1.7 && a[0] > -3.6) return pal.ring;
    return;
  });
  const wristA: P3 = [0, -2.4, -0.1];
  const w = toG(wristA);
  return { m, wrist: [w[0] / 100, w[1] / 100, w[2] / 100] };
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

/**
 * Avant-bras droit (1/128 m) : poignet, poignet de chemise et bouton de manchette, manche du
 * manteau avec son revers (Dadou : cramoisi liseré d'un fil de néon ; Even : bleu, trois
 * boutons d'argent), plis du drap. Origine au poignet, la manche s'étend selon +Z vers le
 * coude ; côté extérieur du bras en +X, dessus en +Y.
 */
function forearmModel(look: ArmLook): VoxelModel {
  const len = Math.round(FOREARM_LENGTH / HAND_RES);
  const m = new VoxelModel(17, 17, len + 2, HAND_RES);
  m.setOrigin(8.5, 8.5, 1);
  const sl = look.sleeve;
  const slHi = mix(sl, 0xa4a4b0, look.boss === 'dadou' ? 0.14 : 0.1);
  const slDk = shade(sl, 0.7);
  const cuff = look.cuff;
  const hand = look.hand;
  for (let z = 0; z < m.sz; z++) {
    const zz = z - 1 + 0.5; // voxels depuis le poignet
    for (let y = 0; y < m.sy; y++)
      for (let x = 0; x < m.sx; x++) {
        const px = x + 0.5 - 8.5;
        const py = y + 0.5 - 8.5;
        // sections (demi-axes en voxels) : poignet, manchette, manche qui s'évase vers le coude
        let c = -1;
        if (zz < 3) {
          if ((px / 3.6) ** 2 + (py / 3.0) ** 2 <= 1) c = look.glove ? shade(hand, 0.85) : hand;
        } else if (zz < 7.5) {
          if ((px / 4.6) ** 2 + (py / 4.3) ** 2 <= 1) c = Math.abs(py + 4) < 0.6 ? shade(cuff, 0.86) : cuff;
          // bouton de manchette sur le côté extérieur
          if (c >= 0 && px > 3.4 && Math.abs(py) < 1.2 && zz > 4.5 && zz < 6.5) c = look.accent;
        } else {
          const k = Math.min(1, (zz - 7.5) / 30);
          const ax = 6.2 + k * 1.6;
          const ay = 5.9 + k * 1.4;
          const sq = Math.abs(px / ax) ** 2.6 + Math.abs(py / ay) ** 2.6;
          if (sq <= 1) {
            c = sl;
            // revers
            if (zz < 13.5) {
              c = look.trim;
              if (look.boss === 'dadou' && zz > 12.2) c = SLOT.NEON_RED;
            } else {
              // lustre dessus, ombre dessous, plis au creux du coude
              if (py > ay * 0.55) c = slHi;
              else if (py < -ay * 0.55) c = slDk;
              const fold = (zz - 20) % 7;
              if (zz > 20 && fold >= 0 && fold < 1 && py < ay * 0.3) c = slDk;
            }
          }
          // boutons d'argent d'Even le long du côté extérieur
          if (c >= 0 && look.boss === 'even' && px > ax - 1.2 && Math.abs(py) < 1 && [16, 19.5, 23].some((b) => Math.abs(zz - b) < 0.8)) c = look.accent;
        }
        if (c >= 0) m.set(x, y, z, c);
      }
  }
  return m;
}

/** Construit la main (pose donnée) et l'avant-bras d'un côté. */
export function armModels(side: 'R' | 'L', pose: HandPose, look: ArmLook): ArmModels {
  const h = buildHand(pose, look);
  let hand = h.m;
  let wrist = h.wrist;
  let fore = forearmModel(look);
  // la main d'appui est dessinée gauche ; les autres sont dessinées droites
  const drawnLeft = pose === 'support';
  if (drawnLeft) {
    hand = mirrorModelX(hand);
    wrist = mirrorV(wrist);
  }
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
export function armLookFor(boss: 'dadou' | 'even', outfit: { skin: number; coat: number; coat2: number; shirt: number; accent: number; vest: number; dress?: number }): ArmLook {
  if (boss === 'even') {
    return {
      boss,
      hand: 0x2a2522,
      glove: true,
      sleeve: cloth(outfit.coat),
      trim: cloth(outfit.coat2),
      cuff: mix(outfit.shirt, outfit.vest, 0.15),
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
