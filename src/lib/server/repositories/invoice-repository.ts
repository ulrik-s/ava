/**
 * `InvoiceRepository` (ADR 0020, #409 Fas 2 — pilot) — typade metoder i st.f.
 * dynamiska `where`/`include`. Sätter mönstret för övriga entiteters repos:
 *   - bas-CRUD ärvs från `Repository<Invoice>`
 *   - relations-läsningar blir EXPLICITA metoder med typad retur
 *     (`getByIdWithLedger` → `InvoiceWithLedger`)
 *   - lista blir en namngiven metod (`listByMatter`) i st.f. `findMany({ where })`
 *
 * Affärslogik (statemaskin, beräkningar) bor kvar i routrarna; repot är ren
 * dataåtkomst. Två impls: in-memory (browser/offline) + Drizzle (server).
 */

import type {
  Expense, Invoice, Payment, PaymentPlan, PaymentPlanReminder, TimeEntry, WriteOff,
} from "@/lib/shared/schemas/billing";
import type { Document } from "@/lib/shared/schemas/document";
import type { Matter } from "@/lib/shared/schemas/matter";
import type { Repository } from "./types";

/** Faktura + dess avräknings-poster (motsvarar dagens `include` payments/writeOffs). */
export interface InvoiceWithLedger extends Invoice {
  payments: Payment[];
  writeOffs: WriteOff[];
}

/**
 * Faktura + relationerna som fakturadetalj-sidan läser, via relations()-infran
 * (ADR 0020 #439). Self-ref-relationerna (accontoDeductions/deductedOnFinals/
 * creditedInvoice/creditNote) läggs till i steget som migrerar `getById`.
 */
export interface InvoiceWithRelations extends Invoice {
  matter: Matter | null;
  payments: Array<Payment & { recordedBy: { name: string } | null }>;
  writeOffs: WriteOff[];
  paymentPlan: (PaymentPlan & { reminders: PaymentPlanReminder[] }) | null;
  timeEntries: TimeEntry[];
  expenses: Expense[];
  documents: Document[];
}

export interface InvoiceRepository extends Repository<Invoice> {
  /** Faktura by id, org-scopad via ärendet (null om saknas/annan org/raderad). */
  getByIdInOrg(id: string, organizationId: string): Promise<Invoice | null>;
  /** Faktura med betalningar + avskrivningar (ledger). Null om saknas/raderad. */
  getByIdWithLedger(id: string): Promise<InvoiceWithLedger | null>;
  /** Faktura + huvudrelationer (matter/payments/writeOffs/plan/tid/utlägg/dok), org-scopad. */
  getByIdWithRelations(id: string, organizationId: string): Promise<InvoiceWithRelations | null>;
  /** Alla (icke-raderade) fakturor i ett ärende, nyaste först. */
  listByMatter(matterId: string): Promise<Invoice[]>;
}
