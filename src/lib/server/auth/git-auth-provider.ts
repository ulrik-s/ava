/**
 * `GitAuthProvider` — `AuthProvider` för Git-backenden (local-first).
 *
 * Git-backenden klonar hela repot till klienten, så det finns ingen
 * server att verifiera mot — principalen *själv-deklareras* från
 * firma-config. Det är OK eftersom Git-backenden per design inte har
 * per-entitet-ACL (firma-nivå-isolering via repo-åtkomst, se ADR 0001).
 *
 * Defaulten är NEUTRAL (inga demo-specifika strängar) så web-appen inte
 * råkar referera till "u-anna"/"demo-firma-ab" som hårdkodade konstanter.
 * Tester använder `TEST_PRINCIPAL` explicit. Demo-bootstrap skickar
 * faktiska värden från `.ava/meta.json` + login-flow.
 */

import { asId } from "@/lib/shared/schemas/ids";
import type { AuthProvider, Principal } from "./principal";

/** Test-fixture: explicit principal som tester ska passera till
 *  `new GitAuthProvider(TEST_PRINCIPAL)`. INTE för produktion. */
export const TEST_PRINCIPAL: Principal = {
  id: asId<"UserId">("00000000-0000-0000-0000-000000000001"),
  email: "test@ava.local",
  name: "Test User",
  role: "ADMIN",
  organizationId: asId<"OrganizationId">("00000000-0000-0000-0000-000000000000"),
};

/** Neutral fallback när varken config eller test-fixture ges. INGA demo-
 *  identifierare läcks via denna väg. */
const NEUTRAL_PRINCIPAL: Principal = {
  id: asId<"UserId">(""),
  email: "",
  name: "",
  role: "ADMIN",
  organizationId: asId<"OrganizationId">(""),
};

export type GitPrincipalConfig = Partial<Principal>;

export class GitAuthProvider implements AuthProvider {
  constructor(private readonly config: GitPrincipalConfig = {}) {}

  getPrincipal(): Principal {
    return {
      id: this.config.id ?? NEUTRAL_PRINCIPAL.id,
      email: this.config.email ?? NEUTRAL_PRINCIPAL.email,
      name: this.config.name ?? NEUTRAL_PRINCIPAL.name,
      role: this.config.role ?? NEUTRAL_PRINCIPAL.role,
      organizationId: this.config.organizationId ?? NEUTRAL_PRINCIPAL.organizationId,
    };
  }
}
