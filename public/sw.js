/**
 * AVA Service Worker — KILL SWITCH.
 *
 * Tidigare versioner cachade resurser och kunde servera stale
 * bundles efter deploy. Vi har bytt strategi (PWA inte längre i
 * demo-builden) så denna SW gör bara två saker:
 *
 *   1. install: skip waiting → tar över omedelbart
 *   2. activate: claim clients + ta bort ALLA caches + unregister sig själv
 *
 * När browsern hämtar nya sw.js körs detta + nästa reload har inga
 * SW-cachade resurser. Användaren slipper "DevTools → unregister".
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) { /* ignore */ }
    try {
      const clientsList = await self.clients.matchAll();
      for (const c of clientsList) {
        try { c.postMessage({ type: "sw-killed" }); } catch { /* ignore */ }
      }
      await self.clients.claim();
    } catch (e) { /* ignore */ }
    try {
      await self.registration.unregister();
    } catch (e) { /* ignore */ }
  })());
});

// Inga fetch-handlers → browsern bypassar SW för alla requests.
