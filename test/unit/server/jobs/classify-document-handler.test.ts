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
      updateMetadata: vi.fn(async () => ({})),
    };
    const handler = createClassifyDocumentHandler({ documents: documents as never });
    await handler(jobFor("d1"));

    expect(documents.getById).toHaveBeenCalledWith("d1");
    const [id, patch] = documents.updateMetadata.mock.calls[0]!;
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
      updateMetadata: vi.fn(async () => ({})),
    };
    const handler = createClassifyDocumentHandler({ documents: documents as never });
    await handler(jobFor("borta"));
    expect(documents.updateMetadata).not.toHaveBeenCalled();
  });

  it("använder injicerad classify (Fas 3 LLM-väg) + model-etikett", async () => {
    const documents = {
      getById: vi.fn(async () => ({ id: "d1", fileName: "x.bin" })),
      updateMetadata: vi.fn(async () => ({})),
    };
    const classify = vi.fn(async () => "AVTAL" as const);
    const handler = createClassifyDocumentHandler({ documents: documents as never, classify, model: "ollama:llama" });
    await handler(jobFor("d1"));
    expect(classify).toHaveBeenCalledWith({ fileName: "x.bin" });
    expect(documents.updateMetadata.mock.calls[0]![1]).toMatchObject({ documentType: "AVTAL", analysisModel: "ollama:llama" });
  });

  it("suggestTags (#621 B2) slår ihop förslag med befintliga taggar (union, ingen clobber)", async () => {
    const documents = {
      getById: vi.fn(async () => ({ id: "d1", fileName: "x.pdf", tags: ["Manuell", "Sekretess"] })),
      updateMetadata: vi.fn(async () => ({})),
    };
    const suggestTags = vi.fn(async () => ["Sekretess", "Brådskande"]);
    const handler = createClassifyDocumentHandler({ documents: documents as never, suggestTags });
    await handler(jobFor("d1"));
    // union(["Manuell","Sekretess"], ["Sekretess","Brådskande"]) → dedupat
    expect(documents.updateMetadata.mock.calls[0]![1]).toMatchObject({
      tags: ["Manuell", "Sekretess", "Brådskande"],
    });
  });

  it("suggestFromText (#988) körs EFTER metadata-skrivningen, med dokumentets fält", async () => {
    // Ordningen är poängen: en trasig textextraktion får inte kosta oss
    // klassificeringen. Jobbet är idempotent och körs om.
    const calls: string[] = [];
    const documents = {
      getById: vi.fn(async () => ({ id: "d1", fileName: "Stämning.pdf", storagePath: "documents/content/a.pdf", mimeType: "application/pdf" })),
      updateMetadata: vi.fn(async () => { calls.push("updateMetadata"); return {}; }),
    };
    const suggestFromText = vi.fn(async () => { calls.push("suggestFromText"); });
    const handler = createClassifyDocumentHandler({ documents: documents as never, suggestFromText });
    await handler(jobFor("d1"));

    expect(calls).toEqual(["updateMetadata", "suggestFromText"]);
    expect(suggestFromText).toHaveBeenCalledWith("d1", {
      fileName: "Stämning.pdf", storagePath: "documents/content/a.pdf", mimeType: "application/pdf",
    });
  });

  it("utan suggestFromText hoppas förslagssteget över (klient-tier:erna)", async () => {
    const documents = {
      getById: vi.fn(async () => ({ id: "d1", fileName: "x.pdf" })),
      updateMetadata: vi.fn(async () => ({})),
    };
    // Ska inte kasta trots att dep:en saknas — optional call, inte ett villkor.
    await createClassifyDocumentHandler({ documents: documents as never })(jobFor("d1"));
    expect(documents.updateMetadata).toHaveBeenCalled();
  });

  it("raderat dokument → varken metadata eller förslag skrivs", async () => {
    const suggestFromText = vi.fn(async () => {});
    const documents = { getById: vi.fn(async () => null), updateMetadata: vi.fn(async () => ({})) };
    await createClassifyDocumentHandler({ documents: documents as never, suggestFromText })(jobFor("borta"));
    expect(suggestFromText).not.toHaveBeenCalled();
  });

  it("utan suggestTags rörs `tags` inte (ingen tags-nyckel i patchen)", async () => {
    const documents = {
      getById: vi.fn(async () => ({ id: "d1", fileName: "x.pdf", tags: ["Manuell"] })),
      updateMetadata: vi.fn(async () => ({})),
    };
    const handler = createClassifyDocumentHandler({ documents: documents as never });
    await handler(jobFor("d1"));
    expect(documents.updateMetadata.mock.calls[0]![1]).not.toHaveProperty("tags");
  });
});
