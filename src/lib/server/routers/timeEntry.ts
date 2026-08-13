import { z } from "zod";
import { advokatberedskapFtaxForDate, isPerDayKind } from "@/lib/shared/brottmalstaxa";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { type TimeEntry } from "@/lib/shared/schemas/billing";
import { timeEntryKindSchema, type TimeEntryKind } from "@/lib/shared/schemas/enums";
import {
  asId,
  matterIdSchema,
  userIdSchema,
  timeEntryIdSchema,
  invoiceIdSchema,
} from "@/lib/shared/schemas/ids";
import { emit } from "../events/emit";
import { router, protectedProcedure, orgProcedure, TRPCError } from "../trpc";

/** Vad `minutes`-regeln behöver veta om posten. */
interface EntryShape {
  minutes?: number | undefined;
  kind?: TimeEntryKind | null | undefined;
  date?: string | undefined;
}

/**
 * Noll minuter är bara meningsfullt för per-dygns-kategorier (#950). Zod kan
 * inte uttrycka beroendet mellan två fält lika läsbart som en guard, och
 * felmeddelandet ska säga VILKEN kategori som gäller — inte bara "≥ 1".
 */
function assertMinutes(input: EntryShape): void {
  if ((input.minutes ?? 0) > 0 || isPerDayKind(input.kind)) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Tidsposten måste ha minst en minut. Noll minuter används bara för advokatberedskap, som ersätts per dag.",
  });
}

/** Postens á-pris: dagbeloppet för beredskap, annars användarens timtaxa. */
function rateForEntry(input: EntryShape & { hourlyRate?: number | undefined }, userRate: number): number {
  if (isPerDayKind(input.kind)) return advokatberedskapFtaxForDate(input.date ?? new Date());
  return input.hourlyRate ?? userRate;
}

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
        /**
         * Arbetad tid i minuter. Noll är tillåtet BARA för per-dygns-kategorier
         * (advokatberedskap, #950) — beredskap är inte arbetad tid, och att
         * hitta på minuter för den hade förorenat varje timbaserad summa:
         * upparbetat, rättsskyddets timtak, rapporterna.
         */
        minutes: z.number().min(0),
        description: z.string().min(1),
        billable: z.boolean().default(true),
        /** ARBETE (default), TIDSSPILLAN (#891) eller ADVOKATBEREDSKAP (#950). */
        kind: timeEntryKindSchema.optional(),
        /** Byråns standardåtgärd posten registrerades ur (#956) — spårbarhet. */
        standardAtgardId: z.string().optional(),
        // Valfria setup-fält (demo-generator/fixtures, ADR 0003).
        id: timeEntryIdSchema.optional(),
        userId: userIdSchema.optional(),
        hourlyRate: z.number().optional(),
        invoiceId: invoiceIdSchema.nullable().optional(),
        createdAt: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertMinutes(input);
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
        // Per-dygns-kategorier har ingen timtaxa; posten bär DAGBELOPPET så den
        // råa raden är läsbar. Värderingen läser ändå alltid årstabellen (#950).
        hourlyRate: rateForEntry(input, user.hourlyRate ?? 0),
        kind: input.kind,
        standardAtgardId: input.standardAtgardId,
        billable: input.billable,
        invoiceId: input.invoiceId ?? null,
        ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
      }) satisfies Partial<TimeEntry>);
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
        /** Arvodeskategori (#953) — styr vilken årsnorm slutregleringen värderar
         *  posten på. Rättbar i efterhand: kategorin missas lätt vid inmatning. */
        kind: timeEntryKindSchema.optional(),
        /** Byråns standardåtgärd (#956). Sätts när posten byter till/från en standard. */
        standardAtgardId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Säkerhet (#60): org-ägarskap via matter (samma scopning som `list`)
      // INNAN update. NOT_FOUND vid mismatch.
      const owned = await ctx.repos.timeEntries.getByIdInOrg(input.id, ctx.orgId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      const { id, date, minutes, description, billable, kind, standardAtgardId } = input;
      const updated = await ctx.repos.timeEntries.update(id, omitUndefined({
        minutes,
        description,
        billable,
        kind,
        standardAtgardId,
        ...(date ? { date: new Date(date) } : {}),
      }) satisfies Partial<TimeEntry>);
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
        userIds: z.array(userIdSchema).optional(),
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
