import { z } from "zod";
import { router, orgProcedure, requireOrgOwned } from "../trpc";
import type { IDataStore } from "../data-store/IDataStore";
import { matterRoleSchema, contactTypeSchema } from "@/lib/client/labels";
import { matterStatusSchema, paymentMethodSchema } from "@/lib/shared/schemas/enums";
import { emit } from "../events/emit";

type MatterCtx = { dataStore: IDataStore; orgId: string };

/** Hjälpare: hämta matter och verifiera att den tillhör anropande org. */
const assertMatterInOrg = (ctx: MatterCtx, matterId: string) =>
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
  /** Historiskt skapad-datum (demo-generator/fixtures, ADR 0003) — annars now(). */
  createdAt: z.string().optional(),
  klientId: z.string().optional(),
});
type MatterCreateInput = z.infer<typeof matterCreateInput>;

/** Nästa lediga ärendenummer (YYYY-NNNN) för org:en. */
async function nextMatterNumber(ctx: MatterCtx): Promise<string> {
  const year = new Date().getFullYear();
  const last = await ctx.dataStore.matters.findFirst({
    where: { organizationId: ctx.orgId, matterNumber: { startsWith: `${year}-` } },
    orderBy: { matterNumber: "desc" },
  });
  const seq = last ? parseInt(last.matterNumber.split("-")[1], 10) + 1 : 1;
  return `${year}-${seq.toString().padStart(4, "0")}`;
}

function toDateOrNull(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  return v ? new Date(v) : null;
}

function buildMatterData(orgId: string, matterNumber: string, input: MatterCreateInput): Record<string, unknown> {
  const optional: Record<string, unknown> = {
    id: input.id,
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

async function linkKlient(ctx: MatterCtx, matterId: string, klientId: string): Promise<void> {
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
      const matterNumber = input.matterNumber ?? (await nextMatterNumber(ctx));
      const matter = await ctx.dataStore.matters.create({
        data: buildMatterData(ctx.orgId, matterNumber, input),
      });
      await emit.matterCreated(ctx, matter);
      if (input.klientId) await linkKlient(ctx, matter.id, input.klientId);
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
      const before = await assertMatterInOrg(ctx, input.id);
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
        id: z.string().optional(),
        matterId: z.string(),
        contactId: z.string(),
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
      return ctx.dataStore.matterContacts.create({
        data: input,
        include: { contact: true },
      });
    }),

  // Create a new contact and link it to the matter in one step
  addNewContact: orgProcedure
    .input(
      z.object({
        matterId: z.string(),
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
