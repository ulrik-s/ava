import { z } from "zod";
import { baseFields, orgScopedFields, dateLike } from "./common";
import { matterRoleSchema } from "./enums";
import { documentTemplateIdSchema, conflictCheckIdSchema, contactIdSchema, matterIdSchema, userIdSchema } from "./ids";

/**
 * DocumentTemplate (Dokumentmall) — Handlebars HTML, autofyller från
 * matter-data. Lagras i `.ava/templates/<id>.json`.
 */
export const documentTemplateSchema = z.object({
  ...orgScopedFields,
  id: documentTemplateIdSchema,
  name: z.string(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  /** Handlebars-HTML. */
  content: z.string(),
  createdById: userIdSchema,
}).passthrough();

export type DocumentTemplate = z.infer<typeof documentTemplateSchema>;

/**
 * En träff i jävskontrollen som sparas på ärendet (#1818): kontakten, dess roll
 * och ärendet den är kopplad till. Bär aldrig personnummer, organisationsnummer
 * eller klientnamn.
 */
export const conflictHitSchema = z.object({
  contactId: contactIdSchema,
  contactName: z.string(),
  role: matterRoleSchema,
  matterId: matterIdSchema,
  matterNumber: z.string(),
  matterTitle: z.string(),
});

/** En träff i jävskontrollen, sparad på ärendet (#1818). */
export type ConflictHit = z.infer<typeof conflictHitSchema>;

/**
 * ConflictCheck — jävssök-logg. Lagras i `conflict-checks/<id>.json`.
 */
export const conflictCheckSchema = z.object({
  id: conflictCheckIdSchema,
  searchTerm: z.string(),
  searchType: z.enum(["name", "personalNumber", "both"]),
  /** Sökresultat snapshot:ade vid söktillfället. JSON-array. */
  results: z.array(z.unknown()),
  checkedById: userIdSchema,
  /** Ärendet kontrollen gällde (#1818). Null = en fristående kontroll eller en äldre rad. */
  matterId: matterIdSchema.nullish(),
  createdAt: dateLike,
}).passthrough();

export type ConflictCheck = z.infer<typeof conflictCheckSchema>;

// Note: ej-implementerade entiteter (AvaRule, AvaEventLog, Passkey, Email)
// finns INTE i denna lista — de är antingen server-only eller framtida-arkitektur.
// Re-export av baseFields för consumer-skript som vill bygga egna scheman.
export { baseFields, dateLike };
