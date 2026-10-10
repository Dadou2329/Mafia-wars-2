// Test de bout en bout avec deux navigateurs : menu → salon → choix des parrains → prêt →
// partie (déplacement, tir, carte stratégique et ordre au lieutenant, roue des ordres,
// changement de vue, pause). Usage : node tests/e2e.mjs [dossier de sortie]
// Prérequis : serveur de jeu (port 3000) et Vite (port 5173) lancés.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const OUT = process.argv[2] ?? 'test-output';
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.URL ?? 'http://localhost:5173/';
const sleep0 = (ms) => new Promise((r) => setTimeout(r, ms));
const W = Number(process.env.W ?? 1280);
const H = Number(process.env.H ?? 720);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function client(name) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  // LOWGFX=1 : graphismes au minimum (machines sans carte graphique / rendu logiciel)
  if (process.env.LOWGFX)
    await ctx.addInitScript(() => {
      try {
        const k = 'mafiawars.settings.v1';
        const cur = JSON.parse(localStorage.getItem(k) || '{}');
        localStorage.setItem(k, JSON.stringify({ ...cur, quality: 'basse', renderScale: 0.5, bloom: false }));
      } catch {
        /* stockage indisponible */
      }
    });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || m.type() === 'warning') {
      console.log(`[${name} ${m.type()}]`, t.slice(0, 300));
      if (m.type() === 'error') errors.push(`${name}: ${t.slice(0, 300)}`);
    }
  });
  page.on('pageerror', (e) => {
    console.log(`[${name} pageerror]`, e.message);
    errors.push(`${name} pageerror: ${e.message}`);
  });
  return page;
}
const shot = async (page, file) => {
  await page.screenshot({ path: `${OUT}/${file}`, timeout: 180000 });
  console.log('capture', file);
};
const step = (s) => console.log(`\n=== ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// BOT=1 : le second joueur est un client Socket.IO sans navigateur (tests/bot.mjs),
// pour ne faire tourner qu'un seul rendu WebGL sur les machines lentes.
const BOT = !!process.env.BOT;
const A = await client('Dadou');
const B = BOT ? null : await client('Even');
let bot = null;

step('Menu');
await A.goto(URL, { timeout: 180000, waitUntil: 'domcontentloaded' });
await A.waitForSelector('text=Créer une partie', { timeout: 60000 });
await sleep(1500);
await shot(A, '01-menu.png');

step('Création du salon');
await A.click('text=Créer une partie');
await A.waitForFunction(() => window.__app?.net?.room?.code, null, { timeout: 30000 });
const code = await A.evaluate(() => window.__app.net.room.code);
console.log('code du salon :', code);
await sleep(800);
await shot(A, '02-lobby-host.png').catch(() => console.log('capture du salon trop lente'));

step('Invité rejoint');
if (BOT) {
  bot = spawn(process.execPath, ['tests/bot.mjs', code, 'even', new globalThis.URL(URL).origin], { stdio: 'inherit' });
  await A.waitForFunction(() => Object.keys(window.__app.net.room?.players ?? {}).length === 2, null, { timeout: 60000 });
} else {
  await B.goto(`${URL}?code=${code}`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await B.waitForFunction(() => window.__app?.net?.room?.code, null, { timeout: 60000 });
}
await sleep(2000);

step('Choix des parrains');
// API_LOBBY=1 : on passe par le réseau plutôt que par les boutons (rendu logiciel trop lent)
if (BOT) {
  await A.evaluate(() => window.__app.net.pick('dadou'));
} else if (process.env.API_LOBBY) {
  await A.evaluate(() => window.__app.net.pick('dadou'));
  await sleep(800);
  await B.evaluate(() => window.__app.net.pick('even'));
} else {
  await A.click('.btn.dadou.mw-card-pick', { timeout: 60000 });
  await sleep(800);
  await B.click('.btn.even.mw-card-pick', { timeout: 60000 });
}
await sleep(800);
const picks = await A.evaluate(() => window.__app.net.room.picks);
console.log('choix :', JSON.stringify(picks));
// Dadou est pris : le bouton de l'invité doit être indisponible
if (B) {
  const evenSees = await B.evaluate(() => document.querySelector('.btn.dadou.mw-card-pick')?.textContent);
  console.log('Bouton Dadou vu par Even :', evenSees);
} else {
  const evenSees = await A.evaluate(() => document.querySelector('.btn.even.mw-card-pick')?.textContent);
  console.log('Bouton Even vu par Dadou (pris par le robot) :', evenSees);
}
await shot(A, '03-lobby-picks-A.png').catch(() => console.log('capture du salon trop lente'));
if (B) await shot(B, '03-lobby-picks-B.png').catch(() => console.log('capture du salon trop lente'));

step('Prêts');
if (BOT) {
  await A.evaluate(() => window.__app.net.setReady(true));
} else if (process.env.API_LOBBY) {
  await A.evaluate(() => window.__app.net.setReady(true));
  await sleep(800);
  await B.evaluate(() => window.__app.net.setReady(true));
} else {
  await A.click('.mw-ready', { timeout: 60000 });
  await sleep(800);
  await B.click('.mw-ready', { timeout: 60000 });
}
const t0 = Date.now();
await A.waitForFunction(() => window.__app?.game && window.__app.game.placed === true, null, { timeout: 240000 });
if (B) await B.waitForFunction(() => window.__app?.game && window.__app.game.placed === true, null, { timeout: 240000 });
console.log(`partie lancée et joueurs placés en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await sleep(4000);
await shot(A, '04-game-A.png');
if (B) await shot(B, '04-game-B.png');

const state = (page) =>
  page.evaluate(() => {
    const g = window.__app.game;
    const p = g.player.pos;
    return {
      you: g.you,
      pos: [p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2)],
      money: g.priv.money,
      men: g.priv.men,
      lts: g.priv.lieutenants.map((l) => `${l.name}:${l.state}:${l.order}:${l.men}@${l.x.toFixed(0)},${l.z.toFixed(0)}`),
      ents: g.store.ents.size,
      fps: g['fpsAcc'].v.toFixed(1),
      objective: document.querySelector('.hud-objective')?.textContent ?? '',
    };
  });
console.log('A', JSON.stringify(await state(A)));
if (B) console.log('B', JSON.stringify(await state(B)));

step('Déplacement (S maintenu 2 s : on recule, le bureau est devant)');
await A.mouse.click(W / 2, H / 2);
const before = await A.evaluate(() => window.__app.game.player.pos.clone());
await A.keyboard.down('KeyS');
await sleep(2000);
await A.keyboard.up('KeyS');
await sleep(600);
const after = await A.evaluate(() => window.__app.game.player.pos.clone());
console.log('déplacement local :', JSON.stringify(before), '→', JSON.stringify(after));
if (B) {
  const seenByB = await B.evaluate(() => {
    const e = window.__app.game.store.ents.get(1);
    return e ? [e.x.toFixed(2), e.z.toFixed(2)] : null;
  });
  console.log('position de Dadou vue par Even :', seenByB);
}

step('Tir');
const ammo0 = await A.evaluate(() => window.__app.game.weapons.mag.get(1));
await A.mouse.click(W / 2, H / 2);
await sleep(500);
await A.mouse.click(W / 2, H / 2);
await sleep(300);
const ammo1 = await A.evaluate(() => window.__app.game.weapons.mag.get(1));
console.log('munitions :', ammo0, '→', ammo1);
await shot(A, '05-after-shots-A.png');

step('Vue à la troisième personne (V)');
await A.keyboard.press('KeyV');
await sleep(1200);
await shot(A, '06-third-person-A.png');
await A.keyboard.press('KeyV');

step('Roue des ordres (Q + 1 : « Suivez-moi »)');
await A.keyboard.down('KeyQ');
await sleep(400);
await shot(A, '07-wheel-A.png');
await A.keyboard.press('Digit1');
await sleep(150);
await A.keyboard.up('KeyQ');
await A.waitForFunction(() => [...document.querySelectorAll('.hud-notices > *')].some((n) => /suivent|portée/.test(n.textContent ?? '')), null, { timeout: 30000 }).catch(() => undefined);
console.log('notifications :', await A.evaluate(() => [...document.querySelectorAll('.hud-notices > *')].map((n) => n.textContent).join(' | ')));

step('Carte stratégique et ordre d’attaque');
await A.evaluate(() => window.__app.game.strategic.show('orders'));
await sleep(800);
await shot(A, '08-strategic-A.png');
// clic sur la cible de la première mission (Le Chat Noir)
const target = await A.evaluate(() => {
  const g = window.__app.game;
  const sm = g.strategic;
  const b = g.world.buildings.find((x) => x.def.key === (g.you === 'dadou' ? 'chat_noir' : 'entrepot_morgan'));
  const o = sm.origin();
  const r = sm.canvas.getBoundingClientRect();
  return { x: r.left + o.ox + b.center.x * o.k, y: r.top + o.oy + b.center.z * o.k, name: b.def.name };
});
console.log('cible :', JSON.stringify(target));
await A.mouse.click(target.x, target.y);
await sleep(500);
await shot(A, '09-strategic-target-A.png');
await A.click('.sm-card .btn.danger');
await sleep(500);
await shot(A, '10-strategic-form-A.png');
await A.click('.sm-form .btn.danger');
await sleep(1500);
await shot(A, '11-strategic-sent-A.png');
console.log('retour :', await A.evaluate(() => document.querySelector('.sm-feedback')?.textContent ?? '(aucun)'));
await A.keyboard.press('Escape');
await sleep(500);

step('Suivi de la mission (20 s)');
for (let i = 0; i < 4; i++) {
  await sleep(5000);
  console.log('A', JSON.stringify(await state(A)));
}
await shot(A, '12-mission-A.png');

step('Onglets du bureau');
for (const tab of ['recruit', 'lieutenants', 'upgrades', 'armory']) {
  await A.evaluate((t) => window.__app.game.strategic.show(t), tab);
  await sleep(500);
  await shot(A, `13-tab-${tab}.png`);
}
// recrutement de 5 hommes
const men0 = await A.evaluate(() => window.__app.game.priv.men);
await A.evaluate(() => window.__app.game.strategic.show('recruit'));
await sleep(300);
await A.click('.sm-recruit .btn >> nth=1');
await sleep(1500);
const men1 = await A.evaluate(() => window.__app.game.priv.men);
console.log('hommes :', men0, '→', men1);
await A.keyboard.press('Escape');
await sleep(400);

step('Pause');
await A.keyboard.press('Escape');
await sleep(800);
await shot(A, '14-pause-A.png');
await A.click('.mw-pause-resume');
await sleep(500);

if (B) {
  step('Vue d’Even');
  await shot(B, '15-game-B.png');
  console.log('B', JSON.stringify(await state(B)));
}

console.log('\nErreurs :', errors.length ? errors.join('\n') : 'aucune');
await browser.close();
bot?.kill('SIGTERM');
