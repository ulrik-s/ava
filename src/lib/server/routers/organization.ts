import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ledgerAccountMapSchema } from "@/lib/shared/accounting/account-map";
import { organizationKinds } from "@/lib/shared/document-kinds";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { orgImageSchema } from "@/lib/shared/org-image";
import { hourlyRatesSchema } from "@/lib/shared/schemas/hourly-rates";
import { officeIdSchema, organizationIdSchema, asId } from "@/lib/shared/schemas/ids";
import type { Office, Organization } from "@/lib/shared/schemas/organization";
import { standardAtgarderInputSchema } from "@/lib/shared/standard-atgard";
import { assertAdmin } from "../auth/assert-admin";
import { assertSetupFieldsAllowed } from "../auth/setup-fields";
import { updateOrgSettings } from "../organization/settings";
import { newRowId } from "../queued-call";
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
    ledgerAccountMap: org.ledgerAccountMap ?? null,
    ...brandingFields(org),
  };
}

/** Webbplats, logga och sidfotsmärke (#1218) — dokumentens byråprofil. */
function brandingFields(org: Organization) {
  return {
    website: org.website ?? null,
    logo: org.logo ?? null,
    footerSeal: org.footerSeal ?? null,
  };
}

/** Byråns ärendetyper och vilka av dem som är offentligt uppdrag (#1638). */
function matterTypeFields(org: Organization) {
  return {
    /** Byråns ärendetyper (valen när ett ärende läggs upp). */
    matterTypes: org.matterTypes,
    /** Offentligt uppdrag; `null` = aldrig satt (inga markerade). */
    publicAssignmentMatterTypes: org.publicAssignmentMatterTypes ?? null,
  };
}

/** Projektion för settings-vyn. */
function toOrgSettings(org: Organization) {
  return {
    id: org.id,
    name: org.name,
    ...nullableOrgFields(org),
    /** Byråns egna dokumenttyper (ADR 0038), utöver de inbyggda. */
    documentKinds: organizationKinds(org),
    /** Föråldrad: Samma lista under taggarnas namn, för äldre klienter (ADR 0038). */
    documentTags: organizationKinds(org),
    ...matterTypeFields(org),
    /** Gränsbelopp (öre) för aconto-utskick (#885). */
    accontoThresholdOre: org.accontoThresholdOre ?? null,
    /** Byråns timpris per kategori (öre/h, #1206). */
    hourlyRates: org.hourlyRates ?? {},
    /** Byråns standardåtgärder (#956) — samma beskrivning + tid för alla. */
    standardAtgarder: org.standardAtgarder ?? [],
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
        /** Webbplats, logga och sidfotsmärke (#1218). `null` tar bort bilden. */
        website: z.string().optional(),
        logo: orgImageSchema.nullable().optional(),
        footerSeal: orgImageSchema.nullable().optional(),
        /** Roll→konto-mappning för bokföringsexport (#249). */
        ledgerAccountMap: ledgerAccountMapSchema.optional(),
        /** Byråns egna dokumenttyper (ADR 0038). Hela listan ersätts; normaliseras. */
        documentKinds: z.array(z.string()).optional(),
        /** Föråldrad: Äldre klienters namn på samma lista (ADR 0038). */
        documentTags: z.array(z.string()).optional(),
        /** Byråns ärendetyper. Hela listan ersätts; dedupas + tomma rensas. */
        matterTypes: z.array(z.string()).optional(),
        /** Ärendetyperna som är offentligt uppdrag (#1638). Hela listan ersätts;
         *  normaliseras och begränsas till byråns ärendetyper. */
        publicAssignmentMatterTypes: z.array(z.string()).optional(),
        /** Gränsbelopp (öre) för aconto-utskick (#885). */
        accontoThresholdOre: z.number().int().nonnegative().optional(),
        /** Timpris per kategori (öre/h, #1206). HELA kartan ersätts; en
         *  utelämnad kategori har inget byråpris (→ timarvodet). */
        hourlyRates: hourlyRatesSchema.optional(),
        /** Byråns standardåtgärder (#956). HELA listan ersätts — admin redigerar
         *  den som en enhet, så en borttagen post försvinner. */
        standardAtgarder: standardAtgarderInputSchema.optional(),
      })
    )
    .mutation(({ ctx, input }) => updateOrgSettings(ctx, omitUndefined(input))),

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
        accontoThresholdOre: z.number().int().nonnegative().optional(),
        /** Byråns timpris per kategori (#1206) — setup-/seed-väg. */
        hourlyRates: hourlyRatesSchema.optional(),
        /** Byråns standardåtgärder (#956) — setup-/seed-väg (ADR 0003). */
        standardAtgarder: standardAtgarderInputSchema.optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      assertAdmin(ctx);
      // omitUndefined: `exactOptionalPropertyTypes` tillåter inte explicit
      // undefined på fält med default (standardAtgarder).
      return ctx.repos.organizations.create(omitUndefined(input) satisfies Partial<Organization>);
    }),

  // ── Offices ─────────────────────────────────────────────────────

  listOffices: protectedProcedure.query(({ ctx }) =>
    ctx.repos.offices.listByOrg(ctx.user.organizationId),
  ),

  addOffice: protectedProcedure
    .input(
      z.object({
        /** Setup-id (demo-generatorn, ADR 0003): bara admin, direkt, aldrig i kön (#1362). */
        id: officeIdSchema.optional(),
        name: z.string().min(1),
        address: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        isMain: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Kontoren syns på dokument och fakturor (#1370).
      assertAdmin(ctx);
      // Id:t bestäms av servern (#1362): härlett ur anropet (samma i klientens
      // körning och serverns omkörning), aldrig valt av klienten.
      assertSetupFieldsAllowed(ctx, { id: input.id });
      // If new office is main, demote existing main first
      if (input.isMain) await ctx.repos.offices.demoteMains(ctx.user.organizationId);
      return ctx.repos.offices.create(omitUndefined({
        ...input,
        id: input.id ?? asId<"OfficeId">(newRowId(ctx, "office")),
        organizationId: asId<"OrganizationId">(ctx.user.organizationId),
      }) satisfies Partial<Office>);
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
      assertAdmin(ctx);
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
      assertAdmin(ctx);
      const office = await ctx.repos.offices.getByIdInOrg(input.id, ctx.user.organizationId);
      if (!office) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.repos.offices.hardDelete(input.id);
      return { id: input.id };
    }),
});
