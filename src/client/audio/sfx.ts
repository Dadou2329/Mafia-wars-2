/**
 * SFX registry: synth function, level, voice-stealing priority, per-name
 * instance cap, reverb send, spatial profile and distant-variant switching.
 */
import type { Surface } from './prerender';
import * as C from './sfx_combat';
import type { SfxCtx } from './sfx_combat';
import * as M from './sfx_misc';
import type { SfxName } from './types';

export interface SpatialProfile {
  /** PannerNode refDistance (m). */
  ref: number;
  /** PannerNode rolloffFactor (inverse model). */
  rolloff: number;
  /** Beyond this distance (m) the sound is not played at all. */
  cull: number;
  /** Use HRTF panning (when enabled globally); cheap equal-power otherwise. */
  hrtf: boolean;
}

export type SynthFn = (s: SfxCtx) => number;

export interface SfxDef {
  synth: SynthFn;
  /** Base linear gain. */
  gain: number;
  /** Voice-stealing priority 0..10 (higher survives). */
  priority: number;
  /** Max simultaneous instances of this name (oldest is cut). */
  maxInst: number;
  /** Reverb send amount 0..1 (street or room IR). */
  send: number;
  /** Spatial profile used when a position is given; null = always 2D. */
  spatial: SpatialProfile | null;
  /** Auto-switch to a distant rendering beyond `dist` metres. */
  far?: { dist: number; synth: SynthFn };
  /** Footsteps replay pre-rendered variants. */
  surface?: Surface;
}

const GUN: SpatialProfile = { ref: 6, rolloff: 0.9, cull: 320, hrtf: true };
const MELEE: SpatialProfile = { ref: 2, rolloff: 1.3, cull: 45, hrtf: true };
const IMPACT: SpatialProfile = { ref: 2.5, rolloff: 1.1, cull: 70, hrtf: true };
const STEP: SpatialProfile = { ref: 1.5, rolloff: 1.6, cull: 26, hrtf: false };
const FOLEY: SpatialProfile = { ref: 1.5, rolloff: 1.4, cull: 30, hrtf: true };
const VOICE: SpatialProfile = { ref: 2, rolloff: 1.1, cull: 55, hrtf: true };
const WORLD: SpatialProfile = { ref: 4, rolloff: 0.9, cull: 120, hrtf: true };
const WHISTLE: SpatialProfile = { ref: 6, rolloff: 0.8, cull: 220, hrtf: true };
const REWARD: SpatialProfile = { ref: 3, rolloff: 1, cull: 50, hrtf: false };
const SIGNAL: SpatialProfile = { ref: 12, rolloff: 0.7, cull: 250, hrtf: false };

const noop: SynthFn = (s) => s.t;

export const SFX: Record<SfxName, SfxDef> = {
  revolver: { synth: (s) => C.gunshot(s, 'revolver'), gain: 1.5, priority: 8, maxInst: 10, send: 0.5, spatial: GUN, far: { dist: 70, synth: (s) => C.gunshotFar(s, 'revolver') } },
  shotgun: { synth: (s) => C.gunshot(s, 'shotgun'), gain: 0.95, priority: 8, maxInst: 8, send: 0.55, spatial: GUN, far: { dist: 75, synth: (s) => C.gunshotFar(s, 'shotgun') } },
  rifle: { synth: (s) => C.gunshot(s, 'rifle'), gain: 1.1, priority: 8, maxInst: 8, send: 0.55, spatial: GUN, far: { dist: 90, synth: (s) => C.gunshotFar(s, 'rifle') } },
  revolver_far: { synth: (s) => C.gunshotFar(s, 'revolver'), gain: 0.9, priority: 6, maxInst: 8, send: 0.7, spatial: GUN },
  rifle_far: { synth: (s) => C.gunshotFar(s, 'rifle'), gain: 0.9, priority: 6, maxInst: 8, send: 0.7, spatial: GUN },

  punch: { synth: C.punch, gain: 0.8, priority: 7, maxInst: 6, send: 0.12, spatial: MELEE },
  knife: { synth: C.knife, gain: 0.75, priority: 7, maxInst: 6, send: 0.1, spatial: MELEE },
  club: { synth: C.club, gain: 0.85, priority: 7, maxInst: 6, send: 0.12, spatial: MELEE },
  swing: { synth: C.swing, gain: 0.7, priority: 5, maxInst: 6, send: 0.05, spatial: MELEE },

  hit_flesh: { synth: C.hitFlesh, gain: 0.7, priority: 6, maxInst: 8, send: 0.1, spatial: IMPACT },
  hit_wall: { synth: C.hitWall, gain: 1.4, priority: 5, maxInst: 8, send: 0.2, spatial: IMPACT },
  hit_wood: { synth: C.hitWood, gain: 0.85, priority: 5, maxInst: 8, send: 0.2, spatial: IMPACT },
  hit_metal: { synth: C.hitMetal, gain: 0.55, priority: 5, maxInst: 6, send: 0.2, spatial: IMPACT },
  ricochet: { synth: C.ricochet, gain: 0.5, priority: 5, maxInst: 4, send: 0.25, spatial: IMPACT },
  glass: { synth: C.glass, gain: 0.8, priority: 6, maxInst: 3, send: 0.2, spatial: IMPACT },

  reload: { synth: C.reload, gain: 0.6, priority: 6, maxInst: 3, send: 0.05, spatial: FOLEY },
  empty_click: { synth: C.emptyClick, gain: 1.5, priority: 6, maxInst: 3, send: 0.03, spatial: FOLEY },
  weapon_switch: { synth: C.weaponSwitch, gain: 0.9, priority: 6, maxInst: 3, send: 0.03, spatial: FOLEY },

  // Footsteps are handled by the engine with pre-rendered buffers (synth unused).
  footstep_stone: { synth: noop, gain: 0.45, priority: 2, maxInst: 8, send: 0, spatial: STEP, surface: 'stone' },
  footstep_wood: { synth: noop, gain: 0.45, priority: 2, maxInst: 8, send: 0, spatial: STEP, surface: 'wood' },
  footstep_carpet: { synth: noop, gain: 0.4, priority: 2, maxInst: 8, send: 0, spatial: STEP, surface: 'carpet' },

  pain: { synth: M.pain, gain: 0.7, priority: 6, maxInst: 6, send: 0.15, spatial: VOICE },
  death: { synth: M.death, gain: 0.22, priority: 7, maxInst: 4, send: 0.15, spatial: VOICE },

  ui_click: { synth: M.uiClick, gain: 1.0, priority: 9, maxInst: 4, send: 0, spatial: null },
  ui_hover: { synth: M.uiHover, gain: 1.2, priority: 8, maxInst: 3, send: 0, spatial: null },
  ui_open: { synth: M.uiOpen, gain: 0.6, priority: 9, maxInst: 2, send: 0, spatial: null },
  ui_close: { synth: M.uiClose, gain: 0.6, priority: 9, maxInst: 2, send: 0, spatial: null },
  ui_error: { synth: M.uiError, gain: 0.3, priority: 9, maxInst: 2, send: 0, spatial: null },
  paper: { synth: M.paper, gain: 0.6, priority: 8, maxInst: 3, send: 0, spatial: REWARD },

  cash: { synth: M.cash, gain: 0.4, priority: 9, maxInst: 3, send: 0.05, spatial: REWARD },
  purchase: { synth: M.purchase, gain: 0.7, priority: 9, maxInst: 3, send: 0.05, spatial: REWARD },
  recruit: { synth: M.recruit, gain: 0.55, priority: 9, maxInst: 3, send: 0.05, spatial: REWARD },

  capture: { synth: M.capture, gain: 0.3, priority: 10, maxInst: 2, send: 0.15, spatial: SIGNAL },
  territory_lost: { synth: M.territoryLost, gain: 0.3, priority: 10, maxInst: 2, send: 0.15, spatial: SIGNAL },
  alert: { synth: M.alert, gain: 0.3, priority: 10, maxInst: 2, send: 0.2, spatial: SIGNAL },
  notify: { synth: M.notify, gain: 0.7, priority: 9, maxInst: 2, send: 0.05, spatial: SIGNAL },

  door_open: { synth: M.doorOpen, gain: 0.6, priority: 5, maxInst: 3, send: 0.15, spatial: FOLEY },
  door_close: { synth: M.doorClose, gain: 0.18, priority: 5, maxInst: 3, send: 0.15, spatial: FOLEY },

  police_whistle: { synth: M.policeWhistle, gain: 0.5, priority: 7, maxInst: 2, send: 0.35, spatial: WHISTLE },
  horse_clop: { synth: M.horseClop, gain: 0.6, priority: 3, maxInst: 6, send: 0.15, spatial: WORLD },
  carriage_wheels: { synth: M.carriageWheels, gain: 0.6, priority: 3, maxInst: 3, send: 0.15, spatial: WORLD },
  neigh: { synth: M.neigh, gain: 0.35, priority: 4, maxInst: 2, send: 0.25, spatial: WORLD },

  victory: { synth: M.victorySting, gain: 0.35, priority: 10, maxInst: 1, send: 0.2, spatial: null },
  defeat: { synth: M.defeatSting, gain: 0.35, priority: 10, maxInst: 1, send: 0.2, spatial: null },
};
