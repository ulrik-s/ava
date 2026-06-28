#!/usr/bin/env bun
/**
 * Populerar den lokala server-first-Postgres-backenden med DEMO-DATA (#630) via
 * de riktiga tRPC-flödena — så self-hosted-appen visar en "full" byrå i st.f.
 * en tom. Kör demo-generatorns populate-sekvens mot en in-process-caller bunden
 * till Drizzle-repos:en (change-log PÅ → varje rad blir pull-bar till klienten)
 * med en ADMIN-principal i SERVERNS org. Create-mutationerna org-scopar mot
 * principalens org, så all data hamnar i `AVA_ORGANIZATION_ID` (samma org som
 * klienten frågar + KC-användarna ligger i).
 *
 * Dokument hoppas i v1 (kräver content-store-port + binär-sink) — kärnan
 * (ärenden/kontakter/tid/utlägg/kalender/uppgifter/mallar + faktureringsflöden)
 * räcker för att se hur appen ser ut.
 *
 * ENGÅNGS: seed-id:n är fixa → kör mot en FÄRSK DB (annars id-krockar). Kör
 * efter `seed-selfhosted-local.ts` (org + allowlist).
 *
 *   AVA_DATABASE_URL=postgres://ava:ava@localhost:5433/ava_test \
 *   AVA_ORGANIZATION_ID=00000000-0000-0000-0000-000000000001 \
 *     bun tooling/scripts/seed-demo-into-server.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { createPostgresDb } from "@/lib/server/db/client";
import { serverFirstEventLog } from "@/lib/server/http/server-context";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { Repositories } from "@/lib/server/repositories/repositories";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createIdTranslator, translateSeed } from "../demo-generator/id-translator";
import { populate } from "../demo-generator/populate";
import { populateBilling } from "../demo-generator/populate-billing";
import { populateDocuments } from "../demo-generator/populate-documents";
import { populateKostnadsrakningDocs } from "../demo-generator/populate-kostnadsrakning-docs";
import { populateUnbilledTime } from "../demo-generator/populate-unbilled-time";
import { buildSeed } from "./seed-data";

const DB_URL = process.env.AVA_DATABASE_URL ?? "postgres://ava:ava@localhost:5433/ava_test";
const ORG = asId<"OrganizationId">(process.env.AVA_ORGANIZATION_ID ?? "00000000-0000-0000-0000-000000000001");
// Host-katalogen som är bind-mountad till serverns AVA_CONTENT_DIR (#649) —
// dit skrivs dokument-bytes så serverns GitContentStore kan läsa dem. Saknas
// den → dokument-metadata hoppas (bytes har ingenstans att ta vägen).
const CONTENT_DIR = process.env.AVA_CONTENT_HOST_DIR;

/** KC-realm:ens allowlistade login-emails (realm-ava.json). */
const LOGIN_ADMIN_EMAIL = "admin@ava.test";
const LOGIN_LAWYER_EMAIL = "lawyer@ava.test";

type Row = Record<string, unknown>;

/**
 * Mappa demons huvud-admin + en huvud-jurist till KC-login-emailen (#633-uppf.):
 * så OIDC-login binder till en user som ÄGER data (matters/tid/uppgifter) →
 * dashboarden/"min tid"/todo fylls. Utan detta äger demo-användarna
 * (@firma.local) all data medan login:en (lawyer@ava.test) äger ingenting.
 * Returnerar de mappade rad-id:na (för "idag"-tidposterna nedan).
 */
function remapLoginUsers(users: Row[]): { adminId: string | undefined; lawyerId: string | undefined } {
  const admin = users.find((u) => u.role === "ADMIN");
  const lawyer = users.find((u) => u.role === "LAWYER");
  if (admin) admin.email = LOGIN_ADMIN_EMAIL;
  if (lawyer) lawyer.email = LOGIN_LAWYER_EMAIL;
  return { adminId: admin?.id as string | undefined, lawyerId: lawyer?.id as string | undefined };
}

/**
 * Lägg en "idag"-tidpost per login-user på ett ärende de redan arbetat i
 * (#633-uppf., B): seedens tidposter är alla ≥3 dagar gamla → dashboardens
 * dagsvy ("Idag") blir annars tom. Tasks/kalender landar redan på idag via
 * seedens offset-logik, så bara tid behöver kompletteras.
 */
async function addTodayTimeEntries(repos: Repositories, timeEntries: Row[], matters: Row[], ids: { adminId: string | undefined; lawyerId: string | undefined }): Promise<void> {
  const tes = timeEntries;
  // Föredra ett PRIVAT-ärende: det är alltid i ARBETE-fasen (fakturerbart), så
  // "idag"-tiden blir inte ofakturerat arbete på ett redan slutreglerat ärende
  // (#824-uppf.) — annars syns upparbetat men ingen skapa-faktura-knapp.
  const pmById = new Map(matters.map((m) => [String(m.id), String(m.paymentMethod)]));
  for (const userId of [ids.lawyerId, ids.adminId]) {
    if (!userId) continue;
    const worked = tes.filter((t) => t.userId === userId).map((t) => String(t.matterId));
    const matterId = worked.find((id) => pmById.get(id) === "PRIVAT") ?? worked[0];
    if (!matterId) continue;
    await repos.timeEntries.create({
      id: asId<"TimeEntryId">(uuidv7()),
      organizationId: ORG,
      userId: asId<"UserId">(userId),
      matterId: asId<"MatterId">(matterId),
      date: new Date(),
      minutes: 60,
      description: "Löpande arbete (idag)",
      billable: true,
      hourlyRate: 220_000,
    } as never);
  }
}

/**
 * Seeda ärende-scopade seed-dokument (#649): uuid-id:n (translateSeed) + matterId
 * → synkas via resolveOrg-override (#528). Bytes skrivs till den bind-mountade
 * content-katalogen (AVA_CONTENT_HOST_DIR) som serverns GitContentStore läser →
 * öppna/ladda ner funkar lokalt. Genererade faktura-/KR-/mall-dokument hoppas
 * (icke-uuid-id:n `invdoc-/kr-/gendoc-` + faktura-scopade — uppföljning likt
 * #647). No-op utan CONTENT_DIR (bytes har då ingenstans att ta vägen).
 */
/** Bytes-sink mot den bind-mountade content-katalogen (#649), eller null när
 *  ingen CONTENT_DIR är satt (då har bytes ingenstans att ta vägen). */
function contentSink(): ((storagePath: string, bytes: Uint8Array) => number) | null {
  if (!CONTENT_DIR) return null;
  const dir = CONTENT_DIR;
  return (storagePath: string, bytes: Uint8Array): number => {
    const abs = join(dir, storagePath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
    return bytes.byteLength;
  };
}

/** KR-dokument per KOSTNADSRAKNING-run (#828) — speglar build:demo så panelens
 *  doc-länk finns på förseedade KR-körningar (annars saknar de dokument lokalt). */
async function seedKostnadsrakningDocs(caller: Parameters<typeof populateKostnadsrakningDocs>[0]): Promise<number> {
  // Postgres documents.id är uuid → generera uuid (default `krdoc-<id>` är ej uuid).
  return populateKostnadsrakningDocs(caller, contentSink() ?? undefined, () => uuidv7());
}

async function seedDocuments(
  caller: Parameters<typeof populateDocuments>[0],
  seed: Parameters<typeof populateDocuments>[1],
): Promise<number> {
  const sink = contentSink();
  if (!sink) return 0;
  return populateDocuments(caller, seed, sink);
}

async function main(): Promise<void> {
  const { db, close } = createPostgresDb(DB_URL);
  const repos = buildDrizzleRepositories(db);
  enableChangeLogOnAll(repos, createDbChangeLogRecorder(db)); // → allt pull-bart
  try {
    // ADMIN-principal i serverns org. Återanvänd den allowlistade admin-användaren
    // (seed-selfhosted-local) om den finns, annars en generator-identitet.
    const admin = (await repos.users.listByOrg(ORG)).find((u) => u.role === "ADMIN");
    const principal: Principal = {
      id: admin?.id ?? asId<"UserId">("00000000-0000-0000-0000-0000000000a1"),
      email: admin?.email ?? "generator@ava.local",
      name: admin?.name ?? "Demo Generator",
      role: "ADMIN",
      organizationId: ORG,
    };
    const ctx = buildContext({ repos, eventLog: serverFirstEventLog, ports: noopPorts, principal });
    const caller = appRouter.createCaller(ctx as never) as ReturnType<typeof appRouter.createCaller>;

    // Slug-seed → UUID:er (samma som demo-generatorn/prod, ADR 0003). Org-/user-
    // raderna skapas också, men create-mutationerna org-scopar mot PRINCIPALENS
    // org (ORG), så allt hamnar i serverns org oavsett seedens org-fält.
    const seed = translateSeed(buildSeed({}), createIdTranslator());

    // Mappa demons admin + huvud-jurist till KC-login-emailen → login äger data.
    const loginIds = remapLoginUsers(seed.users as Row[]);

    // Kärnentiteter (org/users/contacts/matters/matter-contacts/tid/utlägg/
    // kalender/uppgifter/mallar/jävskontroller).
    const core = await populate(caller, seed);
    await addTodayTimeEntries(repos, seed.timeEntries as Row[], seed.matters as Row[], loginIds); // "idag"-tid för dashboarden

    // Fakturering (#647/#736): billing-id:na är deterministiska uuid:er
    // (demo-billing-ids). populateBilling driver nu ETT billing-run-flöde per
    // ärende (aconto/slutfaktura/kostnadsräkning + livscykel); unbilled = färsk
    // upparbetad tid efter fakturering.
    const billing = await populateBilling(caller, seed);
    const unbilled = await populateUnbilledTime(caller, seed);

    const documents = await seedDocuments(caller, seed);
    const kostnadsrakningDocs = await seedKostnadsrakningDocs(caller);
    console.log("✓ demo-data seedad i server-first (org", ORG, "):", { ...core, billing, unbilled, documents, kostnadsrakningDocs });
    console.log(`  login: ${LOGIN_LAWYER_EMAIL} + ${LOGIN_ADMIN_EMAIL} äger nu data (+ idag-tidpost)`);
    console.log(CONTENT_DIR ? `  dokument-bytes → ${CONTENT_DIR}` : "  (dokument hoppade — sätt AVA_CONTENT_HOST_DIR)");
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`✗ seed-demo-into-server: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
