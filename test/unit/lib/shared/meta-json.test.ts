/**
 * Test för zod-validerad meta.json-läsning (#187, ADR 0004-tolerans).
 */

import { describe, it, expect } from "vitest-compat";

import { metaJsonSchema, schemaVersionFromMetaJson } from "@/lib/shared/meta-json";

describe("schemaVersionFromMetaJson (#187)", () => {
  it("läser giltig version", () => {
    expect(schemaVersionFromMetaJson('{"schemaVersion": 2}')).toBe(2);
  });

  it("saknad nyckel → undefined (v1-baslinje)", () => {
    expect(schemaVersionFromMetaJson("{}")).toBeUndefined();
    expect(schemaVersionFromMetaJson('{"other": true}')).toBeUndefined();
  });

  it("fel typ (sträng/decimal/negativ) → undefined, inte krasch", () => {
    expect(schemaVersionFromMetaJson('{"schemaVersion": "2"}')).toBeUndefined();
    expect(schemaVersionFromMetaJson('{"schemaVersion": 1.5}')).toBeUndefined();
    expect(schemaVersionFromMetaJson('{"schemaVersion": -1}')).toBeUndefined();
  });

  it("trasig JSON kastar (anroparen tolkar som baslinje i sin try/catch)", () => {
    expect(() => schemaVersionFromMetaJson("not json")).toThrow();
  });

  it("passthrough: okända fält bevaras i schemat", () => {
    const parsed = metaJsonSchema.parse({ schemaVersion: 2, demoVersion: "x" });
    expect((parsed as Record<string, unknown>).demoVersion).toBe("x");
  });
});
