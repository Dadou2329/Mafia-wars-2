// Salons : choix des parrains, préparation, lancement, reconnexion, revanche.

import type { Server, Socket } from 'socket.io';
import { BOSS_NAME, TICK_DT } from '../shared/constants';
import { encodeSnapshot, type ClientAction, type MatchSettings, type PlayerInput, type RoomState, type Slot } from '../shared/protocol';
import { Game, SLOTS, otherSlot } from './game/Game';
import { getWorld } from './world';

export interface Session {
  id: string;
  name: string;
  socket: Socket | null;
  room: Room | null;
  ready: boolean;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export const rooms = new Map<string, Room>();

export function makeCode(): string {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

export class Room {
  readonly code: string;
  readonly io: Server;
  phase: RoomState['phase'] = 'lobby';
  members = new Map<string, Session>();
  host: string | null = null;
  picks: Record<Slot, string | null> = { dadou: null, even: null };
  settings: MatchSettings = { timeLimit: 0, daytime: 'cycle', tutorial: true };
  game: Game | null = null;
  private timer: NodeJS.Timeout | null = null;
  private errors = 0;
  private lastSent: Record<Slot, Map<number, number>> = { dadou: new Map(), even: new Map() };
  private pausedSince = -1;
  private rematch = new Set<string>();
  emptySince = -1;

  constructor(io: Server, code: string) {
    this.io = io;
    this.code = code;
  }

  get channel(): string {
    return `room:${this.code}`;
  }

  slotOf(sessionId: string): Slot | null {
    if (this.picks.dadou === sessionId) return 'dadou';
    if (this.picks.even === sessionId) return 'even';
    return null;
  }

  join(s: Session): void {
    this.members.set(s.id, s);
    s.room = this;
    if (!this.host) this.host = s.id;
    s.socket?.join(this.channel);
    this.emptySince = -1;
    this.broadcastState();
    if (this.phase !== 'lobby' && this.game) {
      const slot = this.slotOf(s.id);
      if (slot) {
        this.sendInit(s, slot);
        this.game.factions[slot].connected = true;
        this.game.notify(otherSlot(slot), `${BOSS_NAME[slot]} est de retour.`, 'info');
      }
    }
  }

  leave(s: Session): void {
    const slot = this.slotOf(s.id);
    if (this.phase === 'lobby') {
      if (slot) this.picks[slot] = null;
      this.members.delete(s.id);
      if (this.host === s.id) this.host = this.members.keys().next().value ?? null;
    } else {
      // en partie : on garde la place (reconnexion possible)
      this.members.delete(s.id);
      if (slot && this.game) this.game.factions[slot].connected = false;
    }
    s.socket?.leave(this.channel);
    s.room = null;
    if (this.members.size === 0) this.emptySince = Date.now();
    this.broadcastState();
  }

  disconnected(s: Session): void {
    const slot = this.slotOf(s.id);
    if (this.phase === 'playing' && slot && this.game) {
      this.game.factions[slot].connected = false;
      this.game.notify(otherSlot(slot), `${BOSS_NAME[slot]} s’est déconnecté. La partie est en pause.`, 'alert');
    }
    if (this.phase === 'lobby') s.ready = false;
    this.broadcastState();
  }

  state(): RoomState {
    const players: RoomState['players'] = {};
    for (const [id, s] of this.members) {
      players[id] = { slot: this.slotOf(id), name: s.name, connected: !!s.socket?.connected, ready: s.ready, isHost: this.host === id };
    }
    return { code: this.code, phase: this.phase, host: this.host, players, picks: { ...this.picks }, settings: this.settings };
  }

  broadcastState(): void {
    this.io.to(this.channel).emit('room:state', this.state());
  }

  pick(s: Session, slot: Slot | null): void {
    if (this.phase !== 'lobby') return;
    const cur = this.slotOf(s.id);
    if (slot === null || cur === slot) {
      if (cur) this.picks[cur] = null;
      s.ready = false;
    } else {
      if (this.picks[slot] && this.picks[slot] !== s.id && this.members.has(this.picks[slot]!)) return;
      if (cur) this.picks[cur] = null;
      this.picks[slot] = s.id;
      s.ready = false;
    }
    this.broadcastState();
  }

  ready(s: Session, ready: boolean): void {
    if (this.phase !== 'lobby') return;
    if (!this.slotOf(s.id)) return;
    s.ready = ready;
    this.broadcastState();
    // lancement automatique quand les deux parrains sont prêts
    if (this.canStart()) this.start();
  }

  setSettings(s: Session, settings: Partial<MatchSettings>): void {
    if (this.host !== s.id || this.phase !== 'lobby') return;
    if (typeof settings.timeLimit === 'number' && [0, 20, 30, 45, 60, 90].includes(settings.timeLimit)) this.settings.timeLimit = settings.timeLimit;
    if (settings.daytime && ['cycle', 'night', 'dusk'].includes(settings.daytime)) this.settings.daytime = settings.daytime;
    if (typeof settings.tutorial === 'boolean') this.settings.tutorial = settings.tutorial;
    for (const m of this.members.values()) m.ready = false;
    this.broadcastState();
  }

  canStart(): boolean {
    for (const slot of SLOTS) {
      const id = this.picks[slot];
      if (!id) return false;
      const s = this.members.get(id);
      if (!s || !s.ready || !s.socket?.connected) return false;
    }
    return true;
  }

  start(): void {
    if (this.phase === 'playing') return;
    this.game = new Game(getWorld(), this.settings);
    this.game.takeOutbox();
    this.phase = 'playing';
    this.lastSent = { dadou: new Map(), even: new Map() };
    this.rematch.clear();
    this.broadcastState();
    for (const slot of SLOTS) {
      const s = this.members.get(this.picks[slot]!);
      if (s) this.sendInit(s, slot);
    }
    this.game.news('GUERRE DES GANGS : DADOU ET EVEN SE DISPUTENT LONDRES !', 'Deux parrains rivaux, le flamboyant Dadou et l’élégant Even, se sont juré de régner seuls sur la capitale. Les honnêtes gens sont priés de rester chez eux après la tombée de la nuit.');
    this.game.notify('dadou', 'Arthur Collins attend vos ordres, Dadou.', 'info');
    this.game.notify('even', 'William Hayes attend vos ordres, Even.', 'info');
    if (this.timer) clearInterval(this.timer);
    let last = Date.now();
    let acc = 0;
    this.timer = setInterval(() => {
      const now = Date.now();
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= TICK_DT) {
        acc -= TICK_DT;
        try {
          this.tick();
        } catch (e) {
          // une erreur de simulation ne doit pas faire tomber le serveur ni les autres salons
          console.error(`[salon ${this.code}] erreur de simulation :`, e);
          this.errors++;
          if (this.errors > 50) {
            console.error(`[salon ${this.code}] trop d'erreurs : arrêt de la partie.`);
            if (this.timer) clearInterval(this.timer);
            this.timer = null;
          }
          break;
        }
      }
    }, 1000 * TICK_DT * 0.5);
  }

  private sendInit(s: Session, slot: Slot): void {
    const g = this.game!;
    this.lastSent[slot] = new Map();
    s.socket?.emit('game:init', {
      you: slot,
      code: this.code,
      settings: this.settings,
      time: g.time,
      infos: g.allInfos(),
      pub: g.publicState(),
      priv: g.privateState(slot),
      over: g.over,
    });
  }

  private tick(): void {
    const g = this.game;
    if (!g) return;
    // pause si un joueur est absent (au plus 3 minutes)
    const missing = SLOTS.filter((sl) => {
      const id = this.picks[sl];
      const s = id ? this.members.get(id) : undefined;
      return !s || !s.socket?.connected;
    });
    if (missing.length > 0 && !g.over) {
      if (this.pausedSince < 0) this.pausedSince = Date.now();
      if (Date.now() - this.pausedSince < 180000) {
        if (g.tick % 20 === 0) {
          for (const slot of SLOTS) {
            const s = this.sessionFor(slot);
            s?.socket?.emit('pause', { waitingFor: missing.map((m) => BOSS_NAME[m]), since: (Date.now() - this.pausedSince) / 1000 });
          }
        }
        // on garde le compteur de ticks pour l'envoi d'états
        g.tick++;
        this.sendStates(g, true);
        return;
      }
    } else if (this.pausedSince >= 0) {
      this.pausedSince = -1;
      for (const slot of SLOTS) this.sessionFor(slot)?.socket?.emit('pause', null);
    }
    g.step();
    this.sendStates(g, false);
    if (g.over && this.phase === 'playing') {
      this.phase = 'ended';
      this.broadcastState();
    }
  }

  private sessionFor(slot: Slot): Session | undefined {
    const id = this.picks[slot];
    return id ? this.members.get(id) : undefined;
  }

  private sendStates(g: Game, paused: boolean): void {
    const out = g.takeOutbox();
    for (const slot of SLOTS) {
      const s = this.sessionFor(slot);
      if (!s?.socket?.connected) continue;
      if (!paused) {
        const ents = g.snapshotFor(slot, this.lastSent[slot]);
        s.socket.emit('s', encodeSnapshot(g.time, g.tick, ents));
      }
      const evs = [...out.all, ...out[slot]];
      if (evs.length) s.socket.emit('ev', evs);
      if (g.tick % 10 === 0) {
        s.socket.emit('pub', g.publicState());
        s.socket.emit('priv', g.privateState(slot));
      }
    }
  }

  input(s: Session, inp: PlayerInput): void {
    const slot = this.slotOf(s.id);
    if (!slot || !this.game || this.phase !== 'playing') return;
    if (!Array.isArray(inp) || inp.length < 11) return;
    this.game.input(slot, inp);
  }

  fire(s: Session, data: { w: number; o: number[]; d: number[]; hits: number[][] }): void {
    const slot = this.slotOf(s.id);
    if (!slot || !this.game || this.phase !== 'playing') return;
    if (!data || !Array.isArray(data.o) || !Array.isArray(data.d) || !Array.isArray(data.hits)) return;
    this.game.playerFire(slot, data);
  }

  melee(s: Session, data: { w: number; target: number }): void {
    const slot = this.slotOf(s.id);
    if (!slot || !this.game || this.phase !== 'playing') return;
    this.game.playerMelee(slot, data.w, data.target);
  }

  reload(s: Session): void {
    const slot = this.slotOf(s.id);
    if (!slot || !this.game) return;
    this.game.playerReload(slot);
  }

  action(s: Session, act: ClientAction): void {
    const slot = this.slotOf(s.id);
    if (!slot || !this.game || !act || typeof act !== 'object') return;
    if (act.a === 'rematch') {
      if (this.phase !== 'ended') return;
      this.rematch.add(s.id);
      this.io.to(this.channel).emit('rematch', { votes: [...this.rematch].map((id) => this.slotOf(id)) });
      if (this.picks.dadou && this.picks.even && this.rematch.has(this.picks.dadou) && this.rematch.has(this.picks.even)) {
        this.phase = 'lobby';
        this.start();
      }
      return;
    }
    if (this.phase !== 'playing') return;
    this.game.action(slot, act);
  }

  chat(s: Session, text: string): void {
    const t = String(text ?? '').slice(0, 200).trim();
    if (!t) return;
    const slot = this.slotOf(s.id);
    if (this.phase === 'lobby' || !this.game) {
      this.io.to(this.channel).emit('lobby:chat', { from: slot ?? s.name, text: t });
    } else if (slot) {
      this.game.emitAll({ t: 'chat', from: slot, text: t });
    }
  }

  backToLobby(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.game = null;
    this.phase = 'lobby';
    for (const m of this.members.values()) m.ready = false;
    this.broadcastState();
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.game = null;
  }
}
