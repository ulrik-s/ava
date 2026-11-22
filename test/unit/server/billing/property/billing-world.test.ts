/**
 * Generatorn för egenskapstesterna (#1810): seed 1–40 ska täcka de fall som
 * annars inte prövas (tidsspillan annan tid, helgförhandling, förhandling som
 * inte börjar kl. 09), så att generatorn inte tyst smalnar av; och samma seed
 * ska ge samma "nu" och samma ärende.
 */

import { describe, expect, it } from "vitest-compat";
import { STOCKHOLM_TZ, stockholmTime } from "@/lib/shared/stockholm-time";
import { rng } from "../../../helpers/seeded-rng";
import { nowFor, type Scenario, scenarioFor } from "./billing-world";

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: STOCKHOLM_TZ, weekday: "short" });

/** Seedens "nu" och första ärende (offentligt uppdrag), i egenskapstesternas ordning. */
function firstScenario(seed: number): { now: Date; s: Scenario } {
  const r = rng(seed);
  const now = nowFor(r);
  return { now, s: scenarioFor(r, "OFFENTLIGT_UPPDRAG", now) };
}

const scenarios = SEEDS.map(firstScenario);
const hufStarts = scenarios.map(({ s }) => new Date(s.huf.hufStart));

describe("billing-world: generatorns täckning, seed 1–40", () => {
  it("minst ett ärende har tidsspillan annan tid", () => {
    expect(scenarios.some(({ s }) => s.entries.some((e) => e.kind === "TIDSSPILLAN_OVRIG_TID"))).toBe(true);
  });

  it("minst en huvudförhandling ligger på en helg (svensk tid)", () => {
    expect(hufStarts.some((d) => ["Sat", "Sun"].includes(WEEKDAY.format(d)))).toBe(true);
  });

  it("minst en huvudförhandling börjar inte kl. 09:00 (svensk tid)", () => {
    expect(hufStarts.some((d) => stockholmTime(d) !== "09:00")).toBe(true);
  });

  it("varje förhandling börjar på hel kvart och före seedens nu", () => {
    for (const [i, d] of hufStarts.entries()) {
      expect(d.getUTCMinutes() % 15).toBe(0);
      expect(d.getTime()).toBeLessThan(scenarios[i]?.now.getTime() ?? 0);
    }
  });

  it("varje nu ligger mellan 2025-01-15 och 2026-12-31, och båda åren förekommer", () => {
    const nows = scenarios.map(({ now }) => now);
    for (const now of nows) {
      expect(now.getTime()).toBeGreaterThanOrEqual(Date.UTC(2025, 0, 15));
      expect(now.getTime()).toBeLessThanOrEqual(Date.UTC(2026, 11, 31));
    }
    expect(new Set(nows.map((d) => d.getUTCFullYear()))).toEqual(new Set([2025, 2026]));
  });

  it("posterna och förhandlingen ligger i seedens år", () => {
    for (const { now, s } of scenarios) {
      const years = [...s.entries.map((e) => e.date), ...s.expenses.map((x) => x.date)].map((d) => d.getUTCFullYear());
      expect(new Set([...years, now.getUTCFullYear()])).toEqual(new Set([now.getUTCFullYear()]));
    }
  });
});

/** Förhandlingen och alla poster ligger i `now`:s år (UTC) och före `now`. */
function expectBeforeNowSameYear(s: Scenario, now: Date): void {
  const year = now.getUTCFullYear();
  const dates = [new Date(s.huf.hufStart), ...s.entries.map((e) => e.date), ...s.expenses.map((x) => x.date)];
  for (const d of dates) {
    expect(d.getTime()).toBeLessThan(now.getTime());
    expect(d.getUTCFullYear()).toBe(year);
  }
}

const METHODS = ["OFFENTLIGT_UPPDRAG", "RATTSHJALP", "PRIVAT"] as const;

describe("billing-world: förhandlingen före nu, även på årets första dygn", () => {
  it("med nu den 1 januari ligger förhandlingen och posterna före nu och i samma år", () => {
    const now = new Date("2026-01-01T05:00:00Z");
    for (const seed of Array.from({ length: 200 }, (_, i) => i + 1)) {
      const r = rng(seed);
      for (const method of METHODS) expectBeforeNowSameYear(scenarioFor(r, method, now), now);
    }
  });

  it("strax efter årsskiftet i svensk tid hamnar förhandlingen inte i förra året", () => {
    const now = new Date("2025-12-31T23:30:00Z");
    for (const seed of Array.from({ length: 200 }, (_, i) => i + 1)) {
      expectBeforeNowSameYear(scenarioFor(rng(seed), "OFFENTLIGT_UPPDRAG", now), now);
    }
  });

  it("seed 298 och 489 (förr efter nu) ger förhandlingen före nu", () => {
    for (const seed of [298, 489]) {
      const r = rng(seed);
      const now = nowFor(r);
      for (const method of METHODS) expectBeforeNowSameYear(scenarioFor(r, method, now), now);
    }
  });
});

describe("billing-world: reproduktion", () => {
  it("samma seed ger samma nu och samma ärende", () => {
    expect(firstScenario(7)).toEqual(firstScenario(7));
  });

  it("olika seeds ger olika nu", () => {
    expect(firstScenario(1).now).not.toEqual(firstScenario(2).now);
  });
});
