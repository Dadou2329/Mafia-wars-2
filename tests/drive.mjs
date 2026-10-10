// Essai de conduite et du téléphone dans le vrai client : un navigateur (Dadou) + le robot (Even).
// Prérequis : serveur (MW_DEBUG=1, port 3000) et Vite (port 5173). Usage : node tests/drive.mjs [préfixe des captures]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const OUT = process.argv[2] ?? 'test-output/drive';
const URL = process.env.URL ?? 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('mafiawars2.settings.v1', JSON.stringify({ quality: 'basse', renderScale: 0.6, bloom: false }));
  } catch {
    /* stockage indisponible */
  }
});
const A = await ctx.newPage();
A.on('pageerror', (e) => console.log('[pageerror]', e.message));
A.on('console', (m) => {
  if (m.type() === 'error') console.log('[erreur]', m.text().slice(0, 300));
});
await A.goto(URL, { timeout: 180000, waitUntil: 'domcontentloaded' });
await A.waitForSelector('text=Créer une partie', { timeout: 120000 });
await A.click('text=Créer une partie');
await A.waitForFunction(() => window.__app?.net?.room?.code, null, { timeout: 30000 });
const code = await A.evaluate(() => window.__app.net.room.code);
const bot = spawn(process.execPath, ['tests/bot.mjs', code, 'even', new globalThis.URL(URL).origin.replace('5173', '3000')], { stdio: 'ignore' });
await A.waitForFunction(() => Object.keys(window.__app.net.room?.players ?? {}).length === 2, null, { timeout: 60000 });
await A.evaluate(() => window.__app.net.pick('dadou'));
await sleep(800);
await A.evaluate(() => window.__app.net.setReady(true));
await A.waitForFunction(() => window.__app?.game && window.__app.game.placed === true, null, { timeout: 300000 });
console.log('partie lancée');
await sleep(3000);
const moto = await A.evaluate(() => {
  const g = window.__app.game;
  for (const e of g.store.ents.values()) if (e.info.kind === 10 && e.info.faction === 1) return { id: e.info.id, x: e.x, y: e.y, z: e.z, yaw: e.view.yaw };
  return null;
});
console.log('moto :', JSON.stringify(moto));
if (moto) {
  await A.evaluate((m) => window.__app.net.act({ a: 'debugTp', x: m.x + 1.6, z: m.z, yaw: Math.PI / 2, dayTime: 0.92 }), moto);
  await sleep(2500);
  await A.screenshot({ path: `${OUT}-1-moto.png` });
  await A.mouse.click(640, 360);
  await A.keyboard.press('KeyE');
  await sleep(2500);
  console.log('au volant :', await A.evaluate(() => !!window.__app.game.player.drive));
  await A.keyboard.down('KeyW');
  await sleep(3500);
  await A.screenshot({ path: `${OUT}-2-drive.png` });
  await A.keyboard.up('KeyW');
  const st = await A.evaluate(() => {
    const d = window.__app.game.player.drive;
    return d ? { x: d.pos.x, z: d.pos.z, speed: d.speed } : null;
  });
  console.log('après accélération :', JSON.stringify(st));
  await sleep(2500);
  await A.keyboard.press('KeyE');
  await sleep(1500);
  console.log('à pied :', await A.evaluate(() => !window.__app.game.player.drive));
}
await A.keyboard.press('Tab');
await sleep(1200);
await A.screenshot({ path: `${OUT}-3-phone.png` });
await A.evaluate(() => document.querySelectorAll('.phone-app')[1]?.click());
await sleep(800);
await A.screenshot({ path: `${OUT}-4-garage.png` });
await browser.close();
bot.kill('SIGTERM');
