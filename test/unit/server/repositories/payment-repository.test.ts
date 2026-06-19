/**
 * PaymentRepository-paritet (ADR 0020, #409 fan-out) — SAMMA kontrakt mot båda
 * impls: in-memory (LocalStore) och Drizzle (pglite). Bas-CRUD (ärvd) +
 * `sumByInvoice` (betalt-hinken för fakturans ledger).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { payments } from "@/lib/server/db/schema";
import { DrizzlePaymentRepository } from "@/lib/server/repositories/drizzle-payment-repository";
import { InMemoryPaymentRepository } from "@/lib/server/repositories/in-memory-payment-repository";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("PaymentRepository — in-memory", () => {
  it("create + sumByInvoice summerar per faktura", async () => {
    const invoiceId = uuidv7();
    const store = new LocalStore({ payments: [] }, async () => {});
    const repo = new InMemoryPaymentRepository(store);
    await repo.create({ id: uuidv7(), invoiceId, amount: 30_000, paidAt: new Date(), recordedById: uuidv7() } as never);
    await repo.create({ id: uuidv7(), invoiceId, amount: 20_000, paidAt: new Date(), recordedById: uuidv7() } as never);
    await repo.create({ id: uuidv7(), invoiceId: uuidv7(), amount: 99_000, paidAt: new Date(), recordedById: uuidv7() } as never);
    expect(await repo.sumByInvoice(invoiceId)).toBe(50_000);
    expect(await repo.sumByInvoice(uuidv7())).toBe(0); // ingen betalning
  });
});

describe("PaymentRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("create + sumByInvoice summerar i SQL", async () => {
    const invoiceId = uuidv7();
    const repo = new DrizzlePaymentRepository(handle.db);
    await repo.create({ id: uuidv7(), invoiceId, amount: 30_000, paidAt: new Date(), recordedById: uuidv7() } as never);
    await repo.create({ id: uuidv7(), invoiceId, amount: 20_000, paidAt: new Date(), recordedById: uuidv7() } as never);
    await repo.create({ id: uuidv7(), invoiceId: uuidv7(), amount: 99_000, paidAt: new Date(), recordedById: uuidv7() } as never);
    expect(await repo.sumByInvoice(invoiceId)).toBe(50_000);
    expect(await repo.sumByInvoice(uuidv7())).toBe(0);
    // Kontroll att raderna skrevs (sanity för pglite-insert).
    expect((await handle.db.select().from(payments)).length).toBeGreaterThanOrEqual(3);
  });
});
