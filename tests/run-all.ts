// Tests automatiques sans navigateur : génération de Londres, navigation, simulation du
// serveur (ordres, combats, captures, économie, événements, victoire), protocole et textes.
// Lancement : npm test

import fs from 'node:fs';
import path from 'node:path';
import { getWorld } from '../src/server/world';
import { Game } from '../src/server/game/Game';
import { BUILDINGS, BUILDING_BY_KEY, DISTRICTS, Faction, HQ_BUILDING, keyBuildings } from '../src/shared/city/plan';
import { decodeSnapshot, encodeSnapshot, type GameEvent } from '../src/shared/protocol';
import { DE_BOSS, LIEUTENANT_PRICES, MAFIA_NAME, RECRUIT_BUNDLES, START_GANGSTERS, START_MONEY } from '../src/shared/constants';
import { formatMoney } from '../src/shared/util';

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

// ---------------------------------------------------------------------------- monde
section('Génération de Londres');
const t0 = performance.now();
const w = getWorld();
console.log(`  (générée en ${(performance.now() - t0).toFixed(0)} ms)`);
check('35 bâtiments générés', w.buildings.length === BUILDINGS.length && BUILDINGS.length === 35, `${w.buildings.length}`);
check('6 quartiers', DISTRICTS.length === 6);
check('chaque bâtiment a une porte et une zone intérieure', w.buildings.every((b) => b.doors.length > 0 && b.zone.length > 0));
for (const slot of ['dadou', 'even'] as const) {
  const hq = w.byId.get(HQ_BUILDING[slot].id)!;
  check(`QG ${DE_BOSS[slot]} : bureau, fauteuil, comptoir, armurerie, plaque`, !!(hq.desk && hq.deskSeat && hq.recruit && hq.armory && hq.plaque));
}
check('chaque quartier a au moins un bâtiment clé', DISTRICTS.every((d) => keyBuildings(d.id).length > 0));

section('Navigation');
const hqD = w.byId.get(HQ_BUILDING.dadou.id)!;
let navFails = 0;
for (const b of w.buildings) {
  const p = w.nav.findPath(hqD.doors[0].out.x, hqD.doors[0].out.z, b.center.x, b.center.z, 200000);
  const ok = !!p && Math.hypot(p[p.length - 2] - b.center.x, p[p.length - 1] - b.center.z) < 2;
  if (!ok) {
    navFails++;
    console.log(`    inaccessible : ${b.def.name}`);
  }
}
check('tous les bâtiments sont accessibles à pied depuis le QG de Dadou', navFails === 0, `${navFails} échec(s)`);

// ---------------------------------------------------------------------------- simulation
section('Simulation du serveur');
const g = new Game(w, { timeLimit: 0, daytime: 'night', tutorial: false });
g.takeOutbox();
const D = g.factions.dadou;
const E = g.factions.even;
check(`argent de départ : ${formatMoney(START_MONEY)}`, Math.round(D.money) === START_MONEY && Math.round(E.money) === START_MONEY);
check('un lieutenant de départ chacun', D.lieutenants.length === 1 && E.lieutenants.length === 1);
const priv0 = g.privateState('dadou');
check(`${START_GANGSTERS} gangsters de départ`, priv0.men === START_GANGSTERS, `${priv0.men}`);
check('nom du premier lieutenant de Dadou : Arthur Collins', priv0.lieutenants[0]?.name === 'Arthur Collins', priv0.lieutenants[0]?.name);

const events: (GameEvent & { _to?: string })[] = [];
const drain = () => {
  const out = g.takeOutbox();
  for (const e of out.all) events.push(e);
  for (const e of out.dadou) events.push({ ...e, _to: 'dadou' });
  for (const e of out.even) events.push({ ...e, _to: 'even' });
};

// recrutement
const m0 = D.money;
g.action('dadou', { a: 'recruit', n: 5 });
drain();
check(`« Recruter 5 gangsters » coûte ${formatMoney(RECRUIT_BUNDLES[1].price)}`, Math.round(m0 - D.money) === RECRUIT_BUNDLES[1].price, `${m0 - D.money}`);
check('les recrues rejoignent la mafia', g.privateState('dadou').men === START_GANGSTERS + 5);
D.money += 1000;
g.action('dadou', { a: 'hire' });
drain();
check(`engager un 2e lieutenant (${formatMoney(LIEUTENANT_PRICES[1])})`, D.lieutenants.length === 2);
check('le 2e lieutenant de Dadou s’appelle Thomas Blake', g.privateState('dadou').lieutenants[1]?.name === 'Thomas Blake');

// ordres d'attaque : chaque lieutenant part prendre la cible de la première mission
const targetD = BUILDING_BY_KEY['chat_noir'].id;
const targetE = BUILDING_BY_KEY['entrepot_morgan'].id;
g.action('dadou', { a: 'order', lt: D.lieutenants[0], order: 'attack_building', target: targetD, men: 9 });
g.action('even', { a: 'recruit', n: 5 });
g.action('even', { a: 'order', lt: E.lieutenants[0], order: 'attack_building', target: targetE, men: 9 });
drain();
const orderOk = events.filter((e) => e.t === 'order' && e.ok);
check('les deux lieutenants accusent réception de l’ordre', orderOk.length === 2, JSON.stringify(orderOk.map((e) => (e as { text: string }).text)));
const ltStart = g.ents.get(D.lieutenants[0])!;
const startPos = { x: ltStart.x, z: ltStart.z };
let maxTick = 0;
let total = 0;
const N = 20 * 240; // 4 minutes de jeu
for (let i = 0; i < N; i++) {
  const t = performance.now();
  g.step();
  const dt = performance.now() - t;
  total += dt;
  maxTick = Math.max(maxTick, dt);
  drain();
  if (g.bstate.get(targetD)!.owner === Faction.DADOU && g.bstate.get(targetE)!.owner === Faction.EVEN) break;
}
const lt = g.ents.get(D.lieutenants[0])!;
check('le lieutenant s’est déplacé physiquement', Math.hypot(lt.x - startPos.x, lt.z - startPos.z) > 5 || g.bstate.get(targetD)!.owner === Faction.DADOU);
check('Dadou a pris Le Chat Noir', g.bstate.get(targetD)!.owner === Faction.DADOU, `propriétaire ${g.bstate.get(targetD)!.owner}`);
check('Even a pris l’Entrepôt Morgan', g.bstate.get(targetE)!.owner === Faction.EVEN, `propriétaire ${g.bstate.get(targetE)!.owner}`);
check('tick moyen < 5 ms', total / Math.max(1, g.tick) < 5, `${(total / Math.max(1, g.tick)).toFixed(2)} ms`);
console.log(`  (tick moyen ${(total / Math.max(1, g.tick)).toFixed(2)} ms, max ${maxTick.toFixed(1)} ms, ${g.time.toFixed(0)} s simulées)`);
const st = g.privateState('dadou').lieutenants[0];
check('rapport de mission en français', typeof st.state === 'string' && st.state.length > 0, st.state);
check('revenus en hausse après la capture', g.privateState('dadou').income > 0, `${g.privateState('dadou').income} £/min`);

// notifications personnalisées
const texts = events.map((e) => ('text' in e ? String((e as { text: string }).text) : '') + ('title' in e ? String((e as { title: string }).title) : ''));
check('aucun « David » ni « Evan » dans les messages', !texts.some((t) => /\bDavid\b|\bEvan\b/.test(t)));
check('les messages nomment Dadou ou Even', texts.some((t) => t.includes('Dadou') || t.includes('Even')));

// lieutenant blessé : il reste dans la simulation et revient au QG après sa convalescence
{
  const ltId = E.lieutenants[0];
  const lt = g.ents.get(ltId)!;
  g.damage(lt, 9999, g.ents.get(D.bossId)!, false);
  drain();
  check('un lieutenant abattu est « blessé »', g.privateState('even').lieutenants[0].alive === false);
  for (let i = 0; i < 20 * 30; i++) g.step();
  drain();
  let ok = true;
  try {
    g.privateState('even');
  } catch {
    ok = false;
  }
  check('l’état privé reste valide pendant la convalescence (30 s)', ok && g.ents.has(ltId));
  for (let i = 0; i < 20 * 20; i++) g.step();
  drain();
  check('le lieutenant revient au QG après 45 s', g.privateState('even').lieutenants[0].alive === true);
}

// ordres rapides
g.action('dadou', { a: 'quick', cmd: 'follow' });
drain();
check('ordre rapide « Suivez-moi » traité', events.some((e) => e.t === 'notify' && e._to === 'dadou' && /suivent|portée/.test((e as { text: string }).text)));

// événement aléatoire : cargaison de contrebande
(g as unknown as { eventAt: number }).eventAt = 0;
let ev: Game['activeEvent'] = null;
for (let i = 0; i < 400 && !ev; i++) {
  g.step();
  drain();
  if (g.activeEvent?.kind === 'contraband') ev = g.activeEvent;
  else if (g.activeEvent) {
    // autre événement : on le termine et on relance
    g.activeEvent.until = g.time;
    g.step();
    drain();
    (g as unknown as { eventAt: number }).eventAt = 0;
  }
}
check('un événement « contrebande » peut survenir', !!ev);
if (ev) {
  const boss = g.ents.get(D.bossId)!;
  const before = D.money;
  boss.x = ev.x;
  boss.z = ev.z;
  g.step();
  drain();
  check('le premier parrain sur place empoche la cargaison', D.money - before >= 200, `${Math.round(D.money - before)} £`);
}

// victoire : Dadou prend le QG d'Even après avoir pris 3 quartiers
for (const d of DISTRICTS.slice(0, 3)) for (const k of keyBuildings(d.id)) if (!k.hq || k.hq === 'dadou') g.setOwner(k.id, Faction.DADOU, 'dadou');
drain();
check('Dadou contrôle au moins 3 quartiers', g.territories('dadou') >= 3, `${g.territories('dadou')}`);
g.setOwner(HQ_BUILDING.even.id, Faction.DADOU, 'dadou');
drain();
const over = events.find((e) => e.t === 'over') as Extract<GameEvent, { t: 'over' }> | undefined;
check('la prise du QG d’Even donne la victoire à Dadou', over?.winner === 'dadou', over ? over.reason : 'pas de fin');

// ---------------------------------------------------------------------------- protocole
section('Protocole');
const snap = encodeSnapshot(12.5, 77, [{ id: 3, x: 101.25, y: 1.5, z: 64.5, yaw: 1.2, pitch: -0.3, vx: 1.5, vz: -2, anim: 1, flags: 5, weapon: 1, hp: 0.5 }]);
const dec = decodeSnapshot(snap);
check('instantané binaire encodé/décodé', dec.ents.length === 1 && Math.abs(dec.ents[0].x - 101.25) < 0.02 && Math.abs(dec.ents[0].z - 64.5) < 0.02 && dec.ents[0].anim === 1 && Math.abs(dec.ents[0].hp - 0.5) < 0.01);

// ---------------------------------------------------------------------------- textes
section('Textes et noms');
const root = path.resolve(import.meta.dirname, '..', 'src');
const files: string[] = [];
const walk = (d: string) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(ts|css|html)$/.test(f.name)) files.push(p);
  }
};
walk(root);
const all = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
check('jamais « David » ni « Evan » dans le code du jeu', !/\bDavid\b|\bEvan\b/.test(all));
check('« La Mafia de Dadou » et « La Mafia d’Even »', MAFIA_NAME.dadou === 'La Mafia de Dadou' && MAFIA_NAME.even === 'La Mafia d’Even');
for (const s of ['Choisissez votre parrain', 'Jouer ${BOSS_NAME[slot]}', 'RÈGNE SUR LONDRES', 'PREMIÈRE MISSION', 'PRENEZ LE CONTRÔLE', 'Lancer l’attaque', 'Suivez-moi', 'Attaquez', 'Défendez', 'Repliez-vous', 'Bureau ${DE_BOSS']) {
  check(`texte présent : « ${s} »`, all.includes(s));
}
const html = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'index.html'), 'utf8');
check('titre de la page : « MAFIA WARS : Dadou vs Even »', html.includes('<title>MAFIA WARS : Dadou vs Even</title>'));

console.log(`\n${passed} réussi(s), ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
