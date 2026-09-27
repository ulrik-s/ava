#!/usr/bin/env bun
/**
 * Backfill av standardmapparna (#1228) — ger varje befintligt (ej tombstonat)
 * ärende de mappar i `DEFAULT_MATTER_FOLDERS` som saknas, inkl. undermappar
 * under en befintlig "Domstol". Nya ärenden får trädet direkt i `matter.create`.
 *
 * Skriver via repona med change_log påslagen → mapparna får version och
 * delta-synkas till klienterna precis som om de skapats i appen.
 *
 * Idempotent: en mapp med samma namn (skiftlägesokänsligt) under samma förälder
 * återanvänds, så en omkörning skapar ingenting nytt.
 *
 *   AVA_DATABASE_URL=postgres://… bun tooling/scripts/backfill-matter-folders.ts
 */

import { asc, isNull } from "drizzle-orm";
import { createPostgresDb } from "@/lib/server/db/client";
import { matters } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { ensureDefaultMatterFolders } from "@/lib/server/documents/default-matter-folders";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { MatterId } from "@/lib/shared/schemas/ids";

/** Resultatet av en körning. */
export interface FolderBackfillResult {
  /** Antal ärenden som gicks igenom. */
  matters: number;
  /** Antal nyskapade mappar totalt. */
  created: number;
}

/** Alla levande (ej tombstonade) ärenden, äldst först. */
export async function listLiveMatterIds(db: AppDb): Promise<MatterId[]> {
  const rows = await db.select({ id: matters.id }).from(matters)
    .where(isNull(matters.deletedAt)).orderBy(asc(matters.createdAt));
  return rows.map((r) => r.id);
}

/** Fyll i saknade standardmappar i alla ärenden (en transaktion per ärende). */
export async function backfillMatterFolders(db: AppDb): Promise<FolderBackfillResult> {
  const repos = buildDrizzleRepositories(db);
  enableChangeLogOnAll(repos, createDbChangeLogRecorder(db)); // → pull-bart för klienterna
  const ids = await listLiveMatterIds(db);
  let created = 0;
  for (const matterId of ids) {
    created += await repos.transaction((tx) => ensureDefaultMatterFolders(tx, matterId));
  }
  return { matters: ids.length, created };
}

/** Anslutningen backfillen behöver — injicerbar i tester. */
export interface FolderBackfillConnection {
  db: AppDb;
  close: () => Promise<void>;
}

/** Produktion: en Postgres-anslutning (lazy — ansluter vid första frågan). */
export function connect(url: string): Promise<FolderBackfillConnection> {
  return Promise.resolve(createPostgresDb(url, { max: 1 }));
}

/** Postgres-URL ur första argumentet eller AVA_DATABASE_URL. */
export function resolveUrl(argv: readonly string[], env: Record<string, string | undefined>): string | undefined {
  return argv[0] ?? env.AVA_DATABASE_URL;
}

/** Anslut, fyll i, stäng (även vid fel). */
export async function runFolderBackfill(
  url: string, open: (url: string) => Promise<FolderBackfillConnection> = connect,
): Promise<FolderBackfillResult> {
  const conn = await open(url);
  try {
    return await backfillMatterFolders(conn.db);
  } finally {
    await conn.close();
  }
}

/** CLI-flödet; skrivare injicerbara i tester. Returnerar exit-koden. */
export async function main(
  argv: readonly string[], env: Record<string, string | undefined>,
  out: (s: string) => void, err: (s: string) => void,
  open: (url: string) => Promise<FolderBackfillConnection> = connect,
): Promise<number> {
  const url = resolveUrl(argv, env);
  if (!url) {
    err("backfill-matter-folders: ange Postgres-URL via AVA_DATABASE_URL eller argument\n");
    return 1;
  }
  const r = await runFolderBackfill(url, open);
  out(`backfill-matter-folders: ${r.created} mappar skapade i ${r.matters} ärenden\n`);
  return 0;
}

// Kör bara som script (inte vid import i tester).
if (import.meta.main) {
  main(process.argv.slice(2), process.env, (s) => process.stdout.write(s), (s) => process.stderr.write(s))
    .then((code) => { process.exitCode = code; })
    .catch((e: unknown) => {
      process.stderr.write(`backfill-matter-folders: ${String(e)}\n`);
      process.exitCode = 1;
    });
}
