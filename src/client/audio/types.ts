/**
 * Public types for the procedural audio engine of
 * "MAFIA WARS : Dadou vs Even" (Victorian London, 1888).
 */

export type Vec3Like = { x: number; y: number; z: number };

export type SfxName =
  | 'revolver' | 'shotgun' | 'rifle'
  | 'revolver_far' | 'rifle_far'
  | 'punch' | 'knife' | 'club' | 'swing'
  | 'hit_flesh' | 'hit_wall' | 'hit_wood' | 'hit_metal' | 'ricochet' | 'glass'
  | 'reload' | 'empty_click' | 'weapon_switch'
  | 'footstep_stone' | 'footstep_wood' | 'footstep_carpet'
  | 'pain' | 'death'
  | 'ui_click' | 'ui_hover' | 'ui_open' | 'ui_close' | 'ui_error' | 'paper'
  | 'cash' | 'purchase' | 'recruit'
  | 'capture' | 'territory_lost' | 'alert' | 'notify'
  | 'door_open' | 'door_close'
  | 'police_whistle' | 'horse_clop' | 'carriage_wheels' | 'neigh'
  | 'victory' | 'defeat';

/** Every SfxName, in declaration order (handy for tests, debug menus, preloading). */
export const SFX_NAMES: readonly SfxName[] = [
  'revolver', 'shotgun', 'rifle',
  'revolver_far', 'rifle_far',
  'punch', 'knife', 'club', 'swing',
  'hit_flesh', 'hit_wall', 'hit_wood', 'hit_metal', 'ricochet', 'glass',
  'reload', 'empty_click', 'weapon_switch',
  'footstep_stone', 'footstep_wood', 'footstep_carpet',
  'pain', 'death',
  'ui_click', 'ui_hover', 'ui_open', 'ui_close', 'ui_error', 'paper',
  'cash', 'purchase', 'recruit',
  'capture', 'territory_lost', 'alert', 'notify',
  'door_open', 'door_close',
  'police_whistle', 'horse_clop', 'carriage_wheels', 'neigh',
  'victory', 'defeat',
];

export interface PlayOptions {
  /** World position (metres, y up). Omit for a non-positional (2D) sound. */
  pos?: Vec3Like;
  /** Linear gain multiplier, default 1. */
  volume?: number;
  /** Pitch multiplier, default 1 (a small random variation is always added). */
  pitch?: number;
  /** Sound happens inside a building (room reverb instead of street reverb). Defaults to the listener's indoor state. */
  indoor?: boolean;
  /** Optional extra: absolute AudioContext time to start at (defaults to "now"). */
  when?: number;
}

export interface AmbienceParams {
  /** 0 day .. 1 night */
  night: number;
  /** Inside a building (muffle outdoor ambience, add room tone, interior reverb). */
  indoor: boolean;
  /** 0..1 river lapping, gulls by day, distant fog horn occasionally. */
  nearWater: number;
  /** 0..1 intensity of nearby fighting (drives music intensity). */
  combat: number;
  /** 0..1 nearby civilians (murmur). */
  crowd: number;
  /** 0..1 optional rain. */
  rain?: number;
}

export type MusicTrackName = 'menu' | 'game' | 'tension' | 'victory' | 'defeat' | 'none';

export interface VolumeSettings {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
}
