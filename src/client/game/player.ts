// Contrôle du parrain local : déplacements avec collisions voxel, saut, accroupi,
// caméras première/troisième personne avec collision de caméra.

import * as THREE from 'three';
import { Anim, FLAG, Weapon } from '../../shared/characters';
import { clamp } from '../../shared/util';
import { GROUND_VY, INV_VOXEL, type VoxelWorld } from '../../shared/voxel';
import { MAT_SOLID, MAT_VISIBLE } from '../../shared/materials';
import type { Input } from '../input/input';
import { settings } from '../settings';

const HALF = 0.3;
const HEIGHT = 1.75;
const HEIGHT_CROUCH = 1.25;
const STEP = 0.55;
const GRAVITY = 22;

export class PlayerController {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  /** Orientation du corps (suit la caméra quand on bouge ou vise). */
  bodyYaw = 0;
  onGround = false;
  crouch = false;
  /** Accroupi d'office (plafond bas) : on se relève tout seul dès qu'il y a la place. */
  private forcedCrouch = false;
  sprint = false;
  aiming = false;
  firstPerson = !settings.thirdPerson;
  anim: Anim = Anim.IDLE;
  dead = false;
  frozen = false;
  /** Distance courante de la caméra (lissée). */
  private camDist = 3.2;
  private camShoulder = 0.55;
  readonly camera: THREE.PerspectiveCamera;
  private world: VoxelWorld;
  /** Secousse de caméra (recul, explosions). */
  shake = 0;
  recoil = 0;
  private bob = 0;
  stepDist = 0;
  onStep: ((surface: number) => void) | null = null;
  weapon: Weapon = Weapon.REVOLVER;

  constructor(camera: THREE.PerspectiveCamera, world: VoxelWorld) {
    this.camera = camera;
    this.world = world;
  }

  teleport(x: number, y: number, z: number, yaw: number): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.bodyYaw = yaw;
    this.pitch = 0;
    this.crouch = false;
    this.forcedCrouch = false;
    this.unstick();
  }

  /**
   * Si le joueur chevauche un obstacle (point d'apparition encombré, meuble…), on le
   * dégage vers l'emplacement libre le plus proche (recherche en spirale, 1,5 m au plus).
   */
  unstick(): boolean {
    const h = this.crouch ? HEIGHT_CROUCH : HEIGHT;
    if (!this.collides(this.pos.x, this.pos.y, this.pos.z, h)) return false;
    const { x, y, z } = this.pos;
    for (let r = 0.1; r <= 1.5; r += 0.1) {
      const n = Math.max(8, Math.round((r * Math.PI * 2) / 0.1));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const nx = x + Math.cos(a) * r;
        const nz = z + Math.sin(a) * r;
        for (const dy of [0, 0.25, -0.25]) {
          if (!this.collides(nx, y + dy, nz, h)) {
            this.pos.set(nx, y + dy, nz);
            return true;
          }
        }
      }
    }
    return false;
  }

  private solidVoxel(vx: number, vy: number, vz: number): boolean {
    if (vy < 0) return true;
    if (vx < 0 || vz < 0 || vx >= this.world.sx || vz >= this.world.sz) return true;
    return MAT_SOLID[this.world.get(vx, vy, vz)] === 1;
  }

  /** La boîte du joueur (pieds en p) chevauche-t-elle un voxel solide ? */
  private collides(x: number, y: number, z: number, h: number): boolean {
    const x0 = Math.floor((x - HALF) * INV_VOXEL);
    const x1 = Math.floor((x + HALF - 1e-4) * INV_VOXEL);
    const z0 = Math.floor((z - HALF) * INV_VOXEL);
    const z1 = Math.floor((z + HALF - 1e-4) * INV_VOXEL);
    const y0 = Math.floor(y * INV_VOXEL + 1e-4) + GROUND_VY;
    const y1 = Math.floor((y + h - 1e-4) * INV_VOXEL) + GROUND_VY;
    for (let vy = y0; vy <= y1; vy++)
      for (let vz = z0; vz <= z1; vz++) for (let vx = x0; vx <= x1; vx++) if (this.solidVoxel(vx, vy, vz)) return true;
    return false;
  }

  /** Hauteur du sol sous les pieds (recherche vers le bas, max 2 m). */
  private groundBelow(x: number, y: number, z: number): number {
    const x0 = Math.floor((x - HALF) * INV_VOXEL);
    const x1 = Math.floor((x + HALF - 1e-4) * INV_VOXEL);
    const z0 = Math.floor((z - HALF) * INV_VOXEL);
    const z1 = Math.floor((z + HALF - 1e-4) * INV_VOXEL);
    const top = Math.floor(y * INV_VOXEL - 1e-4) + GROUND_VY;
    for (let vy = top; vy > top - 8; vy--) {
      for (let vz = z0; vz <= z1; vz++)
        for (let vx = x0; vx <= x1; vx++) if (this.solidVoxel(vx, vy, vz)) return (vy + 1 - GROUND_VY) / INV_VOXEL;
    }
    return -Infinity;
  }

  update(dt: number, input: Input): void {
    // ----- regard
    const sens = 0.0022 * settings.sensitivity * (this.aiming ? 0.6 : 1);
    if (!this.frozen) {
      this.yaw -= input.mouseDX * sens;
      this.pitch -= input.mouseDY * sens * (settings.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -1.45, 1.35);
    }
    if (input.hit('view')) this.firstPerson = !this.firstPerson;
    if (this.dead || this.frozen) {
      this.vel.x *= 0.8;
      this.vel.z *= 0.8;
      this.anim = this.dead ? Anim.DEAD : Anim.IDLE;
      this.integrate(dt, 0, 0, false);
      return;
    }
    this.aiming = input.is('aim');
    if (input.hit('crouch')) {
      this.crouch = !this.crouch;
      this.forcedCrouch = false;
    }
    // ----- déplacement voulu
    let fx = 0;
    let fz = 0;
    if (input.is('forward')) fz += 1;
    if (input.is('back')) fz -= 1;
    if (input.is('left')) fx += 1;
    if (input.is('right')) fx -= 1;
    const len = Math.hypot(fx, fz);
    this.sprint = input.is('sprint') && fz > 0 && !this.aiming && !this.crouch;
    if (this.sprint && this.crouch) this.crouch = false;
    let speed = this.aiming ? 2.6 : this.crouch ? 1.8 : this.sprint ? 6.4 : 4.2;
    if (fz < 0 && !this.sprint) speed *= 0.8;
    let wx = 0;
    let wz = 0;
    if (len > 0) {
      const s = Math.sin(this.yaw);
      const c = Math.cos(this.yaw);
      // avant = (sin yaw, cos yaw) ; gauche = (cos yaw, -sin yaw)
      wx = ((fz * s + fx * c) / len) * speed;
      wz = ((fz * c - fx * s) / len) * speed;
    }
    const jump = input.hit('jump') && this.onGround;
    this.integrate(dt, wx, wz, jump);
    // orientation du corps
    const moving = Math.hypot(this.vel.x, this.vel.z) > 0.3;
    if (this.aiming || moving || this.firstPerson) this.bodyYaw = this.yaw;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.anim = sp > 4.6 ? Anim.RUN : sp > 0.3 ? Anim.WALK : Anim.IDLE;
    // bruits de pas
    if (this.onGround && sp > 0.5) {
      this.stepDist += sp * dt;
      const stride = this.sprint ? 1.6 : 1.25;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        const below = this.world.get(Math.floor(this.pos.x * INV_VOXEL), Math.floor(this.pos.y * INV_VOXEL) + GROUND_VY - 1, Math.floor(this.pos.z * INV_VOXEL));
        this.onStep?.(below);
      }
    }
    this.bob += sp * dt * (this.sprint ? 1.3 : 1);
  }

  private integrate(dt: number, wx: number, wz: number, jump: boolean): void {
    const h = this.crouch ? HEIGHT_CROUCH : HEIGHT;
    // coincé dans le décor (apparition, porte, accessoire) : on se dégage d'abord
    if (this.collides(this.pos.x, this.pos.y, this.pos.z, h) && (!this.crouch || this.collides(this.pos.x, this.pos.y, this.pos.z, HEIGHT_CROUCH))) this.unstick();
    const accel = this.onGround ? 42 : 9;
    this.vel.x += clamp(wx - this.vel.x, -accel * dt, accel * dt);
    this.vel.z += clamp(wz - this.vel.z, -accel * dt, accel * dt);
    if (jump) {
      this.vel.y = 6.4;
      this.onGround = false;
    }
    this.vel.y -= GRAVITY * dt;
    if (this.vel.y < -30) this.vel.y = -30;
    // sous-pas pour éviter de traverser les murs fins
    const steps = Math.max(1, Math.ceil((Math.hypot(this.vel.x, this.vel.z) * dt) / 0.12));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.moveAxis(this.vel.x * sdt, 0, h);
      this.moveAxis(0, this.vel.z * sdt, h);
    }
    // vertical
    const ny = this.pos.y + this.vel.y * dt;
    if (this.vel.y <= 0) {
      if (this.collides(this.pos.x, ny, this.pos.z, h)) {
        const g = this.groundBelow(this.pos.x, this.pos.y + 0.05, this.pos.z);
        this.pos.y = Number.isFinite(g) && g <= this.pos.y + 0.06 ? g : this.pos.y;
        this.vel.y = 0;
        this.onGround = true;
      } else {
        this.pos.y = ny;
        // aimantation au sol dans les descentes de marches
        if (this.onGround) {
          const g = this.groundBelow(this.pos.x, this.pos.y + 0.02, this.pos.z);
          if (Number.isFinite(g) && this.pos.y - g < 0.3 && this.pos.y - g > 0) {
            this.pos.y = g;
            this.vel.y = 0;
          } else this.onGround = false;
        }
      }
    } else {
      if (this.collides(this.pos.x, ny, this.pos.z, h)) {
        this.vel.y = 0;
      } else {
        this.pos.y = ny;
        this.onGround = false;
      }
    }
    // pour se relever, il faut de la place
    if (!this.crouch && this.collides(this.pos.x, this.pos.y, this.pos.z, HEIGHT)) {
      this.crouch = true;
      this.forcedCrouch = true;
    } else if (this.forcedCrouch && !this.collides(this.pos.x, this.pos.y, this.pos.z, HEIGHT)) {
      this.crouch = false;
      this.forcedCrouch = false;
    }
  }

  private moveAxis(dx: number, dz: number, h: number): void {
    if (dx === 0 && dz === 0) return;
    const nx = this.pos.x + dx;
    const nz = this.pos.z + dz;
    if (!this.collides(nx, this.pos.y, nz, h)) {
      this.pos.x = nx;
      this.pos.z = nz;
      return;
    }
    // marche : on tente de monter
    if (this.onGround || this.vel.y <= 0) {
      for (let s = 0.25; s <= STEP + 1e-3; s += 0.25) {
        if (!this.collides(nx, this.pos.y + s, nz, h) && !this.collides(this.pos.x, this.pos.y + s, this.pos.z, h)) {
          this.pos.x = nx;
          this.pos.z = nz;
          this.pos.y += s;
          return;
        }
      }
    }
    // bloqué : on annule la vitesse sur cet axe
    if (dx !== 0) this.vel.x = 0;
    if (dz !== 0) this.vel.z = 0;
  }

  /** Place la caméra. Renvoie la position de l'œil. */
  updateCamera(dt: number, fovBase: number): void {
    const cam = this.camera;
    const eyeH = this.crouch ? 1.15 : 1.6;
    const targetFov = this.aiming ? (this.weapon === Weapon.RIFLE ? fovBase * 0.5 : fovBase * 0.72) : this.sprint ? fovBase * 1.06 : fovBase;
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 12);
    cam.updateProjectionMatrix();
    const shakeX = (Math.random() - 0.5) * this.shake * 0.04;
    const shakeY = (Math.random() - 0.5) * this.shake * 0.04;
    this.shake *= Math.exp(-dt * 10);
    this.recoil *= Math.exp(-dt * 12);
    const pitch = this.pitch + this.recoil * 0.05;
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.yaw) * Math.cos(pitch));
    if (this.firstPerson) {
      const bobY = this.onGround ? Math.sin(this.bob * 2.4) * 0.025 : 0;
      cam.position.set(this.pos.x + shakeX, this.pos.y + eyeH + 0.04 + bobY + shakeY, this.pos.z);
      // légèrement en avant pour ne pas voir l'intérieur de la tête
      cam.position.addScaledVector(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 0.12);
      cam.lookAt(cam.position.clone().add(dir));
      return;
    }
    const wantDist = this.aiming ? 1.55 : 3.1;
    const wantShoulder = this.aiming ? 0.62 : 0.5;
    this.camDist += (wantDist - this.camDist) * Math.min(1, dt * 10);
    this.camShoulder += (wantShoulder - this.camShoulder) * Math.min(1, dt * 10);
    const pivot = new THREE.Vector3(this.pos.x, this.pos.y + eyeH + 0.05, this.pos.z);
    // épaule droite : droite = (-cos yaw, 0, sin yaw)
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const shoulderPt = pivot.clone().addScaledVector(right, this.camShoulder);
    // collision épaule
    const sh = this.castCamera(pivot, shoulderPt);
    const want = sh.clone().addScaledVector(dir, -this.camDist);
    const p = this.castCamera(sh, want);
    cam.position.set(p.x + shakeX, p.y + shakeY, p.z);
    cam.lookAt(cam.position.clone().add(dir));
  }

  private castCamera(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
    const d = to.clone().sub(from);
    const len = d.length();
    if (len < 1e-4) return to.clone();
    d.divideScalar(len);
    // marche à pas fins dans la grille voxel (solide et visible)
    const stepLen = 0.08;
    let t = 0;
    const p = from.clone();
    while (t < len) {
      t = Math.min(len, t + stepLen);
      p.copy(from).addScaledVector(d, t);
      const vx = Math.floor(p.x * INV_VOXEL);
      const vy = Math.floor(p.y * INV_VOXEL) + GROUND_VY;
      const vz = Math.floor(p.z * INV_VOXEL);
      const m = this.world.get(vx, vy, vz);
      if (m !== 0 && MAT_SOLID[m] === 1 && MAT_VISIBLE[m] === 1) {
        return from.clone().addScaledVector(d, Math.max(0.05, t - 0.22));
      }
    }
    return to.clone();
  }

  /** Direction de visée (centre de l'écran). */
  aimRay(): { o: THREE.Vector3; d: THREE.Vector3 } {
    const o = this.camera.position.clone();
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    return { o, d };
  }

  flags(): number {
    let f = 0;
    if (this.aiming) f |= FLAG.AIM;
    if (this.crouch) f |= FLAG.CROUCH;
    return f;
  }
}
