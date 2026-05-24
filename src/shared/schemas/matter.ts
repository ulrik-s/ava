import { z } from "zod";
import { orgScopedFields, optionalDateLike } from "./common";
import { matterStatusSchema, paymentMethodSchema } from "./enums";
import { matterRoleSchema } from "@/client/lib/labels";

/**
 * Matter (Ärende) — lagras i `matters/active/<id>.json`. Vi har inte längre
 * separata mappar för CLOSED/ARCHIVED — status:fältet räcker.
 */
export const matterSchema = z.object({
  ...orgScopedFields,
  matterNumber: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  status: matterStatusSchema.default("ACTIVE"),
  matterType: z.string().nullish(),
  paymentMethod: paymentMethodSchema.default("PENDING"),
  paymentMethodNote: z.string().nullish(),
  paymentMethodDecidedAt: optionalDateLike,
}).passthrough();

export type Matter = z.infer<typeof matterSchema>;

/**
 * MatterContact — kopplar Contact till Matter med en roll. En kontakt
 * kan ha flera roller på samma ärende (klient + ombud t.ex.).
 */
export const matterContactSchema = z.object({
  id: z.string(),
  matterId: z.string(),
  contactId: z.string(),
  role: matterRoleSchema,
  notes: z.string().nullish(),
  createdAt: z.union([z.date(), z.string()]).transform((v) => (v instanceof Date ? v : new Date(v))),
}).passthrough();

export type MatterContact = z.infer<typeof matterContactSchema>;
