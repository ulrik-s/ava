import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ledgerAccountMapSchema } from "@/lib/shared/accounting/account-map";
import { isCustomKind, normalizeKinds, organizationKinds } from "@/lib/shared/document-kinds";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { orgImageSchema } from "@/lib/shared/org-image";
import { PUBLIC_ASSIGNMENT_METHOD } from "@/lib/shared/public-assignment";
import type { UserRole } from "@/lib/shared/schemas/enums";
import { hourlyRatesSchema } from "@/lib/shared/schemas/hourly-rates";
import { officeIdSchema, organizationIdSchema, asId } from "@/lib/shared/schemas/ids";
import type { Office, Organization } from "@/lib/shared/schemas/organization";
import { normalizeStandardAtgarder, standardAtgarderInputSchema } from "@/lib/shared/standard-atgard";
import { assertAdmin } from "../auth/assert-admin";
import type { Principal } from "../auth/principal";
import { assertSetupFieldsAllowed } from "../auth/setup-fields";
import { applyPaymentMethodToExistingMatters } from "../billing/matter-payment-method";
import { emit } from "../events/emit";
import { newRowId, type QueuedCallScope } from "../queued-call";
import { router, protectedProcedure, type Context } from "../trpc";

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

/**
 * Byråinställningar en medlem får ändra (#1370): bara byråns egna dokumenttyper
 * (ADR 0038; tidigare etikett-vokabulären), som juristerna använder i sitt
 * dagliga arbete. Allt annat syns på
 * dokument och fakturor eller styr betalningar, bokföring och prissättning
 * (byrånamn, adress, logotyp, sigill, bankgiro, kontoplan, timpriser …) och
 * ändras bara av admin (#1344). En medlem kan skicka hela formuläret så länge
 * de övriga fälten är oförändrade.
 */
const MEMBER_SETTINGS: ReadonlySet<string> = new Set(["documentKinds", "documentTags"]);

/**
 * Byråns egna typer ur indata (ADR 0038): normaliserade, utan dubbletter och
 * utan inbyggda typer (de finns redan). Den äldre formen `documentTags` tas
 * emot från gamla klienter och blir samma lista; taggfältet töms.
 */
function withOrganizationKinds<P extends { documentKinds?: string[]; documentTags?: string[] }>(patch: P): P {
  const list = patch.documentKinds ?? patch.documentTags;
  if (!list) return patch;
  return { ...patch, documentKinds: normalizeKinds(list).filter(isCustomKind), documentTags: [] };
}

/** Trimma, släng tomma, dedupa (set-semantik, ordningen behålls). */
function normalizeVocabulary(list: readonly string[]): string[] {
  return [...new Set(list.map((t) => t.trim()).filter(Boolean))];
}

type MatterTypesPatch = { matterTypes?: string[]; publicAssignmentMatterTypes?: string[] };

/**
 * Markeringen att indata ska ersätta (#1638): den skickade listan, eller —
 * när bara ärendetyperna ändras — den sparade, så att en borttagen typ också
 * försvinner ur markeringen. Aldrig satt (`null`) förblir aldrig satt.
 */
function publicAssignmentInput(patch: MatterTypesPatch, current: Organization | null): readonly string[] | undefined {
  if (patch.publicAssignmentMatterTypes) return patch.publicAssignmentMatterTypes;
  if (!patch.matterTypes) return undefined;
  return current?.publicAssignmentMatterTypes ?? undefined;
}

/**
 * Offentligt uppdrag (#1638): hela listan ersätts, normaliserad som
 * ärendetyperna, och bara med namn som finns bland byråns ärendetyper
 * (de nya i samma anrop, annars de sparade).
 */
function withPublicAssignmentTypes<P extends MatterTypesPatch>(patch: P, current: Organization | null): P {
  const list = publicAssignmentInput(patch, current);
  if (!list) return patch;
  const known = new Set(patch.matterTypes ?? current?.matterTypes);
  return { ...patch, publicAssignmentMatterTypes: normalizeVocabulary(list).filter((t) => known.has(t)) };
}

/** Det `updateSettings` behöver ur anropet för att byta befintliga ärenden. */
type SettingsCtx = QueuedCallScope & Pick<Context, "repos" | "dataStore"> & { user: Principal };

/**
 * Befintliga ärenden (#1640): när anropet sparar ärendetyperna eller
 * markeringen och markeringen inte är tom, får byråns ärenden med en markerad
 * typ betalningssättet Offentligt uppdrag, med admin som författare till
 * anteckningarna. Urkryssning eller andra inställningar ändrar inga ärenden.
 */
async function applyToExistingMatters(ctx: SettingsCtx, marked: readonly string[] | undefined): Promise<void> {
  if (!marked?.length) return;
  const noteCtx = { ...ctx, orgId: ctx.user.organizationId };
  const ids = await ctx.repos.transaction((repos) =>
    applyPaymentMethodToExistingMatters(repos, noteCtx, { publicAssignmentMatterTypes: marked }));
  for (const id of ids) await emit.matterUpdated(ctx, id, { paymentMethod: PUBLIC_ASSIGNMENT_METHOD });
}

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
    .mutation(async ({ ctx, input }) => {
      const orgId = asId<"OrganizationId">(ctx.user.organizationId);
      // Normalisera vokabulären: trimma, släng tomma, dedupa (set-semantik).
      const patch = omitUndefined(input);
      const current = await ctx.repos.organizations.getById(orgId);
      assertMayChangeSettings(ctx.user.role, current, patch);
      if (patch.matterTypes) patch.matterTypes = normalizeVocabulary(patch.matterTypes);
      if (patch.standardAtgarder) patch.standardAtgarder = normalizeStandardAtgarder(patch.standardAtgarder);
      const normalized = withPublicAssignmentTypes(withOrganizationKinds(patch), current);
      const saved = await ctx.repos.organizations.update(orgId, normalized satisfies Partial<Organization>);
      await applyToExistingMatters(ctx, normalized.publicAssignmentMatterTypes);
      return saved;
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
