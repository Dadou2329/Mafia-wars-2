// Test de simulation serveur sans réseau : ordres de lieutenants, combats, capture.
import { getWorld } from '../src/server/world';
import { Game } from '../src/server/game/Game';
import { BUILDING_BY_KEY } from '../src/shared/city/plan';

const w = getWorld();
const g = new Game(w, { timeLimit: 0, daytime: 'night', tutorial: false });
g.takeOutbox();
const log = (s: string) => console.log(`[${g.time.toFixed(1).padStart(6)}s] ${s}`);
const dadou = g.factions.dadou;
const even = g.factions.even;
const ltD = dadou.lieutenants[0];
const ltE = even.lieutenants[0];
g.action('dadou', { a: 'order', lt: ltD, order: 'attack_building', target: BUILDING_BY_KEY['chat_noir'].id, men: 5 });
g.action('even', { a: 'order', lt: ltE, order: 'attack_building', target: BUILDING_BY_KEY['entrepot_morgan'].id, men: 5 });
let maxTick = 0;
let total = 0;
const N = 20 * 150;
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  g.step();
  const dt = performance.now() - t0;
  total += dt;
  maxTick = Math.max(maxTick, dt);
  const out = g.takeOutbox();
  for (const ev of [...out.all, ...out.dadou.map((e) => ({ ...e, _to: 'D' })), ...out.even.map((e) => ({ ...e, _to: 'E' }))] as any[]) {
    if (ev.t === 'notify' || ev.t === 'order' || ev.t === 'capture' || ev.t === 'district' || ev.t === 'news' || ev.t === 'killfeed')
      log(`${ev._to ?? '*'} ${ev.t}: ${ev.text ?? ev.title ?? JSON.stringify(ev)}`);
  }
  if (i % 200 === 0) {
    const sq = g.squads.get(ltD)!; const se = g.squads.get(ltE)!;
    const lt = g.ents.get(ltD)!;
    log(`D: ${sq.state} "${sq.status}" ${sq.members.size} hommes, lt@(${lt.x.toFixed(1)},${lt.z.toFixed(1)}) prog=${sq.progress.toFixed(2)} | E: ${se.state} "${se.status}" prog=${se.progress.toFixed(2)} | ents=${g.ents.size}`);
  }
}
log(`tick moyen ${(total / N).toFixed(2)} ms, max ${maxTick.toFixed(1)} ms`);
const own = (k: string) => g.bstate.get(BUILDING_BY_KEY[k].id)!.owner;
log(`Chat Noir owner=${own('chat_noir')} | Entrepôt Morgan owner=${own('entrepot_morgan')}`);
log(`argent D=${Math.floor(dadou.money)} E=${Math.floor(even.money)}`);
