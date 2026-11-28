/**
 * Släpp en makulerad eller krediterad fakturas poster i minnesrepona (#2260) —
 * delas av tidsposternas och utläggens repo. Regeln är `releasePatch`, samma
 * som Drizzle-villkoren i `billing-lock-sql.ts`; kontraktstesterna prövar att
 * båda backends ger samma rader.
 */

import { asId } from "@/lib/shared/schemas/ids";
import { releasePatch, type InvoiceRelease, type LockableEntry } from "@/lib/shared/time-entry-lock";
import type { Delegate } from "../data-store/IDataStore";

/** Strängvärdet, eller `null` för allt annat (en otypad rad ur query-engine:n). */
function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Låsfälten ur en otypad rad, utan cast. */
function lockFieldsOf(row: Readonly<Record<string, unknown>>): LockableEntry {
  const frozenAt = row.frozenAt instanceof Date ? row.frozenAt : str(row.frozenAt);
  const runId = str(row.frozenByBillingRunId);
  return { invoiceId: str(row.invoiceId), frozenAt, frozenByBillingRunId: runId === null ? null : asId<"BillingRunId">(runId) };
}

/**
 * Nolla låsfälten som släppet gäller på varje berörd post: posterna kopplade
 * till fakturan och de som en släppt körning frös.
 */
export async function releaseInvoiceInMemory(delegate: Delegate, r: InvoiceRelease): Promise<void> {
  const rows = await delegate.findMany({
    where: { OR: [{ invoiceId: r.invoiceId }, { frozenByBillingRunId: { in: [...r.billingRunIds] } }] },
  });
  for (const row of rows) {
    const patch = releasePatch(lockFieldsOf(row), r);
    if (Object.keys(patch).length > 0) await delegate.updateMany({ where: { id: row.id }, data: patch });
  }
}
