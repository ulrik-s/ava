/**
 * Klientens principal (#1864, ADR 0016, ADR 0018).
 *
 * Routrarna körs också i webbläsaren, med en principal som klienten bygger
 * själv. Den ska stämma med servern: rollen läses ur den inloggades rad i den
 * synkade datan (som `user.current`), så att den lokala körningen inte släpper
 * igenom det servern sedan avvisar när kön spelas upp. Saknas raden blir rollen
 * den snävaste (`ASSISTANT`), aldrig `ADMIN`. Klienten kan alltså bara bli
 * strängare än servern, som fortfarande avgör behörigheten.
 */

import type { FirmaConfig } from "@/lib/client/firma/firma-config";
import type { Principal } from "@/lib/server/auth/principal";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import type { UserRole } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import { UNBOUND_PRINCIPAL } from "./local-data/local-data-session";

/** Rollen när den inloggades rad saknas: den snävaste, aldrig `ADMIN`. */
export const FALLBACK_CLIENT_ROLE: UserRole = "ASSISTANT";

/** Configens fält som klientens principal byggs av. */
export type ClientIdentityConfig = Pick<FirmaConfig, "tier" | "principalId" | "organizationId" | "authorEmail" | "authorName">;

/**
 * Principalens id: den bundna användaren, annars `current-user` i self-hosted
 * (som de lokala databaserna, `UNBOUND_PRINCIPAL`) och tomt i demon.
 */
export function clientPrincipalId(cfg: ClientIdentityConfig): string {
  return cfg.principalId || (cfg.tier === "self-hosted" ? UNBOUND_PRINCIPAL : "");
}

/**
 * Den inloggades roll ur hennes rad i den lokala, synkade datan (fungerar
 * därför också offline). Saknad rad, rad i en annan byrå och tomt id ger
 * `ASSISTANT`, aldrig `ADMIN`.
 */
export async function resolveClientRole(dataStore: IDataStore, principalId: string, organizationId: string): Promise<UserRole> {
  if (!principalId) return FALLBACK_CLIENT_ROLE;
  const row = await buildInMemoryRepositories(dataStore).users.getByIdInOrg(
    asId<"UserId">(principalId),
    asId<"OrganizationId">(organizationId),
  );
  return row?.role ?? FALLBACK_CLIENT_ROLE;
}

/** Klientens principal (id, e-post, namn, roll, org-id) ur configen och rollen. */
export function clientPrincipal(cfg: ClientIdentityConfig, role: UserRole): Principal {
  return {
    id: asId<"UserId">(clientPrincipalId(cfg)),
    email: cfg.authorEmail,
    name: cfg.authorName,
    role,
    organizationId: asId<"OrganizationId">(cfg.organizationId),
  };
}

/**
 * Principalen för en uppstart, efter att storen är öppnad. I bindningsfasen
 * (OIDC-bindningen, storen i minnet) finns ingen bunden rad att läsa: där
 * används `ASSISTANT`, som räcker för att läsa byråns användare.
 */
export async function resolveClientPrincipal(
  dataStore: IDataStore, cfg: ClientIdentityConfig, opts: { binding?: boolean } = {},
): Promise<Principal> {
  const role = opts.binding
    ? FALLBACK_CLIENT_ROLE
    : await resolveClientRole(dataStore, clientPrincipalId(cfg), cfg.organizationId);
  return clientPrincipal(cfg, role);
}
