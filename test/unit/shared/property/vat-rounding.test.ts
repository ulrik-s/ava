/**
 * Egenskapstester (fast-check) för momsuppdelning och avrundning: `vat.ts`,
 * `whole-kronor.ts` (#1438) och `expense-vat.ts` (#975).
 *
 * Exempeltesterna bredvid kontrollerar några utvalda belopp. Här prövas
 * reglerna mot tusentals genererade belopp: att netto + moms alltid är exakt
 * bruttot, att avrundningen aldrig glider mer än den dokumenterade toleransen
 * och att öresavrundningen är den lagstadgade (1–49 öre nedåt, 50–99 uppåt).
 *
 * Ett fel skriver ut motexemplet och en `seed`/`path`; återskapa med
 * `fc.assert(…, { seed, path })`.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest-compat";
import { chargedExpenseLines, expenseNetOre, type ChargeableExpense } from "@/lib/shared/expense-vat";
import type { AmountRounding } from "@/lib/shared/schemas/enums";
import { splitVat } from "@/lib/shared/vat";
import { kronorQuotient, roundRow, roundToKronor, splitGross, timeRowOre, vatOnRow } from "@/lib/shared/whole-kronor";
import { isWholeKronor, oreAmount, rounding, signedOre, sum, vatRate, wholeKronor } from "../../helpers/arbitraries";

/**
 * Öresavrundningen (lag (1970:1029)) av bråket `ore / divisor`, räknad EXAKT med
 * BigInt — en oberoende väg till samma svar, utan flyttal. Halva kronor avrundas
 * bort från noll och negativa belopp speglas, som i `whole-kronor.ts`.
 */
function oresavrundat(ore: number, divisor: number): number {
  const n = BigInt(Math.abs(ore));
  const d = BigInt(divisor) * 100n;
  const kronor = Number((2n * n + d) / (2n * d)) * 100;
  return ore < 0 ? 0 - kronor : kronor;
}

/** Avvikelsen mellan momsen och satsen × nettot, i öre × 10 000 (heltal). */
const vatDeviation = (vat: number, net: number, bips: number): number => Math.abs(vat * 10_000 - net * bips);

describe("roundToKronor — öresavrundningen", () => {
  it("ger hela kronor högst 50 öre från beloppet", () => {
    fc.assert(fc.property(signedOre, (ore) => {
      const r = roundToKronor(ore);
      expect(isWholeKronor(r)).toBe(true);
      expect(Math.abs(r - ore)).toBeLessThanOrEqual(50);
    }));
  });

  it("är lagens regel: 1–49 öre nedåt, 50–99 uppåt, negativa speglade och aldrig −0", () => {
    fc.assert(fc.property(signedOre, (ore) => {
      expect(roundToKronor(ore)).toBe(oresavrundat(ore, 1));
      expect(Object.is(roundToKronor(ore), -0)).toBe(false);
    }));
  });

  it("är monoton: ett större belopp avrundas aldrig till mindre", () => {
    fc.assert(fc.property(signedOre, signedOre, (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      expect(roundToKronor(lo)).toBeLessThanOrEqual(roundToKronor(hi));
    }));
  });
});

describe("kronorQuotient / timeRowOre — EN avrundning av en kvot", () => {
  it("är öresavrundningen av den exakta kvoten (ingen dubbelavrundning)", () => {
    const divisor = fc.integer({ min: 1, max: 100_000 });
    fc.assert(fc.property(signedOre, divisor, (ore, d) => {
      expect(kronorQuotient(ore, d)).toBe(oresavrundat(ore, d));
    }));
  });

  it("tid × timpris: hela kronor av minuter × öre/tim / 60, och mer tid ger aldrig mindre", () => {
    const minutes = fc.integer({ min: 0, max: 100_000 });
    const rate = fc.integer({ min: 0, max: 1_000_000 });
    fc.assert(fc.property(minutes, minutes, rate, (a, b, r) => {
      expect(timeRowOre(a, r)).toBe(oresavrundat(a * r, 60));
      expect(timeRowOre(Math.min(a, b), r)).toBeLessThanOrEqual(timeRowOre(Math.max(a, b), r));
    }));
  });
});

describe("vatOnRow — momsen på en rad", () => {
  it("hela kronor: högst 50 öre från satsen × nettot, speglad för krediteringar", () => {
    fc.assert(fc.property(signedOre, vatRate, (net, bips) => {
      const vat = vatOnRow(net, bips, "KRONOR");
      expect(isWholeKronor(vat)).toBe(true);
      expect(vatDeviation(vat, net, bips)).toBeLessThanOrEqual(50 * 10_000);
      expect(vatOnRow(-net, bips, "KRONOR")).toBe(0 - vat);
    }));
  });

  it("öre (äldre fakturor): högst ett halvt öre från satsen × nettot", () => {
    fc.assert(fc.property(signedOre, vatRate, (net, bips) => {
      expect(vatDeviation(vatOnRow(net, bips, "ORE"), net, bips)).toBeLessThanOrEqual(5_000);
    }));
  });

  it("är aldrig negativ på ett positivt netto och växer aldrig baklänges", () => {
    fc.assert(fc.property(oreAmount, oreAmount, vatRate, rounding, (a, b, bips, r) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      expect(vatOnRow(lo, bips, r)).toBeGreaterThanOrEqual(0);
      expect(vatOnRow(lo, bips, r)).toBeLessThanOrEqual(vatOnRow(hi, bips, r));
    }));
  });
});

describe("splitGross — brutto i netto och moms", () => {
  it("netto + moms är EXAKT bruttot, oavsett tecken och avrundningssätt", () => {
    fc.assert(fc.property(signedOre, vatRate, rounding, (gross, bips, r) => {
      const { netOre, vatOre } = splitGross(gross, bips, r);
      expect(netOre + vatOre).toBe(gross);
    }));
  });

  it("momsen avviker från satsen × nettot med högst nettots avrundning × (1 + sats)", () => {
    // Nettot avrundas (±50 öre resp. ±½ öre) och momsen är resten, så felet i
    // momsen är nettots fel gånger 1 + satsen: under en krona på en 25 %-rad.
    fc.assert(fc.property(signedOre, vatRate, rounding, (gross, bips, r) => {
      const { netOre, vatOre } = splitGross(gross, bips, r);
      const netError = r === "KRONOR" ? 50 : 0.5;
      expect(vatDeviation(vatOre, netOre, bips)).toBeLessThanOrEqual(netError * (10_000 + bips));
      // Momsfritt behåller nettot bruttots ören (ett belopp utifrån tas som det är).
      if (r === "KRONOR" && bips > 0) expect(isWholeKronor(netOre)).toBe(true);
    }));
  });

  it("ett brutto i hela kronor ger netto och moms i hela kronor, båda ≥ 0", () => {
    // Under 2,50 kr med ören kan nettot avrundas UPP förbi bruttot (1,90 kr →
    // netto 2 kr, moms −0,10 kr). Det är regeln (nettot är raden, momsen resten)
    // och träffar bara belopp utifrån på några kronor — AVA:s egna är hela kronor.
    fc.assert(fc.property(wholeKronor, vatRate, (gross, bips) => {
      const { netOre, vatOre } = splitGross(gross, bips, "KRONOR");
      expect(isWholeKronor(netOre) && isWholeKronor(vatOre)).toBe(true);
      expect(netOre).toBeGreaterThanOrEqual(0);
      expect(vatOre).toBeGreaterThanOrEqual(0);
    }));
  });

  it("momsfritt: hela bruttot är netto", () => {
    fc.assert(fc.property(signedOre, rounding, (gross, r) => {
      expect(splitGross(gross, 0, r)).toEqual({ netOre: gross, vatOre: 0 });
    }));
  });
});

describe("splitVat — exkl/moms/inkl", () => {
  const input = fc.record({ amount: oreAmount, vatRate, vatIncluded: fc.boolean() });

  it("exkl + moms = inkl, och det givna beloppet bevaras på sin sida", () => {
    fc.assert(fc.property(input, (i) => {
      const s = splitVat(i);
      expect(s.exclVat + s.vat).toBe(s.inclVat);
      expect(i.vatIncluded ? s.inclVat : s.exclVat).toBe(i.amount);
      expect(Math.min(s.exclVat, s.vat, s.inclVat)).toBeGreaterThanOrEqual(0);
      if (i.vatRate === 0) expect(s.vat).toBe(0);
    }));
  });

  it("momsen avviker högst 1 öre från satsen × exkl (modulens dokumenterade tolerans)", () => {
    fc.assert(fc.property(input, (i) => {
      const s = splitVat(i);
      expect(vatDeviation(s.vat, s.exclVat, i.vatRate)).toBeLessThanOrEqual(10_000);
    }));
  });

  it("inkl → exkl → inkl glider högst 1 öre", () => {
    fc.assert(fc.property(oreAmount, vatRate, (incl, bips) => {
      const { exclVat } = splitVat({ amount: incl, vatRate: bips, vatIncluded: true });
      const back = splitVat({ amount: exclVat, vatRate: bips, vatIncluded: false }).inclVat;
      expect(Math.abs(back - incl)).toBeLessThanOrEqual(1);
    }));
  });
});

/** Ett utlägg som det lagras: netto eller brutto, med byråns sats, ibland äkta. */
const expense: fc.Arbitrary<ChargeableExpense> = fc.record(
  { amount: fc.integer({ min: 0, max: 1_000_000_000 }), vatRate, vatIncluded: fc.boolean(), passThrough: fc.boolean() },
  { requiredKeys: ["amount"] },
);

type ExpenseLines = ReturnType<typeof chargedExpenseLines>;

const netOfRate = (lines: ExpenseLines, bips: number): number =>
  sum(lines.filter((l) => l.vatRate === bips).map((l) => l.netOre));

/** Satserna som förekommer, i den ordning fakturan ska visa dem: 25 % före 0 %. */
const expectedRates = (lines: ExpenseLines): number[] => [2500, 0].filter((bips) => netOfRate(lines, bips) !== 0);

/** Summan av utläggens avrundade rader — kostnadselementen eller de äkta utläggen. */
const roundedRowSum = (expenses: readonly ChargeableExpense[], r: AmountRounding, passThrough: boolean): number =>
  sum(expenses.filter((e) => (e.passThrough === true) === passThrough).map((e) => roundRow(expenseNetOre(e), r)));

describe("expenseNetOre — underlaget som debiteras vidare", () => {
  it("är aldrig mer än beloppet, och lika med det för netto och äkta utlägg", () => {
    fc.assert(fc.property(expense, (e) => {
      const net = expenseNetOre(e);
      expect(net).toBeGreaterThanOrEqual(0);
      expect(net).toBeLessThanOrEqual(e.amount);
      if (e.passThrough === true || e.vatIncluded !== true) expect(net).toBe(e.amount);
    }));
  });
});

describe("chargedExpenseLines — fakturans utläggsrader", () => {
  it("en 25 %-rad för kostnadselementen och en 0 %-rad för äkta utlägg — summan av de avrundade raderna", () => {
    fc.assert(fc.property(fc.array(expense, { maxLength: 12 }), rounding, (expenses, r) => {
      const lines = chargedExpenseLines(expenses, r);
      expect(lines.map((l) => l.vatRate)).toEqual(expectedRates(lines));
      expect(lines.every((l) => l.kind === "utlagg")).toBe(true);
      expect(netOfRate(lines, 2500)).toBe(roundedRowSum(expenses, r, false));
      expect(netOfRate(lines, 0)).toBe(roundedRowSum(expenses, r, true));
    }));
  });

  it("momsen är 25 % av radens netto avrundad som raden, äkta utlägg utan moms", () => {
    fc.assert(fc.property(fc.array(expense, { maxLength: 12 }), rounding, (expenses, r) => {
      for (const l of chargedExpenseLines(expenses, r)) {
        expect(l.vatOre).toBe(l.vatRate === 0 ? 0 : vatOnRow(l.netOre, 2500, r));
        expect(l.netOre).toBeGreaterThan(0);
        if (r === "KRONOR") expect(isWholeKronor(l.netOre) && isWholeKronor(l.vatOre)).toBe(true);
      }
    }));
  });

  it("ordningen mellan utläggen spelar ingen roll", () => {
    const shuffled = fc.array(expense, { maxLength: 12 }).chain((xs) => fc.tuple(fc.constant(xs), fc.shuffledSubarray(xs, { minLength: xs.length })));
    fc.assert(fc.property(shuffled, rounding, ([xs, ys], r) => {
      expect(chargedExpenseLines(ys, r)).toEqual(chargedExpenseLines(xs, r));
    }));
  });
});
