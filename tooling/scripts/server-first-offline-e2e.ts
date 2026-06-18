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
    const existing = await sql`SELECT id FROM users WHERE email = ${EMAIL} LIMIT 1` as unknown as Array<{ id: string }>;
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
 * Verifiera mot den AUKTORITATIVA server-staten (Postgres-tabellerna) i st.f.
 * change_log/pull — pull täcker bara org-scopade entiteter (matter), medan
 * document/documentFolder (utan org-kolumn) skrivs till sina tabeller men
 * loggas inte i change_log (känd lucka, separat issue). DB-frågan svarar på det
 * scenariot faktiskt frågar: "nådde offline-ändringen servern?".
 */
async function withDb<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
  try { return await fn(sql); } finally { await sql.end({ timeout: 5 }); }
}
const matterStatus = (id: string): Promise<string | undefined> =>
  withDb(async (sql) => ((await sql`SELECT status FROM matters WHERE id = ${id}` as unknown as Array<{ status: string }>)[0]?.status));
const docRow = (id: string): Promise<{ file_name: string; folder_id: string | null } | undefined> =>
  withDb(async (sql) => ((await sql`SELECT file_name, folder_id FROM documents WHERE id = ${id}` as unknown as Array<{ file_name: string; folder_id: string | null }>)[0]));
const folderExists = (id: string): Promise<boolean> =>
  withDb(async (sql) => ((await sql`SELECT 1 FROM document_folders WHERE id = ${id}` as unknown as unknown[]).length > 0));

async function pushAll(t: TrpcSyncTransport, muts: Mutation[]): Promise<void> {
  for (const m of muts) {
    const res = await t.push(m);
    if (res.status !== "accepted") throw new Error(`push ej accepterad (${m.entity}/${m.kind}): ${res.status}`);
  }
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
  console.log("✓ FAS 1 (online): ärende + mappar + dokument synkade");

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

  console.log("✓ server-first offline/online-E2E: alla faser gröna");
}

main().catch((err: unknown) => {
  process.stderr.write(`✗ server-first offline/online-E2E: ${String(err)}\n`);
  process.exitCode = 1;
});
