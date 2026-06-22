/**
 * Durabel upload-kö (ADR 0028 §3) — kärnan i den offline-first helpern.
 *
 * En sparning skrivs FÖRST durabelt till disk (bytes-snapshot + manifest)
 * och köas, INNAN den försöker laddas upp. Därför kan en ändring aldrig
 * tappas: är nätet nere, eller kraschar/startas helpern om, ligger den kvar
 * på disk och dräneras när servern går att nå igen. Det är raka motsatsen
 * till KATS-HIIT-pluginets minnes-bundna upload som dör tyst med fliken.
 *
 * IO mot nät + klocka/id är injicerbara (`QueueDeps`) → drän-logiken testas
 * deterministiskt. Filsystemet används direkt (node:fs) mot en kö-katalog.
 *
 * Versions-konflikt: en `409` från servern (server-versionen har gått förbi
 * vår base-version) markerar posten `conflict` och slutar retr:a den —
 * ändringen skrivs ALDRIG över tyst; den ytläggs för användaren (steg 8).
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { HelperDocumentRef, HelperStatusResponse, HelperSyncEntry } from "@/lib/shared/helper/protocol";
import { uploadTargetKey, uploadViaTrpc } from "./document-source.ts";
import { log } from "./log.ts";

/**
 * En köad upload som väntar på att nå servern. Delar form med det publika
 * {@link HelperSyncEntry} (status-API:t) + en intern `authHeader` som ALDRIG
 * exponeras i snapshots.
 */
export interface QueueEntry extends HelperSyncEntry {
  /** Vidarebefordras orörd till upload (ersätts av device-token i steg 2). */
  authHeader?: string;
}

/** Ögonblicksbild för status-UI (helper-meny + web-app-banner, steg 8). */
export type QueueSnapshot = HelperStatusResponse;

/** Vad en dränerings-runda gjorde (för loggning/test). */
export interface DrainResult {
  uploaded: number;
  conflicted: number;
  failed: number;
  skipped: number;
}

/** Injicerbara icke-fs-beroenden (nät + klocka + id) för deterministiska test. */
export interface QueueDeps {
  now: () => number;
  newId: () => string;
  /** PUT bytes (demo/legacy) → returnera HTTP-status (kastar bara vid nätfel). */
  put: (url: string, body: Uint8Array, authHeader?: string) => Promise<number>;
  /** Write-back via tRPC `document.uploadContent` (server-tier); kastar vid fel. */
  uploadDoc: (document: HelperDocumentRef, body: Uint8Array, authHeader?: string) => Promise<void>;
}

export const defaultQueueDeps: QueueDeps = {
  now: () => Date.now(),
  newId: () => crypto.randomUUID(),
  put: async (url, body, authHeader) => {
    const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
    if (authHeader) headers.Authorization = authHeader;
    // Blob kräver ArrayBuffer-backade bytes (ej SharedArrayBuffer); kopiera.
    const resp = await fetch(url, { method: "PUT", headers, body: new Blob([new Uint8Array(body)]) });
    return resp.status;
  },
  uploadDoc: (document, body, authHeader) =>
    uploadViaTrpc(document, body, authHeader !== undefined ? { authHeader } : {}),
};

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const DEFAULT_DRAIN_INTERVAL_MS = 15_000;

/** Backoff: 5s, 10s, 20s … taklagt på 5 min. */
export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

/** Den serialiserbara delen av en post (utan härledda fält). */
type StoredEntry = QueueEntry;

export interface EnqueueInput {
  /** Server-tier tRPC-mål. Exakt en av `document`/`uploadUrl` anges. */
  document?: HelperDocumentRef;
  /** Demo/legacy PUT-mål. */
  uploadUrl?: string;
  fileName: string;
  bytes: Uint8Array;
  authHeader?: string;
}

/** Stabil identitet för en post (dedup-nyckel): `doc:<id>` eller PUT-URL. */
function entryKey(e: { document?: HelperDocumentRef; uploadUrl?: string }): string {
  return uploadTargetKey(e) ?? "";
}

/**
 * Durabel, disk-backad upload-kö. Konstruera med kö-katalogen; anropa
 * `recover()` vid start för att läsa in kvarvarande poster, `enqueue()` vid
 * varje save och `drainOnce()` periodiskt (eller via `startDrainLoop`).
 */
export class UploadQueue {
  private readonly dir: string;
  private readonly deps: QueueDeps;
  private readonly tokenProvider: (() => Promise<string | undefined>) | undefined;
  private readonly entries = new Map<string, QueueEntry>();
  private draining = false;

  /**
   * `tokenProvider` (ADR 0028 §2): ger en FÄRSK `Authorization`-header vid varje
   * upload-försök när posten inte bär en egen (helpern auktoriserar autonomt med
   * sin OIDC-token). Hämtas vid drain-tid — aldrig lagrad — så en utgången token
   * inte fryses in i en köad post som väntat dagar offline.
   */
  constructor(dir: string, deps: QueueDeps = defaultQueueDeps, tokenProvider?: () => Promise<string | undefined>) {
    this.dir = dir;
    this.deps = deps;
    this.tokenProvider = tokenProvider;
  }

  private manifestPath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private contentPath(id: string): string {
    return join(this.dir, `${id}.bin`);
  }

  /** Läs in kvarvarande poster från disk (vid uppstart efter omstart/krasch). */
  async recover(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return; // kö-katalogen finns inte än → tom kö
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -".json".length);
      try {
        const entry = JSON.parse(await readFile(this.manifestPath(id), "utf8")) as StoredEntry;
        await readFile(this.contentPath(id)); // bytes måste finnas, annars släng manifestet
        this.entries.set(entryKey(entry), entry);
      } catch (err) {
        log(`queue: hoppar trasig post ${id}: ${msg(err)}`);
      }
    }
    if (this.entries.size > 0) log(`queue: återställde ${this.entries.size} väntande upload(s)`);
  }

  /**
   * Skriv bytes + manifest durabelt och köa. Sammanslår per `uploadUrl`
   * (senaste-vinner): en ny save på samma dokument ersätter den väntande
   * (och nollställer ev. konflikt — användaren har sparat på nytt).
   */
  async enqueue(input: EnqueueInput): Promise<QueueEntry> {
    await mkdir(this.dir, { recursive: true });
    const key = entryKey(input);
    const existing = this.entries.get(key);
    const id = existing?.id ?? this.deps.newId();
    const now = this.deps.now();
    // Bytes först (durabilitet), sedan manifest — manifestets närvaro = giltig post.
    await writeFile(this.contentPath(id), input.bytes);
    const entry: QueueEntry = {
      id,
      ...(input.document ? { document: input.document } : {}),
      ...(input.uploadUrl !== undefined ? { uploadUrl: input.uploadUrl } : {}),
      fileName: input.fileName,
      ...(input.authHeader !== undefined ? { authHeader: input.authHeader } : {}),
      enqueuedAt: existing?.enqueuedAt ?? now,
      attempts: 0,
      nextAttemptAt: now,
      status: "pending",
    };
    await writeFile(this.manifestPath(id), JSON.stringify(entry), "utf8");
    this.entries.set(key, entry);
    log(`queue: köade ${input.fileName} (${this.pendingCount()} väntar)`);
    return entry;
  }

  /**
   * Ett dräneringsvarv: försök ladda upp varje förfallen `pending`-post.
   * 2xx → klar (filer raderas). 409 → konflikt (slutar retr:a, ytläggs).
   * Annat/nätfel → öka attempts + backoff, behåll posten.
   */
  async drainOnce(): Promise<DrainResult> {
    if (this.draining) return { uploaded: 0, conflicted: 0, failed: 0, skipped: 0 };
    this.draining = true;
    const res: DrainResult = { uploaded: 0, conflicted: 0, failed: 0, skipped: 0 };
    try {
      const now = this.deps.now();
      for (const entry of [...this.entries.values()]) {
        if (entry.status !== "pending" || entry.nextAttemptAt > now) {
          res.skipped++;
          continue;
        }
        await this.attempt(entry, res);
      }
    } finally {
      this.draining = false;
    }
    return res;
  }

  private async attempt(entry: QueueEntry, res: DrainResult): Promise<void> {
    let status: number;
    try {
      const bytes = await readFile(this.contentPath(entry.id));
      // Egen authHeader (från browsern) först; annars helperns färska OIDC-token.
      const auth = entry.authHeader ?? (this.tokenProvider ? await this.tokenProvider() : undefined);
      if (entry.document) {
        // Server-tier: tRPC uploadContent (kastar vid fel → markFailed nedan).
        await this.deps.uploadDoc(entry.document, bytes, auth);
        status = 200;
      } else {
        status = await this.deps.put(entry.uploadUrl ?? "", bytes, auth);
      }
    } catch (err) {
      await this.markFailed(entry, msg(err));
      res.failed++;
      return;
    }
    if (status < 400) {
      await this.discard(entry);
      res.uploaded++;
      log(`queue: laddade upp ${entry.fileName}`);
    } else if (status === 409) {
      await this.markConflict(entry);
      res.conflicted++;
      log(`queue: KONFLIKT på ${entry.fileName} — server gått förbi, kräver beslut`);
    } else {
      await this.markFailed(entry, `HTTP ${status}`);
      res.failed++;
    }
  }

  private async markFailed(entry: QueueEntry, error: string): Promise<void> {
    entry.attempts++;
    entry.lastError = error;
    entry.nextAttemptAt = this.deps.now() + backoffMs(entry.attempts);
    await this.persist(entry);
  }

  private async markConflict(entry: QueueEntry): Promise<void> {
    entry.status = "conflict";
    entry.lastError = "HTTP 409";
    await this.persist(entry);
  }

  private async persist(entry: QueueEntry): Promise<void> {
    await writeFile(this.manifestPath(entry.id), JSON.stringify(entry), "utf8");
  }

  /** Ta bort en post helt (klar eller manuellt löst). */
  async discard(entry: QueueEntry): Promise<void> {
    this.entries.delete(entryKey(entry));
    await rm(this.manifestPath(entry.id), { force: true });
    await rm(this.contentPath(entry.id), { force: true });
  }

  /** Starta ett periodiskt dräneringsvarv tills `signal` avbryts. */
  startDrainLoop(signal: AbortSignal, intervalMs = DEFAULT_DRAIN_INTERVAL_MS): void {
    const tick = (): void => {
      if (signal.aborted) return;
      void this.drainOnce().catch((err) => log(`queue drain: ${msg(err)}`));
    };
    const timer = setInterval(tick, intervalMs);
    signal.addEventListener("abort", () => clearInterval(timer));
  }

  private pendingCount(): number {
    return [...this.entries.values()].filter((e) => e.status === "pending").length;
  }

  /** Status-ögonblicksbild för UI (utan känsliga authHeaders). */
  snapshot(): QueueSnapshot {
    const entries = [...this.entries.values()].map(({ authHeader: _authHeader, ...rest }) => rest);
    return {
      pending: entries.filter((e) => e.status === "pending").length,
      conflict: entries.filter((e) => e.status === "conflict").length,
      total: entries.length,
      entries,
    };
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
