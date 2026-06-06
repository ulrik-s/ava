import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import {
  asId,
  documentTemplateIdSchema,
  userIdSchema,
} from "@/lib/shared/schemas/ids";

export const documentTemplateRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.dataStore.documentTemplates.findMany({
      where: { organizationId: ctx.user.organizationId },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        createdAt: true,
        updatedAt: true,
        createdBy: { select: { name: true } },
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const template = await ctx.dataStore.documentTemplates.findUnique({
        where: { id: input.id },
        include: { createdBy: { select: { name: true } } },
      });
      if (!template || template.organizationId !== ctx.user.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return template;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        category: z.string().optional(),
        content: z.string().min(1),
        // Valfria setup-fält (demo-generator/fixtures, ADR 0003).
        id: documentTemplateIdSchema.optional(),
        createdById: userIdSchema.optional(),
        createdAt: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.documentTemplates.create({
        data: {
          ...(input.id !== undefined ? { id: input.id } : {}), // undefined → store genererar
          name: input.name,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          content: input.content,
          organizationId: asId<"OrganizationId">(ctx.user.organizationId),
          createdById: input.createdById ?? asId<"UserId">(ctx.user.id),
          ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        content: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.dataStore.documentTemplates.findUnique({
        where: { id: input.id },
        select: { organizationId: true },
      });
      if (!existing || existing.organizationId !== ctx.user.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const { id, name, description, category, content } = input;
      return ctx.dataStore.documentTemplates.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(category !== undefined ? { category } : {}),
          ...(content !== undefined ? { content } : {}),
        },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.dataStore.documentTemplates.findUnique({
        where: { id: input.id },
        select: { organizationId: true },
      });
      if (!existing || existing.organizationId !== ctx.user.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.dataStore.documentTemplates.delete({ where: { id: input.id } });
    }),
});
