// Passants londoniens (côté client uniquement) : ils flânent sur les trottoirs et dans les
// parcs, s'attablent dans les pubs, et fuient ou se jettent à terre au bruit des coups de feu.
// Ils ne sont pas synchronisés : chacun des deux joueurs voit sa propre foule.

import * as THREE from 'three';
import { Anim, CharKind, Weapon } from '../../shared/characters';
import { GM } from '../../shared/city/gen/city';
import { PROP_INDEX } from '../../shared/city/props';
import { Rng, angleDiff, hash32 } from '../../shared/util';
import type { CharView } from '../characters/characterRenderer';
import { settings } from '../settings';
import type { WorldData } from '../world/worldLoader';
import type { EntityStore } from './entities';

type State = 'walk' | 'idle' | 'flee' | 'cower' | 'sit' | 'dead';

interface Civ {
  view: CharView;
  state: State;
  path: number[];
  pi: number;
  speed: number;
  until: number;
  /** Patron attablé : siège d'origine. */
  seat: { x: number; y: number; z: number; yaw: number } | null;
  seatKey: string;
  ty: number;
}

const SEAT_TYPES = new Set(['pub', 'cafe', 'gambling', 'theatre', 'club', 'hq', 'church']);
const ID_BASE = 50000;

export class Civilians {
  private world: WorldData;
  private store: EntityStore;
  private civs: Civ[] = [];
  private spots: Float32Array;
  private seats: { x: number; y: number; z: number; yaw: number; building: number; key: string }[] = [];
  private seated = new Set<string>();
  private rng = new Rng(Date.now() & 0xffff);
  private nextId = ID_BASE;
  private views: CharView[] = [];
  private lastShotT = 0;
  private spawnAcc = 0;
  private seatAcc = 0;

  constructor(world: WorldData, store: EntityStore) {
    this.world = world;
    this.store = store;
    // points de promenade : trottoirs et places, tous les 2 m
    const pts: number[] = [];
    const gm = world.groundMap;
    const gw = world.gw;
    for (let vz = 4; vz < world.gd; vz += 8)
      for (let vx = 4; vx < gw; vx += 8) {
        const g = gm[vz * gw + vx];
        if (g !== GM.SIDEWALK && g !== GM.AREA && g !== GM.PIER) continue;
        const x = vx * 0.25;
        const z = vz * 0.25;
        const n = world.nav.idx(x, z);
        if (n < 0 || world.nav.floor[n] < 0 || world.nav.clear[n] < 2) continue;
        pts.push(x, z);
      }
    this.spots = new Float32Array(pts);
    // sièges des pubs, cafés et salles de spectacle
    const chair = PROP_INDEX.CHAIR;
    const stool = PROP_INDEX.STOOL;
    const bench = PROP_INDEX.PEW;
    const byId = new Map(world.buildings.map((b) => [b.id, b]));
    for (const p of world.props) {
      if (p.kind !== chair && p.kind !== stool && p.kind !== bench) continue;
      const b = byId.get(p.building);
      if (!b || !SEAT_TYPES.has(b.def.type)) continue;
      // un siège sur trois environ est occupé (choix déterministe)
      const key = `${Math.round(p.x * 4)},${Math.round(p.z * 4)}`;
      if (hash32(Math.round(p.x * 40) * 92821 + Math.round(p.z * 40)) % 100 > 38) continue;
      this.seats.push({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, building: b.id, key });
    }
  }

  private target(): number {
    const q = settings.quality;
    return q === 'basse' ? 12 : q === 'moyenne' ? 22 : q === 'haute' ? 32 : 42;
  }

  private makeView(x: number, y: number, z: number, yaw: number): CharView {
    const female = this.rng.chance(0.42);
    const id = this.nextId++;
    if (this.nextId > 64000) this.nextId = ID_BASE;
    return {
      id,
      kind: female ? CharKind.CIVILIAN_F : CharKind.CIVILIAN,
      faction: 0,
      look: this.rng.int(0, 9999),
      gang: 0,
      x,
      y,
      z,
      yaw,
      pitch: 0,
      vx: 0,
      vz: 0,
      anim: Anim.IDLE,
      aiming: false,
      weapon: Weapon.FISTS,
      shotAt: -10,
      hitAt: -10,
      meleeAt: -10,
      interactAt: -10,
      deathAt: -10,
    };
  }

  private randomSpot(cx: number, cz: number, rMin: number, rMax: number, tries = 24): [number, number] | null {
    const n = this.spots.length / 2;
    if (n === 0) return null;
    for (let i = 0; i < tries; i++) {
      const k = this.rng.int(0, n - 1);
      const x = this.spots[k * 2];
      const z = this.spots[k * 2 + 1];
      const d = Math.hypot(x - cx, z - cz);
      if (d >= rMin && d <= rMax) return [x, z];
    }
    return null;
  }

  /** Point de promenade proche (recherche locale par tirages dans un disque). */
  private nearbySpot(cx: number, cz: number, rMin: number, rMax: number): [number, number] | null {
    const nav = this.world.nav;
    for (let i = 0; i < 16; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(rMin, rMax);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const vx = Math.floor(x * 4);
      const vz = Math.floor(z * 4);
      if (vx < 0 || vz < 0 || vx >= this.world.gw || vz >= this.world.gd) continue;
      const g = this.world.groundMap[vz * this.world.gw + vx];
      if (g !== GM.SIDEWALK && g !== GM.AREA && g !== GM.PIER && g !== GM.ROAD) continue;
      const n = nav.idx(x, z);
      if (n < 0 || nav.floor[n] < 0 || nav.clear[n] < 1) continue;
      return [x, z];
    }
    return null;
  }

  private planWalk(c: Civ, tx: number, tz: number, run: boolean): boolean {
    const v = c.view;
    const path = this.world.nav.findPath(v.x, v.z, tx, tz, run ? 6000 : 2500);
    if (!path || path.length < 2) return false;
    c.path = path;
    c.pi = 0;
    c.speed = run ? this.rng.range(3.6, 4.6) : this.rng.range(1.0, 1.45);
    return true;
  }

  private spawnWalker(px: number, pz: number): void {
    const spot = this.randomSpot(px, pz, 24, 62);
    if (!spot) return;
    const [x, z] = spot;
    // pas d'apparition sous le nez d'un personnage du serveur
    for (const e of this.store.alive()) if (Math.abs(e.x - x) < 1.5 && Math.abs(e.z - z) < 1.5) return;
    const y = this.world.nav.heightAt(x, z);
    if (!Number.isFinite(y)) return;
    const c: Civ = { view: this.makeView(x, y, z, this.rng.range(-Math.PI, Math.PI)), state: 'idle', path: [], pi: 0, speed: 1.2, until: 0, seat: null, seatKey: '', ty: y };
    this.civs.push(c);
  }

  private spawnSeated(px: number, pz: number, py: number): void {
    for (const s of this.seats) {
      if (this.seated.has(s.key)) continue;
      const d = Math.hypot(s.x - px, s.z - pz);
      if (d > 26 || d < 3 || Math.abs(s.y - py) > 4) continue;
      const c: Civ = { view: this.makeView(s.x, s.y, s.z, s.yaw), state: 'sit', path: [], pi: 0, speed: 0, until: 0, seat: s, seatKey: s.key, ty: s.y };
      c.view.anim = Anim.SIT;
      this.seated.add(s.key);
      this.civs.push(c);
    }
  }

  /** Coup de feu entendu : fuite ou mise à l'abri. */
  private hearShot(sx: number, sz: number, now: number): void {
    for (const c of this.civs) {
      if (c.state === 'dead') continue;
      const v = c.view;
      const d = Math.hypot(v.x - sx, v.z - sz);
      if (d > 38) continue;
      if (c.state === 'sit' || (d < 9 && this.rng.chance(0.55))) {
        c.state = 'cower';
        c.until = now + this.rng.range(4, 9);
        v.anim = Anim.COWER;
        v.vx = v.vz = 0;
        continue;
      }
      if (c.state === 'flee' && now < c.until - 2) continue;
      // fuite à l'opposé du tir
      const ax = v.x - sx;
      const az = v.z - sz;
      const l = Math.hypot(ax, az) || 1;
      const fx = v.x + (ax / l) * this.rng.range(22, 36);
      const fz = v.z + (az / l) * this.rng.range(22, 36);
      const spot = this.nearbySpot(fx, fz, 0, 6) ?? this.nearbySpot(v.x, v.z, 15, 30);
      if (spot && this.planWalk(c, spot[0], spot[1], true)) {
        c.state = 'flee';
        c.until = now + this.rng.range(7, 12);
      }
    }
  }

  /** Rayon de tir : renvoie le passant touché et la distance, s'il y en a un. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxT: number): { civ: CharView; t: number; head: boolean } | null {
    let best: { civ: CharView; t: number; head: boolean } | null = null;
    for (const c of this.civs) {
      if (c.state === 'dead') continue;
      const v = c.view;
      const h = c.state === 'cower' || c.state === 'sit' ? 1.15 : 1.72;
      // cylindre vertical de rayon 0,3 m
      const ox = o.x - v.x;
      const oz = o.z - v.z;
      const a = d.x * d.x + d.z * d.z;
      const b = 2 * (ox * d.x + oz * d.z);
      const cc = ox * ox + oz * oz - 0.09;
      const disc = b * b - 4 * a * cc;
      if (a < 1e-6 || disc < 0) continue;
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        if (t < 0 || t > maxT) continue;
        const y = o.y + d.y * t - v.y;
        if (y < 0 || y > h) continue;
        if (!best || t < best.t) best = { civ: v, t, head: y > h - 0.28 };
        break;
      }
    }
    return best;
  }

  /** Un passant est abattu (balle ou coup) : il s'effondre. */
  kill(id: number, now: number): void {
    const c = this.civs.find((x) => x.view.id === id);
    if (!c || c.state === 'dead') return;
    c.state = 'dead';
    c.until = now + 40;
    c.view.anim = Anim.DEAD;
    c.view.deathAt = now;
    c.view.hitAt = now;
    c.view.vx = c.view.vz = 0;
    if (c.seatKey) this.seated.delete(c.seatKey);
    c.seatKey = '';
    this.hearShot(c.view.x, c.view.z, now);
  }

  update(dt: number, now: number, playerPos: THREE.Vector3, recentShots: { x: number; z: number; t: number }[]): CharView[] {
    // nouveaux coups de feu
    for (const s of recentShots) {
      if (s.t > this.lastShotT) {
        this.hearShot(s.x, s.z, now);
      }
    }
    if (recentShots.length) this.lastShotT = Math.max(this.lastShotT, recentShots[recentShots.length - 1].t);
    // population
    const px = playerPos.x;
    const pz = playerPos.z;
    const walkers = this.civs.filter((c) => !c.seat).length;
    this.spawnAcc += dt;
    if (this.spawnAcc > 0.25 && walkers < this.target()) {
      this.spawnAcc = 0;
      this.spawnWalker(px, pz);
    }
    this.seatAcc += dt;
    if (this.seatAcc > 1) {
      this.seatAcc = 0;
      if (settings.quality !== 'basse') this.spawnSeated(px, pz, playerPos.y);
    }
    // disparition au loin
    for (let i = this.civs.length - 1; i >= 0; i--) {
      const c = this.civs[i];
      const d = Math.hypot(c.view.x - px, c.view.z - pz);
      const far = c.seat ? d > 34 : d > 78;
      if (far || (c.state === 'dead' && now > c.until)) {
        if (c.seatKey) this.seated.delete(c.seatKey);
        this.civs.splice(i, 1);
      }
    }
    // comportement
    const nav = this.world.nav;
    this.views.length = 0;
    for (const c of this.civs) {
      const v = c.view;
      switch (c.state) {
        case 'sit':
          v.anim = Anim.SIT;
          break;
        case 'cower':
          v.vx = v.vz = 0;
          if (now > c.until) {
            if (c.seat) {
              c.state = 'sit';
              v.x = c.seat.x;
              v.z = c.seat.z;
              v.yaw = c.seat.yaw;
              v.anim = Anim.SIT;
            } else {
              c.state = 'idle';
              c.until = now + this.rng.range(0.5, 2);
              v.anim = Anim.IDLE;
            }
          }
          break;
        case 'idle':
          v.vx = v.vz = 0;
          v.anim = Anim.IDLE;
          if (now > c.until) {
            const spot = this.nearbySpot(v.x, v.z, 8, 26);
            if (spot && this.planWalk(c, spot[0], spot[1], false)) c.state = 'walk';
            else c.until = now + this.rng.range(1, 3);
          }
          break;
        case 'walk':
        case 'flee': {
          const done = this.follow(c, dt);
          if (done) {
            c.state = 'idle';
            c.until = now + (c.state === 'idle' && c.speed > 3 ? this.rng.range(3, 6) : this.rng.range(1.5, 7));
            v.vx = v.vz = 0;
          } else if (c.state === 'flee' && now > c.until) {
            c.state = 'walk';
            c.speed = this.rng.range(1.2, 1.6);
          }
          v.anim = Math.hypot(v.vx, v.vz) > 2.6 ? Anim.RUN : Math.hypot(v.vx, v.vz) > 0.1 ? Anim.WALK : Anim.IDLE;
          break;
        }
        case 'dead':
          v.vx = v.vz = 0;
          break;
      }
      // altitude du sol (lissée)
      if (c.state !== 'sit' && c.state !== 'dead' && !(c.state === 'cower' && c.seat)) {
        const y = nav.heightAt(v.x, v.z);
        if (Number.isFinite(y)) c.ty = y;
        v.y += (c.ty - v.y) * Math.min(1, dt * 12);
      }
      this.views.push(v);
    }
    return this.views;
  }

  /** Suit le chemin ; renvoie vrai à l'arrivée. */
  private follow(c: Civ, dt: number): boolean {
    const v = c.view;
    if (c.pi * 2 >= c.path.length) return true;
    const tx = c.path[c.pi * 2];
    const tz = c.path[c.pi * 2 + 1];
    const dx = tx - v.x;
    const dz = tz - v.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) {
      c.pi++;
      return c.pi * 2 >= c.path.length;
    }
    let sx = (dx / d) * c.speed;
    let sz = (dz / d) * c.speed;
    // évitement léger des autres passants et des personnages du serveur
    for (const o of this.civs) {
      if (o === c || o.state === 'dead') continue;
      const ox = v.x - o.view.x;
      const oz = v.z - o.view.z;
      const od = ox * ox + oz * oz;
      if (od < 0.5 && od > 1e-4) {
        sx += (ox / od) * 0.25;
        sz += (oz / od) * 0.25;
      }
    }
    const nx = v.x + sx * dt;
    const nz = v.z + sz * dt;
    if (this.world.nav.walkable(nx, nz)) {
      v.x = nx;
      v.z = nz;
    } else {
      v.x += (dx / d) * c.speed * dt;
      v.z += (dz / d) * c.speed * dt;
    }
    v.vx = sx;
    v.vz = sz;
    const yaw = Math.atan2(sx, sz);
    v.yaw += angleDiff(v.yaw, yaw) * Math.min(1, dt * 8);
    return false;
  }

  countNear(x: number, z: number, r: number): number {
    let n = 0;
    for (const c of this.civs) if (c.state !== 'dead' && Math.abs(c.view.x - x) < r && Math.abs(c.view.z - z) < r) n++;
    return n;
  }
}
