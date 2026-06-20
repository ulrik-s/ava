#!/usr/bin/env bun
/**
 * Seed för den lokala self-hosted-stacken (#626/#628) — skapar byrå-org:en +
 * allowlistade användare som matchar Keycloak-testrealm:ens emails.
 *
 * KRITISKT (#628): seedas via REPO-lagret (`buildDrizzleRepositories` +
 * change-log-recorder), INTE rå-SQL. Annars skrivs ingen `change_log`-rad →
 * klientens `sync.pull` (ren change_log-delta, `seq > cursor`) levererar aldrig
 * användarna → klient-sidans OIDC-first-login-allowlist blir tom → inloggningen
 * hänger på "AVA Laddar…". Med repo-vägen får varje user en change_log-rad →
 * pull:as till klienten → principalen kan bindas.
 * (Server-SIDANS allowlist funkar oavsett: den läser users.listByOrg direkt.)
 *
 * Idempotent: hoppar org/användare som redan finns. Kör efter `db:migrate`.
 *
 *   AVA_DATABASE_URL=postgres://ava:ava@localhost:5433/ava_test \
 *   AVA_ORGANIZATION_ID=00000000-0000-0000-0000-000000000001 \
 *     bun tooling/scripts/seed-selfhosted-local.ts
 */

import { createPostgresDb } from "@/lib/server/db/client";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { asId } from "@/lib/shared/schemas/ids";
import type { Organization } from "@/lib/shared/schemas/organization";
import type { User } from "@/lib/shared/schemas/user";
import { uuidv7 } from "@/lib/shared/uuid";

const DB_URL = process.env.AVA_DATABASE_URL ?? "postgres://ava:ava@localhost:5433/ava_test";
const ORG = process.env.AVA_ORGANIZATION_ID ?? "00000000-0000-0000-0000-000000000001";

/** KC-realm:ens (realm-ava.json) allowlistade testanvändare. `outsider` seedas
 *  MEDVETET INTE → demonstrerar att autentiserad ≠ auktoriserad (nekas). */
const USERS: ReadonlyArray<{ email: string; name: string; role: "LAWYER" | "ADMIN" }> = [
  { email: "lawyer@ava.test", name: "Lena Lawyer", role: "LAWYER" },
  { email: "admin@ava.test", name: "Alva Admin", role: "ADMIN" },
];

async function main(): Promise<void> {
  const { db, close } = createPostgresDb(DB_URL);
  // change-log-recorder PÅ → create() skriver både raden OCH en change_log-rad
  // (det som gör users pull-bara till klienten).
  const repos = buildDrizzleRepositories(db);
  enableChangeLogOnAll(repos, createDbChangeLogRecorder(db));
  try {
    if (!(await repos.organizations.getById(ORG))) {
      await repos.organizations.create({ id: asId<"OrganizationId">(ORG), name: "Demobyrå AB" } satisfies Partial<Organization>);
    }
    const existing = new Set((await repos.users.listByOrg(ORG)).map((u) => u.email));
    for (const u of USERS) {
      if (existing.has(u.email)) { console.log(`• ${u.email} finns redan`); continue; }
      await repos.users.create({
        id: asId<"UserId">(uuidv7()),
        organizationId: asId<"OrganizationId">(ORG),
        email: u.email,
        name: u.name,
        role: u.role,
        active: true,
      } satisfies Partial<User>);
      console.log(`✓ seedade ${u.email} (${u.role}) + change_log → pull-bar`);
    }
    console.log(`✓ seed klar (org ${ORG}). 'outsider@ava.test' lämnas utanför allowlisten med flit.`);
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`✗ seed-selfhosted-local: ${String(err)}\n`);
  process.exitCode = 1;
});
