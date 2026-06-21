/**
 * `POST /content` (ADR 0028 §3/§5) — leverera dokument-bytes till webbappen ur
 * helperns durabla, content-adresserade lager.
 *
 * Cache-hit → servera direkt (fungerar OFFLINE). Miss → ladda ner + cacha +
 * servera. Offline utan cache → 502. Gör helpern till den enda lokala
 * dokument-auktoriteten: web-appen delegerar läsningar hit, så in-browser-vyn
 * och extern-editor-öppningen (samma /open-cache) aldrig divergerar.
 *
 * IO injiceras (`ContentDeps`) → testas utan riktig nedladdning/fs.
 */

import type { HelperContentRequest } from "@/lib/shared/helper/protocol";
import type { ContentStore } from "./content-store.ts";
import { parseJsonBody, textError } from "./http.ts";
import { log } from "./log.ts";

export interface ContentDeps {
  /** Hämta cachade bytes för download-URL:en, eller null. */
  load: (downloadUrl: string) => Promise<Uint8Array | null>;
  /** Ladda ner + cacha vid miss; null om nedladdning misslyckas (offline). */
  fetchAndCache: (downloadUrl: string, authHeader: string | undefined, fileName: string) => Promise<Uint8Array | null>;
}

export async function handleContent(req: Request, deps: ContentDeps): Promise<Response> {
  if (req.method !== "POST") return textError(405, "method not allowed");
  const body = await parseJsonBody<HelperContentRequest>(req);
  if (!body?.downloadUrl) return textError(400, "downloadUrl required");

  const cached = await deps.load(body.downloadUrl);
  if (cached) return bytesResponse(cached);

  const fetched = await deps.fetchAndCache(body.downloadUrl, body.authHeader, body.fileName ?? fileNameFromUrl(body.downloadUrl));
  if (fetched) return bytesResponse(fetched);
  return textError(502, "content unavailable (offline, not cached)");
}

function bytesResponse(bytes: Uint8Array): Response {
  // Blob kräver ArrayBuffer-backade bytes (ej SharedArrayBuffer); kopiera.
  return new Response(new Blob([new Uint8Array(bytes)]), {
    status: 200,
    headers: { "Content-Type": "application/octet-stream" },
  });
}

/**
 * Sista path-segmentet som filnamn (utan query/host), fallback "dokument".
 * `URL`-parsning (dummy-bas hanterar både absoluta och relativa URL:er) så
 * host:en aldrig misstas för ett segment.
 */
export function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url, "http://_").pathname;
    const last = path.split("/").filter((s) => s !== "").pop();
    return last ? decodeURIComponent(last) : "dokument";
  } catch {
    return "dokument";
  }
}

/**
 * Ladda ner bytes och cacha dem i content-lagret (cache-miss-vägen för
 * `/content`). Returnerar bytsen, eller null om nedladdning misslyckas (offline
 * → caller svarar 502). Wiras som `ContentDeps.fetchAndCache` i `main`.
 */
export async function fetchAndCacheContent(
  store: ContentStore,
  downloadUrl: string,
  authHeader: string | undefined,
  fileName: string,
): Promise<Uint8Array | null> {
  try {
    const headers: Record<string, string> = {};
    if (authHeader) headers.Authorization = authHeader;
    const resp = await fetch(downloadUrl, { headers });
    if (resp.status >= 400) {
      log(`content: nedladdning ${downloadUrl} → HTTP ${resp.status}`);
      return null;
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());
    await store.store(downloadUrl, bytes, fileName);
    return bytes;
  } catch (err) {
    log(`content: nedladdning misslyckades (${downloadUrl}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
