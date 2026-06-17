/**
 * `WorkingSetCache` (#418, ADR 0022) — prefetch + on-demand + LRU-vräkning mot
 * injicerade lagrings-loaders (fakes).
 */

import { describe, it, expect } from "vitest-compat";
import type { WorkingSetMatter } from "@/lib/client/working-set/working-set";
import { WorkingSetCache } from "@/lib/client/working-set/working-set-cache";

const ME = "u-1";

function fakes() {
  const loaded: string[] = [];
  const evicted: string[] = [];
  return {
    loaded, evicted,
    loadMatter: async (id: string) => { loaded.push(id); },
    evictMatter: async (id: string) => { evicted.push(id); },
  };
}

const matters: WorkingSetMatter[] = [
  { id: "mine", responsibleLawyerId: ME, status: "ACTIVE" },
  { id: "r1", responsibleLawyerId: "u-2", status: "ACTIVE" },
  { id: "r2", responsibleLawyerId: "u-2", status: "ACTIVE" },
  { id: "extra", responsibleLawyerId: "u-2", status: "ACTIVE" },
];

describe("WorkingSetCache (#418)", () => {
  it("prefetch hämtar working-set:en och touch:ar LRU", async () => {
    const f = fakes();
    const cache = new WorkingSetCache({ budget: 3, loadMatter: f.loadMatter, evictMatter: f.evictMatter });
    const ids = await cache.prefetch({ userId: ME, matters, recentMatterIds: ["r1", "r2"] });
    expect(ids).toEqual(["mine", "r1", "r2"]);
    expect(f.loaded).toEqual(["mine", "r1", "r2"]);
    expect(f.evicted).toEqual([]);
    expect(cache.size()).toBe(3);
  });

  it("openMatter hämtar on-demand utanför cachen och vräker LRU över budget", async () => {
    const f = fakes();
    const cache = new WorkingSetCache({ budget: 3, loadMatter: f.loadMatter, evictMatter: f.evictMatter });
    await cache.prefetch({ userId: ME, matters, recentMatterIds: ["r1", "r2"] });
    // Öppna "extra" (utanför set) → hämtas, och äldsta icke-pinnade (r1) vräks.
    await cache.openMatter("extra");
    expect(f.loaded).toContain("extra");
    expect(f.evicted).toEqual(["r1"]); // mine pinnad, r1 äldst icke-pinnad
    expect(cache.size()).toBe(3);
  });

  it("vräker aldrig ett ärende med icke-uppspelad mutation (pending)", async () => {
    const f = fakes();
    const pending = new Set(["r1"]);
    const cache = new WorkingSetCache({
      budget: 3, loadMatter: f.loadMatter, evictMatter: f.evictMatter, pendingMatterIds: () => pending,
    });
    await cache.prefetch({ userId: ME, matters, recentMatterIds: ["r1", "r2"] });
    await cache.openMatter("extra");
    expect(f.evicted).toEqual(["r2"]); // r1 pending → skyddad, r2 vräks istället
  });

  it("öppning av redan cachat ärende hämtar inte igen", async () => {
    const f = fakes();
    const cache = new WorkingSetCache({ budget: 5, loadMatter: f.loadMatter, evictMatter: f.evictMatter });
    await cache.prefetch({ userId: ME, matters, recentMatterIds: ["r1"] });
    const before = f.loaded.length;
    await cache.openMatter("mine");
    expect(f.loaded.length).toBe(before); // redan i cachen
  });
});
