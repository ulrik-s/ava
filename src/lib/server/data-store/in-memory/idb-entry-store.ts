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
 * **Äldre lagringar** (`LegacySource`) ligger kvar där de låg, och deras
 * databaser uppgraderas aldrig: en flik med gammal kod kan hålla dem öppna,
 * och en versionshöjning skulle då blockeras. Raderna ligger i en EGEN
 * databas (`location.name`). Vid varje läsning flyttas de äldre lagringarnas
 * poster hit, om de inte redan finns — eller redan har kvitterats här
 * (`acked`), så att en gammal flik som skriver om sin array inte får en
 * kvitterad post att spelas upp igen. En äldre lagring glömmer posterna när
 * de har flyttats. Äldre lagringar är den gamla listan (#1346, `LegacyList`)
 * och — för den användare som ägde dem — de gemensamma databaserna från före
 * #1347 (`EntryStoreLegacy`).
 *
 * Varje rad tolkas med ett zod-schema vid läsning. En rad som inte går att
 * tolka hoppas över och rapporteras (`reportError`), men tas aldrig bort.
 */

import { z } from "zod";
import { broadcastChangeChannel, type ChangeChannel } from "./change-channel";
import { openDatabase, reportIdbProblem } from "./idb-open";
import { LegacyList, type LegacyListLocation, type LegacyRecord, type LegacySource } from "./legacy-list";

/** Radernas databas. Höjs den, stänger våra flikar sina anslutningar (`openDatabase`). */
const DB_VERSION = 1;
const ENTRY_STORE = "entries";
/** Id:n på poster ur den gamla listan som har tagits bort här — flyttas aldrig igen. */
const ACKED_STORE = "acked";
const ID_INDEX = "id";

const entryRecordSchema = z.object({ id: z.string(), value: z.unknown() });
const fromLegacySchema = z.object({ fromLegacy: z.literal(true) });

/** Var raderna ligger, och vilka äldre lagringar som flyttas in vid läsning. */
export interface EntryStoreLocation {
  /** Radernas databas. */
  name: string;
  /** Äldre lagringar, i den ordning de flyttas in. */
  legacy: readonly LegacySource[];
}

/** Var den gamla listan ligger, utom databasens namn. */
export type LegacyListPlace = Omit<LegacyListLocation, "dbName">;

/** #1346-platsen: raderna i `<dbName>-v2`, den gamla listan i `dbName`. */
export function v2Location(factory: IDBFactory, dbName: string, list: LegacyListPlace): EntryStoreLocation {
  return { name: `${dbName}-v2`, legacy: [new LegacyList(factory, { dbName, ...list })] };
}

export interface IdbEntryStoreOptions<T> {
  factory: IDBFactory;
  location: EntryStoreLocation;
  schema: z.ZodType<T>;
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
  private readonly dbName: string;
  /** En rad → postens värde, tolkat med postens schema. */
  private readonly rowSchema: z.ZodType<T>;

  constructor(private readonly opts: IdbEntryStoreOptions<T>) {
    this.dbName = opts.location.name;
    this.channel = opts.channel ?? broadcastChangeChannel(`ava-idb:${this.dbName}`);
    this.rowSchema = entryRecordSchema.transform((r) => r.value).pipe(opts.schema);
  }

  /** Alla poster i den ordning de lades till (de äldre lagringarnas nya poster flyttas först hit). */
  async load(): Promise<T[]> {
    return this.parseAll(await this.rows());
  }

  /** Posterna med id, otolkade — när den här lagringen själv är en äldre lagring (`EntryStoreLegacy`). */
  async records(): Promise<LegacyRecord[]> {
    return (await this.rows()).flatMap((row) => {
      const parsed = entryRecordSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
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
    await this.deleteMany([id]);
  }

  /** Ta bort posterna i en transaktion (de som inte finns hoppas över). */
  async deleteMany(ids: Iterable<string>): Promise<void> {
    await this.write([ENTRY_STORE, ACKED_STORE], (tx) => { for (const id of ids) deleteRecord(tx, id); });
  }

  /** Lyssna på andra flikars ändringar. Returnerar avregistreringen. */
  subscribe(listener: () => void): () => void {
    return this.channel.subscribe(listener);
  }

  /** Alla rader (efter att de äldre lagringarnas poster flyttats hit). */
  private async rows(): Promise<unknown[]> {
    for (const legacy of this.opts.location.legacy) await this.importLegacy(legacy);
    return this.run([ENTRY_STORE], "readonly", (tx) => {
      const req = tx.objectStore(ENTRY_STORE).getAll();
      return () => req.result;
    });
  }

  /** Flytta en äldre lagrings poster hit (idempotent); den glömmer dem när de flyttats. */
  private async importLegacy(legacy: LegacySource): Promise<void> {
    const records = await legacy.read();
    if (records.length === 0) return;
    await this.run([ENTRY_STORE, ACKED_STORE], "readwrite", (tx) => {
      for (const record of records) importRecord(tx, record);
      return () => undefined;
    });
    await legacy.clearIfMoved(new Set(records.map((r) => r.id)));
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

/**
 * En äldre `IdbEntryStore` som äldre lagring (#1347): de gemensamma
 * databaserna från före #1347 flyttas in i den ägande användarens egna. Den
 * äldre lagringen flyttar först in sin egen gamla lista (med sina
 * kvitteringar), och glömmer sedan posterna som flyttats vidare.
 */
export class EntryStoreLegacy implements LegacySource {
  constructor(private readonly store: IdbEntryStore<unknown>) {}

  read(): Promise<LegacyRecord[]> {
    return this.store.records();
  }

  async clearIfMoved(moved: ReadonlySet<string>): Promise<void> {
    await this.store.deleteMany(moved);
  }
}
