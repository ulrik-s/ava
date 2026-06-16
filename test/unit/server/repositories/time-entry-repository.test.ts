/**
 * TimeEntryRepository-paritet (ADR 0020, #409 fan-out) — in-memory + Drizzle
 * (pglite). `listUnbilled` (med user.hourlyRate) + `flagBilled` (bulk-koppling).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { matters, timeEntries, users } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { DrizzleTimeEntryRepository } from "@/lib/server/repositories/drizzle-time-entry-repository";
import { InMemoryTimeEntryRepository } from "@/lib/server/repositories/in-memory-time-entry-repository";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("TimeEntryRepository — in-memory", () => {
  it("listUnbilled (user.hourlyRate) + flagBilled kopplar till faktura", async () => {
    const matterId = uuidv7();
    const userId = uuidv7();
    const t1 = uuidv7();
    const t2 = uuidv7();
    const store = new LocalStore({
      matters: [{ id: matterId, organizationId: "org-1" }],
      users: [{ id: userId, name: "Anna", hourlyRate: 150_000 }],
      timeEntries: [
        { id: t1, userId, matterId, minutes: 60, billable: true, invoiceId: null },
        { id: t2, userId, matterId, minutes: 30, billable: true, invoiceId: null },
      ],
    }, async () => {});
    const repo = new InMemoryTimeEntryRepository(store);

    const unbilled = await repo.listUnbilled(matterId, [t1, t2]);
    expect(unbilled).toHaveLength(2);
    expect(unbilled[0]!.user.hourlyRate).toBe(150_000);
    expect(await repo.listUnbilled(matterId, [])).toEqual([]);

    await repo.flagBilled([t1], uuidv7());
    expect(await repo.listUnbilled(matterId, [t1, t2])).toHaveLength(1); // t1 nu fakturerad
  });
});

describe("TimeEntryRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listUnbilled joinar user.hourlyRate + flagBilled bulk-sätter invoiceId", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const userId = uuidv7();
    const t1 = uuidv7();
    const t2 = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(users).values(v({ id: userId, organizationId: org, email: "a@x", name: "Anna", hourlyRate: 150_000 }));
    await db.insert(timeEntries).values(v({ id: t1, userId, matterId: mId, date: new Date(), minutes: 60, description: "x", hourlyRate: 1000 }));
    await db.insert(timeEntries).values(v({ id: t2, userId, matterId: mId, date: new Date(), minutes: 30, description: "y", hourlyRate: 1000 }));
    const repo = new DrizzleTimeEntryRepository(handle.db as unknown as AppDb);

    const unbilled = await repo.listUnbilled(mId, [t1, t2]);
    expect(unbilled).toHaveLength(2);
    expect(unbilled[0]!.user.hourlyRate).toBe(150_000);

    await repo.flagBilled([t1], uuidv7());
    expect(await repo.listUnbilled(mId, [t1, t2])).toHaveLength(1);
  });
});
