// Où se trouve la partie ? Chaque exécutable fait tourner son propre serveur : un code de salon
// n'existe que sur l'ordinateur qui l'a créé. L'hôte affiche son adresse sur le réseau local,
// l'invité la saisit (ou colle le lien d'invitation) et son navigateur va sur cet ordinateur.

export interface HostInfo {
  port: number;
  /** Adresse sur le réseau local (box, Wi-Fi), si l'ordinateur en a une. */
  lan: string | null;
  addresses: { name: string; address: string }[];
  /** Lien Internet (tunnel Cloudflare lancé par l'exécutable). */
  tunnel?: { state: 'off' | 'starting' | 'ready' | 'failed'; url: string | null };
  /** Salon demandé (?code=) : null s'il n'existe pas sur ce serveur. */
  room?: { phase: string; players: number } | null;
}

/** Interroge un serveur de jeu (le sien : base = '') ; null s'il ne répond pas. */
export async function hostInfo(base = '', code?: string, ms = 5000): Promise<HostInfo | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${base}/api/hote${code ? `?code=${encodeURIComponent(code)}` : ''}`, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as HostInfo;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/i;

/** Cette page est-elle ouverte sur « localhost » (adresse inutilisable par un autre ordinateur) ? */
export function onLocalhost(): boolean {
  return LOCAL.test(location.hostname);
}

/** Origine de cette page, vue depuis un autre ordinateur du réseau (localhost → adresse locale). */
export function shareableOrigin(info: HostInfo | null): string {
  if (!onLocalhost() || !info?.lan) return location.origin;
  return `${location.protocol}//${info.lan}${location.port ? `:${location.port}` : ''}`;
}

/**
 * Lit ce que l'invité a saisi : « 192.168.1.20 », « 192.168.1.20:3000 », ou un lien d'invitation
 * complet. Renvoie l'origine (port 3000 par défaut) et le code éventuel du lien.
 */
export function parseHost(text: string): { origin: string; code: string | null } | null {
  let t = text.trim();
  if (!t) return null;
  const bare = !/^https?:\/\//i.test(t);
  if (bare) t = `http://${t}`;
  try {
    const u = new URL(t);
    if (!u.hostname) return null;
    // port écrit tel quel (l'objet URL efface :80) ; adresse nue sans port : celui du jeu, 3000 ;
    // lien complet sans port (lien Internet https://….trycloudflare.com) : aucun
    const port = /^https?:\/\/[^/?#]*:(\d+)/i.exec(t)?.[1] ?? (bare && !/trycloudflare\.com$/i.test(u.hostname) ? '3000' : '');
    const code = /[?&]code=([a-z]{4})/i.exec(u.search)?.[1]?.toUpperCase() ?? null;
    return { origin: `${bare && /trycloudflare\.com$/i.test(u.hostname) ? 'https:' : u.protocol}//${u.hostname}${port ? `:${port}` : ''}`, code };
  } catch {
    return null;
  }
}

/** Même ordinateur que celui qui sert cette page ? */
export function isThisServer(origin: string): boolean {
  if (origin === location.origin) return true;
  try {
    const u = new URL(origin);
    return LOCAL.test(u.hostname) && (u.port || '80') === (location.port || '80');
  } catch {
    return false;
  }
}
