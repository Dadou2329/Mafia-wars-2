// Capture générique : node tests/snap.mjs "<url>" out.png "<code JS exécuté avant la capture>" [w h]
import { chromium } from 'playwright';
const [url, out, code = '', w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => { const t = m.text(); if (!t.startsWith('[vite]')) console.log('[page]', t.slice(0, 500)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__viewer !== undefined, null, { timeout: 180000 });
const shots = code.split('||');
for (let i = 0; i < shots.length; i++) {
  const r = await page.evaluate((c) => { const v = window.__viewer; return eval(c); }, shots[i]);
  const file = shots.length > 1 ? out.replace('.png', `-${i}.png`) : out;
  await page.screenshot({ path: file });
  console.log('saved', file, JSON.stringify(r ?? null).slice(0, 300));
}
await browser.close();
