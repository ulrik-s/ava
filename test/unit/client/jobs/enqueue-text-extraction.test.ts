/**
 * `enqueueTextExtraction` (#988) — sömmen som gör att kontakt- och
 * händelseförslag uppstår i klient-tier:erna.
 *
 * Kör mot den RIKTIGA jobb-kön (den är in-memory och lika lätt att inspektera
 * som en mock). Det som testas är att jobbet får med sig `storagePath` och
 * `mimeType`: utan dem hittar workern varken filen eller rätt tolkning, och
 * texten — och därmed förslagen — uteblir tyst.
 */

import { describe, it, expect, beforeEach } from "vitest-compat";
import { enqueueTextExtraction } from "@/lib/client/jobs/enqueue-text-extraction";
import { jobQueue } from "@/lib/client/jobs/job-queue";

const DOC = {
  id: "d-1",
  fileName: "Stämning.pdf",
  mimeType: "application/pdf",
  storagePath: "documents/content/abc.pdf",
};

beforeEach(() => {
  jobQueue.list().forEach((j) => {
    if (j.status === "queued" || j.status === "running") jobQueue.cancel(j.id);
  });
  jobQueue.clearFinished();
});

function extractJobs() {
  return jobQueue.list().filter((j) => j.kind === "extract-text");
}

describe("enqueueTextExtraction", () => {
  it("köar extract-text med filnamn, sökväg och mime-typ", async () => {
    await enqueueTextExtraction(DOC);
    const jobs = extractJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toEqual({
      documentId: "d-1",
      fileName: "Stämning.pdf",
      storagePath: "documents/content/abc.pdf",
      mimeType: "application/pdf",
    });
  });

  it("labeln nämner filen så användaren känner igen jobbet i /jobs", async () => {
    await enqueueTextExtraction(DOC);
    expect(extractJobs()[0]!.label).toContain("Stämning.pdf");
  });

  it("okänt dokument (hittades inte i vyn) → tyst no-op, inget jobb", async () => {
    await enqueueTextExtraction(undefined);
    expect(extractJobs()).toHaveLength(0);
  });
});
