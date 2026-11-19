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
 * Flera flikar (#1714): alla flikar delar snapshotet, och sista skrivningen
 * vinner. Bredvid snapshotet sparas därför märken för de köade ändringar det
 * bär (`snapshot-marks.ts`): en flik som sparar bär över raderna för en annan
 * fliks köade poster, och en ny flik läser om raderna för poster som redan
 * avgjorts. Kräver att fliken kopplas (`attach`).
 *
 * Bygger på den generiska `IdbKv` (#413) så open/get/put inte dupliceras.
 * `IDBFactory` injiceras (default `globalThis.indexedDB`) → testbar via
 * fake-indexeddb.
 */

import type { DemoSource } from "@/lib/shared/demo-source";
import { syncPositionSchema, type SyncPositionHolder } from "./cursor-store";
import { IdbKv, type KvEntries } from "./idb-kv";
import {
  assertNotNewer, LOCAL_DATA_MIGRATIONS, LOCAL_DATA_VERSION, migrateLocalSnapshot, type LocalDataMigration,
} from "./local-data-format";
import type { LocalStorePersistence } from "./local-store-persistence";
import {
  carryRows, NO_MARKS, parseMarks, planCarry, type CarryPlan, type SnapshotMarks, type SnapshotTab,
} from "./snapshot-marks";

const DB_NAME = "ava-local-store";
const STORE = "source";
const KEY = "current";
/** Formatet snapshotet skrevs i (#1269). Saknas → före #1269, format 1. */
const VERSION_KEY = "format";
/** Synkpositionen snapshotet motsvarar (#1711). Saknas → synken börjar från 0. */
const POSITION_KEY = "sync";

/** Märkena för de köade ändringar snapshotet bär (#1714). Saknas → före #1714. */
const MARKS_KEY = "marks";

export class IndexedDbPersistence implements LocalStorePersistence {
  private readonly kv: IdbKv;
  private tab: SnapshotTab | undefined;

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

  /** Fliken vars köade ändringar snapshotet märks med (#1714). */
  attach(tab: SnapshotTab): void {
    this.tab = tab;
  }

  /**
   * Läs snapshotet i dagens format (#1269). Ett äldre lyfts och sparas; ett
   * nyare kastar `LocalDataTooNewError` utan att skriva något. Snapshot,
   * format, synkposition (#1711) och märken (#1714) läses i EN transaktion.
   */
  async hydrate(): Promise<DemoSource | null> {
    const [stored, version, position, marks] = await this.kv.getAll([KEY, VERSION_KEY, POSITION_KEY, MARKS_KEY]);
    if (!stored) return null;
    const { source, migrated } = migrateLocalSnapshot(
      stored, typeof version === "number" ? version : null, this.format.migrations, this.format.version,
    );
    this.restorePosition(position);
    this.tab?.adopt(parseMarks(marks));
    if (migrated) await this.save(source);
    return source;
  }

  /** Fortsätt från snapshotets position; en saknad eller trasig post = från 0. */
  private restorePosition(stored: unknown): void {
    const parsed = syncPositionSchema.safeParse(stored);
    this.sync?.restore(parsed.success ? parsed.data : { cursor: 0 });
  }

  /**
   * Spara flikens källa utan att skriva över en annan fliks köade ändringar
   * (#1714). Märker det lagrade snapshotet poster fliken inte känner igen läses
   * kön om, och sparningen görs en gång till: först då går det att skilja en
   * annan fliks nya post (raderna bärs över) från en avgjord (de bärs inte över).
   */
  async save(source: DemoSource): Promise<void> {
    const unknown = await this.write(source, null);
    if (unknown.length === 0) return;
    await this.tab?.refresh();
    await this.write(source, new Set(unknown));
  }

  /**
   * Snapshot, formatversion, märken och synkposition skrivs i EN transaktion
   * (#1362, #1711, #1714): ett avbrott mellan dem lämnade förr ett migrerat
   * snapshot märkt med det gamla formatet. Har en nyare version av appen (en
   * annan flik) hunnit spara sitt format skrivs ingenting över —
   * `LocalDataTooNewError` i stället. Märken och position läses i samma
   * ögonblick som raderna klonas, så de beskriver just de raderna.
   * Svarar med de märkta poster fliken inte känner igen; då skrevs ingenting.
   */
  private async write(source: DemoSource, settled: ReadonlySet<string> | null): Promise<string[]> {
    const version = this.format.version;
    let unknown: string[] = [];
    await this.kv.update([VERSION_KEY, MARKS_KEY], ([storedVersion, storedMarks]) => {
      assertNotNewer(storedVersion, version);
      const mine = this.tab?.marks() ?? NO_MARKS;
      const plan = this.plan(storedMarks, mine, settled);
      unknown = plan.unknown;
      if (unknown.length > 0) return [];
      const marks: SnapshotMarks = { pending: [...mine.pending, ...plan.carried], owed: mine.owed };
      const entries = (rows: DemoSource): KvEntries => [[KEY, rows], [VERSION_KEY, version], [MARKS_KEY, marks], ...this.positionEntry()];
      if (plan.rows.length === 0) return entries(source);
      return { keys: [KEY], next: ([stored]) => entries(carryRows(source, stored, plan.rows)) };
    });
    return unknown;
  }

  /** Utan flik (tester, demo) bärs ingenting över: källan sparas som den är. */
  private plan(storedMarks: unknown, mine: SnapshotMarks, settled: ReadonlySet<string> | null): CarryPlan {
    const tab = this.tab;
    if (!tab) return { unknown: [], carried: [], rows: [] };
    return planCarry(parseMarks(storedMarks) ?? NO_MARKS, mine, (id) => tab.position(id), settled);
  }

  private positionEntry(): KvEntries {
    return this.sync ? [[POSITION_KEY, this.sync.position()]] : [];
  }
}
