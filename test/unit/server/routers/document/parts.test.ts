/**
 * document.partsByMatter / document.setPartKind (#1220) mot en riktig
 * in-memory-store (LocalStore + repos).
 */

import { describe, expect, it } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { documentRouter } from "@/lib/server/routers/document";
import { prebakeJoins } from "@/lib/shared/demo-source";

const ORG = "org-a";
const part = (id: string, ordinal: number, pages: [number, number], kind: string) =>
  ({ id, documentId: "d1", matterId: "m1", ordinal, kind, fromPage: pages[0], toPage: pages[1], source: "AUTO", version: 1 });

function makeCaller(docExtra: Record<string, unknown> = {}, orgId = ORG) {
  const source = prebakeJoins({
    matters: [
      { id: "m1", organizationId: ORG, matterNumber: "2026-1", title: "T" },
      { id: "m2", organizationId: "org-b", matterNumber: "2026-2", title: "Annan" },
    ],
    documents: [{ id: "d1", matterId: "m1", fileName: "a.pdf", documentType: "KALLELSE", ...docExtra }],
    documentParts: [
      part("p1", 0, [1, 2], "KALLELSE"),
      part("p2", 1, [3, 9], "STAMNING"),
      { ...part("p3", 2, [10, 10], "DOM"), deletedAt: new Date() },
    ],
  } as DemoSource);
  const store = new LocalStore(source, async () => {});
  const repos = buildInMemoryRepositories(store);
  const ctx = {
    user: { id: "u1", email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    dataStore: store, repos, orgId, ports: {},
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { caller: documentRouter.createCaller(ctx as any), repos };
}

describe("document.partsByMatter", () => {
  it("listar levande delar i sidordning", async () => {
    const { caller } = makeCaller();
    const parts = await caller.partsByMatter({ matterId: "m1" as never });
    expect(parts.map((p) => [p.id, p.kind])).toEqual([["p1", "KALLELSE"], ["p2", "STAMNING"]]);
  });

  it("annan byrås ärende → NOT_FOUND", async () => {
    const { caller } = makeCaller();
    await expect(caller.partsByMatter({ matterId: "m2" as never })).rejects.toThrow();
  });
});

describe("document.setPartKind", () => {
  it("rättar kategorin → MANUAL; senare del rör inte documentType", async () => {
    const { caller, repos } = makeCaller();
    const updated = await caller.setPartKind({ partId: "p2" as never, kind: "FUP" });
    expect(updated).toMatchObject({ kind: "FUP", source: "MANUAL" });
    expect((await repos.documents.getById("d1" as never))?.documentType).toBe("KALLELSE");
  });

  it("första delen → documentType följer med", async () => {
    const { caller, repos } = makeCaller();
    await caller.setPartKind({ partId: "p1" as never, kind: "DELGIVNINGSKVITTO" });
    expect((await repos.documents.getById("d1" as never))?.documentType).toBe("DELGIVNINGSKVITTO");
  });

  it("specialvärde i documentType skrivs inte över", async () => {
    const { caller, repos } = makeCaller({ documentType: "Kostnadsräkning" });
    await caller.setPartKind({ partId: "p1" as never, kind: "DOM" });
    expect((await repos.documents.getById("d1" as never))?.documentType).toBe("Kostnadsräkning");
  });

  it("okänd/raderad del → NOT_FOUND; okänd kategori avvisas av zod", async () => {
    const { caller } = makeCaller();
    await expect(caller.setPartKind({ partId: "p3" as never, kind: "DOM" })).rejects.toThrow();
    await expect(caller.setPartKind({ partId: "p1" as never, kind: "NÅGOT" as never })).rejects.toThrow();
  });

  it("annan byrå → NOT_FOUND", async () => {
    const { caller } = makeCaller({}, "org-b");
    await expect(caller.setPartKind({ partId: "p1" as never, kind: "DOM" })).rejects.toThrow("NOT_FOUND");
  });
});
