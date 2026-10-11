// Test de bout en bout des implants en partie (navigateur) : implants installés (outil de test),
// grappin jusqu'à une façade, esquive, glissade, pistolet d'avant-bras, camouflage vu par le
// serveur, vision thermique, vue subjective et vue à la 3e personne.
// Usage : node tests/cyber-moves.mjs [dossier de sortie]
// Prérequis : serveur de jeu lancé avec MW_DEBUG=1 et Vite (URL=…, BOT=1 recommandé).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const OUT = process.argv[2] ?? 'test-output/cyber';
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.URL ?? 'http://localhost:5173/';
const W = Number(process.env.W ?? 960);
const H = Number(process.env.H ?? 540);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${info ? ` — ${info}` : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript(() => {
  try {
    const k = 'mafiawars2.settings.v1';
    const cur = JSON.parse(localStorage.getItem(k) || '{}');
    localStorage.setItem(k, JSON.stringify({ ...cur, quality: 'basse', renderScale: 0.5, bloom: false, thirdPerson: false }));
  } catch {
    /* stockage indisponible */
  }
});
const A = await ctx.newPage();
const errors = [];
A.on('console', (m) => {
  if (m.type() === 'error') {
    errors.push(m.text().slice(0, 300));
    console.log('[erreur]', m.text().slice(0, 300));
  }
});
A.on('pageerror', (e) => {
  errors.push(e.message);
  console.log('[pageerror]', e.message);
});
/** Attend une condition, ou que le temps de jeu ait avancé de `game` secondes (rendu logiciel lent). */
const waitGame = async (fn, arg, game = 3, real = 240000) => {
  const t0 = await A.evaluate(() => window.__app.game.player.t);
  await A.waitForFunction(
    ([src, a, t0, game]) => {
      const f = new Function('a', `return (${src})(a)`);
      return f(a) || window.__app.game.player.t - t0 > game;
    },
    [fn.toString(), arg, t0, game],
    { timeout: real, polling: 100 },
  ).catch(() => undefined);
};
const shot = async (file) => {
  await A.screenshot({ path: `${OUT}/${file}`, timeout: 180000 });
  console.log('capture', file);
};

console.log('=== Partie');
await A.goto(URL, { timeout: 180000, waitUntil: 'domcontentloaded' });
await A.waitForSelector('text=Créer une partie', { timeout: 120000 });
await A.click('text=Créer une partie');
await A.waitForFunction(() => window.__app?.net?.room?.code, null, { timeout: 180000, polling: 250 });
const code = await A.evaluate(() => window.__app.net.room.code);
// le robot (Even) reçoit des ordres du test sur son entrée standard (BOT_CMDS=1)
const bot = spawn(process.execPath, ['tests/bot.mjs', code, 'even', new globalThis.URL(URL).origin], { stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, BOT_CMDS: '1' } });
bot.stdin.on('error', () => undefined); // robot déjà parti : on l'ignore (le test échouera plus loin)
const botAct = (a) => bot.stdin.write(JSON.stringify(a) + '\n');
await A.waitForFunction(() => Object.keys(window.__app.net.room?.players ?? {}).length === 2, null, { timeout: 180000, polling: 250 });
await A.evaluate(() => window.__app.net.pick('dadou'));
await sleep(500);
await A.evaluate(() => window.__app.net.setReady(true));
await A.waitForFunction(() => window.__app?.game && window.__app.game.placed === true, null, { timeout: 600000, polling: 500 });
await sleep(2000);

// implants installés directement (outil de test) : bras, jambes, peau, neural, yeux
const kit = [
  ['grappin', 3, 'brasG'],
  ['pistoletBras', 2, 'brasD'],
  ['esquive', 3, 'jambes1'],
  ['doubleSaut', 2, 'jambes2'],
  ['glissade', 3, 'jambes3'],
  ['blindage', 2, 'torse1'],
  ['treuil', 1, 'colonne'],
  ['thermique', 2, 'yeux1'],
  ['scanner', 1, 'yeux2'],
  ['camouflage', 1, 'peau'],
  ['reflexes', 1, 'neural1'],
];
await A.evaluate((kit) => {
  const net = window.__app.net;
  net.act({ a: 'debugMoney', n: 50000 });
  for (const [id, lv, slot] of kit) net.act({ a: 'debugCyber', id, lv, slot });
}, kit);
await A.waitForFunction(() => window.__app.game.priv.cyber?.equip?.brasG === 'grappin' && window.__app.game.player.mods.grapple, null, { timeout: 180000, polling: 250 });
const eq = await A.evaluate(() => window.__app.game.priv.cyber.equip);
check('implants installés (état privé)', eq.brasG === 'grappin' && eq.brasD === 'pistoletBras' && eq.peau === 'camouflage', JSON.stringify(eq));
const look = await A.evaluate(() => window.__app.game.cyber.look);
check('apparence publique transmise', look.includes('brasG=grappin:3'), look.join(' '));

// une façade haute devant soi : bâtiment de plus de 18 m, côté porte
const spot = await A.evaluate(() => {
  const g = window.__app.game;
  const p = g.player.pos;
  let best = null;
  let bd = Infinity;
  for (const b of g.world.buildings) {
    if (b.height < 18 || !b.doors.length) continue;
    const d = Math.hypot(b.center.x - p.x, b.center.z - p.z);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  const door = best.doors[0].out;
  const cx = (best.footprint[0] + best.footprint[2]) / 2;
  const cz = (best.footprint[1] + best.footprint[3]) / 2;
  let ux = door.x - cx;
  let uz = door.z - cz;
  const l = Math.hypot(ux, uz);
  ux /= l;
  uz /= l;
  return { name: best.def.name, x: door.x + ux * 9, z: door.z + uz * 9, yaw: Math.atan2(-ux, -uz), h: best.height };
});
console.log('façade :', JSON.stringify(spot));
await A.evaluate((s) => window.__app.net.act({ a: 'debugTp', x: s.x, z: s.z, yaw: s.yaw, dayTime: 0.5 }), spot);
await A.waitForFunction((s) => Math.hypot(window.__app.game.player.pos.x - s.x, window.__app.game.player.pos.z - s.z) < 1, spot, { timeout: 180000, polling: 250 });
await A.mouse.click(W / 2, H / 2);
await sleep(1500);
await A.evaluate(() => {
  const p = window.__app.game.player;
  p.pitch = 0.75;
});
await sleep(600);
await shot('01-fp-implants.png');

console.log('=== Grappin');
await A.evaluate(() => {
  const g = window.__app.game;
  window.__ev = [];
  window.__mv = [];
  const prev = g.player.onMove;
  g.player.onMove = (e) => {
    window.__ev.push(e.k);
    const p = g.player;
    window.__mv.push({ k: e.k, y: e.y, y2: e.y2 ?? null, at: `pos ${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)},${p.pos.z.toFixed(1)} lacet ${p.yaw.toFixed(2)} tangage ${p.pitch.toFixed(2)} sol ${p.onGround} 1re ${p.firstPerson}` });
    prev?.(e);
  };
});
// sous forte charge, une téléportation tardive (debugTp) remet le regard à l'horizontale, et une
// coupure réseau (reconnexion : le parrain est replacé là où le serveur le voit) annule le
// grappin : on relève le regard juste avant F, et on recommence dans ces deux cas seulement
await A.evaluate(() => {
  window.__cuts = 0;
  window.__app.net.on('disconnected', () => window.__cuts++);
});
let tp0 = 0;
let y0 = 0;
let y1 = 0;
let anchorY = 0;
let grappling = 'walk';
for (let i = 0; i < 3; i++) {
  await waitGame(() => {
    const p = window.__app.game.player;
    return p.t >= p.grappleReadyAt && p.onGround && !p.hook && p.mode === 'walk';
  }, null, 3);
  tp0 = await A.evaluate(() => window.__app.game.priv.tp);
  const cuts0 = await A.evaluate(() => window.__cuts);
  y0 = await A.evaluate(() => {
    window.__mv.length = 0;
    const p = window.__app.game.player;
    p.pitch = 0.75;
    return p.pos.y;
  });
  await A.keyboard.press('KeyF');
  await waitGame(() => window.__mv.some((m) => m.k === 'grappleAttach' || m.k === 'grappleMiss'), null, 2);
  const fired = await A.evaluate(() => window.__mv.find((m) => m.k === 'grappleFire' || m.k === 'grappleMiss') ?? null);
  anchorY = fired?.y2 ?? 0;
  grappling = (await A.evaluate(() => window.__mv.some((m) => m.k === 'grappleAttach'))) ? 'grapple' : fired ? fired.k : 'rien';
  if (grappling === 'grapple' && anchorY > y0 + 6) {
    await shot('02-grapple.png');
    await waitGame((y0) => window.__app.game.player.mode !== 'grapple' && window.__app.game.player.pos.y > y0 + 5, y0, 6);
    y1 = await A.evaluate(() => window.__app.game.player.pos.y);
    if (y1 > y0 + 5) break;
    const cut = (await A.evaluate(() => window.__cuts)) > cuts0;
    console.log(`  (essai ${i + 1} : accroché à ${anchorY.toFixed(1)} m mais y ${y1.toFixed(1)} ; coupure réseau : ${cut ? 'oui — on recommence' : 'non'})`);
    if (!cut) break;
  } else console.log(`  (essai ${i + 1} : ${grappling}, ancre ${anchorY.toFixed(1)} m ; au tir : ${fired?.at ?? '?'} ; lacet voulu ${spot.yaw.toFixed(2)} — on recommence)`);
  // on lâche et on revient au point de départ
  if (await A.evaluate(() => !!window.__app.game.player.grapple)) await A.keyboard.press('KeyF');
  await A.evaluate((s) => window.__app.net.act({ a: 'debugTp', x: s.x, z: s.z, yaw: s.yaw }), spot);
  await A.waitForFunction((s) => Math.hypot(window.__app.game.player.pos.x - s.x, window.__app.game.player.pos.z - s.z) < 1, spot, { timeout: 180000, polling: 250 });
}
check('grappin : accroché puis hissé', grappling === 'grapple' && y1 > y0 + 5, `mode ${grappling}, ancre ${anchorY.toFixed(1)} m, y ${y0.toFixed(1)} → ${y1.toFixed(1)}`);
await sleep(1500);
const tp1 = await A.evaluate(() => window.__app.game.priv.tp);
check('le serveur accepte le trajet (aucun recalage)', tp1 === tp0, `tp ${tp0} → ${tp1}`);
// dernier instantané du serveur pour mon parrain (la vue locale n'est pas interpolée)
await sleep(1500);
const seen = await A.evaluate(() => {
  const g = window.__app.game;
  const e = g.store.ents.get(g.selfId);
  return e && e.buf.length ? e.buf[e.buf.length - 1].s.y : null;
});
check('position confirmée par le serveur', seen !== null && Math.abs(seen - y1) < 1.5, `serveur ${seen?.toFixed(1)} / client ${y1.toFixed(1)}`);
await shot('03-after-grapple.png');

console.log('=== Retour au sol, esquive, glissade');
// au milieu de la rue, dans l'axe de la rue (parallèle à la façade)
const lane = { x: spot.x + Math.sin(spot.yaw + Math.PI) * 5, z: spot.z + Math.cos(spot.yaw + Math.PI) * 5, yaw: spot.yaw + Math.PI / 2 };
await A.evaluate((s) => window.__app.net.act({ a: 'debugTp', x: s.x, z: s.z, yaw: s.yaw }), lane);
await A.waitForFunction((s) => Math.hypot(window.__app.game.player.pos.x - s.x, window.__app.game.player.pos.z - s.z) < 1 && window.__app.game.player.onGround, lane, { timeout: 180000, polling: 250 });
await waitGame(() => false, null, 0.5);
const p0 = await A.evaluate(() => window.__app.game.player.pos.clone());
await A.keyboard.press('KeyZ');
await waitGame(() => window.__ev.includes('dash'), null, 1);
await waitGame(() => false, null, 0.5);
const p1 = await A.evaluate(() => window.__app.game.player.pos.clone());
const dashD = Math.hypot(p1.x - p0.x, p1.z - p0.z);
check('esquive (Z) : bond de 7 m', dashD > 5, `${dashD.toFixed(2)} m`);
await A.evaluate((s) => window.__app.net.act({ a: 'debugTp', x: s.x, z: s.z, yaw: s.yaw }), lane);
await A.waitForFunction((s) => Math.hypot(window.__app.game.player.pos.x - s.x, window.__app.game.player.pos.z - s.z) < 1, lane, { timeout: 180000, polling: 250 });
await A.keyboard.down('KeyW');
await A.keyboard.down('ShiftLeft');
await waitGame(() => window.__app.game.player.hspeed() > 5.5, null, 3);
await A.keyboard.press('KeyC');
await waitGame(() => window.__app.game.player.mode === 'slide' || window.__ev.includes('slide'), null, 0.5);
const slideMode = (await A.evaluate(() => window.__ev.includes('slide'))) ? 'slide' : await A.evaluate(() => window.__app.game.player.mode);
await shot('04-slide.png');
await A.keyboard.up('ShiftLeft');
await A.keyboard.up('KeyW');
check('glissade (C en sprintant)', slideMode === 'slide', slideMode);
await sleep(1500);

console.log('=== Pistolet d’avant-bras');
await A.keyboard.press('KeyX');
await waitGame(() => window.__app.game.weapons.current === 7, null, 1);
const wpn = await A.evaluate(() => window.__app.game.weapons.current);
check('X : pistolet d’avant-bras sorti', wpn === 7, `arme ${wpn}`);
await waitGame(() => false, null, 0.6);
const mag0 = await A.evaluate(() => window.__app.game.weapons.mag.get(7));
await A.mouse.click(W / 2, H / 2);
await waitGame((m) => window.__app.game.weapons.mag.get(7) < m, mag0, 1);
const mag1 = await A.evaluate(() => window.__app.game.weapons.mag.get(7));
check('tir de l’avant-bras', mag1 === mag0 - 1, `${mag0} → ${mag1}`);
await shot('05-arm-pistol.png');
await A.keyboard.press('KeyX');
await sleep(500);

console.log('=== Camouflage et vision');
await A.evaluate(() => {
  window.__abs = [];
  window.__camoSeen = false;
  const g = window.__app.game;
  window.__app.net.on('ev', (evs) => {
    for (const e of evs) if (e.t === 'ab') window.__abs.push(e.ab);
  });
  // chaque instantané reçu : le bit CAMOUFLAGE de mon parrain (le camouflage ne dure que 5 s)
  const orig = g.store.applySnapshot.bind(g.store);
  g.store.applySnapshot = (time, list) => {
    for (const s of list) if (s.id === g.selfId && s.fx & 4) window.__camoSeen = true;
    orig(time, list);
  };
});
await A.keyboard.press('KeyY');
// la touche n'est lue qu'à l'image suivante (rendu logiciel : plusieurs secondes)
await A.waitForFunction(() => window.__abs.includes('camouflage'), null, { timeout: 120000, polling: 100 }).catch(() => undefined);
// bit visible reçu dans les instantanés du serveur pendant le camouflage
await A.waitForFunction(() => window.__camoSeen, null, { timeout: 60000, polling: 100 }).catch(() => undefined);
const camo = (await A.evaluate(() => window.__camoSeen)) ? 4 : 0;
check('camouflage confirmé par le serveur (bit visible)', camo !== 0);
if (!camo) console.log('diagnostic camouflage :', JSON.stringify(await A.evaluate(() => {
  const g = window.__app.game;
  return { abs: window.__abs, cd: [...g.cyber['localCd'].entries()], server: [...g.cyber['serverCd'].entries()], connected: g.app.net.connected, equip: g.priv.cyber.equip.peau, blocked: g.modules.map((m) => !!m.blocking?.()), notices: [...document.querySelectorAll('.hud-notices > *')].map((n) => n.textContent).slice(-4) };
})));
await A.keyboard.press('KeyN');
await A.waitForFunction(() => window.__app.game.cyber.visionMode !== 'normal', null, { timeout: 120000, polling: 100 }).catch(() => undefined);
const vision = await A.evaluate(() => window.__app.game.cyber.visionMode);
check('N : vision thermique', vision === 'thermal', vision);
await shot('06-thermal.png');
await A.keyboard.press('KeyN');
await sleep(300);
await A.keyboard.press('KeyV');
await sleep(1500);
await shot('07-third-person.png');
const chips = await A.evaluate(() => document.querySelectorAll('.ab-bar:not(.hidden) .ab-chip').length);
check('HUD des capacités : une pastille par commande', chips >= 8, `${chips} pastille(s)`);

console.log('=== Implants de l’adversaire, vus chez moi');
// Even (le robot) s'équipe, sort sa lame et vient se placer à 4 m devant mon parrain, face à moi :
// mon navigateur doit recevoir son apparence et construire ses implants. Rendez-vous 35 m plus
// loin dans la rue : devant mon QG, mes hommes abattraient Even (qui ne bouge pas).
await A.keyboard.press('KeyV'); // retour en vue subjective
// sur le trottoir (12 m vers les façades depuis l'axe de la rue) : la circulation, simulée par
// chaque navigateur, s'arrête devant un piéton sur la chaussée et masquerait Even ; à défaut
// (trottoir encombré), au milieu de la rue
const ground0 = await A.evaluate(() => window.__app.game.player.pos.y);
const toFacade = { x: Math.sin(spot.yaw), z: Math.cos(spot.yaw) };
let meet = { x: lane.x + Math.sin(lane.yaw) * 35 + toFacade.x * 12, z: lane.z + Math.cos(lane.yaw) * 35 + toFacade.z * 12, yaw: lane.yaw };
for (const fallback of [false, true]) {
  if (fallback) meet = { x: lane.x + Math.sin(lane.yaw) * 35, z: lane.z + Math.cos(lane.yaw) * 35, yaw: lane.yaw };
  await A.evaluate((s) => window.__app.net.act({ a: 'debugTp', x: s.x, z: s.z, yaw: s.yaw }), meet);
  await A.waitForFunction((s) => Math.hypot(window.__app.game.player.pos.x - s.x, window.__app.game.player.pos.z - s.z) < 1, meet, { timeout: 180000, polling: 250 });
  await waitGame(() => false, null, 0.5);
  const y = await A.evaluate(() => window.__app.game.player.pos.y);
  if (Math.abs(y - ground0) < 0.6) break;
  console.log(`  (trottoir à ${y.toFixed(1)} m : rendez-vous au milieu de la rue)`);
}
const rivalKit = [
  ['grappin', 3, 'brasG'],
  ['lame', 2, 'brasD'],
  ['esquive', 2, 'jambes1'],
  ['doubleSaut', 1, 'jambes2'],
  ['blindage', 3, 'torse1'],
  ['treuil', 1, 'colonne'],
  ['thermique', 2, 'yeux1'],
];
botAct({ a: 'debugMoney', n: 50000 });
for (const [id, lv, slot] of rivalKit) botAct({ a: 'debugCyber', id, lv, slot });
// à 2,6 m, de trois quarts : le bras droit (lame) tourné vers moi
const front = { x: meet.x + Math.sin(meet.yaw) * 2.6, z: meet.z + Math.cos(meet.yaw) * 2.6, yaw: meet.yaw + Math.PI * 1.25 };
botAct({ a: 'debugTp', x: front.x, z: front.z, yaw: front.yaw });
await sleep(1500);
botAct({ a: 'ab', id: 'bras', slot: 'brasD' });
const rivalState = () => {
  const g = window.__app.game;
  return [...g.store.ents.values()]
    .filter((e) => e.info?.kind === 1)
    .map((e) => ({
      id: e.info.id,
      look: (e.view.cyber ?? []).join(' '),
      fx: e.view.fx,
      alive: e.alive,
      d: Math.hypot(e.x - g.player.pos.x, e.z - g.player.pos.z),
      sig: g.chars.states.get(e.info.id)?.cy?.sig ?? null,
    }));
};
const rival = await A.waitForFunction(
  (src) => {
    const list = new Function(`return (${src})()`)();
    const r = list.find((e) => /brasD=lame/.test(e.look) && e.d < 8 && e.sig && e.fx & 16);
    return r ? { ...r, sig: String(r.sig) } : false;
  },
  rivalState.toString(),
  { timeout: 240000, polling: 500 },
)
  .then((h) => h.jsonValue())
  .catch(() => null);
if (!rival) console.log('diagnostic Even :', JSON.stringify(await A.evaluate(new Function(`return (${rivalState.toString()})()`))));
check('apparence d’Even reçue (bras, jambes, torse, yeux)', !!rival && /brasG=grappin/.test(rival.look) && /jambes1=esquive/.test(rival.look) && /yeux1=thermique/.test(rival.look), rival ? `${rival.look} — à ${rival.d.toFixed(1)} m` : 'Even introuvable près de moi');
check('implants d’Even construits par mon rendu', !!rival?.sig, rival ? `signature ${rival.sig.slice(0, 60)}` : '');
check('lame d’Even sortie, visible chez moi (bit du bras droit)', !!rival && (rival.fx & 16) !== 0, rival ? `fx ${rival.fx}` : '');
// regard vers Even, un peu vers le bas ; captures en pleine définition (le test tourne en demi)
await A.evaluate((f) => {
  const g = window.__app.game;
  const p = g.player;
  p.yaw = Math.atan2(f.x - p.pos.x, f.z - p.pos.z);
  p.pitch = -0.22;
  g.renderer.setPixelRatio(1);
  g.renderer.setSize(window.innerWidth, window.innerHeight, false);
  g.post.setSize(window.innerWidth, window.innerHeight);
}, front);
await waitGame(() => false, null, 0.6);
await shot('08-rival-implants.png');

// Even lance son grappin vers une façade : chez moi, le câble doit apparaître (bit du grappin et
// ancre reçus) ; le serveur garde le câble 7 s, on relance au besoin (recharge de 3,5 s)
const aim = await A.evaluate((f) => {
  const g = window.__app.game;
  const ev = [...g.store.ents.values()].find((e) => e.info?.kind === 1);
  if (!ev) return null;
  const o = { x: f.x, y: ev.y + 1.6, z: f.z };
  // une façade à 4–30 m, en tournant autour d'Even : la plus proche (câble bien visible)
  let best = null;
  for (const pitch of [0.6, 0.9]) {
    for (let i = 0; i < 24; i++) {
      const yaw = (i / 24) * Math.PI * 2;
      const d = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
      const dist = g.world.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 30, undefined, 'solid');
      if (dist >= 4 && (!best || dist < best.dist)) best = { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z], p: [o.x + d.x * dist, o.y + d.y * dist, o.z + d.z * dist], dist };
    }
  }
  return best;
}, front);
let cable = false;
if (aim && rival) {
  // relancé toutes les 4 s (recharge de 3,5 s, câble gardé 7 s) : il reste tendu même si une
  // image prend plusieurs secondes en rendu logiciel
  const fire = () => botAct({ a: 'ab', id: 'grappin', slot: 'brasG', o: aim.o, d: aim.d, p: aim.p });
  fire();
  const timer = setInterval(fire, 4000);
  cable = await A.waitForFunction(
    (id) => {
      const g = window.__app.game;
      const e = g.store.ents.get(id);
      return !!e && (e.view.fx & 1) !== 0 && g.cyber.anchors.has(id);
    },
    rival.id,
    { timeout: 180000, polling: 200 },
  )
    .then(() => true)
    .catch(() => false);
  if (cable) await shot('09-rival-grapple.png');
  clearInterval(timer);
}
check('grappin d’Even : câble visible chez moi', cable, aim ? `ancre à ${aim.dist.toFixed(1)} m` : 'aucune façade visée');

const cuts = await A.evaluate(() => window.__cuts ?? 0);
if (cuts) console.log(`(coupures réseau pendant le test : ${cuts} — rendu logiciel surchargé)`);
check('aucune erreur dans la page', errors.length === 0, errors.slice(0, 3).join(' | '));
bot.kill();
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : '\nImplants en partie : tout est bon.');
process.exit(failures ? 1 : 0);
