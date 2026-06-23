/**
 * ServiceNoteRepository-paritet (ADR 0020, #409 fan-out) — in-memory + Drizzle
 * (pglite). `listByMatter` (org-scope via ärendet + författare) + `getByIdInOrg`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { matters, serviceNotes, users } from "@/lib/server/db/schema";
import { DrizzleServiceNoteRepository } from "@/lib/server/repositories/drizzle-service-note-repository";
import { InMemoryServiceNoteRepository } from "@/lib/server/repositories/in-memory-service-note-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("ServiceNoteRepository — in-memory", () => {
  it("listByMatter (org-scope via ärende + author) + getByIdInOrg", async () => {
    const mId = asId<"MatterId">(uuidv7());
    const userId = uuidv7();
    const sn1 = asId<"ServiceNoteId">(uuidv7());
    const org = asId<"OrganizationId">("org-1");
    // prebakeJoins → nästlade relationer (author, matter) resolvas som i prod.
    const source = prebakeJoins({
      matters: [{ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }],
      users: [{ id: userId, name: "Anna" }],
      serviceNotes: [
        { id: sn1, matterId: mId, organizationId: org, authorId: userId, date: "2026-06-15", time: "09:30", text: "A" },
      ],
    } as DemoSource);
    const repo = new InMemoryServiceNoteRepository(new LocalStore(source, async () => {}));
    const list = await repo.listByMatter(mId, org);
    expect(list).toHaveLength(1);
    expect(list[0]!.author?.name).toBe("Anna");
    expect(await repo.getByIdInOrg(sn1, org)).toMatchObject({ id: sn1 });
    expect(await repo.getByIdInOrg(sn1, asId<"OrganizationId">("org-2"))).toBeNull(); // fel org
  });
});

describe("ServiceNoteRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listByMatter (join ärende/author) + getByIdInOrg", async () => {
    const db = handle.db;
    const org = asId<"OrganizationId">(uuidv7());
    const mId = asId<"MatterId">(uuidv7());
    const userId = uuidv7();
    const sn1 = asId<"ServiceNoteId">(uuidv7());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(users).values(v({ id: userId, organizationId: org, email: "a@x", name: "Anna" }));
    await db.insert(serviceNotes).values(v({ id: sn1, matterId: mId, organizationId: org, authorId: userId, date: "2026-06-15", time: "09:30", text: "A" }));
    const repo = new DrizzleServiceNoteRepository(handle.db);
    const list = await repo.listByMatter(mId, org);
    expect(list).toHaveLength(1);
    expect(list[0]!.author?.name).toBe("Anna");
    expect(await repo.getByIdInOrg(sn1, org)).toMatchObject({ id: sn1 });
    expect(await repo.getByIdInOrg(sn1, asId<"OrganizationId">(uuidv7()))).toBeNull(); // fel org
  });
});
