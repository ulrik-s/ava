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
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import type { GeneratorCaller } from "../demo-generator/backend-target";
import { createHttpCaller, mintToken } from "../demo-generator/http-target";
import { createIdTranslator, translateSeed } from "../demo-generator/id-translator";
import { bootstrapOrgUsers, populate } from "../demo-generator/populate";
import { populateInvoiceDocs } from "../demo-generator/populate-invoice-docs";
import { populateKostnadsrakningDocs } from "../demo-generator/populate-kostnadsrakning-docs";
import { runSimulation } from "../demo-generator/simulate/orchestrate";
import type { RunCtx } from "../demo-generator/simulate/runner";
import { buildSeed, type SeedDataset } from "./seed-data";

const DB_URL = process.env.AVA_DATABASE_URL ?? "postgres://ava:ava@localhost:5433/ava_test";
const ORG = asId<"OrganizationId">(process.env.AVA_ORGANIZATION_ID ?? "00000000-0000-0000-0000-000000000001");
// Host-katalogen som är bind-mountad till serverns AVA_CONTENT_DIR (#649) —
// dit skrivs dokument-bytes så serverns GitContentStore kan läsa dem. Saknas
// den → dokument-metadata hoppas (bytes har ingenstans att ta vägen).
const CONTENT_DIR = process.env.AVA_CONTENT_HOST_DIR;

/** HTTP-läge (#846): driv den BULK-seedade datan via serverns riktiga
 *  /api/trpc (transport + oauth2-proxy + Bearer-JWT-auth + routrar), inte bara
 *  in-process. Org+users bootstrappas ändå in-process (OIDC/assertAdmin). */
const VIA_HTTP = process.env.AVA_SEED_VIA_HTTP === "1";
const WEB_ORIGIN = process.env.AVA_WEB_ORIGIN ?? "http://localhost:8080";
const KC_BASE = process.env.OIDC_KC_HOSTNAME ?? "http://localhost:8089";
const OIDC_CLIENT_SECRET = process.env.AVA_OIDC_CLIENT_SECRET ?? "ava-test-secret";

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
async function addTodayTimeEntries(caller: GeneratorCaller, timeEntries: Row[], matters: Row[], ids: { adminId: string | undefined; lawyerId: string | undefined }): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = caller as any;
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
    // Via tRPC-API:t (#846) → funkar oavsett in-process/HTTP-caller.
    await c.timeEntry.create({
      id: uuidv7(), userId, matterId, date: new Date().toISOString(),
      minutes: 60, description: "Löpande arbete (idag)", billable: true, hourlyRate: 220_000,
    });
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

/** Faktura-dokument per slutfaktura + rådgivningsfaktura (#843) → de syns i
 *  ärendets dokumentlista lokalt. uuid-id (default `invdoc-<id>` är ej uuid). */
async function seedInvoiceDocs(caller: Parameters<typeof populateInvoiceDocs>[0]): Promise<number> {
  return populateInvoiceDocs(caller, contentSink() ?? undefined, () => uuidv7());
}

type LoginIds = { adminId: string | undefined; lawyerId: string | undefined };

/** Allt utom org+users (#846) — körs antingen in-process eller via HTTP-caller.
 *  `skipOrgUsers` styr om populate hoppar org/users (HTTP: bootstrappade separat). */
async function runRest(caller: GeneratorCaller, seed: SeedDataset, loginIds: LoginIds, skipOrgUsers: boolean): Promise<Record<string, unknown>> {
  // Kärnentiteter (ACTIVE-ärenden) — tid/utlägg/kontakter/dokument skapas kronologiskt
  // av simuleringen (#880), inte ur seedens statiska rader.
  const coreSeed = {
    ...seed,
    matters: (seed.matters as Row[]).map((m) => ({ ...m, status: "ACTIVE" })),
    timeEntries: [], expenses: [], matterContacts: [], documents: [], serviceNotes: [],
  } as SeedDataset;
  const core = await populate(caller, coreSeed, { skipOrgUsers });
  // Kronologisk simulering — SAMMA motor som GH Pages-demon; doc-bytes → content-katalogen.
  const sink = contentSink();
  const ctx: RunCtx = { c: caller, res: { invoices: 0, documents: 0, timeEntries: 0, notes: 0, credits: 0 }, ...(sink ? { sink } : {}) };
  await runSimulation(ctx, seed);
  await addTodayTimeEntries(caller, seed.timeEntries as Row[], seed.matters as Row[], loginIds); // "idag"-tid för dashboarden
  const kostnadsrakningDocs = await seedKostnadsrakningDocs(caller);
  const invoiceDocs = await seedInvoiceDocs(caller);
  return { ...core, sim: ctx.res, kostnadsrakningDocs, invoiceDocs };
}

/** HTTP-läget (#846): org+users bootstrappas in-process (OIDC/assertAdmin kräver
 *  att admin finns), sedan körs resten via serverns /api/trpc som admin@ava.test. */
async function seedViaHttp(inProcess: GeneratorCaller, seed: SeedDataset, loginIds: LoginIds): Promise<Record<string, unknown>> {
  const boot = await bootstrapOrgUsers(inProcess, seed);
  const token = await mintToken({ kcBaseUrl: KC_BASE, realm: "ava", clientId: "ava", clientSecret: OIDC_CLIENT_SECRET, username: "admin", password: "admin" });
  const httpCaller = createHttpCaller({ trpcUrl: `${WEB_ORIGIN}/api/trpc`, token });
  const rest = await runRest(httpCaller, seed, loginIds, true);
  console.log("  (bulk-data seedad via HTTP-API:t — transport + oauth2-proxy/Bearer + routrar)");
  return { ...rest, organizations: boot.organizations, users: boot.users };
}

/** In-process ADMIN-principal (org-scopad mot ORG): återanvänd en allowlistad
 *  admin om en finns, annars en generator-identitet. */
function seedPrincipal(admin: { id: Principal["id"]; email: string; name: string } | undefined): Principal {
  return {
    id: admin?.id ?? asId<"UserId">("00000000-0000-0000-0000-0000000000a1"),
    email: admin?.email ?? "generator@ava.local",
    name: admin?.name ?? "Demo Generator",
    role: "ADMIN",
    organizationId: ORG,
  };
}

async function main(): Promise<void> {
  const { db, close } = createPostgresDb(DB_URL);
  const repos = buildDrizzleRepositories(db);
  enableChangeLogOnAll(repos, createDbChangeLogRecorder(db)); // → allt pull-bart
  try {
    // Alltid byggd: fallback (in-process-läge) OCH HTTP-lägets org/user-bootstrap.
    const admin = (await repos.users.listByOrg(ORG)).find((u) => u.role === "ADMIN");
    const principal = seedPrincipal(admin);
    const ctx = buildContext({ repos, eventLog: serverFirstEventLog, ports: noopPorts, principal });
    const inProcess = appRouter.createCaller(ctx as never) as GeneratorCaller;

    // Slug-seed → UUID:er (ADR 0003) + mappa admin/huvud-jurist till KC-login-emailen.
    const seed = translateSeed(buildSeed({}), createIdTranslator());
    const loginIds = remapLoginUsers(seed.users as Row[]);

    const result = VIA_HTTP
      ? await seedViaHttp(inProcess, seed, loginIds)
      : await runRest(inProcess, seed, loginIds, false);

    console.log("✓ demo-data seedad i server-first (org", ORG, "):", result);
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
