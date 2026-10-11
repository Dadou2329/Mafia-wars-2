// Logements des parrains (planque, garage, loft, penthouse, tour) et tours de bureaux.
// Chaque logement est entièrement meublé et décoré par le jeu, aux couleurs de son parrain :
// Dadou = cramoisi, noir et or ; Even = bleu marine, argent et blanc.

import { M } from '../../materials';
import { Rng, hash32 } from '../../util';
import { VOXEL } from '../../voxel';
import type { BuildingDef } from '../plan';
import type { BuildingInfo, GenContext, HqAnchor } from './context';
import { Frame } from './frame';
import { FACE, Furnisher, furnishRoom, type Room } from './furnish';
import { FACADE_DEFAULT, band, cladFace, curtainBlock, entrance, hollowBlock, ledRing, piers, storefront, windowColumns, windowRow, type Facade, type Wall } from './facade';
import {
  ELEV_D,
  ELEV_W,
  STAIR_D,
  STAIR_W,
  buildBox,
  computeFloors,
  cornice,
  elevatorCore,
  finishWalls,
  fireEscape,
  parapet,
  stairShaft,
  waterTower,
  type Levels,
} from './structure';
import { addScreen, exposure, makeInfo, signFor } from './buildings';

const HALF_PI = Math.PI / 2;

interface Palette {
  cloth: number;
  wallpaper: number;
  carpet: number;
  metal: number;
  led: number;
  neon: number;
  neonVariant: number;
  sofa: number; // variante de canapé
}

function paletteOf(boss: 'dadou' | 'even' | null): Palette {
  if (boss === 'dadou') return { cloth: M.CLOTH_RED, wallpaper: M.WP_RED, carpet: M.CARPET_RED, metal: M.GOLD, led: M.LED_RED, neon: M.NEON_RED, neonVariant: 2, sofa: 1 };
  if (boss === 'even') return { cloth: M.CLOTH_NAVY, wallpaper: M.WP_BLUE, carpet: M.CARPET_BLUE, metal: M.SILVER, led: M.LED_BLUE, neon: M.NEON_BLUE, neonVariant: 3, sofa: 2 };
  return { cloth: M.CLOTH_WHITE, wallpaper: M.WP_GOLD, carpet: M.CARPET_GREY, metal: M.CHROME, led: M.LED_WHITE, neon: M.NEON_CYAN, neonVariant: 1, sofa: 0 };
}

// ======================================================================= équipements du QG
// Chaque logement réserve un emplacement à chaque équipement du QG qu'on peut y acheter (voir
// server/game/hq.ts) : le client y fait apparaître le modèle quand le parrain l'achète. Les
// emplacements longent les murs ou les coins libres (jamais devant une porte, le bureau, le
// rabatteur ou l'armurerie) ; « elite1…4 » sont les postes des gardes d'élite.

/**
 * Encombrement des équipements posés au sol, en mètres : largeur (le long du mur), profondeur
 * (depuis le mur, l'emplacement est le milieu du dos), hauteur. Les modèles du client s'y tiennent.
 */
export const HQ_FOOTPRINT: Record<string, [number, number, number]> = {
  surveil: [2.6, 0.45, 2.4],
  comms: [1.6, 0.9, 2.3],
  dronecmd: [1.6, 0.55, 2.2],
  opscenter: [2.4, 1.0, 1.9],
  trophies: [2.0, 0.4, 2.3],
  armory2: [2.0, 0.5, 2.2],
  autorecruit: [0.9, 0.6, 2.0],
  cyberstation: [2.4, 1.75, 2.3],
};

/** Emplacement local (voxels) : point d'appui du modèle (dos au mur, ou centre), étage, orientation. */
interface UpgSpot {
  id: string;
  lx: number;
  lz: number;
  ly: number;
  yaw: number;
  s?: number;
  h?: number;
}

function spot(list: UpgSpot[], fu: Furnisher, id: string, lx: number, lz: number, yaw = 0, s?: number, h?: number): void {
  list.push({ id, lx, lz, ly: fu.lv.floorTop, yaw, s, h });
}

/** Emplacement dans la rue (ly : couche du sol, le trottoir par défaut). */
function streetSpot(list: UpgSpot[], id: string, lx: number, lz: number, yaw: number, ly = 1): void {
  list.push({ id, lx, lz, ly, yaw });
}

/** Emplacements en coordonnées du monde (m), dans les informations du bâtiment. */
function exposeSpots(info: BuildingInfo, f: Frame, list: UpgSpot[]): void {
  if (list.length === 0) return;
  const out: Record<string, HqAnchor> = {};
  for (const s of list) {
    const p = f.pt(s.lx, s.lz);
    const a: HqAnchor = { x: p.x, y: s.ly * VOXEL, z: p.z, yaw: f.yaw(s.yaw) };
    if (s.s !== undefined) a.s = s.s;
    if (s.h !== undefined) a.h = s.h;
    out[s.id] = a;
  }
  info.hqAnchors = out;
}

export function buildResidence(ctx: GenContext, def: BuildingDef): BuildingInfo {
  const tier = def.residence?.tier ?? 0;
  if (tier === 4 || tier === 5 || def.type === 'corp') return buildTower(ctx, def);
  if (tier === 1) return buildHideout(ctx, def);
  if (tier === 2) return buildGarage(ctx, def);
  return buildLoft(ctx, def);
}

// ======================================================================= palier 1 : la planque

function buildHideout(ctx: GenContext, def: BuildingDef): BuildingInfo {
  const rng = new Rng(hash32(def.id * 7919 + 101));
  const boss = def.residence!.boss;
  const pal = paletteOf(boss);
  const f = new Frame(ctx, def.rect, def.door, def.id);
  const st: Facade = { ...FACADE_DEFAULT, wall: boss === 'dadou' ? M.BRICK_GRAFFITI : M.BRICK_YELLOW, wallSide: M.BRICK_BROWN, lit: 0.5 };
  // walk-up de 4 étages dont 2 accessibles
  const floors = computeFloors(2, 16, 12);
  const wallTop = floors[1].ceil + 2 + 2 * 14;
  buildBox(f, { wall: st.wall, wallSide: st.wallSide, base: M.GRANITE, floorMat: [M.LINOLEUM, M.FLOOR_WORN], ceilMat: M.CEILING, roofMat: M.CONCRETE }, floors, wallTop);
  f.fill(2, wallTop - 2, 2, f.W - 2, wallTop, f.D - 2, M.ROOF_TAR);
  const exp = exposure(ctx, f, def.id);
  const walls: Wall[] = (['front', 'left', 'right', 'back'] as Wall[]).filter((w) => exp[w]);
  const doorW = 6;
  const doorLx = Math.round(f.W * 0.62);
  const g0 = floors[0];
  // rez-de-chaussée : laverie (Dadou) ou épicerie (Even)
  const { signY } = storefront(f, g0, doorLx, doorW, {
    frame: M.IRON,
    band: boss === 'dadou' ? M.PAINT_TEAL : M.PAINT_GREEN,
    awning: boss === 'dadou' ? undefined : M.AWNING_GREEN,
    neon: boss === 'dadou' ? M.NEON_CYAN : M.NEON_GREEN,
  });
  entrance(f, g0, doorLx, doorW, 11, M.IRON, M.GRANITE);
  const bases = [floors[0].floorTop, floors[1].floorTop, floors[1].ceil + 2, floors[1].ceil + 16];
  for (let i = 1; i < bases.length; i++) for (const w of walls) windowRow(f, w, st, rng, bases[i] + 3, st.winH);
  band(f, walls, g0.ceil, M.LIMESTONE);
  fireEscape(f, 3, bases, wallTop);
  cornice(f, wallTop + 3, M.LIMESTONE, exp.left || exp.right);
  parapet(f, wallTop, st.wallSide);
  waterTower(f, 12, Math.round(f.D / 2), wallTop, 6);
  // intérieur
  const sx0 = f.W - 2 - STAIR_W;
  const sz0 = f.D - 2 - STAIR_D;
  const partZ = sz0 - 2;
  for (const lv of floors) f.fill(2, lv.floorTop, partZ, sx0 - 2, lv.ceil, partZ + 2, M.PLASTER_DIRTY);
  // passages
  for (const lv of floors) f.fill(8, lv.floorTop, partZ, 13, lv.floorTop + 9, partZ + 2, 0);
  const stairs = stairShaft(f, sx0, sz0, floors, wallTop, M.PLASTER_DIRTY, M.CONCRETE);
  // l'escalier dessert les étages fermés jusqu'au toit : on ne garde pas d'ouverture vers eux
  for (const lv of floors) finishWalls(f, lv, 2, 2, f.W - 2, partZ, lv === floors[0] ? M.TILE_WHITE : M.WP_FADED, 0);
  for (const lv of floors) finishWalls(f, lv, 2, partZ + 2, sx0 - 2, f.D - 2, lv === floors[0] ? M.PLASTER_DIRTY : M.WP_FADED, 0);
  f.fill(doorLx, g0.floorTop, 0, doorLx + doorW, g0.floorTop + 11, 2, 0);
  const fu = new Furnisher(f, g0, rng);
  fu.boss = boss;
  fu.reserve(doorLx - 3, 0, doorLx + doorW + 3, 10);
  for (const d of stairs.doors) fu.reserve(d.lx - 4, d.lz - 6, d.lx + 4, d.lz + 3);
  fu.reserve(6, partZ - 6, 15, partZ + 6);
  const rooms: Room[] = [];
  // RDC avant : laverie / épicerie ; le rabatteur attend près du comptoir
  const shop: Room = { kind: boss === 'dadou' ? 'laundromat' : 'store', floor: 0, x0: 2, z0: 2, x1: f.W - 2, z1: partZ };
  rooms.push(shop);
  furnishRoom(fu, shop, 0);
  fu.mark('recruit', f.W - 8, partZ - 4);
  // RDC fond : la planque d'armes (sacs, casier)
  const stash: Room = { kind: 'stash', floor: 0, x0: 2, z0: partZ + 2, x1: sx0 - 2, z1: f.D - 2 };
  rooms.push(stash);
  fu.lv = g0;
  fu.floor(stash.x0, stash.z0, stash.x1, stash.z1, M.CONCRETE);
  fu.againstWall(stash, 'WEAPON_LOCKER', 'back', stash.x0 + 4, 0);
  fu.p('DUFFEL_BAG', stash.x0 + 9, stash.z1 - 3, 0.3, 0, true);
  fu.p('AMMO_CRATE', stash.x0 + 4, stash.z0 + 4, 0);
  fu.p('CARDBOARD_BOXES', stash.x1 - 3, stash.z1 - 3, 0);
  fu.lights(stash, 'BARE_BULB', 10);
  fu.mark('armory', stash.x0 + 4, stash.z1 - 5);
  // ÉTAGE : l'appartement minable (matelas, canapé, télé, kitchenette, table au portable)
  const l1 = floors[1];
  fu.lv = l1;
  const apt: Room = { kind: 'hideout', floor: 1, x0: 2, z0: 2, x1: f.W - 2, z1: partZ };
  rooms.push(apt);
  fu.floor(apt.x0, apt.z0, apt.x1, apt.z1, M.FLOOR_WORN);
  const acx = (apt.x0 + apt.x1) / 2;
  fu.p('MATTRESS', apt.x0 + 4, apt.z0 + 6, HALF_PI, 0, true);
  fu.p('SOFA_OLD', acx, apt.z0 + 4, 0, pal.sofa);
  fu.p('TV_OLD', acx, apt.z0 + 11, Math.PI);
  fu.p('PIZZA_BOXES', acx + 3, apt.z0 + 8, 0.4, 0, true);
  fu.againstWall(apt, 'KITCHENETTE', 'right', apt.z0 + 6);
  fu.againstWall(apt, 'FRIDGE', 'right', apt.z0 + 12);
  // la « table de commandement » : une table pliante et un vieux portable
  const tx = apt.x0 + 8;
  const tz = apt.z1 - 6;
  fu.p('LAPTOP_TABLE', tx, tz, Math.PI, 0, true);
  fu.p('CHAIR_PLASTIC', tx, tz - 3, 0, 0, true);
  fu.mark('desk', tx, tz, 0);
  fu.mark('deskSeat', tx, tz - 5.5);
  fu.wall(apt, 'PORTRAIT_BOSS', 'left', apt.z0 + 10, 7, boss === 'dadou' ? 1 : 2);
  fu.wall(apt, 'NEON_ART', 'back', acx + 6, 8, pal.neonVariant);
  fu.p('TRASH_PILE', apt.x1 - 4, apt.z1 - 3, 0, 0, true);
  fu.lights(apt, 'BARE_BULB', 12);
  // fond de l'étage : salle de bains
  const bath: Room = { kind: 'bath', floor: 1, x0: 2, z0: partZ + 2, x1: sx0 - 2, z1: f.D - 2 };
  rooms.push(bath);
  fu.floor(bath.x0, bath.z0, bath.x1, bath.z1, M.TILE_WHITE);
  fu.againstWall(bath, 'SHOWER', 'back', bath.x0 + 3);
  fu.againstWall(bath, 'TOILET', 'left', bath.z1 - 6);
  fu.againstWall(bath, 'SINK', 'left', bath.z0 + 4);
  fu.lights(bath, 'BARE_BULB', 10);
  // équipements du QG (palier 1) : carte holographique sur la table, écrans de surveillance au
  // mur du fond de l'appartement, terminal de recrutement contre le mur près du comptoir
  const upg: UpgSpot[] = [];
  fu.lv = l1;
  spot(upg, fu, 'holomap', tx, tz, 0, 1.2, 0.78);
  spot(upg, fu, 'surveil', apt.x0 + 22, apt.z1, Math.PI);
  fu.lv = g0;
  spot(upg, fu, 'autorecruit', shop.x1, shop.z1 - 10, -HALF_PI);
  f.prop('DOOR_LEAF', doorLx + doorW / 2, g0.floorTop, 1.5, 0, 0);
  const info = makeInfo(ctx, def, f, floors, rooms, doorLx, doorW, fu, wallTop, wallTop + 30);
  exposeSpots(info, f, upg);
  info.sign = signFor(f, signY, doorLx, doorW);
  // la moto de départ attend devant la porte
  const g = f.pt(doorLx - 6, -5);
  info.garage = { x: g.x, z: g.z, y: 0, yaw: f.yaw(HALF_PI) };
  return info;
}

// ======================================================================= palier 2 : le garage

function buildGarage(ctx: GenContext, def: BuildingDef): BuildingInfo {
  const rng = new Rng(hash32(def.id * 7919 + 101));
  const boss = def.residence!.boss;
  const pal = paletteOf(boss);
  const f = new Frame(ctx, def.rect, def.door, def.id);
  const st: Facade = { ...FACADE_DEFAULT, wall: boss === 'dadou' ? M.BRICK_RED : M.BRICK_YELLOW, wallSide: M.BRICK_DARK, lit: 0.55, winW: 6, winH: 5, sills: false };
  const floors = computeFloors(2, 20, 12);
  const wallTop = floors[1].ceil + 2;
  buildBox(f, { wall: st.wall, wallSide: st.wallSide, base: M.CONCRETE, floorMat: [M.CONCRETE_DARK, M.FLOOR_OAK], ceilMat: M.CEILING_DARK, roofMat: M.ROOF_TAR }, floors, wallTop);
  const exp = exposure(ctx, f, def.id);
  const walls: Wall[] = (['front', 'left', 'right', 'back'] as Wall[]).filter((w) => exp[w]);
  const g0 = floors[0];
  // grande porte de garage (sortie des véhicules) + porte d'entrée
  const bayW = 18;
  const bayX = 4;
  f.fill(bayX, g0.floorTop, 0, bayX + bayW, g0.floorTop + 15, 2, 0);
  f.fill(bayX - 1, g0.floorTop, -1, bayX, g0.floorTop + 16, 0, M.STEEL);
  f.fill(bayX + bayW, g0.floorTop, -1, bayX + bayW + 1, g0.floorTop + 16, 0, M.STEEL);
  f.fill(bayX - 1, g0.floorTop + 15, -1, bayX + bayW + 1, g0.floorTop + 16, 0, pal.led);
  f.prop('ROLLUP_DOOR', bayX + bayW / 2, g0.floorTop, 0.3, Math.PI, 1);
  const doorW = 6;
  const doorLx = f.W - 14;
  entrance(f, g0, doorLx, doorW, 11, M.STEEL, M.CONCRETE);
  for (const w of walls) if (w !== 'front') windowRow(f, w, st, rng, g0.floorTop + 10, 5);
  for (const w of walls) windowRow(f, w, st, rng, floors[1].floorTop + 4, 6);
  cladFace(f, 'front', g0.ceil, g0.ceil + 2, pal.led);
  parapet(f, wallTop, st.wallSide, 3);
  ledRing(f, 0, 0, f.W, f.D, wallTop + 2, pal.neon);
  // intérieur
  const sx0 = f.W - 2 - STAIR_W;
  const sz0 = f.D - 2 - STAIR_D;
  const partZ = sz0 - 2;
  // à l'étage seulement : cloison avant / fond
  f.fill(2, floors[1].floorTop, partZ, sx0 - 2, floors[1].ceil, partZ + 2, M.BRICK_DARK);
  f.fill(8, floors[1].floorTop, partZ, 13, floors[1].floorTop + 9, partZ + 2, 0);
  // au RDC : bureau vitré dans le coin avant droit
  const ox0 = f.W - 22;
  const oz1 = 18;
  f.fill(ox0, g0.floorTop, 2, ox0 + 2, g0.ceil, oz1, M.BRICK_DARK);
  f.fill(ox0, g0.floorTop + 3, 6, ox0 + 1, g0.floorTop + 12, oz1 - 3, M.GLASS_CLEAR);
  f.fill(ox0, g0.floorTop, oz1, f.W - 2, g0.ceil, oz1 + 2, M.BRICK_DARK);
  f.fill(ox0 + 6, g0.floorTop, oz1, ox0 + 11, g0.floorTop + 9, oz1 + 2, 0);
  const stairs = stairShaft(f, sx0, sz0, floors, wallTop, M.BRICK_DARK, M.STEEL);
  f.fill(doorLx, g0.floorTop, 0, doorLx + doorW, g0.floorTop + 11, 2, 0);
  const fu = new Furnisher(f, g0, rng);
  fu.boss = boss;
  fu.reserve(doorLx - 3, 0, doorLx + doorW + 3, 10);
  fu.reserve(bayX, 0, bayX + bayW, 26);
  for (const d of stairs.doors) fu.reserve(d.lx - 4, d.lz - 6, d.lx + 4, d.lz + 3);
  const rooms: Room[] = [];
  // RDC : l'atelier (pont élévateur, voitures, outils)
  const bay: Room = { kind: 'garage_floor', floor: 0, x0: 2, z0: 2, x1: ox0, z1: f.D - 2 };
  rooms.push(bay);
  fu.floor(bay.x0, bay.z0, bay.x1, bay.z1, M.CONCRETE_DARK);
  fu.p('CAR_LIFT', bay.x0 + 12, bay.z1 - 12, 0, 0, true);
  fu.p('CAR_PARKED', bay.x0 + 12, bay.z1 - 12, 0.05, boss === 'dadou' ? 1 : 2, true, g0.floorTop + 1.2);
  fu.lineWall(bay, 'TIRE_STACK', 'left', 3, 4);
  fu.againstWall(bay, 'WORKBENCH', 'back', bay.x0 + 26);
  fu.wall(bay, 'TOOL_WALL', 'back', bay.x0 + 34, 4);
  fu.p('BARREL', bay.x1 - 4, bay.z1 - 3, 0);
  fu.lights(bay, 'NEON_TUBE_CEILING', 12, 7);
  fu.mark('garage', bayX + bayW / 2, -6, Math.PI);
  // bureau vitré : la table des opérations (carte de la ville)
  const off: Room = { kind: 'garage_office', floor: 0, x0: ox0 + 2, z0: 2, x1: f.W - 2, z1: oz1 };
  rooms.push(off);
  fu.floor(off.x0, off.z0, off.x1, off.z1, M.FLOOR_OAK);
  const ocx = (off.x0 + off.x1) / 2;
  fu.p('MAP_TABLE', ocx, (off.z0 + off.z1) / 2, 0, 0, true);
  fu.mark('desk', ocx, (off.z0 + off.z1) / 2, 0);
  fu.mark('deskSeat', ocx, off.z0 + 3);
  fu.wall(off, 'SCREEN_WALL', 'right', (off.z0 + off.z1) / 2, 3);
  fu.wall(off, 'PORTRAIT_BOSS', 'back', ocx - 3, 7, boss === 'dadou' ? 1 : 2);
  fu.lights(off, 'PENDANT_LIGHT', 10);
  // ÉTAGE : salle commune (canapés, télé, cuisine, couchettes) et armurerie
  const l1 = floors[1];
  fu.lv = l1;
  const lounge: Room = { kind: 'crew_lounge', floor: 1, x0: 2, z0: 2, x1: f.W - 2, z1: partZ };
  rooms.push(lounge);
  fu.reserve(6, partZ - 6, 15, partZ + 6);
  fu.floor(lounge.x0 + 4, lounge.z0 + 4, lounge.x0 + 24, lounge.z0 + 16, pal.carpet);
  fu.p('SOFA', lounge.x0 + 14, lounge.z0 + 13, Math.PI, pal.sofa);
  fu.p('COFFEE_TABLE', lounge.x0 + 14, lounge.z0 + 9, 0, 2);
  fu.wall(lounge, 'TV_WALL', 'front', lounge.x0 + 14, 6);
  fu.lineWall(lounge, 'BUNK_BED', 'right', 6, 3);
  fu.againstWall(lounge, 'KITCHEN_COUNTER', 'back', lounge.x0 + 30);
  fu.againstWall(lounge, 'FRIDGE', 'back', lounge.x0 + 36);
  fu.p('POOL_TABLE', lounge.x0 + 30, lounge.z0 + 12, 0);
  f.prop('FLAG_BANNER', lounge.x0 + 0.6, l1.floorTop + 5, lounge.z0 + 20, HALF_PI, 0);
  fu.lights(lounge, 'PENDANT_LIGHT', 12);
  fu.mark('recruit', lounge.x0 + 30, lounge.z0 + 18);
  const arm: Room = { kind: 'armory', floor: 1, x0: 2, z0: partZ + 2, x1: sx0 - 2, z1: f.D - 2 };
  rooms.push(arm);
  fu.floor(arm.x0, arm.z0, arm.x1, arm.z1, M.METAL_PANEL_DARK);
  fu.lineWall(arm, 'WEAPON_RACK', 'back', 8, 2);
  fu.againstWall(arm, 'WEAPON_LOCKER', 'left', arm.z0 + 6);
  fu.p('AMMO_CRATE', (arm.x0 + arm.x1) / 2, (arm.z0 + arm.z1) / 2, 0.2);
  fu.lights(arm, 'CEILING_LIGHT', 10);
  fu.mark('armory', (arm.x0 + arm.x1) / 2, arm.z0 + 4);
  for (const r of rooms) finishWalls(f, floors[r.floor], r.x0, r.z0, r.x1, r.z1, r.floor === 0 ? M.BRICK_DARK : M.BRICK_RED, 0);
  // équipements du QG (paliers 1 et 2) : coin des opérations le long du mur avant de l'atelier
  // (hors du passage des véhicules), trophées au fond du bureau vitré, armurerie et recrutement à l'étage
  const upg: UpgSpot[] = [];
  fu.lv = g0;
  spot(upg, fu, 'holomap', ocx, (off.z0 + off.z1) / 2, 0, 2.0, 0.92);
  spot(upg, fu, 'security', doorLx + doorW / 2, 2, 0, doorW * VOXEL);
  spot(upg, fu, 'cyberstation', bayX + bayW + 9, bay.z0, 0);
  spot(upg, fu, 'surveil', bayX + bayW + 24, bay.z0, 0);
  spot(upg, fu, 'comms', bayX + bayW + 36, bay.z0, 0);
  spot(upg, fu, 'trophies', off.x1 - 4, off.z1, Math.PI);
  streetSpot(upg, 'transport', bayX + bayW + 22, -6, Math.PI);
  fu.lv = l1;
  spot(upg, fu, 'autorecruit', lounge.x0 + 37.2, lounge.z0 + 18, -HALF_PI);
  spot(upg, fu, 'armory2', (arm.x0 + arm.x1) / 2 + 15, arm.z0, 0);
  f.prop('DOOR_LEAF', doorLx + doorW / 2, g0.floorTop, 1.5, 0, 0);
  const info = makeInfo(ctx, def, f, floors, rooms, doorLx, doorW, fu, wallTop, wallTop + 8);
  exposeSpots(info, f, upg);
  info.sign = signFor(f, g0.ceil - 4, doorLx, doorW);
  return info;
}

// ======================================================================= palier 3 : le loft

function buildLoft(ctx: GenContext, def: BuildingDef): BuildingInfo {
  const rng = new Rng(hash32(def.id * 7919 + 101));
  const boss = def.residence!.boss;
  const pal = paletteOf(boss);
  const f = new Frame(ctx, def.rect, def.door, def.id);
  const st: Facade = { ...FACADE_DEFAULT, wall: boss === 'dadou' ? M.BRICK_DARK : M.BRICK_RED, wallSide: M.BRICK_BROWN, trim: M.IRON, frame: M.IRON, lit: 0.8, winW: 8, winH: 10, winSpacing: 11 };
  const floors = computeFloors(2, 18, 16);
  const wallTop = floors[1].ceil + 2;
  buildBox(f, { wall: st.wall, wallSide: st.wallSide, base: M.GRANITE, floorMat: [M.FLOOR_WALNUT, M.FLOOR_WALNUT], ceilMat: M.CEILING_DARK, roofMat: M.ROOF_TAR }, floors, wallTop);
  const exp = exposure(ctx, f, def.id);
  const walls: Wall[] = (['front', 'left', 'right', 'back'] as Wall[]).filter((w) => exp[w]);
  const g0 = floors[0];
  const doorW = 6;
  const doorLx = Math.round(f.W / 2 - doorW / 2);
  windowRow(f, 'front', st, rng, g0.floorTop + 4, 10, (c) => c + st.winW + 2 > doorLx - 1 && c - 2 < doorLx + doorW + 1);
  entrance(f, g0, doorLx, doorW, 11, M.IRON, M.GRANITE, M.IRON);
  for (const w of walls) if (w !== 'front') windowRow(f, w, st, rng, g0.floorTop + 5, 9);
  for (const w of walls) windowRow(f, w, st, rng, floors[1].floorTop + 3, 12);
  band(f, walls, g0.ceil, M.IRON);
  cornice(f, wallTop + 3, M.IRON, true);
  parapet(f, wallTop, st.wallSide);
  // verrière sur le toit, au-dessus du séjour
  const vx0 = 6;
  const vx1 = Math.min(f.W - 18, 34);
  f.fill(vx0, floors[1].ceil, 6, vx1, wallTop, 18, 0);
  f.fill(vx0, wallTop - 1, 6, vx1, wallTop, 18, M.GLASS_CLEAR);
  for (let x = vx0; x < vx1; x += 4) f.fill(x, wallTop - 1, 6, x + 1, wallTop, 18, M.IRON);
  ledRing(f, 0, 0, f.W, f.D, g0.ceil + 1, pal.neon);
  f.prop('NEON_WALL_SIGN', f.W / 2, g0.ceil + 3, -0.3, Math.PI, pal.neonVariant);
  // intérieur
  const sx0 = f.W - 2 - STAIR_W;
  const sz0 = f.D - 2 - STAIR_D;
  const partZ = sz0 - 2;
  for (const lv of floors) {
    f.fill(2, lv.floorTop, partZ, sx0 - 2, lv.ceil, partZ + 2, M.BRICK_DARK);
    f.fill(8, lv.floorTop, partZ, 13, lv.floorTop + 9, partZ + 2, 0);
  }
  const stairs = stairShaft(f, sx0, sz0, floors, wallTop, M.BRICK_DARK, M.STEEL);
  f.fill(doorLx, g0.floorTop, 0, doorLx + doorW, g0.floorTop + 11, 2, 0);
  const fu = new Furnisher(f, g0, rng);
  fu.boss = boss;
  fu.reserve(doorLx - 3, 0, doorLx + doorW + 3, 10);
  fu.reserve(6, partZ - 6, 15, partZ + 6);
  for (const d of stairs.doors) fu.reserve(d.lx - 4, d.lz - 6, d.lx + 4, d.lz + 3);
  const rooms: Room[] = [];
  // RDC : salon-bar (le bras droit y recrute) + armurerie
  const bar: Room = { kind: 'loft_bar', floor: 0, x0: 2, z0: 2, x1: f.W - 2, z1: partZ };
  rooms.push(bar);
  fu.floor(bar.x0, bar.z0, bar.x1, bar.z1, M.FLOOR_WALNUT);
  fu.counter(bar.x0 + 2, bar.z0 + 6, bar.x0 + 5, bar.z1 - 6, M.MAHOGANY, M.MARBLE_BLACK, 4, pal.led);
  fu.p('BOTTLE_SHELF', bar.x0 + 0.9, (bar.z0 + bar.z1) / 2, FACE.fromLeft, 0, true);
  for (let z = bar.z0 + 8; z < bar.z1 - 7; z += 3) fu.p('BAR_STOOL', bar.x0 + 7, z, -HALF_PI, 0);
  fu.mark('recruit', bar.x0 + 7, (bar.z0 + bar.z1) / 2);
  fu.p('POOL_TABLE', bar.x0 + 20, (bar.z0 + bar.z1) / 2, 0);
  fu.p('SOFA_LUXE', bar.x1 - 8, bar.z0 + 5, 0, pal.sofa);
  fu.p('COFFEE_TABLE', bar.x1 - 8, bar.z0 + 9, 0);
  fu.p('JUKEBOX', bar.x1 - 3, bar.z1 - 3, Math.PI);
  fu.wall(bar, 'NEON_ART', 'back', bar.x0 + 18, 8, pal.neonVariant);
  fu.wall(bar, 'FLAG_BANNER', 'back', bar.x0 + 26, 4);
  fu.lights(bar, 'PENDANT_LIGHT', 11);
  const arm: Room = { kind: 'armory', floor: 0, x0: 2, z0: partZ + 2, x1: sx0 - 2, z1: f.D - 2 };
  rooms.push(arm);
  fu.floor(arm.x0, arm.z0, arm.x1, arm.z1, M.METAL_PANEL_DARK);
  fu.lineWall(arm, 'WEAPON_RACK', 'back', 8, 2);
  fu.lineWall(arm, 'WEAPON_LOCKER', 'left', 5, 3);
  fu.p('AMMO_CRATE', (arm.x0 + arm.x1) / 2, (arm.z0 + arm.z1) / 2, 0.2);
  fu.lights(arm, 'CEILING_LIGHT', 10);
  fu.mark('armory', (arm.x0 + arm.x1) / 2, arm.z0 + 4);
  // ÉTAGE : le loft (séjour sous verrière, bureau de commandement, chambre)
  const l1 = floors[1];
  fu.lv = l1;
  const loft: Room = { kind: 'loft', floor: 1, x0: 2, z0: 2, x1: f.W - 2, z1: partZ };
  rooms.push(loft);
  fu.floor(loft.x0 + 4, loft.z0 + 4, loft.x0 + 30, loft.z0 + 18, pal.carpet);
  fu.p('SOFA_LUXE', loft.x0 + 17, loft.z0 + 16, Math.PI, pal.sofa);
  fu.p('ARMCHAIR', loft.x0 + 6, loft.z0 + 11, HALF_PI, pal.sofa);
  fu.p('COFFEE_TABLE', loft.x0 + 17, loft.z0 + 11, 0);
  fu.wall(loft, 'TV_WALL', 'front', loft.x0 + 17, 6);
  fu.p('PLANT_BIG', loft.x0 + 3, loft.z0 + 3, 0);
  fu.p('LAMP_FLOOR', loft.x0 + 29, loft.z0 + 16, 0);
  // bureau de commandement face à la grande baie
  const dx = loft.x1 - 12;
  const dz = loft.z0 + 6;
  fu.p('COMMAND_DESK', dx, dz, 0, 0, true);
  fu.p('BOSS_CHAIR', dx, dz + 3.5, Math.PI, 0, true);
  fu.mark('desk', dx, dz, Math.PI);
  fu.mark('deskSeat', dx, dz + 7);
  fu.wall(loft, 'PORTRAIT_BOSS', 'right', loft.z0 + 16, 7, boss === 'dadou' ? 1 : 2);
  fu.p('BED', loft.x1 - 8, loft.z1 - 5, Math.PI, pal.sofa);
  fu.f.fill(loft.x1 - 18, l1.floorTop, loft.z1 - 12, loft.x1 - 17, l1.floorTop + 9, loft.z1, M.GLASS_CLEAR);
  fu.p('AQUARIUM', loft.x0 + 30, loft.z1 - 2, Math.PI);
  fu.lights(loft, 'PENDANT_LIGHT', 12);
  fu.ceiling('NEON_TUBE_CEILING', loft.x0 + 17, loft.z0 + 10, pal.neonVariant);
  const dress: Room = { kind: 'bath', floor: 1, x0: 2, z0: partZ + 2, x1: sx0 - 2, z1: f.D - 2 };
  rooms.push(dress);
  fu.floor(dress.x0, dress.z0, dress.x1, dress.z1, M.MARBLE_BLACK);
  fu.againstWall(dress, 'BATHTUB', 'back', dress.x0 + 6);
  fu.againstWall(dress, 'SINK', 'left', dress.z0 + 4, 1);
  fu.againstWall(dress, 'WARDROBE', 'right', dress.z0 + 6);
  fu.lights(dress, 'CEILING_LIGHT', 10);
  for (const r of rooms) finishWalls(f, floors[r.floor], r.x0, r.z0, r.x1, r.z1, r.kind === 'armory' ? M.CONCRETE_DARK : M.BRICK_RED, 0);
  // équipements du QG (paliers 1 à 3) : au rez-de-chaussée l'entrée, le recrutement et l'armurerie ;
  // à l'étage, le mur du fond du loft (le seul sans fenêtres) et un îlot médical au milieu
  const upg: UpgSpot[] = [];
  fu.lv = g0;
  spot(upg, fu, 'security', doorLx + doorW / 2, 2, 0, doorW * VOXEL);
  spot(upg, fu, 'elite3', doorLx - 5, 9);
  spot(upg, fu, 'elite4', doorLx + doorW + 5, 9);
  spot(upg, fu, 'autorecruit', bar.x0 + 19, bar.z0 + 44, Math.PI);
  spot(upg, fu, 'armory2', (arm.x0 + arm.x1) / 2 + 15, arm.z0, 0);
  streetSpot(upg, 'transport', doorLx - 22, -6, Math.PI);
  fu.lv = l1;
  spot(upg, fu, 'holomap', dx, dz, 0, 2.4, 1.32);
  spot(upg, fu, 'elite1', dx - 9, dz + 4);
  spot(upg, fu, 'elite2', dx + 9, dz + 4);
  spot(upg, fu, 'dronecmd', loft.x0 + 18, loft.z1, Math.PI);
  spot(upg, fu, 'trophies', loft.x0 + 40, loft.z1, Math.PI);
  spot(upg, fu, 'surveil', loft.x0 + 52, loft.z1, Math.PI);
  spot(upg, fu, 'opscenter', loft.x0 + 64, loft.z1, Math.PI);
  spot(upg, fu, 'comms', loft.x0 + 74, loft.z1, Math.PI);
  spot(upg, fu, 'cyberstation', loft.x0 + 70, loft.z0 + 36, Math.PI);
  f.prop('DOOR_LEAF', doorLx + doorW / 2, g0.floorTop, 1.5, 0, 0);
  const info = makeInfo(ctx, def, f, floors, rooms, doorLx, doorW, fu, wallTop, wallTop + 8);
  exposeSpots(info, f, upg);
  info.sign = signFor(f, g0.ceil - 4, doorLx, doorW);
  const g = f.pt(doorLx - 8, -5);
  info.garage = { x: g.x, z: g.z, y: 0, yaw: f.yaw(HALF_PI) };
  return info;
}

// ======================================================================= paliers 4 et 5 : les tours

function buildTower(ctx: GenContext, def: BuildingDef): BuildingInfo {
  const rng = new Rng(hash32(def.id * 7919 + 101));
  const tier = def.residence?.tier ?? 0;
  const boss = def.residence?.boss ?? null;
  const pal = paletteOf(boss);
  const f = new Frame(ctx, def.rect, def.door, def.id);
  const corp = def.type === 'corp';
  const deco = tier === 5 || (boss === 'dadou' && tier === 4);
  const st: Facade = {
    ...FACADE_DEFAULT,
    wall: deco ? M.LIMESTONE : M.METAL_PANEL_DARK,
    wallSide: deco ? M.LIMESTONE : M.METAL_PANEL_DARK,
    trim: deco ? pal.metal : M.CHROME,
    lit: 0.7,
    cool: true,
    winW: 6,
    winH: 10,
    winSpacing: 9,
  };
  const topLy = Math.round((def.height ?? 52) * 4);
  // hall d'entrée (rez-de-chaussée de 6 m)
  const lobby: Levels = { floorTop: 1, ceil: 26 };
  // étages accessibles en haut de la tour (36 m et 41 m)
  const p1: Levels = { floorTop: 145, ceil: 162 };
  const p2: Levels = { floorTop: 164, ceil: 176 };
  const roofTop = 178;
  const inset = 4;
  const { W, D } = f;
  // ---------------------------------------------------------------- volumes
  f.fill(0, 0, 0, W, 1, D, M.GRANITE);
  f.fill(2, 0, 2, W - 2, 1, D - 2, M.MARBLE);
  // socle (hall) : vitré sur rue
  hollowBlock(f, 0, 0, W, D, 1, lobby.ceil + 2, st.wall, M.CONCRETE);
  // fût (fermé) puis étages du parrain, en retrait
  const x0 = inset;
  const z0 = inset;
  const x1 = W - inset;
  const z1 = D - inset;
  hollowBlock(f, x0, z0, x1, z1, lobby.ceil + 2, p1.floorTop - 1, st.wall);
  f.fill(x0 + 2, p1.floorTop - 1, z0 + 2, x1 - 2, p1.floorTop, z1 - 2, pal.carpet);
  f.fill(x0, p1.floorTop - 3, z0, x1, p1.floorTop - 1, z1, M.CONCRETE);
  // étages vitrés (vue panoramique)
  for (const lv of [p1, p2]) {
    f.fill(x0, lv.floorTop, z0, x1, lv.ceil, z0 + 2, M.GLASS_CLEAR);
    f.fill(x0, lv.floorTop, z1 - 2, x1, lv.ceil, z1, M.GLASS_CLEAR);
    f.fill(x0, lv.floorTop, z0, x0 + 2, lv.ceil, z1, M.GLASS_CLEAR);
    f.fill(x1 - 2, lv.floorTop, z0, x1, lv.ceil, z1, M.GLASS_CLEAR);
    // montants
    for (let x = x0; x <= x1 - 1; x += 8) {
      f.fill(x, lv.floorTop, z0, x + 1, lv.ceil, z0 + 2, st.trim);
      f.fill(x, lv.floorTop, z1 - 2, x + 1, lv.ceil, z1, st.trim);
    }
    for (let z = z0; z <= z1 - 1; z += 8) {
      f.fill(x0, lv.floorTop, z, x0 + 2, lv.ceil, z + 1, st.trim);
      f.fill(x1 - 2, lv.floorTop, z, x1, lv.ceil, z + 1, st.trim);
    }
    f.fill(x0, lv.ceil, z0, x1, lv.ceil + 2, z1, M.CONCRETE);
    f.fill(x0 + 2, lv.ceil, z0 + 2, x1 - 2, lv.ceil + 1, z1 - 2, M.CEILING);
  }
  f.fill(x0 + 2, p2.floorTop - 1, z0 + 2, x1 - 2, p2.floorTop, z1 - 2, M.FLOOR_WALNUT);
  // toit-terrasse
  f.fill(x0, roofTop - 2, z0, x1, roofTop, z1, M.DECK_WOOD);
  // ---------------------------------------------------------------- habillage extérieur
  const exp = exposure(ctx, f, def.id);
  // façade du socle : grande vitrine et entrée
  const doorW = 8;
  const doorLx = Math.round(W / 2 - doorW / 2);
  storefront(f, lobby, doorLx, doorW, { frame: st.trim, band: st.wall, glass: M.GLASS_CLEAR, neon: pal.led, height: 20 });
  entrance(f, lobby, doorLx, doorW, 12, st.trim, M.GRANITE, st.wall);
  if (deco) {
    // art déco : piliers de pierre et vitrage doré
    curtainBlock(f, x0, z0, x1, z1, lobby.ceil + 2, p1.floorTop - 3, corp ? M.CURTAIN_BLUE : M.CURTAIN_GOLD, M.LIMESTONE);
    for (const w of ['front', 'back', 'left', 'right'] as Wall[]) piers(f, w, st, lobby.ceil + 2, p1.floorTop - 3, M.LIMESTONE);
  } else {
    // tour d'Even : verre holographique (reflets cyan la nuit) et allèges en carbone
    const holo = !corp && boss === 'even';
    curtainBlock(f, x0, z0, x1, z1, lobby.ceil + 2, p1.floorTop - 3, corp ? M.CURTAIN_BLUE : holo ? M.GLASS_HOLO : M.CURTAIN_DARK, holo ? M.CARBON_PANEL : M.METAL_PANEL_DARK);
  }
  ledRing(f, 0, 0, W, D, lobby.ceil + 2, pal.led);
  ledRing(f, x0, z0, x1, z1, p1.floorTop - 2, pal.led);
  ledRing(f, x0, z0, x1, z1, roofTop + 3, pal.neon);
  // acrotère vitré du toit-terrasse
  f.fill(x0, roofTop, z0, x1, roofTop + 4, z0 + 1, M.GLASS_CLEAR);
  f.fill(x0, roofTop, z1 - 1, x1, roofTop + 4, z1, M.GLASS_CLEAR);
  f.fill(x0, roofTop, z0, x0 + 1, roofTop + 4, z1, M.GLASS_CLEAR);
  f.fill(x1 - 1, roofTop, z0, x1, roofTop + 4, z1, M.GLASS_CLEAR);
  f.fill(x0, roofTop + 4, z0, x1, roofTop + 6, z0 + 1, M.BARRIER);
  f.fill(x0, roofTop + 4, z1 - 1, x1, roofTop + 6, z1, M.BARRIER);
  f.fill(x0, roofTop + 4, z0, x0 + 1, roofTop + 6, z1, M.BARRIER);
  f.fill(x1 - 1, roofTop + 4, z0, x1, roofTop + 6, z1, M.BARRIER);
  // couronne : flèche art déco ou couronne de verre, jusqu'au sommet
  crown(f, x0, z0, x1, z1, roofTop, topLy, deco, pal, st);
  // écran géant sur le socle des tours de Times Square
  if (tier === 5) {
    const sw = W - 10;
    f.fill(5, lobby.ceil + 4, -1, 5 + sw, lobby.ceil + 26, 0, M.SCREEN_ADS);
    addScreen(ctx, f, 5 + sw / 2, lobby.ceil + 15, -1.08, sw, 22, def.district, 'boss');
  }
  void exp;
  // ---------------------------------------------------------------- ascenseur et escalier intérieur
  const ex0 = Math.round(W / 2 - ELEV_W / 2);
  const ez0 = z1 - 2 - ELEV_D - 2;
  const stops = elevatorCore(f, ex0, ez0, [lobby.floorTop, p1.floorTop, p2.floorTop, roofTop], roofTop + 12, M.METAL_PANEL_DARK);
  f.fill(ex0 - 1, roofTop + 12, ez0 - 1, ex0 + ELEV_W + 1, roofTop + 14, ez0 + ELEV_D + 1, M.METAL_PANEL_DARK);
  // escalier entre les deux étages du parrain (coin arrière droit)
  const sx0 = x1 - 2 - STAIR_W;
  const sz0 = z1 - 2 - STAIR_D;
  const stairs = stairShaft(f, sx0, sz0, [p1, p2], null, M.PLASTER_DARK, M.MARBLE_BLACK);
  // portails d'ascenseur pour la navigation des PNJ
  const labels = ['Hall', tier === 5 || corp ? 'Commandement' : 'Penthouse', tier === 5 || corp ? 'Bureaux' : 'Appartements', 'Toit'];
  const stopPts = stops.map((s, i) => ({ ...f.pt(s.lx, s.lz), y: s.ly * VOXEL, label: labels[i] }));
  for (let i = 0; i < stopPts.length; i++)
    for (let j = i + 1; j < stopPts.length; j++) {
      const a = stopPts[i];
      const b = stopPts[j];
      ctx.portals.push({ kind: 'elevator', ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, cost: 18 + Math.abs(b.y - a.y) * 0.6, building: def.id });
    }
  // ---------------------------------------------------------------- intérieurs
  f.fill(doorLx, lobby.floorTop, 0, doorLx + doorW, lobby.floorTop + 12, 2, 0);
  const fu = new Furnisher(f, lobby, rng);
  fu.boss = boss;
  fu.reserve(doorLx - 3, 0, doorLx + doorW + 3, 12);
  fu.reserve(ex0 - 3, ez0 - 8, ex0 + ELEV_W + 3, ez0);
  for (const d of stairs.doors) fu.reserve(d.lx - 4, d.lz - 6, d.lx + 4, d.lz + 3);
  const rooms: Room[] = [];
  // hall : réception, gardes, ascenseur
  const hall: Room = { kind: 'tower_lobby', floor: 0, x0: 2, z0: 2, x1: W - 2, z1: D - 2 };
  rooms.push(hall);
  fu.floor(hall.x0, hall.z0, hall.x1, hall.z1, deco ? M.MARBLE_BLACK : M.TERRAZZO_DARK);
  fu.p('RECEPTION_DESK', W / 2, 16, Math.PI, 0);
  fu.p('PLANT_BIG', 5, 5, 0);
  fu.p('PLANT_BIG', W - 5, 5, 0);
  fu.p('SOFA_LUXE', 7, D / 2, HALF_PI, pal.sofa);
  fu.p('SOFA_LUXE', W - 7, D / 2, -HALF_PI, pal.sofa);
  f.prop('FLAG_BANNER', W / 2 - 8, lobby.floorTop + 10, D - 2.6, Math.PI, 0);
  f.prop('FLAG_BANNER', W / 2 + 8, lobby.floorTop + 10, D - 2.6, Math.PI, 0);
  fu.lights(hall, deco ? 'CHANDELIER' : 'CEILING_LIGHT', 14);
  finishWalls(f, lobby, 2, 2, W - 2, D - 2, deco ? M.MARBLE : M.PLASTER_DARK, deco ? M.GRANITE_DARK : M.SLATS_DARK);
  // équipements du QG dans le hall (sas de sécurité, gardes de l'entrée) et dans la rue
  const upg: UpgSpot[] = [];
  if (boss) {
    const dc = doorLx + doorW / 2;
    spot(upg, fu, 'security', dc, 2, 0, doorW * VOXEL);
    spot(upg, fu, 'elite3', dc - 10, 10);
    spot(upg, fu, 'elite4', dc + 10, 10);
    streetSpot(upg, 'transport', dc - 26, -6, Math.PI);
  }
  if (corp) {
    // tour de bureaux : étage de direction et salle des serveurs
    fu.lv = p1;
    const exec: Room = { kind: 'exec_office', floor: 1, x0: x0 + 2, z0: z0 + 2, x1: x1 - 2, z1: ez0 - 2 };
    rooms.push(exec);
    furnishRoom(fu, exec, 0);
    fu.lv = p2;
    const srv: Room = { kind: 'server_room', floor: 2, x0: x0 + 2, z0: z0 + 2, x1: sx0 - 4, z1: z1 - 2 };
    rooms.push(srv);
    furnishRoom(fu, srv, 0);
  } else if (tier === 4) {
    penthouseRooms(fu, f, rooms, pal, x0, z0, x1, z1, ex0, ez0, sx0, sz0, p1, p2, roofTop, upg);
  } else {
    towerRooms(fu, f, rooms, pal, x0, z0, x1, z1, ex0, ez0, sx0, sz0, p1, p2, roofTop, upg);
  }
  f.prop('DOOR_LEAF', doorLx + doorW / 2, lobby.floorTop, 1.5, 0, 0);
  const floors = [lobby, p1, p2];
  const info = makeInfo(ctx, def, f, floors, rooms, doorLx, doorW, fu, roofTop, topLy);
  exposeSpots(info, f, upg);
  info.sign = signFor(f, lobby.floorTop + 21, doorLx, doorW);
  info.elevator = stopPts.map((s) => ({ x: s.x, z: s.z, y: s.y, yaw: f.yaw(Math.PI), label: s.label }));
  // zones de capture : le hall et les deux étages (rectangles réels)
  info.zone = [
    { rect: f.rectM(2, 2, W - 2, D - 2), y0: lobby.floorTop * VOXEL - 0.6, y1: lobby.ceil * VOXEL },
    { rect: f.rectM(x0 + 2, z0 + 2, x1 - 2, z1 - 2), y0: p1.floorTop * VOXEL - 0.6, y1: p1.ceil * VOXEL },
    { rect: f.rectM(x0 + 2, z0 + 2, x1 - 2, z1 - 2), y0: p2.floorTop * VOXEL - 0.6, y1: p2.ceil * VOXEL },
  ];
  if (!info.garage) {
    const g = f.pt(-6, -6);
    info.garage = { x: g.x, z: g.z, y: 0, yaw: f.yaw(HALF_PI) };
  }
  return info;
}

/** Couronne de la tour : flèche art déco à gradins ou couronne de verre et de lumière. */
function crown(f: Frame, x0: number, z0: number, x1: number, z1: number, roofTop: number, top: number, deco: boolean, pal: Palette, st: Facade): void {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  if (top <= roofTop + 14) return;
  // édicule technique derrière la terrasse
  const h = top - roofTop - 12;
  if (deco) {
    // gradins successifs vers la flèche
    let r = Math.min(x1 - x0, z1 - z0) / 2 - 6;
    let y = roofTop + 12;
    const step = Math.max(6, Math.floor(h / 5));
    while (r > 2 && y < top - 6) {
      hollowBlock(f, Math.round(cx - r), Math.round(cz - r * 0.6), Math.round(cx + r), Math.round(cz + r * 0.6), y, y + step, M.LIMESTONE, M.LIMESTONE);
      ledRing(f, Math.round(cx - r), Math.round(cz - r * 0.6), Math.round(cx + r), Math.round(cz + r * 0.6), y + step - 1, pal.neon);
      // fenêtres triangulaires lumineuses
      for (let x = Math.round(cx - r) + 2; x < cx + r - 2; x += 4) f.fill(x, y + 2, Math.round(cz - r * 0.6), x + 2, y + step - 2, Math.round(cz - r * 0.6) + 1, M.LED_WARM);
      y += step;
      r -= 2.5;
    }
    f.fill(Math.round(cx) - 1, y, Math.round(cz) - 1, Math.round(cx) + 1, top, Math.round(cz) + 1, st.trim);
    f.fill(Math.round(cx), top - 3, Math.round(cz), Math.round(cx) + 1, top, Math.round(cz) + 1, pal.led);
  } else {
    // couronne de verre biseautée
    const cw = Math.round((x1 - x0) / 2 - 4);
    const cd = Math.round((z1 - z0) / 2 - 4);
    for (let y = roofTop + 12; y < top; y++) {
      const t = (y - roofTop - 12) / Math.max(1, top - roofTop - 12);
      const rw = Math.max(2, Math.round(cw * (1 - t * 0.7)));
      const rd = Math.max(2, Math.round(cd * (1 - t * 0.7)));
      const m = (y - roofTop) % 6 === 0 ? pal.led : M.CURTAIN_BLUE;
      f.fill(Math.round(cx - rw), y, Math.round(cz - rd), Math.round(cx + rw), y + 1, Math.round(cz - rd) + 1, m);
      f.fill(Math.round(cx - rw), y, Math.round(cz + rd) - 1, Math.round(cx + rw), y + 1, Math.round(cz + rd), m);
      f.fill(Math.round(cx - rw), y, Math.round(cz - rd), Math.round(cx - rw) + 1, y + 1, Math.round(cz + rd), m);
      f.fill(Math.round(cx + rw) - 1, y, Math.round(cz - rd), Math.round(cx + rw), y + 1, Math.round(cz + rd), m);
    }
  }
  void cladFace;
  void windowColumns;
}

/** Penthouse : séjour panoramique et salle de commandement (étage 1), suite et bar (étage 2), héliport. */
function penthouseRooms(
  fu: Furnisher,
  f: Frame,
  rooms: Room[],
  pal: Palette,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  ex0: number,
  ez0: number,
  sx0: number,
  sz0: number,
  p1: Levels,
  p2: Levels,
  roofTop: number,
  upg: UpgSpot[],
): void {
  const ix0 = x0 + 2;
  const iz0 = z0 + 2;
  const ix1 = x1 - 2;
  const iz1 = z1 - 2;
  // ---------------------------------------------------------------- étage 1
  fu.lv = p1;
  // cloison vitrée entre le séjour (avant) et la salle de commandement (gauche du fond)
  const cmdZ = Math.round((iz0 + iz1) / 2);
  f.fill(ix0, p1.floorTop, cmdZ, ex0 - 3, p1.ceil, cmdZ + 1, M.GLASS_CLEAR);
  f.fill(ix0 + 8, p1.floorTop, cmdZ, ix0 + 13, p1.floorTop + 10, cmdZ + 1, 0);
  const living: Room = { kind: 'ph_living', floor: 1, x0: ix0, z0: iz0, x1: ix1, z1: cmdZ };
  rooms.push(living);
  fu.floor(ix0 + 6, iz0 + 4, ix0 + 30, cmdZ - 3, pal.carpet);
  fu.p('SOFA_LUXE', ix0 + 18, iz0 + 6, 0, pal.sofa);
  fu.p('SOFA_LUXE', ix0 + 8, iz0 + 12, HALF_PI, pal.sofa);
  fu.p('COFFEE_TABLE', ix0 + 18, iz0 + 11, 0, 1);
  fu.p('GRAND_PIANO', ix1 - 8, iz0 + 7, -0.5);
  fu.p('BAR_COUNTER', ix1 - 4, cmdZ - 4, -HALF_PI, pal.neonVariant);
  fu.p('BAR_STOOL', ix1 - 8, cmdZ - 6, HALF_PI);
  fu.p('BAR_STOOL', ix1 - 8, cmdZ - 3, HALF_PI);
  fu.p('FIREPLACE', ix0 + 30, cmdZ - 1.2, Math.PI, 0, true);
  fu.p('PLANT_BIG', ix0 + 3, iz0 + 3, 0);
  fu.p('SCULPTURE', ix1 - 3, iz0 + 3, 0.6, 1);
  fu.lights(living, 'CHANDELIER', 18);
  fu.mark('recruit', ix1 - 9, cmdZ - 9);
  const cmd: Room = { kind: 'ph_command', floor: 1, x0: ix0, z0: cmdZ + 1, x1: ex0 - 3, z1: iz1 };
  rooms.push(cmd);
  fu.floor(cmd.x0, cmd.z0, cmd.x1, cmd.z1, M.HEX_PANEL);
  const hx = (cmd.x0 + cmd.x1) / 2;
  const hz = (cmd.z0 + cmd.z1) / 2;
  fu.p('HOLO_TABLE', hx, hz, 0, 0, true);
  fu.mark('desk', hx, hz, 0);
  fu.mark('deskSeat', hx, hz - 6);
  fu.wall(cmd, 'SCREEN_WALL', 'back', hx, 3);
  fu.wall(cmd, 'PORTRAIT_BOSS', 'left', hz, 7, pal.sofa);
  fu.p('WEAPON_RACK', cmd.x1 - 2, hz, -HALF_PI, 0, true);
  fu.mark('armory', cmd.x1 - 5, hz);
  fu.lights(cmd, 'CEILING_LIGHT', 12);
  // équipements du QG : salle de commandement (baies vitrées, cloison), noyau de l'ascenseur,
  // cage d'escalier, îlot médical dans le dégagement, recrutement près du bar
  spot(upg, fu, 'holomap', hx, hz, 0, 3.0, 1.02);
  spot(upg, fu, 'elite1', cmd.x0 + 5, hz - 8.5);
  spot(upg, fu, 'elite2', cmd.x1 - 5, hz - 8.5);
  spot(upg, fu, 'surveil', hx + 12, cmd.z1, Math.PI);
  spot(upg, fu, 'opscenter', cmd.x0, cmd.z1 - 6, HALF_PI);
  spot(upg, fu, 'trophies', cmd.x0, cmd.z0 + 6, HALF_PI);
  spot(upg, fu, 'armory2', cmd.x1 - 7, cmd.z0, 0);
  spot(upg, fu, 'comms', ex0, ez0 + ELEV_D / 2, -HALF_PI);
  spot(upg, fu, 'dronecmd', sx0 - 2, sz0 + 6, -HALF_PI);
  spot(upg, fu, 'cyberstation', ex0 + 21, cmdZ + 6, -HALF_PI);
  spot(upg, fu, 'autorecruit', ix1, iz0 + 24, -HALF_PI);
  // ---------------------------------------------------------------- étage 2
  fu.lv = p2;
  const suite: Room = { kind: 'ph_suite', floor: 2, x0: ix0, z0: iz0, x1: ix1, z1: iz1 };
  rooms.push(suite);
  fu.reserve(ex0 - 3, ez0 - 8, ex0 + ELEV_W + 3, ez0);
  fu.reserve(sx0 - 4, sz0 - 8, sx0 + STAIR_W + 2, sz0);
  fu.floor(ix0 + 4, iz0 + 4, ix0 + 26, iz0 + 18, pal.carpet);
  fu.p('BED_KING', ix0 + 15, iz0 + 7, 0, pal.sofa);
  fu.p('NIGHTSTAND', ix0 + 9, iz0 + 4, 0);
  fu.p('NIGHTSTAND', ix0 + 21, iz0 + 4, 0);
  fu.p('WARDROBE', ix0 + 3, iz0 + 16, HALF_PI);
  fu.p('BATHTUB', ix1 - 6, iz0 + 4, 0);
  fu.p('SOFA', ix1 - 8, iz0 + 14, -HALF_PI, pal.sofa);
  fu.p('TROPHY_CASE', ix0 + 3, iz1 - 6, HALF_PI);
  fu.p('AQUARIUM', ix0 + 14, iz1 - 3, Math.PI);
  fu.lights(suite, 'PENDANT_LIGHT', 14);
  // ---------------------------------------------------------------- toit : héliport
  const ry = roofTop;
  const hcx = Math.round((x0 + x1) / 2);
  const hcz = Math.round(z0 + 10);
  for (let x = -8; x < 8; x++)
    for (let z = -6; z < 6; z++) {
      const d = Math.hypot(x + 0.5, (z + 0.5) * 1.3);
      if (d < 7.5) f.set(hcx + x, ry - 1, hcz + z, d > 6.5 ? pal.led : M.CONCRETE_DARK);
    }
  f.fill(hcx - 3, ry - 1, hcz - 4, hcx - 2, ry, hcz + 4, M.LINE_WHITE);
  f.fill(hcx + 2, ry - 1, hcz - 4, hcx + 3, ry, hcz + 4, M.LINE_WHITE);
  f.fill(hcx - 2, ry - 1, hcz, hcx + 2, ry, hcz + 1, M.LINE_WHITE);
  fu.lv = { floorTop: ry, ceil: ry + 20 };
  fu.p('PLANTER', x0 + 4, z1 - 4, 0, 0, true);
  fu.p('PLANTER', x1 - 4, z1 - 4, 0, 0, true);
  fu.p('SOFA', x0 + 8, z1 - 5, Math.PI, pal.sofa, true);
}

/** Tour d'empire : centre de commandement (étage 1), bureau et salon des trophées (étage 2). */
function towerRooms(
  fu: Furnisher,
  f: Frame,
  rooms: Room[],
  pal: Palette,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  ex0: number,
  ez0: number,
  sx0: number,
  sz0: number,
  p1: Levels,
  p2: Levels,
  roofTop: number,
  upg: UpgSpot[],
): void {
  const ix0 = x0 + 2;
  const iz0 = z0 + 2;
  const ix1 = x1 - 2;
  const iz1 = z1 - 2;
  fu.lv = p1;
  const cmd: Room = { kind: 'tw_command', floor: 1, x0: ix0, z0: iz0, x1: ix1, z1: iz1 };
  rooms.push(cmd);
  fu.floor(ix0, iz0, ix1, iz1, M.HEX_PANEL);
  fu.reserve(ex0 - 3, ez0 - 8, ex0 + ELEV_W + 3, ez0);
  fu.reserve(sx0 - 4, sz0 - 8, sx0 + STAIR_W + 2, sz0);
  const hx = (ix0 + ix1) / 2;
  const hz = iz0 + 9;
  fu.p('HOLO_TABLE', hx, hz, 0, 1, true);
  fu.mark('desk', hx, hz, 0);
  fu.mark('deskSeat', hx, hz + 6);
  fu.p('COMMAND_DESK', ix0 + 5, hz, HALF_PI, 0);
  fu.p('COMMAND_DESK', ix1 - 5, hz, -HALF_PI, 0);
  fu.p('OFFICE_CHAIR', ix0 + 8, hz, -HALF_PI);
  fu.p('OFFICE_CHAIR', ix1 - 8, hz, HALF_PI);
  fu.wall(cmd, 'SCREEN_WALL', 'back', ix0 + 8, 3);
  fu.p('WEAPON_RACK', ix0 + 2, iz1 - 4, HALF_PI, 0, true);
  fu.p('WEAPON_LOCKER', ix0 + 2, iz1 - 9, HALF_PI, 0, true);
  fu.mark('armory', ix0 + 6, iz1 - 6);
  fu.mark('recruit', hx + 8, iz1 - 6);
  f.prop('FLAG_BANNER', hx - 10, p1.floorTop + 7, iz0 + 0.6, 0, 0);
  f.prop('FLAG_BANNER', hx + 10, p1.floorTop + 7, iz0 + 0.6, 0, 0);
  fu.lights(cmd, 'CEILING_LIGHT', 12);
  // équipements du QG : baie du fond (surveillance, trophées, opérations), noyau de l'ascenseur,
  // cage d'escalier, baie gauche près de l'armurerie, îlot médical à droite
  spot(upg, fu, 'holomap', hx, hz, 0, 3.0, 1.02);
  spot(upg, fu, 'elite1', hx - 16, hz);
  spot(upg, fu, 'elite2', hx + 16, hz);
  spot(upg, fu, 'surveil', ix0 + 26, iz1, Math.PI);
  spot(upg, fu, 'trophies', ix0 + 38, iz1, Math.PI);
  spot(upg, fu, 'opscenter', ix0 + 70, iz1, Math.PI);
  spot(upg, fu, 'comms', ex0, ez0 + ELEV_D / 2, -HALF_PI);
  spot(upg, fu, 'dronecmd', sx0 - 2, sz0 + 6, -HALF_PI);
  spot(upg, fu, 'armory2', ix0, iz0 + 34, HALF_PI);
  spot(upg, fu, 'cyberstation', ix0 + 74, iz0 + 28, Math.PI);
  spot(upg, fu, 'autorecruit', hx + 14, ez0, -HALF_PI);
  fu.lv = p2;
  const office: Room = { kind: 'tw_office', floor: 2, x0: ix0, z0: iz0, x1: ix1, z1: iz1 };
  rooms.push(office);
  fu.floor(ix0 + 2, iz0 + 2, ix1 - 2, iz0 + 18, pal.carpet);
  fu.p('DESK_BOSS', hx, iz0 + 8, 0);
  fu.p('BOSS_CHAIR', hx, iz0 + 4.5, 0);
  f.prop('PORTRAIT_BOSS', hx, p2.floorTop + 6, iz1 - 0.4, Math.PI, pal.sofa);
  fu.p('SOFA_LUXE', ix0 + 6, iz0 + 14, HALF_PI, pal.sofa);
  fu.p('SOFA_LUXE', ix1 - 6, iz0 + 14, -HALF_PI, pal.sofa);
  fu.p('TROPHY_CASE', ix0 + 3, iz1 - 4, HALF_PI);
  fu.p('BAR_COUNTER', ix1 - 3, iz1 - 6, -HALF_PI, pal.neonVariant);
  fu.p('GRAND_PIANO', ix1 - 8, iz0 + 5, -0.4);
  fu.lights(office, 'CHANDELIER', 16);
  void roofTop;
}
