/**
 * Svensk ordning i en Drizzle-fråga (#1917). Postgres sorterar annars i
 * databasens kollation — byteordning (C) i pglite och Alpine-imagen, där Ä
 * kommer före Å och gemener efter Ö. Minnesrepot sorterar med
 * `Intl.Collator("sv")`; båda sidor ska ge samma lista.
 *
 * `sv-x-icu` är Postgres fördefinierade ICU-kollation för svenska (CLDR, samma
 * ordning som `Intl.Collator("sv")`), som `initdb` lägger i `pg_catalog` när
 * Postgres är byggt med ICU. Ordningen ligger kvar i SQL, så `limit`/`offset`
 * ger rätt sidor. Använd den för varje namnsorterad lista i Drizzle-repona.
 */

import { type AnyColumn, type SQL, sql } from "drizzle-orm";

/** Namnet på Postgres fördefinierade svenska ICU-kollation. */
export const SWEDISH_COLLATION = "sv-x-icu";

/** `column collate "sv-x-icu"` — för `orderBy(asc(...))` eller direkt i `orderBy`. */
export function swedishOrder(column: AnyColumn): SQL {
  return sql`${column} collate ${sql.identifier(SWEDISH_COLLATION)}`;
}
