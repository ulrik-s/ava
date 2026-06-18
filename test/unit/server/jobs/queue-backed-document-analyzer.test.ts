/**
 * Tester för `QueueBackedDocumentAnalyzer` (#518) — enqueue:ar classify-jobb
 * på pg-boss; tydligt fel om kön inte är redo.
 */

import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest-compat";
import { QueueBackedDocumentAnalyzer } from "@/lib/server/jobs/queue-backed-document-analyzer";

describe("QueueBackedDocumentAnalyzer", () => {
  it("enqueue:ar classify-document med documentId + organizationId", async () => {
    const send = vi.fn(async () => "job-1");
    const analyzer = new QueueBackedDocumentAnalyzer(() => ({ send } as unknown as PgBoss), "org-1");
    await analyzer.analyze("doc-9");
    expect(send).toHaveBeenCalledWith("classify-document", { documentId: "doc-9", organizationId: "org-1" });
  });

  it("kastar tydligt när boss saknas (kön ej redo)", async () => {
    const analyzer = new QueueBackedDocumentAnalyzer(() => null, "org-1");
    await expect(analyzer.analyze("doc-9")).rejects.toThrow(/jobb-kön är inte redo/);
  });
});
