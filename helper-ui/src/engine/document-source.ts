/**
 * `document-source` (ADR 0031) — enad dokument-hämtning för `/open` + `/content`.
 *
 * Server-tier: hämta via den typade tRPC-proceduren `document.downloadContent`
 * (helpern bär sin egna Bearer). Demo/statisk: hämta en blob-URL direkt (ingen
 * server att tRPC:a mot). Web-appen väljer källa per tier; här grenar vi på vilket
 * fält som finns. Returnerar alltid rena bytes — anroparen skriver/cachar.
 */

import type { HelperDocumentRef } from "@/lib/shared/helper/protocol";

import { createDocumentClient, downloadDocumentBytes, uploadDocumentBytes, type FetchLike } from "./trpc-client.ts";

/** En dokument-källa: tRPC (`document`) ELLER statisk URL (`downloadUrl`). */
export interface SourceRef {
  document?: HelperDocumentRef;
  downloadUrl?: string;
}

/** Bygg en `SourceRef` ur ett request-objekt (utelämnar undefined-fält, exactOptional). */
export function toSourceRef(x: { document?: HelperDocumentRef; downloadUrl?: string }): SourceRef {
  return {
    ...(x.document ? { document: x.document } : {}),
    ...(x.downloadUrl ? { downloadUrl: x.downloadUrl } : {}),
  };
}

/**
 * Stabil cache-nyckel för content-lagret: `doc:<id>` i server-tier (oberoende av
 * URL/origin), annars statisk `downloadUrl`. `null` om ingen källa anges.
 */
export function sourceCacheKey(ref: SourceRef): string | null {
  if (ref.document) return `doc:${ref.document.id}`;
  return ref.downloadUrl ?? null;
}

export interface FetchSourceDeps {
  /** Helperns `Authorization: Bearer …` (tRPC-token härleds, statisk-header sätts). */
  authHeader?: string;
  /** Fetch-override (test). Default: global fetch. */
  fetch?: FetchLike;
}

/** Hämta dokument-bytes för en källa: tRPC (server) eller statisk URL (demo). */
export async function fetchSourceBytes(ref: SourceRef, deps: FetchSourceDeps = {}): Promise<Uint8Array> {
  if (ref.document) return fetchViaTrpc(ref.document, deps);
  if (!ref.downloadUrl) throw new Error("ingen källa (varken document eller downloadUrl)");
  return fetchViaUrl(ref.downloadUrl, deps);
}

/** Server-tier: hämta via den typade tRPC-proceduren `document.downloadContent`. */
async function fetchViaTrpc(ref: HelperDocumentRef, deps: FetchSourceDeps): Promise<Uint8Array> {
  // tRPC vill ha rå token; helperns authHeader är "Bearer <token>".
  const token = (deps.authHeader ?? "").replace(/^Bearer\s+/i, "");
  const client = createDocumentClient({
    trpcUrl: ref.trpcUrl,
    token,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  return (await downloadDocumentBytes(client, ref.id)).bytes;
}

/** Demo/statisk: hämta bytes från en blob-URL (valfri Authorization-header). */
async function fetchViaUrl(url: string, deps: FetchSourceDeps): Promise<Uint8Array> {
  const headers: Record<string, string> = {};
  if (deps.authHeader) headers.Authorization = deps.authHeader;
  const fetchFn = deps.fetch ?? fetch;
  const resp = await fetchFn(url, { headers });
  if (resp.status >= 400) throw new Error(`HTTP ${resp.status}`);
  return new Uint8Array(await resp.arrayBuffer());
}

/** Ett upload-mål (write-back): tRPC-dokument (server) ELLER PUT-URL (demo). */
export interface UploadTarget {
  document?: HelperDocumentRef;
  uploadUrl?: string;
}

/** Stabil kö-/cache-nyckel för ett upload-mål (matchar `sourceCacheKey`). */
export function uploadTargetKey(t: UploadTarget): string | null {
  if (t.document) return `doc:${t.document.id}`;
  return t.uploadUrl ?? null;
}

/** Skriv tillbaka dokument-bytes via tRPC `document.uploadContent` (server-tier). */
export async function uploadViaTrpc(
  document: HelperDocumentRef,
  bytes: Uint8Array,
  deps: FetchSourceDeps = {},
): Promise<void> {
  const token = (deps.authHeader ?? "").replace(/^Bearer\s+/i, "");
  const client = createDocumentClient({
    trpcUrl: document.trpcUrl,
    token,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  await uploadDocumentBytes(client, document.id, bytes);
}
