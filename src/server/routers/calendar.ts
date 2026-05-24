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
import { calendarEventKindSchema, calendarEventVisibilitySchema } from "@/shared/schemas";

const createInput = z.object({
  kind: calendarEventKindSchema.default("appointment"),
  title: z.string().min(1),
  description: z.string().nullish(),
  location: z.string().nullish(),
  startAt: z.date(),
  endAt: z.date().nullish(),
  allDay: z.boolean().default(false),
  matterId: z.string().nullish(),
  visibility: calendarEventVisibilitySchema.default("normal"),
  mirrorToOutlook: z.boolean().default(false),
});

// OBS: separat schema utan `.default()` — annars fyller Zod i defaults för
// fält som användaren inte angav, vilket triggar fel mirror-state-detektering
// i computeMirrorPatch (allt ser ut som "explicit satt").
const updateInput = z.object({
  id: z.string(),
  kind: calendarEventKindSchema.optional(),
  title: z.string().min(1).optional(),
  description: z.string().nullish(),
  location: z.string().nullish(),
  startAt: z.date().optional(),
  endAt: z.date().nullish(),
  allDay: z.boolean().optional(),
  matterId: z.string().nullish(),
  visibility: calendarEventVisibilitySchema.optional(),
  mirrorToOutlook: z.boolean().optional(),
});

/**
 * Beräkna mirror-relaterade patch-fält baserat på vad som ändrats:
 *   - flippad PÅ (false→true): mirrorStatus="pending"
 *   - flippad AV (true→false): mirrorStatus=null, outlookEventId=null
 *   - oförändrad mirror, men event redan mirrored + andra fält ändrats: re-push
 *     (mirrorStatus="pending")
 *   - oförändrat: tomt patch
 */
type UpdateData = Record<string, unknown> & { mirrorToOutlook?: boolean };
type ExistingEvent = { mirrorToOutlook?: boolean };
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
      return ctx.dataStore.calendarEvents.create({
        data: {
          ...input,
          userId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          mirrorStatus: input.mirrorToOutlook ? "pending" : null,
        },
      });
    }),

  update: protectedProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const existing = await ctx.dataStore.calendarEvents.findFirstOrThrow({
        where: { id, userId: ctx.user.id, organizationId: ctx.user.organizationId },
      });
      return ctx.dataStore.calendarEvents.update({
        where: { id },
        data: { ...data, ...computeMirrorPatch(data, existing) },
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
});
