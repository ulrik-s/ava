import { z } from "zod";
import { router, orgProcedure, requireOrgOwned } from "../trpc";
import { matterRoleSchema, contactTypeSchema } from "@/lib/labels";

/** Hjälpare: hämta matter och verifiera att den tillhör anropande org. */
const assertMatterInOrg = (
  ctx: { prisma: typeof import("../db").prisma; orgId: string },
  matterId: string,
) =>
  requireOrgOwned(
    () => ctx.prisma.matter.findUnique({ where: { id: matterId } }),
    ctx.orgId,
    (m) => m.organizationId,
  );

export const matterRouter = router({
  list: orgProcedure
    .input(
      z.object({
        search: z.string().optional(),
        status: z.enum(["ACTIVE", "CLOSED", "ARCHIVED"]).optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = {
        organizationId: ctx.orgId,
        ...(input.status ? { status: input.status } : {}),
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
        ctx.prisma.matter.findMany({
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
        }),
        ctx.prisma.matter.count({ where }),
      ]);

      return { matters, total, pages: Math.ceil(total / input.pageSize) };
    }),

  getById: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.matter.findFirstOrThrow({
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
    .input(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        matterType: z.string().optional(),
        klientId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const year = new Date().getFullYear();
      const lastMatter = await ctx.prisma.matter.findFirst({
        where: {
          organizationId: ctx.orgId,
          matterNumber: { startsWith: `${year}-` },
        },
        orderBy: { matterNumber: "desc" },
      });

      let seq = 1;
      if (lastMatter) {
        const lastSeq = parseInt(lastMatter.matterNumber.split("-")[1], 10);
        seq = lastSeq + 1;
      }

      const matterNumber = `${year}-${seq.toString().padStart(4, "0")}`;

      const matter = await ctx.prisma.matter.create({
        data: {
          title: input.title,
          description: input.description,
          matterType: input.matterType,
          matterNumber,
          organizationId: ctx.orgId,
        },
      });

      // If a klient was specified, link them
      if (input.klientId) {
        await requireOrgOwned(
          () => ctx.prisma.contact.findUnique({ where: { id: input.klientId! } }),
          ctx.orgId,
          (c) => c.organizationId,
        );
        await ctx.prisma.matterContact.create({
          data: {
            matterId: matter.id,
            contactId: input.klientId,
            role: "KLIENT",
          },
        });
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMatterInOrg(ctx, input.id);
      const { id, ...data } = input;
      return ctx.prisma.matter.update({ where: { id }, data });
    }),

  addContact: orgProcedure
    .input(
      z.object({
        matterId: z.string(),
        contactId: z.string(),
        role: matterRoleSchema,
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMatterInOrg(ctx, input.matterId);
      await requireOrgOwned(
        () => ctx.prisma.contact.findUnique({ where: { id: input.contactId } }),
        ctx.orgId,
        (c) => c.organizationId,
      );
      return ctx.prisma.matterContact.create({
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
        contact = await ctx.prisma.contact.findFirst({
          where: { personalNumber: contactData.personalNumber, organizationId: ctx.orgId },
        });
      } else if (contactData.orgNumber) {
        contact = await ctx.prisma.contact.findFirst({
          where: { orgNumber: contactData.orgNumber, organizationId: ctx.orgId },
        });
      }

      if (!contact) {
        contact = await ctx.prisma.contact.create({
          data: { ...contactData, organizationId: ctx.orgId },
        });
      }

      return ctx.prisma.matterContact.create({
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
          ctx.prisma.matterContact.findUnique({
            where: { id: input.matterContactId },
            include: { matter: { select: { organizationId: true } } },
          }),
        ctx.orgId,
        (mc) => mc.matter.organizationId,
      );
      return ctx.prisma.matterContact.delete({ where: { id: input.matterContactId } });
    }),
});
