/**
 * Lasttestets rapport (#1366): JSON för maskiner (CI-artefakten) och en
 * läsbar sammanfattning, plus kraven — ett brott ger exit 1.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Thresholds } from "./config";
import type { ScenarioResult } from "./context";
import type { ConvergenceResult } from "./convergence";
import type { ContainerSummary } from "./docker-stats";
import type { PgSummary } from "./pg-stats";
import type { LatencySummary } from "./stats";

export interface LoadReport {
  startedAt: string;
  finishedAt: string;
  config: { users: number; orgs: number; scenarios: readonly string[]; durationS: number; offline: [number, number]; seed: number };
  thresholds: Thresholds;
  /** `fas:anrop` → svarstider. */
  operations: Record<string, LatencySummary>;
  /** Serverns egen tid per procedur (ur loggen, hela körningen). */
  serverOperations: Record<string, LatencySummary>;
  /** `fas:kod` → antal. */
  errors: Record<string, number>;
  count5xx: number;
  scenarios: ScenarioResult[];
  convergence: ConvergenceResult | null;
  postgres: PgSummary | null;
  containers: Record<string, ContainerSummary>;
  /** Lastgeneratorns event loop-fördröjning per fas. */
  clientEventLoopLag: Record<string, LatencySummary>;
  violations: string[];
}

/** Kraven som gäller hela körningen (scenariernas egna brott ligger i `scenarios`). */
export function evaluateThresholds(report: Omit<LoadReport, "violations">): string[] {
  const t = report.thresholds;
  const out = p95Violations(report.operations, t);
  if (report.count5xx > t.max5xx) out.push(`${report.count5xx} svar med HTTP 5xx (gräns ${t.max5xx})`);
  out.push(...(report.convergence?.mismatches ?? []).map((m) => `konvergens: ${m}`));
  out.push(...(report.convergence?.freshClientMismatches ?? []).map((m) => `konvergens: ${m}`));
  out.push(...pgViolations(report.postgres, t));
  out.push(...memoryViolations(report.containers, t));
  return out;
}

/** p95-kravet gäller de vanliga anropen under vanligt arbete (inte stormen). */
function p95Violations(operations: Record<string, LatencySummary>, t: Thresholds): string[] {
  return Object.entries(operations).flatMap(([key, s]) => {
    const [phase, op] = key.split(":");
    const applies = phase === "work" && op !== undefined && t.p95Ops.includes(op);
    return applies && s.p95 > t.maxP95Ms ? [`p95 för ${op} i vanligt arbete är ${s.p95} ms (gräns ${t.maxP95Ms} ms)`] : [];
  });
}

function pgViolations(pg: PgSummary | null, t: Thresholds): string[] {
  if (!pg) return [];
  const lockWaitMs = Math.max(pg.maxSampledLockWaitMs, pg.maxLoggedLockWaitMs);
  return [
    ...(pg.peakConnections >= pg.maxConnections ? [`Postgres: ${pg.peakConnections} anslutningar nådde max_connections (${pg.maxConnections})`] : []),
    ...(lockWaitMs > t.maxLockWaitMs ? [`Postgres: låsväntan ${lockWaitMs} ms (gräns ${t.maxLockWaitMs} ms; ${pg.lockWaitsOverTimeout} väntor > 1 s i loggen)`] : []),
    ...(pg.deadlocks > t.maxDeadlocks ? [`Postgres: ${pg.deadlocks} deadlocks (gräns ${t.maxDeadlocks})`] : []),
  ];
}

function memoryViolations(containers: Record<string, ContainerSummary>, t: Thresholds): string[] {
  const limit = t.maxServerMemMiB;
  if (limit === null) return [];
  return Object.entries(containers)
    .filter(([name, c]) => name.includes("server") && c.memMaxMiB > limit)
    .map(([name, c]) => `${name}: ${c.memMaxMiB} MiB minne (gräns ${limit} MiB)`);
}

const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));
const lpad = (s: string, n: number): string => (s.length >= n ? s : " ".repeat(n - s.length) + s);

/** Svarstiderna som en tabell. */
export function formatOperations(ops: Record<string, LatencySummary>, label = "fas:anrop"): string[] {
  const width = Math.max(10, ...Object.keys(ops).map((k) => k.length));
  const head = `${pad(label, width)} ${["antal", "fel", "p50", "p95", "p99", "max"].map((h) => lpad(h, 8)).join(" ")}`;
  const rows = Object.entries(ops).map(([k, s]) =>
    `${pad(k, width)} ${[s.count, s.errors, s.p50, s.p95, s.p99, s.max].map((v) => lpad(String(v), 8)).join(" ")}`);
  return [head, ...rows];
}

function scenarioLines(s: ScenarioResult): string[] {
  const d = s.details;
  const pick = (k: string): string => (d[k] === undefined ? "" : ` ${k}=${JSON.stringify(d[k])}`);
  return [`  ${s.scenario} (${(s.durationMs / 1000).toFixed(1)} s):${pick("drainMs")}${pick("queuedTotal")}${pick("uploads")}${pick("jobDrainMs")}${pick("mutations")}${pick("statusCounts")}${pick("rejected")}`];
}

/** Den läsbara sammanfattningen. */
export function formatSummary(report: LoadReport): string {
  const pg = report.postgres;
  return [
    `AVA lasttest — ${report.config.users} användare i ${report.config.orgs} byråer (${report.startedAt} → ${report.finishedAt})`,
    "",
    "Svarstider (ms):",
    ...formatOperations(report.operations),
    "",
    "Serverns egen tid per procedur (ms, ur loggen — utan nät och kontextbygge):",
    ...(Object.keys(report.serverOperations).length > 0 ? formatOperations(report.serverOperations, "procedur") : ["  ej mätt"]),
    "",
    `Fel per kod: ${Object.keys(report.errors).length === 0 ? "inga" : JSON.stringify(report.errors)}`,
    `HTTP 5xx: ${report.count5xx}`,
    "",
    "Scenarier:",
    ...report.scenarios.flatMap(scenarioLines),
    "",
    pg
      ? `Postgres: max ${pg.peakConnections}/${pg.maxConnections} anslutningar (aktiva ${pg.peakActive}), låsväntan max ${Math.max(pg.maxSampledLockWaitMs, pg.maxLoggedLockWaitMs)} ms (${pg.lockWaitsOverTimeout} > 1 s), deadlocks ${pg.deadlocks}`
      : "Postgres: ej mätt",
    `Containrar: ${Object.entries(report.containers).map(([n, c]) => `${n} CPU snitt ${c.cpuAvgPct} % / max ${c.cpuMaxPct} %, minne max ${c.memMaxMiB} MiB`).join("; ") || "ej mätta"}`,
    `Lastgeneratorns event loop (p99/max ms per fas): ${Object.entries(report.clientEventLoopLag).map(([phase, s]) => `${phase} ${s.p99}/${s.max}`).join(", ") || "ej mätt"}`,
    `Konvergens: ${report.convergence ? `${report.convergence.clients} klienter, ${report.convergence.mismatches.length} avvikelser; ny klient: ${report.convergence.freshClientMismatches.length} avvikelser` : "ej kontrollerad"}`,
    "",
    report.violations.length === 0 ? "RESULTAT: alla krav uppfyllda" : `RESULTAT: ${report.violations.length} krav bröts:\n${report.violations.map((v) => `  ✗ ${v}`).join("\n")}`,
  ].join("\n");
}

/** Skriv `load-report.json` och `load-report.txt` i `dir`; returnerar sökvägarna. */
export async function writeReport(dir: string, report: LoadReport): Promise<{ json: string; text: string }> {
  await mkdir(dir, { recursive: true });
  const json = join(dir, "load-report.json");
  const text = join(dir, "load-report.txt");
  await writeFile(json, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(text, `${formatSummary(report)}\n`);
  return { json, text };
}
