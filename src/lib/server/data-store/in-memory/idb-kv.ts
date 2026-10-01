/**
 * `IdbKv` — minimal generisk IndexedDB key-value-lagring (#413). Delas av
 * `IndexedDbPersistence` (hela DemoSource) och mutations-köns persistens, så
 * den råa open/get/put-koden inte dupliceras.
 *
 * `IDBFactory` injiceras (default `globalThis.indexedDB`) → testbar via
 * fake-indexeddb och oberoende av globalt tillstånd mellan tester.
 */

const DB_VERSION = 1;

/** Villkor för en skrivning: `check` får det lagrade värdet för `key` och kastar för att avbryta. */
export interface KvWriteGuard {
  readonly key: string;
  readonly check: (stored: unknown) => void;
}

export class IdbKv {
  constructor(
    private readonly factory: IDBFactory,
    private readonly dbName: string,
    private readonly storeName: string,
  ) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = this.factory.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(this.storeName)) req.result.createObjectStore(this.storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB open misslyckades"));
    });
  }

  async get<V>(key: string): Promise<V | null> {
    const db = await this.open();
    try {
      return await new Promise<V | null>((resolve, reject) => {
        const req = db.transaction(this.storeName, "readonly").objectStore(this.storeName).get(key);
        req.onsuccess = () => resolve((req.result as V | undefined) ?? null);
        req.onerror = () => reject(req.error ?? new Error("indexedDB get misslyckades"));
      });
    } finally {
      db.close();
    }
  }

  /** Alla nycklar (för rensning, #1347). */
  async keys(): Promise<string[]> {
    const db = await this.open();
    try {
      return await new Promise<string[]>((resolve, reject) => {
        const req = db.transaction(this.storeName, "readonly").objectStore(this.storeName).getAllKeys();
        req.onsuccess = () => resolve(req.result.filter((k): k is string => typeof k === "string"));
        req.onerror = () => reject(req.error ?? new Error("indexedDB getAllKeys misslyckades"));
      });
    } finally {
      db.close();
    }
  }

  async put<V>(key: string, value: V): Promise<void> {
    await this.putAll([[key, value]]);
  }

  /**
   * Skriv flera nycklar i EN transaktion — allt eller inget (#1362). Med
   * `guard` läses `guard.key` först i samma transaktion; kastar `guard.check`
   * avbryts transaktionen, ingenting skrivs och felet kastas vidare.
   */
  async putAll(entries: ReadonlyArray<readonly [string, unknown]>, guard?: KvWriteGuard): Promise<void> {
    const db = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);
        let refused: unknown = null;
        const write = (): void => { for (const [key, value] of entries) store.put(value, key); };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("indexedDB put misslyckades"));
        tx.onabort = () => reject(refused ?? tx.error ?? new Error("indexedDB-transaktion avbröts"));
        if (!guard) { write(); return; }
        const req = store.get(guard.key);
        req.onsuccess = () => {
          try { guard.check(req.result); } catch (e) { refused = e; tx.abort(); return; }
          write();
        };
      });
    } finally {
      db.close();
    }
  }

  async delete(key: string): Promise<void> {
    const db = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readwrite");
        tx.objectStore(this.storeName).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("indexedDB delete misslyckades"));
        tx.onabort = () => reject(tx.error ?? new Error("indexedDB-transaktion avbröts"));
      });
    } finally {
      db.close();
    }
  }
}
