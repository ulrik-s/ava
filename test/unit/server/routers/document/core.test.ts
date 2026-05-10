/**
 * Test för document.core — list/tree/search/delete/analyze/updateMetadata.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/services/meilisearch", () => ({
  searchDocuments: vi.fn(),
  removeDocument: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/services/document-analysis", () => ({
  analyzeDocument: vi.fn().mockResolvedValue(undefined),
}));

import { documentRouter } from "@/server/routers/document";
import * as meili from "@/server/services/meilisearch";
import * as analysis from "@/server/services/document-analysis";

const mockPrisma = {
  document: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
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

function makeCaller(orgId = "org-a") {
  const ctx = {
    user: { id: "u1", email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma,
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
    expect(res.documents[0].fileName).toBe("real.pdf");
  });
});

describe("document.search", () => {
  it("anropar meilisearch och normaliserar svaret", async () => {
    vi.mocked(meili.searchDocuments).mockResolvedValue({
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
    expect(meili.searchDocuments).toHaveBeenCalledWith("test", "org-a", 20);
    expect(res.totalHits).toBe(1);
    expect(res.hits[0].documentId).toBe("d1");
    expect(res.hits[0].highlight).toContain("highlighted");
  });

  it("returnerar tom highlight när _formatted saknas", async () => {
    vi.mocked(meili.searchDocuments).mockResolvedValue({
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
    expect(res.hits[0].highlight).toBe("");
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
    expect(meili.removeDocument).toHaveBeenCalledWith("d1");
  });
});

describe("document.analyze", () => {
  it("vägrar när dokument tillhör annan org", async () => {
    mockPrisma.document.findFirst.mockResolvedValue(null);
    await expect(
      makeCaller().analyze({ documentId: "d1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(analysis.analyzeDocument).not.toHaveBeenCalled();
  });

  it("triggar fire-and-forget analys när tillgång OK", async () => {
    mockPrisma.document.findFirst.mockResolvedValue({ id: "d1", matterId: "m1" });
    vi.mocked(analysis.analyzeDocument).mockResolvedValue();

    const res = await makeCaller().analyze({ documentId: "d1" });
    expect(res).toEqual({ ok: true });
    expect(analysis.analyzeDocument).toHaveBeenCalledWith("d1");
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
