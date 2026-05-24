/**
 * `InMemoryQueryEngine<T>` — Prisma-subset som tolkar `where`/`orderBy`/
 * `skip`/`take` mot en array istället för SQL.
 *
 * Syfte: möjliggör att `IDataStore` kan implementeras mot in-memory data
 * (demo-läget) med samma operator-stöd som routrarna förväntar sig från
 * en riktig Prisma-delegate.
 *
 * Designval (Single responsibility):
 *   - Bara query-evaluering. Ingen lagring, ingen mutation.
 *
 * Designval (begränsad subset):
 *   - Vi stödjer bara de operatorer som faktiskt används i routrarna
 *     (kartlagt via grep). Lägg till nya operatorer när de behövs och
 *     skriv ett test först.
 *
 * Stödda operatorer:
 *   - Where: equals (implicit), contains (mode insensitive), startsWith,
 *     in, gte/lte/gt/lt, not, OR, AND
 *   - OrderBy: { field: "asc" | "desc" } eller array av samma
 *   - Pagination: skip, take
 *
 * Ej stödda (kastar / tigande ignoreras):
 *   - some/none/every på relations — hanteras separat av delegate-laget
 *     eftersom de kräver kunskap om relationsdata
 *   - distinct — relevant för Postgres-aggregations
 *   - select/include — hanteras separat eftersom de behöver relations
 */

export type SortDir = "asc" | "desc";

export interface QueryOptions {
  where?: Record<string, unknown>;
  orderBy?: Record<string, SortDir> | Array<Record<string, SortDir>>;
  skip?: number;
  take?: number;
}

export class InMemoryQueryEngine<T extends Record<string, unknown>> {
  /**
   * Returnerar en filtrerad, sorterad och paginerad kopia av input-arrayen.
   * Muterar inte inputen.
   */
  query(rows: readonly T[], opts: QueryOptions = {}): T[] {
    let out = opts.where ? rows.filter((r) => this.matches(r, opts.where!)) : [...rows];
    if (opts.orderBy) out = this.sort(out, opts.orderBy);
    if (opts.skip) out = out.slice(opts.skip);
    if (opts.take !== undefined) out = out.slice(0, opts.take);
    return out;
  }

  count(rows: readonly T[], opts: QueryOptions = {}): number {
    if (!opts.where) return rows.length;
    return rows.filter((r) => this.matches(r, opts.where!)).length;
  }

  findFirst(rows: readonly T[], opts: QueryOptions = {}): T | null {
    return this.query(rows, { ...opts, take: 1 })[0] ?? null;
  }

  findUnique(rows: readonly T[], opts: QueryOptions = {}): T | null {
    return this.findFirst(rows, opts);
  }

  // ─── Where-matching ────────────────────────────────────────────────

  /** Publik så delegate-lagret kan matcha en (relations-hydratiserad) rad. */
  matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [key, val] of Object.entries(where)) {
      if (val === undefined) continue;
      if (key === "OR") {
        const arr = val as Array<Record<string, unknown>>;
        if (!arr.some((sub) => this.matches(row, sub))) return false;
        continue;
      }
      if (key === "AND") {
        const arr = val as Array<Record<string, unknown>>;
        if (!arr.every((sub) => this.matches(row, sub))) return false;
        continue;
      }
      if (!this.fieldMatches(row[key], val)) return false;
    }
    return true;
  }

  private fieldMatches(fieldVal: unknown, expected: unknown): boolean {
    // Primitiv likhet
    if (expected === null || typeof expected !== "object" || expected instanceof Date) {
      return this.eq(fieldVal, expected);
    }
    const op = expected as Record<string, unknown>;
    const keys = Object.keys(op);
    // Operator-objekt om ALLA nycklar är kända operatorer ({ in }, { gte }…).
    // Annars: nested relations-filter ({ matter: { organizationId } }).
    const isOperatorObj =
      keys.length > 0 && keys.every((k) => k === "mode" || k in this.ops);
    if (!isOperatorObj) {
      // To-one relation: rekursera ned i det nästlade objektet.
      if (fieldVal && typeof fieldVal === "object" && !Array.isArray(fieldVal)) {
        return this.matches(fieldVal as Record<string, unknown>, op);
      }
      return false;
    }
    const ci = op.mode === "insensitive";
    for (const [opName, opVal] of Object.entries(op)) {
      if (opName === "mode") continue;
      if (!this.applyOp(fieldVal, opName, opVal, ci)) return false;
    }
    return true;
  }

  /**
   * Operator-tabell (dispatch) — håller `applyOp` på komplexitet 1 och gör
   * det trivialt att lägga till operatorer. Arrow-fns sluter över `this`
   * för åtkomst till eq/cmp/matches.
   */
  private readonly ops: Record<string, (fieldVal: unknown, opVal: unknown, ci: boolean) => boolean> = {
    equals: (f, v) => this.eq(f, v),
    not: (f, v) => !this.eq(f, v),
    contains: (f, v, ci) => this.strOp(f, v, ci, (a, b) => a.includes(b)),
    startsWith: (f, v, ci) => this.strOp(f, v, ci, (a, b) => a.startsWith(b)),
    endsWith: (f, v, ci) => this.strOp(f, v, ci, (a, b) => a.endsWith(b)),
    in: (f, v) => Array.isArray(v) && v.some((x) => this.eq(f, x)),
    notIn: (f, v) => Array.isArray(v) && !v.some((x) => this.eq(f, x)),
    gte: (f, v) => this.cmp(f, v) >= 0,
    lte: (f, v) => this.cmp(f, v) <= 0,
    gt: (f, v) => this.cmp(f, v) > 0,
    lt: (f, v) => this.cmp(f, v) < 0,
    // Relations-count-filter på en (ev. hydratiserad) array.
    some: (f, v) => Array.isArray(f) && f.some((el) => this.matchesRel(el, v)),
    none: (f, v) => !Array.isArray(f) || !f.some((el) => this.matchesRel(el, v)),
    every: (f, v) => !Array.isArray(f) || f.every((el) => this.matchesRel(el, v)),
  };

  private applyOp(fieldVal: unknown, op: string, opVal: unknown, ci: boolean): boolean {
    const fn = this.ops[op];
    return fn ? fn(fieldVal, opVal, ci) : false;
  }

  private strOp(
    fieldVal: unknown,
    opVal: unknown,
    ci: boolean,
    cmp: (a: string, b: string) => boolean,
  ): boolean {
    if (typeof fieldVal !== "string" || typeof opVal !== "string") return false;
    return ci ? cmp(fieldVal.toLowerCase(), opVal.toLowerCase()) : cmp(fieldVal, opVal);
  }

  private matchesRel(el: unknown, where: unknown): boolean {
    return this.matches(el as Record<string, unknown>, (where ?? {}) as Record<string, unknown>);
  }

  private eq(a: unknown, b: unknown): boolean {
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    // Prisma-semantik: null och undefined likställs (saknad kolumn = null).
    if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
    return a === b;
  }

  private cmp(a: unknown, b: unknown): number {
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
    return 0;
  }

  // ─── OrderBy ──────────────────────────────────────────────────────

  private sort(rows: T[], orderBy: QueryOptions["orderBy"]): T[] {
    const clauses = Array.isArray(orderBy) ? orderBy : [orderBy!];
    return [...rows].sort((a, b) => {
      for (const clause of clauses) {
        for (const [field, dir] of Object.entries(clause)) {
          const cmpRes = this.cmp(a[field], b[field]);
          if (cmpRes !== 0) return dir === "desc" ? -cmpRes : cmpRes;
        }
      }
      return 0;
    });
  }
}
