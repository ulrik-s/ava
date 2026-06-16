/**
 * Persistens-port för `LocalStore` (#412, ADR 0016) — hydrera hela källan vid
 * start och spara hela källan vid varje mutation (write-back). Snapshot-baserad;
 * den finkorniga mutations-kön (delta-sync) kommer i #413/#414.
 *
 * Adaptrar:
 *   - `InMemoryPersistence`   — tester/demo utan disk.
 *   - `IndexedDbPersistence`  — browser (separat fil, DOM-beroende).
 */

import type { DemoSource } from "@/lib/shared/demo-source";
import { LocalStore } from "./local-store";

export interface LocalStorePersistence {
  /** Läs hela källan (eller `null` om inget persisterat ännu). */
  hydrate(): Promise<DemoSource | null>;
  /** Spara hela källan. */
  save(source: DemoSource): Promise<void>;
}

/** In-memory-adapter — håller en (djupkopierad) ögonblicksbild. */
export class InMemoryPersistence implements LocalStorePersistence {
  constructor(private snapshot: DemoSource | null = null) {}

  async hydrate(): Promise<DemoSource | null> {
    return this.snapshot ? (structuredClone(this.snapshot) as DemoSource) : null;
  }

  async save(source: DemoSource): Promise<void> {
    this.snapshot = structuredClone(source) as DemoSource;
  }
}

/**
 * Skapa en persisterad `LocalStore`: hydrera källan ur persistensen (annars
 * `seed`), och skriv tillbaka hela källan efter varje mutation. Returnerar en
 * writable store (onMutate satt).
 */
export async function createPersistedLocalStore(
  persistence: LocalStorePersistence,
  seed: DemoSource = {},
): Promise<LocalStore> {
  const hydrated = await persistence.hydrate();
  const source = hydrated ?? seed;
  const store = new LocalStore(source, async () => {
    await persistence.save(store.currentSource);
  });
  return store;
}
