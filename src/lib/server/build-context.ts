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
}

export function buildContext(deps: BuildContextDeps): Context {
  const events = deps.eventLog ?? deps.dataStore?.events;
  if (!events) {
    throw new Error("buildContext: ange `dataStore` eller `eventLog`.");
  }
  let repos = deps.repos;
  if (!repos) {
    if (!deps.dataStore) {
      throw new Error("buildContext: ange `repos` eller `dataStore` (för in-memory-repos).");
    }
    repos = buildInMemoryRepositories(deps.dataStore);
  }
  return {
    dataStore: { events },
    repos,
    ports: deps.ports,
    user: deps.principal,
    ...(deps.sync ? { sync: deps.sync } : {}),
    capabilities: deps.capabilities ?? DEMO_CAPABILITIES,
  };
}
