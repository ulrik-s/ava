/**
 * Kalenderhändelser extraherade ur dokument via AI
 * (MatterEventSuggestion): list, reject, markAdded.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { orgProcedure } from "../../trpc";

export const eventProcedures = {
  /** Lista icke-avvisade händelser för ett ärende, sorterat kronologiskt. */
  events: orgProcedure
    .input(z.object({ matterId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.dataStore.matterEventSuggestions.findMany({
        where: {
          status: { not: "REJECTED" },
          document: {
            matterId: input.matterId,
            matter: { organizationId: ctx.orgId },
          },
        },
        include: { document: { select: { id: true, fileName: true, title: true } } },
        orderBy: { startAt: "asc" },
      }),
    ),

  rejectEvent: orgProcedure
    .input(z.object({ eventId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ev = await ctx.dataStore.matterEventSuggestions.findFirst({
        where: {
          id: input.eventId,
          document: { matter: { organizationId: ctx.orgId } },
        },
      });
      if (!ev) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.dataStore.matterEventSuggestions.update({
        where: { id: ev.id },
        data: { status: "REJECTED" },
      });
    }),

  /** Markera händelsen som tillagd i kalender (UI-indikator). */
  markEventAdded: orgProcedure
    .input(z.object({ eventId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ev = await ctx.dataStore.matterEventSuggestions.findFirst({
        where: {
          id: input.eventId,
          document: { matter: { organizationId: ctx.orgId } },
        },
      });
      if (!ev) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.dataStore.matterEventSuggestions.update({
        where: { id: ev.id },
        data: { status: "ACCEPTED" },
      });
    }),
};
