/**
 * Hantering av AI-genererade kontaktförslag (DocumentAnalysisSuggestion):
 * listning, gruppning, accept/reject — både enskilt och i grupp.
 *
 * Dedup-beslutet (matcha befintlig kontakt på pnr / orgNr / namn-i-ärende)
 * sker i den rena funktionen `findExistingContactForSuggestion` i
 * `@/lib/shared/contact-dedup`. Routern sköter IO och transaktionsflöde.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { orgProcedure } from "../../trpc";
import { groupSuggestions } from "@/lib/shared/suggestion-grouping";
import { matterRoleSchema, contactTypeSchema, type SuggestionStatus } from "@/lib/shared/schemas/enums";
import {
  findExistingContactForSuggestion,
  type ContactCandidate,
} from "@/lib/shared/contact-dedup";

// ─── Helpers för acceptSuggestion ─────────────────────────────────────────

type Ctx = {
  dataStore: {
    documentAnalysisSuggestions: {
      findFirst: (...a: never[]) => Promise<unknown>;
      findMany: (...a: never[]) => Promise<unknown>;
      update: (...a: never[]) => Promise<unknown>;
      updateMany: (...a: never[]) => Promise<unknown>;
    };
    contacts: {
      findFirst: (...a: never[]) => Promise<unknown>;
      create: (...a: never[]) => Promise<unknown>;
    };
    matterContacts: {
      findFirst: (...a: never[]) => Promise<unknown>;
      findMany: (...a: never[]) => Promise<unknown>;
      create: (...a: never[]) => Promise<unknown>;
    };
  };
  orgId: string;
};
type SuggOverride = {
  name?: string;
  role?: string;
  contactType?: string;
  email?: string | null;
  phone?: string | null;
  orgNumber?: string | null;
  personalNumber?: string | null;
};
type Suggestion = {
  id: string;
  status: SuggestionStatus;
  role: string;
  name: string;
  contactType: string;
  email: string | null;
  phone: string | null;
  personalNumber: string | null;
  orgNumber: string | null;
  notes: string | null;
  document: { matterId: string };
};

async function loadPendingSuggestion(ctx: Ctx, suggestionId: string): Promise<Suggestion> {
  const sugg = (await ctx.dataStore.documentAnalysisSuggestions.findFirst({
    where: {
      id: suggestionId,
      document: { matter: { organizationId: ctx.orgId } },
    },
    include: { document: { select: { matterId: true } } },
  } as never)) as Suggestion | null;
  if (!sugg) throw new TRPCError({ code: "NOT_FOUND" });
  if (sugg.status !== "PENDING") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Suggestion already handled" });
  }
  return sugg;
}

async function resolveExistingContact(ctx: Ctx, contactId: string): Promise<string> {
  const existing = (await ctx.dataStore.contacts.findFirst({
    where: { id: contactId, organizationId: ctx.orgId },
  } as never)) as { id: string } | null;
  if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
  return existing.id;
}

/** Auto-dedup: pnr → orgNumber → namn-i-ärende. */
async function findContactByNumberOrName(
  ctx: Ctx,
  sugg: Suggestion,
  o: SuggOverride,
  matterId: string,
): Promise<ContactCandidate | null> {
  const pn = o.personalNumber ?? sugg.personalNumber;
  const on = o.orgNumber ?? sugg.orgNumber;
  if (pn) {
    return (await ctx.dataStore.contacts.findFirst({
      where: { personalNumber: pn, organizationId: ctx.orgId },
    } as never)) as ContactCandidate | null;
  }
  if (on) {
    return (await ctx.dataStore.contacts.findFirst({
      where: { orgNumber: on, organizationId: ctx.orgId },
    } as never)) as ContactCandidate | null;
  }
  const matterLinks = (await ctx.dataStore.matterContacts.findMany({
    where: { matterId },
    include: { contact: true },
  } as never)) as Array<{ contact: ContactCandidate }>;
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
  return dedup.kind === "match" ? dedup.contact : null;
}

function pick<K extends keyof SuggOverride & keyof Suggestion>(
  o: SuggOverride,
  sugg: Suggestion,
  key: K,
): SuggOverride[K] {
  return (o[key] ?? sugg[key]) as SuggOverride[K];
}

/** Merga override över suggestion (override-värdet vinner). Tomma strängar → null. */
function applyOverride(sugg: Suggestion, o: SuggOverride) {
  return {
    name: pick(o, sugg, "name"),
    contactType: pick(o, sugg, "contactType"),
    email: pick(o, sugg, "email") || null,
    phone: pick(o, sugg, "phone") || null,
    personalNumber: pick(o, sugg, "personalNumber") || null,
    orgNumber: pick(o, sugg, "orgNumber") || null,
  };
}

async function resolveOrCreateContact(
  ctx: Ctx,
  sugg: Suggestion,
  o: SuggOverride,
  matterId: string,
): Promise<string> {
  const existing = await findContactByNumberOrName(ctx, sugg, o, matterId);
  if (existing) return existing.id;
  const created = (await ctx.dataStore.contacts.create({
    data: { ...applyOverride(sugg, o), organizationId: ctx.orgId },
  } as never)) as { id: string };
  return created.id;
}

async function ensureMatterContactLink(
  ctx: Ctx,
  matterId: string,
  contactId: string,
  role: string,
  notes: string | null,
): Promise<void> {
  const existing = await ctx.dataStore.matterContacts.findFirst({
    where: { matterId, contactId, role },
  } as never);
  if (!existing) {
    await ctx.dataStore.matterContacts.create({
      data: { matterId, contactId, role, notes },
    } as never);
  }
}

// ─── Helpers för acceptSuggestionGroup ──────────────────────────────────

/** Hämta + validera en grupp av förslag (existerar, pending, samma ärende). */
async function loadPendingGroup(ctx: Ctx, suggestionIds: string[]): Promise<Suggestion[]> {
  const suggs = (await ctx.dataStore.documentAnalysisSuggestions.findMany({
    where: {
      id: { in: suggestionIds },
      status: "PENDING",
      document: { matter: { organizationId: ctx.orgId } },
    },
    include: { document: { select: { matterId: true } } },
  } as never)) as Suggestion[];

  if (suggs.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
  if (suggs.length !== suggestionIds.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Några förslag saknas, tillhör annan org, eller är redan hanterade.",
    });
  }
  if (new Set(suggs.map((s) => s.document.matterId)).size > 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Förslag från olika ärenden kan inte grupperas.",
    });
  }
  return suggs;
}

/** Första icke-tomma fält ur gruppen (förslag sorterade asc på createdAt). */
function pickFirstFromGroup<K extends keyof Suggestion>(
  suggs: Suggestion[],
  key: K,
): Suggestion[K] | null {
  return (suggs.find((s) => s[key])?.[key] ?? null) as Suggestion[K] | null;
}

/** Sök/skapa kontakt från en grupp av förslag. */
async function resolveOrCreateGroupContact(
  ctx: Ctx,
  suggs: Suggestion[],
  matterId: string,
): Promise<string> {
  const personalNumber = pickFirstFromGroup(suggs, "personalNumber");
  const orgNumber = pickFirstFromGroup(suggs, "orgNumber");
  const existing = await findGroupContact(ctx, suggs, matterId, personalNumber, orgNumber);
  if (existing) return existing.id;
  const created = (await ctx.dataStore.contacts.create({
    data: {
      name: suggs[0].name,
      contactType: suggs[0].contactType,
      email: pickFirstFromGroup(suggs, "email"),
      phone: pickFirstFromGroup(suggs, "phone"),
      personalNumber,
      orgNumber,
      organizationId: ctx.orgId,
    },
  } as never)) as { id: string };
  return created.id;
}

async function findGroupContact(
  ctx: Ctx,
  suggs: Suggestion[],
  matterId: string,
  personalNumber: string | null,
  orgNumber: string | null,
): Promise<ContactCandidate | null> {
  if (personalNumber) {
    return (await ctx.dataStore.contacts.findFirst({
      where: { personalNumber, organizationId: ctx.orgId },
    } as never)) as ContactCandidate | null;
  }
  if (orgNumber) {
    return (await ctx.dataStore.contacts.findFirst({
      where: { orgNumber, organizationId: ctx.orgId },
    } as never)) as ContactCandidate | null;
  }
  // Namn-fallback scopad till ärendet (se contact-dedup.ts).
  const matterLinks = (await ctx.dataStore.matterContacts.findMany({
    where: { matterId },
    include: { contact: true },
  } as never)) as Array<{ contact: ContactCandidate }>;
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
  return dedup.kind === "match" ? dedup.contact : null;
}

/** Länka alla distinkta roller till ärendet med matter-contact rader. */
async function linkGroupRoles(
  ctx: Ctx,
  suggs: Suggestion[],
  matterId: string,
  contactId: string,
): Promise<string[]> {
  const distinctRoles = Array.from(new Set(suggs.map((s) => s.role)));
  for (const role of distinctRoles) {
    const notesForRole = Array.from(
      new Set(suggs.filter((s) => s.role === role && s.notes).map((s) => s.notes as string)),
    ).join("\n");
    await ensureMatterContactLink(ctx, matterId, contactId, role, notesForRole || null);
  }
  return distinctRoles;
}

export const suggestionProcedures = {
  /** Platt lista över pending-förslag för ett ärende. */
  pendingSuggestions: orgProcedure
    .input(z.object({ matterId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.dataStore.documentAnalysisSuggestions.findMany({
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
      const rows = await ctx.dataStore.documentAnalysisSuggestions.findMany({
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
      const sugg = await loadPendingSuggestion(ctx, input.suggestionId);
      const o = input.override ?? {};
      const matterId = sugg.document.matterId;
      const finalRole = o.role ?? sugg.role;

      const contactId = input.existingContactId
        ? await resolveExistingContact(ctx, input.existingContactId)
        : await resolveOrCreateContact(ctx, sugg, o, matterId);

      await ensureMatterContactLink(ctx, matterId, contactId, finalRole, sugg.notes);
      await ctx.dataStore.documentAnalysisSuggestions.update({
        where: { id: sugg.id },
        data: { status: "ACCEPTED", acceptedContactId: contactId },
      });
      return { contactId };
    }),

  rejectSuggestion: orgProcedure
    .input(z.object({ suggestionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sugg = await ctx.dataStore.documentAnalysisSuggestions.findFirst({
        where: {
          id: input.suggestionId,
          document: { matter: { organizationId: ctx.orgId } },
        },
      });
      if (!sugg) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.dataStore.documentAnalysisSuggestions.update({
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
      const suggs = await loadPendingGroup(ctx, input.suggestionIds);
      const matterId = suggs[0].document.matterId;

      const contactId = input.existingContactId
        ? await resolveExistingContact(ctx, input.existingContactId)
        : await resolveOrCreateGroupContact(ctx, suggs, matterId);

      const distinctRoles = await linkGroupRoles(ctx, suggs, matterId, contactId);
      await ctx.dataStore.documentAnalysisSuggestions.updateMany({
        where: { id: { in: suggs.map((s) => s.id) } },
        data: { status: "ACCEPTED", acceptedContactId: contactId },
      } as never);
      return { contactId, acceptedRoles: distinctRoles };
    }),

  /** Avvisa en hel grupp av förslag. */
  rejectSuggestionGroup: orgProcedure
    .input(z.object({ suggestionIds: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const suggs = await ctx.dataStore.documentAnalysisSuggestions.findMany({
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
      await ctx.dataStore.documentAnalysisSuggestions.updateMany({
        where: { id: { in: suggs.map((s) => s.id) } },
        data: { status: "REJECTED" },
      });
      return { rejected: suggs.length };
    }),
};
