/**
 * Server-sidig hydrering av domän-entiteter ur en git working copy på disk
 * (#115, ADR 0005 fas 1 — läs-vägen). Till skillnad från browser-vägen
 * (OPFS + isomorphic-git via MemFs) använder servern native node-fs
 * (`NodeFileSystem`). Samma projektions-/migrate-on-read-logik
 * (`ProjectionHydrator`, ADR 0004) — bara en annan IFileSystem-implementation.
 *
 * Detta är första byggstenen i server-runtime:n: när entiteterna är hydrerade
 * kan de matas in i en `DemoDataStore` + `buildContext` + tRPC-caller (nästa
 * slice). Servern är en git-peer, inte dataägare.
 */

import { CURRENT_SCHEMA_VERSION, parseSchemaVersion } from "@/lib/shared/schema-version";

import { DEMO_META_PATH } from "../../../../tooling/demo-config";
import type { IFileSystem } from "./file-system";
import { NodeFileSystem } from "./node-fs";
import { ProjectionHydrator } from "./projection-writer";
import { buildDefaultRegistry } from "./projections/default-registry";

/** Läs repots datamodell-version ur .ava/meta.json (default = aktuell kod-version). */
async function repoSchemaVersion(fs: IFileSystem): Promise<number> {
  try {
    if (!(await fs.exists(DEMO_META_PATH))) return CURRENT_SCHEMA_VERSION;
    const raw = JSON.parse(await fs.readFile(DEMO_META_PATH)) as { schemaVersion?: unknown };
    return parseSchemaVersion(raw.schemaVersion) ?? CURRENT_SCHEMA_VERSION;
  } catch {
    return CURRENT_SCHEMA_VERSION;
  }
}

/**
 * Hydrera alla domän-entiteter ur en git working copy på `dir`. Returnerar
 * entiteter grupperade per projektions-namn (t.ex. `matter`, `contact`).
 */
export async function hydrateEntitiesFromWorkingCopy(dir: string): Promise<Record<string, unknown[]>> {
  const fs: IFileSystem = new NodeFileSystem(dir);
  const hydrator = new ProjectionHydrator(fs, buildDefaultRegistry(), await repoSchemaVersion(fs));
  const entities: Record<string, unknown[]> = {};
  await hydrator.hydrateAll((entity, data) => {
    (entities[entity] ??= []).push(data);
  });
  return entities;
}
