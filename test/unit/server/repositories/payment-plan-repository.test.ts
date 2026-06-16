/**
 * PaymentPlanRepository-paritet (ADR 0020, #409 fan-out) — SAMMA kontrakt mot
 * båda impls: in-memory (LocalStore) och Drizzle (pglite). Bevisar bas-CRUD
 * (ärvd) + den entitets-specifika org-scopningen via faktura→ärende.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { invoices, matters, paymentPlans } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { DrizzlePaymentPlanRepository } from "@/lib/server/repositories/drizzle-payment-plan-repository";
import { InMemoryPaymentPlanRepository } from "@/lib/server/repositories/in-memory-payment-plan-repository";
import type { PaymentPlanRepository } from "@/lib/server/repositories/payment-plan-repository";
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

  expect(await repo.getById(planId)).toMatchObject({ id: planId });
  expect(await repo.getById(uuidv7())).toBeNull();

  const updated = await repo.update(planId, { status: "CANCELLED" });
  expect(updated.status).toBe("CANCELLED");
  expect((updated as { version?: number }).version).toBe(2);

  await repo.softDelete(planId);
  expect(await repo.getById(planId)).toBeNull();
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
    expect(await repo.getByIdInOrg(planId, "org-1")).toMatchObject({ id: planId });
    expect(await repo.getByIdInOrg(planId, "org-2")).toBeNull(); // fel org
  });

  it("getByInvoiceId hämtar planen för en faktura", async () => {
    const store = new LocalStore({ paymentPlans: [plan({ id: planId, invoiceId })] }, async () => {});
    const repo = new InMemoryPaymentPlanRepository(store);
    expect(await repo.getByInvoiceId(invoiceId)).toMatchObject({ id: planId });
    expect(await repo.getByInvoiceId(uuidv7())).toBeNull(); // ingen plan
  });
});

describe("PaymentPlanRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("uppfyller kontraktet", async () => {
    await assertContract(new DrizzlePaymentPlanRepository(handle.db as unknown as AppDb));
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

    const repo = new DrizzlePaymentPlanRepository(handle.db as unknown as AppDb);
    expect(await repo.getByIdInOrg(pId, org)).toMatchObject({ id: pId });
    expect(await repo.getByIdInOrg(pId, uuidv7())).toBeNull(); // fel org
  });

  it("getByInvoiceId hämtar planen för en faktura", async () => {
    const db = handle.db;
    const invId = uuidv7();
    const pId = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(paymentPlans).values(v({ id: pId, invoiceId: invId, monthlyAmount: 100, dayOfMonth: 15, startDate: new Date(), status: "ACTIVE" }));
    const repo = new DrizzlePaymentPlanRepository(handle.db as unknown as AppDb);
    expect(await repo.getByInvoiceId(invId)).toMatchObject({ id: pId });
    expect(await repo.getByInvoiceId(uuidv7())).toBeNull(); // ingen plan
  });
});
