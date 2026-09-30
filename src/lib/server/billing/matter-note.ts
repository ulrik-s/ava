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

/** Antal anteckningar ett köat anrop skrivit hittills (nyckel: anropets identitet). */
const notesWritten = new WeakMap<object, number>();

/** Rollen för anropets nästa anteckning: den första `serviceNote`, sedan `serviceNote:2` … */
function noteRole(ctx: QueuedCallScope): string {
  if (!ctx.queued) return "serviceNote";
  const n = (notesWritten.get(ctx.queued) ?? 0) + 1;
  notesWritten.set(ctx.queued, n);
  return n === 1 ? "serviceNote" : `serviceNote:${n}`;
}

/**
 * `at` = händelsens tidpunkt. Utelämnad → när anropet gjordes (nu, utanför
 * procedur-kön). Setup-anrop (demo-generatorn, ADR 0003) som backdaterar en
 * faktura skickar fakturadatumet, så historiken hamnar på rätt dag i stället
 * för på genereringsdagen.
 *
 * I ett köat anrop (#1276) får anteckningen ett id härlett ur anropet, så att
 * serverns omkörning skriver SAMMA anteckning. Skriver anropet flera
 * anteckningar (ärendets betalningssätt och ett nekat rättsskydd, #1242) får de
 * var sitt id i den ordning de skrivs — samma ordning i båda körningarna.
 */
export async function logMatterNote(
  repos: Pick<Repositories, "serviceNotes">, ctx: NoteCtx, matterId: MatterId, text: string,
  at: Date = callTime(ctx),
): Promise<void> {
  const { date, time } = noteTimestamp(at);
  await repos.serviceNotes.create({
    id: asId<"ServiceNoteId">(newRowId(ctx, noteRole(ctx))),
    organizationId: asId<"OrganizationId">(ctx.orgId),
    matterId, authorId: asId<"UserId">(ctx.user.id), date, time, text,
  } satisfies Partial<ServiceNote>);
}
