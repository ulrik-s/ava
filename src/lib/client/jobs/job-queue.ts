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
 *      och håller LLM-anrop snälla. Jobben körs i den ordning de köades
 *      (FIFO, #1287).
 *
 *   2. **Abort-stöd**: varje worker får en AbortSignal; cancel-knappen
 *      i UI:n sätter signal:n. Workers ska respektera den och kasta.
 *      Kön väntar INTE på workern (#1286): avbryt markerar jobbet som
 *      avbrutet och släpper kindens plats direkt, och workerns sena
 *      resultat ignoreras. En kind kan också ha en tidsgräns
 *      (`registerWorker(kind, w, { timeoutMs })`). Så kan ett jobb som
 *      hänger aldrig blockera kön.
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

/** Inställningar per kind. */
export interface WorkerOptions {
  /**
   * Tidsgräns för ett jobb av kinden. När den nås avbryts workern, jobbet
   * blir "failed" och platsen släpps (#1286). Utan tidsgräns kör jobbet tills
   * workern returnerar eller användaren avbryter.
   */
  timeoutMs?: number;
}

type Listener = (jobs: Job[]) => void;

const HISTORY_LIMIT = 50;
/** Hur länge en övergiven worker får köra innan vakten varnar (#1283). */
const CANCEL_STALL_WARN_MS = 10_000;

/**
 * Läget för en kind — för att felsöka en kö som står still (#1283, #1286).
 * Kön kör ett jobb per kind åt gången.
 */
export interface KindSlotDiagnostics {
  kind: JobKind;
  /** Jobbet som kör (och håller kinden), eller null om inget kör. */
  holder: { id: string; label: string; runningForMs: number } | null;
  /** Antal jobb av kinden som väntar. */
  queued: number;
  /** Hur länge det äldsta väntande jobbet har väntat, eller null. */
  oldestQueuedWaitMs: number | null;
  /**
   * Workers som övergetts (avbrutna eller över tidsgränsen) men ännu inte
   * returnerat. De blockerar inte kön, men förbrukar resurser.
   */
  abandoned: Array<{ id: string; label: string; abandonedForMs: number }>;
}

/** Inställningar för en kö. */
export interface JobQueueOptions {
  /** Varna när en övergiven worker inte returnerat efter så här många ms. */
  cancelStallWarnMs?: number;
}

/** En körning av ett jobb. Ett jobb som körs om ("Försök igen") får en ny körning. */
interface Run {
  job: Job;
  ac: AbortController;
  timeout?: ReturnType<typeof setTimeout>;
}

/** En övergiven körning vars worker inte returnerat. */
interface Abandoned {
  at: number;
  timer: ReturnType<typeof setTimeout>;
}

type Outcome = { ok: true } | { ok: false; err: unknown };

class JobQueueImpl {
  private workers = new Map<JobKind, JobWorker>();
  private timeouts = new Map<JobKind, number>();
  private jobs: Job[] = [];
  /** Aktuell körning per jobb-id. En körning som inte finns här är övergiven. */
  private runs = new Map<string, Run>();
  private listeners = new Set<Listener>();
  /** Kinds som har ett jobb som kör — single-flight per kind. */
  private running = new Set<JobKind>();
  /** Övergivna körningar vars worker inte returnerat. */
  private abandoned = new Map<Run, Abandoned>();
  /**
   * Köplats per köat jobb (#1287): ett löpnummer som sätts vid enqueue och
   * vid "Försök igen". Kön kör det lägsta först — FIFO. Listan `jobs` har de
   * nyaste först (för /jobs) och kan därför inte ge ordningen.
   */
  private queuePosition = new Map<string, number>();
  private nextPosition = 0;
  private readonly cancelStallWarnMs: number;

  constructor(opts: JobQueueOptions = {}) {
    this.cancelStallWarnMs = opts.cancelStallWarnMs ?? CANCEL_STALL_WARN_MS;
  }

  registerWorker<P extends Record<string, unknown>>(kind: JobKind, worker: JobWorker<P>, opts: WorkerOptions = {}): void {
    this.workers.set(kind, worker as JobWorker);
    if (opts.timeoutMs === undefined) this.timeouts.delete(kind);
    else this.timeouts.set(kind, opts.timeoutMs);
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
    this.queuePosition.set(id, this.nextPosition++);
    this.trim();
    this.notify();
    void this.pump();
    return id;
  }

  cancel(id: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (job?.status === "queued") {
      job.status = "canceled";
      job.finishedAt = Date.now();
      this.queuePosition.delete(id);
      this.notify();
      return;
    }
    const run = this.runs.get(id);
    if (run) this.abandon(run, "canceled");
  }

  retry(id: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || (job.status !== "failed" && job.status !== "canceled")) return;
    job.status = "queued";
    this.queuePosition.set(id, this.nextPosition++); // sist i kön
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
    this.jobs = this.jobs.filter(isActive);
    this.notify();
  }

  /**
   * Ögonblicksbild av varje kind som har ett jobb som kör eller väntar, eller
   * en övergiven worker: vem som håller platsen, hur länge, och vad som väntar.
   */
  diagnose(now: number = Date.now()): KindSlotDiagnostics[] {
    const kinds = new Set([
      ...this.jobs.filter(isActive).map((j) => j.kind),
      ...[...this.abandoned.keys()].map((r) => r.job.kind),
    ]);
    return [...kinds].map((kind) => this.diagnoseKind(kind, now));
  }

  private diagnoseKind(kind: JobKind, now: number): KindSlotDiagnostics {
    const ofKind = this.jobs.filter((j) => j.kind === kind);
    const running = ofKind.find((j) => j.status === "running");
    const queued = ofKind.filter((j) => j.status === "queued");
    const oldest = Math.min(...queued.map((j) => j.enqueuedAt));
    return {
      kind,
      holder: running ? { id: running.id, label: running.label, runningForMs: now - (running.startedAt ?? now) } : null,
      queued: queued.length,
      oldestQueuedWaitMs: queued.length > 0 ? now - oldest : null,
      abandoned: [...this.abandoned]
        .filter(([r]) => r.job.kind === kind)
        .map(([r, a]) => ({ id: r.job.id, label: r.job.label, abandonedForMs: now - a.at })),
    };
  }

  private async pump(): Promise<void> {
    const next = this.nextQueued();
    if (!next) return;
    this.queuePosition.delete(next.id);
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

  /** Det köade jobb som köades först, bland dem vars kind inte redan kör (#1287). */
  private nextQueued(): Job | undefined {
    const ready = this.jobs.filter((j) => j.status === "queued" && !this.running.has(j.kind));
    return minBy(ready, (j) => this.queuePosition.get(j.id) ?? 0);
  }

  private async runJob(job: Job, worker: JobWorker): Promise<void> {
    const run: Run = { job, ac: new AbortController() };
    this.runs.set(job.id, run);
    job.status = "running";
    job.startedAt = Date.now();
    this.startTimeout(run);
    this.notify();
    let outcome: Outcome;
    try {
      await worker(job.payload ?? {}, {
        signal: run.ac.signal,
        setProgress: (p: number) => { this.reportProgress(run, p); },
      });
      outcome = { ok: true };
    } catch (err) {
      outcome = { ok: false, err };
    }
    this.settle(run, outcome);
  }

  private startTimeout(run: Run): void {
    const ms = this.timeouts.get(run.job.kind);
    if (ms === undefined) return;
    run.timeout = setTimeout(() => { this.abandon(run, "failed", `Tidsgränsen på ${formatDuration(ms)} överskreds`); }, ms);
  }

  private reportProgress(run: Run, p: number): void {
    if (!this.isCurrent(run)) return; // en övergiven worker ändrar inte jobbet
    run.job.progress = Math.max(0, Math.min(1, p));
    this.notify();
  }

  private isCurrent(run: Run): boolean {
    return this.runs.get(run.job.id) === run;
  }

  /** Workern har returnerat. Resultatet från en övergiven körning ignoreras. */
  private settle(run: Run, outcome: Outcome): void {
    if (!this.isCurrent(run)) {
      this.forgetAbandoned(run);
      return;
    }
    const { job } = run;
    if (outcome.ok) {
      job.status = "done";
      job.progress = 1;
    } else if (isAbortError(outcome.err)) {
      job.status = "canceled";
    } else {
      job.status = "failed";
      job.error = outcome.err instanceof Error ? outcome.err.message : String(outcome.err);
    }
    this.finish(run);
  }

  /**
   * Avbryt (användaren) eller tidsgräns: signalera workern, avsluta jobbet och
   * släpp kinden DIREKT, utan att vänta på workern (#1286). Returnerar den
   * inte varnar vakten.
   */
  private abandon(run: Run, status: "canceled" | "failed", error?: string): void {
    run.ac.abort();
    run.job.status = status;
    if (error !== undefined) run.job.error = error;
    this.watchAbandoned(run);
    this.finish(run);
  }

  private finish(run: Run): void {
    clearTimeout(run.timeout);
    run.job.finishedAt = Date.now();
    this.runs.delete(run.job.id);
    this.running.delete(run.job.kind);
    this.notify();
    // Kör nästa jobb
    void this.pump();
  }

  /**
   * Vakt: en övergiven worker ska returnera. Gör den inte det (den ignorerar
   * AbortSignal, eller hänger på ett anrop utan signal) syns det i konsolen.
   * Kön är inte blockerad, men workern förbrukar resurser.
   */
  private watchAbandoned(run: Run): void {
    const timer = setTimeout(() => { this.warnAbandoned(run); }, this.cancelStallWarnMs);
    this.abandoned.set(run, { at: Date.now(), timer });
  }

  private warnAbandoned(run: Run): void {
    console.warn(
      `[job-queue] '${run.job.kind}'-jobbet "${run.job.label}" avbröts för ${this.cancelStallWarnMs} ms sedan, men workern har inte returnerat ` +
      `(kön är inte blockerad). ${formatDiagnostics(this.diagnose())}`,
    );
  }

  private forgetAbandoned(run: Run): void {
    clearTimeout(this.abandoned.get(run)?.timer);
    this.abandoned.delete(run);
  }

  private notify(): void {
    const snapshot = this.list();
    for (const l of this.listeners) {
      try { l(snapshot); } catch (e) { console.error("[job-queue] listener kastade:", e); }
    }
  }

  private trim(): void {
    const finished = this.jobs.filter((j) => !isActive(j));
    if (finished.length <= HISTORY_LIMIT) return;
    const keep = new Set(finished.slice(0, HISTORY_LIMIT).map((j) => j.id));
    this.jobs = this.jobs.filter((j) => isActive(j) || keep.has(j.id));
  }
}

function makeId(): string {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function minBy<T>(items: readonly T[], key: (t: T) => number): T | undefined {
  return items.reduce<T | undefined>((best, t) => (best === undefined || key(t) < key(best) ? t : best), undefined);
}

function isActive(j: Job): boolean {
  return j.status === "queued" || j.status === "running";
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`;
}

function formatKind(d: KindSlotDiagnostics): string {
  const h = d.holder;
  const who = h ? `kör ${h.id} "${h.label}" i ${h.runningForMs} ms` : "INGET kör";
  const wait = d.oldestQueuedWaitMs === null ? "" : ` (äldsta ${d.oldestQueuedWaitMs} ms)`;
  const gone = d.abandoned.map((a) => `${a.id} "${a.label}" för ${a.abandonedForMs} ms sedan`).join(", ");
  return `${d.kind}: ${who}; ${d.queued} väntar${wait}${gone ? `; övergivna: ${gone}` : ""}`;
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
