/**
 * Kö-lagring som kan bli full (#1817): med `full = true` kastar `add` som
 * IndexedDB gör när kvoten är slut. Övriga operationer fungerar som vanligt.
 */
import { InMemoryMutationQueuePersistence, type QueueEntry } from "@/lib/server/data-store/in-memory/mutation-queue";

export class FullableQueuePersistence extends InMemoryMutationQueuePersistence {
  full = false;

  override async add(entry: QueueEntry): Promise<void> {
    if (this.full) throw new DOMException("Kvoten för lagringen är slut", "QuotaExceededError");
    await super.add(entry);
  }
}

/** Kör `fn` med `globalThis.reportError` fångad; ger de rapporterade felen. */
export async function captureReportedErrors(fn: () => Promise<unknown>): Promise<unknown[]> {
  const reported: unknown[] = [];
  const prev = globalThis.reportError;
  globalThis.reportError = (e: unknown): void => { reported.push(e); };
  try {
    await fn();
  } finally {
    globalThis.reportError = prev;
  }
  return reported;
}
