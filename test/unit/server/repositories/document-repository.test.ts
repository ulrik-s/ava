/**
 * DocumentRepository + DocumentFolderRepository-paritet (ADR 0020) —
 * in-memory + Drizzle (pglite). list/getByIdInOrg/reassign + folder-_count.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { documentFolders, documents, matters, users } from "@/lib/server/db/schema";
import { DrizzleDocumentFolderRepository } from "@/lib/server/repositories/drizzle-document-folder-repository";
import { DrizzleDocumentRepository } from "@/lib/server/repositories/drizzle-document-repository";
import { InMemoryDocumentFolderRepository } from "@/lib/server/repositories/in-memory-document-folder-repository";
import { InMemoryDocumentRepository } from "@/lib/server/repositories/in-memory-document-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = "11111111-1111-7111-8111-111111111111";

describe("DocumentRepository / DocumentFolderRepository — in-memory", () => {
  it("list/getByIdInOrg/reassign + folder _count", async () => {
    const mId = uuidv7();
    const uId = uuidv7();
    const root = uuidv7();
    const sub = uuidv7();
    const d1 = uuidv7();
    const source = prebakeJoins({
      matters: [{ id: mId, organizationId: ORG, matterNumber: "2026-1", title: "T" }],
      users: [{ id: uId, name: "Anna" }],
      documentFolders: [
        { id: root, name: "Rot", matterId: mId, parentId: null },
        { id: sub, name: "Under", matterId: mId, parentId: root },
      ],
      documents: [
        { id: d1, matterId: mId, folderId: root, fileName: "a.pdf", uploadedById: uId, documentType: "Avtal" },
        { id: uuidv7(), matterId: mId, folderId: null, fileName: "b.pdf", documentType: "Faktura" },
      ],
    } as DemoSource);
    const store = new LocalStore(source, async () => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docs = new InMemoryDocumentRepository(store as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const folders = new InMemoryDocumentFolderRepository(store as any);

    const inRoot = await docs.listInFolder(mId, root, 1, 50);
    expect(inRoot.total).toBe(1);
    expect(inRoot.documents[0]!.uploadedBy?.name).toBe("Anna");
    expect(await docs.getByIdInOrg(d1, ORG)).toMatchObject({ id: d1, matterId: mId });
    expect(await docs.getByIdInOrg(d1, uuidv7())).toBeNull();
    expect((await docs.listByMatter(mId)).length).toBe(2);
    expect(await docs.listDocumentTypesForOrg(ORG)).toEqual([
      { type: "Avtal", count: 1 }, { type: "Faktura", count: 1 },
    ]);

    const rootFolders = await folders.listInParent(mId, null);
    expect(rootFolders).toHaveLength(1);
    expect(rootFolders[0]!._count).toEqual({ documents: 1, children: 1 });

    await docs.reassignFolder(root, null);
    expect((await docs.listInFolder(mId, root, 1, 50)).total).toBe(0);
    await folders.reassignParent(root, null);
    expect((await folders.getById(sub))!.parentId).toBeNull();
  });
});

describe("DocumentRepository / DocumentFolderRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("list/getByIdInOrg/reassign + folder _count", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const uId = uuidv7();
    const root = uuidv7();
    const sub = uuidv7();
    const d1 = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(users).values(v({ id: uId, organizationId: org, email: "a@x", name: "Anna" }));
    await db.insert(documentFolders).values(v({ id: root, name: "Rot", matterId: mId, parentId: null }));
    await db.insert(documentFolders).values(v({ id: sub, name: "Under", matterId: mId, parentId: root }));
    const doc = (extra: Record<string, unknown>) =>
      v({ matterId: mId, fileName: "f", mimeType: "application/pdf", sizeBytes: 1, storagePath: "p", uploadedById: uId, ...extra });
    await db.insert(documents).values(doc({ id: d1, folderId: root, documentType: "Avtal" }));
    await db.insert(documents).values(doc({ id: uuidv7(), folderId: null, documentType: "Faktura" }));
    const docs = new DrizzleDocumentRepository(db);
    const folders = new DrizzleDocumentFolderRepository(db);

    const inRoot = await docs.listInFolder(mId, root, 1, 50);
    expect(inRoot.total).toBe(1);
    expect(inRoot.documents[0]!.uploadedBy?.name).toBe("Anna");
    expect(await docs.getByIdInOrg(d1, org)).toMatchObject({ id: d1, matterId: mId });
    expect(await docs.getByIdInOrg(d1, uuidv7())).toBeNull();
    expect((await docs.listByMatter(mId)).length).toBe(2);
    expect(await docs.listDocumentTypesForOrg(org)).toEqual([
      { type: "Avtal", count: 1 }, { type: "Faktura", count: 1 },
    ]);

    const rootFolders = await folders.listInParent(mId, null);
    expect(rootFolders).toHaveLength(1);
    expect(rootFolders[0]!._count).toEqual({ documents: 1, children: 1 });

    await docs.reassignFolder(root, null);
    expect((await docs.listInFolder(mId, root, 1, 50)).total).toBe(0);
    await folders.reassignParent(root, null);
    expect((await folders.getById(sub))!.parentId).toBeNull();
  });
});
