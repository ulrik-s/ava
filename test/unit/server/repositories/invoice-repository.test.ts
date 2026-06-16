/**
 * InvoiceRepository-pilot (ADR 0020, #409) — kör SAMMA kontrakt mot båda impls:
 * in-memory (LocalStore) och Drizzle (pglite). Bevisar paritet: create/getById,
 * version-bump, soft-delete, listByMatter och getByIdWithLedger (relations).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import {
  invoices, matters, payments, writeOffs, paymentPlans, paymentPlanReminders,
  timeEntries, expenses, documents, users, accontoDeductions,
} from "@/lib/server/db/schema";
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

  it("getByIdWithRelations hämtar huvudrelationerna", async () => {
    const userId = uuidv7();
    const planId = uuidv7();
    const store = new LocalStore({
      matters: [{ id: matterId, organizationId: "org-1", matterNumber: "2026-1", title: "T" }],
      users: [{ id: userId, name: "Anna" }],
      invoices: [inv({ id: invId, matterId })],
      payments: [{ id: uuidv7(), invoiceId: invId, amount: 400, recordedById: userId }],
      writeOffs: [{ id: uuidv7(), invoiceId: invId, amount: 100 }],
      paymentPlans: [{ id: planId, invoiceId: invId, status: "ACTIVE" }],
      paymentPlanReminders: [{ id: uuidv7(), planId, dueMonth: "2026-06", type: "DUE" }],
      timeEntries: [{ id: uuidv7(), invoiceId: invId, matterId, minutes: 60, billable: true, hourlyRate: 1000 }],
      expenses: [{ id: uuidv7(), invoiceId: invId, matterId, amount: 50, billable: true }],
      documents: [{ id: uuidv7(), invoiceId: invId, matterId, fileName: "f.pdf" }],
    }, async () => {});
    const repo = new InMemoryInvoiceRepository(store);
    const full = await repo.getByIdWithRelations(invId, "org-1");
    expect(full?.matter?.matterNumber).toBe("2026-1");
    expect(full?.payments).toHaveLength(1);
    expect(full?.payments[0]?.recordedBy?.name).toBe("Anna");
    expect(full?.paymentPlan?.reminders).toHaveLength(1);
    expect(full?.writeOffs).toHaveLength(1);
    expect(full?.timeEntries).toHaveLength(1);
    expect(full?.expenses).toHaveLength(1);
    expect(full?.documents).toHaveLength(1);
    expect(await repo.getByIdWithRelations(invId, "org-2")).toBeNull(); // fel org
  });

  it("getByIdFull tar med aconto-avdrag + kreditnota (self-refs)", async () => {
    const accontoId = uuidv7();
    const store = new LocalStore({
      matters: [{ id: matterId, organizationId: "org-1", matterNumber: "2026-1", title: "T" }],
      invoices: [
        inv({ id: invId, matterId, invoiceType: "FINAL" }),
        inv({ id: accontoId, matterId, invoiceType: "ACCONTO" }),
      ],
      accontoDeductions: [{ id: uuidv7(), finalInvoiceId: invId, accontoInvoiceId: accontoId }],
      payments: [], writeOffs: [],
    }, async () => {});
    const full = await new InMemoryInvoiceRepository(store).getByIdFull(invId, "org-1");
    expect(full?.accontoDeductions).toHaveLength(1);
    expect((full?.accontoDeductions[0]?.accontoInvoice as { id?: string } | null)?.id).toBe(accontoId);
  });

  it("listForOrg org-scopar, filtrerar och tar med listrelationer", async () => {
    const accontoId = uuidv7();
    const otherId = uuidv7();
    const otherMatter = uuidv7();
    const store = new LocalStore({
      matters: [
        { id: matterId, organizationId: "org-1", matterNumber: "2026-1", title: "T" },
        { id: otherMatter, organizationId: "org-2", matterNumber: "2026-2", title: "U" },
      ],
      invoices: [
        inv({ id: invId, matterId, invoiceType: "FINAL", status: "SENT" }),
        inv({ id: accontoId, matterId, invoiceType: "ACCONTO", status: "PAID" }),
        inv({ id: otherId, matterId: otherMatter, status: "SENT" }),
      ],
      accontoDeductions: [{ id: uuidv7(), finalInvoiceId: invId, accontoInvoiceId: accontoId }],
      payments: [{ id: uuidv7(), invoiceId: invId, amount: 400 }],
      paymentPlans: [], writeOffs: [],
    }, async () => {});
    const repo = new InMemoryInvoiceRepository(store);
    const all = await repo.listForOrg("org-1");
    expect(all.map((i) => i.id).sort()).toEqual([invId, accontoId].sort()); // org-2-fakturan exkluderad
    const final = all.find((i) => i.id === invId)!;
    expect(final.matter.matterNumber).toBe("2026-1");
    expect(final.payments).toHaveLength(1);
    expect((final.accontoDeductions[0]?.accontoInvoice as { id?: string } | null)?.id).toBe(accontoId);
    expect((await repo.listForOrg("org-1", { status: "PAID" })).map((i) => i.id)).toEqual([accontoId]);
    expect((await repo.listForOrg("org-1", { invoiceType: "FINAL" })).map((i) => i.id)).toEqual([invId]);
  });

  it("nextInvoiceNumber ökar sekvensen per org/år", async () => {
    const mId = uuidv7();
    const store = new LocalStore({
      matters: [{ id: mId, organizationId: "org-1" }],
      invoices: [
        inv({ id: uuidv7(), matterId: mId, invoiceNumber: "F-2026-0001" }),
        inv({ id: uuidv7(), matterId: mId, invoiceNumber: "F-2026-0002" }),
      ],
      payments: [], writeOffs: [],
    }, async () => {});
    const repo = new InMemoryInvoiceRepository(store, () => new Date("2026-06-01T00:00:00.000Z"));
    expect(await repo.nextInvoiceNumber("org-1")).toBe("F-2026-0003");
    expect(await repo.nextInvoiceNumber("org-2")).toBe("F-2026-0001"); // tom org → 0001
  });

  it("sumCreditNotesFor summerar |belopp| av kreditnotor, org-scopat", async () => {
    const mId = uuidv7();
    const finalId = uuidv7();
    const store = new LocalStore({
      matters: [{ id: mId, organizationId: "org-1", matterNumber: "2026-1", title: "T" }],
      invoices: [
        inv({ id: finalId, matterId: mId, invoiceType: "FINAL" }),
        inv({ id: uuidv7(), matterId: mId, invoiceType: "CREDIT", amount: -40_000, creditedInvoiceId: finalId }),
        inv({ id: uuidv7(), matterId: mId, invoiceType: "CREDIT", amount: -10_000, creditedInvoiceId: finalId }),
      ],
      payments: [], writeOffs: [],
    }, async () => {});
    const repo = new InMemoryInvoiceRepository(store);
    expect(await repo.sumCreditNotesFor(finalId, "org-1")).toBe(50_000); // |−40000| + |−10000|
    expect(await repo.sumCreditNotesFor(finalId, "org-2")).toBe(0); // fel org
    expect(await repo.sumCreditNotesFor(uuidv7(), "org-1")).toBe(0); // inga kreditnotor
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

  it("getByIdWithRelations hämtar huvudrelationerna (with-query)", async () => {
    const db = handle.db;
    const id = uuidv7();
    const mId = uuidv7();
    const org = uuidv7();
    const userId = uuidv7();
    const planId = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(users).values(v({ id: userId, organizationId: org, email: "a@x", name: "Anna" }));
    await db.insert(invoices).values(inv({ id, matterId: mId }) as never);
    await db.insert(payments).values(v({ id: uuidv7(), invoiceId: id, amount: 400, paidAt: new Date(), recordedById: userId }));
    await db.insert(writeOffs).values(v({ id: uuidv7(), invoiceId: id, amount: 100, writtenOffAt: new Date(), recordedById: userId }));
    await db.insert(paymentPlans).values(v({ id: planId, invoiceId: id, monthlyAmount: 100, dayOfMonth: 15, startDate: new Date(), status: "ACTIVE" }));
    await db.insert(paymentPlanReminders).values(v({ id: uuidv7(), planId, dueMonth: "2026-06", type: "DUE", sentAt: new Date() }));
    await db.insert(timeEntries).values(v({ id: uuidv7(), userId, matterId: mId, invoiceId: id, date: new Date(), minutes: 60, description: "x", hourlyRate: 1000 }));
    await db.insert(expenses).values(v({ id: uuidv7(), userId, matterId: mId, invoiceId: id, date: new Date(), amount: 50, description: "x" }));
    await db.insert(documents).values(v({ id: uuidv7(), matterId: mId, invoiceId: id, fileName: "f.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath: "p", uploadedById: userId }));

    const repo = new DrizzleInvoiceRepository(handle.db as unknown as AppDb);
    const full = await repo.getByIdWithRelations(id, org);
    expect(full?.matter?.matterNumber).toBe("2026-1");
    expect(full?.payments).toHaveLength(1);
    expect(full?.payments[0]?.recordedBy?.name).toBe("Anna");
    expect(full?.paymentPlan?.reminders).toHaveLength(1);
    expect(full?.writeOffs).toHaveLength(1);
    expect(full?.timeEntries).toHaveLength(1);
    expect(full?.expenses).toHaveLength(1);
    expect(full?.documents).toHaveLength(1);
    expect(await repo.getByIdWithRelations(id, uuidv7())).toBeNull(); // fel org
  });

  it("getByIdFull: self-refs via sekundär-queries (aconto-avdrag + kreditnota)", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const finalId = uuidv7();
    const accontoId = uuidv7();
    const creditId = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(invoices).values(inv({ id: finalId, matterId: mId, invoiceType: "FINAL" }) as never);
    await db.insert(invoices).values(inv({ id: accontoId, matterId: mId, invoiceType: "ACCONTO" }) as never);
    await db.insert(invoices).values(inv({ id: creditId, matterId: mId, invoiceType: "CREDIT", creditedInvoiceId: finalId }) as never);
    await db.insert(accontoDeductions).values(v({ id: uuidv7(), finalInvoiceId: finalId, accontoInvoiceId: accontoId }));

    const full = await new DrizzleInvoiceRepository(handle.db as unknown as AppDb).getByIdFull(finalId, org);
    expect(full?.accontoDeductions).toHaveLength(1);
    expect(full?.accontoDeductions[0]?.accontoInvoice?.id).toBe(accontoId);
    expect(full?.creditNote?.id).toBe(creditId);
  });

  it("listForOrg: org-scope via join + self-ref-berikning per rad", async () => {
    const db = handle.db;
    const org = uuidv7();
    const otherOrg = uuidv7();
    const mId = uuidv7();
    const otherMatter = uuidv7();
    const finalId = uuidv7();
    const accontoId = uuidv7();
    const otherId = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(matters).values(v({ id: otherMatter, organizationId: otherOrg, matterNumber: "2026-2", title: "U" }));
    await db.insert(invoices).values(inv({ id: finalId, matterId: mId, invoiceType: "FINAL", status: "SENT" }) as never);
    await db.insert(invoices).values(inv({ id: accontoId, matterId: mId, invoiceType: "ACCONTO", status: "PAID" }) as never);
    await db.insert(invoices).values(inv({ id: otherId, matterId: otherMatter, status: "SENT" }) as never);
    await db.insert(accontoDeductions).values(v({ id: uuidv7(), finalInvoiceId: finalId, accontoInvoiceId: accontoId }));
    await db.insert(payments).values(v({ id: uuidv7(), invoiceId: finalId, amount: 400, paidAt: new Date(), recordedById: uuidv7() }));

    const repo = new DrizzleInvoiceRepository(handle.db as unknown as AppDb);
    const all = await repo.listForOrg(org);
    expect(all.map((i) => i.id).sort()).toEqual([finalId, accontoId].sort()); // annan org exkluderad
    const final = all.find((i) => i.id === finalId)!;
    expect(final.matter.matterNumber).toBe("2026-1");
    expect(final.payments).toHaveLength(1);
    expect(final.accontoDeductions[0]?.accontoInvoice?.id).toBe(accontoId);
    expect((await repo.listForOrg(org, { status: "PAID" })).map((i) => i.id)).toEqual([accontoId]);
  });

  it("nextInvoiceNumber ökar sekvensen per org/år (join mot matters)", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(invoices).values(inv({ id: uuidv7(), matterId: mId, invoiceNumber: "F-2026-0001" }) as never);
    await db.insert(invoices).values(inv({ id: uuidv7(), matterId: mId, invoiceNumber: "F-2026-0002" }) as never);
    const repo = new DrizzleInvoiceRepository(handle.db as unknown as AppDb, () => new Date("2026-06-01T00:00:00.000Z"));
    expect(await repo.nextInvoiceNumber(org)).toBe("F-2026-0003");
    expect(await repo.nextInvoiceNumber(uuidv7())).toBe("F-2026-0001"); // tom org → 0001
  });

  it("sumCreditNotesFor summerar |belopp| av kreditnotor (join mot matters)", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const finalId = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(invoices).values(inv({ id: finalId, matterId: mId, invoiceType: "FINAL" }) as never);
    await db.insert(invoices).values(inv({ id: uuidv7(), matterId: mId, invoiceType: "CREDIT", amount: -40_000, creditedInvoiceId: finalId }) as never);
    await db.insert(invoices).values(inv({ id: uuidv7(), matterId: mId, invoiceType: "CREDIT", amount: -10_000, creditedInvoiceId: finalId }) as never);

    const repo = new DrizzleInvoiceRepository(handle.db as unknown as AppDb);
    expect(await repo.sumCreditNotesFor(finalId, org)).toBe(50_000);
    expect(await repo.sumCreditNotesFor(finalId, uuidv7())).toBe(0); // fel org
  });
});
