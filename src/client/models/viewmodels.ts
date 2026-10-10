// Modèles détaillés de la vue subjective (1/64 m) : armes de 1888, mains et avant-bras des
// deux parrains.
//
// Repère commun à tous les modèles : −Z vers l'avant (vers la cible), +Y en haut, +X à
// droite ; l'origine est le point de prise de la main droite (le centre du poing autour de
// la poignée). Les métadonnées exportées (bouche du canon, point d'appui de la main gauche,
// ligne de mire, charnières) sont en mètres dans ce même repère.
//
// Les pièces mobiles (canon basculant du Webley, canons du fusil, levier du Martini-Henry)
// sont des modèles séparés dont l'origine est le pivot ; la crosse du revolver et les mains
// ont leur propre repère « main » (axe de la poignée selon +Y) incliné par `gripRot`.

import { VoxelModel, mix, shade } from './voxelModel';

export const VM_RES = 1 / 64;
const R = VM_RES;

export type Vec3 = [number, number, number];

// ------------------------------------------------------------------ palette

/** Acier bleui : base, faces éclairées, arêtes polies, ombres. */
const BLUE = 0x2e333d;
const BLUE_HI = 0x4d586b;
const BLUE_EDGE = 0x8a99ae;
const BLUE_DK = 0x1b1e25;
/** Barillet (acier poli plus clair, reflets) et cannelures. */
const CYL = 0x4b5466;
const CYL_HI = 0x66728a;
const CYL_DK = 0x232730;
const BORE = 0x0b0c0f;
/** Acier jaspé (trempé en paquet) des platines du fusil. */
const CASE = [0x4a4c55, 0x5d5446, 0x3a4152, 0x6e6450, 0x2f323a];
/** Noyer. */
const WALNUT = 0x5a3820;
const WALNUT_LT = 0x6b4428;
const WALNUT_DK = 0x4a2d19;
const GRAIN = 0x3e2414;
/** Laiton. */
const BRASS = 0xc9a24a;
const BRASS_DK = 0x9c7a32;
const BRASS_HI = 0xe6c66e;
/** Lame d'acier poli. */
const BLADE = 0xa9afb8;
const BLADE_HI = 0xd3d9e0;
const BLADE_DK = 0x8c929b;
const EDGE = 0xeef2f6;
/** Palissandre (manche du couteau). */
const ROSEWOOD = 0x5b3322;
const ROSEWOOD_DK = 0x43241a;
/** Bois laqué de la matraque, cuir. */
const LACQUER = 0x3b2417;
const LACQUER_HI = 0x5a3a25;
const LEATHER = 0x2c1d14;
const LEATHER_HI = 0x46301f;
const BUTTPLATE = 0x24201c;

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

  /** Place l'origine du modèle (le pivot) en un point local continu. */
  pivot(x: number, y: number, z: number): this {
    this.m.setOrigin(this.bx + x + 0.5, this.by + y + 0.5, this.bz + z + 0.5);
    return this;
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

/** Hachage entier déterministe (motifs du jaspage, du grain). */
function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Veinage du noyer de crosse : bandes larges qui suivent la chute de la crosse. */
function woodGrain(y: number, z: number, slope: number): number {
  const v = y + Math.max(0, z - 6) * slope;
  const k = ((Math.floor(v * 0.5 + 0.25) % 3) + 3) % 3;
  const line = Math.abs(v - Math.round(v / 3) * 3) < 0.5 && z > 8;
  return line ? WALNUT_DK : k === 0 ? WALNUT : k === 1 ? WALNUT_LT : WALNUT;
}

// ------------------------------------------------------------------ métadonnées

export interface VmWeaponMeta {
  /** Bouche du canon (m) ; pointe de la lame ou bout de la matraque pour les armes blanches. Fusil : canon droit (premier coup). */
  muzzle: Vec3;
  /** Bouche du second canon (fusil juxtaposé, canon gauche). */
  muzzle2?: Vec3;
  /** Point d'appui de la main gauche (m), ou null pour une arme tenue à une main. */
  support: Vec3 | null;
  /** Orientation de la main gauche au point d'appui (Euler XYZ, rad). */
  supportRot: Vec3;
  /** Orientation du repère « main droite » par rapport à l'arme (Euler XYZ, rad). */
  gripRot: Vec3;
  /** Hauteur de la ligne de mire au-dessus de l'origine (m) ; elle est parallèle à −Z en x = 0. */
  sightY: number;
  /** Profondeur (z, m) du cran de mire et du guidon (ou de la bille). */
  rearSightZ: number;
  frontSightZ: number;
  /** Pivot de la pièce mobile (charnière de bascule, axe du levier), m. */
  pivot?: Vec3;
  /** Longueur hors tout (m). */
  length: number;
}

// ================================================================== REVOLVER WEBLEY

/** Pièces du revolver Webley à brisure (modèle Mk VI, canon de 6 pouces, ~0,28 m). */
export interface RevolverModels {
  /** Carcasse, chien, verrou à étrier, pontet et détente (repère de l'arme). */
  frame: VoxelModel;
  /** Canon, bande supérieure, guidon et barillet : bascule autour de `REVOLVER.pivot`. */
  barrel: VoxelModel;
  /** Culots de cartouches et étoile d'extraction (visibles une fois le revolver ouvert), même pivot. */
  rims: VoxelModel;
  /** Crosse « bec d'oiseau » en noyer avec anneau de dragonne (repère main, voir gripRot). */
  grip: VoxelModel;
}

const REV_PIVOT: Vec3 = [0, 1.5 * R, -5 * R];

export const REVOLVER: VmWeaponMeta = {
  muzzle: [0, 4 * R, -14.5 * R],
  support: null,
  supportRot: [0, 0, 0],
  gripRot: [-0.32, 0, 0],
  sightY: 6.5 * R,
  rearSightZ: -1 * R,
  frontSightZ: -13 * R,
  pivot: REV_PIVOT,
  length: 18 * R,
};

export function revolverModels(): RevolverModels {
  // --- carcasse
  const f = new Grid(-2, 2, -2, 7, -6, 3);
  // fond de carcasse sous le barillet jusqu'au tenon de charnière
  f.fill(-1, 1, 1, 1, -5, 0, BLUE);
  f.set(0, 1, -5, BLUE_HI);
  // bouclier de culasse derrière le barillet
  f.fill(-1, 1, 2, 4, -1, 0, BLUE);
  f.paint(-1, 1, 4, 4, -1, 0, BLUE_HI);
  // étrier du verrou au-dessus de la bande supérieure, oreilles du cran de mire
  f.fill(-1, 1, 5, 6, -1, 0, BLUE);
  f.paint(-1, 1, 6, 6, -1, 0, BLUE_HI);
  f.set(-1, 7, -1, BLUE_HI).set(1, 7, -1, BLUE_HI);
  // levier du verrou côté gauche (sous le pouce)
  f.fill(-2, -2, 4, 5, -1, -1, BLUE_HI);
  f.set(-2, 3, 0, BLUE_HI);
  // talon de la carcasse sous le chien (attache de la crosse, caché par la palmure)
  f.fill(-1, 1, 1, 2, 1, 1, BLUE);
  // chien : corps, crête quadrillée
  f.fill(0, 0, 3, 5, 1, 1, BLUE);
  f.set(0, 6, 1, BLUE_HI).set(0, 6, 2, BLUE_HI);
  // pontet et détente
  f.fill(0, 0, -1, 0, -5, -5, BLUE);
  f.fill(0, 0, -1, -1, -5, -1, BLUE);
  f.set(0, -1, -5, BLUE_HI);
  f.set(0, 0, -3, BLUE_EDGE);
  // vis de platine (côté gauche visible)
  f.set(-1, 2, 0, BLUE_EDGE);

  // --- ensemble basculant : canon, bande supérieure, barillet
  const b = new Grid(-1, 1, 2, 6, -14, -2);
  b.fill(0, 0, 4, 4, -14, -5, BLUE); // canon
  b.fill(0, 0, 5, 5, -14, -2, BLUE_HI); // bande ventilée / bande supérieure
  b.set(0, 5, -14, BLUE_EDGE);
  b.set(0, 4, -14, BLUE_DK); // bouche
  b.set(0, 6, -13, BLUE_EDGE); // guidon
  b.fill(0, 0, 3, 3, -7, -5, BLUE); // tenon d'éjecteur sous le canon
  b.set(0, 2, -5, BLUE_DK); // crochet de charnière
  // barillet (cannelé : les arêtes sombres suggèrent les cannelures)
  b.fill(-1, 1, 2, 4, -4, -2, CYL);
  // cannelures (arêtes du milieu, en creux) et reflets sur le haut du barillet
  for (const [x, y] of [
    [-1, 2],
    [1, 2],
    [-1, 4],
    [1, 4],
  ]) {
    b.set(x, y, -3, CYL_DK);
  }
  b.set(-1, 4, -4, CYL_HI).set(-1, 4, -2, CYL_HI).set(1, 4, -4, CYL_HI).set(1, 4, -2, CYL_HI);
  b.set(0, 2, -3, CYL_DK);
  b.pivot(0, 1.5, -5);

  // --- culots des cartouches + étoile d'extraction (derrière le barillet)
  const r = new Grid(-1, 1, 2, 4, -1, -1);
  r.fill(-1, 1, 2, 4, -1, -1, BRASS);
  r.fill(0, 0, 2, 4, -1, -1, BLUE_EDGE);
  r.set(-1, 3, -1, BRASS_HI).set(1, 3, -1, BRASS_DK);
  r.pivot(0, 1.5, -5);

  // --- crosse (repère main : axe de la poignée selon +Y, largeur paire centrée)
  const g = new Grid(-1, 0, -6, 2, -1, 3, [0, 0.5, 0.5]);
  g.fill(-1, 0, -3, 2, -1, 1, WALNUT);
  g.paint(-1, 0, -3, 2, -1, -1, WALNUT_LT);
  g.paint(-1, 0, -3, 2, 1, 1, WALNUT_DK);
  // bec d'oiseau : la crosse se recourbe vers l'arrière sous l'auriculaire, calotte d'acier
  g.fill(-1, 0, -4, -4, 0, 2, BLUE);
  g.set(-1, -4, 0, BLUE_HI).set(0, -4, 0, BLUE_HI);
  // anneau de dragonne (petit étrier pendant)
  g.set(-1, -5, 1, BLUE_EDGE).set(-1, -5, 2, BLUE_EDGE).set(-1, -6, 2, BLUE_HI);
  return { frame: f.m, barrel: b.m, rims: r.m, grip: g.m };
}

// ================================================================== FUSIL DE CHASSE

/** Fusil juxtaposé à chiens extérieurs (~1,05 m). */
export interface ShotgunModels {
  /** Bascule, platines jaspées, chiens, détentes, crosse anglaise (repère de l'arme). */
  body: VoxelModel;
  /** Canons juxtaposés, bande, bille de laiton et longuesse : basculent autour de `SHOTGUN.pivot`. */
  barrels: VoxelModel;
  /** Culots des deux cartouches (visibles canons ouverts), même pivot. */
  shells: VoxelModel;
}

export const SHOTGUN: VmWeaponMeta = {
  muzzle: [1 * R, 3 * R, -46.5 * R],
  muzzle2: [-1 * R, 3 * R, -46.5 * R],
  support: [0, 1 * R, -16 * R],
  supportRot: [0, 0, 0],
  gripRot: [0, 0, 0],
  sightY: 5.5 * R,
  rearSightZ: -3 * R,
  frontSightZ: -45 * R,
  pivot: [0, 1.5 * R, -9 * R],
  length: 68 * R,
};

/** Profil de la crosse anglaise : [bas, haut] (inclus) selon z. */
function stockProfile(z: number, combDrop: number[], toe: number): [number, number] {
  if (z <= 6) return [-1, 1];
  const t = (z - 6) / 14;
  const top = z < combDrop[0] ? 1 : z < combDrop[1] ? 0 : -1;
  return [Math.round(-1 - t * (toe - 1)), top];
}

export function shotgunModels(): ShotgunModels {
  // --- carcasse + crosse
  const s = new Grid(-1, 1, -8, 5, -10, 21);
  const caseCol = (x: number, y: number, z: number) => CASE[hash3(x + 7, y >> 1, (z + 20) >> 1) % CASE.length];
  // barre de bascule (sous les canons) et corps
  s.fill(-1, 1, -1, 1, -9, -1, CASE[0]);
  s.paint(-1, 1, -1, 1, -9, -1, (x, y, z) => (x === 0 ? CASE[3] : caseCol(x, y, z)));
  // tenon (articulation) arrondi à l'avant
  s.set(-1, -1, -9, -1).set(1, -1, -9, -1);
  // bouclier et épaulements (fences) derrière les canons
  s.fill(-1, 1, 2, 4, -2, -2, CASE[0]);
  s.paint(-1, 1, 2, 4, -2, -2, (x, y, z) => caseCol(x, y, z));
  s.set(-1, 4, -2, CASE[4]).set(1, 4, -2, CASE[4]);
  s.fill(-1, 1, 2, 2, -1, 0, CASE[1]);
  // platines (côtés) jaspées jusque dans la tête de crosse
  s.fill(-1, 1, -1, 1, -1, 2, WALNUT);
  s.paint(-1, -1, -1, 1, -1, 2, caseCol);
  s.paint(1, 1, -1, 1, -1, 2, caseCol);
  // queue de bascule sur le dessus du poignet
  s.fill(0, 0, 2, 2, 1, 3, BLUE_HI);
  // clé d'ouverture (top lever) entre les chiens
  s.fill(0, 0, 3, 3, 0, 1, BLUE_EDGE);
  // chiens extérieurs : nez sur la broche, corps, crête recourbée
  for (const x of [-1, 1]) {
    s.set(x, 3, -1, CASE[2]);
    s.set(x, 3, 0, CASE[0]);
    s.set(x, 4, 0, CASE[3]).set(x, 4, 1, BLUE_EDGE);
  }
  // pontet et deux détentes
  s.set(0, -2, -7, BLUE);
  s.fill(0, 0, -3, -3, -7, -2, BLUE);
  s.set(0, -3, -7, BLUE_HI).set(0, -3, -2, BLUE_HI);
  s.set(0, -2, -5, BLUE_EDGE); // détente avant (canon droit)
  s.set(0, -2, -3, BLUE_EDGE); // détente arrière (canon gauche)
  // crosse anglaise (poignet droit), busc, talon, plaque de couche en corne
  for (let z = 3; z <= 20; z++) {
    const [lo, hi] = stockProfile(z, [12, 18], 7);
    s.fill(-1, 1, lo, hi, z, z, WALNUT);
  }
  s.fill(-1, 1, -1, 1, 0, 3, WALNUT);
  // fil du noyer : veines obliques qui suivent la chute de la crosse
  s.paint(-1, 1, -8, 1, 0, 20, (x, y, z, old) => (old === WALNUT ? woodGrain(y, z, 0.3) : old));
  {
    const [lo, hi] = stockProfile(20, [12, 18], 7);
    s.fill(-1, 1, lo, hi, 21, 21, BUTTPLATE);
  }

  // --- canons + longuesse (pivot sur la broche de charnière)
  const b = new Grid(-1, 1, 0, 5, -47, -3);
  // canons juxtaposés : damas discret (torsades) le long des tubes
  for (let z = -46; z <= -3; z++) {
    for (const x of [-1, 1]) {
      const tw = ((z + (x > 0 ? 1 : 0)) >> 1) & 1;
      b.set(x, 3, z, tw ? BLUE : 0x353b47);
    }
  }
  b.fill(0, 0, 3, 3, -46, -3, BLUE_DK); // gouttière entre les tubes
  b.fill(0, 0, 4, 4, -46, -3, BLUE_HI); // bande supérieure
  b.paint(0, 0, 4, 4, -46, -3, (x, y, z) => (z % 6 === 0 ? BLUE_EDGE : BLUE_HI));
  b.fill(0, 0, 2, 2, -46, -10, BLUE_DK); // bande inférieure
  b.set(0, 5, -45, BRASS); // bille de laiton
  b.set(-1, 3, -46, BLUE_EDGE).set(1, 3, -46, BLUE_EDGE);
  b.set(0, 3, -46, BORE);
  // crochets (lumps) sous la culasse
  b.fill(-1, 1, 2, 2, -9, -3, BLUE);
  b.fill(0, 0, 1, 1, -9, -6, BLUE_DK);
  // longuesse (splinter) en noyer clair, ferrure à l'avant
  b.fill(-1, 1, 0, 2, -21, -10, WALNUT_LT);
  b.fill(-1, 1, 0, 0, -21, -19, -1);
  b.fill(-1, -1, 1, 1, -21, -21, -1).fill(1, 1, 1, 1, -21, -21, -1);
  b.paint(-1, 1, 0, 2, -21, -10, (x, y, z) => (y === 0 ? WALNUT : (z + 40) % 7 === 3 && y === 1 ? WALNUT : WALNUT_LT));
  b.fill(0, 0, 0, 0, -12, -10, BLUE_HI); // ferrure de verrouillage
  b.set(0, 1, -22, BLUE_EDGE); // poussoir Anson
  b.pivot(0, 1.5, -9);

  // --- culots des deux cartouches (canons ouverts)
  const sh = new Grid(-1, 1, 3, 3, -2, -2);
  sh.set(-1, 3, -2, BRASS).set(1, 3, -2, BRASS_HI);
  sh.set(0, 3, -2, BLUE_DK);
  sh.pivot(0, 1.5, -9);
  return { body: s.m, barrels: b.m, shells: sh.m };
}

// ================================================================== MARTINI-HENRY

/** Carabine Martini-Henry à bloc tombant (~1,28 m). */
export interface RifleModels {
  /** Boîte de culasse, canon, hausse à échelle, guidon, bois, grenadières, baguette (repère de l'arme). */
  body: VoxelModel;
  /** Levier-sous-garde (pontet + queue sous le poignet) : pivote autour de `RIFLE.pivot`. */
  lever: VoxelModel;
}

export const RIFLE: VmWeaponMeta = {
  muzzle: [0, 2 * R, -63.5 * R],
  support: [0, 1 * R, -26 * R],
  supportRot: [0, 0, 0],
  gripRot: [0, 0, 0],
  sightY: 4.5 * R,
  rearSightZ: -19 * R,
  frontSightZ: -62 * R,
  pivot: [0, -1.5 * R, -9 * R],
  length: 82 * R,
};

export function rifleModels(): RifleModels {
  const s = new Grid(-2, 2, -8, 5, -64, 18);
  // --- boîte de culasse
  s.fill(-1, 1, -1, 3, -11, -1, BLUE);
  s.set(-1, -1, -11, -1).set(1, -1, -11, -1).set(0, -1, -11, BLUE_DK);
  s.paint(-1, 1, 3, 3, -11, -1, BLUE_HI);
  // auge de chargement : le dessus du bloc apparaît entre les flasques
  s.fill(0, 0, 3, 3, -9, -3, -1);
  s.fill(0, 0, 2, 2, -9, -3, BLUE_DK);
  s.set(0, 2, -3, BLUE_EDGE); // poussoir du bloc
  // indicateur d'armement (côté droit)
  s.set(2, 1, -6, BLUE_EDGE).set(2, 2, -6, BLUE_EDGE);
  // détente
  s.set(0, -2, -5, BLUE_EDGE);
  // --- canon et renfort
  s.fill(0, 0, 2, 2, -63, -12, BLUE);
  s.fill(0, 0, 3, 3, -16, -12, BLUE_HI);
  s.set(0, 2, -63, BLUE_DK);
  // --- longuesse : le canon repose dans le bois
  s.fill(-1, 1, 0, 1, -51, -12, WALNUT_LT);
  s.fill(-1, -1, 2, 2, -51, -12, WALNUT_LT).fill(1, 1, 2, 2, -51, -12, WALNUT_LT);
  s.paint(-1, 1, 0, 2, -51, -12, (x, y, z) => (y === 0 ? WALNUT : (z + 80) % 9 === 4 && y === 1 ? WALNUT : WALNUT_LT));
  s.fill(-1, 1, 0, 0, -51, -48, -1);
  s.fill(0, 0, 0, 0, -51, -48, WALNUT_LT);
  // grenadières (deux anneaux de fer) et embouchoir
  for (const z of [-31, -44]) {
    s.fill(-1, 1, 0, 3, z, z, BLUE);
    s.set(0, 2, z, BLUE);
    s.paint(-1, 1, 3, 3, z, z, BLUE_HI);
  }
  s.fill(-1, 1, 1, 2, -53, -52, BLUE);
  s.set(0, 0, -52, BLUE);
  s.paint(-1, 1, 2, 2, -53, -52, BLUE_HI);
  s.set(0, 2, -52, BLUE).set(0, 2, -53, BLUE);
  // baguette sous le canon, au-delà de l'embouchoir
  s.fill(0, 0, 0, 0, -62, -53, BLUE_EDGE);
  s.set(0, 0, -62, BLUE_HI);
  // guidon (embase + lame), tenon de baïonnette
  s.fill(0, 0, 3, 3, -62, -60, BLUE);
  s.set(0, 4, -62, BLUE_EDGE);
  s.set(1, 2, -59, BLUE_HI);
  // hausse à échelle repliée : embase, charnière avec cran de combat, planche ajourée
  s.fill(-1, 1, 3, 3, -23, -19, BLUE);
  s.fill(-1, 1, 4, 4, -19, -19, BLUE_HI);
  s.set(-1, 5, -19, BLUE_EDGE).set(1, 5, -19, BLUE_EDGE);
  s.fill(-1, 1, 4, 4, -25, -20, BLUE_HI);
  s.fill(0, 0, 4, 4, -24, -21, -1);
  s.set(0, 4, -25, BLUE_EDGE);
  // --- crosse (poignet droit, busc, plaque de couche en acier)
  for (let z = 0; z <= 17; z++) {
    const [lo, hi] = z <= 5 ? [-1, 1] : stockProfile(z + 3, [12, 30], 7);
    s.fill(-1, 1, lo, hi, z, z, WALNUT);
  }
  s.paint(-1, 1, -8, 1, 0, 17, (x, y, z, old) => (old === WALNUT ? woodGrain(y, z + 3, 0.3) : old));
  {
    const [lo, hi] = stockProfile(20, [12, 30], 7);
    s.fill(-1, 1, lo, hi, 18, 18, BLUE);
    s.paint(-1, 1, hi, hi, 18, 18, BLUE_HI);
  }
  // queue de culasse sur le poignet
  s.fill(0, 0, 2, 2, 0, 1, BLUE_HI);

  // --- levier-sous-garde (pivot à l'avant de la boîte)
  const l = new Grid(0, 0, -3, -1, -10, 6);
  l.set(0, -2, -9, BLUE);
  l.fill(0, 0, -3, -3, -8, -4, BLUE);
  l.set(0, -3, -8, BLUE_HI);
  l.fill(0, 0, -2, -2, -3, 5, BLUE);
  l.paint(0, 0, -2, -2, -3, 5, (x, y, z) => (z === 5 ? BLUE_EDGE : BLUE));
  l.set(0, -1, 6, BLUE_EDGE);
  l.pivot(0, -1.5, -9);
  return { body: s.m, lever: l.m };
}

// ================================================================== COUTEAU BOWIE

export const KNIFE: VmWeaponMeta = {
  muzzle: [0, 0, -16.5 * R],
  support: null,
  supportRot: [0, 0, 0],
  gripRot: [0, 0, 0],
  sightY: 0,
  rearSightZ: 0,
  frontSightZ: 0,
  length: 21 * R,
};

/** Couteau Bowie de Sheffield : lame à contre-tranchant et gorge, garde de laiton, manche de palissandre riveté. */
export function knifeModel(): VoxelModel {
  // largeur 1, hauteur paire autour de l'origine (centre du manche entre les rangées -1 et 0)
  const g = new Grid(0, 0, -3, 2, -17, 5, [0.5, 0, 0.5]);
  // manche de palissandre veiné, rivets de laiton
  g.fill(0, 0, -1, 0, -3, 3, ROSEWOOD);
  g.paint(0, 0, -1, -1, -3, 3, ROSEWOOD_DK);
  g.set(0, 0, 2, BRASS).set(0, 0, -1, BRASS_DK);
  // pommeau et mitre de laiton
  g.fill(0, 0, -1, 0, 4, 4, BRASS);
  g.set(0, 0, 4, BRASS_HI);
  g.fill(0, 0, -1, 0, -3, -3, BRASS_DK);
  // garde en S
  g.fill(0, 0, -2, 1, -4, -4, BRASS);
  g.set(0, 1, -4, BRASS_HI).set(0, 2, -5, BRASS_HI).set(0, -2, -4, BRASS).set(0, -3, -3, BRASS_DK);
  // lame : talon non affûté, gorge (fuller), tranchant, contre-tranchant
  const prof: Record<number, [number, number]> = {};
  for (let z = -5; z >= -12; z--) prof[z] = [-1, 1];
  prof[-13] = [-1, 1];
  prof[-14] = [-1, 0];
  prof[-15] = [-1, 0];
  prof[-16] = [0, 0];
  for (const zs of Object.keys(prof)) {
    const z = Number(zs);
    const [lo, hi] = prof[z];
    for (let y = lo; y <= hi; y++) {
      let c = BLADE;
      if (y === 1) c = z <= -12 ? EDGE : BLADE_HI; // dos (contre-tranchant poli au bout)
      if (y === 0) c = z <= -7 && z >= -11 ? BLADE_DK : BLADE; // gorge
      if (y === -1) c = z <= -7 ? EDGE : BLADE; // tranchant (le talon reste brut)
      if (z >= -6) c = y === 1 ? BLADE : BLADE_DK; // talon
      g.set(0, y, z, c);
    }
  }
  g.set(0, 0, -16, EDGE);
  return g.m;
}

// ================================================================== MATRAQUE

export const CLUB: VmWeaponMeta = {
  muzzle: [0, 0, -22.5 * R],
  support: null,
  supportRot: [0, 0, 0],
  gripRot: [0, 0, 0],
  sightY: 0,
  rearSightZ: 0,
  frontSightZ: 0,
  length: 28 * R,
};

/** Matraque de constable en bois tourné laqué, couronne peinte, dragonne de cuir. */
export function clubModel(): VoxelModel {
  const g = new Grid(-1, 1, -5, 1, -23, 6);
  const round = (z: number, c: number) => {
    g.fill(-1, 1, 0, 0, z, z, c);
    g.fill(0, 0, -1, 1, z, z, c);
  };
  // poignée gainée de cuir (fine là où le poing la serre) et pommeau tourné
  for (let z = -3; z <= 3; z++) {
    if (z >= -2 && z <= 1) g.set(0, 0, z, LEATHER);
    else round(z, (z & 1) === 0 ? LEATHER : LEATHER_HI);
  }
  g.fill(-1, 1, -1, 1, 4, 5, LACQUER);
  g.paint(-1, 1, 1, 1, 4, 5, LACQUER_HI);
  g.set(0, 0, 6, LACQUER_HI);
  // fût : section ronde, renflé vers le bout, bout arrondi
  for (let z = -22; z <= -4; z++) round(z, LACQUER);
  for (let z = -20; z <= -15; z++) {
    g.set(-1, 1, z, LACQUER).set(1, 1, z, LACQUER).set(-1, -1, z, LACQUER).set(1, -1, z, LACQUER);
  }
  g.paint(-1, 1, 1, 1, -22, -4, LACQUER_HI);
  g.set(0, 0, -23, LACQUER_HI);
  // gorge tournée au-dessus de la poignée
  round(-4, 0x2a190f);
  // bande peinte : fond bleu nuit, filets dorés, couronne sur le flanc
  for (let z = -11; z <= -8; z++) round(z, 0x1a2238);
  round(-12, BRASS_DK);
  round(-7, BRASS_DK);
  g.set(-1, 0, -10, BRASS).set(-1, 0, -9, BRASS_HI).set(1, 0, -10, BRASS).set(1, 0, -9, BRASS_HI);
  // dragonne de cuir pendant du pommeau
  g.fill(0, 0, -3, -2, 5, 5, LEATHER);
  g.fill(0, 0, -4, -4, 4, 5, LEATHER_HI);
  g.set(0, -3, 3, LEATHER).set(0, -2, 3, LEATHER);
  g.set(0, -5, 4, LEATHER_HI);
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
  L(-1, ['.....', 'naah.', 'n..ah', '...ak', 's..as', '.ssaa', '.sss.']); // annulaire
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
  L(1, ['.....', '.hhhg', '.ssss', '.skss', '.ssss', '..ss.', '..ss.', '.....']);
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
  // manchette de chemise empesée (Even : manchette gris perle sous le bleu marine)
  const cuff = look.cuff;
  ring(1, 2, cuff);
  g.paint(-2, 1, -2, -2, 1, 1, shade(cuff, 0.86));
  // bouton de manchette (or pour Dadou, argent pour Even)
  g.set(1, 0, 1, look.accent);
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
  // parement : bord de la manche (passepoil cramoisi de Dadou, revers bleu clair d'Even)
  const trim = look.trim;
  g.paint(-3, 2, -3, 2, 2, 2, trim);
  if (look.boss === 'even') {
    g.paint(-3, 2, -3, 2, 3, 4, trim);
    // trois boutons d'argent sur le côté extérieur
    for (const z of [5, 7, 9]) g.set(2, 0, z, look.accent);
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

// ================================================================== DOUILLES

/** Douille éjectée : laiton (revolver, carabine) ou cartouche de papier rouge à culot de laiton (fusil). */
export function casingModel(kind: 'pistol' | 'rifle' | 'shell'): VoxelModel {
  if (kind === 'shell') {
    const g = new Grid(0, 0, 0, 0, -2, 0);
    g.set(0, 0, 0, BRASS).set(0, 0, -1, 0x9a2a22).set(0, 0, -2, 0xb0362c);
    return g.m;
  }
  const g = new Grid(0, 0, 0, 0, kind === 'rifle' ? -2 : -1, 0);
  g.set(0, 0, 0, BRASS_HI).set(0, 0, -1, BRASS);
  if (kind === 'rifle') g.set(0, 0, -2, BRASS_DK);
  return g.m;
}
