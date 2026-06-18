/**
 * Server-first-runtime (#410, ADR 0016) — paketering till fristående binärer.
 *
 * Cross-compile:ar `src/bin/server-first.ts` (Postgres + tRPC-over-HTTP) till
 * linux-binärer för docker-imagen (`tooling/docker/server-first/`). Använder
 * `bun build --compile`-mönstret.
 *
 *   bun run server-first:build
 *
 * Migrationer bakas INTE in (binären kan inte läsa `tooling/db/migrations/` i
 * runtime) — kör `bun run db:migrate` mot Postgres separat före start.
 */

import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";

const OUT_DIR = "dist/server-first";
const ENTRY = "src/bin/server-first.ts";

// Deploy = linux (docker). Darwin utelämnas — kör `bun src/bin/server-first.ts` lokalt.
const TARGETS = [
  { target: "bun-linux-x64", out: "ava-server-first-linux-x64" },
  { target: "bun-linux-arm64", out: "ava-server-first-linux-arm64" },
] as const;

function buildOne(target: string, out: string): void {
  const res = spawnSync(
    "bun",
    ["build", ENTRY, "--compile", `--target=${target}`, "--outfile", `${OUT_DIR}/${out}`],
    { stdio: "inherit" },
  );
  if (res.status !== 0) throw new Error(`build misslyckades för ${target} (exit ${res.status ?? "signal"})`);
  console.log(`✓ ${out}`);
}

async function main(): Promise<void> {
  console.log(`Bygger ava-server-first →  ${OUT_DIR}/`);
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  for (const { target, out } of TARGETS) buildOne(target, out);
  console.log(`Klart: ${TARGETS.length} binärer i ${OUT_DIR}/`);
}

await main();
