// Construction de la grille de navigation de la ville (identique sur le client et le serveur).

import { NavGrid } from '../nav';
import type { City } from './gen/city';
import { navExclude } from './plan';

export function buildCityNav(city: City): NavGrid {
  const seeds: { x: number; z: number; y: number }[] = [];
  for (const b of city.buildings) for (const d of b.doors) seeds.push({ x: d.out.x, z: d.out.z, y: d.out.y ?? 0 });
  return NavGrid.build(city.world, { exclude: navExclude, portals: city.ctx.portals, seeds });
}
