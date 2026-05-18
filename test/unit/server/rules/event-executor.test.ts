/**
 * Tester för `attachEventRuleExecutor` — kopplingen mellan event-loggen
 * och regelmotorn.
 */

import { describe, it, expect, vi } from "vitest";
import { attachEventRuleExecutor } from "@/server/rules/event-executor";
import type { IDataStore } from "@/server/data-store/IDataStore";
import type { AvaEvent } from "@/server/events/schema";

const ORG = "org-1";

function makeMockPrismaWithRule(rule: unknown) {
  return {
    avaRule: { findMany: vi.fn().mockResolvedValue([{ id: "x", body: rule }]) },
    avaEventLog: { create: vi.fn() },
    document: { findFirst: vi.fn().mockResolvedValue(null) },
    matter: { update: vi.fn() },
  } as never;
}

function makeDataStoreWithEmitTrigger(): {
  ds: IDataStore;
  fireEvent: (e: AvaEvent) => Promise<void>;
} {
  let listener: ((e: AvaEvent) => void | Promise<void>) | null = null;
  const ds = {
    events: {
      emit: vi.fn(),
      query: vi.fn(),
      iterate: vi.fn(),
      onNewEvent: vi.fn((handler) => {
        listener = handler;
        return () => { listener = null; };
      }),
    },
  } as unknown as IDataStore;
  return {
    ds,
    fireEvent: async (e) => {
      if (listener) await listener(e);
    },
  };
}

const matterRule = {
  id: "_org/test-rule",
  name: "Test",
  ownerId: "_org",
  enabled: true,
  trigger: { kind: "event", type: "matter.created" },
  steps: [{ do: "audit.log", message: "skapades" }],
};

const matterEvent: AvaEvent = {
  id: "e1",
  ts: new Date().toISOString(),
  type: "matter.created",
  source: "ui",
  actor: { kind: "user", id: "anna" },
  payload: {},
};

describe("attachEventRuleExecutor", () => {
  it("kör matchande event-triggad regel när event emittas", async () => {
    const prisma = makeMockPrismaWithRule(matterRule);
    const { ds, fireEvent } = makeDataStoreWithEmitTrigger();
    attachEventRuleExecutor(prisma, ds, ORG);
    await fireEvent(matterEvent);
    // executeRule emittar audit (user.action) + rule.executed
    const calls = (ds.events.emit as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const types = calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toContain("user.action"); // audit.log
    expect(types).toContain("rule.executed");
  });

  it("ignorerar rule.executed-events (förhindrar oändlig loop)", async () => {
    const prisma = makeMockPrismaWithRule({
      ...matterRule,
      trigger: { kind: "event", type: "rule.executed" },
    });
    const { ds, fireEvent } = makeDataStoreWithEmitTrigger();
    attachEventRuleExecutor(prisma, ds, ORG);
    await fireEvent({ ...matterEvent, type: "rule.executed" });
    expect((ds.events.emit as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("disposer-funktionen avregistrerar listenern", async () => {
    const prisma = makeMockPrismaWithRule(matterRule);
    const { ds, fireEvent } = makeDataStoreWithEmitTrigger();
    const dispose = attachEventRuleExecutor(prisma, ds, ORG);
    dispose();
    await fireEvent(matterEvent);
    expect((ds.events.emit as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("regelladdningsfel kraschar inte listenern", async () => {
    const prisma = {
      avaRule: { findMany: vi.fn().mockRejectedValue(new Error("DB-fel")) },
    } as never;
    const { ds, fireEvent } = makeDataStoreWithEmitTrigger();
    attachEventRuleExecutor(prisma, ds, ORG);
    // Ska inte kasta
    await expect(fireEvent(matterEvent)).resolves.toBeUndefined();
  });
});
