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
 *   AVA_FORTNOX_CLIENT_ID/_CLIENT_SECRET/_REDIRECT_URI + AVA_SECRETS_KEY/_FILE
 *                         (valfria) Fortnox-bokföring från appen (#1172)
 *   AVA_LOG_LEVEL         (default info)  debug|info|warn|error — strukturerad
 *                         JSON-logg till stderr (#1080). `debug` ger en rad per
 *                         tRPC-anrop; `info` bara fel.
 */

import { loadContentDirFromEnv, makeContentStore } from "@/lib/server/adapters/git-content-store";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildServerFirstApi, loadServerFirstConfig } from "@/lib/server/http/server-first-api";
import { emailStatusLine } from "@/lib/server/integrations/email/disabled-email-sender";
import { fortnoxLedgerFromEnv } from "@/lib/server/integrations/fortnox/ledger-service";
import { startJobRuntime, type JobRuntime } from "@/lib/server/jobs/job-worker-runtime";
import { QueueBackedDocumentAnalyzer } from "@/lib/server/jobs/queue-backed-document-analyzer";
import { makeEmailPort } from "@/lib/server/jobs/queue-backed-email-sender";
import { buildServerFirstJobHandlers, loadActiveSmtpConfig } from "@/lib/server/jobs/server-first-handlers";
import { InMemoryLeaseStore } from "@/lib/server/lease/lease-store";
import { loadLlmConfigFromEnv } from "@/lib/server/llm/ollama-classifier";
import type { ILedgerService } from "@/lib/server/ports";
import { serveFetchHandler } from "@/lib/shared/http/node-http-adapter";
import { jsonSink, setLogLevel, setLogSink, type LogLevel } from "@/lib/shared/observability/logger";
import { asId } from "@/lib/shared/schemas/ids";

function log(msg: string): void {
  console.log(`[server-first] ${msg}`);
}

/**
 * Slå på strukturerad loggning (#1080).
 *
 * Default-sink:en är `nullSink` så bibliotekskod aldrig spammar en testutskrift
 * — destinationen väljs av den som äger processen, och det är här.
 *
 * `AVA_LOG_LEVEL=debug` ger en rad per lyckat tRPC-anrop. Default `info`
 * loggar bara fel, vilket är rätt volym för en byrå: en advokatbyrå gör inte
 * tillräckligt många anrop för att loggen ska bli dyr, men tillräckligt många
 * för att en debug-rad per anrop ska dränka felen.
 */
function startLogging(): void {
  setLogSink(jsonSink);
  const level = process.env.AVA_LOG_LEVEL;
  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    setLogLevel(level satisfies LogLevel);
  }
}

/** Fortnox-bokföring (#1172): kräver AVA_FORTNOX_* + valvet (AVA_SECRETS_*). Annars noop. */
function ledgerPort(): { ledger?: ILedgerService } {
  const ledger = fortnoxLedgerFromEnv();
  log(ledger ? "fortnox: konfigurerad" : "fortnox: av (AVA_FORTNOX_* / AVA_SECRETS_* saknas)");
  return ledger ? { ledger } : {};
}

function main(): void {
  startLogging();
  if (process.argv.slice(2).includes("--help")) {
    process.stdout.write(
      "ava server-first (#410, ADR 0016)\n\n" +
        "tRPC-over-HTTP mot Postgres med server-verifierad principal.\n\n" +
        "Env: AVA_DATABASE_URL, AVA_ORGANIZATION_ID, AVA_HTTP_PORT, AVA_HTTP_HOST,\n" +
        "     AVA_CONTENT_DIR (dokument-bytes på disk, #518)\n" +
        "Jobb-kö (#504): pg-boss på samma DB. E-postutskick aktiveras när\n" +
        "AVA_SMTP_HOST/PORT/USER/PASS/FROM (+ valfri AVA_SMTP_SECURE) är satta;\n" +
        "AVA_EMAIL_DISABLED=1 stänger av utskick helt (test-/pilotserver).\n" +
        "Dokumentklassificering (#518): server-LLM aktiveras när AVA_CONTENT_DIR +\n" +
        "AVA_LLM_ENDPOINT + AVA_LLM_MODEL (+ valfri AVA_LLM_API_KEY) är satta\n" +
        "(annars filnamns-heuristik). Kör ollama via docker `--profile llm`.\n",
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
    email: makeEmailPort(() => jobRuntime?.boss ?? null),
    // Dokumentklassificering (#518): `document.analyze` enqueue:ar ett
    // classify-document-jobb durabelt på pg-boss i st.f. noop.
    documentAnalyzer: new QueueBackedDocumentAnalyzer(() => jobRuntime?.boss ?? null, config.organizationId),
    ...(contentStore ? { content: contentStore } : {}),
    // Mjuk lease (ADR 0033 §2): in-memory process-singleton — efemär koordinering,
    // en omstart löper ut alla leases (korrekt). Ett enda objekt delas av alla requests.
    lease: new InMemoryLeaseStore(),
    ...ledgerPort(),
  };

  const api = buildServerFirstApi({
    databaseUrl: config.databaseUrl,
    organizationId: config.organizationId,
    ports,
    onError: (err) => log(`router-fel: ${String(err)}`),
  });
  const server = serveFetchHandler(api.handler, { port: config.httpPort, hostname: config.httpHost });
  log(`lyssnar på ${config.httpHost}:${config.httpPort} (org ${config.organizationId})`);
  log(emailStatusLine());

  // Jobb-kö (#504): best-effort start — en kö-hicka får ALDRIG ta ned HTTP-
  // serveringen. Handlers per konfigurerad integration (e-post via AVA_SMTP_*,
  // dokumentklassificering via repos #518).
  const smtp = loadActiveSmtpConfig();
  const llm = loadLlmConfigFromEnv();
  const handlers = buildServerFirstJobHandlers({
    ...(smtp ? { smtp } : {}),
    documents: api.repos.documents,
    // Server-LLM-klassificering (#518 Fas 3): med content-store + AVA_LLM_*
    // läses bytes → text extraheras (PDF/DOCX) → ollama klassificerar.
    ...(contentStore ? { content: contentStore } : {}),
    ...(llm ? { llm } : {}),
    // #988: klassificeringsjobbet skriver också kontakt-/händelseförslag ur
    // dokumentets text. Deterministisk extraktion → kräver ingen LLM, bara
    // content-store:n ovan.
    suggestions: api.repos,
    // #621 B2: LLM föreslår taggar ur byråns vokabulär (läses lazy per jobb).
    vocabulary: async () => (await api.repos.organizations.getById(asId<"OrganizationId">(config.organizationId)))?.documentTags ?? [],
  });
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
