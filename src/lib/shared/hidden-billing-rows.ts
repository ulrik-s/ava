/**
 * Regeln "dold från början" för faktureringslistor (#1522): annullerade
 * fakturor och kreditfakturor stör listan efter krediteringar, så de döljs
 * tills användaren väljer att visa dem. Endast visning — inget ändras.
 */

import type { InvoiceStatus, InvoiceType } from "@/lib/shared/schemas/enums";

/** Det en faktura behöver för att avgöra om den döljs. */
export interface HideableInvoice {
  status: InvoiceStatus;
  invoiceType: InvoiceType;
}

/** En annullerad faktura (ADR 0015: terminal) eller en kreditfaktura döljs från början. */
export function isHiddenInvoice(invoice: HideableInvoice): boolean {
  return invoice.status === "CANCELLED" || invoice.invoiceType === "CREDIT";
}

/** Rader uppdelade i de som visas från början och de som döljs. */
export interface PartitionedRows<T> {
  visible: T[];
  hidden: T[];
}

/** Delar raderna efter `isHidden`, med ordningen bevarad i båda delarna. */
export function partitionHidden<T>(rows: readonly T[], isHidden: (row: T) => boolean): PartitionedRows<T> {
  const visible: T[] = [];
  const hidden: T[] = [];
  for (const row of rows) (isHidden(row) ? hidden : visible).push(row);
  return { visible, hidden };
}
