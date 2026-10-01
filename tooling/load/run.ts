#!/usr/bin/env bun
/**
 * Lasttest mot server-first i docker (#1366). Körs via `bun run load:test`
 * (load-test.sh startar stacken, migrerar och river den efteråt); direkt
 * mot en stack som redan står uppe:
 *
 *   LOAD_USERS=20 LOAD_ORGS=2 bun tooling/load/run.ts
 *
 * Konfiguration och gränser: se `config.ts` och docs/load-testing.md.
 * Exit 1 om något krav bröts — rapporten (JSON + text) skrivs i båda fallen.
 */

// Ingen IndexedDB i bun: klientens byte-cache (content-sync efter varje
// reconcile) får en i minnet. Allt annat lagras redan i minnet per klient.
import "fake-indexeddb/auto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { openMatter, uploadDocument } from "./actions";
import { parseLoadConfig, type LoadConfig, type Scenario } from "./config";
import type { LoadContext, ScenarioResult } from "./context";
import { checkConvergence } from "./convergence";
import { DockerStatsSampler } from "./docker-stats";
import { parseLockLog, PgSampler, type LockLog } from "./pg-stats";
import { evaluateThresholds, formatSummary, writeReport, type LoadReport } from "./report";
import { rng } from "./rng";
import { runDocuments } from "./scenarios/documents";
import { runIdempotency } from "./scenarios/idempotency";
import { runInvoice } from "./scenarios/invoice";
import { runStorm } from "./scenarios/storm";
import { runWork } from "./scenarios/work";
import { buildUsers, seedAll } from "./seed";
import { ServerDb } from "./server-db";
import { serverTimings } from "./server-log";
import { EventLoopLag, LatencyRecorder } from "./stats";
import { VirtualUser } from "./virtual-user";

const exec = promisify(execFile);

const RUNNERS: Readonly<Record<Scenario, (ctx: LoadContext) => Promise<ScenarioResult>>> = {
  work: runWork,
  storm: runStorm,
  invoice: runInvoice,
  documents: runDocuments,
  idempotency: runIdempotency,
};

function log(msg: string): void {
  console.log(`[lasttest] ${msg}`);
}

/** Vänta tills varje byrås server svarar på /readyz. */
async function waitForServers(config: LoadConfig): Promise<void> {
  for (const org of config.orgs) {
    for (let i = 0; ; i++) {
      const ok = await fetch(`${org.serverUrl}/readyz`).then((r) => r.ok, () => false);
      if (ok) break;
      if (i >= 60) throw new Error(`${org.serverUrl} svarade inte inom 60 s`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** Starta klienterna, ge varje jurist ett ärende och varje byrå några dokument att hämta. */
async function setup(config: LoadConfig, recorder: LatencyRecorder): Promise<LoadContext> {
  const users = buildUsers(config);
  await seedAll(config.orgs, users);
  const vus = users.map((u, i) => new VirtualUser(i + 1, u, recorder));
  await Promise.all(vus.map(async (vu) => { await vu.boot(); await vu.syncNow(); }));
  const ctx: LoadContext = {
    config, recorder, users: vus, rng: rng(config.seed),
    dbs: new Map(config.orgs.map((o) => [o.index, new ServerDb(o)])),
    matters: new Map(), documents: new Map(),
  };
  await Promise.all(vus.map(async (vu) => { ctx.matters.set(vu.index, await openMatter(vu, `Lasttestärende ${vu.index}`)); }));
  await Promise.all(vus.map((vu) => vu.drain(120_000)));
  for (const org of config.orgs) {
    const vu = vus.find((u) => u.user.org.index === org.index);
    const matterId = vu ? ctx.matters.get(vu.index) : undefined;
    if (!vu || !matterId) continue;
    const docs: string[] = [];
    for (let i = 0; i < 3; i++) docs.push(await uploadDocument(vu, matterId, config.uploadKb, `grund ${org.index}.${i}`));
    ctx.documents.set(org.index, docs);
  }
  await Promise.all(vus.map((vu) => vu.syncNow()));
  return ctx;
}

/** Postgres logg för körningen (för låsväntan > 1 s och deadlocks). */
async function lockLog(config: LoadConfig, since: string): Promise<LockLog> {
  if (!config.pgContainer) return { waitsOverTimeout: 0, maxWaitMs: 0, deadlocks: 0 };
  const out = await exec("docker", ["logs", "--since", since, config.pgContainer], { maxBuffer: 64 * 1024 * 1024 })
    .then((r) => `${r.stdout}\n${r.stderr}`, () => "");
  return parseLockLog(out);
}

async function runScenarios(ctx: LoadContext): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of ctx.config.scenarios) {
    log(`scenario ${scenario} …`);
    ctx.recorder.phase = scenario;
    const result = await RUNNERS[scenario](ctx);
    log(`scenario ${scenario}: ${(result.durationMs / 1000).toFixed(1)} s, ${result.violations.length} brott`);
    results.push(result);
  }
  return results;
}

async function main(): Promise<void> {
  const config = parseLoadConfig(process.env);
  const startedAt = new Date().toISOString();
  log(`${config.users} användare, ${config.orgs.length} byråer, scenarier: ${config.scenarios.join(", ")}`);
  await waitForServers(config);
  const recorder = new LatencyRecorder();
  const lag = new EventLoopLag();
  const pg = new PgSampler(config.adminDatabaseUrl);
  const docker = new DockerStatsSampler(config.containers);
  lag.start(() => recorder.phase);
  await pg.start();
  docker.start();
  const ctx = await setup(config, recorder);
  const scenarios = await runScenarios(ctx);
  ctx.recorder.phase = "convergence";
  const convergence = await checkConvergence(ctx);
  const [postgres, containers, serverOperations] = await Promise.all([
    lockLog(config, startedAt).then((l) => pg.stop(l)),
    docker.stop(),
    serverTimings(config.containers.filter((c) => c !== config.pgContainer), startedAt),
  ]);
  await Promise.all([...ctx.dbs.values()].map((db) => db.close()));
  const base: Omit<LoadReport, "violations"> = {
    startedAt, finishedAt: new Date().toISOString(),
    config: { users: config.users, orgs: config.orgs.length, scenarios: config.scenarios, durationS: config.durationS, offline: [config.offlineMin, config.offlineMax], seed: config.seed },
    thresholds: config.thresholds,
    operations: recorder.summaries(), serverOperations, errors: recorder.errors(), count5xx: recorder.count5xx,
    scenarios, convergence, postgres, containers, clientEventLoopLag: lag.stop(),
  };
  const report: LoadReport = { ...base, violations: [...scenarios.flatMap((s) => s.violations), ...evaluateThresholds(base)] };
  const paths = await writeReport(config.reportDir, report);
  console.log(`\n${formatSummary(report)}\n\nRapport: ${paths.json}, ${paths.text}`);
  process.exitCode = report.violations.length > 0 ? 1 : 0;
}

main().then(() => process.exit(), (err: unknown) => {
  process.stderr.write(`[lasttest] avbrutet: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(2);
});
