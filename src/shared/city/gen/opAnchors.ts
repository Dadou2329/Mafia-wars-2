// Objectifs des opérations de prise de contrôle (voir shared/conquest.ts) : dans le bâtiment
// meublé, on choisit les vrais lieux (chambre forte, bureau de la direction, salle des serveurs,
// salon VIP, régie…), on y pose au besoin un accessoire (console de contrôle, armoire des
// registres, coffre) et on retient le point où se tenir pour mener l'étape. Tout est déterministe
// (même ville chez le serveur et chez les clients) et ne bouche aucun passage : le point retenu
// est une case libre à hauteur d'homme, au sol.

import { MAT_SOLID } from '../../materials';
import { GROUND_VY, INV_VOXEL, VOXEL, type VoxelWorld } from '../../voxel';
import { opAnchorKeys } from '../../conquest';
import type { BuildingDef } from '../plan';
import { PROP_DEFS, type PropKind } from '../props';
import type { BuildingInfo, GenContext, OpAnchor } from './context';
import { Frame } from './frame';
import { FACE, type Furnisher, type Room, type Side4 } from './furnish';
import type { Levels } from './structure';

/**
 * Zone praticable principale autour d'un sol (altitude vy, voxels) dans un rectangle (m), comme
 * la grille de navigation : cellules de 2 × 2 voxels au sol plein et 1,75 m d'air, puis la plus
 * grande composante connexe (les recoins fermés par des bureaux ou des chaises sont exclus).
 */
interface Area {
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  vy: number;
  /** Colonne de voxels libre (sol plein, 7 voxels d'air), par voxel. */
  open: Uint8Array;
  /** Cellule 2 × 2 dans la zone principale. */
  main: Uint8Array;
  cw: number;
}

function mainArea(w: VoxelWorld, b: [number, number, number, number], y: number): Area {
  const vy = Math.round(y * INV_VOXEL) + GROUND_VY;
  const x0 = (Math.floor(b[0] * INV_VOXEL) - 2) & ~1;
  const z0 = (Math.floor(b[1] * INV_VOXEL) - 2) & ~1;
  const nx = ((Math.ceil(b[2] * INV_VOXEL) + 3 - x0) >> 1) << 1;
  const nz = ((Math.ceil(b[3] * INV_VOXEL) + 3 - z0) >> 1) << 1;
  const ny = 8;
  const box = new Uint8Array(nx * nz * ny);
  w.copyBox(x0, vy - 1, z0, nx, ny, nz, box, 0, nx * nz, nx);
  const open = new Uint8Array(nx * nz);
  for (let i = 0; i < nx * nz; i++) {
    if (!MAT_SOLID[box[i]]) continue;
    let ok = 1;
    for (let k = 1; k < ny; k++)
      if (box[k * nx * nz + i] !== 0) {
        ok = 0;
        break;
      }
    open[i] = ok;
  }
  const cw = nx >> 1;
  const cd = nz >> 1;
  const cell = new Uint8Array(cw * cd);
  for (let k = 0; k < cd; k++)
    for (let i = 0; i < cw; i++) {
      const o = 2 * k * nx + 2 * i;
      cell[k * cw + i] = open[o] & open[o + 1] & open[o + nx] & open[o + nx + 1];
    }
  // plus grande composante (8-connexe, sans couper les angles)
  const comp = new Int32Array(cw * cd).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let c0 = 0; c0 < cw * cd; c0++) {
    if (!cell[c0] || comp[c0] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    comp[c0] = id;
    stack.push(c0);
    while (stack.length) {
      const c = stack.pop()!;
      n++;
      const i = c % cw;
      const k = (c - i) / cw;
      for (let dk = -1; dk <= 1; dk++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dk) continue;
          const mi = i + di;
          const mk = k + dk;
          if (mi < 0 || mk < 0 || mi >= cw || mk >= cd) continue;
          const m = mk * cw + mi;
          if (!cell[m] || comp[m] >= 0) continue;
          if (di && dk && (!cell[k * cw + mi] || !cell[mk * cw + i])) continue;
          comp[m] = id;
          stack.push(m);
        }
    }
    sizes.push(n);
  }
  let best = -1;
  for (let c = 0; c < sizes.length; c++) if (best < 0 || sizes[c] > sizes[best]) best = c;
  const main = new Uint8Array(cw * cd);
  for (let c = 0; c < cw * cd; c++) main[c] = comp[c] === best && best >= 0 ? 1 : 0;
  return { x0, z0, nx, nz, vy, open, main, cw };
}

/** Un personnage tient debout ici, dans la zone principale : (2h+1)² colonnes libres. */
function standable(a: Area, vx: number, vz: number, h: number): boolean {
  const lx = vx - a.x0;
  const lz = vz - a.z0;
  if (lx - h < 0 || lz - h < 0 || lx + h >= a.nx || lz + h >= a.nz) return false;
  if (!a.main[(lz >> 1) * a.cw + (lx >> 1)]) return false;
  for (let dz = -h; dz <= h; dz++) for (let dx = -h; dx <= h; dx++) if (!a.open[(lz + dz) * a.nx + lx + dx]) return false;
  return true;
}

/**
 * Case libre la plus proche de (x, z) au sol d'altitude y (m), dans un rectangle (m) et dans sa
 * zone praticable principale : d'abord un dégagement de 1,25 m (on n'y reste pas coincé entre
 * deux bureaux), sinon de 0,75 m.
 */
/** Points à éviter (m) : on ne se tient pas sur le lieu d'un braquage (deux invites au même endroit). */
type Avoid = { x: number; z: number; r: number }[];

function freeSpot(w: VoxelWorld, x: number, y: number, z: number, bounds: [number, number, number, number], maxR = 16, avoid: Avoid = []): { x: number; z: number } | null {
  const area = mainArea(w, bounds, y);
  return freeSpotH(area, x, z, bounds, maxR, 2, avoid) ?? freeSpotH(area, x, z, bounds, maxR, 1, avoid);
}

function freeSpotH(area: Area, x: number, z: number, bounds: [number, number, number, number], maxR: number, h: number, avoid: Avoid): { x: number; z: number } | null {
  const vx0 = Math.floor(x * INV_VOXEL);
  const vz0 = Math.floor(z * INV_VOXEL);
  const bx0 = Math.ceil(bounds[0] * INV_VOXEL) + 1;
  const bz0 = Math.ceil(bounds[1] * INV_VOXEL) + 1;
  const bx1 = Math.floor(bounds[2] * INV_VOXEL) - 2;
  const bz1 = Math.floor(bounds[3] * INV_VOXEL) - 2;
  for (let r = 0; r <= maxR; r++) {
    let best: { x: number; z: number } | null = null;
    let bd = Infinity;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const vx = vx0 + dx;
        const vz = vz0 + dz;
        if (vx < bx0 || vx > bx1 || vz < bz0 || vz > bz1) continue;
        if (!standable(area, vx, vz, h)) continue;
        const px = (vx + 0.5) * VOXEL;
        const pz = (vz + 0.5) * VOXEL;
        if (avoid.some((a) => Math.hypot(px - a.x, pz - a.z) < a.r)) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) {
          bd = d;
          best = { x: (vx + 0.5) * VOXEL, z: (vz + 0.5) * VOXEL };
        }
      }
    if (best) return best;
  }
  return null;
}

// ---------------------------------------------------------------------------- bâtiments ordinaires

const cxOf = (r: Room): number => (r.x0 + r.x1) / 2;
const czOf = (r: Room): number => (r.z0 + r.z1) / 2;

/** Grandes salles (tenir la salle principale). */
const HALLS = [
  'station_hall',
  'market_hall',
  'jazz_hall',
  'gallery_hall',
  'mahjong_hall',
  'trading_floor',
  'tech_market',
  'casino_floor',
  'club_floor',
  'depot_floor',
  'factory_floor',
  'brewhouse',
  'junk_yard',
  'restaurant',
  'theatre_hall',
  'studio_set',
  'hotel_lobby',
  'foyer',
  'gym_floor',
  'diner',
  'teahouse',
];

interface Rule {
  /** Pièces candidates, par ordre de préférence. */
  rooms: string[];
  /** Étage préféré parmi les pièces du type retenu. */
  floor: 'low' | 'top';
  /** Point visé dans la pièce (coordonnées locales, voxels). */
  at?: (r: Room, f: Frame) => [number, number];
  /** Accessoire posé contre un mur pour matérialiser l'objectif (on se tient devant). */
  prop?: { kind: PropKind; walls: Side4[]; n?: number };
}

const RULES: Record<string, Rule> = {
  office: { rooms: ['exec_office', 'office', 'garage_office'], floor: 'top', at: (r) => (r.kind === 'exec_office' ? [cxOf(r), r.z1 - 9.5] : [cxOf(r), czOf(r)]) },
  vip: { rooms: ['club_vip'], floor: 'top', at: (r) => [cxOf(r) - 5, czOf(r)] },
  suite: { rooms: ['suite'], floor: 'top' },
  server: { rooms: ['server_room'], floor: 'low' },
  network: { rooms: ['cashier'], floor: 'low', at: (r) => [r.x1 - 5, czOf(r) + 3] },
  control: { rooms: ['control_room'], floor: 'low', at: (r) => [r.x0 + 7, czOf(r)] },
  security: { rooms: ['security_room'], floor: 'low', at: (r) => [cxOf(r), r.z1 - 9.5] },
  registry: { rooms: ['office', 'clinic', 'hotel_lobby', 'storeroom'], floor: 'top', prop: { kind: 'FILING_CABINET', walls: ['back', 'right', 'left'], n: 2 } },
  counter: { rooms: ['store', 'pharmacy', 'herbal', 'diner', 'boathouse', 'tattoo', 'bar'], floor: 'low', at: counterPoint },
  hall: { rooms: HALLS, floor: 'low' },
  hall_top: { rooms: HALLS, floor: 'top' },
  stage: { rooms: ['jazz_hall'], floor: 'low', at: (r) => [cxOf(r), r.z1 - 11] },
  regie: { rooms: ['theatre_hall'], floor: 'low', prop: { kind: 'COMMAND_DESK', walls: ['left', 'right'] } },
  clinic: { rooms: ['clinic'], floor: 'top' },
  kitchen: { rooms: ['kitchen'], floor: 'low', at: (r) => [cxOf(r), r.z0 + 3] },
  vault: { rooms: ['vault', 'cashier', 'restaurant'], floor: 'low', at: (r) => (r.kind === 'vault' ? [cxOf(r), czOf(r) + 2] : [cxOf(r), r.z1 - 4]) },
  docks: { rooms: ['depot_floor'], floor: 'low', at: (r, f) => [Math.min(r.x1 - 6, f.W - 11), r.z0 + 4] },
  logistics: { rooms: ['office'], floor: 'low', prop: { kind: 'COMMAND_DESK', walls: ['back', 'left', 'right'] } },
  switch: { rooms: ['office'], floor: 'top', prop: { kind: 'COMMAND_DESK', walls: ['back', 'left', 'right'] } },
  line: { rooms: ['factory_floor'], floor: 'low', at: (r) => [r.x0 + 7, r.z0 + 9] },
  antenna: { rooms: ['studio_set'], floor: 'top', at: (r) => [cxOf(r), r.z1 - 10] },
};

function counterPoint(r: Room): [number, number] {
  switch (r.kind) {
    case 'store':
    case 'pharmacy':
    case 'herbal':
      return [r.x1 - 7, r.z0 + 5];
    case 'diner':
      return [cxOf(r), r.z1 - 8.5];
    case 'boathouse':
      return [r.x1 - 5.5, czOf(r)];
    case 'bar':
      return [r.x0 + 7, czOf(r)];
    default:
      return [cxOf(r), czOf(r)];
  }
}

function pickRoom(rooms: Room[], rule: Rule): Room | null {
  for (const kind of rule.rooms) {
    const list = rooms.filter((r) => r.kind === kind);
    if (!list.length) continue;
    return list.reduce((a, b) => (rule.floor === 'top' ? (b.floor > a.floor ? b : a) : b.floor < a.floor ? b : a));
  }
  return null;
}

/**
 * Pose n accessoires côte à côte contre un mur de la pièce (le premier mur qui a la place, au plus
 * près de son milieu). Renvoie le point (local) où se tenir devant eux et l'orientation locale.
 */
function wallProp(fu: Furnisher, r: Room, kind: PropKind, walls: Side4[], n: number): { lx: number; lz: number; yaw: number; px: number; pz: number } | null {
  const size = PROP_DEFS[kind].size;
  const wv = size[0] * 4;
  const d = size[2] * 2 + 0.05;
  const front = size[2] * 4 + 2.5;
  for (const wall of walls) {
    const len = wall === 'left' || wall === 'right' ? r.z1 - r.z0 : r.x1 - r.x0;
    const start = wall === 'left' || wall === 'right' ? r.z0 : r.x0;
    const span = n * wv + (n - 1) * 0.4;
    for (let k = 0; k < 12; k++) {
      const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 3;
      const along = start + len / 2 + off;
      if (along - span / 2 < start + 3 || along + span / 2 > start + len - 3) continue;
      const pos: [number, number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = along + (i - (n - 1) / 2) * (wv + 0.4);
        if (wall === 'back') pos.push([a, r.z1 - d, FACE.fromBack]);
        else if (wall === 'front') pos.push([a, r.z0 + d, FACE.fromFront]);
        else if (wall === 'left') pos.push([r.x0 + d, a, FACE.fromLeft]);
        else pos.push([r.x1 - d, a, FACE.fromRight]);
      }
      if (!pos.every(([x, z, yaw]) => fu.isFree(kind, x, z, yaw))) continue;
      for (const [x, z, yaw] of pos) fu.p(kind, x, z, yaw, 0, true);
      const yaw = pos[0][2];
      if (wall === 'back') return { lx: along, lz: r.z1 - front, yaw, px: along, pz: r.z1 - d };
      if (wall === 'front') return { lx: along, lz: r.z0 + front, yaw, px: along, pz: r.z0 + d };
      if (wall === 'left') return { lx: r.x0 + front, lz: along, yaw, px: r.x0 + d, pz: along };
      return { lx: r.x1 - front, lz: along, yaw, px: r.x1 - d, pz: along };
    }
  }
  return null;
}

/**
 * Ancres des objectifs d'un bâtiment ordinaire (après l'ameublement, avant makeInfo) : les
 * accessoires posés ici comptent dans les points de défense et la navigation.
 */
export function placeOpAnchors(ctx: GenContext, def: BuildingDef, f: Frame, floors: Levels[], rooms: Room[], fu: Furnisher): OpAnchor[] {
  const saved = fu.lv;
  // 1) lieux et accessoires (tous posés avant de chercher les cases libres)
  const wanted: { key: string; room: Room; target: [number, number]; facing: { px: number; pz: number } | null }[] = [];
  for (const key of opAnchorKeys(def)) {
    const rule = RULES[key];
    if (!rule) continue; // « terminal » : posé avec la sécurité (gen/security.ts)
    const room = pickRoom(rooms, rule);
    if (!room) continue;
    fu.lv = floors[room.floor];
    let target: [number, number] = [cxOf(room), czOf(room)];
    let facing: { px: number; pz: number } | null = null;
    const placed =
      room.kind === 'hotel_lobby' && key === 'registry'
        ? null
        : rule.prop
          ? wallProp(fu, room, rule.prop.kind, rule.prop.walls, rule.prop.n ?? 1)
          : room.kind === 'restaurant' && key === 'vault'
            ? wallProp(fu, room, 'SAFE', ['back', 'right', 'left'], 1) // le coffre du gérant
            : null;
    if (room.kind === 'hotel_lobby' && key === 'registry') {
      // la réception de l'hôtel : devant le comptoir
      target = [cxOf(room), room.z1 - 7.5];
      facing = { px: cxOf(room), pz: room.z1 - 4 };
    } else if (placed) {
      target = [placed.lx, placed.lz];
      facing = { px: placed.px, pz: placed.pz };
    } else if (rule.at) target = rule.at(room, f);
    wanted.push({ key, room, target, facing });
  }
  fu.lv = saved;
  // 2) le point où se tenir : la case libre la plus proche du lieu visé (loin du lieu du braquage,
  //    pour que l'invite de l'opération et celle du braquage ne se recouvrent pas)
  const hv = def.heist ? fu.marks.vault : undefined;
  const heistAt = hv ? { ...f.pt(hv.lx, hv.lz), y: hv.ly * VOXEL } : null;
  const out: OpAnchor[] = [];
  for (const { key, room, target, facing } of wanted) {
    const y = floors[room.floor].floorTop * VOXEL;
    const p = f.pt(target[0] + 0.5, target[1] + 0.5);
    const bounds = f.rectM(room.x0, room.z0, room.x1, room.z1);
    const avoid: Avoid = heistAt && Math.abs(heistAt.y - y) < 1.5 ? [{ x: heistAt.x, z: heistAt.z, r: 5.4 }] : [];
    const spot =
      freeSpot(ctx.world, p.x, y, p.z, bounds, 16, avoid) ??
      freeSpot(ctx.world, (bounds[0] + bounds[2]) / 2, y, (bounds[1] + bounds[3]) / 2, bounds, 48, avoid) ??
      freeSpot(ctx.world, p.x, y, p.z, bounds, 40);
    if (!spot) continue;
    const a: OpAnchor = { key, x: round2(spot.x), y, z: round2(spot.z), floor: room.floor };
    if (facing) {
      const q = f.pt(facing.px, facing.pz);
      a.yaw = round2(Math.atan2(q.x - spot.x, q.z - spot.z));
    }
    out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------- logements et tours

/**
 * Ancres des logements des parrains (entrée du QG, armurerie, bureau) et des tours de bureaux
 * (hall, étage de direction, serveurs, toit), calculées sur le bâtiment déjà construit.
 */
export function residenceOpAnchors(ctx: GenContext, def: BuildingDef, info: BuildingInfo): OpAnchor[] {
  const w = ctx.world;
  const out: OpAnchor[] = [];
  const fp = info.footprint;
  const push = (key: string, x: number, y: number, z: number, floor: number, bounds: [number, number, number, number] = fp, face?: { x: number; z: number }) => {
    const s = freeSpot(w, x, y, z, bounds) ?? freeSpot(w, x, y, z, fp, 40);
    if (!s) return;
    const a: OpAnchor = { key, x: round2(s.x), y, z: round2(s.z), floor };
    if (face) a.yaw = round2(Math.atan2(face.x - s.x, face.z - s.z));
    out.push(a);
  };
  const floorOf = (y: number) => {
    let best = 0;
    info.floors.forEach((fl, i) => {
      if (Math.abs(fl.y - y) < Math.abs(info.floors[best].y - y)) best = i;
    });
    return best;
  };
  if (def.type === 'corp') {
    const f = new Frame(ctx, def.rect, def.door, def.id);
    // hall : devant les ascenseurs, au fond du hall (loin du terminal de sécurité de l'entrée)
    const hall = info.elevator?.find((s) => s.label === 'Hall');
    if (hall) push('lobby', hall.x - f.ez[0] * 2, hall.y, hall.z - f.ez[1] * 2, 0, fp, { x: hall.x + f.ez[0] * 2, z: hall.z + f.ez[1] * 2 });
    for (const [key, kind] of [
      ['office', 'exec_office'],
      ['server', 'server_room'],
    ] as const) {
      const r = info.rooms.find((x) => x.kind === kind);
      if (r) push(key, (r.rect[0] + r.rect[2]) / 2, r.y, (r.rect[1] + r.rect[3]) / 2, floorOf(r.y), r.rect);
    }
    // toit-terrasse : quelques pas devant l'ascenseur, côté façade
    const top = info.elevator?.find((s) => s.label === 'Toit');
    if (top) push('roof', top.x - f.ez[0] * 3.5, top.y, top.z - f.ez[1] * 3.5, -1);
    return out;
  }
  // logements : entrée (dans le hall), armurerie, bureau du parrain
  const door = info.doors[0];
  const dx = door.in.x - door.out.x;
  const dz = door.in.z - door.out.z;
  const l = Math.hypot(dx, dz) || 1;
  const gy = door.in.y ?? info.floorY;
  push('gate', door.in.x + (dx / l) * 1.2, gy, door.in.z + (dz / l) * 1.2, floorOf(gy));
  if (info.armory) push('armory', info.armory.x, info.armory.y ?? info.floorY, info.armory.z, floorOf(info.armory.y ?? info.floorY));
  const seat = info.deskSeat ?? info.desk;
  if (seat) push('desk', seat.x, seat.y ?? info.floorY, seat.z, floorOf(seat.y ?? info.floorY), fp, info.desk);
  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
