// « Comment jouer » (manuel du parrain, New York 2085) et crédits.

import type { AppApi } from '../../appApi';
import { ACTIONS, keyLabel, type ActionId } from '../../input/bindings';
import { settings } from '../../settings';
import { DISTRICT_BONUS, HQ_CAPTURE_MIN_DISTRICTS, LIEUTENANT_RECOVERY, RESPAWN_PENALTY, RESPAWN_PENALTY_MAX } from '../../../shared/constants';
import { formatMoney } from '../../../shared/util';
import { DISTRICTS } from '../../../shared/city/plan';
import { leNom } from '../../../shared/french';
import { h } from '../dom';
import { BRAND, TITLE, button, closeOnEscape, fr, icon, shieldPointer, type IconName } from './menu';

type Child = Node | string;

/** Codes de touches d'une action (tolère une action absente de la configuration). */
function codesOf(id: ActionId | string): string[] {
  return (settings.bindings as Partial<Record<string, string[]>>)[id] ?? [];
}

/** Touches actuelles d'une action, sous forme de touches dessinées. */
function keys(id: ActionId): HTMLElement {
  const codes = codesOf(id);
  if (!codes.length) return h('span', { class: 'mw-help-nokey' }, 'non attribuée');
  return h(
    'span',
    { class: 'mw-help-keys' },
    codes.slice(0, 2).flatMap((c, i) => (i ? [h('span', { class: 'mw-help-or' }, 'ou'), h('span', { class: 'keycap' }, keyLabel(c))] : [h('span', { class: 'keycap' }, keyLabel(c))])),
  );
}

/** « 1 250 $ » avec des espaces insécables. */
const money = (n: number): string => formatMoney(n).replace(/ /g, ' ');

/** Libellé de la première touche d'une action (`fallback` si l'action n'existe pas ou n'a pas de touche). */
const k = (id: ActionId | string, fallback = '—'): string => {
  const c = codesOf(id)[0];
  return c ? keyLabel(c) : fallback;
};

/** Touche dessinée (libellé de la touche actuelle d'une action). */
const kc = (id: ActionId | string, fallback = '—'): HTMLElement => h('span', { class: 'keycap' }, k(id, fallback));

function p(...parts: Child[]): HTMLElement {
  return h('p', null, ...parts.map((x) => (typeof x === 'string' ? fr(x) : x)));
}

/** Liste à puces (texte en typographie française). */
function ul(...items: (Child | Child[])[]): HTMLElement {
  return h(
    'ul',
    null,
    items.map((it) => h('li', null, ...(Array.isArray(it) ? it : [it]).map((x) => (typeof x === 'string' ? fr(x) : x)))),
  );
}

const strong = (t: string, cls?: string): HTMLElement => h('strong', cls ? { class: cls } : null, fr(t));

interface Section {
  id: string;
  title: string;
  icon: IconName;
  body: () => HTMLElement[];
}

function sections(): Section[] {
  const move = ['forward', 'left', 'back', 'right'].map((id) => k(id)).join(' ');
  return [
    {
      id: 'but',
      title: 'Le but du jeu',
      icon: 'crown',
      body: () => [
        p(
          'New York, 2085. Sous les néons et les hologrammes, deux parrains se disputent la ville : ',
          strong('Dadou', 'c-ink-dadou'),
          ', le flamboyant chef de La Mafia de Dadou, et ',
          strong('Even', 'c-ink-even'),
          ', l’élégant patron de La Mafia d’Even.',
        ),
        p(
          'C’est un bac à sable libre : ',
          strong('pas de quêtes'),
          ', pas de relations à entretenir avec les habitants. Vous décidez de tout, dans l’ordre que vous voulez.',
        ),
        ul(
          ['Prenez des ', strong('bâtiments'), '.'],
          ['Contrôlez des ', strong('quartiers'), ' : un quartier est à vous quand vous tenez tous ses bâtiments clés ★.'],
          [`Dès que vous contrôlez au moins ${HQ_CAPTURE_MIN_DISTRICTS} quartiers sur ${DISTRICTS.length}, donnez l’assaut au `, strong('QG actuel de votre rival'), ' : le prendre, c’est gagner la partie.'],
        ),
        p(
          `Les ${DISTRICTS.length} quartiers : ${DISTRICTS.slice(0, -1)
            .map((d) => leNom(d.name))
            .join(', ')} et ${leNom(DISTRICTS[DISTRICTS.length - 1].name)}. Astoria et Long Island City sont dans le Queens, Williamsburg et Bushwick à Brooklyn.`,
        ),
        p('Pour prendre un bâtiment, entrez-y avec vos hommes et restez-y tant qu’aucun défenseur ennemi n’est présent : plus vous êtes nombreux, plus la prise est rapide.'),
        p('Si la partie a une durée limitée, le parrain qui contrôle le plus de quartiers à la fin du temps l’emporte.'),
      ],
    },
    {
      id: 'depart',
      title: 'Votre point de départ',
      icon: 'flag',
      body: () => [
        p('Chacun commence tout en bas de l’échelle, dans une planque miteuse :'),
        ul(
          [strong('Dadou', 'c-ink-dadou'), ' : la ', strong('Planque de Bushwick'), ', à Brooklyn.'],
          [strong('Even', 'c-ink-even'), ' : la ', strong('Planque d’Astoria'), ', dans le Queens.'],
        ),
        p('Les deux camps ont les mêmes règles et les mêmes prix : seul le talent fera la différence.'),
      ],
    },
    {
      id: 'ascension',
      title: 'L’ascension : de la planque à la tour',
      icon: 'hat',
      body: () => [
        p(
          'Votre logement grandit avec votre empire : ',
          strong('Planque → Garage → Loft → Penthouse → Tour'),
          '. Chaque logement est déjà entièrement meublé par le jeu.',
        ),
        p('Pour monter d’un palier, choisissez « Emménager » : cela coûte de l’argent et demande de contrôler un certain nombre de quartiers.'),
        p('Chaque palier augmente le nombre d’hommes et de lieutenants que vous pouvez commander, votre bonus de revenus et vos gardes d’élite. Votre QG déménage avec vous : c’est toujours votre logement actuel que votre rival doit prendre.'),
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
          p(
            'Par défaut : ZQSD (ou WASD) pour se déplacer, la souris pour regarder, clic gauche pour tirer, clic droit pour viser, Maj pour sprinter, E pour interagir, V pour passer de la 1re à la 3e personne, Q pour la roue des ordres, M pour la carte stratégique, Tab pour le téléphone et Échap pour la pause.',
          ),
          h(
            'div',
            { class: 'mw-help-keytable' },
            rows.map(([label, ks]) => h('div', { class: 'mw-help-keyrow' }, h('span', null, label), ks)),
          ),
          p('Toutes les touches se modifient dans « Paramètres → Commandes ».'),
        ];
      },
    },
    {
      id: 'bureau',
      title: 'Le bureau et la carte stratégique',
      icon: 'book',
      body: () => [
        p(
          'Votre QG abrite votre bureau : le ',
          strong('Bureau de Dadou'),
          ' ou le ',
          strong('Bureau d’Even'),
          '. Approchez-vous et appuyez sur ',
          kc('interact'),
          ' pour ouvrir la carte stratégique.',
        ),
        p('La carte s’ouvre aussi n’importe où avec ', kc('map'), ' : quartiers, bâtiments, lieutenants, finances… et tous vos ordres en quelques clics.'),
      ],
    },
    {
      id: 'lieutenants',
      title: 'Vos lieutenants',
      icon: 'user',
      body: () => [
        p('Chaque lieutenant mène une escouade de gangsters. Confiez-lui des hommes, puis un ordre simple :'),
        p(strong('Attaquer · Défendre · Patrouiller · Renforcer · Tenir le toit · Attaquer par le métro · Suivre')),
        p('Ils traversent réellement la ville en 3D et se battent sur place : à pied, sur les toits ou par les tunnels du métro.'),
        p('Sur le terrain, appuyez sur ', kc('wheel'), ' près de vos hommes pour ouvrir la roue des ordres rapides ; visez un ennemi ou un bâtiment avant de donner l’ordre pour désigner la cible.'),
        p(fr(`Un lieutenant blessé quitte le combat et revient au bout de ${LIEUTENANT_RECOVERY} secondes.`)),
      ],
    },
    {
      id: 'recrutement',
      title: 'Recruter',
      icon: 'trophy',
      body: () => [
        p('Le recruteur de votre QG vous fournit de nouveaux gangsters : « Recruter 1 », « Recruter 5 » ou « Recruter 10 ». Les recrues vous attendent au QG : affectez-les à un lieutenant ou emmenez-les avec vous.'),
      ],
    },
    {
      id: 'telephone',
      title: 'Téléphone et véhicules',
      icon: 'send',
      body: () => [
        p('Votre téléphone (', kc('phone', 'Tab'), ') regroupe les actions rapides : alertes, appel d’un véhicule, taxi volant pour rentrer au QG et ordres rapides.'),
        p('Pour vos déplacements : moto, voitures, fourgon blindé… et, plus rare, un aéronef à décollage vertical qui se pose sur les toits.'),
      ],
    },
    {
      id: 'piratage',
      title: 'Piratage et drones',
      icon: 'link',
      body: () => [
        p('Maintenez ', kc('interact', 'E'), ' devant un terminal de sécurité pour le pirater : vous coupez les caméras et les tourelles, et vous ouvrez les portes verrouillées.'),
        p('Les drones de reconnaissance surveillent un quartier : les ennemis repérés apparaissent sur vos cartes.'),
      ],
    },
    {
      id: 'argent',
      title: 'L’argent, les braquages et les convois',
      icon: 'crown',
      body: () => [
        p('Chaque propriété que vous contrôlez vous rapporte un revenu passif, versé en continu dans vos caisses.'),
        p(fr(`Chaque quartier entièrement contrôlé ajoute ${money(DISTRICT_BONUS)} par minute.`)),
        p('Pour un gros coup, tentez un braquage ou interceptez un convoi : ce sont des activités libres, à lancer quand vous le voulez.'),
      ],
    },
    {
      id: 'police',
      title: 'La police de New York',
      icon: 'alert',
      body: () => [
        p('La police de New York (NYPD) réagit à la violence. Plus vous semez le désordre, plus votre niveau de recherche grimpe (les étoiles sous votre santé) et plus les patrouilles vous traquent.'),
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
            `Si vous tombez, vous reprenez connaissance à votre QG au bout de quelques secondes. La clinique se fait payer : ${Math.round(RESPAWN_PENALTY * 100)} % de votre argent, ${money(RESPAWN_PENALTY_MAX)} au plus.`,
          ),
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
      h('div', { class: 'mw-help-kicker' }, 'New York, 2085'),
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
  page.appendChild(h('p', { class: 'mw-help-end' }, fr('Bonne chance, parrain. New York n’attend que vous !')));

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
    h('p', { class: 'mw-credits-dedication' }, fr('Une suite créée pour Dadou et Even, rivaux de toujours.')),
    h('div', { class: 'divider mw-ink-divider' }),
    h(
      'div',
      { class: 'mw-credits-grid' },
      block('Technologies', h('ul', { class: 'mw-credit-list' }, tech('Three.js', 'rendu 3D'), tech('Socket.IO', 'jeu en réseau'), tech('Vite', 'outillage'), tech('TypeScript', 'langage'))),
      block(
        'Polices de caractères',
        h('ul', { class: 'mw-credit-list' }, tech('Orbitron', 'Matt McInerney'), tech('Rajdhani', 'Indian Type Foundry')),
        'Distribuées sous licence SIL Open Font License 1.1.',
      ),
      block(
        'Images et sons',
        'Tous les graphismes sont des voxels procéduraux : New York, ses habitants, ses néons et ses taxis volants sont générés par le programme.',
        'Tous les sons et toutes les musiques sont synthétisés en temps réel : aucun enregistrement n’est utilisé.',
        'Le logo, les emblèmes et le fond du menu sont eux aussi dessinés par le code.',
      ),
    ),
    h('div', { class: 'divider mw-ink-divider' }),
    h('p', { class: 'mw-credits-end' }, fr('New York, 2085 — merci d’avoir joué !')),
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
