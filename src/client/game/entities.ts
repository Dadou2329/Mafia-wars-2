// Entités côté client : informations, tampons d'instantanés et interpolation.

import { Anim, CharKind, FLAG, Weapon } from '../../shared/characters';
import type { EntityInfo, SnapEntity } from '../../shared/protocol';
import { angleDiff } from '../../shared/util';
import type { CharView } from '../characters/characterRenderer';
import type { BossCustom } from '../characters/styles';

export interface ClientEnt {
  info: EntityInfo;
  buf: { t: number; s: SnapEntity }[];
  view: CharView;
  hp: number;
  alive: boolean;
  flags: number;
  /** Instant (horloge client) de la dernière mise à jour reçue. */
  seenAt: number;
  /** Position courante interpolée. */
  x: number;
  y: number;
  z: number;
}

const BUF = 12;

/** Horloge serveur estimée à partir des instantanés. */
export class ServerClock {
  private samples: number[] = [];
  offset = 0;
  private ready = false;

  sample(serverTime: number): void {
    const local = performance.now() / 1000;
    const o = serverTime - local;
    this.samples.push(o);
    if (this.samples.length > 40) this.samples.shift();
    // le plus grand décalage correspond à la plus faible latence observée
    let best = -Infinity;
    for (const s of this.samples) if (s > best) best = s;
    if (!this.ready) {
      this.offset = best;
      this.ready = true;
    } else this.offset += (best - this.offset) * 0.1;
  }

  now(): number {
    return performance.now() / 1000 + this.offset;
  }
}

export class EntityStore {
  readonly ents = new Map<number, ClientEnt>();
  readonly clock = new ServerClock();
  interpDelay = 0.11;
  private views: CharView[] = [];

  addInfo(info: EntityInfo): ClientEnt {
    let e = this.ents.get(info.id);
    if (e) {
      e.info = info;
      e.view.kind = info.kind;
      e.view.faction = info.faction;
      e.view.look = info.look;
      e.view.gang = info.gang;
      e.view.custom = info.custom as BossCustom | undefined;
      return e;
    }
    e = {
      info,
      buf: [],
      hp: 1,
      alive: true,
      flags: 0,
      seenAt: performance.now() / 1000,
      x: 0,
      y: 0,
      z: 0,
      view: {
        id: info.id,
        kind: info.kind,
        faction: info.faction,
        look: info.look,
        gang: info.gang,
        custom: info.custom as BossCustom | undefined,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
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
      },
    };
    this.ents.set(info.id, e);
    return e;
  }

  remove(id: number): void {
    this.ents.delete(id);
  }

  applySnapshot(time: number, list: SnapEntity[]): void {
    this.clock.sample(time);
    const now = performance.now() / 1000;
    for (const s of list) {
      const e = this.ents.get(s.id);
      if (!e) continue;
      const first = e.buf.length === 0;
      e.buf.push({ t: time, s });
      if (e.buf.length > BUF) e.buf.shift();
      e.seenAt = now;
      e.hp = s.hp;
      e.flags = s.flags;
      const wasAlive = e.alive;
      e.alive = s.anim !== Anim.DEAD;
      if (wasAlive && !e.alive && e.view.deathAt < now - 5) e.view.deathAt = now;
      if (!wasAlive && e.alive) e.view.deathAt = -10;
      if (first) {
        e.x = s.x;
        e.y = s.y;
        e.z = s.z;
        e.view.yaw = s.yaw;
      }
    }
  }

  /** Met à jour les positions interpolées et renvoie les vues à dessiner. */
  update(selfId: number): CharView[] {
    const rt = this.clock.now() - this.interpDelay;
    this.views.length = 0;
    for (const e of this.ents.values()) {
      if (e.buf.length === 0) continue;
      const v = e.view;
      if (e.info.id !== selfId) {
        let a = e.buf[0];
        let b = e.buf[e.buf.length - 1];
        for (let i = e.buf.length - 1; i >= 0; i--) {
          if (e.buf[i].t <= rt) {
            a = e.buf[i];
            b = e.buf[Math.min(i + 1, e.buf.length - 1)];
            break;
          }
        }
        let x: number;
        let y: number;
        let z: number;
        let yaw: number;
        let pitch: number;
        if (a === b || b.t <= a.t) {
          // extrapolation courte
          const dt = Math.min(0.25, Math.max(0, rt - a.t));
          x = a.s.x + a.s.vx * dt;
          y = a.s.y;
          z = a.s.z + a.s.vz * dt;
          yaw = a.s.yaw;
          pitch = a.s.pitch;
        } else {
          const t = Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t)));
          x = a.s.x + (b.s.x - a.s.x) * t;
          y = a.s.y + (b.s.y - a.s.y) * t;
          z = a.s.z + (b.s.z - a.s.z) * t;
          yaw = a.s.yaw + angleDiff(a.s.yaw, b.s.yaw) * t;
          pitch = a.s.pitch + (b.s.pitch - a.s.pitch) * t;
        }
        // grand saut (téléportation) : pas d'interpolation visible
        if (Math.hypot(x - e.x, z - e.z) > 8) {
          e.x = x;
          e.z = z;
        }
        e.x = x;
        e.y = y;
        e.z = z;
        const last = b.s;
        v.x = x;
        v.y = y;
        v.z = z;
        v.yaw = yaw;
        v.pitch = pitch;
        v.vx = last.vx;
        v.vz = last.vz;
        v.anim = last.anim;
        v.aiming = (last.flags & FLAG.AIM) !== 0;
        v.weapon = last.weapon;
      }
      this.views.push(v);
    }
    return this.views;
  }

  /** Entités vivantes (pour les tirs et la visée). */
  *alive(): Iterable<ClientEnt> {
    for (const e of this.ents.values()) if (e.alive && e.buf.length > 0) yield e;
  }

  isBarman(e: ClientEnt): boolean {
    return e.info.kind === CharKind.BARMAN;
  }
}
