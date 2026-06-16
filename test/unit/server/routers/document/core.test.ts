/**
 * Test för document.core — list/tree/search/delete/analyze/updateMetadata.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { documentRouter } from "@/lib/server/routers/document";
import { dataStoreFromMockPrisma } from "../../helpers/mock-data-store";


vi.mock("@/lib/server/services/meilisearch", () => ({
  searchDocuments: vi.fn(),
  removeDocument: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/server/services/document-analysis", () => ({
  analyzeDocument: vi.fn().mockResolvedValue(undefined),
}));

const mockPrisma = {
  document: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    count: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
  documentFolder: {
    findMany: vi.fn(),
  },
  matter: {
    findFirst: vi.fn(),
  },
};

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

function makeCaller(orgId = "org-a") {
  const ctx = {
    user: { id: "u1", email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma,
    dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
    ports: mockPorts,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return documentRouter.createCaller(ctx as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.document.findMany.mockResolvedValue([]);
  mockPrisma.documentFolder.findMany.mockResolvedValue([]);
  mockPrisma.document.count.mockResolvedValue(0);
});

describe("document.list", () => {
  it("filtrerar på matterId och folderId", async () => {
    await makeCaller().list({ matterId: "m1", folderId: "f1" });
    expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matterId: "m1", folderId: "f1" },
      }),
    );
  });

  it("default folderId = null (rot-nivå)", async () => {
    await makeCaller().list({ matterId: "m1" });
    expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matterId: "m1", folderId: null },
      }),
    );
  });
});

describe("document.tree", () => {
  it("returnerar alla mappar + dokument exkl junk-filer", async () => {
    mockPrisma.document.findMany.mockResolvedValue([
      { id: "d1", fileName: "real.pdf" },
      { id: "d2", fileName: "._junk.pdf" }, // AppleDouble
      { id: "d3", fileName: ".DS_Store" },
    ]);
    mockPrisma.documentFolder.findMany.mockResolvedValue([{ id: "f1" }]);

    const res = await makeCaller().tree({ matterId: "m1" });
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

    const res = await makeCaller("org-a").search({ query: "test" });
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

    const res = await makeCaller().search({ query: "x" });
    expect(res.hits[0]!.highlight).toBe("");
  });

  it("kräver query min(1)", async () => {
    await expect(makeCaller().search({ query: "" })).rejects.toThrow();
  });
});

describe("document.delete", () => {
  it("vägrar radera när dokument ej tillhör org", async () => {
    mockPrisma.document.findFirst.mockResolvedValue(null);
    await expect(makeCaller().delete({ id: "d1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockPrisma.document.delete).not.toHaveBeenCalled();
  });

  it("raderar och triggar Meili-cleanup när tillgång OK", async () => {
    mockPrisma.document.findFirst.mockResolvedValue({ id: "d1", matterId: "m1" });
    mockPrisma.document.delete.mockResolvedValue({ id: "d1" });

    await makeCaller().delete({ id: "d1" });
    expect(mockPrisma.document.delete).toHaveBeenCalledWith({ where: { id: "d1" } });
    expect(mockPorts.searchIndex.remove).toHaveBeenCalledWith("d1");
  });
});

describe("document.analyze", () => {
  it("vägrar när dokument tillhör annan org", async () => {
    mockPrisma.document.findFirst.mockResolvedValue(null);
    await expect(
      makeCaller().analyze({ documentId: "d1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPorts.documentAnalyzer.analyze).not.toHaveBeenCalled();
  });

  it("triggar fire-and-forget analys när tillgång OK", async () => {
    mockPrisma.document.findFirst.mockResolvedValue({ id: "d1", matterId: "m1" });
    mockPorts.documentAnalyzer.analyze.mockResolvedValue(undefined);

    const res = await makeCaller().analyze({ documentId: "d1" });
    expect(res).toEqual({ ok: true });
    expect(mockPorts.documentAnalyzer.analyze).toHaveBeenCalledWith("d1");
  });

  it("sväljer ett analys-fel (fire-and-forget .catch) utan att kasta", async () => {
    mockPrisma.document.findFirst.mockResolvedValue({ id: "d1", matterId: "m1" });
    mockPorts.documentAnalyzer.analyze.mockRejectedValue(new Error("analys-krasch"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await makeCaller().analyze({ documentId: "d1" });
    expect(res).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 0)); // låt .catch:en köra
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("document.listDocumentTypes", () => {
  it("räknar unika documentType:er, hoppar null, sorterar på sv", async () => {
    mockPrisma.document.findMany.mockResolvedValue([
      { documentType: "Faktura" },
      { documentType: "Avtal" },
      { documentType: "Avtal" },
      { documentType: null },
      { documentType: "Ärende" },
    ]);
    const res = await makeCaller().listDocumentTypes();
    expect(res).toEqual([
      { type: "Avtal", count: 2 },
      { type: "Faktura", count: 1 },
      { type: "Ärende", count: 1 },
    ]);
  });

  it("tom lista när inga dokument", async () => {
    mockPrisma.document.findMany.mockResolvedValue([]);
    expect(await makeCaller().listDocumentTypes()).toEqual([]);
  });
});

describe("document.markExternallyEdited", () => {
  it("bumpar version + updatedAt + sizeBytes efter access-check", async () => {
    mockPrisma.document.findFirst.mockResolvedValue({ id: "d1", matterId: "m1" });
    mockPrisma.document.findUniqueOrThrow.mockResolvedValue({ id: "d1", version: 2 });
    mockPrisma.document.update.mockResolvedValue({ id: "d1", version: 3 });

    await makeCaller().markExternallyEdited({
      id: "d1", saves: 2, sessionStartedAt: "2026-06-16T08:00:00Z", sizeBytes: 4096,
    });

    const arg = mockPrisma.document.update.mock.calls[0]![0] as { where: unknown; data: Record<string, unknown> };
    expect(arg.where).toEqual({ id: "d1" });
    expect(arg.data.version).toBe(3);
    expect(arg.data.updatedAt).toBeInstanceOf(Date);
    expect(arg.data.sizeBytes).toBe(4096);
    expect(arg.data.fileSize).toBe(4096);
  });

  it("defaultar version till 1→2 när raden saknar version", async () => {
    mockPrisma.document.findFirst.mockResolvedValue({ id: "d1", matterId: "m1" });
    mockPrisma.document.findUniqueOrThrow.mockResolvedValue({ id: "d1" });
    mockPrisma.document.update.mockResolvedValue({ id: "d1" });

    await makeCaller().markExternallyEdited({ id: "d1", saves: 1, sessionStartedAt: new Date() });
    const arg = mockPrisma.document.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.version).toBe(2);
    expect(arg.data.sizeBytes).toBeUndefined(); // utelämnad → ej satt
  });

  it("vägrar mot dokument i annan org", async () => {
    mockPrisma.document.findFirst.mockResolvedValue(null);
    await expect(
      makeCaller("org-b").markExternallyEdited({ id: "d1", saves: 1, sessionStartedAt: new Date() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.document.update).not.toHaveBeenCalled();
  });
});

describe("document.updateMetadata", () => {
  it("uppdaterar bara skickade fält efter access-check", async () => {
    mockPrisma.document.findFirst.mockResolvedValue({ id: "d1", matterId: "m1" });
    mockPrisma.document.update.mockResolvedValue({ id: "d1" });

    await makeCaller().updateMetadata({
      documentId: "d1",
      title: "Manuell titel",
    });
    expect(mockPrisma.document.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { title: "Manuell titel" },
    });
  });

  it("vägrar uppdatera dokument från annan org", async () => {
    mockPrisma.document.findFirst.mockResolvedValue(null);
    await expect(
      makeCaller().updateMetadata({ documentId: "x", title: "Y" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
