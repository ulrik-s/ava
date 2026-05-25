/**
 * `build-demo-repo` — bygger ./demo-repo redo att pushas till
 * `ulrik-s/ava-demo` (eller motsvarande GH-Pages-repo).
 *
 * KONSOLIDERAD: använder samma `buildSeed()` som docker-firma:n får, så
 * demo-mode på GitHub Pages innehåller IDENTISKT rikt dataset:
 *   • 5 användare (Anna ADMIN + 4 advokater/biträden)
 *   • 17 kontakter, 15 ärenden, 18 docs-rader
 *   • 20 PDF + 20 DOCX binärfiler (genereras via pdf-lib + html-to-docx)
 *   • 7 avbetalningsplaner + 20 payments + 18 reminders
 *   • 25 kalender-events över alla användare + 12 tasks
 *   • 5 templates + 5 jäv-historik-rader
 *
 * Användning:
 *     yarn build:demo-repo                    # default ./demo-repo
 *     yarn build:demo-repo --dir ./custom     # alt dir
 *
 * För GH-Pages-demon används orgId="demo-firma-ab" + currentUserId="u-anna"
 * (legacy-id-namn så befintliga bokmärken funkar). E-mail-domän "ava.demo".
 */

import { mkdirSync, rmSync, existsSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildSeed, seedToFiles, generateDocumentBytes } from "./seed-data";

const DEMO_ORG_ID = "demo-firma-ab";
const DEMO_CURRENT_USER_ID = "u-anna";
const DEMO_EMAIL_DOMAIN = "ava.demo";
const DEMO_ORG_NAME = "Demo Advokatbyrå AB";

function parseDirArg(): string {
  const idx = process.argv.indexOf("--dir");
  return idx > 0 && process.argv[idx + 1] ? process.argv[idx + 1] : "./demo-repo";
}

async function main(): Promise<void> {
  const outDir = resolve(process.cwd(), parseDirArg());
  console.log(`[demo-repo] mål: ${outDir}`);

  // 1. Säkerställ att out-dir finns. Vi rensar INTE eventuella befintliga
  //    filer eftersom build-demo.sh kör detta script EFTER `next build`
  //    → out/ innehåller redan app:en. Vi ska bara LÄGGA TILL data-filer
  //    ovanpå.
  //
  //    Däremot rensar vi seed-data-FILERNA (json-rader) ur de specifika
  //    mapparna så obsoleta entiteter från tidigare körningar inte hänger
  //    med. VIKTIGT: vi raderar inte hela mapparna eftersom flera av dem
  //    KOLLIDERAR med Next:s static-export-routes (out/calendar/index.html
  //    delar dir med out/calendar/cal-*.json). Vi raderar bara .json-filer.
  mkdirSync(outDir, { recursive: true });
  const dataDirs = [
    ".ava/organizations", ".ava/users", ".ava/templates",
    "offices", "contacts", "matters/active", "matter-contacts",
    "documents", "document-folders",
    "time-entries", "expenses", "invoices", "payments",
    "calendar", "tasks", "conflict-checks",
    "payment-plans", "payment-plan-reminders",
  ];
  for (const d of dataDirs) {
    const full = resolve(outDir, d);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full)) {
      if (entry.endsWith(".json")) {
        rmSync(resolve(full, entry), { force: true });
      }
    }
  }

  // 2. Bygg dataset med demo-args
  const seed = buildSeed({
    orgId: DEMO_ORG_ID,
    currentUserId: DEMO_CURRENT_USER_ID,
    emailDomain: DEMO_EMAIL_DOMAIN,
    organizationName: DEMO_ORG_NAME,
  });

  // 3. Generera dokument-binärer FÖRST så vi kan uppdatera sizeBytes
  //    på metadata-raden innan vi serialiserar JSON:erna.
  console.log(`[demo-repo] genererar ${seed.documents.length} dokumentfiler (PDF/DOCX)`);
  for (const doc of seed.documents) {
    const d = doc as { id: string; storagePath?: string; title?: string; summary?: string; fileName?: string; documentType?: string; mimeType?: string };
    if (!d.storagePath) continue;
    const bytes = await generateDocumentBytes(d);
    const full = resolve(outDir, d.storagePath);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, bytes);
    (doc as Record<string, unknown>).sizeBytes = statSync(full).size;
  }

  // 4. Skriv ut JSON-rader för alla entiteter
  const files = seedToFiles(seed);
  console.log(`[demo-repo] skriver ${files.length} JSON-rader`);
  for (const f of files) {
    const full = resolve(outDir, f.path);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, JSON.stringify(f.data, null, 2) + "\n");
  }

  console.log(`[demo-repo] klart. Innehåll i ${outDir}:`);
  console.log(`  • ${seed.users.length} användare`);
  console.log(`  • ${seed.contacts.length} kontakter`);
  console.log(`  • ${seed.matters.length} ärenden`);
  console.log(`  • ${seed.documents.length} dokument (PDF/DOCX)`);
  console.log(`  • ${seed.paymentPlans.length} avbetalningsplaner, ${seed.payments.length} payments`);
  console.log(`  • ${seed.calendarEvents.length} kalender-events, ${seed.tasks.length} tasks`);
  console.log("");
  console.log("Nästa steg (om du vill pusha till ulrik-s/ava-demo):");
  console.log("  cd " + outDir);
  console.log("  git init && git add -A");
  console.log("  git commit -m \"Demo seed: rich dataset (5 users, payment plans, 40 documents)\"");
  console.log("  git remote add origin git@github.com:ulrik-s/ava-demo.git");
  console.log("  git push -fu origin main");
}

main().catch((err) => {
  console.error("[demo-repo] FEL:", err);
  process.exit(1);
});
