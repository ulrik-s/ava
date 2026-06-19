/**
 * InvoiceDispatchRepository-paritet (ADR 0020) — in-memory + Drizzle (pglite).
 * listByInvoice + listQueuedForOrg (org-scope via faktura→ärende, faktura-subset).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { invoiceDispatches, invoices, matters } from "@/lib/server/db/schema";
import { DrizzleInvoiceDispatchRepository } from "@/lib/server/repositories/drizzle-invoice-dispatch-repository";
import { InMemoryInvoiceDispatchRepository } from "@/lib/server/repositories/in-memory-invoice-dispatch-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("InvoiceDispatchRepository — in-memory", () => {
  it("listByInvoice + listQueuedForOrg (faktura-subset)", async () => {
    const mId = uuidv7();
    const invId = uuidv7();
    const d1 = uuidv7();
    const source = prebakeJoins({
      matters: [{ id: mId, organizationId: "org-1", matterNumber: "2026-1", title: "T" }],
      invoices: [{ id: invId, matterId: mId, amount: 1000, status: "SENT", invoiceNumber: "F-1", invoiceDate: new Date() }],
      invoiceDispatches: [
        { id: d1, invoiceId: invId, channel: "email", recipient: "a@x", status: "queued", queuedAt: new Date(), recordedById: uuidv7() },
        { id: uuidv7(), invoiceId: invId, channel: "email", recipient: "b@x", status: "sent", queuedAt: new Date(), recordedById: uuidv7() },
      ],
    } as DemoSource);
    const repo = new InMemoryInvoiceDispatchRepository(new LocalStore(source, async () => {}));
    expect(await repo.listByInvoice(invId)).toHaveLength(2);
    const queued = await repo.listQueuedForOrg("org-1");
    expect(queued).toHaveLength(1);
    expect(queued[0]!.invoice?.invoiceNumber).toBe("F-1");
    expect(await repo.listQueuedForOrg("org-2")).toHaveLength(0);
  });
});

describe("InvoiceDispatchRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listByInvoice + listQueuedForOrg (join faktura/ärende)", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const invId = uuidv7();
    const d1 = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(invoices).values(v({ id: invId, matterId: mId, amount: 1000, status: "SENT", invoiceNumber: "F-1", invoiceDate: new Date() }));
    await db.insert(invoiceDispatches).values(v({ id: d1, invoiceId: invId, channel: "email", recipient: "a@x", status: "queued", queuedAt: new Date(), recordedById: uuidv7() }));
    await db.insert(invoiceDispatches).values(v({ id: uuidv7(), invoiceId: invId, channel: "email", recipient: "b@x", status: "sent", queuedAt: new Date(), recordedById: uuidv7() }));
    const repo = new DrizzleInvoiceDispatchRepository(handle.db);
    expect(await repo.listByInvoice(invId)).toHaveLength(2);
    const queued = await repo.listQueuedForOrg(org);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.invoice?.invoiceNumber).toBe("F-1");
    expect(await repo.listQueuedForOrg(uuidv7())).toHaveLength(0);
  });
});
