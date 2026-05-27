/**
 * `GitAuthProvider` — `AuthProvider` för Git-backenden (local-first).
 *
 * Git-backenden klonar hela repot till klienten, så det finns ingen
 * server att verifiera mot — principalen *själv-deklareras* från
 * firma-config. Det är OK eftersom Git-backenden per design inte har
 * per-entitet-ACL (firma-nivå-isolering via repo-åtkomst, se ADR 0001).
 *
 * Defaulten matchar demo-repots seed (`u-anna` i `demo-firma-ab`) så att
 * `orgProcedure` släpper igenom och nya entiteter hamnar på en user som
 * syns i picker:s. Self-hosted wirar in firma-config-värden (org, namn,
 * email) via konstruktorn.
 */

import type { AuthProvider, Principal } from "./principal";

export const DEMO_DEFAULT_PRINCIPAL: Principal = {
  id: "u-anna",
  email: "user@ava.demo",
  name: "Anna Advokat",
  role: "ADMIN",
  organizationId: "demo-firma-ab",
};

export type GitPrincipalConfig = Partial<Principal>;

export class GitAuthProvider implements AuthProvider {
  constructor(private readonly config: GitPrincipalConfig = {}) {}

  getPrincipal(): Principal {
    return {
      id: this.config.id ?? DEMO_DEFAULT_PRINCIPAL.id,
      email: this.config.email ?? DEMO_DEFAULT_PRINCIPAL.email,
      name: this.config.name ?? DEMO_DEFAULT_PRINCIPAL.name,
      role: this.config.role ?? DEMO_DEFAULT_PRINCIPAL.role,
      organizationId: this.config.organizationId ?? DEMO_DEFAULT_PRINCIPAL.organizationId,
    };
  }
}
