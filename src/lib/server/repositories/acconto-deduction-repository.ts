/**
 * `AccontoDeductionRepository` (ADR 0020, #409 fan-out) — acconto-avdrag (kopplar
 * en FINAL-faktura till de ACCONTO-fakturor den drar av). `createFinal` använder
 * bara bas-`create`; "ej redan avdragna"-filtret bor på `InvoiceRepository`
 * (`listDeductibleAccontos`) eftersom det är en faktura-fråga.
 */

import type { AccontoDeduction } from "@/lib/shared/schemas/billing";
import type { Repository } from "./types";

export type AccontoDeductionRepository = Repository<AccontoDeduction>;
