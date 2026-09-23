/**
 * `billing-work-value` — arbetets värde och momsens fördelning (#1100).
 *
 * Funktionerna låg i `routers/billingRun.ts` och kunde bara nås genom en
 * tRPC-caller. Router-testerna bevisar att FLÖDENA fungerar; de här bevisar
 * att RÄKNINGEN gör det, och kommer åt kanter som ett flödestest inte når:
 * ett tomt ärende, en post utan kategori, ett årsskifte mitt i.
 *
 * Beloppen är i öre genomgående. Där en siffra ser godtycklig ut är den hämtad
 * ur Domstolsverkets föreskrifter, inte påhittad.
 */

import { describe, it, expect } from "vitest-compat";
import {
  arvodeLine, arvodeNetOre, coverageBaseMinutes, entryOwnValueOre, expenseBreakdownLines,
  expenseGrossOre, expenseNetOre, grossOreOf, invoiceGrossOre, invoiceVatBreakdown,
  krGrossOre, minutesByKind, netOreOf, settlementArvodeNet, sumKindValueOre,
  timeEntryValueOre, vatOnNet, vatOreOf, workValueOre, type UnfrozenWork,
} from "@/lib/shared/billing-work-value";
import { asId } from "@/lib/shared/schemas/ids";

const te = (o: Partial<UnfrozenWork["timeEntries"][number]> = {}): UnfrozenWork["timeEntries"][number] => ({
  id: asId<"TimeEntryId">("te-1"), minutes: 60, hourlyRate: 250_000, billable: true,
  date: "2026-03-01", description: "Arbete", ...o,
});
const ex = (o: Partial<UnfrozenWork["expenses"][number]> = {}): UnfrozenWork["expenses"][number] => ({
  id: asId<"ExpenseId">("ex-1"), amount: 10_000, billable: true, ...o,
});
const work = (t: UnfrozenWork["timeEntries"] = [], e: UnfrozenWork["expenses"] = []): UnfrozenWork =>
  ({ timeEntries: t, expenses: e });

describe("timeEntryValueOre", () => {
  it("minuter × taxa, avrundat en gång", () => {
    expect(timeEntryValueOre(60, 250_000)).toBe(250_000);
    expect(timeEntryValueOre(90, 250_000)).toBe(375_000);
  });

  // Avrundning i mellansummor ackumulerar ören tills fakturan slutar stämma
  // med sin egen specifikation. Därför avrundas EN gång, per post.
  it("avrundar obekväma kvoter i stället för att tappa ören", () => {
    expect(timeEntryValueOre(1, 100_000)).toBe(1_667); // 1/60 × 100 000
    expect(timeEntryValueOre(7, 162_600)).toBe(18_970);
  });

  it("noll minuter ger noll", () => {
    expect(timeEntryValueOre(0, 250_000)).toBe(0);
  });
});

describe("entryOwnValueOre", () => {
  it("vanlig post värderas på sin egen taxa", () => {
    expect(entryOwnValueOre({ minutes: 120, hourlyRate: 200_000, date: "2026-03-01" })).toBe(400_000);
  });

  // Per-dygns-kategorierna har inga minuter. Utan undantaget blir de
  // `0 × taxa = 0` och försvinner tyst ur både kostnadsräkning och
  // "Upparbetat ofakturerat" — ett bortfall som inte syns någonstans.
  it("per-dygns-post värderas på DVFS-dagbeloppet, inte på minuter", () => {
    const advokatberedskap = entryOwnValueOre({ minutes: 0, hourlyRate: 250_000, date: "2026-03-01", kind: "ADVOKATBEREDSKAP" });
    expect(advokatberedskap).toBeGreaterThan(0);
  });
});

describe("coverageBaseMinutes", () => {
  // Rådgivningstimmen loggas som vanlig tidspost men faktureras separat, och
  // ska därför inte ingå i rättshjälpsavgiftens bas (#809).
  it("rättshjälp räknar bort rådgivningstimmen", () => {
    expect(coverageBaseMinutes("RATTSHJALP", 600)).toBe(540);
  });

  it("klampar till noll — ett ärende under en timme ger inte negativ bas", () => {
    expect(coverageBaseMinutes("RATTSHJALP", 30)).toBe(0);
  });

  it.each(["PRIVAT", "RATTSSKYDD", "OFFENTLIGT_UPPDRAG", "MIX"] as const)("%s rör inte basen", (m) => {
    expect(coverageBaseMinutes(m, 600)).toBe(600);
  });
});

describe("arvodeNetOre", () => {
  it("summerar bara debiterbara poster", () => {
    expect(arvodeNetOre(work([te({ minutes: 60 }), te({ minutes: 60, billable: false })]))).toBe(250_000);
  });

  it("tomt ärende ger noll, inte NaN", () => {
    expect(arvodeNetOre(work())).toBe(0);
  });
});

describe("utlägg och moms", () => {
  it("netto och brutto skiljer sig med momsen", () => {
    const w = work([], [ex({ amount: 10_000 })]);
    expect(expenseGrossOre(w)).toBeGreaterThanOrEqual(expenseNetOre(w));
  });

  it("ej debiterbara utlägg räknas inte", () => {
    expect(expenseNetOre(work([], [ex({ billable: false })]))).toBe(0);
  });

  it("vatOnNet lägger 25 % på nettot", () => {
    expect(vatOnNet(100_000)).toBe(25_000);
    expect(vatOnNet(0)).toBe(0);
  });

  it("arvodeLine är null vid noll arvode — en tom rad ljuger om innehåll", () => {
    expect(arvodeLine(0)).toBeNull();
    expect(arvodeLine(-1)).toBeNull();
  });

  it("arvodeLine bär netto och moms var för sig", () => {
    const line = arvodeLine(100_000);
    expect({ net: line?.netOre, vat: line?.vatOre }).toEqual({ net: 100_000, vat: 25_000 });
  });
});

describe("breakdown-summorna hänger ihop", () => {
  const w = work([te({ minutes: 120 })], [ex({ amount: 50_000 })]);

  it("brutto = netto + moms", () => {
    const lines = invoiceVatBreakdown(w);
    expect(grossOreOf(lines)).toBe(netOreOf(lines) + vatOreOf(lines));
  });

  // Den här likheten är hela poängen: fakturans belopp måste gå att härleda
  // ur samma rader som bokförs i verifikatet (#790).
  it("invoiceGrossOre = breakdownens brutto", () => {
    expect(invoiceGrossOre(w)).toBe(grossOreOf(invoiceVatBreakdown(w)));
  });

  it("workValueOre är NETTO — inte fakturabeloppet", () => {
    expect(workValueOre(w)).toBe(arvodeNetOre(w) + expenseNetOre(w));
    expect(workValueOre(w)).toBeLessThan(invoiceGrossOre(w));
  });

  it("tomt ärende ger tomma rader, inte en nollrad", () => {
    expect(invoiceVatBreakdown(work())).toEqual([]);
  });
});

describe("minutesByKind", () => {
  it("grupperar per kategori och defaultar till ARBETE", () => {
    const m = minutesByKind([{ minutes: 60 }, { minutes: 30, kind: "TIDSSPILLAN" }, { minutes: 30 }]);
    expect({ arbete: m.get("ARBETE"), spillan: m.get("TIDSSPILLAN") }).toEqual({ arbete: 90, spillan: 30 });
  });

  // Per-dygns-poster har inga minuter att gruppera. Räknades de in skulle de
  // belasta timbaserade tak och carve-outs de inte hör hemma i.
  it("hoppar över per-dygns-kategorier", () => {
    expect(minutesByKind([{ minutes: 0, kind: "ADVOKATBEREDSKAP" }]).size).toBe(0);
  });
});

describe("sumKindValueOre", () => {
  it("värderar varje kategori på SIN norm", () => {
    const arbete = sumKindValueOre(new Map([["ARBETE", 60]]), "2026-06-01");
    const spillan = sumKindValueOre(new Map([["TIDSSPILLAN", 60]]), "2026-06-01");
    expect(arbete).toBeGreaterThan(spillan); // tidsspillan har lägre norm
  });

  it("tom karta ger noll", () => {
    expect(sumKindValueOre(new Map(), "2026-06-01")).toBe(0);
  });
});

describe("settlementArvodeNet", () => {
  const w = work([te({ minutes: 60, hourlyRate: 300_000, date: "2026-03-01" })]);

  // Bara PRIVAT/MIX debiterar byråns egen taxa. Domstolen betalar normen,
  // inte vad byrån råkar ta (#950/#1003).
  it.each(["PRIVAT", "MIX"] as const)("%s behåller postens egen taxa", (m) => {
    expect(settlementArvodeNet(m, w, "2026-06-01")).toBe(300_000);
  });

  it.each(["RATTSHJALP", "RATTSSKYDD", "OFFENTLIGT_UPPDRAG"] as const)(
    "%s värderas på Domstolsverkets norm, inte byråns taxa",
    (m) => {
      expect(settlementArvodeNet(m, w, "2026-06-01")).not.toBe(300_000);
    },
  );

  // Den retroaktiva höjningen: arbete utfört 2025 räknas om på 2026 års norm
  // när ärendet slutregleras 2026 (#891).
  it("samma arbete värderas högre när det slutregleras ett senare år", () => {
    const arbete2025 = work([te({ minutes: 120, date: "2025-11-15" })]);
    const pa2025 = settlementArvodeNet("RATTSHJALP", arbete2025, "2025-12-01");
    const pa2026 = settlementArvodeNet("RATTSHJALP", arbete2025, "2026-06-01");
    expect(pa2026).toBeGreaterThan(pa2025);
  });

  it("tomt ärende ger noll för alla betalningssätt", () => {
    for (const m of ["PRIVAT", "RATTSHJALP", "RATTSSKYDD", "OFFENTLIGT_UPPDRAG", "MIX"] as const) {
      expect(settlementArvodeNet(m, work(), "2026-06-01"), m).toBe(0);
    }
  });
});

describe("krGrossOre", () => {
  // Kostnadsräkningen går ALLTID till domstol, så utläggen värderas med 25 %
  // moms oavsett vad byrån själv betalade (#945).
  it("arvode inkl moms + utläggens brutto", () => {
    const w = work([], [ex({ amount: 20_000 })]);
    expect(krGrossOre(w, 100_000)).toBe(125_000 + grossOreOf(expenseBreakdownLines(w)));
  });

  it("noll arvode ger bara utläggen", () => {
    expect(krGrossOre(work(), 0)).toBe(0);
  });
});
