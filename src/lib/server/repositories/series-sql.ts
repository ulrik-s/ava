/**
 * Löpnummerserier i SQL (#1350, #1379) — delas av fakturanumret och
 * KR-referensen. Högsta löpnumret räknas NUMERISKT över rader som är exakt
 * prefix + siffror (`seriesPattern`), och nästa nummer tilldelas under ett
 * transaktionslås per byrå och serie.
 */

import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { AppDb } from "../db/types";
import { seriesPattern } from "../number-series";

/**
 * Högsta löpnumret i serien `prefix` som tal. Drivrutinen ger bigint som
 * sträng (postgres-js) eller tal/bigint (pglite) — `Number()` vid läsning.
 * `::int` på startpositionen är nödvändig: som otypad parameter tolkas den som
 * text, och `substring(text from text)` är regex-varianten (gav alltid null).
 */
export function maxSeriesSeq(column: AnyColumn, prefix: string): SQL<string | number | bigint | null> {
  return sql<string | number | bigint | null>`max(substring(${column} from ${prefix.length + 1}::int)::bigint)`;
}

/** Villkoret "kolumnen är ett nummer i serien `prefix`" (prefix + bara siffror). */
export function inSeries(column: AnyColumn, prefix: string): SQL {
  return sql`${column} ~ ${seriesPattern(prefix)}`;
}

/**
 * Ett nummer i taget per byrå och serie: låset hålls till transaktionens slut,
 * så två samtidiga tilldelningar inte läser samma "senaste" nummer.
 */
export async function lockSeries(db: AppDb, key: string): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}
