/**
 * `document-source` (ADR 0031) — enad dokument-hämtning för `/open` + `/content`.
 *
 * Server-tier: hämta via den typade tRPC-proceduren `document.downloadContent`
 * (helpern bär sin egna Bearer). Demo/statisk: hämta en blob-URL direkt (ingen
 * server att tRPC:a mot). Web-appen väljer källa per tier; här grenar vi på vilket
 * fält som finns. Returnerar alltid rena bytes — anroparen skriver/cachar.
 */

import type { HelperDocumentRef } from "@/lib/shared/helper/protocol";

import {
  createDocumentClient,
  downloadDocumentBytes,
  saveConflictCopyBytes,
  uploadDocumentBytes,
  type ConflictCopy,
  type FetchLike,
  type UploadDocResult,
} from "./trpc-client.ts";

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

/** Bytes + (server-tier) basversion för optimistisk versionskontroll (ADR 0033 §1). */
export interface SourceBytes {
  bytes: Uint8Array;
  /** Serverversionen vid hämtning; undefined för statisk/demo-källa. */
  version?: number;
}

/** Hämta dokument-bytes för en källa: tRPC (server) eller statisk URL (demo). */
export async function fetchSourceBytes(ref: SourceRef, deps: FetchSourceDeps = {}): Promise<SourceBytes> {
  if (ref.document) return fetchViaTrpc(ref.document, deps);
  if (!ref.downloadUrl) throw new Error("ingen källa (varken document eller downloadUrl)");
  return { bytes: await fetchViaUrl(ref.downloadUrl, deps) };
}

/** Server-tier: hämta via den typade tRPC-proceduren `document.downloadContent`. */
async function fetchViaTrpc(ref: HelperDocumentRef, deps: FetchSourceDeps): Promise<SourceBytes> {
  // tRPC vill ha rå token; helperns authHeader är "Bearer <token>".
  const token = (deps.authHeader ?? "").replace(/^Bearer\s+/i, "");
  const client = createDocumentClient({
    trpcUrl: ref.trpcUrl,
    token,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  const dl = await downloadDocumentBytes(client, ref.id);
  return { bytes: dl.bytes, version: dl.version };
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
  /** Basversionen sessionen redigerar från (ADR 0033 §1); bärs till kö-enqueue. */
  baseVersion?: number;
}

/** Stabil kö-/cache-nyckel för ett upload-mål (matchar `sourceCacheKey`). */
export function uploadTargetKey(t: UploadTarget): string | null {
  if (t.document) return `doc:${t.document.id}`;
  return t.uploadUrl ?? null;
}

/**
 * Skriv tillbaka dokument-bytes via tRPC `document.uploadContent` (server-tier).
 * `baseVersion` → optimistisk versionskontroll (ADR 0033 §1); returnerar
 * utfallet (`ok` med ny version / `conflict`) så kön kan framskriva/markera.
 */
export async function uploadViaTrpc(
  document: HelperDocumentRef,
  bytes: Uint8Array,
  baseVersion?: number,
  deps: FetchSourceDeps = {},
): Promise<UploadDocResult> {
  const token = (deps.authHeader ?? "").replace(/^Bearer\s+/i, "");
  const client = createDocumentClient({
    trpcUrl: document.trpcUrl,
    token,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  return uploadDocumentBytes(client, document.id, bytes, baseVersion);
}

/**
 * Materialisera en keep-both-kopia (ADR 0033 §4) via tRPC `saveConflictCopy`.
 * `label` = lokal tidsstämpel (blir del av syskon-dokumentets namn server-side).
 */
export async function saveConflictCopyViaTrpc(
  document: HelperDocumentRef,
  bytes: Uint8Array,
  label: string,
  deps: FetchSourceDeps = {},
): Promise<ConflictCopy> {
  const token = (deps.authHeader ?? "").replace(/^Bearer\s+/i, "");
  const client = createDocumentClient({
    trpcUrl: document.trpcUrl,
    token,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  return saveConflictCopyBytes(client, document.id, bytes, label);
}
