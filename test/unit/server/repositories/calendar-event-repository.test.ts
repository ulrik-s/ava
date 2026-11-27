/**
 * CalendarEventRepository-paritet (ADR 0020, #409 fan-out) — in-memory + Drizzle
 * (pglite). listForUser/listForUsers/listForMatter + getOwned/getOwnedWithMatter.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { calendarEvents, matters } from "@/lib/server/db/schema";
import { DrizzleCalendarEventRepository } from "@/lib/server/repositories/drizzle-calendar-event-repository";
import { InMemoryCalendarEventRepository } from "@/lib/server/repositories/in-memory-calendar-event-repository";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";
import { DRIZZLE_NAME, type OpenRepos, openDrizzleRepos, openInMemoryRepos } from "./contract-backends";

describe("CalendarEventRepository — in-memory", () => {
  it("list-varianter + ägar-vakt", async () => {
    const userId = asId<"UserId">(uuidv7());
    const other = asId<"UserId">(uuidv7());
    const mId = asId<"MatterId">(uuidv7());
    const e1 = asId<"CalendarEventId">(uuidv7());
    const org = asId<"OrganizationId">("org-1");
    const store = new LocalStore({
      matters: [{ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }],
      calendarEvents: [
        { id: e1, userId, organizationId: org, title: "A", startAt: new Date("2026-06-02"), matterId: mId },
        { id: asId<"CalendarEventId">(uuidv7()), userId, organizationId: org, title: "B", startAt: new Date("2026-06-01"), matterId: null },
        { id: asId<"CalendarEventId">(uuidv7()), userId: other, organizationId: org, title: "C", startAt: new Date("2026-06-03"), matterId: mId },
      ],
    }, async () => {});
    const repo = new InMemoryCalendarEventRepository(store);
    expect(await repo.listForUser(userId, org)).toHaveLength(2);
    expect(await repo.listForUsers([userId, other], org)).toHaveLength(3);
    expect(await repo.listForMatter(mId, org)).toHaveLength(2); // e1 + other's C
    expect(await repo.getOwned(e1, userId, org)).toMatchObject({ id: e1 });
    expect(await repo.getOwned(e1, other, org)).toBeNull(); // annan user
    expect((await repo.getOwnedWithMatter(e1, userId, org))?.matter?.matterNumber).toBe("2026-1");
  });
});

describe("CalendarEventRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("list-varianter (left-join matter) + ägar-vakt", async () => {
    const db = handle.db;
    const org = asId<"OrganizationId">(uuidv7());
    const userId = asId<"UserId">(uuidv7());
    const other = asId<"UserId">(uuidv7());
    const mId = asId<"MatterId">(uuidv7());
    const e1 = asId<"CalendarEventId">(uuidv7());
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

describe.each([
  ["in-memory", () => Promise.resolve(openInMemoryRepos())],
  [DRIZZLE_NAME, () => openDrizzleRepos()],
] as const)("CalendarEventRepository.listDeadlinesForOrg (#2121) — %s", (_name, open) => {
  let repos: OpenRepos;
  beforeEach(async () => { repos = await open(); });
  afterEach(async () => { await repos.close(); });

  it("ger byråns ej raderade frister, alla ägares, kronologiskt", async () => {
    const org = asId<"OrganizationId">(uuidv7());
    const ev = (o: Record<string, unknown>) => repos.repos.calendarEvents.create({
      id: asId<"CalendarEventId">(uuidv7()), organizationId: org, userId: asId<"UserId">(uuidv7()), kind: "deadline",
      startAt: new Date("2026-06-02T09:00:00Z"), ...o,
    } as never);
    await ev({ title: "Senare", startAt: new Date("2026-06-03T09:00:00Z") });
    await ev({ title: "Först" });
    await ev({ title: "Möte", kind: "appointment" });
    await ev({ title: "Annan byrå", organizationId: asId<"OrganizationId">(uuidv7()) });
    const gone = await ev({ title: "Raderad" });
    await repos.repos.calendarEvents.softDelete(gone.id);
    const rows = await repos.repos.calendarEvents.listDeadlinesForOrg(org);
    expect(rows.map((r) => r.title)).toEqual(["Först", "Senare"]);
  });
});
