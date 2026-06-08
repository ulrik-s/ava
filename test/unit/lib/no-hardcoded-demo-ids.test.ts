/**
 * Regression-skydd: web-appens runtime-kod (src/components, src/app,
 * src/lib/client) får inte innehålla hårdkodade demo-identifierare.
 *
 * Värdena ska komma från `.ava/meta.json` (via `loadDemoMeta`) eller
 * `ava.firma` localStorage (via `loadFirmaConfig`). Se feedback-memory
 * `feedback-no-hardcoded-demo-data`.
 *
 * Tooling/test-fixtures FÅR använda strängar som "u-anna" — bara web-app
 * runtime-koden är gated.
 */
import { describe, it, expect } from "vitest-compat";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [
  "src/app",
  "src/components",
  "src/lib/client",
  "src/lib/server", // bundlas in i demo (in-process tRPC)
  "src/lib/shared",
];
const HARDCODED_PATTERNS: Array<{ regex: RegExp; description: string }> = [
  { regex: /"u-[a-z]+"/g, description: "user slug ('u-anna' etc.)" },
  { regex: /"c-[a-z-]+"/g, description: "contact slug ('c-andersson' etc.)" },
  { regex: /"m-\d+-[a-z]+"/g, description: "matter slug ('m-001-vardnad' etc.)" },
  { regex: /"demo-firma-ab"/g, description: "demo organization slug" },
];

/** Visselblås — ge filer chans att opt-out via annotation. */
const ALLOW_COMMENT = "// regression-allow: hardcoded-demo-id";

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
}

interface Hit { file: string; line: number; text: string; pattern: string }

function findHits(file: string): Hit[] {
  const hits: Hit[] = [];
  const src = readFileSync(file, "utf8");
  if (src.includes(ALLOW_COMMENT)) return hits;
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
    for (const { regex, description } of HARDCODED_PATTERNS) {
      const m = line.match(regex);
      if (m) hits.push({ file, line: i + 1, text: m[0], pattern: description });
    }
  });
  return hits;
}

describe("no-hardcoded-demo-ids (regression-skydd)", () => {
  it("ingen runtime-fil under src/{app,components,lib/client} innehåller demo-slug-strängar", () => {
    const files: string[] = [];
    for (const root of ROOTS) walk(root, files);
    const hits = files.flatMap(findHits);
    if (hits.length > 0) {
      const report = hits.map((h) => `  ${h.file}:${h.line} → ${h.text} (${h.pattern})`).join("\n");
      throw new Error(
        `Hårdkodade demo-identifierare hittade — läs feedback-no-hardcoded-demo-data:\n${report}\n\n` +
        `Lös: läs värdet från meta.json (loadDemoMeta) eller firma-config (loadFirmaConfig).\n` +
        `Sista utväg: lägg "${ALLOW_COMMENT}" i filen om identifieraren är legitim.`,
      );
    }
    expect(hits).toEqual([]);
  });
});
