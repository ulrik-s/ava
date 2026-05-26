import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { similarity } from "@/lib/client/fuzzy-similarity";

export const conflictRouter = router({
  check: protectedProcedure
    .input(
      z.object({
        searchTerm: z.string().min(1),
        searchType: z.enum(["name", "personalNumber", "both"]).default("both"),
      })
    )
    // eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Async arrow function has a complexity of 12. Maximum allowed is 8.)
    .mutation(async ({ ctx, input }) => {
      const results: Array<{
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
      }> = [];

      // Search by personal/org number (exact substring match)
      if (input.searchType === "personalNumber" || input.searchType === "both") {
        const byNumber = await ctx.dataStore.matterContacts.findMany({
          where: {
            matter: { organizationId: ctx.user.organizationId },
            contact: {
              OR: [
                { personalNumber: { contains: input.searchTerm } },
                { orgNumber: { contains: input.searchTerm } },
              ],
            },
          },
          include: {
            contact: true,
            matter: {
              include: {
                contacts: {
                  where: { role: "KLIENT" },
                  include: { contact: { select: { name: true } } },
                  take: 1,
                },
              },
            },
          },
        });

        for (const mc of byNumber) {
          const klient = mc.matter.contacts[0]?.contact.name ?? null;
          results.push({
            contactId: mc.contact.id,
            contactName: mc.contact.name,
            contactType: mc.contact.contactType,
            personalNumber: mc.contact.personalNumber,
            orgNumber: mc.contact.orgNumber,
            matterId: mc.matter.id,
            matterNumber: mc.matter.matterNumber,
            matterTitle: mc.matter.title,
            role: mc.role,
            klient,
          });
        }
      }

      // Search by name (fuzzy via in-memory bigram-Jaccard similarity).
      // Tidigare användes Postgres' pg_trgm.similarity() via $queryRaw —
      // ersatt nu eftersom git-modellen inte har en SQL-databas.
      if (input.searchType === "name" || input.searchType === "both") {
        const SIM_THRESHOLD = 0.4;
        const byName = await ctx.dataStore.matterContacts.findMany({
          where: { matter: { organizationId: ctx.user.organizationId } },
          include: {
            contact: true,
            matter: {
              include: {
                contacts: {
                  where: { role: "KLIENT" },
                  include: { contact: { select: { name: true } } },
                  take: 1,
                },
              },
            },
          },
        });

        type NamedScore = { row: typeof byName[number]; score: number };
        const scored: NamedScore[] = byName
          .map((row) => ({ row, score: similarity(row.contact.name, input.searchTerm) }))
          .filter((s) => s.score > SIM_THRESHOLD)
          .sort((a, b) => b.score - a.score);

        for (const { row } of scored) {
          if (results.some((r) => r.contactId === row.contact.id && r.matterId === row.matter.id && r.role === row.role)) {
            continue;
          }
          const klient = row.matter.contacts[0]?.contact.name ?? null;
          results.push({
            contactId: row.contact.id,
            contactName: row.contact.name,
            contactType: row.contact.contactType,
            personalNumber: row.contact.personalNumber,
            orgNumber: row.contact.orgNumber,
            matterId: row.matter.id,
            matterNumber: row.matter.matterNumber,
            matterTitle: row.matter.title,
            role: row.role,
            klient,
          });
        }
      }

      // Log the check
      await ctx.dataStore.conflictChecks.create({
        data: {
          searchTerm: input.searchTerm,
          searchType: input.searchType,
          results: results as unknown as object,
          checkedById: ctx.user.id,
        },
      });

      return {
        results,
        matchCount: results.length,
        searchTerm: input.searchTerm,
      };
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
