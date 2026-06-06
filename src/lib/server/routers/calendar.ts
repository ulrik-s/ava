/**
 * Calendar router — CRUD för CalendarEvent (möten, förhandlingar, frister).
 *
 * Designval:
 *   - `list` returnerar bara den aktiva användarens events. Org-admins
 *     kan inte se andras kalendrar (privacy).
 *   - `mirrorToOutlook`-flaggan persisteras direkt; `mirror-to-outlook`-
 *     job-workern triggas separat när browsern är öppen.
 *   - Vid update av en mirrored event sätter vi mirrorStatus="pending" så
 *     workern vet att den ska re-push:a till Graph.
 *   - Vid delete av en mirrored event behåller vi outlookEventId i payload
 *     till workern så den kan kalla DELETE /me/events/{id}.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { calendarEventKindSchema, calendarEventVisibilitySchema } from "@/lib/shared/schemas";
import {
  asId,
  calendarEventIdSchema,
  matterIdSchema,
  userIdSchema,
  contactIdSchema,
} from "@/lib/shared/schemas/ids";

const createInput = z.object({
  kind: calendarEventKindSchema.default("appointment"),
  title: z.string().min(1),
  description: z.string().nullish(),
  location: z.string().nullish(),
  startAt: z.date(),
  endAt: z.date().nullish(),
  allDay: z.boolean().default(false),
  matterId: matterIdSchema.nullish(),
  visibility: calendarEventVisibilitySchema.default("normal"),
  mirrorToOutlook: z.boolean().default(false),
  /** Inbjudna kollegor (interna users). */
  inviteeUserIds: z.array(userIdSchema).optional(),
  /** Inbjudna externa kontakter (klient, motpart, vittne osv.). */
  inviteeContactIds: z.array(contactIdSchema).optional(),
  // Valfria setup-fält (demo-generator/fixtures, ADR 0003).
  id: calendarEventIdSchema.optional(),
  userId: userIdSchema.optional(),
  createdAt: z.date().nullish(),
});

// OBS: separat schema utan `.default()` — annars fyller Zod i defaults för
// fält som användaren inte angav, vilket triggar fel mirror-state-detektering
// i computeMirrorPatch (allt ser ut som "explicit satt").
const updateInput = z.object({
  id: calendarEventIdSchema,
  kind: calendarEventKindSchema.optional(),
  title: z.string().min(1).optional(),
  description: z.string().nullish(),
  location: z.string().nullish(),
  startAt: z.date().optional(),
  endAt: z.date().nullish(),
  allDay: z.boolean().optional(),
  matterId: matterIdSchema.nullish(),
  visibility: calendarEventVisibilitySchema.optional(),
  mirrorToOutlook: z.boolean().optional(),
  inviteeUserIds: z.array(userIdSchema).optional(),
  inviteeContactIds: z.array(contactIdSchema).optional(),
});

/**
 * Beräkna mirror-relaterade patch-fält baserat på vad som ändrats:
 *   - flippad PÅ (false→true): mirrorStatus="pending"
 *   - flippad AV (true→false): mirrorStatus=null, outlookEventId=null
 *   - oförändrad mirror, men event redan mirrored + andra fält ändrats: re-push
 *     (mirrorStatus="pending")
 *   - oförändrat: tomt patch
 */
type UpdateData = Record<string, unknown> & { mirrorToOutlook?: boolean | undefined };
type ExistingEvent = { mirrorToOutlook?: boolean | undefined };
function computeMirrorPatch(data: UpdateData, existing: ExistingEvent): Record<string, unknown> {
  const newFlag = data.mirrorToOutlook;
  const oldFlag = existing.mirrorToOutlook ?? false;
  const flippedOn = newFlag === true && oldFlag === false;
  const flippedOff = newFlag === false && oldFlag === true;
  const otherFieldsChanged = Object.keys(data).some((k) => k !== "mirrorToOutlook");

  if (flippedOff) return { mirrorStatus: null, outlookEventId: null };
  if (flippedOn) return { mirrorStatus: "pending" };
  // Inget flippat — men event är mirrored och något annat ändrats → re-push
  if (oldFlag && otherFieldsChanged) return { mirrorStatus: "pending" };
  return {};
}

export const calendarRouter = router({
  /** Lista den aktiva användarens events (frivilligt filtrerade per tidsfönster). */
  list: protectedProcedure
    .input(
      z.object({
        from: z.date().optional(),
        to: z.date().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const events = await ctx.dataStore.calendarEvents.findMany({
        where: {
          userId: ctx.user.id,
          organizationId: ctx.user.organizationId,
        },
        orderBy: { startAt: "asc" },
        include: { matter: { select: { id: true, matterNumber: true, title: true } } },
      });
      // Tidsfilter sker i minne (in-memory query-engine stödjer inte range över Date)
      if (!input?.from && !input?.to) return events;
      return events.filter((e: { startAt: Date | string }) => {
        const start = new Date(e.startAt);
        if (input.from && start < input.from) return false;
        if (input.to && start > input.to) return false;
        return true;
      });
    }),

  /**
   * Lista events för flera användare samtidigt (multi-user-kalendervyn).
   *
   * Privacy: `private`-events från ANDRA användare filtreras bort i minne;
   * ägaren ser alltid sina egna oavsett visibility.
   *
   * Designval: vi gör en union-query mot org-scope + `userId in (...)` istället
   * för en findMany per användare — färre rundor mot data-store:n. Range-filter
   * görs i minne (samma som `list`, in-memory query-engine stödjer inte range
   * över Date).
   */
  listForUsers: protectedProcedure
    .input(z.object({
      userIds: z.array(z.string()),
      from: z.date().optional(),
      to: z.date().optional(),
    }))
    .query(async ({ ctx, input }) => {
      if (input.userIds.length === 0) return [];
      const events = await ctx.dataStore.calendarEvents.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          userId: { in: input.userIds },
        },
        orderBy: { startAt: "asc" },
        include: { matter: { select: { id: true, matterNumber: true, title: true } } },
      });
      const visible = events.filter((e: { userId: string; visibility?: string }) =>
        e.visibility !== "private" || e.userId === ctx.user.id,
      );
      if (!input.from && !input.to) return visible;
      return visible.filter((e: { startAt: Date | string }) => {
        const start = new Date(e.startAt);
        if (input.from && start < input.from) return false;
        if (input.to && start > input.to) return false;
        return true;
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.dataStore.calendarEvents.findFirstOrThrow({
        where: { id: input.id, userId: ctx.user.id, organizationId: ctx.user.organizationId },
        include: { matter: { select: { id: true, matterNumber: true, title: true } } },
      }),
    ),

  create: protectedProcedure
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      // exactOptionalPropertyTypes: utelämna nycklar vars värde är undefined
      // (förr droppades de ändå av create). null behålls (nullish-fält).
      const cleanInput = Object.fromEntries(
        Object.entries(input).filter(([, v]) => v !== undefined),
      );
      return ctx.dataStore.calendarEvents.create({
        data: {
          ...cleanInput,
          userId: input.userId ?? asId<"UserId">(ctx.user.id),
          organizationId: asId<"OrganizationId">(ctx.user.organizationId),
          mirrorStatus: input.mirrorToOutlook ? "pending" : null,
        },
      });
    }),

  /** Alla events kopplade till ett specifikt ärende, kronologiskt. */
  listForMatter: protectedProcedure
    .input(z.object({ matterId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.dataStore.calendarEvents.findMany({
        where: { matterId: input.matterId, organizationId: ctx.user.organizationId },
        orderBy: { startAt: "asc" },
      });
    }),

  update: protectedProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const existing = await ctx.dataStore.calendarEvents.findFirstOrThrow({
        where: { id, userId: ctx.user.id, organizationId: ctx.user.organizationId },
      });
      // exactOptionalPropertyTypes: utelämna nycklar vars värde är undefined
      // i write-payloaden (förr droppades de ändå). `computeMirrorPatch` får
      // dock det råa `data` så dess nyckel-räkning av "ändrade fält" bevaras.
      const writeData = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined),
      );
      return ctx.dataStore.calendarEvents.update({
        where: { id },
        data: { ...writeData, ...computeMirrorPatch(data, existing) },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Säkerställ ownership innan delete
      await ctx.dataStore.calendarEvents.findFirstOrThrow({
        where: { id: input.id, userId: ctx.user.id, organizationId: ctx.user.organizationId },
      });
      return ctx.dataStore.calendarEvents.delete({ where: { id: input.id } });
    }),

  /**
   * Sätt mirror-state utan att trigga `computeMirrorPatch`-logiken.
   * Anropas av `mirror-to-outlook`-workern efter sync — annars skulle vår
   * egen status-update klassas som "andra fält ändrade" och vi skulle få
   * en evig pending→synced→pending-loop.
   */
  setMirrorState: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        outlookEventId: z.string().nullish(),
        mirrorStatus: z.enum(["synced", "failed", "pending"]).nullable(),
        mirrorError: z.string().nullish(),
        mirrorLastSyncedAt: z.date().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.dataStore.calendarEvents.findFirstOrThrow({
        where: { id: input.id, userId: ctx.user.id, organizationId: ctx.user.organizationId },
      });
      const { id, ...data } = input;
      return ctx.dataStore.calendarEvents.update({ where: { id }, data });
    }),
});
