"use client";

/**
 * `startActiveMatterPrefetch` (#1244) — self-hosted: fyll den lokala sökningen
 * med text som sparats tidigare, och förladda de aktiva ärendena direkt och
 * efter varje lyckad synk (då kan nya dokument och ärenden ha kommit in).
 */

import { onServerSynced } from "@/lib/client/sync/server-sync-flush";
import { asId } from "@/lib/shared/schemas/ids";
import type { WorkingSetMatter } from "../working-set/working-set";
import { type ActiveMatterDoc, type ActiveMatterPrefetchDeps, prefetchActiveMatters } from "./prefetch-active-matters";

type Row = Record<string, unknown>;

/** Klientstorens rader (`CachingSyncDataStore.store.currentSource`). */
export interface ActiveMatterSource {
  matters?: readonly Row[];
  documents?: readonly Row[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function mattersOf(source: ActiveMatterSource): WorkingSetMatter[] {
  return (source.matters ?? []).flatMap((m) => {
    const id = str(m.id);
    if (!id) return [];
    const status = str(m.status);
    return [{ id, responsibleLawyerId: str(m.responsibleLawyerId) ?? null, ...(status ? { status } : {}) }];
  });
}

export function documentsOf(source: ActiveMatterSource): ActiveMatterDoc[] {
  return (source.documents ?? []).flatMap((d) => {
    const id = str(d.id);
    const matterId = str(d.matterId);
    if (!id || !matterId) return [];
    return [{
      id: asId<"DocumentId">(id), matterId,
      storagePath: str(d.storagePath) ?? null, fileName: str(d.fileName) ?? id, mimeType: str(d.mimeType) ?? null,
    }];
  });
}

export interface StartActiveMatterPrefetchDeps extends Omit<ActiveMatterPrefetchDeps, "matters" | "documents" | "texts"> {
  source: () => ActiveMatterSource;
  texts: ActiveMatterPrefetchDeps["texts"] & { loadAll(): Promise<Array<[string, string]>> };
  onSynced?: typeof onServerSynced;
}

/** Starta; returnerar stoppfunktionen. */
export function startActiveMatterPrefetch(deps: StartActiveMatterPrefetchDeps): () => void {
  let running = false;
  const run = (): void => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        const source = deps.source();
        await prefetchActiveMatters({ ...deps, matters: mattersOf(source), documents: documentsOf(source) });
      } catch (e) {
        console.warn("[förladdning] aktiva ärenden:", e);
      } finally {
        running = false;
      }
    })();
  };
  void deps.texts.loadAll()
    .then((all) => { for (const [id, text] of all) deps.publish(id, text); })
    .catch(() => undefined)
    .finally(run);
  return (deps.onSynced ?? onServerSynced)(run);
}
