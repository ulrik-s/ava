import { describe, it, expect } from "vitest-compat";
import { MatterProjection } from "@/lib/server/local-first/projections/matter";

const baseMatter = {
  id: "matter-abc",
  matterNumber: "2026-0001",
  title: "Vårdnadstvist",
  status: "ACTIVE" as const,
  organizationId: "org-1",
  archivedAt: null as string | null,
};

describe("MatterProjection", () => {
  const proj = new MatterProjection();

  it("aktiva ärenden hamnar under matters/active/", () => {
    expect(proj.pathFor(baseMatter)).toBe("matters/active/matter-abc.json");
  });

  it("stängda ärenden hamnar fortfarande under active/ (kvar i aktiv vy)", () => {
    expect(proj.pathFor({ ...baseMatter, status: "CLOSED" })).toBe("matters/active/matter-abc.json");
  });

  it("arkiverade ärenden flyttas till matters/archive/<år>/", () => {
    const archived = {
      ...baseMatter,
      status: "ARCHIVED" as const,
      archivedAt: "2024-03-15T10:00:00.000Z",
    };
    expect(proj.pathFor(archived)).toBe("matters/archive/2024/matter-abc.json");
  });

  it("arkiverade utan archivedAt faller tillbaka till år 'unknown'", () => {
    const archived = { ...baseMatter, status: "ARCHIVED" as const, archivedAt: null };
    expect(proj.pathFor(archived)).toBe("matters/archive/unknown/matter-abc.json");
  });

  it("round-trip serialize/deserialize bevarar alla fält", () => {
    expect(proj.deserialize(proj.serialize(baseMatter))).toEqual(baseMatter);
  });

  it("avvisar dokument utan id eller matterNumber", () => {
    expect(() => proj.deserialize('{"title":"x"}')).toThrow();
  });
});
