/**
 * Säker gräns för delta-pullen (#1381, migration 0040).
 *
 * `change_log_safe_seq()` tar publiceringslåset exklusivt en kort stund och
 * läser sekvensens senaste värde H. Varje change_log-rad med seq ≤ H är då
 * redan committad och synlig (eller borta), och varje rad som committar senare
 * får ett seq > H. Pullen läser alltså `cursor < seq ≤ H` och sätter cursorn
 * till H — men i en SENARE sats än den här, så att dess ögonblicksbild är tagen
 * efter att låset beviljades.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "../db/types";

const safeSeqRows = z.tuple([z.object({ h: z.number().int().nonnegative() })]);

/** Högsta seq som pullen kan läsa utan att en lägre rad dyker upp senare. */
export async function readSafeSeq(db: AppDb): Promise<number> {
  const rows = await db
    .select({ h: sql<number>`change_log_safe_seq()`.mapWith(Number) })
    .from(sql`(SELECT 1) AS one`);
  const [row] = safeSeqRows.parse(rows);
  return row.h;
}
