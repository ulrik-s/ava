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

import { observable } from "@trpc/server/observable";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AppRouter } from "@/lib/server/routers/_app";
import { appRouter } from "@/lib/server/routers/_app";
import type { Context } from "@/lib/server/trpc-core";

export function inProcessLink(ctx: Context): TRPCLink<AppRouter> {
  const caller = appRouter.createCaller(ctx);

  return () => ({ op }) =>
    observable((observer) => {
      void (async () => {
        try {
          const fn = resolvePath(caller, op.path);
          const result = await fn(op.input);
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
