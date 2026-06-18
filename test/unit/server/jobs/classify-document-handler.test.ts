/**
 * Tester för `classify-document`-handlern (#518). Stubbar repo:t; verifierar
 * filnamns-heuristik → metadata-skrivning, no-op vid saknat dokument, samt
 * injicerbar klassificerare (Fas 3:s LLM-väg).
 */

import type { Job } from "pg-boss";
import { describe, expect, it, vi } from "vitest-compat";
import { createClassifyDocumentHandler } from "@/lib/server/jobs/handlers/classify-document-handler";

function jobFor(documentId: string): Job {
  return { data: { documentId } } as unknown as Job;
}

describe("createClassifyDocumentHandler", () => {
  it("klassificerar via filnamn + skriver tillbaka metadata", async () => {
    const documents = {
      getById: vi.fn(async () => ({ id: "d1", fileName: "Stämning.pdf" })),
      update: vi.fn(async () => ({})),
    };
    const handler = createClassifyDocumentHandler({ documents: documents as never });
    await handler(jobFor("d1"));

    expect(documents.getById).toHaveBeenCalledWith("d1");
    const [id, patch] = documents.update.mock.calls[0]!;
    expect(id).toBe("d1");
    expect(patch).toMatchObject({
      documentType: "STAMNING",
      analysisStatus: "DONE",
      analysisModel: "filename-heuristic",
    });
    expect((patch as { analyzedAt: Date }).analyzedAt).toBeInstanceOf(Date);
  });

  it("saknat dokument (raderat) → ingen skrivning", async () => {
    const documents = {
      getById: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    };
    const handler = createClassifyDocumentHandler({ documents: documents as never });
    await handler(jobFor("borta"));
    expect(documents.update).not.toHaveBeenCalled();
  });

  it("använder injicerad classify (Fas 3 LLM-väg) + model-etikett", async () => {
    const documents = {
      getById: vi.fn(async () => ({ id: "d1", fileName: "x.bin" })),
      update: vi.fn(async () => ({})),
    };
    const classify = vi.fn(async () => "AVTAL" as const);
    const handler = createClassifyDocumentHandler({ documents: documents as never, classify, model: "ollama:llama" });
    await handler(jobFor("d1"));
    expect(classify).toHaveBeenCalledWith({ fileName: "x.bin" });
    expect(documents.update.mock.calls[0]![1]).toMatchObject({ documentType: "AVTAL", analysisModel: "ollama:llama" });
  });
});
