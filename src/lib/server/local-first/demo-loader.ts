/**
 * `DemoLoader` — klonar ett offentligt git-repo (typiskt GitHub) som
 * innehåller en byrås demo-data, hydratiserar entiteterna och
 * exponerar dem som en in-memory snapshot.
 *
 * Användningsfall:
 *   - Demo-byrå för säljare som visar AVA utan att behöva en server
 *   - Sandlåda för utvecklare som testar nya UI-komponenter
 *   - Provkörning för byråer som funderar på om de vill köra AVA
 *
 * Designval (Single responsibility):
 *   - Klassen klonar + hydratiserar. Den lagrar INTE skrivningar tillbaka,
 *     emittar INTE events. Demo-läget är read-only.
 *
 * Designval (Dependency inversion):
 *   - `cloneFn` injiceras → tester använder en fake-clone som direkt
 *     skriver test-data till fs:n. Produktion använder
 *     `isomorphic-git.clone()` mot HTTPS.
 *   - `registry` injiceras → tester kan använda subsets om de vill.
 *
 * Designval (DRY):
 *   - Hydrate-fasen återanvänder `ProjectionHydrator.hydrateAll` så samma
 *     code path som production sync-loopen.
 */

import type { MemFs } from "./mem-fs";
import { ProjectionHydrator } from "./projection-writer";
import type { ProjectionRegistry } from "./projections/registry";
import { ENTITY_REGISTRY } from "@/lib/shared/schemas";

export type DemoCloneFn = (fs: MemFs, url: string) => Promise<void>;

export interface DemoLoaderDeps {
  fs: MemFs;
  registry: ProjectionRegistry;
  /**
   * Faktisk clone-implementation. I produktion typiskt en wrapper kring
   * `isomorphic-git.clone({ http, url, dir, ...})`.
   */
  cloneFn: DemoCloneFn;
}

export interface LoadResult {
  url: string;
  entities: Record<string, number>;
  totalCount: number;
  errors: Array<{ path: string; error: string }>;
}

export class DemoLoader {
  private hydrated: Map<string, unknown[]> = new Map();

  constructor(private deps: DemoLoaderDeps) {}

  /**
   * Klona repo och hydratisera alla entiteter.
   * Idempotent — fler anrop ersätter tidigare snapshot.
   */
  // eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Async method 'loadDemo' has a complexity of 10. Maximum allowed is 8.)
  async loadDemo(url: string): Promise<LoadResult> {
    // Reset state — flera ladd-anrop ger fresh data
    await this.clearFs();
    this.hydrated.clear();

    await this.deps.cloneFn(this.deps.fs, url);

    const hydrator = new ProjectionHydrator(this.deps.fs, this.deps.registry);
    const result: LoadResult = { url, entities: {}, totalCount: 0, errors: [] };

    // Per-path hydration: fel på en fil hoppas över och loggas, andra
    // filer fortsätter att hydratiseras. Bygger på samma path-prefix-
    // konvention som production-hydrator.
    for (const entity of this.deps.registry.entities()) {
      for (const prefix of this.knownPrefixes(entity)) {
        const items = await this.deps.fs.listDir(prefix);
        for (const item of items) {
          if (!item.endsWith(".json")) continue;
          const path = `${prefix}/${item}`;
          try {
            const r = await hydrator.hydratePath(path);
            if (!r) continue;
            if (!this.hydrated.has(r.entity)) this.hydrated.set(r.entity, []);
            this.hydrated.get(r.entity)!.push(r.data);
            result.entities[r.entity] = (result.entities[r.entity] ?? 0) + 1;
            result.totalCount += 1;
          } catch (err) {
            result.errors.push({ path, error: err instanceof Error ? err.message : String(err) });
            console.error(`[demo-loader] kunde inte hydratisera ${path}:`, err);
          }
        }
      }
    }

    return result;
  }

  /** Returnera hydratiserade entiteter per typ. */
  entities(): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {};
    for (const [entity, list] of this.hydrated) out[entity] = list;
    return out;
  }

  /**
   * Re-hydratisera entiteterna från fs:n utan att klona igen. Används
   * av `DemoRuntime.restoreFromCache()` efter en persistens-restore.
   */
  async replaceEntitiesFromFs(): Promise<void> {
    this.hydrated.clear();
    const { ProjectionHydrator } = await import("./projection-writer");
    const hydrator = new ProjectionHydrator(this.deps.fs, this.deps.registry);
    for (const entity of this.deps.registry.entities()) {
      for (const prefix of this.knownPrefixes(entity)) {
        const items = await this.deps.fs.listDir(prefix);
        for (const item of items) {
          if (!item.endsWith(".json")) continue;
          const path = `${prefix}/${item}`;
          try {
            const r = await hydrator.hydratePath(path);
            if (!r) continue;
            if (!this.hydrated.has(r.entity)) this.hydrated.set(r.entity, []);
            this.hydrated.get(r.entity)!.push(r.data);
          } catch {
            // Korrupta filer i cache — hoppa över
          }
        }
      }
    }
  }

  // ── interna ──────────────────────────────────────────────────

  private async clearFs(): Promise<void> {
    // Rensa allt — ny demo-laddning ska inte ärva tidigare data
    const all = await this.deps.fs.listDir("");
    for (const top of all) {
      await this.deleteRecursive(top);
    }
  }

  private async deleteRecursive(path: string): Promise<void> {
    if (await this.deps.fs.exists(path)) {
      await this.deps.fs.deleteFile(path);
      return;
    }
    const children = await this.deps.fs.listDir(path);
    for (const c of children) {
      await this.deleteRecursive(`${path}/${c}`);
    }
  }

  private knownPrefixes(entity: string): string[] {
    // Härled scan-prefix:et ur ENTITY_REGISTRY (single source of truth för
    // "vart skrivs varje entitet"). Tidigare en hårdkodad dubblett-karta som
    // upprepade gånger glömdes vid nya entiteter (kalender, billing-runs …) →
    // de hydrerades aldrig vid restore ("Inga billingruns ännu"). Open-closed:
    // en ny entitet i registry:t + en registrerad projection räcker nu.
    const entry = (ENTITY_REGISTRY as Record<string, { gitPrefix?: string }>)[entity];
    return entry?.gitPrefix ? [entry.gitPrefix] : [];
  }
}
