/**
 * `valueKrRun` (#1024) — när körningen yrkar brottmålstaxan och på vilket
 * underlag. Routertesterna (kostnadsrakning-taxa-run) visar beloppen; här de
 * grenar som avgör VÄGEN.
 */
import { describe, expect, it } from "vitest-compat";
import { valueKrRun, type KrRunMatter } from "@/lib/server/billing/kr-run-valuation";
import { kostnadsrakningClaimInclVat } from "@/lib/shared/kostnadsrakning";

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
    expect(v).toEqual({ kind: "lopande", grossOre: expected, matterPatch: { isTaxeArende: false } });
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

  it("dialogen kryssar i taxeärende på ett ärende som saknade det → taxan, och valet sparas", () => {
    const v = valueKrRun({ ...TAXE, isTaxeArende: false }, NO_WORK, { isTaxeArende: true }, NOW);
    expect(v).toMatchObject({ kind: "taxa", matterPatch: { isTaxeArende: true } });
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
