/**
 * `createServerContext` — server-first-runtimens tRPC-`Context` (#410, ADR 0016).
 *
 * Bygger en `Context` per HTTP-request mot Postgres-backenden:
 *   1. Verifierar principalen SERVER-SIDE ur oauth2-proxy:s forwarded headers
 *      ({@link forwardedClaims}) mot byråns allowlist (`OidcAuthProvider`,
 *      ADR 0009). Ingen självdeklarerad principal — till skillnad från
 *      git/demo-vägen (ADR 0001/0016 §gränskontrakt punkt 4).
 *   2. Exponerar de typade Drizzle-repositoryn (ADR 0020) via `ctx.repos`.
 *
 * `orgProcedure`/`protectedProcedure` (trpc-core) enforce:as därmed server-side:
 * saknad/okänd identitet → `principal=null` → `UNAUTHORIZED`.
 *
 * `ctx.dataStore`: efter ADR 0020 läser routrarna ALL data via `ctx.repos`.
 * Det enda som rör `ctx.dataStore` är emit-helpern (`events/emit.ts`). Postgres-
 * backad event-logg hör till change-log-arbetet (ADR 0017/#408, ej byggt) →
 * en sink vars `emit` kastar ett `ReadOnlyError`-namngivet fel som `safeEmit`
 * sväljer tyst (precis som demo/git-vägen). Byts mot en Drizzle-logg vid #408.
 */

import type { AllowlistedUser } from "@/lib/server/auth/oidc-auth-provider";
import { OidcAuthProvider } from "@/lib/server/auth/oidc-auth-provider";
import { buildContext } from "@/lib/server/build-context";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import type { AvaEvent, EmitInput } from "@/lib/server/events/schema";
import type { IPorts } from "@/lib/server/ports";
import type { Repositories } from "@/lib/server/repositories/repositories";
import type { Context } from "@/lib/server/trpc-core";
import type { User } from "@/lib/shared/schemas/user";
import { forwardedClaims, type ForwardedHeaderNames } from "./forwarded-claims";

/**
 * Event-sink för server-first innan change-loggen byggts (ADR 0017/#408).
 * `name = "ReadOnlyError"` är kontraktet `safeEmit` (events/emit.ts) matchar på
 * för att svälja felet tyst — håll det i synk om felnamnet ändras där.
 */
class EventLogNotBuiltError extends Error {
  constructor() {
    super("Server-first event-logg är inte byggd än (ADR 0017/#408).");
    this.name = "ReadOnlyError";
  }
}

/** Read-only event-logg: `emit` no-op:ar via ReadOnlyError, `query` ger []. */
export const serverFirstEventLog = {
  emit(_input: EmitInput): Promise<AvaEvent> {
    return Promise.reject(new EventLogNotBuiltError());
  },
  query(): Promise<AvaEvent[]> {
    return Promise.resolve([]);
  },
};

// Routrarna rör bara `.events` på dataStore (allt annat via ctx.repos, ADR 0020).
const serverDataStore = { events: serverFirstEventLog } as unknown as IDataStore;

export interface ServerContextDeps {
  /** Typade Drizzle-repositoryn (ADR 0020) för den auktoritativa Postgres-db:n. */
  repos: Repositories;
  /** Server-side ports (mail/sök/etc). */
  ports: IPorts;
  /**
   * Byråns org (single-org server-MVP, ADR 0016). Avgränsar allowlisten
   * principal-resolvern matchar claims mot.
   */
  organizationId: string;
  /** Override av forwarded-header-namn (default oauth2-proxy `X-Auth-Request-*`). */
  headerNames?: ForwardedHeaderNames;
}

/** Mappa en allowlist-rad ur full `User` → den delmängd `OidcAuthProvider` behöver. */
function toAllowlist(users: readonly User[]): AllowlistedUser[] {
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    organizationId: u.organizationId,
    oidcSubject: u.oidcSubject ?? null,
    oidcIssuer: u.oidcIssuer ?? null,
    active: u.active ?? true,
  }));
}

/** Bygg en server-first-`Context` för en inkommande HTTP-request. */
export async function createServerContext(req: Request, deps: ServerContextDeps): Promise<Context> {
  const claims = forwardedClaims(req.headers, deps.headerNames);
  const users = await deps.repos.users.listByOrg(deps.organizationId);
  const principal = new OidcAuthProvider(claims, toAllowlist(users)).getPrincipal();
  return buildContext({ dataStore: serverDataStore, ports: deps.ports, principal, repos: deps.repos });
}
