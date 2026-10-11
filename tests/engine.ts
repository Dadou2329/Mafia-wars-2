// Tests du moteur (sans navigateur) : compression des tronçons voxel, lecture en bloc, maillage,
// navigation et éclairage par tuiles, comparés à leurs versions de référence.
// Lancement : npx tsx tests/engine.ts (compris dans npm test)

import { M, MAT_SOLID } from '../src/shared/materials';
import { NavGrid } from '../src/shared/nav';
import { CHUNK, CHUNK_VOL, packChunk, unpackChunk, VoxelWorld } from '../src/shared/voxel';
import { coarsen, LightService, tileSize } from '../src/client/render/lightService';
import { computeLightBox, computeLightVolume } from '../src/client/render/lightVolume';
import { meshRegions } from '../src/client/render/worldMesh';
import type { LightSource } from '../src/shared/city/gen/context';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function section(title: string): void {
  console.log(`\n${title}`);
}

let seed = 12345;
const rnd = (): number => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) / 16777216;
};
const ri = (n: number): number => Math.floor(rnd() * n);

const WALL = M.CONCRETE;
const GLASS = M.GLASS;

// ---------------------------------------------------------------------------- compression
section('Tronçons compressés');
{
  const cases: [string, (c: Uint8Array) => void][] = [
    ['tranches uniformes', (c) => c.fill(WALL, 0, 1024 * 7)],
    [
      'murs et fenêtres',
      (c) => {
        for (let y = 0; y < CHUNK; y++)
          for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) if (x < 2 || z === 31) c[(y << 10) | (z << 5) | x] = y % 6 < 3 && x === 1 ? GLASS : WALL;
      },
    ],
    [
      'boîtes aléatoires',
      (c) => {
        for (let n = 0; n < 20; n++) {
          const x0 = ri(32);
          const y0 = ri(32);
          const z0 = ri(32);
          const m = 1 + ri(40);
          for (let y = y0; y < Math.min(32, y0 + ri(12)); y++)
            for (let z = z0; z < Math.min(32, z0 + ri(12)); z++) for (let x = x0; x < Math.min(32, x0 + ri(12)); x++) c[(y << 10) | (z << 5) | x] = m;
        }
      },
    ],
  ];
  for (const [name, make] of cases) {
    const c = new Uint8Array(CHUNK_VOL);
    make(c);
    const p = packChunk(c);
    const back = new Uint8Array(CHUNK_VOL);
    if (p) unpackChunk(p, back);
    check(`${name} : compression sans perte (${p ? p.byteLength : '—'} o)`, !!p && back.every((v, i) => v === c[i]));
  }
  const noise = new Uint8Array(CHUNK_VOL);
  for (let i = 0; i < CHUNK_VOL; i++) noise[i] = ri(200);
  check('un bruit pur reste brut', packChunk(noise) === null);
}

// ---------------------------------------------------------------------------- monde
section('Monde voxel compressé');
function makeWorld(): { w: VoxelWorld; lights: LightSource[] } {
  const w = new VoxelWorld(160, 96, 128);
  // sol, sous-sol, quelques immeubles creux avec fenêtres et une arcade
  w.fill(0, 0, 0, 160, 34, 128, WALL);
  const lights: LightSource[] = [];
  for (let b = 0; b < 7; b++) {
    const x0 = 6 + ri(110);
    const z0 = 6 + ri(80);
    const sx = 16 + ri(28);
    const sz = 16 + ri(28);
    const h = 20 + ri(50);
    w.fill(x0, 34, z0, x0 + sx, 34 + h, z0 + sz, WALL);
    w.fill(x0 + 2, 34, z0 + 2, x0 + sx - 2, 34 + h - 2, z0 + sz - 2, 0);
    for (let y = 38; y < 34 + h - 4; y += 10) for (let x = x0 + 4; x < x0 + sx - 6; x += 8) w.fill(x, y, z0, x + 4, y + 4, z0 + 2, GLASS);
    w.fill(x0 + 4, 34, z0 + sz - 2, x0 + 8, 42, z0 + sz, 0); // porte
    lights.push({ x: (x0 + sx / 2) * 0.25, y: 2.5, z: (z0 + sz / 2) * 0.25, radius: 3 + ri(5), intensity: 0.9 } as LightSource);
  }
  for (let n = 0; n < 6; n++) lights.push({ x: 2 + rnd() * 36, y: 3, z: 2 + rnd() * 28, radius: 4 + rnd() * 10, intensity: 0.8 } as LightSource);
  return { w, lights };
}
const { w: world, lights } = makeWorld();
const raw = new Uint8Array(world.sx * world.sy * world.sz);
for (let y = 0; y < world.sy; y++) for (let z = 0; z < world.sz; z++) for (let x = 0; x < world.sx; x++) raw[(y * world.sz + z) * world.sx + x] = world.get(x, y, z);
const meshRaw = meshRegions(world);
const navRaw = NavGrid.build(world);
const lightRaw = computeLightVolume(world, lights);
world.compact();
let packedCount = 0;
for (const p of world.packed) if (p) packedCount++;
check('des tronçons sont compressés', packedCount > 0, `${packedCount}`);
let same = true;
for (let y = 0; y < world.sy && same; y++)
  for (let z = 0; z < world.sz && same; z++)
    for (let x = 0; x < world.sx; x++)
      if (world.get(x, y, z) !== raw[(y * world.sz + z) * world.sx + x]) {
        same = false;
        break;
      }
check('get() identique avant et après compression', same);
{
  // lecture en bloc, y compris hors du monde
  let ok = true;
  for (let n = 0; n < 40 && ok; n++) {
    const x0 = ri(world.sx + 20) - 10;
    const y0 = ri(world.sy + 20) - 10;
    const z0 = ri(world.sz + 20) - 10;
    const nx = 1 + ri(40);
    const ny = 1 + ri(40);
    const nz = 1 + ri(40);
    const out = new Uint8Array(nx * ny * nz).fill(77);
    world.copyBox(x0, y0, z0, nx, ny, nz, out, 0, nx * nz, nx);
    for (let y = 0; y < ny && ok; y++)
      for (let z = 0; z < nz && ok; z++)
        for (let x = 0; x < nx; x++)
          if (out[y * nx * nz + z * nx + x] !== world.get(x0 + x, y0 + y, z0 + z)) {
            ok = false;
            break;
          }
  }
  check('copyBox() identique à get() (bords et hors du monde compris)', ok);
}
{
  // écriture dans un tronçon compressé
  const ci = world.packed.findIndex((p) => p !== null);
  const cx = ci % world.cx;
  const cz = Math.floor(ci / world.cx) % world.cz;
  const cy = Math.floor(ci / (world.cx * world.cz));
  const x = cx * CHUNK + 5;
  const y = cy * CHUNK + 6;
  const z = cz * CHUNK + 7;
  const before = world.get(x + 1, y, z);
  world.set(x, y, z, 99);
  check('écrire dans un tronçon compressé le rend brut et garde ses voisins', world.get(x, y, z) === 99 && world.get(x + 1, y, z) === before && world.packed[ci] === null && world.chunks[ci] !== null);
  world.set(x, y, z, raw[(y * world.sz + z) * world.sx + x]);
  world.compact();
}
{
  const ex = world.exportChunks();
  const copy = new VoxelWorld(world.sx, world.sy, world.sz);
  copy.importChunks(ex);
  let ok = true;
  for (let n = 0; n < 20000 && ok; n++) {
    const x = ri(world.sx);
    const y = ri(world.sy);
    const z = ri(world.sz);
    if (copy.get(x, y, z) !== world.get(x, y, z)) ok = false;
  }
  check('export / import entre threads', ok);
}
{
  const meshPacked = meshRegions(world);
  const sig = (rs: typeof meshRaw) => {
    let h = 0;
    for (const r of rs) for (const a of [r.pos, r.nrm, r.dat]) for (let i = 0; i < a.length; i++) h = (Math.imul(h, 31) + a[i]) | 0;
    return `${rs.length}/${rs.reduce((s, r) => s + r.quads, 0)}/${h}`;
  };
  check('maillage identique (tronçons bruts ou compressés)', sig(meshRaw) === sig(meshPacked), `${sig(meshRaw)} ≠ ${sig(meshPacked)}`);
  const navPacked = NavGrid.build(world);
  check('navigation identique (tronçons bruts ou compressés)', navRaw.floor.every((v, i) => v === navPacked.floor[i]) && navRaw.count.every((v, i) => v === navPacked.count[i]));
  const walk = navPacked.count.reduce((s, c) => s + c, 0);
  check('la navigation trouve des sols', walk > 1000 && MAT_SOLID[WALL] === 1, `${walk}`);
}

// ---------------------------------------------------------------------------- éclairage
section('Éclairage par tuiles');
{
  const full = computeLightVolume(world, lights);
  check('volume complet identique (tronçons bruts ou compressés)', full.data.every((v, i) => v === lightRaw.data[i]));
  // boîtes quelconques
  let ok = true;
  for (let n = 0; n < 6 && ok; n++) {
    const i0 = ri(full.nx - 8);
    const k0 = ri(full.nz - 8);
    const ni = 1 + ri(full.nx - i0);
    const nk = 1 + ri(full.nz - k0);
    const box = computeLightBox(world, lights, i0, k0, ni, nk);
    for (let k = 0; k < nk && ok; k++)
      for (let j = 0; j < full.ny && ok; j++)
        for (let i = 0; i < ni * 2; i++)
          if (box[((k * full.ny + j) * ni) * 2 + i] !== full.data[(((k + k0) * full.ny + j) * full.nx + i0) * 2 + i]) {
            ok = false;
            break;
          }
  }
  check('une boîte calculée seule = le même morceau du volume complet', ok);
  const svc = new LightService(world, lights);
  const d = svc.dims;
  const tiles = svc.computeRect(0, 0, d.tx, d.tz);
  let tilesOk = tiles.length === d.tx * d.tz;
  let rleOk = true;
  let coarseOk = true;
  for (const { t, fine } of tiles) {
    const [w, dz] = tileSize(d, t);
    const tx = t % d.tx;
    const tz = (t - tx) / d.tx;
    for (let k = 0; k < dz && tilesOk; k++)
      for (let j = 0; j < d.ny && tilesOk; j++)
        for (let i = 0; i < w * 2; i++)
          if (fine[(k * d.ny + j) * w * 2 + i] !== full.data[((tz * 32 + k) * d.ny + j) * d.nx * 2 + tx * 64 + i]) {
            tilesOk = false;
            break;
          }
    const dec = svc.tile(t);
    if (!dec.every((v, i) => v === fine[i])) rleOk = false;
    const c = coarsen(d, fine, w, dz);
    // chaque cellule grossière = maximum de ses 8 cellules fines
    const cw = Math.ceil(w / 2);
    for (let n = 0; n < 50; n++) {
      const i = ri(w);
      const j = ri(d.ny);
      const k = ri(dz);
      const ci = ((Math.floor(k / 2) * d.cny + Math.floor(j / 2)) * cw + Math.floor(i / 2)) * 2;
      if (c[ci] < fine[((k * d.ny + j) * w + i) * 2] || c[ci + 1] < fine[((k * d.ny + j) * w + i) * 2 + 1]) coarseOk = false;
    }
  }
  check(`${tiles.length} tuiles identiques au volume complet`, tilesOk);
  check('cache compressé des tuiles sans perte', rleOk, `${(svc.bytes / 1024).toFixed(0)} Ko`);
  check('volume grossier : maximum des cellules fines', coarseOk);
  check('cache compressé plus petit que les tuiles', svc.bytes * 2 < full.data.byteLength, `${svc.bytes} / ${full.data.byteLength}`);
  const bg = new LightService(world, lights);
  const bgTiles = bg.computeRect(0, 0, 2, 2, 'never');
  check('tâche de fond : tuiles calculées sans encombrer le cache', bgTiles.length > 0 && bgTiles.every((r) => !bg.has(r.t)) && bg.bytes === 0);
}

console.log(`\n${passed} réussi(s), ${failed} échec(s)`);
if (failed > 0) process.exit(1);
