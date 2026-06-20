/**
 * Task router — CRUD för Task (todo med valfri due-date).
 *
 * Tasks är per-user (ägare = userId). Ingen Outlook-spegling i v1 (Microsoft
 * To Do är en separat Graph-API).
 *
 * `complete` är en convenience-mutation som sätter status=DONE + completedAt=now.
 */

import { z } from "zod";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { taskPrioritySchema, taskStatusSchema, type Task } from "@/lib/shared/schemas";
import { asId, taskIdSchema, matterIdSchema, userIdSchema } from "@/lib/shared/schemas/ids";
import { router, protectedProcedure, TRPCError } from "../trpc";

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
        matterId: matterIdSchema.optional(),
      }).optional(),
    )
    // Migrerad till repository-sömmen (ADR 0020): ägar-/org-scopad listForUser.
    .query(({ ctx, input }) =>
      ctx.repos.tasks.listForUser(ctx.user.id, ctx.user.organizationId, {
        status: input?.status,
        matterId: input?.matterId,
      }),
    ),

  create: protectedProcedure
    .input(createInput)
    .mutation(({ ctx, input }) => {
      const { id, createdAt, ...rest } = input;
      return ctx.repos.tasks.create({
        ...rest,
        status: input.status ?? "TODO",
        userId: input.userId ?? asId<"UserId">(ctx.user.id),
        organizationId: asId<"OrganizationId">(ctx.user.organizationId),
        ...omitUndefined({ id }),
        ...(createdAt != null ? { createdAt } : {}),
      } satisfies Partial<Task>);
    }),

  update: protectedProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      // Ownership-guard (id + userId + org).
      const owned = await ctx.repos.tasks.getOwned(id, ctx.user.id, ctx.user.organizationId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      // Auto-set completedAt när status flippas till DONE
      const patch: Record<string, unknown> = { ...data };
      if (data.status === "DONE") patch.completedAt = new Date();
      if (data.status && data.status !== "DONE") patch.completedAt = null;
      return ctx.repos.tasks.update(id, patch satisfies Partial<Task>);
    }),

  complete: protectedProcedure
    .input(z.object({ id: taskIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.repos.tasks.getOwned(input.id, ctx.user.id, ctx.user.organizationId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.repos.tasks.update(input.id, { status: "DONE", completedAt: new Date() } satisfies Partial<Task>);
    }),

  delete: protectedProcedure
    .input(z.object({ id: taskIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.repos.tasks.getOwned(input.id, ctx.user.id, ctx.user.organizationId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      // Hård delete bevarar dagens beteende (ADR 0017-delete-policy öppen).
      await ctx.repos.tasks.hardDelete(input.id);
      return { id: input.id };
    }),
});
