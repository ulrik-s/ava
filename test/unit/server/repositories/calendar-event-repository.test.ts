/**
 * CalendarEventRepository-paritet (ADR 0020, #409 fan-out) — in-memory + Drizzle
 * (pglite). listForUser/listForUsers/listForMatter + getOwned/getOwnedWithMatter.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { calendarEvents, matters } from "@/lib/server/db/schema";
import { DrizzleCalendarEventRepository } from "@/lib/server/repositories/drizzle-calendar-event-repository";
import { InMemoryCalendarEventRepository } from "@/lib/server/repositories/in-memory-calendar-event-repository";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("CalendarEventRepository — in-memory", () => {
  it("list-varianter + ägar-vakt", async () => {
    const userId = uuidv7();
    const other = uuidv7();
    const mId = uuidv7();
    const e1 = uuidv7();
    const store = new LocalStore({
      matters: [{ id: mId, organizationId: "org-1", matterNumber: "2026-1", title: "T" }],
      calendarEvents: [
        { id: e1, userId, organizationId: "org-1", title: "A", startAt: new Date("2026-06-02"), matterId: mId },
        { id: uuidv7(), userId, organizationId: "org-1", title: "B", startAt: new Date("2026-06-01"), matterId: null },
        { id: uuidv7(), userId: other, organizationId: "org-1", title: "C", startAt: new Date("2026-06-03"), matterId: mId },
      ],
    }, async () => {});
    const repo = new InMemoryCalendarEventRepository(store);
    expect(await repo.listForUser(userId, "org-1")).toHaveLength(2);
    expect(await repo.listForUsers([userId, other], "org-1")).toHaveLength(3);
    expect(await repo.listForMatter(mId, "org-1")).toHaveLength(2); // e1 + other's C
    expect(await repo.getOwned(e1, userId, "org-1")).toMatchObject({ id: e1 });
    expect(await repo.getOwned(e1, other, "org-1")).toBeNull(); // annan user
    expect((await repo.getOwnedWithMatter(e1, userId, "org-1"))?.matter?.matterNumber).toBe("2026-1");
  });
});

describe("CalendarEventRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("list-varianter (left-join matter) + ägar-vakt", async () => {
    const db = handle.db;
    const org = uuidv7();
    const userId = uuidv7();
    const other = uuidv7();
    const mId = uuidv7();
    const e1 = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(calendarEvents).values(v({ id: e1, userId, organizationId: org, title: "A", startAt: new Date("2026-06-02"), matterId: mId }));
    await db.insert(calendarEvents).values(v({ id: uuidv7(), userId, organizationId: org, title: "B", startAt: new Date("2026-06-01") }));
    await db.insert(calendarEvents).values(v({ id: uuidv7(), userId: other, organizationId: org, title: "C", startAt: new Date("2026-06-03"), matterId: mId }));
    const repo = new DrizzleCalendarEventRepository(handle.db);
    expect(await repo.listForUser(userId, org)).toHaveLength(2);
    expect(await repo.listForUsers([userId, other], org)).toHaveLength(3);
    expect(await repo.listForUsers([], org)).toEqual([]);
    expect(await repo.listForMatter(mId, org)).toHaveLength(2);
    expect(await repo.getOwned(e1, userId, org)).toMatchObject({ id: e1 });
    expect(await repo.getOwned(e1, other, org)).toBeNull();
    expect((await repo.getOwnedWithMatter(e1, userId, org))?.matter?.matterNumber).toBe("2026-1");
  });
});
