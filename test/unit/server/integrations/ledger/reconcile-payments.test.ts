import { describe, it, expect } from "vitest-compat";
import { reconcileLedgerPayments, type ReconcileInvoice } from "@/lib/server/integrations/ledger/reconcile-payments";
import type { LedgerPayment } from "@/lib/server/integrations/ledger/port";

const pay = (over: Partial<LedgerPayment> = {}): LedgerPayment => ({
  externalId: "tx-1",
  amount: 12_500,
  ocrReference: "2026004206",
  ...over,
});

const inv = (over: Partial<ReconcileInvoice> = {}): ReconcileInvoice => ({
  id: "inv-1",
  ocrReference: "2026004206",
  paymentReferences: [],
  ...over,
});

describe("reconcileLedgerPayments", () => {
  it("matchar betalning mot faktura via OCR-referens", () => {
    const out = reconcileLedgerPayments([pay({ date: "2026-06-01", payerName: "Klient AB" })], [inv()]);
    expect(out.unmatched).toHaveLength(0);
    expect(out.bookable).toEqual([
      { invoiceId: "inv-1", amountOre: 12_500, reference: "tx-1", date: "2026-06-01", payerName: "Klient AB" },
    ]);
  });

  it("betalning utan OCR → granskning (saknar-ocr)", () => {
    const out = reconcileLedgerPayments([pay({ ocrReference: undefined })], [inv()]);
    expect(out.bookable).toHaveLength(0);
    expect(out.unmatched[0]?.reason).toBe("saknar-ocr");
  });

  it("OCR utan matchande faktura → granskning (ingen-träff)", () => {
    const out = reconcileLedgerPayments([pay({ ocrReference: "9999999999" })], [inv()]);
    expect(out.bookable).toHaveLength(0);
    expect(out.unmatched[0]?.reason).toBe("ingen-träff");
  });

  it("redan bokförd referens → dubblett (idempotens)", () => {
    const out = reconcileLedgerPayments([pay()], [inv({ paymentReferences: ["tx-1"] })]);
    expect(out.bookable).toHaveLength(0);
    expect(out.unmatched[0]?.reason).toBe("dubblett");
  });

  it("matchar oavsett OCR-formatering (mellanslag normaliseras bort)", () => {
    const out = reconcileLedgerPayments([pay({ ocrReference: "2026 0042 06" })], [inv({ ocrReference: "2026004206" })]);
    expect(out.bookable).toHaveLength(1);
  });
});
