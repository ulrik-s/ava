/**
 * `PostgresExporter` — migrationsverktyg: läser en byrås data från en
 * Postgres-databas och projicierar varje entitet till JSON-filer i
 * en git working tree.
 *
 * Användning (skript-vis):
 *   const exporter = new PostgresExporter(prisma, new NodeFileSystem(repoDir), registry);
 *   await exporter.exportOrganization(orgId);
 *   // Klart — kör `git init && git add -A && git commit && git push`
 *   // antingen via NodeGitOps eller manuellt.
 *
 * Designval (Single responsibility):
 *   - Den här klassen exporterar BARA. Den initialiserar inte git,
 *     committar inte, pushar inte. Det är skriptets ansvar.
 *
 * Designval (Open-closed):
 *   - Använder `ProjectionRegistry` så ny entitet = ny registrering,
 *     ingen ändring av export-koden.
 *   - Per-entitet-mapping mellan Postgres-delegate och projection
 *     finns i `ENTITY_FETCHERS`.
 *
 * Designval (DRY):
 *   - `exportEntity` är den enda loop som hanterar findMany +
 *     for-each-project. Skiljnad mellan entiteter är bara fetch-funktion.
 */

import type { PrismaClient } from "@prisma/client";
import type { IFileSystem } from "./file-system";
import { ProjectionWriter } from "./projection-writer";
import type { ProjectionRegistry } from "./projections/registry";

export interface ExportResult {
  organizationId: string;
  entities: Record<string, number>;
  totalCount: number;
  errors: Array<{ entity: string; id: string; error: string }>;
}

type FetchFn = (prisma: PrismaClient, organizationId: string) => Promise<unknown[]>;

/**
 * Mapping mellan entity-namn (i ProjectionRegistry) och Prisma-fetcher.
 * Nya entiteter läggs till här efter att deras projektion registrerats.
 */
const ENTITY_FETCHERS: Record<string, FetchFn> = {
  matter: (p, orgId) => p.matter.findMany({ where: { organizationId: orgId } }),
  contact: (p, orgId) => p.contact.findMany({ where: { organizationId: orgId } }),
  user: (p, orgId) => p.user.findMany({ where: { organizationId: orgId } }),
};

export class PostgresExporter {
  private writer: ProjectionWriter;

  constructor(
    private prisma: PrismaClient,
    private fs: IFileSystem,
    private registry: ProjectionRegistry,
  ) {
    this.writer = new ProjectionWriter(fs, registry);
  }

  /** Exportera all data för en byrå. */
  async exportOrganization(organizationId: string): Promise<ExportResult> {
    const result: ExportResult = {
      organizationId,
      entities: {},
      totalCount: 0,
      errors: [],
    };

    for (const entity of this.registry.entities()) {
      const fetcher = ENTITY_FETCHERS[entity];
      if (!fetcher) {
        // Entiteten är registrerad i projection-registry men har ingen
        // export-fetcher → hoppa över (kanske medvetet bara hydrate-only)
        continue;
      }
      const count = await this.exportEntity(entity, fetcher, organizationId, result);
      result.entities[entity] = count;
      result.totalCount += count;
    }

    return result;
  }

  // ── private ───────────────────────────────────────────────────

  private async exportEntity(
    entity: string,
    fetcher: FetchFn,
    organizationId: string,
    result: ExportResult,
  ): Promise<number> {
    let count = 0;
    const rows = await fetcher(this.prisma, organizationId);
    for (const row of rows) {
      try {
        await this.writer.project(entity, row);
        count++;
      } catch (err) {
        const id = (row as { id?: string }).id ?? "unknown";
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push({ entity, id, error: message });
        console.error(`[exporter] ${entity}/${id} kraschade: ${message}`);
      }
    }
    return count;
  }
}
