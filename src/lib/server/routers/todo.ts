/**
 * `todoRouter` — enad "Att-göra med datum/tid"-vy: aggregerar `task` (dueAt)
 * och `calendarEvent` (startAt) i en tidsordnad lista. Tanken är att UI:t
 * inte ska skilja på de två — användaren har EN lista över vad som händer
 * idag/imorgon/nästa vecka, vare sig det är en deadline (frist), ett möte
 * eller en uppgift utan klockslag.
 *
 * `userId` defaultar till anropande user, men kan sättas för att se en
 * kollegas att-göra-lista (t.ex. sjukdoms-täckning) — vi verifierar att
 * user:n tillhör samma org.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, orgProcedure } from "../trpc";
import type { Task, CalendarEvent } from "@/lib/shared/schemas";
import type { Joined } from "../data-store/IDataStore";

export interface TodoItem {
  id: string;
  source: "task" | "event";
  title: string;
  description: string | null;
  at: Date;
  endAt: Date | null;
  allDay: boolean;
  status: string | null; // task-status (TODO/IN_PROGRESS/DONE) eller null för event
  priority: string | null; // task-priority eller null
  kind: string | null; // event-kind (appointment/deadline) eller null
  location: string | null;
  matter: { id: string; matterNumber: string; title: string } | null;
  userId: string;
}

const includeMatter = { matter: { select: { id: true, matterNumber: true, title: true } } };

export const todoRouter = router({
  list: orgProcedure
    .input(z.object({
      from: z.date(),
      to: z.date(),
      /** Default = anropande user; annars måste user:n vara i samma org. */
      userId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const userId = input.userId ?? ctx.user.id;
      // Vid kollegial-look-up (annan user än ctx.user) — verifiera att den
      // user:n tillhör samma org (förhindrar arbitrary user-listning).
      // För egen tidslinje hoppar vi över checken: ctx.user är redan
      // autentiserad. Det undviker race när demo-runtime hydrerar users
      // asynkront → todo.list slog tidigare in innan u-anna fanns i datalagret.
      if (userId !== ctx.user.id) {
        const user = await ctx.dataStore.users.findFirst({
          where: { id: userId, organizationId: ctx.user.organizationId },
        });
        if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Användare finns inte i organisationen." });
      }

      const where = { userId, organizationId: ctx.user.organizationId };
      const [tasks, events] = await Promise.all([
        ctx.dataStore.tasks.findMany({
          where: { ...where, dueAt: { gte: input.from, lte: input.to } },
          include: includeMatter,
        }),
        ctx.dataStore.calendarEvents.findMany({
          where: { ...where, startAt: { gte: input.from, lte: input.to } },
          include: includeMatter,
        }),
      ]);

      // Demo-projektionen (passthrough) sparar datum som ISO-strängar →
      // coerca till Date innan sort/serialisering (getTime() på en sträng
      // kraschar tyst inne i sort:s comparator → React Query svalde felet
      // och behöll förra resultatet → tom dashboard).
      const toDate = (v: unknown): Date => v instanceof Date ? v : new Date(v as string);

      const taskItems: TodoItem[] = tasks.map((t: Joined<Task>) => ({
        id: t.id, source: "task", title: t.title, description: t.description ?? null,
        at: toDate(t.dueAt), endAt: null, allDay: false,
        status: t.status, priority: t.priority, kind: null, location: null,
        matter: t.matter ?? null, userId: t.userId,
      }));
      const eventItems: TodoItem[] = events.map((e: Joined<CalendarEvent>) => ({
        id: e.id, source: "event", title: e.title, description: e.description ?? null,
        at: toDate(e.startAt), endAt: e.endAt ? toDate(e.endAt) : null, allDay: e.allDay ?? false,
        status: null, priority: null, kind: e.kind, location: e.location ?? null,
        matter: e.matter ?? null, userId: e.userId,
      }));

      return [...taskItems, ...eventItems].sort((a, b) => a.at.getTime() - b.at.getTime());
    }),
});
