import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ledgerAccountMapSchema } from "@/lib/shared/accounting/account-map";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { officeIdSchema, organizationIdSchema, asId } from "@/lib/shared/schemas/ids";
import type { Office, Organization } from "@/lib/shared/schemas/organization";
import { router, protectedProcedure } from "../trpc";

/** Nullbara org-fält (nullish → null). Utbruten så komplexiteten (många `??`)
 *  inte räknas in i `toOrgSettings` (#199 complexity@8). */
function nullableOrgFields(org: Organization) {
  return {
    orgNumber: org.orgNumber ?? null,
    address: org.address ?? null,
    phone: org.phone ?? null,
    email: org.email ?? null,
    bankgiro: org.bankgiro ?? null,
    logoPath: org.logoPath ?? null,
    ledgerAccountMap: org.ledgerAccountMap ?? null,
  };
}

/** Projektion för settings-vyn. */
function toOrgSettings(org: Organization) {
  return {
    id: org.id,
    name: org.name,
    ...nullableOrgFields(org),
    /** Byråns vokabulär av giltiga dokument-etiketter (#621). */
    documentTags: org.documentTags ?? [],
  };
}

export const organizationRouter = router({
  // ── Settings ────────────────────────────────────────────────────

  // Migrerad till repository-sömmen (ADR 0020). Org är rot-entiteten (scope:n).
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const org = await ctx.repos.organizations.getById(asId<"OrganizationId">(ctx.user.organizationId));
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
        /** Byråns vokabulär av giltiga dokument-etiketter (#621). Hela listan
         *  ersätts (set-semantik); dedupas + tomma rensas. */
        documentTags: z.array(z.string()).optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      // Normalisera vokabulären: trimma, släng tomma, dedupa (set-semantik).
      const patch = omitUndefined(input);
      if (patch.documentTags) {
        patch.documentTags = [...new Set(patch.documentTags.map((t) => t.trim()).filter(Boolean))];
      }
      return ctx.repos.organizations.update(asId<"OrganizationId">(ctx.user.organizationId), patch satisfies Partial<Organization>);
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
    .mutation(({ ctx, input }) =>
      ctx.repos.organizations.create(input satisfies Partial<Organization>),
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
      } satisfies Partial<Office>);
    }),

  updateOffice: protectedProcedure
    .input(
      z.object({
        id: officeIdSchema,
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
      return ctx.repos.offices.update(id, omitUndefined(data) satisfies Partial<Office>);
    }),

  deleteOffice: protectedProcedure
    .input(z.object({ id: officeIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const office = await ctx.repos.offices.getByIdInOrg(input.id, ctx.user.organizationId);
      if (!office) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.repos.offices.hardDelete(input.id);
      return { id: input.id };
    }),
});
