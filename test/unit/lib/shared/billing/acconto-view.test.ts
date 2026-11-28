/**
 * Acontofakturans nedbrytning (#1940): underlaget, klientens andel, avdragen
 * för tidigare acontofakturor, överskott, justering, moms och öresavrundning.
 *
 * Invarianten i varje fall: raderna från andelen och nedåt summerar till
 * fakturans belopp, och momsraden är fakturans moms.
 */

import { describe, expect, it } from "vitest-compat";
import { accontoSplit } from "@/lib/shared/billing/acconto-vat";
import { accontoShareTerm, buildAccontoView, type AccontoExpense, type AccontoViewInput } from "@/lib/shared/billing/acconto-view";
import { proposedAccontoOre } from "@/lib/shared/billing/billing-proposal";
import { expenseNetOre, matterArvodeNet } from "@/lib/shared/billing/billing-work-value";
import type { SpecDeduction } from "@/lib/shared/billing/invoice-specification";
import type { SettlementView } from "@/lib/shared/billing/settlement-view";
import { roundToKronor } from "@/lib/shared/billing/whole-kronor";
import { asId } from "@/lib/shared/schemas/ids";

const AT = "2026-06-01";
const te = (minutes: number, hourlyRate = 250_000) => ({
  id: asId<"TimeEntryId">(`t-${minutes}`), minutes, hourlyRate, billable: true, date: AT, description: "Arbete", kind: "ARBETE" as const,
});
const ex = (amount: number, o: Partial<AccontoExpense> = {}): AccontoExpense => ({
  id: asId<"ExpenseId">(`e-${amount}`), amount, billable: true, vatRate: 0, vatIncluded: false,
  date: new Date("2026-05-20T10:00:00Z"), description: "Utlägg", ...o,
});
const ded = (invoiceNumber: string, amountOre: number): SpecDeduction => ({ invoiceNumber, date: "2026-05-01", amountOre });

function input(o: Partial<AccontoViewInput> = {}): AccontoViewInput {
  return {
    matter: { paymentMethod: "PRIVAT" }, work: { timeEntries: [te(120)], expenses: [] }, at: AT,
    clientShareBips: 2000, amountOre: 125_000, deductions: [], ...o,
  };
}

/** Förslaget i hela kronor för indata, som dialogen och `createAcconto` räknar det. */
function proposalKr(i: AccontoViewInput): number {
  const value = matterArvodeNet(i.matter, i.work, i.at) + expenseNetOre(i.work);
  return roundToKronor(proposedAccontoOre(value, i.clientShareBips, i.deductions.reduce((s, d) => s + d.amountOre, 0)));
}

/** Raderna från andelen och nedåt, med tecken. */
function payableSum(v: SettlementView): number {
  // Avräkningstabellen (#151) räknar raderna utan `role`: från andelen och nedåt.
  const counted = v.rows.filter((r) => r.role === undefined && r.kind !== "info");
  expect(counted[0]?.label.startsWith("Klientens ")).toBe(true);
  return counted.reduce((s, r) => s + (r.kind === "deduct" ? -r.amountOre : r.amountOre), 0);
}

const rowsOf = (v: SettlementView): Array<[string, number]> => v.rows.map((r) => [r.label, r.amountOre]);
const amountOf = (v: SettlementView, label: string): number | undefined => v.rows.find((r) => r.label === label)?.amountOre;

/** Invarianterna: summan är beloppet, momsraden är fakturans moms, totalen är beloppet. */
function expectInvariants(v: SettlementView, amountOre: number): void {
  expect(payableSum(v)).toBe(amountOre);
  expect(v.rows.find((r) => r.label === "Moms")?.amountOre).toBe(accontoSplit(amountOre).vatOre);
  expect(v.totalOre).toBe(amountOre);
  expect(v.totalLabel).toBe("Att betala (inkl moms)");
}

describe("buildAccontoView — raderna", () => {
  it("inget tidigare aconto: underlag, andel och moms", () => {
    const v = buildAccontoView(input());
    expect(rowsOf(v)).toEqual([
      ["Upparbetat arvode (exkl moms)", 500_000],
      ["Klientens andel (exkl moms)", 100_000],
      ["Moms", 25_000],
    ]);
    // Underlag och andel i egna fält (#151), inte i etiketten.
    expect(v.rows.map((r) => [r.role, r.basisOre, r.shareBips])).toEqual([
      ["basis", undefined, undefined], [undefined, 500_000, 2000], [undefined, 100_000, 2500],
    ]);
    expectInvariants(v, 125_000);
  });

  it("två tidigare aconton, varav ett obetalt: båda dras av netto, med nummer och datum", () => {
    const i = input({ deductions: [ded("F-2026-0001", 50_000), ded("F-2026-0002", 30_000)], amountOre: 45_000 });
    expect(proposalKr(i)).toBe(45_000);
    const v = buildAccontoView(i);
    expect(rowsOf(v)).toEqual([
      ["Upparbetat arvode (exkl moms)", 500_000],
      ["Klientens andel (exkl moms)", 100_000],
      ["Avgår aconto — faktura F-2026-0001 (2026-05-01), exkl moms", 40_000],
      ["Avgår aconto — faktura F-2026-0002 (2026-05-01), exkl moms", 24_000],
      ["Moms", 9_000],
    ]);
    expect(v.rows.filter((r) => r.kind === "deduct")).toHaveLength(2);
    expectInvariants(v, 45_000);
  });

  it("öresutjämning när avdragens netto och fakturans netto avrundas olika", () => {
    const i = input({ work: { timeEntries: [te(125)], expenses: [] }, deductions: [ded("F-1", 10_100)], amountOre: 120_200 });
    expect(proposalKr(i)).toBe(120_200);
    const v = buildAccontoView(i);
    expect(amountOf(v, "Öresutjämning")).toBe(100);
    expect(amountOf(v, "Justering (exkl moms)")).toBeUndefined();
    expectInvariants(v, 120_200);
  });

  it("ett ändrat belopp uppåt och nedåt ger Justering med tecken", () => {
    const up = buildAccontoView(input({ amountOre: 150_000 }));
    expect(amountOf(up, "Justering (exkl moms)")).toBe(20_000);
    expect(amountOf(up, "Öresutjämning")).toBeUndefined();
    expectInvariants(up, 150_000);
    const down = buildAccontoView(input({ amountOre: 100_000 }));
    expect(amountOf(down, "Justering (exkl moms)")).toBe(-20_000);
    expectInvariants(down, 100_000);
  });

  it("ett utlägg med moms inräknad och ören, förslaget orört: ingen Justering", () => {
    const base = input({ work: { timeEntries: [te(120)], expenses: [ex(12_345, { vatRate: 2500, vatIncluded: true })] } });
    const i = { ...base, amountOre: proposalKr(base) };
    const v = buildAccontoView(i);
    expect(amountOf(v, "Justering (exkl moms)")).toBeUndefined();
    expectInvariants(v, i.amountOre);
  });

  it("förslaget klampat till 0 och beloppet orört: raden för överskottet, ingen Justering", () => {
    const i = input({ deductions: [ded("F-1", 200_000)], amountOre: 0 });
    expect(proposalKr(i)).toBe(0);
    const v = buildAccontoView(i);
    expect(amountOf(v, "Tidigare aconton överstiger andelen (exkl moms)")).toBe(60_000);
    expect(amountOf(v, "Justering (exkl moms)")).toBeUndefined();
    expectInvariants(v, 0);
  });

  it("klampat och ett inskrivet belopp: Justering är det inskrivna nettot", () => {
    const v = buildAccontoView(input({ deductions: [ded("F-1", 200_000)], amountOre: 10_000 }));
    expect(amountOf(v, "Justering (exkl moms)")).toBe(accontoSplit(10_000).netOre);
    expect(amountOf(v, "Tidigare aconton överstiger andelen (exkl moms)")).toBe(60_000);
    expectInvariants(v, 10_000);
  });

  it("ett privat ärende med klampat förslag: överskottsraden nämner ingen slutreglering", () => {
    const v = buildAccontoView(input({ deductions: [ded("F-1", 200_000)], amountOre: 0 }));
    const labels = v.rows.map((r) => r.label).join(" ");
    expect(labels).toContain("Tidigare aconton överstiger andelen (exkl moms)");
    expect(labels).not.toMatch(/slutreglering|kreditera/i);
  });

  it("utlägg med och utan moms: underlaget och specifikationen", () => {
    const expenses = [ex(10_000), ex(20_000, { vatRate: 2500, description: "Resa", passThrough: false })];
    const base = input({ work: { timeEntries: [te(120)], expenses } });
    const i = { ...base, amountOre: proposalKr(base) };
    const v = buildAccontoView(i);
    const e = expenseNetOre(i.work);
    expect(rowsOf(v).slice(0, 3)).toEqual([
      ["Upparbetat arvode (exkl moms)", 500_000],
      ["Utlägg (exkl moms)", e],
      ["Underlag (exkl moms)", 500_000 + e],
    ]);
    expect(v.expenseLines).toHaveLength(2);
    expect(v.expenseLines?.[0]).toMatchObject({ date: "2026-05-20", description: "Utlägg", netOre: 10_000 });
    expect(v.expenseLines?.[1]).toMatchObject({ description: "Resa", passThrough: false });
    expectInvariants(v, i.amountOre);
  });

  it("ett icke debiterbart utlägg syns inte i specifikationen", () => {
    const v = buildAccontoView(input({ work: { timeEntries: [te(120)], expenses: [ex(10_000, { billable: false })] } }));
    expect(v.expenseLines).toEqual([]);
    expect(rowsOf(v)[1]?.[0]).toBe("Klientens andel (exkl moms)");
  });
});

describe("buildAccontoView — andelens benämning och tidsraderna", () => {
  it.each([
    ["RATTSHJALP", "Klientens rättshjälpsavgift (exkl moms)"],
    ["RATTSSKYDD", "Klientens självrisk (exkl moms)"],
    ["PRIVAT", "Klientens andel (exkl moms)"],
  ] as const)("%s: %s", (paymentMethod, label) => {
    const base = input({ matter: { paymentMethod } });
    const i = { ...base, amountOre: proposalKr(base) };
    const v = buildAccontoView(i);
    expect(v.rows[1]?.label).toBe(label);
    expectInvariants(v, i.amountOre);
  });

  it("accontoShareTerm: andel för övriga betalningssätt", () => {
    expect(accontoShareTerm("PENDING")).toBe("andel");
    expect(accontoShareTerm("MIX")).toBe("andel");
  });

  it("ett privat ärende värderar tidsraderna på postens eget á-pris, och de summerar till arvodet", () => {
    const v = buildAccontoView(input({ work: { timeEntries: [te(60, 100_000), te(30, 300_000)], expenses: [] }, amountOre: 50_000 }));
    expect(v.timeLines.map((l) => l.amountOre)).toEqual([100_000, 150_000]);
    expect(v.timeLines[0]).toMatchObject({ date: AT, minutes: 60, description: "Arbete", kind: "ARBETE" });
    expect(amountOf(v, "Upparbetat arvode (exkl moms)")).toBe(250_000);
  });

  it("ett rättshjälpsärende värderar på normen: tidsraderna summerar till det upparbetade", () => {
    const i = input({ matter: { paymentMethod: "RATTSHJALP" }, work: { timeEntries: [te(60, 0), te(45, 0)], expenses: [] } });
    const v = buildAccontoView(i);
    const arvode = amountOf(v, "Upparbetat arvode (exkl moms)");
    expect(arvode).toBeGreaterThan(0);
    expect(v.timeLines.reduce((s, l) => s + l.amountOre, 0)).toBe(arvode);
  });
});
