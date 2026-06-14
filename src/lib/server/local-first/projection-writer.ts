/**
 * `ProjectionWriter` och `ProjectionHydrator` — paret som binder samman
 * SQLite-skrivningar och JSON-projektioner i git working tree.
 *
 * Två riktningar:
 *
 *   `ProjectionWriter`        (write-through)
 *      Router → Prisma-write → JSON-file
 *   `ProjectionHydrator`      (hydrate-on-pull)
 *      Git fetch → ändrade filer → SQLite upsert via callback
 *
 * Designval (Single Responsibility):
 *   - `ProjectionWriter` skriver bara till fs. Den känner inte till
 *     git eller commit:s — det är högre lagers ansvar (LocalGitStore).
 *   - `ProjectionHydrator` läser bara från fs och callback:ar. Den
 *     vet inget om Prisma eller hur man uppdaterar SQLite — den
 *     producerar (entity, data)-par för callern att hantera.
 *
 * Designval (DRY):
 *   - Bägge klasserna delar `ProjectionRegistry` så att registrering av
 *     ny entitet räcker en gång och fungerar i bägge riktningar.
 */

import { migrateRawJson } from "@/lib/shared/schema-migrations";
import { CURRENT_SCHEMA_VERSION } from "@/lib/shared/schema-version";
import type { IFileSystem } from "./file-system";
import type { ProjectionRegistry } from "./projections/registry";

export class ProjectionWriter {
  constructor(
    private fs: IFileSystem,
    private registry: ProjectionRegistry,
  ) {}

  /**
   * Skriv entitet till sin projicerade path. Overwrites om filen fanns.
   * Existerande "gamla path" (t.ex. innan arkivering) städas INTE — det
   * är hydrate/migration:s ansvar.
   */
  async project<T>(entity: string, data: T): Promise<string> {
    const entry = this.registry.forEntity<T>(entity);
    if (!entry) throw new Error(`Unknown entity in projection registry: ${entity}`);
    const path = entry.projection.pathFor(data);
    await this.fs.writeFile(path, entry.projection.serialize(data));
    return path;
  }

  /** Radera entitetens projicerade fil. No-op om filen saknas. */
  async remove<T>(entity: string, data: T): Promise<void> {
    const entry = this.registry.forEntity<T>(entity);
    if (!entry) throw new Error(`Unknown entity in projection registry: ${entity}`);
    const path = entry.projection.pathFor(data);
    await this.fs.deleteFile(path);
  }
}

export type HydrateCallback = (entity: string, data: unknown, path: string) => void | Promise<void>;

export interface HydrateResult {
  entity: string;
  data: unknown;
  path: string;
}

export class ProjectionHydrator {
  /**
   * @param repoSchemaVersion repots datamodell-version (ADR 0004). Rader lyfts
   *   migrate-on-read från den upp till {@link CURRENT_SCHEMA_VERSION} före
   *   parse. Default = CURRENT (ingen migration — för call-sites som hydrerar
   *   data skriven av nuvarande kod, t.ex. live-sync).
   */
  constructor(
    private fs: IFileSystem,
    private registry: ProjectionRegistry,
    private repoSchemaVersion: number = CURRENT_SCHEMA_VERSION,
  ) {}

  /**
   * Läs en fil och deserialisera den via matchande projektion. Returnerar
   * null om:
   *   - filen saknas
   *   - ingen projektion matchar path
   * Kastar om filen finns men inte parsar (korrupt JSON eller schema-fel).
   */
  async hydratePath(path: string): Promise<HydrateResult | null> {
    const entry = this.registry.matchPath(path);
    if (!entry) return null;
    if (!(await this.fs.exists(path))) return null;
    const raw = await this.fs.readFile(path);
    // Migrate-on-read (ADR 0004): lyft rå-raden till aktuell datamodell FÖRE
    // deserialize — annars skulle `mergeRawAfterParse` flätta tillbaka de
    // borttagna legacy-fälten från rå-json:en.
    const migrated = migrateRawJson(entry.entity, raw, this.repoSchemaVersion);
    const data = entry.projection.deserialize(migrated);
    return { entity: entry.entity, data, path };
  }

  /**
   * Hydrate alla filer i alla registrerade entiteters paths.
   * För Fas 3:s initial-laddning eller full-sync.
   *
   * Notering: vi scanner inte alla möjliga paths — för det skulle vi
   * behöva en `listAllPaths` på projektionen. Istället låter vi
   * `LocalGitStore` ge oss en *konkret* path-lista via git ls-tree
   * eller `IFileSystem.listDir` recursive scan.
   */
  async hydrateAll(callback: HydrateCallback): Promise<number> {
    let count = 0;
    for (const entity of this.registry.entities()) {
      // Snabb scan via känd struktur — full recursive listing kommer
      // när vi behöver den. För nu täcker vi de fasta prefixen:
      const candidates = await this.scanCandidatePaths(entity);
      for (const path of candidates) {
        const result = await this.hydratePath(path);
        if (result) {
          await callback(result.entity, result.data, result.path);
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Hydrate en explicit lista av path-strings. Vanligaste call-site:
   * när git fetch returnerar en diff av ändrade filer.
   */
  async hydrateChanges(paths: string[], callback: HydrateCallback): Promise<number> {
    let count = 0;
    for (const path of paths) {
      const result = await this.hydratePath(path);
      if (result) {
        await callback(result.entity, result.data, result.path);
        count++;
      }
    }
    return count;
  }

  // ── private ───────────────────────────────────────────────────

  /**
   * Hitta troliga paths för en entitet. För matter scannar vi
   * `matters/active/*.json` och `matters/archive/<år>/*.json`.
   *
   * Detta är heuristik baserad på dagens projektioner. En framtida
   * version kan be projektionen själv lista sina paths via en valfri
   * `listOwnedPaths(fs)`-method.
   */
  private async scanCandidatePaths(entity: string): Promise<string[]> {
    // Trycker först på en helt allmän heuristik via registry-prefix.
    // Vi sniffar via några vanliga path-prefix per entitet.
    const prefixes: Record<string, string[]> = {
      matter: ["matters/active"],
      contact: ["contacts"],
      user: [".ava/users"],
    };
    const dirs = prefixes[entity] ?? [];
    const found: string[] = [];
    for (const dir of dirs) {
      const items = await this.fs.listDir(dir);
      for (const item of items) {
        if (item.endsWith(".json")) found.push(`${dir}/${item}`);
      }
    }
    return found;
  }
}
