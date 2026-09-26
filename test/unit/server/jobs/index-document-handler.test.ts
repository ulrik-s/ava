/**
 * `index-document`-handlern (#1215): läser sidorna och ersätter dem i indexet —
 * utan att röra dokumentets metadata (ingen omklassificering vid backfill).
 */

import type { Job } from "pg-boss";
import { describe, expect, it, vi } from "vitest-compat";
import { createIndexDocumentHandler } from "@/lib/server/jobs/handlers/index-document-handler";
import { JOB_QUEUES } from "@/lib/server/jobs/job-queue";

function jobFor(documentId: string): Job {
  return {
    id: "job-1", name: JOB_QUEUES.indexDocument, data: { documentId },
    expireInSeconds: 60, heartbeatSeconds: null, signal: AbortSignal.abort(),
  };
}

const DOC_ID = "0195f3b2-0000-7000-8000-00000000000d";

describe("createIndexDocumentHandler", () => {
  it("läser sidorna en gång och ersätter dem i indexet", async () => {
    const doc = { id: DOC_ID, fileName: "a.pdf", storagePath: "documents/content/a.pdf", mimeType: "application/pdf" };
    const readPages = vi.fn(async () => ["ett", "två"]);
    const pageIndex = { replacePages: vi.fn(async () => {}) };
    const getById = vi.fn(async () => doc);
    await createIndexDocumentHandler({ documents: { getById } as never, readPages, pageIndex })(jobFor(DOC_ID));
    expect(readPages).toHaveBeenCalledTimes(1);
    expect(readPages).toHaveBeenCalledWith({ fileName: "a.pdf", storagePath: "documents/content/a.pdf", mimeType: "application/pdf" });
    expect(pageIndex.replacePages).toHaveBeenCalledWith(DOC_ID, ["ett", "två"]);
  });

  it("saknat/raderat dokument → no-op", async () => {
    const readPages = vi.fn(async () => ["x"]);
    const pageIndex = { replacePages: vi.fn(async () => {}) };
    await createIndexDocumentHandler({ documents: { getById: async () => null } as never, readPages, pageIndex })(jobFor(DOC_ID));
    expect(readPages).not.toHaveBeenCalled();
    expect(pageIndex.replacePages).not.toHaveBeenCalled();
  });

  it("ogiltig payload → kastar (pg-boss retry/dead-letter)", async () => {
    const handler = createIndexDocumentHandler({
      documents: { getById: async () => null } as never, readPages: async () => [], pageIndex: { replacePages: async () => {} },
    });
    await expect(handler({ ...jobFor(DOC_ID), data: {} })).rejects.toThrow();
  });
});
