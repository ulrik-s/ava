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

import type { Invoice, Payment, WriteOff } from "@/lib/shared/schemas/billing";
import type { Repository } from "./types";

/** Faktura + dess avräknings-poster (motsvarar dagens `include` payments/writeOffs). */
export interface InvoiceWithLedger extends Invoice {
  payments: Payment[];
  writeOffs: WriteOff[];
}

export interface InvoiceRepository extends Repository<Invoice> {
  /** Faktura by id, org-scopad via ärendet (null om saknas/annan org/raderad). */
  getByIdInOrg(id: string, organizationId: string): Promise<Invoice | null>;
  /** Faktura med betalningar + avskrivningar (ledger). Null om saknas/raderad. */
  getByIdWithLedger(id: string): Promise<InvoiceWithLedger | null>;
  /** Alla (icke-raderade) fakturor i ett ärende, nyaste först. */
  listByMatter(matterId: string): Promise<Invoice[]>;
}
