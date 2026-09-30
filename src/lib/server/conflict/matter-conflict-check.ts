/**
 * Ärendets jävskontroll (#1246).
 *
 * Advokatetiken kräver kontrollen innan uppdraget tas. Klienten söks på namn
 * och person-/organisationsnummer mot byråns alla andra ärenden, och ärendet
 * bär resultatet: inga träffar, träffar att bedöma, eller väntar.
 *
 * Offline har klienten bara sin lokala kopia, som inte behöver innehålla hela
 * byrån. Klientens optimistiska körning (`ctx.provisional`) avgör därför
 * ingenting och lämnar kontrollen som väntande. Servern kör om anropet mot
 * byråns alla data när det når den, och dess resultat ersätter det väntande
 * vid nästa synk. Utan klient finns inget att kontrollera än; ärendet väntar
 * tills kontrollen körs om.
 */

import type { ConflictCheckStatus } from "@/lib/shared/schemas/enums";
import { asId, type ContactId, type MatterId } from "@/lib/shared/schemas/ids";
import { callTime, newRowId, type QueuedCallScope } from "../queued-call";
import { type ConflictCtx, type ConflictResult, searchConflicts } from "./conflict-search";

/** Fälten ärendet får av kontrollen. */
export type MatterConflictPatch = {
  conflictCheckStatus: ConflictCheckStatus;
  conflictCheckHits: number | null;
  conflictCheckedAt: Date | null;
};

type CheckCtx = ConflictCtx & QueuedCallScope & { provisional?: true | undefined };

const PENDING: MatterConflictPatch = { conflictCheckStatus: "PENDING", conflictCheckHits: null, conflictCheckedAt: null };

/** Söktermen: klientens namn och nummer — sökningen matchar på vilket som helst. */
function termFor(klient: { name: string; personalNumber?: string | null | undefined; orgNumber?: string | null | undefined }): string {
  return [klient.name, klient.personalNumber ?? klient.orgNumber].filter(Boolean).join(" ");
}

/** Kör kontrollen för ärendets klient och logga den. Returnerar ärendets nya fält. */
export async function checkMatterConflicts(ctx: CheckCtx, matterId: MatterId, klientId: ContactId | null): Promise<MatterConflictPatch> {
  if (ctx.provisional || !klientId) return PENDING;
  const orgId = asId<"OrganizationId">(ctx.user.organizationId);
  const klient = await ctx.repos.contacts.getByIdFull(klientId, orgId);
  if (!klient) return PENDING;
  const term = termFor(klient);
  // Ärendets egen klientkoppling är ingen träff.
  const results: ConflictResult[] = (await searchConflicts(ctx, term, "both")).filter((r) => r.matterId !== matterId);
  await ctx.repos.conflictChecks.create({
    id: asId<"ConflictCheckId">(newRowId(ctx, "conflictCheck")),
    searchTerm: term, searchType: "both", results, checkedById: asId<"UserId">(ctx.user.id),
  });
  return {
    conflictCheckStatus: results.length > 0 ? "HITS" : "CLEAR",
    conflictCheckHits: results.length,
    conflictCheckedAt: callTime(ctx),
  };
}
