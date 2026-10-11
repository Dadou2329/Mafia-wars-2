/**
 * Registre des bruitages : fonction de synthèse ou banque précalculée,
 * niveau, priorité de vol de voix, nombre maximal d'instances, envoi de
 * réverbération, profil spatial et bascule vers une version lointaine.
 *
 * Anciens noms (premier jeu, Londres 1888) conservés pour ne rien casser :
 * revolver → pistolet, rifle → fusil électromagnétique, police_whistle →
 * sirène, horse_clop → pulsation de sustentation, carriage_wheels → voiture
 * volante qui passe, neigh → klaxon.
 */
import type { BankName } from './resources';
import * as C from './sfx_combat';
import type { SfxCtx } from './sfx_combat';
import * as M from './sfx_misc';
import * as Y from './sfx_cyber';
import * as U from './sfx_ui';
import type { SfxName } from './types';

export interface SpatialProfile {
  /** refDistance du PannerNode (m). */
  ref: number;
  /** rolloffFactor du PannerNode (modèle inverse). */
  rolloff: number;
  /** Au-delà de cette distance (m), le son n'est pas joué du tout. */
  cull: number;
  /** Panoramique HRTF (s'il est activé globalement) ; sinon puissance constante, économique. */
  hrtf: boolean;
}

export type SynthFn = (s: SfxCtx) => number;

export interface SfxDef {
  /** Synthèse par nœuds (ignorée si `bank` est défini). */
  synth: SynthFn;
  /** Banque de variantes précalculées (une seule source tampon par lecture). */
  bank?: BankName;
  /** Gain linéaire de base. */
  gain: number;
  /** Priorité de vol de voix 0..10 (la plus haute survit). */
  priority: number;
  /** Nombre maximal d'instances simultanées de ce nom (la plus ancienne est coupée). */
  maxInst: number;
  /** Envoi de réverbération 0..1 (rue/tunnel ou pièce). */
  send: number;
  /** Profil spatial utilisé quand une position est donnée ; null = toujours 2D. */
  spatial: SpatialProfile | null;
  /** Bascule automatique vers un rendu lointain au-delà de `dist` mètres (gain relatif `gain`). */
  far?: { dist: number; synth?: SynthFn; bank?: BankName; gain?: number };
  /** Pas : pas de filtre d'absorption de l'air (toujours proches). */
  step?: boolean;
}

const GUN: SpatialProfile = { ref: 6, rolloff: 0.9, cull: 320, hrtf: true };
const HEAVY: SpatialProfile = { ref: 10, rolloff: 0.7, cull: 600, hrtf: true };
const MELEE: SpatialProfile = { ref: 2, rolloff: 1.3, cull: 45, hrtf: true };
const IMPACT: SpatialProfile = { ref: 2.5, rolloff: 1.1, cull: 70, hrtf: true };
const SHATTER: SpatialProfile = { ref: 3, rolloff: 1, cull: 110, hrtf: true };
const STEP: SpatialProfile = { ref: 1.5, rolloff: 1.6, cull: 26, hrtf: false };
const FOLEY: SpatialProfile = { ref: 1.5, rolloff: 1.4, cull: 30, hrtf: true };
const VOICE: SpatialProfile = { ref: 2, rolloff: 1.1, cull: 55, hrtf: true };
const RADIO: SpatialProfile = { ref: 2, rolloff: 1.2, cull: 45, hrtf: true };
const VEHICLE: SpatialProfile = { ref: 5, rolloff: 0.9, cull: 160, hrtf: true };
const HORN: SpatialProfile = { ref: 6, rolloff: 0.8, cull: 250, hrtf: true };
const SIREN: SpatialProfile = { ref: 10, rolloff: 0.7, cull: 400, hrtf: true };
const TRAIN: SpatialProfile = { ref: 12, rolloff: 0.6, cull: 300, hrtf: false };
const BUILDING: SpatialProfile = { ref: 3, rolloff: 1, cull: 60, hrtf: false };
const REWARD: SpatialProfile = { ref: 3, rolloff: 1, cull: 50, hrtf: false };
const SIGNAL: SpatialProfile = { ref: 12, rolloff: 0.7, cull: 250, hrtf: false };
/* Implants : bruitages proches (servos), capacités (jets, bouclier), chocs lourds. */
const CY_FOLEY: SpatialProfile = { ref: 3, rolloff: 1.2, cull: 50, hrtf: true };
const CY_ACT: SpatialProfile = { ref: 5, rolloff: 1, cull: 110, hrtf: true };
const CY_HEAVY: SpatialProfile = { ref: 8, rolloff: 0.8, cull: 260, hrtf: true };

const noop: SynthFn = (s) => s.t;

/* Armes à feu : banques précalculées. */
const PISTOL: SfxDef = { synth: noop, bank: 'pistol', gain: 1.05, priority: 8, maxInst: 10, send: 0.5, spatial: GUN, far: { dist: 70, bank: 'pistol_far', gain: 1.5 } };
const PISTOL_FAR: SfxDef = { synth: noop, bank: 'pistol_far', gain: 0.8, priority: 6, maxInst: 8, send: 0.7, spatial: GUN };
const RAIL: SfxDef = { synth: noop, bank: 'rail', gain: 1.05, priority: 8, maxInst: 8, send: 0.6, spatial: GUN, far: { dist: 90, bank: 'rail_far', gain: 1.4 } };
const RAIL_FAR: SfxDef = { synth: noop, bank: 'rail_far', gain: 0.75, priority: 6, maxInst: 8, send: 0.7, spatial: GUN };

const hoverPassQuiet: SynthFn = (s) => M.hoverPass({ ...s, p: s.p * 0.92 });

export const SFX: Record<SfxName, SfxDef> = {
  pistol: PISTOL,
  pistol_far: PISTOL_FAR,
  smg: { synth: noop, bank: 'smg', gain: 0.85, priority: 8, maxInst: 16, send: 0.4, spatial: GUN, far: { dist: 70, bank: 'smg_far', gain: 1.4 } },
  smg_far: { synth: noop, bank: 'smg_far', gain: 0.7, priority: 6, maxInst: 12, send: 0.6, spatial: GUN },
  railgun: RAIL,
  rail_far: RAIL_FAR,
  shotgun: { synth: noop, bank: 'shotgun', gain: 0.75, priority: 8, maxInst: 8, send: 0.55, spatial: GUN, far: { dist: 75, bank: 'shotgun_far', gain: 1.4 } },
  turret_fire: { synth: noop, bank: 'turret', gain: 0.7, priority: 8, maxInst: 12, send: 0.45, spatial: GUN, far: { dist: 80, bank: 'turret_far', gain: 1.4 } },
  revolver: PISTOL,
  revolver_far: PISTOL_FAR,
  rifle: RAIL,
  rifle_far: RAIL_FAR,

  punch: { synth: C.punch, gain: 0.8, priority: 7, maxInst: 6, send: 0.12, spatial: MELEE },
  knife: { synth: C.knife, gain: 0.75, priority: 7, maxInst: 6, send: 0.1, spatial: MELEE },
  thermal_knife: { synth: C.thermalKnife, gain: 0.6, priority: 7, maxInst: 4, send: 0.12, spatial: MELEE },
  club: { synth: C.club, gain: 0.85, priority: 7, maxInst: 6, send: 0.12, spatial: MELEE },
  stun_baton: { synth: C.stunBaton, gain: 0.75, priority: 7, maxInst: 4, send: 0.12, spatial: MELEE },
  swing: { synth: C.swing, gain: 0.7, priority: 5, maxInst: 6, send: 0.05, spatial: MELEE },

  hit_flesh: { synth: C.hitFlesh, gain: 0.7, priority: 6, maxInst: 8, send: 0.1, spatial: IMPACT },
  hit_wall: { synth: C.hitWall, gain: 1.4, priority: 5, maxInst: 8, send: 0.2, spatial: IMPACT },
  hit_wood: { synth: C.hitWood, gain: 0.85, priority: 5, maxInst: 8, send: 0.2, spatial: IMPACT },
  hit_metal: { synth: C.hitMetal, gain: 0.55, priority: 5, maxInst: 6, send: 0.2, spatial: IMPACT },
  ricochet: { synth: C.ricochet, gain: 0.5, priority: 5, maxInst: 4, send: 0.25, spatial: IMPACT },
  glass: { synth: C.glass, gain: 0.8, priority: 6, maxInst: 3, send: 0.2, spatial: IMPACT },
  glass_break: { synth: C.glassBreak, gain: 0.75, priority: 7, maxInst: 2, send: 0.3, spatial: SHATTER },
  explosion: { synth: C.explosion, gain: 0.9, priority: 9, maxInst: 3, send: 0.6, spatial: HEAVY },

  reload: { synth: C.reload, gain: 0.6, priority: 6, maxInst: 3, send: 0.05, spatial: FOLEY },
  empty_click: { synth: C.emptyClick, gain: 1.5, priority: 6, maxInst: 3, send: 0.03, spatial: FOLEY },
  weapon_switch: { synth: C.weaponSwitch, gain: 0.9, priority: 6, maxInst: 3, send: 0.03, spatial: FOLEY },

  // Les pas rejouent des variantes précalculées.
  footstep_stone: { synth: noop, bank: 'step_stone', gain: 0.45, priority: 2, maxInst: 8, send: 0, spatial: STEP, step: true },
  footstep_concrete: { synth: noop, bank: 'step_concrete', gain: 0.45, priority: 2, maxInst: 8, send: 0, spatial: STEP, step: true },
  footstep_metal: { synth: noop, bank: 'step_metal', gain: 0.2, priority: 2, maxInst: 8, send: 0.05, spatial: STEP, step: true },
  footstep_wood: { synth: noop, bank: 'step_wood', gain: 0.45, priority: 2, maxInst: 8, send: 0, spatial: STEP, step: true },
  footstep_carpet: { synth: noop, bank: 'step_carpet', gain: 0.4, priority: 2, maxInst: 8, send: 0, spatial: STEP, step: true },

  pain: { synth: M.pain, gain: 0.7, priority: 6, maxInst: 6, send: 0.15, spatial: VOICE },
  death: { synth: M.death, gain: 0.22, priority: 7, maxInst: 4, send: 0.15, spatial: VOICE },

  ui_click: { synth: U.uiClick, gain: 1.0, priority: 9, maxInst: 4, send: 0, spatial: null },
  ui_hover: { synth: U.uiHover, gain: 1.5, priority: 8, maxInst: 3, send: 0, spatial: null },
  ui_open: { synth: U.uiOpen, gain: 0.7, priority: 9, maxInst: 2, send: 0, spatial: null },
  ui_close: { synth: U.uiClose, gain: 0.7, priority: 9, maxInst: 2, send: 0, spatial: null },
  ui_error: { synth: U.uiError, gain: 0.3, priority: 9, maxInst: 2, send: 0, spatial: null },
  paper: { synth: U.paper, gain: 0.7, priority: 8, maxInst: 3, send: 0, spatial: REWARD },
  phone_open: { synth: U.phoneOpen, gain: 0.9, priority: 9, maxInst: 2, send: 0, spatial: null },
  phone_close: { synth: U.phoneClose, gain: 1.3, priority: 9, maxInst: 2, send: 0, spatial: null },
  phone_notify: { synth: U.phoneNotify, gain: 0.8, priority: 9, maxInst: 2, send: 0, spatial: null },
  hack_beep: { synth: U.hackBeep, gain: 1.6, priority: 8, maxInst: 4, send: 0, spatial: REWARD },
  hack_success: { synth: U.hackSuccess, gain: 0.8, priority: 9, maxInst: 2, send: 0.05, spatial: REWARD },
  hack_fail: { synth: U.hackFail, gain: 0.5, priority: 9, maxInst: 2, send: 0.05, spatial: REWARD },

  cash: { synth: U.cash, gain: 0.5, priority: 9, maxInst: 3, send: 0.05, spatial: REWARD },
  purchase: { synth: U.purchase, gain: 0.7, priority: 9, maxInst: 3, send: 0.05, spatial: REWARD },
  recruit: { synth: U.recruit, gain: 0.6, priority: 9, maxInst: 3, send: 0.05, spatial: REWARD },
  move_in: { synth: U.moveIn, gain: 0.55, priority: 10, maxInst: 1, send: 0.2, spatial: REWARD },
  heist_success: { synth: U.heistSuccess, gain: 0.38, priority: 10, maxInst: 1, send: 0.2, spatial: REWARD },

  capture: { synth: U.capture, gain: 0.3, priority: 10, maxInst: 2, send: 0.15, spatial: SIGNAL },
  territory_lost: { synth: U.territoryLost, gain: 0.22, priority: 10, maxInst: 2, send: 0.15, spatial: SIGNAL },
  alert: { synth: U.alert, gain: 0.8, priority: 10, maxInst: 2, send: 0.1, spatial: SIGNAL },
  notify: { synth: U.notify, gain: 1.0, priority: 9, maxInst: 2, send: 0.05, spatial: SIGNAL },
  victory: { synth: U.victorySting, gain: 0.3, priority: 10, maxInst: 1, send: 0.2, spatial: null },
  defeat: { synth: U.defeatSting, gain: 0.28, priority: 10, maxInst: 1, send: 0.2, spatial: null },

  door_open: { synth: M.doorOpen, gain: 0.45, priority: 5, maxInst: 3, send: 0.15, spatial: FOLEY },
  door_close: { synth: M.doorClose, gain: 0.18, priority: 5, maxInst: 3, send: 0.15, spatial: FOLEY },
  elevator_ding: { synth: M.elevatorDing, gain: 0.6, priority: 6, maxInst: 2, send: 0.25, spatial: BUILDING },
  alarm_burst: { synth: M.alarmBurst, gain: 0.6, priority: 8, maxInst: 2, send: 0.35, spatial: SIREN },

  police_siren: { synth: M.policeSiren, gain: 0.55, priority: 7, maxInst: 2, send: 0.35, spatial: SIREN },
  police_radio: { synth: M.policeRadio, gain: 0.35, priority: 6, maxInst: 2, send: 0.1, spatial: RADIO },

  car_horn: { synth: M.carHorn, gain: 0.5, priority: 5, maxInst: 3, send: 0.3, spatial: HORN },
  hover_pass: { synth: M.hoverPass, gain: 0.55, priority: 4, maxInst: 4, send: 0.2, spatial: VEHICLE },
  drone_pass: { synth: M.dronePass, gain: 1.0, priority: 4, maxInst: 3, send: 0.15, spatial: VEHICLE },
  subway_train: { synth: M.subwayTrain, gain: 0.6, priority: 5, maxInst: 2, send: 0.4, spatial: TRAIN },
  vehicle_door: { synth: M.vehicleDoor, gain: 0.35, priority: 5, maxInst: 3, send: 0.1, spatial: FOLEY },
  vehicle_crash: { synth: C.vehicleCrash, gain: 0.7, priority: 8, maxInst: 3, send: 0.4, spatial: HORN },

  police_whistle: { synth: M.policeSiren, gain: 0.5, priority: 7, maxInst: 2, send: 0.35, spatial: SIREN },
  horse_clop: { synth: M.hoverThrum, gain: 0.5, priority: 3, maxInst: 6, send: 0.1, spatial: VEHICLE },
  carriage_wheels: { synth: hoverPassQuiet, gain: 0.35, priority: 3, maxInst: 3, send: 0.15, spatial: VEHICLE },
  neigh: { synth: M.carHorn, gain: 0.4, priority: 4, maxInst: 2, send: 0.3, spatial: HORN },

  // implants cybernétiques (sfx_cyber.ts)
  grapple_fire: { synth: Y.grappleFire, gain: 0.85, priority: 7, maxInst: 3, send: 0.2, spatial: CY_ACT },
  grapple_hit: { synth: Y.grappleHit, gain: 1.0, priority: 7, maxInst: 3, send: 0.3, spatial: CY_ACT },
  grapple_release: { synth: Y.grappleRelease, gain: 1.0, priority: 6, maxInst: 3, send: 0.1, spatial: CY_FOLEY },
  winch_yank: { synth: Y.winchYank, gain: 0.42, priority: 7, maxInst: 2, send: 0.2, spatial: CY_ACT },
  arm_deploy: { synth: Y.armDeploy, gain: 0.45, priority: 6, maxInst: 3, send: 0.05, spatial: CY_FOLEY },
  arm_retract: { synth: Y.armRetract, gain: 0.38, priority: 6, maxInst: 3, send: 0.05, spatial: CY_FOLEY },
  arm_pistol: { synth: Y.armPistol, gain: 1.15, priority: 8, maxInst: 8, send: 0.5, spatial: GUN, far: { dist: 70, synth: Y.armPistolFar, gain: 1.4 } },
  arm_pistol_far: { synth: Y.armPistolFar, gain: 0.8, priority: 6, maxInst: 6, send: 0.7, spatial: GUN },
  blade_slash: { synth: Y.bladeSlash, gain: 0.9, priority: 7, maxInst: 4, send: 0.1, spatial: MELEE },
  blade_hit: { synth: Y.bladeHit, gain: 1.0, priority: 7, maxInst: 4, send: 0.1, spatial: MELEE },
  fist_heavy: { synth: Y.fistHeavy, gain: 0.66, priority: 8, maxInst: 3, send: 0.25, spatial: CY_HEAVY },
  fist_charge: { synth: Y.fistCharge, gain: 0.7, priority: 6, maxInst: 2, send: 0.05, spatial: CY_FOLEY },
  whip_crack: { synth: Y.whipCrack, gain: 0.9, priority: 7, maxInst: 3, send: 0.2, spatial: CY_ACT },
  shield_up: { synth: Y.shieldUp, gain: 0.37, priority: 7, maxInst: 2, send: 0.15, spatial: CY_ACT },
  shield_hit: { synth: Y.shieldHit, gain: 1.0, priority: 7, maxInst: 6, send: 0.15, spatial: CY_ACT },
  shield_break: { synth: Y.shieldBreak, gain: 0.7, priority: 8, maxInst: 2, send: 0.3, spatial: CY_HEAVY },
  shield_down: { synth: Y.shieldDown, gain: 0.75, priority: 6, maxInst: 2, send: 0.1, spatial: CY_ACT },
  repulsor: { synth: Y.repulsor, gain: 0.55, priority: 8, maxInst: 2, send: 0.35, spatial: CY_HEAVY },
  shock_zap: { synth: Y.shockZap, gain: 1.15, priority: 8, maxInst: 3, send: 0.25, spatial: CY_HEAVY },
  emp_burst: { synth: Y.empBurst, gain: 0.5, priority: 8, maxInst: 2, send: 0.35, spatial: CY_HEAVY },
  rocket_launch: { synth: Y.rocketLaunch, gain: 0.85, priority: 7, maxInst: 6, send: 0.3, spatial: CY_HEAVY },
  rocket_hit: { synth: Y.rocketHit, gain: 0.68, priority: 9, maxInst: 4, send: 0.55, spatial: HEAVY },
  dash_whoosh: { synth: Y.dashWhoosh, gain: 0.9, priority: 7, maxInst: 3, send: 0.15, spatial: CY_ACT },
  jump_thrust: { synth: Y.jumpThrust, gain: 0.8, priority: 6, maxInst: 3, send: 0.12, spatial: CY_ACT },
  leap_charge: { synth: Y.leapCharge, gain: 0.8, priority: 5, maxInst: 2, send: 0.05, spatial: CY_FOLEY },
  leap_launch: { synth: Y.leapLaunch, gain: 0.57, priority: 7, maxInst: 2, send: 0.25, spatial: CY_HEAVY },
  slide_start: { synth: Y.slideStart, gain: 0.9, priority: 5, maxInst: 2, send: 0.08, spatial: CY_FOLEY },
  wallrun_step: { synth: Y.wallrunStep, gain: 0.7, priority: 3, maxInst: 4, send: 0.05, spatial: STEP, step: true },
  mantle_grab: { synth: Y.mantleGrab, gain: 0.9, priority: 5, maxInst: 2, send: 0.05, spatial: CY_FOLEY },
  land_heavy: { synth: Y.landHeavy, gain: 0.55, priority: 7, maxInst: 3, send: 0.2, spatial: CY_ACT },
  ground_quake: { synth: Y.groundQuake, gain: 0.68, priority: 9, maxInst: 2, send: 0.5, spatial: CY_HEAVY },
  scan_ping: { synth: Y.scanPing, gain: 0.8, priority: 8, maxInst: 2, send: 0.45, spatial: CY_ACT },
  vision_on: { synth: Y.visionOn, gain: 0.8, priority: 9, maxInst: 2, send: 0, spatial: null },
  vision_off: { synth: Y.visionOff, gain: 0.6, priority: 9, maxInst: 2, send: 0, spatial: null },
  camo_on: { synth: Y.camoOn, gain: 0.8, priority: 7, maxInst: 2, send: 0.15, spatial: CY_ACT },
  camo_off: { synth: Y.camoOff, gain: 0.62, priority: 7, maxInst: 2, send: 0.15, spatial: CY_ACT },
  reflex_on: { synth: Y.reflexOn, gain: 0.4, priority: 8, maxInst: 2, send: 0.2, spatial: CY_ACT },
  reflex_off: { synth: Y.reflexOff, gain: 0.6, priority: 7, maxInst: 2, send: 0.1, spatial: CY_ACT },
  overcharge_on: { synth: Y.overchargeOn, gain: 0.5, priority: 8, maxInst: 2, send: 0.2, spatial: CY_ACT },
  second_wind: { synth: Y.secondWind, gain: 0.46, priority: 9, maxInst: 2, send: 0.25, spatial: CY_ACT },
  nano_heal: { synth: Y.nanoHeal, gain: 1.0, priority: 4, maxInst: 2, send: 0.1, spatial: CY_FOLEY },
  drone_deploy: { synth: Y.droneDeploy, gain: 0.8, priority: 6, maxInst: 2, send: 0.15, spatial: CY_ACT },
  tool_hack: { synth: Y.toolHack, gain: 1.4, priority: 6, maxInst: 2, send: 0.05, spatial: CY_FOLEY },
  mark_ping: { synth: Y.markPing, gain: 1.0, priority: 8, maxInst: 2, send: 0, spatial: null },
  threat_warn: { synth: Y.threatWarn, gain: 0.7, priority: 9, maxInst: 1, send: 0, spatial: null },
  implant_install: { synth: Y.implantInstall, gain: 0.8, priority: 9, maxInst: 1, send: 0.05, spatial: null },
  implant_upgrade: { synth: Y.implantUpgrade, gain: 0.5, priority: 9, maxInst: 1, send: 0.05, spatial: null },
  implant_remove: { synth: Y.implantRemove, gain: 0.4, priority: 9, maxInst: 1, send: 0.05, spatial: null },
  cyber_ui_hover: { synth: Y.cyberUiHover, gain: 1.6, priority: 8, maxInst: 3, send: 0, spatial: null },
  cyber_ui_select: { synth: Y.cyberUiSelect, gain: 0.8, priority: 9, maxInst: 2, send: 0, spatial: null },
};
