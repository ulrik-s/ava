/**
 * Egenskapstester (fast-check) för fakturans belopp: slutfakturan
 * (`invoice-calc.ts`), acontoavräkningen (`acconto-vat.ts`, #968) och
 * kostnadsräkningens yrkande (`kr-claim.ts`, #1218).
 *
 * Reglerna som prövas: ingen krona försvinner eller tillkommer i en avräkning,
 * allt AVA räknar fram är hela kronor (#1438), mer arbete ger aldrig ett lägre
 * belopp, och slutfakturan vänder exakt den intäkt och moms acontot bokförde.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest-compat";
import type { VatBreakdownLine } from "@/lib/shared/accounting/semantic-voucher";
import { accontoCreditAmounts, accontoCreditLines, accontoSplit, deductAcconto } from "@/lib/shared/billing/acconto-vat";
import { computeFinalInvoiceBreakdown, isPaymentPlanSettled, type ExpenseForInvoice, type TimeEntryForInvoice } from "@/lib/shared/billing/invoice-calc";
import { krClaim } from "@/lib/shared/billing/kr-claim";
import { vatOnRow } from "@/lib/shared/billing/whole-kronor";
import type { AmountRounding } from "@/lib/shared/schemas/enums";
import { isWholeKronor, oreAmount, rounding, signedOre, sum, vatRate, wholeKronor } from "../../helpers/arbitraries";

const grossOf = (lines: readonly VatBreakdownLine[]): number => sum(lines.map((l) => l.netOre + l.vatOre));
const netOf = (lines: readonly VatBreakdownLine[]): number => sum(lines.map((l) => l.netOre));
const vatOf = (lines: readonly VatBreakdownLine[]): number => sum(lines.map((l) => l.vatOre));

// ─── Slutfakturan ─────────────────────────────────────────────────────────

const timeEntry: fc.Arbitrary<TimeEntryForInvoice> = fc.record({
  minutes: fc.integer({ min: 0, max: 6_000 }),
  hourlyRate: fc.integer({ min: 0, max: 1_000_000 }),
});

const invoiceExpense: fc.Arbitrary<ExpenseForInvoice> = fc.record(
  {
    amount: fc.integer({ min: 0, max: 100_000_000 }),
    billable: fc.boolean(),
    vatRate,
    vatIncluded: fc.boolean(),
    passThrough: fc.boolean(),
  },
  { requiredKeys: ["amount", "billable"] },
);

const work = fc.record({
  times: fc.array(timeEntry, { maxLength: 15 }),
  expenses: fc.array(invoiceExpense, { maxLength: 8 }),
});

const noAcconto = [] as const;

describe("computeFinalInvoiceBreakdown — slutfakturan", () => {
  it("bruttot är hela kronor och arvodets moms högst 50 öre från 25 %", () => {
    fc.assert(fc.property(work, ({ times, expenses }) => {
      const b = computeFinalInvoiceBreakdown(times, expenses, noAcconto);
      expect(isWholeKronor(b.grossAmount) && isWholeKronor(b.arvodeVatOre)).toBe(true);
      const arvodeNet = b.grossAmount - b.arvodeVatOre - computeFinalInvoiceBreakdown([], expenses, noAcconto).grossAmount;
      expect(Math.abs(b.arvodeVatOre * 4 - arvodeNet)).toBeLessThanOrEqual(200);
      expect(b.netAmount).toBe(b.grossAmount);
    }));
  });

  it("mer arbete eller ett debiterbart utlägg till ger aldrig ett lägre brutto", () => {
    fc.assert(fc.property(work, timeEntry, invoiceExpense, ({ times, expenses }, t, e) => {
      const before = computeFinalInvoiceBreakdown(times, expenses, noAcconto).grossAmount;
      expect(computeFinalInvoiceBreakdown([...times, t], expenses, noAcconto).grossAmount).toBeGreaterThanOrEqual(before);
      expect(computeFinalInvoiceBreakdown(times, [...expenses, e], noAcconto).grossAmount).toBeGreaterThanOrEqual(before);
    }));
  });

  it("ett icke-debiterbart utlägg påverkar inte fakturan", () => {
    fc.assert(fc.property(work, invoiceExpense, ({ times, expenses }, e) => {
      const without = computeFinalInvoiceBreakdown(times, expenses, noAcconto);
      expect(computeFinalInvoiceBreakdown(times, [...expenses, { ...e, billable: false }], noAcconto)).toEqual(without);
    }));
  });

  it("netto = brutto − aconton, och fakturan vägrar bli negativ", () => {
    const accontos = fc.array(fc.record({ id: fc.uuid(), amount: fc.integer({ min: 0, max: 10_000_000 }) }), { maxLength: 4 });
    fc.assert(fc.property(work, accontos, ({ times, expenses }, as) => {
      const gross = computeFinalInvoiceBreakdown(times, expenses, noAcconto).grossAmount;
      const deducted = sum(as.map((a) => a.amount));
      if (deducted > gross) {
        expect(() => computeFinalInvoiceBreakdown(times, expenses, as)).toThrow("Slutfakturan blir negativ");
        return;
      }
      const b = computeFinalInvoiceBreakdown(times, expenses, as);
      expect(b.netAmount).toBe(gross - deducted);
      expect(b.accontoDeductionTotal).toBe(deducted);
      expect(b.deductions).toEqual(as.map((a) => ({ accontoInvoiceId: a.id, amount: a.amount })));
    }));
  });
});

describe("isPaymentPlanSettled", () => {
  it("är färdigbetald exakt när betalningarna når beloppet — och förblir det", () => {
    fc.assert(fc.property(oreAmount, oreAmount, oreAmount, (amount, paid, more) => {
      expect(isPaymentPlanSettled(amount, paid)).toBe(paid >= amount);
      if (isPaymentPlanSettled(amount, paid)) expect(isPaymentPlanSettled(amount, paid + more)).toBe(true);
    }));
  });
});

// ─── Acontoavräkningen ────────────────────────────────────────────────────

/** En rad i fakturans momsuppdelning som AVA bygger den: arvode alltid 25 %. */
function breakdownLineOf(net: fc.Arbitrary<number>, r: fc.Arbitrary<AmountRounding>): fc.Arbitrary<VatBreakdownLine> {
  return fc.record({ arvode: fc.boolean(), rate: vatRate, netOre: net, rounding: r }).map(({ arvode, rate, netOre, rounding }) => {
    const bips = arvode ? 2500 : rate;
    return { kind: arvode ? "arvode" : "utlagg", vatRate: bips, netOre, vatOre: vatOnRow(netOre, bips, rounding) };
  });
}

const breakdownLine = breakdownLineOf(fc.integer({ min: 1, max: 1_000_000_000 }), rounding);

const isUtlagg = (l: VatBreakdownLine): boolean => l.kind === "utlagg";

const lines = fc.array(breakdownLine, { maxLength: 6 });

describe("deductAcconto — slutfakturan bär bara det som återstår", () => {
  it("ingen krona försvinner: avdraget + det som inte fick plats = acontot", () => {
    fc.assert(fc.property(lines, signedOre, (ls, deduction) => {
      const res = deductAcconto(ls, deduction);
      expect(grossOf(ls) - grossOf(res.lines) + res.overpaidGrossOre).toBe(Math.max(0, deduction));
      expect(res.deductedNetOre + res.deductedVatOre).toBe(grossOf(ls) - grossOf(res.lines));
      expect(res.deductedNetOre).toBe(netOf(ls) - netOf(res.lines));
    }));
  });

  it("överskjutande belopp finns bara när hela fakturan är förbrukad", () => {
    fc.assert(fc.property(lines, oreAmount, (ls, deduction) => {
      const res = deductAcconto(ls, deduction);
      expect(res.overpaidGrossOre).toBe(Math.max(0, deduction - grossOf(ls)));
      if (res.overpaidGrossOre > 0) expect(res.lines).toEqual([]);
      expect(res.lines.every((l) => l.netOre + l.vatOre > 0)).toBe(true);
    }));
  });

  it("raderna behåller sin ordning och sina satser — inga nya satser uppstår", () => {
    fc.assert(fc.property(lines, oreAmount, (ls, deduction) => {
      const kept = deductAcconto(ls, deduction).lines.map((l) => `${l.kind}:${l.vatRate}`);
      const original = ls.map((l) => `${l.kind}:${l.vatRate}`);
      expect(isSubsequence(kept, original)).toBe(true);
    }));
  });

  it("acontot kvittas mot arvodet först: ett utlägg minskas bara när arvodet är slut", () => {
    fc.assert(fc.property(lines, oreAmount, (ls, deduction) => {
      const res = deductAcconto(ls, deduction);
      const utlaggTouched = grossOf(ls.filter(isUtlagg)) !== grossOf(res.lines.filter(isUtlagg));
      if (utlaggTouched) expect(res.lines.filter((l) => !isUtlagg(l))).toEqual([]);
    }));
  });

  it("ryms acontot i arvodesraden vänds exakt den intäkt och moms acontofakturan bokförde", () => {
    fc.assert(fc.property(wholeKronor, lines, wholeKronor, (arvodeNet, utlagg, deduction) => {
      const arvode: VatBreakdownLine = { kind: "arvode", vatRate: 2500, netOre: arvodeNet, vatOre: vatOnRow(arvodeNet, 2500) };
      fc.pre(deduction <= arvode.netOre + arvode.vatOre);
      const res = deductAcconto([arvode, ...utlagg.filter(isUtlagg)], deduction);
      expect({ netOre: res.deductedNetOre, vatOre: res.deductedVatOre }).toEqual(accontoSplit(deduction));
    }));
  });

  it("hela kronor in ger hela kronor ut (#1438)", () => {
    const kronorLine = breakdownLineOf(fc.integer({ min: 1, max: 10_000_000 }).map((kr) => kr * 100), fc.constant<AmountRounding>("KRONOR"));
    fc.assert(fc.property(fc.array(kronorLine, { maxLength: 6 }), wholeKronor, (ls, deduction) => {
      const res = deductAcconto(ls, deduction);
      const amounts = [...res.lines.flatMap((l) => [l.netOre, l.vatOre]), res.deductedNetOre, res.deductedVatOre, res.overpaidGrossOre];
      expect(amounts.every(isWholeKronor)).toBe(true);
    }));
  });
});

describe("accontoCreditAmounts / accontoCreditLines — krediteringen när acontot var för stort", () => {
  it("krediterar exakt mellanskillnaden mellan acontot och fakturans rader", () => {
    fc.assert(fc.property(lines, oreAmount, (ls, deduction) => {
      const credit = accontoCreditAmounts(ls, deduction);
      expect(credit.netOre + credit.vatOre).toBe(deduction - grossOf(ls));
      const creditLines = accontoCreditLines(ls, deduction);
      expect(grossOf(creditLines)).toBe(grossOf(ls) - deduction);
      expect({ net: netOf(creditLines), vat: vatOf(creditLines) }).toEqual({ net: 0 - credit.netOre, vat: 0 - credit.vatOre });
    }));
  });
});

/** Är `sub` en delsekvens av `all` (samma ordning, ev. luckor)? */
function isSubsequence(sub: readonly string[], all: readonly string[]): boolean {
  let i = 0;
  for (const x of all) if (x === sub[i]) i += 1;
  return i === sub.length;
}

// ─── Kostnadsräkningens yrkande ───────────────────────────────────────────

/**
 * Utläggsunderlaget är summor av rader som redan avrundats till hela kronor
 * (`chargedExpenseLines` resp. kostnadsräkningens utläggsrader) — det enda
 * anroparna skickar. Med ören i de äkta utläggen kunde 1 öre mer sänka
 * yrkandet en krona: momsen räknas på den avrundade summan minus det OAVRUNDADE
 * äkta utlägget (motexempel: momspliktigt 807 209,50 kr, äkta 0,00 → 0,01 kr).
 */
const expenseKronor = fc.integer({ min: 0, max: 1_000_000 }).map((kr) => kr * 100);

const claimInput = fc.record({
  arvodeRowsOre: fc.array(fc.integer({ min: 0, max: 1_000_000_000 }), { maxLength: 6 }),
  expenseChargedNetOre: expenseKronor,
  expensePassThroughOre: expenseKronor,
});

describe("krClaim — det yrkade beloppet", () => {
  it("varje rad hela kronor högst 50 öre från underlaget, exkl = Σ rader, inkl = exkl + moms", () => {
    fc.assert(fc.property(claimInput, (input) => {
      const c = krClaim(input);
      for (const [i, row] of c.arvodeRowsOre.entries()) {
        expect(isWholeKronor(row)).toBe(true);
        expect(Math.abs(row - (input.arvodeRowsOre[i] ?? Number.NaN))).toBeLessThanOrEqual(50);
      }
      expect(c.arvodeExclVat).toBe(sum(c.arvodeRowsOre));
      expect(c.expenseExclVat).toBe(input.expenseChargedNetOre + input.expensePassThroughOre);
      expect(c.exclVat).toBe(c.arvodeExclVat + c.expenseExclVat);
      expect(c.inclVat).toBe(c.exclVat + c.vat);
      expect([c.exclVat, c.vat, c.inclVat].every(isWholeKronor)).toBe(true);
    }));
  });

  it("momsen är 25 % av det momspliktiga, högst 50 öre fel — äkta utlägg bär ingen moms", () => {
    fc.assert(fc.property(claimInput, (input) => {
      const c = krClaim(input);
      expect(krClaim({ ...input, expensePassThroughOre: 0 }).vat).toBe(c.vat);
      expect(Math.abs(c.vat * 4 - (c.exclVat - input.expensePassThroughOre))).toBeLessThanOrEqual(200);
    }));
  });

  it("mer arbete eller fler utlägg ger aldrig ett lägre yrkande", () => {
    fc.assert(fc.property(claimInput, fc.integer({ min: 0, max: 100_000_000 }), expenseKronor, (input, row, extra) => {
      const base = krClaim(input).inclVat;
      expect(krClaim({ ...input, arvodeRowsOre: [...input.arvodeRowsOre, row] }).inclVat).toBeGreaterThanOrEqual(base);
      expect(krClaim({ ...input, expenseChargedNetOre: input.expenseChargedNetOre + extra }).inclVat).toBeGreaterThanOrEqual(base);
      expect(krClaim({ ...input, expensePassThroughOre: input.expensePassThroughOre + extra }).inclVat).toBeGreaterThanOrEqual(base);
    }));
  });
});
