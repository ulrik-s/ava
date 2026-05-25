/**
 * `seed-firma-local` — seed:ar docker-firma:n med demo-data.
 *
 * Användning:
 *     yarn seed:local
 *
 * Förutsättning: `tooling/docker/docker-compose.yml` är igång och
 * `firma.git` är nåbar på `http://localhost:8080/git/firma.git`.
 *
 * Data:n kommer från `seed-data.ts` (delas med integrationstesten).
 * Detta script är tunn dial-tone runt:
 *   1. Klona repo:t in i en temp-mapp
 *   2. Skriv ut JSON-filer från `buildSeed()`
 *   3. Commit + push tillbaka till docker
 *
 * Idempotent — om diff:en är tom: ingen commit, ingen push.
 */

import { mkdirSync, rmSync, existsSync, writeFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildSeed, seedToFiles, generateDocumentBytes } from "./seed-data";

const REPO_URL = process.env.SEED_REPO_URL ?? "http://localhost:8080/git/firma.git";
const TMP = resolve(tmpdir(), `ava-seed-firma-${Date.now()}`);

function sh(cmd: string, opts: { cwd?: string } = {}): string {
  return execSync(cmd, { cwd: opts.cwd ?? TMP, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

function writeJson(path: string, data: unknown): void {
  const full = resolve(TMP, path);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, JSON.stringify(data, null, 2) + "\n");
}

// eslint-disable-next-line complexity
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
    "time-entries", "expenses", "invoices",
    "calendar", "tasks", "conflict-checks",
  ];
  for (const p of purge) {
    const full = resolve(TMP, p);
    if (existsSync(full)) rmSync(full, { recursive: true, force: true });
  }

  // 3. Generera + skriv binärfiler för dokument FÖRST (så vi kan fylla i
  //    `sizeBytes` på JSON-metadata-raden innan vi serialiserar.)
  const seed = buildSeed();
  console.log(`[seed] genererar ${seed.documents.length} dokumentfiler (PDF/DOCX)`);
  for (const doc of seed.documents) {
    const d = doc as { id: string; storagePath?: string; title?: string; summary?: string; fileName?: string; documentType?: string; mimeType?: string };
    if (!d.storagePath) continue;
    const bytes = await generateDocumentBytes(d);
    const full = resolve(TMP, d.storagePath);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, bytes);
    // Uppdatera sizeBytes på raden så filtoolbarn visar rätt storlek
    (doc as Record<string, unknown>).sizeBytes = statSync(full).size;
  }

  const files = seedToFiles(seed);
  console.log(`[seed] skriver ${files.length} JSON-rader`);
  for (const f of files) writeJson(f.path, f.data);

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
