// Monuments : église, tour de l'Horloge, gazomètre.

import { M } from '../../materials';
import { Rng } from '../../util';
import { VOXEL } from '../../voxel';
import type { BuildingDef } from '../plan';
import type { BuildingInfo, GenContext, Pt } from './context';
import { Frame } from './frame';
import { Furnisher, furnishRoom } from './furnish';
import { finishRoom, type Room } from './interior';
import { type Levels } from './shell';

function freePoints(f: Frame, lv: Levels, r: Room, step = 5): Pt[] {
  const pts: Pt[] = [];
  for (let lx = r.x0 + 3; lx < r.x1 - 2; lx += step)
    for (let lz = r.z0 + 3; lz < r.z1 - 2; lz += step) {
      let ok = true;
      for (let dx = -1; dx <= 1 && ok; dx++)
        for (let dz = -1; dz <= 1 && ok; dz++) if (f.get(lx + dx, lv.floorTop, lz + dz) !== 0) ok = false;
      if (ok) pts.push(f.pt(lx + 0.5, lz + 0.5));
    }
  return pts;
}

function baseInfo(ctx: GenContext, def: BuildingDef, f: Frame, lv: Levels, rooms: Room[], doorC: number, doorW: number, top: number): BuildingInfo {
  const doorPt = f.pt(doorC, 0);
  const info: BuildingInfo = {
    id: def.id,
    def,
    footprint: [def.rect[0], def.rect[1], def.rect[2], def.rect[3]],
    floorY: lv.floorTop * VOXEL,
    doors: [{ x: doorPt.x, z: doorPt.z, side: def.door, out: f.pt(doorC, -10), in: f.pt(doorC, 10), width: doorW * VOXEL, main: true }],
    rooms: rooms.map((r) => ({ kind: r.kind, rect: f.rectM(r.x0, r.z0, r.x1, r.z1) })),
    zone: rooms.map((r) => f.rectM(r.x0, r.z0, r.x1, r.z1)),
    center: f.pt((rooms[0].x0 + rooms[0].x1) / 2, (rooms[0].z0 + rooms[0].z1) / 2),
    defend: rooms.flatMap((r) => freePoints(f, lv, r)),
    guardOut: [f.pt(doorC - 7, -8), f.pt(doorC + 7, -8)],
    spawn: [],
    height: top * VOXEL,
  };
  ctx.buildings.push(info);
  return info;
}

/** Église de Whitechapel : nef haute, portique et clocher à flèche. */
export function buildChurch(ctx: GenContext, def: BuildingDef, rng: Rng): BuildingInfo {
  const f = new Frame(ctx, def.rect, def.door, def.id);
  const { W, D } = f;
  const stone = M.CHURCH_STONE;
  const floorTop = 1;
  const ceil = 36;
  const lv: Levels = { floorTop, ceil, storyBase: [floorTop], wallTop: ceil + 2 };
  f.fill(0, 0, 0, W, floorTop, D, M.STONE_GREY);
  f.fill(2, 0, 2, W - 2, floorTop, D - 2, M.FLOOR_FLAG);
  // murs
  f.fill(0, floorTop, 0, W, ceil + 2, 2, stone);
  f.fill(0, floorTop, D - 2, W, ceil + 2, D, stone);
  f.fill(0, floorTop, 0, 2, ceil + 2, D, stone);
  f.fill(W - 2, floorTop, 0, W, ceil + 2, D, stone);
  f.fill(2, ceil, 2, W - 2, ceil + 1, D - 2, M.CEILING);
  f.fill(2, ceil + 1, 2, W - 2, ceil + 2, D - 2, M.PLASTER);
  // contreforts et grandes fenêtres cintrées en vitrail sur les côtés
  for (let lz = 8; lz < D - 8; lz += 14) {
    for (const lx of [0, W - 2]) {
      const out = lx === 0 ? -1 : W;
      f.fill(out, floorTop, lz - 1, out + 1, ceil - 4, lz + 1, stone);
      f.fill(lx, floorTop + 8, lz + 4, lx + 2, floorTop + 26, lz + 9, 0);
      f.fill(lx === 0 ? 1 : W - 2, floorTop + 8, lz + 4, lx === 0 ? 2 : W - 1, floorTop + 26, lz + 9, M.GLASS_STAINED);
      f.fill(lx === 0 ? 1 : W - 2, floorTop + 26, lz + 5, lx === 0 ? 2 : W - 1, floorTop + 28, lz + 8, M.GLASS_STAINED);
    }
  }
  // grande rose au chevet
  for (let a = -6; a <= 6; a++)
    for (let b = -6; b <= 6; b++) {
      if (a * a + b * b <= 36) {
        f.set(Math.floor(W / 2) + a, floorTop + 22 + b, D - 1, 0);
        f.set(Math.floor(W / 2) + a, floorTop + 22 + b, D - 2, M.GLASS_STAINED);
      }
    }
  // corniche
  f.fill(-1, ceil + 2, -1, W + 1, ceil + 3, D + 1, M.STONE);
  // toit à deux pans (faîtage perpendiculaire à la façade)
  for (let lx = -1; lx <= W; lx++) {
    const h = Math.min(18, Math.min(lx + 2, W + 1 - lx));
    for (let lz = -1; lz <= D; lz++) {
      for (let k = 0; k < h; k++) {
        const surface = k >= h - 2;
        f.set(lx, ceil + 3 + k, lz, lz <= 0 || lz >= D - 1 ? (surface ? M.SLATE : stone) : surface ? M.SLATE : M.PLASTER_DIRTY);
      }
    }
  }
  // clocher en façade
  const tw = 24;
  const tx0 = Math.floor(W / 2 - tw / 2);
  const tz0 = -8;
  const tz1 = 16;
  const towerTop = 104;
  f.fill(tx0, 0, tz0, tx0 + tw, floorTop, tz1, M.STONE_GREY);
  f.fill(tx0, floorTop, tz0, tx0 + tw, towerTop, tz1, stone);
  // vestibule creux dans la base du clocher
  f.fill(tx0 + 2, floorTop, tz0 + 2, tx0 + tw - 2, floorTop + 18, tz1, 0);
  f.fill(tx0 + 2, 0, tz0 + 2, tx0 + tw - 2, floorTop, tz1, M.FLOOR_FLAG);
  // porte cintrée
  const dw = 8;
  const dx0 = Math.floor(W / 2 - dw / 2);
  f.fill(dx0, floorTop, tz0, dx0 + dw, floorTop + 14, tz0 + 2, 0);
  f.fill(dx0 + 1, floorTop + 14, tz0, dx0 + dw - 1, floorTop + 15, tz0 + 2, 0);
  f.fill(dx0 - 1, floorTop, tz0 - 1, dx0, floorTop + 16, tz0, M.STONE);
  f.fill(dx0 + dw, floorTop, tz0 - 1, dx0 + dw + 1, floorTop + 16, tz0, M.STONE);
  f.fill(dx0 - 1, floorTop + 16, tz0 - 1, dx0 + dw + 1, floorTop + 17, tz0, M.STONE);
  // ouverture du vestibule vers la nef
  f.fill(dx0, floorTop, 0, dx0 + dw, floorTop + 14, 2, 0);
  // étages du clocher : bandeaux, abat-sons, horloges
  for (let y = 40; y < towerTop; y += 22) f.fill(tx0 - 1, y, tz0 - 1, tx0 + tw + 1, y + 1, tz1 + 1, M.STONE);
  for (const side of [0, 1, 2]) {
    // abat-sons du beffroi (3 faces visibles)
    const y0 = 76;
    if (side === 0) for (let x = tx0 + 6; x < tx0 + tw - 6; x += 2) f.fill(x, y0, tz0, x + 1, y0 + 14, tz0 + 1, M.FRAME_DARK);
    if (side === 1) for (let z = tz0 + 6; z < tz1 - 6; z += 2) f.fill(tx0, y0, z, tx0 + 1, y0 + 14, z + 1, M.FRAME_DARK);
    if (side === 2) for (let z = tz0 + 6; z < tz1 - 6; z += 2) f.fill(tx0 + tw - 1, y0, z, tx0 + tw, y0 + 14, z + 1, M.FRAME_DARK);
  }
  // cadran d'horloge
  const cy = 58;
  const ccx = tx0 + tw / 2;
  for (let a = -5; a <= 5; a++)
    for (let b = -5; b <= 5; b++) if (a * a + b * b <= 26) f.set(Math.floor(ccx + a), cy + b, tz0 - 1, a * a + b * b > 18 ? M.GOLD : M.STUCCO_WHITE);
  f.fill(Math.floor(ccx), cy, tz0 - 2, Math.floor(ccx) + 1, cy + 4, tz0 - 1, M.IRON);
  f.fill(Math.floor(ccx), cy, tz0 - 2, Math.floor(ccx) + 3, cy + 1, tz0 - 1, M.IRON);
  // flèche
  for (let k = 0; k < 52; k++) {
    const inset = Math.floor(k / 4);
    if (inset * 2 >= tw - 2) break;
    f.fill(tx0 + 1 + inset, towerTop + k, tz0 + 1 + inset, tx0 + tw - 1 - inset, towerTop + k + 1, tz1 - 1 - inset, k < 2 ? M.STONE : M.LEAD);
  }
  f.fill(Math.floor(ccx), towerTop + 44, Math.floor((tz0 + tz1) / 2), Math.floor(ccx) + 1, towerTop + 56, Math.floor((tz0 + tz1) / 2) + 1, M.GOLD);
  // intérieur
  const nave: Room = { kind: 'nave', x0: 2, z0: 2, x1: W - 2, z1: D - 2, front: true };
  finishRoom(f, lv, nave, { floor: M.FLOOR_FLAG, wall: M.STUCCO, wainscot: M.PANEL_DARK });
  f.fill(dx0, floorTop, 0, dx0 + dw, floorTop + 14, 2, 0);
  // colonnades intérieures
  const fu = new Furnisher(f, lv, rng);
  for (let lz = 10; lz < D - 12; lz += 14) {
    fu.column(Math.floor(W / 2) - 16, lz, 2, M.STUCCO_WHITE, M.GOLD);
    fu.column(Math.floor(W / 2) + 16, lz, 2, M.STUCCO_WHITE, M.GOLD);
  }
  furnishRoom(fu, nave, 'church', 0);
  f.prop('LAMP_WALL', dx0 - 2.5, floorTop + 10, tz0 - 1.1, Math.PI);
  f.prop('LAMP_WALL', dx0 + dw + 2.5, floorTop + 10, tz0 - 1.1, Math.PI);
  f.prop('DOOR_LEAF', dx0 + dw / 2, floorTop, tz0 + 1.5, 0, 0, 1.3);
  const info = baseInfo(ctx, def, f, lv, [nave], dx0 + dw / 2, dw, towerTop + 56);
  info.doors[0].out = f.pt(dx0 + dw / 2, tz0 - 6);
  info.doors[0].x = f.pt(dx0 + dw / 2, tz0).x;
  info.doors[0].z = f.pt(dx0 + dw / 2, tz0).z;
  return info;
}

/** Tour de l'Horloge (Westminster). */
export function buildClockTower(ctx: GenContext, def: BuildingDef, rng: Rng): BuildingInfo {
  const f = new Frame(ctx, def.rect, def.door, def.id);
  const { W, D } = f;
  const stone = M.STONE;
  const floorTop = 3;
  const ceil = 18;
  const lv: Levels = { floorTop, ceil, storyBase: [floorTop], wallTop: 120 };
  const shaftTop = 112;
  f.fill(-2, 0, -2, W + 2, floorTop, D + 2, M.STONE_GREY);
  f.fill(0, floorTop, 0, W, shaftTop, D, stone);
  // nervures gothiques verticales
  for (let lx = 2; lx < W - 1; lx += 4) {
    f.fill(lx, floorTop + 18, -1, lx + 1, shaftTop - 4, 0, M.STONE_GREY);
    f.fill(lx, floorTop + 18, D, lx + 1, shaftTop - 4, D + 1, M.STONE_GREY);
  }
  for (let lz = 2; lz < D - 1; lz += 4) {
    f.fill(-1, floorTop + 18, lz, 0, shaftTop - 4, lz + 1, M.STONE_GREY);
    f.fill(W, floorTop + 18, lz, W + 1, shaftTop - 4, lz + 1, M.STONE_GREY);
  }
  // étroites fenêtres du fût
  for (let y = floorTop + 24; y < shaftTop - 20; y += 12) {
    f.fill(W / 2 - 1, y, 0, W / 2 + 1, y + 7, 1, 0);
    f.fill(W / 2 - 1, y, 1, W / 2 + 1, y + 7, 2, rng.chance(0.5) ? M.GLASS_LIT : M.GLASS);
  }
  // salle du bas
  f.fill(2, floorTop, 2, W - 2, ceil, D - 2, 0);
  f.fill(2, floorTop - 1, 2, W - 2, floorTop, D - 2, M.FLOOR_FLAG);
  f.fill(2, ceil, 2, W - 2, ceil + 2, D - 2, M.CEILING);
  const dw = 6;
  const dx0 = Math.floor(W / 2 - dw / 2);
  f.fill(dx0, floorTop, 0, dx0 + dw, floorTop + 11, 2, 0);
  f.fill(dx0 - 1, floorTop + 11, -1, dx0 + dw + 1, floorTop + 13, 0, M.GOLD);
  // marches
  f.fill(dx0 - 1, 0, -4, dx0 + dw + 1, 1, -2, M.STONE_GREY);
  f.fill(dx0 - 1, 0, -3, dx0 + dw + 1, 2, -2, M.STONE_GREY);
  f.fill(dx0 - 1, 0, -2, dx0 + dw + 1, 3, 0, M.STONE_GREY);
  // étage des cadrans (débord)
  const cy0 = shaftTop;
  f.fill(-2, cy0, -2, W + 2, cy0 + 22, D + 2, stone);
  f.fill(-3, cy0, -3, W + 3, cy0 + 1, D + 3, M.GOLD);
  f.fill(-3, cy0 + 22, -3, W + 3, cy0 + 23, D + 3, M.GOLD);
  const cc = W / 2;
  const cyc = cy0 + 11;
  for (let a = -9; a <= 9; a++)
    for (let b = -9; b <= 9; b++) {
      const r2 = a * a + b * b;
      if (r2 > 82) continue;
      const m = r2 > 64 ? M.GOLD : M.GLASS_LIT;
      f.set(Math.floor(cc + a), cyc + b, -3, m);
      f.set(Math.floor(cc + a), cyc + b, D + 2, m);
      f.set(-3, cyc + b, Math.floor(cc + a), m);
      f.set(W + 2, cyc + b, Math.floor(cc + a), m);
    }
  // aiguilles
  for (let k = 0; k < 7; k++) {
    f.set(Math.floor(cc), cyc + k, -4, M.IRON);
    f.set(Math.floor(cc), cyc + k, D + 3, M.IRON);
    f.set(-4, cyc + k, Math.floor(cc), M.IRON);
    f.set(W + 3, cyc + k, Math.floor(cc), M.IRON);
  }
  for (let k = 0; k < 5; k++) {
    f.set(Math.floor(cc) + k, cyc, -4, M.IRON);
    f.set(Math.floor(cc) - k, cyc, D + 3, M.IRON);
    f.set(-4, cyc, Math.floor(cc) - k, M.IRON);
    f.set(W + 3, cyc, Math.floor(cc) + k, M.IRON);
  }
  // beffroi ajouré
  const by0 = cy0 + 23;
  f.fill(-1, by0, -1, W + 1, by0 + 14, D + 1, stone);
  for (let i = 3; i < W - 3; i += 3) {
    f.fill(i, by0 + 3, -1, i + 2, by0 + 12, 0, 0);
    f.fill(i, by0 + 3, D, i + 2, by0 + 12, D + 1, 0);
    f.fill(-1, by0 + 3, i, 0, by0 + 12, i + 2, 0);
    f.fill(W, by0 + 3, i, W + 1, by0 + 12, i + 2, 0);
  }
  // flèche pyramidale
  const sy = by0 + 14;
  for (let k = 0; k < 40; k++) {
    const inset = Math.floor(k / 2.2);
    if (inset * 2 >= W + 2) break;
    f.fill(-1 + inset, sy + k, -1 + inset, W + 1 - inset, sy + k + 1, D + 1 - inset, k % 9 === 0 ? M.GOLD : M.LEAD);
  }
  f.fill(Math.floor(W / 2), sy + 18, Math.floor(D / 2), Math.floor(W / 2) + 1, sy + 26, Math.floor(D / 2) + 1, M.GOLD);
  const hall: Room = { kind: 'clock_hall', x0: 2, z0: 2, x1: W - 2, z1: D - 2, front: true };
  const fu = new Furnisher(f, lv, rng);
  furnishRoom(fu, hall, 'clocktower', 0);
  f.prop('DOOR_LEAF', dx0 + dw / 2, floorTop, 1.5, 0, 0);
  f.light(W / 2, cyc, -5, 0.8, 8);
  return baseInfo(ctx, def, f, lv, [hall], dx0 + dw / 2, dw, sy + 26);
}

/** Gazomètre creux (on peut entrer par une trappe). Coordonnées monde en mètres. */
export function buildGasometer(ctx: GenContext, cxm: number, czm: number, rm: number): void {
  const w = ctx.world;
  const cx = cxm * 4;
  const cz = czm * 4;
  const r = rm * 4;
  const y0 = 8;
  const tankTop = y0 + 30;
  for (let x = Math.floor(cx - r - 3); x <= Math.ceil(cx + r + 3); x++) {
    for (let z = Math.floor(cz - r - 3); z <= Math.ceil(cz + r + 3); z++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (d <= r) {
        w.set(x, y0, z, M.FLOOR_FLAG);
        if (d > r - 1.5) {
          for (let y = y0 + 1; y < tankTop; y++) w.set(x, y, z, (y - y0) % 8 === 0 ? M.MACHINE : M.MACHINE_GREEN);
        }
        // couvercle bombé
        const dome = Math.floor(4 * (1 - (d * d) / (r * r)));
        for (let y = tankTop; y <= tankTop + dome; y++) w.set(x, y, z, M.MACHINE_GREEN);
      }
    }
  }
  // porte dans la cuve (côté ouest)
  const dx = Math.floor(cx - r);
  for (let y = y0 + 1; y < y0 + 10; y++) for (let z = Math.floor(cz - 3); z < Math.floor(cz + 3); z++) {
    w.set(dx, y, z, 0);
    w.set(dx + 1, y, z, 0);
  }
  // charpente de guidage : poteaux et anneaux
  const posts = 8;
  const pr = r + 2;
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    const px = Math.floor(cx + Math.cos(a) * pr);
    const pz = Math.floor(cz + Math.sin(a) * pr);
    for (let y = y0; y < y0 + 52; y++) {
      w.set(px, y, pz, M.IRON);
      w.set(px + 1, y, pz, M.IRON);
    }
  }
  for (const ry of [y0 + 26, y0 + 51]) {
    for (let k = 0; k < 360; k++) {
      const a = (k / 360) * Math.PI * 2;
      w.set(Math.floor(cx + Math.cos(a) * pr), ry, Math.floor(cz + Math.sin(a) * pr), M.IRON);
    }
  }
  ctx.light(cxm, 1.5, czm, 0.6, 6);
}
