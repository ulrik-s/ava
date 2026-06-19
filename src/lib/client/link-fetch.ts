/**
 * Adapter mellan en injicerad DOM-fetch och tRPC:s `httpBatchLink`-fetch.
 *
 * Add-ins och self-hosted-backenden injicerar en DOM-kompatibel fetch
 * (`InjectableFetch`). Den är runtime-kompatibel med tRPC:s `FetchEsque`, men
 * typerna skiljer i exactOptional-detaljer (`RequestInit.signal` null vs
 * undefined m.m.). I st.f. en `as unknown as`-cast på varje länk-konfiguration
 * bryggar vi i EN adapter med en lokal `as RequestInit`-tag — den verkliga
 * DOM-rad-formen, inte en blind dubbel-cast.
 */

import type { httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@/lib/server/routers/_app";

/** En DOM-kompatibel fetch (det add-ins/backends injicerar). */
export type InjectableFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** tRPC:s fetch-typ för `httpBatchLink` (`FetchEsque`). */
export type LinkFetch = NonNullable<NonNullable<Parameters<typeof httpBatchLink<AppRouter>>[0]>["fetch"]>;

/** Adaptera en injicerad DOM-fetch till tRPC:s länk-fetch. */
export function toLinkFetch(fetchImpl: InjectableFetch): LinkFetch {
  // `httpBatchLink` anropar med en URL-sträng/URL, men `FetchEsque`-typen
  // tillåter även `Request` → normalisera den till sin `.url` (runtime-korrekt,
  // ingen url-cast). `init` bryggas med en lokal `as` för signal-varianten.
  return (url, init) =>
    fetchImpl(url instanceof Request ? url.url : url, init as RequestInit | undefined);
}
