/**
 * Tester för regel-executorn — kör en regel mot ett event och verifierar
 * att rätt step-handlers anropades med templated värden.
 */

import { describe, it, expect, vi } from "vitest";
import { executeRule } from "@/server/rules/execute";
import { buildNoopHandlers } from "@/server/rules/handlers";
import type { AvaRule } from "@/server/rules/schema";
import type { AvaEvent } from "@/server/events/schema";
import type { IDataStore } from "@/server/data-store/IDataStore";

function makeMockDataStore() {
  const emit = vi.fn(async (input: Record<string, unknown>) => ({
    id: "evt-test",
    ts: new Date().toISOString(),
    ...input,
  }));
  const ds = {
    events: {
      emit,
      query: vi.fn(),
      iterate: vi.fn(),
      onNewEvent: vi.fn(() => () => {}),
    },
  } as unknown as IDataStore;
  return { ds, emit };
}

const baseEvent: AvaEvent = {
  id: "evt-1",
  ts: "2026-05-18T10:00:00Z",
  type: "matter.created",
  source: "ui",
  actor: { kind: "user", id: "anna" },
  matterId: "m1",
  payload: { matterNumber: "2026-0001", title: "Vårdnadstvist" },
};

function makeRule(steps: AvaRule["steps"]): AvaRule {
  return {
    id: "test/rule",
    name: "Test",
    ownerId: "anna",
    enabled: true,
    trigger: { kind: "event", type: "matter.created" },
    steps,
  };
}

describe("executeRule.audit.log", () => {
  it("templatear meddelande och emittar user.action-event", async () => {
    const { ds, emit } = makeMockDataStore();
    const rule = makeRule([
      { do: "audit.log", message: "Ärende {{event.payload.matterNumber}} skapades" },
    ]);
    const result = await executeRule({ rule, event: baseEvent, dataStore: ds, handlers: buildNoopHandlers() });
    expect(result.ok).toBe(true);
    expect(result.stepsRan).toBe(1);
    // audit.log emit + rule.executed emit = 2
    expect(emit).toHaveBeenCalledTimes(2);
    const auditCall = emit.mock.calls[0][0] as Record<string, unknown>;
    expect(auditCall.type).toBe("user.action");
    expect((auditCall.payload as Record<string, unknown>).audit).toBe("Ärende 2026-0001 skapades");
  });
});

describe("executeRule.if", () => {
  it("kör then-grenen när cond är true", async () => {
    const { ds } = makeMockDataStore();
    const handlers = buildNoopHandlers();
    const rule = makeRule([
      {
        do: "if",
        cond: { "==": [{ var: "event.payload.matterNumber" }, "2026-0001"] },
        then: [{ do: "matter.update", matterId: "m1", patch: { status: "active" } }],
        else: [{ do: "matter.update", matterId: "m1", patch: { status: "closed" } }],
      },
    ]);
    await executeRule({ rule, event: baseEvent, dataStore: ds, handlers });
    expect(handlers.calls).toHaveLength(1);
    expect((handlers.calls[0].args as { patch: Record<string, unknown> }).patch.status).toBe("active");
  });

  it("kör else-grenen när cond är false", async () => {
    const { ds } = makeMockDataStore();
    const handlers = buildNoopHandlers();
    const rule = makeRule([
      {
        do: "if",
        cond: { "==": [{ var: "event.payload.matterNumber" }, "annat" ] },
        then: [{ do: "audit.log", message: "skulle inte hända" }],
        else: [{ do: "audit.log", message: "else-grenen" }],
      },
    ]);
    const { emit } = makeMockDataStore();
    Object.assign(ds.events, { emit });
    await executeRule({ rule, event: baseEvent, dataStore: ds, handlers });
    const calls = emit.mock.calls;
    const audit = calls.find((c) => (c[0].payload as { audit?: string })?.audit === "else-grenen");
    expect(audit).toBeTruthy();
  });
});

describe("executeRule.for-each", () => {
  it("itererar genom items och templatear loop-binding", async () => {
    const { ds } = makeMockDataStore();
    const handlers = buildNoopHandlers();
    const event: AvaEvent = {
      ...baseEvent,
      payload: { invoices: [{ id: "i1", amount: 5000 }, { id: "i2", amount: 7000 }] },
    };
    const rule = makeRule([
      {
        do: "for-each",
        items: "event.payload.invoices",
        as: "inv",
        body: [{ do: "email.send", template: "reminder", to: "{{inv.id}}@x" }],
      },
    ]);
    await executeRule({ rule, event, dataStore: ds, handlers });
    const emails = handlers.calls.filter((c) => c.name === "sendEmail");
    expect(emails).toHaveLength(2);
    expect((emails[0].args as { to: string }).to).toBe("i1@x");
    expect((emails[1].args as { to: string }).to).toBe("i2@x");
  });
});

describe("executeRule.http.respond", () => {
  it("returnerar httpResponse och avbryter senare steg", async () => {
    const { ds } = makeMockDataStore();
    const handlers = buildNoopHandlers();
    const rule = makeRule([
      { do: "http.respond", status: 200, body: { ok: true } },
      { do: "audit.log", message: "ska inte köras" },
    ]);
    const result = await executeRule({ rule, event: baseEvent, dataStore: ds, handlers });
    expect(result.httpResponse).toEqual({ status: 200, body: { ok: true } });
  });
});

describe("executeRule.email.send", () => {
  it("kallar handler med templatade värden + emittar mail.sent", async () => {
    const { ds, emit } = makeMockDataStore();
    const handlers = buildNoopHandlers();
    const rule = makeRule([
      {
        do: "email.send",
        template: "payment-reminder",
        to: "{{event.payload.email}}",
        vars: { name: "{{event.payload.name}}" },
        idempotencyKey: "reminder-{{event.payload.matterNumber}}",
      },
    ]);
    const event: AvaEvent = { ...baseEvent, payload: { ...baseEvent.payload, email: "k@x.se", name: "Klient" } };
    await executeRule({ rule, event, dataStore: ds, handlers });

    expect(handlers.calls[0].args).toMatchObject({
      template: "payment-reminder",
      to: "k@x.se",
      vars: { name: "Klient" },
      idempotencyKey: "reminder-2026-0001",
    });
    // 1 mail.sent + 1 rule.executed
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0][0].type).toBe("mail.sent");
  });
});

describe("executeRule felhantering", () => {
  it("emittar rule.failed när ett step kastar", async () => {
    const { ds, emit } = makeMockDataStore();
    const handlers = buildNoopHandlers();
    handlers.updateMatter = vi.fn(async () => { throw new Error("DB-fel"); }) as never;
    const rule = makeRule([
      { do: "matter.update", matterId: "m1", patch: { x: 1 } },
    ]);
    const result = await executeRule({ rule, event: baseEvent, dataStore: ds, handlers });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("DB-fel");
    const failEvent = emit.mock.calls.find((c) => c[0].type === "rule.failed");
    expect(failEvent).toBeTruthy();
  });
});
