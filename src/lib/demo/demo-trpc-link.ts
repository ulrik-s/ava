/**
 * `createDemoTrpcLink` — en tRPC-länk som tolkar queries/mutations
 * direkt i browsern istället för att göra HTTP-anrop.
 *
 * Tekniskt: vi bygger `appRouter.createCaller(demoContext)` och
 * översätter `{ path, input }` → `caller.<path>(input)`. Detta
 * eliminerar behovet av en backend i demo-läget.
 *
 * Designval (Adapter pattern):
 *   - `createDemoTrpcLink` är en adapter mellan tRPC's client-API och
 *     server-routern. Inga andra delar av koden känner till denna länk.
 *
 * Designval (Dependency inversion):
 *   - `dataStoreFactory` injiceras. Tester kan ge en fixture-DataStore;
 *     produktion bygger DemoDataStore från en DemoSource.
 */

import { observable } from "@trpc/server/observable";
import { TRPCError } from "@trpc/server";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AppRouter } from "@/server/routers/_app";
import { appRouter } from "@/server/routers/_app";
import type { Context } from "@/server/trpc";
import type { IDataStore } from "@/server/data-store/IDataStore";

export interface DemoTrpcLinkDeps {
  dataStore: IDataStore;
  /** Demo-användare som routrarna ser. Default = "demo-user" i "demo-org". */
  user?: Context["user"];
}

export function createDemoTrpcLink(deps: DemoTrpcLinkDeps): TRPCLink<AppRouter> {
  const ctx: Context = {
    // `prisma` används inte i demo (DemoDataStore wrappar allt). En proxy
    // som kastar gör så vi upptäcker oavsiktliga direkt-anrop tidigt.
    prisma: makeThrowingProxy("prisma") as Context["prisma"],
    dataStore: deps.dataStore,
    user: deps.user ?? defaultDemoUser(),
  };

  const caller = appRouter.createCaller(ctx);

  return () => ({ op }) =>
    observable((observer) => {
      const path = op.path;
      const input = op.input;
      const type = op.type; // "query" | "mutation" | "subscription"

      (async () => {
        try {
          const fn = resolvePath(caller, path);
          if (!fn) throw new TRPCError({ code: "NOT_FOUND", message: `No procedure for path '${path}'` });
          const result = await fn(input);
          observer.next({ result: { data: result } });
          observer.complete();
        } catch (err) {
          // TRPCLink:s observer.error vill ha en TRPCClientError. Vi
          // wrappar via TRPCClientError.from så fel-objektet får rätt
          // shape (.shape/.data/.meta).
          observer.error(TRPCClientError.from(toTrpcError(err, type) as never));
        }
      })();

      return () => {};
    });
}

function defaultDemoUser(): Context["user"] {
  return {
    id: "demo-user",
    email: "demo@ava.local",
    name: "Demo Advokat",
    role: "ADMIN",
    organizationId: "demo-org",
  };
}

function resolvePath(caller: unknown, path: string): ((input: unknown) => Promise<unknown>) | null {
  // tRPC v11's caller använder Proxy — vi måste accessa lazy via key,
  // inte iterera Object.entries. Kollar bara `== null` per segment.
  const segments = path.split(".");
  let cur: unknown = caller;
  for (const seg of segments) {
    if (cur == null) return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return typeof cur === "function" ? (cur as (input: unknown) => Promise<unknown>) : null;
}

function toTrpcError(err: unknown, _type: string): TRPCError {
  if (err instanceof TRPCError) return err;
  if (err instanceof Error) {
    return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message, cause: err });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(err) });
}

function makeThrowingProxy(name: string): unknown {
  return new Proxy({}, {
    get(_t, prop) {
      throw new Error(`Demo-läget försökte komma åt '${name}.${String(prop)}'. Detta är ett kodfel — använd dataStore istället.`);
    },
  });
}
