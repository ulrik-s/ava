"use client";

/**
 * `ExternalEditTracker` — pollar `lastModified` på FSA-fil-handles och
 * triggar en commit-callback EFTER en debounce-paus där inga fler
 * sparningar skett.
 *
 * Designval (Single responsibility):
 *   - Bara tracking + debounce. Vet inget om tRPC eller UI — kallaren
 *     skickar en callback som AVA-appen lokalt routar till sin
 *     `document.update`-mutation.
 *
 * Designval (Dependency inversion):
 *   - File-handle typas mot ett minimalt subset av `FileSystemFileHandle`
 *     (bara `getFile()`) så tester kan injicera fake-handles.
 *
 * Flöde:
 *   1. `watch({docId, path, handle})` registrerar filen + sätter
 *      baseline-lastModified (utan att rapportera den första som save).
 *   2. Pollning var `pollIntervalMs` ms. Om `lastModified` > baseline:
 *        - första gången: börja en edit-session, increment saves, sätt
 *          debounce-timer
 *        - efterföljande: increment saves, **reseta** debounce-timer
 *   3. När debounce-timer går ut: läs bytes, anropa `onCommit`, rensa
 *      session-state.
 *   4. `flushNow(docId)` kan kalla onCommit direkt (för "spara nu"-knapp).
 *   5. `getSession(docId)` returnerar metadata för UI-indikator.
 */

interface MinimalFileHandle {
  getFile(): Promise<{ lastModified: number; arrayBuffer: () => Promise<ArrayBuffer> }>;
}

export interface WatchInput {
  docId: string;
  /** Relativ path i repot — bara informationell, för UI-prompts. */
  path: string;
  handle: MinimalFileHandle;
}

export interface CommitPayload {
  docId: string;
  path: string;
  bytes: ArrayBuffer;
  /** Antal sparningar som squashades till denna commit. */
  saves: number;
  /** Tidsstämpel när sessionen INTRÄFFADE (första saven). */
  sessionStartedAt: number;
}

export interface EditSession {
  docId: string;
  path: string;
  saves: number;
  startedAt: number;
}

export interface TrackerOpts {
  pollIntervalMs?: number;
  debounceMs?: number;
  onCommit: (payload: CommitPayload) => void | Promise<void>;
}

interface WatchState {
  docId: string;
  path: string;
  handle: MinimalFileHandle;
  baselineLastModified: number;
  session: EditSession | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

export class ExternalEditTracker {
  private readonly pollIntervalMs: number;
  private readonly debounceMs: number;
  private readonly onCommit: TrackerOpts["onCommit"];
  private readonly watches = new Map<string, WatchState>();
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(opts: TrackerOpts) {
    this.pollIntervalMs = opts.pollIntervalMs ?? 2000;
    this.debounceMs = opts.debounceMs ?? 90_000;
    this.onCommit = opts.onCommit;
  }

  async watch(input: WatchInput): Promise<void> {
    if (this.disposed) return;
    const file = await input.handle.getFile();
    this.watches.set(input.docId, {
      docId: input.docId,
      path: input.path,
      handle: input.handle,
      baselineLastModified: file.lastModified,
      session: null,
      debounceTimer: null,
    });
    this.ensurePollingStarted();
  }

  unwatch(docId: string): void {
    const w = this.watches.get(docId);
    if (w?.debounceTimer) clearTimeout(w.debounceTimer);
    this.watches.delete(docId);
    if (this.watches.size === 0) this.stopPolling();
  }

  getSession(docId: string): EditSession | null {
    return this.watches.get(docId)?.session ?? null;
  }

  /** Lista alla pågående edit-sessions (för en global UI-indikator). */
  listSessions(): EditSession[] {
    const out: EditSession[] = [];
    for (const w of this.watches.values()) if (w.session) out.push(w.session);
    return out;
  }

  async flushNow(docId: string): Promise<void> {
    const w = this.watches.get(docId);
    if (!w || !w.session) return;
    if (w.debounceTimer) clearTimeout(w.debounceTimer);
    w.debounceTimer = null;
    await this.fireCommit(w);
  }

  dispose(): void {
    this.disposed = true;
    for (const w of this.watches.values()) {
      if (w.debounceTimer) clearTimeout(w.debounceTimer);
    }
    this.watches.clear();
    this.stopPolling();
  }

  // ── interna ──────────────────────────────────────────────────────

  private ensurePollingStarted(): void {
    if (this.pollHandle || this.disposed) return;
    this.pollHandle = setInterval(() => { void this.tick(); }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollHandle) clearInterval(this.pollHandle);
    this.pollHandle = null;
  }

  private async tick(): Promise<void> {
    for (const w of this.watches.values()) {
      try {
        const file = await w.handle.getFile();
        if (file.lastModified > w.baselineLastModified) {
          this.onSaveDetected(w, file.lastModified);
        }
      } catch (err) {
        console.warn("[edit-tracker] kunde inte läsa", w.path, err);
      }
    }
  }

  private onSaveDetected(w: WatchState, newLastModified: number): void {
    w.baselineLastModified = newLastModified;
    if (!w.session) {
      w.session = { docId: w.docId, path: w.path, saves: 1, startedAt: Date.now() };
    } else {
      w.session.saves += 1;
    }
    // Reset debounce-timer
    if (w.debounceTimer) clearTimeout(w.debounceTimer);
    w.debounceTimer = setTimeout(() => { void this.fireCommit(w); }, this.debounceMs);
  }

  private async fireCommit(w: WatchState): Promise<void> {
    if (!w.session) return;
    const session = w.session;
    w.session = null;
    w.debounceTimer = null;
    try {
      const file = await w.handle.getFile();
      const bytes = await file.arrayBuffer();
      await this.onCommit({
        docId: session.docId,
        path: session.path,
        bytes,
        saves: session.saves,
        sessionStartedAt: session.startedAt,
      });
    } catch (err) {
      console.error("[edit-tracker] commit misslyckades", session.path, err);
    }
  }
}

// ── Singleton för app:en ──────────────────────────────────────────

let singleton: ExternalEditTracker | null = null;

export function setExternalEditTracker(t: ExternalEditTracker | null): void {
  singleton = t;
}

export function getExternalEditTracker(): ExternalEditTracker | null {
  return singleton;
}

