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
 */

import { and, eq, isNull, type AnyColumn } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { AppDb } from "../db/types";
import type { Repository, RowBase } from "./types";

/** En tabell med de reconcile-kolumner bas-CRUD:n läser/skriver. */
export type VersionedTable = PgTable & Record<"id" | "deletedAt" | "version", AnyColumn>;

export class DrizzleRepository<Row extends RowBase> implements Repository<Row> {
  constructor(
    protected readonly db: AppDb,
    protected readonly table: VersionedTable,
    protected readonly now: () => Date = () => new Date(),
  ) {}

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
    return row as unknown as Row;
  }

  async update(id: string, patch: Partial<Row>): Promise<Row> {
    const current = await this.getByIdOrThrow(id);
    const [row] = await this.db.update(this.table)
      .set({ ...patch, version: nextVersion(current), updatedAt: this.now() } as never)
      .where(eq(this.table.id, id)).returning();
    return row as unknown as Row;
  }

  async softDelete(id: string): Promise<Row> {
    const current = await this.getByIdOrThrow(id);
    const [row] = await this.db.update(this.table)
      .set({ deletedAt: this.now(), version: nextVersion(current) } as never)
      .where(eq(this.table.id, id)).returning();
    return row as unknown as Row;
  }

  /** Hård delete — se `Repository.hardDelete` (medvetet ADR 0017-undantag). */
  async hardDelete(id: string): Promise<void> {
    await this.db.delete(this.table).where(eq(this.table.id, id));
  }
}

function nextVersion(row: RowBase): number {
  return (row.version ?? 1) + 1;
}
