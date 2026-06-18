/**
 * Tester för `createDemoStore` (#420, ADR 0016) — den persisterade offline-
 * first-storen demon kör mot.
 *
 * Regression-skydd: source-snapshot och mutations-kö MÅSTE ligga i SKILDA
 * IndexedDB-databaser. Annars skapar `IdbKv` aldrig den andras object-store
 * (`onupgradeneeded` fyrar bara på en ny DB) → `CachingSyncDataStore.create`
 * kastar/hänger på `MutationQueue.hydrate` och demon fastnar på "Laddar…".
 */

import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect } from "vitest-compat";
import { createDemoStore } from "@/lib/client/backend/create-demo-store";
import type { FirmaConfig } from "@/lib/client/firma/firma-config";
import type { DemoSource } from "@/lib/shared/demo-source";

const cfg = { tier: "demo", repo: "x/r", token: "", organizationId: "o", authorName: "A", authorEmail: "a@a" } as FirmaConfig;

describe("createDemoStore", () => {
  it("bygger storen från fetchad seed vid cache-miss (skilda DB → ingen NotFoundError)", async () => {
    const factory = new IDBFactory();
    const seed: DemoSource = { matters: [{ id: "m1", title: "T" }] };
    const store = await createDemoStore(cfg, { factory, loadSeed: () => Promise.resolve(seed) });
    expect((store.store.currentSource.matters ?? [])).toHaveLength(1);
    expect(store.pendingCount()).toBe(0);
  });

  it("persisterar seed:en → andra anropet hydreras ur cachen utan ny fetch", async () => {
    const factory = new IDBFactory();
    const seed: DemoSource = { matters: [{ id: "m1", title: "T" }] };
    let fetchCount = 0;
    const loadSeed = () => { fetchCount++; return Promise.resolve(seed); };

    await createDemoStore(cfg, { factory, loadSeed });
    const second = await createDemoStore(cfg, { factory, loadSeed });

    expect(fetchCount).toBe(1); // andra gången: cache-hit, ingen fetch
    expect((second.store.currentSource.matters ?? [])).toHaveLength(1);
  });

  it("mutationer persisteras + köas (offline) utan att kasta", async () => {
    const factory = new IDBFactory();
    const store = await createDemoStore(cfg, { factory, loadSeed: () => Promise.resolve({ matters: [] }) });
    await store.store.matters.create({ data: { id: "m2", title: "Ny" } as never });
    expect(store.pendingCount()).toBe(1);
  });
});
