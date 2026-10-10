// Ameublement des pièces selon leur fonction (New York 2085). Coordonnées locales (voxels).
// Toutes les pièces sont meublées et décorées par le jeu : le joueur ne décore rien.

import { M } from '../../materials';
import { Rng } from '../../util';
import { PROP_DEFS, type PropDef, type PropKind } from '../props';
import type { Frame } from './frame';
import type { Levels } from './structure';

const HALF_PI = Math.PI / 2;
/** Orientation locale pour un objet adossé à un mur et tourné vers la pièce. */
export const FACE = { fromLeft: HALF_PI, fromRight: -HALF_PI, fromBack: Math.PI, fromFront: 0 };

export type Side4 = 'left' | 'right' | 'back' | 'front';

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Room extends Rect {
  kind: string;
  /** Étage (index dans la liste des étages accessibles). */
  floor: number;
}

export class Furnisher {
  readonly f: Frame;
  lv: Levels;
  readonly rng: Rng;
  readonly reserved: Rect[] = [];
  /** Points d'intérêt relevés pendant l'ameublement (bureau, recrutement…), avec leur étage. */
  readonly marks: Record<string, { lx: number; lz: number; ly: number; yaw?: number }> = {};
  boss: 'dadou' | 'even' | null = null;

  constructor(f: Frame, lv: Levels, rng: Rng) {
    this.f = f;
    this.lv = lv;
    this.rng = rng;
  }

  mark(name: string, lx: number, lz: number, yaw?: number): void {
    this.marks[name] = { lx, lz, ly: this.lv.floorTop, yaw };
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
    if ((PROP_DEFS[kind] as PropDef).collide === 'none') return true;
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
  wall(r: Rect, kind: PropKind, wall: Side4, along: number, height: number, variant = 0): void {
    const d = PROP_DEFS[kind].size[2] * 2;
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
  againstWall(r: Rect, kind: PropKind, wall: Side4, along: number, variant = 0): boolean {
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
  lineWall(r: Rect, kind: PropKind, wall: Side4, spacing: number, margin = 2, variantFn?: (i: number) => number): number {
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
  tableSet(table: PropKind, lx: number, lz: number, chairs: number, chair: PropKind = 'CHAIR', yaw = 0, variant = 0): boolean {
    if (!this.p(table, lx, lz, yaw, variant)) return false;
    const [w, d] = this.footprint(table, yaw);
    const pos: [number, number, number][] = [];
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
      if (this.p(chair, x, z, a + this.rng.range(-0.2, 0.2), variant)) n++;
    }
    return true;
  }

  /** Grille d'éléments dans une zone. */
  grid(area: Rect, stepX: number, stepZ: number, place: (lx: number, lz: number, i: number, j: number) => void): void {
    const nx = Math.max(1, Math.floor((area.x1 - area.x0) / stepX));
    const nz = Math.max(1, Math.floor((area.z1 - area.z0) / stepZ));
    const ox = area.x0 + (area.x1 - area.x0 - (nx - 1) * stepX) / 2;
    const oz = area.z0 + (area.z1 - area.z0 - (nz - 1) * stepZ) / 2;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) place(ox + i * stepX, oz + j * stepZ, i, j);
  }

  /** Luminaire au plafond. */
  ceiling(kind: PropKind, lx: number, lz: number, variant = 0): void {
    const h = PROP_DEFS[kind].size[1] * 4;
    this.f.prop(kind, lx, this.lv.ceil - h, lz, 0, variant);
  }

  /** Luminaires répartis dans une pièce. */
  lights(r: Rect, kind: PropKind, spacing = 20, variant = 0): void {
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    // espacement réel un peu plus large que demandé : moins de sources, même ambiance
    const nx = Math.max(1, Math.round(w / (spacing * 1.7)));
    const nz = Math.max(1, Math.round(d / (spacing * 1.7)));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) this.ceiling(kind, r.x0 + ((i + 0.5) * w) / nx, r.z0 + ((j + 0.5) * d) / nz, variant);
  }

  /** Vrai si le mur est plein (pas d'ouverture) à cet endroit, à hauteur de tableau. */
  wallClear(r: Rect, wall: Side4, along: number, height = 8): boolean {
    const y = this.lv.floorTop + height;
    for (let k = -3; k <= 3; k++) {
      const a = Math.floor(along + k);
      let x: number;
      let z: number;
      if (wall === 'left') [x, z] = [r.x0 - 1, a];
      else if (wall === 'right') [x, z] = [r.x1, a];
      else if (wall === 'back') [x, z] = [a, r.z1];
      else [x, z] = [a, r.z0 - 1];
      const m = this.f.get(x, y, z);
      if (m === 0 || m === M.GLASS || m === M.GLASS_LIT || m === M.GLASS_SHOP || m === M.GLASS_CLEAR || m === M.GLASS_COOL) return false;
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

  /** Quelques cadres aux murs pleins. */
  art(r: Rect, n: number, kinds: PropKind[] = ['WALL_ART'], height = 7): void {
    const walls: Side4[] = ['back', 'left', 'right'];
    let placed = 0;
    for (let i = 0; i < n * 4 && placed < n; i++) {
      const w = walls[i % walls.length];
      const len = w === 'back' ? r.x1 - r.x0 : r.z1 - r.z0;
      const start = w === 'back' ? r.x0 : r.z0;
      const along = start + len * (0.2 + 0.6 * ((i * 0.618) % 1));
      if (!this.wallClear(r, w, along, height)) continue;
      this.wall(r, this.rng.pick(kinds), w, along, height, this.rng.int(0, 7));
      placed++;
    }
  }

  // --------------------------------------------------------------------- éléments en voxels

  /** Comptoir (bar, boutique) : corps + plateau. */
  counter(x0: number, z0: number, x1: number, z1: number, body: number, top: number, height = 4, led?: number): void {
    const y = this.lv.floorTop;
    this.f.fill(x0, y, z0, x1, y + height - 1, z1, body);
    this.f.fill(x0, y + height - 1, z0, x1, y + height, z1, top);
    if (led) this.f.fill(x0, y, z0, x1, y + 1, z1, led);
  }

  /** Revêtement de sol sur une zone (tapis, piste de danse…). */
  floor(x0: number, z0: number, x1: number, z1: number, mat: number): void {
    this.f.fill(Math.round(x0), this.lv.floorTop - 1, Math.round(z0), Math.round(x1), this.lv.floorTop, Math.round(z1), mat);
  }

  /** Estrade (scène, ring) : plateau surélevé. */
  dais(x0: number, z0: number, x1: number, z1: number, h: number, mat: number, edge?: number): void {
    const y = this.lv.floorTop;
    this.f.fill(x0, y, z0, x1, y + h, z1, mat);
    if (edge) {
      this.f.fill(x0, y + h - 1, z0, x1, y + h, z0 + 1, edge);
      this.f.fill(x0, y + h - 1, z1 - 1, x1, y + h, z1, edge);
      this.f.fill(x0, y + h - 1, z0, x0 + 1, y + h, z1, edge);
      this.f.fill(x1 - 1, y + h - 1, z0, x1, y + h, z1, edge);
    }
  }

  /** Cylindre vertical en voxels (cuves, piliers). */
  cylinder(cx: number, cz: number, r: number, y0: number, y1: number, mat: number, shell = false): void {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
        const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
        if (d <= r && (!shell || d > r - 1.5)) this.f.fill(x, y0, z, x + 1, y1, z + 1, mat);
      }
  }

  /** Colonne carrée du sol au plafond. */
  column(cx: number, cz: number, size: number, mat: number, cap: number): void {
    const y0 = this.lv.floorTop;
    const x0 = Math.round(cx - size / 2);
    const z0 = Math.round(cz - size / 2);
    this.f.fill(x0, y0, z0, x0 + size, this.lv.ceil, z0 + size, mat);
    this.f.fill(x0 - 1, this.lv.ceil - 1, z0 - 1, x0 + size + 1, this.lv.ceil, z0 + size + 1, cap);
    this.f.fill(x0 - 1, y0, z0 - 1, x0 + size + 1, y0 + 1, z0 + size + 1, cap);
  }

  /** Cloison basse ou vitrée entre deux points (le long de x ou de z). */
  partition(x0: number, z0: number, x1: number, z1: number, h: number, mat: number): void {
    const y = this.lv.floorTop;
    this.f.fill(x0, y, z0, x1, y + h, z1, mat);
  }

  /** Étagères murales garnies de marchandises colorées (voxels). */
  shelves(x0: number, z0: number, x1: number, z1: number, height: number, goods: number[], frame = M.STEEL): void {
    const y = this.lv.floorTop;
    this.f.fill(x0, y, z0, x1, y + height, z1, frame);
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
}

// ======================================================================================
// Ameublement par type de pièce

const GOODS_STORE = [M.PAINT_RED, M.PAINT_YELLOW, M.PAINT_TEAL, M.PAINT_WHITE, M.STUCCO_GREEN, M.PAINT_NAVY];
const GOODS_HERBS = [M.WALNUT, M.BRASS, M.STUCCO_RED, M.PAINT_CREAM, M.STUCCO_GREEN];
const GOODS_TECH = [M.METAL_PANEL_DARK, M.LED_CYAN, M.STEEL, M.LED_PINK, M.METAL_PANEL_WHITE];
const GOODS_PHARMA = [M.PAINT_WHITE, M.PAINT_TEAL, M.PAINT_RED, M.CONCRETE_WHITE];

/** Variante de couleur liée au parrain (0 = neutre, 1 = Dadou, 2 = Even). */
function bossVar(fu: Furnisher): number {
  return fu.boss === 'dadou' ? 1 : fu.boss === 'even' ? 2 : 0;
}

export function furnishRoom(fu: Furnisher, r: Room, variant: number): void {
  const rng = fu.rng;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  const bv = bossVar(fu);
  switch (r.kind) {
    // ------------------------------------------------------------------ nuit et loisirs
    case 'club_floor': {
      // piste de danse lumineuse au centre, DJ au fond, bar à gauche, enceintes
      fu.floor(cx - w * 0.22, cz - d * 0.1, cx + w * 0.22, cz + d * 0.3, M.PAVER_LED);
      fu.dais(cx - 7, r.z1 - 7, cx + 7, r.z1, 3, M.METAL_PANEL_DARK, M.LED_PINK);
      fu.p('DJ_BOOTH', cx, r.z1 - 4.5, Math.PI, variant + 1, true, fu.lv.floorTop + 3);
      fu.p('SPEAKER_STACK', cx - 9, r.z1 - 3, Math.PI, 0, true);
      fu.p('SPEAKER_STACK', cx + 9, r.z1 - 3, Math.PI, 0, true);
      fu.counter(r.x0 + 2, r.z0 + 6, r.x0 + 5, r.z1 - 10, M.METAL_PANEL_DARK, M.MARBLE_BLACK, 4, M.LED_PINK);
      fu.p('BOTTLE_SHELF', r.x0 + 0.9, cz - 2, FACE.fromLeft, 0, true);
      for (let z = r.z0 + 8; z < r.z1 - 11; z += 3) fu.p('BAR_STOOL', r.x0 + 7, z, -HALF_PI);
      fu.mark('bar', r.x0 + 6.5, cz);
      for (let x = r.x0 + 10; x < r.x1 - 6; x += 10) fu.ceiling('STAGE_LIGHTS', x, cz, (x * 7) & 7);
      fu.lineWall(r, 'SOFA', 'right', 12, 3, () => 2);
      fu.art(r, 2, ['NEON_ART'], 8);
      break;
    }
    case 'club_vip': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.CARPET_PURPLE);
      fu.p('SOFA_LUXE', cx, r.z1 - 3, Math.PI, 3);
      fu.p('SOFA_LUXE', cx, r.z0 + 3, 0, 3);
      fu.p('COFFEE_TABLE', cx, cz, 0);
      fu.p('BAR_COUNTER', r.x0 + 2, cz, FACE.fromLeft, 6);
      fu.p('POOL_TABLE', cx + w * 0.25, cz, HALF_PI);
      fu.lights(r, 'PENDANT_LIGHT', 14);
      fu.art(r, 2, ['NEON_ART'], 8);
      break;
    }
    case 'jazz_hall': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.FLOOR_WALNUT);
      fu.dais(cx - 9, r.z1 - 9, cx + 9, r.z1, 3, M.FLOOR_DARK, M.BRASS);
      fu.p('GRAND_PIANO', cx - 4, r.z1 - 5, Math.PI + 0.3, 0, true, fu.lv.floorTop + 3);
      fu.p('MIC_STAND', cx + 2, r.z1 - 7, Math.PI, 0, true, fu.lv.floorTop + 3);
      fu.p('SPEAKER', cx + 6, r.z1 - 3, Math.PI, 0, true, fu.lv.floorTop + 3);
      fu.grid({ x0: r.x0 + 4, z0: r.z0 + 6, x1: r.x1 - 4, z1: r.z1 - 13 }, 9, 8, (x, z) => fu.tableSet('TABLE_SMALL', x, z, 3, 'CHAIR', 0, 1));
      fu.counter(r.x0 + 2, r.z0 + 3, r.x0 + 5, r.z0 + 3 + Math.min(20, d - 16), M.MAHOGANY, M.BRASS, 4, M.LED_GOLD);
      fu.p('BOTTLE_SHELF', r.x0 + 0.9, r.z0 + 10, FACE.fromLeft, 0, true);
      fu.mark('bar', r.x0 + 6.5, r.z0 + 10);
      fu.lights(r, 'PENDANT_LIGHT', 12);
      fu.ceiling('STAGE_LIGHTS', cx, r.z1 - 6, 5);
      fu.art(r, 3, ['WALL_ART', 'NEON_ART'], 8);
      break;
    }
    case 'bar': {
      fu.counter(r.x0 + 2, r.z0 + 4, r.x0 + 5, r.z1 - 4, M.WALNUT, M.MARBLE_BLACK, 4, M.LED_WARM);
      fu.p('BOTTLE_SHELF', r.x0 + 0.9, cz, FACE.fromLeft, 0, true);
      for (let z = r.z0 + 6; z < r.z1 - 5; z += 3) fu.p('BAR_STOOL', r.x0 + 7, z, -HALF_PI);
      fu.mark('bar', r.x0 + 6.5, cz);
      fu.grid({ x0: r.x0 + 12, z0: r.z0 + 4, x1: r.x1 - 3, z1: r.z1 - 3 }, 9, 8, (x, z) => fu.tableSet('TABLE_SMALL', x, z, 2, 'BAR_STOOL'));
      fu.againstWall(r, 'JUKEBOX', 'back', r.x1 - 5);
      fu.lights(r, 'PENDANT_LIGHT', 12);
      fu.art(r, 2, ['NEON_ART', 'WALL_ART'], 8);
      break;
    }
    case 'casino_floor': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.CARPET_RED);
      fu.grid({ x0: r.x0 + 5, z0: r.z0 + 6, x1: r.x1 - 5, z1: r.z1 - 8 }, 12, 9, (x, z, i, j) => {
        if ((i + j) % 3 === 0) fu.p('ROULETTE', x, z, HALF_PI);
        else fu.p('CASINO_TABLE', x, z, 0, i + j);
      });
      fu.lineWall(r, 'SLOT_MACHINE', 'left', 4, 3, (i) => i);
      fu.lineWall(r, 'SLOT_MACHINE', 'right', 4, 3, (i) => i + 3);
      fu.lights(r, 'CHANDELIER', 18);
      break;
    }
    case 'cashier': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.TERRAZZO_DARK);
      fu.counter(r.x0 + 2, r.z0 + 3, r.x1 - 2, r.z0 + 6, M.METAL_PANEL_DARK, M.GOLD, 5);
      fu.f.fill(r.x0 + 2, fu.lv.floorTop + 5, r.z0 + 4, r.x1 - 2, fu.lv.floorTop + 11, r.z0 + 5, M.GLASS);
      fu.againstWall(r, 'SAFE', 'back', cx - 4);
      fu.againstWall(r, 'SAFE', 'back', cx + 4);
      fu.againstWall(r, 'SERVER_RACK', 'right', cz + 3);
      fu.lights(r, 'CEILING_LIGHT', 14);
      fu.mark('vault', cx, r.z1 - 4);
      break;
    }
    case 'theatre_hall': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.CARPET_RED);
      fu.dais(r.x0 + 3, r.z1 - 12, r.x1 - 3, r.z1, 4, M.FLOOR_DARK, M.GOLD);
      fu.f.fill(r.x0 + 3, fu.lv.floorTop + 4, r.z1 - 2, r.x1 - 3, fu.lv.ceil - 1, r.z1 - 1, M.SCREEN);
      for (let z = r.z0 + 5; z < r.z1 - 15; z += 4)
        for (let x = r.x0 + 4; x < r.x1 - 6; x += 11) if (Math.abs(x + 5 - cx) > 3) fu.p('SEAT_ROW', x + 5, z, Math.PI);
      fu.ceiling('STAGE_LIGHTS', cx - 8, r.z1 - 14, 1);
      fu.ceiling('STAGE_LIGHTS', cx + 8, r.z1 - 14, 6);
      fu.lights(r, 'CHANDELIER', 22);
      break;
    }
    case 'foyer': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.MARBLE);
      fu.p('TICKET_BOOTH', r.x0 + 5, cz, HALF_PI);
      fu.p('BAR_COUNTER', r.x1 - 3, cz, -HALF_PI, 5);
      fu.p('PLANT_BIG', r.x0 + 3, r.z0 + 3, 0);
      fu.p('PLANT_BIG', r.x1 - 3, r.z0 + 3, 0);
      fu.lights(r, 'CHANDELIER', 16);
      fu.art(r, 3, ['WALL_ART'], 8);
      break;
    }
    case 'gym_floor': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.RUBBER);
      // ring au centre
      const rx0 = Math.round(cx - 10);
      const rz0 = Math.round(cz - 8);
      fu.dais(rx0, rz0, rx0 + 20, rz0 + 20, 3, M.CLOTH_WHITE, M.PAINT_RED);
      for (const [x, z] of [
        [rx0 + 0.5, rz0 + 0.5],
        [rx0 + 19.5, rz0 + 0.5],
        [rx0 + 0.5, rz0 + 19.5],
        [rx0 + 19.5, rz0 + 19.5],
      ])
        fu.p('RING_POST', x, z, 0, 0, true, fu.lv.floorTop + 3);
      fu.reserve(rx0 - 1, rz0 - 1, rx0 + 21, rz0 + 21);
      fu.lineWall(r, 'PUNCHING_BAG', 'left', 5, 3);
      fu.lineWall(r, 'WEIGHT_BENCH', 'right', 7, 3);
      fu.lights(r, 'NEON_TUBE_CEILING', 12, 7);
      fu.art(r, 2, ['WALL_ART'], 8);
      break;
    }
    // ------------------------------------------------------------------ commerces
    case 'store':
    case 'pharmacy':
    case 'herbal': {
      const goods = r.kind === 'herbal' ? GOODS_HERBS : r.kind === 'pharmacy' ? GOODS_PHARMA : GOODS_STORE;
      const frame = r.kind === 'herbal' ? M.WALNUT : M.STEEL;
      fu.shelves(r.x0, r.z0 + 3, r.x0 + 2, r.z1 - 3, 9, goods, frame);
      fu.shelves(r.x0 + 4, r.z1 - 2, r.x1 - 4, r.z1, 9, goods, frame);
      for (let x = r.x0 + 8; x < r.x1 - 8; x += 9) fu.p('STORE_SHELF', x, cz, HALF_PI);
      fu.p('CHECKOUT', r.x1 - 4, r.z0 + 5, -HALF_PI);
      fu.mark('counter', r.x1 - 7, r.z0 + 5);
      fu.lights(r, r.kind === 'herbal' ? 'LANTERN_RED' : 'CEILING_LIGHT', 12);
      break;
    }
    case 'diner': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.CHECKER);
      fu.counter(r.x0 + 3, r.z1 - 6, r.x1 - 6, r.z1 - 3, M.CHROME, M.STUCCO_RED, 4, M.LED_RED);
      for (let x = r.x0 + 5; x < r.x1 - 7; x += 3) fu.p('BAR_STOOL', x, r.z1 - 8, 0, 1);
      fu.grid({ x0: r.x0 + 4, z0: r.z0 + 4, x1: r.x1 - 4, z1: r.z1 - 11 }, 8, 7, (x, z) => fu.tableSet('TABLE_SMALL', x, z, 2, 'CHAIR', 0, 2));
      fu.againstWall(r, 'JUKEBOX', 'right', cz);
      fu.lights(r, 'PENDANT_LIGHT', 10);
      fu.mark('counter', cx, r.z1 - 8);
      break;
    }
    case 'kitchen': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.TILE_WHITE);
      fu.lineWall(r, 'KITCHEN_COUNTER', 'back', 10, 2);
      fu.againstWall(r, 'FRIDGE', 'left', cz);
      fu.p('KITCHEN_ISLAND', cx, cz, 0);
      fu.lights(r, 'CEILING_LIGHT', 10);
      break;
    }
    case 'teahouse': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.FLOOR_DARK);
      fu.grid({ x0: r.x0 + 4, z0: r.z0 + 4, x1: r.x1 - 4, z1: r.z1 - 4 }, 9, 9, (x, z, i, j) => {
        if ((i + j) % 2 === 0) fu.tableSet('TEA_TABLE', x, z, 4, 'CHAIR', 0, 3);
        else fu.p('PLANT_BIG', x, z, 0);
      });
      fu.lights(r, 'LANTERN_RED', 9);
      fu.art(r, 3, ['WALL_ART'], 8);
      fu.againstWall(r, 'AQUARIUM', 'back', cx);
      break;
    }
    case 'mahjong_hall': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.CARPET_RED);
      fu.grid({ x0: r.x0 + 4, z0: r.z0 + 4, x1: r.x1 - 4, z1: r.z1 - 4 }, 8, 8, (x, z) => fu.tableSet('MAHJONG_TABLE', x, z, 4, 'CHAIR', 0, 4));
      fu.lights(r, 'LANTERN_RED', 8);
      fu.mark('vault', r.x1 - 3, r.z1 - 3);
      break;
    }
    case 'tech_market': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.TILE_DARK);
      fu.grid({ x0: r.x0 + 4, z0: r.z0 + 5, x1: r.x1 - 4, z1: r.z1 - 4 }, 11, 8, (x, z, i, j) => fu.p('MARKET_STALL', x, z, j % 2 ? Math.PI : 0, i * 3 + j));
      fu.shelves(r.x0, r.z0 + 4, r.x0 + 2, r.z1 - 4, 8, GOODS_TECH, M.METAL_PANEL_DARK);
      fu.lights(r, 'NEON_TUBE_CEILING', 10, 1);
      break;
    }
    case 'clinic': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.LINOLEUM);
      fu.p('MEDICAL_BED', cx - 4, cz, 0);
      fu.p('SURGERY_ARM', cx - 4, cz - 4, 0);
      fu.p('MEDICAL_BED', cx + 5, cz, 0);
      fu.againstWall(r, 'SERVER_RACK', 'back', cx + 8);
      fu.lights(r, 'CEILING_LIGHT', 9);
      break;
    }
    case 'restaurant': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.PARQUET);
      fu.grid({ x0: r.x0 + 4, z0: r.z0 + 4, x1: r.x1 - 4, z1: r.z1 - 4 }, 10, 9, (x, z) => fu.tableSet('DINING_TABLE', x, z, 6, 'CHAIR', 0, 5));
      fu.lights(r, 'CHANDELIER', 16);
      fu.art(r, 3, ['WALL_ART'], 8);
      fu.mark('vault', r.x1 - 3, r.z1 - 3);
      break;
    }
    case 'boathouse': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.DECK_WOOD);
      fu.grid({ x0: r.x0 + 4, z0: r.z0 + 4, x1: r.x1 - 4, z1: r.z1 - 4 }, 8, 7, (x, z) => fu.tableSet('TABLE_SMALL', x, z, 3, 'CHAIR', 0, 1));
      fu.p('BAR_COUNTER', r.x1 - 2, cz, -HALF_PI, 4);
      fu.lights(r, 'PENDANT_LIGHT', 10);
      break;
    }
    case 'hotel_lobby': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.MARBLE);
      fu.p('RECEPTION_DESK', cx, r.z1 - 4, Math.PI);
      fu.p('SOFA_LUXE', r.x0 + 6, cz, HALF_PI, 4);
      fu.p('SOFA_LUXE', r.x1 - 6, cz, -HALF_PI, 4);
      fu.p('COFFEE_TABLE', r.x0 + 10, cz, HALF_PI);
      fu.p('LUGGAGE_CART', r.x1 - 4, r.z0 + 4, 0);
      fu.p('PLANT_BIG', r.x0 + 3, r.z0 + 3, 0);
      fu.p('PLANT_BIG', r.x1 - 3, r.z0 + 3, 0);
      fu.lights(r, 'CHANDELIER', 16);
      fu.art(r, 3, ['WALL_ART'], 9);
      break;
    }
    case 'suite': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.CARPET_BLUE);
      fu.againstWall(r, 'BED_KING', 'back', cx);
      fu.p('NIGHTSTAND', cx - 6, r.z1 - 2, Math.PI);
      fu.p('NIGHTSTAND', cx + 6, r.z1 - 2, Math.PI);
      fu.p('SOFA', cx, r.z0 + 4, 0, 4);
      fu.wall(r, 'TV_WALL', 'front', cx, 6);
      fu.lights(r, 'PENDANT_LIGHT', 12);
      break;
    }
    case 'gallery_hall': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.TERRAZZO);
      fu.grid({ x0: r.x0 + 6, z0: r.z0 + 6, x1: r.x1 - 6, z1: r.z1 - 6 }, 10, 10, (x, z, i, j) => fu.p((i + j) % 2 ? 'SCULPTURE' : 'ART_PEDESTAL', x, z, rng.range(0, 3), i + j));
      fu.art(r, 6, ['WALL_ART'], 8);
      fu.lights(r, 'CEILING_LIGHT', 12);
      fu.mark('vault', cx, r.z1 - 3);
      break;
    }
    case 'bank_hall': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.MARBLE_GREEN);
      fu.counter(r.x0 + 4, r.z1 - 9, r.x1 - 4, r.z1 - 6, M.MARBLE, M.BRASS, 5);
      fu.f.fill(r.x0 + 4, fu.lv.floorTop + 5, r.z1 - 8, r.x1 - 4, fu.lv.floorTop + 10, r.z1 - 7, M.GLASS);
      for (let x = r.x0 + 6; x < r.x1 - 6; x += 7) fu.p('OFFICE_CHAIR', x, r.z1 - 4, Math.PI);
      fu.p('PLANT_BIG', r.x0 + 3, r.z0 + 3, 0);
      fu.p('PLANT_BIG', r.x1 - 3, r.z0 + 3, 0);
      for (const x of [cx - w / 4, cx + w / 4]) fu.column(x, cz - 3, 3, M.MARBLE, M.GOLD);
      fu.lights(r, 'CHANDELIER', 16);
      break;
    }
    case 'vault': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.METAL_PANEL_DARK);
      fu.againstWall(r, 'VAULT_DOOR', 'front', cx);
      fu.lineWall(r, 'SAFE', 'left', 4, 2);
      fu.lineWall(r, 'SAFE', 'right', 4, 2);
      fu.lights(r, 'CEILING_LIGHT', 10);
      fu.mark('vault', cx, cz + 2);
      break;
    }
    case 'trading_floor': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.CARPET_BLUE);
      fu.f.fill(r.x0 + 2, fu.lv.ceil - 5, r.z1 - 1, r.x1 - 2, fu.lv.ceil - 2, r.z1, M.SCREEN_TICKER);
      fu.grid({ x0: r.x0 + 5, z0: r.z0 + 5, x1: r.x1 - 5, z1: r.z1 - 6 }, 9, 6, (x, z) => {
        fu.p('TRADING_DESK', x, z, 0);
        fu.p('OFFICE_CHAIR', x, z + 3, Math.PI);
      });
      fu.lights(r, 'CEILING_LIGHT', 12);
      break;
    }
    case 'office': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.CARPET_GREY);
      fu.grid({ x0: r.x0 + 4, z0: r.z0 + 4, x1: r.x1 - 4, z1: r.z1 - 4 }, 12, 10, (x, z) => {
        fu.p('DESK', x, z, 0);
        fu.p('COMPUTER', x, z - 0.6, Math.PI, 0, true, fu.lv.floorTop + 3);
        fu.p('OFFICE_CHAIR', x, z + 3, Math.PI);
      });
      fu.lineWall(r, 'FILING_CABINET', 'left', 3, 3);
      fu.lights(r, 'CEILING_LIGHT', 10);
      break;
    }
    case 'exec_office': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.FLOOR_WALNUT);
      fu.p('DESK_BOSS', cx, r.z1 - 5, Math.PI);
      fu.p('BOSS_CHAIR', cx, r.z1 - 2.5, Math.PI);
      fu.p('SOFA_LUXE', cx, r.z0 + 4, 0, 4);
      fu.p('COFFEE_TABLE', cx, r.z0 + 8, 0);
      fu.againstWall(r, 'BOOKSHELF', 'left', cz);
      fu.againstWall(r, 'SAFE', 'right', cz);
      fu.wall(r, 'SCREEN_WALL', 'back', cx + 8, 3);
      fu.lights(r, 'PENDANT_LIGHT', 12);
      fu.mark('vault', r.x1 - 3, cz);
      break;
    }
    case 'security_room': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.HEX_PANEL);
      fu.wall(r, 'SCREEN_WALL', 'back', cx - 6, 3);
      fu.wall(r, 'SCREEN_WALL', 'back', cx + 6, 3);
      fu.p('COMMAND_DESK', cx, r.z1 - 5, Math.PI, 0);
      fu.p('OFFICE_CHAIR', cx - 3, r.z1 - 8, Math.PI);
      fu.p('OFFICE_CHAIR', cx + 3, r.z1 - 8, Math.PI);
      fu.lineWall(r, 'SERVER_RACK', 'left', 3, 3);
      fu.lights(r, 'CEILING_LIGHT', 12);
      fu.mark('vault', cx, cz);
      break;
    }
    case 'server_room': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.HEX_PANEL);
      for (let x = r.x0 + 3; x < r.x1 - 3; x += 7) for (let z = r.z0 + 3; z < r.z1 - 3; z += 5) fu.p('SERVER_RACK', x, z, HALF_PI);
      fu.lights(r, 'NEON_TUBE_CEILING', 8, 1);
      break;
    }
    case 'studio_set': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.TERRAZZO_DARK);
      fu.f.fill(r.x0 + 3, fu.lv.floorTop + 1, r.z1 - 1, r.x1 - 3, fu.lv.ceil - 2, r.z1, M.SCREEN);
      fu.p('NEWS_DESK', cx, r.z1 - 7, Math.PI);
      fu.p('HOLO_CAMERA', cx - 6, cz, 0);
      fu.p('HOLO_CAMERA', cx + 6, cz, 0);
      fu.p('STUDIO_LIGHT', r.x0 + 4, cz - 4, 0.6);
      fu.p('STUDIO_LIGHT', r.x1 - 4, cz - 4, -0.6);
      fu.lights(r, 'STAGE_LIGHTS', 12, 7);
      break;
    }
    case 'control_room': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.CARPET_GREY);
      fu.wall(r, 'SCREEN_WALL', 'back', cx, 3);
      fu.lineWall(r, 'COMMAND_DESK', 'left', 11, 3, () => 0);
      fu.lineWall(r, 'SERVER_RACK', 'right', 3, 3);
      fu.lights(r, 'CEILING_LIGHT', 10);
      fu.mark('vault', cx, cz);
      break;
    }
    case 'station_hall': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.MARBLE);
      fu.f.fill(r.x0 + 4, fu.lv.ceil - 6, r.z1 - 1, r.x1 - 4, fu.lv.ceil - 2, r.z1, M.SCREEN_TICKER);
      // kiosque central (l'horloge de Grand Central est dessinée par le client)
      fu.cylinder(cx, cz, 3, fu.lv.floorTop, fu.lv.floorTop + 5, M.BRASS);
      fu.cylinder(cx, cz, 2.2, fu.lv.floorTop + 5, fu.lv.floorTop + 9, M.MARBLE);
      fu.reserve(cx - 4, cz - 4, cx + 4, cz + 4);
      for (const z of [r.z0 + 6, r.z1 - 8]) for (let x = r.x0 + 6; x < r.x1 - 6; x += 9) if (Math.abs(x - cx) > 6) fu.p('BENCH', x, z, 0);
      fu.lineWall(r, 'TICKET_BOOTH', 'left', 7, 4);
      fu.lights(r, 'CHANDELIER', 16);
      break;
    }
    case 'showroom': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.TERRAZZO_DARK);
      fu.p('CAR_PARKED', cx - w / 4, cz, 0.4, variant);
      fu.p('CAR_PARKED', cx + w / 4, cz, -0.4, variant + 2);
      fu.p('RECEPTION_DESK', cx, r.z1 - 3, Math.PI);
      fu.lights(r, 'CEILING_LIGHT', 10);
      break;
    }
    // ------------------------------------------------------------------ industrie, logistique
    case 'depot_floor': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.CONCRETE);
      fu.lineWall(r, 'SHELF_RACK', 'left', 12, 3);
      fu.lineWall(r, 'SHELF_RACK', 'right', 12, 3);
      fu.grid({ x0: r.x0 + 9, z0: r.z0 + 6, x1: r.x1 - 9, z1: r.z1 - 6 }, 10, 12, (x, z, i, j) => fu.p((i + j) % 3 === 0 ? 'FORKLIFT' : 'PALLET_STACK', x, z, rng.range(0, 3)));
      fu.lights(r, 'NEON_TUBE_CEILING', 12, 7);
      break;
    }
    case 'garage_floor': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.CONCRETE_DARK);
      fu.p('CAR_LIFT', cx - 5, cz, 0, 0, true);
      fu.p('CAR_PARKED', cx + 6, cz, 0.15, variant + 1);
      fu.lineWall(r, 'TIRE_STACK', 'left', 3, 3);
      fu.againstWall(r, 'WORKBENCH', 'back', cx + 4);
      fu.wall(r, 'TOOL_WALL', 'back', cx - 6, 4);
      fu.lights(r, 'NEON_TUBE_CEILING', 10, 7);
      break;
    }
    case 'factory_floor': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.CONCRETE);
      for (let z = r.z0 + 5; z < r.z1 - 4; z += 8) {
        for (let x = r.x0 + 6; x < r.x1 - 6; x += 13) fu.p('CONVEYOR', x, z, 0);
        fu.p('ROBOT_ARM', r.x0 + 4, z + 3, HALF_PI);
      }
      fu.grid({ x0: r.x0 + 4, z0: r.z1 - 6, x1: r.x1 - 4, z1: r.z1 - 2 }, 5, 4, (x, z) => fu.p('DRONE_PARKED', x, z, 0, 0, true));
      fu.lights(r, 'NEON_TUBE_CEILING', 10, 1);
      break;
    }
    case 'brewhouse': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.TILE_GREEN);
      fu.grid({ x0: r.x0 + 4, z0: r.z0 + 4, x1: r.x1 - 4, z1: r.z1 - 6 }, 8, 9, (x, z) => fu.p('BREW_TANK', x, z, 0));
      fu.lineWall(r, 'BARREL', 'back', 3, 2);
      fu.lights(r, 'BARE_BULB', 8);
      break;
    }
    case 'junk_yard': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.GRAVEL);
      fu.grid({ x0: r.x0 + 4, z0: r.z0 + 4, x1: r.x1 - 4, z1: r.z1 - 4 }, 9, 7, (x, z, i, j) => fu.p((i + j) % 2 ? 'TIRE_STACK' : 'CAR_PARKED', x, z, rng.range(0, 3), 7));
      fu.lights(r, 'BARE_BULB', 10);
      break;
    }
    case 'market_hall': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.CONCRETE_DARK);
      fu.grid({ x0: r.x0 + 4, z0: r.z0 + 4, x1: r.x1 - 4, z1: r.z1 - 4 }, 8, 7, (x, z, i, j) => fu.p((i + j) % 2 ? 'FOOD_STALL' : 'MARKET_STALL', x, z, j % 2 ? Math.PI : 0, i + j * 3));
      fu.lights(r, 'LANTERN_STRING', 9);
      break;
    }
    case 'tattoo': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.TILE_DARK);
      fu.p('TATTOO_CHAIR', cx - 4, cz, 0);
      fu.p('TATTOO_CHAIR', cx + 4, cz, 0);
      fu.againstWall(r, 'SOFA_OLD', 'front', cx);
      fu.art(r, 4, ['NEON_ART', 'WALL_ART'], 8);
      fu.lights(r, 'PENDANT_LIGHT', 9);
      break;
    }
    case 'storeroom': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.CONCRETE);
      fu.lineWall(r, 'CRATE_STACK', 'back', 4, 2);
      fu.lineWall(r, 'CARDBOARD_BOXES', 'left', 3, 2);
      fu.lights(r, 'BARE_BULB', 9);
      break;
    }
    case 'laundromat': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.LINOLEUM);
      fu.lineWall(r, 'WASHER_ROW', 'back', 10, 2);
      fu.lineWall(r, 'WASHER_ROW', 'left', 10, 3);
      fu.p('BENCH', cx, cz, 0);
      fu.p('VENDING_MACHINE', r.x1 - 3, r.z1 - 3, Math.PI, 2);
      fu.lights(r, 'NEON_TUBE_CEILING', 9, 7);
      break;
    }
    case 'apartment': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.FLOOR_WORN);
      fu.p('SOFA_OLD', cx, cz + 3, Math.PI, 1);
      fu.p('TV_OLD', cx, r.z0 + 2, 0);
      fu.againstWall(r, 'KITCHENETTE', 'back', r.x0 + 6);
      fu.p('BED', r.x1 - 5, r.z1 - 6, Math.PI);
      fu.lights(r, 'BARE_BULB', 10);
      break;
    }
    // ------------------------------------------------------------------ police
    case 'police_front': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.LINOLEUM);
      fu.p('POLICE_DESK', cx, cz + 2, Math.PI);
      fu.lineWall(r, 'BENCH', 'left', 7, 3);
      fu.lights(r, 'CEILING_LIGHT', 10);
      break;
    }
    case 'cells': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.CONCRETE);
      for (let x = r.x0 + 4; x < r.x1 - 2; x += 8) fu.p('CELL_BARS', x, cz, 0, 0, true);
      fu.lineWall(r, 'BUNK_BED', 'back', 8, 2);
      fu.lights(r, 'NEON_TUBE_CEILING', 9, 7);
      break;
    }
    case 'lobby': {
      fu.floor(r.x0, r.z0, r.x1, r.z1, M.TERRAZZO_DARK);
      fu.p('RECEPTION_DESK', cx, cz + 2, Math.PI);
      fu.p('PLANT_BIG', r.x0 + 3, r.z0 + 3, 0);
      fu.p('PLANT_BIG', r.x1 - 3, r.z0 + 3, 0);
      fu.p('SOFA', r.x0 + 5, cz, HALF_PI, 4);
      fu.lights(r, 'CEILING_LIGHT', 10);
      fu.art(r, 2, ['WALL_ART'], 9);
      break;
    }
    default: {
      fu.lights(r, 'CEILING_LIGHT', 12);
      void bv;
    }
  }
}
