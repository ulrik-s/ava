/**
 * Integration-test för det fullständiga write-through + hydrate-flödet.
 *
 *   1. Router skriver en entitet (simulerat)
 *   2. ProjectionWriter projicerar till fs
 *   3. ProjectionHydrator läser tillbaka från samma fs
 *   4. Resultatet är identiskt med ursprunget
 *
 * Detta är "rygg-mot-rygg-testet" som bevisar att projektionen är en
 * korrekt invers. Om det här passar är vi i mål för Fas 3:s
 * projektion-paradigm.
 */

import { describe, it, expect } from "vitest";
import { ProjectionWriter, ProjectionHydrator } from "@/lib/server/local-first/projection-writer";
import { buildDefaultRegistry } from "@/lib/server/local-first/projections/default-registry";
import { InMemoryFileSystem } from "@/lib/server/local-first/in-memory-fs";
import type { MatterProjectionData } from "@/lib/server/local-first/projections/matter";
import type { ContactProjectionData } from "@/lib/server/local-first/projections/contact";

describe("Projection round-trip — write → hydrate", () => {
  const matter: MatterProjectionData = {
    id: "matter-1",
    matterNumber: "2026-0001",
    title: "Vårdnadstvist",
    status: "ACTIVE",
    organizationId: "org-1",
  };

  const contact: ContactProjectionData = {
    id: "contact-1",
    name: "Anna Klient",
    contactType: "PERSON",
    personalNumber: "19800101-1234",
    email: "anna@x.se",
    organizationId: "org-1",
  };

  it("matter: write → hydratePath returnerar identisk data", async () => {
    const fs = new InMemoryFileSystem();
    const registry = buildDefaultRegistry();
    const writer = new ProjectionWriter(fs, registry);
    const hydrator = new ProjectionHydrator(fs, registry);

    const path = await writer.project("matter", matter);
    const result = await hydrator.hydratePath(path);

    expect(result).not.toBeNull();
    expect(result!.entity).toBe("matter");
    expect(result!.data).toEqual(matter);
  });

  it("contact: write → hydratePath returnerar identisk data", async () => {
    const fs = new InMemoryFileSystem();
    const registry = buildDefaultRegistry();
    const writer = new ProjectionWriter(fs, registry);
    const hydrator = new ProjectionHydrator(fs, registry);

    const path = await writer.project("contact", contact);
    expect(path).toBe("contacts/contact-1.json");
    const result = await hydrator.hydratePath(path);
    expect(result?.data).toEqual(contact);
  });

  it("blandade entiteter: hydrateAll callback:ar för alla", async () => {
    const fs = new InMemoryFileSystem();
    const registry = buildDefaultRegistry();
    const writer = new ProjectionWriter(fs, registry);
    const hydrator = new ProjectionHydrator(fs, registry);

    await writer.project("matter", matter);
    await writer.project("matter", { ...matter, id: "m2", matterNumber: "2026-0002" });
    await writer.project("contact", contact);

    const seen: Array<{ entity: string; id: string }> = [];
    const count = await hydrator.hydrateAll((entity, data) => {
      seen.push({ entity, id: (data as { id: string }).id });
    });

    expect(count).toBe(3);
    expect(seen.filter((s) => s.entity === "matter")).toHaveLength(2);
    expect(seen.filter((s) => s.entity === "contact")).toHaveLength(1);
  });

  it("simulerar git pull: hydrateChanges hämtar bara ändrade filer", async () => {
    const fs = new InMemoryFileSystem();
    const registry = buildDefaultRegistry();
    const writer = new ProjectionWriter(fs, registry);
    const hydrator = new ProjectionHydrator(fs, registry);

    await writer.project("matter", matter);
    await writer.project("matter", { ...matter, id: "m2", matterNumber: "2026-0002" });

    // Vid simulerad git pull antar vi att bara m1 ändrats
    const seen: string[] = [];
    await hydrator.hydrateChanges(["matters/active/matter-1.json"], (_, data) => {
      seen.push((data as { id: string }).id);
    });
    expect(seen).toEqual(["matter-1"]);
  });

  it("arkivering: status-byte tar matter till archive/<år>/", async () => {
    const fs = new InMemoryFileSystem();
    const registry = buildDefaultRegistry();
    const writer = new ProjectionWriter(fs, registry);
    const hydrator = new ProjectionHydrator(fs, registry);

    // Aktiv: skapa fil
    const activePath = await writer.project("matter", matter);
    expect(activePath).toBe("matters/active/matter-1.json");

    // Arkivera: hamnar i archive/2024/
    const archived = {
      ...matter,
      status: "ARCHIVED" as const,
      archivedAt: "2024-03-15T10:00:00.000Z",
    };
    const archivedPath = await writer.project("matter", archived);
    expect(archivedPath).toBe("matters/archive/2024/matter-1.json");

    // Bägge filer finns nu — det är hydrator/replay:s ansvar att städa
    // den gamla. Verifierar att hydrator hittar bägge:
    expect(await hydrator.hydratePath(activePath)).not.toBeNull();
    expect(await hydrator.hydratePath(archivedPath)).not.toBeNull();
  });
});
