/**
 * Tester för `runPaymentScan` — den nya event-drivna ersättaren för
 * cron/send-payment-reminders.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPaymentScan } from "@/server/services/payment-scan";
import type { IDataStore } from "@/server/data-store/IDataStore";

const ORG = "org-1";

function makeDataStore() {
  const emit = vi.fn(async (input: unknown) => ({
    id: "evt", ts: new Date().toISOString(), ...(input as object),
  }));
  const ds = {
    events: { emit, query: vi.fn(), iterate: vi.fn(), onNewEvent: vi.fn(() => () => {}) },
  } as unknown as IDataStore;
  return { ds, emit };
}

function makePrisma(plans: unknown[]) {
  return {
    paymentPlan: {
      findMany: vi.fn().mockResolvedValue(plans),
    },
  } as never;
}

function makePlan(opts: {
  id: string;
  dayOfMonth: number;
  monthlyAmount: number;
  invoiceAmount: number;
  payments?: { amount: number; paidAt: Date }[];
  startDate?: Date;
  contactEmail?: string | null;
}) {
  return {
    id: opts.id,
    dayOfMonth: opts.dayOfMonth,
    monthlyAmount: opts.monthlyAmount,
    startDate: opts.startDate ?? new Date("2026-01-01"),
    status: "ACTIVE",
    invoice: {
      id: `inv-${opts.id}`,
      amount: opts.invoiceAmount,
      payments: opts.payments ?? [],
      matter: {
        id: `m-${opts.id}`,
        matterNumber: "2026-0001",
        title: "Vårdnadstvist",
        organization: { name: "Advokat AB", email: "info@advokat.se", bankgiro: "123-4567" },
        contacts: [
          {
            contact: {
              email: opts.contactEmail === undefined ? "klient@x.se" : opts.contactEmail,
              name: "Anna Klient",
            },
          },
        ],
      },
    },
  };
}

describe("runPaymentScan", () => {
  let dsOut: ReturnType<typeof makeDataStore>;
  beforeEach(() => { dsOut = makeDataStore(); });

  it("emittar payment.due när today === plan.dayOfMonth", async () => {
    const today = new Date(Date.UTC(2026, 4, 25)); // 25 maj 2026
    const prisma = makePrisma([
      makePlan({ id: "p1", dayOfMonth: 25, monthlyAmount: 500000, invoiceAmount: 5000000 }),
    ]);
    const result = await runPaymentScan(prisma, dsOut.ds, ORG, today);

    expect(result.dueEmitted).toBe(1);
    expect(result.overdueEmitted).toBe(0);

    const dueEvent = dsOut.emit.mock.calls.find((c) => (c[0] as { type: string }).type === "payment.due");
    expect(dueEvent).toBeTruthy();
    const payload = (dueEvent![0] as { payload: Record<string, unknown> }).payload;
    expect(payload.planId).toBe("p1");
    expect(payload.idempotencyKey).toMatch(/p1:.*:DUE/);
    expect(payload.recipientEmail).toBe("klient@x.se");
    expect(payload.bankgiro).toBe("123-4567");
  });

  it("emittar payment.overdue när today === dayOfMonth + 10 och ingen betalning finns", async () => {
    // Behåller originalets logik: jämför `day` (1-31) med `dayOfMonth + 10`
    // inom samma månad (ingen month-wrap-handling — det är en känd
    // begränsning som kommer i v2).
    const today = new Date(Date.UTC(2026, 4, 24)); // 24 maj
    const prisma = makePrisma([
      makePlan({
        id: "p2",
        dayOfMonth: 14, // → +10 = 24 maj
        monthlyAmount: 500000,
        invoiceAmount: 5000000,
        payments: [], // ingen betalning
      }),
    ]);
    const result = await runPaymentScan(prisma, dsOut.ds, ORG, today);
    expect(result.overdueEmitted).toBe(1);
    expect(result.dueEmitted).toBe(0);

    const overdueEvent = dsOut.emit.mock.calls.find((c) => (c[0] as { type: string }).type === "payment.overdue");
    expect(overdueEvent).toBeTruthy();
  });

  it("hoppar över overdue om betalning finns denna månad", async () => {
    const today = new Date(Date.UTC(2026, 4, 24));
    const prisma = makePrisma([
      makePlan({
        id: "p3",
        dayOfMonth: 14,
        monthlyAmount: 500000,
        invoiceAmount: 5000000,
        payments: [{ amount: 500000, paidAt: new Date(Date.UTC(2026, 4, 1)) }],
      }),
    ]);
    const result = await runPaymentScan(prisma, dsOut.ds, ORG, today);
    expect(result.overdueEmitted).toBe(0);
  });

  it("hoppar över planer utan klient-mail", async () => {
    const today = new Date(Date.UTC(2026, 4, 25));
    const prisma = makePrisma([
      makePlan({ id: "p4", dayOfMonth: 25, monthlyAmount: 500000, invoiceAmount: 5000000, contactEmail: null }),
    ]);
    const result = await runPaymentScan(prisma, dsOut.ds, ORG, today);
    expect(result.skippedNoEmail).toBe(1);
    expect(result.dueEmitted).toBe(0);
  });

  it("emittar system.payment_scan_completed med räknare", async () => {
    const today = new Date(Date.UTC(2026, 4, 25));
    const prisma = makePrisma([
      makePlan({ id: "p5", dayOfMonth: 25, monthlyAmount: 500000, invoiceAmount: 5000000 }),
    ]);
    await runPaymentScan(prisma, dsOut.ds, ORG, today);

    const completed = dsOut.emit.mock.calls.find(
      (c) => (c[0] as { type: string }).type === "system.payment_scan_completed",
    );
    expect(completed).toBeTruthy();
    const payload = (completed![0] as { payload: Record<string, unknown> }).payload;
    expect(payload.plansChecked).toBe(1);
    expect(payload.dueEmitted).toBe(1);
  });

  it("räknar i remainingAmount baserat på existerande betalningar", async () => {
    const today = new Date(Date.UTC(2026, 4, 25));
    const prisma = makePrisma([
      makePlan({
        id: "p6",
        dayOfMonth: 25,
        monthlyAmount: 500000,
        invoiceAmount: 5000000,
        payments: [
          { amount: 500000, paidAt: new Date(Date.UTC(2026, 0, 25)) },
          { amount: 500000, paidAt: new Date(Date.UTC(2026, 1, 25)) },
        ],
      }),
    ]);
    await runPaymentScan(prisma, dsOut.ds, ORG, today);
    const due = dsOut.emit.mock.calls.find((c) => (c[0] as { type: string }).type === "payment.due");
    const payload = (due![0] as { payload: Record<string, unknown> }).payload;
    expect(payload.remainingAmount).toBe(4000000); // 5000000 - 2 × 500000
  });
});
