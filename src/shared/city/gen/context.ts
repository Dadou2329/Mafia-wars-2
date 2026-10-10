// Contexte de génération de la ville : monde voxel + listes d'accessoires, de lumières
// et d'informations de gameplay sur les bâtiments.

import { M } from '../../materials';
import { GROUND_VY, INV_VOXEL, VOXEL, VoxelWorld } from '../../voxel';
import { PROP_DEFS, PROP_INDEX, type PropKind } from '../props';
import type { BuildingDef, Side } from '../plan';
import { Rng } from '../../util';

export interface PropPlacement {
  kind: number; // index dans PROP_KINDS
  x: number; // m (centre de l'encombrement au sol)
  y: number; // m (base)
  z: number; // m
  yaw: number; // radians (avant du modèle = +Z local)
  /** Variante de modèle/couleurs (0..255). */
  variant: number;
  /** Bâtiment propriétaire (accessoires teintés aux couleurs du propriétaire) ou -1. */
  building: number;
  /** Échelle uniforme facultative. */
  scale?: number;
}

export interface LightSource {
  x: number;
  y: number;
  z: number;
  intensity: number;
  radius: number;
}

export interface Pt {
  x: number;
  z: number;
}

export interface DoorInfo {
  x: number; // centre de la porte (m)
  z: number;
  side: Side;
  out: Pt; // point dans la rue, devant la porte
  in: Pt; // point à l'intérieur, derrière la porte
  width: number;
  main: boolean;
}

export interface RoomInfo {
  kind: string;
  rect: [number, number, number, number]; // m, monde
}

export interface BuildingInfo {
  id: number;
  def: BuildingDef;
  footprint: [number, number, number, number]; // m
  floorY: number; // m, altitude du plancher
  doors: DoorInfo[];
  rooms: RoomInfo[];
  /** Zone de capture : salles intérieures accessibles (m). */
  zone: [number, number, number, number][];
  center: Pt;
  /** Points de défense intérieurs. */
  defend: Pt[];
  /** Points de garde extérieurs, autour de l'entrée. */
  guardOut: Pt[];
  /** QG : bureau, comptoir de recrutement, armurerie, points d'apparition. */
  desk?: Pt & { yaw: number };
  deskSeat?: Pt;
  recruit?: Pt;
  armory?: Pt;
  spawn: Pt[];
  /** Panneau d'enseigne (texte) : position et orientation. */
  sign?: { x: number; y: number; z: number; yaw: number; w: number; h: number };
  /** Plaque « Bureau de … » sur la porte du bureau. */
  plaque?: { x: number; y: number; z: number; yaw: number };
  /** Hauteur totale (m) pour la carte. */
  height: number;
}

export class GenContext {
  readonly world: VoxelWorld;
  readonly props: PropPlacement[] = [];
  readonly lights: LightSource[] = [];
  readonly buildings: BuildingInfo[] = [];
  /** Empreintes au sol des bâtiments (m) pour éviter d'y poser des objets de rue. */
  readonly footprints: [number, number, number, number][] = [];
  /** Cheminées fumantes (pour les particules côté client). */
  readonly smokes: { x: number; y: number; z: number; big: boolean }[] = [];
  readonly rng: Rng;

  constructor(world: VoxelWorld, seed: number) {
    this.world = world;
    this.rng = new Rng(seed);
  }

  /** Ajoute un accessoire (coordonnées monde en mètres) et écrit sa collision dans la grille. */
  prop(kind: PropKind, x: number, y: number, z: number, yaw = 0, variant = 0, building = -1, scale?: number): void {
    const def = PROP_DEFS[kind];
    this.props.push({ kind: PROP_INDEX[kind], x, y, z, yaw, variant, building, scale });
    if (def.collide !== 'none') {
      const s = scale ?? 1;
      // encombrement tourné (arrondi au quart de tour)
      const q = Math.round(yaw / (Math.PI / 2)) & 3;
      const w = (q & 1 ? def.size[2] : def.size[0]) * s;
      const d = (q & 1 ? def.size[0] : def.size[2]) * s;
      const h = ((def as { collideH?: number }).collideH ?? def.size[1]) * s;
      const mat = def.collide === 'cover' ? M.COVER : M.COLLIDE;
      // on réduit légèrement l'encombrement pour ne pas bloquer les passages étroits
      const x0 = Math.round((x - w / 2 + 0.06) * INV_VOXEL);
      const x1 = Math.round((x + w / 2 - 0.06) * INV_VOXEL);
      const z0 = Math.round((z - d / 2 + 0.06) * INV_VOXEL);
      const z1 = Math.round((z + d / 2 - 0.06) * INV_VOXEL);
      const y0 = Math.round(y * INV_VOXEL) + GROUND_VY;
      const y1 = y0 + Math.max(1, Math.round(h * INV_VOXEL));
      for (let vy = y0; vy < y1; vy++)
        for (let vz = Math.min(z0, z1 - 1); vz < Math.max(z1, z0 + 1); vz++)
          for (let vx = Math.min(x0, x1 - 1); vx < Math.max(x1, x0 + 1); vx++)
            if (this.world.get(vx, vy, vz) === 0) this.world.set(vx, vy, vz, mat);
    }
    const light = (def as { light?: { y: number; z?: number; intensity: number; radius: number } }).light;
    if (light) {
      const s = scale ?? 1;
      const lz = (light.z ?? 0) * s;
      this.lights.push({
        x: x + Math.sin(yaw) * lz,
        y: y + light.y * s,
        z: z + Math.cos(yaw) * lz,
        intensity: light.intensity,
        radius: light.radius,
      });
    }
  }

  light(x: number, y: number, z: number, intensity: number, radius: number): void {
    this.lights.push({ x, y, z, intensity, radius });
  }

  /** Vrai si le point (m) est dans l'empreinte d'un bâtiment (avec marge). */
  inFootprint(x: number, z: number, margin = 0): boolean {
    for (const f of this.footprints) {
      if (x >= f[0] - margin && x < f[2] + margin && z >= f[1] - margin && z < f[3] + margin) return true;
    }
    return false;
  }
}

export const vToM = (v: number): number => v * VOXEL;
