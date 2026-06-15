import { z } from "zod";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import {
  asId,
  matterIdSchema,
  userIdSchema,
  serviceNoteIdSchema,
} from "@/lib/shared/schemas/ids";
import { router, protectedProcedure } from "../trpc";

/**
 * Tjänsteanteckningar (#348) — korta, daterade noteringar i ett ärende.
 * Append-only i v1 (juridisk spårbarhet): bara `list` + `create`, ingen
 * update/delete. `authorId` sätts från principalen (ej editerbart i UI:t).
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
});
