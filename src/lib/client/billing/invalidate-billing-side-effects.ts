/**
 * En faktureringshändelse skriver en tjänsteanteckning och kan lösa (eller
 * skapa) en bevakning (#1221). Efter en sådan mutation ska både ärendets
 * Anteckningar och "Att bevaka" hämtas om — annars syns inte loggen förrän
 * sidan laddas om.
 */

import type { MatterId } from "@/lib/shared/schemas/ids";

type Invalidate = () => Promise<void>;

/** Den del av `trpc.useUtils()` som behövs — smal söm, testbar utan hela klienten. */
export interface BillingSideEffectUtils {
  serviceNote: { list: { invalidate: Invalidate } };
  watchlist: { list: { invalidate: Invalidate } };
}

export function invalidateBillingSideEffects(utils: BillingSideEffectUtils): void {
  void utils.serviceNote.list.invalidate();
  void utils.watchlist.list.invalidate();
}

/** Dokumentdelen av `trpc.useUtils()` — listan (fakturapanelen) + trädet (dokumentvyn). */
export interface DocumentListUtils {
  document: { list: { invalidate: Invalidate }; tree: { invalidate: Invalidate } };
}

/**
 * En faktureringshändelse som tar bort ett dokument (ångrad kostnadsräkning,
 * #1230) — hämta om ärendets dokumentlistor så att det inte ligger kvar i vyn.
 */
export function invalidateDocumentLists(utils: DocumentListUtils): void {
  void utils.document.list.invalidate();
  void utils.document.tree.invalidate();
}

/** Fakturaförslagsdelen av `trpc.useUtils()` — utan indata gäller den alla ärenden. */
export interface UnbilledWorkUtils {
  billingRun: { proposal: { invalidate(input?: { matterId: MatterId }): Promise<void> } };
}

/**
 * Tid eller utlägg har ändrats (#2201): hämta om fakturaförslaget, så att
 * Upparbetat ofakturerat och Aconto till klient räknar med den nya posten.
 * Utan ärenden hämtas alla ärendens förslag om (/time listar alla ärenden).
 */
export function invalidateUnbilledWork(utils: UnbilledWorkUtils, matterIds?: readonly MatterId[]): void {
  if (!matterIds) {
    void utils.billingRun.proposal.invalidate();
    return;
  }
  for (const matterId of matterIds) void utils.billingRun.proposal.invalidate({ matterId });
}
