/**
 * Bootstrap av första admin i OIDC-allowlisten (#224) — ren rad-byggare.
 *
 * Hönan-och-ägget: på en färsk stack är allowlisten (`.ava/users/<email>.json`,
 * #223) tom, och `user.create` kräver admin-kontext. Rotförtroendet är den som
 * har host shell-access. Den här byggaren producerar en giltig admin-användarrad
 * som host-scriptet skriver direkt till firma.git-working-copy:n → efter det kan
 * personen logga in via OIDC och resolvas som ADMIN ([[oidc-principal]]).
 *
 * Id:t är DETERMINISTISKT (uuidv5 på email) → idempotent: kör om → samma id,
 * ingen dubblettrad. zod-validerat mot `userSchema`.
 */

import { CURRENT_SCHEMA_VERSION } from "@/lib/shared/schema-version";
import { organizationSchema, type Organization } from "@/lib/shared/schemas/organization";
import { userSchema, type User } from "@/lib/shared/schemas/user";
import { uuidv5, AVA_NAMESPACE } from "@/lib/shared/uuid-derive";

export interface AdminBootstrapInput {
  email: string;
  organizationId: string;
  /** Visningsnamn (default = email-delen före @). */
  name?: string;
  /** Tidsstämpel (injicerbar för deterministiska tester). */
  now?: Date;
}

/** Bygg + validera en admin-allowlist-rad (role=ADMIN, active). Ren. */
export function buildAdminUserRow(input: AdminBootstrapInput): User {
  const email = input.email.trim().toLowerCase();
  const id = uuidv5(`user:${email}`, AVA_NAMESPACE);
  const now = (input.now ?? new Date()).toISOString();
  return userSchema.parse({
    id,
    organizationId: input.organizationId,
    email,
    name: input.name?.trim() || email.split("@")[0],
    role: "ADMIN",
    active: true,
    createdAt: now,
    updatedAt: now,
  });
}

/** Relativ git-path till allowlist-raden (samma som fsa-write-back/#223). */
export function adminUserGitPath(email: string): string {
  return `.ava/users/${email.trim().toLowerCase()}.json`;
}

/**
 * Bygg + validera org-roten för en färsk firma.git. Utan en organisation
 * kraschar appen (organization.getSettings → findUniqueOrThrow). Lagras i
 * `.ava/organizations/<id>.json`.
 */
export function buildOrgRow(input: { id: string; name: string; now?: Date }): Organization {
  const now = (input.now ?? new Date()).toISOString();
  return organizationSchema.parse({
    id: input.id,
    name: input.name,
    createdAt: now,
    updatedAt: now,
  });
}

export function orgGitPath(orgId: string): string {
  return `.ava/organizations/${orgId}.json`;
}

/** `.ava/meta.json`-innehåll (schemaVersion) för en färsk firma.git. */
export function metaJsonContent(): string {
  return JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION }, null, 2) + "\n";
}
