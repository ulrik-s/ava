import { z } from "zod";
import { isPerDayKind } from "@/lib/shared/brottmalstaxa";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { type TimeEntry } from "@/lib/shared/schemas/billing";
import { isoDayInput } from "@/lib/shared/schemas/common";
import { timeEntryKindSchema, type TimeEntryKind } from "@/lib/shared/schemas/enums";
import {
  asId,
  matterIdSchema,
  userIdSchema,
  timeEntryIdSchema,
  invoiceIdSchema,
  type MatterId,
  type OrganizationId,
  type TimeEntryId,
} from "@/lib/shared/schemas/ids";
import { stockholmPeriod } from "@/lib/shared/stockholm-time";
import { buildTimeChart } from "@/lib/shared/time-chart";
import { isLockedEntry, type LockableEntry } from "@/lib/shared/time-entry-lock";
import { isAllowedMinutes, TIME_NOT_ALLOWED_MESSAGE } from "@/lib/shared/time-hours";
import { requireMatterInOrg, requireUserInOrg } from "../auth/org-scope";
import { assertSetupFieldsAllowed, onBehalfOf } from "../auth/setup-fields";
import { loadRadgivningStatus, markEntryAsRadgivning, type MarkRadgivningCall } from "../billing/radgivning-entry";
import { entryRateOre } from "../billing/time-entry-rate";
import { emit } from "../events/emit";
import { callTime, newRowId } from "../queued-call";
import { router, protectedProcedure, orgProcedure, TRPCError } from "../trpc";
import type { Context } from "../trpc-core";

/**
 * En låst post (`isLockedEntry`: fakturerad eller fryst av en slutfaktura eller
 * kostnadsräkning, #1862/#1863) får varken ändras eller tas bort: det fakturerade
 * eller till domstolen redovisade underlaget hade annars inte längre stämt med
 * posterna. Samma regel och lydelse som utläggsroutern. Aconto låser inte — de
 * posterna är fortfarande redigerbara.
 */
function assertEditable(entry: LockableEntry): void {
  if (isLockedEntry(entry)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Tidposten ingår i en faktura eller kostnadsräkning och kan inte ändras eller tas bort.",
    });
  }
}

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

/**
 * Nytt á-pris när kategorin byts (#1206) — en post som går från timarvode till
 * tidsspillan ska debiteras som tidsspillan. Oförändrad eller utelämnad
 * kategori rör inte priset (en prisändring på byrå/jurist/ärende gäller bara ny tid).
 */
async function rateOnKindChange(
  repos: Context["repos"], orgId: OrganizationId, owned: TimeEntry, kind: TimeEntryKind | undefined,
): Promise<number | undefined> {
  if (kind === undefined || kind === (owned.kind ?? "ARBETE")) return undefined;
  return rateFor(repos, orgId, owned, { kind, matterId: owned.matterId });
}

/** Postens á-pris med en ny kategori eller ett nytt ärende, med postens jurists priser. */
async function rateFor(
  repos: Context["repos"], orgId: OrganizationId, owned: TimeEntry,
  change: { kind: TimeEntryKind | null | undefined; matterId: MatterId },
): Promise<number> {
  const user = await repos.users.getByIdInOrg(owned.userId, orgId);
  return entryRateOre(repos, orgId, { kind: change.kind, date: owned.date, matterId: change.matterId, userRates: user?.hourlyRates });
}

/** Posterna som ska flyttas, var och en i byrån och olåst — annars vägras hela anropet. */
async function loadMovable(repos: Context["repos"], orgId: OrganizationId, ids: TimeEntryId[]): Promise<TimeEntry[]> {
  const entries = await Promise.all(ids.map((id) => repos.timeEntries.getByIdInOrg(id, orgId)));
  return entries.map((entry) => {
    if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
    assertEditable(entry);
    return entry;
  });
}

/**
 * Flyttar posterna till `matterId` (#2042) med målärendets á-pris, som om de
 * registrerats där. Alla prövas innan någon skrivs (allt eller inget). En post
 * som redan ligger i målärendet lämnas orörd. Ger posterna som flyttades, som
 * de såg ut före flytten (deras `matterId` är ärendet de kom från).
 */
async function moveEntries(
  repos: Context["repos"], orgId: OrganizationId, ids: TimeEntryId[], matterId: MatterId,
): Promise<TimeEntry[]> {
  const moving = (await loadMovable(repos, orgId, ids)).filter((entry) => entry.matterId !== matterId);
  for (const entry of moving) {
    const hourlyRate = await rateFor(repos, orgId, entry, { kind: entry.kind, matterId });
    await repos.timeEntries.update(entry.id, { matterId, hourlyRate });
  }
  return moving;
}

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
   * En persons registrerade tid per dag, vecka eller månad i ett intervall
   * (#2109), för stapeldiagrammen. Samma åtkomst som `reports.perLawyer`:
   * byrån ur sessionen och läsning via repot, så en person i en annan byrå
   * ger tomma staplar. Indelningen är `buildTimeChart`.
   */
  chart: protectedProcedure
    .input(z.object({
      from: isoDayInput,
      to: isoDayInput,
      userId: userIdSchema,
      granularity: z.enum(["day", "week", "month"]),
    }))
    .query(async ({ ctx, input }) => {
      const period = stockholmPeriod(input.from, input.to);
      const entries = await ctx.repos.timeEntries.listForLawyerInPeriod(
        ctx.user.organizationId, input.userId, period.from, period.to,
      );
      return buildTimeChart({ entries, from: input.from, to: input.to, granularity: input.granularity });
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
      // Explicit á-pris i input (setup-väg) vinner, utom för beredskap.
      const rate = input.hourlyRate !== undefined && !isPerDayKind(input.kind)
        ? input.hourlyRate
        : await entryRateOre(ctx.repos, ctx.orgId, { ...input, userRates: user.hourlyRates });

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
