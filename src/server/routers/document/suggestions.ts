/**
 * Hantering av AI-genererade kontaktförslag (DocumentAnalysisSuggestion):
 * listning, gruppning, accept/reject — både enskilt och i grupp.
 *
 * Dedup-beslutet (matcha befintlig kontakt på pnr / orgNr / namn-i-ärende)
 * sker i den rena funktionen `findExistingContactForSuggestion` i
 * `@/lib/contact-dedup`. Routern sköter IO och transaktionsflöde.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { orgProcedure } from "../../trpc";
import { groupSuggestions } from "@/lib/suggestion-grouping";
import { matterRoleSchema, contactTypeSchema } from "@/lib/labels";
import {
  findExistingContactForSuggestion,
  type ContactCandidate,
} from "@/lib/contact-dedup";

export const suggestionProcedures = {
  /** Platt lista över pending-förslag för ett ärende. */
  pendingSuggestions: orgProcedure
    .input(z.object({ matterId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.prisma.documentAnalysisSuggestion.findMany({
        where: {
          status: "PENDING",
          document: {
            matterId: input.matterId,
            matter: { organizationId: ctx.orgId },
          },
        },
        include: { document: { select: { id: true, fileName: true, title: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ),

  /**
   * Grupperar pending-förslag per unik person/entitet så att samma individ
   * som förekommer i flera dokument/roller blir en rad i UI:t.
   */
  pendingSuggestionsGrouped: orgProcedure
    .input(z.object({ matterId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.documentAnalysisSuggestion.findMany({
        where: {
          status: "PENDING",
          document: {
            matterId: input.matterId,
            matter: { organizationId: ctx.orgId },
          },
        },
        include: { document: { select: { id: true, fileName: true, title: true } } },
        orderBy: { createdAt: "asc" }, // asc → första förekomst vinner i first-non-empty
      });
      return groupSuggestions(rows);
    }),

  /**
   * Acceptera ett enskilt förslag. Länkar befintlig kontakt, eller skapar
   * en ny, och kopplar till ärendet med föreslagen roll. Användaren kan
   * mata in overrides (t.ex. ändra namn innan accept).
   */
  acceptSuggestion: orgProcedure
    .input(
      z.object({
        suggestionId: z.string(),
        /** Om satt — länka till denna kontakt istället för att skapa ny. */
        existingContactId: z.string().optional(),
        /** User-overrides innan accept. */
        override: z
          .object({
            name: z.string().min(1).optional(),
            role: matterRoleSchema.optional(),
            contactType: contactTypeSchema.optional(),
            email: z.string().nullable().optional(),
            phone: z.string().nullable().optional(),
            orgNumber: z.string().nullable().optional(),
            personalNumber: z.string().nullable().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sugg = await ctx.prisma.documentAnalysisSuggestion.findFirst({
        where: {
          id: input.suggestionId,
          document: { matter: { organizationId: ctx.orgId } },
        },
        include: { document: { select: { matterId: true } } },
      });
      if (!sugg) throw new TRPCError({ code: "NOT_FOUND" });
      if (sugg.status !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Suggestion already handled" });
      }

      const o = input.override ?? {};
      const finalRole = o.role ?? sugg.role;
      const matterId = sugg.document.matterId;

      let contactId: string;
      if (input.existingContactId) {
        const existing = await ctx.prisma.contact.findFirst({
          where: { id: input.existingContactId, organizationId: ctx.orgId },
        });
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        contactId = existing.id;
      } else {
        // Auto-dedup: pnr → orgNumber → namn-i-ärende → skapa ny.
        const pn = o.personalNumber ?? sugg.personalNumber;
        const on = o.orgNumber ?? sugg.orgNumber;
        let existing: ContactCandidate | null = null;
        if (pn) {
          existing = await ctx.prisma.contact.findFirst({
            where: { personalNumber: pn, organizationId: ctx.orgId },
          });
        } else if (on) {
          existing = await ctx.prisma.contact.findFirst({
            where: { orgNumber: on, organizationId: ctx.orgId },
          });
        }
        if (!existing) {
          const matterLinks = await ctx.prisma.matterContact.findMany({
            where: { matterId },
            include: { contact: true },
          });
          const dedup = findExistingContactForSuggestion(
            {
              name: o.name ?? sugg.name,
              contactType: o.contactType ?? sugg.contactType,
              personalNumber: null,
              orgNumber: null,
            },
            [],
            matterLinks.map((l) => l.contact),
          );
          if (dedup.kind === "match") existing = dedup.contact;
        }
        if (existing) {
          contactId = existing.id;
        } else {
          const created = await ctx.prisma.contact.create({
            data: {
              name: o.name ?? sugg.name,
              contactType: o.contactType ?? sugg.contactType,
              email: (o.email ?? sugg.email) || null,
              phone: (o.phone ?? sugg.phone) || null,
              personalNumber: pn || null,
              orgNumber: on || null,
              organizationId: ctx.orgId,
            },
          });
          contactId = created.id;
        }
      }

      // Länka till ärendet om inte redan länkad med samma roll.
      const existingLink = await ctx.prisma.matterContact.findFirst({
        where: { matterId, contactId, role: finalRole },
      });
      if (!existingLink) {
        await ctx.prisma.matterContact.create({
          data: { matterId, contactId, role: finalRole, notes: sugg.notes },
        });
      }

      await ctx.prisma.documentAnalysisSuggestion.update({
        where: { id: sugg.id },
        data: { status: "ACCEPTED", acceptedContactId: contactId },
      });

      return { contactId };
    }),

  rejectSuggestion: orgProcedure
    .input(z.object({ suggestionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sugg = await ctx.prisma.documentAnalysisSuggestion.findFirst({
        where: {
          id: input.suggestionId,
          document: { matter: { organizationId: ctx.orgId } },
        },
      });
      if (!sugg) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.prisma.documentAnalysisSuggestion.update({
        where: { id: sugg.id },
        data: { status: "REJECTED" },
      });
    }),

  /**
   * Acceptera en HEL grupp av förslag som tillhör samma person/entitet.
   * Skapar (eller hittar) en kontakt, länkar med ALLA distinkta roller,
   * markerar förslagen som ACCEPTED.
   */
  acceptSuggestionGroup: orgProcedure
    .input(
      z.object({
        suggestionIds: z.array(z.string()).min(1),
        /** Om satt — återanvänd befintlig kontakt istället för att skapa ny. */
        existingContactId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Ett query validerar både existens, org-tillhörighet och samma ärende.
      const suggs = await ctx.prisma.documentAnalysisSuggestion.findMany({
        where: {
          id: { in: input.suggestionIds },
          status: "PENDING",
          document: { matter: { organizationId: ctx.orgId } },
        },
        include: { document: { select: { matterId: true } } },
      });

      if (suggs.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
      if (suggs.length !== input.suggestionIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Några förslag saknas, tillhör annan org, eller är redan hanterade.",
        });
      }
      const matterIds = new Set(suggs.map((s) => s.document.matterId));
      if (matterIds.size > 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Förslag från olika ärenden kan inte grupperas.",
        });
      }
      const matterId = suggs[0].document.matterId;

      // Första icke-tomma fält ur gruppen (sorterad asc på createdAt).
      const pickFirst = <K extends "personalNumber" | "orgNumber" | "email" | "phone">(
        key: K,
      ): string | null => (suggs.find((s) => s[key])?.[key] ?? null) as string | null;

      const personalNumber = pickFirst("personalNumber");
      const orgNumber = pickFirst("orgNumber");

      let contactId: string;
      if (input.existingContactId) {
        const existing = await ctx.prisma.contact.findFirst({
          where: { id: input.existingContactId, organizationId: ctx.orgId },
        });
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        contactId = existing.id;
      } else {
        let existing: ContactCandidate | null = null;
        if (personalNumber) {
          existing = await ctx.prisma.contact.findFirst({
            where: { personalNumber, organizationId: ctx.orgId },
          });
        } else if (orgNumber) {
          existing = await ctx.prisma.contact.findFirst({
            where: { orgNumber, organizationId: ctx.orgId },
          });
        }
        // Namn-fallback scopad till ärendet (se contact-dedup.ts).
        if (!existing) {
          const matterLinks = await ctx.prisma.matterContact.findMany({
            where: { matterId },
            include: { contact: true },
          });
          const dedup = findExistingContactForSuggestion(
            {
              name: suggs[0].name,
              contactType: suggs[0].contactType,
              personalNumber: null,
              orgNumber: null,
            },
            [],
            matterLinks.map((l) => l.contact),
          );
          if (dedup.kind === "match") existing = dedup.contact;
        }
        if (existing) {
          contactId = existing.id;
        } else {
          const created = await ctx.prisma.contact.create({
            data: {
              name: suggs[0].name,
              contactType: suggs[0].contactType,
              email: pickFirst("email"),
              phone: pickFirst("phone"),
              personalNumber: personalNumber,
              orgNumber: orgNumber,
              organizationId: ctx.orgId,
            },
          });
          contactId = created.id;
        }
      }

      // Länka alla distinkta roller till ärendet.
      const distinctRoles = Array.from(new Set(suggs.map((s) => s.role)));
      for (const role of distinctRoles) {
        const existingLink = await ctx.prisma.matterContact.findFirst({
          where: { matterId, contactId, role },
        });
        if (!existingLink) {
          const notesForRole = Array.from(
            new Set(suggs.filter((s) => s.role === role && s.notes).map((s) => s.notes as string)),
          ).join("\n");
          await ctx.prisma.matterContact.create({
            data: { matterId, contactId, role, notes: notesForRole || null },
          });
        }
      }

      await ctx.prisma.documentAnalysisSuggestion.updateMany({
        where: { id: { in: suggs.map((s) => s.id) } },
        data: { status: "ACCEPTED", acceptedContactId: contactId },
      });

      return { contactId, acceptedRoles: distinctRoles };
    }),

  /** Avvisa en hel grupp av förslag. */
  rejectSuggestionGroup: orgProcedure
    .input(z.object({ suggestionIds: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const suggs = await ctx.prisma.documentAnalysisSuggestion.findMany({
        where: {
          id: { in: input.suggestionIds },
          document: { matter: { organizationId: ctx.orgId } },
        },
        select: { id: true },
      });
      if (suggs.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
      if (suggs.length !== input.suggestionIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Några förslag saknas eller tillhör annan org.",
        });
      }
      await ctx.prisma.documentAnalysisSuggestion.updateMany({
        where: { id: { in: suggs.map((s) => s.id) } },
        data: { status: "REJECTED" },
      });
      return { rejected: suggs.length };
    }),
};
