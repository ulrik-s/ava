/**
 * MatterEventSuggestionRepository-paritet (ADR 0020) — in-memory + Drizzle.
 * listForMatter (ej REJECTED, startAt asc, document-include) + getByIdInOrg.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { documents, matterEventSuggestions, matters } from "@/lib/server/db/schema";
import { DrizzleMatterEventSuggestionRepository } from "@/lib/server/repositories/drizzle-matter-event-suggestion-repository";
import { InMemoryMatterEventSuggestionRepository } from "@/lib/server/repositories/in-memory-matter-event-suggestion-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = asId<"OrganizationId">("22222222-2222-7222-8222-222222222222");

describe("MatterEventSuggestionRepository — in-memory", () => {
  it("listForMatter (ej REJECTED, sorterad) + getByIdInOrg", async () => {
    const mId = asId<"MatterId">(uuidv7());
    const dId = uuidv7();
    const e1 = asId<"MatterEventSuggestionId">(uuidv7());
    const source = prebakeJoins({
      matters: [{ id: mId, organizationId: ORG, matterNumber: "2026-1", title: "T" }],
      documents: [{ id: dId, matterId: mId, fileName: "s.pdf", title: "Stämning" }],
      matterEventSuggestions: [
        { id: e1, documentId: dId, title: "Sen", startAt: new Date("2026-06-01"), status: "PENDING" },
        { id: uuidv7(), documentId: dId, title: "Tidig", startAt: new Date("2026-05-01"), status: "PENDING" },
        { id: uuidv7(), documentId: dId, title: "Avvisad", startAt: new Date("2026-04-01"), status: "REJECTED" },
      ],
    } as DemoSource);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = new InMemoryMatterEventSuggestionRepository(new LocalStore(source, async () => {}) as any);

    const list = await repo.listForMatter(mId, ORG);
    expect(list.map((r) => r.title)).toEqual(["Tidig", "Sen"]);
    expect(list[0]!.document.fileName).toBe("s.pdf");
    expect(await repo.getByIdInOrg(e1, ORG)).toMatchObject({ id: e1 });
    expect(await repo.getByIdInOrg(e1, asId<"OrganizationId">(uuidv7()))).toBeNull();
  });
});

describe("MatterEventSuggestionRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listForMatter + getByIdInOrg", async () => {
    const db = handle.db;
    const org = asId<"OrganizationId">(uuidv7());
    const mId = asId<"MatterId">(uuidv7());
    const dId = uuidv7();
    const e1 = asId<"MatterEventSuggestionId">(uuidv7());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(documents).values(v({ id: dId, matterId: mId, fileName: "s.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath: "p", uploadedById: uuidv7(), title: "Stämning" }));
    await db.insert(matterEventSuggestions).values(v({ id: e1, documentId: dId, title: "Sen", startAt: new Date("2026-06-01"), status: "PENDING" }));
    await db.insert(matterEventSuggestions).values(v({ id: uuidv7(), documentId: dId, title: "Tidig", startAt: new Date("2026-05-01"), status: "PENDING" }));
    await db.insert(matterEventSuggestions).values(v({ id: uuidv7(), documentId: dId, title: "Avvisad", startAt: new Date("2026-04-01"), status: "REJECTED" }));
    const repo = new DrizzleMatterEventSuggestionRepository(db);

    const list = await repo.listForMatter(mId, org);
    expect(list.map((r) => r.title)).toEqual(["Tidig", "Sen"]);
    expect(list[0]!.document.fileName).toBe("s.pdf");
    expect(await repo.getByIdInOrg(e1, org)).toMatchObject({ id: e1 });
    expect(await repo.getByIdInOrg(e1, asId<"OrganizationId">(uuidv7()))).toBeNull();
  });
});
