/**
 * `ExpenseRepository` (ADR 0020, #409 fan-out) — utlägg. Bas-CRUD ärvs;
 * `listUnbilled` hämtar valda ofakturerade utlägg, `flagBilled` kopplar dem
 * till fakturan (bulk).
 */

import type { Expense } from "@/lib/shared/schemas/billing";
import type { Repository } from "./types";

export interface ExpenseRepository extends Repository<Expense> {
  /** Valda ofakturerade utlägg i ett ärende. Tom lista vid tomma ids. */
  listUnbilled(matterId: string, ids: string[]): Promise<Expense[]>;
  /** Koppla utlägg till en faktura (sätter invoiceId). No-op vid tomma ids. */
  flagBilled(ids: string[], invoiceId: string): Promise<void>;
}
