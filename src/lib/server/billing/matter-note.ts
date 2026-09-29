/**
 * Skriv en faktureringshändelse som tjänsteanteckning i ärendet (#1221).
 *
 * Anropas INNE i händelsens transaktion (samma `repos`), så anteckningen och
 * händelsen antingen båda finns eller ingen av dem. Författare = den som
 * utförde händelsen; datum/klockslag = när den skedde, i svensk tid.
 * Texterna byggs i `@/lib/shared/billing-notes`.
 */

import { noteTimestamp } from "@/lib/shared/billing-notes";
import { asId, type MatterId } from "@/lib/shared/schemas/ids";
import type { ServiceNote } from "@/lib/shared/schemas/service-note";
import { callTime, newRowId, type QueuedCallScope } from "../queued-call";
import type { Repositories } from "../repositories/repositories";

/** Det anteckningen behöver ur anropet: vem, i vilken byrå (och vilket köat anrop). */
export interface NoteCtx extends QueuedCallScope {
  orgId: string;
  user: { id: string };
}

/**
 * `at` = händelsens tidpunkt. Utelämnad → när anropet gjordes (nu, utanför
 * procedur-kön). Setup-anrop (demo-generatorn, ADR 0003) som backdaterar en
 * faktura skickar fakturadatumet, så historiken hamnar på rätt dag i stället
 * för på genereringsdagen.
 *
 * I ett köat anrop (#1276) får anteckningen ett id härlett ur anropet, så att
 * serverns omkörning skriver SAMMA anteckning (en anteckning per köat anrop).
 */
export async function logMatterNote(
  repos: Pick<Repositories, "serviceNotes">, ctx: NoteCtx, matterId: MatterId, text: string,
  at: Date = callTime(ctx),
): Promise<void> {
  const { date, time } = noteTimestamp(at);
  await repos.serviceNotes.create({
    id: asId<"ServiceNoteId">(newRowId(ctx, "serviceNote")),
    organizationId: asId<"OrganizationId">(ctx.orgId),
    matterId, authorId: asId<"UserId">(ctx.user.id), date, time, text,
  } satisfies Partial<ServiceNote>);
}

/** Setup-datumet (`invoiceDate` o.d.) som händelsetidpunkt, annars nu. */
export function eventTime(setupDate: string | undefined): Date {
  return setupDate ? new Date(setupDate) : new Date();
}
