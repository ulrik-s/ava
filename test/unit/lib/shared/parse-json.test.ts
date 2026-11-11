/**
 * `parseJsonWith` / `safeParseJsonWith` (#1469) — den enda vägen från
 * JSON-text till typat värde: alltid via zod, aldrig `JSON.parse as T`.
 */

import { describe, expect, it } from "vitest-compat";
import { z } from "zod";
import { parseJsonWith, safeParseJsonWith } from "@/lib/shared/parse-json";

const schema = z.object({ n: z.number() });

describe("parseJsonWith", () => {
  it("parsar och validerar", () => {
    expect(parseJsonWith(schema, '{"n":1}')).toEqual({ n: 1 });
  });

  it("kastar på ogiltig JSON och på schema-miss", () => {
    expect(() => parseJsonWith(schema, "{")).toThrow();
    expect(() => parseJsonWith(schema, '{"n":"x"}')).toThrow(z.ZodError);
  });
});

describe("safeParseJsonWith", () => {
  it("lyckas med giltig JSON som matchar schemat", () => {
    const r = safeParseJsonWith(schema, '{"n":2}');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ n: 2 });
  });

  it("schema-miss blir ett zod-fel", () => {
    const r = safeParseJsonWith(schema, '{"n":"x"}');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["n"]);
  });

  it("ogiltig JSON blir ett zod-fel med parserns meddelande — inget kast", () => {
    const r = safeParseJsonWith(schema, "{nope");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toBeInstanceOf(z.ZodError);
      expect(r.error.issues[0]?.code).toBe("custom");
      expect(r.error.issues[0]?.message).toMatch(/JSON/);
    }
  });
});
