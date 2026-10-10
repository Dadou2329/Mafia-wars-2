// Salon d'avant-partie : choix des parrains, préparation, réglages de la partie, discussion.

import type { AppApi } from '../../appApi';
import type { Net } from '../../net/net';
import type { MatchSettings, RoomState, Slot } from '../../../shared/protocol';
import { BOSS_NAME, MAFIA_NAME } from '../../../shared/constants';
import { onWorldProgress } from '../../world/worldLoader';
import { clear, h } from '../dom';
import { BRAND, TITLE, ambience, button, choose, fr, icon, pct, shieldPointer, withSounds } from './menu';
import { currentPortraits } from './settings';

const SLOTS: Slot[] = ['dadou', 'even'];

const BOSS_INFO: Record<Slot, { desc: string; hq: string }> = {
  dadou: { desc: 'Le flamboyant parrain de Soho. Manteau noir, melon et moustache en guidon.', hq: 'Le Lion Rouge, Soho' },
  even: { desc: 'L’élégant parrain des Docks. Redingote bleu marine, haut-de-forme et monocle.', hq: 'L’Ancre Bleue, les Docks' },
};

const TIME_LIMITS = [0, 20, 30, 45, 60, 90];
const timeLabel = (m: number): string => (m === 0 ? 'Illimitée' : `${m} min`);
const DAYTIMES: MatchSettings['daytime'][] = ['cycle', 'night', 'dusk'];
const DAYTIME_LABEL: Record<MatchSettings['daytime'], string> = {
  cycle: 'Cycle jour/nuit',
  night: 'Nuit permanente',
  dusk: 'Crépuscule permanent',
};

// ============================================================================ journal du salon
// Conservé au niveau du module (un par connexion) pour que la discussion survive à un passage
// par les paramètres ou les commandes, qui remplacent momentanément l'écran du salon.

interface Line {
  kind: 'chat' | 'system';
  text: string;
  name?: string;
  slot?: Slot | null;
  mine?: boolean;
}

interface Journal {
  code: string;
  lines: Line[];
  prev: RoomState | null;
  listeners: Set<() => void>;
}

const journals = new WeakMap<Net, Journal>();

function journal(net: Net): Journal {
  const existing = journals.get(net);
  if (existing) return existing;
  const j: Journal = { code: '', lines: [], prev: null, listeners: new Set() };
  journals.set(net, j);
  const push = (l: Line): void => {
    j.lines.push(l);
    if (j.lines.length > 120) j.lines.splice(0, j.lines.length - 120);
  };
  const notify = (): void => {
    for (const fn of j.listeners) fn();
  };
  const onRoom = (s: RoomState): void => {
    if (s.code !== j.code) {
      j.code = s.code;
      j.lines = [];
      j.prev = null;
    }
    const changes = describeChanges(j.prev, s, net.token);
    j.prev = s;
    for (const t of changes) push({ kind: 'system', text: t });
    if (changes.length) notify();
  };
  net.on('room', onRoom);
  net.on('lobby:chat', (m: { from: string; text: string }) => {
    const r = net.room;
    let slot: Slot | null = null;
    let name = String(m.from ?? '');
    let mine = false;
    if (m.from === 'dadou' || m.from === 'even') {
      slot = m.from;
      const id = r?.picks[slot] ?? null;
      name = (id && r?.players[id]?.name) || BOSS_NAME[slot];
      mine = id === net.token;
    } else if (r) {
      mine = r.players[net.token]?.name === name;
    }
    push({ kind: 'chat', text: String(m.text ?? ''), name, slot, mine });
    notify();
  });
  if (net.room) onRoom(net.room);
  return j;
}

function describeChanges(prev: RoomState | null, s: RoomState, me: string): string[] {
  const out: string[] = [];
  const name = (id: string, st: RoomState = s): string => st.players[id]?.name ?? 'Un joueur';
  if (!prev) {
    const others = Object.keys(s.players).filter((id) => id !== me);
    if (s.host === me && others.length === 0) out.push(`Salon ${s.code} ouvert. Envoyez le lien d’invitation à votre adversaire !`);
    else if (s.host && s.host !== me) out.push(`Vous avez rejoint le salon de ${name(s.host)}.`);
    else out.push(`Vous avez rejoint le salon ${s.code}.`);
    return out;
  }
  if (s.phase !== 'lobby' || prev.phase !== 'lobby') return out;
  for (const id of Object.keys(s.players)) if (!prev.players[id] && id !== me) out.push(`${name(id)} a rejoint le salon.`);
  for (const id of Object.keys(prev.players)) if (!s.players[id] && id !== me) out.push(`${name(id, prev)} a quitté le salon.`);
  for (const id of Object.keys(s.players)) {
    const a = prev.players[id];
    const b = s.players[id];
    if (!a || id === me) continue;
    if (a.name !== b.name) out.push(`${a.name} s’appelle désormais ${b.name}.`);
    if (a.connected && !b.connected) out.push(`${b.name} s’est déconnecté.`);
    if (!a.connected && b.connected) out.push(`${b.name} est de retour.`);
  }
  for (const slot of SLOTS) {
    const now = s.picks[slot];
    if (now && now !== prev.picks[slot]) out.push(now === me ? `Vous incarnerez ${BOSS_NAME[slot]}.` : `${name(now)} incarnera ${BOSS_NAME[slot]}.`);
  }
  for (const id of Object.keys(s.players)) {
    const a = prev.players[id];
    const b = s.players[id];
    if (a && !a.ready && b.ready) out.push(id === me ? 'Vous êtes prêt.' : `${b.name} est prêt !`);
  }
  const ps = prev.settings;
  const ns = s.settings;
  if (ps.timeLimit !== ns.timeLimit) out.push(`Durée de la partie : ${timeLabel(ns.timeLimit).toLowerCase()}.`);
  if (ps.daytime !== ns.daytime) out.push(`Heure : ${DAYTIME_LABEL[ns.daytime].toLowerCase()}.`);
  if (ps.tutorial !== ns.tutorial) out.push(ns.tutorial ? 'Mission d’introduction activée.' : 'Mission d’introduction désactivée.');
  return out;
}

/** Lien d'invitation (on garde un éventuel ?server=…). */
function inviteLink(code: string): string {
  const params = new URLSearchParams();
  const server = new URLSearchParams(location.search).get('server');
  if (server) params.set('server', server);
  params.set('code', code);
  return `${location.origin}${location.pathname}?${params.toString()}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* repli ci-dessous */
  }
  const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0;opacity:0', readOnly: true });
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

// ============================================================================ écran

interface Card {
  root: HTMLElement;
  portrait: HTMLImageElement;
  state: HTMLElement;
  stamp: HTMLElement;
  pick: HTMLButtonElement;
  change: HTMLButtonElement;
}

export function lobbyScreen(app: AppApi): { el: HTMLElement; dispose(): void } {
  const net = app.net;
  const me = (): string => net.token;
  const offs: (() => void)[] = [];
  const timers = new Set<number>();
  let disposed = false;
  const later = (fn: () => void, ms: number): void => {
    const t = window.setTimeout(() => {
      timers.delete(t);
      if (!disposed) fn();
    }, ms);
    timers.add(t);
  };

  const root = h('div', { class: 'screen backdrop mw-lobby' });

  // ------------------------------------------------------------ en-tête : logo, titre, code
  const codeValue = h('div', { class: 'mw-code-value', title: 'Code du salon' }, '····');
  const copyMsg = h('span', { class: 'mw-copy-msg', role: 'status' });
  const copyBtn = button(app, [icon('link'), 'Copier le lien d’invitation'], 'btn small ghost mw-copy', () => void copyInvite());
  const header = h(
    'header',
    { class: 'mw-lobby-head' },
    h('img', { class: 'mw-lobby-logo', src: BRAND.compact, alt: TITLE, draggable: false }),
    h(
      'div',
      { class: 'mw-lobby-title' },
      h('h1', { class: 'title-l' }, 'Choisissez votre parrain'),
      h('p', { class: 'mw-lobby-sub' }, fr('Chaque joueur incarne un parrain. La partie commence dès que les deux sont prêts.')),
    ),
    h('div', { class: 'mw-code' }, h('div', { class: 'label' }, 'Code du salon'), codeValue, h('div', { class: 'mw-copy-row' }, copyBtn, copyMsg)),
  );

  async function copyInvite(): Promise<void> {
    const code = net.room?.code;
    if (!code) return;
    const link = inviteLink(code);
    if (await copyText(link)) {
      copyMsg.textContent = fr('Lien copié !');
      copyMsg.classList.add('is-visible');
      later(() => copyMsg.classList.remove('is-visible'), 2200);
      return;
    }
    // presse-papiers indisponible (page non sécurisée) : on affiche le lien à copier à la main
    const field = h('input', { type: 'text', class: 'mw-link-field', readOnly: true, spellcheck: false });
    field.value = link;
    void choose(app, root, {
      title: 'Lien d’invitation',
      text: fr('Copiez ce lien (Ctrl+C) et envoyez-le à votre adversaire :'),
      detail: field,
      choices: [{ label: 'Fermer', value: 'ok', cls: 'btn' }],
    });
    window.setTimeout(() => {
      field.focus();
      field.select();
    }, 30);
  }

  // ------------------------------------------------------------ cartes des parrains
  const cards = {} as Record<Slot, Card>;
  const makeCard = (slot: Slot): Card => {
    const portrait = h('img', { class: 'mw-card-portrait is-emblem', src: BRAND.emblem[slot], alt: `Portrait de ${BOSS_NAME[slot]}`, draggable: false });
    const stamp = h('div', { class: 'mw-card-stamp', 'aria-hidden': 'true' }, h('span', null, fr('Prêt !')));
    const state = h('div', { class: 'mw-card-state' });
    const pick = button(app, `Jouer ${BOSS_NAME[slot]}`, `btn ${slot} mw-card-pick`, () => net.pick(slot));
    const change = button(app, 'Changer', 'btn ghost mw-card-change hidden', () => net.pick(null), { title: 'Libérer ce parrain' });
    const art = h(
      'div',
      { class: 'mw-card-art' },
      h('img', { class: 'mw-card-watermark', src: BRAND.emblem[slot], alt: '', 'aria-hidden': 'true', draggable: false }),
      h('div', { class: 'mw-card-light', 'aria-hidden': 'true' }),
      portrait,
      stamp,
    );
    const el = h(
      'article',
      { class: `mw-card mw-card--${slot}`, 'aria-label': BOSS_NAME[slot] },
      art,
      h(
        'div',
        { class: 'mw-card-body' },
        h('img', { class: 'mw-card-seal', src: BRAND.emblem[slot], alt: '', 'aria-hidden': 'true', draggable: false }),
        h('h2', { class: 'mw-card-name' }, BOSS_NAME[slot]),
        h('div', { class: 'mw-card-mafia' }, MAFIA_NAME[slot]),
        h('p', { class: 'mw-card-desc' }, fr(BOSS_INFO[slot].desc)),
        h('div', { class: 'mw-card-hq' }, icon('flag'), h('span', null, fr(`QG : ${BOSS_INFO[slot].hq}`))),
        state,
        h('div', { class: 'mw-card-actions' }, pick, change),
      ),
    );
    // toute l'illustration est cliquable quand le parrain est libre
    art.addEventListener('click', () => {
      if (el.dataset.state === 'free' && !pick.disabled) pick.click();
    });
    withSounds(app, art, false);
    return { root: el, portrait, state, stamp, pick, change };
  };
  for (const s of SLOTS) cards[s] = makeCard(s);
  void currentPortraits(app).then((p) => {
    if (disposed) return;
    for (const s of SLOTS) {
      if (!p[s]) continue;
      const img = cards[s].portrait;
      img.src = p[s];
      img.classList.remove('is-emblem');
      img.classList.add('is-portrait');
    }
  });
  const vs = h('div', { class: 'mw-vs', 'aria-hidden': 'true' }, h('span', null, 'VS'));
  const cardsBox = h('section', { class: 'mw-lobby-cards', 'aria-label': 'Choix du parrain' }, cards.dadou.root, vs, cards.even.root);

  // ------------------------------------------------------------ joueurs
  const playersList = h('div', { class: 'mw-players' });
  const playersBox = h('section', { class: 'panel mw-side-box' }, h('h3', { class: 'title-s' }, 'Joueurs'), playersList);

  // ------------------------------------------------------------ réglages de la partie
  const stepper = (label: string, onStep: (d: number) => void): { el: HTMLElement; value: HTMLElement; btns: HTMLButtonElement[] } => {
    const value = h('span', { class: 'mw-stepper-value', 'aria-live': 'polite' });
    const prev = button(app, h('span', { class: 'mw-chev mw-chev--l' }), 'mw-step', () => onStep(-1), { 'aria-label': `${label} : valeur précédente` });
    const next = button(app, h('span', { class: 'mw-chev mw-chev--r' }), 'mw-step', () => onStep(1), { 'aria-label': `${label} : valeur suivante` });
    const el = h('div', { class: 'mw-setting' }, h('span', { class: 'mw-setting-label' }, label), h('div', { class: 'mw-stepper' }, prev, value, next));
    return { el, value, btns: [prev, next] };
  };
  const dur = stepper('Durée de la partie', (d) => {
    const r = net.room;
    if (!r || !isHost()) return;
    const i = Math.max(0, TIME_LIMITS.indexOf(r.settings.timeLimit));
    const v = TIME_LIMITS[(i + d + TIME_LIMITS.length) % TIME_LIMITS.length];
    dur.value.textContent = timeLabel(v);
    net.setMatchSettings({ timeLimit: v });
  });
  const day = stepper('Heure', (d) => {
    const r = net.room;
    if (!r || !isHost()) return;
    const i = Math.max(0, DAYTIMES.indexOf(r.settings.daytime));
    const v = DAYTIMES[(i + d + DAYTIMES.length) % DAYTIMES.length];
    day.value.textContent = DAYTIME_LABEL[v];
    net.setMatchSettings({ daytime: v });
  });
  const tutoInput = h('input', { type: 'checkbox' });
  const tutoText = h('span', { class: 'mw-toggle-text' });
  tutoInput.addEventListener('change', () => {
    if (!isHost()) return;
    app.click();
    tutoText.textContent = tutoInput.checked ? 'Activée' : 'Désactivée';
    net.setMatchSettings({ tutorial: tutoInput.checked });
  });
  const tutoToggle = h('label', { class: 'toggle mw-setting-toggle' }, tutoInput, h('span', { class: 'knob' }), tutoText);
  withSounds(app, tutoToggle, false);
  const tuto = h('div', { class: 'mw-setting' }, h('span', { class: 'mw-setting-label' }, 'Mission d’introduction'), tutoToggle);
  const settingsNote = h('p', { class: 'mw-setting-note' });
  const settingsBox = h(
    'section',
    { class: 'panel mw-side-box mw-match-settings' },
    h('h3', { class: 'title-s' }, 'Réglages de la partie'),
    dur.el,
    day.el,
    tuto,
    settingsNote,
  );

  // ------------------------------------------------------------ discussion
  const j = journal(net);
  const log = h('div', { class: 'mw-chat-log scroll', role: 'log', 'aria-live': 'polite' });
  const chatInput = h('input', { type: 'text', class: 'mw-chat-input', maxLength: 200, placeholder: 'Écrire un message…', 'aria-label': 'Message', autocomplete: 'off' });
  const sendChat = (): void => {
    const t = chatInput.value.trim();
    if (!t) return;
    net.chat(t);
    chatInput.value = '';
    chatInput.focus();
  };
  const sendBtn = button(app, icon('send'), 'btn small mw-chat-send', sendChat, { title: 'Envoyer', 'aria-label': 'Envoyer' });
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendChat();
    }
  });
  const chatBox = h(
    'section',
    { class: 'panel mw-side-box mw-chat' },
    h('h3', { class: 'title-s' }, 'Discussion'),
    log,
    h('div', { class: 'mw-chat-form' }, chatInput, sendBtn),
  );
  let shown = 0;
  const renderChat = (): void => {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    if (j.lines.length < shown) {
      clear(log);
      shown = 0;
    }
    for (const l of j.lines.slice(shown)) {
      if (l.kind === 'system') log.appendChild(h('div', { class: 'mw-chat-line is-system' }, fr(l.text)));
      else
        log.appendChild(
          h(
            'div',
            { class: `mw-chat-line${l.mine ? ' is-mine' : ''}` },
            h('span', { class: `mw-chat-from${l.slot ? ` c-${l.slot}` : ''}` }, l.name ?? ''),
            h('span', { class: 'mw-chat-text' }, l.text),
          ),
        );
    }
    while (log.childElementCount > 120) log.firstElementChild?.remove();
    shown = j.lines.length;
    if (atBottom || shown <= 3) log.scrollTop = log.scrollHeight;
  };
  const onJournal = (): void => {
    if (!disposed) renderChat();
  };
  j.listeners.add(onJournal);
  offs.push(() => j.listeners.delete(onJournal));

  const side = h('aside', { class: 'mw-lobby-side' }, playersBox, settingsBox, chatBox);

  // ------------------------------------------------------------ pied : quitter, prêt, état
  const leave = button(app, [icon('exit'), 'Quitter le salon'], 'btn ghost small mw-foot-btn', () => app.leaveRoom());
  const toSettings = button(app, [icon('gear'), 'Paramètres'], 'btn ghost small mw-foot-btn', () => app.showSettings());
  const toControls = button(app, [icon('keyboard'), 'Commandes'], 'btn ghost small mw-foot-btn', () => app.showControls());
  const statusMain = h('div', { class: 'mw-lobby-status', role: 'status', 'aria-live': 'polite' });
  const genLine = h('div', { class: 'mw-lobby-gen' });
  const readyBtn = button(app, 'Je suis prêt !', 'btn big mw-ready hidden', () => {
    const r = net.room;
    if (!r) return;
    net.setReady(!r.players[me()]?.ready);
  });
  const footer = h(
    'footer',
    { class: 'mw-lobby-foot' },
    h('div', { class: 'mw-foot-left' }, leave, toSettings, toControls),
    h('div', { class: 'mw-foot-center' }, statusMain, genLine),
    h('div', { class: 'mw-foot-right' }, readyBtn),
  );

  const body = h('main', { class: 'mw-lobby-body' }, cardsBox, side);
  const banner = h('div', { class: 'mw-lobby-banner', role: 'alert' }, icon('alert'), fr('Connexion au serveur perdue. Reconnexion en cours…'));
  const startTitle = h('div', { class: 'title-l' }, 'La partie commence…');
  const starting = h(
    'div',
    { class: 'mw-lobby-starting', 'aria-hidden': 'true' },
    h(
      'div',
      { class: 'mw-starting-inner' },
      h('img', { src: BRAND.emblem.dadou, alt: '' }),
      h('div', { class: 'mw-starting-text' }, startTitle, h('div', { class: 'mw-spinner' })),
      h('img', { src: BRAND.emblem.even, alt: '' }),
    ),
  );
  root.append(ambience(false), header, body, footer, banner, starting);

  // ------------------------------------------------------------ rendu
  const isHost = (): boolean => net.room?.host === me();

  function renderPlayers(r: RoomState): void {
    clear(playersList);
    const ids = Object.keys(r.players).sort((a, b) => (a === me() ? -1 : b === me() ? 1 : 0));
    for (const id of ids) {
      const p = r.players[id];
      const slot: Slot | null = r.picks.dadou === id ? 'dadou' : r.picks.even === id ? 'even' : null;
      const state = !p.connected ? 'Déconnecté' : p.ready ? fr('Prêt !') : slot ? 'Pas prêt' : 'Sans parrain';
      const who = slot ? `${p.name} incarne ${BOSS_NAME[slot]}` : p.name;
      playersList.appendChild(
        h(
          'div',
          { class: `mw-player${p.ready ? ' is-ready' : ''}${p.connected ? '' : ' is-off'}`, 'data-slot': slot ?? 'none', title: who },
          slot ? h('img', { class: 'mw-player-emblem', src: BRAND.emblem[slot], alt: BOSS_NAME[slot] }) : h('span', { class: 'mw-player-dot', title: p.connected ? 'Connecté' : 'Déconnecté' }),
          h(
            'div',
            { class: 'mw-player-name' },
            h('span', { class: 'mw-player-nm' }, p.name),
            id === me() ? h('span', { class: 'mw-you' }, '(vous)') : null,
            p.isHost ? h('span', { class: 'mw-badge', title: 'Hôte de la partie' }, icon('crown'), 'Hôte') : null,
          ),
          h('span', { class: 'mw-player-state' }, p.ready ? icon('check') : null, state),
        ),
      );
    }
    if (ids.length < 2) {
      playersList.appendChild(
        h(
          'div',
          { class: 'mw-player is-waiting' },
          h('span', { class: 'mw-player-dot' }),
          h('div', { class: 'mw-player-name dim' }, fr('En attente d’un adversaire…')),
          h('span', { class: 'mw-player-state' }, fr(`Code : ${r.code}`)),
        ),
      );
    }
  }

  function renderSettings(r: RoomState): void {
    const host = isHost();
    settingsBox.classList.toggle('is-readonly', !host);
    dur.value.textContent = timeLabel(r.settings.timeLimit);
    day.value.textContent = DAYTIME_LABEL[r.settings.daytime] ?? r.settings.daytime;
    for (const b of [...dur.btns, ...day.btns]) b.disabled = !host || r.phase !== 'lobby';
    tutoInput.checked = r.settings.tutorial;
    tutoInput.disabled = !host || r.phase !== 'lobby';
    tutoText.textContent = r.settings.tutorial ? 'Activée' : 'Désactivée';
    const hostName = r.host ? r.players[r.host]?.name : null;
    settingsNote.textContent = host
      ? fr('Modifier un réglage annule l’état « prêt » des deux joueurs.')
      : fr(`Seul l’hôte${hostName ? ` (${hostName})` : ''} peut modifier ces réglages.`);
  }

  function updateCard(slot: Slot, r: RoomState): void {
    const c = cards[slot];
    const id = r.picks[slot];
    const holder = id ? r.players[id] : undefined;
    const mine = id === me();
    const taken = !!holder && !mine;
    c.root.dataset.state = mine ? 'mine' : taken ? 'taken' : 'free';
    c.state.textContent = mine ? fr('C’est vous !') : taken ? `Choisi par ${holder.name}${holder.connected ? '' : ' (déconnecté)'}` : 'Libre';
    c.pick.classList.toggle('hidden', mine);
    c.pick.disabled = taken || r.phase !== 'lobby';
    c.pick.textContent = taken ? 'Indisponible' : `Jouer ${BOSS_NAME[slot]}`;
    c.change.classList.toggle('hidden', !mine);
    c.change.disabled = r.phase !== 'lobby';
    c.stamp.classList.toggle('is-visible', !!holder?.ready);
  }

  function statusText(r: RoomState): string {
    if (r.phase === 'playing') return 'La partie commence…';
    if (r.phase === 'ended') return 'La partie est terminée.';
    const mine = r.players[me()];
    const mySlot: Slot | null = r.picks.dadou === me() ? 'dadou' : r.picks.even === me() ? 'even' : null;
    const other = Object.entries(r.players).find(([id]) => id !== me());
    if (!other) return 'En attente d’un adversaire… Envoyez-lui le lien d’invitation.';
    const [oid, o] = other;
    const oSlot = r.picks.dadou === oid ? 'dadou' : r.picks.even === oid ? 'even' : null;
    if (!o.connected) return `${o.name} s’est déconnecté. En attente de son retour…`;
    if (!mySlot) return oSlot ? `${o.name} a choisi ${BOSS_NAME[oSlot]}. À vous de choisir votre parrain !` : 'Choisissez votre parrain.';
    if (!mine?.ready) return o.ready ? `${o.name} est prêt ! Confirmez pour lancer la partie.` : 'Cliquez sur « Je suis prêt ! » quand vous êtes prêt.';
    if (!oSlot) return `En attente : ${o.name} choisit son parrain…`;
    if (!o.ready) return `En attente de ${o.name}…`;
    return 'Les deux parrains sont prêts !';
  }

  function render(): void {
    if (disposed) return;
    const r = net.room;
    root.classList.toggle('is-empty', !r);
    if (!r) {
      statusMain.textContent = 'Connexion au salon…';
      return;
    }
    codeValue.textContent = r.code;
    for (const s of SLOTS) updateCard(s, r);
    renderPlayers(r);
    renderSettings(r);
    const mineP = r.players[me()];
    const mySlot = r.picks.dadou === me() || r.picks.even === me();
    readyBtn.classList.toggle('hidden', !mySlot || r.phase !== 'lobby');
    readyBtn.textContent = mineP?.ready ? 'Annuler' : fr('Je suis prêt !');
    readyBtn.classList.toggle('ghost', !!mineP?.ready);
    readyBtn.classList.toggle('is-armed', !mineP?.ready);
    readyBtn.title = mineP?.ready ? 'Je ne suis plus prêt' : '';
    statusMain.textContent = fr(statusText(r));
    root.dataset.phase = r.phase;
    startTitle.textContent = r.phase === 'ended' ? 'La partie est terminée.' : 'La partie commence…';
    starting.setAttribute('aria-hidden', r.phase === 'lobby' ? 'true' : 'false');
  }

  offs.push(net.on('room', () => render()));

  // ------------------------------------------------------------ connexion
  offs.push(
    net.on('disconnected', () => banner.classList.add('is-visible')),
    net.on('connected', (room: string | null) => {
      banner.classList.remove('is-visible');
      if (!room && !disposed) {
        // le serveur a redémarré : le salon n'existe plus
        void choose(app, root, {
          title: 'Salon introuvable',
          text: fr('Ce salon n’existe plus : le serveur a sans doute redémarré.'),
          choices: [{ label: 'Retour au menu', value: 'menu', cls: 'btn' }],
          cancel: 'menu',
        }).then(() => {
          if (!disposed) app.leaveRoom();
        });
      }
    }),
  );
  if (!net.connected) banner.classList.add('is-visible');

  // ------------------------------------------------------------ génération de Londres
  let genDone = false;
  const offGen = onWorldProgress((_step, f) => {
    if (genDone) return;
    if (f >= 1) {
      genDone = true;
      genLine.textContent = '';
      genLine.classList.remove('is-visible');
    } else {
      genLine.textContent = fr(`Génération de Londres… ${pct(f)}`);
      genLine.classList.add('is-visible');
    }
  });
  if (genDone) offGen();
  else offs.push(offGen);

  shieldPointer(root);
  render();
  renderChat();

  return {
    el: root,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const off of offs) off();
      for (const t of timers) window.clearTimeout(t);
      timers.clear();
    },
  };
}
