/**
 * `inProcessLink` — en tRPC-länk som tolkar queries/mutations direkt i
 * browsern mot en given `Context`, istället för att göra HTTP-anrop.
 *
 * Tekniskt: bygger `appRouter.createCaller(ctx)` och översätter
 * `{ path, input }` → `caller.<path>(input)`. Detta är Git-backendens
 * transport (kör routrarna lokalt — ingen server).
 *
 * Designval (Adapter pattern): adapter mellan tRPC's client-API och
 * server-routern. Inga andra delar av koden känner till denna länk —
 * de går via `GitBackendRuntime`.
 */

import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@/lib/server/routers/_app";
import { appRouter } from "@/lib/server/routers/_app";
import type { Context } from "@/lib/server/trpc-core";
import { isQueuedProcedure, prepareQueuedInput } from "@/lib/shared/sync/queued-procedures";
import { SharedExclusiveLock } from "./shared-exclusive-lock";

/**
 * Spelar in ett köbart procedur-anrop (#1265, ADR 0037): kör `exec` lokalt och
 * köar anropet (inte raderna) för auktoritativ omkörning på servern.
 */
export type ProcedureRecorder = <T>(call: { path: string; input: Record<string, unknown> }, exec: () => Promise<T>) => Promise<T>;

export interface InProcessLinkOpts {
  /** Satt i self-hosted (server-first); utan den (demo) körs allt direkt. */
  recordProcedure?: ProcedureRecorder;
}

export function inProcessLink(ctx: Context, opts: InProcessLinkOpts = {}): TRPCLink<AppRouter> {
  const caller = appRouter.createCaller(ctx);
  // Köbara procedurer körs exklusivt (#1265): deras lokala skrivningar fångas
  // som anropets `touches`, och en samtidig mutation får inte hamna där.
  // Övriga mutationer körs delat; frågor läser bara och går förbi låset.
  const lock = new SharedExclusiveLock();

  const run = (path: string, input: unknown, type: string): Promise<unknown> => {
    const fn = resolvePath(caller, path);
    const recorder = opts.recordProcedure;
    if (!recorder || type !== "mutation") return fn(input);
    const prepared = isQueuedProcedure(path) ? prepareQueuedInput(path, input) : null;
    if (!prepared) return lock.shared(() => fn(input));
    return lock.exclusive(() => recorder({ path, input: prepared }, () => fn(prepared)));
  };

  return () => ({ op }) =>
    observable((observer) => {
      void (async () => {
        try {
          const result = await run(op.path, op.input, op.type);
          observer.next({ result: { data: result } });
          observer.complete();
        } catch (err) {
          // appRouter.createCaller wrappar alla fel till TRPCError (även
          // proxy-throws för okända paths). TRPCClientError.from ger
          // fel-objektet rätt klient-shape (.shape/.data/.meta).
          observer.error(TRPCClientError.from(err as never));
        }
      })();

      return () => {};
    });
}

/**
 * Walka path-segmenten ner till leaf-procedure-funktionen. tRPC v11:s
 * caller-proxy KASTAR själv ("No procedure found on path …") för okända
 * eller namespace-paths — vi behöver därför inga null-gardar; throw:en
 * fångas av try/catch ovan och översätts till ett tRPC-fel.
 */
function resolvePath(caller: unknown, path: string): (input: unknown) => Promise<unknown> {
  let cur: unknown = caller;
  for (const seg of path.split(".")) {
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur as (input: unknown) => Promise<unknown>;
}
