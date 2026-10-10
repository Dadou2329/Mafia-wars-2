// Tests automatiques sans navigateur : génération de New York 2085, navigation (étages,
// ascenseurs), simulation du serveur (ordres, combats, captures, ascension des logements,
// économie, événements, victoire), protocole et textes.
// Lancement : npm test

import fs from 'node:fs';
import path from 'node:path';
import { getWorld } from '../src/server/world';
import { Game } from '../src/server/game/Game';
import { BUILDINGS, BUILDING_BY_KEY, DISTRICTS, Faction, HQ_BUILDING, RESIDENCES, keyBuildings } from '../src/shared/city/plan';
import { decodeSnapshot, encodeSnapshot, type GameEvent } from '../src/shared/protocol';
import { DE_BOSS, HQ_CAPTURE_MIN_DISTRICTS, LIEUTENANT_PRICES, MAFIA_NAME, RECRUIT_BUNDLES, START_GANGSTERS, START_MONEY, TIERS } from '../src/shared/constants';
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
section('Génération de New York 2085');
const t0 = performance.now();
const w = getWorld();
console.log(`  (générée en ${(performance.now() - t0).toFixed(0)} ms)`);
check(`${BUILDINGS.length} bâtiments générés`, w.buildings.length === BUILDINGS.length, `${w.buildings.length}`);
check('7 quartiers', DISTRICTS.length === 7);
check('chaque bâtiment a une porte et une zone intérieure', w.buildings.every((b) => b.doors.length > 0 && b.zone.length > 0));
check('chaque quartier a au moins un bâtiment clé', DISTRICTS.every((d) => keyBuildings(d.id).length > 0));
for (const slot of ['dadou', 'even'] as const) {
  check(`échelle ${DE_BOSS[slot]} : 5 logements (planque → tour)`, RESIDENCES[slot].length === 5 && RESIDENCES[slot].every((r, i) => r.residence!.tier === i + 1));
  for (const r of RESIDENCES[slot]) {
    const info = w.byId.get(r.id)!;
    check(`${r.name} : bureau, fauteuil, rabatteur, armurerie`, !!(info.desk && info.deskSeat && info.recruit && info.armory), JSON.stringify({ desk: !!info.desk, seat: !!info.deskSeat, rec: !!info.recruit, arm: !!info.armory }));
  }
}
const towers = w.buildings.filter((b) => b.floors.length >= 3);
check('des immeubles à plusieurs étages', towers.length >= 6, `${towers.length}`);
check('des ascenseurs dans les tours', w.buildings.some((b) => (b.elevator?.length ?? 0) >= 3));

section('Navigation');
const hqD = w.byId.get(HQ_BUILDING.dadou.id)!;
let navFails = 0;
for (const b of w.buildings) {
  // le point praticable le plus proche du centre de la pièce principale (un ring, une table…)
  const n = w.nav.nearestWalkable(b.center.x, b.center.z, b.center.y ?? b.floorY, 6);
  const [cx, cz] = n >= 0 ? w.nav.nodeCenter(n) : [b.center.x, b.center.z];
  const p = w.nav.findPath(hqD.doors[0].out.x, hqD.doors[0].out.z, 0, cx, cz, b.center.y ?? b.floorY, 400000);
  const e = p ? p.length - 4 : 0;
  const ok = n >= 0 && !!p && Math.hypot(p[e] - cx, p[e + 1] - cz) < 2;
  if (!ok) {
    navFails++;
    console.log(`    inaccessible : ${b.def.name}`);
  }
}
check('tous les bâtiments sont accessibles à pied depuis la planque de Dadou', navFails === 0, `${navFails} échec(s)`);
// étages supérieurs : un point de défense au dernier étage de chaque immeuble
let floorFails = 0;
let floorTests = 0;
for (const b of w.buildings) {
  if (b.floors.length < 2) continue;
  const top = b.floors[b.floors.length - 1].y;
  const pt = b.defend.find((d) => Math.abs((d.y ?? 0) - top) < 0.6);
  if (!pt) continue;
  floorTests++;
  const p = w.nav.findPath(b.doors[0].out.x, b.doors[0].out.z, 0, pt.x, pt.z, pt.y ?? top, 400000);
  const e = p ? p.length - 4 : 0;
  if (!p || Math.hypot(p[e] - pt.x, p[e + 1] - pt.z) > 2 || Math.abs(p[e + 2] - top) > 1) {
    floorFails++;
    console.log(`    dernier étage inaccessible : ${b.def.name} (${top} m)`);
  }
}
check(`le dernier étage des immeubles est accessible (${floorTests} testés)`, floorFails === 0, `${floorFails} échec(s)`);

// ---------------------------------------------------------------------------- simulation
section('Simulation du serveur');
const g = new Game(w, { timeLimit: 0, daytime: 'night', weather: 'variable', tips: false });
g.takeOutbox();
const D = g.factions.dadou;
const E = g.factions.even;
check(`argent de départ : ${formatMoney(START_MONEY)}`, Math.round(D.money) === START_MONEY && Math.round(E.money) === START_MONEY);
check('un lieutenant de départ chacun', D.lieutenants.length === 1 && E.lieutenants.length === 1);
check('chacun commence dans sa planque (palier 1)', D.tier === 1 && E.tier === 1 && D.hqId === RESIDENCES.dadou[0].id && E.hqId === RESIDENCES.even[0].id);
const priv0 = g.privateState('dadou');
check(`${START_GANGSTERS} gangsters de départ`, priv0.men === START_GANGSTERS, `${priv0.men}`);
check('nom du premier lieutenant de Dadou : Vinnie Moretti', priv0.lieutenants[0]?.name === 'Vinnie Moretti', priv0.lieutenants[0]?.name);
check(`plafond d’effectif de la planque : ${TIERS[0].maxMen}`, priv0.maxMen === TIERS[0].maxMen);

const events: (GameEvent & { _to?: string })[] = [];
const drain = () => {
  const out = g.takeOutbox();
  for (const e of out.all) events.push(e);
  for (const e of out.dadou) events.push({ ...e, _to: 'dadou' });
  for (const e of out.even) events.push({ ...e, _to: 'even' });
};
const lastNotify = (slot: string) => [...events].reverse().find((e) => e.t === 'notify' && (e._to === slot || !e._to)) as { text: string } | undefined;

// recrutement
const m0 = D.money;
g.action('dadou', { a: 'recruit', n: 5 });
drain();
check(`« Recruter 5 gangsters » coûte ${formatMoney(RECRUIT_BUNDLES[1].price)}`, Math.round(m0 - D.money) === RECRUIT_BUNDLES[1].price, `${m0 - D.money}`);
check('les recrues rejoignent la mafia', g.privateState('dadou').men === START_GANGSTERS + 5);
D.money += 3000;
g.action('dadou', { a: 'hire' });
drain();
check(`engager un 2e lieutenant (${formatMoney(LIEUTENANT_PRICES[1])})`, D.lieutenants.length === 2);
check('le 2e lieutenant de Dadou s’appelle Sal Romano', g.privateState('dadou').lieutenants[1]?.name === 'Sal Romano');
g.action('dadou', { a: 'hire' });
drain();
check('la planque ne loge que 2 lieutenants', D.lieutenants.length === 2, lastNotify('dadou')?.text);

// ordres d'attaque : chaque lieutenant part prendre un bâtiment de son quartier
const targetD = BUILDING_BY_KEY['brasserie_williamsburg'].id;
const targetE = BUILDING_BY_KEY['usine_drones'].id;
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
const N = 20 * 300; // 5 minutes de jeu
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
check('Dadou a pris la Brasserie de Williamsburg', g.bstate.get(targetD)!.owner === Faction.DADOU, `propriétaire ${g.bstate.get(targetD)!.owner}`);
check('Even a pris l’Usine de drones Steinway', g.bstate.get(targetE)!.owner === Faction.EVEN, `propriétaire ${g.bstate.get(targetE)!.owner}`);
check('tick moyen < 6 ms', total / Math.max(1, g.tick) < 6, `${(total / Math.max(1, g.tick)).toFixed(2)} ms`);
console.log(`  (tick moyen ${(total / Math.max(1, g.tick)).toFixed(2)} ms, max ${maxTick.toFixed(1)} ms, ${g.time.toFixed(0)} s simulées)`);
g.step();
drain();
const st = g.privateState('dadou').lieutenants[0];
check('rapport de mission en français', typeof st.state === 'string' && st.state.length > 0, st.state);
check('revenus en hausse après la capture', g.privateState('dadou').income > 10, `${g.privateState('dadou').income} $/min`);

// notifications personnalisées
const texts = () => events.map((e) => ('text' in e ? String((e as { text: string }).text) : '') + ('title' in e ? String((e as { title: string }).title) : ''));
check('aucun « David » ni « Evan » dans les messages', !texts().some((t) => /\bDavid\b|\bEvan\b/.test(t)));
check('les messages nomment Dadou ou Even', texts().some((t) => t.includes('Dadou') || t.includes('Even')));
check('aucune trace de Londres dans les messages', !texts().some((t) => /Londres|Tamise|Scotland|£/.test(t)));

// ---------------------------------------------------------------------------- ascension
section('Ascension : de la planque à la tour');
{
  const garage = RESIDENCES.dadou[1];
  const loft = RESIDENCES.dadou[2];
  D.money = 0;
  g.action('dadou', { a: 'moveIn', b: garage.id });
  drain();
  check('emménager sans argent est refusé', D.tier === 1, lastNotify('dadou')?.text);
  g.action('dadou', { a: 'moveIn', b: loft.id });
  drain();
  check('impossible de sauter un palier', D.tier === 1, lastNotify('dadou')?.text);
  g.action('even', { a: 'moveIn', b: garage.id });
  drain();
  check('le logement de Dadou est réservé à Dadou', g.bstate.get(garage.id)!.owner === Faction.NEUTRAL, lastNotify('even')?.text);
  D.money = garage.price + 100;
  g.action('dadou', { a: 'moveIn', b: garage.id });
  drain();
  check(`Dadou emménage au ${garage.name} (palier 2)`, D.tier === 2 && D.hqId === garage.id && g.bstate.get(garage.id)!.owner === Faction.DADOU);
  check('le QG suit le parrain', g.hq('dadou').id === garage.id);
  const rec = [...g.ents.values()].find((e) => e.role === 'barman' && e.slot === 'dadou')!;
  const gInfo = w.byId.get(garage.id)!;
  check('le rabatteur s’installe au nouveau QG', Math.hypot(rec.x - gInfo.recruit!.x, rec.z - gInfo.recruit!.z) < 1.5);
  check('l’ancienne planque reste à Dadou', g.bstate.get(RESIDENCES.dadou[0].id)!.owner === Faction.DADOU);
  check(`le garage loge ${TIERS[1].maxMen} hommes et ${TIERS[1].maxLt} lieutenants`, g.privateState('dadou').maxMen === TIERS[1].maxMen && g.privateState('dadou').maxLt === TIERS[1].maxLt);
  check('nouvel événement « QG » diffusé', events.some((e) => e.t === 'hq' && e.slot === 'dadou' && e.b === garage.id));
  // la réserve rejoint le garage à pied
  for (let i = 0; i < 20 * 60; i++) g.step();
  drain();
  const pool = g.poolMembers('dadou');
  const near = pool.filter((e) => Math.hypot(e.x - gInfo.center.x, e.z - gInfo.center.z) < 30).length;
  check('la réserve a rejoint le nouveau QG à pied', pool.length === 0 || near >= pool.length * 0.6, `${near}/${pool.length}`);
  D.money = loft.price + 100;
  g.action('dadou', { a: 'moveIn', b: loft.id });
  drain();
  const needD = TIERS[2].districts;
  check(`le loft exige ${needD} quartier contrôlé`, g.territories('dadou') >= needD ? D.tier === 3 : D.tier === 2, lastNotify('dadou')?.text);
}

// lieutenant blessé : il reste dans la simulation et revient au QG après sa convalescence
{
  const ltId = E.lieutenants[0];
  const lte = g.ents.get(ltId)!;
  g.damage(lte, 9999, g.ents.get(D.bossId)!, false);
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
  boss.y = 0;
  g.step();
  drain();
  check('le premier parrain sur place empoche la cargaison', D.money - before >= 250, `${Math.round(D.money - before)} $`);
}

// météo partagée
check('la pluie est partagée par le serveur', typeof g.publicState().rain === 'number');

// victoire : Dadou prend le QG actuel d'Even après avoir pris 4 quartiers
{
  const evenHq = g.hq('even').def;
  const mine = DISTRICTS.filter((d) => d.id !== evenHq.district).slice(0, HQ_CAPTURE_MIN_DISTRICTS);
  for (const d of mine) for (const k of keyBuildings(d.id)) if (g.hqOwnerOf(k.id) !== 'even') g.setOwner(k.id, Faction.DADOU, 'dadou');
  drain();
  check(`Dadou contrôle au moins ${HQ_CAPTURE_MIN_DISTRICTS} quartiers`, g.territories('dadou') >= HQ_CAPTURE_MIN_DISTRICTS, `${g.territories('dadou')}`);
  g.setOwner(evenHq.id, Faction.DADOU, 'dadou');
  drain();
  const over = events.find((e) => e.t === 'over') as Extract<GameEvent, { t: 'over' }> | undefined;
  check('la prise du QG d’Even donne la victoire à Dadou', over?.winner === 'dadou', over ? over.reason : 'pas de fin');
}

// ---------------------------------------------------------------------------- protocole
section('Protocole');
const snap = encodeSnapshot(12.5, 77, [{ id: 3, x: 101.25, y: 21.5, z: 164.5, yaw: 1.2, pitch: -0.3, vx: 1.5, vz: -2, anim: 1, flags: 5, weapon: 1, hp: 0.5 }]);
const dec = decodeSnapshot(snap);
check(
  'instantané binaire encodé/décodé (étages compris)',
  dec.ents.length === 1 && Math.abs(dec.ents[0].x - 101.25) < 0.02 && Math.abs(dec.ents[0].z - 164.5) < 0.02 && Math.abs(dec.ents[0].y - 21.5) < 0.05 && dec.ents[0].anim === 1 && Math.abs(dec.ents[0].hp - 0.5) < 0.01,
  JSON.stringify(dec.ents[0]),
);

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
for (const s of [
  'Choisissez votre parrain',
  'Jouer ${BOSS_NAME[slot]}',
  'Créer une partie',
  'Rejoindre une partie',
  'RÈGNE SUR NEW YORK',
  'New York appartient désormais à',
  'Revanche',
  'Recruter',
  'Carte stratégique',
  'Emménager',
  'Suivez-moi',
  'Attaquez',
  'Défendez',
  'Repliez-vous',
  'Bureau ${DE_BOSS',
]) {
  check(`texte présent : « ${s} »`, all.includes(s));
}
check('aucune quête ni tutoriel imposé', !/class Tutorial|PREMIÈRE MISSION/.test(all));
check('ni loyauté, ni moral, ni fatigue', !/loyaut|moral\b|fatigue|faim\b|trahison/i.test(all.replace(/\/\/.*$/gm, '')));
const html = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'index.html'), 'utf8');
check('titre de la page : « MAFIA WARS II : Dadou vs Even »', html.includes('<title>MAFIA WARS II : Dadou vs Even</title>'));
check('icône de la page (favicon)', /rel="icon"/.test(html));

console.log(`\n${passed} réussi(s), ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
