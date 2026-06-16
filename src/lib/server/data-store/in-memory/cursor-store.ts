/**
 * `CursorStore` (ADR 0017, #414) — persisterar offline-klientens delta-sync-
 * cursor (serverns senaste sedda position). In-memory för tester/demo,
 * IndexedDB (via `IdbKv`) i browsern.
 */

import { IdbKv } from "./idb-kv";

export interface CursorStore {
  get(): Promise<number>;
  set(cursor: number): Promise<void>;
}

export class InMemoryCursorStore implements CursorStore {
  constructor(private cursor = 0) {}
  async get(): Promise<number> {
    return this.cursor;
  }
  async set(cursor: number): Promise<void> {
    this.cursor = cursor;
  }
}

export class IndexedDbCursorStore implements CursorStore {
  private readonly kv: IdbKv;
  constructor(
    factory: IDBFactory = (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB,
    dbName = "ava-sync-cursor",
  ) {
    this.kv = new IdbKv(factory, dbName, "cursor");
  }
  async get(): Promise<number> {
    return (await this.kv.get<number>("current")) ?? 0;
  }
  async set(cursor: number): Promise<void> {
    await this.kv.put("current", cursor);
  }
}
