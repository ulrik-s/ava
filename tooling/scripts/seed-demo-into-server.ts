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

import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { createPostgresDb } from "@/lib/server/db/client";
import { serverFirstEventLog } from "@/lib/server/http/server-context";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";
import { createIdTranslator, translateSeed } from "../demo-generator/id-translator";
import { populate } from "../demo-generator/populate";
import { buildSeed } from "./seed-data";

const DB_URL = process.env.AVA_DATABASE_URL ?? "postgres://ava:ava@localhost:5433/ava_test";
const ORG = process.env.AVA_ORGANIZATION_ID ?? "00000000-0000-0000-0000-000000000001";

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
      organizationId: asId<"OrganizationId">(ORG),
    };
    const ctx = buildContext({ repos, eventLog: serverFirstEventLog, ports: noopPorts, principal });
    const caller = appRouter.createCaller(ctx as never) as ReturnType<typeof appRouter.createCaller>;

    // Slug-seed → UUID:er (samma som demo-generatorn/prod, ADR 0003). Org-/user-
    // raderna skapas också, men create-mutationerna org-scopar mot PRINCIPALENS
    // org (ORG), så allt hamnar i serverns org oavsett seedens org-fält.
    const seed = translateSeed(buildSeed({}), createIdTranslator());

    // v1: bara kärnentiteterna (org/users/contacts/matters/matter-contacts/
    // tid/utlägg/kalender/uppgifter/mallar/jävskontroller). Fakturering +
    // dokument hoppas — populateBilling synthesizar icke-uuid-id:n
    // (`inv-<matterId>-acc`) som Postgres-uuid-kolumnen avvisar, och dokument
    // kräver content-store-porten. Båda är uppföljning (#630).
    const core = await populate(caller, seed);
    console.log("✓ demo-data (kärna) seedad i server-first (org", ORG, "):", core);
    console.log("  (fakturering + dokument hoppade i v1 — kräver uuid-id-coercion resp. content-store)");
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`✗ seed-demo-into-server: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
