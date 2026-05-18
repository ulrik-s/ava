/**
 * Migrationsverktyg: Postgres → git working tree.
 *
 * Engångsoperationen som en byrå kör när de byter från server-läget
 * till local-first. Tar en `--org <id>` att exportera, initierar ett
 * git-repo i `--dir <path>`, och kör `PostgresExporter` följt av en
 * initial commit + valfri push.
 *
 * Användning:
 *
 *     yarn migrate:pg-to-git \
 *         --org cm09abc... \
 *         --dir ~/ava-clones/firma-x \
 *         [--push ssh://git@server/srv/git/firma-x.git]
 *
 * Steget är idempotent — om mappen redan har commits ovanpå init
 * läggs en ny commit som "uppdatering". Annars en initial commit.
 */

import { mkdir, access } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/server/db";
import { NodeFileSystem } from "@/server/local-first/node-fs";
import { NodeGitOps } from "@/server/local-first/node-git-ops";
import { PostgresExporter } from "@/server/local-first/postgres-exporter";
import { buildDefaultRegistry } from "@/server/local-first/projections/default-registry";
import * as dotenv from "dotenv";

const execFileP = promisify(execFile);
dotenv.config({ path: ".env.local" });
dotenv.config();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function dirExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function main(): Promise<void> {
  const orgId = arg("--org");
  const dirArg = arg("--dir");
  const pushUrl = arg("--push");

  if (!orgId || !dirArg) {
    console.error("Användning: yarn migrate:pg-to-git --org <orgId> --dir <path> [--push <git-url>]");
    process.exit(1);
  }

  const dir = resolve(dirArg);
  console.log(`▶ Exporterar byrå ${orgId} till ${dir}`);

  await mkdir(dir, { recursive: true });

  // Initialisera git om mappen är fräsch
  const alreadyGit = await dirExists(`${dir}/.git`);
  if (!alreadyGit) {
    await execFileP("git", ["init", "--quiet", "--initial-branch=main"], { cwd: dir });
    console.log("  ✓ git init");
  }

  // Exportera data via PostgresExporter
  const fs = new NodeFileSystem(dir);
  const exporter = new PostgresExporter(prisma, fs, buildDefaultRegistry());
  const result = await exporter.exportOrganization(orgId);

  console.log(`  ✓ Export klar: ${result.totalCount} entiteter`);
  for (const [entity, count] of Object.entries(result.entities)) {
    console.log(`     - ${entity}: ${count}`);
  }
  if (result.errors.length > 0) {
    console.warn(`  ! ${result.errors.length} fel under export:`);
    for (const e of result.errors.slice(0, 5)) console.warn(`     ${e.entity}/${e.id}: ${e.error}`);
  }

  // Commit
  const git = new NodeGitOps(dir, "ava-migrator", "migrator@ava.local");
  const message = alreadyGit
    ? `Re-export från Postgres (${result.totalCount} entiteter)`
    : `Initial import från Postgres (${result.totalCount} entiteter)`;
  await git.commit(message);
  console.log(`  ✓ Commit: ${message}`);

  // Push (optional)
  if (pushUrl) {
    // Lägg till remote om den saknas
    try {
      await execFileP("git", ["remote", "add", "origin", pushUrl], { cwd: dir });
    } catch {
      // remote finns redan
    }
    await execFileP("git", ["push", "-u", "origin", "main"], { cwd: dir });
    console.log(`  ✓ Pushad till ${pushUrl}`);
  } else {
    console.log("  • Hoppat över push (--push ej satt)");
  }

  await prisma.$disconnect();
  console.log("\n✅ Klart.");
}

main().catch((err) => {
  console.error("✗ Migration misslyckades:", err);
  void prisma.$disconnect().catch(() => {});
  process.exit(1);
});
