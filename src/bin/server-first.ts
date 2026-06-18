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
 *   AVA_CONTENT_DIR       (valfri) katalog för dokument-bytes (server-side
 *                         lagring; krävs för dokumentklassificering, #518)
 */

import { loadContentDirFromEnv, makeContentStore } from "@/lib/server/adapters/git-content-store";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { serveFetchHandler } from "@/lib/server/http/node-http-adapter";
import { buildServerFirstApi, loadServerFirstConfig } from "@/lib/server/http/server-first-api";
import { startJobRuntime, type JobRuntime } from "@/lib/server/jobs/job-worker-runtime";
import { QueueBackedEmailSender } from "@/lib/server/jobs/queue-backed-email-sender";
import { buildServerFirstJobHandlers, loadSmtpConfigFromEnv } from "@/lib/server/jobs/server-first-handlers";

function log(msg: string): void {
  console.log(`[server-first] ${msg}`);
}

function main(): void {
  if (process.argv.slice(2).includes("--help")) {
    process.stdout.write(
      "ava server-first (#410, ADR 0016)\n\n" +
        "tRPC-over-HTTP mot Postgres med server-verifierad principal.\n\n" +
        "Env: AVA_DATABASE_URL, AVA_ORGANIZATION_ID, AVA_HTTP_PORT, AVA_HTTP_HOST,\n" +
        "     AVA_CONTENT_DIR (dokument-bytes på disk, #518)\n" +
        "Jobb-kö (#504): pg-boss på samma DB. E-postutskick aktiveras när\n" +
        "AVA_SMTP_HOST/PORT/USER/PASS/FROM (+ valfri AVA_SMTP_SECURE) är satta.\n",
    );
    return;
  }

  const config = loadServerFirstConfig();

  // E-post-porten köar durabelt på pg-boss (#504). Boss:en hämtas lazy — den
  // startas best-effort NEDAN, efter att API:t byggts. Porten skapas här uppe.
  let jobRuntime: JobRuntime | null = null;
  // Dokument-bytes lagras i ett git-repo (`AVA_CONTENT_DIR`) så server-side-jobb
  // (klassificering, #518) kan läsa innehållet OCH en annan server kan `git pull`
  // för backup. Saknas dir:t → no-op (ingen server-side-lagring), som tidigare.
  const contentStore = makeContentStore(loadContentDirFromEnv());
  const ports = {
    ...noopPorts,
    email: new QueueBackedEmailSender(() => jobRuntime?.boss ?? null),
    ...(contentStore ? { content: contentStore } : {}),
  };

  const api = buildServerFirstApi({
    databaseUrl: config.databaseUrl,
    organizationId: config.organizationId,
    ports,
    onError: (err) => log(`router-fel: ${String(err)}`),
  });
  const server = serveFetchHandler(api.handler, { port: config.httpPort, hostname: config.httpHost });
  log(`lyssnar på ${config.httpHost}:${config.httpPort} (org ${config.organizationId})`);

  // Jobb-kö (#504): best-effort start — en kö-hicka får ALDRIG ta ned HTTP-
  // serveringen. Handlers per konfigurerad integration (e-post via AVA_SMTP_*).
  const smtp = loadSmtpConfigFromEnv();
  const handlers = buildServerFirstJobHandlers(smtp ? { smtp } : {});
  void startJobRuntime({ connectionString: config.databaseUrl, handlers })
    .then((rt) => { jobRuntime = rt; log(`jobb-kö startad (pg-boss; ${Object.keys(handlers).length} handlers)`); })
    .catch((err) => log(`jobb-kö start misslyckades (fortsätter utan): ${String(err)}`));

  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      log(`${sig} — stoppar`);
      server.close();
      void Promise.allSettled([api.close(), jobRuntime?.stop() ?? Promise.resolve()])
        .finally(() => process.exit(0));
    });
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`[server-first] startfel: ${String(err)}\n`);
  process.exitCode = 1;
}
