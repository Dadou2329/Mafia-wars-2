// Capture d'écran de la visionneuse : node tests/shot.mjs out.png "px,py,pz,tx,ty,tz" time [w h]
import { chromium } from 'playwright';
const [out, camStr, timeStr, w = '1280', h = '720'] = process.argv.slice(2);
const url = process.env.URL ?? 'http://localhost:5173/?viewer&still';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => { const t = m.text(); if (!t.includes('Download the React')) console.log('[page]', t.slice(0, 400)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__viewer !== undefined, null, { timeout: 180000 });
const cams = camStr.split(';');
let i = 0;
for (const c of cams) {
  const v = c.split(',').map(Number);
  const r = await page.evaluate(([v, t]) => { window.__viewer.setTime(t); window.__viewer.look(...v); return window.__viewer.render(); }, [v, Number(timeStr ?? 0.85)]);
  const file = cams.length > 1 ? out.replace('.png', `-${i}.png`) : out;
  await page.screenshot({ path: file });
  console.log('saved', file, JSON.stringify(r));
  i++;
}
await browser.close();
