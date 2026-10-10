// Monde partagé par toutes les parties du serveur (généré une seule fois).

import { generateCity, type City } from '../shared/city/gen/city';
import type { BuildingInfo } from '../shared/city/gen/context';
import { RIVER_Z } from '../shared/city/plan';
import { NavGrid } from '../shared/nav';

export interface SharedWorld {
  city: City;
  nav: NavGrid;
  buildings: BuildingInfo[];
  byId: Map<number, BuildingInfo>;
}

let cached: SharedWorld | null = null;

export function getWorld(): SharedWorld {
  if (cached) return cached;
  const t0 = Date.now();
  const city = generateCity();
  const nav = NavGrid.build(city.world, RIVER_Z);
  const buildings = [...city.buildings].sort((a, b) => a.id - b.id);
  cached = { city, nav, buildings, byId: new Map(buildings.map((b) => [b.id, b])) };
  console.log(`[monde] Londres généré en ${Date.now() - t0} ms (${buildings.length} bâtiments)`);
  return cached;
}
