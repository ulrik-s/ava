/**
 * Auth-seamen (ADR 0001/0003).
 *
 * Routrarna ser bara en `Principal` via `ctx.user`. HUR principalen
 * fastställs är en utbytbar `AuthProvider`:
 *   - Git-backenden (local-first) själv-deklarerar (ingen ACL att skydda).
 *   - En framtida server/Postgres-backend verifierar requesten.
 *
 * `Principal` är single source of truth för formen på `ctx.user`
 * (se `Context` i `trpc-core.ts`).
 */

export interface Principal {
  id: string;
  email: string;
  name: string;
  /** "ADMIN" | "LAWYER" | "ASSISTANT" — strängtypad här, enum i schemas. */
  role: string;
  organizationId: string;
}

export interface AuthProvider {
  /** Den inloggade principalen, eller `null` för anonym/publik åtkomst. */
  getPrincipal(): Principal | null;
}
