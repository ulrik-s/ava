/**
 * Pollar helper-motorn (ADR 0029) — närvaro (`/ping`) + synk-status (`/status`).
 * Electron-fri, injicerbar `fetch` → testbar. Skalet pollar localhost direkt
 * (samma maskin, ingen Safari-mixed-content-fråga → bara HTTP-basen behövs).
 */

import { HELPER_BASE, parsePingVersion, type HelperStatusResponse } from "@/lib/shared/helper/protocol";

export interface HelperSnapshot {
  present: boolean;
  version: string | null;
  status: HelperStatusResponse | null;
}

const ABSENT: HelperSnapshot = { present: false, version: null, status: null };

type FetchLike = (url: string) => Promise<Response>;

/** En ögonblicksbild av motorn; `present:false` om den inte svarar. */
export async function pollHelper(fetchFn: FetchLike = fetch, base: string = HELPER_BASE): Promise<HelperSnapshot> {
  let version: string | null;
  try {
    const ping = await fetchFn(`${base}/ping`);
    if (!ping.ok) return ABSENT;
    version = parsePingVersion(await ping.text());
  } catch {
    return ABSENT;
  }
  return { present: true, version, status: await fetchStatus(fetchFn, base) };
}

async function fetchStatus(fetchFn: FetchLike, base: string): Promise<HelperStatusResponse | null> {
  try {
    const r = await fetchFn(`${base}/status`);
    if (!r.ok) return null;
    const d = (await r.json()) as Partial<HelperStatusResponse>;
    if (typeof d.pending !== "number" || typeof d.conflict !== "number" || typeof d.total !== "number" || !Array.isArray(d.entries)) {
      return null;
    }
    return { pending: d.pending, conflict: d.conflict, total: d.total, entries: d.entries };
  } catch {
    return null;
  }
}
