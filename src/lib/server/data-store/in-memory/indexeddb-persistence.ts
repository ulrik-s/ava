/**
 * IndexedDB-adapter för `LocalStorePersistence` (#412, ADR 0016) — den
 * persisterade offline-cachens lagring i browsern. Hela `DemoSource` lagras
 * strukturklonad under en nyckel (Date-fält bevaras av structured clone).
 *
 * Bygger på den generiska `IdbKv` (#413) så open/get/put inte dupliceras.
 * `IDBFactory` injiceras (default `globalThis.indexedDB`) → testbar via
 * fake-indexeddb.
 */

import type { DemoSource } from "@/lib/shared/demo-source";
import { IdbKv } from "./idb-kv";
import type { LocalStorePersistence } from "./local-store-persistence";

const DB_NAME = "ava-local-store";
const STORE = "source";
const KEY = "current";

export class IndexedDbPersistence implements LocalStorePersistence {
  private readonly kv: IdbKv;

  constructor(
    factory: IDBFactory = (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB,
    dbName: string = DB_NAME,
  ) {
    this.kv = new IdbKv(factory, dbName, STORE);
  }

  async hydrate(): Promise<DemoSource | null> {
    return this.kv.get<DemoSource>(KEY);
  }

  async save(source: DemoSource): Promise<void> {
    await this.kv.put(KEY, source);
  }
}
