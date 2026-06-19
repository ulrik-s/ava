/**
 * WriteOffRepository-paritet (ADR 0020, #409 fan-out) — SAMMA kontrakt mot båda
 * impls: in-memory (LocalStore) och Drizzle (pglite). Bas-CRUD (ärvd) +
 * `sumByInvoice` (avskrivet-hinken för fakturans ledger).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { DrizzleWriteOffRepository } from "@/lib/server/repositories/drizzle-write-off-repository";
import { InMemoryWriteOffRepository } from "@/lib/server/repositories/in-memory-write-off-repository";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("WriteOffRepository — in-memory", () => {
  it("create + sumByInvoice summerar per faktura", async () => {
    const invoiceId = uuidv7();
    const store = new LocalStore({ writeOffs: [] }, async () => {});
    const repo = new InMemoryWriteOffRepository(store);
    await repo.create({ id: uuidv7(), invoiceId, amount: 70_000, writtenOffAt: new Date(), recordedById: uuidv7() } as never);
    await repo.create({ id: uuidv7(), invoiceId: uuidv7(), amount: 5_000, writtenOffAt: new Date(), recordedById: uuidv7() } as never);
    expect(await repo.sumByInvoice(invoiceId)).toBe(70_000);
    expect(await repo.sumByInvoice(uuidv7())).toBe(0);
  });
});

describe("WriteOffRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("create + sumByInvoice summerar i SQL", async () => {
    const invoiceId = uuidv7();
    const repo = new DrizzleWriteOffRepository(handle.db);
    await repo.create({ id: uuidv7(), invoiceId, amount: 70_000, writtenOffAt: new Date(), recordedById: uuidv7() } as never);
    await repo.create({ id: uuidv7(), invoiceId: uuidv7(), amount: 5_000, writtenOffAt: new Date(), recordedById: uuidv7() } as never);
    expect(await repo.sumByInvoice(invoiceId)).toBe(70_000);
    expect(await repo.sumByInvoice(uuidv7())).toBe(0);
  });
});
