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

import { patchFirmaConfig, type FirmaConfig } from "@/lib/client/firma/firma-config";
import type { Principal } from "@/lib/server/auth/principal";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import type { UserRole } from "@/lib/shared/schemas/enums";
import { asId, type OrganizationId } from "@/lib/shared/schemas/ids";
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

/** Felet när den synkade datan saknar byrå (#1865). */
export const NO_ORGANIZATION_MESSAGE = "Hittade ingen byrå på servern. Kontrollera att du är uppkopplad och försök igen.";
/** Felet när den synkade datan har flera byråer (#1865). */
export const MANY_ORGANIZATIONS_MESSAGE = "Servern har flera byråer. AVA kan inte välja.";

/**
 * Klientens organisations-id (#1865): det sparade, annars den enda byrån i den
 * synkade datan, så att klienten scopar mot samma byrå som servern.
 * Ingen byrå eller flera byråer kastar ett `Error` med ett besked till användaren.
 */
export async function resolveOrganizationId(dataStore: IDataStore, configured: string): Promise<OrganizationId> {
  if (configured) return asId<"OrganizationId">(configured);
  const [only, ...rest] = await dataStore.organizations.findMany();
  if (!only) throw new Error(NO_ORGANIZATION_MESSAGE);
  if (rest.length > 0) throw new Error(MANY_ORGANIZATIONS_MESSAGE);
  return asId<"OrganizationId">(only.id);
}

/**
 * Principalen för en uppstart, efter att storen är öppnad. I bindningsfasen
 * (OIDC-bindningen, eller inget sparat org-id; storen i minnet) finns ingen
 * bunden rad att läsa: där löses byrån först, och rollen är `ASSISTANT`, som
 * räcker för att läsa byråns användare.
 */
export async function resolveClientPrincipal(
  dataStore: IDataStore, cfg: ClientIdentityConfig, opts: { binding?: boolean } = {},
): Promise<Principal> {
  if (!opts.binding) {
    return clientPrincipal(cfg, await resolveClientRole(dataStore, clientPrincipalId(cfg), cfg.organizationId));
  }
  const organizationId = await resolveOrganizationId(dataStore, cfg.organizationId);
  return clientPrincipal({ ...cfg, organizationId }, FALLBACK_CLIENT_ROLE);
}

/**
 * Org-bindningen (#1865): utan sparat org-id sparas byrån som bindningsfasen
 * löste, och sidan laddas om (som OIDC-bindningen). Returnerar true om
 * anroparen ska avbryta; false när ett org-id redan är sparat.
 */
export function bindClientOrganization(
  cfg: Pick<FirmaConfig, "organizationId">, organizationId: string, reload: () => void = () => window.location.reload(),
): boolean {
  if (cfg.organizationId) return false;
  patchFirmaConfig({ organizationId });
  reload();
  return true;
}
