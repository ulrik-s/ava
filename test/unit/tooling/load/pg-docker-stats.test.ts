/**
 * Lasttestets Postgres- och container-mätning (#1366): tolkning av
 * Postgres logg och `docker stats`, och toppvärdena ur samplingarna.
 */
import { describe, expect, it } from "vitest-compat";
import { parseStatsLine, summarizeContainers, toMiB } from "../../../../tooling/load/docker-stats";
import { parseLockLog, peakOf } from "../../../../tooling/load/pg-stats";

describe("parseLockLog", () => {
  it("räknar väntor över deadlock_timeout, längsta väntan och deadlocks", () => {
    const log = [
      "2026-10-01 LOG:  process 12 still waiting for ShareLock on transaction 99 after 1000.512 ms",
      "2026-10-01 LOG:  process 12 acquired ShareLock on transaction 99 after 2345.6 ms",
      "2026-10-01 LOG:  process 13 still waiting for ExclusiveLock on advisory lock [1,2,3,4] after 1001.0 ms",
      "2026-10-01 ERROR:  deadlock detected",
      "vanlig rad",
    ].join("\n");
    expect(parseLockLog(log)).toEqual({ waitsOverTimeout: 2, maxWaitMs: 2346, deadlocks: 1 });
  });

  it("tom logg", () => {
    expect(parseLockLog("")).toEqual({ waitsOverTimeout: 0, maxWaitMs: 0, deadlocks: 0 });
  });
});

describe("peakOf", () => {
  it("toppvärdet per mått", () => {
    expect(peakOf([
      { total: 10, active: 2, idleInTransaction: 0, lockWaiters: 1, maxLockWaitMs: 12.4 },
      { total: 8, active: 5, idleInTransaction: 1, lockWaiters: 0, maxLockWaitMs: 3 },
    ])).toEqual({ total: 10, active: 5, idleInTransaction: 1, lockWaiters: 1, maxLockWaitMs: 12 });
  });

  it("inga samplingar → nollor", () => {
    expect(peakOf([])).toEqual({ total: 0, active: 0, idleInTransaction: 0, lockWaiters: 0, maxLockWaitMs: 0 });
  });
});

describe("docker stats", () => {
  it("toMiB förstår docker-enheterna", () => {
    expect(toMiB("512MiB")).toBe(512);
    expect(toMiB("1.5GiB")).toBe(1536);
    expect(toMiB("2048KiB")).toBe(2);
    expect(toMiB("1048576B")).toBe(1);
    expect(toMiB("1000kB")).toBeCloseTo(0.954, 2);
    expect(toMiB("1MB")).toBeCloseTo(0.954, 2);
    expect(toMiB("1GB")).toBeCloseTo(953.7, 1);
    expect(toMiB("12 parsecs")).toBeNaN();
    expect(toMiB("")).toBeNaN();
  });

  it("parseStatsLine läser namn, CPU och använt minne", () => {
    const line = JSON.stringify({ Name: "ava-load-server-1-1", CPUPerc: "12.50%", MemUsage: "110.2MiB / 2GiB", MemPerc: "5%" });
    expect(parseStatsLine(line)).toEqual({ name: "ava-load-server-1-1", cpuPct: 12.5, memMiB: 110.2 });
  });

  it("rader som inte går att tolka → null", () => {
    expect(parseStatsLine("")).toBeNull();
    expect(parseStatsLine("{\"Name\":1}")).toBeNull();
    expect(parseStatsLine(JSON.stringify({ Name: "x", CPUPerc: "--", MemUsage: "0B / 0B" }))).toBeNull();
  });

  it("summarizeContainers: snitt och topp per container", () => {
    expect(summarizeContainers([
      { name: "b", cpuPct: 10, memMiB: 100 },
      { name: "a", cpuPct: 50, memMiB: 300 },
      { name: "b", cpuPct: 30, memMiB: 120 },
    ])).toEqual({
      a: { samples: 1, cpuAvgPct: 50, cpuMaxPct: 50, memMaxMiB: 300 },
      b: { samples: 2, cpuAvgPct: 20, cpuMaxPct: 30, memMaxMiB: 120 },
    });
  });
});
