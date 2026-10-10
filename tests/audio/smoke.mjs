// Headless smoke test for the procedural AudioEngine (src/client/audio).
//
//   node tests/audio/smoke.mjs            # run all checks
//   node tests/audio/smoke.mjs --verbose  # also print per-sound levels
//
// Bundles AudioEngine.ts in memory with esbuild, loads it in headless Chromium
// (autoplay allowed), drives the realtime API and renders every SFX, music
// track, ambience preset and the Big Ben chime through OfflineAudioContext,
// asserting non-silent, finite, non-clipping output.
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

/* ------------------------------------------------------------------ realtime API */
console.log('Realtime API');
const rt = await page.evaluate(async () => {
  const { audio, SFX_NAMES } = window.__A;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = {};
  // Calls before unlock must be silently ignored (volumes remembered).
  audio.play('revolver');
  audio.setVolumes({ master: 0.9, music: 0.7, sfx: 1, ambience: 0.8 });
  audio.playMusic('menu');
  audio.setAmbience({ night: 0.8, indoor: false, nearWater: 0.6, combat: 0, crowd: 0.6, rain: 0.3 });
  audio.bellChime(3);
  audio.update(0.016);
  log.readyBeforeUnlock = audio.ready;

  const t0 = performance.now();
  audio.unlock();
  log.unlockMs = performance.now() - t0;
  audio.unlock(); audio.unlock(); // idempotent
  for (let i = 0; i < 100 && !audio.ready; i++) await sleep(20);
  log.ready = audio.ready;
  const tJobs = performance.now();
  for (let i = 0; i < 300 && audio.stats().loopsPending; i++) await sleep(10);
  log.jobsMs = performance.now() - tJobs;
  log.jobsDone = !audio.stats().loopsPending;
  log.volumes = audio.getVolumes();
  const meter = audio.meter();

  audio.setListener({ x: 0, y: 1.7, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  audio.setListener({ x: 0, y: 1.7, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }); // degenerate frame
  audio.setListener({ x: 1, y: 1.7, z: 2 }, { x: 0.3, y: 0, z: -1 });

  // Every SFX, 2D and positional.
  const tPlay = performance.now();
  for (const name of SFX_NAMES) {
    audio.play(name);
    audio.play(name, { pos: { x: Math.random() * 20 - 10, y: 1, z: -5 - Math.random() * 10 }, volume: 0.8, pitch: 1.05, indoor: Math.random() < 0.3 });
    audio.update(0.016);
    await sleep(15);
  }
  log.playAllMs = performance.now() - tPlay;
  // Distant gunshots (auto far variant) and culled ones.
  audio.play('revolver', { pos: { x: 0, y: 1, z: -120 } });
  audio.play('rifle', { pos: { x: 100, y: 1, z: -60 } });
  audio.play('shotgun', { pos: { x: -90, y: 1, z: 10 } });
  audio.play('footstep_stone', { pos: { x: 0, y: 0, z: -500 } });

  // Peak level while things play.
  let peak = 0;
  const buf = new Float32Array(meter.fftSize);
  for (let i = 0; i < 20; i++) {
    meter.getFloatTimeDomainData(buf);
    for (const x of buf) peak = Math.max(peak, Math.abs(x));
    audio.update(0.016);
    await sleep(20);
  }
  log.meterPeak = peak;

  // Voice limiting under spam.
  let maxVoices = 0;
  const tSpam = performance.now();
  for (let i = 0; i < 300; i++) {
    const n = ['footstep_stone', 'footstep_wood', 'revolver', 'hit_wall', 'punch'][i % 5];
    audio.play(n, { pos: { x: Math.random() * 30 - 15, y: 0, z: Math.random() * 30 - 15 } });
    maxVoices = Math.max(maxVoices, audio.stats().voices);
  }
  log.spamMs = performance.now() - tSpam;
  log.maxVoices = maxVoices;
  log.voicesAfterSpam = audio.stats().voices;
  // Cost of single calls in a non-saturated state (let the spam drain first).
  for (let i = 0; i < 30; i++) { audio.update(0.1); await sleep(100); }
  log.voicesDrained = audio.stats().voices;
  const cost = async (name, n, hrtf) => {
    audio.setHrtf(hrtf);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      audio.play(name, { pos: { x: (i % 5) - 2, y: 0.5, z: -3 } });
      total += performance.now() - t;
      await sleep(25);
      audio.update(0.025);
    }
    return (total / n) * 1000;
  };
  log.footstepCallUs = await cost('footstep_stone', 20, true);
  log.gunCallUs = await cost('revolver', 10, false);
  log.gunCallHrtfUs = await cost('revolver', 10, true);
  log.punchCallUs = await cost('punch', 10, true);

  // Music: every track, crossfading.
  const tracks = ['menu', 'game', 'tension', 'victory', 'defeat', 'none', 'menu'];
  log.tracks = [];
  for (const tr of tracks) {
    audio.playMusic(tr);
    for (let i = 0; i < 15; i++) { audio.update(0.05); await sleep(50); }
    log.tracks.push([tr, audio.currentMusic]);
  }
  // Combat-driven game <-> tension switching.
  audio.playMusic('game');
  audio.setAmbience({ night: 0.2, indoor: false, nearWater: 0, combat: 0.9, crowd: 0.2 });
  for (let i = 0; i < 5; i++) { audio.update(0.1); await sleep(20); }
  log.combatTrack = audio.currentMusic;
  audio.playMusic('game'); // must not cancel auto tension
  log.combatTrackAfterGame = audio.currentMusic;
  audio.setAmbience({ night: 0.2, indoor: true, nearWater: 0, combat: 0, crowd: 0 });
  for (let i = 0; i < 25; i++) { audio.update(0.5); await sleep(10); }
  log.calmTrack = audio.currentMusic;

  // Ambience variations for a few seconds + chimes.
  audio.bellChime(2, { x: 300, y: 80, z: -200 });
  for (let i = 0; i < 40; i++) {
    audio.setAmbience({ night: (i % 10) / 10, indoor: i % 13 > 8, nearWater: (i % 7) / 7, combat: 0, crowd: (i % 5) / 5, rain: (i % 3) / 2 });
    audio.update(0.1);
    await sleep(50);
  }
  log.statsAfterAmb = audio.stats();
  audio.stopChime();
  audio.bellChime(0, undefined, 1);
  audio.suspend();
  await sleep(100);
  log.stateSuspended = audio.stats().state;
  audio.unlock(); // must NOT resume a user-suspended engine
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
if (rt.ready) ok(`unlock -> running (unlock took ${rt.unlockMs.toFixed(1)} ms)`); else fail('context not running after unlock');
if (rt.volumes.master === 0.9 && rt.volumes.music === 0.7) ok('volumes remembered before unlock'); else fail(`volumes not remembered ${JSON.stringify(rt.volumes)}`);
if (rt.meterPeak > 0.01 && rt.meterPeak <= 1.5) ok(`realtime output non-silent (peak ${rt.meterPeak.toFixed(3)})`); else fail(`realtime meter peak ${rt.meterPeak}`);
if (rt.maxVoices <= 32) ok(`voice limit respected (max ${rt.maxVoices}, spam of 300 calls took ${rt.spamMs.toFixed(1)} ms)`); else fail(`voices ${rt.maxVoices} > 32`);
ok(`cost per call: footstep ${rt.footstepCallUs.toFixed(0)} us, gunshot ${rt.gunCallUs.toFixed(0)} us (HRTF ${rt.gunCallHrtfUs.toFixed(0)} us), punch ${rt.punchCallUs.toFixed(0)} us; voices drained to ${rt.voicesDrained}`);
if (rt.jobsDone) ok(`deferred footsteps/IRs/loops generated in ${rt.jobsMs.toFixed(0)} ms after unlock (time-sliced)`); else fail('deferred resources never finished');
const trackOk = rt.tracks.every(([want, got]) => want === got || (want === 'none' && got === 'none'));
if (trackOk) ok(`music tracks: ${rt.tracks.map(([a, b]) => `${a}->${b}`).join(', ')}`); else fail(`music tracks ${JSON.stringify(rt.tracks)}`);
if (rt.combatTrack === 'tension' && rt.combatTrackAfterGame === 'tension') ok('combat switches game -> tension'); else fail(`combat track ${rt.combatTrack}/${rt.combatTrackAfterGame}`);
if (rt.calmTrack === 'game') ok('calm switches tension -> game'); else fail(`calm track ${rt.calmTrack}`);
if (rt.stateSuspended === 'suspended' && rt.stateAfterUnlock === 'suspended' && rt.stateResumed === 'running') ok('suspend/resume'); else fail(`suspend/resume states ${rt.stateSuspended}/${rt.stateAfterUnlock}/${rt.stateResumed}`);
if (rt.volumesClamped.master === 0 && rt.volumesClamped.music === 1 && rt.volumesClamped.sfx === 0 && rt.volumesClamped.ambience === 0.5) ok('volume clamping'); else fail(`volume clamping ${JSON.stringify(rt.volumesClamped)}`);
if (verbose) console.log('  stats', JSON.stringify(rt.statsAfterAmb));

/* ------------------------------------------------------------------ offline renders */
console.log('Offline renders');
const off = await page.evaluate(async () => {
  const { AudioEngine, SFX_NAMES } = window.__A;
  const analyze = (buf) => {
    let sum = 0, peak = 0, nan = 0, n = 0, dsum = 0;
    const win = Math.floor(buf.sampleRate * 0.05);
    let maxWin = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      let prev = 0, ws = 0;
      for (let i = 0; i < d.length; i++) {
        const x = d[i];
        if (!Number.isFinite(x)) { nan++; continue; }
        sum += x * x; ws += x * x; n++;
        const a = Math.abs(x); if (a > peak) peak = a;
        dsum += (x - prev) * (x - prev);
        prev = x;
        if ((i + 1) % win === 0) { maxWin = Math.max(maxWin, Math.sqrt(ws / win)); ws = 0; }
      }
    }
    // RMS-frequency estimate (Hz): sqrt(E[dx^2]/E[x^2]) * fs / (2*pi).
    const bright = sum > 0 ? (Math.sqrt(dsum / sum) * buf.sampleRate) / (2 * Math.PI) : 0;
    return { rms: Math.sqrt(sum / Math.max(1, n)), peak, nan, loud: maxWin, bright };
  };
  const res = { sfx: {}, pos: {}, music: {}, amb: {}, bell: {} };
  const t0 = performance.now();
  for (const name of SFX_NAMES) {
    const long = ['carriage_wheels', 'police_whistle', 'victory', 'defeat', 'alert', 'death', 'reload', 'capture', 'territory_lost', 'neigh'].includes(name);
    const buf = await AudioEngine.renderOffline(long ? 3.5 : 2, (e) => e.play(name));
    res.sfx[name] = analyze(buf);
  }
  // Positional / distance variants.
  const posCases = [
    ['revolver@5m', 'revolver', { x: 0, y: 0, z: -5 }], ['revolver@120m', 'revolver', { x: 0, y: 0, z: -120 }],
    ['rifle@150m', 'rifle', { x: 150, y: 0, z: 0 }], ['shotgun@80m', 'shotgun', { x: 0, y: 0, z: 80 }],
    ['footstep_stone@3m', 'footstep_stone', { x: 3, y: 0, z: 0 }], ['footstep_stone@20m', 'footstep_stone', { x: 20, y: 0, z: 0 }],
    ['footstep_stone@40m(culled)', 'footstep_stone', { x: 40, y: 0, z: 0 }],
  ];
  for (const [label, name, pos] of posCases) {
    const buf = await AudioEngine.renderOffline(2, (e) => { e.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }); e.play(name, { pos }); });
    res.pos[label] = analyze(buf);
  }
  // Indoor reverb path.
  res.pos['revolver indoor'] = analyze(await AudioEngine.renderOffline(2, (e) => {
    e.setAmbience({ night: 0, indoor: true, nearWater: 0, combat: 0, crowd: 0 });
    e.setVolumes({ master: 1, music: 1, sfx: 1, ambience: 0 });
    e.play('revolver', { pos: { x: 2, y: 0, z: -3 } });
  }));
  // Voice limiting in a dense offline burst.
  res.pos['burst 100 shots'] = analyze(await AudioEngine.renderOffline(2, (e) => {
    for (let i = 0; i < 100; i++) e.play(['revolver', 'shotgun', 'rifle'][i % 3], { pos: { x: i % 10 - 5, y: 0, z: -4 }, when: 0.01 + i * 0.01 });
  }));
  // Music.
  const mus = [['menu', 14], ['game', 16], ['tension', 9], ['victory', 9], ['defeat', 7.5]];
  for (const [tr, secs] of mus) {
    const buf = await AudioEngine.renderOffline(secs, (e) => {
      e.setVolumes({ master: 1, music: 1, sfx: 1, ambience: 0 });
      if (tr === 'tension') e.setAmbience({ night: 0, indoor: false, nearWater: 0, combat: 0.9, crowd: 0 });
      e.playMusic(tr);
    });
    res.music[tr] = analyze(buf);
  }
  // Ambience presets.
  const ambs = {
    nightStreet: { night: 1, indoor: false, nearWater: 0, combat: 0, crowd: 0.2 },
    dayCrowd: { night: 0, indoor: false, nearWater: 0, combat: 0, crowd: 1 },
    riverNightRain: { night: 0.9, indoor: false, nearWater: 1, combat: 0, crowd: 0, rain: 1 },
    riverDay: { night: 0, indoor: false, nearWater: 1, combat: 0, crowd: 0.3 },
    indoorRain: { night: 0.5, indoor: true, nearWater: 0, combat: 0, crowd: 0.5, rain: 0.8 },
  };
  for (const [k, p] of Object.entries(ambs)) {
    const buf = await AudioEngine.renderOffline(12, (e) => { e.setVolumes({ master: 1, music: 0, sfx: 0, ambience: 1 }); e.setAmbience(p); });
    res.amb[k] = analyze(buf);
  }
  // Big Ben.
  res.bell.quarter = analyze(await AudioEngine.renderOffline(8, (e) => e.bellChime(1, undefined, 1)));
  res.bell.hour2 = analyze(await AudioEngine.renderOffline(26, (e) => e.bellChime(2, { x: 0, y: 60, z: -250 })));
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
for (const [k, a] of Object.entries(off.music)) { check('music', k, a, 1e-3); n++; }
for (const [k, a] of Object.entries(off.amb)) { check('amb', k, a, 1e-3); n++; }
for (const [k, a] of Object.entries(off.bell)) { check('bell', k, a, 1e-3); n++; }
ok(`${n} offline renders analysed in ${(off.renderMs / 1000).toFixed(1)} s`);
const near = off.pos['revolver@5m'], far = off.pos['revolver@120m'];
if (far.bright < near.bright * 0.8 && far.loud < near.loud) ok(`distant gunshot is duller & quieter (brightness ${near.bright.toFixed(0)} -> ${far.bright.toFixed(0)} Hz, loud ${near.loud.toFixed(3)} -> ${far.loud.toFixed(3)})`);
else fail(`distant gunshot not duller/quieter: near ${JSON.stringify(near)} far ${JSON.stringify(far)}`);
const s3 = off.pos['footstep_stone@3m'], s20 = off.pos['footstep_stone@20m'];
if (s20.loud < s3.loud * 0.35) ok(`footstep attenuates with distance (${s3.loud.toFixed(4)} -> ${s20.loud.toFixed(4)})`); else fail('footstep distance attenuation');

if (errors.length) { for (const e of errors) fail(e); }
await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll audio smoke checks passed.');
process.exit(failures ? 1 : 0);
