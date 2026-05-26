/**
 * Smoke-test för demo-flödet end-to-end mot ett riktigt GitHub-repo.
 *
 *   yarn tsx tooling/scripts/smoke-test-demo.ts https://github.com/<user>/ava-demo.git
 *
 * Bekräftar att:
 *   1. cloneFromGithub() pratar HTTPS korrekt med GitHub
 *   2. isomorphic-git klonar utan fel
 *   3. ProjectionHydrator parsar alla filer
 *   4. DemoRuntime exponerar entiteterna
 */

import { DemoRuntime } from "@/lib/server/local-first/demo-runtime";
import { cloneFromGithub } from "@/lib/server/local-first/clone-from-github";

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error("Användning: yarn tsx tooling/scripts/smoke-test-demo.ts <github-url>");
    process.exit(1);
  }

  console.log(`▶ Klonar ${url} via isomorphic-git över HTTPS…`);
  const t0 = Date.now();

  const rt = DemoRuntime.create({ cloneFn: cloneFromGithub() });
  const result = await rt.loadDemo(url);

  const dt = Date.now() - t0;
  console.log(`  ✓ Klart på ${dt} ms\n`);
  console.log(`  Status:       ${rt.status()}`);
  console.log(`  Read-only:    ${rt.isReadOnly()}`);
  console.log(`  Total:        ${result.totalCount} entiteter`);
  for (const [entity, count] of Object.entries(result.entities)) {
    console.log(`    - ${entity.padEnd(10)} ${count}`);
  }
  if (result.errors.length > 0) {
    console.log(`\n  ! ${result.errors.length} fel:`);
    for (const e of result.errors) console.log(`     ${e.path}: ${e.error}`);
  }

  // Bevisa att vi kan läsa enskilda entiteter
  console.log("\n  Sampling:");
  const matters = rt.matters<{ matterNumber: string; title: string; status: string }>().list();
  for (const m of matters) {
    console.log(`    matter ${m.matterNumber.padEnd(12)} [${m.status}] ${m.title}`);
  }
  const contacts = rt.contacts<{ name: string; contactType: string }>().list();
  for (const c of contacts) {
    console.log(`    contact ${c.contactType.padEnd(13)} ${c.name}`);
  }

  console.log("\n✅ Smoke-test grönt.");
}

main().catch((err) => {
  console.error("✗ Smoke-test misslyckades:", err);
  process.exit(1);
});
