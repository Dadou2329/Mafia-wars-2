// Modificateurs de déplacement tirés des implants installés (jambes, colonne, grappin, grip).
// Partagé : le client s'en sert pour se déplacer, le serveur pour valider les vitesses.

import { implantParams, SLOTS, type Equipment } from './implants';

export interface MoveMods {
  /** Vitesse de saut (×). */
  jump: number;
  /** Sauts en l'air, leur puissance (×) et leur poussée horizontale (m/s). */
  airJumps: number;
  airPower: number;
  airPush: number;
  /** Bond chargé : distance (m), temps de charge complète (s), recharge (s). */
  leap: { dist: number; charge: number; cd: number } | null;
  /** Sprint cybernétique : vitesse (m/s), durée de l'énergie (s), recharge complète (s). */
  sprint: { speed: number; energy: number; regen: number } | null;
  /** Esquive : distance (m), charges, recharge d'une charge (s), utilisable en l'air. */
  dash: { dist: number; charges: number; cd: number; air: boolean } | null;
  /** Glissade (existe sans implant) : vitesse au départ (×), durée (s), précision (0..1), saut en sortie (×). */
  slide: { boost: number; time: number; aim: number; jump: number };
  /** Course murale : durée (s), vitesse (m/s), gravité (×). */
  wallrun: { time: number; speed: number; grav: number } | null;
  /** Rebonds muraux avant de retoucher le sol, et leur puissance (×). */
  wallJumps: number;
  wallPower: number;
  /** Contrôle en l'air (×), gravité en planant (×, 1 = aucun plané) et durée du plané (s). */
  air: number;
  hover: number;
  hoverTime: number;
  /** Accélération (×) et ralentissement à la réception (×, 0 = aucun). */
  accel: number;
  land: number;
  /** Vitesse accroupi (×), vitesse pour se hisser (×), roulade à la réception. */
  crouch: number;
  mantleSpeed: number;
  roll: boolean;
  /** Hauteur de rebord atteignable (m au-dessus des pieds), escalade d'un mur (m) et sa vitesse (×). */
  mantle: number;
  climb: number;
  climbSpeed: number;
  /** Grappin (bras où il est installé). */
  grapple: { range: number; pull: number; cd: number; steer: number; chain: boolean; boost: number; yank: boolean; side: 'L' | 'R' } | null;
  /** Volume des pas (×). */
  steps: number;
  /** Multiplicateur des recharges (accumulateur, coprocesseur). */
  cdMul: number;
}

/** Hauteur de rebord atteignable sans implant (m au-dessus des pieds). */
export const BASE_MANTLE = 1.55;
/** Vitesses de base (m/s). */
export const WALK_SPEED = 4.2;
export const SPRINT_SPEED = 6.4;
export const CROUCH_SPEED = 1.8;
export const AIM_SPEED = 2.6;
/** Durée d'une esquive (s). */
export const DASH_TIME = 0.2;

export function baseMods(): MoveMods {
  return {
    jump: 1,
    airJumps: 0,
    airPower: 1,
    airPush: 0,
    leap: null,
    sprint: null,
    dash: null,
    slide: { boost: 1.12, time: 0.7, aim: 0, jump: 1 },
    wallrun: null,
    wallJumps: 0,
    wallPower: 1,
    air: 1,
    hover: 1,
    hoverTime: 0,
    accel: 1,
    land: 1,
    crouch: 1,
    mantleSpeed: 1,
    roll: false,
    mantle: BASE_MANTLE,
    climb: 0,
    climbSpeed: 1,
    grapple: null,
    steps: 1,
    cdMul: 1,
  };
}

/** Modificateurs d'après les implants installés (equip) et leurs niveaux (owned). */
export function moveMods(equip: Equipment, owned: Record<string, number>): MoveMods {
  const m = baseMods();
  const lv = (id: string): number => {
    for (const s of SLOTS) if (equip[s.id] === id) return owned[id] ?? 0;
    return 0;
  };
  const P = (id: string): Record<string, number> | null => {
    const l = lv(id);
    return l > 0 ? implantParams(id, l) : null;
  };
  const acc = P('accumulateur');
  const cop = P('coprocesseur');
  m.cdMul = 1 - Math.min(0.35, (acc?.cdr ?? 0) + (cop?.cdr ?? 0));
  const saut = P('saut');
  if (saut) m.jump = saut.jump;
  const ds = P('doubleSaut');
  if (ds) {
    m.airJumps = ds.air;
    m.airPower = ds.power;
    m.airPush = ds.push;
  }
  const bond = P('bond');
  if (bond) m.leap = { dist: bond.dist, charge: bond.charge, cd: bond.cd * m.cdMul };
  const sp = P('sprint');
  // l'accumulateur cardiaque prolonge le sprint renforcé
  if (sp) m.sprint = { speed: sp.speed, energy: sp.energy * (acc?.energy ?? 1), regen: sp.regen };
  const esq = P('esquive');
  if (esq) m.dash = { dist: esq.dist, charges: esq.charges, cd: esq.cd * m.cdMul, air: esq.air > 0 };
  const gl = P('glissade');
  if (gl) m.slide = { boost: gl.boost, time: gl.time, aim: gl.aim, jump: gl.jump };
  const cm = P('courseMurale');
  if (cm) m.wallrun = { time: cm.time, speed: cm.speed, grav: cm.grav };
  const sm = P('sautMural');
  if (sm) {
    m.wallJumps = sm.jumps;
    m.wallPower = sm.power;
  }
  const gy = P('gyro');
  if (gy) {
    m.air = gy.air;
    m.hover = gy.hover;
    m.hoverTime = gy.hoverTime;
  }
  const rm = P('reflexesMoteurs');
  if (rm) {
    m.accel = rm.accel;
    m.land = rm.land;
  }
  const vt = P('vertebres');
  if (vt) {
    m.crouch = vt.crouch;
    m.mantleSpeed = vt.mantle;
    m.roll = vt.roll > 0;
  }
  const grip = P('grip');
  if (grip) {
    m.mantle = Math.max(BASE_MANTLE, grip.mantle);
    m.climb = grip.climb;
    m.climbSpeed = grip.speed;
  }
  const si = P('silence');
  if (si) m.steps = si.steps;
  // grappin : sur l'un des bras ; le treuil spinal le renforce
  const side = equip.brasG === 'grappin' ? 'L' : equip.brasD === 'grappin' ? 'R' : null;
  const gr = P('grappin');
  if (gr && side) {
    const tr = P('treuil');
    m.grapple = {
      range: gr.range * (tr?.range ?? 1),
      pull: gr.pull * (tr?.pull ?? 1),
      cd: gr.cd * m.cdMul,
      steer: gr.steer,
      chain: gr.chain > 0,
      boost: gr.boost,
      yank: (tr?.yank ?? 0) > 0,
      side,
    };
  }
  return m;
}

/** Vitesse maximale du grappin (m/s) : la traction, plafonnée pour rester lisible. */
export function grappleMaxSpeed(pull: number): number {
  return Math.min(32, pull * 1.25 + 6);
}

/** Vitesses du bond chargé : distance au sol plat pour une charge frac (0..1) et un angle (rad). */
export function leapVelocity(dist: number, frac: number, angle: number, gravity: number): { vh: number; vy: number } {
  const d = dist * (0.35 + 0.65 * Math.max(0, Math.min(1, frac)));
  const v = Math.sqrt((d * gravity) / Math.max(0.2, Math.sin(2 * angle)));
  return { vh: v * Math.cos(angle), vy: v * Math.sin(angle) };
}
