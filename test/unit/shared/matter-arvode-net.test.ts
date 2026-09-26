/** EN värderingsregel för förslag, aconto och kostnadsräkning (rådgivnings-/0-kronorsbuggen). */
import { describe, expect, it } from "vitest-compat";
import { matterArvodeNet, matterEntryValueOre } from "@/lib/shared/billing-work-value";
import { timkostnadsnormFtaxForDate } from "@/lib/shared/brottmalstaxa";

const DATE = "2026-09-26";
const NORM = timkostnadsnormFtaxForDate(DATE);
const entry = (minutes: number, hourlyRate: number) => ({ minutes, hourlyRate, billable: true, date: DATE, kind: "ARBETE" as const });
const WORK = { timeEntries: [entry(60, 0), entry(390, 0)] }; // 7,5 h utan timpris

describe("matterArvodeNet", () => {
  it("rättshjälp: normen utan rådgivningstimmen, oavsett posternas timpris", () => {
    expect(matterArvodeNet({ paymentMethod: "RATTSHJALP" }, WORK, DATE)).toBe(Math.round(6.5 * NORM));
  });

  it("offentligt uppdrag (ej taxa): normen för hela tiden", () => {
    expect(matterArvodeNet({ paymentMethod: "OFFENTLIGT_UPPDRAG", isTaxeArende: false }, WORK, DATE)).toBe(Math.round(7.5 * NORM));
  });

  it("privat, blandat och taxeärende: posternas egna á-priser", () => {
    const own = { timeEntries: [entry(120, 250_000)] };
    expect(matterArvodeNet({ paymentMethod: "PRIVAT" }, own, DATE)).toBe(500_000);
    expect(matterArvodeNet({ paymentMethod: "MIX" }, own, DATE)).toBe(500_000);
    expect(matterArvodeNet({ paymentMethod: "OFFENTLIGT_UPPDRAG", isTaxeArende: true }, own, DATE)).toBe(500_000);
  });
});

describe("matterEntryValueOre", () => {
  it("normen per post i domstolsersatta ärenden, eget á-pris annars", () => {
    expect(matterEntryValueOre({ paymentMethod: "RATTSHJALP" }, entry(60, 0), DATE)).toBe(NORM);
    expect(matterEntryValueOre({ paymentMethod: "PRIVAT" }, entry(60, 250_000), DATE)).toBe(250_000);
  });
});
