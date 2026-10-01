/**
 * Säker gräns för delta-pullen (#1381, migration 0040).
 *
 * `change_log_safe_seq()` tar publiceringslåset exklusivt en kort stund och
 * läser sekvensens senaste värde H. Varje change_log-rad med seq ≤ H är då
 * redan committad och synlig (eller borta), och varje rad som committar senare
 * får ett seq > H. Pullen läser alltså `cursor < seq ≤ H` och sätter cursorn
 * till H — men i en SENARE sats än den här, så att dess ögonblicksbild är tagen
 * efter att låset beviljades.
 *
 * Samma sats läser synkens epok (#1360, migration 0041): id:t för databasens
 * change_log-historik, som byts när en backup läses in.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { syncEpoch } from "../db/schema";
import type { AppDb } from "../db/types";

/** Var pullen står: den säkra gränsen och databasens synkepok. */
export interface PullHead {
  safe: number;
  /** `null` om epok-raden saknas (då jämförs ingen epok). */
  epoch: string | null;
}

const headRows = z.tuple([z.object({
  h: z.number().int().nonnegative(),
  epoch: z.string().uuid().nullable(),
})]);

/** Den säkra gränsen och epoken, i en sats. */
export async function readPullHead(db: AppDb): Promise<PullHead> {
  const rows = await db
    .select({
      h: sql<number>`change_log_safe_seq()`.mapWith(Number),
      epoch: sql<string | null>`(SELECT ${syncEpoch.epoch}::text FROM ${syncEpoch} LIMIT 1)`,
    })
    .from(sql`(SELECT 1) AS one`);
  const [row] = headRows.parse(rows);
  return { safe: row.h, epoch: row.epoch };
}

/** Högsta seq som pullen kan läsa utan att en lägre rad dyker upp senare. */
export async function readSafeSeq(db: AppDb): Promise<number> {
  return (await readPullHead(db)).safe;
}
