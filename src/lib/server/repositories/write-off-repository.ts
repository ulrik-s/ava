/**
 * `WriteOffRepository` (ADR 0020, #409 fan-out) — konstaterade kundförluster
 * (ADR 0007). Bas-CRUD ärvs (`create` används av `invoice.writeOff`);
 * `sumByInvoice` summerar avskrivet-hinken för fakturans ledger.
 */

import type { WriteOff } from "@/lib/shared/schemas/billing";
import type { InvoiceId } from "@/lib/shared/schemas/ids";
import type { Repository } from "./types";

export interface WriteOffRepository extends Repository<WriteOff> {
  /** Summa av alla (icke-raderade) avskrivningar på en faktura (öre). */
  sumByInvoice(invoiceId: InvoiceId): Promise<number>;
  /** Avskrivningar för en uppsättning fakturor (rapporter). Tom lista vid tomma ids. */
  listByInvoiceIds(invoiceIds: InvoiceId[]): Promise<WriteOff[]>;
}
