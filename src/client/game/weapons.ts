// Armes du parrain local : chargeurs, rechargement, tir (détection côté client,
// validée par le serveur), corps à corps.

import * as THREE from 'three';
import { CharKind, FLAG, WEAPONS, WEAPON_SLOTS, Weapon } from '../../shared/characters';
import { VEHICLES } from '../../shared/constants';
import { MATERIALS, Pattern } from '../../shared/materials';
import { makeRayHit, type VoxelWorld } from '../../shared/voxel';
import type { ClientEnt, EntityStore } from './entities';

export interface ShotResult {
  muzzleDir: THREE.Vector3;
  ends: { p: THREE.Vector3; n: THREE.Vector3 | null; mat: number; ent: ClientEnt | null; head: boolean }[];
}

/** Intersection rayon / personnage (cylindre pour le corps, sphère pour la tête). */
/** Rayon contre la caisse d'un véhicule (boîte orientée). */
export function rayVehicle(o: THREE.Vector3, d: THREE.Vector3, e: ClientEnt, maxT: number): number {
  const def = VEHICLES[e.info.gang];
  if (!def) return -1;
  const yaw = e.view.yaw;
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  // repère local : a le long du cap, b en travers
  const ox = o.x - e.x;
  const oz = o.z - e.z;
  const la = ox * s + oz * c;
  const lb = ox * c - oz * s;
  const da = d.x * s + d.z * c;
  const db = d.x * c - d.z * s;
  const ly = o.y - e.y;
  const half = [def.size[2] / 2, def.size[0] / 2];
  let t0 = 0;
  let t1 = maxT;
  const slab = (p: number, dir: number, lo: number, hi: number): boolean => {
    if (Math.abs(dir) < 1e-6) return p >= lo && p <= hi;
    let a = (lo - p) / dir;
    let b = (hi - p) / dir;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    return t0 <= t1;
  };
  if (!slab(la, da, -half[0], half[0]) || !slab(lb, db, -half[1], half[1]) || !slab(ly, d.y, 0.1, def.size[1])) return -1;
  return t0 > 0 ? t0 : -1;
}

export function rayCharacter(o: THREE.Vector3, d: THREE.Vector3, e: ClientEnt, maxT: number): { t: number; head: boolean } | null {
  const crouch = (e.flags & FLAG.CROUCH) !== 0;
  const hy = e.y + (crouch ? 1.2 : 1.62);
  // tête
  let best: { t: number; head: boolean } | null = null;
  {
    const cx = e.x - o.x;
    const cy = hy - o.y;
    const cz = e.z - o.z;
    const tc = cx * d.x + cy * d.y + cz * d.z;
    if (tc > 0) {
      const d2 = cx * cx + cy * cy + cz * cz - tc * tc;
      const r = 0.17;
      if (d2 < r * r) {
        const t = tc - Math.sqrt(r * r - d2);
        if (t > 0 && t < maxT) best = { t, head: true };
      }
    }
  }
  // corps : cylindre vertical
  const r = 0.3;
  const y0 = e.y + 0.05;
  const y1 = e.y + (crouch ? 1.05 : 1.45);
  const ox = o.x - e.x;
  const oz = o.z - e.z;
  const a = d.x * d.x + d.z * d.z;
  if (a > 1e-6) {
    const b = 2 * (ox * d.x + oz * d.z);
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t > 0 && t < maxT) {
        const y = o.y + d.y * t;
        if (y >= y0 && y <= y1 && (!best || t < best.t)) best = { t, head: false };
      }
    }
  }
  return best;
}

export class WeaponSystem {
  current: Weapon = Weapon.PISTOL;
  owned: Weapon[] = [Weapon.FISTS, Weapon.PISTOL];
  mag = new Map<Weapon, number>([[Weapon.PISTOL, 6]]);
  /** Munitions totales (chargeur + réserve) selon le serveur. */
  total = new Map<Weapon, number>([[Weapon.PISTOL, 36]]);
  reloadUntil = 0;
  nextFireAt = 0;
  private hit = makeRayHit();
  onReloadStart: (() => void) | null = null;

  constructor(private world: VoxelWorld) {}

  setOwned(list: Weapon[], ammo: Record<number, number>): void {
    this.owned = [...list].sort((a, b) => a - b);
    for (const w of this.owned) {
      const def = WEAPONS[w];
      if (!def.ranged) continue;
      const tot = ammo[w] ?? 0;
      this.total.set(w, tot);
      if (!this.mag.has(w)) this.mag.set(w, Math.min(def.magazine, tot));
      if ((this.mag.get(w) ?? 0) > tot) this.mag.set(w, tot);
    }
    if (!this.owned.includes(this.current)) this.current = this.owned.includes(Weapon.PISTOL) ? Weapon.PISTOL : this.owned[0];
  }

  reserve(w: Weapon): number {
    return Math.max(0, (this.total.get(w) ?? 0) - (this.mag.get(w) ?? 0));
  }

  canFire(now: number): boolean {
    return now >= this.nextFireAt && now >= this.reloadUntil;
  }

  reloading(now: number): boolean {
    return now < this.reloadUntil;
  }

  startReload(now: number): boolean {
    const def = WEAPONS[this.current];
    if (!def.ranged || now < this.reloadUntil) return false;
    const m = this.mag.get(this.current) ?? 0;
    const tot = this.total.get(this.current) ?? 0;
    if (m >= def.magazine || tot <= m) return false;
    this.reloadUntil = now + def.reload;
    const w = this.current;
    setTimeout(() => {
      const tot2 = this.total.get(w) ?? 0;
      this.mag.set(w, Math.min(WEAPONS[w].magazine, tot2));
    }, def.reload * 1000);
    this.onReloadStart?.();
    return true;
  }

  /** Change d'arme selon l'emplacement (1 mains nues et lames, 2 pistolet, 3 pistolet-mitrailleur, 4 fusil à pompe, 5 fusil à rail). */
  selectSlot(slot: number): boolean {
    const g = WEAPON_SLOTS[slot - 1]?.filter((w) => this.owned.includes(w)) ?? [];
    if (g.length === 0) return false;
    const i = g.indexOf(this.current);
    const next = g[(i + 1) % g.length];
    if (next === this.current) return false;
    this.current = next;
    this.reloadUntil = 0;
    return true;
  }

  next(dir: number): void {
    const i = this.owned.indexOf(this.current);
    this.current = this.owned[(i + dir + this.owned.length) % this.owned.length];
    this.reloadUntil = 0;
  }

  /**
   * Tir : calcule les impacts depuis l'origine o (caméra) dans la direction d.
   * Renvoie null si l'arme ne peut pas tirer.
   */
  fire(now: number, o: THREE.Vector3, d: THREE.Vector3, store: EntityStore, selfId: number, spreadMul: number, selfVehicle = -1): ShotResult | null {
    const w = this.current;
    const def = WEAPONS[w];
    if (!def.ranged || !this.canFire(now)) return null;
    const m = this.mag.get(w) ?? 0;
    if (m <= 0) return null;
    this.mag.set(w, m - 1);
    this.total.set(w, Math.max(0, (this.total.get(w) ?? 0) - 1));
    this.nextFireAt = now + def.cooldown;
    const res: ShotResult = { muzzleDir: d.clone(), ends: [] };
    const tmp = new THREE.Vector3();
    for (let p = 0; p < def.pellets; p++) {
      const spread = def.spread * spreadMul;
      tmp.copy(d);
      if (spread > 0) {
        tmp.x += (Math.random() - 0.5) * 2 * spread;
        tmp.y += (Math.random() - 0.5) * 2 * spread;
        tmp.z += (Math.random() - 0.5) * 2 * spread;
        tmp.normalize();
      }
      let wd = this.world.raycast(o.x, o.y, o.z, tmp.x, tmp.y, tmp.z, def.range, this.hit, 'bullet');
      const worldHit = wd >= 0;
      if (!worldHit) wd = def.range;
      let best: ClientEnt | null = null;
      let bestT = wd;
      let head = false;
      for (const e of store.alive()) {
        if (e.info.id === selfId || e.info.kind === CharKind.BARMAN || e.flags & FLAG.HIDDEN) continue;
        if (Math.abs(e.x - o.x) > bestT + 4 || Math.abs(e.z - o.z) > bestT + 4) continue;
        if (e.info.kind === CharKind.VEHICLE) {
          if (selfVehicle === e.info.id) continue;
          const t = rayVehicle(o, tmp, e, bestT);
          if (t > 0) {
            best = e;
            bestT = t;
            head = false;
          }
          continue;
        }
        const r = rayCharacter(o, tmp, e, bestT);
        if (r) {
          best = e;
          bestT = r.t;
          head = r.head;
        }
      }
      const pt = o.clone().addScaledVector(tmp, bestT);
      if (best) res.ends.push({ p: pt, n: null, mat: 0, ent: best, head });
      else if (worldHit) res.ends.push({ p: pt, n: new THREE.Vector3(this.hit.nx, this.hit.ny, this.hit.nz), mat: this.hit.mat, ent: null, head: false });
      else res.ends.push({ p: pt, n: null, mat: 0, ent: null, head: false });
    }
    return res;
  }

  /** Cible de corps à corps : le plus proche devant soi. */
  meleeTarget(now: number, x: number, y: number, z: number, yaw: number, store: EntityStore, selfId: number, myFaction: number): ClientEnt | null | undefined {
    const def = WEAPONS[this.current];
    if (def.ranged || !this.canFire(now)) return undefined;
    this.nextFireAt = now + def.cooldown;
    let best: ClientEnt | null = null;
    let bd = def.range + 0.4;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    for (const e of store.alive()) {
      if (e.info.id === selfId || e.info.kind === CharKind.BARMAN || e.info.kind === CharKind.VEHICLE || e.flags & FLAG.HIDDEN) continue;
      if (e.info.faction === myFaction && e.info.kind !== CharKind.BOSS_DADOU && e.info.kind !== CharKind.BOSS_EVEN) continue;
      const dx = e.x - x;
      const dz = e.z - z;
      const d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(e.y - y) > 1.4) continue;
      const cos = (dx * fx + dz * fz) / Math.max(1e-3, d);
      if (cos < 0.55) continue;
      bd = d;
      best = e;
    }
    return best;
  }
}

/** Type de surface pour les effets d'impact. */
export function surfaceKind(mat: number): 'stone' | 'wood' | 'metal' | 'glass' | 'dirt' {
  const d = MATERIALS[mat];
  if (!d) return 'stone';
  switch (d.pattern) {
    case Pattern.PLANK:
    case Pattern.PARQUET:
    case Pattern.PANEL:
    case Pattern.PAINT:
    case Pattern.BOOKS:
      return 'wood';
    case Pattern.METAL:
    case Pattern.CORRUGATED:
      return 'metal';
    case Pattern.GLASS:
    case Pattern.STAINED:
      return 'glass';
    case Pattern.DIRT:
    case Pattern.GRASS:
    case Pattern.FOLIAGE:
      return 'dirt';
    default:
      return 'stone';
  }
}
