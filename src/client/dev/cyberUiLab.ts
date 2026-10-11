// Laboratoire de l'écran CYBERNÉTIQUE (développement, route ?cyberui) : l'écran, la barre des
// capacités et l'appli « Implants » du téléphone, sans serveur — un faux serveur applique les
// actions (mêmes règles et mêmes messages que server/game/cyber.ts).
//
// ?cyberui · &empty (aucun implant, peu d'argent) · &station=clinique|qg|off · &open[=focus]
// (emplacement, catégorie ou implant) · &phone (téléphone, appli Implants) · &nopreview
// (silhouette de repli) · &anim (capacités animées ; sinon figées dans un état représentatif)
// · &money=N · &dadou|&even. API de capture : window.__cyberLab.

import '@fontsource/orbitron/latin-400.css';
import '@fontsource/orbitron/latin-700.css';
import '@fontsource/orbitron/latin-900.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import '../ui/theme.css';
import '../ui/hud.css';
import '../ui/game.css';
import { Weapon } from '../../shared/characters';
import { BUILDING_BY_KEY } from '../../shared/city/plan';
import type { BuildingInfo } from '../../shared/city/gen/context';
import {
  IMPLANT_BY_ID,
  LOADOUT_COUNT,
  LOADOUT_NAMES,
  SLOT_BY_ID,
  SLOTS,
  emptyEquipment,
  implantParams,
  qualityOf,
  type Equipment,
  type SlotId,
} from '../../shared/implants';
import type { ClientAction, CyberState, GameEvent, PrivateState, PublicState, Slot } from '../../shared/protocol';
import { formatMoney } from '../../shared/util';
import { createMaterialTexture } from '../render/env';
import { h } from '../ui/dom';
import { AbilityHud } from '../game/abilityHud';
import { CyberUi, type CyberHost } from '../game/cyberUi';
import { cyberState, implantControls, type AbilityView } from '../game/cyberState';
import { Hud } from '../game/hud';
import { Phone } from '../game/phone';
import type { GameClient } from '../game/GameClient';

const CLINIC_KEY = 'clinique_lenox';

function mockPriv(params: URLSearchParams): PrivateState {
  const empty = params.has('empty');
  const equip = emptyEquipment();
  const owned: Record<string, number> = {};
  if (!empty) {
    Object.assign(owned, { grappin: 2, lame: 1, pistoletBras: 1, esquive: 3, sprint: 2, saut: 1, blindage: 1, thermique: 1, scanner: 1, camouflage: 1, reflexes: 1, visee: 2 });
    Object.assign(equip, { brasG: 'grappin', brasD: 'lame', jambes1: 'esquive', jambes2: 'sprint', torse1: 'blindage', yeux1: 'thermique', yeux2: 'scanner', peau: 'camouflage', neural1: 'reflexes', neural2: 'visee' });
  }
  const mobil: Equipment = { ...emptyEquipment(), brasG: 'grappin', brasD: 'pistoletBras', jambes1: 'esquive', jambes2: 'sprint', jambes3: 'saut' };
  return {
    money: Number(params.get('money') ?? (empty ? 2400 : 18450)),
    income: 340,
    men: 12,
    pool: 3,
    escort: 2,
    maxMen: 20,
    lieutenants: [],
    upgrades: params.get('station') === 'qg' ? ['cyberstation'] : [],
    weapons: [Weapon.FISTS, Weapon.PISTOL, Weapon.SMG],
    ammo: {},
    wanted: 0,
    dead: false,
    respawnIn: 0,
    tp: 1,
    kills: 0,
    deaths: 0,
    captured: 0,
    nextLtPrice: 0,
    maxLt: 2,
    tier: 2,
    hq: 0,
    garage: [],
    vehicle: -1,
    callIn: 0,
    droneIn: 0,
    grenades: 2,
    droneOver: null,
    hack: null,
    convoyIn: 0,
    spotted: [],
    cyber: {
      owned,
      equip,
      loadouts: empty ? [null, null, null] : [{ ...equip }, mobil, null],
      cd: {},
      charges: empty ? {} : { esquive: 2 },
      station: null,
    },
  };
}

function mockPub(you: Slot, hqId: number): PublicState {
  return {
    buildings: [],
    districts: [],
    territories: { dadou: 3, even: 2 },
    elapsed: 600,
    timeLeft: -1,
    dayTime: 0.9,
    battles: [],
    hq: { dadou: you === 'dadou' ? hqId : 1, even: you === 'even' ? hqId : 1 },
    tier: { dadou: 2, even: 2 },
    rain: 0,
    rides: [],
    hacked: [],
    heists: [],
    convoys: [],
    loot: [],
  };
}

/** Monde réduit : le QG (bureau, station) et une clinique, aux bons identifiants. */
function mockWorld(hqId: number, clinicId: number): { buildings: BuildingInfo[] } {
  const buildings: BuildingInfo[] = [];
  const base = (id: number, x: number, z: number): BuildingInfo =>
    ({ id, def: { id, name: id === clinicId ? 'Clinique de Lenox Hill' : 'Planque de Dadou' }, footprint: [x - 8, z - 8, x + 8, z + 8], floorY: 0, floors: [], roofY: null, doors: [], rooms: [], zone: [], center: { x, z }, defend: [], roofPts: [], guardOut: [], spawn: [], height: 10 }) as unknown as BuildingInfo;
  buildings[hqId] = { ...base(hqId, 6, 4), desk: { x: 6, z: 4, y: 0, yaw: 0 }, hqAnchors: { cyberstation: { x: 9, y: 0, z: 2, yaw: Math.PI } } };
  buildings[clinicId] = { ...base(clinicId, 140, -95), clinic: { name: 'Clinique de Lenox Hill', x: 140, y: 0, z: -95, yaw: 0 } };
  // pas de trous : les autres bâtiments existent, loin de tout
  return { buildings: Array.from({ length: Math.max(hqId, clinicId) + 1 }, (_, i) => buildings[i] ?? base(i, 9999, 9999)) };
}

export function startCyberUiLab(root: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const you: Slot = params.has('even') ? 'even' : 'dadou';
  const clinicId = BUILDING_BY_KEY[CLINIC_KEY]?.id ?? 7;
  const hqId = clinicId === 0 ? 1 : 0;
  let priv = mockPriv(params);
  const pub = mockPub(you, hqId);
  const world = mockWorld(hqId, clinicId);
  const stationParam = params.get('station') ?? 'clinique';
  let station: string | null = stationParam === 'off' ? null : stationParam === 'qg' ? 'qg' : `clinique:${clinicId}`;
  priv.cyber.station = station;
  const player = { x: 0, y: 0, z: 0 };
  // matières des voxels (l'aperçu 3D du parrain en a besoin, comme en partie)
  if (!params.has('nopreview')) createMaterialTexture();

  // décor : la ville derrière, assombrie par l'écran
  root.style.cssText = `background:#05060d url('/brand/menu-backdrop.jpg') center / cover no-repeat;`;
  const overlay = h('div', { class: `layer game-overlay mw-${you}` });
  root.appendChild(overlay);
  const hud = new Hud(you);
  overlay.appendChild(hud.el);
  hud.setPriv(priv, pub);
  hud.setHealth(0.82);
  hud.setDistrict('Upper East Side', 'Contrôlé par Dadou', '#e05a5a');
  hud.setClock(0.9, -1);
  hud.setObjective('Contrôlez 4 quartiers sur 7 (vous : 3), puis prenez le QG d’Even.');
  // mini-carte : un fond plausible
  const mm = hud.minimapCanvas.getContext('2d')!;
  const grad = mm.createRadialGradient(210, 210, 20, 210, 210, 210);
  grad.addColorStop(0, '#1a2140');
  grad.addColorStop(1, '#070914');
  mm.fillStyle = grad;
  mm.fillRect(0, 0, 420, 420);
  mm.strokeStyle = 'rgba(124,140,255,0.25)';
  mm.lineWidth = 6;
  for (let i = -420; i < 840; i += 70) {
    mm.beginPath();
    mm.moveTo(i, 0);
    mm.lineTo(i + 120, 420);
    mm.stroke();
  }

  let ui: CyberUi;
  let abilities: AbilityHud;
  const send = (fn: () => void) => setTimeout(fn, 260);
  const notify = (text: string, kind: Extract<GameEvent, { t: 'notify' }>['kind']) => {
    const e: GameEvent = { t: 'notify', text, kind };
    hud.notify(text, kind);
    ui.onEvent(e);
  };
  const pushPriv = () => {
    priv = { ...priv, cyber: { ...priv.cyber, owned: { ...priv.cyber.owned }, equip: { ...priv.cyber.equip }, loadouts: priv.cyber.loadouts.map((l) => (l ? { ...l } : null)), station } };
    hud.setPriv(priv, pub);
    ui.onPriv(priv);
    abilities.onPriv();
  };

  // ------------------------------------------------------------------ faux serveur (cyber.ts)
  const serverAct = (a: ClientAction): void => {
    if (a.a !== 'cyber') return;
    send(() => {
      const c = priv.cyber;
      const needStation = (): boolean => {
        if (station) return true;
        notify('Rendez-vous dans une clinique cybernétique ou à la station de votre QG.', 'info');
        return false;
      };
      const equipTo = (id: string, slot: SlotId, silent: boolean) => {
        const def = IMPLANT_BY_ID[id];
        const sd = SLOT_BY_ID[slot];
        if (!def || !sd || !c.owned[id]) return;
        if (sd.cat !== def.cat) return notify(`${def.name} ne se pose pas à cet emplacement (${sd.label}).`, 'bad');
        for (const s of SLOTS) if (c.equip[s.id] === id) c.equip[s.id] = null;
        c.equip[slot] = id;
        notify(`${def.name} installé (${sd.label}).`, silent ? 'info' : 'good');
      };
      switch (a.op) {
        case 'buy':
        case 'upgrade': {
          const def = a.id ? IMPLANT_BY_ID[a.id] : undefined;
          if (!def || !needStation()) break;
          const cur = c.owned[def.id] ?? 0;
          if (a.op === 'buy' && cur > 0) return notify(`Vous possédez déjà : ${def.name}.`, 'info');
          if (cur >= def.levels.length) return notify(`${def.name} est déjà au niveau maximal.`, 'info');
          const price = def.levels[cur].price;
          if (priv.money < price) return notify(`Pas assez d’argent : il faut ${formatMoney(price)}.`, 'bad');
          priv.money -= price;
          c.owned[def.id] = cur + 1;
          notify(cur === 0 ? `Implant acquis : ${def.name} (${qualityOf(def, 1)}).` : `${def.name} amélioré : niveau ${cur + 1} (${qualityOf(def, cur + 1)}).`, 'money');
          if (cur === 0) {
            const free = SLOTS.find((s) => s.cat === def.cat && !c.equip[s.id]);
            if (free) equipTo(def.id, free.id, true);
          }
          break;
        }
        case 'equip':
          if (a.id && a.slot && needStation()) equipTo(a.id, a.slot, false);
          break;
        case 'unequip': {
          if (!a.slot || !needStation()) break;
          const was = c.equip[a.slot];
          if (!was) break;
          c.equip[a.slot] = null;
          notify(`${IMPLANT_BY_ID[was]?.name ?? 'Implant'} retiré.`, 'info');
          break;
        }
        case 'save': {
          const k = Math.floor(a.n ?? -1);
          if (k < 0 || k >= LOADOUT_COUNT) break;
          c.loadouts[k] = { ...c.equip };
          notify(`Configuration « ${LOADOUT_NAMES[k]} » enregistrée.`, 'good');
          break;
        }
        case 'load': {
          const k = Math.floor(a.n ?? -1);
          const lo = c.loadouts[k];
          if (k < 0 || k >= LOADOUT_COUNT || !lo || !needStation()) break;
          c.equip = { ...lo };
          notify(`Configuration « ${LOADOUT_NAMES[k]} » installée.`, 'good');
          break;
        }
      }
      pushPriv();
    });
  };

  const host: CyberHost = {
    you,
    priv: () => priv,
    pub: () => pub,
    world,
    act: serverAct,
    setUiOpen: (open) => console.log(`[labo] setUiOpen(${open})`),
    mount: overlay,
    playerPos: () => player,
    notify: (text, kind) => hud.notify(text, kind),
    minimap: hud.minimapCanvas,
    noPreview: params.has('nopreview'),
  };
  ui = new CyberUi(host);
  abilities = new AbilityHud({ priv: () => priv, mount: hud.el, hud });

  // ------------------------------------------------------------------ faux contrôleur des capacités
  const animate = params.has('anim');
  const t0 = performance.now() / 1000;
  const mockAbilities = (now: number): void => {
    const t = now - t0;
    const c: CyberState = priv.cyber;
    const list: AbilityView[] = [];
    for (const ctl of implantControls(c.equip)) {
      const def = IMPLANT_BY_ID[ctl.id];
      const p = implantParams(ctl.id, c.owned[ctl.id] ?? 1);
      const cdMax = def.kind === 'arme' ? 0 : (p.cd ?? 0);
      const a: AbilityView = { id: ctl.id, action: ctl.action, hint: ctl.hint, cd: 0, cdMax, charges: -1, chargesMax: p.charges ?? -1, active: false };
      // état figé représentatif (captures) ou cycle animé
      const phase = animate ? (t + ctl.id.length * 1.7) % (cdMax + 4 || 6) : 0;
      switch (ctl.id) {
        case 'grappin':
          a.cd = animate ? Math.max(0, cdMax - phase) : 2.4;
          break;
        case 'lame':
        case 'pistoletBras':
          a.out = animate ? Math.floor(t / 4) % 2 === 0 : true;
          if (ctl.id === 'pistoletBras') {
            a.ammoMax = p.mag;
            a.ammo = animate ? Math.max(0, p.mag - Math.floor((t * 2) % (p.mag + 1))) : 6;
          }
          break;
        case 'esquive':
          a.chargesMax = p.charges;
          a.charges = animate ? Math.floor(t / 2) % (p.charges + 1) : 1;
          a.cd = a.charges < p.charges ? (animate ? cdMax - ((t * 1.3) % cdMax) : 1.2) : 0;
          break;
        case 'scanner':
          a.active = animate ? phase < 3 : true;
          a.cd = a.active ? 0 : 0;
          break;
        case 'camouflage':
          a.cd = animate ? Math.max(0, cdMax - phase * 4) : 31;
          break;
        case 'reflexes':
          a.cd = 0;
          break;
        case 'bouclier':
          a.active = animate ? phase < 2 : false;
          break;
        default:
          a.cd = animate ? Math.max(0, cdMax - phase) : 0;
      }
      list.push(a);
    }
    cyberState.abilities = list;
    cyberState.vision = list.some((a) => a.id === 'thermique') ? (animate ? (Math.floor(t / 5) % 3 === 1 ? 'thermal' : 'normal') : 'thermal') : 'normal';
    cyberState.energy = c.equip.jambes1 === 'sprint' || c.equip.jambes2 === 'sprint' || c.equip.jambes3 === 'sprint' ? (animate ? 0.5 + 0.5 * Math.sin(t * 0.8) : 0.62) : -1;
    cyberState.shield = 0;
    cyberState.shieldMax = 0;
    cyberState.at = now;
  };

  // ------------------------------------------------------------------ téléphone (appli Implants)
  const fakeGc = {
    you,
    get priv() {
      return priv;
    },
    pub,
    world,
    hud,
    modules: [ui, abilities],
    player: { pos: player },
    app: { net: { act: serverAct } },
    setUiOpen: (open: boolean) => console.log(`[labo] téléphone setUiOpen(${open})`),
    gesture: () => undefined,
    strategic: { show: () => undefined },
  } as unknown as GameClient;
  const phone = new Phone(fakeGc);
  overlay.appendChild(phone.el);

  // ------------------------------------------------------------------ boucle
  let last = performance.now();
  let hudAcc = 0;
  const frame = (tms: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (tms - last) / 1000);
    last = tms;
    const now = tms / 1000;
    mockAbilities(now);
    ui.update(dt, now);
    abilities.update(dt);
    phone.update(dt);
    hudAcc += dt;
    if (hudAcc > 0.1) {
      hudAcc = 0;
      hud.setWeapon(Weapon.PISTOL, 9, 36, false, priv.weapons);
      hud.setGrenades(priv.grenades, 'G');
    }
  };
  requestAnimationFrame(frame);
  // touche I : l'écran (comme en jeu)
  window.addEventListener('keydown', (e) => {
    if (!ui.isOpen && ui.onKey(e.code)) e.preventDefault();
  });

  const open = params.get('open');
  if (params.has('open')) ui.open(open || undefined);
  if (params.has('phone')) phone.show('cyber');

  (window as unknown as { __cyberLab: object }).__cyberLab = {
    ui,
    abilities,
    phone,
    hud,
    get priv() {
      return priv;
    },
    open: (focus?: string) => ui.open(focus),
    close: () => ui.close(),
    setStation: (key: string | null) => {
      station = key;
      pushPriv();
    },
    setMoney: (n: number) => {
      priv.money = n;
      pushPriv();
    },
    phoneApp: (app: string) => phone.show(app as 'cyber'),
    ready: true,
  };
}
