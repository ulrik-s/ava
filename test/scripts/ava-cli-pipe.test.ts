/**
 * `ava`-bin:en med stdout som PIPE (#1756).
 *
 * Mot en pipe är stdout asynkron och buffrad. Avslutar bin:en med
 * `process.exit` rivs processen innan bufferten är tömd, och allt efter de
 * första 65 536 byten försvinner tyst. Ett test som skriver till fil missar
 * felet (där är skrivningen synkron).
 *
 * `Bun.spawn` med `stdout: "pipe"` tömmer pipen ivrigt och döljer därför
 * felet. Bin:en körs i stället bakom en riktig OS-pipe med en långsam
 * läsare (`bash`: `ava … | { sleep; cat; }`), som när utdatan pipas till `jq`.
 *
 * Spawnen är ASYNKRON (`Bun.spawn`) → filen är parallellsäker och behöver
 * inte stå i `SERIAL_FILES` (#327).
 */

import { describe, it, expect } from "vitest-compat";
import { z } from "zod";
import { safeParseJsonWith } from "@/lib/shared/parse-json";

const BIN = new URL("../../tooling/ava-cli/ava.ts", import.meta.url).pathname;
const PIPE_BUFFER = 65_536;
/** Läsaren väntar innan den börjar, så att pipe-bufferten hinner fyllas. */
const SLOW_READER = 'set -o pipefail; bun "$0" "$@" | { sleep 0.5; cat; }';

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

async function runBin(args: readonly string[]): Promise<RunResult> {
  const proc = Bun.spawn(["bash", "-c", SLOW_READER, BIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("ava-bin med stdout som pipe", () => {
  it("skriver hela `describe` (mer än 64 kB) och avslutar med kod 0", async () => {
    const res = await runBin(["describe"]);
    expect(res.code).toBe(0);
    expect(Buffer.byteLength(res.stdout)).toBeGreaterThan(PIPE_BUFFER);
    expect(safeParseJsonWith(z.unknown(), res.stdout).success).toBe(true);
  }, 60_000);

  it("behåller exitkod 1 och skriver till stderr för en okänd procedur", async () => {
    const res = await runBin(["okand", "proc"]);
    expect(res.code).toBe(1);
    expect(res.stderr.trim()).not.toBe("");
  }, 60_000);
});
