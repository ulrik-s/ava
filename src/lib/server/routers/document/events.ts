/**
 * Kalenderhändelser extraherade ur dokument via AI
 * (MatterEventSuggestion): list, reject, markAdded.
 *
 * Migrerade till repository-sömmen (ADR 0020): org-scopning + include bor i
 * `repos.matterEventSuggestions`.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { MatterEventSuggestion } from "@/lib/shared/schemas/document";
import { orgProcedure } from "../../trpc";

export const eventProcedures = {
  /** Lista icke-avvisade händelser för ett ärende, sorterat kronologiskt. */
  events: orgProcedure
    .input(z.object({ matterId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.repos.matterEventSuggestions.listForMatter(input.matterId, ctx.orgId),
    ),

  rejectEvent: orgProcedure
    .input(z.object({ eventId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ev = await ctx.repos.matterEventSuggestions.getByIdInOrg(input.eventId, ctx.orgId);
      if (!ev) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.repos.matterEventSuggestions.update(ev.id, { status: "REJECTED" } as Partial<MatterEventSuggestion>);
    }),

  /** Markera händelsen som tillagd i kalender (UI-indikator). */
  markEventAdded: orgProcedure
    .input(z.object({ eventId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ev = await ctx.repos.matterEventSuggestions.getByIdInOrg(input.eventId, ctx.orgId);
      if (!ev) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.repos.matterEventSuggestions.update(ev.id, { status: "ACCEPTED" } as Partial<MatterEventSuggestion>);
    }),
};
