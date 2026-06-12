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

import { ENV_KEYS, loadRuntimeConfig } from "@/lib/server/local-first/server-runtime-config";
import { startServerRuntime } from "@/lib/server/local-first/server-runtime";
import { buildFortnoxJob } from "@/lib/server/integrations/fortnox/runtime";
import { buildBankFilePaymentsJob } from "@/lib/server/integrations/ledger/bank-file-runtime";
import { makeRulesJob } from "@/lib/server/local-first/rules-job";
import { composeJobs } from "@/lib/server/local-first/compose-jobs";

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
`;

function log(msg: string): void {
  console.log(`[server-runtime] ${msg}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }

  const config = loadRuntimeConfig();
  // Regelmotor (#80): alltid på — schemalagda idempotenta regler (påminnelser).
  // Fortnox-connector (#82): bara när byrån anslutit Fortnox (valv + tokens).
  // composeJobs kör båda i samma cykel; no-empty-commit-grinden (#80) ser till
  // att tomma tick:ar inte pushar.
  const fortnox = await buildFortnoxJob({ workDir: config.workDir });
  // Bankfil-avprickning (#245): bara när AVA_CAMT_INBOX pekar på en mapp med
  // camt-filer; annars null → ingen avprickning (riskfritt).
  const payments = buildBankFilePaymentsJob({ log });
  const job = composeJobs([makeRulesJob({ log }), fortnox, payments]);
  const loop = await startServerRuntime(config, job ? { job } : {});

  if (argv.includes("--once")) {
    await loop.tickOnce();
    loop.stop();
    return;
  }

  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      log(`${sig} — stoppar`);
      loop.stop();
      process.exit(0);
    });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`[server-runtime] startfel: ${String(err)}\n`);
  process.exitCode = 1;
});
