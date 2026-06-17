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
 */

import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";
import { fsSnapshotSchema, type FsSnapshot, type IPersistence } from "./persistence";

const STORE = "fs";
const KEY = "snapshot";

export class IndexedDbFsPersistence implements IPersistence {
  private readonly kv: IdbKv;

  constructor(
    key: string,
    factory: IDBFactory = (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB,
  ) {
    if (!key) throw new Error(`IndexedDbFsPersistence: ogiltig key "${key}"`);
    this.kv = new IdbKv(factory, key, STORE);
  }

  async load(): Promise<FsSnapshot | null> {
    const raw = await this.kv.get<unknown>(KEY);
    if (raw == null) return null;
    // Zod vid parsegränsen (#187): validera formen innan den lämnar lagret.
    const parsed = fsSnapshotSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  async save(snapshot: FsSnapshot): Promise<void> {
    await this.kv.put(KEY, snapshot);
  }

  async clear(): Promise<void> {
    await this.kv.delete(KEY);
  }
}
