#!/usr/bin/env bun
/**
 * Server-runtime D (#118, ADR 0005 fas 1) — körbar entry.
 *
 * Den fristående artefakten som kör pull→act→push-loopen mot en konfigurerad
 * `firma.git` (#77:s "Klar när"). Körs via `bun src/bin/server-runtime.ts`
 * eller som kompilerad binär (`bun run server-runtime:build`, se
 * `tooling/scripts/build-server-runtime.ts`).
 *
 * All logik bor i testbara moduler (`server-runtime-config`,
 * `server-runtime`, `peer-loop`); den här filen är bara argv + signaler +
 * process-livscykel — medvetet tunn (samma mönster som helper-app/src/main.ts).
 *
 * Config läses ur miljövariabler (se ENV_KEYS); git-creds tas av systemets
 * git-config/credential-helper — inga hemligheter via env.
 */

import type { Server } from "node:http";

import { Mutex } from "@/lib/server/concurrency/mutex";
import { serveFetchHandler } from "@/lib/server/http/node-http-adapter";
import { buildServerApiHandler } from "@/lib/server/http/server-api";
import { buildDispatchJob } from "@/lib/server/integrations/email/dispatch-runtime";
import { buildFortnoxJob } from "@/lib/server/integrations/fortnox/runtime";
import { buildBankFilePaymentsJob } from "@/lib/server/integrations/ledger/bank-file-runtime";
import { composeJobs } from "@/lib/server/local-first/compose-jobs";
import { makeRulesJob } from "@/lib/server/local-first/rules-job";
import { startServerRuntime } from "@/lib/server/local-first/server-runtime";
import { ENV_KEYS, loadRuntimeConfig, type RuntimeConfig } from "@/lib/server/local-first/server-runtime-config";

const HELP = `ava server-runtime (ADR 0005 fas 1)

Kör en pull→act→push-loop mot en konfigurerad firma.git. Utan en connector
körs loopen i sync-läge (håller working-copy:n à jour; pushar inget).

Användning:
  bun src/bin/server-runtime.ts [--once] [--help]

Flaggor:
  --once    Kör en enda tick och avsluta (för cron/smoke-test).
  --help    Visa denna hjälp.

Miljövariabler:
  ${ENV_KEYS.repoUrl}        (obligatorisk)  remote-url till firma.git
  ${ENV_KEYS.workDir}        (obligatorisk)  katalog för working-copy:n
  ${ENV_KEYS.organizationId}          (obligatorisk)  org-id för principalen
  ${ENV_KEYS.branch}           (default main)
  ${ENV_KEYS.remote}           (default origin)
  ${ENV_KEYS.pollIntervalMs}  (default 15000)
  ${ENV_KEYS.maxRetries}       (default 3)
  ${ENV_KEYS.principalId} / ${ENV_KEYS.principalEmail} / ${ENV_KEYS.principalName} / ${ENV_KEYS.principalRole}
  ${ENV_KEYS.httpPort}        (valfri)  port för tRPC-over-HTTP-API:t (#83)
  ${ENV_KEYS.apiTokens}      (valfri)  komma-separerade Bearer-PAT:er mot API:t
`;

function log(msg: string): void {
  console.log(`[server-runtime] ${msg}`);
}

/**
 * Montera det additiva tRPC-over-HTTP-API:t (#83) om port + token finns.
 * Delar `lock` med peer-loopen (ADR 0013 beslut A). Returnerar servern (att
 * stänga vid nedstängning) eller `undefined` när API:t inte är konfigurerat.
 */
function startApi(config: RuntimeConfig, lock: <T>(fn: () => Promise<T>) => Promise<T>): Server | undefined {
  const handler = buildServerApiHandler(
    {
      workDir: config.workDir,
      remote: config.remote,
      branch: config.branch,
      apiTokens: config.apiTokens,
      principal: config.principal,
    },
    { lock, log },
  );
  if (!handler || config.httpPort === undefined) {
    if (config.apiTokens.length > 0 || config.httpPort !== undefined) {
      log("HTTP-API ej monterat: kräver både " + `${ENV_KEYS.httpPort} och ${ENV_KEYS.apiTokens}`);
    }
    return undefined;
  }
  const server = serveFetchHandler(handler, { port: config.httpPort, hostname: config.httpHost });
  log(`tRPC-API lyssnar på ${config.httpHost}:${config.httpPort} (${config.apiTokens.length} token)`);
  return server;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }

  const config = loadRuntimeConfig();
  // EN delad Mutex (ADR 0013 beslut A): peer-loopen och HTTP-API:t serialiseras
  // mot samma working-copy så de aldrig skriver git samtidigt.
  const mutex = new Mutex();
  const lock = <T>(fn: () => Promise<T>): Promise<T> => mutex.runExclusive(fn);

  // Regelmotor (#80): alltid på — schemalagda idempotenta regler (påminnelser).
  // Fortnox-connector (#82): bara när byrån anslutit Fortnox (valv + tokens).
  // composeJobs kör båda i samma cykel; no-empty-commit-grinden (#80) ser till
  // att tomma tick:ar inte pushar.
  const fortnox = await buildFortnoxJob();
  // Bankfil-avprickning (#245): bara när AVA_CAMT_INBOX pekar på en mapp med
  // camt-filer; annars null → ingen avprickning (riskfritt).
  const payments = buildBankFilePaymentsJob({ log });
  // Fakturautskick (#180): bara när SMTP-uppgifter finns i valvet; annars null.
  const dispatch = await buildDispatchJob({ log });
  const job = composeJobs([makeRulesJob({ log }), fortnox, payments, dispatch]);
  const loop = await startServerRuntime(config, { ...(job ? { job } : {}), lock });
  const apiServer = startApi(config, lock);

  if (argv.includes("--once")) {
    await loop.tickOnce();
    loop.stop();
    apiServer?.close();
    return;
  }

  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      log(`${sig} — stoppar`);
      loop.stop();
      apiServer?.close();
      process.exit(0);
    });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`[server-runtime] startfel: ${String(err)}\n`);
  process.exitCode = 1;
});
