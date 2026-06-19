/**
 * ExpectedReceivableRepository-paritet (ADR 0020) — in-memory + Drizzle (pglite).
 * Täcker även MatterRepository.listByOrg (ny metod, används av candidates).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { expectedReceivables, matters } from "@/lib/server/db/schema";
import { DrizzleExpectedReceivableRepository } from "@/lib/server/repositories/drizzle-expected-receivable-repository";
import { DrizzleMatterRepository } from "@/lib/server/repositories/drizzle-matter-repository";
import { InMemoryExpectedReceivableRepository } from "@/lib/server/repositories/in-memory-expected-receivable-repository";
import { InMemoryMatterRepository } from "@/lib/server/repositories/in-memory-matter-repository";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("ExpectedReceivableRepository — in-memory", () => {
  it("listForOrg (filter status/matter) + getByIdInOrg; matters.listByOrg", async () => {
    const mId = uuidv7();
    const r1 = uuidv7();
    const store = new LocalStore({
      matters: [{ id: mId, organizationId: "org-1", matterNumber: "2026-1", title: "T" }],
      expectedReceivables: [
        { id: r1, organizationId: "org-1", matterId: mId, description: "A", expectedAmount: 100, status: "PENDING", recordedById: uuidv7() },
        { id: uuidv7(), organizationId: "org-1", matterId: mId, description: "B", expectedAmount: 50, status: "SETTLED", recordedById: uuidv7() },
      ],
    }, async () => {});
    const repo = new InMemoryExpectedReceivableRepository(store);
    expect(await repo.listForOrg("org-1")).toHaveLength(2);
    expect(await repo.listForOrg("org-1", { status: "PENDING" })).toHaveLength(1);
    expect(await repo.getByIdInOrg(r1, "org-1")).toMatchObject({ id: r1 });
    expect(await repo.getByIdInOrg(r1, "org-2")).toBeNull();
    expect(await new InMemoryMatterRepository(store).listByOrg("org-1")).toHaveLength(1);
  });
});

describe("ExpectedReceivableRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listForOrg + getByIdInOrg; matters.listByOrg", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const r1 = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(expectedReceivables).values(v({ id: r1, organizationId: org, matterId: mId, description: "A", expectedAmount: 100, status: "PENDING", recordedById: uuidv7() }));
    await db.insert(expectedReceivables).values(v({ id: uuidv7(), organizationId: org, matterId: mId, description: "B", expectedAmount: 50, status: "SETTLED", recordedById: uuidv7() }));
    const repo = new DrizzleExpectedReceivableRepository(handle.db);
    expect(await repo.listForOrg(org)).toHaveLength(2);
    expect(await repo.listForOrg(org, { status: "PENDING" })).toHaveLength(1);
    expect(await repo.getByIdInOrg(r1, org)).toMatchObject({ id: r1 });
    expect(await repo.getByIdInOrg(r1, uuidv7())).toBeNull();
    expect(await new DrizzleMatterRepository(handle.db).listByOrg(org)).toHaveLength(1);
  });
});
