/**
 * Enforcing-grind för complexity@8: source-trädet ska hållas STRIKT på
 * complexity@8 — helt fritt från complexity-undantag.
 *
 * ESLint-regeln `complexity: ["error", { max: 8 }]` gäller redan globalt, men
 * den kan kringgås på två sätt. Den här grinden stänger båda specifikt för
 * `src/lib` (#40, ren logik), `src/app` + `src/components` (#199, UI):
 *
 *   1. Inline `// eslint-disable[-next-line] … complexity`.
 *   2. Poster i `eslint-suppressions.json` med en `complexity`-nyckel.
 *
 * Faller (exit 1) om något återinförs. RATCHET: alla tre trädena gick till 0
 * (src/lib i #40, src/app + src/components i #199) och ska förbli 0. UI-kod är
 * up for refactoring som vilken annan kod som helst — bryt ut hjälpfunktioner/
 * sub-komponenter så funktionen hamnar ≤8 i stället. Se docs/quality.md.
 *
 * Kör: `bun run lint:complexity-strict`
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIRS = ["src/lib", "src/app", "src/components"];
const SUPPRESSIONS = "eslint-suppressions.json";
const DISABLE_RE = /eslint-disable(?:-next-line|-line)?[^\n]*\bcomplexity\b/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const inlineHits: string[] = [];
for (const dir of DIRS) {
  for (const file of walk(dir)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (DISABLE_RE.test(line)) inlineHits.push(`${file}:${i + 1}`);
    });
  }
}

const suppressionHits: string[] = [];
try {
  const sup = JSON.parse(readFileSync(SUPPRESSIONS, "utf8")) as Record<string, Record<string, unknown>>;
  for (const [file, rules] of Object.entries(sup)) {
    const inScope = DIRS.some((d) => file.startsWith(`${d}/`));
    if (inScope && rules && "complexity" in rules) {
      suppressionHits.push(file);
    }
  }
} catch {
  /* ingen suppressions-fil → inget att kontrollera */
}

if (inlineHits.length === 0 && suppressionHits.length === 0) {
  console.log(`✓ ${DIRS.join(", ")} är strikt på complexity@8 — inga complexity-undantag.`);
  process.exit(0);
}

console.error(`✗ ${DIRS.join(", ")} måste hållas fritt från complexity-undantag (#40 + #199).`);
if (inlineHits.length > 0) {
  console.error(`\n  Inline-disables (${inlineHits.length}):`);
  for (const h of inlineHits) console.error(`    ${h}`);
}
if (suppressionHits.length > 0) {
  console.error(`\n  Suppressions-poster (${suppressionHits.length}):`);
  for (const h of suppressionHits) console.error(`    ${h}`);
}
console.error(`\n  Bryt ut hjälpfunktioner/sub-komponenter så funktionen hamnar ≤8 i stället. Se docs/quality.md.`);
process.exit(1);
