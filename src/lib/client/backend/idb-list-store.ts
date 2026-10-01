/**
 * `IndexedDbListStore` (#1243) — en lista värden under EN nyckel i IndexedDB
 * (ovanpå `IdbKv`). Klientens persistenta småköer (t.ex. uppskjutna
 * fakturadokument) använder den i stället för att öppna IndexedDB själva.
 */

import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";

/** En persistent lista: läs allt, skriv allt. */
export interface ListStore<T> {
  load(): Promise<T[]>;
  save(items: readonly T[]): Promise<void>;
}

/** Nyckeln listan ligger under. */
export const LIST_STORE_KEY = "items";

/** `ListStore` i IndexedDB. `IDBFactory` injiceras (fake-indexeddb i tester). */
export class IndexedDbListStore<T> implements ListStore<T> {
  private readonly kv: IdbKv;

  constructor(dbName: string, factory: IDBFactory = globalThis.indexedDB) {
    this.kv = new IdbKv(factory, dbName, "list");
  }

  async load(): Promise<T[]> {
    return (await this.kv.get<T[]>(LIST_STORE_KEY)) ?? [];
  }

  async save(items: readonly T[]): Promise<void> {
    await this.kv.put(LIST_STORE_KEY, [...items]);
  }
}
