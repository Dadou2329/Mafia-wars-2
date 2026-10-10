// Paramètres : graphismes, son, souris et vue, personnalisation des deux parrains.

import type { AppApi, Portraits } from '../../appApi';
import type { Slot } from '../../../shared/protocol';
import { BOSS_NAME, MAFIA_NAME } from '../../../shared/constants';
import { keyLabel } from '../../input/bindings';
import { resetSettings, saveSettings, settings, type Quality, type Settings } from '../../settings';
import { renderPortraits } from '../portraits';
import { clear, h } from '../dom';
import { BRAND, button, choose, closeOnEscape, fr, icon, inMatch, pct, shieldPointer, withSounds, type IconName } from './menu';

// ============================================================================ portraits à jour
// Les portraits de l'application sont rendus au démarrage. Si la tenue d'un parrain change
// ensuite, on les rend de nouveau (hors partie) pour le salon et l'aperçu.

const customSig = (): string => JSON.stringify(settings.custom);
const startSig = customSig();
let fresh: { sig: string; p: Promise<Portraits> } | null = null;

/** Portraits correspondant à la tenue actuelle. `render` : autoriser un nouveau rendu 3D. */
export function currentPortraits(app: AppApi, render = true): Promise<Portraits> {
  const sig = customSig();
  if (fresh && fresh.sig === sig) return fresh.p;
  if (sig === startSig) return app.portraits;
  if (!render) return fresh?.p ?? app.portraits;
  fresh = { sig, p: renderPortraits().catch(() => ({ dadou: '', even: '' })) };
  return fresh.p;
}

// ============================================================================ contrôles

function row(label: string, hint: string | null, control: HTMLElement, value?: HTMLElement): HTMLElement {
  return h(
    'div',
    { class: 'mw-row' },
    h('div', { class: 'mw-row-text' }, h('div', { class: 'mw-row-label' }, label), hint ? h('div', { class: 'mw-row-hint' }, fr(hint)) : null),
    h('div', { class: 'mw-row-control' }, control),
    value ?? h('span', { class: 'mw-row-value' }),
  );
}

function slider(
  label: string,
  o: { min: number; max: number; step: number; get(): number; set(v: number): void; fmt(v: number): string; commit?(): void },
): { input: HTMLInputElement; value: HTMLElement } {
  const input = h('input', { type: 'range', class: 'mw-range', min: String(o.min), max: String(o.max), step: String(o.step), 'aria-label': label });
  const value = h('span', { class: 'mw-row-value' });
  const paint = (v: number): void => {
    input.style.setProperty('--p', `${((v - o.min) / (o.max - o.min)) * 100}%`);
    value.textContent = o.fmt(v);
  };
  input.value = String(o.get());
  paint(o.get());
  let raf = 0;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    paint(v);
    o.set(v);
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        saveSettings();
      });
  });
  input.addEventListener('change', () => {
    saveSettings();
    o.commit?.();
  });
  return { input, value };
}

function segmented<T extends string>(
  app: AppApi,
  label: string,
  options: { value: T; label: string | Node | (string | Node)[]; title?: string }[],
  get: () => T,
  set: (v: T) => void,
): HTMLElement {
  const el = h('div', { class: 'mw-seg', role: 'radiogroup', 'aria-label': label });
  const btns = options.map((opt) => {
    const b = button(
      app,
      opt.label,
      'mw-seg-btn',
      () => {
        set(opt.value);
        paint();
      },
      { title: opt.title, role: 'radio' },
    );
    el.appendChild(b);
    return b;
  });
  const paint = (): void => {
    const cur = get();
    options.forEach((opt, i) => {
      const on = opt.value === cur;
      btns[i].setAttribute('aria-checked', on ? 'true' : 'false');
      btns[i].classList.toggle('is-on', on);
    });
  };
  el.addEventListener('keydown', (e) => {
    if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const n = (i + (e.code === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
    btns[n].focus();
    btns[n].click();
  });
  paint();
  return el;
}

function toggle(app: AppApi, label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', 'aria-label': label });
  input.checked = get();
  const text = h('span', { class: 'mw-toggle-text' }, input.checked ? 'Activé' : 'Désactivé');
  input.addEventListener('change', () => {
    app.click();
    set(input.checked);
    text.textContent = input.checked ? 'Activé' : 'Désactivé';
  });
  return withSounds(app, h('label', { class: 'toggle' }, input, h('span', { class: 'knob' }), text), false);
}

function crosshairIcon(kind: Settings['crosshair']): HTMLElement {
  const svg =
    kind === 'point'
      ? '<circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>'
      : kind === 'croix'
        ? '<path d="M12 4v5M12 15v5M4 12h5M15 12h5"/>'
        : '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>';
  return h('span', {
    class: 'mw-icon mw-cross-icon',
    'aria-hidden': 'true',
    html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${svg}</svg>`,
  });
}

const decimal = (v: number, d = 2): string => v.toFixed(d).replace('.', ',');

// ============================================================================ personnalisation

type CustomKey = 'coat' | 'vest' | 'tie' | 'hatband';
type Hat = 'bowler' | 'top' | 'flatcap';

interface Swatch {
  c: number;
  name: string;
}

const PALETTES: Record<CustomKey, Swatch[]> = {
  coat: [
    { c: 0x161418, name: 'Noir de jais' },
    { c: 0x1d3461, name: 'Bleu marine' },
    { c: 0x2b2b31, name: 'Anthracite' },
    { c: 0x3e2c22, name: 'Brun tabac' },
    { c: 0x2c3a2e, name: 'Vert bouteille' },
    { c: 0x4a1820, name: 'Bordeaux' },
    { c: 0x4d4439, name: 'Tweed taupe' },
    { c: 0x55606c, name: 'Gris ardoise' },
  ],
  vest: [
    { c: 0x5a1218, name: 'Grenat' },
    { c: 0x8a8f98, name: 'Gris perle' },
    { c: 0x2f4a3a, name: 'Vert anglais' },
    { c: 0x3e2a4c, name: 'Prune' },
    { c: 0x7a5526, name: 'Ocre' },
    { c: 0x6b4a2e, name: 'Cognac' },
    { c: 0xd9cfb4, name: 'Ivoire' },
    { c: 0x1c1c22, name: 'Noir' },
  ],
  tie: [
    { c: 0xa31e26, name: 'Rouge cardinal' },
    { c: 0xc9d1dc, name: 'Argent' },
    { c: 0xd4a640, name: 'Or' },
    { c: 0x1d3461, name: 'Bleu marine' },
    { c: 0x2e6a46, name: 'Émeraude' },
    { c: 0x5e2a6e, name: 'Violet' },
    { c: 0xe8e2d4, name: 'Blanc cassé' },
    { c: 0x161418, name: 'Noir' },
  ],
  hatband: [
    { c: 0x8e1b22, name: 'Cramoisi' },
    { c: 0x1d3461, name: 'Bleu marine' },
    { c: 0x161418, name: 'Noir' },
    { c: 0xd4a640, name: 'Or' },
    { c: 0xc9d1dc, name: 'Argent' },
    { c: 0x6b4a2e, name: 'Cuir' },
    { c: 0x2f4a3a, name: 'Vert anglais' },
    { c: 0x5e2a6e, name: 'Pourpre' },
  ],
};

const DEFAULT_LOOK: Record<Slot, Record<CustomKey, number> & { hat: Hat }> = {
  dadou: { coat: 0x161418, vest: 0x5a1218, tie: 0xa31e26, hatband: 0x8e1b22, hat: 'bowler' },
  even: { coat: 0x1d3461, vest: 0x8a8f98, tie: 0xc9d1dc, hatband: 0x1d3461, hat: 'top' },
};

const CUSTOM_ROWS: { key: CustomKey; label: string }[] = [
  { key: 'coat', label: 'Couleur du manteau' },
  { key: 'vest', label: 'Couleur du gilet' },
  { key: 'tie', label: 'Couleur de la cravate' },
  { key: 'hatband', label: 'Ruban du chapeau' },
];

const HATS: { value: Hat; label: string }[] = [
  { value: 'bowler', label: 'Melon' },
  { value: 'top', label: 'Haut-de-forme' },
  { value: 'flatcap', label: 'Casquette' },
];

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

function customValue(slot: Slot, key: CustomKey): number {
  const v = settings.custom[slot][key];
  return typeof v === 'number' ? v : DEFAULT_LOOK[slot][key];
}

function customHat(slot: Slot): Hat {
  const v = settings.custom[slot].hat;
  return v === 'bowler' || v === 'top' || v === 'flatcap' ? v : DEFAULT_LOOK[slot].hat;
}

// ============================================================================ panneau

type TabId = 'gfx' | 'sound' | 'mouse' | 'custom';

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'gfx', label: 'Graphismes', icon: 'gear' },
  { id: 'sound', label: 'Son', icon: 'sound' },
  { id: 'mouse', label: 'Souris & vue', icon: 'mouse' },
  { id: 'custom', label: 'Personnalisation', icon: 'hat' },
];

let lastTab: TabId = 'gfx';

export function settingsPanel(app: AppApi, opts: { inGame: boolean; onClose(): void }): HTMLElement {
  const content = h('div', { class: 'mw-tabpanel scroll', role: 'tabpanel' });
  const tabs = h('div', { class: 'mw-tabs', role: 'tablist', 'aria-label': 'Catégories de paramètres' });
  const tabBtns = new Map<TabId, HTMLButtonElement>();

  const panel = h(
    'div',
    { class: 'panel mw-dialog mw-settings fade-in', role: 'dialog', 'aria-label': 'Paramètres' },
    h(
      'header',
      { class: 'mw-dialog-head' },
      icon('gear', 'mw-head-icon'),
      h('h2', { class: 'title-l' }, 'Paramètres'),
      opts.inGame ? h('p', { class: 'mw-dialog-sub c-gold' }, fr('La partie continue pendant que vous réglez vos paramètres !')) : h('p', { class: 'mw-dialog-sub' }, fr('Vos choix sont enregistrés automatiquement.')),
    ),
    tabs,
    content,
  );

  // ------------------------------------------------------------ onglets
  function show(id: TabId, focus = false): void {
    lastTab = id;
    for (const [tid, b] of tabBtns) {
      const on = tid === id;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    clear(content);
    content.scrollTop = 0;
    const page = id === 'gfx' ? graphics() : id === 'sound' ? sound() : id === 'mouse' ? mouse() : custom();
    page.classList.add('mw-page');
    content.appendChild(page);
  }
  for (const t of TABS) {
    const b = button(app, [icon(t.icon), h('span', null, t.label)], 'mw-tab', () => show(t.id), { role: 'tab', 'aria-selected': 'false' });
    tabBtns.set(t.id, b);
    tabs.appendChild(b);
  }
  tabs.addEventListener('keydown', (e) => {
    if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === lastTab);
    const n = (i + (e.code === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    show(TABS[n].id, true);
  });

  // ------------------------------------------------------------ graphismes
  function graphics(): HTMLElement {
    const scale = slider('Échelle de rendu', {
      min: 50,
      max: 100,
      step: 5,
      get: () => Math.round(settings.renderScale * 100),
      set: (v) => (settings.renderScale = v / 100),
      fmt: (v) => pct(v / 100),
    });
    const fov = slider('Champ de vision', {
      min: 60,
      max: 100,
      step: 1,
      get: () => settings.fov,
      set: (v) => (settings.fov = v),
      fmt: (v) => `${v}°`,
    });
    const quality = segmented<Quality>(
      app,
      'Qualité',
      [
        { value: 'basse', label: 'Basse' },
        { value: 'moyenne', label: 'Moyenne' },
        { value: 'haute', label: 'Haute' },
        { value: 'ultra', label: 'Ultra' },
      ],
      () => settings.quality,
      (v) => {
        settings.quality = v;
        saveSettings();
      },
    );
    return h(
      'div',
      null,
      row('Qualité', 'Ombres, distance d’affichage et anticrénelage.', quality),
      row('Échelle de rendu', 'Une échelle réduite allège le travail de la carte graphique.', scale.input, scale.value),
      row(
        'Effet de lueur',
        'Halo des réverbères et des fenêtres éclairées.',
        toggle(app, 'Effet de lueur', () => settings.bloom, (v) => {
          settings.bloom = v;
          saveSettings();
        }),
      ),
      row(
        'Afficher les FPS',
        'Compteur d’images par seconde pendant la partie.',
        toggle(app, 'Afficher les FPS', () => settings.showFps, (v) => {
          settings.showFps = v;
          saveSettings();
        }),
      ),
      row('Champ de vision', 'Angle de vue de la caméra.', fov.input, fov.value),
    );
  }

  // ------------------------------------------------------------ son
  function sound(): HTMLElement {
    const vol = (label: string, key: 'volMaster' | 'volMusic' | 'volSfx' | 'volAmbience', hint: string | null, preview?: () => void): HTMLElement => {
      const s = slider(label, {
        min: 0,
        max: 100,
        step: 1,
        get: () => Math.round(settings[key] * 100),
        set: (v) => (settings[key] = v / 100),
        fmt: (v) => pct(v / 100),
        commit: preview,
      });
      return row(label, hint, s.input, s.value);
    };
    return h(
      'div',
      null,
      vol('Volume général', 'volMaster', null, () => app.audio.play('ui_click')),
      vol('Musique', 'volMusic', 'Thèmes du menu et de la partie.'),
      vol('Effets', 'volSfx', 'Coups de feu, pas, interface…', () => app.audio.play('notify')),
      vol('Ambiance', 'volAmbience', 'Rumeur de la ville, cloches, pluie et brouillard sur la Tamise.'),
      h('p', { class: 'mw-page-note' }, icon('info'), fr('Tous les sons du jeu sont synthétisés en temps réel : aucun fichier audio n’est téléchargé.')),
    );
  }

  // ------------------------------------------------------------ souris et vue
  function mouse(): HTMLElement {
    const sens = slider('Sensibilité', {
      min: 0.2,
      max: 3,
      step: 0.05,
      get: () => settings.sensitivity,
      set: (v) => (settings.sensitivity = v),
      fmt: (v) => decimal(v),
    });
    const viewKey = settings.bindings.view[0] ? keyLabel(settings.bindings.view[0]) : null;
    return h(
      'div',
      null,
      row('Sensibilité', 'Vitesse de rotation de la caméra à la souris.', sens.input, sens.value),
      row(
        'Inverser l’axe vertical',
        'Pousser la souris vers l’avant fait regarder vers le bas.',
        toggle(app, 'Inverser l’axe vertical', () => settings.invertY, (v) => {
          settings.invertY = v;
          saveSettings();
        }),
      ),
      row(
        'Vue à la troisième personne par défaut',
        viewKey ? `Changez de vue en partie avec la touche ${viewKey}.` : null,
        toggle(app, 'Vue à la troisième personne par défaut', () => settings.thirdPerson, (v) => {
          settings.thirdPerson = v;
          saveSettings();
        }),
      ),
      row(
        'Réticule',
        'Forme du viseur au centre de l’écran.',
        segmented<Settings['crosshair']>(
          app,
          'Réticule',
          [
            { value: 'point', label: [crosshairIcon('point'), 'Point'] },
            { value: 'croix', label: [crosshairIcon('croix'), 'Croix'] },
            { value: 'cercle', label: [crosshairIcon('cercle'), 'Cercle'] },
          ],
          () => settings.crosshair,
          (v) => {
            settings.crosshair = v;
            saveSettings();
          },
        ),
      ),
    );
  }

  // ------------------------------------------------------------ personnalisation
  const previews = new Map<Slot, HTMLImageElement>();
  let previewTimer = 0;
  let previewToken = 0;
  const showPreview = !opts.inGame && !inMatch(app);

  function refreshPreviews(delay: number): void {
    if (!showPreview) return;
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      const token = ++previewToken;
      for (const img of previews.values()) img.parentElement?.classList.add('is-busy');
      void currentPortraits(app).then((p) => {
        if (token !== previewToken) return;
        for (const [slot, img] of previews) {
          img.parentElement?.classList.remove('is-busy');
          if (p[slot]) {
            img.src = p[slot];
            img.classList.remove('is-emblem');
          } else {
            img.src = BRAND.emblem[slot];
            img.classList.add('is-emblem');
          }
        }
      });
    }, delay);
  }

  // (en partie, le client de jeu renvoie la tenue au serveur à chaque enregistrement)
  function changed(): void {
    saveSettings();
    refreshPreviews(350);
  }

  function custom(): HTMLElement {
    previews.clear();
    const col = (slot: Slot): HTMLElement => {
      const rows = h('div', { class: 'mw-look-rows' });
      const repaint: (() => void)[] = [];
      for (const r of CUSTOM_ROWS) {
        const sw = h('div', { class: 'mw-swatches', role: 'radiogroup', 'aria-label': `${r.label} de ${BOSS_NAME[slot]}` });
        const btns: [HTMLButtonElement, number][] = [];
        for (const s of PALETTES[r.key]) {
          const isDefault = s.c === DEFAULT_LOOK[slot][r.key];
          const b = button(
            app,
            isDefault ? h('span', { class: 'mw-swatch-def', 'aria-hidden': 'true' }) : '',
            'mw-swatch',
            () => {
              settings.custom[slot][r.key] = s.c;
              changed();
              for (const f of repaint) f();
            },
            { title: isDefault ? `${s.name} (d’origine)` : s.name, role: 'radio', 'aria-label': s.name, style: `--sw:${hex(s.c)}` },
          );
          btns.push([b, s.c]);
          sw.appendChild(b);
        }
        repaint.push(() => {
          const cur = customValue(slot, r.key);
          for (const [b, c] of btns) {
            b.setAttribute('aria-checked', c === cur ? 'true' : 'false');
            b.classList.toggle('is-on', c === cur);
          }
        });
        rows.appendChild(h('div', { class: 'mw-look-row' }, h('div', { class: 'mw-look-label' }, r.label), sw));
      }
      const hat = segmented<Hat>(
        app,
        `Chapeau de ${BOSS_NAME[slot]}`,
        HATS.map((x) => ({ value: x.value, label: x.label, title: x.value === DEFAULT_LOOK[slot].hat ? `${x.label} (d’origine)` : x.label })),
        () => customHat(slot),
        (v) => {
          settings.custom[slot].hat = v;
          changed();
        },
      );
      rows.appendChild(h('div', { class: 'mw-look-row' }, h('div', { class: 'mw-look-label' }, 'Chapeau'), hat));
      for (const f of repaint) f();

      const img = h('img', { class: 'mw-look-portrait is-emblem', src: BRAND.emblem[slot], alt: `Aperçu de ${BOSS_NAME[slot]}`, draggable: false });
      previews.set(slot, img);
      const reset = button(app, [icon('reset'), 'Tenue d’origine'], 'btn small ghost mw-look-reset', () => {
        settings.custom[slot] = {};
        changed();
        const next = col(slot);
        column.replaceWith(next);
        column = next;
      });
      let column = h(
        'section',
        { class: `mw-look mw-look--${slot}` },
        h(
          'header',
          { class: 'mw-look-head' },
          h('img', { class: 'mw-look-emblem', src: BRAND.emblem[slot], alt: '', draggable: false }),
          h('div', null, h('div', { class: 'mw-look-name' }, BOSS_NAME[slot]), h('div', { class: 'mw-look-mafia' }, MAFIA_NAME[slot])),
          reset,
        ),
        h(
          'div',
          { class: 'mw-look-body' },
          showPreview ? h('div', { class: 'mw-look-preview' }, img, h('div', { class: 'mw-spinner' })) : null,
          rows,
        ),
      );
      return column;
    };
    const page = h(
      'div',
      { class: 'mw-custom' },
      h(
        'p',
        { class: 'mw-page-intro' },
        fr('Choisissez la tenue de chaque parrain : elle s’applique quand vous l’incarnez, et votre adversaire la verra en jeu. '),
        h('strong', null, fr('Les noms et les couleurs de faction restent ceux de Dadou et d’Even.')),
      ),
      h('div', { class: 'mw-look-cols' }, col('dadou'), col('even')),
    );
    refreshPreviews(0);
    return page;
  }

  // ------------------------------------------------------------ pied
  const resetAll = button(app, [icon('reset'), 'Réinitialiser'], 'btn small ghost', () => {
    void choose(app, panel, {
      title: 'Réinitialiser les paramètres ?',
      text: fr('Tous les réglages reprendront leur valeur d’origine, y compris les touches et la tenue des parrains. Votre nom est conservé.'),
      icon: 'reset',
      choices: [
        { label: 'Annuler', value: 'no', cls: 'btn ghost' },
        { label: 'Réinitialiser', value: 'yes', cls: 'btn danger' },
      ],
      cancel: 'no',
      focus: 'no',
    }).then((v) => {
      if (v !== 'yes') return;
      resetSettings(true);
      show(lastTab);
    });
  });
  const close = button(app, 'Fermer', 'btn', () => opts.onClose());
  panel.appendChild(h('footer', { class: 'mw-dialog-foot' }, resetAll, h('span', { class: 'mw-foot-spacer' }), close));

  closeOnEscape(app, panel, () => {
    app.click();
    opts.onClose();
  });
  shieldPointer(panel, true);
  show(lastTab);
  return panel;
}
