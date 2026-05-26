import { z } from "zod";
import { JsonProjection } from "./base";

export const invoiceSchema = z.object({
  id: z.string().min(1),
  matterId: z.string(),
  invoiceNumber: z.string(),
  type: z.enum(["ACCONTO", "FINAL", "CREDIT"]).default("FINAL"),
  status: z.enum(["DRAFT", "SENT", "PAID", "CANCELLED", "BAD_DEBT", "INSTALLMENT_PLAN"]).default("DRAFT"),
  amountExclVat: z.number(),
  vat: z.number(),
  amountInclVat: z.number(),
  issuedAt: z.coerce.date().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  paidAt: z.coerce.date().nullable().optional(),
  organizationId: z.string(),
});

export type InvoiceProjectionData = z.infer<typeof invoiceSchema>;

export class InvoiceProjection extends JsonProjection<InvoiceProjectionData> {
  constructor() { super(invoiceSchema); }
  pathFor(i: InvoiceProjectionData): string {
    return `invoices/${i.id}.json`;
  }
}
