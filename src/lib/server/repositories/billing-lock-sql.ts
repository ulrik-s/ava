/**
 * Låsregeln i SQL (#1862) — delas av Drizzle-repona för tidsposter och utlägg
 * (samma tre kolumner). Byggs ur `BILLING_LOCK_FIELDS`, så att urvalet är
 * detsamma som `isLockedEntry` och minnesrepots `unlockedMatch` (ADR 0020).
 */

import { and, eq, inArray, isNull, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { BILLING_LOCK_FIELDS, type BillingLockField, type InvoiceRelease } from "@/lib/shared/time-entry-lock";

/** En tabell med låsfälten och `deletedAt` (`timeEntries`, `expenses`). */
export type BillingLockTable = Record<BillingLockField | "deletedAt", AnyColumn>;

/** Villkoret "ej låst och ej raderad": alla låsfält och `deletedAt` är NULL. */
export function unlockedWhere(table: BillingLockTable): SQL {
  const conditions = [...BILLING_LOCK_FIELDS, "deletedAt" as const].map((field) => isNull(table[field]));
  return sql`(${sql.join(conditions, sql` and `)})`;
}

/**
 * Posterna vars frysning ett släpp av fakturan nollar (#2260): frysta av en
 * släppt körning och inte kopplade till en annan faktura. Samma regel som
 * `releasePatch`; `undefined` när inga körningar släpps.
 */
export function releasedFreezeWhere(table: BillingLockTable, r: InvoiceRelease): SQL | undefined {
  if (r.billingRunIds.length === 0) return undefined;
  return and(
    inArray(table.frozenByBillingRunId, [...r.billingRunIds]),
    or(isNull(table.invoiceId), eq(table.invoiceId, r.invoiceId)),
  );
}

/**
 * Släpp fakturans poster i en Drizzle-tabell (#2260): först frysningen som de
 * släppta körningarna satte, sedan kopplingen till fakturan. `update` är
 * repots `updateWhere`, så att varje ändrad rad loggas i change_log.
 */
export async function releaseInvoiceWhere(
  table: BillingLockTable,
  r: InvoiceRelease,
  update: (where: SQL, patch: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const frozen = releasedFreezeWhere(table, r);
  if (frozen) await update(frozen, { frozenAt: null, frozenByBillingRunId: null });
  await update(eq(table.invoiceId, r.invoiceId), { invoiceId: null });
}
