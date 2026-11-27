/**
 * Egenskapstester (fast-check) för kostnadsräkningen till rätten
 * (`kostnadsrakning.ts`): brottmålstaxa, förordnandemål och löpande räkning.
 *
 * Reglerna: summan är summan av delarna — arvode + utlägg, exkl + moms — och
 * allt är hela kronor (#1218); det yrkande servern lagrar är exakt dokumentets;
 * mer arbete ger aldrig ett lägre yrkande; utan F-skatt aldrig mer än med; och
 * poster som inte är debiterbara eller redan är redovisade påverkar ingenting.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest-compat";
import {
  buildKostnadsrakningContext, kostnadsrakningClaimInclVat, type BuildInput, type ExpenseInput,
  type KostnadsrakningResult, type TimeEntryInput,
} from "@/lib/shared/billing/kostnadsrakning";
import { timeEntryKindSchema, type TimeEntryKind } from "@/lib/shared/schemas/enums";
import { forhor, isWholeKronor, sum, vatRate, yrkandeDate } from "../../helpers/arbitraries";

const MINUTE_MS = 60_000;
const kinds = timeEntryKindSchema.options;

const entryDate = fc.date({ min: new Date("2025-06-01T00:00:00Z"), max: new Date("2026-12-31T00:00:00Z"), noInvalidDate: true });

const timeEntryOf = (kind: fc.Arbitrary<TimeEntryKind>): fc.Arbitrary<TimeEntryInput> => fc.record(
  { id: fc.uuid(), date: entryDate, description: fc.constant("Arbete"), minutes: fc.integer({ min: 0, max: 600 }), billable: fc.boolean(), kind },
  { requiredKeys: ["id", "date", "description", "minutes"] },
);
const timeEntry = timeEntryOf(fc.constantFrom(...kinds));

const expense: fc.Arbitrary<ExpenseInput> = fc.record(
  {
    id: fc.uuid(), date: entryDate, description: fc.constant("Utlägg"), amount: fc.integer({ min: 0, max: 5_000_000 }),
    vatRate, vatIncluded: fc.boolean(), billable: fc.boolean(), passThrough: fc.boolean(),
  },
  { requiredKeys: ["id", "date", "description", "amount"] },
);

/** Ett ärende: huvudförhandling (eller förordnandemål), tid, utlägg, nivå och F-skatt. */
const krInput: fc.Arbitrary<BuildInput> = fc
  .record({
    hufStart: fc.date({ min: new Date("2026-01-01T00:00:00Z"), max: new Date("2026-12-31T00:00:00Z"), noInvalidDate: true }),
    hufMinutes: fc.integer({ min: 0, max: 600 }),
    yrkandeDate,
    taxaLevel: fc.constantFrom(1, 2, 3, 4),
    hasFTax: fc.boolean(),
    isTaxeArende: fc.boolean(),
    expenses: fc.array(expense, { maxLength: 5 }),
    timeEntries: fc.array(timeEntry, { maxLength: 8 }),
    forordnande: fc.option(fc.array(forhor, { maxLength: 3 }), { nil: undefined, freq: 4 }),
  })
  .map(({ hufStart, hufMinutes, forordnande, ...rest }): BuildInput => ({
    ...rest,
    matter: { matterNumber: "2026-0001", title: "Brottmål" },
    defender: { name: "Anna Advokat" },
    hufStart,
    hufEnd: new Date(hufStart.getTime() + hufMinutes * MINUTE_MS),
    ...(forordnande ? { forordnande: { forhor: forordnande } } : {}),
  }));

const build = (input: BuildInput): KostnadsrakningResult => buildKostnadsrakningContext(input);

describe("kostnadsräkningen — summan är summan av delarna", () => {
  it("totalen = arvode inkl moms + utlägg inkl moms, varje del = exkl + moms", () => {
    fc.assert(fc.property(krInput, (input) => {
      const r = build(input);
      expect(r.totalInclVat).toBe(r.arvodeInclVat + r.expenseSummary.inclVat);
      expect(r.arvodeInclVat).toBe(r.arvodeExclVat + r.arvodeMoms);
      expect(r.expenseSummary.inclVat).toBe(r.expenseSummary.exclVat + r.expenseSummary.vat);
      expect(r.expenseSummary.exclVat).toBe(sum(r.expenseLines.map((l) => l.exclVat)));
      for (const l of r.expenseLines) expect(l.inclVat).toBe(l.exclVat + l.vat);
    }));
  });

  it("allt yrkat är hela kronor (#1218)", () => {
    fc.assert(fc.property(krInput, (input) => {
      const r = build(input);
      const amounts = [r.totalInclVat, r.arvodeExclVat, r.arvodeMoms, r.expenseSummary.exclVat, r.expenseSummary.vat];
      expect([...amounts, ...r.expenseLines.flatMap((l) => [l.exclVat, l.vat])].every(isWholeKronor)).toBe(true);
    }));
  });

  it("momsen: arvodets 25 % högst 50 öre fel; utläggens andel ≥ 0 och högst en krona från 25 % av de momspliktiga", () => {
    fc.assert(fc.property(krInput, (input) => {
      const r = build(input);
      const charged = sum(r.expenseLines.filter((l) => l.vatRate !== 0).map((l) => l.exclVat));
      expect(Math.abs(r.arvodeMoms * 4 - r.arvodeExclVat)).toBeLessThanOrEqual(200);
      expect(r.expenseSummary.vat).toBeGreaterThanOrEqual(0);
      expect(Math.abs(r.expenseSummary.vat * 4 - charged)).toBeLessThanOrEqual(400);
    }));
  });

  it("det lagrade yrkandet är exakt dokumentets", () => {
    fc.assert(fc.property(krInput, (input) => {
      expect(kostnadsrakningClaimInclVat(input)).toBe(build(input).totalInclVat);
    }));
  });
});

describe("kostnadsräkningen — det som inte ska räknas påverkar inte", () => {
  it("icke-debiterbara poster och utlägg ändrar inte yrkandet", () => {
    fc.assert(fc.property(krInput, timeEntry, expense, (input, t, e) => {
      const more = {
        ...input,
        timeEntries: [...(input.timeEntries ?? []), { ...t, billable: false }],
        expenses: [...input.expenses, { ...e, billable: false }],
      };
      expect(build(more).totalInclVat).toBe(build(input).totalInclVat);
    }));
  });

  it("en redan redovisad (låst) post ändrar inte yrkandet (#1205)", () => {
    fc.assert(fc.property(krInput, timeEntry, (input, t) => {
      const locked = { ...t, frozenAt: "2026-01-15T10:00:00Z" };
      expect(build({ ...input, timeEntries: [...(input.timeEntries ?? []), locked] }).totalInclVat).toBe(build(input).totalInclVat);
    }));
  });
});

describe("kostnadsräkningen — mer arbete ger aldrig ett lägre yrkande", () => {
  // Obekvämt arbete är undantaget med avsikt: det förbrukar samma dags
  // beredskapsersättning (DVFS 2025:9 § 2), så en kort inkallelse kan ge mindre
  // än dygnsbeloppet den ersätter. Det är föreskriftens regel, inte ett fel.
  const extraWork = timeEntryOf(fc.constantFrom(...kinds.filter((k) => k !== "ARBETE_OBEKVAM_TID")))
    .map((t) => ({ ...t, billable: true }));

  it("en debiterbar post till", () => {
    fc.assert(fc.property(krInput, extraWork, (input, t) => {
      const more = build({ ...input, timeEntries: [...(input.timeEntries ?? []), t] }).totalInclVat;
      expect(more).toBeGreaterThanOrEqual(build(input).totalInclVat);
    }));
  });

  it("ett debiterbart utlägg till", () => {
    fc.assert(fc.property(krInput, expense, (input, e) => {
      const more = build({ ...input, expenses: [...input.expenses, { ...e, billable: true }] }).totalInclVat;
      expect(more).toBeGreaterThanOrEqual(build(input).totalInclVat);
    }));
  });

  it("en längre huvudförhandling — löpande räkning, och taxeärende inom taxan", () => {
    // Över 3 h 45 min yrkar ett taxeärende 0 kr arvode och en not om att räkna
    // löpande (avsiktligt, se kostnadsrakning.test.ts "HUF överstiger taxa-tak"),
    // så taxeärendena prövas inom taxan.
    const longer = fc.integer({ min: 0, max: 600 });
    fc.assert(fc.property(krInput, longer, (input, extra) => {
      const { forordnande: _ford, ...huf } = input;
      const end = (input.hufEnd ? new Date(input.hufEnd) : new Date()).getTime() + extra * MINUTE_MS;
      const before = build(huf);
      const after = build({ ...huf, hufEnd: new Date(end) });
      fc.pre(huf.isTaxeArende === false || after.huvudforhandlingMinutes <= 225);
      expect(after.totalInclVat).toBeGreaterThanOrEqual(before.totalInclVat);
    }));
  });
});

describe("kostnadsräkningen — F-skatt", () => {
  it("utan F-skatt blir yrkandet aldrig högre än med", () => {
    fc.assert(fc.property(krInput, (input) => {
      expect(build({ ...input, hasFTax: false }).totalInclVat).toBeLessThanOrEqual(build({ ...input, hasFTax: true }).totalInclVat);
    }));
  });
});
