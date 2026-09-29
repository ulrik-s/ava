"use client";

/**
 * `JobQueue` — singleton in-memory kö för klient-side jobb som tar
 * tid: dokumentklassificering, sök-indexering, batch-uppladdningar,
 * etc.
 *
 * Designprinciper:
 *
 *   1. **Single-flight per kind**: vi kör max ett jobb per `kind`
 *      samtidigt (klassificering blockerar inte indexering, men två
 *      klassificeringar köas seriellt). Det minskar minnesproblem
 *      och håller LLM-anrop snälla.
 *
 *   2. **Abort-stöd**: varje worker får en AbortSignal; cancel-knappen
 *      i UI:n sätter signal:n. Workers ska respektera den och kasta.
 *
 *   3. **Persistent observerbar state**: UI:n läser via subscribe()
 *      (samma mönster som tRPC + React). Jobben *själva* är inte
 *      persistenta över page-reload — det är medvetet, omstartade
 *      jobb hör hemma i selectoren (t.ex. "vilka dokument saknar
 *      analyzedAt → enqueue klassificering").
 *
 *   4. **Bounded history**: senaste N=50 färdiga jobb behålls för
 *      synlighet, äldre dropps.
 */

import { omitUndefined } from "@/lib/shared/omit-undefined";

export type JobKind =
  | "classify-document"
  | "extract-text"
  | "index-document"
  | "upload-document"
  | "mirror-to-outlook"
  | "sync"
  | "custom";

export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";

export interface Job {
  id: string;
  kind: JobKind;
  label: string;
  status: JobStatus;
  /** 0..1 om workern rapporterar progress. */
  progress?: number;
  /** För debug/visning — t.ex. dokument-id eller fil-namn. */
  payload?: Record<string, unknown>;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export type JobWorker<P = Record<string, unknown>> = (
  payload: P,
  ctx: { signal: AbortSignal; setProgress: (p: number) => void },
) => Promise<void>;

type Listener = (jobs: Job[]) => void;

const HISTORY_LIMIT = 50;
/** Hur länge ett avbrutet jobb får hålla sin kind innan vakten varnar (#1283). */
const CANCEL_STALL_WARN_MS = 10_000;

/**
 * Vem som håller en kinds plats i kön just nu — för att felsöka en kö som
 * står still (#1283). Kön kör ett jobb per kind åt gången, och ett avbrutet
 * jobb håller platsen tills workern faktiskt returnerar.
 */
export interface KindSlotDiagnostics {
  kind: JobKind;
  /** Jobbet som kör (och håller kinden), eller null om inget kör. */
  holder: {
    id: string;
    label: string;
    runningForMs: number;
    /** Tid sedan avbrott begärdes, eller null om jobbet inte avbrutits. */
    abortRequestedForMs: number | null;
  } | null;
  /** Antal jobb av kinden som väntar. */
  queued: number;
  /** Hur länge det äldsta väntande jobbet har väntat, eller null. */
  oldestQueuedWaitMs: number | null;
}

/** Inställningar för en kö. */
export interface JobQueueOptions {
  /** Varna när ett avbrutet jobb inte släppt sin kind efter så här många ms. */
  cancelStallWarnMs?: number;
}

class JobQueueImpl {
  private workers = new Map<JobKind, JobWorker>();
  private jobs: Job[] = [];
  private abortControllers = new Map<string, AbortController>();
  private listeners = new Set<Listener>();
  /** Map<kind, isRunning> — single-flight per kind. */
  private running = new Set<JobKind>();
  /** När avbrott begärdes för ett jobb som kör (jobb-id → tidpunkt). */
  private abortRequestedAt = new Map<string, number>();
  /** Vakter för avbrutna jobb som inte returnerat (jobb-id → timer). */
  private stallTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly cancelStallWarnMs: number;

  constructor(opts: JobQueueOptions = {}) {
    this.cancelStallWarnMs = opts.cancelStallWarnMs ?? CANCEL_STALL_WARN_MS;
  }

  registerWorker<P extends Record<string, unknown>>(kind: JobKind, worker: JobWorker<P>): void {
    this.workers.set(kind, worker as JobWorker);
  }

  enqueue(kind: JobKind, label: string, payload?: Record<string, unknown>): string {
    const id = makeId();
    const job: Job = {
      id, kind, label,
      status: "queued",
      ...omitUndefined({ payload }),
      enqueuedAt: Date.now(),
    };
    this.jobs.unshift(job);
    this.trim();
    this.notify();
    void this.pump();
    return id;
  }

  cancel(id: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    if (job.status === "queued") {
      job.status = "canceled";
      job.finishedAt = Date.now();
    } else if (job.status === "running") {
      const ac = this.abortControllers.get(id);
      ac?.abort();
      // Status sätts till "canceled" när worker:n returnerar och vi
      // detekterar AbortError; se runJob.
      this.watchStall(job);
    }
    this.notify();
  }

  retry(id: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || (job.status !== "failed" && job.status !== "canceled")) return;
    job.status = "queued";
    delete job.error;
    delete job.startedAt;
    delete job.finishedAt;
    delete job.progress;
    this.notify();
    void this.pump();
  }

  list(): Job[] { return [...this.jobs]; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.list());
    return () => { this.listeners.delete(listener); };
  }

  /** Töm färdiga jobb (för "rensa historik"-knappen). */
  clearFinished(): void {
    this.jobs = this.jobs.filter((j) => j.status === "queued" || j.status === "running");
    this.notify();
  }

  /**
   * Ögonblicksbild av varje kind som har ett jobb som kör eller väntar: vem
   * som håller platsen, hur länge, och om den avbrutits utan att släppa.
   */
  diagnose(now: number = Date.now()): KindSlotDiagnostics[] {
    const kinds = new Set(this.jobs.filter(isActive).map((j) => j.kind));
    return [...kinds].map((kind) => this.diagnoseKind(kind, now));
  }

  private diagnoseKind(kind: JobKind, now: number): KindSlotDiagnostics {
    const ofKind = this.jobs.filter((j) => j.kind === kind);
    const running = ofKind.find((j) => j.status === "running");
    const queued = ofKind.filter((j) => j.status === "queued");
    const oldest = Math.min(...queued.map((j) => j.enqueuedAt));
    return {
      kind,
      holder: running ? this.holderOf(running, now) : null,
      queued: queued.length,
      oldestQueuedWaitMs: queued.length > 0 ? now - oldest : null,
    };
  }

  private holderOf(job: Job, now: number): NonNullable<KindSlotDiagnostics["holder"]> {
    const abortAt = this.abortRequestedAt.get(job.id);
    return {
      id: job.id,
      label: job.label,
      runningForMs: now - (job.startedAt ?? now),
      abortRequestedForMs: abortAt === undefined ? null : now - abortAt,
    };
  }

  /**
   * Vakt: ett avbrutet jobb ska returnera. Gör det inte det (workern
   * ignorerar AbortSignal, eller hänger på ett anrop utan signal) blockeras
   * alla följande jobb av samma kind. Det syns då i konsolen i stället för
   * att kön tyst står still.
   */
  private watchStall(job: Job): void {
    if (this.abortRequestedAt.has(job.id)) return;
    this.abortRequestedAt.set(job.id, Date.now());
    this.stallTimers.set(job.id, setTimeout(() => { this.warnStall(job); }, this.cancelStallWarnMs));
  }

  private warnStall(job: Job): void {
    const d = this.diagnoseKind(job.kind, Date.now());
    console.warn(
      `[job-queue] '${job.kind}'-jobbet "${job.label}" avbröts för ${this.cancelStallWarnMs} ms sedan men workern har inte släppt; ` +
      `${d.queued} jobb väntar. ${formatDiagnostics(this.diagnose())}`,
    );
  }

  private releaseStallWatch(id: string): void {
    clearTimeout(this.stallTimers.get(id));
    this.stallTimers.delete(id);
    this.abortRequestedAt.delete(id);
  }

  private async pump(): Promise<void> {
    // Hitta nästa queued-jobb vars kind inte redan körs
    const next = this.jobs.find(
      (j) => j.status === "queued" && !this.running.has(j.kind),
    );
    if (!next) return;
    const worker = this.workers.get(next.kind);
    if (!worker) {
      next.status = "failed";
      next.error = `Ingen worker registrerad för '${next.kind}'`;
      next.finishedAt = Date.now();
      this.notify();
      void this.pump();
      return;
    }
    this.running.add(next.kind);
    void this.runJob(next, worker);
  }

  private async runJob(job: Job, worker: JobWorker): Promise<void> {
    job.status = "running";
    job.startedAt = Date.now();
    const ac = new AbortController();
    this.abortControllers.set(job.id, ac);
    this.notify();

    try {
      await worker(job.payload ?? {}, {
        signal: ac.signal,
        setProgress: (p: number) => {
          job.progress = Math.max(0, Math.min(1, p));
          this.notify();
        },
      });
      if (ac.signal.aborted) {
        job.status = "canceled";
      } else {
        job.status = "done";
        job.progress = 1;
      }
    } catch (err) {
      if (ac.signal.aborted || isAbortError(err)) {
        job.status = "canceled";
      } else {
        job.status = "failed";
        job.error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      job.finishedAt = Date.now();
      this.abortControllers.delete(job.id);
      this.releaseStallWatch(job.id);
      this.running.delete(job.kind);
      this.notify();
      // Kör nästa jobb
      void this.pump();
    }
  }

  private notify(): void {
    const snapshot = this.list();
    for (const l of this.listeners) {
      try { l(snapshot); } catch (e) { console.error("[job-queue] listener kastade:", e); }
    }
  }

  private trim(): void {
    const finished = this.jobs.filter((j) => j.status === "done" || j.status === "canceled" || j.status === "failed");
    if (finished.length <= HISTORY_LIMIT) return;
    const keep = new Set(finished.slice(0, HISTORY_LIMIT).map((j) => j.id));
    this.jobs = this.jobs.filter((j) => j.status === "queued" || j.status === "running" || keep.has(j.id));
  }
}

function makeId(): string {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isActive(j: Job): boolean {
  return j.status === "queued" || j.status === "running";
}

function formatKind(d: KindSlotDiagnostics): string {
  const h = d.holder;
  const abort = h?.abortRequestedForMs == null ? "" : `, avbruten för ${h.abortRequestedForMs} ms sedan`;
  const who = h ? `kör ${h.id} "${h.label}" i ${h.runningForMs} ms${abort}` : "INGET kör";
  const wait = d.oldestQueuedWaitMs === null ? "" : ` (äldsta ${d.oldestQueuedWaitMs} ms)`;
  return `${d.kind}: ${who}; ${d.queued} väntar${wait}`;
}

/** En läsbar rad per kind — för felmeddelanden och konsolen. */
export function formatDiagnostics(diagnostics: readonly KindSlotDiagnostics[]): string {
  if (diagnostics.length === 0) return "jobbkön: inga aktiva kinds";
  return `jobbkön: ${diagnostics.map(formatKind).join(" | ")}`;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message));
}

/** En jobbkö — appen använder singletonen `jobQueue`. */
export type JobQueue = JobQueueImpl;

/** Skapa en egen kö (tester, eller kortare vakt-tid). Appen använder `jobQueue`. */
export function createJobQueue(opts: JobQueueOptions = {}): JobQueue {
  return new JobQueueImpl(opts);
}

/** Singleton — instansieras en gång per browser-tab. */
export const jobQueue = createJobQueue();
