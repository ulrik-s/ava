/**
 * Uppskjutna fakturadokument (#1243) — dokument vars faktura ännu inte fått
 * sitt nummer av servern. Sparas i IndexedDB (överlever omladdning) och skapas
 * efter nästa synk, med serverns nummer.
 */

import { IndexedDbListStore, type ListStore } from "@/lib/client/backend/idb-list-store";
import type { FakturaBreakdown, FakturaDocInvoice, FakturaDocMeta } from "@/lib/client/kostnadsrakning/faktura-template";
import type { InvoiceSpecification } from "@/lib/shared/invoice-specification";
import type { MatterId } from "@/lib/shared/schemas/ids";

/** Ett uppskjutet dokument — bara data (register/utils ges när det skapas). */
export interface DeferredFakturaDoc {
  invoiceId: string;
  invoice: FakturaDocInvoice;
  matterId: MatterId;
  recipient: string;
  meta: FakturaDocMeta;
  spec?: InvoiceSpecification | null | undefined;
  breakdown?: FakturaBreakdown | null | undefined;
}

/** Lagringen (IndexedDB i webbläsaren, in-memory i tester). */
export type DeferredFakturaStore = ListStore<DeferredFakturaDoc>;

export class InMemoryDeferredFakturaStore implements DeferredFakturaStore {
  private items: DeferredFakturaDoc[] = [];
  async load(): Promise<DeferredFakturaDoc[]> { return structuredClone(this.items); }
  async save(items: readonly DeferredFakturaDoc[]): Promise<void> { this.items = structuredClone([...items]); }
}

let override: DeferredFakturaStore | null = null;
let defaultStore: DeferredFakturaStore | null = null;

/** Den aktiva lagringen (testets, annars IndexedDB). */
export function deferredFakturaStore(): DeferredFakturaStore {
  if (override) return override;
  defaultStore ??= new IndexedDbListStore<DeferredFakturaDoc>("ava-deferred-faktura-docs");
  return defaultStore;
}

/** Bara för tester: byt lagringen (null = tillbaka till IndexedDB). */
export function setDeferredFakturaStoreForTests(s: DeferredFakturaStore | null): void {
  override = s;
}

/** Skjut upp ett dokument (en gång per faktura). */
export async function deferFakturaDoc(doc: DeferredFakturaDoc): Promise<void> {
  const store = deferredFakturaStore();
  const items = await store.load();
  if (items.some((d) => d.invoiceId === doc.invoiceId)) return;
  await store.save([...items, doc]);
}
