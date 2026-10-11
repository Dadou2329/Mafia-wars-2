// Worker : génère New York puis construit la navigation, hors du fil principal. Le monde part dès
// qu'il est généré : les workers de maillage travaillent pendant que celui-ci trace la navigation.
import { generateCity } from '../../shared/city/gen/city';
import { buildCityNav } from '../../shared/city/navBuild';
import { chunkTransferables } from '../../shared/voxel';
import { computeTintVolume } from '../render/lightVolume';

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = () => {
  const t0 = performance.now();
  post({ type: 'progress', step: 'Construction des gratte-ciel et des rues…', f: 0.05 });
  const city = generateCity();
  post({ type: 'progress', step: 'Allumage des néons…', f: 0.3 });
  const tint = computeTintVolume(city.world, city.ctx.lights);
  const chunks = city.world.exportChunks();
  const groundMap = city.groundMap.slice();
  post(
    {
      type: 'world',
      ms: performance.now() - t0,
      dims: [city.world.sx, city.world.sy, city.world.sz],
      chunks,
      tint,
      props: city.ctx.props,
      lights: city.ctx.lights,
      buildings: city.buildings,
      smokes: city.ctx.smokes,
      screens: city.ctx.screens,
      holos: city.ctx.holos,
      groundMap,
      gw: city.gw,
      gd: city.gd,
    },
    [...chunkTransferables(chunks), tint.data.buffer, groundMap.buffer],
  );
  const nav = buildCityNav(city);
  post({ type: 'nav', nav: nav.serialize(), ms: performance.now() - t0 }, nav.transferables());
};
