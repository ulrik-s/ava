#!/usr/bin/env bun
/**
 * BACKUP PÅ BEGÄRAN-E2E (#1431) — "Ta backup nu" mot den riktiga server-first-
 * containern, med backupkatalogerna bind-mountade från värden.
 *
 * Skriptet spelar hostens roll: när servern lagt sin begäran (`request.json` i
 * begärandekatalogen) skriver det en låtsasexport — slumpbyte, som en riktig
 * age-fil är för servern — med checksumma i exportkatalogen, precis som
 * `ava-backup-request.path` → `ava-backup.service` → `backup-export.sh` gör i
 * prod. Sedan ska servern säga att backupen är klar och strömma exakt de
 * byten till administratören, och vägra alla andra.
 *
 *   mkdir -p .e2e-backup/exports .e2e-backup/requests
 *   docker compose -f tooling/docker/docker-compose.server-first.yml up -d --build --wait
 *   bun run db:migrate && bun tooling/scripts/backup-button-e2e.ts
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TRPCClientError } from "@trpc/client";
import { z } from "zod";
import { backupDownloadUrl, backupFileNameSchema, type BackupStatus } from "@/lib/shared/backup";
import { assert, clientFor, SERVER_URL, seedUser, waitForServer, type Ava } from "./e2e-harness";

/** Värdens sida av bind-mountarna i docker-compose.server-first.yml. */
const DIR = ".e2e-backup";
const ADMIN = "backup-admin@ava.test";
const LAWYER = "backup-jurist@ava.test";

const errorData = z.object({ code: z.string() });

/** Felkoden ur ett tRPC-fel (FORBIDDEN, CONFLICT, …). */
async function errorCode(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (e) {
    const data = errorData.safeParse(e instanceof TRPCClientError ? e.data : null);
    if (data.success) return data.data.code;
    throw e;
  }
  return "inget fel";
}

/** Exportens namn som backup-export.sh sätter det (`ava-<YYYY-MM-DD-HHMM>.tar.age`). */
function exportName(at: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `ava-${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}.tar.age`;
}

/** Hostens roll: en "krypterad" export + checksumma, som backup-export.sh. */
function writeFakeExport(): { name: string; bytes: Buffer; sha: string } {
  const name = exportName(new Date());
  const bytes = randomBytes(3 * 1024 * 1024 + 17);
  const sha = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(DIR, "exports", name), bytes);
  writeFileSync(join(DIR, "exports", `${name}.sha256`), `${sha}  ${name}\n`);
  return { name, bytes, sha };
}

async function waitForDone(c: Ava): Promise<BackupStatus> {
  for (let i = 0; i < 30; i++) {
    const s = await c.backup.status.query();
    if (s.state === "idle") return s;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("servern såg aldrig den nya exporten");
}

function download(name: string, email: string | null): Promise<Response> {
  return fetch(`${SERVER_URL}${backupDownloadUrl(backupFileNameSchema.parse(name))}`, { headers: email ? { "X-Auth-Request-Email": email } : {} });
}

async function verifyRefusals(admin: Ava, lawyer: Ava): Promise<void> {
  console.log("\n--- behörighet ---");
  assert(await errorCode(() => lawyer.backup.status.query()) === "FORBIDDEN", "en jurist får inte se backupläget");
  assert(await errorCode(() => lawyer.backup.request.mutate()) === "FORBIDDEN", "en jurist får inte begära backup");
  assert((await admin.backup.status.query()).state === "idle", "ingen backup pågår från start");
  console.log("  ✓ bara administratören");
}

async function verifyRequest(admin: Ava): Promise<number> {
  console.log("\n--- begäran ---");
  const status = await admin.backup.request.mutate();
  assert(status.state === "running" && status.requestedAt !== null, `begäran gav ${status.state}`);
  assert(existsSync(join(DIR, "requests", "request.json")), "begäran hamnade inte i katalogen hostens .path-enhet bevakar");
  assert(await errorCode(() => admin.backup.request.mutate()) === "CONFLICT", "en andra begäran medan den första pågår ska vägras");
  console.log("  ✓ begäran lagd för hosten, en andra vägras");
  return status.requestedAt;
}

async function verifyDownload(admin: Ava, fake: { name: string; bytes: Buffer; sha: string }): Promise<void> {
  console.log("\n--- klar + nedladdning ---");
  const done = await waitForDone(admin);
  assert(done.latest?.name === fake.name, `senaste exporten är ${done.latest?.name ?? "ingen"}, inte ${fake.name}`);
  assert(done.latest.sha256 === fake.sha && done.latest.sizeBytes === fake.bytes.length, "checksumma/storlek stämmer inte");
  const res = await download(fake.name, ADMIN);
  assert(res.status === 200, `nedladdningen gav ${res.status}`);
  assert(res.headers.get("content-disposition") === `attachment; filename="${fake.name}"`, "filen ska sparas som bilaga med exportens namn");
  const got = Buffer.from(await res.arrayBuffer());
  assert(createHash("sha256").update(got).digest("hex") === fake.sha, "de nedladdade byten är inte exporten");
  console.log(`  ✓ ${fake.name} (${got.length} byte) strömmad, checksumman stämmer`);
}

async function verifyDownloadRefusals(name: string): Promise<void> {
  assert((await download(name, LAWYER)).status === 403, "en jurist får inte ladda ner backupen");
  assert((await download(name, null)).status === 401, "utan inloggning ingen nedladdning");
  const traversal = await fetch(`${SERVER_URL}/api/backup/download?name=${encodeURIComponent("../../etc/passwd")}`, { headers: { "X-Auth-Request-Email": ADMIN } });
  assert(traversal.status === 400, "bara exporternas namn tas emot");
  console.log("  ✓ jurist 403, oinloggad 401, sökväg 400");
}

async function main(): Promise<void> {
  await seedUser(ADMIN, "Backup Admin");
  await seedUser(LAWYER, "Backup Jurist", "LAWYER");
  const admin = clientFor(ADMIN);
  const lawyer = clientFor(LAWYER);
  await waitForServer(admin);
  console.log("Backup på begäran-E2E: begäran → hostens export → nedladdning");

  await verifyRefusals(admin, lawyer);
  const requestedAt = await verifyRequest(admin);
  const fake = writeFakeExport();
  assert(Date.now() >= requestedAt, "exporten ska vara nyare än begäran");
  await verifyDownload(admin, fake);
  await verifyDownloadRefusals(fake.name);
  assert(await errorCode(() => admin.backup.request.mutate()) === "TOO_MANY_REQUESTS", "en ny begäran direkt efter en backup ska vänta");
  console.log("  ✓ nästa begäran väntar tio minuter");

  console.log("\n✓ Backup på begäran-E2E klart.");
}

main().catch((e: unknown) => {
  console.error(`\n✗ Backup på begäran-E2E misslyckades: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
