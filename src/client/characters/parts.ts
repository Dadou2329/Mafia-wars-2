// Membres des personnages (New York, 2085) au 1/64 m : chaque membre est un modèle voxel dont
// l'origine est son articulation ; les couleurs sont des emplacements de palette (SLOT.* et
// emplacements étendus XS.*) pour que chaque personnage ait sa propre tenue sans dupliquer la
// géométrie ; les liserés lumineux (SLOT.NEON) prennent la couleur de néon du personnage.
// Ce module associe une clé de membre (« torso:suit:m », « hand:grip:m:rings:R »…) à son
// modèle. Repère : +Y en haut, +Z vers l'avant, +X vers la gauche du personnage.

import { VoxelModel } from '../models/voxelModel';
import * as B from './partsBody';
import * as G from './partsGear';
import * as H from './partsHead';
import { RES, type Build } from './rig';

export { RES };
export type { TorsoStyle, PelvisStyle, SleeveStyle, LegStyle, FootStyle, TailStyle, SkirtStyle, HandPose, HandWear } from './partsBody';
export type { HairStyle, HatStyle, FaceGear, BeardStyle, FaceShape, HeadDef } from './partsHead';
export type { WeaponKind } from './partsGear';
export { pelvisOf, GRIP } from './partsBody';
export { headKey } from './partsHead';
export { WEAPON_META, TURRET_BASE_Y, TURRET_PIVOT_Y, TURRET_MUZZLE } from './partsGear';

/** Copie miroir gauche/droite d'un modèle (x → −x autour de l'origine). */
export function mirrorX(m: VoxelModel): VoxelModel {
  const r = new VoxelModel(m.sx, m.sy, m.sz, m.res);
  for (let y = 0; y < m.sy; y++)
    for (let z = 0; z < m.sz; z++)
      for (let x = 0; x < m.sx; x++) r.data[r.idx(m.sx - 1 - x, y, z)] = m.data[m.idx(x, y, z)];
  r.setOrigin(m.sx - m.ox, m.oy, m.oz);
  return r;
}

/** Construit le modèle d'une clé de membre. */
export function buildPart(key: string): VoxelModel {
  const a = key.split(':');
  const side = a[a.length - 1];
  const R = side === 'R';
  const mir = (m: VoxelModel) => (R ? mirrorX(m) : m);
  switch (a[0]) {
    case 'torso':
      return B.torso(a[1] as B.TorsoStyle, a[2] as Build);
    case 'pelvis':
      return B.pelvis(a[1] as B.PelvisStyle, a[2] as Build);
    case 'head':
      return H.head(H.parseHeadKey(a[1]));
    case 'hair':
      return H.hair(a[1] as H.HairStyle, a[2] as Build);
    case 'hat':
      return H.hat(a[1] as H.HatStyle);
    case 'face':
      return H.faceGear(a[1] as H.FaceGear);
    case 'uarm':
      return mir(B.upperArm(a[1] as B.SleeveStyle, a[2] as Build, a[3] === 'band' && !R));
    case 'farm':
      return mir(B.forearm(a[1] as B.SleeveStyle, a[2] as Build));
    case 'hand':
      return mir(B.hand(a[1] as B.HandPose, a[2] as Build, a[3] as B.HandWear));
    case 'thigh':
      return mir(B.thigh(a[1] as B.LegStyle, a[2] as Build));
    case 'shin':
      return mir(B.shin(a[1] as B.LegStyle, a[2] as B.FootStyle, a[3] as Build));
    case 'foot':
      return B.foot(a[1] as B.FootStyle, a[2] as Build);
    case 'tail':
      return mir(B.coatTail(a[1] as B.TailStyle, a[2] as Build));
    case 'skirt':
      return mir(B.skirt(a[1] as B.SkirtStyle, a[2] as Build));
    case 'weapon':
      return G.weaponModel(a[1] as G.WeaponKind);
    case 'turret':
      return a[1] === 'base' ? G.turretBase() : a[1] === 'yoke' ? G.turretYoke() : G.turretGun();
    default:
      throw new Error('membre inconnu ' + key);
  }
}
