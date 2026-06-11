/**
 * Enforcing-grind för #40: `src/lib/**` ska hållas STRIKT på complexity@8 —
 * helt fritt från complexity-undantag.
 *
 * ESLint-regeln `complexity: ["error", { max: 8 }]` gäller redan globalt, men
 * den kan kringgås på två sätt. Den här grinden stänger båda specifikt för
 * `src/lib` (ren logik — JSX-komponenter i src/app hanteras separat, #199):
 *
 *   1. Inline `// eslint-disable[-next-line] … complexity`.
 *   2. Poster i `eslint-suppressions.json` med en `complexity`-nyckel.
 *
 * Faller (exit 1) om något återinförs. RATCHET: src/lib gick till 0 i #40 och
 * ska förbli 0. Se docs/quality.md.
 *
 * Kör: `bun run lint:lib-complexity`
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LIB_DIR = "src/lib";
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
for (const file of walk(LIB_DIR)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (DISABLE_RE.test(line)) inlineHits.push(`${file}:${i + 1}`);
  });
}

const suppressionHits: string[] = [];
try {
  const sup = JSON.parse(readFileSync(SUPPRESSIONS, "utf8")) as Record<string, Record<string, unknown>>;
  for (const [file, rules] of Object.entries(sup)) {
    if (file.startsWith(`${LIB_DIR}/`) && rules && "complexity" in rules) {
      suppressionHits.push(file);
    }
  }
} catch {
  /* ingen suppressions-fil → inget att kontrollera */
}

if (inlineHits.length === 0 && suppressionHits.length === 0) {
  console.log(`✓ ${LIB_DIR} är strikt på complexity@8 — inga complexity-undantag.`);
  process.exit(0);
}

console.error(`✗ ${LIB_DIR} måste hållas fritt från complexity-undantag (#40).`);
if (inlineHits.length > 0) {
  console.error(`\n  Inline-disables (${inlineHits.length}):`);
  for (const h of inlineHits) console.error(`    ${h}`);
}
if (suppressionHits.length > 0) {
  console.error(`\n  Suppressions-poster (${suppressionHits.length}):`);
  for (const h of suppressionHits) console.error(`    ${h}`);
}
console.error(`\n  Bryt ut hjälpfunktioner så funktionen hamnar ≤8 i stället. Se docs/quality.md.`);
process.exit(1);
