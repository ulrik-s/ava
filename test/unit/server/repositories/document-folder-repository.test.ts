/**
 * Paritet (ADR 0020) för DocumentFolderRepository — listInParent (med _count),
 * listByMatter (sorterad) och reassignParent — in-memory + Drizzle (pglite).
 * #27: metoderna saknade dedikerad täckning (drizzle-impl låg på 74% rader).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { documentFolders, documents, matters, users } from "@/lib/server/db/schema";
import { DrizzleDocumentFolderRepository } from "@/lib/server/repositories/drizzle-document-folder-repository";
import { InMemoryDocumentFolderRepository } from "@/lib/server/repositories/in-memory-document-folder-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = "66666666-6666-7666-8666-666666666666";

// Delat träd: matter med 2 rotmappar (A, B); A har 2 undermappar; 2 dok i A, 1 i A1.
function tree() {
  const mId = uuidv7();
  const uId = uuidv7();
  const fA = uuidv7(), fB = uuidv7(), fA1 = uuidv7(), fA2 = uuidv7();
  const folders = [
    { id: fA, matterId: mId, name: "A Avtal", parentId: null },
    { id: fB, matterId: mId, name: "B Bilagor", parentId: null },
    { id: fA1, matterId: mId, name: "Undermapp 1", parentId: fA },
    { id: fA2, matterId: mId, name: "Undermapp 2", parentId: fA },
  ];
  const doc = (folderId: string) => ({
    id: uuidv7(), organizationId: ORG, matterId: mId, folderId,
    fileName: "f.pdf", mimeType: "application/pdf", sizeBytes: 10,
    storagePath: "documents/content/x", uploadedById: uId,
  });
  const docs = [doc(fA), doc(fA), doc(fA1)];
  return { mId, uId, fA, fB, fA1, fA2, folders, docs };
}

describe("DocumentFolderRepository — in-memory", () => {
  it("listInParent/listByMatter/reassignParent", async () => {
    const t = tree();
    const source = prebakeJoins({
      matters: [{ id: t.mId, organizationId: ORG, matterNumber: "2026-7", title: "Z" }],
      documentFolders: t.folders,
      documents: t.docs,
    } as DemoSource);
    const store = new LocalStore(source, async () => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = new InMemoryDocumentFolderRepository(store as any);

    const roots = await repo.listInParent(t.mId, null);
    expect(roots.map((f) => f.id)).toEqual([t.fA, t.fB]); // namn-asc: "A Avtal" < "B Bilagor"

    const children = await repo.listInParent(t.mId, t.fA);
    expect(children.map((f) => f.id)).toEqual([t.fA1, t.fA2]);

    const all = await repo.listByMatter(t.mId);
    expect(all.map((f) => f.name)).toEqual(["A Avtal", "B Bilagor", "Undermapp 1", "Undermapp 2"]);

    // Flytta A:s undermappar till roten → 4 rotmappar, inga kvar under A.
    await repo.reassignParent(t.fA, null);
    expect((await repo.listInParent(t.mId, null)).map((f) => f.id).sort()).toEqual(
      [t.fA, t.fB, t.fA1, t.fA2].sort(),
    );
    expect(await repo.listInParent(t.mId, t.fA)).toHaveLength(0);
  });
});

describe("DocumentFolderRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listInParent med _count + listByMatter + reassignParent", async () => {
    const db = handle.db;
    const t = tree();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: t.mId, organizationId: ORG, matterNumber: "2026-7", title: "Z" }));
    await db.insert(users).values(v({ id: t.uId, organizationId: ORG, email: "j@x", name: "Jurist" }));
    for (const f of t.folders) await db.insert(documentFolders).values(v(f));
    for (const d of t.docs) await db.insert(documents).values(v(d));
    const repo = new DrizzleDocumentFolderRepository(db);

    // listInParent(root) — sorterad + _count (A: 2 dok, 2 undermappar; B: tomt)
    const roots = await repo.listInParent(t.mId, null);
    expect(roots.map((f) => f.id)).toEqual([t.fA, t.fB]);
    expect(roots[0]!._count).toEqual({ documents: 2, children: 2 });
    expect(roots[1]!._count).toEqual({ documents: 0, children: 0 });

    // listInParent(A) — undermapparna; A1 har 1 dok, 0 undermappar
    const children = await repo.listInParent(t.mId, t.fA);
    expect(children.map((f) => f.id)).toEqual([t.fA1, t.fA2]);
    expect(children[0]!._count).toEqual({ documents: 1, children: 0 });

    // listByMatter — alla 4, namn-asc
    const all = await repo.listByMatter(t.mId);
    expect(all.map((f) => f.name)).toEqual(["A Avtal", "B Bilagor", "Undermapp 1", "Undermapp 2"]);

    // reassignParent — flytta A:s undermappar till roten
    await repo.reassignParent(t.fA, null);
    expect((await repo.listInParent(t.mId, null)).map((f) => f.id).sort()).toEqual(
      [t.fA, t.fB, t.fA1, t.fA2].sort(),
    );
    expect(await repo.listInParent(t.mId, t.fA)).toHaveLength(0);
  });
});
