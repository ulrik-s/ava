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
