// « Comment jouer » (manuel du parrain) et crédits.

import type { AppApi } from '../../appApi';
import { ACTIONS, keyLabel, type ActionId } from '../../input/bindings';
import { settings } from '../../settings';
import { DISTRICT_BONUS, HQ_CAPTURE_MIN_DISTRICTS, LIEUTENANT_RECOVERY, RESPAWN_PENALTY, RESPAWN_PENALTY_MAX } from '../../../shared/constants';
import { formatMoney } from '../../../shared/util';
import { h } from '../dom';
import { BRAND, TITLE, button, closeOnEscape, fr, icon, shieldPointer, type IconName } from './menu';

type Child = Node | string;

/** Touches actuelles d'une action, sous forme de touches dessinées. */
function keys(id: ActionId): HTMLElement {
  const codes = settings.bindings[id] ?? [];
  if (!codes.length) return h('span', { class: 'mw-help-nokey' }, 'non attribuée');
  return h(
    'span',
    { class: 'mw-help-keys' },
    codes.slice(0, 2).flatMap((c, i) => (i ? [h('span', { class: 'mw-help-or' }, 'ou'), h('span', { class: 'keycap' }, keyLabel(c))] : [h('span', { class: 'keycap' }, keyLabel(c))])),
  );
}

/** « 1 250 £ » avec des espaces insécables. */
const money = (n: number): string => formatMoney(n).replace(/ /g, '\u00a0');

const k = (id: ActionId): string => (settings.bindings[id]?.[0] ? keyLabel(settings.bindings[id][0]) : '—');

function p(...parts: Child[]): HTMLElement {
  return h('p', null, ...parts.map((x) => (typeof x === 'string' ? fr(x) : x)));
}

interface Section {
  id: string;
  title: string;
  icon: IconName;
  body: () => HTMLElement[];
}

function sections(): Section[] {
  const move = ['forward', 'left', 'back', 'right'].map((id) => k(id as ActionId)).join(' ');
  return [
    {
      id: 'but',
      title: 'Le but du jeu',
      icon: 'crown',
      body: () => [
        p(
          'Londres, 1888. Deux parrains se disputent la capitale : ',
          h('strong', { class: 'c-ink-dadou' }, 'Dadou'),
          ', le flamboyant maître de Soho, et ',
          h('strong', { class: 'c-ink-even' }, 'Even'),
          ', l’élégant seigneur des Docks.',
        ),
        p(
          'Emparez-vous des ',
          h('strong', null, 'bâtiments clés'),
          ' d’un quartier pour en prendre le contrôle. ',
          fr(`Dès que vous tenez au moins ${HQ_CAPTURE_MIN_DISTRICTS} quartiers, le quartier général adverse devient vulnérable : `),
          h('strong', null, 'prenez-le d’assaut pour gagner la partie.'),
        ),
        p('Si la partie a une durée limitée, le parrain qui contrôle le plus de quartiers à la fin du temps l’emporte.'),
        p('Pour prendre un bâtiment, entrez-y avec vos hommes et restez-y tant qu’aucun défenseur ennemi n’est présent : plus vous êtes nombreux, plus la prise est rapide.'),
      ],
    },
    {
      id: 'commandes',
      title: 'Les commandes',
      icon: 'keyboard',
      body: () => {
        const rows: [string, HTMLElement][] = [
          ['Se déplacer', h('span', { class: 'mw-help-keys' }, h('span', { class: 'keycap' }, move))],
          ...ACTIONS.filter((a) => !['forward', 'back', 'left', 'right'].includes(a.id)).map((a): [string, HTMLElement] => [a.label, keys(a.id)]),
          ['Menu pause', h('span', { class: 'mw-help-keys' }, h('span', { class: 'keycap' }, keyLabel('Escape')))],
        ];
        return [
          h(
            'div',
            { class: 'mw-help-keytable' },
            rows.map(([label, ks]) => h('div', { class: 'mw-help-keyrow' }, h('span', null, label), ks)),
          ),
          p('Toutes les touches se modifient dans le menu « Commandes ».'),
        ];
      },
    },
    {
      id: 'bureau',
      title: 'Votre bureau',
      icon: 'book',
      body: () => [
        p(
          'Votre quartier général abrite le ',
          h('strong', null, 'Bureau de Dadou'),
          ' (au Lion Rouge) ou le ',
          h('strong', null, 'Bureau d’Even'),
          ' (à l’Ancre Bleue). Approchez-vous du bureau et appuyez sur ',
          h('span', { class: 'keycap' }, k('interact')),
          ' pour vous y installer.',
        ),
        p('Vous y trouverez la carte stratégique de Londres, vos lieutenants, vos finances et les améliorations de votre organisation.'),
      ],
    },
    {
      id: 'lieutenants',
      title: 'Lieutenants et carte stratégique',
      icon: 'flag',
      body: () => [
        p('Chaque lieutenant commande une escouade de gangsters. Depuis la carte stratégique de votre bureau, confiez-lui des hommes puis un ordre : attaquer un quartier ou un bâtiment, défendre, patrouiller, renforcer, se replier…'),
        p(`Un lieutenant blessé quitte le combat et revient au bout de ${LIEUTENANT_RECOVERY} secondes. Engagez de nouveaux lieutenants au bureau pour mener plusieurs offensives à la fois.`),
      ],
    },
    {
      id: 'ordres',
      title: 'Ordres rapides',
      icon: 'chat',
      body: () => [
        p(
          'Sur le terrain, appuyez sur ',
          h('span', { class: 'keycap' }, k('wheel')),
          ' près de vos hommes pour ouvrir la roue des ordres rapides : suivez-moi, attaquez, défendez, repliez-vous.',
        ),
        p('Visez un ennemi ou un bâtiment avant de donner l’ordre pour désigner la cible.'),
      ],
    },
    {
      id: 'recrutement',
      title: 'Recrutement',
      icon: 'user',
      body: () => [
        p('Au comptoir du bar de votre QG, recrutez de nouveaux gangsters par 1, 5 ou 10. Les recrues vous attendent au QG : affectez-les à un lieutenant ou emmenez-les avec vous.'),
      ],
    },
    {
      id: 'argent',
      title: 'L’argent',
      icon: 'trophy',
      body: () => [
        p('Chaque établissement que vous contrôlez vous rapporte un revenu passif, exprimé en livres par minute et versé en continu dans vos caisses.'),
        p(`Chaque quartier entièrement contrôlé ajoute ${money(DISTRICT_BONUS)} par minute. Certains bâtiments neutres s’achètent ; ceux tenus par un gang se prennent par la force.`),
      ],
    },
    {
      id: 'police',
      title: 'La police',
      icon: 'alert',
      body: () => [
        p('Les fusillades attirent Scotland Yard. Plus vous semez le désordre, plus votre niveau de recherche grimpe (jusqu’à 5) et plus les bobbies vous traquent.'),
        p('Faites-vous oublier quelques instants : la police finit par perdre votre trace.'),
      ],
    },
    {
      id: 'retour',
      title: 'Blessé, pas mort',
      icon: 'reset',
      body: () => [
        p(
          fr(
            `Si vous tombez, vous reprenez connaissance à votre QG au bout de quelques secondes. Le docteur se fait payer : ${Math.round(RESPAWN_PENALTY * 100)} % de votre argent, ${money(RESPAWN_PENALTY_MAX)} au plus.`,
          ),
        ),
      ],
    },
    {
      id: 'ameliorations',
      title: 'Améliorations',
      icon: 'gear',
      body: () => [
        p('Investissez au bureau : revolvers pour tous, gilets matelassés, gardes du QG, armurerie, façade prestigieuse…'),
        p(
          'Le ',
          h('strong', null, 'Télégraphe'),
          ' vous permet de donner vos ordres depuis la carte (touche ',
          h('span', { class: 'keycap' }, k('map')),
          '), où que vous soyez.',
        ),
      ],
    },
  ];
}

export function helpPanel(app: AppApi, opts: { onClose(): void }): HTMLElement {
  const secs = sections();
  const page = h('article', { class: 'parchment mw-help-page scroll', tabindex: '0', 'aria-label': 'Comment jouer' });
  page.appendChild(
    h(
      'header',
      { class: 'mw-help-mast' },
      h('div', { class: 'mw-help-kicker' }, 'Londres, 1888'),
      h('h2', { class: 'mw-help-title' }, 'Le Manuel du parrain'),
      h('div', { class: 'mw-help-kicker' }, 'À l’usage de Dadou et d’Even'),
    ),
  );
  const toc = h('nav', { class: 'mw-help-toc', 'aria-label': 'Sommaire' });
  const tocBtns: HTMLButtonElement[] = [];
  const els: HTMLElement[] = [];
  const mark = (cur: number): void => tocBtns.forEach((b, i) => b.classList.toggle('is-on', i === cur));
  // entrée choisie dans le sommaire : elle reste active pendant le défilement automatique
  let pinnedUntil = 0;
  secs.forEach((s, i) => {
    const sec = h('section', { class: 'mw-help-sec', id: `mw-help-${s.id}` }, h('h3', null, icon(s.icon), h('span', null, s.title)), ...s.body());
    els.push(sec);
    page.appendChild(sec);
    const b = button(app, [h('span', { class: 'mw-toc-num' }, String(i + 1)), h('span', null, s.title)], 'mw-toc-btn', () => {
      pinnedUntil = performance.now() + 1200;
      mark(i);
      page.scrollTo({ top: sec.offsetTop - 12, behavior: 'smooth' });
    });
    tocBtns.push(b);
    toc.appendChild(b);
  });
  page.appendChild(h('p', { class: 'mw-help-end' }, fr('Bonne chance, parrain. Londres n’attend que vous !')));

  // le sommaire suit la lecture
  const sync = (): void => {
    if (performance.now() < pinnedUntil) return;
    let cur = 0;
    for (let i = 0; i < els.length; i++) if (els[i].offsetTop - page.scrollTop < 90) cur = i;
    if (page.scrollTop + page.clientHeight >= page.scrollHeight - 4) cur = els.length - 1;
    mark(cur);
  };
  page.addEventListener('scroll', sync, { passive: true });
  // une action de l'utilisateur sur la page reprend la main sur le sommaire
  for (const ev of ['wheel', 'pointerdown', 'keydown'] as const) page.addEventListener(ev, () => (pinnedUntil = 0), { passive: true });

  const panel = h(
    'div',
    { class: 'panel mw-dialog mw-help fade-in', role: 'dialog', 'aria-label': 'Comment jouer' },
    h('header', { class: 'mw-dialog-head' }, icon('book', 'mw-head-icon'), h('h2', { class: 'title-l' }, 'Comment jouer')),
    h('div', { class: 'mw-help-body' }, toc, page),
    h('footer', { class: 'mw-dialog-foot' }, h('span', { class: 'mw-foot-spacer' }), button(app, 'Fermer', 'btn', () => opts.onClose())),
  );
  closeOnEscape(app, panel, () => {
    app.click();
    opts.onClose();
  });
  shieldPointer(panel, true);
  requestAnimationFrame(sync);
  return panel;
}

export function creditsPanel(app: AppApi, opts: { onClose(): void }): HTMLElement {
  const block = (title: string, ...lines: (string | Node)[]): HTMLElement =>
    h('section', { class: 'mw-credit' }, h('h3', null, title), ...lines.map((l) => (typeof l === 'string' ? h('p', null, fr(l)) : l)));
  const tech = (name: string, role: string): HTMLElement => h('li', null, h('strong', null, name), h('span', null, role));
  const page = h(
    'article',
    { class: 'parchment mw-credits-page scroll', tabindex: '0' },
    h('img', { class: 'mw-credits-logo', src: BRAND.compact, alt: TITLE, draggable: false }),
    h('p', { class: 'mw-credits-dedication' }, fr('Un jeu créé pour Dadou et Even, rivaux de toujours.')),
    h('div', { class: 'divider mw-ink-divider' }),
    h(
      'div',
      { class: 'mw-credits-grid' },
      block('Technologies', h('ul', { class: 'mw-credit-list' }, tech('Three.js', 'rendu 3D'), tech('Socket.IO', 'jeu en réseau'), tech('Vite', 'outillage'), tech('TypeScript', 'langage'))),
      block(
        'Polices de caractères',
        h(
          'ul',
          { class: 'mw-credit-list' },
          tech('Cinzel', 'Natanael Gama'),
          tech('Cinzel Decorative', 'Natanael Gama'),
          tech('EB Garamond', 'Georg Duffner, Octavio Pardo'),
          tech('UnifrakturMaguntia', 'projet Unifraktur'),
        ),
        'Distribuées sous licence SIL Open Font License 1.1.',
      ),
      block(
        'Images et sons',
        'Tous les graphismes sont des voxels procéduraux : Londres, ses habitants et ses réverbères sont générés par le programme.',
        'Tous les sons et toutes les musiques sont synthétisés en temps réel : aucun enregistrement n’est utilisé.',
        'Le logo, les emblèmes et le fond du menu sont eux aussi dessinés par le code.',
      ),
    ),
    h('div', { class: 'divider mw-ink-divider' }),
    h('p', { class: 'mw-credits-end' }, fr('Londres, 1888 — merci d’avoir joué !')),
  );
  const panel = h(
    'div',
    { class: 'panel mw-dialog mw-credits fade-in', role: 'dialog', 'aria-label': 'Crédits' },
    h('header', { class: 'mw-dialog-head' }, icon('trophy', 'mw-head-icon'), h('h2', { class: 'title-l' }, 'Crédits')),
    page,
    h('footer', { class: 'mw-dialog-foot' }, h('span', { class: 'mw-foot-spacer' }), button(app, 'Fermer', 'btn', () => opts.onClose())),
  );
  closeOnEscape(app, panel, () => {
    app.click();
    opts.onClose();
  });
  shieldPointer(panel, true);
  return panel;
}
