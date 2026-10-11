// Lien Internet de l'exécutable (tunnel Cloudflare) : un faux « cloudflared » écrit ce qu'écrit le
// vrai (adresse publique, connexion établie). On vérifie que le serveur l'annonce, que le salon
// de l'hôte l'affiche et le met dans le lien d'invitation, et que la fenêtre « Rejoindre » d'un
// autre joueur accepte ce lien https collé.
// Usage : node tests/tunnel.mjs   (prérequis : npm run build)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let failures = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${info ? ` — ${info}` : ''}`);
  if (!ok) failures++;
};
const URL_PUB = 'https://essai-mafia-tunnel.trycloudflare.com';
const fake = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mw-cf-')), 'cloudflared');
fs.writeFileSync(
  fake,
  `#!/bin/sh\necho "INF Requesting new quick Tunnel on trycloudflare.com..." >&2\nsleep 2\necho "INF |  ${URL_PUB}  |" >&2\nsleep 1\necho "INF Registered tunnel connection connIndex=0" >&2\nexec sleep 3600\n`,
);
fs.chmodSync(fake, 0o755);

const server = spawn(process.execPath, ['dist/server/main.js'], { env: { ...process.env, PORT: '3103', MW_TUNNEL: '1', CLOUDFLARED: fake }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
server.stdout.on('data', (d) => (out += d));
process.on('exit', () => server.kill());
const until = async (fn, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
await until(() => out.includes('serveur prêt'), 120000);
const api = async () => (await fetch('http://localhost:3103/api/hote')).json();
check('le tunnel démarre', (await api()).tunnel?.state === 'starting' || (await api()).tunnel?.state === 'ready');
await until(async () => (await api()).tunnel?.state === 'ready', 30000);
const info = await api();
check('le serveur annonce le lien Internet', info.tunnel?.state === 'ready' && info.tunnel.url === URL_PUB, JSON.stringify(info.tunnel));
check('la console de l’hôte affiche le lien', out.includes(`Lien Internet prêt : ${URL_PUB}`));

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'],
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/proxy/i.test(k))),
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['clipboard-read', 'clipboard-write'] });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('mafiawars2.settings.v1', JSON.stringify({ quality: 'basse', renderScale: 0.5 }));
  } catch {
    /* rien */
  }
});
const H = await ctx.newPage();
await H.goto('http://localhost:3103/', { timeout: 180000 });
await H.waitForSelector('text=Créer une partie', { timeout: 180000 });
await H.click('text=Créer une partie');
await H.waitForFunction(() => window.__app?.net?.room?.code, null, { timeout: 120000, polling: 250 });
const code = await H.evaluate(() => window.__app.net.room.code);
await H.waitForSelector('.mw-net-status.is-ok', { timeout: 60000 }).catch(() => {});
check('le salon de l’hôte annonce le lien Internet', /Lien Internet prêt/.test((await H.textContent('.mw-net-status')) ?? ''), await H.textContent('.mw-host'));
await H.click('text=Copier le lien d’invitation');
await H.waitForTimeout(500);
const copied = await H.evaluate(() => navigator.clipboard.readText()).catch(() => '');
check('le lien d’invitation copié est le lien Internet', copied === `${URL_PUB}/?code=${code}`, copied);

// un autre joueur colle ce lien dans « Rejoindre une partie » de son propre jeu
const G = await ctx.newPage();
await G.goto('http://localhost:3103/', { timeout: 180000 });
await G.waitForSelector('text=Rejoindre une partie', { timeout: 180000 });
await G.click('text=Rejoindre une partie');
await G.focus('.mw-addr-input');
await G.evaluate((text) => {
  const dt = new DataTransfer();
  dt.setData('text', text);
  document.querySelector('.mw-addr-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, `${URL_PUB}/?code=${code}`);
const filled = await G.evaluate(() => [document.querySelector('.mw-code-input').value, document.querySelector('.mw-addr-input').value]);
check('lien Internet collé : code et lien remplis (https, sans port)', filled[0] === code && filled[1] === URL_PUB, filled.join(' / '));

await browser.close();
console.log(failures ? `\n${failures} échec(s)` : '\nLien Internet : tout est bon.');
process.exit(failures ? 1 : 0);
