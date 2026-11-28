/**
 * `valueKrRun` (#1024) — när körningen yrkar brottmålstaxan och på vilket
 * underlag. Routertesterna (kostnadsrakning-taxa-run) visar beloppen; här de
 * grenar som avgör VÄGEN.
 */
import { describe, expect, it } from "vitest-compat";
import { krRunForordnandeAvslut, krRunGrossOre, krRunValuedMatter, valueKrRun, type KrRunMatter } from "@/lib/server/billing/kr-run-valuation";
import { forhorFromTimeEntries } from "@/lib/shared/billing/forordnandetaxa";
import { kostnadsrakningClaimInclVat } from "@/lib/shared/billing/kostnadsrakning";

const NOW = new Date("2026-09-29T12:00:00.000Z");
const NO_WORK = { timeEntries: [], expenses: [] };
const TAXE: KrRunMatter = { paymentMethod: "OFFENTLIGT_UPPDRAG", isTaxeArende: true, taxaHuvudforhandlingMin: 95 };
const taxaOf = (level: 1 | 2 | 3 | 4, start = NOW): number => kostnadsrakningClaimInclVat({
  hufStart: start, hufEnd: new Date(start.getTime() + 95 * 60_000), yrkandeDate: NOW, taxaLevel: level, hasFTax: true,
  isTaxeArende: true, timeEntries: [], expenses: [],
});

describe("valueKrRun", () => {
  it("inte offentligt uppdrag (t.ex. rättshjälp) → normvägen, även om taxeflaggan råkar vara satt", () => {
    expect(valueKrRun({ ...TAXE, paymentMethod: "RATTSHJALP" }, NO_WORK, {}, NOW)).toEqual({ kind: "norm", matterPatch: {} });
  });

  it("offentligt uppdrag utan taxa → löpande, räknat som dokumentet", () => {
    expect(valueKrRun({ ...TAXE, isTaxeArende: false }, NO_WORK, {}, NOW)).toEqual({ kind: "lopande", grossOre: 0, matterPatch: {} });
  });

  // Dialogens dokument tar med huvudförhandlingen som arbete (#1255).
  it("löpande: dialogens huvudförhandling yrkas som arbete, som i dokumentet", () => {
    const huf = { hufStart: "2026-09-22T09:00:00.000Z", hufEnd: "2026-09-22T10:00:00.000Z" };
    const expected = kostnadsrakningClaimInclVat({
      hufStart: new Date(huf.hufStart), hufEnd: new Date(huf.hufEnd), yrkandeDate: NOW, hasFTax: true,
      isTaxeArende: false, timeEntries: [], expenses: [],
    });
    const v = valueKrRun(TAXE, NO_WORK, { ...huf, isTaxeArende: false }, NOW);
    // Taxevalet är körningens och sparas inte på ärendet (#1890).
    expect(v).toEqual({ kind: "lopande", grossOre: expected, matterPatch: {} });
    expect(expected).toBeGreaterThan(0);
  });

  it("löpande: utan F-skatt → lägre belopp, som i dokumentet", () => {
    const huf = { hufStart: "2026-09-22T09:00:00.000Z", hufEnd: "2026-09-22T10:00:00.000Z", isTaxeArende: false };
    const med = valueKrRun(TAXE, NO_WORK, huf, NOW);
    const utan = valueKrRun(TAXE, NO_WORK, { ...huf, hasFTax: false }, NOW);
    expect(utan.kind !== "norm" && med.kind !== "norm" && utan.grossOre < med.grossOre).toBe(true);
  });

  it("löpande: slut före start → vägras", () => {
    expect(() => valueKrRun(TAXE, NO_WORK, { hufStart: "2026-09-22T11:00:00.000Z", hufEnd: "2026-09-22T09:00:00.000Z", isTaxeArende: false }, NOW))
      .toThrow(/slutar före/);
  });

  it("dialogen kryssar i taxeärende på ett ärende som saknade det → taxan; valet sparas inte, nivå och HUF gör (#1890)", () => {
    const v = valueKrRun({ ...TAXE, isTaxeArende: false }, NO_WORK, { isTaxeArende: true }, NOW);
    expect(v).toEqual({
      kind: "taxa", grossOre: taxaOf(1),
      matterPatch: { taxaLevel: 1, taxaHuvudforhandlingMin: 95, taxaHufStart: NOW },
    });
  });

  it("matterPatch innehåller aldrig isTaxeArende, vilket val dialogen än gör (#1890)", () => {
    const huf = { hufStart: "2026-09-22T09:00:00.000Z", hufEnd: "2026-09-22T10:00:00.000Z" };
    for (const isTaxeArende of [true, false, undefined]) {
      for (const matter of [TAXE, { ...TAXE, isTaxeArende: false }, { ...TAXE, paymentMethod: "RATTSHJALP" }]) {
        expect(valueKrRun(matter, NO_WORK, { ...huf, isTaxeArende }, NOW).matterPatch).not.toHaveProperty("isTaxeArende");
      }
    }
  });

  it("nivån: dialogens, annars ärendets, annars 1 — ett ogiltigt värde på ärendet blir 1", () => {
    expect(valueKrRun({ ...TAXE, taxaLevel: 3 }, NO_WORK, {}, NOW)).toMatchObject({ grossOre: taxaOf(3), matterPatch: { taxaLevel: 3 } });
    expect(valueKrRun({ ...TAXE, taxaLevel: 3 }, NO_WORK, { taxaLevel: 4 }, NOW)).toMatchObject({ grossOre: taxaOf(4) });
    expect(valueKrRun(TAXE, NO_WORK, {}, NOW)).toMatchObject({ grossOre: taxaOf(1), matterPatch: { taxaLevel: 1 } });
    expect(valueKrRun({ ...TAXE, taxaLevel: 7 }, NO_WORK, {}, NOW)).toMatchObject({ grossOre: taxaOf(1) });
  });

  it("ärendets HUF utan starttid → räknas från nu (taxans årgång följer yrkandet ändå)", () => {
    expect(valueKrRun(TAXE, NO_WORK, {}, NOW)).toMatchObject({ kind: "taxa", matterPatch: { taxaHufStart: NOW, taxaHuvudforhandlingMin: 95 } });
  });

  it("bara start i dialogen (inget slut) → ärendets sparade tid gäller", () => {
    expect(valueKrRun(TAXE, NO_WORK, { hufStart: "2026-09-22T09:00:00.000Z" }, NOW)).toMatchObject({ matterPatch: { taxaHuvudforhandlingMin: 95 } });
  });

  it("utan F-skatt på ärendet → lägre belopp", () => {
    const utan = valueKrRun({ ...TAXE, taxaHasFTax: false }, NO_WORK, {}, NOW);
    expect(utan.kind === "taxa" && utan.grossOre).toBeLessThan(taxaOf(1));
  });

  it("dialogens F-skatt går före ärendets — samma underlag som dokumentet", () => {
    expect(valueKrRun({ ...TAXE, taxaHasFTax: false }, NO_WORK, { hasFTax: true }, NOW)).toMatchObject({ grossOre: taxaOf(1) });
  });

  it("exakt maxgränsen (3 tim 45 min) går — taxan gäller till och med den", () => {
    expect(valueKrRun({ ...TAXE, taxaHuvudforhandlingMin: 225 }, NO_WORK, {}, NOW).kind).toBe("taxa");
    expect(() => valueKrRun({ ...TAXE, taxaHuvudforhandlingMin: 226 }, NO_WORK, {}, NOW)).toThrow(/maxgräns/);
  });
});

// Förordnandemål (#1857): förordnandetaxan med ärendets förhör, som dokumentet.
describe("valueKrRun — förordnandemål", () => {
  const OU: KrRunMatter = { paymentMethod: "OFFENTLIGT_UPPDRAG", isTaxeArende: false };
  const NEDLAGD = { forordnande: { avslut: "NEDLAGD" as const } };
  /** Ett förhör en tisdag (UTC 08:00 = 10:00 svensk tid) på `minutes` minuter. */
  const forhor = (minutes: number, date = "2026-09-22T08:00:00.000Z") => ({
    id: `te-${date}-${minutes}`, date: new Date(date), minutes, description: "Förhör", hourlyRate: 250_000, billable: true, kind: "FORHOR" as const,
  });
  const claim = (work: { timeEntries: ReturnType<typeof forhor>[] }, hasFTax = true): number => kostnadsrakningClaimInclVat({
    forordnande: { forhor: forhorFromTimeEntries(work.timeEntries), avslut: "NEDLAGD" },
    yrkandeDate: NOW, hasFTax, isTaxeArende: true, timeEntries: [...work.timeEntries], expenses: [],
  });

  it("förhör inom taxan → förordnandetaxan, samma belopp som dokumentet, ärendet ändras inte", () => {
    const work = { timeEntries: [forhor(60)], expenses: [] };
    const v = valueKrRun({ ...OU, taxaHuvudforhandlingMin: 95 }, work, { ...NEDLAGD, isTaxeArende: false }, NOW);
    expect(v).toEqual({ kind: "forordnande", grossOre: claim(work), matterPatch: {} });
    expect(claim(work)).toBeGreaterThan(0);
  });

  it("förhör utanför taxan (kväll) → löpande räkning, som dokumentet", () => {
    const work = { timeEntries: [forhor(60, "2026-09-22T18:00:00.000Z")], expenses: [] };
    const v = valueKrRun(OU, work, NEDLAGD, NOW);
    expect(v).toEqual({ kind: "forordnande", grossOre: claim(work), matterPatch: {} });
    const inom = valueKrRun(OU, { timeEntries: [forhor(60)], expenses: [] }, NEDLAGD, NOW);
    expect(v.kind !== "norm" && inom.kind !== "norm" && v.grossOre !== inom.grossOre).toBe(true);
  });

  it("utan förhör → taxans lägsta belopp (6 §)", () => {
    expect(valueKrRun(OU, NO_WORK, NEDLAGD, NOW)).toEqual({ kind: "forordnande", grossOre: claim({ timeEntries: [] }), matterPatch: {} });
    expect(claim({ timeEntries: [] })).toBeGreaterThan(0);
  });

  it("utan F-skatt: dialogens val, annars ärendets → lägre belopp", () => {
    const work = { timeEntries: [forhor(60)], expenses: [] };
    expect(valueKrRun(OU, work, { ...NEDLAGD, hasFTax: false }, NOW)).toMatchObject({ grossOre: claim(work, false) });
    expect(valueKrRun({ ...OU, taxaHasFTax: false }, work, NEDLAGD, NOW)).toMatchObject({ grossOre: claim(work, false) });
    expect(claim(work, false)).toBeLessThan(claim(work));
  });

  it("inte offentligt uppdrag → PRECONDITION_FAILED", () => {
    expect(() => valueKrRun({ paymentMethod: "RATTSHJALP" }, NO_WORK, NEDLAGD, NOW)).toThrow(/offentligt uppdrag/);
  });
});

describe("krRunValuedMatter (#1890)", () => {
  const norm = { kind: "norm" as const, matterPatch: {} };

  it("dialogens taxeval ligger ovanpå ärendet och patchen, utan att ändra ärendet", () => {
    const matter = { paymentMethod: "RATTSHJALP", isTaxeArende: true, taxaLevel: 2 };
    const taxa = { kind: "taxa" as const, grossOre: 1, matterPatch: { taxaLevel: 3 as const } };
    expect(krRunValuedMatter(matter, taxa, { isTaxeArende: false })).toEqual({ paymentMethod: "RATTSHJALP", isTaxeArende: false, taxaLevel: 3 });
    expect(matter).toEqual({ paymentMethod: "RATTSHJALP", isTaxeArende: true, taxaLevel: 2 });
  });

  it("utan val i dialogen gäller ärendets flagga", () => {
    expect(krRunValuedMatter({ isTaxeArende: true }, norm, {})).toEqual({ isTaxeArende: true });
  });
});

describe("krRunForordnandeAvslut (#2180)", () => {
  it("förordnande → avslutet; annars null", () => {
    expect(krRunForordnandeAvslut({ forordnande: { avslut: "INGET_ATAL" } })).toBe("INGET_ATAL");
    expect(krRunForordnandeAvslut({})).toBeNull();
  });
});

describe("krRunGrossOre", () => {
  it("värderingens belopp, eller normvägens", () => {
    const norm = (): number => 42;
    expect(krRunGrossOre({ kind: "taxa", grossOre: 1, matterPatch: {} }, norm)).toBe(1);
    expect(krRunGrossOre({ kind: "lopande", grossOre: 2, matterPatch: {} }, norm)).toBe(2);
    expect(krRunGrossOre({ kind: "forordnande", grossOre: 3, matterPatch: {} }, norm)).toBe(3);
    expect(krRunGrossOre({ kind: "norm", matterPatch: {} }, norm)).toBe(42);
  });
});
