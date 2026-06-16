/**
 * Drizzle relations (ADR 0020, #409) — bevisar att relationella `with`-queries
 * fungerar mot pglite, dvs infran för repository-läsningar (getByIdWith…/list).
 * Self-ref/dubbel-FK (accontoDeductions, credit) täcks separat när repona
 * konsumerar dem.
 */

import { eq } from "drizzle-orm";
import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import {
  documents, invoices, matters, payments, writeOffs, paymentPlans, paymentPlanReminders, users,
} from "@/lib/server/db/schema";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "./pg-test-db";

describe("Drizzle relations (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("invoices.findFirst with matter/payments(recordedBy)/writeOffs/paymentPlan(reminders)", async () => {
    const db = handle.db;
    const orgId = uuidv7();
    const mId = uuidv7();
    const invId = uuidv7();
    const userId = uuidv7();
    const planId = uuidv7();

    await db.insert(matters).values({ id: mId, organizationId: orgId, matterNumber: "2026-1", title: "T", version: 1 } as never);
    await db.insert(users).values({ id: userId, organizationId: orgId, email: "a@x", name: "Anna", version: 1 } as never);
    await db.insert(invoices).values({ id: invId, matterId: mId, amount: 1_000, status: "SENT", invoiceType: "STANDARD", invoiceDate: new Date(), version: 1 } as never);
    await db.insert(payments).values({ id: uuidv7(), invoiceId: invId, amount: 400, paidAt: new Date(), recordedById: userId, version: 1 } as never);
    await db.insert(writeOffs).values({ id: uuidv7(), invoiceId: invId, amount: 100, writtenOffAt: new Date(), recordedById: userId, version: 1 } as never);
    await db.insert(paymentPlans).values({ id: planId, invoiceId: invId, monthlyAmount: 100, dayOfMonth: 15, startDate: new Date(), status: "ACTIVE", version: 1 } as never);
    await db.insert(paymentPlanReminders).values({ id: uuidv7(), planId, dueMonth: "2026-06", type: "DUE", sentAt: new Date(), version: 1 } as never);

    const row = await db.query.invoices.findFirst({
      where: eq(invoices.id, invId),
      with: {
        matter: true,
        payments: { with: { recordedBy: true } },
        writeOffs: true,
        paymentPlan: { with: { reminders: true } },
      },
    });

    expect(row?.matter?.matterNumber).toBe("2026-1");
    expect(row?.payments).toHaveLength(1);
    expect(row?.payments[0]?.recordedBy?.name).toBe("Anna");
    expect(row?.writeOffs).toHaveLength(1);
    expect(row?.paymentPlan?.reminders).toHaveLength(1);
  });

  it("invoice→documents-relationen (faktura-dokument, #397)", async () => {
    const db = handle.db;
    const orgId = uuidv7();
    const mId = uuidv7();
    const invId = uuidv7();
    const docId = uuidv7();

    await db.insert(matters).values({ id: mId, organizationId: orgId, matterNumber: "2026-2", title: "D", version: 1 } as never);
    await db.insert(invoices).values({ id: invId, matterId: mId, amount: 1, status: "DRAFT", invoiceType: "FINAL", invoiceDate: new Date(), version: 1 } as never);
    await db.insert(documents).values({ id: docId, matterId: mId, invoiceId: invId, fileName: "Faktura.pdf", mimeType: "application/pdf", sizeBytes: 10, storagePath: "p", uploadedById: uuidv7(), version: 1 } as never);

    const inv = await db.query.invoices.findFirst({ where: eq(invoices.id, invId), with: { documents: true } });
    expect(inv?.documents.map((d) => d.id)).toContain(docId);
  });
});
