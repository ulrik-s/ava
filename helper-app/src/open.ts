/**
 * `POST /open`-hanteraren: ladda ner en fil, öppna den i OS:ets default-
 * app och (om uploadUrl satt) synka tillbaka ändringar vid varje save.
 * Port av Go:s server/open.go.
 *
 * IO är injicerbar (`OpenDeps`) → handlern testas utan riktiga
 * nedladdningar/spawns.
 */

import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { json, parseJsonBody, textError } from "./http.ts";
import { openWithDefaultApp } from "./platform/open-app.ts";
import { log } from "./log.ts";
import { isSafeFileName, type HelperOpenRequest } from "@/lib/shared/helper/protocol";

const DEFAULT_WATCH_MINUTES = 60;
const POLL_INTERVAL_MS = 2_000;

export interface OpenDeps {
  download: (path: string, url: string, authHeader?: string) => Promise<void>;
  openApp: (path: string) => Promise<void>;
  makeSessionDir: () => Promise<string>;
  startWatch: (path: string, uploadUrl: string, authHeader: string | undefined, timeoutMs: number) => void;
}

export const defaultOpenDeps: OpenDeps = {
  download: downloadTo,
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
  if (!body.downloadUrl || !body.fileName) return textError(400, "downloadUrl and fileName required");
  if (!isSafeFileName(body.fileName)) return textError(400, "invalid fileName");
  return body;
}

async function runOpen(body: HelperOpenRequest, deps: OpenDeps): Promise<Response> {
  // Isolerad katalog per session → samtidiga öppningar krockar inte.
  const sessionDir = await deps.makeSessionDir();
  const tmpFile = join(sessionDir, body.fileName);

  const dlErr = await tryStep(() => deps.download(tmpFile, body.downloadUrl, body.authHeader), 502, "download failed");
  if (dlErr) return dlErr;
  const openErr = await tryStep(() => deps.openApp(tmpFile), 500, "open failed");
  if (openErr) return openErr;

  startWatchIfNeeded(body, tmpFile, deps);
  return json({ path: tmpFile, status: "opened" });
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
  if (!body.uploadUrl) return;
  const m = body.maxWatchMinutes;
  const minutes = m !== undefined && m > 0 ? m : DEFAULT_WATCH_MINUTES;
  deps.startWatch(tmpFile, body.uploadUrl, body.authHeader, minutes * 60_000);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** GET med valfri Authorization-header → skriv body till `path`. */
async function downloadTo(path: string, url: string, authHeader?: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (authHeader) headers.Authorization = authHeader;
  const resp = await fetch(url, { headers });
  if (resp.status >= 400) throw new Error(`HTTP ${resp.status}`);
  await Bun.write(path, resp);
}

/**
 * Pollar filens mtime och PUT:ar nya bytes vid varje save. Stänger efter
 * timeout utan aktivitet; varje save förlänger deadline.
 */
export function watchAndUpload(
  path: string,
  uploadUrl: string,
  authHeader: string | undefined,
  timeoutMs: number,
): void {
  void runWatch(path, uploadUrl, authHeader, timeoutMs);
}

async function runWatch(path: string, uploadUrl: string, authHeader: string | undefined, timeoutMs: number): Promise<void> {
  let lastMtime = (await statMtime(path)) ?? 0;
  if (lastMtime === 0) return;
  let deadline = Date.now() + timeoutMs;

  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    if (Date.now() > deadline) {
      log(`watch timeout: ${path}`);
      return;
    }
    const mtime = await statMtime(path);
    if (mtime === null || mtime <= lastMtime) continue;
    try {
      await uploadFile(path, uploadUrl, authHeader);
      log(`uploaded changes: ${path}`);
      lastMtime = mtime;
      deadline = Date.now() + timeoutMs; // aktivitet → förläng
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

async function uploadFile(path: string, uploadUrl: string, authHeader: string | undefined): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
  if (authHeader) headers.Authorization = authHeader;
  const resp = await fetch(uploadUrl, { method: "PUT", headers, body: Bun.file(path) });
  if (resp.status >= 400) throw new Error(`upload HTTP ${resp.status}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
