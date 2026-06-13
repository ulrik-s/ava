/**
 * Server-sidig hydrering av domän-entiteter ur en git working copy på disk
 * (#115, ADR 0005 fas 1 — läs-vägen). Till skillnad från browser-vägen
 * (OPFS + isomorphic-git via MemFs) använder servern native node-fs
 * (`NodeFileSystem`). Samma projektions-/migrate-on-read-logik
 * (`ProjectionHydrator`, ADR 0004) — bara en annan IFileSystem-implementation.
 *
 * Server-runtime:n i tre lager:
 *   - läs   (#115): hydrera entiteter → DemoSource → DemoDataStore → caller.
 *   - skriv (#116): mutationer skrivs igenom till working-copy:n via samma
 *     write-back-kärna som klienten (`makeWriteBack`) + `NodeGitOps.commit`.
 * Servern är en git-peer, inte dataägare.
 */

import { CURRENT_SCHEMA_VERSION } from "@/lib/shared/schema-version";
import { schemaVersionFromMetaJson } from "@/lib/shared/meta-json";
import { ENTITY_REGISTRY } from "@/lib/shared/schemas";
import { type DemoSource, prebakeJoins } from "@/lib/shared/demo-source";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import { buildContext } from "@/lib/server/build-context";
import { appRouter } from "@/lib/server/routers/_app";
import type { Context } from "@/lib/server/trpc-core";
import type { Principal } from "@/lib/server/auth/principal";
// Skriv-vägens kärna delas med klientens FSA-/OPFS-write-back (DRY). Lager-
// regeln `server-contracts-must-not-import-client` undantar uttryckligen
// `server/local-first/` — composition-root:en för git-peer-runtimen.
import { makeWriteBack, type WriteBackFs } from "@/lib/client/firma/fsa-write-back";

import { DEMO_META_PATH } from "../../../../tooling/demo-config";
import type { IFileSystem } from "./file-system";
import { NodeFileSystem } from "./node-fs";
import { NodeGitOps } from "./node-git-ops";
import type { GitCommit } from "./git-ops";
import { ProjectionHydrator } from "./projection-writer";
import { buildDefaultRegistry } from "./projections/default-registry";

/** Läs repots datamodell-version ur .ava/meta.json (default = aktuell kod-version). */
async function repoSchemaVersion(fs: IFileSystem): Promise<number> {
  try {
    if (!(await fs.exists(DEMO_META_PATH))) return CURRENT_SCHEMA_VERSION;
    // Zod vid parsegränsen (#187) — delad helper för alla meta.json-läsare.
    return schemaVersionFromMetaJson(await fs.readFile(DEMO_META_PATH)) ?? CURRENT_SCHEMA_VERSION;
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
 * `WriteBackFs`-adapter över `NodeFileSystem` (#116, skriv-vägen).
 *
 * Klientens write-back-kärna (`makeWriteBack`) skriver mot "/"-prefixade,
 * repo-relativa paths (t.ex. `/contacts/x.json`) — isomorphic-git-konventionen.
 * `NodeFileSystem` är sandboxad mot en rot och avvisar paths som börjar med
 * "/" (de tolkas som absoluta → utanför roten). Vi strippar därför ledande
 * "/" och låter NodeFileSystem hantera mkdir-p + ENOENT-tolerant delete.
 */
class NodeWriteBackFs implements WriteBackFs {
  private readonly fs: NodeFileSystem;
  constructor(dir: string) {
    this.fs = new NodeFileSystem(dir);
  }
  writeFile(path: string, data: string): Promise<void> {
    return this.fs.writeFile(path.replace(/^\/+/, ""), data);
  }
  unlink(path: string): Promise<void> {
    return this.fs.deleteFile(path.replace(/^\/+/, ""));
  }
}

/** En öppnad server-runtime mot en git working copy på disk. */
export interface ServerWorkingCopy {
  /** tRPC-caller — samma routrar som klienten, bara node-fs som datakälla. */
  readonly caller: ReturnType<typeof appRouter.createCaller>;
  /**
   * Den byggda tRPC-`Context`:en (dataStore/ports/principal). Exponeras för
   * HTTP-vägen (#83), som kör routern via `fetchRequestHandler` (egen caller)
   * och därför behöver själva contexten, inte den färdiga callern.
   */
  readonly context: Context;
  /** Underliggande git-operationer (fetch/commit/push/...) mot working-copy:n. */
  readonly gitOps: NodeGitOps;
  /**
   * Committa alla write-back-ändringar i working-copy:n (`git add -A` +
   * commit). Idempotent: skrivningar med samma id överskriver samma fil, så
   * en omkörning ger inga dubbletter; `--allow-empty` gör en no-op-mutation
   * till en tom commit istället för ett fel.
   */
  commit(message: string): Promise<GitCommit>;
}

export interface OpenServerWorkingCopyOpts {
  /** Self-deklarerad principal (git-backenden har ingen ACL, ADR 0001). */
  principal: Principal;
  /** Git-författare för commits. Default: principalens namn + e-post. */
  author?: { name: string; email: string };
  /** Remote-branch NodeGitOps arbetar mot. Default: origin/main. */
  remote?: string;
  branch?: string;
}

/**
 * Öppna en git working copy som en körbar server-runtime (#115 läs + #116 skriv).
 *
 * Komposition: hydrera entiteter → `DemoSource` → `DemoDataStore` (med
 * node-fs write-back) → `buildContext` → `appRouter.createCaller`. Detta är
 * server-spegeln av klientens `inProcessLink(ctx)` + `makeFsaWriteBack`:
 * samma routrar, samma write-back-kärna, bara node-fs istället för OPFS.
 *
 * Mutationer skrivs igenom till working-copy:n via `makeWriteBack`. Anropa
 * `commit()` efter en mutation för att persistera den i git. Servern är en
 * git-peer, inte dataägare.
 */
export async function openServerWorkingCopy(
  dir: string,
  opts: OpenServerWorkingCopyOpts,
): Promise<ServerWorkingCopy> {
  const entities = await hydrateEntitiesFromWorkingCopy(dir);
  const source = entitiesToDemoSource(entities);
  const writeBack = makeWriteBack(new NodeWriteBackFs(dir));
  const dataStore = new DemoDataStore(source, writeBack);
  const ctx = buildContext({ dataStore, ports: buildGitPorts(dataStore), principal: opts.principal });
  const author = opts.author ?? { name: opts.principal.name, email: opts.principal.email };
  const gitOps = new NodeGitOps(dir, author.name, author.email, opts.remote ?? "origin", opts.branch ?? "main");
  return {
    caller: appRouter.createCaller(ctx),
    context: ctx,
    gitOps,
    commit: (message) => gitOps.commit(message),
  };
}

/**
 * Bekvämlighets-wrapper som bara returnerar tRPC-callern (#115, läs-vägen).
 * Delegerar till {@link openServerWorkingCopy}; för persistens, använd den
 * direkt och anropa `commit()`.
 */
export async function createWorkingCopyCaller(
  dir: string,
  principal: Principal,
): Promise<ReturnType<typeof appRouter.createCaller>> {
  const wc = await openServerWorkingCopy(dir, { principal });
  return wc.caller;
}
