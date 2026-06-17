/**
 * `createServerTrpcHandler` — server-first tRPC-over-HTTP-endpoint (#410,
 * ADR 0016). Exponerar SAMMA `appRouter` som git/demo-vägen kör in-process,
 * men över HTTP mot Postgres-backenden, med en server-verifierad principal.
 *
 * Skild från `trpc-http-handler.ts` (ADR 0013 git-peer: Bearer-PAT +
 * working-copy-session + commit/push-lås): här är auth oauth2-proxy-header-trust
 * och persistensen Postgres-transaktioner (inget git-lås behövs). Båda delar
 * fetch-standard-formen `(Request) => Promise<Response>` så de kan monteras via
 * samma `node-http-adapter`.
 *
 * Auth: ingen global 401 — oauth2-proxy gat:ar redan åtkomsten (ADR 0009).
 * Saknas en giltig forwarded-identitet blir principalen `null` och
 * `protectedProcedure`/`orgProcedure` kastar `UNAUTHORIZED` (publika procedurer
 * fungerar fortsatt).
 */

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/lib/server/routers/_app";
import { createServerContext, type ServerContextDeps } from "./server-context";
import { DEFAULT_TRPC_ENDPOINT } from "./trpc-http-handler";

export interface ServerTrpcHandlerDeps extends ServerContextDeps {
  /** URL-prefix (default {@link DEFAULT_TRPC_ENDPOINT}). */
  endpoint?: string;
  /** Server-side fel-logg (valfri). */
  onError?: (err: unknown) => void;
}

/** Skapa fetch-handlern som serverar `appRouter` mot Postgres-backenden. */
export function createServerTrpcHandler(
  deps: ServerTrpcHandlerDeps,
): (req: Request) => Promise<Response> {
  const endpoint = deps.endpoint ?? DEFAULT_TRPC_ENDPOINT;
  const ctxDeps: ServerContextDeps = {
    repos: deps.repos,
    ports: deps.ports,
    organizationId: deps.organizationId,
    ...(deps.headerNames ? { headerNames: deps.headerNames } : {}),
  };
  return (req: Request): Promise<Response> =>
    fetchRequestHandler({
      endpoint,
      req,
      router: appRouter,
      createContext: () => createServerContext(req, ctxDeps),
      ...(deps.onError ? { onError: ({ error }) => deps.onError?.(error) } : {}),
    });
}
