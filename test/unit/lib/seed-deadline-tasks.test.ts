/**
 * Seedens frister är uppgifter (#2120): Frister och Att bevaka läser bara
 * uppgifter, så en frist som kalenderhändelse syns ingenstans.
 */

import { describe, it, expect } from "vitest-compat";
import { buildSeed } from "@/../tooling/scripts/seed-data";

const seed = buildSeed();
const DEADLINE_TITLES = ["Inlaga inlämnas", "Bevisuppgift", "Överklagan sista dag"];
const isDeadlineTitle = (title: string): boolean => DEADLINE_TITLES.some((t) => title.startsWith(`${t} — `));

describe("seedens frister (#2120)", () => {
  it("ingen kalenderhändelse är en frist", () => {
    expect(seed.calendarEvents.filter((e) => e.kind !== "appointment").map((e) => e.id)).toEqual([]);
    expect(seed.calendarEvents.filter((e) => isDeadlineTitle(String(e.title))).map((e) => e.id)).toEqual([]);
  });

  it("de nio fristerna är uppgifter med ärende, ägare, datum och status TODO", () => {
    const deadlines = seed.tasks.filter((t) => isDeadlineTitle(String(t.title)));
    expect(deadlines).toHaveLength(9);
    for (const t of deadlines) {
      expect(t.matterId, String(t.id)).toBeTruthy();
      expect(t.userId, String(t.id)).toBeTruthy();
      expect(t.dueAt, String(t.id)).toBeInstanceOf(Date);
      expect(t.status).toBe("TODO");
      expect(t.completedAt).toBeNull();
    }
    expect(new Set(deadlines.map((t) => t.id)).size).toBe(9);
  });

  it("uppgifternas id:n är unika", () => {
    expect(new Set(seed.tasks.map((t) => t.id)).size).toBe(seed.tasks.length);
  });

  it("mötena behåller sina platser: 16 händelser, varje med sluttid efter start", () => {
    expect(seed.calendarEvents).toHaveLength(16);
    expect(seed.calendarEvents.map((e) => e.id)).not.toContain("cal-004");
    for (const e of seed.calendarEvents) {
      expect(e.allDay).toBe(false);
      expect(new Date(String(e.endAt)).getTime()).toBeGreaterThan(new Date(String(e.startAt)).getTime());
    }
  });
});
