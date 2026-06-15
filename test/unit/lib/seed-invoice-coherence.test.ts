/**
 * Bevisar att demo-seed:en (#350) bara genererar GILTIGA, ledger-koherenta
 * faktura-tillstånd — inga omöjliga kombinationer (PAID utan täckande betalning,
 * eller betalning registrerad på en DRAFT/CANCELLED-faktura).
 */

import { describe, it, expect } from "vitest-compat";
import { INVOICE_TRANSITIONS } from "@/lib/shared/invoice-state-machine";
import { buildSeed } from "@/../tooling/scripts/seed-data";

type Inv = { id: string; status: string; amount?: number; amountInclVat?: number };
type Pay = { invoiceId: string; amount: number };

const seed = buildSeed();
const invoices = seed.invoices as unknown as Inv[];
const payments = seed.payments as unknown as Pay[];
const byId = new Map(invoices.map((i) => [i.id, i]));
const VALID = new Set(Object.keys(INVOICE_TRANSITIONS));

function paidSum(invoiceId: string): number {
  return payments.filter((p) => p.invoiceId === invoiceId).reduce((s, p) => s + p.amount, 0);
}
function amountOf(inv: Inv): number {
  return inv.amountInclVat ?? inv.amount ?? 0;
}

describe("seed invoice-koherens (#350)", () => {
  it("seedar minst en faktura", () => {
    expect(invoices.length).toBeGreaterThan(0);
  });

  it("varje faktura har ett giltigt status-värde", () => {
    for (const inv of invoices) {
      expect(VALID.has(inv.status)).toBe(true);
    }
  });

  it("ingen betalning är registrerad på en DRAFT- eller CANCELLED-faktura", () => {
    for (const p of payments) {
      const inv = byId.get(p.invoiceId);
      if (!inv) continue; // betalning mot icke-seedad faktura ignoreras
      expect(["DRAFT", "CANCELLED"]).not.toContain(inv.status);
    }
  });

  it("varje PAID-faktura är täckt av betalningar (PAID ⇒ ledger-koherent)", () => {
    const paid = invoices.filter((i) => i.status === "PAID");
    expect(paid.length).toBeGreaterThan(0); // demon ska ha betalda fakturor
    for (const inv of paid) {
      expect(paidSum(inv.id)).toBeGreaterThanOrEqual(amountOf(inv));
    }
  });
});
