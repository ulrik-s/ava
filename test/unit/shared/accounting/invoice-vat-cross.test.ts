/**
 * Korstest (#1806): verifikatet och fakturadokumentet ger samma moms för samma
 * faktura, och verifikatets rader är oförändrade av att tolkningen flyttats
 * till `invoiceVatOre`.
 */

import { describe, it, expect } from "vitest-compat";
import { buildFakturaView } from "@/lib/client/kostnadsrakning/faktura-template";
import { buildSemanticVoucher, type SemanticVoucherRow } from "@/lib/shared/accounting/semantic-voucher";
import { asId } from "@/lib/shared/schemas/ids";

const base = { id: asId<"InvoiceId">("inv-1"), invoiceDate: "2026-06-30", invoiceNumber: "F-2026-0001" };

const CASES = [
  {
    name: "uppdelning finns (bara 25 %)",
    invoice: {
      ...base, amount: 15_000, vatOre: 3_000,
      vatBreakdown: [
        { kind: "arvode" as const, vatRate: 2500, netOre: 10_000, vatOre: 2_500 },
        { kind: "utlagg" as const, vatRate: 2500, netOre: 2_000, vatOre: 500 },
      ],
    },
    rows: [
      { role: "kundfordran", debit: 15_000, credit: 0 },
      { role: "intaktArvode", debit: 0, credit: 10_000 },
      { role: "intaktUtlagg", debit: 0, credit: 2_000 },
      { role: "momsUtgaende", debit: 0, credit: 3_000 },
    ],
    vat: 3_000,
  },
  {
    name: "bara vatOre",
    invoice: { ...base, amount: 10_600, vatOre: 600 },
    rows: [
      { role: "kundfordran", debit: 10_600, credit: 0 },
      { role: "intaktArvode", debit: 0, credit: 10_000 },
      { role: "momsUtgaende", debit: 0, credit: 600 },
    ],
    vat: 600,
  },
  {
    name: "vatOre null",
    invoice: { ...base, amount: 12_500, vatOre: null },
    rows: [
      { role: "kundfordran", debit: 12_500, credit: 0 },
      { role: "intaktArvode", debit: 0, credit: 10_000 },
      { role: "momsUtgaende", debit: 0, credit: 2_500 },
    ],
    vat: 2_500,
  },
  {
    name: "kredit utan vatOre",
    invoice: { ...base, amount: -12_500 },
    rows: [
      { role: "kundfordran", debit: 0, credit: 12_500 },
      { role: "intaktArvode", debit: 10_000, credit: 0 },
      { role: "momsUtgaende", debit: 2_500, credit: 0 },
    ],
    vat: -2_500,
  },
];

/** Verifikatets utgående moms med tecken (0 när raden saknas). */
function voucherVat(rows: SemanticVoucherRow[]): number {
  const moms = rows.find((r) => r.role === "momsUtgaende");
  return moms ? moms.credit - moms.debit : 0;
}

describe("fakturans moms: verifikat och dokument (#1806)", () => {
  for (const c of CASES) {
    it(`${c.name}: verifikatets rader är oförändrade`, () => {
      expect(buildSemanticVoucher(c.invoice).rows).toEqual(c.rows);
    });

    it(`${c.name}: verifikatets moms = dokumentets Moms-rad`, () => {
      const view = buildFakturaView({ invoice: c.invoice, recipient: "K", meta: { matterNumber: "1", matterTitle: "T" } }, String);
      const momsRow = view.splitRows.find((r) => r.label === "Moms");
      expect(voucherVat(buildSemanticVoucher(c.invoice).rows)).toBe(c.vat);
      expect(Number(momsRow?.amount)).toBe(c.vat);
    });
  }
});
