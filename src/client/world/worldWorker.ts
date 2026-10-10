// Worker : génère Londres, calcule l'éclairage, la navigation et les maillages hors du fil principal.
import { generateCity } from '../../shared/city/gen/city';
import { buildCityNav } from '../../shared/city/navBuild';
import { NavGrid } from '../../shared/nav';
import { computeLightVolume, computeTintVolume } from '../render/lightVolume';
import { meshRegions } from '../render/worldMesh';

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = () => {
  const t0 = performance.now();
  post({ type: 'progress', step: 'Pavage des rues et construction des bâtiments…', f: 0.05 });
  const city = generateCity();
  post({ type: 'progress', step: 'Allumage des becs de gaz…', f: 0.3 });
  const light = computeLightVolume(city.world, city.ctx.lights);
  const tint = computeTintVolume(city.world, city.ctx.lights);
  post({ type: 'progress', step: 'Tracé des itinéraires…', f: 0.5 });
  const nav = buildCityNav(city);
  post({ type: 'progress', step: 'Taille des pierres et des briques…', f: 0.55 });
  const regions = meshRegions(city.world, (f) => post({ type: 'progress', step: 'Taille des pierres et des briques…', f: 0.55 + f * 0.4 }));
  const chunks = city.world.chunks;
  const transfer: Transferable[] = [light.data.buffer, tint.data.buffer, city.groundMap.buffer, city.world.fillMat.buffer, ...nav.transferables()];
  for (const c of chunks) if (c) transfer.push(c.buffer);
  for (const r of regions) transfer.push(r.pos.buffer, r.nrm.buffer, r.dat.buffer);
  post(
    {
      type: 'done',
      ms: performance.now() - t0,
      dims: [city.world.sx, city.world.sy, city.world.sz],
      chunks,
      fillMat: city.world.fillMat,
      regions,
      light,
      tint,
      nav: nav.serialize(),
      props: city.ctx.props,
      lights: city.ctx.lights,
      buildings: city.buildings,
      smokes: city.ctx.smokes,
      groundMap: city.groundMap,
      gw: city.gw,
      gd: city.gd,
    },
    transfer,
  );
};
