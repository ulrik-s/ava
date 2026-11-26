/**
 * Seedens frister är uppgifter (#2120): Frister och Att bevaka läser bara
 * uppgifter, så en frist som kalenderhändelse syns ingenstans.
 */

import { describe, it, expect } from "vitest-compat";
import { buildSeed } from "@/../tooling/scripts/seed-data";

const seed = buildSeed();
const DEADLINE_TITLES = ["Inlaga inlämnas", "Bevisuppgift", "Överklagan sista dag"];
const isDeadlineTitle = (title: string): boolean => DEADLINE_TITLES.some((t) => title.startsWith(`${t} — `));
/** Fristtitel per plats i slingan om åtta (index 3, 4 och 6). */
const DEADLINE_BY_TEMPLATE: Record<number, string> = { 3: "Inlaga inlämnas", 4: "Bevisuppgift", 6: "Överklagan sista dag" };

/** Platsindexet ur id:t, t.ex. `task-frist-004` → 3 och `cal-001` → 0. */
function slotIndex(id: unknown): number {
  return Number(String(id).slice(-3)) - 1;
}

/** Tiden i ms för ett datumfält, eller NaN om fältet inte är ett datum. */
const timeOf = (v: unknown): number => (v instanceof Date ? v.getTime() : Number.NaN);

/** Det platsen ska ha, räknat oberoende av seeden: ärende, ägare och start. */
function expectedSlot(i: number): { matterId: unknown; matterNumber: unknown; userId: unknown; start: number } {
  const matter = seed.matters[i % seed.matters.length];
  const user = seed.users[i % seed.users.length];
  const start = new Date();
  start.setDate(start.getDate() + (i % 14) - 5);
  start.setHours(9 + (i % 4) * 2, 0, 0, 0);
  return { matterId: matter?.id, matterNumber: matter?.matterNumber, userId: user?.id, start: start.getTime() };
}

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

  it("varje frist har platsens titel, ärende, ägare och dag, och prioritet MEDIUM", () => {
    const deadlines = seed.tasks.filter((t) => String(t.id).startsWith("task-frist-"));
    expect(deadlines.map((t) => slotIndex(t.id))).toEqual([3, 4, 6, 11, 12, 14, 19, 20, 22]);
    for (const t of deadlines) {
      const i = slotIndex(t.id);
      const want = expectedSlot(i);
      expect(t.title, String(t.id)).toBe(`${String(DEADLINE_BY_TEMPLATE[i % 8])} — ${String(want.matterNumber)}`);
      expect(t.matterId, String(t.id)).toBe(want.matterId);
      expect(t.userId, String(t.id)).toBe(want.userId);
      expect(timeOf(t.dueAt), String(t.id)).toBe(want.start);
      expect(t.priority, String(t.id)).toBe("MEDIUM");
    }
  });

  it("ärendenumret i fristens titel är numret på uppgiftens ärende", () => {
    const numberById = new Map(seed.matters.map((m) => [m.id, m.matterNumber]));
    for (const t of seed.tasks.filter((x) => String(x.id).startsWith("task-frist-"))) {
      expect(String(t.title).endsWith(` — ${String(numberById.get(t.matterId))}`), String(t.id)).toBe(true);
    }
  });

  it("mötena behåller platsens id, ärende, ägare och tid", () => {
    for (const e of seed.calendarEvents) {
      const want = expectedSlot(slotIndex(e.id));
      expect(e.matterId, String(e.id)).toBe(want.matterId);
      expect(e.userId, String(e.id)).toBe(want.userId);
      expect(new Date(String(e.startAt)).getTime(), String(e.id)).toBe(want.start);
      expect(String(e.title).endsWith(` — ${String(want.matterNumber)}`), String(e.id)).toBe(true);
    }
  });

  it("möte och frist på samma plats får samma ärende, ägare och tid som slingan ger", () => {
    const cal = seed.calendarEvents.find((e) => e.id === "cal-001");
    const frist = seed.tasks.find((t) => t.id === "task-frist-004");
    expect(cal?.matterId).toBe(seed.matters[0]?.id);
    expect(cal?.userId).toBe(seed.users[0]?.id);
    expect(frist?.matterId).toBe(seed.matters[3]?.id);
    expect(frist?.userId).toBe(seed.users[3]?.id);
    expect(timeOf(frist?.dueAt)).toBe(expectedSlot(3).start);
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
