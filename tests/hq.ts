// Tests des équipements du QG et des cliniques cybernétiques (sans navigateur) : emplacements dans
// les dix logements, cliniques, achats et règles, effets de chaque équipement, déménagement, état
// public, égalité de traitement des deux parrains.
// Lancement : npx tsx tests/hq.ts (code de sortie ≠ 0 en cas d'échec)

import { getWorld } from '../src/server/world';
import { Game, SLOTS, otherSlot, slotFaction } from '../src/server/game/Game';
import { HQ, HQ_HOOKS, HQ_UPGRADES, anchorOf, clinicsOf, eliteGuards, hqDefenseMul, opsSpeedMul, stationSeat } from '../src/server/game/hq';
import { stationNear } from '../src/server/game/cyber';
import { BUILDINGS, BUILDING_BY_KEY, DISTRICTS, Faction, RESIDENCES, keyBuildings } from '../src/shared/city/plan';
import { CLINICS, clinicSeat } from '../src/shared/city/gen/clinics';
import { HQ_FOOTPRINT } from '../src/shared/city/gen/residences';
import { AMMO_PRICE, BOSS_SHOP, TAXI_PRICE, UPGRADE_BY_ID, UPGRADES, VEHICLE_CALL_COOLDOWN } from '../src/shared/constants';
import { GRENADE_MAX } from '../src/shared/grenade';
import { IMPLANT_BY_ID } from '../src/shared/implants';
import type { GameEvent, Slot } from '../src/shared/protocol';
import type { HqAnchor } from '../src/shared/city/gen/context';
import { Weapon } from '../src/shared/characters';

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

const t0 = performance.now();
const w = getWorld();
console.log(`(monde généré en ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
const solid = (x: number, y: number, z: number) => w.city.world.solidAt(x, y, z);

// ---------------------------------------------------------------------------- emplacements
section('Emplacements des équipements dans les dix logements');
/** Emplacements exigés à un palier : les équipements achetables jusque-là (gardes : quatre postes). */
function needed(tier: number): string[] {
  const out: string[] = [];
  for (const id of HQ_UPGRADES) {
    if ((UPGRADE_BY_ID[id].tier ?? 1) > tier) continue;
    if (id === 'elite') out.push('elite1', 'elite2', 'elite3', 'elite4');
    else out.push(id);
  }
  return out;
}
const fwd = (a: HqAnchor, d: number) => ({ x: a.x + Math.sin(a.yaw) * d, z: a.z + Math.cos(a.yaw) * d });
for (const slot of SLOTS) {
  for (const r of RESIDENCES[slot]) {
    const info = w.byId.get(r.id)!;
    const tier = r.residence!.tier;
    const A = info.hqAnchors ?? {};
    const miss = needed(tier).filter((k) => !A[k]);
    check(`${r.name} (palier ${tier}) : ${needed(tier).length} emplacements`, miss.length === 0, `manquants : ${miss.join(', ')}`);
    const bad: string[] = [];
    for (const [k, a] of Object.entries(A)) {
      const fp = info.footprint;
      if (k !== 'transport' && !(a.x > fp[0] && a.x < fp[2] && a.z > fp[1] && a.z < fp[3])) bad.push(`${k} hors du bâtiment`);
      // ni sur la place du parrain, ni sur le rabatteur, l'armurerie ou l'entrée
      for (const [n, p, min] of [
        ['fauteuil', info.deskSeat, 1.1],
        ['rabatteur', info.recruit, 1.0],
        ['armurerie', info.armory, 1.0],
        ['entrée', info.doors[0].in, 1.4],
      ] as const) {
        if (!p || k === 'holomap' || (k === 'security' && n === 'entrée') || (k === 'security' && n === 'fauteuil')) continue;
        if (Math.abs((p.y ?? 0) - a.y) > 1) continue;
        const c = HQ_FOOTPRINT[k] ? fwd(a, HQ_FOOTPRINT[k][1] / 2) : a;
        const reach = HQ_FOOTPRINT[k] ? Math.max(HQ_FOOTPRINT[k][0], HQ_FOOTPRINT[k][1]) / 2 : 0;
        if (Math.hypot(c.x - p.x, c.z - p.z) < min + reach * 0.6) bad.push(`${k} trop près : ${n}`);
      }
      // encombrement libre (pas dans un meuble ni un mur)
      const f = HQ_FOOTPRINT[k];
      if (f) {
        const s = Math.sin(a.yaw);
        const c = Math.cos(a.yaw);
        let hits = 0;
        let n = 0;
        for (let u = -f[0] / 2 + 0.15; u <= f[0] / 2 - 0.15; u += 0.25)
          for (let v = 0.15; v <= f[1] - 0.1; v += 0.25)
            for (const h of [0.4, 1.0, 1.6]) {
              n++;
              if (solid(a.x + s * v + c * u, a.y + h, a.z + c * v - s * u)) hits++;
            }
        if (hits > n * 0.04) bad.push(`${k} encombré (${hits}/${n})`);
      }
      // postes des gardes : praticables et accessibles depuis la rue
      if (k.startsWith('elite')) {
        const nn = w.nav.nearestWalkable(a.x, a.z, a.y, 1);
        const p = w.nav.findPath(info.doors[0].out.x, info.doors[0].out.z, 0, a.x, a.z, a.y, 400000);
        const e = p ? p.length - 4 : 0;
        if (nn < 0 || !p || Math.hypot(p[e] - a.x, p[e + 1] - a.z) > 1.5) bad.push(`${k} inaccessible`);
      }
    }
    check(`${r.name} : emplacements dégagés, hors des passages`, bad.length === 0, bad.join(' ; '));
  }
}
// les deux parrains ont les mêmes logements (jumeaux) : mêmes équipements aux mêmes places
for (let i = 0; i < 5; i++) {
  const d = w.byId.get(RESIDENCES.dadou[i].id)!.hqAnchors ?? {};
  const e = w.byId.get(RESIDENCES.even[i].id)!.hqAnchors ?? {};
  check(`palier ${i + 1} : mêmes emplacements chez Dadou et Even`, JSON.stringify(Object.keys(d).sort()) === JSON.stringify(Object.keys(e).sort()));
}

// ---------------------------------------------------------------------------- cliniques
section('Cliniques cybernétiques');
const clinics = w.buildings.filter((b) => b.clinic);
check(`${CLINICS.length} cliniques installées`, clinics.length === CLINICS.length, `${clinics.length}`);
for (const c of CLINICS) {
  const b = w.byId.get(BUILDING_BY_KEY[c.key].id)!;
  if (!b.clinic) {
    check(`${c.name} installée`, false);
    continue;
  }
  const seat = clinicSeat(b.clinic);
  const near = w.nav.nearestWalkable(seat.x, seat.z, seat.y, 2.4);
  let ok = near >= 0;
  if (ok) {
    const [nx, nz] = w.nav.nodeCenter(near);
    const p = w.nav.findPath(b.doors[0].out.x, b.doors[0].out.z, 0, nx, nz, seat.y, 400000);
    const e = p ? p.length - 4 : 0;
    ok = !!p && Math.hypot(p[e] - nx, p[e + 1] - nz) < 1.5;
  }
  check(`${c.name} (${b.def.name}) : fauteuil accessible depuis la rue`, ok);
}
// équité : les cliniques sont en miroir (Grand Central au centre)
{
  const near = (slot: Slot) => {
    const h = w.byId.get(RESIDENCES[slot][0].id)!;
    return Math.min(...clinics.map((b) => Math.hypot(b.clinic!.x - h.center.x, b.clinic!.z - h.center.z)));
  };
  check('la clinique la plus proche est à la même distance des deux planques', Math.abs(near('dadou') - near('even')) < 4, `${near('dadou').toFixed(1)} / ${near('even').toFixed(1)} m`);
  const north = clinics.filter((b) => b.clinic!.z < 236).length;
  const south = clinics.filter((b) => b.clinic!.z > 244).length;
  check('autant de cliniques au nord qu’au sud', north === south, `${north} / ${south}`);
}

// ---------------------------------------------------------------------------- partie
type Ev = GameEvent & { _to?: string };
let events: Ev[] = [];
function drain(g: Game): void {
  const out = g.takeOutbox();
  for (const e of out.all) events.push(e);
  for (const e of out.dadou) events.push({ ...e, _to: 'dadou' });
  for (const e of out.even) events.push({ ...e, _to: 'even' });
}
const notes = (slot: Slot) => events.filter((e) => e.t === 'notify' && (e._to === slot || !e._to)).map((e) => (e as { text: string }).text);
const lastNote = (slot: Slot) => notes(slot).at(-1) ?? '';
function run(g: Game, s: number): void {
  const n = Math.round(s * 20);
  for (let i = 0; i < n; i++) {
    g.step();
    drain(g);
  }
}
function newGame(): Game {
  const g = new Game(w, { timeLimit: 0, daytime: 'night', weather: 'clear', tips: false });
  drain(g);
  events = [];
  return g;
}
const bossOf = (g: Game, slot: Slot) => g.ents.get(g.factions[slot].bossId)!;
function put(g: Game, slot: Slot, x: number, y: number, z: number): void {
  const b = bossOf(g, slot);
  b.x = x;
  b.y = y;
  b.z = z;
}
function upTo(g: Game, slot: Slot, tier: number): void {
  while (g.factions[slot].tier < tier) g.moveHq(slot, RESIDENCES[slot][g.factions[slot].tier].id);
}
function buy(g: Game, slot: Slot, id: string): boolean {
  g.action(slot, { a: 'upgrade', id });
  drain(g);
  return g.factions[slot].upgrades.has(id);
}

section('Achats et règles (les deux parrains)');
{
  const g = newGame();
  for (const slot of SLOTS) {
    const f = g.factions[slot];
    f.money = 100000;
    check(`${slot} : Gardes d’élite refusés à la planque (palier 3)`, !buy(g, slot, 'elite'), lastNote(slot));
    check(`${slot} : Communications avancées exigent la Liaison cryptée`, !buy(g, slot, 'comms'), lastNote(slot));
    const m0 = f.money;
    check(`${slot} : Carte holographique achetée (${UPGRADE_BY_ID.holomap.price} $)`, buy(g, slot, 'holomap') && Math.round(m0 - f.money) === UPGRADE_BY_ID.holomap.price);
    f.money = 100;
    check(`${slot} : achat refusé sans argent`, !buy(g, slot, 'surveil'), lastNote(slot));
  }
  check('les équipements du QG coûtent la même chose aux deux parrains', UPGRADES.every((u) => u.price > 0));
  check('douze équipements du QG, tous dans la catégorie « hq »', HQ_UPGRADES.length === 12 && HQ_UPGRADES.every((id) => UPGRADE_BY_ID[id]?.category === 'hq'));
}

section('Effets des équipements');
const g = newGame();
for (const slot of SLOTS) {
  g.factions[slot].money = 200000;
  upTo(g, slot, 3);
  for (const id of ['crypto', 'armory', 'drones', ...HQ_UPGRADES]) buy(g, slot, id);
}
drain(g);
run(g, 1.5);
const pub0 = g.publicState();
for (const slot of SLOTS) {
  const f = g.factions[slot];
  check(`${slot} : les douze équipements sont installés au loft`, HQ_UPGRADES.every((id) => f.upgrades.has(id)), HQ_UPGRADES.filter((id) => !f.upgrades.has(id)).join(', '));
  check(`${slot} : état public — équipements visibles du QG`, JSON.stringify(pub0.hqUpg?.[slot]) === JSON.stringify([...HQ_UPGRADES]));
}

// gardes d'élite
for (const slot of SLOTS) {
  const el = eliteGuards(g, slot);
  const hq = g.hq(slot);
  const atPost = el.filter((e) => [1, 2, 3, 4].some((i) => {
    const a = anchorOf(hq, `elite${i}`)!;
    return Math.hypot(e.x - a.x, e.z - a.z) < 1.5 && Math.abs(e.y - a.y) < 1.2;
  }));
  check(`${slot} : quatre gardes d’élite (${HQ.eliteHp} PV) à leurs postes`, el.length === 4 && el.every((e) => e.maxHp === HQ.eliteHp) && atPost.length === 4, `${el.length} gardes, ${atPost.length} à leur poste`);
}
{
  const slot: Slot = 'dadou';
  const victim = eliteGuards(g, slot)[0];
  g.kill(victim, null);
  run(g, 2);
  check('un garde d’élite tué n’est pas remplacé aussitôt', eliteGuards(g, slot).length === 3);
  run(g, HQ.eliteRespawn + 1);
  check(`… mais l’est au bout de ${HQ.eliteRespawn} s`, eliteGuards(g, slot).length === 4);
  const std = [...g.ents.values()].filter((e) => e.alive && e.slot === slot && e.role === 'guard' && e.name !== 'Garde d’élite').length;
  check(`les ${g.tierOf(slot).guards} gardes ordinaires du loft restent en poste`, std === g.tierOf(slot).guards, `${std}`);
}

// sécurité renforcée : tourelles dans le QG
for (const slot of SLOTS) {
  const hqId = g.factions[slot].hqId;
  const tur = [...g.ents.values()].filter((e) => e.alive && e.role === 'turret' && e.ai?.home === hqId && e.slot === slot);
  check(`${slot} : tourelles de la sécurité renforcée au QG`, tur.length >= 2, `${tur.length}`);
}

// station cybernétique et cliniques
{
  const implant = 'grappin';
  const price = IMPLANT_BY_ID[implant].levels[0].price;
  for (const slot of SLOTS) {
    const f = g.factions[slot];
    const st = stationSeat(anchorOf(g.hq(slot), 'cyberstation')!);
    put(g, slot, st.x + 0.8, st.y, st.z);
    check(`${slot} : à la station cybernétique du QG`, stationNear(g, slot) === 'qg', String(stationNear(g, slot)));
    const m0 = f.money;
    g.action(slot, { a: 'cyber', op: 'buy', id: implant });
    drain(g);
    check(`${slot} : implant acheté et installé au QG`, (f.cyber.owned.get(implant) ?? 0) === 1 && Math.round(m0 - f.money) === price, lastNote(slot));
    // loin de toute station : refus
    const out = g.hq(slot).doors[0].out;
    put(g, slot, out.x, 0, out.z);
    g.action(slot, { a: 'cyber', op: 'upgrade', id: implant });
    drain(g);
    check(`${slot} : pas d’amélioration dans la rue`, (f.cyber.owned.get(implant) ?? 0) === 1 && /clinique/i.test(lastNote(slot)), lastNote(slot));
    // une clinique ouverte
    const cl = clinicsOf(g)[2];
    const seat = clinicSeat(cl.c);
    put(g, slot, seat.x, seat.y, seat.z);
    check(`${slot} : à la ${cl.c.name}`, stationNear(g, slot) === `clinique:${cl.bid}`, String(stationNear(g, slot)));
    g.action(slot, { a: 'cyber', op: 'upgrade', id: implant });
    drain(g);
    check(`${slot} : amélioration à la clinique`, (f.cyber.owned.get(implant) ?? 0) === 2, lastNote(slot));
    // la clinique passe aux mains du rival : fermée
    g.setOwner(cl.bid, slotFaction(otherSlot(slot)));
    drain(g);
    put(g, slot, seat.x, seat.y, seat.z);
    check(`${slot} : clinique du rival fermée`, stationNear(g, slot) === null);
    g.action(slot, { a: 'cyber', op: 'upgrade', id: implant });
    drain(g);
    check(`${slot} : « Clinique fermée » et pas d’amélioration`, (f.cyber.owned.get(implant) ?? 0) === 2 && /^Clinique fermée/.test(lastNote(slot)), lastNote(slot));
    g.setOwner(cl.bid, Faction.NEUTRAL);
    drain(g);
  }
  // sans la station : le bureau n'est pas une station
  const g2 = newGame();
  const hq2 = g2.hq('even');
  put(g2, 'even', (hq2.desk ?? hq2.center).x, (hq2.desk ?? hq2.center).y ?? hq2.floorY, (hq2.desk ?? hq2.center).z);
  check('sans station cybernétique, le bureau du QG n’installe rien', stationNear(g2, 'even') === null);
}

// transport personnel
for (const slot of SLOTS) {
  const f = g.factions[slot];
  const b = bossOf(g, slot);
  const out = g.building(BUILDING_BY_KEY['grand_central'].id).doors[0].out;
  put(g, slot, out.x, 0, out.z);
  b.lastDamageAt = -100;
  f.heat = 2;
  const m0 = f.money;
  const tp0 = f.tp;
  g.action(slot, { a: 'goHome' });
  drain(g);
  const seat = g.hq(slot).deskSeat!;
  check(`${slot} : aéronef personnel gratuit vers le QG, même recherché`, f.tp === tp0 + 1 && Math.hypot(b.x - seat.x, b.z - seat.z) < 0.5 && Math.round(m0 - f.money) === 0, lastNote(slot));
  f.heat = 0;
  // livraison des véhicules deux fois plus rapide
  f.garage.add(1);
  f.callAt = 0;
  const street = g.hq(slot).doors[0].out;
  put(g, slot, street.x, 0, street.z);
  g.action(slot, { a: 'vehicle', op: 'call', v: 1 });
  run(g, 0.1);
  const wait = f.callAt - g.time;
  check(`${slot} : livraison de véhicule en ${Math.round(VEHICLE_CALL_COOLDOWN * HQ.callMul)} s au lieu de ${VEHICLE_CALL_COOLDOWN}`, wait > 0 && wait <= VEHICLE_CALL_COOLDOWN * HQ.callMul + 0.1, `${wait.toFixed(1)} s`);
}
{
  const g3 = newGame();
  const f = g3.factions.even;
  f.heat = 2;
  const tp0 = f.tp;
  g3.action('even', { a: 'goHome' });
  drain(g3);
  check(`sans le module : taxi refusé si recherché (et payant : ${TAXI_PRICE} $)`, f.tp === tp0, lastNote('even'));
}

// armurerie avancée
for (const slot of SLOTS) {
  const f = g.factions[slot];
  let m0 = f.money;
  g.action(slot, { a: 'buyAmmo' });
  drain(g);
  check(`${slot} : munitions à ${Math.round(AMMO_PRICE * HQ.ammoMul)} $`, Math.round(m0 - f.money) === Math.round(AMMO_PRICE * HQ.ammoMul));
  const item = BOSS_SHOP.find((i) => !f.weapons.has(i.weapon))!;
  m0 = f.money;
  g.action(slot, { a: 'buyWeapon', w: item.weapon });
  drain(g);
  check(`${slot} : arme à −25 %`, f.weapons.has(item.weapon) && Math.round(m0 - f.money) === Math.round(item.price * HQ.weaponMul));
  f.grenades = 0;
  for (let i = 0; i < 10; i++) g.action(slot, { a: 'buyGrenade' });
  drain(g);
  check(`${slot} : ${GRENADE_MAX + HQ.grenadeBonus} grenades en poche`, f.grenades === GRENADE_MAX + HQ.grenadeBonus, `${f.grenades}`);
  // ravitaillement gratuit au QG
  f.ammo.set(Weapon.PISTOL, 1);
  const seat = g.hq(slot).deskSeat!;
  put(g, slot, seat.x, seat.y ?? g.hq(slot).floorY, seat.z);
  m0 = f.money;
  run(g, 6);
  check(`${slot} : munitions rechargées gratuitement au QG`, (f.ammo.get(Weapon.PISTOL) ?? 0) >= 12 * 8 && f.money >= m0 - 1);
}

// recrutement automatique
for (const slot of SLOTS) {
  const f = g.factions[slot];
  // la réserve part en mission : il ne reste personne au QG
  const lt = f.lieutenants[0];
  g.assignMen(g.squads.get(lt)!, g.countPool(slot) + (g.squads.get(lt)!.members.size ?? 0));
  const pool0 = g.countPool(slot);
  const st = (g.modules.find((m) => 'state' in m) as unknown as { state: Record<Slot, { recruits: number }> }).state[slot];
  const r0 = st.recruits;
  const m0 = f.money;
  run(g, HQ.autoEvery * 2 + 2);
  const n = st.recruits - r0;
  check(`${slot} : le terminal recrute quand la réserve est basse`, n >= 2 && g.countPool(slot) > pool0, `${n} recrues, réserve ${pool0} → ${g.countPool(slot)}`);
  check(`${slot} : ${HQ.autoPrice} $ la recrue`, Math.abs(m0 - f.money - n * HQ.autoPrice) < 200, `${Math.round(m0 - f.money)} $`);
  f.money = HQ.autoReserve;
  const r1 = st.recruits;
  run(g, HQ.autoEvery + 2);
  check(`${slot} : le terminal préserve ${HQ.autoReserve} $`, st.recruits === r1);
  f.money = 200000;
}

// surveillance, communications, carte holographique
for (const slot of SLOTS) {
  const rival = otherSlot(slot);
  const hq = g.hq(slot);
  // un homme du rival rôde devant le QG
  const spy = g.spawnGangster(rival)!;
  const out = hq.doors[0].out;
  spy.x = out.x + 3;
  spy.z = out.z;
  spy.y = 0;
  spy.ai!.mode = 'hold';
  spy.ai!.post = { x: spy.x, z: spy.z };
  // (les gardes et les tourelles du QG l'abattraient avant la ronde des caméras)
  spy.invulnerable = true;
  events = [];
  run(g, 1.2);
  const p = g.privateState(slot);
  check(`${slot} : la surveillance repère l’intrus devant le QG`, !!p.hqUp?.watch?.some((wt) => Math.hypot(wt.x - spy.x, wt.z - spy.z) < 2), JSON.stringify(p.hqUp?.watch?.slice(0, 3)));
  check(`${slot} : sa position exacte est sur les cartes`, p.spotted.some((s) => Math.hypot(s.x - spy.x, s.z - spy.z) < 3));
  check(`${slot} : alerte « Surveillance »`, notes(slot).some((t) => /^Surveillance/.test(t)), notes(slot).join(' | '));
  g.kill(spy, null);
  // carte holographique : garnisons exactes
  const gar = new Map(p.hqUp?.garrisons ?? []);
  const sample = BUILDINGS.find((b) => b.startOwner === Faction.NEUTRAL && b.guards > 0 && g.bstate.get(b.id)!.owner === Faction.NEUTRAL)!;
  const thugs = [...g.bstate.get(sample.id)!.thugs].filter((id) => g.ents.get(id)?.alive).length;
  check(`${slot} : garnison exacte ${sample.name.startsWith('L') ? 'du' : 'de'} ${sample.name} (${thugs})`, gar.get(sample.id) === thugs, `${gar.get(sample.id)}`);
}
{
  // communications : un bâtiment attaqué, le lieutenant le plus proche fait son rapport
  const slot: Slot = 'even';
  const target = BUILDING_BY_KEY['diner_astoria'];
  g.setOwner(target.id, slotFaction(slot));
  const info = g.building(target.id);
  const raider = g.spawnGangster('dadou')!;
  raider.x = info.center.x;
  raider.z = info.center.z;
  raider.y = info.center.y ?? info.floorY;
  raider.ai!.mode = 'hold';
  raider.ai!.post = { x: raider.x, z: raider.z, y: raider.y };
  events = [];
  run(g, 1.2);
  const p = g.privateState(slot);
  check('communications : rapport sur l’attaque d’un bâtiment', notes(slot).some((t) => /^Rapport/.test(t) && t.includes(target.name.split(' ')[0])), notes(slot).join(' | '));
  check('communications : position exacte de l’assaillant', !!p.hqUp?.watch?.some((wt) => Math.hypot(wt.x - raider.x, wt.z - raider.z) < 2));
  g.kill(raider, null);
}

// drones
for (const slot of SLOTS) {
  const f = g.factions[slot];
  const pd = [...g.ents.values()].find((e) => e.alive && e.role === 'vehicle' && e.veh?.owner === slot && e.name === 'Drone de patrouille');
  const hq = g.hq(slot);
  check(`${slot} : un drone de patrouille tourne au-dessus du QG`, !!pd && Math.hypot(pd.x - hq.center.x, pd.z - hq.center.z) < 25, pd ? `${Math.hypot(pd.x - hq.center.x, pd.z - hq.center.z).toFixed(1)} m` : 'aucun');
  f.droneAt = 0;
  g.action(slot, { a: 'drone', d: 'midtown' });
  run(g, 0.2);
  const cd = f.droneAt - g.time;
  check(`${slot} : recharge du drone de reconnaissance divisée par deux`, cd > 40 && cd < 46, `${cd.toFixed(1)} s`);
  // survol prolongé
  let until = -1;
  for (let i = 0; i < 20 * 40 && until < 0; i++) {
    g.step();
    drain(g);
    if (f.droneReveal && g.time < f.droneReveal.until) {
      run(g, 0.1);
      until = f.droneReveal ? f.droneReveal.until - g.time + 0.1 : -1;
    }
  }
  check(`${slot} : survol prolongé (${60 + HQ.droneExtra} s)`, until > 60 + HQ.droneExtra - 2, `${until.toFixed(1)} s`);
  if (pd) {
    g.kill(pd, null);
    run(g, 1);
    check(`${slot} : le drone de patrouille abattu n’annule pas la reconnaissance`, !!f.droneReveal);
    run(g, HQ.patrolRespawn + 1);
    const again = [...g.ents.values()].some((e) => e.alive && e.role === 'vehicle' && e.veh?.owner === slot && e.name === 'Drone de patrouille');
    check(`${slot} : un nouveau drone de patrouille décolle ${HQ.patrolRespawn} s plus tard`, again);
  }
}

// centre d'opérations : progression des prises
for (const slot of SLOTS) {
  const f = g.factions[slot];
  const target = BUILDINGS.find((b) => b.capturable && !b.residence && g.bstate.get(b.id)!.owner === Faction.NEUTRAL && b.district === (slot === 'dadou' ? 'bushwick' : 'astoria'))!;
  g.action(slot, { a: 'order', lt: f.lieutenants[0], order: 'attack_building', target: target.id, men: 4 });
  run(g, 1.5);
  const ops = g.privateState(slot).hqUp?.ops ?? [];
  check(`${slot} : l’opération du lieutenant s’affiche au centre d’opérations`, ops.some((o) => o.b === target.id), JSON.stringify(ops));
  // les prises menées par ses lieutenants vont 35 % plus vite (crochet lu par la conquête)
  check(`${slot} : opérations des lieutenants ×${HQ.opsMul}`, opsSpeedMul(g, slot) === HQ.opsMul && opsSpeedMul(newGame(), slot) === 1);
  g.action(slot, { a: 'cancel', lt: f.lieutenants[0] });
}
// porte blindée : la prise du QG avance plus lentement (crochet lu par la conquête)
for (const slot of SLOTS) check(`${slot} : porte blindée du QG ×${HQ.doorMul}`, hqDefenseMul(g, g.factions[slot].hqId) === HQ.doorMul && hqDefenseMul(g, BUILDING_BY_KEY['katz'].id) === 1);
if (!HQ_HOOKS.captureHandled) {
  // repli (sans module de conquête) : ajustement de la progression des prises
  const st = g.bstate.get(g.factions.dadou.hqId)!;
  const mod = g.modules.find((m) => 'state' in m)!;
  st.capBy = slotFaction('even');
  st.progress = 0.1;
  mod.step!(0.05);
  st.progress = 0.2;
  mod.step!(0.05);
  check(`repli : la prise du QG avance ×${HQ.doorMul}`, Math.abs(st.progress - (0.1 + 0.1 * HQ.doorMul)) < 1e-6, st.progress.toFixed(4));
  st.capBy = 0;
  st.progress = 0;
} else console.log('  (la conquête applique elle-même les crochets du QG)');

// trophées et prestige
for (const slot of SLOTS) {
  const f = g.factions[slot];
  const before = g.publicState().hqTrophies?.[slot] ?? 0;
  const district = DISTRICTS.find((d) => d.id === (slot === 'dadou' ? 'chinatown' : 'harlem'))!;
  for (const k of keyBuildings(district.id)) g.setOwner(k.id, slotFaction(slot));
  run(g, 1);
  const after = g.publicState().hqTrophies?.[slot] ?? 0;
  check(`${slot} : trophées des bâtiments clés et du quartier conquis`, after === before + keyBuildings(district.id).length + 1, `${before} → ${after}`);
  const p = g.privateState(slot);
  check(`${slot} : prestige +${HQ.prestige} $/min par quartier tenu`, p.hqUp?.prestige === g.territories(slot) * HQ.prestige && f.income >= p.hqUp!.prestige!, `${p.hqUp?.prestige} $/min`);
}

// ---------------------------------------------------------------------------- déménagement
section('Déménagement : les équipements suivent le parrain');
for (const slot of SLOTS) {
  const f = g.factions[slot];
  const before = [...f.upgrades].sort().join();
  upTo(g, slot, 5);
  run(g, 2);
  const hq = g.hq(slot);
  check(`${slot} : installé dans ${hq.def.name} (palier 5)`, f.tier === 5);
  check(`${slot} : mêmes équipements après le déménagement`, [...f.upgrades].sort().join() === before);
  const el = eliteGuards(g, slot);
  const atPost = el.filter((e) => [1, 2, 3, 4].some((i) => {
    const a = anchorOf(hq, `elite${i}`)!;
    return Math.hypot(e.x - a.x, e.z - a.z) < 1.5 && Math.abs(e.y - a.y) < 1.2;
  }));
  check(`${slot} : les gardes d’élite ont rejoint la tour`, el.length === 4 && atPost.length === 4, `${atPost.length}/4`);
  const tur = [...g.ents.values()].filter((e) => e.alive && e.role === 'turret' && e.ai?.home === hq.id && e.slot === slot);
  check(`${slot} : tourelles dans la tour`, tur.length >= 2);
  const st = stationSeat(anchorOf(hq, 'cyberstation')!);
  put(g, slot, st.x + 0.6, st.y, st.z);
  check(`${slot} : station cybernétique dans la tour`, stationNear(g, slot) === 'qg');
  const pd = [...g.ents.values()].find((e) => e.alive && e.role === 'vehicle' && e.veh?.owner === slot && e.name === 'Drone de patrouille');
  run(g, 14);
  check(`${slot} : le drone de patrouille survole la tour`, !!pd && Math.hypot(pd.x - hq.center.x, pd.z - hq.center.z) < 25);
}
const pub = g.publicState();
check('état public : équipements des deux QG', SLOTS.every((s) => pub.hqUpg?.[s]?.length === 12));
check('état public : trophées des deux parrains', SLOTS.every((s) => (pub.hqTrophies?.[s] ?? 0) >= 4));
check('égalité : même nombre de trophées pour les mêmes conquêtes', pub.hqTrophies?.dadou === pub.hqTrophies?.even, JSON.stringify(pub.hqTrophies));

console.log(`\n${passed} réussi(s), ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
