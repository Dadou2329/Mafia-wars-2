// Banc d'essai de la navigation : construction de la grille et chemins vers tous les bâtiments.
import { generateCity } from '../src/shared/city/gen/city';
import { buildCityNav } from '../src/shared/city/navBuild';
import { HQ_BUILDING } from '../src/shared/city/plan';
import { PATH_STRIDE } from '../src/shared/nav';

const city = generateCity();
const t0 = performance.now();
const nav = buildCityNav(city);
const t1 = performance.now();
let walk = 0;
for (let n = 0; n < nav.count.length; n++) walk += nav.count[n];
console.log(`nav build ${(t1 - t0).toFixed(0)} ms, nœuds praticables ${walk}, portails ${nav.portals.length}`);
const hqD = city.buildings.find((b) => b.id === HQ_BUILDING.dadou.id)!;
let fails = 0;
const t2 = performance.now();
for (const bd of city.buildings) {
  const out = hqD.doors[0].out;
  const q = nav.findPath(out.x, out.z, out.y ?? 0, bd.center.x, bd.center.z, bd.center.y ?? bd.floorY, 200000);
  const e = q ? q.length - PATH_STRIDE : 0;
  const ok = q && Math.hypot(q[e] - bd.center.x, q[e + 1] - bd.center.z) < 2;
  if (!ok) {
    fails++;
    console.log('ÉCHEC vers', bd.def.name, q ? `fin à ${q[e].toFixed(1)},${q[e + 1].toFixed(1)}` : 'null', 'centre', bd.center.x.toFixed(1), bd.center.z.toFixed(1));
  }
}
console.log(`chemins vers ${city.buildings.length} bâtiments : ${fails} échecs, ${(performance.now() - t2).toFixed(0)} ms`);
