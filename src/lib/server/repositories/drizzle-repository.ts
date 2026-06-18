/**
 * `DrizzleRepository` (ADR 0020, #409 Fas 2 — fan-out-fundament) — server-bas
 * för entitets-repositories, motsvarigheten till `InMemoryRepository`. Ärver
 * bas-CRUD (getById/create/update/softDelete) så varje entitets-repo bara lägger
 * sina TYPADE relations-/list-metoder, utan att duplicera reconcile-konventionerna.
 *
 * Centraliserar reconcile-app-nivå (ADR 0019): create→version 1, update→
 * version-bump + updatedAt, softDelete→deletedAt (tombstone). Casterna vid
 * Drizzle-gränsen (`as never` på values/set, `as unknown` på resultat) är
 * medvetna: Drizzles rad-typ och zod-typen skiljer sig; strikt zod-parse vid
 * gränsen läggs som delad helper i ett senare steg.
 *
 * Change-log (ADR 0019 beslut 4): `enableChangeLog` slår på append till
 * `change_log` per accepterad skrivning (driver delta-sync:ens pull). Opt-in så
 * paritetstester/icke-sync-kontext inte påverkas; entitetsnamnet härleds ur
 * tabellnamnet. Bara org-scopade rader loggas (change_log är per-org).
 */

import { and, eq, getTableName, isNull, type AnyColumn } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { ENTITY_NAME_BY_SOURCE_KEY } from "../data-store/in-memory/entity-source-keys";
import type { AppDb } from "../db/types";
import type { ChangeLogRecorder, ChangeOp } from "./change-log-recorder";
import type { Repository, RowBase } from "./types";

/** En tabell med de reconcile-kolumner bas-CRUD:n läser/skriver. */
export type VersionedTable = PgTable & Record<"id" | "deletedAt" | "version", AnyColumn>;

export class DrizzleRepository<Row extends RowBase> implements Repository<Row> {
  private changeLog?: ChangeLogRecorder;

  constructor(
    protected readonly db: AppDb,
    protected readonly table: VersionedTable,
    protected readonly now: () => Date = () => new Date(),
  ) {}

  /** Slå på change_log-append för denna repo (server-sync-vägen). */
  enableChangeLog(recorder: ChangeLogRecorder): void {
    this.changeLog = recorder;
  }

  async getById(id: string): Promise<Row | null> {
    const rows = await this.db
      .select().from(this.table)
      .where(and(eq(this.table.id, id), isNull(this.table.deletedAt))).limit(1);
    return (rows[0] as unknown as Row | undefined) ?? null;
  }

  async getByIdOrThrow(id: string): Promise<Row> {
    const row = await this.getById(id);
    if (!row) throw new Error(`Ingen rad med id ${id}`);
    return row;
  }

  async create(data: Partial<Row>): Promise<Row> {
    const [row] = await this.db.insert(this.table)
      .values({ ...data, version: 1 } as never).returning();
    await this.logChange(row, "create");
    return row as unknown as Row;
  }

  async update(id: string, patch: Partial<Row>): Promise<Row> {
    const current = await this.getByIdOrThrow(id);
    const [row] = await this.db.update(this.table)
      .set({ ...patch, version: nextVersion(current), updatedAt: this.now() } as never)
      .where(eq(this.table.id, id)).returning();
    await this.logChange(row, "update");
    return row as unknown as Row;
  }

  async softDelete(id: string): Promise<Row> {
    const current = await this.getByIdOrThrow(id);
    const [row] = await this.db.update(this.table)
      .set({ deletedAt: this.now(), version: nextVersion(current) } as never)
      .where(eq(this.table.id, id)).returning();
    await this.logChange(row, "delete");
    return row as unknown as Row;
  }

  /** Hård delete — se `Repository.hardDelete` (medvetet ADR 0017-undantag). */
  async hardDelete(id: string): Promise<void> {
    await this.db.delete(this.table).where(eq(this.table.id, id));
  }

  /**
   * Org-id för en rad (för change_log). Default: rad-kolumnen. Override:as av
   * matter-scopade org-lösa entiteter (document/documentFolder, #528) som
   * härleder org via ärendet — annars loggas de aldrig → delta-synkas ej.
   */
  protected resolveOrg(row: unknown): Promise<string | undefined> | string | undefined {
    return (row as { organizationId?: string }).organizationId;
  }

  /** Append en change_log-rad om loggning är på och org kunde härledas. */
  private async logChange(row: unknown, op: ChangeOp): Promise<void> {
    if (!this.changeLog) return;
    const r = row as { id?: string; version?: number };
    const organizationId = await this.resolveOrg(row);
    if (!r.id || !organizationId) return; // utan org kan raden inte delta-synkas
    // getTableName ger snake_case (`document_folders`); ENTITY_NAME_BY_SOURCE_KEY
    // är keyat på camelCase source-key (`documentFolders`). Konvertera, annars
    // får fler-ords-tabeller fel entitetsnamn → klientens apply känner ej igen dem.
    const tableName = getTableName(this.table);
    const sourceKey = tableName.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
    await this.changeLog.record({
      organizationId,
      entity: ENTITY_NAME_BY_SOURCE_KEY[sourceKey] ?? ENTITY_NAME_BY_SOURCE_KEY[tableName] ?? tableName,
      rowId: r.id,
      version: r.version ?? 1,
      op,
    });
  }
}

function nextVersion(row: RowBase): number {
  return (row.version ?? 1) + 1;
}
