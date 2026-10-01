/**
 * `IdbEntryStore` (#1346) — en lista i IndexedDB där varje post är en egen
 * rad, så att flera flikar kan skriva samtidigt utan att skriva över varandra.
 *
 * Tidigare låg hela listan under en nyckel (`IdbKv`) och varje flik skrev hela
 * sin kopia: flik A köade X, flik B sparade sin kö utan X, och X var borta.
 * Nu läggs en post till, ersätts eller tas bort för sig, i en egen transaktion.
 *
 *   - Raderna har en stigande nyckel (`autoIncrement`) → läsningen ger dem i
 *     den ordning de lades till, oavsett vilken flik som skrev (FIFO).
 *   - Ett unikt index på postens id → samma id läggs bara till en gång, och
 *     en post kan tas bort eller ersättas på sin plats.
 *   - Efter varje skrivning skickas en signal till de andra flikarna
 *     (`ChangeChannel`) så att de läser om.
 *
 * **Uppgradering:** databasen går från version 1 (hela listan under en nyckel)
 * till 2. Uppgraderingen flyttar den gamla listan till raderna och tar bort den
 * gamla nyckeln i SAMMA versionstransaktion: antingen flyttas allt eller
 * ingenting, och en avbruten uppgradering lämnar den gamla listan orörd.
 *
 * Varje rad tolkas med ett zod-schema vid läsning. En rad som inte går att
 * tolka hoppas över och rapporteras (`reportError`), men tas aldrig bort.
 */

import { z } from "zod";
import { broadcastChangeChannel, type ChangeChannel } from "./change-channel";

const DB_VERSION = 2;
const ENTRY_STORE = "entries";
const ID_INDEX = "id";

const entryRecordSchema = z.object({ id: z.string(), value: z.unknown() });
type EntryRecord = z.infer<typeof entryRecordSchema>;

const legacyItemSchema = z.record(z.string(), z.unknown());

/** Var den gamla listan (version 1) låg, och vilket fält som är postens id. */
export interface LegacyList {
  storeName: string;
  key: string;
  idField: string;
}

export interface IdbEntryStoreOptions<T> {
  factory: IDBFactory;
  dbName: string;
  schema: z.ZodType<T>;
  legacy: LegacyList;
  /** Signal till andra flikar. Default: en `BroadcastChannel` per databas. */
  channel?: ChangeChannel;
}

/** Den gamla listans poster som rader. Utan id → ett eget id så att inget tappas; dubbletter en gång. */
function legacyRecords(items: readonly unknown[], idField: string): EntryRecord[] {
  const seen = new Set<string>();
  const records: EntryRecord[] = [];
  items.forEach((value, index) => {
    const parsed = legacyItemSchema.safeParse(value);
    const field = parsed.success ? parsed.data[idField] : undefined;
    const id = typeof field === "string" ? field : `legacy-${index}`;
    if (seen.has(id)) return;
    seen.add(id);
    records.push({ id, value });
  });
  return records;
}

/** Flytta den gamla listan till raderna och ta bort den gamla nyckeln (i versionstransaktionen). */
function moveLegacyList(tx: IDBTransaction, legacy: LegacyList): void {
  const old = tx.objectStore(legacy.storeName);
  const req = old.get(legacy.key);
  req.onsuccess = () => {
    const items: unknown = req.result;
    if (!Array.isArray(items)) return;
    const entries = tx.objectStore(ENTRY_STORE);
    for (const record of legacyRecords(items, legacy.idField)) entries.add(record);
    old.delete(legacy.key);
  };
}

function upgrade(db: IDBDatabase, tx: IDBTransaction | null, legacy: LegacyList): void {
  if (!db.objectStoreNames.contains(ENTRY_STORE)) {
    db.createObjectStore(ENTRY_STORE, { autoIncrement: true }).createIndex(ID_INDEX, "id", { unique: true });
  }
  if (tx && db.objectStoreNames.contains(legacy.storeName)) moveLegacyList(tx, legacy);
}

/**
 * En rad som inte gick att tolka rapporteras som ett fel i sidan
 * (`reportError` → sidans felhantering), inte tyst. Raden ligger kvar.
 */
function reportUnreadable(dbName: string, cause: unknown): void {
  if (typeof globalThis.reportError !== "function") return;
  globalThis.reportError(new Error(`[${dbName}] en post kunde inte läsas och hoppas över (den ligger kvar i lagringen).`, { cause }));
}

/** Radens nyckel för ett post-id (undefined = posten finns inte). */
function withKey(store: IDBObjectStore, id: string, then: (key: IDBValidKey | undefined) => void): void {
  const req = store.index(ID_INDEX).getKey(id);
  req.onsuccess = () => then(req.result);
}

export class IdbEntryStore<T> {
  private readonly channel: ChangeChannel;
  /** En rad → postens värde, tolkat med postens schema. */
  private readonly rowSchema: z.ZodType<T>;

  constructor(private readonly opts: IdbEntryStoreOptions<T>) {
    this.channel = opts.channel ?? broadcastChangeChannel(`ava-idb:${opts.dbName}`);
    this.rowSchema = entryRecordSchema.transform((r) => r.value).pipe(opts.schema);
  }

  /** Alla poster i den ordning de lades till. */
  load(): Promise<T[]> {
    return this.run("readonly", (store) => {
      const req = store.getAll();
      return () => this.parseAll(req.result);
    });
  }

  /** Lägg posten sist. Finns id:t redan händer ingenting. */
  async add(id: string, value: T): Promise<void> {
    await this.write((store) => withKey(store, id, (key) => {
      if (key === undefined) store.add({ id, value });
    }));
  }

  /** Ersätt posten på sin plats (finns den inte läggs den sist). */
  async put(id: string, value: T): Promise<void> {
    await this.write((store) => withKey(store, id, (key) => {
      if (key === undefined) store.add({ id, value });
      else store.put({ id, value }, key);
    }));
  }

  /** Ta bort posten (finns den inte händer ingenting). */
  async delete(id: string): Promise<void> {
    await this.write((store) => withKey(store, id, (key) => {
      if (key !== undefined) store.delete(key);
    }));
  }

  /** Lyssna på andra flikars ändringar. Returnerar avregistreringen. */
  subscribe(listener: () => void): () => void {
    return this.channel.subscribe(listener);
  }

  private parseAll(rows: readonly unknown[]): T[] {
    const values: T[] = [];
    for (const row of rows) {
      const parsed = this.rowSchema.safeParse(row);
      if (parsed.success) values.push(parsed.data);
      else reportUnreadable(this.opts.dbName, parsed.error);
    }
    return values;
  }

  private async write(body: (store: IDBObjectStore) => void): Promise<void> {
    await this.run("readwrite", (store) => {
      body(store);
      return () => undefined;
    });
    this.channel.post();
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = this.opts.factory.open(this.opts.dbName, DB_VERSION);
      req.onupgradeneeded = () => upgrade(req.result, req.transaction, this.opts.legacy);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB open misslyckades"));
    });
  }

  /** Kör `body` i en transaktion; värdet läses först när transaktionen gått igenom. */
  private async run<V>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => () => V): Promise<V> {
    const db = await this.open();
    try {
      return await new Promise<V>((resolve, reject) => {
        const tx = db.transaction(ENTRY_STORE, mode);
        const result = body(tx.objectStore(ENTRY_STORE));
        tx.oncomplete = () => resolve(result());
        // Ett fel i en begäran avbryter transaktionen (inget anropar preventDefault).
        tx.onabort = () => reject(tx.error ?? new Error("indexedDB-transaktion avbröts"));
      });
    } finally {
      db.close();
    }
  }
}
