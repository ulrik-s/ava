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
import { ENTITY_REGISTRY } from "@/lib/shared/schemas";
import { type DemoSource, prebakeJoins } from "@/lib/shared/demo-source";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import { buildContext } from "@/lib/server/build-context";
import { appRouter } from "@/lib/server/routers/_app";
import type { Principal } from "@/lib/server/auth/principal";

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

/**
 * Översätt hydrerade entiteter (grupperade per projektions-namn) till en
 * `DemoSource`. Projektions-namn → DemoSource-fält mappas via
 * `ENTITY_REGISTRY.sourceKey` (single source of truth, samma som
 * `hydrateWorkingCopy` i browsern) och joins prebakas så routrarnas
 * nästlade `include` fungerar — exakt som GH-Pages-/OPFS-vägen.
 */
export function entitiesToDemoSource(entities: Record<string, unknown[]>): DemoSource {
  const out: Record<string, readonly unknown[]> = {};
  for (const [entity, list] of Object.entries(entities)) {
    const sourceKey = ENTITY_REGISTRY[entity]?.sourceKey;
    if (!sourceKey) continue;
    out[sourceKey] = list;
  }
  return prebakeJoins(out as DemoSource);
}

/**
 * Bygg en tRPC-caller mot en git working copy på disk (#115, läs-vägen).
 *
 * Komposition: hydrera entiteter → `DemoSource` → `DemoDataStore` →
 * `buildContext` (med en self-deklarerad `principal` — git-backenden har
 * ingen ACL, ADR 0001) → `appRouter.createCaller`. Detta är server-spegeln
 * av klientens `inProcessLink(ctx)`; samma routrar, samma kontext-form,
 * bara node-fs istället för OPFS som datakälla.
 *
 * En no-op write-back gör delegaterna writable så routrar som persisterar
 * historik (t.ex. `conflict.check`) inte kastar; faktisk persistens (node-fs
 * → commit) wiras i nästa slice (#116). Servern är en git-peer, inte
 * dataägare.
 */
export async function createWorkingCopyCaller(
  dir: string,
  principal: Principal,
): Promise<ReturnType<typeof appRouter.createCaller>> {
  const entities = await hydrateEntitiesFromWorkingCopy(dir);
  const source = entitiesToDemoSource(entities);
  const dataStore = new DemoDataStore(source, async () => { /* no-op write-back (#116) */ });
  const ctx = buildContext({ dataStore, ports: buildGitPorts(dataStore), principal });
  return appRouter.createCaller(ctx);
}
