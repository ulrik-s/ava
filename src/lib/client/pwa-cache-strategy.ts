/**
 * `cacheStrategyFor` — rena funktioner som bestämmer cache-strategi
 * per URL. Service worker:n importerar dem och kallar för varje
 * fetch-event.
 *
 * Designval:
 *   - Single responsibility: en funktion = en avgörande. Inga
 *     side-effects mot Cache-API:t här.
 *   - Open-closed: lägga till ny URL-patt = lägga till ny case-rad.
 *   - DRY: SW-koden importerar samma funktion som tester använder.
 *
 * Strategier:
 *   - `cache-first`: kolla cache först, fall tillbaka till nät. Bra för
 *     immutable resurser (content-hashad JS/CSS).
 *   - `network-first`: prova nät först, fallback till cache vid offline.
 *     Bra för HTML där vi vill ha färska bundle-references.
 *   - `network-only`: inget cache. För API-calls.
 *   - `stale-while-revalidate`: returnera cachat, kolla nät i bakgrund.
 *     (Inte använt än, finns som option.)
 */

export type CacheStrategy =
  | "cache-first"
  | "network-first"
  | "network-only"
  | "stale-while-revalidate";

export function cacheStrategyFor(url: string): CacheStrategy {
  // Cross-origin: aldrig cache:a — låt browsern/fetch hantera
  if (/^https?:\/\//i.test(url)) return "network-only";

  // /api/* — datafetch, alltid färskt
  if (url.startsWith("/api/")) return "network-only";

  // _next/static — content-hashed, immutable → cache-first
  if (url.startsWith("/_next/static/")) return "cache-first";

  // App-resurser med stabilt content → cache-first
  if (url === "/manifest.json") return "cache-first";
  if (url.startsWith("/icons/")) return "cache-first";

  // HTML pages → network-first (vill ha senaste bundle-references)
  return "network-first";
}

interface ResponseLike {
  ok: boolean;
  status: number;
  type: string;
}

export function shouldCacheResponse(res: ResponseLike): boolean {
  if (!res.ok) return false;
  if (res.status !== 200) return false;
  // Opaque responses från cross-origin (utan CORS) går inte att lita på
  if (res.type === "opaque" || res.type === "opaqueredirect" || res.type === "error") {
    return false;
  }
  return true;
}

/**
 * Versionerad cache-namespace. Bumpa när vi vill invalidera alla
 * gamla cacher (t.ex. brytande SW-uppdatering).
 * @public — avsedd cache-versionsinfra (ännu ej inkopplad i SW-flödet).
 */
export const CACHE_VERSION = "ava-v1";
