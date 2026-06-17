/**
 * `computeWorkingSet` + `LruBudget` (#418, ADR 0022) — working-set-algoritmen.
 */

import { describe, it, expect } from "vitest-compat";
import { LruBudget } from "@/lib/client/working-set/lru-budget";
import { computeWorkingSet, type WorkingSetMatter } from "@/lib/client/working-set/working-set";

const ME = "u-1";
const matters = (extra: WorkingSetMatter[] = []): WorkingSetMatter[] => [
  { id: "m-mine", responsibleLawyerId: ME, status: "ACTIVE" },
  { id: "m-mine-closed", responsibleLawyerId: ME, status: "CLOSED" },
  { id: "m-other", responsibleLawyerId: "u-2", status: "ACTIVE" },
  { id: "m-cal", responsibleLawyerId: "u-2", status: "ACTIVE" },
  { id: "m-recent1", responsibleLawyerId: "u-2", status: "ACTIVE" },
  { id: "m-recent2", responsibleLawyerId: "u-2", status: "ACTIVE" },
  ...extra,
];

describe("computeWorkingSet (#418)", () => {
  it("pinnar mina AKTIVA ärenden (ej stängda, ej andras)", () => {
    const ws = computeWorkingSet({ userId: ME, matters: matters(), budget: 10 });
    expect(ws.pinned.has("m-mine")).toBe(true);
    expect(ws.pinned.has("m-mine-closed")).toBe(false);
    expect(ws.pinned.has("m-other")).toBe(false);
  });

  it("pinnar kalender-ärenden", () => {
    const ws = computeWorkingSet({ userId: ME, matters: matters(), calendarMatterIds: ["m-cal"], budget: 10 });
    expect(ws.pinned.has("m-cal")).toBe(true);
  });

  it("fyller upp med senast öppnade till budgeten", () => {
    const ws = computeWorkingSet({
      userId: ME, matters: matters(), recentMatterIds: ["m-recent1", "m-recent2"], budget: 2,
    });
    // pinned m-mine (1) + 1 recent = budget 2
    expect(ws.matterIds).toHaveLength(2);
    expect(ws.matterIds).toContain("m-mine");
    expect(ws.matterIds).toContain("m-recent1");
    expect(ws.matterIds).not.toContain("m-recent2");
  });

  it("pinnade får överstiga budgeten (vräks aldrig)", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `mine-${i}`, responsibleLawyerId: ME, status: "ACTIVE" }));
    const ws = computeWorkingSet({ userId: ME, matters: many, budget: 2 });
    expect(ws.matterIds).toHaveLength(5); // alla pinnade trots budget 2
  });

  it("hoppar recent-id som inte finns bland matters", () => {
    const ws = computeWorkingSet({ userId: ME, matters: matters(), recentMatterIds: ["ghost"], budget: 10 });
    expect(ws.matterIds).not.toContain("ghost");
  });
});

describe("LruBudget (#418)", () => {
  it("vräker minst-nyligen-rörda först, undantar pinnade", () => {
    const lru = new LruBudget(2);
    lru.touch("a"); lru.touch("b"); lru.touch("c"); // a äldst
    expect(lru.overflow(new Set())).toEqual(["a"]); // 3 > 2 → vräk a
    expect(lru.overflow(new Set(["a"]))).toEqual(["b"]); // a pinnad → vräk b istället
  });

  it("vräker inget när pinnade ensamma överstiger kapaciteten", () => {
    const lru = new LruBudget(1);
    lru.touch("a"); lru.touch("b");
    expect(lru.overflow(new Set(["a", "b"]))).toEqual([]);
  });

  it("touch flyttar sist; forget tar bort", () => {
    const lru = new LruBudget(2);
    lru.touch("a"); lru.touch("b"); lru.touch("a"); // a nu nyast → b äldst
    expect(lru.overflow(new Set())).toEqual([]); // 2 <= 2
    lru.touch("c"); // 3 > 2, b äldst
    expect(lru.overflow(new Set())).toEqual(["b"]);
    lru.forget("b");
    expect(lru.has("b")).toBe(false);
    expect(lru.size()).toBe(2);
  });
});
