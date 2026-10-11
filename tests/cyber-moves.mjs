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
const bot = spawn(process.execPath, ['tests/bot.mjs', code, 'even', new globalThis.URL(URL).origin], { stdio: 'inherit' });
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
const tp0 = await A.evaluate(() => window.__app.game.priv.tp);
const y0 = await A.evaluate(() => window.__app.game.player.pos.y);
await A.evaluate(() => {
  const g = window.__app.game;
  window.__ev = [];
  const prev = g.player.onMove;
  g.player.onMove = (e) => {
    window.__ev.push(e.k);
    prev?.(e);
  };
});
await A.keyboard.press('KeyF');
await waitGame(() => window.__app.game.player.mode === 'grapple', null, 2);
const grappling = await A.evaluate(() => window.__app.game.player.mode);
await shot('02-grapple.png');
await waitGame((y0) => window.__app.game.player.mode !== 'grapple' && window.__app.game.player.pos.y > y0 + 5, y0, 6);
const y1 = await A.evaluate(() => window.__app.game.player.pos.y);
check('grappin : accroché puis hissé', grappling === 'grapple' && y1 > y0 + 5, `mode ${grappling}, y ${y0.toFixed(1)} → ${y1.toFixed(1)}`);
await sleep(1500);
const tp1 = await A.evaluate(() => window.__app.game.priv.tp);
check('le serveur accepte le trajet (aucun recalage)', tp1 === tp0, `tp ${tp0} → ${tp1}`);
const seen = await A.evaluate(() => {
  const g = window.__app.game;
  const e = g.store.ents.get(g.selfId);
  return e ? e.y : null;
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
await A.keyboard.press('KeyY');
// bits visibles de mon parrain dans le dernier instantané du serveur
await waitGame(() => {
  const g = window.__app.game;
  const e = g.store.ents.get(g.selfId);
  return !!e && e.buf.length > 0 && (e.buf[e.buf.length - 1].s.fx & 4) !== 0;
}, null, 2);
const camo = await A.evaluate(() => {
  const g = window.__app.game;
  const e = g.store.ents.get(g.selfId);
  return e && e.buf.length ? e.buf[e.buf.length - 1].s.fx & 4 : 0;
});
check('camouflage confirmé par le serveur (bit visible)', camo !== 0);
await A.keyboard.press('KeyN');
await sleep(800);
const vision = await A.evaluate(() => window.__app.game.cyber.visionMode);
check('N : vision thermique', vision === 'thermal', vision);
await shot('06-thermal.png');
await A.keyboard.press('KeyN');
await sleep(300);
await A.keyboard.press('KeyV');
await sleep(1500);
await shot('07-third-person.png');
const hud = await A.evaluate(() => (window.__app.game.cyber, document.querySelector('.ab-hud, .mw-ab, [class*="ability"]')?.textContent ?? ''));
console.log('HUD des capacités :', hud.slice(0, 200));

check('aucune erreur dans la page', errors.length === 0, errors.slice(0, 3).join(' | '));
bot.kill();
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : '\nImplants en partie : tout est bon.');
process.exit(failures ? 1 : 0);
