/**
 * ExpenseRepository-paritet (ADR 0020, #409 fan-out) — in-memory + Drizzle
 * (pglite). `listUnbilled` + `flagBilled` (bulk-koppling).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { contacts, expenses, matterContacts, matters, users } from "@/lib/server/db/schema";
import { DrizzleExpenseRepository } from "@/lib/server/repositories/drizzle-expense-repository";
import { InMemoryExpenseRepository } from "@/lib/server/repositories/in-memory-expense-repository";
import { asId } from "@/lib/shared/schemas/ids";
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

    expect(await repo.listUnbilled(asId<"MatterId">(matterId), [asId<"ExpenseId">(e1), asId<"ExpenseId">(e2)])).toHaveLength(2);
    expect(await repo.listUnbilled(asId<"MatterId">(matterId), [])).toEqual([]);

    await repo.flagBilled([asId<"ExpenseId">(e1)], asId<"InvoiceId">(uuidv7()));
    expect(await repo.listUnbilled(asId<"MatterId">(matterId), [asId<"ExpenseId">(e1), asId<"ExpenseId">(e2)])).toHaveLength(1); // e1 nu fakturerad
  });

  it("listForOrg paginerar, summerar och inkluderar relationer", async () => {
    const mId = uuidv7();
    const userId = uuidv7();
    const store = new LocalStore({
      matters: [{ id: mId, organizationId: "org-1", matterNumber: "2026-1", title: "T" }],
      users: [{ id: userId, name: "Anna" }],
      expenses: [
        { id: uuidv7(), userId, matterId: mId, amount: 50_000, date: new Date("2026-06-02"), description: "a", billable: true, invoiceId: null },
        { id: uuidv7(), userId, matterId: mId, amount: 30_000, date: new Date("2026-06-01"), description: "b", billable: true, invoiceId: null },
      ],
    }, async () => {});
    const repo = new InMemoryExpenseRepository(store);
    const res = await repo.listForOrg(asId<"OrganizationId">("org-1"), { page: 1, pageSize: 50 });
    expect(res.total).toBe(2);
    expect(res.totalAmount).toBe(80_000);
    expect(res.expenses[0]!.matter?.matterNumber).toBe("2026-1");
    expect(res.expenses[0]!.user?.name).toBe("Anna");
    expect((await repo.listForOrg(asId<"OrganizationId">("org-2"), { page: 1, pageSize: 50 })).total).toBe(0); // fel org
  });

  it("getByIdInOrg org-scopar via ärendet", async () => {
    const mId = uuidv7();
    const eId = uuidv7();
    const store = new LocalStore({
      matters: [{ id: mId, organizationId: "org-1" }],
      expenses: [{ id: eId, matterId: mId, amount: 1, date: new Date(), description: "x" }],
    }, async () => {});
    const repo = new InMemoryExpenseRepository(store);
    expect(await repo.getByIdInOrg(asId<"ExpenseId">(eId), asId<"OrganizationId">("org-1"))).toMatchObject({ id: eId });
    expect(await repo.getByIdInOrg(asId<"ExpenseId">(eId), asId<"OrganizationId">("org-2"))).toBeNull(); // fel org
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
    const repo = new DrizzleExpenseRepository(handle.db);

    expect(await repo.listUnbilled(asId<"MatterId">(mId), [asId<"ExpenseId">(e1), asId<"ExpenseId">(e2)])).toHaveLength(2);
    await repo.flagBilled([asId<"ExpenseId">(e1)], asId<"InvoiceId">(uuidv7()));
    expect(await repo.listUnbilled(asId<"MatterId">(mId), [asId<"ExpenseId">(e1), asId<"ExpenseId">(e2)])).toHaveLength(1);
  });

  it("listForOrg joinar relationer + summerar i SQL", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const userId = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(users).values(v({ id: userId, organizationId: org, email: "a@x", name: "Anna" }));
    await db.insert(expenses).values(v({ id: uuidv7(), userId, matterId: mId, date: new Date("2026-06-02"), amount: 50_000, description: "a" }));
    await db.insert(expenses).values(v({ id: uuidv7(), userId, matterId: mId, date: new Date("2026-06-01"), amount: 30_000, description: "b" }));
    const repo = new DrizzleExpenseRepository(handle.db);
    const res = await repo.listForOrg(asId<"OrganizationId">(org), { page: 1, pageSize: 50 });
    expect(res.total).toBe(2);
    expect(res.totalAmount).toBe(80_000);
    expect(res.expenses[0]!.matter?.matterNumber).toBe("2026-1");
    expect(res.expenses[0]!.user?.name).toBe("Anna");
    expect(res.expenses[0]!.amount).toBe(50_000); // nyaste först (date desc)
  });

  it("getByIdInOrg org-scopar via join mot matters", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const userId = uuidv7();
    const eId = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(users).values(v({ id: userId, organizationId: org, email: "a@x", name: "Anna" }));
    await db.insert(expenses).values(v({ id: eId, userId, matterId: mId, date: new Date(), amount: 1, description: "x" }));
    const repo = new DrizzleExpenseRepository(handle.db);
    expect(await repo.getByIdInOrg(asId<"ExpenseId">(eId), asId<"OrganizationId">(org))).toMatchObject({ id: eId });
    expect(await repo.getByIdInOrg(asId<"ExpenseId">(eId), asId<"OrganizationId">(uuidv7()))).toBeNull();
  });
});

// ─── Billing-run-frysning + perLawyer-period (#27: tidigare otäckta metoder) ───

describe("ExpenseRepository — frysning + perLawyer-period (in-memory)", () => {
  it("listUnfrozenForMatter + freezeForMatter + listForLawyerInPeriod", async () => {
    const mId = uuidv7();
    const uId = uuidv7();
    const cKli = uuidv7();
    const eEarly = uuidv7(), eLate = uuidv7(), eFrozen = uuidv7(), eOutside = uuidv7();
    const store = new LocalStore({
      matters: [{ id: mId, organizationId: "org-1", matterNumber: "2026-1", title: "T", paymentMethod: "PRIVAT" }],
      users: [{ id: uId, name: "Anna" }],
      contacts: [{ id: cKli, organizationId: "org-1", name: "Klient AB", contactType: "COMPANY" }],
      matterContacts: [{ id: uuidv7(), matterId: mId, contactId: cKli, role: "KLIENT" }],
      expenses: [
        { id: eLate, userId: uId, matterId: mId, amount: 200, date: new Date("2026-06-10"), description: "sen", frozenByBillingRunId: null },
        { id: eEarly, userId: uId, matterId: mId, amount: 100, date: new Date("2026-06-01"), description: "tidig", frozenByBillingRunId: null },
        { id: eFrozen, userId: uId, matterId: mId, amount: 300, date: new Date("2026-06-05"), description: "fryst", frozenByBillingRunId: uuidv7() },
        { id: eOutside, userId: uId, matterId: mId, amount: 400, date: new Date("2026-05-01"), description: "utanför period", frozenByBillingRunId: null },
      ],
    }, async () => {});
    const repo = new InMemoryExpenseRepository(store);

    // listUnfrozenForMatter: bara de ofrysta, date asc (ej den frusna)
    const unfrozen = await repo.listUnfrozenForMatter(asId<"MatterId">(mId));
    expect(unfrozen.map((e) => e.id)).toEqual([eOutside, eEarly, eLate]); // 2026-05-01 < 06-01 < 06-10

    // freezeForMatter: fryser alla ofrysta → inga ofrysta kvar
    await repo.freezeForMatter(asId<"MatterId">(mId), asId<"BillingRunId">(uuidv7()), new Date("2026-06-30"));
    expect(await repo.listUnfrozenForMatter(asId<"MatterId">(mId))).toHaveLength(0);

    // listForLawyerInPeriod: juni-perioden, date asc, med KLIENT-namn på ärendet
    const rows = await repo.listForLawyerInPeriod(asId<"OrganizationId">("org-1"), asId<"UserId">(uId), new Date("2026-06-01"), new Date("2026-06-30"));
    expect(rows.map((e) => e.id)).toEqual([eEarly, eFrozen, eLate]); // eOutside (maj) exkluderas
    expect(rows[0]!.matter?.contacts[0]?.contact.name).toBe("Klient AB");
  });
});

describe("ExpenseRepository — frysning + perLawyer-period (Drizzle/pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listUnfrozenForMatter + freezeForMatter + listForLawyerInPeriod", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const uId = uuidv7();
    const cKli = uuidv7();
    const eEarly = uuidv7(), eLate = uuidv7(), eFrozen = uuidv7(), eOutside = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T", paymentMethod: "PRIVAT" }));
    await db.insert(users).values(v({ id: uId, organizationId: org, email: "a@x", name: "Anna" }));
    await db.insert(contacts).values(v({ id: cKli, organizationId: org, name: "Klient AB", contactType: "COMPANY" }));
    await db.insert(matterContacts).values(v({ id: uuidv7(), matterId: mId, contactId: cKli, role: "KLIENT" }));
    await db.insert(expenses).values(v({ id: eLate, userId: uId, matterId: mId, amount: 200, date: new Date("2026-06-10"), description: "sen" }));
    await db.insert(expenses).values(v({ id: eEarly, userId: uId, matterId: mId, amount: 100, date: new Date("2026-06-01"), description: "tidig" }));
    await db.insert(expenses).values(v({ id: eFrozen, userId: uId, matterId: mId, amount: 300, date: new Date("2026-06-05"), description: "fryst", frozenByBillingRunId: uuidv7() }));
    await db.insert(expenses).values(v({ id: eOutside, userId: uId, matterId: mId, amount: 400, date: new Date("2026-05-01"), description: "utanför" }));
    const repo = new DrizzleExpenseRepository(db);

    // listUnfrozenForMatter: ofrysta (eLate/eEarly/eOutside), date asc
    expect((await repo.listUnfrozenForMatter(asId<"MatterId">(mId))).map((e) => e.id)).toEqual([eOutside, eEarly, eLate]);

    // freezeForMatter: fryser alla ofrysta i ärendet
    await repo.freezeForMatter(asId<"MatterId">(mId), asId<"BillingRunId">(uuidv7()), new Date("2026-06-30"));
    expect(await repo.listUnfrozenForMatter(asId<"MatterId">(mId))).toHaveLength(0);

    // listForLawyerInPeriod: juni → eEarly/eFrozen/eLate (date asc), KLIENT-namn joinas
    const rows = await repo.listForLawyerInPeriod(asId<"OrganizationId">(org), asId<"UserId">(uId), new Date("2026-06-01"), new Date("2026-06-30"));
    expect(rows.map((e) => e.id)).toEqual([eEarly, eFrozen, eLate]);
    expect(rows[0]!.matter?.contacts[0]?.contact.name).toBe("Klient AB");
    expect(rows[0]!.matter?.paymentMethod).toBe("PRIVAT");
  });
});
