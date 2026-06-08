/**
 * `seed-firma-local` — seed:ar docker-firma:n med demo-data.
 *
 * Användning:
 *     bun run seed:local
 *
 * Förutsättning: `tooling/docker/docker-compose.yml` är igång och
 * `firma.git` är nåbar på `http://localhost:8080/git/firma.git`.
 *
 * Tunn dial-tone runt demo-generatorn:
 *   1. Klona repo:t in i en temp-mapp
 *   2. `generateInto()` — driver tRPC-API:t → skriver JSON + binärer
 *   3. Commit + push tillbaka till docker
 *
 * Datan genereras via samma `generateInto()` som GH-Pages-demon → identiskt
 * dataset oavsett deploy-läge. Idempotent — tom diff: ingen commit/push.
 */

import { mkdirSync, rmSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { generateInto } from "../demo-generator/generate-into";

const REPO_URL = process.env.SEED_REPO_URL ?? "http://localhost:8080/git/firma.git";
const TMP = resolve(tmpdir(), `ava-seed-firma-${Date.now()}`);

function sh(cmd: string, opts: { cwd?: string } = {}): string {
  return execSync(cmd, { cwd: opts.cwd ?? TMP, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

async function main(): Promise<void> {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  // 1. Klona
  console.log(`[seed] klonar ${REPO_URL} → ${TMP}`);
  try {
    sh(`git clone --quiet "${REPO_URL}" .`, { cwd: TMP });
  } catch (err) {
    console.error("[seed] git clone misslyckades. Är docker igång?");
    throw err;
  }

  // 2. Rensa gamla seed-filer (annars blir det dubblettrader om id-fördelningen ändras).
  const purge = [
    ".ava/organizations", ".ava/users", ".ava/templates",
    "offices", "contacts", "matters/active", "matter-contacts",
    "documents", "document-folders",
    "time-entries", "expenses", "invoices", "payments",
    "calendar", "tasks", "conflict-checks",
    "payment-plans", "payment-plan-reminders",
  ];
  for (const p of purge) {
    const full = resolve(TMP, p);
    if (existsSync(full)) rmSync(full, { recursive: true, force: true });
  }

  // 3. Generera demo-data via tRPC-API:t (JSON + PDF/DOCX-binärer).
  console.log("[seed] genererar demo-data via API:t…");
  const result = await generateInto(TMP);
  console.log("[seed] genererat:", result);

  // 4. Commit + push
  sh(`git config user.email "seed@firma.local"`);
  sh(`git config user.name "Seed Script"`);
  sh(`git add -A`);
  const status = sh(`git status --porcelain`);
  if (!status.trim()) {
    console.log("[seed] inga ändringar — repo redan i mål-state.");
    return;
  }
  sh(`git commit -q -m "Seed demo-data: 5 users + ~15 av varje entitet"`);
  sh(`git push -q origin HEAD:main`);
  console.log(`[seed] klart — ${REPO_URL} uppdaterat.`);
  console.log(`[seed] (rensa OPFS i browsern + reload localhost:3000)`);
}

main().catch((err) => {
  console.error("[seed] FEL:", err);
  process.exit(1);
});
