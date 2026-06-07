import { z } from "zod";
import { JsonProjection } from "./base";

// Behåller seed-/projektions-fält (amountExklVat, invoiceNumber, issuedAt…)
// MEN gör dem valfria: den kanoniska fakturan som mutationerna (createFinal/
// createAcconto) skapar har `amount` + `invoiceType` + `invoiceDate` och
// saknar exkl/vat/inkl-uppdelningen. Strikt schema droppade dem vid hydrering.
// `mergeRawAfterParse` bevarar alla råa fält, så vi behöver bara undvika att
// parse kastar. `.passthrough()` behåller även fält utanför schemat.
export const invoiceSchema = z.object({
  id: z.string().min(1),
  matterId: z.string(),
  // Kanoniskt belopp (mutationen). Legacy/seed hade exkl/vat/inkl.
  amount: z.number().optional(),
  amountExclVat: z.number().optional(),
  vat: z.number().optional(),
  amountInclVat: z.number().optional(),
  invoiceNumber: z.string().optional(),
  invoiceType: z.enum(["STANDARD", "ACCONTO", "FINAL", "CREDIT"]).optional(),
  // Legacy-aliaset `type` togs bort i schemaVersion 2 (migrate-on-read strippar
  // det vid hydrering, ADR 0004). `invoiceType` är kanoniskt.
  status: z.enum(["DRAFT", "SENT", "PAID", "CANCELLED", "BAD_DEBT", "INSTALLMENT_PLAN"]).default("DRAFT"),
  invoiceDate: z.coerce.date().nullable().optional(),
  issuedAt: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  paidAt: z.coerce.date().nullable().optional(),
  organizationId: z.string().optional(),
}).passthrough();

export type InvoiceProjectionData = z.infer<typeof invoiceSchema>;

export class InvoiceProjection extends JsonProjection<InvoiceProjectionData> {
  constructor() { super(invoiceSchema); }
  pathFor(i: InvoiceProjectionData): string {
    return `invoices/${i.id}.json`;
  }
}
