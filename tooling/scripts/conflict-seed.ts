#!/usr/bin/env bun
/**
 * Konflikt-seed för det UI-drivna keep-both-e2e:t (#742) — provocerar fram en
 * RIKTIG dokument-konflikt mot den deployade self-hosted-stacken
 * (docker-compose.selfhosted-local.yml), över EXAKT helperns nätväg:
 * Keycloak-Bearer → oauth2-proxy → server-first tRPC (`/api/trpc`).
 *
 * Två allowlistade användare (lawyer + admin, samma org → båda ser ärendet)
 * öppnar samma textdokument på version 1 (= "tappar internet" var för sig),
 * gör var sin ändring, och kommer tillbaka online:
 *   1. lawyer skapar ärende + textdokument (v1).
 *   2. båda "laddar ner" (baseVersion = 1).
 *   3. lawyer laddar upp sin ändring från v1 → vinner (server → v2).
 *   4. admin laddar upp SIN ändring från v1 → 409 (servern gått förbi).
 *   5. admin materialiserar keep-both → syskon-dokument (ADR 0033 §4).
 * Slut: ärendet har 2 filer (originalet + "(din ändring …)") med bådas innehåll.
 *
 * Detta är de tRPC-anrop helper-kön gör (`uploadViaTrpc`/`saveConflictCopyViaTrpc`
 * i helper-ui/src/engine), men auth:at som 2 separata användare. UI-verifieringen
 * (att 2 filer syns i ärendet) görs av Playwright-spec:en mot samma stack.
 *
 * Skriver ärende-/dok-fakta till `tooling/.conflict-seed.json` så spec:en vet
 * vart den ska navigera. Kör via `tooling/scripts/conflict-e2e.sh`.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTRPCClient, httpBatchLink, TRPCClientError, type TRPCClient } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";

const WEB_URL = process.env.AVA_WEB_URL ?? "http://localhost:8080";
const KC_URL = process.env.OIDC_KC_HOSTNAME ?? "http://localhost:8089";
const OUT_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", ".conflict-seed.json");

/** Klient-genererat textdokument-id + ärende-id (delas med Playwright-spec:en). */
const MATTER_ID = "019ef800-0000-7000-8000-000000000742";
const DOC_ID = "019ef800-0000-7000-8000-0000000007d0";
const MATTER_NUMBER = "2026-0742";
const MATTER_TITLE = "Konflikt-e2e (#742)";
const FILE_NAME = "minnesanteckning.txt";
const ORIGINAL_TEXT = "Ursprunglig minnesanteckning (version 1).";
const LAWYER_TEXT = "Lenas ändring: lägg till möte tisdag 10:00.";
const ADMIN_TEXT = "Alvas ändring: kräv komplettering av motparten.";
/** Server-side keep-both-namnet (conflictCopyName: "<bas> (din ändring <label>).<ext>"). */
const CONFLICT_LABEL = "2026-03-14 09:15";

function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(`assert: ${msg}`); }
function b64(text: string): string { return Buffer.from(text, "utf8").toString("base64"); }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

/** Mynta en Keycloak access-token via password-grant (`ava`-klienten, direct-access). */
async function mintToken(username: string, password: string): Promise<string> {
  const res = await fetch(`${KC_URL}/realms/ava/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password", client_id: "ava", client_secret: "ava-test-secret",
      username, password, scope: "openid email profile",
    }),
  });
  if (!res.ok) throw new Error(`token-mint ${username}: HTTP ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error(`token-mint ${username}: saknar access_token`);
  return json.access_token;
}

/** tRPC-klient som bär en användares Bearer mot web-origin (oauth2-proxy → server-first). */
function clientFor(token: string): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: `${WEB_URL}/api/trpc`,
      transformer: superjson,
      headers: () => ({ Authorization: `Bearer ${token}` }),
    })],
  });
}

async function waitForServer(client: TRPCClient<AppRouter>): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try { await client.user.current.query(); return; } catch { await sleep(1000); }
  }
  throw new Error(`server-first svarade inte på ${WEB_URL} inom 40s`);
}

async function main(): Promise<void> {
  const lawyerTok = await mintToken("lawyer", "lawyer");
  const adminTok = await mintToken("admin", "admin");
  const lawyer = clientFor(lawyerTok);
  const admin = clientFor(adminTok);
  await waitForServer(lawyer);

  const lawyerMe = await lawyer.user.current.query();
  console.log(`✓ auth: lawyer=${lawyerMe?.email} + admin (Bearer → oauth2-proxy → server-first)`);

  // ── steg 1: lawyer skapar ärende + textdokument (v1) ─────────────
  await lawyer.matter.create.mutate({
    id: asId<"MatterId">(MATTER_ID), title: MATTER_TITLE, matterNumber: MATTER_NUMBER, status: "ACTIVE",
  });
  await lawyer.document.register.mutate({
    id: asId<"DocumentId">(DOC_ID), matterId: asId<"MatterId">(MATTER_ID),
    fileName: FILE_NAME, mimeType: "text/plain", sizeBytes: 0,
    storagePath: "documents/content/placeholder", uploadedById: asId<"UserId">(lawyerMe!.id),
  });
  const v1 = await lawyer.document.uploadContent.mutate({
    documentId: asId<"DocumentId">(DOC_ID), contentBase64: b64(ORIGINAL_TEXT),
  });
  console.log(`✓ steg 1: ärende + textdokument (version ${v1.version})`);

  // ── steg 2: båda "öppnar" dokumentet → bär samma basversion (v1) ──
  const lawyerOpen = await lawyer.document.downloadContent.query({ documentId: asId<"DocumentId">(DOC_ID) });
  const adminOpen = await admin.document.downloadContent.query({ documentId: asId<"DocumentId">(DOC_ID) });
  assert(lawyerOpen.version === adminOpen.version, "båda öppnar samma version");
  const baseVersion = lawyerOpen.version;
  console.log(`✓ steg 2: båda öppnade på basversion ${baseVersion} ("offline")`);

  // ── steg 3: lawyer kommer online först → vinner ──────────────────
  const win = await lawyer.document.uploadContent.mutate({
    documentId: asId<"DocumentId">(DOC_ID), contentBase64: b64(LAWYER_TEXT), baseVersion,
  });
  assert(win.version > baseVersion, "lawyers skrivning bumpar versionen");
  console.log(`✓ steg 3: lawyer vann (version ${baseVersion} → ${win.version})`);

  // ── steg 4: admin kommer online → 409 (servern gått förbi) ───────
  let got409 = false;
  try {
    await admin.document.uploadContent.mutate({
      documentId: asId<"DocumentId">(DOC_ID), contentBase64: b64(ADMIN_TEXT), baseVersion,
    });
  } catch (err) {
    got409 = err instanceof TRPCClientError && err.data?.code === "CONFLICT";
    if (!got409) throw err;
  }
  assert(got409, "admins upload från stale basversion ger 409 CONFLICT");
  console.log("✓ steg 4: admin fick KONFLIKT (409) — server skrevs ALDRIG över");

  // ── steg 5: admin materialiserar keep-both → syskon-dokument ─────
  const copy = await admin.document.saveConflictCopy.mutate({
    documentId: asId<"DocumentId">(DOC_ID), contentBase64: b64(ADMIN_TEXT), label: CONFLICT_LABEL,
  });
  console.log(`✓ steg 5: keep-both → syskon-dokument "${copy.fileName}" (id ${copy.id})`);

  // ── verifiera slut-tillståndet på server-sidan (UI-spec:en dubbelkollar) ──
  const tree = await admin.document.tree.query({ matterId: asId<"MatterId">(MATTER_ID) });
  const original = tree.documents.find((d) => d.id === DOC_ID);
  const sibling = tree.documents.find((d) => d.id === copy.id);
  assert(tree.documents.length === 2, `ärendet har 2 filer (fick ${tree.documents.length})`);
  assert(original?.fileName === FILE_NAME, "originalet orört");
  assert(sibling !== undefined && sibling.fileName.includes("din ändring"), "syskon-dokument med (din ändring …)-namn");
  const origBytes = await admin.document.downloadContent.query({ documentId: asId<"DocumentId">(DOC_ID) });
  const sibBytes = await admin.document.downloadContent.query({ documentId: asId<"DocumentId">(copy.id) });
  assert(Buffer.from(origBytes.contentBase64, "base64").toString("utf8") === LAWYER_TEXT, "originalet bär lawyers innehåll");
  assert(Buffer.from(sibBytes.contentBase64, "base64").toString("utf8") === ADMIN_TEXT, "syskonet bär admins innehåll");
  console.log("✓ server-state: 2 filer, bådas innehåll bevarat");

  writeFileSync(OUT_FILE, JSON.stringify({
    matterId: MATTER_ID, matterNumber: MATTER_NUMBER, matterTitle: MATTER_TITLE,
    originalFileName: FILE_NAME, siblingFileName: sibling!.fileName, siblingId: copy.id,
  }, null, 2));
  console.log(`✓ skrev ${OUT_FILE} (Playwright navigerar dit)`);
}

main().catch((err: unknown) => {
  process.stderr.write(`✗ konflikt-seed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
