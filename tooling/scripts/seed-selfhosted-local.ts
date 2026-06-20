#!/usr/bin/env bun
/**
 * Seed för den lokala self-hosted-stacken (#626) — skapar byrå-org:en +
 * allowlistade användare som matchar Keycloak-testrealm:ens emails, så att
 * OIDC-inloggningen (`lawyer@ava.test` / `admin@ava.test`) binder en principal
 * (server-context: forwardedClaims → users.listByOrg → OidcAuthProvider).
 *
 * Idempotent: ON CONFLICT DO NOTHING. Kör efter `db:migrate`.
 *
 *   AVA_DATABASE_URL=postgres://ava:ava@localhost:5433/ava_test \
 *   AVA_ORGANIZATION_ID=00000000-0000-0000-0000-000000000001 \
 *     bun tooling/scripts/seed-selfhosted-local.ts
 */

import postgres from "postgres";
import { uuidv7 } from "@/lib/shared/uuid";

const DB_URL = process.env.AVA_DATABASE_URL ?? "postgres://ava:ava@localhost:5433/ava_test";
const ORG = process.env.AVA_ORGANIZATION_ID ?? "00000000-0000-0000-0000-000000000001";

/** KC-realm:ens (realm-ava.json) allowlistade testanvändare. `outsider` seedas
 *  MEDVETET INTE → demonstrerar att autentiserad ≠ auktoriserad (nekas). */
const USERS = [
  { email: "lawyer@ava.test", name: "Lena Lawyer", role: "LAWYER" },
  { email: "admin@ava.test", name: "Alva Admin", role: "ADMIN" },
];

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`INSERT INTO organizations (id, name) VALUES (${ORG}, ${"Demobyrå AB"})
              ON CONFLICT (id) DO NOTHING`;
    for (const u of USERS) {
      const existing = await sql<Array<{ id: string }>>`SELECT id FROM users WHERE email = ${u.email} LIMIT 1`;
      if (existing[0]) { console.log(`• ${u.email} finns redan`); continue; }
      await sql`INSERT INTO users (id, organization_id, email, name, role, active)
                VALUES (${uuidv7()}, ${ORG}, ${u.email}, ${u.name}, ${u.role}, ${true})`;
      console.log(`✓ seedade ${u.email} (${u.role})`);
    }
    console.log(`✓ seed klar (org ${ORG}). 'outsider@ava.test' lämnas utanför allowlisten med flit.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`✗ seed-selfhosted-local: ${String(err)}\n`);
  process.exitCode = 1;
});
