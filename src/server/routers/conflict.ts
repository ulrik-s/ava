import { z } from "zod";
import { router, protectedProcedure } from "../trpc";

export const conflictRouter = router({
  check: protectedProcedure
    .input(
      z.object({
        searchTerm: z.string().min(1),
        searchType: z.enum(["name", "personalNumber", "both"]).default("both"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const results: Array<{
        contactId: string;
        contactName: string;
        contactType: string;
        personalNumber: string | null;
        orgNumber: string | null;
        matterId: string;
        matterNumber: string;
        matterTitle: string;
        role: string;
        klient: string | null;
      }> = [];

      // Search by personal/org number (exact substring match)
      if (input.searchType === "personalNumber" || input.searchType === "both") {
        const byNumber = await ctx.prisma.matterContact.findMany({
          where: {
            matter: { organizationId: ctx.user.organizationId },
            contact: {
              OR: [
                { personalNumber: { contains: input.searchTerm } },
                { orgNumber: { contains: input.searchTerm } },
              ],
            },
          },
          include: {
            contact: true,
            matter: {
              include: {
                contacts: {
                  where: { role: "KLIENT" },
                  include: { contact: { select: { name: true } } },
                  take: 1,
                },
              },
            },
          },
        });

        for (const mc of byNumber) {
          const klient = mc.matter.contacts[0]?.contact.name ?? null;
          results.push({
            contactId: mc.contact.id,
            contactName: mc.contact.name,
            contactType: mc.contact.contactType,
            personalNumber: mc.contact.personalNumber,
            orgNumber: mc.contact.orgNumber,
            matterId: mc.matter.id,
            matterNumber: mc.matter.matterNumber,
            matterTitle: mc.matter.title,
            role: mc.role,
            klient,
          });
        }
      }

      // Search by name (fuzzy using trigram similarity)
      if (input.searchType === "name" || input.searchType === "both") {
        const byName = await ctx.prisma.$queryRaw<
          Array<{
            contact_id: string;
            contact_name: string;
            contact_type: string;
            personal_number: string | null;
            org_number: string | null;
            matter_id: string;
            matter_number: string;
            matter_title: string;
            role: string;
            similarity: number;
          }>
        >`
          SELECT
            c.id as contact_id,
            c.name as contact_name,
            c.contact_type,
            c.personal_number,
            c.org_number,
            m.id as matter_id,
            m.matter_number,
            m.title as matter_title,
            mc.role,
            similarity(c.name, ${input.searchTerm}) as similarity
          FROM contacts c
          JOIN matter_contacts mc ON mc.contact_id = c.id
          JOIN matters m ON m.id = mc.matter_id
          WHERE m.organization_id = ${ctx.user.organizationId}
            AND similarity(c.name, ${input.searchTerm}) > 0.3
          ORDER BY similarity DESC
        `;

        for (const row of byName) {
          if (!results.some((r) => r.contactId === row.contact_id && r.matterId === row.matter_id && r.role === row.role)) {
            // Fetch klient for this matter
            const klientLink = await ctx.prisma.matterContact.findFirst({
              where: { matterId: row.matter_id, role: "KLIENT" },
              include: { contact: { select: { name: true } } },
            });

            results.push({
              contactId: row.contact_id,
              contactName: row.contact_name,
              contactType: row.contact_type,
              personalNumber: row.personal_number,
              orgNumber: row.org_number,
              matterId: row.matter_id,
              matterNumber: row.matter_number,
              matterTitle: row.matter_title,
              role: row.role,
              klient: klientLink?.contact.name ?? null,
            });
          }
        }
      }

      // Log the check
      await ctx.prisma.conflictCheck.create({
        data: {
          searchTerm: input.searchTerm,
          searchType: input.searchType,
          results: results as unknown as object,
          checkedById: ctx.user.id,
        },
      });

      return {
        results,
        matchCount: results.length,
        searchTerm: input.searchTerm,
      };
    }),

  history: protectedProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const [checks, total] = await Promise.all([
        ctx.prisma.conflictCheck.findMany({
          orderBy: { createdAt: "desc" },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          include: { checkedBy: { select: { name: true } } },
        }),
        ctx.prisma.conflictCheck.count(),
      ]);

      return { checks, total, pages: Math.ceil(total / input.pageSize) };
    }),
});
