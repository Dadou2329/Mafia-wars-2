import { generateCity } from '../src/shared/city/gen/city';
const t0 = performance.now();
const city = generateCity();
const t1 = performance.now();
let chunks = 0;
for (const c of city.world.chunks) if (c) chunks++;
console.log(`génération: ${(t1 - t0).toFixed(0)} ms, chunks: ${chunks}/${city.world.chunks.length}, props: ${city.ctx.props.length}, lumières: ${city.ctx.lights.length}, bâtiments: ${city.buildings.length}, fumées: ${city.ctx.smokes.length}`);
for (const b of city.buildings) {
  console.log(`${b.def.name.padEnd(28)} pièces=${b.rooms.map(r=>r.kind).join(',')} défense=${b.defend.length} spawn=${b.spawn.length} desk=${!!b.desk} recruit=${!!b.recruit}`);
}
