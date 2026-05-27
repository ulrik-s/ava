/**
 * `GitBackendRuntime` — `BackendRuntime` för Git-backenden (local-first).
 *
 * Komponerar klossarna:
 *   1. `AuthProvider` (default `GitAuthProvider`) → principal (själv-deklarerad).
 *   2. `buildGitPorts(dataStore)` → IPorts (in-memory search + analys, övrigt no-op).
 *   3. `buildContext({ dataStore, ports, principal })` → Context.
 *   4. `inProcessLink(ctx)` → tRPC-länk som kör routrarna i klienten.
 *
 * Allt server-/backend-specifikt sitter bakom denna klass. Att byta till
 * Postgres = en `PostgresBackendRuntime` som returnerar en httpBatchLink —
 * UI:t och routrarna ändras inte.
 */

import type { TRPCLink } from "@trpc/client";
import type { AppRouter } from "@/lib/server/routers/_app";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import type { IPorts } from "@/lib/server/ports";
import type { AuthProvider } from "@/lib/server/auth/principal";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import { buildContext } from "@/lib/server/build-context";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import { inProcessLink } from "@/lib/client/demo/in-process-link";
import type { BackendRuntime } from "./backend-runtime";

export interface GitBackendRuntimeDeps {
  dataStore: IDataStore;
  /** Default: `GitAuthProvider` (demo-principalen). */
  authProvider?: AuthProvider;
  /** Default: `buildGitPorts(dataStore)`. Override i tester. */
  ports?: IPorts;
}

export class GitBackendRuntime implements BackendRuntime {
  constructor(private readonly deps: GitBackendRuntimeDeps) {}

  createLink(): TRPCLink<AppRouter> {
    const ports = this.deps.ports ?? buildGitPorts(this.deps.dataStore);
    const principal = (this.deps.authProvider ?? new GitAuthProvider()).getPrincipal();
    const ctx = buildContext({ dataStore: this.deps.dataStore, ports, principal });
    return inProcessLink(ctx);
  }
}
