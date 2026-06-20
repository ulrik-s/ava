import { z } from "zod";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { Contact } from "@/lib/shared/schemas/contact";
import { contactTypeSchema } from "@/lib/shared/schemas/enums";
import { contactIdSchema, asId } from "@/lib/shared/schemas/ids";
import { emit } from "../events/emit";
import { router, orgProcedure, requireOrgOwned, TRPCError } from "../trpc";

export const contactRouter = router({
  list: orgProcedure
    .input(
      z.object({
        search: z.string().optional(),
        contactType: contactTypeSchema.optional(),
        page: z.number().min(1).default(1),
        // Cap höjt till 1000: kalender-event-formuläret behöver ALLA kontakter
        // (för invitee-pickern), inte sidvis. pageSize:500 misslyckades tidigare.
        pageSize: z.number().min(1).max(1000).default(20),
      })
    )
    // Migrerad till repository-sömmen (ADR 0020): listForOrg kapslar in
    // topp-nivå-filter, sök och _count.
    .query(async ({ ctx, input }) => {
      const { contacts, total } = await ctx.repos.contacts.listForOrg(ctx.orgId, {
        search: input.search,
        contactType: input.contactType,
        page: input.page,
        pageSize: input.pageSize,
      });
      return { contacts, total, pages: Math.ceil(total / input.pageSize) };
    }),

  getById: orgProcedure
    .input(z.object({ id: contactIdSchema }))
    // Migrerad: getByIdFull (barn/förälder/ärende-kopplingar), org-scopad.
    .query(async ({ ctx, input }) => {
      const contact = await ctx.repos.contacts.getByIdFull(input.id, ctx.orgId);
      if (!contact) throw new TRPCError({ code: "NOT_FOUND" });
      return contact;
    }),

  create: orgProcedure
    .input(
      z.object({
        /** Valfritt klient-genererat id (ADR 0003) — annars genererar store:n. */
        id: contactIdSchema.optional(),
        name: z.string().min(1),
        contactType: contactTypeSchema,
        personalNumber: z.string().optional(),
        orgNumber: z.string().optional(),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
        parentId: contactIdSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const contact = await ctx.repos.contacts.create({
        ...omitUndefined(input),
        email: input.email || null,
        organizationId: asId<"OrganizationId">(ctx.orgId),
      } satisfies Partial<Contact>);
      await emit.contactCreated(ctx, contact);
      return contact;
    }),

  update: orgProcedure
    .input(
      z.object({
        id: contactIdSchema,
        name: z.string().min(1).optional(),
        contactType: contactTypeSchema.optional(),
        personalNumber: z.string().optional(),
        orgNumber: z.string().optional(),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Säkerhet: verifiera att kontakten tillhör anropande org innan update.
      await requireOrgOwned(
        () => ctx.repos.contacts.getById(input.id),
        ctx.orgId,
        (c) => c.organizationId,
      );
      const { id, ...data } = input;
      const updated = await ctx.repos.contacts.update(id, {
        ...omitUndefined(data),
        email: input.email || null,
      } satisfies Partial<Contact>);
      await emit.contactUpdated(ctx, id, data);
      return updated;
    }),

  delete: orgProcedure
    .input(z.object({ id: contactIdSchema }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgOwned(
        () => ctx.repos.contacts.getById(input.id),
        ctx.orgId,
        (c) => c.organizationId,
      );
      // Hård delete bevarar dagens beteende (se ADR 0017-not om delete-policy).
      await ctx.repos.contacts.hardDelete(input.id);
      await emit.contactDeleted(ctx, input.id);
      return { id: input.id };
    }),

  // Add a contact person to an organization
  addChild: orgProcedure
    .input(
      z.object({
        parentId: contactIdSchema,
        name: z.string().min(1),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgOwned(
        () => ctx.repos.contacts.getById(input.parentId),
        ctx.orgId,
        (c) => c.organizationId,
      );
      return ctx.repos.contacts.create({
        name: input.name,
        contactType: "PERSON",
        email: input.email || null,
        phone: input.phone,
        notes: input.notes,
        parentId: input.parentId,
        organizationId: asId<"OrganizationId">(ctx.orgId),
      } satisfies Partial<Contact>);
    }),
});
