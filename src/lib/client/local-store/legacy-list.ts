/**
 * Den gamla listan (#1346): före #1346 låg kön och de avvisade ändringarna som
 * en hel array under en nyckel (`IdbKv`, databasversion 1).
 *
 * Den gamla databasen öppnas i den version den har — aldrig en
 * versionshöjning, som skulle blockeras av en flik som fortfarande kör gammal
 * kod. En sådan flik kan också fortsätta skriva om sin array, så listan läses
 * vid varje omläsning, och nyckeln tas bara bort när varje post i den redan
 * har flyttats.
 */

import { z } from "zod";
import { openExistingDatabase } from "./idb-open";

const legacyItemSchema = z.record(z.string(), z.unknown());

/** Var den gamla listan ligger, och vilket fält som är postens id. */
export interface LegacyListLocation {
  dbName: string;
  storeName: string;
  key: string;
  idField: string;
}

/** En post ur den gamla listan med sitt id. */
export interface LegacyRecord {
  id: string;
  value: unknown;
}

/** Postens id. Saknas det → ett id ur innehållet, så att samma post alltid får samma id. */
function legacyId(value: unknown, idField: string): string {
  const parsed = legacyItemSchema.safeParse(value);
  const field = parsed.success ? parsed.data[idField] : undefined;
  return typeof field === "string" ? field : `legacy:${String(JSON.stringify(value))}`;
}

/** Den gamla listans poster med id, i ordning; dubbletter en gång. */
function legacyRecords(items: readonly unknown[], idField: string): LegacyRecord[] {
  const seen = new Set<string>();
  const records: LegacyRecord[] = [];
  for (const value of items) {
    const id = legacyId(value, idField);
    if (seen.has(id)) continue;
    seen.add(id);
    records.push({ id, value });
  }
  return records;
}

/** Värdet under nyckeln, eller `[]` om det inte är en lista. */
function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * En äldre lagring vars poster flyttas in i en `IdbEntryStore` (#1346/#1347):
 * den gamla listan, eller en äldre `IdbEntryStore` (t.ex. de gemensamma
 * databaserna från före #1347, som flyttas in i användarens egna).
 */
export interface LegacySource {
  /** Posterna med id, i ordning (tom om lagringen saknas). */
  read(): Promise<LegacyRecord[]>;
  /** Glöm posterna i `moved` — de finns nu (eller har kvitterats) i den nya lagringen. */
  clearIfMoved(moved: ReadonlySet<string>): Promise<void>;
}

export class LegacyList implements LegacySource {
  constructor(private readonly factory: IDBFactory, private readonly at: LegacyListLocation) {}

  /** Den gamla listans poster (tom om databasen, storen eller nyckeln saknas). */
  async read(): Promise<LegacyRecord[]> {
    return this.withStore<LegacyRecord[]>("readonly", (store, done) => {
      const req = store.get(this.at.key);
      req.onsuccess = () => done(legacyRecords(asList(req.result), this.at.idField));
    }, []);
  }

  /**
   * Ta bort den gamla nyckeln — men bara om varje post i den finns i `moved`.
   * En post som en gammal flik skrivit in efter läsningen ligger kvar till nästa gång.
   */
  async clearIfMoved(moved: ReadonlySet<string>): Promise<void> {
    await this.withStore<undefined>("readwrite", (store, done) => {
      const req = store.get(this.at.key);
      req.onsuccess = () => {
        const ids = legacyRecords(asList(req.result), this.at.idField).map((r) => r.id);
        if (Array.isArray(req.result) && ids.every((id) => moved.has(id))) store.delete(this.at.key);
        done(undefined);
      };
    }, undefined);
  }

  /** Kör `body` mot den gamla storen; saknas den eller går något fel → `fallback`. */
  private async withStore<V>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore, done: (value: V) => void) => void,
    fallback: V,
  ): Promise<V> {
    const db = await openExistingDatabase(this.factory, this.at.dbName);
    if (!db) return fallback;
    try {
      if (!db.objectStoreNames.contains(this.at.storeName)) return fallback;
      return await new Promise<V>((resolve) => {
        let value = fallback;
        const tx = db.transaction(this.at.storeName, mode);
        body(tx.objectStore(this.at.storeName), (v) => { value = v; });
        tx.oncomplete = () => resolve(value);
        tx.onabort = () => resolve(fallback);
      });
    } finally {
      db.close();
    }
  }
}
