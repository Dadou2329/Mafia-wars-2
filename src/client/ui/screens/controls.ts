// Commandes : modification des touches (clavier, souris, molette), touches secondaires,
// détection des conflits et retour aux touches par défaut.

import type { AppApi } from '../../appApi';
import { ACTIONS, RESERVED, conflicts, defaultBindings, keyLabel, learnKey, type ActionDef, type ActionId } from '../../input/bindings';
import { saveSettings, settings } from '../../settings';
import { clear, h } from '../dom';
import { button, choose, closeOnEscape, fr, icon, shieldPointer, watchUnmount } from './menu';

const GROUPS: { group: ActionDef['group']; col: number }[] = [
  { group: 'Déplacements', col: 0 },
  { group: 'Combat', col: 1 },
  { group: 'Commandement', col: 0 },
  { group: 'Interface', col: 1 },
];
const SLOTS = 2;
const DEFAULTS = defaultBindings();
const labelOf = (id: ActionId): string => ACTIONS.find((a) => a.id === id)?.label ?? id;

export function controlsPanel(app: AppApi, opts: { onClose(): void }): HTMLElement {
  const list = h('div', { class: 'mw-binds scroll' });
  const flash = h('div', { class: 'mw-bind-flash', role: 'status', 'aria-live': 'polite' });
  const cancelBtn = button(app, 'Annuler', 'btn small ghost mw-capture-cancel', () => cancelCapture());
  const captureBar = h(
    'div',
    { class: 'mw-capture-bar' },
    h('span', { class: 'mw-capture-pulse', 'aria-hidden': 'true' }),
    h('span', { class: 'mw-capture-text' }, fr('Appuyez sur une touche, un bouton de la souris ou tournez la molette… (Échap pour annuler)')),
    cancelBtn,
  );
  const panel = h(
    'div',
    { class: 'panel mw-dialog mw-controls fade-in', role: 'dialog', 'aria-label': 'Commandes' },
    h(
      'header',
      { class: 'mw-dialog-head' },
      icon('keyboard', 'mw-head-icon'),
      h('h2', { class: 'title-l' }, 'Commandes'),
      h('p', { class: 'mw-dialog-sub' }, fr('Cliquez sur une touche pour la modifier. Le bouton « + » ajoute une touche secondaire.')),
    ),
    h(
      'div',
      { class: 'mw-tip' },
      icon('info'),
      h('span', null, fr('Les touches suivent la position physique : sur un clavier AZERTY, « Avancer » est sur Z.')),
    ),
    list,
    captureBar,
    flash,
  );

  // ------------------------------------------------------------ messages
  let flashTimer = 0;
  const showFlash = (text: string, kind: 'good' | 'bad' | 'info'): void => {
    window.clearTimeout(flashTimer);
    flash.textContent = fr(text);
    flash.dataset.kind = kind;
    flash.classList.add('is-visible');
    flashTimer = window.setTimeout(() => flash.classList.remove('is-visible'), 3200);
  };

  // ------------------------------------------------------------ rendu
  let capture: { id: ActionId; slot: number } | null = null;

  function slotEl(a: ActionDef, i: number, codes: string[]): HTMLElement {
    const code = codes[i];
    const waiting = capture?.id === a.id && capture.slot === i;
    const wrap = h('div', { class: `mw-bind-slot${waiting ? ' is-capturing' : ''}${code ? '' : ' is-empty'}`, 'data-slot': String(i) });
    if (i > 0 && !codes[0] && !waiting) {
      wrap.classList.add('is-void');
      return wrap;
    }
    const content = waiting
      ? h('span', { class: 'mw-bind-wait' }, 'Appuyez…')
      : code
        ? h('span', { class: 'keycap' }, keyLabel(code))
        : i === 0
          ? h('span', { class: 'mw-bind-none' }, 'Aucune')
          : h('span', { class: 'mw-bind-add' }, '+');
    const title = code
      ? `${a.label} : ${keyLabel(code)} — cliquez pour changer`
      : i === 0
        ? `${a.label} : aucune touche — cliquez pour en choisir une`
        : `${a.label} : ajouter une touche secondaire`;
    wrap.appendChild(button(app, content, 'mw-bind-key', () => startCapture(a.id, Math.min(i, codes.length)), { title: fr(title), 'aria-label': fr(title) }));
    if (code && !waiting) {
      wrap.appendChild(
        button(app, icon('close'), 'mw-bind-clear', () => clearSlot(a.id, i), {
          title: 'Effacer cette touche',
          'aria-label': `Effacer la touche ${keyLabel(code)} de « ${a.label} »`,
        }),
      );
    }
    return wrap;
  }

  function render(focus?: { id: ActionId; slot: number }): void {
    const scroll = list.scrollTop;
    clear(list);
    const cols = [h('div', { class: 'mw-binds-col' }), h('div', { class: 'mw-binds-col' })];
    for (const g of GROUPS) {
      const sec = h('section', { class: 'mw-bind-group' }, h('h3', { class: 'title-s' }, g.group));
      for (const a of ACTIONS) {
        if (a.group !== g.group) continue;
        const codes = settings.bindings[a.id] ?? [];
        const modified = codes.join(',') !== DEFAULTS[a.id].join(',');
        const slots = h('div', { class: 'mw-bind-slots' });
        for (let i = 0; i < SLOTS; i++) slots.appendChild(slotEl(a, i, codes));
        sec.appendChild(
          h(
            'div',
            { class: `mw-bind-row${codes.length ? '' : ' is-unbound'}`, 'data-action': a.id },
            h('span', { class: 'mw-bind-label' }, a.label, modified ? h('span', { class: 'mw-bind-mod', title: 'Touche modifiée' }) : null),
            slots,
          ),
        );
      }
      if (g.group === 'Interface') {
        sec.appendChild(
          h(
            'div',
            { class: 'mw-bind-row is-locked', title: 'Non modifiable' },
            h('span', { class: 'mw-bind-label' }, 'Menu pause'),
            h('div', { class: 'mw-bind-slots' }, h('div', { class: 'mw-bind-slot' }, h('span', { class: 'mw-bind-fixed' }, h('span', { class: 'keycap' }, keyLabel('Escape')), 'Réservée'))),
          ),
        );
      }
      cols[g.col].appendChild(sec);
    }
    list.append(...cols);
    list.scrollTop = scroll;
    if (focus) {
      const target = list.querySelector<HTMLButtonElement>(`[data-action="${focus.id}"] [data-slot="${focus.slot}"] .mw-bind-key`);
      target?.focus({ preventScroll: true });
    }
  }

  // ------------------------------------------------------------ modifications
  function setSlot(id: ActionId, slot: number, code: string): void {
    const arr = [...(settings.bindings[id] ?? [])];
    if (slot < arr.length) arr[slot] = code;
    else arr.push(code);
    settings.bindings[id] = arr;
  }

  function clearSlot(id: ActionId, slot: number): void {
    const removed = settings.bindings[id]?.[slot];
    settings.bindings[id] = (settings.bindings[id] ?? []).filter((_, k) => k !== slot);
    saveSettings();
    render({ id, slot: 0 });
    if (removed) showFlash(`« ${labelOf(id)} » n’utilise plus ${keyLabel(removed)}.`, 'info');
  }

  async function assign(code: string): Promise<void> {
    const cap = capture;
    if (!cap) return;
    stopCapture();
    const focus = { id: cap.id, slot: cap.slot };
    const current = settings.bindings[cap.id] ?? [];
    const old = current[cap.slot];
    if (old === code) {
      render(focus);
      return;
    }
    if (current.includes(code)) {
      render(focus);
      showFlash(`${keyLabel(code)} est déjà attribuée à « ${labelOf(cap.id)} ».`, 'info');
      return;
    }
    const others = conflicts(settings.bindings, code, cap.id);
    if (others.length) {
      render(focus);
      const names = others.map((id) => `« ${labelOf(id)} »`).join(' et ');
      const canSwap = !!old && others.length === 1;
      const detail = h(
        'ul',
        { class: 'mw-conflict-list' },
        h(
          'li',
          { class: canSwap ? '' : 'is-off' },
          h('strong', null, 'Échanger'),
          canSwap ? fr(` : « ${labelOf(others[0])} » passera sur ${keyLabel(old)}.`) : fr(' : impossible, cette action n’avait pas encore de touche.'),
        ),
        h('li', null, h('strong', null, 'Remplacer'), fr(` : ${names} ${others.length > 1 ? 'perdront' : 'perdra'} la touche ${keyLabel(code)}.`)),
      );
      app.audio.play('ui_error');
      const v = await choose(app, panel, {
        title: 'Touche déjà utilisée',
        text: fr(`Cette touche est déjà utilisée pour ${names}.`),
        detail,
        icon: 'alert',
        choices: [
          { label: 'Échanger', value: 'swap', cls: 'btn', disabled: !canSwap },
          { label: 'Remplacer', value: 'replace', cls: 'btn' },
          { label: 'Annuler', value: 'cancel', cls: 'btn ghost' },
        ],
        cancel: 'cancel',
        focus: canSwap ? 'swap' : 'replace',
      });
      if (!panel.isConnected) return;
      if (v === 'cancel') {
        render(focus);
        return;
      }
      if (v === 'swap' && old) {
        const o = others[0];
        settings.bindings[o] = [...new Set(settings.bindings[o].map((c) => (c === code ? old : c)))];
      } else {
        for (const o of others) settings.bindings[o] = settings.bindings[o].filter((c) => c !== code);
      }
    }
    setSlot(cap.id, cap.slot, code);
    saveSettings();
    render(focus);
    showFlash(`« ${labelOf(cap.id)} » : ${keyLabel(code)}`, 'good');
  }

  // ------------------------------------------------------------ capture d'une touche
  // Les écouteurs sont posés en phase de capture sur window et arrêtent la propagation :
  // le jeu (et le raccourci Échap) ne reçoit rien pendant la saisie.
  let keyUpUntil = 0;
  let keyUpCode = '';
  /** Bouton de souris capturé : on avale le clic (ou menu contextuel) qui suit, une seule fois. */
  let followUp: { button: number; until: number } | null = null;
  let wheelUntil = 0;

  const onKey = (e: KeyboardEvent): void => {
    if (!capture) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    learnKey(e);
    if (e.code === 'Escape') {
      cancelCapture();
      return;
    }
    if (!e.code) return;
    if (RESERVED.has(e.code)) {
      app.audio.play('ui_error');
      showFlash(`La touche ${keyLabel(e.code)} est réservée et ne peut pas être attribuée.`, 'bad');
      return;
    }
    keyUpCode = e.code;
    keyUpUntil = performance.now() + 1500;
    void assign(e.code);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    // évite qu'Espace ou Entrée relâchés ne « cliquent » le bouton qui a le focus
    if (e.code === keyUpCode && performance.now() < keyUpUntil) {
      e.preventDefault();
      e.stopImmediatePropagation();
      keyUpCode = '';
    }
  };
  const onMouse = (e: MouseEvent): void => {
    if (!capture) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    followUp = { button: e.button, until: performance.now() + 1500 };
    if (e.target instanceof Element && e.target.closest('.mw-capture-cancel')) {
      cancelCapture();
      return;
    }
    void assign(`Mouse${e.button}`);
  };
  const onWheel = (e: WheelEvent): void => {
    if (!capture) {
      if (performance.now() < wheelUntil) e.preventDefault();
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    if (Math.abs(e.deltaY) < 1) return;
    wheelUntil = performance.now() + 450;
    void assign(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
  };
  const swallowClick = (e: MouseEvent): void => {
    // le clic, le menu contextuel ou la navigation (boutons 4 et 5) qui suivent le bouton
    // capturé ne doivent rien déclencher
    if (!followUp || e.button !== followUp.button) return;
    if (performance.now() > followUp.until) {
      followUp = null;
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click' || e.type === 'auxclick') followUp = null;
  };

  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('mouseup', swallowClick, true);
  window.addEventListener('click', swallowClick, true);
  window.addEventListener('auxclick', swallowClick, true);
  window.addEventListener('contextmenu', swallowClick, true);
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });

  function startCapture(id: ActionId, slot: number): void {
    if (capture) stopCapture();
    capture = { id, slot };
    panel.classList.add('is-capturing');
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    render();
    flash.classList.remove('is-visible');
  }

  function stopCapture(): void {
    capture = null;
    panel.classList.remove('is-capturing');
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mousedown', onMouse, true);
  }

  function cancelCapture(): void {
    const cap = capture;
    stopCapture();
    app.audio.play('ui_close');
    render(cap ?? undefined);
  }

  watchUnmount(panel, () => {
    stopCapture();
    window.clearTimeout(flashTimer);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('mouseup', swallowClick, true);
    window.removeEventListener('click', swallowClick, true);
    window.removeEventListener('auxclick', swallowClick, true);
    window.removeEventListener('contextmenu', swallowClick, true);
    window.removeEventListener('wheel', onWheel, true);
  });

  // ------------------------------------------------------------ pied
  const restore = button(app, [icon('reset'), 'Rétablir les touches par défaut'], 'btn small ghost', () => {
    if (capture) stopCapture();
    void choose(app, panel, {
      title: 'Rétablir les touches ?',
      text: fr('Toutes les touches reprendront leur attribution d’origine.'),
      icon: 'reset',
      choices: [
        { label: 'Annuler', value: 'no', cls: 'btn ghost' },
        { label: 'Rétablir', value: 'yes', cls: 'btn danger' },
      ],
      cancel: 'no',
      focus: 'no',
    }).then((v) => {
      if (v !== 'yes') return;
      settings.bindings = defaultBindings();
      saveSettings();
      render();
      showFlash('Touches par défaut rétablies.', 'good');
    });
  });
  const close = button(app, 'Fermer', 'btn', () => {
    if (capture) stopCapture();
    opts.onClose();
  });
  panel.appendChild(h('footer', { class: 'mw-dialog-foot' }, restore, h('span', { class: 'mw-foot-spacer' }), close));

  closeOnEscape(app, panel, () => {
    app.click();
    opts.onClose();
  });
  shieldPointer(panel, true);
  render();
  return panel;
}
