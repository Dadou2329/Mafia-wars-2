// Écran CYBERNÉTIQUE en vraie partie (un navigateur + le robot) : on se téléporte au fauteuil
// d'une clinique, puis on achète, améliore, installe, déplace, retire un implant et on enregistre /
// applique une configuration EN CLIQUANT sur l'écran ; chaque étape vérifie l'état privé envoyé
// par le serveur (priv.cyber). Puis : hors station (boutons refusés), HUD des capacités, téléphone
// (appli Implants, itinéraire, ouverture de l'écran).
// Usage : node tests/cyber-ui.mjs [dossier des captures]
// Prérequis : serveur de jeu lancé avec MW_DEBUG=1 et Vite (URL, par défaut http://localhost:5173/),
// par exemple : PORT=3015 MW_DEBUG=1 npx tsx src/server/main.ts
//               PORT=3015 VITE_PORT=5205 NO_HMR=1 npx vite --strictPort
//               URL=http://localhost:5205/ LOWGFX=1 node tests/cyber-ui.mjs test-output/cyber
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const OUT = process.argv[2] ?? 'test-output/cyber';
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.URL ?? 'http://localhost:5173/';
const W = Number(process.env.W ?? 1280);
const H = Number(process.env.H ?? 720);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// rendu logiciel : la page peut ne dessiner qu'une image par seconde, on attend par intervalles
const WAIT = { timeout: 90000, polling: 300 };
let failures = 0;
let bot = null;
// le robot ne doit jamais survivre au test (il garderait la sortie ouverte)
process.on('exit', () => bot?.kill('SIGTERM'));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(1));
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
if (process.env.LOWGFX)
  await ctx.addInitScript(() => {
    try {
      const k = 'mafiawars2.settings.v1';
      const cur = JSON.parse(localStorage.getItem(k) || '{}');
      localStorage.setItem(k, JSON.stringify({ ...cur, quality: 'basse', renderScale: 0.35, bloom: false }));
    } catch {
      /* stockage indisponible */
    }
  });
const A = await ctx.newPage();
const errors = [];
A.on('console', (m) => {
  if (m.type() !== 'error') return;
  errors.push(m.text().slice(0, 300));
  console.log('   [erreur de la page]', m.text().slice(0, 300));
});
// processus de rendu tué (mémoire) : les évaluations en cours ne reviendraient jamais
A.on('crash', () => {
  console.log('ÉCHEC  la page a planté (processus de rendu tué, mémoire insuffisante ?)');
  process.exit(2);
});
A.on('pageerror', (e) => {
  errors.push(`pageerror: ${e.message}`);
  console.log('   [exception de la page]', e.message, (e.stack ?? '').split('\n').slice(1, 4).join(' | '));
});
const shot = async (file) => {
  await A.screenshot({ path: `${OUT}/${file}`, timeout: 180000 });
  console.log('   capture', `${OUT}/${file}`);
};
const cyber = () => A.evaluate(() => JSON.parse(JSON.stringify(window.__app.game.priv.cyber)));
/** Attend que l'état privé du serveur vérifie la condition (fonction sur priv.cyber, en texte). */
const waitCyber = async (name, cond, timeout = 60000) => {
  const ok = await A.waitForFunction(new Function(`const c = window.__app.game.priv.cyber; return (${cond})(c);`), null, { timeout, polling: 300 })
    .then(() => true)
    .catch(() => false);
  if (!ok) await shot(`echec-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.png`).catch(() => {});
  check(name, ok, ok ? '' : `${JSON.stringify(await cyber().catch(() => null))} ${await diag()}`);
  return ok;
};
// clic réel à la souris ; « force » saute les contrôles de stabilité de Playwright, très lents
// quand la page ne dessine qu'une image par seconde (le clic passe toujours par le DOM réel)
const click = async (sel, opts = {}) => {
  const loc = A.locator(sel).first();
  await loc.waitFor({ state: 'visible', timeout: 90000 });
  await loc.click({ timeout: 90000, force: true, ...opts });
  await sleep(400);
};
/** Touche puis attente de l'état de l'écran (ouvert ou fermé). */
const pressFor = async (key, open, name) => {
  await A.keyboard.press(key);
  const ok = await A.waitForFunction((o) => !!document.querySelector('.cy-root') && document.querySelector('.cy-root').classList.contains('hidden') !== o, open, WAIT)
    .then(() => true)
    .catch(() => false);
  if (!ok) await shot(`echec-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.png`).catch(() => {});
  check(name, ok, ok ? '' : await diag());
  return ok;
};
const action = (txt) => `.cy-actions .btn:has-text("${txt}")`;
// lectures du DOM : la page peut geler plusieurs dizaines de secondes après une téléportation
const textOf = (sel) => A.locator(sel).first().textContent({ timeout: 150000 }).catch(() => '');
const attrOf = (sel, name) => A.locator(sel).first().getAttribute(name, { timeout: 150000 }).catch(() => null);
const isOpen = () => A.evaluate(() => !!document.querySelector('.cy-root') && !document.querySelector('.cy-root').classList.contains('hidden'));
/** État de la partie qui décide où vont les touches (en cas d'échec). */
const diag = () =>
  A.evaluate(() => {
    const g = window.__app.game;
    if (!g) return 'plus de partie (retour au menu ?)';
    const blockers = g.modules.filter((m) => m.blocking?.()).map((m) => m.constructor.name);
    return JSON.stringify({ modal: !!g.modal, chatting: g.chatting, over: !!g.over, strategic: g.strategic.open, phone: g.phone.open, wheel: g.wheel.open, blocked: window.__app.input.blocked, blockers, cyRoots: document.querySelectorAll('.cy-root').length });
  }).catch((e) => `diagnostic impossible : ${e.message}`);

// ------------------------------------------------------------------ partie (robot pour le rival)
await A.goto(URL, { timeout: 180000, waitUntil: 'domcontentloaded' });
await A.waitForSelector('text=Créer une partie', { timeout: 60000 });
await A.click('text=Créer une partie');
await A.waitForFunction(() => window.__app?.net?.room?.code, null, { timeout: 30000 });
const code = await A.evaluate(() => window.__app.net.room.code);
bot = spawn(process.execPath, ['tests/bot.mjs', code, 'even', new globalThis.URL(URL).origin], { stdio: 'inherit' });
await A.waitForFunction(() => Object.keys(window.__app.net.room?.players ?? {}).length === 2, null, { timeout: 60000 });
await A.evaluate(() => window.__app.net.pick('dadou'));
await sleep(800);
await A.evaluate(() => window.__app.net.setReady(true));
await A.waitForFunction(() => window.__app?.game && window.__app.game.placed === true, null, { timeout: 300000 });
console.log('partie lancée');
await sleep(3000);
check('écran CYBERNÉTIQUE monté (module)', await A.evaluate(() => !!document.querySelector('.cy-root')));

// ------------------------------------------------------------------ fauteuil d'une clinique
/** Argent de test : une action envoyée pendant une coupure peut se perdre, on vérifie. */
const ensureMoney = async () => {
  for (let i = 0; i < 4; i++) {
    if ((await A.evaluate(() => window.__app.game?.priv.money ?? 0)) >= 30000) return true;
    await A.waitForFunction(() => window.__app.net.connected, null, WAIT).catch(() => {});
    await A.evaluate(() => window.__app.net.act({ a: 'debugMoney', n: 60000 }));
    const ok = await A.waitForFunction(() => (window.__app.game?.priv.money ?? 0) >= 30000, null, { timeout: 30000, polling: 300 })
      .then(() => true)
      .catch(() => false);
    if (ok) return true;
  }
  return false;
};
check('argent de test reçu (debugMoney)', await ensureMoney());
const clinic = await A.evaluate(() => {
  const g = window.__app.game;
  const rival = g.you === 'dadou' ? 2 : 1;
  // une clinique sans défenseurs (sinon les gardes abattent le parrain, immobile dans le menu)
  const list = g.world.buildings.filter((x) => x.clinic && g.pub.buildings[x.id]?.owner !== rival);
  list.sort((a, b) => (g.pub.buildings[a.id]?.guards ?? 99) - (g.pub.buildings[b.id]?.guards ?? 99));
  const b = list[0];
  if (!b) return null;
  const c = b.clinic;
  // devant le fauteuil (côté patient), à portée de la station
  return { bid: b.id, name: c.name, guards: g.pub.buildings[b.id]?.guards ?? -1, x: c.x + Math.sin(c.yaw) * 2.1, y: c.y, z: c.z + Math.cos(c.yaw) * 2.1, yaw: c.yaw + Math.PI };
});
check('une clinique accessible existe dans la ville', !!clinic, JSON.stringify(clinic));
/**
 * En station à la clinique, connecté, écran ouvert : sous forte charge (rendu logiciel), la page
 * peut perdre la connexion ; la reconnexion remet le parrain au QG et referme l'écran.
 */
const inStation = '(c) => typeof c.station === "string" && c.station.startsWith("clinique:")';
let reconnects = 0;
const ready = async (open = true) => {
  for (let i = 0; i < 4; i++) {
    await A.waitForFunction(() => window.__app.net.connected && window.__app.game?.placed, null, WAIT).catch(() => {});
    const here = await A.evaluate(new Function(`const c = window.__app.game.priv.cyber; return (${inStation})(c);`));
    if (here) break;
    if (i > 0) reconnects++;
    if (clinic) await A.evaluate((c) => window.__app.net.act({ a: 'debugTp', x: c.x, z: c.z, y: c.y, yaw: c.yaw }), clinic);
    const ok = await A.waitForFunction(new Function(`const c = window.__app.game.priv.cyber; return (${inStation})(c);`), null, { timeout: 45000, polling: 300 })
      .then(() => true)
      .catch(() => false);
    if (ok) break;
  }
  if (open && !(await isOpen())) {
    await A.keyboard.press('KeyI');
    await A.waitForFunction(() => !document.querySelector('.cy-root')?.classList.contains('hidden'), null, WAIT).catch(() => {});
    await sleep(600);
  }
};
await ready(false);
await waitCyber('en station à la clinique (priv.cyber.station)', inStation, 30000);
const money0 = await A.evaluate(() => window.__app.game.priv.money);

// ------------------------------------------------------------------ ouverture (touche I)
await pressFor('KeyI', true, 'touche I : écran ouvert');
check('pas de menu de pause par-dessus', await A.evaluate(() => !document.querySelector('.modal-layer')));
await sleep(800);
check('bandeau « Station : … — installation possible »', /installation possible/.test((await textOf('.cy-station')) ?? ''));
await shot('cyber-01-ouvert.png');

// achat du grappin : il se pose tout seul au bras gauche
await ready();
await click('.cy-slot[data-slot="brasG"]');
await click('.cy-item[data-id="grappin"]');
await click(action('Acheter'));
await waitCyber('achat : grappin niveau 1, posé au bras gauche', '(c) => c.owned.grappin === 1 && c.equip.brasG === "grappin"');
const money1 = await A.evaluate(() => window.__app.game.priv.money);
// (les revenus continuent de tomber pendant ce temps : quelques dollars de tolérance)
check('le prix a été débité (650 $)', Math.abs(money0 - money1 - 650) < 40, `${money0} → ${money1}`);
await sleep(600);
await shot('cyber-02-achat.png');

// amélioration
await ready();
await click('.cy-item[data-id="grappin"]');
await click(action('Améliorer'));
await waitCyber('amélioration : grappin niveau 2', '(c) => c.owned.grappin === 2');
await sleep(600);
await shot('cyber-03-amelioration.png');

// la lame : achat (posée au bras droit, libre), puis déplacée au bras gauche à la place du grappin
await ready();
await click('.cy-slot[data-slot="brasG"]');
await click('.cy-item[data-id="lame"]');
await click(action('Acheter'));
await waitCyber('achat : lame posée au bras droit', '(c) => c.owned.lame === 1 && c.equip.brasD === "lame"');
await ready();
await click('.cy-slot[data-slot="brasG"]');
await click('.cy-item[data-id="lame"]');
check('remplacement annoncé (« Remplace : Grappin… »)', /Remplace : Grappin/.test((await textOf('.cy-actions')) ?? ''));
await shot('cyber-04-remplacement.png');
await click(action('Déplacer'));
await waitCyber('déplacement : lame au bras gauche, bras droit libre, grappin en réserve', '(c) => c.equip.brasG === "lame" && !c.equip.brasD && c.owned.grappin === 2');

// retrait
await ready();
await click('.cy-slot[data-slot="brasG"]');
await click(action('Retirer'));
await waitCyber('retrait : bras gauche libre', '(c) => !c.equip.brasG');
await sleep(500);
await shot('cyber-05-retrait.png');

// configurations : grappin au bras gauche → « Combat » enregistrée → retrait → appliquée
await ready();
await click('.cy-slot[data-slot="brasG"]');
await click('.cy-item[data-id="grappin"]');
await click(action('Installer'));
await waitCyber('installation : grappin au bras gauche', '(c) => c.equip.brasG === "grappin"');
await ready();
await click('.cy-lo >> nth=0 >> .btn:has-text("Enregistrer")');
await waitCyber('configuration « Combat » enregistrée', '(c) => !!c.loadouts[0] && c.loadouts[0].brasG === "grappin"');
await ready();
await click('.cy-slot[data-slot="brasG"]');
await click(action('Retirer'));
await waitCyber('retrait avant d’appliquer', '(c) => !c.equip.brasG');
await ready();
await click('.cy-lo >> nth=0 >> .btn:has-text("Appliquer")');
await waitCyber('configuration « Combat » appliquée', '(c) => c.equip.brasG === "grappin"');
await sleep(600);
await shot('cyber-06-configuration.png');

// fermeture (Échap) : pas de pause, HUD des capacités visible
await ready();
await pressFor('Escape', false, 'Échap : écran fermé');
await sleep(800);
check('Échap : pas de menu de pause', await A.evaluate(() => !document.querySelector('.modal-layer')));
await A.waitForFunction(() => !document.querySelector('.ab-bar')?.classList.contains('hidden'), null, WAIT).catch(() => {});
const chips = await A.evaluate(() => document.querySelectorAll('.ab-bar:not(.hidden) .ab-chip').length);
check('HUD des capacités : pastilles affichées', chips >= 1, `${chips} pastille(s)`);
await shot('cyber-07-hud.png');

// ------------------------------------------------------------------ hors station
if (clinic) await A.evaluate((c) => window.__app.net.act({ a: 'debugTp', x: c.x + 30 * Math.sin(c.yaw), z: c.z + 30 * Math.cos(c.yaw), yaw: c.yaw }), clinic);
await waitCyber('hors station (priv.cyber.station = null)', '(c) => c.station === null');
await sleep(4000);
await pressFor('KeyI', true, 'hors station : écran rouvert (touche I)');
await sleep(800);
check('hors station : bandeau « consultation seulement »', /consultation seulement/.test((await textOf('.cy-station')) ?? ''));
await click('.cy-item[data-id="poing"]');
const offBuy = await attrOf(action('Acheter'), 'aria-disabled');
check('hors station : « Acheter » refusé', offBuy === 'true');
await A.locator(action('Acheter')).first().click({ force: true });
await sleep(400);
check('hors station : la raison s’affiche', /Hors station/.test((await textOf('.cy-feedback')) ?? ''));
await waitCyber('hors station : aucun achat', '(c) => !c.owned.poing', 3000);
await shot('cyber-08-hors-station.png');
await pressFor('KeyI', false, 'touche I : écran refermé');

// ------------------------------------------------------------------ téléphone : appli Implants
await A.keyboard.press('Tab');
const phoneOpen = await A.waitForFunction(() => !document.querySelector('.phone')?.classList.contains('hidden'), null, WAIT)
  .then(() => true)
  .catch(() => false);
check('téléphone ouvert (Tab)', phoneOpen, phoneOpen ? '' : await diag());
await sleep(1000);
await A.evaluate(() => [...document.querySelectorAll('.phone-app')].find((b) => /Implants/.test(b.textContent ?? ''))?.click());
await A.waitForFunction(() => /emplacements occupés/.test(document.querySelector('.phone-body')?.textContent ?? ''), null, WAIT).catch(() => {});
check('téléphone : appli Implants', /emplacements occupés/.test((await textOf('.phone-body')) ?? ''));
await A.evaluate(() => [...document.querySelectorAll('.phone-body .phone-btn')].find((b) => /^Itinéraire/.test(b.textContent ?? ''))?.click());
await A.waitForFunction(() => /Effacer l’itinéraire/.test(document.querySelector('.phone-body')?.textContent ?? ''), null, WAIT).catch(() => {});
check('téléphone : itinéraire vers la clinique', /Effacer l’itinéraire/.test((await textOf('.phone-body')) ?? ''));
await shot('cyber-09-telephone.png');
await A.evaluate(() => [...document.querySelectorAll('.phone-body .phone-btn')].find((b) => /écran CYBERNÉTIQUE/.test(b.textContent ?? ''))?.click());
await A.waitForFunction(() => !document.querySelector('.cy-root')?.classList.contains('hidden'), null, WAIT).catch(() => {});
check('téléphone : ouvre l’écran CYBERNÉTIQUE', await isOpen());
check('téléphone refermé', await A.evaluate(() => document.querySelector('.phone')?.classList.contains('hidden')));
await A.keyboard.press('Escape');
await sleep(500);

console.log('\npriv.cyber final :', JSON.stringify(await cyber()));
if (reconnects) console.log(`(re-téléportations après reconnexion : ${reconnects})`);
console.log('erreurs de la page :', errors.length ? errors : 'aucune');
bot?.kill('SIGTERM');
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
