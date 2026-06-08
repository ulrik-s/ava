/**
 * Test för server-sidig hydrering ur en git working copy på disk (#115).
 *
 * Bygger en working copy med exakt samma data som demo-bygget (`buildSeed`
 * + `seedToFiles`), skriver den som JSON-filer till en temp-katalog via
 * native node-fs, och verifierar att `hydrateEntitiesFromWorkingCopy()`
 * läser tillbaka kärn-entiteterna (matter/contact/user) med rätt antal och
 * fält. Detta är server-spegeln av browserns OPFS-clone-hydrering — samma
 * `ProjectionHydrator`, bara `NodeFileSystem` istället för MemFs.
 *
 * `seed-hydration.test.ts` bevisar redan att VARJE seed-fil parsar med sin
 * projektion; här bevisar vi disk-rundturen (skriv → läs via node-fs).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest-compat";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { buildSeed, seedToFiles } from "../../../../tooling/scripts/seed-data";
import { hydrateEntitiesFromWorkingCopy } from "@/lib/server/local-first/server-working-copy";
import { CURRENT_SCHEMA_VERSION } from "@/lib/shared/schema-version";

/** Skriv alla seed-filer + .ava/meta.json till `dir` som en äkta working copy. */
async function writeWorkingCopy(
  dir: string,
  seed: ReturnType<typeof buildSeed>,
  schemaVersion: number = CURRENT_SCHEMA_VERSION,
): Promise<void> {
  for (const { path, data } of seedToFiles(seed)) {
    const abs = join(dir, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, JSON.stringify(data, null, 2), "utf8");
  }
  const metaAbs = join(dir, ".ava/meta.json");
  await mkdir(dirname(metaAbs), { recursive: true });
  await writeFile(metaAbs, JSON.stringify({ schemaVersion }), "utf8");
}

describe("hydrateEntitiesFromWorkingCopy", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ava-swc-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("hydrerar kärn-entiteter (matter/contact/user) med rätt antal", async () => {
    const seed = buildSeed({ orgId: "test-org" });
    await writeWorkingCopy(dir, seed);

    const entities = await hydrateEntitiesFromWorkingCopy(dir);

    expect(entities.matter?.length).toBe(seed.matters.length);
    expect(entities.contact?.length).toBe(seed.contacts.length);
    expect(entities.user?.length).toBe(seed.users.length);
  });

  it("bevarar fält genom projektion-deserialisering", async () => {
    const seed = buildSeed({ orgId: "test-org" });
    await writeWorkingCopy(dir, seed);

    const entities = await hydrateEntitiesFromWorkingCopy(dir);

    const matter = (entities.matter ?? []).find(
      (m) => (m as { id?: unknown }).id === seed.matters[0]!.id,
    ) as { organizationId?: unknown; matterNumber?: unknown } | undefined;
    expect(matter).toBeDefined();
    expect(matter!.organizationId).toBe("test-org");
    expect(matter!.matterNumber).toBe(seed.matters[0]!.matterNumber);
  });

  it("returnerar tomt för en working copy utan datafiler", async () => {
    await mkdir(join(dir, ".ava"), { recursive: true });
    await writeFile(
      join(dir, ".ava/meta.json"),
      JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION }),
      "utf8",
    );

    const entities = await hydrateEntitiesFromWorkingCopy(dir);

    expect(entities.matter ?? []).toHaveLength(0);
    expect(entities.contact ?? []).toHaveLength(0);
  });

  it("faller tillbaka på aktuell schema-version när meta.json saknas", async () => {
    const seed = buildSeed({ orgId: "test-org" });
    // Skriv data men INGEN .ava/meta.json
    for (const { path, data } of seedToFiles(seed)) {
      const abs = join(dir, path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, JSON.stringify(data), "utf8");
    }

    const entities = await hydrateEntitiesFromWorkingCopy(dir);

    // Data skriven av nuvarande kod hydreras utan migration.
    expect(entities.matter?.length).toBe(seed.matters.length);
    expect(entities.user?.length).toBe(seed.users.length);
  });
});
