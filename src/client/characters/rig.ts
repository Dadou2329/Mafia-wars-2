// Squelette des personnages (New York, 2085) : proportions réalistes d'un adulte (environ
// 7,5 têtes), résolution des membres 1/64 m. Les cotes sont en voxels (1 voxel = 1/64 m) ;
// chaque membre est modélisé avec son origine sur son articulation, debout, bras le long du
// corps, paumes tournées vers les cuisses.
// Repère : +Y en haut, +Z vers l'avant, +X vers la gauche du personnage.

export const RES = 1 / 64;

export type Build = 'm' | 'f';

export interface Dims {
  /** Hauteur de l'articulation lombaire (origine du bassin et du torse) au repos. */
  pelvisY: number;
  /** Hanche gauche dans le repère du bassin (la droite est symétrique). */
  hip: [number, number, number];
  thigh: number;
  shin: number;
  /** Cheville au-dessus de la semelle. */
  ankle: number;
  /** Pivot de la tête (haut du cou) dans le repère du torse. */
  neck: [number, number, number];
  /** Épaule gauche dans le repère du torse. */
  shoulder: [number, number, number];
  upper: number;
  fore: number;
  /** Poignet → bout des doigts. */
  hand: number;
  /** Talon (arrière) et pointe du pied (avant) par rapport à la cheville, au sol. */
  heel: number;
  toe: number;
}

export const DIMS: Record<Build, Dims> = {
  // homme : 1,79 m sans chapeau (yeux à 1,66 m, centre de gravité vers 0,98 m)
  m: {
    pelvisY: 64,
    hip: [6, -6, 0.2],
    thigh: 27,
    shin: 26,
    ankle: 5,
    neck: [0, 38.5, -0.6],
    shoulder: [11.4, 27.6, -1],
    upper: 18.5,
    fore: 16.5,
    hand: 12,
    heel: 4.2,
    toe: 12.8,
  },
  // femme : mêmes jambes, épaules plus étroites, bras plus fins ; l'échelle du personnage
  // (≈ 0,96) la ramène vers 1,70 m
  f: {
    pelvisY: 64,
    hip: [6, -6, 0.2],
    thigh: 27,
    shin: 26,
    ankle: 5,
    neck: [0, 38, -0.4],
    shoulder: [10.2, 27.2, -0.8],
    upper: 17.8,
    fore: 16,
    hand: 11,
    heel: 3.8,
    toe: 11.8,
  },
};

/** Hauteur (m) du sommet du crâne au-dessus du pivot de la tête. */
export const CROWN = 11 * RES;
