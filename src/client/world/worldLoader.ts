// Chargement du monde : génération et navigation dans un worker, maillage réparti sur plusieurs
// workers, éclairage calculé ensuite en continu par un worker dédié (repli sur le fil principal si
// les workers sont indisponibles).
import type { BuildingInfo, HoloInfo, LightSource, PropPlacement, ScreenInfo } from '../../shared/city/gen/context';
import { generateCity } from '../../shared/city/gen/city';
import { buildCityNav } from '../../shared/city/navBuild';
import { NavGrid } from '../../shared/nav';
import { CHUNK, VoxelWorld, type ChunkExport } from '../../shared/voxel';
import { computeTintVolume, type TintVolume } from '../render/lightVolume';
import { lightDims } from '../render/lightService';
import { meshRegions, REGION_VOXELS, type RegionMesh } from '../render/worldMesh';
import { LocalLightFeed, WorkerLightFeed, type LightFeed } from './lightFeed';

export interface WorldData {
  world: VoxelWorld;
  regions: RegionMesh[];
  /** Éclairage (tuiles fines autour de la caméra, volume grossier de la ville). */
  lightFeed: LightFeed;
  tint: TintVolume;
  nav: NavGrid;
  props: PropPlacement[];
  lights: LightSource[];
  buildings: BuildingInfo[];
  smokes: { x: number; y: number; z: number; big: boolean }[];
  /** Écrans géants et hologrammes (contenu animé par le client). */
  screens: ScreenInfo[];
  holos: HoloInfo[];
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
    const t0 = performance.now();
    const workers: Worker[] = [];
    let failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      for (const w of workers) w.terminate();
      resolve(loadOnMainThread());
    };
    let main: Worker;
    try {
      main = new Worker(new URL('./worldWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      fail();
      return;
    }
    workers.push(main);
    // données reçues
    let meta: Record<string, unknown> | null = null;
    let world: VoxelWorld | null = null;
    let nav: NavGrid | null = null;
    const regions: RegionMesh[] = [];
    let total = -1;
    let meshed = 0;
    const finish = () => {
      if (failed || !meta || !world || !nav || meshed < total) return;
      for (const w of workers) w.terminate();
      const m = meta;
      const lightFeed = new WorkerLightFeed(lightDims(world), [world.sx, world.sy, world.sz], world.exportChunks(), m.lights as LightSource[]);
      progress('New York est prête.', 1);
      resolve({
        world,
        regions,
        lightFeed,
        tint: m.tint as TintVolume,
        nav,
        props: m.props as PropPlacement[],
        lights: m.lights as LightSource[],
        buildings: (m.buildings as BuildingInfo[]).sort((a, b) => a.id - b.id),
        smokes: m.smokes as WorldData['smokes'],
        screens: (m.screens as ScreenInfo[]) ?? [],
        holos: (m.holos as HoloInfo[]) ?? [],
        groundMap: m.groundMap as Uint8Array,
        gw: m.gw as number,
        gd: m.gd as number,
        ms: performance.now() - t0,
      });
    };
    const meshProgress = () => {
      if (total > 0) progress('Assemblage des façades…', 0.35 + 0.65 * (meshed / total));
    };
    main.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'progress') progress(m.step, m.f);
      else if (m.type === 'world') {
        meta = m;
        const [sx, sy, sz] = m.dims as number[];
        const w = new VoxelWorld(sx, sy, sz);
        w.importChunks(m.chunks as ChunkExport);
        world = w;
        // maillage réparti : chaque worker reçoit une copie du monde (compressé, quelques Mo)
        const list: [number, number][] = [];
        const rx = Math.ceil(w.cx / (REGION_VOXELS / CHUNK));
        const rz = Math.ceil(w.cz / (REGION_VOXELS / CHUNK));
        for (let gz = 0; gz < rz; gz++) for (let gx = 0; gx < rx; gx++) list.push([gx, gz]);
        total = list.length;
        const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
        for (let k = 0; k < n; k++) {
          let mw: Worker;
          try {
            mw = new Worker(new URL('./meshWorker.ts', import.meta.url), { type: 'module' });
          } catch {
            fail();
            return;
          }
          workers.push(mw);
          mw.onmessage = (ev: MessageEvent) => {
            if (ev.data.type === 'region') regions.push(ev.data.r as RegionMesh);
            meshed++;
            meshProgress();
            finish();
          };
          mw.onerror = fail;
          mw.postMessage({ dims: m.dims, chunks: m.chunks, regions: list.filter((_, i) => i % n === k) });
        }
        meshProgress();
      } else if (m.type === 'nav') {
        nav = NavGrid.deserialize(m.nav);
        finish();
      }
    };
    main.onerror = fail;
    main.postMessage('go');
  });
  return promise;
}

function loadOnMainThread(): WorldData {
  const t0 = performance.now();
  const city = generateCity();
  const tint = computeTintVolume(city.world, city.ctx.lights);
  const nav = buildCityNav(city);
  const regions = meshRegions(city.world);
  progress('New York est prête.', 1);
  return {
    world: city.world,
    regions,
    lightFeed: new LocalLightFeed(city.world, city.ctx.lights),
    tint,
    nav,
    props: city.ctx.props,
    lights: city.ctx.lights,
    buildings: [...city.buildings].sort((a, b) => a.id - b.id),
    smokes: city.ctx.smokes,
    screens: city.ctx.screens,
    holos: city.ctx.holos,
    groundMap: city.groundMap,
    gw: city.gw,
    gd: city.gd,
    ms: performance.now() - t0,
  };
}
