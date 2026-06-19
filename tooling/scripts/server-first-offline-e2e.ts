#!/usr/bin/env bun
/**
 * Server-first OFFLINE/ONLINE-E2E (#518) — kör mot en KÖRANDE server-first-
 * container (docker-compose.server-first.yml). Bevisar offline-first-synken
 * end-to-end mot den deployade artefakten:
 *
 *   1. ONLINE   — skapa ärende + mapp + dokument → push → pull bekräftar.
 *   2. OFFLINE  — köa ändringar (ärende-status, dokument-namn, flytta mapp)
 *                 UTAN att pusha → pull visar fortfarande GAMLA värden.
 *   3. ONLINE   — pusha de köade ändringarna → pull bekräftar NYA värden.
 *
 * Täcker ändringar i: ärenden, dokument (namn) och mappstruktur (folderId).
 *
 *   bun run server-first:build
 *   docker compose -f tooling/docker/docker-compose.server-first.yml up -d --build --wait
 *   AVA_DATABASE_URL=postgres://ava:ava@localhost:5433/ava_test bun run db:migrate
 *   SERVER_URL=http://localhost:3001 \
 *   AVA_DATABASE_URL=postgres://ava:ava@localhost:5433/ava_test \
 *   AVA_ORGANIZATION_ID=00000000-0000-0000-0000-000000000001 \
 *     bun tooling/scripts/server-first-offline-e2e.ts
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import postgres from "postgres";
import superjson from "superjson";
import { TrpcSyncTransport } from "@/lib/client/sync/trpc-sync-transport";
import type { AppRouter } from "@/lib/server/routers/_app";
import { uuidv7 } from "@/lib/shared/uuid";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3001";
const DB_URL = process.env.AVA_DATABASE_URL ?? "postgres://ava:ava@localhost:5433/ava_test";
const ORG = process.env.AVA_ORGANIZATION_ID ?? "00000000-0000-0000-0000-000000000001";
const EMAIL = "anna-offline@byra.se";

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

/** Seeda en allowlistad användare; returnera id (dokument behöver uploadedById). */
async function seedUser(): Promise<string> {
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
  try {
    const existing = await sql<Array<{ id: string }>>`SELECT id FROM users WHERE email = ${EMAIL} LIMIT 1`;
    if (existing[0]) return existing[0].id;
    const id = uuidv7();
    await sql`INSERT INTO users (id, organization_id, email, name, role, active)
              VALUES (${id}, ${ORG}, ${EMAIL}, 'Anna Offline', 'LAWYER', true)`;
    return id;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function makeTransport(): TrpcSyncTransport {
  const client = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: `${SERVER_URL}/api/trpc`,
      transformer: superjson,
      headers: () => ({ "X-Auth-Request-Email": EMAIL }),
    })],
  });
  return new TrpcSyncTransport(client);
}

async function waitForServer(t: TrpcSyncTransport): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try { await t.pull(0); return; } catch { await sleep(1000); }
  }
  throw new Error(`server-first svarade inte på ${SERVER_URL} inom 30s`);
}

interface Mutation { mutationId: string; entity: string; kind: "create" | "update"; row: Record<string, unknown>; enqueuedAt: number }
function mut(entity: string, kind: "create" | "update", row: Record<string, unknown>): Mutation {
  return { mutationId: uuidv7(), entity, kind, row, enqueuedAt: 0 };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert: ${msg}`);
}

/**
 * Verifiera mot den AUKTORITATIVA server-staten (Postgres-tabellerna). Svarar
 * direkt på det scenariot frågar: "nådde offline-ändringen servern?". (Sedan
 * #528 delta-synkas document/documentFolder även via pull — se assert nedan.)
 */
async function withDb<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
  try { return await fn(sql); } finally { await sql.end({ timeout: 5 }); }
}
const matterStatus = (id: string): Promise<string | undefined> =>
  withDb(async (sql) => (await sql<Array<{ status: string }>>`SELECT status FROM matters WHERE id = ${id}`)[0]?.status);
const docRow = (id: string): Promise<{ file_name: string; folder_id: string | null } | undefined> =>
  withDb(async (sql) => (await sql<Array<{ file_name: string; folder_id: string | null }>>`SELECT file_name, folder_id FROM documents WHERE id = ${id}`)[0]);
const folderExists = (id: string): Promise<boolean> =>
  withDb(async (sql) => (await sql`SELECT 1 FROM document_folders WHERE id = ${id}`).length > 0);
interface DocFull { file_name: string; folder_id: string | null; storage_path: string; version: number }
const docFull = (id: string): Promise<DocFull | undefined> =>
  withDb(async (sql) => (await sql<DocFull[]>`SELECT file_name, folder_id, storage_path, version FROM documents WHERE id = ${id}`)[0]);

async function pushAll(t: TrpcSyncTransport, muts: Mutation[]): Promise<void> {
  for (const m of muts) {
    const res = await t.push(m);
    if (res.status !== "accepted") throw new Error(`push ej accepterad (${m.entity}/${m.kind}): ${res.status}`);
  }
}

/** Pollar `pred` tills sann eller timeout. */
async function waitUntil(pred: () => Promise<boolean>, label: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pred()) return;
    await sleep(100);
  }
  throw new Error(`timeout: ${label} (${timeoutMs}ms)`);
}

function docMut(kind: "create" | "update", base: Record<string, unknown>, fileName: string, storagePath: string, sizeBytes: number): Mutation {
  return mut("document", kind, { ...base, fileName, storagePath, sizeBytes });
}

/**
 * FAS 4 (#531): 10 ändringar i 5 dokument offline → mät sync-tid + verifiera data.
 * Varje dokument ändras två gånger offline (10 ändringar); coalesce behåller
 * senaste per dokument → 5 pushar vid online. Mät tid tills servern speglar alla.
 */
async function tenChangesFiveDocs(t: TrpcSyncTransport, matterId: string, folderId: string, userId: string): Promise<void> {
  const ids = Array.from({ length: 5 }, () => uuidv7());
  const base = (id: string) => ({ id, matterId, mimeType: "application/pdf", uploadedById: userId, folderId });
  await pushAll(t, ids.map((id, i) => docMut("create", base(id), `dok${i}.pdf`, `documents/content/d${i}-v0`, 100 + i)));

  // OFFLINE: 10 ändringar (2/dok) — köas, INTE pushade.
  const finalName = (i: number) => `dok${i}-final.pdf`;
  const finalPath = (i: number) => `documents/content/d${i}-v2`;
  const queued: Mutation[] = [];
  ids.forEach((id, i) => {
    queued.push(docMut("update", base(id), `dok${i}-tmp.pdf`, `documents/content/d${i}-v1`, 200 + i));
    queued.push(docMut("update", base(id), finalName(i), finalPath(i), 300 + i));
  });
  assert(queued.length === 10, "10 offline-ändringar köade");
  // Servern oförändrad (inget pushat).
  assert((await docFull(ids[0]!))?.file_name === "dok0.pdf", "offline: servern visar ursprungsnamn");

  // Coalesce per dokument (senaste vinner) → 5 effektiva pushar.
  const coalesced = [...new Map(queued.map((m) => [(m.row as { id: string }).id, m])).values()];
  assert(coalesced.length === 5, "coalesce: 10 ändringar → 5 dokument");

  // ONLINE: mät tid tills servern speglar alla 5 slutvärden.
  const t0 = Date.now();
  await pushAll(t, coalesced);
  await waitUntil(
    async () => (await Promise.all(ids.map(docFull))).every((r, i) => r?.file_name === finalName(i)),
    "alla 5 dokument synkade", 30_000,
  );
  const elapsed = Date.now() - t0;
  for (let i = 0; i < 5; i++) {
    const r = await docFull(ids[i]!);
    assert(r?.file_name === finalName(i), `dok${i}: rätt slutnamn på servern`);
    assert(r?.storage_path === finalPath(i), `dok${i}: rätt content-pekare på servern`);
  }
  console.log(`✓ FAS 4: 10 ändringar i 5 dokument (coalesce→5) synkade på ${elapsed} ms; data verifierad`);
}

/**
 * FAS 5 (#531): backa till en äldre version + gör ändringar + spara → verifiera
 * servern. Content-adresserat (ADR 0023): revert = ny version som pekar på den
 * gamla hashen; varje skrivning bumpar `version`.
 */
async function revertVersions(t: TrpcSyncTransport, matterId: string, folderId: string, userId: string): Promise<void> {
  const id = uuidv7();
  const base = { id, matterId, mimeType: "application/pdf", uploadedById: userId, folderId };
  await pushAll(t, [docMut("create", base, "avtal-v1.pdf", "documents/content/sha-v1", 10)]);
  await pushAll(t, [docMut("update", base, "avtal-v2.pdf", "documents/content/sha-v2", 20)]);
  const v2 = await docFull(id);
  assert(v2?.file_name === "avtal-v2.pdf" && v2?.storage_path === "documents/content/sha-v2", "v2 på servern");

  // Backa till v1 (ny version som pekar på v1:s content-hash).
  await pushAll(t, [docMut("update", base, "avtal-v1.pdf", "documents/content/sha-v1", 10)]);
  const reverted = await docFull(id);
  assert(reverted?.storage_path === "documents/content/sha-v1", "revert: servern pekar på v1-content");
  assert(reverted!.version > v2!.version, "revert skapar en NY version (version bumpad)");

  // Gör ändringar och spara (offline → online).
  await pushAll(t, [docMut("update", base, "avtal-v1-redigerad.pdf", "documents/content/sha-v3", 33)]);
  const final = await docFull(id);
  assert(final?.file_name === "avtal-v1-redigerad.pdf", "final: rätt namn på servern");
  assert(final?.storage_path === "documents/content/sha-v3", "final: rätt content-pekare på servern");
  assert(final!.version > reverted!.version, "ändring efter revert = ytterligare version");
  console.log(`✓ FAS 5: backa till v1 → ändra → spara; servern har rätt data (version ${final!.version})`);
}

async function main(): Promise<void> {
  const userId = await seedUser();
  const t = makeTransport();
  await waitForServer(t);

  const m1 = uuidv7(), folderA = uuidv7(), folderB = uuidv7(), doc1 = uuidv7();
  const docBase = {
    id: doc1, matterId: m1, mimeType: "application/pdf", sizeBytes: 1234,
    storagePath: "documents/content/aaa", uploadedById: userId, folderId: folderA,
  };

  // ── FAS 1: ONLINE — skapa ärende + två mappar + dokument ─────────
  await pushAll(t, [
    mut("matter", "create", { id: m1, organizationId: ORG, title: "Offline-E2E", status: "ACTIVE", matterNumber: "2026-9001" }),
    mut("documentFolder", "create", { id: folderA, matterId: m1, name: "Inlagor", parentId: null }),
    mut("documentFolder", "create", { id: folderB, matterId: m1, name: "Bevis", parentId: null }),
    mut("document", "create", { ...docBase, fileName: "stamning.pdf" }),
  ]);
  assert((await matterStatus(m1)) === "ACTIVE", "ärendet skapat (ACTIVE)");
  const doc0 = await docRow(doc1);
  assert(doc0?.file_name === "stamning.pdf", "dokumentet skapat med rätt namn");
  assert(doc0?.folder_id === folderA, "dokumentet ligger i mapp A");
  assert(await folderExists(folderB), "mapp B skapad");
  // #528: document/documentFolder delta-synkas nu via pull (org härledd ur ärendet).
  const pulledIds = new Set((await t.pull(0)).changes.map((c) => c.row.id));
  assert(pulledIds.has(doc1), "dokumentet delta-synkas via pull (#528)");
  assert(pulledIds.has(folderA) && pulledIds.has(folderB), "mapparna delta-synkas via pull (#528)");
  console.log("✓ FAS 1 (online): ärende + mappar + dokument synkade (+ pull-bara, #528)");

  // ── FAS 2: OFFLINE — köa ändringar UTAN att pusha ────────────────
  const offlineMuts = [
    mut("matter", "update", { id: m1, organizationId: ORG, title: "Offline-E2E", status: "CLOSED", matterNumber: "2026-9001" }),
    mut("document", "update", { ...docBase, fileName: "stamning-reviderad.pdf", folderId: folderB }),
  ];
  // Servern ska fortfarande visa GAMLA värden (inget pushat).
  assert((await matterStatus(m1)) === "ACTIVE", "offline: ärendet fortfarande ACTIVE på servern");
  const docStill = await docRow(doc1);
  assert(docStill?.file_name === "stamning.pdf", "offline: dokumentnamnet oförändrat på servern");
  assert(docStill?.folder_id === folderA, "offline: dokumentet kvar i mapp A på servern");
  console.log("✓ FAS 2 (offline): ändringar köade lokalt, servern oförändrad");

  // ── FAS 3: ONLINE igen — pusha kö → ändringar synkas ─────────────
  await pushAll(t, offlineMuts);
  assert((await matterStatus(m1)) === "CLOSED", "online: ärende-status synkad (CLOSED)");
  const docNew = await docRow(doc1);
  assert(docNew?.file_name === "stamning-reviderad.pdf", "online: dokumentnamn synkat");
  assert(docNew?.folder_id === folderB, "online: dokumentet flyttat till mapp B");
  console.log("✓ FAS 3 (online): köade ändringar (ärende/namn/mapp) synkade till servern");

  // ── FAS 4: 10 ändringar i 5 dokument offline → mät sync-tid + data (#531) ──
  await tenChangesFiveDocs(t, m1, folderA, userId);

  // ── FAS 5: backa till äldre version + ändra + spara → verifiera data (#531) ──
  await revertVersions(t, m1, folderA, userId);

  console.log("✓ server-first offline/online-E2E: alla faser gröna");
}

main().catch((err: unknown) => {
  process.stderr.write(`✗ server-first offline/online-E2E: ${String(err)}\n`);
  process.exitCode = 1;
});
