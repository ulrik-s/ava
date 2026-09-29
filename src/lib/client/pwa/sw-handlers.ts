/**
 * `createSwHandlers` (#1240) — service workerns logik: förcacha app-skalet vid
 * install, städa gamla versioner vid activate, och svara på förfrågningar
 * enligt `sw-routing`. Beroenden (Cache Storage, fetch, skipWaiting,
 * clients.claim) injiceras, så logiken testas utan en riktig service worker;
 * `sw-entry.ts` kopplar in den mot `self`.
 *
 * Versionsbyte: en ny version installeras i bakgrunden och VÄNTAR tills
 * användaren väljer "Ladda om" (SKIP_WAITING). Att byta ut skalet under en
 * öppen flik kan annars blanda gamla och nya chunks mitt i en ifylld blankett.
 */

import { offlineFallbackPath, routeRequest, withoutSearch, type SwScope } from "./sw-routing";

/** Den del av `Cache` som används. */
export interface SwCache {
  match(request: Request | string, options?: { ignoreSearch?: boolean }): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
}

/** Den del av `CacheStorage` som används. */
export interface SwCacheStorage {
  open(name: string): Promise<SwCache>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

/** Byggtidens konfiguration + var workern lever. */
export interface SwConfig extends SwScope {
  /** Innehållshash över förcachade filer — byts när skalet byts. */
  version: string;
  /** App-relativa sökvägar att förcacha (`/`, `/matters/`, `/_next/static/…`). */
  precache: readonly string[];
  /** Hur länge en sida får vänta på nätet innan cachen svarar. */
  networkTimeoutMs?: number;
}

/** Service worker-globalens förmågor, injicerade. */
export interface SwDeps {
  caches: SwCacheStorage;
  fetch: (request: Request) => Promise<Response>;
  skipWaiting: () => Promise<void>;
  claimClients: () => Promise<void>;
}

/** Handlers som `sw-entry` kopplar till install/activate/fetch/message. */
export interface SwHandlers {
  install(): Promise<void>;
  activate(): Promise<void>;
  /** `null` → svara inte (browsern hanterar förfrågan själv). */
  handleFetch(request: Request): Promise<Response> | null;
  /** Meddelande från en sida; ignoreras om `origin` inte är appens egen. */
  handleMessage(data: unknown, origin: string): Promise<void>;
}

const CACHE_PREFIX = "ava-app-";
const DEFAULT_NETWORK_TIMEOUT_MS = 4_000;
const PRECACHE_ATTEMPTS = 3;

/** Cache-namnet för en version. */
export function cacheNameFor(version: string): string {
  return `${CACHE_PREFIX}${version}`;
}

/**
 * Får svaret sparas som en del av skalet? Bara ett rakt 200 från vår egen
 * origin: en omdirigering (utgången session → IdP:ns inloggning) eller ett
 * opakt svar får aldrig bli "sidan" offline.
 */
function isCacheable(res: Response): boolean {
  return res.status === 200 && !res.redirected && res.type !== "opaque" && res.type !== "opaqueredirect" && res.type !== "error";
}

type Settled = { ok: true; res: Response } | { ok: false; error: unknown };

function settle(p: Promise<Response>): Promise<Settled> {
  return p.then((res): Settled => ({ ok: true, res }), (error: unknown): Settled => ({ ok: false, error }));
}

function unwrap(s: Settled): Response {
  if (s.ok) return s.res;
  throw s.error;
}

/** `p` eller `"timeout"`, vilket som kommer först; timern städas i båda fallen. */
function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), ms); });
  return Promise.race([p, expired]).finally(() => clearTimeout(timer));
}

/** Bygg handlers för en version av skalet. */
export function createSwHandlers(config: SwConfig, deps: SwDeps): SwHandlers {
  const name = cacheNameFor(config.version);
  const networkTimeoutMs = config.networkTimeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS;
  const absolute = (rel: string): string => `${config.origin}${config.basePath}${rel}`;
  const openCache = (): Promise<SwCache> => deps.caches.open(name);

  async function fetchForPrecache(url: string): Promise<Response> {
    const res = await deps.fetch(new Request(url, { cache: "reload", credentials: "same-origin", redirect: "manual" }));
    if (!isCacheable(res)) throw new Error(`[sw] kunde inte förcacha ${url}: ${res.status} ${res.type}`);
    return res;
  }

  /** Ett glapp i nätet under första besöket ska inte kosta hela offline-stödet → några försök. */
  async function precacheOne(cache: SwCache, rel: string): Promise<void> {
    const url = absolute(rel);
    let lastError: unknown;
    for (let attempt = 0; attempt < PRECACHE_ATTEMPTS; attempt++) {
      try {
        await cache.put(url, await fetchForPrecache(url));
        return;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }

  async function install(): Promise<void> {
    const cache = await openCache();
    await Promise.all(config.precache.map((rel) => precacheOne(cache, rel)));
  }

  async function activate(): Promise<void> {
    const stale = (await deps.caches.keys()).filter((k) => k.startsWith(CACHE_PREFIX) && k !== name);
    await Promise.all(stale.map((k) => deps.caches.delete(k)));
    await deps.claimClients();
  }

  async function cacheFirst(request: Request): Promise<Response> {
    const cache = await openCache();
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    const res = await deps.fetch(request);
    if (isCacheable(res)) await cache.put(withoutSearch(request.url), res.clone());
    return res;
  }

  /** Cachad sida för förfrågan, och för navigeringar skalets fallback-sida. */
  async function cachedPage(request: Request): Promise<Response | undefined> {
    const cache = await openCache();
    const own = await cache.match(withoutSearch(request.url), { ignoreSearch: true });
    if (own || request.mode !== "navigate") return own;
    const rel = new URL(request.url).pathname.slice(config.basePath.length) || "/";
    return cache.match(absolute(offlineFallbackPath(rel)), { ignoreSearch: true });
  }

  /** Nätets svar när det kom: spara om det går, falla till cache vid 5xx. */
  async function fromNetwork(request: Request, res: Response): Promise<Response> {
    if (isCacheable(res)) {
      await (await openCache()).put(withoutSearch(request.url), res.clone());
      return res;
    }
    if (res.status >= 500) return (await cachedPage(request)) ?? res;
    return res;
  }

  async function networkFirst(request: Request): Promise<Response> {
    const network = settle(deps.fetch(request));
    const first = await raceTimeout(network, networkTimeoutMs);
    if (first === "timeout") {
      const cached = await cachedPage(request);
      if (cached) return cached;
      return fromNetwork(request, unwrap(await network));
    }
    if (first.ok) return fromNetwork(request, first.res);
    const cached = await cachedPage(request);
    if (cached) return cached;
    throw first.error;
  }

  function handleFetch(request: Request): Promise<Response> | null {
    const strategy = routeRequest({ url: request.url, method: request.method, mode: request.mode }, config);
    if (strategy === "cache-first") return cacheFirst(request);
    if (strategy === "network-first") return networkFirst(request);
    return null;
  }

  /**
   * Meddelanden från sidan. Bara från appens EGEN origin: webbläsaren levererar
   * i praktiken bara därifrån, men workern litar inte på det (CodeQL
   * js/missing-origin-check) — ett SKIP_WAITING byter skalet under öppna flikar.
   */
  async function handleMessage(data: unknown, origin: string): Promise<void> {
    if (origin !== config.origin) return;
    if (typeof data === "object" && data !== null && "type" in data && data.type === "SKIP_WAITING") {
      await deps.skipWaiting();
    }
  }

  return { install, activate, handleFetch, handleMessage };
}
