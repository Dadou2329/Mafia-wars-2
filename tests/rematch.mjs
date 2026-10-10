// Test réseau sans navigateur : salon, choix, prêts, partie, fin de partie, revanche,
// reconnexion. Prérequis : serveur lancé avec MW_DEBUG=1 (node tests/rematch.mjs [url]).
import { io } from 'socket.io-client';

const URL = process.argv[2] ?? 'http://localhost:3000';
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name, token) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { s, name, token, inits: [], evs: [], room: null, rematch: null, pause: undefined };
  s.on('room:state', (r) => (c.room = r));
  s.on('game:init', (g) => c.inits.push(g));
  s.on('ev', (evs) => c.evs.push(...evs));
  s.on('rematch', (v) => (c.rematch = v));
  s.on('pause', (p) => (c.pause = p));
  c.ready = new Promise((res) => s.on('connect', () => s.emit('hello', { token, name }, (r) => res(r))));
  c.req = (ev, data) => new Promise((res) => s.emit(ev, data, (r) => res(r)));
  return c;
}
const wait = async (fn, ms = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(50);
  }
  return false;
};

const A = client('Alice', 'testA' + Math.random().toString(36).slice(2, 10));
const B = client('Bob', 'testB' + Math.random().toString(36).slice(2, 10));
await A.ready;
await B.ready;
const cr = await A.req('room:create', {});
check('création du salon', cr.ok && /^[A-Z]{4}$/.test(cr.code), JSON.stringify(cr));
const jr = await B.req('room:join', { code: cr.code });
check('l’invité rejoint avec le code', jr.ok);
A.s.emit('room:pick', { slot: 'dadou' });
await sleep(200);
B.s.emit('room:pick', { slot: 'dadou' });
await sleep(300);
check('un parrain déjà choisi reste à son propriétaire', A.room?.picks.dadou && A.room.players[A.room.picks.dadou]?.name === 'Alice');
B.s.emit('room:pick', { slot: 'even' });
await sleep(200);
A.s.emit('room:ready', { ready: true });
B.s.emit('room:ready', { ready: true });
check('la partie démarre quand les deux sont prêts', await wait(() => A.inits.length === 1 && B.inits.length === 1));
check('Dadou et Even attribués', A.inits[0]?.you === 'dadou' && B.inits[0]?.you === 'even');
// reconnexion : B coupe sa connexion et revient avec le même jeton
B.s.disconnect();
check('pause annoncée quand un joueur se déconnecte', await wait(() => !!A.pause && A.pause.waitingFor?.length > 0, 8000), JSON.stringify(A.pause));
await sleep(500);
const B2 = client('Bob', B.token);
await B2.ready;
check('reconnexion : la partie reprend avec le même parrain', await wait(() => B2.inits.length === 1 && B2.inits[0].you === 'even'));
check('fin de la pause au retour du joueur', await wait(() => A.pause === null, 8000));
// fin de partie (outil de test) puis revanche
A.s.emit('act', { a: 'debugEnd' });
const over = await wait(() => A.evs.some((e) => e.t === 'over') && B2.evs.some((e) => e.t === 'over'));
check('fin de partie reçue par les deux joueurs', over, 'serveur sans MW_DEBUG=1 ?');
const ev = A.evs.find((e) => e.t === 'over');
check('Dadou vainqueur, statistiques fournies', ev?.winner === 'dadou' && !!ev?.stats?.dadou && !!ev?.stats?.even);
A.s.emit('act', { a: 'rematch' });
check('vote de revanche relayé', await wait(() => B2.rematch?.votes?.includes('dadou')));
B2.s.emit('act', { a: 'rematch' });
check('revanche : nouvelle partie pour les deux', await wait(() => A.inits.length === 2 && B2.inits.length === 2));
check('la nouvelle partie n’est pas terminée', A.inits[1]?.over === null || A.inits[1]?.over === undefined);
A.s.disconnect();
B2.s.disconnect();
console.log(failed ? `${failed} échec(s)` : 'tout est bon');
process.exit(failed ? 1 : 0);
