// Conduite des véhicules par le joueur (physique d'arcade) : motos et voitures sur coussin
// magnétique (accélération, freinage, direction, collisions voxel, montée des trottoirs,
// chute dans le vide), aéronef ADAV (poussée, montée/descente, atterrissage sur les toits).

import * as THREE from 'three';
import { VEHICLES, type VehicleDef } from '../../shared/constants';
import { clamp } from '../../shared/util';
import { GROUND_VY, INV_VOXEL, type VoxelWorld } from '../../shared/voxel';
import { MAT_SOLID } from '../../shared/materials';
import type { Input } from '../input/input';

const GRAVITY = 22;
/** Les obstacles plus bas que ça (bordures de trottoir, marches) sont franchis. */
const STEP_UP = 0.42;

export class Drive {
  readonly id: number;
  readonly def: VehicleDef;
  pos = new THREE.Vector3();
  yaw = 0;
  /** Vitesse le long du cap (m/s) ; vitesse verticale. */
  speed = 0;
  vy = 0;
  /** ADAV : vitesse latérale (glissade). */
  side = 0;
  onGround = true;
  /** Dernier choc (pour le son et la secousse). */
  bump = 0;
  private world: VoxelWorld;

  constructor(id: number, defId: number, world: VoxelWorld, x: number, y: number, z: number, yaw: number) {
    this.id = id;
    this.def = VEHICLES[defId];
    this.world = world;
    this.pos.set(x, y, z);
    this.yaw = yaw;
  }

  get flying(): boolean {
    return this.def.cls === 'vtol';
  }

  /** Vitesse horizontale (vecteur monde). */
  velocity(): { x: number; z: number } {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    return { x: s * this.speed + c * this.side, z: c * this.speed - s * this.side };
  }

  private solid(vx: number, vy: number, vz: number): boolean {
    if (vy < 0) return true;
    if (vx < 0 || vz < 0 || vx >= this.world.sx || vz >= this.world.sz) return true;
    return MAT_SOLID[this.world.get(vx, vy, vz)] === 1;
  }

  /** La caisse posée en (x, y, z) avec le cap `yaw` touche-t-elle un obstacle (au-dessus de y + lift) ? */
  collides(x: number, y: number, z: number, yaw: number, lift = STEP_UP): boolean {
    const d = this.def;
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const hw = d.size[0] / 2 - 0.08;
    const hl = d.size[2] / 2 - 0.08;
    const y0 = Math.floor((y + lift) * INV_VOXEL) + GROUND_VY;
    const y1 = Math.floor((y + d.size[1] - 0.05) * INV_VOXEL) + GROUND_VY;
    const na = Math.max(2, Math.ceil((hl * 2) / 0.4));
    const nb = Math.max(2, Math.ceil((hw * 2) / 0.4));
    for (let i = 0; i <= na; i++) {
      const a = -hl + (i / na) * hl * 2;
      for (let j = 0; j <= nb; j++) {
        // seulement le pourtour (et le centre) : plus rapide, suffisant pour des voxels de 25 cm
        if (i !== 0 && i !== na && j !== 0 && j !== nb && !(i === na >> 1 && j === nb >> 1)) continue;
        const b = -hw + (j / nb) * hw * 2;
        const px = x + s * a + c * b;
        const pz = z + c * a - s * b;
        const vx = Math.floor(px * INV_VOXEL);
        const vz = Math.floor(pz * INV_VOXEL);
        for (let vy = y0; vy <= y1; vy++) if (this.solid(vx, vy, vz)) return true;
      }
    }
    return false;
  }

  /** Hauteur du sol sous le véhicule (le point le plus haut sous l'empreinte, cherché vers le bas). */
  groundAt(x: number, y: number, z: number, yaw: number, reach = 2.5): number {
    const d = this.def;
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    let best = -Infinity;
    const pts: [number, number][] = [
      [0, 0],
      [d.size[2] * 0.35, d.size[0] * 0.3],
      [d.size[2] * 0.35, -d.size[0] * 0.3],
      [-d.size[2] * 0.35, d.size[0] * 0.3],
      [-d.size[2] * 0.35, -d.size[0] * 0.3],
    ];
    const top = Math.floor((y + STEP_UP) * INV_VOXEL) + GROUND_VY;
    const bottom = Math.floor((y - reach) * INV_VOXEL) + GROUND_VY;
    for (const [a, b] of pts) {
      const vx = Math.floor((x + s * a + c * b) * INV_VOXEL);
      const vz = Math.floor((z + c * a - s * b) * INV_VOXEL);
      for (let vy = top; vy >= bottom; vy--) {
        if (this.solid(vx, vy, vz)) {
          const g = (vy + 1 - GROUND_VY) / INV_VOXEL;
          if (g > best) best = g;
          break;
        }
      }
    }
    return best;
  }

  update(dt: number, input: Input, frozen: boolean): void {
    this.bump = Math.max(0, this.bump - dt * 3);
    if (this.flying) return this.updateFlying(dt, input, frozen);
    const d = this.def;
    const throttle = frozen ? 0 : (input.is('forward') ? 1 : 0) - (input.is('back') ? 1 : 0);
    const steer = frozen ? 0 : (input.is('left') ? 1 : 0) - (input.is('right') ? 1 : 0);
    const brake = !frozen && input.is('jump');
    const max = d.speed * (input.is('sprint') && !frozen ? 1.0 : 0.82);
    // moteur et freins
    if (throttle > 0) this.speed += (this.speed < 0 ? d.accel * 2.6 : d.accel) * dt;
    else if (throttle < 0) this.speed -= (this.speed > 0 ? d.accel * 2.6 : d.accel * 0.55) * dt;
    else {
      const drag = 1.6 + Math.abs(this.speed) * 0.05;
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), drag * dt);
    }
    if (brake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), d.accel * 3 * dt);
    this.speed = clamp(this.speed, -d.speed * 0.32, max);
    if (!this.onGround) this.speed *= Math.exp(-0.3 * dt);
    // direction : plus vive à basse vitesse, inversée en marche arrière
    const sp = Math.abs(this.speed);
    const grip = clamp(sp / 5, 0, 1) * (1 - 0.5 * clamp(sp / d.speed, 0, 1));
    const rate = (d.cls === 'moto' ? 2.6 : d.cls === 'van' || d.cls === 'truck' ? 1.4 : 2.0) * (brake ? 1.35 : 1);
    const dyaw = steer * rate * grip * Math.sign(this.speed || 1) * dt;
    if (dyaw !== 0 && this.onGround) {
      if (!this.collides(this.pos.x, this.pos.y, this.pos.z, this.yaw + dyaw)) this.yaw += dyaw;
      else this.speed *= 0.9;
    }
    // déplacement par petits pas, avec glissement le long des murs
    const v = this.velocity();
    const dist = Math.hypot(v.x, v.z) * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.18));
    for (let i = 0; i < steps; i++) {
      const nx = this.pos.x + (v.x * dt) / steps;
      const nz = this.pos.z + (v.z * dt) / steps;
      if (!this.collides(nx, this.pos.y, nz, this.yaw)) {
        this.pos.x = nx;
        this.pos.z = nz;
      } else if (!this.collides(nx, this.pos.y, this.pos.z, this.yaw)) {
        this.pos.x = nx;
        this.speed *= 0.97;
      } else if (!this.collides(this.pos.x, this.pos.y, nz, this.yaw)) {
        this.pos.z = nz;
        this.speed *= 0.97;
      } else {
        // choc frontal : petit rebond
        if (Math.abs(this.speed) > 6) this.bump = Math.min(1, Math.abs(this.speed) / 25);
        this.speed *= -0.25;
        break;
      }
      // le sol : on monte les bordures, on suit les rampes, on tombe dans le vide
      const g = this.groundAt(this.pos.x, this.pos.y, this.pos.z, this.yaw);
      if (Number.isFinite(g) && g >= this.pos.y - 0.3) {
        if (g > this.pos.y) this.pos.y = Math.min(g, this.pos.y + STEP_UP);
        else this.pos.y += (g - this.pos.y) * 0.5;
        this.onGround = true;
        this.vy = 0;
      } else this.onGround = false;
    }
    if (!this.onGround) {
      this.vy -= GRAVITY * dt;
      const ny = this.pos.y + this.vy * dt;
      const g = this.groundAt(this.pos.x, this.pos.y, this.pos.z, this.yaw, Math.max(2.5, -this.vy * dt + 0.5));
      if (Number.isFinite(g) && ny <= g) {
        if (this.vy < -8) this.bump = Math.min(1, -this.vy / 20);
        this.pos.y = g;
        this.vy = 0;
        this.onGround = true;
      } else this.pos.y = Math.max(-12, ny);
    }
  }

  private updateFlying(dt: number, input: Input, frozen: boolean): void {
    const d = this.def;
    const throttle = frozen ? 0 : (input.is('forward') ? 1 : 0) - (input.is('back') ? 1 : 0);
    const turn = frozen ? 0 : (input.is('left') ? 1 : 0) - (input.is('right') ? 1 : 0);
    const lift = frozen ? 0 : (input.is('jump') ? 1 : 0) - (input.is('crouch') ? 1 : 0);
    const boost = !frozen && input.is('sprint') ? 1.3 : 1;
    // poussée horizontale
    const max = d.speed * boost;
    if (throttle !== 0) this.speed = clamp(this.speed + throttle * d.accel * dt, -max * 0.4, max);
    else this.speed *= Math.exp(-0.9 * dt);
    this.side *= Math.exp(-2 * dt);
    if (this.onGround && lift <= 0) this.speed *= Math.exp(-4 * dt);
    this.yaw += turn * 1.3 * dt;
    // montée / descente, maintien en vol stationnaire
    if (lift !== 0) this.vy = clamp(this.vy + lift * 9 * dt, -7, 7);
    else this.vy *= Math.exp(-2.5 * dt);
    const v = this.velocity();
    const nx = this.pos.x + v.x * dt;
    const nz = this.pos.z + v.z * dt;
    if (!this.collides(nx, this.pos.y, nz, this.yaw, 0.15)) {
      this.pos.x = nx;
      this.pos.z = nz;
    } else {
      if (Math.abs(this.speed) > 6) this.bump = Math.min(1, Math.abs(this.speed) / 25);
      this.speed *= -0.3;
    }
    const ny = Math.min(88, this.pos.y + this.vy * dt);
    if (this.vy < 0) {
      const g = this.groundAt(this.pos.x, this.pos.y, this.pos.z, this.yaw, 3);
      if (Number.isFinite(g) && ny <= g) {
        this.pos.y = g;
        this.vy = 0;
        this.onGround = true;
        return;
      }
    } else if (this.vy > 0 && this.collides(this.pos.x, ny, this.pos.z, this.yaw, 0.15)) {
      this.vy = 0;
      return;
    }
    this.pos.y = ny;
    if (this.vy > 0.2) this.onGround = false;
  }
}
