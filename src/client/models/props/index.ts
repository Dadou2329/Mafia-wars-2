// Registre des modèles d'accessoires : PropKind → fabrique de VoxelModel (+ variantes).

import { PROP_DEFS, type PropKind } from '../../../shared/city/props';
import { VoxelModel, jitter } from '../voxelModel';
import { C } from './palette';
import * as core from './core';
import { EXTRA_MODELS } from './extra';

export interface PropModelEntry {
  variants: number;
  make: (variant: number) => VoxelModel;
}

const REGISTRY: Partial<Record<PropKind, PropModelEntry>> = {
  LAMP_POST: { variants: 1, make: () => core.lampPost() },
  LAMP_WALL: { variants: 1, make: () => core.lampWall() },
  CHAIR: { variants: 4, make: (v) => core.chair(v) },
  TABLE_ROUND: { variants: 3, make: (v) => core.tableRound(v) },
  BARREL: { variants: 3, make: (v) => core.barrel(v) },
  CRATE: { variants: 3, make: (v) => core.crate(v, 14) },
  CRATE_SMALL: { variants: 2, make: (v) => core.crate(v, 9) },
  BENCH: { variants: 1, make: () => core.bench() },
  HANGING_LAMP: { variants: 1, make: () => core.hangingLamp() },
  CHANDELIER: { variants: 1, make: () => core.chandelier() },
  DESK_BOSS: { variants: 1, make: () => core.deskBoss() },
  BOSS_CHAIR: { variants: 1, make: () => core.bossChair() },
  BOTTLE_SHELF: { variants: 3, make: (v) => core.bottleShelf(v) },
  ...EXTRA_MODELS,
};

/** Modèle de secours : un bloc aux dimensions de l'encombrement. */
function placeholder(kind: PropKind): VoxelModel {
  const s = PROP_DEFS[kind].size;
  const m = VoxelModel.meters(s[0], s[1], s[2]);
  m.box(0, 0, 0, m.sx, m.sy, m.sz, C.walnut);
  return jitter(m, 0.08, 5);
}

export function propModelEntry(kind: PropKind): PropModelEntry {
  return REGISTRY[kind] ?? { variants: 1, make: () => placeholder(kind) };
}

export function hasRealModel(kind: PropKind): boolean {
  return REGISTRY[kind] !== undefined;
}
