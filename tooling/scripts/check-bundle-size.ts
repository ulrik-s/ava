#!/usr/bin/env bun
/**
 * Bundle-size-budget (#14) — fäller om klient-JS:en sväller tyst.
 *
 * Mäter summan av alla statiska JS-chunks i demo-exporten (`out/`, byggd med
 * `bun run build:demo`) gzip-komprimerat och jämför mot en budget. CI kör detta
 * efter build:demo. Budgeten är en RATCHET i samma anda som coverage/lint
 * (`docs/quality.md`): den ligger strax över dagens siffra och justeras BARA
 * när en ökning är medveten — aldrig som genväg för att landa kod.
 *
 * Inget extra npm-beroende (size-limit drar in en stor transitiv graf) — Bun
 * har gzip inbyggt, och vi äger tröskeln själva (jfr check-coverage.ts).
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/** Total gzip-budget för all statisk klient-JS (KB). Dagens nivå ~3164 KB. */
const BUDGET_KB = 3400;

/** Leta upp Next:s chunk-katalog under out/ (basePath-oberoende). */
async function findChunksDir(root: string): Promise<string | null> {
  const candidates = [join(root, "out", "_next", "static", "chunks")];
  // basePath-build (DEMO_BASE_PATH) lägger ibland assets under out/<base>/_next.
  try {
    for (const entry of await readdir(join(root, "out"))) {
      candidates.push(join(root, "out", entry, "_next", "static", "chunks"));
    }
  } catch {
    // out/ saknas → hanteras av anroparen.
  }
  for (const dir of candidates) {
    try {
      if ((await stat(dir)).isDirectory()) return dir;
    } catch {
      /* nästa kandidat */
    }
  }
  return null;
}

/** Alla .js-filer i en katalog (icke-rekursivt; Next lägger chunks platt). */
async function jsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    if (name.endsWith(".js")) out.push(join(dir, name));
  }
  return out;
}

interface Measured {
  count: number;
  gzipKb: number;
  biggest: { name: string; gzipKb: number } | null;
}

async function measure(dir: string): Promise<Measured> {
  const files = await jsFiles(dir);
  let total = 0;
  let biggest: Measured["biggest"] = null;
  for (const file of files) {
    const gz = gzipSync(await readFile(file)).byteLength;
    total += gz;
    if (!biggest || gz > biggest.gzipKb * 1024) {
      biggest = { name: file.split("/").pop() ?? file, gzipKb: gz / 1024 };
    }
  }
  return { count: files.length, gzipKb: total / 1024, biggest };
}

async function main(): Promise<void> {
  const root = process.cwd();
  const dir = await findChunksDir(root);
  if (!dir) {
    console.error("✗ hittade ingen out/_next/static/chunks — kör `bun run build:demo` först.");
    process.exit(1);
  }

  const m = await measure(dir);
  const pct = ((m.gzipKb / BUDGET_KB) * 100).toFixed(1);
  console.log(`Bundle-size (#14): ${m.count} JS-chunks, ${m.gzipKb.toFixed(1)} KB gzip`);
  if (m.biggest) console.log(`  största chunk: ${m.biggest.name} (${m.biggest.gzipKb.toFixed(1)} KB gzip)`);
  console.log(`  budget: ${BUDGET_KB} KB  (${pct} % använt)`);

  if (m.gzipKb > BUDGET_KB) {
    console.error(
      `✗ klient-JS ${m.gzipKb.toFixed(1)} KB > budget ${BUDGET_KB} KB.\n` +
        "  Bundeln har svällt. Lazy-loada tunga libs (pdfjs/exceljs/mammoth/LLM)\n" +
        "  eller, om ökningen är medveten, höj BUDGET_KB i tooling/scripts/check-bundle-size.ts.",
    );
    process.exit(1);
  }
  console.log("✓ inom budget.");
}

await main();
