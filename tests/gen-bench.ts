// Banc d'essai de la génération : durée, mémoire, nombre d'objets.
import { generateCity } from '../src/shared/city/gen/city';
import { buildCityNav } from '../src/shared/city/navBuild';

const t0 = performance.now();
const city = generateCity();
const t1 = performance.now();
const w = city.world;
console.log(
  `génération : ${(t1 - t0).toFixed(0)} ms, tronçons alloués ${w.allocatedChunks()}/${w.chunks.length} (${((w.allocatedChunks() * 32768) / 1048576).toFixed(0)} Mo), ` +
    `accessoires ${city.ctx.props.length}, lumières ${city.ctx.lights.length}, bâtiments ${city.buildings.length}, écrans ${city.ctx.screens.length}, portails ${city.ctx.portals.length}`,
);
const t2 = performance.now();
const nav = buildCityNav(city);
let nodes = 0;
for (let n = 0; n < nav.count.length; n++) nodes += nav.count[n];
console.log(`navigation : ${(performance.now() - t2).toFixed(0)} ms, ${nodes} nœuds, ${nav.portals.length} portails`);
