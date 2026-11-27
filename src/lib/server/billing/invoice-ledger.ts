/**
 * Fakturans avräkning (betalt/krediterat/avskrivet → ledger), delad mellan
 * fakturarouterns `writeOff`/`recordPayment` och startjobbet som ger äldre
 * BAD_DEBT-fakturor sin WriteOff-post (#1809). Flyttad oförändrad ur
 * `routers/invoice.ts`; importerar bara repo-gränssnittet och `shared`.
 */

import { computeInvoiceLedger } from "@/lib/shared/billing/write-off-calc";
import type { InvoiceId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { Repositories } from "../repositories/repositories";

/**
 * Summera fakturans avräkningshinkar (betalt/krediterat/avskrivet) → ledger.
 * Migrerad till repository-sömmen (ADR 0020): typade `sumByInvoice`/
 * `sumCreditNotesFor` i st.f. dynamiska `findMany`-reduce. Den rena matematiken
 * (`computeInvoiceLedger`) + tillståndslogiken bor kvar i routern.
 */
export async function gatherInvoiceLedger(
  repos: Repositories,
  orgId: OrganizationId,
  inv: { id: InvoiceId; amount: number },
): Promise<{ paid: number; credited: number; writtenOff: number; ledger: ReturnType<typeof computeInvoiceLedger> }> {
  const paid = await repos.payments.sumByInvoice(inv.id);
  const credited = await repos.invoices.sumCreditNotesFor(inv.id, orgId);
  const writtenOff = await repos.writeOffs.sumByInvoice(inv.id);
  return { paid, credited, writtenOff, ledger: computeInvoiceLedger(inv.amount, paid, credited, writtenOff) };
}
