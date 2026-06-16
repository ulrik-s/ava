/**
 * InvoiceRepository-pilot (ADR 0020, #409) — kör SAMMA kontrakt mot båda impls:
 * in-memory (LocalStore) och Drizzle (pglite). Bevisar paritet: create/getById,
 * version-bump, soft-delete, listByMatter och getByIdWithLedger (relations).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { invoices, matters, payments } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { DrizzleInvoiceRepository } from "@/lib/server/repositories/drizzle-invoice-repository";
import { InMemoryInvoiceRepository } from "@/lib/server/repositories/in-memory-invoice-repository";
import type { InvoiceRepository } from "@/lib/server/repositories/invoice-repository";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const matterId = uuidv7();
const invId = uuidv7();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inv = (o: Record<string, unknown> = {}): any => ({
  id: invId, matterId, amount: 100_000, status: "DRAFT", invoiceType: "STANDARD",
  invoiceDate: new Date("2026-06-01T00:00:00.000Z"), ...o,
});

/** Det delade kontraktet — körs identiskt mot varje backend. */
async function assertContract(repo: InvoiceRepository): Promise<void> {
  const created = await repo.create(inv());
  expect(created.amount).toBe(100_000);
  expect((created as { version?: number }).version).toBe(1);

  expect(await repo.getById(invId)).toMatchObject({ id: invId, status: "DRAFT" });
  expect(await repo.getById(uuidv7())).toBeNull();

  expect((await repo.listByMatter(matterId)).map((i) => i.id)).toContain(invId);

  const updated = await repo.update(invId, { status: "SENT" });
  expect(updated.status).toBe("SENT");
  expect((updated as { version?: number }).version).toBe(2);

  await repo.softDelete(invId);
  expect(await repo.getById(invId)).toBeNull();
  expect(await repo.listByMatter(matterId)).toHaveLength(0);
}

describe("InvoiceRepository — in-memory", () => {
  it("uppfyller kontraktet", async () => {
    const store = new LocalStore({ invoices: [], payments: [], writeOffs: [] }, async () => {});
    await assertContract(new InMemoryInvoiceRepository(store));
  });

  it("getByIdWithLedger hämtar betalningar + avskrivningar", async () => {
    const store = new LocalStore({
      invoices: [inv({ id: invId })],
      payments: [{ id: uuidv7(), invoiceId: invId, amount: 5_000 }],
      writeOffs: [{ id: uuidv7(), invoiceId: invId, amount: 1_000 }],
    }, async () => {});
    const ledger = await new InMemoryInvoiceRepository(store).getByIdWithLedger(invId);
    expect(ledger?.payments).toHaveLength(1);
    expect(ledger?.writeOffs).toHaveLength(1);
    expect(ledger?.payments[0]!.amount).toBe(5_000);
  });

  it("getByIdInOrg org-scopar via ärendet", async () => {
    const store = new LocalStore({
      matters: [{ id: matterId, organizationId: "org-1" }],
      invoices: [inv({ id: invId, matterId })],
      payments: [], writeOffs: [],
    }, async () => {});
    const repo = new InMemoryInvoiceRepository(store);
    expect(await repo.getByIdInOrg(invId, "org-1")).toMatchObject({ id: invId });
    expect(await repo.getByIdInOrg(invId, "org-2")).toBeNull(); // fel org
  });
});

describe("InvoiceRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("uppfyller kontraktet", async () => {
    await assertContract(new DrizzleInvoiceRepository(handle.db as unknown as AppDb));
  });

  it("getByIdWithLedger hämtar betalningar", async () => {
    const db = handle.db;
    const id = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(invoices).values(inv({ id }) as any);
    await db.insert(payments).values({
      id: uuidv7(), invoiceId: id, amount: 7_500, paidAt: new Date(), recordedById: uuidv7(), version: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const ledger = await new DrizzleInvoiceRepository(handle.db as unknown as AppDb).getByIdWithLedger(id);
    expect(ledger?.payments).toHaveLength(1);
    expect(ledger?.payments[0]!.amount).toBe(7_500);
  });

  it("getByIdInOrg org-scopar via join mot matters", async () => {
    const db = handle.db;
    const id = uuidv7();
    const mId = uuidv7();
    const org = uuidv7(); // uuid-kolumn → måste vara giltig UUID
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(matters).values({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T", version: 1 } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(invoices).values(inv({ id, matterId: mId }) as any);
    const repo = new DrizzleInvoiceRepository(handle.db as unknown as AppDb);
    expect(await repo.getByIdInOrg(id, org)).toMatchObject({ id });
    expect(await repo.getByIdInOrg(id, uuidv7())).toBeNull();
  });
});
