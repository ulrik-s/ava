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
 */

import { z } from "zod";
import { mayReviewConflicts } from "@/lib/shared/conflict-roles";
import type { UserRole } from "@/lib/shared/schemas/enums";
import { asId, matterIdSchema, type OrganizationId } from "@/lib/shared/schemas/ids";
import type { Matter } from "@/lib/shared/schemas/matter";
import { requireMatterInOrg } from "../auth/org-scope";
import { logMatterNote } from "../billing/matter-note";
import { callTime, type QueuedCallScope } from "../queued-call";
import type { Repositories } from "../repositories/repositories";
import { TRPCError } from "../trpc-core";

/** Motiveringens längsta längd — en bedömning, inte ett PM. */
const MAX_NOTE = 2000;

/** Input till `matter.markConflictsReviewed`: ärendet och motiveringen. */
export const conflictReviewInput = z.object({
  id: matterIdSchema,
  note: z.string().trim().min(1, "Motivera bedömningen.").max(MAX_NOTE),
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

/** Spara bedömningen på ärendet. Kastar om rollen inte får, eller inget finns att bedöma. */
export async function reviewMatterConflicts(ctx: ReviewCtx, input: ConflictReviewInput): Promise<Matter> {
  if (!mayReviewConflicts(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Bara en advokat eller admin kan bedöma jävskontrollens träffar." });
  }
  const matter = await requireMatterInOrg(ctx, input.id);
  if (matter.conflictCheckStatus !== "HITS") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Det finns inga träffar att bedöma." });
  }
  return ctx.repos.transaction(async (repos) => {
    await logMatterNote(repos, ctx, input.id, conflictReviewNoteText(input.note));
    return repos.matters.update(input.id, {
      conflictCheckStatus: "REVIEWED",
      conflictReviewedById: asId<"UserId">(ctx.user.id),
      conflictReviewedAt: callTime(ctx),
      conflictReviewNote: input.note,
    } satisfies Partial<Matter>);
  });
}
