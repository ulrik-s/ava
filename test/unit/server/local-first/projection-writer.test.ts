/**
 * Tester för `ProjectionWriter` och `ProjectionHydrator` — de två
 * helpers som kopplar Prisma-writes mot JSON-filer (och tvärt om).
 */

import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { ProjectionWriter, ProjectionHydrator } from "@/lib/server/local-first/projection-writer";
import { ProjectionRegistry } from "@/lib/server/local-first/projections/registry";
import { MatterProjection, type MatterProjectionData } from "@/lib/server/local-first/projections/matter";
import { InMemoryFileSystem } from "@/lib/server/local-first/in-memory-fs";

function buildRegistry(): ProjectionRegistry {
  const r = new ProjectionRegistry();
  r.register({
    entity: "matter",
    projection: new MatterProjection(),
    ownsPath: (p) => p.startsWith("matters/"),
  });
  return r;
}

const sampleMatter: MatterProjectionData = {
  id: "matter-1",
  matterNumber: "2026-0001",
  title: "Vårdnadstvist",
  status: "ACTIVE",
  organizationId: "org-1",
};

describe("ProjectionWriter — write-through", () => {
  let fs: InMemoryFileSystem;
  let writer: ProjectionWriter;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    writer = new ProjectionWriter(fs, buildRegistry());
  });

  it("project skriver entitet till rätt path", async () => {
    await writer.project("matter", sampleMatter);
    const content = await fs.readFile("matters/active/matter-1.json");
    expect(JSON.parse(content)).toEqual(sampleMatter);
  });

  it("project skriver med pretty JSON (för läsbara diff i git)", async () => {
    await writer.project("matter", sampleMatter);
    const content = await fs.readFile("matters/active/matter-1.json");
    expect(content.includes("\n")).toBe(true);
  });

  it("project följer status-byten — flyttar arkiverat till archive/", async () => {
    await writer.project("matter", sampleMatter);
    expect(await fs.exists("matters/active/matter-1.json")).toBe(true);

    const archived = { ...sampleMatter, status: "ARCHIVED" as const, archivedAt: "2024-03-15T10:00:00.000Z" };
    await writer.project("matter", archived);
    expect(await fs.exists("matters/archive/2024/matter-1.json")).toBe(true);
    // VIKTIGT: den gamla path:en städas inte automatiskt — det är
    // hydrator:s ansvar vid mass-replay. ProjectionWriter är "skriv-på-toppen".
  });

  it("project kastar för okänd entitet", async () => {
    await expect(writer.project("dummy", sampleMatter)).rejects.toThrow(/unknown entity|registry/i);
  });

  it("remove raderar projicerad fil från fs", async () => {
    await writer.project("matter", sampleMatter);
    await writer.remove("matter", sampleMatter);
    expect(await fs.exists("matters/active/matter-1.json")).toBe(false);
  });

  it("remove är no-op om filen inte fanns", async () => {
    await expect(writer.remove("matter", sampleMatter)).resolves.toBeUndefined();
  });
});

describe("ProjectionHydrator — hydrate-on-pull", () => {
  let fs: InMemoryFileSystem;
  let hydrator: ProjectionHydrator;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    hydrator = new ProjectionHydrator(fs, buildRegistry());
  });

  it("hydratePath läser fil och returnerar entitet + entity-namn", async () => {
    await fs.writeFile(
      "matters/active/matter-1.json",
      JSON.stringify(sampleMatter, null, 2),
    );
    const result = await hydrator.hydratePath("matters/active/matter-1.json");
    expect(result).not.toBeNull();
    expect(result!.entity).toBe("matter");
    expect(result!.data).toEqual(sampleMatter);
  });

  it("hydratePath returnerar null för path utan känd projektion", async () => {
    await fs.writeFile("rabbit-hole/x.json", "{}");
    expect(await hydrator.hydratePath("rabbit-hole/x.json")).toBeNull();
  });

  it("hydratePath returnerar null om filen saknas", async () => {
    expect(await hydrator.hydratePath("matters/active/missing.json")).toBeNull();
  });

  it("hydratePath kastar om JSON är korrupt", async () => {
    await fs.writeFile("matters/active/broken.json", "inte json alls");
    await expect(hydrator.hydratePath("matters/active/broken.json")).rejects.toThrow();
  });

  it("hydrateAll iterar alla kända paths och callbackar per entitet", async () => {
    await fs.writeFile(
      "matters/active/matter-1.json",
      JSON.stringify(sampleMatter, null, 2),
    );
    await fs.writeFile(
      "matters/active/matter-2.json",
      JSON.stringify({ ...sampleMatter, id: "matter-2", matterNumber: "2026-0002" }, null, 2),
    );
    const seen: Array<{ entity: string; id: string }> = [];
    await hydrator.hydrateAll((entity, data) => {
      seen.push({ entity, id: (data as { id: string }).id });
    });
    expect(seen).toHaveLength(2);
    expect(seen.map((s) => s.id).sort()).toEqual(["matter-1", "matter-2"]);
  });

  it("hydrateChanges callbackar bara för listade paths", async () => {
    await fs.writeFile("matters/active/m1.json", JSON.stringify(sampleMatter));
    await fs.writeFile(
      "matters/active/m2.json",
      JSON.stringify({ ...sampleMatter, id: "matter-2" }),
    );
    const callback = vi.fn();
    await hydrator.hydrateChanges(["matters/active/m1.json"], callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect((callback.mock.calls[0]![1] as { id: string }).id).toBe("matter-1");
  });

  it("hydrateChanges hoppar över okända paths utan att kasta", async () => {
    const callback = vi.fn();
    await hydrator.hydrateChanges(["rabbit-hole/x.json"], callback);
    expect(callback).not.toHaveBeenCalled();
  });
});
