import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import {
  asId,
  documentTemplateIdSchema,
  userIdSchema,
} from "@/lib/shared/schemas/ids";
import type { DocumentTemplate } from "@/lib/shared/schemas/misc";
import { assertAdmin } from "../auth/assert-admin";
import { assertSetupFieldsAllowed, onBehalfOf } from "../auth/setup-fields";
import { router, protectedProcedure } from "../trpc";

export const documentTemplateRouter = router({
  // Migrerad till repository-sömmen (ADR 0020).
  list: protectedProcedure.query(({ ctx }) =>
    ctx.repos.documentTemplates.listForOrg(ctx.user.organizationId),
  ),

  getById: protectedProcedure
    .input(z.object({ id: documentTemplateIdSchema }))
    .query(async ({ ctx, input }) => {
      const template = await ctx.repos.documentTemplates.getByIdInOrg(input.id, ctx.user.organizationId);
      if (!template) throw new TRPCError({ code: "NOT_FOUND" });
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
      // Mallarna blir byråns dokument — bara admin förvaltar dem (#1370).
      assertAdmin(ctx);
      // Mallen köas (#1344): skapare och skapad-datum i någon annans namn är
      // setup-fält — aldrig i kön, och direkt bara för ADMIN (#1345).
      assertSetupFieldsAllowed(ctx, { createdById: onBehalfOf(ctx, input.createdById), createdAt: input.createdAt });
      return ctx.repos.documentTemplates.create({
        ...omitUndefined({
          id: input.id, // undefined → store genererar
          name: input.name,
          description: input.description,
          category: input.category,
          content: input.content,
          organizationId: asId<"OrganizationId">(ctx.user.organizationId),
          createdById: input.createdById ?? asId<"UserId">(ctx.user.id),
        }),
        ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
      } satisfies Partial<DocumentTemplate>);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: documentTemplateIdSchema,
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        content: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx);
      const existing = await ctx.repos.documentTemplates.getByIdInOrg(input.id, ctx.user.organizationId);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const { id, name, description, category, content } = input;
      return ctx.repos.documentTemplates.update(id, omitUndefined({ name, description, category, content }) satisfies Partial<DocumentTemplate>);
    }),

  delete: protectedProcedure
    .input(z.object({ id: documentTemplateIdSchema }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx);
      const existing = await ctx.repos.documentTemplates.getByIdInOrg(input.id, ctx.user.organizationId);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.repos.documentTemplates.hardDelete(input.id);
    }),
});
