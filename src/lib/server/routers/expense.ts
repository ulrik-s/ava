import { z } from "zod";
import { omitUndefined } from "@/lib/shared/omit-undefined";
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
        matterId: z.string().optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = {
        matter: { organizationId: ctx.user.organizationId },
        ...(input.matterId ? { matterId: input.matterId } : {}),
      };

      const [expenses, total] = await Promise.all([
        ctx.dataStore.expenses.findMany({
          where,
          orderBy: { date: "desc" },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          include: {
            user: { select: { id: true, name: true } },
            matter: { select: { id: true, matterNumber: true, title: true } },
            invoice: { select: { id: true, invoiceNumber: true } },
          },
        }),
        ctx.dataStore.expenses.count({ where }),
      ]);

      const totalAmount = await ctx.dataStore.expenses.aggregate({
        where,
        _sum: { amount: true },
      });

      return {
        expenses,
        total,
        totalAmount: totalAmount._sum.amount ?? 0,
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
        /** True om `amount` är inkl moms (kvitto-fall). Default true. */
        vatIncluded: z.boolean().default(true),
        // Valfria setup-fält (demo-generator/fixtures, ADR 0003).
        id: expenseIdSchema.optional(),
        userId: userIdSchema.optional(),
        invoiceId: invoiceIdSchema.nullable().optional(),
        createdAt: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.expenses.create({
        data: omitUndefined({
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
        }),
      });
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string(),
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
      const owned = await ctx.dataStore.expenses.findFirst({
        where: { id: input.id, matter: { organizationId: ctx.orgId } },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      const { id, date, amount, description, billable, vatRate, vatIncluded } = input;
      return ctx.dataStore.expenses.update({
        where: { id },
        data: omitUndefined({
          amount,
          description,
          billable,
          vatRate,
          vatIncluded,
          ...(date ? { date: new Date(date) } : {}),
        }),
      });
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.dataStore.expenses.findFirst({
        where: { id: input.id, matter: { organizationId: ctx.orgId } },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.dataStore.expenses.delete({ where: { id: input.id } });
    }),
});
