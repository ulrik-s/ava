/**
 * Fakturapanelens summa-kort (#1236) — yrkat i kostnadsräkning, fakturerat inkl
 * skapade-ej-skickade, betalt. Ren logik.
 */
import { describe, it, expect } from "vitest-compat";
import { invoicedTotals, krClaimedOre, paidOre, type SummaryInvoice, type SummaryRun } from "@/lib/shared/billing-summary";
import type { KostnadsrakningStatus } from "@/lib/shared/kostnadsrakning-flow";
import type { BillingRunStatus } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";

const kr = (kostnadsrakningStatus: KostnadsrakningStatus | null, amountOre: number, status: BillingRunStatus = "PENDING_VERDICT"): SummaryRun =>
  ({ type: "KOSTNADSRAKNING", status, recipient: "DOMSTOL", kostnadsrakningStatus, amountOre });

const inv = (id: string, amount: number, status: SummaryInvoice["status"], extra: Partial<SummaryInvoice> = {}): SummaryInvoice =>
  ({ id: asId<"InvoiceId">(id), amount, status, ...extra });

describe("krClaimedOre", () => {
  it("summerar yrkat på inskickade, beslutade och överklagade kostnadsräkningar", () => {
    expect(krClaimedOre([kr("INSKICKAD", 100), kr("BESLUTAD", 20), kr("OVERKLAGAD", 3)])).toBe(123);
  });

  it("fakturerad, ångrad eller status-lös KR och andra körningar räknas inte", () => {
    const acconto: SummaryRun = { type: "ACCONTO", status: "SENT", recipient: "KLIENT", amountOre: 7 };
    expect(krClaimedOre([kr("FAKTURERAD", 100, "SENT"), kr("INSKICKAD", 50, "VOIDED"), kr(null, 9), acconto])).toBe(0);
  });
});

describe("invoicedTotals", () => {
  it("DRAFT ingår och redovisas separat; annullerad utan kreditering exkluderas", () => {
    const t = invoicedTotals([inv("a", 1000, "SENT"), inv("b", 200, "DRAFT"), inv("c", 5000, "CANCELLED"), inv("d", 30, "PAID")]);
    expect(t).toEqual({ invoicedOre: 1230, draftOre: 200 });
  });

  it("krediterad faktura nettas av sin kreditnota i stället för att dras av två gånger", () => {
    const t = invoicedTotals([
      inv("orig", 1000, "CANCELLED"),
      inv("cred", -1000, "SENT", { invoiceType: "CREDIT", creditedInvoiceId: asId<"InvoiceId">("orig") }),
      inv("x", 400, "SENT"),
    ]);
    expect(t).toEqual({ invoicedOre: 400, draftOre: 0 });
  });

  it("tom lista → noll", () => {
    expect(invoicedTotals([])).toEqual({ invoicedOre: 0, draftOre: 0 });
  });
});

describe("paidOre", () => {
  it("summerar betalningar; saknade betalningar = 0", () => {
    expect(paidOre([inv("a", 1, "SENT", { payments: [{ amount: 10 }, { amount: 5 }] }), inv("b", 1, "PAID", { payments: null }), inv("c", 1, "SENT")])).toBe(15);
  });
});
