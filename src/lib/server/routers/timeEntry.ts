import { z } from "zod";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { TimeEntry } from "@/lib/shared/schemas/billing";
import {
  asId,
  matterIdSchema,
  userIdSchema,
  timeEntryIdSchema,
  invoiceIdSchema,
} from "@/lib/shared/schemas/ids";
import { emit } from "../events/emit";
import { router, protectedProcedure, orgProcedure, TRPCError } from "../trpc";

export const timeEntryRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        matterId: matterIdSchema.optional(),
        userId: userIdSchema.optional(),
        from: z.date().optional(),
        to: z.date().optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(50),
      })
    )
    // Migrerad till repository-sömmen (ADR 0020): listForOrg kapslar in
    // filter/include/count/summa.
    .query(async ({ ctx, input }) => {
      const { entries, total, totalMinutes } = await ctx.repos.timeEntries.listForOrg(ctx.user.organizationId, {
        matterId: input.matterId,
        userId: input.userId,
        from: input.from,
        to: input.to,
        page: input.page,
        pageSize: input.pageSize,
      });
      return { entries, total, totalMinutes, pages: Math.ceil(total / input.pageSize) };
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
      const user = await ctx.repos.users.getById(userId);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Användare finns inte." });

      const entry = await ctx.repos.timeEntries.create(omitUndefined({
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
      }) as Partial<TimeEntry>);
      await emit.timeEntryAdded(ctx, { id: entry.id, matterId: entry.matterId, minutes: entry.minutes });
      return entry;
    }),

  update: orgProcedure
    .input(
      z.object({
        id: timeEntryIdSchema,
        date: z.string().optional(),
        minutes: z.number().min(1).optional(),
        description: z.string().min(1).optional(),
        billable: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Säkerhet (#60): org-ägarskap via matter (samma scopning som `list`)
      // INNAN update. NOT_FOUND vid mismatch.
      const owned = await ctx.repos.timeEntries.getByIdInOrg(input.id, ctx.orgId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      const { id, date, minutes, description, billable } = input;
      const updated = await ctx.repos.timeEntries.update(id, omitUndefined({
        minutes,
        description,
        billable,
        ...(date ? { date: new Date(date) } : {}),
      }) as Partial<TimeEntry>);
      await emit.timeEntryUpdated(ctx, { id: updated.id, matterId: updated.matterId });
      return updated;
    }),

  delete: orgProcedure
    .input(z.object({ id: timeEntryIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.repos.timeEntries.getByIdInOrg(input.id, ctx.orgId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      // Hård delete bevarar dagens beteende (ADR 0017-delete-policy öppen).
      await ctx.repos.timeEntries.hardDelete(input.id);
      await emit.timeEntryDeleted(ctx, input.id, owned.matterId);
      return { id: input.id };
    }),

  report: protectedProcedure
    .input(
      z.object({
        from: z.string(),
        to: z.string(),
        userId: userIdSchema.optional(),
        userIds: z.array(z.string()).optional(),
        matterId: matterIdSchema.optional(),
      })
    )
    // Migrerad till repository-sömmen (ADR 0020): listForReport (jurist + ärende
    // inkl. KLIENT-kontakt). Grupperingen per jurist bor kvar i routern.
    .query(async ({ ctx, input }) => {
      const entries = await ctx.repos.timeEntries.listForReport(ctx.user.organizationId, {
        from: new Date(input.from),
        to: new Date(input.to),
        userId: input.userId,
        userIds: input.userIds,
        matterId: input.matterId,
      });

      // Group by user
      const byUser: Record<string, { name: string; totalMinutes: number; billableMinutes: number; entries: typeof entries }> = {};
      for (const entry of entries) {
        const bucket = byUser[entry.userId] ??= {
          name: entry.user.name, totalMinutes: 0, billableMinutes: 0, entries: [],
        };
        bucket.totalMinutes += entry.minutes;
        if (entry.billable) bucket.billableMinutes += entry.minutes;
        bucket.entries.push(entry);
      }

      return { byUser, totalEntries: entries.length };
    }),
});
