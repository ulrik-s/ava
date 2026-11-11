/**
 * "Deltagit i förhandling" (FORHANDLING): markerar att ärendet haft en
 * förhandling. Den prissätts som timarvode, värderas på timkostnadsnormen i
 * täckningsärenden, och räknas ALDRIG som arbete i en kostnadsräkning —
 * förhandlingstiden där är klockans (HUF), annars yrkades den två gånger.
 */
import { describe, expect, it } from "vitest-compat";
import { coverageEntryRateOre, timkostnadsnormFtaxForDate, tidsspillanFtaxForDate } from "@/lib/shared/brottmalstaxa";
import { rateKindOf, resolveHourlyRate } from "@/lib/shared/hourly-rate";
import { buildKostnadsrakningContext, hasHearingEntry, isKrWorkEntry } from "@/lib/shared/kostnadsrakning";

const base = {
  matter: { matterNumber: "2026-0016", title: "Nedlagt mål", clientName: "Falk" },
  defender: { name: "Anna Advokat" },
  hufStart: new Date("2026-05-25T09:00:00"),
  hufEnd: new Date("2026-05-25T10:35:00"), // 95 min
  taxaLevel: 1 as const,
  hasFTax: true,
  isTaxeArende: false,
  expenses: [],
};
const ARBETE = { id: "t1", date: "2026-05-20", description: "Genomgång", minutes: 120, billable: true, kind: "ARBETE" as const };
const HEARING = { id: "t2", date: "2026-05-25", description: "Huvudförhandling", minutes: 95, billable: true, kind: "FORHANDLING" as const };

describe("kostnadsräkningen och förhandlingsposten", () => {
  it("förhandlingsposten räknas inte som arbete — tiden är klockans", () => {
    const withHearing = buildKostnadsrakningContext({ ...base, timeEntries: [ARBETE, HEARING] });
    const without = buildKostnadsrakningContext({ ...base, timeEntries: [ARBETE] });
    expect(withHearing.billableArbetsMinutes).toBe(120);
    expect(withHearing.timeLines.map((t) => t.id)).toEqual(["t1"]);
    expect(withHearing.totalInclVat).toBe(without.totalInclVat);
  });

  it("utan förhandling (start = slut): bara ärendets poster yrkas", () => {
    const r = buildKostnadsrakningContext({ ...base, hufEnd: base.hufStart, timeEntries: [ARBETE] });
    expect(r.huvudforhandlingMinutes).toBe(0);
    expect(r.totalArbetsMinutes).toBe(120);
  });

  it("isKrWorkEntry / hasHearingEntry", () => {
    expect(isKrWorkEntry(ARBETE)).toBe(true);
    expect(isKrWorkEntry({ kind: null })).toBe(true);
    expect(isKrWorkEntry(HEARING)).toBe(false);
    expect(hasHearingEntry([ARBETE])).toBe(false);
    expect(hasHearingEntry([ARBETE, HEARING])).toBe(true);
    expect(hasHearingEntry([])).toBe(false);
  });
});

describe("prissättning av förhandlingsposten", () => {
  it("timpriset är timarvodets, genom samma kedja", () => {
    expect(rateKindOf("FORHANDLING")).toBe("ARBETE");
    expect(resolveHourlyRate(rateKindOf("FORHANDLING") ?? "ARBETE", { user: { ARBETE: 200_000 }, org: { ARBETE: 150_000 } })).toBe(200_000);
  });

  it("timbaserade kategorier behåller sin egen, beredskap har inget timpris", () => {
    expect(rateKindOf("TIDSSPILLAN")).toBe("TIDSSPILLAN");
    expect(rateKindOf("ADVOKATBEREDSKAP")).toBeNull();
  });

  it("i täckningsärenden: timkostnadsnormen, och övriga kategorier som förut", () => {
    const d = "2026-06-01";
    expect(coverageEntryRateOre("FORHANDLING", d)).toBe(timkostnadsnormFtaxForDate(d));
    expect(coverageEntryRateOre("ARBETE", d)).toBe(timkostnadsnormFtaxForDate(d));
    expect(coverageEntryRateOre(null, d)).toBe(timkostnadsnormFtaxForDate(d));
    expect(coverageEntryRateOre("TIDSSPILLAN", d)).toBe(tidsspillanFtaxForDate(d));
  });
});
