/**
 * Advokatberedskapens garantiersättning (#950) — DVFS 2024:20 / 2025:9.
 *
 * Två saker skiljer kategorin från alla andra, och båda testas här:
 *
 * 1. Den ersätts **per dag**, inte per timme. En post är ett dygns beredskap och
 *    bär noll minuter — beredskap är inte arbetad tid. Värderas den med
 *    `minuter × timnorm` blir den tyst noll, vilket är exakt den felmod
 *    `coverageEntryValueOre` finns för att förhindra.
 * 2. Den utgår **inte** för dag då biträdet är berättigat ersättning för arbete
 *    efter helgförhandling eller polisförhör utom kontorstid (§ 2). Blev man
 *    inkallad betalas arbetet i stället för garantin.
 *
 * Beloppen är avlästa ur föreskrifterna: 2 487 kr/dag (DVFS 2024:20 § 1, gäller
 * 2025) och 2 550 kr/dag (DVFS 2025:9 § 1, gäller 2026).
 */

import { describe, it, expect } from "vitest-compat";
import {
  advokatberedskapFtaxForDate, coverageEntryValueOre, isPerDayKind,
  payableCoverageEntries, type CoverageEntryLike,
} from "@/lib/shared/brottmalstaxa";

const beredskap = (date: string): CoverageEntryLike => ({ date, minutes: 0, kind: "ADVOKATBEREDSKAP" });
const obekvam = (date: string, minutes = 120): CoverageEntryLike => ({ date, minutes, kind: "ARBETE_OBEKVAM_TID" });

describe("advokatberedskap — belopp per dag", () => {
  it("2026 års belopp är 2 550 kr/dag, 2025 års 2 487", () => {
    expect(advokatberedskapFtaxForDate("2026-06-01")).toBe(255_000);
    expect(advokatberedskapFtaxForDate("2025-06-01")).toBe(248_700);
  });

  it("kategorin är per-dygn, övriga är per-timme", () => {
    expect(isPerDayKind("ADVOKATBEREDSKAP")).toBe(true);
    for (const k of ["ARBETE", "ARBETE_OBEKVAM_TID", "TIDSSPILLAN", "TIDSSPILLAN_OVRIG_TID", null, undefined] as const) {
      expect(isPerDayKind(k), `${String(k)} ska inte vara per-dygn`).toBe(false);
    }
  });
});

describe("coverageEntryValueOre", () => {
  it("beredskap värderas till dagbeloppet — oavsett minuter", () => {
    expect(coverageEntryValueOre(beredskap("2026-05-02"), "2026-05-02")).toBe(255_000);
    // Även om någon råkat registrera minuter ska dagbeloppet gälla: kategorin
    // har ingen timnorm att multiplicera med.
    expect(coverageEntryValueOre({ ...beredskap("2026-05-02"), minutes: 480 }, "2026-05-02")).toBe(255_000);
  });

  it("värderas på VÄRDERINGSDATUMETS år (retroaktiv höjning, #891)", () => {
    // Posten är från 2025 men slutregleras 2026 → 2026 års belopp.
    expect(coverageEntryValueOre(beredskap("2025-12-27"), "2026-03-01")).toBe(255_000);
    expect(coverageEntryValueOre(beredskap("2025-12-27"), "2025-12-31")).toBe(248_700);
  });

  it("timbaserade kategorier räknas som förut", () => {
    // 120 min arbete på obekväm tid 2026: 3 256 kr/h → 6 512 kr.
    expect(coverageEntryValueOre(obekvam("2026-05-02"), "2026-05-02")).toBe(651_200);
    // 30 min arbete 2026: 1 626 / 2 = 813 kr.
    expect(coverageEntryValueOre({ date: "2026-05-02", minutes: 30, kind: "ARBETE" }, "2026-05-02")).toBe(81_300);
  });
});

describe("payableCoverageEntries — DVFS 2025:9 § 2", () => {
  it("beredskapen faller bort för dag med arbete på obekväm tid", () => {
    const entries = [beredskap("2026-05-02"), obekvam("2026-05-02")];
    const payable = payableCoverageEntries(entries);
    expect(payable).toHaveLength(1);
    expect(payable[0]!.kind).toBe("ARBETE_OBEKVAM_TID");
  });

  it("…men bara för DEN dagen — övriga beredskapsdagar står kvar", () => {
    const entries = [beredskap("2026-05-02"), beredskap("2026-05-03"), obekvam("2026-05-02")];
    const kept = payableCoverageEntries(entries).filter((e) => e.kind === "ADVOKATBEREDSKAP");
    expect(kept.map((e) => e.date)).toEqual(["2026-05-03"]);
  });

  it("jämförelsen gäller DAGEN, inte tidpunkten", () => {
    // Förhandlingen ligger kl 09 och beredskapen är daterad midnatt — samma dag.
    const entries = [
      { date: "2026-05-02T00:00:00.000Z", minutes: 0, kind: "ADVOKATBEREDSKAP" as const },
      { date: "2026-05-02T09:30:00.000Z", minutes: 90, kind: "ARBETE_OBEKVAM_TID" as const },
    ];
    expect(payableCoverageEntries(entries).some((e) => e.kind === "ADVOKATBEREDSKAP")).toBe(false);
  });

  it("ICKE-debiterbart arbete tar inte garantin", () => {
    // "Berättigad ersättning för arbete" — är arbetet inte debiterbart utgår
    // ingen ersättning för det, och garantin står kvar.
    const entries = [beredskap("2026-05-02"), { ...obekvam("2026-05-02"), billable: false }];
    expect(payableCoverageEntries(entries).some((e) => e.kind === "ADVOKATBEREDSKAP")).toBe(true);
  });

  it("vanligt arbete samma dag tar INTE garantin", () => {
    // Bara helgförhandling/polisförhör (ARBETE_OBEKVAM_TID) utlöser § 2.
    const entries = [beredskap("2026-05-02"), { date: "2026-05-02", minutes: 60, kind: "ARBETE" as const }];
    expect(payableCoverageEntries(entries).some((e) => e.kind === "ADVOKATBEREDSKAP")).toBe(true);
  });

  it("utan beredskapsposter är funktionen en identitet", () => {
    const entries = [obekvam("2026-05-02"), { date: "2026-05-03", minutes: 60, kind: "ARBETE" as const }];
    expect(payableCoverageEntries(entries)).toEqual(entries);
  });
});
