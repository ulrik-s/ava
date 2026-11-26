import { z } from "zod";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { ReportSubject } from "@/lib/shared/report-subject";
import { type TimeEntry } from "@/lib/shared/schemas/billing";
import { isoDayInput } from "@/lib/shared/schemas/common";
import { timeEntryKindSchema } from "@/lib/shared/schemas/enums";
import { asId, matterIdSchema, userIdSchema, timeEntryIdSchema, invoiceIdSchema } from "@/lib/shared/schemas/ids";
import { stockholmPeriod } from "@/lib/shared/stockholm-time";
import { buildTimeChart } from "@/lib/shared/time-chart";
import { isAllowedMinutes, TIME_NOT_ALLOWED_MESSAGE } from "@/lib/shared/time-hours";
import { requireMatterInOrg, requireUserInOrg } from "../auth/org-scope";
import { assertSetupFieldsAllowed, onBehalfOf } from "../auth/setup-fields";
import { loadRadgivningStatus, markEntryAsRadgivning, type MarkRadgivningCall } from "../billing/radgivning-entry";
import { emit } from "../events/emit";
import { callTime, newRowId } from "../queued-call";
import { loadPeriodWork } from "../reports/period-work";
import { assertEditable, assertMinutes, rateOnCreate, rateOnKindChange } from "../time-entries/entry-rules";
import { moveEntries } from "../time-entries/move-entries";
import { loadTimeReport } from "../time-entries/time-report";
import { router, protectedProcedure, orgProcedure, TRPCError } from "../trpc";

export const timeEntryRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        matterId: matterIdSchema.optional(),
        userId: userIdSchema.optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
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

  /**
   * En persons, eller utan `userId` hela byråns (#2115), registrerade tid per
   * dag, vecka eller månad i ett intervall (#2109), för stapeldiagrammen.
   * Samma åtkomst och hämtning som rapporterna (`loadPeriodWork`): byrån ur
   * sessionen och läsning via repona, så en person i en annan byrå ger tomma
   * staplar. Indelningen är `buildTimeChart`.
   */
  chart: protectedProcedure
    .input(z.object({
      from: isoDayInput,
      to: isoDayInput,
      userId: userIdSchema.optional(),
      granularity: z.enum(["day", "week", "month"]),
    }))
    .query(async ({ ctx, input }) => {
      const period = stockholmPeriod(input.from, input.to);
      const subject: ReportSubject = input.userId ? { kind: "lawyer", userId: input.userId } : { kind: "firm" };
      const { timeEntries } = await loadPeriodWork(ctx.repos, ctx.user.organizationId, subject, period.from, period.to);
      return buildTimeChart({ entries: timeEntries, from: input.from, to: input.to, granularity: input.granularity });
    }),

  create: orgProcedure
    .input(
      z.object({
        matterId: matterIdSchema,
        date: z.string(), // ISO date string YYYY-MM-DD
        /**
         * Arbetad tid i minuter. Noll är tillåtet BARA för per-dygns-kategorier
         * (advokatberedskap, #950) — beredskap är inte arbetad tid, och att
         * hitta på minuter för den hade förorenat varje timbaserad summa:
         * upparbetat, rättsskyddets timtak, rapporterna. Bara tillåtna
         * tidsvärden (#1544, `time-hours`).
         */
        minutes: z.number().min(0).refine(isAllowedMinutes, TIME_NOT_ALLOWED_MESSAGE),
        description: z.string().min(1),
        billable: z.boolean().default(true),
        /** ARBETE (default), TIDSSPILLAN (#891) eller ADVOKATBEREDSKAP (#950). */
        kind: timeEntryKindSchema.optional(),
        /** Byråns standardåtgärd posten registrerades ur (#956) — spårbarhet. */
        standardAtgardId: z.string().optional(),
        /** Klientens id (köade anrop) — annars skapar storen ett. */
        id: timeEntryIdSchema.optional(),
        // Setup-fält (demo-generator/fixtures, ADR 0003) — bara ADMIN, aldrig
        // via kön (`setup-fields.ts`, #1345).
        userId: userIdSchema.optional(),
        hourlyRate: z.number().optional(),
        invoiceId: invoiceIdSchema.nullable().optional(),
        createdAt: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertMinutes(input);
      assertSetupFieldsAllowed(ctx, {
        userId: onBehalfOf(ctx, input.userId), hourlyRate: input.hourlyRate,
        invoiceId: input.invoiceId, createdAt: input.createdAt,
      });
      // Ärendet och juristen måste tillhöra byrån (#1345) — servern kör om
      // anropet ur kön som den som skickade det.
      await requireMatterInOrg(ctx, input.matterId);
      const userId = input.userId ?? ctx.user.id;
      const user = await requireUserInOrg(ctx, userId);
      const rate = await rateOnCreate(ctx.repos, ctx.orgId, { ...input, userRates: user.hourlyRates }, input.hourlyRate);

      const entry = await ctx.repos.timeEntries.create(omitUndefined({
        id: input.id, // undefined → store genererar
        userId,
        matterId: input.matterId,
        date: new Date(input.date),
        minutes: input.minutes,
        description: input.description,
        hourlyRate: rate,
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
        minutes: z.number().min(1).refine(isAllowedMinutes, TIME_NOT_ALLOWED_MESSAGE).optional(),
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
      assertEditable(owned);
      const { id, date, minutes, description, billable, kind, standardAtgardId } = input;
      const updated = await ctx.repos.timeEntries.update(id, omitUndefined({
        minutes,
        description,
        billable,
        kind,
        standardAtgardId,
        hourlyRate: await rateOnKindChange(ctx.repos, ctx.orgId, owned, kind),
        ...(date ? { date: new Date(date) } : {}),
      }) satisfies Partial<TimeEntry>);
      await emit.timeEntryUpdated(ctx, { id: updated.id, matterId: updated.matterId });
      return updated;
    }),

  /**
   * Flytta tidsposter till ett annat ärende (#2042). Köas som anrop och körs om
   * på servern — tidsposter är procedurägda, så timpriset räknas mot serverns
   * priser och låsregeln prövas där. Datum, tid, beskrivning och övriga fält
   * ändras inte. En händelse `time-entry.moved` per flyttad post.
   */
  moveToMatter: orgProcedure
    .input(z.object({
      ids: z.array(timeEntryIdSchema).min(1).max(500)
        .refine((ids) => new Set(ids).size === ids.length, "Samma tidspost får bara anges en gång."),
      matterId: matterIdSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      await requireMatterInOrg(ctx, input.matterId);
      const moved = await ctx.repos.transaction((repos) => moveEntries(repos, ctx.orgId, input.ids, input.matterId));
      for (const entry of moved) await emit.timeEntryMoved(ctx, { id: entry.id, matterId: input.matterId }, entry.matterId);
      return { moved: moved.length };
    }),

  delete: orgProcedure
    .input(z.object({ id: timeEntryIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.repos.timeEntries.getByIdInOrg(input.id, ctx.orgId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      assertEditable(owned);
      // Hård delete bevarar dagens beteende (ADR 0017-delete-policy öppen).
      await ctx.repos.timeEntries.hardDelete(input.id);
      await emit.timeEntryDeleted(ctx, input.id, owned.matterId);
      return { id: input.id };
    }),

  /**
   * Ärendets rådgivningspost (#1207): `missing` = rådgivningsfakturan finns men
   * ingen låst post — styr "Markera som rådgivning" och fakturapanelens varning.
   */
  radgivningStatus: orgProcedure
    .input(z.object({ matterId: matterIdSchema }))
    .query(async ({ ctx, input }) => {
      const matter = await ctx.repos.matters.getByIdInOrg(input.matterId, ctx.orgId);
      if (!matter) throw new TRPCError({ code: "NOT_FOUND" });
      return loadRadgivningStatus(ctx.repos, matter);
    }),

  /**
   * "Markera som rådgivning" (#1207): låser en befintlig post mot ärendets
   * rådgivningsfaktura — för rättshjälpsärenden vars rådgivningsfaktura skapades
   * före #1205 och därför saknar den låsta posten. Över 60 min delas posten.
   * Köas som anrop (#1349) och körs om på servern — tidsposter är procedurägda.
   * Regler + delning: `markEntryAsRadgivning`.
   */
  markAsRadgivning: orgProcedure
    .input(z.object({ id: timeEntryIdSchema }))
    .mutation(async ({ ctx, input }) => {
      // Köad procedur (#1349): låstidpunkten och restpostens id härleds ur
      // anropet, så serverns omkörning ger samma rader som klientens körning.
      const call: MarkRadgivningCall = { now: callTime(ctx), remainderId: asId<"TimeEntryId">(newRowId(ctx, "radgivningRemainder")) };
      const res = await ctx.repos.transaction((repos) => markEntryAsRadgivning(repos, ctx.orgId, input.id, call));
      await emit.timeEntryUpdated(ctx, { id: res.locked.id, matterId: res.locked.matterId });
      if (res.remainder) await emit.timeEntryAdded(ctx, res.remainder);
      return res;
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
    // inkl. KLIENT-kontakt). Grupperingen per jurist: `loadTimeReport`.
    .query(({ ctx, input }) => loadTimeReport(ctx.repos, ctx.user.organizationId, {
      from: new Date(input.from),
      to: new Date(input.to),
      userId: input.userId,
      userIds: input.userIds,
      matterId: input.matterId,
    })),
});
