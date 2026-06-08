/**
 * Tester för ProjectionRegistry.
 *
 * Registret är central abstraktion för write-through-projektion och
 * hydrate-on-pull: ena hållet mappar entitet → fil, andra hållet mappar
 * fil → entitet.
 */

import { describe, it, expect, beforeEach } from "vitest-compat";
import { ProjectionRegistry } from "@/lib/server/local-first/projections/registry";
import { MatterProjection, type MatterProjectionData } from "@/lib/server/local-first/projections/matter";

describe("ProjectionRegistry — entity lookups", () => {
  let registry: ProjectionRegistry;
  beforeEach(() => {
    registry = new ProjectionRegistry();
    registry.register({
      entity: "matter",
      projection: new MatterProjection(),
      ownsPath: (p) => p.startsWith("matters/"),
    });
  });

  it("forEntity hittar registrerad projektion", () => {
    expect(registry.forEntity("matter")).toBeDefined();
  });

  it("forEntity returnerar null för okänd entitet", () => {
    expect(registry.forEntity("unknown")).toBeNull();
  });

  it("entries() listar alla registrerade entiteter", () => {
    expect(registry.entities()).toEqual(["matter"]);
  });
});

describe("ProjectionRegistry — path-baserad lookup", () => {
  let registry: ProjectionRegistry;
  beforeEach(() => {
    registry = new ProjectionRegistry();
    registry.register({
      entity: "matter",
      projection: new MatterProjection(),
      ownsPath: (p) => p.startsWith("matters/"),
    });
  });

  it("matchPath hittar projektion via ownsPath-callback", () => {
    const m = registry.matchPath("matters/active/abc.json");
    expect(m).not.toBeNull();
    expect(m?.entity).toBe("matter");
  });

  it("matchPath hanterar arkiv-pathen också", () => {
    expect(registry.matchPath("matters/archive/2025/x.json")?.entity).toBe("matter");
  });

  it("matchPath returnerar null för okänd path", () => {
    expect(registry.matchPath("events/2026/05/18.jsonl")).toBeNull();
  });

  it("registry kan inte ha två projektioner med samma entity-namn", () => {
    expect(() => {
      registry.register({
        entity: "matter",
        projection: new MatterProjection(),
        ownsPath: () => true,
      });
    }).toThrow(/already registered|duplicate/i);
  });
});

describe("ProjectionRegistry — round-trip via projektionen", () => {
  it("projektionen som registret returnerar kan serialize + deserialize", () => {
    const registry = new ProjectionRegistry();
    registry.register({
      entity: "matter",
      projection: new MatterProjection(),
      ownsPath: (p) => p.startsWith("matters/"),
    });
    const found = registry.forEntity<MatterProjectionData>("matter");
    expect(found).not.toBeNull();

    const entity: MatterProjectionData = {
      id: "m1",
      matterNumber: "2026-0001",
      title: "T",
      status: "ACTIVE",
      organizationId: "org-1",
    };
    const text = found!.projection.serialize(entity);
    expect(found!.projection.deserialize(text)).toEqual(entity);
  });
});
