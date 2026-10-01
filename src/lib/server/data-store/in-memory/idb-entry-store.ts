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
 * **Den gamla listan** (`LegacyList`) ligger kvar i den gamla databasen, som
 * aldrig uppgraderas: en flik med gammal kod kan hålla den öppen, och en
 * versionshöjning skulle då blockeras. Raderna ligger i en EGEN databas
 * (`<gammalt namn>-v2`). Vid varje läsning flyttas den gamla listans poster
 * hit, om de inte redan finns — eller redan har kvitterats här (`acked`), så
 * att en gammal flik som skriver om sin array inte får en kvitterad post att
 * spelas upp igen. Den gamla nyckeln tas bort när allt i den har flyttats.
 *
 * Varje rad tolkas med ett zod-schema vid läsning. En rad som inte går att
 * tolka hoppas över och rapporteras (`reportError`), men tas aldrig bort.
 */

import { z } from "zod";
import { broadcastChangeChannel, type ChangeChannel } from "./change-channel";
import { openDatabase, reportIdbProblem } from "./idb-open";
import { LegacyList, type LegacyListLocation, type LegacyRecord } from "./legacy-list";

/** Radernas databas. Höjs den, stänger våra flikar sina anslutningar (`openDatabase`). */
const DB_VERSION = 1;
const ENTRY_STORE = "entries";
/** Id:n på poster ur den gamla listan som har tagits bort här — flyttas aldrig igen. */
const ACKED_STORE = "acked";
const ID_INDEX = "id";

const entryRecordSchema = z.object({ id: z.string(), value: z.unknown() });
const fromLegacySchema = z.object({ fromLegacy: z.literal(true) });

export interface IdbEntryStoreOptions<T> {
  factory: IDBFactory;
  /** Den gamla databasens namn; raderna ligger i `<dbName>-v2`. */
  dbName: string;
  schema: z.ZodType<T>;
  /** Var den gamla listan ligger i den gamla databasen. */
  legacy: Omit<LegacyListLocation, "dbName">;
  /** Signal till andra flikar. Default: en `BroadcastChannel` per databas. */
  channel?: ChangeChannel;
}

/** Raden för en post; `fromLegacy` = flyttad ur den gamla listan. */
interface EntryRecord {
  id: string;
  value: unknown;
  fromLegacy?: true;
}

function upgrade(db: IDBDatabase): void {
  db.createObjectStore(ENTRY_STORE, { autoIncrement: true }).createIndex(ID_INDEX, "id", { unique: true });
  db.createObjectStore(ACKED_STORE);
}

/** Radens nyckel för ett post-id (undefined = posten finns inte). */
function withKey(store: IDBObjectStore, id: string, then: (key: IDBValidKey | undefined) => void): void {
  const req = store.index(ID_INDEX).getKey(id);
  req.onsuccess = () => then(req.result);
}

/** Lägg en post ur den gamla listan sist — om den varken finns eller redan kvitterats. */
function importRecord(tx: IDBTransaction, record: LegacyRecord): void {
  const entries = tx.objectStore(ENTRY_STORE);
  const acked = tx.objectStore(ACKED_STORE).count(record.id);
  acked.onsuccess = () => {
    if (acked.result > 0) return;
    withKey(entries, record.id, (key) => {
      if (key === undefined) entries.add({ id: record.id, value: record.value, fromLegacy: true } satisfies EntryRecord);
    });
  };
}

/** Ta bort raden; kom den ur den gamla listan, kom ihåg att den är kvitterad. */
function deleteRecord(tx: IDBTransaction, id: string): void {
  const entries = tx.objectStore(ENTRY_STORE);
  withKey(entries, id, (key) => {
    if (key === undefined) return;
    const req = entries.get(key);
    req.onsuccess = () => {
      if (fromLegacySchema.safeParse(req.result).success) tx.objectStore(ACKED_STORE).put(Date.now(), id);
      entries.delete(key);
    };
  });
}

export class IdbEntryStore<T> {
  private readonly channel: ChangeChannel;
  private readonly legacy: LegacyList;
  private readonly dbName: string;
  /** En rad → postens värde, tolkat med postens schema. */
  private readonly rowSchema: z.ZodType<T>;

  constructor(private readonly opts: IdbEntryStoreOptions<T>) {
    this.dbName = `${opts.dbName}-v2`;
    this.channel = opts.channel ?? broadcastChangeChannel(`ava-idb:${this.dbName}`);
    this.legacy = new LegacyList(opts.factory, { dbName: opts.dbName, ...opts.legacy });
    this.rowSchema = entryRecordSchema.transform((r) => r.value).pipe(opts.schema);
  }

  /** Alla poster i den ordning de lades till (den gamla listans nya poster flyttas först hit). */
  async load(): Promise<T[]> {
    await this.importLegacy();
    return this.run([ENTRY_STORE], "readonly", (tx) => {
      const req = tx.objectStore(ENTRY_STORE).getAll();
      return () => this.parseAll(req.result);
    });
  }

  /** Lägg posten sist. Finns id:t redan händer ingenting. */
  async add(id: string, value: T): Promise<void> {
    await this.write([ENTRY_STORE], (tx) => {
      const store = tx.objectStore(ENTRY_STORE);
      withKey(store, id, (key) => {
        if (key === undefined) store.add({ id, value } satisfies EntryRecord);
      });
    });
  }

  /** Ersätt posten på sin plats (finns den inte läggs den sist). */
  async put(id: string, value: T): Promise<void> {
    await this.write([ENTRY_STORE], (tx) => {
      const store = tx.objectStore(ENTRY_STORE);
      withKey(store, id, (key) => {
        if (key === undefined) store.add({ id, value } satisfies EntryRecord);
        else store.put({ id, value } satisfies EntryRecord, key);
      });
    });
  }

  /** Ta bort posten (finns den inte händer ingenting). */
  async delete(id: string): Promise<void> {
    await this.write([ENTRY_STORE, ACKED_STORE], (tx) => deleteRecord(tx, id));
  }

  /** Lyssna på andra flikars ändringar. Returnerar avregistreringen. */
  subscribe(listener: () => void): () => void {
    return this.channel.subscribe(listener);
  }

  /** Flytta den gamla listans poster hit (idempotent) och ta bort nyckeln när allt flyttats. */
  private async importLegacy(): Promise<void> {
    const records = await this.legacy.read();
    if (records.length === 0) return;
    await this.run([ENTRY_STORE, ACKED_STORE], "readwrite", (tx) => {
      for (const record of records) importRecord(tx, record);
      return () => undefined;
    });
    await this.legacy.clearIfMoved(new Set(records.map((r) => r.id)));
  }

  private parseAll(rows: readonly unknown[]): T[] {
    const values: T[] = [];
    for (const row of rows) {
      const parsed = this.rowSchema.safeParse(row);
      if (parsed.success) values.push(parsed.data);
      else reportIdbProblem(new Error(`[${this.dbName}] en post kunde inte läsas och hoppas över (den ligger kvar i lagringen).`, { cause: parsed.error }));
    }
    return values;
  }

  private async write(stores: string[], body: (tx: IDBTransaction) => void): Promise<void> {
    await this.run(stores, "readwrite", (tx) => {
      body(tx);
      return () => undefined;
    });
    this.channel.post();
  }

  /** Kör `body` i en transaktion; värdet läses först när transaktionen gått igenom. */
  private async run<V>(stores: string[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => () => V): Promise<V> {
    const db = await openDatabase({ factory: this.opts.factory, name: this.dbName, version: DB_VERSION, upgrade });
    try {
      return await new Promise<V>((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        const result = body(tx);
        tx.oncomplete = () => resolve(result());
        // Ett fel i en begäran avbryter transaktionen (inget anropar preventDefault).
        tx.onabort = () => reject(tx.error ?? new Error("indexedDB-transaktion avbröts"));
      });
    } finally {
      db.close();
    }
  }
}
