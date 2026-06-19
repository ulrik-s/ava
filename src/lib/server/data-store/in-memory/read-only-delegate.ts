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

import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { AggregateArgs, Delegate, FindArgs } from "../IDataStore";
import { InMemoryQueryEngine } from "./query-engine";

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
  /**
   * "many" (default) → hydratiseras som array.
   * "one" → hydratiseras som ett enskilt objekt (första träffen) eller null.
   * Krävs för to-one-relationer som `invoice.paymentPlan`.
   */
  kind?: "one" | "many";
  /**
   * Sub-relationer på barn-entiteten. Möjliggör nested include
   * (`accontoDeductions: { include: { accontoInvoice: true } }`) och
   * nested where (`invoice: { matter: { organizationId } }`).
   */
  relations?: Record<string, RelationConfig<Record<string, unknown>>>;
}

export interface ReadOnlyDelegateOpts<T extends Record<string, unknown>> {
  /** Relations som kan inkluderas via `include: { ... }`. */
  relations?: Record<string, RelationConfig<T>>;
}

export class ReadOnlyDelegate<T extends Record<string, unknown>> implements Delegate<T> {
  private engine = new InMemoryQueryEngine<T>();

  constructor(
    private rowsFn: () => readonly T[],
    private opts: ReadOnlyDelegateOpts<T> = {},
  ) {}

  // ─── Läs-metoder ──────────────────────────────────────────────────

  async findMany(args: FindArgs<T> = {}): Promise<T[]> {
    const rows = this.queryRows(args);
    return rows.map((r) => this.hydrate(r, args.include ?? args.select));
  }

  async findFirst(args: FindArgs<T> = {}): Promise<T | null> {
    const r = this.queryRows({ ...args, take: 1 })[0] ?? null;
    return r ? this.hydrate(r, args.include ?? args.select) : null;
  }

  async findUnique(args: FindArgs<T> = {}): Promise<T | null> {
    return this.findFirst(args);
  }

  async findFirstOrThrow(args: FindArgs<T> = {}): Promise<T> {
    const r = await this.findFirst(args);
    if (!r) throw new Error("No record found");
    return r;
  }

  async findUniqueOrThrow(args: FindArgs<T> = {}): Promise<T> {
    const r = await this.findUnique(args);
    if (!r) throw new Error("No record found");
    return r;
  }

  async count(args: FindArgs<T> = {}): Promise<number> {
    return this.filterRows(this.rowsFn(), args.where).length;
  }

  /**
   * Prisma-subset av `aggregate`: `_count`, `_sum`, `_avg`, `_min`, `_max`
   * över numeriska fält. Räcker för router-användningarna (timeEntry-summor,
   * rapporter). Okända fält → 0/null.
   */
  async aggregate(args: AggregateArgs = {}): Promise<Record<string, unknown>> {
    const rows = this.filterRows(this.rowsFn(), args.where);
    const nums = (field: string) => rows.map((r) => Number((r as Record<string, unknown>)[field]) || 0);
    const out: Record<string, unknown> = {};
    if (args._count !== undefined) {
      out._count = typeof args._count === "object" ? this.fold(args._count, () => rows.length) : rows.length;
    }
    if (args._sum) out._sum = this.fold(args._sum, (f) => nums(f).reduce((s, n) => s + n, 0));
    if (args._avg) out._avg = this.fold(args._avg, (f) => (rows.length ? nums(f).reduce((s, n) => s + n, 0) / rows.length : null));
    if (args._min) out._min = this.fold(args._min, (f) => (rows.length ? Math.min(...nums(f)) : null));
    if (args._max) out._max = this.fold(args._max, (f) => (rows.length ? Math.max(...nums(f)) : null));
    return out;
  }

  private fold(spec: Record<string, true>, fn: (field: string) => number | null): Record<string, number | null> {
    const o: Record<string, number | null> = {};
    for (const field of Object.keys(spec)) o[field] = fn(field);
    return o;
  }

  /** Filtrera (med relations-prehydrering) → sortera/paginera. */
  private queryRows(args: FindArgs<T>): T[] {
    const filtered = this.filterRows(this.rowsFn(), args.where);
    return this.engine.query(filtered, omitUndefined({
      orderBy: args.orderBy,
      skip: args.skip,
      take: args.take,
    }));
  }

  /**
   * Filtrera rader på `where`. Relationer som where:t refererar
   * (t.ex. `matter: { organizationId }` eller `deductedOnFinals: { none }`)
   * prehydratiseras på en kopia så query-motorn kan matcha dem.
   */
  private filterRows(rows: readonly T[], where: Record<string, unknown> | undefined): T[] {
    if (!where) return [...rows];
    return rows.filter((r) =>
      this.engine.matches(this.hydrateWith(r, this.relations, where, "where"), where),
    );
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

  private get relations(): Record<string, RelationConfig<Record<string, unknown>>> {
    return (this.opts.relations ?? {}) as Record<string, RelationConfig<Record<string, unknown>>>;
  }

  /** Include-hydrering (+ _count). */
  private hydrate(row: T, include: Record<string, unknown> | undefined): T {
    if (!include) return row;
    const out = this.hydrateWith(row, this.relations, include, "include");
    this.applyCount(out, include);
    return out as T;
  }

  /**
   * Rekursiv relations-hydrering. Driver BÅDE include (nested barn-barn)
   * och where-prehydrering (relationer som where:t filtrerar på).
   *
   * `tree` är antingen ett include-objekt eller ett where-objekt; `mode`
   * styr hur barn-spec:en tolkas. Nycklar som inte är konfigurerade
   * relationer ignoreras (skalär-fält / `true`).
   */
  private hydrateWith(
    row: Record<string, unknown>,
    relations: Record<string, RelationConfig<Record<string, unknown>>>,
    tree: Record<string, unknown>,
    mode: "where" | "include",
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...row };
    for (const [key, spec] of Object.entries(tree)) {
      if (key === "_count" || spec === undefined || spec === false) continue;
      const rc = relations[key];
      if (rc) out[key] = this.resolveRelation(out, rc, spec, mode);
    }
    return out;
  }

  private resolveRelation(
    parent: Record<string, unknown>,
    rc: RelationConfig<Record<string, unknown>>,
    spec: unknown,
    mode: "where" | "include",
  ): unknown {
    const finalWhere = { ...rc.where(parent), ...userWhereFor(spec, mode) };
    let children = rc.collection().filter((c) => this.engine.matches(c, finalWhere));

    const subTree = subTreeFor(spec, mode);
    if (subTree && rc.relations) {
      children = children.map((c) => this.hydrateWith(c, rc.relations!, subTree, mode));
    }
    children = applyTake(children, spec, mode);
    return rc.kind === "one" ? (children[0] ?? null) : children;
  }

  /**
   * Prisma-stil `_count: { select: { rel: true } }`.
   *
   * Bug-fix: tidigare lästes bara `out[key]` (den redan-hydrerade
   * relationen). Men `_count.select.documents` betyder "räkna documents"
   * UTAN att nödvändigtvis ha include:at dem → out.documents var
   * undefined → count blev felaktigt 0 (dashboardens "0 dok / 0 tidposter").
   *
   * Nu: om relationen inte redan hydrerats, räkna den on-demand direkt
   * via relation-config + where-filter.
   */
  private applyCount(out: Record<string, unknown>, include: Record<string, unknown>): void {
    if (!isObj(include._count)) return;
    const countSpec = (include._count.select as Record<string, unknown>) ?? {};
    const counts: Record<string, number> = {};
    for (const key of Object.keys(countSpec)) {
      const existing = out[key];
      if (Array.isArray(existing)) {
        counts[key] = existing.length;
        continue;
      }
      // Ej hydrerad → räkna via relation-config (utan att mutera out)
      const rc = this.relations[key];
      if (rc) {
        counts[key] = rc.collection().filter((c) => this.engine.matches(c, rc.where(out))).length;
      } else {
        counts[key] = 0;
      }
    }
    out._count = counts;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Användar-angivet where från en include-spec ({ where: {…} }); annars tomt. */
function userWhereFor(spec: unknown, mode: "where" | "include"): Record<string, unknown> {
  if (mode !== "include" || !isObj(spec)) return {};
  return (spec.where as Record<string, unknown>) ?? {};
}

/** Begränsa barn-listan med `take` (bara i include-läge med numeriskt take). */
function applyTake(
  children: Record<string, unknown>[],
  spec: unknown,
  mode: "where" | "include",
): Record<string, unknown>[] {
  if (mode === "include" && isObj(spec) && typeof spec.take === "number") {
    return children.slice(0, spec.take);
  }
  return children;
}

/** Vilket sub-träd att rekursera ned i för nested include / nested where. */
function subTreeFor(spec: unknown, mode: "where" | "include"): Record<string, unknown> | undefined {
  if (!isObj(spec)) return undefined;
  if (mode === "include") return isObj(spec.include) ? spec.include : undefined;
  return spec; // where: spec ÄR det nästlade filtret
}
