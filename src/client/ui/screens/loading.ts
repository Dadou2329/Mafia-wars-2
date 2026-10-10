// Écran de chargement : logo, jauge néon, astuces de jeu (New York, 2085).

import { keyLabel, type ActionId } from '../../input/bindings';
import { settings } from '../../settings';
import { DISTRICT_BONUS, HQ_CAPTURE_MIN_DISTRICTS } from '../../../shared/constants';
import { h } from '../dom';
import { BRAND, TITLE, ambience, fr, pct, shieldPointer, watchUnmount } from './menu';

/** Libellé de la première touche d'une action ; `fallback` si l'action n'existe pas ou n'a pas de touche. */
function key(id: ActionId | string, fallback = '—'): string {
  const c = (settings.bindings as Partial<Record<string, string[]>>)[id]?.[0];
  return c ? keyLabel(c) : fallback;
}

function tips(): string[] {
  return [
    `Appuyez sur ${key('wheel')} près de vos hommes pour leur donner un ordre rapide.`,
    `Contrôlez au moins ${HQ_CAPTURE_MIN_DISTRICTS} quartiers sur 7 pour pouvoir prendre d’assaut le QG actuel de votre rival.`,
    'Un quartier n’est à vous que si vous tenez tous ses bâtiments clés ★.',
    'Recrutez de nouveaux gangsters auprès du recruteur de votre QG, par 1, 5 ou 10.',
    `Au QG, installez-vous au bureau (${key('interact')}) pour ouvrir la carte stratégique. Elle s’ouvre aussi partout avec ${key('map')}.`,
    `Votre téléphone (${key('phone', 'Tab')}) : alertes, véhicule, taxi volant vers le QG et ordres rapides.`,
    'De la planque à la tour : chaque emménagement augmente vos effectifs, vos lieutenants et vos revenus. Votre QG vous suit !',
    `Maintenez ${key('interact')} devant un terminal de sécurité pour couper caméras et tourelles, ou ouvrir une porte verrouillée.`,
    'Les fusillades attirent la police de New York : faites-vous oublier pour qu’elle perde votre trace.',
    `Chaque quartier contrôlé vous rapporte ${DISTRICT_BONUS}\u00a0$ de plus par minute.`,
    'Le métro relie Brooklyn et le Queens à Times Square : parfait pour une attaque surprise par les souterrains.',
    'Ordonnez à un lieutenant de « Tenir le toit » : vos hommes dominent la rue depuis les hauteurs.',
    'L’aéronef ADAV se pose sur les toits : idéal pour frapper là où personne ne vous attend.',
    'Braquages et convois à intercepter : des coups libres pour remplir vos caisses.',
    'Un drone de reconnaissance révèle les ennemis d’un quartier sur vos cartes.',
    `Appuyez sur ${key('view')} pour passer de la vue à la première personne à la troisième.`,
    'Plus vous êtes nombreux dans un bâtiment, plus vite vous le prenez.',
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
  const tip = h('div', { class: 'mw-loading-tip', role: 'note' }, h('span', { class: 'mw-tip-label' }, 'Astuce :'), ' ', tipText);

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
