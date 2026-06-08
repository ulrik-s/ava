/**
 * BillingRun + frozenAt + Expense.kind=PRUTNING — schema-tester.
 *
 * Designkrav (från diskussion om rättshjälp/rättsskydd-flödet):
 * - BillingRun representerar fakturerings-händelsen (event), separat
 *   från Invoice (dokumentet). Snapshot:ar workValueOre och
 *   clientShareBips så historiska beräkningar inte rörs av matter-edits.
 * - ACCONTO fryser inte rader. FINAL + KOSTNADSRAKNING fryser.
 * - KOSTNADSRAKNING (OFFENTLIG_FÖRSVARARE) har PENDING_VERDICT-status
 *   tills advokaten anger om kostnadsräkningen prutats.
 * - PRUTNING är ett Expense med kind=PRUTNING, negativt amount, ingen moms.
 */
import { describe, it, expect } from "vitest-compat";
import {
  billingRunSchema,
  timeEntrySchema,
  expenseSchema,
} from "@/lib/shared/schemas/billing";

const baseRun = {
  id: "br-1",
  organizationId: "org-1",
  matterId: "m-1",
  workValueOreAtRun: 50000,
  proposedAmountOre: 50000,
  amountOre: 50000,
  createdAt: new Date("2026-05-01"),
  updatedAt: new Date("2026-05-01"),
};

describe("billingRunSchema", () => {
  it("kräver type + recipient + matterId", () => {
    expect(() => billingRunSchema.parse({ ...baseRun, type: "FINAL", recipient: "KLIENT" })).not.toThrow();
    expect(() => billingRunSchema.parse({ ...baseRun, type: "FINAL" })).toThrow();
  });

  it("status default DRAFT", () => {
    const r = billingRunSchema.parse({ ...baseRun, type: "ACCONTO", recipient: "KLIENT" });
    expect(r.status).toBe("DRAFT");
  });

  it("ACCONTO till KLIENT med clientShareBips=2000 (20% självrisk)", () => {
    const r = billingRunSchema.parse({
      ...baseRun, type: "ACCONTO", recipient: "KLIENT",
      workValueOreAtRun: 100_000, clientShareBips: 2000,
      proposedAmountOre: 20_000, amountOre: 20_000,
    });
    expect(r.type).toBe("ACCONTO");
    expect(r.clientShareBips).toBe(2000);
  });

  it("FINAL till FORSAKRING med deductedBillingRunIds (lista av aconton)", () => {
    const r = billingRunSchema.parse({
      ...baseRun, type: "FINAL", recipient: "FORSAKRING",
      deductedBillingRunIds: ["br-acc-1", "br-acc-2"],
    });
    expect(r.deductedBillingRunIds).toEqual(["br-acc-1", "br-acc-2"]);
  });

  it("KOSTNADSRAKNING kan ha status PENDING_VERDICT", () => {
    const r = billingRunSchema.parse({
      ...baseRun, type: "KOSTNADSRAKNING", recipient: "DOMSTOL",
      status: "PENDING_VERDICT",
    });
    expect(r.status).toBe("PENDING_VERDICT");
  });

  it("KOSTNADSRAKNING kan ha prutningOre (negativt belopp från domen)", () => {
    const r = billingRunSchema.parse({
      ...baseRun, type: "KOSTNADSRAKNING", recipient: "DOMSTOL",
      status: "SENT", prutningOre: -8000,
    });
    expect(r.prutningOre).toBe(-8000);
  });

  it("deductedBillingRunIds default []", () => {
    const r = billingRunSchema.parse({ ...baseRun, type: "FINAL", recipient: "KLIENT" });
    expect(r.deductedBillingRunIds).toEqual([]);
  });

  it("invoiceId nullish — KOSTNADSRAKNING har null tills SENT", () => {
    const r = billingRunSchema.parse({
      ...baseRun, type: "KOSTNADSRAKNING", recipient: "DOMSTOL",
      status: "PENDING_VERDICT", invoiceId: null,
    });
    expect(r.invoiceId).toBeNull();
  });

  it("clientShareBips kappad mot 0-10000 (basis points)", () => {
    expect(() => billingRunSchema.parse({
      ...baseRun, type: "ACCONTO", recipient: "KLIENT", clientShareBips: 12000,
    })).toThrow();
  });
});

describe("timeEntrySchema — frozenAt + frozenByBillingRunId", () => {
  const baseTe = {
    id: "te-1", organizationId: "org-1", userId: "u-1", matterId: "m-1",
    date: new Date(), minutes: 60, description: "Möte",
    hourlyRate: 250_000, billable: true,
    createdAt: new Date(), updatedAt: new Date(),
  };

  it("upparbetad rad: frozenAt + frozenByBillingRunId saknas (null/undefined)", () => {
    const t = timeEntrySchema.parse(baseTe);
    expect(t.frozenAt).toBeFalsy();
    expect(t.frozenByBillingRunId).toBeFalsy();
  });

  it("fryst rad: pekar mot billing-run-id som frös den", () => {
    const t = timeEntrySchema.parse({
      ...baseTe, frozenAt: new Date("2026-05-15"), frozenByBillingRunId: "br-final-7",
    });
    expect(t.frozenByBillingRunId).toBe("br-final-7");
    expect(t.frozenAt).toBeInstanceOf(Date);
  });

  it("invoiceId behålls för bakåt­kompabilitet (deprecated men ej borttaget)", () => {
    const t = timeEntrySchema.parse({ ...baseTe, invoiceId: "inv-legacy-1" });
    expect(t.invoiceId).toBe("inv-legacy-1");
  });
});

describe("expenseSchema — kind=EXPENSE|PRUTNING", () => {
  const baseE = {
    id: "ex-1", organizationId: "org-1", userId: "u-1", matterId: "m-1",
    date: new Date(), amount: 12500, description: "Domstolsavgift",
    createdAt: new Date(), updatedAt: new Date(),
  };

  it("default kind = EXPENSE (bakåt­kompabilitet)", () => {
    const e = expenseSchema.parse(baseE);
    expect(e.kind).toBe("EXPENSE");
  });

  it("PRUTNING accepteras (negativt amount, vatRate=0)", () => {
    const p = expenseSchema.parse({
      ...baseE, kind: "PRUTNING", amount: -8000,
      description: "Prutning kostnadsräkning enligt dom",
      vatRate: 0, vatIncluded: false,
    });
    expect(p.kind).toBe("PRUTNING");
    expect(p.amount).toBe(-8000);
  });

  it("frozenAt-mekanism samma som timeEntry", () => {
    const e = expenseSchema.parse({
      ...baseE, frozenAt: new Date("2026-05-15"), frozenByBillingRunId: "br-1",
    });
    expect(e.frozenByBillingRunId).toBe("br-1");
  });

  it("PRUTNING kan vara fryst på en KOSTNADSRAKNING-run", () => {
    const p = expenseSchema.parse({
      ...baseE, kind: "PRUTNING", amount: -5000,
      frozenAt: new Date(), frozenByBillingRunId: "br-kr-1",
    });
    expect(p.kind).toBe("PRUTNING");
    expect(p.frozenByBillingRunId).toBe("br-kr-1");
  });
});
