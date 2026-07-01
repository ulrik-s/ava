/**
 * `AccontoDeductionRepository` (ADR 0020, #409 fan-out) — acconto-avdrag (kopplar
 * en FINAL-faktura till de ACCONTO-fakturor den drar av). `createFinal` använder
 * bara bas-`create`; "ej redan avdragna"-filtret bor på `InvoiceRepository`
 * (`listDeductibleAccontos`) eftersom det är en faktura-fråga.
 */

import type { AccontoDeduction } from "@/lib/shared/schemas/billing";
import type { InvoiceId } from "@/lib/shared/schemas/ids";
import type { Repository } from "./types";

export interface AccontoDeductionRepository extends Repository<AccontoDeduction> {
  /** Alla acconto-avdrag som en slutfaktura drar av (fakturaspecifikationen, #856). */
  listByFinalInvoice(finalInvoiceId: InvoiceId): Promise<AccontoDeduction[]>;
}
