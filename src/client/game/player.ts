// Contrôle du parrain local : déplacements avec collisions voxel, caméras première/troisième
// personne avec collision de caméra, conduite des véhicules.
//
// Déplacements de base : accélération et freinage francs, sprint, accroupi (appui bref : bascule ;
// appui long : maintenu), glissade (accroupi en sprintant), saut avec temps de grâce et mémoire de
// la touche (relâcher tôt = saut plus court), réception amortie, escalade des rebords (on se hisse
// en sautant contre un rebord). Les implants ajoutent le double saut, le bond chargé, l'esquive,
// la course et le saut muraux, l'escalade des murs, le plané et le grappin (paramètres dans `mods`,
// voir shared/moveMods.ts). Les événements de déplacement (saut, esquive, grappin…) partent par
// `onMove` : le contrôleur des implants les transmet au serveur et déclenche sons et effets.

import * as THREE from 'three';
import { Anim, FLAG, INPUT_AIR, Weapon } from '../../shared/characters';
import { AIM_SPEED, baseMods, CROUCH_SPEED, DASH_TIME, grappleMaxSpeed, leapVelocity, SPRINT_SPEED, WALK_SPEED, type MoveMods } from '../../shared/moveMods';
import { clamp } from '../../shared/util';
import { GROUND_VY, INV_VOXEL, makeRayHit, type VoxelWorld } from '../../shared/voxel';
import { MAT_SOLID, MAT_VISIBLE } from '../../shared/materials';
import type { Input } from '../input/input';
import { settings } from '../settings';
import type { Drive } from './driving';

const HALF = 0.3;
const HEIGHT = 1.75;
const HEIGHT_CROUCH = 1.25;
const HEIGHT_SLIDE = 1.0;
const STEP = 0.55;
const GRAVITY = 22;
const JUMP_V = 6.4;
/** Temps de grâce après avoir quitté le sol, et mémoire d'un appui sur saut (s). */
const COYOTE = 0.12;
const JUMP_BUFFER = 0.14;
const MAX_FALL = 30;
/** Vitesse du crochet du grappin (m/s). */
const HOOK_SPEED = 80;
/** Hauteur de la main qui tient le câble, au-dessus des pieds (m). */
const HAND_Y = 1.35;

export type MoveMode = 'walk' | 'slide' | 'wallrun' | 'grapple' | 'mantle' | 'climb';

export type MoveEventKind =
  | 'jump'
  | 'airJump'
  | 'wallJump'
  | 'leapCharge'
  | 'leap'
  | 'dash'
  | 'slide'
  | 'slideEnd'
  | 'wallrun'
  | 'mantle'
  | 'climb'
  | 'land'
  | 'grappleFire'
  | 'grappleAttach'
  | 'grappleRelease'
  | 'grappleMiss';

/** Événement de déplacement : position (x, y, z), point visé ou direction (x2, y2, z2), valeur v. */
export interface MoveEvent {
  k: MoveEventKind;
  x: number;
  y: number;
  z: number;
  x2?: number;
  y2?: number;
  z2?: number;
  v?: number;
  /** Hauteur de chute (atterrissage, m). */
  h?: number;
}

/** Ce que le joueur demande pendant cette image. */
interface Intent {
  fx: number;
  fz: number;
  sprint: boolean;
  jumpHit: boolean;
  jumpHeld: boolean;
  crouchHit: boolean;
  crouchHeld: boolean;
  aim: boolean;
  dash: boolean;
}

const NO_INTENT: Intent = { fx: 0, fz: 0, sprint: false, jumpHit: false, jumpHeld: false, crouchHit: false, crouchHeld: false, aim: false, dash: false };

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
  weapon: Weapon = Weapon.PISTOL;
  /** Véhicule conduit (null : à pied). */
  drive: Drive | null = null;
  /** Instant du dernier mouvement de souris (la caméra se recale derrière le véhicule). */
  private lookAt = 0;
  /** Temps local (s). */
  t = 0;

  // ------------------------------------------------------------------ déplacements avancés
  /** Modificateurs des implants (à remplacer à chaque changement d'équipement). */
  mods: MoveMods = baseMods();
  /** Multiplicateur de vitesse temporaire (accélérateur de réflexes). */
  speedMul = 1;
  /** Grossissement en visant (optique télescopique). */
  aimZoom = 1;
  /** Étourdi jusqu'à (temps local, s) : plus aucun déplacement volontaire. */
  stunUntil = 0;
  mode: MoveMode = 'walk';
  onMove: ((e: MoveEvent) => void) | null = null;
  /** Énergie du sprint cybernétique (0..1). */
  energy = 1;
  private energyWait = 0;
  private boosting = false;
  private airTime = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  /** Saut depuis le sol en cours : relâcher la touche tôt le raccourcit (une fois). */
  private jumpCut = true;
  private airJumps = 0;
  private wallJumps = 0;
  private hoverUsed = 0;
  /** Plus haute altitude depuis le dernier appui (hauteur de chute). */
  private fallTop = 0;
  private landT = 0;
  private airJumpAt = -10;
  private leapAt = -10;
  private crouchDownAt = -10;
  private crouchHeld = false;
  /** Charge du bond (s) et charge en cours. */
  leapCharge = 0;
  private leapCharging = false;
  leapReadyAt = 0;
  dashCharges = 0;
  dashNextAt = 0;
  private dashMax = 0;
  private dashT = 0;
  private dashDir = new THREE.Vector3();
  private dashSpeed = 0;
  private dashKeep = 0;
  private slideT = 0;
  private slideDir = new THREE.Vector3();
  private slideSpeed = 0;
  private slideAir = 0;
  /** Course murale : normale du mur (vers le joueur), côté (1 : mur à droite), durée écoulée. */
  private wall: { nx: number; nz: number; side: 1 | -1; t: number } | null = null;
  private lastWallN: { nx: number; nz: number } | null = null;
  private mantle: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t: number; dur: number } | null = null;
  private climbUsed = 0;
  private climbN = { nx: 0, nz: 0 };
  /** Crochet du grappin en vol (point d'ancrage visé, temps écoulé, durée du trajet, raté). */
  hook: { anchor: THREE.Vector3; t: number; travel: number; miss: boolean } | null = null;
  /** Grappin accroché : ancre, longueur du câble, durée. */
  grapple: { anchor: THREE.Vector3; len: number; t: number; check: number } | null = null;
  grappleReadyAt = 0;
  private grappleAirUsed = false;
  /** Caméra : creux de réception (ressort), roulis, à-coup du champ de vision, hauteur des yeux. */
  private dip = 0;
  private dipV = 0;
  private roll = 0;
  fovKick = 0;
  private eyeH = 1.6;
  private rayHit = makeRayHit();

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
    this.cancelMoves();
    this.fallTop = y;
    this.unstick();
  }

  /** Interrompt les déplacements spéciaux (mort, véhicule, téléportation). */
  cancelMoves(): void {
    if (this.grapple || this.hook) {
      const a = (this.grapple?.anchor ?? this.hook!.anchor).clone();
      this.grapple = null;
      this.hook = null;
      this.emit('grappleRelease', this.handPos(), a);
    }
    this.mode = 'walk';
    this.mantle = null;
    this.wall = null;
    this.dashT = 0;
    this.leapCharge = 0;
    this.leapCharging = false;
  }

  /** Nouveaux implants : on garde l'état courant dans les nouvelles limites. */
  setMods(m: MoveMods): void {
    const hadDash = this.dashMax;
    this.mods = m;
    this.dashMax = m.dash?.charges ?? 0;
    if (this.dashMax > hadDash) this.dashCharges = this.dashMax;
    this.dashCharges = Math.min(this.dashCharges, this.dashMax);
    if (!m.grapple && (this.grapple || this.hook)) this.cancelMoves();
    if (!m.sprint) this.energy = 1;
  }

  /**
   * Si le joueur chevauche un obstacle (point d'apparition encombré, meuble…), on le
   * dégage vers l'emplacement libre le plus proche (recherche en spirale, 1,5 m au plus).
   */
  unstick(): boolean {
    const h = this.height();
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

  /** Hauteur du sol sous les pieds (recherche vers le bas jusqu'à yMin, 2 m par défaut). */
  private groundBelow(x: number, y: number, z: number, yMin = y - 2): number {
    const x0 = Math.floor((x - HALF) * INV_VOXEL);
    const x1 = Math.floor((x + HALF - 1e-4) * INV_VOXEL);
    const z0 = Math.floor((z - HALF) * INV_VOXEL);
    const z1 = Math.floor((z + HALF - 1e-4) * INV_VOXEL);
    const top = Math.floor(y * INV_VOXEL - 1e-4) + GROUND_VY;
    const bottom = Math.floor(yMin * INV_VOXEL) + GROUND_VY;
    for (let vy = top; vy >= bottom; vy--) {
      for (let vz = z0; vz <= z1; vz++)
        for (let vx = x0; vx <= x1; vx++) if (this.solidVoxel(vx, vy, vz)) return (vy + 1 - GROUND_VY) / INV_VOXEL;
    }
    return -Infinity;
  }

  /** Hauteur de la boîte selon la posture. */
  private height(): number {
    return this.mode === 'slide' ? HEIGHT_SLIDE : this.crouch ? HEIGHT_CROUCH : HEIGHT;
  }

  /** Vitesse horizontale (m/s). */
  hspeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /** Main qui tient le grappin (approximation physique ; l'effet visuel part de la vraie main). */
  handPos(): THREE.Vector3 {
    const side = this.mods.grapple?.side === 'L' ? -1 : 1;
    // droite = (-cos yaw, 0, sin yaw)
    return new THREE.Vector3(
      this.pos.x - Math.cos(this.yaw) * 0.22 * side + Math.sin(this.yaw) * 0.25,
      this.pos.y + HAND_Y,
      this.pos.z + Math.sin(this.yaw) * 0.22 * side + Math.cos(this.yaw) * 0.25,
    );
  }

  private emit(k: MoveEventKind, p: { x: number; y: number; z: number }, p2?: { x: number; y: number; z: number } | null, v?: number, h?: number): void {
    this.onMove?.({ k, x: p.x, y: p.y, z: p.z, x2: p2?.x, y2: p2?.y, z2: p2?.z, v, h });
  }

  // ======================================================================= mise à jour

  update(dt: number, input: Input): void {
    this.t += dt;
    // ----- regard
    const sens = 0.0022 * settings.sensitivity * (this.aiming ? 0.6 / Math.max(1, this.aimZoom * 0.8) : 1);
    if (!this.frozen) {
      this.yaw -= input.mouseDX * sens;
      this.pitch -= input.mouseDY * sens * (settings.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -1.45, 1.35);
      if (input.mouseDX !== 0 || input.mouseDY !== 0) this.lookAt = this.t;
    }
    if (input.hit('view')) this.firstPerson = !this.firstPerson;
    // ----- au volant
    if (this.drive && !this.dead) {
      if (this.mode !== 'walk' || this.hook) this.cancelMoves();
      const d = this.drive;
      this.aiming = !this.frozen && input.is('aim');
      d.update(dt, input, this.frozen);
      this.pos.copy(d.pos);
      const v = d.velocity();
      this.vel.set(v.x, d.vy, v.z);
      this.bodyYaw = d.yaw;
      this.anim = Anim.DRIVE;
      this.onGround = d.onGround;
      this.crouch = false;
      this.sprint = false;
      this.fallTop = this.pos.y;
      // la caméra revient derrière le véhicule quand on ne touche plus à la souris
      if (!this.aiming && this.t - this.lookAt > 1.2 && Math.abs(d.speed) > 2) {
        let diff = d.yaw - this.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.yaw += diff * Math.min(1, dt * 2.5);
        this.pitch += (-0.18 - this.pitch) * Math.min(1, dt * 2);
      }
      if (d.bump > 0.2) this.shake = Math.max(this.shake, d.bump * 3);
      return;
    }
    if (this.dead) {
      if (this.mode !== 'walk' || this.hook) this.cancelMoves();
      this.vel.x *= 0.8;
      this.vel.z *= 0.8;
      this.physics(dt, 1);
      this.anim = Anim.DEAD;
      return;
    }
    let k = NO_INTENT;
    if (!this.frozen && this.t >= this.stunUntil) {
      let fx = 0;
      let fz = 0;
      if (input.is('forward')) fz += 1;
      if (input.is('back')) fz -= 1;
      if (input.is('left')) fx += 1;
      if (input.is('right')) fx -= 1;
      k = {
        fx,
        fz,
        sprint: input.is('sprint'),
        jumpHit: input.hit('jump'),
        jumpHeld: input.is('jump'),
        crouchHit: input.hit('crouch'),
        crouchHeld: input.is('crouch'),
        aim: input.is('aim'),
        dash: input.hit('dash'),
      };
    }
    this.aiming = k.aim && this.mode !== 'mantle' && this.mode !== 'climb';
    this.step(dt, k);
    this.finish(dt);
  }

  /** Une image de déplacement à pied. */
  private step(dt: number, k: Intent): void {
    this.timers(dt);
    // ----- accroupi : appui bref = bascule, appui long = maintenu ; en sprint = glissade
    if (k.crouchHit) {
      this.crouchDownAt = this.t;
      if (this.mode === 'walk' && this.onGround && this.sprint && this.hspeed() > 5 && this.dashT <= 0) this.startSlide();
      else if (this.mode === 'walk') {
        this.crouch = !this.crouch;
        this.forcedCrouch = false;
      }
    }
    if (this.crouchHeld && !k.crouchHeld && this.t - this.crouchDownAt > 0.3 && this.mode === 'walk' && !this.forcedCrouch && !this.leapCharging) this.crouch = false;
    this.crouchHeld = k.crouchHeld;
    if (k.jumpHit) this.jumpBuffer = JUMP_BUFFER;
    if (k.dash) this.tryDash(k);
    switch (this.mode) {
      case 'mantle':
        this.stepMantle(dt);
        break;
      case 'climb':
        this.stepClimb(dt, k);
        break;
      case 'grapple':
        this.stepGrapple(dt, k);
        break;
      case 'wallrun':
        this.stepWallrun(dt, k);
        break;
      case 'slide':
        this.stepSlide(dt, k);
        break;
      default:
        this.stepWalk(dt, k);
    }
    this.stepHook(dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    // hauteur de chute : remise à zéro au sol et pendant les manœuvres qui retiennent le corps
    if (this.onGround || this.mode === 'grapple' || this.mode === 'wallrun' || this.mode === 'climb' || this.mode === 'mantle') this.fallTop = this.pos.y;
    else this.fallTop = Math.max(this.fallTop, this.pos.y);
  }

  private timers(dt: number): void {
    const m = this.mods;
    if (this.onGround) {
      this.coyote = COYOTE;
      this.airTime = 0;
    } else {
      this.coyote = Math.max(0, this.coyote - dt);
      this.airTime += dt;
    }
    this.landT = Math.max(0, this.landT - dt);
    // charges d'esquive
    if (m.dash && this.dashCharges < this.dashMax && this.t >= this.dashNextAt) {
      this.dashCharges++;
      this.dashNextAt = this.dashCharges < this.dashMax ? this.t + m.dash.cd : 0;
    }
    // énergie du sprint cybernétique : se recharge quand on ne s'en sert pas
    if (m.sprint && !this.boosting) {
      this.energyWait -= dt;
      if (this.energyWait <= 0) this.energy = Math.min(1, this.energy + dt / m.sprint.regen);
    }
    this.boosting = false;
  }

  /** Vitesse de sprint : renforcée tant que l'énergie des jambes le permet. */
  private sprintSpeed(dt: number): number {
    const s = this.mods.sprint;
    if (!s || this.energy <= 0) return SPRINT_SPEED;
    this.boosting = true;
    this.energy = Math.max(0, this.energy - dt / s.energy);
    this.energyWait = 0.5;
    return s.speed;
  }

  /** Direction voulue dans le monde (normalisée) d'après les touches, ou null. */
  private wishDir(k: Intent): { x: number; z: number } | null {
    const len = Math.hypot(k.fx, k.fz);
    if (len === 0) return null;
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    // avant = (sin yaw, cos yaw) ; gauche = (cos yaw, -sin yaw)
    return { x: (k.fz * s + k.fx * c) / len, z: (k.fz * c - k.fx * s) / len };
  }

  private accelerate(wx: number, wz: number, a: number): void {
    const dx = wx - this.vel.x;
    const dz = wz - this.vel.z;
    const d = Math.hypot(dx, dz);
    if (d <= a) {
      this.vel.x = wx;
      this.vel.z = wz;
    } else {
      this.vel.x += (dx / d) * a;
      this.vel.z += (dz / d) * a;
    }
  }

  /** En l'air : on ne freine pas l'élan, on l'oriente (le gyroscope y aide). */
  private airAccelerate(wish: { x: number; z: number } | null, speed: number, a: number): void {
    const sp0 = this.hspeed();
    if (!wish) return;
    const proj = this.vel.x * wish.x + this.vel.z * wish.z;
    const add = Math.min(a, speed - proj);
    if (add > 0) {
      this.vel.x += wish.x * add;
      this.vel.z += wish.z * add;
    }
    // élan rapide (grappin, bond) : on l'infléchit doucement vers la direction voulue
    if (sp0 > speed) {
      const turn = Math.min(1, a * 0.05);
      const sp = this.hspeed();
      this.vel.x += (wish.x * sp - this.vel.x) * turn * 0.25;
      this.vel.z += (wish.z * sp - this.vel.z) * turn * 0.25;
    }
    const sp1 = this.hspeed();
    const cap = Math.max(sp0, speed);
    if (sp1 > cap && sp1 > 0) {
      this.vel.x *= cap / sp1;
      this.vel.z *= cap / sp1;
    }
  }

  // ----------------------------------------------------------------------- marche, sauts

  private stepWalk(dt: number, k: Intent): void {
    const m = this.mods;
    const wish = this.wishDir(k);
    // sprint : vers l'avant (diagonales comprises), pas en visant
    this.sprint = k.sprint && k.fz > 0 && !k.aim && !this.leapCharging;
    if (this.sprint && this.crouch && !this.forcedCrouch) this.crouch = false;
    let speed = k.aim ? AIM_SPEED : this.crouch ? CROUCH_SPEED * m.crouch : this.sprint ? this.sprintSpeed(dt) : WALK_SPEED;
    if (k.fz < 0 && !this.sprint) speed *= 0.8;
    speed *= this.speedMul;
    // bond chargé : accroupi et immobile, la touche maintenue comprime les vérins
    const leap = m.leap;
    if (leap && this.onGround && this.crouch && k.crouchHeld && this.t >= this.leapReadyAt && this.hspeed() < 3.2) {
      if (!this.leapCharging) this.emit('leapCharge', this.pos);
      this.leapCharging = true;
      this.leapCharge = Math.min(leap.charge, this.leapCharge + dt);
    } else if (!k.crouchHeld || !this.onGround) {
      this.leapCharging = false;
      this.leapCharge = 0;
    }
    let gmul = 1;
    if (this.dashT > 0) {
      // esquive : poussée rectiligne, sans gravité
      this.dashT -= dt;
      this.vel.x = this.dashDir.x * this.dashSpeed;
      this.vel.z = this.dashDir.z * this.dashSpeed;
      this.vel.y = Math.max(0, this.vel.y * 0.5);
      gmul = 0;
      if (this.dashT <= 0) {
        this.vel.x = this.dashDir.x * this.dashKeep;
        this.vel.z = this.dashDir.z * this.dashKeep;
      }
    } else if (this.onGround) {
      const a = (wish ? 46 : 54) * m.accel;
      this.accelerate(wish ? wish.x * speed : 0, wish ? wish.z * speed : 0, a * dt);
    } else {
      this.airAccelerate(wish, Math.max(speed, WALK_SPEED), 9 * m.air * dt);
      // léger frein de l'air au-delà de la vitesse de sprint
      const sp = this.hspeed();
      if (sp > 12) {
        const f = Math.exp(-dt * 0.12);
        this.vel.x *= f;
        this.vel.z *= f;
      }
      // plané (colonne gyroscopique) : en visant, la chute ralentit
      if (k.aim && this.vel.y < 0 && this.hoverUsed < m.hoverTime) {
        gmul = m.hover;
        this.hoverUsed += dt;
      }
    }
    // saut écourté : relâcher la touche tôt
    if (!this.jumpCut && !k.jumpHeld && this.vel.y > 2) {
      this.vel.y *= 0.55;
      this.jumpCut = true;
    }
    // ----- sauts
    if (this.jumpBuffer > 0 && this.dashT <= 0) {
      if (this.leapCharging && this.leapCharge >= 0.12) this.doLeap();
      else if (this.onGround || this.coyote > 0) {
        // contre un rebord : on s'y hisse ; contre un mur (grip magnétique) : on y grimpe
        if (!(k.fz > 0 && (this.tryMantle(m.mantle, null) || this.tryClimb(k)))) this.doJump();
      } else if (this.airTime > 0.05) {
        if (k.fz > 0 && this.tryMantle(m.mantle, null)) {
          /* on se hisse */
        } else if (this.tryClimb(k)) {
          /* on grimpe */
        } else if (this.tryWallJump()) {
          /* rebond mural */
        } else if (this.airJumps < m.airJumps) this.doAirJump(wish);
      }
    }
    // en l'air contre un rebord, en avançant : on s'y hisse
    if (this.mode === 'walk' && !this.onGround && k.fz > 0 && this.vel.y < 2.5 && this.airTime > 0.1 && this.tryMantle(m.mantle, null)) return;
    if (this.mode !== 'walk') return;
    // course murale : en l'air, vite, le long d'un mur
    if (m.wallrun && !this.onGround && this.airTime > 0.06 && k.fz > 0 && this.dashT <= 0 && this.hspeed() > 4.5 && this.tryWallrun()) return;
    this.physics(dt, gmul);
  }

  private doJump(): void {
    if (this.crouch && !this.collides(this.pos.x, this.pos.y, this.pos.z, HEIGHT)) this.crouch = false;
    if (this.crouch && this.collides(this.pos.x, this.pos.y + 0.3, this.pos.z, HEIGHT_CROUCH)) return;
    this.vel.y = JUMP_V * this.mods.jump;
    this.onGround = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpCut = false;
    this.emit('jump', this.pos);
  }

  private doAirJump(wish: { x: number; z: number } | null): void {
    const m = this.mods;
    this.airJumps++;
    this.jumpBuffer = 0;
    this.jumpCut = true;
    this.vel.y = JUMP_V * m.airPower * (1 + (m.jump - 1) * 0.5);
    if (m.airPush > 0) {
      const d = wish ?? { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
      this.vel.x += d.x * m.airPush;
      this.vel.z += d.z * m.airPush;
    }
    this.airJumpAt = this.t;
    this.fovKick = Math.max(this.fovKick, 0.03);
    this.emit('airJump', this.pos);
  }

  private doLeap(): void {
    const leap = this.mods.leap!;
    const frac = this.leapCharge / leap.charge;
    const angle = clamp(0.5 + this.pitch * 0.55, 0.3, 1.15);
    const { vh, vy } = leapVelocity(leap.dist, frac, angle, GRAVITY);
    const dx = Math.sin(this.yaw);
    const dz = Math.cos(this.yaw);
    this.vel.set(dx * vh, vy, dz * vh);
    this.crouch = this.collides(this.pos.x, this.pos.y, this.pos.z, HEIGHT);
    this.onGround = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpCut = true;
    this.leapReadyAt = this.t + leap.cd;
    this.leapAt = this.t;
    this.leapCharge = 0;
    this.leapCharging = false;
    this.fovKick = Math.max(this.fovKick, 0.08);
    const dist = leap.dist * (0.35 + 0.65 * Math.min(1, frac));
    this.emit('leap', this.pos, { x: this.pos.x + dx * dist, y: this.pos.y, z: this.pos.z + dz * dist }, Math.min(1, frac));
  }

  private tryDash(k: Intent): void {
    const d = this.mods.dash;
    if (!d || this.mode === 'mantle' || this.dashT > 0 || this.dashCharges < 1) return;
    if (!this.onGround && !d.air && this.mode !== 'wallrun') return;
    const wish = this.wishDir(k) ?? { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    if (this.mode === 'grapple') this.releaseGrapple(false);
    if (this.mode !== 'walk') {
      this.mode = 'walk';
      this.wall = null;
      if (!this.collides(this.pos.x, this.pos.y, this.pos.z, HEIGHT)) this.crouch = false;
    }
    this.dashCharges--;
    if (this.dashNextAt <= this.t) this.dashNextAt = this.t + d.cd;
    this.dashDir.set(wish.x, 0, wish.z);
    this.dashSpeed = (d.dist / DASH_TIME) * this.speedMul;
    this.dashKeep = Math.max(this.hspeed() * 0.8, SPRINT_SPEED);
    this.dashT = DASH_TIME;
    this.fovKick = Math.max(this.fovKick, 0.07);
    this.emit('dash', this.pos, { x: this.pos.x + wish.x * d.dist, y: this.pos.y, z: this.pos.z + wish.z * d.dist });
  }

  /** Atterrissage : amorti à la caméra, ralentissement des réceptions lourdes, sauts rendus. */
  private onLand(impact: number): void {
    const fall = this.fallTop - this.pos.y;
    this.airJumps = 0;
    this.wallJumps = 0;
    this.hoverUsed = 0;
    this.grappleAirUsed = false;
    this.lastWallN = null;
    this.climbUsed = 0;
    if (impact > 6) this.dipV -= Math.min(4.5, impact * 0.17);
    if (impact > 12.5) {
      this.landT = 0.24;
      const slow = 1 - 0.5 * this.mods.land;
      this.vel.x *= slow;
      this.vel.z *= slow;
      this.shake = Math.min(3, this.shake + (impact - 12) * 0.1);
    }
    this.emit('land', this.pos, null, impact, fall);
  }

  // --------------------------------------------------------------------------- glissade

  private startSlide(): void {
    const sp = this.hspeed();
    this.slideDir.set(this.vel.x / sp, 0, this.vel.z / sp);
    this.slideSpeed = Math.min(18, Math.max(sp, SPRINT_SPEED) * this.mods.slide.boost);
    this.mode = 'slide';
    this.slideT = 0;
    this.slideAir = 0;
    this.crouch = true;
    this.sprint = false;
    this.fovKick = Math.max(this.fovKick, 0.035);
    this.emit('slide', this.pos, { x: this.pos.x + this.slideDir.x, y: this.pos.y, z: this.pos.z + this.slideDir.z });
  }

  private stepSlide(dt: number, k: Intent): void {
    const s = this.mods.slide;
    this.slideT += dt;
    // on infléchit un peu la trajectoire
    const wish = this.wishDir(k);
    if (wish) {
      const turn = Math.min(1, dt * 2.2);
      this.slideDir.x += (wish.x - this.slideDir.x) * turn * 0.5;
      this.slideDir.z += (wish.z - this.slideDir.z) * turn * 0.5;
      const l = Math.hypot(this.slideDir.x, this.slideDir.z) || 1;
      this.slideDir.x /= l;
      this.slideDir.z /= l;
    }
    if (this.slideT > 0.18) this.slideSpeed *= Math.exp((-dt * 1.4) / Math.max(0.4, s.time));
    this.vel.x = this.slideDir.x * this.slideSpeed;
    this.vel.z = this.slideDir.z * this.slideSpeed;
    // saut en sortie de glissade : l'élan est gardé
    if (this.jumpBuffer > 0 && !this.collides(this.pos.x, this.pos.y, this.pos.z, HEIGHT_CROUCH + 0.1)) {
      this.mode = 'walk';
      this.crouch = this.collides(this.pos.x, this.pos.y, this.pos.z, HEIGHT);
      this.vel.y = JUMP_V * this.mods.jump * s.jump;
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.jumpCut = false;
      this.emit('slideEnd', this.pos);
      this.emit('jump', this.pos);
      return;
    }
    const before = this.hspeed();
    this.physics(dt, 1);
    const after = this.hspeed();
    if (!this.onGround) this.slideAir += dt;
    else this.slideAir = 0;
    const blocked = after < before * 0.5;
    if (this.slideT > s.time || this.slideSpeed < 2.8 || blocked || this.slideAir > 0.15) {
      this.mode = 'walk';
      // on se relève si l'on sprinte encore (et qu'il y a la place)
      if ((k.sprint || this.slideAir > 0.15) && !this.collides(this.pos.x, this.pos.y, this.pos.z, HEIGHT)) this.crouch = false;
      else this.crouch = true;
      this.emit('slideEnd', this.pos);
    }
  }

  // -------------------------------------------------------------------- murs et rebords

  /** Un mur plein dans la direction (ax, az) (axe), à hauteur de hanche et de poitrine ? */
  private wallAt(ax: number, az: number, reach = 0.2): boolean {
    const d = HALF + reach;
    const x = this.pos.x + ax * d;
    const z = this.pos.z + az * d;
    return this.world.solidAt(x, this.pos.y + 0.55, z) && this.world.solidAt(x, this.pos.y + 1.25, z);
  }

  /**
   * Rebord atteignable devant soi (dans la direction dir, sinon le regard) entre une marche et
   * `reach` au-dessus des pieds : on s'y hisse. Renvoie true si l'escalade du rebord commence.
   */
  private tryMantle(reach: number, dir: { x: number; z: number } | null): boolean {
    if (this.mode === 'mantle' || this.dashT > 0) return false;
    const fx = dir ? dir.x : Math.sin(this.yaw);
    const fz = dir ? dir.z : Math.cos(this.yaw);
    const ahead = HALF * 2 + 0.12;
    const tx = this.pos.x + fx * ahead;
    const tz = this.pos.z + fz * ahead;
    // il faut un obstacle juste devant (sinon ce n'est pas un rebord)
    if (!this.world.solidAt(this.pos.x + fx * (HALF + 0.2), this.pos.y + Math.min(reach, 1.1) - 0.3, this.pos.z + fz * (HALF + 0.2)) && !this.world.solidAt(this.pos.x + fx * (HALF + 0.2), this.pos.y + 0.35, this.pos.z + fz * (HALF + 0.2)))
      return false;
    const top = this.groundBelow(tx, this.pos.y + reach + 0.05, tz, this.pos.y + STEP);
    if (!Number.isFinite(top) || top <= this.pos.y + STEP || top > this.pos.y + reach + 0.01) return false;
    // place sur le rebord, et passage libre au-dessus de soi pour monter
    if (this.collides(tx, top + 0.01, tz, HEIGHT_CROUCH)) return false;
    if (this.collides(this.pos.x, this.pos.y + 0.05, this.pos.z, top - this.pos.y + HEIGHT_CROUCH - 0.05)) return false;
    const h = top - this.pos.y;
    this.mantle = { x0: this.pos.x, y0: this.pos.y, z0: this.pos.z, x1: tx, y1: top, z1: tz, t: 0, dur: (0.2 + h * 0.11) / this.mods.mantleSpeed };
    this.mode = 'mantle';
    this.wall = null;
    this.vel.set(0, 0, 0);
    this.jumpBuffer = 0;
    this.emit('mantle', this.pos, { x: tx, y: top, z: tz }, h);
    return true;
  }

  private stepMantle(dt: number): void {
    const mt = this.mantle;
    if (!mt) {
      this.mode = 'walk';
      return;
    }
    mt.t += dt;
    const u = Math.min(1, mt.t / mt.dur);
    // d'abord monter (vite au début), puis avancer sur le rebord
    const up = 1 - Math.pow(1 - Math.min(1, u / 0.65), 2);
    const fwd = u < 0.45 ? 0 : (u - 0.45) / 0.55;
    this.pos.set(mt.x0 + (mt.x1 - mt.x0) * fwd, mt.y0 + (mt.y1 + 0.02 - mt.y0) * up, mt.z0 + (mt.z1 - mt.z0) * fwd);
    this.crouch = true;
    if (u >= 1) {
      this.pos.set(mt.x1, mt.y1, mt.z1);
      this.mantle = null;
      this.mode = 'walk';
      this.onGround = true;
      this.crouch = this.collides(this.pos.x, this.pos.y, this.pos.z, HEIGHT);
      const fx = mt.x1 - mt.x0;
      const fz = mt.z1 - mt.z0;
      const l = Math.hypot(fx, fz) || 1;
      this.vel.set((fx / l) * 2.5, 0, (fz / l) * 2.5);
      this.airJumps = 0;
      this.wallJumps = 0;
      this.grappleAirUsed = false;
      this.climbUsed = 0;
    }
  }

  /** Mur juste en face (axe le plus proche du regard) : normale vers le joueur, ou null. */
  private wallInFront(minCos: number): { nx: number; nz: number } | null {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    let best: { nx: number; nz: number } | null = null;
    let bc = minCos;
    for (const [ax, az] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const c = ax * fx + az * fz;
      if (c > bc && this.wallAt(ax, az, 0.25)) {
        bc = c;
        best = { nx: -ax, nz: -az };
      }
    }
    return best;
  }

  /** Escalade (grip magnétique) : sauter face à un mur pour y grimper. */
  private tryClimb(k: Intent): boolean {
    const m = this.mods;
    if (m.climb <= 0 || this.climbUsed >= m.climb || k.fz <= 0) return false;
    const w = this.wallInFront(0.7);
    if (!w) return false;
    this.climbN = w;
    this.mode = 'climb';
    this.jumpBuffer = 0;
    this.emit('climb', this.pos);
    return true;
  }

  private stepClimb(dt: number, k: Intent): void {
    const m = this.mods;
    const sp = 3.3 * m.climbSpeed;
    this.vel.set(-this.climbN.nx * 0.6, sp, -this.climbN.nz * 0.6);
    this.climbUsed += sp * dt;
    if (this.jumpBuffer > 0) {
      // on se repousse du mur
      this.jumpBuffer = 0;
      this.mode = 'walk';
      this.vel.set(this.climbN.nx * 4.5, JUMP_V * 0.8, this.climbN.nz * 4.5);
      this.emit('wallJump', this.pos, { x: this.pos.x + this.climbN.nx, y: this.pos.y, z: this.pos.z + this.climbN.nz });
      return;
    }
    this.physics(dt, 0);
    if (this.tryMantle(Math.max(m.mantle, 1.2), { x: -this.climbN.nx, z: -this.climbN.nz })) return;
    if (k.fz <= 0 || this.climbUsed >= m.climb || !this.wallAt(-this.climbN.nx, -this.climbN.nz, 0.3) || this.onGround) {
      this.mode = 'walk';
      this.vel.y = Math.min(this.vel.y, 1.5);
    }
  }

  /** Rebond mural (module de saut mural) : contre n'importe quel mur proche. */
  private tryWallJump(): boolean {
    const m = this.mods;
    if (this.wallJumps >= m.wallJumps) return false;
    let n: { nx: number; nz: number } | null = null;
    let best = -2;
    const vx = this.vel.x;
    const vz = this.vel.z;
    const sp = Math.hypot(vx, vz);
    for (const [ax, az] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      if (!this.wallAt(ax, az, 0.3)) continue;
      // de préférence le mur vers lequel on va
      const c = sp > 0.5 ? (ax * vx + az * vz) / sp : 0;
      if (c > best) {
        best = c;
        n = { nx: -ax, nz: -az };
      }
    }
    if (!n) return false;
    this.wallJumps++;
    this.jumpBuffer = 0;
    this.jumpCut = true;
    this.wallJumpFrom(n.nx, n.nz, m.wallPower);
    return true;
  }

  private wallJumpFrom(nx: number, nz: number, power: number): void {
    // on garde l'élan le long du mur, on s'en écarte et on remonte
    const along = this.vel.x * -nz + this.vel.z * nx;
    this.vel.x = nx * 5.5 * power + -nz * along * 0.85;
    this.vel.z = nz * 5.5 * power + nx * along * 0.85;
    this.vel.y = JUMP_V * 1.1 * power * Math.sqrt(this.mods.jump);
    this.lastWallN = { nx, nz };
    this.mode = 'walk';
    this.wall = null;
    this.onGround = false;
    this.fovKick = Math.max(this.fovKick, 0.03);
    this.emit('wallJump', this.pos, { x: this.pos.x + nx, y: this.pos.y, z: this.pos.z + nz });
  }

  /** Course murale : un mur sur le côté, parallèle à la course. */
  private tryWallrun(): boolean {
    const sp = this.hspeed();
    const vx = this.vel.x / sp;
    const vz = this.vel.z / sp;
    let pick: { ax: number; az: number; c: number } | null = null;
    for (const [ax, az] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const c = Math.abs(ax * vx + az * vz);
      if (c > 0.6 || !this.wallAt(ax, az, 0.25)) continue;
      // pas deux fois de suite sur le même mur sans retoucher le sol
      if (this.lastWallN && this.lastWallN.nx === -ax && this.lastWallN.nz === -az) continue;
      if (!pick || c < pick.c) pick = { ax, az, c };
    }
    if (!pick) return false;
    // côté : droite de la course = (-vz, vx)
    const side: 1 | -1 = pick.ax * -vz + pick.az * vx > 0 ? 1 : -1;
    this.wall = { nx: -pick.ax, nz: -pick.az, side, t: 0 };
    this.mode = 'wallrun';
    this.vel.y = Math.max(this.vel.y, 1.2);
    this.airJumps = 0;
    this.emit('wallrun', this.pos, { x: this.pos.x + pick.ax, y: this.pos.y, z: this.pos.z + pick.az }, side);
    return true;
  }

  private stepWallrun(dt: number, k: Intent): void {
    const w = this.wall;
    const wr = this.mods.wallrun;
    if (!w || !wr) {
      this.mode = 'walk';
      return;
    }
    w.t += dt;
    // vitesse le long du mur (tangente)
    let tx = -w.nz;
    let tz = w.nx;
    if (tx * this.vel.x + tz * this.vel.z < 0) {
      tx = -tx;
      tz = -tz;
    }
    const along = Math.max(wr.speed * this.speedMul, (tx * this.vel.x + tz * this.vel.z) * Math.exp(-dt * 0.4));
    this.vel.x = tx * along - w.nx * 1.2;
    this.vel.z = tz * along - w.nz * 1.2;
    if (this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      this.lastWallN = { nx: w.nx, nz: w.nz };
      this.wallJumpFrom(w.nx, w.nz, Math.max(1, this.mods.wallPower));
      return;
    }
    this.physics(dt, wr.grav);
    this.vel.y = Math.max(this.vel.y, -2.2);
    if (w.t > wr.time || k.fz <= 0 || this.onGround || !this.wallAt(-w.nx, -w.nz, 0.35)) {
      this.lastWallN = { nx: w.nx, nz: w.nz };
      this.wall = null;
      this.mode = 'walk';
    }
  }

  // ------------------------------------------------------------------------------ grappin

  /**
   * Touche du bras équipé du grappin : tire le crochet vers le point visé (ou lâche le câble).
   * Renvoie ce qui s'est passé, pour l'interface et les sons.
   */
  fireGrapple(): 'fire' | 'release' | 'busy' | 'cooldown' | 'miss' | 'none' {
    const g = this.mods.grapple;
    if (!g) return 'none';
    if (this.grapple) {
      this.releaseGrapple(false);
      return 'release';
    }
    if (this.hook || this.drive || this.dead || this.mode === 'mantle') return 'busy';
    if (this.t < this.grappleReadyAt) return 'cooldown';
    if (!this.onGround && this.grappleAirUsed && !g.chain) return 'cooldown';
    const { o, d } = this.aimRay();
    const from = this.handPos();
    const dist = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, g.range, this.rayHit, 'solid');
    if (dist < 0) {
      // trop loin : le crochet part au bout du câble et revient
      const end = o.clone().addScaledVector(d, g.range);
      this.hook = { anchor: end, t: 0, travel: g.range / HOOK_SPEED, miss: true };
      this.grappleReadyAt = this.t + 0.6;
      this.emit('grappleMiss', from, end, this.hook.travel);
      return 'miss';
    }
    const h = this.rayHit;
    const anchor = new THREE.Vector3(h.x + h.nx * 0.06, h.y + h.ny * 0.06, h.z + h.nz * 0.06);
    this.hook = { anchor, t: 0, travel: Math.max(0.04, anchor.distanceTo(from) / HOOK_SPEED), miss: false };
    this.grappleReadyAt = this.t + g.cd;
    if (!this.onGround) this.grappleAirUsed = true;
    this.emit('grappleFire', from, anchor, this.hook.travel);
    return 'fire';
  }

  /** Lâche le câble. arrive : arrivé à l'ancre (on tente de se hisser sur le rebord). */
  releaseGrapple(arrive: boolean): void {
    const g = this.grapple;
    if (!g) {
      this.hook = null;
      return;
    }
    this.grapple = null;
    this.mode = 'walk';
    this.grappleAirUsed = true;
    const gm = this.mods.grapple;
    if (arrive) {
      let dx = g.anchor.x - this.pos.x;
      let dz = g.anchor.z - this.pos.z;
      const l = Math.hypot(dx, dz);
      if (l > 0.05) {
        dx /= l;
        dz /= l;
      } else {
        dx = Math.sin(this.yaw);
        dz = Math.cos(this.yaw);
      }
      // arrivé sous un rebord (façade, toit) : on s'y hisse d'un geste ; sinon on se pose en douceur
      const reach = Math.max(this.mods.mantle, g.anchor.y + 1.7 - this.pos.y);
      if (!this.tryMantle(reach, { x: dx, z: dz })) {
        this.vel.y = clamp(this.vel.y, 3, 7);
        this.vel.x *= 0.5;
        this.vel.z *= 0.5;
      }
    } else if (gm) {
      // l'élan est gardé (et renforcé par les meilleurs grappins)
      this.vel.multiplyScalar(gm.boost);
      const sp = this.vel.length();
      if (sp > 36) this.vel.multiplyScalar(36 / sp);
    }
    this.emit('grappleRelease', this.handPos(), g.anchor);
  }

  private stepHook(dt: number): void {
    const h = this.hook;
    if (!h) return;
    h.t += dt;
    if (h.t < h.travel) return;
    this.hook = null;
    if (h.miss || this.dead || this.drive || this.mode === 'mantle' || !this.mods.grapple) return;
    const hand = this.handPos();
    if (this.mode === 'slide' || this.mode === 'wallrun' || this.mode === 'climb') this.wall = null;
    this.grapple = { anchor: h.anchor, len: hand.distanceTo(h.anchor), t: 0, check: 0 };
    this.mode = 'grapple';
    this.dashT = 0;
    this.airJumps = 0;
    this.wallJumps = 0;
    this.hoverUsed = 0;
    this.lastWallN = null;
    if (this.crouch && !this.collides(this.pos.x, this.pos.y, this.pos.z, HEIGHT)) this.crouch = false;
    this.fovKick = Math.max(this.fovKick, 0.05);
    this.emit('grappleAttach', hand, h.anchor);
  }

  private stepGrapple(dt: number, k: Intent): void {
    const g = this.grapple;
    const gm = this.mods.grapple;
    if (!g || !gm) {
      this.mode = 'walk';
      this.grapple = null;
      return;
    }
    g.t += dt;
    const a = g.anchor;
    let dx = a.x - this.pos.x;
    let dy = a.y - (this.pos.y + HAND_Y);
    let dz = a.z - this.pos.z;
    let dist = Math.hypot(dx, dy, dz);
    // arrivé à l'ancre : on se hisse sur le rebord, sinon petit bond
    if (dist < 1.6) {
      this.releaseGrapple(true);
      return;
    }
    // saut : on lâche en gardant l'élan, avec un petit bond
    if (this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      this.releaseGrapple(false);
      this.vel.y = Math.max(this.vel.y, 0) + 4.5;
      this.emit('jump', this.pos);
      return;
    }
    const ux = dx / dist;
    const uy = dy / dist;
    const uz = dz / dist;
    // rembobinage et traction vers l'ancre
    g.len = Math.max(1.2, Math.min(g.len, dist) - gm.pull * 0.9 * dt);
    const pull = 24 + gm.pull * 1.2;
    this.vel.x += ux * pull * dt;
    this.vel.y += uy * pull * dt;
    this.vel.z += uz * pull * dt;
    // pilotage : perpendiculaire au câble
    const wish = this.wishDir(k);
    if (wish) {
      const dot = wish.x * ux + wish.z * uz;
      const steer = (6 + gm.steer * 20) * dt;
      this.vel.x += (wish.x - ux * dot) * steer;
      this.vel.z += (wish.z - uz * dot) * steer;
    }
    // vitesse plafonnée
    const vmax = grappleMaxSpeed(gm.pull) * this.speedMul;
    const sp = this.vel.length();
    if (sp > vmax) this.vel.multiplyScalar(vmax / sp);
    // contre une façade sous l'ancre : on y remonte
    const before = this.hspeed();
    this.physics(dt, 0.7);
    if (this.hspeed() < before * 0.3 && dy > 0.5) this.vel.y = Math.max(this.vel.y, Math.min(vmax * 0.7, 6 + gm.pull * 0.3));
    // câble tendu : il retient (balancement), sans pousser
    dx = a.x - this.pos.x;
    dy = a.y - (this.pos.y + HAND_Y);
    dz = a.z - this.pos.z;
    dist = Math.hypot(dx, dy, dz);
    if (dist > g.len + 0.02) {
      const over = dist - g.len;
      this.moveBy((dx / dist) * over, (dy / dist) * over, (dz / dist) * over);
      const out = -(this.vel.x * dx + this.vel.y * dy + this.vel.z * dz) / dist;
      if (out > 0) {
        this.vel.x += (dx / dist) * out;
        this.vel.y += (dy / dist) * out;
        this.vel.z += (dz / dist) * out;
      }
    }
    // câble coupé par un obstacle, trop long à tenir, ou retombé au sol sous l'ancre
    g.check -= dt;
    if (g.check <= 0) {
      g.check = 0.12;
      const hp = this.handPos();
      const cx = a.x - hp.x;
      const cy = a.y - hp.y;
      const cz = a.z - hp.z;
      const cd = Math.hypot(cx, cy, cz);
      const blocked = cd > 1 && this.world.raycast(hp.x, hp.y, hp.z, cx / cd, cy / cd, cz / cd, cd - 0.7, undefined, 'solid') >= 0;
      if (blocked) {
        this.releaseGrapple(false);
        return;
      }
    }
    if (g.t > 6 || (this.onGround && dy < 0.8)) this.releaseGrapple(false);
  }

  /** Déplacement avec collisions (sans toucher à la vitesse sauf contre un obstacle). */
  private moveBy(dx: number, dy: number, dz: number): void {
    const h = this.height();
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.12));
    for (let i = 0; i < steps; i++) {
      this.moveAxis(dx / steps, 0, h);
      this.moveAxis(0, dz / steps, h);
      const ny = this.pos.y + dy / steps;
      if (!this.collides(this.pos.x, ny, this.pos.z, h)) this.pos.y = ny;
    }
  }

  /** Poussée subie (répulseur, explosion…). */
  impulse(vx: number, vy: number, vz: number): void {
    if (this.grapple) this.releaseGrapple(false);
    if (this.mode !== 'walk') {
      this.mode = 'walk';
      this.wall = null;
      this.mantle = null;
    }
    this.vel.x += vx;
    this.vel.y += vy;
    this.vel.z += vz;
    if (vy > 0.5) this.onGround = false;
  }

  // ------------------------------------------------------------------------------ physique

  /** Gravité (× gmul), déplacement par sous-pas avec collisions, sol et plafond. */
  private physics(dt: number, gmul: number): void {
    let h = this.height();
    // coincé dans le décor (apparition, porte, accessoire) : on se dégage d'abord
    if (this.collides(this.pos.x, this.pos.y, this.pos.z, h) && (h <= HEIGHT_CROUCH || this.collides(this.pos.x, this.pos.y, this.pos.z, HEIGHT_CROUCH))) this.unstick();
    this.vel.y -= GRAVITY * gmul * dt;
    if (this.vel.y < -MAX_FALL) this.vel.y = -MAX_FALL;
    const wasGround = this.onGround;
    const vyBefore = this.vel.y;
    // sous-pas pour ne pas traverser les murs et planchers fins
    const travel = Math.max(Math.abs(this.vel.x), Math.abs(this.vel.z), Math.abs(this.vel.y)) * dt;
    const steps = Math.max(1, Math.ceil(travel / 0.12));
    const sdt = dt / steps;
    let landed = false;
    for (let i = 0; i < steps; i++) {
      this.moveAxis(this.vel.x * sdt, 0, h);
      this.moveAxis(0, this.vel.z * sdt, h);
      const ny = this.pos.y + this.vel.y * sdt;
      if (this.vel.y <= 0) {
        if (this.collides(this.pos.x, ny, this.pos.z, h)) {
          const g = this.groundBelow(this.pos.x, this.pos.y + 0.05, this.pos.z);
          this.pos.y = Number.isFinite(g) && g <= this.pos.y + 0.06 ? g : this.pos.y;
          this.vel.y = 0;
          landed = true;
          break;
        }
        this.pos.y = ny;
      } else if (this.collides(this.pos.x, ny, this.pos.z, h)) {
        this.vel.y = 0;
      } else this.pos.y = ny;
    }
    if (landed) this.onGround = true;
    else if (wasGround && this.vel.y <= 0) {
      // aimantation au sol dans les descentes de marches
      const g = this.groundBelow(this.pos.x, this.pos.y + 0.02, this.pos.z);
      if (Number.isFinite(g) && this.pos.y - g < 0.3 && this.pos.y - g >= 0) {
        this.pos.y = g;
        this.vel.y = 0;
        this.onGround = true;
      } else this.onGround = false;
    } else this.onGround = false;
    if (!wasGround && this.onGround) this.onLand(-vyBefore);
    // pour se relever, il faut de la place
    h = this.height();
    if (this.mode !== 'slide' && this.mode !== 'mantle') {
      if (!this.crouch && this.collides(this.pos.x, this.pos.y, this.pos.z, HEIGHT)) {
        this.crouch = true;
        this.forcedCrouch = true;
      } else if (this.forcedCrouch && !this.collides(this.pos.x, this.pos.y, this.pos.z, HEIGHT)) {
        this.crouch = false;
        this.forcedCrouch = false;
      }
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

  /** Fin d'image : orientation du corps, animation, bruits de pas. */
  private finish(dt: number): void {
    const sp = this.hspeed();
    const moving = sp > 0.3;
    if (this.aiming || moving || this.firstPerson) this.bodyYaw = this.yaw;
    if (this.mode === 'wallrun' || this.mode === 'slide') this.bodyYaw = Math.atan2(this.vel.x, this.vel.z);
    if (this.mode === 'climb') this.bodyYaw = Math.atan2(-this.climbN.nx, -this.climbN.nz);
    this.anim = this.pickAnim(sp);
    // bruits de pas
    if (this.onGround && sp > 0.5 && this.mode === 'walk') {
      this.stepDist += sp * dt;
      const stride = this.sprint ? 1.6 : 1.25;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        const below = this.world.get(Math.floor(this.pos.x * INV_VOXEL), Math.floor(this.pos.y * INV_VOXEL) + GROUND_VY - 1, Math.floor(this.pos.z * INV_VOXEL));
        this.onStep?.(below);
      }
    }
    if (this.onGround && this.mode === 'walk') this.bob += sp * dt * (this.sprint ? 1.3 : 1);
  }

  private pickAnim(sp: number): Anim {
    switch (this.mode) {
      case 'mantle':
      case 'climb':
        return Anim.CLIMB;
      case 'grapple':
        return Anim.GRAPPLE;
      case 'wallrun':
        return this.wall?.side === 1 ? Anim.WALLRUN_R : Anim.WALLRUN_L;
      case 'slide':
        return Anim.SLIDE;
    }
    if (this.dashT > 0) return Anim.DASH;
    if (!this.onGround && this.airTime > 0.12) {
      if (this.t - this.leapAt < 0.6) return Anim.LEAP;
      if (this.t - this.airJumpAt < 0.4) return Anim.AIR_JUMP;
      return Anim.AIR;
    }
    if (this.landT > 0) return Anim.LAND;
    if (this.crouch) return sp > 0.3 ? Anim.CROUCH_WALK : Anim.CROUCH;
    return sp > 4.6 ? Anim.RUN : sp > 0.3 ? Anim.WALK : Anim.IDLE;
  }

  /** État de déplacement pour la vue subjective (bras). */
  moveState(): 'normal' | 'sprint' | 'slide' | 'dash' | 'wallrunL' | 'wallrunR' | 'climb' | 'air' | 'land' | 'grapple' {
    if (this.mode === 'grapple') return 'grapple';
    if (this.mode === 'mantle' || this.mode === 'climb') return 'climb';
    if (this.mode === 'wallrun') return this.wall?.side === 1 ? 'wallrunR' : 'wallrunL';
    if (this.mode === 'slide') return 'slide';
    if (this.dashT > 0) return 'dash';
    if (!this.onGround && this.airTime > 0.12) return 'air';
    if (this.landT > 0) return 'land';
    return this.sprint && this.hspeed() > 4.6 ? 'sprint' : 'normal';
  }

  // ======================================================================= caméra

  /** Place la caméra. */
  updateCamera(dt: number, fovBase: number): void {
    const cam = this.camera;
    if (this.drive && !this.dead) return this.vehicleCamera(dt, fovBase);
    // hauteur des yeux (lissée) : debout, accroupi, en glissade
    const eyeTarget = this.mode === 'slide' ? 0.95 : this.crouch && this.mode !== 'mantle' ? 1.15 : 1.6;
    this.eyeH += (eyeTarget - this.eyeH) * Math.min(1, dt * 14);
    // creux de réception : ressort amorti
    this.dipV += (-this.dip * 110 - this.dipV * 15) * dt;
    this.dip = clamp(this.dip + this.dipV * dt, -0.32, 0.1);
    // champ de vision : vitesse, glissade, grappin, à-coups (esquive, bond)
    const hs = this.hspeed();
    let k: number;
    if (this.aiming) k = (this.weapon === Weapon.RIFLE ? 0.5 : 0.72) / this.aimZoom;
    else {
      k = 1 + clamp((hs - 5.5) / 24, 0, 0.13);
      if (this.mode === 'slide') k += 0.035;
      if (this.mode === 'grapple') k += 0.05;
    }
    this.fovKick *= Math.exp(-dt * 5);
    const targetFov = fovBase * (k + this.fovKick);
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 12);
    cam.updateProjectionMatrix();
    // roulis : course murale (on penche à l'opposé du mur), pas de côté, glissade
    let rollT = 0;
    if (this.mode === 'wallrun' && this.wall) rollT = this.wall.side === 1 ? 0.14 : -0.14;
    else if (this.mode === 'slide') rollT = 0.035;
    else if (this.onGround && hs > 1) {
      const rx = -Math.cos(this.yaw);
      const rz = Math.sin(this.yaw);
      rollT = -((this.vel.x * rx + this.vel.z * rz) / Math.max(4, hs)) * 0.018;
    }
    this.roll += (rollT - this.roll) * Math.min(1, dt * 8);
    const shakeX = (Math.random() - 0.5) * this.shake * 0.04;
    const shakeY = (Math.random() - 0.5) * this.shake * 0.04;
    this.shake *= Math.exp(-dt * 10);
    this.recoil *= Math.exp(-dt * 12);
    const pitch = this.pitch + this.recoil * 0.05;
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.yaw) * Math.cos(pitch));
    if (this.firstPerson) {
      const walking = this.onGround && this.mode === 'walk';
      const bobY = walking ? Math.sin(this.bob * 2.4) * 0.025 : 0;
      const bobX = walking ? Math.cos(this.bob * 1.2) * 0.012 : 0;
      const rx = -Math.cos(this.yaw);
      const rz = Math.sin(this.yaw);
      cam.position.set(this.pos.x + shakeX + rx * bobX, this.pos.y + this.eyeH + 0.04 + bobY + shakeY + this.dip, this.pos.z + rz * bobX);
      // légèrement en avant pour ne pas voir l'intérieur de la tête
      cam.position.addScaledVector(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 0.12);
      cam.lookAt(cam.position.clone().add(dir));
      if (Math.abs(this.roll) > 1e-4) cam.rotateZ(this.roll);
      return;
    }
    const fast = clamp((hs - 6) / 18, 0, 1);
    const wantDist = this.aiming ? 1.55 : 3.1 * (1 + fast * 0.22) + (this.mode === 'grapple' ? 0.5 : 0);
    const wantShoulder = this.aiming ? 0.62 : 0.5;
    this.camDist += (wantDist - this.camDist) * Math.min(1, dt * 10);
    this.camShoulder += (wantShoulder - this.camShoulder) * Math.min(1, dt * 10);
    const pivot = new THREE.Vector3(this.pos.x, this.pos.y + this.eyeH + 0.05 + this.dip * 0.6, this.pos.z);
    // épaule droite : droite = (-cos yaw, 0, sin yaw)
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const shoulderPt = pivot.clone().addScaledVector(right, this.camShoulder);
    // collision épaule
    const sh = this.castCamera(pivot, shoulderPt);
    const want = sh.clone().addScaledVector(dir, -this.camDist);
    const p = this.castCamera(sh, want);
    cam.position.set(p.x + shakeX, p.y + shakeY, p.z);
    cam.lookAt(cam.position.clone().add(dir));
    if (Math.abs(this.roll) > 1e-4) cam.rotateZ(this.roll * 0.5);
  }

  /** Caméra de poursuite derrière le véhicule (ou vue du cockpit). */
  private vehicleCamera(dt: number, fovBase: number): void {
    const cam = this.camera;
    const d = this.drive!;
    const sp = Math.abs(d.speed);
    const targetFov = this.aiming ? fovBase * 0.8 : fovBase * (1 + Math.min(0.12, sp / 250));
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 6);
    cam.updateProjectionMatrix();
    const shakeX = (Math.random() - 0.5) * this.shake * 0.05;
    const shakeY = (Math.random() - 0.5) * this.shake * 0.05;
    this.shake *= Math.exp(-dt * 8);
    this.recoil *= Math.exp(-dt * 12);
    this.roll = 0;
    const pitch = this.pitch + this.recoil * 0.05;
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.yaw) * Math.cos(pitch));
    const size = d.def.size;
    if (this.firstPerson) {
      // place du conducteur : un peu à gauche, à hauteur des yeux
      const s = Math.sin(d.yaw);
      const c = Math.cos(d.yaw);
      const left = d.def.cls === 'moto' ? 0 : size[0] * 0.22;
      const fwd = d.def.cls === 'moto' ? -0.15 : size[2] * 0.05;
      const eye = d.def.cls === 'moto' ? 1.45 : Math.min(size[1] - 0.25, 1.2);
      cam.position.set(d.pos.x + c * left + s * fwd + shakeX, d.pos.y + eye + shakeY, d.pos.z - s * left + c * fwd);
      cam.lookAt(cam.position.clone().add(dir));
      return;
    }
    const dist = (this.aiming ? 2.2 : 3.4) + size[2] * 0.75;
    const pivot = new THREE.Vector3(d.pos.x, d.pos.y + size[1] + 0.55, d.pos.z);
    const want = pivot.clone().addScaledVector(dir, -dist);
    const p = this.castCamera(pivot, want);
    this.camDist = p.distanceTo(pivot);
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
    if ((this.crouch || this.mode === 'slide') && !this.drive) f |= FLAG.CROUCH;
    if (this.drive) f |= FLAG.VEHICLE;
    else if (!this.onGround) f |= INPUT_AIR;
    return f;
  }
}
