/**
 * `HttpBackendRuntime` — `BackendRuntime` för server-first-backenden (#411,
 * ADR 0016). Den "alltid-online"-väg som `backend-runtime.ts` förutser:
 *
 *   GitBackendRuntime  → inProcessLink(ctx)   (routrarna körs i klienten, offline)
 *   HttpBackendRuntime → httpBatchLink(server) (routrarna körs PÅ SERVERN, #410)
 *
 * UI:t och `appRouter` ändras inte — båda ser samma `TRPCLink<AppRouter>`-seam.
 * Servern (server-runtime, #410) kör routrarna mot Postgres och verifierar
 * principalen server-side ur oauth2-proxy-headers.
 *
 * Auth: web-appen rider på oauth2-proxy:s **samma-origin-cookie** (ADR 0009) —
 * `fetch` skickar den automatiskt same-origin, ingen klient-token-kod behövs.
 * (Office-add-ins använder i stället Bearer-PAT via `addin-client.ts`.)
 *
 * `CachingSyncDataStore` (#415) lindar sedan denna väg med lokal store +
 * optimistisk kö + reconcile för offline-first.
 */

import { httpBatchLink, type TRPCLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/lib/server/routers/_app";
import type { BackendRuntime } from "./backend-runtime";

/** tRPC-endpointens suffix på serverns origin (matchar `DEFAULT_TRPC_ENDPOINT`). */
export const SERVER_TRPC_PATH = "/api/trpc";

/** Minimal fetch-form för override (test/icke-standard-runtime). En DOM-`fetch`
 *  uppfyller den; tRPC:s interna `FetchEsque` är inte publikt exporterad. */
export type HttpBackendFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** tRPC:s httpBatchLink-fetch-typ (icke-exporterad `FetchEsque`), härledd ur
 *  länkens optionsparameter så vi kan brygga en DOM-fetch dit utan import. */
type LinkFetch = NonNullable<NonNullable<Parameters<typeof httpBatchLink<AppRouter>>[0]>["fetch"]>;

/** Bygg full tRPC-endpoint-URL ur serverns bas-URL. Tom bas = samma origin
 *  (web-appen bakom nginx). Trimmar avslutande "/". */
export function serverTrpcEndpoint(baseUrl = ""): string {
  return `${baseUrl.replace(/\/+$/, "")}${SERVER_TRPC_PATH}`;
}

export interface HttpBackendRuntimeDeps {
  /** Serverns bas-URL. Tom (default) = samma origin som web-appen. */
  baseUrl?: string;
  /** Valfri `fetch`-override (test/icke-standard-runtime). Default: global fetch. */
  fetch?: HttpBackendFetch;
}

export class HttpBackendRuntime implements BackendRuntime {
  constructor(private readonly deps: HttpBackendRuntimeDeps = {}) {}

  createLink(): TRPCLink<AppRouter> {
    return httpBatchLink({
      url: serverTrpcEndpoint(this.deps.baseUrl),
      transformer: superjson,
      // En DOM-fetch är runtime-kompatibel med tRPC:s FetchEsque; typerna
      // skiljer bara i exactOptional-detaljer (signal null vs undefined).
      ...(this.deps.fetch ? { fetch: this.deps.fetch as unknown as LinkFetch } : {}),
    });
  }
}
