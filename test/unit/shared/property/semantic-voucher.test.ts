/**
 * Egenskapstester (fast-check) för verifikaten (`semantic-voucher.ts`, ADR 0011).
 *
 * Modulens löfte är att Σdebet == Σkredit ALLTID håller — för debet- och
 * kreditfakturor, med och utan momsuppdelning, och för inbetalningar. Här prövas
 * det mot tusentals genererade fakturor i stället för ett par handplockade.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest-compat";
import {
  buildPaymentVoucher, buildSemanticVoucher, type SemanticVoucher, type VatBreakdownLine,
} from "@/lib/shared/accounting/semantic-voucher";
import { VAT_RATES } from "@/lib/shared/vat";
import { signedOre, sum } from "../../helpers/arbitraries";

const debit = (v: SemanticVoucher): number => sum(v.rows.map((r) => r.debit));
const credit = (v: SemanticVoucher): number => sum(v.rows.map((r) => r.credit));
/** Kundfordrans saldo i verifikatet: debet − kredit. */
const kundfordran = (v: SemanticVoucher): number => sum(v.rows.filter((r) => r.role === "kundfordran").map((r) => r.debit - r.credit));

/** Varje rad: heltal, ingen negativ sida och exakt en sida > 0. */
const wellFormedRows = (v: SemanticVoucher): boolean => v.rows.every((r) =>
  Number.isInteger(r.debit) && Number.isInteger(r.credit) && Math.min(r.debit, r.credit) === 0 && Math.max(r.debit, r.credit) > 0);

/**
 * En momsrad som någon av AVA:s vägar kan bygga: en av de svenska satserna,
 * vilka belopp och tecken som helst (krediter, avrundningsrester) — men en
 * 0 %-rad bär ingen moms. Utan den förutsättningen balanserar verifikatet inte:
 * momsen på en sats utan momskonto (0 %, eller en sats som inte är 6/12/25 %)
 * räknas in i kundfordran men bokförs ingenstans — se #1693.
 */
const breakdownLine: fc.Arbitrary<VatBreakdownLine> = fc.record({
  kind: fc.constantFrom<VatBreakdownLine["kind"]>("arvode", "utlagg"),
  vatRate: fc.constantFrom(...VAT_RATES),
  netOre: signedOre,
  vatOre: signedOre,
}).map((l) => (l.vatRate === 0 ? { ...l, vatOre: 0 } : l));

const breakdown = fc.array(breakdownLine, { minLength: 1, maxLength: 8 });

const invoiceDate = "2026-03-15";

describe("buildSemanticVoucher med momsuppdelning (#790, #977)", () => {
  it("balanserar alltid: Σdebet = Σkredit, och varje rad har exakt en sida", () => {
    fc.assert(fc.property(breakdown, (lines) => {
      const v = buildSemanticVoucher({ amount: 0, vatBreakdown: lines, invoiceDate });
      expect(debit(v)).toBe(credit(v));
      expect(wellFormedRows(v)).toBe(true);
    }));
  });

  it("kundfordran är fakturans brutto med tecken: Σ(netto + moms)", () => {
    fc.assert(fc.property(breakdown, (lines) => {
      const v = buildSemanticVoucher({ amount: 0, vatBreakdown: lines, invoiceDate });
      expect(kundfordran(v)).toBe(sum(lines.map((l) => l.netOre + l.vatOre)));
    }));
  });

  it("en kreditering är originalet spegelvänt, post för post", () => {
    fc.assert(fc.property(breakdown, (lines) => {
      const negated = lines.map((l) => ({ ...l, netOre: 0 - l.netOre, vatOre: 0 - l.vatOre }));
      const original = buildSemanticVoucher({ amount: 0, vatBreakdown: lines, invoiceDate });
      const kredit = buildSemanticVoucher({ amount: 0, vatBreakdown: negated, invoiceDate });
      expect(kredit.rows).toEqual(original.rows.map((r) => ({ role: r.role, debit: r.credit, credit: r.debit })));
    }));
  });

  it("varje roll förekommer högst en gång", () => {
    fc.assert(fc.property(breakdown, (lines) => {
      const roles = buildSemanticVoucher({ amount: 0, vatBreakdown: lines, invoiceDate }).rows.map((r) => r.role);
      expect(new Set(roles).size).toBe(roles.length);
    }));
  });
});

describe("buildSemanticVoucher utan uppdelning (äldre fakturor)", () => {
  it("balanserar och bokför |beloppet| på kundfordran — även med inkonsistent moms", () => {
    const vatOre = fc.option(signedOre, { nil: null });
    fc.assert(fc.property(signedOre, vatOre, fc.constantFrom(...VAT_RATES), (amount, vat, rate) => {
      const v = buildSemanticVoucher({ amount, vatOre: vat, invoiceDate }, rate);
      expect(debit(v)).toBe(credit(v));
      expect(debit(v)).toBe(Math.abs(amount));
      expect(kundfordran(v)).toBe(amount);
      expect(wellFormedRows(v)).toBe(true);
    }));
  });
});

describe("buildPaymentVoucher — inbetalningen (#1173)", () => {
  it("bank och kundfordran rör sig lika mycket åt var sitt håll", () => {
    fc.assert(fc.property(signedOre.filter((a) => a !== 0), (amount) => {
      const v = buildPaymentVoucher({ amount, paidAt: invoiceDate });
      expect(debit(v)).toBe(credit(v));
      expect(debit(v)).toBe(Math.abs(amount));
      expect(kundfordran(v)).toBe(0 - amount);
      expect(wellFormedRows(v)).toBe(true);
    }));
  });
});
