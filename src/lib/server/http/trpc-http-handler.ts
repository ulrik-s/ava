/**
 * tRPC-over-HTTP-handler för server-runtime:ns native-klient-API (#83,
 * ADR 0013 §1 A1). Exponerar **samma** `appRouter` som web-appen kör
 * in-process (`inProcessLink`) — men över HTTP, så Office-add-ins kan vara
 * tunna `httpBatchLink`-klienter utan egen git-db.
 *
 * Designval: en ren `(Request) => Promise<Response>`-handler (fetch-standard)
 * så den kan monteras i vilken Node-/Bun-/edge-server som helst. Den är
 * transport + auth-grind; HUR en per-principal-`Context` byggs (working-copy,
 * commit/push) injiceras via `createContext` — composition-root:ens ansvar
 * (server-runtime-processen), inte transportens.
 *
 * Auth: `Authorization: Bearer <PAT>` verifieras FÖRE routern körs (ADR 0013
 * §3, C1). Saknad/ogiltig token → 401 utan att routern (eller en dyr
 * working-copy-bygge) ens nås.
 */

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/lib/server/routers/_app";
import type { Context } from "@/lib/server/trpc-core";
import type { Principal } from "@/lib/server/auth/principal";
import { parseBearerToken, type PatVerifier } from "./pat";

/** Default-URL-prefix mot vilket klienten gör tRPC-anrop. */
export const DEFAULT_TRPC_ENDPOINT = "/api/trpc";

export interface TrpcHttpHandlerOpts {
  /** Verifierar Bearer-token → principal. */
  verifier: PatVerifier;
  /**
   * Bygg en per-principal tRPC-`Context` (working-copy/dataStore/ports).
   * Anropas bara för autentiserade requests.
   */
  createContext: (principal: Principal) => Promise<Context> | Context;
  /** URL-prefix (default {@link DEFAULT_TRPC_ENDPOINT}). */
  endpoint?: string;
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
  return async (req: Request): Promise<Response> => {
    const token = parseBearerToken(req.headers.get("authorization"));
    const principal = token ? opts.verifier.verify(token) : null;
    if (!principal) return unauthorized();

    const ctx = await opts.createContext(principal);
    return fetchRequestHandler({
      endpoint,
      req,
      router: appRouter,
      createContext: () => ctx,
      ...(opts.onError ? { onError: ({ error }) => opts.onError?.(error) } : {}),
    });
  };
}
