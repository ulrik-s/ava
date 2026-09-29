/**
 * IndexedDB-adapter för `LocalStorePersistence` (#412, ADR 0016) — den
 * persisterade offline-cachens lagring i browsern. Hela `DemoSource` lagras
 * strukturklonad under en nyckel (Date-fält bevaras av structured clone).
 *
 * Bygger på den generiska `IdbKv` (#413) så open/get/put inte dupliceras.
 * `IDBFactory` injiceras (default `globalThis.indexedDB`) → testbar via
 * fake-indexeddb.
 */

import type { DemoSource } from "@/lib/shared/demo-source";
import { IdbKv } from "./idb-kv";
import { LOCAL_DATA_MIGRATIONS, LOCAL_DATA_VERSION, migrateLocalSnapshot, type LocalDataMigration } from "./local-data-format";
import type { LocalStorePersistence } from "./local-store-persistence";

const DB_NAME = "ava-local-store";
const STORE = "source";
const KEY = "current";
/** Formatet snapshotet skrevs i (#1269). Saknas → före #1269, format 1. */
const VERSION_KEY = "format";

export class IndexedDbPersistence implements LocalStorePersistence {
  private readonly kv: IdbKv;

  constructor(
    factory: IDBFactory = globalThis.indexedDB,
    dbName: string = DB_NAME,
    /** Formatversion + migreringar (#1269); injicerbara i tester. */
    private readonly format: { version: number; migrations: Readonly<Record<number, LocalDataMigration>> } =
      { version: LOCAL_DATA_VERSION, migrations: LOCAL_DATA_MIGRATIONS },
  ) {
    this.kv = new IdbKv(factory, dbName, STORE);
  }

  /**
   * Läs snapshotet i dagens format (#1269). Ett äldre lyfts och sparas; ett
   * nyare kastar `LocalDataTooNewError` utan att skriva något.
   */
  async hydrate(): Promise<DemoSource | null> {
    const stored = await this.kv.get<DemoSource>(KEY);
    if (!stored) return null;
    const { source, migrated } = migrateLocalSnapshot(
      stored, await this.kv.get<number>(VERSION_KEY), this.format.migrations, this.format.version,
    );
    if (migrated) await this.save(source);
    return source;
  }

  async save(source: DemoSource): Promise<void> {
    await this.kv.put(KEY, source);
    await this.kv.put(VERSION_KEY, this.format.version);
  }
}
