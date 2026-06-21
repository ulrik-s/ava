"use client";

/**
 * `prefetchMatterDocuments` (ADR 0028 §4a) — "öppna ärende == ladda hem allt
 * som rör ärendet i cachen". Eager-cachar ärendets dokument-bytes så de blir
 * **offline-tillgängliga** efter att ärendet öppnats online.
 *
 * Best-effort + bounded-concurrency: en miss/fel på ett dokument stoppar inte
 * de andra, och vi laddar högst `concurrency` samtidigt (annars skulle ett
 * ärende med många/stora dokument fyra av en flod av nedladdningar vid varje
 * öppning). `loadBlob` är cache-först (IndexedDB) → redan cachade dokument är
 * gratis, så ett återbesök på ärendet laddar inte om något.
 */

export interface PrefetchableDoc {
  id: string;
  storagePath?: string | null;
  fileName?: string;
}

export async function prefetchMatterDocuments(
  docs: ReadonlyArray<PrefetchableDoc>,
  loadBlob: (doc: { id: string; storagePath: string | null; fileName: string }) => Promise<Blob | null>,
  concurrency = 3,
): Promise<number> {
  let next = 0;
  let cached = 0;
  async function worker(): Promise<void> {
    while (next < docs.length) {
      const doc = docs[next++]!;
      try {
        const blob = await loadBlob({ id: doc.id, storagePath: doc.storagePath ?? null, fileName: doc.fileName ?? doc.id });
        if (blob) cached++;
      } catch {
        /* best-effort: hoppa över ett dokument som inte gick att hämta */
      }
    }
  }
  const workers = Math.max(1, Math.min(concurrency, docs.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return cached;
}
