/**
 * Tester för mirror-to-outlook-workern. Vi mockar Graph-modulen och
 * registrerar token-provider + state-dispatcher via dispatch-modulen.
 *
 * Workern ligger i `register-workers.ts` och registreras via side-effect-
 * import. Vi måste därför importera den modulen ONCE per testrun.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { AVA_EVENT_ID_PROPERTY } from "@/lib/client/integrations/outlook-mirror";
import { jobQueue, type Job } from "@/lib/client/jobs/job-queue";
import {
  setOutlookTokenProvider,
  setMirrorStateDispatcher,
  type UpdateMirrorStateArgs,
} from "@/lib/client/jobs/mirror-outlook-dispatch";

// Trigger registreringen av workern.
import { WORKER_TIMEOUTS_MS } from "@/lib/client/jobs/register-workers";

// Mocka Graph-modulen. `vi.hoisted` säkerställer att fns finns när workern
// dynamiskt import:ar dem inuti job-körningen.
const graph = vi.hoisted(() => ({
  createGraphEvent: vi.fn(),
  updateGraphEvent: vi.fn(),
  deleteGraphEvent: vi.fn(),
  findGraphEventByProperty: vi.fn(),
  toGraphEvent: vi.fn((ev: { title: string }) => ({ subject: ev.title })),
}));
vi.mock("@/lib/client/integrations/microsoft-graph", () => graph);

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

/** Vänta tills `cond` är sant (poll var 5:e ms). */
async function until(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("until: timeout");
    await new Promise((r) => { setTimeout(r, 5); });
  }
}

beforeEach(() => {
  // Töm queue:n
  jobQueue.list().forEach((j) => {
    if (j.status === "queued" || j.status === "running") jobQueue.cancel(j.id);
  });
  jobQueue.clearFinished();
  vi.clearAllMocks();
  // Ingen tidigare spegling i Outlook, om inte testet säger annat (#1361).
  graph.findGraphEventByProperty.mockResolvedValue(null);
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
    expect(dispatch.mock.calls[0]![0].patch.mirrorStatus).toBe("failed");
    expect(dispatch.mock.calls[0]![0].patch.mirrorError).toMatch(/Office 365/);
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
    const patch = dispatch.mock.calls[0]![0].patch;
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
    expect(dispatch.mock.calls[0]![0].patch.outlookEventId).toBe("g-existing");
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
    expect(dispatch.mock.calls[0]![0].patch.mirrorStatus).toBe("failed");
    expect(dispatch.mock.calls[0]![0].patch.mirrorError).toMatch(/403/);
  });

  // ── outlookCalendarId-spreadens truthy-arm (per-kalender-mirroring) ──
  // Default-kalendern utelämnar calendarId; en specifik byrå-/delad kalender
  // skickar den vidare till Graph. Täcker `outlookCalendarId != null`-armen
  // i create/update/delete.

  it("upsert till specifik kalender → createGraphEvent får calendarId", async () => {
    graph.createGraphEvent.mockResolvedValue({ id: "g-cal" });
    const dispatch = vi.fn().mockResolvedValue(undefined);
    setOutlookTokenProvider(async () => "tok");
    setMirrorStateDispatcher(dispatch);

    const id = jobQueue.enqueue("mirror-to-outlook", "test", {
      eventId: "ev-cal-1",
      op: "upsert",
      outlookCalendarId: "cal-A",
      event: { title: "Kal", startAt: "2026-02-01T09:00:00Z", allDay: false, visibility: "normal", kind: "appointment" },
    });
    await waitForFinish(id);
    expect(graph.createGraphEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ token: "tok", calendarId: "cal-A" }),
    );
  });

  it("update i specifik kalender → updateGraphEvent får calendarId", async () => {
    graph.updateGraphEvent.mockResolvedValue({ id: "g-cal-2" });
    const dispatch = vi.fn().mockResolvedValue(undefined);
    setOutlookTokenProvider(async () => "tok");
    setMirrorStateDispatcher(dispatch);

    const id = jobQueue.enqueue("mirror-to-outlook", "test", {
      eventId: "ev-cal-2",
      op: "upsert",
      outlookEventId: "g-cal-2",
      outlookCalendarId: "cal-B",
      event: { title: "Kal2", startAt: "2026-02-02T09:00:00Z", allDay: false, visibility: "normal", kind: "appointment" },
    });
    await waitForFinish(id);
    expect(graph.updateGraphEvent).toHaveBeenCalledWith(
      "g-cal-2",
      expect.anything(),
      expect.objectContaining({ token: "tok", calendarId: "cal-B" }),
    );
  });

  it("delete i specifik kalender → deleteGraphEvent får calendarId", async () => {
    graph.deleteGraphEvent.mockResolvedValue(undefined);
    const dispatch = vi.fn().mockResolvedValue(undefined);
    setOutlookTokenProvider(async () => "tok");
    setMirrorStateDispatcher(dispatch);

    const id = jobQueue.enqueue("mirror-to-outlook", "test", {
      eventId: "ev-cal-3",
      op: "delete",
      outlookEventId: "g-cal-3",
      outlookCalendarId: "cal-C",
    });
    await waitForFinish(id);
    expect(graph.deleteGraphEvent).toHaveBeenCalledWith(
      "g-cal-3",
      expect.objectContaining({ token: "tok", calendarId: "cal-C" }),
    );
  });

  it("delete utan outlookEventId och utan spegling i Outlook → inget tas bort", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    setOutlookTokenProvider(async () => "tok");
    setMirrorStateDispatcher(dispatch);

    const id = jobQueue.enqueue("mirror-to-outlook", "test", {
      eventId: "ev-no-id",
      op: "delete",
    });
    const job = await waitForFinish(id);
    expect(job.status).toBe("done");
    expect(graph.findGraphEventByProperty).toHaveBeenCalledWith(AVA_EVENT_ID_PROPERTY, "ev-no-id", expect.objectContaining({ token: "tok" }));
    expect(graph.deleteGraphEvent).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("upsert utan event-data → workern kastar (saknad payload)", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    setOutlookTokenProvider(async () => "tok");
    setMirrorStateDispatcher(dispatch);

    const id = jobQueue.enqueue("mirror-to-outlook", "test", {
      eventId: "ev-no-event",
      op: "upsert",
    });
    const job = await waitForFinish(id);
    expect(job.status).toBe("failed");
    expect(graph.createGraphEvent).not.toHaveBeenCalled();
  });

  it("Graph kastar icke-Error → mirrorError stringifieras", async () => {
    graph.createGraphEvent.mockRejectedValue("rå-sträng-fel");
    const dispatch = vi.fn().mockResolvedValue(undefined);
    setOutlookTokenProvider(async () => "tok");
    setMirrorStateDispatcher(dispatch);

    const id = jobQueue.enqueue("mirror-to-outlook", "test", {
      eventId: "ev-6",
      op: "upsert",
      event: { title: "RawErr", startAt: "2026-01-05T09:00:00Z", allDay: false, visibility: "normal", kind: "appointment" },
    });
    const job = await waitForFinish(id);
    expect(job.status).toBe("failed");
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]![0].patch.mirrorError).toBe("rå-sträng-fel");
  });

  // ── #1286: ett Graph-anrop som hänger får inte blockera speglingen ──

  it("Graph-anropen får jobbets avbrottssignal", async () => {
    graph.createGraphEvent.mockResolvedValue({ id: "g-sig" });
    setOutlookTokenProvider(async () => "tok");
    setMirrorStateDispatcher(vi.fn().mockResolvedValue(undefined));
    const id = jobQueue.enqueue("mirror-to-outlook", "test", {
      eventId: "ev-sig",
      op: "upsert",
      event: { title: "Sig", startAt: "2026-03-01T09:00:00Z", allDay: false, visibility: "normal", kind: "appointment" },
    });
    await waitForFinish(id);
    expect(graph.createGraphEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("delete får också avbrottssignalen", async () => {
    graph.deleteGraphEvent.mockResolvedValue(undefined);
    setOutlookTokenProvider(async () => "tok");
    setMirrorStateDispatcher(vi.fn().mockResolvedValue(undefined));
    const id = jobQueue.enqueue("mirror-to-outlook", "test", { eventId: "ev-del-sig", op: "delete", outlookEventId: "g-del" });
    await waitForFinish(id);
    expect(graph.deleteGraphEvent).toHaveBeenCalledWith("g-del", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("Graph hänger → Avbryt: jobbet avbryts direkt, eventet markeras som ej speglat, och nästa spegling körs", async () => {
    // Första anropet hänger tills det avbryts (som fetch med signal); nästa lyckas.
    graph.createGraphEvent.mockImplementationOnce((_b: unknown, opts: { signal?: AbortSignal }) => new Promise((_, reject) => {
      opts.signal?.addEventListener("abort", () => { reject(new DOMException("The operation was aborted.", "AbortError")); });
    }));
    graph.createGraphEvent.mockResolvedValueOnce({ id: "g-next" });
    const patches = new Map<string, UpdateMirrorStateArgs["patch"]>();
    setOutlookTokenProvider(async () => "tok");
    setMirrorStateDispatcher(async (args) => { patches.set(args.eventId, args.patch); });
    const event = { title: "Hänger", startAt: "2026-03-02T09:00:00Z", allDay: false, visibility: "normal", kind: "appointment" };
    const hung = jobQueue.enqueue("mirror-to-outlook", "hänger", { eventId: "ev-hang", op: "upsert", event });
    const next = jobQueue.enqueue("mirror-to-outlook", "nästa", { eventId: "ev-next", op: "upsert", event });
    await until(() => graph.createGraphEvent.mock.calls.length === 1);

    jobQueue.cancel(hung);
    expect(jobQueue.list().find((j) => j.id === hung)?.status).toBe("canceled");
    expect((await waitForFinish(next)).status).toBe("done");

    await until(() => patches.has("ev-hang"));
    const hangPatch = patches.get("ev-hang");
    expect(hangPatch).toMatchObject({ mirrorStatus: "failed" });
    expect(hangPatch?.mirrorError).toMatch(/avbröts eller tog för lång tid/);
  });

  it("varje kind som registreras har en tidsgräns; Outlook-speglingen 60 s", () => {
    expect(WORKER_TIMEOUTS_MS["mirror-to-outlook"]).toBe(60_000);
    expect(Object.keys(WORKER_TIMEOUTS_MS).sort()).toEqual(["classify-document", "extract-text", "mirror-to-outlook"]);
    for (const ms of Object.values(WORKER_TIMEOUTS_MS)) expect(ms).toBeGreaterThan(0);
  });
});

// ── #1361: ett avbrutet speglingsjobb får inte ge dubbletter i Outlook ──

interface FakeEvent { avaId?: string; transactionId?: string; subject: string }
interface CreateBody { subject: string; transactionId?: string; singleValueExtendedProperties?: Array<{ id: string; value: string }> }

/**
 * En fejkad Outlook-kalender: skapade event minns sin utökade egenskap
 * (AVA-id:t) och sitt transactionId, och kan sökas fram på AVA-id:t.
 */
function fakeOutlook(): Map<string, FakeEvent> {
  const events = new Map<string, FakeEvent>();
  graph.createGraphEvent.mockImplementation(async (body: CreateBody) => {
    const id = `g-${events.size + 1}`;
    const avaId = body.singleValueExtendedProperties?.find((p) => p.id === AVA_EVENT_ID_PROPERTY)?.value;
    events.set(id, { subject: body.subject, ...(avaId ? { avaId } : {}), ...(body.transactionId ? { transactionId: body.transactionId } : {}) });
    return { id };
  });
  graph.updateGraphEvent.mockImplementation(async (id: string) => ({ id }));
  graph.deleteGraphEvent.mockImplementation(async (id: string) => { events.delete(id); });
  graph.findGraphEventByProperty.mockImplementation(async (prop: string, value: string) =>
    [...events].find(([, ev]) => prop === AVA_EVENT_ID_PROPERTY && ev.avaId === value)?.[0] ?? null);
  return events;
}

describe("mirror-to-outlook — idempotent vid omförsök (#1361)", () => {
  const event = { title: "Förhandling", startAt: "2026-04-01T09:00:00Z", allDay: false, visibility: "normal", kind: "appointment" };

  it("skapandet märks med AVA-id:t och ett transactionId som är detsamma vid omförsök", async () => {
    const outlook = fakeOutlook();
    setOutlookTokenProvider(async () => "tok");
    setMirrorStateDispatcher(vi.fn().mockResolvedValue(undefined));
    await waitForFinish(jobQueue.enqueue("mirror-to-outlook", "test", { eventId: "ev-tx", op: "upsert", event }));
    expect([...outlook.values()]).toEqual([{ subject: "Förhandling", avaId: "ev-tx", transactionId: "ava-calendar-ev-tx" }]);
  });

  it("avbrott efter skapandet men innan id:t sparats → Försök igen uppdaterar samma event, ingen dubblett", async () => {
    const outlook = fakeOutlook();
    setOutlookTokenProvider(async () => "tok");
    const patches: UpdateMirrorStateArgs["patch"][] = [];
    let lost = true;
    setMirrorStateDispatcher(async (args) => {
      // Första sparandet av "synced" går inte fram (fliken stängs, tidsgränsen slår till).
      if (args.patch.mirrorStatus === "synced" && lost) { lost = false; throw new Error("nätet försvann"); }
      patches.push(args.patch);
    });
    const payload = { eventId: "ev-retry", op: "upsert", event };

    expect((await waitForFinish(jobQueue.enqueue("mirror-to-outlook", "första", payload))).status).toBe("failed");
    expect(patches.at(-1)).toMatchObject({ mirrorStatus: "failed" });
    expect(outlook.size).toBe(1);

    // "Försök igen": samma payload, fortfarande utan outlookEventId.
    expect((await waitForFinish(jobQueue.enqueue("mirror-to-outlook", "igen", payload))).status).toBe("done");
    expect(outlook.size).toBe(1);
    expect(graph.createGraphEvent).toHaveBeenCalledTimes(1);
    expect(graph.updateGraphEvent).toHaveBeenCalledWith("g-1", expect.anything(), expect.anything());
    expect(patches.at(-1)).toMatchObject({ mirrorStatus: "synced", outlookEventId: "g-1" });
  });

  it("borttagning utan sparat id tar bort speglingen som skapades före avbrottet", async () => {
    const outlook = fakeOutlook();
    setOutlookTokenProvider(async () => "tok");
    setMirrorStateDispatcher(async (args) => { if (args.patch.mirrorStatus === "synced") throw new Error("avbrutet"); });
    await waitForFinish(jobQueue.enqueue("mirror-to-outlook", "skapa", { eventId: "ev-orphan", op: "upsert", event }));
    expect(outlook.size).toBe(1);

    await waitForFinish(jobQueue.enqueue("mirror-to-outlook", "ta bort", { eventId: "ev-orphan", op: "delete" }));
    expect(outlook.size).toBe(0);
  });

  it("ett känt outlookEventId används direkt, utan sökning", async () => {
    fakeOutlook();
    setOutlookTokenProvider(async () => "tok");
    setMirrorStateDispatcher(vi.fn().mockResolvedValue(undefined));
    await waitForFinish(jobQueue.enqueue("mirror-to-outlook", "test", { eventId: "ev-known", op: "upsert", outlookEventId: "g-9", event }));
    expect(graph.findGraphEventByProperty).not.toHaveBeenCalled();
    expect(graph.updateGraphEvent).toHaveBeenCalledWith("g-9", expect.anything(), expect.anything());
  });
});
