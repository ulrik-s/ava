import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import type { IDataStore } from "../data-store/IDataStore";
import { similarity } from "@/lib/shared/fuzzy-similarity";

type ConflictCtx = { dataStore: IDataStore; user: { id: string; organizationId: string } };

interface ConflictResult {
  contactId: string;
  contactName: string;
  contactType: string;
  personalNumber: string | null;
  orgNumber: string | null;
  matterId: string;
  matterNumber: string;
  matterTitle: string;
  role: string;
  klient: string | null;
}

/** Rad-form från matterContacts.findMany med MC_INCLUDE. */
interface ConflictRow {
  contact: { id: string; name: string; contactType: string; personalNumber: string | null; orgNumber: string | null };
  matter: { id: string; matterNumber: string; title: string; contacts: Array<{ contact: { name: string } }> };
  role: string;
}

// Tar med klient-namnet (kontext) ihop med kontakt + ärende.
const MC_INCLUDE = {
  contact: true,
  matter: {
    include: {
      contacts: { where: { role: "KLIENT" }, include: { contact: { select: { name: true } } }, take: 1 },
    },
  },
} as const;

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

/** Exakt delsträngsmatch på person-/org-nummer. */
async function searchByNumber(ctx: ConflictCtx, term: string): Promise<ConflictResult[]> {
  const rows = await ctx.dataStore.matterContacts.findMany({
    where: {
      matter: { organizationId: ctx.user.organizationId },
      contact: { OR: [{ personalNumber: { contains: term } }, { orgNumber: { contains: term } }] },
    },
    include: MC_INCLUDE,
  });
  return (rows as ConflictRow[]).map(toResult);
}

/**
 * Fuzzy namnmatch via in-memory bigram-Jaccard similarity. Tidigare användes
 * Postgres' pg_trgm.similarity() via $queryRaw — ersatt eftersom git-modellen
 * inte har en SQL-databas.
 */
async function searchByName(ctx: ConflictCtx, term: string): Promise<ConflictResult[]> {
  const SIM_THRESHOLD = 0.4;
  const rows = await ctx.dataStore.matterContacts.findMany({
    where: { matter: { organizationId: ctx.user.organizationId } },
    include: MC_INCLUDE,
  });
  return (rows as ConflictRow[])
    .map((row) => ({ row, score: similarity(row.contact.name, term) }))
    .filter((s) => s.score > SIM_THRESHOLD)
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
      if (input.searchType !== "name") pushUnique(results, await searchByNumber(ctx, input.searchTerm));
      if (input.searchType !== "personalNumber") pushUnique(results, await searchByName(ctx, input.searchTerm));

      // Logga sökningen
      await ctx.dataStore.conflictChecks.create({
        data: {
          searchTerm: input.searchTerm,
          searchType: input.searchType,
          results: results as unknown as object,
          checkedById: ctx.user.id,
        },
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
      const [checks, total] = await Promise.all([
        ctx.dataStore.conflictChecks.findMany({
          orderBy: { createdAt: "desc" },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          include: { checkedBy: { select: { name: true } } },
        }),
        ctx.dataStore.conflictChecks.count(),
      ]);

      return { checks, total, pages: Math.ceil(total / input.pageSize) };
    }),
});
