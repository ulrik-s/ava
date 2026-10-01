import { z } from "zod";
import { asId } from "@/lib/shared/schemas/ids";
import { type ConflictResult, pushUnique, searchConflicts } from "../conflict/conflict-search";
import { router, protectedProcedure } from "../trpc";


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
      const { checks, total } = await ctx.repos.conflictChecks.listHistory(asId<"OrganizationId">(ctx.user.organizationId), input.page, input.pageSize);
      return { checks, total, pages: Math.ceil(total / input.pageSize) };
    }),
});
