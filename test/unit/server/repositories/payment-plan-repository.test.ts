/**
 * PaymentPlanRepository-paritet (ADR 0020, #409 fan-out) — SAMMA kontrakt mot
 * båda impls: in-memory (LocalStore) och Drizzle (pglite). Bevisar bas-CRUD
 * (ärvd) + den entitets-specifika org-scopningen via faktura→ärende.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { contacts, invoices, matterContacts, matters, paymentPlanReminders, paymentPlans, payments } from "@/lib/server/db/schema";
import { DrizzlePaymentPlanRepository } from "@/lib/server/repositories/drizzle-payment-plan-repository";
import { InMemoryPaymentPlanRepository } from "@/lib/server/repositories/in-memory-payment-plan-repository";
import type { PaymentPlanRepository } from "@/lib/server/repositories/payment-plan-repository";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const planId = uuidv7();
const invoiceId = uuidv7();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plan = (o: Record<string, unknown> = {}): any => ({
  id: planId, invoiceId, monthlyAmount: 100_000, dayOfMonth: 15,
  startDate: new Date("2026-06-01T00:00:00.000Z"), status: "ACTIVE", ...o,
});

/** Delat kontrakt — körs identiskt mot varje backend. */
async function assertContract(repo: PaymentPlanRepository): Promise<void> {
  const created = await repo.create(plan());
  expect(created.status).toBe("ACTIVE");
  expect((created as { version?: number }).version).toBe(1);

  expect(await repo.getById(asId<"PaymentPlanId">(planId))).toMatchObject({ id: planId });
  expect(await repo.getById(asId<"PaymentPlanId">(uuidv7()))).toBeNull();

  const updated = await repo.update(asId<"PaymentPlanId">(planId), { status: "CANCELLED" });
  expect(updated.status).toBe("CANCELLED");
  expect((updated as { version?: number }).version).toBe(2);

  await repo.softDelete(asId<"PaymentPlanId">(planId));
  expect(await repo.getById(asId<"PaymentPlanId">(planId))).toBeNull();

  // hardDelete (ADR 0017-undantag, används av createPaymentPlan): raden försvinner helt.
  const hardId = uuidv7();
  await repo.create(plan({ id: hardId }));
  expect(await repo.getById(asId<"PaymentPlanId">(hardId))).toMatchObject({ id: hardId });
  await repo.hardDelete(asId<"PaymentPlanId">(hardId));
  expect(await repo.getById(asId<"PaymentPlanId">(hardId))).toBeNull();
}

describe("PaymentPlanRepository — in-memory", () => {
  it("uppfyller kontraktet", async () => {
    const store = new LocalStore({ paymentPlans: [] }, async () => {});
    await assertContract(new InMemoryPaymentPlanRepository(store));
  });

  it("getByIdInOrg org-scopar via faktura→ärende", async () => {
    const matterId = uuidv7();
    const store = new LocalStore({
      matters: [{ id: matterId, organizationId: "org-1" }],
      invoices: [{ id: invoiceId, matterId, amount: 1, status: "INSTALLMENT_PLAN" }],
      paymentPlans: [plan({ id: planId, invoiceId })],
    }, async () => {});
    const repo = new InMemoryPaymentPlanRepository(store);
    expect(await repo.getByIdInOrg(asId<"PaymentPlanId">(planId), asId<"OrganizationId">("org-1"))).toMatchObject({ id: planId });
    expect(await repo.getByIdInOrg(asId<"PaymentPlanId">(planId), asId<"OrganizationId">("org-2"))).toBeNull(); // fel org
  });

  it("getByInvoiceId hämtar planen för en faktura", async () => {
    const store = new LocalStore({ paymentPlans: [plan({ id: planId, invoiceId })] }, async () => {});
    const repo = new InMemoryPaymentPlanRepository(store);
    expect(await repo.getByInvoiceId(asId<"InvoiceId">(invoiceId))).toMatchObject({ id: planId });
    expect(await repo.getByInvoiceId(asId<"InvoiceId">(uuidv7()))).toBeNull(); // ingen plan
  });

  it("listForOrg/getByIdWithDetails/listActiveForScan joinar faktura+KLIENT+påminnelser", async () => {
    const matterId = uuidv7();
    const cId = uuidv7();
    const store = new LocalStore({
      matters: [{ id: matterId, organizationId: "org-1", matterNumber: "2026-1", title: "T" }],
      contacts: [{ id: cId, organizationId: "org-1", name: "Klient AB", email: "k@x.se" }],
      matterContacts: [{ id: uuidv7(), matterId, contactId: cId, role: "KLIENT" }],
      invoices: [{ id: invoiceId, matterId, amount: 1000, status: "INSTALLMENT_PLAN" }],
      payments: [{ id: uuidv7(), invoiceId, amount: 200, paidAt: new Date("2026-06-10") }],
      paymentPlans: [plan({ id: planId, invoiceId, status: "ACTIVE" })],
      paymentPlanReminders: [{ id: uuidv7(), planId, dueMonth: "2026-06", type: "DUE", sentAt: new Date() }],
    }, async () => {});
    const repo = new InMemoryPaymentPlanRepository(store);

    const list = await repo.listForOrg(asId<"OrganizationId">("org-1"));
    expect(list).toHaveLength(1);
    expect(list[0]!.invoice?.matter?.contacts[0]?.contact.name).toBe("Klient AB");
    expect(list[0]!.invoice?.payments[0]?.amount).toBe(200);
    expect(await repo.listForOrg(asId<"OrganizationId">("org-2"))).toHaveLength(0);

    const detail = await repo.getByIdWithDetails(asId<"PaymentPlanId">(planId), asId<"OrganizationId">("org-1"));
    expect(detail?.reminders[0]?.dueMonth).toBe("2026-06");

    const scan = await repo.listActiveForScan(asId<"OrganizationId">("org-1"));
    expect(scan).toHaveLength(1);
    expect(scan[0]!.invoice?.matter?.contacts[0]?.contact.email).toBe("k@x.se");
    expect(scan[0]!.reminders).toHaveLength(1);
  });
});

describe("PaymentPlanRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("uppfyller kontraktet", async () => {
    await assertContract(new DrizzlePaymentPlanRepository(handle.db));
  });

  it("getByIdInOrg org-scopar via join faktura→ärende", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const invId = uuidv7();
    const pId = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(invoices).values(v({ id: invId, matterId: mId, amount: 1, status: "INSTALLMENT_PLAN", invoiceDate: new Date() }));
    await db.insert(paymentPlans).values(v({ id: pId, invoiceId: invId, monthlyAmount: 100, dayOfMonth: 15, startDate: new Date(), status: "ACTIVE" }));

    const repo = new DrizzlePaymentPlanRepository(handle.db);
    expect(await repo.getByIdInOrg(asId<"PaymentPlanId">(pId), asId<"OrganizationId">(org))).toMatchObject({ id: pId });
    expect(await repo.getByIdInOrg(asId<"PaymentPlanId">(pId), asId<"OrganizationId">(uuidv7()))).toBeNull(); // fel org
  });

  it("getByInvoiceId hämtar planen för en faktura", async () => {
    const db = handle.db;
    const invId = uuidv7();
    const pId = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(paymentPlans).values(v({ id: pId, invoiceId: invId, monthlyAmount: 100, dayOfMonth: 15, startDate: new Date(), status: "ACTIVE" }));
    const repo = new DrizzlePaymentPlanRepository(handle.db);
    expect(await repo.getByInvoiceId(asId<"InvoiceId">(invId))).toMatchObject({ id: pId });
    expect(await repo.getByInvoiceId(asId<"InvoiceId">(uuidv7()))).toBeNull(); // ingen plan
  });

  it("listForOrg/getByIdWithDetails/listActiveForScan joinar faktura+KLIENT+påminnelser", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const cId = uuidv7();
    const invId = uuidv7();
    const pId = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(contacts).values(v({ id: cId, organizationId: org, name: "Klient AB", contactType: "COMPANY", email: "k@x.se" }));
    await db.insert(matterContacts).values(v({ id: uuidv7(), matterId: mId, contactId: cId, role: "KLIENT" }));
    await db.insert(invoices).values(v({ id: invId, matterId: mId, amount: 1000, status: "INSTALLMENT_PLAN", invoiceDate: new Date() }));
    await db.insert(payments).values(v({ id: uuidv7(), invoiceId: invId, amount: 200, paidAt: new Date("2026-06-10"), recordedById: uuidv7() }));
    await db.insert(paymentPlans).values(v({ id: pId, invoiceId: invId, monthlyAmount: 100, dayOfMonth: 15, startDate: new Date(), status: "ACTIVE" }));
    await db.insert(paymentPlanReminders).values(v({ id: uuidv7(), planId: pId, dueMonth: "2026-06", type: "DUE", sentAt: new Date() }));
    const repo = new DrizzlePaymentPlanRepository(handle.db);

    const list = await repo.listForOrg(asId<"OrganizationId">(org));
    expect(list).toHaveLength(1);
    expect(list[0]!.invoice?.matter?.contacts[0]?.contact.name).toBe("Klient AB");
    expect(list[0]!.invoice?.payments[0]?.amount).toBe(200);
    expect(await repo.listForOrg(asId<"OrganizationId">(uuidv7()))).toHaveLength(0);

    const detail = await repo.getByIdWithDetails(asId<"PaymentPlanId">(pId), asId<"OrganizationId">(org));
    expect(detail?.reminders[0]?.dueMonth).toBe("2026-06");

    const scan = await repo.listActiveForScan(asId<"OrganizationId">(org));
    expect(scan).toHaveLength(1);
    expect(scan[0]!.invoice?.matter?.contacts[0]?.contact.email).toBe("k@x.se");
    expect(scan[0]!.reminders).toHaveLength(1);
  });
});
