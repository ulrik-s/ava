#!/usr/bin/env bun
/**
 * Server-first DOKUMENT-PIPELINE-E2E — kör mot en KÖRANDE server-first-container
 * (docker-compose.server-first.yml). Bevisar HELA dokument-arbetsflödet
 * end-to-end mot den deployade artefakten, inkl. server-side-klassificering och
 * fler-användar-synlighet — det som `server-first-offline-e2e.ts` INTE täcker
 * (den synkar via push/pull men kör aldrig content-upload → analyze-jobbet → en
 * andra användare).
 *
 *   ANVÄNDARE A:
 *     1. skapar ett ärende + registrerar ett dokument
 *     2. laddar upp innehåll (`document.uploadContent`, base64) → content-
 *        adresserad lagring + version-bump + `analyze`-jobb köas (pg-boss)
 *     3. server-side klassificering (filnamns-heuristik i Fas 2; ollama via
 *        `--profile llm` + AVA_LLM_* i Fas 3, fail-soft till heuristiken) skriver
 *        `documentType` + `analysisStatus=DONE`
 *     4. redigerar (ny uppladdning) → version bumpas igen + om-klassificeras
 *   ANVÄNDARE B (annan principal, samma org):
 *     5. ser dokumentet med SENASTE versionen + klassificeringen
 *
 * LLM: utan ollama är klassificeringen deterministisk (filnamns-heuristik →
 * STAMNING) och assert:as exakt. Med ollama (E2E_LLM=1, `--llm`-wrappern) är
 * den INTE deterministisk — en liten modell kan svara med en annan giltig
 * kategori (sett: qwen2.5:0.5b → AVTAL) UTAN att falla tillbaka på heuristiken
 * (den triggar bara på skräp/okänt). Då assert:as bara att klassificeringen
 * kört (giltig KNOWN_KIND) + att båda användarna ser SAMMA kategori.
 *
 *   bun run server-first:build
 *   docker compose -f tooling/docker/docker-compose.server-first.yml up -d --build --wait
 *   AVA_DATABASE_URL=postgres://ava:ava@localhost:5433/ava_test bun run db:migrate
 *   SERVER_URL=http://localhost:3001 \
 *   AVA_DATABASE_URL=postgres://ava:ava@localhost:5433/ava_test \
 *   AVA_ORGANIZATION_ID=00000000-0000-0000-0000-000000000001 \
 *     bun tooling/scripts/document-pipeline-e2e.ts
 */

import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import postgres from "postgres";
import superjson from "superjson";
import type { AppRouter } from "@/lib/server/routers/_app";
import { KNOWN_KINDS } from "@/lib/shared/document-kind";
import { uuidv7 } from "@/lib/shared/uuid";

/** Dokument-formen som `document.tree` returnerar (inferrad ur routern). */
type DocRow = inferRouterOutputs<AppRouter>["document"]["tree"]["documents"][number];

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3001";
const DB_URL = process.env.AVA_DATABASE_URL ?? "postgres://ava:ava@localhost:5433/ava_test";
const ORG = process.env.AVA_ORGANIZATION_ID ?? "00000000-0000-0000-0000-000000000001";

const USER_A = "anna-pipeline@byra.se";
const USER_B = "bjorn-pipeline@byra.se";
/** Filnamnet styr heuristiken (guessFromFilename) → STAMNING, deterministiskt. */
const FILE_NAME = "stämningsansökan-2026.txt";
const EXPECTED_KIND = "STAMNING";
/**
 * LLM-läge (E2E_LLM=1, sätts av `--llm`-wrappern): klassificeringen går via
 * ollama och är INTE deterministisk (en liten modell kan svara med en annan
 * giltig kategori). Då assert:ar vi bara att klassificeringen KÖRT (en giltig
 * `KNOWN_KIND`) + att båda användarna ser SAMMA kategori — inte exakt STAMNING.
 * I heuristik-läget (default, CI) assert:as den deterministiska STAMNING.
 */
const LLM_MODE = process.env.E2E_LLM === "1";
const knownKinds: readonly string[] = KNOWN_KINDS;
function kindOk(kind: string | null | undefined): boolean {
  if (kind == null || !knownKinds.includes(kind)) return false;
  return LLM_MODE ? true : kind === EXPECTED_KIND;
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(`assert: ${msg}`); }
function b64(text: string): string { return Buffer.from(text, "utf8").toString("base64"); }

/** Seeda en allowlistad användare (orgProcedure släpper bara igenom dessa). */
async function seedUser(email: string, name: string): Promise<string> {
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
  try {
    const existing = await sql<Array<{ id: string }>>`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
    if (existing[0]) return existing[0].id;
    const id = uuidv7();
    await sql`INSERT INTO users (id, organization_id, email, name, role, active)
              VALUES (${id}, ${ORG}, ${email}, ${name}, 'LAWYER', true)`;
    return id;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function clientFor(email: string): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: `${SERVER_URL}/api/trpc`,
      transformer: superjson,
      headers: () => ({ "X-Auth-Request-Email": email }),
    })],
  });
}

/** Vänta tills servern svarar (containern kan ta en stund att lyssna). */
async function waitForServer(client: TRPCClient<AppRouter>): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try { await client.documentTemplate.list.query(); return; } catch { await sleep(1000); }
  }
  throw new Error(`server-first svarade inte på ${SERVER_URL} inom 30s`);
}

/** Pollar tills `pred` är sann eller timeout. */
async function waitUntil<T>(fetch: () => Promise<T>, ok: (v: T) => boolean, label: string, timeoutMs = 30_000): Promise<T> {
  const start = Date.now();
  let last: T;
  do {
    last = await fetch();
    if (ok(last)) return last;
    await sleep(250);
  } while (Date.now() - start < timeoutMs);
  throw new Error(`timeout: ${label} (${timeoutMs}ms; sista värdet: ${JSON.stringify(last!)})`);
}

async function findDoc(client: TRPCClient<AppRouter>, matterId: string, docId: string): Promise<DocRow | undefined> {
  const tree = await client.document.tree.query({ matterId });
  return tree.documents.find((d) => d.id === docId);
}

async function main(): Promise<void> {
  const userAId = await seedUser(USER_A, "Anna Pipeline");
  await seedUser(USER_B, "Björn Pipeline");
  const a = clientFor(USER_A);
  const b = clientFor(USER_B);
  await waitForServer(a);

  const matterId = uuidv7();
  const docId = uuidv7();

  // ── ANVÄNDARE A, steg 1: ärende + dokument-metadata ──────────────
  await a.matter.create.mutate({ id: matterId, title: "Dokument-pipeline-E2E", matterNumber: "2026-7001", status: "ACTIVE" });
  await a.document.register.mutate({
    id: docId, matterId, fileName: FILE_NAME, mimeType: "text/plain",
    sizeBytes: 0, storagePath: "documents/content/placeholder", uploadedById: userAId,
  });
  console.log("✓ steg 1: ärende + dokument registrerat (användare A)");

  // ── steg 2: ladda upp innehåll → content-adresserad lagring + analyze ──
  const v1text = "STÄMNINGSANSÖKAN till tingsrätten. Käranden yrkar att svaranden förpliktas att betala.";
  const up1 = await a.document.uploadContent.mutate({ documentId: docId, contentBase64: b64(v1text) });
  const versionAfterUpload1 = up1.version;
  assert(versionAfterUpload1 >= 1, "uppladdning ger en version");
  console.log(`✓ steg 2: innehåll uppladdat (version ${versionAfterUpload1}, analyze köat)`);

  // ── steg 3: server-side klassificering färdig (analyze-jobbet) ───
  const classified = await waitUntil(
    () => findDoc(a, matterId, docId),
    (d) => d?.analysisStatus === "DONE" && kindOk(d?.documentType),
    `server-side klassificering DONE + ${LLM_MODE ? "giltig kategori" : EXPECTED_KIND}`,
  );
  console.log(`✓ steg 3: server-side klassificering klar → documentType=${classified!.documentType}, status=${classified!.analysisStatus} (modell ${classified!.analysisModel})`);

  // ── steg 4: redigera (ny uppladdning) → version bumpas + om-klassas ──
  const v2text = "STÄMNINGSANSÖKAN (reviderad). Käranden justerar yrkandet och åberopar ny bevisning.";
  const up2 = await a.document.uploadContent.mutate({ documentId: docId, contentBase64: b64(v2text) });
  const versionAfterUpload2 = up2.version;
  assert(versionAfterUpload2 > versionAfterUpload1, `redigering bumpar version (${versionAfterUpload1} → ${versionAfterUpload2})`);
  // OBS: server-side-klassificeringens metadata-skrivning bumpar OCKSÅ versionen
  // (reconcile-konvention), så versionen stiger förbi `versionAfterUpload2` när
  // om-klassificeringen skrivit klart → assert:a monotont (>=), inte exakt.
  const reclassified = await waitUntil(
    () => findDoc(a, matterId, docId),
    (d) => d?.analysisStatus === "DONE" && (d?.version ?? 0) >= versionAfterUpload2 && kindOk(d?.documentType),
    "om-klassificering efter redigering klar",
  );
  const finalVersion = reclassified!.version;
  const finalKind = reclassified!.documentType;
  console.log(`✓ steg 4: redigerat (version ${versionAfterUpload2}) → om-klassificerat (version ${finalVersion}, ${finalKind})`);

  // ── steg 5: ANVÄNDARE B ser senaste versionen + klassificeringen ──
  const seenByB = await findDoc(b, matterId, docId);
  assert(seenByB !== undefined, "användare B ser dokumentet (samma org)");
  assert((seenByB!.version ?? 0) >= versionAfterUpload2, `användare B ser den redigerade versionen (>= ${versionAfterUpload2}, fick ${seenByB!.version})`);
  // Fler-användar-konsistens: B ser SAMMA kategori som A:s slutvy (mode-agnostiskt).
  assert(seenByB!.documentType === finalKind, `användare B ser samma kategori som A (${finalKind})`);
  console.log(`✓ steg 5: användare B ser dokumentet (version ${seenByB!.version}, ${seenByB!.documentType})`);

  console.log("✓ dokument-pipeline-E2E: alla steg gröna (upload → server-klassificering → versionering → fler-användar-synlighet)");
}

main().catch((err: unknown) => {
  process.stderr.write(`✗ dokument-pipeline-E2E: ${String(err)}\n`);
  process.exitCode = 1;
});
