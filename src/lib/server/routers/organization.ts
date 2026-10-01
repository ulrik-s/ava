import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ledgerAccountMapSchema } from "@/lib/shared/accounting/account-map";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { orgImageSchema } from "@/lib/shared/org-image";
import type { UserRole } from "@/lib/shared/schemas/enums";
import { hourlyRatesSchema } from "@/lib/shared/schemas/hourly-rates";
import { officeIdSchema, organizationIdSchema, asId } from "@/lib/shared/schemas/ids";
import type { Office, Organization } from "@/lib/shared/schemas/organization";
import { normalizeStandardAtgarder, standardAtgardSchema } from "@/lib/shared/standard-atgard";
import { assertAdmin } from "../auth/assert-admin";
import { assertSetupFieldsAllowed } from "../auth/setup-fields";
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

/** Projektion för settings-vyn. */
function toOrgSettings(org: Organization) {
  return {
    id: org.id,
    name: org.name,
    ...nullableOrgFields(org),
    /** Byråns vokabulär av giltiga dokument-etiketter (#621). */
    documentTags: org.documentTags ?? [],
    /** Gränsbelopp (öre) för aconto-utskick (#885). */
    accontoThresholdOre: org.accontoThresholdOre ?? null,
    /** Byråns timpris per kategori (öre/h, #1206). */
    hourlyRates: org.hourlyRates ?? {},
    /** Byråns standardåtgärder (#956) — samma beskrivning + tid för alla. */
    standardAtgarder: org.standardAtgarder ?? [],
  };
}

/**
 * Byråinställningar en medlem får ändra (#1370): bara dokument-etiketternas
 * vokabulär, som juristerna använder i sitt dagliga arbete. Allt annat syns på
 * dokument och fakturor eller styr betalningar, bokföring och prissättning
 * (byrånamn, adress, logotyp, sigill, bankgiro, kontoplan, timpriser …) och
 * ändras bara av admin (#1344). En medlem kan skicka hela formuläret så länge
 * de övriga fälten är oförändrade.
 */
const MEMBER_SETTINGS: ReadonlySet<string> = new Set(["documentTags"]);

/** Objektets nycklar i sorterad ordning — jämförelsen ska inte bero på ordningen. */
function sortedKeys(_key: string, v: unknown): unknown {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
  return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
}

/** Tomt fält, tom lista/karta och saknat räknas lika. */
const EMPTY_SETTING: ReadonlySet<string> = new Set(["null", '""', "{}", "[]"]);

/** Jämförbart värde (`null` = tomt). */
function settingValue(v: unknown): string | null {
  const json = JSON.stringify(v ?? null, sortedKeys);
  return EMPTY_SETTING.has(json) ? null : json;
}

/** Kasta FORBIDDEN om en icke-admin försöker ändra något annat än medlemsfälten. */
function assertMayChangeSettings(role: UserRole, current: Organization | null, patch: Partial<Organization>): void {
  if (role === "ADMIN") return;
  const before: Readonly<Record<string, unknown>> = current ?? {};
  const changed = Object.entries(patch)
    .filter(([k, v]) => !MEMBER_SETTINGS.has(k) && settingValue(v) !== settingValue(before[k]))
    .map(([k]) => k);
  if (changed.length > 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Endast administratörer kan ändra byråns uppgifter: ${changed.join(", ")}.` });
  }
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
        /** Byråns vokabulär av giltiga dokument-etiketter (#621). Hela listan
         *  ersätts (set-semantik); dedupas + tomma rensas. */
        documentTags: z.array(z.string()).optional(),
        /** Gränsbelopp (öre) för aconto-utskick (#885). */
        accontoThresholdOre: z.number().int().nonnegative().optional(),
        /** Timpris per kategori (öre/h, #1206). HELA kartan ersätts; en
         *  utelämnad kategori har inget byråpris (→ timarvodet). */
        hourlyRates: hourlyRatesSchema.optional(),
        /** Byråns standardåtgärder (#956). HELA listan ersätts — admin redigerar
         *  den som en enhet, så en borttagen post försvinner. */
        standardAtgarder: z.array(standardAtgardSchema).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = asId<"OrganizationId">(ctx.user.organizationId);
      // Normalisera vokabulären: trimma, släng tomma, dedupa (set-semantik).
      const patch = omitUndefined(input);
      assertMayChangeSettings(ctx.user.role, await ctx.repos.organizations.getById(orgId), patch);
      if (patch.documentTags) {
        patch.documentTags = [...new Set(patch.documentTags.map((t) => t.trim()).filter(Boolean))];
      }
      if (patch.standardAtgarder) patch.standardAtgarder = normalizeStandardAtgarder(patch.standardAtgarder);
      return ctx.repos.organizations.update(orgId, patch satisfies Partial<Organization>);
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
        accontoThresholdOre: z.number().int().nonnegative().optional(),
        /** Byråns timpris per kategori (#1206) — setup-/seed-väg. */
        hourlyRates: hourlyRatesSchema.optional(),
        /** Byråns standardåtgärder (#956) — setup-/seed-väg (ADR 0003). */
        standardAtgarder: z.array(standardAtgardSchema).optional(),
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
