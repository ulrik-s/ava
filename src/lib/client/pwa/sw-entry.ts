/**
 * Service worker-ingången (#1240). Bundlas av
 * `tooling/scripts/build-service-worker.ts` till `out/sw.js`, med version och
 * förcachelista inbakade som konstanter. All logik ligger i `sw-handlers` (och
 * testas där); den här filen kopplar bara händelserna.
 *
 * Basen (`/ava` på GH Pages, tom i prod) läses ur registreringens scope, så
 * samma fil fungerar oavsett var `out/` serveras.
 */

import { createSwHandlers } from "./sw-handlers";
import { scopeBasePath } from "./sw-routing";

declare const __AVA_SW_VERSION__: string;
declare const __AVA_SW_PRECACHE__: readonly string[];

/** Händelsen `install`/`activate`/`message` — den del som används. */
interface SwExtendableEvent {
  waitUntil(promise: Promise<unknown>): void;
  readonly data?: unknown;
  /** `message`: avsändarens origin (ExtendableMessageEvent). */
  readonly origin?: string;
}

/** Händelsen `fetch` — den del som används. */
interface SwFetchEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

/** Den del av `ServiceWorkerGlobalScope` som används. */
interface SwGlobal {
  readonly registration: { readonly scope: string };
  readonly location: { readonly origin: string };
  readonly caches: CacheStorage;
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  fetch(request: Request): Promise<Response>;
  addEventListener(type: "install" | "activate" | "message", listener: (event: SwExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: SwFetchEvent) => void): void;
}

/**
 * `self` är typad som `Window` (tsconfig: lib "dom"); i en service worker är
 * det `ServiceWorkerGlobalScope`. Vakten bevisar det i stället för att kasta om.
 */
function isSwGlobal(g: unknown): g is SwGlobal {
  return typeof g === "object" && g !== null && "registration" in g && "skipWaiting" in g && "clients" in g;
}

const scope: unknown = globalThis;
if (!isSwGlobal(scope)) throw new Error("[sw] sw.js körs utanför en service worker");
const sw: SwGlobal = scope;

const handlers = createSwHandlers(
  {
    version: __AVA_SW_VERSION__,
    precache: __AVA_SW_PRECACHE__,
    origin: sw.location.origin,
    basePath: scopeBasePath(sw.registration.scope),
  },
  {
    caches: sw.caches,
    fetch: (request) => sw.fetch(request),
    skipWaiting: () => sw.skipWaiting(),
    claimClients: () => sw.clients.claim(),
  },
);

sw.addEventListener("install", (event) => { event.waitUntil(handlers.install()); });
sw.addEventListener("activate", (event) => { event.waitUntil(handlers.activate()); });
sw.addEventListener("message", (event) => {
  // Bara appens egna flikar får styra workern. Kontrollen står här (där
  // händelsen tas emot) OCH i handleMessage (enhetstestad).
  if (event.origin !== sw.location.origin) return;
  event.waitUntil(handlers.handleMessage(event.data, event.origin));
});
sw.addEventListener("fetch", (event) => {
  const response = handlers.handleFetch(event.request);
  if (response) event.respondWith(response);
});
