// Ascenseurs des parrains (serveur) : devant une porte, l'action « elevator » dépose le parrain à
// l'étage demandé ; loin d'une porte, ou vers l'étage où il est déjà, rien ne se passe.
// Usage : npx tsx tests/elevator.ts
import { getWorld } from '../src/server/world';
import { Game } from '../src/server/game/Game';

let failures = 0;
const check = (name: string, ok: boolean, info = ''): void => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${info ? ` — ${info}` : ''}`);
  if (!ok) failures++;
};

const w = getWorld();
const g = new Game(w, { timeLimit: 0, daytime: 'night', weather: 'clear', tips: false });
g.takeOutbox();
const D = g.factions.dadou;
const boss = g.ents.get(D.bossId)!;
const steps = (n: number): void => {
  for (let i = 0; i < n; i++) g.step();
  g.takeOutbox();
};

const towers = w.buildings.filter((b) => b.elevator && b.elevator.length >= 2);
check('des immeubles ont un ascenseur', towers.length > 0, towers.map((b) => b.def.name).join(', '));
for (const b of towers) {
  const stops = b.elevator!;
  const s0 = stops[0];
  g.teleport('dadou', s0.x, s0.y, s0.z, s0.yaw);
  steps(25); // délai de la téléportation et de l'ascenseur précédent
  const last = stops.length - 1;
  g.action('dadou', { a: 'elevator', b: b.id, to: last });
  const up = Math.hypot(boss.x - stops[last].x, boss.z - stops[last].z) < 0.5 && Math.abs(boss.y - stops[last].y) < 0.5;
  check(`${b.def.name} : ${s0.label} → ${stops[last].label}`, up, `y ${boss.y.toFixed(1)} (attendu ${stops[last].y.toFixed(1)})`);
  // le sol existe bien sous les pieds à l'arrivée (navigation)
  const ground = w.nav.heightAt(boss.x, boss.z, boss.y + 0.5);
  check(`${b.def.name} : on arrive sur un sol praticable`, Number.isFinite(ground) && Math.abs(ground - boss.y) < 0.6, `sol ${ground}`);
  steps(25);
  g.action('dadou', { a: 'elevator', b: b.id, to: 0 });
  check(`${b.def.name} : retour au ${s0.label}`, Math.abs(boss.y - s0.y) < 0.5);
}

// refus : loin d'une porte
const b = towers[0];
const st = b.elevator!;
g.teleport('dadou', st[0].x + 12, st[0].y, st[0].z, 0);
steps(25);
const y0 = boss.y;
g.action('dadou', { a: 'elevator', b: b.id, to: st.length - 1 });
check('loin de la porte : refusé', boss.y === y0 && Math.hypot(boss.x - st[0].x - 12, boss.z - st[0].z) < 0.01);

console.log(failures ? `\n${failures} échec(s)` : '\nAscenseurs : tout est bon.');
process.exit(failures ? 1 : 0);
