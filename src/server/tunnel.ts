// Lien Internet automatique : un « quick tunnel » Cloudflare (gratuit, sans compte) expose le
// serveur local sur une adresse publique https://….trycloudflare.com. L'adversaire n'a plus
// qu'à ouvrir le lien d'invitation, même s'il n'est pas sur le même réseau, sans rien régler
// sur la box. (Même principe que dans le premier MAFIA WARS.)
//
// Le programme officiel « cloudflared » est cherché à côté de l'exécutable, puis dans le dossier
// de données du jeu ; à défaut, il y est téléchargé une fois depuis les publications officielles
// de Cloudflare (version figée, empreinte SHA-256 vérifiée).

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type TunnelState = 'off' | 'starting' | 'ready' | 'failed';

export interface TunnelInfo {
  state: TunnelState;
  url: string | null;
}

const VERSION = '2026.9.1';
const ASSETS: Partial<Record<NodeJS.Platform, { asset: string; name: string; sha256: string }>> = {
  win32: { asset: 'cloudflared-windows-amd64.exe', name: 'cloudflared.exe', sha256: '2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712' },
  linux: { asset: 'cloudflared-linux-amd64', name: 'cloudflared', sha256: '03f1f25d1cc93b9ad6c60569d44060bc4f17ed97075760ed8cfca4b12dcd68cc' },
};

const info: TunnelInfo = { state: 'off', url: null };
let child: ChildProcess | null = null;

export function tunnelInfo(): TunnelInfo {
  return { ...info };
}

const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Dossier de données du jeu (%LOCALAPPDATA%\MafiaWars2 sous Windows). */
function dataDir(): string {
  const base = process.platform === 'win32' ? (process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')) : join(homedir(), '.cache');
  return join(base, 'MafiaWars2');
}

/** cloudflared : variable CLOUDFLARED, à côté de l'exécutable, puis dossier de données (téléchargé). */
async function findCloudflared(log: (s: string) => void): Promise<string> {
  if (process.env.CLOUDFLARED) {
    if (existsSync(process.env.CLOUDFLARED)) return process.env.CLOUDFLARED;
    throw new Error(`cloudflared introuvable (${process.env.CLOUDFLARED})`);
  }
  const a = ASSETS[process.platform];
  if (!a) throw new Error(`pas de cloudflared prévu pour ${process.platform}`);
  const beside = join(dirname(process.execPath), a.name);
  if (existsSync(beside)) return beside;
  const dest = join(dataDir(), `cloudflared-${VERSION}`, a.name);
  if (existsSync(dest) && sha256(dest) === a.sha256) return dest;
  log('  Premier lancement : téléchargement de cloudflared (Cloudflare, environ 50 Mo)…');
  const r = await fetch(`https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/${a.asset}`);
  if (!r.ok) throw new Error(`téléchargement de cloudflared impossible (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (createHash('sha256').update(buf).digest('hex') !== a.sha256) throw new Error('empreinte de cloudflared incorrecte');
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  writeFileSync(tmp, buf);
  rmSync(dest, { force: true });
  renameSync(tmp, dest);
  if (process.platform !== 'win32') chmodSync(dest, 0o755);
  return dest;
}

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const READY_RE = /Registered tunnel connection/i;

/**
 * Lance le tunnel vers http://localhost:<port>. `onReady` est appelé quand l'adresse publique
 * répond (connexion au réseau Cloudflare établie), `onFail` si c'est impossible.
 */
export function startTunnel(port: number, onReady: (url: string) => void, onFail: (why: string) => void, log: (s: string) => void = console.log): void {
  info.state = 'starting';
  info.url = null;
  let pending: string | null = null;
  let done = false;
  const fail = (why: string): void => {
    if (done) return;
    done = true;
    info.state = 'failed';
    info.url = null;
    onFail(why);
  };
  // sans réponse du réseau Cloudflare au bout de 3 minutes (téléchargement compris) : on abandonne
  setTimeout(() => {
    if (!done) {
      fail('pas de réponse du réseau Cloudflare');
      stopTunnel();
    }
  }, 180_000).unref();
  void findCloudflared(log).then(
    (bin) => {
      if (done) return;
      try {
        child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      } catch (e) {
        fail(String(e));
        return;
      }
      const onData = (buf: Buffer): void => {
        const text = buf.toString();
        pending ??= URL_RE.exec(text)?.[0] ?? null;
        if (!done && pending && READY_RE.test(text)) {
          done = true;
          info.state = 'ready';
          info.url = pending;
          onReady(pending);
        }
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', (e) => fail(e.message));
      child.on('exit', (code) => {
        child = null;
        if (!done) fail(`cloudflared s’est arrêté (code ${code})`);
        else if (info.state === 'ready') {
          info.state = 'failed';
          info.url = null;
          onFail('le tunnel s’est fermé');
        }
      });
    },
    (e: Error) => fail(e.message),
  );
}

export function stopTunnel(): void {
  try {
    child?.kill();
  } catch {
    /* déjà arrêté */
  }
  child = null;
}

process.on('exit', stopTunnel);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sig, () => {
    stopTunnel();
    process.exit(0);
  });
}
