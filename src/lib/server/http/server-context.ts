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
import type { IEventLog } from "@/lib/server/data-store/IDataStore";
import type { AvaEvent, EmitInput, EventFilter } from "@/lib/server/events/schema";
import type { IPorts } from "@/lib/server/ports";
import type { Repositories } from "@/lib/server/repositories/repositories";
import type { SyncStore } from "@/lib/server/sync/sync-store";
import type { Context } from "@/lib/server/trpc-core";
import type { Capabilities } from "@/lib/shared/capabilities";
import type { User } from "@/lib/shared/schemas/user";
import { forwardedClaims, type ForwardedHeaderNames } from "./forwarded-claims";

/**
 * Serverns annonserade kapabiliteter (ADR 0027) — vad DENNA deploy faktiskt kan.
 * sync/jobs/oidc är alltid på server-side; `llm` gate:as på att en LLM-endpoint
 * är konfigurerad (annars döljer klienten AI-affordanser, lika konsekvent som
 * demon); ledger/mailSync annonseras tillgängliga (per-byrå-koppling sker sen).
 */
export function serverCapabilities(): Capabilities {
  const llm = Boolean(process.env.AVA_LLM_ENDPOINT ?? process.env.AVA_LLM_MODEL);
  return { sync: true, jobs: true, oidc: true, ledger: true, mailSync: true, llm };
}

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

/**
 * Read-only event-logg (full `IEventLog`): `emit` no-op:ar via ReadOnlyError,
 * `query` ger [], `iterate` ger en tom ström, `onNewEvent` en no-op-avregistrering.
 * Routrarna rör bara `.events` på `ctx.dataStore` (allt annat via ctx.repos, ADR 0020),
 * så `ctx.dataStore` är typad `Pick<IDataStore, "events">` och behöver ingen full store.
 */
export const serverFirstEventLog: IEventLog = {
  emit(_input: EmitInput): Promise<AvaEvent> {
    return Promise.reject(new EventLogNotBuiltError());
  },
  query(_filter?: EventFilter): Promise<AvaEvent[]> {
    return Promise.resolve([]);
  },
  async *iterate(_filter?: EventFilter): AsyncIterable<AvaEvent> {
    // Tom ström — inga events innan change-loggen byggts (#408).
  },
  onNewEvent(): () => void {
    return () => {};
  },
};

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
  /** Server-sidans delta-sync-port (ADR 0017) — driver `sync`-routern. */
  sync?: SyncStore;
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
  return buildContext({
    eventLog: serverFirstEventLog,
    ports: deps.ports,
    principal,
    repos: deps.repos,
    ...(deps.sync ? { sync: deps.sync } : {}),
    capabilities: serverCapabilities(),
  });
}
