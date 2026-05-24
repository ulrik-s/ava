import { z } from "zod";
import { baseFields, dateLike } from "./common";

/**
 * Organisation = byrå. En per git-repo (vanligen). Lagras i
 * `.ava/organizations/<id>.json`.
 */
export const organizationSchema = z.object({
  ...baseFields,
  name: z.string(),
  orgNumber: z.string().nullish(),
  address: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  bankgiro: z.string().nullish(),
  logoPath: z.string().nullish(),
  /** Entra ID tenant-id för O365 single-tenant-inloggning. Server-only fält. */
  azureTenantId: z.string().nullish(),
}).passthrough();

export type Organization = z.infer<typeof organizationSchema>;

export const officeSchema = z.object({
  ...baseFields,
  organizationId: z.string(),
  name: z.string(),
  address: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  isMain: z.boolean().default(false),
}).passthrough();

export type Office = z.infer<typeof officeSchema>;

// Hydrate-working-copy ger lastSyncedAt-fältet på org-raden. Ej i Prisma men
// kan finnas i git-clones från äldre versioner. .passthrough() ovan tillåter
// extra fält utan att fail:a parsningen.
export { dateLike };
