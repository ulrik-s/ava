#!/usr/bin/env tsx
/**
 * `generate-demo-manifest.ts` — genererar `manifest.json` i ett
 * demo-repo så `GhPagesDemoLoader` vet vilka filer den ska fetcha.
 *
 * Användning:
 *
 *   yarn tsx tooling/scripts/generate-demo-manifest.ts [demo-repo-rot]
 *
 * Utan argument används CWD. Default skannar:
 *   - matters/**\/*.json
 *   - contacts/*.json
 *   - .ava/users/*.json
 *
 * Utdata: `manifest.json` i repo-roten med formatet:
 *   {
 *     "paths": ["matters/active/m1.json", ...],
 *     "generatedAt": "2026-05-19T10:00:00Z",
 *     "version": 1
 *   }
 *
 * Tänkt att köras i CI för demo-repo:t (t.ex. `ulrik-s/ava-demo`)
 * via en GitHub Action vid varje push till main.
 */

import { readdir, writeFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";

const DEFAULT_SCAN_PATHS = [
  "matters", "contacts", ".ava",
  "matter-contacts", "documents", "document-folders",
  "document-analysis-suggestions", "matter-event-suggestions",
  "time-entries", "expenses", "invoices",
  // Senare tillagda entiteter — utan dessa skulle demo:n inte se kalender,
  // tasks, avbetalningsplaner eller jäv-historik.
  "calendar", "tasks",
  "payment-plans", "payment-plan-reminders", "payments",
  "acconto-deductions", "billing-runs", "conflict-checks", "offices",
];

async function listProjectionFiles(root: string, dir: string): Promise<string[]> {
  // Manifestet listar enbart projection-JSON. .md-innehållsfiler bredvid
  // metadata serveras direkt från GH Pages utan att gå via manifest.
  const full = join(root, dir);
  const out: string[] = [];
  try {
    const entries = await readdir(full, { withFileTypes: true });
    for (const e of entries) {
      const childAbs = join(full, e.name);
      if (e.isDirectory()) {
        // Hoppa över content-mappar inne i documents/
        if (e.name === "content") continue;
        out.push(...await listProjectionFiles(root, relative(root, childAbs)));
      } else if (e.isFile() && e.name.endsWith(".json")) {
        const rel = relative(root, childAbs);
        if (rel === "manifest.json") continue;
        out.push(rel);
      }
    }
  } catch {
    // Mapp finns inte — hoppa över tyst
  }
  return out;
}

async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? process.cwd());
  const paths: string[] = [];
  for (const scan of DEFAULT_SCAN_PATHS) {
    paths.push(...await listProjectionFiles(root, scan));
  }
  paths.sort();

  const manifest = {
    paths,
    generatedAt: new Date().toISOString(),
    version: 1,
  };

  const outPath = join(root, "manifest.json");
  await writeFile(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`[manifest] Skrev ${paths.length} sökvägar till ${outPath}`);
}

main().catch((err: unknown) => {
  console.error("[manifest] Fel:", err);
  process.exit(1);
});
