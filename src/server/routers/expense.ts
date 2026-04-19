import { z } from "zod";
import { router, protectedProcedure } from "../trpc";

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
        ctx.prisma.expense.findMany({
          where,
          orderBy: { date: "desc" },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          include: {
            user: { select: { id: true, name: true } },
            matter: { select: { id: true, matterNumber: true, title: true } },
          },
        }),
        ctx.prisma.expense.count({ where }),
      ]);

      const totalAmount = await ctx.prisma.expense.aggregate({
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
        matterId: z.string(),
        date: z.string(),
        amount: z.number().min(1),
        description: z.string().min(1),
        billable: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.expense.create({
        data: {
          userId: ctx.user.id,
          matterId: input.matterId,
          date: new Date(input.date),
          amount: input.amount,
          description: input.description,
          billable: input.billable,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        date: z.string().optional(),
        amount: z.number().min(1).optional(),
        description: z.string().min(1).optional(),
        billable: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, date, ...data } = input;
      return ctx.prisma.expense.update({
        where: { id },
        data: {
          ...data,
          ...(date ? { date: new Date(date) } : {}),
        },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.expense.delete({ where: { id: input.id } });
    }),
});
