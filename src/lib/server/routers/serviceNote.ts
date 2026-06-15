import { z } from "zod";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import {
  asId,
  matterIdSchema,
  userIdSchema,
  serviceNoteIdSchema,
} from "@/lib/shared/schemas/ids";
import { router, protectedProcedure, orgProcedure, TRPCError } from "../trpc";

/**
 * Tjänsteanteckningar (#348) — korta, daterade noteringar i ett ärende.
 * `list` + `create` + `update` + `delete` (#375). `authorId` sätts från
 * principalen vid create (ej editerbart i UI:t). Redigera/ta-bort är
 * org-scopade: ägarkoll via matter INNAN mutation, NOT_FOUND vid mismatch.
 */
export const serviceNoteRouter = router({
  list: protectedProcedure
    .input(z.object({ matterId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.dataStore.serviceNotes.findMany({
        where: {
          matterId: input.matterId,
          matter: { organizationId: ctx.user.organizationId },
        },
        orderBy: { createdAt: "desc" },
        include: { author: { select: { id: true, name: true } } },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        matterId: matterIdSchema,
        date: z.string().min(1),
        time: z.string().min(1),
        text: z.string().min(1),
        // Valfria setup-fält (demo-generator/fixtures, ADR 0003).
        id: serviceNoteIdSchema.optional(),
        authorId: userIdSchema.optional(),
        createdAt: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.serviceNotes.create({
        data: omitUndefined({
          id: input.id, // undefined → store genererar
          organizationId: asId<"OrganizationId">(ctx.user.organizationId),
          matterId: input.matterId,
          authorId: input.authorId ?? asId<"UserId">(ctx.user.id),
          date: input.date,
          time: input.time,
          text: input.text,
          ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
        }),
      });
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string(),
        date: z.string().min(1).optional(),
        time: z.string().min(1).optional(),
        text: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Ägarkoll (samma org-scopning som `list`) INNAN update — NOT_FOUND vid
      // mismatch läcker inte existens.
      const owned = await ctx.dataStore.serviceNotes.findFirst({
        where: { id: input.id, matter: { organizationId: ctx.orgId } },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      const { id, date, time, text } = input;
      return ctx.dataStore.serviceNotes.update({
        where: { id },
        data: omitUndefined({ date, time, text }),
      });
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.dataStore.serviceNotes.findFirst({
        where: { id: input.id, matter: { organizationId: ctx.orgId } },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.dataStore.serviceNotes.delete({ where: { id: input.id } });
    }),
});
