/**
 * `classify-document` + dokumentdelar (#1220): segmentering → delar skrivs,
 * documentType = första delens typ, MANUAL bevaras vid samma sidantal,
 * specialvärden rörs inte, LLM-tak, idempotens.
 */

import type { Job } from "pg-boss";
import { describe, expect, it, vi } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { createClassifyDocumentHandler } from "@/lib/server/jobs/handlers/classify-document-handler";
import { manualKindOf } from "@/lib/server/jobs/handlers/document-parts-writer";
import { JOB_QUEUES } from "@/lib/server/jobs/job-queue";
import { InMemoryDocumentPartRepository } from "@/lib/server/repositories/in-memory-document-part-repository";
import { type DocumentKind, isSpecialDocumentType } from "@/lib/shared/document-kind";
import type { DocumentPart } from "@/lib/shared/schemas/document";
import { asId } from "@/lib/shared/schemas/ids";

const DOC = asId<"DocumentId">("11111111-1111-7111-8111-111111111111");
const MATTER = asId<"MatterId">("22222222-2222-7222-8222-222222222222");

function jobFor(documentId: string): Job {
  return {
    id: "job-1", name: JOB_QUEUES.classifyDocument, data: { documentId },
    expireInSeconds: 60, heartbeatSeconds: null, signal: AbortSignal.abort(),
  };
}

const text = (head: string) => `${head}\nBrödtext som fortsätter en bit.\nMer text här.`;
const COMPOSITE = [text("KALLELSE"), text("forts."), text("STÄMNINGSANSÖKAN"), text("FÖRUNDERSÖKNINGSPROTOKOLL"), text("1 (2)")];

function setup(doc: Record<string, unknown> = {}, pages: string[] = COMPOSITE, seedParts: Record<string, unknown>[] = []) {
  const store = new LocalStore({ documentParts: seedParts }, async () => {});
  const parts = new InMemoryDocumentPartRepository(store);
  const documents = {
    getById: vi.fn(async () => ({
      id: DOC, matterId: MATTER, fileName: "inkommet.pdf", storagePath: "documents/content/x.pdf", mimeType: "application/pdf", ...doc,
    })),
    updateMetadata: vi.fn(async () => ({})),
  };
  const readPages = vi.fn(async () => pages);
  return { parts, documents, readPages };
}

function run(s: ReturnType<typeof setup>, extra: Record<string, unknown> = {}) {
  return createClassifyDocumentHandler({ documents: s.documents as never, parts: s.parts, readPages: s.readPages, ...extra })(jobFor(DOC));
}

const simple = (ps: DocumentPart[]) => ps.map((p) => ({ kind: p.kind, fromPage: p.fromPage, toPage: p.toPage, source: p.source, ordinal: p.ordinal }));

describe("classify-document — dokumentdelar", () => {
  it("skriver delar och sätter documentType = första delens typ", async () => {
    const s = setup();
    await run(s);
    expect(simple(await s.parts.listForDocument(DOC))).toEqual([
      { kind: "KALLELSE", fromPage: 1, toPage: 2, source: "AUTO", ordinal: 0 },
      { kind: "STAMNING", fromPage: 3, toPage: 3, source: "AUTO", ordinal: 1 },
      { kind: "FUP", fromPage: 4, toPage: 5, source: "AUTO", ordinal: 2 },
    ]);
    expect(s.documents.updateMetadata.mock.calls[0]![1]).toMatchObject({ documentType: "KALLELSE", analysisStatus: "DONE" });
  });

  it("omkörning med samma resultat skriver ingenting (ingen churn)", async () => {
    const s = setup();
    await run(s);
    const create = vi.spyOn(s.parts, "create");
    const softDelete = vi.spyOn(s.parts, "softDelete");
    await run(s);
    expect(create).not.toHaveBeenCalled();
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("MANUAL-del bevaras vid oförändrat sidantal; AUTO ersätts runt den", async () => {
    const s = setup();
    await run(s);
    const stamning = (await s.parts.listForDocument(DOC)).find((p) => p.kind === "STAMNING")!;
    await s.parts.update(stamning.id, { kind: "INLAGA", source: "MANUAL" });
    await run(s);
    expect(simple(await s.parts.listForDocument(DOC))).toEqual([
      { kind: "KALLELSE", fromPage: 1, toPage: 2, source: "AUTO", ordinal: 0 },
      { kind: "INLAGA", fromPage: 3, toPage: 3, source: "MANUAL", ordinal: 1 },
      { kind: "FUP", fromPage: 4, toPage: 5, source: "AUTO", ordinal: 2 },
    ]);
  });

  it("manuell första del styr documentType", async () => {
    const s = setup();
    await run(s);
    const first = (await s.parts.listForDocument(DOC))[0]!;
    await s.parts.update(first.id, { kind: "DOM", source: "MANUAL" });
    await run(s);
    expect(s.documents.updateMetadata.mock.calls[1]![1]).toMatchObject({ documentType: "DOM" });
  });

  it("ändrat sidantal → allt räknas om och MANUAL släpps", async () => {
    const s = setup();
    await run(s);
    const first = (await s.parts.listForDocument(DOC))[0]!;
    await s.parts.update(first.id, { kind: "DOM", source: "MANUAL" });
    s.readPages.mockResolvedValue([text("Delgivningskvitto"), text("DOM")]);
    await run(s);
    expect(simple(await s.parts.listForDocument(DOC))).toEqual([
      { kind: "DELGIVNINGSKVITTO", fromPage: 1, toPage: 1, source: "AUTO", ordinal: 0 },
      { kind: "DOM", fromPage: 2, toPage: 2, source: "AUTO", ordinal: 1 },
    ]);
  });

  it("MANUAL-del flyttas i ordning (ordinal uppdateras) när AUTO-delarna ändras", async () => {
    const s = setup({}, [text("DOM"), text("forts."), text("KALLELSE")]);
    await run(s);
    const kallelse = (await s.parts.listForDocument(DOC)).find((p) => p.kind === "KALLELSE")!;
    expect(kallelse.ordinal).toBe(1);
    await s.parts.update(kallelse.id, { source: "MANUAL" });
    // Samma sidantal, men nu två AUTO-delar före den manuella → ordinal 2.
    s.readPages.mockResolvedValue([text("Delgivningskvitto"), text("DOM"), text("forts.")]);
    await run(s);
    expect(simple(await s.parts.listForDocument(DOC))).toEqual([
      { kind: "DELGIVNINGSKVITTO", fromPage: 1, toPage: 1, source: "AUTO", ordinal: 0 },
      { kind: "DOM", fromPage: 2, toPage: 2, source: "AUTO", ordinal: 1 },
      { kind: "KALLELSE", fromPage: 3, toPage: 3, source: "MANUAL", ordinal: 2 },
    ]);
  });

  it("specialvärde (Kostnadsräkning) skrivs inte över och får inga delar", async () => {
    const s = setup({ documentType: "Kostnadsräkning" });
    await run(s);
    expect(await s.parts.listForDocument(DOC)).toEqual([]);
    expect(s.documents.updateMetadata.mock.calls[0]![1]).not.toHaveProperty("documentType");
  });

  it("användarsatt kategori (före delarna) blir EN manuell del och behålls", async () => {
    const s = setup({ documentType: "AVTAL", analysisModel: null });
    await run(s);
    expect(simple(await s.parts.listForDocument(DOC))).toEqual([
      { kind: "AVTAL", fromPage: 1, toPage: 5, source: "MANUAL", ordinal: 0 },
    ]);
    expect(s.documents.updateMetadata.mock.calls[0]![1]).toMatchObject({ documentType: "AVTAL" });
  });

  it("utan sidor (ingen text server-side) → inga delar, filnamns-heuristik", async () => {
    const s = setup({ fileName: "Stämning.pdf" }, []);
    await run(s);
    expect(await s.parts.listForDocument(DOC)).toEqual([]);
    expect(s.documents.updateMetadata.mock.calls[0]![1]).toMatchObject({ documentType: "STAMNING" });
  });

  it("utan sidor behålls en användarsatt kategori", async () => {
    const s = setup({ documentType: "AVTAL", analysisModel: null }, []);
    await run(s);
    expect(s.documents.updateMetadata.mock.calls[0]![1]).toMatchObject({ documentType: "AVTAL" });
  });

  it("utan parts-repo: segmenteringen ger ändå kategorin (inga delar skrivs)", async () => {
    const s = setup();
    await createClassifyDocumentHandler({ documents: s.documents as never, readPages: s.readPages })(jobFor(DOC));
    expect(s.documents.updateMetadata.mock.calls[0]![1]).toMatchObject({ documentType: "KALLELSE" });
  });

  it("classifyPart (LLM) anropas bara på kandidatsidor utan rubrik, inom taket", async () => {
    const pages = Array.from({ length: 40 }, () => text("1 (1)"));
    const s = setup({}, pages);
    const classifyPart = vi.fn(async (): Promise<DocumentKind | null> => "BEVIS");
    await run(s, { classifyPart, maxLlmCalls: 3 });
    expect(classifyPart).toHaveBeenCalledTimes(3);
    expect(simple(await s.parts.listForDocument(DOC))).toEqual([
      { kind: "BEVIS", fromPage: 1, toPage: 40, source: "AUTO", ordinal: 0 },
    ]);
  });
});

describe("document-parts-writer — regler", () => {
  it("isSpecialDocumentType", () => {
    expect(isSpecialDocumentType("E-post")).toBe(true);
    expect(isSpecialDocumentType("DOM")).toBe(false);
    expect(isSpecialDocumentType(null)).toBe(false);
  });

  it("manualKindOf: bara kod, aldrig server-analyserad och ≠ filnamnsgissningen", () => {
    const base = { id: DOC, matterId: MATTER, fileName: "x.pdf" };
    expect(manualKindOf({ ...base, documentType: "AVTAL" })).toBe("AVTAL");
    expect(manualKindOf({ ...base, documentType: "AVTAL", analysisModel: "ollama:q" })).toBeNull();
    expect(manualKindOf({ ...base, fileName: "hyresavtal.pdf", documentType: "AVTAL" })).toBeNull();
    expect(manualKindOf({ ...base, documentType: "Kostnadsräkning" })).toBeNull();
  });
});
