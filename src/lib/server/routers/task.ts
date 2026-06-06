/**
 * Task router — CRUD för Task (todo med valfri due-date).
 *
 * Tasks är per-user (ägare = userId). Ingen Outlook-spegling i v1 (Microsoft
 * To Do är en separat Graph-API).
 *
 * `complete` är en convenience-mutation som sätter status=DONE + completedAt=now.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { taskPrioritySchema, taskStatusSchema } from "@/lib/shared/schemas";
import { asId, taskIdSchema, matterIdSchema, userIdSchema } from "@/lib/shared/schemas/ids";
import { omitUndefined } from "@/lib/shared/omit-undefined";

const createInput = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  priority: taskPrioritySchema.default("MEDIUM"),
  dueAt: z.date().nullish(),
  matterId: matterIdSchema.nullish(),
  // Valfria setup-fält (demo-generator/fixtures, ADR 0003).
  id: taskIdSchema.optional(),
  userId: userIdSchema.optional(),
  status: taskStatusSchema.optional(),
  completedAt: z.date().nullish(),
  createdAt: z.date().nullish(),
});

const updateInput = createInput.partial().extend({
  id: taskIdSchema,
  status: taskStatusSchema.optional(),
});

export const taskRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        status: taskStatusSchema.optional(),
        matterId: z.string().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {
        userId: ctx.user.id,
        organizationId: ctx.user.organizationId,
      };
      if (input?.status) where.status = input.status;
      if (input?.matterId) where.matterId = input.matterId;
      return ctx.dataStore.tasks.findMany({
        where,
        orderBy: { dueAt: "asc" },
        include: { matter: { select: { id: true, matterNumber: true, title: true } } },
      });
    }),

  create: protectedProcedure
    .input(createInput)
    .mutation(({ ctx, input }) => {
      const { id, createdAt, ...rest } = input;
      return ctx.dataStore.tasks.create({
        data: {
          ...rest,
          status: input.status ?? "TODO",
          userId: input.userId ?? asId<"UserId">(ctx.user.id),
          organizationId: asId<"OrganizationId">(ctx.user.organizationId),
          ...omitUndefined({ id }),
          ...(createdAt != null ? { createdAt } : {}),
        },
      });
    }),

  update: protectedProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      // Ownership-guard
      await ctx.dataStore.tasks.findFirstOrThrow({
        where: { id, userId: ctx.user.id, organizationId: ctx.user.organizationId },
      });
      // Auto-set completedAt när status flippas till DONE
      const patch: Record<string, unknown> = { ...data };
      if (data.status === "DONE") patch.completedAt = new Date();
      if (data.status && data.status !== "DONE") patch.completedAt = null;
      return ctx.dataStore.tasks.update({ where: { id }, data: patch });
    }),

  complete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.dataStore.tasks.findFirstOrThrow({
        where: { id: input.id, userId: ctx.user.id, organizationId: ctx.user.organizationId },
      });
      return ctx.dataStore.tasks.update({
        where: { id: input.id },
        data: { status: "DONE", completedAt: new Date() },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.dataStore.tasks.findFirstOrThrow({
        where: { id: input.id, userId: ctx.user.id, organizationId: ctx.user.organizationId },
      });
      return ctx.dataStore.tasks.delete({ where: { id: input.id } });
    }),
});
