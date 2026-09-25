/**
 * Use case (från användaren): ett brottmål startar som vanligt, advokaten
 * debiterar löpande. Efter några dagar läggs förundersökningen ned och
 * advokaten får betalt enligt taxan i förordnandemål — beloppet bygger på den
 * SAMMANLAGDA förhörstiden (flera förhör läggs ihop), tidsspillan redovisas med
 * avdrag för den timme som ingår i taxan, och kostnadsräkningen ska visa allt.
 *
 * Belopp enligt DVFS 2025:5 (bilagan) och DVFS 2025:4 (tidsspillan).
 */
import { describe, expect, it } from "vitest-compat";
import { renderHandlebars } from "@/lib/client/kostnadsrakning/render-handlebars";
import type { Forhor } from "@/lib/shared/forordnandetaxa";
import { buildKostnadsrakningContext, type BuildInput } from "@/lib/shared/kostnadsrakning";
import { KOSTNADSRAKNING_DEFAULT_HTML } from "@/lib/shared/kostnadsrakning-template";

const at = (day: string, hm: string): string => `2026-03-${day}T${hm}:00+01:00`;

/** Två förhör: 50 min (10 min paus räknas in) + 35 min (20 min paus dras av) = 85 min. */
const FORHOR: Forhor[] = [
  { start: at("02", "09:00"), end: at("02", "09:50"), pauses: [{ start: at("02", "09:20"), end: at("02", "09:30") }] },
  { start: at("04", "13:00"), end: at("04", "13:55"), pauses: [{ start: at("04", "13:20"), end: at("04", "13:40") }] },
];

/** Det advokaten debiterat löpande innan förundersökningen lades ned. */
const TIME_ENTRIES: BuildInput["timeEntries"] = [
  { id: "t1", date: "2026-03-01", description: "Genomgång av förundersökningsmaterial", minutes: 120, kind: "ARBETE" },
  { id: "t2", date: "2026-03-02", description: "Förhör 1 hos polisen", minutes: 50, kind: "ARBETE" },
  { id: "t3", date: "2026-03-02", description: "Resa till polishuset", minutes: 90, kind: "TIDSSPILLAN" },
  { id: "t4", date: "2026-03-04", description: "Förhör 2 hos polisen", minutes: 35, kind: "ARBETE" },
  { id: "t5", date: "2026-03-04", description: "Resa till polishuset", minutes: 60, kind: "TIDSSPILLAN" },
  { id: "t6", date: "2026-03-04", description: "Hemresa efter kl. 18", minutes: 30, kind: "TIDSSPILLAN_OVRIG_TID" },
];

const INPUT: BuildInput = {
  matter: { matterNumber: "AA2026-0042", title: "Brottmål — misstanke om stöld", clientName: "Kim Klient" },
  defender: { name: "Anna Advokat", email: "anna@byra.se" },
  courtName: "Stockholms tingsrätt",
  yrkandeDate: "2026-03-10",
  isTaxeArende: true,
  hasFTax: true,
  forordnande: { forhor: FORHOR },
  timeEntries: TIME_ENTRIES,
  expenses: [
    { id: "e1", date: "2026-03-02", description: "Parkering polishuset", amount: 12_500, vatRate: 2500, vatIncluded: true },
  ],
};

describe("förordnandemål: FU nedlagd efter två förhör", () => {
  const kr = buildKostnadsrakningContext(INPUT);

  it("arvodet = taxan för 85 min förhör + tidsspillan utöver en timme", () => {
    // Taxa 1 tim 15 – 1 tim 29 min: 5 106 kr. Tidsspillan 3 h (2,5 h vardag + 0,5 h annan tid);
    // timmen som ingår tas först från annan tid → 2 h vardag à 1 487 kr = 2 974 kr.
    expect(kr.arvodeExclVat).toBe(808_000);
    expect(kr.arvodeMoms).toBe(202_000);
    expect(kr.arvodeInclVat).toBe(1_010_000);
  });

  it("den löpande debiteringen ersätts inte utöver taxan (7 §) men redovisas", () => {
    expect(kr.timeLines.map((l) => l.amountOre)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(kr.timeLines).toHaveLength(6);
  });

  it("ingen huvudförhandling räknas", () => {
    expect(kr.huvudforhandlingMinutes).toBe(0);
  });

  it("utlägg (resa/parkering) ersätts vid sidan av taxan (9 §)", () => {
    expect(kr.expenseSummary.inclVat).toBe(12_500);
    expect(kr.totalInclVat).toBe(1_010_000 + 12_500);
  });

  it("kostnadsräkningen visar förhören, summan, taxan, tidsspillan och arbetet", () => {
    const html = renderHandlebars(KOSTNADSRAKNING_DEFAULT_HTML, kr.templateContext);
    expect(html).not.toMatch(/\{\{/);
    expect(html).toContain("förordnandemål (DVFS 2025:5)");
    // Varje förhör + den sammanlagda tiden
    expect(html).toContain("2026-03-02");
    expect(html).toContain("50 min");
    expect(html).toContain("35 min");
    expect(html).toContain("1 tim 25 min");
    // Taxan
    expect(html).toContain("Taxa, förhörstid 1 tim 15 min - 1 tim 29 min");
    expect(html).toMatch(/5\s106,00 kr/);
    // Tidsspillan med avdrag för den timme som ingår
    expect(html).toContain("Tidsspillan totalt 3 tim, varav 1 tim ingår i taxan");
    expect(html).toMatch(/Tidsspillan vardag 08–18 utöver taxan: 2 tim à 1\s487,00 kr\/h/);
    expect(html).toMatch(/2\s974,00 kr/);
    // Arbetet som utförts (ingår i taxan) + utlägg + totalen
    expect(html).toContain("Utfört arbete (ingår i taxan)");
    expect(html).toContain("Genomgång av förundersökningsmaterial");
    expect(html).toContain("Parkering polishuset");
    expect(html).toMatch(/10\s225,00 kr/);
    // Ingen huvudförhandling i ett förordnandemål
    expect(html).not.toContain("Huvudförhandling");
    expect(html).not.toContain("Brottmålstaxa");
  });
});

describe("förordnandemål som inte ryms i taxan", () => {
  it("förhör på kvällen → löpande räkning, och dokumentet säger varför", () => {
    const kr = buildKostnadsrakningContext({
      ...INPUT,
      forordnande: { forhor: [...FORHOR, { start: at("05", "18:30"), end: at("05", "19:15") }] },
    });
    // Löpande: arbete 205 min à 1 626 + tidsspillan 150 min à 1 487 + 30 min à 975.
    expect(kr.arvodeExclVat).toBe(Math.round((205 * 162_600 + 150 * 148_700 + 30 * 97_500) / 60));
    const html = renderHandlebars(KOSTNADSRAKNING_DEFAULT_HTML, kr.templateContext);
    expect(html).toContain("utanför vardagar 07.00–18.00");
    expect(html).toContain("Arvode — löpande räkning");
    expect(html).not.toMatch(/\{\{/);
  });

  it("gränsvärdet överskrids av det löpande arbetet → varning att taxan får frångås", () => {
    const kr = buildKostnadsrakningContext({
      ...INPUT,
      timeEntries: [...(TIME_ENTRIES ?? []), { id: "t7", date: "2026-03-05", description: "Omfattande analys", minutes: 300, kind: "ARBETE" }],
    });
    const html = renderHandlebars(KOSTNADSRAKNING_DEFAULT_HTML, kr.templateContext);
    expect(html).toContain("taxan får frångås (10 §)");
  });
});
