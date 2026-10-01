/**
 * Serverns egen tid per procedur (#1366), ur den strukturerade loggen
 * (`AVA_LOG_LEVEL=debug` ger en rad per tRPC-anrop, `trpc-core.ts`).
 *
 * Klientens svarstider innehåller nätet, kontextbygget och lastgeneratorns
 * egen event loop; serverns `durationMs` är bara procedurens körning. Skiljer
 * de sig mycket åt sitter tiden utanför proceduren.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { summarize, type LatencySummary } from "./stats";

const run = promisify(execFile);

const logLine = z.object({
  event: z.string().startsWith("trpc."),
  path: z.string(),
  durationMs: z.number(),
  outcome: z.enum(["ok", "error"]),
});

/** Loggtext → procedur → (tider, fel). Rader som inte är tRPC-anrop hoppas över. */
export function parseServerLog(text: string): Map<string, { ms: number[]; errors: number }> {
  const out = new Map<string, { ms: number[]; errors: number }>();
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = logLine.safeParse(json);
    if (!parsed.success) continue;
    const entry = out.get(parsed.data.path) ?? { ms: [], errors: 0 };
    entry.ms.push(parsed.data.durationMs);
    if (parsed.data.outcome === "error") entry.errors++;
    out.set(parsed.data.path, entry);
  }
  return out;
}

/** Sammanfatta per procedur, sorterat på namn. */
export function summarizeServerLog(parsed: ReadonlyMap<string, { ms: number[]; errors: number }>): Record<string, LatencySummary> {
  return Object.fromEntries([...parsed.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, e]) => [path, summarize(e.ms, e.errors)]));
}

/** Läs serverloggarna (sedan `since`) ur containrarna och sammanfatta. */
export async function serverTimings(containers: readonly string[], since: string): Promise<Record<string, LatencySummary>> {
  const logs = await Promise.all(containers.map((c) =>
    run("docker", ["logs", "--since", since, c], { maxBuffer: 256 * 1024 * 1024 }).then((r) => `${r.stdout}\n${r.stderr}`, () => "")));
  return summarizeServerLog(parseServerLog(logs.join("\n")));
}
