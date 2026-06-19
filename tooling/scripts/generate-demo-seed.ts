#!/usr/bin/env tsx
/**
 * `generate-demo-seed.ts` (#544, ADR 0025) — emit:ar EN bundlad `demo-seed.json`
 * i demo-out:en. Klienten hämtar den (i st.f. manifest.json + N filer) och
 * hydrerar cachen via den riktiga reconcile/pull-vägen (`StaticSyncSource`).
 *
 * DRY: vi återanvänder `loadDemoSeed` (klientens egen seed-assembler) med en
 * filsystems-`fetch` mot out-mappen → `demo-seed.json` blir EXAKT den
 * `DemoSource` klienten annars hade byggt av manifest + filer (samma gruppering,
 * versionsgrind och `prebakeJoins`). Körs i `build-demo.sh` efter att
 * `generate-demo-manifest` skrivit manifestet.
 *
 * Användning:  bun tooling/scripts/generate-demo-seed.ts <out-dir>
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadDemoSeed } from "../../src/lib/client/demo/demo-seed-loader";

/** Filsystems-`fetch`: mappar `<baseUrl=""><path>` → fil i out-mappen. */
function fileFetch(outDir: string): typeof fetch {
  return (async (url: string | URL | Request): Promise<Response> => {
    const rel = String(url).replace(/^\/+/, "");
    try {
      const body = await readFile(join(outDir, rel), "utf8");
      return new Response(body, { status: 200 });
    } catch {
      return new Response("", { status: 404 });
    }
  }) as typeof fetch;
}

async function main(): Promise<void> {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error("[demo-seed] saknar out-dir-argument");
    process.exit(1);
  }
  const seed = await loadDemoSeed("local", { baseUrl: "", fetchFn: fileFetch(outDir), concurrency: 64 });
  const dest = join(outDir, "demo-seed.json");
  await writeFile(dest, JSON.stringify(seed));
  const counts = Object.entries(seed)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : 0}`)
    .filter((s) => !s.endsWith("=0"));
  console.log(`[demo-seed] skrev ${dest} (${counts.join(", ")})`);
}

main().catch((err) => {
  console.error("[demo-seed] FEL:", err);
  process.exit(1);
});
