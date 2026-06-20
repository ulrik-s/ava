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
    super(() => wopts.collection() as readonly T[], wopts.relations !== undefined ? { relations: wopts.relations } : {});
  }

  /** Aktuell array — hämtas på begäran så DataStore kan byta ut den. */
  private get collection(): T[] {
    return this.wopts.collection();
  }

  override async create(args: unknown): Promise<never> {
    const a = args as { data: Partial<T> };
    const id = (a.data as { id?: string }).id ?? (this.wopts.generateId ?? genId)();
    // Bygg raden som Record<string, unknown> (T extends den) → `as T` blir en
    // enkel boundary-cast i st.f. en double-cast. Runtime-fullständigheten
    // garanteras av routern (Partial<T> + id/timestamps).
    const built: Record<string, unknown> = {
      ...a.data,
      id,
      createdAt: (a.data as { createdAt?: Date }).createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    const row = built as T;
    this.collection.push(row);
    const enriched = this.wopts.enrichRow ? this.wopts.enrichRow(row) : row;
    // Skriv tillbaka enriched-row så framtida read:s ser pre-bakade joins
    const idx = this.collection.findIndex((r) => (r as { id?: string }).id === id);
    if (idx >= 0) this.collection[idx] = enriched;
    await this.wopts.onMutate?.({ entity: this.wopts.entity, kind: "create", row: enriched });
    return enriched as never;
  }

  override async update(args: unknown): Promise<never> {
    const a = args as { where: { id: string }; data: Partial<T> };
    const idx = this.collection.findIndex((r) => (r as { id?: string }).id === a.where.id);
    const current = this.collection[idx];
    if (idx < 0 || current === undefined) throw new Error(`Hittade inte ${this.wopts.entity} med id=${a.where.id}`);
    const prev = { ...current };
    const updated = { ...current, ...a.data, updatedAt: new Date() } as T;
    const enriched = this.wopts.enrichRow ? this.wopts.enrichRow(updated) : updated;
    this.collection[idx] = enriched;
    await this.wopts.onMutate?.({ entity: this.wopts.entity, kind: "update", row: enriched, previous: prev });
    return enriched as never;
  }

  override async delete(args: unknown): Promise<never> {
    const a = args as { where: { id: string } };
    const idx = this.collection.findIndex((r) => (r as { id?: string }).id === a.where.id);
    const removed = this.collection[idx];
    if (idx < 0 || removed === undefined) throw new Error(`Hittade inte ${this.wopts.entity} med id=${a.where.id}`);
    this.collection.splice(idx, 1);
    await this.wopts.onMutate?.({ entity: this.wopts.entity, kind: "delete", row: removed });
    return removed as never;
  }

  override async updateMany(args: unknown): Promise<never> {
    const a = args as { where?: Record<string, unknown>; data: Partial<T> };
    const matches = await this.findMany(a.where !== undefined ? { where: a.where } : {});
    let count = 0;
    for (const m of matches) {
      await this.update({ where: { id: m.id as string }, data: a.data });
      count++;
    }
    return { count } as never;
  }
}
