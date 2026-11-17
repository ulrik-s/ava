/**
 * Byråns markering av offentligt uppdrag (#1638) i org-schemat: saknat och
 * `null` betyder "aldrig satt" (inga typer markerade) och skiljs från `[]`.
 */
import { describe, expect, it } from "bun:test";
import { organizationSchema } from "@/lib/shared/schemas/organization";

const BASE = { id: "00000000-0000-7000-8000-000000000001", name: "Byrå AB", createdAt: "2026-11-17T00:00:00Z", updatedAt: "2026-11-17T00:00:00Z" };

describe("organizationSchema.publicAssignmentMatterTypes", () => {
  it("en byrå utan fältet parsas utan markerade typer", () => {
    expect(organizationSchema.parse(BASE).publicAssignmentMatterTypes).toBeUndefined();
  });

  it("null bevaras (aldrig satt)", () => {
    expect(organizationSchema.parse({ ...BASE, publicAssignmentMatterTypes: null }).publicAssignmentMatterTypes).toBeNull();
  });

  it("en lista bevaras, även tom", () => {
    expect(organizationSchema.parse({ ...BASE, publicAssignmentMatterTypes: ["Offentlig försvarare"] }).publicAssignmentMatterTypes)
      .toEqual(["Offentlig försvarare"]);
    expect(organizationSchema.parse({ ...BASE, publicAssignmentMatterTypes: [] }).publicAssignmentMatterTypes).toEqual([]);
  });

  it("avvisar annat än en lista med namn", () => {
    expect(() => organizationSchema.parse({ ...BASE, publicAssignmentMatterTypes: [1] })).toThrow();
  });
});
