/**
 * #1162: när en frist är "inne". Kalenderdagar i lokal tid, inte klockslag.
 */
import { describe, expect, it } from "vitest-compat";
import { deadlineOf, isDeadlineDue } from "@/lib/shared/deadline";

const NOW = new Date(2026, 8, 24, 14, 30); // 24 sep 2026 14:30 lokal tid

describe("deadlineOf", () => {
  it("ingen / ogiltig frist → none", () => {
    expect(deadlineOf(null, NOW)).toEqual({ state: "none", daysLate: 0 });
    expect(deadlineOf(undefined, NOW).state).toBe("none");
    expect(deadlineOf("inte ett datum", NOW).state).toBe("none");
  });

  it("samma kalenderdag → today, oavsett klockslag", () => {
    expect(deadlineOf(new Date(2026, 8, 24, 0, 0), NOW)).toEqual({ state: "today", daysLate: 0 });
    expect(deadlineOf(new Date(2026, 8, 24, 23, 59), NOW).state).toBe("today");
  });

  it("passerad → overdue med antal dagar", () => {
    expect(deadlineOf(new Date(2026, 8, 23, 23, 59), NOW)).toEqual({ state: "overdue", daysLate: 1 });
    expect(deadlineOf(new Date(2026, 8, 14), NOW)).toEqual({ state: "overdue", daysLate: 10 });
  });

  it("framtida → upcoming (negativa dagar)", () => {
    expect(deadlineOf(new Date(2026, 8, 25, 0, 1), NOW)).toEqual({ state: "upcoming", daysLate: -1 });
  });

  it("ISO-sträng (demo-datalagret) fungerar som Date", () => {
    expect(deadlineOf(new Date(2026, 8, 24).toISOString(), NOW).state).toBe("today");
  });
});

describe("isDeadlineDue", () => {
  it("i dag eller passerad och inte klar → true", () => {
    expect(isDeadlineDue({ dueAt: new Date(2026, 8, 24), status: "TODO" }, NOW)).toBe(true);
    expect(isDeadlineDue({ dueAt: new Date(2026, 8, 1), status: "IN_PROGRESS" }, NOW)).toBe(true);
  });

  it("klar, framtida eller utan frist → false", () => {
    expect(isDeadlineDue({ dueAt: new Date(2026, 8, 1), status: "DONE" }, NOW)).toBe(false);
    expect(isDeadlineDue({ dueAt: new Date(2026, 8, 30), status: "TODO" }, NOW)).toBe(false);
    expect(isDeadlineDue({ dueAt: null, status: "TODO" }, NOW)).toBe(false);
  });
});
