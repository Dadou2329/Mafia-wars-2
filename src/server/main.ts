// Serveur de jeu : fichiers statiques du client + Socket.IO (salons et parties).

import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Room, makeCode, rooms, type Session } from './room';
import { getWorld } from './world';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const here = fileURLToPath(new URL('.', import.meta.url));
// en production : dist/server/main.js → dist/client ; lancé depuis les sources (tsx) :
// on sert dist/client s'il a été compilé (npm run build:client)
const CLIENT_DIR = resolve(
  process.env.CLIENT_DIR ?? (existsSync(join(here, '..', 'client', 'index.html')) ? join(here, '..', 'client') : join(here, '..', '..', 'dist', 'client')),
);

/**
 * Exécutable autonome (MafiaWars.exe, « single executable application » de Node) : les
 * fichiers du client sont embarqués dans l'exécutable et lus en mémoire.
 */
let embedded: ((p: string) => Buffer | null) | null = null;
try {
  const sea = createRequire(import.meta.url)('node:sea') as { isSea(): boolean; getAsset(k: string): ArrayBuffer };
  if (sea.isSea()) {
    embedded = (p) => {
      try {
        return Buffer.from(sea.getAsset(`client${p}`));
      } catch {
        return null;
      }
    };
  }
} catch {
  /* Node sans module node:sea : fichiers sur disque */
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (embedded) {
    const hit = p.includes('..') ? null : embedded(p);
    const data = hit ?? embedded('/index.html');
    const ext = hit ? extname(p) : '.html';
    res.writeHead(data ? 200 : 404, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': hit && p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data ?? '');
    return;
  }
  const file = normalize(join(CLIENT_DIR, p));
  if (!file.startsWith(CLIENT_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const st = await stat(file);
    if (st.isDirectory()) throw new Error('dir');
    const data = await readFile(file);
    const ext = extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  } catch {
    try {
      const data = await readFile(join(CLIENT_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(data);
    } catch {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Serveur MAFIA WARS : Dadou vs Even en marche.\nLe client n’est pas compilé : lancez « npm run build » ou utilisez « npm run dev ».');
    }
  }
}

const http = createServer((req, res) => {
  if (req.url?.startsWith('/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  void serveStatic(req, res);
});

const io = new Server(http, {
  cors: { origin: true },
  maxHttpBufferSize: 1e6,
  pingInterval: 10000,
  pingTimeout: 20000,
});

const sessions = new Map<string, Session>();

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

// filet de sécurité : une erreur dans un gestionnaire ne doit pas couper toutes les parties
process.on('uncaughtException', (e) => console.error('[serveur] erreur non rattrapée :', e));
process.on('unhandledRejection', (e) => console.error('[serveur] promesse rejetée :', e));

io.on('connection', (socket) => {
  let session: Session | null = null;

  socket.on('hello', (data: { token?: string; name?: string }, ack?: (r: unknown) => void) => {
    const token = typeof data?.token === 'string' && data.token.length >= 8 ? data.token.slice(0, 40) : newId();
    session = sessions.get(token) ?? { id: token, name: 'Joueur', socket: null, room: null, ready: false };
    if (session.socket && session.socket.id !== socket.id) session.socket.disconnect(true);
    session.socket = socket;
    if (typeof data?.name === 'string' && data.name.trim()) session.name = data.name.trim().slice(0, 24);
    sessions.set(token, session);
    // reprise d'une partie en cours
    const room = session.room;
    if (room) room.join(session);
    ack?.({ token, room: room?.code ?? null });
  });

  const need = (): Session | null => session;

  socket.on('room:create', (_d: unknown, ack?: (r: unknown) => void) => {
    const s = need();
    if (!s) return;
    s.room?.leave(s);
    const room = new Room(io, makeCode());
    rooms.set(room.code, room);
    room.join(s);
    ack?.({ ok: true, code: room.code });
  });

  socket.on('room:join', (d: { code?: string }, ack?: (r: unknown) => void) => {
    const s = need();
    if (!s) return;
    const code = String(d?.code ?? '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return ack?.({ ok: false, error: 'Aucune partie avec ce code.' });
    if (room.phase !== 'lobby' && !room.slotOf(s.id)) return ack?.({ ok: false, error: 'Cette partie a déjà commencé.' });
    if (room.members.size >= 2 && !room.members.has(s.id) && !room.slotOf(s.id)) return ack?.({ ok: false, error: 'Cette partie est complète.' });
    if (s.room && s.room !== room) s.room.leave(s);
    room.join(s);
    ack?.({ ok: true, code: room.code });
  });

  socket.on('room:leave', () => {
    const s = need();
    if (s?.room) s.room.leave(s);
  });
  socket.on('room:pick', (d: { slot: 'dadou' | 'even' | null }) => {
    const s = need();
    if (s?.room && (d?.slot === 'dadou' || d?.slot === 'even' || d?.slot === null)) s.room.pick(s, d.slot);
  });
  socket.on('room:ready', (d: { ready: boolean }) => {
    const s = need();
    if (s?.room) s.room.ready(s, !!d?.ready);
  });
  socket.on('room:settings', (d: Record<string, unknown>) => {
    const s = need();
    if (s?.room) s.room.setSettings(s, d as never);
  });
  socket.on('room:name', (d: { name: string }) => {
    const s = need();
    if (s && typeof d?.name === 'string' && d.name.trim()) {
      s.name = d.name.trim().slice(0, 24);
      s.room?.broadcastState();
    }
  });
  socket.on('chat', (d: { text: string }) => {
    const s = need();
    if (s?.room) s.room.chat(s, d?.text);
  });
  socket.on('p', (inp) => {
    const s = need();
    if (s?.room) s.room.input(s, inp);
  });
  socket.on('fire', (d) => {
    const s = need();
    if (s?.room) s.room.fire(s, d);
  });
  socket.on('melee', (d) => {
    const s = need();
    if (s?.room) s.room.melee(s, d);
  });
  socket.on('reload', () => {
    const s = need();
    if (s?.room) s.room.reload(s);
  });
  socket.on('act', (d) => {
    const s = need();
    if (s?.room) s.room.action(s, d);
  });
  socket.on('ping2', (t: number, ack?: (r: unknown) => void) => {
    ack?.({ t, s: Date.now() });
  });
  socket.on('disconnect', () => {
    const s = session;
    if (!s || s.socket !== socket) return;
    s.socket = null;
    s.room?.disconnected(s);
  });
});

// ménage : salons vides depuis 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.emptySince > 0 && now - room.emptySince > 15 * 60 * 1000) {
      room.destroy();
      rooms.delete(code);
    }
  }
}, 60000);

/** Ouvre le jeu dans le navigateur par défaut (exécutable autonome, ou MW_OPEN=1). */
function openBrowser(url: string): void {
  try {
    const child =
      process.platform === 'win32'
        ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true })
        : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    /* pas de navigateur : l'adresse est affichée dans la console */
  }
}
const autoOpen = !!embedded || process.env.MW_OPEN === '1';

/** Adresse du réseau local la plus probable (on écarte les cartes virtuelles et VPN). */
function lanAddress(): string | null {
  const virt = /virtual|vmware|vbox|docker|vethernet|hyper-v|wsl|tailscale|zerotier|vpn|utun|tun|tap/i;
  let best: string | null = null;
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (virt.test(name)) continue;
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) return a.address;
      best ??= a.address;
    }
  }
  return best;
}

http.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Le port ${PORT} est déjà utilisé : le jeu tourne peut-être déjà sur cet ordinateur.`);
    if (autoOpen) openBrowser(`http://localhost:${PORT}`);
    console.error('  (Pour utiliser un autre port : définissez la variable PORT, par exemple PORT=3001.)\n');
    setTimeout(() => process.exit(1), 8000);
  } else console.error('[serveur]', e);
});

getWorld();
http.listen(PORT, HOST, () => {
  console.log(`\n  MAFIA WARS : Dadou vs Even — serveur prêt sur le port ${PORT}`);
  console.log(`  Sur cet ordinateur :   http://localhost:${PORT}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  Sur le réseau local :  http://${a.address}:${PORT}`);
    }
  }
  if (autoOpen) {
    // on ouvre l'adresse du réseau local : le lien d'invitation du salon sera alors valable
    // pour l'adversaire branché sur le même réseau (Wi-Fi ou câble)
    const lan = lanAddress();
    console.log('\n  Le jeu s’ouvre dans votre navigateur. Gardez cette fenêtre ouverte pendant la partie :');
    console.log('  la fermer arrête le serveur. Sur le même réseau, envoyez à votre adversaire le lien');
    console.log('  d’invitation du salon (ou l’adresse « réseau local » ci-dessus).');
    openBrowser(`http://${lan ?? 'localhost'}:${PORT}`);
  }
  console.log('');
});
