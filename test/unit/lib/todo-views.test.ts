/**
 * Lås vy-logiken för todo dag/vecka/månad (#88) — gränsfall i lokal tid.
 */

import { describe, it, expect } from "vitest-compat";
import {
  rangeForView,
  shiftAnchor,
  viewRangeLabel,
  groupByDay,
} from "@/lib/client/todo/todo-views";

// Onsdag 2026-06-10 (lokal). Veckan mån–sön = 2026-06-08 … 2026-06-14.
const WED = new Date(2026, 5, 10, 14, 30);

describe("rangeForView", () => {
  it("dag: midnatt → 23:59 samma dag", () => {
    const { from, to } = rangeForView("day", WED);
    expect(from.getHours()).toBe(0);
    expect(from.getDate()).toBe(10);
    expect(to.getDate()).toBe(10);
    expect(to.getHours()).toBe(23);
  });

  it("vecka: måndag → söndag", () => {
    const { from, to } = rangeForView("week", WED);
    expect(from.getDate()).toBe(8); // måndag
    expect(from.getDay()).toBe(1);
    expect(to.getDate()).toBe(14); // söndag
    expect(to.getDay()).toBe(0);
  });

  it("vecka: söndag hör till föregående måndag-vecka", () => {
    const sun = new Date(2026, 5, 14, 9, 0);
    const { from, to } = rangeForView("week", sun);
    expect(from.getDate()).toBe(8);
    expect(to.getDate()).toBe(14);
  });

  it("månad: 1:a → sista dagen", () => {
    const { from, to } = rangeForView("month", WED);
    expect(from.getDate()).toBe(1);
    expect(from.getMonth()).toBe(5);
    expect(to.getDate()).toBe(30); // juni har 30 dagar
    expect(to.getMonth()).toBe(5);
  });
});

describe("shiftAnchor", () => {
  it("dag ±1", () => {
    expect(shiftAnchor("day", WED, 1).getDate()).toBe(11);
    expect(shiftAnchor("day", WED, -1).getDate()).toBe(9);
  });
  it("vecka ±7 dagar", () => {
    expect(shiftAnchor("week", WED, 1).getDate()).toBe(17);
    expect(shiftAnchor("week", WED, -1).getDate()).toBe(3);
  });
  it("månad ±1 månad", () => {
    expect(shiftAnchor("month", WED, 1).getMonth()).toBe(6);
    expect(shiftAnchor("month", WED, -1).getMonth()).toBe(4);
  });
});

describe("viewRangeLabel", () => {
  it("ger en icke-tom etikett per vy", () => {
    expect(viewRangeLabel("day", WED)).toContain("juni");
    expect(viewRangeLabel("month", WED)).toContain("juni");
    expect(viewRangeLabel("week", WED)).toMatch(/–/);
  });
});

describe("groupByDay", () => {
  it("grupperar per kalenderdag och sorterar kronologiskt", () => {
    const items = [
      { at: new Date(2026, 5, 10, 9, 0), id: "b" },
      { at: new Date(2026, 5, 8, 15, 0), id: "a" },
      { at: new Date(2026, 5, 10, 18, 0), id: "c" },
    ];
    const groups = groupByDay(items);
    expect(groups.map((g) => g.key)).toEqual(["2026-06-08", "2026-06-10"]);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(["b", "c"]); // bevarad ordning
  });

  it("hanterar ISO-strängar (demo-projektionens datumformat)", () => {
    const groups = groupByDay([{ at: new Date(2026, 5, 9, 12).toISOString(), id: "x" }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("2026-06-09");
  });

  it("tom in → tom ut", () => {
    expect(groupByDay([])).toEqual([]);
  });
});
