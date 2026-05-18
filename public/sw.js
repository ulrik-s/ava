/**
 * AVA Service Worker — minimal cache-shell + offline-fallback.
 *
 * Strategin är duplicerad inline här eftersom SW-environmenten inte
 * kan importera TypeScript. Den fungerar identiskt med
 * `src/lib/pwa-cache-strategy.ts` — om du ändrar logiken där, uppdatera
 * också här. (Det finns ett test i `test/unit/lib/pwa-cache-strategy.test.ts`
 * som validerar logiken.)
 */

const CACHE_VERSION = "ava-v1";

function cacheStrategyFor(url) {
  if (/^https?:\/\//i.test(url)) return "network-only";
  if (url.startsWith("/api/")) return "network-only";
  if (url.startsWith("/_next/static/")) return "cache-first";
  if (url === "/manifest.json") return "cache-first";
  if (url.startsWith("/icons/")) return "cache-first";
  return "network-first";
}

function shouldCacheResponse(res) {
  if (!res || !res.ok) return false;
  if (res.status !== 200) return false;
  if (res.type === "opaque" || res.type === "opaqueredirect" || res.type === "error") return false;
  return true;
}

// ── install: pre-cacha skal-resurser ──────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // Pre-cacha de mest essentiella. Resten cachas on-demand vid
      // första fetch.
      return cache.addAll([
        "/manifest.json",
      ]).catch(() => {
        // Skippa om någon resurs är 404 — kritiska resurser kommer
        // ändå cachas vid första request via fetch-handler.
      });
    }),
  );
  // Skip waiting → ny SW tar över direkt vid uppdatering
  self.skipWaiting();
});

// ── activate: städa bort gamla cache-versioner ────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("ava-") && k !== CACHE_VERSION)
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

// ── fetch: routa via cacheStrategyFor ──────────────────────────────

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Bara GET-requests cachas
  if (event.request.method !== "GET") return;

  const strategy = cacheStrategyFor(
    url.origin === self.location.origin ? url.pathname : url.href,
  );

  if (strategy === "network-only") return; // låt browsern hantera

  if (strategy === "cache-first") {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  if (strategy === "network-first") {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (strategy === "stale-while-revalidate") {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (shouldCacheResponse(res)) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(request);
    if (shouldCacheResponse(res)) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response("Offline — inget cachat innehåll.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((res) => {
    if (shouldCacheResponse(res)) cache.put(request, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}
