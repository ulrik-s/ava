/**
 * `IndexedDbFsPersistence` (#3, ADR 0016) — `IPersistence`-backend som lagrar
 * `DemoRuntime`s MemFs-snapshot i **IndexedDB** i st.f. OPFS. Det är så
 * GH-Pages-demon "populerar cachen med demo-data": hela slab-snapshotten (data
 * + genererade dokument + extraherad text) persisteras till IndexedDB, så demon
 * överlever reload utan OPFS.
 *
 * Återanvänder den generiska `IdbKv` (#413). `IDBFactory` injiceras (test via
 * fake-indexeddb). dbName = demo-cache-nyckeln (versionas av
 * NEXT_PUBLIC_DEMO_VERSION) → ny deploy bustar cachen.
 *
 * **Best-effort (som OpfsPersistence):** om IndexedDB är blockerat (privat läge,
 * strikt spårningsskydd) markeras instansen oanvändbar vid första felet och
 * alla vidare anrop blir tysta no-ops — demon kör vidare i minnesläge i st.f.
 * att krascha bootstrappen (`DemoRuntime.persist()` kastar annars vidare).
 */

import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";
import { fsSnapshotSchema, type FsSnapshot, type IPersistence } from "./persistence";

const STORE = "fs";
const KEY = "snapshot";

export class IndexedDbFsPersistence implements IPersistence {
  private readonly kv: IdbKv;
  /** Sätts vid första IndexedDB-felet → vidare anrop no-op:ar (best-effort-cache). */
  private unusable = false;

  constructor(
    key: string,
    factory: IDBFactory = (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB,
  ) {
    if (!key) throw new Error(`IndexedDbFsPersistence: ogiltig key "${key}"`);
    this.kv = new IdbKv(factory, key, STORE);
  }

  async load(): Promise<FsSnapshot | null> {
    if (this.unusable) return null;
    try {
      const raw = await this.kv.get<unknown>(KEY);
      if (raw == null) return null;
      // Zod vid parsegränsen (#187): validera formen innan den lämnar lagret.
      const parsed = fsSnapshotSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    } catch (err) {
      this.markUnusable(err);
      return null;
    }
  }

  async save(snapshot: FsSnapshot): Promise<void> {
    if (this.unusable) return;
    try {
      await this.kv.put(KEY, snapshot);
    } catch (err) {
      this.markUnusable(err);
    }
  }

  async clear(): Promise<void> {
    if (this.unusable) return;
    try {
      await this.kv.delete(KEY);
    } catch (err) {
      this.markUnusable(err);
    }
  }

  /** Logga EN gång och no-op:a vidare — IndexedDB blockerat är väntat degraderat
   *  läge, inte ett appfel (demon kör vidare i minnesläge). */
  private markUnusable(_err: unknown): void {
    if (this.unusable) return;
    this.unusable = true;
    console.info(
      "[IndexedDbFsPersistence] IndexedDB ej tillgängligt — fortsätter i minnesläge " +
        "(ändringar sparas inte över omladdning).",
    );
  }
}
