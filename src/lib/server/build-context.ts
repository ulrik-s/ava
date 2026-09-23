/**
 * `buildContext` — den enda platsen där en tRPC-`Context` sätts ihop.
 *
 * Både Git-backendens in-process-länk och en framtida server-`createContext`
 * (Postgres) bygger sin Context härigenom, så formen hålls DRY oavsett
 * backend. Ren funktion — inga sidoeffekter, lätt att testa.
 */

import type { Capabilities } from "@/lib/shared/capabilities";
import { DEMO_CAPABILITIES } from "@/lib/shared/capabilities";
import type { Principal } from "./auth/principal";
import type { IDataStore, IEventLog } from "./data-store/IDataStore";
import type { IPorts } from "./ports";
import { buildInMemoryRepositories } from "./repositories/in-memory-repositories";
import type { Repositories } from "./repositories/repositories";
import type { SyncStore } from "./sync/sync-store";
import type { Context } from "./trpc-core";

export interface BuildContextDeps {
  /**
   * Full in-memory-store (git/demo/offline) — bygger in-memory-repos (om `repos`
   * utelämnas) OCH levererar event-loggen till `ctx.dataStore`. Server-first
   * utelämnar den och anger `repos` + `eventLog` i stället.
   */
  dataStore?: IDataStore;
  /**
   * Event-logg för `ctx.dataStore` när ingen full `dataStore` finns (server-first).
   * Faller annars tillbaka på `dataStore.events`.
   */
  eventLog?: IEventLog;
  ports: IPorts;
  /** Fastställd av en `AuthProvider`. `null` = anonym/publik. */
  principal: Principal | null;
  /**
   * Repository-aggregat (ADR 0020). Default: in-memory-repos ovanpå `dataStore`
   * (git/demo/offline-vägen). Server-runtimen (#410) injicerar Drizzle-repos.
   */
  repos?: Repositories;
  /** Server-sidans delta-sync-port (ADR 0017). Bara server-first-runtimen. */
  sync?: SyncStore;
  /** Kapabilitets-tier (ADR 0027). Default: demo-baslinjen (server-first sätter sina). */
  capabilities?: Capabilities;
  /**
   * Korrelations-id för anropet (#1080). HTTP-lagret tar det ur
   * `x-ava-request-id` eller genererar ett; utelämnas det sätter
   * tRPC-middleware:n ett eget, så loggen alltid har något att korrelera på.
   */
  requestId?: string;
}

/** Event-loggen ur någon av de två vägarna. Kastar hellre än returnerar en
 *  halv context — ett saknat eventlager märks annars först vid första emit. */
function resolveEvents(deps: BuildContextDeps): IEventLog {
  const events = deps.eventLog ?? deps.dataStore?.events;
  if (!events) {
    throw new Error("buildContext: ange `dataStore` eller `eventLog`.");
  }
  return events;
}

/** Injicerade repos, annars in-memory ovanpå `dataStore`. */
function resolveRepos(deps: BuildContextDeps): Repositories {
  if (deps.repos) return deps.repos;
  if (!deps.dataStore) {
    throw new Error("buildContext: ange `repos` eller `dataStore` (för in-memory-repos).");
  }
  return buildInMemoryRepositories(deps.dataStore);
}

export function buildContext(deps: BuildContextDeps): Context {
  const events = resolveEvents(deps);
  const repos = resolveRepos(deps);
  return {
    dataStore: { events },
    repos,
    ports: deps.ports,
    user: deps.principal,
    ...(deps.sync ? { sync: deps.sync } : {}),
    ...(deps.requestId ? { requestId: deps.requestId } : {}),
    capabilities: deps.capabilities ?? DEMO_CAPABILITIES,
  };
}
