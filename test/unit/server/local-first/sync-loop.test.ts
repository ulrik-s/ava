/**
 * Tester för `SyncLoop` — bakgrundsprocessen som driver fetch + hydrate
 * i local-first-läget.
 *
 * Designmål för testbarhet:
 *   - `tickOnce()` exponerad så vi kan driva loopen deterministiskt
 *     utan riktiga timers.
 *   - `start()`/`stop()` använder setInterval men testas separat med
 *     fake timers så vi inte blir flakiga.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { SyncLoop } from "@/lib/server/local-first/sync-loop";
import { InMemoryFileSystem } from "@/lib/server/local-first/in-memory-fs";
import { InMemoryGitOps } from "@/lib/server/local-first/in-memory-git-ops";
import { ProjectionWriter, ProjectionHydrator } from "@/lib/server/local-first/projection-writer";
import { buildDefaultRegistry } from "@/lib/server/local-first/projections/default-registry";
import type { MatterProjectionData } from "@/lib/server/local-first/projections/matter";

const sampleMatter: MatterProjectionData = {
  id: "matter-1",
  matterNumber: "2026-0001",
  title: "Vårdnadstvist",
  status: "ACTIVE",
  organizationId: "org-1",
};

function buildPair() {
  // Två klienter mot samma "remote"
  const annaFs = new InMemoryFileSystem();
  const bjornFs = new InMemoryFileSystem();
  const annaGit = new InMemoryGitOps("anna", annaFs);
  const bjornGit = annaGit.spawnConcurrentClient("bjorn", bjornFs);
  return { annaFs, bjornFs, annaGit, bjornGit };
}

describe("SyncLoop — tickOnce", () => {
  it("ingen ändring på remote → noChanges, inget hydrate-kall", async () => {
    const { bjornFs, bjornGit } = buildPair();
    const hydrator = new ProjectionHydrator(bjornFs, buildDefaultRegistry());
    const onHydrated = vi.fn();
    const loop = new SyncLoop({ git: bjornGit, hydrator, onHydrated });

    const result = await loop.tickOnce();
    expect(result.hadChanges).toBe(false);
    expect(result.changedPaths).toEqual([]);
    expect(onHydrated).not.toHaveBeenCalled();
  });

  it("anna pushar matter → björn:s tick fetchar och hydratiserar", async () => {
    const { annaFs, bjornFs, annaGit, bjornGit } = buildPair();

    // Anna projicierar + commitar
    const writer = new ProjectionWriter(annaFs, buildDefaultRegistry());
    await writer.project("matter", sampleMatter);
    await annaGit.commit("Skapa matter-1");
    await annaGit.push();

    // Björn:s tick
    const hydrator = new ProjectionHydrator(bjornFs, buildDefaultRegistry());
    const onHydrated = vi.fn();
    const loop = new SyncLoop({ git: bjornGit, hydrator, onHydrated });
    const result = await loop.tickOnce();

    expect(result.hadChanges).toBe(true);
    expect(result.changedPaths).toContain("matters/active/matter-1.json");
    expect(onHydrated).toHaveBeenCalledTimes(1);
    const [entity, data] = onHydrated.mock.calls[0]!;
    expect(entity).toBe("matter");
    expect((data as { id: string }).id).toBe("matter-1");
  });

  it("två successiva ticks: andra ticken ser inga ändringar (idempotent)", async () => {
    const { annaFs, bjornFs, annaGit, bjornGit } = buildPair();
    const writer = new ProjectionWriter(annaFs, buildDefaultRegistry());
    await writer.project("matter", sampleMatter);
    await annaGit.commit("c"); await annaGit.push();

    const hydrator = new ProjectionHydrator(bjornFs, buildDefaultRegistry());
    const onHydrated = vi.fn();
    const loop = new SyncLoop({ git: bjornGit, hydrator, onHydrated });

    const first = await loop.tickOnce();
    expect(first.hadChanges).toBe(true);
    expect(onHydrated).toHaveBeenCalledTimes(1);

    const second = await loop.tickOnce();
    expect(second.hadChanges).toBe(false);
    expect(onHydrated).toHaveBeenCalledTimes(1); // ej igen
  });

  it("skippar tick om lokala commits ligger ahead (för säkerhet)", async () => {
    const { bjornFs, bjornGit } = buildPair();

    // Björn har en oskickad lokal commit
    await bjornFs.writeFile("local-only.txt", "Björns ändring");
    await bjornGit.commit("Lokal ändring");

    const hydrator = new ProjectionHydrator(bjornFs, buildDefaultRegistry());
    const onHydrated = vi.fn();
    const loop = new SyncLoop({ git: bjornGit, hydrator, onHydrated });

    const result = await loop.tickOnce();
    expect(result.skippedReason).toBe("local-ahead");
    expect(onHydrated).not.toHaveBeenCalled();
  });

  it("hydratorerns callback får entity, data och path", async () => {
    const { annaFs, bjornFs, annaGit, bjornGit } = buildPair();
    const writer = new ProjectionWriter(annaFs, buildDefaultRegistry());
    await writer.project("matter", sampleMatter);
    await annaGit.commit("c"); await annaGit.push();

    const seen: Array<{ entity: string; path: string }> = [];
    const hydrator = new ProjectionHydrator(bjornFs, buildDefaultRegistry());
    const loop = new SyncLoop({
      git: bjornGit, hydrator,
      onHydrated: (entity, _data, path) => {
        seen.push({ entity, path });
      },
    });
    await loop.tickOnce();
    expect(seen).toEqual([
      { entity: "matter", path: "matters/active/matter-1.json" },
    ]);
  });
});

describe("SyncLoop — start/stop", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("start kallar tickOnce med konfigurerat intervall", () => {
    const { bjornFs, bjornGit } = buildPair();
    const hydrator = new ProjectionHydrator(bjornFs, buildDefaultRegistry());
    const loop = new SyncLoop({
      git: bjornGit, hydrator, onHydrated: () => {}, intervalMs: 5000,
    });
    const spy = vi.spyOn(loop, "tickOnce").mockResolvedValue({
      hadChanges: false, changedPaths: [], hydrated: 0,
    });
    loop.start();
    vi.advanceTimersByTime(5001);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5001);
    expect(spy).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it("stop förhindrar fler tickOnce-anrop", () => {
    const { bjornFs, bjornGit } = buildPair();
    const hydrator = new ProjectionHydrator(bjornFs, buildDefaultRegistry());
    const loop = new SyncLoop({
      git: bjornGit, hydrator, onHydrated: () => {}, intervalMs: 1000,
    });
    const spy = vi.spyOn(loop, "tickOnce").mockResolvedValue({
      hadChanges: false, changedPaths: [], hydrated: 0,
    });
    loop.start();
    vi.advanceTimersByTime(1001);
    expect(spy).toHaveBeenCalledTimes(1);
    loop.stop();
    vi.advanceTimersByTime(10000);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("start två gånger är no-op (idempotent)", () => {
    const { bjornFs, bjornGit } = buildPair();
    const hydrator = new ProjectionHydrator(bjornFs, buildDefaultRegistry());
    const loop = new SyncLoop({
      git: bjornGit, hydrator, onHydrated: () => {}, intervalMs: 1000,
    });
    const spy = vi.spyOn(loop, "tickOnce").mockResolvedValue({
      hadChanges: false, changedPaths: [], hydrated: 0,
    });
    loop.start();
    loop.start();
    vi.advanceTimersByTime(1001);
    expect(spy).toHaveBeenCalledTimes(1);
    loop.stop();
  });
});
