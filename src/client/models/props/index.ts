// Registre des modèles d'accessoires : PropKind → fabrique de VoxelModel (+ variantes).
// Les modèles sont répartis par familles (rue, intérieurs, commerces et industrie).

import { PROP_DEFS, type PropKind } from '../../../shared/city/props';
import { SLOT, VoxelModel, jitter } from '../voxelModel';
import { HOME_MODELS } from './home';
import { STREET_MODELS } from './street';
import { VENUE_MODELS } from './venues';

export interface PropModelEntry {
  variants: number;
  make: (variant: number) => VoxelModel;
}

/** Familles de modèles enregistrées (voir les fichiers de ce dossier). */
const REGISTRY: Partial<Record<PropKind, PropModelEntry>> = { ...STREET_MODELS, ...HOME_MODELS, ...VENUE_MODELS };

export function registerModels(entries: Partial<Record<PropKind, PropModelEntry>>): void {
  Object.assign(REGISTRY, entries);
}

/** Modèle de secours : un bloc aux dimensions de l'encombrement (lumineux si la lampe en a une). */
function placeholder(kind: PropKind): VoxelModel {
  const def = PROP_DEFS[kind] as { size: [number, number, number]; light?: unknown };
  const s = def.size;
  const m = VoxelModel.meters(Math.max(0.1, s[0]), Math.max(0.1, s[1]), Math.max(0.1, s[2]));
  m.box(0, 0, 0, m.sx, m.sy, m.sz, 0x5a5f68);
  if (def.light) m.box(0, Math.max(0, m.sy - 2), 0, m.sx, m.sy, m.sz, SLOT.GLOW);
  return jitter(m, 0.08, 5);
}

export function propModelEntry(kind: PropKind): PropModelEntry {
  return REGISTRY[kind] ?? { variants: 1, make: () => placeholder(kind) };
}

export function hasRealModel(kind: PropKind): boolean {
  return REGISTRY[kind] !== undefined;
}
