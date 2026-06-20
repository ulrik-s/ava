import { z } from "zod";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import {
  asId,
  matterIdSchema,
  userIdSchema,
  serviceNoteIdSchema,
} from "@/lib/shared/schemas/ids";
import type { ServiceNote } from "@/lib/shared/schemas/service-note";
import { router, protectedProcedure, orgProcedure, TRPCError } from "../trpc";

/**
 * Tjänsteanteckningar (#348) — korta, daterade noteringar i ett ärende.
 * `list` + `create` + `update` + `delete` (#375). `authorId` sätts från
 * principalen vid create (ej editerbart i UI:t). Redigera/ta-bort är
 * org-scopade: ägarkoll via matter INNAN mutation, NOT_FOUND vid mismatch.
 */
export const serviceNoteRouter = router({
  list: protectedProcedure
    .input(z.object({ matterId: matterIdSchema }))
    // Migrerad till repository-sömmen (ADR 0020): listByMatter org-scopar via ärendet.
    .query(({ ctx, input }) =>
      ctx.repos.serviceNotes.listByMatter(input.matterId, ctx.user.organizationId),
    ),

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
      return ctx.repos.serviceNotes.create(omitUndefined({
        id: input.id, // undefined → store genererar
        organizationId: asId<"OrganizationId">(ctx.user.organizationId),
        matterId: input.matterId,
        authorId: input.authorId ?? asId<"UserId">(ctx.user.id),
        date: input.date,
        time: input.time,
        text: input.text,
        ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
      }) as Partial<ServiceNote>);
    }),

  update: orgProcedure
    .input(
      z.object({
        id: serviceNoteIdSchema,
        date: z.string().min(1).optional(),
        time: z.string().min(1).optional(),
        text: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Ägarkoll (samma org-scopning som `list`) INNAN update — NOT_FOUND vid
      // mismatch läcker inte existens.
      const owned = await ctx.repos.serviceNotes.getByIdInOrg(input.id, ctx.orgId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      const { id, date, time, text } = input;
      return ctx.repos.serviceNotes.update(id, omitUndefined({ date, time, text }) as Partial<ServiceNote>);
    }),

  delete: orgProcedure
    .input(z.object({ id: serviceNoteIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.repos.serviceNotes.getByIdInOrg(input.id, ctx.orgId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      // Hård delete bevarar dagens beteende (ADR 0017-delete-policy öppen).
      await ctx.repos.serviceNotes.hardDelete(input.id);
      return { id: input.id };
    }),
});
