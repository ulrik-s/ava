import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ledgerAccountMapSchema } from "@/lib/shared/accounting/account-map";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { organizationIdSchema, asId } from "@/lib/shared/schemas/ids";
import type { Office, Organization } from "@/lib/shared/schemas/organization";
import { router, protectedProcedure } from "../trpc";

/** Projektion för settings-vyn (nullish → null). Egen helper för låg komplexitet. */
function toOrgSettings(org: Organization) {
  return {
    id: org.id,
    name: org.name,
    orgNumber: org.orgNumber ?? null,
    address: org.address ?? null,
    phone: org.phone ?? null,
    email: org.email ?? null,
    bankgiro: org.bankgiro ?? null,
    logoPath: org.logoPath ?? null,
    ledgerAccountMap: org.ledgerAccountMap ?? null,
  };
}

export const organizationRouter = router({
  // ── Settings ────────────────────────────────────────────────────

  // Migrerad till repository-sömmen (ADR 0020). Org är rot-entiteten (scope:n).
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const org = await ctx.repos.organizations.getById(ctx.user.organizationId);
    if (!org) throw new TRPCError({ code: "NOT_FOUND" });
    return toOrgSettings(org);
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
        /** Roll→konto-mappning för bokföringsexport (#249). */
        ledgerAccountMap: ledgerAccountMapSchema.optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      ctx.repos.organizations.update(ctx.user.organizationId, omitUndefined(input) as Partial<Organization>),
    ),

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
    .mutation(({ ctx, input }) =>
      ctx.repos.organizations.create(input as Partial<Organization>),
    ),

  // ── Offices ─────────────────────────────────────────────────────

  listOffices: protectedProcedure.query(({ ctx }) =>
    ctx.repos.offices.listByOrg(ctx.user.organizationId),
  ),

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
      if (input.isMain) await ctx.repos.offices.demoteMains(ctx.user.organizationId);
      return ctx.repos.offices.create({
        ...input,
        organizationId: asId<"OrganizationId">(ctx.user.organizationId),
      } as Partial<Office>);
    }),

  updateOffice: protectedProcedure
    .input(
      z.object({
        id: organizationIdSchema,
        name: z.string().min(1).optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        isMain: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const office = await ctx.repos.offices.getByIdInOrg(id, ctx.user.organizationId);
      if (!office) throw new TRPCError({ code: "NOT_FOUND" });
      // If setting as main, demote others first
      if (data.isMain) await ctx.repos.offices.demoteMains(ctx.user.organizationId);
      return ctx.repos.offices.update(id, omitUndefined(data) as Partial<Office>);
    }),

  deleteOffice: protectedProcedure
    .input(z.object({ id: organizationIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const office = await ctx.repos.offices.getByIdInOrg(input.id, ctx.user.organizationId);
      if (!office) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.repos.offices.hardDelete(input.id);
      return { id: input.id };
    }),
});
