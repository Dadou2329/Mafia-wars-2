// Diagnostic de déplacement des PNJ : des dizaines d'hommes traversent la ville (de la rue vers
// l'intérieur d'un autre bâtiment, ses pièces, ses étages, le toit des tours par l'ascenseur),
// sans combat. On mesure les arrivées, les durées et les endroits où ils restent bloqués.
// Usage : npx tsx tests/nav-stress.ts [secondes de jeu] [graine]   (N=…, CROWD=10 : escouades)
// Réussi si au moins 98 % arrivent et si au plus 2 % restent bloqués plus de 1,5 s.
import { CharKind, Weapon } from '../src/shared/characters';
import { getWorld } from '../src/server/world';
import { Game } from '../src/server/game/Game';
import type { Ent } from '../src/server/game/types';

const SECONDS = Number(process.argv[2] ?? 240);
let seed = Number(process.argv[3] ?? 7);
const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const w = getWorld();
const g = new Game(w, { timeLimit: 0, daytime: 'night', weather: 'clear', tips: false });
g.takeOutbox();
const nav = w.nav;

type Pt = { x: number; z: number; y: number; label: string };
const blds = w.buildings.filter((b) => b.doors.length > 0);
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const roomPt = (b: (typeof blds)[number]): Pt | null => {
  const rooms = b.rooms.filter((r) => r.rect[2] - r.rect[0] > 2 && r.rect[3] - r.rect[1] > 2);
  if (!rooms.length) return null;
  const r = pick(rooms);
  for (let k = 0; k < 10; k++) {
    const x = r.rect[0] + 0.8 + rnd() * (r.rect[2] - r.rect[0] - 1.6);
    const z = r.rect[1] + 0.8 + rnd() * (r.rect[3] - r.rect[1] - 1.6);
    if (nav.walkable(x, z, r.y)) return { x, z, y: r.y, label: `${b.def.name}/${r.kind}` };
  }
  return null;
};

interface Run {
  e: Ent;
  from: Pt;
  to: Pt;
  dist: number;
  arrivedAt: number;
  stuckEpisodes: number;
  wasStuck: boolean;
  best: number;
  bestAt: number;
}
const runs: Run[] = [];
const N = Number(process.env.N ?? 60);
// CROWD=k : par groupes de k hommes partant du même trottoir vers le même bâtiment (escouades)
const CROWD = Number(process.env.CROWD ?? 1);
let ga = blds[0];
let gb = blds[1];
for (let i = 0; i < N * 4 && runs.length < N; i++) {
  if (runs.length % CROWD === 0 || i % CROWD === 0) {
    ga = pick(blds);
    gb = pick(blds);
  }
  const a = CROWD > 1 ? ga : pick(blds);
  const b = CROWD > 1 ? gb : pick(blds);
  if (a === b) continue;
  const da = pick(a.doors);
  const from: Pt = { ...da.out, y: da.out.y ?? 0, label: `rue devant ${a.def.name}` };
  let to: Pt | null;
  const kind = rnd();
  if (kind < 0.25 && b.elevator?.length) {
    const s = b.elevator[b.elevator.length - 1];
    to = { x: s.x, z: s.z, y: s.y, label: `${b.def.name}/${s.label}` };
  } else if (kind < 0.45) {
    const d = pick(b.doors);
    to = { ...d.in, y: d.in.y ?? 0, label: `${b.def.name}/entrée` };
  } else to = roomPt(b);
  if (!to) continue;
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  if (dist < 20 || dist > 220) continue;
  if (!nav.walkable(from.x, from.z, from.y) || !nav.walkable(to.x, to.z, to.y)) continue;
  if (CROWD > 1) {
    const ox = from.x + (rnd() - 0.5) * 3;
    const oz = from.z + (rnd() - 0.5) * 3;
    if (nav.walkable(ox, oz, from.y)) {
      from.x = ox;
      from.z = oz;
    }
  }
  const e = g.addEnt({ kind: CharKind.GANGSTER, role: 'gangster', faction: g.factions.dadou.faction, slot: 'dadou', x: from.x, z: from.z, y: from.y, hp: 100000, weapon: Weapon.FISTS, mode: 'guard' });
  e.ai!.scanAt = Infinity; // pas de combat : on ne mesure que la marche
  e.ai!.post = { x: to.x, z: to.z, y: to.y };
  e.ai!.run = true;
  e.ai!.leash = 1e9;
  runs.push({ e, from, to, dist, arrivedAt: -1, stuckEpisodes: 0, wasStuck: false, best: Infinity, bestAt: 0 });
}

const t0 = performance.now();
const steps = SECONDS * 20;
for (let s = 0; s < steps; s++) {
  g.step();
  g.takeOutbox();
  for (const r of runs) {
    const e = r.e;
    if (r.arrivedAt >= 0) continue;
    if (!e.alive) continue;
    const d = Math.hypot(e.x - r.to.x, e.z - r.to.z) + Math.abs(e.y - r.to.y) * 3;
    if (d < r.best - 0.5) {
      r.best = d;
      r.bestAt = g.time;
    }
    if (Math.hypot(e.x - r.to.x, e.z - r.to.z) < 1.5 && Math.abs(e.y - r.to.y) < 1.2) r.arrivedAt = g.time;
    const stuck = (e.ai?.stuck ?? 0) > 1.5;
    if (stuck && !r.wasStuck) r.stuckEpisodes++;
    r.wasStuck = stuck;
  }
}
const ms = performance.now() - t0;
const arrived = runs.filter((r) => r.arrivedAt >= 0);
const failed = runs.filter((r) => r.arrivedAt < 0);
const speed = arrived.map((r) => r.dist / r.arrivedAt);
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
console.log(`\n${runs.length} trajets, ${SECONDS} s de jeu (${(ms / 1000).toFixed(1)} s de calcul)`);
console.log(`arrivés : ${arrived.length}/${runs.length} (${((arrived.length / runs.length) * 100).toFixed(0)} %)`);
console.log(`vitesse moyenne à vol d'oiseau des arrivés : ${avg(speed).toFixed(2)} m/s ; durée moyenne ${avg(arrived.map((r) => r.arrivedAt)).toFixed(0)} s`);
console.log(`épisodes de blocage (> 1,5 s) : ${runs.reduce((a, r) => a + r.stuckEpisodes, 0)} au total, ${runs.filter((r) => r.stuckEpisodes > 0).length} hommes concernés`);
const stall = failed.filter((r) => g.time - r.bestAt > 30);
console.log(`non arrivés : ${failed.length}, dont ${stall.length} sans progrès depuis 30 s`);
for (const r of failed.slice(0, 25)) {
  const e = r.e;
  const ai = e.ai!;
  console.log(
    `  ✘ ${r.from.label} → ${r.to.label} (${r.dist.toFixed(0)} m) : reste ${Math.hypot(e.x - r.to.x, e.z - r.to.z).toFixed(1)} m, dy ${(e.y - r.to.y).toFixed(1)} ; ` +
      `pos ${e.x.toFixed(1)},${e.y.toFixed(1)},${e.z.toFixed(1)} ; sans progrès depuis ${(g.time - r.bestAt).toFixed(0)} s ; blocages ${r.stuckEpisodes} ; chemin ${ai.path ? `${ai.pathI}/${ai.path.length / 4}` : 'aucun'} ; nœud ${nav.nodeAt(e.x, e.z, e.y, 1.5)}`,
  );
}
if (process.env.DUMP)
  for (const r of failed) {
    const e = r.e;
    const ai = e.ai!;
    const p = ai.path ?? [];
    const pts: string[] = [];
    for (let i = 0; i < p.length; i += 4) pts.push(`${i / 4 === ai.pathI ? '>' : ''}(${p[i].toFixed(1)},${p[i + 2].toFixed(1)},${p[i + 1].toFixed(1)}${p[i + 3] >= 0 ? ` portail ${p[i + 3]}` : ''} nœud ${nav.nodeAt(p[i], p[i + 1], p[i + 2], 1.5)})`);
    console.log(`  chemin de ${r.to.label} : ${pts.join(' ')}`);
    const fresh = nav.findPath(e.x, e.z, e.y, r.to.x, r.to.z, r.to.y, 25000);
    const big = nav.findPath(e.x, e.z, e.y, r.to.x, r.to.z, r.to.y, 800000);
    const lastY = big ? big[big.length - 2] : NaN;
    const endD = big ? Math.hypot(big[big.length - 4] - r.to.x, big[big.length - 3] - r.to.z) : NaN;
    console.log(`  recherche sans limite : ${big ? `${big.length / 4} points, fin à ${endD.toFixed(1)} m, y ${lastY.toFixed(1)}` : 'aucun chemin'}`);
    console.log(`  nouveau calcul depuis la position : ${fresh ? fresh.length / 4 + ' points, fin ' + fresh.slice(-4, -1).map((v) => v.toFixed(1)).join(',') : 'aucun'} ; ligne directe ${nav.lineWalkable(e.x, e.z, r.to.x, r.to.z, 1, e.y, r.to.y)}`);
  }
if (process.env.JSON) console.log(JSON.stringify({ arrived: arrived.length, total: runs.length, stuck: runs.reduce((a, r) => a + r.stuckEpisodes, 0), avgSpeed: avg(speed) }));

const okArr = arrived.length >= runs.length * 0.98;
const okStuck = runs.filter((r) => r.stuckEpisodes > 0).length <= Math.ceil(runs.length * 0.02);
console.log(okArr && okStuck ? '\nDéplacements des PNJ : tout est bon.' : '\nDéplacements des PNJ : ÉCHEC');
process.exit(okArr && okStuck ? 0 : 1);
