// Circulation de New York 2085 : voitures à coussin magnétique, taxis jaunes et utilitaires qui
// roulent à droite sur la grille des chaussées, s'arrêtent devant les piétons et klaxonnent ;
// et, plus haut, les couloirs aériens où filent les voitures volantes. Purement décoratif :
// chaque client simule sa propre circulation (comme les passants).

import * as THREE from 'three';
import { GM } from '../../shared/city/gen/city';
import { ROADS, WORLD_D, WORLD_W } from '../../shared/city/plan';
import { Rng, angleDiff } from '../../shared/util';
import { audio } from '../audio/AudioEngine';
import { Anim } from '../../shared/characters';
import type { CharView } from '../characters/characterRenderer';
import { meshModel } from '../models/modelMesher';
import { TRAFFIC_PAINTS, policeModel, sedanModel, sportModel, taxiModel, vanModel } from '../models/vehicles';
import { SLOT } from '../models/voxelModel';
import { createObjectMaterial } from '../render/voxelObjectMaterial';
import { settings } from '../settings';
import type { WorldData } from '../world/worldLoader';

interface Car {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  cruise: number;
  /** Demi-longueur et demi-largeur (m). */
  hl: number;
  hw: number;
  ti: number;
  tk: number;
  dir: number;
  blockedFor: number;
  honkAt: number;
  passAt: number;
}

interface SkyCar {
  mesh: THREE.Mesh;
  /** Couloir : axe, coordonnée fixe, sens, altitude. */
  axis: 'x' | 'z';
  fixed: number;
  dir: 1 | -1;
  y: number;
  pos: number;
  speed: number;
}

const DIRS: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const CELL = 2;

export class Traffic {
  readonly group = new THREE.Group();
  private world: WorldData;
  private cars: Car[] = [];
  private sky: SkyCar[] = [];
  private road: Uint8Array;
  private gw = Math.floor(WORLD_W / CELL);
  private gd = Math.floor(WORLD_D / CELL);
  private material = createObjectMaterial({ key: 'traffic' });
  private geos = new Map<string, THREE.BufferGeometry>();
  private rng = new Rng((Date.now() >> 3) & 0xffff);
  private spawnAcc = 0;

  constructor(world: WorldData) {
    this.world = world;
    this.group.name = 'circulation';
    // grille des chaussées assez larges pour une voiture (2 m, marge de 1,6 m)
    this.road = new Uint8Array(this.gw * this.gd);
    const gm = world.groundMap;
    const isRoad = (x: number, z: number) => {
      const vx = Math.floor(x * 4);
      const vz = Math.floor(z * 4);
      if (vx < 0 || vz < 0 || vx >= world.gw || vz >= world.gd) return false;
      const g = gm[vz * world.gw + vx];
      return g === GM.ROAD || g === GM.BRIDGE;
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
    this.buildSky();
  }

  private geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geos.get(key);
    if (!g) this.geos.set(key, (g = make()));
    return g;
  }

  /** Un modèle de la circulation (taxi, berline, coupé, utilitaire, police). */
  private randomModel(): { key: string; geo: THREE.BufferGeometry; hl: number; hw: number } {
    const r = this.rng.next();
    if (r < 0.3) return { key: 'taxi', geo: this.geo('taxi', () => meshModel(taxiModel())), hl: 2.2, hw: 1.0 };
    if (r < 0.42) {
      const p = this.rng.int(0, 2);
      return { key: `van${p}`, geo: this.geo(`van${p}`, () => meshModel(vanModel([0xd8dce2, 0x2a3a5a, 0x5a1a1a][p]))), hl: 2.7, hw: 1.1 };
    }
    if (r < 0.47) return { key: 'police', geo: this.geo('police', () => meshModel(policeModel())), hl: 2.4, hw: 1.05 };
    if (r < 0.55) return { key: 'sport', geo: this.geo('sport', () => meshModel(sportModel(0))), hl: 2.3, hw: 1.0 };
    const p = this.rng.int(0, TRAFFIC_PAINTS.length - 1);
    const glow = [SLOT.NEON_CYAN, SLOT.NEON_PINK, SLOT.NEON_BLUE, SLOT.NEON_AMBER][p % 4];
    return { key: `sedan${p}`, geo: this.geo(`sedan${p}`, () => meshModel(sedanModel(TRAFFIC_PAINTS[p], 0x2a2d33, glow))), hl: 2.2, hw: 1.0 };
  }

  private mesh(geo: THREE.BufferGeometry): THREE.Mesh {
    const m = new THREE.Mesh(geo, this.material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  /** Couloirs aériens au-dessus des grandes avenues (voitures volantes en boucle). */
  private buildSky(): void {
    const lanes: { axis: 'x' | 'z'; fixed: number }[] = [];
    for (const r of ROADS) {
      if (r.name.startsWith('Pont')) continue;
      const len = r.axis === 'z' ? r.rect[3] - r.rect[1] : r.rect[2] - r.rect[0];
      if (len < 90) continue;
      lanes.push({ axis: r.axis, fixed: r.axis === 'z' ? (r.rect[0] + r.rect[2]) / 2 : (r.rect[1] + r.rect[3]) / 2 });
    }
    const n = settings.quality === 'basse' ? 6 : settings.quality === 'moyenne' ? 12 : 20;
    for (let i = 0; i < n && lanes.length; i++) {
      const lane = lanes[i % lanes.length];
      const { geo } = this.randomModel();
      const mesh = this.mesh(geo);
      mesh.castShadow = false;
      this.group.add(mesh);
      const dir: 1 | -1 = i % 2 ? 1 : -1;
      const span = lane.axis === 'z' ? WORLD_D : WORLD_W;
      this.sky.push({ mesh, axis: lane.axis, fixed: lane.fixed + (dir > 0 ? 1.6 : -1.6), dir, y: 30 + (i % 4) * 5 + this.rng.range(0, 2), pos: this.rng.range(-40, span + 40), speed: this.rng.range(16, 26) });
    }
  }

  private isRoad(i: number, k: number): boolean {
    return i >= 0 && k >= 0 && i < this.gw && k < this.gd && this.road[k * this.gw + i] === 1;
  }

  private open(i: number, k: number, d: number, n = 3): boolean {
    const [dx, dz] = DIRS[d];
    for (let s = 1; s <= n; s++) if (!this.isRoad(i + dx * s, k + dz * s)) return false;
    return true;
  }

  private target(): number {
    const q = settings.quality;
    return q === 'basse' ? 4 : q === 'moyenne' ? 7 : q === 'haute' ? 11 : 15;
  }

  private spawn(px: number, pz: number): void {
    for (let tries = 0; tries < 30; tries++) {
      const i = this.rng.int(0, this.gw - 1);
      const k = this.rng.int(0, this.gd - 1);
      if (!this.isRoad(i, k)) continue;
      const x = (i + 0.5) * CELL;
      const z = (k + 0.5) * CELL;
      const d = Math.hypot(x - px, z - pz);
      if (d < 35 || d > 95) continue;
      if (this.cars.some((c) => Math.hypot(c.x - x, c.z - z) < 12)) continue;
      const dirs = [0, 1, 2, 3].filter((dd) => this.open(i, k, dd, 4));
      if (dirs.length === 0) continue;
      const dir = dirs[this.rng.int(0, dirs.length - 1)];
      const m = this.randomModel();
      const mesh = this.mesh(m.geo);
      this.group.add(mesh);
      const [dx, dz] = DIRS[dir];
      this.cars.push({ mesh, x, z, yaw: Math.atan2(dx, dz), speed: 0, cruise: this.rng.range(7, 11), hl: m.hl, hw: m.hw, ti: i + dx, tk: k + dz, dir, blockedFor: 0, honkAt: 0, passAt: 0 });
      return;
    }
  }

  /** Prochaine cellule : tout droit le plus souvent, parfois à gauche ou à droite. */
  private nextCell(c: Car): void {
    const i = c.ti;
    const k = c.tk;
    const straight = c.dir;
    const left = (c.dir + 3) % 4;
    const right = (c.dir + 1) % 4;
    const opts: [number, number][] = [];
    if (this.open(i, k, straight, 2)) opts.push([straight, 6]);
    if (this.open(i, k, left, 5)) opts.push([left, 1]);
    if (this.open(i, k, right, 5)) opts.push([right, 1.4]);
    let dir: number;
    if (opts.length === 0) dir = (c.dir + 2) % 4;
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

  /**
   * others : piétons et personnages (on s'arrête devant eux) ;
   * player : véhicule du joueur (boîte), pour s'arrêter et se faire bousculer.
   */
  update(dt: number, now: number, playerPos: THREE.Vector3, others: CharView[], player: { x: number; z: number; yaw: number; hl: number; hw: number } | null): void {
    const px = playerPos.x;
    const pz = playerPos.z;
    this.spawnAcc += dt;
    if (this.spawnAcc > 1.2 && this.cars.length < this.target()) {
      this.spawnAcc = 0;
      this.spawn(px, pz);
    }
    for (let n = this.cars.length - 1; n >= 0; n--) {
      const c = this.cars[n];
      if (Math.hypot(c.x - px, c.z - pz) > 115) {
        this.group.remove(c.mesh);
        this.cars.splice(n, 1);
        continue;
      }
      // cible : centre de la cellule, décalé à droite (on roule à droite à New York)
      let tx = 0;
      let tz = 0;
      for (let guard = 0; guard < 3; guard++) {
        const [dx, dz] = DIRS[c.dir];
        const lx = -dz;
        const lz = dx;
        const lane = this.isRoad(c.ti + lx, c.tk + lz) ? 1.0 : 0.3;
        tx = (c.ti + 0.5) * CELL + lx * lane;
        tz = (c.tk + 0.5) * CELL + lz * lane;
        const dd = Math.hypot(tx - c.x, tz - c.z);
        const behind = Math.abs(angleDiff(c.yaw, Math.atan2(tx - c.x, tz - c.z))) > 1.3;
        if (dd < 1.8 || (dd < 3 && behind)) this.nextCell(c);
        else break;
      }
      // obstacle devant : on freine
      const fx = Math.sin(c.yaw);
      const fz = Math.cos(c.yaw);
      const hx = c.x + fx * c.hl;
      const hz = c.z + fz * c.hl;
      const look = 2.5 + c.speed * 0.6;
      const test = (ox: number, oz: number, r = 1.2) => {
        const rx = ox - hx;
        const rz = oz - hz;
        const ahead = rx * fx + rz * fz;
        const side = Math.abs(rx * fz - rz * fx);
        return ahead > -0.5 && ahead < look && side < r;
      };
      let blocked = test(px, pz, 1.4);
      if (!blocked) for (const o of others) if (o.anim !== Anim.DEAD && !o.hidden && test(o.x, o.z)) {
        blocked = true;
        break;
      }
      if (!blocked) for (const o of this.cars) if (o !== c && test(o.x, o.z, 1.5)) {
        blocked = true;
        break;
      }
      c.blockedFor = blocked ? c.blockedFor + dt : 0;
      const near = Math.hypot(c.x - px, c.z - pz);
      if (c.blockedFor > 1.8 && now > c.honkAt && near < 40) {
        c.honkAt = now + this.rng.range(3, 7);
        audio.play('neigh', { pos: { x: hx, y: 1, z: hz }, volume: 0.5 });
      }
      if (c.blockedFor > 7) {
        // bloqué pour de bon : demi-tour
        c.blockedFor = 0;
        const ci = Math.floor(c.x / CELL);
        const ck = Math.floor(c.z / CELL);
        c.dir = (c.dir + 2) % 4;
        c.ti = ci + DIRS[c.dir][0];
        c.tk = ck + DIRS[c.dir][1];
      }
      const want = Math.atan2(tx - c.x, tz - c.z);
      const turn = angleDiff(c.yaw, want);
      const slow = Math.min(1, Math.abs(turn) * 1.4);
      const target = blocked ? 0 : c.cruise * (1 - 0.6 * slow);
      c.speed += (target - c.speed) * Math.min(1, dt * (blocked ? 4 : 1.1));
      c.yaw += Math.sign(turn) * Math.min(Math.abs(turn), dt * (0.6 + c.speed * 0.28));
      c.x += Math.sin(c.yaw) * c.speed * dt;
      c.z += Math.cos(c.yaw) * c.speed * dt;
      // la voiture du joueur bouscule celles de la circulation
      if (player) {
        const dx = c.x - player.x;
        const dz = c.z - player.z;
        const d = Math.hypot(dx, dz);
        const minD = Math.min(player.hl + c.hw, player.hw + c.hl) + 0.3;
        if (d < minD && d > 1e-3) {
          c.x += (dx / d) * (minD - d);
          c.z += (dz / d) * (minD - d);
          c.speed = 0;
          c.blockedFor = Math.max(c.blockedFor, 2);
        }
      }
      const y = this.world.nav.heightAt(c.x, c.z);
      c.mesh.position.set(c.x, (Number.isFinite(y) ? y : 0) + Math.sin(now * 2 + n) * 0.02, c.z);
      c.mesh.rotation.y = c.yaw;
      if (near < 18 && c.speed > 5 && now > c.passAt) {
        c.passAt = now + 4;
        audio.play('carriage_wheels', { pos: { x: c.x, y: 0.6, z: c.z }, volume: 0.45 });
      }
    }
    // couloirs aériens
    for (const s of this.sky) {
      const span = s.axis === 'z' ? WORLD_D : WORLD_W;
      s.pos += s.dir * s.speed * dt;
      if (s.pos > span + 60) s.pos = -60;
      if (s.pos < -60) s.pos = span + 60;
      const x = s.axis === 'z' ? s.fixed : s.pos;
      const z = s.axis === 'z' ? s.pos : s.fixed;
      s.mesh.position.set(x, s.y + Math.sin(now * 0.8 + s.fixed) * 0.3, z);
      s.mesh.rotation.y = s.axis === 'z' ? (s.dir > 0 ? 0 : Math.PI) : s.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      s.mesh.visible = Math.hypot(x - px, z - pz) < 230;
    }
  }

  dispose(): void {
    for (const g of this.geos.values()) g.dispose();
    this.material.dispose();
  }
}
