// Connexion au serveur de jeu (Socket.IO) : session persistante, salons, messages de jeu.

import { io, type Socket } from 'socket.io-client';
import type { ClientAction, MatchSettings, PlayerInput, RoomState, Slot } from '../../shared/protocol';
import { settings } from '../settings';

const TOKEN_KEY = 'mafiawars.token';

type Handler = (...args: never[]) => void;

/** Actions liées à l'instant : sans objet après une coupure (le parrain a pu être replacé). */
const realtime = (a: ClientAction): boolean =>
  a.a === 'ab' || a.a === 'grenade' || a.a === 'interact' || a.a === 'op' || (a.a === 'vehicle' && (a.op === 'enter' || a.op === 'exit'));

export class Net {
  readonly socket: Socket;
  token: string;
  connected = false;
  room: RoomState | null = null;
  rtt = 0;
  private handlers = new Map<string, Set<Handler>>();
  /** Actions faites pendant une coupure : envoyées au retour (si elles sont récentes). */
  private pending: { a: ClientAction; at: number }[] = [];
  private helloDone: Promise<void>;
  private resolveHello!: () => void;

  constructor() {
    let t = '';
    try {
      t = sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY) ?? '';
    } catch {
      /* rien */
    }
    if (!t) t = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    this.token = t;
    try {
      // un onglet = une session (on peut ouvrir deux onglets pour tester)
      sessionStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* rien */
    }
    const params = new URLSearchParams(location.search);
    const server = params.get('server') ?? undefined;
    this.socket = io(server ?? '/', { transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 800 });
    this.helloDone = new Promise((r) => (this.resolveHello = r));
    this.socket.on('connect', () => {
      this.socket.emit('hello', { token: this.token, name: settings.name }, (r: { token: string; room: string | null }) => {
        this.token = r.token;
        try {
          sessionStorage.setItem(TOKEN_KEY, r.token);
        } catch {
          /* rien */
        }
        this.connected = true;
        this.emitLocal('connected', r.room);
        this.resolveHello();
        // actions faites pendant la coupure (achats, ordres…) : moins de 10 s, dans l'ordre
        const now = performance.now();
        const queued = this.pending.filter((p) => now - p.at < 10000);
        this.pending = [];
        for (const p of queued) this.socket.emit('act', p.a);
      });
    });
    this.socket.on('disconnect', () => {
      this.connected = false;
      this.emitLocal('disconnected');
    });
    this.socket.on('room:state', (s: RoomState) => {
      this.room = s;
      this.emitLocal('room', s);
    });
    // relais des messages serveur vers les abonnés
    for (const ev of ['game:init', 's', 'ev', 'pub', 'priv', 'pause', 'rematch', 'lobby:chat']) {
      this.socket.on(ev, (...a: unknown[]) => this.emitLocal(ev, ...a));
    }
    setInterval(() => {
      if (!this.connected) return;
      const t0 = performance.now();
      this.socket.emit('ping2', t0, () => {
        const r = performance.now() - t0;
        this.rtt = this.rtt ? this.rtt * 0.8 + r * 0.2 : r;
      });
    }, 2000);
  }

  ready(): Promise<void> {
    return this.helloDone;
  }

  on(ev: string, fn: Handler): () => void {
    let s = this.handlers.get(ev);
    if (!s) this.handlers.set(ev, (s = new Set()));
    s.add(fn);
    return () => s!.delete(fn);
  }

  private emitLocal(ev: string, ...args: unknown[]): void {
    const s = this.handlers.get(ev);
    if (!s) return;
    for (const fn of [...s]) (fn as (...a: unknown[]) => void)(...args);
  }

  private request<T>(ev: string, data: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      // au lancement, la génération de la ville occupe la page : la réponse peut être lue en
      // retard. Tant que la connexion tient, on patiente (jusqu'à 30 s) ; coupée, on abandonne.
      const t0 = performance.now();
      let timer = 0;
      const check = (): void => {
        if (this.socket.connected && performance.now() - t0 < 30000) timer = window.setTimeout(check, 4000);
        else reject(new Error('Le serveur ne répond pas.'));
      };
      timer = window.setTimeout(check, 8000);
      this.socket.emit(ev, data, (r: T) => {
        clearTimeout(timer);
        resolve(r);
      });
    });
  }

  async createRoom(): Promise<{ ok: boolean; code?: string; error?: string }> {
    await this.ready();
    return this.request('room:create', {});
  }

  async joinRoom(code: string): Promise<{ ok: boolean; code?: string; error?: string }> {
    await this.ready();
    return this.request('room:join', { code });
  }

  leaveRoom(): void {
    this.socket.emit('room:leave');
    this.room = null;
  }

  pick(slot: Slot | null): void {
    this.socket.emit('room:pick', { slot });
  }

  setReady(ready: boolean): void {
    this.socket.emit('room:ready', { ready });
  }

  setMatchSettings(s: Partial<MatchSettings>): void {
    this.socket.emit('room:settings', s);
  }

  setName(name: string): void {
    this.socket.emit('room:name', { name });
  }

  chat(text: string): void {
    this.socket.emit('chat', { text });
  }

  sendInput(inp: PlayerInput): void {
    this.socket.volatile.emit('p', inp);
  }

  fire(data: { w: number; o: number[]; d: number[]; hits: number[][] }): void {
    this.socket.emit('fire', data);
  }

  melee(w: number, target: number): void {
    this.socket.emit('melee', { w, target });
  }

  reload(): void {
    this.socket.emit('reload');
  }

  act(a: ClientAction): void {
    // pendant une reconnexion, le serveur ignorerait l'action (session pas encore rétablie) : on
    // garde les achats et ordres, pas les gestes en temps réel (capacité, grenade, portière…)
    if (!this.connected) {
      if (!realtime(a)) this.pending.push({ a, at: performance.now() });
      if (this.pending.length > 40) this.pending.shift();
      return;
    }
    this.socket.emit('act', a);
  }

  /** Mon identifiant de session et ma place dans le salon. */
  mySlot(): Slot | null {
    const r = this.room;
    if (!r) return null;
    if (r.picks.dadou === this.token) return 'dadou';
    if (r.picks.even === this.token) return 'even';
    return null;
  }
}
