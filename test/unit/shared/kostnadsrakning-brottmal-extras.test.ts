/**
 * Brottmålstaxan: vad som yrkas UTÖVER taxan (#1182, #1024).
 *
 * DVFS 2025:6
 *   5 § — taxan omfattar allt arbete i målet (arbetsraderna är informativa),
 *   6 § — taxan omfattar EN timmes tidsspillan, i första hand före 08 / efter
 *         18; tidsspillan utöver den ersätts enligt DVFS 2025:4.
 * Advokatberedskapen (DVFS 2025:9) ersätts per dygn och ligger utanför taxan.
 *
 * Förut sattes tidsspillan och beredskap till 0 i taxeärenden → överskjutande
 * tidsspillan och beredskapsdygn yrkades aldrig.
 */
import { describe, expect, it } from "vitest-compat";
import { advokatberedskapFtaxForDate, applyNoFTaxFactorForDate, tidsspillanFtaxForDate, tidsspillanOvrigFtaxForDate } from "@/lib/shared/brottmalstaxa";
import { buildKostnadsrakningContext, kostnadsrakningClaimInclVat, type TimeEntryInput } from "@/lib/shared/kostnadsrakning";
import { roundToKronor } from "@/lib/shared/whole-kronor";

const DATE = "2026-05-25";
const base = {
  matter: { matterNumber: "2026-0016", title: "Brottmål" },
  defender: { name: "Anna Advokat" },
  hufStart: new Date(`${DATE}T09:00:00`),
  hufEnd: new Date(`${DATE}T10:35:00`), // 95 min → 5 635 kr, nivå 1
  yrkandeDate: new Date(`${DATE}T12:00:00`),
  taxaLevel: 1 as const,
  hasFTax: true,
  isTaxeArende: true,
  expenses: [],
};
const TAXA = 563_500;
const entry = (id: string, kind: TimeEntryInput["kind"], minutes: number, date = DATE): TimeEntryInput => ({ id, date, description: id, minutes, kind });
const at = (minutes: number, rate: number): number => Math.round((minutes / 60) * rate);
const labels = (r: ReturnType<typeof buildKostnadsrakningContext>): string[] => r.document.summaryRows.map((row) => row.label);

describe("brottmålstaxa + tidsspillan utöver taxan (DVFS 2025:6 6 §, #1182)", () => {
  it("tidsspillan 2 tim 30 min vardag → 1 tim ingår, 1 tim 30 min yrkas på tidsspillan-normen", () => {
    const r = buildKostnadsrakningContext({ ...base, timeEntries: [entry("ts", "TIDSSPILLAN", 150)] });
    expect(r.arvodeExclVat).toBe(TAXA + roundToKronor(at(90, tidsspillanFtaxForDate(DATE))));
    expect(labels(r)).toContain("TIDSSPILLAN UTÖVER TAXAN");
  });

  it("timmen som ingår tas i första hand från tid före 08 / efter 18 (övrig tid)", () => {
    const r = buildKostnadsrakningContext({ ...base, timeEntries: [entry("o", "TIDSSPILLAN_OVRIG_TID", 30), entry("v", "TIDSSPILLAN", 60)] });
    // 30 min övrig + 30 min vardag ingår → 30 min vardag yrkas.
    expect(r.arvodeExclVat).toBe(TAXA + roundToKronor(at(30, tidsspillanFtaxForDate(DATE))));
    expect(labels(r)).not.toContain("TIDSSPILLAN ANNAN TID UTÖVER TAXAN");
  });

  it("övrig tid utöver timmen yrkas på sin egen (lägre) norm", () => {
    const r = buildKostnadsrakningContext({ ...base, timeEntries: [entry("o", "TIDSSPILLAN_OVRIG_TID", 100)] });
    expect(r.arvodeExclVat).toBe(TAXA + roundToKronor(at(40, tidsspillanOvrigFtaxForDate(DATE))));
    expect(labels(r)).toContain("TIDSSPILLAN ANNAN TID UTÖVER TAXAN");
  });

  it("högst en timme tidsspillan → bara taxan (inget utöver)", () => {
    const r = buildKostnadsrakningContext({ ...base, timeEntries: [entry("ts", "TIDSSPILLAN", 60)] });
    expect(r.arvodeExclVat).toBe(TAXA);
    expect(labels(r).filter((l) => l.startsWith("TIDSSPILLAN"))).toEqual([]);
  });

  it("utan F-skatt → tidsspillan-normen × kvoten (11 §)", () => {
    const r = buildKostnadsrakningContext({ ...base, hasFTax: false, timeEntries: [entry("ts", "TIDSSPILLAN", 120)] });
    const taxaNoFTax = buildKostnadsrakningContext({ ...base, hasFTax: false, timeEntries: [] }).arvodeExclVat;
    const rate = applyNoFTaxFactorForDate(tidsspillanFtaxForDate(DATE), DATE);
    expect(r.arvodeExclVat).toBe(taxaNoFTax + roundToKronor(at(60, rate)));
  });
});

describe("brottmålstaxa + advokatberedskap (ligger utanför taxan)", () => {
  it("ett beredskapsdygn yrkas för sig, med dygnsbeloppet", () => {
    const r = buildKostnadsrakningContext({ ...base, timeEntries: [entry("b", "ADVOKATBEREDSKAP", 0, "2026-05-23")] });
    expect(r.arvodeExclVat).toBe(TAXA + advokatberedskapFtaxForDate(DATE));
    expect(labels(r)).toContain("ADVOKATBEREDSKAP");
    expect(r.timeLines.find((l) => l.id === "b")?.amountOre).toBe(advokatberedskapFtaxForDate(DATE));
  });

  it("ett dygn som förbrukats av arbete på obekväm tid samma dag yrkas inte (DVFS 2025:9 2 §)", () => {
    const r = buildKostnadsrakningContext({
      ...base,
      timeEntries: [entry("b", "ADVOKATBEREDSKAP", 0, "2026-05-23"), entry("ob", "ARBETE_OBEKVAM_TID", 90, "2026-05-23")],
    });
    expect(r.arvodeExclVat).toBe(TAXA);
  });
});

describe("brottmålstaxan omfattar allt arbete (5 §)", () => {
  it("arbete och arbete på obekväm tid är informativa — beloppet är taxan", () => {
    const r = buildKostnadsrakningContext({ ...base, timeEntries: [entry("a", "ARBETE", 300), entry("ob", "ARBETE_OBEKVAM_TID", 60)] });
    expect(r.arvodeExclVat).toBe(TAXA);
    expect(r.timeLines.every((l) => l.amountOre === 0)).toBe(true);
  });
});

describe("kostnadsrakningClaimInclVat — körningens yrkande = dokumentets (#1024)", () => {
  it("samma belopp som dokumentet, utan dokumentfälten", () => {
    const input = { ...base, timeEntries: [entry("ts", "TIDSSPILLAN", 150), entry("b", "ADVOKATBEREDSKAP", 0, "2026-05-23")] };
    const { matter: _m, defender: _d, ...claimInput } = input;
    expect(kostnadsrakningClaimInclVat(claimInput)).toBe(buildKostnadsrakningContext(input).totalInclVat);
  });
});
