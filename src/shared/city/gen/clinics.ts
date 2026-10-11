// Cliniques cybernétiques de New York 2085 : sept cliniques installées dans des bâtiments existants
// (salons de tatouage, pharmacie, casse, arrière-salle d'un traiteur, studio, gare). Elles vont par
// paires de jumeaux nord / sud, placées exactement en miroir, et Grand Central est sur l'axe de
// symétrie : les deux parrains sont à égalité. Chacune a un fauteuil d'installation adossé à un mur
// (collision écrite dans la grille ici, modèle et enseigne dessinés par le client). Le serveur en
// fait des points d'installation des implants ; une clinique est fermée au parrain dont le rival
// possède le bâtiment.

import { M } from '../../materials';
import { BUILDINGS, BUILDING_BY_KEY, mirrorRect, type BuildingDef } from '../plan';
import { GROUND_VY, VOXEL } from '../../voxel';
import type { BuildingInfo, ClinicInfo, GenContext } from './context';
import { Frame } from './frame';

export interface ClinicDef {
  /** Bâtiment qui l'abrite (clé du plan). */
  key: string;
  name: string;
}

/** Les cliniques, par paires de jumeaux nord / sud, puis Grand Central (sur l'axe). */
export const CLINICS: ClinicDef[] = [
  { key: 'casse_newtown', name: 'Clinique de la Casse' },
  { key: 'tatoueur', name: 'Clinique Neon Ink' },
  { key: 'clinique_lenox', name: 'Clinique de Lenox Hill' },
  { key: 'katz', name: 'Clinique clandestine de Katz’s' },
  { key: 'studio_sugarhill', name: 'Clinique des stars de Sugar Hill' },
  { key: 'tatouage_dragon', name: 'Clinique du Dragon' },
  { key: 'grand_central', name: 'Clinique de Grand Central' },
];

/** Encombrement du fauteuil et de son portique (voxels) : demi-largeur le long du mur, profondeur. */
const HALF_W = 5;
const DEPTH = 7;
/** Espace libre devant (le praticien, le parrain). */
const CLEAR = 6;
/** Distance du centre du fauteuil au mur (m) : point d'installation. */
export const CLINIC_SEAT_DEPTH = 0.95;

/** Point d'installation d'une clinique (centre du fauteuil). */
export function clinicSeat(c: ClinicInfo): { x: number; y: number; z: number } {
  return { x: c.x + Math.sin(c.yaw) * CLINIC_SEAT_DEPTH, y: c.y, z: c.z + Math.cos(c.yaw) * CLINIC_SEAT_DEPTH };
}

type Side = 'back' | 'front' | 'left' | 'right';
const SIDES: { side: Side; yaw: number }[] = [
  { side: 'back', yaw: Math.PI },
  { side: 'left', yaw: Math.PI / 2 },
  { side: 'right', yaw: -Math.PI / 2 },
  { side: 'front', yaw: 0 },
];
/** Le jumeau en miroir d'un bâtiment a son repère local inversé en x : gauche et droite s'échangent. */
const MIRROR: Record<Side, Side> = { back: 'back', front: 'front', left: 'right', right: 'left' };

/** Case locale (u le long du mur, v en profondeur depuis le mur) pour un appui (ax, az). */
function cellOf(side: Side, ax: number, az: number, u: number, v: number): [number, number] {
  switch (side) {
    case 'back':
      return [ax + u, az - 1 - v];
    case 'front':
      return [ax + u, az + v];
    case 'left':
      return [ax + v, az + u];
    case 'right':
      return [ax - 1 - v, az + u];
  }
}

/** Base de cellOf par côté : [ox, oz, ux, uz, vx, vz]. */
const BASIS: Record<Side, [number, number, number, number, number, number]> = {
  back: [0, -1, 1, 0, 0, -1],
  front: [0, 0, 1, 0, 0, 1],
  left: [0, 0, 0, 1, 1, 0],
  right: [-1, 0, 0, 1, -1, 0],
};

interface Pick {
  side: Side;
  yaw: number;
  ax: number;
  az: number;
  ly: number;
  score: number;
}

interface Site {
  c: ClinicDef;
  def: BuildingDef;
  info: BuildingInfo;
  f: Frame;
}

const keyOf = (p: { side: Side; ax: number; az: number; ly: number }) => `${p.side}:${p.ax}:${p.az}:${p.ly}`;

/** Installe les cliniques dans leurs bâtiments (après la génération des bâtiments, avant la navigation). */
export function placeClinics(ctx: GenContext): void {
  const sites = new Map<string, Site>();
  for (const c of CLINICS) {
    const def = BUILDING_BY_KEY[c.key];
    const info = def ? ctx.buildings.find((b) => b.id === def.id) : undefined;
    if (def && info) sites.set(c.key, { c, def, info, f: new Frame(ctx, def.rect, def.door, def.id) });
  }
  const done = new Set<string>();
  for (const site of sites.values()) {
    if (done.has(site.c.key)) continue;
    done.add(site.c.key);
    const m = mirrorRect(site.def.rect);
    const twinDef = BUILDINGS.find((b) => b.rect.every((v, i) => Math.abs(v - m[i]) < 1e-6));
    const twin = twinDef && twinDef !== site.def ? sites.get(twinDef.key) : undefined;
    const own = candidates(site.f, site.info);
    if (twinDef === site.def) {
      // sur l'axe de symétrie : fauteuil centré sur l'axe (contre un mur, ou en îlot dans le hall)
      const onAxis = candidates(site.f, site.info, true);
      const pick = onAxis.find((p) => connected(site.f, p)) ?? own.find((p) => connected(site.f, p));
      if (pick) install(site, pick);
    } else if (twin && twin.f.W === site.f.W && twin.f.D === site.f.D) {
      done.add(twin.c.key);
      // jumeaux : même emplacement, en miroir, dans les deux bâtiments
      const theirs = new Map(candidates(twin.f, twin.info).map((p) => [keyOf(p), p]));
      const pairs: [Pick, Pick, number][] = [];
      for (const p of own) {
        const q = theirs.get(keyOf({ side: MIRROR[p.side], ax: twin.f.W - p.ax, az: p.az, ly: p.ly }));
        if (q) pairs.push([p, q, p.score + q.score]);
      }
      pairs.sort((a, b) => b[2] - a[2]);
      const ok = pairs.slice(0, 40).find(([p, q]) => connected(site.f, p) && connected(twin.f, q));
      if (ok) {
        install(site, ok[0]);
        install(twin, ok[1]);
      } else {
        const a = own.find((p) => connected(site.f, p));
        const b = [...theirs.values()].sort((x, y) => y.score - x.score).find((p) => connected(twin.f, p));
        if (a) install(site, a);
        if (b) install(twin, b);
      }
    } else {
      const pick = own.find((p) => connected(site.f, p));
      if (pick) install(site, pick);
    }
  }
}

/** Écrit la collision du fauteuil et expose la clinique dans les informations du bâtiment. */
function install(site: Site, pick: Pick): void {
  const { f, info } = site;
  const ly = pick.ly;
  // assise (on s'abrite derrière) et montants du portique (les balles passent)
  for (let u = -HALF_W + 1; u < HALF_W - 1; u++)
    for (let v = 1; v < 5; v++) {
      const [x, z] = cellOf(pick.side, pick.ax, pick.az, u, v);
      f.fill(x, ly, z, x + 1, ly + 3, z + 1, M.COVER);
    }
  for (const u of [-HALF_W, HALF_W - 1])
    for (let v = 0; v < 2; v++) {
      const [x, z] = cellOf(pick.side, pick.ax, pick.az, u, v);
      f.fill(x, ly, z, x + 1, ly + 9, z + 1, M.COLLIDE);
    }
  const p = f.pt(pick.ax, pick.az);
  const clinic: ClinicInfo = { name: site.c.name, x: p.x, y: ly * VOXEL, z: p.z, yaw: f.yaw(pick.yaw) };
  info.clinic = clinic;
  // les points de défense recouverts par le fauteuil ne servent plus
  const seat = clinicSeat(clinic);
  const inChair = (q: { x: number; z: number; y?: number }) => Math.abs((q.y ?? info.floorY) - clinic.y) < 0.6 && Math.abs(q.x - seat.x) < 1.9 && Math.abs(q.z - seat.z) < 1.9;
  info.defend = info.defend.filter((q) => !inChair(q));
  const spawn = info.spawn.filter((q) => !inChair(q));
  if (spawn.length) info.spawn = spawn;
}

/** Étage d'un bâtiment lu une fois : hauteur libre (−1 sans plancher), murs pleins, cases libres. */
interface Layer {
  room: Int8Array;
  wall: Uint8Array;
  free: Uint8Array;
  comps: number;
}
const layers = new WeakMap<Frame, Map<number, Layer>>();

function layer(f: Frame, ly: number): Layer {
  let cache = layers.get(f);
  if (!cache) layers.set(f, (cache = new Map()));
  let L = cache.get(ly);
  if (L) return L;
  const W = f.W;
  const D = f.D;
  // le volume du bâtiment, de la dalle (ly − 1) à 2,5 m, lu d'un bloc
  const nx = f.X1 - f.X0;
  const nz = f.Z1 - f.Z0;
  const NY = 11;
  const box = new Uint8Array(nx * nz * NY);
  f.world.copyBox(f.X0, ly - 1 + GROUND_VY, f.Z0, nx, NY, nz, box, 0, nx * nz, nx);
  const room = new Int8Array(W * D).fill(-1);
  const wall = new Uint8Array(W * D);
  const free = new Uint8Array(W * D);
  const plane = nx * nz;
  for (let wz = f.Z0; wz < f.Z1; wz++)
    for (let wx = f.X0; wx < f.X1; wx++) {
      // case locale de cette case du monde (inverse de Frame.cell)
      let x: number;
      let z: number;
      switch (f.side) {
        case 'S':
          x = wx - f.X0;
          z = f.Z1 - 1 - wz;
          break;
        case 'N':
          x = f.X1 - 1 - wx;
          z = wz - f.Z0;
          break;
        case 'E':
          x = f.Z1 - 1 - wz;
          z = f.X1 - 1 - wx;
          break;
        default:
          x = wz - f.Z0;
          z = wx - f.X0;
      }
      const c = (wz - f.Z0) * nx + (wx - f.X0);
      // colonne : dalle (rang 0) puis l'air au-dessus du sol (rangs 1 à 10)
      let solid = true;
      for (let y = 2; y < 9 && solid; y++) if (box[y * plane + c] === 0) solid = false;
      if (solid) wall[z * W + x] = 1;
      if (box[c] === 0) continue;
      let h = 0;
      while (h < 10 && box[(h + 1) * plane + c] === 0) h++;
      if (h >= 6) free[z * W + x] = 1;
      if (x >= 2 && z >= 2 && x < W - 2 && z < D - 2) room[z * W + x] = h;
    }
  L = { room, wall, free, comps: components(free, W, D) };
  cache.set(ly, L);
  return L;
}

/**
 * Emplacements possibles, du meilleur au moins bon : contre un mur plein, de la place devant, loin
 * de la porte et des objectifs. axis : uniquement centrés sur l'axe du bâtiment (x local = W / 2),
 * face à l'entrée, adossés à un mur ou en îlot.
 */
function candidates(f: Frame, info: BuildingInfo, axis = false): Pick[] {
  const W = f.W;
  const D = f.D;
  const door = info.doors[0];
  const avoid: { x: number; z: number; y: number; r: number }[] = [{ x: door.in.x, z: door.in.z, y: door.in.y ?? info.floorY, r: 4.5 }];
  if (info.vault) avoid.push({ x: info.vault.x, z: info.vault.z, y: info.vault.y ?? info.floorY, r: 3 });
  if (info.terminal) avoid.push({ x: info.terminal.x, z: info.terminal.z, y: info.terminal.y ?? info.floorY, r: 3 });
  for (const o of info.ops ?? []) avoid.push({ x: o.x, z: o.z, y: o.y, r: 2.6 });
  for (const e of info.elevator ?? []) avoid.push({ x: e.x, z: e.z, y: e.y, r: 3 });
  const out: Pick[] = [];
  info.floors.forEach((fl, fi) => {
    const ly = Math.round(fl.y / VOXEL);
    const head = Math.min(9, Math.round((fl.ceil - fl.y) / VOXEL) - 1);
    if (head < 8) return;
    const { room, wall } = layer(f, ly);
    for (const { side, yaw } of SIDES) {
      if (axis && side !== 'back') continue;
      // case (u, v) = (ax + ox + u·ux + v·vx, az + oz + u·uz + v·vz), comme cellOf
      const B = BASIS[side];
      const idx = (ax: number, az: number, u: number, v: number): number => {
        const x = ax + B[0] + u * B[2] + v * B[4];
        const z = az + B[1] + u * B[3] + v * B[5];
        return x < 0 || z < 0 || x >= W || z >= D ? -1 : z * W + x;
      };
      for (let az = 2; az <= D - 2; az++)
        for (let ax = axis ? W / 2 : 2; ax <= (axis ? W / 2 : W - 2); ax++) {
          let ok = Number.isInteger(ax);
          let backed = true;
          for (let u = -HALF_W; u < HALF_W && ok && backed; u++) {
            const i = idx(ax, az, u, -1);
            if (i < 0 || !wall[i]) backed = false;
          }
          if (!backed && !axis) ok = false;
          for (let u = -HALF_W; u < HALF_W && ok; u++)
            for (let v = 0; v < DEPTH && ok; v++) {
              const i = idx(ax, az, u, v);
              if (i < 0 || room[i] < head) ok = false;
            }
          if (!ok) continue;
          let clear = 0;
          for (let u = -HALF_W; u < HALF_W; u++)
            for (let v = DEPTH; v < DEPTH + CLEAR; v++) {
              const i = idx(ax, az, u, v);
              if (i >= 0 && room[i] >= 7) clear++;
            }
          if (clear < HALF_W * 2 * CLEAR * 0.9) continue;
          const p = f.pt(ax, az);
          const wy = f.yaw(yaw);
          const cx = p.x + Math.sin(wy) * 0.9;
          const cz = p.z + Math.cos(wy) * 0.9;
          const y = ly * VOXEL;
          if (avoid.some((a) => Math.abs(a.y - y) < 2 && Math.hypot(a.x - cx, a.z - cz) < a.r + 1.2)) continue;
          // préférences : rez-de-chaussée, à une dizaine de mètres de la porte, pas contre la façade
          const dd = Math.hypot(door.in.x - cx, door.in.z - cz);
          let score = fi === 0 ? 30 : 0;
          score -= Math.abs(dd - 10);
          if (side === 'front') score -= 8;
          if (!backed) score -= 5;
          out.push({ side, yaw, ax, az, ly, score });
        }
    }
  });
  out.sort((a, b) => b.score - a.score || a.ly - b.ly || a.az - b.az || a.ax - b.ax);
  return out;
}

/** Le fauteuil ne doit pas couper l'étage en deux : on compare les zones praticables avant et après. */
function connected(f: Frame, t: Pick): boolean {
  const base = layer(f, t.ly);
  const free = base.free.slice();
  for (let u = -HALF_W; u < HALF_W; u++)
    for (let v = 0; v < 5; v++) {
      const [x, z] = cellOf(t.side, t.ax, t.az, u, v);
      if (x >= 0 && z >= 0 && x < f.W && z < f.D) free[z * f.W + x] = 0;
    }
  return components(free, f.W, f.D) <= base.comps;
}

/** Nombre de zones praticables (blocs 2 × 2 de cases libres) d'au moins 10 cases. */
function components(free: Uint8Array, W: number, D: number): number {
  const pass = new Uint8Array(W * D);
  for (let z = 0; z < D - 1; z++)
    for (let x = 0; x < W - 1; x++) if (free[z * W + x] && free[z * W + x + 1] && free[(z + 1) * W + x] && free[(z + 1) * W + x + 1]) pass[z * W + x] = 1;
  const seen = new Uint8Array(W * D);
  const stack: number[] = [];
  let n = 0;
  for (let i = 0; i < W * D; i++) {
    if (!pass[i] || seen[i]) continue;
    let size = 0;
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const k = stack.pop()!;
      size++;
      const x = k % W;
      const z = (k - x) / W;
      if (x > 0 && pass[k - 1] && !seen[k - 1]) {
        seen[k - 1] = 1;
        stack.push(k - 1);
      }
      if (x < W - 1 && pass[k + 1] && !seen[k + 1]) {
        seen[k + 1] = 1;
        stack.push(k + 1);
      }
      if (z > 0 && pass[k - W] && !seen[k - W]) {
        seen[k - W] = 1;
        stack.push(k - W);
      }
      if (z < D - 1 && pass[k + W] && !seen[k + W]) {
        seen[k + W] = 1;
        stack.push(k + W);
      }
    }
    if (size >= 10) n++;
  }
  return n;
}
