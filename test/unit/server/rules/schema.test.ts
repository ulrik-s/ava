import { describe, it, expect } from "vitest-compat";
import { avaRuleSchema } from "@/lib/server/rules/schema";

describe("avaRuleSchema", () => {
  const baseRule = {
    id: "anna/payment-reminder",
    name: "Daglig påminnelse",
    ownerId: "anna",
    enabled: true,
    trigger: { kind: "event" as const, type: "invoice.overdue" as const },
    steps: [{ do: "audit.log" as const, message: "test" }],
  };

  it("accepterar en minimal event-triggad regel", () => {
    expect(() => avaRuleSchema.parse(baseRule)).not.toThrow();
  });

  it("accepterar schedule-trigger med cron", () => {
    expect(() =>
      avaRuleSchema.parse({
        ...baseRule,
        trigger: { kind: "schedule", cron: "0 9 * * 1-5" },
      }),
    ).not.toThrow();
  });

  it("accepterar http-trigger med alla auth-lägen", () => {
    for (const auth of ["user", "shared-secret", "none"] as const) {
      expect(() =>
        avaRuleSchema.parse({
          ...baseRule,
          trigger: { kind: "http", method: "POST", path: "fortnox/cb", auth },
        }),
      ).not.toThrow();
    }
  });

  it("avvisar http-path med ledande slash", () => {
    expect(() =>
      avaRuleSchema.parse({
        ...baseRule,
        trigger: { kind: "http", method: "POST", path: "/fortnox/cb", auth: "none" },
      }),
    ).toThrow();
  });

  it("kräver minst ett steg", () => {
    expect(() => avaRuleSchema.parse({ ...baseRule, steps: [] })).toThrow();
  });

  it("accepterar nestade if/for-each-steg", () => {
    expect(() =>
      avaRuleSchema.parse({
        ...baseRule,
        steps: [
          {
            do: "for-each",
            items: "payload.invoices",
            as: "inv",
            body: [
              {
                do: "if",
                cond: { ">=": [{ var: "inv.daysOverdue" }, 14] },
                then: [{ do: "audit.log", message: "påminnelse {{inv.id}}" }],
              },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("känner igen alla 9 step-typer", () => {
    const steps = [
      { do: "emit", eventType: "x", payload: {} },
      { do: "email.send", template: "x", to: "a@b" },
      { do: "matter.update", matterId: "m", patch: {} },
      { do: "audit.log", message: "x" },
      { do: "http.respond", status: 200 },
      { do: "llm.extract", documentId: "d", schema: {}, into: "x" },
      { do: "task.create", assignTo: "a", title: "t" },
      { do: "if", cond: true, then: [{ do: "audit.log", message: "x" }] },
      { do: "for-each", items: "x", as: "i", body: [{ do: "audit.log", message: "x" }] },
    ];
    for (const step of steps) {
      expect(() => avaRuleSchema.parse({ ...baseRule, steps: [step] })).not.toThrow();
    }
  });
});
