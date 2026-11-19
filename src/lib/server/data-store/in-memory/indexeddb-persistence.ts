/**
 * IndexedDB-adapter för `LocalStorePersistence` (#412, ADR 0016) — den
 * persisterade offline-cachens lagring i browsern. Hela `DemoSource` lagras
 * strukturklonad under en nyckel (Date-fält bevaras av structured clone).
 *
 * Synkpositionen (#1711): med en `SyncPositionHolder` sparas flikens cursor och
 * epok i SAMMA transaktion som snapshotet, och läses i samma transaktion vid
 * start. Positionen på disk hör då alltid till snapshotet bredvid — också när
 * flera flikar delar lagringen och den sista skrivningen vinner: den som
 * skriver sist skriver sina egna rader OCH sin egen position. Saknas
 * snapshotet läses ingen position (synken börjar från 0).
 *
 * Bygger på den generiska `IdbKv` (#413) så open/get/put inte dupliceras.
 * `IDBFactory` injiceras (default `globalThis.indexedDB`) → testbar via
 * fake-indexeddb.
 */

import type { DemoSource } from "@/lib/shared/demo-source";
import { syncPositionSchema, type SyncPositionHolder } from "./cursor-store";
import { IdbKv } from "./idb-kv";
import {
  assertNotNewer, LOCAL_DATA_MIGRATIONS, LOCAL_DATA_VERSION, migrateLocalSnapshot, type LocalDataMigration,
} from "./local-data-format";
import type { LocalStorePersistence } from "./local-store-persistence";

const DB_NAME = "ava-local-store";
const STORE = "source";
const KEY = "current";
/** Formatet snapshotet skrevs i (#1269). Saknas → före #1269, format 1. */
const VERSION_KEY = "format";
/** Synkpositionen snapshotet motsvarar (#1711). Saknas → synken börjar från 0. */
const POSITION_KEY = "sync";

export class IndexedDbPersistence implements LocalStorePersistence {
  private readonly kv: IdbKv;

  constructor(
    factory: IDBFactory = globalThis.indexedDB,
    dbName: string = DB_NAME,
    /** Formatversion + migreringar (#1269); injicerbara i tester. */
    private readonly format: { version: number; migrations: Readonly<Record<number, LocalDataMigration>> } =
      { version: LOCAL_DATA_VERSION, migrations: LOCAL_DATA_MIGRATIONS },
    /** Flikens synkposition (#1711), sparad och läst tillsammans med snapshotet. */
    private readonly sync?: SyncPositionHolder,
  ) {
    this.kv = new IdbKv(factory, dbName, STORE);
  }

  /**
   * Läs snapshotet i dagens format (#1269). Ett äldre lyfts och sparas; ett
   * nyare kastar `LocalDataTooNewError` utan att skriva något. Snapshot,
   * format och synkposition läses i EN transaktion (#1711).
   */
  async hydrate(): Promise<DemoSource | null> {
    const [stored, version, position] = await this.kv.getAll([KEY, VERSION_KEY, POSITION_KEY]);
    if (!stored) return null;
    const { source, migrated } = migrateLocalSnapshot(
      stored, typeof version === "number" ? version : null, this.format.migrations, this.format.version,
    );
    this.restorePosition(position);
    if (migrated) await this.save(source);
    return source;
  }

  /** Fortsätt från snapshotets position; en saknad eller trasig post = från 0. */
  private restorePosition(stored: unknown): void {
    const parsed = syncPositionSchema.safeParse(stored);
    this.sync?.restore(parsed.success ? parsed.data : { cursor: 0 });
  }

  /**
   * Snapshot och formatversion skrivs i EN transaktion (#1362): ett avbrott
   * mellan dem lämnade förr ett migrerat snapshot märkt med det gamla formatet.
   * Har en nyare version av appen (en annan flik) hunnit spara sitt format
   * skrivs ingenting över — `LocalDataTooNewError` i stället. Flikens
   * synkposition (#1711) följer med i samma transaktion. Den läses HÄR, före
   * skrivningen: raderna klonas senare, så positionen är aldrig före dem.
   */
  async save(source: DemoSource): Promise<void> {
    const version = this.format.version;
    const position: ReadonlyArray<readonly [string, unknown]> = this.sync ? [[POSITION_KEY, this.sync.position()]] : [];
    await this.kv.putAll([[KEY, source], [VERSION_KEY, version], ...position], {
      key: VERSION_KEY,
      check: (stored) => assertNotNewer(stored, version),
    });
  }
}
