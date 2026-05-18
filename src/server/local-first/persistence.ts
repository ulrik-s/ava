/**
 * `IPersistence` — abstraktion för persistent storage av MemFs-snapshot:s.
 *
 * Designval (Open-closed + Liskov):
 *   - Smalt interface — bara save/load/clear av en JSON-serialiserbar
 *     `Record<string, string>` (base64-buffrar, en per fil-path).
 *   - Ny backend = ny klass som implementerar interfacet. Inga
 *     ändringar i konsumenterna.
 *
 * Implementationer:
 *   - `InMemoryPersistence`: bara minne. För tester och fallback.
 *   - `OpfsPersistence`: Origin Private File System i browser. Survivar
 *     page-reload, är persistent per origin, kvotgräns ~quotaSize.
 *   - (Framtid) `IndexedDBPersistence` om vi behöver bredare browser-stöd.
 */

export type FsSnapshot = Record<string, string>;

export interface IPersistence {
  /** Returnera tidigare sparad snapshot, eller null om inget finns. */
  load(): Promise<FsSnapshot | null>;
  /** Skriv över persistent state med given snapshot. */
  save(snapshot: FsSnapshot): Promise<void>;
  /** Radera persistent state. */
  clear(): Promise<void>;
}

// ─── InMemoryPersistence ──────────────────────────────────────────

export class InMemoryPersistence implements IPersistence {
  private snapshot: FsSnapshot | null = null;

  async load(): Promise<FsSnapshot | null> {
    return this.snapshot ? { ...this.snapshot } : null;
  }

  async save(snapshot: FsSnapshot): Promise<void> {
    this.snapshot = { ...snapshot };
  }

  async clear(): Promise<void> {
    this.snapshot = null;
  }
}

// ─── OpfsPersistence ──────────────────────────────────────────────

interface OpfsDirHandle {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>;
  removeEntry(name: string): Promise<void>;
}

interface OpfsFileHandle {
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{ write(content: string): Promise<void>; close(): Promise<void> }>;
}

interface NavigatorWithStorage {
  storage?: { getDirectory(): Promise<OpfsDirHandle> };
}

const FILE_NAME = "snapshot.json";

/**
 * `OpfsPersistence` — sparar snapshot till en JSON-fil i Origin Private
 * File System. Varje key (typiskt en GitHub-URL eller demo-id) får sin
 * egen sub-katalog så att flera demos inte krockar.
 */
export class OpfsPersistence implements IPersistence {
  constructor(private readonly key: string) {
    if (!key || /[/\\]/.test(key)) {
      throw new Error(`OpfsPersistence: ogiltig key "${key}"`);
    }
  }

  /** Kolla om aktuell runtime stödjer OPFS. */
  static async isSupported(): Promise<boolean> {
    const nav = (globalThis as { navigator?: NavigatorWithStorage }).navigator;
    return typeof nav?.storage?.getDirectory === "function";
  }

  async load(): Promise<FsSnapshot | null> {
    try {
      const dir = await this.getKeyDir();
      const file = await dir.getFileHandle(FILE_NAME);
      const content = await (await file.getFile()).text();
      return JSON.parse(content) as FsSnapshot;
    } catch {
      // Filen finns inte, OPFS stödjs inte, eller JSON kunde inte parsas.
      // För en cache är "ingen data" rätt fallback.
      return null;
    }
  }

  async save(snapshot: FsSnapshot): Promise<void> {
    try {
      const dir = await this.getKeyDir();
      const file = await dir.getFileHandle(FILE_NAME, { create: true });
      const writable = await file.createWritable();
      await writable.write(JSON.stringify(snapshot));
      await writable.close();
    } catch (err) {
      // Persistens är best-effort. Om OPFS inte fungerar ska appen
      // ändå funka — bara utan offline-cache.
      console.warn("[OpfsPersistence] save misslyckades:", err);
    }
  }

  async clear(): Promise<void> {
    try {
      const dir = await this.getKeyDir();
      await dir.removeEntry(FILE_NAME);
    } catch {
      // Ingen att rensa — OK.
    }
  }

  // ── private ───────────────────────────────────────────────────

  private async getKeyDir(): Promise<OpfsDirHandle> {
    const nav = (globalThis as { navigator?: NavigatorWithStorage }).navigator;
    if (!nav?.storage?.getDirectory) {
      throw new Error("OPFS stöds inte i denna runtime");
    }
    const root = await nav.storage.getDirectory();
    // Vissa OPFS-impl stödjer create:true på getDirectoryHandle. Vi
    // skapar bara en fil per key med key-prefix istället för en under-mapp
    // — det funkar i alla OPFS-impl och är tillräckligt för cache.
    return {
      async getFileHandle(name: string, options?: { create?: boolean }) {
        return root.getFileHandle(`${this.keyPrefix}__${name}`, options);
      },
      async removeEntry(name: string) {
        return root.removeEntry(`${this.keyPrefix}__${name}`);
      },
      keyPrefix: this.sanitizeKey(this.key),
    } as OpfsDirHandle & { keyPrefix: string };
  }

  private sanitizeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9._-]/g, "_");
  }
}
