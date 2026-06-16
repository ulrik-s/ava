/**
 * ExpenseRepository-paritet (ADR 0020, #409 fan-out) — in-memory + Drizzle
 * (pglite). `listUnbilled` + `flagBilled` (bulk-koppling).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { expenses, matters, users } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { DrizzleExpenseRepository } from "@/lib/server/repositories/drizzle-expense-repository";
import { InMemoryExpenseRepository } from "@/lib/server/repositories/in-memory-expense-repository";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("ExpenseRepository — in-memory", () => {
  it("listUnbilled + flagBilled kopplar till faktura", async () => {
    const matterId = uuidv7();
    const e1 = uuidv7();
    const e2 = uuidv7();
    const store = new LocalStore({
      matters: [{ id: matterId, organizationId: "org-1" }],
      expenses: [
        { id: e1, matterId, amount: 50_000, billable: true, invoiceId: null },
        { id: e2, matterId, amount: 30_000, billable: true, invoiceId: null },
      ],
    }, async () => {});
    const repo = new InMemoryExpenseRepository(store);

    expect(await repo.listUnbilled(matterId, [e1, e2])).toHaveLength(2);
    expect(await repo.listUnbilled(matterId, [])).toEqual([]);

    await repo.flagBilled([e1], uuidv7());
    expect(await repo.listUnbilled(matterId, [e1, e2])).toHaveLength(1); // e1 nu fakturerad
  });
});

describe("ExpenseRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listUnbilled + flagBilled bulk-sätter invoiceId", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const userId = uuidv7();
    const e1 = uuidv7();
    const e2 = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(users).values(v({ id: userId, organizationId: org, email: "a@x", name: "Anna" }));
    await db.insert(expenses).values(v({ id: e1, userId, matterId: mId, date: new Date(), amount: 50_000, description: "x" }));
    await db.insert(expenses).values(v({ id: e2, userId, matterId: mId, date: new Date(), amount: 30_000, description: "y" }));
    const repo = new DrizzleExpenseRepository(handle.db as unknown as AppDb);

    expect(await repo.listUnbilled(mId, [e1, e2])).toHaveLength(2);
    await repo.flagBilled([e1], uuidv7());
    expect(await repo.listUnbilled(mId, [e1, e2])).toHaveLength(1);
  });
});
