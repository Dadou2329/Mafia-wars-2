// Contexte de génération de la ville : monde voxel + listes d'accessoires, de lumières
// et d'informations de gameplay sur les bâtiments.

import { M } from '../../materials';
import { GROUND_VY, INV_VOXEL, VOXEL, VoxelWorld } from '../../voxel';
import { NEON_COLORS, PROP_DEFS, PROP_INDEX, type PropDef, type PropKind } from '../props';
import type { BuildingDef, Side } from '../plan';
import { Rng } from '../../util';
import type { PortalDef } from '../../nav';

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
  /** Couleur de la lumière (sRGB), blanc chaud par défaut. */
  color?: number;
}

export interface Pt {
  x: number;
  z: number;
  /** Altitude du sol (m) ; la rue (0) si absente. */
  y?: number;
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
  /** Altitude du sol de la pièce (m). */
  y: number;
}

/** Volume intérieur d'un étage (zone de capture). */
export interface ZoneInfo {
  rect: [number, number, number, number];
  y0: number; // m
  y1: number; // m
}

/** Arrêt d'ascenseur : point devant la porte, à l'étage desservi. */
export interface ElevatorStop {
  x: number;
  z: number;
  y: number;
  yaw: number; // vers la porte
  label: string;
}

/** Objectif d'une opération de prise de contrôle (voir shared/conquest.ts) : où se tenir pour le mener. */
export interface OpAnchor {
  /** Clé de l'objectif (« server », « vault », « office »…). */
  key: string;
  x: number;
  /** Altitude du sol (m). */
  y: number;
  z: number;
  /** Orientation vers l'objet manipulé (console, coffre…), si connue. */
  yaw?: number;
  /** Étage (index dans floors), −1 pour le toit. */
  floor?: number;
}

export interface BuildingInfo {
  id: number;
  def: BuildingDef;
  footprint: [number, number, number, number]; // m
  floorY: number; // m, altitude du rez-de-chaussée
  /** Étages accessibles (altitude du sol et du plafond, m). */
  floors: { y: number; ceil: number }[];
  /** Toit accessible (altitude, m) ou null. */
  roofY: number | null;
  doors: DoorInfo[];
  rooms: RoomInfo[];
  /** Zone de capture : volumes intérieurs accessibles. */
  zone: ZoneInfo[];
  center: Pt;
  /** Points de défense intérieurs (tous étages). */
  defend: Pt[];
  /** Points de tir sur le toit. */
  roofPts: Pt[];
  /** Points de garde extérieurs, autour de l'entrée. */
  guardOut: Pt[];
  /** QG : bureau, recrutement, armurerie, garage, points d'apparition. */
  desk?: Pt & { yaw: number };
  deskSeat?: Pt;
  recruit?: Pt;
  armory?: Pt;
  garage?: Pt & { yaw: number };
  spawn: Pt[];
  /** Ascenseur (tours) : arrêts. */
  elevator?: ElevatorStop[];
  /** Coffre / cible de braquage. */
  vault?: Pt;
  /** Terminal de sécurité (bâtiments protégés : caméras, tourelles, coffre verrouillé). */
  terminal?: Pt;
  /** Panneau d'enseigne (texte) : position et orientation. */
  sign?: { x: number; y: number; z: number; yaw: number; w: number; h: number };
  /** Plaque « Bureau de … ». */
  plaque?: { x: number; y: number; z: number; yaw: number };
  /** Hauteur totale (m) pour la carte. */
  height: number;
  /** Objectifs des opérations de prise de contrôle (bâtiments capturables). */
  ops?: OpAnchor[];
  /** Logements : emplacements des équipements du QG (« holomap », « surveil »…, « elite1 »…), voir server/game/hq.ts. */
  hqAnchors?: Record<string, HqAnchor>;
  /** Clinique cybernétique (fauteuil d'installation des implants), voir gen/clinics.ts. */
  clinic?: ClinicInfo;
}

/** Emplacement d'un équipement du QG : point au sol, orientation de l'avant du modèle. */
export interface HqAnchor {
  x: number;
  /** Altitude du sol (m). */
  y: number;
  z: number;
  yaw: number;
  /** Largeur utile (m) : porte (sécurité), table (carte holographique). */
  s?: number;
  /** Hauteur (m) au-dessus du sol : plateau de la table (carte holographique). */
  h?: number;
}

/** Clinique cybernétique installée dans un bâtiment. */
export interface ClinicInfo {
  name: string;
  /** Centre du fauteuil au sol (m) et orientation (avant du modèle, côté patient). */
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Écran géant (contenu dessiné par le client : publicités, propagande des parrains). */
export interface ScreenInfo {
  x: number;
  y: number;
  z: number;
  yaw: number;
  w: number;
  h: number;
  /** 'ad' publicité, 'boss' propagande du maître du quartier, 'news' actualités, 'ticker' bandeau. */
  kind: 'ad' | 'boss' | 'news' | 'ticker';
  district: string;
  seed: number;
}

/** Hologramme (silhouette animée, additive). */
export interface HoloInfo {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  kind: 'koi' | 'dancer' | 'logo' | 'dragon' | 'city' | 'ring' | 'bottle' | 'face';
  color: number;
}

export interface SteamInfo {
  x: number;
  y: number;
  z: number;
  big: boolean;
}

export class GenContext {
  readonly world: VoxelWorld;
  readonly props: PropPlacement[] = [];
  readonly lights: LightSource[] = [];
  readonly buildings: BuildingInfo[] = [];
  /** Empreintes au sol des bâtiments (m) pour éviter d'y poser des objets de rue. */
  readonly footprints: [number, number, number, number][] = [];
  /** Ascenseurs, rames de métro et autres liens de navigation. */
  readonly portals: PortalDef[] = [];
  /** Vapeur des bouches d'égout et fumées. */
  readonly smokes: SteamInfo[] = [];
  readonly screens: ScreenInfo[] = [];
  readonly holos: HoloInfo[] = [];
  readonly rng: Rng;

  constructor(world: VoxelWorld, seed: number) {
    this.world = world;
    this.rng = new Rng(seed);
  }

  /** Ajoute un accessoire (coordonnées monde en mètres) et écrit sa collision dans la grille. */
  prop(kind: PropKind, x: number, y: number, z: number, yaw = 0, variant = 0, building = -1, scale?: number): void {
    const def = PROP_DEFS[kind] as PropDef;
    this.props.push({ kind: PROP_INDEX[kind], x, y, z, yaw, variant, building, scale });
    if (def.collide !== 'none') {
      const s = scale ?? 1;
      // encombrement tourné (arrondi au quart de tour)
      const q = Math.round(yaw / (Math.PI / 2)) & 3;
      const w = (q & 1 ? def.size[2] : def.size[0]) * s;
      const d = (q & 1 ? def.size[0] : def.size[2]) * s;
      const h = (def.collideH ?? def.size[1]) * s;
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
    const light = def.light;
    if (light) {
      const s = scale ?? 1;
      const lz = (light.z ?? 0) * s;
      const color = def.neonVariant ? NEON_COLORS[variant % NEON_COLORS.length] : light.color;
      this.lights.push({
        x: x + Math.sin(yaw) * lz,
        y: y + light.y * s,
        z: z + Math.cos(yaw) * lz,
        intensity: light.intensity,
        radius: light.radius,
        color,
      });
    }
  }

  light(x: number, y: number, z: number, intensity: number, radius: number, color?: number): void {
    this.lights.push({ x, y, z, intensity, radius, color });
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
