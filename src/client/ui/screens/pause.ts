// Menu pause (en partie). La partie en ligne continue pendant ce temps !

import type { AppApi } from '../../appApi';
import { h } from '../dom';
import { BRAND, TITLE, button, choose, fr, icon, shieldPointer } from './menu';

export function pauseMenu(
  app: AppApi,
  opts: { onResume(): void; onQuit(): void; onSettings(): void; onControls(): void; onHelp(): void },
): HTMLElement {
  const el = h('div', { class: 'screen dim-bg mw-pause' });
  const code = app.net.room?.code ?? '';

  const resume = button(app, [icon('play'), 'Reprendre'], 'btn big mw-pause-resume', () => opts.onResume());
  const items = [
    button(app, [icon('gear'), 'Paramètres'], 'mw-menu-item mw-pause-item', () => opts.onSettings()),
    button(app, [icon('keyboard'), 'Commandes'], 'mw-menu-item mw-pause-item', () => opts.onControls()),
    button(app, [icon('book'), 'Comment jouer'], 'mw-menu-item mw-pause-item', () => opts.onHelp()),
  ];
  const quit = button(app, [icon('exit'), 'Quitter la partie'], 'btn danger mw-pause-quit', () => {
    void choose(app, el, {
      title: fr('Quitter la partie en cours ?'),
      text: fr('Votre empire vous attendra si vous revenez avec le même code.'),
      detail: code ? h('div', { class: 'mw-pause-code' }, h('span', { class: 'label' }, 'Code de la partie'), h('strong', null, code)) : undefined,
      icon: 'exit',
      choices: [
        { label: 'Rester', value: 'stay', cls: 'btn ghost' },
        { label: 'Quitter', value: 'quit', cls: 'btn danger' },
      ],
      cancel: 'stay',
      focus: 'stay',
    }).then((v) => {
      if (v === 'quit') opts.onQuit();
    });
  });
  const all = [resume, ...items, quit];

  const box = h(
    'div',
    { class: 'mw-pause-box fade-in', role: 'dialog', 'aria-label': 'Pause' },
    h('img', { class: 'mw-pause-logo', src: BRAND.compact, alt: TITLE, draggable: false }),
    h('h2', { class: 'mw-pause-title' }, h('span', { class: 'mw-orn', 'aria-hidden': 'true' }), 'Pause', h('span', { class: 'mw-orn', 'aria-hidden': 'true' })),
    h('div', { class: 'mw-live', role: 'status' }, h('span', { class: 'mw-live-dot', 'aria-hidden': 'true' }), fr('La partie continue pendant la pause !')),
    h('nav', { class: 'panel mw-pause-nav' }, resume, h('div', { class: 'mw-pause-items' }, items), h('div', { class: 'divider' }), quit),
    code ? h('div', { class: 'mw-pause-foot' }, fr(`Code de la partie : ${code}`)) : null,
  );
  el.appendChild(box);
  shieldPointer(el);

  // flèches haut/bas pour parcourir le menu
  box.addEventListener('keydown', (e) => {
    if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return;
    if (el.querySelector('.mw-modal')) return;
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    const n = i < 0 ? 0 : (i + (e.code === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
    all[n].focus();
  });
  requestAnimationFrame(() => {
    if (el.isConnected && !el.contains(document.activeElement)) resume.focus({ preventScroll: true });
  });
  return el;
}
