// Chargement du monde : génération dans un worker (repli sur le fil principal si besoin).
import type { BuildingInfo, LightSource, PropPlacement } from '../../shared/city/gen/context';
import { generateCity } from '../../shared/city/gen/city';
import { RIVER_Z } from '../../shared/city/plan';
import { NavGrid } from '../../shared/nav';
import { VoxelWorld } from '../../shared/voxel';
import { computeLightVolume, type LightVolume } from '../render/lightVolume';
import { meshRegions, type RegionMesh } from '../render/worldMesh';

export interface WorldData {
  world: VoxelWorld;
  regions: RegionMesh[];
  light: LightVolume;
  nav: NavGrid;
  props: PropPlacement[];
  lights: LightSource[];
  buildings: BuildingInfo[];
  smokes: { x: number; y: number; z: number; big: boolean }[];
  groundMap: Uint8Array;
  gw: number;
  gd: number;
  ms: number;
}

export type Progress = (step: string, f: number) => void;

let promise: Promise<WorldData> | null = null;
let lastProgress: { step: string; f: number } = { step: 'Préparation…', f: 0 };
const listeners = new Set<Progress>();

export function onWorldProgress(fn: Progress): () => void {
  listeners.add(fn);
  fn(lastProgress.step, lastProgress.f);
  return () => listeners.delete(fn);
}

function progress(step: string, f: number): void {
  lastProgress = { step, f };
  for (const l of listeners) l(step, f);
}

export function loadWorld(): Promise<WorldData> {
  if (promise) return promise;
  promise = new Promise<WorldData>((resolve) => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./worldWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
    }
    if (!worker) {
      resolve(loadOnMainThread());
      return;
    }
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'progress') progress(m.step, m.f);
      else if (m.type === 'done') {
        const [sx, sy, sz] = m.dims as number[];
        const world = new VoxelWorld(sx, sy, sz);
        for (let i = 0; i < world.chunks.length; i++) world.chunks[i] = m.chunks[i] ?? null;
        const nav = NavGrid.fromArrays(m.nav.w, m.nav.d, m.nav.floor, m.nav.clear);
        progress('Londres est prête.', 1);
        resolve({
          world,
          regions: m.regions,
          light: m.light,
          nav,
          props: m.props,
          lights: m.lights,
          buildings: (m.buildings as BuildingInfo[]).sort((a, b) => a.id - b.id),
          smokes: m.smokes,
          groundMap: m.groundMap,
          gw: m.gw,
          gd: m.gd,
          ms: m.ms,
        });
        worker!.terminate();
      }
    };
    worker.onerror = () => {
      worker?.terminate();
      resolve(loadOnMainThread());
    };
    worker.postMessage('go');
  });
  return promise;
}

function loadOnMainThread(): WorldData {
  const t0 = performance.now();
  const city = generateCity();
  const light = computeLightVolume(city.world, city.ctx.lights);
  const nav = NavGrid.build(city.world, RIVER_Z);
  const regions = meshRegions(city.world);
  progress('Londres est prête.', 1);
  return {
    world: city.world,
    regions,
    light,
    nav,
    props: city.ctx.props,
    lights: city.ctx.lights,
    buildings: [...city.buildings].sort((a, b) => a.id - b.id),
    smokes: city.ctx.smokes,
    groundMap: city.groundMap,
    gw: city.gw,
    gd: city.gd,
    ms: performance.now() - t0,
  };
}
