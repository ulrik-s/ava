import { z } from "zod";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import {
  matterRoleSchema,
  contactTypeSchema,
  matterStatusSchema,
  paymentMethodSchema,
} from "@/lib/shared/schemas/enums";
import {
  matterIdSchema,
  contactIdSchema,
  matterContactIdSchema,
  userIdSchema,
  asId,
  type MatterId,
  type ContactId,
  type OrganizationId,
  type UserId,
} from "@/lib/shared/schemas/ids";
import type { Matter, MatterContact } from "@/lib/shared/schemas/matter";
import { emit } from "../events/emit";
import type { Repositories } from "../repositories/repositories";
import { router, orgProcedure, TRPCError } from "../trpc";

type MatterCtx = { repos: Repositories; orgId: OrganizationId };

/**
 * Hjälpare: hämta matter och verifiera att den tillhör anropande org.
 * `matterId` är branded ([[ids]]) — TS hindrar att man råkar skicka en
 * `ContactId` hit. Kastar NOT_FOUND vid mismatch (speglar `requireOrgOwned`).
 */
async function assertMatterInOrg(ctx: MatterCtx, matterId: MatterId): Promise<Matter> {
  const m = await ctx.repos.matters.getByIdInOrg(matterId, ctx.orgId);
  if (!m) throw new TRPCError({ code: "NOT_FOUND" });
  return m;
}

/**
 * create-input. Optionella setup-fält (id, matterNumber, status,
 * paymentMethod, taxa…) tas emot för demo-generatorn/provisionering
 * (ADR 0003) — i normalt UI-flöde utelämnas de och defaultas.
 */
const matterCreateInput = z.object({
  id: matterIdSchema.optional(),
  matterNumber: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  matterType: z.string().optional(),
  status: matterStatusSchema.optional(),
  paymentMethod: paymentMethodSchema.optional(),
  paymentMethodNote: z.string().nullable().optional(),
  paymentMethodDecidedAt: z.string().nullable().optional(),
  isTaxeArende: z.boolean().optional(),
  taxaLevel: z.number().int().min(1).max(4).nullable().optional(),
  taxaHuvudforhandlingMin: z.number().int().nonnegative().nullable().optional(),
  taxaHasFTax: z.boolean().nullable().optional(),
  /** Klientens självrisk-/kostnadsandel i bips (#801) — sätts vid skapande i
   *  seed/fixtures; annars via `update`. */
  clientShareBips: z.number().int().min(0).max(10000).nullable().optional(),
  /** Rättshjälpens timtak (rättshjälpslagen: 100 tim). */
  rattshjalpMaxTimmar: z.number().int().positive().nullable().optional(),
  /** Ansvarig advokat/biträdande jurist (#174) — styr ärendenummerserien. */
  responsibleLawyerId: userIdSchema.optional(),
  /** Domstolens målnummer (#173) — matchningsnyckel för domstolsbetalningar. */
  courtCaseNumber: z.string().optional(),
  /** Historiskt skapad-datum (demo-generator/fixtures, ADR 0003) — annars now(). */
  createdAt: z.string().optional(),
  klientId: contactIdSchema.optional(),
});
type MatterCreateInput = z.infer<typeof matterCreateInput>;

/** Format `<PREFIX?><YYYY>-<NNNN>` — fångar (prefix, år, löpnummer). */
const MATTER_NUMBER_RE = /^([A-ZÅÄÖ]{1,3})?(\d{4})-(\d{4})$/;

/** Löpnumret i ett ärendenummer OM det avser `year`, annars 0. */
function seqForYear(matterNumber: string, year: number): number {
  const m = MATTER_NUMBER_RE.exec(matterNumber);
  if (!m || Number(m[2]) !== year) return 0;
  return parseInt(m[3] ?? "0", 10);
}

/** Högsta löpnumret för `year` bland en uppsättning ärenden. */
function maxSeq(matters: ReadonlyArray<{ matterNumber: string }>, year: number): number {
  return matters.reduce((mx, m) => Math.max(mx, seqForYear(m.matterNumber, year)), 0);
}

/** Den ansvariga juristens prefix (tom om okänd/ej i org:en/ingen prefix satt). */
async function lawyerPrefix(ctx: MatterCtx, userId: UserId): Promise<string> {
  const u = (await ctx.repos.users.getByIdInOrg(userId, ctx.orgId)) as
    | { matterNumberPrefix?: string | null }
    | null;
  return u?.matterNumberPrefix ?? "";
}

/**
 * Nästa ärendenummer (#174) — per ANSVARIG JURIST-serie.
 *
 * Löpnumret = max(juristens egna ärenden i år, befintliga nummer med
 * mål-prefixet i år) + 1. Dubbel-maxen ger två garantier:
 *   - **Fortsätt vid prefix-byte:** numret räknas på juristens EGNA ärenden,
 *     inte på prefix-strängen → byter juristen `AA`→`AB` fortsätter serien
 *     (`AB2026-0003`) i stället för att börja om på 1.
 *   - **Kollisionsfritt vid prefix-återbruk:** räknas även mot befintliga
 *     nummer som redan bär mål-prefixet, så en ny jurist som tar ett frigjort
 *     prefix inte återanvänder gamla nummer.
 * Format `<PREFIX><YYYY>-<NNNN>`; utan prefix `<YYYY>-<NNNN>` (org-gemensam
 * fallback, bakåtkompatibelt).
 */
async function nextMatterNumber(ctx: MatterCtx, responsibleLawyerId?: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = responsibleLawyerId ? await lawyerPrefix(ctx, asId<"UserId">(responsibleLawyerId)) : "";

  const ownMatters = responsibleLawyerId
    ? await ctx.repos.matters.listByResponsibleLawyer(ctx.orgId, asId<"UserId">(responsibleLawyerId))
    : [];
  const prefixMatters = await ctx.repos.matters.listByNumberPrefix(ctx.orgId, `${prefix}${year}-`);

  const seq = Math.max(maxSeq(ownMatters, year), maxSeq(prefixMatters, year)) + 1;
  return `${prefix}${year}-${seq.toString().padStart(4, "0")}`;
}

function toDateOrNull(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  return v ? new Date(v) : null;
}

/** Sätter ett datumfält (sträng → Date | null) på update-datat, men bara om
 *  det skickades med (undefined = rör ej). Håller update-mutationen ≤8. */
function applyOptionalDate(data: Record<string, unknown>, key: string, value: string | null | undefined): void {
  const d = toDateOrNull(value);
  if (d !== undefined) data[key] = d;
}

function buildMatterData(
  orgId: string,
  matterNumber: string,
  responsibleLawyerId: string,
  input: MatterCreateInput,
): Record<string, unknown> {
  const optional: Record<string, unknown> = {
    id: input.id,
    responsibleLawyerId,
    courtCaseNumber: input.courtCaseNumber,
    paymentMethod: input.paymentMethod,
    paymentMethodNote: input.paymentMethodNote,
    paymentMethodDecidedAt: toDateOrNull(input.paymentMethodDecidedAt),
    taxaLevel: input.taxaLevel,
    taxaHuvudforhandlingMin: input.taxaHuvudforhandlingMin,
    taxaHasFTax: input.taxaHasFTax,
    clientShareBips: input.clientShareBips,
    rattshjalpMaxTimmar: input.rattshjalpMaxTimmar,
    createdAt: input.createdAt ? new Date(input.createdAt) : undefined,
  };
  const data: Record<string, unknown> = {
    title: input.title,
    description: input.description,
    matterType: input.matterType,
    isTaxeArende: input.isTaxeArende ?? false,
    matterNumber,
    organizationId: orgId,
    // Explicit (Prisma schema-default appliceras inte av in-memory-store:n).
    status: input.status ?? "ACTIVE",
  };
  for (const [k, v] of Object.entries(optional)) if (v !== undefined) data[k] = v;
  return data;
}

// Branded params: en swap av argumenten (matterId ↔ klientId) blir ett TS-fel.
async function linkKlient(ctx: MatterCtx, matterId: MatterId, klientId: ContactId): Promise<void> {
  const contact = await ctx.repos.contacts.getByIdFull(klientId, ctx.orgId);
  if (!contact) throw new TRPCError({ code: "NOT_FOUND" });
  await ctx.repos.matterContacts.create({ matterId, contactId: klientId, role: "KLIENT" } satisfies Partial<MatterContact>);
}

export const matterRouter = router({
  list: orgProcedure
    .input(
      z.object({
        search: z.string().optional(),
        status: matterStatusSchema.optional(),
        /** Filtrera till ärenden som medarbetaren har arbetat på (har tidsposter på). */
        employeeId: userIdSchema.optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(500).default(20),
      })
    )
    // Migrerad till repository-sömmen (ADR 0020): listForOrg kapslar in
    // filter/sök-where + KLIENT-include + _count + total.
    .query(async ({ ctx, input }) => {
      const { matters, total } = await ctx.repos.matters.listForOrg(ctx.orgId, {
        search: input.search,
        status: input.status,
        employeeId: input.employeeId,
        page: input.page,
        pageSize: input.pageSize,
      });
      // Täcknings-tak-kolumn (#793): bifoga upparbetat (debiterbart) per ärende
      // batchat, så listan kan visa/sortera/filtrera mot rättshjälps-/rättsskyddstaket.
      const usage = await ctx.repos.timeEntries.coverageUsageForMatters(matters.map((m) => asId<"MatterId">(m.id)));
      const withUsage = matters.map((m) => ({ ...m, coverageUsage: usage[m.id] ?? { billableMinutes: 0, billableValueOre: 0 } }));
      return { matters: withUsage, total, pages: Math.ceil(total / input.pageSize) };
    }),

  getById: orgProcedure
    .input(z.object({ id: matterIdSchema }))
    .query(async ({ ctx, input }) => {
      const matter = await ctx.repos.matters.getByIdWithContacts(input.id, ctx.orgId);
      if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte." });
      return matter;
    }),

  create: orgProcedure
    .input(matterCreateInput)
    .mutation(async ({ ctx, input }) => {
      // Ansvarig jurist = explicit val, annars skaparen (#174). Styr serien.
      const responsibleLawyerId = input.responsibleLawyerId ?? ctx.user.id;
      const matterNumber = input.matterNumber ?? (await nextMatterNumber(ctx, responsibleLawyerId));
      const matter = await ctx.repos.matters.create(
        buildMatterData(ctx.orgId, matterNumber, responsibleLawyerId, input) satisfies Partial<Matter>,
      );
      await emit.matterCreated(ctx, matter);
      // matter.id washar till `any` via Joined<>; brand explicit. klientId
      // kommer från (redan validerad) input-sträng → trusted boundary-cast.
      if (input.klientId) {
        await linkKlient(ctx, asId<"MatterId">(matter.id), asId<"ContactId">(input.klientId));
      }
      return matter;
    }),

  update: orgProcedure
    .input(
      z.object({
        id: matterIdSchema,
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        status: matterStatusSchema.optional(),
        matterType: z.string().optional(),
        /** Byt ansvarig jurist (#174). Befintligt ärendenummer ändras EJ. */
        responsibleLawyerId: userIdSchema.nullable().optional(),
        /** Domstolens målnummer (#173) — för avprickning av domstolsbetalningar. */
        courtCaseNumber: z.string().nullable().optional(),
        paymentMethod: paymentMethodSchema.optional(),
        paymentMethodNote: z.string().nullable().optional(),
        paymentMethodDecidedAt: z.string().nullable().optional(),
        clientShareBips: z.number().int().min(0).max(10000).nullable().optional(),
        rattsskyddMaxOre: z.number().int().nonnegative().nullable().optional(),
        rattshjalpMaxTimmar: z.number().int().positive().nullable().optional(),
        /** Rättsskydd (#810): tvistdatum + bolagets beslutsdatum, ur beslutet. */
        tvistUppkomDatum: z.string().nullable().optional(),
        rattsskyddBeslutDatum: z.string().nullable().optional(),
        /** Rättsskydd (#811): datum då rättsskydd nekades. */
        rattsskyddNekadAt: z.string().nullable().optional(),
        isTaxeArende: z.boolean().optional(),
        taxaLevel: z.number().int().min(1).max(4).nullable().optional(),
        taxaHuvudforhandlingMin: z.number().int().nonnegative().nullable().optional(),
        taxaHasFTax: z.boolean().nullable().optional(),
        taxaHufStart: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const before = await assertMatterInOrg(ctx, asId<"MatterId">(input.id));
      const { id, paymentMethodDecidedAt, taxaHufStart, tvistUppkomDatum, rattsskyddBeslutDatum, rattsskyddNekadAt, ...rest } = input;
      const data: Record<string, unknown> = { ...rest };
      // Datumsträngar (yyyy-mm-dd) → Date | null; lämna orörda om utelämnade.
      applyOptionalDate(data, "paymentMethodDecidedAt", paymentMethodDecidedAt);
      applyOptionalDate(data, "taxaHufStart", taxaHufStart);
      applyOptionalDate(data, "tvistUppkomDatum", tvistUppkomDatum);
      applyOptionalDate(data, "rattsskyddBeslutDatum", rattsskyddBeslutDatum);
      applyOptionalDate(data, "rattsskyddNekadAt", rattsskyddNekadAt);
      const updated = await ctx.repos.matters.update(id, data satisfies Partial<Matter>);
      await emit.matterUpdated(ctx, id, data);
      if (input.status && input.status !== before.status) {
        await emit.matterStatusChanged(ctx, id, before.status, input.status);
        if (input.status === "ARCHIVED") await emit.matterArchived(ctx, id);
      }
      return updated;
    }),

  /** Upparbetat (debiterbart) i ärendet — driver täcknings-takets varningsbadge (#793). */
  coverageUsage: orgProcedure
    .input(z.object({ matterId: matterIdSchema }))
    .query(async ({ ctx, input }) => {
      await assertMatterInOrg(ctx, input.matterId);
      return ctx.repos.timeEntries.coverageUsageForMatter(input.matterId);
    }),

  addContact: orgProcedure
    .input(
      z.object({
        /** Valfritt klient-genererat id (ADR 0003) — annars genererar store:n. */
        id: matterContactIdSchema.optional(),
        matterId: matterIdSchema,
        contactId: contactIdSchema,
        role: matterRoleSchema,
        notes: z.string().optional(),
        /** Historiskt skapad-datum (demo-generator/fixtures) — annars now(). */
        createdAt: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMatterInOrg(ctx, input.matterId);
      const contact = await ctx.repos.contacts.getByIdFull(input.contactId, ctx.orgId);
      if (!contact) throw new TRPCError({ code: "NOT_FOUND" });
      const { createdAt, id, notes, ...rest } = input;
      return ctx.repos.matterContacts.linkContact(omitUndefined({
        ...rest,
        id,
        notes,
        ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
      }) satisfies Partial<MatterContact>);
    }),

  // Create a new contact and link it to the matter in one step
  addNewContact: orgProcedure
    .input(
      z.object({
        matterId: matterIdSchema,
        name: z.string().min(1),
        contactType: contactTypeSchema,
        personalNumber: z.string().optional(),
        orgNumber: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        role: matterRoleSchema,
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMatterInOrg(ctx, input.matterId);
      const { matterId, role, notes, ...contactData } = input;

      // Återanvänd befintlig kontakt på pnr/orgnr, annars skapa ny.
      let contact: { id: string } | null = null;
      if (contactData.personalNumber) {
        contact = await ctx.repos.contacts.findByPersonalNumber(ctx.orgId, contactData.personalNumber);
      } else if (contactData.orgNumber) {
        contact = await ctx.repos.contacts.findByOrgNumber(ctx.orgId, contactData.orgNumber);
      }

      if (!contact) {
        contact = await ctx.repos.contacts.create({ ...contactData, organizationId: ctx.orgId } as never);
      }

      return ctx.repos.matterContacts.linkContact(
        { matterId, contactId: asId<"ContactId">(contact.id), role, notes } satisfies Partial<MatterContact>,
      );
    }),

  removeContact: orgProcedure
    .input(z.object({ matterContactId: matterContactIdSchema }))
    .mutation(async ({ ctx, input }) => {
      // Verifiera via matterContact→matter→org INNAN delete.
      const owned = await ctx.repos.matterContacts.getByIdInOrg(input.matterContactId, ctx.orgId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.repos.matterContacts.hardDelete(input.matterContactId);
      return owned;
    }),
});
