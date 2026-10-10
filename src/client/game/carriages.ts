// Fiacres (hansom cabs) tirés par des chevaux qui parcourent les rues au trot, s'arrêtent
// devant les passants et font résonner les sabots sur les pavés. Purement décoratifs : ils
// sont simulés par chaque client, comme les passants.

import * as THREE from 'three';
import { Anim, CharKind, Weapon } from '../../shared/characters';
import { GM } from '../../shared/city/gen/city';
import { RIVER_Z, WORLD_W } from '../../shared/city/plan';
import { Rng, angleDiff } from '../../shared/util';
import { audio } from '../audio/AudioEngine';
import type { CharView } from '../characters/characterRenderer';
import { meshModel } from '../models/modelMesher';
import { SLOT, VoxelModel, shade } from '../models/voxelModel';
import { createObjectMaterial } from '../render/voxelObjectMaterial';
import { settings } from '../settings';
import type { WorldData } from '../world/worldLoader';

const R = 1 / 16;
const v = (m: number) => m / R; // mètres → voxels

const HORSE_COATS = [
  { coat: 0x6b3a1e, mane: 0x1a1210, sock: 0x1a1210 }, // bai
  { coat: 0x8a4a22, mane: 0x6a3418, sock: 0x8a4a22 }, // alezan
  { coat: 0x221c1a, mane: 0x141010, sock: 0x221c1a }, // noir
  { coat: 0x9a948c, mane: 0x5a5650, sock: 0x7a746c }, // gris
  { coat: 0x4a2c18, mane: 0x120c0a, sock: 0xd8d0c4 }, // bai brun, balzanes
];
const CAB_PAINT = [0x15171c, 0x1f3326, 0x3a1418, 0x1a2440, 0x2a2420];
const LEATHER = 0x2a1a10;
const BRASS = 0xc9a24a;
const IRON = 0x2a2a2c;
const WOOD = 0x3a2616;

/** Corps du cheval (sans les jambes) : regard vers +Z, origine au sol sous le centre. */
function horseBody(c: (typeof HORSE_COATS)[number]): VoxelModel {
  const m = VoxelModel.meters(0.8, 2.3, 3.0);
  m.setOrigin(m.sx / 2, 0, v(1.25));
  const cx = m.sx / 2;
  const z0 = v(1.25);
  // tronc
  m.ellipsoid(cx, v(1.25), z0, v(0.27), v(0.31), v(0.72), c.coat);
  m.ellipsoid(cx, v(1.3), z0 + v(0.5), v(0.25), v(0.3), v(0.32), c.coat); // poitrail
  m.ellipsoid(cx, v(1.28), z0 - v(0.5), v(0.27), v(0.28), v(0.3), c.coat); // croupe
  // encolure et tête
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const y = v(1.45 + t * 0.48);
    const z = z0 + v(0.62 + t * 0.4);
    m.ellipsoid(cx, y, z, v(0.13 - t * 0.02), v(0.17), v(0.14), c.coat);
    // crinière
    m.box(cx - 1, y + v(0.12), z - v(0.1), cx + 1, y + v(0.2), z + v(0.02), c.mane);
  }
  const hy = v(1.88);
  const hz = z0 + v(1.08);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    m.ellipsoid(cx, hy - v(t * 0.18), hz + v(t * 0.42), v(0.11 - t * 0.025), v(0.12 - t * 0.03), v(0.09), c.coat);
  }
  // naseaux, yeux, oreilles, toupet
  m.box(cx - 2, hy - v(0.2), hz + v(0.46), cx + 2, hy - v(0.14), hz + v(0.5), shade(c.coat, 0.55));
  m.set(cx - 2, hy + 1, hz + v(0.12), 0x0c0a08);
  m.set(cx + 1, hy + 1, hz + v(0.12), 0x0c0a08);
  m.box(cx - 2, hy + v(0.1), hz - 1, cx - 1, hy + v(0.22), hz + 1, c.coat);
  m.box(cx + 1, hy + v(0.1), hz - 1, cx + 2, hy + v(0.22), hz + 1, c.coat);
  m.box(cx - 1, hy + v(0.06), hz + 1, cx + 1, hy + v(0.12), hz + 3, c.mane);
  // queue
  for (let i = 0; i < 12; i++) m.box(cx - 1, v(1.32) - i * 1.2, z0 - v(0.78) - Math.min(i, 4) * 0.5, cx + 1, v(1.32) - i * 1.2 + 2, z0 - v(0.72) - Math.min(i, 4) * 0.5, c.mane);
  // harnais : collier, sellette, sangle, avaloire, bride et œillères
  m.box(cx - v(0.26), v(1.3), z0 + v(0.62), cx + v(0.26), v(1.62), z0 + v(0.72), LEATHER);
  m.box(cx - v(0.2), v(1.52), z0 + v(0.6), cx + v(0.2), v(1.58), z0 + v(0.74), BRASS);
  m.box(cx - v(0.3), v(1.5), z0 - v(0.04), cx + v(0.3), v(1.6), z0 + v(0.18), LEATHER);
  m.box(cx - v(0.29), v(0.95), z0 + v(0.02), cx + v(0.29), v(1.52), z0 + v(0.12), LEATHER);
  m.box(cx - v(0.29), v(1.1), z0 - v(0.7), cx + v(0.29), v(1.16), z0 - v(0.2), LEATHER);
  m.box(cx - v(0.12), hy - v(0.06), hz + v(0.05), cx + v(0.12), hy - v(0.02), hz + v(0.42), LEATHER);
  m.box(cx - v(0.13), hy - v(0.02), hz + v(0.06), cx - v(0.1), hy + v(0.08), hz + v(0.16), LEATHER);
  m.box(cx + v(0.1), hy - v(0.02), hz + v(0.06), cx + v(0.13), hy + v(0.08), hz + v(0.16), LEATHER);
  return m;
}

/** Jambe : origine en haut (épaule ou hanche), sabot en bas. */
function horseLeg(c: (typeof HORSE_COATS)[number], back: boolean): VoxelModel {
  const m = VoxelModel.meters(0.2, 1.0, 0.24);
  m.setOrigin(m.sx / 2, m.sy, m.sz / 2);
  const cx = m.sx / 2;
  const cz = m.sz / 2;
  // cuisse / avant-bras
  m.ellipsoid(cx, v(0.8), cz + (back ? -0.5 : 0.5), v(0.09), v(0.2), v(0.11), c.coat);
  // canon
  m.box(cx - 1, v(0.14), cz - 1, cx + 1, v(0.66), cz + 1, c.coat);
  m.box(cx - 1, v(0.08), cz - 1, cx + 1, v(0.3), cz + 1, c.sock);
  // boulet et sabot
  m.box(cx - 1.5, v(0.06), cz - 1.5, cx + 1.5, v(0.12), cz + 1.5, c.sock);
  m.box(cx - 1.5, 0, cz - 1.5, cx + 1.5, v(0.06), cz + 2, 0x1a1614);
  return m;
}

/** Roue : disque dans le plan YZ, origine au moyeu. */
function wheel(paint: number): VoxelModel {
  const r = v(0.74);
  const m = new VoxelModel(3, Math.ceil(r * 2) + 2, Math.ceil(r * 2) + 2, R);
  const c = m.sy / 2;
  m.setOrigin(1.5, c, c);
  for (let y = 0; y < m.sy; y++)
    for (let z = 0; z < m.sz; z++) {
      const d = Math.hypot(y + 0.5 - c, z + 0.5 - c);
      if (d <= r && d > r - 1.6) m.box(0, y, z, 3, y + 1, z + 1, IRON);
      else if (d <= r - 1.6 && d > r - 3) m.box(0.5, y, z, 2.5, y + 1, z + 1, shade(paint, 1.4));
      else if (d < 2.6) m.box(0, y, z, 3, y + 1, z + 1, d < 1.2 ? BRASS : shade(paint, 1.2));
    }
  // rayons
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    for (let s = 2.4; s < r - 2.6; s += 0.5) m.box(0.8, c + Math.sin(a) * s, c + Math.cos(a) * s, 2.2, c + Math.sin(a) * s + 1, c + Math.cos(a) * s + 1, shade(paint, 1.3));
  }
  return m;
}

/** Caisse du fiacre, brancards et siège du cocher (sans les roues). Regard vers +Z, origine au sol sous l'essieu. */
function cabBody(paint: number): VoxelModel {
  const m = VoxelModel.meters(1.5, 2.3, 4.6);
  const cx = m.sx / 2;
  const za = v(1.1); // essieu
  m.setOrigin(cx, 0, za);
  const trim = BRASS;
  // caisse
  m.box(cx - v(0.6), v(0.62), za - v(0.62), cx + v(0.6), v(1.86), za + v(0.52), paint);
  // façade avant arrondie et portes basses
  m.box(cx - v(0.58), v(0.62), za + v(0.52), cx + v(0.58), v(1.2), za + v(0.66), shade(paint, 1.15));
  m.box(cx - v(0.56), v(1.2), za + v(0.5), cx + v(0.56), v(1.75), za + v(0.54), SLOT.GLASS);
  // vitres latérales
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? cx - v(0.61) : cx + v(0.6);
    m.box(x0, v(1.25), za - v(0.35), x0 + 1, v(1.7), za + v(0.25), SLOT.GLASS);
    // filets dorés
    m.box(x0, v(1.0), za - v(0.6), x0 + 1, v(1.02), za + v(0.5), trim);
    m.box(x0, v(0.66), za - v(0.6), x0 + 1, v(0.68), za + v(0.5), trim);
  }
  // toit débordant
  m.box(cx - v(0.66), v(1.86), za - v(0.7), cx + v(0.66), v(1.94), za + v(0.62), shade(paint, 0.8));
  // siège du cocher, perché à l'arrière
  m.box(cx - v(0.3), v(1.94), za - v(1.0), cx + v(0.3), v(2.02), za - v(0.66), LEATHER);
  m.box(cx - v(0.32), v(2.02), za - v(1.06), cx + v(0.32), v(2.22), za - v(0.98), LEATHER);
  m.box(cx - v(0.06), v(0.4), za - v(1.0), cx + v(0.06), v(1.94), za - v(0.94), IRON);
  m.box(cx - v(0.25), v(1.5), za - v(0.98), cx + v(0.25), v(1.54), za - v(0.62), IRON); // repose-pieds
  // marchepied
  m.box(cx - v(0.3), v(0.4), za + v(0.6), cx + v(0.3), v(0.44), za + v(0.78), IRON);
  // brancards
  for (const sx of [-1, 1]) {
    const x = cx + sx * v(0.42);
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const z = za + v(0.5 + t * 2.6);
      const y = v(1.0 + Math.sin(t * Math.PI) * 0.08 + t * 0.12);
      m.box(x - 1, y, z, x + 1, y + 1.5, z + 1.6, WOOD);
    }
  }
  // essieu et ressorts
  m.box(cx - v(0.85), v(0.72), za - 1, cx + v(0.85), v(0.78), za + 1, IRON);
  m.box(cx - v(0.55), v(0.55), za - v(0.4), cx - v(0.45), v(0.62), za + v(0.4), IRON);
  m.box(cx + v(0.45), v(0.55), za - v(0.4), cx + v(0.55), v(0.62), za + v(0.4), IRON);
  // lanternes de façade
  for (const sx of [-1, 1]) {
    const x = cx + sx * v(0.64);
    m.box(x - 1.5, v(1.55), za + v(0.48), x + 1.5, v(1.62), za + v(0.66), IRON);
    m.box(x - 1.5, v(1.62), za + v(0.5), x + 1.5, v(1.78), za + v(0.64), SLOT.GLOW);
    m.box(x - 1.5, v(1.78), za + v(0.5), x + 1.5, v(1.82), za + v(0.64), IRON);
  }
  return m;
}

interface Cab {
  root: THREE.Group;
  horse: THREE.Group;
  legs: THREE.Mesh[];
  wheels: THREE.Mesh[];
  driver: CharView;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  cruise: number;
  /** Cellule cible (grille de 2 m) et direction (0 N, 1 E, 2 S, 3 O). */
  ti: number;
  tk: number;
  dir: number;
  phase: number;
  clopAcc: number;
  wheelAcc: number;
  neighAt: number;
  blockedFor: number;
}

const DIRS: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const CELL = 2;

export class Carriages {
  readonly group = new THREE.Group();
  private world: WorldData;
  private cabs: Cab[] = [];
  private road: Uint8Array;
  private gw = Math.floor(WORLD_W / CELL);
  private gd = Math.floor(RIVER_Z / CELL);
  private material = createObjectMaterial({ key: 'carriages' });
  private geos = new Map<string, THREE.BufferGeometry>();
  private rng = new Rng((Date.now() >> 3) & 0xffff);
  private nextId = 64100;
  private spawnAcc = 0;
  private views: CharView[] = [];

  constructor(world: WorldData) {
    this.world = world;
    this.group.name = 'fiacres';
    // grille des chaussées assez larges pour un attelage (2 m, marge de 1,5 m)
    this.road = new Uint8Array(this.gw * this.gd);
    const gm = world.groundMap;
    const isRoad = (x: number, z: number) => {
      const vx = Math.floor(x * 4);
      const vz = Math.floor(z * 4);
      if (vx < 0 || vz < 0 || vx >= world.gw || vz >= world.gd) return false;
      return gm[vz * world.gw + vx] === GM.ROAD;
    };
    for (let k = 0; k < this.gd; k++)
      for (let i = 0; i < this.gw; i++) {
        const x = (i + 0.5) * CELL;
        const z = (k + 0.5) * CELL;
        let ok = true;
        for (const [dx, dz] of [[0, 0], [1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6], [1.1, 1.1], [-1.1, 1.1], [1.1, -1.1], [-1.1, -1.1]])
          if (!isRoad(x + dx, z + dz)) {
            ok = false;
            break;
          }
        if (ok && world.nav.walkable(x, z)) this.road[k * this.gw + i] = 1;
      }
  }

  private isRoad(i: number, k: number): boolean {
    return i >= 0 && k >= 0 && i < this.gw && k < this.gd && this.road[k * this.gw + i] === 1;
  }

  /** La rue continue-t-elle sur quelques cellules dans cette direction ? */
  private open(i: number, k: number, d: number, n = 3): boolean {
    const [dx, dz] = DIRS[d];
    for (let s = 1; s <= n; s++) if (!this.isRoad(i + dx * s, k + dz * s)) return false;
    return true;
  }

  private geo(key: string, make: () => VoxelModel): THREE.BufferGeometry {
    let g = this.geos.get(key);
    if (!g) this.geos.set(key, (g = meshModel(make())));
    return g;
  }

  private target(): number {
    const q = settings.quality;
    return q === 'basse' ? 2 : q === 'moyenne' ? 3 : q === 'haute' ? 5 : 7;
  }

  private spawn(px: number, pz: number): void {
    for (let tries = 0; tries < 30; tries++) {
      const i = this.rng.int(0, this.gw - 1);
      const k = this.rng.int(0, this.gd - 1);
      if (!this.isRoad(i, k)) continue;
      const x = (i + 0.5) * CELL;
      const z = (k + 0.5) * CELL;
      const d = Math.hypot(x - px, z - pz);
      if (d < 30 || d > 85) continue;
      if (this.cabs.some((c) => Math.hypot(c.x - x, c.z - z) < 14)) continue;
      const dirs = [0, 1, 2, 3].filter((dd) => this.open(i, k, dd, 4));
      if (dirs.length === 0) continue;
      const dir = dirs[this.rng.int(0, dirs.length - 1)];
      this.create(x, z, dir, i, k);
      return;
    }
  }

  private create(x: number, z: number, dir: number, i: number, k: number): void {
    const hv = this.rng.int(0, HORSE_COATS.length - 1);
    const pv = this.rng.int(0, CAB_PAINT.length - 1);
    const coat = HORSE_COATS[hv];
    const paint = CAB_PAINT[pv];
    const root = new THREE.Group();
    const mk = (g: THREE.BufferGeometry) => {
      const mesh = new THREE.Mesh(g, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };
    root.add(mk(this.geo(`cab${pv}`, () => cabBody(paint))));
    const wheels: THREE.Mesh[] = [];
    for (const sx of [-1, 1]) {
      const w = mk(this.geo(`wheel${pv}`, () => wheel(paint)));
      w.position.set(sx * 0.9, 0.75, 0);
      root.add(w);
      wheels.push(w);
    }
    const horse = new THREE.Group();
    horse.position.set(0, 0, 2.75);
    horse.add(mk(this.geo(`horse${hv}`, () => horseBody(coat))));
    const legs: THREE.Mesh[] = [];
    for (const [lx, lz, back] of [
      [-0.14, 0.5, false],
      [0.14, 0.5, false],
      [-0.14, -0.52, true],
      [0.14, -0.52, true],
    ] as [number, number, boolean][]) {
      const leg = mk(this.geo(`leg${hv}${back ? 'b' : 'f'}`, () => horseLeg(coat, back)));
      leg.position.set(lx, 1.0, lz);
      horse.add(leg);
      legs.push(leg);
    }
    root.add(horse);
    this.group.add(root);
    const yaw = Math.atan2(DIRS[dir][0], DIRS[dir][1]);
    const driver: CharView = {
      id: this.nextId++,
      kind: CharKind.CIVILIAN,
      faction: 0,
      look: this.rng.int(0, 9999),
      gang: 0,
      x,
      y: 1.5,
      z,
      yaw,
      pitch: 0,
      vx: 0,
      vz: 0,
      anim: Anim.SIT,
      aiming: false,
      weapon: Weapon.FISTS,
      shotAt: -10,
      hitAt: -10,
      meleeAt: -10,
      interactAt: -10,
      deathAt: -10,
    };
    if (this.nextId > 64900) this.nextId = 64100;
    const [dx, dz] = DIRS[dir];
    this.cabs.push({ root, horse, legs, wheels, driver, x, z, yaw, speed: 0, cruise: this.rng.range(3.4, 4.6), ti: i + dx, tk: k + dz, dir, phase: 0, clopAcc: 0, wheelAcc: 0, neighAt: performance.now() / 1000 + this.rng.range(20, 60), blockedFor: 0 });
  }

  /** Choisit la prochaine cellule à l'arrivée au centre de la cellule cible. */
  private nextCell(c: Cab): void {
    const i = c.ti;
    const k = c.tk;
    const straight = c.dir;
    const left = (c.dir + 3) % 4;
    const right = (c.dir + 1) % 4;
    const opts: [number, number][] = [];
    if (this.open(i, k, straight, 2)) opts.push([straight, 6]);
    if (this.open(i, k, left, 5)) opts.push([left, 1]);
    if (this.open(i, k, right, 5)) opts.push([right, 1]);
    let dir: number;
    if (opts.length === 0) dir = (c.dir + 2) % 4; // demi-tour
    else {
      const tot = opts.reduce((s, o) => s + o[1], 0);
      let r = this.rng.range(0, tot);
      dir = opts[0][0];
      for (const [d, w] of opts) {
        r -= w;
        if (r <= 0) {
          dir = d;
          break;
        }
      }
    }
    c.dir = dir;
    c.ti = i + DIRS[dir][0];
    c.tk = k + DIRS[dir][1];
  }

  update(dt: number, now: number, playerPos: THREE.Vector3, others: CharView[]): CharView[] {
    const px = playerPos.x;
    const pz = playerPos.z;
    this.spawnAcc += dt;
    if (this.spawnAcc > 1.5 && this.cabs.length < this.target()) {
      this.spawnAcc = 0;
      this.spawn(px, pz);
    }
    this.views.length = 0;
    for (let n = this.cabs.length - 1; n >= 0; n--) {
      const c = this.cabs[n];
      if (Math.hypot(c.x - px, c.z - pz) > 105) {
        this.group.remove(c.root);
        this.cabs.splice(n, 1);
        continue;
      }
      // cible : centre de la cellule, décalé à gauche (on roule à gauche à Londres)
      let tx = 0;
      let tz = 0;
      for (let guard = 0; guard < 3; guard++) {
        const [dx, dz] = DIRS[c.dir];
        const lx = dz;
        const lz = -dx;
        const lane = this.isRoad(c.ti + lx, c.tk + lz) ? 1.0 : 0.3;
        tx = (c.ti + 0.5) * CELL + lx * lane;
        tz = (c.tk + 0.5) * CELL + lz * lane;
        const dd = Math.hypot(tx - c.x, tz - c.z);
        const behind = Math.abs(angleDiff(c.yaw, Math.atan2(tx - c.x, tz - c.z))) > 1.3;
        // arrivée (ou cible manquée dans un virage) : cellule suivante
        if (dd < 1.6 || (dd < 2.6 && behind)) this.nextCell(c);
        else break;
      }
      const ddx = tx - c.x;
      const ddz = tz - c.z;
      // obstacle devant le cheval : on s'arrête
      const fx = Math.sin(c.yaw);
      const fz = Math.cos(c.yaw);
      const hx = c.x + fx * 3.6;
      const hz = c.z + fz * 3.6;
      let blocked = false;
      const test = (ox: number, oz: number) => {
        const rx = ox - hx;
        const rz = oz - hz;
        const ahead = rx * fx + rz * fz;
        const side = Math.abs(rx * fz - rz * fx);
        return ahead > -0.6 && ahead < 3.2 && side < 1.3;
      };
      if (test(px, pz)) blocked = true;
      if (!blocked) for (const o of others) if (o.anim !== Anim.DEAD && test(o.x, o.z)) {
        blocked = true;
        break;
      }
      if (!blocked) for (const o of this.cabs) if (o !== c && test(o.x, o.z)) {
        blocked = true;
        break;
      }
      // deux attelages nez à nez : l'un fait demi-tour
      c.blockedFor = blocked ? c.blockedFor + dt : 0;
      if (c.blockedFor > 5) {
        c.blockedFor = 0;
        const ci = Math.floor(c.x / CELL);
        const ck = Math.floor(c.z / CELL);
        c.dir = (c.dir + 2) % 4;
        c.ti = ci + DIRS[c.dir][0];
        c.tk = ck + DIRS[c.dir][1];
      }
      const want = Math.atan2(ddx, ddz);
      const turn = angleDiff(c.yaw, want);
      const slow = Math.min(1, Math.abs(turn) * 1.2);
      const target = blocked ? 0 : c.cruise * (1 - 0.55 * slow);
      c.speed += (target - c.speed) * Math.min(1, dt * (blocked ? 3.5 : 1.2));
      c.yaw += Math.sign(turn) * Math.min(Math.abs(turn), dt * (0.5 + c.speed * 0.32));
      c.x += Math.sin(c.yaw) * c.speed * dt;
      c.z += Math.cos(c.yaw) * c.speed * dt;
      const y = this.world.nav.heightAt(c.x, c.z);
      c.root.position.set(c.x, Number.isFinite(y) ? y : 0, c.z);
      c.root.rotation.y = c.yaw;
      // trot : diagonales opposées
      c.phase += dt * c.speed * 1.9;
      const amp = Math.min(0.5, c.speed * 0.13);
      const s = Math.sin(c.phase);
      c.legs[0].rotation.x = s * amp;
      c.legs[3].rotation.x = s * amp;
      c.legs[1].rotation.x = -s * amp;
      c.legs[2].rotation.x = -s * amp;
      c.horse.position.y = Math.abs(Math.cos(c.phase)) * 0.035 * Math.min(1, c.speed / 3);
      c.horse.rotation.x = Math.sin(c.phase * 2) * 0.012;
      for (const w of c.wheels) w.rotation.x += (c.speed * dt) / 0.74;
      // cocher assis sur son siège, à l'arrière
      const d = c.driver;
      d.x = c.x - fx * 0.84;
      d.z = c.z - fz * 0.84;
      d.y = c.root.position.y + 1.42;
      d.yaw = c.yaw;
      this.views.push(d);
      // sons
      const near = Math.hypot(c.x - px, c.z - pz);
      if (near < 32 && c.speed > 0.6) {
        c.clopAcc += dt * c.speed * 0.75;
        if (c.clopAcc > 1) {
          c.clopAcc = 0;
          audio.play('horse_clop', { pos: { x: hx, y: 0.3, z: hz }, volume: 0.55 });
        }
        c.wheelAcc += dt;
        if (c.wheelAcc > 1.4 && near < 22) {
          c.wheelAcc = 0;
          audio.play('carriage_wheels', { pos: { x: c.x, y: 0.4, z: c.z }, volume: 0.45 });
        }
      }
      if (now > c.neighAt) {
        c.neighAt = now + this.rng.range(35, 90);
        if (near < 28) audio.play('neigh', { pos: { x: hx, y: 1.8, z: hz }, volume: 0.6 });
      }
    }
    return this.views;
  }

  dispose(): void {
    for (const g of this.geos.values()) g.dispose();
    this.material.dispose();
  }
}

