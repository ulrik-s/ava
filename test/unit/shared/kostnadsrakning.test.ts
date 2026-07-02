/**
 * Tester för `buildKostnadsrakningContext`.
 */

import { describe, it, expect } from "vitest-compat";
import { buildKostnadsrakningContext, diffMinutes, formatMinutes } from "@/lib/shared/kostnadsrakning";

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
    expect(lines[0]!.vatRateLabel).toBe("6 %");
    expect(lines[0]!.inclVatFormatted).toMatch(/450,00\s+kr/);
  });
});

describe("buildKostnadsrakningContext — icke-taxa-ärende (timkostnadsnorm)", () => {
  // isTaxeArende=false → arvode = timkostnadsnorm × (billable tid + HUF),
  // INTE brottmålstaxan. Täcker timkostnadsnormResult + resolveTaxa-grenen.
  const r = buildKostnadsrakningContext({
    ...baseInput,
    isTaxeArende: false,
    timeEntries: [
      { id: "t1", date: "2026-05-20", description: "Genomgång förundersökning", minutes: 120, billable: true },
      { id: "t2", date: "2026-05-22", description: "Klientmöte", minutes: 30, billable: true },
      { id: "t3", date: "2026-05-23", description: "Intern admin", minutes: 45, billable: false },
    ],
  });

  it("billable tid summeras (exkl HUF), icke-debiterbar filtreras bort", () => {
    expect(r.billableArbetsMinutes).toBe(150); // 120 + 30, ej 45
    expect(r.timeLines.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });

  it("totalArbetsMinutes = billable tid + HUF", () => {
    expect(r.totalArbetsMinutes).toBe(150 + 95); // 245
  });

  it("arvode = timkostnadsnorm (1 626 kr/h) × 245 min, ej brottmålstaxan", () => {
    expect(r.taxa.kind).toBe("taxa-applies");
    expect(r.taxa.intervalLabel).toBe("Timkostnadsnorm");
    expect(r.arvodeExclVat).toBe(663950);
    expect(r.arvodeMoms).toBe(165988);
    expect(r.arvodeInclVat).toBe(829938);
  });

  it("noten beskriver timkostnadsnorm-beräkningen", () => {
    expect(r.taxa.notes.join(" ")).toMatch(/Icke-taxa/i);
    expect(r.taxa.notes.join(" ")).toMatch(/1626 kr\/h/);
  });

  it("icke-taxa utan F-skatt → lägre timkostnadsnorm (1 237 kr\/h)", () => {
    const noFtax = buildKostnadsrakningContext({
      ...baseInput,
      isTaxeArende: false,
      hasFTax: false,
      timeEntries: [{ id: "t1", date: "2026-05-20", description: "Arbete", minutes: 60, billable: true }],
    });
    // 60 + 95 = 155 min × 1237 kr/h
    expect(noFtax.arvodeExclVat).toBe(Math.round((155 * 123700) / 60));
    expect(noFtax.taxa.notes.join(" ")).toMatch(/1237 kr\/h/);
  });
});

describe("buildKostnadsrakningContext — timeLines i taxa-ärende", () => {
  // I taxa-ärenden visas tidsposterna som information men påverkar inte arvodet.
  const r = buildKostnadsrakningContext({
    ...baseInput,
    timeEntries: [{ id: "t1", date: "2026-05-20", description: "Förberedelse", minutes: 90, billable: true }],
  });

  it("timeLines visas och formateras i templateContext", () => {
    const lines = r.templateContext.timeLines as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.minutesFormatted).toBe("1 tim 30 min");
    expect(r.templateContext.billableArbetsFormatted).toBe("1 tim 30 min");
  });

  it("arvodet styrs fortfarande av taxan (oförändrat mot utan tidsposter)", () => {
    expect(r.arvodeExclVat).toBe(563500); // samma som 95 min nivå 1
  });
});

describe("vatRateLabel — alla momssatser via templateContext", () => {
  const r = buildKostnadsrakningContext({
    ...baseInput,
    expenses: [
      { id: "v0", date: "2026-05-20", description: "Momsfritt", amount: 10000, vatRate: 0, vatIncluded: true, billable: true },
      { id: "v12", date: "2026-05-20", description: "Mat 12 %", amount: 10000, vatRate: 1200, vatIncluded: true, billable: true },
      { id: "v25", date: "2026-05-20", description: "Standard (default 25 %)", amount: 10000, vatIncluded: true, billable: true },
    ],
  });

  it("mappar momssats-baspoäng till etikett (0/12/25 %)", () => {
    const byId = new Map(
      (r.templateContext.expenseLines as Array<Record<string, unknown>>).map((l) => [l.id, l.vatRateLabel]),
    );
    expect(byId.get("v0")).toBe("0 %");
    expect(byId.get("v12")).toBe("12 %");
    expect(byId.get("v25")).toBe("25 %"); // vatRate utelämnad → default 2500
  });
});

describe("buildKostnadsrakningContext — rådgivningstimme (#383)", () => {
  it("radgivningPaid=true → textrad i templateContext (utan belopp)", () => {
    const r = buildKostnadsrakningContext({
      ...baseInput,
      matter: { ...baseInput.matter, radgivningPaid: true },
    });
    const notice = r.templateContext.radgivningNotice as string | null;
    expect(notice).toMatch(/rådgivningstimme/i);
    expect(notice).toMatch(/ingår ej/i);
    expect(notice).not.toMatch(/kr|öre|\bSEK\b/i); // inget belopp domstolen ska betala
  });

  it("default (ej satt) → ingen textrad", () => {
    const r = buildKostnadsrakningContext(baseInput);
    expect(r.templateContext.radgivningNotice).toBeNull();
  });

  it("rådgivningstimmen påverkar inte arvode/totaler (dubbelräknas ej mot domstolen)", () => {
    const withR = buildKostnadsrakningContext({ ...baseInput, matter: { ...baseInput.matter, radgivningPaid: true } });
    const without = buildKostnadsrakningContext(baseInput);
    expect(withR.templateContext.arvodeInclVat).toBe(without.templateContext.arvodeInclVat);
    expect(withR.templateContext.totalInclVat).toBe(without.templateContext.totalInclVat);
  });

  it("icke-taxa (rättshjälp) + radgivningPaid → arvodet exkluderar rådgivningstimmen (#863)", () => {
    const input = {
      ...baseInput,
      isTaxeArende: false,
      hufStart: new Date("2026-05-25T09:00:00"), hufEnd: new Date("2026-05-25T09:00:00"), // ingen HUF
      timeEntries: [{ id: "t1", date: "2026-05-20", description: "Möte", minutes: 120, billable: true }],
    };
    const without = buildKostnadsrakningContext(input);
    const withR = buildKostnadsrakningContext({ ...input, matter: { ...input.matter, radgivningPaid: true } });
    // 120 min × timkostnadsnorm (F-skatt 1 626 kr/h) = 325 200; med rådgivning avgår
    // 60 min → 60 min × norm = 162 600.
    expect(without.arvodeExclVat).toBe(325_200);
    expect(withR.arvodeExclVat).toBe(162_600);
    expect(withR.templateContext.isTimkostnadsnorm).toBe(true);
    // Tidsspecifikationen visar ändå ALLT arbete (transparens); bara arvodet reduceras.
    expect(withR.timeLines).toHaveLength(1);
    expect(withR.billableArbetsMinutes).toBe(120);
  });
});
