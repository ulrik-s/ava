/**
 * Tester för mirror-to-outlook-workern. Vi mockar Graph-modulen och
 * registrerar token-provider + state-dispatcher via dispatch-modulen.
 *
 * Workern ligger i `register-workers.ts` och registreras via side-effect-
 * import. Vi måste därför importera den modulen ONCE per testrun.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { jobQueue, type Job } from "@/lib/client/jobs/job-queue";
import {
  setOutlookTokenProvider,
  setMirrorStateDispatcher,
} from "@/lib/client/jobs/mirror-outlook-dispatch";

// Mocka Graph-modulen. `vi.hoisted` säkerställer att fns finns när workern
// dynamiskt import:ar dem inuti job-körningen.
const graph = vi.hoisted(() => ({
  createGraphEvent: vi.fn(),
  updateGraphEvent: vi.fn(),
  deleteGraphEvent: vi.fn(),
  toGraphEvent: vi.fn((ev: { title: string }) => ({ subject: ev.title })),
}));
vi.mock("@/lib/client/integrations/microsoft-graph", () => graph);

// Trigger registreringen av workern.
import "@/lib/client/jobs/register-workers";

function waitForFinish(id: string, timeoutMs = 1000): Promise<Job> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const j = jobQueue.list().find((x) => x.id === id);
      if (j && (j.status === "done" || j.status === "failed" || j.status === "canceled")) {
        return resolve(j);
      }
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout: ${id} (${j?.status})`));
      setTimeout(tick, 5);
    };
    tick();
  });
}

beforeEach(() => {
  // Töm queue:n
  jobQueue.list().forEach((j) => {
    if (j.status === "queued" || j.status === "running") jobQueue.cancel(j.id);
  });
  jobQueue.clearFinished();
  vi.clearAllMocks();
  setOutlookTokenProvider(null);
  setMirrorStateDispatcher(null);
});

describe("mirror-to-outlook worker", () => {
  it("ingen token → dispatch:ar mirrorStatus=failed med tydligt meddelande", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    setOutlookTokenProvider(async () => null);
    setMirrorStateDispatcher(dispatch);

    const id = jobQueue.enqueue("mirror-to-outlook", "test", {
      eventId: "ev-1",
      op: "upsert",
      event: { title: "T", startAt: "2026-01-01T09:00:00Z", allDay: false, visibility: "normal", kind: "appointment" },
    });
    await waitForFinish(id);

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0][0].patch.mirrorStatus).toBe("failed");
    expect(dispatch.mock.calls[0][0].patch.mirrorError).toMatch(/Office 365/);
    expect(graph.createGraphEvent).not.toHaveBeenCalled();
  });

  it("upsert utan outlookEventId → createGraphEvent + synced", async () => {
    graph.createGraphEvent.mockResolvedValue({ id: "g-new" });
    const dispatch = vi.fn().mockResolvedValue(undefined);
    setOutlookTokenProvider(async () => "tok");
    setMirrorStateDispatcher(dispatch);

    const id = jobQueue.enqueue("mirror-to-outlook", "test", {
      eventId: "ev-2",
      op: "upsert",
      event: { title: "Nytt", startAt: "2026-01-02T09:00:00Z", allDay: false, visibility: "normal", kind: "appointment" },
    });
    const job = await waitForFinish(id);
    expect(job.status).toBe("done");
    expect(graph.createGraphEvent).toHaveBeenCalledOnce();
    expect(graph.updateGraphEvent).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledOnce();
    const patch = dispatch.mock.calls[0][0].patch;
    expect(patch.outlookEventId).toBe("g-new");
    expect(patch.mirrorStatus).toBe("synced");
  });

  it("upsert med outlookEventId → updateGraphEvent + synced", async () => {
    graph.updateGraphEvent.mockResolvedValue({ id: "g-existing" });
    const dispatch = vi.fn().mockResolvedValue(undefined);
    setOutlookTokenProvider(async () => "tok");
    setMirrorStateDispatcher(dispatch);

    const id = jobQueue.enqueue("mirror-to-outlook", "test", {
      eventId: "ev-3",
      op: "upsert",
      outlookEventId: "g-existing",
      event: { title: "Uppd", startAt: "2026-01-03T09:00:00Z", allDay: false, visibility: "normal", kind: "appointment" },
    });
    const job = await waitForFinish(id);
    expect(job.status).toBe("done");
    expect(graph.updateGraphEvent).toHaveBeenCalledOnce();
    expect(graph.createGraphEvent).not.toHaveBeenCalled();
    expect(dispatch.mock.calls[0][0].patch.outlookEventId).toBe("g-existing");
  });

  it("delete med outlookEventId → deleteGraphEvent, ingen state-dispatch", async () => {
    graph.deleteGraphEvent.mockResolvedValue(undefined);
    const dispatch = vi.fn().mockResolvedValue(undefined);
    setOutlookTokenProvider(async () => "tok");
    setMirrorStateDispatcher(dispatch);

    const id = jobQueue.enqueue("mirror-to-outlook", "test", {
      eventId: "ev-4",
      op: "delete",
      outlookEventId: "g-bye",
    });
    const job = await waitForFinish(id);
    expect(job.status).toBe("done");
    expect(graph.deleteGraphEvent).toHaveBeenCalledWith("g-bye", expect.objectContaining({ token: "tok" }));
    // delete behöver inte uppdatera AVA-raden (calendar.delete har redan tagit bort den)
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("Graph kastar → dispatch:ar failed + workern misslyckas", async () => {
    graph.createGraphEvent.mockRejectedValue(new Error("403 forbidden"));
    const dispatch = vi.fn().mockResolvedValue(undefined);
    setOutlookTokenProvider(async () => "tok");
    setMirrorStateDispatcher(dispatch);

    const id = jobQueue.enqueue("mirror-to-outlook", "test", {
      eventId: "ev-5",
      op: "upsert",
      event: { title: "Boom", startAt: "2026-01-04T09:00:00Z", allDay: false, visibility: "normal", kind: "appointment" },
    });
    const job = await waitForFinish(id);
    expect(job.status).toBe("failed");
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0][0].patch.mirrorStatus).toBe("failed");
    expect(dispatch.mock.calls[0][0].patch.mirrorError).toMatch(/403/);
  });
});
