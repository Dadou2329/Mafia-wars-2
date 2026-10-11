// Génération complète de New York 2085 (identique sur le client et le serveur).

import { M } from '../../materials';
import { Rng, hash32 } from '../../util';
import { GROUND_VY, INV_VOXEL, VOXEL, VoxelWorld } from '../../voxel';
import {
  AREAS,
  BRIDGES,
  HIGHLINE_Y,
  BUILDINGS,
  EAST_LIMIT,
  FILLERS,
  ONE_TIMES_SQUARE,
  RIVERBED_Y,
  RIVER_X0,
  RIVER_X1,
  ROADS,
  SUBWAY_STATIONS,
  TKTS_STEPS,
  WATER_Y,
  WORLD_D,
  WORLD_H,
  WORLD_W,
  districtAt,
  isWater,
  type AreaDef,
  type DistrictId,
  type FillerDef,
  type Rect,
} from '../plan';
import { GenContext, type BuildingInfo } from './context';
import { generateBuilding } from './buildings';
import { repairConnectivity } from './connect';
import { placeSecurity } from './security';
import { placeClinics } from './clinics';
import { buildBoundaries, buildBridges, buildSubway, stairRect } from './infra';
import { Frame } from './frame';
import { FACADE_DEFAULT, cladFace, curtainBlock, hollowBlock, ledRing, piers, windowRow, type Facade, type Wall } from './facade';
import { cornice, fireEscape, parapet, waterTower } from './structure';

export const CITY_SEED = 20852085;

export interface City {
  world: VoxelWorld;
  ctx: GenContext;
  buildings: BuildingInfo[];
  /** Carte 2D (voxels) : voir GM. */
  groundMap: Uint8Array;
  gw: number;
  gd: number;
}

export const GM = { ROAD: 0, SIDEWALK: 1, CURB: 2, BUILDING: 3, AREA: 4, WATER: 5, BRIDGE: 6, BOUNDARY: 7, PLAZA: 8, PARK: 9 } as const;

const V = (m: number): number => Math.round(m * INV_VOXEL);
/** Rapport de surface avec le New York du premier plan (288 × 240 m) : densité du mobilier urbain. */
const AREA_K = (WORLD_W * WORLD_D) / (288 * 240);

const overlaps = (a: Rect, b: Rect): boolean => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** Ouvertures des bouches de métro (à garder libres de tout mobilier). */
const STAIRS: Rect[] = SUBWAY_STATIONS.flatMap((s) => s.entrances.map((e) => stairRect(e.x, e.z, e.dir)));
const onStairs = (x: number, z: number, m = 0.8): boolean => STAIRS.some((r) => x >= r[0] - m && x < r[2] + m && z >= r[1] - m && z < r[3] + m);
/** Emprise des promenades surélevées et de leurs escaliers (rien de haut dessous). */
const HIGHLINES: Rect[] = AREAS.filter((a) => a.kind === 'highline').map((a) => [a.rect[0], a.rect[1] - 8, a.rect[2], a.rect[3] + 8]);
const underHighLine = (x: number, z: number): boolean => HIGHLINES.some((r) => x >= r[0] - 1 && x < r[2] + 1 && z >= r[1] && z < r[3]);

export function generateCity(seed = CITY_SEED): City {
  const sx = WORLD_W * INV_VOXEL;
  const sz = WORLD_D * INV_VOXEL;
  const sy = WORLD_H * INV_VOXEL;
  const world = new VoxelWorld(sx, sy, sz);
  const ctx = new GenContext(world, seed);
  const rng = new Rng(seed);
  for (const b of BUILDINGS) ctx.footprints.push(b.rect);
  for (const f of FILLERS) ctx.footprints.push(f.rect);
  ctx.footprints.push(ONE_TIMES_SQUARE, TKTS_STEPS);

  // ------------------------------------------------------------------ sous-sol
  world.fill(0, 0, 0, sx, GROUND_VY - 1, sz, M.BEDROCK);
  world.fill(0, GROUND_VY - 1, 0, sx, GROUND_VY, sz, M.ASPHALT);

  // ------------------------------------------------------------------ carte au sol 2D
  const gm = new Uint8Array(sx * sz).fill(GM.SIDEWALK);
  const idx = (x: number, z: number) => z * sx + x;
  const markRect = (r: readonly number[], v: number, onlyIf?: number) => {
    const x0 = Math.max(0, V(r[0]));
    const z0 = Math.max(0, V(r[1]));
    const x1 = Math.min(sx, V(r[2]));
    const z1 = Math.min(sz, V(r[3]));
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (onlyIf === undefined || gm[idx(x, z)] === onlyIf) gm[idx(x, z)] = v;
  };
  for (const r of ROADS) markRect(r.rect, GM.ROAD);
  for (const a of AREAS) {
    if (a.kind === 'park' || a.kind === 'lake' || a.kind === 'reservoir') markRect(a.rect, GM.PARK);
    else if (a.kind === 'plaza' || a.kind === 'square' || a.kind === 'yard') markRect(a.rect, GM.PLAZA, GM.SIDEWALK);
  }
  for (const b of BUILDINGS) markRect(b.rect, GM.BUILDING);
  for (const f of FILLERS) markRect(f.rect, GM.BUILDING);
  markRect(ONE_TIMES_SQUARE, GM.BUILDING);
  markRect(TKTS_STEPS, GM.BUILDING);
  // limites : viaduc ferroviaire au nord, voie rapide (BQE) à l'est, viaduc de l'Atlantic Avenue au sud de Brooklyn
  markRect([0, 0, WORLD_W, 6], GM.BOUNDARY);
  markRect([EAST_LIMIT, 6, WORLD_W, WORLD_D - 6], GM.BOUNDARY);
  markRect([RIVER_X1, WORLD_D - 6, WORLD_W, WORLD_D], GM.BOUNDARY);
  // l'eau passe sous les viaducs et sous la voie rapide
  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      const xm = (x + 0.5) * VOXEL;
      const zm = (z + 0.5) * VOXEL;
      if (isWater(xm, zm)) gm[idx(x, z)] = GM.WATER;
    }
  // ponts (tablier complet)
  for (const br of BRIDGES) markRect(br.rect, GM.BRIDGE, GM.WATER);
  // bordures : trottoir au contact de la chaussée
  for (let z = 1; z < sz - 1; z++)
    for (let x = 1; x < sx - 1; x++) {
      const g = gm[idx(x, z)];
      if (g !== GM.SIDEWALK && g !== GM.PLAZA) continue;
      if (gm[idx(x + 1, z)] === GM.ROAD || gm[idx(x - 1, z)] === GM.ROAD || gm[idx(x, z + 1)] === GM.ROAD || gm[idx(x, z - 1)] === GM.ROAD) gm[idx(x, z)] = GM.CURB;
    }
  // écriture des voxels du sol
  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      const g = gm[idx(x, z)];
      if (g === GM.SIDEWALK || g === GM.BOUNDARY) world.set(x, GROUND_VY, z, ((x >> 6) + (z >> 6)) % 7 === 0 ? M.SIDEWALK_DARK : M.SIDEWALK);
      else if (g === GM.CURB) world.set(x, GROUND_VY, z, M.CURB);
      else if (g === GM.PLAZA) world.set(x, GROUND_VY, z, M.SIDEWALK_DARK);
      else if (g === GM.BUILDING || g === GM.PARK) world.set(x, GROUND_VY, z, M.SIDEWALK);
      else if (g === GM.ROAD && ((x * 7 + z * 13) & 255) < 3) world.set(x, GROUND_VY - 1, z, M.ASPHALT_WORN);
    }
  roadMarkings(world, gm, sx, sz);

  // ------------------------------------------------------------------ eau : East River et Newtown Creek
  const bedVy = Math.round(RIVERBED_Y * INV_VOXEL) + GROUND_VY;
  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      if (gm[idx(x, z)] !== GM.WATER) continue;
      world.fill(x, bedVy, z, x + 1, GROUND_VY + 1, z + 1, 0);
      world.set(x, bedVy - 1, z, M.RIVERBED);
    }
  // quais : murs de granit le long de l'eau, garde-corps
  quayWalls(ctx, gm, sx, sz, bedVy);

  // ------------------------------------------------------------------ infrastructures
  buildBridges(ctx);
  buildSubway(ctx);
  buildBoundaries(ctx);

  // ------------------------------------------------------------------ espaces publics
  const gAt = (x: number, z: number): number => {
    const vx = Math.floor(x * INV_VOXEL);
    const vz = Math.floor(z * INV_VOXEL);
    if (vx < 0 || vz < 0 || vx >= sx || vz >= sz) return GM.BOUNDARY;
    return gm[vz * sx + vx];
  };
  for (const a of AREAS) buildArea(ctx, a, rng.fork(hash32(a.rect[0] * 31 + a.rect[1] * 7 + a.rect[2])), gAt);
  oneTimesSquare(ctx);

  // ------------------------------------------------------------------ bâtiments
  for (const def of BUILDINGS) {
    const from = ctx.props.length;
    const info = generateBuilding(ctx, def);
    // aucune pièce ne doit rester enfermée derrière des chaises ou des tables
    repairConnectivity(ctx, info, from);
    if (def.security) placeSecurity(ctx, info);
  }
  placeClinics(ctx);
  for (const f of FILLERS) buildFiller(ctx, f, rng.fork(hash32(f.rect[0] * 131 + f.rect[1])));

  // ------------------------------------------------------------------ mobilier urbain
  streetFurniture(ctx, gAt, rng);
  waterfront(ctx);
  holograms(ctx);

  world.compact();
  return { world, ctx, buildings: ctx.buildings, groundMap: gm, gw: sx, gd: sz };
}

// ======================================================================================
// Marquages routiers

function roadMarkings(world: VoxelWorld, gm: Uint8Array, sx: number, sz: number): void {
  const inCross = (x: number, z: number, axis: 'x' | 'z') => {
    // vrai si la cellule est dans une chaussée d'axe opposé (carrefour)
    for (const r of ROADS) {
      if (r.axis === axis) continue;
      if (x >= V(r.rect[0]) && x < V(r.rect[2]) && z >= V(r.rect[1]) && z < V(r.rect[3])) return true;
    }
    return false;
  };
  const y = GROUND_VY - 1;
  for (const r of ROADS) {
    const [x0, z0, x1, z1] = [V(r.rect[0]), V(r.rect[1]), V(r.rect[2]), V(r.rect[3])];
    const bridge = r.name.startsWith('Pont');
    if (r.axis === 'z') {
      const mid = Math.round((x0 + x1) / 2);
      for (let z = z0; z < z1; z++) {
        if (inCross(mid, z, 'z')) continue;
        if (gm[z * sx + mid] !== 0 && !bridge) continue;
        // double ligne jaune centrale, lignes de rive blanches
        world.set(mid - 2, y, z, M.LINE_YELLOW);
        world.set(mid + 1, y, z, M.LINE_YELLOW);
        world.set(x0 + 1, y, z, M.LINE_WHITE);
        world.set(x1 - 2, y, z, M.LINE_WHITE);
      }
      // passages piétons de part et d'autre des carrefours
      for (let z = z0; z < z1; z++) {
        if (!inCross(mid, z, 'z')) continue;
        const before = !inCross(mid, z - 1, 'z');
        const after = !inCross(mid, z + 1, 'z');
        if (before) zebra(world, x0, z - 14, x1, z - 2, 'x');
        if (after) zebra(world, x0, z + 2, x1, z + 14, 'x');
      }
    } else {
      const mid = Math.round((z0 + z1) / 2);
      for (let x = x0; x < x1; x++) {
        if (inCross(x, mid, 'x')) continue;
        if (gm[mid * sx + x] !== 0 && !bridge) continue;
        world.set(x, y, mid - 2, M.LINE_YELLOW);
        world.set(x, y, mid + 1, M.LINE_YELLOW);
        world.set(x, y, z0 + 1, M.LINE_WHITE);
        world.set(x, y, z1 - 2, M.LINE_WHITE);
      }
      for (let x = x0; x < x1; x++) {
        if (!inCross(x, mid, 'x')) continue;
        if (!inCross(x - 1, mid, 'x')) zebra(world, x - 14, z0, x - 2, z1, 'z');
        if (!inCross(x + 1, mid, 'x')) zebra(world, x + 2, z0, x + 14, z1, 'z');
      }
    }
  }
  void sz;
}

/** Bandes de passage piéton (les bandes sont parallèles à la circulation). */
function zebra(world: VoxelWorld, x0: number, z0: number, x1: number, z1: number, stripesAlong: 'x' | 'z'): void {
  const y = GROUND_VY - 1;
  for (let z = z0; z < z1; z++)
    for (let x = x0; x < x1; x++) {
      if (world.get(x, y, z) !== M.ASPHALT && world.get(x, y, z) !== M.ASPHALT_WORN) continue;
      if (world.get(x, GROUND_VY, z) !== 0) continue;
      const k = stripesAlong === 'x' ? x : z;
      if (((k % 6) + 6) % 6 < 3) world.set(x, y, z, M.LINE_WHITE);
    }
}

// ======================================================================================
// Quais

function quayWalls(ctx: GenContext, gm: Uint8Array, sx: number, sz: number, bedVy: number): void {
  const w = ctx.world;
  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= sx || z >= sz ? GM.BOUNDARY : gm[z * sx + x]);
  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      const g = at(x, z);
      if (g === GM.WATER || g === GM.BRIDGE) continue;
      const nearWater = at(x + 1, z) === GM.WATER || at(x - 1, z) === GM.WATER || at(x, z + 1) === GM.WATER || at(x, z - 1) === GM.WATER;
      if (!nearWater) continue;
      // mur de quai (granit) du lit jusqu'au niveau de la rue, garde-corps au-dessus
      w.fill(x, bedVy - 1, z, x + 1, GROUND_VY + 1, z + 1, M.QUAY);
      if (g === GM.BOUNDARY) continue; // sous les viaducs : pas de garde-corps
      w.fill(x, GROUND_VY + 1, z, x + 1, GROUND_VY + 6, z + 1, M.BARRIER);
      if ((x + z) % 8 === 0) w.fill(x, GROUND_VY + 1, z, x + 1, GROUND_VY + 5, z + 1, M.IRON);
      w.fill(x, GROUND_VY + 4, z, x + 1, GROUND_VY + 5, z + 1, M.IRON);
    }
}

// ======================================================================================
// Parcs, lacs, places, promenades, terrains

type GroundAt = (x: number, z: number) => number;

function buildArea(ctx: GenContext, a: AreaDef, rng: Rng, g: GroundAt): void {
  switch (a.kind) {
    case 'park':
      park(ctx, a, rng);
      break;
    case 'lake':
    case 'reservoir':
      lake(ctx, a, rng);
      break;
    case 'plaza':
      timesSquare(ctx, a);
      break;
    case 'square':
      square(ctx, a, rng);
      break;
    case 'promenade':
      promenade(ctx, a, rng, g);
      break;
    case 'yard':
      yard(ctx, a, rng);
      break;
    case 'highline':
      highLine(ctx, a, rng);
      break;
  }
}

/**
 * Promenade plantée sur un ancien viaduc ferroviaire (la High Line) : tablier à HIGHLINE_Y, piles
 * d'acier, garde-corps, allée, massifs, arbustes, bancs, lampadaires, escaliers aux deux bouts.
 * Le rectangle est long selon z.
 */
function highLine(ctx: GenContext, a: AreaDef, rng: Rng): void {
  const w = ctx.world;
  const [x0, z0, x1, z1] = a.rect.map(V);
  const top = GROUND_VY + V(HIGHLINE_Y); // première couche d'air au-dessus du tablier
  for (let z = z0; z < z1; z++) {
    // tablier, rive de béton, poutres d'acier riveté
    w.fill(x0, top - 3, z, x1, top - 1, z + 1, M.STEEL_BLUE);
    w.fill(x0, top - 1, z, x1, top, z + 1, M.GRAVEL);
    for (const x of [x0, x1 - 1]) {
      w.fill(x, top - 1, z, x + 1, top, z + 1, M.CONCRETE);
      w.fill(x, top, z, x + 1, top + 4, z + 1, (z - z0) % 3 === 0 ? M.IRON : M.BARRIER);
      w.set(x, top + 3, z, M.IRON);
    }
    // massifs plantés en alternance le long du bord ouest
    if (Math.floor((z - z0) / 24) % 2 === 0) w.fill(x0 + 1, top - 1, z, x0 + 9, top, z + 1, (z & 3) === 0 ? M.DIRT : M.GRASS);
    // rails conservés dans l'allée
    if (((z - z0) & 15) < 2) w.fill(x0 + 10, top - 1, z, x1 - 2, top, z + 1, M.WALNUT);
  }
  // piles d'acier tous les 8 m (la promenade du quai passe dessous)
  for (let z = z0 + 4; z < z1 - 2; z += 32) for (const x of [x0 + 1, x1 - 3]) w.fill(x, GROUND_VY + 1, z, x + 2, top - 3, z + 2, M.STEEL_BLUE);
  // arbustes, bancs et lampadaires sur le tablier
  const y = HIGHLINE_Y;
  for (let zm = a.rect[1] + 4, k = 0; zm < a.rect[3] - 4; zm += 7, k++) {
    if (Math.floor(V(zm - a.rect[1]) / 24) % 2 === 0 && k % 2 === 0) tree(w, x0 + 4, top, V(zm), rng, 0.5, rng.chance(0.3));
    else if (k % 3 === 1) ctx.prop('BENCH', a.rect[2] - 1.0, y, zm, -Math.PI / 2, 0);
    else ctx.prop('PARK_LAMP', a.rect[2] - 0.8, y, zm, 0, 0);
  }
  // escaliers aux deux bouts (une marche par voxel, le long de l'axe), vers la promenade du quai
  const rise = top - (GROUND_VY + 1);
  for (const end of [-1, 1]) {
    for (let k = 0; k < rise; k++) {
      const z = end < 0 ? z0 - 1 - k : z1 + k;
      const yy = top - 1 - k; // dessus de la marche
      w.fill(x0 + 1, GROUND_VY + 1, z, x1 - 1, yy, z + 1, M.CONCRETE);
      w.fill(x0 + 1, yy, z, x1 - 1, yy + 12, z + 1, 0);
      for (const x of [x0, x1 - 1]) w.fill(x, GROUND_VY + 1, z, x + 1, yy + 4, z + 1, x === x0 ? M.BARRIER : M.IRON);
    }
  }
  ctx.light((a.rect[0] + a.rect[2]) / 2, y + 2, (a.rect[1] + a.rect[3]) / 2, 0.6, 10, 0xffe0b0);
}

function inRect(x: number, z: number, r: readonly number[], m = 0): boolean {
  return x >= r[0] - m && x < r[2] + m && z >= r[1] - m && z < r[3] + m;
}

/** Ellipse d'un lac (avec une marge en m). */
function inEllipse(x: number, z: number, r: Rect, m = 0): boolean {
  const dx = (x - (r[0] + r[2]) / 2) / ((r[2] - r[0]) / 2 + m);
  const dz = (z - (r[1] + r[3]) / 2) / ((r[3] - r[1]) / 2 + m);
  return dx * dx + dz * dz < 1;
}

/** Parc : pelouse, allée de ceinture, allées sinueuses, muret de pierre, arbres, rochers, lampadaires. */
function park(ctx: GenContext, a: AreaDef, rng: Rng): void {
  const w = ctx.world;
  const [x0m, z0m, x1m, z1m] = a.rect;
  const x0 = V(x0m);
  const z0 = V(z0m);
  const x1 = V(x1m);
  const z1 = V(z1m);
  const W = x1m - x0m;
  const D = z1m - z0m;
  const cxm = (x0m + x1m) / 2;
  const czm = (z0m + z1m) / 2;
  const inset = Math.min(W, D) > 40 ? 5 : 3.5;
  const lx0 = x0m + inset;
  const lx1 = x1m - inset;
  const lz0 = z0m + inset;
  const lz1 = z1m - inset;
  const ampZ = Math.min(5, D * 0.1);
  const ampX = Math.min(4, W * 0.1);
  const pathEW = (xm: number) => czm + Math.sin((xm - x0m) * 0.09) * ampZ;
  const pathNS = (zm: number) => cxm + Math.sin((zm - z0m) * 0.11) * ampX;
  const pathDist = (xm: number, zm: number): number => {
    const inside = xm > lx0 && xm < lx1 && zm > lz0 && zm < lz1;
    const dLoop = inside ? Math.min(xm - lx0, lx1 - xm, zm - lz0, lz1 - zm) : Math.hypot(Math.max(lx0 - xm, 0, xm - lx1), Math.max(lz0 - zm, 0, zm - lz1));
    return Math.min(dLoop, Math.abs(zm - pathEW(xm)), Math.abs(xm - pathNS(zm)));
  };
  const waters = AREAS.filter((l) => (l.kind === 'lake' || l.kind === 'reservoir') && overlaps(l.rect, a.rect));
  const wet = (xm: number, zm: number, m: number) => waters.some((l) => inEllipse(xm, zm, l.rect, m));
  // entrées dans le muret : au bout des allées transversales, et régulièrement sur les grands côtés
  const gapsX: number[] = [pathNS(z0m), pathNS(z1m)];
  const gapsZ: number[] = [pathEW(x0m), pathEW(x1m)];
  const extra = (len: number, from: number, list: number[]) => {
    if (len < 60) return;
    for (const t of [0.22, 0.78]) list.push(from + len * t);
  };
  extra(W, x0m, gapsX);
  extra(D, z0m, gapsZ);
  for (let z = z0; z < z1; z++)
    for (let x = x0; x < x1; x++) {
      const xm = (x + 0.5) * VOXEL;
      const zm = (z + 0.5) * VOXEL;
      const edgeX = x < x0 + 2 || x >= x1 - 2;
      const edgeZ = z < z0 + 2 || z >= z1 - 2;
      if (edgeX || edgeZ) {
        const gap = (edgeZ && gapsX.some((gx) => Math.abs(xm - gx) < 2)) || (edgeX && gapsZ.some((gz) => Math.abs(zm - gz) < 2));
        if (gap) w.set(x, GROUND_VY, z, M.GRAVEL);
        else w.fill(x, GROUND_VY, z, x + 1, GROUND_VY + 3, z + 1, M.LIMESTONE);
        continue;
      }
      w.set(x, GROUND_VY, z, pathDist(xm, zm) < 0.85 ? M.GRAVEL : M.GRASS);
    }
  const fountain0 = a.fountain;
  const busy = (xm: number, zm: number, r: number) =>
    (fountain0 && Math.hypot(xm - fountain0[0], zm - fountain0[1]) < r + 4) || (a.monument && Math.hypot(xm - cxm, zm - czm) < r + 7) || ctx.inFootprint(xm, zm, r);
  // arbres
  const nTrees = Math.round((W * D) / 55);
  for (let i = 0, n = 0; i < nTrees * 3 && n < nTrees; i++) {
    const tx = rng.range(x0m + 2.5, x1m - 2.5);
    const tz = rng.range(z0m + 2.5, z1m - 2.5);
    if (pathDist(tx, tz) < 2.4 || wet(tx, tz, 2.5) || busy(tx, tz, 2.5)) continue;
    tree(w, tx * INV_VOXEL, GROUND_VY + 1, tz * INV_VOXEL, rng, rng.range(0.85, 1.3), rng.chance(0.12));
    n++;
  }
  // rochers de schiste
  const nRocks = Math.max(1, Math.round((W * D) / 1500));
  for (let i = 0; i < nRocks * 3; i++) {
    const rx = rng.range(x0m + 5, x1m - 5);
    const rz = rng.range(z0m + 5, z1m - 5);
    if (pathDist(rx, rz) < 3 || wet(rx, rz, 3) || busy(rx, rz, 3)) continue;
    rock(w, V(rx), V(rz), rng);
  }
  // lampadaires et bancs le long de l'allée de ceinture
  const per = 2 * (lx1 - lx0 + (lz1 - lz0));
  for (let s = 3, k = 0; s < per; s += 12, k++) {
    let px: number;
    let pz: number;
    let nx: number;
    let nz: number;
    const a1 = lx1 - lx0;
    const a2 = a1 + (lz1 - lz0);
    const a3 = a2 + a1;
    if (s < a1) [px, pz, nx, nz] = [lx0 + s, lz0, 0, 1];
    else if (s < a2) [px, pz, nx, nz] = [lx1, lz0 + (s - a1), -1, 0];
    else if (s < a3) [px, pz, nx, nz] = [lx1 - (s - a2), lz1, 0, -1];
    else [px, pz, nx, nz] = [lx0, lz1 - (s - a3), 1, 0];
    const lx = px + nx * 1.4;
    const lz = pz + nz * 1.4;
    if (wet(lx, lz, 1) || busy(lx, lz, 1)) continue;
    if (k % 2 === 0) ctx.prop('PARK_LAMP', lx, 0.25, lz, 0, 0);
    else ctx.prop('BENCH', lx, 0.25, lz, Math.atan2(-nx, -nz), 0);
  }
  if (fountain0) fountain(ctx, fountain0[0], fountain0[1]);
  if (a.monument === 'arch') washingtonArch(ctx, cxm, czm);
  else if (a.monument === 'tomb') grantsTomb(ctx, cxm, czm);
}

/** Lac (avec le Bow Bridge et des barques) ou réservoir (grille et piste de course tout autour). */
function lake(ctx: GenContext, a: AreaDef, rng: Rng): void {
  const w = ctx.world;
  const [x0m, z0m, x1m, z1m] = a.rect;
  const x0 = V(x0m);
  const z0 = V(z0m);
  const x1 = V(x1m);
  const z1 = V(z1m);
  const cxm = (x0m + x1m) / 2;
  const czm = (z0m + z1m) / 2;
  const reservoir = a.kind === 'reservoir';
  const pad = reservoir ? 8 : 0;
  for (let z = z0 - pad; z < z1 + pad; z++)
    for (let x = x0 - pad; x < x1 + pad; x++) {
      const dx = (x + 0.5 - (x0 + x1) / 2) / ((x1 - x0) / 2);
      const dz = (z + 0.5 - (z0 + z1) / 2) / ((z1 - z0) / 2);
      const n = (Math.sin(x * 0.11) * 0.08 + Math.sin(z * 0.13) * 0.07) * (reservoir ? 0.25 : 1);
      const d = dx * dx + dz * dz + n;
      if (d > 1) {
        // piste de course autour du réservoir
        if (reservoir && d < 1.16 && w.get(x, GROUND_VY, z) === M.GRASS) w.set(x, GROUND_VY, z, M.GRAVEL);
        continue;
      }
      if (d > 0.86) {
        w.fill(x, GROUND_VY - 3, z, x + 1, GROUND_VY + 1, z + 1, reservoir ? M.GRANITE : M.ROCK);
        if (reservoir && d > 0.9 && d < 0.95) {
          // grille de fer forgé
          w.fill(x, GROUND_VY + 1, z, x + 1, GROUND_VY + 5, z + 1, (x + z) % 3 === 0 ? M.IRON : M.BARRIER);
          w.set(x, GROUND_VY + 4, z, M.IRON);
        }
        continue;
      }
      w.fill(x, GROUND_VY - 10, z, x + 1, GROUND_VY + 1, z + 1, 0);
      w.set(x, GROUND_VY - 11, z, M.RIVERBED);
    }
  const boatY = WATER_Y + 0.08;
  if (reservoir) {
    ctx.light(cxm, 4, z0m - 1, 0.6, 10, 0xffe0b0);
    return;
  }
  // Bow Bridge : arche de fonte blanche
  const bz = V(czm);
  for (let x = x0 + 6; x < x1 - 6; x++) {
    const t = (x - x0 - 6) / (x1 - x0 - 12);
    const y = GROUND_VY + 1 + Math.round(Math.sin(t * Math.PI) * 4);
    w.fill(x, y - 1, bz - 6, x + 1, y, bz + 6, M.PAINT_CREAM);
    w.fill(x, y, bz - 6, x + 1, y + 4, bz - 5, x % 3 === 0 ? M.PAINT_CREAM : M.BARRIER);
    w.fill(x, y, bz + 5, x + 1, y + 4, bz + 6, x % 3 === 0 ? M.PAINT_CREAM : M.BARRIER);
    w.fill(x, y + 3, bz - 6, x + 1, y + 4, bz - 5, M.PAINT_CREAM);
    w.fill(x, y + 3, bz + 5, x + 1, y + 4, bz + 6, M.PAINT_CREAM);
  }
  const hw = (x1m - x0m) / 2;
  const hd = (z1m - z0m) / 2;
  ctx.prop('BOAT', cxm - hw * 0.45, boatY, czm - hd * 0.45, 0.6, 0, -1);
  ctx.prop('BOAT', cxm + hw * 0.5, boatY, czm + hd * 0.5, 2.1, 1, -1);
  ctx.prop('BOAT', cxm - hw * 0.3, boatY, czm + hd * 0.55, 1.2, 2, -1);
  void rng;
}

/** Times Square : dalles rouges et lumineuses, gradins rouges, lampadaires, kiosques. */
function timesSquare(ctx: GenContext, a: AreaDef): void {
  const w = ctx.world;
  const [x0m, z0m, x1m, z1m] = a.rect;
  const x0 = V(x0m);
  const z0 = V(z0m);
  const x1 = V(x1m);
  const z1 = V(z1m);
  for (let z = z0; z < z1; z++)
    for (let x = x0; x < x1; x++) {
      if (w.get(x, GROUND_VY, z) === 0) continue; // chaussée, bouches de métro
      const xm = x * VOXEL;
      const zm = z * VOXEL;
      const led = ((Math.floor(xm / 3) + Math.floor(zm / 3)) & 3) === 0;
      w.set(x, GROUND_VY, z, led ? M.PAVER_LED : M.PLAZA_RED);
    }
  // les marches rouges (TKTS), tournées vers le sud et les écrans
  const [sx0, sz0, sx1, sz1] = TKTS_STEPS.map(V);
  const rows = 8;
  const depth = Math.floor((sz1 - sz0) / rows);
  for (let k = 0; k < rows; k++) {
    w.fill(sx0, GROUND_VY + 1, sz0 + k * depth, sx1, GROUND_VY + 1 + (rows - k) * 2, sz0 + (k + 1) * depth, k % 2 === 0 ? M.LED_RED : M.STUCCO_RED);
  }
  // garde-corps à l'arrière et sur les côtés des gradins
  w.fill(sx0, GROUND_VY + 1 + rows * 2, sz0, sx1, GROUND_VY + 5 + rows * 2, sz0 + 1, M.GLASS_CLEAR);
  ctx.light((TKTS_STEPS[0] + TKTS_STEPS[2]) / 2, 2, TKTS_STEPS[3] + 1, 0.9, 9, 0xff3040);
  // lampadaires doubles et mobilier, là où il y a la place
  const free = (x: number, z: number, m = 0.6) => !ctx.inFootprint(x, z, m) && !onStairs(x, z) && w.get(Math.floor(x * INV_VOXEL), GROUND_VY + 1, Math.floor(z * INV_VOXEL)) === 0 && w.get(Math.floor(x * INV_VOXEL), GROUND_VY, Math.floor(z * INV_VOXEL)) !== 0;
  for (let zm = z0m + 3; zm < z1m - 2; zm += 9) {
    for (const xm of [x0m + 1.2, x1m - 1.2]) if (free(xm, zm, 0.4)) ctx.prop('STREET_LIGHT_DOUBLE', xm, 0.25, zm, 0, 0);
  }
  const items: [Parameters<GenContext['prop']>[0], number, number, number][] = [
    ['HOLO_KIOSK', x0m + 4, z0m + 15, Math.PI / 2],
    ['FOOD_CART', x1m - 4, z1m - 4, Math.PI],
    ['FOOD_CART', x0m + 5, z1m - 12, 0],
    ['NEWS_STAND', x1m - 3, z0m + 4, -Math.PI / 2],
    ['VENDING_MACHINE', x1m - 2, z1m - 15, -Math.PI / 2],
    ['HOLO_BOOTH', x0m + 4, z1m - 4, Math.PI / 2],
  ];
  for (const [k, x, z, yaw] of items) if (free(x, z, 1.4)) ctx.prop(k, x, 0.25, z, yaw, 0);
}

/** Place pavée : taureau de bronze (Bowling Green) ou fontaine (Grand Army Plaza). */
function square(ctx: GenContext, a: AreaDef, rng: Rng): void {
  const w = ctx.world;
  const [x0, z0, x1, z1] = a.rect.map(V);
  const cxm = (a.rect[0] + a.rect[2]) / 2;
  const czm = (a.rect[1] + a.rect[3]) / 2;
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (w.get(x, GROUND_VY, z) !== 0) w.set(x, GROUND_VY, z, ((x + z) & 15) < 8 ? M.GRANITE : M.SIDEWALK);
  if (a.statue === 'fountain') fountain(ctx, cxm, czm);
  else if (a.statue === 'bull') ctx.prop('BULL_STATUE', cxm, 0.25, czm, Math.PI * 0.75, 0);
  else {
    // square sans statue (Zuccotti Park) : bosquet régulier de petits arbres, bancs de granit entre les rangées
    const nx = Math.max(2, Math.floor((a.rect[2] - a.rect[0]) / 5));
    const nz = Math.max(2, Math.floor((a.rect[3] - a.rect[1]) / 5));
    const sx = (a.rect[2] - a.rect[0]) / nx;
    const sz = (a.rect[3] - a.rect[1]) / nz;
    for (let i = 0; i < nx; i++)
      for (let k = 0; k < nz; k++) {
        const px = a.rect[0] + sx * (i + 0.5);
        const pz = a.rect[1] + sz * (k + 0.5);
        if ((i + k) % 2 === 0) tree(w, V(px), GROUND_VY + 1, V(pz), rng, 0.55, false);
        else ctx.prop('BENCH', px, 0.25, pz, k % 2 ? 0 : Math.PI, 0);
      }
    ctx.prop('PARK_LAMP', a.rect[0] + 1, 0.25, a.rect[1] + 1, 0, 0);
    ctx.prop('PARK_LAMP', a.rect[2] - 1, 0.25, a.rect[3] - 1, 0, 0);
    return;
  }
  const dz = Math.min(8, (a.rect[3] - a.rect[1]) / 2 - 2);
  const dx = Math.min(7, (a.rect[2] - a.rect[0]) / 2 - 2);
  for (const [ox, oz] of [
    [-dx, -dz],
    [dx, -dz],
    [-dx, dz],
    [dx, dz],
  ])
    tree(w, V(cxm + ox), GROUND_VY + 1, V(czm + oz), rng, 0.75, false);
  ctx.prop('BENCH', cxm - dx, 0.25, czm, Math.PI / 2, 0);
  ctx.prop('BENCH', cxm + dx, 0.25, czm, -Math.PI / 2, 0);
  ctx.prop('PARK_LAMP', cxm - dx * 0.5, 0.25, czm - dz - 1, 0, 0);
  ctx.prop('PARK_LAMP', cxm + dx * 0.5, 0.25, czm + dz + 1, 0, 0);
}

/** Promenades au bord de l'eau : arbres, bancs, lampadaires. */
function promenade(ctx: GenContext, a: AreaDef, rng: Rng, g: GroundAt): void {
  const [x0m, z0m, x1m, z1m] = a.rect;
  const alongX = x1m - x0m > z1m - z0m;
  const len = alongX ? x1m - x0m : z1m - z0m;
  const wide = (alongX ? z1m - z0m : x1m - x0m) >= 7;
  for (let s = 6, k = 0; s < len - 4; s += 11, k++) {
    const px = alongX ? x0m + s : (x0m + x1m) / 2;
    const pz = alongX ? (z0m + z1m) / 2 : z0m + s;
    const gv = g(px, pz);
    if (isWater(px, pz) || gv === GM.ROAD || gv === GM.BRIDGE || gv === GM.WATER || ctx.inFootprint(px, pz, 1) || onStairs(px, pz) || underHighLine(px, pz)) continue;
    if (alongX && px > RIVER_X0 - 2 && px < RIVER_X1 + 2) continue;
    if (wide && k % 3 === 1) {
      tree(ctx.world, V(px), GROUND_VY + 1, V(pz), rng, 0.7, false);
      continue;
    }
    if (rng.chance(0.55)) ctx.prop('BENCH', px, 0.25, pz, alongX ? 0 : Math.PI / 2, 0);
    else ctx.prop('PARK_LAMP', px, 0.25, pz, 0, 0);
  }
}

/** Clôture grillagée sur le pourtour d'un terrain, avec deux portails (milieux des grands côtés). */
function fence(ctx: GenContext, r: Rect, h: number, mat: number, gateW = 3): void {
  const w = ctx.world;
  const [x0, z0, x1, z1] = r.map(V);
  const alongX = x1 - x0 >= z1 - z0;
  const gateA = alongX ? Math.round((x0 + x1) / 2) : Math.round((z0 + z1) / 2);
  const gw = V(gateW) / 2;
  const post = (x: number, z: number) => w.fill(x, GROUND_VY + 1, z, x + 1, GROUND_VY + 1 + h, z + 1, M.IRON);
  for (let x = x0; x < x1; x++)
    for (const z of [z0, z1 - 1]) {
      if (alongX && Math.abs(x - gateA) < gw) continue;
      w.fill(x, GROUND_VY + 1, z, x + 1, GROUND_VY + 1 + h, z + 1, (x - x0) % 8 === 0 ? M.IRON : mat);
    }
  for (let z = z0; z < z1; z++)
    for (const x of [x0, x1 - 1]) {
      if (!alongX && Math.abs(z - gateA) < gw) continue;
      w.fill(x, GROUND_VY + 1, z, x + 1, GROUND_VY + 1 + h, z + 1, (z - z0) % 8 === 0 ? M.IRON : mat);
    }
  post(x0, z0);
  post(x1 - 1, z0);
  post(x0, z1 - 1);
  post(x1 - 1, z1 - 1);
}

/** Terrains : parking, parc à conteneurs, terrain de basket, jardin partagé, marché en plein air. */
function yard(ctx: GenContext, a: AreaDef, rng: Rng): void {
  const w = ctx.world;
  const [x0m, z0m, x1m, z1m] = a.rect;
  const [x0, z0, x1, z1] = a.rect.map(V);
  const cxm = (x0m + x1m) / 2;
  const czm = (z0m + z1m) / 2;
  const alongX = x1m - x0m >= z1m - z0m;
  const floor = (mat: number, worn?: number) => {
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) w.set(x, GROUND_VY, z, worn !== undefined && ((x * 7 + z * 13) & 63) < 3 ? worn : mat);
  };
  const district: DistrictId = districtAt(cxm, czm).id;
  switch (a.style) {
    case 'parking': {
      floor(M.ASPHALT, M.ASPHALT_WORN);
      // deux rangées de places le long du grand côté, allée au milieu
      const len = alongX ? x1m - x0m : z1m - z0m;
      const wid = alongX ? z1m - z0m : x1m - x0m;
      const n = Math.floor((len - 3) / 2.8);
      for (let i = 0; i < n; i++) {
        const s = 1.5 + 2.8 * (i + 0.5);
        for (const side of [0, 1]) {
          const t = side === 0 ? 3.2 : wid - 3.2;
          const px = alongX ? x0m + s : x0m + t;
          const pz = alongX ? z0m + t : z0m + s;
          // marquage au sol entre les places
          const lx = alongX ? x0m + s - 1.4 : x0m + (side === 0 ? 0.6 : wid - 5.8);
          const lz = alongX ? z0m + (side === 0 ? 0.6 : wid - 5.8) : z0m + s - 1.4;
          if (alongX) w.fill(V(lx), GROUND_VY, V(lz), V(lx) + 1, GROUND_VY + 1, V(lz + 5.2), M.LINE_WHITE);
          else w.fill(V(lx), GROUND_VY, V(lz), V(lx + 5.2), GROUND_VY + 1, V(lz) + 1, M.LINE_WHITE);
          if (rng.chance(0.3)) continue;
          const yaw = (alongX ? 0 : Math.PI / 2) + (rng.chance(0.5) ? Math.PI : 0);
          const kind = rng.chance(0.2) ? 'TAXI_PARKED' : rng.chance(0.15) ? 'VAN_PARKED' : 'CAR_PARKED';
          ctx.prop(kind, px, 0.25, pz, yaw, rng.int(0, 7));
        }
      }
      fence(ctx, a.rect, 6, M.METAL_PERFORATED, 5);
      ctx.prop('PARK_LAMP', x0m + 1, 0.25, z0m + 1, 0, 0);
      ctx.prop('PARK_LAMP', x1m - 1, 0.25, z1m - 1, 0, 0);
      break;
    }
    case 'containers': {
      floor(M.CONCRETE, M.CONCRETE_DARK);
      // rangées de conteneurs empilés (2,4 × 6 m), allées pour les chariots
      const along = !alongX; // les conteneurs sont alignés sur l'axe long du terrain
      const wid = along ? x1m - x0m : z1m - z0m;
      const len = along ? z1m - z0m : x1m - x0m;
      const rowsW = Math.max(1, Math.floor((wid - 2) / 3.2));
      for (let r = 0; r < rowsW; r++) {
        const t = 1.8 + r * 3.2 + 1.2;
        for (let s = 1.5 + 3; s + 3 < len - 1; s += 7) {
          if (rng.chance(0.25)) continue;
          const px = along ? x0m + t : x0m + s;
          const pz = along ? z0m + s : z0m + t;
          const yaw = along ? 0 : Math.PI / 2;
          const stack = 1 + rng.int(0, 2);
          for (let k = 0; k < stack; k++) ctx.prop('CONTAINER', px, 0.25 + k * 2.62, pz, yaw, rng.int(0, 7));
        }
      }
      ctx.prop('FORKLIFT', cxm + 1, 0.25, czm, rng.range(0, 6), 0);
      ctx.prop('PALLET_STACK', x0m + 1.5, 0.25, z1m - 1.5, 0, 0);
      fence(ctx, a.rect, 7, M.METAL_PERFORATED, 4);
      ctx.light(cxm, 6, czm, 0.8, 12, 0xffd8a0);
      break;
    }
    case 'court': {
      // terrain de basket : sol en résine, lignes, paniers, haut grillage
      floor(M.RUBBER);
      const cw = Math.min(28, (alongX ? x1m - x0m : z1m - z0m) - 4);
      const ch = Math.min(15, (alongX ? z1m - z0m : x1m - x0m) - 4);
      const L = (ax: number, az: number, bx: number, bz: number) => w.fill(V(Math.min(ax, bx)), GROUND_VY, V(Math.min(az, bz)), V(Math.max(ax, bx)) + 1, GROUND_VY + 1, V(Math.max(az, bz)) + 1, M.LINE_WHITE);
      const P = (u: number, v: number): [number, number] => (alongX ? [cxm + u, czm + v] : [cxm + v, czm + u]);
      const hu = cw / 2;
      const hv = ch / 2;
      for (const [u0, v0, u1, v1] of [
        [-hu, -hv, hu, -hv],
        [-hu, hv, hu, hv],
        [-hu, -hv, -hu, hv],
        [hu, -hv, hu, hv],
        [0, -hv, 0, hv],
      ]) {
        const [ax, az] = P(u0, v0);
        const [bx, bz] = P(u1, v1);
        L(ax, az, bx, bz);
      }
      for (let k = 0; k < 40; k++) {
        const t = (k / 40) * Math.PI * 2;
        const [ax, az] = P(Math.cos(t) * 1.8, Math.sin(t) * 1.8);
        L(ax, az, ax, az);
      }
      // paniers
      for (const sgn of [-1, 1]) {
        const [px, pz] = P(sgn * (hu + 0.6), 0);
        const [bx, bz] = P(sgn * (hu - 0.6), 0);
        w.fill(V(px), GROUND_VY + 1, V(pz), V(px) + 1, GROUND_VY + 13, V(pz) + 1, M.IRON);
        const vx = V(bx);
        const vz = V(bz);
        if (alongX) w.fill(vx, GROUND_VY + 11, vz - 3, vx + 1, GROUND_VY + 15, vz + 4, M.PAINT_WHITE);
        else w.fill(vx - 3, GROUND_VY + 11, vz, vx + 4, GROUND_VY + 15, vz + 1, M.PAINT_WHITE);
        w.fill(Math.min(V(px), vx), GROUND_VY + 12, Math.min(V(pz), vz), Math.max(V(px), vx) + 1, GROUND_VY + 13, Math.max(V(pz), vz) + 1, M.IRON);
        const [rx, rz] = P(sgn * (hu - 1.1), 0);
        w.set(V(rx), GROUND_VY + 12, V(rz), M.NEON_ORANGE);
      }
      fence(ctx, a.rect, 14, M.METAL_PERFORATED, 4);
      ctx.light(cxm, 6, czm, 0.9, 14, 0xe8f0ff);
      ctx.prop('BENCH', x0m + 1.6, 0.25, czm + 4, Math.PI / 2, 0);
      break;
    }
    case 'garden': {
      // jardin partagé : carrés de terre, petits arbres, bacs à fleurs, bancs
      floor(M.GRAVEL);
      for (let gz = z0m + 2; gz + 3 < z1m - 1; gz += 5)
        for (let gx = x0m + 2; gx + 3 < x1m - 1; gx += 5) {
          const mat = rng.chance(0.6) ? M.DIRT : M.GRASS;
          w.fill(V(gx), GROUND_VY, V(gz), V(gx + 3), GROUND_VY + 1, V(gz + 3), mat);
          w.fill(V(gx), GROUND_VY + 1, V(gz), V(gx + 3), GROUND_VY + 2, V(gz) + 1, M.WALNUT);
          if (mat === M.GRASS && rng.chance(0.5)) tree(w, V(gx + 1.5), GROUND_VY + 1, V(gz + 1.5), rng, 0.6, rng.chance(0.4));
          else if (rng.chance(0.4)) ctx.prop('PLANTER', gx + 1.5, 0.5, gz + 1.5, 0, rng.int(0, 3));
        }
      fence(ctx, a.rect, 4, M.IRON, 3);
      ctx.prop('BENCH', cxm, 0.25, z0m + 1.3, 0, 0);
      ctx.prop('PARK_LAMP', x0m + 1, 0.25, z1m - 1, 0, 0);
      break;
    }
    case 'market': {
      // marché en plein air : allées d'étals, guirlandes de lanternes à Chinatown
      floor(M.SIDEWALK_DARK);
      const china = district === 'chinatown';
      const along = alongX ? 'x' : 'z';
      const len = alongX ? x1m - x0m : z1m - z0m;
      const wid = alongX ? z1m - z0m : x1m - x0m;
      const aisles = Math.max(1, Math.floor((wid - 2) / 9));
      for (let r = 0; r < aisles; r++) {
        const t0 = 2 + r * 9;
        for (let s = 3; s < len - 2.5; s += 3) {
          for (const [off, face] of [
            [t0 + 0.7, 0],
            [t0 + 6.3, Math.PI],
          ] as [number, number][]) {
            if (rng.chance(0.15)) continue;
            const px = along === 'x' ? x0m + s : x0m + off;
            const pz = along === 'x' ? z0m + off : z0m + s;
            const yaw = along === 'x' ? face : face + Math.PI / 2;
            ctx.prop(rng.chance(0.5) ? 'MARKET_STALL' : 'FOOD_STALL', px, 0.25, pz, yaw, rng.int(0, 7));
          }
          if (china && Math.round(s) % 6 === 0) {
            const px = along === 'x' ? x0m + s : x0m + t0 + 3.5;
            const pz = along === 'x' ? z0m + t0 + 3.5 : z0m + s;
            ctx.prop('LANTERN_STRING', px, 3.4, pz, along === 'x' ? Math.PI / 2 : 0, 0);
          }
        }
      }
      ctx.prop('CRATE_STACK', x0m + 1, 0.25, z0m + 1, 0, 0);
      ctx.prop('PARK_LAMP', x1m - 1, 0.25, z0m + 1, 0, 0);
      break;
    }
  }
}

/** Arche de Washington Square (marbre blanc). */
function washingtonArch(ctx: GenContext, xm: number, zm: number): void {
  const w = ctx.world;
  const cx = V(xm);
  const cz = V(zm);
  const hw = 18; // demi-largeur (voxels)
  const hd = 4; // demi-épaisseur
  const top = GROUND_VY + 40;
  // piles
  w.fill(cx - hw, GROUND_VY, cz - hd, cx - 8, top, cz + hd, M.MARBLE);
  w.fill(cx + 8, GROUND_VY, cz - hd, cx + hw, top, cz + hd, M.MARBLE);
  // arc en plein cintre
  for (let x = cx - 8; x < cx + 8; x++) {
    const u = (x + 0.5 - cx) / 8;
    const archY = GROUND_VY + 22 + Math.round(Math.sqrt(Math.max(0, 1 - u * u)) * 8);
    w.fill(x, archY, cz - hd, x + 1, top, cz + hd, M.MARBLE);
  }
  // attique et corniche
  w.fill(cx - hw - 1, top - 6, cz - hd - 1, cx + hw + 1, top - 5, cz + hd + 1, M.LIMESTONE);
  w.fill(cx - hw - 1, top, cz - hd - 1, cx + hw + 1, top + 2, cz + hd + 1, M.LIMESTONE);
  // médaillons dorés et éclairage
  for (const s of [-1, 1]) w.fill(cx + s * 13 - 1, GROUND_VY + 26, cz - hd - 1, cx + s * 13 + 1, GROUND_VY + 30, cz - hd, M.GOLD);
  ctx.light(xm, 4, zm - 3, 0.8, 10, 0xfff0d0);
  ctx.light(xm, 4, zm + 3, 0.8, 10, 0xfff0d0);
}

/** Tombeau de Grant (Riverside Park) : socle, colonnade et rotonde. */
function grantsTomb(ctx: GenContext, xm: number, zm: number): void {
  const w = ctx.world;
  const cx = V(xm);
  const cz = V(zm);
  const s = 16;
  w.fill(cx - s - 4, GROUND_VY, cz - s - 4, cx + s + 4, GROUND_VY + 2, cz + s + 4, M.GRANITE);
  w.fill(cx - s, GROUND_VY + 2, cz - s, cx + s, GROUND_VY + 28, cz + s, M.LIMESTONE);
  // colonnes sur les quatre faces
  for (let k = -s + 2; k < s - 2; k += 6)
    for (const [dx, dz] of [
      [k, -s - 2],
      [k, s + 1],
      [-s - 2, k],
      [s + 1, k],
    ])
      w.fill(cx + dx, GROUND_VY + 2, cz + dz, cx + dx + 2, GROUND_VY + 26, cz + dz + 2, M.LIMESTONE);
  w.fill(cx - s - 3, GROUND_VY + 26, cz - s - 3, cx + s + 3, GROUND_VY + 30, cz + s + 3, M.LIMESTONE);
  // rotonde à colonnes et coupole
  for (let y = 0; y < 24; y++) {
    const r = y < 14 ? 11 : 11 - (y - 14) * 1.05;
    for (let x = -12; x <= 12; x++)
      for (let z = -12; z <= 12; z++) {
        const d = Math.hypot(x + 0.5, z + 0.5);
        if (d > r || d < r - 2) continue;
        if (y < 14 && Math.round(Math.atan2(z, x) * 4) % 2 === 0 && y > 1) continue;
        w.set(cx + x, GROUND_VY + 30 + y, cz + z, M.LIMESTONE);
      }
  }
  // porte de bronze
  w.fill(cx - 3, GROUND_VY + 2, cz - s, cx + 3, GROUND_VY + 14, cz - s + 1, M.BRASS);
  ctx.light(xm, 3, zm - s * VOXEL - 3, 0.7, 9, 0xfff0d0);
}

/** One Times Square : la tour d'écrans et la boule du Nouvel An. */
function oneTimesSquare(ctx: GenContext): void {
  const f = new Frame(ctx, ONE_TIMES_SQUARE, 'N', -1);
  const top = 150;
  f.fill(0, 0, 0, f.W, top, f.D, M.METAL_PANEL_DARK);
  // écrans sur les quatre faces, empilés
  const faces: Wall[] = ['front', 'back', 'left', 'right'];
  for (const wl of faces) {
    cladFace(f, wl, 8, 40, M.SCREEN_ADS);
    cladFace(f, wl, 42, 74, M.SCREEN);
    cladFace(f, wl, 76, 100, M.SCREEN_ADS);
    cladFace(f, wl, 102, 108, M.SCREEN_TICKER);
    cladFace(f, wl, 110, 140, M.SCREEN);
  }
  ledRing(f, 0, 0, f.W, f.D, 41, M.LED_WHITE);
  ledRing(f, 0, 0, f.W, f.D, 101, M.LED_WHITE);
  f.fill(Math.round(f.W / 2) - 1, top, Math.round(f.D / 2) - 1, Math.round(f.W / 2) + 1, top + 18, Math.round(f.D / 2) + 1, M.STEEL);
  const c = f.pt(f.W / 2, f.D / 2);
  ctx.prop('BALL_TOWER', c.x, top * VOXEL + 2.5, c.z, 0, 0);
  const faceYaw: Record<Wall, number> = { front: f.yaw(Math.PI), back: f.yaw(0), left: f.yaw(-Math.PI / 2), right: f.yaw(Math.PI / 2) };
  for (const wl of faces) {
    const len = wl === 'front' || wl === 'back' ? f.W : f.D;
    const off = wl === 'front' ? f.pt(f.W / 2, -0.08) : wl === 'back' ? f.pt(f.W / 2, f.D + 0.08) : wl === 'left' ? f.pt(-0.08, f.D / 2) : f.pt(f.W + 0.08, f.D / 2);
    ctx.screens.push({ x: off.x, y: 15, z: off.z, yaw: faceYaw[wl], w: len * VOXEL - 0.2, h: 7.6, kind: wl === 'front' || wl === 'back' ? 'boss' : 'ad', district: 'midtown', seed: ctx.screens.length * 17 + 5 });
  }
}

/** Fontaine (bassin circulaire et ange de Bethesda). */
function fountain(ctx: GenContext, xm: number, zm: number): void {
  const w = ctx.world;
  const cx = V(xm);
  const cz = V(zm);
  for (let x = cx - 14; x < cx + 14; x++)
    for (let z = cz - 14; z < cz + 14; z++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (d > 13) continue;
      if (d > 11.5) w.fill(x, GROUND_VY + 1, z, x + 1, GROUND_VY + 3, z + 1, M.LIMESTONE);
      else {
        w.set(x, GROUND_VY, z, M.SIDEWALK_DARK);
        if (d > 3) w.set(x, GROUND_VY + 1, z, M.FOUNTAIN_WATER);
      }
    }
  ctx.prop('FOUNTAIN_ANGEL', xm, 0.25, zm, Math.PI, 0);
  ctx.light(xm, 1.5, zm, 0.6, 7, 0xa8e0ff);
}

/** Arbre (feuillu) en voxels. Coordonnées en voxels. */
export function tree(w: VoxelWorld, x: number, y: number, z: number, rng: Rng, scale = 1, blossom = false): void {
  x = Math.round(x);
  z = Math.round(z);
  const trunkH = Math.round((14 + rng.int(0, 5)) * scale);
  w.fill(x - 1, y, z - 1, x + 1, y + trunkH, z + 1, M.BARK);
  const blobs = 4 + rng.int(0, 2);
  for (let i = 0; i < blobs; i++) {
    const r = (5 + rng.range(0, 3)) * scale;
    const bx = x + rng.range(-4, 4) * scale;
    const bz = z + rng.range(-4, 4) * scale;
    const by = y + trunkH + rng.range(-1, 5) * scale;
    const mat = blossom ? M.LEAVES_PINK : rng.chance(0.5) ? M.LEAVES : M.LEAVES_DARK;
    for (let vx = Math.floor(bx - r); vx <= bx + r; vx++)
      for (let vy = Math.floor(by - r * 0.8); vy <= by + r * 0.8; vy++)
        for (let vz = Math.floor(bz - r); vz <= bz + r; vz++) {
          const dx = (vx - bx) / r;
          const dy = (vy - by) / (r * 0.8);
          const dz = (vz - bz) / r;
          const d = dx * dx + dy * dy + dz * dz;
          if (d > 1) continue;
          if (d > 0.7 && (hash32(vx * 73 + vy * 151 + vz * 997) & 3) === 0) continue;
          if (w.get(vx, vy, vz) === 0) w.set(vx, vy, vz, mat);
        }
  }
  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, Math.PI * 2);
    for (let k = 0; k < 5 * scale; k++) w.set(Math.round(x + Math.cos(a) * k), y + trunkH - 3 + Math.floor(k / 2), Math.round(z + Math.sin(a) * k), M.BARK);
  }
}

/** Affleurement de schiste (Central Park). */
function rock(w: VoxelWorld, x: number, z: number, rng: Rng): void {
  const r = rng.range(6, 11);
  for (let vx = Math.floor(x - r); vx <= x + r; vx++)
    for (let vz = Math.floor(z - r); vz <= z + r; vz++) {
      const d = Math.hypot(vx - x, (vz - z) * 1.3) / r;
      if (d > 1) continue;
      const h = Math.round((1 - d * d) * r * 0.5 + rng.range(0, 1));
      w.fill(vx, GROUND_VY, vz, vx + 1, GROUND_VY + h, vz + 1, M.ROCK);
    }
}

// ======================================================================================
// Immeubles de décor (fermés)

function buildFiller(ctx: GenContext, def: FillerDef, rng: Rng): void {
  const f = new Frame(ctx, def.rect, def.front, -1);
  const top = Math.round(def.height * INV_VOXEL);
  const { W, D } = f;
  const shophouse = def.style === 'shophouse';
  const st: Facade = {
    ...FACADE_DEFAULT,
    wall:
      def.style === 'walkup'
        ? rng.pick([M.BRICK_RED, M.BRICK_BROWN, M.BRICK_YELLOW, M.BROWNSTONE])
        : def.style === 'deco'
          ? M.LIMESTONE
          : def.style === 'warehouse'
            ? rng.pick([M.BRICK_DARK, M.CORRUGATED, M.BRICK_RED])
            : shophouse
              ? rng.pick([M.STUCCO_RED, M.STUCCO_GREEN, M.STUCCO_YELLOW, M.BRICK_WHITE])
              : M.METAL_PANEL_DARK,
    wallSide: def.style === 'warehouse' ? M.CONCRETE : M.BRICK_BROWN,
    lit: 0.5,
  };
  f.fill(0, 0, 0, W, 1, D, M.GRANITE);
  hollowBlock(f, 0, 0, W, D, 1, top, st.wall, M.ROOF_TAR);
  const walls: Wall[] = ['front', 'back', 'left', 'right'];
  if (def.style === 'glass') {
    curtainBlock(f, 0, 0, W, D, 18, top - 2, rng.chance(0.5) ? M.CURTAIN_BLUE : M.CURTAIN_DARK, M.METAL_PANEL_DARK);
    cladFace(f, 'front', 1, 16, M.GLASS_SHOP);
    ledRing(f, 0, 0, W, D, 17, M.LED_WHITE);
  } else {
    const bases: number[] = [];
    for (let base = 1; base < top - 10; base += 14) bases.push(base);
    for (const base of bases) for (const wl of walls) windowRow(f, wl, st, rng, base + 4, def.style === 'warehouse' ? 5 : 7);
    if (def.style === 'deco') for (const wl of ['front', 'back'] as Wall[]) piers(f, wl, st, 14, top - 2, M.LIMESTONE);
    if (def.style === 'walkup') {
      cornice(f, top - 2, M.LIMESTONE, true);
      if (W >= 24 && D >= 16) waterTower(f, Math.round(W / 2), Math.round(D / 2), top, 5);
      // escalier de secours en façade
      if (bases.length >= 2 && W >= 40) fireEscape(f, 6, bases, top);
    }
    if (shophouse) {
      // avant-toit de tuiles vertes et lanternes rouges
      for (let k = 0; k < 3; k++) f.fill(-1 - k, top - k, -1 - k, W + 1 + k, top - k + 1, 1, M.COPPER_GREEN);
      for (let x = 6; x < W - 4; x += 12) f.prop('LANTERN_RED', x, 12, -0.6, 0, 0);
      cladFace(f, 'front', 13, 14, M.NEON_RED);
    }
  }
  // murs d'écrans publicitaires (Times Square)
  if (def.screens) {
    const sw = Math.min(W - 6, 64);
    const x0 = Math.round(W / 2 - sw / 2);
    const y0 = 20;
    const y1 = Math.min(top - 6, 96);
    f.fill(x0, y0, -1, x0 + sw, y1, 0, M.SCREEN_ADS);
    ledRing(f, x0, -1, x0 + sw, 0, y1, M.LED_WHITE);
    const c = f.pt(x0 + sw / 2, -1.08);
    ctx.screens.push({ x: c.x, y: ((y0 + y1) / 2) * VOXEL, z: c.z, yaw: f.yaw(Math.PI), w: sw * VOXEL, h: (y1 - y0) * VOXEL, kind: 'ad', district: 'midtown', seed: ctx.screens.length * 17 + 11 });
  }
  parapet(f, top, st.wall, 3);
}

// ======================================================================================
// Mobilier urbain

function streetFurniture(ctx: GenContext, g: GroundAt, rng: Rng): void {
  const doors = ctx.buildings.flatMap((b) => b.doors.map((d) => [d.x, d.z] as [number, number]));
  const nearDoor = (x: number, z: number, r: number) => doors.some(([dx, dz]) => (dx - x) ** 2 + (dz - z) ** 2 < r * r);
  const solidAt = (x: number, z: number) => ctx.world.get(Math.floor(x * INV_VOXEL), GROUND_VY + 1, Math.floor(z * INV_VOXEL)) !== 0;
  const free = (x: number, z: number, m = 0.6) => !nearDoor(x, z, 3.2) && !solidAt(x, z) && !ctx.inFootprint(x, z, m) && !isWater(x, z) && !onStairs(x, z);
  // grille d'occupation (8 m) : recherche rapide des objets proches
  const CELL = 8;
  const gw = Math.ceil(WORLD_W / CELL);
  const grid = new Map<number, [number, number][]>();
  const add = (x: number, z: number) => {
    const k = Math.floor(z / CELL) * gw + Math.floor(x / CELL);
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push([x, z]);
  };
  const far = (x: number, z: number, d: number) => {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let j = cz - 1; j <= cz + 1; j++)
      for (let i = cx - 1; i <= cx + 1; i++) {
        const l = grid.get(j * gw + i);
        if (l) for (const [a, b] of l) if ((a - x) ** 2 + (b - z) ** 2 <= d * d) return false;
      }
    return true;
  };
  const curbNear = (x: number, z: number, r: number): [number, number] | null => {
    let out: [number, number] | null = null;
    for (const [ox, oz] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ])
      if (g(x + ox, z + oz) === GM.CURB) out = [ox, oz];
    return out;
  };
  // ---------------------------------------------- lampadaires LED le long des bordures (bras vers la chaussée)
  for (const r of ROADS) {
    if (r.name.startsWith('Pont')) continue;
    const [x0, z0, x1, z1] = r.rect;
    const along = r.axis === 'z';
    const len = along ? z1 - z0 : x1 - x0;
    for (let s = 5; s < len - 3; s += 16) {
      for (const side of [0, 1]) {
        if ((Math.floor(s / 16) + side) % 2 === 1) continue;
        const x = along ? (side === 0 ? x0 - 0.15 : x1 + 0.15) : x0 + s;
        const z = along ? z0 + s : side === 0 ? z0 - 0.15 : z1 + 0.15;
        if (g(x, z) !== GM.CURB || !free(x, z, 0.3) || !far(x, z, 10)) continue;
        // le bras pointe vers la chaussée
        const yaw = along ? (side === 0 ? Math.PI / 2 : -Math.PI / 2) : side === 0 ? 0 : Math.PI;
        ctx.prop('STREET_LIGHT', x, 0.25, z, yaw, 0);
        add(x, z);
      }
    }
  }
  // ---------------------------------------------- feux tricolores aux angles des carrefours
  for (const a of ROADS)
    for (const b of ROADS) {
      if (a.axis !== 'z' || b.axis !== 'x') continue;
      const ix0 = Math.max(a.rect[0], b.rect[0]);
      const ix1 = Math.min(a.rect[2], b.rect[2]);
      const iz0 = Math.max(a.rect[1], b.rect[1]);
      const iz1 = Math.min(a.rect[3], b.rect[3]);
      if (ix1 <= ix0 || iz1 <= iz0) continue;
      const corners: [number, number, number][] = [
        [ix0 - 0.6, iz0 - 0.6, 0],
        [ix1 + 0.6, iz1 + 0.6, Math.PI],
        [ix0 - 0.6, iz1 + 0.6, Math.PI / 2],
        [ix1 + 0.6, iz0 - 0.6, -Math.PI / 2],
      ];
      for (const [x, z, yaw] of corners) {
        if (g(x, z) !== GM.CURB && g(x, z) !== GM.SIDEWALK) continue;
        if (!free(x, z, 0.3) || !far(x, z, 3)) continue;
        ctx.prop('TRAFFIC_LIGHT', x, 0.25, z, yaw, 0);
        add(x, z);
        // bouche d'incendie et poubelle près du coin
        const hx = x + Math.sin(yaw + 0.8) * 2.5;
        const hz = z + Math.cos(yaw + 0.8) * 2.5;
        if ((g(hx, hz) === GM.SIDEWALK || g(hx, hz) === GM.CURB) && free(hx, hz) && far(hx, hz, 2)) {
          ctx.prop(rng.chance(0.5) ? 'HYDRANT' : 'TRASH_CAN', hx, 0.25, hz, rng.range(0, 3), 0);
          add(hx, hz);
        }
      }
    }
  // ---------------------------------------------- mobilier dispersé sur les trottoirs
  const kinds = ['HYDRANT', 'TRASH_CAN', 'MAILBOX', 'VENDING_MACHINE', 'HOLO_KIOSK', 'BENCH', 'AD_COLUMN', 'BIKE_RACK', 'CHARGING_POST', 'PLANTER', 'NEWS_STAND', 'FOOD_CART', 'HOLO_BOOTH', 'PARKING_METER', 'DUMPSTER'] as const;
  const gritty = new Set<DistrictId>(['astoria', 'lic', 'williamsburg', 'bushwick', 'chinatown', 'les', 'harlem']);
  const busy = new Set<DistrictId>(['midtown', 'wallstreet', 'chinatown', 'village', 'les']);
  for (let i = 0; i < Math.round(520 * AREA_K); i++) {
    const x = rng.range(4, WORLD_W - 6);
    const z = rng.range(8, WORLD_D - 8);
    if (g(x, z) !== GM.SIDEWALK || !free(x, z, 0.8) || !far(x, z, 3.2)) continue;
    // il faut un bord de trottoir proche (mobilier aligné sur la rue)
    const c = curbNear(x, z, 1.2);
    if (!c) continue;
    const d = districtAt(x, z).id;
    let k: (typeof kinds)[number] = rng.pick(kinds);
    if (k === 'DUMPSTER' && !gritty.has(d)) k = 'TRASH_CAN';
    if (k === 'FOOD_CART' && !busy.has(d)) k = 'HYDRANT';
    // +Z du modèle vers la chaussée ; les objets qu'on utilise à pied regardent le trottoir
    const faceWalk = k === 'VENDING_MACHINE' || k === 'NEWS_STAND' || k === 'MAILBOX' || k === 'HOLO_KIOSK' || k === 'HOLO_BOOTH' || k === 'CHARGING_POST';
    const yaw = Math.atan2(c[0], c[1]) + (faceWalk ? Math.PI : 0);
    ctx.prop(k, x, 0.25, z, yaw, rng.int(0, 7));
    add(x, z);
  }
  // ---------------------------------------------- bouches à vapeur sur la chaussée
  for (let i = 0; i < Math.round(40 * AREA_K); i++) {
    const r = rng.pick(ROADS);
    if (r.name.startsWith('Pont')) continue;
    const x = rng.range(r.rect[0] + 1.5, r.rect[2] - 1.5);
    const z = rng.range(r.rect[1] + 1.5, r.rect[3] - 1.5);
    if (g(x, z) !== GM.ROAD || isWater(x, z)) continue;
    ctx.prop('STEAM_VENT', x, 0, z, 0, 1);
    ctx.smokes.push({ x, y: 0.1, z, big: rng.chance(0.25) });
  }
  // cheminées de vapeur rayées orange et blanc (Midtown, Wall Street…), au bord du trottoir
  for (let i = 0, n = 0; i < 400 * AREA_K && n < Math.round(12 * AREA_K); i++) {
    const x = rng.range(4, WORLD_W - 6);
    const z = rng.range(8, WORLD_D - 8);
    if (!busy.has(districtAt(x, z).id)) continue;
    if (g(x, z) !== GM.SIDEWALK || !free(x, z, 1) || !far(x, z, 4)) continue;
    if (!curbNear(x, z, 1)) continue;
    ctx.prop('STEAM_VENT', x, 0.25, z, rng.range(0, 6), 0);
    ctx.smokes.push({ x, y: 1.95, z, big: rng.chance(0.4) });
    add(x, z);
    n++;
  }
  // ---------------------------------------------- arbres d'alignement le long des trottoirs, à 1,25 m de la
  // bordure, en quinconce d'un côté à l'autre (sauf Midtown et Wall Street, tout en béton)
  for (const r of ROADS) {
    if (r.name.startsWith('Pont')) continue;
    const [x0, z0, x1, z1] = r.rect;
    const along = r.axis === 'z';
    const len = along ? z1 - z0 : x1 - x0;
    for (const side of [0, 1]) {
      for (let s = side === 0 ? 11 : 18.5; s < len - 6; s += 15) {
        const x = along ? (side === 0 ? x0 - 1.25 : x1 + 1.25) : x0 + s;
        const z = along ? z0 + s : side === 0 ? z0 - 1.25 : z1 + 1.25;
        const d = districtAt(x, z).id;
        if (d === 'midtown' || d === 'wallstreet') continue;
        if (g(x, z) !== GM.SIDEWALK || !free(x, z, 1.1) || !far(x, z, 4.5)) continue;
        if (!rng.chance(0.8)) continue;
        const w = ctx.world;
        const vx = Math.floor(x * INV_VOXEL);
        const vz = Math.floor(z * INV_VOXEL);
        w.fill(vx - 2, GROUND_VY, vz - 2, vx + 2, GROUND_VY + 1, vz + 2, M.TREE_GRATE);
        tree(w, vx, GROUND_VY + 1, vz, rng, 0.75, d === 'chinatown' && rng.chance(0.4));
        add(x, z);
      }
    }
  }
  // ---------------------------------------------- néons de rue (Chinatown, Times Square, Downtown, Brooklyn)
  const neon = new Set<DistrictId>(['chinatown', 'midtown', 'les', 'village', 'williamsburg', 'bushwick']);
  for (const b of ctx.buildings) {
    if (!neon.has(b.def.district)) continue;
    if (b.def.type === 'tower' || b.def.type === 'penthouse' || b.def.type === 'landmark' || b.def.type === 'corp') continue;
    const door = b.doors[0];
    const ox = door.out.x - door.x;
    const oz = door.out.z - door.z;
    const l = Math.hypot(ox, oz) || 1;
    const px = door.x + (ox / l) * 0.75 + (oz / l) * 5;
    const pz = door.z + (oz / l) * 0.75 - (ox / l) * 5;
    ctx.prop('NEON_SIGN', px, 4.2, pz, Math.atan2(ox, oz), rng.int(0, 7), -1);
  }
}

/** Front de mer : les grues portiques de Gantry Plaza (Long Island City) et du quai de Domino. */
function waterfront(ctx: GenContext): void {
  const w = ctx.world;
  // deux grues de chaque côté de Newtown Creek, en miroir (une grue occupe 3 m le long du quai)
  for (const zm of [140, 158, WORLD_D - 143, WORLD_D - 161]) {
    const x0 = V(RIVER_X1) - 6;
    const x1 = V(RIVER_X1) + 6;
    const z0 = V(zm);
    const h = GROUND_VY + 44;
    for (const z of [z0, z0 + 10]) {
      w.fill(x0, GROUND_VY - 6, z, x0 + 2, h, z + 2, M.STEEL_BLUE);
      w.fill(x1, GROUND_VY + 1, z, x1 + 2, h, z + 2, M.STEEL_BLUE);
      w.fill(x0, h, z, x1 + 2, h + 3, z + 2, M.STEEL_BLUE);
    }
    w.fill(x0 - 16, h + 3, z0, x1 + 2, h + 5, z0 + 12, M.STEEL_BLUE);
    w.fill(x1 - 2, h - 8, z0 + 2, x1 + 2, h, z0 + 10, M.RUST);
    ctx.light((x0 + x1) * 0.5 * VOXEL, (h - GROUND_VY) * VOXEL, (z0 + 6) * VOXEL, 0.6, 10, 0xffc080);
  }
}

/** Hologrammes géants (silhouettes animées dessinées par le client). */
function holograms(ctx: GenContext): void {
  // Times Square
  ctx.holos.push({ x: 116, y: 24, z: 226, yaw: 0, scale: 6, kind: 'dancer', color: 0xff3cc8 });
  ctx.holos.push({ x: 104, y: 30, z: 250, yaw: 0.4, scale: 7, kind: 'koi', color: 0x3ce8ff });
  ctx.holos.push({ x: 126, y: 32, z: 240, yaw: -0.3, scale: 5, kind: 'bottle', color: 0xffd040 });
  // l'Empire State et Grand Central
  ctx.holos.push({ x: 276, y: 50, z: 269, yaw: 0, scale: 8, kind: 'ring', color: 0xa848ff });
  ctx.holos.push({ x: 318, y: 26, z: 240, yaw: 0, scale: 5, kind: 'city', color: 0x7ad8ff });
  // Chinatown
  ctx.holos.push({ x: 195, y: 22, z: 452, yaw: 0, scale: 6, kind: 'dragon', color: 0xff4040 });
  ctx.holos.push({ x: 236, y: 18, z: 414, yaw: 0, scale: 4, kind: 'koi', color: 0xff8a20 });
  // Wall Street
  ctx.holos.push({ x: 196, y: 36, z: 336, yaw: 0, scale: 6, kind: 'logo', color: 0x40c8ff });
  // Central Park et Harlem
  ctx.holos.push({ x: 183, y: 28, z: 158, yaw: 0, scale: 4, kind: 'face', color: 0x7dffb0 });
  ctx.holos.push({ x: 161, y: 20, z: 46, yaw: 0, scale: 5, kind: 'logo', color: 0xffb020 });
  // Lower East Side, Greenwich Village
  ctx.holos.push({ x: 318, y: 20, z: 338, yaw: 0, scale: 4, kind: 'bottle', color: 0xff7a3c });
  ctx.holos.push({ x: 75, y: 18, z: 340, yaw: 0, scale: 4, kind: 'koi', color: 0xffd060 });
  // le Queens et Brooklyn
  ctx.holos.push({ x: 520, y: 18, z: 440, yaw: 0, scale: 4, kind: 'dancer', color: 0xff3050 });
  ctx.holos.push({ x: 520, y: 18, z: 40, yaw: 0, scale: 4, kind: 'ring', color: 0x40a0ff });
  ctx.holos.push({ x: 524, y: 30, z: 172, yaw: 0, scale: 5, kind: 'city', color: 0x3ce8ff });
  ctx.holos.push({ x: 524, y: 22, z: 308, yaw: 0, scale: 5, kind: 'logo', color: 0xff6a8a });
}
