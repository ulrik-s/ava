/**
 * `BackendTarget` — vilken backend demo-generatorn populerar (ADR 0001).
 *
 * Generatorn kör tRPC-mutationer mot `target.caller`; backend-implementationen
 * persisterar. Samma populate-kod fungerar mot vilken backend som helst.
 *   - Git: DemoDataStore + Node-fs-writeBack → pushbart git-repo.
 *   - Postgres: PostgresStore (ADR 0001 Fas 3) — stub tills den finns.
 */

import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore, type DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { appRouter, type AppRouter } from "@/lib/server/routers/_app";
import type { WriteBackEvent } from "./node-git-writeback";

export type GeneratorCaller = ReturnType<typeof appRouter.createCaller>;

export interface BackendTarget {
  /** tRPC-caller bunden till backendens context (principal = ADMIN). */
  readonly caller: GeneratorCaller;
  /** Avsluta: git commit (git) / nothing (postgres). */
  finalize(): Promise<void>;
}

export interface GitTargetOpts {
  principal: Principal;
  writeBack: (event: WriteBackEvent) => Promise<void>;
  /** Körs i finalize() — t.ex. git add/commit i out-dir:n. */
  onFinalize?: () => Promise<void>;
}

export function createGitTarget(opts: GitTargetOpts): BackendTarget {
  const source: DemoSource = {};
  // writeBack gör delegaterna skrivbara + persisterar till disk.
  const dataStore = new DemoDataStore(source, opts.writeBack as never);
  const ctx = buildContext({ dataStore, ports: noopPorts, principal: opts.principal });
  const caller = appRouter.createCaller(ctx as never) as GeneratorCaller;
  return {
    caller,
    finalize: async () => { await opts.onFinalize?.(); },
  };
}

export function createPostgresTarget(): BackendTarget {
  throw new Error(
    "Postgres-backenden är inte implementerad än (ADR 0001 Fas 3). " +
      "Kör med --backend=git tills PostgresStore finns.",
  );
}

export type { AppRouter };
