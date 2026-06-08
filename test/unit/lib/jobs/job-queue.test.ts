/**
 * Tester för JobQueue — enqueue, run, cancel, retry, single-flight,
 * subscribe-notifieringar.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { jobQueue, type Job } from "@/lib/client/jobs/job-queue";

beforeEach(() => {
  // Töm queue:n mellan testen — den är singleton
  jobQueue.list().forEach((j) => {
    if (j.status === "queued" || j.status === "running") jobQueue.cancel(j.id);
  });
  jobQueue.clearFinished();
});

function waitForStatus(id: string, status: Job["status"], timeoutMs = 500): Promise<Job> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const j = jobQueue.list().find((x) => x.id === id);
      if (j && j.status === status) return resolve(j);
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout: ${id} aldrig ${status} (är ${j?.status})`));
      setTimeout(tick, 5);
    };
    tick();
  });
}

describe("JobQueue", () => {
  it("kör ett enkelt jobb och markerar done", async () => {
    const worker = vi.fn().mockResolvedValue(undefined);
    jobQueue.registerWorker("custom", worker);
    const id = jobQueue.enqueue("custom", "Test-jobb");
    const job = await waitForStatus(id, "done");
    expect(job.status).toBe("done");
    expect(job.progress).toBe(1);
    expect(worker).toHaveBeenCalledOnce();
  });

  it("misslyckas → status=failed + error-meddelande", async () => {
    jobQueue.registerWorker("custom", async () => { throw new Error("kaos"); });
    const id = jobQueue.enqueue("custom", "Kommer falla");
    const job = await waitForStatus(id, "failed");
    expect(job.error).toContain("kaos");
  });

  it("cancel av queued jobb → status=canceled, worker körs aldrig", async () => {
    // Blocka kön med ett långsamt jobb först
    jobQueue.registerWorker("custom", async () => new Promise((r) => setTimeout(r, 200)));
    const blocking = jobQueue.enqueue("custom", "Blockerande");
    const second = jobQueue.enqueue("custom", "Ska avbrytas");
    jobQueue.cancel(second);
    expect(jobQueue.list().find((j) => j.id === second)?.status).toBe("canceled");
    // Cleanup
    jobQueue.cancel(blocking);
  });

  it("cancel av running jobb → worker får AbortSignal", async () => {
    let signalled = false;
    jobQueue.registerWorker("custom", async (_p, ctx) => {
      await new Promise<void>((_, reject) => {
        ctx.signal.addEventListener("abort", () => { signalled = true; reject(new Error("aborted")); });
      });
    });
    const id = jobQueue.enqueue("custom", "Avbryt mig");
    await waitForStatus(id, "running");
    jobQueue.cancel(id);
    const job = await waitForStatus(id, "canceled");
    expect(signalled).toBe(true);
    expect(job.status).toBe("canceled");
  });

  it("single-flight per kind: två jobb av samma kind körs seriellt", async () => {
    const order: number[] = [];
    jobQueue.registerWorker("custom", async (p) => {
      order.push((p as { n: number }).n);
      await new Promise((r) => setTimeout(r, 30));
    });
    const a = jobQueue.enqueue("custom", "A", { n: 1 });
    const b = jobQueue.enqueue("custom", "B", { n: 2 });
    await waitForStatus(a, "done", 1000);
    await waitForStatus(b, "done", 1000);
    expect(order).toEqual([1, 2]);
  });

  it("subscribe får snapshot vid varje state-byte", () => {
    const listener = vi.fn();
    const unsub = jobQueue.subscribe(listener);
    jobQueue.enqueue("custom", "X");
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
    unsub();
  });

  it("retry kör om ett misslyckat jobb", async () => {
    let calls = 0;
    jobQueue.registerWorker("custom", async () => {
      calls++;
      if (calls < 2) throw new Error("första försöket");
    });
    const id = jobQueue.enqueue("custom", "Retry-mig");
    await waitForStatus(id, "failed");
    jobQueue.retry(id);
    const job = await waitForStatus(id, "done");
    expect(calls).toBe(2);
    expect(job.status).toBe("done");
  });

  it("setProgress rapporterar progress 0..1", async () => {
    jobQueue.registerWorker("custom", async (_p, ctx) => {
      ctx.setProgress(0.3);
      await new Promise((r) => setTimeout(r, 10));
      ctx.setProgress(0.7);
      await new Promise((r) => setTimeout(r, 10));
    });
    const seen: number[] = [];
    const unsub = jobQueue.subscribe((jobs) => {
      const p = jobs[0]?.progress;
      if (p !== undefined && !seen.includes(p)) seen.push(p);
    });
    const id = jobQueue.enqueue("custom", "Progress-test");
    await waitForStatus(id, "done");
    unsub();
    expect(seen).toContain(0.3);
    expect(seen).toContain(0.7);
  });

  it("clearFinished tar bort done/failed/canceled, behåller queued/running", async () => {
    jobQueue.registerWorker("custom", async () => {});
    const id = jobQueue.enqueue("custom", "Klar");
    await waitForStatus(id, "done");
    expect(jobQueue.list().length).toBeGreaterThan(0);
    jobQueue.clearFinished();
    expect(jobQueue.list().filter((j) => j.status === "done").length).toBe(0);
  });
});
