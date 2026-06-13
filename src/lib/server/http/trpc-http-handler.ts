/**
 * tRPC-over-HTTP-handler för server-runtime:ns native-klient-API (#83,
 * ADR 0013 §1 A1). Exponerar **samma** `appRouter` som web-appen kör
 * in-process (`inProcessLink`) — men över HTTP, så Office-add-ins kan vara
 * tunna `httpBatchLink`-klienter utan egen git-db.
 *
 * Designval: en ren `(Request) => Promise<Response>`-handler (fetch-standard)
 * så den kan monteras i vilken Node-/Bun-/edge-server som helst. Den är
 * transport + auth-grind; HUR en `Context` byggs och persisteras (working-copy,
 * commit/push) injiceras via `openSession` — composition-root:ens ansvar
 * (server-runtime-processen), inte transportens.
 *
 * Concurrency (beslut A): en valfri `lock` serialiserar HELA requesten
 * (hydrera → kör → commit/push) mot peer-loopen som delar samma working-copy.
 *
 * Auth: `Authorization: Bearer <PAT>` verifieras FÖRE något annat (ADR 0013
 * §3, C1). Saknad/ogiltig token → 401 utan att en session (eller ett dyrt
 * working-copy-bygge) ens öppnas.
 */

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/lib/server/routers/_app";
import type { Context } from "@/lib/server/trpc-core";
import type { Principal } from "@/lib/server/auth/principal";
import { parseBearerToken, type PatVerifier } from "./pat";

/** Default-URL-prefix mot vilket klienten gör tRPC-anrop. */
export const DEFAULT_TRPC_ENDPOINT = "/api/trpc";

/**
 * En öppnad request-session: en `Context` att köra routern mot, och en
 * `finalize` som anropas EFTER att requesten körts (i en `finally`) för att
 * persistera ev. mutationer. `finalize` får requesten så den kan avgöra
 * query vs mutation (tRPC: GET=query, POST=mutation).
 */
export interface RequestSession {
  context: Context;
  finalize: (req: Request) => Promise<void>;
}

export interface TrpcHttpHandlerOpts {
  /** Verifierar Bearer-token → principal. */
  verifier: PatVerifier;
  /**
   * Öppna en per-principal-session (working-copy/dataStore/ports + finalize).
   * Anropas bara för autentiserade requests, inuti `lock` om sådan finns.
   */
  openSession: (principal: Principal) => Promise<RequestSession> | RequestSession;
  /** URL-prefix (default {@link DEFAULT_TRPC_ENDPOINT}). */
  endpoint?: string;
  /**
   * Serialiserar hela requesten mot andra skrivare (peer-loopen). Default:
   * ingen serialisering (kör direkt). Composition-root:en injicerar ett delat
   * lås (ADR 0013, beslut A).
   */
  lock?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Server-side fel-logg (valfri). */
  onError?: (err: unknown) => void;
}

/** 401-svar med `WWW-Authenticate: Bearer` (RFC 6750). */
function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
  });
}

/**
 * Skapa en fetch-handler som serverar `appRouter` över HTTP bakom en
 * Bearer-PAT-grind. Returnerar `(req) => Promise<Response>`.
 */
export function createTrpcHttpHandler(
  opts: TrpcHttpHandlerOpts,
): (req: Request) => Promise<Response> {
  const endpoint = opts.endpoint ?? DEFAULT_TRPC_ENDPOINT;
  const lock = opts.lock ?? (<T>(fn: () => Promise<T>) => fn());

  const serve = async (req: Request, principal: Principal): Promise<Response> => {
    const session = await opts.openSession(principal);
    try {
      return await fetchRequestHandler({
        endpoint,
        req,
        router: appRouter,
        createContext: () => session.context,
        ...(opts.onError ? { onError: ({ error }) => opts.onError?.(error) } : {}),
      });
    } finally {
      await session.finalize(req);
    }
  };

  return async (req: Request): Promise<Response> => {
    const token = parseBearerToken(req.headers.get("authorization"));
    const principal = token ? opts.verifier.verify(token) : null;
    if (!principal) return unauthorized();
    return lock(() => serve(req, principal));
  };
}
