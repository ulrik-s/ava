/**
 * #1162: när en frist är "inne". Kalenderdagar i svensk tid (#1677), inte
 * klockslag. Absoluta tidpunkter (`Z`) så att CI (UTC) och en utvecklare i
 * Stockholm får samma svar.
 */
import { describe, expect, it } from "vitest-compat";
import { deadlineOf, isDeadlineDue } from "@/lib/shared/deadline";

const NOW = new Date("2026-09-24T12:30:00Z"); // 24 sep 2026 14:30 svensk sommartid

describe("deadlineOf", () => {
  it("ingen / ogiltig frist → none", () => {
    expect(deadlineOf(null, NOW)).toEqual({ state: "none", daysLate: 0 });
    expect(deadlineOf(undefined, NOW).state).toBe("none");
    expect(deadlineOf("inte ett datum", NOW).state).toBe("none");
  });

  it("samma kalenderdag → today, oavsett klockslag", () => {
    expect(deadlineOf(new Date("2026-09-23T22:00:00Z"), NOW)).toEqual({ state: "today", daysLate: 0 }); // 00:00 svensk tid
    expect(deadlineOf(new Date("2026-09-24T21:59:00Z"), NOW).state).toBe("today"); // 23:59 svensk tid
  });

  it("passerad → overdue med antal dagar", () => {
    expect(deadlineOf(new Date("2026-09-23T21:59:00Z"), NOW)).toEqual({ state: "overdue", daysLate: 1 });
    expect(deadlineOf(new Date("2026-09-13T22:00:00Z"), NOW)).toEqual({ state: "overdue", daysLate: 10 });
  });

  it("framtida → upcoming (negativa dagar)", () => {
    expect(deadlineOf(new Date("2026-09-24T22:01:00Z"), NOW)).toEqual({ state: "upcoming", daysLate: -1 });
  });

  it("ISO-sträng (demo-datalagret) fungerar som Date", () => {
    expect(deadlineOf("2026-09-23T22:00:00.000Z", NOW).state).toBe("today");
  });

  it("ett rent datum (UTC-midnatt) är den dagen", () => {
    expect(deadlineOf("2026-09-24", NOW).state).toBe("today");
  });

  it("nyårsnatten: 00:30 svensk tid är redan nästa dag (#1677)", () => {
    const newYear = new Date("2025-12-31T23:30:00Z");
    expect(deadlineOf("2025-12-31", newYear)).toEqual({ state: "overdue", daysLate: 1 });
    expect(deadlineOf("2026-01-01", newYear)).toEqual({ state: "today", daysLate: 0 });
  });

  it("hela dygn även över sommartidsskiftet", () => {
    expect(deadlineOf("2026-03-28", new Date("2026-03-30T10:00:00Z"))).toEqual({ state: "overdue", daysLate: 2 });
  });
});

describe("isDeadlineDue", () => {
  it("i dag eller passerad och inte klar → true", () => {
    expect(isDeadlineDue({ dueAt: new Date("2026-09-23T22:00:00Z"), status: "TODO" }, NOW)).toBe(true);
    expect(isDeadlineDue({ dueAt: new Date("2026-08-31T22:00:00Z"), status: "IN_PROGRESS" }, NOW)).toBe(true);
  });

  it("klar, framtida eller utan frist → false", () => {
    expect(isDeadlineDue({ dueAt: new Date("2026-08-31T22:00:00Z"), status: "DONE" }, NOW)).toBe(false);
    expect(isDeadlineDue({ dueAt: new Date("2026-09-29T22:00:00Z"), status: "TODO" }, NOW)).toBe(false);
    expect(isDeadlineDue({ dueAt: null, status: "TODO" }, NOW)).toBe(false);
  });
});
