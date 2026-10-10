// Diagnostic rapide (montée sur la moto, fréquence d'images) — usage : node tests/diag.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const OUT = process.argv[2] ?? 'test-output/diag';
const URL = process.env.URL ?? 'http://localhost:3100/';
const SERVER = process.env.SERVER ?? 'http://localhost:3100';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('mafiawars2.settings.v1', JSON.stringify({ quality: 'basse', renderScale: 0.6, bloom: false }));
  } catch {}
});
const A = await ctx.newPage();
A.on('pageerror', (e) => console.log('[pageerror]', e.message));
A.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 300));
});
await A.goto(URL, { timeout: 180000, waitUntil: 'domcontentloaded' });
await A.waitForSelector('text=Créer une partie', { timeout: 120000 });
await A.click('text=Créer une partie');
await A.waitForFunction(() => window.__app?.net?.room?.code, null, { timeout: 30000 });
const code = await A.evaluate(() => window.__app.net.room.code);
const bot = spawn(process.execPath, ['tests/bot.mjs', code, 'even', SERVER], { stdio: 'ignore' });
await A.waitForFunction(() => Object.keys(window.__app.net.room?.players ?? {}).length === 2, null, { timeout: 60000 });
await A.evaluate(() => window.__app.net.pick('dadou'));
await sleep(800);
await A.evaluate(() => window.__app.net.setReady(true));
await A.waitForFunction(() => window.__app?.game && window.__app.game.placed === true, null, { timeout: 300000 });
console.log('partie lancée');
const fps = async () =>
  A.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => {
          n++;
          if (performance.now() - t0 < 2000) requestAnimationFrame(f);
          else res(Math.round((n / (performance.now() - t0)) * 10000) / 10);
        };
        requestAnimationFrame(f);
      }),
  );
console.log('fps', await fps());
const moto = await A.evaluate(() => {
  const g = window.__app.game;
  for (const e of g.store.ents.values()) if (e.info.kind === 10 && e.info.faction === 1) return { id: e.info.id, x: e.x, y: e.y, z: e.z };
  return null;
});
console.log('moto', JSON.stringify(moto));
await A.evaluate((m) => window.__app.net.act({ a: 'debugTp', x: m.x + 1.6, z: m.z, yaw: Math.PI / 2, dayTime: 0.92 }), moto);
await sleep(2500);
console.log('joueur', JSON.stringify(await A.evaluate(() => ({ p: window.__app.game.player.pos, priv: window.__app.game.priv.vehicle }))));
await A.keyboard.press('KeyE');
await sleep(2500);
console.log('après E', JSON.stringify(await A.evaluate(() => ({ drive: !!window.__app.game.player.drive, veh: window.__app.game.priv.vehicle, last: window.__app.game.hud.log.slice(0, 3).map((l) => l.text) }))));
console.log('fps', await fps());
await A.screenshot({ path: `${OUT}-1.png`, timeout: 90000 });
await A.keyboard.down('KeyW');
await sleep(3000);
await A.keyboard.up('KeyW');
console.log('après W', JSON.stringify(await A.evaluate(() => { const d = window.__app.game.player.drive; return d ? { x: d.pos.x, z: d.pos.z, speed: d.speed } : { p: window.__app.game.player.pos }; })));
console.log('fps', await fps());
await A.screenshot({ path: `${OUT}-2.png`, timeout: 90000 });
await browser.close();
bot.kill('SIGTERM');
