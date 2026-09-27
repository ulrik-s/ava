/**
 * En faktureringshändelse skriver en tjänsteanteckning och kan lösa (eller
 * skapa) en bevakning (#1221). Efter en sådan mutation ska både ärendets
 * Anteckningar och "Att bevaka" hämtas om — annars syns inte loggen förrän
 * sidan laddas om.
 */

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
