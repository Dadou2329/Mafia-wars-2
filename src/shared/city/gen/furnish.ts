// Ameublement des pièces selon leur fonction. Tout est en coordonnées locales (voxels).

import { M } from '../../materials';
import { Rng } from '../../util';
import { PROP_DEFS, type PropKind } from '../props';
import type { Frame } from './frame';
import { fireplace, type Room } from './interior';
import type { Levels } from './shell';

const HALF_PI = Math.PI / 2;
/** Orientation locale pour un objet adossé à un mur et tourné vers la pièce. */
export const FACE = { fromLeft: HALF_PI, fromRight: -HALF_PI, fromBack: Math.PI, fromFront: 0 };

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface BossInfo {
  boss: 'dadou' | 'even' | null;
}

export class Furnisher {
  readonly f: Frame;
  readonly lv: Levels;
  readonly rng: Rng;
  readonly reserved: Rect[] = [];
  /** Points d'intérêt relevés pendant l'ameublement (desk, recrutement…). */
  readonly marks: Record<string, { lx: number; lz: number; yaw?: number }> = {};
  boss: 'dadou' | 'even' | null = null;

  constructor(f: Frame, lv: Levels, rng: Rng) {
    this.f = f;
    this.lv = lv;
    this.rng = rng;
  }

  reserve(x0: number, z0: number, x1: number, z1: number): void {
    this.reserved.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) });
  }

  /** Taille au sol d'un accessoire en voxels (w le long de x local, d le long de z) selon l'orientation. */
  footprint(kind: PropKind, yaw: number): [number, number] {
    const s = PROP_DEFS[kind].size;
    const q = Math.round(yaw / HALF_PI) & 1;
    const w = (q ? s[2] : s[0]) * 4;
    const d = (q ? s[0] : s[2]) * 4;
    return [w, d];
  }

  isFree(kind: PropKind, lx: number, lz: number, yaw: number): boolean {
    const [w, d] = this.footprint(kind, yaw);
    const x0 = lx - w / 2;
    const x1 = lx + w / 2;
    const z0 = lz - d / 2;
    const z1 = lz + d / 2;
    for (const r of this.reserved) {
      if (x0 < r.x1 && x1 > r.x0 && z0 < r.z1 && z1 > r.z0) return false;
    }
    if (PROP_DEFS[kind].collide === 'none') return true;
    const y = this.lv.floorTop;
    for (let x = Math.floor(x0 + 0.3); x < Math.ceil(x1 - 0.3); x++) {
      for (let z = Math.floor(z0 + 0.3); z < Math.ceil(z1 - 0.3); z++) {
        if (this.f.get(x, y, z) !== 0 || this.f.get(x, y + 2, z) !== 0) return false;
      }
    }
    return true;
  }

  /** Pose un accessoire au sol s'il y a la place. */
  p(kind: PropKind, lx: number, lz: number, yaw = 0, variant = 0, force = false, ly?: number): boolean {
    if (!force && !this.isFree(kind, lx, lz, yaw)) return false;
    this.f.prop(kind, lx, ly ?? this.lv.floorTop, lz, yaw, variant);
    return true;
  }

  /** Objet fixé à une hauteur (voxels au-dessus du sol) contre un mur de la pièce. */
  wall(r: Room, kind: PropKind, wall: 'left' | 'right' | 'back' | 'front', along: number, height: number, variant = 0): void {
    const d = PROP_DEFS[kind].size[2] * 2; // demi-profondeur en voxels
    const y = this.lv.floorTop + height;
    switch (wall) {
      case 'left':
        this.f.prop(kind, r.x0 + d, y, along, FACE.fromLeft, variant);
        break;
      case 'right':
        this.f.prop(kind, r.x1 - d, y, along, FACE.fromRight, variant);
        break;
      case 'back':
        this.f.prop(kind, along, y, r.z1 - d, FACE.fromBack, variant);
        break;
      case 'front':
        this.f.prop(kind, along, y, r.z0 + d, FACE.fromFront, variant);
        break;
    }
  }

  /** Objet posé au sol, adossé à un mur. */
  againstWall(r: Room, kind: PropKind, wall: 'left' | 'right' | 'back' | 'front', along: number, variant = 0): boolean {
    const s = PROP_DEFS[kind].size;
    const d = s[2] * 2 + 0.05;
    switch (wall) {
      case 'left':
        return this.p(kind, r.x0 + d, along, FACE.fromLeft, variant);
      case 'right':
        return this.p(kind, r.x1 - d, along, FACE.fromRight, variant);
      case 'back':
        return this.p(kind, along, r.z1 - d, FACE.fromBack, variant);
      case 'front':
        return this.p(kind, along, r.z0 + d, FACE.fromFront, variant);
    }
  }

  /** Remplit un mur d'objets identiques espacés régulièrement. */
  lineWall(r: Room, kind: PropKind, wall: 'left' | 'right' | 'back' | 'front', spacing: number, margin = 2, variantFn?: (i: number) => number): number {
    const s = PROP_DEFS[kind].size;
    const len = wall === 'left' || wall === 'right' ? r.z1 - r.z0 : r.x1 - r.x0;
    const start = wall === 'left' || wall === 'right' ? r.z0 : r.x0;
    const w = s[0] * 4;
    let placed = 0;
    for (let a = margin + w / 2; a <= len - margin - w / 2 + 0.01; a += spacing) {
      if (this.againstWall(r, kind, wall, start + a, variantFn ? variantFn(placed) : this.rng.int(0, 3))) placed++;
    }
    return placed;
  }

  /** Table entourée de chaises. */
  tableSet(table: PropKind, lx: number, lz: number, chairs: number, chair: PropKind = 'CHAIR', yaw = 0): boolean {
    if (!this.p(table, lx, lz, yaw)) return false;
    const [w, d] = this.footprint(table, yaw);
    const pos: [number, number, number][] = [];
    // chaises tournées vers la table
    pos.push([lx, lz - d / 2 - 1.2, 0]);
    pos.push([lx, lz + d / 2 + 1.2, Math.PI]);
    pos.push([lx - w / 2 - 1.2, lz, HALF_PI]);
    pos.push([lx + w / 2 + 1.2, lz, -HALF_PI]);
    if (chairs > 4 && w >= 8) {
      pos.push([lx - w / 4, lz - d / 2 - 1.2, 0], [lx + w / 4, lz - d / 2 - 1.2, 0]);
      pos.push([lx - w / 4, lz + d / 2 + 1.2, Math.PI], [lx + w / 4, lz + d / 2 + 1.2, Math.PI]);
    }
    let n = 0;
    for (const [x, z, a] of pos) {
      if (n >= chairs) break;
      if (this.p(chair, x, z, a + this.rng.range(-0.25, 0.25))) n++;
    }
    return true;
  }

  /** Grille d'éléments dans une zone, en sautant les cases occupées. */
  grid(
    area: Rect,
    stepX: number,
    stepZ: number,
    place: (lx: number, lz: number, i: number, j: number) => void,
  ): void {
    const nx = Math.max(1, Math.floor((area.x1 - area.x0) / stepX));
    const nz = Math.max(1, Math.floor((area.z1 - area.z0) / stepZ));
    const ox = area.x0 + (area.x1 - area.x0 - (nx - 1) * stepX) / 2;
    const oz = area.z0 + (area.z1 - area.z0 - (nz - 1) * stepZ) / 2;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) place(ox + i * stepX, oz + j * stepZ, i, j);
  }

  /** Éclairage au plafond. */
  ceilingLight(kind: 'CHANDELIER' | 'HANGING_LAMP', lx: number, lz: number): void {
    const h = PROP_DEFS[kind].size[1] * 4;
    this.f.prop(kind, lx, this.lv.ceil - h, lz, 0, 0);
  }

  /** Lumières d'une pièce : lustres/suspensions répartis + appliques. */
  roomLights(r: Room, kind: 'CHANDELIER' | 'HANGING_LAMP', sconces: boolean, spacing = 22): void {
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    const nx = Math.max(1, Math.round(w / spacing));
    const nz = Math.max(1, Math.round(d / spacing));
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) this.ceilingLight(kind, r.x0 + ((i + 0.5) * w) / nx, r.z0 + ((j + 0.5) * d) / nz);
    if (sconces) {
      const y = 8;
      if (d > 14) {
        this.wall(r, 'WALL_SCONCE', 'left', r.z0 + d / 2, y);
        this.wall(r, 'WALL_SCONCE', 'right', r.z0 + d / 2, y);
      }
      if (w > 18) {
        this.wall(r, 'WALL_SCONCE', 'back', r.x0 + w * 0.25, y);
        this.wall(r, 'WALL_SCONCE', 'back', r.x0 + w * 0.75, y);
      }
    }
  }

  /** Quelques tableaux aux murs libres. */
  paintings(r: Room, n: number, kinds: PropKind[] = ['PAINTING', 'PORTRAIT']): void {
    const walls: ('left' | 'right' | 'back')[] = ['left', 'right', 'back'];
    for (let i = 0; i < n; i++) {
      const w = walls[i % walls.length];
      const len = w === 'back' ? r.x1 - r.x0 : r.z1 - r.z0;
      const start = w === 'back' ? r.x0 : r.z0;
      const along = start + len * (0.25 + 0.5 * ((i * 0.618) % 1));
      if (!this.wallClear(r, w, along)) continue;
      this.wall(r, this.rng.pick(kinds), w, along, 7, this.rng.int(0, 7));
    }
  }

  /** Vrai si le mur est dégagé (pas d'ouverture ni d'objet) à cet endroit, à hauteur de tableau. */
  wallClear(r: Room, wall: 'left' | 'right' | 'back' | 'front', along: number): boolean {
    const y = this.lv.floorTop + 8;
    for (let k = -3; k <= 3; k++) {
      const a = Math.floor(along + k);
      let x: number;
      let z: number;
      if (wall === 'left') [x, z] = [r.x0 - 1, a];
      else if (wall === 'right') [x, z] = [r.x1, a];
      else if (wall === 'back') [x, z] = [a, r.z1];
      else [x, z] = [a, r.z0 - 1];
      const m = this.f.get(x, y, z);
      if (m === 0 || m === M.GLASS || m === M.GLASS_LIT || m === M.GLASS_SHOP) return false;
      // l'espace devant le mur doit être libre
      let fx = x;
      let fz = z;
      if (wall === 'left') fx = x + 1;
      else if (wall === 'right') fx = x - 1;
      else if (wall === 'back') fz = z - 1;
      else fz = z + 1;
      if (this.f.get(fx, y, fz) !== 0) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------------------------
  // Éléments construits en voxels

  /** Comptoir (bar, boutique) le long de z (orient 'z') ou de x. */
  counter(x0: number, z0: number, x1: number, z1: number, wood: number, top: number, height = 4): void {
    const y = this.lv.floorTop;
    this.f.fill(x0, y, z0, x1, y + height - 1, z1, wood);
    this.f.fill(x0, y + height - 1, z0, x1, y + height, z1, top);
  }

  /** Étagères murales en voxels garnies de marchandises colorées. */
  shelves(x0: number, z0: number, x1: number, z1: number, height: number, goods: number[]): void {
    const y = this.lv.floorTop;
    this.f.fill(x0, y, z0, x1, y + height, z1, M.WALNUT);
    // creux des étagères remplis de marchandises
    const horizontal = x1 - x0 > z1 - z0;
    for (let ly = y + 1; ly < y + height - 1; ly += 3) {
      if (horizontal) {
        for (let lx = x0 + 1; lx < x1 - 1; lx++) {
          const g = goods[(lx * 7 + ly * 3) % goods.length];
          this.f.set(lx, ly, z0, this.rng.chance(0.85) ? g : 0);
          this.f.set(lx, ly + 1, z0, this.rng.chance(0.5) ? g : 0);
        }
      } else {
        for (let lz = z0 + 1; lz < z1 - 1; lz++) {
          const g = goods[(lz * 7 + ly * 3) % goods.length];
          this.f.set(x0, ly, lz, this.rng.chance(0.85) ? g : 0);
          this.f.set(x0, ly + 1, lz, this.rng.chance(0.5) ? g : 0);
        }
      }
    }
  }

  /** Tapis (remplace le sol sur une zone). */
  rug(x0: number, z0: number, x1: number, z1: number, mat: number): void {
    this.f.fill(Math.round(x0), this.lv.floorTop - 1, Math.round(z0), Math.round(x1), this.lv.floorTop, Math.round(z1), mat);
  }

  /** Cylindre vertical en voxels (cuves, chaudières, piliers). */
  cylinder(cx: number, cz: number, r: number, y0: number, y1: number, mat: number, shell = false): void {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
        const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
        if (d <= r && (!shell || d > r - 1.5)) this.f.fill(x, y0, z, x + 1, y1, z + 1, mat);
      }
    }
  }

  /** Colonne (pilier) carrée. */
  column(cx: number, cz: number, size: number, mat: number, cap: number): void {
    const y0 = this.lv.floorTop;
    const x0 = Math.round(cx - size / 2);
    const z0 = Math.round(cz - size / 2);
    this.f.fill(x0, y0, z0, x0 + size, this.lv.ceil, z0 + size, mat);
    this.f.fill(x0 - 1, this.lv.ceil - 1, z0 - 1, x0 + size + 1, this.lv.ceil, z0 + size + 1, cap);
    this.f.fill(x0 - 1, y0, z0 - 1, x0 + size + 1, y0 + 1, z0 + size + 1, cap);
  }

  fireplace(r: Room, wall: 'left' | 'right' | 'back' | 'front', mantel: number, at?: number): void {
    const pos = fireplace(this.f, this.lv, r, wall, mantel, at);
    // pare-feu et fauteuils
    const yaw = wall === 'left' ? FACE.fromLeft : wall === 'right' ? FACE.fromRight : wall === 'back' ? FACE.fromBack : 0;
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    this.p('FIRE_SCREEN', pos.lx + dx * 2.2, pos.lz + dz * 2.2, yaw, 0, true);
    this.reserve(pos.lx - 5 + dx * 2, pos.lz - 5 + dz * 2, pos.lx + 5 + dx * 2, pos.lz + 5 + dz * 2);
  }
}

// ======================================================================================
// Ameublement par type de pièce

const GOODS_HATS = [M.PAINT_BLACK, M.CLOTH_NAVY, M.SACK, M.PAINT_CREAM, M.PAINT_MAROON, M.FELT];
const GOODS_PAWN = [M.BRASS, M.SILVER, M.CRATE, M.BOOKS, M.PAINT_BLACK, M.GOLD, M.CLOTH_RED, M.COPPER];
const GOODS_BREAD = [M.HAY, M.PAINT_OCHRE, M.SACK, M.CRATE];
const GOODS_GROCER = [M.CRATE, M.SACK, M.PAINT_GREEN, M.PAINT_RED, M.BARREL, M.HAY];

export function furnishRoom(fu: Furnisher, r: Room, buildingType: string, variant: number): void {
  const rng = fu.rng;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  // passage devant l'accès de la pièce
  if (r.doorX !== undefined && r.doorZ !== undefined) {
    fu.reserve(r.doorX - 4, r.doorZ - 6, r.doorX + 4, r.doorZ + 6);
  }
  switch (r.kind) {
    case 'bar': {
      // comptoir le long du mur gauche
      const cx0 = r.x0 + 5;
      const cz0 = r.z0 + 4;
      const cz1 = r.z1 - 5;
      fu.counter(cx0, cz0, cx0 + 2, cz1, M.MAHOGANY, M.MAHOGANY, 4);
      fu.counter(r.x0, cz1 - 1, cx0 + 2, cz1 + 1, M.MAHOGANY, M.MAHOGANY, 4);
      fu.f.fill(r.x0 + 1, fu.lv.floorTop, cz1 - 1, r.x0 + 4, fu.lv.floorTop + 4, cz1 + 1, 0); // passage du barman
      fu.f.fill(cx0 + 2, fu.lv.floorTop, cz0, cx0 + 3, fu.lv.floorTop + 1, cz1, M.BRASS); // repose-pieds
      fu.reserve(r.x0, r.z0, cx0 + 3, r.z1);
      // étagères à bouteilles derrière le comptoir
      for (let z = cz0 + 4; z < cz1 - 4; z += 8) fu.f.prop('BOTTLE_SHELF', r.x0 + 0.8, fu.lv.floorTop, z, FACE.fromLeft, rng.int(0, 3));
      for (let z = cz0 + 3; z < cz1 - 2; z += 6) fu.f.prop('BEER_TAPS', cx0 + 1, fu.lv.floorTop + 4, z, FACE.fromLeft, 0);
      fu.marks.bar = { lx: cx0 + 4.5, lz: (cz0 + cz1) / 2 };
      fu.marks.barman = { lx: r.x0 + 2.5, lz: (cz0 + cz1) / 2, yaw: FACE.fromLeft };
      // tabourets devant le comptoir
      for (let z = cz0 + 2; z < cz1 - 1; z += 5) fu.p('STOOL', cx0 + 4, z, -HALF_PI, 0, true);
      fu.reserve(cx0 + 3, r.z0, cx0 + 6, r.z1);
      // tables
      const area = { x0: cx0 + 7, z0: r.z0 + 3, x1: r.x1 - 2, z1: r.z1 - 2 };
      fu.grid(area, 10, 10, (x, z) => {
        if (rng.chance(0.85)) fu.tableSet(rng.chance(0.6) ? 'TABLE_ROUND' : 'TABLE_SQUARE', x, z, rng.int(2, 4));
      });
      fu.lineWall(r, 'BARREL', 'right', 9, 3);
      fu.roomLights(r, 'HANGING_LAMP', true, 18);
      fu.wall(r, 'DARTBOARD', 'right', r.z0 + d * 0.3, 7);
      fu.paintings(r, 2, ['MIRROR', 'PAINTING']);
      fu.p('SPITTOON', cx0 + 5, cz1 - 2, 0, 0, true);
      break;
    }
    case 'parlour': {
      fu.fireplace(r, 'back', M.MARBLE_BLACK);
      fu.rug(r.x0 + 3, r.z0 + 3, r.x1 - 3, r.z1 - 3, M.CARPET_WORN);
      fu.tableSet('TABLE_ROUND', cx, cz, 3, 'ARMCHAIR');
      fu.lineWall(r, 'BENCH', 'left', 8, 3);
      fu.roomLights(r, 'HANGING_LAMP', false);
      fu.paintings(r, 2);
      break;
    }
    case 'storeroom':
    case 'stock':
    case 'seized': {
      fu.lineWall(r, 'BARREL', 'left', 3, 2);
      fu.lineWall(r, 'CRATE_STACK', 'back', 5, 2);
      fu.lineWall(r, 'CRATE', 'right', 4, 2);
      fu.grid({ x0: r.x0 + 6, z0: r.z0 + 6, x1: r.x1 - 6, z1: r.z1 - 6 }, 7, 7, (x, z) => {
        if (rng.chance(0.5)) fu.p(rng.pick(['SACKS', 'CRATE', 'BARREL'] as PropKind[]), x, z, rng.range(0, 3));
      });
      if (r.kind === 'seized') fu.p('CHEST', cx, cz, 0);
      fu.roomLights(r, 'HANGING_LAMP', false, 24);
      break;
    }
    case 'office': {
      // bureau du parrain
      const carpet = fu.boss === 'even' ? M.CARPET_BLUE : M.CARPET_RED;
      fu.rug(r.x0 + 2, r.z0 + 3, r.x1 - 2, r.z1 - 2, carpet);
      const dz = r.z1 - 6;
      fu.p('DESK_BOSS', cx, dz, Math.PI, 0, true);
      fu.p('BOSS_CHAIR', cx, dz + 3.6, Math.PI, 0, true);
      fu.f.prop('OIL_LAMP', cx - 3.5, fu.lv.floorTop + 3.5, dz - 1, 0, 0);
      fu.marks.desk = { lx: cx, lz: dz, yaw: Math.PI };
      fu.marks.deskSeat = { lx: cx, lz: dz - 4.2 };
      fu.reserve(cx - 6, dz - 7, cx + 6, r.z1);
      // fauteuils des visiteurs, assez écartés pour laisser la place devant le bureau
      fu.p('ARMCHAIR', cx - 5.5, dz - 7.5, 0.35, 0, true);
      fu.p('ARMCHAIR', cx + 5.5, dz - 7.5, -0.35, 0, true);
      fu.lineWall(r, 'BOOKSHELF', 'left', 5.5, 2);
      fu.againstWall(r, 'SAFE', 'right', r.z1 - 4);
      fu.againstWall(r, 'GLOBE', 'right', r.z0 + 4);
      fu.againstWall(r, 'TROPHY_CASE', 'right', cz);
      fu.wall(r, 'BANNER', 'back', cx - 6, 4, 0);
      fu.wall(r, 'BANNER', 'back', cx + 6, 4, 0);
      fu.wall(r, 'PORTRAIT', 'back', cx, 7, 9);
      fu.roomLights(r, 'CHANDELIER', true, 30);
      fu.p('MAP_STAND', r.x0 + 3, r.z0 + 3, Math.PI * 0.75, 0);
      break;
    }
    case 'armory': {
      fu.lineWall(r, 'WEAPON_RACK', 'back', 7, 1);
      fu.lineWall(r, 'WEAPON_RACK', 'right', 7, 2);
      fu.p('WORKBENCH', cx, cz, 0);
      fu.lineWall(r, 'AMMO_CRATE', 'left', 4, 2);
      fu.marks.armory = { lx: cx, lz: cz - 4 };
      fu.roomLights(r, 'HANGING_LAMP', false, 20);
      break;
    }
    case 'shop':
    case 'backroom': {
      if (r.kind === 'shop') {
        const goods =
          buildingType === 'bakery' ? GOODS_BREAD : buildingType === 'pawn' ? GOODS_PAWN : variant === 1 ? GOODS_HATS : GOODS_GROCER;
        // comptoir transversal
        const z = r.z0 + Math.round(d * 0.62);
        fu.counter(r.x0 + 4, z, r.x1 - 9, z + 2, M.WALNUT, buildingType === 'butcher' ? M.MARBLE : M.WALNUT, 4);
        fu.reserve(r.x0, z - 1, r.x1, r.z1);
        fu.shelves(r.x0, r.z0 + 2, r.x0 + 1, z - 1, 9, goods);
        fu.shelves(r.x1 - 1, r.z0 + 2, r.x1, z - 1, 9, goods);
        fu.shelves(r.x0 + 2, r.z1 - 1, r.x1 - 2, r.z1, 10, goods);
        if (buildingType === 'butcher') {
          fu.f.prop('MEAT_RACK', cx - 3, fu.lv.floorTop, r.z1 - 3, Math.PI, 0);
          fu.f.prop('MEAT_RACK', cx + 4, fu.lv.floorTop, r.z1 - 3, Math.PI, 1);
        } else if (buildingType === 'bakery') {
          fu.f.prop('BREAD_SHELF', cx, fu.lv.floorTop, r.z1 - 2.5, Math.PI, 0);
        } else if (buildingType === 'pawn') {
          fu.p('DISPLAY_CASE', cx - 4, r.z0 + 6, 0);
          fu.p('GRANDFATHER_CLOCK', r.x0 + 3, z - 4, FACE.fromLeft);
        }
        fu.marks.counter = { lx: cx, lz: z - 2 };
        fu.p('CHAIR', r.x0 + 4, r.z0 + 4, 0.6);
        fu.f.prop('OIL_LAMP', r.x0 + 6, fu.lv.floorTop + 4, z + 1, 0, 0);
        fu.roomLights(r, 'HANGING_LAMP', false, 20);
      } else {
        fu.lineWall(r, 'CRATE', 'back', 4, 2);
        fu.lineWall(r, 'SACKS', 'left', 5, 2);
        if (buildingType === 'bakery') {
          // four à pain en briques
          fu.f.fill(r.x1 - 9, fu.lv.floorTop, r.z1 - 6, r.x1 - 1, fu.lv.floorTop + 7, r.z1 - 1, M.FIREBRICK);
          fu.f.fill(r.x1 - 7, fu.lv.floorTop + 1, r.z1 - 6, r.x1 - 3, fu.lv.floorTop + 3, r.z1 - 5, M.FIRE);
          fu.f.light(r.x1 - 5, fu.lv.floorTop + 3, r.z1 - 7, 0.7, 6);
        }
        fu.p('TABLE_LONG', cx, cz, 0);
        fu.roomLights(r, 'HANGING_LAMP', false, 24);
      }
      break;
    }
    case 'gaming': {
      fu.rug(r.x0 + 2, r.z0 + 2, r.x1 - 2, r.z1 - 2, M.CARPET_RED);
      const area = { x0: r.x0 + 4, z0: r.z0 + 5, x1: r.x1 - 4, z1: r.z1 - 4 };
      fu.grid(area, 11, 11, (x, z, i, j) => {
        if ((i + j) % 3 === 2) fu.p('ROULETTE', x, z, 0);
        else fu.tableSet('CARD_TABLE', x, z, 4);
      });
      fu.counter(r.x1 - 3, r.z0 + 4, r.x1, r.z0 + 14, M.MAHOGANY, M.MAHOGANY, 4);
      fu.roomLights(r, 'CHANDELIER', true, 20);
      fu.paintings(r, 3);
      break;
    }
    case 'cashier': {
      fu.againstWall(r, 'SAFE', 'back', cx - 3);
      fu.againstWall(r, 'SAFE', 'back', cx + 3);
      fu.p('DESK', cx, cz, Math.PI);
      fu.p('CHAIR', cx, cz + 3, Math.PI);
      fu.roomLights(r, 'HANGING_LAMP', false);
      break;
    }
    case 'foyer': {
      fu.rug(r.x0 + 1, r.z0 + 1, r.x1 - 1, r.z1 - 1, M.CARPET_RED);
      fu.p('TICKET_BOOTH', r.x0 + 5, cz, FACE.fromLeft);
      fu.lineWall(r, 'POSTER_BOARD', 'right', 8, 3);
      fu.lineWall(r, 'PLANT_POT', 'front', 12, 3);
      fu.roomLights(r, 'CHANDELIER', true, 24);
      break;
    }
    case 'auditorium': {
      // scène au fond
      const sz = r.z1 - 14;
      fu.f.fill(r.x0, fu.lv.floorTop, sz, r.x1, fu.lv.floorTop + 4, r.z1, M.FLOOR_DARK);
      fu.f.fill(r.x0, fu.lv.floorTop, sz, r.x1, fu.lv.floorTop + 3, sz + 1, M.PAINT_MAROON);
      // rideaux
      fu.f.fill(r.x0, fu.lv.floorTop + 4, sz + 1, r.x0 + 6, fu.lv.ceil, sz + 2, M.CLOTH_RED);
      fu.f.fill(r.x1 - 6, fu.lv.floorTop + 4, sz + 1, r.x1, fu.lv.ceil, sz + 2, M.CLOTH_RED);
      fu.f.fill(r.x0, fu.lv.ceil - 3, sz + 1, r.x1, fu.lv.ceil, sz + 2, M.CLOTH_RED);
      fu.f.fill(r.x0, fu.lv.floorTop + 4, r.z1 - 1, r.x1, fu.lv.ceil, r.z1, M.PAINT_NAVY);
      // rampe
      for (let x = r.x0 + 3; x < r.x1 - 2; x += 5) fu.f.light(x, fu.lv.floorTop + 5, sz + 1, 0.45, 5);
      fu.f.prop('PIANO', r.x0 + 5, fu.lv.floorTop + 4, sz + 6, Math.PI, 0);
      fu.reserve(r.x0, sz - 2, r.x1, r.z1);
      // rangées de sièges face à la scène
      for (let z = r.z0 + 4; z < sz - 4; z += 4) {
        for (let x = r.x0 + 4; x < r.x1 - 3; x += 11) {
          if (Math.abs(x + 5 - cx) < 3) continue;
          fu.p('SEAT_ROW', x + 5, z, 0);
        }
      }
      fu.roomLights(r, 'CHANDELIER', true, 30);
      break;
    }
    case 'cafe': {
      fu.counter(r.x0 + 3, r.z1 - 4, r.x1 - 3, r.z1 - 2, M.MAHOGANY, M.MARBLE, 4);
      fu.reserve(r.x0, r.z1 - 6, r.x1, r.z1);
      fu.grid({ x0: r.x0 + 3, z0: r.z0 + 3, x1: r.x1 - 3, z1: r.z1 - 7 }, 8, 8, (x, z) => {
        fu.tableSet('TABLE_SQUARE', x, z, 2);
      });
      fu.lineWall(r, 'PLANT_POT', 'left', 12, 3);
      fu.paintings(r, 3, ['MIRROR', 'PAINTING']);
      fu.roomLights(r, 'CHANDELIER', true, 22);
      break;
    }
    case 'kitchen': {
      fu.f.fill(r.x0, fu.lv.floorTop, r.z1 - 4, r.x0 + 8, fu.lv.floorTop + 4, r.z1, M.IRON);
      fu.f.fill(r.x0 + 2, fu.lv.floorTop + 1, r.z1 - 4, r.x0 + 6, fu.lv.floorTop + 2, r.z1 - 3, M.FIRE);
      fu.f.light(r.x0 + 4, fu.lv.floorTop + 3, r.z1 - 6, 0.6, 6);
      fu.p('TABLE_LONG', cx, cz, 0);
      fu.lineWall(r, 'BARREL', 'right', 4, 2);
      fu.lineWall(r, 'CABINET', 'back', 6, 10);
      fu.roomLights(r, 'HANGING_LAMP', false);
      break;
    }
    case 'banking_hall': {
      // comptoir des guichetiers avec grille en laiton
      const z = r.z0 + Math.round(d * 0.55);
      fu.counter(r.x0 + 3, z, r.x1 - 3, z + 2, M.MAHOGANY, M.MARBLE, 5);
      for (let x = r.x0 + 3; x < r.x1 - 3; x += 2) fu.f.fill(x, fu.lv.floorTop + 5, z + 1, x + 1, fu.lv.floorTop + 9, z + 2, M.BRASS);
      fu.f.fill(r.x0 + 3, fu.lv.floorTop + 9, z + 1, r.x1 - 3, fu.lv.floorTop + 10, z + 2, M.BRASS);
      // ouverture dans le comptoir
      fu.f.fill(r.x1 - 7, fu.lv.floorTop, z, r.x1 - 3, fu.lv.floorTop + 10, z + 2, 0);
      fu.reserve(r.x1 - 9, z - 3, r.x1 - 2, z + 5);
      for (let x = r.x0 + 6; x < r.x1 - 10; x += 8) {
        fu.p('DESK', x, z + 5, Math.PI);
        fu.p('CHAIR', x, z + 3.5, Math.PI);
      }
      fu.column(r.x0 + 8, r.z0 + 8, 2, M.MARBLE, M.GOLD);
      fu.column(r.x1 - 8, r.z0 + 8, 2, M.MARBLE, M.GOLD);
      fu.lineWall(r, 'BENCH', 'left', 9, 3);
      fu.wall(r, 'PORTRAIT', 'right', cz, 7, 8);
      fu.roomLights(r, 'CHANDELIER', true, 24);
      fu.p('GRANDFATHER_CLOCK', r.x1 - 3, r.z0 + 3, FACE.fromRight);
      break;
    }
    case 'vault': {
      fu.lineWall(r, 'SAFE', 'left', 4, 2);
      fu.lineWall(r, 'SAFE', 'right', 4, 2);
      // lingots
      for (let x = cx - 3; x < cx + 3; x++) fu.f.fill(Math.floor(x), fu.lv.floorTop, Math.floor(cz), Math.floor(x) + 1, fu.lv.floorTop + 2 - (x & 1), Math.floor(cz) + 2, M.GOLD);
      fu.lineWall(r, 'CHEST', 'back', 5, 2);
      fu.roomLights(r, 'HANGING_LAMP', false);
      break;
    }
    case 'manager':
    case 'director':
    case 'police_office':
    case 'foreman':
    case 'customs_hall': {
      if (r.kind === 'customs_hall') {
        const z = r.z0 + Math.round(d * 0.5);
        fu.counter(r.x0 + 3, z, r.x1 - 8, z + 2, M.WALNUT, M.WALNUT, 4);
        fu.reserve(r.x0, z - 2, r.x1 - 7, z + 4);
        fu.lineWall(r, 'CRATE', 'back', 5, 3);
        fu.lineWall(r, 'BENCH', 'left', 9, 3);
        fu.p('DESK', cx - 6, z + 6, Math.PI);
        fu.p('DESK', cx + 4, z + 6, Math.PI);
        fu.roomLights(r, 'HANGING_LAMP', true, 20);
        break;
      }
      const rich = r.kind === 'manager' || r.kind === 'director';
      if (rich) fu.rug(r.x0 + 2, r.z0 + 2, r.x1 - 2, r.z1 - 2, M.CARPET_GREEN);
      fu.p('DESK', cx, r.z1 - 5, Math.PI);
      fu.p('CHAIR', cx, r.z1 - 2.5, Math.PI);
      fu.f.prop('OIL_LAMP', cx + 2, fu.lv.floorTop + 3.3, r.z1 - 5, 0, 0);
      fu.lineWall(r, rich ? 'BOOKSHELF' : 'FILING_CABINET', 'left', rich ? 5.5 : 3, 2);
      if (rich) fu.againstWall(r, 'GLOBE', 'right', r.z0 + 4);
      fu.againstWall(r, 'SAFE', 'right', r.z1 - 4);
      fu.p('CHAIR', cx - 2, r.z1 - 9, 0.3);
      fu.roomLights(r, rich ? 'CHANDELIER' : 'HANGING_LAMP', false);
      fu.paintings(r, rich ? 2 : 1);
      break;
    }
    case 'trading_floor': {
      fu.rug(r.x0 + 2, r.z0 + 2, r.x1 - 2, r.z1 - 2, M.CHECKER);
      fu.grid({ x0: r.x0 + 4, z0: r.z0 + 6, x1: r.x1 - 4, z1: r.z1 - 4 }, 12, 9, (x, z) => {
        fu.tableSet('TABLE_LONG', x, z, 4);
      });
      fu.column(cx - 10, r.z0 + 5, 2, M.MARBLE, M.GOLD);
      fu.column(cx + 10, r.z0 + 5, 2, M.MARBLE, M.GOLD);
      fu.wall(r, 'POSTER_BOARD', 'back', cx, 2, 0);
      fu.roomLights(r, 'CHANDELIER', true, 22);
      fu.p('GRANDFATHER_CLOCK', r.x0 + 3, r.z1 - 3, FACE.fromLeft);
      break;
    }
    case 'clerks': {
      fu.grid({ x0: r.x0 + 3, z0: r.z0 + 5, x1: r.x1 - 3, z1: r.z1 - 3 }, 9, 7, (x, z) => {
        if (fu.p('DESK', x, z, Math.PI)) {
          fu.p('CHAIR', x, z + 2.8, Math.PI);
          fu.f.prop('TYPEWRITER', x - 1, fu.lv.floorTop + 3.3, z, Math.PI, 0);
        }
      });
      fu.lineWall(r, 'FILING_CABINET', 'left', 3, 2);
      fu.wall(r, 'PAINTING', 'right', cz, 7, 3);
      fu.roomLights(r, 'HANGING_LAMP', true, 16);
      break;
    }
    case 'archive':
    case 'library':
    case 'reading': {
      fu.lineWall(r, 'BOOKSHELF', 'left', 5.3, 1);
      fu.lineWall(r, 'BOOKSHELF', 'right', 5.3, 1);
      fu.lineWall(r, 'BOOKSHELF', 'back', 5.3, 1);
      fu.rug(r.x0 + 4, r.z0 + 4, r.x1 - 4, r.z1 - 4, M.CARPET_GREEN);
      if (r.kind !== 'archive') {
        fu.tableSet('TABLE_ROUND', cx, cz, 3, 'ARMCHAIR');
        fu.p('GLOBE', cx + 5, cz + 4, 0);
      } else fu.p('TABLE_LONG', cx, cz, 0);
      fu.roomLights(r, 'CHANDELIER', false);
      break;
    }
    case 'post_hall': {
      const z = r.z0 + Math.round(d * 0.6);
      fu.counter(r.x0 + 3, z, r.x1 - 8, z + 2, M.WALNUT, M.WALNUT, 4);
      fu.reserve(r.x0, z - 2, r.x1 - 7, z + 4);
      for (let x = r.x0 + 5; x < r.x1 - 9; x += 5) fu.f.fill(x, fu.lv.floorTop + 4, z + 1, x + 1, fu.lv.floorTop + 8, z + 2, M.BRASS);
      fu.lineWall(r, 'BENCH', 'left', 9, 3);
      fu.p('PILLAR_BOX', r.x1 - 4, r.z0 + 4, 0);
      fu.lineWall(r, 'SACKS', 'back', 6, 2);
      fu.p('GRANDFATHER_CLOCK', r.x0 + 3, r.z0 + 3, FACE.fromLeft);
      fu.roomLights(r, 'CHANDELIER', true, 22);
      break;
    }
    case 'sorting': {
      fu.grid({ x0: r.x0 + 3, z0: r.z0 + 4, x1: r.x1 - 3, z1: r.z1 - 3 }, 12, 7, (x, z) => fu.p('TABLE_LONG', x, z, 0));
      fu.shelves(r.x0 + 2, r.z1 - 1, r.x1 - 2, r.z1, 10, [M.POSTER, M.SACK, M.CLOTH_WHITE]);
      fu.lineWall(r, 'SACKS', 'left', 5, 2);
      fu.roomLights(r, 'HANGING_LAMP', false, 18);
      break;
    }
    case 'nave': {
      // allée centrale, bancs de part et d'autre
      fu.rug(cx - 3, r.z0 + 2, cx + 3, r.z1 - 8, M.CARPET_RED);
      for (let z = r.z0 + 6; z < r.z1 - 14; z += 5) {
        fu.p('PEW', cx - 9, z, 0);
        fu.p('PEW', cx + 9, z, 0);
      }
      // chœur surélevé
      fu.f.fill(r.x0, fu.lv.floorTop, r.z1 - 9, r.x1, fu.lv.floorTop + 1, r.z1, M.MARBLE);
      fu.f.prop('ALTAR', cx, fu.lv.floorTop + 1, r.z1 - 3, Math.PI, 0);
      fu.f.prop('CANDELABRA', cx - 3, fu.lv.floorTop + 5.4, r.z1 - 3, Math.PI, 0);
      fu.f.prop('CANDELABRA', cx + 3, fu.lv.floorTop + 5.4, r.z1 - 3, Math.PI, 0);
      fu.p('PULPIT', r.x0 + 4, r.z1 - 12, FACE.fromLeft);
      fu.reserve(cx - 4, r.z0, cx + 4, r.z1);
      fu.roomLights(r, 'CHANDELIER', true, 26);
      break;
    }
    case 'common': {
      fu.fireplace(r, 'left', M.STONE_DARK);
      fu.grid({ x0: r.x0 + 6, z0: r.z0 + 4, x1: r.x1 - 3, z1: r.z1 - 3 }, 12, 7, (x, z) => {
        if (fu.p('TABLE_LONG', x, z, 0)) {
          fu.p('BENCH', x, z - 3, 0);
          fu.p('BENCH', x, z + 3, Math.PI);
        }
      });
      fu.roomLights(r, 'HANGING_LAMP', false, 18);
      break;
    }
    case 'dormitory': {
      fu.grid({ x0: r.x0 + 2, z0: r.z0 + 3, x1: r.x1 - 2, z1: r.z1 - 2 }, 5, 10, (x, z, i) => {
        fu.p(i % 2 ? 'BUNK_BED' : 'BED_POOR', x, z, 0, rng.int(0, 3));
      });
      fu.roomLights(r, 'HANGING_LAMP', false, 20);
      break;
    }
    case 'living': {
      fu.fireplace(r, 'right', M.STONE_DARK);
      fu.rug(r.x0 + 4, r.z0 + 4, r.x1 - 6, r.z1 - 4, M.CARPET_WORN);
      fu.tableSet('TABLE_SQUARE', cx - 2, cz, 3);
      fu.againstWall(r, 'CABINET', 'left', r.z0 + 5);
      fu.againstWall(r, 'BED_POOR', 'left', r.z1 - 6);
      fu.againstWall(r, 'WASH_STAND', 'back', r.x0 + 5);
      fu.roomLights(r, 'HANGING_LAMP', false);
      fu.paintings(r, 1);
      break;
    }
    case 'bedroom': {
      fu.againstWall(r, 'BED', 'back', cx, rng.int(0, 3));
      fu.againstWall(r, 'WARDROBE', 'left', r.z0 + 4);
      fu.againstWall(r, 'CHEST', 'right', r.z1 - 4);
      fu.againstWall(r, 'WASH_STAND', 'right', r.z0 + 4);
      fu.roomLights(r, 'HANGING_LAMP', false);
      break;
    }
    case 'scullery': {
      fu.lineWall(r, 'BARREL', 'left', 3, 2);
      fu.againstWall(r, 'WASH_STAND', 'back', cx);
      fu.p('BUCKET', cx, cz, 0);
      fu.roomLights(r, 'HANGING_LAMP', false);
      break;
    }
    case 'workshop': {
      fu.grid({ x0: r.x0 + 3, z0: r.z0 + 4, x1: r.x1 - 3, z1: r.z1 - 3 }, 6, 6, (x, z) => {
        if (fu.p('SEWING_TABLE', x, z, Math.PI)) fu.p('STOOL', x, z + 2.6, 0);
      });
      fu.lineWall(r, 'SACKS', 'left', 5, 2);
      fu.roomLights(r, 'HANGING_LAMP', false, 14);
      break;
    }
    case 'police_front': {
      const z = r.z0 + Math.round(d * 0.55);
      fu.p('POLICE_DESK', cx + 3, z, Math.PI, 0);
      fu.lineWall(r, 'BENCH', 'left', 9, 3);
      fu.lineWall(r, 'POSTER_BOARD', 'right', 8, 3);
      fu.roomLights(r, 'HANGING_LAMP', true);
      break;
    }
    case 'cells': {
      // cellules : barreaux le long du fond
      const z = r.z1 - 9;
      for (let x = r.x0 + 2; x < r.x1 - 4; x += 8) {
        fu.f.prop('CELL_BARS', x + 4, fu.lv.floorTop, z, 0, 0);
        fu.p('BED_POOR', x + 4, r.z1 - 4, Math.PI, 0, true);
      }
      fu.reserve(r.x0, z - 1, r.x1, r.z1);
      fu.roomLights(r, 'HANGING_LAMP', false);
      break;
    }
    case 'salon':
    case 'lounge': {
      const carpet = buildingType === 'club' ? M.CARPET_GREEN : variant ? M.CARPET_BLUE : M.CARPET_RED;
      fu.rug(r.x0 + 3, r.z0 + 3, r.x1 - 3, r.z1 - 3, carpet);
      fu.fireplace(r, 'right', M.MARBLE);
      const area = { x0: r.x0 + 4, z0: r.z0 + 4, x1: r.x1 - 7, z1: r.z1 - 4 };
      fu.grid(area, 12, 11, (x, z, i, j) => {
        if ((i + j) % 2 === 0) {
          fu.p('CHESTERFIELD', x, z - 2.5, 0);
          fu.p('TABLE_ROUND', x, z + 1, 0, 0);
          fu.p('ARMCHAIR', x - 3.5, z + 3.5, 2.3);
        } else {
          fu.tableSet('TABLE_ROUND', x, z, 3, 'ARMCHAIR');
        }
      });
      if (buildingType !== 'club') fu.againstWall(r, 'GRAND_PIANO', 'left', r.z0 + 7) || fu.againstWall(r, 'PIANO', 'left', r.z0 + 6);
      fu.lineWall(r, 'PLANT_POT', 'front', 14, 3);
      fu.p('GRANDFATHER_CLOCK', r.x0 + 3, r.z1 - 3, FACE.fromLeft);
      fu.paintings(r, 3);
      fu.roomLights(r, 'CHANDELIER', true, 24);
      break;
    }
    case 'dining': {
      fu.rug(r.x0 + 3, r.z0 + 3, r.x1 - 3, r.z1 - 3, M.CARPET_RED);
      fu.tableSet('TABLE_DINING', cx, cz, 8, 'CHAIR', HALF_PI * (w > d ? 0 : 1));
      fu.f.prop('CANDELABRA', cx, fu.lv.floorTop + 3.3, cz, 0, 0);
      fu.againstWall(r, 'SIDEBOARD', 'back', cx);
      fu.paintings(r, 2);
      fu.roomLights(r, 'CHANDELIER', false, 30);
      break;
    }
    case 'clock_hall': {
      // mécanisme d'horloge et cordes de cloches
      fu.cylinder(cx, cz, 2.5, fu.lv.floorTop, fu.lv.floorTop + 1, M.IRON);
      fu.cylinder(cx, cz, 1.5, fu.lv.floorTop + 1, fu.lv.ceil, M.BRASS, true);
      fu.p('WORKBENCH', cx, r.z0 + 3, 0);
      fu.roomLights(r, 'HANGING_LAMP', false);
      fu.reserve(cx - 4, cz - 4, cx + 4, cz + 4);
      break;
    }
    case 'foundry_floor': {
      // haut fourneau
      const fx = r.x1 - 10;
      const fz = r.z1 - 10;
      fu.f.fill(fx - 5, fu.lv.floorTop, fz - 5, fx + 6, fu.lv.ceil, fz + 6, M.FIREBRICK);
      fu.f.fill(fx - 2, fu.lv.floorTop, fz - 5, fx + 3, fu.lv.floorTop + 4, fz - 4, M.FIRE);
      fu.f.light(fx, fu.lv.floorTop + 3, fz - 8, 1, 12);
      fu.reserve(fx - 7, fz - 9, fx + 8, r.z1);
      // tas de charbon
      for (let i = 0; i < 4; i++) fu.f.fill(r.x0 + i, fu.lv.floorTop, r.z1 - 8 + i, r.x0 + 8 - i, fu.lv.floorTop + 4 - i, r.z1 - i, M.COAL);
      fu.grid({ x0: r.x0 + 6, z0: r.z0 + 6, x1: fx - 8, z1: r.z1 - 8 }, 9, 8, (x, z, i, j) => {
        const pick = (i + j) % 3;
        if (pick === 0) fu.p('ANVIL', x, z, rng.range(0, 3));
        else if (pick === 1) fu.p('CANNON', x, z, HALF_PI);
        else fu.p('WORKBENCH', x, z, 0);
      });
      fu.lineWall(r, 'CRATE_STACK', 'left', 5, 6);
      fu.roomLights(r, 'HANGING_LAMP', false, 18);
      break;
    }
    case 'brewhouse': {
      // cuves en cuivre
      const cols = Math.max(1, Math.floor((w - 6) / 12));
      for (let i = 0; i < cols; i++) {
        const vx = r.x0 + 7 + i * 12;
        const vz = r.z1 - 8;
        fu.cylinder(vx, vz, 4, fu.lv.floorTop, fu.lv.floorTop + 10, M.COPPER);
        fu.cylinder(vx, vz, 3, fu.lv.floorTop + 10, fu.lv.floorTop + 12, M.COPPER);
        fu.f.fill(vx, fu.lv.floorTop + 12, vz, vx + 1, fu.lv.ceil, vz + 1, M.IRON);
        fu.reserve(vx - 5, vz - 5, vx + 5, vz + 5);
      }
      fu.grid({ x0: r.x0 + 3, z0: r.z0 + 4, x1: r.x1 - 3, z1: r.z1 - 14 }, 5, 6, (x, z) => {
        if (rng.chance(0.55)) fu.p('BARREL', x, z, 0);
      });
      fu.lineWall(r, 'SACKS', 'left', 5, 3);
      fu.roomLights(r, 'HANGING_LAMP', false, 18);
      break;
    }
    case 'cellar': {
      fu.grid({ x0: r.x0 + 2, z0: r.z0 + 2, x1: r.x1 - 2, z1: r.z1 - 2 }, 3.5, 6, (x, z, i) => {
        if (i % 4 !== 2) fu.p('BARREL', x, z, HALF_PI);
      });
      fu.roomLights(r, 'HANGING_LAMP', false, 18);
      break;
    }
    case 'mill_floor': {
      fu.grid({ x0: r.x0 + 4, z0: r.z0 + 5, x1: r.x1 - 4, z1: r.z1 - 4 }, 11, 9, (x, z) => fu.p('LOOM', x, z, 0, rng.int(0, 3)));
      fu.lineWall(r, 'SACKS', 'left', 5, 2);
      // arbres de transmission au plafond
      for (let z = r.z0 + 5; z < r.z1 - 3; z += 9) fu.f.fill(r.x0, fu.lv.ceil - 2, z, r.x1, fu.lv.ceil - 1, z + 1, M.IRON);
      fu.roomLights(r, 'HANGING_LAMP', false, 16);
      break;
    }
    case 'pump_room': {
      fu.cylinder(r.x0 + 7, cz, 3.5, fu.lv.floorTop, fu.lv.floorTop + 9, M.MACHINE_GREEN);
      fu.f.fill(r.x0 + 4, fu.lv.floorTop + 2, cz - 1, r.x0 + 5, fu.lv.floorTop + 4, cz + 1, M.FIRE);
      fu.reserve(r.x0, cz - 5, r.x0 + 12, cz + 5);
      fu.f.fill(r.x0 + 10, fu.lv.floorTop + 7, cz, r.x1, fu.lv.floorTop + 8, cz + 1, M.MACHINE);
      fu.p('DESK', r.x1 - 6, r.z0 + 4, 0);
      fu.p('CHAIR', r.x1 - 6, r.z0 + 6.5, Math.PI);
      fu.roomLights(r, 'HANGING_LAMP', false);
      break;
    }
    case 'warehouse_floor': {
      // allée centrale et rangées de caisses
      fu.reserve(cx - 4, r.z0, cx + 4, r.z1);
      fu.grid({ x0: r.x0 + 3, z0: r.z0 + 6, x1: r.x1 - 3, z1: r.z1 - 4 }, 6, 6, (x, z) => {
        const pick = rng.next();
        if (pick < 0.45) fu.p('CRATE_STACK', x, z, 0);
        else if (pick < 0.65) fu.p('BARREL', x, z, 0);
        else if (pick < 0.8) fu.p('SACKS', x, z, rng.range(0, 3));
        else if (pick < 0.88) fu.p('CRATE', x, z, 0);
      });
      fu.p('HANDCART', cx + 2, r.z0 + 6, 0.2);
      fu.p('DESK', r.x1 - 5, r.z0 + 4, FACE.fromRight);
      fu.roomLights(r, 'HANGING_LAMP', false, 18);
      break;
    }
    case 'shed': {
      // coque de bateau en construction
      const bx = cx;
      for (let z = r.z0 + 4; z < r.z1 - 4; z++) {
        const t = (z - r.z0 - 4) / Math.max(1, r.z1 - r.z0 - 8);
        const half = Math.round(2 + 3 * Math.sin(Math.PI * t));
        fu.f.fill(Math.round(bx - half), fu.lv.floorTop + 1, z, Math.round(bx + half), fu.lv.floorTop + 2, z + 1, M.HULL);
        fu.f.set(Math.round(bx - half), fu.lv.floorTop + 2, z, M.HULL);
        fu.f.set(Math.round(bx + half) - 1, fu.lv.floorTop + 2, z, M.HULL);
        fu.f.set(Math.round(bx - half), fu.lv.floorTop + 3, z, M.HULL);
        fu.f.set(Math.round(bx + half) - 1, fu.lv.floorTop + 3, z, M.HULL);
      }
      fu.reserve(bx - 7, r.z0 + 2, bx + 7, r.z1 - 2);
      fu.lineWall(r, 'WORKBENCH', 'left', 9, 3);
      fu.lineWall(r, 'CRATE', 'right', 5, 3);
      fu.roomLights(r, 'HANGING_LAMP', false, 16);
      break;
    }
    case 'clerks_unused' as never:
      break;
    default:
      fu.roomLights(r, 'HANGING_LAMP', false);
  }
}
