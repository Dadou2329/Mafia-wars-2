// Écran de chargement : logo, barre de progression en laiton, astuces de jeu.

import { keyLabel, type ActionId } from '../../input/bindings';
import { settings } from '../../settings';
import { DISTRICT_BONUS, HQ_CAPTURE_MIN_DISTRICTS } from '../../../shared/constants';
import { h } from '../dom';
import { BRAND, TITLE, ambience, fr, pct, shieldPointer, watchUnmount } from './menu';

function key(id: ActionId): string {
  const c = settings.bindings[id]?.[0];
  return c ? keyLabel(c) : '—';
}

function tips(): string[] {
  return [
    `Appuyez sur ${key('wheel')} près de vos hommes pour leur donner un ordre rapide.`,
    `Contrôlez au moins ${HQ_CAPTURE_MIN_DISTRICTS} quartiers pour pouvoir prendre d’assaut le QG adverse.`,
    'Un quartier n’est à vous que si vous tenez tous ses bâtiments clés.',
    'Recrutez de nouveaux gangsters au comptoir du bar de votre QG.',
    `Au QG, approchez-vous de votre bureau et appuyez sur ${key('interact')} pour diriger vos lieutenants.`,
    `Le Télégraphe vous permet de donner vos ordres depuis la carte (${key('map')}), où que vous soyez.`,
    'Les fusillades attirent la police : faites-vous discret pour qu’elle perde votre trace.',
    `Chaque quartier contrôlé vous rapporte ${DISTRICT_BONUS} £ de plus par minute.`,
    'Si vous tombez, le docteur vous recoud au QG… moyennant finances.',
    'Plus vous êtes nombreux dans un bâtiment, plus vite vous le prenez.',
    'Les gilets matelassés donnent 35 % de points de vie en plus à tous vos hommes.',
    'Achetez une armurerie au QG pour vous procurer fusils et munitions.',
    'Votre QG est attaqué ? Une alerte s’affiche : rentrez vite le défendre !',
    `Appuyez sur ${key('view')} pour passer de la vue à la première personne à la troisième.`,
    `Appuyez sur ${key('scores')} pour consulter le bilan de la partie.`,
    'Un lieutenant blessé revient au combat après quelques instants de repos.',
  ];
}

export function loadingScreen(): { el: HTMLElement; set(step: string, f: number): void } {
  const list = tips();
  let tipIndex = Math.floor(Math.random() * list.length);

  const fill = h('div', { class: 'mw-pbar-fill' }, h('span', { class: 'mw-pbar-sheen' }));
  const bar = h(
    'div',
    { class: 'mw-pbar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Chargement' },
    h('span', { class: 'mw-pbar-cap mw-pbar-cap--l', 'aria-hidden': 'true' }),
    h('div', { class: 'mw-pbar-track' }, fill),
    h('span', { class: 'mw-pbar-cap mw-pbar-cap--r', 'aria-hidden': 'true' }),
  );
  const stepEl = h('span', { class: 'mw-pbar-step' }, 'Préparation…');
  const pctEl = h('span', { class: 'mw-pbar-pct' }, pct(0));
  const tipText = h('span', { class: 'mw-tip-text' }, fr(list[tipIndex]));
  const tip = h('div', { class: 'mw-loading-tip', role: 'note' }, h('span', { class: 'mw-tip-label' }, 'Astuce\u00a0:'), ' ', tipText);

  const el = h(
    'div',
    { class: 'screen backdrop mw-loading' },
    ambience(),
    h(
      'div',
      { class: 'mw-loading-main' },
      h('img', { class: 'mw-loading-logo', src: BRAND.logo, alt: TITLE, draggable: false }),
      h('div', { class: 'mw-loading-bar' }, bar, h('div', { class: 'mw-pbar-meta' }, stepEl, pctEl)),
      tip,
    ),
  );

  shieldPointer(el);

  // une astuce différente toutes les 5 secondes, en fondu
  let swapTimer = 0;
  const iv = window.setInterval(() => {
    tip.classList.add('is-out');
    swapTimer = window.setTimeout(() => {
      tipIndex = (tipIndex + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
      tipText.textContent = fr(list[tipIndex]);
      tip.classList.remove('is-out');
    }, 420);
  }, 5000);
  watchUnmount(el, () => {
    window.clearInterval(iv);
    window.clearTimeout(swapTimer);
  });

  return {
    el,
    set(step: string, f: number): void {
      const v = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 0));
      fill.style.width = `${(v * 100).toFixed(1)}%`;
      bar.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      el.classList.toggle('is-complete', v >= 1);
      stepEl.textContent = fr(step);
      pctEl.textContent = pct(v);
    },
  };
}
