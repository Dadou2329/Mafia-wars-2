// Tests de la prise de contrôle par opérations (sans navigateur) : ancres des objectifs dans la
// ville, opérations menées par un lieutenant et par le parrain, contestation, interruption,
// reprise d'une étape, objet emporté, piratage interactif, implants, QG, deux parrains sur le
// même bâtiment, état public (reconnexion).
// Lancement : npx tsx tests/conquest.ts

import { getWorld } from '../src/server/world';
import { Game } from '../src/server/game/Game';
import { opOf } from '../src/server/game/conquest';
import { BUILDINGS, BUILDING_BY_KEY, DISTRICTS, Faction, HQ_BUILDING, keyBuildings, mirrorRect } from '../src/shared/city/plan';
import { HQ_CAPTURE_MIN_DISTRICTS } from '../src/shared/constants';
import { OP_BUDGET, OP_MINIGAME_MIN, OP_RIVAL_TAKEOVER, opAnchor, opPlan, type OpStep } from '../src/shared/conquest';
import type { GameEvent, OpPub, Slot } from '../src/shared/protocol';
import type { Ent } from '../src/server/game/types';

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

const w = getWorld();
const SETTINGS = { timeLimit: 0, daytime: 'night', weather: 'clear', tips: false } as const;

interface Ctx {
  g: Game;
  events: (GameEvent & { _to?: string })[];
  run: (seconds: number, each?: () => boolean | void) => void;
  pubOp: (bid: number) => OpPub | undefined;
  boss: (slot: Slot) => Ent;
  place: (e: Ent, p: { x: number; y?: number; z: number }) => void;
  clearThugs: (bid: number) => void;
  lastText: (slot: Slot) => string;
}

/** Partie neuve, au tirage aléatoire reproductible (la graine du jeu vient de l'horloge). */
function newGame(seed = 1): Ctx {
  const now = Date.now;
  Date.now = () => seed;
  const g = new Game(w, { ...SETTINGS });
  Date.now = now;
  g.takeOutbox();
  const events: (GameEvent & { _to?: string })[] = [];
  const drain = () => {
    const out = g.takeOutbox();
    for (const e of out.all) events.push(e);
    for (const e of out.dadou) events.push({ ...e, _to: 'dadou' });
    for (const e of out.even) events.push({ ...e, _to: 'even' });
  };
  const boss = (slot: Slot) => g.ents.get(g.factions[slot].bossId)!;
  for (const s of ['dadou', 'even'] as Slot[]) boss(s).invulnerable = true;
  return {
    g,
    events,
    run(seconds, each) {
      const n = Math.round(seconds * 20);
      for (let i = 0; i < n; i++) {
        g.step();
        drain();
        if (each && each() === true) break;
      }
    },
    pubOp: (bid) => g.publicState().ops?.find((o) => o.b === bid),
    boss,
    place(e, p) {
      e.x = p.x;
      e.z = p.z;
      e.y = p.y ?? 0;
      e.vx = e.vz = 0;
      if (e.ai) e.ai.path = null;
    },
    clearThugs(bid) {
      for (const id of g.bstate.get(bid)!.thugs) {
        const t = g.ents.get(id);
        if (t && t.alive) g.damage(t, 9999, null);
      }
      // tourelles du bâtiment
      for (const e of g.ents.values()) if (e.role === 'turret' && e.ai?.home === bid && e.alive) g.damage(e, 9999, null);
    },
    lastText(slot) {
      const n = [...events].reverse().find((e) => e.t === 'notify' && (e._to === slot || !e._to)) as { text: string } | undefined;
      return n?.text ?? '';
    },
  };
}

const B = (key: string) => BUILDING_BY_KEY[key].id;
const stepsOf = (g: Game, bid: number): OpStep[] => opPlan(w.byId.get(bid)!, !!g.hqOwnerOf(bid))!.steps;

// ---------------------------------------------------------------------------- ancres
section('Objectifs dans la ville');
{
  let missing = 0;
  let unreachable = 0;
  let count = 0;
  for (const def of BUILDINGS) {
    if (!def.capturable) continue;
    const info = w.byId.get(def.id)!;
    for (const hq of def.residence ? [false, true] : [false]) {
      for (const s of opPlan(info, hq)!.steps) {
        count++;
        if (!opAnchor(info, s.key)) {
          missing++;
          console.log(`    ancre manquante : ${def.name} (${s.key})`);
          continue;
        }
        const a = s.anchor;
        const p = w.nav.findPath(info.doors[0].out.x, info.doors[0].out.z, 0, a.x, a.z, a.y, 400000);
        const e = p ? p.length - 4 : 0;
        if (!p || Math.hypot(p[e] - a.x, p[e + 1] - a.z) > 1.5 || Math.abs(p[e + 2] - a.y) > 1) {
          unreachable++;
          console.log(`    objectif inaccessible : ${def.name} (${s.key})`);
        }
      }
    }
  }
  check(`chaque étape a un vrai lieu dans son bâtiment (${count} objectifs)`, missing === 0, `${missing} manquant(s)`);
  check('chaque objectif est accessible à pied depuis la rue', unreachable === 0, `${unreachable} inaccessible(s)`);
  // équilibre : les jumeaux nord / sud ont la même opération (niveau et durée totale)
  let unbalanced = 0;
  for (const b of BUILDINGS) {
    if (!b.capturable) continue;
    const m = mirrorRect(b.rect);
    const twin = BUILDINGS.find((o) => o.rect.every((v, i) => Math.abs(v - m[i]) < 1e-6));
    if (!twin || twin === b) continue;
    const pa = opPlan(w.byId.get(b.id)!, false)!;
    const pb = opPlan(w.byId.get(twin.id)!, false)!;
    if (pa.level !== pb.level || Math.abs(pa.total - pb.total) > 1) {
      unbalanced++;
      console.log(`    ${b.name} (${pa.level}, ${pa.total} s) / ${twin.name} (${pb.level}, ${pb.total} s)`);
    }
  }
  check('les jumeaux nord / sud ont des opérations équivalentes', unbalanced === 0, `${unbalanced} écart(s)`);
  const lv = (k: string) => opPlan(w.byId.get(B(k))!, false)!;
  check('une bodega : un seul objectif court', lv('bodega_myrtle').steps.length === 1 && lv('bodega_myrtle').level === 'small');
  check('un bâtiment clé : 2 à 4 étapes', ['club_electric', 'navy_yard', 'marche_tech', 'tour_citadel'].every((k) => lv(k).steps.length >= 2 && lv(k).steps.length <= 4));
  check('la banque : chambre forte, acte de propriété, bureau du directeur', lv('banque_federale').steps.map((s) => s.kind).join(',') === 'crack,secure,deliver');
  check('le marché tech : le serveur, avec le piratage interactif', lv('marche_tech').steps.some((s) => s.key === 'server' && s.kind === 'minigame'));
  check('la tour Axiom : un assaut vertical, du hall au toit', (() => {
    const ys = lv('tour_axiom').steps.map((s) => s.anchor.y);
    return ys.length === 3 && ys[0] < 2 && ys[1] > 30 && ys[2] > ys[1];
  })());
  const hq = opPlan(w.byId.get(HQ_BUILDING.even.id)!, true)!;
  check('le QG : l’opération la plus longue', hq.level === 'hq' && hq.total >= OP_BUDGET.major && hq.steps.length >= 3);
}

// ---------------------------------------------------------------------------- présence
section('La présence seule ne prend plus un bâtiment');
{
  const c = newGame();
  const bid = B('navy_yard');
  c.clearThugs(bid);
  const info = w.byId.get(bid)!;
  const men = [...c.g.ents.values()].filter((e) => e.slot === 'dadou' && e.role === 'gangster' && e.alive);
  let i = 0;
  c.run(60, () => {
    for (const m of men) {
      const p = info.defend[i++ % info.defend.length];
      if (Math.hypot(m.x - p.x, m.z - p.z) > 6) c.place(m, p);
    }
  });
  check('des hommes dans un bâtiment clé vide pendant 60 s : il reste neutre', c.g.bstate.get(bid)!.owner === Faction.NEUTRAL);
  check('… et aucune opération ne démarre sans opérateur', !c.pubOp(bid));
}

// ---------------------------------------------------------------------------- le parrain
section('Le parrain mène un objectif');
{
  const c = newGame();
  const g = c.g;
  const bid = B('navy_yard');
  c.clearThugs(bid);
  const steps = stepsOf(g, bid);
  const boss = c.boss('dadou');
  c.place(boss, steps[0].anchor);
  g.action('dadou', { a: 'op', b: bid, k: steps[0].key });
  c.run(2, () => void c.place(boss, steps[0].anchor));
  const op1 = c.pubOp(bid);
  check('l’action « op » lance l’opération', !!op1 && op1.slot === 'dadou' && op1.step === 0, JSON.stringify(op1));
  check('le parrain est à l’œuvre et l’étape avance', !!op1 && (op1.by & 1) === 1 && op1.p > 0.05, JSON.stringify(op1));
  // reconnexion : l'état public décrit la même opération
  const again = JSON.parse(JSON.stringify(g.publicState())).ops?.find((o: OpPub) => o.b === bid);
  check('état public : une nouvelle copie décrit la même opération (reconnexion)', JSON.stringify(again) === JSON.stringify(c.pubOp(bid)));
  const internal = opOf(g, bid)!;
  check('… et correspond à l’état du serveur', !!again && again.step === internal.step && Math.abs(again.p - internal.prog) < 0.01 && again.n === steps.length);
  // trop loin : refusé
  const far = newGame();
  const fb = far.boss('dadou');
  far.place(fb, { x: steps[0].anchor.x + 9, y: steps[0].anchor.y, z: steps[0].anchor.z });
  far.g.action('dadou', { a: 'op', b: bid, k: steps[0].key });
  far.run(1);
  check('trop loin de l’objectif : rien ne démarre', !far.pubOp(bid), far.lastText('dadou'));
  // mauvaise étape : refusée
  far.place(fb, steps[1].anchor);
  far.g.action('dadou', { a: 'op', b: bid, k: steps[1].key });
  far.run(1);
  check('les étapes se font dans l’ordre', !far.pubOp(bid));
  // le parrain finit l'étape, puis la suivante : le bâtiment est à lui
  c.run(steps[0].time + 2, () => {
    c.place(boss, steps[0].anchor);
    return (c.pubOp(bid)?.step ?? 0) >= 1;
  });
  check('étape 1 réussie par le parrain', c.pubOp(bid)?.step === 1 && c.pubOp(bid)?.who[0] === 'Dadou', JSON.stringify(c.pubOp(bid)));
  c.place(boss, steps[1].anchor);
  g.action('dadou', { a: 'op', b: bid, k: steps[1].key });
  c.run(steps[1].time + 2, () => {
    c.place(boss, steps[1].anchor);
    return g.bstate.get(bid)!.owner === Faction.DADOU;
  });
  check('dernière étape : le bâtiment change de mains', g.bstate.get(bid)!.owner === Faction.DADOU);
  check('l’opération disparaît de l’état public', !c.pubOp(bid));
}

// ---------------------------------------------------------------------------- contestation et interruption
section('Contestation et interruption');
{
  const c = newGame();
  const g = c.g;
  const bid = B('casse_bushwick');
  c.clearThugs(bid);
  const s0 = stepsOf(g, bid)[0];
  const boss = c.boss('dadou');
  c.place(boss, s0.anchor);
  g.action('dadou', { a: 'op', b: bid, k: s0.key });
  c.run(3, () => void c.place(boss, s0.anchor));
  const p0 = c.pubOp(bid)!.p;
  // un homme d'Even arrive à côté de l'objectif
  const rival = [...g.ents.values()].find((e) => e.slot === 'even' && e.role === 'gangster' && e.alive)!;
  rival.invulnerable = true;
  c.run(3, () => {
    c.place(boss, s0.anchor);
    c.place(rival, { x: s0.anchor.x + 1.2, y: s0.anchor.y, z: s0.anchor.z });
  });
  const op = c.pubOp(bid)!;
  check('un rival près de l’objectif le conteste', op.contested, JSON.stringify(op));
  check('… et la progression s’arrête', Math.abs(op.p - p0) < 0.02 && op.rate === 0, `${p0} → ${op.p}`);
  check('le parrain est prévenu', c.events.some((e) => e.t === 'notify' && e._to === 'dadou' && /contesté/.test((e as { text: string }).text)));
  rival.invulnerable = false;
  g.damage(rival, 9999, boss);
  c.run(2, () => void c.place(boss, s0.anchor));
  check('le rival abattu : l’étape reprend', !c.pubOp(bid)!.contested && c.pubOp(bid)!.rate > 0);
  // l'opérateur abattu : l'étape s'interrompt et se perd lentement
  boss.invulnerable = false;
  g.damage(boss, 9999, null);
  c.run(1);
  const a = c.pubOp(bid)!;
  c.run(5);
  const b = c.pubOp(bid)!;
  check('l’opérateur abattu : plus personne à l’œuvre', a.by === 0 && a.rate < 0, JSON.stringify(a));
  check('… l’étape se perd lentement', b.p < a.p && b.p > a.p - 0.15, `${a.p} → ${b.p}`);
}

// ---------------------------------------------------------------------------- reprise par le propriétaire
section('Le propriétaire reprend une étape volée');
{
  const c = newGame();
  const g = c.g;
  const bid = B('savoy');
  c.clearThugs(bid);
  g.setOwner(bid, Faction.EVEN, 'even');
  const steps = stepsOf(g, bid);
  const dad = c.boss('dadou');
  const eve = c.boss('even');
  c.place(eve, { x: 5, z: 5 });
  c.place(dad, steps[0].anchor);
  g.action('dadou', { a: 'op', b: bid, k: steps[0].key });
  c.run(steps[0].time + 2, () => {
    c.place(dad, steps[0].anchor);
    return (c.pubOp(bid)?.step ?? 0) >= 1;
  });
  check('Dadou franchit la première étape chez Even', c.pubOp(bid)?.step === 1);
  check('Even est alerté', c.events.some((e) => e.t === 'notify' && e._to === 'even' && /ALERTE/.test((e as { text: string }).text)));
  // Dadou part vers la 2e étape (à l'étage) ; Even revient sur la première
  c.place(dad, steps[1].anchor);
  c.place(eve, steps[0].anchor);
  g.action('even', { a: 'op', b: bid, k: steps[0].key });
  let undoSeen = 0;
  c.run(steps[0].time, () => {
    c.place(eve, steps[0].anchor);
    c.place(dad, steps[1].anchor);
    undoSeen = Math.max(undoSeen, c.pubOp(bid)?.undo ?? 0);
    return (c.pubOp(bid)?.step ?? 1) === 0;
  });
  check('Even reprend l’étape : il faut la refaire', c.pubOp(bid)?.step === 0 && undoSeen > 0, JSON.stringify(c.pubOp(bid)));
  check('le bâtiment reste à Even', g.bstate.get(bid)!.owner === Faction.EVEN);
}

// ---------------------------------------------------------------------------- l'acte de propriété
section('Banque : l’acte de propriété');
{
  const c = newGame();
  const g = c.g;
  const bid = B('banque_federale');
  c.clearThugs(bid);
  const steps = stepsOf(g, bid);
  const boss = c.boss('dadou');
  // la chambre forte, puis l'acte
  for (let i = 0; i < 2; i++) {
    c.place(boss, steps[i].anchor);
    g.action('dadou', { a: 'op', b: bid, k: steps[i].key });
    c.run(steps[i].time + 2, () => {
      c.place(boss, steps[i].anchor);
      return (c.pubOp(bid)?.step ?? 0) > i;
    });
  }
  const op = c.pubOp(bid);
  check('chambre forte forcée, acte récupéré : le parrain le porte', op?.step === 2 && op.carrier === boss.id, JSON.stringify(op));
  // le porteur tombe : l'acte est à terre
  boss.invulnerable = false;
  g.damage(boss, 9999, null);
  c.run(1);
  const dropped = c.pubOp(bid);
  check('le porteur abattu : l’acte tombe', !!dropped?.drop && dropped.carrier === undefined, JSON.stringify(dropped));
  check('événement « objet tombé »', c.events.some((e) => e.t === 'op' && e.ev === 'drop' && e.b === bid));
  // un lieutenant de Dadou le ramasse et le dépose au bureau du directeur
  const lt = g.ents.get(g.factions.dadou.lieutenants[0])!;
  lt.invulnerable = true;
  c.place(lt, { x: dropped!.drop![0], y: dropped!.drop![1], z: dropped!.drop![2] });
  c.run(1, () => void c.place(lt, { x: dropped!.drop![0], y: dropped!.drop![1], z: dropped!.drop![2] }));
  check('un lieutenant ramasse l’acte', c.pubOp(bid)?.carrier === lt.id, JSON.stringify(c.pubOp(bid)));
  c.run(steps[2].time + 3, () => {
    c.place(lt, steps[2].anchor);
    return g.bstate.get(bid)!.owner === Faction.DADOU;
  });
  check('l’acte déposé au bureau du directeur : la banque est à Dadou', g.bstate.get(bid)!.owner === Faction.DADOU);
}

// ---------------------------------------------------------------------------- piratage interactif
section('Piratage interactif (marché tech, usine)');
{
  const c = newGame();
  const g = c.g;
  const bid = B('usine_drones');
  c.clearThugs(bid);
  const s0 = stepsOf(g, bid)[0];
  check('l’usine : un serveur à pirater', s0.kind === 'minigame');
  const boss = c.boss('even');
  c.place(boss, s0.anchor);
  g.action('even', { a: 'op', b: bid, k: s0.key });
  c.run(0.5, () => void c.place(boss, s0.anchor));
  g.action('even', { a: 'op', b: bid, k: s0.key, ok: true });
  c.run(0.3, () => void c.place(boss, s0.anchor));
  check(`une réussite trop rapide (< ${OP_MINIGAME_MIN} s) est refusée`, (c.pubOp(bid)?.step ?? 0) === 0);
  g.action('even', { a: 'op', b: bid, k: s0.key, ok: false });
  c.run(0.5, () => void c.place(boss, s0.anchor));
  check('un piratage raté déclenche l’alarme', c.events.some((e) => e.t === 'op' && e.ev === 'alarm' && e.b === bid) && c.events.some((e) => e.t === 'sound' && e.s === 'alarm_burst'));
  c.run(3, () => void c.place(boss, s0.anchor));
  g.action('even', { a: 'op', b: bid, k: s0.key });
  c.run(2.5, () => void c.place(boss, s0.anchor));
  g.action('even', { a: 'op', b: bid, k: s0.key, ok: true });
  c.run(0.5, () => void c.place(boss, s0.anchor));
  check('nouvel essai réussi : le serveur est piraté, l’usine est prise', g.bstate.get(bid)!.owner === Faction.EVEN, JSON.stringify(c.pubOp(bid)));
}

// ---------------------------------------------------------------------------- implants
section('Implants : poing hydraulique et bras tactique');
{
  const time = (equip: [string, number] | null): number => {
    const c = newGame();
    const g = c.g;
    const bid = B('ps1');
    c.clearThugs(bid);
    const s0 = stepsOf(g, bid)[0];
    const cy = g.factions.dadou.cyber;
    if (equip) {
      cy.owned.set(equip[0], equip[1]);
      cy.equip.brasD = equip[0];
    }
    const boss = c.boss('dadou');
    c.place(boss, s0.anchor);
    g.action('dadou', { a: 'op', b: bid, k: s0.key });
    let t = 0;
    c.run(60, () => {
      c.place(boss, s0.anchor);
      t += 0.05;
      return g.bstate.get(bid)!.owner === Faction.DADOU;
    });
    return t;
  };
  const base = time(null);
  const fist = time(['poing', 3]);
  const tool = time(['outils', 2]);
  check('forcer la réserve : sans implant', base > 8, `${base.toFixed(1)} s`);
  check('le poing hydraulique (niveau 3) défonce la porte bien plus vite', fist < base / 2.5, `${fist.toFixed(1)} s contre ${base.toFixed(1)} s`);
  check('le bras tactique (portes forcées) aussi', tool < base / 1.8, `${tool.toFixed(1)} s`);
}

// ---------------------------------------------------------------------------- deux parrains, un bâtiment
section('Deux parrains sur le même bâtiment');
{
  const c = newGame();
  const g = c.g;
  const bid = B('bodega_myrtle');
  const s0 = stepsOf(g, bid)[0];
  const dad = c.boss('dadou');
  const eve = c.boss('even');
  c.place(dad, s0.anchor);
  g.action('dadou', { a: 'op', b: bid, k: s0.key });
  c.run(1, () => void c.place(dad, s0.anchor));
  c.place(eve, { x: s0.anchor.x + 0.8, y: s0.anchor.y, z: s0.anchor.z });
  g.action('even', { a: 'op', b: bid, k: s0.key });
  let both = false;
  c.run(4, () => {
    c.place(dad, s0.anchor);
    c.place(eve, { x: s0.anchor.x + 0.8, y: s0.anchor.y, z: s0.anchor.z });
    const ops = g.publicState().ops?.filter((o) => o.b === bid) ?? [];
    if (ops.length > 1) both = true;
  });
  const op = c.pubOp(bid)!;
  check('une seule opération par bâtiment', !both && op.slot === 'dadou');
  check('Even, sur place, conteste celle de Dadou', op.contested);
  check('Even ne peut pas lancer la sienne en même temps', /mène déjà une opération/.test(c.events.filter((e) => e.t === 'notify' && e._to === 'even').map((e) => (e as { text: string }).text).join('|')));
  // Dadou s'en va : Even prend la main
  c.place(dad, { x: 5, z: 5 });
  c.run(OP_RIVAL_TAKEOVER + 2, () => {
    c.place(dad, { x: 5, z: 5 });
    c.place(eve, s0.anchor);
  });
  check('Dadou parti, son opération s’arrête', !c.pubOp(bid) || c.pubOp(bid)!.slot === 'even');
  g.action('even', { a: 'op', b: bid, k: s0.key });
  c.run(s0.time + 2, () => {
    c.place(eve, s0.anchor);
    return g.bstate.get(bid)!.owner !== Faction.NEUTRAL;
  });
  const captures = c.events.filter((e) => e.t === 'capture' && e.b === bid);
  check('Even prend la bodega, une seule fois, et elle n’a qu’un propriétaire', g.bstate.get(bid)!.owner === Faction.EVEN && captures.length === 1, JSON.stringify(captures));
}

// ---------------------------------------------------------------------------- lieutenant : un bâtiment clé, toutes ses étapes
section('Un lieutenant prend un bâtiment clé, étape par étape');
{
  const c = newGame();
  const g = c.g;
  const D = g.factions.dadou;
  D.money += 6000;
  g.action('dadou', { a: 'recruit', n: 10 });
  g.action('dadou', { a: 'upgrade', id: 'pistols' });
  g.action('dadou', { a: 'upgrade', id: 'vests' });
  const bid = B('club_electric');
  const steps = stepsOf(g, bid);
  const ltId = D.lieutenants[0];
  g.action('dadou', { a: 'order', lt: ltId, order: 'attack_building', target: bid, men: 12 });
  const seenSteps = new Set<number>();
  const statuses = new Set<string>();
  let maxTick = 0;
  let total = 0;
  let ticks = 0;
  let worked = false;
  c.run(420, () => {
    const t0 = performance.now();
    void t0;
    const op = c.pubOp(bid);
    if (op) {
      seenSteps.add(op.step);
      if (op.by & 2) worked = true;
    }
    statuses.add(g.privateState('dadou').lieutenants[0].state);
    return g.bstate.get(bid)!.owner === Faction.DADOU;
  });
  // mesure du coût d'un pas pendant une opération
  {
    const c2 = newGame();
    c2.g.action('dadou', { a: 'order', lt: c2.g.factions.dadou.lieutenants[0], order: 'attack_building', target: B('casse_bushwick'), men: 4 });
    for (let i = 0; i < 20 * 90; i++) {
      const t0 = performance.now();
      c2.g.step();
      const dt = performance.now() - t0;
      c2.g.takeOutbox();
      total += dt;
      ticks++;
      maxTick = Math.max(maxTick, dt);
    }
  }
  check(`Dadou prend ${BUILDING_BY_KEY['club_electric'].name} (${steps.length} étapes)`, g.bstate.get(bid)!.owner === Faction.DADOU, [...statuses].join(' | '));
  check('le lieutenant a mené lui-même les étapes', worked && steps.every((_, i) => seenSteps.has(i)), JSON.stringify([...seenSteps]));
  const st = [...statuses];
  check('rapports en français, étape par étape', steps.every((s) => st.some((x) => x.startsWith(s.doing))) && st.some((x) => x.startsWith('Se dirige vers')), st.join(' | '));
  check('tick moyen < 6 ms pendant une opération', total / ticks < 6, `${(total / ticks).toFixed(2)} ms (max ${maxTick.toFixed(1)} ms)`);
  console.log(`  (tick moyen ${(total / ticks).toFixed(2)} ms, max ${maxTick.toFixed(1)} ms)`);
}

// ---------------------------------------------------------------------------- interruption d'un lieutenant
section('Un lieutenant abattu interrompt l’opération');
{
  const c = newGame();
  const g = c.g;
  const D = g.factions.dadou;
  D.money += 3000;
  g.action('dadou', { a: 'recruit', n: 5 });
  const bid = B('casse_bushwick');
  const ltId = D.lieutenants[0];
  // (le lieutenant ne doit pas tomber avant d'être à l'œuvre : ses hommes font le ménage)
  g.ents.get(ltId)!.invulnerable = true;
  g.action('dadou', { a: 'order', lt: ltId, order: 'attack_building', target: bid, men: 9 });
  c.run(300, () => {
    const op = c.pubOp(bid);
    return !!op && (op.by & 2) === 2 && op.p > 0.2;
  });
  const before = c.pubOp(bid);
  const ltSt = g.privateState('dadou').lieutenants[0];
  check('le lieutenant est à l’œuvre', !!before && (before.by & 2) === 2, `${JSON.stringify(before)} — ${ltSt.state} (${ltSt.alive ? 'debout' : 'à terre'}), propriétaire ${g.bstate.get(bid)!.owner}`);
  const lt = g.ents.get(ltId)!;
  lt.invulnerable = false;
  g.damage(lt, 99999, null);
  c.run(1);
  const a = c.pubOp(bid);
  c.run(4);
  const b = c.pubOp(bid);
  check('abattu : l’opération reste mais personne n’y travaille', !!a && (a.by & 2) === 0 && a.rate <= 0, JSON.stringify(a));
  check('… et l’étape se perd lentement (reprise possible)', !!a && !!b && b.p < a.p && b.p > 0, `${a?.p} → ${b?.p}`);
}

// ---------------------------------------------------------------------------- QG
section('Le QG : imprenable sans 7 quartiers, puis l’assaut final');
{
  const c = newGame();
  const g = c.g;
  const hqId = g.factions.even.hqId;
  const steps = stepsOf(g, hqId);
  const boss = c.boss('dadou');
  c.place(boss, steps[0].anchor);
  g.action('dadou', { a: 'op', b: hqId, k: steps[0].key });
  c.run(1, () => void c.place(boss, steps[0].anchor));
  check('le QG d’Even est imprenable tant que Dadou n’a pas 7 quartiers', !c.pubOp(hqId) && /imprenable/.test(c.lastText('dadou')), c.lastText('dadou'));
  const evenHq = BUILDINGS[hqId];
  for (const d of DISTRICTS.filter((x) => x.id !== evenHq.district).slice(0, HQ_CAPTURE_MIN_DISTRICTS)) for (const k of keyBuildings(d.id)) g.setOwner(k.id, Faction.DADOU, 'dadou');
  c.run(0.5);
  check(`Dadou contrôle ${HQ_CAPTURE_MIN_DISTRICTS} quartiers`, g.territories('dadou') >= HQ_CAPTURE_MIN_DISTRICTS);
  // la garde du QG ne gêne pas ce test : on la renvoie loin
  for (const e of g.ents.values()) if (e.slot === 'even' && e.role !== 'boss' && e.alive && !e.invulnerable && e.role !== 'barman') g.damage(e, 99999, null);
  c.place(c.boss('even'), { x: 5, z: 5 });
  for (let i = 0; i < steps.length && !g.over; i++) {
    c.place(boss, steps[i].anchor);
    g.action('dadou', { a: 'op', b: hqId, k: steps[i].key });
    c.run(steps[i].time + 3, () => {
      c.place(boss, steps[i].anchor);
      c.place(c.boss('even'), { x: 5, z: 5 });
      return !!g.over || (c.pubOp(hqId)?.step ?? 0) > i;
    });
  }
  check(`l’assaut du QG en ${steps.length} étapes donne la victoire à Dadou`, g.over?.winner === 'dadou', JSON.stringify(g.over));
}

console.log(`\n${passed} réussi(s), ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
