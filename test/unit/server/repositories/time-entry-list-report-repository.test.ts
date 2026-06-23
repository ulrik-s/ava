/**
 * TimeEntryRepository list/report-paritet (ADR 0020) — in-memory + Drizzle (pglite).
 * listForOrg (count+summa) + getByIdInOrg + listForReport (KLIENT-kontakt).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { contacts, matterContacts, matters, timeEntries, users } from "@/lib/server/db/schema";
import { DrizzleTimeEntryRepository } from "@/lib/server/repositories/drizzle-time-entry-repository";
import { InMemoryTimeEntryRepository } from "@/lib/server/repositories/in-memory-time-entry-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("TimeEntryRepository list/report — in-memory", () => {
  it("listForOrg (summa minuter) + getByIdInOrg + listForReport (KLIENT)", async () => {
    const mId = uuidv7();
    const userId = uuidv7();
    const cId = uuidv7();
    const t1 = uuidv7();
    const source = prebakeJoins({
      matters: [{ id: mId, organizationId: "org-1", matterNumber: "2026-1", title: "T" }],
      users: [{ id: userId, name: "Anna", hourlyRate: 1000 }],
      contacts: [{ id: cId, organizationId: "org-1", name: "Klient AB" }],
      matterContacts: [{ id: uuidv7(), matterId: mId, contactId: cId, role: "KLIENT" }],
      timeEntries: [
        { id: t1, userId, matterId: mId, minutes: 60, billable: true, date: new Date("2026-06-02") },
        { id: uuidv7(), userId, matterId: mId, minutes: 30, billable: false, date: new Date("2026-06-03") },
      ],
    } as DemoSource);
    const repo = new InMemoryTimeEntryRepository(new LocalStore(source, async () => {}));

    const list = await repo.listForOrg(asId<"OrganizationId">("org-1"), { page: 1, pageSize: 50 });
    expect(list.total).toBe(2);
    expect(list.totalMinutes).toBe(90);
    expect(list.entries[0]!.matter.matterNumber).toBe("2026-1");
    expect(await repo.getByIdInOrg(asId<"TimeEntryId">(t1), asId<"OrganizationId">("org-1"))).toMatchObject({ id: t1 });
    expect(await repo.getByIdInOrg(asId<"TimeEntryId">(t1), asId<"OrganizationId">("org-2"))).toBeNull();

    const report = await repo.listForReport(asId<"OrganizationId">("org-1"), { from: new Date("2026-06-01"), to: new Date("2026-06-30") });
    expect(report).toHaveLength(2);
    expect(report[0]!.matter?.contacts[0]?.contact.name).toBe("Klient AB");
  });
});

describe("TimeEntryRepository list/report — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listForOrg + getByIdInOrg + listForReport (KLIENT via subquery)", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const userId = uuidv7();
    const cId = uuidv7();
    const t1 = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(users).values(v({ id: userId, organizationId: org, email: "a@x", name: "Anna", hourlyRate: 1000 }));
    await db.insert(contacts).values(v({ id: cId, organizationId: org, name: "Klient AB", contactType: "COMPANY" }));
    await db.insert(matterContacts).values(v({ id: uuidv7(), matterId: mId, contactId: cId, role: "KLIENT" }));
    await db.insert(timeEntries).values(v({ id: t1, userId, matterId: mId, minutes: 60, description: "a", hourlyRate: 1000, date: new Date("2026-06-02") }));
    await db.insert(timeEntries).values(v({ id: uuidv7(), userId, matterId: mId, minutes: 30, description: "b", hourlyRate: 1000, date: new Date("2026-06-03") }));
    const repo = new DrizzleTimeEntryRepository(handle.db);

    const list = await repo.listForOrg(asId<"OrganizationId">(org), { page: 1, pageSize: 50 });
    expect(list.total).toBe(2);
    expect(list.totalMinutes).toBe(90);
    expect(list.entries[0]!.matter.matterNumber).toBe("2026-1");
    expect(await repo.getByIdInOrg(asId<"TimeEntryId">(t1), asId<"OrganizationId">(org))).toMatchObject({ id: t1 });
    expect(await repo.getByIdInOrg(asId<"TimeEntryId">(t1), asId<"OrganizationId">(uuidv7()))).toBeNull();

    const report = await repo.listForReport(asId<"OrganizationId">(org), { from: new Date("2026-06-01"), to: new Date("2026-06-30") });
    expect(report).toHaveLength(2);
    expect(report[0]!.matter?.contacts[0]?.contact.name).toBe("Klient AB");
  });
});
