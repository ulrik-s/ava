/**
 * Den dokumenterade bedömningen av jävskontrollens träffar (#1354).
 *
 * Advokaten (eller byråns admin) tar ställning till träffarna innan uppdraget
 * tas, och bedömningen ska gå att visa i efterhand: vem, när och varför.
 * Motiveringen krävs. Granskare och tidpunkt tas ur anropet — inloggningen och
 * när anropet gjordes — så att serverns omkörning av ett köat anrop sparar
 * samma bedömning som klientens körning. Bedömningen skrivs också som
 * tjänsteanteckning, så att en tidigare bedömning finns kvar i ärendets
 * historik när kontrollen senare ger nya träffar som bedöms igen.
 *
 * Bedömningen sparar också vilka träffar den gällde (#1819), så att en
 * omkontroll utan nya träffar behåller den. Klienten skickar träffarna den
 * visade (`hits`). Har kontrollen sedan dess gett en träff som inte fanns med
 * avvisas bedömningen, också när servern kör om ett köat anrop. Ett anrop utan
 * `hits` (köat av äldre kod) sparar ärendets aktuella träffar.
 */

import { z } from "zod";
import { mayReviewConflicts } from "@/lib/shared/conflict-roles";
import type { UserRole } from "@/lib/shared/schemas/enums";
import { asId, matterIdSchema, type OrganizationId } from "@/lib/shared/schemas/ids";
import type { Matter } from "@/lib/shared/schemas/matter";
import { conflictHitSchema } from "@/lib/shared/schemas/misc";
import { requireMatterInOrg } from "../auth/org-scope";
import { logMatterNote } from "../billing/matter-note";
import { callTime, type QueuedCallScope } from "../queued-call";
import type { Repositories } from "../repositories/repositories";
import { TRPCError } from "../trpc-core";
import { allReviewed, type ConflictHitIdentity } from "./conflict-search";

/** Motiveringens längsta längd — en bedömning, inte ett PM. */
const MAX_NOTE = 2000;

/** Flest träffar en bedömning kan gälla. */
const MAX_HITS = 5000;

/** Input till `matter.markConflictsReviewed`: ärendet, motiveringen och de bedömda träffarna. */
export const conflictReviewInput = z.object({
  id: matterIdSchema,
  note: z.string().trim().min(1, "Motivera bedömningen.").max(MAX_NOTE),
  /** Träffarna advokaten såg (#1819). Saknas i anrop köade av äldre kod. */
  hits: z.array(conflictHitSchema.pick({ contactId: true, matterId: true, role: true })).max(MAX_HITS).optional(),
});
export type ConflictReviewInput = z.infer<typeof conflictReviewInput>;

/** Det bedömningen behöver ur en tRPC-context. */
export interface ReviewCtx extends QueuedCallScope {
  repos: Repositories;
  orgId: OrganizationId;
  user: { id: string; role: UserRole };
}

/** Tjänsteanteckningens text. */
export function conflictReviewNoteText(note: string): string {
  return `Jävskontrollens träffar bedömda: ${note}`;
}

/** Kastar om kontrollen har gett en träff som inte fanns bland de bedömda (`hits`). */
function assertNoNewHits(matter: Matter, hits: readonly ConflictHitIdentity[] | undefined): void {
  const current = matter.conflictCheckResults;
  if (!hits || !current || allReviewed(current, hits)) return;
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Kontrollen har gett nya träffar sedan du öppnade den. Bedöm igen." });
}

/**
 * Spara bedömningen på ärendet, med träffarna den gällde. Kastar om rollen inte
 * får, om inget finns att bedöma, eller om nya träffar har tillkommit.
 */
export async function reviewMatterConflicts(ctx: ReviewCtx, input: ConflictReviewInput): Promise<Matter> {
  if (!mayReviewConflicts(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Bara en advokat eller admin kan bedöma jävskontrollens träffar." });
  }
  const matter = await requireMatterInOrg(ctx, input.id);
  if (matter.conflictCheckStatus !== "HITS") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Det finns inga träffar att bedöma." });
  }
  assertNoNewHits(matter, input.hits);
  return ctx.repos.transaction(async (repos) => {
    await logMatterNote(repos, ctx, input.id, conflictReviewNoteText(input.note));
    return repos.matters.update(input.id, {
      conflictCheckStatus: "REVIEWED",
      conflictReviewedById: asId<"UserId">(ctx.user.id),
      conflictReviewedAt: callTime(ctx),
      conflictReviewNote: input.note,
      conflictReviewedHits: matter.conflictCheckResults ?? null,
    } satisfies Partial<Matter>);
  });
}
