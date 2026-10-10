// Génération d'un bâtiment complet : coque à étages, façade, cage d'escalier jusqu'au toit,
// pièces meublées et informations de gameplay (zones de capture par étage, points de défense,
// toit). Les logements des parrains et les tours sont construits par residences.ts.

import { M } from '../../materials';
import { Rng, hash32 } from '../../util';
import { VOXEL } from '../../voxel';
import type { BuildingDef, BuildingType } from '../plan';
import type { BuildingInfo, GenContext, Pt, RoomInfo, ZoneInfo } from './context';
import { Frame } from './frame';
import { FACE, Furnisher, furnishRoom, type Room } from './furnish';
import {
  FACADE_DEFAULT,
  band,
  cladFace,
  curtainBlock,
  entrance,
  ledRing,
  pick,
  piers,
  storefront,
  windowColumns,
  windowRow,
  type Facade,
  type Wall,
} from './facade';
import { STAIR_D, STAIR_W, buildBox, computeFloors, cornice, finishWalls, fireEscape, parapet, stairShaft, waterTower, type Levels } from './structure';
import { buildResidence } from './residences';
import { buildLandmark } from './landmarks';

export type Family = 'walkup' | 'brownstone' | 'glass' | 'deco' | 'warehouse' | 'shophouse' | 'classical' | 'modern' | 'industrial' | 'theatre';

export interface TypeSpec {
  family: Family;
  /** Pièces par étage : [avant, fond]. */
  rooms: [string, string][];
  /** Finitions (mur, lambris) par type de pièce, sinon défaut de la famille. */
  wallMat?: number;
  groundClear?: number;
  facade: Partial<Facade>;
  /** Devanture vitrée au rez-de-chaussée. */
  shop?: { band: number; frame: number; awning?: number; neon?: number; glass?: number };
  /** Néon de contour du toit / des étages. */
  neon?: number;
  waterTower?: boolean;
  fireEscape?: boolean;
  doorW?: number;
  canopy?: number;
}

const BRICKS = [M.BRICK_RED, M.BRICK_BROWN, M.BRICK_DARK, M.BRICK_YELLOW, M.BRICK_PAINTED];
const NEONS = [M.NEON_PINK, M.NEON_CYAN, M.NEON_RED, M.NEON_BLUE, M.NEON_GREEN, M.NEON_YELLOW, M.NEON_PURPLE, M.NEON_ORANGE];
const STUCCOS = [M.STUCCO_RED, M.STUCCO_GREEN, M.STUCCO_YELLOW, M.STUCCO];

export function specFor(def: BuildingDef, rng: Rng): TypeSpec {
  const v = def.style ?? 0;
  const neon = NEONS[(hash32(def.id * 31 + 7) >> 3) % NEONS.length];
  switch (def.type) {
    case 'club':
      return {
        family: 'modern',
        rooms: [
          ['club_floor', 'storeroom'],
          ['club_vip', 'office'],
        ],
        groundClear: 22,
        facade: { wall: v ? M.METAL_PANEL_DARK : M.BRICK_PAINTED, wallSide: M.BRICK_DARK, trim: M.METAL_PANEL_DARK, lit: 0.7, winW: 6 },
        neon: v ? M.NEON_CYAN : M.NEON_PINK,
        canopy: M.METAL_PANEL_DARK,
        doorW: 7,
      };
    case 'jazz':
      return {
        family: 'theatre',
        rooms: [
          ['jazz_hall', 'kitchen'],
          ['apartment', 'exec_office'],
        ],
        groundClear: 18,
        facade: { wall: M.BRICK_RED, wallSide: M.BRICK_RED, trim: M.LIMESTONE, lit: 0.7 },
        neon: M.NEON_YELLOW,
        fireEscape: true,
        waterTower: true,
      };
    case 'casino':
      return {
        family: 'deco',
        rooms: [
          ['casino_floor', 'cashier'],
          ['casino_floor', 'exec_office'],
          ['club_vip', 'bar'],
        ],
        groundClear: 20,
        facade: { wall: M.LIMESTONE, wallSide: M.LIMESTONE, trim: M.GOLD, lit: 0.85, winW: 4, winH: 9 },
        neon: M.NEON_PINK,
        canopy: M.GOLD,
        doorW: 8,
      };
    case 'theatre':
      return {
        family: 'theatre',
        rooms: [
          ['foyer', 'theatre_hall'],
          ['club_vip', 'office'],
        ],
        groundClear: 22,
        facade: { wall: v ? M.LIMESTONE : M.BRICK_BROWN, wallSide: M.BRICK_BROWN, trim: M.LIMESTONE, lit: 0.6 },
        neon: v ? M.NEON_PINK : M.NEON_YELLOW,
        doorW: 8,
      };
    case 'gym':
      return {
        family: 'walkup',
        rooms: [
          ['gym_floor', 'storeroom'],
          ['gym_floor', 'office'],
        ],
        groundClear: 18,
        facade: { wall: M.BRICK_GRAFFITI, wallSide: M.BRICK_RED, lit: 0.5, winW: 5 },
        shop: { band: M.PAINT_RED, frame: M.IRON },
        fireEscape: true,
        waterTower: true,
      };
    case 'bodega':
    case 'herbalist':
    case 'pharmacy':
    case 'tattoo': {
      const china = def.type === 'herbalist';
      return {
        family: china ? 'shophouse' : 'walkup',
        rooms: [
          [def.type === 'herbalist' ? 'herbal' : def.type === 'pharmacy' ? 'pharmacy' : def.type === 'tattoo' ? 'tattoo' : 'store', 'storeroom'],
          [def.type === 'pharmacy' ? 'clinic' : 'apartment', 'storeroom'],
        ],
        facade: {
          wall: china ? pick(rng, STUCCOS) : def.type === 'tattoo' ? M.BRICK_GRAFFITI : pick(rng, BRICKS),
          wallSide: M.BRICK_BROWN,
          lit: 0.55,
        },
        shop: {
          band: def.type === 'pharmacy' ? M.PAINT_WHITE : def.type === 'tattoo' ? M.PAINT_BLACK : M.PAINT_GREEN,
          frame: def.type === 'pharmacy' ? M.STEEL : M.IRON,
          awning: def.type === 'bodega' ? M.AWNING_RED : def.type === 'herbalist' ? M.AWNING_GREEN : undefined,
          neon: def.type === 'pharmacy' ? M.NEON_GREEN : def.type === 'tattoo' ? M.NEON_PURPLE : undefined,
        },
        fireEscape: !china,
        waterTower: !china,
      };
    }
    case 'diner':
      return {
        family: 'modern',
        rooms: [
          ['diner', 'kitchen'],
          ['apartment', 'storeroom'],
        ],
        facade: { wall: M.METAL_PANEL_WHITE, wallSide: M.BRICK_RED, trim: M.CHROME, lit: 0.6 },
        shop: { band: M.STUCCO_RED, frame: M.CHROME, neon: M.NEON_RED },
        neon: M.NEON_RED,
      };
    case 'teahouse':
    case 'mahjong':
      return {
        family: 'shophouse',
        rooms:
          def.type === 'teahouse'
            ? [
                ['teahouse', 'kitchen'],
                ['club_vip', 'exec_office'],
              ]
            : [
                ['mahjong_hall', 'storeroom'],
                ['mahjong_hall', 'office'],
              ],
        facade: { wall: def.type === 'teahouse' ? M.STUCCO_RED : M.STUCCO_GREEN, wallSide: M.BRICK_DARK, trim: M.GOLD, lit: 0.7 },
        shop: { band: M.PAINT_BLACK, frame: M.GOLD, awning: M.AWNING_RED, neon: M.NEON_RED },
        neon: M.NEON_RED,
      };
    case 'techmarket':
      return {
        family: 'shophouse',
        rooms: [
          ['tech_market', 'server_room'],
          ['clinic', 'storeroom'],
        ],
        groundClear: 18,
        facade: { wall: M.CONCRETE_DARK, wallSide: M.BRICK_DARK, trim: M.METAL_PANEL_DARK, lit: 0.7, cool: true },
        shop: { band: M.METAL_PANEL_DARK, frame: M.IRON, neon: M.NEON_CYAN },
        neon: M.NEON_CYAN,
      };
    case 'restaurant':
      return {
        family: 'classical',
        rooms: [['restaurant', 'kitchen']],
        facade: { wall: M.BRICK_RED, wallSide: M.BRICK_RED, trim: M.LIMESTONE, lit: 0.85, winW: 5, winH: 9 },
        canopy: M.PAINT_GREEN,
      };
    case 'boathouse':
      return {
        family: 'warehouse',
        rooms: [['boathouse', 'storeroom']],
        facade: { wall: M.WOOD_WALL, wallSide: M.WOOD_WALL, trim: M.PAINT_WHITE, lit: 0.7, winW: 5 },
      };
    case 'hotel':
      return {
        family: 'classical',
        rooms: [
          ['hotel_lobby', 'bar'],
          ['suite', 'suite'],
          ['suite', 'apartment'],
          ['club_vip', 'bar'],
        ],
        groundClear: 18,
        facade: { wall: M.LIMESTONE, wallSide: M.LIMESTONE, trim: M.GRANITE, lit: 0.75, winH: 8 },
        canopy: M.GOLD,
        doorW: 8,
      };
    case 'gallery':
      return {
        family: 'modern',
        rooms: [
          ['gallery_hall', 'vault'],
          ['gallery_hall', 'security_room'],
        ],
        groundClear: 18,
        facade: { wall: M.CONCRETE_WHITE, wallSide: M.CONCRETE_WHITE, trim: M.STEEL, lit: 0.5, winW: 8, cool: true },
        neon: M.LED_WHITE,
      };
    case 'bank':
    case 'exchange':
      return {
        family: 'classical',
        rooms:
          def.type === 'bank'
            ? [
                ['bank_hall', 'vault'],
                ['office', 'exec_office'],
                ['server_room', 'security_room'],
              ]
            : [
                ['trading_floor', 'office'],
                ['office', 'exec_office'],
                ['trading_floor', 'server_room'],
              ],
        groundClear: 20,
        facade: { wall: M.LIMESTONE, wallSide: M.GRANITE, trim: M.LIMESTONE, lit: 0.6, winW: 4, winH: 10, cool: true },
        doorW: 8,
      };
    case 'security':
      return {
        family: 'modern',
        rooms: [
          ['security_room', 'server_room'],
          ['office', 'storeroom'],
          ['control_room', 'exec_office'],
        ],
        facade: { wall: M.METAL_PANEL_DARK, wallSide: M.CONCRETE_DARK, trim: M.STEEL, lit: 0.6, cool: true },
        neon: M.LED_BLUE,
      };
    case 'studio':
      return {
        family: 'modern',
        rooms: [
          ['studio_set', 'control_room'],
          ['office', 'club_vip'],
          ['studio_set', 'storeroom'],
        ],
        groundClear: 18,
        facade: { wall: M.METAL_PANEL_DARK, wallSide: M.METAL_PANEL_DARK, trim: M.CHROME, lit: 0.7, cool: true },
        neon: M.NEON_CYAN,
        doorW: 8,
      };
    case 'station':
      return {
        family: 'classical',
        rooms: [
          ['station_hall', 'storeroom'],
          ['office', 'security_room'],
        ],
        groundClear: 30,
        facade: { wall: M.LIMESTONE, wallSide: M.LIMESTONE, trim: M.GRANITE, lit: 0.7, winW: 6, winH: 16 },
        doorW: 10,
      };
    case 'showroom':
      return {
        family: 'glass',
        rooms: [
          ['showroom', 'office'],
          ['store', 'storeroom'],
          ['store', 'office'],
        ],
        groundClear: 18,
        facade: { wall: M.CURTAIN_DARK, wallSide: M.METAL_PANEL_DARK, trim: M.CHROME, lit: 0.7, cool: true },
        shop: { band: M.METAL_PANEL_DARK, frame: M.CHROME, glass: M.GLASS_CLEAR, neon: M.LED_WHITE },
        neon: M.LED_WHITE,
      };
    case 'depot':
    case 'factory':
      return {
        family: 'industrial',
        rooms: [
          [def.type === 'depot' ? 'depot_floor' : 'factory_floor', 'office'],
          ['office', def.type === 'factory' ? 'server_room' : 'storeroom'],
        ],
        groundClear: 22,
        facade: { wall: v ? M.CORRUGATED_BLUE : M.CORRUGATED_RED, wallSide: M.CONCRETE, trim: M.CONCRETE, lit: 0.5, winW: 6, winH: 4, cool: true, sills: false },
        neon: v ? M.LED_BLUE : M.LED_RED,
        doorW: 12,
      };
    case 'nightmarket':
      return {
        family: 'industrial',
        rooms: [
          ['market_hall', 'kitchen'],
          ['storeroom', 'office'],
        ],
        groundClear: 22,
        facade: { wall: M.BRICK_DARK, wallSide: M.BRICK_DARK, trim: M.CONCRETE, lit: 0.6, sills: false },
        neon: M.NEON_ORANGE,
        doorW: 12,
      };
    case 'brewery':
      return {
        family: 'warehouse',
        rooms: [
          ['brewhouse', 'bar'],
          ['storeroom', 'office'],
        ],
        groundClear: 20,
        facade: { wall: M.BRICK_RED, wallSide: M.BRICK_RED, trim: M.BRICK_DARK, lit: 0.55, winW: 5, winH: 8 },
        neon: M.NEON_ORANGE,
        waterTower: true,
        doorW: 10,
      };
    case 'junkyard':
      return {
        family: 'warehouse',
        rooms: [
          ['junk_yard', 'office'],
          ['storeroom', 'storeroom'],
        ],
        groundClear: 20,
        facade: { wall: M.CORRUGATED, wallSide: M.CORRUGATED, trim: M.RUST, lit: 0.35, sills: false },
        doorW: 12,
      };
    case 'police':
      return {
        family: 'modern',
        rooms: [
          ['police_front', 'cells'],
          ['office', 'storeroom'],
        ],
        facade: { wall: M.BRICK_BROWN, wallSide: M.BRICK_BROWN, trim: M.LIMESTONE, lit: 0.8, cool: true },
        neon: M.LED_BLUE,
        canopy: M.PAINT_NAVY,
      };
    default:
      return { family: 'walkup', rooms: [['storeroom', 'storeroom']], facade: {} };
  }
}

/** Façades exposées (non mitoyennes) d'un bâtiment. */
export function exposure(ctx: GenContext, f: Frame, building: number): Record<Wall, boolean> {
  const test = (lx: number, lz: number): boolean => {
    const p = f.pt(lx, lz);
    for (const b of ctx.footprints) {
      if (p.x >= b[0] - 0.01 && p.x < b[2] + 0.01 && p.z >= b[1] - 0.01 && p.z < b[3] + 0.01) return false;
    }
    void building;
    return true;
  };
  return {
    front: true,
    left: test(-3, f.D / 2),
    right: test(f.W + 3, f.D / 2),
    back: test(f.W / 2, f.D + 3),
  };
}

export function generateBuilding(ctx: GenContext, def: BuildingDef): BuildingInfo {
  if (def.residence || def.type === 'corp') return buildResidence(ctx, def);
  if (def.type === 'landmark') return buildLandmark(ctx, def);
  const rng = new Rng(hash32(def.id * 7919 + 101));
  const spec = specFor(def, rng);
  const st: Facade = { ...FACADE_DEFAULT, ...spec.facade };
  const f = new Frame(ctx, def.rect, def.door, def.id);
  const nFloors = Math.max(1, Math.min(def.stories, spec.rooms.length));
  const floors = computeFloors(nFloors, spec.groundClear ?? 16, 12);
  // étages fermés (décor) au-dessus des étages accessibles
  const extraH = def.height ? Math.max(0, Math.round(def.height * 4) - (floors[nFloors - 1].ceil + 2)) : 0;
  const extraStories = Math.floor(extraH / 14);
  const roofOnTop = extraStories === 0;
  const sealedTop = floors[nFloors - 1].ceil + 2 + extraStories * 14;
  const wallTop = sealedTop;
  const box = buildBox(
    f,
    {
      wall: st.wall,
      wallSide: st.wallSide,
      base: st.base,
      floorMat: floors.map(() => M.CONCRETE),
      ceilMat: M.CEILING,
      roofMat: roofOnTop ? M.ROOF_TAR : M.CONCRETE,
    },
    floors,
    wallTop,
  );
  if (!roofOnTop) {
    // toit réel au sommet des étages fermés
    f.fill(2, wallTop - 2, 2, f.W - 2, wallTop, f.D - 2, M.ROOF_TAR);
  }
  const roofTop = roofOnTop ? box.roofTop : wallTop;
  const exp = exposure(ctx, f, def.id);
  const walls: Wall[] = (['front', 'left', 'right', 'back'] as Wall[]).filter((w) => exp[w]);

  // ---------------------------------------------------------------- porte et rez-de-chaussée
  const doorW = spec.doorW ?? 6;
  const doorLx = Math.round(f.W / 2 - doorW / 2);
  const g0 = floors[0];
  let signY = g0.ceil - 4;
  if (spec.shop) {
    signY = storefront(f, g0, doorLx, doorW, { frame: spec.shop.frame, band: spec.shop.band, awning: spec.shop.awning, neon: spec.shop.neon, glass: spec.shop.glass }).signY;
  } else {
    // fenêtres du rez-de-chaussée sur la façade
    windowRow(f, 'front', st, rng, g0.floorTop + 4, Math.min(st.winH + 2, g0.ceil - g0.floorTop - 7), (c) => c + st.winW + 2 > doorLx - 1 && c - 2 < doorLx + doorW + 1);
  }
  entrance(f, g0, doorLx, doorW, Math.min(11, g0.ceil - g0.floorTop - 3), spec.family === 'deco' || spec.family === 'classical' ? M.GOLD : st.frame, M.GRANITE, spec.canopy);
  // fenêtres latérales du rez-de-chaussée
  for (const w of walls) if (w !== 'front') windowRow(f, w, st, rng, g0.floorTop + 5, Math.min(st.winH, 8));

  // ---------------------------------------------------------------- étages (accessibles et fermés)
  const storyBases: number[] = floors.map((l) => l.floorTop);
  for (let s = 0; s < extraStories; s++) storyBases.push(floors[nFloors - 1].ceil + 2 + s * 14);
  for (let i = 1; i < storyBases.length; i++) {
    const base = storyBases[i];
    for (const w of walls) windowRow(f, w, st, rng, base + 3, st.winH);
  }
  // ---------------------------------------------------------------- habillage selon la famille
  decorateFamily(ctx, f, def, spec, st, rng, walls, floors, storyBases, roofTop, signY);

  // ---------------------------------------------------------------- toit
  parapet(f, roofTop, st.wallSide, spec.family === 'warehouse' || spec.family === 'industrial' ? 3 : 4);
  if (spec.family === 'walkup' || spec.family === 'brownstone' || spec.family === 'theatre') cornice(f, roofTop + 3, st.trim, exp.left || exp.right);
  if (spec.neon) ledRing(f, 0, 0, f.W, f.D, roofTop + 3, spec.neon);

  // ---------------------------------------------------------------- intérieur : cage d'escalier + pièces
  const sx0 = f.W - 2 - STAIR_W;
  const sz0 = f.D - 2 - STAIR_D;
  const partZ = sz0 - 2; // mur de séparation avant / fond
  const rooms: Room[] = [];
  for (let i = 0; i < nFloors; i++) {
    const lv = floors[i];
    // cloison entre la pièce avant et la pièce du fond (avec passage)
    f.fill(2, lv.floorTop, partZ, sx0 - 2, lv.ceil, partZ + 2, M.PLASTER);
    const backW = sx0 - 2 - 2;
    if (backW >= 8) {
      const px = 2 + Math.floor(backW / 2) - 2;
      f.fill(px, lv.floorTop, partZ, px + 5, lv.floorTop + 9, partZ + 2, 0);
    }
    const [frontKind, backKind] = spec.rooms[i];
    rooms.push({ kind: frontKind, floor: i, x0: 2, z0: 2, x1: f.W - 2, z1: partZ });
    if (backW >= 8) rooms.push({ kind: backKind, floor: i, x0: 2, z0: partZ + 2, x1: sx0 - 2, z1: f.D - 2 });
  }
  const stairs = stairShaft(f, sx0, sz0, floors, roofOnTop ? roofTop : null, M.PLASTER, M.CONCRETE);
  // finitions des murs des pièces
  const wallFinish = interiorFinish(def.type);
  for (const r of rooms) {
    const lv = floors[r.floor];
    finishWalls(f, lv, r.x0, r.z0, r.x1, r.z1, wallFinish.wall, wallFinish.wainscot);
  }
  // l'entrée reste dégagée
  f.fill(doorLx, g0.floorTop, 0, doorLx + doorW, g0.floorTop + Math.min(11, g0.ceil - g0.floorTop - 3), 2, 0);
  // ameublement
  const fu = new Furnisher(f, g0, rng);
  fu.reserve(doorLx - 3, 0, doorLx + doorW + 3, 10);
  for (const d of stairs.doors) fu.reserve(d.lx - 4, d.lz - 6, d.lx + 4, d.lz + 3);
  for (const r of rooms) {
    fu.lv = floors[r.floor];
    // passage entre l'avant et le fond
    fu.reserve(2 + Math.floor((sx0 - 4) / 2) - 4, partZ - 5, 2 + Math.floor((sx0 - 4) / 2) + 5, partZ + 6);
    furnishRoom(fu, r, def.style ?? 0);
  }
  // battant de porte (animé côté client)
  f.prop('DOOR_LEAF', doorLx + doorW / 2, g0.floorTop, 1.5, 0, 0);
  // toit : château d'eau, climatiseurs, antennes
  if (roofOnTop) roofProps(f, rng, roofTop, spec, sx0);
  else roofProps(f, rng, roofTop, { ...spec, waterTower: false }, sx0);

  const info = makeInfo(ctx, def, f, floors, rooms, doorLx, doorW, fu, roofOnTop ? roofTop : null, Math.max(roofTop + 6, wallTop));
  info.sign = signFor(f, signY, doorLx, doorW);
  return info;
}

/** Revêtements intérieurs selon le type. */
function interiorFinish(type: BuildingType): { wall: number; wainscot: number | 0 } {
  switch (type) {
    case 'club':
      return { wall: M.WP_BLACK, wainscot: M.METAL_PANEL_DARK };
    case 'jazz':
    case 'theatre':
    case 'casino':
      return { wall: M.WP_RED, wainscot: M.PANEL_DARK };
    case 'hotel':
    case 'restaurant':
    case 'bank':
    case 'exchange':
      return { wall: M.WP_GOLD, wainscot: M.PANEL_DARK };
    case 'teahouse':
    case 'mahjong':
    case 'herbalist':
      return { wall: M.STUCCO_RED, wainscot: M.PANEL_DARK };
    case 'gallery':
    case 'pharmacy':
    case 'showroom':
      return { wall: M.PLASTER_WHITE, wainscot: 0 };
    case 'studio':
    case 'security':
    case 'techmarket':
      return { wall: M.PLASTER_DARK, wainscot: M.HEX_PANEL };
    case 'depot':
    case 'factory':
    case 'junkyard':
    case 'nightmarket':
      return { wall: M.CONCRETE, wainscot: 0 };
    case 'gym':
    case 'tattoo':
      return { wall: M.BRICK_GRAFFITI, wainscot: 0 };
    case 'police':
      return { wall: M.PLASTER, wainscot: M.TILE_GREEN };
    default:
      return { wall: M.PLASTER, wainscot: M.PANEL_LIGHT };
  }
}

/** Détails propres à chaque famille de façade. */
function decorateFamily(
  ctx: GenContext,
  f: Frame,
  def: BuildingDef,
  spec: TypeSpec,
  st: Facade,
  rng: Rng,
  walls: Wall[],
  floors: Levels[],
  storyBases: number[],
  roofTop: number,
  signY: number,
): void {
  const g0 = floors[0];
  switch (spec.family) {
    case 'walkup': {
      band(f, walls, g0.ceil, st.trim);
      if (spec.fireEscape && storyBases.length >= 2) {
        const cols = windowColumns(f.W, st.winW, st.winSpacing, 4);
        const lx0 = cols.length > 1 ? Math.max(1, cols[0] - 5) : 2;
        if (lx0 + 16 < f.W) fireEscape(f, lx0, storyBases, roofTop);
      }
      // climatiseurs aux fenêtres
      for (let i = 1; i < storyBases.length; i++)
        for (const c of windowColumns(f.W, st.winW, st.winSpacing, 4)) if (rng.chance(0.3)) f.prop('AC_WINDOW', c + st.winW / 2, storyBases[i] + 1, -0.9, Math.PI);
      break;
    }
    case 'brownstone':
      band(f, walls, g0.ceil, st.trim);
      break;
    case 'shophouse': {
      // balcons à garde-corps et lanternes rouges, avant-toit à l'étage
      for (let i = 1; i < storyBases.length; i++) {
        const y = storyBases[i] - 1;
        f.fill(2, y, -4, f.W - 2, y + 1, 0, M.CONCRETE);
        f.fill(2, y + 1, -4, f.W - 2, y + 4, -3, M.BARRIER);
        f.fill(2, y + 3, -4, f.W - 2, y + 4, -3, M.GOLD);
        for (let x = 3; x < f.W - 2; x += 3) f.fill(x, y + 1, -4, x + 1, y + 3, -3, M.PAINT_RED);
        for (let x = 6; x < f.W - 4; x += 10) f.prop('LANTERN_RED', x, y - 3, -3.2, 0, 0);
      }
      // avant-toit de tuiles vertes
      const ry = roofTop + 4;
      for (let k = 0; k < 3; k++) f.fill(-1 - k, ry - k, -1 - k, f.W + 1 + k, ry - k + 1, 1, M.COPPER_GREEN);
      if (spec.neon) f.prop('NEON_SIGN', f.W - 3, g0.ceil + 2, -1.6, Math.PI / 2, NEONS.indexOf(spec.neon) >= 0 ? NEONS.indexOf(spec.neon) : 2);
      break;
    }
    case 'theatre': {
      // marquise lumineuse et enseigne verticale
      const mx0 = Math.round(f.W / 2 - 14);
      const my = g0.floorTop + 13;
      f.fill(mx0, my, -7, mx0 + 28, my + 4, 0, M.PAINT_BLACK);
      f.fill(mx0, my, -7, mx0 + 28, my + 1, -6, M.LED_WARM);
      f.fill(mx0, my + 3, -7, mx0 + 28, my + 4, -6, M.LED_WARM);
      f.fill(mx0 + 1, my + 1, -7, mx0 + 27, my + 3, -6, M.SCREEN_TICKER);
      f.prop('NEON_SIGN', f.W - 4, g0.ceil + 4, -1.6, Math.PI / 2, NEONS.indexOf(spec.neon ?? M.NEON_YELLOW));
      band(f, walls, g0.ceil, st.trim);
      break;
    }
    case 'deco': {
      for (const w of walls) piers(f, w, st, g0.ceil, roofTop, st.trim);
      band(f, walls, g0.ceil, M.GOLD);
      if (spec.neon) for (const w of walls) cladFace(f, w, g0.ceil + 1, g0.ceil + 2, spec.neon);
      // grands écrans publicitaires en façade
      const sw = Math.min(f.W - 8, 40);
      const sx = Math.round(f.W / 2 - sw / 2);
      const sy0 = g0.ceil + 4;
      const sy1 = Math.min(roofTop - 2, sy0 + 28);
      f.fill(sx, sy0, -1, sx + sw, sy1, 0, M.SCREEN_ADS);
      addScreen(ctx, f, sx + sw / 2, (sy0 + sy1) / 2, -1.08, sw, sy1 - sy0, def.district, 'boss');
      break;
    }
    case 'classical': {
      // colonnade et fronton
      const span = Math.min(f.W - 6, 44);
      const x0 = Math.round(f.W / 2 - span / 2);
      const topY = Math.min(roofTop - 2, g0.ceil + 6);
      let n = Math.max(4, Math.round(span / 9) + 1);
      if (n % 2 === 1) n++;
      for (let i = 0; i < n; i++) {
        const cx = Math.round(x0 + (i * (span - 3)) / (n - 1));
        f.fill(cx, g0.floorTop, -6, cx + 3, topY, -3, st.trim);
        f.fill(cx - 1, topY - 1, -7, cx + 4, topY, -2, st.trim);
      }
      f.fill(x0 - 1, g0.floorTop - 1, -7, x0 + span + 1, g0.floorTop, 0, M.GRANITE);
      f.fill(x0 - 1, topY, -7, x0 + span + 1, topY + 3, 0, st.trim);
      const half = Math.floor(span / 2) + 1;
      for (let k = 0; k < half; k += 2) f.fill(x0 - 1 + k, topY + 3 + (k >> 1), -7, x0 + span + 1 - k, topY + 4 + (k >> 1), -1, st.trim);
      band(f, walls, g0.ceil + 1, st.trim);
      break;
    }
    case 'modern':
    case 'glass': {
      for (const w of walls) cladFace(f, w, g0.ceil, g0.ceil + 1, spec.neon ?? M.LED_WHITE);
      if (spec.family === 'glass') curtainBlock(f, 0, 0, f.W, f.D, g0.ceil + 1, roofTop - 1, M.CURTAIN_DARK, M.METAL_PANEL_DARK);
      if (def.type === 'studio') {
        const sw = Math.min(f.W - 6, 44);
        const sx = Math.round(f.W / 2 - sw / 2);
        f.fill(sx, g0.ceil + 3, -1, sx + sw, roofTop - 2, 0, M.SCREEN);
        addScreen(ctx, f, sx + sw / 2, (g0.ceil + 3 + roofTop - 2) / 2, -1.08, sw, roofTop - 2 - g0.ceil - 3, def.district, 'news');
      }
      if (def.type === 'police') {
        f.prop('NEON_WALL_SIGN', f.W / 2, g0.ceil + 2, -0.3, Math.PI, 3);
      }
      break;
    }
    case 'industrial':
    case 'warehouse': {
      // rideau de fer de chargement à côté de la porte
      const rx = f.W - 18;
      if (rx > f.W / 2 + 6) {
        f.fill(rx, g0.floorTop, 0, rx + 14, g0.floorTop + 14, 2, 0);
        f.prop('ROLLUP_DOOR', rx + 7, g0.floorTop, 0.3, Math.PI, 0);
      }
      if (spec.neon) for (const w of walls) cladFace(f, w, g0.ceil + 1, g0.ceil + 2, spec.neon);
      break;
    }
  }
  void signY;
  void rng;
}

/** Équipements de toit : château d'eau, climatiseurs, paraboles, antennes, panneaux solaires. */
function roofProps(f: Frame, rng: Rng, roofTop: number, spec: TypeSpec, stairX0: number): void {
  const area = { x0: 4, z0: 4, x1: stairX0 - 4, z1: f.D - 4 };
  if (area.x1 - area.x0 < 8) return;
  if (spec.waterTower && area.x1 - area.x0 > 20) waterTower(f, area.x0 + 8, Math.round(f.D / 2), roofTop, 6);
  const n = rng.int(2, 4);
  for (let i = 0; i < n; i++) {
    const x = rng.range(area.x0 + (spec.waterTower ? 18 : 2), area.x1 - 2);
    const z = rng.range(area.z0 + 2, area.z1 - 2);
    if (x > area.x1 - 2) continue;
    f.prop(pick(rng, ['AC_UNIT', 'AC_UNIT', 'ROOF_VENT', 'SAT_DISH', 'ANTENNA'] as const), x, roofTop, z, rng.range(0, Math.PI * 2), 0);
  }
  if (spec.family === 'glass' || spec.family === 'modern') f.fill(area.x0 + 2, roofTop, area.z0 + 2, Math.min(area.x1, area.x0 + 14), roofTop + 1, Math.min(area.z1, area.z0 + 10), M.SOLAR);
}

/** Enseigne au-dessus de la porte (texte dessiné par le client). */
export function signFor(f: Frame, signY: number, doorLx: number, doorW: number): BuildingInfo['sign'] {
  const c = f.pt(f.W / 2, -1.08);
  void doorLx;
  void doorW;
  return { x: c.x, y: (signY + 1.5) * VOXEL, z: c.z, yaw: f.yaw(Math.PI), w: Math.max(2, (f.W - 6) * VOXEL), h: 0.62 };
}

/** Écran géant en façade : contenu dessiné par le client. */
export function addScreen(ctx: GenContext, f: Frame, lx: number, ly: number, lz: number, w: number, h: number, district: string, kind: 'ad' | 'boss' | 'news' | 'ticker'): void {
  const p = f.pt(lx, lz);
  ctx.screens.push({ x: p.x, y: ly * VOXEL, z: p.z, yaw: f.yaw(Math.PI), w: w * VOXEL, h: h * VOXEL, kind, district, seed: ctx.screens.length * 17 + 3 });
}

/** Infos de gameplay communes. */
export function makeInfo(
  ctx: GenContext,
  def: BuildingDef,
  f: Frame,
  floors: Levels[],
  rooms: Room[],
  doorLx: number,
  doorW: number,
  fu: Furnisher,
  roofTop: number | null,
  topLy: number,
): BuildingInfo {
  const dc = doorLx + doorW / 2;
  const doorPt = f.pt(dc, 0);
  const outPt = f.pt(dc, -7);
  const inPt = f.pt(dc, 6);
  const yOf = (ly: number) => ly * VOXEL;
  const roomInfos: RoomInfo[] = rooms.map((r) => ({ kind: r.kind, rect: f.rectM(r.x0, r.z0, r.x1, r.z1), y: yOf(floors[r.floor].floorTop) }));
  const inner = f.rectM(2, 2, f.W - 2, f.D - 2);
  const zone: ZoneInfo[] = floors.map((l) => ({ rect: inner, y0: yOf(l.floorTop) - 0.6, y1: yOf(l.ceil) }));
  const front = rooms[0];
  const center = { ...f.pt((front.x0 + front.x1) / 2, (front.z0 + front.z1) / 2), y: yOf(floors[0].floorTop) };
  const defend: Pt[] = [];
  const spawn: Pt[] = [];
  for (const r of rooms) {
    const lv = floors[r.floor];
    for (let lx = r.x0 + 3; lx < r.x1 - 2; lx += 5)
      for (let lz = r.z0 + 3; lz < r.z1 - 2; lz += 5) {
        if (!cellFree(f, lv, lx, lz)) continue;
        const p = { ...f.pt(lx + 0.5, lz + 0.5), y: yOf(lv.floorTop) };
        defend.push(p);
        if (r.floor === 0 && r === rooms[0]) spawn.push(p);
      }
  }
  // points de tir sur le toit (le long de l'acrotère avant)
  const roofPts: Pt[] = [];
  if (roofTop !== null) {
    for (let lx = 6; lx < f.W - 6; lx += 8) {
      const lz = 4;
      if (f.get(lx, roofTop, lz) === 0 && f.get(lx, roofTop + 4, lz) === 0) roofPts.push({ ...f.pt(lx + 0.5, lz + 0.5), y: yOf(roofTop) });
    }
  }
  const guardOut: Pt[] = [f.pt(dc - 7, -6), f.pt(dc + 7, -6), f.pt(dc - 4, -10), f.pt(dc + 4, -10)];
  const info: BuildingInfo = {
    id: def.id,
    def,
    footprint: [def.rect[0], def.rect[1], def.rect[2], def.rect[3]],
    floorY: yOf(floors[0].floorTop),
    floors: floors.map((l) => ({ y: yOf(l.floorTop), ceil: yOf(l.ceil) })),
    roofY: roofTop !== null ? yOf(roofTop) : null,
    doors: [{ x: doorPt.x, z: doorPt.z, side: def.door, out: { ...outPt, y: 0 }, in: { ...inPt, y: yOf(floors[0].floorTop) }, width: doorW * VOXEL, main: true }],
    rooms: roomInfos,
    zone,
    center,
    defend,
    roofPts,
    guardOut: guardOut.map((p) => ({ ...p, y: 0 })),
    spawn: spawn.length ? spawn : [center],
    height: topLy * VOXEL,
  };
  const m = fu.marks;
  const mk = (k: string): Pt | undefined => (m[k] ? { ...f.pt(m[k].lx, m[k].lz), y: yOf(m[k].ly) } : undefined);
  if (m.desk) info.desk = { ...mk('desk')!, yaw: f.yaw(m.desk.yaw ?? 0) };
  info.deskSeat = mk('deskSeat');
  info.recruit = mk('recruit');
  info.armory = mk('armory');
  info.vault = mk('vault');
  if (m.garage) info.garage = { ...mk('garage')!, yaw: f.yaw(m.garage.yaw ?? 0) };
  ctx.buildings.push(info);
  return info;
}

export function cellFree(f: Frame, lv: Levels, lx: number, lz: number): boolean {
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      if (f.get(lx + dx, lv.floorTop, lz + dz) !== 0) return false;
      if (f.get(lx + dx, lv.floorTop + 4, lz + dz) !== 0) return false;
    }
  return true;
}

export { FACE };
