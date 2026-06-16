/**
 * IndexedDB-adapter för `LocalStorePersistence` (#412, ADR 0016) — den
 * persisterade offline-cachens lagring i browsern. Hela `DemoSource` lagras
 * strukturklonad under en nyckel (Date-fält bevaras av structured clone).
 *
 * `IDBFactory` injiceras (default `globalThis.indexedDB`) så adaptern är
 * testbar utan en riktig browser (fake-indexeddb) och oberoende av globalt
 * tillstånd mellan tester.
 */

import type { DemoSource } from "@/lib/shared/demo-source";
import type { LocalStorePersistence } from "./local-store-persistence";

const DB_NAME = "ava-local-store";
const STORE = "source";
const KEY = "current";
const DB_VERSION = 1;

export class IndexedDbPersistence implements LocalStorePersistence {
  constructor(
    private readonly factory: IDBFactory = (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB,
    private readonly dbName: string = DB_NAME,
  ) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = this.factory.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB open misslyckades"));
    });
  }

  async hydrate(): Promise<DemoSource | null> {
    const db = await this.open();
    try {
      return await new Promise<DemoSource | null>((resolve, reject) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve((req.result as DemoSource | undefined) ?? null);
        req.onerror = () => reject(req.error ?? new Error("indexedDB get misslyckades"));
      });
    } finally {
      db.close();
    }
  }

  async save(source: DemoSource): Promise<void> {
    const db = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(source, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("indexedDB put misslyckades"));
        tx.onabort = () => reject(tx.error ?? new Error("indexedDB-transaktion avbröts"));
      });
    } finally {
      db.close();
    }
  }
}
