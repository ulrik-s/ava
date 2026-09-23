import { z } from "zod";
import { conflictScore, parseConflictQuery, type ConflictSearchType } from "@/lib/shared/conflict-match";
import { asId, type ContactId, type MatterId } from "@/lib/shared/schemas/ids";
import type { ConflictContactRow } from "../repositories/matter-contact-repository";
import type { Repositories } from "../repositories/repositories";
import { router, protectedProcedure } from "../trpc";

type ConflictCtx = { repos: Repositories; user: { id: string; organizationId: string } };

interface ConflictResult {
  contactId: ContactId;
  contactName: string;
  contactType: string;
  personalNumber: string | null;
  orgNumber: string | null;
  matterId: MatterId;
  matterNumber: string;
  matterTitle: string;
  role: string;
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
async function searchConflicts(ctx: ConflictCtx, term: string, searchType: ConflictSearchType): Promise<ConflictResult[]> {
  const query = parseConflictQuery(term, searchType);
  const rows = await ctx.repos.matterContacts.findForConflict(asId<"OrganizationId">(ctx.user.organizationId));
  return rows
    .map((row) => ({ row, score: conflictScore(row.contact, query, searchType) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => toResult(s.row));
}

/** Lägg till nya träffar, deduplicerat på (kontakt, ärende, roll). */
function pushUnique(into: ConflictResult[], more: ConflictResult[]): void {
  for (const r of more) {
    const dup = into.some((x) => x.contactId === r.contactId && x.matterId === r.matterId && x.role === r.role);
    if (!dup) into.push(r);
  }
}

export const conflictRouter = router({
  check: protectedProcedure
    .input(
      z.object({
        searchTerm: z.string().min(1),
        searchType: z.enum(["name", "personalNumber", "both"]).default("both"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const results: ConflictResult[] = [];
      pushUnique(results, await searchConflicts(ctx, input.searchTerm, input.searchType));

      // Logga sökningen
      await ctx.repos.conflictChecks.create({
        searchTerm: input.searchTerm,
        searchType: input.searchType,
        results,
        checkedById: asId<"UserId">(ctx.user.id),
      });

      return { results, matchCount: results.length, searchTerm: input.searchTerm };
    }),

  history: protectedProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const { checks, total } = await ctx.repos.conflictChecks.listHistory(input.page, input.pageSize);
      return { checks, total, pages: Math.ceil(total / input.pageSize) };
    }),
});
