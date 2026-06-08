/**
 * Cross-compile ava-helper till fristående binärer, en per plattform.
 * Ersätter Go:s GoReleaser. Körs av release-CI (#87) på en `helper-vX.Y.Z`-
 * tagg; lokalt: `bun build.ts [version]`.
 *
 * Versionen bakas in via `--define __AVA_HELPER_VERSION__` (se version.ts).
 * Asset-namnen matchar update.ts:s `assetName()` så självuppdatering hittar
 * rätt binär: `ava-helper-<os>-<arch>(.exe)`.
 */

import { mkdir, rm } from "node:fs/promises";

const VERSION = process.argv[2] ?? process.env.AVA_HELPER_VERSION ?? "dev";
const OUT_DIR = "dist";

// Bun-compile-targets → asset-namn (måste matcha update.ts assetName()).
const TARGETS = [
  { target: "bun-darwin-arm64", out: "ava-helper-darwin-arm64" },
  { target: "bun-darwin-x64", out: "ava-helper-darwin-x64" },
  { target: "bun-linux-x64", out: "ava-helper-linux-x64" },
  { target: "bun-linux-arm64", out: "ava-helper-linux-arm64" },
  { target: "bun-windows-x64", out: "ava-helper-windows-x64.exe" },
] as const;

async function buildOne(target: string, out: string): Promise<void> {
  const proc = Bun.spawn(
    [
      "bun",
      "build",
      "src/main.ts",
      "--compile",
      `--target=${target}`,
      `--define`,
      `__AVA_HELPER_VERSION__="${VERSION}"`,
      "--outfile",
      `${OUT_DIR}/${out}`,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  const code = await proc.exited;
  if (code !== 0) throw new Error(`build failed for ${target} (exit ${code})`);
  console.log(`✓ ${out}`);
}

async function main(): Promise<void> {
  console.log(`Bygger ava-helper ${VERSION} →  ${OUT_DIR}/`);
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  for (const { target, out } of TARGETS) {
    await buildOne(target, out);
  }
  console.log(`Klart: ${TARGETS.length} binärer i ${OUT_DIR}/`);
}

await main();
