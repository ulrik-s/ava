/**
 * Test för document folders — createFolder/renameFolder/deleteFolder/
 * moveDocument/moveFolder/breadcrumb. Inkluderar cykel-detektering.
 *
 * Kör mot en RIKTIG in-memory-store (LocalStore + repos, ADR 0020) och
 * asserterar på observerbart resultat i st.f. Prisma-formade mock-anrop.
 */

import { describe, it, expect, vi } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { documentRouter } from "@/lib/server/routers/document";
import { prebakeJoins } from "@/lib/shared/demo-source";

vi.mock("@/lib/server/services/meilisearch", () => ({
  searchDocuments: vi.fn(),
  removeDocument: vi.fn(),
}));
vi.mock("@/lib/server/services/document-analysis", () => ({
  analyzeDocument: vi.fn(),
}));

const ORG = "org-a";

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
    dataStore: store, repos, orgId,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { caller: documentRouter.createCaller(ctx as any), store };
}

/** Läs ut mapparna direkt ur store:n (utan att gå via routern). */
function folders(store: LocalStore): Array<{ id: string; name: string; parentId: string | null }> {
  return (store as unknown as { source: DemoSource }).source.documentFolders as never;
}
function docs(store: LocalStore): Array<{ id: string; folderId: string | null }> {
  return (store as unknown as { source: DemoSource }).source.documents as never;
}

describe("document.createFolder", () => {
  it("skapar mapp efter access-check på matter", async () => {
    const { caller, store } = makeCaller();
    const created = await caller.createFolder({ matterId: "m1", name: "Inlagor" });
    expect(created.name).toBe("Inlagor");
    expect(folders(store).some((f) => f.name === "Inlagor" && f.parentId === null)).toBe(true);
  });

  it("vägrar skapa mapp i ärende från annan org", async () => {
    const { caller, store } = makeCaller({}, "org-other");
    await expect(
      caller.createFolder({ matterId: "m1", name: "Inlagor" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(folders(store)).toHaveLength(0);
  });
});

describe("document.renameFolder", () => {
  it("uppdaterar namnet", async () => {
    const { caller, store } = makeCaller({
      documentFolders: [{ id: "f1", name: "Gammalt", matterId: "m1", parentId: null }],
    });
    await caller.renameFolder({ id: "f1", name: "Nytt" });
    expect(folders(store).find((f) => f.id === "f1")!.name).toBe("Nytt");
  });
});

describe("document.deleteFolder", () => {
  it("flyttar barn till parent och raderar mappen", async () => {
    const { caller, store } = makeCaller({
      documentFolders: [
        { id: "f1", name: "Mapp", matterId: "m1", parentId: "f-parent" },
        { id: "f-child", name: "Barn", matterId: "m1", parentId: "f1" },
      ],
      documents: [{ id: "d1", matterId: "m1", folderId: "f1", fileName: "a.pdf" }],
    });
    await caller.deleteFolder({ id: "f1" });
    expect(folders(store).some((f) => f.id === "f1")).toBe(false);
    expect(docs(store).find((d) => d.id === "d1")!.folderId).toBe("f-parent");
    expect(folders(store).find((f) => f.id === "f-child")!.parentId).toBe("f-parent");
  });

  it("flyttar till null när rotmapp raderas", async () => {
    const { caller, store } = makeCaller({
      documentFolders: [{ id: "f1", name: "Rot", matterId: "m1", parentId: null }],
      documents: [{ id: "d1", matterId: "m1", folderId: "f1", fileName: "a.pdf" }],
    });
    await caller.deleteFolder({ id: "f1" });
    expect(docs(store).find((d) => d.id === "d1")!.folderId).toBeNull();
  });
});

describe("document.moveDocument", () => {
  it("flyttar dokumentet", async () => {
    const { caller, store } = makeCaller({
      documentFolders: [{ id: "f2", name: "Mål", matterId: "m1", parentId: null }],
      documents: [{ id: "d1", matterId: "m1", folderId: null, fileName: "a.pdf" }],
    });
    await caller.moveDocument({ documentId: "d1", folderId: "f2" });
    expect(docs(store).find((d) => d.id === "d1")!.folderId).toBe("f2");
  });

  it("flyttar till rot (folderId=null)", async () => {
    const { caller, store } = makeCaller({
      documentFolders: [{ id: "f2", name: "Mål", matterId: "m1", parentId: null }],
      documents: [{ id: "d1", matterId: "m1", folderId: "f2", fileName: "a.pdf" }],
    });
    await caller.moveDocument({ documentId: "d1", folderId: null });
    expect(docs(store).find((d) => d.id === "d1")!.folderId).toBeNull();
  });
});

describe("document.moveFolder", () => {
  it("blockerar flytt in i sig själv", async () => {
    const { caller, store } = makeCaller({
      documentFolders: [{ id: "f1", name: "F1", matterId: "m1", parentId: null }],
    });
    await expect(
      caller.moveFolder({ folderId: "f1", targetParentId: "f1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(folders(store).find((f) => f.id === "f1")!.parentId).toBeNull();
  });

  it("blockerar flytt in i descendant", async () => {
    // f1 → f2 → f3. Försök flytta f1 in i f3.
    const { caller } = makeCaller({
      documentFolders: [
        { id: "f1", name: "F1", matterId: "m1", parentId: null },
        { id: "f2", name: "F2", matterId: "m1", parentId: "f1" },
        { id: "f3", name: "F3", matterId: "m1", parentId: "f2" },
      ],
    });
    await expect(
      caller.moveFolder({ folderId: "f1", targetParentId: "f3" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("tillåter flytt till annan gren", async () => {
    const { caller, store } = makeCaller({
      documentFolders: [
        { id: "f1", name: "F1", matterId: "m1", parentId: null },
        { id: "f-other", name: "Annan", matterId: "m1", parentId: null },
      ],
    });
    await caller.moveFolder({ folderId: "f1", targetParentId: "f-other" });
    expect(folders(store).find((f) => f.id === "f1")!.parentId).toBe("f-other");
  });

  it("tillåter flytt till rot (targetParentId=null)", async () => {
    const { caller, store } = makeCaller({
      documentFolders: [{ id: "f1", name: "F1", matterId: "m1", parentId: "f-x" }],
    });
    await caller.moveFolder({ folderId: "f1", targetParentId: null });
    expect(folders(store).find((f) => f.id === "f1")!.parentId).toBeNull();
  });
});

describe("document.breadcrumb", () => {
  it("bygger sökväg från rot till vald mapp", async () => {
    const { caller } = makeCaller({
      documentFolders: [
        { id: "f1", name: "Inlagor", matterId: "m1", parentId: null },
        { id: "f2", name: "2024", matterId: "m1", parentId: "f1" },
        { id: "f3", name: "Beslut", matterId: "m1", parentId: "f2" },
      ],
    });
    const path = await caller.breadcrumb({ folderId: "f3" });
    expect(path).toEqual([
      { id: "f1", name: "Inlagor" },
      { id: "f2", name: "2024" },
      { id: "f3", name: "Beslut" },
    ]);
  });

  it("returnerar tom array när mapp ej finns", async () => {
    const { caller } = makeCaller();
    const path = await caller.breadcrumb({ folderId: "x" });
    expect(path).toEqual([]);
  });
});
