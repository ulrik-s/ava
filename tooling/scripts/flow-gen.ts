#!/usr/bin/env bun
/**
 * Genererar etikettlistan och flödesdokumentationen ur tooling/agents/flow.yaml.
 *
 *   bun tooling/scripts/flow-gen.ts           kontrollera (exit 1 om något är inaktuellt)
 *   bun tooling/scripts/flow-gen.ts --write   skriv om filerna
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DOCS_PATH, LABELS_PATH, renderDocs, renderLabels } from "./flow/generate";
import { loadFlow } from "./flow/load";

/** Filerna som ska finnas, med sitt genererade innehåll. */
export function expectedFiles(): Array<[string, string]> {
  const flow = loadFlow();
  return [[LABELS_PATH, renderLabels(flow)], [DOCS_PATH, renderDocs(flow)]];
}

const current = (path: string): string => {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
};

/** Filer vars innehåll inte stämmer med flödet. */
export function staleFiles(files: Array<[string, string]>): string[] {
  return files.filter(([path, text]) => current(path) !== text).map(([path]) => path);
}

if (import.meta.main) {
  const files = expectedFiles();
  if (process.argv.includes("--write")) {
    for (const [path, text] of files) writeFileSync(path, text);
    console.log(`✓ skrev ${files.map(([p]) => p).join(", ")}`);
  } else {
    const stale = staleFiles(files);
    for (const p of stale) console.error(`✗ ${p} är inaktuell — kör: bun run flow:gen`);
    process.exit(stale.length === 0 ? 0 : 1);
  }
}
