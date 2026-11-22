/**
 * Egenskapstest med oberoende facit: timmen tidsspillan som ingår i taxan (#1812).
 *
 * `billing-consistency.test.ts` jämför dokumentet med körningen, men båda räknas
 * med samma funktion. Här räknas yrkandet för ett taxe-ärende i stället för hand
 * ur posterna: högst 60 minuter tidsspillan ingår i taxan (DVFS 2025:6 6 §), i
 * första hand från annan tid och resten från vardag; minuterna utöver gånger
 * årets norm yrkas. Facit importerar inte produktionens tidsspillan-funktioner.
 * Taxebeloppet tas från `computeBrottmalstaxa`, som har egna egenskapstester
 * (`test/unit/shared/property/taxa.test.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import { computeBrottmalstaxa } from "@/lib/shared/brottmalstaxa";
import { stockholmYear } from "@/lib/shared/stockholm-time";
import { rng, type Rng } from "../../../helpers/seeded-rng";
import { nowFor, type Scenario, taxeScenarioFor, worldFor } from "./billing-world";

const SEEDS: number[] = process.env.AVA_BILLING_SEED
  ? [Number(process.env.AVA_BILLING_SEED)]
  : Array.from({ length: Number(process.env.AVA_BILLING_SEEDS ?? 40) }, (_, i) => i + 1);

/** Hela kronor, räknat oberoende av `whole-kronor`: 1–49 öre ned, 50–99 upp. */
const kr = (ore: number): number => Math.floor((ore + 50) / 100) * 100;

/** Den timme tidsspillan som ingår i taxan (DVFS 2025:6 6 §). */
const INGAR_MINUTES = 60;

/**
 * Tidsspillan-normerna (F-skatt), öre/tim exkl moms, skrivna för hand:
 * 2025: 1 450 och 951 kr/h (DVFS 2024:15 § 4); 2026: 1 487 och 975 kr/h
 * (DVFS 2025:4 § 4). Okänt år → senaste.
 */
const NORM: Readonly<Record<number, { vardag: number; annan: number }>> = {
  2025: { vardag: 145_000, annan: 95_100 },
  2026: { vardag: 148_700, annan: 97_500 },
};
const LATEST_NORM = { vardag: 148_700, annan: 97_500 };

/** Normen på yrkandedagens svenska år. */
const normFor = (yrkande: Date): { vardag: number; annan: number } => NORM[stockholmYear(yrkande)] ?? LATEST_NORM;

/** Minuterna utöver timmen som ingår: den dras först från annan tid, resten från vardag. */
function utoverFacit(vardag: number, annan: number): { vardag: number; annan: number } {
  const annanIngar = Math.min(annan, INGAR_MINUTES);
  const vardagIngar = Math.min(vardag, INGAR_MINUTES - annanIngar);
  return { vardag: vardag - vardagIngar, annan: annan - annanIngar };
}

const minutesOf = (s: Scenario, kind: Scenario["entries"][number]["kind"]): number =>
  s.entries.filter((e) => e.kind === kind).reduce((sum, e) => sum + e.minutes, 0);

/** Yrkandet inkl moms för hand: A = kr(taxan) + kr(vardag utöver) + kr(annan tid utöver); A + kr(A × 0,25). */
function facitClaimOre(s: Scenario, yrkande: Date): number {
  const hufMinutes = (Date.parse(s.huf.hufEnd) - Date.parse(s.huf.hufStart)) / 60_000;
  const taxa = computeBrottmalstaxa({ huvudforhandlingMinutes: hufMinutes, level: s.taxaLevel, hasFTax: true, yrkandeDate: yrkande });
  const extra = utoverFacit(minutesOf(s, "TIDSSPILLAN"), minutesOf(s, "TIDSSPILLAN_OVRIG_TID"));
  const norm = normFor(yrkande);
  const a = kr(taxa.ersattningExclVat) + kr((extra.vardag * norm.vardag) / 60) + kr((extra.annan * norm.annan) / 60);
  return a + kr(a * 0.25);
}

describe("facit för timmen som ingår (exempel)", () => {
  it("90 min annan tid + 30 min vardag ⇒ 30 min annan tid och 30 min vardag utöver", () => {
    expect(utoverFacit(30, 90)).toEqual({ vardag: 30, annan: 30 });
  });

  it("30 min annan tid + 90 min vardag ⇒ ingen annan tid och 60 min vardag utöver", () => {
    expect(utoverFacit(90, 30)).toEqual({ vardag: 60, annan: 0 });
  });

  it("under en timme sammanlagt ⇒ inget utöver", () => {
    expect(utoverFacit(20, 40)).toEqual({ vardag: 0, annan: 0 });
  });

  it("normen följer yrkandedagens svenska år, och okänt år ger den senaste", () => {
    expect(normFor(new Date("2025-12-31T23:30:00Z"))).toEqual({ vardag: 148_700, annan: 97_500 });
    expect(normFor(new Date("2025-06-01T12:00:00Z"))).toEqual({ vardag: 145_000, annan: 95_100 });
    expect(normFor(new Date("2031-06-01T12:00:00Z"))).toEqual(LATEST_NORM);
  });
});

describe.each(SEEDS)("seed %i", (seed) => {
  const r: Rng = rng(seed);
  const now = nowFor(r);
  beforeEach(() => { vi.setSystemTime(now); });
  afterEach(() => { vi.setSystemTime(); });

  it("taxe-ärende: körningens belopp = facit (taxan + tidsspillan utöver timmen, 25 % moms)", async () => {
    const s = taxeScenarioFor(r, now);
    const world = worldFor(s);
    const { run } = await world.caller.billingRun.createKostnadsrakning({
      matterId: world.matterId, ...s.huf, taxaLevel: s.taxaLevel, isTaxeArende: true, hasFTax: true,
    });
    expect({ seed, claimed: run.workValueOreAtRun }).toEqual({ seed, claimed: facitClaimOre(s, now) });
  });
});
