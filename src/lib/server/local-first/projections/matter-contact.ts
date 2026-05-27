/**
 * `MatterContactProjection` — projicerar en länk mellan matter och
 * kontakt (klient/motpart/etc.) till `matter-contacts/<id>.json`.
 */

import { z } from "zod";
import { JsonProjection } from "./base";

export const matterContactSchema = z.object({
  id: z.string().min(1),
  matterId: z.string(),
  contactId: z.string(),
  role: z.enum([
    "KLIENT", "MOTPART", "MOTPARTSOMBUD", "AKLAGARE",
    "DOMSTOL", "FORSAKRINGSBOLAG", "VITTNE", "OMBUD", "OVRIG",
  ]),
  notes: z.string().nullable().optional(),
  // Denormaliserat; org-scoping via matter-relationen → valfritt.
  organizationId: z.string().optional(),
  createdAt: z.coerce.date().optional(),
});

export type MatterContactProjectionData = z.infer<typeof matterContactSchema>;

export class MatterContactProjection extends JsonProjection<MatterContactProjectionData> {
  constructor() { super(matterContactSchema); }

  pathFor(mc: MatterContactProjectionData): string {
    return `matter-contacts/${mc.id}.json`;
  }
}
