// Visite photographique de New York 2085 dans le vrai client (rendu logiciel) : le parrain est
// téléporté à plusieurs endroits, à plusieurs heures et sous la pluie, et on prend des captures.
// Prérequis : serveur lancé avec MW_DEBUG=1 qui sert le client compilé.
// Usage : URL=http://localhost:3000/ node tests/tour.mjs [préfixe] [qualité]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const OUT = process.argv[2] ?? 'test-output/tour';
const QUALITY = process.argv[3] ?? 'moyenne';
const URL = process.env.URL ?? 'http://localhost:3000/';
const SERVER = process.env.SERVER ?? new globalThis.URL(URL).origin;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// x, z, (y), yaw (vers où regarder), pitch, heure (0..1), pluie, vue (fp : 1re personne), tirs (fire)
const SHOTS = (process.env.SHOTS ? JSON.parse(process.env.SHOTS) : null) ?? [
  { name: 'one-times-square', x: 98, z: 110, yaw: 0.25, pitch: 0.38, t: 0.95, rain: 0 },
  { name: 'times-square-pluie', x: 92, z: 139, yaw: Math.PI, pitch: 0.3, t: 0.93, rain: 1 },
  { name: 'east-river-queens', x: 192, z: 120, yaw: Math.PI / 2, pitch: 0.08, t: 0.9, rain: 0 },
  { name: 'chinatown-dragon', x: 55, z: 200, yaw: -2.37, pitch: 0.35, t: 0.93, rain: 0.3 },
  { name: 'statue-liberte', x: 60, z: 236, yaw: -0.71, pitch: 0.1, t: 0.88, rain: 0 },
  { name: 'wall-street-jour', x: 130, z: 205, yaw: Math.PI, pitch: 0.15, t: 0.45, rain: 0 },
  { name: 'brooklyn-crepuscule', x: 245, z: 196, yaw: Math.PI, pitch: 0.05, t: 0.76, rain: 0 },
];

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript((q) => {
  try {
    localStorage.setItem('mafiawars2.settings.v1', JSON.stringify({ quality: q, renderScale: 0.75, bloom: true, tips: false }));
  } catch {
    /* stockage indisponible */
  }
}, QUALITY);
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
const bot = spawn(process.execPath, ['tests/bot.mjs', code, 'even', SERVER], { stdio: 'ignore' });
await A.waitForFunction(() => Object.keys(window.__app.net.room?.players ?? {}).length === 2, null, { timeout: 60000 });
await A.evaluate(() => window.__app.net.pick('dadou'));
await sleep(800);
await A.evaluate(() => window.__app.net.setReady(true));
await A.waitForFunction(() => window.__app?.game && window.__app.game.placed === true, null, { timeout: 300000 });
console.log('partie lancée');
for (const s of SHOTS) {
  await A.evaluate((s) => window.__app.net.act({ a: 'debugTp', x: s.x, z: s.z, y: s.y, yaw: s.yaw, dayTime: s.t, rain: s.rain }), s);
  await sleep(1500);
  await A.evaluate((s) => {
    const p = window.__app.game.player;
    p.yaw = s.yaw;
    p.pitch = s.pitch ?? 0;
    p.firstPerson = s.fp !== false;
  }, s);
  // laisser l'heure, la pluie et la chaussée mouillée s'installer
  await sleep(s.wait ?? 9000);
  await A.evaluate((s) => {
    const p = window.__app.game.player;
    p.yaw = s.yaw;
    p.pitch = s.pitch ?? 0;
  }, s);
  await sleep(1500);
  // tirs (verre destructible…)
  for (let i = 0; i < (s.fire ?? 0); i++) {
    await A.mouse.click(640, 360);
    await sleep(900);
  }
  if (s.fire) await sleep(3000);
  // grenade : on la lance et on photographie l'explosion
  if (s.grenade) {
    await A.keyboard.press('KeyG');
    await sleep(s.grenadeWait ?? 1800);
    await A.screenshot({ path: `${OUT}-${s.name}-boom.png`, timeout: 120000 });
  }
  // on vise de nouveau (le recul des tirs relève l'arme) ; la pluie s'installe sans attendre
  // (à une image par seconde, le fondu de la pluie prendrait trop longtemps)
  await A.evaluate((s) => {
    const gc = window.__app.game;
    gc.player.yaw = s.yaw;
    gc.player.pitch = s.pitch ?? 0;
    if (typeof s.rain === 'number' && gc.rain) gc.rain.intensity = s.rain;
  }, s);
  await sleep(2500);
  await A.screenshot({ path: `${OUT}-${s.name}.png`, timeout: 120000 });
  console.log('capture', s.name);
}
await browser.close();
bot.kill('SIGTERM');
