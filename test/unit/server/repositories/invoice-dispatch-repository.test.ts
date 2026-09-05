/**
 * InvoiceDispatchRepository-paritet (ADR 0020) — in-memory + Drizzle (pglite).
 * listByInvoice + listByStatusForOrg (org-scope via faktura→ärende, faktura-subset).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { invoiceDispatches, invoices, matters } from "@/lib/server/db/schema";
import { DrizzleInvoiceDispatchRepository } from "@/lib/server/repositories/drizzle-invoice-dispatch-repository";
import { InMemoryInvoiceDispatchRepository } from "@/lib/server/repositories/in-memory-invoice-dispatch-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("InvoiceDispatchRepository — in-memory", () => {
  it("listByInvoice + listByStatusForOrg (faktura-subset)", async () => {
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
    expect(await repo.listByInvoice(asId<"InvoiceId">(invId))).toHaveLength(2);
    const queued = await repo.listByStatusForOrg(asId<"OrganizationId">("org-1"), "queued");
    expect(queued).toHaveLength(1);
    expect(queued[0]!.invoice?.invoiceNumber).toBe("F-1");
    expect(await repo.listByStatusForOrg(asId<"OrganizationId">("org-2"), "queued")).toHaveLength(0);

    // Statusen är en parameter (#1062): "Att bevaka" listar failed på samma väg
    // som workern listar queued. Filtrerar den inte får bevakningslistan alla
    // utskick, inklusive de som gått bra.
    const sent = await repo.listByStatusForOrg(asId<"OrganizationId">("org-1"), "sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.recipient).toBe("b@x");
  });
});

describe("InvoiceDispatchRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listByInvoice + listByStatusForOrg (join faktura/ärende)", async () => {
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
    expect(await repo.listByInvoice(asId<"InvoiceId">(invId))).toHaveLength(2);
    const queued = await repo.listByStatusForOrg(asId<"OrganizationId">(org), "queued");
    expect(queued).toHaveLength(1);
    expect(queued[0]!.invoice?.invoiceNumber).toBe("F-1");
    expect(await repo.listByStatusForOrg(asId<"OrganizationId">(uuidv7()), "queued")).toHaveLength(0);
  });
});
