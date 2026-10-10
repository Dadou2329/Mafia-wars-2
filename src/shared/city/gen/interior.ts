// Distribution intérieure : pièces, cloisons, portes intérieures et finitions.

import { M } from '../../materials';
import type { Frame } from './frame';
import { finishInteriorWalls, type Levels } from './shell';

export type RoomKind =
  | 'bar'
  | 'parlour'
  | 'storeroom'
  | 'office'
  | 'armory'
  | 'shop'
  | 'backroom'
  | 'gaming'
  | 'cashier'
  | 'foyer'
  | 'auditorium'
  | 'cafe'
  | 'kitchen'
  | 'banking_hall'
  | 'vault'
  | 'manager'
  | 'trading_floor'
  | 'clerks'
  | 'director'
  | 'archive'
  | 'post_hall'
  | 'sorting'
  | 'nave'
  | 'common'
  | 'dormitory'
  | 'living'
  | 'bedroom'
  | 'scullery'
  | 'workshop'
  | 'stock'
  | 'police_front'
  | 'cells'
  | 'police_office'
  | 'salon'
  | 'dining'
  | 'library'
  | 'lounge'
  | 'reading'
  | 'clock_hall'
  | 'foundry_floor'
  | 'foreman'
  | 'brewhouse'
  | 'cellar'
  | 'mill_floor'
  | 'pump_room'
  | 'warehouse_floor'
  | 'customs_hall'
  | 'seized'
  | 'shed';

export interface Room {
  kind: RoomKind;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Porte d'accès (local) : centre lx, lz et côté de la cloison. */
  doorX?: number;
  doorZ?: number;
  front: boolean;
}

export interface Finish {
  floor: number;
  wall: number;
  wainscot: number | 0;
  ceiling?: number;
}

export interface LayoutSpec {
  front: RoomKind;
  /** Profondeur de la pièce de devant (fraction de la profondeur intérieure). 1 = pièce unique. */
  depth: number;
  back?: { kind: RoomKind; w: number }[];
}

const even = (v: number): number => (v & 1 ? v + 1 : v);

/**
 * Découpe l'intérieur (voxels locaux [2, W-2) × [2, D-2)) selon le gabarit, construit
 * les cloisons (2 voxels) et perce les passages. `doorLx` = centre de la porte d'entrée.
 */
export function layoutRooms(f: Frame, lv: Levels, spec: LayoutSpec, wallMat: number, doorLx: number): Room[] {
  const ix0 = 2;
  const iz0 = 2;
  const ix1 = f.W - 2;
  const iz1 = f.D - 2;
  const rooms: Room[] = [];
  if (spec.depth >= 0.999 || !spec.back || spec.back.length === 0) {
    rooms.push({ kind: spec.front, x0: ix0, z0: iz0, x1: ix1, z1: iz1, front: true });
    return rooms;
  }
  const zs = even(iz0 + Math.round((iz1 - iz0) * spec.depth));
  rooms.push({ kind: spec.front, x0: ix0, z0: iz0, x1: ix1, z1: zs, front: true });
  // cloison transversale
  f.fill(ix0, lv.floorTop, zs, ix1, lv.ceil, zs + 2, wallMat);
  // pièces du fond
  const totalW = spec.back.reduce((s, r) => s + r.w, 0);
  let x = ix0;
  for (let i = 0; i < spec.back.length; i++) {
    const r = spec.back[i];
    const last = i === spec.back.length - 1;
    const x1 = last ? ix1 : even(x + Math.round(((ix1 - ix0) * r.w) / totalW) - 1);
    const room: Room = { kind: r.kind, x0: x, z0: zs + 2, x1, z1: iz1, front: false };
    // passage vers la pièce de devant
    const dw = 4;
    let dx = Math.round((room.x0 + room.x1) / 2 - dw / 2);
    // on évite d'aligner le passage avec la porte d'entrée si la pièce est assez large
    dx = Math.max(room.x0 + 1, Math.min(room.x1 - dw - 1, dx));
    f.fill(dx, lv.floorTop, zs, dx + dw, lv.floorTop + 9, zs + 2, 0);
    // encadrement
    f.fill(dx - 1, lv.floorTop, zs - 1, dx, lv.floorTop + 10, zs, M.WALNUT);
    f.fill(dx + dw, lv.floorTop, zs - 1, dx + dw + 1, lv.floorTop + 10, zs, M.WALNUT);
    f.fill(dx - 1, lv.floorTop + 9, zs - 1, dx + dw + 1, lv.floorTop + 10, zs, M.WALNUT);
    room.doorX = dx + dw / 2;
    room.doorZ = zs + 1;
    rooms.push(room);
    if (!last) {
      f.fill(x1, lv.floorTop, zs + 2, x1 + 2, lv.ceil, iz1, wallMat);
      x = x1 + 2;
    }
  }
  void doorLx;
  return rooms;
}

/** Applique sol, murs et plafond d'une pièce. */
export function finishRoom(f: Frame, lv: Levels, r: Room, fin: Finish): void {
  f.fill(r.x0, lv.floorTop - 1, r.z0, r.x1, lv.floorTop, r.z1, fin.floor);
  finishInteriorWalls(f, lv, r.x0, r.z0, r.x1, r.z1, fin.wall, fin.wainscot);
  if (fin.ceiling) f.fill(r.x0, lv.ceil, r.z0, r.x1, lv.ceil + 1, r.z1, fin.ceiling);
  // moulure de plafond (corniche intérieure)
  const y = lv.ceil - 1;
  const trim = fin.wainscot === M.PANEL_DARK ? M.WALNUT : M.PLASTER;
  for (let lx = r.x0; lx < r.x1; lx++) {
    if (f.get(lx, y, r.z0) === 0) f.set(lx, y, r.z0, trim);
    if (f.get(lx, y, r.z1 - 1) === 0) f.set(lx, y, r.z1 - 1, trim);
  }
  for (let lz = r.z0; lz < r.z1; lz++) {
    if (f.get(r.x0, y, lz) === 0) f.set(r.x0, y, lz, trim);
    if (f.get(r.x1 - 1, y, lz) === 0) f.set(r.x1 - 1, y, lz, trim);
  }
}

/** Cheminée d'intérieur contre le mur indiqué de la pièce. Renvoie la position du foyer. */
export function fireplace(
  f: Frame,
  lv: Levels,
  r: Room,
  wall: 'left' | 'right' | 'back' | 'front',
  mantel: number,
  at?: number,
): { lx: number; lz: number } {
  const y0 = lv.floorTop;
  const w = 8;
  const dep = 2;
  let fx = 0;
  let fz = 0;
  const put = (a0: number, ly0: number, d0: number, a1: number, ly1: number, d1: number, m: number) => {
    // a = le long du mur, d = profondeur depuis le mur vers la pièce
    if (wall === 'back') f.fill(a0, ly0, r.z1 - d1, a1, ly1, r.z1 - d0, m);
    else if (wall === 'front') f.fill(a0, ly0, r.z0 + d0, a1, ly1, r.z0 + d1, m);
    else if (wall === 'left') f.fill(r.x0 + d0, ly0, a0, r.x0 + d1, ly1, a1, m);
    else f.fill(r.x1 - d1, ly0, a0, r.x1 - d0, ly1, a1, m);
  };
  const along0 =
    wall === 'back' || wall === 'front'
      ? Math.round(at ?? (r.x0 + r.x1) / 2 - w / 2)
      : Math.round(at ?? (r.z0 + r.z1) / 2 - w / 2);
  const a0 = along0;
  const a1 = along0 + w;
  // manteau
  put(a0, y0, 0, a1, y0 + 5, dep, mantel);
  put(a0 - 1, y0 + 5, 0, a1 + 1, y0 + 6, dep + 1, mantel);
  // foyer
  put(a0 + 2, y0, 0, a1 - 2, y0 + 3, dep, M.FIREBRICK);
  put(a0 + 2, y0, 1, a1 - 2, y0 + 3, dep, 0);
  put(a0 + 3, y0, 1, a1 - 3, y0 + 1, dep - 0, M.FIRE);
  put(a0 + 2, y0, dep, a1 - 2, y0 + 1, dep + 1, M.STONE_GREY);
  // hotte jusqu'au plafond
  put(a0 + 1, y0 + 6, 0, a1 - 1, lv.ceil, 1, mantel === M.MARBLE ? M.PLASTER : mantel);
  const mid = (a0 + a1) / 2;
  if (wall === 'back') {
    fx = mid;
    fz = r.z1 - 1.5;
  } else if (wall === 'front') {
    fx = mid;
    fz = r.z0 + 1.5;
  } else if (wall === 'left') {
    fx = r.x0 + 1.5;
    fz = mid;
  } else {
    fx = r.x1 - 1.5;
    fz = mid;
  }
  f.light(fx, y0 + 1.2, fz, 0.75, 6);
  return { lx: fx, lz: fz };
}
