import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { organizationIdSchema, asId } from "@/lib/shared/schemas/ids";
import { omitUndefined } from "@/lib/shared/omit-undefined";

export const organizationRouter = router({
  // ── Settings ────────────────────────────────────────────────────

  getSettings: protectedProcedure.query(async ({ ctx }) => {
    return ctx.dataStore.organizations.findUniqueOrThrow({
      where: { id: ctx.user.organizationId },
      select: {
        id: true,
        name: true,
        orgNumber: true,
        address: true,
        phone: true,
        email: true,
        bankgiro: true,
        logoPath: true,
      },
    });
  }),

  updateSettings: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).optional(),
        orgNumber: z.string().optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        bankgiro: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.organizations.update({
        where: { id: ctx.user.organizationId },
        data: omitUndefined(input),
      });
    }),

  /**
   * Skapa en organisation med explicit id (rot-entiteten — den ÄR scope:n,
   * så ingen org-scoping). Provisionerings-/setup- och seed-väg: demo-
   * generatorn skapar org:en först, sedan org-scopade entiteter. Id:t är
   * klient-/app-genererat (ADR 0003).
   */
  create: protectedProcedure
    .input(
      z.object({
        id: organizationIdSchema,
        name: z.string().min(1),
        orgNumber: z.string().optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        bankgiro: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.organizations.create({ data: input });
    }),

  // ── Offices ─────────────────────────────────────────────────────

  listOffices: protectedProcedure.query(async ({ ctx }) => {
    return ctx.dataStore.offices.findMany({
      where: { organizationId: ctx.user.organizationId },
      orderBy: [{ isMain: "desc" }, { name: "asc" }],
    });
  }),

  addOffice: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        address: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        isMain: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // If new office is main, demote existing main first
      if (input.isMain) {
        await ctx.dataStore.offices.updateMany({
          where: { organizationId: ctx.user.organizationId, isMain: true },
          data: { isMain: false },
        });
      }
      return ctx.dataStore.offices.create({
        data: {
          ...input,
          organizationId: asId<"OrganizationId">(ctx.user.organizationId),
        },
      });
    }),

  updateOffice: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        isMain: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const office = await ctx.dataStore.offices.findUnique({ where: { id } });
      if (!office || office.organizationId !== ctx.user.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // If setting as main, demote others first
      if (data.isMain) {
        await ctx.dataStore.offices.updateMany({
          where: { organizationId: ctx.user.organizationId, isMain: true },
          data: { isMain: false },
        });
      }
      return ctx.dataStore.offices.update({ where: { id }, data: omitUndefined(data) });
    }),

  deleteOffice: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const office = await ctx.dataStore.offices.findUnique({ where: { id: input.id } });
      if (!office || office.organizationId !== ctx.user.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return ctx.dataStore.offices.delete({ where: { id: input.id } });
    }),
});
