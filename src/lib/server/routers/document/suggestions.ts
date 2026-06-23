/**
 * Hantering av AI-genererade kontaktförslag (DocumentAnalysisSuggestion):
 * listning, gruppning, accept/reject — både enskilt och i grupp.
 *
 * Dedup-beslutet (matcha befintlig kontakt på pnr / orgNr / namn-i-ärende)
 * sker i den rena funktionen `findExistingContactForSuggestion` i
 * `@/lib/shared/contact-dedup`. Routern sköter IO och transaktionsflöde.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  findExistingContactForSuggestion,
  type ContactCandidate,
} from "@/lib/shared/contact-dedup";
import type { DocumentAnalysisSuggestion } from "@/lib/shared/schemas/document";
import { matterRoleSchema, contactTypeSchema, type SuggestionStatus } from "@/lib/shared/schemas/enums";
import { asId, type ContactId, type OrganizationId } from "@/lib/shared/schemas/ids";
import type { MatterContact } from "@/lib/shared/schemas/matter";
import { groupSuggestions } from "@/lib/shared/suggestion-grouping";
import type { Repositories } from "../../repositories/repositories";
import { orgProcedure } from "../../trpc";

// ─── Helpers för acceptSuggestion ─────────────────────────────────────────

// Migrerad till repository-sömmen (ADR 0020): all IO går via ctx.repos.
type Ctx = { repos: Repositories; orgId: OrganizationId };
type SuggOverride = {
  name?: string | undefined;
  role?: string | undefined;
  contactType?: string | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  orgNumber?: string | null | undefined;
  personalNumber?: string | null | undefined;
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
  const sugg = (await ctx.repos.documentAnalysisSuggestions.getByIdInOrg(suggestionId, ctx.orgId)) as Suggestion | null;
  if (!sugg) throw new TRPCError({ code: "NOT_FOUND" });
  if (sugg.status !== "PENDING") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Suggestion already handled" });
  }
  return sugg;
}

async function resolveExistingContact(ctx: Ctx, contactId: string): Promise<ContactId> {
  const existing = (await ctx.repos.contacts.getByIdFull(asId<"ContactId">(contactId), ctx.orgId)) as { id: ContactId } | null;
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
    return (await ctx.repos.contacts.findByPersonalNumber(ctx.orgId, pn)) as ContactCandidate | null;
  }
  if (on) {
    return (await ctx.repos.contacts.findByOrgNumber(ctx.orgId, on)) as ContactCandidate | null;
  }
  const matterContacts = (await ctx.repos.matterContacts.listContactsForMatter(asId<"MatterId">(matterId))) as ContactCandidate[];
  const dedup = findExistingContactForSuggestion(
    {
      name: o.name ?? sugg.name,
      contactType: o.contactType ?? sugg.contactType,
      personalNumber: null,
      orgNumber: null,
    },
    [],
    matterContacts,
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
): Promise<ContactId> {
  const existing = await findContactByNumberOrName(ctx, sugg, o, matterId);
  if (existing) return asId<"ContactId">(existing.id);
  const created = (await ctx.repos.contacts.create(
    { ...applyOverride(sugg, o), organizationId: ctx.orgId } as never,
  )) as { id: ContactId };
  return created.id;
}

async function ensureMatterContactLink(
  ctx: Ctx,
  matterId: string,
  contactId: string,
  role: string,
  notes: string | null,
): Promise<void> {
  const existing = await ctx.repos.matterContacts.findLink(asId<"MatterId">(matterId), asId<"ContactId">(contactId), role);
  if (!existing) {
    await ctx.repos.matterContacts.create({ matterId, contactId, role, notes } as Partial<MatterContact>);
  }
}

// ─── Helpers för acceptSuggestionGroup ──────────────────────────────────

/** Hämta + validera en grupp av förslag (existerar, pending, samma ärende). */
async function loadPendingGroup(ctx: Ctx, suggestionIds: string[]): Promise<Suggestion[]> {
  const suggs = (await ctx.repos.documentAnalysisSuggestions.listPendingByIds(suggestionIds, ctx.orgId)) as Suggestion[];

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
): Promise<ContactId> {
  const first = suggs[0];
  if (!first) throw new TRPCError({ code: "NOT_FOUND" });
  const personalNumber = pickFirstFromGroup(suggs, "personalNumber");
  const orgNumber = pickFirstFromGroup(suggs, "orgNumber");
  const existing = await findGroupContact(ctx, suggs, matterId, personalNumber, orgNumber);
  if (existing) return asId<"ContactId">(existing.id);
  const created = (await ctx.repos.contacts.create({
    name: first.name,
    contactType: first.contactType,
    email: pickFirstFromGroup(suggs, "email"),
    phone: pickFirstFromGroup(suggs, "phone"),
    personalNumber,
    orgNumber,
    organizationId: ctx.orgId,
  } as never)) as { id: ContactId };
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
    return (await ctx.repos.contacts.findByPersonalNumber(ctx.orgId, personalNumber)) as ContactCandidate | null;
  }
  if (orgNumber) {
    return (await ctx.repos.contacts.findByOrgNumber(ctx.orgId, orgNumber)) as ContactCandidate | null;
  }
  // Namn-fallback scopad till ärendet (se contact-dedup.ts).
  const matterContacts = (await ctx.repos.matterContacts.listContactsForMatter(asId<"MatterId">(matterId))) as ContactCandidate[];
  const first = suggs[0];
  if (!first) return null;
  const dedup = findExistingContactForSuggestion(
    {
      name: first.name,
      contactType: first.contactType,
      personalNumber: null,
      orgNumber: null,
    },
    [],
    matterContacts,
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
      ctx.repos.documentAnalysisSuggestions.listPendingForMatter(input.matterId, ctx.orgId, "desc"),
    ),

  /**
   * Grupperar pending-förslag per unik person/entitet så att samma individ
   * som förekommer i flera dokument/roller blir en rad i UI:t.
   */
  pendingSuggestionsGrouped: orgProcedure
    .input(z.object({ matterId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.repos.documentAnalysisSuggestions.listPendingForMatter(input.matterId, ctx.orgId, "asc");
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
      await ctx.repos.documentAnalysisSuggestions.update(
        asId<"DocumentAnalysisSuggestionId">(sugg.id), { status: "ACCEPTED", acceptedContactId: contactId } as Partial<DocumentAnalysisSuggestion>,
      );
      return { contactId };
    }),

  rejectSuggestion: orgProcedure
    .input(z.object({ suggestionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sugg = await ctx.repos.documentAnalysisSuggestions.getByIdInOrg(input.suggestionId, ctx.orgId);
      if (!sugg) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.repos.documentAnalysisSuggestions.update(
        sugg.id, { status: "REJECTED" } as Partial<DocumentAnalysisSuggestion>,
      );
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
      const first = suggs[0];
      if (!first) throw new TRPCError({ code: "NOT_FOUND" });
      const matterId = first.document.matterId;

      const contactId = input.existingContactId
        ? await resolveExistingContact(ctx, input.existingContactId)
        : await resolveOrCreateGroupContact(ctx, suggs, matterId);

      const distinctRoles = await linkGroupRoles(ctx, suggs, matterId, contactId);
      await ctx.repos.documentAnalysisSuggestions.updateManyByIds(
        suggs.map((s) => s.id),
        { status: "ACCEPTED", acceptedContactId: contactId } as Partial<DocumentAnalysisSuggestion>,
      );
      return { contactId, acceptedRoles: distinctRoles };
    }),

  /** Avvisa en hel grupp av förslag. */
  rejectSuggestionGroup: orgProcedure
    .input(z.object({ suggestionIds: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const suggs = await ctx.repos.documentAnalysisSuggestions.listByIdsInOrg(input.suggestionIds, ctx.orgId);
      if (suggs.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
      if (suggs.length !== input.suggestionIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Några förslag saknas eller tillhör annan org.",
        });
      }
      await ctx.repos.documentAnalysisSuggestions.updateManyByIds(
        suggs.map((s) => s.id), { status: "REJECTED" } as Partial<DocumentAnalysisSuggestion>,
      );
      return { rejected: suggs.length };
    }),
};
