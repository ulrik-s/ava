/**
 * Regressionstest för "ser ut att fungera i UI:t men persisteras inte"-buggen.
 *
 * Till skillnad från invoice.test.ts (som mockar Prisma) kör detta
 * invoiceRouter mot en RIKTIG `DemoDataStore` — samma store som körs i
 * browsern. Det bevisar att fakturabetalningar/-planer faktiskt:
 *   1. går igenom transaction()-primitiven (kastar inte längre på `raw`)
 *   2. muteras i in-memory-source
 *   3. emit:ar write-back-event (→ skrivs till git-db:n)
 * och att en cross-org-betalning rullas tillbaka utan write-back.
 */

import { describe, it, expect, vi } from "vitest-compat";
import { DemoDataStore, type DemoSource } from "@/lib/server/data-store/DemoDataStore";
import type { MutationEvent } from "@/lib/server/data-store/in-memory/writable-delegate";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { invoiceRouter } from "@/lib/server/routers/invoice";

function setup(overrides?: Partial<DemoSource>) {
  const source: DemoSource = {
    matters: [{ id: "m1", organizationId: "o1", matterNumber: "2026-0001", title: "T" }],
    // .matter pre-bakat (så where: { matter: { organizationId } } matchar) —
    // speglar demoSourceFromRuntime / enrichRowForEntity i produktion.
    invoices: [{
      id: "inv1", matterId: "m1", amount: 1_000_000, status: "SENT",
      invoiceType: "STANDARD", matter: { id: "m1", organizationId: "o1" },
    }],
    payments: [],
    paymentPlans: [],
    ...overrides,
  };
  const events: MutationEvent<Record<string, unknown>>[] = [];
  const ds = new DemoDataStore(source, (e) => { events.push(e); });
  const caller = (orgId = "o1") => invoiceRouter.createCaller({
    user: { id: "u1", email: "a@b.c", name: "A", role: "LAWYER", organizationId: orgId },
    dataStore: ds,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return { source, events, caller };
}

describe("invoiceRouter mot riktig DemoDataStore", () => {
  it("recordPayment persisterar Payment + emit:ar write-back (full betalning → PAID)", async () => {
    const { source, events, caller } = setup();

    const res = await caller().recordPayment({
      invoiceId: "inv1", amount: 1_000_000, paidAt: "2026-05-15",
    });

    expect(res.settled).toBe(true);
    // Persisterat i source
    expect(source.payments).toHaveLength(1);
    expect((source.invoices![0] as { status: string }).status).toBe("PAID");
    // Write-back emitterat (→ git-db)
    const kinds = events.map((e) => `${e.entity}:${e.kind}`);
    expect(kinds).toContain("payment:create");
    expect(kinds).toContain("invoice:update");
  });

  it("createPaymentPlan persisterar plan + sätter invoice INSTALLMENT_PLAN", async () => {
    const { source, events, caller } = setup();

    await caller().createPaymentPlan({
      invoiceId: "inv1", monthlyAmount: 100_000, dayOfMonth: 15, startDate: "2026-06-01",
    });

    expect(source.paymentPlans).toHaveLength(1);
    expect((source.invoices![0] as { status: string }).status).toBe("INSTALLMENT_PLAN");
    const kinds = events.map((e) => `${e.entity}:${e.kind}`);
    expect(kinds).toContain("paymentPlan:create");
    expect(kinds).toContain("invoice:update");
  });

  it("cross-org recordPayment → NOT_FOUND, rollback, ingen write-back", async () => {
    const { source, events, caller } = setup();

    await expect(
      caller("annan-org").recordPayment({ invoiceId: "inv1", amount: 1, paidAt: "2026-05-15" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(source.payments).toHaveLength(0);
    expect((source.invoices![0] as { status: string }).status).toBe("SENT");
    expect(events).toHaveLength(0);
  });

  it("createFinal: kopplar poster + skapar acconto-avdrag + persisterar allt", async () => {
    const source: DemoSource = {
      matters: [{ id: "m1", organizationId: "o1", matterNumber: "2026-0001", title: "T" }],
      users: [{ id: "u1", hourlyRate: 150_000 }],
      timeEntries: [{ id: "t1", matterId: "m1", minutes: 90, invoiceId: null, userId: "u1" }],
      expenses: [{ id: "e1", matterId: "m1", amount: 50_000, billable: true, invoiceId: null }],
      invoices: [{ id: "acc1", matterId: "m1", invoiceType: "ACCONTO", amount: 100_000, status: "PAID" }],
      accontoDeductions: [],
    };
    const events: MutationEvent<Record<string, unknown>>[] = [];
    const ds = new DemoDataStore(source, (e) => { events.push(e); });
    const caller = invoiceRouter.createCaller({
      user: { id: "u1", email: "a@b.c", name: "A", role: "LAWYER", organizationId: "o1" },
      dataStore: ds,
      repos: buildInMemoryRepositories(ds),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await caller.createFinal({
      matterId: "m1", timeEntryIds: ["t1"], expenseIds: ["e1"], accontoInvoiceIds: ["acc1"],
    });

    // 90min×150000/60 = 225000 + 50000 expense = 275000 brutto; − 100000 acconto = 175000 netto
    expect(res.breakdown.grossAmount).toBe(275_000);
    expect(res.breakdown.netAmount).toBe(175_000);
    const finalId = (res.invoice as { id: string }).id;
    // Poster kopplade i source
    expect((source.timeEntries![0] as { invoiceId: string }).invoiceId).toBe(finalId);
    expect((source.expenses![0] as { invoiceId: string }).invoiceId).toBe(finalId);
    // Acconto-avdrag skapat
    expect(source.accontoDeductions).toHaveLength(1);
    expect((source.accontoDeductions![0] as { accontoInvoiceId: string }).accontoInvoiceId).toBe("acc1");
    // Write-back för alla
    const kinds = events.map((e) => `${e.entity}:${e.kind}`);
    expect(kinds).toContain("invoice:create");
    expect(kinds).toContain("timeEntry:update");
    expect(kinds).toContain("expense:update");
    expect(kinds).toContain("accontoDeduction:create");
  });

  it("cancelPaymentPlan: nested where invoice.matter.organizationId fungerar i demo-store", async () => {
    const source: DemoSource = {
      matters: [{ id: "m1", organizationId: "o1" }],
      invoices: [{ id: "inv1", matterId: "m1", status: "INSTALLMENT_PLAN", matter: { id: "m1", organizationId: "o1" } }],
      paymentPlans: [{ id: "pp1", invoiceId: "inv1", status: "ACTIVE" }],
    };
    const events: MutationEvent<Record<string, unknown>>[] = [];
    const ds = new DemoDataStore(source, (e) => { events.push(e); });
    const call = (org: string) => invoiceRouter.createCaller({
      user: { id: "u1", email: "a@b.c", name: "A", role: "LAWYER", organizationId: org },
      dataStore: ds,
      repos: buildInMemoryRepositories(ds),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // Cross-org → NOT_FOUND (nested relation-where filtrerar bort den)
    await expect(call("annan").cancelPaymentPlan({ planId: "pp1" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await call("o1").cancelPaymentPlan({ planId: "pp1" });
    expect((source.paymentPlans![0] as { status: string }).status).toBe("CANCELLED");
    expect((source.invoices![0] as { status: string }).status).toBe("SENT");
  });

  it("getById: nested includes (paymentPlan 1:1, payments→recordedBy) hydratiseras", async () => {
    const source: DemoSource = {
      matters: [{ id: "m1", organizationId: "o1" }],
      invoices: [{ id: "inv1", matterId: "m1", status: "SENT", matter: { id: "m1", organizationId: "o1" } }],
      paymentPlans: [{ id: "pp1", invoiceId: "inv1", status: "ACTIVE" }],
      payments: [{ id: "pay1", invoiceId: "inv1", amount: 100, recordedById: "u1" }],
      users: [{ id: "u1", name: "Anna" }],
    };
    const ds = new DemoDataStore(source);
    const caller = invoiceRouter.createCaller({
      user: { id: "u1", email: "a@b.c", name: "A", role: "LAWYER", organizationId: "o1" },
      dataStore: ds,
      repos: buildInMemoryRepositories(ds),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await caller.getById({ id: "inv1" }) as unknown as {
      paymentPlan: { id: string } | null;
      payments: Array<{ recordedBy: { name: string } | null }>;
    };
    expect(res.paymentPlan?.id).toBe("pp1"); // 1:1 → objekt, inte array
    expect(res.payments).toHaveLength(1);
    expect(res.payments[0]!.recordedBy?.name).toBe("Anna"); // nested include
  });
});

// Tysta ev. console-brus i den här filen.
vi.spyOn(console, "warn").mockImplementation(() => {});
