/**
 * DocumentRepository + DocumentFolderRepository-paritet (ADR 0020) —
 * in-memory + Drizzle (pglite). list/getByIdInOrg/reassign + folder-_count.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { documentFolders, documentParts, documents, matters, users } from "@/lib/server/db/schema";
import { DrizzleDocumentFolderRepository } from "@/lib/server/repositories/drizzle-document-folder-repository";
import { DrizzleDocumentRepository } from "@/lib/server/repositories/drizzle-document-repository";
import { InMemoryDocumentFolderRepository } from "@/lib/server/repositories/in-memory-document-folder-repository";
import { InMemoryDocumentRepository } from "@/lib/server/repositories/in-memory-document-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = asId<"OrganizationId">("11111111-1111-7111-8111-111111111111");

describe("DocumentRepository / DocumentFolderRepository — in-memory", () => {
  it("list/getByIdInOrg/reassign + folder _count", async () => {
    const mId = asId<"MatterId">(uuidv7());
    const uId = asId<"UserId">(uuidv7());
    const root = asId<"DocumentFolderId">(uuidv7());
    const sub = asId<"DocumentFolderId">(uuidv7());
    const d1 = asId<"DocumentId">(uuidv7());
    const source = prebakeJoins({
      matters: [{ id: mId, organizationId: ORG, matterNumber: "2026-1", title: "T" }],
      users: [{ id: uId, name: "Anna" }],
      documentFolders: [
        { id: root, name: "Rot", matterId: mId, parentId: null },
        { id: sub, name: "Under", matterId: mId, parentId: root },
      ],
      documents: [
        { id: d1, matterId: mId, folderId: root, fileName: "a.pdf", uploadedById: uId, kinds: ["KALLELSE", "FUP"], documentType: "KALLELSE" },
        { id: uuidv7(), matterId: mId, folderId: null, fileName: "b.pdf", documentType: "Faktura" },
      ],
      // ADR 0038: d1 har sina typer; b.pdf är en äldre rad (läsregeln: Faktura → FAKTURA).
      documentParts: [
        { id: uuidv7(), documentId: d1, matterId: mId, ordinal: 0, kind: "KALLELSE", fromPage: 1, toPage: 1, source: "AUTO" },
        { id: uuidv7(), documentId: d1, matterId: mId, ordinal: 1, kind: "FUP", fromPage: 2, toPage: 3, source: "AUTO" },
        { id: uuidv7(), documentId: d1, matterId: mId, ordinal: 2, kind: "DOM", fromPage: 4, toPage: 4, source: "AUTO", deletedAt: new Date() },
      ],
    });
    const store = new LocalStore(source, async () => {});
    const docs = new InMemoryDocumentRepository(store);
    const folders = new InMemoryDocumentFolderRepository(store);

    const inRoot = await docs.listInFolder(mId, root, 1, 50);
    expect(inRoot.total).toBe(1);
    expect(inRoot.documents[0]!.uploadedBy?.name).toBe("Anna");
    expect(await docs.getByIdInOrg(d1, ORG)).toMatchObject({ id: d1, matterId: mId });
    expect(await docs.getByIdInOrg(d1, asId<"OrganizationId">(uuidv7()))).toBeNull();
    expect((await docs.listByMatter(mId)).length).toBe(2);
    expect(await docs.listDocumentTypesForOrg(ORG)).toEqual([
      { type: "FAKTURA", count: 1 }, { type: "FUP", count: 1 }, { type: "KALLELSE", count: 1 },
    ]);
    expect((await docs.listWithLegacyKinds()).map((d) => d.fileName)).toEqual(["b.pdf"]);

    const rootFolders = await folders.listInParent(mId, null);
    expect(rootFolders).toHaveLength(1);
    expect(rootFolders[0]!._count).toEqual({ documents: 1, children: 1 });

    await docs.reassignFolder(root, null);
    expect((await docs.listInFolder(mId, root, 1, 50)).total).toBe(0);
    await folders.reassignParent(root, null);
    expect((await folders.getById(asId<"DocumentFolderId">(sub)))!.parentId).toBeNull();
  });

  it("listStoredContent (#1145): varje dokuments adress + skapelsetid; saknad adress = tom", async () => {
    const source = prebakeJoins({
      documents: [
        { id: "d-a", matterId: "m", fileName: "a.pdf", storagePath: "documents/content/a", createdAt: new Date("2026-09-01") },
        { id: "d-b", matterId: "m", fileName: "b.pdf" },
      ],
    });
    const docs = new InMemoryDocumentRepository(new LocalStore(source, async () => {}));
    expect(await docs.listStoredContent()).toEqual([
      { id: "d-a", storagePath: "documents/content/a", createdAt: new Date("2026-09-01") },
      { id: "d-b", storagePath: "", createdAt: new Date(0) },
    ]);
  });
});

/** Skapelsetiden på dokumenten i testerna av listFinalRulingsForMatters (#2101). */
const RULINGS_AT = new Date("2026-11-01T10:00:00Z");

describe("DocumentRepository.listFinalRulingsForMatters (#2101) — in-memory", () => {
  it("bara dokument med ett avgörande i de angivna ärendena, inte raderade, med fälten", async () => {
    const d = (id: string, matterId: string, extra: Record<string, unknown> = {}) => ({
      id, matterId, fileName: `${id}.pdf`, storagePath: `documents/content/${id}`, createdAt: RULINGS_AT, finalRuling: "PT_HD", ...extra,
    });
    const source = prebakeJoins({
      documents: [
        d("hit", "m1"), d("none", "m1", { finalRuling: null }), d("gone", "m1", { deletedAt: new Date() }),
        d("other", "m3"), d("hit2", "m2", { finalRuling: "AVSKRIVNING", createdAt: RULINGS_AT.toISOString() }),
      ],
    });
    const docs = new InMemoryDocumentRepository(new LocalStore(source, async () => {}));
    const rows = await docs.listFinalRulingsForMatters([asId<"MatterId">("m1"), asId<"MatterId">("m2")]);
    expect(rows.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "hit", matterId: "m1", fileName: "hit.pdf", storagePath: "documents/content/hit", createdAt: RULINGS_AT, finalRuling: "PT_HD" },
      { id: "hit2", matterId: "m2", fileName: "hit2.pdf", storagePath: "documents/content/hit2", createdAt: RULINGS_AT, finalRuling: "AVSKRIVNING" },
    ]);
    expect(await docs.listFinalRulingsForMatters([])).toEqual([]);
  });
});

describe("DocumentRepository / DocumentFolderRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("list/getByIdInOrg/reassign + folder _count", async () => {
    const db = handle.db;
    const org = asId<"OrganizationId">(uuidv7());
    const mId = asId<"MatterId">(uuidv7());
    const uId = asId<"UserId">(uuidv7());
    const root = asId<"DocumentFolderId">(uuidv7());
    const sub = asId<"DocumentFolderId">(uuidv7());
    const d1 = asId<"DocumentId">(uuidv7());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(users).values(v({ id: uId, organizationId: org, email: "a@x", name: "Anna" }));
    await db.insert(documentFolders).values(v({ id: root, name: "Rot", matterId: mId, parentId: null }));
    await db.insert(documentFolders).values(v({ id: sub, name: "Under", matterId: mId, parentId: root }));
    const doc = (extra: Record<string, unknown>) =>
      v({ matterId: mId, fileName: "f", mimeType: "application/pdf", sizeBytes: 1, storagePath: "p", uploadedById: uId, ...extra });
    await db.insert(documents).values(doc({ id: d1, folderId: root, kinds: ["KALLELSE", "FUP"], documentType: "KALLELSE" }));
    await db.insert(documents).values(doc({ id: uuidv7(), folderId: null, documentType: "Faktura" }));
    const part = (ordinal: number, kind: string, deletedAt: Date | null = null) =>
      v({ id: uuidv7(), documentId: d1, matterId: mId, ordinal, kind, fromPage: ordinal + 1, toPage: ordinal + 1, source: "AUTO", deletedAt });
    await db.insert(documentParts).values([part(0, "KALLELSE"), part(1, "FUP"), part(2, "DOM", new Date())]);
    const docs = new DrizzleDocumentRepository(db);
    const folders = new DrizzleDocumentFolderRepository(db);

    const inRoot = await docs.listInFolder(mId, root, 1, 50);
    expect(inRoot.total).toBe(1);
    expect(inRoot.documents[0]!.uploadedBy?.name).toBe("Anna");
    expect(await docs.getByIdInOrg(d1, org)).toMatchObject({ id: d1, matterId: mId });
    expect(await docs.getByIdInOrg(d1, asId<"OrganizationId">(uuidv7()))).toBeNull();
    expect((await docs.listByMatter(mId)).length).toBe(2);
    expect(await docs.listDocumentTypesForOrg(org)).toEqual([
      { type: "FAKTURA", count: 1 }, { type: "FUP", count: 1 }, { type: "KALLELSE", count: 1 },
    ]);
    expect((await docs.listWithLegacyKinds()).map((d) => d.fileName)).toEqual(["f"]);

    const rootFolders = await folders.listInParent(mId, null);
    expect(rootFolders).toHaveLength(1);
    expect(rootFolders[0]!._count).toEqual({ documents: 1, children: 1 });

    await docs.reassignFolder(root, null);
    expect((await docs.listInFolder(mId, root, 1, 50)).total).toBe(0);
    await folders.reassignParent(root, null);
    expect((await folders.getById(asId<"DocumentFolderId">(sub)))!.parentId).toBeNull();
  });

  it("listStoredContent (#1145): ej raderade dokuments adress + skapelsetid", async () => {
    const db = handle.db;
    const mId = asId<"MatterId">(uuidv7());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: uuidv7(), matterNumber: "2026-1145", title: "T" }));
    const kept = uuidv7(), gone = uuidv7();
    const doc = (id: string, extra: Record<string, unknown>) =>
      v({ id, matterId: mId, fileName: "f", mimeType: "application/pdf", sizeBytes: 1, uploadedById: uuidv7(), ...extra });
    await db.insert(documents).values(doc(kept, { storagePath: "documents/content/kvar" }));
    await db.insert(documents).values(doc(gone, { storagePath: "documents/content/borta", deletedAt: new Date() }));
    const rows = await new DrizzleDocumentRepository(db).listStoredContent();
    expect(rows.find((r) => r.id === kept)).toMatchObject({ storagePath: "documents/content/kvar", createdAt: expect.any(Date) });
    expect(rows.find((r) => r.id === gone)).toBeUndefined();
  });

  it("listFinalRulingsForMatters (#2101): bara dokument med ett avgörande i de angivna ärendena, inte raderade", async () => {
    const db = handle.db;
    const [m1, m2, m3] = [asId<"MatterId">(uuidv7()), asId<"MatterId">(uuidv7()), asId<"MatterId">(uuidv7())];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    for (const id of [m1, m2, m3]) {
      await db.insert(matters).values(v({ id, organizationId: uuidv7(), matterNumber: `2026-${id}`, title: "T" }));
    }
    const hit = asId<"DocumentId">(uuidv7());
    const doc = (id: string, matterId: string, extra: Record<string, unknown>) => v({
      id, matterId, fileName: "dom.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath: "documents/content/dom",
      uploadedById: uuidv7(), createdAt: RULINGS_AT, ...extra,
    });
    await db.insert(documents).values(doc(hit, m1, { finalRuling: "DOM_HFD" }));
    await db.insert(documents).values(doc(uuidv7(), m1, { finalRuling: null }));
    await db.insert(documents).values(doc(uuidv7(), m2, { finalRuling: "PT_HD", deletedAt: new Date() }));
    await db.insert(documents).values(doc(uuidv7(), m3, { finalRuling: "PT_HD" }));
    const repo = new DrizzleDocumentRepository(db);
    expect(await repo.listFinalRulingsForMatters([m1, m2])).toEqual([
      { id: hit, matterId: m1, fileName: "dom.pdf", storagePath: "documents/content/dom", createdAt: RULINGS_AT, finalRuling: "DOM_HFD" },
    ]);
    expect(await repo.listFinalRulingsForMatters([])).toEqual([]);
  });
});
