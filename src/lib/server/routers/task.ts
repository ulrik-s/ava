/**
 * Task router — CRUD för Task (todo med valfri due-date).
 *
 * Tasks har en ägare (userId) — den som lade in dem — men ändra, bocka av,
 * återöppna och radera får ALLA på byrån (#1231): en bevakning i ett ärende
 * angår alla som arbetar i det. Vakten är därför org-scopad, inte ägar-scopad.
 * Ingen Outlook-spegling i v1 (Microsoft To Do är en separat Graph-API).
 *
 * `complete` är en convenience-mutation som sätter status=DONE + completedAt=now.
 */

import { z } from "zod";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { pageEnvelope } from "@/lib/shared/paginate";
import { taskPrioritySchema, taskStatusSchema, type Task } from "@/lib/shared/schemas";
import { asId, taskIdSchema, matterIdSchema, userIdSchema, type TaskId } from "@/lib/shared/schemas/ids";
import type { Repositories } from "../repositories/repositories";
import { router, protectedProcedure, TRPCError } from "../trpc";

/**
 * Org-vakt (#1231): uppgiften måste finnas i användarens byrå, annars
 * NOT_FOUND (inget läckage mellan byråer). Ägarskap krävs inte.
 */
async function requireTaskInOrg(
  ctx: { repos: Pick<Repositories, "tasks">; user: { organizationId: string } },
  id: TaskId,
): Promise<Task> {
  const task = await ctx.repos.tasks.getByIdInOrg(id, asId<"OrganizationId">(ctx.user.organizationId));
  if (!task) throw new TRPCError({ code: "NOT_FOUND" });
  return task;
}

const createInput = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  priority: taskPrioritySchema.default("MEDIUM"),
  dueAt: z.coerce.date().nullish(),
  matterId: matterIdSchema.nullish(),
  // Valfria setup-fält (demo-generator/fixtures, ADR 0003).
  id: taskIdSchema.optional(),
  userId: userIdSchema.optional(),
  status: taskStatusSchema.optional(),
  completedAt: z.coerce.date().nullish(),
  createdAt: z.coerce.date().nullish(),
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
        // Frivillig sidning (#1011): utelämnad pageSize = hela listan, som förut.
        page: z.number().min(1).optional(),
        pageSize: z.number().min(1).max(100).optional(),
      }).optional(),
    )
    // Migrerad till repository-sömmen (ADR 0020): ägar-/org-scopad listForUser.
    .query(async ({ ctx, input }) =>
      pageEnvelope(
        await ctx.repos.tasks.listForUser(ctx.user.id, ctx.user.organizationId, {
          status: input?.status,
          matterId: input?.matterId,
        }),
        input,
      ),
    ),

  /**
   * Ärendets frister och att-göra-poster — alla användares (#1162). Ärendet
   * måste tillhöra användarens org; annars NOT_FOUND (inget läckage mellan byråer).
   */
  listForMatter: protectedProcedure
    .input(z.object({ matterId: matterIdSchema }))
    .query(async ({ ctx, input }) => {
      const org = asId<"OrganizationId">(ctx.user.organizationId);
      if (!(await ctx.repos.matters.getByIdInOrg(input.matterId, org))) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.repos.tasks.listForMatter(input.matterId, org);
    }),

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
      await requireTaskInOrg(ctx, id);
      // Auto-set completedAt när status flippas till DONE
      const patch: Record<string, unknown> = { ...data };
      if (data.status === "DONE") patch.completedAt = new Date();
      if (data.status && data.status !== "DONE") patch.completedAt = null;
      return ctx.repos.tasks.update(id, patch satisfies Partial<Task>);
    }),

  complete: protectedProcedure
    .input(z.object({ id: taskIdSchema }))
    .mutation(async ({ ctx, input }) => {
      await requireTaskInOrg(ctx, input.id);
      return ctx.repos.tasks.update(input.id, { status: "DONE", completedAt: new Date() } satisfies Partial<Task>);
    }),

  delete: protectedProcedure
    .input(z.object({ id: taskIdSchema }))
    .mutation(async ({ ctx, input }) => {
      await requireTaskInOrg(ctx, input.id);
      // Hård delete bevarar dagens beteende (ADR 0017-delete-policy öppen). I
      // browsern (där routrarna kör) köas den som en "delete"-mutation som
      // servern applicerar som softDelete + change_log → når andra klienter.
      await ctx.repos.tasks.hardDelete(input.id);
      return { id: input.id };
    }),
});
