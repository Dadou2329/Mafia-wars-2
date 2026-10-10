// Écran de fin de partie : vainqueur, bilan comparé, revanche.

import type { AppApi, VictoryData } from '../../appApi';
import type { MatchStats, Slot } from '../../../shared/protocol';
import { BOSS_NAME, MAFIA_NAME } from '../../../shared/constants';
import { formatMoney } from '../../../shared/util';
import { h } from '../dom';
import { BRAND, TITLE, button, fr, icon, shieldPointer } from './menu';
import { currentPortraits } from './settings';

const SLOTS: Slot[] = ['dadou', 'even'];
const other = (s: Slot): Slot => (s === 'dadou' ? 'even' : 'dadou');

const STAT_ROWS: { key: keyof MatchStats; label: string; lowerIsBetter?: boolean; money?: boolean }[] = [
  { key: 'territories', label: 'Territoires conquis' },
  { key: 'buildings', label: 'Bâtiments contrôlés' },
  { key: 'kills', label: 'Ennemis abattus' },
  { key: 'deaths', label: 'Morts', lowerIsBetter: true },
  { key: 'captured', label: 'Bâtiments capturés' },
  { key: 'lost', label: 'Bâtiments perdus', lowerIsBetter: true },
  { key: 'recruited', label: 'Recrues' },
  { key: 'earned', label: 'Argent gagné', money: true },
];

const num = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Feuilles d'or (ou d'argent) qui tombent doucement. */
function leaves(count: number): HTMLElement {
  const box = h('div', { class: 'mw-leaves', 'aria-hidden': 'true' });
  for (let i = 0; i < count; i++) {
    const d = 7 + Math.random() * 7;
    box.appendChild(
      h(
        'span',
        {
          class: `mw-leaf${Math.random() < 0.3 ? ' is-alt' : ''}`,
          style: `--x:${(Math.random() * 100).toFixed(1)}%;--d:${d.toFixed(2)}s;--delay:${(-Math.random() * d).toFixed(2)}s;--s:${(0.6 + Math.random() * 0.9).toFixed(2)};--r:${Math.round(Math.random() * 360)}deg;--sway:${Math.round(-60 + Math.random() * 120)}px`,
        },
        h('i'),
      ),
    );
  }
  return box;
}

export function victoryScreen(
  app: AppApi,
  data: VictoryData,
  opts: { onRematch(): void; onMenu(): void },
): { el: HTMLElement; setVotes(votes: (Slot | null)[]): void } {
  const w = data.winner;
  const outcome = w === null ? 'draw' : w === data.me ? 'win' : 'loss';
  const theme = w ?? 'draw';

  // ------------------------------------------------------------ héros (portrait + emblème)
  const heroSlots: Slot[] = w ? [w] : SLOTS;
  const portraits = new Map<Slot, HTMLImageElement>();
  const hero = h(
    'div',
    { class: `mw-hero${w ? '' : ' is-duo'}` },
    heroSlots.map((s) => {
      const img = h('img', { class: 'mw-hero-portrait is-emblem', src: BRAND.emblem[s], alt: `Portrait de ${BOSS_NAME[s]}`, draggable: false });
      portraits.set(s, img);
      return h(
        'figure',
        { class: `mw-hero-fig mw-hero-fig--${s}` },
        h('img', { class: 'mw-hero-emblem', src: BRAND.emblem[s], alt: '', 'aria-hidden': 'true', draggable: false }),
        h('div', { class: 'mw-hero-frame' }, img),
        h('figcaption', { class: 'mw-hero-plate' }, h('span', { class: 'mw-hero-name' }, BOSS_NAME[s]), h('span', { class: 'mw-hero-mafia' }, MAFIA_NAME[s])),
      );
    }),
  );
  void currentPortraits(app, false).then((p) => {
    for (const [s, img] of portraits) {
      if (!p[s]) continue;
      img.src = p[s];
      img.classList.remove('is-emblem');
    }
  });

  // ------------------------------------------------------------ titres
  const headline = w ? `${BOSS_NAME[w].toUpperCase()} RÈGNE SUR LONDRES !` : 'ÉGALITÉ !';
  const sub = w
    ? `${BOSS_NAME[other(w)]} a été vaincu. Londres appartient désormais à ${BOSS_NAME[w]} !`
    : 'Aucun parrain n’a su s’imposer : Londres reste divisée.';
  const outcomeLabel = outcome === 'win' ? 'Victoire' : outcome === 'loss' ? 'Défaite' : 'Fin de la partie';

  // ------------------------------------------------------------ bilan
  const head = h(
    'tr',
    null,
    h('th', { scope: 'col', class: 'mw-stats-cap' }, 'Bilan de la partie'),
    SLOTS.map((s) =>
      h(
        'th',
        { scope: 'col', class: `mw-stats-who mw-stats-who--${s}${s === data.me ? ' is-me' : ''}` },
        h('img', { src: BRAND.emblem[s], alt: '', draggable: false }),
        h('span', null, BOSS_NAME[s]),
        s === data.me ? h('small', null, '(vous)') : null,
      ),
    ),
  );
  const rows = STAT_ROWS.map((r) => {
    const a = data.stats.dadou?.[r.key] ?? 0;
    const b = data.stats.even?.[r.key] ?? 0;
    const best: Slot | null = a === b ? null : (a > b) !== !!r.lowerIsBetter ? 'dadou' : 'even';
    const cell = (s: Slot, v: number): HTMLElement =>
      h('td', { class: `mw-stats-val mw-stats-val--${s}${best === s ? ' is-best' : ''}` }, r.money ? formatMoney(v).replace(/ /g, ' ') : num(v));
    return h('tr', null, h('th', { scope: 'row' }, r.label), cell('dadou', a), cell('even', b));
  });
  const table = h('table', { class: 'mw-stats' }, h('thead', null, head), h('tbody', null, rows));

  // ------------------------------------------------------------ revanche
  let iVoted = false;
  let votes = new Set<Slot>();
  const rematch = button(app, [icon('reset'), 'Revanche'], 'btn big mw-rematch', () => {
    if (iVoted) return;
    iVoted = true;
    opts.onRematch();
    paintVotes();
  });
  const menu = button(app, [icon('exit'), 'Retour au menu'], 'btn ghost mw-victory-menu', () => opts.onMenu());
  const voteLine = h('div', { class: 'mw-votes', role: 'status', 'aria-live': 'polite' });
  const voteMarks = h(
    'div',
    { class: 'mw-vote-marks' },
    SLOTS.map((s) => h('span', { class: `mw-vote-mark mw-vote-mark--${s}`, 'data-slot': s }, h('img', { src: BRAND.emblem[s], alt: '' }), h('span', null, BOSS_NAME[s]))),
  );

  function paintVotes(): void {
    const mine = iVoted || votes.has(data.me);
    const theirs = votes.has(other(data.me));
    rematch.disabled = mine;
    rematch.classList.toggle('is-called', theirs && !mine);
    rematch.lastChild!.textContent = mine ? 'Revanche demandée' : 'Revanche';
    for (const m of voteMarks.querySelectorAll<HTMLElement>('.mw-vote-mark')) {
      const s = m.dataset.slot as Slot;
      m.classList.toggle('is-on', s === data.me ? mine : votes.has(s));
    }
    voteMarks.classList.toggle('is-visible', mine || theirs);
    if (mine && theirs) voteLine.textContent = 'La revanche commence…';
    else if (mine) voteLine.textContent = 'En attente de l’autre parrain…';
    else if (theirs) voteLine.textContent = fr(`${BOSS_NAME[other(data.me)]} veut sa revanche !`);
    else voteLine.textContent = '';
    voteLine.classList.toggle('is-visible', voteLine.textContent !== '');
  }

  // ------------------------------------------------------------ assemblage
  const el = h(
    'div',
    { class: `screen mw-victory mw-victory--${theme}`, 'data-outcome': outcome },
    h('div', { class: 'mw-victory-bg', 'aria-hidden': 'true' }),
    h('div', { class: 'mw-rays', 'aria-hidden': 'true' }),
    h('div', { class: 'mw-victory-vignette', 'aria-hidden': 'true' }),
    outcome === 'win' ? leaves(34) : null,
    h(
      'div',
      { class: 'mw-victory-main' },
      h('img', { class: 'mw-victory-logo', src: BRAND.compact, alt: TITLE, draggable: false }),
      h('div', { class: 'mw-victory-outcome' }, h('span', { class: 'mw-orn', 'aria-hidden': 'true' }), outcomeLabel, h('span', { class: 'mw-orn', 'aria-hidden': 'true' })),
      h(
        'div',
        { class: 'mw-victory-grid' },
        hero,
        h(
          'section',
          { class: 'mw-victory-text' },
          h('h1', { class: 'mw-victory-headline' }, fr(headline)),
          h('p', { class: 'mw-victory-sub' }, fr(sub)),
          data.reason
            ? h('div', { class: 'mw-gazette' }, h('div', { class: 'mw-gazette-mast' }, 'La Gazette de Londres'), h('p', { class: 'mw-gazette-text' }, fr(data.reason)))
            : null,
          table,
        ),
      ),
      h('div', { class: 'mw-victory-actions' }, menu, rematch),
      h('div', { class: 'mw-vote-zone' }, voteMarks, voteLine),
    ),
  );
  paintVotes();
  shieldPointer(el);

  return {
    el,
    setVotes(v: (Slot | null)[]): void {
      votes = new Set(v.filter((s): s is Slot => s === 'dadou' || s === 'even'));
      if (votes.has(data.me)) iVoted = true;
      paintVotes();
    },
  };
}
