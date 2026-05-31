/**
 * `build-demo-repo` — skriver demo-datafiler ovanpå ./demo-repo (eller out/)
 * redo att pushas till `ulrik-s/ava-demo` (GH-Pages-repo).
 *
 * KONSOLIDERAD: använder samma `generateInto()` som docker-firma:n + den
 * fristående generatorn → demo-mode på GitHub Pages får IDENTISKT dataset
 * (5 användare, 17 kontakter, 17 ärenden, 40 PDF/DOCX, fakturering via
 * flöden inkl avbetalningsplaner + påminnelser, 25 kalender-events, 80 tasks,
 * 6 templates, 5 jäv-historik-rader).
 *
 * Användning:
 *     yarn build:demo-repo                    # default ./demo-repo
 *     yarn build:demo-repo --dir ./custom     # alt dir
 *
 * För GH-Pages-demon används orgId="demo-firma-ab" + currentUserId="u-anna"
 * (legacy-id-namn så befintliga bokmärken funkar). E-mail-domän "ava.demo".
 */

import { mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { generateInto } from "../demo-generator/generate-into";
import {
  DEMO_ORG_ID,
  DEMO_CURRENT_USER_ID,
  DEMO_EMAIL_DOMAIN,
  DEMO_ORG_NAME,
} from "../demo-config";
import { writeDemoMeta } from "./write-demo-meta";
import { buildSeed } from "./seed-data";

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

  // 2. Generera demo-data via tRPC-API:t (JSON + PDF/DOCX-binärer) ovanpå out/.
  const result = await generateInto(outDir, {
    orgId: DEMO_ORG_ID,
    currentUserId: DEMO_CURRENT_USER_ID,
    emailDomain: DEMO_EMAIL_DOMAIN,
    organizationName: DEMO_ORG_NAME,
  });

  // 3. Skriv meta.json så web-appen kan läsa orgId + user-listan utan
  //    att hårdkoda identifierare. Använd samma translator som generateInto
  //    så UUID:n i meta matchar UUID:n i persisterad data.
  const metaSeed = buildSeed({
    orgId: DEMO_ORG_ID,
    currentUserId: DEMO_CURRENT_USER_ID,
    emailDomain: DEMO_EMAIL_DOMAIN,
    organizationName: DEMO_ORG_NAME,
  });
  const metaPath = writeDemoMeta(outDir, metaSeed, result.translator);
  console.log(`[demo-repo] meta.json → ${metaPath}`);

  console.log(`[demo-repo] klart. Innehåll i ${outDir}:`);
  console.log(`  • ${result.users} användare, ${result.contacts} kontakter, ${result.matters} ärenden`);
  console.log(`  • ${result.documents} dokument (PDF/DOCX)`);
  console.log(`  • fakturering: ${result.billing.invoices} fakturor, ${result.billing.paymentPlans} planer, ${result.billing.payments} betalningar, ${result.billing.reminders} påminnelser`);
  console.log(`  • ${result.calendarEvents} kalender-events, ${result.tasks} tasks`);
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
