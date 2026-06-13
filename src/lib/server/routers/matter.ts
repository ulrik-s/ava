import { z } from "zod";
import { router, orgProcedure, requireOrgOwned } from "../trpc";
import type { IDataStore } from "../data-store/IDataStore";
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
  asId,
  type MatterId,
  type ContactId,
} from "@/lib/shared/schemas/ids";
import { emit } from "../events/emit";
import { omitUndefined } from "@/lib/shared/omit-undefined";

type MatterCtx = { dataStore: IDataStore; orgId: string };

/**
 * Hjälpare: hämta matter och verifiera att den tillhör anropande org.
 * `matterId` är branded ([[ids]]) — TS hindrar att man råkar skicka en
 * `ContactId` hit.
 */
const assertMatterInOrg = (ctx: MatterCtx, matterId: MatterId) =>
  requireOrgOwned(
    () => ctx.dataStore.matters.findUnique({ where: { id: matterId } }),
    ctx.orgId,
    (m) => m.organizationId,
  );

/**
 * create-input. Optionella setup-fält (id, matterNumber, status,
 * paymentMethod, taxa…) tas emot för demo-generatorn/provisionering
 * (ADR 0003) — i normalt UI-flöde utelämnas de och defaultas.
 */
const matterCreateInput = z.object({
  id: z.string().optional(),
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
  /** Ansvarig advokat/biträdande jurist (#174) — styr ärendenummerserien. */
  responsibleLawyerId: z.string().optional(),
  /** Domstolens målnummer (#173) — matchningsnyckel för domstolsbetalningar. */
  courtCaseNumber: z.string().optional(),
  /** Historiskt skapad-datum (demo-generator/fixtures, ADR 0003) — annars now(). */
  createdAt: z.string().optional(),
  klientId: z.string().optional(),
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
async function lawyerPrefix(ctx: MatterCtx, userId: string): Promise<string> {
  const u = (await ctx.dataStore.users.findUnique({ where: { id: userId } })) as
    | { organizationId?: string; matterNumberPrefix?: string | null }
    | null;
  if (!u || u.organizationId !== ctx.orgId) return "";
  return u.matterNumberPrefix ?? "";
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
  const prefix = responsibleLawyerId ? await lawyerPrefix(ctx, responsibleLawyerId) : "";

  const ownMatters = responsibleLawyerId
    ? await ctx.dataStore.matters.findMany({ where: { organizationId: ctx.orgId, responsibleLawyerId } })
    : [];
  const prefixMatters = await ctx.dataStore.matters.findMany({
    where: { organizationId: ctx.orgId, matterNumber: { startsWith: `${prefix}${year}-` } },
  });

  const seq = Math.max(maxSeq(ownMatters, year), maxSeq(prefixMatters, year)) + 1;
  return `${prefix}${year}-${seq.toString().padStart(4, "0")}`;
}

function toDateOrNull(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  return v ? new Date(v) : null;
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
  await requireOrgOwned(
    () => ctx.dataStore.contacts.findUnique({ where: { id: klientId } }),
    ctx.orgId,
    (c) => c.organizationId,
  );
  await ctx.dataStore.matterContacts.create({ data: { matterId, contactId: klientId, role: "KLIENT" } });
}

export const matterRouter = router({
  list: orgProcedure
    .input(
      z.object({
        search: z.string().optional(),
        status: z.enum(["ACTIVE", "CLOSED", "ARCHIVED"]).optional(),
        /** Filtrera till ärenden som medarbetaren har arbetat på (har tidsposter på). */
        employeeId: z.string().optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(500).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = {
        organizationId: ctx.orgId,
        ...(input.status ? { status: input.status } : {}),
        ...(input.employeeId ? { timeEntries: { some: { userId: input.employeeId } } } : {}),
        ...(input.search
          ? {
              OR: [
                { title: { contains: input.search, mode: "insensitive" as const } },
                { matterNumber: { contains: input.search, mode: "insensitive" as const } },
                { contacts: { some: { contact: { name: { contains: input.search, mode: "insensitive" as const } } } } },
              ],
            }
          : {}),
      };

      const [matters, total] = await Promise.all([
        ctx.dataStore.matters.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          include: {
            contacts: {
              where: { role: "KLIENT" },
              include: { contact: { select: { id: true, name: true } } },
              take: 1,
            },
            _count: { select: { documents: true, timeEntries: true, contacts: true } },
          },
          // paymentMethod, paymentMethodNote, paymentMethodDecidedAt ingår som del av Matter
        }),
        ctx.dataStore.matters.count({ where }),
      ]);

      return { matters, total, pages: Math.ceil(total / input.pageSize) };
    }),

  getById: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.dataStore.matters.findFirstOrThrow({
        where: { id: input.id, organizationId: ctx.orgId },
        include: {
          contacts: {
            include: { contact: true },
            orderBy: { createdAt: "asc" },
          },
          _count: { select: { documents: true, timeEntries: true, emails: true } },
        },
      });
    }),

  create: orgProcedure
    .input(matterCreateInput)
    .mutation(async ({ ctx, input }) => {
      // Ansvarig jurist = explicit val, annars skaparen (#174). Styr serien.
      const responsibleLawyerId = input.responsibleLawyerId ?? ctx.user.id;
      const matterNumber = input.matterNumber ?? (await nextMatterNumber(ctx, responsibleLawyerId));
      const matter = await ctx.dataStore.matters.create({
        data: buildMatterData(ctx.orgId, matterNumber, responsibleLawyerId, input),
      });
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
        id: z.string(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        status: z.enum(["ACTIVE", "CLOSED", "ARCHIVED"]).optional(),
        matterType: z.string().optional(),
        /** Byt ansvarig jurist (#174). Befintligt ärendenummer ändras EJ. */
        responsibleLawyerId: z.string().nullable().optional(),
        /** Domstolens målnummer (#173) — för avprickning av domstolsbetalningar. */
        courtCaseNumber: z.string().nullable().optional(),
        paymentMethod: z
          .enum(["PENDING", "RATTSHJALP", "RATTSSKYDD", "OFFENTLIG_FORSVARARE", "PRIVAT", "MIX"])
          .optional(),
        paymentMethodNote: z.string().nullable().optional(),
        paymentMethodDecidedAt: z.string().nullable().optional(),
        isTaxeArende: z.boolean().optional(),
        taxaLevel: z.number().int().min(1).max(4).nullable().optional(),
        taxaHuvudforhandlingMin: z.number().int().nonnegative().nullable().optional(),
        taxaHasFTax: z.boolean().nullable().optional(),
        taxaHufStart: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const before = await assertMatterInOrg(ctx, asId<"MatterId">(input.id));
      const { id, paymentMethodDecidedAt, taxaHufStart, ...rest } = input;
      const data: Record<string, unknown> = { ...rest };
      if (paymentMethodDecidedAt !== undefined) {
        data.paymentMethodDecidedAt = paymentMethodDecidedAt
          ? new Date(paymentMethodDecidedAt)
          : null;
      }
      if (taxaHufStart !== undefined) {
        data.taxaHufStart = taxaHufStart ? new Date(taxaHufStart) : null;
      }
      const updated = await ctx.dataStore.matters.update({ where: { id }, data });
      await emit.matterUpdated(ctx, id, data);
      if (input.status && input.status !== before.status) {
        await emit.matterStatusChanged(ctx, id, before.status, input.status);
        if (input.status === "ARCHIVED") await emit.matterArchived(ctx, id);
      }
      return updated;
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
      await requireOrgOwned(
        () => ctx.dataStore.contacts.findUnique({ where: { id: input.contactId } }),
        ctx.orgId,
        (c) => c.organizationId,
      );
      const { createdAt, id, notes, ...rest } = input;
      return ctx.dataStore.matterContacts.create({
        data: omitUndefined({
          ...rest,
          id,
          notes,
          ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
        }),
        include: { contact: true },
      });
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

      // Check if contact already exists by personal/org number
      let contact = null;
      if (contactData.personalNumber) {
        contact = await ctx.dataStore.contacts.findFirst({
          where: { personalNumber: contactData.personalNumber, organizationId: ctx.orgId },
        });
      } else if (contactData.orgNumber) {
        contact = await ctx.dataStore.contacts.findFirst({
          where: { orgNumber: contactData.orgNumber, organizationId: ctx.orgId },
        });
      }

      if (!contact) {
        contact = await ctx.dataStore.contacts.create({
          data: { ...contactData, organizationId: ctx.orgId },
        });
      }

      return ctx.dataStore.matterContacts.create({
        data: { matterId, contactId: contact.id, role, notes },
        include: { contact: true },
      });
    }),

  removeContact: orgProcedure
    .input(z.object({ matterContactId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verifiera via matterContact→matter→org
      await requireOrgOwned(
        () =>
          ctx.dataStore.matterContacts.findUnique({
            where: { id: input.matterContactId },
            include: { matter: { select: { organizationId: true } } },
          }),
        ctx.orgId,
        (mc) => mc.matter.organizationId,
      );
      return ctx.dataStore.matterContacts.delete({ where: { id: input.matterContactId } });
    }),
});
