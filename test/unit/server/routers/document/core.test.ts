/**
 * Test för document.core — list/tree/search/delete/analyze/updateMetadata.
 *
 * Kör mot en RIKTIG in-memory-store (LocalStore + repos, ADR 0020); portar
 * (meili/analys) är mockade. Asserterar på observerbart resultat.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { documentRouter } from "@/lib/server/routers/document";
import { prebakeJoins } from "@/lib/shared/demo-source";

vi.mock("@/lib/server/services/meilisearch", () => ({
  searchDocuments: vi.fn(),
  removeDocument: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/server/services/document-analysis", () => ({
  analyzeDocument: vi.fn().mockResolvedValue(undefined),
}));

const ORG = "org-a";

const mockPorts = {
  email: { send: vi.fn() },
  paymentScanner: { scan: vi.fn() },
  documentAnalyzer: { analyze: vi.fn().mockResolvedValue(undefined) },
  searchIndex: {
    search: vi.fn(),
    upsert: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
  },
};

function makeCaller(seed: Partial<DemoSource> = {}, orgId = ORG) {
  const source = prebakeJoins({
    matters: [{ id: "m1", organizationId: ORG, matterNumber: "2026-1", title: "T" }],
    documentFolders: [],
    documents: [],
    ...seed,
  } as DemoSource);
  const store = new LocalStore(source, async () => {});
  const repos = buildInMemoryRepositories(store as unknown as IDataStore);
  const ctx = {
    user: { id: "u1", email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    dataStore: store, repos, orgId, ports: mockPorts,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { caller: documentRouter.createCaller(ctx as any), store };
}

function docs(store: LocalStore): Array<Record<string, unknown>> {
  return (store as unknown as { source: DemoSource }).source.documents as never;
}

beforeEach(() => vi.clearAllMocks());

describe("document.list", () => {
  it("filtrerar på matterId och folderId", async () => {
    const { caller } = makeCaller({
      documents: [
        { id: "d1", matterId: "m1", folderId: "f1", fileName: "a.pdf" },
        { id: "d2", matterId: "m1", folderId: null, fileName: "b.pdf" },
      ],
    });
    const res = await caller.list({ matterId: "m1", folderId: "f1" });
    expect(res.documents.map((d) => d.id)).toEqual(["d1"]);
    expect(res.total).toBe(1);
  });

  it("default folderId = null (rot-nivå)", async () => {
    const { caller } = makeCaller({
      documents: [
        { id: "d1", matterId: "m1", folderId: "f1", fileName: "a.pdf" },
        { id: "d2", matterId: "m1", folderId: null, fileName: "b.pdf" },
      ],
    });
    const res = await caller.list({ matterId: "m1" });
    expect(res.documents.map((d) => d.id)).toEqual(["d2"]);
  });
});

describe("document.tree", () => {
  it("returnerar alla mappar + dokument exkl junk-filer", async () => {
    const { caller } = makeCaller({
      documentFolders: [{ id: "f1", name: "Mapp", matterId: "m1", parentId: null }],
      documents: [
        { id: "d1", matterId: "m1", folderId: null, fileName: "real.pdf" },
        { id: "d2", matterId: "m1", folderId: null, fileName: "._junk.pdf" }, // AppleDouble
        { id: "d3", matterId: "m1", folderId: null, fileName: ".DS_Store" },
      ],
    });
    const res = await caller.tree({ matterId: "m1" });
    expect(res.folders).toHaveLength(1);
    expect(res.documents).toHaveLength(1);
    expect(res.documents[0]!.fileName).toBe("real.pdf");
  });
});

describe("document.search", () => {
  it("anropar meilisearch och normaliserar svaret", async () => {
    mockPorts.searchIndex.search.mockResolvedValue({
      hits: [
        {
          id: "d1",
          fileName: "test.pdf",
          matterId: "m1",
          matterNumber: "0001",
          matterTitle: "X",
          _formatted: { content: "<em>highlighted</em>" },
        } as never,
      ],
      estimatedTotalHits: 1,
    } as never);

    const { caller } = makeCaller({}, "org-a");
    const res = await caller.search({ query: "test" });
    expect(mockPorts.searchIndex.search).toHaveBeenCalledWith("test", "org-a", 20, { documentTypes: undefined });
    expect(res.totalHits).toBe(1);
    expect(res.hits[0]!.documentId).toBe("d1");
    expect(res.hits[0]!.highlight).toContain("highlighted");
  });

  it("returnerar tom highlight när _formatted saknas", async () => {
    mockPorts.searchIndex.search.mockResolvedValue({
      hits: [
        {
          id: "d1",
          fileName: "x.pdf",
          matterId: "m1",
          matterNumber: "0001",
          matterTitle: "X",
        } as never,
      ],
      estimatedTotalHits: 1,
    } as never);

    const { caller } = makeCaller();
    const res = await caller.search({ query: "x" });
    expect(res.hits[0]!.highlight).toBe("");
  });

  it("kräver query min(1)", async () => {
    const { caller } = makeCaller();
    await expect(caller.search({ query: "" })).rejects.toThrow();
  });
});

describe("document.delete", () => {
  it("vägrar radera när dokument ej tillhör org", async () => {
    const { caller, store } = makeCaller({
      documents: [{ id: "d1", matterId: "m1", folderId: null, fileName: "a.pdf" }],
    }, "org-other");
    await expect(caller.delete({ id: "d1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(docs(store).some((d) => d.id === "d1")).toBe(true);
    expect(mockPorts.searchIndex.remove).not.toHaveBeenCalled();
  });

  it("raderar och triggar Meili-cleanup när tillgång OK", async () => {
    const { caller, store } = makeCaller({
      documents: [{ id: "d1", matterId: "m1", folderId: null, fileName: "a.pdf" }],
    });
    await caller.delete({ id: "d1" });
    expect(docs(store).some((d) => d.id === "d1")).toBe(false);
    expect(mockPorts.searchIndex.remove).toHaveBeenCalledWith("d1");
  });
});

describe("document.analyze", () => {
  it("vägrar när dokument tillhör annan org", async () => {
    const { caller } = makeCaller({
      documents: [{ id: "d1", matterId: "m1", folderId: null, fileName: "a.pdf" }],
    }, "org-other");
    await expect(caller.analyze({ documentId: "d1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPorts.documentAnalyzer.analyze).not.toHaveBeenCalled();
  });

  it("triggar fire-and-forget analys när tillgång OK", async () => {
    const { caller } = makeCaller({
      documents: [{ id: "d1", matterId: "m1", folderId: null, fileName: "a.pdf" }],
    });
    mockPorts.documentAnalyzer.analyze.mockResolvedValue(undefined);
    const res = await caller.analyze({ documentId: "d1" });
    expect(res).toEqual({ ok: true });
    expect(mockPorts.documentAnalyzer.analyze).toHaveBeenCalledWith("d1");
  });

  it("sväljer ett analys-fel (fire-and-forget .catch) utan att kasta", async () => {
    const { caller } = makeCaller({
      documents: [{ id: "d1", matterId: "m1", folderId: null, fileName: "a.pdf" }],
    });
    mockPorts.documentAnalyzer.analyze.mockRejectedValue(new Error("analys-krasch"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await caller.analyze({ documentId: "d1" });
    expect(res).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 0)); // låt .catch:en köra
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("document.listDocumentTypes", () => {
  it("räknar unika documentType:er, hoppar null, sorterar på sv", async () => {
    const { caller } = makeCaller({
      documents: [
        { id: "d1", matterId: "m1", documentType: "Faktura", fileName: "1" },
        { id: "d2", matterId: "m1", documentType: "Avtal", fileName: "2" },
        { id: "d3", matterId: "m1", documentType: "Avtal", fileName: "3" },
        { id: "d4", matterId: "m1", documentType: null, fileName: "4" },
        { id: "d5", matterId: "m1", documentType: "Ärende", fileName: "5" },
      ],
    });
    const res = await caller.listDocumentTypes();
    expect(res).toEqual([
      { type: "Avtal", count: 2 },
      { type: "Faktura", count: 1 },
      { type: "Ärende", count: 1 },
    ]);
  });

  it("tom lista när inga dokument", async () => {
    const { caller } = makeCaller();
    expect(await caller.listDocumentTypes()).toEqual([]);
  });
});

describe("document.markExternallyEdited", () => {
  it("bumpar version + updatedAt + sizeBytes efter access-check", async () => {
    const { caller, store } = makeCaller({
      documents: [{ id: "d1", matterId: "m1", version: 2, sizeBytes: 10, fileName: "a.pdf" }],
    });
    await caller.markExternallyEdited({
      id: "d1", saves: 2, sessionStartedAt: "2026-06-16T08:00:00Z", sizeBytes: 4096,
    });
    const doc = docs(store).find((d) => d.id === "d1")!;
    expect(doc.version).toBe(3);
    expect(doc.updatedAt).toBeInstanceOf(Date);
    expect(doc.sizeBytes).toBe(4096);
    expect(doc.fileSize).toBe(4096);
  });

  it("defaultar version till 1→2 när raden saknar version", async () => {
    const { caller, store } = makeCaller({
      documents: [{ id: "d1", matterId: "m1", sizeBytes: 10, fileName: "a.pdf" }],
    });
    await caller.markExternallyEdited({ id: "d1", saves: 1, sessionStartedAt: new Date() });
    const doc = docs(store).find((d) => d.id === "d1")!;
    expect(doc.version).toBe(2);
    expect(doc.sizeBytes).toBe(10); // utelämnad → oförändrad
  });

  it("vägrar mot dokument i annan org", async () => {
    const { caller, store } = makeCaller({
      documents: [{ id: "d1", matterId: "m1", version: 1, fileName: "a.pdf" }],
    }, "org-b");
    await expect(
      caller.markExternallyEdited({ id: "d1", saves: 1, sessionStartedAt: new Date() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(docs(store).find((d) => d.id === "d1")!.version).toBe(1);
  });
});

describe("document.updateMetadata", () => {
  it("uppdaterar bara skickade fält efter access-check", async () => {
    const { caller, store } = makeCaller({
      documents: [{ id: "d1", matterId: "m1", title: "Gammal", documentType: "Avtal", fileName: "a.pdf" }],
    });
    await caller.updateMetadata({ documentId: "d1", title: "Manuell titel" });
    const doc = docs(store).find((d) => d.id === "d1")!;
    expect(doc.title).toBe("Manuell titel");
    expect(doc.documentType).toBe("Avtal"); // oförändrad
  });

  it("vägrar uppdatera dokument från annan org", async () => {
    const { caller } = makeCaller({
      documents: [{ id: "d1", matterId: "m1", fileName: "a.pdf" }],
    }, "org-other");
    await expect(
      caller.updateMetadata({ documentId: "d1", title: "Y" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
