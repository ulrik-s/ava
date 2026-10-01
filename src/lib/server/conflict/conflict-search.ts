/**
 * Jävskontrollens sökning (#1123), delad av den manuella kontrollen
 * (`conflict.check`) och ärendets automatiska kontroll (#1246).
 */

import { conflictScore, parseConflictQuery, type ConflictSearchType } from "@/lib/shared/conflict-match";
import type { MatterRole } from "@/lib/shared/schemas/enums";
import { asId, type ContactId, type MatterId } from "@/lib/shared/schemas/ids";
import type { ConflictContactRow } from "../repositories/matter-contact-repository";
import type { Repositories } from "../repositories/repositories";

/** Det sökningen behöver ur en tRPC-context. */
export type ConflictCtx = { repos: Repositories; user: { id: string; organizationId: string } };

/** En träff: kontakten och ärendet den är kopplad till. */
export interface ConflictResult {
  contactId: ContactId;
  contactName: string;
  contactType: string;
  personalNumber: string | null;
  orgNumber: string | null;
  matterId: MatterId;
  matterNumber: string;
  matterTitle: string;
  role: MatterRole;
  klient: string | null;
}

/** Rad-form från `repos.matterContacts.findForConflict`. */
type ConflictRow = ConflictContactRow;

function toResult(mc: ConflictRow): ConflictResult {
  return {
    contactId: mc.contact.id,
    contactName: mc.contact.name,
    contactType: mc.contact.contactType,
    personalNumber: mc.contact.personalNumber,
    orgNumber: mc.contact.orgNumber,
    matterId: mc.matter.id,
    matterNumber: mc.matter.matterNumber,
    matterTitle: mc.matter.title,
    role: mc.role,
    klient: mc.matter.contacts[0]?.contact.name ?? null,
  };
}

/**
 * Jävskontrollens sökning (#1123): förnamn, efternamn och person-/orgnummer —
 * tillsammans eller var för sig. Matchningen bor i `conflict-match` (ren och
 * testad); här hämtas byråns kopplingar och rangordnas, bäst först.
 */
export async function searchConflicts(ctx: ConflictCtx, term: string, searchType: ConflictSearchType): Promise<ConflictResult[]> {
  const query = parseConflictQuery(term, searchType);
  const rows = await ctx.repos.matterContacts.findForConflict(asId<"OrganizationId">(ctx.user.organizationId));
  return rows
    .map((row) => ({ row, score: conflictScore(row.contact, query, searchType) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => toResult(s.row));
}

/** Lägg till nya träffar, deduplicerat på (kontakt, ärende, roll). */
export function pushUnique(into: ConflictResult[], more: ConflictResult[]): void {
  for (const r of more) {
    const dup = into.some((x) => x.contactId === r.contactId && x.matterId === r.matterId && x.role === r.role);
    if (!dup) into.push(r);
  }
}
