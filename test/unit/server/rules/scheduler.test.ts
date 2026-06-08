/**
 * Schemaläggaren: expandTicks (cron→ticks), idempotencyKey, runScheduledTick
 * (filtrera schedule-regler, hoppa redan körda ticks, exekvera resten) och
 * alreadyRanFromEventLog (slå upp idempotency-key i event-loggen).
 */

import { describe, it, expect, vi } from "vitest-compat";
import {
  expandTicks,
  idempotencyKey,
  runScheduledTick,
  alreadyRanFromEventLog,
  type SchedulerDeps,
} from "@/lib/server/rules/scheduler";
import type { StepHandlers } from "@/lib/server/rules/execute";
import type { AvaRule } from "@/lib/server/rules/schema";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";

function makeHandlers(): StepHandlers {
  return { sendEmail: vi.fn(async () => true), updateMatter: vi.fn(async () => {}), extractFromDocument: vi.fn(async () => {}), createTask: vi.fn(async () => {}) };
}

function scheduleRule(id: string, cron: string): AvaRule {
  return {
    id, name: `Regel ${id}`, ownerId: "u1",
    trigger: { kind: "schedule", cron, timezone: "UTC" },
    steps: [{ do: "audit.log", message: "schemalagd tick" }],
  } as unknown as AvaRule;
}

describe("idempotencyKey", () => {
  it("bygger schedule:<id>@<iso>", () => {
    const tick = new Date("2026-03-02T09:00:00.000Z");
    expect(idempotencyKey("r1", tick)).toBe("schedule:r1@2026-03-02T09:00:00.000Z");
  });
});

describe("expandTicks", () => {
  it("ger en tick per dag för ett dagligt cron-uttryck", () => {
    const from = new Date("2026-03-01T00:00:00Z");
    const to = new Date("2026-03-03T12:00:00Z");
    const ticks = expandTicks("0 9 * * *", from, to, "UTC");
    expect(ticks.map((t) => t.toISOString())).toEqual([
      "2026-03-01T09:00:00.000Z",
      "2026-03-02T09:00:00.000Z",
      "2026-03-03T09:00:00.000Z",
    ]);
  });

  it("ger inga ticks när fönstret är tomt", () => {
    const from = new Date("2026-03-01T10:00:00Z");
    const to = new Date("2026-03-01T11:00:00Z");
    expect(expandTicks("0 9 * * *", from, to, "UTC")).toEqual([]);
  });
});

function makeDeps(over: Partial<SchedulerDeps> = {}): { deps: SchedulerDeps; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn(async (i: unknown) => ({ id: "e", ...(i as object) }));
  const dataStore = { events: { emit, query: vi.fn(async () => []) } } as unknown as IDataStore;
  const deps: SchedulerDeps = {
    rules: [],
    dataStore,
    handlers: makeHandlers(),
    alreadyRan: vi.fn(async () => false),
    lookbackMs: 26 * 3600_000,
    ...over,
  };
  return { deps, emit };
}

describe("runScheduledTick", () => {
  const now = new Date("2026-03-03T10:00:00Z"); // lookback 26h → från 03-02 08:00

  it("exekverar alla ofkörda ticks för schemalagda regler", async () => {
    const { deps, emit } = makeDeps({ rules: [scheduleRule("r1", "0 9 * * *")] });
    const res = await runScheduledTick(deps, now);
    expect(res.rulesChecked).toBe(1);
    expect(res.ticksFound).toBe(2); // 03-02 09:00 + 03-03 09:00
    expect(res.ticksExecuted).toBe(2);
    expect(res.ticksSkipped).toBe(0);
    // Heartbeat per tick + rule.executed per tick.
    expect(emit.mock.calls.some((c: unknown[]) => (c[0] as { type: string }).type === "system.heartbeat")).toBe(true);
    expect(emit.mock.calls.some((c: unknown[]) => (c[0] as { type: string }).type === "rule.executed")).toBe(true);
  });

  it("hoppar ticks som redan körts (alreadyRan → true)", async () => {
    const alreadyRan = vi.fn(async () => true);
    const { deps, emit } = makeDeps({ rules: [scheduleRule("r1", "0 9 * * *")], alreadyRan });
    const res = await runScheduledTick(deps, now);
    expect(res.ticksFound).toBe(2);
    expect(res.ticksExecuted).toBe(0);
    expect(res.ticksSkipped).toBe(2);
    expect(emit).not.toHaveBeenCalled(); // varken heartbeat eller exekvering
  });

  it("ignorerar regler som inte är schemalagda", async () => {
    const eventRule = { id: "r2", name: "E", ownerId: "u1", trigger: { kind: "event", type: "matter.created" }, steps: [{ do: "audit.log", message: "x" }] } as unknown as AvaRule;
    const { deps } = makeDeps({ rules: [eventRule] });
    const res = await runScheduledTick(deps, now);
    expect(res.rulesChecked).toBe(0);
    expect(res.ticksFound).toBe(0);
  });
});

describe("alreadyRanFromEventLog", () => {
  it("returnerar true när en heartbeat med matchande idempotencyKey finns", async () => {
    const query = vi.fn(async () => [{ payload: { idempotencyKey: "schedule:r1@2026-03-02T09:00:00.000Z" } }]);
    const dataStore = { events: { query } } as unknown as IDataStore;
    const fn = alreadyRanFromEventLog(dataStore);
    expect(await fn("schedule:r1@2026-03-02T09:00:00.000Z")).toBe(true);
    expect(await fn("schedule:r1@2026-03-09T09:00:00.000Z")).toBe(false);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ type: "system.heartbeat" }));
  });
});
