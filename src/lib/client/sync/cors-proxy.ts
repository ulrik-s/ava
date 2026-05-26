/**
 * Cors-proxy-resolver för isomorphic-git i browsern.
 *
 * isomorphic-git kan inte prata git-smart-HTTP direkt mot en fjärr-server
 * som saknar CORS-headers (t.ex. GitHub) — då krävs en proxy. Men mot en
 * LOKAL eller SAMMA-ORIGIN-server (AVA:s round-trip mot docker:8080/git/,
 * där /git/ ligger på samma origin som /ava/) ska vi gå DIREKT — ingen
 * proxy, ingen extra hop.
 *
 * Konvention: tom sträng ("") = "ingen proxy" (git-ops tolkar det som
 * direkt-anrop). Det skiljer det medvetna valet "ingen proxy" från
 * `undefined` ("ej angivet → använd default").
 */

export const DEFAULT_CORS_PROXY = "https://cors.isomorphic-git.org";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

/** True om URL:en pekar på localhost eller samma origin som sidan. */
export function isLocalOrSameOrigin(url: string, origin?: string): boolean {
  try {
    const u = new URL(url, origin);
    if (origin && u.origin === origin) return true;
    return LOCAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Returnerar cors-proxy att skicka till git-ops:
 *   - lokal/samma-origin → "" (ingen proxy, direkt-anrop)
 *   - annars → konfigurerad proxy, eller default publik proxy
 */
export function resolveCorsProxy(opts: {
  url: string;
  configured?: string;
  origin?: string;
}): string {
  if (isLocalOrSameOrigin(opts.url, opts.origin)) return "";
  return opts.configured || DEFAULT_CORS_PROXY;
}
