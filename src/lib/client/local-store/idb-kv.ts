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

/** Nycklar och värden att skriva. */
export type KvEntries = ReadonlyArray<readonly [string, unknown]>;

/** Ett steg i {@link IdbKv.update}: de lagrade värdena → det som ska skrivas, eller en läsning till. */
export type KvStep = (stored: unknown[]) => KvEntries | KvRead;

/** En läsning till i samma transaktion, och steget som får dess värden. */
export interface KvRead {
  readonly keys: readonly string[];
  readonly next: KvStep;
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

  /**
   * Läs flera nycklar i EN transaktion (#1711): värdena hör ihop — en annan
   * fliks skrivning hamnar aldrig mellan dem. `null` för en nyckel som saknas.
   */
  async getAll(keys: readonly string[]): Promise<unknown[]> {
    const db = await this.open();
    try {
      return await new Promise<unknown[]>((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readonly");
        const store = tx.objectStore(this.storeName);
        const requests = keys.map((key) => store.get(key));
        tx.oncomplete = () => resolve(requests.map((req): unknown => req.result ?? null));
        tx.onerror = () => reject(tx.error ?? new Error("indexedDB get misslyckades"));
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
  async putAll(entries: KvEntries, guard?: KvWriteGuard): Promise<void> {
    await this.update(guard ? [guard.key] : [], ([stored]) => {
      guard?.check(stored);
      return entries;
    });
  }

  /**
   * Läs och skriv i EN transaktion (#1714): `step` får de lagrade värdena för
   * `keys` (`null` för en nyckel som saknas) och svarar med det som ska skrivas,
   * eller med en ny läsning ({@link KvRead}) i samma transaktion. Ingen annan
   * fliks skrivning hamnar mellan läsningen och skrivningen. Kastar `step`
   * avbryts transaktionen, ingenting skrivs och felet kastas vidare.
   */
  async update(keys: readonly string[], step: KvStep): Promise<void> {
    const db = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);
        let refused: unknown = null;
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("indexedDB put misslyckades"));
        tx.onabort = () => reject(refused ?? tx.error ?? new Error("indexedDB-transaktion avbröts"));
        const advance = (read: KvRead, stored: unknown[]): void => {
          let result: KvEntries | KvRead;
          try { result = read.next(stored); } catch (e) { refused = e; tx.abort(); return; }
          if ("next" in result) run(result);
          else for (const [key, value] of result) store.put(value, key);
        };
        const run = (read: KvRead): void => {
          const requests = read.keys.map((key) => store.get(key));
          const done = (): void => advance(read, requests.map((req): unknown => req.result ?? null));
          const last = requests.at(-1);
          if (last) last.onsuccess = done;
          else done();
        };
        run({ keys, next: step });
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
