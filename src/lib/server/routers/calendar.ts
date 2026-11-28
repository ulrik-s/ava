/**
 * Calendar router — CRUD för CalendarEvent (möten och förhandlingar).
 *
 * En frist är en uppgift (`task.create` med `dueAt`), inte en kalenderhändelse:
 * Frister och Att bevaka läser bara uppgifter (#2120). `kind` är bara
 * `appointment`; `deadline` ger BAD_REQUEST, och de gamla raderna är
 * borttagna (ADR 0040 §3, #2214).
 *
 * Designval:
 *   - `list` returnerar bara den aktiva användarens events. Org-admins
 *     kan inte se andras kalendrar (privacy).
 *   - Outlook-speglingen är borttagen (#1622). Lagrade mirror-fält på gamla
 *     events får ligga kvar i data; de läses och skrivs inte längre här.
 */

import { z } from "zod";
import { calendarEventKindSchema, calendarEventVisibilitySchema, type CalendarEvent } from "@/lib/shared/schemas";
import {
  asId,
  calendarEventIdSchema,
  matterIdSchema,
  userIdSchema,
  contactIdSchema,
} from "@/lib/shared/schemas/ids";
import { requireRefsInOrg } from "../auth/org-scope";
import { router, protectedProcedure, TRPCError } from "../trpc";

const createInput = z.object({
  kind: calendarEventKindSchema.default("appointment"),
  title: z.string().min(1),
  description: z.string().nullish(),
  location: z.string().nullish(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date().nullish(),
  allDay: z.boolean().default(false),
  matterId: matterIdSchema.nullish(),
  visibility: calendarEventVisibilitySchema.default("normal"),
  /** Inbjudna kollegor (interna users). */
  inviteeUserIds: z.array(userIdSchema).optional(),
  /** Inbjudna externa kontakter (klient, motpart, vittne osv.). */
  inviteeContactIds: z.array(contactIdSchema).optional(),
  // Valfria setup-fält (demo-generator/fixtures, ADR 0003).
  id: calendarEventIdSchema.optional(),
  userId: userIdSchema.optional(),
  createdAt: z.coerce.date().nullish(),
});

// OBS: separat schema utan `.default()` — annars fyller Zod i defaults för
// fält som användaren inte angav, och en delvis update skulle skriva över dem.
const updateInput = z.object({
  id: calendarEventIdSchema,
  kind: calendarEventKindSchema.optional(),
  title: z.string().min(1).optional(),
  description: z.string().nullish(),
  location: z.string().nullish(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().nullish(),
  allDay: z.boolean().optional(),
  matterId: matterIdSchema.nullish(),
  visibility: calendarEventVisibilitySchema.optional(),
  inviteeUserIds: z.array(userIdSchema).optional(),
  inviteeContactIds: z.array(contactIdSchema).optional(),
});

export const calendarRouter = router({
  /** Lista den aktiva användarens events (frivilligt filtrerade per tidsfönster). */
  list: protectedProcedure
    .input(
      z.object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const events = await ctx.repos.calendarEvents.listForUser(ctx.user.id, ctx.user.organizationId);
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
      userIds: z.array(userIdSchema),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }))
    .query(async ({ ctx, input }) => {
      if (input.userIds.length === 0) return [];
      const events = await ctx.repos.calendarEvents.listForUsers(input.userIds, ctx.user.organizationId);
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
    .input(z.object({ id: calendarEventIdSchema }))
    .query(async ({ ctx, input }) => {
      const ev = await ctx.repos.calendarEvents.getOwnedWithMatter(input.id, ctx.user.id, ctx.user.organizationId);
      if (!ev) throw new TRPCError({ code: "NOT_FOUND" });
      return ev;
    }),

  create: protectedProcedure
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      await requireRefsInOrg(
        { repos: ctx.repos, orgId: asId<"OrganizationId">(ctx.user.organizationId) },
        { matterId: input.matterId, userIds: [input.userId, ...(input.inviteeUserIds ?? [])] },
      );
      // exactOptionalPropertyTypes: utelämna nycklar vars värde är undefined
      // (förr droppades de ändå av create). null behålls (nullish-fält).
      const cleanInput = Object.fromEntries(
        Object.entries(input).filter(([, v]) => v !== undefined),
      );
      return ctx.repos.calendarEvents.create({
        ...cleanInput,
        userId: input.userId ?? asId<"UserId">(ctx.user.id),
        organizationId: asId<"OrganizationId">(ctx.user.organizationId),
      } satisfies Partial<CalendarEvent>);
    }),

  /** Alla events kopplade till ett specifikt ärende, kronologiskt. */
  listForMatter: protectedProcedure
    .input(z.object({ matterId: matterIdSchema }))
    .query(({ ctx, input }) =>
      ctx.repos.calendarEvents.listForMatter(input.matterId, ctx.user.organizationId),
    ),

  update: protectedProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const existing = await ctx.repos.calendarEvents.getOwned(id, ctx.user.id, ctx.user.organizationId);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      // exactOptionalPropertyTypes: utelämna nycklar vars värde är undefined
      // i write-payloaden (förr droppades de ändå).
      const writeData = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined),
      );
      return ctx.repos.calendarEvents.update(id, writeData satisfies Partial<CalendarEvent>);
    }),

  delete: protectedProcedure
    .input(z.object({ id: calendarEventIdSchema }))
    .mutation(async ({ ctx, input }) => {
      // Säkerställ ownership innan delete
      const owned = await ctx.repos.calendarEvents.getOwned(input.id, ctx.user.id, ctx.user.organizationId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      // Hård delete bevarar dagens beteende (ADR 0017-delete-policy öppen).
      await ctx.repos.calendarEvents.hardDelete(input.id);
      return { id: input.id };
    }),
});
