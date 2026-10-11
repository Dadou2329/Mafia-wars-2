// Deux joueurs, deux exécutables : chacun a son propre serveur. L'invité doit pouvoir rejoindre
// le salon de l'hôte depuis la fenêtre « Rejoindre une partie » de SON jeu, avec le code et
// l'adresse affichée dans le salon de l'hôte (ou en collant le lien d'invitation).
// Usage : node tests/join-lan.mjs
// Prérequis : client et serveur compilés (npm run build) ; le test lance deux serveurs
// (ports 3101 et 3102) et utilise l'adresse réseau de cette machine.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${info ? ` — ${info}` : ''}`);
  if (!ok) failures++;
};
const lan = Object.values(networkInterfaces())
  .flat()
  .find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
if (!lan) {
  console.log('aucune adresse réseau : test impossible');
  process.exit(1);
}

const servers = [];
const startServer = (port) =>
  new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['dist/server/main.js'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
    servers.push(p);
    p.stdout.on('data', (d) => {
      if (String(d).includes('serveur prêt')) resolve();
    });
    p.on('exit', (c) => reject(new Error(`serveur ${port} arrêté (${c})`)));
  });
process.on('exit', () => servers.forEach((s) => s.kill()));
await Promise.all([startServer(3101), startServer(3102)]);
console.log('deux serveurs prêts (hôte 3101, invité 3102), réseau', lan);

// connexion directe à l'adresse réseau (comme deux PC sur la même box) : sans les variables de
// mandataire (proxy) éventuelles de la machine de test, qui couperaient le WebSocket
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-proxy-server'],
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/proxy/i.test(k))),
});
const dialogs = [];
const page = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    try {
      const k = 'mafiawars2.settings.v1';
      localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) || '{}'), quality: 'basse', renderScale: 0.5 }));
    } catch {
      /* rien */
    }
  });
  const p = await ctx.newPage();
  p.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  return p;
};

// hôte : ouvre SON jeu sur localhost (pire cas : l'adresse doit quand même être celle du réseau)
const H = await page();
await H.goto('http://localhost:3101/', { timeout: 180000 });
await H.waitForSelector('text=Créer une partie', { timeout: 180000 });
await H.click('text=Créer une partie');
await H.waitForFunction(() => window.__app?.net?.room?.code, null, { timeout: 120000, polling: 250 });
const code = await H.evaluate(() => window.__app.net.room.code);
await H.waitForSelector('.mw-host-value', { timeout: 60000 });
const shown = await H.textContent('.mw-host-value');
check('le salon de l’hôte affiche son adresse réseau', shown === `${lan}:3101`, shown);

// invité : SON jeu (autre serveur), code seul → message clair
const G = await page();
await G.goto('http://localhost:3102/', { timeout: 180000 });
await G.waitForSelector('text=Rejoindre une partie', { timeout: 180000 });
await G.click('text=Rejoindre une partie');
await G.fill('.mw-code-input', code);
await G.fill('.mw-addr-input', '');
await G.click('.mw-modal-actions >> text=Rejoindre');
await G.waitForFunction(() => /n’existe que sur l’ordinateur/.test(document.querySelector('.mw-join-error')?.textContent ?? ''), null, { timeout: 60000 }).catch(() => {});
const msg = await G.textContent('.mw-join-error');
check('code seul sur son propre jeu : explication affichée', /n’existe que sur l’ordinateur/.test(msg ?? ''), msg?.slice(0, 90));

// mauvaise adresse : l'ordinateur ne répond pas
await G.fill('.mw-addr-input', `${lan}:3999`);
await G.click('.mw-modal-actions >> text=Rejoindre');
await G.waitForFunction(() => /ne répond pas/.test(document.querySelector('.mw-join-error')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
check('adresse injoignable : message clair', /ne répond pas/.test((await G.textContent('.mw-join-error')) ?? ''));

// mauvais code chez le bon hôte
await G.fill('.mw-addr-input', shown);
await G.fill('.mw-code-input', code === 'ZZZZ' ? 'YYYY' : 'ZZZZ');
await G.click('.mw-modal-actions >> text=Rejoindre');
await G.waitForFunction(() => /Aucune partie/.test(document.querySelector('.mw-join-error')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
check('mauvais code : « aucune partie » chez l’ami', /Aucune partie/.test((await G.textContent('.mw-join-error')) ?? ''));

// lien d'invitation collé : code et adresse se remplissent, puis on rejoint
const link = `http://${shown}/?code=${code}`;
await G.fill('.mw-code-input', '');
await G.fill('.mw-addr-input', '');
await G.focus('.mw-addr-input');
await G.evaluate((text) => {
  const el = document.querySelector('.mw-addr-input');
  const dt = new DataTransfer();
  dt.setData('text', text);
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, link);
const filled = await G.evaluate(() => [document.querySelector('.mw-code-input').value, document.querySelector('.mw-addr-input').value]);
check('lien collé : code et adresse remplis', filled[0] === code && filled[1] === shown, filled.join(' / '));
await G.click('.mw-modal-actions >> text=Rejoindre');
await G.waitForURL(new RegExp(`${shown.replace(/\./g, '\\.')}`), { timeout: 60000 }).catch(() => {});
await G.waitForFunction(() => window.__app?.net?.room?.code, null, { timeout: 180000, polling: 250 }).catch(() => {});
check('l’invité est passé sur l’ordinateur de l’hôte', G.url().startsWith(`http://${shown}/`), G.url());
await H.waitForFunction(() => Object.keys(window.__app.net.room?.players ?? {}).length === 2, null, { timeout: 120000, polling: 250 }).catch(() => {});
const n = await H.evaluate(() => Object.keys(window.__app.net.room?.players ?? {}).length);
check('les deux joueurs sont dans le même salon', n === 2, `${n} joueur(s)`);

check('aucune fenêtre d’erreur pendant la connexion', dialogs.length === 0, dialogs.join(' | '));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : '\nRejoindre une partie sur un autre ordinateur : tout est bon.');
process.exit(failures ? 1 : 0);
