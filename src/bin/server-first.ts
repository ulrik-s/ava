#!/usr/bin/env bun
/**
 * Server-first-runtime (#410, ADR 0016) — körbar entry.
 *
 * Serverar `appRouter` över tRPC-over-HTTP mot den auktoritativa Postgres-db:n,
 * med en server-verifierad principal ur oauth2-proxy:s forwarded headers
 * (ADR 0009). Tänkt att sitta bakom nginx-fronten (loopback) — se
 * `node-http-adapter` + `forwarded-claims` (förtroendegräns).
 *
 * All logik bor i testbara moduler (`server-first-api`, `server-trpc-handler`,
 * `server-context`); den här filen är bara env + signaler + livscykel (samma
 * tunna mönster som `bin/server-runtime.ts`).
 *
 *   AVA_DATABASE_URL      (obligatorisk)  postgres://…
 *   AVA_ORGANIZATION_ID   (obligatorisk)  byråns org-id
 *   AVA_HTTP_PORT         (default 3001)
 *   AVA_HTTP_HOST         (default 127.0.0.1)
 */

import { serveFetchHandler } from "@/lib/server/http/node-http-adapter";
import { buildServerFirstApi, loadServerFirstConfig } from "@/lib/server/http/server-first-api";

function log(msg: string): void {
  console.log(`[server-first] ${msg}`);
}

function main(): void {
  if (process.argv.slice(2).includes("--help")) {
    process.stdout.write(
      "ava server-first (#410, ADR 0016)\n\n" +
        "tRPC-over-HTTP mot Postgres med server-verifierad principal.\n\n" +
        "Env: AVA_DATABASE_URL, AVA_ORGANIZATION_ID, AVA_HTTP_PORT, AVA_HTTP_HOST\n",
    );
    return;
  }

  const config = loadServerFirstConfig();
  const api = buildServerFirstApi({
    databaseUrl: config.databaseUrl,
    organizationId: config.organizationId,
    onError: (err) => log(`router-fel: ${String(err)}`),
  });
  const server = serveFetchHandler(api.handler, { port: config.httpPort, hostname: config.httpHost });
  log(`lyssnar på ${config.httpHost}:${config.httpPort} (org ${config.organizationId})`);

  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      log(`${sig} — stoppar`);
      server.close();
      void api.close().finally(() => process.exit(0));
    });
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`[server-first] startfel: ${String(err)}\n`);
  process.exitCode = 1;
}
