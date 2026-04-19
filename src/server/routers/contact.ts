import { z } from "zod";
import { router, orgProcedure, requireOrgOwned } from "../trpc";
import { contactTypeSchema } from "@/lib/labels";

export const contactRouter = router({
  list: orgProcedure
    .input(
      z.object({
        search: z.string().optional(),
        contactType: contactTypeSchema.optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = {
        organizationId: ctx.orgId,
        parentId: null, // Only top-level contacts, not sub-contacts
        ...(input.contactType ? { contactType: input.contactType } : {}),
        ...(input.search
          ? {
              OR: [
                { name: { contains: input.search, mode: "insensitive" as const } },
                { personalNumber: { contains: input.search } },
                { orgNumber: { contains: input.search } },
                { email: { contains: input.search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      };

      const [contacts, total] = await Promise.all([
        ctx.prisma.contact.findMany({
          where,
          orderBy: { name: "asc" },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          include: {
            _count: { select: { matterLinks: true, children: true } },
          },
        }),
        ctx.prisma.contact.count({ where }),
      ]);

      return { contacts, total, pages: Math.ceil(total / input.pageSize) };
    }),

  getById: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.contact.findFirstOrThrow({
        where: { id: input.id, organizationId: ctx.orgId },
        include: {
          children: { orderBy: { name: "asc" } },
          parent: { select: { id: true, name: true } },
          matterLinks: {
            orderBy: { createdAt: "desc" },
            include: {
              matter: {
                select: { id: true, matterNumber: true, title: true, status: true },
              },
            },
          },
        },
      });
    }),

  create: orgProcedure
    .input(
      z.object({
        name: z.string().min(1),
        contactType: contactTypeSchema,
        personalNumber: z.string().optional(),
        orgNumber: z.string().optional(),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
        parentId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.contact.create({
        data: {
          ...input,
          email: input.email || null,
          organizationId: ctx.orgId,
        },
      });
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string(),
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
        () => ctx.prisma.contact.findUnique({ where: { id: input.id } }),
        ctx.orgId,
        (c) => c.organizationId,
      );
      const { id, ...data } = input;
      return ctx.prisma.contact.update({
        where: { id },
        data: { ...data, email: data.email || null },
      });
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgOwned(
        () => ctx.prisma.contact.findUnique({ where: { id: input.id } }),
        ctx.orgId,
        (c) => c.organizationId,
      );
      return ctx.prisma.contact.delete({ where: { id: input.id } });
    }),

  // Add a contact person to an organization
  addChild: orgProcedure
    .input(
      z.object({
        parentId: z.string(),
        name: z.string().min(1),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgOwned(
        () => ctx.prisma.contact.findUnique({ where: { id: input.parentId } }),
        ctx.orgId,
        (c) => c.organizationId,
      );
      return ctx.prisma.contact.create({
        data: {
          name: input.name,
          contactType: "PERSON",
          email: input.email || null,
          phone: input.phone,
          notes: input.notes,
          parentId: input.parentId,
          organizationId: ctx.orgId,
        },
      });
    }),
});
