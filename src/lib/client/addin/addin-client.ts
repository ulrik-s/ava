/**
 * `addin-client` — den delade tRPC-klienten för Office-add-ins (#83, ADR 0013).
 *
 * Add-ins är **tunna HTTP-klienter**: de äger ingen git-db, ingen iso-git, inget
 * OPFS. De pratar med server-runtime:ns tRPC-over-HTTP-API (`/api/trpc`, byggt i
 * steg 1/1b/1c) via `httpBatchLink` + `superjson` (matchar serverns transformer)
 * och auktoriserar med `Authorization: Bearer <PAT>` (ADR 0013 §3 C1).
 *
 * Återanvänder `AppRouter`-typen (type-only import → ingen server-kod i bundlen,
 * respekterar lager-regeln `ui-imports-server-by-type-only`). Word (#84) och
 * Outlook (#72) bygger sina task-panes ovanpå exakt denna klient — samma
 * end-to-end-typer som web-appen, ingen reimplementation.
 *
 * Office.js-fritt med flit: detta är transport-/datalagret och kan därför
 * enhetstestas mot den riktiga server-handlern utan en Office-runtime.
 */

import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/lib/server/routers/_app";

/** Minimal fetch-form för override (test/icke-standard-runtime). En DOM-`fetch`
 *  uppfyller den; tRPC:s interna `FetchEsque` är inte publikt exporterad. */
export type AddinFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** tRPC:s httpBatchLink-fetch-typ (icke-exporterad `FetchEsque`), härledd ur
 *  länkens optionsparameter så vi kan brygga en DOM-fetch dit utan import. */
type LinkFetch = NonNullable<NonNullable<Parameters<typeof httpBatchLink<AppRouter>>[0]>["fetch"]>;

/** tRPC-endpointens default-suffix på serverns origin (matchar DEFAULT_TRPC_ENDPOINT). */
export const ADDIN_TRPC_PATH = "/api/trpc";

/** Bygg full endpoint-URL ur serverns bas-URL (trimmar avslutande "/"). */
export function addinTrpcEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${ADDIN_TRPC_PATH}`;
}

export interface AddinClientOptions {
  /** Serverns bas-URL (t.ex. https://byra.example). `/api/trpc` läggs på. */
  baseUrl: string;
  /** Bearer-PAT som auktoriserar mot API:t. */
  token: string;
  /** Valfri `fetch`-override (test/icke-standard-runtime). Default: global fetch. */
  fetch?: AddinFetch;
}

/**
 * Skapa en typad tRPC-klient mot AVA-serverns HTTP-API. Returvärdet har hela
 * `AppRouter`-ytan (t.ex. `client.matter.list.query(...)`, `client.user.current
 * .query()`), end-to-end-typad mot servern.
 */
export function createAddinClient(opts: AddinClientOptions): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: addinTrpcEndpoint(opts.baseUrl),
        transformer: superjson,
        headers: () => ({ authorization: `Bearer ${opts.token}` }),
        // En DOM-fetch är runtime-kompatibel med tRPC:s FetchEsque; typerna
        // skiljer bara i exactOptional-detaljer (signal null vs undefined).
        ...(opts.fetch ? { fetch: opts.fetch as unknown as LinkFetch } : {}),
      }),
    ],
  });
}
