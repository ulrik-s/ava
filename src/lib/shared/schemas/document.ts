import { z } from "zod";
import { baseFields, optionalDateLike } from "./common";
import { suggestionStatusSchema, matterRoleSchema, contactTypeSchema } from "./enums";
import {
  documentIdSchema,
  documentFolderIdSchema,
  documentAnalysisSuggestionIdSchema,
  matterEventSuggestionIdSchema,
  matterIdSchema,
  contactIdSchema,
  userIdSchema,
} from "./ids";

/**
 * DocumentFolder — hierarkisk mapp inom ett matter. `parentId` = null → root.
 * Lagras i `document-folders/<id>.json`.
 */
export const documentFolderSchema = z.object({
  id: documentFolderIdSchema,
  name: z.string(),
  matterId: matterIdSchema,
  parentId: documentFolderIdSchema.nullish(),
  createdAt: z.union([z.date(), z.string()]).transform((v) => (v instanceof Date ? v : new Date(v))),
}).passthrough();

export type DocumentFolder = z.infer<typeof documentFolderSchema>;

/**
 * Document — metadata om en uppladdad fil. Själva binär-innehållet ligger på
 * `storagePath` (`documents/content/<id>.<ext>`). Lagras i
 * `documents/<id>.json`.
 */
export const documentSchema = z.object({
  ...baseFields,
  id: documentIdSchema,
  matterId: matterIdSchema,
  folderId: documentFolderIdSchema.nullish(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  storagePath: z.string(),
  version: z.number().int().positive().default(1),
  uploadedById: userIdSchema,
  // AI-genererad metadata (fylls async efter upload)
  title: z.string().nullish(),
  documentType: z.string().nullish(),
  /** Etiketter ur byråns vokabulär (#621) — flera per dokument, satta av
   *  LLM (förslag) + användare. Komplement till `documentType`. */
  tags: z.array(z.string()).default([]),
  summary: z.string().nullish(),
  analyzedAt: optionalDateLike,
  analysisStatus: z.enum(["PENDING", "RUNNING", "DONE", "ERROR"]).nullish(),
  analysisModel: z.string().nullish(),
  analysisError: z.string().nullish(),
}).passthrough();

export type Document = z.infer<typeof documentSchema>;

/**
 * Kanonisk `documentType`-tagg för genererade kostnadsräkningar. Sätts av
 * `kostnadsrakningRouter.record` och används av billing-UI:t + diagnostik-
 * invarianten ([[invariants]]) för att hitta KR-dokumentet i ett ärende.
 * En enda källa så taggen inte kan divergera mellan skrivning och läsning.
 */
export const KOSTNADSRAKNING_DOCUMENT_TYPE = "Kostnadsräkning";

/**
 * DocumentAnalysisSuggestion — AI-extraherat kontakt-förslag. Lagras i
 * `document-analysis-suggestions/<id>.json`.
 */
export const documentAnalysisSuggestionSchema = z.object({
  ...baseFields,
  id: documentAnalysisSuggestionIdSchema,
  documentId: documentIdSchema,
  name: z.string(),
  role: matterRoleSchema,
  contactType: contactTypeSchema,
  email: z.string().nullish(),
  phone: z.string().nullish(),
  orgNumber: z.string().nullish(),
  personalNumber: z.string().nullish(),
  notes: z.string().nullish(),
  status: suggestionStatusSchema.default("PENDING"),
  acceptedContactId: contactIdSchema.nullish(),
}).passthrough();

export type DocumentAnalysisSuggestion = z.infer<typeof documentAnalysisSuggestionSchema>;

/**
 * MatterEventSuggestion — AI-extraherad tidpunkt (förhandling, möte, frist).
 * Lagras i `matter-event-suggestions/<id>.json`.
 */
export const matterEventSuggestionSchema = z.object({
  ...baseFields,
  id: matterEventSuggestionIdSchema,
  documentId: documentIdSchema,
  title: z.string(),
  description: z.string().nullish(),
  eventType: z.string().nullish(),
  startAt: z.union([z.date(), z.string()]).transform((v) => (v instanceof Date ? v : new Date(v))),
  endAt: optionalDateLike,
  allDay: z.boolean().default(false),
  location: z.string().nullish(),
  status: suggestionStatusSchema.default("PENDING"),
}).passthrough();

export type MatterEventSuggestion = z.infer<typeof matterEventSuggestionSchema>;
