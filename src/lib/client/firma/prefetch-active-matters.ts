"use client";

/**
 * Förladdning av juristens aktiva ärenden (#1244, ADR 0022 §1 + ADR 0028 §4a).
 *
 * Förut fanns ett dokument offline bara om ärendet hade öppnats. Nu hämtas
 * dokumenten i arbetsmängdens fastnålade del — juristens egna, aktiva ärenden —
 * till byte-cachen, och deras text extraheras och sparas så att den lokala
 * sökningen hittar innehållet offline. Redan cachade dokument och redan
 * extraherad text är gratis (cache-först), så en ny körning efter varje synk
 * hämtar bara det som tillkommit.
 */

import type { DocumentId } from "@/lib/shared/schemas/ids";
import { computeWorkingSet, type WorkingSetMatter } from "../working-set/working-set";
import { prefetchMatterDocuments } from "./prefetch-matter-documents";

/** Ärendebudgeten (ADR 0022 §2). De fastnålade ärendena ryms alltid. */
const ACTIVE_BUDGET = 200;

/** Ett dokument som kan förladdas. */
export interface ActiveMatterDoc {
  id: DocumentId;
  matterId: string;
  storagePath?: string | null;
  fileName?: string;
  mimeType?: string | null;
}

export interface ActiveMatterPrefetchDeps {
  userId: string;
  matters: readonly WorkingSetMatter[];
  documents: readonly ActiveMatterDoc[];
  /** Cache-först: hämtar och cachar bytes, null om det inte gick. */
  loadBlob: (doc: { id: DocumentId; storagePath: string | null; fileName: string }) => Promise<Blob | null>;
  texts: { has(id: string): Promise<boolean>; put(id: string, text: string): Promise<void> };
  extract: (input: { bytes: Uint8Array; mimeType?: string; fileName?: string }) => Promise<string>;
  /** Gör texten sökbar direkt (den lokala sökningens innehållskarta). */
  publish: (id: string, text: string) => void;
}

export interface ActiveMatterPrefetchResult {
  matters: number;
  cached: number;
  indexed: number;
}

/** Förladda de aktiva ärendenas dokument och indexera texten. Best-effort. */
export async function prefetchActiveMatters(deps: ActiveMatterPrefetchDeps): Promise<ActiveMatterPrefetchResult> {
  const { pinned } = computeWorkingSet({ userId: deps.userId, matters: deps.matters, budget: ACTIVE_BUDGET });
  const byId = new Map(deps.documents.map((d) => [d.id, d]));
  const docs = deps.documents.filter((d) => pinned.has(d.matterId));
  let indexed = 0;
  const loadAndIndex: ActiveMatterPrefetchDeps["loadBlob"] = async (doc) => {
    const blob = await deps.loadBlob(doc);
    if (!blob || (await deps.texts.has(doc.id))) return blob;
    const mimeType = byId.get(doc.id)?.mimeType ?? undefined;
    const text = await deps.extract({ bytes: new Uint8Array(await blob.arrayBuffer()), fileName: doc.fileName, ...(mimeType ? { mimeType } : {}) });
    if (text.trim()) {
      await deps.texts.put(doc.id, text);
      deps.publish(doc.id, text);
      indexed++;
    }
    return blob;
  };
  const cached = await prefetchMatterDocuments(docs, loadAndIndex);
  return { matters: pinned.size, cached, indexed };
}
