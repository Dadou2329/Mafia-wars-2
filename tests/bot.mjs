// Second joueur sans navigateur (Socket.IO) pour les tests : rejoint un salon, choisit un
// parrain, se déclare prêt, puis reste connecté (et répond aux revanches).
// Usage : node tests/bot.mjs CODE [even|dadou] [http://localhost:3000]
import { io } from 'socket.io-client';

const [code, slot = 'even', server = 'http://localhost:3000'] = process.argv.slice(2);
const token = 'bot' + Math.random().toString(36).slice(2, 10);
const socket = io(server, { transports: ['websocket'] });
const log = (...a) => console.log('[bot]', ...a);
socket.on('connect', () => {
  socket.emit('hello', { token, name: 'Robot' }, () => {
    socket.emit('room:join', { code }, (r) => {
      log('join', JSON.stringify(r));
      if (!r?.ok) process.exit(1);
      setTimeout(() => socket.emit('room:pick', { slot }), 300);
      setTimeout(() => socket.emit('room:ready', { ready: true }), 800);
    });
  });
});
let started = false;
socket.on('game:init', () => {
  if (!started) log('partie lancée');
  started = true;
});
socket.on('ev', (evs) => {
  for (const e of evs)
    if (e.t === 'over') {
      log('fin de partie :', e.winner, e.reason);
      // le robot accepte toujours la revanche
      setTimeout(() => socket.emit('act', { a: 'rematch' }), 1500);
    }
});
socket.on('disconnect', () => log('déconnecté'));
process.on('SIGTERM', () => process.exit(0));
