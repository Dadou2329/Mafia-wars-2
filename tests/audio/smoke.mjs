// Test de fumée sans écran du moteur audio procédural (src/client/audio).
//
//   node tests/audio/smoke.mjs            # toutes les vérifications
//   node tests/audio/smoke.mjs --verbose  # affiche aussi le niveau de chaque son
//
// Empaquette AudioEngine.ts en mémoire avec esbuild, le charge dans Chromium sans
// écran (lecture automatique autorisée), pilote l'API temps réel (bruitages,
// sons continus, ambiance, musique) puis rend chaque bruitage, chaque son continu,
// chaque morceau et chaque ambiance dans un OfflineAudioContext en vérifiant que
// la sortie est audible, finie et sans écrêtage.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const verbose = process.argv.includes('--verbose');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const entry = path.join(root, 'src/client/audio/AudioEngine.ts');

const out = await build({ entryPoints: [entry], bundle: true, format: 'esm', write: false, target: 'es2022', logLevel: 'silent' });
const js = out.outputFiles[0].text;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.route('http://audio.test/**', (route) => {
  if (route.request().url().endsWith('/audio.js')) return route.fulfill({ contentType: 'text/javascript', body: js });
  return route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><meta charset="utf-8"><title>audio smoke</title><script type="module">import * as A from "./audio.js"; window.__A = A; window.__loaded = true;</script>',
  });
});
await page.goto('http://audio.test/index.html');
await page.waitForFunction(() => window.__loaded === true, null, { timeout: 15000 });

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };
const ok = (msg) => console.log(`  ok   ${msg}`);

/* ------------------------------------------------------------------ API temps réel */
console.log('Realtime API');
const rt = await page.evaluate(async () => {
  const { audio, SFX_NAMES, LOOP_NAMES } = window.__A;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = {};
  // Tâches longues (> 50 ms) du fil principal : la génération différée ne doit pas saccader l'image.
  const longTasks = [];
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) longTasks.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false });
  } catch { /* non pris en charge */ }
  // Appels avant le déverrouillage : ignorés sans erreur (volumes mémorisés, boucle en attente).
  audio.play('pistol');
  audio.setVolumes({ master: 0.9, music: 0.7, sfx: 1, ambience: 0.8 });
  audio.playMusic('menu');
  audio.setAmbience({ night: 0.8, indoor: false, nearWater: 0.6, combat: 0, crowd: 0.6, rain: 0.3, altitude: 10 });
  const early = audio.loop('engine_car', { pos: { x: 6, y: 0.5, z: -4 }, pitch: 1.2 });
  log.earlyHandle = !!early && early.active;
  log.loopsBeforeUnlock = audio.stats().loops;
  audio.update(0.016);
  log.readyBeforeUnlock = audio.ready;

  const t0 = performance.now();
  audio.unlock();
  log.unlockMs = performance.now() - t0;
  audio.unlock(); audio.unlock(); // idempotent
  for (let i = 0; i < 100 && !audio.ready; i++) await sleep(20);
  log.ready = audio.ready;
  const tJobs = performance.now();
  for (let i = 0; i < 1200 && audio.stats().loopsPending; i++) { audio.update(0.01); await sleep(10); }
  log.jobsMs = performance.now() - tJobs;
  log.jobsDone = !audio.stats().loopsPending;
  log.longTasks = longTasks.slice();
  log.volumes = audio.getVolumes();
  const meter = audio.meter();

  audio.setListener({ x: 0, y: 1.7, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  audio.setListener({ x: 0, y: 1.7, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }); // repère dégénéré
  audio.setListener({ x: 1, y: 1.7, z: 2 }, { x: 0.3, y: 0, z: -1 });

  // Chaque bruitage, en 2D et positionné.
  const tPlay = performance.now();
  for (const name of SFX_NAMES) {
    audio.play(name);
    audio.play(name, { pos: { x: Math.random() * 20 - 10, y: 1, z: -5 - Math.random() * 10 }, volume: 0.8, pitch: 1.05, indoor: Math.random() < 0.3 });
    audio.update(0.016);
    await sleep(12);
  }
  log.playAllMs = performance.now() - tPlay;
  // Coups de feu lointains (variante lointaine automatique) et sons hors de portée.
  audio.play('pistol', { pos: { x: 0, y: 1, z: -120 } });
  audio.play('revolver', { pos: { x: 0, y: 1, z: -110 } });
  audio.play('railgun', { pos: { x: 100, y: 1, z: -60 } });
  audio.play('shotgun', { pos: { x: -90, y: 1, z: 10 } });
  audio.play('footstep_concrete', { pos: { x: 0, y: 0, z: -500 } });

  // Niveau crête pendant la lecture.
  let peak = 0;
  const buf = new Float32Array(meter.fftSize);
  for (let i = 0; i < 20; i++) {
    meter.getFloatTimeDomainData(buf);
    for (const x of buf) peak = Math.max(peak, Math.abs(x));
    audio.update(0.016);
    await sleep(20);
  }
  log.meterPeak = peak;

  // Limitation des voix sous un déluge d'appels.
  let maxVoices = 0;
  const tSpam = performance.now();
  for (let i = 0; i < 300; i++) {
    const n = ['footstep_concrete', 'footstep_metal', 'smg', 'pistol', 'hit_wall', 'punch'][i % 6];
    audio.play(n, { pos: { x: Math.random() * 30 - 15, y: 0, z: Math.random() * 30 - 15 } });
    maxVoices = Math.max(maxVoices, audio.stats().voices);
  }
  log.spamMs = performance.now() - tSpam;
  log.maxVoices = maxVoices;
  for (let i = 0; i < 30; i++) { audio.update(0.1); await sleep(100); }
  log.voicesDrained = audio.stats().voices;
  const cost = async (name, n, hrtf, gapMs = 25) => {
    audio.setHrtf(hrtf);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      audio.play(name, { pos: { x: (i % 5) - 2, y: 0.5, z: -3 } });
      total += performance.now() - t;
      await sleep(gapMs);
      audio.update(gapMs / 1000);
    }
    return (total / n) * 1000;
  };
  log.footstepCallUs = await cost('footstep_concrete', 20, true);
  log.gunCallUs = await cost('pistol', 10, false);
  log.gunCallHrtfUs = await cost('pistol', 10, true);
  log.punchCallUs = await cost('punch', 10, true);
  // Pistolet-mitrailleur : 12 coups par seconde pendant 2 s.
  log.smgCallUs = await cost('smg', 24, true, 83);
  log.smgVoices = audio.stats().voices;

  // Sons continus : la boucle créée avant le déverrouillage a démarré, plafond de 12, mise à jour, arrêt.
  log.earlyActive = early.active;
  const handles = [early];
  const names = LOOP_NAMES;
  for (let i = 0; handles.length < 12; i++) {
    const n = names[i % names.length];
    const h = audio.loop(n, i % 4 === 3 ? { volume: 0.3, pitch: 1 } : { pos: { x: i * 3 - 15, y: 1, z: -10 }, volume: 0.6, pitch: 1 + (i % 3) * 0.5 });
    if (h) handles.push(h);
    else break;
  }
  log.loopsCreated = handles.length;
  log.loopOverCap = audio.loop('drone', { pos: { x: 0, y: 3, z: -2 } }) === null;
  log.loopBadName = audio.loop('carriage', {}) === null;
  log.loopsActive = audio.stats().loops;
  const tLoop = performance.now();
  let loopUpdates = 0;
  for (let f = 0; f < 60; f++) {
    for (let k = 0; k < handles.length; k++) {
      const h = handles[k];
      h.update({ pos: { x: -40 + f * 1.5 + k, y: 1, z: -6 - k }, pitch: 1 + (f / 60) * 1.5, volume: 0.6 });
      loopUpdates++;
    }
    audio.update(0.016);
    await sleep(16);
  }
  log.loopUpdateUs = ((performance.now() - tLoop) / loopUpdates) * 1000; // inclut les attentes : borne haute
  let lp = 0;
  for (let i = 0; i < 10; i++) {
    meter.getFloatTimeDomainData(buf);
    for (const x of buf) lp = Math.max(lp, Math.abs(x));
    await sleep(20);
  }
  log.loopPeak = lp;
  for (const h of handles) h.stop(0.2);
  handles[0].stop(); // double arrêt sans effet
  handles[1].update({ pitch: 2 }); // mise à jour après arrêt sans effet
  log.loopsAfterStop = audio.stats().loops;
  log.handlesInactive = handles.every((h) => !h.active);
  log.releasingAfterStop = audio.stats().pendingEvents;
  for (let i = 0; i < 20; i++) { audio.update(0.05); await sleep(50); }
  log.releasingLater = audio.stats().pendingEvents;
  log.loopReuse = !!audio.loop('siren', { pos: { x: 0, y: 1, z: -30 } });
  for (let i = 0; i < 5; i++) { audio.update(0.05); await sleep(30); }

  // Musique : chaque morceau, en fondu enchaîné.
  const tracks = ['menu', 'game', 'tension', 'victory', 'defeat', 'none', 'menu'];
  log.tracks = [];
  for (const tr of tracks) {
    audio.playMusic(tr);
    for (let i = 0; i < 15; i++) { audio.update(0.05); await sleep(50); }
    log.tracks.push([tr, audio.currentMusic]);
  }
  // Bascule automatique jeu <-> tension selon les combats.
  audio.playMusic('game');
  audio.setAmbience({ night: 0.2, indoor: false, nearWater: 0, combat: 0.9, crowd: 0.2 });
  for (let i = 0; i < 5; i++) { audio.update(0.1); await sleep(20); }
  log.combatTrack = audio.currentMusic;
  audio.playMusic('game'); // ne doit pas annuler la tension automatique
  log.combatTrackAfterGame = audio.currentMusic;
  audio.setAmbience({ night: 0.2, indoor: true, nearWater: 0, combat: 0, crowd: 0 });
  for (let i = 0; i < 25; i++) { audio.update(0.5); await sleep(10); }
  log.calmTrack = audio.currentMusic;

  // Ambiance : variations pendant quelques secondes (rue, toits, métro, intérieur).
  for (let i = 0; i < 40; i++) {
    audio.setAmbience({
      night: (i % 10) / 10, indoor: i % 13 > 8, nearWater: (i % 7) / 7, combat: 0, crowd: (i % 5) / 5, rain: (i % 3) / 2,
      underground: i >= 20 && i < 30 ? 1 : 0, altitude: i % 4 === 0 ? 45 : 0,
    });
    audio.update(0.1);
    await sleep(50);
  }
  log.statsAfterAmb = audio.stats();
  audio.suspend();
  await sleep(100);
  log.stateSuspended = audio.stats().state;
  audio.unlock(); // ne doit PAS relancer un moteur mis en pause par l'utilisateur
  await sleep(50);
  log.stateAfterUnlock = audio.stats().state;
  audio.resume();
  for (let i = 0; i < 50 && audio.stats().state !== 'running'; i++) await sleep(20);
  log.stateResumed = audio.stats().state;
  audio.setVolumes({ master: 0, music: 0, sfx: 0, ambience: 0 });
  audio.setVolumes({ master: NaN, music: 2, sfx: -1, ambience: 0.5 });
  log.volumesClamped = audio.getVolumes();
  return log;
});

if (rt.readyBeforeUnlock === false) ok('calls before unlock ignored'); else fail('ready before unlock');
if (rt.earlyHandle && rt.loopsBeforeUnlock === 1) ok('loop() before unlock returns a pending handle'); else fail(`early loop handle ${rt.earlyHandle} / ${rt.loopsBeforeUnlock}`);
if (rt.ready) ok(`unlock -> running (unlock took ${rt.unlockMs.toFixed(1)} ms)`); else fail('context not running after unlock');
if (rt.volumes.master === 0.9 && rt.volumes.music === 0.7) ok('volumes remembered before unlock'); else fail(`volumes not remembered ${JSON.stringify(rt.volumes)}`);
if (rt.meterPeak > 0.01 && rt.meterPeak <= 1.5) ok(`realtime output non-silent (peak ${rt.meterPeak.toFixed(3)})`); else fail(`realtime meter peak ${rt.meterPeak}`);
if (rt.maxVoices <= 32) ok(`voice limit respected (max ${rt.maxVoices}, spam of 300 calls took ${rt.spamMs.toFixed(1)} ms)`); else fail(`voices ${rt.maxVoices} > 32`);
ok(`cost per call: footstep ${rt.footstepCallUs.toFixed(0)} us, pistol ${rt.gunCallUs.toFixed(0)} us (HRTF ${rt.gunCallHrtfUs.toFixed(0)} us), smg@12/s ${rt.smgCallUs.toFixed(0)} us (${rt.smgVoices} voices), punch ${rt.punchCallUs.toFixed(0)} us; voices drained to ${rt.voicesDrained}`);
if (rt.jobsDone) ok(`deferred banks/IRs/loops generated in ${rt.jobsMs.toFixed(0)} ms after unlock (time-sliced, long tasks: ${rt.longTasks.length ? rt.longTasks.join('/') + ' ms' : 'none'})`); else fail('deferred resources never finished');
// (les tâches longues dépendent aussi de la charge de la machine : information seulement)
if (rt.earlyActive && rt.loopsCreated === 12 && rt.loopOverCap && rt.loopBadName && rt.loopsActive === 12) ok(`loops: pending handle started, cap of 12 enforced, unknown name rejected (update ~${rt.loopUpdateUs.toFixed(0)} us, peak ${rt.loopPeak.toFixed(3)})`);
else fail(`loops: early ${rt.earlyActive} created ${rt.loopsCreated} overCap ${rt.loopOverCap} badName ${rt.loopBadName} active ${rt.loopsActive}`);
if (rt.loopPeak > 0.005 && rt.loopPeak <= 1.5) ok('loops audible in realtime'); else fail(`loop peak ${rt.loopPeak}`);
if (rt.loopsAfterStop === 0 && rt.handlesInactive && rt.releasingLater === 0 && rt.loopReuse) ok(`loop stop: handles inactive, ${rt.releasingAfterStop} fading then all nodes released, slots reusable`);
else fail(`loop stop: after ${rt.loopsAfterStop} inactive ${rt.handlesInactive} releasing ${rt.releasingAfterStop}->${rt.releasingLater} reuse ${rt.loopReuse}`);
const trackOk = rt.tracks.every(([want, got]) => want === got || (want === 'none' && got === 'none'));
if (trackOk) ok(`music tracks: ${rt.tracks.map(([a, b]) => `${a}->${b}`).join(', ')}`); else fail(`music tracks ${JSON.stringify(rt.tracks)}`);
if (rt.combatTrack === 'tension' && rt.combatTrackAfterGame === 'tension') ok('combat switches game -> tension'); else fail(`combat track ${rt.combatTrack}/${rt.combatTrackAfterGame}`);
if (rt.calmTrack === 'game') ok('calm switches tension -> game'); else fail(`calm track ${rt.calmTrack}`);
if (rt.stateSuspended === 'suspended' && rt.stateAfterUnlock === 'suspended' && rt.stateResumed === 'running') ok('suspend/resume'); else fail(`suspend/resume states ${rt.stateSuspended}/${rt.stateAfterUnlock}/${rt.stateResumed}`);
if (rt.volumesClamped.master === 0 && rt.volumesClamped.music === 1 && rt.volumesClamped.sfx === 0 && rt.volumesClamped.ambience === 0.5) ok('volume clamping'); else fail(`volume clamping ${JSON.stringify(rt.volumesClamped)}`);
if (verbose) console.log('  stats', JSON.stringify(rt.statsAfterAmb));

/* ------------------------------------------------------------------ rendus hors ligne */
console.log('Offline renders');
const off = await page.evaluate(async () => {
  const { AudioEngine, SFX_NAMES, LOOP_NAMES } = window.__A;
  const analyze = (buf, from = 0, to = Infinity) => {
    let sum = 0, peak = 0, nan = 0, n = 0, dsum = 0;
    const win = Math.floor(buf.sampleRate * 0.05);
    const i0 = Math.floor(from * buf.sampleRate);
    let maxWin = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      const i1 = Math.min(d.length, Math.floor(to * buf.sampleRate));
      let prev = 0, ws = 0;
      for (let i = i0; i < i1; i++) {
        const x = d[i];
        if (!Number.isFinite(x)) { nan++; continue; }
        sum += x * x; ws += x * x; n++;
        const a = Math.abs(x); if (a > peak) peak = a;
        dsum += (x - prev) * (x - prev);
        prev = x;
        if ((i - i0 + 1) % win === 0) { maxWin = Math.max(maxWin, Math.sqrt(ws / win)); ws = 0; }
      }
    }
    // Estimation de la fréquence « RMS » (Hz) : sqrt(E[dx^2]/E[x^2]) * fs / (2*pi).
    const bright = sum > 0 ? (Math.sqrt(dsum / sum) * buf.sampleRate) / (2 * Math.PI) : 0;
    return { rms: Math.sqrt(sum / Math.max(1, n)), peak, nan, loud: maxWin, bright };
  };
  const res = { sfx: {}, pos: {}, loop: {}, music: {}, amb: {} };
  const t0 = performance.now();
  const LEN = {
    subway_train: 9.5, explosion: 4, vehicle_crash: 3, move_in: 3.5, heist_success: 3.5, victory: 3.5, defeat: 3.5,
    capture: 3, territory_lost: 3, alert: 2.5, death: 2.5, reload: 2.5, police_siren: 2.5, police_whistle: 2.5,
    police_radio: 2.5, alarm_burst: 2.5, hover_pass: 3, carriage_wheels: 3, drone_pass: 3.5, railgun: 2.5, rifle: 2.5,
    rail_far: 2.5, rifle_far: 2.5, glass_break: 2.5,
  };
  for (const name of SFX_NAMES) {
    const buf = await AudioEngine.renderOffline(LEN[name] ?? 2, (e) => e.play(name));
    res.sfx[name] = analyze(buf);
  }
  // Variantes positionnelles et lointaines.
  const posCases = [
    ['pistol@5m', 'pistol', { x: 0, y: 0, z: -5 }], ['pistol@120m', 'pistol', { x: 0, y: 0, z: -120 }],
    ['revolver@120m', 'revolver', { x: 0, y: 0, z: -120 }],
    ['railgun@150m', 'railgun', { x: 150, y: 0, z: 0 }], ['shotgun@80m', 'shotgun', { x: 0, y: 0, z: 80 }],
    ['smg@100m', 'smg', { x: -100, y: 0, z: 0 }], ['turret_fire@120m', 'turret_fire', { x: 0, y: 30, z: -120 }],
    ['footstep_concrete@3m', 'footstep_concrete', { x: 3, y: 0, z: 0 }], ['footstep_concrete@20m', 'footstep_concrete', { x: 20, y: 0, z: 0 }],
    ['footstep_metal@3m', 'footstep_metal', { x: 3, y: 0, z: 0 }],
    ['footstep_stone@40m(culled)', 'footstep_stone', { x: 40, y: 0, z: 0 }],
  ];
  for (const [label, name, pos] of posCases) {
    const buf = await AudioEngine.renderOffline(2.2, (e) => { e.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }); e.play(name, { pos }); });
    res.pos[label] = analyze(buf);
  }
  // Réverbération intérieure et réverbération du quai de métro.
  res.pos['pistol indoor'] = analyze(await AudioEngine.renderOffline(2, (e) => {
    e.setAmbience({ night: 0, indoor: true, nearWater: 0, combat: 0, crowd: 0 });
    e.setVolumes({ master: 1, music: 1, sfx: 1, ambience: 0 });
    e.play('pistol', { pos: { x: 2, y: 0, z: -3 } });
  }));
  const tunnel = await AudioEngine.renderOffline(3, (e) => {
    e.setAmbience({ night: 0, indoor: false, nearWater: 0, combat: 0, crowd: 0, underground: 1 });
    e.setVolumes({ master: 1, music: 1, sfx: 1, ambience: 0 });
    e.play('pistol', { pos: { x: 2, y: 0, z: -3 } });
  });
  const street = await AudioEngine.renderOffline(3, (e) => {
    e.setVolumes({ master: 1, music: 1, sfx: 1, ambience: 0 });
    e.play('pistol', { pos: { x: 2, y: 0, z: -3 } });
  });
  res.pos['pistol subway'] = analyze(tunnel);
  res.tail = { tunnel: analyze(tunnel, 1.0, 2.0).rms, street: analyze(street, 1.0, 2.0).rms };
  // Rafale de pistolet-mitrailleur : 12 coups/s pendant 2 s (+ un second tireur).
  res.pos['smg burst 12/s x2'] = analyze(await AudioEngine.renderOffline(3, (e) => {
    for (let i = 0; i < 24; i++) {
      e.play('smg', { pos: { x: 3, y: 0, z: -6 }, when: 0.05 + i / 12 });
      e.play('smg', { pos: { x: -8, y: 0, z: -15 }, when: 0.09 + i / 12 });
    }
  }));
  // Limitation des voix dans une salve dense.
  res.pos['burst 100 shots'] = analyze(await AudioEngine.renderOffline(2, (e) => {
    for (let i = 0; i < 100; i++) e.play(['pistol', 'shotgun', 'railgun', 'smg'][i % 4], { pos: { x: i % 10 - 5, y: 0, z: -4 }, when: 0.01 + i * 0.01 });
  }));
  // Sons continus.
  for (const name of LOOP_NAMES) {
    const buf = await AudioEngine.renderOffline(3, (e) => {
      e.setVolumes({ master: 1, music: 0, sfx: 1, ambience: 0 });
      e.loop(name, { pos: { x: 4, y: 1, z: -6 }, pitch: 1.2 });
    });
    res.loop[name] = analyze(buf, 0.2);
  }
  const engineAt = async (pitch) => analyze(await AudioEngine.renderOffline(2, (e) => {
    e.setVolumes({ master: 1, music: 0, sfx: 1, ambience: 0 });
    e.loop('engine_car', { pitch });
  }), 0.3);
  res.loop['engine_car idle'] = await engineAt(1);
  res.loop['engine_car full'] = await engineAt(2.5);
  // Mise à jour et arrêt en cours de rendu (suspend() d'un OfflineAudioContext).
  // (après l'arrêt, on laisse passer la queue de réverbération de la rue avant de mesurer le silence)
  const upd = await AudioEngine.renderOffline(5.2, (e) => {
    e.setVolumes({ master: 1, music: 0, sfx: 1, ambience: 0 });
    const h = e.loop('engine_moto', { pos: { x: -20, y: 1, z: -5 }, pitch: 1 });
    const ctx = e.context;
    ctx.suspend(1).then(() => { h.update({ pos: { x: 3, y: 1, z: -5 }, pitch: 2.4 }); ctx.resume(); });
    ctx.suspend(2.2).then(() => { h.stop(0.15); ctx.resume(); });
  });
  res.loopUpdate = { before: analyze(upd, 0.3, 1), after: analyze(upd, 1.3, 2.1), stopped: analyze(upd, 4.8, 5.2) };
  // Musique.
  const mus = [['menu', 24], ['game', 16], ['tension', 9], ['tension low', 9], ['victory', 9], ['defeat', 7.5]];
  for (const [tr, secs] of mus) {
    const buf = await AudioEngine.renderOffline(secs, (e) => {
      e.setVolumes({ master: 1, music: 1, sfx: 1, ambience: 0 });
      if (tr.startsWith('tension')) e.setAmbience({ night: 0, indoor: false, nearWater: 0, combat: tr === 'tension' ? 0.95 : 0.4, crowd: 0 });
      e.playMusic(tr.split(' ')[0]);
    });
    res.music[tr] = analyze(buf);
    if (tr === 'menu') { res.menuIntro = analyze(buf, 1, 9); res.menuFull = analyze(buf, 21.5, 24); }
  }
  // Ambiances.
  const ambs = {
    nightStreet: { night: 1, indoor: false, nearWater: 0, combat: 0, crowd: 0.2 },
    dayCrowd: { night: 0, indoor: false, nearWater: 0, combat: 0, crowd: 1 },
    riverNightRain: { night: 0.9, indoor: false, nearWater: 1, combat: 0, crowd: 0, rain: 1 },
    lightRain: { night: 0.6, indoor: false, nearWater: 0, combat: 0, crowd: 0, rain: 0.15 },
    riverDay: { night: 0, indoor: false, nearWater: 1, combat: 0, crowd: 0.3 },
    rooftopNight: { night: 1, indoor: false, nearWater: 0, combat: 0, crowd: 0, altitude: 45, rain: 0.2 },
    subway: { night: 0.5, indoor: false, nearWater: 0, combat: 0, crowd: 0.5, underground: 1 },
    indoorRain: { night: 0.5, indoor: true, nearWater: 0, combat: 0, crowd: 0.5, rain: 0.8 },
    indoorNight: { night: 1, indoor: true, nearWater: 0, combat: 0, crowd: 0 },
  };
  for (const [k, p] of Object.entries(ambs)) {
    const buf = await AudioEngine.renderOffline(12, (e) => { e.setVolumes({ master: 1, music: 0, sfx: 0, ambience: 1 }); e.setAmbience(p); });
    res.amb[k] = analyze(buf);
  }
  res.renderMs = performance.now() - t0;
  return res;
});

const check = (group, label, a, minRms = 1e-4) => {
  const desc = `rms ${a.rms.toExponential(2)} loud ${a.loud.toFixed(3)} peak ${a.peak.toFixed(3)} bright ${a.bright.toFixed(0)} Hz`;
  if (a.nan > 0) return fail(`${group} ${label}: ${a.nan} non-finite samples`);
  if (a.peak > 1.5) return fail(`${group} ${label}: clipping peak ${a.peak}`);
  if (a.rms < minRms) return fail(`${group} ${label}: silent (${desc})`);
  if (verbose) ok(`${group} ${label.padEnd(26)} ${desc}`);
  return true;
};
let n = 0;
for (const [k, a] of Object.entries(off.sfx)) { check('sfx', k, a); n++; }
for (const [k, a] of Object.entries(off.pos)) {
  if (k.includes('culled')) { if (a.rms > 1e-6) fail(`pos ${k}: expected silence, rms ${a.rms}`); else if (verbose) ok(`pos ${k} silent as expected`); }
  else check('pos', k, a, 1e-5);
  n++;
}
for (const [k, a] of Object.entries(off.loop)) { check('loop', k, a, 1e-3); n++; }
for (const [k, a] of Object.entries(off.music)) { check('music', k, a, 1e-3); n++; }
for (const [k, a] of Object.entries(off.amb)) { check('amb', k, a, 1e-3); n++; }
ok(`${n} offline renders analysed in ${(off.renderMs / 1000).toFixed(1)} s`);
const near = off.pos['pistol@5m'], far = off.pos['pistol@120m'];
if (far.bright < near.bright * 0.8 && far.loud < near.loud) ok(`distant gunshot is duller & quieter (brightness ${near.bright.toFixed(0)} -> ${far.bright.toFixed(0)} Hz, loud ${near.loud.toFixed(3)} -> ${far.loud.toFixed(3)})`);
else fail(`distant gunshot not duller/quieter: near ${JSON.stringify(near)} far ${JSON.stringify(far)}`);
const s3 = off.pos['footstep_concrete@3m'], s20 = off.pos['footstep_concrete@20m'];
if (s20.loud < s3.loud * 0.35) ok(`footstep attenuates with distance (${s3.loud.toFixed(4)} -> ${s20.loud.toFixed(4)})`); else fail('footstep distance attenuation');
const smgB = off.pos['smg burst 12/s x2'];
if (smgB.peak <= 1.2 && smgB.loud > 0.05) ok(`smg burst at 12 shots/s from two shooters stays clean (peak ${smgB.peak.toFixed(3)}, loud ${smgB.loud.toFixed(3)})`);
else fail(`smg burst ${JSON.stringify(smgB)}`);
if (off.tail.tunnel > off.tail.street * 1.3) ok(`subway platform reverb is longer than the street (tail rms ${off.tail.street.toExponential(2)} -> ${off.tail.tunnel.toExponential(2)})`);
else fail(`subway tail ${JSON.stringify(off.tail)}`);
const idle = off.loop['engine_car idle'], full = off.loop['engine_car full'];
if (full.bright > idle.bright * 1.5 && full.rms > idle.rms) ok(`engine pitch maps to RPM (brightness ${idle.bright.toFixed(0)} -> ${full.bright.toFixed(0)} Hz, rms ${idle.rms.toFixed(3)} -> ${full.rms.toFixed(3)})`);
else fail(`engine RPM mapping idle ${JSON.stringify(idle)} full ${JSON.stringify(full)}`);
const lu = off.loopUpdate;
if (lu.after.rms > lu.before.rms * 1.5 && lu.after.bright > lu.before.bright && lu.stopped.rms < 1e-5) ok(`loop update() and stop() mid-render (rms ${lu.before.rms.toExponential(2)} -> ${lu.after.rms.toExponential(2)} -> ${lu.stopped.rms.toExponential(1)})`);
else fail(`loop update/stop ${JSON.stringify(lu)}`);
if (off.menuFull.rms > off.menuIntro.rms * 1.2) ok(`menu theme builds up (intro rms ${off.menuIntro.rms.toFixed(3)} -> full ${off.menuFull.rms.toFixed(3)})`);
else fail(`menu build-up intro ${JSON.stringify(off.menuIntro)} full ${JSON.stringify(off.menuFull)}`);
const tHi = off.music['tension'], tLo = off.music['tension low'];
if (tHi.rms > tLo.rms) ok(`tension intensity layers (rms ${tLo.rms.toFixed(3)} at low combat -> ${tHi.rms.toFixed(3)} at high)`); else fail(`tension intensity ${tLo.rms} vs ${tHi.rms}`);
const roof = off.amb['rooftopNight'], street0 = off.amb['nightStreet'];
if (roof.rms > street0.rms) ok(`rooftop wind louder than the street (rms ${street0.rms.toFixed(3)} -> ${roof.rms.toFixed(3)})`); else fail(`rooftop ${roof.rms} vs street ${street0.rms}`);

if (errors.length) { for (const e of errors) fail(e); }
await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll audio smoke checks passed.');
process.exit(failures ? 1 : 0);
