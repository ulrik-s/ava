/**
 * Paritet (ADR 0020) för DocumentPartRepository (#1220) — listForDocument /
 * listByMatter (sorterade, utan tombstones) + update — in-memory + Drizzle (pglite).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { documents, matters, users } from "@/lib/server/db/schema";
import type { DocumentPartRepository } from "@/lib/server/repositories/document-part-repository";
import { DrizzleDocumentPartRepository } from "@/lib/server/repositories/drizzle-document-part-repository";
import { InMemoryDocumentPartRepository } from "@/lib/server/repositories/in-memory-document-part-repository";
import type { DocumentPart } from "@/lib/shared/schemas/document";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = asId<"OrganizationId">(uuidv7());
const M1 = asId<"MatterId">(uuidv7());
const M2 = asId<"MatterId">(uuidv7());
const D1 = asId<"DocumentId">(uuidv7());
const D2 = asId<"DocumentId">(uuidv7());
const D3 = asId<"DocumentId">(uuidv7());
const U = asId<"UserId">(uuidv7());

const part = (documentId: string, matterId: string, ordinal: number, pages: [number, number], kind: DocumentPart["kind"] = "DOM"): Partial<DocumentPart> =>
  ({ documentId: asId<"DocumentId">(documentId), matterId: asId<"MatterId">(matterId), ordinal, kind, fromPage: pages[0], toPage: pages[1], source: "AUTO" });

async function exercise(repo: DocumentPartRepository): Promise<void> {
  await repo.create(part(D1, M1, 1, [3, 5], "FUP"));
  const first = await repo.create(part(D1, M1, 0, [1, 2], "KALLELSE"));
  await repo.create(part(D2, M1, 0, [1, 1]));
  const other = await repo.create(part(D3, M2, 0, [1, 1]));
  const gone = await repo.create(part(D1, M1, 2, [6, 6]));
  await repo.softDelete(gone.id);

  expect((await repo.listForDocument(D1)).map((p) => [p.kind, p.fromPage])).toEqual([["KALLELSE", 1], ["FUP", 3]]);
  const byMatter = await repo.listByMatter(M1);
  expect(byMatter).toHaveLength(3);
  expect(byMatter.map((p) => p.id)).not.toContain(other.id);
  const updated = await repo.update(first.id, { kind: "STAMNING", source: "MANUAL" });
  expect(updated).toMatchObject({ kind: "STAMNING", source: "MANUAL", version: 2 });
}

describe("DocumentPartRepository — in-memory", () => {
  it("listForDocument/listByMatter/update", async () => {
    const store = new LocalStore({ documentParts: [] }, async () => {});
    await exercise(new InMemoryDocumentPartRepository(store));
  });
});

describe("DocumentPartRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listForDocument/listByMatter/update", async () => {
    const db = handle.db;
    await db.insert(matters).values([
      { id: M1, organizationId: ORG, matterNumber: "AA2026-1", title: "A" },
      { id: M2, organizationId: ORG, matterNumber: "AA2026-2", title: "B" },
    ]);
    await db.insert(users).values({ id: U, organizationId: ORG, email: "u@x", name: "U" });
    const doc = (id: typeof D1, matterId: typeof M1) => ({
      id, matterId, fileName: "f.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath: "documents/content/f", uploadedById: U,
    });
    await db.insert(documents).values([doc(D1, M1), doc(D2, M1), doc(D3, M2)]);
    await exercise(new DrizzleDocumentPartRepository(db));
  });
});
