/**
 * `ReadOnlyDelegate<T>` — en in-memory implementation av Prisma's
 * delegate-API (subset) som backas av en JS-array.
 *
 * Designval:
 *   - Mutations (create/update/delete/*) kastar `ReadOnlyError` — så
 *     UI:t i demo-läge får tydlig signal istället för tyst no-op.
 *   - Relations via `include` resolveras via en injicerad relations-map
 *     (Single responsibility: delegate vet inte om andra entiteter).
 *
 * Detta är *inte* en full Prisma-emulering. Vi täcker det subset som
 * routrarna använder. Vid behov utökas dictionariet.
 *
 * Cast-strategi: Prisma's egna delegate-typer är extremt komplex generic.
 * Vi exponerar metoderna med signaturer som matchar Prisma's API
 * *strukturellt* — konsumenter kan `as unknown as MatterDelegate` när
 * de bygger `DemoDataStore`.
 */

import { InMemoryQueryEngine, type QueryOptions } from "./query-engine";

export class ReadOnlyError extends Error {
  constructor(operation: string) {
    super(`Demo-läget är read-only — kan inte köra "${operation}". Registrera dig för att redigera.`);
    this.name = "ReadOnlyError";
  }
}

export interface RelationConfig<TParent> {
  /** Resolver som returnerar barn-collectionen. */
  collection: () => readonly Record<string, unknown>[];
  /** Bygger where-filter för barn baserat på parent. */
  where: (parent: TParent) => Record<string, unknown>;
}

export interface ReadOnlyDelegateOpts<T extends Record<string, unknown>> {
  /** Relations som kan inkluderas via `include: { ... }`. */
  relations?: Record<string, RelationConfig<T>>;
}

export interface FindArgs {
  where?: Record<string, unknown>;
  orderBy?: QueryOptions["orderBy"];
  skip?: number;
  take?: number;
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
}

export class ReadOnlyDelegate<T extends Record<string, unknown>> {
  private engine = new InMemoryQueryEngine<T>();

  constructor(
    private rowsFn: () => readonly T[],
    private opts: ReadOnlyDelegateOpts<T> = {},
  ) {}

  // ─── Läs-metoder ──────────────────────────────────────────────────

  async findMany(args: FindArgs = {}): Promise<T[]> {
    const rows = this.engine.query(this.rowsFn(), args);
    return rows.map((r) => this.hydrateRelations(r, args.include));
  }

  async findFirst(args: FindArgs = {}): Promise<T | null> {
    const r = this.engine.findFirst(this.rowsFn(), args);
    return r ? this.hydrateRelations(r, args.include) : null;
  }

  async findUnique(args: FindArgs = {}): Promise<T | null> {
    const r = this.engine.findUnique(this.rowsFn(), args);
    return r ? this.hydrateRelations(r, args.include) : null;
  }

  async findFirstOrThrow(args: FindArgs = {}): Promise<T> {
    const r = await this.findFirst(args);
    if (!r) throw new Error("No record found");
    return r;
  }

  async findUniqueOrThrow(args: FindArgs = {}): Promise<T> {
    const r = await this.findUnique(args);
    if (!r) throw new Error("No record found");
    return r;
  }

  async count(args: FindArgs = {}): Promise<number> {
    return this.engine.count(this.rowsFn(), args);
  }

  // ─── Mutationer — alla kastar ─────────────────────────────────────

  async create(_args: unknown): Promise<never> { throw new ReadOnlyError("create"); }
  async createMany(_args: unknown): Promise<never> { throw new ReadOnlyError("createMany"); }
  async update(_args: unknown): Promise<never> { throw new ReadOnlyError("update"); }
  async updateMany(_args: unknown): Promise<never> { throw new ReadOnlyError("updateMany"); }
  async delete(_args: unknown): Promise<never> { throw new ReadOnlyError("delete"); }
  async deleteMany(_args?: unknown): Promise<never> { throw new ReadOnlyError("deleteMany"); }
  async upsert(_args: unknown): Promise<never> { throw new ReadOnlyError("upsert"); }

  // ─── Privat: relations-hydrering ─────────────────────────────────

  private hydrateRelations(row: T, include: Record<string, unknown> | undefined): T {
    if (!include) return row;
    const out: Record<string, unknown> = { ...row };
    if (this.opts.relations) {
      for (const [relName, relConfig] of Object.entries(this.opts.relations)) {
        const includeSpec = include[relName];
        if (!includeSpec) continue;
        const all = relConfig.collection();
        const where = relConfig.where(row);
        const filtered = all.filter((r) => this.matchWhere(r, where));
        out[relName] = filtered;
      }
    }
    // Prisma-stil `_count: { select: { rel1: true, rel2: true } }`.
    // I demo har vi inte alla relationer hydratiserade → returnera 0
    // per nyckel. Bättre än TypeError vid `row._count.rel.length`.
    if (include._count && typeof include._count === "object") {
      const countSpec = (include._count as { select?: Record<string, unknown> }).select ?? {};
      const counts: Record<string, number> = {};
      for (const key of Object.keys(countSpec)) {
        // Om relationen är hydratiserad ovan, räkna ur den;
        // annars 0 (demo har sällan dessa).
        const r = (out as Record<string, unknown>)[key];
        counts[key] = Array.isArray(r) ? r.length : 0;
      }
      out._count = counts;
    }
    return out as T;
  }

  private matchWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (row[k] !== v) return false;
    }
    return true;
  }
}
