/**
 * TimeEntryRepository-paritet (ADR 0020, #409 fan-out) — in-memory + Drizzle
 * (pglite). `listUnbilled` (med user.hourlyRate) + `flagBilled` (bulk-koppling).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { contacts, matterContacts, matters, timeEntries, users } from "@/lib/server/db/schema";
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

// ─── Frysning + perLawyer-period + listBillableForOrg (#27: otäckta metoder) ───

const ORG = "77777777-7777-7777-8777-777777777777";

// Delad fixtur: ett ärende (org), en jurist, en KLIENT-kontakt; 5 tidsposter
// (juni-period + en i maj utanför, en fryst, en icke-debiterbar).
function teFixture() {
  const mId = uuidv7(), uId = uuidv7(), cKli = uuidv7();
  const teEarly = uuidv7(), teLate = uuidv7(), teFrozen = uuidv7(), teOutside = uuidv7(), teNonBill = uuidv7();
  const rows = [
    { id: teLate, userId: uId, matterId: mId, minutes: 60, date: new Date("2026-06-10"), description: "sen", billable: true, frozenByBillingRunId: null },
    { id: teEarly, userId: uId, matterId: mId, minutes: 30, date: new Date("2026-06-01"), description: "tidig", billable: true, frozenByBillingRunId: null },
    { id: teFrozen, userId: uId, matterId: mId, minutes: 45, date: new Date("2026-06-05"), description: "fryst", billable: true, frozenByBillingRunId: uuidv7() },
    { id: teOutside, userId: uId, matterId: mId, minutes: 20, date: new Date("2026-05-01"), description: "maj", billable: true, frozenByBillingRunId: null },
    { id: teNonBill, userId: uId, matterId: mId, minutes: 15, date: new Date("2026-06-02"), description: "ej deb", billable: false, frozenByBillingRunId: null },
  ];
  return { mId, uId, cKli, teEarly, teLate, teFrozen, teOutside, teNonBill, rows };
}

describe("TimeEntryRepository — frysning/perLawyer/billable (in-memory)", () => {
  it("listUnfrozenForMatter + listForLawyerInPeriod + listBillableForOrg + freezeForMatter", async () => {
    const f = teFixture();
    const store = new LocalStore({
      matters: [{ id: f.mId, organizationId: ORG, matterNumber: "2026-1", title: "T" }],
      users: [{ id: f.uId, name: "Anna" }],
      contacts: [{ id: f.cKli, organizationId: ORG, name: "Klient AB", contactType: "COMPANY" }],
      matterContacts: [{ id: uuidv7(), matterId: f.mId, contactId: f.cKli, role: "KLIENT" }],
      timeEntries: f.rows,
    }, async () => {});
    const repo = new InMemoryTimeEntryRepository(store);

    // listUnfrozenForMatter: alla ofrysta (oavsett billable), date asc; ej den frusna.
    expect((await repo.listUnfrozenForMatter(f.mId)).map((t) => t.id))
      .toEqual([f.teOutside, f.teEarly, f.teNonBill, f.teLate]);

    // listForLawyerInPeriod: juni → exkl maj, date asc, med KLIENT-namn.
    const period = await repo.listForLawyerInPeriod(ORG, f.uId, new Date("2026-06-01"), new Date("2026-06-30"));
    expect(period.map((t) => t.id)).toEqual([f.teEarly, f.teNonBill, f.teFrozen, f.teLate]);
    expect(period[0]!.matter?.contacts[0]?.contact.name).toBe("Klient AB");

    // listBillableForOrg: bara billable i org (ej teNonBill).
    expect((await repo.listBillableForOrg(ORG)).map((t) => t.id).sort())
      .toEqual([f.teEarly, f.teLate, f.teFrozen, f.teOutside].sort());

    // freezeForMatter: fryser alla ofrysta → inga ofrysta kvar.
    await repo.freezeForMatter(f.mId, uuidv7(), new Date("2026-06-30"));
    expect(await repo.listUnfrozenForMatter(f.mId)).toHaveLength(0);
  });
});

describe("TimeEntryRepository — frysning/perLawyer/billable (Drizzle/pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listUnfrozenForMatter + listForLawyerInPeriod + listBillableForOrg + freezeForMatter", async () => {
    const db = handle.db;
    const f = teFixture();
    const org = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: f.mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(users).values(v({ id: f.uId, organizationId: org, email: "a@x", name: "Anna" }));
    await db.insert(contacts).values(v({ id: f.cKli, organizationId: org, name: "Klient AB", contactType: "COMPANY" }));
    await db.insert(matterContacts).values(v({ id: uuidv7(), matterId: f.mId, contactId: f.cKli, role: "KLIENT" }));
    for (const r of f.rows) await db.insert(timeEntries).values(v({ ...r, organizationId: org, hourlyRate: 1000 }));
    const repo = new DrizzleTimeEntryRepository(db as unknown as AppDb);

    expect((await repo.listUnfrozenForMatter(f.mId)).map((t) => t.id))
      .toEqual([f.teOutside, f.teEarly, f.teNonBill, f.teLate]);

    const period = await repo.listForLawyerInPeriod(org, f.uId, new Date("2026-06-01"), new Date("2026-06-30"));
    expect(period.map((t) => t.id)).toEqual([f.teEarly, f.teNonBill, f.teFrozen, f.teLate]);
    expect(period[0]!.matter?.contacts[0]?.contact.name).toBe("Klient AB");

    expect((await repo.listBillableForOrg(org)).map((t) => t.id).sort())
      .toEqual([f.teEarly, f.teLate, f.teFrozen, f.teOutside].sort());

    await repo.freezeForMatter(f.mId, uuidv7(), new Date("2026-06-30"));
    expect(await repo.listUnfrozenForMatter(f.mId)).toHaveLength(0);
  });
});
