/**
 * `InMemoryRepository` (ADR 0020, #409 Fas 1) — bas för in-memory-entitets-
 * repositories (browser/demo/offline). Delegerar till en befintlig `IDataStore`-
 * `Delegate` (dvs `LocalStore`/query-engine, #412) så vi INTE återimplementerar
 * query-motorn — den blir bara intern i st.f. den exponerade sömmen.
 *
 * Centraliserar reconcile-konventionerna: `create` sätter `version=1`, `update`
 * bumpar `version` + `updatedAt`, `softDelete` sätter `deletedAt` (tombstone).
 */

import type { Delegate } from "../data-store/IDataStore";
import type { Repository, RowBase } from "./types";

export class InMemoryRepository<Row extends RowBase> implements Repository<Row> {
  constructor(
    protected readonly delegate: Delegate,
    /** Injicerbar klocka för deterministiska tester. */
    protected readonly now: () => Date = () => new Date(),
  ) {}

  /** Hämta icke-mjukraderad rad (frånvarande `deletedAt` = ej raderad). */
  async getById(id: Row["id"]): Promise<Row | null> {
    const row = (await this.delegate.findFirst({ where: { id } })) as Row | null;
    return row && !row.deletedAt ? row : null;
  }

  async getByIdOrThrow(id: Row["id"]): Promise<Row> {
    const row = await this.getById(id);
    if (!row) throw new Error(`Ingen rad med id ${id}`);
    return row;
  }

  async create(data: Partial<Row>): Promise<Row> {
    return (await this.delegate.create({ data: { version: 1, ...data } as Partial<Row> })) as Row;
  }

  async update(id: Row["id"], patch: Partial<Row>): Promise<Row> {
    const current = await this.getByIdOrThrow(id);
    const data = { ...patch, version: (current.version ?? 1) + 1, updatedAt: this.now() } as Partial<Row>;
    return (await this.delegate.update({ where: { id }, data })) as Row;
  }

  /** Metadata-skrivning utan version-bump (se `Repository.updateMetadata`). */
  async updateMetadata(id: Row["id"], patch: Partial<Row>): Promise<Row> {
    await this.getByIdOrThrow(id);
    const data = { ...patch, updatedAt: this.now() } as Partial<Row>;
    return (await this.delegate.update({ where: { id }, data })) as Row;
  }

  async softDelete(id: Row["id"]): Promise<Row> {
    const current = await this.getByIdOrThrow(id);
    const data = { deletedAt: this.now(), version: (current.version ?? 1) + 1 } as Partial<Row>;
    return (await this.delegate.update({ where: { id }, data })) as Row;
  }

  /** Hård delete — se `Repository.hardDelete` (medvetet ADR 0017-undantag). */
  async hardDelete(id: Row["id"]): Promise<void> {
    await this.delegate.delete({ where: { id } });
  }
}
