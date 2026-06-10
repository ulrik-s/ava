/**
 * Server-runtime D (#118, ADR 0005 fas 1) — paketering.
 *
 * Cross-compile:ar den körbara entryn (`src/bin/server-runtime.ts`) till
 * fristående binärer, en per server-plattform — samma `bun build --compile`-
 * mönster som helper-app/build.ts (ADR 0005 §Språk: standalone-binär ur TS).
 *
 * Kör: `bun run server-runtime:build` (eller `bun tooling/scripts/build-server-runtime.ts`).
 *
 * Binären bär hela tRPC-grafen + git-peer-runtimen; git-creds tas vid körning
 * av systemets git-config/credential-helper (inga hemligheter bakas in).
 */

import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";

const OUT_DIR = "dist/server-runtime";
const ENTRY = "src/bin/server-runtime.ts";

// Server-plattformar (deploy = linux; darwin för lokal drift/dev). Windows
// utelämnas — server-runtimen är en alltid-på Unix-tjänst.
const TARGETS = [
  { target: "bun-darwin-arm64", out: "ava-server-runtime-darwin-arm64" },
  { target: "bun-darwin-x64", out: "ava-server-runtime-darwin-x64" },
  { target: "bun-linux-x64", out: "ava-server-runtime-linux-x64" },
  { target: "bun-linux-arm64", out: "ava-server-runtime-linux-arm64" },
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
  console.log(`Bygger ava-server-runtime →  ${OUT_DIR}/`);
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  for (const { target, out } of TARGETS) {
    buildOne(target, out);
  }
  console.log(`Klart: ${TARGETS.length} binärer i ${OUT_DIR}/`);
}

await main();
