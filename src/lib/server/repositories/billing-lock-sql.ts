/**
 * Låsregeln i SQL (#1862) — delas av Drizzle-repona för tidsposter och utlägg
 * (samma tre kolumner). Byggs ur `BILLING_LOCK_FIELDS`, så att urvalet är
 * detsamma som `isLockedEntry` och minnesrepots `unlockedMatch` (ADR 0020).
 */

import { isNull, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { BILLING_LOCK_FIELDS, type BillingLockField } from "@/lib/shared/time-entry-lock";

/** En tabell med låsfälten och `deletedAt` (`timeEntries`, `expenses`). */
export type BillingLockTable = Record<BillingLockField | "deletedAt", AnyColumn>;

/** Villkoret "ej låst och ej raderad": alla låsfält och `deletedAt` är NULL. */
export function unlockedWhere(table: BillingLockTable): SQL {
  const conditions = [...BILLING_LOCK_FIELDS, "deletedAt" as const].map((field) => isNull(table[field]));
  return sql`(${sql.join(conditions, sql` and `)})`;
}
