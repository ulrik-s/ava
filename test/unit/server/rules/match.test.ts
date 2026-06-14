import { describe, it, expect } from "vitest-compat";
import type { AvaEvent } from "@/lib/server/events/schema";
import { matchEventTriggers, matchHttpTrigger } from "@/lib/server/rules/match";
import type { AvaRule } from "@/lib/server/rules/schema";

const baseEvent: AvaEvent = {
  id: "e1",
  ts: "2026-05-18T10:00:00Z",
  type: "matter.created",
  source: "ui",
  actor: { kind: "user", id: "anna" },
  payload: { responsibleId: "anna" },
};

function rule(partial: Partial<AvaRule>): AvaRule {
  return {
    id: "r1",
    name: "r1",
    ownerId: "_org",
    enabled: true,
    trigger: { kind: "event", type: "matter.created" },
    steps: [{ do: "audit.log", message: "x" }],
    ...partial,
  };
}

describe("matchEventTriggers", () => {
  it("matchar bara regler vars trigger-typ är samma som eventet", () => {
    const rules = [
      rule({ id: "a", trigger: { kind: "event", type: "matter.created" } }),
      rule({ id: "b", trigger: { kind: "event", type: "matter.updated" } }),
      rule({ id: "c", trigger: { kind: "schedule", cron: "* * * * *", timezone: "Europe/Stockholm" } }),
    ];
    const matched = matchEventTriggers(rules, baseEvent);
    expect(matched.map((r) => r.id)).toEqual(["a"]);
  });

  it("respekterar predikat — matchar bara om jsonlogic säger true", () => {
    const rules = [
      rule({
        id: "anna-only",
        trigger: {
          kind: "event",
          type: "matter.created",
          predicate: { "==": [{ var: "payload.responsibleId" }, "anna"] },
        },
      }),
      rule({
        id: "bjorn-only",
        trigger: {
          kind: "event",
          type: "matter.created",
          predicate: { "==": [{ var: "payload.responsibleId" }, "bjorn"] },
        },
      }),
    ];
    const matched = matchEventTriggers(rules, baseEvent);
    expect(matched.map((r) => r.id)).toEqual(["anna-only"]);
  });

  it("trasigt predikat = ingen match (säkrare än att krascha)", () => {
    const rules = [
      rule({
        id: "broken",
        trigger: {
          kind: "event",
          type: "matter.created",
          predicate: { "weird-op": [1, 2] } as never,
        },
      }),
    ];
    expect(matchEventTriggers(rules, baseEvent)).toHaveLength(0);
  });
});

describe("matchHttpTrigger", () => {
  it("hittar regel med matchande method + path", () => {
    const rules = [
      rule({ id: "a", trigger: { kind: "http", method: "POST", path: "fortnox/cb", auth: "none" } }),
      rule({ id: "b", trigger: { kind: "http", method: "GET", path: "ping", auth: "user" } }),
    ];
    expect(matchHttpTrigger(rules, "POST", "fortnox/cb")?.id).toBe("a");
    expect(matchHttpTrigger(rules, "GET", "ping")?.id).toBe("b");
    expect(matchHttpTrigger(rules, "POST", "no-such")).toBeNull();
  });

  it("matchar inte HTTP-regler mot fel method", () => {
    const rules = [
      rule({ id: "a", trigger: { kind: "http", method: "POST", path: "x", auth: "none" } }),
    ];
    expect(matchHttpTrigger(rules, "GET", "x")).toBeNull();
  });
});
