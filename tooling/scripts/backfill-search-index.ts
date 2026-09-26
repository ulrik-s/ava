#!/usr/bin/env bun
/**
 * Backfill av fulltextindexet (#1215) — köar ett `index-document`-jobb per
 * levande dokument, så dokument som laddades upp INNAN `document_pages` fanns
 * blir sökbara. Server-first-runtimens worker gör jobbet: den har content-
 * store:n (bytes) och skriver sidtexten. Skriptet rör bara kön — det läser
 * inga bytes och kräver därför ingen åtkomst till AVA_CONTENT_DIR.
 *
 * `index-document` klassificerar INTE om (dokumenttyper användaren rättat
 * skrivs inte över). Idempotent: `singletonKey = documentId` → som mest ett
 * väntande jobb per dokument; en omkörning ersätter bara sidorna igen.
 * Dokument vars bytes saknas i content-store:n blir tysta no-ops.
 *
 *   AVA_DATABASE_URL=postgres://… bun tooling/scripts/backfill-search-index.ts
 *
 * `--reclassify` (#1220): köa `classify-document` i stället — indexerar sidorna
 * OCH kör om klassificering + segmentering, så befintliga dokument får DELAR
 * (kallelse + stämning + FUP …). Jobbet skriver inte över användarens val:
 *   - specialvärden i documentType (Kostnadsräkning, E-post, fritext) rörs inte
 *     och får inga delar;
 *   - en kategori användaren satt (en kod som servern aldrig analyserat och som
 *     inte är filnamnsgissningen) behålls och blir EN manuell del;
 *   - MANUAL-delar (rättade i panelen) bevaras så länge sidantalet är samma.
 *
 *   AVA_DATABASE_URL=postgres://… bun tooling/scripts/backfill-search-index.ts --reclassify
 *
 * Kör EFTER db:migrate (0026) och efter att server-first startats om med
 * #1215 (annars finns ingen worker på kön än — jobben väntar då kvar).
 */

import { asc, isNull } from "drizzle-orm";
import { createPostgresDb } from "@/lib/server/db/client";
import { documents } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { createJobQueue, JOB_QUEUES, startJobQueue } from "@/lib/server/jobs/job-queue";
import type { DocumentId } from "@/lib/shared/schemas/ids";

/** Den del av pg-boss backfillen använder (`PgBoss` uppfyller den). */
export interface JobSender {
  send(name: string, data: object, options: { singletonKey: string }): Promise<string | null>;
}

/** Alla levande (ej tombstonade) dokument, äldst först. */
export async function listIndexableDocumentIds(db: AppDb): Promise<DocumentId[]> {
  const rows = await db.select({ id: documents.id }).from(documents)
    .where(isNull(documents.deletedAt)).orderBy(asc(documents.createdAt));
  return rows.map((r) => r.id);
}

/** Kön backfillen köar på: bara indexering, eller omklassificering + delar (#1220). */
export type BackfillQueue = typeof JOB_QUEUES.indexDocument | typeof JOB_QUEUES.classifyDocument;

/** Köa ett jobb per dokument (default `index-document`). Returnerar antalet köade. */
export async function enqueueBackfill(db: AppDb, sender: JobSender, queue: BackfillQueue = JOB_QUEUES.indexDocument): Promise<number> {
  const ids = await listIndexableDocumentIds(db);
  for (const documentId of ids) {
    await sender.send(queue, { documentId }, { singletonKey: documentId });
  }
  return ids.length;
}

/** Anslutningarna backfillen behöver — injicerbara i tester. */
export interface BackfillConnections {
  db: AppDb;
  sender: JobSender;
  close: () => Promise<void>;
}

/** Produktion: Postgres (en connection) + en startad pg-boss mot samma db. */
async function connect(url: string): Promise<BackfillConnections> {
  const { db, close } = createPostgresDb(url, { max: 1 });
  const boss = createJobQueue({ connectionString: url });
  await startJobQueue(boss); // idempotent: skapar köerna (inkl. index-document) om de saknas
  return { db, sender: boss, close: async () => { await boss.stop({ graceful: true }); await close(); } };
}

/** Postgres-URL ur första icke-flagg-argumentet eller AVA_DATABASE_URL. */
export function resolveUrl(argv: readonly string[], env: Record<string, string | undefined>): string | undefined {
  return argv.find((a) => !a.startsWith("--")) ?? env.AVA_DATABASE_URL;
}

/** Kön för argumenten: `--reclassify` → classify-document, annars index-document. */
export function resolveQueue(argv: readonly string[]): BackfillQueue {
  return argv.includes("--reclassify") ? JOB_QUEUES.classifyDocument : JOB_QUEUES.indexDocument;
}

/** Anslut, köa, stäng. Returnerar antalet köade dokument. */
export async function runBackfill(
  url: string, open: (url: string) => Promise<BackfillConnections> = connect, queue: BackfillQueue = JOB_QUEUES.indexDocument,
): Promise<number> {
  const conn = await open(url);
  try {
    return await enqueueBackfill(conn.db, conn.sender, queue);
  } finally {
    await conn.close();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const url = resolveUrl(argv, process.env);
  if (!url) {
    process.stderr.write("backfill-search-index: ange Postgres-URL via AVA_DATABASE_URL eller argument\n");
    process.exitCode = 1;
    return;
  }
  const queue = resolveQueue(argv);
  const n = await runBackfill(url, connect, queue);
  process.stdout.write(`backfill-search-index: ${n} dokument köade på ${queue}\n`);
}

// Kör bara som script (inte vid import i tester).
if (import.meta.main) {
  main().catch((err: unknown) => {
    process.stderr.write(`backfill-search-index: ${String(err)}\n`);
    process.exitCode = 1;
  });
}
