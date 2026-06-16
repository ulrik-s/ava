/**
 * `buildContext` — den enda platsen där en tRPC-`Context` sätts ihop.
 *
 * Både Git-backendens in-process-länk och en framtida server-`createContext`
 * (Postgres) bygger sin Context härigenom, så formen hålls DRY oavsett
 * backend. Ren funktion — inga sidoeffekter, lätt att testa.
 */

import type { Principal } from "./auth/principal";
import type { IDataStore } from "./data-store/IDataStore";
import type { IPorts } from "./ports";
import { buildInMemoryRepositories } from "./repositories/in-memory-repositories";
import type { Repositories } from "./repositories/repositories";
import type { Context } from "./trpc-core";

export interface BuildContextDeps {
  dataStore: IDataStore;
  ports: IPorts;
  /** Fastställd av en `AuthProvider`. `null` = anonym/publik. */
  principal: Principal | null;
  /**
   * Repository-aggregat (ADR 0020). Default: in-memory-repos ovanpå `dataStore`
   * (git/demo/offline-vägen). Server-runtimen (#410) injicerar Drizzle-repos.
   */
  repos?: Repositories;
}

export function buildContext(deps: BuildContextDeps): Context {
  return {
    dataStore: deps.dataStore,
    repos: deps.repos ?? buildInMemoryRepositories(deps.dataStore),
    ports: deps.ports,
    user: deps.principal,
  };
}
