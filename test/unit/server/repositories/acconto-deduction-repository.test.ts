/**
 * AccontoDeductionRepository-paritet (ADR 0020, #409 fan-out) — in-memory +
 * Drizzle (pglite). Endast bas-CRUD: createFinal anropar `create`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import type { AppDb } from "@/lib/server/db/types";
import { DrizzleAccontoDeductionRepository } from "@/lib/server/repositories/drizzle-acconto-deduction-repository";
import { InMemoryAccontoDeductionRepository } from "@/lib/server/repositories/in-memory-acconto-deduction-repository";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("AccontoDeductionRepository — in-memory", () => {
  it("create + getById (version 1)", async () => {
    const store = new LocalStore({ accontoDeductions: [] }, async () => {});
    const repo = new InMemoryAccontoDeductionRepository(store);
    const id = uuidv7();
    const created = await repo.create({ id, finalInvoiceId: uuidv7(), accontoInvoiceId: uuidv7() } as never);
    expect((created as { version?: number }).version).toBe(1);
    expect(await repo.getById(id)).toMatchObject({ id });
  });
});

describe("AccontoDeductionRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("create + getById (version 1)", async () => {
    const repo = new DrizzleAccontoDeductionRepository(handle.db as unknown as AppDb);
    const id = uuidv7();
    const created = await repo.create({ id, finalInvoiceId: uuidv7(), accontoInvoiceId: uuidv7() } as never);
    expect((created as { version?: number }).version).toBe(1);
    expect(await repo.getById(id)).toMatchObject({ id });
  });
});
