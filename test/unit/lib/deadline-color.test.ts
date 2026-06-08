/**
 * Lås gränsfallen för deadline-färgkodningen (#88).
 */

import { describe, it, expect } from "vitest-compat";
import { deadlineColor } from "@/lib/shared/deadline-color";

const NOW = new Date("2026-06-10T12:00:00.000Z");
const DAY = 86_400_000;
const at = (msFromNow: number): Date => new Date(NOW.getTime() + msFromNow);

describe("deadlineColor", () => {
  it("grön när ≥ 7 dagar kvar", () => {
    expect(deadlineColor(at(8 * DAY), NOW)).toBe("green");
    expect(deadlineColor(at(30 * DAY), NOW)).toBe("green");
  });

  it("grön exakt vid 7-dygnsgränsen (≥, inte <)", () => {
    expect(deadlineColor(at(7 * DAY), NOW)).toBe("green");
  });

  it("gul när 2–7 dagar kvar", () => {
    expect(deadlineColor(at(5 * DAY), NOW)).toBe("yellow");
    expect(deadlineColor(at(7 * DAY - 1), NOW)).toBe("yellow");
  });

  it("gul exakt vid 2-dygnsgränsen (2d är inte < 2d)", () => {
    expect(deadlineColor(at(2 * DAY), NOW)).toBe("yellow");
  });

  it("röd när < 2 dagar kvar", () => {
    expect(deadlineColor(at(2 * DAY - 1), NOW)).toBe("red");
    expect(deadlineColor(at(1 * DAY), NOW)).toBe("red");
    expect(deadlineColor(at(60 * 1000), NOW)).toBe("red");
  });

  it("röd när förfallen (dueAt passerat)", () => {
    expect(deadlineColor(at(-1), NOW)).toBe("red");
    expect(deadlineColor(at(-5 * DAY), NOW)).toBe("red");
  });

  it("null när ingen dueAt", () => {
    expect(deadlineColor(null, NOW)).toBeNull();
    expect(deadlineColor(undefined, NOW)).toBeNull();
    expect(deadlineColor("", NOW)).toBeNull();
  });

  it("null när uppgiften är klar (DONE), oavsett deadline", () => {
    expect(deadlineColor(at(-5 * DAY), NOW, { done: true })).toBeNull();
    expect(deadlineColor(at(1 * DAY), NOW, { done: true })).toBeNull();
  });

  it("accepterar ISO-sträng (demo-projektionens datumformat)", () => {
    expect(deadlineColor(at(1 * DAY).toISOString(), NOW)).toBe("red");
    expect(deadlineColor(at(10 * DAY).toISOString(), NOW)).toBe("green");
  });

  it("null vid ogiltigt datum (defensivt, kraschar inte)", () => {
    expect(deadlineColor("inte-ett-datum", NOW)).toBeNull();
  });
});
