/**
 * `DemoRuntime` — composition root för **demo-läget** (Fas 4).
 *
 * Skiljer sig från `LocalRuntime` (Fas 3) genom att:
 *   - Det är **read-only** — UI:t kan läsa men inte skriva
 *   - Det finns ingen Prisma/SQLite — entiteterna lagras i Map<id, data>
 *     direkt i minnet, vilket är "good enough" för demo med <1000 ärenden
 *   - Det finns ingen sync — repo:t klonas en gång
 *   - Persistens via `IPersistence` är opt-in (default: ingen cache)
 *
 * Use cases:
 *   - Säljare visar AVA utan att behöva server-setup
 *   - Utvecklare snabb-iterar UI mot deterministisk demo-data
 *   - Byråer "provkör" innan de bestämmer sig
 *
 * Designval (Single responsibility):
 *   - Det här är "demo-runtime". Den vet inte om regelmotor,
 *     event-log eller writes. Read path only.
 *
 * Designval (Liskov):
 *   - Returnerar `EntityCollection<T>` per entitet — samma interface
 *     UI-komponenter kan binda emot oavsett om data kommer från demo
 *     eller från en full IDataStore.
 *
 * Designval (DI):
 *   - `cloneFn` injiceras — produktion använder en wrapper kring
 *     `isomorphic-git.clone`; tester använder en fake.
 *   - `persistence` injiceras — IndexedDbFsPersistence i browser (#483),
 *     InMemory i tester, eller utelämnas helt.
 */

import { DemoLoader, type DemoCloneFn, type LoadResult } from "./demo-loader";
import { MemFs } from "./mem-fs";
import type { IPersistence } from "./persistence";
import { buildDefaultRegistry } from "./projections/default-registry";

export type DemoStatus = "idle" | "loading" | "loaded" | "error";

export interface EntityCollection<T = unknown> {
  list(): T[];
  findById(id: string): T | null;
}

export interface DemoRuntimeDeps {
  cloneFn: DemoCloneFn;
  /**
   * Valfri persistens-backend. När satt: `loadDemo()` sparar en
   * MemFs-snapshot efter clone, och `restoreFromCache()` återställer
   * utan att klona igen. Default = ingen persistens.
   */
  persistence?: IPersistence;
}

export class DemoRuntime {
  private fs: MemFs;
  private loader: DemoLoader;
  private currentStatus: DemoStatus = "idle";
  private persistence: IPersistence | undefined;

  private constructor(deps: DemoRuntimeDeps) {
    this.fs = new MemFs();
    this.loader = new DemoLoader({
      fs: this.fs,
      registry: buildDefaultRegistry(),
      cloneFn: deps.cloneFn,
    });
    this.persistence = deps.persistence;
  }

  static create(deps: DemoRuntimeDeps): DemoRuntime {
    return new DemoRuntime(deps);
  }

  /**
   * Klona repo från `url`, hydratisera entiteter, och spara snapshot
   * via persistens-backenden om en är konfigurerad.
   */
  async loadDemo(url: string): Promise<LoadResult> {
    this.currentStatus = "loading";
    try {
      const result = await this.loader.loadDemo(url);
      this.currentStatus = "loaded";
      // Best-effort save — fel sväljs av IPersistence-impl
      if (this.persistence) {
        await this.persistence.save(this.fs.snapshot()).catch(() => {});
      }
      return result;
    } catch (err) {
      this.currentStatus = "error";
      throw err;
    }
  }

  /**
   * Återställ från persistens-cache utan att klona. Returnerar `true`
   * om cache fanns och laddades, `false` om det inte fanns något att
   * återställa (eller om persistence inte är konfigurerad).
   */
  async restoreFromCache(): Promise<boolean> {
    if (!this.persistence) return false;
    const snapshot = await this.persistence.load();
    if (!snapshot) return false;
    this.fs.restore(snapshot);
    // Hydratisera entiteterna från den återställda fs:n
    await this.loader.replaceEntitiesFromFs();
    this.currentStatus = "loaded";
    return true;
  }

  /** Rensa cachet. Nästa restoreFromCache returnerar då false. */
  async clearCache(): Promise<void> {
    if (this.persistence) await this.persistence.clear();
  }

  // ── Slab-skrivning (writable, persisterad demo) ────────────────
  // Demo-läget skriver mutationer som JSON-filer i den in-memory git-
  // working-tree:n (MemFs = "slaben under isomorphic-git") och persisterar
  // snapshot:en till OPFS. Klienten (demo-bootstrap) bygger en WriteBackFs
  // av dessa primitiver + `persist()` — så server-lagret slipper känna till
  // klient-write-back-koden (rätt import-riktning).

  /** Skriv en fil till slaben (in-memory git working tree). */
  async writeFile(path: string, data: string): Promise<void> {
    await this.fs.writeFile(path, data);
  }

  /** Radera en fil ur slaben. */
  async deleteFile(path: string): Promise<void> {
    await this.fs.deleteFile(path);
  }

  /** Persistera nuvarande slab-state (MemFs-snapshot) till persistens-backenden. */
  async persist(): Promise<void> {
    if (this.persistence) await this.persistence.save(this.fs.snapshot());
  }

  /** Läs en fil ur slaben (UTF-8). Kastar om filen saknas. */
  async readFile(path: string): Promise<string> {
    return this.fs.readFile(path);
  }

  /** Skriv binärt innehåll (PDF m.fl.) till slaben. */
  async writeFileBytes(path: string, data: Uint8Array): Promise<void> {
    await this.fs.writeBytes(path, data);
  }

  /** Läs binärt innehåll ur slaben. */
  async readFileBytes(path: string): Promise<Uint8Array> {
    return this.fs.readBytes(path);
  }

  /** Direkta barn-filnamn under `prefix` i slaben (t.ex. "documents/content"). */
  async listFiles(prefix: string): Promise<string[]> {
    return this.fs.listDir(prefix);
  }

  status(): DemoStatus {
    return this.currentStatus;
  }

  isReadOnly(): boolean {
    return true;
  }

  // ── Entity-accessorer ──────────────────────────────────────────

  matters<T = unknown>(): EntityCollection<T> {
    return this.collectionFor<T>("matter");
  }

  contacts<T = unknown>(): EntityCollection<T> {
    return this.collectionFor<T>("contact");
  }

  users<T = unknown>(): EntityCollection<T> {
    return this.collectionFor<T>("user");
  }

  /**
   * Råa hydratiserade entiteter per typ. Används av
   * `demoSourceFromRuntime()` för att bygga `DemoSource` åt
   * `DemoDataStore`. Open-closed: när fler projektioner läggs till
   * dyker de upp här utan kod-ändring.
   */
  allEntities(): Record<string, readonly unknown[]> {
    return this.loader.entities();
  }

  // ── private ───────────────────────────────────────────────────

  private collectionFor<T>(entity: string): EntityCollection<T> {
    const all = (this.loader.entities()[entity] ?? []) as T[];
    return {
      list: () => all,
      findById: (id: string) => {
        return all.find((item) => (item as { id?: string }).id === id) ?? null;
      },
    };
  }
}
