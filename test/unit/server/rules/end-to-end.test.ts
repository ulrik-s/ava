/**
 * End-to-end-test för regelmotorn.
 *
 * Verifierar att kedjan
 *   `emit()` → eventlog → matchEventTriggers() → executeRule() → effekt-event
 * fungerar utan att vi behöver Postgres eller en riktig Next-server.
 *
 * Bygger en minimal in-memory IDataStore som ersättning för PostgresEventLog.
 */

import { describe, it, expect, vi } from "vitest";
import { executeRule } from "@/server/rules/execute";
import { matchEventTriggers } from "@/server/rules/match";
import { buildNoopHandlers } from "@/server/rules/handlers";
import type { AvaRule } from "@/server/rules/schema";
import type { AvaEvent, EmitInput } from "@/server/events/schema";
import type { IDataStore, IEventLog } from "@/server/data-store/IDataStore";
import { uuidv7 } from "@/server/events/uuid7";

/** In-memory event-log med subscriber-stöd för test:erna. */
function makeInMemoryEventLog(): IEventLog & { events: AvaEvent[] } {
  const events: AvaEvent[] = [];
  const listeners = new Set<(e: AvaEvent) => void | Promise<void>>();
  return {
    events,
    async emit(input: EmitInput): Promise<AvaEvent> {
      const event: AvaEvent = { id: uuidv7(), ts: new Date().toISOString(), ...input };
      events.push(event);
      for (const l of listeners) await l(event);
      return event;
    },
    async query(filter) {
      return events
        .filter((e) => !filter.type || (Array.isArray(filter.type) ? filter.type.includes(e.type) : filter.type === e.type))
        .filter((e) => !filter.matterId || e.matterId === filter.matterId)
        .slice(0, filter.limit ?? 1000);
    },
    async *iterate(filter) {
      for (const e of await this.query(filter)) yield e;
    },
    onNewEvent(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  };
}

function makeDataStore(): { ds: IDataStore; events: () => AvaEvent[] } {
  const log = makeInMemoryEventLog();
  return {
    ds: { events: log } as unknown as IDataStore,
    events: () => log.events,
  };
}

describe("Regelmotor — end-to-end", () => {
  it("schemalagd kedja: emit av domänevent → matchande regel → effekt-event i loggen", async () => {
    const { ds, events } = makeDataStore();

    // Simulera att en tRPC-mutation har skickat event genom emit-helpern.
    await ds.events.emit({
      type: "matter.created",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      matterId: "matter-1",
      payload: { matterNumber: "2026-0001", title: "Vårdnadstvist" },
    });

    // Definiera en regel som matchar event-typen.
    const rule: AvaRule = {
      id: "_org/log-new-matters",
      name: "Logga skapade ärenden",
      ownerId: "_org",
      enabled: true,
      trigger: { kind: "event", type: "matter.created" },
      steps: [
        {
          do: "audit.log",
          message: "Ärende {{payload.matterNumber}} ({{payload.title}}) skapades av {{actor.id}}",
        },
      ],
    };

    // Hitta matchande triggers för det publicerade eventet.
    const triggeringEvent = events()[0];
    const matched = matchEventTriggers([rule], triggeringEvent);
    expect(matched).toHaveLength(1);

    // Kör regeln.
    const result = await executeRule({
      rule: matched[0],
      event: triggeringEvent,
      dataStore: ds,
      handlers: buildNoopHandlers(),
    });

    expect(result.ok).toBe(true);
    expect(result.stepsRan).toBe(1);

    // Loggen ska nu innehålla: 1) ursprungs-eventet, 2) audit-eventet, 3) rule.executed.
    const all = events();
    expect(all).toHaveLength(3);
    expect(all.map((e) => e.type)).toEqual([
      "matter.created",
      "user.action",
      "rule.executed",
    ]);

    // Audit-eventet ska ha causedBy = ursprungs-event-id.
    const audit = all[1];
    expect(audit.causedBy).toBe(triggeringEvent.id);
    expect(audit.actor).toEqual({ kind: "rule", id: "_org/log-new-matters" });
    expect((audit.payload as Record<string, unknown>).audit).toBe(
      "Ärende 2026-0001 (Vårdnadstvist) skapades av anna",
    );

    // rule.executed ska räkna 1 steg.
    const executed = all[2];
    expect((executed.payload as Record<string, unknown>).stepsRan).toBe(1);
  });

  it("predikat-skoppad regel kör BARA för matchande events", async () => {
    const { ds, events } = makeDataStore();
    const handlers = buildNoopHandlers();

    const rule: AvaRule = {
      id: "anna/own-matters",
      name: "Annas ärenden",
      ownerId: "anna",
      enabled: true,
      trigger: {
        kind: "event",
        type: "matter.created",
        predicate: { "==": [{ var: "payload.responsibleId" }, "anna"] },
      },
      steps: [{ do: "audit.log", message: "Annas: {{payload.title}}" }],
    };

    // Tre events: två tillhör Anna, ett tillhör Björn.
    for (const responsibleId of ["anna", "anna", "bjorn"]) {
      await ds.events.emit({
        type: "matter.created",
        source: "ui",
        actor: { kind: "user", id: responsibleId },
        payload: { responsibleId },
      });
    }

    const triggeringEvents = events().filter((e) => e.type === "matter.created");
    let executed = 0;
    for (const event of triggeringEvents) {
      const matched = matchEventTriggers([rule], event);
      for (const r of matched) {
        await executeRule({ rule: r, event, dataStore: ds, handlers });
        executed++;
      }
    }

    expect(executed).toBe(2); // bara Annas två
    const auditCount = events().filter((e) => e.type === "user.action").length;
    expect(auditCount).toBe(2);
  });

  it("regelfel kraschar inte kedjan — andra regler kör vidare", async () => {
    const { ds, events } = makeDataStore();
    const handlers = buildNoopHandlers();
    handlers.updateMatter = vi.fn(async () => { throw new Error("DB-fel"); }) as never;

    const triggering = await ds.events.emit({
      type: "matter.created",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      payload: {},
    });

    const failingRule: AvaRule = {
      id: "_org/fail",
      name: "Failure",
      ownerId: "_org",
      enabled: true,
      trigger: { kind: "event", type: "matter.created" },
      steps: [{ do: "matter.update", matterId: "m1", patch: { x: 1 } }],
    };
    const goodRule: AvaRule = {
      id: "_org/good",
      name: "Good",
      ownerId: "_org",
      enabled: true,
      trigger: { kind: "event", type: "matter.created" },
      steps: [{ do: "audit.log", message: "ok" }],
    };

    const r1 = await executeRule({ rule: failingRule, event: triggering, dataStore: ds, handlers });
    const r2 = await executeRule({ rule: goodRule, event: triggering, dataStore: ds, handlers });

    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(true);

    const types = events().map((e) => e.type);
    expect(types).toContain("rule.failed");
    expect(types).toContain("rule.executed");
    expect(types).toContain("user.action");
  });

  it("kedjereaktion: regel A emittar event, regel B reagerar på det", async () => {
    const { ds, events } = makeDataStore();
    const handlers = buildNoopHandlers();

    const ruleA: AvaRule = {
      id: "_org/on-matter-archive",
      name: "På arkivering",
      ownerId: "_org",
      enabled: true,
      trigger: { kind: "event", type: "matter.archived" },
      steps: [
        {
          do: "emit",
          eventType: "task.created",
          payload: { title: "Granska arkivering av {{event.matterId}}" },
        },
      ],
    };
    const ruleB: AvaRule = {
      id: "_org/on-task-create",
      name: "På task",
      ownerId: "_org",
      enabled: true,
      trigger: { kind: "event", type: "task.created" },
      steps: [{ do: "audit.log", message: "Task: {{payload.title}}" }],
    };

    // Kör manuellt — i prod skulle en orkester loop matcha + exekvera tills no-more-events.
    const initialEvent = await ds.events.emit({
      type: "matter.archived",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      matterId: "matter-1",
      payload: {},
    });

    // Steg 1: ruleA på initialEvent → emittar task.created
    await executeRule({ rule: ruleA, event: initialEvent, dataStore: ds, handlers });

    // Steg 2: hitta nya events och kör ruleB
    const taskEvents = events().filter((e) => e.type === "task.created");
    expect(taskEvents).toHaveLength(1);
    for (const e of taskEvents) {
      const matched = matchEventTriggers([ruleB], e);
      for (const r of matched) await executeRule({ rule: r, event: e, dataStore: ds, handlers });
    }

    // Audit-eventet ska finnas + dess causedBy ska peka på task.created-eventet
    const audits = events().filter((e) => (e.payload as { audit?: string })?.audit?.startsWith("Task:"));
    expect(audits).toHaveLength(1);
    expect(audits[0].causedBy).toBe(taskEvents[0].id);
  });
});
