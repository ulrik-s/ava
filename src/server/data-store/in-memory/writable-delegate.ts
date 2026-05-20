/**
 * `WritableDelegate` — utökar `ReadOnlyDelegate` med mutation-stöd.
 *
 * Designval (Single responsibility):
 *   - Bara CRUD mot in-memory source-array. Persistens-side-effect
 *     (skriva till FSA) sköts av en `onMutate`-callback som
 *     injiceras av DataStore:n.
 *
 * Designval (Liskov):
 *   - Samma metoder som Prisma's MatterDelegate etc. — kan bytas in
 *     i routrarnas `ctx.dataStore.matters.create()` utan att routern
 *     vet att den jobbar mot in-memory snarare än Prisma.
 *
 * `MutationKind` skickas till callback:n så DataStore vet om filen
 * ska skrivas (create/update) eller raderas (delete).
 */

import { ReadOnlyDelegate, type RelationConfig } from "./read-only-delegate";

export type MutationKind = "create" | "update" | "delete";

export interface MutationEvent<T> {
  entity: string;
  kind: MutationKind;
  row: T;
  previous?: T;
}

export interface WritableDelegateOpts<T> {
  /** Vilken entitet detta är (för callback-tagging). */
  entity: string;
  /**
   * Getter för aktuell collection. Vi använder getter så att
   * DataStore kan byta ut sin source-array (t.ex. när demo-data
   * laddas in) utan att delegaten tappar referensen.
   */
  collection: () => T[];
  /** Optional relations (samma format som ReadOnlyDelegate). */
  relations?: Record<string, RelationConfig<T>>;
  /** Callback efter varje mutation — DataStore använder den för FSA-write. */
  onMutate?: (event: MutationEvent<T>) => void | Promise<void>;
  /** Generate nytt id om input saknar det. */
  generateId?: () => string;
  /**
   * Optional row-enricher. Anropas efter att en row sparas i
   * collection:en — får tillbaka en row med pre-bakade joins
   * (t.ex. .contact, .matter). Används av DemoDataStore för
   * att hålla mutation-resultat konsistent med find*-output.
   */
  enrichRow?: (row: T) => T;
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class WritableDelegate<T extends Record<string, unknown>> extends ReadOnlyDelegate<T> {
  constructor(private wopts: WritableDelegateOpts<T>) {
    super(() => wopts.collection() as readonly T[], { relations: wopts.relations });
  }

  /** Aktuell array — hämtas på begäran så DataStore kan byta ut den. */
  private get collection(): T[] {
    return this.wopts.collection();
  }

  async create(args: unknown): Promise<never> {
    const a = args as { data: Partial<T> };
    const id = (a.data as { id?: string }).id ?? (this.wopts.generateId ?? genId)();
    const row = {
      ...a.data,
      id,
      createdAt: (a.data as { createdAt?: Date }).createdAt ?? new Date(),
      updatedAt: new Date(),
    } as unknown as T;
    this.collection.push(row);
    const enriched = this.wopts.enrichRow ? this.wopts.enrichRow(row) : row;
    // Skriv tillbaka enriched-row så framtida read:s ser pre-bakade joins
    const idx = this.collection.findIndex((r) => (r as { id?: string }).id === id);
    if (idx >= 0) this.collection[idx] = enriched;
    await this.wopts.onMutate?.({ entity: this.wopts.entity, kind: "create", row: enriched });
    return enriched as never;
  }

  async update(args: unknown): Promise<never> {
    const a = args as { where: { id: string }; data: Partial<T> };
    const idx = this.collection.findIndex((r) => (r as { id?: string }).id === a.where.id);
    if (idx < 0) throw new Error(`Hittade inte ${this.wopts.entity} med id=${a.where.id}`);
    const prev = { ...this.collection[idx] };
    const updated = { ...this.collection[idx], ...a.data, updatedAt: new Date() } as T;
    const enriched = this.wopts.enrichRow ? this.wopts.enrichRow(updated) : updated;
    this.collection[idx] = enriched;
    await this.wopts.onMutate?.({ entity: this.wopts.entity, kind: "update", row: enriched, previous: prev });
    return enriched as never;
  }

  async delete(args: unknown): Promise<never> {
    const a = args as { where: { id: string } };
    const idx = this.collection.findIndex((r) => (r as { id?: string }).id === a.where.id);
    if (idx < 0) throw new Error(`Hittade inte ${this.wopts.entity} med id=${a.where.id}`);
    const removed = this.collection[idx];
    this.collection.splice(idx, 1);
    await this.wopts.onMutate?.({ entity: this.wopts.entity, kind: "delete", row: removed });
    return removed as never;
  }

  async deleteMany(args: unknown): Promise<never> {
    const a = args as { where?: Record<string, unknown> };
    const matches = await this.findMany({ where: a.where });
    let count = 0;
    for (const m of matches) {
      await this.delete({ where: { id: (m as unknown as { id: string }).id } });
      count++;
    }
    return { count } as never;
  }

  async upsert(args: unknown): Promise<never> {
    const a = args as { where: { id: string }; create: Partial<T>; update: Partial<T> };
    const existing = await this.findUnique({ where: { id: a.where.id } });
    const result = existing
      ? await this.update({ where: a.where, data: a.update })
      : await this.create({ data: { ...a.create, id: a.where.id } as Partial<T> });
    return result as never;
  }
}
