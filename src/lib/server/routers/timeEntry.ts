import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { emit } from "../events/emit";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import {
  asId,
  matterIdSchema,
  userIdSchema,
  timeEntryIdSchema,
  invoiceIdSchema,
} from "@/lib/shared/schemas/ids";

export const timeEntryRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        matterId: z.string().optional(),
        userId: z.string().optional(),
        from: z.date().optional(),
        to: z.date().optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = {
        matter: { organizationId: ctx.user.organizationId },
        ...(input.matterId ? { matterId: input.matterId } : {}),
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.from || input.to
          ? {
              date: {
                ...(input.from ? { gte: input.from } : {}),
                ...(input.to ? { lte: input.to } : {}),
              },
            }
          : {}),
      };

      const [entries, total] = await Promise.all([
        ctx.dataStore.timeEntries.findMany({
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
        ctx.dataStore.timeEntries.count({ where }),
      ]);

      const totalMinutes = await ctx.dataStore.timeEntries.aggregate({
        where,
        _sum: { minutes: true },
      });

      return {
        entries,
        total,
        totalMinutes: totalMinutes._sum.minutes ?? 0,
        pages: Math.ceil(total / input.pageSize),
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        matterId: matterIdSchema,
        date: z.string(), // ISO date string YYYY-MM-DD
        minutes: z.number().min(1),
        description: z.string().min(1),
        billable: z.boolean().default(true),
        // Valfria setup-fält (demo-generator/fixtures, ADR 0003).
        id: timeEntryIdSchema.optional(),
        userId: userIdSchema.optional(),
        hourlyRate: z.number().optional(),
        invoiceId: invoiceIdSchema.nullable().optional(),
        createdAt: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = input.userId ?? asId<"UserId">(ctx.user.id);
      const user = await ctx.dataStore.users.findUniqueOrThrow({
        where: { id: userId },
        select: { hourlyRate: true },
      });

      const entry = await ctx.dataStore.timeEntries.create({
        data: omitUndefined({
          id: input.id, // undefined → store genererar
          userId,
          matterId: input.matterId,
          date: new Date(input.date),
          minutes: input.minutes,
          description: input.description,
          hourlyRate: input.hourlyRate ?? user.hourlyRate ?? 0,
          billable: input.billable,
          invoiceId: input.invoiceId ?? null,
          ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
        }),
      });
      await emit.timeEntryAdded(ctx, { id: entry.id, matterId: entry.matterId, minutes: entry.minutes });
      return entry;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        date: z.string().optional(),
        minutes: z.number().min(1).optional(),
        description: z.string().min(1).optional(),
        billable: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, date, minutes, description, billable } = input;
      const updated = await ctx.dataStore.timeEntries.update({
        where: { id },
        data: omitUndefined({
          minutes,
          description,
          billable,
          ...(date ? { date: new Date(date) } : {}),
        }),
      });
      await emit.timeEntryUpdated(ctx, { id: updated.id, matterId: updated.matterId });
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const entry = await ctx.dataStore.timeEntries.delete({ where: { id: input.id } });
      await emit.timeEntryDeleted(ctx, entry.id, entry.matterId);
      return entry;
    }),

  report: protectedProcedure
    .input(
      z.object({
        from: z.string(),
        to: z.string(),
        userId: z.string().optional(),
        userIds: z.array(z.string()).optional(),
        matterId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userFilter = input.userIds && input.userIds.length > 0
        ? { userId: { in: input.userIds } }
        : input.userId
          ? { userId: input.userId }
          : {};
      const where = {
        matter: { organizationId: ctx.user.organizationId },
        date: { gte: new Date(input.from), lte: new Date(input.to) },
        ...userFilter,
        ...(input.matterId ? { matterId: input.matterId } : {}),
      };

      const entries = await ctx.dataStore.timeEntries.findMany({
        where,
        include: {
          user: { select: { id: true, name: true } },
          matter: {
            select: {
              id: true, matterNumber: true, title: true,
              contacts: {
                where: { role: "KLIENT" },
                select: { contact: { select: { name: true } } },
                take: 1,
              },
            },
          },
        },
        orderBy: [{ userId: "asc" }, { date: "asc" }],
      });

      // Group by user
      const byUser: Record<string, { name: string; totalMinutes: number; billableMinutes: number; entries: typeof entries }> = {};
      for (const entry of entries) {
        if (!byUser[entry.userId]) {
          byUser[entry.userId] = { name: entry.user.name, totalMinutes: 0, billableMinutes: 0, entries: [] };
        }
        byUser[entry.userId].totalMinutes += entry.minutes;
        if (entry.billable) byUser[entry.userId].billableMinutes += entry.minutes;
        byUser[entry.userId].entries.push(entry);
      }

      return { byUser, totalEntries: entries.length };
    }),
});
