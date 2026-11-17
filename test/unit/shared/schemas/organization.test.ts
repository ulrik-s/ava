/**
 * `organizationSchema` — offentligt uppdrag per ärendetyp (#1638). Fältet
 * skiljer på "aldrig satt" (saknas/`null`) och "satt till tom lista".
 */

import { describe, it, expect } from "vitest-compat";
import { organizationSchema } from "@/lib/shared/schemas/organization";

const BASE = { id: "org-1", name: "Byrå AB", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };

describe("organizationSchema — publicAssignmentMatterTypes", () => {
  it("en byrå utan fältet har inga typer markerade (aldrig satt)", () => {
    const org = organizationSchema.parse(BASE);
    expect(org.publicAssignmentMatterTypes).toBeUndefined();
  });

  it("null bevaras som aldrig satt", () => {
    expect(organizationSchema.parse({ ...BASE, publicAssignmentMatterTypes: null }).publicAssignmentMatterTypes).toBeNull();
  });

  it("en tom lista och en lista med typer bevaras", () => {
    expect(organizationSchema.parse({ ...BASE, publicAssignmentMatterTypes: [] }).publicAssignmentMatterTypes).toEqual([]);
    expect(organizationSchema.parse({ ...BASE, publicAssignmentMatterTypes: ["Offentlig försvarare"] }).publicAssignmentMatterTypes)
      .toEqual(["Offentlig försvarare"]);
  });

  it("avvisar annat än en lista med namn", () => {
    expect(organizationSchema.safeParse({ ...BASE, publicAssignmentMatterTypes: [1] }).success).toBe(false);
  });
});
