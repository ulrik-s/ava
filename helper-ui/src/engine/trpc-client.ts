/**
 * `trpc-client` — helperns tunna tRPC-over-HTTP-klient (ADR 0031).
 *
 * Helpern äger ingen db och inget eget API: den pratar med server-first:ens
 * tRPC-over-HTTP (`/api/trpc`) via `httpBatchLink` + `superjson` (matchar serverns
 * transformer) och bär sin EGNA Bearer-token (OIDC, ADR 0028 §2). Exakt samma
 * mönster som Office-add-ins (`createAddinClient`, ADR 0013) — samma `AppRouter`-
 * typer end-to-end, ingen bespoke REST-yta.
 *
 * `AppRouter` importeras type-only → ingen server-kod i bundlen (respekterar
 * `helper-ui-imports-server-by-type-only`). Helpern kan inte återanvända
 * `src/lib/client/addin/`-factoryn (bakom client-gränsen), därav en egen.
 */

import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import superjson from "superjson";

import type { AppRouter } from "@/lib/server/routers/_app";
import { base64ToBytes, bytesToBase64 } from "@/lib/shared/content-address";

/** tRPC-endpointens suffix på serverns origin (matchar DEFAULT_TRPC_ENDPOINT). */
export const TRPC_PATH = "/api/trpc";

/** Full endpoint-URL ur serverns bas-URL/origin (trimmar avslutande "/"). */
export function documentTrpcEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${TRPC_PATH}`;
}

/** En DOM-kompatibel fetch (det test/runtime injicerar). */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** tRPC:s fetch-typ för `httpBatchLink` (`FetchEsque`). */
type LinkFetch = NonNullable<NonNullable<Parameters<typeof httpBatchLink<AppRouter>>[0]>["fetch"]>;

/**
 * Adaptera en injicerad DOM-fetch till tRPC:s länk-fetch. `httpBatchLink` anropar
 * med URL-sträng/URL, men `FetchEsque` tillåter även `Request` → normalisera till
 * `.url`. `init` bryggas med en lokal `as` för signal-varianten (null vs
 * undefined under exactOptional) — samma mönster som `src/lib/client/link-fetch`.
 */
function toLinkFetch(fetchImpl: FetchLike): LinkFetch {
  return (url, init) => fetchImpl(url instanceof Request ? url.url : url, init as RequestInit | undefined);
}

export interface DocumentClientOptions {
  /** Full tRPC-endpoint, t.ex. `http://localhost:8080/api/trpc`. */
  trpcUrl: string;
  /** Helperns Bearer-token (OIDC). */
  token: string;
  /** Valfri fetch-override (default: global fetch). */
  fetch?: FetchLike;
}

/** Skapa en typad tRPC-klient mot AVA-serverns API (hela `AppRouter`-ytan). */
export function createDocumentClient(opts: DocumentClientOptions): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: opts.trpcUrl,
        transformer: superjson,
        headers: () => ({ authorization: `Bearer ${opts.token}` }),
        ...(opts.fetch ? { fetch: toLinkFetch(opts.fetch) } : {}),
      }),
    ],
  });
}

export interface DocumentBytes {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

/** Hämta dokument-bytes via den typade `document.downloadContent`-proceduren. */
export async function downloadDocumentBytes(
  client: TRPCClient<AppRouter>,
  documentId: string,
): Promise<DocumentBytes> {
  const res = await client.document.downloadContent.query({ documentId });
  return { bytes: base64ToBytes(res.contentBase64), mimeType: res.mimeType, fileName: res.fileName };
}

/** Skriv tillbaka dokument-bytes via den typade `document.uploadContent`-mutationen. */
export async function uploadDocumentBytes(
  client: TRPCClient<AppRouter>,
  documentId: string,
  bytes: Uint8Array,
): Promise<void> {
  await client.document.uploadContent.mutate({ documentId, contentBase64: bytesToBase64(bytes) });
}
