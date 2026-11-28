/**
 * Rådgivningstimmens faktura (#853): en riktig klientfaktura (STANDARD) med en
 * enda arvodesrad i hela kronor (#1438), momsen på den, skapad som Skapad
 * (DRAFT, #1138). Utbruten ur invoice-routern (routertaket); beräkningen är
 * oförändrad. Förfallodagen följer betalningsvillkoret när ingen anges.
 */

import { arvodeInclVatOre } from "@/lib/shared/billing/invoice-calc";
import { dueDateOr } from "@/lib/shared/billing/payment-terms";
import { RADGIVNING_INVOICE_NOTES } from "@/lib/shared/billing/radgivning-entry";
import type { Radgivningsavgift } from "@/lib/shared/billing/rattshjalp";
import { CURRENT_ROUNDING, roundToKronor } from "@/lib/shared/billing/whole-kronor";
import { ocrFromInvoiceNumber } from "@/lib/shared/ocr-reference";
import type { Invoice } from "@/lib/shared/schemas/billing";
import { asId, type MatterId, type OrganizationId } from "@/lib/shared/schemas/ids";
import { stockholmYear } from "@/lib/shared/stockholm-time";
import { newRowId, type QueuedCallScope } from "../queued-call";
import type { Repositories } from "../repositories/repositories";

/** Det som behövs för att skapa rådgivningsfakturan. */
export interface RadgivningInvoiceInput {
  orgId: OrganizationId;
  matterId: MatterId;
  /** Mötesdagen, som också är fakturadagen (#880). */
  when: Date;
  avgift: Radgivningsavgift;
  /** Angiven förfallodag, annars betalningsvillkoret. */
  dueDate?: string | undefined;
  scope: QueuedCallScope;
}

/** Skapar fakturan och ger den tillsammans med nettot och bruttot (öre). */
export async function createRadgivningInvoice(
  repos: Repositories, a: RadgivningInvoiceInput,
): Promise<{ invoice: Invoice; netOre: number; grossOre: number }> {
  const netOre = roundToKronor(a.avgift.beloppExclVatOre);
  const grossOre = arvodeInclVatOre(netOre);
  const vatOre = grossOre - netOre;
  const invoiceNumber = await repos.invoices.nextInvoiceNumber(a.orgId, stockholmYear(a.when));
  const invoice = await repos.invoices.create({
    id: asId<"InvoiceId">(newRowId(a.scope, "invoice")),
    matterId: a.matterId, invoiceNumber, ocrReference: ocrFromInvoiceNumber(invoiceNumber),
    amount: grossOre, vatOre, vatBreakdown: [{ kind: "arvode", vatRate: 2500, netOre, vatOre }], amountRounding: CURRENT_ROUNDING,
    invoiceType: "STANDARD", status: "DRAFT", invoiceDate: a.when, // "Skapad" tills den skickas (#1138)
    dueDate: dueDateOr(a.dueDate, a.when),
    notes: RADGIVNING_INVOICE_NOTES, purpose: "RADGIVNING",
  } satisfies Partial<Invoice>);
  return { invoice, netOre, grossOre };
}
