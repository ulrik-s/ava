/**
 * `startServerInvoiceNumbering` (#1243) — self-hosted: fakturanumret sätts av
 * servern. Registrerar resolvern mot klientstoren och skapar uppskjutna
 * fakturadokument efter varje lyckad synk (och en gång direkt — de kan ligga
 * kvar från förra sessionen).
 */

import type { DocUtils, RegisterMut } from "@/lib/client/kostnadsrakning/generate-faktura-doc";
import { flushServerSync, onServerSynced } from "@/lib/client/sync/server-sync-flush";
import { registerInvoiceNumberResolver, storeInvoiceNumberResolver, type StoreResolverDeps } from "./invoice-number-finality";
import { processDeferredFakturaDocs } from "./process-deferred-faktura-docs";

export interface ServerInvoiceNumberingDeps {
  store: Pick<StoreResolverDeps, "hasPendingFor" | "readInvoice">;
  register: RegisterMut;
  utils: DocUtils;
}

/** Starta; returnerar stoppfunktionen. */
export function startServerInvoiceNumbering(deps: ServerInvoiceNumberingDeps): () => void {
  const unregister = registerInvoiceNumberResolver(storeInvoiceNumberResolver({
    flush: flushServerSync,
    hasPendingFor: deps.store.hasPendingFor,
    readInvoice: deps.store.readInvoice,
  }));
  let running = false;
  const process = (): void => {
    if (running) return;
    running = true;
    void processDeferredFakturaDocs({ register: deps.register, utils: deps.utils })
      .catch((e: unknown) => console.warn("[faktura] uppskjutna dokument:", e))
      .finally(() => { running = false; });
  };
  const unsubscribe = onServerSynced(process);
  process();
  return () => { unsubscribe(); unregister(); };
}
