import { describe, it, expect, vi } from "vitest";
import {
  expandTicks,
  idempotencyKey,
  runScheduledTick,
} from "@/server/rules/scheduler";
import { buildNoopHandlers } from "@/server/rules/handlers";
import type { AvaRule } from "@/server/rules/schema";
import type { IDataStore } from "@/server/data-store/IDataStore";

describe("expandTicks", () => {
  it("returnerar varje schemalagd tick i intervallet", () => {
    // Vardagar 09:00 Stockholm
    const from = new Date("2026-05-18T05:00:00Z"); // mån
    const to = new Date("2026-05-22T20:00:00Z");   // fre
    const ticks = expandTicks("0 9 * * 1-5", from, to);
    // mån, tis, ons, tor, fre — 5 ticks
    expect(ticks).toHaveLength(5);
  });

  it("returnerar tom lista när intervallet inte täcker någon tick", () => {
    const from = new Date("2026-05-18T10:00:00Z");
    const to = new Date("2026-05-18T11:00:00Z");
    expect(expandTicks("0 9 * * 1-5", from, to)).toEqual([]);
  });
});

describe("idempotencyKey", () => {
  it("formaterar som schedule:<ruleId>@<iso>", () => {
    const k = idempotencyKey("anna/x", new Date("2026-05-18T09:00:00Z"));
    expect(k).toBe("schedule:anna/x@2026-05-18T09:00:00.000Z");
  });
});

function makeDataStore(): {
  ds: IDataStore;
  emit: ReturnType<typeof vi.fn>;
  alreadyRan: ((k: string) => Promise<boolean>) & { mockResolvedValue: (v: boolean) => void };
} {
  const emit = vi.fn(async (input: unknown) => ({
    id: "evt-test", ts: new Date().toISOString(), ...input as object,
  }));
  const alreadyRan = vi.fn(async (_k: string) => false);
  const ds = {
    events: { emit, query: vi.fn().mockResolvedValue([]), iterate: vi.fn(), onNewEvent: vi.fn() },
  } as unknown as IDataStore;
  return { ds, emit, alreadyRan };
}

function scheduledRule(id: string, cron: string): AvaRule {
  return {
    id,
    name: id,
    ownerId: "_org",
    enabled: true,
    trigger: { kind: "schedule", cron, timezone: "UTC" },
    steps: [{ do: "audit.log", message: `tick ${id}` }],
  };
}

describe("runScheduledTick", () => {
  it("kör inte regler vars trigger inte är schedule", async () => {
    const { ds, alreadyRan } = makeDataStore();
    const rules: AvaRule[] = [
      {
        id: "event-rule", name: "x", ownerId: "_org", enabled: true,
        trigger: { kind: "event", type: "matter.created" },
        steps: [{ do: "audit.log", message: "x" }],
      },
    ];
    const result = await runScheduledTick({
      rules, dataStore: ds, handlers: buildNoopHandlers(), alreadyRan,
    });
    expect(result.rulesChecked).toBe(0);
  });

  it("kör en regel för varje missad tick sedan lookback", async () => {
    const { ds, alreadyRan } = makeDataStore();
    const handlers = buildNoopHandlers();
    const rule = scheduledRule("daily-9am", "0 9 * * *");
    const now = new Date("2026-05-18T11:00:00Z");

    const result = await runScheduledTick(
      { rules: [rule], dataStore: ds, handlers, alreadyRan, lookbackMs: 4 * 3600_000 },
      now,
    );
    // Tick 09:00 ligger inom lookback (4h tillbaka från 11:00)
    expect(result.ticksFound).toBe(1);
    expect(result.ticksExecuted).toBe(1);
  });

  it("skippar ticks som alreadyRan returnerar true för", async () => {
    const { ds, alreadyRan } = makeDataStore();
    alreadyRan.mockResolvedValue(true);
    const handlers = buildNoopHandlers();
    const rule = scheduledRule("daily-9am", "0 9 * * *");
    const now = new Date("2026-05-18T11:00:00Z");

    const result = await runScheduledTick(
      { rules: [rule], dataStore: ds, handlers, alreadyRan, lookbackMs: 4 * 3600_000 },
      now,
    );
    expect(result.ticksFound).toBe(1);
    expect(result.ticksSkipped).toBe(1);
    expect(result.ticksExecuted).toBe(0);
  });

  it("emittar system.heartbeat-event per körd tick", async () => {
    const { ds, alreadyRan, emit } = makeDataStore();
    const handlers = buildNoopHandlers();
    const rule = scheduledRule("daily-9am", "0 9 * * *");
    const now = new Date("2026-05-18T11:00:00Z");

    await runScheduledTick(
      { rules: [rule], dataStore: ds, handlers, alreadyRan, lookbackMs: 4 * 3600_000 },
      now,
    );
    const heartbeats = emit.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === "system.heartbeat",
    );
    expect(heartbeats).toHaveLength(1);
    const payload = (heartbeats[0][0] as { payload: Record<string, unknown> }).payload;
    expect(payload.ruleId).toBe("daily-9am");
    expect(payload.idempotencyKey).toMatch(/^schedule:daily-9am@/);
  });
});
