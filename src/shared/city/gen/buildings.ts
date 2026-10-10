// Génération d'un bâtiment complet : coque, façade, pièces, mobilier et infos de gameplay.

import { M } from '../../materials';
import { Rng, hash32 } from '../../util';
import { VOXEL } from '../../voxel';
import type { BuildingDef, BuildingType } from '../plan';
import type { BuildingInfo, GenContext, Pt, RoomInfo } from './context';
import { Frame } from './frame';
import { Furnisher, furnishRoom } from './furnish';
import { finishRoom, layoutRooms, type Finish, type LayoutSpec, type Room, type RoomKind } from './interior';
import {
  DEFAULT_STYLE,
  buildMassing,
  chimney,
  computeLevels,
  cornice,
  door,
  quoins,
  roof,
  shopfront,
  steps,
  stringCourses,
  window,
  windowColumns,
  windowOnWall,
  type Levels,
  type Style,
} from './shell';
import { buildChurch, buildClockTower, buildGasometer } from './landmarks';

const BRICKS = [M.BRICK_RED, M.BRICK_BROWN, M.BRICK_YELLOW, M.BRICK_DARKRED];
const PAINTS = [M.PAINT_GREEN, M.PAINT_MAROON, M.PAINT_NAVY, M.PAINT_BLACK, M.PAINT_TEAL, M.PAINT_OCHRE];
const AWNINGS = [M.AWNING_RED, M.AWNING_GREEN, M.AWNING_BLUE];

export function styleFor(def: BuildingDef): Style {
  const v = def.style ?? 0;
  const h = hash32(def.id * 977 + 13);
  const st: Style = { ...DEFAULT_STYLE };
  st.wall = BRICKS[h % BRICKS.length];
  st.wallSide = st.wall;
  st.paint = PAINTS[(h >> 4) % PAINTS.length];
  switch (def.type) {
    case 'pub':
      st.ground = 'pub';
      st.paint = [M.PAINT_GREEN, M.PAINT_MAROON, M.PAINT_BLACK][v % 3];
      st.wall = [M.BRICK_BROWN, M.BRICK_YELLOW, M.BRICK_RED][v % 3];
      st.wallSide = st.wall;
      st.litChance = 0.6;
      break;
    case 'hq':
      st.ground = 'pub';
      if (def.hq === 'dadou') {
        st.wall = M.BRICK_DARKRED;
        st.paint = M.PAINT_RED;
        st.paint2 = M.GOLD;
      } else {
        st.wall = M.BRICK_YELLOW;
        st.paint = M.PAINT_NAVY;
        st.paint2 = M.SILVER;
      }
      st.wallSide = st.wall;
      st.litChance = 0.75;
      st.quoins = true;
      break;
    case 'shop':
    case 'bakery':
    case 'butcher':
    case 'pawn':
    case 'jeweller':
      st.ground = 'shop';
      st.awning = def.type === 'jeweller' ? 0 : AWNINGS[(h >> 8) % AWNINGS.length];
      if (def.type === 'jeweller') {
        st.wall = M.STONE;
        st.paint = M.PAINT_BLACK;
        st.trim = M.STONE_GREY;
      }
      if (def.type === 'butcher') st.paint = M.PAINT_MAROON;
      if (def.type === 'bakery') st.paint = M.PAINT_CREAM;
      if (def.type === 'pawn') {
        st.wall = M.BRICK_SOOT;
        st.wallSide = M.BRICK_SOOT;
        st.paint = M.PAINT_OCHRE;
      }
      break;
    case 'gambling':
      st.wall = M.BRICK_SOOT;
      st.wallSide = M.BRICK_SOOT;
      st.ground = 'pub';
      st.paint = M.PAINT_BLACK;
      st.paint2 = M.GOLD;
      st.litChance = 0.85;
      break;
    case 'theatre':
      st.wall = M.STUCCO;
      st.wallSide = M.BRICK_YELLOW;
      st.trim = M.STONE;
      st.ground = 'grand';
      st.arched = true;
      st.roofType = 'flat';
      st.litChance = 0.8;
      st.quoins = true;
      break;
    case 'cafe':
      st.wall = v ? M.STONE : M.STUCCO_WHITE;
      st.wallSide = M.BRICK_YELLOW;
      st.ground = 'shop';
      st.paint = v ? M.PAINT_GREEN : M.PAINT_BLACK;
      st.paint2 = M.GOLD;
      st.awning = v ? M.AWNING_GREEN : M.AWNING_RED;
      st.litChance = 0.7;
      st.roofType = 'mansard';
      break;
    case 'bank':
    case 'exchange':
      st.wall = M.STONE;
      st.wallSide = M.STONE;
      st.trim = M.STONE;
      st.base = M.STONE_GREY;
      st.ground = 'grand';
      st.raised = 2;
      st.arched = true;
      st.roofType = 'flat';
      st.winW = 4;
      st.winH = 9;
      st.winSpacing = 12;
      st.doorW = 8;
      st.doorH = 12;
      st.chimneys = 0;
      st.litChance = 0.5;
      break;
    case 'offices':
    case 'post':
    case 'customs':
      st.wall = def.type === 'post' ? M.BRICK_RED : M.STONE;
      st.wallSide = def.type === 'post' ? M.BRICK_RED : M.BRICK_YELLOW;
      st.trim = M.STONE;
      st.ground = 'plain';
      st.roofType = def.type === 'offices' ? 'mansard' : def.type === 'post' ? 'flat' : 'hip';
      st.quoins = def.type !== 'post';
      st.doorW = 8;
      st.doorH = 11;
      st.litChance = 0.55;
      break;
    case 'lodging':
    case 'tenement':
    case 'housing':
      st.wall = def.type === 'housing' ? M.BRICK_YELLOW : M.BRICK_SOOT;
      st.wallSide = st.wall;
      st.trim = M.STONE_GREY;
      st.ground = 'plain';
      st.winW = 3;
      st.winH = 6;
      st.winSpacing = 8;
      st.cornice = false;
      st.stringCourse = false;
      st.chimneys = 4;
      st.litChance = 0.35;
      st.doorW = 5;
      st.doorH = 10;
      st.frame = M.FRAME_DARK;
      break;
    case 'sweatshop':
      st.wall = M.BRICK_BROWN;
      st.wallSide = M.BRICK_BROWN;
      st.ground = 'industrial';
      st.winW = 5;
      st.winH = 8;
      st.winSpacing = 9;
      st.litChance = 0.5;
      st.frame = M.FRAME_DARK;
      break;
    case 'police':
      st.wall = M.BRICK_RED;
      st.wallSide = M.BRICK_RED;
      st.trim = M.STONE;
      st.quoins = true;
      st.ground = 'plain';
      st.roofType = 'hip';
      st.doorW = 7;
      st.litChance = 0.7;
      break;
    case 'mansion':
      if (v === 1) {
        st.wall = M.BRICK_RED;
        st.trim = M.STONE;
        st.roofType = 'hip';
      } else {
        st.wall = M.STUCCO_WHITE;
        st.trim = M.STUCCO;
        st.roofType = 'mansard';
      }
      st.wallSide = st.wall;
      st.base = M.STONE_GREY;
      st.ground = 'grand';
      st.raised = 2;
      st.winH = 9;
      st.litChance = 0.65;
      st.doorW = 6;
      st.doorH = 11;
      break;
    case 'club':
      st.wall = M.STONE;
      st.wallSide = M.STONE;
      st.trim = M.STONE;
      st.base = M.STONE_GREY;
      st.ground = 'grand';
      st.raised = 2;
      st.roofType = 'flat';
      st.quoins = true;
      st.winH = 9;
      st.arched = true;
      st.litChance = 0.75;
      break;
    case 'foundry':
    case 'mill':
    case 'brewery':
    case 'gasworks':
      st.wall = def.type === 'brewery' ? M.BRICK_YELLOW : def.type === 'mill' ? M.BRICK_RED : M.BRICK_SOOT;
      st.wallSide = st.wall;
      st.trim = def.type === 'foundry' ? M.BRICK_YELLOW : M.STONE_GREY;
      st.ground = 'industrial';
      st.arched = true;
      st.winW = 4;
      st.winH = 9;
      st.winSpacing = 9;
      st.roofType = def.type === 'mill' ? 'sawtooth' : def.type === 'brewery' ? 'hip' : 'gable';
      st.roofMaxH = def.type === 'mill' ? 12 : 16;
      st.cornice = false;
      st.chimneys = 0;
      st.doorW = 10;
      st.doorH = 12;
      st.frame = M.FRAME_DARK;
      st.litChance = 0.55;
      break;
    case 'warehouse':
      st.wall = v ? M.BRICK_BROWN : M.BRICK_YELLOW;
      st.wallSide = st.wall;
      st.trim = M.BRICK_RED;
      st.ground = 'industrial';
      st.roofType = 'gableSide';
      st.roofMaxH = 18;
      st.winW = 3;
      st.winH = 6;
      st.winSpacing = 8;
      st.cornice = false;
      st.stringCourse = false;
      st.chimneys = 0;
      st.doorW = 10;
      st.doorH = 12;
      st.frame = M.FRAME_DARK;
      st.litChance = 0.3;
      break;
    case 'shipyard':
      st.wall = M.WOOD_WALL;
      st.wallSide = M.WOOD_WALL;
      st.trim = M.TIMBER;
      st.base = M.STONE_DARK;
      st.roof = M.CORRUGATED;
      st.ground = 'industrial';
      st.roofType = 'gable';
      st.cornice = false;
      st.stringCourse = false;
      st.chimneys = 1;
      st.doorW = 10;
      st.doorH = 11;
      st.frame = M.FRAME_DARK;
      break;
    default:
      break;
  }
  return st;
}

interface TypeSpec {
  layout: LayoutSpec;
  finish: Partial<Record<RoomKind, Finish>>;
}

const F_PUB: Finish = { floor: M.FLOOR_DARK, wall: M.WP_GREEN, wainscot: M.PANEL_DARK };
const F_PLAIN: Finish = { floor: M.FLOOR_WORN, wall: M.PLASTER_DIRTY, wainscot: 0 };
const F_STORE: Finish = { floor: M.FLOOR_FLAG, wall: M.PLASTER_DIRTY, wainscot: 0 };
const F_RICH: Finish = { floor: M.PARQUET, wall: M.WP_RED, wainscot: M.PANEL_DARK };
const F_OFFICE: Finish = { floor: M.PARQUET, wall: M.WP_OCHRE, wainscot: M.PANEL_LIGHT };
const F_INDUSTRY: Finish = { floor: M.FLOOR_FLAG, wall: M.BRICK_BROWN, wainscot: 0 };

function specFor(def: BuildingDef): TypeSpec {
  const v = def.style ?? 0;
  switch (def.type) {
    case 'hq':
      return {
        layout: { front: 'bar', depth: 0.56, back: [{ kind: 'office', w: 0.58 }, { kind: 'armory', w: 0.42 }] },
        finish: {
          bar: { floor: M.FLOOR_DARK, wall: def.hq === 'dadou' ? M.WP_BURGUNDY : M.WP_TEAL, wainscot: M.PANEL_DARK },
          office: { floor: M.PARQUET, wall: def.hq === 'dadou' ? M.WP_RED : M.WP_BLUE, wainscot: M.PANEL_DARK },
          armory: { floor: M.FLOOR_FLAG, wall: M.BRICK_BROWN, wainscot: 0 },
        },
      };
    case 'pub':
      return {
        layout: { front: 'bar', depth: 0.64, back: [{ kind: 'parlour', w: 0.5 }, { kind: 'storeroom', w: 0.5 }] },
        finish: {
          bar: { ...F_PUB, wall: [M.WP_GREEN, M.WP_BURGUNDY, M.WP_OCHRE][v % 3] },
          parlour: { floor: M.FLOOR_OAK, wall: M.WP_FADED, wainscot: M.PANEL_LIGHT },
          storeroom: F_STORE,
        },
      };
    case 'shop':
    case 'bakery':
    case 'butcher':
    case 'pawn':
    case 'jeweller':
      return {
        layout: { front: 'shop', depth: 0.68, back: [{ kind: 'backroom', w: 1 }] },
        finish: {
          shop:
            def.type === 'jeweller'
              ? { floor: M.CHECKER, wall: M.WP_BLUE, wainscot: M.PANEL_DARK }
              : def.type === 'butcher'
                ? { floor: M.CHECKER, wall: M.PLASTER, wainscot: M.MARBLE }
                : { floor: M.FLOOR_OAK, wall: M.WP_OCHRE, wainscot: M.PANEL_LIGHT },
          backroom: F_STORE,
        },
      };
    case 'gambling':
      return {
        layout: { front: 'gaming', depth: 0.74, back: [{ kind: 'cashier', w: 1 }] },
        finish: { gaming: { floor: M.PARQUET, wall: M.WP_RED, wainscot: M.PANEL_DARK }, cashier: F_OFFICE },
      };
    case 'theatre':
      return {
        layout: { front: 'foyer', depth: 0.3, back: [{ kind: 'auditorium', w: 1 }] },
        finish: {
          foyer: { floor: M.MARBLE, wall: M.WP_RED, wainscot: M.PANEL_DARK },
          auditorium: { floor: M.FLOOR_DARK, wall: M.WP_BURGUNDY, wainscot: M.PANEL_DARK },
        },
      };
    case 'cafe':
      return {
        layout: { front: 'cafe', depth: 0.7, back: [{ kind: 'kitchen', w: 1 }] },
        finish: {
          cafe: { floor: M.CHECKER, wall: v ? M.WP_GREEN : M.WP_TEAL, wainscot: M.PANEL_DARK },
          kitchen: { floor: M.FLOOR_FLAG, wall: M.PLASTER, wainscot: 0 },
        },
      };
    case 'bank':
      return {
        layout: { front: 'banking_hall', depth: 0.66, back: [{ kind: 'vault', w: 0.5 }, { kind: 'manager', w: 0.5 }] },
        finish: {
          banking_hall: { floor: M.MARBLE, wall: M.STONE, wainscot: M.MARBLE_BLACK },
          vault: { floor: M.STONE_DARK, wall: M.STONE_DARK, wainscot: 0 },
          manager: F_RICH,
        },
      };
    case 'exchange':
      return {
        layout: { front: 'trading_floor', depth: 0.75, back: [{ kind: 'director', w: 0.5 }, { kind: 'archive', w: 0.5 }] },
        finish: {
          trading_floor: { floor: M.MARBLE, wall: M.STONE, wainscot: M.MARBLE_BLACK },
          director: F_RICH,
          archive: F_OFFICE,
        },
      };
    case 'offices':
      return {
        layout: { front: 'clerks', depth: 0.62, back: [{ kind: 'director', w: 0.5 }, { kind: 'archive', w: 0.5 }] },
        finish: { clerks: F_OFFICE, director: F_RICH, archive: F_OFFICE },
      };
    case 'post':
      return {
        layout: { front: 'post_hall', depth: 0.62, back: [{ kind: 'sorting', w: 1 }] },
        finish: { post_hall: { floor: M.CHECKER, wall: M.WP_OCHRE, wainscot: M.PANEL_DARK }, sorting: F_STORE },
      };
    case 'customs':
      return {
        layout: { front: 'customs_hall', depth: 0.6, back: [{ kind: 'seized', w: 0.55 }, { kind: 'manager', w: 0.45 }] },
        finish: {
          customs_hall: { floor: M.FLOOR_OAK, wall: M.WP_OCHRE, wainscot: M.PANEL_DARK },
          seized: F_STORE,
          manager: F_OFFICE,
        },
      };
    case 'lodging':
      return {
        layout: { front: 'common', depth: 0.46, back: [{ kind: 'dormitory', w: 1 }] },
        finish: { common: F_PLAIN, dormitory: { floor: M.FLOOR_WORN, wall: M.WP_FADED, wainscot: 0 } },
      };
    case 'tenement':
    case 'housing':
      return {
        layout: { front: 'living', depth: 0.56, back: [{ kind: 'bedroom', w: 0.5 }, { kind: 'scullery', w: 0.5 }] },
        finish: {
          living: { floor: M.FLOOR_WORN, wall: M.WP_FADED, wainscot: 0 },
          bedroom: { floor: M.FLOOR_WORN, wall: M.WP_FADED, wainscot: 0 },
          scullery: F_STORE,
        },
      };
    case 'sweatshop':
      return {
        layout: { front: 'workshop', depth: 0.74, back: [{ kind: 'stock', w: 1 }] },
        finish: { workshop: F_PLAIN, stock: F_STORE },
      };
    case 'police':
      return {
        layout: { front: 'police_front', depth: 0.55, back: [{ kind: 'cells', w: 0.5 }, { kind: 'police_office', w: 0.5 }] },
        finish: {
          police_front: { floor: M.FLOOR_OAK, wall: M.WP_GREEN, wainscot: M.PANEL_DARK },
          cells: { floor: M.FLOOR_FLAG, wall: M.BRICK_YELLOW, wainscot: 0 },
          police_office: F_OFFICE,
        },
      };
    case 'mansion':
      return {
        layout: { front: 'salon', depth: 0.56, back: [{ kind: 'dining', w: 0.55 }, { kind: 'library', w: 0.45 }] },
        finish: {
          salon: { floor: M.PARQUET, wall: v ? M.WP_BLUE : M.WP_RED, wainscot: M.PANEL_DARK },
          dining: { floor: M.PARQUET, wall: M.WP_GREEN, wainscot: M.PANEL_DARK },
          library: { floor: M.PARQUET, wall: M.WP_BURGUNDY, wainscot: M.PANEL_DARK },
        },
      };
    case 'club':
      return {
        layout: { front: 'lounge', depth: 0.6, back: [{ kind: 'reading', w: 0.5 }, { kind: 'dining', w: 0.5 }] },
        finish: {
          lounge: { floor: M.PARQUET, wall: M.WP_GREEN, wainscot: M.PANEL_DARK },
          reading: { floor: M.PARQUET, wall: M.WP_BURGUNDY, wainscot: M.PANEL_DARK },
          dining: { floor: M.PARQUET, wall: M.WP_RED, wainscot: M.PANEL_DARK },
        },
      };
    case 'foundry':
      return {
        layout: { front: 'foundry_floor', depth: 0.78, back: [{ kind: 'foreman', w: 0.4 }, { kind: 'stock', w: 0.6 }] },
        finish: { foundry_floor: { ...F_INDUSTRY, floor: M.DIRT }, foreman: F_PLAIN, stock: F_STORE },
      };
    case 'brewery':
      return {
        layout: { front: 'brewhouse', depth: 0.7, back: [{ kind: 'cellar', w: 0.6 }, { kind: 'foreman', w: 0.4 }] },
        finish: { brewhouse: F_INDUSTRY, cellar: F_STORE, foreman: F_PLAIN },
      };
    case 'mill':
      return {
        layout: { front: 'mill_floor', depth: 0.8, back: [{ kind: 'stock', w: 0.6 }, { kind: 'foreman', w: 0.4 }] },
        finish: { mill_floor: { ...F_INDUSTRY, floor: M.FLOOR_WORN }, stock: F_STORE, foreman: F_PLAIN },
      };
    case 'gasworks':
      return { layout: { front: 'pump_room', depth: 1 }, finish: { pump_room: F_INDUSTRY } };
    case 'warehouse':
      return {
        layout: { front: 'warehouse_floor', depth: 1 },
        finish: { warehouse_floor: { floor: M.FLOOR_WORN, wall: v ? M.BRICK_BROWN : M.BRICK_YELLOW, wainscot: 0 } },
      };
    case 'shipyard':
      return { layout: { front: 'shed', depth: 1 }, finish: { shed: { floor: M.FLOOR_WORN, wall: M.WOOD_WALL, wainscot: 0 } } };
    default:
      return { layout: { front: 'storeroom', depth: 1 }, finish: { storeroom: F_PLAIN } };
  }
}

/** Façades exposées (non mitoyennes) d'un bâtiment. */
function exposure(ctx: GenContext, f: Frame): { left: boolean; right: boolean; back: boolean } {
  const test = (lx: number, lz: number): boolean => {
    const p = f.pt(lx, lz);
    return !ctx.inFootprint(p.x, p.z, -0.01);
  };
  return {
    left: test(-3, f.D / 2) && test(-3, 4) && test(-3, f.D - 4),
    right: test(f.W + 3, f.D / 2) && test(f.W + 3, 4) && test(f.W + 3, f.D - 4),
    back: test(f.W / 2, f.D + 3) && test(4, f.D + 3) && test(f.W - 4, f.D + 3),
  };
}

export function generateBuilding(ctx: GenContext, def: BuildingDef): BuildingInfo {
  const rng = new Rng(hash32(def.id * 7919 + 101));
  if (def.type === 'church') return buildChurch(ctx, def, rng);
  if (def.type === 'clocktower') return buildClockTower(ctx, def, rng);
  const st = styleFor(def);
  const f = new Frame(ctx, def.rect, def.door, def.id);
  const lv = computeLevels(def.stories, st.raised, def.type === 'warehouse' || def.type === 'foundry' || def.type === 'mill' || def.type === 'theatre' ? 19 : 15);
  const spec = specFor(def);
  const frontFinish = spec.finish[spec.layout.front] ?? F_PLAIN;
  buildMassing(f, st, lv, frontFinish.floor);
  const exp = exposure(ctx, f);

  // ---- porte principale
  const doorLx = Math.round(f.W / 2 - st.doorW / 2 + st.doorShift * f.W);
  // ---- rez-de-chaussée de la façade
  let fasciaY = lv.ceil - 3;
  if (st.ground === 'shop' || st.ground === 'pub') {
    fasciaY = shopfront(f, st, rng, lv, doorLx, st.ground === 'pub').fasciaY;
  }
  door(f, st, doorLx, lv, st.ground !== 'industrial', st.ground === 'plain' || st.ground === 'grand');
  if (st.raised > 0) steps(f, st, doorLx, st.doorW, st.raised);
  if (st.ground === 'plain' || st.ground === 'grand' || st.ground === 'industrial') {
    const cols = windowColumns(f.W, st.ground === 'industrial' ? st.winW + 1 : st.winW, st.winSpacing, 4);
    for (const c of cols) {
      if (c + st.winW + 2 > doorLx - 1 && c - 2 < doorLx + st.doorW + 1) continue;
      window(f, st, rng, c, lv.floorTop + 3, st.winW, Math.min(st.winH + 1, lv.ceil - lv.floorTop - 6));
    }
  }
  if (st.ground === 'industrial') {
    // portes de bois peint
    f.fill(doorLx - 1, lv.floorTop, -1, doorLx, lv.floorTop + st.doorH + 1, 0, st.trim);
    f.fill(doorLx + st.doorW, lv.floorTop, -1, doorLx + st.doorW + 1, lv.floorTop + st.doorH + 1, 0, st.trim);
    f.fill(doorLx - 1, lv.floorTop + st.doorH, -1, doorLx + st.doorW + 1, lv.floorTop + st.doorH + 2, 0, st.trim);
  }
  // ---- étages
  for (let s = 1; s < lv.storyBase.length; s++) {
    const base = lv.storyBase[s];
    const cols = windowColumns(f.W, st.winW, st.winSpacing, 4);
    for (const c of cols) window(f, st, rng, c, base + 3, st.winW, st.winH);
    // fenêtres latérales/arrière
    const sideCols = windowColumns(f.D, st.winW, st.winSpacing + 2, 5);
    if (st.sideWindows) {
      for (const c of sideCols) {
        if (exp.left) windowOnWall(f, st, rng, 'left', c, base + 3, st.winW, st.winH);
        if (exp.right) windowOnWall(f, st, rng, 'right', c, base + 3, st.winW, st.winH);
      }
      if (exp.back) for (const c of windowColumns(f.W, st.winW, st.winSpacing + 2, 5)) windowOnWall(f, st, rng, 'back', c, base + 3, st.winW, st.winH);
    }
    // portes de chargement des entrepôts
    if (def.type === 'warehouse') {
      const lx = Math.round(f.W / 2 - 3);
      f.fill(lx, base + 1, 0, lx + 6, base + 11, 1, M.PAINT_GREEN);
      f.fill(lx - 1, base + 11, -1, lx + 7, base + 12, 0, st.trim);
    }
  }
  // ---- fenêtres du rez-de-chaussée sur les côtés exposés
  if (st.sideWindows && st.ground !== 'industrial') {
    for (const c of windowColumns(f.D, st.winW, st.winSpacing + 4, 6)) {
      if (exp.left) windowOnWall(f, st, rng, 'left', c, lv.floorTop + 4, st.winW, Math.min(st.winH, 8));
      if (exp.right) windowOnWall(f, st, rng, 'right', c, lv.floorTop + 4, st.winW, Math.min(st.winH, 8));
    }
  }
  if (st.ground === 'industrial') {
    for (const c of windowColumns(f.D, st.winW + 1, st.winSpacing, 6)) {
      if (exp.left) windowOnWall(f, st, rng, 'left', c, lv.floorTop + 4, st.winW + 1, 9);
      if (exp.right) windowOnWall(f, st, rng, 'right', c, lv.floorTop + 4, st.winW + 1, 9);
    }
  }
  if (st.stringCourse) stringCourses(f, st, lv);
  if (st.quoins) quoins(f, st, lv);
  if (st.cornice) cornice(f, st, lv.wallTop - 2, exp.left || exp.right);

  // ---- portique à colonnes
  if (st.ground === 'grand' && (def.type === 'bank' || def.type === 'exchange' || def.type === 'club' || def.type === 'mansion' || def.type === 'theatre')) {
    portico(f, st, lv, doorLx, def.type);
  }

  // ---- toit et cheminées
  const top = roof(f, st, lv, rng);
  if (st.chimneys > 0 && st.roofType !== 'flat') {
    const roofH = st.roofType === 'gable' ? Math.min(st.roofMaxH, Math.floor(f.D / 2)) : Math.min(st.roofMaxH, 8);
    const positions: [number, number][] = [];
    if (st.chimneys >= 1) positions.push([3, Math.floor(f.D / 2) - 1]);
    if (st.chimneys >= 2) positions.push([f.W - 10, Math.floor(f.D / 2) - 1]);
    if (st.chimneys >= 3) positions.push([Math.floor(f.W / 2) - 3, Math.floor(f.D / 2) - 1]);
    if (st.chimneys >= 4) positions.push([Math.floor(f.W / 4), Math.floor(f.D / 2) - 1]);
    for (const [cx, cz] of positions) {
      if (cx < 0 || cx > f.W - 6) continue;
      const tip = chimney(f, st, cx, cz, lv.wallTop, roofH + 5, rng.int(2, 3));
      if (rng.chance(0.55)) ctx.smokes.push({ ...tip, big: false });
    }
  }
  // grande cheminée d'usine
  if (def.type === 'foundry' || def.type === 'brewery' || def.type === 'mill' || def.type === 'gasworks') {
    const h = def.type === 'foundry' ? 100 : def.type === 'gasworks' ? 64 : 84;
    const cx = f.W - 12;
    const cz = f.D - 12;
    f.fill(cx, lv.floorTop, cz, cx + 8, lv.floorTop + 4, cz + 8, st.trim);
    for (let y = lv.floorTop; y < lv.floorTop + h; y++) {
      const shrink = Math.floor((y - lv.floorTop) / 40);
      f.fill(cx + shrink, y, cz + shrink, cx + 8 - shrink, y + 1, cz + 8 - shrink, (y >> 3) % 6 === 0 ? st.trim : M.BRICK_RED);
    }
    f.fill(cx + 1, lv.floorTop + h, cz + 1, cx + 7, lv.floorTop + h + 1, cz + 7, M.IRON);
    f.fill(cx + 3, lv.floorTop + h - 2, cz + 3, cx + 5, lv.floorTop + h + 1, cz + 5, M.SOOT);
    const p = f.pt(cx + 4, cz + 4);
    ctx.smokes.push({ x: p.x, y: (lv.floorTop + h + 1) * VOXEL, z: p.z, big: true });
  }

  // ---- intérieur
  const rooms = layoutRooms(f, lv, spec.layout, st.wallSide === M.STUCCO_WHITE ? M.BRICK_YELLOW : M.PLASTER, doorLx + st.doorW / 2);
  const fu = new Furnisher(f, lv, rng);
  fu.boss = def.hq ?? null;
  // entrée dégagée
  fu.reserve(doorLx - 2, 0, doorLx + st.doorW + 2, 8);
  fu.reserve(doorLx, 0, doorLx + st.doorW, f.D * 0.6);
  for (const r of rooms) finishRoom(f, lv, r, spec.finish[r.kind] ?? F_PLAIN);
  // les finitions ont pu recouvrir le cadre de la porte : on le rouvre
  f.fill(doorLx, lv.floorTop, 0, doorLx + st.doorW, lv.floorTop + st.doorH, 2, 0);
  for (const r of rooms) furnishRoom(fu, r, def.type, def.style ?? 0);
  // battants de porte (animés côté client)
  f.prop('DOOR_LEAF', doorLx + st.doorW / 2, lv.floorTop, 1.5, 0, def.hq === 'dadou' ? 1 : def.hq === 'even' ? 2 : 0);

  // ---- éclairage extérieur et enseignes
  const signY = (fasciaY + 1.5) * VOXEL;
  const signCenter = f.pt(f.W / 2, -1.08);
  const facingOut = f.yaw(Math.PI);
  if (st.ground === 'pub' || st.ground === 'shop') {
    f.prop('LAMP_WALL', doorLx - 2.5, lv.floorTop + 9, -0.1, Math.PI);
    f.prop('LAMP_WALL', doorLx + st.doorW + 2.5, lv.floorTop + 9, -0.1, Math.PI);
  } else {
    f.prop('LAMP_WALL', doorLx - 2.2, lv.floorTop + 9, -1.1, Math.PI);
    f.prop('LAMP_WALL', doorLx + st.doorW + 2.2, lv.floorTop + 9, -1.1, Math.PI);
  }
  if (st.ground === 'pub' && lv.storyBase.length > 1) {
    f.prop('HANGING_SIGN', doorLx + st.doorW + 5, lv.storyBase[1] + 1, -1.8, Math.PI / 2, def.hq === 'dadou' ? 1 : def.hq === 'even' ? 2 : 0);
  }
  if (def.hq && lv.storyBase.length > 1) {
    const cols = windowColumns(f.W, st.winW, st.winSpacing, 4);
    for (let i = 0; i + 1 < cols.length; i++) {
      const bx = (cols[i] + st.winW + cols[i + 1]) / 2;
      f.prop('BANNER', bx, lv.storyBase[1] + 1, -0.6, Math.PI, 0);
    }
  }

  // ---- infos de gameplay
  const info = makeInfo(ctx, def, f, lv, rooms, doorLx, st, fu, top);
  info.sign = { x: signCenter.x, y: signY, z: signCenter.z, yaw: facingOut, w: Math.max(2, (f.W - 6) * VOXEL), h: 0.62 };
  return info;
}

/** Portique à colonnes et fronton devant la porte. */
function portico(f: Frame, st: Style, lv: Levels, doorLx: number, type: BuildingType): void {
  const span = type === 'mansion' ? 14 : Math.min(f.W - 8, 36);
  const x0 = Math.round(f.W / 2 - span / 2);
  const x1 = x0 + span;
  const depth = type === 'mansion' || type === 'theatre' ? 5 : 7;
  const topY = type === 'mansion' || type === 'theatre' ? lv.ceil + 1 : (lv.storyBase[1] ?? lv.ceil) + 8;
  const colMat = type === 'theatre' ? M.STUCCO : M.STONE;
  // dallage du portique
  f.fill(x0 - 1, 0, -depth - 1, x1 + 1, lv.floorTop, 0, st.base === M.STONE_DARK ? M.STONE_GREY : st.base);
  // marches sur l'avant du portique
  f.fill(x0 - 1, 0, -depth - 2, x1 + 1, Math.max(1, lv.floorTop - 1), -depth - 1, M.STONE_GREY);
  // colonnes
  // nombre pair de colonnes espacées d'au moins 2,5 m : jamais de colonne devant la porte
  let n = Math.max(2, Math.round(span / 11) + 1);
  if (n % 2 === 1) n--;
  for (let i = 0; i < n; i++) {
    const cx = Math.round(x0 + (i * (span - 2)) / (n - 1));
    const cz = -depth;
    f.fill(cx, lv.floorTop, cz, cx + 2, topY, cz + 2, colMat);
    f.fill(cx - 1, topY - 1, cz - 1, cx + 3, topY, cz + 3, colMat);
  }
  // entablement
  f.fill(x0 - 1, topY, -depth - 1, x1 + 1, topY + 3, 0, st.trim);
  f.fill(x0 - 2, topY + 3, -depth - 2, x1 + 2, topY + 4, 0, st.trim);
  // fronton triangulaire
  if (type !== 'theatre') {
    const half = Math.floor(span / 2) + 1;
    for (let k = 0; k < half; k += 2) {
      f.fill(x0 - 1 + k, topY + 4 + (k >> 1), -depth - 1, x1 + 1 - k, topY + 5 + (k >> 1), -1, st.trim);
    }
  } else {
    // marquise lumineuse du music-hall
    f.fill(x0 - 2, topY + 4, -depth - 2, x1 + 2, topY + 6, -depth + 1, M.GOLD);
  }
  void doorLx;
}

function makeInfo(
  ctx: GenContext,
  def: BuildingDef,
  f: Frame,
  lv: Levels,
  rooms: Room[],
  doorLx: number,
  st: Style,
  fu: Furnisher,
  top: number,
): BuildingInfo {
  const dc = doorLx + st.doorW / 2;
  const doorPt = f.pt(dc, 0);
  const outPt = f.pt(dc, -6 - st.raised * 0.5);
  const inPt = f.pt(dc, 6);
  const roomInfos: RoomInfo[] = rooms.map((r) => ({ kind: r.kind, rect: f.rectM(r.x0, r.z0, r.x1, r.z1) }));
  const zone = roomInfos.map((r) => r.rect);
  const front = rooms[0];
  const center = f.pt((front.x0 + front.x1) / 2, (front.z0 + front.z1) / 2);
  // points de défense : cellules libres réparties dans les pièces
  const defend: Pt[] = [];
  const spawn: Pt[] = [];
  for (const r of rooms) {
    for (let lx = r.x0 + 3; lx < r.x1 - 2; lx += 5) {
      for (let lz = r.z0 + 3; lz < r.z1 - 2; lz += 5) {
        if (cellFree(f, lv, lx, lz)) {
          defend.push(f.pt(lx + 0.5, lz + 0.5));
          if (r.front) spawn.push(f.pt(lx + 0.5, lz + 0.5));
        }
      }
    }
  }
  const guardOut: Pt[] = [f.pt(dc - 7, -6), f.pt(dc + 7, -6), f.pt(dc - 4, -10), f.pt(dc + 4, -10)];
  const info: BuildingInfo = {
    id: def.id,
    def,
    footprint: [def.rect[0], def.rect[1], def.rect[2], def.rect[3]],
    floorY: (lv.floorTop) * VOXEL,
    doors: [
      {
        x: doorPt.x,
        z: doorPt.z,
        side: def.door,
        out: outPt,
        in: inPt,
        width: st.doorW * VOXEL,
        main: true,
      },
    ],
    rooms: roomInfos,
    zone,
    center,
    defend,
    guardOut,
    spawn,
    height: top * VOXEL,
  };
  const m = fu.marks;
  if (m.desk) {
    const p = f.pt(m.desk.lx, m.desk.lz);
    info.desk = { ...p, yaw: f.yaw(m.desk.yaw ?? 0) };
  }
  if (m.deskSeat) info.deskSeat = f.pt(m.deskSeat.lx, m.deskSeat.lz);
  if (m.bar) info.recruit = f.pt(m.bar.lx, m.bar.lz);
  if (m.armory) info.armory = f.pt(m.armory.lx, m.armory.lz);
  // plaque du bureau
  const office = rooms.find((r) => r.kind === 'office');
  if (office && office.doorX !== undefined && office.doorZ !== undefined) {
    const p = f.pt(office.doorX + 3.6, office.doorZ - 1.08);
    info.plaque = { x: p.x, y: (lv.floorTop + 6.5) * VOXEL, z: p.z, yaw: f.yaw(Math.PI) };
  }
  ctx.buildings.push(info);
  return info;
}

function cellFree(f: Frame, lv: Levels, lx: number, lz: number): boolean {
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      if (f.get(lx + dx, lv.floorTop, lz + dz) !== 0) return false;
      if (f.get(lx + dx, lv.floorTop + 4, lz + dz) !== 0) return false;
    }
  return true;
}

export { cellFree };
