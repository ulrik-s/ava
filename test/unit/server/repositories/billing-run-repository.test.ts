/**
 * BillingRunRepository-paritet (ADR 0020) — in-memory + Drizzle (pglite).
 * listForOrg/getByIdInOrg (join faktura+ärende) + listAccontoSent/listAccontoByIds.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { billingRuns, invoices, matters } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { DrizzleBillingRunRepository } from "@/lib/server/repositories/drizzle-billing-run-repository";
import { InMemoryBillingRunRepository } from "@/lib/server/repositories/in-memory-billing-run-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = "44444444-4444-7444-8444-444444444444";

const run = (o: Record<string, unknown>) => ({
  type: "ACCONTO", recipient: "KLIENT", status: "SENT", workValueOreAtRun: 1000,
  proposedAmountOre: 500, amountOre: 500, deductedBillingRunIds: [], periodTo: new Date("2026-06-01"), ...o,
});

describe("BillingRunRepository — in-memory", () => {
  it("listForOrg/getByIdInOrg/listAcconto*", async () => {
    const mId = uuidv7();
    const invId = uuidv7();
    const r1 = uuidv7();
    const r2 = uuidv7();
    const source = prebakeJoins({
      matters: [{ id: mId, organizationId: ORG, matterNumber: "2026-1", title: "T", paymentMethod: "RATTSSKYDD" }],
      invoices: [{ id: invId, matterId: mId, amount: 500, status: "DRAFT", invoiceNumber: "F-1" }],
      billingRuns: [
        run({ id: r1, matterId: mId, invoiceId: invId, type: "ACCONTO", status: "SENT" }),
        run({ id: r2, matterId: mId, invoiceId: null, type: "FINAL", status: "SENT" }),
      ],
    } as DemoSource);
    const repo = new InMemoryBillingRunRepository(new LocalStore(source, async () => {}));

    const list = await repo.listForOrg(ORG);
    expect(list).toHaveLength(2);
    expect(list.find((r) => r.id === r1)!.invoice?.invoiceNumber).toBe("F-1");
    expect(await repo.listForOrg(ORG, mId)).toHaveLength(2);
    expect(await repo.listForOrg(uuidv7())).toHaveLength(0);

    const detail = await repo.getByIdInOrg(r1, ORG);
    expect(detail?.matter?.paymentMethod).toBe("RATTSSKYDD");
    expect(detail?.invoice?.amount).toBe(500);
    expect(await repo.getByIdInOrg(r1, uuidv7())).toBeNull();

    expect((await repo.listAccontoSent(mId)).map((r) => r.id)).toEqual([r1]);
    expect((await repo.listAccontoByIds(mId, [r1, r2])).map((r) => r.id)).toEqual([r1]); // r2 = FINAL filtreras
    expect(await repo.listAccontoByIds(mId, [])).toHaveLength(0);
  });
});

describe("BillingRunRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listForOrg/getByIdInOrg/listAcconto*", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const invId = uuidv7();
    const r1 = uuidv7();
    const r2 = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T", paymentMethod: "RATTSSKYDD" }));
    await db.insert(invoices).values(v({ id: invId, matterId: mId, amount: 500, status: "DRAFT", invoiceNumber: "F-1", invoiceDate: new Date() }));
    await db.insert(billingRuns).values(v(run({ id: r1, matterId: mId, invoiceId: invId, type: "ACCONTO", status: "SENT" })));
    await db.insert(billingRuns).values(v(run({ id: r2, matterId: mId, invoiceId: null, type: "FINAL", status: "SENT" })));
    const repo = new DrizzleBillingRunRepository(db as unknown as AppDb);

    const list = await repo.listForOrg(org);
    expect(list).toHaveLength(2);
    expect(list.find((r) => r.id === r1)!.invoice?.invoiceNumber).toBe("F-1");
    expect(await repo.listForOrg(org, mId)).toHaveLength(2);
    expect(await repo.listForOrg(uuidv7())).toHaveLength(0);

    const detail = await repo.getByIdInOrg(r1, org);
    expect(detail?.matter?.paymentMethod).toBe("RATTSSKYDD");
    expect(detail?.invoice?.amount).toBe(500);
    expect(await repo.getByIdInOrg(r1, uuidv7())).toBeNull();

    expect((await repo.listAccontoSent(mId)).map((r) => r.id)).toEqual([r1]);
    expect((await repo.listAccontoByIds(mId, [r1, r2])).map((r) => r.id)).toEqual([r1]);
    expect(await repo.listAccontoByIds(mId, [])).toHaveLength(0);
  });
});
