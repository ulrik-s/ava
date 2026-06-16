/**
 * `IdbKv` — minimal generisk IndexedDB key-value-lagring (#413). Delas av
 * `IndexedDbPersistence` (hela DemoSource) och mutations-köns persistens, så
 * den råa open/get/put-koden inte dupliceras.
 *
 * `IDBFactory` injiceras (default `globalThis.indexedDB`) → testbar via
 * fake-indexeddb och oberoende av globalt tillstånd mellan tester.
 */

const DB_VERSION = 1;

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

  async put<V>(key: string, value: V): Promise<void> {
    const db = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readwrite");
        tx.objectStore(this.storeName).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("indexedDB put misslyckades"));
        tx.onabort = () => reject(tx.error ?? new Error("indexedDB-transaktion avbröts"));
      });
    } finally {
      db.close();
    }
  }
}
