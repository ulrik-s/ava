/**
 * `ContactProjection` — projicierar en kontakt till `contacts/<id>.json`.
 *
 * Kontakter har inget arkiv-koncept (de finns kvar oavsett ärendestatus
 * eftersom samma kontakt kan dyka upp i nya ärenden). Därför en platt
 * mapp utan year-bucketing.
 */

import { z } from "zod";
import { JsonProjection } from "./base";

export const contactProjectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  contactType: z.enum([
    "PERSON", "ORGANIZATION", "COMPANY", "COURT", "AUTHORITY",
    "INSURANCE_COMPANY", "LAW_FIRM", "OTHER",
  ]),
  personalNumber: z.string().nullable().optional(),
  orgNumber: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  organizationId: z.string(),
});

export type ContactProjectionData = z.infer<typeof contactProjectionSchema>;

export class ContactProjection extends JsonProjection<ContactProjectionData> {
  constructor() { super(contactProjectionSchema); }

  pathFor(c: ContactProjectionData): string {
    return `contacts/${c.id}.json`;
  }
}
