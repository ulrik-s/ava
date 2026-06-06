import { z } from "zod";
import { orgScopedFields } from "./common";
import { contactTypeSchema } from "./enums";
import { contactIdSchema } from "./ids";

/**
 * Contact — unified register: personer, företag, domstolar, myndigheter, …
 * Lagras i `contacts/<id>.json`.
 */
export const contactSchema = z.object({
  ...orgScopedFields,
  id: contactIdSchema,
  name: z.string(),
  contactType: contactTypeSchema.default("PERSON"),
  personalNumber: z.string().nullish(),
  orgNumber: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  address: z.string().nullish(),
  notes: z.string().nullish(),
  /** Parent-länk för advokat → byrå-grupperingar (samma kontakt-typ). */
  parentId: contactIdSchema.nullish(),
}).passthrough();

export type Contact = z.infer<typeof contactSchema>;
