/**
 * Egenskapstester (fast-check) för verifikaten (`semantic-voucher.ts`, ADR 0011).
 *
 * Modulens löfte är att Σdebet == Σkredit håller för varje verifikat som byggs —
 * för debet- och kreditfakturor, med och utan momsuppdelning, och för
 * inbetalningar — och att en uppdelning som inte går att bokföra ger ett fel (#1902). Här prövas
 * det mot tusentals genererade fakturor i stället för ett par handplockade.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest-compat";
import {
  buildPaymentVoucher, buildSemanticVoucher, type SemanticVoucher, type VatBreakdownLine, type VoucherRole,
} from "@/lib/shared/accounting/semantic-voucher";
import { VAT_RATES } from "@/lib/shared/vat";
import { signedOre, sum, vatRate } from "../../helpers/arbitraries";

const debit = (v: SemanticVoucher): number => sum(v.rows.map((r) => r.debit));
const credit = (v: SemanticVoucher): number => sum(v.rows.map((r) => r.credit));
/** Kundfordrans saldo i verifikatet: debet − kredit. */
const kundfordran = (v: SemanticVoucher): number => sum(v.rows.filter((r) => r.role === "kundfordran").map((r) => r.debit - r.credit));

/** Varje rad: heltal, ingen negativ sida och exakt en sida > 0. */
const wellFormedRows = (v: SemanticVoucher): boolean => v.rows.every((r) =>
  Number.isInteger(r.debit) && Number.isInteger(r.credit) && Math.min(r.debit, r.credit) === 0 && Math.max(r.debit, r.credit) > 0);

/**
 * En momsrad med vilken sats som helst — de svenska och udda satser — och vilka
 * belopp och tecken som helst (krediter, avrundningsrester). En rad med moms på
 * en sats utan momskonto ska ge ett fel, aldrig ett obalanserat verifikat (#1902).
 */
const breakdownLine: fc.Arbitrary<VatBreakdownLine> = fc.record({
  kind: fc.constantFrom<VatBreakdownLine["kind"]>("arvode", "utlagg"),
  vatRate: fc.oneof(vatRate, fc.integer({ min: 0, max: 10_000 })),
  netOre: signedOre,
  vatOre: fc.oneof(fc.constant(0), signedOre),
});

const breakdown = fc.array(breakdownLine, { minLength: 1, maxLength: 8 });

const invoiceDate = "2026-03-15";

/** Facit (#1902): satserna med eget momskonto. */
const RATES_WITH_ACCOUNT = [600, 1200, 2500];
/** Facit (#1902): en rad går att bokföra när den saknar moms eller satsen har ett momskonto. */
const bookable = (l: VatBreakdownLine): boolean => l.vatOre === 0 || RATES_WITH_ACCOUNT.includes(l.vatRate);
const allBookable = (lines: readonly VatBreakdownLine[]): boolean => lines.every(bookable);

/** Verifikatet, eller null när bygget kastar. */
function tryBuild(lines: VatBreakdownLine[]): SemanticVoucher | null {
  try {
    return buildSemanticVoucher({ amount: 0, vatBreakdown: lines, invoiceDate });
  } catch {
    return null;
  }
}

/** Momskontots saldo med tecken (kredit − debet) i verifikatet. */
const momsSaldo = (v: SemanticVoucher, role: VoucherRole): number =>
  sum(v.rows.filter((r) => r.role === role).map((r) => r.credit - r.debit));

describe("buildSemanticVoucher med momsuppdelning (#790, #977, #1902)", () => {
  it("balanserar eller kastar: kastar exakt när en rad inte går att bokföra, annars Σdebet = Σkredit", () => {
    fc.assert(fc.property(breakdown, (lines) => {
      const v = tryBuild(lines);
      expect(v === null).toBe(!allBookable(lines));
      if (!v) return;
      expect(debit(v)).toBe(credit(v));
      expect(wellFormedRows(v)).toBe(true);
    }));
  });

  it("kundfordran är fakturans brutto med tecken: Σ(netto + moms)", () => {
    fc.assert(fc.property(breakdown.filter(allBookable), (lines) => {
      const v = buildSemanticVoucher({ amount: 0, vatBreakdown: lines, invoiceDate });
      expect(kundfordran(v)).toBe(sum(lines.map((l) => l.netOre + l.vatOre)));
    }));
  });

  it("en kreditering är originalet spegelvänt, post för post – eller så kastar båda", () => {
    fc.assert(fc.property(breakdown, (lines) => {
      const negated = lines.map((l) => ({ ...l, netOre: 0 - l.netOre, vatOre: 0 - l.vatOre }));
      const original = tryBuild(lines);
      const kredit = tryBuild(negated);
      expect(kredit === null).toBe(original === null);
      if (!original) return;
      expect(kredit?.rows).toEqual(original.rows.map((r) => ({ role: r.role, debit: r.credit, credit: r.debit })));
    }));
  });

  it("varje roll förekommer högst en gång", () => {
    fc.assert(fc.property(breakdown.filter(allBookable), (lines) => {
      const roles = buildSemanticVoucher({ amount: 0, vatBreakdown: lines, invoiceDate }).rows.map((r) => r.role);
      expect(new Set(roles).size).toBe(roles.length);
    }));
  });

  it("momsen hamnar på satsens eget konto: saldot är Σmoms för raderna med exakt den satsen", () => {
    const roles: ReadonlyArray<[number, VoucherRole]> = [[600, "momsUtgaende06"], [1200, "momsUtgaende12"], [2500, "momsUtgaende"]];
    fc.assert(fc.property(breakdown.filter(allBookable), (lines) => {
      const v = buildSemanticVoucher({ amount: 0, vatBreakdown: lines, invoiceDate });
      for (const [rate, role] of roles) {
        expect(momsSaldo(v, role)).toBe(sum(lines.filter((l) => l.vatRate === rate).map((l) => l.vatOre)));
      }
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
