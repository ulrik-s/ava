/**
 * Paritet (ADR 0020) för rapport-läsningarna: TimeEntry.listForLawyerInPeriod/
 * listBillableForOrg, Expense.listForLawyerInPeriod, Payment/WriteOff.listByInvoiceIds.
 * in-memory (LocalStore) + Drizzle (pglite).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { contacts, expenses, invoices, matterContacts, matters, payments, timeEntries, users, writeOffs } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { DrizzleExpenseRepository } from "@/lib/server/repositories/drizzle-expense-repository";
import { DrizzlePaymentRepository } from "@/lib/server/repositories/drizzle-payment-repository";
import { DrizzleTimeEntryRepository } from "@/lib/server/repositories/drizzle-time-entry-repository";
import { DrizzleWriteOffRepository } from "@/lib/server/repositories/drizzle-write-off-repository";
import { InMemoryExpenseRepository } from "@/lib/server/repositories/in-memory-expense-repository";
import { InMemoryPaymentRepository } from "@/lib/server/repositories/in-memory-payment-repository";
import { InMemoryTimeEntryRepository } from "@/lib/server/repositories/in-memory-time-entry-repository";
import { InMemoryWriteOffRepository } from "@/lib/server/repositories/in-memory-write-off-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = "55555555-5555-7555-8555-555555555555";
const FROM = new Date("2026-06-01");
const TO = new Date("2026-06-30T23:59:59.999Z");

describe("Report-läsningar — in-memory", () => {
  it("listForLawyerInPeriod (time+expense, KLIENT) + listBillableForOrg + listByInvoiceIds", async () => {
    const mId = uuidv7();
    const uId = uuidv7();
    const cId = uuidv7();
    const invId = uuidv7();
    const source = prebakeJoins({
      matters: [{ id: mId, organizationId: ORG, matterNumber: "2026-1", title: "T", paymentMethod: "RATTSHJALP", paymentMethodNote: "Dnr 1" }],
      users: [{ id: uId, name: "Anna" }],
      contacts: [{ id: cId, organizationId: ORG, name: "Klient AB" }],
      matterContacts: [{ id: uuidv7(), matterId: mId, contactId: cId, role: "KLIENT" }],
      invoices: [{ id: invId, matterId: mId, amount: 1000, status: "SENT" }],
      timeEntries: [
        { id: uuidv7(), userId: uId, matterId: mId, minutes: 60, billable: true, hourlyRate: 1000, date: new Date("2026-06-10") },
        { id: uuidv7(), userId: uId, matterId: mId, minutes: 30, billable: false, hourlyRate: 1000, date: new Date("2026-06-11") },
        { id: uuidv7(), userId: uId, matterId: mId, minutes: 99, billable: true, hourlyRate: 1000, date: new Date("2026-01-01") },
      ],
      expenses: [{ id: uuidv7(), userId: uId, matterId: mId, amount: 500, billable: true, date: new Date("2026-06-12") }],
      payments: [{ id: uuidv7(), invoiceId: invId, amount: 200 }],
      writeOffs: [{ id: uuidv7(), invoiceId: invId, amount: 100, writtenOffAt: new Date("2026-06-20") }],
    } as DemoSource);
    const store = new LocalStore(source, async () => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const te = new InMemoryTimeEntryRepository(store as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ex = new InMemoryExpenseRepository(store as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pay = new InMemoryPaymentRepository(store as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wo = new InMemoryWriteOffRepository(store as any);

    const lawyerTime = await te.listForLawyerInPeriod(ORG, uId, FROM, TO);
    expect(lawyerTime).toHaveLength(2); // jan-posten utanför perioden
    expect(lawyerTime[0]!.matter?.paymentMethod).toBe("RATTSHJALP");
    expect(lawyerTime[0]!.matter?.contacts[0]?.contact.name).toBe("Klient AB");
    expect((await te.listBillableForOrg(ORG)).length).toBe(2); // 2 billable totalt
    expect(await ex.listForLawyerInPeriod(ORG, uId, FROM, TO)).toHaveLength(1);
    expect((await pay.listByInvoiceIds([invId]))[0]!.amount).toBe(200);
    expect(await pay.listByInvoiceIds([])).toHaveLength(0);
    expect((await wo.listByInvoiceIds([invId]))[0]!.amount).toBe(100);
  });
});

describe("Report-läsningar — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listForLawyerInPeriod (time+expense, KLIENT) + listBillableForOrg + listByInvoiceIds", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const uId = uuidv7();
    const cId = uuidv7();
    const invId = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T", paymentMethod: "RATTSHJALP", paymentMethodNote: "Dnr 1" }));
    await db.insert(users).values(v({ id: uId, organizationId: org, email: "a@x", name: "Anna" }));
    await db.insert(contacts).values(v({ id: cId, organizationId: org, name: "Klient AB", contactType: "COMPANY" }));
    await db.insert(matterContacts).values(v({ id: uuidv7(), matterId: mId, contactId: cId, role: "KLIENT" }));
    await db.insert(invoices).values(v({ id: invId, matterId: mId, amount: 1000, status: "SENT", invoiceDate: new Date() }));
    await db.insert(timeEntries).values(v({ id: uuidv7(), userId: uId, matterId: mId, minutes: 60, billable: true, hourlyRate: 1000, description: "a", date: new Date("2026-06-10") }));
    await db.insert(timeEntries).values(v({ id: uuidv7(), userId: uId, matterId: mId, minutes: 30, billable: false, hourlyRate: 1000, description: "b", date: new Date("2026-06-11") }));
    await db.insert(timeEntries).values(v({ id: uuidv7(), userId: uId, matterId: mId, minutes: 99, billable: true, hourlyRate: 1000, description: "c", date: new Date("2026-01-01") }));
    await db.insert(expenses).values(v({ id: uuidv7(), userId: uId, matterId: mId, amount: 500, billable: true, description: "e", date: new Date("2026-06-12"), vatRate: 0, vatIncluded: false }));
    await db.insert(payments).values(v({ id: uuidv7(), invoiceId: invId, amount: 200, paidAt: new Date(), recordedById: uId }));
    await db.insert(writeOffs).values(v({ id: uuidv7(), invoiceId: invId, amount: 100, writtenOffAt: new Date("2026-06-20"), recordedById: uId }));
    const te = new DrizzleTimeEntryRepository(db as unknown as AppDb);
    const ex = new DrizzleExpenseRepository(db as unknown as AppDb);
    const pay = new DrizzlePaymentRepository(db as unknown as AppDb);
    const wo = new DrizzleWriteOffRepository(db as unknown as AppDb);

    const lawyerTime = await te.listForLawyerInPeriod(org, uId, FROM, TO);
    expect(lawyerTime).toHaveLength(2);
    expect(lawyerTime[0]!.matter?.paymentMethod).toBe("RATTSHJALP");
    expect(lawyerTime[0]!.matter?.contacts[0]?.contact.name).toBe("Klient AB");
    expect((await te.listBillableForOrg(org)).length).toBe(2);
    expect(await ex.listForLawyerInPeriod(org, uId, FROM, TO)).toHaveLength(1);
    expect((await pay.listByInvoiceIds([invId]))[0]!.amount).toBe(200);
    expect(await pay.listByInvoiceIds([])).toHaveLength(0);
    expect((await wo.listByInvoiceIds([invId]))[0]!.amount).toBe(100);
  });
});
