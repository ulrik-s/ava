/**
 * Postgres-fel genom inslagningarna (#1380): tRPC slår in procedurens fel,
 * Drizzle drivrutinens (`DrizzleQueryError` → `PostgresError`/pglite-felet).
 * SQLSTATE-koden sitter på det innersta felet, så kedjan följs.
 */

/** Hur djupt `cause`-kedjan följs (tRPC → Drizzle → postgres). */
const MAX_CAUSE_DEPTH = 5;

/** SQLSTATE 23505: ett unikt index (t.ex. primärnyckeln) har redan värdet. */
const UNIQUE_VIOLATION = "23505";

/** Felet och dess orsaker, ytterst först. */
export function causeChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let cur = err; cur instanceof Error && chain.length < MAX_CAUSE_DEPTH; cur = cur.cause) chain.push(cur);
  return chain;
}

/** Felets egen SQLSTATE-kod, om det har en. */
export function sqlStateOf(err: unknown): string | undefined {
  const code = err instanceof Error && "code" in err ? err.code : undefined;
  return typeof code === "string" ? code : undefined;
}

/** `true` om felet, eller något i dess orsakskedja, är ett unikhetsfel (23505). */
export function isUniqueViolation(err: unknown): boolean {
  return causeChain(err).some((e) => sqlStateOf(e) === UNIQUE_VIOLATION);
}
