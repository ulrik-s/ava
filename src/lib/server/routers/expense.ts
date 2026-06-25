import { z } from "zod";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { Expense } from "@/lib/shared/schemas/billing";
import {
  asId,
  matterIdSchema,
  userIdSchema,
  expenseIdSchema,
  invoiceIdSchema,
} from "@/lib/shared/schemas/ids";
import { router, protectedProcedure, orgProcedure, TRPCError } from "../trpc";

export const expenseRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        matterId: matterIdSchema.optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(50),
      })
    )
    // Migrerad till repository-sömmen (ADR 0020): paginerad list + summa via
    // typad listForOrg (org-scope, include + count + sum inkapslat).
    .query(async ({ ctx, input }) => {
      const { expenses, total, totalAmount } = await ctx.repos.expenses.listForOrg(
        ctx.user.organizationId,
        { matterId: input.matterId, page: input.page, pageSize: input.pageSize },
      );
      return {
        expenses,
        total,
        totalAmount,
        pages: Math.ceil(total / input.pageSize),
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        matterId: matterIdSchema,
        date: z.string(),
        amount: z.number().min(1),
        description: z.string().min(1),
        billable: z.boolean().default(true),
        /** Moms-sats i basis points (0/600/1200/2500). Default 25 %. */
        vatRate: z.number().int().nonnegative().max(10000).default(2500),
        /** True om `amount` är inkl moms. Default false — utlägg lagras netto (#782). */
        vatIncluded: z.boolean().default(false),
        // Valfria setup-fält (demo-generator/fixtures, ADR 0003).
        id: expenseIdSchema.optional(),
        userId: userIdSchema.optional(),
        invoiceId: invoiceIdSchema.nullable().optional(),
        createdAt: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.repos.expenses.create(omitUndefined({
        id: input.id, // undefined → store genererar
        userId: input.userId ?? asId<"UserId">(ctx.user.id),
        matterId: input.matterId,
        date: new Date(input.date),
        amount: input.amount,
        description: input.description,
        billable: input.billable,
        vatRate: input.vatRate,
        vatIncluded: input.vatIncluded,
        invoiceId: input.invoiceId ?? null,
        ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
      }) satisfies Partial<Expense>);
    }),

  update: orgProcedure
    .input(
      z.object({
        id: expenseIdSchema,
        date: z.string().optional(),
        amount: z.number().min(1).optional(),
        description: z.string().min(1).optional(),
        billable: z.boolean().optional(),
        vatRate: z.number().int().nonnegative().max(10000).optional(),
        vatIncluded: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Säkerhet (#60): verifiera org-ägarskap (via matter, samma scopning som
      // `list`) INNAN update. NOT_FOUND vid mismatch — läcker inte existens.
      const owned = await ctx.repos.expenses.getByIdInOrg(input.id, ctx.orgId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      const { id, date, amount, description, billable, vatRate, vatIncluded } = input;
      return ctx.repos.expenses.update(id, omitUndefined({
        amount,
        description,
        billable,
        vatRate,
        vatIncluded,
        ...(date ? { date: new Date(date) } : {}),
      }) satisfies Partial<Expense>);
    }),

  delete: orgProcedure
    .input(z.object({ id: expenseIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.repos.expenses.getByIdInOrg(input.id, ctx.orgId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      // Hård delete bevarar dagens beteende (utlägg tombstone-as ej). Se ADR 0017-
      // not om delete-policy (cross-cutting, ej avgjort per router).
      await ctx.repos.expenses.hardDelete(input.id);
      return { id: input.id };
    }),
});
