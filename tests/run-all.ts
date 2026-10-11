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
import { MAT_BREAKABLE, firstGlass } from '../src/shared/glass';
import { GRENADE_FUSE, stepGrenade, throwVelocity } from '../src/shared/grenade';
import { GROUND_VY, VOXEL } from '../src/shared/voxel';

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
check('13 quartiers', DISTRICTS.length === 13);
check('chaque bâtiment a une porte et une zone intérieure', w.buildings.every((b) => b.doors.length > 0 && b.zone.length > 0));
check('chaque quartier a au moins un bâtiment clé', DISTRICTS.every((d) => keyBuildings(d.id).length > 0));
for (const slot of ['dadou', 'even'] as const) {
  check(`échelle ${DE_BOSS[slot]} : 5 logements (planque → tour)`, RESIDENCES[slot].length === 5 && RESIDENCES[slot].every((r, i) => r.residence!.tier === i + 1));
  for (const r of RESIDENCES[slot]) {
    const info = w.byId.get(r.id)!;
    check(`${r.name} : bureau, fauteuil, rabatteur, armurerie`, !!(info.desk && info.deskSeat && info.recruit && info.armory), JSON.stringify({ desk: !!info.desk, seat: !!info.deskSeat, rec: !!info.recruit, arm: !!info.armory }));
    if (info.deskSeat && info.desk) {
      // le parrain apparaît là : rien d'encombrant (meuble, chaise) à hauteur d'homme, et il regarde son bureau
      const s = info.deskSeat;
      const y0 = s.y ?? info.floorY;
      let free = true;
      for (let dy = 0.1; dy < 1.7; dy += 0.25) for (const [ox, oz] of [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]]) if (w.city.world.solidAt(s.x + ox, y0 + dy, s.z + oz)) free = false;
      check(`${r.name} : la place du parrain au bureau est dégagée`, free);
    }
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
let travelled = 0;
// l'assaut peut échouer (combat aléatoire : le lieutenant tombe face au gang) : une seconde
// vague est alors lancée, comme le ferait un joueur
for (let wave = 0; wave < 2; wave++) {
  if (wave === 1) {
    if (g.bstate.get(targetD)!.owner !== Faction.DADOU) g.action('dadou', { a: 'order', lt: D.lieutenants[0], order: 'attack_building', target: targetD, men: 9 });
    if (g.bstate.get(targetE)!.owner !== Faction.EVEN) g.action('even', { a: 'order', lt: E.lieutenants[0], order: 'attack_building', target: targetE, men: 9 });
    drain();
  }
  const N = 20 * 300; // 5 minutes de jeu par vague
  for (let i = 0; i < N; i++) {
    const t = performance.now();
    g.step();
    const dt = performance.now() - t;
    total += dt;
    maxTick = Math.max(maxTick, dt);
    drain();
    const l = g.ents.get(D.lieutenants[0]);
    if (l) travelled = Math.max(travelled, Math.hypot(l.x - startPos.x, l.z - startPos.z));
    if (g.bstate.get(targetD)!.owner === Faction.DADOU && g.bstate.get(targetE)!.owner === Faction.EVEN) break;
  }
  if (g.bstate.get(targetD)!.owner === Faction.DADOU && g.bstate.get(targetE)!.owner === Faction.EVEN) break;
  // seconde vague : le lieutenant blessé doit d'abord être revenu au QG
  for (let i = 0; i < 20 * 120 && (g.squads.get(D.lieutenants[0])?.state === 'down' || g.squads.get(E.lieutenants[0])?.state === 'down'); i++) {
    g.step();
    drain();
  }
}
check('le lieutenant s’est déplacé physiquement', travelled > 5 || g.bstate.get(targetD)!.owner === Faction.DADOU, `${travelled.toFixed(1)} m`);
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
  check(`le loft exige ${needD} quartier${needD > 1 ? 's' : ''} contrôlé${needD > 1 ? 's' : ''}`, g.territories('dadou') >= needD ? D.tier === 3 : D.tier === 2, lastNotify('dadou')?.text);
}

// la tour (palier 5) : tourelles automatiques au QG (partie séparée, on force les paliers)
{
  const g5 = new Game(w, { timeLimit: 0, daytime: 'night', weather: 'clear', tips: false });
  g5.takeOutbox();
  const tower = RESIDENCES.even[4];
  g5.factions.even.tier = 4;
  g5.moveHq('even', tower.id);
  const tur = [...g5.ents.values()].filter((e) => e.role === 'turret' && e.alive && e.ai?.home === tower.id);
  check(`la ${tower.name} (palier 5) est défendue par des tourelles`, tur.length >= 2 && tur.every((t) => t.slot === 'even'), `${tur.length}`);
}

// ---------------------------------------------------------------------------- véhicules
section('Véhicules');
{
  const moto = [...g.ents.values()].find((e) => e.role === 'vehicle' && e.veh?.owner === 'dadou' && e.veh.def === 0);
  check('la moto de Dadou l’attend devant sa planque', !!moto);
  const boss = g.ents.get(D.bossId)!;
  if (moto) {
    // le parrain rejoint sa moto et monte
    boss.x = moto.x + 1.5;
    boss.z = moto.z;
    boss.y = moto.y;
    g.action('dadou', { a: 'vehicle', op: 'enter', id: moto.id });
    drain();
    check('monter sur sa moto', D.vehicle === moto.id && moto.veh!.driver === boss.id, lastNotify('dadou')?.text);
    check('le serveur publie qui conduit', g.publicState().rides.some(([v, d]) => v === moto.id && d === boss.id));
    // conduite : le client envoie la position du véhicule
    let ok = true;
    for (let i = 0; i < 10; i++) {
      g.step();
      g.input('dadou', [moto.x + 0.9, moto.y, moto.z, moto.yaw, 0, 18, 0, 6, 64, 1, D.tp]);
      if (Math.abs(boss.x - moto.x) > 0.01) ok = false;
    }
    check('la moto avance et le parrain la suit', ok && Math.hypot(moto.vx, moto.vz) > 10);
    moto.vx = moto.vz = 0;
    g.action('dadou', { a: 'vehicle', op: 'exit' });
    drain();
    check('descendre de la moto', D.vehicle === -1 && moto.veh!.driver === -1);
  }
  // achat et livraison d'une berline (palier 2 atteint plus haut)
  D.money = 5000;
  const before = [...g.ents.values()].filter((e) => e.role === 'vehicle').length;
  g.action('dadou', { a: 'vehicle', op: 'buy', v: 1 });
  drain();
  const after = [...g.ents.values()].filter((e) => e.role === 'vehicle').length;
  check('acheter une berline : elle est livrée dans une rue proche', D.garage.has(1) && after === before + 1, lastNotify('dadou')?.text);
  // destruction
  const car = g.ents.get(D.vehicles.get(1)!)!;
  g.damage(car, 99999, g.ents.get(E.bossId)!);
  drain();
  check('un véhicule détruit explose (épave)', !car.alive && events.some((e) => e.t === 'boom'));
  check('le garage impose un délai après une destruction', g.privateState('dadou').callIn > 20);
}

// ---------------------------------------------------------------------------- sécurité, braquage, drone
section('Sécurité, piratage, braquage, drone');
{
  const bank = BUILDING_BY_KEY['banque_federale'];
  const info = w.byId.get(bank.id)!;
  const turrets = [...g.ents.values()].filter((e) => e.role === 'turret' && e.ai?.home === bank.id && e.alive);
  check('des tourelles gardent la Banque Fédérale', turrets.length >= 2, `${turrets.length}`);
  // caméras : un parrain qui entre dans un bâtiment protégé sans maître est filmé, le NYPD prévenu
  {
    const gal = BUILDING_BY_KEY['galerie_sterling'];
    const gi = w.byId.get(gal.id)!;
    const eb = g.ents.get(E.bossId)!;
    const h0 = E.heat;
    const p = gi.defend.find((d) => Math.abs((d.y ?? gi.floorY) - gi.floorY) < 0.6) ?? gi.center;
    const saved = { x: eb.x, y: eb.y, z: eb.z };
    eb.invulnerable = true;
    for (let i = 0; i < 20 * 3; i++) {
      eb.x = p.x;
      eb.z = p.z;
      eb.y = p.y ?? gi.floorY;
      g.step();
    }
    drain();
    check('les caméras filment un intrus : le NYPD est prévenu', E.heat > h0, `${h0.toFixed(2)} → ${E.heat.toFixed(2)}`);
    eb.invulnerable = false;
    eb.x = saved.x;
    eb.y = saved.y;
    eb.z = saved.z;
    E.heat = 0;
  }
  check('un terminal de sécurité et un coffre', !!info.terminal && !!info.vault);
  const boss = g.ents.get(D.bossId)!;
  boss.invulnerable = true;
  // on fait le ménage dans la banque pour un test déterministe
  for (const id of g.bstate.get(bank.id)!.thugs) {
    const t = g.ents.get(id);
    if (t && t.alive) g.damage(t, 9999, null);
  }
  if (info.terminal && info.vault) {
    boss.x = info.vault.x;
    boss.z = info.vault.z;
    boss.y = info.vault.y ?? info.floorY;
    g.action('dadou', { a: 'heist', b: bank.id });
    drain();
    check('coffre verrouillé tant que la sécurité n’est pas piratée', !g.publicState().heists.some((h) => h.b === bank.id), lastNotify('dadou')?.text);
    boss.x = info.terminal.x;
    boss.z = info.terminal.z;
    boss.y = info.terminal.y ?? info.floorY;
    g.action('dadou', { a: 'hack', b: bank.id });
    for (let i = 0; i < 20 * 8; i++) g.step();
    drain();
    check('piratage du terminal : sécurité coupée', g.publicState().hacked.includes(bank.id), lastNotify('dadou')?.text);
    boss.x = info.vault.x;
    boss.z = info.vault.z;
    boss.y = info.vault.y ?? info.floorY;
    const m0 = D.money;
    g.action('dadou', { a: 'heist', b: bank.id });
    drain();
    check('le braquage commence', g.publicState().heists.some((h) => h.b === bank.id && h.slot === 'dadou'));
    for (let i = 0; i < 20 * (bank.heist!.time + 2); i++) {
      boss.x = info.vault.x;
      boss.z = info.vault.z;
      boss.y = info.vault.y ?? info.floorY;
      boss.hp = boss.maxHp;
      g.step();
    }
    drain();
    check(`braquage réussi : +${formatMoney(bank.heist!.reward)}`, D.money - m0 >= bank.heist!.reward - 1, `${Math.round(D.money - m0)} $`);
  }
  boss.invulnerable = false;
  // drone de reconnaissance
  D.upgrades.add('drones');
  g.action('dadou', { a: 'drone', d: 'astoria' });
  for (let i = 0; i < 20 * 40; i++) {
    g.step();
    if (g.privateState('dadou').droneOver === 'astoria') break;
  }
  drain();
  check('un drone survole Astoria et révèle les ennemis', g.privateState('dadou').droneOver === 'astoria', JSON.stringify(g.privateState('dadou').droneOver));
}

// ---------------------------------------------------------------------------- convois
section('Verre destructible');
{
  const vw = w.city.world;
  check('les vitres (vitrines, baies) sont cassables', MAT_BREAKABLE.reduce((a, b) => a + b, 0) >= 3);
  // une vitrine à hauteur d'homme : on cherche du verre avec de l'air devant (côté rue)
  let pane: { x: number; y: number; z: number } | null = null;
  for (let y = GROUND_VY + 5; y < GROUND_VY + 8 && !pane; y++)
    for (let z = 4; z < vw.sz - 4 && !pane; z += 3)
      for (let x = 4; x < vw.sx - 4; x += 1) {
        if (!MAT_BREAKABLE[vw.get(x, y, z)] || vw.get(x, y, z - 8) !== 0 || vw.get(x, y, z - 1) !== 0) continue;
        pane = { x: (x + 0.5) * VOXEL, y: (y - GROUND_VY + 0.5) * VOXEL, z: (z + 0.5) * VOXEL };
        break;
      }
  check('une vitrine trouvée dans la ville', !!pane);
  if (pane) {
    const hit = firstGlass(vw, pane.x, pane.y, pane.z - 3, 0, 0, 1, 10, (k) => g.brokenGlass.has(k));
    check('une balle tirée vers la vitrine la rencontre', !!hit && Math.abs(hit.z - pane.z) < 0.5);
    const n0 = g.glassLog.length;
    g.shatter(pane.x, pane.y, pane.z, 0.6);
    check('la vitre se brise (serveur, diffusé aux clients)', g.glassLog.length === n0 + 1 && g.brokenGlass.size > 0);
    check('le monde partagé entre les salons reste intact', MAT_BREAKABLE[vw.get(Math.floor(pane.x / VOXEL), Math.floor(pane.y / VOXEL) + GROUND_VY, Math.floor(pane.z / VOXEL))] === 1);
    g.shatter(pane.x, pane.y, pane.z, 0.6);
    check('une vitre déjà brisée ne se brise pas deux fois', g.glassLog.length === n0 + 1);
    check('la balle suivante passe par le trou', !firstGlass(vw, pane.x, pane.y, pane.z - 3, 0, 0, 1, 3.2, (k) => g.brokenGlass.has(k)));
  }
}

section('NYPD 2085');
{
  const boss = g.ents.get(D.bossId)!;
  const police = (): number => [...g.ents.values()].filter((e) => e.role === 'police' && e.alive).length;
  const p0 = police();
  D.heat = 2.5;
  let cruiser = undefined as ReturnType<typeof g.ents.get>;
  // (un croiseur a peut-être déjà été envoyé pendant le braquage : délai entre deux envois)
  for (let i = 0; i < 20 * 90 && !cruiser; i++) {
    D.heat = Math.max(D.heat, 2.5);
    boss.hp = boss.maxHp;
    g.step();
    cruiser = [...g.ents.values()].find((e) => e.role === 'vehicle' && e.veh?.def === 5 && e.alive && !!e.veh.auto);
  }
  drain();
  check('un parrain recherché : un croiseur du NYPD part du commissariat', !!cruiser, lastNotify('dadou')?.text);
  if (cruiser) {
    let moved = 0;
    let px = cruiser.x;
    let pz = cruiser.z;
    for (let i = 0; i < 20 * 95 && cruiser.veh!.auto; i++) {
      D.heat = Math.max(D.heat, 2.5);
      boss.hp = boss.maxHp;
      g.step();
      moved += Math.hypot(cruiser.x - px, cruiser.z - pz);
      px = cruiser.x;
      pz = cruiser.z;
    }
    drain();
    check('le croiseur roule dans les rues', moved > 15, `${moved.toFixed(0)} m`);
    check('arrivé, il dépose ses agents', police() > p0 && !cruiser.veh!.auto, `${p0} → ${police()}`);
  }
  D.heat = 0;
  for (const e of g.ents.values()) if (e.role === 'police') e.ai!.aggro.clear();
  // planque sûre : caché dans un de ses bâtiments, le parrain sème la police bien plus vite
  {
    const hide = g.hq('dadou');
    const p = hide.defend.find((d) => Math.abs((d.y ?? hide.floorY) - hide.floorY) < 0.6) ?? hide.center;
    D.heat = 3;
    D.heatSeenAt = g.time - 20;
    boss.lastDamageAt = g.time - 20;
    for (let i = 0; i < 20 * 3; i++) {
      boss.x = p.x;
      boss.z = p.z;
      boss.y = p.y ?? hide.floorY;
      D.heatSeenAt = Math.min(D.heatSeenAt, g.time - 4);
      g.step();
    }
    drain();
    check('caché dans sa planque, le parrain sème la police', D.heat < 1.5, `3 → ${D.heat.toFixed(2)}`);
    D.heat = 0;
  }
}

section('Grenades');
{
  const boss = g.ents.get(D.bossId)!;
  // un homme d'Even à 6 m devant Dadou, en pleine rue
  const victim = [...g.ents.values()].find((e) => e.alive && e.slot === 'even' && e.role === 'gangster')!;
  const spot = BUILDING_BY_KEY['zabar'];
  const out = g.building(spot.id).doors[0].out;
  boss.x = out.x;
  boss.z = out.z - 3;
  boss.y = 0;
  boss.invulnerable = true;
  // où tombera-t-elle ? (même trajectoire que le serveur)
  const dir: [number, number, number] = [0, -0.2, -1];
  const body = { x: boss.x, y: 1.5, z: boss.z, ...throwVelocity(dir[0], dir[1], dir[2]) };
  for (let t = 0; t < GRENADE_FUSE; t += 0.05) stepGrenade(w.city.world, body, 0.05);
  const vx = body.x + 2;
  const vz = body.z;
  victim.x = vx;
  victim.z = vz;
  victim.y = 0;
  victim.hp = victim.maxHp;
  victim.ai!.path = null;
  const n0 = D.grenades;
  const hp0 = victim.hp;
  g.action('dadou', { a: 'grenade', o: [boss.x, 1.5, boss.z], d: dir });
  drain();
  check('lancer une grenade (il en reste une de moins)', D.grenades === n0 - 1, `${n0} → ${D.grenades}`);
  check('la grenade est annoncée aux clients', events.some((e) => e.t === 'grenade'));
  for (let i = 0; i < 20 * 2.2; i++) {
    victim.x = vx;
    victim.z = vz;
    g.step();
  }
  drain();
  check('l’explosion blesse les ennemis proches', !victim.alive || victim.hp < hp0, `${hp0} → ${Math.round(victim.hp)}`);
  check('et diffuse une explosion', events.some((e) => e.t === 'boom'));
  boss.invulnerable = false;
  D.heat = 0;
}

section('Convois blindés');
{
  // Dadou possède la Brasserie de Williamsburg (bâtiment logistique) : il envoie un convoi
  g.action('dadou', { a: 'convoy' });
  drain();
  const conv = g.publicState().convoys.find((c) => c.slot === 'dadou');
  check('envoyer un convoi depuis un bâtiment logistique', !!conv, lastNotify('dadou')?.text);
  if (conv) {
    const truck = g.ents.get(conv.id)!;
    const x0 = truck.x;
    const z0 = truck.z;
    for (let i = 0; i < 20 * 5; i++) g.step();
    check('le camion roule tout seul dans les rues', Math.hypot(truck.x - x0, truck.z - z0) > 20, `${Math.hypot(truck.x - x0, truck.z - z0).toFixed(1)} m`);
    // Even l'intercepte : camion détruit, butin sur la chaussée
    g.damage(truck, 99999, g.ents.get(E.bossId)!);
    g.step();
    drain();
    const loot = g.publicState().loot[0];
    check('un convoi détruit laisse son butin', !!loot && loot.reward > 0);
    if (loot) {
      const eb = g.ents.get(E.bossId)!;
      const m0 = E.money;
      eb.x = loot.x;
      eb.z = loot.z;
      eb.y = 0;
      g.step();
      drain();
      check('Even rafle le butin', E.money - m0 >= loot.reward - 1, `${Math.round(E.money - m0)} $`);
    }
  }
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

// victoire : Dadou prend le QG actuel d'Even après avoir pris la majorité des quartiers
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
const snap = encodeSnapshot(12.5, 77, [{ id: 3, x: 101.25, y: 21.5, z: 164.5, yaw: 1.2, pitch: -0.3, vx: 1.5, vz: -2, anim: 1, flags: 5, weapon: 1, hp: 0.5, fx: 0x1203 }]);
const dec = decodeSnapshot(snap);
check(
  'instantané binaire encodé/décodé (étages et états cybernétiques compris)',
  dec.ents.length === 1 && Math.abs(dec.ents[0].x - 101.25) < 0.02 && Math.abs(dec.ents[0].z - 164.5) < 0.02 && Math.abs(dec.ents[0].y - 21.5) < 0.05 && dec.ents[0].anim === 1 && Math.abs(dec.ents[0].hp - 0.5) < 0.01 && dec.ents[0].fx === 0x1203,
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
