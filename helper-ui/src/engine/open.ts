/**
 * `POST /open`-hanteraren: ladda ner en fil, öppna den i OS:ets default-
 * app och (om uploadUrl satt) synka tillbaka ändringar vid varje save.
 * Port av Go:s server/open.go.
 *
 * IO är injicerbar (`OpenDeps`) → handlern testas utan riktiga
 * nedladdningar/spawns.
 */

import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { isSafeFileName, type HelperOpenRequest } from "@/lib/shared/helper/protocol";
import type { ContentStore } from "./content-store.ts";
import { fetchSourceBytes, sourceCacheKey, toSourceRef, uploadViaTrpc, type SourceRef, type UploadTarget } from "./document-source.ts";
import { json, parseJsonBody, textError } from "./http.ts";
import { log } from "./log.ts";
import { openWithDefaultApp } from "./platform/open-app.ts";
import type { UploadQueue } from "./queue.ts";

const DEFAULT_WATCH_MINUTES = 60;
const POLL_INTERVAL_MS = 2_000;

export interface OpenDeps {
  /** Väntande lokal (osynkad) kopia, eller null (ADR 0032 local-first). Provas FÖRE download. */
  pendingBytes?: (ref: SourceRef) => Promise<Uint8Array | null>;
  /** Hämta dokument-bytes för en källa (tRPC server-tier / statisk demo, ADR 0031). */
  download: (ref: SourceRef, authHeader?: string) => Promise<Uint8Array>;
  openApp: (path: string) => Promise<void>;
  makeSessionDir: () => Promise<string>;
  startWatch: (path: string, target: UploadTarget, authHeader: string | undefined, timeoutMs: number) => void;
  /** Cacha nedladdade bytes durabelt under `cacheKey` (offline-reopen, ADR 0028 §3). Valfri. */
  persist?: (cacheKey: string, bytes: Uint8Array, fileName: string) => Promise<void>;
  /** Återställ cachade bytes (under `cacheKey`) till `path` när nedladdning misslyckas (offline). Valfri. */
  restore?: (cacheKey: string, path: string) => Promise<boolean>;
}

export const defaultOpenDeps: OpenDeps = {
  download: (ref, authHeader) => fetchSourceBytes(ref, authHeader !== undefined ? { authHeader } : {}),
  openApp: openWithDefaultApp,
  makeSessionDir: () => mkdtemp(join(tmpdir(), "ava-helper-")),
  startWatch: watchAndUpload,
};

export async function handleOpen(req: Request, deps: OpenDeps = defaultOpenDeps): Promise<Response> {
  const parsed = await parseOpenRequest(req);
  if (parsed instanceof Response) return parsed;
  return runOpen(parsed, deps);
}

/** Validera request → returnera body, eller en fel-Response. */
async function parseOpenRequest(req: Request): Promise<HelperOpenRequest | Response> {
  if (req.method !== "POST") return textError(405, "method not allowed");
  const body = await parseJsonBody<HelperOpenRequest>(req);
  if (body === null) return textError(400, "invalid JSON");
  if ((!body.downloadUrl && !body.document) || !body.fileName) {
    return textError(400, "source (document|downloadUrl) and fileName required");
  }
  if (!isSafeFileName(body.fileName)) return textError(400, "invalid fileName");
  return body;
}

async function runOpen(body: HelperOpenRequest, deps: OpenDeps): Promise<Response> {
  // Isolerad katalog per session → samtidiga öppningar krockar inte.
  const sessionDir = await deps.makeSessionDir();
  const tmpFile = join(sessionDir, body.fileName);

  const obtainErr = await obtainFile(body, tmpFile, deps);
  if (obtainErr) return obtainErr;
  const openErr = await tryStep(() => deps.openApp(tmpFile), 500, "open failed");
  if (openErr) return openErr;

  startWatchIfNeeded(body, tmpFile, deps);
  return json({ path: tmpFile, status: "opened" });
}

/**
 * Skaffa filen till `tmpFile`: ladda ner och cacha (för offline-reopen), eller
 * — om nedladdning misslyckas (offline) — återställ en tidigare cachad kopia.
 * Returnerar en fel-Response om filen inte kan skaffas, annars null.
 */
async function obtainFile(body: HelperOpenRequest, tmpFile: string, deps: OpenDeps): Promise<Response | null> {
  const ref: SourceRef = toSourceRef(body);
  const key = sourceCacheKey(ref) ?? "";
  // Local-first (ADR 0032): en osynkad lokal ändring är auktoritativ tills den
  // synkats → öppna den i st.f. att hämta serverns (ännu) gamla version.
  const local = deps.pendingBytes ? await deps.pendingBytes(ref) : null;
  if (local) {
    await writeFile(tmpFile, local);
    log(`local-first: öppnar osynkad lokal version av ${body.fileName}`);
    return null;
  }
  let bytes: Uint8Array;
  try {
    bytes = await deps.download(ref, body.authHeader);
  } catch (err) {
    return downloadFailureFallback(body, tmpFile, key, deps, err);
  }
  await writeFile(tmpFile, bytes);
  await cacheBytes(deps, key, bytes, body.fileName);
  return null;
}

/** Nedladdning misslyckades → öppna cachad kopia om möjligt (offline), annars 502. */
async function downloadFailureFallback(
  body: HelperOpenRequest, tmpFile: string, key: string, deps: OpenDeps, err: unknown,
): Promise<Response | null> {
  log(`/open hämtning misslyckades (${body.fileName}, key=${key}): ${errMsg(err)}`);
  if (deps.restore && key && (await deps.restore(key, tmpFile))) {
    log(`offline: öppnar cachad kopia av ${body.fileName}`);
    return null;
  }
  return textError(502, `download failed: ${errMsg(err)}`);
}

/** Cacha bytsen durabelt (best-effort; ett cache-fel får aldrig fälla öppningen). */
async function cacheBytes(deps: OpenDeps, key: string, bytes: Uint8Array, fileName: string): Promise<void> {
  if (!deps.persist || !key) return;
  try {
    await deps.persist(key, bytes, fileName);
  } catch (err) {
    log(`content-cache misslyckades (${fileName}): ${errMsg(err)}`);
  }
}

/** Kör ett IO-steg; null vid framgång, annars en fel-Response. */
async function tryStep(fn: () => Promise<void>, status: number, label: string): Promise<Response | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return textError(status, `${label}: ${errMsg(err)}`);
  }
}

function startWatchIfNeeded(body: HelperOpenRequest, tmpFile: string, deps: OpenDeps): void {
  // Write-back-mål: tRPC-dokument (server, ADR 0031) ELLER PUT-URL (demo).
  const target: UploadTarget | null = body.document
    ? { document: body.document }
    : body.uploadUrl
      ? { uploadUrl: body.uploadUrl }
      : null;
  if (!target) return;
  const m = body.maxWatchMinutes;
  const minutes = m !== undefined && m > 0 ? m : DEFAULT_WATCH_MINUTES;
  deps.startWatch(tmpFile, target, body.authHeader, minutes * 60_000);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function uploadFile(path: string, uploadUrl: string, authHeader: string | undefined): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
  if (authHeader) headers.Authorization = authHeader;
  const resp = await fetch(uploadUrl, { method: "PUT", headers, body: new Blob([new Uint8Array(await readFile(path))]) });
  if (resp.status >= 400) throw new Error(`upload HTTP ${resp.status}`);
}

/**
 * Ladda upp en sparad fil till sitt mål (ADR 0031): server-tier via tRPC
 * `document.uploadContent`, demo via PUT. Default-upload när ingen durabel kö
 * är wirad (annars köas via `enqueueSavedFile`).
 */
export async function uploadSavedFile(path: string, target: UploadTarget, authHeader: string | undefined): Promise<void> {
  if (target.document) {
    const bytes = new Uint8Array(await readFile(path));
    await uploadViaTrpc(target.document, bytes, authHeader !== undefined ? { authHeader } : {});
    return;
  }
  if (!target.uploadUrl) throw new Error("inget upload-mål");
  await uploadFile(path, target.uploadUrl, authHeader);
}

/**
 * Cacha nedladdade bytes durabelt (ADR 0028 §3, läs-sidan): efter en lyckad
 * nedladdning sparas bytsen content-adresserat så samma dokument kan öppnas
 * igen OFFLINE. Wiras in som `OpenDeps.persist` i `main`.
 */
export async function persistDownloaded(
  store: ContentStore,
  cacheKey: string,
  bytes: Uint8Array,
  fileName: string,
): Promise<void> {
  await store.store(cacheKey, bytes, fileName);
}

/**
 * Återställ cachade bytes till `path` (ADR 0028 §3): när nedladdning misslyckas
 * (offline) och en tidigare cachad kopia finns skrivs den ut så dokumentet kan
 * öppnas ändå. Returnerar false om inget cachat finns. Wiras in som
 * `OpenDeps.restore` i `main`.
 */
export async function restoreCached(store: ContentStore, downloadUrl: string, path: string): Promise<boolean> {
  const bytes = await store.load(downloadUrl);
  if (bytes === null) return false;
  await writeFile(path, bytes);
  return true;
}

/**
 * Offline-first save (ADR 0028 §3): läs de sparade bytsen och KÖA dem
 * durabelt i stället för att PUT:a direkt. Bytsen ligger då säkert på disk
 * och kön dränerar autonomt — en save kan aldrig tappas offline/vid krasch.
 * Wiras in som watch-loopens `upload`-dep i `main` (queueBackedOnOpen).
 */
export async function enqueueSavedFile(
  queue: UploadQueue,
  path: string,
  target: UploadTarget,
  authHeader: string | undefined,
): Promise<void> {
  const bytes = new Uint8Array(await readFile(path));
  await queue.enqueue({
    ...(target.document ? { document: target.document } : {}),
    ...(target.uploadUrl !== undefined ? { uploadUrl: target.uploadUrl } : {}),
    fileName: basename(path),
    bytes,
    ...(authHeader !== undefined ? { authHeader } : {}),
  });
}

/**
 * Injicerbara beroenden för watch-loopen (SOLID): klocka + sleep + IO så
 * loopen kan testas deterministiskt utan riktig tid/fs/nät.
 */
export interface WatchDeps {
  statMtime: (path: string) => Promise<number | null>;
  upload: (path: string, target: UploadTarget, authHeader: string | undefined) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export const defaultWatchDeps: WatchDeps = {
  statMtime,
  upload: uploadSavedFile,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/**
 * Pollar filens mtime och laddar upp nya bytes (tRPC/PUT) vid varje save.
 * Stänger efter timeout utan aktivitet; varje save förlänger deadline.
 */
export function watchAndUpload(
  path: string,
  target: UploadTarget,
  authHeader: string | undefined,
  timeoutMs: number,
  deps: WatchDeps = defaultWatchDeps,
): void {
  void runWatch(path, target, authHeader, timeoutMs, deps);
}

export async function runWatch(
  path: string,
  target: UploadTarget,
  authHeader: string | undefined,
  timeoutMs: number,
  deps: WatchDeps,
): Promise<void> {
  let lastMtime = (await deps.statMtime(path)) ?? 0;
  if (lastMtime === 0) return; // filen försvann innan watch hann starta
  let deadline = deps.now() + timeoutMs;

  for (;;) {
    await deps.sleep(POLL_INTERVAL_MS);
    if (deps.now() > deadline) {
      log(`watch timeout: ${path}`);
      return;
    }
    const mtime = await deps.statMtime(path);
    if (mtime === null || mtime <= lastMtime) continue;
    try {
      await deps.upload(path, target, authHeader);
      log(`uploaded changes: ${path}`);
      lastMtime = mtime;
      deadline = deps.now() + timeoutMs; // aktivitet → förläng
    } catch (err) {
      log(`upload failed (${path}): ${errMsg(err)}`);
    }
  }
}

async function statMtime(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}
