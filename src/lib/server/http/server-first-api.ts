/**
 * `server-first-api` — composition-root för server-first-runtimens
 * tRPC-over-HTTP-API (#410, ADR 0016). Knyter ihop:
 *
 *   createPostgresDb (db/client)        ← den auktoritativa Postgres-db:n
 *   + buildDrizzleRepositories (ADR 0020) ← typade repos ovanpå db:n
 *   + server-verifierad principal (server-context) ← oauth2-proxy-headers
 *   → createServerTrpcHandler            ← fetch-handler (Request → Response)
 *
 * `bin/server-first.ts` är den tunna körbara entryn ovanpå detta (argv/env +
 * `serveFetchHandler` + signaler) — all wiring-logik bor här (testbar).
 */

import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { createPostgresDb } from "@/lib/server/db/client";
import type { IPorts } from "@/lib/server/ports";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { bearerConfigFromEnv, type BearerVerifyConfig } from "./bearer-claims";
import { createServerTrpcHandler } from "./server-trpc-handler";

export interface ServerFirstApiConfig {
  /** Postgres-connection-URL (`postgres://…`). */
  databaseUrl: string;
  /** Byråns org (single-org server-MVP, ADR 0016). */
  organizationId: string;
  /** Server-side ports (default: no-op). */
  ports?: IPorts;
  /** tRPC-URL-prefix (default `/api/trpc`). */
  endpoint?: string;
  /** Max db-connections. */
  maxConnections?: number;
  /** Server-side fel-logg. */
  onError?: (err: unknown) => void;
  /**
   * Bearer-JWT-verifiering för icke-cookie-klienter (helper/add-in, ADR
   * 0028/0013). Default: härled ur miljön (`AVA_OIDC_*`); null → av.
   */
  bearer?: BearerVerifyConfig | null;
}

export interface ServerFirstApi {
  /** Fetch-handler att montera (t.ex. via `serveFetchHandler`). */
  handler: (req: Request) => Promise<Response>;
  /** Typade repos ovanpå db:n — exponeras så jobb-handlers (#518) kan läsa/skriva. */
  repos: ReturnType<typeof buildDrizzleRepositories>;
  /** Stäng db-poolen vid nedstängning. */
  close: () => Promise<void>;
}

/** Bygg server-first-API:t (handler + db-livscykel) ur en config. */
export function buildServerFirstApi(config: ServerFirstApiConfig): ServerFirstApi {
  const { db, close } = createPostgresDb(
    config.databaseUrl,
    config.maxConnections !== undefined ? { max: config.maxConnections } : {},
  );
  const repos = buildDrizzleRepositories(db);
  // Driv delta-sync: varje accepterad skrivning loggas i change_log (pull),
  // och `ctx.sync` ger sync-routern dess pull/push (ADR 0017).
  enableChangeLogOnAll(repos, createDbChangeLogRecorder(db));
  // Bearer-JWT-väg: explicit config, annars ur miljön (AVA_OIDC_*). Av som default.
  const bearer = config.bearer === undefined ? bearerConfigFromEnv() : config.bearer;
  const handler = createServerTrpcHandler({
    repos,
    ports: config.ports ?? noopPorts,
    organizationId: config.organizationId,
    sync: new DrizzleSyncStore(db, repos),
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(config.onError ? { onError: config.onError } : {}),
    ...(bearer ? { bearer } : {}),
  });
  return { handler, repos, close };
}

/** Env-nycklar för den körbara entryn. */
export const SERVER_FIRST_ENV = {
  databaseUrl: "AVA_DATABASE_URL",
  organizationId: "AVA_ORGANIZATION_ID",
  httpPort: "AVA_HTTP_PORT",
  httpHost: "AVA_HTTP_HOST",
} as const;

export interface ServerFirstRuntimeConfig {
  databaseUrl: string;
  organizationId: string;
  httpPort: number;
  httpHost: string;
}

const DEFAULT_HTTP_PORT = 3001;
const DEFAULT_HTTP_HOST = "127.0.0.1";

/** Läs runtime-config ur miljövariabler (kastar på saknade obligatoriska). */
export function loadServerFirstConfig(
  env: Record<string, string | undefined> = process.env,
): ServerFirstRuntimeConfig {
  const databaseUrl = env[SERVER_FIRST_ENV.databaseUrl];
  const organizationId = env[SERVER_FIRST_ENV.organizationId];
  if (!databaseUrl) throw new Error(`${SERVER_FIRST_ENV.databaseUrl} krävs`);
  if (!organizationId) throw new Error(`${SERVER_FIRST_ENV.organizationId} krävs`);
  const port = env[SERVER_FIRST_ENV.httpPort];
  return {
    databaseUrl,
    organizationId,
    httpPort: port ? Number(port) : DEFAULT_HTTP_PORT,
    httpHost: env[SERVER_FIRST_ENV.httpHost] ?? DEFAULT_HTTP_HOST,
  };
}
