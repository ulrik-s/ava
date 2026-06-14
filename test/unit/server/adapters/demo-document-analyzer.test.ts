/**
 * Tester för demoDocumentAnalyzer — verifiera att den enqueue:ar ett
 * classify-document-jobb istället för att vara noop som tidigare.
 *
 */

import { describe, it, expect, beforeEach } from "vitest-compat";
import { jobQueue } from "@/lib/client/jobs/job-queue";
import { demoDocumentAnalyzer } from "@/lib/server/adapters/demo-document-analyzer";

beforeEach(() => {
  // Rensa kön mellan testen
  jobQueue.list().forEach((j) => {
    if (j.status === "queued" || j.status === "running") jobQueue.cancel(j.id);
  });
  jobQueue.clearFinished();
});

describe("demoDocumentAnalyzer", () => {
  it("analyze() lägger till ett classify-document-jobb i kön", async () => {
    await demoDocumentAnalyzer.analyze("d-test-1");
    const jobs = jobQueue.list();
    const classifyJobs = jobs.filter((j) => j.kind === "classify-document");
    expect(classifyJobs.length).toBe(1);
    expect(classifyJobs[0]!.payload).toMatchObject({ documentId: "d-test-1" });
  });

  it("jobb-label innehåller en del av documentId så användaren känner igen det", async () => {
    await demoDocumentAnalyzer.analyze("d-abcdef123456");
    const job = jobQueue.list().find((j) => j.kind === "classify-document");
    expect(job?.label).toContain("d-abcdef1234");
  });

  it("två analyze-anrop → två jobb (single-flight per kind är queue-nivå)", async () => {
    await demoDocumentAnalyzer.analyze("d-1");
    await demoDocumentAnalyzer.analyze("d-2");
    expect(jobQueue.list().filter((j) => j.kind === "classify-document").length).toBe(2);
  });
});
