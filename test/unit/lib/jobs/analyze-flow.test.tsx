/**
 * Tester för hela analyze-flödet:
 *   1. classify-document-worker:n kör filename-heuristiken
 *   2. Anropar dispatcher med EFTERFRÅGADE fält (kind + analyzedAt
 *      + analysisStatus) så att UI:n slutar visa "analyseras..."
 *
 * Bugg: tidigare workern satte bara `documentType`. UI:n förlitade
 * sig på `analyzedAt` för att markera analysen som klar — så
 * "⏳ analyseras..."-state:n hängde kvar permanent.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from "vitest";
import { jobQueue } from "@/lib/client/jobs/job-queue";
import { setAnalyzeDispatcher } from "@/lib/client/jobs/analyze-dispatch";
import "@/lib/client/jobs/register-workers"; // ensure worker is registered

beforeEach(() => {
  jobQueue.list().forEach((j) => {
    if (j.status === "queued" || j.status === "running") jobQueue.cancel(j.id);
  });
  jobQueue.clearFinished();
});

function waitForStatus(id: string, kind: string, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const j = jobQueue.list().find((x) => x.id === id);
      if (j && j.status === kind) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout: ${id} aldrig ${kind} (är ${j?.status})`));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe("classify-document worker — full dispatch", () => {
  it("klassificerar 'stamning.pdf' som STAMNING och markerar analyzedAt", async () => {
    const dispatched: Array<{ documentId: string; kind: string; analyzedAt?: string; analysisStatus?: string }> = [];
    setAnalyzeDispatcher(async (args) => {
      dispatched.push(args);
    });

    const id = jobQueue.enqueue("classify-document", "Test", {
      documentId: "d-1",
      fileName: "stamning-mot-x.pdf",
    });
    await waitForStatus(id, "done");

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].documentId).toBe("d-1");
    expect(dispatched[0].kind).toBe("STAMNING");
    // CRITICAL: UI:n förlitar sig på dessa för att stoppa "analyseras..."
    expect(dispatched[0].analyzedAt).toBeDefined();
    expect(dispatched[0].analysisStatus).toBe("DONE");
    setAnalyzeDispatcher(null);
  });

  it("fall till OKLASSIFICERAT när filename ej matchar känd kategori", async () => {
    const dispatched: Array<{ documentId: string; kind: string }> = [];
    setAnalyzeDispatcher(async (args) => { dispatched.push(args); });

    const id = jobQueue.enqueue("classify-document", "Test", {
      documentId: "d-2", fileName: "okx.pdf",
    });
    await waitForStatus(id, "done");

    expect(dispatched[0].kind).toBe("OKLASSIFICERAT");
    setAnalyzeDispatcher(null);
  });

  it("avsaknad fileName (t.ex. från Analysera-knappen) klassar OKLASSIFICERAT men sätter ändå analyzedAt", async () => {
    const dispatched: Array<{ documentId: string; kind: string; analyzedAt?: string }> = [];
    setAnalyzeDispatcher(async (args) => { dispatched.push(args); });

    const id = jobQueue.enqueue("classify-document", "Test", {
      documentId: "d-3", fileName: "",
    });
    await waitForStatus(id, "done");

    expect(dispatched[0].kind).toBe("OKLASSIFICERAT");
    // Även om vi inte kunde klassa, ska analysen markeras som körd
    expect(dispatched[0].analyzedAt).toBeDefined();
    setAnalyzeDispatcher(null);
  });

  it("error propagerar om dispatcher kastar", async () => {
    setAnalyzeDispatcher(async () => { throw new Error("DB nere"); });

    const id = jobQueue.enqueue("classify-document", "Test", {
      documentId: "d-4", fileName: "x.pdf",
    });
    await waitForStatus(id, "failed");
    const job = jobQueue.list().find((j) => j.id === id);
    expect(job?.error).toContain("DB nere");
    setAnalyzeDispatcher(null);
  });
});
