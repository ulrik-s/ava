/**
 * DocumentSuggestionRepository-paritet (ADR 0020) — in-memory + Drizzle (pglite).
 * getByIdInOrg / listPendingForMatter / listPendingByIds / listByIdsInOrg /
 * updateManyByIds, org-scopat via dokument→ärende.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { documentAnalysisSuggestions, documents, matters } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { DrizzleDocumentSuggestionRepository } from "@/lib/server/repositories/drizzle-document-suggestion-repository";
import { InMemoryDocumentSuggestionRepository } from "@/lib/server/repositories/in-memory-document-suggestion-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = "77777777-7777-7777-8777-777777777777";

describe("DocumentSuggestionRepository — in-memory", () => {
  it("getByIdInOrg/listPending*/listByIds/updateMany", async () => {
    const mId = uuidv7();
    const dId = uuidv7();
    const s1 = uuidv7();
    const s2 = uuidv7();
    const source = prebakeJoins({
      matters: [{ id: mId, organizationId: ORG, matterNumber: "2026-1", title: "T" }],
      documents: [{ id: dId, matterId: mId, fileName: "f.pdf", title: "F" }],
      documentAnalysisSuggestions: [
        { id: s1, documentId: dId, name: "Anna", role: "MOTPART", contactType: "PERSON", status: "PENDING", createdAt: new Date("2026-06-01") },
        { id: s2, documentId: dId, name: "Bo", role: "OMBUD", contactType: "PERSON", status: "REJECTED", createdAt: new Date("2026-06-02") },
      ],
    } as DemoSource);
    const store = new LocalStore(source, async () => {});
    const repo = new InMemoryDocumentSuggestionRepository(store);

    expect(await repo.getByIdInOrg(s1, ORG)).toMatchObject({ id: s1, document: { matterId: mId } });
    expect(await repo.getByIdInOrg(s1, uuidv7())).toBeNull();
    expect((await repo.listPendingForMatter(mId, ORG, "asc")).map((s) => s.id)).toEqual([s1]);
    expect((await repo.listPendingByIds([s1, s2], ORG)).map((s) => s.id)).toEqual([s1]);
    expect((await repo.listByIdsInOrg([s1, s2], ORG)).length).toBe(2);

    await repo.updateManyByIds([s1], { status: "ACCEPTED" } as never);
    expect((await repo.listPendingForMatter(mId, ORG, "asc")).length).toBe(0);
  });
});

describe("DocumentSuggestionRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("getByIdInOrg/listPending*/listByIds/updateMany", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const dId = uuidv7();
    const s1 = uuidv7();
    const s2 = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(documents).values(v({ id: dId, matterId: mId, fileName: "f.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath: "p", uploadedById: uuidv7(), title: "F" }));
    await db.insert(documentAnalysisSuggestions).values(v({ id: s1, documentId: dId, name: "Anna", role: "MOTPART", contactType: "PERSON", status: "PENDING" }));
    await db.insert(documentAnalysisSuggestions).values(v({ id: s2, documentId: dId, name: "Bo", role: "OMBUD", contactType: "PERSON", status: "REJECTED" }));
    const repo = new DrizzleDocumentSuggestionRepository(db as unknown as AppDb);

    expect(await repo.getByIdInOrg(s1, org)).toMatchObject({ id: s1, document: { matterId: mId } });
    expect(await repo.getByIdInOrg(s1, uuidv7())).toBeNull();
    expect((await repo.listPendingForMatter(mId, org, "asc")).map((s) => s.id)).toEqual([s1]);
    expect((await repo.listPendingByIds([s1, s2], org)).map((s) => s.id)).toEqual([s1]);
    expect((await repo.listByIdsInOrg([s1, s2], org)).length).toBe(2);

    await repo.updateManyByIds([s1], { status: "ACCEPTED" } as never);
    expect((await repo.listPendingForMatter(mId, org, "asc")).length).toBe(0);
  });
});
