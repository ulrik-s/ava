/**
 * Kostnadsräkningens domstol (#1891): den som valts i dialogen, annars ärendets.
 * Namnet går till anteckningen "Kostnadsräkning … till <domstol> skapad"
 * (#1221). Valet sparas inte på körningen, och ärendets parter rörs inte.
 */
import { TRPCError } from "@trpc/server";
import type { ContactId, MatterId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { Repositories } from "../repositories/repositories";

/** Domstolens namn ur ärendets DOMSTOL-kontakt, eller null. */
async function matterCourtName(repos: Repositories, orgId: OrganizationId, matterId: MatterId): Promise<string | null> {
  const detail = await repos.matters.getByIdWithContacts(matterId, orgId);
  // In-memory-lagret bakar bara in kontakt-joinen när seeden gjort det (demo-
  // prebake) — rå rader ger inga `contacts`. Saknas de: "domstolen" i texten.
  const contacts: ReadonlyArray<{ role: string; contact?: { name: string } | undefined }> = detail?.contacts ?? [];
  return contacts.find((c) => c.role === "DOMSTOL")?.contact?.name ?? null;
}

/**
 * Den valda domstolens namn: en kontakt i byrån med typen Domstol, annars
 * `BAD_REQUEST` (en annan byrås id ger samma fel och inget namn).
 */
async function chosenCourtName(repos: Repositories, orgId: OrganizationId, courtContactId: ContactId): Promise<string> {
  const contact = await repos.contacts.getByIdFull(courtContactId, orgId);
  if (contact?.contactType !== "COURT") throw new TRPCError({ code: "BAD_REQUEST", message: "Domstolen finns inte." });
  return contact.name;
}

/** Kostnadsräkningens domstol: vald i dialogen (`courtContactId`), annars ärendets. */
export function krCourtName(
  repos: Repositories, orgId: OrganizationId, matterId: MatterId, courtContactId: ContactId | undefined,
): Promise<string | null> {
  return courtContactId ? chosenCourtName(repos, orgId, courtContactId) : matterCourtName(repos, orgId, matterId);
}
