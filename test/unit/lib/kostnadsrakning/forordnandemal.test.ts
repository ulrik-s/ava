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
import type { Forhor } from "@/lib/shared/billing/forordnandetaxa";
import { buildKostnadsrakningContext, type BuildInput } from "@/lib/shared/billing/kostnadsrakning";
import { KOSTNADSRAKNING_DEFAULT_HTML } from "@/lib/shared/billing/kostnadsrakning-template";

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
    // Varje förhör + den sammanlagda tiden (decimaltimmar i arbetsredogörelsen, #1218).
    // Klockslaget är det SVENSKA (#1677): förut stod UTC-tiden 08:00 på servern.
    expect(html).toContain("Förhör kl. 09:00–09:50");
    expect(html).toContain("0,83");
    expect(html).toContain("0,58");
    expect(html).toContain("1,42 tim");
    // Taxan
    expect(html).toContain("Taxa, förhörstid 1 tim 15 min - 1 tim 29 min");
    expect(html).toMatch(/5\s106,00\skr/);
    // Tidsspillan med avdrag för den timme som ingår
    expect(html).toContain("Tidsspillan totalt 3 h, varav 1 h ingår i taxan");
    expect(html).toMatch(/TIDSSPILLAN UTÖVER TAXAN<\/td><td class="num">2 á 1\s487\skr/);
    expect(html).toMatch(/2\s974,00\skr/);
    // Arbetet som utförts (ingår i taxan) + utlägg + totalen
    expect(html).toContain("Arvode (ingår i taxan)");
    expect(html).toContain("Genomgång av förundersökningsmaterial");
    expect(html).toContain("Parkering polishuset");
    expect(html).toMatch(/10\s225,00\skr/);
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
    // Löpande: arbete 205 min à 1 626 + tidsspillan 150 min à 1 487 + 30 min à 975,
    // varje rad avrundad till hela kronor (#1218): 5 555,50 → 5 556; 3 717,50 → 3 718; 487,50 → 488.
    expect(kr.arvodeExclVat).toBe(555_600 + 371_800 + 48_800);
    const html = renderHandlebars(KOSTNADSRAKNING_DEFAULT_HTML, kr.templateContext);
    expect(html).toContain("utanför vardagar 07.00–18.00");
    // Löpande: arvodet per kategori och á-pris i sammanställningen (#1218).
    expect(html).toMatch(/ARVODE<\/td><td class="num">3,42 á 1\s626\skr/);
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

// ─── Mallens förordnandeavsnitt (templateContext.forordnande, #1839) ──────
//
// Facit ur DVFS 2025:5 (taxan 2026, nivå 1: 75–89 min = 5 106 kr) och DVFS 2025:4
// (tidsspillan 2026: vardag 08–18 1 487 kr/h, annan tid 975 kr/h). 8 §: en timme
// tidsspillan ingår i taxan, i första hand annan tid.

/** Förhörsraderna för FORHOR: 09:00–09:50 (50 min = 0,83 h) och 13:00–13:55 (35 min = 0,58 h). */
const FORHOR_LINES = [
  { date: "2026-03-02", start: "09:00", end: "09:50", minutesFormatted: "0,83 h" },
  { date: "2026-03-04", start: "13:00", end: "13:55", minutesFormatted: "0,58 h" },
];
/** Beloppet som `formatKr` skriver det: sv-SE grupperar tusental med hårt blanksteg. */
const kr = (s: string): string => s.replace(/(?<=\d) (?=\d|kr)/g, "\u00a0");
const TAXA_85_MIN = { intervalLabel: "1 tim 15 min - 1 tim 29 min", taxaAmountFormatted: kr("5 106,00 kr") };
const forordnandeOf = (input: BuildInput): unknown => buildKostnadsrakningContext(input).templateContext.forordnande;

describe("förordnandemål: mallens förordnandeavsnitt", () => {
  it("taxefallet med en tidsspillanrad: bara vardagen ersätts utöver taxan", () => {
    // Tidsspillan 150 min vardag + 30 min annan tid = 3 h. Ingår: 30 min annan tid + 30 min vardag
    // = 1 h. Utöver: 120 min vardag (2 h à 1 487 = 2 974 kr) och 0 min annan tid (ingen rad).
    // Skälig ersättning (löpande): arbete 205 min à 1 626 = 5 555,50 + vardag 150 min à 1 487
    // = 3 717,50 + annan tid 30 min à 975 = 487,50 → 9 760,50 kr, över gränsvärdet 7 662 kr.
    expect(forordnandeOf(INPUT)).toEqual({
      forhorLines: FORHOR_LINES, forhorTotalFormatted: "1,42 h", taxaApplies: true, ...TAXA_85_MIN,
      tidsspillanTotalFormatted: "3 h", tidsspillanIngarFormatted: "1 h",
      tidsspillanRader: [{ label: "Tidsspillan vardag 08–18", minutesFormatted: "2 h", rateFormatted: kr("1 487,00 kr/h"), amountFormatted: kr("2 974,00 kr") }],
      tidsspillanAmountFormatted: kr("2 974,00 kr"), gransvardeOverskrids: true,
    });
  });

  it("annan tid över en timme: båda raderna, och timmen som ingår tas från annan tid", () => {
    // Tidsspillan 60 min vardag + 90 min annan tid = 2,5 h. Ingår: 60 min annan tid, 0 min vardag.
    // Utöver: 60 min vardag (1 h à 1 487 = 1 487 kr) + 30 min annan tid (0,5 h à 975 = 487,50 kr)
    // = 1 974,50 kr. Skälig ersättning 1 487 + 1 462,50 = 2 949,50 kr, under gränsvärdet 7 662 kr.
    const timeEntries: BuildInput["timeEntries"] = [
      { id: "v", date: "2026-03-02", description: "Resa", minutes: 60, kind: "TIDSSPILLAN" },
      { id: "o", date: "2026-03-04", description: "Hemresa efter kl. 18", minutes: 90, kind: "TIDSSPILLAN_OVRIG_TID" },
    ];
    expect(forordnandeOf({ ...INPUT, timeEntries })).toEqual({
      forhorLines: FORHOR_LINES, forhorTotalFormatted: "1,42 h", taxaApplies: true, ...TAXA_85_MIN,
      tidsspillanTotalFormatted: "2,5 h", tidsspillanIngarFormatted: "1 h",
      tidsspillanRader: [
        { label: "Tidsspillan vardag 08–18", minutesFormatted: "1 h", rateFormatted: kr("1 487,00 kr/h"), amountFormatted: kr("1 487,00 kr") },
        { label: "Tidsspillan annan tid", minutesFormatted: "0,5 h", rateFormatted: kr("975,00 kr/h"), amountFormatted: kr("487,50 kr") },
      ],
      tidsspillanAmountFormatted: kr("1 974,50 kr"), gransvardeOverskrids: false,
    });
  });

  it("utanför taxan: förhören och skälet, inga taxe- eller tidsspillanfält", () => {
    // Förhöret 18:30–19:15 (45 min = 0,75 h) ligger utanför vardag 07–18; summan 85 + 45 = 130 min.
    const evening = { start: at("05", "18:30"), end: at("05", "19:15") };
    expect(forordnandeOf({ ...INPUT, forordnande: { forhor: [...FORHOR, evening] } })).toEqual({
      forhorLines: [...FORHOR_LINES, { date: "2026-03-05", start: "18:30", end: "19:15", minutesFormatted: "0,75 h" }],
      forhorTotalFormatted: "2,17 h", taxaApplies: false,
      utanforText: "Förhör har hållits utanför vardagar 07.00–18.00 — taxan tillämpas inte, ersättning enligt löpande räkning.",
    });
  });

  it("inget förordnande: inget avsnitt", () => {
    const { forordnande: _none, ...withoutForordnande } = INPUT;
    expect(forordnandeOf(withoutForordnande)).toBeNull();
  });

  it("utelämnad F-skatt räknas som F-skatt, inte som utan", () => {
    const { hasFTax: _omitted, ...withoutFTaxField } = INPUT;
    const omitted = buildKostnadsrakningContext(withoutFTaxField);
    const withFTax = buildKostnadsrakningContext({ ...INPUT, hasFTax: true });
    expect([omitted.arvodeExclVat, omitted.templateContext.forordnande]).toEqual([withFTax.arvodeExclVat, withFTax.templateContext.forordnande]);
    // Utan F-skatt × kvoten 1 237 / 1 626 (2026), per rad i hela kronor:
    // taxan 5 106 × 1 237 / 1 626 = 3 884,45 → 3 884 kr; tidsspillan 2 974 × 1 237 / 1 626
    // = 2 262,53 → 2 263 kr; arvodet 6 147 kr. Med F-skatt 5 106 + 2 974 = 8 080 kr.
    expect(omitted.arvodeExclVat).toBe(808_000);
    expect(buildKostnadsrakningContext({ ...INPUT, hasFTax: false }).arvodeExclVat).toBe(614_700);
  });
});
