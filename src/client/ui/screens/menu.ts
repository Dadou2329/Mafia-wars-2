// Menu principal de MAFIA WARS : Dadou vs Even, et petits composants partagés par tous
// les écrans d'interface (typographie française, sons, boutons, boîtes de dialogue).

import type { AppApi } from '../../appApi';
import type { Slot } from '../../../shared/protocol';
import { saveSettings, settings } from '../../settings';
import { onWorldProgress } from '../../world/worldLoader';
import { h } from '../dom';

// ============================================================================ outils partagés

const NBSP = ' ';
const NNBSP = ' ';

/** Typographie française : espaces insécables avant « ; ! ? : % » et à l'intérieur des guillemets. */
export function fr(s: string): string {
  return s
    .replace(/ ([;!?])/g, `${NNBSP}$1`)
    .replace(/ ([:%»])/g, `${NBSP}$1`)
    .replace(/« /g, `«${NBSP}`);
}

/** « 42 % » */
export function pct(f: number): string {
  return `${Math.round(Math.max(0, Math.min(1, f)) * 100)}${NBSP}%`;
}

const BASE = import.meta.env.BASE_URL;

/**
 * Identité visuelle (fichiers servis depuis /public). On utilise les rendus PNG des SVG de
 * marque : les SVG contiennent de nombreux flous (filtres), que le navigateur recalculerait à
 * chaque nouveau tramage des zones qui les contiennent (survol d'une carte, changement d'état…).
 */
export const BRAND = {
  logo: `${BASE}brand/logo.png`,
  compact: `${BASE}brand/logo-compact.png`,
  emblem: { dadou: `${BASE}brand/emblem-dadou.png`, even: `${BASE}brand/emblem-even.png` } as Record<Slot, string>,
};

export const TITLE = `MAFIA WARS${NBSP}: Dadou vs Even`;

const ICONS = {
  gear: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mouse: '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 3v6.5"/>',
  hat: '<path d="M6.5 15.5V6.8c0-1 .8-1.8 1.8-1.8h7.4c1 0 1.8.8 1.8 1.8v8.7"/><path d="M6.5 12.5h11"/><path d="M2.5 16.5c4.5 2.2 14.5 2.2 19 0"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  exit: '<path d="M14 4H6v16h8"/><path d="M10.5 12H20M16.5 8.5L20 12l-3.5 3.5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h1M10.5 10h1M14.5 10h1M17.5 10h.5M7 14h10"/>',
  book: '<path d="M3.5 5.5c3-1.5 6-1.5 8.5.5v13c-2.5-2-5.5-2-8.5-.5z"/><path d="M20.5 5.5c-3-1.5-6-1.5-8.5.5v13c2.5-2 5.5-2 8.5-.5z"/>',
  chat: '<path d="M4 5h16v10.5H9.5L4 19.5z"/>',
  send: '<path d="M4 12L20 4l-5.5 16-3-6.5z"/><path d="M11.5 13.5L20 4"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c1.1-4 4-6 7.2-6s6.1 2 7.2 6"/>',
  crown: '<path d="M4 17.5L3 8l5 4 4-6.5 4 6.5 5-4-1 9.5z"/><path d="M4.5 20h15"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17v.5"/>',
  play: '<path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor"/>',
  pause: '<path d="M8.5 5v14M15.5 5v14"/>',
  trophy: '<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.5c0 3 1.3 4.5 3.3 4.8M16.5 6h3c0 3-1.3 4.5-3.3 4.8M12 13.5V17M8.5 20h7l-1-3h-5z"/>',
  flag: '<path d="M5.5 21V4M5.5 4.5h12l-2.5 4 2.5 4h-12"/>',
} as const;

export type IconName = keyof typeof ICONS;

/** Petite icône vectorielle (trait = couleur du texte). */
export function icon(name: IconName, cls = ''): HTMLElement {
  return h('span', {
    class: `mw-icon ${cls}`.trim(),
    'aria-hidden': 'true',
    html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`,
  });
}

let lastHover = 0;

/** Son de survol (limité pour ne pas crépiter quand la souris balaie un menu). */
export function hoverSound(app: AppApi): void {
  const t = performance.now();
  if (t - lastHover < 75) return;
  lastHover = t;
  app.audio.play('ui_hover');
}

/** Sons de survol et de clic sur un élément cliquable. */
export function withSounds<T extends HTMLElement>(app: AppApi, el: T, clickSound = true): T {
  el.addEventListener('pointerenter', () => {
    if (!(el as unknown as HTMLButtonElement).disabled) hoverSound(app);
  });
  el.addEventListener('focus', () => {
    if (el.matches(':focus-visible')) hoverSound(app);
  });
  if (clickSound) el.addEventListener('click', () => app.click());
  return el;
}

/** Bouton avec sons d'interface. */
export function button(
  app: AppApi,
  label: string | Node | (string | Node)[],
  cls: string,
  onClick: (e: MouseEvent) => void,
  attrs: Record<string, unknown> = {},
): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls, ...attrs }, label);
  withSounds(app, b);
  b.addEventListener('click', (e) => onClick(e));
  return b;
}

/**
 * Appelle `fn` quand l'élément quitte le document (écran remplacé). Sert à libérer les
 * écouteurs globaux et les minuteries des écrans qui n'ont pas de dispose().
 */
export function watchUnmount(el: HTMLElement, fn: () => void): () => void {
  let seen = false;
  let idle = 0;
  let done = false;
  const stop = (): void => {
    if (done) return;
    done = true;
    window.clearInterval(iv);
    fn();
  };
  const iv = window.setInterval(() => {
    if (el.isConnected) {
      seen = true;
      idle = 0;
      return;
    }
    if (seen || ++idle > 25) stop();
  }, 400);
  return stop;
}

/**
 * Garde les clics d'interface pour l'interface : un clic dans un menu ne doit jamais atteindre
 * l'écouteur « mousedown » des entrées de jeu (tir, capture du pointeur).
 * `withParent` protège aussi le conteneur dans lequel l'application place le panneau.
 */
export function shieldPointer(el: HTMLElement, withParent = false): void {
  const stop = (e: Event): void => e.stopPropagation();
  el.addEventListener('mousedown', stop);
  if (!withParent) return;
  requestAnimationFrame(() => {
    const p = el.parentElement;
    if (p && p.dataset.mwShield !== '1') {
      p.dataset.mwShield = '1';
      p.addEventListener('mousedown', stop);
    }
  });
}

/** Une partie est-elle en cours (la touche Échap appartient alors au jeu) ? */
export function inMatch(app: AppApi): boolean {
  const p = app.net.room?.phase;
  return p === 'playing' || p === 'ended';
}

/** Ferme un panneau avec Échap hors partie (en partie, Échap est géré par le jeu). */
export function closeOnEscape(app: AppApi, el: HTMLElement, close: () => void): void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape' || !el.isConnected || inMatch(app)) return;
    if (el.querySelector('.mw-modal')) return;
    e.preventDefault();
    close();
  };
  window.addEventListener('keydown', onKey);
  watchUnmount(el, () => window.removeEventListener('keydown', onKey));
}

/** Attend la connexion au serveur (au plus `ms` millisecondes). */
export function whenConnected(app: AppApi, ms = 8000): Promise<boolean> {
  if (app.net.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      off();
      resolve(false);
    }, ms);
    const off = app.net.on('connected', () => {
      window.clearTimeout(timer);
      off();
      resolve(true);
    });
  });
}

function focusables(box: HTMLElement): HTMLElement[] {
  return [...box.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]')].filter(
    (x) => x.offsetParent !== null,
  );
}

/**
 * Affiche une boîte modale au-dessus de `host`. Échap et un clic à côté appellent `onCancel`.
 * Renvoie la fonction qui ferme la boîte.
 */
export function openOverlay(app: AppApi, host: HTMLElement, box: HTMLElement, onCancel: () => void): () => void {
  const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const overlay = h('div', { class: 'mw-modal' }, box);
  let closed = false;
  const onKey = (e: KeyboardEvent): void => {
    if (closed) return;
    if (!overlay.isConnected) {
      cleanup();
      return;
    }
    if (e.code === 'Escape') {
      // la boîte passe avant le reste (panneau, jeu)
      e.preventDefault();
      e.stopImmediatePropagation();
      onCancel();
    } else if (e.code === 'Tab') {
      const f = focusables(box);
      if (!f.length) return;
      e.preventDefault();
      const i = f.indexOf(document.activeElement as HTMLElement);
      const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i < 0 || i === f.length - 1 ? 0 : i + 1;
      f[n].focus();
    }
  };
  const cleanup = (): void => {
    closed = true;
    window.removeEventListener('keydown', onKey, true);
  };
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) onCancel();
  });
  window.addEventListener('keydown', onKey, true);
  host.appendChild(overlay);
  app.audio.play('ui_open');
  return () => {
    if (closed) return;
    cleanup();
    overlay.classList.add('is-closing');
    window.setTimeout(() => overlay.remove(), 160);
    app.audio.play('ui_close');
    if (prev?.isConnected) prev.focus({ preventScroll: true });
  };
}

export interface Choice {
  label: string;
  value: string;
  cls?: string;
  disabled?: boolean;
  title?: string;
}

/** Boîte de choix (confirmation, conflit…). Résout avec la valeur du bouton choisi. */
export function choose(
  app: AppApi,
  host: HTMLElement,
  o: { title: string; text?: string; detail?: string | Node; choices: Choice[]; cancel?: string; focus?: string; icon?: IconName },
): Promise<string> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string): void => {
      if (done) return;
      done = true;
      close();
      resolve(v);
    };
    const btns = o.choices.map((c) => button(app, c.label, c.cls ?? 'btn', () => finish(c.value), { disabled: c.disabled, title: c.title }));
    const box = h(
      'div',
      { class: 'panel mw-modal-box', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': o.title },
      o.icon ? icon(o.icon, 'mw-modal-icon') : null,
      h('h2', { class: 'title-m' }, o.title),
      h('div', { class: 'divider' }),
      o.text ? h('p', { class: 'mw-modal-text' }, o.text) : null,
      o.detail ? h('div', { class: 'mw-modal-detail' }, o.detail) : null,
      h('div', { class: 'mw-modal-actions' }, btns),
    );
    const close = openOverlay(app, host, box, () => finish(o.cancel ?? 'cancel'));
    const idx = o.focus ? o.choices.findIndex((c) => c.value === o.focus) : -1;
    const target = idx >= 0 && !btns[idx].disabled ? btns[idx] : btns.find((b) => !b.disabled);
    target?.focus({ preventScroll: true });
  });
}

/** Couches d'ambiance du fond de menu : réverbères qui vacillent, brouillard qui dérive (opacité et translation seulement). */
export function ambience(withLamps = true): HTMLElement {
  return h(
    'div',
    { class: 'mw-ambient', 'aria-hidden': 'true' },
    withLamps
      ? h(
          'div',
          { class: 'mw-cover' },
          h('span', { class: 'mw-lamp mw-lamp--l' }),
          h('span', { class: 'mw-lamp mw-lamp--r' }),
        )
      : null,
    h('div', { class: 'mw-fog mw-fog--far' }),
    h('div', { class: 'mw-fog mw-fog--near' }),
    h('div', { class: 'mw-vignette' }),
  );
}

// ============================================================================ menu principal

export function mainMenu(app: AppApi): HTMLElement {
  const root = h('div', { class: 'screen backdrop mw-menu' });
  const inviteCode = (new URLSearchParams(location.search).get('code') ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

  // ------------------------------------------------------------ message (erreurs, attente)
  const msg = h('div', { class: 'mw-menu-msg', role: 'status', 'aria-live': 'polite' });
  let msgTimer = 0;
  const showMsg = (text: string, kind: 'info' | 'error'): void => {
    window.clearTimeout(msgTimer);
    msg.textContent = text;
    msg.dataset.kind = kind;
    msg.classList.toggle('is-visible', text !== '');
    if (kind === 'error' && text) msgTimer = window.setTimeout(() => msg.classList.remove('is-visible'), 9000);
  };

  // ------------------------------------------------------------ actions
  const navButtons: HTMLButtonElement[] = [];
  let busy = false;
  const setBusy = (b: boolean): void => {
    busy = b;
    root.classList.toggle('is-busy', b);
    for (const x of navButtons) x.disabled = b;
  };

  async function run(waitText: string, op: () => Promise<string | null>): Promise<string | null> {
    if (busy) return null;
    setBusy(true);
    showMsg(fr(waitText), 'info');
    if (!(await whenConnected(app, 9000))) {
      setBusy(false);
      const err = fr('Impossible de joindre le serveur de jeu. Vérifiez votre connexion, puis réessayez.');
      showMsg(err, 'error');
      return err;
    }
    const err = await op();
    if (!root.isConnected) return null; // le salon s'affiche
    setBusy(false);
    if (err) {
      showMsg(fr(err), 'error');
      app.audio.play('ui_error');
    } else showMsg('', 'info');
    return err;
  }

  const create = (): void => void run('Création de la partie…', () => app.createRoom());
  const quickPlay = (): void => {
    if (inviteCode) void run(`Connexion à la partie ${inviteCode}…`, () => app.joinRoom(inviteCode));
    else create();
  };

  // ------------------------------------------------------------ boutons
  const play = button(app, [icon('play', 'mw-play-icon'), 'Jouer'], 'btn big mw-play', quickPlay);
  const items: [string, () => void][] = [
    ['Créer une partie', create],
    ['Rejoindre une partie', () => openJoin()],
    ['', () => undefined],
    ['Paramètres', () => app.showSettings()],
    ['Commandes', () => app.showControls()],
    ['Comment jouer', () => app.showHelp()],
    ['Crédits', () => app.showCredits()],
  ];
  navButtons.push(play);
  const list = h('div', { class: 'mw-menu-items' });
  for (const [label, fn] of items) {
    if (!label) {
      list.appendChild(h('div', { class: 'divider mw-menu-sep', 'aria-hidden': 'true' }));
      continue;
    }
    const b = button(app, h('span', { class: 'mw-menu-item-label' }, label), 'mw-menu-item', fn);
    navButtons.push(b);
    list.appendChild(b);
  }

  const nav = h(
    'nav',
    { class: 'mw-menu-nav', 'aria-label': 'Menu principal' },
    h('div', { class: 'mw-play-wrap' }, play),
    inviteCode ? h('div', { class: 'mw-invite' }, fr(`Invitation reçue : partie ${inviteCode}`)) : null,
    list,
    msg,
  );

  const logo = h('img', { class: 'mw-menu-logo', src: BRAND.logo, alt: TITLE, draggable: false });
  const main = h('div', { class: 'mw-menu-main' }, h('h1', { class: 'mw-sr' }, TITLE), logo, nav);

  // ------------------------------------------------------------ nom du joueur + connexion
  const nameInput = h('input', {
    type: 'text',
    id: 'mw-player-name',
    class: 'mw-name-input',
    maxLength: 24,
    spellcheck: false,
    autocomplete: 'off',
    placeholder: 'Votre nom…',
  });
  nameInput.value = settings.name;
  const saved = h('span', { class: 'mw-name-saved' }, icon('check'), 'Enregistré');
  let nameTimer = 0;
  let savedTimer = 0;
  const commitName = (): void => {
    window.clearTimeout(nameTimer);
    const v = nameInput.value.trim().slice(0, 24) || 'Joueur';
    if (v === settings.name) return;
    settings.name = v;
    saveSettings();
    app.net.setName(v);
    saved.classList.add('is-visible');
    window.clearTimeout(savedTimer);
    savedTimer = window.setTimeout(() => saved.classList.remove('is-visible'), 1600);
  };
  nameInput.addEventListener('input', () => {
    window.clearTimeout(nameTimer);
    nameTimer = window.setTimeout(commitName, 600);
  });
  nameInput.addEventListener('blur', () => {
    commitName();
    nameInput.value = settings.name;
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
  });

  const statusText = h('span', { class: 'mw-status-text' });
  const status = h('div', { class: 'mw-status', role: 'status' }, h('span', { class: 'mw-dot' }), statusText);
  let lost = false;
  let slowTimer = 0;
  const renderStatus = (): void => {
    window.clearTimeout(slowTimer);
    if (app.net.connected) {
      status.dataset.state = 'ok';
      statusText.textContent = 'Connecté au serveur';
      return;
    }
    status.dataset.state = lost ? 'lost' : 'wait';
    statusText.textContent = lost ? fr('Connexion perdue — nouvelle tentative…') : 'Connexion au serveur…';
    slowTimer = window.setTimeout(() => {
      if (!app.net.connected) statusText.textContent = fr('Serveur injoignable — nouvelle tentative…');
    }, 7000);
  };
  const offs: (() => void)[] = [
    app.net.on('connected', () => {
      lost = false;
      renderStatus();
    }),
    app.net.on('disconnected', () => {
      lost = true;
      renderStatus();
    }),
  ];
  renderStatus();

  const profile = h(
    'div',
    { class: 'mw-profile' },
    h('label', { class: 'label', for: 'mw-player-name' }, 'Votre nom de joueur'),
    h('div', { class: 'mw-name-row' }, icon('user', 'mw-name-icon'), nameInput, saved),
    status,
  );

  // ------------------------------------------------------------ génération de Londres
  const genText = h('span', { class: 'mw-gen-text' });
  const genFill = h('span', { class: 'mw-gen-fill' });
  const gen = h('div', { class: 'mw-worldgen', role: 'status' }, genText, h('span', { class: 'mw-gen-bar' }, genFill));
  let genDone = false;
  const offGen = onWorldProgress((step, f) => {
    if (genDone) return;
    gen.title = step;
    genFill.style.width = `${Math.round(f * 100)}%`;
    if (f >= 1) {
      genDone = true;
      genText.textContent = 'Londres est prête';
      gen.classList.add('is-done');
    } else genText.textContent = fr(`Génération de Londres… ${pct(f)}`);
  });
  if (genDone) offGen();
  else offs.push(offGen);

  const footer = h(
    'footer',
    { class: 'mw-menu-footer' },
    h('span', { class: 'mw-footer-orn', 'aria-hidden': 'true' }),
    h('span', { class: 'mw-footer-text' }, 'Londres, 1888'),
    h('span', { class: 'mw-footer-orn', 'aria-hidden': 'true' }),
  );
  const corner = h('div', { class: 'mw-menu-corner' }, gen, h('div', { class: 'mw-version' }, 'Version 1.0'));

  root.append(ambience(), main, profile, corner, footer);

  // ------------------------------------------------------------ rejoindre une partie
  function openJoin(): void {
    if (busy || root.querySelector('.mw-modal')) return;
    const input = h('input', {
      type: 'text',
      class: 'code-input mw-code-input',
      maxLength: 4,
      spellcheck: false,
      autocomplete: 'off',
      autocapitalize: 'characters',
      placeholder: '····',
      'aria-label': 'Code de la partie',
    });
    input.value = inviteCode;
    const err = h('div', { class: 'mw-join-error', role: 'alert' });
    const go = button(app, 'Rejoindre', 'btn', () => void submit());
    const cancel = button(app, 'Annuler', 'btn ghost', () => close());
    const sync = (): void => {
      go.disabled = input.value.length !== 4 || pending;
    };
    let pending = false;
    input.addEventListener('input', () => {
      // un lien d'invitation collé : on garde son code
      const m = /[?&]code=([a-z]{4})/i.exec(input.value);
      const raw = m ? m[1] : input.value;
      input.value = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      err.textContent = '';
      sync();
    });
    input.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text') ?? '';
      const m = /[?&]code=([a-z]{4})/i.exec(text);
      if (m) {
        e.preventDefault();
        input.value = m[1].toUpperCase();
        sync();
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void submit();
      }
    });
    async function submit(): Promise<void> {
      if (pending) return;
      if (input.value.length !== 4) {
        err.textContent = fr('Le code compte 4 lettres.');
        app.audio.play('ui_error');
        return;
      }
      pending = true;
      sync();
      go.textContent = 'Connexion…';
      err.textContent = '';
      if (!(await whenConnected(app, 9000))) {
        pending = false;
        go.textContent = 'Rejoindre';
        sync();
        err.textContent = fr('Impossible de joindre le serveur de jeu. Réessayez dans un instant.');
        app.audio.play('ui_error');
        return;
      }
      const e = await app.joinRoom(input.value);
      if (!root.isConnected) return; // le salon s'affiche
      pending = false;
      go.textContent = 'Rejoindre';
      sync();
      if (e) {
        err.textContent = fr(e);
        app.audio.play('ui_error');
        input.select();
      } else close();
    }
    const box = h(
      'div',
      { class: 'panel mw-modal-box mw-join', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Rejoindre une partie' },
      h('h2', { class: 'title-l' }, 'Rejoindre une partie'),
      h('div', { class: 'divider' }),
      h('p', { class: 'mw-modal-text' }, fr('Saisissez le code de 4 lettres que votre adversaire vous a transmis.')),
      h('div', { class: 'mw-code-plate' }, input),
      err,
      h('div', { class: 'mw-modal-actions' }, cancel, go),
      h('p', { class: 'mw-join-hint dim' }, fr('Astuce : vous pouvez aussi coller le lien d’invitation.')),
    );
    const close = openOverlay(app, root, box, () => close());
    sync();
    input.focus();
    input.select();
  }

  // ------------------------------------------------------------ clavier : flèches dans le menu
  const onKey = (e: KeyboardEvent): void => {
    if (!root.isConnected || root.querySelector('.mw-modal')) return;
    if (e.target instanceof HTMLInputElement) return;
    if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return;
    const enabled = navButtons.filter((b) => !b.disabled);
    if (!enabled.length) return;
    e.preventDefault();
    const i = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const n = i < 0 ? (e.code === 'ArrowDown' ? 0 : enabled.length - 1) : (i + (e.code === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
    enabled[n].focus();
  };
  window.addEventListener('keydown', onKey);

  shieldPointer(root);
  watchUnmount(root, () => {
    window.removeEventListener('keydown', onKey);
    window.clearTimeout(slowTimer);
    window.clearTimeout(msgTimer);
    for (const off of offs) off();
  });
  return root;
}
