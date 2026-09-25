/**
 * Förordnandemål (DVFS 2025:5 / 2024:16) — brottmålet som började löpande och
 * slutade med att förundersökningen lades ned. Belopp ur föreskrifternas
 * bilagor; tider i svensk tid.
 */
import { describe, expect, it } from "vitest-compat";
import {
  computeForordnandeErsattning, forhorMinutes, isWithinTaxaHours, tidsspillanUtover, type Forhor,
} from "@/lib/shared/forordnandetaxa";

const Y2026 = "2026-03-10";
/** Stockholm-tid i mars (CET, +01:00). */
const t = (day: string, hm: string): string => `2026-03-${day}T${hm}:00+01:00`;
const forhor = (day: string, from: string, to: string, pauses: Array<[string, string]> = []): Forhor => ({
  start: t(day, from), end: t(day, to), pauses: pauses.map(([a, b]) => ({ start: t(day, a), end: t(day, b) })),
});

/** Det rapporterade fallet: två förhör, tidsspillan på båda dagarna. */
const FORHOR_1 = forhor("02", "09:00", "09:50", [["09:20", "09:30"]]); // mån, 10 min paus räknas → 50 min
const FORHOR_2 = forhor("04", "13:00", "13:55", [["13:20", "13:40"]]); // ons, 20 min paus dras av → 35 min

describe("förhörstid (5 §)", () => {
  it("uppehåll under 15 min räknas in, 15 min eller mer dras av", () => {
    expect(forhorMinutes(FORHOR_1)).toBe(50);
    expect(forhorMinutes(FORHOR_2)).toBe(35);
    expect(forhorMinutes(forhor("02", "09:00", "10:00", [["09:10", "09:24"]]))).toBe(60);
    expect(forhorMinutes(forhor("02", "09:00", "10:00", [["09:10", "09:25"]]))).toBe(45);
  });

  it("flera förhör läggs samman — två korta kan tillsammans hamna i nästa intervall", () => {
    const res = computeForordnandeErsattning({
      forhor: [forhor("02", "09:00", "09:14"), forhor("03", "10:00", "10:01")], // 14 + 1 = 15 min
      tidsspillan: { vardagMinutes: 0, ovrigMinutes: 0 }, yrkandeDate: Y2026,
    });
    expect(res.kind === "taxa" && res.taxa.intervalLabel).toBe("15-29 min");
    expect(res.kind === "taxa" && res.taxa.ersattningExclVat).toBe(298_000);
  });
});

describe("när taxan gäller (3 §)", () => {
  it("vardag 07.00–18.00 gäller; kväll, helg och före 07 gör det inte", () => {
    expect(isWithinTaxaHours(forhor("02", "07:00", "18:00"))).toBe(true);
    expect(isWithinTaxaHours(forhor("02", "17:30", "18:10"))).toBe(false);
    expect(isWithinTaxaHours(forhor("02", "06:50", "07:30"))).toBe(false);
    expect(isWithinTaxaHours(forhor("07", "10:00", "11:00"))).toBe(false); // lördag
  });

  it("ett förhör utanför tiden → taxan tillämpas inte (löpande räkning)", () => {
    const res = computeForordnandeErsattning({
      forhor: [FORHOR_1, forhor("05", "18:30", "19:00")],
      tidsspillan: { vardagMinutes: 0, ovrigMinutes: 0 }, yrkandeDate: Y2026,
    });
    expect(res).toEqual({ kind: "utanfor-taxan", forhorMinutes: 80, reason: "utanfor-tid" });
  });

  it("sammanlagt 3 h 45 min är taxa, en minut till är det inte", () => {
    const at = (min: number) => computeForordnandeErsattning({
      forhor: [forhor("02", "08:00", "10:00"), { start: t("03", "08:00"), end: new Date(Date.parse(t("03", "08:00")) + (min - 120) * 60_000) }],
      tidsspillan: { vardagMinutes: 0, ovrigMinutes: 0 }, yrkandeDate: Y2026,
    });
    const max = at(225);
    expect(max.kind === "taxa" && max.taxa.ersattningExclVat).toBe(988_700);
    expect(at(226)).toMatchObject({ kind: "utanfor-taxan", reason: "over-max", forhorMinutes: 226 });
  });

  it("inga förhör alls → lägsta taxebeloppet (6 §)", () => {
    const res = computeForordnandeErsattning({ forhor: [], tidsspillan: { vardagMinutes: 0, ovrigMinutes: 0 }, yrkandeDate: Y2026 });
    expect(res.kind === "taxa" && res.taxa.ersattningExclVat).toBe(280_900);
  });
});

describe("tidsspillan — en timme ingår i taxan (8 §)", () => {
  it("under en timme → inget utöver taxan", () => {
    expect(tidsspillanUtover({ vardagMinutes: 45, ovrigMinutes: 0 }, Y2026, true).amountOre).toBe(0);
  });

  it("timmen dras i första hand från tid före 08 / efter 18", () => {
    const r = tidsspillanUtover({ vardagMinutes: 30, ovrigMinutes: 90 }, Y2026, true);
    expect(r).toMatchObject({ ingarOvrigMinutes: 60, ingarVardagMinutes: 0, extraOvrigMinutes: 30, extraVardagMinutes: 30 });
    expect(r.amountOre).toBe(123_100); // 30 min × 975 + 30 min × 1 487
  });
});

describe("det rapporterade fallet: FU nedlagd efter två förhör", () => {
  const res = computeForordnandeErsattning({
    forhor: [FORHOR_1, FORHOR_2],
    tidsspillan: { vardagMinutes: 150, ovrigMinutes: 30 },
    yrkandeDate: Y2026,
  });

  it("förhörstiden 50 + 35 = 85 min → intervallet 1 tim 15 min – 1 tim 29 min", () => {
    expect(res.forhorMinutes).toBe(85);
    expect(res.kind === "taxa" && res.taxa.intervalLabel).toBe("1 tim 15 min - 1 tim 29 min");
    expect(res.kind === "taxa" && res.taxa.ersattningExclVat).toBe(510_600);
  });

  it("3 h tidsspillan − 1 h (först de 30 min annan tid) → 2 h vardag à 1 487 kr", () => {
    expect(res.kind === "taxa" && res.tidsspillan).toMatchObject({
      ingarOvrigMinutes: 30, ingarVardagMinutes: 30, extraVardagMinutes: 120, extraOvrigMinutes: 0, amountOre: 297_400,
    });
  });

  it("arvodet = taxan + överskjutande tidsspillan = 8 080 kr exkl moms", () => {
    expect(res.kind === "taxa" && res.arvodeExclVat).toBe(808_000);
  });

  it("utan F-skatt räknas både taxan och tidsspillan om med 1237/1626 (13 §)", () => {
    const noF = computeForordnandeErsattning({
      forhor: [FORHOR_1, FORHOR_2], tidsspillan: { vardagMinutes: 150, ovrigMinutes: 30 }, yrkandeDate: Y2026, hasFTax: false,
    });
    expect(noF.kind === "taxa" && noF.taxa.ersattningExclVat).toBe(388_445);
    expect(noF.kind === "taxa" && noF.tidsspillan.amountOre).toBe(226_251);
  });

  it("gränsvärdet (7 662 kr) överskrids av den löpande tiden → taxan får frångås (10 §)", () => {
    const over = computeForordnandeErsattning({
      forhor: [FORHOR_1, FORHOR_2], tidsspillan: { vardagMinutes: 0, ovrigMinutes: 0 }, yrkandeDate: Y2026, skaligErsattningOre: 800_000,
    });
    expect(over.kind === "taxa" && over.gransvardeOverskrids).toBe(true);
    expect(res.kind === "taxa" && res.gransvardeOverskrids).toBe(false);
  });

  it("yrkande före 2026 → föregående årgång (DVFS 2024:16): 4 979 kr", () => {
    const old = computeForordnandeErsattning({
      forhor: [FORHOR_1, FORHOR_2], tidsspillan: { vardagMinutes: 0, ovrigMinutes: 0 }, yrkandeDate: "2025-12-15",
    });
    expect(old.kind === "taxa" && old.taxa.ersattningExclVat).toBe(497_900);
  });
});
