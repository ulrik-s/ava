/**
 * Ärendets jävskontroll körs om (#1246, #1354, #1383) — på begäran, eller när
 * en part på klient- eller motsidan lagts till. Delas av ärendets procedurer
 * (`matter.checkConflicts`, `addContact`, `addNewContact`) och av
 * dokumentförslagen (`document.acceptSuggestion[Group]`): varje väg som kopplar
 * en part till ärendet ska ge samma kontroll, annars upptäcks en motpart som
 * är klient i ett annat ärende bara på vissa vägar.
 *
 * Kontrollen kräver byråns alla ärenden, så den avgörs av servern: anropen som
 * kopplar parter köas som anrop (`QUEUED_PROCEDURES`) och körs om där.
 */

import { isCheckedRole } from "@/lib/shared/conflict-roles";
import type { MatterRole } from "@/lib/shared/schemas/enums";
import { asId, type MatterId, type OrganizationId } from "@/lib/shared/schemas/ids";
import type { Matter } from "@/lib/shared/schemas/matter";
import type { Repositories } from "../repositories/repositories";
import { TRPCError } from "../trpc-core";
import { checkMatterConflicts } from "./matter-conflict-check";

/** Det omkontrollen behöver ur en tRPC-context. */
export type ConflictRecheckCtx = Parameters<typeof checkMatterConflicts>[0] & { repos: Repositories; orgId: OrganizationId };

/** Kör kontrollen för ärendets alla parter igen och spara resultatet på ärendet. */
export async function recheckMatterConflicts(ctx: ConflictRecheckCtx, matterId: MatterId): Promise<Matter> {
  const matter = await ctx.repos.matters.getByIdWithContacts(matterId, ctx.orgId);
  if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte." });
  const parties = matter.contacts.map((c) => ({ contactId: asId<"ContactId">(c.contactId), role: c.role }));
  return ctx.repos.matters.update(matterId, await checkMatterConflicts(ctx, matterId, parties));
}

/** Någon av de nya rollerna på klient- eller motsidan → kontrollera ärendet igen. */
export async function recheckIfParty(ctx: ConflictRecheckCtx, matterId: MatterId, roles: readonly MatterRole[]): Promise<void> {
  if (roles.some(isCheckedRole)) await recheckMatterConflicts(ctx, matterId);
}
