/**
 * Tester för `JsonProjection`-basklassen.
 *
 * Bekräftar att den uppfyller `IProjection<T>`-kontraktet:
 *   - serialize → JSON-text
 *   - deserialize → typad entity efter Zod-validering
 *   - pathFor → måste implementeras i subklasser
 *   - serialize+deserialize är en round-trip
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { JsonProjection } from "@/lib/server/local-first/projections/base";

const sampleSchema = z.object({
  id: z.string(),
  name: z.string(),
  count: z.number().int(),
});
type Sample = z.infer<typeof sampleSchema>;

class SampleProjection extends JsonProjection<Sample> {
  constructor() { super(sampleSchema); }
  pathFor(input: Sample): string { return `samples/${input.id}.json`; }
}

describe("JsonProjection", () => {
  const proj = new SampleProjection();
  const entity: Sample = { id: "abc", name: "Anna", count: 3 };

  it("serialiserar till pretty JSON-text", () => {
    const text = proj.serialize(entity);
    expect(JSON.parse(text)).toEqual(entity);
    expect(text).toContain("\n"); // pretty-printed
  });

  it("deserialiserar och validerar via Zod", () => {
    const text = proj.serialize(entity);
    expect(proj.deserialize(text)).toEqual(entity);
  });

  it("kastar vid ogiltig JSON", () => {
    expect(() => proj.deserialize("inte json")).toThrow();
  });

  it("kastar vid schema-fel", () => {
    expect(() => proj.deserialize('{"id":"x","name":"y","count":"inte-nummer"}')).toThrow();
  });

  it("pathFor använder subklassens implementation", () => {
    expect(proj.pathFor(entity)).toBe("samples/abc.json");
  });

  it("round-trip: serialize → deserialize === original", () => {
    expect(proj.deserialize(proj.serialize(entity))).toEqual(entity);
  });
});
