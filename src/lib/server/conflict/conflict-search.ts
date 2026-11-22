/**
 * Jävskontrollens sökning (#1123), delad av den manuella kontrollen
 * (`conflict.check`) och ärendets automatiska kontroll (#1246).
 */

import { conflictScore, parseConflictQuery, type ConflictSearchType } from "@/lib/shared/conflict-match";
import type { ConflictCheckStatus, MatterRole, MatterStatus } from "@/lib/shared/schemas/enums";
import { asId, type ContactId, type MatterId } from "@/lib/shared/schemas/ids";
import type { ConflictHit } from "@/lib/shared/schemas/misc";
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
  /** Ärendets status (#1641) — visas i träfflistan, loggas inte. */
  matterStatus: MatterStatus;
  role: MatterRole;
  klient: string | null;
}

/** Det som sparas i jävskontrollens historik: träffen utan ärendets status. */
export type LoggedConflictResult = Omit<ConflictResult, "matterStatus">;

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
    matterStatus: mc.matter.status,
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

/**
 * Snapshoten som loggas i `conflictChecks.results` (#1641): samma fält som
 * före `matterStatus`, så historiken inte ändras.
 */
export function toLoggedResult(result: ConflictResult): LoggedConflictResult {
  const { matterStatus: _status, ...logged } = result;
  return logged;
}

/**
 * Det som identifierar en träff (#1819): kontakten, ärendet och rollen. Gäller
 * `ConflictResult`, den sparade `ConflictHit` och bedömningens träffar.
 */
export type ConflictHitIdentity = Pick<ConflictHit, "contactId" | "matterId" | "role">;

/** Träffens nyckel: (kontakt, ärende, roll). Dedupliceringen, omkontrollen och bedömningen använder den. */
export function conflictHitKey(hit: ConflictHitIdentity): string {
  return `${hit.contactId}:${hit.matterId}:${hit.role}`;
}

/**
 * Träffen som sparas på ärendet (#1819): utan personnummer, organisationsnummer
 * och klientnamn.
 */
export function toConflictHit(result: ConflictResult): ConflictHit {
  const { contactId, contactName, role, matterId, matterNumber, matterTitle } = result;
  return { contactId, contactName, role, matterId, matterNumber, matterTitle };
}

/**
 * Är varje träff i `hits` redan bedömd? Färre träffar än vid bedömningen räknas
 * som bedömda. Utan sparad bedömning (`null`) är inget bedömt.
 */
export function allReviewed(hits: readonly ConflictHitIdentity[], reviewed: readonly ConflictHitIdentity[] | null | undefined): boolean {
  if (!reviewed) return false;
  const keys = new Set(reviewed.map(conflictHitKey));
  return hits.every((hit) => keys.has(conflictHitKey(hit)));
}

/** Kontrollens status: inga träffar, bara redan bedömda träffar, eller nya träffar att bedöma. */
export function conflictStatusFor(
  hits: readonly ConflictHitIdentity[],
  reviewed: readonly ConflictHitIdentity[] | null | undefined,
): Exclude<ConflictCheckStatus, "PENDING"> {
  if (hits.length === 0) return "CLEAR";
  return allReviewed(hits, reviewed) ? "REVIEWED" : "HITS";
}

/** Lägg till nya träffar, deduplicerat på `conflictHitKey`. */
export function pushUnique(into: ConflictResult[], more: ConflictResult[]): void {
  const seen = new Set(into.map(conflictHitKey));
  for (const r of more) {
    const key = conflictHitKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    into.push(r);
  }
}
