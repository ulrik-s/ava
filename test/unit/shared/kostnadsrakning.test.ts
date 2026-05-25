/**
 * Tester för `buildKostnadsrakningContext`.
 */

import { describe, it, expect } from "vitest";
import { buildKostnadsrakningContext, diffMinutes, formatMinutes } from "@/shared/kostnadsrakning";

const baseInput = {
  matter: { matterNumber: "2026-0016", title: "Brottmål — rattfylleri", clientName: "Falk" },
  defender: { name: "Anna Advokat", email: "anna@firma.local" },
  organization: { name: "Firma AB", orgNumber: "556999-9999", address: "Storgatan 1" },
  courtName: "Stockholms tingsrätt",
  hufStart: new Date("2026-05-25T09:00:00"),
  hufEnd: new Date("2026-05-25T10:35:00"), // 95 min
  taxaLevel: 1 as const,
  hasFTax: true,
  expenses: [],
};

describe("diffMinutes", () => {
  it("räknar minuter mellan start och slut", () => {
    expect(diffMinutes(new Date("2026-05-25T09:00:00"), new Date("2026-05-25T10:35:00"))).toBe(95);
  });
  it("negativ tid → 0", () => {
    expect(diffMinutes(new Date("2026-05-25T10:00:00"), new Date("2026-05-25T09:00:00"))).toBe(0);
  });
  it("samma tid → 0", () => {
    const d = new Date();
    expect(diffMinutes(d, d)).toBe(0);
  });
});

describe("formatMinutes", () => {
  it("formaterar timmar och minuter", () => {
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(35)).toBe("35 min");
    expect(formatMinutes(60)).toBe("1 tim");
    expect(formatMinutes(95)).toBe("1 tim 35 min");
    expect(formatMinutes(225)).toBe("3 tim 45 min");
  });
});

describe("buildKostnadsrakningContext — utan utlägg, 95 min nivå 1", () => {
  const r = buildKostnadsrakningContext(baseInput);

  it("räknar HUF = 95 min", () => {
    expect(r.huvudforhandlingMinutes).toBe(95);
  });

  it("hamnar i intervallet '1 tim 30 min - 1 tim 44 min'", () => {
    expect(r.taxa.kind).toBe("taxa-applies");
    expect(r.taxa.intervalLabel).toBe("1 tim 30 min - 1 tim 44 min");
  });

  it("ersättning = 5 635 kr exkl moms = 563 500 öre", () => {
    expect(r.arvodeExclVat).toBe(563500);
  });

  it("+25 % moms = 7 044 kr inkl", () => {
    expect(r.arvodeMoms).toBe(140875);
    expect(r.arvodeInclVat).toBe(704375);
  });

  it("inga utlägg → 0", () => {
    expect(r.expenseLines).toEqual([]);
    expect(r.expenseSummary).toEqual({ exclVat: 0, vat: 0, inclVat: 0 });
  });

  it("totalInclVat = arvodeInclVat när inga utlägg finns", () => {
    expect(r.totalInclVat).toBe(r.arvodeInclVat);
  });
});

describe("buildKostnadsrakningContext — med utlägg", () => {
  const r = buildKostnadsrakningContext({
    ...baseInput,
    expenses: [
      // Domstolsavgift 125 kr momsfritt
      { id: "e1", date: "2026-05-20", description: "Domstolsavgift", amount: 12500, vatRate: 0, vatIncluded: true, billable: true },
      // Tåg 450 kr inkl 6 %
      { id: "e2", date: "2026-05-22", description: "Tåg", amount: 45000, vatRate: 600, vatIncluded: true, billable: true },
      // Icke-debiterbar — ska EJ ingå
      { id: "e3", date: "2026-05-23", description: "Privat kaffe", amount: 5000, vatRate: 1200, vatIncluded: true, billable: false },
    ],
  });

  it("filtrerar bort icke-debiterbara utlägg", () => {
    expect(r.expenseLines.map((l) => l.id).sort()).toEqual(["e1", "e2"]);
  });

  it("delar upp varje utlägg korrekt (exkl/moms/inkl)", () => {
    const e1 = r.expenseLines.find((l) => l.id === "e1")!;
    expect(e1).toMatchObject({ exclVat: 12500, vat: 0, inclVat: 12500 });
    const e2 = r.expenseLines.find((l) => l.id === "e2")!;
    expect(e2).toMatchObject({ exclVat: 42453, vat: 2547, inclVat: 45000 });
  });

  it("expenseSummary summerar", () => {
    expect(r.expenseSummary).toEqual({
      exclVat: 12500 + 42453,
      vat: 0 + 2547,
      inclVat: 12500 + 45000,
    });
  });

  it("totalInclVat = arvodeInclVat + expenseSummary.inclVat", () => {
    expect(r.totalInclVat).toBe(r.arvodeInclVat + r.expenseSummary.inclVat);
  });
});

describe("buildKostnadsrakningContext — HUF överstiger taxa-tak", () => {
  const r = buildKostnadsrakningContext({
    ...baseInput,
    hufEnd: new Date("2026-05-25T13:00:00"), // 4 tim = 240 min, > 225
  });

  it("taxa.kind = exceeds-max", () => {
    expect(r.taxa.kind).toBe("exceeds-max");
  });

  it("arvode = 0 (UI:n får visa varning + räkna manuellt)", () => {
    expect(r.arvodeExclVat).toBe(0);
  });
});

describe("templateContext — formaterad data för Handlebars", () => {
  const r = buildKostnadsrakningContext({
    ...baseInput,
    expenses: [{ id: "x", date: "2026-05-20", description: "Tåg", amount: 45000, vatRate: 600, vatIncluded: true, billable: true }],
  });

  it("har alla nyckelfält för mallen", () => {
    const c = r.templateContext;
    expect(c.matterNumber).toBe("2026-0016");
    expect(c.defenderName).toBe("Anna Advokat");
    expect(c.courtName).toBe("Stockholms tingsrätt");
    expect(c.huvudforhandlingFormatted).toBe("1 tim 35 min");
    expect(c.taxaApplies).toBe(true);
    expect(c.arvodeInclFormatted).toContain("kr");
    expect(c.totalInclFormatted).toContain("kr");
  });

  it("expenseLines har formaterade belopp + vatRateLabel", () => {
    const lines = (r.templateContext.expenseLines as Array<Record<string, unknown>>);
    expect(lines[0].vatRateLabel).toBe("6 %");
    expect(lines[0].inclVatFormatted).toMatch(/450,00\s+kr/);
  });
});
