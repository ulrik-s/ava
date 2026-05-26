/**
 * Validera att alla startregler är välformade enligt avaRuleSchema.
 * Detta är ett "is the seed valid"-test — om vi börjar lägga till nya
 * startregler vill vi att build:en kraschar innan vi push:ar till git.
 */

import { describe, it, expect } from "vitest";
import { avaRuleSchema } from "@/lib/server/rules/schema";
import { STARTER_RULES } from "@/lib/server/rules/starter-rules";

describe("STARTER_RULES", () => {
  it("har minst 8 regler", () => {
    expect(STARTER_RULES.length).toBeGreaterThanOrEqual(8);
  });

  it("alla regler validerar mot avaRuleSchema", () => {
    for (const rule of STARTER_RULES) {
      expect(() => avaRuleSchema.parse(rule), `Rule ${rule.id} kraschade Zod`).not.toThrow();
    }
  });

  it("inga duplicerade rule-id:n", () => {
    const ids = STARTER_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("alla är disabled per default (säkerhetsval)", () => {
    for (const rule of STARTER_RULES) {
      expect(rule.enabled, `Rule ${rule.id} har enabled=true — borde vara false i seed`).toBe(false);
    }
  });

  it("triggers täcker alla 3 typer (event/schedule/http)", () => {
    const kinds = new Set(STARTER_RULES.map((r) => r.trigger.kind));
    expect(kinds.has("event")).toBe(true);
    expect(kinds.has("schedule")).toBe(true);
    expect(kinds.has("http")).toBe(true);
  });

  it("alla `_org`-regler är byrå-gemensamma, namngivna med _org/-prefix", () => {
    for (const rule of STARTER_RULES) {
      if (rule.ownerId === "_org") {
        expect(rule.id.startsWith("_org/")).toBe(true);
      }
    }
  });
});
