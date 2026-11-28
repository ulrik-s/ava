/**
 * PaymentRepository-paritet (ADR 0020, #409 fan-out) — SAMMA kontrakt mot båda
 * impls: in-memory (LocalStore) och Drizzle (pglite). Bas-CRUD (ärvd) +
 * `sumByInvoice` (betalt-hinken för fakturans ledger).
 */

import { sql } from "drizzle-orm";
import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { z } from "zod";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { payments } from "@/lib/server/db/schema";
import { DrizzlePaymentRepository } from "@/lib/server/repositories/drizzle-payment-repository";
import { InMemoryPaymentRepository } from "@/lib/server/repositories/in-memory-payment-repository";
import { asId } from "@/lib/shared/schemas/ids";
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
    expect(await repo.sumByInvoice(asId<"InvoiceId">(invoiceId))).toBe(50_000);
    expect(await repo.sumByInvoice(asId<"InvoiceId">(uuidv7()))).toBe(0); // ingen betalning
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
    expect(await repo.sumByInvoice(asId<"InvoiceId">(invoiceId))).toBe(50_000);
    expect(await repo.sumByInvoice(asId<"InvoiceId">(uuidv7()))).toBe(0);
    // Kontroll att raderna skrevs (sanity för pglite-insert).
    expect((await handle.db.select().from(payments)).length).toBeGreaterThanOrEqual(3);
  });

  it("ledgerRef skrivs i kolumnen fortnox_id och läses tillbaka (#1932)", async () => {
    const repo = new DrizzlePaymentRepository(handle.db);
    const id = asId<"PaymentId">(uuidv7());
    await repo.create({ id, invoiceId: uuidv7(), amount: 1_000, paidAt: new Date(), recordedById: uuidv7() } as never);
    await repo.update(id, { ledgerRef: "A/43" });
    const column = z.object({ ref: z.string().nullable() });
    const parsed = z.union([z.array(column), z.object({ rows: z.array(column) })])
      .parse(await handle.db.execute(sql`SELECT fortnox_id AS ref FROM payments WHERE id = ${id}`));
    expect((Array.isArray(parsed) ? parsed : parsed.rows)[0]?.ref).toBe("A/43");
    expect((await repo.getById(id))?.ledgerRef).toBe("A/43");
  });
});
