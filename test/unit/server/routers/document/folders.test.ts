/**
 * Test för document folders — createFolder/renameFolder/deleteFolder/
 * moveDocument/moveFolder/breadcrumb. Inkluderar cykel-detektering.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/services/meilisearch", () => ({
  searchDocuments: vi.fn(),
  removeDocument: vi.fn(),
}));
vi.mock("@/server/services/document-analysis", () => ({
  analyzeDocument: vi.fn(),
}));

import { documentRouter } from "@/server/routers/document";

const mockPrisma = {
  documentFolder: {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findFirst: vi.fn(),
  },
  document: {
    update: vi.fn(),
    updateMany: vi.fn(),
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

beforeEach(() => vi.clearAllMocks());

describe("document.createFolder", () => {
  it("skapar mapp efter access-check på matter", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: "m1" });
    mockPrisma.documentFolder.create.mockResolvedValue({ id: "f1" });

    await makeCaller().createFolder({ matterId: "m1", name: "Inlagor" });
    expect(mockPrisma.documentFolder.create).toHaveBeenCalledWith({
      data: { name: "Inlagor", matterId: "m1", parentId: null },
    });
  });

  it("vägrar skapa mapp i ärende från annan org", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);
    await expect(
      makeCaller().createFolder({ matterId: "x", name: "Inlagor" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.documentFolder.create).not.toHaveBeenCalled();
  });
});

describe("document.renameFolder", () => {
  it("uppdaterar namnet", async () => {
    mockPrisma.documentFolder.update.mockResolvedValue({});
    await makeCaller().renameFolder({ id: "f1", name: "Nytt" });
    expect(mockPrisma.documentFolder.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { name: "Nytt" },
    });
  });
});

describe("document.deleteFolder", () => {
  it("flyttar barn till parent och raderar mappen", async () => {
    mockPrisma.documentFolder.findUniqueOrThrow.mockResolvedValue({
      id: "f1",
      parentId: "f-parent",
    });
    mockPrisma.document.updateMany.mockResolvedValue({});
    mockPrisma.documentFolder.updateMany.mockResolvedValue({});
    mockPrisma.documentFolder.delete.mockResolvedValue({});

    await makeCaller().deleteFolder({ id: "f1" });
    expect(mockPrisma.document.updateMany).toHaveBeenCalledWith({
      where: { folderId: "f1" },
      data: { folderId: "f-parent" },
    });
    expect(mockPrisma.documentFolder.updateMany).toHaveBeenCalledWith({
      where: { parentId: "f1" },
      data: { parentId: "f-parent" },
    });
    expect(mockPrisma.documentFolder.delete).toHaveBeenCalled();
  });

  it("flyttar till null när rotmapp raderas", async () => {
    mockPrisma.documentFolder.findUniqueOrThrow.mockResolvedValue({
      id: "f1",
      parentId: null,
    });
    mockPrisma.document.updateMany.mockResolvedValue({});
    mockPrisma.documentFolder.updateMany.mockResolvedValue({});
    mockPrisma.documentFolder.delete.mockResolvedValue({});

    await makeCaller().deleteFolder({ id: "f1" });
    expect(mockPrisma.document.updateMany).toHaveBeenCalledWith({
      where: { folderId: "f1" },
      data: { folderId: null },
    });
  });
});

describe("document.moveDocument", () => {
  it("flyttar dokumentet", async () => {
    mockPrisma.document.update.mockResolvedValue({});
    await makeCaller().moveDocument({ documentId: "d1", folderId: "f2" });
    expect(mockPrisma.document.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { folderId: "f2" },
    });
  });

  it("flyttar till rot (folderId=null)", async () => {
    mockPrisma.document.update.mockResolvedValue({});
    await makeCaller().moveDocument({ documentId: "d1", folderId: null });
    expect(mockPrisma.document.update.mock.calls[0][0].data.folderId).toBeNull();
  });
});

describe("document.moveFolder", () => {
  it("blockerar flytt in i sig själv", async () => {
    mockPrisma.documentFolder.findUnique.mockResolvedValue({ parentId: null });
    await expect(
      makeCaller().moveFolder({ folderId: "f1", targetParentId: "f1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockPrisma.documentFolder.update).not.toHaveBeenCalled();
  });

  it("blockerar flytt in i descendant", async () => {
    // f1 → f2 → f3. Försök flytta f1 in i f3.
    mockPrisma.documentFolder.findUnique
      .mockResolvedValueOnce({ parentId: "f2" })
      .mockResolvedValueOnce({ parentId: "f1" });

    await expect(
      makeCaller().moveFolder({ folderId: "f1", targetParentId: "f3" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("tillåter flytt till annan gren", async () => {
    // target har null som parent (root)
    mockPrisma.documentFolder.findUnique.mockResolvedValue({ parentId: null });
    mockPrisma.documentFolder.update.mockResolvedValue({});

    await makeCaller().moveFolder({ folderId: "f1", targetParentId: "f-other" });
    expect(mockPrisma.documentFolder.update).toHaveBeenCalled();
  });

  it("tillåter flytt till rot (targetParentId=null)", async () => {
    mockPrisma.documentFolder.update.mockResolvedValue({});
    await makeCaller().moveFolder({ folderId: "f1", targetParentId: null });
    expect(mockPrisma.documentFolder.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { parentId: null },
    });
  });
});

describe("document.breadcrumb", () => {
  it("bygger sökväg från rot till vald mapp", async () => {
    // f3 → f2 → f1 → null
    mockPrisma.documentFolder.findUnique
      .mockResolvedValueOnce({ id: "f3", name: "Beslut", parentId: "f2" })
      .mockResolvedValueOnce({ id: "f2", name: "2024", parentId: "f1" })
      .mockResolvedValueOnce({ id: "f1", name: "Inlagor", parentId: null });

    const path = await makeCaller().breadcrumb({ folderId: "f3" });
    expect(path).toEqual([
      { id: "f1", name: "Inlagor" },
      { id: "f2", name: "2024" },
      { id: "f3", name: "Beslut" },
    ]);
  });

  it("returnerar tom array när mapp ej finns", async () => {
    mockPrisma.documentFolder.findUnique.mockResolvedValue(null);
    const path = await makeCaller().breadcrumb({ folderId: "x" });
    expect(path).toEqual([]);
  });
});
