// Worker de maillage : reçoit une copie du monde et maille les régions qu'on lui confie (plusieurs
// workers se partagent la ville au chargement).
import { VoxelWorld, type ChunkExport } from '../../shared/voxel';
import { meshRegion } from '../render/worldMesh';

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent) => {
  const m = e.data as { dims: [number, number, number]; chunks: ChunkExport; regions: [number, number][] };
  const world = new VoxelWorld(m.dims[0], m.dims[1], m.dims[2]);
  world.importChunks(m.chunks);
  for (const [gx, gz] of m.regions) {
    const r = meshRegion(world, gx, gz);
    if (r.quads === 0) post({ type: 'empty' });
    else post({ type: 'region', r }, [r.pos.buffer, r.nrm.buffer, r.dat.buffer]);
  }
};
