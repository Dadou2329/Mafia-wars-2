import { generateCity } from '../src/shared/city/gen/city';
import { NavGrid } from '../src/shared/nav';
import { RIVER_Z, HQ_BUILDING } from '../src/shared/city/plan';
const city = generateCity();
const t0 = performance.now();
const nav = NavGrid.build(city.world, RIVER_Z);
const t1 = performance.now();
let walk = 0;
for (let n = 0; n < nav.floor.length; n++) if (nav.floor[n] >= 0) walk++;
console.log(`nav build ${(t1 - t0).toFixed(0)} ms, walkable ${walk}/${nav.floor.length}`);
const hqD = city.buildings.find((b) => b.def.key === 'lion_rouge')!;
const hqE = city.buildings.find((b) => b.def.key === 'ancre_bleue')!;
// chemin du bureau de Dadou au bureau d'Even
const a = hqD.desk!, b = hqE.desk!;
let t2 = performance.now();
const p = nav.findPath(a.x, a.z + 1.5, b.x, b.z + 1.5, 200000);
let t3 = performance.now();
console.log(`path HQ->HQ ${(t3 - t2).toFixed(1)} ms, points ${p ? p.length / 2 : 'null'}`);
if (p) console.log(p.map((v) => v.toFixed(1)).join(' '));
// tous les bâtiments : chemin depuis le QG de Dadou jusqu'à l'intérieur
let fails = 0;
t2 = performance.now();
for (const bd of city.buildings) {
  const q = nav.findPath(hqD.doors[0].out.x, hqD.doors[0].out.z, bd.center.x, bd.center.z, 200000);
  const ok = q && Math.hypot(q[q.length - 2] - bd.center.x, q[q.length - 1] - bd.center.z) < 2;
  if (!ok) { fails++; console.log('ÉCHEC vers', bd.def.name, q ? `fin à ${q[q.length-2].toFixed(1)},${q[q.length-1].toFixed(1)}` : 'null', 'centre', bd.center.x.toFixed(1), bd.center.z.toFixed(1), 'walk', nav.walkable(bd.center.x, bd.center.z)); }
}
t3 = performance.now();
console.log(`chemins vers ${city.buildings.length} bâtiments: ${fails} échecs, ${(t3 - t2).toFixed(0)} ms`);
