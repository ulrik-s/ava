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
  /**
   * Sätts till true första gången OPFS visar sig oanvändbart. Vissa
   * webbläsare (t.ex. Firefox med blockerad/raderad site-data eller strikt
   * spårningsskydd) exponerar `navigator.storage.getDirectory` men kastar
   * `SecurityError` när den anropas. Efter det första felet blir alla
   * vidare anrop tysta no-ops — en best-effort-cache ska aldrig spamma
   * konsolloggen (och därmed felrapporten) med upprepade varningar.
   */
  private unusable = false;

  constructor(private readonly key: string) {
    if (!key || /[/\\]/.test(key)) {
      throw new Error(`OpfsPersistence: ogiltig key "${key}"`);
    }
  }

  /**
   * Kolla om aktuell runtime *faktiskt* stödjer OPFS. Det räcker inte att
   * `getDirectory` finns — den måste gå att anropa utan att kasta (Firefox
   * kastar SecurityError när site-data är blockerad). Vi probar därför på
   * riktigt istället för att bara typkolla funktionen.
   */
  static async isSupported(): Promise<boolean> {
    const nav = (globalThis as { navigator?: NavigatorWithStorage }).navigator;
    if (typeof nav?.storage?.getDirectory !== "function") return false;
    try {
      await nav.storage.getDirectory();
      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<FsSnapshot | null> {
    if (this.unusable) return null;
    try {
      const dir = await this.getKeyDir();
      const file = await dir.getFileHandle(FILE_NAME);
      const content = await (await file.getFile()).text();
      return JSON.parse(content) as FsSnapshot;
    } catch (err) {
      // Filen finns inte, OPFS stödjs inte, eller JSON kunde inte parsas.
      // För en cache är "ingen data" rätt fallback. Om felet beror på att
      // OPFS är otillgängligt markeras instansen så vidare anrop no-op:ar.
      this.markUnusableIfOpfsBlocked(err);
      return null;
    }
  }

  async save(snapshot: FsSnapshot): Promise<void> {
    if (this.unusable) return;
    try {
      const dir = await this.getKeyDir();
      const file = await dir.getFileHandle(FILE_NAME, { create: true });
      const writable = await file.createWritable();
      await writable.write(JSON.stringify(snapshot));
      await writable.close();
    } catch (err) {
      // Persistens är best-effort. Om OPFS inte fungerar ska appen
      // ändå funka — bara utan offline-cache.
      this.markUnusableIfOpfsBlocked(err);
    }
  }

  async clear(): Promise<void> {
    if (this.unusable) return;
    try {
      const dir = await this.getKeyDir();
      await dir.removeEntry(FILE_NAME);
    } catch {
      // Ingen att rensa — OK.
    }
  }

  // ── private ───────────────────────────────────────────────────

  /**
   * Avgör om felet betyder att OPFS är otillgängligt (snarare än "filen
   * fanns inte"). I så fall: logga EN gång och markera instansen som
   * oanvändbar så att efterföljande save/load/clear blir tysta no-ops.
   *
   * Heuristik: SecurityError eller "OPFS stöds inte"-felet från getKeyDir
   * betyder blockerad/saknad OPFS. Andra fel (t.ex. en saknad fil) lämnar
   * cachen aktiv — det är ett normalt "ingen data ännu"-utfall.
   */
  private markUnusableIfOpfsBlocked(err: unknown): void {
    if (this.unusable) return;
    const name = (err as { name?: string })?.name;
    const isBlocked =
      name === "SecurityError" ||
      (err instanceof Error && err.message.includes("OPFS stöds inte"));
    if (!isBlocked) return;
    this.unusable = true;
    // Informativ, en gång: detta är ett väntat degraderat läge, inte ett
    // appfel. Demon kör vidare i minnesläge (ändringar sparas ej över reload).
    console.info(
      "[OpfsPersistence] OPFS ej tillgängligt i denna webbläsare/läge — " +
        "fortsätter i minnesläge (ändringar sparas inte över omladdning).",
    );
  }

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
