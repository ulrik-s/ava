/**
 * BillingRun-router — fakturerings-händelser separerade från Invoice.
 *
 * Skiljer fyra typer:
 *   ACCONTO         — del-faktura till klient (rättsskydd/hjälp).
 *                     Skapar Invoice direkt, fryser INTE underliggande rader.
 *   FINAL           — slutfaktura. Fryser alla unfrozen rader. Drar av
 *                     valda ACCONTO-runs.
 *   KOSTNADSRAKNING — OFFENTLIG_FÖRSVARARE. Skickas till domstol och får
 *                     status PENDING_VERDICT tills dom kommer. Vid setVerdict
 *                     transitionar vi till SENT, skapar Invoice + ev.
 *                     Expense(kind=PRUTNING).
 *   CREDIT          — kreditering (deferred — Phase 3+).
 *
 * Alla operationer är scopade till ctx.orgId via matter-joinen.
 *
 * Det externa API:t är platt (`trpc.billingRun.createFinal`, …). Själva
 * implementationen är uppdelad efter ansvarsområde i `./billingRun/`:
 *
 *   • read            — förslag, lista och fakturaspecifikation
 *   • invoices        — acontofaktura och slutfaktura
 *   • kostnadsrakning — kostnadsräkningen till domstol och beslutet
 *   • settlement      — avräkningen mot rättsskyddet (bokningen i settlement-invoices)
 *   • pruning         — försäkringsbolagets prutning efter slutregleringen
 *   • shared          — hjälpare som flera moduler delar
 */
import { router } from "../trpc";
import { invoiceProcedures } from "./billingRun/invoices";
import { kostnadsrakningProcedures } from "./billingRun/kostnadsrakning";
import { pruningProcedures } from "./billingRun/pruning";
import { readProcedures } from "./billingRun/read";
import { settlementProcedures } from "./billingRun/settlement";

export const billingRunRouter = router({
  ...readProcedures,
  ...invoiceProcedures,
  ...kostnadsrakningProcedures,
  ...settlementProcedures,
  ...pruningProcedures,
});
