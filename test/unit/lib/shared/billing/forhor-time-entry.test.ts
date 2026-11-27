/**
 * Förhör som tidspost (#1855): kategorin `FORHOR` är arbete (timarvodets pris,
 * timkostnadsnormen, arbete i en löpande kostnadsräkning), och förordnandetaxan
 * läser förhören ur posterna med `forhorFromTimeEntries`.
 */
import { describe, expect, it } from "vitest-compat";
import { coverageEntryRateOre, timkostnadsnormFtaxForDate } from "@/lib/shared/billing/brottmalstaxa";
import {
  computeForordnandeErsattning, forhorFromTimeEntries, forhorMinutes, isWithinTaxaHours,
} from "@/lib/shared/billing/forordnandetaxa";
import { rateKindOf } from "@/lib/shared/billing/hourly-rate";
import { buildKostnadsrakningContext, isKrWorkEntry } from "@/lib/shared/billing/kostnadsrakning";
import { KR_KIND_HEADINGS } from "@/lib/shared/billing/kostnadsrakning-document-rows";
import { FORORDNANDE_AVSLUT_LABELS, forordnandeAvslutSchema, TIME_ENTRY_KIND_LABELS } from "@/lib/shared/schemas/enums";

/** Stockholm-tid i mars (CET, +01:00). Mars 2026: 2 = måndag, 7 = lördag. */
const at = (day: string, hm: string): string => `2026-03-${day}T${hm}:00+01:00`;
const forhor = (day: string, hm: string, minutes: number) => ({ kind: "FORHOR" as const, date: at(day, hm), minutes });

describe("kategorin Förhör", () => {
  it("har en etikett och ett kort namn i kostnadsräkningen", () => {
    expect(TIME_ENTRY_KIND_LABELS.FORHOR).toBe("Förhör (förundersökning)");
    expect(KR_KIND_HEADINGS.FORHOR).toBe("Förhör");
  });

  it("är arbete: timarvodets pris, timkostnadsnormen och arbete i kostnadsräkningen", () => {
    expect(rateKindOf("FORHOR")).toBe("ARBETE");
    expect(coverageEntryRateOre("FORHOR", "2026-03-02")).toBe(timkostnadsnormFtaxForDate("2026-03-02"));
    expect(isKrWorkEntry({ kind: "FORHOR" })).toBe(true);
    const kr = buildKostnadsrakningContext({
      matter: { matterNumber: "T-1", title: "x" }, defender: { name: "A" }, expenses: [], isTaxeArende: false,
      yrkandeDate: "2026-03-10", hufStart: "2026-03-10", hufEnd: "2026-03-10",
      timeEntries: [{ id: "f1", date: at("02", "09:00"), description: "Förhör", minutes: 45, billable: true, kind: "FORHOR" }],
    });
    expect(kr.billableArbetsMinutes).toBe(45);
  });
});

describe("forhorFromTimeEntries", () => {
  it("bara förhörsposter, äldst först, slut = start + minuter, inga uppehåll", () => {
    const res = forhorFromTimeEntries([
      forhor("04", "13:00", 35),
      { kind: "ARBETE", date: at("03", "10:00"), minutes: 60 },
      { kind: null, date: at("03", "11:00"), minutes: 60 },
      forhor("02", "09:00", 50),
    ]);
    expect(res.map((f) => [new Date(f.start).toISOString(), new Date(f.end).toISOString()])).toEqual([
      ["2026-03-02T08:00:00.000Z", "2026-03-02T08:50:00.000Z"],
      ["2026-03-04T12:00:00.000Z", "2026-03-04T12:35:00.000Z"],
    ]);
    expect(res.every((f) => f.pauses === undefined)).toBe(true);
  });

  it("ett förhör med långt uppehåll, registrerat som två poster, ger rätt förhörstid och 3 §-prövning", () => {
    // 09:00–09:20 och 09:40–10:15: 20 min uppehåll dras av → 20 + 35 = 55 min.
    const res = forhorFromTimeEntries([forhor("02", "09:00", 20), forhor("02", "09:40", 35)]);
    expect(res.reduce((s, f) => s + forhorMinutes(f), 0)).toBe(55);
    expect(res.every(isWithinTaxaHours)).toBe(true);
    const taxa = computeForordnandeErsattning({ forhor: res, tidsspillan: { vardagMinutes: 0, ovrigMinutes: 0 }, yrkandeDate: "2026-03-10" });
    expect(taxa.forhorMinutes).toBe(55);
    expect(taxa.kind).toBe("taxa");
  });

  it("ett förhör på en lördag är utanför taxans tid", () => {
    const [lordag] = forhorFromTimeEntries([forhor("07", "10:00", 60)]);
    expect(lordag && isWithinTaxaHours(lordag)).toBe(false);
  });

  it("inga förhörsposter → inga förhör", () => {
    expect(forhorFromTimeEntries([])).toEqual([]);
  });
});

describe("förundersökningens avslut", () => {
  it("tre värden, definierade en gång", () => {
    expect(forordnandeAvslutSchema.options).toEqual(["NEDLAGD", "STRAFFORELAGGANDE", "INGET_ATAL"]);
    expect(FORORDNANDE_AVSLUT_LABELS.STRAFFORELAGGANDE).toBe("Strafföreläggande godkändes");
  });

  it("kostnadsräkningens förordnandemål skriver avslutet", () => {
    const input = {
      matter: { matterNumber: "T-2", title: "x" }, defender: { name: "A" }, expenses: [], isTaxeArende: true,
      yrkandeDate: "2026-03-10", timeEntries: [],
    };
    const forhorList = forhorFromTimeEntries([forhor("02", "09:00", 50)]);
    const med = buildKostnadsrakningContext({ ...input, forordnande: { forhor: forhorList, avslut: "NEDLAGD" } });
    const utan = buildKostnadsrakningContext({ ...input, forordnande: { forhor: forhorList } });
    expect(med.document.notes[0]).toMatch(/^Förundersökningen lades ned — förordnandemål \(DVFS 2025:5\)/);
    expect(utan.document.notes[0]).toMatch(/^Förundersökningen har avslutats utan åtal — förordnandemål/);
  });
});
