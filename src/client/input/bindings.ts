// Actions remappables et libellés de touches (codes physiques → libellés selon la disposition).

export type ActionId =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'jump'
  | 'crouch'
  | 'interact'
  | 'view'
  | 'wheel'
  | 'map'
  | 'reload'
  | 'fire'
  | 'aim'
  | 'weapon1'
  | 'weapon2'
  | 'weapon3'
  | 'weapon4'
  | 'weaponNext'
  | 'chat'
  | 'scores';

export interface ActionDef {
  id: ActionId;
  label: string; // français
  group: 'Déplacements' | 'Combat' | 'Commandement' | 'Interface';
  def: string[]; // codes par défaut (KeyW, Mouse0…)
}

export const ACTIONS: ActionDef[] = [
  { id: 'forward', label: 'Avancer', group: 'Déplacements', def: ['KeyW'] },
  { id: 'back', label: 'Reculer', group: 'Déplacements', def: ['KeyS'] },
  { id: 'left', label: 'Pas à gauche', group: 'Déplacements', def: ['KeyA'] },
  { id: 'right', label: 'Pas à droite', group: 'Déplacements', def: ['KeyD'] },
  { id: 'sprint', label: 'Sprinter', group: 'Déplacements', def: ['ShiftLeft'] },
  { id: 'jump', label: 'Sauter', group: 'Déplacements', def: ['Space'] },
  { id: 'crouch', label: 'S’accroupir', group: 'Déplacements', def: ['KeyC'] },
  { id: 'fire', label: 'Tirer / frapper', group: 'Combat', def: ['Mouse0'] },
  { id: 'aim', label: 'Viser', group: 'Combat', def: ['Mouse2'] },
  { id: 'reload', label: 'Recharger', group: 'Combat', def: ['KeyR'] },
  { id: 'weapon1', label: 'Poings', group: 'Combat', def: ['Digit1'] },
  { id: 'weapon2', label: 'Revolver', group: 'Combat', def: ['Digit2'] },
  { id: 'weapon3', label: 'Arme longue (fusil / carabine)', group: 'Combat', def: ['Digit3'] },
  { id: 'weapon4', label: 'Arme blanche (couteau / matraque)', group: 'Combat', def: ['Digit4'] },
  { id: 'weaponNext', label: 'Arme suivante', group: 'Combat', def: ['WheelDown'] },
  { id: 'interact', label: 'Interagir', group: 'Commandement', def: ['KeyE'] },
  { id: 'wheel', label: 'Menu des ordres rapides', group: 'Commandement', def: ['KeyQ'] },
  { id: 'map', label: 'Carte de la ville', group: 'Commandement', def: ['KeyM'] },
  { id: 'view', label: 'Vue 1re / 3e personne', group: 'Interface', def: ['KeyV'] },
  { id: 'chat', label: 'Discuter', group: 'Interface', def: ['Enter'] },
  { id: 'scores', label: 'Bilan de la partie', group: 'Interface', def: ['Tab'] },
];

export type Bindings = Record<ActionId, string[]>;

export function defaultBindings(): Bindings {
  const b = {} as Bindings;
  for (const a of ACTIONS) b[a.id] = [...a.def];
  return b;
}

/** Codes réservés (non remappables). */
export const RESERVED = new Set(['Escape']);

const layoutMap = new Map<string, string>();
const learned = new Map<string, string>();

/** Récupère la disposition clavier (Chrome) pour afficher « Z » au lieu de « W » en AZERTY. */
export async function loadKeyboardLayout(): Promise<void> {
  const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
  if (!kb?.getLayoutMap) return;
  try {
    const m = await kb.getLayoutMap();
    for (const [code, key] of m) layoutMap.set(code, key);
  } catch {
    /* indisponible */
  }
}

/** Apprend la disposition au fil des frappes (navigateurs sans getLayoutMap). */
export function learnKey(e: KeyboardEvent): void {
  if (e.key && e.key.length === 1 && /\S/.test(e.key)) learned.set(e.code, e.key);
}

const NAMES: Record<string, string> = {
  Mouse0: 'Clic gauche',
  Mouse1: 'Clic milieu',
  Mouse2: 'Clic droit',
  Mouse3: 'Bouton 4',
  Mouse4: 'Bouton 5',
  WheelUp: 'Molette ↑',
  WheelDown: 'Molette ↓',
  Space: 'Espace',
  ShiftLeft: 'Maj gauche',
  ShiftRight: 'Maj droite',
  ControlLeft: 'Ctrl gauche',
  ControlRight: 'Ctrl droit',
  AltLeft: 'Alt',
  AltRight: 'Alt Gr',
  Enter: 'Entrée',
  Tab: 'Tab',
  Backspace: 'Retour',
  CapsLock: 'Verr. maj',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Échap',
  Backquote: '²',
  Delete: 'Suppr',
  Insert: 'Inser',
  Home: 'Début',
  End: 'Fin',
  PageUp: 'Pg préc.',
  PageDown: 'Pg suiv.',
};

export function keyLabel(code: string): string {
  if (NAMES[code]) return NAMES[code];
  const k = layoutMap.get(code) ?? learned.get(code);
  if (k) return k.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Pavé ' + code.slice(6);
  if (/^F\d+$/.test(code)) return code;
  return code;
}

/** Libellé de la première touche liée à une action. */
export function actionKey(b: Bindings, a: ActionId): string {
  const c = b[a]?.[0];
  return c ? keyLabel(c) : '—';
}

/** Actions qui utilisent déjà ce code (conflits). */
export function conflicts(b: Bindings, code: string, except?: ActionId): ActionId[] {
  const out: ActionId[] = [];
  for (const a of ACTIONS) if (a.id !== except && b[a.id].includes(code)) out.push(a.id);
  return out;
}
