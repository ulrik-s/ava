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

class JobQueueImpl {
  private workers = new Map<JobKind, JobWorker>();
  private jobs: Job[] = [];
  private abortControllers = new Map<string, AbortController>();
  private listeners = new Set<Listener>();
  /** Map<kind, isRunning> — single-flight per kind. */
  private running = new Set<JobKind>();

  registerWorker<P extends Record<string, unknown>>(kind: JobKind, worker: JobWorker<P>): void {
    this.workers.set(kind, worker as JobWorker);
  }

  enqueue(kind: JobKind, label: string, payload?: Record<string, unknown>): string {
    const id = makeId();
    const job: Job = {
      id, kind, label,
      status: "queued",
      ...(payload !== undefined ? { payload } : {}),
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

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message));
}

/** Singleton — instansieras en gång per browser-tab. */
export const jobQueue = new JobQueueImpl();
