/**
 * Ärendets jävskontroll (#1246, #1354).
 *
 * Advokatetiken kräver kontrollen innan uppdraget tas. Ärendets parter —
 * klienten, motparten och motpartens ombud — söks på namn och person-/
 * organisationsnummer mot byråns alla andra ärenden. En träff räknas när
 * personen står på andra sidan där (`conflict-roles`): en återkommande klient
 * är ingen jävsfråga, en klient som är motpart i ett annat ärende är det.
 * Ärendet bär resultatet: inga träffar, träffar att bedöma, eller väntar.
 *
 * Offline har klienten bara sin lokala kopia, som inte behöver innehålla hela
 * byrån. Klientens optimistiska körning (`ctx.provisional`) avgör därför
 * ingenting och lämnar kontrollen som väntande. Servern kör om anropet mot
 * byråns alla data när det når den, och dess resultat ersätter det väntande
 * vid nästa synk. Utan klient finns inget att kontrollera än; ärendet väntar
 * tills kontrollen körs om.
 */

import { isCheckedRole, isConflictingRole } from "@/lib/shared/conflict-roles";
import type { Contact } from "@/lib/shared/schemas/contact";
import type { ConflictCheckStatus, MatterRole } from "@/lib/shared/schemas/enums";
import { asId, type ContactId, type MatterId } from "@/lib/shared/schemas/ids";
import { callTime, newRowId, type QueuedCallScope } from "../queued-call";
import { type ConflictCtx, type ConflictResult, pushUnique, searchConflicts } from "./conflict-search";

/** Fälten ärendet får av kontrollen. */
export type MatterConflictPatch = {
  conflictCheckStatus: ConflictCheckStatus;
  conflictCheckHits: number | null;
  conflictCheckedAt: Date | null;
};

/** En part i ärendet: kontakten och dess roll. */
export interface MatterParty {
  contactId: ContactId;
  role: MatterRole;
}

type CheckCtx = ConflictCtx & QueuedCallScope & { provisional?: true | undefined };

/** En part som ska kontrolleras, med kontaktens uppgifter. */
type ResolvedParty = { role: MatterRole; contact: Pick<Contact, "id" | "name" | "personalNumber" | "orgNumber"> };

const PENDING: MatterConflictPatch = { conflictCheckStatus: "PENDING", conflictCheckHits: null, conflictCheckedAt: null };

/** Söktermen: partens namn och nummer — sökningen matchar på vilket som helst. */
function termFor(party: Pick<Contact, "name" | "personalNumber" | "orgNumber">): string {
  return [party.name, party.personalNumber ?? party.orgNumber].filter(Boolean).join(" ");
}

/** Parterna som kontrolleras (klient- och motsidan), en gång per kontakt och roll. */
function checkedParties(parties: readonly MatterParty[]): MatterParty[] {
  const seen = new Set<string>();
  return parties.filter((p) => {
    const key = `${p.contactId}:${p.role}`;
    if (!isCheckedRole(p.role) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Kontakterna bakom parterna; en raderad kontakt hoppas över. */
async function resolveParties(ctx: CheckCtx, parties: readonly MatterParty[]): Promise<ResolvedParty[]> {
  const orgId = asId<"OrganizationId">(ctx.user.organizationId);
  const resolved = await Promise.all(parties.map(async (p): Promise<ResolvedParty[]> => {
    const contact = await ctx.repos.contacts.getByIdFull(p.contactId, orgId);
    return contact ? [{ role: p.role, contact }] : [];
  }));
  return resolved.flat();
}

/**
 * Sök en part och logga kontrollen. Träffar i ärendet självt räknas inte, och
 * inte heller träffar på samma sida (klient här och klient där).
 */
async function checkParty(ctx: CheckCtx, matterId: MatterId, party: ResolvedParty): Promise<ConflictResult[]> {
  const term = termFor(party.contact);
  const results = (await searchConflicts(ctx, term, "both"))
    .filter((r) => r.matterId !== matterId && isConflictingRole(party.role, r.role));
  await ctx.repos.conflictChecks.create({
    id: asId<"ConflictCheckId">(newRowId(ctx, `conflictCheck:${party.contact.id}:${party.role}`)),
    searchTerm: term, searchType: "both", results, checkedById: asId<"UserId">(ctx.user.id),
  });
  return results;
}

/**
 * Kör kontrollen för ärendets parter och logga den (en loggrad per part).
 * Returnerar ärendets nya fält. Utan klient väntar kontrollen.
 */
export async function checkMatterConflicts(ctx: CheckCtx, matterId: MatterId, parties: readonly MatterParty[]): Promise<MatterConflictPatch> {
  if (ctx.provisional) return PENDING;
  const resolved = await resolveParties(ctx, checkedParties(parties));
  if (!resolved.some((p) => p.role === "KLIENT")) return PENDING;
  const hits: ConflictResult[] = [];
  // En i taget: loggradernas ordning ska vara densamma i varje körning.
  for (const party of resolved) pushUnique(hits, await checkParty(ctx, matterId, party));
  return {
    conflictCheckStatus: hits.length > 0 ? "HITS" : "CLEAR",
    conflictCheckHits: hits.length,
    conflictCheckedAt: callTime(ctx),
  };
}
