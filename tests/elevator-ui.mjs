// Ascenseur dans le vrai client : devant la porte d'un ascenseur, l'invite « Ascenseur »
// apparaît, E ouvre le choix de l'étage, une touche chiffrée y emmène le parrain.
// Usage : node tests/elevator-ui.mjs [dossier des captures]
// Prérequis : client et serveur compilés (npm run build) ; le test lance son serveur (MW_DEBUG=1).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const OUT = process.argv[2] ?? 'test-output/elevator';
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${info ? ` — ${info}` : ''}`);
  if (!ok) failures++;
};
const PORT = 3105;
const server = spawn(process.execPath, ['dist/server/main.js'], { env: { ...process.env, PORT: String(PORT), MW_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let bot = null;
process.on('exit', () => {
  server.kill();
  bot?.kill();
});
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('serveur prêt') && r()));

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/proxy/i.test(k))),
});
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('mafiawars2.settings.v1', JSON.stringify({ quality: 'basse', renderScale: 0.5, tips: false }));
  } catch {
    /* rien */
  }
});
const A = await ctx.newPage();
const errors = [];
A.on('pageerror', (e) => errors.push(e.message));
await A.goto(`http://localhost:${PORT}/`, { timeout: 180000 });
await A.waitForSelector('text=Créer une partie', { timeout: 180000 });
await A.click('text=Créer une partie');
await A.waitForFunction(() => window.__app?.net?.room?.code, null, { timeout: 120000, polling: 250 });
const code = await A.evaluate(() => window.__app.net.room.code);
bot = spawn(process.execPath, ['tests/bot.mjs', code, 'even', `http://localhost:${PORT}`], { stdio: 'inherit' });
await A.waitForFunction(() => Object.keys(window.__app.net.room?.players ?? {}).length === 2, null, { timeout: 120000, polling: 250 });
await A.evaluate(() => window.__app.net.pick('dadou'));
await A.waitForTimeout(500);
await A.evaluate(() => window.__app.net.setReady(true));
await A.waitForFunction(() => window.__app?.game?.placed === true, null, { timeout: 600000, polling: 500 });

// devant l'ascenseur du hall d'une tour
const tower = await A.evaluate(() => {
  const b = window.__app.game.world.buildings.find((x) => x.elevator && x.elevator.length >= 3);
  return b ? { name: b.def.name, stops: b.elevator } : null;
});
check('une tour avec ascenseur', !!tower, tower?.name);
const hall = tower.stops[0];
await A.evaluate((s) => window.__app.net.act({ a: 'debugTp', x: s.x, z: s.z, y: s.y, yaw: s.yaw }), hall);
await A.waitForFunction((s) => Math.hypot(window.__app.game.player.pos.x - s.x, window.__app.game.player.pos.z - s.z) < 1, hall, { timeout: 180000, polling: 250 });
await A.mouse.click(480, 270);
await A.waitForFunction(() => /Ascenseur/.test(document.querySelector('.hud-prompt')?.textContent ?? ''), null, { timeout: 120000, polling: 250 }).catch(() => {});
const prompt = await A.evaluate(() => document.querySelector('.hud-prompt')?.textContent ?? '');
check('invite « Ascenseur » devant la porte', /Ascenseur/.test(prompt), prompt);
await A.screenshot({ path: `${OUT}/01-porte.png`, timeout: 180000 });
await A.keyboard.press('KeyE');
await A.waitForSelector('.mw-elev', { timeout: 120000 }).catch(() => {});
const items = await A.evaluate(() => [...document.querySelectorAll('.mw-elev-list .btn')].map((b) => b.textContent.trim()));
check('E : choix de l’étage', items.length === tower.stops.length, items.join(' | '));
await A.screenshot({ path: `${OUT}/02-choix.png`, timeout: 180000 });
const last = tower.stops.length - 1;
await A.keyboard.press(`Digit${last}`); // l'étage actuel n'a pas de numéro : le toit porte le n° last
const roof = tower.stops[last];
await A.waitForFunction((y) => Math.abs(window.__app.game.player.pos.y - y) < 0.6, roof.y, { timeout: 180000, polling: 250 }).catch(() => {});
const y = await A.evaluate(() => window.__app.game.player.pos.y);
check(`touche ${last} : arrivée au ${roof.label}`, Math.abs(y - roof.y) < 0.6, `y ${y.toFixed(1)} (attendu ${roof.y.toFixed(1)})`);
check('panneau refermé, jeu repris', await A.evaluate(() => !document.querySelector('.mw-elev')));
await A.waitForTimeout(1500);
await A.screenshot({ path: `${OUT}/03-toit.png`, timeout: 180000 });
check('aucune erreur dans la page', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : '\nAscenseur (client) : tout est bon.');
process.exit(failures ? 1 : 0);
