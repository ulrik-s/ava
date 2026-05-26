import { z } from "zod";
import { baseFields, orgScopedFields, dateLike } from "./common";

/**
 * DocumentTemplate (Dokumentmall) — Handlebars HTML, autofyller från
 * matter-data. Lagras i `.ava/templates/<id>.json`.
 */
export const documentTemplateSchema = z.object({
  ...orgScopedFields,
  name: z.string(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  /** Handlebars-HTML. */
  content: z.string(),
  createdById: z.string(),
}).passthrough();

export type DocumentTemplate = z.infer<typeof documentTemplateSchema>;

/**
 * ConflictCheck — jävssök-logg. Lagras i `conflict-checks/<id>.json`.
 */
export const conflictCheckSchema = z.object({
  id: z.string(),
  searchTerm: z.string(),
  searchType: z.enum(["name", "personalNumber", "both"]),
  /** Sökresultat snapshot:ade vid söktillfället. JSON-array. */
  results: z.array(z.unknown()),
  checkedById: z.string(),
  createdAt: dateLike,
}).passthrough();

export type ConflictCheck = z.infer<typeof conflictCheckSchema>;

// Note: ej-implementerade entiteter (AvaRule, AvaEventLog, Passkey, Email)
// finns INTE i denna lista — de är antingen server-only eller framtida-arkitektur.
// Re-export av baseFields för consumer-skript som vill bygga egna scheman.
export { baseFields, dateLike };
