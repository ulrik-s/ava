/**
 * Kostnadsräkningens standardvärden: utan uppgift gäller F-skatt, taxeärende
 * och "moms ingår". Mutationstestningen visade att varje `?? true` kunde bytas
 * mot false utan att något test fällde — samma klass av fel som F-skatt-
 * standardvärdet i databasen (#1675). Här jämförs utelämnat värde med `true`.
 */
import { describe, expect, it } from "vitest-compat";
import { buildKostnadsrakningContext } from "@/lib/shared/kostnadsrakning";

const base = {
  matter: { matterNumber: "2026-0016", title: "Brottmål — rattfylleri", clientName: "Falk" },
  defender: { name: "Anna Advokat", email: "anna@firma.local" },
  organization: { name: "Firma AB", orgNumber: "556999-9999", address: "Storgatan 1" },
  courtName: "Stockholms tingsrätt",
  hufStart: new Date("2026-05-25T09:00:00Z"),
  hufEnd: new Date("2026-05-25T10:35:00Z"), // 95 min
  taxaLevel: 1 as const,
  expenses: [],
};
const work = [{ id: "t1", date: "2026-05-20", description: "Arbete", minutes: 60, billable: true }];
const train = { id: "e1", date: "2026-05-22", description: "Tåg", amount: 45000, vatRate: 600, billable: true };

describe("kostnadsräkningens standardvärden", () => {
  it("F-skatt gäller när hasFTax saknas — taxeärende", () => {
    expect(buildKostnadsrakningContext(base).arvodeExclVat)
      .toBe(buildKostnadsrakningContext({ ...base, hasFTax: true }).arvodeExclVat);
    expect(buildKostnadsrakningContext(base).arvodeExclVat)
      .not.toBe(buildKostnadsrakningContext({ ...base, hasFTax: false }).arvodeExclVat);
  });

  it("F-skatt gäller när hasFTax saknas — timkostnadsnorm (1 626 kr/h, inte 1 237)", () => {
    const r = buildKostnadsrakningContext({ ...base, isTaxeArende: false, timeEntries: work });
    expect(r.arvodeExclVat).toBe(buildKostnadsrakningContext({ ...base, isTaxeArende: false, hasFTax: true, timeEntries: work }).arvodeExclVat);
    expect((r.templateContext.timeLines as Array<{ rateOrePerH: number }>)[0]?.rateOrePerH).toBe(162_600);
  });

  it("taxeärende gäller när isTaxeArende saknas", () => {
    const r = buildKostnadsrakningContext({ ...base, hasFTax: true, timeEntries: work });
    const taxe = buildKostnadsrakningContext({ ...base, hasFTax: true, isTaxeArende: true, timeEntries: work });
    expect(r.taxa.intervalLabel).toBe(taxe.taxa.intervalLabel);
    expect(r.taxa.intervalLabel).not.toBe("Timkostnadsnorm");
    expect(r.arvodeExclVat).toBe(taxe.arvodeExclVat);
    expect(r.templateContext.isTimkostnadsnorm).toBe(false);
    // Tidsraderna värderas som i ett taxeärende (taxan täcker arbetet, inget á-pris).
    expect(r.timeLines).toEqual(taxe.timeLines);
  });

  it("ett utlägg utan vatIncluded räknas som inklusive moms", () => {
    const r = buildKostnadsrakningContext({ ...base, hasFTax: true, expenses: [train] });
    const incl = buildKostnadsrakningContext({ ...base, hasFTax: true, expenses: [{ ...train, vatIncluded: true }] });
    const excl = buildKostnadsrakningContext({ ...base, hasFTax: true, expenses: [{ ...train, vatIncluded: false }] });
    expect(r.expenseLines).toEqual(incl.expenseLines);
    expect(r.expenseLines).not.toEqual(excl.expenseLines);
  });
});
